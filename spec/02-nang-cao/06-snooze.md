# Tạm ẩn thư (Snooze)

> **[NÂNG CAO]** · Liên quan: [01-co-ban/07-danh-sach-dem-thu.md](../01-co-ban/07-danh-sach-dem-thu.md)

## 1. Mục tiêu
Ẩn một thư khỏi Inbox đến một thời điểm chọn trước; sau đó thư tự xuất hiện lại.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Đặt/bỏ `snoozedUntil` cho thư đến ở Inbox | Thông báo/đẩy thư lên đầu khi hết hạn |
| Thư mục ảo "Snoozed" | Snooze thư đi, thư trong folder |

## 3. Cơ chế
**Không có job đánh thức.** Snooze chỉ là bộ lọc thời gian:
- Inbox loại `snoozed_until > now`.
- Snoozed = `status='received' AND folder_id IS NULL AND snoozed_until > now`.
- Counts: `snoozedUntil > now` → thư mục "snoozed" (ưu tiên cao nhất).
Hết giờ → thư tự nằm lại Inbox ở vị trí theo `created_at` gốc (không nhảy lên đầu).

## 4. API
### `POST /api/messages/{id}/snooze`
Body `{ snoozedUntil: ISO }` — phải parse được và **> now** (không → 400 "Choose a future snooze time").
Thư phải `direction='inbound'` **và** `status='received'` (không → 404), người gọi `canManage`. → `UPDATE snoozed_until` → `{ok:true}`.

### `DELETE /api/messages/{id}/snooze`
Thư inbound, `canManage` → `snoozed_until = null` → `{ok:true}`.

Không audit.

## 5. UI
- Nút đồng hồ trong hover-actions của dòng (chỉ Inbox & Snoozed, thư inbound). Thư đang snooze → nút "Unsnooze".
- Dialog "Snooze email" — "Hide this email from the inbox until the time you choose.":
  | Preset | Giá trị |
  |---|---|
  | Tomorrow (mặc định) | now + 1 ngày (giữ giờ) |
  | Next week | now + 7 ngày |
  | Next month | now + 1 tháng lịch |
  | tuỳ chọn | `datetime-local` (phút) |
- Lỗi: "Unable to snooze message".

## 6. Đề xuất khi viết lại
- Cron mỗi phút/5 phút: thư hết snooze → set `snoozed_until = null`, cập nhật "thời điểm sắp xếp" để nổi lên đầu Inbox, gửi realtime.
- Cho snooze thư trong folder (quay về folder).

## 7. Tiêu chí chấp nhận
- [ ] Snooze tới 10 phút sau → thư biến khỏi Inbox, có trong Snoozed; sau 10 phút có lại trong Inbox.
- [ ] Snooze với thời điểm quá khứ → 400.
- [ ] Snooze thư đã archive → 404.
