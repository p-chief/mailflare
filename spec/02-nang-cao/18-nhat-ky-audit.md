# Nhật ký hoạt động (Audit log & Activity)

> **[NÂNG CAO]** · Phụ thuộc: [00-nen-tang/04-mo-hinh-du-lieu.md §3.11](../00-nen-tang/04-mo-hinh-du-lieu.md) · Liên quan: [01-co-ban/02-dang-nhap-phien.md](../01-co-ban/02-dang-nhap-phien.md), [01-co-ban/09-to-chuc-thu.md](../01-co-ban/09-to-chuc-thu.md), [16-da-nguoi-dung-shared-mailbox.md](16-da-nguoi-dung-shared-mailbox.md)

## 1. Mục tiêu
Ghi lại các hành động quan trọng (đăng nhập, gửi, đọc, di chuyển, xoá vĩnh viễn thư…), cho admin tra cứu có lọc và phân trang, cho mỗi người dùng xem lịch sử đăng nhập của chính mình, và tự xoá bản ghi quá hạn lưu giữ.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Ghi audit cho auth & thao tác thư | Audit thao tác cấu hình (domain, rule, webhook…) |
| Trang Activity (login/logout) và trang Audit đầy đủ cho admin | Xuất CSV, gửi log ra hệ thống ngoài |
| Lịch sử đăng nhập của chính mình | Cảnh báo đăng nhập bất thường |
| Lưu giữ có thời hạn (cron) | |

## 3. Dữ liệu
`audit_logs`: `id` `aud_…`, `actor_user_id`, `target_user_id` (FK users SET NULL), `mailbox_id` (FK SET NULL), `message_id` (FK SET NULL), `action`, `metadata` (JSON), `created_at`. Index: `(created_at, id)`, `(actor_user_id, created_at)`, `(target_user_id, created_at)`, `(mailbox_id, created_at)`, `(action, created_at)`.

## 4. Ghi — thủ tục `GHI_AUDIT({actorUserId, targetUserId?, mailboxId?, messageId?, action, metadata?})`
| action | Khi | metadata |
|---|---|---|
| `auth.login` | đăng nhập thành công (1 bước hoặc sau MFA) | `{ipAddress, city, country, device, platform, userAgent}` |
| `auth.mfa_verified` | bước 2 thành công | như trên + `method` (`totp` \| `recovery`) |
| `auth.logout` | logout với session hợp lệ | như `auth.login` |
| `auth.password_reset` | đổi mật khẩu bằng link reset | `{ipAddress}` |
| `email.send` | gửi thành công | `{to, cc?, subject}` |
| `email.read` | mở thư; bulk read/unread | `{bulkAction?}` |
| `email.move` | mọi đổi status/folder (đơn & bulk): archive, trash, spam, inbox, folder | `{status}` (đơn) hoặc `{bulkAction}` (bulk) |
| `email.delete_permanent` | xoá vĩnh viễn thư ([01-co-ban/09-to-chuc-thu.md](../01-co-ban/09-to-chuc-thu.md)) | `{messageId, subject, previousStatus}` |
| `email.spam_feedback` | report spam / not spam ([11-bo-loc-spam.md](11-bo-loc-spam.md)) | `{classification}` |

- Với `email.delete_permanent`, dòng audit được ghi **trước** khi xoá thư; cột `message_id` sẽ thành null do FK SET NULL nên id và tiêu đề được giữ trong `metadata`.
- Metadata auth: IP = `cf-connecting-ip` → phần tử đầu của `x-forwarded-for` → `"Unknown"`; city/country từ `cf-ipcity`/`cf-ipcountry`; device `Tablet|Mobile|Desktop` và platform `Windows|iOS|Android|macOS|Linux|Unknown` suy từ `User-Agent`; `userAgent` cắt 500 ký tự.
- Lỗi khi ghi audit **không** làm hỏng thao tác chính (log lỗi rồi tiếp tục).

## 5. Đọc

### 5.1 Tham số chung
| Tham số | Quy tắc |
|---|---|
| `limit` | số nguyên 1–200, mặc định 100; không phải số nguyên dương → 400 "Invalid limit" |
| `cursor` | chuỗi mờ từ `nextCursor`; = base64url(`<created_at ms>:<id>`); không giải mã được → 400 "Invalid cursor" |

Thứ tự `created_at DESC, id DESC`; trang sau lấy `(created_at, id) < cursor`. Response luôn kèm `nextCursor` (null khi hết).

