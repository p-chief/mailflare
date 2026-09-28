# Lịch (Calendar) & mẫu thư (Templates)

> **[TÙY CHỌN]** · Phụ thuộc: [01-co-ban/11-gui-thu.md](../01-co-ban/11-gui-thu.md) · Liên quan: [04-giao-dien/00-ban-do-man-hinh.md](../04-giao-dien/00-ban-do-man-hinh.md)

## 1. Mục tiêu
- Cho user lưu sự kiện cá nhân và gửi thư mời lịch (iCalendar) tới khách mời từ một mailbox của mình.
- Dành sẵn chỗ trong schema cho mẫu thư.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| CRUD sự kiện của chính user | Lịch chia sẻ, CalDAV |
| Gửi thư mời `METHOD:REQUEST` khi tạo/sửa, `METHOD:CANCEL` khi xoá | Nhận và xử lý phản hồi RSVP (`METHOD:REPLY`) |
| Sự kiện một lần (không lặp) | Sự kiện lặp (`RRULE`), nhắc nhở |
| | Chức năng mẫu thư (bảng dành sẵn, §7) |

## 3. Quyền
- Sự kiện thuộc **user** (`user_id`), không theo quyền mailbox: chỉ chủ sự kiện đọc/sửa/xoá.
- Gửi thư mời cần quyền gửi (≥ `send_on_behalf`) trên `mailboxId` và `from` phải là địa chỉ gửi hợp lệ của mailbox đó; không đủ quyền → 403 "You cannot send from this mailbox".

## 4. Dữ liệu
`calendar_events(id evt_…, user_id, mailbox_id?, title, description "", location "", attendees JSON [], starts_at, ends_at, created_at, updated_at)`, index `(user_id, starts_at)`. Thời điểm lưu dạng ISO 8601 UTC.

## 5. API (phiên đăng nhập)
| Method | Path | Hành vi |
|---|---|---|
| GET | `/api/calendar/events?start&end` | `start` mặc định now, `end` mặc định start + 31 ngày; trả sự kiện có `start ≤ startsAt < end`, sắp `starts_at` tăng → `{events}` |
| POST | `/api/calendar/events` | `{title, description?, location?, attendees?[], startsAt, endsAt, mailboxId?, from?}` → `{event, invitationErrors}` |
| PATCH | `/api/calendar/events/{id}` | cùng shape (mọi trường tuỳ chọn); không đổi được `mailboxId`; không phải của mình → 404 → `{event, invitationErrors}` |
| DELETE | `/api/calendar/events/{id}` | xoá; có khách mời và mailbox → gửi thư huỷ; không thấy → 404 → `{ok: true, invitationErrors}` |

Validate:
- `title` trim không rỗng, `startsAt`/`endsAt` là ISO 8601 **có múi giờ** (`Z` hoặc `±hh:mm`), `endsAt > startsAt` → sai: 400 "Enter a title and valid event times".
- Mỗi attendee trim, lowercase, khớp `^\S+@\S+\.\S+$`; sai → 400 `"<x>" is not a valid email address`; trùng lặp bị gộp; tối đa 50 → vượt: 400 "An event can have at most 50 attendees".
- Client chuyển giá trị ô ngày giờ cục bộ sang ISO có offset trước khi gửi.

## 6. Thư mời
### 6.1 Khi nào gửi
| Thao tác | Điều kiện | Tiêu đề | Nội dung text | METHOD |
|---|---|---|---|---|
| POST | có attendee **và** `mailboxId` + `from` | `Invitation: <title>` | description hoặc "You are invited to <title>." | `REQUEST` |
| PATCH | sự kiện có attendee, mailbox và request có `from` | `Updated invitation: <title>` | như trên | `REQUEST` |
| DELETE | sự kiện có attendee và mailbox (dùng địa chỉ chính của mailbox làm From) | `Cancelled: <title>` | "This event has been cancelled." | `CANCEL` |

- Mỗi attendee nhận **một thư riêng** qua thủ tục gửi thư ([01-co-ban/11](../01-co-ban/11-gui-thu.md)), đính kèm `invite.ics` (`text/calendar; charset=utf-8; method=<METHOD>`). Thư gửi xuất hiện trong Sent như thư thường.
- Thứ tự: **lưu sự kiện trước**, sau đó gửi. Lỗi gửi cho một attendee **không** làm request lỗi: response 200 với `invitationErrors: [{email, error}]`; UI hiển thị "Event saved, but invitations could not be sent to: …".

### 6.2 Định dạng ICS
```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//{APP_NAME}//Calendar//EN
CALSCALE:GREGORIAN
METHOD:REQUEST|CANCEL
BEGIN:VEVENT
UID:<eventId>@{APP_HOST}
DTSTAMP:<now UTC>
DTSTART:<YYYYMMDDTHHMMSSZ>
DTEND:<YYYYMMDDTHHMMSSZ>
SUMMARY:<title>
DESCRIPTION:<description>
LOCATION:<location>
ORGANIZER:mailto:<from>
ATTENDEE;ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:<attendee>     (mỗi attendee một dòng)
STATUS:CONFIRMED|CANCELLED
END:VEVENT
END:VCALENDAR
```
- Dòng kết thúc CRLF; escape `\` → `\\`, `;` → `\;`, `,` → `\,`, xuống dòng → `\n`.
- Gập dòng dài hơn 75 octet theo RFC 5545 (CRLF + một dấu cách), không cắt giữa ký tự UTF-8.

## 7. Mẫu thư
Bảng `email_templates(id, user_id, name, subject, text_body, created_at, updated_at)` được dành sẵn trong schema và có trong danh sách bảng sao lưu ([03-tuy-chon/04](04-backup.md)). Phiên bản này không có API hay UI cho mẫu thư; bảng luôn rỗng trừ khi được khôi phục từ backup.

## 8. UI `/calendar`
- Danh sách sự kiện từ **thời điểm hiện tại** tới hết tháng kế tiếp, nhóm theo ngày; rỗng → "No upcoming events".
- Dialog tạo/sửa: Title, Attendees (phân tách dấu phẩy), Starts, Ends (ô ngày giờ cục bộ), Description, Location, From (chọn địa chỉ gửi — chỉ bắt buộc khi có attendee).
- Xoá có confirm "Delete this event? Attendees will receive a cancellation." (câu sau chỉ khi có attendee).
- Lỗi inline; `invitationErrors` hiển thị như §6.1.

## 9. Lỗi & biên
- Mailbox của sự kiện bị xoá → sửa/xoá vẫn được, không gửi thư.
- PATCH chỉ đổi `title` mà không có `from` → không gửi thư cập nhật.

## 10. Tiêu chí chấp nhận
- [ ] POST với 2 attendee → 2 thư trong Sent, mỗi thư có `invite.ics` hợp lệ (mở được trong ứng dụng lịch phổ biến).
- [ ] `startsAt` không có múi giờ → 400.
- [ ] Attendee sai định dạng → 400, không lưu sự kiện.
- [ ] Gửi lỗi cho 1 attendee → 200, sự kiện được lưu, `invitationErrors` có 1 mục.
- [ ] DELETE sự kiện có attendee → thư `METHOD:CANCEL` được gửi.
- [ ] User khác PATCH sự kiện → 404.

## 11. Ghi chú triển khai
- Để client lịch áp bản cập nhật chắc chắn hơn, có thể thêm cột `sequence` tăng mỗi lần PATCH và ghi `SEQUENCE:<n>` vào ICS.
