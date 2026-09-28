# Lịch (Calendar) & mẫu thư (Templates)

> **[TÙY CHỌN]** — Khuyến nghị bỏ ở phiên bản đầu.

## 1. Calendar

### 1.1 Dữ liệu
`calendar_events(id evt_…, user_id, mailbox_id?, title, description "", location "", attendees JSON [], starts_at, ends_at, created_at, updated_at)`, index `(user_id, starts_at)`. Sự kiện theo **user**, không theo quyền mailbox.

### 1.2 API (session)
| Method | Path | Hành vi |
|---|---|---|
| GET | `/api/calendar/events?start&end` | `start` mặc định now, `end` = start + 31 ngày; `start ≤ startsAt < end`, sắp tăng → `{events}` |
| POST | `/api/calendar/events` | `{title, description?, location?, attendees?[], startsAt, endsAt, mailboxId?, from?}` |
| PATCH | `/api/calendar/events/{id}` | cùng shape; không đổi được `mailboxId`; 404 nếu không phải của mình |
| DELETE | `/api/calendar/events/{id}` | luôn `{ok:true}`; không gửi thư huỷ |
Validate: title trim không rỗng, 2 thời điểm hợp lệ, `endsAt > startsAt` (400 "Enter a title and valid event times"); attendee lọc theo `^\S+@\S+\.\S+$` (sai bị bỏ im lặng).

### 1.3 Thư mời
POST có attendee **và** `mailboxId` → mỗi attendee một `sendEmail` song song: subject `Invitation: <title>`, text = description hoặc "You are invited to <title>.", đính kèm `invite.ics` (`text/calendar; charset=utf-8`). PATCH gửi lại "Updated invitation: …" nếu có attendee, mailbox và `from`.

ICS: `BEGIN:VCALENDAR / VERSION:2.0 / PRODID:-//Mailflare//Calendar//EN / CALSCALE:GREGORIAN / METHOD:REQUEST / VEVENT {UID:<id>@mailflare, DTSTAMP, DTSTART, DTEND (UTC YYYYMMDDTHHMMSSZ), SUMMARY, DESCRIPTION, LOCATION}`, escape `\ ; , newline`; không ORGANIZER/ATTENDEE/SEQUENCE, không gập dòng.

Gotcha: sự kiện được lưu **trước** khi gửi; gửi lỗi → request lỗi nhưng sự kiện vẫn còn. UI gửi `datetime-local` không múi giờ → server hiểu là UTC.

### 1.4 UI `/calendar`
Danh sách sự kiện từ **bây giờ** tới đầu tháng sau; tạo/sửa (tiêu đề, khách mời phân tách dấu phẩy, bắt đầu, kết thúc — không có mô tả/địa điểm); xoá có confirm.

## 2. Email templates
Bảng `email_templates(id, user_id, name, subject, text_body, timestamps)` tồn tại nhưng **không có API, logic hay UI** — chỉ xuất hiện trong backup. Bỏ, hoặc thiết kế mới (chèn mẫu vào composer).
