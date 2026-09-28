# Backup & khôi phục dữ liệu D1

> **[TÙY CHỌN]** — Có thể thay bằng **D1 Time Travel** (khôi phục tới thời điểm bất kỳ trong 30 ngày) + versioning R2. Nếu giữ, cần sửa tính không-giao-dịch của restore.

## 1. Phạm vi
Xuất **toàn bộ bảng D1** thành một file JSON lên R2, theo lịch hoặc thủ công; khôi phục từ file. **Không** bao gồm dữ liệu R2 (raw, attachment, avatar).

## 2. Dữ liệu
- `backup_settings` (id `default`, seed bởi migration): `enabled`, `schedule_type` daily|weekly|monthly, `schedule_value`, `retention_enabled`, `retention_days` (30). Chỉ UPDATE (không upsert).
- `backups`: `status` queued|running|completed|failed, `trigger` manual|scheduled, `r2_key`, `filename`, `size`, `error`, `created_by_user_id`, `created_at`, `started_at`, `completed_at`.

## 3. Chạy backup (`runDatabaseBackup`)
```
UPDATE backups SET status='running', started_at
kiểm tra độ phủ: mọi bảng trong sqlite_master (trừ sqlite_%, _cf%, messages_fts%, d1_migrations) phải có trong BACKUP_TABLES
   → thiếu: "Backup aborted: <names> not listed in BACKUP_TABLES…"
SELECT * từng bảng (29 bảng, thứ tự cha → con: users, domains, mailboxes, mailbox_access, contacts, folders,
   api_keys, messages, message_attachments, outbound_jobs, routing_rules, webhooks, webhook_deliveries, sessions,
   audit_logs, backup_settings, backups, app_settings, license_settings, email_templates, calendar_events,
   auto_reply_deliveries, spam_token_stats, spam_reputation, spam_feedback, mailbox_aliases,
   password_reset_tokens, mfa_recovery_codes, login_challenges)
doc = {"format":"mailflare-database-backup","version":1,"createdAt":ISO,"tables":{…}}
R2.put(`backups/database/<id>/mailflare-<ISO với :. → ->.json`, application/json)
UPDATE status='completed', filename, r2_key, size, completed_at
deleteExpiredBackups()
lỗi → status='failed', error; throw
```
Toàn bộ nằm trong bộ nhớ Worker (giới hạn 128 MB) — không phù hợp DB lớn. Worker chết giữa chừng → dòng kẹt `running` (không xoá được, chặn lịch trong ngày).

## 4. Lịch
Cron `0 2 * * *` (02:00 UTC):
```
settings.enabled && isBackupDue(type, value, now):
   daily   → luôn
   weekly  → now.getUTCDay() == value (0 = CN … 6 = T7)
   monthly → now.getUTCDate() == value (1–28)
&& chưa có backup scheduled (queued|running|completed) trong ngày UTC hiện tại
   → tạo record scheduled + chạy
ngược lại → chỉ chạy dọn retention
```
Retention (khi bật): xoá mọi backup (kể cả manual) `created_at < now − days` với status completed|failed, xoá object R2 trước.

## 5. API (admin)
| Method | Path | Hành vi |
|---|---|---|
| GET | `/api/backups` | `{settings, backups (100 mới nhất), configuration:{configured:true, missing:[]}}` |
| PUT | `/api/backups` | `{enabled, scheduleType, scheduleValue (daily→null; weekly 0–6; monthly 1–28), retentionEnabled, retentionDays 1–3650}`; sai → 400 "Invalid backup settings" |
| POST | `/api/backups` | tạo manual + chạy **đồng bộ trong request** → `{backupId}` |
| DELETE | `/api/backups/{id}` | xoá object + dòng; đang chạy → lỗi |
| GET | `/api/backups/{id}/download` | stream file (header `application/sql` dù nội dung JSON — nên sửa) |
| POST | `/api/backups/restore` | multipart `backup` → khôi phục |
Lưu ý: các route này bắt mọi lỗi và trả 403/400 chung chung.

## 6. Khôi phục
```
parse JSON; kiểm tra format, version 1, 19 bảng bắt buộc là mảng, bảng mới hơn tuỳ chọn
tương thích cũ: gộp message_bodies (trước migration 0019) vào messages
mọi dòng phải là object
DELETE FROM mọi bảng theo thứ tự NGƯỢC (con → cha)          // xoá cả sessions, lịch sử backup
INSERT từng dòng theo thứ tự xuôi, batch 50 dòng
```
**Không giao dịch toàn cục**: lỗi giữa chừng để lại DB trống/nửa vời. Không đụng `d1_migrations` và R2. FTS tự đồng bộ qua trigger (rowid mới); có thể `POST /api/admin/search-index` để rebuild. Người thực hiện thường bị đăng xuất (bảng sessions bị thay).

## 7. UI
Trang `/backups`: nút "Restore" (confirm "Restore this backup? This replaces all current database records and may sign you out.") và "Back up now"; thẻ "Automatic backup" (bật, tần suất, ngày, xoá cũ sau N ngày); bảng lịch sử (file, Manual/Scheduled, trạng thái, kích thước, ngày, tải về, xoá — không confirm); tự làm mới 5 s khi có backup đang chạy.
