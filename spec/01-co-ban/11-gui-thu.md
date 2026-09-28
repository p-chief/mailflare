# Gửi thư

> **[CƠ BẢN]** · Hẹn giờ gửi → [02-nang-cao/05](../02-nang-cao/05-hen-gio-gui.md) · API key `/api/v1/send` → [02-nang-cao/13](../02-nang-cao/13-api-key-va-rest-v1.md)
> Phụ thuộc: [05-quan-ly-mailbox.md](05-quan-ly-mailbox.md), [00-nen-tang/05-phan-quyen.md](../00-nen-tang/05-phan-quyen.md) · Liên quan: [10-nhap-thu.md](10-nhap-thu.md), [13-hoi-thoai.md](13-hoi-thoai.md)

## 1. Mục tiêu
Gửi thư HTML + text với To/Cc/Bcc và file đính kèm qua binding `send_email` (`EMAIL`), từ một địa chỉ mà người gửi được phép dùng, lưu bản sao vào Sent, giữ đúng hội thoại, và cho phép gửi lại thư lỗi từ Outbox.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Kiểm tra người gửi, chuẩn hoá người nhận, giới hạn | Soạn nội dung (UI — [04-giao-dien/05](../04-giao-dien/05-soan-thu.md)) |
| Lưu message `queued → sent|failed`, outbound job | Theo dõi bounce/delivery status sau khi Cloudflare nhận thư |
| Header threading | DKIM (Cloudflare Email Sending tự ký) |
| Gửi kèm attachment của nháp, xoá nháp sau khi gửi | |
| Outbox và gửi lại thư lỗi | |

## 3. Kiểm tra người gửi — thủ tục `KIEM_TRA_NGUOI_GUI(userId, mailboxId, from)`
```
!mailboxId                                   → "Mailbox is required"                          (400)
mailbox (kèm domain, owner) không có         → "Mailbox not found"                            (403)
actor = users WHERE id; !actor || disabled   → "Sender account not found"                     (403)
access = mức quyền của actor trên mailbox ([00-nen-tang/05](../00-nen-tang/05-phan-quyen.md)); !canSendOnBehalf
                                             → "You do not have permission to send from this mailbox" (403)
requested = phần địa chỉ của from, lowercase
requested ∉ DIA_CHI_HOP_LE(mailbox)
                                             → "Sender address does not match the selected mailbox"   (403)
senderName = mailbox là primary mailbox của owner ? owner.name : mailbox.displayName
canSendAs  → fromAddr = định dạng(requested, senderName)
else       → fromAddr = định dạng(requested, `${actor.name} on behalf of ${senderName || requested}`)
return { fromAddr, mailboxId }
```
- `DIA_CHI_HOP_LE(mailbox)`: địa chỉ chính của mailbox, các alias của nó, và (nếu bật "use all domains") cùng local-part trên các domain khác — định nghĩa ở [05-quan-ly-mailbox.md](05-quan-ly-mailbox.md) và [02-nang-cao/09](../02-nang-cao/09-alias-va-use-all-domains.md).
- "định dạng(addr, name)": có tên → `"<tên đã escape \ và ">" <addr>`; không → `addr` ([00-nen-tang/06 §5](../00-nen-tang/06-quy-uoc-chung.md)).
- Server **tự dựng** tên hiển thị — không tin tên client gửi. Lỗi bất ngờ khác → 500.

## 4. `POST /api/send` (session)
Nhận `multipart/form-data` (composer) hoặc JSON, tổng ≤ **30 MB** (413 nếu vượt, 400 "Invalid send request" nếu body hỏng).

Trường multipart: `from, to, cc, bcc, subject, text, html, mailboxId, inReplyTo, references, threadId, draftId, scheduledAt` (chuỗi rỗng coi như không có) và `attachments` (nhiều File; file rỗng bị bỏ; `type` rỗng → `application/octet-stream`; `disposition: attachment`).

