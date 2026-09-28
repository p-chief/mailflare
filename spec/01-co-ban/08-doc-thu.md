# Đọc thư: chi tiết, attachment, nguồn gốc, hiển thị an toàn

> **[CƠ BẢN]** · Unsubscribe là **[TÙY CHỌN]** → [03-tuy-chon/07](../03-tuy-chon/07-tien-ich-giao-dien.md)
> Phụ thuộc: [00-nen-tang/05-phan-quyen.md](../00-nen-tang/05-phan-quyen.md) · Liên quan: [13-hoi-thoai.md](13-hoi-thoai.md)

## 1. Mục tiêu
Cho người có quyền đọc xem đầy đủ nội dung thư một cách **an toàn** (không XSS, không lộ file, không bị theo dõi qua ảnh bên ngoài), tải/xem trước file đính kèm, xem MIME gốc, và đánh dấu đã đọc.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Chi tiết thư, metadata, đánh dấu đọc | Hội thoại ([13-hoi-thoai.md](13-hoi-thoai.md)) |
| Tải/xem trước attachment | Quét virus |
| Xem nguồn raw | Proxy ảnh bên ngoài qua Worker |
| Sanitize HTML, thay `cid:` | |
| Chặn ảnh bên ngoài mặc định, nút "Hiện ảnh" | |

## 3. Quyền
| Thao tác | Quyền cần |
|---|---|
| Xem chi tiết, metadata, nguồn gốc, đánh dấu đọc | `canRead` trên mailbox của thư |
| Tải attachment | `canRead` trên mailbox; thư không có mailbox → chỉ người sở hữu (`message.userId == user.id`) |

Không có quyền và không tồn tại đều trả **404** (không để lộ sự tồn tại của thư).

## 4. API

### 4.1 `GET /api/messages/{id}` (session, canRead)
```json
{ "message": { "id": "msg_…", "userId": "usr_…", "mailboxId": "mbx_…", "direction": "inbound",
               "providerMessageId": "…", "folderId": null,
               "fromAddr": "…", "toAddr": "…", "ccAddr": null, "bccAddr": null,
               "subject": "…", "snippet": "…", "textBody": "…", "htmlBody": "…",
               "status": "received", "read": true, "starred": false, "snoozedUntil": null,
               "threadId": "…", "inReplyTo": null, "references": null,
               "spamScore": null, "spamVerdict": null, "spamSignals": null,
               "createdAt": "…",
               "fromContactName": "…|null", "toContactName": "…|null" },
  "attachments": [ { "id": "att_…", "messageId": "msg_…", "filename": "…", "contentType": "…",
                     "size": 1234, "disposition": "attachment|inline", "contentId": "…|null" } ],
  "unsubscribeUrl": "https://…|mailto:…|null" }
```
- `message` chứa mọi cột của `messages` (dạng camelCase) **trừ** `raw_r2_key` — trường này **không bao giờ** được trả ra client ở bất kỳ endpoint nào. Nội dung thư (`textBody`, `htmlBody`) nằm trong `message`; không có trường `body` riêng.
- `fromContactName` / `toContactName`: tính như danh sách thư ([07-danh-sach-dem-thu.md §3.3](07-danh-sach-dem-thu.md)).
- Không có quyền / không tồn tại / thư không có mailbox → **404** `{error: "Not found"}`.

**`unsubscribeUrl`** (TÙY CHỌN): đọc **64 KB đầu** của raw MIME từ R2 (range request), tách khối header (đến dòng trống đầu tiên), gộp các dòng header bị gấp (folded), lấy mọi header `List-Unsubscribe`; ứng viên = các giá trị trong `<…>` và các phần tách bằng dấu phẩy; chỉ giữ scheme `http:`, `https:`, `mailto:`; ưu tiên http(s), sau đó mailto. Thư không có raw → `null`.

### 4.2 `GET /api/messages/{id}/metadata` (canRead)
Chỉ `{ attachments, unsubscribeUrl }` — dùng khi client đã có nội dung thư (vd khi hiển thị trong hội thoại).

### 4.3 `POST /api/messages/{id}/read` (canRead)
`UPDATE messages SET read = 1`, ghi audit `email.read` `{actor, mailboxId, messageId}`. Trả `{success:true}` hoặc 404. Client gọi **khi mở thư**. Đánh dấu chưa đọc: bulk action `unread` ([09-to-chuc-thu.md](09-to-chuc-thu.md)).

