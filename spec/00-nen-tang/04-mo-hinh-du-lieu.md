# Mô hình dữ liệu

> **[CƠ BẢN]** · Nhóm: Nền tảng · Liên quan: [03-thuat-ngu-trang-thai.md](03-thuat-ngu-trang-thai.md), [06-quy-uoc-chung.md](06-quy-uoc-chung.md)
>
> Kiểu `ts` = integer Unix **giây**. `bool` = integer 0/1.
> Nhãn của từng bảng cho biết nhóm chức năng; MVP chỉ cần các bảng CƠ BẢN.
> Toàn bộ schema được tạo bằng **một migration SQL khởi tạo**; thay đổi về sau là các migration SQL tiếp theo.

## 1. Sơ đồ quan hệ

```
users 1─* sessions
users 1─* domains 1─* mailboxes 1─* messages 1─* message_attachments
                 │            ├─* mailbox_aliases (domain_id → domains)
                 │            ├─* folders 1─* messages.folder_id
                 │            ├─* mailbox_access *─1 users
                 │            ├─* routing_rules (scope=mailbox)
                 │            ├─* auto_reply_deliveries
                 │            └─* spam_token_stats / spam_reputation / spam_feedback
                 └─* routing_rules (scope=domain)
users 1─* contacts, api_keys, webhooks 1─* webhook_deliveries, outbound_jobs, calendar_events,
          email_templates, password_reset_tokens, mfa_recovery_codes, login_challenges
users.created_by_user_id → users (admin tạo tài khoản)
audit_logs → users (actor/target), mailboxes, messages  (đều set null)
backup_settings, backups, app_settings, license_settings: bảng cấu hình toàn hệ thống
messages_fts: FTS5 external-content trên messages
```

## 2. Bảng CƠ BẢN

### 2.1 `users`
| Cột | Kiểu | Ràng buộc / mặc định | Ghi chú |
|---|---|---|---|
| `id` | text | PK | `usr_…` |
| `email` | text | NOT NULL UNIQUE | lowercase, = địa chỉ primary mailbox |
| `reset_email` | text | null | email khôi phục bên ngoài |
| `forwarding_email` | text | null | NÂNG CAO — chuyển tiếp toàn tài khoản |
| `password_hash` | text | NOT NULL | bcrypt cost 12 (hoặc PBKDF2 — xem [06-quy-uoc-chung.md §2](06-quy-uoc-chung.md)) |
| `name` | text | NOT NULL | |
| `avatar_key` | text | null | R2 key (TÙY CHỌN) |
| `role` | text | `admin`\|`user`, mặc định `user` | |
| `disabled` | bool | false | |
| `can_manage_mailboxes` | bool | false | |
| `keyboard_shortcuts_enabled` | bool | true | TÙY CHỌN |
| `spam_protection_enabled` | bool | true | NÂNG CAO |
| `totp_secret` | text | null | NÂNG CAO — đã mã hoá (xem [06-quy-uoc-chung.md §2](06-quy-uoc-chung.md)) |
| `totp_enabled` | bool | false | NÂNG CAO |
| `totp_confirmed_at` | ts | null | NÂNG CAO |
| `totp_last_counter` | int | null | NÂNG CAO — bước thời gian của mã TOTP gần nhất đã chấp nhận (chống dùng lại mã) |
| `created_by_user_id` | text | FK users, ON DELETE SET NULL | |
| `created_at` | ts | now | |

### 2.2 `sessions`
| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | text PK | chuỗi ngẫu nhiên 21 ký tự, không tiền tố |
| `user_id` | FK users CASCADE | |
| `token_hash` | text UNIQUE | SHA-256 hex của token `sess_…` |
| `expires_at` | ts | now + 30 ngày |
| `created_at` | ts | |

