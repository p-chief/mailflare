# Thư nháp (Drafts) & tự động lưu

> **[CƠ BẢN]** · Liên quan: [11-gui-thu.md](11-gui-thu.md), [12-tra-loi-chuyen-tiep.md](12-tra-loi-chuyen-tiep.md)

## 1. Mục tiêu
Lưu nội dung đang soạn lên server để không mất khi đóng trình duyệt, mở lại để sửa, và làm "vật chứa" attachment cho thư forward.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| CRUD nháp, copy attachment khi forward, xoá attachment nháp | Gửi thư ([11-gui-thu.md](11-gui-thu.md)) |
| Kiểm tra người gửi khi lưu | Upload attachment mới vào nháp (file mới chỉ đi kèm lúc gửi) |
| Autosave phía client | |
| Xoá nháp tự động khi gửi thành công | |

## 3. Dữ liệu
Nháp là một dòng `messages` với `direction='outbound'`, `status='draft'`, `read=true`, `user_id` = người soạn. Attachment nháp nằm trong `message_attachments` như thư thường.

## 4. Quyền
- **Tạo/sửa**: kiểm tra người gửi theo thủ tục `KIEM_TRA_NGUOI_GUI` ([11-gui-thu.md §3](11-gui-thu.md)): cần `canSendOnBehalf` trên mailbox và `from` thuộc tập địa chỉ hợp lệ của mailbox. Lỗi → **403** `{error: <thông điệp>}`.
- **Đọc/sửa/xoá/liệt kê**: nháp là **của riêng người soạn**. Điều kiện sở hữu `SO_HUU_NHAP(draft, user)` = `draft.user_id == user.id && draft.status == 'draft'` — **không** xét quyền chia sẻ mailbox. Không thoả → 404 "Draft not found".
- Mọi danh sách nháp — `GET /api/drafts` **và** thư mục Drafts qua `GET /api/messages?direction=outbound&status=draft` — luôn thêm điều kiện `user_id = user.id`; thành viên khác của shared mailbox không thấy nháp của nhau.

## 5. API

### 5.1 `POST /api/drafts` — tạo (body ≤ 1 MB)
Body:
```json
{ "mailboxId": "mbx_…", "from": "me@x.com", "to": "a@b.com, \"C\" <c@d.com>", "cc": "", "bcc": "",
  "subject": "…", "html": "…", "text": "…",
  "inReplyTo": "id@host", "references": "id1 id2", "threadId": "…",
  "forwardOfMessageId": "msg_…" }
```
```
sender = KIEM_TRA_NGUOI_GUI(user, mailboxId, from)        → lỗi: 403
if forwardOfMessageId:
   src = messages WHERE id; !src || !canRead(src.mailboxId) → 404 "Message not found"
INSERT messages { id: msg_…, userId, mailboxId: sender.mailboxId, direction:'outbound',
   fromAddr: sender.fromAddr, toAddr: to ?? "", ccAddr: cc || null, bccAddr: bcc || null,
   subject: subject ?? null, snippet: SNIPPET(text || null, html || null),
   textBody: text || null, htmlBody: html || null, status:'draft', read:true,
   inReplyTo: inReplyTo || null, references: references || null, threadId: threadId || null }
attachments = forwardOf ? SAO_CHEP_ATTACHMENT(src.id, draftId) : []
→ { draft: { id, attachments } }
```
- `SNIPPET(text, html)`: quy tắc tạo snippet ở [00-nen-tang/06 §8](../00-nen-tang/06-quy-uoc-chung.md).
- `SAO_CHEP_ATTACHMENT(srcId, draftId)`: với mỗi attachment của thư nguồn, **copy object R2** sang key mới `attachments/<draftId>/<newAttId>/<filename>` và tạo dòng `message_attachments` mới (cùng `filename`, `content_type`, `size`, `disposition`, `content_id`). Không chia sẻ object → xoá nháp không ảnh hưởng thư gốc. Object nguồn mất → bỏ qua file đó.

### 5.2 `GET /api/drafts[?mailboxId=]`
100 nháp mới nhất **của user hiện tại** (`user_id = user.id`, `direction='outbound'`, `status='draft'`, lọc thêm `mailbox_id` nếu có), `created_at DESC`. Response `{ drafts: [ {id, mailboxId, fromAddr, toAddr, subject, snippet, createdAt} ] }`.

