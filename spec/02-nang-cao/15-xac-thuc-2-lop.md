# Xác thực hai lớp (TOTP) & mã khôi phục

> **[NÂNG CAO]** · Phụ thuộc: [01-co-ban/02-dang-nhap-phien.md](../01-co-ban/02-dang-nhap-phien.md) · Liên quan: [18-nhat-ky-audit.md](18-nhat-ky-audit.md), [04-giao-dien/01-xac-thuc-khoi-tao.md](../04-giao-dien/01-xac-thuc-khoi-tao.md)

## 1. Mục tiêu
Yêu cầu mã 6 số từ ứng dụng authenticator (hoặc mã khôi phục dùng một lần) sau mật khẩu khi người dùng đã bật 2FA; mỗi mã TOTP chỉ dùng được một lần và secret không bao giờ nằm ở dạng rõ trong DB.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| TOTP RFC 6238, QR, 8 mã khôi phục | WebAuthn/passkey, SMS |
| Bước 2 đăng nhập qua challenge | Bắt buộc 2FA theo chính sách admin |
| Bật / tắt / cấp lại mã | Áp 2FA cho API key |
| Mã hoá secret bằng khoá của Worker | Xoay khoá tự động |

## 3. Dữ liệu
| Nơi | Cột |
|---|---|
| `users` | `totp_secret` (bản mã hoá, §4), `totp_enabled` (false), `totp_confirmed_at`, `totp_last_counter` (int null — bước thời gian của mã TOTP gần nhất đã được chấp nhận) |
| `mfa_recovery_codes` | `id` `rc_…`, `user_id` (CASCADE), `code_hash` UNIQUE, `used_at`, `created_at` |
| `login_challenges` | `id`, `user_id` (CASCADE), `token_hash` UNIQUE, `expires_at`, `created_at` |

Cấu hình: Worker secret `TOTP_ENCRYPTION_KEY` — 32 byte ngẫu nhiên mã hoá base64 (tạo bằng `openssl rand -base64 32`, đặt bằng `wrangler secret put TOTP_ENCRYPTION_KEY`).

## 4. Mã hoá secret (AES-256-GCM qua Web Crypto)
```
MA_HOA_SECRET(userId, secretBase32):
   key = khoá AES-GCM nhập dạng raw từ base64decode(TOTP_ENCRYPTION_KEY)     // Web Crypto; phải đúng 32 byte, nếu khác → lỗi cấu hình
   iv  = 12 byte ngẫu nhiên
   ct  = AES-GCM encrypt(key, iv, additionalData = utf8(userId), plaintext = utf8(secretBase32))   // tag 128 bit nằm cuối ct
   return "v1:" + base64url(iv) + ":" + base64url(ct)

GIAI_MA_SECRET(userId, stored):
   tách "v1", iv, ct; tiền tố khác "v1" → lỗi
   return utf8decode(AES-GCM decrypt(key, iv, additionalData = utf8(userId), ct))
```
- `additionalData = userId` gắn bản mã với đúng user: chép `totp_secret` sang user khác sẽ không giải mã được.
- Thiếu `TOTP_ENCRYPTION_KEY` → `POST /api/settings/mfa/enroll` trả 500 "Two-factor authentication is not configured"; trang Security ẩn nút bật.
- Giải mã lỗi (sai khoá, dữ liệu hỏng) → coi mã TOTP là sai và log lỗi; người dùng vẫn đăng nhập được bằng mã khôi phục.
- Tiền tố phiên bản `v1` để sau này đổi khoá: thêm `v2` với khoá mới, giải mã theo tiền tố, mã hoá lại khi người dùng xác minh thành công.

## 5. TOTP (RFC 6238, cài trực tiếp bằng Web Crypto)
- Secret: 20 byte ngẫu nhiên → base32 (A–Z, 2–7, không padding).
- `HOTP(secret, counter)`: HMAC-SHA1(key = base32decode(secret), msg = counter 8 byte big-endian) → dynamic truncation (RFC 4226 §5.3) → `% 10^6`, thêm 0 bên trái đủ 6 chữ số.
- `counter hiện tại = floor(unix_seconds / 30)`.

### 5.1 Xác minh — `KIEM_TRA_TOTP(user, code)`
```
code = bỏ khoảng trắng(code); !/^\d{6}$/ → false
secret = GIAI_MA_SECRET(user.id, user.totp_secret)          // lỗi → false
c0 = counter hiện tại
matched = c trong [c0 − 1, c0, c0 + 1] mà HOTP(secret, c) == code (so sánh constant-time, thử cả 3)
!matched → false
user.totp_last_counter != null && matched ≤ user.totp_last_counter → false        // mã đã dùng hoặc cũ hơn mã đã dùng
UPDATE users SET totp_last_counter = matched
   WHERE id = user.id AND (totp_last_counter IS NULL OR totp_last_counter < matched)
số dòng bị ảnh hưởng = 0 → false                              // request đồng thời đã dùng mã này
→ true
```
Kết quả: một mã chỉ đăng nhập được một lần, kể cả trong cùng cửa sổ 30 s hay khi bị nghe lén và dùng lại ngay.

### 5.2 URI & QR
`otpauth://totp/<issuer>:<email>?secret=<base32>&issuer=<issuer>&algorithm=SHA1&digits=6&period=30` với `issuer = {APP_NAME}` (URL-encode). QR dạng SVG (margin 1, mức sửa lỗi M; ví dụ thư viện `qrcode`).

