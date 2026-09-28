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
`hasAdminAccount()` = tồn tại user `role = 'admin'`. Nếu bảng `users` chưa tồn tại (lỗi "no such table") → `false`. Khi đã có admin, **mọi** endpoint dưới đây (trừ status) trả **403**.

## 4. Luồng

```
[UI /setup]
  1. GET  /api/setup/status            → chưa có admin?
  2. POST /api/setup/prepare           → kiểm tra cấu hình + migrate DB trống
  3. POST /api/setup/domain {hostname} → preflight zone
  4. POST /api/setup/domain/mx         → hỏi "thay MX cũ?" nếu có
  5. POST /api/auth/register {...}     → tạo admin + domain + mailbox
  6. → /login
```

### 4.1 `GET /api/setup/status` (public)
Trả (luôn `Cache-Control: no-store`):
```json
{ "hasAdminAccount": false, "hasPrimaryDomain": false,
  "primaryDomain": { "hostname": "example.com", "sendingRequested": true } | null }
```
`primaryDomain` = dòng `domains` đầu tiên bất kỳ. Lỗi DB khác → 500 `{error}`.

### 4.2 `POST /api/setup/prepare` (public, chưa có admin)
1. `checks = getSetupRequirementChecks(env)`:
   | key | configured khi | message |
   |---|---|---|
   | `Cloudflare API credentials` | `CF_TOKEN` hoặc (`CF_API_KEY` và `CF_EMAIL`) | "Set CF_TOKEN, or set both CF_API_KEY and CF_EMAIL." |
   | `D1 database` | có binding `DB` | "Deploy the Worker with the DB binding from wrangler.jsonc." |
2. Có check chưa đạt → **503** `{checks, migrated:false}`.
3. `migrateCleanDatabase(DB)` = `applyPendingMigrations(DB)` (runner dùng bảng `d1_migrations`, xem [03-tuy-chon/05](../03-tuy-chon/05-migration-self-update.md)); `migrated = applied.length > 0`. Trả `{checks, migrated}`. Lỗi → 500 `{checks, migrated:false, error}`.

> Lưu ý (khác với CLAUDE.md): code **không** kiểm tra DB trống. Rào chắn duy nhất là "chưa có admin". Endpoint này public, nên khi viết lại cần giới hạn (vd chỉ chạy khi chưa có bảng `users`, hoặc yêu cầu secret setup).

> Viết lại: có thể bỏ bước này và chạy `wrangler d1 migrations apply` trong CI. Nếu giữ, SQL phải được tách câu lệnh mà không cắt thân trigger FTS.

### 4.3 `POST /api/setup/domain` (public, chưa có admin)
Body `{ hostname (≥3) }`. Đã có domain → **409** "Primary domain already exists". Preflight: chuẩn hoá lowercase/trim, tìm zone → `{ domain: { hostname, zone: {id, name} } }`. Không có zone → **502** "Zone not found for "<host>". The domain must use Cloudflare DNS on this account."

### 4.4 `POST /api/setup/domain/mx` (public, chưa có admin)
Preflight rồi `hasConflictingMxRecords(zone, hostname)` = có MX nào **không** kết thúc `.mx.cloudflare.net`. Trả `{ hasExistingMx }`. UI dùng để hỏi người dùng có muốn **thay** MX hiện tại (sẽ ngắt nhận mail ở nhà cung cấp cũ).

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
1. Đã có admin → **403** "Registration is closed after the first account is created".
2. Đọc body ≤ 16 KB (413/400). Validate (400). Turnstile (400 "Verification failed. Please try again.").
3. `email = username@domain`; đã có user → **409** "Email already registered".
4. INSERT user `{id: usr_…, email, resetEmail, passwordHash, name: username, role: 'admin'}`.
5. `addDomainForUser(userId, domain, {enableRouting: true, enableSending, replaceMxRecords})` → `{domain, changes}`.
6. `ensureEmailRoutingRuleToWorker(zoneId, email)` rồi `changes.createdAddressRules.push(email)`.
7. INSERT mailbox `{id: mbx_…, userId, domainId, localPart: username, displayName: username}` (personal, useAllDomains mặc định true).
8. `ensureMailboxDomainRouting(mailbox)`.
9. **Nếu 5–8 lỗi**:
   - có `changes` → `rollbackDomainProvisioning(changes)` (xem [04-quan-ly-domain.md §6](04-quan-ly-domain.md));
   - xoá user (domain + mailbox cascade); lỗi xoá chỉ log;
   - lỗi Cloudflare code 2008 → **409** `{error:"Existing MX records currently deliver mail to another provider. Continue to delete them…", code:"MX_RECORDS_CONFLICT"}`; khác → **502** `{error}`.
10. Thành công → `{ ok: true, redirect: "/login" }`, `Cache-Control: no-store`, **xoá cookie** `ep_session` (Max-Age=0). Người dùng phải tự đăng nhập.

> Lý do lưu `changes` trong bộ nhớ thay vì đọc DB: chính lỗi làm hỏng đăng ký (schema chưa migrate, D1 chết) cũng làm dòng domain không bao giờ được ghi — đúng lúc cấu hình zone mồ côi khó phát hiện nhất.

## 5. Quy tắc nghiệp vụ
- Chỉ có **đúng một** lần đăng ký công khai; sau đó mọi tài khoản do admin tạo.
- Tên admin mặc định = username.
- Đăng ký luôn bật Email Routing (`enableRouting: true`).
- Không tự đăng nhập sau đăng ký.

## 6. Lỗi & biên
| Tình huống | Kết quả |
|---|---|
| Gọi register lần 2 sau khi thành công | 403 |
| Hai request register đồng thời | Không có khoá; có thể cùng qua kiểm tra `hasAdminAccount` → nên dùng ràng buộc DB / khoá khi viết lại |
| Zone không thuộc token | 502 zone not found (từ bước 5) |
| Có MX của nhà cung cấp khác, `replaceMxRecords=false` | Cloudflare trả 2008 → 409 `MX_RECORDS_CONFLICT`, không tạo gì |
| Lỗi sau khi đã bật routing | rollback khôi phục catch-all cũ, tắt routing nếu lần này bật, tạo lại MX đã xoá |

## 7. Tiêu chí chấp nhận
- [ ] DB trống + đủ secret → prepare trả `migrated: true`; gọi lại (vẫn chưa có admin) → `migrated: false`, không lỗi.
- [ ] Thiếu `CF_TOKEN` → prepare 503 với check `configured: false`.
- [ ] Register thành công tạo đúng 1 user admin, 1 domain `active`, 1 mailbox, Email Routing bật, catch-all → Worker, rule literal cho `username@domain`.
- [ ] Register lỗi ở bước tạo mailbox → không còn user/domain trong DB, zone trở về trạng thái trước.
- [ ] Sau register, mọi endpoint setup trả 403.

## 8. Ghi chú khi xây dựng lại
- Có thể gộp bước 3–4 vào một endpoint "preflight" trả `{zone, hasExistingMx}`.
- Nên lowercase email ở mọi nơi (register đã làm; login thì không — xem file đăng nhập).