### 5.3 `GET /api/drafts/{id}`
`{ draft: { id, userId, mailboxId, fromAddr, toAddr, ccAddr, bccAddr, subject, inReplyTo, references, threadId, status, textBody, htmlBody, attachments } }`.

### 5.4 `PATCH /api/drafts/{id}` (body ≤ 1 MB)
Kiểm tra sở hữu (404) → kiểm tra lại người gửi (403) → cập nhật `mailboxId, fromAddr, toAddr, ccAddr, bccAddr, subject, snippet, textBody, htmlBody`. **Không** cập nhật `inReplyTo/references/threadId` (giữ từ lúc tạo). → `{draft:{id}}`.

### 5.5 `DELETE /api/drafts/{id}`
Kiểm tra sở hữu → xoá object attachment + raw (nếu có) + dòng, theo thủ tục `XOA_VINH_VIEN` ([09-to-chuc-thu.md §7.1](09-to-chuc-thu.md)). → `{ok:true}`.

### 5.6 `DELETE /api/drafts/{id}/attachments/{attId}`
Kiểm tra sở hữu → xoá dòng + object R2; attachment không thuộc nháp → 404 "Attachment not found". Dùng để bỏ file thừa hưởng từ forward.

### 5.7 Xoá nháp khi gửi
Khi `POST /api/send` có `draftId` và trả **200** (đã gửi hoặc đã hẹn giờ), **server** xoá nháp đó (`XOA_VINH_VIEN`) sau khi thư gửi và attachment của nó đã được lưu thành dòng/object riêng ([11-gui-thu.md §4.2](11-gui-thu.md)). Lỗi khi xoá nháp chỉ được log, không làm hỏng response gửi. Gửi thất bại (4xx/5xx) → nháp được giữ nguyên để người dùng sửa và gửi lại.

## 6. Autosave (client)
- Điều kiện lưu: có `fromAddr` **và** có nội dung: To/Cc/Bcc không rỗng, hoặc subject khác rỗng, hoặc có phần trích dẫn, hoặc body (dạng text thuần) khác rỗng **và** khác chữ ký. Đang tải nháp → không lưu.
- Debounce **900 ms** sau mỗi thay đổi (to, cc, bcc, subject, html, quote, mailbox, chữ ký, threading).
- Chưa có `draftId` → `POST`, có rồi → `PATCH`.
- Payload: `{mailboxId, from, to, cc, bcc (dạng header "a, b"), subject, html: body + quote, text: <html chuyển sang text thuần theo [11-gui-thu.md §5](11-gui-thu.md)>, inReplyTo, references, threadId}`.
- **Chống nháp ma**: client giữ một bộ đếm "thế hệ nháp", tăng mỗi lần người dùng xoá/huỷ nháp; response `POST` về muộn thuộc thế hệ cũ → gọi `DELETE` nháp vừa tạo.
- Không lưu tự động trong lúc đang gửi (tránh `PATCH` chạy song song với việc server xoá nháp); sau khi gửi thành công client chỉ reset form, không cần gọi `DELETE`.

## 7. Lỗi & biên
| Tình huống | Hành vi |
|---|---|
| Body > 1 MB | 413 |
| `PATCH` nháp đã bị xoá / đã gửi | 404 "Draft not found" → client bỏ `draftId`, lần lưu sau tạo nháp mới |
| Forward thư mà người dùng mất quyền đọc | 404 "Message not found" |
| Người soạn mất quyền gửi trên mailbox sau khi tạo nháp | `PATCH` 403; nháp vẫn đọc/xoá được |

## 8. Tiêu chí chấp nhận
- [ ] Gõ subject rồi chờ 1 s → có nháp trong Drafts; gõ tiếp → cùng id được cập nhật.
- [ ] Mở lại nháp → khôi phục đúng mailbox, From, người nhận, nội dung, attachment đã lưu.
- [ ] Forward thư có 2 file → nháp có 2 attachment với key R2 mới; xoá nháp → file gốc vẫn tải được.
- [ ] User khác gọi `GET /api/drafts/{id}` → 404.
- [ ] Thành viên khác của shared mailbox không thấy nháp của tôi trong Drafts.
- [ ] Đổi `from` sang địa chỉ không thuộc mailbox → PATCH 403.
- [ ] Gửi thành công với `draftId` → nháp biến khỏi Drafts mà client không gọi `DELETE`; attachment của thư đã gửi vẫn tải được.
- [ ] Gửi thất bại với `draftId` → nháp còn nguyên.
