# Màn hình danh sách thư

> Nghiệp vụ: [01-co-ban/07-danh-sach-dem-thu.md](../01-co-ban/07-danh-sach-dem-thu.md), [01-co-ban/09-to-chuc-thu.md](../01-co-ban/09-to-chuc-thu.md), [01-co-ban/11-gui-thu.md §5](../01-co-ban/11-gui-thu.md), [01-co-ban/13-hoi-thoai.md](../01-co-ban/13-hoi-thoai.md), [02-nang-cao/03-folder-tuy-chinh.md](../02-nang-cao/03-folder-tuy-chinh.md), [02-nang-cao/05-hen-gio-gui.md](../02-nang-cao/05-hen-gio-gui.md), [02-nang-cao/06-snooze.md](../02-nang-cao/06-snooze.md)

## 1. Cấu hình thư mục
| Thư mục | Tiêu đề | Rỗng | Query |
|---|---|---|---|
| inbox | Inbox | "No emails" | `direction=inbound&status=received` |
| starred | Starred | "No starred emails" | `starred=true` |
| snoozed | Snoozed | "No snoozed emails" | `snoozed=true` |
| sent | Sent | "No emails" | `direction=outbound&status=sent` |
| scheduled | Scheduled | "No scheduled emails" | `scheduled=true` |
| outbox | Outbox | "Outbox is empty" | `outbox=true` |
| drafts | Drafts | "No drafts" | `direction=outbound&status=draft` |
| archived | Archived | "No archived emails" | `status=archived` |
| spam | Spam | "No spam" | `status=spam` |
| trash | Trash | "No emails in trash" | `status=trash` |
| folder | <tên folder> | "No emails in this folder" | `folderId=<id>` |

Luôn kèm `mailboxId`, `q`, `read`, `limit=25`, `offset`, và `group=thread` khi bật conversation view (trừ drafts, scheduled, outbox).

## 2. Thanh trên
- Checkbox "Select all visible messages".
- Có dòng được chọn → thanh bulk (§4) thay cho bộ phân trang.
- Phân trang: `"{start} - {end} of {total}"`, nút trước/sau (khoá ở biên hoặc khi đang tải), **25 thư/trang**.
- Inbox: toggle "Show unread emails only" → `read=unread`.
- Trash và Spam: nút "Empty trash" / "Empty spam" (chỉ khi có thư và user có quyền quản lý mailbox) → xác nhận "Delete all emails in Trash forever? This cannot be undone." (hoặc "…in Spam…") → `POST /api/mailboxes/{id}/empty-trash {status}`; lặp lại khi response có `remaining: true`, hiển thị tiến trình "Deleting… {n} deleted"; xong → toast "{n} emails deleted forever", phát `app:messages-changed`.
- Đổi query/mailbox/thư mục/toggle/chế độ hội thoại → về trang 1 và bỏ chọn; đổi trang → bỏ chọn.

## 3. Một dòng thư
**Người hiển thị**:
- Drafts → "Draft" (đỏ, đậm).
- Sent, Scheduled, Outbox → người nhận đầu tiên (tên liên hệ hoặc tên hiển thị); nhiều người → thêm `", +{n-1}"`; không có → "No recipient".
- Thư đi ở thư mục khác → tên mailbox hiện tại.
- Còn lại → tên liên hệ của người gửi → tên trong header → local-part; cuối cùng "Unknown sender".

**Số hội thoại**: chữ nhỏ màu xám khi `threadCount > 1`.

**Chưa đọc** (đậm người gửi, tiêu đề, ngày): dòng nhóm → `threadUnread > 0`; dòng đơn → thư inbound và chưa đọc.

**Tiêu đề** hoặc "(no subject)". **Xem trước**: snippet hoặc "No preview" (drafts: snippet → danh sách người nhận → "No content").

**Ngày**: cùng ngày → `hh:mm A`; cùng năm → `MMM DD`; khác → `MMM DD, YYYY`. Scheduled thay bằng "Scheduled for <ngày giờ địa phương>". Outbox thay bằng nhãn "Failed" (đỏ, tooltip = lỗi gửi), "Sending…" hoặc "Scheduled for …".

**Bố cục rộng**: icon · checkbox · người (160–260 px) · "tiêu đề - xem trước" · thời gian. Thư inbound có nút sao (`POST /api/messages/{id}/star`). Hover actions (§5) cho mọi thư trừ Drafts; thời gian ẩn khi hover.