### 4.4 `GET /api/messages/{id}/attachments/{attId}[?preview=1][&download=1]`
```
message = messages WHERE id
!message → 404
message.mailboxId ? require canRead(mailbox) : require message.userId == user.id
attachment = message_attachments WHERE id = attId AND message_id = id → không có: 404
object = R2.get(attachment.r2_key) → không có: 404
inline = !download && (attachment.disposition == 'inline' || (preview && XEM_TRUOC_DUOC(attachment.content_type)))
```
| Header | Giá trị |
|---|---|
| (metadata R2) | metadata HTTP của object R2 (`writeHttpMetadata`) |
| `Content-Type` | `attachment.content_type` |
| `Content-Length` | `attachment.size` |
| `Content-Disposition` | `inline|attachment; filename="<tên, thay " \ CR LF bằng _>"` |
| `X-Content-Type-Options` | `nosniff` |
| `Content-Security-Policy` | `default-src 'none'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'unsafe-inline'; sandbox` |
| `Cache-Control` | `private, max-age=3600` |

`XEM_TRUOC_DUOC(type)` đúng khi type là: `application/pdf`, `audio/*`, `video/*`, `image/*` **trừ** `image/svg+xml`, `text/plain*`, `application/json`, `application/xml`, `text/csv`. Loại khác (kể cả SVG, HTML) luôn trả `attachment`.

Lỗi trả text thuần (`Unauthorized` 401, `Not found` 404).

