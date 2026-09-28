# Màn hình đọc thư

> Nghiệp vụ: [01-co-ban/08-doc-thu.md](../01-co-ban/08-doc-thu.md), [01-co-ban/12-tra-loi-chuyen-tiep.md](../01-co-ban/12-tra-loi-chuyen-tiep.md), [01-co-ban/13-hoi-thoai.md](../01-co-ban/13-hoi-thoai.md), [02-nang-cao/10-danh-ba-va-chan.md](../02-nang-cao/10-danh-ba-va-chan.md), [02-nang-cao/11-bo-loc-spam.md](../02-nang-cao/11-bo-loc-spam.md)

## 1. Tải dữ liệu
- Có cache từ danh sách → hiển thị ngay, gọi `GET /api/messages/{id}/metadata` để lấy attachment/unsubscribe (lỗi bỏ qua).
- Không → `GET /api/messages/{id}` (skeleton); không có → `error ?? "Message not found"`.
- Thư chưa đọc → `POST /api/messages/{id}/read` ngay khi hiển thị, rồi phát `messages-changed`.
- Có `threadId` → `GET /api/messages/{id}/thread` (làm mới khi `messages-changed`).
- **Không có** nút thư trước/sau (chỉ có phím `u` quay lại) — nên bổ sung.

## 2. Bố cục (trên → dưới)
1. Toolbar dính (§3), lỗi inline bên trái.
2. Tiêu đề `h1` (`?? "(no subject)"`).
3. Khối điểm spam (ẩn khi không có điểm và không lỗi):
   - "Spam score: N · verdict" hoặc "Spam analysis unavailable" / "The filter could not analyze this message. It was delivered normally.";
   - mở "Why Mailflare gave this score" → danh sách `+N lý do` (đỏ) / `−N lý do` (xanh).
4. Phần hội thoại **trước** thư hiện tại (khi tắt "latest first") hoặc **sau** (khi bật).
5. Thư hiện tại:
   - avatar (liên hệ cho thư đến, mailbox cho thư đi, fallback chữ cái);
   - tên người gửi — click mở dialog liên hệ (thư đến);
   - `<địa chỉ>`;
   - "to me" (thư đến ≤ 1 người nhận) hoặc danh sách người nhận click được, dòng cc/bcc;
   - ngày `MMM DD, YYYY, hh:mmA`;
   - hành động theo thư (§4);
   - nội dung (§5), cloud files, attachment (§6).
6. Phần hội thoại còn lại. 7. Dialog xem trước attachment.

## 3. Toolbar
Nút hiện:
- Reply ("Reply (r)" nếu bật phím tắt).
- Reply all — chỉ khi thêm được người nhận.
- Forward.
- Archive — khoá khi đã archived.
- Report spam — khoá khi đã spam hoặc không phải thư đến.
- Delete — "Move to trash", khoá khi đã trash.
- Mark as read/unread.
- ⋮.

Menu ⋮:
- (thư đến) "Unsubscribe" — khoá khi không có URL và đã trash.
- (thư đến) "Block contact".
- "Show original".
- "Move to":
  - thư đến đang archived/spam → "Inbox" / "Not spam" (action `inbox`);
  - chưa archived → "Archived"; chưa spam → "Spam"; chưa trash → "Trash".

Sau hành động di chuyển → điều hướng `/trash`, `/spam`, `/archived`, `/inbox` tương ứng (đọc/chưa đọc không điều hướng). Lỗi: "Could not update message".

Hành động phức hợp:
| Hành động | Các bước | Lỗi |
|---|---|---|
| Unsubscribe có link | `window.open(url, "_blank", "noopener,noreferrer")` | |
| Unsubscribe không link | confirm → tạo rule `email exact sender → trash` → trash thư → `/trash` | "Could not create trash rule" |
| Block contact | `POST /api/contacts/block` → trash → `/trash` | lỗi API / "Could not block contact" |
| Reply / Reply all | tạo nháp (xem file trả lời) → mở composer | "Could not start reply" |
| Forward | tạo nháp có `forwardOfMessageId` → mở composer | "Could not start forward" |

## 4. Hành động theo thư (header thư & mỗi thẻ hội thoại)
Sao (toggle) · Reply · menu: Reply, Reply all (có điều kiện), Forward, Show original, Mark read/unread, Move to…, Block contact (không điều hướng). Lỗi hiện rút gọn cạnh nút.

## 5. Nội dung
- HTML có wrapper quote của hệ thống → body + `<details>` trích dẫn.
- Chỉ text → tách trích dẫn thành các khối "Previous message …" lồng nhau; hiển thị `<pre>`; tách link OneDrive/SharePoint thành "Cloud files (n)" với nút "Open from OneDrive".
- `cid:` → URL attachment; sanitize (xem nghiệp vụ); blockquote sau dòng "On … wrote:" → `<details class="email-quote-toggle">` ("Show or hide quoted email").

## 6. Attachment
- "Attachments (n)", lưới 2 cột. Thẻ: thumbnail ảnh (không SVG) / video tắt tiếng / icon màu; nhãn Image/Video/Audio/PDF/Spreadsheet/Presentation/Archive/Code/Document/File; `"<nhãn> · <kích thước>"` (B, KB làm tròn lên, MB 1 số lẻ).
- Click → dialog xem trước:
  - ảnh `<img>`, PDF `<iframe>`, audio/video player;
  - text/json/xml/csv → tải text vào `<pre>` ("Could not load this attachment");
  - loại khác → "This file type cannot be previewed safely in the browser.";
  - nút "Download" (`?download=1`).

## 7. Hội thoại
- Chia thư trước/sau thư hiện tại (theo thời gian), đảo ngược khi "latest first".
- Mỗi phần: luôn hiện thư đầu và cuối, giữa gộp thành "{n} older/newer message(s)" có nút mở.
- Thẻ thu gọn: avatar, người gửi (đậm nếu chưa đọc), snippet, kẹp giấy nếu có file, ngày. Click → mở rộng + đánh dấu đọc (bulk read, hoàn tác khi lỗi).
- Thẻ mở rộng: email, "to" (≤ 3 tên, +n), nội dung sanitize, trích dẫn, chip attachment.

## 8. Xem nguồn
Dialog 90vh × ≤ 960 px, `GET /api/messages/{id}/original`, "Loading source…", lỗi = text response hoặc "Unable to load original message", `<pre>` monospace.

## 9. Dialog liên hệ
`GET /api/contacts?mailboxId&address`. Avatar (tải/đổi/xoá, ≤ 10 MB, resize WebP), tên (sửa), email (khoá), nguồn, "Last seen" (`MMM DD, YYYY` / "Unknown"), cờ "Blocked contact". "Save contact" → `PATCH /api/contacts` → phát `contact-changed`.
