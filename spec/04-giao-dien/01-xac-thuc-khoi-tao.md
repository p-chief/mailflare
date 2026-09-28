# Màn hình xác thực & khởi tạo

> Nghiệp vụ: [01-co-ban/01-khoi-tao-he-thong.md](../01-co-ban/01-khoi-tao-he-thong.md), [01-co-ban/02-dang-nhap-phien.md](../01-co-ban/02-dang-nhap-phien.md), [02-nang-cao/14](../02-nang-cao/14-quen-mat-khau.md), [02-nang-cao/15](../02-nang-cao/15-xac-thuc-2-lop.md)

Mọi màn hình trong file này dựa vào cookie phiên HttpOnly do server đặt; client không nhận, không lưu và không gửi token phiên.

## 1. Landing `/` [TÙY CHỌN]
Gọi `GET /api/auth/me` (cookie). Đã đăng nhập: nút "Dashboard"/"Open dashboard" → `/inbox`. Chưa: "Log in" → `/login`, "Create account" → `/setup`. Ảnh xem trước hộp thư là dữ liệu tĩnh minh hoạ.

## 2. Đăng nhập `/login` [CƠ BẢN]
**Server quyết định trước khi hiển thị**: chưa có admin → `/setup`; phiên hợp lệ → `/inbox`.

**Bước mật khẩu** — "Sign in":
- Email (type email, bắt buộc), Password (bắt buộc), link "Forgot password?".
- Turnstile nếu có site key; widget được reset sau mỗi lần lỗi.
- `POST /api/auth/login` (timeout 20 s):
  - lỗi → `error ?? "Login failed"`;
  - `mfaRequired` → sang bước MFA (giữ `challengeToken` trong bộ nhớ trang, không lưu trữ);
  - OK → server đã đặt cookie → điều hướng `next` (nếu là đường dẫn nội bộ bắt đầu bằng `/`) → `redirect` → `/inbox`;
  - timeout → "Login timed out. Please try again."; lỗi mạng → "Unable to reach the login service. Please try again."
- Nút "Signing in..." khi đang gửi / "Sign in".

**Bước MFA** — "Two-factor authentication":
- Mô tả "Enter the 6-digit code from your authenticator app, or one of your recovery codes."
- Ô Code (bàn phím số, `autocomplete="one-time-code"`, placeholder "123 456").
- `POST /api/auth/mfa/verify`; lỗi chứa "expired" → quay về bước mật khẩu với thông báo lỗi; lỗi khác hiển thị dưới ô.
- Link "Back to sign in".

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
**Bước 1 "Prepare installation"** (tự chạy khi mở):
- `POST /api/setup/prepare` → danh sách kiểm tra (dấu xanh/đỏ, hiện thông điệp khi thiếu) → `GET /api/setup/status`.
- Thành công: "Clean database migrated successfully" (nếu `migrated`) / "Database schema is ready".
- Nút "Continue" (→ bước 3 nếu đã có domain, ngược lại bước 2) hoặc "Check again" khi còn mục đỏ.
- Đã có admin → màn "Account registration is closed" + nút "Go to login".

**Bước 2 "Add your domain"** (khi chưa có domain):
- Ô "Primary domain", helper "The domain must already be a Cloudflare zone on this account."
- **Rời ô** (≥ 3 ký tự, khác giá trị lần kiểm trước) → `POST /api/setup/domain` → "Domain found in Cloudflare as {zone}" hoặc thông điệp lỗi.
- Sửa ô → xoá kết quả kiểm và đưa switch sending về trạng thái chờ kiểm.
- Switch "Enable sending":
  - khoá cho tới khi kiểm domain thành công;
  - kiểm thành công → **tự bật (ON)** — cùng mặc định với dialog thêm domain của admin ([07-quan-tri.md §2](07-quan-tri.md)) và với API (`enableSending` mặc định true);
  - người dùng có thể tắt để chạy chế độ chỉ nhận.
  - Gợi ý theo trạng thái: "Checking Cloudflare access..." / "Required to send email." (bật) / "Receive-only mode." (tắt) / "Enter the domain and leave the field to verify it." (chưa kiểm).

**Bước 3 "Create your mailbox"**:
- Vào bước → `POST /api/setup/domain/mx`:
  - đang chạy: "Checking existing MX records";
  - không có MX → "No existing MX records found";
  - có MX → checkbox cảnh báo (màu vàng) "Replace existing MX records" + cảnh báo nhà cung cấp cũ sẽ ngừng nhận thư;
  - lỗi → "Could not check existing MX records" + nút "Try again".
- Trường: Username (hậu tố `@domain`), Password (≥ 8), Recovery email (bắt buộc, placeholder `you@gmail.com`), Turnstile.
- "Create account" bị khoá khi: đang gửi, đang/chưa kiểm MX, có MX mà chưa tick thay, chưa rõ trạng thái setup.
- `POST /api/auth/register`:
  - `code = MX_RECORDS_CONFLICT` → hiện checkbox thay MX (chưa tick) và thông điệp;
  - lỗi khác → `error ?? "Registration failed"`;
  - OK → phát `app:auth-session-changed` → điều hướng `redirect ?? /login`.

### 3.2 Onboarding (admin đã có, chưa có domain) — "1 Domain / 2 Mailbox"
- Mở trang: `GET /api/domains`; đã có domain → nhảy bước 2.
- **Bước 1 "Connect mail routing"**:
  - Ô domain, rời ô → `POST /api/domains/check`; switch "Enable sending" như §3.1 (khoá tới khi kiểm xong, rồi mặc định ON).
  - "Add domain" → `POST /api/domains {hostname, enableRouting: true, enableSending, replaceMxRecords}`.
  - `MX_RECORDS_CONFLICT` → hộp cảnh báo + nút "Delete MX records and continue" (gọi lại với `replaceMxRecords: true`).
- **Bước 2 "Create your first mailbox"**: local part (mặc định `me`) + `@host` → "Go to inbox" → `POST /api/mailboxes` → `/inbox`.

## 4. Quên mật khẩu `/forgot-password` [NÂNG CAO]
Email + Turnstile → `POST /api/auth/password-reset/request` (timeout 20 s) → ẩn form, hiện "If that account has a recovery email, a reset link is on its way. It works for 30 minutes." (luôn cùng thông điệp, không tiết lộ tài khoản có tồn tại hay không). Lỗi mạng: "Unable to reach the server. Please try again." Bị giới hạn tần suất (429) → "Too many requests. Please wait a few minutes and try again."

## 5. Đặt lại `/reset-password?token=` [NÂNG CAO]
- Không có token → "Reset link missing" + link "Request a new link".
- Mật khẩu mới + xác nhận (≥ 8, phải khớp — "Passwords do not match") → `POST /api/auth/password-reset/confirm`.
- Token hết hạn/đã dùng → thông điệp lỗi của server + link "Request a new link".
- Xong → "Password updated — You have been signed out everywhere. Sign in with your new password to continue." + nút "Sign in".

## 6. Tiêu chí chấp nhận
- [ ] Không có giá trị nào liên quan tới phiên được ghi vào bộ nhớ trình duyệt sau khi đăng nhập.
- [ ] Đăng nhập với `?next=/sent` → về `/sent`; `?next=https://evil.example` → về `/inbox`.
- [ ] Wizard: kiểm domain thành công → switch "Enable sending" ở trạng thái bật.
- [ ] Có MX cũ mà chưa tick "Replace existing MX records" → nút "Create account" bị khoá.
