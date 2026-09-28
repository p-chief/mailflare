# Hẹn giờ gửi (Scheduled send)

> **[NÂNG CAO]** · Phụ thuộc: [01-co-ban/11-gui-thu.md](../01-co-ban/11-gui-thu.md) · Dùng `OUTBOUND_QUEUE`

## 1. Mục tiêu
Cho phép chọn thời điểm gửi trong tương lai; hệ thống giữ thư và tự gửi khi tới giờ.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi (chưa có) |
|---|---|
| `scheduledAt` trên `/api/send` và `/api/v1/send` | Huỷ / sửa thư đã hẹn |
| Chuỗi delay qua queue, không giới hạn xa | Danh sách "Scheduled" trong UI |
| Gửi lại attachment từ R2 lúc tới giờ | Gửi chính xác tới giây (độ trễ queue) |

## 3. Luồng
```
POST /api/send {…, scheduledAt: ISO}
  sendEmail: scheduledAt > now → message status 'queued', outbound_jobs status 'queued', scheduled_at
  enqueueScheduledDelivery:
     delaySeconds = clamp(ceil((scheduledAt - now)/1000), 1, 86400)
     OUTBOUND_QUEUE.send({ kind:"email.scheduled", jobId, messageId, scheduledAt: ISO }, { delaySeconds })
  → { messageId, scheduled: true }

Worker.queue → processOutboundQueue(payload):
  job = outbound_jobs WHERE id = jobId
  !job || job.status != 'queued' → return (ack)          // idempotent, cũng là "điểm huỷ" tiềm năng
  input = JSON.parse(job.payload)                        // người nhận/nội dung đã chuẩn hoá lúc tạo
  dựng lại headers In-Reply-To/References
  scheduledAt > now → enqueue lại (bước tối đa 24 h) → return
  attachments = loadMessageAttachmentContents(messageId) // đọc bytes từ R2
  deliverEmail(...)                                       // như gửi thường
```
`scheduledAt ≤ now` khi gửi → gửi ngay (không lỗi).

## 4. Quy tắc
- Quyền người gửi được kiểm tra **lúc tạo**, không kiểm tra lại lúc gửi (người dùng bị thu hồi quyền vẫn gửi được thư đã hẹn — nên kiểm tra lại).
- `payload` không chứa nội dung attachment; nội dung nằm ở R2 dưới message.
- Trong thời gian chờ, thư ở `queued` — **không hiện ở thư mục nào** (counts coi là null).
- Gửi lỗi lúc tới giờ → `failed` + webhook `message.failed`; consumer ném → queue retry 10 s (tối đa 3) — khi retry, job đã `failed` nên bị bỏ qua.

## 5. UI
Menu cạnh nút Send:
| Lựa chọn | Thời điểm |
|---|---|
| Later today | now + 3 giờ |
| Tomorrow morning | ngày mai 08:00 giờ địa phương |
| Monday morning | thứ Hai kế tiếp 08:00 (đang là thứ Hai → thứ Hai tuần sau): `days = ((8 − weekday) % 7) || 7` |
| Pick date & time | `datetime-local`, `min = now + 5 phút` |
| Clear schedule | khi đã chọn |
Khi đã chọn: nút đổi thành "Schedule"; thành công → toast "Message scheduled".

## 6. Đề xuất bổ sung khi viết lại
- Thư mục "Scheduled" = `direction=outbound AND status='queued' AND job.scheduled_at > now`.
- Huỷ: `POST /api/messages/{id}/unschedule` → job `status='cancelled'`, message → `draft`.
- Kiểm tra lại quyền người gửi lúc tới giờ.

## 7. Tiêu chí chấp nhận
- [ ] Hẹn 2 phút → thư ở `queued`, sau ~2 phút thành `sent`, có trong Sent.
- [ ] Hẹn 3 ngày → queue nhận 3 chuỗi delay 24 h rồi gửi đúng ngày.
- [ ] Attachment của thư hẹn được gửi đầy đủ.
- [ ] Queue giao lại message sau khi đã gửi → không gửi lần 2.
