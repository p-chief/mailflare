# Quên mật khẩu (Password reset qua email khôi phục)

> **[NÂNG CAO]** · Phụ thuộc: `users.reset_email`, domain có `sendingEnabled`

## 1. Mục tiêu
Cho người quên mật khẩu tự đặt lại bằng link gửi tới email khôi phục bên ngoài, an toàn trước dò tài khoản và tái sử dụng link.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Yêu cầu link, xác nhận đặt mật khẩu mới | Reset bằng SMS / câu hỏi bảo mật |
| Mail hệ thống (không lưu Sent) | Admin reset hộ (có ở quản lý tài khoản) |

## 3. Luồng
```
POST /api/auth/password-reset/request { email, turnstileToken? }
   (Turnstile nếu bật)
   user = users WHERE email = lower(trim(email))
   !user || disabled || !resetEmail → không làm gì
   token = "prt_" + nanoid; INSERT password_reset_tokens { tokenHash: sha256(token), expiresAt: now + 30' }
   link = `${origin}/reset-password?token=${encodeURIComponent(token)}`     // origin = APP_URL hoặc origin request
   sendSystemEmail({ to: resetEmail, subject: `Reset your ${appName} password`, text, html })
   không gửi được → console.warn (người dùng không biết)
   → 200 { ok: true }      // LUÔN như nhau → không dò được tài khoản

POST /api/auth/password-reset/confirm { token (8–200), password (8–128) }
   row = WHERE tokenHash = sha256(token) AND expiresAt > now AND usedAt IS NULL
   !row → 400 "This reset link is invalid or has expired. Request a new one."
   UPDATE users SET password_hash = bcrypt(password)
   UPDATE token SET used_at = now
   deleteUserSessions(userId)                 // đăng xuất mọi nơi
   audit 'auth.password_reset' { ipAddress }
   → 200 { ok: true }
```
Nội dung thư (text + HTML, escape): "Someone asked to reset the password for **<email>** on <appName>. Open this link within 30 minutes to choose a new password: <link>. If that was not you, you can ignore this message; the password stays as it is."

## 4. Mail hệ thống — `sendSystemEmail`
- Gửi thẳng `env.EMAIL.send`, **không** tạo dòng Sent, không contact, không webhook.
- Headers `Auto-Submitted: auto-generated`, `X-Auto-Response-Suppress: All`.
- From: mailbox cũ nhất (không disabled, owner không disabled) trên domain `sendingEnabled`, ưu tiên owner là **admin**; tên = `displayName ?? "Mailflare"`. Không có → trả false.

## 5. Quy tắc
- Nhiều token có thể cùng hiệu lực (không vô hiệu token cũ khi yêu cầu mới) — nên vô hiệu khi viết lại.
- Không có rate limit riêng cho request (chỉ Turnstile) — nên thêm theo email/IP.
- Token không bị xoá sau khi hết hạn (nên dọn bằng cron).

## 6. UI
- `/forgot-password`: ô email + Turnstile → luôn hiện "If that account has a recovery email, a reset link is on its way. It works for 30 minutes."
- `/reset-password?token=`: thiếu token → "Reset link missing"; mật khẩu mới + xác nhận (≥8, khớp) → "Password updated — You have been signed out everywhere."

## 7. Tiêu chí chấp nhận
- [ ] Email không tồn tại → 200, không gửi thư.
- [ ] Link dùng lần 2 → 400.
- [ ] Link sau 31 phút → 400.
- [ ] Sau reset, mọi session cũ → 401.
