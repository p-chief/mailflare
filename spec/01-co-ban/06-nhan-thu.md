# Nhận thư (Inbound pipeline)

> **[CƠ BẢN]** · Các bước đánh dấu *(NÂNG CAO)* có thể bỏ ở MVP.
> Phụ thuộc: [05-quan-ly-mailbox.md](05-quan-ly-mailbox.md), [13-hoi-thoai.md](13-hoi-thoai.md) · Liên quan: [02-nang-cao/01](../02-nang-cao/01-rule-mailbox.md), [02](../02-nang-cao/02-rule-domain.md), [07](../02-nang-cao/07-tra-loi-tu-dong.md), [08](../02-nang-cao/08-chuyen-tiep-tai-khoan.md), [11](../02-nang-cao/11-bo-loc-spam.md), [12](../02-nang-cao/12-webhook.md), [04](../02-nang-cao/04-realtime.md)

## 1. Mục tiêu
Nhận thư Cloudflare Email Routing giao tới Worker, quyết định nhanh (reject / forward / lưu) trong phiên SMTP, rồi xử lý nặng (parse, lọc, lưu) bất đồng bộ, **không bao giờ làm mất thư** và **không lưu trùng**.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Handler `email()`, ghi raw R2, enqueue | Nhận SMTP (Cloudflare làm) |
| Phân giải địa chỉ → mailbox | Quản lý rule (file rule) |
| Consumer: parse, lưu message + attachment, threading | Giao diện hiển thị |
| Gọi các bước phụ: rule, spam, contact, auto-reply, realtime, webhook | Chi tiết từng bước phụ (file riêng) |

## 3. Giai đoạn 1 — Handler `email(message)` (đồng bộ)
Vì `message.setReject()` và `message.forward()` chỉ tồn tại trên đối tượng thư "sống", mọi quyết định reject/forward phải làm ở đây.

```
try:
  decision = resolveIncomingMail(env, message.from, message.to)
       // = resolveInboundAddress(db, to, from); nếu decision.ruleId → recordRuleMatch (lỗi bỏ qua)
       // KHÔNG BAO GIỜ ném: lỗi → log + null (routing hỏng không được chặn lưu thư)

  if decision?.action == "reject":                                   (NÂNG CAO)
      message.setReject(decision.rejectReason ?? "Message rejected by routing rule"); return

  if decision?.action == "forward" && decision.forwardTo:             (NÂNG CAO)
      ok = forwardMessage(message, forwardTo)   // message.forward(dest, Headers{X-Mailflare-Forwarded: "1"}); lỗi → false
      if ok && !decision.keepCopy: return        // forward-only → không lưu
      // forward lỗi → vẫn lưu để không mất thư

  if message.headers.get("X-Mailflare-Forwarded") != "1":            (NÂNG CAO — chống vòng lặp)
      dest = getAccountForwardingDestination(env, message.to)
      if dest: forwardMessage(message, dest)     // không dừng — luôn lưu bản sao

  rawR2Key = storeRawToR2(from, to, message.raw)
       // key "inbound/<Date.now()>-<nanoid>.eml"; đọc toàn bộ stream thành ArrayBuffer
       // httpMetadata.contentType "message/rfc822"; customMetadata {from, to}
  INBOUND_QUEUE.send({ from: message.from, to: message.to, rawR2Key,
                       headers: Object.fromEntries(message.headers) })
catch err:
  log; message.setReject("Processing failed")      // người gửi nhận bounce, thư không mất âm thầm
```
- `from`/`to` là **envelope** (SMTP). Header thật được chuyển sang consumer qua `headers`.
- Không parse MIME ở đây (giới hạn CPU/thời gian của email handler).

## 4. Phân giải địa chỉ — `resolveInboundAddress(db, toAddress, fromAddress?)`

### 4.1 Chuẩn hoá
`parseRecipientAddress(to)` → `{localPart: normalize(local), domain, normalizedAddress}` với `normalize(lp) = lp.split("+")[0].replaceAll(".", "").toLowerCase()`. Không parse được hoặc local rỗng → `null`.

> Quy tắc kiểu Gmail: `John.Doe+news@x.com`, `johndoe@x.com`, `j.o.h.n.doe@x.com` → **cùng một mailbox** `johndoe`/`john.doe`. Cần quyết định có giữ không; nếu giữ, kiểm tra trùng khi tạo mailbox/alias phải so theo dạng chuẩn hoá.

