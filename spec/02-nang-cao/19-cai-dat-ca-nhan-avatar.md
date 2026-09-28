# Cài đặt cá nhân & avatar

> Cài đặt: **[NÂNG CAO]** · Avatar: **[TÙY CHỌN]** · Phím tắt → [03-tuy-chon/07](../03-tuy-chon/07-tien-ich-giao-dien.md)

## 1. Cài đặt lưu trên server (cột `users`)
| Cài đặt | API | Mặc định |
|---|---|---|
| Bộ lọc spam | `GET/PATCH /api/settings/spam {enabled}` | true |
| Phím tắt | `GET/PATCH /api/settings/shortcuts {enabled}` | true |
| Forwarding | `PATCH /api/settings/forwarding {forwardingEmail}` | null |
| Hồ sơ, mật khẩu, 2FA | xem file tương ứng | |

## 2. Cài đặt lưu ở trình duyệt (localStorage)
| Khoá | Ý nghĩa | Mặc định |
|---|---|---|
| `mailflare-conversation-view` | gộp hội thoại (`on`/`off`) | on |
| `mailflare-latest-messages-first` | thứ tự thư trong hội thoại | on |
| `selected-mailbox-id` | mailbox đang chọn | primary |
| `mailflare-sidebar-minimal:<userId>` | thu gọn sidebar | |
| `mailflare-column-width:sidebar:<userId>`, `…:message-list:<userId>` | độ rộng cột | 260 / 360 |
Khi viết lại, có thể đưa 2 cài đặt đầu lên server để đồng bộ giữa thiết bị.

## 3. Avatar

### 3.1 Tải lên (client)
Ảnh nguồn jpeg/png/webp/gif ≤ 10 MB ("Use a JPEG, PNG, WebP, or GIF image" / "Image must be 10 MB or smaller") → `createImageBitmap` → 2 bản **WebP**: cạnh dài ≤ 512 px chất lượng 0.85 (`file`, ≤ 1 MB) và ≤ 16 px chất lượng 0.7 (`preview`, ≤ 32 KB), giữ tỉ lệ, không cắt. Gửi multipart `file` + `preview`.

### 3.2 Lưu & phục vụ
- Server chỉ nhận đúng 2 file `image/webp` trong giới hạn (khác → 400 "A resized WebP image and preview are required").
- R2: `<key>` và `<key>:preview`.
- GET: `?variant=preview` → bản nhỏ; header `X-Content-Type-Options: nosniff`, `CSP: default-src 'none'; img-src 'self'; sandbox`, `ETag` (304 khi `If-None-Match` khớp), `Cache-Control: private, max-age=31536000, immutable` khi có `?v=`, ngược lại `private, no-cache`.
- Không có avatar → hiển thị chữ cái đầu trên nền màu băm (10 màu pastel, chữ `#202124`).

### 3.3 Khoá R2 & endpoint
| Chủ thể | Khoá | Endpoint | Quyền |
|---|---|---|---|
| User | `avatars/<userId>` | `GET/POST/DELETE /api/profile/avatar` | chính user; POST/DELETE chạy `syncPersonalIdentity` |
| Mailbox | `mailbox-avatars/<mailboxId>` | `GET /api/mailboxes/{id}/avatar` (canRead), `POST` (canManage) | primary mailbox → ghi vào **avatar user** (`avatars/<ownerId>`) |
| Tài khoản (admin) | `avatars/<accountId>` | `GET/POST /api/accounts/{id}/avatar` | admin tạo tài khoản; POST ghi thẳng `users.avatar_key` (không sync — nên sync) |
| Liên hệ | `contact-avatars/<userId>/<encodeURIComponent(email)>` | `GET/POST/DELETE /api/contacts/avatar?mailboxId&address` | canRead / canManage; địa chỉ của chính owner → avatar user (chỉ owner được đổi) |

## 4. Tiêu chí chấp nhận
- [ ] Đổi avatar hồ sơ → primary mailbox và contact của chính mình hiển thị avatar mới.
- [ ] Upload PNG 5 MB → client resize, server nhận WebP ≤ 1 MB.
- [ ] Upload file không phải WebP trực tiếp qua API → 400.
