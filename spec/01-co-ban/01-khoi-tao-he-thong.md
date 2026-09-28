# Khởi tạo hệ thống lần đầu (First-run setup)

> **[CƠ BẢN]** · Phụ thuộc: [04-quan-ly-domain.md](04-quan-ly-domain.md), [05-quan-ly-mailbox.md](05-quan-ly-mailbox.md), [00-nen-tang/07-cloudflare-api.md](../00-nen-tang/07-cloudflare-api.md) · UI: [04-giao-dien](../04-giao-dien/)

## 1. Mục tiêu
Đưa một bản cài đặt trống thành hệ thống dùng được trong một lần: kiểm tra cấu hình, tạo schema, kết nối domain chính, tạo tài khoản admin đầu tiên cùng mailbox của họ.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Kiểm tra secret/binding cần thiết | Tạo D1/R2/Queue (làm bằng Wrangler) |
| Áp migration còn thiếu lúc setup | Nâng cấp DB sau khi đã setup (xem [03-tuy-chon/05](../03-tuy-chon/05-migration-self-update.md)) |
| Preflight domain, kiểm tra MX xung đột | Thêm domain thứ 2+ (chức năng domain) |
| Tạo admin + domain + mailbox (nguyên tử, có rollback) | Tạo user thường (chức năng đa người dùng) |

## 3. Điều kiện "đã setup"
Thủ tục `DA_CO_ADMIN()` = tồn tại dòng `users` với `role = 'admin'`. Nếu bảng `users` chưa tồn tại (lỗi "no such table") → `false`.

Khi `DA_CO_ADMIN()` là `true`, **mọi** endpoint dưới đây (trừ `GET /api/setup/status`) trả **403**.

"DB chưa có bảng ứng dụng" = trong `sqlite_master` không có bảng nào (`type = 'table'`) ngoài: bảng nội bộ SQLite (`sqlite_%`), bảng nội bộ D1 (`_cf_%`) và bảng theo dõi migration.

## 4. Luồng

```
[UI /setup]
  1. GET  /api/setup/status            → chưa có admin?
  2. POST /api/setup/prepare           → kiểm tra cấu hình + áp migration
  3. POST /api/setup/domain {hostname} → preflight zone
  4. POST /api/setup/domain/mx         → hỏi "thay MX cũ?" nếu có
  5. POST /api/auth/register {...}     → tạo admin + domain + mailbox
  6. → /login
```

Mọi endpoint setup/register là request ghi từ trình duyệt → áp quy tắc kiểm tra `Origin` ([02-dang-nhap-phien.md §4.8](02-dang-nhap-phien.md)).

### 4.1 `GET /api/setup/status` (public)
Trả (luôn `Cache-Control: no-store`):
```json
{ "hasAdminAccount": false, "hasPrimaryDomain": false,
  "primaryDomain": { "hostname": "example.com", "sendingRequested": true } | null }
```
`primaryDomain` = dòng `domains` đầu tiên bất kỳ. Bảng chưa tồn tại → coi như chưa có admin/domain. Lỗi DB khác → 500 `{error}`.

### 4.2 `POST /api/setup/prepare` (public, có rào chắn)
Rào chắn — endpoint chỉ chạy khi **cả hai** điều kiện đúng:
1. `DA_CO_ADMIN()` là `false`; **và**
2. **một trong hai**: DB chưa có bảng ứng dụng (§3), **hoặc** secret `SETUP_TOKEN` được cấu hình và header `X-Setup-Token` của request bằng đúng giá trị đó (so sánh thời gian hằng).

| Tình huống | Kết quả |
|---|---|
| Đã có admin | **403** `{error:"Setup is already complete"}` |
| DB đã có bảng, không cấu hình `SETUP_TOKEN` | **403** `{error:"Setup token required"}` |
| DB đã có bảng, thiếu/sai `X-Setup-Token` | **403** `{error:"Setup token required"}` |

Qua rào chắn:
1. Kiểm tra cấu hình:
   | key | configured khi | message |
   |---|---|---|
   | `Cloudflare API credentials` | `CF_TOKEN` hoặc (`CF_API_KEY` và `CF_EMAIL`) | "Set CF_TOKEN, or set both CF_API_KEY and CF_EMAIL." |
   | `D1 database` | có binding `DB` | "Deploy the Worker with the DB binding from wrangler.jsonc." |

   Mỗi phần tử: `{ key, configured: bool, message }`.
