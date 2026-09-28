# Nhận thư (Inbound pipeline)

> **[CƠ BẢN]** · Các bước đánh dấu *(NÂNG CAO)* có thể bỏ ở MVP.
> Phụ thuộc: [05-quan-ly-mailbox.md](05-quan-ly-mailbox.md), [13-hoi-thoai.md](13-hoi-thoai.md) · Liên quan: [02-nang-cao/01](../02-nang-cao/01-rule-mailbox.md), [02](../02-nang-cao/02-rule-domain.md), [07](../02-nang-cao/07-tra-loi-tu-dong.md), [08](../02-nang-cao/08-chuyen-tiep-tai-khoan.md), [10](../02-nang-cao/10-danh-ba-va-chan.md), [11](../02-nang-cao/11-bo-loc-spam.md), [12](../02-nang-cao/12-webhook.md), [04](../02-nang-cao/04-realtime.md)

## 1. Mục tiêu
Nhận thư Cloudflare Email Routing giao tới Worker, quyết định nhanh (reject / forward / lưu) trong phiên SMTP, rồi xử lý nặng (parse, lọc, lưu) bất đồng bộ, **không bao giờ làm mất thư âm thầm** (hoặc lưu được, hoặc người gửi nhận bounce) và **không lưu trùng**.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Handler `email()`, giới hạn kích thước, ghi raw R2, enqueue | Nhận SMTP (Cloudflare làm) |
| Phân giải địa chỉ → mailbox, từ chối người nhận lạ | Quản lý rule (file rule) |
| Consumer: parse, lưu message + attachment, threading | Giao diện hiển thị |
| Gọi các bước phụ: rule, spam, contact, auto-reply, realtime, webhook | Chi tiết từng bước phụ (file riêng) |
| Cấu hình retry & dead-letter queue | |

## 3. Cấu hình
| Biến / binding | Mặc định | Ý nghĩa |
|---|---|---|
| `MAX_INBOUND_SIZE` | `26214400` (25 MB) | Kích thước raw tối đa (byte) của một thư đến |
| `BUCKET` | — | R2 lưu raw MIME và attachment |
| `INBOUND_QUEUE` | — | Queue `<app>-inbound` |
| `OUTBOUND_QUEUE` | — | Queue `<app>-outbound` (cũng chở webhook, [02-nang-cao/12](../02-nang-cao/12-webhook.md)) |

## 4. Phân giải địa chỉ — thủ tục `PHAN_GIAI_DIA_CHI(toAddress, fromAddress?)`

### 4.1 Chuẩn hoá
```
CHUAN_HOA_LOCAL(lp) = lower(lp.split("+")[0].replaceAll(".", ""))
PHAN_TICH_NGUOI_NHAN(addr) = { original, localPart: CHUAN_HOA_LOCAL(local), domain: lower(domain),
                               normalizedAddress: `${CHUAN_HOA_LOCAL(local)}@${domain}` }
```
Không parse được hoặc local rỗng → `null`.

Ví dụ: `John.Doe+news@x.com`, `johndoe@x.com`, `j.o.h.n.doe@x.com` → **cùng một mailbox** (`johndoe` hoặc `john.doe`). Kiểm tra trùng khi tạo mailbox/alias dùng cùng hàm ([05-quan-ly-mailbox.md §3.4](05-quan-ly-mailbox.md)).

**Quyết định thiết kế — bỏ dấu chấm trong local-part:**
- Mặc định: quy tắc kiểu Gmail như trên (bỏ `+tag`, bỏ `.`, lowercase).
- Thay thế: chỉ bỏ `+tag` và lowercase, giữ `.` (khi `a.b` và `ab` phải là hai mailbox khác nhau). Chọn phương án nào thì `CHUAN_HOA_LOCAL` đổi theo, và mọi nơi dùng nó (phân giải, kiểm tra trùng, địa chỉ hợp lệ) đổi cùng lúc.

