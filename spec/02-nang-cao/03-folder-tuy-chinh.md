# Folder tuỳ chỉnh

> **[NÂNG CAO]** · Liên quan: [01-co-ban/09-to-chuc-thu.md](../01-co-ban/09-to-chuc-thu.md), [01-rule-mailbox.md](01-rule-mailbox.md)

## 1. Mục tiêu
Cho người dùng tạo thư mục riêng (có màu) trong một mailbox để phân loại thư ngoài các thư mục hệ thống.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Liệt kê, tạo folder | Folder lồng nhau |
| Chuyển thư vào folder (bulk `folder`, kéo thả) | Một thư ở nhiều folder (nhãn) |
| Đếm chưa đọc theo folder | Sửa/xoá folder qua REST (chỉ có ở JMAP — xem §6) |

## 3. Mô hình
- Folder thuộc **một mailbox**; `user_id` = owner mailbox (không phải người tạo).
- Tên duy nhất trong mailbox (`UNIQUE(mailbox_id, name)`).
- Thư trong folder: `status = 'received'` (khi chuyển vào) và `folder_id = X`. Danh sách folder hiển thị **mọi status** có `folder_id = X`.
- Chuyển ra Inbox/Archive/Spam/Trash → `folder_id = null`.
- Xoá folder (FK SET NULL) → thư trở về Inbox (vì `received` + `folder_id null`).

## 4. API

### 4.1 `GET /api/folders?mailboxId=` (canRead)
Không `mailboxId` → `{folders: []}`; không quyền → 404. Trả folder của mailbox, sắp theo `name ASC`: `{id, userId, mailboxId, name, color, createdAt}`.

### 4.2 `POST /api/folders` (canManage)
Body `{ mailboxId, name (trim 1–80), color (một trong 8 màu, mặc định #2563eb) }`.
Trùng tên → 409 "Folder already exists". → `{id, mailboxId, name, color}`.

Màu: `#2563eb` Blue · `#7c3aed` Purple · `#db2777` Pink · `#dc2626` Red · `#ea580c` Orange · `#d97706` Amber · `#16a34a` Green · `#0d9488` Teal.

### 4.3 Chuyển thư
`POST /api/messages/bulk {action:'folder', folderId, messageIds}` — xem [09-to-chuc-thu.md](../01-co-ban/09-to-chuc-thu.md). Cần canManage trên mailbox của folder **và** của từng thư.

## 5. UI
- Mục "Folders" ở sidebar: danh sách folder (chấm màu + số chưa đọc), rỗng → "No folders yet", nút "+" mở dialog "Create folder" (tên, chọn màu).
- Kéo thả thư từ Inbox lên folder ở sidebar → bulk `folder`. (Menu "Move to" hiện chỉ có Archived/Spam/Trash — nên thêm folder.)
- Trang `/folders/{id}`: danh sách với tiêu đề = tên folder, rỗng → "No emails in this folder".

## 6. Qua JMAP (tham khảo)
JMAP `Mailbox/set` đã có đổi tên và xoá folder (`onDestroyRemoveEmails` → chuyển thư vào Trash; ngược lại folder còn thư không snooze → `mailboxHasEmail`). REST nên bổ sung tương đương:
- `PATCH /api/folders/{id} {name?, color?}` (canManage, kiểm tra trùng tên).
- `DELETE /api/folders/{id}?moveTo=inbox|trash`.

## 7. Tiêu chí chấp nhận
- [ ] Tạo folder trùng tên (sau trim) → 409.
- [ ] Chuyển thư vào folder → biến khỏi Inbox; số unread của folder tăng.
- [ ] Folder của mailbox A không hiện khi chọn mailbox B.
