# Đăng nhập, phiên & đăng xuất

> **[CƠ BẢN]** · Liên quan: [00-nen-tang/05-phan-quyen.md](../00-nen-tang/05-phan-quyen.md), [02-nang-cao/15-xac-thuc-2-lop.md](../02-nang-cao/15-xac-thuc-2-lop.md), [02-nang-cao/18-nhat-ky-audit.md](../02-nang-cao/18-nhat-ky-audit.md)

## 1. Mục tiêu
Xác thực bằng email + mật khẩu, cấp phiên 30 ngày mang trong cookie HttpOnly, cho phép client biết "tôi là ai", chống CSRF, và kết thúc phiên.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi (file khác) |
|---|---|
| Login, logout, `/me`, rate limit, Turnstile | Bước 2 MFA (`02-nang-cao/15`) |
| Tạo / tra / xoá session, dọn session hết hạn | Quên mật khẩu (`02-nang-cao/14`) |
| Chống CSRF bằng kiểm tra `Origin` | API key cho `/api/v1/*` (`02-nang-cao/13`) |
| Ghi hoạt động đăng nhập | Đổi mật khẩu, hồ sơ (`03-ho-so-mat-khau.md`) |

## 3. Dữ liệu
`users`, `sessions`, `audit_logs` (action `auth.login`, `auth.logout`).

## 4. Luồng

### 4.1 `POST /api/auth/login` (public)
Body `{ email (email hợp lệ), password (≥1), turnstileToken? }`, ≤ 16 KB.

```
1. kiểm tra Origin (§4.8)  → 403 "Invalid origin"
2. parse body              → 413 / 400 "Invalid login request"
3. validate schema         → 400 {error: <lỗi theo trường>}
4. rate limit theo IP      → 429 "Too many login attempts. Try again shortly." + Retry-After: 60
5. Turnstile (nếu bật)     → 400 "Verification failed. Please try again."
6. email = lower(trim(body.email))
   user  = users WHERE email = email
7. !user || !bcrypt_so_khop(password, user.password_hash) → 401 "Invalid credentials"
8. user.disabled           → 403 "Account disabled"
9. user.totp_enabled && user.totp_secret
        → 200 { ok:true, mfaRequired:true, challengeToken }   (no-store)  — xem MFA
10. token = TAO_SESSION(user.id)
11. audit auth.login (lỗi ghi log bị nuốt)
12. 200 { ok:true, redirect:"/inbox" } + Set-Cookie ep_session + no-store
```

- Token phiên **không** xuất hiện trong body JSON; chỉ có trong `Set-Cookie`.
- Thứ tự 4 trước 6 → rate limit áp cho cả email không tồn tại. Thứ tự 7 trước 8 → không tiết lộ tài khoản bị khoá khi sai mật khẩu.
- Khi `!user`, vẫn chạy một lần so bcrypt với một hash giả (cost 12) để thời gian phản hồi không lộ email có tồn tại hay không.

### 4.2 Rate limit
`env.LOGIN_RATE_LIMIT.limit({ key: cf-connecting-ip || "unknown" })`; `success=false` → chặn. Binding không có hoặc ném lỗi → **cho qua** (log warning) — quyết định có chủ đích: lỗi hạ tầng rate limit không được khoá mọi người khỏi hệ thống. Dùng chung cho `/api/auth/mfa/verify`. Giới hạn: 20 lần / 60 s / IP ([00-nen-tang/08](../00-nen-tang/08-hang-so-gioi-han.md)).

### 4.3 Turnstile
Chỉ khi có `TURNSTILE_SECRET_KEY`. Token phải là chuỗi 1–2048 ký tự. `POST https://challenges.cloudflare.com/turnstile/v0/siteverify` `{secret, response, remoteip, idempotency_key: ts_<chuỗi ngẫu nhiên>}`, timeout 10 s; lỗi mạng / non-2xx / `success=false` → từ chối.

### 4.4 Tạo session — thủ tục `TAO_SESSION(userId)`
```
token = "sess_" + chuỗi ngẫu nhiên an toàn (≥ 21 ký tự URL-safe, vd nanoid)
INSERT sessions { id: <id ngẫu nhiên>, userId, tokenHash: sha256_hex(token), expiresAt: now + 30 ngày }
return token
```
Cookie: `ep_session=<token>; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000; Secure` (bỏ `Secure` chỉ khi chạy dev trên `http://localhost`).

DB chỉ lưu hash; lộ bảng `sessions` không cho phép giả phiên.

### 4.5 Tra session — thủ tục `TRA_SESSION(request)` (mọi request cần đăng nhập)
```
token = cookie ep_session           // nguồn DUY NHẤT của token phiên
if !token → null
session = sessions WHERE token_hash = sha256_hex(token) AND expires_at > now
user = users WHERE id = session.user_id
user && !user.disabled ? user : null
```
- Header `Authorization: Bearer …` **không** được dùng để mang token phiên; Bearer chỉ dành cho API key (`ep_…`) trên các bề mặt API riêng ([00-nen-tang/05](../00-nen-tang/05-phan-quyen.md)).
- Không gia hạn trượt: phiên hết hạn đúng 30 ngày sau khi tạo.
- Thiếu/không hợp lệ → **401** `{error:"Unauthorized"}`.

