# Migration trong ứng dụng & tự cập nhật

> **[TÙY CHỌN]** — Khuyến nghị: dùng `wrangler d1 migrations apply` trong CI/CD và bỏ cả hai tính năng này.

## 1. Bundle migration
`npm run db:bundle` (chạy trước dev/build/deploy) đọc `drizzle/migrations/*.sql` **theo tên file**, tách câu lệnh bằng tokenizer (bỏ comment `--`/`/* */` kể cả `--> statement-breakpoint`, tôn trọng chuỗi/định danh có quote; trong `CREATE TRIGGER … BEGIN … END` không tách tại `;`) → `src/lib/migrations/bundle.json` `{migrations:[{name, statements[]}]}` (gitignored).

## 2. Runner (`src/lib/migrations/service.ts`)
- Bảng theo dõi tương thích Wrangler: `d1_migrations(id INTEGER PK AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`.
- `getMigrationStatus` → `{ready, pending[], unknown[]}` (`unknown` = đã áp nhưng không có trong bundle → DB mới hơn code).
- `applyPendingMigrations`: có `unknown` → lỗi "The database contains migrations that are not part of this Mailflare release."; mỗi migration pending: `db.batch([INSERT d1_migrations(name), ...statements])` (nguyên tử); lỗi mà tên đã có (request song song) → bỏ qua; lỗi khác → dừng `Migration <name> failed: …`.
- Dùng bởi `/api/setup/prepare` (public, trước khi có admin) và `/api/admin/migrations`.

## 3. `/api/admin/migrations` (admin)
- 401 không phiên, 403 không phải admin.
- `GET` → `{ready, pending, unknown}`.
- `POST` → yêu cầu header `Origin` = origin request (chống CSRF, 403 "Invalid request origin") → `{ready, pending, unknown, applied}`; lỗi 500.

## 4. Chỉ mục tìm kiếm `/api/admin/search-index` (admin)
`GET` → `{indexed: count(messages_fts), messages: count(messages)}`; `POST` → `rebuild` rồi trả số đếm. Không có UI gọi.

## 5. Tự cập nhật `/api/admin/update` (admin)
- Env: `GITHUB_UPDATE_TOKEN`, `GITHUB_UPDATE_REPO` (`owner/repo` của bản cài), `GITHUB_UPDATE_REF` (tuỳ chọn). Repo nguồn **hard-code** `hieunc229/mailflare`.
- `GET`: so `package.json.version` hiện tại với `package.json` của repo nguồn qua GitHub API (semver 3 phần, bỏ `v` và hậu tố) → `{available, configuration, configured, currentVersion, repository, targetVersion}`; thiếu cấu hình → `configured:false`.
- `POST`: runtime Node → 400; dispatch `POST /repos/<repo>/actions/workflows/deploy-update.yml/dispatches {ref}` → 202 `{ok, ref, repository, runUrl?}` (không kiểm tra `available`, không kiểm tra Origin).
- Workflow `deploy-update.yml` trong repo cài: fetch upstream → `git read-tree --reset -u upstream/<branch>` (**ghi đè** cây, không merge) → commit → push; Cloudflare Git integration tự deploy. Không migrate (admin bấm "Update database" riêng).

## 6. UI (trang /admin)
Thẻ "Application update": checklist env, "Mailflare vX is available… Update Mailflare" hoặc "up to date"; dòng migration: "N database migration(s) pending — Update database", hoặc cảnh báo khi có `unknown`. (Gotcha: dòng migration chỉ hiện khi GitHub env đã cấu hình.)
