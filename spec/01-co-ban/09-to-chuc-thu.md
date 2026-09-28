# Tổ chức thư: trạng thái, gắn sao, thao tác hàng loạt

> **[CƠ BẢN]** · Folder tuỳ chỉnh → [02-nang-cao/03](../02-nang-cao/03-folder-tuy-chinh.md) · Snooze → [02-nang-cao/06](../02-nang-cao/06-snooze.md) · Huấn luyện spam → [02-nang-cao/11](../02-nang-cao/11-bo-loc-spam.md)
> Phụ thuộc: [00-nen-tang/03-thuat-ngu-trang-thai.md](../00-nen-tang/03-thuat-ngu-trang-thai.md), [00-nen-tang/05-phan-quyen.md](../00-nen-tang/05-phan-quyen.md)

## 1. Mục tiêu
Di chuyển thư giữa các thư mục ảo (Inbox/Archive/Spam/Trash/folder), đánh dấu đọc/chưa đọc, gắn sao — cho một thư hoặc nhiều thư/cả hội thoại một lúc.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Đổi `status`, `folderId`, `read`, `starred` | Xoá vĩnh viễn (chưa có — khuyến nghị bổ sung, §6) |
| Bulk action theo danh sách id | Tạo folder, rule |
| Audit các thay đổi | Logic huấn luyện spam (gọi sang file spam) |

## 3. `POST /api/messages/bulk` (session) — API chính, UI dùng cả cho thao tác đơn
Body `{ messageIds: string[], action, folderId? }`.

### 3.1 Bảng hành động
| `action` | `status` mới | `read` | `folderId` | Quyền trên mailbox của từng thư |
|---|---|---|---|---|
| `archive` | `archived` | – | `null` | canManage |
| `trash` | `trash` | – | `null` | canManage |
| `spam` | *(xử lý qua huấn luyện spam: status `spam`, folder `null`)* | – | `null` | canManage |
| `inbox` | `received`; thư đang `spam` → huấn luyện **ham** | – | `null` | canManage |
| `folder` | `received` | – | `folderId` | canManage (thư) + canManage (mailbox của folder) |
| `read` | – | `true` | – | canRead |
| `unread` | – | `false` | – | canRead |

### 3.2 Luồng
```
ids = messageIds.filter(Boolean); ids rỗng hoặc action không hợp lệ → 400 "Invalid bulk message action"
if action == folder:
    !folderId → 400 "Folder is required"
    folder = folders WHERE id → không có: 404 "Folder not found"
    !canManage(folder.mailboxId) → 404 "Folder not found"
values = {status?, read?, folderId?}; rỗng → 400 "No changes requested"
selected = messages WHERE id IN ids
allowed = selected.filter(m => m.mailboxId && quyền theo bảng)
allowed rỗng → 404 "No accessible messages"
action == spam  → for id in allowed: applySpamFeedback(id, 'spam'); return {ok}
action == inbox → spamIds = allowed có status 'spam' → applySpamFeedback(id,'ham')
                  còn lại → UPDATE values; return {ok}
khác → UPDATE messages SET values WHERE id IN allowed
       audit từng thư: action = (read|unread) ? 'email.read' : 'email.delete', metadata {bulkAction}
→ {ok:true}
```
Thư không có quyền bị **bỏ qua im lặng** (không báo lỗi riêng).

> Lỗ hổng cần vá khi viết lại: `folder` không kiểm tra folder cùng mailbox với thư → thư mailbox A có thể mang `folderId` của mailbox B. Thêm điều kiện `folder.mailboxId == message.mailboxId`.
> Nếu bỏ bộ lọc spam (MVP): `spam` = set `status='spam', folderId=null`; `inbox` = set `received`.

## 4. `POST /api/messages/{id}/status` (canManage)
Body `{ status }` ∈ `received | sent | draft | trash | spam` (khác → 400 "Invalid message status").
- `spam` → `applySpamFeedback(spam)`.
- `received` khi thư đang `spam` → `applySpamFeedback(ham)`.
- còn lại → `UPDATE status` (không đổi folderId), audit `email.delete {status}`.
- Không quyền/không tồn tại → 404 "Message not found". Thành công `{success:true}`.

Lưu ý: endpoint này cho phép set `sent`/`draft` cho thư bất kỳ — nên thu hẹp còn `received|archived|trash|spam` khi viết lại.

## 5. `POST /api/messages/{id}/star` (canRead)
Toggle: `starred = !starred`. Trả `{ starred }`. Không audit.

## 6. Xoá vĩnh viễn (chưa có — khuyến nghị)
Hàm có sẵn `deleteMessageWithObjects(env, db, id, rawR2Key)`:
1. xoá mọi object R2 của attachment (`message_attachments.r2_key`);
2. xoá raw (`raw_r2_key`) nếu có;
3. `DELETE messages` (attachment rows cascade; FTS trigger tự xoá index).

Đề xuất:
- `DELETE /api/messages/{id}` và bulk action `delete` — chỉ cho thư đang ở `trash`/`spam`, cần canManage.
- "Empty trash" theo mailbox.
- Cron xoá Trash/Spam cũ hơn N ngày (cấu hình).

## 7. Audit
| Hành động | `audit_logs.action` | metadata |
|---|---|---|
| read/unread (bulk) | `email.read` | `{bulkAction}` |
| archive/trash/folder (bulk) | `email.delete` | `{bulkAction}` |
| status đơn | `email.delete` | `{status}` |
| spam/ham | `email.spam_feedback` | `{classification}` |

(Tên `email.delete` cho mọi thay đổi trạng thái là lịch sử; khi viết lại nên đặt `email.move`.)

## 8. Tiêu chí chấp nhận
- [ ] Archive 3 thư trong đó 1 thư thuộc mailbox không có quyền → 2 thư đổi, thư còn lại giữ nguyên, `{ok:true}`.
- [ ] Chuyển thư vào folder → biến khỏi Inbox, hiện ở folder; archive lại → `folderId = null`.
- [ ] `read_only` trên shared mailbox: `read`/`unread`/star được; `archive` → 404 "No accessible messages".
- [ ] Mỗi thay đổi (trừ star) có dòng audit.
- [ ] "Not spam" một thư spam → về Inbox, có dòng `spam_feedback` = ham.