### 4.1 Validate schema (trừ attachments)
| Trường | Quy tắc |
|---|---|
| `from` | 3–500 ký tự |
| `to` | chuỗi ≤5000 **hoặc** mảng ≤50 phần tử (3–500); sau tách: ≥1, ≤50, mỗi phần tử phải có `@` → "Enter valid email addresses" |
| `cc`, `bcc` | như `to` nhưng tuỳ chọn, có thể rỗng |
| `subject` | 1–500 (**bắt buộc**) |
| `html`, `text` | ≤ 2 MB mỗi cái, tuỳ chọn |
| `mailboxId` | 1–200 |
| `inReplyTo`, `threadId` | ≤ 998 |
| `references` | chuỗi ≤5000 hoặc mảng ≤50 → nối bằng khoảng trắng |
| `scheduledAt` | ISO datetime |
Lỗi → 400 `{error: {formErrors, fieldErrors}}` ([00-nen-tang/06 §3](../00-nen-tang/06-quy-uoc-chung.md)).

### 4.2 `draftId`
Nếu có: nháp phải thuộc user (404 "Draft not found"); nạp **nội dung** các attachment của nháp từ R2 và **nối** vào danh sách file upload (giới hạn §4.3 tính trên tổng). Composer gửi `draftId` mỗi khi đang soạn trên một nháp đã lưu. Khi response là 200 (đã gửi hoặc đã hẹn giờ), server xoá nháp ([10-nhap-thu.md §5.7](10-nhap-thu.md)); attachment của thư gửi là bản lưu riêng nên không bị ảnh hưởng.

### 4.3 Thủ tục `GUI_THU(user, input)`
```
sender = KIEM_TRA_NGUOI_GUI(user.id, input.mailboxId, input.from)
KIEM_TRA_ATTACHMENT(attachments)
to/cc/bcc = TACH_NGUOI_NHAN(...)
to rỗng                → 400 NO_RECIPIENTS        "At least one recipient is required"
|to|+|cc|+|bcc| > 50   → 400 TOO_MANY_RECIPIENTS  "A message can have at most 50 recipients"
for addr in to∪cc∪bcc: cập nhật danh bạ (direction 'outbound')                         (NÂNG CAO)
inReplyTo  = chuẩn hoá Message-ID(input.inReplyTo)
references = mảng → chuẩn hoá từng phần tử; chuỗi → tách theo khoảng trắng rồi chuẩn hoá
             (quy tắc Message-ID: [00-nen-tang/06 §7](../00-nen-tang/06-quy-uoc-chung.md))
references > 30 id → giữ id đầu + 29 id cuối
headers = {...input.headers}; inReplyTo → "In-Reply-To: <id>"; references → "References: <a> <b>"
messageId = msg_…; scheduledAt = input.scheduledAt > now ? Date : null
INSERT messages { id, userId, mailboxId: sender.mailboxId, direction:'outbound', fromAddr: sender.fromAddr,
   toAddr: join(to, ", "), ccAddr, bccAddr, subject, snippet, textBody, htmlBody, status:'queued',
   threadId: input.threadId ?? null, inReplyTo, references: refs.join(" ") || null }
try LUU_ATTACHMENT(messageId, attachments) catch → DELETE message (và object đã ghi); throw
INSERT outbound_jobs { id: job_…, userId, messageId, status:'queued',
   payload: JSON({...input, from: sender.fromAddr, to, cc, bcc, mailboxId, headers,
                  attachments: metadata không có content}),
   scheduledAt }
if scheduledAt: đưa vào hàng đợi gửi hẹn giờ; return { messageId, scheduled: true }      (NÂNG CAO)
GIAO_THU(...); return { messageId }
```
- `KIEM_TRA_ATTACHMENT`:
  | Điều kiện | Mã | Thông điệp |
  |---|---|---|
  | > 10 file | `TOO_MANY_ATTACHMENTS` | "A message can have at most 10 attachments" |
  | một file > 10 MB | `ATTACHMENT_TOO_LARGE` | "<name> exceeds the 10 MB attachment limit" |
  | tổng > 20 MB | `ATTACHMENTS_TOO_LARGE` | "Attachments exceed the 20 MB total limit" |
  Tất cả trả **400** `{error, code}` và không để lại dòng `messages` nào.
- `TACH_NGUOI_NHAN`: tách chuỗi header/mảng thành danh sách địa chỉ ([00-nen-tang/06 §5](../00-nen-tang/06-quy-uoc-chung.md)), loại trùng theo địa chỉ lowercase **trong từng trường**, giữ nguyên chuỗi gốc (có tên hiển thị).
- `LUU_ATTACHMENT`: ghi object R2 `attachments/<messageId>/<attId>/<filename>` và dòng `message_attachments` cho từng file.