### 2.3 `domains`
| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | text PK | `dom_…` |
| `user_id` | FK users CASCADE | chủ domain |
| `hostname` | text | UNIQUE (`domains_hostname_idx`), lowercase |
| `zone_id` | text NOT NULL | hoặc `"manual"` |
| `status` | `pending`\|`active`\|`error`, mặc định `pending` | xem [03-thuat-ngu-trang-thai.md §3](03-thuat-ngu-trang-thai.md) |
| `routing_status` | text null | chuỗi trạng thái Email Routing (vd `ready`) hoặc `"manual"` |
| `sending_subdomain_tag` | text null | |
| `sending_requested` | bool false | người dùng muốn gửi |
| `sending_enabled` | bool false | ảnh chụp lần ghi gần nhất; khi hiển thị trạng thái DNS luôn đọc trạng thái thật trên zone (xem [01-co-ban/04-quan-ly-domain.md](../01-co-ban/04-quan-ly-domain.md)) |
| `routing_enabled` | bool false | |
| `routing_enabled_by_app` | bool false | hệ thống là bên bật Email Routing trên zone lúc provision; chỉ khi true mới được tắt routing khi xoá domain (xem [01-co-ban/04-quan-ly-domain.md](../01-co-ban/04-quan-ly-domain.md)); đã true thì không quay về false khi thêm lại |
| `created_at` | ts | |

Index: `domains_user_idx(user_id)`.

### 2.4 `mailboxes`
| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | text PK | `mbx_…` |
| `user_id` | FK users CASCADE | owner |
| `domain_id` | FK domains CASCADE | domain chính |
| `local_part` | text NOT NULL | lowercase |
| `display_name` | text null | |
| `signature` | text null | ≤ 10 000 ký tự, text thuần (được chuyển sang HTML khi chèn) |
| `auto_reply_enabled` | bool false | NÂNG CAO |
| `auto_reply_subject` | text NOT NULL, `"Out of office"` | NÂNG CAO |
| `auto_reply_body` | text NOT NULL, `""` | NÂNG CAO |
| `avatar_key` | text null | TÙY CHỌN |
| `type` | `personal`\|`shared`, mặc định `personal` | |
| `use_all_domains` | bool **true** | NÂNG CAO |
| `disabled` | bool false | |
| `created_at` | ts | |

UNIQUE `mailboxes_address_idx(domain_id, local_part)`.

### 2.5 `messages`
| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | text PK | `msg_…` |
| `user_id` | FK users CASCADE NOT NULL | inbound: owner mailbox; outbound: người gửi |
| `mailbox_id` | FK mailboxes SET NULL | **khoá phân quyền** |
| `direction` | `inbound`\|`outbound` | |
| `provider_message_id` | text null | Message-ID. Inbound: giá trị header `Message-ID` nguyên dạng (**có** `<>`); outbound: Message-ID Cloudflare trả về (**không** `<>`); import: header hoặc `import:<file>:<size>` |
| `folder_id` | FK folders SET NULL | |
| `from_addr` | text NOT NULL | `"Name" <addr>` hoặc `addr` |
| `to_addr` | text NOT NULL | toàn bộ danh sách, nối `", "` (nháp có thể `""`) |
| `cc_addr`, `bcc_addr` | text null | bcc chỉ thư đi |
| `subject` | text null | |
| `snippet` | text null | ≤ 200 ký tự |
| `text_body`, `html_body` | text null | |
| `search_text` | text null | văn bản thuần để index tìm kiếm (text + text rút từ HTML), ứng dụng tính mỗi lần ghi body — [01-co-ban/14-tim-kiem.md §4.1](../01-co-ban/14-tim-kiem.md) |
| `raw_r2_key` | text null | inbound/import/JMAP import; thư gửi từ composer = null |
| `status` | text NOT NULL, `received` | xem [03-thuat-ngu-trang-thai.md](03-thuat-ngu-trang-thai.md) |
| `read` | bool false | nháp tạo với `true` |
| `starred` | bool false | |
| `snoozed_until` | ts null | NÂNG CAO |
| `sort_at` | ts null | NÂNG CAO — thời điểm sắp xếp khi thư được đánh thức sau snooze; danh sách sắp `COALESCE(sort_at, created_at) DESC` — [02-nang-cao/06-snooze.md](../02-nang-cao/06-snooze.md) |
| `trashed_at` | ts null | thời điểm vào `trash`/`spam`, null khi rời hai trạng thái đó; dùng cho tự dọn — [01-co-ban/09-to-chuc-thu.md](../01-co-ban/09-to-chuc-thu.md) |
| `thread_id` | text null | |
| `in_reply_to` | text null | không `<>` |
| `references_header` | text null | các id cách nhau bằng khoảng trắng, không `<>` |
| `spam_score` | int null | NÂNG CAO |
| `spam_verdict` | `inbox`\|`suspicious`\|`spam` null | NÂNG CAO |
| `spam_signals` | text JSON null | NÂNG CAO |
| `spam_analyzed_at` | ts null | NÂNG CAO |
| `spam_analysis_error` | text null (≤300) | NÂNG CAO |
| `created_at` | ts | thời điểm lưu (import: header Date) |