### 4.5 `GET /api/messages/{id}/original` (canRead)
Trả nguyên raw MIME từ R2: `Content-Type: text/plain; charset=utf-8`, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`.
- Thư không có `raw_r2_key` → 404 "Original source was not retained for this message." (mặc định là mọi thư gửi từ composer — xem [11-gui-thu.md §4.4](11-gui-thu.md)).
- Có key nhưng object R2 mất → 404 "Original source is unavailable."

## 5. Hiển thị HTML an toàn (client)

### 5.1 Thứ tự xử lý
1. **Thay `cid:`**: với mỗi attachment có `contentId` (bỏ `<>`), thay mọi chuỗi `cid:<contentId>` bằng `/api/messages/{id}/attachments/{attId}?preview=1`.
2. **Sanitize** (allowlist, phân tích bằng DOMParser, không dùng regex trên HTML):
   - Thẻ **giữ**: `a abbr address b blockquote br caption code col colgroup dd del div dl dt em figcaption figure h1 h2 h3 h4 h5 h6 hr i img ins kbd li ol p pre q s samp small span strong sub sup table tbody td tfoot th thead tr u ul`.
   - Thẻ **xoá cả nội dung**: `base button embed form iframe input link math meta object option script select style svg textarea`.
   - Thẻ khác: bỏ thẻ, giữ nội dung con.
   - Thuộc tính: toàn cục `dir lang style title`; `a[href]`; `img[alt height src width]`; thuộc tính bảng/danh sách (`table/td/th/col/li/ol/blockquote`: `align`, `colspan`, `rowspan`, `width`, `valign`, `start`, `type`…); còn lại bị xoá (kể cả mọi `on*`, `srcset`, `background`).
   - `a[href]` chỉ chấp nhận `http:`, `https:`, `mailto:`, `tel:` — khác thì xoá `href`. Mọi link giữ lại được đặt `target="_blank" rel="noopener noreferrer"`.
   - `img[src]` hợp lệ khi: bắt đầu `/api/messages/` (ảnh inline sau bước 1), data URI `image/gif|jpeg|png|webp`, hoặc `http(s)` (ảnh bên ngoài — xử lý ở §5.2); khác → xoá thẻ ảnh. Ảnh giữ lại được thêm `loading="lazy" referrerpolicy="no-referrer"`.
   - `style`: chỉ giữ thuộc tính CSS trong allowlist (màu, nền màu, border, margin, padding, font, kích thước, `text-*`…); **giá trị** chứa `url(`, `expression(`, `javascript:`, `@import`, `behavior:`, `-moz-binding` bị bỏ; `font-family` được nối thêm font của ứng dụng làm fallback; không còn khai báo nào → xoá `style`.
   - Dòng "On … wrote:" đứng ngay trước `blockquote` được thêm khoảng cách phía trên.
3. **Chặn ảnh bên ngoài** (§5.2).
4. **Tách trích dẫn** để thu gọn:
   - HTML có wrapper `<div class="app-quote" data-app-quote="1">` (do hệ thống tạo khi reply/forward) → phần trước là body, phần bên trong là trích dẫn (hiển thị trong `<details>`).
   - Mọi `blockquote` đứng sau phần tử có text khớp `/^On\b[\s\S]*\bwrote:\s*$/i` → bọc trong `<details class="email-quote-toggle">`.
   - Thư chỉ có text: dùng thủ tục tách "nội dung mới / phần trích dẫn" của văn bản thuần ([00-nen-tang/06 §8](../00-nen-tang/06-quy-uoc-chung.md)) → hiển thị các khối "Previous message … at …" lồng nhau, thu gọn.
5. Thư chỉ có text → hiển thị trong `<pre>` (giữ xuống dòng, tự ngắt dòng); các dòng link file đám mây kiểu Outlook (`1drv.ms`, `onedrive.live.com`, `*.sharepoint.com`) được tách thành mục "Cloud files (n)".

### 5.2 Ảnh bên ngoài
Ảnh `http(s)` bên ngoài là kênh theo dõi (tracking pixel, lộ IP, xác nhận đã đọc), nên **mặc định bị chặn**:
- Khi sanitize, ảnh có `src` `http(s)` được đổi thành `data-app-remote-src="<url>"` và **không** có `src` → trình duyệt không tải. Ảnh inline (`/api/messages/…`) và data URI hợp lệ luôn hiển thị.
- Nếu thư có ≥1 ảnh bị chặn → hiện thanh thông báo phía trên nội dung: "Images from external sources are hidden." kèm nút **"Hiện ảnh"** (chuỗi UI: "Show images").
- Bấm "Hiện ảnh" → khôi phục `src` từ `data-app-remote-src` cho **thư đó**, chỉ trong lần xem này (mở lại thư → lại bị chặn).
- **[TÙY CHỌN]** Nút "Always show images from <địa chỉ người gửi>": lưu địa chỉ người gửi (lowercase) vào danh sách tin cậy của người xem; thư từ người gửi trong danh sách hiển thị ảnh ngay. Danh sách lưu trong bộ nhớ trình duyệt (khoá `app-remote-images-senders`) hoặc trong cài đặt người dùng nếu cần đồng bộ nhiều thiết bị. Thư có `spamVerdict = spam` hoặc nằm trong Spam **không** được tự hiện ảnh kể cả khi người gửi được tin cậy.
- Khi đã cho hiện, ảnh vẫn giữ `referrerpolicy="no-referrer"`.

### 5.3 Cô lập hiển thị
Nội dung HTML đã sanitize được render trong vùng tách biệt khỏi DOM ứng dụng (vd iframe `sandbox` không có `allow-scripts`, hoặc Shadow DOM) để CSS của thư không phá giao diện và CSS ứng dụng không làm sai thư.

## 6. Lỗi & biên
| Tình huống | Hành vi |
|---|---|
| Thư không tồn tại / không quyền | 404 cho chi tiết, metadata, attachment, nguồn gốc |
| Attachment có dòng DB nhưng object R2 mất | 404 |
| `contentId` không khớp attachment nào | chuỗi `cid:` giữ nguyên → ảnh bị xoá ở bước sanitize (scheme không hợp lệ) |
| Tên file chứa `"`, `\`, CR, LF | thay bằng `_` trong `Content-Disposition` |
| Header `List-Unsubscribe` nằm sau 64 KB đầu | `unsubscribeUrl = null` |

## 7. Tiêu chí chấp nhận
- [ ] HTML chứa `<script>`, `onerror=`, `javascript:` không thực thi được.
- [ ] Ảnh inline `cid:` hiển thị đúng.
- [ ] Ảnh `https://` bên ngoài không được tải khi mở thư; bấm "Hiện ảnh" → ảnh tải; mở lại thư → lại bị chặn.
- [ ] Mọi link trong thư mở tab mới với `rel="noopener noreferrer"`.
- [ ] PDF mở inline khi `preview=1`, tải về khi `download=1`; SVG luôn tải về (không preview).
- [ ] Người không có quyền mailbox → 404 cho chi tiết, attachment, nguồn.
- [ ] Response chi tiết không chứa `rawR2Key` và không có trường `body`.
- [ ] Mở thư → `read = 1`, có audit `email.read`.
- [ ] Thư gửi từ composer (không lưu raw): "Xem nguồn" trả 404 với thông báo rõ ràng.

## 8. Ghi chú triển khai
- Nên chạy sanitize một lần khi mở thư và cache kết quả theo `message.id` phía client; nút "Hiện ảnh" chỉ thay thuộc tính trên DOM đã sanitize, không sanitize lại.
- Range request R2 cho `unsubscribeUrl`: `BUCKET.get(key, { range: { offset: 0, length: 65536 } })`.
