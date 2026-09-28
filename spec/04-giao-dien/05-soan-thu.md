# Composer (soạn thư)

> Nghiệp vụ: [01-co-ban/10-nhap-thu.md](../01-co-ban/10-nhap-thu.md), [01-co-ban/11-gui-thu.md](../01-co-ban/11-gui-thu.md), [01-co-ban/12-tra-loi-chuyen-tiep.md](../01-co-ban/12-tra-loi-chuyen-tiep.md), [02-nang-cao/05-hen-gio-gui.md](../02-nang-cao/05-hen-gio-gui.md)

## 1. Chế độ
- **Nổi** (mặc định): góc phải dưới 560 × 520 px; phóng to → modal 860 px × 86vh có nền tối (Esc thu nhỏ); X đóng **không** xoá nháp. `openComposer()` (mới), `openDraftComposer(id)` (mở nháp).
- **Toàn trang** `/compose`: "Compose — Write a new email. Drafts save automatically."
- Nhãn header theo ưu tiên: "Loading draft" → "Reply" (có `inReplyTo`) → "Forward" (subject `/^fwd?:/i`) → "Draft saved" (có draftId) → "New Message".

## 2. Trường
- **From**: select mọi `senderAddresses` của mọi mailbox; chọn → đổi mailbox toàn cục; giá trị gửi `"Tên" <addr>`; không có → "Select a mailbox first".
- **To** + link Cc/Bcc (hiện khi bấm hoặc nháp có giá trị):
  - To: "Recipients, or "Maya Chen" <maya@example.com>";
  - Cc: "Carbon copy";
  - Bcc: "Blind carbon copy, hidden from other recipients".
- **Subject**, **Body** (editor, placeholder "Write your message").

## 3. Ô người nhận (chip)
- Tạo chip khi: `,` `;` Enter; Tab (nếu có chữ); rời ô; dán chuỗi có `,`/`;`.
- Backspace khi ô rỗng → bỏ chip cuối và đưa chữ về ô để sửa.
- Tách bằng `splitEmailAddressList` (giữ dấu phẩy trong tên có ngoặc kép); loại trùng theo địa chỉ lowercase.
- Nhãn chip = tên nếu khác địa chỉ; tooltip = địa chỉ; nút X.
- Hợp lệ: `^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$` trên địa chỉ; sai → chip đỏ.

## 4. Editor HTML (contentEditable)
- Toolbar: Bold (⌘B), Italic (⌘I), Underline (⌘U), Strikethrough, Bulleted list, Numbered list, Quote (toggle `blockquote`/`div`), Insert link (⌘K), Clear formatting. Trạng thái nút theo `queryCommandState`.
- **Dán luôn là text thuần** (không bao giờ dán HTML).
- Link: popover nhập URL (thêm `https://` nếu không bắt đầu `http(s):`/`mailto:`); không bôi đen → chèn `<a>` với chính URL.
- Trích dẫn không sửa được; nút "•••" hiện/ẩn.
- Bản text: xem [01-co-ban/11-gui-thu.md §5](../01-co-ban/11-gui-thu.md).

## 5. Chữ ký
- Khối `<div data-mailflare-signature="1"><br><br>{chữ ký}</div>`.
- Áp khi nháp tải xong và mỗi khi đổi mailbox/chữ ký: có khối cũ → thay; không → nối cuối (nếu chữ ký mới không rỗng).
- Sau gửi/xoá → body chỉ còn chữ ký. Body chỉ có chữ ký không tính là nội dung.

## 6. Autosave & tải nháp
- Autosave: xem [01-co-ban/10-nhap-thu.md §6](../01-co-ban/10-nhap-thu.md).
- Tải nháp: `GET /api/drafts/{id}` (lỗi "Failed to load draft") → khôi phục chip, threading, subject, body/quote (tách theo wrapper; text → HTML), attachment đã lưu (`disposition=attachment`), chọn đúng mailbox và From.

## 7. Attachment
- Nút kẹp giấy (nhiều file) hoặc kéo thả ("Drop files to attach"; bỏ qua khi đang gửi/tải).
- Giới hạn (tính cả file đã lưu trên nháp):
  - > 10 file → "A message can include at most 10 attachments";
  - file > 10 MB → "Each attachment must be 10 MB or smaller";
  - tổng > 20 MB → "Attachments must total 20 MB or less".
- Chip tên + kích thước + X. Xoá file đã lưu (từ forward) → `DELETE /api/drafts/{id}/attachments/{attId}` ("Could not remove attachment"); tooltip "Carried over from the forwarded message".

## 8. Hẹn giờ
Menu cạnh Send:
- Later today (+3 h), Tomorrow morning (08:00), Monday morning (08:00 thứ Hai kế tiếp), mỗi mục kèm giờ;
- Pick date & time (`datetime-local`, min now + 5′);
- Clear schedule.
Đã chọn → nút "Schedule".

## 9. Gửi
Kiểm tra theo thứ tự (toast đỏ 3,2 s):
1. "Add at least one recipient".
2. `"{x}" is not a valid email address`.
3. "Write a message before sending".

Request: `POST /api/send` multipart gồm `from, to, cc, bcc, subject, text, html, mailboxId, inReplyTo, references, threadId, draftId (chỉ khi có file đã lưu), scheduledAt, attachments[]`. Nút "Sending", khoá khi thiếu From hoặc đang tải nháp.

Kết quả:
- Lỗi → toast `error ?? "Send failed"`.
- Thành công → xoá nháp, reset form (body = chữ ký), toast xanh "Message sent" / "Message scheduled", phát `messages-changed`. Composer nổi **vẫn mở, trống** (nên đóng khi viết lại).

## 10. Huỷ nháp
Nút thùng rác "Delete draft":
- huỷ autosave đang chờ, tăng generation, `DELETE` nháp nếu có (lỗi "Could not delete draft");
- reset form, phát `messages-changed`;
- đóng composer nổi, hoặc (toàn trang) về `/inbox`.
