# Màn hình đọc thư

> Nghiệp vụ: [01-co-ban/08-doc-thu.md](../01-co-ban/08-doc-thu.md), [01-co-ban/09-to-chuc-thu.md](../01-co-ban/09-to-chuc-thu.md), [01-co-ban/12-tra-loi-chuyen-tiep.md](../01-co-ban/12-tra-loi-chuyen-tiep.md), [01-co-ban/13-hoi-thoai.md](../01-co-ban/13-hoi-thoai.md), [02-nang-cao/10-danh-ba-va-chan.md](../02-nang-cao/10-danh-ba-va-chan.md), [02-nang-cao/11-bo-loc-spam.md](../02-nang-cao/11-bo-loc-spam.md), [03-tuy-chon/07-tien-ich-giao-dien.md](../03-tuy-chon/07-tien-ich-giao-dien.md)

## 1. Tải dữ liệu & điều hướng
- Có dữ liệu ban đầu từ danh sách → hiển thị ngay, đồng thời gọi `GET /api/messages/{id}/metadata` để lấy attachment và `unsubscribeUrl` (lỗi bỏ qua).
- Không có → `GET /api/messages/{id}` (hiển thị khung chờ); không tìm thấy → `error ?? "Message not found"` + nút "Back to {thư mục}".
- Thư chưa đọc → `POST /api/messages/{id}/read` ngay khi hiển thị, rồi phát `app:messages-changed`.
- Có `threadId` → `GET /api/messages/{id}/thread` (làm mới khi có `app:messages-changed`).
- **Điều hướng trước/sau**: toolbar có nút "Newer" (‹) và "Older" (›) cùng chỉ báo "{i} of {total}":
  - thứ tự theo danh sách đã mở trang đọc (cùng thư mục, query, bộ lọc, trang, chế độ hội thoại);
  - ở dòng cuối trang → tải trang kế tiếp của cùng query rồi mở dòng đầu; ở dòng đầu trang > 1 → tải trang trước;
  - khoá nút ở đầu/cuối toàn bộ kết quả;
  - vào trang đọc trực tiếp bằng URL (không có ngữ cảnh danh sách) → dùng thư mục trong URL với query rỗng;
  - phím tắt `k`/`j` ([03-tuy-chon/07](../03-tuy-chon/07-tien-ich-giao-dien.md)).
- Sau khi thư hiện tại bị chuyển khỏi thư mục (archive, trash, spam, move, delete forever) → mở **thư kế tiếp** (Older) nếu có, ngược lại quay về danh sách thư mục.
- `u` hoặc nút "Back" → về danh sách, giữ trang và vị trí cuộn.

## 2. Bố cục (trên → dưới)
1. Toolbar dính (§3), lỗi inline bên trái.
2. Tiêu đề `h1` (subject hoặc "(no subject)").
3. Banner trạng thái (nếu có):
   - Scheduled: "This message will be sent on <ngày giờ>." + nút "Cancel send" ([02-nang-cao/05](../02-nang-cao/05-hen-gio-gui.md));
   - Outbox `failed`: "This message could not be sent: <lỗi>" + nút "Retry" (`POST /api/messages/{id}/retry-send`; thành công → toast "Message sent", mở Sent; lỗi → toast lỗi);
   - Trash: "This email is in Trash." + nút "Delete forever" (xác nhận) và "Restore to Inbox".
4. Khối điểm spam (ẩn khi không có điểm và không lỗi):
   - "Spam score: N · verdict", hoặc "Spam analysis unavailable" / "The filter could not analyze this message. It was delivered normally.";
   - mục mở rộng "Why {APP_NAME} gave this score" → danh sách `+N lý do` (đỏ) / `−N lý do` (xanh).
