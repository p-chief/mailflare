# Tổ chức thư: trạng thái, gắn sao, thao tác hàng loạt, xoá vĩnh viễn

> **[CƠ BẢN]** · Folder tuỳ chỉnh → [02-nang-cao/03](../02-nang-cao/03-folder-tuy-chinh.md) · Snooze → [02-nang-cao/06](../02-nang-cao/06-snooze.md) · Huấn luyện spam → [02-nang-cao/11](../02-nang-cao/11-bo-loc-spam.md)
> Phụ thuộc: [00-nen-tang/03-thuat-ngu-trang-thai.md](../00-nen-tang/03-thuat-ngu-trang-thai.md), [00-nen-tang/05-phan-quyen.md](../00-nen-tang/05-phan-quyen.md)

## 1. Mục tiêu
Di chuyển thư giữa các thư mục ảo (Inbox/Archive/Spam/Trash/folder), đánh dấu đọc/chưa đọc, gắn sao, và xoá vĩnh viễn thư trong Trash/Spam — cho một thư hoặc nhiều thư/cả hội thoại một lúc; tự dọn Trash/Spam quá hạn.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Đổi `status`, `folderId`, `read`, `starred` | Tạo folder, rule |
| Bulk action theo danh sách id | Logic huấn luyện spam (gọi sang [02-nang-cao/11](../02-nang-cao/11-bo-loc-spam.md)) |
| Xoá vĩnh viễn (đơn, hàng loạt, Empty trash, tự dọn theo lịch) | Khôi phục thư đã xoá vĩnh viễn |
| Audit các thay đổi | |

## 3. Dữ liệu
Ngoài các cột trong [00-nen-tang/04 §2.5](../00-nen-tang/04-mo-hinh-du-lieu.md), bảng `messages` có thêm:

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `trashed_at` | ts null | thời điểm thư chuyển vào `trash` hoặc `spam`; về `null` khi thư rời hai trạng thái đó |

Index `(status, trashed_at)` phục vụ tự dọn.

Quy tắc ghi `trashed_at` áp dụng cho **mọi** đường đổi status (bulk, status đơn, huấn luyện spam, rule mailbox, bộ lọc spam khi nhận thư):
- status mới ∈ {`trash`, `spam`} và status cũ ∉ {`trash`, `spam`} → `trashed_at = now`;
- trash ↔ spam → giữ `trashed_at` cũ;
- status mới khác → `trashed_at = null`.

Thư nhận vào thẳng Spam (bộ lọc hoặc rule) có `trashed_at = created_at`.

## 4. `POST /api/messages/bulk` (session) — API chính, UI dùng cả cho thao tác đơn
Body `{ messageIds: string[], action, folderId? }`.

### 4.1 Bảng hành động
| `action` | `status` mới | `read` | `folderId` | Quyền trên mailbox của từng thư | Điều kiện thêm |
|---|---|---|---|---|---|
| `archive` | `archived` | – | `null` | canManage | |
| `trash` | `trash` | – | `null` | canManage | |
| `spam` | `spam` (qua huấn luyện spam) | – | `null` | canManage | |
| `inbox` | `received`; thư đang `spam` → huấn luyện **ham** | – | `null` | canManage | |
| `folder` | `received` | – | `folderId` | canManage | `folder.mailboxId == message.mailboxId` |
| `read` | – | `true` | – | canRead | |
| `unread` | – | `false` | – | canRead | |
| `delete` | *(xoá vĩnh viễn, §7)* | – | – | canManage | `status ∈ {trash, spam}` |

