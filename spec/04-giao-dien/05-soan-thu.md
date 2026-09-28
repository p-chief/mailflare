# Composer (soạn thư)

> Nghiệp vụ: [01-co-ban/10-nhap-thu.md](../01-co-ban/10-nhap-thu.md), [01-co-ban/11-gui-thu.md](../01-co-ban/11-gui-thu.md), [01-co-ban/12-tra-loi-chuyen-tiep.md](../01-co-ban/12-tra-loi-chuyen-tiep.md), [02-nang-cao/05-hen-gio-gui.md](../02-nang-cao/05-hen-gio-gui.md), [02-nang-cao/10-danh-ba-va-chan.md §8](../02-nang-cao/10-danh-ba-va-chan.md)

## 1. Chế độ
- **Nổi** (mặc định): góc phải dưới 560 × 520 px; phóng to → modal 860 px × 86vh có nền mờ (Esc thu nhỏ lại); nút X đóng composer **không** xoá nháp (nháp đã autosave vẫn ở Drafts). Mở được ở hai dạng: soạn mới, hoặc mở một nháp theo id.
- **Toàn trang** `/compose`: tiêu đề "Compose — Write a new email. Drafts save automatically."
- Nhãn header theo ưu tiên: "Loading draft" → "Reply" (có `inReplyTo`) → "Forward" (subject khớp `/^fwd?:/i`) → "Draft saved" (đã có draftId) → "New Message".

## 2. Trường
- **From**: chọn trong mọi địa chỉ gửi của mọi mailbox user có quyền gửi; chọn → đổi mailbox đang chọn toàn cục; giá trị gửi dạng `"Tên" <addr>`; không có mailbox → "Select a mailbox first".
- **To** + link Cc/Bcc (hiện khi bấm hoặc khi nháp có giá trị):
  - To: placeholder `Recipients, or "Maya Chen" <maya@example.com>`;
  - Cc: "Carbon copy";
  - Bcc: "Blind carbon copy, hidden from other recipients".
- **Subject**, **Body** (editor, placeholder "Write your message").

## 3. Ô người nhận (chip)
- Tạo chip khi: gõ `,` `;` Enter; Tab (nếu ô có chữ); rời ô; dán chuỗi chứa `,`/`;`.
- Backspace khi ô rỗng → bỏ chip cuối và đưa chữ của nó về ô để sửa.
- Tách chuỗi bằng thủ tục tách danh sách địa chỉ ([00-nen-tang/06-quy-uoc-chung.md](../00-nen-tang/06-quy-uoc-chung.md)) — giữ dấu phẩy nằm trong tên có ngoặc kép; loại trùng theo địa chỉ lowercase.
- Nhãn chip = tên nếu khác địa chỉ; tooltip = địa chỉ; nút X để gỡ.
- Hợp lệ khi địa chỉ khớp `^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$`; sai → chip màu đỏ.
- **Gợi ý người nhận** [NÂNG CAO]: gõ ≥ 1 ký tự → sau 150 ms gọi `GET /api/contacts/suggest?mailboxId=&q=`; dropdown tối đa 8 mục ("Tên — email" hoặc chỉ email); ↑/↓ chọn, Enter/Tab chèn `"Tên" <email>` thành chip, Esc đóng; bỏ qua kết quả của request cũ khi đã gửi request mới.

## 4. Editor HTML
- Vùng soạn thảo có thể sửa, sinh HTML. Toolbar: Bold (⌘B), Italic (⌘I), Underline (⌘U), Strikethrough, Bulleted list, Numbered list, Quote (bật/tắt khối trích dẫn), Insert link (⌘K), Clear formatting. Trạng thái nút phản ánh định dạng tại vị trí con trỏ.
- **Dán luôn là text thuần** (không bao giờ dán HTML từ clipboard).
- Link: popover nhập URL (thêm `https://` nếu không bắt đầu bằng `http:`, `https:` hoặc `mailto:`); không có vùng chọn → chèn link với chính URL làm chữ.
- Phần trích dẫn (reply/forward) không sửa trực tiếp được; nút "•••" hiện/ẩn nó.
- Bản text/plain sinh từ HTML: xem [01-co-ban/11-gui-thu.md §6](../01-co-ban/11-gui-thu.md).

