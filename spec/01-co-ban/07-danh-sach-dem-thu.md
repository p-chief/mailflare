# Danh sách thư & đếm chưa đọc

> **[CƠ BẢN]** · Conversation view (`group=thread`) là **[NÂNG CAO]** → [13-hoi-thoai.md](13-hoi-thoai.md) · Tìm kiếm → [14-tim-kiem.md](14-tim-kiem.md)
> Phụ thuộc: [00-nen-tang/05-phan-quyen.md](../00-nen-tang/05-phan-quyen.md) · Liên quan: [02-nang-cao/03-folder-tuy-chinh.md](../02-nang-cao/03-folder-tuy-chinh.md), [02-nang-cao/06-snooze.md](../02-nang-cao/06-snooze.md)

## 1. Mục tiêu
Hiển thị thư theo thư mục ảo/folder, phân trang, kèm tên liên hệ và số lượng chưa đọc cho thanh điều hướng.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| `GET /api/messages` (lọc, phân trang, làm giàu) | Nội dung đầy đủ (file đọc thư) |
| `GET /api/messages/counts` | Thay đổi trạng thái (file tổ chức) |
| Ánh xạ thư mục → tham số | Snooze (NÂNG CAO) — chỉ phần lọc được mô tả ở đây |

## 3. Phạm vi truy cập
`accessible` = tập id mailbox user có quyền `canRead` ([00-nen-tang/05](../00-nen-tang/05-phan-quyen.md)). Mọi truy vấn thư lọc theo `mailbox_id`, **không** theo `user_id`. `accessible` rỗng → kết quả rỗng (`messages: []`, `total: 0`; counts toàn 0).

## 4. `GET /api/messages` (session)

### 4.1 Tham số
| Tham số | Hành vi |
|---|---|
| `mailboxId` | Kiểm tra `canRead` (không → **404** "Mailbox not found"); `mailbox_id = ?` |
| *(không mailboxId)* | `mailbox_id IN (accessible)` |
| `direction` | `inbound` \| `outbound` (giá trị khác bị bỏ qua) |
| `status` | một giá trị hoặc danh sách phân tách dấu phẩy (`status=queued,failed` → `status IN (…)`); giá trị ngoài tập status hợp lệ → 400 |
| `folderId` | Folder phải tồn tại và `folders.mailbox_id ∈ accessible` (và `= mailboxId` nếu có tham số đó); không thoả → **404** "Folder not found". Sau đó `folder_id = ?` |
| `status=received` **và không** `folderId` | thêm `folder_id IS NULL` **và** `(snoozed_until IS NULL OR snoozed_until <= now)` |
| `starred=true` | `starred = 1` |
| `snoozed=true` | `status='received' AND folder_id IS NULL AND snoozed_until > now` |
| `scheduled=true` | `direction='outbound' AND status='queued' AND EXISTS (SELECT 1 FROM outbound_jobs j WHERE j.message_id = messages.id AND j.status = 'queued' AND j.scheduled_at IS NOT NULL)`; sắp `scheduled_at ASC`, mỗi dòng thêm `scheduledAt` — [02-nang-cao/05](../02-nang-cao/05-hen-gio-gui.md) |
| `outbox=true` | `direction='outbound' AND (status='failed' OR (status='queued' AND NOT EXISTS (SELECT 1 FROM outbound_jobs j WHERE j.message_id = messages.id AND j.status = 'queued' AND j.scheduled_at IS NOT NULL)))`; mỗi dòng thêm `sendError` (từ `outbound_jobs.error`) — [11-gui-thu.md §5](11-gui-thu.md) |
| `status=draft` | luôn thêm `user_id = user.id`: nháp chỉ hiện với người tạo, kể cả trong shared mailbox |
| `read=read` / `read=unread` | `read = 1` / `read = 0` |
| `q` | điều kiện tìm kiếm FTS (xem file tìm kiếm) |
| `title` | tương đương thêm `subject:"<title>"` vào `q` |
| `limit` | mặc định 50, tối đa 100 (lớn hơn → 100) |
| `offset` | ≥ 0 |
| `group=thread` | conversation view (bỏ qua khi `status=draft`) |

Sắp xếp `COALESCE(sort_at, created_at) DESC` (`sort_at` — [02-nang-cao/06-snooze.md](../02-nang-cao/06-snooze.md)), trừ `scheduled=true`. `total` = `COUNT(*)` (hoặc `COUNT(DISTINCT coalesce(thread_id, id))` khi nhóm).

### 4.2 Ánh xạ thư mục (client)
| Thư mục | Query |
|---|---|
| Inbox | `direction=inbound&status=received` |
| Starred | `starred=true` (mọi status, mọi direction) |
| Snoozed | `snoozed=true` |
| Sent | `direction=outbound&status=sent` |
| Scheduled | `scheduled=true` |
| Outbox | `outbox=true` |
| Drafts | `direction=outbound&status=draft` (chỉ nháp của chính user) |
| Archived / Spam / Trash | `status=archived` / `spam` / `trash` |
| Folder X | `folderId=X` (không status → mọi status) |

Mọi thư mục cộng thêm `mailboxId` (mailbox đang chọn) và bộ lọc tìm kiếm/đọc.

