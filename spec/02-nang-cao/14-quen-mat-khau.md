# Quên mật khẩu (đặt lại qua email khôi phục)

> **[NÂNG CAO]** · Phụ thuộc: `users.reset_email`, ít nhất một domain có `sending_enabled` · Liên quan: [01-co-ban/02-dang-nhap-phien.md](../01-co-ban/02-dang-nhap-phien.md) (rate limit, Turnstile), [01-co-ban/03-ho-so-mat-khau.md](../01-co-ban/03-ho-so-mat-khau.md) (đặt `resetEmail`)

## 1. Mục tiêu
Cho người quên mật khẩu tự đặt lại bằng link gửi tới email khôi phục bên ngoài, an toàn trước dò tài khoản, spam yêu cầu và tái sử dụng link.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Yêu cầu link, xác nhận đặt mật khẩu mới | Reset bằng SMS / câu hỏi bảo mật |
| Mail hệ thống (không lưu Sent) | Admin đặt lại hộ (ở quản lý tài khoản, [16](16-da-nguoi-dung-shared-mailbox.md)) |
| Dọn token hết hạn bằng cron | |

## 3. Dữ liệu
`password_reset_tokens`: `id`, `user_id` (CASCADE), `token_hash` UNIQUE (hex SHA-256), `expires_at`, `used_at`, `created_at`.

## 4. Luồng

### 4.1 `POST /api/auth/password-reset/request` (public)
Body `{ email, turnstileToken? }`, ≤ 16 KB.
```
body sai                                      → 400 "Invalid request"
rate limit theo IP: LOGIN_RATE_LIMIT.limit({ key: "password-reset:" + ip })
   bị chặn                                    → 429 "Too many requests. Try again shortly." + Retry-After: 60
Turnstile (nếu bật)                           → 400 "Verification failed. Please try again."
user = users WHERE email = lower(trim(email))
!user || user.disabled || !user.reset_email   → bỏ qua, trả 200
rate limit theo email: COUNT(*) password_reset_tokens WHERE user_id = user.id
   AND created_at > now − 60 phút ≥ 3          → bỏ qua, trả 200
token = "prt_" + nanoid()
một batch D1:
   UPDATE password_reset_tokens SET used_at = now
      WHERE user_id = user.id AND used_at IS NULL                              -- vô hiệu link cũ chưa dùng
   INSERT password_reset_tokens { user_id, token_hash: sha256hex(token), expires_at: now + 30 phút }
link = `${origin}/reset-password?token=${encodeURIComponent(token)}`   // origin = APP_URL, nếu không có thì origin của request
GUI_THU_HE_THONG({ to: user.reset_email, subject: "Reset your {APP_NAME} password", text, html })
   trả false / lỗi → log warning (người yêu cầu không biết)
→ 200 { ok: true }          // LUÔN giống nhau với mọi email → không dò được tài khoản
```
- Rate limit theo IP chạy **trước** tra user để áp như nhau cho email không tồn tại. `ip` = `cf-connecting-ip` hoặc `"unknown"`. Binding không có/ném lỗi → cho qua (log warning), giống đăng nhập.
- Rate limit theo email trả 200 im lặng để không tiết lộ tài khoản tồn tại. Token cũ được đánh dấu `used_at` (không xoá) nên vẫn được đếm.

Nội dung thư (text + HTML, mọi giá trị được escape): "Someone asked to reset the password for **<email>** on {APP_NAME}. Open this link within 30 minutes to choose a new password: <link>. If that was not you, you can ignore this message; the password stays as it is."

### 4.2 `POST /api/auth/password-reset/confirm` (public)
Body `{ token (8–200), password (8–128) }`.
```
row = password_reset_tokens WHERE token_hash = sha256hex(token) AND expires_at > now AND used_at IS NULL
!row → 400 "This reset link is invalid or has expired. Request a new one."
user disabled → 400 (cùng thông điệp)
UPDATE password_reset_tokens SET used_at = now WHERE id = row.id AND used_at IS NULL
   số dòng bị ảnh hưởng = 0 (request khác đã dùng token) → 400 (cùng thông điệp)
một batch D1:
   UPDATE users SET password_hash = bcrypt(password, 12) WHERE id = row.user_id
   DELETE sessions WHERE user_id = row.user_id              -- đăng xuất mọi nơi
ghi audit 'auth.password_reset' { ipAddress }
→ 200 { ok: true }
```
Việc "chiếm" token bằng `UPDATE … WHERE used_at IS NULL` bảo đảm hai request đồng thời cùng token chỉ có một request đổi được mật khẩu.

## 5. Mail hệ thống — `GUI_THU_HE_THONG({to, subject, text, html})`
- Gửi thẳng qua binding `EMAIL`, **không** tạo dòng Sent, không upsert contact, không webhook.
- Headers `Auto-Submitted: auto-generated`, `X-Auto-Response-Suppress: All`.
- From: mailbox cũ nhất (không disabled, owner không disabled) trên domain `sending_enabled`, ưu tiên mailbox có owner là **admin**; tên hiển thị = `display_name` của mailbox, nếu không có thì `{APP_NAME}`.
- Không tìm được mailbox gửi → trả false. Gửi lỗi → trả false.

## 6. Dọn dẹp (cron)
Tác vụ trong cron hằng ngày ([00-nen-tang/02-kien-truc-cloudflare.md](../00-nen-tang/02-kien-truc-cloudflare.md)):
```
DELETE FROM password_reset_tokens WHERE expires_at < now − 1 ngày
```
Giữ thêm 1 ngày sau hạn để rate limit theo email (60 phút) luôn đếm đúng.

## 7. UI
- `/forgot-password`: ô email + Turnstile → luôn hiện "If that account has a recovery email, a reset link is on its way. It works for 30 minutes." (429 → "Too many requests. Try again shortly.").
- `/reset-password?token=`: thiếu token → "Reset link missing"; mật khẩu mới + xác nhận (≥8, khớp) → "Password updated — You have been signed out everywhere." kèm link đăng nhập.

## 8. Tiêu chí chấp nhận
- [ ] Email không tồn tại → 200, không gửi thư.
- [ ] Yêu cầu link hai lần → link đầu không dùng được (400), link sau dùng được.
- [ ] Link dùng lần 2 → 400.
- [ ] Link sau 31 phút → 400.
- [ ] Yêu cầu lần thứ 4 trong 60 phút cho cùng email → 200 nhưng không gửi thư.
- [ ] Hơn 20 yêu cầu/phút từ một IP → 429.
- [ ] Sau reset, mọi session cũ → 401.
- [ ] Token hết hạn quá 1 ngày bị cron xoá.