### 4.2 Thuật toán (3 pha)
```
domain = domains WHERE hostname = parsed.domain AND status = 'active'   → không có: null
rules  = routing_rules WHERE domain_id AND scope='domain' AND enabled
         ORDER BY priority DESC, created_at ASC                              (NÂNG CAO)
input  = { toAddress, fromAddress }

// Pha 1 — chặn (chạy trước cả mailbox thật)                              (NÂNG CAO)
for r in rules where action == 'reject' && matchesRule(r, input):
    return { action:'reject', rejectReason: trim(r.rejectReason) || "Message rejected by routing rule", ruleId }

// Pha 2 — mailbox thật luôn thắng catch-all
mb =  mailboxes(domain, !disabled).find(m => normalize(m.localPart) == parsed.localPart)
   ?? alias trên domain (alias.localPart chuẩn hoá khớp, mailbox !disabled)            (NÂNG CAO)
   ?? mailbox useAllDomains=true, !disabled, normalize(localPart) khớp, và
      getMailboxDomainAddresses(mb) chứa parsed.normalizedAddress                    (NÂNG CAO)
if mb: return { action:'store', mailbox: toResolved(mb, domain) }

// Pha 3 — fallback / catch-all                                              (NÂNG CAO)
for r in rules where action in (forward, store) && matchesRule(r, input):
    if forward: forwardTo = trim(r.forwardTo); nếu rỗng → bỏ qua rule
                catchAll = r.mailboxId ? mailbox(r.mailboxId, !disabled) : null
                return { action:'forward', forwardTo, keepCopy: r.keepCopy && !!catchAll, mailbox: catchAll, ruleId }
    if store:   cần r.mailboxId trỏ mailbox !disabled, nếu không → bỏ qua rule
                return { action:'store', mailbox, ruleId }
return null
```
`ResolvedMailbox = { mailboxId, folderId: null, userId (owner), domainId, localPart, hostname, displayName }`.

Lưu ý: `mailbox` trả về trong pha 3 dùng `domainId`/`hostname` của **domain đang nhận**, không nhất thiết domain của mailbox.

### 4.3 Bản MVP tối giản
Chỉ Pha 2 bước đầu (mailbox chính xác). Không khớp → **nên `setReject("Unknown recipient")`** ngay trong `email()` (bản gốc không làm vậy — xem §7).

## 5. Giai đoạn 2 — Consumer `processInboundMessage(payload)`

```
 1. decision = resolveInboundAddress(db, payload.to, payload.from)   // truyền from để rule chặn cho cùng kết quả
    null                           → warn "No routing for inbound address", return (ack)
    action == reject               → return
    action == forward && !keepCopy → return
    !decision.mailbox              → return
 2. IDEMPOTENCY: đã có messages(mailbox_id = mb, raw_r2_key = payload.rawR2Key) → return
 3. raw = R2.get(rawR2Key); không có → error log, return
 4. parsed = parseRawMime(await raw.arrayBuffer())                     (§6)
 5. messageId = msg_…; snippet = buildSnippet(parsed.text, parsed.html)
    deliveredAddress = getEmailAddress(payload.to) || `${mb.localPart}@${mb.hostname}`
    toAddr   = parsed.toAddr ?? payload.to      // header To đầy đủ (để reply-all)
    fromAddr = parsed.fromAddr ?? payload.from
 6. destination = resolveInboxRuleDestination(mailbox, {toAddress: payload.to, fromAddress: fromAddr,
                    subject, content: text + " " + html + " " + snippet})       (NÂNG CAO; MVP = received)
 7. nếu owner.spam_protection_enabled != false:                                  (NÂNG CAO)
        try spam = analyzeSpam(...) catch e → spamAnalysisError = e.message[:300]
    nếu destination.status == 'spam' && spam: spam = {score:100, verdict:'spam',
        signals:[{id:'mailbox_rule_spam', score:100, reason:"A mailbox rule marked this message as spam"}], fingerprint}
 8. status   = (destination.status == 'received' && spam?.verdict == 'spam') ? 'spam' : destination.status
    folderId = status == 'spam' ? null : destination.folderId
 9. contact  = upsertContactFromAddress(owner, fromAddr, 'inbound')              (NÂNG CAO)
10. threadId = resolveThreadId({mailboxId, messageId: parsed.messageId, inReplyTo, references})
11. try:
       INSERT messages { id, userId: owner, mailboxId, folderId, direction:'inbound',
          providerMessageId: parsed.messageId, fromAddr, toAddr, ccAddr: parsed.ccAddr,
          subject, snippet, textBody, htmlBody, rawR2Key, status, threadId,
          inReplyTo, references: refs.join(" ") || null,
          spamScore, spamVerdict, spamSignals: JSON, spamAnalyzedAt, spamAnalysisError }
       storeMessageAttachments(messageId, parsed.attachments, {validate:false})
       nếu spam: try recordReputationObservation(...) catch log; log JSON {messageId, score, verdict, signal ids}
    catch e:
       DELETE messages WHERE id = messageId; throw e      → queue retry 10 s
12. nếu status == 'received': try sendMailboxAutoReply(...) catch log           (NÂNG CAO)
13. nếu status != 'spam': notifyUsersOfNewMessage(owner + chủ domain + user shared,   (NÂNG CAO)
        {type:'new_message', messageId, mailboxId, from: fromAddr, fromName: contact?.displayName, subject})
14. dispatchWebhooks(owner, 'message.inbound', {messageId, from: fromAddr, to: payload.to,        (NÂNG CAO)
        cc, subject, threadId, spamScore, spamVerdict})
```
Thư `trash` (do rule) vẫn được thông báo realtime và webhook; thư `spam` chỉ có webhook.

