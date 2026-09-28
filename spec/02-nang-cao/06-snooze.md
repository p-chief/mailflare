# Tạm ẩn thư (Snooze)

> **[NÂNG CAO]** · Phụ thuộc: [01-co-ban/07-danh-sach-dem-thu.md](../01-co-ban/07-danh-sach-dem-thu.md) · Liên quan: [04-realtime.md](04-realtime.md), [00-nen-tang/02-kien-truc-cloudflare.md](../00-nen-tang/02-kien-truc-cloudflare.md) (cron)

## 1. Mục tiêu
Ẩn một thư khỏi Inbox đến một thời điểm chọn trước; sau đó thư tự xuất hiện lại (và, với cron đánh thức, nổi lên đầu Inbox).

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Đặt/bỏ `snoozed_until` cho thư đến ở Inbox | Snooze thư đi, thư trong folder, thư Archive/Spam/Trash |
| Thư mục ảo "Snoozed" | Snooze cả hội thoại như một đơn vị (mỗi thư snooze riêng) |
| [NÂNG CAO] Cron đánh thức: đẩy thư lên đầu Inbox + thông báo realtime (§6) | Web Push khi tab đóng |

## 3. Quyền
`canManage` trên mailbox của thư (đặt và bỏ snooze). Xem thư mục Snoozed: `canRead`.

## 4. Cơ chế cơ bản — bộ lọc thời gian
Việc ẩn/hiện **không phụ thuộc** job nào; đúng giờ là thư hiện lại ngay cả khi cron chậm hoặc không chạy:
- Inbox loại `snoozed_until > now`.
- Snoozed = `status='received' AND folder_id IS NULL AND snoozed_until > now`.
- Counts: `snoozed_until > now` → bucket "snoozed" (ưu tiên cao nhất khi phân bucket).
- Hết giờ mà chưa được cron đánh thức → thư nằm lại Inbox ở vị trí theo thời điểm sắp xếp hiện có.

## 5. API
### 5.1 `POST /api/messages/{id}/snooze`
Body `{ snoozedUntil: ISO }` — phải parse được và **> now** (không → 400 "Choose a future snooze time").
Thư phải `direction='inbound'` **và** `status='received'` **và** `folder_id IS NULL` (không → 404 "Message not found"), người gọi `canManage`. → `UPDATE snoozed_until` → `{ok:true}`.

### 5.2 `DELETE /api/messages/{id}/snooze`
Thư inbound, `canManage` → `snoozed_until = null` → `{ok:true}`. Thư không snooze → vẫn `{ok:true}` (idempotent).

Chuyển thư khỏi Inbox (archive/spam/trash/folder) khi đang snooze → `snoozed_until = null` cùng lúc đổi status.

Không ghi audit.

## 6. [NÂNG CAO] Cron đánh thức
### 6.1 Dữ liệu bổ sung
Cột `messages.sort_at` (ts null). Mọi danh sách thư sắp theo `COALESCE(sort_at, created_at) DESC` (index `(mailbox_id, sort_at)`); thư chưa từng được đánh thức có `sort_at = null` nên thứ tự không đổi.

### 6.2 Lịch & thủ tục
- Cron trigger `*/5 * * * *` (cùng handler `scheduled` với backup; phân biệt theo biểu thức cron của sự kiện).
- Thủ tục `DANH_THUC_SNOOZE(now)`:
```
lặp tối đa 50 lô / lần chạy (lô 90 id — D1 giới hạn 100 tham số bind mỗi câu lệnh):
    ids = SELECT id FROM messages
          WHERE snoozed_until IS NOT NULL AND snoozed_until <= :now
            AND status = 'received' AND folder_id IS NULL
          LIMIT 90
    ids rỗng → dừng
    rows = UPDATE messages SET snoozed_until = NULL, sort_at = :now
           WHERE id IN (:ids) AND snoozed_until IS NOT NULL AND snoozed_until <= :now
           RETURNING id, mailbox_id, subject
    theo từng mailbox trong rows:
        người nhận = NGUOI_NHAN_THONG_BAO(mailboxId)        // 04-realtime.md §5
        gửi {type:"snooze_expired", messageId, mailboxId, subject} cho từng người (settled, lỗi chỉ log)
```
- Cập nhật có điều kiện `snoozed_until <= now` nên hai lần chạy chồng nhau không thông báo trùng; người dùng bỏ snooze thủ công trước đó → thư không được "đánh thức".
- Thư đánh thức **không** đổi trạng thái `read`.
- Lỗi cron chỉ log; lần chạy sau xử lý tiếp (cơ chế §4 vẫn đảm bảo thư hiện lại).

## 7. UI
- Nút đồng hồ trong hover-actions của dòng (chỉ Inbox & Snoozed, thư inbound). Thư đang snooze → nút "Unsnooze".
- Dialog "Snooze email" — "Hide this email from the inbox until the time you choose.":
  | Preset | Giá trị |
  |---|---|
  | Tomorrow (mặc định) | now + 1 ngày (giữ giờ) |
  | Next week | now + 7 ngày |
  | Next month | now + 1 tháng lịch |
  | tuỳ chọn | `datetime-local` (phút) |
- Dòng trong Snoozed hiển thị "Snoozed until <ngày giờ>".
- Lỗi: "Unable to snooze message".

## 8. Tiêu chí chấp nhận
- [ ] Snooze tới 10 phút sau → thư biến khỏi Inbox, có trong Snoozed; sau 10 phút có lại trong Inbox.
- [ ] Snooze với thời điểm quá khứ → 400.
- [ ] Snooze thư đã archive hoặc thư trong folder → 404.
- [ ] [NÂNG CAO] Thư snooze hết hạn → trong ≤ 5 phút nằm đầu Inbox (dù `created_at` cũ); tab đang mở làm mới danh sách qua sự kiện `snooze_expired`.
- [ ] [NÂNG CAO] Bỏ snooze thủ công trước hạn → cron không gửi thông báo cho thư đó.
