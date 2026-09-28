# Đọc thư: chi tiết, attachment, nguồn gốc, hiển thị an toàn

> **[CƠ BẢN]** · Unsubscribe là **[TÙY CHỌN]** → [03-tuy-chon/07](../03-tuy-chon/07-tien-ich-giao-dien.md)
> Phụ thuộc: [00-nen-tang/05-phan-quyen.md](../00-nen-tang/05-phan-quyen.md)

## 1. Mục tiêu
Cho người có quyền đọc xem đầy đủ nội dung thư một cách **an toàn** (không XSS, không lộ file), tải/xem trước file đính kèm, xem MIME gốc, và đánh dấu đã đọc.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Chi tiết thư, metadata, đánh dấu đọc | Hội thoại (file hội thoại) |
| Tải/xem trước attachment | Chặn ảnh remote (chưa có — khuyến nghị) |
| Xem nguồn raw | Quét virus |
| Sanitize HTML, thay `cid:` | |

## 3. API

### 3.1 `GET /api/messages/{id}` (canRead)
```json
{ "message": { ...mọi cột messages..., "fromContactName": "…|null", "toContactName": "…|null" },
  "body": { ...cùng dòng... },
  "attachments": [ { "id","messageId","filename","type","size","disposition","contentId" } ],
  "unsubscribeUrl": "https://…|mailto:…|null" }
```
Không có quyền / không tồn tại / thư không có mailbox → **404** "Not found". (Khi viết lại: bỏ `rawR2Key` khỏi response và bỏ trường `body` trùng lặp.)

`unsubscribeUrl`: đọc **64 KB đầu** raw từ R2 (range request), tách khối header (đến dòng trống đầu), gộp dòng gấp, lấy mọi `List-Unsubscribe`, ứng viên = các giá trị trong `<…>` và các phần tách bằng dấu phẩy; chỉ giữ `http:`, `https:`, `mailto:`; ưu tiên http(s), sau đó mailto.

### 3.2 `GET /api/messages/{id}/metadata` (canRead)
Chỉ `{ attachments, unsubscribeUrl }` — dùng khi danh sách đã có nội dung (vd trong thread).

### 3.3 `POST /api/messages/{id}/read` (canRead)
`UPDATE messages SET read = 1`, ghi audit `email.read` `{actor, mailboxId, messageId}`. Trả `{success:true}` hoặc 404. Client gọi **khi mở thư**. Đánh dấu chưa đọc: bulk action `unread` (file tổ chức).

### 3.4 `GET /api/messages/{id}/attachments/{attId}[?preview=1][&download=1]`
```
message = messages WHERE id
!message → 404
message.mailboxId ? require canRead(mailbox) : require message.userId == user.id
attachment = message_attachments WHERE id = attId AND message_id = id → không có: 404
object = R2.get(attachment.r2Key) → không có: 404
inline = !download && (attachment.disposition == 'inline' || (preview && isPreviewable(type)))
```
| Header | Giá trị |
|---|---|
| (metadata R2) | `object.writeHttpMetadata(headers)` |
| `Content-Type` | `attachment.contentType` |
| `Content-Length` | `attachment.size` |
| `Content-Disposition` | `inline|attachment; filename="<tên, thay " \ CR LF bằng _>"` |
| `X-Content-Type-Options` | `nosniff` |
| `Content-Security-Policy` | `default-src 'none'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'unsafe-inline'; sandbox` |
| `Cache-Control` | `private, max-age=3600` |

`isPreviewable(type)`: `application/pdf`, `audio/*`, `video/*`, `image/*` **trừ** `image/svg+xml`, `text/plain*`, `application/json`, `application/xml`, `text/csv`.

Lỗi trả text thuần (`Unauthorized` 401, `Not found` 404).

