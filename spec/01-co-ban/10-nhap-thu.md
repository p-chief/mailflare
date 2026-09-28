# Thư nháp (Drafts) & tự động lưu

> **[CƠ BẢN]** · Liên quan: [11-gui-thu.md](11-gui-thu.md), [12-tra-loi-chuyen-tiep.md](12-tra-loi-chuyen-tiep.md)

## 1. Mục tiêu
Lưu nội dung đang soạn lên server để không mất khi đóng trình duyệt, mở lại để sửa, và làm "vật chứa" attachment cho thư forward.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| CRUD nháp, copy attachment khi forward, xoá attachment nháp | Gửi thư (file gửi) |
| Kiểm tra người gửi khi lưu | Upload attachment mới vào nháp (không hỗ trợ — file mới chỉ đi kèm lúc gửi) |
| Autosave phía client | |

## 3. Dữ liệu
Nháp là một dòng `messages` với `direction='outbound'`, `status='draft'`, `read=true`, `user_id` = người soạn. Attachment nháp nằm trong `message_attachments` như thư thường.

## 4. Quyền
- Tạo/sửa: kiểm tra người gửi `getAuthorizedSenderAddress` (cần `canSendOnBehalf` trên mailbox và `from` thuộc địa chỉ hợp lệ — xem [11-gui-thu.md §3](11-gui-thu.md)). Lỗi → **403** `{error: <thông điệp>}`.
- Đọc/sửa/xoá: `userOwnsDraft(draft, user)` = `draft.user_id == user.id && draft.status == 'draft'` — **không** theo mailbox access. Không thoả → 404 "Draft not found".

## 5. API

### 5.1 `POST /api/drafts` — tạo (≤ 1 MB)
Body:
```json
{ "mailboxId": "mbx_…", "from": "me@x.com", "to": "a@b.com, \"C\" <c@d.com>", "cc": "", "bcc": "",
  "subject": "…", "html": "…", "text": "…",
  "inReplyTo": "id@host", "references": "id1 id2", "threadId": "…",
  "forwardOfMessageId": "msg_…" }
```
```
sender = getDraftSender(user, input)                 → lỗi: 403
if forwardOfMessageId:
   src = messages WHERE id; !src || !canRead(src.mailboxId) → 404 "Message not found"
INSERT messages { id: msg_…, userId, mailboxId: sender.mailboxId, direction:'outbound',
   fromAddr: sender.fromAddr, toAddr: to ?? "", ccAddr: cc || null, bccAddr: bcc || null,
   subject: subject ?? null, snippet: buildSnippet(text||null, html||null),
   textBody: text || null, htmlBody: html || null, status:'draft', read:true,
   inReplyTo: inReplyTo || null, references: references || null, threadId: threadId || null }
attachments = forwardOf ? copyMessageAttachments(src.id, draftId) : []
→ { draft: { id, attachments } }
```
`copyMessageAttachments`: với mỗi attachment nguồn, **copy object R2** sang key mới `attachments/<draftId>/<newAttId>/<filename>` (không chia sẻ object → xoá nháp không ảnh hưởng thư gốc); object nguồn mất → bỏ qua file đó.

### 5.2 `GET /api/drafts[?mailboxId=]`
100 nháp mới nhất của user (`user_id`, outbound, draft), `created_at DESC`. (Danh sách nháp trong UI thường dùng `GET /api/messages?direction=outbound&status=draft` thay vì endpoint này.)

### 5.3 `GET /api/drafts/{id}`
`{ draft: { id, userId, mailboxId, fromAddr, toAddr, ccAddr, bccAddr, subject, inReplyTo, references, threadId, status, textBody, htmlBody, attachments } }`.

### 5.4 `PATCH /api/drafts/{id}` (≤ 1 MB)
Kiểm tra sở hữu (404) → kiểm tra lại người gửi (403) → cập nhật `mailboxId, fromAddr, toAddr, ccAddr, bccAddr, subject, snippet, textBody, htmlBody`. **Không** cập nhật `inReplyTo/references/threadId` (giữ từ lúc tạo). → `{draft:{id}}`.

### 5.5 `DELETE /api/drafts/{id}`
Kiểm tra sở hữu → `deleteMessageWithObjects` (object attachment + raw + dòng). → `{ok:true}`.

### 5.6 `DELETE /api/drafts/{id}/attachments/{attId}`
Kiểm tra sở hữu → xoá dòng + object R2; không thuộc nháp → 404 "Attachment not found". Dùng để bỏ file thừa hưởng từ forward.

## 6. Autosave (client)
- Điều kiện lưu: có `fromAddr` **và** có nội dung: To/Cc/Bcc không rỗng, hoặc subject khác rỗng, hoặc có phần trích dẫn, hoặc body (text thuần) khác rỗng **và** khác chữ ký. Đang tải nháp → không lưu.
- Debounce **900 ms** sau mỗi thay đổi (to, cc, bcc, subject, html, quote, mailbox, chữ ký, threading).
- Chưa có `draftId` → `POST`, có rồi → `PATCH`.
- Payload: `{mailboxId, from, to, cc, bcc (dạng header "a, b"), subject, html: body + quote, text: htmlToPlainText(html), inReplyTo, references, threadId}`.
- **Chống nháp ma**: mỗi lần người dùng xoá/huỷ nháp tăng `draftGeneration`; response POST về muộn thuộc generation cũ → gọi `DELETE` nháp vừa tạo.
- Khi gửi thành công → client `DELETE` nháp (server không tự xoá).

## 7. Tiêu chí chấp nhận
- [ ] Gõ subject rồi chờ 1 s → có nháp trong Drafts; gõ tiếp → cùng id được cập nhật.
- [ ] Mở lại nháp → khôi phục đúng mailbox, From, người nhận, nội dung, attachment đã lưu.
- [ ] Forward thư có 2 file → nháp có 2 attachment với key R2 mới; xoá nháp → file gốc vẫn tải được.
- [ ] User khác gọi `GET /api/drafts/{id}` → 404.
- [ ] Đổi `from` sang địa chỉ không thuộc mailbox → PATCH 403.
