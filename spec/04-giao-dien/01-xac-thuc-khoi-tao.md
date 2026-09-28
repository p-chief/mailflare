# Màn hình xác thực & khởi tạo

> Nghiệp vụ: [01-co-ban/01-khoi-tao-he-thong.md](../01-co-ban/01-khoi-tao-he-thong.md), [01-co-ban/02-dang-nhap-phien.md](../01-co-ban/02-dang-nhap-phien.md), [02-nang-cao/14](../02-nang-cao/14-quen-mat-khau.md), [02-nang-cao/15](../02-nang-cao/15-xac-thuc-2-lop.md)

## 1. Landing `/` [TÙY CHỌN]
Có token → gọi `/api/auth/me`. Đã đăng nhập: nút "Dashboard"/"Open dashboard" → `/inbox`. Chưa: "Log in" → `/login`, "Create account" → `/setup`. Ảnh xem trước hộp thư là dữ liệu tĩnh.

## 2. Đăng nhập `/login` [CƠ BẢN]
**Server**: chưa có admin → `/setup`; phiên hợp lệ → `/inbox`.

**Bước mật khẩu** — "Sign in":
- Email (type email, bắt buộc), Password (bắt buộc), link "Forgot password?".
- Turnstile nếu có site key; reset sau mỗi lần lỗi.
- `POST /api/auth/login` (timeout 20 s):
  - lỗi → `error ?? "Login failed"`;
  - `mfaRequired` → sang bước MFA;
  - OK → `redirect ?? /inbox`;
  - timeout → "Login timed out. Please try again."; mạng → "Unable to reach the login service. Please try again."
- Nút "Signing in..." / "Sign in".

**Bước MFA** — "Two-factor authentication": "Enter the 6-digit code from your authenticator app, or one of your recovery codes."; ô Code (numeric, `one-time-code`, placeholder "123 456"); `POST /api/auth/mfa/verify`; lỗi chứa "expired" → quay về bước mật khẩu; "Back to sign in".

## 3. Setup `/setup` [CƠ BẢN]
**Server quyết định**:
| Tình huống | Kết quả |
|---|---|
| Chưa có admin + đang có phiên hợp lệ | `/inbox` |
| Chưa có admin | **Wizard đăng ký** (§3.1) |
| Có admin, không phiên / user disabled | `/login` |
| Có admin, không phải admin | `/inbox` |
| Có admin, đã có domain | `/inbox` |
| Có admin, chưa có domain | **Onboarding** (§3.2) |

### 3.1 Wizard đăng ký — 3 bước "1 System / 2 Domain / 3 Account"
**Bước 1 "Prepare installation"** (tự chạy khi mở): `POST /api/setup/prepare` → danh sách check (xanh/đỏ, hiện message khi thiếu) → `GET /api/setup/status`.
- Thành công: "Clean database migrated successfully" (nếu `migrated`) / "Database schema is ready".
- Nút "Continue" (→ bước 3 nếu đã có domain, ngược lại bước 2) hoặc "Check again".
- Đã có admin → màn "Account registration is closed … Go to login".

**Bước 2 "Add your domain"** (khi chưa có domain):
- Ô "Primary domain" (helper "The domain must already be a Cloudflare zone on this account.").
- **Rời ô** (≥ 3 ký tự, khác lần kiểm trước) → `POST /api/setup/domain` → "Domain found in Cloudflare as {zone}" hoặc lỗi.
- Sửa ô → xoá kết quả kiểm & switch sending.
- Switch "Enable sending" chỉ bật được sau khi kiểm thành công; gợi ý "Checking Cloudflare access..." / "Required to send email." / "Receive-only mode." / "Enter the domain and leave the field to verify it."
- Mặc định sending **tắt**.

**Bước 3 "Create your mailbox"**:
- Vào bước → `POST /api/setup/domain/mx`:
  - "Checking existing MX records";
  - không có → "No existing MX records found";
  - có → checkbox vàng "Replace existing MX records" + cảnh báo nhà cung cấp cũ sẽ ngừng nhận thư;
  - lỗi → "Could not check existing MX records" + nút thử lại.
- Trường: Username (hậu tố `@domain`), Password (≥ 8), Recovery email (bắt buộc, placeholder `you@gmail.com`), Turnstile.
- "Create account" bị khoá khi: đang tải, đang/chưa kiểm MX, có MX mà chưa tick thay, chưa rõ trạng thái setup.
- `POST /api/auth/register`:
  - `code = MX_RECORDS_CONFLICT` → hiện checkbox thay MX (chưa tick);
  - lỗi khác → `error ?? "Registration failed"`;
  - OK → xoá token, `location = redirect ?? /login`.

### 3.2 Onboarding (admin đã có, chưa có domain) — "1 Domain / 2 Mailbox"
- Mở trang: `GET /api/domains`; đã có domain → nhảy bước 2.
- **Bước 1 "Connect mail routing"**:
  - Ô domain, rời ô → `POST /api/domains/check`; switch sending như trên.
  - "Add domain" → `POST /api/domains {hostname, enableRouting:true, enableSending, replaceMxRecords}`.
  - `MX_RECORDS_CONFLICT` → hộp cảnh báo + nút "Delete MX records and continue" (gọi lại với `replaceMxRecords:true`).
- **Bước 2 "Create your first mailbox"**: local part (mặc định `me`) + `@host` → "Go to inbox" → `POST /api/mailboxes` → `/inbox`.

## 4. Quên mật khẩu `/forgot-password` [NÂNG CAO]
Email + Turnstile → `POST /api/auth/password-reset/request` (timeout 20 s) → ẩn form, hiện "If that account has a recovery email, a reset link is on its way. It works for 30 minutes." Lỗi mạng: "Unable to reach the server. Please try again."

## 5. Đặt lại `/reset-password?token=` [NÂNG CAO]
- Không token → "Reset link missing" + "Request a new link".
- Mật khẩu mới + xác nhận (≥ 8, phải khớp — "Passwords do not match") → `POST /api/auth/password-reset/confirm`.
- Xong → "Password updated — You have been signed out everywhere. Sign in with your new password to continue."