### 4.4 Thủ tục `GIAO_THU(message, job, input)`
```
res = await env.EMAIL.send({
  from, to: [...], cc?: [...], bcc?: [...], subject,
  headers: headers nếu không rỗng, html, text,
  attachments: a.disposition == 'inline' && a.contentId
      ? { filename, type, content, disposition:'inline', contentId }
      : { filename, type, content, disposition:'attachment' } })
OK:
  UPDATE messages SET status='sent', providerMessageId = res.messageId,
         threadId = input.threadId ?? chuẩn hoá Message-ID(res.messageId) ?? messageId
  UPDATE outbound_jobs SET status='sent', error=null, updatedAt
  gửi webhook 'message.outbound' {messageId, providerMessageId, to, cc?}                     (NÂNG CAO)
  audit 'email.send' {to, cc?, subject}
LỖI:
  UPDATE messages SET status='failed'; UPDATE outbound_jobs SET status='failed', error, updatedAt
  gửi webhook 'message.failed' {messageId, error}                                          (NÂNG CAO)
  → HTTP 502 { error: <thông điệp lỗi>, code: "SEND_FAILED", messageId }
```
**Bản sao Sent không có raw MIME**: MIME thực tế do Cloudflare dựng và ký, hệ thống không nhận lại bản đó, nên thư gửi có `raw_r2_key = null` và "Xem nguồn" trả 404 ([08-doc-thu.md §4.5](08-doc-thu.md)).
**[TÙY CHỌN]** Triển khai có thể tự dựng một bản MIME tương đương (ví dụ bằng mimetext) từ cùng nội dung, lưu ở `sent/<messageId>.eml` và đặt `raw_r2_key`; khi đó "Xem nguồn" hiển thị bản dựng này (không có chữ ký DKIM và Message-ID có thể khác bản Cloudflare gửi đi).

### 4.5 Response
`200 { messageId, scheduled? }`. Lỗi: 400 (validate, §4.3 có `code`), 403 (§3), 404 (nháp), 413, 502 (gửi lỗi), 500 khác.

## 5. Outbox & gửi lại

### 5.1 Outbox
Thư mục ảo **Outbox** liệt kê thư `direction='outbound'` có `status = failed`, hoặc `status = queued` **không** hẹn giờ (đang gửi). Thư `queued` có hẹn giờ thuộc thư mục **Scheduled** ([02-nang-cao/05](../02-nang-cao/05-hen-gio-gui.md)).
- Query danh sách: `GET /api/messages?outbox=true` ([07-danh-sach-dem-thu.md §4.1](07-danh-sach-dem-thu.md)).
- Mỗi dòng hiển thị nhãn trạng thái: `failed` → "Failed" kèm `sendError`; `queued` → "Sending…".
- Thanh điều hướng hiển thị `counts.folders.outbox.failed` (màu đỏ); thư mục Outbox chỉ hiện khi `counts.folders.outbox.total > 0`.
- Hành động trên thư Outbox: **"Gửi lại"** (chuỗi UI: "Retry") cho thư có thể gửi lại (§5.2); "Delete" = bulk `trash` ([09-to-chuc-thu.md](09-to-chuc-thu.md)); "Cancel schedule" nằm ở thư mục Scheduled ([02-nang-cao/05](../02-nang-cao/05-hen-gio-gui.md)).

### 5.2 `POST /api/messages/{id}/retry-send` (session)
```
m = messages WHERE id; !m || m.direction != 'outbound' || m.userId != user.id → 404 "Message not found"
job = outbound_jobs WHERE message_id = m.id ORDER BY created_at DESC LIMIT 1
retryable = m.status == 'failed'
         || (m.status == 'queued' && job && (job.scheduled_at IS NULL || job.scheduled_at <= now)
             && job.updated_at < now − 15 phút)                    // thư kẹt do Worker dừng giữa chừng
!retryable → 409 "This message is not waiting to be resent"
!job → 409 "This message cannot be resent"
payload = JSON(job.payload)
sender = KIEM_TRA_NGUOI_GUI(user.id, m.mailboxId, payload.from)    → 403 nếu mất quyền gửi
attachments = nạp content từ message_attachments của m (R2); object mất → 409 "An attachment is no longer available"
UPDATE messages SET status='queued'; UPDATE outbound_jobs SET status='queued', error=null, updatedAt
GIAO_THU(m, job, {...payload, from: sender.fromAddr, attachments})  // audit 'email.send' thêm {retry:true}
→ 200 { messageId } | 502 { error, code:"SEND_FAILED", messageId }
```
- Chỉ người gửi ban đầu được gửi lại (không phải mọi thành viên mailbox).
- Nội dung, người nhận, header threading lấy nguyên từ `payload` và dòng `messages`; không sửa được khi gửi lại.
- Gửi lại không tạo dòng `messages` mới; thành công → thư rời Outbox, vào Sent.

