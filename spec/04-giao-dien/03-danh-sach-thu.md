# Màn hình danh sách thư

> Nghiệp vụ: [01-co-ban/07-danh-sach-dem-thu.md](../01-co-ban/07-danh-sach-dem-thu.md), [01-co-ban/09-to-chuc-thu.md](../01-co-ban/09-to-chuc-thu.md), [01-co-ban/13-hoi-thoai.md](../01-co-ban/13-hoi-thoai.md), [02-nang-cao/06-snooze.md](../02-nang-cao/06-snooze.md)

## 1. Cấu hình thư mục
| Thư mục | Tiêu đề | Rỗng | Query |
|---|---|---|---|
| inbox | Inbox | "No emails" | `direction=inbound&status=received` |
| starred | Starred | "No starred emails" | `starred=true` |
| snoozed | Snoozed | "No snoozed emails" | `snoozed=true` |
| sent | Sent | "No emails" | `direction=outbound&status=sent` |
| drafts | Drafts | "No drafts" | `direction=outbound&status=draft` |
| archived | Archived | "No archived emails" | `status=archived` |
| spam | Spam | "No spam" | `status=spam` |
| trash | Trash | "No emails in trash" | `status=trash` |
| folder | <tên folder> | "No emails in this folder" | `folderId=<id>` |
Luôn kèm `mailboxId`, `q`, `read`, `limit=25`, `offset`, và `group=thread` khi bật conversation view (trừ drafts).

## 2. Thanh trên
- Checkbox "Select all visible messages".
- Có chọn → thanh bulk thay cho bộ phân trang.
- Phân trang: `"{start} - {end} of {total}"`, nút trước/sau (khoá ở biên hoặc khi đang tải), **25 thư/trang**, **không** cuộn vô hạn.
- Inbox: toggle "Show unread emails only" → `read=unread`.
- Đổi query/mailbox/thư mục/toggle/chế độ hội thoại → về trang 1, bỏ chọn; đổi trang → bỏ chọn.

## 3. Một dòng thư
**Người hiển thị**:
- Drafts → "Draft" (đỏ, đậm).
- Sent → người nhận đầu (tên liên hệ hoặc tên hiển thị), nhiều người → `", +{n-1}"`; không có → "No recipient".
- Thư đi ở thư mục khác → tên mailbox hiện tại.
- Còn lại → `fromContactName ?? tên trong header ?? local-part`, cuối cùng "Unknown sender".

**Số hội thoại** nhỏ màu xám khi `threadCount > 1`.

**Chưa đọc** (đậm người gửi, tiêu đề, ngày): dòng nhóm → `threadUnread > 0`; dòng đơn → inbound và `!read`.

**Tiêu đề** `?? "(no subject)"`. **Xem trước**: `snippet || "No preview"` (drafts: `snippet || toAddr || "No content"`).

**Ngày**: cùng ngày → `hh:mm A`; cùng năm → `MMM DD`; khác → `MMM DD, YYYY`.

**Bố cục rộng**: icon · checkbox · người (160–260 px) · "tiêu đề - xem trước" · thời gian. Inbox inbound có nút sao (`POST …/star`). Hover actions **chỉ ở Inbox & Snoozed** cho thư inbound (thời gian ẩn khi hover).

**Bố cục hẹp** (split view): checkbox, người, số hội thoại, thời gian, tiêu đề, xem trước xếp dòng; dòng đang mở có viền trái xanh.

**Click**:
- Draft → mở composer nổi với nháp (không có trang đọc).
- Khác → nếu chưa đọc: đánh dấu đọc **lạc quan** (`read=true`, `threadUnread−1`, Inbox −1) + `POST bulk {action:"read"}` (không phát `messages-changed`, hoàn tác khi lỗi).
- Sau đó điều hướng `/<thư mục>/<id>` với cache chi tiết được nạp sẵn từ dữ liệu dòng.

**Kéo**: chỉ thư inbound ở Inbox; kéo dòng đã chọn → mang mọi id đã chọn; mỗi id mở rộng thành `threadMessageIds`.

## 4. Chọn nhiều & thanh bulk
- Chọn lưu `{id, read = read && !threadUnread}`.
- Thanh: "{n} selected", Archive, Report spam, Delete (trash), "Mark as read" (nếu có dòng chưa đọc) / "Mark as unread", select "Move to" (Archived/Spam/Trash — **không có folder**), X bỏ chọn.
- Id được mở rộng theo hội thoại → `POST /api/messages/bulk`. Đọc/chưa đọc cập nhật lạc quan. Thành công → bỏ chọn.
- Split view: đang chọn → khung phải thay bằng "{n} selected — Choose an action to apply to the selected emails."

## 5. Hover actions & Snooze
Archive · Trash · Mark as read/unread · Snooze (hoặc Unsnooze nếu đang snooze).
Dialog "Snooze email":
- "Hide this email from the inbox until the time you choose."
- Preset Tomorrow (mặc định, +1 ngày) / Next week (+7 ngày) / Next month (+1 tháng), ô `datetime-local`.
- `POST /api/messages/{id}/snooze {snoozedUntil}`; lỗi "Unable to snooze message".

## 6. Split view & cột co giãn
- Có ở mọi thư mục trừ Drafts. Không mở thư → chỉ danh sách.
- Mở thư, màn hình ≥ `lg`: trái danh sách hẹp (mặc định 360 px, lưu theo user, 250 … container − 280), phải khung đọc.
- Kéo danh sách < 250 px → sidebar tự thu gọn; đóng thư → khôi phục.
- Conversation view (mặc định bật) và "latest messages first" (mặc định bật) lấy từ localStorage.
