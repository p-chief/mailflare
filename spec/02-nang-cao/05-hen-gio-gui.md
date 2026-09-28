# Hẹn giờ gửi (Scheduled send)

> **[NÂNG CAO]** · Phụ thuộc: [01-co-ban/11-gui-thu.md](../01-co-ban/11-gui-thu.md) · Dùng `OUTBOUND_QUEUE` · Liên quan: [01-co-ban/07-danh-sach-dem-thu.md](../01-co-ban/07-danh-sach-dem-thu.md)

## 1. Mục tiêu
Cho phép chọn thời điểm gửi trong tương lai; hệ thống giữ thư và tự gửi khi tới giờ. Người dùng xem được các thư đang hẹn và huỷ hẹn (thư trở lại thành nháp để sửa hoặc gửi lại).

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| `scheduledAt` trên `/api/send` và `/api/v1/send` | Gửi chính xác tới giây (độ trễ queue vài giây) |
| Chuỗi delay qua queue, không giới hạn độ xa | Lặp lại định kỳ (gửi hằng tuần…) |
| Thư mục "Scheduled", huỷ hẹn (`unschedule`) | Sửa trực tiếp thư đang hẹn — sửa = huỷ hẹn → sửa nháp → hẹn lại |
| Gửi attachment từ R2 lúc tới giờ; kiểm tra lại quyền người gửi lúc tới giờ | |

## 3. Quyền
| Thao tác | Điều kiện |
|---|---|
| Hẹn giờ | như gửi thư thường (`canSendOnBehalf` trên mailbox — [11-gui-thu.md §3](../01-co-ban/11-gui-thu.md)) |
| Xem thư đang hẹn | `canRead` trên mailbox của thư |
| Huỷ hẹn | người tạo thư (`messages.user_id`) **hoặc** `canManage` trên mailbox của thư |

## 4. Dữ liệu
- `messages.status = 'queued'` trong lúc chờ.
- `outbound_jobs.scheduled_at` = thời điểm hẹn (null với thư gửi ngay).
- `outbound_jobs.status`: `queued` → `sending` → `sent` | `failed`; hoặc `queued` → `cancelled` (huỷ hẹn). `sending` là trạng thái "đã nhận quyền gửi" để huỷ hẹn và gửi không tranh chấp nhau.
- `payload` của job chứa input gửi đã chuẩn hoá (người nhận, nội dung, headers, `inReplyTo`, `references`, `threadId`, metadata attachment) — **không** chứa nội dung attachment; bytes nằm ở R2 dưới message.

## 5. Luồng

### 5.1 Tạo
```
POST /api/send {…, scheduledAt: ISO}
  thủ tục gửi thư (11-gui-thu §4.3): scheduledAt > now → message 'queued', job 'queued' với scheduled_at
  XEP_LICH_GUI(job):
     delaySeconds = clamp(ceil((scheduledAt - now)/1000), 1, 86400)
     OUTBOUND_QUEUE.send({ kind:"email.scheduled", jobId, messageId, scheduledAt: ISO }, { delaySeconds })
  → { messageId, scheduled: true }
```
`scheduledAt ≤ now` → gửi ngay (không lỗi).

### 5.2 Xử lý khi message queue tới (`kind = "email.scheduled"`)
```
job = outbound_jobs WHERE id = jobId
!job || job.status != 'queued' → ack, return            // đã gửi, đã huỷ, hoặc đang gửi: idempotent
scheduledAt > now → XEP_LICH_GUI(job) (bước tối đa 24 h) → ack, return
claimed = UPDATE outbound_jobs SET status='sending', updated_at=now
          WHERE id = jobId AND status = 'queued'          // nguyên tử: thắng tranh chấp với huỷ hẹn
claimed == 0 → ack, return
input = JSON.parse(job.payload)
KIỂM TRA LẠI QUYỀN NGƯỜI GỬI (11-gui-thu §3) với userId = job.user_id, from = input.from, mailboxId:
   lỗi → message 'failed'; job 'failed', error = thông điệp lỗi (vd "You do not have permission to send from this mailbox")
         webhook message.failed {messageId, error}; ack, return      // không retry
   ok  → from = địa chỉ + tên hiển thị dựng lại lúc gửi
dựng lại headers In-Reply-To / References từ input
attachments = đọc bytes từng attachment của message từ R2
gửi qua binding EMAIL như gửi thường (11-gui-thu §4.4) → 'sent' / 'failed'
```
- Mọi lỗi sau khi đã `claimed` được bắt và chuyển job + message sang `failed` (kèm webhook `message.failed`); không để job kẹt ở `sending`.
- Queue giao lại cùng message (at-least-once) → job không còn `queued` → bỏ qua, không gửi lần 2.