Index: `(user_id, created_at)`, `(mailbox_id)`, `(folder_id)`, `(mailbox_id, thread_id)`, `(mailbox_id, provider_message_id)`, `(mailbox_id, raw_r2_key)`, `(mailbox_id, sort_at)`, `(status, trashed_at)`.

### 2.6 `message_attachments`
| Cột | Ghi chú |
|---|---|
| `id` PK `att_…` | |
| `message_id` FK messages CASCADE | |
| `filename` NOT NULL | đã sanitize |
| `content_type` NOT NULL | |
| `size` int NOT NULL | byte |
| `disposition` `attachment`\|`inline` | |
| `content_id` null | cho ảnh inline (`cid:`) |
| `r2_key` UNIQUE | `attachments/<messageId>/<attachmentId>/<filename>` |
| `created_at` | |

Index `(message_id)`. **Quy tắc xoá**: xoá dòng message cascade xoá dòng attachment nhưng **không** xoá object R2 — mọi thao tác xoá thư phải xoá object R2 (attachment và `raw_r2_key`) **trước**, rồi mới xoá dòng.

### 2.7 `outbound_jobs`
| Cột | Ghi chú |
|---|---|
| `id` PK `job_…` | |
| `user_id` FK users CASCADE | |
| `message_id` FK messages SET NULL | |
| `status` `queued`\|`sending`\|`sent`\|`failed`\|`cancelled` | `queued → sending → sent|failed`; `queued → cancelled` (huỷ hẹn giờ). `sending` = consumer đã giành quyền gửi bằng `UPDATE … WHERE status='queued'` — [02-nang-cao/05-hen-gio-gui.md](../02-nang-cao/05-hen-gio-gui.md) |
| `payload` text JSON | input gửi đã chuẩn hoá (from, to[], cc[], bcc[], subject, html, text, headers, mailboxId, inReplyTo, references, threadId, scheduledAt, attachments **không có** content) |
| `error` | thông báo lỗi |
| `scheduled_at` ts null | |
| `created_at`, `updated_at` | |

### 2.8 `messages_fts`
```sql
CREATE VIRTUAL TABLE messages_fts USING fts5(
  subject, from_addr, to_addr, cc_addr, search_text,
  content='messages', content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2');
-- trigger messages_fts_ai (AFTER INSERT), messages_fts_ad (AFTER DELETE),
-- messages_fts_au (AFTER UPDATE OF subject, from_addr, to_addr, cc_addr, search_text)
INSERT INTO messages_fts(messages_fts) VALUES ('rebuild');
```
SQL đầy đủ của ba trigger: [01-co-ban/14-tim-kiem.md §4.2](../01-co-ban/14-tim-kiem.md). Ứng dụng không bao giờ ghi FTS trực tiếp; trigger giữ chỉ mục đồng bộ. `wrangler d1 export` không chạy với bảng ảo (backup JSON của hệ thống không bị ảnh hưởng). Khi tách câu lệnh SQL để chạy migration phải giữ nguyên thân trigger (`BEGIN … END;`).

## 3. Bảng NÂNG CAO

### 3.1 `folders`
`id` PK `fld_…` · `user_id` FK CASCADE (= owner mailbox) · `mailbox_id` FK CASCADE · `name` · `color` (mặc định `#2563eb`) · `created_at`. UNIQUE `(mailbox_id, name)`.