### 4.2 Thuật toán (3 pha)
```
parsed = PHAN_TICH_NGUOI_NHAN(toAddress)                                   → null: return null
domain = domains WHERE hostname = parsed.domain AND status = 'active'   → không có: return null
rules  = routing_rules WHERE domain_id AND scope='domain' AND enabled
         ORDER BY priority DESC, created_at ASC                              (NÂNG CAO)
input  = { toAddress, fromAddress }

// Pha 1 — chặn (chạy trước cả mailbox thật)                              (NÂNG CAO)
for r in rules where action == 'reject' && điều kiện của r khớp input (02-nang-cao/02):
    return { action:'reject', rejectReason: trim(r.rejectReason) || "Message rejected by routing rule", ruleId }

// Pha 2 — mailbox thật luôn thắng catch-all
mb =  mailboxes(domain, !disabled) có CHUAN_HOA_LOCAL(local_part) == parsed.localPart
   ?? alias trên domain có CHUAN_HOA_LOCAL(local_part) khớp, mailbox của alias !disabled       (NÂNG CAO)
   ?? mailbox useAllDomains=true, !disabled, CHUAN_HOA_LOCAL(local_part) khớp, và
      DIA_CHI_HOP_LE(mb) (05-quan-ly-mailbox §3.2) chứa parsed.normalizedAddress (so theo dạng chuẩn hoá)  (NÂNG CAO)
if mb: return { action:'store', mailbox: ROUTE(mb, domain) }

// Pha 3 — fallback / catch-all                                              (NÂNG CAO)
for r in rules where action in (forward, store) && điều kiện của r khớp input:
    if forward: forwardTo = trim(r.forwardTo); rỗng → bỏ qua rule
                catchAll = r.mailboxId ? mailbox(r.mailboxId, !disabled) : null
                return { action:'forward', forwardTo, keepCopy: r.keepCopy && !!catchAll,
                         mailbox: catchAll ? ROUTE(catchAll, domain) : null, ruleId }
    if store:   cần r.mailboxId trỏ mailbox !disabled, nếu không → bỏ qua rule
                return { action:'store', mailbox: ROUTE(mailbox, domain), ruleId }
return null
```
`ROUTE(mb, domain) = { mailboxId: mb.id, userId: mb.user_id (owner), domainId: domain.id, hostname: domain.hostname, localPart: mb.local_part, displayName: mb.display_name, folderId: null }`.

- `domainId`/`hostname` của route là của **domain đang nhận**, không nhất thiết domain chính của mailbox (catch-all, useAllDomains, alias).
- Thứ tự 3 pha là bắt buộc: nó ngăn catch-all `*` che mất mailbox thật, đồng thời vẫn cho phép chặn người gửi ngay cả khi người nhận là mailbox thật.
- Mailbox `disabled` và domain không `active` coi như không tồn tại.

### 4.3 Bản MVP tối giản
Chỉ Pha 2 bước đầu (mailbox chính xác). Không khớp → `null` → handler từ chối "Unknown recipient" (§5).

## 5. Giai đoạn 1 — Handler `email(message, env, ctx)` (đồng bộ)
Vì `message.setReject()` và `message.forward()` chỉ tồn tại trên đối tượng thư "sống", mọi quyết định reject/forward phải làm ở đây.

```
try:
  if message.rawSize > MAX_INBOUND_SIZE:
      message.setReject("Message too large"); return                       // không ghi R2

  resolveFailed = false
  try:
      decision = PHAN_GIAI_DIA_CHI(message.to, message.from)
      nếu decision?.ruleId → ghi nhận lượt khớp rule (02-nang-cao/02; lỗi bỏ qua)
  catch e:
      log; decision = null; resolveFailed = true      // lỗi hạ tầng routing KHÔNG được chặn lưu thư

  if !resolveFailed && decision == null:
      message.setReject("Unknown recipient"); return                        // không ghi R2, không enqueue

  if decision?.action == "reject":                                          (NÂNG CAO)
      message.setReject(decision.rejectReason); return

  route = decision?.mailbox ?? null

  if decision?.action == "forward":                                         (NÂNG CAO)
      ok = CHUYEN_TIEP(message, decision.forwardTo)
      if ok && !decision.keepCopy: return            // forward-only → không lưu
      if !ok && !route: message.setReject("Forwarding failed"); return      // không có nơi lưu → bounce
      // forward lỗi nhưng có mailbox → vẫn lưu để không mất thư

  if route && message.headers.get("X-App-Forwarded") != "1":                (NÂNG CAO — chống vòng lặp)
      dest = đích chuyển tiếp tài khoản của owner route.userId (02-nang-cao/08)
      if dest: CHUYEN_TIEP(message, dest)            // không dừng — luôn lưu bản sao

  rawR2Key = "inbound/<Date.now()>-<id ngẫu nhiên>.eml"
  BUCKET.put(rawR2Key, message.raw (stream, độ dài = message.rawSize),
             { httpMetadata: {contentType: "message/rfc822"}, customMetadata: {from, to} })
  INBOUND_QUEUE.send({ from: message.from, to: message.to, rawR2Key,
                       headers: <mọi header của message dạng object>,
                       route: route ? { mailboxId, domainId, hostname, ruleId: decision.ruleId ?? null } : null })
catch err:
  log; message.setReject("Processing failed")       // người gửi nhận bounce, thư không mất âm thầm
```
- Thủ tục `CHUYEN_TIEP(message, dest)` = `message.forward(dest, Headers{"X-App-Forwarded": "1"})`; ném lỗi → trả `false` (log).
- `from`/`to` là **envelope** (SMTP). Header thật được chuyển sang consumer qua `headers`.
- Không parse MIME ở đây (giới hạn CPU/thời gian của email handler).
- `route = null` trong payload **chỉ** xảy ra khi phân giải lỗi hạ tầng (`resolveFailed`); consumer sẽ tự phân giải lại.