### 3.5 `GET /api/messages/{id}/original` (canRead)
Trả nguyên raw MIME từ R2: `Content-Type: text/plain; charset=utf-8`, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`. Không có `rawR2Key` → 404 "Original source was not retained for this message." (mọi thư gửi từ composer). Object mất → 404 "Original source is unavailable."

## 4. Hiển thị HTML an toàn (client)

### 4.1 Thứ tự xử lý
1. **Thay `cid:`**: với mỗi attachment có `contentId` (bỏ `<>`), thay mọi chuỗi `cid:<contentId>` bằng `/api/messages/{id}/attachments/{attId}?preview=1`.
2. **Sanitize** (allowlist, dùng DOMParser):
   - Thẻ **giữ**: `a abbr address b blockquote br caption code col colgroup dd del div dl dt em figcaption figure h1 h2 h3 h4 h5 h6 hr i img ins kbd li ol p pre q s samp small span strong sub sup table tbody td tfoot th thead tr u ul`.
   - Thẻ **xoá cả nội dung**: `base button embed form iframe input link math meta object option script select style svg textarea`.
   - Thẻ khác: bỏ thẻ, giữ nội dung con.
   - Thuộc tính: toàn cục `dir lang style title`; `a[href]`; `img[alt height src width]`; còn lại bị xoá (kể cả mọi `on*`).
   - Thuộc tính bảng/danh sách (`table/td/th/col/li/ol/blockquote`: align, colspan, rowspan, width…) được giữ.
   - `a[href]` chỉ `http:`, `https:`, `mailto:`, `tel:` — khác thì xoá `href`; link giữ lại được thêm `target="_blank" rel="noopener noreferrer"`.
   - `img[src]` hợp lệ khi: bắt đầu `/api/messages/` (ảnh inline sau bước 1), data URI `image/gif|jpeg|png|webp`, hoặc `http(s)`; khác → xoá ảnh. Ảnh giữ lại được thêm `loading="lazy" referrerpolicy="no-referrer"`.
   - `style`: chỉ giữ thuộc tính CSS trong allowlist (màu, nền, border, margin, padding, font, kích thước, text-*…); **giá trị** chứa `url(`, `expression(`, `javascript:`, `@import`, `behavior:`, `-moz-binding` bị bỏ; `font-family` được nối thêm font của app làm fallback; không còn gì → xoá `style`.
   - Dòng "On … wrote:" trước `blockquote` được thêm khoảng cách trên.
3. **Tách trích dẫn** để thu gọn:
   - HTML có wrapper `<div class="mailflare-quote" data-mailflare-quote="1">` (do hệ thống tạo) → phần trước là body, phần trong là trích dẫn (`<details>`).
   - Mọi `blockquote` đứng sau phần tử có text khớp `/^On\b[\s\S]*\bwrote:\s*$/i` → bọc trong `<details class="email-quote-toggle">`.
   - Thư chỉ text: `splitRepliedEmailContent` (xem [00-nen-tang/06 §8](../00-nen-tang/06-quy-uoc-chung.md)) → các khối "Previous message … at …" lồng nhau.
4. Thư chỉ có text → hiển thị trong `<pre>`; các dòng file đính kèm đám mây kiểu Outlook (`1drv.ms`, `onedrive.live.com`, `*.sharepoint.com`) được tách thành mục "Cloud files (n)".

### 4.2 Hạn chế hiện tại
Ảnh `http(s)` bên ngoài được tải trực tiếp (chỉ có `referrerpolicy=no-referrer`) → vẫn là tracking pixel, lộ IP. Khuyến nghị: mặc định chặn ảnh ngoài, nút "Hiện ảnh"; hoặc proxy ảnh qua Worker.

## 5. Tiêu chí chấp nhận
- [ ] HTML chứa `<script>`, `onerror=`, `javascript:` không thực thi được.
- [ ] Ảnh inline `cid:` hiển thị đúng.
- [ ] PDF mở inline khi `preview=1`, tải về khi `download=1`; SVG luôn tải về (không preview).
- [ ] Người không có quyền mailbox → 404 cho chi tiết, attachment, nguồn.
- [ ] Mở thư → `read = 1`, có audit `email.read`.
- [ ] Thư gửi từ composer: "Xem nguồn" trả 404 với thông báo rõ ràng.