## 6. Quy tắc nội dung (client)
- Composer soạn **HTML**; `text` = `HTML_SANG_TEXT(html)`: bỏ `style`/`script`, `<br>` → xuống dòng, khối (`p, div, li, h*`…) → xuống dòng, danh sách → `- ` hoặc `1. ` có thụt lề, link → `text (href)` nếu href khác text (trừ `mailto:`), blockquote → tiền tố `> `, gộp ≥3 dòng trống thành 2.
- Phần trích dẫn nối cuối: `body + <div class="app-quote" data-app-quote="1">…</div>`.
- Chặn gửi khi: không có người nhận ("Add at least one recipient"), địa chỉ không hợp lệ (`"<x>" is not a valid email address`), không có nội dung và không có trích dẫn ("Write a message before sending"; có `<img>` được coi là có nội dung).
- Giới hạn client: ≤10 file, ≤10 MB/file, ≤20 MB tổng (tính cả attachment đã lưu trên nháp).
- Thành công → reset form (nháp do server xoá), toast "Message sent" / "Message scheduled", phát sự kiện `app:messages-changed` để làm mới danh sách.
- Lỗi 502 → toast "Message failed to send" kèm nút "View in Outbox".

## 7. Lỗi & biên
| Tình huống | Hành vi |
|---|---|
| `EMAIL.send` lỗi | message `failed`, job `failed` có `error`; hiện trong Outbox với nút "Gửi lại"; response 502 |
| Domain chưa bật sending | `EMAIL.send` lỗi → như trên |
| Gửi tới chính mình (cùng hệ thống) | Cloudflare giao lại qua Email Routing → xuất hiện ở Inbox (bình thường) |
| 51 người nhận | 400 `TOO_MANY_RECIPIENTS` |
| File 11 MB | 400 `ATTACHMENT_TOO_LARGE`, không có dòng message nào còn lại |
| Worker dừng giữa chừng | message kẹt `queued` → sau 15 phút hiển thị trong Outbox dạng gửi lại được |
| Gửi lại thư đã `sent` | 409 |

## 8. Tiêu chí chấp nhận
- [ ] Gửi tới 1 người → dòng `messages` `sent` có `providerMessageId`, xuất hiện trong Sent; `outbound_jobs` `sent`.
- [ ] Người nhận thấy From `"Tên" <addr>`; người có quyền `send_on_behalf` tạo ra "X on behalf of Y".
- [ ] `from` không thuộc mailbox → 403.
- [ ] Trùng địa chỉ trong To (khác hoa thường) → chỉ gửi 1 lần.
- [ ] 51 người nhận → 400 với `code: "TOO_MANY_RECIPIENTS"`.
- [ ] Attachment 11 MB → 400 `ATTACHMENT_TOO_LARGE`, không có dòng message nào còn lại.
- [ ] Reply: người nhận thấy thư nằm cùng hội thoại (header In-Reply-To/References đúng).
- [ ] Giả lập `EMAIL.send` lỗi → thư hiện trong Outbox là "Failed"; bấm "Gửi lại" sau khi sửa domain → thư chuyển sang Sent, cùng `messageId`.
- [ ] Người khác trong shared mailbox gọi `retry-send` thư của tôi → 404.

## 9. Ghi chú triển khai
- Nên gọi `GIAO_THU` trong cùng request để trả kết quả ngay; nếu đẩy sang `OUTBOUND_QUEUE` thì response trả `{messageId, queued:true}` và Outbox hiển thị "Sending…" cho tới khi consumer cập nhật.
- `outbound_jobs.payload` không chứa content attachment; gửi lại luôn đọc content từ R2 theo `message_attachments` của thư.
