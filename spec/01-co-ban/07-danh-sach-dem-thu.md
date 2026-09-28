# Danh sách thư & đếm chưa đọc

> **[CƠ BẢN]** · Conversation view (`group=thread`) là **[NÂNG CAO]** → [13-hoi-thoai.md](13-hoi-thoai.md) · Tìm kiếm → [14-tim-kiem.md](14-tim-kiem.md)
> Phụ thuộc: [00-nen-tang/05-phan-quyen.md](../00-nen-tang/05-phan-quyen.md)

## 1. Mục tiêu
Hiển thị thư theo thư mục ảo/folder, phân trang, kèm tên liên hệ và số lượng chưa đọc cho thanh điều hướng.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| `GET /api/messages` (lọc, phân trang, làm giàu) | Nội dung đầy đủ (file đọc thư) |
| `GET /api/messages/counts` | Thay đổi trạng thái (file tổ chức) |
| Ánh xạ thư mục → tham số | Snooze (NÂNG CAO) — chỉ phần lọc được mô tả ở đây |

## 3. `GET /api/messages` (session)

### 3.1 Tham số
| Tham số | Hành vi |
|---|---|
| `mailboxId` | Kiểm tra `canRead` (không → **404** "Mailbox not found"); `mailbox_id = ?` |
| *(không mailboxId)* | `mailbox_id IN (accessible)`; nếu user không có mailbox nào → `user_id = user.id` |
| `direction` | `inbound` \| `outbound` (giá trị khác bị bỏ qua) |
| `status` | so khớp chính xác |
| `folderId` | `folder_id = ?` (**không** kiểm tra folder thuộc mailbox được phép — phạm vi mailbox vẫn giới hạn kết quả) |
| `status=received` **và không** `folderId` | thêm `folder_id IS NULL` **và** `(snoozed_until IS NULL OR snoozed_until <= now)` |
| `starred=true` | `starred = 1` |
| `snoozed=true` | `status='received' AND folder_id IS NULL AND snoozed_until > now` |
| `read=read` / `read=unread` | `read = 1` / `read = 0` |
| `q` | điều kiện tìm kiếm FTS (xem file tìm kiếm) |
| `title` | tương đương thêm `subject:"<title>"` vào `q` |
| `limit` | mặc định 50, tối đa 100 |
| `offset` | ≥ 0 |
| `group=thread` | conversation view (bỏ qua khi `status=draft`) |

Sắp xếp `created_at DESC`. `total` = `COUNT(*)` (hoặc `COUNT(DISTINCT coalesce(thread_id, id))` khi nhóm).

### 3.2 Ánh xạ thư mục (client)
| Thư mục | Query |
|---|---|
| Inbox | `direction=inbound&status=received` |
| Starred | `starred=true` (mọi status, mọi direction) |
| Snoozed | `snoozed=true` |
| Sent | `direction=outbound&status=sent` |
| Drafts | `direction=outbound&status=draft` |
| Archived / Spam / Trash | `status=archived` / `spam` / `trash` |
| Folder X | `folderId=X` (không status → mọi status) |
Mọi thư mục cộng thêm `mailboxId` (mailbox đang chọn) và bộ lọc tìm kiếm/đọc.

### 3.3 Làm giàu mỗi dòng
| Trường thêm | Cách tính |
|---|---|
| (bỏ) `rawR2Key` | **không bao giờ** trả ra client |
| `snippet` | tính lại `buildSnippet(textBody, htmlBody) || snippet cũ` |
| `fromContactName` | thư **outbound** → tên mailbox (primary mailbox của chính user → `user.name`; khác → `displayName ?? localPart`); nếu null → tên danh bạ của `from` (danh bạ của `message.userId`) |
| `toContactName` | tên danh bạ của người nhận **đầu tiên** |
| `threadCount` | số thư cùng `threadId` trong phạm vi (loại `draft`,`trash`), tối thiểu 1 |
| `threadUnread` | số thư chưa đọc trong các thư trên |
| `threadMessageIds` | chỉ khi `group=thread` |

Response `{ messages, total, limit, offset, grouped }`.

## 4. `GET /api/messages/counts[?mailboxId=]` (session)
Phạm vi giống danh sách. Lấy các cột `mailboxId, folderId, direction, status, read, starred, snoozedUntil` của **mọi** thư trong phạm vi rồi tính:

```
folderOf(row) =
  snoozedUntil > now                          → "snoozed"
  status == trash                             → "trash"
  status == spam                              → "spam"
  status == archived                          → "archived"
  inbound && received && !folderId            → "inbox"
  outbound && sent                            → "sent"
  outbound && draft                           → "drafts"
  otherwise                                   → null   (queued, failed, received+folder…)
unread(row) = direction == inbound && !read
```
Kết quả:
```json
{ "counts": {
   "folders": { "inbox":{"total":10,"unread":3}, "starred":{…}, "snoozed":{…}, "sent":{…},
                "drafts":{…}, "archived":{…}, "spam":{…}, "trash":{…} },
   "customFolders": { "<folderId>": {"total":4,"unread":1} },
   "mailboxes": [ { "mailboxId":"mbx_…", "total":50, "unread":7, "inbox":20 } ] } }
```
- `starred` đếm độc lập với thư mục.
- `customFolders` đếm mọi thư có `folderId` (kể cả status khác).
- Nav hiển thị **unread** của mỗi thư mục.

> Hiệu năng: bản gốc tải mọi dòng về Worker. Viết lại nên dùng `SELECT … SUM(CASE …) … GROUP BY`.

## 5. Tiêu chí chấp nhận
- [ ] Inbox không chứa thư đã vào folder, đang snooze, archived/spam/trash, hay thư đi.
- [ ] Snooze thư → biến khỏi Inbox, xuất hiện ở Snoozed; quá giờ → tự quay lại Inbox mà không cần job.
- [ ] `mailboxId` của mailbox không có quyền → 404.
- [ ] Response không bao giờ chứa `rawR2Key`.
- [ ] Số unread Inbox = số thư inbound, received, không folder, không snooze, `read=0`.
- [ ] `limit=500` → trả tối đa 100.