### 4.2 Luồng
```
ids = messageIds.filter(Boolean); ids rỗng hoặc action không hợp lệ → 400 "Invalid bulk message action"
if action == folder:
    !folderId → 400 "Folder is required"
    folder = folders WHERE id → không có: 404 "Folder not found"
    !canManage(folder.mailboxId) → 404 "Folder not found"
values = {status?, read?, folderId?} theo bảng; action ≠ delete và rỗng → 400 "No changes requested"
selected = messages WHERE id IN ids
allowed = selected.filter(m => m.mailboxId && quyền theo bảng && điều kiện thêm theo bảng)
allowed rỗng → 404 "No accessible messages"
action == delete → for m in allowed: XOA_VINH_VIEN(m); audit email.delete_permanent; return {ok:true, deleted:n}
action == spam   → for m in allowed: HUAN_LUYEN_SPAM(m, 'spam'); return {ok:true}
action == inbox  → spamIds = allowed có status 'spam' → HUAN_LUYEN_SPAM(m, 'ham')
                   còn lại → UPDATE values (+ trashed_at theo §3); audit email.move; return {ok:true}
khác → UPDATE messages SET values (+ trashed_at theo §3) WHERE id IN allowed
       audit từng thư: action ∈ {read, unread} ? 'email.read' : 'email.move', metadata {bulkAction}
→ {ok:true}
```
- Thư không có quyền hoặc không thoả điều kiện thêm bị **bỏ qua im lặng** (không báo lỗi riêng).
- `HUAN_LUYEN_SPAM(m, 'spam'|'ham')`: thủ tục ghi nhận phản hồi spam/ham và đặt status (`spam` → `status='spam', folderId=null`; `ham` → `status='received', folderId=null`), định nghĩa đầy đủ ở [02-nang-cao/11 §8](../02-nang-cao/11-bo-loc-spam.md). Triển khai không có bộ lọc spam (MVP): `spam` chỉ đặt `status='spam', folderId=null`; `inbox` chỉ đặt `status='received', folderId=null`.
- Mọi `UPDATE` và audit của một request chạy trong một batch D1.

## 5. `POST /api/messages/{id}/status` (canManage)
Body `{ status }` ∈ `received | archived | trash | spam` (khác, kể cả `sent`/`draft`/`queued`/`failed` → 400 "Invalid message status").
- `spam` → `HUAN_LUYEN_SPAM(spam)`.
- `received` khi thư đang `spam` → `HUAN_LUYEN_SPAM(ham)`.
- còn lại → `UPDATE status, folderId = null, trashed_at` (theo §3), audit `email.move {status}`.
- Thư outbound (`sent`) chỉ được chuyển sang `archived`/`trash`; chuyển về `received` → 400 "Invalid message status".
- Không quyền/không tồn tại → 404 "Message not found". Thành công `{success:true}`.

## 6. `POST /api/messages/{id}/star` (canRead)
Toggle: `starred = !starred`. Trả `{ starred }`. Không audit.

## 7. Xoá vĩnh viễn

### 7.1 Thủ tục `XOA_VINH_VIEN(message)`
```
keys  = message_attachments.r2_key WHERE message_id = message.id
raw   = message.raw_r2_key
       (chỉ xoá raw nếu không còn dòng messages nào khác có cùng raw_r2_key)
DELETE FROM messages WHERE id = message.id        // attachment rows cascade; trigger FTS tự xoá index
BUCKET.delete([...keys, raw?])                    // lỗi R2 → log, không làm hỏng request
```
Thứ tự **xoá dòng trước, xoá object sau**: nếu bước R2 lỗi chỉ để lại object mồ côi (vô hại), không bao giờ để lại thư trỏ tới file đã mất. Xoá dòng `messages` cascade xoá dòng attachment nhưng **không** xoá object R2 — phải thu thập key trước khi xoá dòng.

Các bảng tham chiếu thư (`audit_logs.message_id`, `outbound_jobs.message_id`) dùng `SET NULL`; `spam_feedback` của thư bị xoá cùng (thống kê token đã cộng không bị trừ lại).

### 7.2 `DELETE /api/messages/{id}` (canManage)
```
m = messages WHERE id; !m || !m.mailboxId || !canManage → 404 "Message not found"
m.status ∉ {trash, spam} → 409 "Move the message to Trash before deleting it permanently"
XOA_VINH_VIEN(m); audit email.delete_permanent {status: m.status}
→ {ok:true}
```
Nháp không đi qua endpoint này (dùng `DELETE /api/drafts/{id}`, [10-nhap-thu.md](10-nhap-thu.md)).

### 7.3 Bulk `delete`
Như §4: chỉ xoá thư có `status ∈ {trash, spam}` và canManage; thư khác bỏ qua im lặng. Tối đa **500** id mỗi request (vượt → 400 "Too many messages"). Response `{ok:true, deleted}`.

### 7.4 Empty trash — `POST /api/mailboxes/{id}/empty-trash` (canManage)
Body tuỳ chọn `{ status: "trash" | "spam" }` (mặc định `trash`; giá trị khác → 400 "Invalid message status").
```
!canManage(mailbox) → 404 "Mailbox not found"
lặp theo lô 100:
   batch = messages WHERE mailbox_id = ? AND status = ? ORDER BY created_at LIMIT 100
   for m in batch: XOA_VINH_VIEN(m)
audit email.delete_permanent {mailboxId, status, count, emptyTrash: true}   // một dòng cho cả lệnh
→ {ok:true, deleted}
```
Nếu vượt ngân sách thời gian của request (vd > 20 s) → dừng, trả `{ok:true, deleted, remaining:true}`; client gọi lại cho đến khi `remaining` vắng mặt. UI hỏi xác nhận: "Permanently delete all messages in Trash? This cannot be undone."