## 6. Parse MIME — `parseRawMime(buffer)` (postal-mime)
| Trường | Cách lấy |
|---|---|
| `subject` | `email.subject ?? null` |
| `text`, `html` | phần text/html (postal-mime chọn) |
| `messageId` | `email.messageId` (thường có `<>`) |
| `fromAddr` | `formatPostalAddress(email.from)` → `"Name" <addr>` |
| `toAddr`, `ccAddr`, `bccAddr` | `formatPostalAddressList` (mở rộng group), nối `", "` |
| `inReplyTo` | `normalizeMessageId(email.inReplyTo)` |
| `references` | `parseMessageIdList(email.references)` |
| `date` | `new Date(email.date)` nếu hợp lệ |
| `attachments[]` | `filename ?? "attachment-<n>"`, `type = mimeType || application/octet-stream`, `content` (ArrayBuffer; chuỗi base64/utf8 được chuyển), `disposition: inline|attachment`, `contentId` |

## 7. Lưu attachment — `storeMessageAttachments(env, messageId, list, {validate})`
```
if validate != false: validateAttachments(list)    // ≤10 file, ≤10MB/file, ≤20MB tổng (thư đến: bỏ qua)
for a in list:
   id = att_…; filename = sanitize(a.filename)     // trim, thay / \ \0 bằng "_", rỗng → "attachment"
   r2Key = `attachments/${messageId}/${id}/${filename}`
   R2.put(r2Key, a.content, {httpMetadata:{contentType: a.type}, customMetadata:{filename, messageId}})
   INSERT message_attachments {id, messageId, filename, contentType, size: byteLength,
                               disposition: a.disposition ?? 'attachment', contentId, r2Key}
catch: xoá mọi object R2 đã put trong lần này; throw
```

## 8. Bảo đảm & tính chất
| Tính chất | Cơ chế |
|---|---|
| Không mất thư | handler lỗi → reject (bounce); forward lỗi → vẫn lưu; routing lỗi → vẫn lưu |
| Không trùng | kiểm tra `(mailbox_id, raw_r2_key)` trước khi xử lý |
| Không nửa vời | lỗi sau INSERT → xoá dòng message, attachment đã put bị dọn, queue retry |
| Retry | 10 s, tối đa 3 lần (sau đó thư rơi vào dead-letter/ bị bỏ — nên cấu hình DLQ) |
| Không vòng lặp forward | header `X-Mailflare-Forwarded: 1` |

## 9. Lỗi & biên
| Tình huống | Hiện trạng | Khuyến nghị |
|---|---|---|
| Địa chỉ không tồn tại, không catch-all | Raw vẫn ghi R2 + enqueue; consumer bỏ → **object R2 mồ côi mãi** | Reject trong `email()` |
| Domain `pending` | Không phân giải (chỉ `active`) → như trên | |
| Mailbox bị disable | Không phân giải → như trên | Reject "Mailbox disabled" |
| Thư rất lớn | Đọc toàn bộ vào bộ nhớ ở cả handler và consumer | Giới hạn kích thước, stream lên R2 |
| Rule đổi giữa handler và consumer | Hai lần phân giải có thể khác | Truyền `decision` qua payload |
| Retry sau khi đã notify/webhook | Không xảy ra (notify/webhook chạy sau INSERT thành công; lỗi ở đó không ném) | |

## 10. Tiêu chí chấp nhận
- [ ] Gửi thư tới `user@domain` → trong ≤ vài giây có 1 dòng `messages` `inbound/received`, raw ở R2, attachment ở R2 + DB.
- [ ] Queue giao lại cùng payload → không tạo dòng thứ 2.
- [ ] Thư có `In-Reply-To` trỏ thư đã có trong mailbox → cùng `threadId`.
- [ ] Gửi tới `User.Name+tag@domain` → vào mailbox `username`.
- [ ] Lỗi R2 khi lưu attachment → không còn dòng message, queue retry.
- [ ] Handler ném lỗi bất kỳ → người gửi nhận bounce "Processing failed".