### 3.2 `mailbox_aliases`
`id` PK `als_…` · `mailbox_id` FK CASCADE · `domain_id` FK CASCADE · `local_part` · `created_at`. UNIQUE `(domain_id, local_part)`.

### 3.3 `mailbox_access`
`id` PK `mac_…` · `mailbox_id` FK CASCADE · `user_id` FK CASCADE · `permission` `read_only`\|`send_as`\|`send_on_behalf`\|`full_access` (mặc định `read_only`) · `created_by_user_id` FK SET NULL · `created_at`. UNIQUE `(mailbox_id, user_id)`.

### 3.4 `auto_reply_deliveries`
`id` `arp_…` · `mailbox_id` FK CASCADE · `recipient` (lowercase) · `sent_at`. UNIQUE `(mailbox_id, recipient)`, index `sent_at`.

### 3.5 `contacts`
`id` = `"<userId>:<email>"` · `user_id` FK CASCADE · `email` lowercase · `display_name` · `avatar_key` · `source` `manual`\|`inbound`\|`outbound` (mặc định `inbound`) · `blocked` bool · `last_seen_at` · `created_at`. UNIQUE `(user_id, email)`.

### 3.6 `routing_rules`
| Cột | Ghi chú |
|---|---|
| `id` | `rule_…` hoặc `block:<mailboxId>:<email>` |
| `user_id` FK CASCADE | người tạo |
| `domain_id` FK CASCADE NOT NULL | |
| `scope` | `mailbox`\|`domain`, mặc định `mailbox` — **luôn set tường minh** khi ghi |
| `name` | null (chỉ rule domain) |
| `enabled` | bool true |
| `pattern` | NOT NULL, ≤ 200 — luôn ghi cùng giá trị với `match_value`; khi so khớp dùng `match_value`, rỗng thì dùng `pattern` |
| `match_field` | `email`\|`content`\|`title`\|`sender`\|`recipient`, mặc định `email` |
| `match_operator` | `contains`\|`exact`\|`starts_with`\|`ends_with`\|`regex`, mặc định `contains` |
| `match_value` | NOT NULL `""` |
| `mailbox_id` FK SET NULL | mailbox của rule mailbox / đích của rule domain |
| `folder_id` FK SET NULL | chỉ rule mailbox |
| `action` | `store`\|`forward`\|`reject`\|`spam`\|`trash`, mặc định `store` |
| `forward_to` | chỉ `forward` |
| `keep_copy` | bool false, chỉ `forward` |
| `reject_reason` | chỉ `reject` |
| `priority` | int 0 (lớn chạy trước) |
| `last_matched_at`, `match_count` | thống kê rule domain |
| `created_at` | tie-break: cũ chạy trước |

Index: `(domain_id, scope, enabled)`, `(mailbox_id)`, `(priority)`.

### 3.7 `webhooks`
`id` `wh_…` · `user_id` FK CASCADE · `description` · `url` · `secret` (`whsec_…`, lưu **plain** để ký) · `events` JSON array · `enabled` · `max_attempts` (5) · `created_at`.

### 3.8 `webhook_deliveries`
`id` `whd_…` · `webhook_id` FK CASCADE · `event_type` · `payload` (body JSON đã gửi) · `status` `pending|delivered|failed|retrying|exhausted` · `attempts` · `response_status` · `error` (≤500) · `duration_ms` · `last_attempt_at` · `next_retry_at` · `created_at`. Index `(webhook_id, created_at)`, `(status)`.

### 3.9 `api_keys`
`id` `key_…` · `user_id` FK CASCADE · `name` · `prefix` (12 ký tự đầu của key, có index — dùng để tra cứu và hiển thị) · `key_hash` (SHA-256 hex của toàn bộ key) · `scopes` JSON · `expires_at` (ts null = không hết hạn) · `created_at` · `last_used_at`.

