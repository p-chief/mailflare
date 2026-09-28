# Gửi thư

> **[CƠ BẢN]** · Hẹn giờ gửi → [02-nang-cao/05](../02-nang-cao/05-hen-gio-gui.md) · API key `/api/v1/send` → [02-nang-cao/13](../02-nang-cao/13-api-key-va-rest-v1.md)
> Phụ thuộc: [05-quan-ly-mailbox.md](05-quan-ly-mailbox.md), [00-nen-tang/05-phan-quyen.md](../00-nen-tang/05-phan-quyen.md)

## 1. Mục tiêu
Gửi thư HTML + text với To/Cc/Bcc và file đính kèm qua binding `send_email`, từ một địa chỉ mà người gửi được phép dùng, lưu bản sao vào Sent và giữ đúng hội thoại.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Kiểm tra người gửi, chuẩn hoá người nhận, giới hạn | Soạn nội dung (UI) |
| Lưu message `queued → sent|failed`, outbound job | Retry gửi lỗi (chưa có) |
| Header threading | Theo dõi bounce/delivery status (chưa có) |
| Gửi kèm attachment của nháp | DKIM (Cloudflare Email Sending tự ký) |

## 3. Kiểm tra người gửi — `getAuthorizedSenderAddress({userId, from, mailboxId})`
```
!mailboxId                                   → "Mailbox is required"                          (400)
mailbox (join domain, owner) không có        → "Mailbox not found"                            (403)
actor = users WHERE id; !actor || disabled   → "Sender account not found"                     (403)
access = getMailboxAccessLevel(actor, mailbox); !canSendOnBehalf
                                             → "You do not have permission to send from this mailbox" (403)
requested = getEmailAddress(from).lower
requested ∉ getMailboxDomainAddresses(mailbox)
                                             → "Sender address does not match the selected mailbox"   (403)
senderName = primary mailbox ? owner.name : mailbox.displayName
canSendAs  → fromAddr = format(requested, senderName)
else       → fromAddr = format(requested, `${actor.name} on behalf of ${senderName || requested}`)
return { fromAddr, mailboxId }
```
Server **tự dựng** tên hiển thị — không tin tên client gửi. Lỗi khác bất kỳ → 500.

## 4. `POST /api/send` (session)
Nhận `multipart/form-data` (composer) hoặc JSON, tổng ≤ **30 MB** (413 nếu vượt, 400 nếu hỏng → "Invalid send request").

Trường multipart: `from, to, cc, bcc, subject, text, html, mailboxId, inReplyTo, references, threadId, draftId, scheduledAt` (chuỗi rỗng coi như không có) và `attachments` (nhiều File; file rỗng bị bỏ; `type` rỗng → `application/octet-stream`; `disposition: attachment`).

### 4.1 Validate (zod `sendEmailSchema`, trừ attachments)
| Trường | Quy tắc |
|---|---|
| `from` | 3–500 |
| `to` | chuỗi ≤5000 **hoặc** mảng ≤50 phần tử (3–500); sau tách: ≥1, ≤50, mỗi phần tử phải có `@` → "Enter valid email addresses" |
| `cc`, `bcc` | như `to` nhưng tuỳ chọn, có thể rỗng |
| `subject` | 1–500 (**bắt buộc**) |
| `html`, `text` | ≤ 2 MB mỗi cái, tuỳ chọn |
| `mailboxId` | 1–200 |
| `inReplyTo`, `threadId` | ≤ 998 |
| `references` | chuỗi ≤5000 hoặc mảng ≤50 → nối bằng khoảng trắng |
| `scheduledAt` | ISO datetime |
Lỗi → 400 `{error: flatten}`.

### 4.2 `draftId`
Nếu có: nháp phải thuộc user (404 "Draft not found"); nạp **nội dung** các attachment của nháp từ R2 và **nối** vào danh sách file upload. (Composer chỉ gửi `draftId` khi nháp có attachment đã lưu, vd forward.)