## 6. Payload hàng đợi inbound
```json
{ "from": "sender@remote.com", "to": "sales@example.com",
  "rawR2Key": "inbound/1767225600000-abc123.eml",
  "headers": { "message-id": "<…>", "subject": "…" },
  "route": { "mailboxId": "mbx_…", "domainId": "dom_…", "hostname": "example.com", "ruleId": null } | null }
```
Quyết định định tuyến được **truyền qua payload**: consumer không phân giải lại (tránh trường hợp rule đổi giữa hai giai đoạn cho kết quả khác), chỉ kiểm tra route còn hợp lệ.

## 7. Giai đoạn 2 — Consumer, thủ tục `XU_LY_THU_DEN(payload)`

```
 1. route = payload.route
    if route == null:                                   // handler không phân giải được
        d = PHAN_GIAI_DIA_CHI(payload.to, payload.from)
        d == null | d.action == reject | (d.action == forward && !d.keepCopy) | !d.mailbox
            → log warn "No routing for inbound address"; xoá raw R2; ack; return
        route = d.mailbox
 2. mb = mailboxes WHERE id = route.mailboxId; kiểm tra: tồn tại, !disabled, domain route.domainId còn tồn tại
    không thoả → log warn "Mailbox no longer available"; xoá raw R2; ack; return
 3. IDEMPOTENCY: đã có messages(mailbox_id = mb.id, raw_r2_key = payload.rawR2Key) → ack; return
 4. raw = BUCKET.get(rawR2Key); không có → error log, ack, return
 5. parsed = PARSE_MIME(await raw.arrayBuffer())                        (§8)
 6. messageId = msg_…; snippet = snippet(parsed.text, parsed.html)      (00-nen-tang/06 §8)
    deliveredAddress = phần địa chỉ của payload.to || `${mb.local_part}@${route.hostname}`
    toAddr   = parsed.toAddr ?? payload.to      // header To đầy đủ (để reply-all)
    fromAddr = parsed.fromAddr ?? payload.from
 7. destination = đích theo rule mailbox (02-nang-cao/01) với
        {toAddress: payload.to, fromAddress: fromAddr, subject, content: text + " " + html + " " + snippet}
                                                                        (NÂNG CAO; MVP = {status:'received', folderId:null})
 8. nếu owner.spam_protection_enabled != false:                         (NÂNG CAO, 02-nang-cao/11)
        try spam = phân tích spam(...) catch e → spamAnalysisError = e.message[:300]
    nếu destination.status == 'spam' && spam: spam = {score:100, verdict:'spam',
        signals:[{id:'mailbox_rule_spam', score:100, reason:"A mailbox rule marked this message as spam"}], fingerprint}
 9. status   = (destination.status == 'received' && spam?.verdict == 'spam') ? 'spam' : destination.status
    folderId = status == 'spam' ? null : destination.folderId
10. contact  = upsert danh bạ của owner từ fromAddr, nguồn 'inbound' (chỉ ghi DB; 02-nang-cao/10)   (NÂNG CAO)
11. threadId = thread theo In-Reply-To/References trong mailbox, hoặc Message-ID của chính thư (13-hoi-thoai)
12. try:
       INSERT messages { id, userId: owner, mailboxId, folderId, direction:'inbound',
          providerMessageId: parsed.messageId, fromAddr, toAddr, ccAddr: parsed.ccAddr,
          subject, snippet, textBody, htmlBody, rawR2Key, status, threadId,
          inReplyTo, references: refs.join(" ") || null,
          spamScore, spamVerdict, spamSignals: JSON, spamAnalyzedAt, spamAnalysisError }
       LUU_DINH_KEM(messageId, parsed.attachments, {validate:false})       (§9)
       nếu spam: try ghi quan sát uy tín người gửi (02-nang-cao/11) catch log;
                 log JSON {messageId, score, verdict, signal ids}
    catch e:
       DELETE messages WHERE id = messageId; throw e      → queue retry sau 10 s
13. ack. Các bước phụ (§10) chạy sau khi INSERT đã commit và KHÔNG BAO GIỜ ném.
```