5. Phần hội thoại **trước** thư hiện tại (khi tắt "latest first") hoặc **sau** (khi bật).
6. Thư hiện tại:
   - avatar (liên hệ cho thư đến, mailbox cho thư đi, fallback chữ cái);
   - tên người gửi — click mở dialog liên hệ (thư đến);
   - `<địa chỉ>`;
   - "to me" (thư đến có ≤ 1 người nhận) hoặc danh sách người nhận click được; dòng cc/bcc;
   - ngày `MMM DD, YYYY, hh:mmA`;
   - hành động theo thư (§4);
   - thanh ảnh bị chặn (§5.2), nội dung (§5), cloud files, attachment (§6).
7. Phần hội thoại còn lại.
8. Dialog xem trước attachment.

## 3. Toolbar
Nút:
- Back · Newer/Older (§1).
- Reply ("Reply (r)" khi bật phím tắt).
- Reply all — chỉ khi có thêm người nhận ngoài chính mình.
- Forward.
- Archive — khoá khi đã archived.
- Report spam — khoá khi đã ở spam hoặc không phải thư đến.
- Delete — "Move to trash"; ở Trash thành "Delete forever" (xác nhận "Delete this email forever? This cannot be undone." → `DELETE /api/messages/{id}`).
- Mark as read/unread.
- ⋮.

Menu ⋮:
- (thư đến) "Unsubscribe" — xem [03-tuy-chon/07 §5.3](../03-tuy-chon/07-tien-ich-giao-dien.md).
- (thư đến) "Block contact" / "Unblock contact" theo trạng thái liên hệ.
- "Show original".
- "Move to":
  - thư đến đang archived/spam/trash hoặc trong folder → "Inbox" (ở Spam là "Not spam", action `inbox`);
  - chưa archived → "Archived"; chưa spam (thư đến) → "Spam"; chưa trash → "Trash";
  - dải phân cách, rồi **các folder của mailbox** (chấm màu + tên, ẩn folder hiện tại) → action `folder`.

Kết quả di chuyển: toast ngắn "Moved to {đích}" kèm nút "Undo" (5 s, chuyển về vị trí cũ), rồi mở thư kế tiếp (§1). Đọc/chưa đọc không điều hướng. Lỗi → "Could not update message".

Hành động phức hợp:
| Hành động | Các bước | Lỗi |
|---|---|---|
| Unsubscribe | theo [03-tuy-chon/07 §5.3](../03-tuy-chon/07-tien-ich-giao-dien.md) | "Could not create trash rule" / lỗi API |
| Block contact | xác nhận "Block {email}? Future emails will go to Trash." → `POST /api/contacts/block` → thư vào Trash → mở thư kế tiếp | lỗi API / "Could not block contact" |
| Unblock contact | xác nhận "Unblock {email}? Their emails will be delivered to the inbox again." → `DELETE /api/contacts/block?mailboxId=&address=` → toast "Contact unblocked. New mail from {email} will arrive in your inbox." | "Could not unblock contact" |
| Reply / Reply all | tạo nháp ([01-co-ban/12](../01-co-ban/12-tra-loi-chuyen-tiep.md)) → mở composer | "Could not start reply" |
| Forward | tạo nháp có `forwardOfMessageId` → mở composer | "Could not start forward" |

## 4. Hành động theo thư (header thư & mỗi thẻ hội thoại)
Sao (toggle) · Reply · menu: Reply, Reply all (có điều kiện), Forward, Show original, Mark read/unread, Move to… (như §3), Block/Unblock contact (không điều hướng). Lỗi hiện rút gọn cạnh nút.

## 5. Nội dung
### 5.1 Hiển thị
- Nội dung HTML đã sanitize ([01-co-ban/08 §5](../01-co-ban/08-doc-thu.md)) được render trong vùng cô lập (iframe sandbox không script, tự co chiều cao theo nội dung).
- HTML có wrapper trích dẫn của hệ thống (`class="app-quote"`) → phần thân + khối trích dẫn thu gọn (`<details>`, nhãn "Show or hide quoted email").
- Blockquote sau dòng "On … wrote:" → cũng thu gọn như trên.
- Chỉ có text → tách trích dẫn thành các khối "Previous message …" lồng nhau, hiển thị dạng `<pre>` tự ngắt dòng; link OneDrive/SharePoint tách thành "Cloud files (n)" với nút "Open from OneDrive".
- `cid:` → URL attachment của thư.
- Link trong nội dung mở tab mới với `rel="noopener noreferrer"`.