### 4.3 `sendEmail(env, input)`
```
sender = getAuthorizedSenderAddress(input)
validateAttachments(attachments)   // ≤10 file; mỗi file ≤10MB ("<name> exceeds the 10 MB attachment limit"); tổng ≤20MB
to/cc/bcc = toRecipientList(...)   // tách, loại trùng theo địa chỉ lowercase trong từng trường, giữ nguyên chuỗi gốc (có tên)
to rỗng → "At least one recipient is required"
|to|+|cc|+|bcc| > 50 → "A message can have at most 50 recipients"
for addr in to∪cc∪bcc: upsertContactFromAddress(user, addr, 'outbound')          (NÂNG CAO)
inReplyTo  = normalizeMessageId(input.inReplyTo)
references = mảng → normalize từng phần tử; chuỗi → parseMessageIdList
headers = {...input.headers}; inReplyTo → "In-Reply-To: <id>"; references → "References: <a> <b>"
messageId = msg_…; scheduledAt = input.scheduledAt > now ? Date : null
INSERT messages { id, userId, mailboxId: sender.mailboxId, direction:'outbound', fromAddr: sender.fromAddr,
   toAddr: join(to), ccAddr, bccAddr, subject, snippet, textBody, htmlBody, status:'queued',
   threadId: input.threadId ?? null, inReplyTo, references: refs.join(" ") || null }
try storeMessageAttachments(messageId, attachments) catch → DELETE message; throw
INSERT outbound_jobs { id: job_…, userId, messageId, status:'queued',
   payload: JSON({...input, from: sender.fromAddr, to, cc, bcc, mailboxId, attachments: metadata không content}),
   scheduledAt }
if scheduledAt: enqueueScheduledDelivery(...); return { messageId, scheduled: true }      (NÂNG CAO)
deliverEmail(...); return { messageId }
```

### 4.4 `deliverEmail`
```
res = await env.EMAIL.send({
  from, to: [...], cc?: [...], bcc?: [...], subject,
  headers: headers nếu không rỗng, html, text,
  attachments: a.disposition == 'inline' && a.contentId
      ? { filename, type, content, disposition:'inline', contentId }
      : { filename, type, content, disposition:'attachment' } })
OK:
  UPDATE messages SET status='sent', providerMessageId = res.messageId,
         threadId = input.threadId ?? normalizeMessageId(res.messageId) ?? messageId
  UPDATE outbound_jobs SET status='sent', updatedAt
  dispatchWebhooks(user, 'message.outbound', {messageId, providerMessageId, to, cc?})      (NÂNG CAO)
  audit 'email.send' {to, cc?, subject}
LỖI:
  UPDATE messages SET status='failed'; UPDATE outbound_jobs SET status='failed', error
  dispatchWebhooks(user, 'message.failed', {messageId, error})                              (NÂNG CAO)
  throw → HTTP 500 {error: message}
```
Thư gửi từ composer **không** có `rawR2Key` (MIME do Cloudflare dựng) → "Xem nguồn" không khả dụng.

### 4.5 Response
`200 { messageId, scheduled? }`. Lỗi: 400/403 theo bảng §3, 500 khác.

## 5. Quy tắc nội dung (client)
- Composer soạn **HTML**; `text` = `htmlToPlainText(html)`: bỏ style/script, `<br>` → xuống dòng, khối (`p, div, li, h*`…) → xuống dòng, danh sách → `- ` hoặc `1. ` có thụt lề, link → `text (href)` nếu khác (trừ mailto), blockquote → tiền tố `> `, gộp ≥3 dòng trống thành 2.
- Phần trích dẫn nối cuối: `body + <div class="mailflare-quote" data-mailflare-quote="1">…</div>`.
- Chặn gửi khi: không có người nhận ("Add at least one recipient"), địa chỉ không hợp lệ (`"<x>" is not a valid email address`), không có nội dung và không có trích dẫn ("Write a message before sending"; có `<img>` được coi là có nội dung).
- Giới hạn client: ≤10 file, ≤10 MB/file, ≤20 MB tổng (tính cả attachment đã lưu trên nháp).
- Thành công → xoá nháp, reset form, toast "Message sent" / "Message scheduled", phát sự kiện làm mới danh sách.

## 6. Lỗi & biên
| Tình huống | Hiện trạng |
|---|---|
| `EMAIL.send` lỗi | message `failed` — **không hiện ở thư mục nào**, không có nút gửi lại |
| Domain chưa bật sending | `EMAIL.send` lỗi → như trên |
| Gửi tới chính mình (cùng hệ thống) | Cloudflare giao lại qua Email Routing → xuất hiện ở Inbox (bình thường) |
| 51 người nhận | 500 "A message can have at most 50 recipients" (nên trả 400) |
| Worker timeout giữa chừng | message kẹt `queued` |

## 7. Tiêu chí chấp nhận
- [ ] Gửi tới 1 người → dòng `messages` `sent` có `providerMessageId`, xuất hiện trong Sent; `outbound_jobs` `sent`.
- [ ] Người nhận thấy From `"Tên" <addr>`; `send_on_behalf` thấy "X on behalf of Y".
- [ ] `from` không thuộc mailbox → 403.
- [ ] Trùng địa chỉ trong To (khác hoa thường) → chỉ gửi 1 lần.
- [ ] Attachment 11 MB → lỗi, không có dòng message nào còn lại.
- [ ] Reply: người nhận thấy thư nằm cùng hội thoại (header In-Reply-To/References đúng).
