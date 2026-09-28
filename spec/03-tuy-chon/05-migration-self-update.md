# Migration & cập nhật phiên bản

> **[TÙY CHỌN]** · Phụ thuộc: [00-nen-tang/04-mo-hinh-du-lieu.md](../00-nen-tang/04-mo-hinh-du-lieu.md) · Liên quan: [01-co-ban/01-khoi-tao-he-thong.md](../01-co-ban/01-khoi-tao-he-thong.md), [01-co-ban/14-tim-kiem.md](../01-co-ban/14-tim-kiem.md), [04-giao-dien/07-quan-tri.md §1](../04-giao-dien/07-quan-tri.md)

## 1. Mục tiêu
- Cho phép áp migration schema D1 **từ trong ứng dụng** (admin bấm nút) bên cạnh cách chuẩn là `wrangler d1 migrations apply` trong CI/CD, dùng chung một bảng theo dõi.
- Cho admin biết có phiên bản mới hay không (so với một nguồn phát hành cấu hình được) và, nếu cấu hình, kích hoạt pipeline triển khai.
- Cho admin xem và rebuild chỉ mục tìm kiếm.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Runner migration tiến (forward-only) với bảng theo dõi | Migration lùi (down) |
| So sánh phiên bản với nguồn phát hành | Tự build/deploy bên trong Worker |
| Gọi một webhook CI để triển khai | Merge mã nguồn, quản lý Git |
| Rebuild chỉ mục FTS | |

## 3. Quyền
- Mọi endpoint `/api/admin/*`: 401 khi không có phiên, 403 khi không phải admin.
- **Mọi POST** yêu cầu header `Origin` bằng origin của ứng dụng (`APP_URL` hoặc origin request); sai hoặc thiếu → 403 "Invalid origin" (`CSRF_ORIGIN_MISMATCH`, quy tắc chung ở [01-co-ban/02 §4.8](../01-co-ban/02-dang-nhap-phien.md)).
- Runner cũng được dùng bởi bước khởi tạo lần đầu ([01-co-ban/01](../01-co-ban/01-khoi-tao-he-thong.md)), vốn chỉ chạy khi DB chưa có bảng nào.

## 4. Migration

### 4.1 Gói migration
- Migration là các file SQL đánh số tăng dần (`0001_init.sql`, `0002_…sql`, …), là **lịch sử schema duy nhất** cần duy trì.
- Lúc build, các file được đóng gói vào Worker thành cấu trúc `{migrations: [{name, statements[]}]}`, sắp theo **tên file**.
- Tách câu lệnh bằng tokenizer SQL:
  - bỏ comment `--` và `/* */` (kể cả dòng đánh dấu `--> statement-breakpoint` nếu có);
  - tôn trọng chuỗi và định danh có quote (`'…'`, `"…"`, `` `…` ``, `[…]`);
  - bên trong `CREATE TRIGGER … BEGIN … END` không tách tại `;` (thân trigger giữ nguyên một câu lệnh);
  - bỏ câu lệnh rỗng.

### 4.2 Bảng theo dõi
Tương thích với Wrangler để hai cách áp migration dùng chung:
```sql
CREATE TABLE IF NOT EXISTS d1_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### 4.3 Thủ tục trạng thái
`TRANG_THAI_MIGRATION()` → `{ready, pending[], unknown[]}`:
- `pending` = tên trong gói chưa có trong `d1_migrations`;
- `unknown` = tên đã áp nhưng không có trong gói (DB mới hơn phiên bản ứng dụng đang chạy);
- `ready = pending.length == 0 && unknown.length == 0`.

### 4.4 Thủ tục áp migration
`AP_MIGRATION()`:
```
status = TRANG_THAI_MIGRATION()
status.unknown khác rỗng → lỗi "The database contains migrations that are not part of this release."
với mỗi m trong status.pending (theo thứ tự tên):
   db.batch([INSERT INTO d1_migrations(name) VALUES (m.name), ...m.statements])   // nguyên tử
   lỗi UNIQUE trên name (request song song đã áp) → bỏ qua, tiếp tục
   lỗi khác → dừng, lỗi "Migration <name> failed: <thông điệp>"