**Bố cục hẹp** (split view): checkbox, người, số hội thoại, thời gian, tiêu đề, xem trước xếp thành các dòng; dòng đang mở có viền trái màu nhấn.

**Click**:
- Draft → mở composer nổi với nháp (không có trang đọc).
- Khác → nếu chưa đọc: đánh dấu đọc **lạc quan** (dòng thành đã đọc, `threadUnread − 1`, số Inbox − 1) + `POST /api/messages/bulk {action: "read"}` (không phát `app:messages-changed`; lỗi → hoàn tác).
- Sau đó điều hướng `/<thư mục>/<id>`, dữ liệu dòng được dùng làm dữ liệu ban đầu của trang đọc; thứ tự các dòng hiện tại được giữ để trang đọc điều hướng trước/sau ([04-doc-thu.md §1](04-doc-thu.md)).

**Kéo**: mọi thư trừ Drafts/Scheduled/Outbox; kéo một dòng đã chọn → mang theo mọi id đã chọn; mỗi id được mở rộng thành `threadMessageIds` khi ở conversation view.

## 4. Chọn nhiều & thanh bulk
- Lưu lựa chọn dạng `{id, read}` với `read = read && !threadUnread`.
- Thanh bulk: "{n} selected", Archive, Report spam, Delete (chuyển Trash), "Mark as read" (nếu có dòng chưa đọc) / "Mark as unread", menu **"Move to"**, nút X bỏ chọn.
- Menu "Move to": Inbox (khi không ở Inbox), Archived, Spam, Trash, dải phân cách, rồi **danh sách folder của mailbox** (chấm màu + tên, ẩn folder đang xem) → action `folder` với `folderId`.
- Ở Trash và Spam: nút "Delete forever" thay cho Delete → xác nhận "Delete {n} email(s) forever? This cannot be undone." → `POST /api/messages/bulk {action: "delete"}`; thêm "Not spam" (Spam) / "Restore to Inbox" (Trash) → action `inbox`.
- Ở Outbox: "Retry" (gửi lại lần lượt từng thư `failed` qua `POST /api/messages/{id}/retry-send`) và "Delete" (Trash).
- Id được mở rộng theo hội thoại rồi gửi `POST /api/messages/bulk`. Đọc/chưa đọc cập nhật lạc quan. Thành công → bỏ chọn, phát `app:messages-changed`; lỗi → toast "Could not update messages" và hoàn tác phần lạc quan.
- Split view khi đang chọn: khung phải hiển thị "{n} selected — Choose an action to apply to the selected emails."

## 5. Hover actions & Snooze
Archive · Trash (ở Trash: Delete forever, có xác nhận) · Mark as read/unread · Snooze (hoặc Unsnooze nếu đang snooze; chỉ thư inbound) · Move to (menu như §4).

Dialog "Snooze email":
- "Hide this email from the inbox until the time you choose."
- Preset Tomorrow (mặc định, +1 ngày) / Next week (+7 ngày) / Next month (+1 tháng), ô ngày giờ cục bộ (tối thiểu now + 5 phút).
- `POST /api/messages/{id}/snooze {snoozedUntil}` (ISO có múi giờ); lỗi → "Unable to snooze message".

## 6. Split view & cột co giãn
- Có ở mọi thư mục trừ Drafts. Không mở thư → chỉ danh sách.
- Mở thư trên màn hình rộng (≥ 1024 px): trái là danh sách hẹp (mặc định 360 px, lưu theo user, 250 … container − 280), phải là khung đọc.
- Kéo danh sách < 250 px → sidebar tự thu gọn; đóng thư → khôi phục trạng thái sidebar.
- Conversation view (mặc định bật) và "latest messages first" (mặc định bật) đọc từ tuỳ chọn hiển thị trong bộ nhớ trình duyệt.

## 7. Tiêu chí chấp nhận
- [ ] Menu "Move to" liệt kê các folder của mailbox; chọn folder → thư vào folder.
- [ ] "Delete forever" ở Trash luôn hỏi xác nhận; huỷ → không có request.
- [ ] Empty trash với > 100 thư → UI gọi lặp cho tới khi hết `remaining`, Trash rỗng.
- [ ] Đánh dấu đọc lạc quan được hoàn tác khi request lỗi.
