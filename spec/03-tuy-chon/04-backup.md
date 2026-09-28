# Backup & khôi phục dữ liệu D1

> **[TÙY CHỌN]** · Phụ thuộc: [00-nen-tang/04-mo-hinh-du-lieu.md](../00-nen-tang/04-mo-hinh-du-lieu.md) · Liên quan: [05-van-hanh/01-bay-va-cai-thien.md](../05-van-hanh/01-bay-va-cai-thien.md), [04-giao-dien/07-quan-tri.md §10](../04-giao-dien/07-quan-tri.md)

## 1. Mục tiêu
Cho admin sao lưu toàn bộ dữ liệu bảng D1 thành một file JSON trên R2 (theo lịch hoặc thủ công), tải file về, và khôi phục từ file một cách **an toàn**: không bao giờ để cơ sở dữ liệu ở trạng thái trống hoặc nửa vời.

**Phương án khuyến nghị cho khôi phục thảm hoạ**: dùng **D1 Time Travel** (khôi phục D1 về thời điểm bất kỳ trong 30 ngày gần nhất bằng `wrangler d1 time-travel restore`) kết hợp bật versioning/lifecycle cho R2. Backup JSON trong ứng dụng là lớp bổ sung: bản sao di động, lưu lâu hơn 30 ngày, chuyển dữ liệu sang bản cài khác.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Mọi bảng dữ liệu trong danh sách sao lưu (§4.1) | Object R2 (raw MIME, attachment, avatar, icon) |
| Lịch daily/weekly/monthly, retention theo ngày | Backup gia tăng, mã hoá file backup |
| Khôi phục toàn phần có backup trước khôi phục và tự hoàn tác | Khôi phục từng bảng / từng bản ghi |
| | Bảng hệ thống `sqlite_%`, `_cf%`, `d1_migrations`, bảng ảo FTS `messages_fts%` |

## 3. Quyền
Mọi endpoint: admin. 401 khi không có phiên, 403 khi không phải admin hoặc (với request ghi) header `Origin` khác origin của ứng dụng.

## 4. Dữ liệu
- `backup_settings` (một dòng `id = 'default'`, tạo bởi migration khởi tạo): `enabled` (mặc định false), `schedule_type` `daily|weekly|monthly`, `schedule_value` (null / 0–6 / 1–28), `retention_enabled` (mặc định true), `retention_days` (mặc định 30), `updated_at`.
- `backups`: `id` (`bak_…`), `status` `queued|running|completed|failed`, `trigger` `manual|scheduled|pre_restore`, `r2_key`, `filename`, `size`, `error`, `created_by_user_id`, `created_at`, `started_at`, `completed_at`.

### 4.1 Danh sách bảng sao lưu
Thứ tự cha → con (dùng để chèn khi khôi phục; xoá theo thứ tự ngược):

| # | Bảng | Bắt buộc trong file |
|---|---|---|
| 1–19 | `users`, `domains`, `mailboxes`, `mailbox_access`, `contacts`, `folders`, `api_keys`, `messages`, `message_attachments`, `outbound_jobs`, `routing_rules`, `webhooks`, `webhook_deliveries`, `sessions`, `audit_logs`, `backup_settings`, `backups`, `app_settings`, `license_settings` | có |
| 20–29 | `email_templates`, `calendar_events`, `auto_reply_deliveries`, `spam_token_stats`, `spam_reputation`, `spam_feedback`, `mailbox_aliases`, `password_reset_tokens`, `mfa_recovery_codes`, `login_challenges` | tuỳ chọn (thiếu = mảng rỗng) |

Khi thêm bảng mới vào schema, bảng đó **phải** được thêm vào danh sách (ở nhóm tuỳ chọn); kiểm tra độ phủ ở §5 bảo đảm điều này.