### 7.5 Tự dọn theo lịch (cron)
- Biến cấu hình `TRASH_RETENTION_DAYS` (số nguyên, mặc định **30**; `0` = tắt tự dọn).
- Handler `scheduled` chạy hằng ngày (cùng cron trigger với backup hoặc cron riêng, vd `0 3 * * *`):
```
cutoff = now − TRASH_RETENTION_DAYS ngày
lặp theo lô 100 đến khi hết hoặc hết ngân sách thời gian (vd 25 s):
   batch = messages WHERE status IN ('trash','spam') AND coalesce(trashed_at, created_at) < cutoff LIMIT 100
   for m in batch: XOA_VINH_VIEN(m)
log JSON {job:"trash-purge", deleted, remaining}
```
- Phần còn lại được xử lý ở lần chạy sau. Không ghi audit từng thư; ghi một dòng audit hệ thống `email.delete_permanent {purge:true, count}` (actor null) nếu `count > 0`.
- Trang Trash/Spam hiển thị dòng chú thích: "Messages in Trash are deleted after {TRASH_RETENTION_DAYS} days."

## 8. Audit
| Hành động | `audit_logs.action` | metadata |
|---|---|---|
| read/unread (bulk), mở thư | `email.read` | `{bulkAction}` |
| archive/trash/inbox/folder (bulk) | `email.move` | `{bulkAction}` |
| status đơn | `email.move` | `{status}` |
| spam/ham | `email.spam_feedback` | `{classification}` |
| xoá vĩnh viễn (đơn, bulk) | `email.delete_permanent` | `{status}` hoặc `{bulkAction:"delete"}` |
| Empty trash | `email.delete_permanent` | `{mailboxId, status, count, emptyTrash:true}` |
| tự dọn | `email.delete_permanent` | `{purge:true, count}` |

## 9. Lỗi & biên
| Tình huống | Hành vi |
|---|---|
| Bulk `folder` với folder thuộc mailbox khác thư | thư đó bị bỏ qua; không thư nào hợp lệ → 404 "No accessible messages" |
| Bulk `delete` trên thư ở Inbox | bỏ qua im lặng |
| `DELETE` thư ở Inbox | 409 |
| Object R2 đã mất khi xoá vĩnh viễn | bỏ qua, dòng vẫn bị xoá |
| Thư xoá vĩnh viễn đang được client khác mở | request tiếp theo của client đó nhận 404 |
| `TRASH_RETENTION_DAYS` không phải số nguyên ≥ 0 | dùng mặc định 30, log cảnh báo |

## 10. Tiêu chí chấp nhận
- [ ] Archive 3 thư trong đó 1 thư thuộc mailbox không có quyền → 2 thư đổi, thư còn lại giữ nguyên, `{ok:true}`.
- [ ] Chuyển thư vào folder → biến khỏi Inbox, hiện ở folder; archive lại → `folderId = null`.
- [ ] Bulk `folder` với folder của mailbox B cho thư của mailbox A → thư A không đổi.
- [ ] `read_only` trên shared mailbox: `read`/`unread`/star được; `archive` → 404 "No accessible messages".
- [ ] `POST /status {status:"sent"}` → 400.
- [ ] Mỗi thay đổi (trừ star) có dòng audit với tên action đúng bảng §8.
- [ ] "Not spam" một thư spam → về Inbox, có dòng `spam_feedback` = ham.
- [ ] `DELETE` thư trong Trash → dòng `messages`, dòng attachment, object attachment và raw trên R2 đều biến mất; tìm kiếm không còn trả thư đó.
- [ ] `DELETE` thư trong Inbox → 409, thư không đổi.
- [ ] Empty trash mailbox A không đụng tới Trash của mailbox B.
- [ ] Thư chuyển vào Trash 31 ngày trước (với `TRASH_RETENTION_DAYS=30`) bị cron xoá; thư vào Trash hôm qua (dù `created_at` 1 năm trước) được giữ.

## 11. Ghi chú triển khai
- D1 giới hạn số tham số mỗi câu lệnh; chia `IN (…)` thành lô ≤ 90 id.
- `BUCKET.delete` nhận mảng tới 1000 key mỗi lần gọi.
