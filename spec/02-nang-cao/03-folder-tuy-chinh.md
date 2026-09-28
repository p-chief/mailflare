# Folder tuỳ chỉnh

> **[NÂNG CAO]** · Phụ thuộc: [01-co-ban/09-to-chuc-thu.md](../01-co-ban/09-to-chuc-thu.md) · Liên quan: [01-rule-mailbox.md](01-rule-mailbox.md), [03-tuy-chon/02-jmap.md](../03-tuy-chon/02-jmap.md)

## 1. Mục tiêu
Cho người dùng tạo thư mục riêng (có màu) trong một mailbox để phân loại thư ngoài các thư mục hệ thống; đổi tên, đổi màu, xoá thư mục.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Liệt kê, tạo, sửa (tên, màu), xoá folder | Folder lồng nhau |
| Chuyển thư vào folder (bulk `folder`, kéo thả, menu "Move to") | Một thư ở nhiều folder (nhãn) |
| Đếm chưa đọc theo folder | Sắp xếp folder thủ công (luôn theo tên) |

## 3. Quyền
| Thao tác | Quyền trên mailbox |
|---|---|
| Liệt kê folder, xem thư trong folder | `canRead` |
| Tạo / sửa / xoá folder, chuyển thư vào/ra folder | `canManage` |
Không đủ quyền → 404 (không lộ sự tồn tại).

## 4. Mô hình
- Bảng `folders` ([00-nen-tang/04-mo-hinh-du-lieu.md §3.1](../00-nen-tang/04-mo-hinh-du-lieu.md)). Folder thuộc **một mailbox**; `user_id` = owner mailbox (không phải người tạo).
- Tên duy nhất trong mailbox (`UNIQUE(mailbox_id, name)`, so sau khi trim).
- Thư trong folder: `status = 'received'` (khi chuyển vào) và `folder_id = X`. Danh sách folder hiển thị **mọi status** có `folder_id = X`.
- Chuyển ra Inbox/Archive/Spam/Trash → `folder_id = null`.
- Xoá folder: xem §5.5 — thư được chuyển về Inbox hoặc Trash theo lựa chọn; rule mailbox trỏ tới folder còn lại với `folder_id = null` (FK SET NULL) và bị bỏ qua khi đánh giá.

Màu (8 lựa chọn, mặc định `#2563eb`): `#2563eb` Blue · `#7c3aed` Purple · `#db2777` Pink · `#dc2626` Red · `#ea580c` Orange · `#d97706` Amber · `#16a34a` Green · `#0d9488` Teal.

## 5. API

### 5.1 `GET /api/folders?mailboxId=` (canRead)
Không `mailboxId` → `{folders: []}`; không quyền → 404 "Mailbox not found". Trả folder của mailbox, sắp theo `name ASC`: `{folders: [{id, userId, mailboxId, name, color, createdAt}]}`.

### 5.2 `POST /api/folders` (canManage)
Body `{ mailboxId, name (trim 1–80), color (một trong 8 màu, mặc định #2563eb) }`. Sai → 400.
Trùng tên → 409 "Folder already exists". → 201 `{id, mailboxId, name, color}`.

### 5.3 `PATCH /api/folders/{id}` (canManage)
Body `{ name?, color? }` — ít nhất một trường (không có → 400 "Nothing to update"); `name` trim 1–80, `color` một trong 8 màu.
```
folder = folders WHERE id               → không có: 404 "Folder not found"
!canManage(folder.mailboxId)             → 404 "Folder not found"
name đổi && đã có folder khác cùng mailbox, cùng tên → 409 "Folder already exists"
UPDATE folders SET name, color
→ { id, mailboxId, name, color }
```
Vi phạm UNIQUE do tranh chấp đồng thời cũng trả 409.

### 5.4 Chuyển thư
- `POST /api/messages/bulk {action:'folder', folderId, messageIds}` — xem [09-to-chuc-thu.md](../01-co-ban/09-to-chuc-thu.md). Cần `canManage` trên mailbox của folder **và** của từng thư; thư thuộc mailbox khác mailbox của folder bị bỏ qua. Kết quả: `status = 'received'`, `folder_id = folderId`.
- Chuyển ra: các action `inbox`/`archive`/`spam`/`trash` đặt `folder_id = null`.

### 5.5 `DELETE /api/folders/{id}?moveTo=inbox|trash` (canManage)
`moveTo` mặc định `inbox`; giá trị khác → 400 "moveTo must be inbox or trash".
```
folder = folders WHERE id; !canManage(folder.mailboxId) → 404 "Folder not found"
moveTo == inbox:
    UPDATE messages SET folder_id = NULL WHERE folder_id = :id
        // thư 'received' về Inbox; thư ở status khác giữ status
moveTo == trash:
    UPDATE messages SET status = 'trash', folder_id = NULL, snoozed_until = NULL WHERE folder_id = :id
DELETE folders WHERE id = :id
→ { ok: true, moved: <số thư bị cập nhật> }
```
Hai câu lệnh chạy trong một batch (giao dịch) để không còn thư trỏ tới folder đã xoá.

## 6. UI
- Mục "Folders" ở sidebar: danh sách folder (chấm màu + số chưa đọc), rỗng → "No folders yet", nút "+" mở dialog "Create folder" (tên, chọn màu).
- Menu ngữ cảnh mỗi folder (chỉ user `canManage`): "Rename" / "Change color" (dialog như tạo, điền sẵn), "Delete folder" → dialog xác nhận "Delete "{name}"?" với lựa chọn "Move emails to Inbox" (mặc định) hoặc "Move emails to Trash".
- Kéo thả thư lên folder ở sidebar → bulk `folder`.
- Menu "Move to" (hover-actions, trang đọc thư, thanh bulk action): Archived, Spam, Trash, dải phân cách, rồi danh sách folder của mailbox (chấm màu + tên); folder đang xem bị ẩn khỏi danh sách.
- Trang `/folders/{id}`: danh sách với tiêu đề = tên folder, rỗng → "No emails in this folder". Folder bị xoá khi đang mở → điều hướng về Inbox.

## 7. JMAP
`Mailbox/set` trên folder dùng đúng các thao tác trên: `update {name}` = §5.3; `destroy` với `onDestroyRemoveEmails: true` = §5.5 `moveTo=trash`; không có cờ đó mà folder còn thư (không tính thư đang snooze) → lỗi `mailboxHasEmail`. Xem [03-tuy-chon/02-jmap.md](../03-tuy-chon/02-jmap.md).

## 8. Tiêu chí chấp nhận
- [ ] Tạo folder trùng tên (sau trim) → 409.
- [ ] Chuyển thư vào folder → biến khỏi Inbox; số unread của folder tăng.
- [ ] Đổi tên folder thành tên đã có → 409; đổi màu → sidebar hiện màu mới.
- [ ] Xoá folder với `moveTo=inbox` → thư về Inbox; với `moveTo=trash` → thư vào Trash; folder biến mất.
- [ ] Rule mailbox trỏ tới folder đã xoá → bị bỏ qua khi nhận thư.
- [ ] Menu "Move to" liệt kê các folder của mailbox; chọn một folder → thư chuyển vào đó.
- [ ] Folder của mailbox A không hiện khi chọn mailbox B.
- [ ] User `read_only` gọi PATCH/DELETE folder → 404.