### 4.3 Làm giàu mỗi dòng
| Trường thêm | Cách tính |
|---|---|
| (bỏ) `rawR2Key` | **không bao giờ** trả ra client |
| `snippet` | tính lại từ `textBody`/`htmlBody` theo quy tắc snippet ([00-nen-tang/06 §8](../00-nen-tang/06-quy-uoc-chung.md)); rỗng → giữ `snippet` đã lưu |
| `fromContactName` | thư **outbound** → tên mailbox (primary mailbox của chính user → `user.name`; khác → `displayName ?? localPart`); nếu null → tên danh bạ của `from` (danh bạ của `message.userId`) |
| `toContactName` | tên danh bạ của người nhận **đầu tiên** |
| `threadCount` | số thư cùng `threadId` trong phạm vi (loại `draft`,`trash`), tối thiểu 1 |
| `threadUnread` | số thư chưa đọc trong các thư trên |
| `threadMessageIds` | chỉ khi `group=thread` |

Tên danh bạ và số liệu thread được lấy bằng truy vấn gộp cho cả trang (một truy vấn cho mọi địa chỉ, một truy vấn `GROUP BY thread_id` cho mọi thread của trang), không truy vấn theo từng dòng.

Response `{ messages, total, limit, offset, grouped }`.

## 5. `GET /api/messages/counts[?mailboxId=]` (session)
Phạm vi giống danh sách (`mailboxId` không có quyền → 404 "Mailbox not found"). Đếm hoàn toàn trong SQL bằng **một truy vấn** `GROUP BY` — không tải từng dòng thư về Worker:

```sql
SELECT mailbox_id,
       folder_id,
       CASE
         WHEN snoozed_until > :now                                          THEN 'snoozed'
         WHEN status = 'trash'                                              THEN 'trash'
         WHEN status = 'spam'                                               THEN 'spam'
         WHEN status = 'archived'                                           THEN 'archived'
         WHEN direction = 'inbound'  AND status = 'received' AND folder_id IS NULL THEN 'inbox'
         WHEN direction = 'outbound' AND status = 'sent'                    THEN 'sent'
         WHEN direction = 'outbound' AND status = 'draft' AND user_id = :userId THEN 'drafts'
         WHEN direction = 'outbound' AND status = 'failed'                  THEN 'outbox'
         WHEN direction = 'outbound' AND status = 'queued'
              AND EXISTS (SELECT 1 FROM outbound_jobs j WHERE j.message_id = messages.id AND j.status = 'queued' AND j.scheduled_at IS NOT NULL) THEN 'scheduled'
         WHEN direction = 'outbound' AND status = 'queued'                  THEN 'outbox'
         ELSE NULL                           -- nháp của người khác, received trong folder…
       END AS folder,
       COUNT(*)                                                             AS total,
       SUM(CASE WHEN direction = 'inbound' AND read = 0 THEN 1 ELSE 0 END)   AS unread,
       SUM(CASE WHEN starred = 1 THEN 1 ELSE 0 END)                          AS starred_total,
       SUM(CASE WHEN starred = 1 AND direction = 'inbound' AND read = 0 THEN 1 ELSE 0 END) AS starred_unread
FROM messages
WHERE mailbox_id IN (:accessible)            -- hoặc mailbox_id = :mailboxId
GROUP BY mailbox_id, folder_id, folder;
```
Số dòng kết quả bị chặn bởi (số mailbox × số folder × 10), nên cộng dồn ở ứng dụng là rẻ:
- `folders[folder]` += `{total, unread}` với mọi dòng có `folder` khác null;
- `folders.starred` += `{starred_total, starred_unread}` với mọi dòng (đếm độc lập với thư mục);
- `customFolders[folder_id]` += `{total, unread}` với mọi dòng có `folder_id` khác null (kể cả status khác);
- `mailboxes[mailbox_id]` += `total`, `unread`; `inbox` += `total` của dòng có `folder = 'inbox'`.

Kết quả:
```json
{ "counts": {
   "folders": { "inbox":{"total":10,"unread":3}, "starred":{…}, "snoozed":{…}, "sent":{…},
                "drafts":{…}, "scheduled":{…}, "outbox":{"total":2,"failed":1}, "archived":{…}, "spam":{…}, "trash":{…} },
   "customFolders": { "<folderId>": {"total":4,"unread":1} },
   "mailboxes": [ { "mailboxId":"mbx_…", "total":50, "unread":7, "inbox":20 } ] } }
```
- Thư mục chưa có thư vẫn xuất hiện với `{total:0, unread:0}`.
- Chưa đọc = thư **inbound** có `read = 0`. `outbox` có thêm `failed` = số thư `status='failed'` (thêm `SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END)` vào truy vấn).
- Nav hiển thị **unread** của mỗi thư mục.
- Truy vấn dùng index `(mailbox_id)`; `:now` là Unix giây.

## 6. Lỗi & biên
| Tình huống | Kết quả |
|---|---|
| `mailboxId` không có quyền | 404 "Mailbox not found" |
| `folderId` thuộc mailbox không có quyền, hoặc không tồn tại | 404 "Folder not found" |
| `folderId` thuộc mailbox khác `mailboxId` đã truyền | 404 "Folder not found" |
| User không có mailbox nào | Danh sách rỗng, counts toàn 0 |
| `limit=500` | Trả tối đa 100 |

## 7. Tiêu chí chấp nhận
- [ ] Inbox không chứa thư đã vào folder, đang snooze, archived/spam/trash, hay thư đi.
- [ ] Snooze thư → biến khỏi Inbox, xuất hiện ở Snoozed; quá giờ → tự quay lại Inbox mà không cần job.
- [ ] `mailboxId` của mailbox không có quyền → 404.
- [ ] `folderId` của folder thuộc mailbox người khác → 404, không lộ thư.
- [ ] Response không bao giờ chứa `rawR2Key`.
- [ ] Số unread Inbox = số thư inbound, received, không folder, không snooze, `read=0`.
- [ ] `/api/messages/counts` thực thi một truy vấn đếm duy nhất bất kể số thư.
- [ ] `limit=500` → trả tối đa 100.