→ {applied: [tên đã áp]}
```

### 4.5 API `/api/admin/migrations`
| Method | Hành vi |
|---|---|
| GET | `{ready, pending, unknown}` |
| POST | Origin check → `AP_MIGRATION()` → `{ready, pending, unknown, applied}`; lỗi → 500 `{error}`; ghi audit `system.migrate` với danh sách đã áp |

## 5. Chỉ mục tìm kiếm `/api/admin/search-index`
| Method | Hành vi |
|---|---|
| GET | `{indexed: count(messages_fts), messages: count(messages)}` |
| POST | Origin check → `INSERT INTO messages_fts(messages_fts) VALUES('rebuild')` → trả lại số đếm |
UI: nút "Rebuild search index" trong thẻ bảo trì của trang Overview, hiện khi `indexed ≠ messages`.

## 6. Kiểm tra & kích hoạt cập nhật phiên bản

### 6.1 Cấu hình
| Biến | Ý nghĩa |
|---|---|
| `APP_VERSION` | Phiên bản đang chạy (semver), gắn lúc build |
| `RELEASE_SOURCE_URL` | Tuỳ chọn. URL trả JSON `{version, notesUrl?, publishedAt?}` của bản phát hành mới nhất |
| `UPDATE_WEBHOOK_URL` | Tuỳ chọn. URL của pipeline CI/CD (deploy hook) sẽ cập nhật và triển khai lại |
| `UPDATE_WEBHOOK_TOKEN` | Secret gửi kèm dưới dạng `Authorization: Bearer <token>` |

### 6.2 API `/api/admin/update`
- `GET` → `{currentVersion, targetVersion, available, notesUrl, configured: {releaseSource, updateWebhook}}`:
  - không có `RELEASE_SOURCE_URL` → `targetVersion: null`, `available: false`;
  - gọi nguồn phát hành (timeout 10 s, cache 1 giờ); lỗi → `targetVersion: null`, kèm `error: "Could not check for updates"`;
  - so sánh semver 3 phần, bỏ tiền tố `v` và hậu tố pre-release/build; `available = target > current`.
- `POST` → Origin check; không có `UPDATE_WEBHOOK_URL` → 400 "Update webhook is not configured"; `available = false` → 409 "Already up to date"; runtime ngoài Workers → 400 "Update this installation by deploying a new image" ([03-tuy-chon/08](08-runtime-node-tu-host.md)); gọi `POST <UPDATE_WEBHOOK_URL>` body `{targetVersion, currentVersion}` (timeout 15 s) → 2xx → 202 `{ok: true, targetVersion, runUrl?}` (`runUrl` lấy từ response nếu có); không 2xx → 502 "The update pipeline rejected the request". Ghi audit `system.update_requested`.
- Pipeline CI là bên ngoài hệ thống: nó lấy mã phiên bản đích, build và deploy. Nó **không** áp migration; sau khi deploy, admin thấy migration pending và áp qua §4.5 (hoặc pipeline tự chạy `wrangler d1 migrations apply`).

## 7. UI (trang Overview của admin)
- Thẻ "Application update":
  - có bản mới → "{APP_NAME} v{target} is available (current v{current})" + link release notes + nút "Update" (chỉ khi có webhook) → confirm "Start the update pipeline for v{target}?";
  - không có → "{APP_NAME} is up to date (v{current})";
  - chưa cấu hình nguồn phát hành → "Update checks are not configured".
- Dòng migration **luôn hiển thị**, độc lập với cấu hình cập nhật:
  - `pending` > 0 → "{n} database migration(s) pending" + nút "Update database" (confirm "Apply {n} pending migration(s)? Create a backup first if you have not.");
  - `unknown` > 0 → cảnh báo "The database is newer than this version of the application. Deploy the latest version before making changes.";
  - ready → "Database schema is up to date".
- Kết quả thao tác hiển thị inline; lỗi hiện thông điệp từ server.

## 8. Lỗi & biên
- Hai admin bấm "Update database" cùng lúc → một bên áp, bên kia bỏ qua migration đã có (UNIQUE) và trả `applied` rỗng.
- Migration lỗi giữa chừng → migration đó không được ghi vào `d1_migrations` (batch nguyên tử); các migration trước đó vẫn giữ.
- Có `unknown` → không áp gì, UI hiện cảnh báo.

## 9. Tiêu chí chấp nhận
- [ ] DB có 2 migration pending → GET trả đúng `pending`; POST áp cả hai, GET sau đó `ready: true`.
- [ ] POST không có header `Origin` → 403.
- [ ] Migration áp bằng `wrangler d1 migrations apply` được runner nhận là đã áp.
- [ ] DB có migration không có trong gói → POST lỗi, không áp gì.
- [ ] Không cấu hình `RELEASE_SOURCE_URL` → GET `available: false`, UI "Update checks are not configured", dòng migration vẫn hiện.
- [ ] POST update khi đã là bản mới nhất → 409.