### 4.6 Dọn session hết hạn
Cron (cùng trigger với các job định kỳ, chạy ít nhất mỗi ngày một lần): `DELETE FROM sessions WHERE expires_at <= now`.

### 4.7 `GET /api/auth/me` (session)
```json
{
  "user": { "id", "email", "name", "resetEmail", "forwardingEmail", "canForwardEmail",
            "role", "canManageMailboxes", "keyboardShortcutsEnabled", "spamProtectionEnabled",
            "hasAvatar", "mfaEnabled" },
  "runtime": "cloudflare" | "node",
  "managesDns": true,          // có credential Cloudflare
  "hasMailboxes": true,        // user sở hữu ≥1 mailbox không disabled
  "isSetup": true              // có ≥1 domain trong hệ thống
}
```
Lỗi khi tính `hasMailboxes/isSetup` được nuốt (vẫn trả user). Không có user → 401. Luôn `Cache-Control: no-store`.

Client dùng để định tuyến:
| Điều kiện | Chuyển tới |
|---|---|
| 401 ở trang bảo vệ | `/login` |
| Trang public (login…) mà đã đăng nhập | `/inbox` |
| Trang yêu cầu mailbox, user admin, `hasMailboxes=false`, `isSetup=false` | `/setup` |
| Đang ở `/setup` mà `isSetup=true` | `/inbox` |
| Trang yêu cầu role mà không đủ | `/inbox` |

Client gọi API cùng origin với cookie mặc định (`credentials: "same-origin"`); mọi response 401 từ API → chuyển `/login`. Client không bao giờ đọc hay lưu token phiên (cookie HttpOnly không truy cập được từ JavaScript).

### 4.8 Chống CSRF — kiểm tra `Origin`
Áp cho **mọi request ghi** (`POST`, `PUT`, `PATCH`, `DELETE`) tới `/api/*` được xác thực bằng cookie hoặc là endpoint public dùng từ trình duyệt (login, register, setup, quên mật khẩu, MFA verify):
```
appOrigin = origin của APP_URL nếu đặt, ngược lại origin của URL request (scheme://host[:port])
origin = request.headers["Origin"]
if !origin || origin != appOrigin → 403 {error:"Invalid origin", code:"CSRF_ORIGIN_MISMATCH"}
```
- Kiểm tra chạy **trước** mọi xử lý khác (trước cả parse body và rate limit).
- Miễn trừ: request xác thực bằng API key (`Authorization: Bearer ep_…`) hoặc bằng chữ ký (webhook nhận thư `/api/inbound`), vì chúng không dựa vào cookie.
- Request đọc (`GET`, `HEAD`) không kiểm tra `Origin` và **không** được thay đổi trạng thái.
- Nâng cấp WebSocket `/api/realtime` (xác thực bằng cookie) cũng yêu cầu `Origin == appOrigin`.
- Kết hợp `SameSite=Lax` của cookie tạo hai lớp bảo vệ.

### 4.9 `POST /api/auth/logout`
Kiểm tra `Origin` (§4.8). Lấy token từ cookie `ep_session`. Nếu có: tra user → audit `auth.logout` → xoá session theo hash. Luôn trả `{ok:true}` và xoá cookie (`Max-Age=0`).

## 5. Quy tắc nghiệp vụ
- Email đăng nhập được trim + lowercase trước khi tra cứu; `users.email` luôn lưu lowercase.
- Một user có thể có **nhiều session** song song (nhiều thiết bị).
- Disable user có hiệu lực **tức thì** (tra session loại user disabled).
- Thông báo lỗi đăng nhập không phân biệt "sai email" và "sai mật khẩu".
- Metadata hoạt động: `{ipAddress (cf-connecting-ip → x-forwarded-for[0] → "Unknown"), city (cf-ipcity), country (cf-ipcountry), device: Tablet|Mobile|Desktop, platform: Windows|iOS|Android|macOS|Linux|Unknown, userAgent}`.

## 6. Lỗi & biên
| Tình huống | Kết quả |
|---|---|
| Đăng nhập bằng `  Admin@Example.COM ` cho tài khoản `admin@example.com` | Thành công |
| 21 lần login trong 60 s cùng IP | lần 21 → 429 |
| User bị disable khi đang dùng | request kế tiếp 401 |
| Gửi `Authorization: Bearer sess_…` không kèm cookie | 401 (Bearer không mang phiên) |
| `POST` có cookie hợp lệ nhưng `Origin` của site khác / thiếu `Origin` | 403 "Invalid origin", không thay đổi gì |
| Binding rate limit lỗi | Cho qua, log warning |

## 7. Tiêu chí chấp nhận
- [ ] Login đúng → cookie `ep_session` (HttpOnly, SameSite=Lax, Secure) được set, body **không** chứa token, `/api/auth/me` trả user.
- [ ] Login với email khác hoa/thường hoặc có khoảng trắng thừa → vẫn thành công.
- [ ] Login sai → 401, không lộ lý do; tài khoản disabled + mật khẩu đúng → 403.
- [ ] Logout → cookie cũ không dùng được nữa.
- [ ] Session quá 30 ngày → 401; cron xoá dòng `sessions` đã hết hạn.
- [ ] Request ghi từ origin khác (có cookie) → 403 "Invalid origin".
- [ ] Mỗi login thành công có 1 dòng `audit_logs` `auth.login` với IP/thiết bị.