### 3.10 `password_reset_tokens`, `mfa_recovery_codes`, `login_challenges`
| Bảng | Cột |
|---|---|
| `password_reset_tokens` | `id`, `user_id` FK CASCADE, `token_hash` UNIQUE, `expires_at`, `used_at`, `created_at` |
| `mfa_recovery_codes` | `id` `rc_…`, `user_id` FK CASCADE, `code_hash` UNIQUE, `used_at`, `created_at` |
| `login_challenges` | `id`, `user_id` FK CASCADE, `token_hash` UNIQUE, `expires_at`, `created_at` |

### 3.11 `audit_logs`
`id` `aud_…` · `actor_user_id`, `target_user_id` FK users SET NULL · `mailbox_id` FK SET NULL · `message_id` FK SET NULL · `action` · `metadata` JSON · `created_at`. Index: `(created_at, id)`, `(actor_user_id, created_at)`, `(target_user_id, created_at)`, `(mailbox_id, created_at)`, `(action, created_at)`.

### 3.12 Bộ lọc spam
| Bảng | Khoá | Cột |
|---|---|---|
| `spam_token_stats` | UNIQUE `(mailbox_id, token)` | `spam_count`, `ham_count`, `updated_at` |
| `spam_reputation` | UNIQUE `(mailbox_id, type, key)`; `type` ∈ `email`\|`domain`\|`fingerprint` | `messages_seen`, `spam_count`, `ham_count`, `first_seen_at`, `last_seen_at` |
| `spam_feedback` | PK `message_id` (FK CASCADE) | `mailbox_id`, `actor_user_id`, `classification` `spam`\|`ham`, `training_tokens` JSON, `reputation_keys` JSON, `tokenizer_version` (1), `created_at`, `updated_at` |

## 4. Bảng TÙY CHỌN

| Bảng | Nhãn | Cột chính |
|---|---|---|
| `backup_settings` (1 dòng, id `default`, seed bởi migration khởi tạo) | [TÙY CHỌN] | `enabled`, `schedule_type` `daily|weekly|monthly`, `schedule_value`, `retention_enabled`, `retention_days` (30), `updated_at` |
| `backups` | [TÙY CHỌN] | `id` `bak_…`, `status` `queued|running|completed|failed`, `trigger` `manual|scheduled`, `r2_key`, `filename`, `size`, `error`, `created_by_user_id`, `created_at`, `started_at`, `completed_at` |
| `app_settings` (1 dòng) | [TÙY CHỌN] | `app_name` (mặc định = cấu hình `APP_NAME`), `icon_key`, `updated_at` |
| `license_settings` (id `default`) | [TÙY CHỌN] — chỉ khi dùng tích hợp máy chủ license | `instance_id` UNIQUE (UUID), `instance_url`, `license_key_hash` (SHA-256 hex), `plan` `community|pro|team`, `state`, `features` JSON, `activated_at`, `validated_at`, `updated_at` |
| `calendar_events` | [TÙY CHỌN] | `id` `evt_…`, `user_id`, `mailbox_id`, `title`, `description`, `location`, `attendees` JSON, `starts_at`, `ends_at`, timestamps |
| `email_templates` | [TÙY CHỌN] | `user_id`, `name`, `subject`, `text_body` — xem [03-tuy-chon/06-lich-va-mau-thu.md](../03-tuy-chon/06-lich-va-mau-thu.md) |

## 5. Bố trí khoá R2

| Tiền tố | Nội dung | Tạo bởi |
|---|---|---|
| `inbound/<Date.now()>-<id ngẫu nhiên>.eml` | MIME gốc thư đến (`contentType message/rfc822`, `customMetadata {from,to}`) | email handler |
| `attachments/<messageId>/<attId>/<filename>` | File đính kèm (`customMetadata {filename, messageId}`) | nhận, gửi, forward, import |
| `imports/<messageId>.eml` | MIME gốc thư import | import |
| `drafts/<messageId>.eml` | MIME do JMAP client upload | JMAP `Email/import` |
| `jmap-uploads/…` | Blob tạm của JMAP (xoá khi được claim, hoặc bởi cron sau 24 giờ) | JMAP upload |
| `backups/database/<backupId>/app-<ISO>.json` | Backup JSON (`format: "app-database-backup"`) | backup runner |
| avatar key, `<key>:preview` | Ảnh WebP | avatar |