## 6. Mã khôi phục
- 8 mã, mỗi mã 10 ký tự từ bảng `abcdefghjkmnpqrstuvwxyz23456789` (không có 0/o/1/i/l), hiển thị `xxxxx-xxxxx`.
- Lưu `sha256hex(chuẩn hoá(code))`, chuẩn hoá = lowercase, bỏ mọi ký tự không phải chữ/số.
- Cấp mới = xoá toàn bộ mã cũ của user rồi chèn 8 mã mới (một batch).
- Dùng — `DUNG_MA_KHOI_PHUC(user, code)`: `UPDATE mfa_recovery_codes SET used_at = now WHERE user_id = ? AND code_hash = ? AND used_at IS NULL`; đúng 1 dòng bị ảnh hưởng → true, ngược lại false.

## 7. API (session; mọi thao tác nhạy cảm kiểm tra lại mật khẩu)
| Method | Path | Body | Hành vi |
|---|---|---|---|
| GET | `/api/settings/mfa` | – | `{enabled, confirmedAt, recoveryCodesLeft}` |
| POST | `/api/settings/mfa/enroll` | `{password}` | sai mật khẩu → 400 "Password is incorrect"; đã bật → 400 "Two-factor authentication is already on"; sinh secret mới, lưu `totp_secret = MA_HOA_SECRET(…)`, `totp_enabled = false`, `totp_last_counter = null` → `{secret, otpauthUrl, qrSvg}` (`Cache-Control: no-store`) |
| POST | `/api/settings/mfa/confirm` | `{code (6–12)}` | chưa enroll → 400 "Start enrolment first"; đã bật → 400 "Two-factor authentication is already on"; `KIEM_TRA_TOTP` sai → 400 "That code did not match. Check the time on your device and try again."; đúng → `totp_enabled = true, totp_confirmed_at = now`, cấp 8 mã khôi phục, **xoá mọi session khác** (giữ session hiện tại) → `{recoveryCodes}` (no-store) |
| POST | `/api/settings/mfa/recovery-codes` | `{password}` | chưa bật → 400; sai mật khẩu → 400 "Password is incorrect"; cấp lại bộ mã → `{recoveryCodes}` (no-store) |
| POST | `/api/settings/mfa/disable` | `{password, code (6–32)}` | sai mật khẩu → 400 "Password is incorrect"; code phải qua `KIEM_TRA_TOTP` **hoặc** `DUNG_MA_KHOI_PHUC` → không: 400 "That code did not match"; đặt `totp_secret = null, totp_enabled = false, totp_confirmed_at = null, totp_last_counter = null`, xoá mọi mã khôi phục → `{ok: true}` |

## 8. Đăng nhập hai bước
```
POST /api/auth/login → mật khẩu đúng, user không disabled, totp_enabled = true
   token = "mfa_" + nanoid()
   INSERT login_challenges { user_id, token_hash: sha256hex(token), expires_at: now + 5 phút }
   → 200 { ok:true, mfaRequired:true, challengeToken: token }     (no-store, KHÔNG set cookie)

POST /api/auth/mfa/verify { challengeToken (8–200), code (6–32) }   (public)
   rate limit theo IP (chung LOGIN_RATE_LIMIT với login)  → 429 "Too many login attempts. Try again shortly."
   challenge = login_challenges WHERE token_hash = sha256hex(challengeToken) AND expires_at > now
   !challenge → 401 "This sign-in attempt has expired. Start again."
   user disabled → 403 "Account disabled"
   method = KIEM_TRA_TOTP(user, code) ? "totp" : DUNG_MA_KHOI_PHUC(user, code) ? "recovery" : null
   null → 401 "That code did not match"          (challenge GIỮ NGUYÊN → thử lại được trong 5 phút)
   DELETE challenge; tạo session; ghi audit auth.login + auth.mfa_verified {method}
   → 200 { ok:true, token, redirect:"/inbox", method } + Set-Cookie ep_session
```
- Mật khẩu không bao giờ phải giữ ở client giữa hai bước.
- Challenge hết hạn được xoá bởi cron dọn dẹp hằng ngày: `DELETE FROM login_challenges WHERE expires_at < now`.

## 9. UI
- Login: sau mật khẩu chuyển sang bước "Two-factor authentication" (ô mã `inputMode=numeric`, `autocomplete=one-time-code`, cho nhập mã khôi phục); lỗi chứa "expired" → quay về bước mật khẩu; nút "Back to sign in".
- Settings → Account → Security: bật (mật khẩu → quét QR / "Can't scan?" hiện key → nhập mã → hiển thị & copy 8 mã, "Other sessions have been signed out."); khi đã bật: số mã còn lại, "New recovery codes", "Turn off".

## 10. Tiêu chí chấp nhận
- [ ] Bật 2FA → login trả `mfaRequired`, không set cookie.
- [ ] Mã lệch 30 s vẫn được chấp nhận; lệch 90 s bị từ chối.
- [ ] Dùng cùng một mã TOTP hợp lệ để đăng nhập lần hai trong cùng 30 s → 401 "That code did not match".
- [ ] Mã khôi phục dùng được đúng một lần.
- [ ] Challenge quá 5 phút → 401.
- [ ] Tắt 2FA cần cả mật khẩu và mã.
- [ ] Cột `totp_secret` trong DB có dạng `v1:…:…`, không chứa secret base32; chép sang user khác không đăng nhập được.
