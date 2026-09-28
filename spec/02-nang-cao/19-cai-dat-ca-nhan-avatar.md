# Cài đặt cá nhân & avatar

> Cài đặt: **[NÂNG CAO]** · Avatar: **[TÙY CHỌN]** · Phụ thuộc: [01-co-ban/03-ho-so-mat-khau.md](../01-co-ban/03-ho-so-mat-khau.md) (đồng bộ danh tính) · Liên quan: phím tắt → [03-tuy-chon/07-tien-ich-giao-dien.md](../03-tuy-chon/07-tien-ich-giao-dien.md), [10-danh-ba-va-chan.md](10-danh-ba-va-chan.md), [16-da-nguoi-dung-shared-mailbox.md](16-da-nguoi-dung-shared-mailbox.md)

## 1. Mục tiêu
Gom các cài đặt riêng của từng người dùng (lưu trên server hoặc trong trình duyệt) và cho phép đặt ảnh đại diện cho user, mailbox, tài khoản do admin quản lý và liên hệ — ảnh luôn đồng bộ giữa hồ sơ, primary mailbox và danh bạ.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Cài đặt spam, phím tắt, forwarding; cài đặt hiển thị cục bộ | Đồng bộ cài đặt hiển thị giữa thiết bị (xem §4) |
| Avatar user / mailbox / tài khoản / liên hệ, resize phía client | Cắt ảnh, ảnh động, Gravatar |

## 3. Cài đặt lưu trên server (cột `users`)
| Cài đặt | API (session) | Mặc định |
|---|---|---|
| Bộ lọc spam | `GET/PATCH /api/settings/spam {enabled}` ([11](11-bo-loc-spam.md)) | true |
| Phím tắt | `GET/PATCH /api/settings/shortcuts {enabled}` | true |
| Forwarding | `PATCH /api/settings/forwarding {forwardingEmail}` ([08](08-chuyen-tiep-tai-khoan.md)) | null |
| Hồ sơ, mật khẩu, 2FA | xem [01-co-ban/03](../01-co-ban/03-ho-so-mat-khau.md), [15](15-xac-thuc-2-lop.md) | |

Body sai (không phải boolean / email hợp lệ) → 400.

## 4. Cài đặt lưu ở trình duyệt (localStorage)
| Khoá | Ý nghĩa | Mặc định |
|---|---|---|
| `app-conversation-view` | gộp hội thoại (`on`/`off`) | on |
| `app-latest-messages-first` | thứ tự thư trong hội thoại | on |
| `selected-mailbox-id` | mailbox đang chọn | primary mailbox |
| `app-sidebar-minimal:<userId>` | thu gọn sidebar | tắt |
| `app-column-width:sidebar:<userId>`, `app-column-width:message-list:<userId>` | độ rộng cột (px) | 260 / 360 |

Mọi lần đọc/ghi bọc try/catch; không đọc được → dùng mặc định.

**Quyết định thiết kế:** mặc định các cài đặt hiển thị trên chỉ lưu cục bộ (mỗi trình duyệt một giá trị). Phương án thay thế: thêm cột `users.conversation_view` và `users.latest_messages_first` cùng `GET/PATCH /api/settings/display` để đồng bộ giữa thiết bị, localStorage chỉ làm cache.

## 5. Avatar

### 5.1 Tải lên (client)
Ảnh nguồn jpeg/png/webp/gif ≤ 10 MB (sai loại → "Use a JPEG, PNG, WebP, or GIF image"; quá lớn → "Image must be 10 MB or smaller") → giải mã bằng `createImageBitmap` → tạo 2 bản **WebP**, giữ tỉ lệ, không cắt:
- `file`: cạnh dài ≤ 512 px, chất lượng 0.85, ≤ 1 MB;
- `preview`: cạnh dài ≤ 16 px, chất lượng 0.7, ≤ 32 KB.

Gửi `multipart/form-data` với hai trường `file` + `preview`.

### 5.2 Lưu & phục vụ
- Server chỉ nhận đúng 2 file `image/webp` trong giới hạn trên (khác → 400 "A resized WebP image and preview are required").
- R2: bản chính tại `<key>`, bản nhỏ tại `<key>:preview`; cột `avatar_key` của chủ thể lưu `<key>`.
- GET: `?variant=preview` → bản nhỏ; headers `Content-Type: image/webp`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; img-src 'self'; sandbox`, `ETag` = etag của object R2 (trả 304 khi `If-None-Match` khớp).
- Cache: URL có `?v=<phiên bản>` → `Cache-Control: private, max-age=31536000, immutable`; không có → `private, no-cache`. Phiên bản ảnh đổi mỗi lần upload/xoá (ví dụ etag hoặc thời điểm cập nhật trả kèm trong API liệt kê), nên client luôn tạo URL mới sau khi đổi.
- Không có avatar → 404; client hiển thị chữ cái đầu trên nền màu băm từ email/tên (10 màu pastel, chữ `#202124`).

### 5.3 Chủ thể, khoá R2 & endpoint
| Chủ thể | Khoá | Endpoint | Quyền & hiệu ứng |
|---|---|---|---|
| User | `avatars/<userId>` | `GET/POST/DELETE /api/profile/avatar` | chính user; POST/DELETE chạy thủ tục đồng bộ danh tính cá nhân với `avatar_key` mới/null |
| Mailbox | `mailbox-avatars/<mailboxId>` | `GET /api/mailboxes/{id}/avatar` (canRead), `POST` (full_access) | mailbox là **primary** → ghi vào avatar user (`avatars/<ownerId>`) và chạy đồng bộ danh tính của owner; mailbox khác → chỉ cập nhật `mailboxes.avatar_key` |
| Tài khoản (admin) | `avatars/<accountId>` | `GET/POST /api/accounts/{id}/avatar` | tài khoản thuộc tập được quản lý của admin ([16 §3](16-da-nguoi-dung-shared-mailbox.md), khác → 404); POST chạy thủ tục đồng bộ danh tính cá nhân **của tài khoản đó** (users, primary mailbox, contact tự thân) |
| Liên hệ | `contact-avatars/<userId>/<encodeURIComponent(email)>` | `GET/POST/DELETE /api/contacts/avatar?mailboxId&address` | canRead (GET) / full_access (POST/DELETE) trên mailbox; `userId` = owner mailbox; địa chỉ là danh tính của chính owner → ghi vào avatar user, chỉ owner được đổi (khác → 403 "Only the account owner can change this contact") |

Thủ tục đồng bộ danh tính cá nhân: [01-co-ban/03-ho-so-mat-khau.md §3](../01-co-ban/03-ho-so-mat-khau.md).

## 6. Lỗi & biên
- Ghi R2 lỗi → 500, không đổi `avatar_key`.
- DELETE khi không có avatar → 200 (idempotent), xoá cả `<key>` và `<key>:preview`.
- Upload thay ảnh cũ ghi đè cùng khoá; phiên bản mới làm URL cũ hết hiệu lực cache.

## 7. Tiêu chí chấp nhận
- [ ] Đổi avatar hồ sơ → primary mailbox và contact của chính mình hiển thị avatar mới.
- [ ] Admin đổi avatar tài khoản bob → hồ sơ, primary mailbox và contact tự thân của bob hiển thị ảnh mới.
- [ ] Upload PNG 5 MB → client resize, server nhận WebP ≤ 1 MB.
- [ ] Upload file không phải WebP trực tiếp qua API → 400.
- [ ] GET avatar với `If-None-Match` đúng etag → 304.
