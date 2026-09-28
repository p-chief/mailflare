# Xác thực hai lớp (TOTP) & mã khôi phục

> **[NÂNG CAO]** · Phụ thuộc: [01-co-ban/02-dang-nhap-phien.md](../01-co-ban/02-dang-nhap-phien.md)

## 1. Mục tiêu
Yêu cầu mã 6 số từ ứng dụng authenticator (hoặc mã khôi phục dùng 1 lần) sau mật khẩu khi người dùng đã bật 2FA.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| TOTP RFC 6238, QR, 8 mã khôi phục | WebAuthn/passkey, SMS |
| Bước 2 đăng nhập qua challenge | Bắt buộc 2FA theo chính sách admin |
| Bật / tắt / cấp lại mã | Áp 2FA cho API key |

## 3. TOTP (tự cài bằng Web Crypto, không thư viện)
- Secret: 20 byte ngẫu nhiên → base32 (A–Z2–7, không padding).
- `hotp(secret, counter)`: HMAC-SHA1(key = base32decode(secret), msg = counter 8 byte big-endian) → dynamic truncation → `% 10^6`, pad 6 chữ số.
- `counter = floor(unix_seconds / 30)`.
- Xác minh: mã phải `^\d{6}$` (sau khi bỏ khoảng trắng); thử `counter − 1, counter, counter + 1`; so sánh constant-time.
- `otpauth://totp/<issuer>:<email>?secret=…&issuer=<appName>&algorithm=SHA1&digits=6&period=30`; QR dạng SVG (thư viện `qrcode`, margin 1, EC level M).
- Không chống dùng lại mã trong cùng cửa sổ 30 s (nên lưu counter cuối cùng đã dùng).

## 4. Mã khôi phục
- 8 mã, mỗi mã 10 ký tự từ `abcdefghjkmnpqrstuvwxyz23456789` (không 0/o/1/i/l), hiển thị `xxxxx-xxxxx`.
- Lưu `sha256(normalize(code))` với `normalize` = lowercase, bỏ ký tự không phải chữ/số.
- Cấp mới = xoá toàn bộ mã cũ. Dùng một lần (`used_at`).

## 5. API (session; mọi thao tác nhạy cảm kiểm tra lại mật khẩu)
| Method | Path | Body | Hành vi |
|---|---|---|---|
| GET | `/api/settings/mfa` | – | `{enabled, confirmedAt, recoveryCodesLeft}` |
| POST | `/api/settings/mfa/enroll` | `{password}` | sai mật khẩu → 400 "Password is incorrect"; đã bật → 400; lưu secret mới (`totpEnabled=false`) → `{secret, otpauthUrl, qrSvg}` (no-store) |
| POST | `/api/settings/mfa/confirm` | `{code (6–12)}` | chưa enroll → "Start enrolment first"; đã bật → lỗi; sai mã → "That code did not match. Check the time on your device and try again."; đúng → `totpEnabled=true, totpConfirmedAt=now`, cấp 8 mã, **xoá mọi session khác** → `{recoveryCodes}` |
| POST | `/api/settings/mfa/recovery-codes` | `{password}` | cấp lại bộ mã |
| POST | `/api/settings/mfa/disable` | `{password, code (6–32)}` | code = TOTP **hoặc** mã khôi phục; xoá secret, tắt, xoá mã |

## 6. Đăng nhập 2 bước
```
POST /api/auth/login → mật khẩu đúng & totpEnabled
   token = "mfa_" + nanoid; INSERT login_challenges { tokenHash: sha256, expiresAt: now + 5' }
   → { ok:true, mfaRequired:true, challengeToken }        (chưa có session)

POST /api/auth/mfa/verify { challengeToken (8–200), code (6–32) }
   rate limit IP (chung với login) → 429
   userId = challenge hợp lệ, chưa hết hạn → không: 401 "This sign-in attempt has expired. Start again."
   user disabled → 403
   method = verifyTotp(code) ? "totp" : consumeRecoveryCode(code) ? "recovery" : null
   null → 401 "That code did not match"     (challenge GIỮ NGUYÊN → thử lại được trong 5')
   xoá challenge; tạo session; audit auth.login + auth.mfa_verified
   → { ok, token, redirect:"/inbox", method } + cookie
```
Mật khẩu không bao giờ phải giữ ở client giữa hai bước.

## 7. UI
- Login: sau mật khẩu chuyển sang bước "Two-factor authentication" (ô mã `inputMode=numeric`, `autocomplete=one-time-code`); lỗi chứa "expired" → quay về bước mật khẩu; nút "Back to sign in".
- Settings → Account → Security: bật (mật khẩu → quét QR / "Can't scan?" hiện key → nhập mã → hiển thị & copy 8 mã, "Other sessions have been signed out."); khi bật: "New recovery codes", "Turn off".

## 8. Tiêu chí chấp nhận
- [ ] Bật 2FA → login trả `mfaRequired`, không set cookie.
- [ ] Mã lệch 30 s vẫn được chấp nhận; lệch 90 s bị từ chối.
- [ ] Mã khôi phục dùng được đúng 1 lần.
- [ ] Challenge quá 5 phút → 401.
- [ ] Tắt 2FA cần cả mật khẩu và mã.