### 5.2 Ảnh bên ngoài
- Mặc định **bị chặn**. Thư có ≥ 1 ảnh bị chặn → thanh "Images from external sources are hidden." + nút **"Show images"**.
- "Show images" → hiện ảnh của thư đó trong lần xem này (mở lại → chặn lại).
- [TÙY CHỌN] Nút "Always show images from {sender}" → thêm người gửi vào danh sách tin cậy; thư từ người gửi đó hiện ảnh ngay. Thư ở Spam hoặc có verdict spam không bao giờ tự hiện ảnh.
- Chi tiết: [01-co-ban/08 §5.2](../01-co-ban/08-doc-thu.md).

## 6. Attachment
- "Attachments (n)", lưới 2 cột. Thẻ: thumbnail ảnh (không SVG) / video tắt tiếng / icon màu; nhãn Image/Video/Audio/PDF/Spreadsheet/Presentation/Archive/Code/Document/File; `"<nhãn> · <kích thước>"` (B; KB làm tròn lên; MB 1 chữ số thập phân).
- Click → dialog xem trước:
  - ảnh `<img>`, PDF trong khung nhúng, audio/video player;
  - text/json/xml/csv → tải text vào `<pre>` (lỗi: "Could not load this attachment");
  - loại khác → "This file type cannot be previewed safely in the browser.";
  - nút "Download" (`?download=1`).

## 7. Hội thoại
- Chia các thư trước/sau thư hiện tại (theo thời gian), đảo thứ tự khi bật "latest first".
- Mỗi phần: luôn hiện thư đầu và cuối, phần giữa gộp thành "{n} older/newer message(s)" có nút mở.
- Thẻ thu gọn: avatar, người gửi (đậm nếu chưa đọc), snippet, kẹp giấy nếu có file, ngày. Click → mở rộng + đánh dấu đọc (bulk `read`, hoàn tác khi lỗi).
- Thẻ mở rộng: email, "to" (≤ 3 tên, +n), nội dung sanitize (cùng quy tắc ảnh bên ngoài §5.2), trích dẫn, chip attachment.

## 8. Xem nguồn
Dialog 90vh × ≤ 960 px, `GET /api/messages/{id}/original`, "Loading source…", lỗi = text của response hoặc "Unable to load original message", hiển thị `<pre>` monospace, nút "Download .eml" (client lưu nội dung đã tải thành file `<id>.eml`).

## 9. Dialog liên hệ
`GET /api/contacts?mailboxId&address`. Avatar (tải lên/đổi/xoá, ≤ 10 MB, client thu nhỏ và chuyển WebP), tên (sửa), email (khoá), nguồn, "Last seen" (`MMM DD, YYYY` / "Unknown"), cờ "Blocked contact". "Save contact" → `PATCH /api/contacts` → phát `app:contact-changed`. Nút "Block contact" / "Unblock contact" như §3.

## 10. Tiêu chí chấp nhận
- [ ] Từ Inbox trang 1 mở thư thứ 25, bấm "Older" → mở thư đầu tiên của trang 2.
- [ ] Archive thư đang đọc → mở thư kế tiếp, không quay về danh sách.
- [ ] Thư có ảnh `https://tracker.example/p.gif` → không có request tới host đó cho tới khi bấm "Show images".
- [ ] "Move to" liệt kê folder; chọn folder → thư vào folder.
- [ ] "Delete forever" chỉ xuất hiện ở Trash/Spam và luôn hỏi xác nhận.