## 5. Chạy backup
Thủ tục `CHAY_BACKUP(backupId)`:
```
UPDATE backups SET status='running', started_at=now WHERE id=backupId
kiểm tra độ phủ: mọi bảng trong sqlite_master (type='table', trừ sqlite_%, _cf%, messages_fts%, d1_migrations)
   phải có trong danh sách bảng sao lưu
   → thiếu: lỗi "Backup aborted: <tên bảng> not listed in the backup table list"
key = backups/database/<id>/app-<ISO createdAt, thay ':' và '.' bằng '-'>.json
mở ghi dạng stream lên R2 (multipart upload), content-type application/json
ghi '{"format":"app-database-backup","version":1,"createdAt":"<ISO>","tables":{'
với mỗi bảng theo thứ tự danh sách:
   ghi '"<bảng>":['
   đọc theo trang 1000 dòng (ORDER BY rowid, WHERE rowid > last) và ghi từng dòng JSON
   ghi ']'
ghi '}}' và hoàn tất upload
UPDATE backups SET status='completed', filename, r2_key, size, completed_at
DON_BACKUP_HET_HAN()
lỗi bất kỳ → huỷ multipart upload; UPDATE status='failed', error=<thông điệp rút gọn>, completed_at
```
- Ghi theo luồng để không giữ toàn bộ dữ liệu trong bộ nhớ Worker (giới hạn 128 MB).
- Cột BLOB (nếu có) được mã hoá base64 dạng `{"$b64": "..."}`.
- Backup `manual` được tạo ở trạng thái `queued`, chạy nền (`waitUntil` hoặc qua queue) và API trả ngay.
- Chỉ một backup `running` tại một thời điểm: tạo mới khi đang có backup `queued|running` → 409 "A backup is already in progress".

## 6. Lịch & dọn dẹp
Cron `0 2 * * *` (02:00 UTC), chung với các việc dọn dẹp khác ([05-van-hanh/01](../05-van-hanh/01-bay-va-cai-thien.md)):
```
DANH_DAU_BACKUP_KET(): backup 'queued' hoặc 'running' có created_at < now − 30 phút
   → status='failed', error='Backup did not finish (worker stopped)'
nếu settings.enabled và DEN_LICH(type, value, now):
     daily   → luôn
     weekly  → ngày trong tuần UTC của now == value (0 = CN … 6 = T7)
     monthly → ngày trong tháng UTC của now == value (1–28)
   và chưa có backup trigger='scheduled' (queued|running|completed) trong ngày UTC hiện tại
   → tạo record scheduled + CHAY_BACKUP
DON_BACKUP_HET_HAN()
```
`DON_BACKUP_HET_HAN()` (khi `retention_enabled`): xoá mọi backup (mọi `trigger`) có `created_at < now − retention_days` và status `completed|failed` — xoá object R2 trước, rồi xoá dòng. Luôn giữ lại ít nhất **một** backup `completed` mới nhất dù đã quá hạn.

## 7. API
| Method | Path | Hành vi |
|---|---|---|
| GET | `/api/backups` | `{settings, backups (100 mới nhất, created_at DESC)}` |
| PUT | `/api/backups` | `{enabled, scheduleType, scheduleValue, retentionEnabled, retentionDays}`; `scheduleValue`: daily → null, weekly 0–6, monthly 1–28; `retentionDays` 1–3650; sai → 400 "Invalid backup settings" |
| POST | `/api/backups` | tạo backup `manual` (`queued`) và chạy nền → 202 `{backupId}` |
| DELETE | `/api/backups/{id}` | xoá object R2 + dòng → `{ok: true}`; không thấy → 404; đang `queued|running` → 409 "Backup is still running" |
| GET | `/api/backups/{id}/download` | stream file: `Content-Type: application/json`, `Content-Disposition: attachment; filename="<filename>"`, `Cache-Control: no-store`; chưa `completed` hoặc object thiếu → 404 |
| POST | `/api/backups/restore` | multipart `backup` (file JSON) → khôi phục theo §8 → `{ok: true, restoredTables, restoredRows, preRestoreBackupId}` |

Mọi lỗi trả mã rõ ràng (400 dữ liệu sai, 404 không thấy, 409 xung đột, 500 lỗi hệ thống) với thông điệp cụ thể; không gộp lỗi thành 403.

## 8. Khôi phục an toàn
Thủ tục `KHOI_PHUC(file)` gồm ba pha; **không xoá dữ liệu nào** trước khi pha 1 và pha 2 thành công.

**Pha 1 — Kiểm tra toàn bộ file (không ghi DB)**
```
kích thước file ≤ giới hạn upload (00-nen-tang/08); vượt → 413
parse JSON; lỗi → 400 "Backup file is not valid JSON"
format == "app-database-backup" và version == 1, ngược lại → 400 "Unsupported backup format"
mỗi bảng bắt buộc có mặt và là mảng; bảng tuỳ chọn nếu có phải là mảng; bảng lạ → 400 "Unknown table <t>"
mỗi dòng là object; mọi khoá của object phải là cột có thật của bảng (PRAGMA table_info)
   → sai: 400 "Invalid row in <t> at index <i>: <lý do>"
kiểm tra tối thiểu: users có ít nhất một admin enabled → không có: 400 "Backup contains no enabled admin"
```

