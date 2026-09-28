# Đăng nhập, phiên & đăng xuất

> **[CƠ BẢN]** · Liên quan: [00-nen-tang/05-phan-quyen.md](../00-nen-tang/05-phan-quyen.md), [02-nang-cao/15-xac-thuc-2-lop.md](../02-nang-cao/15-xac-thuc-2-lop.md), [02-nang-cao/18-nhat-ky-audit.md](../02-nang-cao/18-nhat-ky-audit.md)

## 1. Mục tiêu
Xác thực bằng email + mật khẩu, cấp phiên 30 ngày, cho phép client biết "tôi là ai", và kết thúc phiên.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi (file khác) |
|---|---|
| Login, logout, `/me`, rate limit, Turnstile | Bước 2 MFA (`02-nang-cao/15`) |
| Tạo / tra / xoá session | Quên mật khẩu (`02-nang-cao/14`) |
| Ghi hoạt động đăng nhập | Đổi mật khẩu, hồ sơ (`03-ho-so-mat-khau.md`) |

## 3. Dữ liệu
`users`, `sessions`, `audit_logs` (action `auth.login`, `auth.logout`).

## 4. Luồng

### 4.1 `POST /api/auth/login` (public)
Body `{ email (email hợp lệ), password (≥1), turnstileToken? }`, ≤ 16 KB.

```
1. parse body            → 413 / 400 "Invalid login request"
2. zod validate          → 400 {error: flatten}
3. rate limit theo IP    → 429 "Too many login attempts. Try again shortly." + Retry-After: 60
4. Turnstile (nếu bật)   → 400 "Verification failed. Please try again."
5. user = users WHERE email = body.email   (khớp chính xác, KHÔNG lowercase)
6. !user || !bcrypt.compare(password, hash) → 401 "Invalid credentials"
7. user.disabled         → 403 "Account disabled"
8. user.totpEnabled && user.totpSecret
        → 200 { ok:true, mfaRequired:true, challengeToken }   (no-store)  — xem MFA
9. token = createSession(user.id)
10. audit auth.login (lỗi ghi log bị nuốt)
11. 200 { ok:true, token, redirect:"/inbox" } + Set-Cookie ep_session + no-store
```

Thứ tự 3 trước 5 → rate limit áp cho cả email không tồn tại. Thứ tự 6 trước 7 → không tiết lộ tài khoản bị khoá khi sai mật khẩu.

### 4.2 Rate limit
`env.LOGIN_RATE_LIMIT.limit({ key: cf-connecting-ip || "unknown" })`; `success=false` → chặn. Binding không có hoặc ném lỗi → **cho qua** (log warning). Dùng chung cho `/api/auth/mfa/verify`.

### 4.3 Turnstile
Chỉ khi có `TURNSTILE_SECRET_KEY`. Token phải là chuỗi 1–2048 ký tự. `POST https://challenges.cloudflare.com/turnstile/v0/siteverify` `{secret, response, remoteip, idempotency_key: ts_<nanoid>}`, timeout 10 s; lỗi mạng / non-2xx / `success=false` → từ chối.

### 4.4 Tạo session
```
token = "sess_" + nanoid()
INSERT sessions { id: nanoid(), userId, tokenHash: sha256hex(token), expiresAt: now + 30 ngày }
return token
```
Cookie: `ep_session=<token>; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000; Secure (production)`.

### 4.5 Tra session (mọi request cần đăng nhập)
```
token = Authorization "Bearer x" ?? cookie ep_session
session = sessions WHERE token_hash = sha256(token) AND expires_at > now
user = users WHERE id = session.user_id
user && !user.disabled ? user : null
```
Không gia hạn trượt. Session hết hạn không bị xoá (nên dọn bằng cron).

### 4.6 `GET /api/auth/me` (session)
```json
{
  "user": { "id", "email", "name", "resetEmail", "forwardingEmail", "canForwardEmail",
            "role", "canManageMailboxes", "keyboardShortcutsEnabled", "spamProtectionEnabled",
            "hasAvatar", "mfaEnabled" },
  "runtime": "cloudflare" | "node",
  "managesDns": true,          // có credential Cloudflare
  "hasMailboxes": true,        // user có ≥1 mailbox không disabled (sở hữu)
  "isSetup": true              // có ≥1 domain trong hệ thống
}
```
Lỗi khi tính `hasMailboxes/isSetup` được nuốt (vẫn trả user). Không có user → 401.

Client dùng để định tuyến:
| Điều kiện | Chuyển tới |
|---|---|
| 401 ở trang bảo vệ | `/login` |
| Trang public (login…) mà đã đăng nhập | `/inbox` |
| Trang yêu cầu mailbox, user admin, `hasMailboxes=false`, `isSetup=false` | `/setup` |
| Đang ở `/setup` mà `isSetup=true` | `/inbox` |
| Trang yêu cầu role mà không đủ | `/inbox` |

### 4.7 `POST /api/auth/logout`
Lấy token (Bearer hoặc cookie). Nếu có: tra user → audit `auth.logout` → xoá session theo hash. Luôn trả `{ok:true}` và xoá cookie (Max-Age=0).

## 5. Quy tắc nghiệp vụ
- Một user có thể có **nhiều session** song song (nhiều thiết bị).
- Disable user có hiệu lực **tức thì** (tra session loại user disabled).
- Thông báo lỗi đăng nhập không phân biệt "sai email" và "sai mật khẩu".
- Metadata hoạt động: `{ipAddress (cf-connecting-ip → x-forwarded-for[0] → "Unknown"), city (cf-ipcity), country (cf-ipcountry), device: Tablet|Mobile|Desktop, platform: Windows|iOS|Android|macOS|Linux|Unknown, userAgent}`.

## 6. Hai kênh mang token (hiện trạng)
Server trả token trong JSON **và** cookie. Client lưu token vào `localStorage["mailflare-session-token"]` và gửi `Authorization: Bearer` cho mọi request (`authFetch`); nhận 401 → xoá token và chuyển `/login`. WebSocket realtime chỉ đọc cookie.

**Khuyến nghị khi viết lại**: chỉ dùng cookie HttpOnly (không trả token trong JSON, không localStorage) + chống CSRF (SameSite=Lax + kiểm tra header `Origin` với request ghi). Giữ Bearer cho API key.

## 7. Lỗi & biên
| Tình huống | Kết quả |
|---|---|
| Email viết hoa khác lúc đăng ký | 401 (bug hiện tại — nên lowercase) |
| 21 lần login trong 60 s cùng IP | lần 21 → 429 |
| User bị disable khi đang dùng | request kế tiếp 401 |
| Cookie hợp lệ nhưng Bearer sai | Bearer được ưu tiên → 401 |

## 8. Tiêu chí chấp nhận
- [ ] Login đúng → cookie `ep_session` được set, `/api/auth/me` trả user.
- [ ] Login sai → 401, không lộ lý do; tài khoản disabled + mật khẩu đúng → 403.
- [ ] Logout → token cũ không dùng được nữa.
- [ ] Session quá 30 ngày → 401.
- [ ] Mỗi login thành công có 1 dòng `audit_logs` `auth.login` với IP/thiết bị.