## 5. Chữ ký
- Khối `<div data-app-signature="1"><br><br>{chữ ký}</div>`.
- Áp khi nháp tải xong và mỗi khi đổi mailbox/chữ ký: đã có khối chữ ký → thay nội dung; chưa có → nối vào cuối (nếu chữ ký mới không rỗng).
- Body chỉ gồm chữ ký không được tính là có nội dung.

## 6. Autosave & tải nháp
- Autosave: xem [01-co-ban/10-nhap-thu.md §6](../01-co-ban/10-nhap-thu.md).
- Tải nháp: `GET /api/drafts/{id}` (lỗi "Failed to load draft") → khôi phục chip, thông tin threading, subject, body và trích dẫn (tách theo wrapper `app-quote`; nháp chỉ có text → chuyển thành HTML), attachment đã lưu (`disposition = attachment`), chọn đúng mailbox và From.

## 7. Attachment
- Nút kẹp giấy (chọn nhiều file) hoặc kéo thả ("Drop files to attach"; bỏ qua khi đang gửi/đang tải nháp).
- Giới hạn (tính cả file đã lưu trên nháp):
  - > 10 file → "A message can include at most 10 attachments";
  - file > 10 MB → "Each attachment must be 10 MB or smaller";
  - tổng > 20 MB → "Attachments must total 20 MB or less".
- Chip tên + kích thước + X. Gỡ file đã lưu trên nháp (vd từ forward) → `DELETE /api/drafts/{id}/attachments/{attId}` (lỗi "Could not remove attachment"); tooltip "Carried over from the forwarded message".

## 8. Hẹn giờ [NÂNG CAO]
Menu cạnh nút Send:
- Later today (+3 h), Tomorrow morning (08:00 ngày mai), Monday morning (08:00 thứ Hai kế tiếp), mỗi mục hiển thị kèm thời điểm cụ thể;
- Pick date & time (ô ngày giờ cục bộ, tối thiểu now + 5 phút);
- Clear schedule.
Đã chọn → nút đổi thành "Schedule". Thời điểm gửi lên server dạng ISO có múi giờ.

## 9. Gửi
Kiểm tra theo thứ tự (toast đỏ 3,2 s):
1. "Add at least one recipient".
2. `"{x}" is not a valid email address`.
3. "Write a message before sending".

Request: `POST /api/send` multipart gồm `from, to, cc, bcc, subject, text, html, mailboxId, inReplyTo, references, threadId, draftId, scheduledAt, attachments[]`. Nút hiển thị "Sending" khi đang gửi, bị khoá khi thiếu From hoặc đang tải nháp. Autosave đang chờ bị huỷ trước khi gửi.

Kết quả:
- Lỗi validate (400/403/413) → toast `error ?? "Send failed"`, composer giữ nguyên nội dung.
- Lỗi gửi (502) → toast "Message failed to send" kèm nút "View in Outbox"; composer **đóng** (thư đã nằm trong Outbox, gửi lại từ đó).
- Thành công → toast xanh "Message sent" / "Message scheduled", phát `app:messages-changed`, và:
  - composer nổi **đóng lại**;
  - composer toàn trang điều hướng về trang trước đó (hoặc `/inbox`).
  - Nháp do server xoá ([01-co-ban/11](../01-co-ban/11-gui-thu.md)); client không gọi xoá nháp.

## 10. Huỷ nháp
Nút thùng rác "Delete draft" → xác nhận "Discard this draft?" (bỏ qua xác nhận khi nháp chưa có nội dung):
- huỷ autosave đang chờ; tăng số thế hệ để bỏ qua kết quả autosave về muộn; `DELETE /api/drafts/{id}` nếu nháp đã được lưu (lỗi "Could not delete draft");
- phát `app:messages-changed`;
- đóng composer nổi, hoặc (toàn trang) về `/inbox`.

## 11. Tiêu chí chấp nhận
- [ ] Gửi thành công từ composer nổi → composer đóng, toast "Message sent", thư ở Sent, nháp biến khỏi Drafts.
- [ ] Gửi lỗi 502 → composer đóng, toast có nút "View in Outbox" mở `/outbox`.
- [ ] Dán nội dung HTML từ trang web → chỉ còn text.
- [ ] Gõ "ma" trong ô To → dropdown gợi ý từ danh bạ; Enter chèn chip `"Maya Chen" <maya@example.com>`.
- [ ] Đóng composer bằng X rồi mở lại nháp từ Drafts → nội dung và attachment còn nguyên.