2. Có check chưa đạt → **503** `{checks, migrated:false}`.
3. Áp migration còn thiếu (theo bảng theo dõi migration, xem [03-tuy-chon/05](../03-tuy-chon/05-migration-self-update.md)); `migrated = số migration vừa áp > 0`. Trả `{checks, migrated}`. Lỗi → 500 `{checks, migrated:false, error}`.

Gọi lại khi đã migrate đủ (vẫn chưa có admin) → cần `X-Setup-Token` (vì DB đã có bảng); với token đúng trả `migrated:false`, không lỗi. UI nhận 403 "Setup token required" → hiển thị ô nhập setup token rồi gửi lại với header `X-Setup-Token`.

### 4.3 `POST /api/setup/domain` (public, chưa có admin)
Body `{ hostname (≥3) }`. Đã có domain → **409** "Primary domain already exists". Preflight: chuẩn hoá lowercase/trim, tìm zone chứa hostname ([00-nen-tang/07 §3](../00-nen-tang/07-cloudflare-api.md)) → `{ domain: { hostname, zone: {id, name} } }`. Không có zone → **404** `ZONE_NOT_FOUND` "Zone not found for \"<host>\". The domain must use Cloudflare DNS on this account."; lỗi Cloudflare khác → 502 `UPSTREAM_ERROR`.

### 4.4 `POST /api/setup/domain/mx` (public, chưa có admin)
Preflight như §4.3 rồi kiểm tra MX xung đột = zone có bản ghi MX tại hostname mà nội dung **không** kết thúc bằng `.mx.cloudflare.net`. Trả `{ hasExistingMx }`. UI dùng để hỏi người dùng có muốn **thay** MX hiện tại (sẽ ngắt nhận mail ở nhà cung cấp cũ).

### 4.5 `POST /api/auth/register` (public, chưa có admin)
Body:
| Trường | Quy tắc |
|---|---|
| `domain` | ≥ 3 ký tự, lowercase + trim |
| `username` | 1–64, `[a-zA-Z0-9._%+-]`, lowercase + trim |
| `password` | ≥ 8 |
| `resetEmail` | email hợp lệ, **bắt buộc** |
| `enableSending` | bool, mặc định true |
| `replaceMxRecords` | bool, mặc định false |
| `turnstileToken` | bắt buộc nếu cấu hình Turnstile |

Các bước:
1. `DA_CO_ADMIN()` → **403** "Registration is closed after the first account is created" (đường tắt; rào chắn thật ở bước 4).
2. Đọc body ≤ 16 KB (413/400). Validate schema (400). Turnstile (400 "Verification failed. Please try again.").
3. `email = username@domain`; đã có user với email này → **409** "Email already registered".
4. **Chiếm quyền tạo admin nguyên tử** — INSERT có điều kiện trong một câu lệnh:
   ```sql
   INSERT INTO users (id, email, reset_email, password_hash, name, role, created_at)
   SELECT :id, :email, :resetEmail, :passwordHash, :username, 'admin', :now
   WHERE NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin');
   ```
   `id = usr_…`, `passwordHash = bcrypt(password, 12)`. Số dòng bị ảnh hưởng = 0 → **403** "Registration is closed after the first account is created" — request thua **không** chạm Cloudflare. Vi phạm UNIQUE `email` → 409 "Email already registered".
5. Thêm domain cho user: thủ tục `THEM_DOMAIN(userId, domain, {enableRouting: true, enableSending, replaceMxRecords})` ([04-quan-ly-domain.md §5](04-quan-ly-domain.md)) → `{domain, changes}`.
6. Tạo (nếu chưa có) rule Email Routing literal `to = email` → `{EMAIL_WORKER_NAME}` ([00-nen-tang/07 §4](../00-nen-tang/07-cloudflare-api.md)) rồi thêm `email` vào `changes.createdAddressRules`.
7. INSERT mailbox `{id: mbx_…, userId, domainId, localPart: username, displayName: username}` (personal, `useAllDomains` mặc định true).
8. Đồng bộ routing của mailbox: thủ tục `DONG_BO_ROUTING(mailbox)` ([05-quan-ly-mailbox.md §3.3](05-quan-ly-mailbox.md)).
9. **Nếu bước 5–8 lỗi**:
   - có `changes` → `ROLLBACK_PROVISION(changes)` ([04-quan-ly-domain.md §6](04-quan-ly-domain.md));
   - xoá user (domain + mailbox cascade) — việc này cũng trả lại quyền tạo admin cho lần thử sau; lỗi xoá chỉ log;
   - lỗi Cloudflare code 2008 → **409** `{error:"Existing MX records currently deliver mail to another provider. Continue to delete them and replace them with Cloudflare Email Routing.", code:"MX_RECORDS_CONFLICT"}`; khác → **502** `{error}`.