**Pha 2 — Backup trước khôi phục**
```
tạo backup trigger='pre_restore' và CHAY_BACKUP đồng bộ
lỗi → 500 "Could not create a safety backup; restore aborted" (DB không đổi)
```

**Pha 3 — Thay dữ liệu, tự hoàn tác khi lỗi**
```
DELETE FROM mọi bảng theo thứ tự NGƯỢC (con → cha), trừ `backups` và `backup_settings`
INSERT từng bảng theo thứ tự xuôi, batch 50 dòng (mỗi batch là một giao dịch D1)
lỗi bất kỳ ở pha 3:
   DELETE lại mọi bảng (trừ backups, backup_settings) → chèn lại từ file pre_restore
   → 500 "Restore failed and the previous data was put back: <lý do>"
   nếu hoàn tác cũng lỗi → 500 "Restore failed; restore backup <preRestoreBackupId> manually", log lỗi nghiêm trọng
```
- `backups` và `backup_settings` **giữ nguyên** của hệ thống hiện tại (để không mất lịch sử backup, kể cả bản pre_restore).
- Không đụng `d1_migrations` và R2. Chỉ mục FTS tự đồng bộ qua trigger khi chèn `messages`; admin có thể rebuild chỉ mục ([03-tuy-chon/05 §5](05-migration-self-update.md)).
- Bảng `sessions` bị thay → người thực hiện thường bị đăng xuất; UI cảnh báo trước.
- Ghi audit `backup.restore` (sau khi khôi phục, vào bảng `audit_logs` mới) với `{preRestoreBackupId, restoredRows}`.

**Phương án khôi phục vào DB mới** (cho dữ liệu lớn hoặc khi cần tuyệt đối an toàn): tạo một D1 mới, áp migration, chạy khôi phục vào DB đó (qua bản cài tạm hoặc script dùng Wrangler), kiểm tra, rồi đổi `database_id` của binding `DB` và deploy lại. DB cũ được giữ nguyên cho tới khi xác nhận.

## 9. Lỗi & biên
- Worker bị dừng giữa lúc backup → dòng kẹt được cron đánh dấu `failed` (§6); multipart upload dở dang bị huỷ theo lifecycle R2.
- File backup từ phiên bản schema cũ hơn (thiếu cột mới) → hợp lệ; cột thiếu nhận giá trị mặc định của schema.
- File có cột không còn trong schema → pha 1 từ chối (400), không xoá gì.
- Hai request khôi phục đồng thời → request thứ hai 409 "A restore is already in progress" (khoá bằng một dòng trạng thái hoặc Durable Object).

## 10. Tiêu chí chấp nhận
- [ ] Backup thủ công trả 202 ngay; sau khi xong, file JSON có `format = "app-database-backup"` và đủ 29 bảng.
- [ ] Thêm một bảng mới vào schema mà không cập nhật danh sách → backup `failed` với thông điệp nêu tên bảng.
- [ ] Tải về có `Content-Type: application/json`.
- [ ] Khôi phục file có một dòng sai cột → 400, dữ liệu hiện tại không đổi, không có backup pre_restore được tạo.
- [ ] Khôi phục mà một batch INSERT lỗi → dữ liệu trước khôi phục được đặt lại đầy đủ, response 500 nêu lý do.
- [ ] Khôi phục thành công → lịch sử backup (kể cả bản pre_restore) vẫn còn.
- [ ] Backup kẹt `running` quá 30 phút → cron đánh dấu `failed`, xoá được.
- [ ] Retention 7 ngày → backup 8 ngày tuổi bị xoá cả object R2, trừ bản completed mới nhất.

## 11. Ghi chú triển khai
- Có thể dùng `db.batch()` cho từng nhóm 50 INSERT; D1 thực thi mỗi batch như một giao dịch.
- Với DB lớn (hàng GB), ưu tiên D1 Time Travel; backup JSON trong ứng dụng phù hợp cho DB vừa và nhỏ.