### 5.3 Huỷ hẹn — `POST /api/messages/{id}/unschedule`
```
msg = messages WHERE id AND direction = 'outbound'      → không có / không quyền (§3): 404 "Message not found"
msg.status != 'queued'                                  → 409 "This message is no longer scheduled"
n = UPDATE outbound_jobs SET status='cancelled', updated_at=now
    WHERE message_id = msg.id AND status = 'queued' AND scheduled_at IS NOT NULL
n == 0                                                  → 409 "This message is already being sent"
UPDATE messages SET status='draft', read=true WHERE id = msg.id
audit 'email.unschedule' {messageId}
→ { ok: true, draftId: msg.id }
```
- Thư trở thành nháp giữ nguyên người nhận, tiêu đề, nội dung, attachment (đã ở R2), `inReplyTo`/`references`/`threadId` → mở composer để sửa rồi gửi hoặc hẹn lại (gửi với `draftId`).
- Message queue còn đang chờ trong hàng đợi sẽ thấy job `cancelled` và bỏ qua.

### 5.4 Thư mục "Scheduled"
- `GET /api/messages?scheduled=true` (phạm vi mailbox như danh sách thường; định nghĩa tham số ở [01-co-ban/07 §4.1](../01-co-ban/07-danh-sach-dem-thu.md)):
  ```
  direction = 'outbound' AND status = 'queued'
  AND EXISTS (SELECT 1 FROM outbound_jobs j WHERE j.message_id = messages.id
              AND j.status = 'queued' AND j.scheduled_at IS NOT NULL)
  ORDER BY j.scheduled_at ASC
  ```
  Mỗi dòng có thêm `scheduledAt`.
- `GET /api/messages/counts` có thêm bucket `scheduled` (`total`; không có unread).
- Thư `queued` **không** hẹn giờ (đang gửi) và thư `failed` thuộc thư mục Outbox ([01-co-ban/11 §5](../01-co-ban/11-gui-thu.md)); hai thư mục không chồng lấn.

## 6. Quy tắc
- Thời điểm hẹn tối thiểu ở UI là now + 5 phút; API chấp nhận mọi thời điểm (quá khứ → gửi ngay).
- Không giới hạn độ xa; mỗi bước delay tối đa 86 400 s (giới hạn delay của Cloudflare Queues), nên thư hẹn N ngày đi qua ~N lần xếp lại.
- Gửi lỗi lúc tới giờ → `failed` + webhook `message.failed`; lỗi hạ tầng khiến consumer ném trước bước claim → queue retry sau 10 s (tối đa 3 lần).
- Huỷ hẹn không gửi webhook.

## 7. UI
Menu cạnh nút Send:
| Lựa chọn | Thời điểm |
|---|---|
| Later today | now + 3 giờ |
| Tomorrow morning | ngày mai 08:00 giờ địa phương |
| Monday morning | thứ Hai kế tiếp 08:00 (đang là thứ Hai → thứ Hai tuần sau): `days = ((8 − weekday) % 7) \|\| 7` |
| Pick date & time | `datetime-local`, `min = now + 5 phút` |
| Clear schedule | khi đã chọn |
Khi đã chọn: nút đổi thành "Schedule"; thành công → toast "Message scheduled".

Thư mục "Scheduled" ở sidebar (dưới Sent, kèm số lượng; ẩn khi bằng 0):
- Dòng hiển thị người nhận, tiêu đề và "Scheduled for <ngày giờ địa phương>" thay cho ngày tạo; rỗng → "No scheduled emails".
- Mở thư: banner "This message will be sent on <ngày giờ>." với nút "Cancel send" → gọi §5.3 → toast "Scheduling cancelled. The message is now a draft." và mở composer với nháp.
- 409 → toast thông điệp lỗi và làm mới danh sách.

## 8. Lỗi & biên
| Tình huống | Kết quả |
|---|---|
| Người gửi bị thu hồi quyền / mailbox bị disable trước giờ gửi | Thư `failed` với lý do quyền, không gửi |
| Attachment trên R2 bị mất lúc tới giờ | Gửi lỗi → `failed` ("Attachment content is missing") |
| Huỷ đúng lúc đang gửi | Một trong hai thắng nhờ cập nhật có điều kiện; huỷ thua → 409 |
| Message bị xoá khi đang hẹn | Job `message_id` null → bỏ qua khi tới giờ |

## 9. Tiêu chí chấp nhận
- [ ] Hẹn 2 phút → thư ở `queued` và hiện trong "Scheduled"; sau ~2 phút thành `sent`, có trong Sent, biến khỏi "Scheduled".
- [ ] Hẹn 3 ngày → queue nhận 3 chuỗi delay 24 h rồi gửi đúng ngày.
- [ ] Attachment của thư hẹn được gửi đầy đủ.
- [ ] Queue giao lại message sau khi đã gửi → không gửi lần 2.
- [ ] Huỷ hẹn → job `cancelled`, thư thành nháp giữ attachment; tới giờ cũ không có gì được gửi.
- [ ] Huỷ hẹn thư đã gửi → 409.
- [ ] Thu hồi quyền `send_on_behalf` của user B trên shared mailbox sau khi B hẹn thư → tới giờ thư `failed`, không gửi.