10. Thành công → `{ ok: true, redirect: "/login" }`, `Cache-Control: no-store`, **xoá cookie** `ep_session` (Max-Age=0). Người dùng phải tự đăng nhập.

> Lý do giữ `changes` trong bộ nhớ thay vì đọc lại DB để rollback: chính lỗi làm hỏng đăng ký (schema chưa migrate, D1 lỗi) cũng làm dòng domain không bao giờ được ghi — đúng lúc cấu hình zone mồ côi khó phát hiện nhất.

## 5. Quy tắc nghiệp vụ
- Chỉ có **đúng một** lần đăng ký công khai; sau đó mọi tài khoản do admin tạo.
- Tính duy nhất của admin đầu tiên được bảo đảm bởi INSERT có điều kiện ở §4.5 bước 4 (D1 thực thi từng câu lệnh ghi tuần tự), không dựa vào kiểm tra ở tầng ứng dụng.
- Tên admin mặc định = username. Email lưu lowercase.
- Đăng ký luôn bật Email Routing (`enableRouting: true`).
- Không tự đăng nhập sau đăng ký.
- `/api/setup/prepare` không bao giờ chạy trên DB đã có dữ liệu ứng dụng nếu không có `SETUP_TOKEN` đúng.

## 6. Lỗi & biên
| Tình huống | Kết quả |
|---|---|
| Gọi register lần 2 sau khi thành công | 403 |
| Hai request register đồng thời | Chỉ một request chèn được admin; request kia 403 ở bước 4, không tạo gì trên Cloudflare |
| Kẻ lạ gọi prepare trên DB đã có bảng nhưng chưa có admin | 403 "Setup token required" |
| Zone không thuộc token | 404 `ZONE_NOT_FOUND` (từ bước 5), user bị xoá |
| Có MX của nhà cung cấp khác, `replaceMxRecords=false` | Cloudflare trả 2008 → 409 `MX_RECORDS_CONFLICT`, không tạo gì |
| Lỗi sau khi đã bật routing | rollback khôi phục catch-all cũ, tắt routing nếu lần này bật, tạo lại MX đã xoá |

## 7. Tiêu chí chấp nhận
- [ ] DB trống + đủ secret → prepare trả `migrated: true`; gọi lại với `X-Setup-Token` đúng (vẫn chưa có admin) → `migrated: false`, không lỗi.
- [ ] DB đã có bảng, không gửi `X-Setup-Token` → prepare 403, không áp migration.
- [ ] Thiếu `CF_TOKEN` → prepare 503 với check `configured: false`.
- [ ] Register thành công tạo đúng 1 user admin, 1 domain `active`, 1 mailbox, Email Routing bật, catch-all → Worker, rule literal cho `username@domain`.
- [ ] Gửi 2 register song song → đúng 1 admin trong DB, request còn lại 403.
- [ ] Register lỗi ở bước tạo mailbox → không còn user/domain trong DB, zone trở về trạng thái trước.
- [ ] Sau register, mọi endpoint setup (trừ status) trả 403.

## 8. Ghi chú triển khai
- Có thể gộp bước 3–4 của luồng vào một endpoint "preflight" trả `{zone, hasExistingMx}`.
- Người triển khai có thể áp migration bằng CI (`wrangler d1 migrations apply`) trước khi mở `/setup`; khi đó prepare trả `migrated: false` (cần `SETUP_TOKEN` vì DB đã có bảng).
- Khi áp SQL migration trong Worker, phải tách câu lệnh mà không cắt thân trigger (FTS, xem [14-tim-kiem.md](14-tim-kiem.md)).