### 5.2 Phạm vi của admin
Admin chỉ thấy dòng liên quan tới **tài khoản được quản lý** của mình (chính mình + tài khoản mình tạo — [16 §3](16-da-nguoi-dung-shared-mailbox.md)): `actor_user_id ∈ tập đó` **hoặc** `target_user_id ∈ tập đó`. User thường gọi endpoint admin → 403 "Forbidden".

### 5.3 `GET /api/activity?limit&cursor` (admin)
Chỉ `action IN ('auth.login','auth.logout')` trong phạm vi §5.2 → `{activities:[{id, action, metadata (object), createdAt, actorEmail}], nextCursor}`.

### 5.4 `GET /api/audit-logs?action&userId&mailboxId&limit&cursor` (admin)
| Bộ lọc | Quy tắc |
|---|---|
| `action` | khớp chính xác (vd `email.move`); giá trị kết thúc bằng `.*` khớp tiền tố (vd `auth.*`) |
| `userId` | dòng có `actor_user_id = userId` hoặc `target_user_id = userId`; user ngoài phạm vi §5.2 → 404 "Account not found" |
| `mailboxId` | dòng có `mailbox_id = mailboxId`; mailbox phải thuộc một tài khoản trong phạm vi §5.2 (owner), nếu không 404 "Mailbox not found" |

Các bộ lọc kết hợp bằng AND, cùng với phạm vi §5.2 → `{auditLogs:[{id, action, metadata (object), createdAt, actorEmail, targetEmail, mailboxLocalPart, mailboxHostname, messageId}], nextCursor}`.

### 5.5 `GET /api/settings/login-history?limit&cursor` (mọi user đã đăng nhập)
Dòng `action IN ('auth.login','auth.logout','auth.mfa_verified','auth.password_reset')` với `actor_user_id = user.id` → `{entries:[{id, action, createdAt, ipAddress, city, country, device, platform}], nextCursor}` (không trả `userAgent` đầy đủ, không trả dòng của người khác).

## 6. Lưu giữ (cron)
- Cấu hình `AUDIT_RETENTION_DAYS` (biến môi trường, mặc định 365; `0` = giữ vĩnh viễn).
- Tác vụ trong cron hằng ngày ([00-nen-tang/02-kien-truc-cloudflare.md](../00-nen-tang/02-kien-truc-cloudflare.md)):
```
nếu AUDIT_RETENTION_DAYS > 0:
   lặp: DELETE FROM audit_logs WHERE id IN (
           SELECT id FROM audit_logs WHERE created_at < now − N ngày LIMIT 1000)
        cho tới khi xoá < 1000 dòng hoặc chạm giới hạn thời gian của lần chạy cron
```
Xoá theo lô để không vượt giới hạn một câu lệnh D1; phần còn lại được xoá ở lần chạy sau.

## 7. UI
- `/activity` (admin): bảng Activity (Login/Logout), User (email + city • country), Device (thiết bị + platform • IP), Time; nút "Load more" theo `nextCursor`; rỗng → "No login or logout activity yet".
- `/audit-logs` (admin): bộ lọc Action (dropdown các action ở §4 + "All auth" / "All email"), Account (chọn trong tài khoản được quản lý), Mailbox; bảng Time, Action, Actor, Target, Mailbox, Details (metadata rút gọn, mở rộng xem JSON); "Load more"; rỗng → "No audit entries match these filters".
- Settings → Account → Security → "Recent sign-ins": danh sách từ §5.5 (sự kiện, thời gian, thiết bị • platform, IP, city • country), "Load more".

## 8. Tiêu chí chấp nhận
- [ ] Mỗi login thành công có một dòng `auth.login` với IP và thiết bị.
- [ ] Archive một thư → dòng `email.move` `{status:"archived"}`; xoá vĩnh viễn → dòng `email.delete_permanent` còn giữ tiêu đề dù thư đã mất.
- [ ] User thường gọi `/api/activity` hoặc `/api/audit-logs` → 403.
- [ ] User thường xem được lịch sử đăng nhập của chính mình, không thấy của người khác.
- [ ] Admin A không thấy dòng audit của tài khoản do admin B tạo.
- [ ] `/api/audit-logs?action=auth.*` chỉ trả action bắt đầu bằng `auth.`; duyệt bằng `nextCursor` không trùng, không sót.
- [ ] `limit=abc` → 400.
- [ ] Dòng cũ hơn `AUDIT_RETENTION_DAYS` bị cron xoá; `AUDIT_RETENTION_DAYS=0` → không xoá.