## 8. Parse MIME — thủ tục `PARSE_MIME(buffer)` (ví dụ: postal-mime)
| Trường | Cách lấy |
|---|---|
| `subject` | Subject đã giải mã, hoặc `null` |
| `text`, `html` | phần text/plain và text/html chính |
| `messageId` | Message-ID nguyên dạng (thường có `<>`) |
| `fromAddr` | địa chỉ From định dạng `"Name" <addr>` |
| `toAddr`, `ccAddr`, `bccAddr` | danh sách địa chỉ (mở rộng group), mỗi phần tử `"Name" <addr>`, nối `", "` |
| `inReplyTo` | Message-ID đã chuẩn hoá ([00-nen-tang/06 §7](../00-nen-tang/06-quy-uoc-chung.md)) |
| `references` | danh sách Message-ID đã chuẩn hoá, loại trùng |
| `date` | Date header nếu hợp lệ |
| `attachments[]` | `filename ?? "attachment-<n>"`, `type = mimeType || application/octet-stream`, `content` (bytes; chuỗi base64/utf8 được chuyển thành bytes), `disposition: inline|attachment`, `contentId` |

## 9. Lưu attachment — thủ tục `LUU_DINH_KEM(messageId, list, {validate})`
```
if validate != false: kiểm tra ≤10 file, ≤10MB/file, ≤20MB tổng   // thư đến: bỏ qua (đã giới hạn bởi MAX_INBOUND_SIZE)
for a in list:
   id = att_…; filename = làm sạch(a.filename)     // trim, thay / \ \0 bằng "_", rỗng → "attachment"
   r2Key = `attachments/${messageId}/${id}/${filename}`
   BUCKET.put(r2Key, a.content, {httpMetadata:{contentType: a.type}, customMetadata:{filename, messageId}})
   INSERT message_attachments {id, messageId, filename, contentType, size: số byte,
                               disposition: a.disposition ?? 'attachment', contentId, r2Key}
catch: xoá mọi object R2 đã put trong lần này; throw
```

## 10. Các bước phụ sau khi lưu (không chặn)
Chạy sau bước 12 thành công. Mỗi bước bọc try/catch, lỗi chỉ log; không bước nào làm thư bị retry (nên không bao giờ gây lưu trùng hay thông báo trùng).

| Bước | Điều kiện | Cách chạy |
|---|---|---|
| Auto-reply (NÂNG CAO, [02-nang-cao/07](../02-nang-cao/07-tra-loi-tu-dong.md)) | `status == 'received'` | Best-effort, timeout 10 s |
| Realtime (NÂNG CAO, [02-nang-cao/04](../02-nang-cao/04-realtime.md)) | `status != 'spam'` | Gửi `{type:'new_message', messageId, mailboxId, from: fromAddr, fromName: contact?.displayName, subject}` tới **mọi user có quyền canRead trên mailbox** ([00-nen-tang/05](../00-nen-tang/05-phan-quyen.md)); không ai khác |
| Webhook (NÂNG CAO, [02-nang-cao/12](../02-nang-cao/12-webhook.md)) | mọi status | Với mỗi webhook đang bật của owner đăng ký `message.inbound`: **enqueue** một job giao webhook lên `OUTBOUND_QUEUE` với payload `{messageId, from: fromAddr, to: payload.to, cc, subject, threadId, spamScore, spamVerdict}`. Lần gửi **đầu tiên** cũng do consumer queue thực hiện, không gọi HTTP trong xử lý thư đến |
| Ảnh Gravatar cho contact mới (TÙY CHỌN, [03-tuy-chon/07](../03-tuy-chon/07-tien-ich-giao-dien.md)) | contact vừa được tạo mới | `ctx.waitUntil`, timeout 5 s; lỗi bỏ qua |

Thư `trash` (do rule) vẫn được thông báo realtime và webhook; thư `spam` chỉ có webhook.

## 11. Retry & dead-letter queue
Consumer cấu hình (Wrangler):
```jsonc
"queues": {
  "consumers": [
    { "queue": "<app>-inbound",  "max_retries": 3, "dead_letter_queue": "<app>-inbound-dlq" },
    { "queue": "<app>-outbound", "max_retries": 3, "dead_letter_queue": "<app>-outbound-dlq" }
  ]
}
```
- Lỗi xử lý → `message.retry({ delaySeconds: 10 })`; quá 3 lần → message chuyển sang DLQ.
- DLQ không có consumer tự xử lý; raw vẫn nằm ở R2 (`rawR2Key` trong payload) nên có thể xử lý lại bằng cách gửi lại payload vào `INBOUND_QUEUE`. Vận hành phải có cảnh báo khi DLQ khác rỗng ([05-van-hanh/01](../05-van-hanh/01-bay-va-cai-thien.md)).

## 12. Bảo đảm & tính chất
| Tính chất | Cơ chế |
|---|---|
| Không mất thư âm thầm | handler lỗi → bounce "Processing failed"; forward lỗi → vẫn lưu (hoặc bounce nếu không có mailbox); lỗi phân giải → vẫn lưu và phân giải lại ở consumer; hết retry → DLQ |
| Không object R2 mồ côi | người nhận lạ / quá cỡ bị từ chối trước khi ghi R2; consumer bỏ thư → xoá raw |
| Không trùng | kiểm tra `(mailbox_id, raw_r2_key)` trước khi xử lý; bước phụ không gây retry |
| Không nửa vời | lỗi sau INSERT → xoá dòng message, attachment đã put bị dọn, queue retry |
| Quyết định nhất quán | route truyền qua payload, không phân giải hai lần |
| Không vòng lặp forward | header `X-App-Forwarded: 1` |
| Giới hạn bộ nhớ | raw stream thẳng lên R2 ở handler; consumer chỉ nạp thư ≤ `MAX_INBOUND_SIZE` |

## 13. Lỗi & biên
| Tình huống | Kết quả |
|---|---|
| Địa chỉ không tồn tại, không catch-all | `setReject("Unknown recipient")`, không ghi R2 |
| Domain `pending` | Không phân giải → "Unknown recipient" |
| Mailbox bị disable | Coi như không tồn tại → catch-all nếu có, nếu không "Unknown recipient" |
| Thư lớn hơn `MAX_INBOUND_SIZE` | `setReject("Message too large")`, không ghi R2 |
| DB lỗi khi phân giải ở handler | Vẫn ghi R2 + enqueue với `route: null`; consumer phân giải lại |
| Rule đổi giữa handler và consumer | Không ảnh hưởng: consumer dùng route trong payload |
| Mailbox bị xoá/disable sau khi enqueue | Consumer log, xoá raw R2, ack |
| Forward-only tới đích lỗi, rule không có mailbox lưu | `setReject("Forwarding failed")` |
| Webhook endpoint chậm/chết | Không ảnh hưởng xử lý thư; retry theo cơ chế webhook |

## 14. Tiêu chí chấp nhận
- [ ] Gửi thư tới `user@domain` → trong ≤ vài giây có 1 dòng `messages` `inbound/received`, raw ở R2, attachment ở R2 + DB.
- [ ] Gửi tới địa chỉ không tồn tại (không catch-all) → người gửi nhận bounce "Unknown recipient", R2 không có object mới.
- [ ] Thư 30 MB với cấu hình mặc định → bounce "Message too large".
- [ ] Queue giao lại cùng payload → không tạo dòng thứ 2.
- [ ] Thư có `In-Reply-To` trỏ thư đã có trong mailbox → cùng `threadId`.
- [ ] Gửi tới `User.Name+tag@domain` → vào mailbox `username`.
- [ ] Lỗi R2 khi lưu attachment → không còn dòng message, queue retry; sau 3 lần thất bại message nằm trong DLQ.
- [ ] Webhook endpoint timeout → thư vẫn được lưu và ack, job webhook nằm trên `OUTBOUND_QUEUE`.
- [ ] Thông báo realtime chỉ tới user có quyền đọc mailbox; user không có quyền không nhận event.
- [ ] Handler ném lỗi bất kỳ → người gửi nhận bounce "Processing failed".

## 15. Ghi chú triển khai
- `BUCKET.put` với stream cần biết trước độ dài: bọc `message.raw` qua `FixedLengthStream(message.rawSize)` để stream thẳng lên R2 thay vì đọc toàn bộ vào bộ nhớ.
- Có thể dùng `ctx.waitUntil` trong consumer cho các bước phụ, nhưng phải ack message sau khi INSERT commit, không phụ thuộc kết quả bước phụ.
