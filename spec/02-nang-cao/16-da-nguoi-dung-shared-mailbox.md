# Đa người dùng & shared mailbox

> **[NÂNG CAO]** (bản gốc khoá sau license **Team**) · Phụ thuộc: [00-nen-tang/05-phan-quyen.md](../00-nen-tang/05-phan-quyen.md), [01-co-ban/05-quan-ly-mailbox.md](../01-co-ban/05-quan-ly-mailbox.md)

## 1. Mục tiêu
Cho admin tạo tài khoản cho người khác trên domain của mình, quản lý vai trò/khoá tài khoản, và tạo hộp thư chung (shared inbox) chia sẻ với nhiều người theo mức quyền.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi (chưa có) |
|---|---|
| Tạo/sửa tài khoản (tên, role, disabled, canManageMailboxes, forwarding, đặt lại mật khẩu) | Xoá tài khoản |
| Tạo mailbox cho tài khoản do mình tạo | Mời qua email, tự đăng ký |
| Shared mailbox + 4 mức quyền | Chia sẻ mailbox personal |
| | Nhóm (group), phân quyền theo domain |

## 3. Mô hình sở hữu
- `users.created_by_user_id` = admin đã tạo. Admin chỉ quản lý **chính mình** và tài khoản mình tạo.
- Shared mailbox: `mailboxes.type = 'shared'`, owner = admin tạo.
- Chia sẻ: `mailbox_access(mailbox_id, user_id, permission)`, chỉ có hiệu lực với mailbox `shared` và khi tính năng chia sẻ bật.
- Gating bản gốc (`requireTeamAdmin`): session (throw → 403 "Forbidden") → role admin (403) → license Team (403 "A Team license is required to manage accounts"). Khi viết lại cho riêng mình: bỏ bước license.

## 4. Tài khoản

### 4.1 `GET /api/accounts`
Liệt kê **mọi** user trong hệ thống (không lọc theo người tạo — không nhất quán với các thao tác khác): `{accounts:[{id,email,name,resetEmail,role,disabled,hasAvatar,canManageMailboxes,createdAt}]}` sắp `created_at DESC`.

### 4.2 `POST /api/accounts`
Body `{ username (trim, 1–64, [a-zA-Z0-9._%+-]), domainId, password (8–128), role = 'user' }`.
```
domain = domains WHERE id AND user_id = admin.id → 404 "Domain not found"
email = lower(username)@hostname; đã có user → 409 "Email already registered"
đã có mailbox (domain, username) → 409 "Email address is already assigned"
try:
  ensureEmailRoutingRuleToWorker(zone, email)
  INSERT users { id usr_…, email, passwordHash, name: username, role, createdByUserId: admin.id }
  INSERT mailboxes { personal, localPart: username, displayName: username }
  ensureMailboxDomainRouting(...)
catch → DELETE user; 502 {error}
→ 201 { account }
```
Không có `resetEmail` khi admin tạo (người dùng tự đặt sau).

### 4.3 `GET /api/accounts/{id}` / `PATCH /api/accounts/{id}`
Chỉ khi `account.id == admin.id` hoặc `account.createdByUserId == admin.id` (khác → 404).
PATCH body `{ name (1–100), role, disabled, canManageMailboxes, forwardingEmail? (email|""), password? (8–128 | "") }`:
- đặt forwarding mới khi không có quyền → 403;
- cập nhật name (+ `displayName` mọi mailbox personal của user), mật khẩu nếu có → **xoá mọi session** của user đó;
- cập nhật role, disabled, canManageMailboxes, forwardingEmail.
(Admin có thể tự hạ quyền/khoá chính mình — nên chặn.)

### 4.4 `GET /api/accounts/{id}/mailboxes`
Mailbox của tài khoản: `{mailboxes:[{id, localPart, displayName, domainId, hostname}]}`. Thêm mailbox cho tài khoản: `POST /api/mailboxes {ownerUserId, domainId, localPart, displayName, type:'personal'}`.

### 4.5 `canManageMailboxes`
User có cờ này (và do admin tạo) được: thấy domain của admin, tạo mailbox cho **chính mình** trên domain đó, xoá mailbox **của mình**, quản lý rule domain (qua mailbox full_access).

## 5. Shared mailbox

### 5.1 Tạo
`POST /api/mailboxes {type:'shared', domainId, localPart, displayName}` — admin (+ license). Owner = admin. UI sau khi tạo chuyển sang trang cấu hình để chọn thành viên.

### 5.2 Thành viên — `/api/mailboxes/{id}/access` (admin sở hữu mailbox shared)
| Method | Hành vi |
|---|---|
| GET | `{members:[{id,userId,userEmail,userName,permission,createdAt}], availableUsers:[user do admin tạo, không disabled]}` |
| POST `{userId, permission}` | user phải do admin tạo & không disabled (404); **upsert** theo `(mailbox,user)` (400 "Choose a valid account" nếu body sai) |
| DELETE `?userId=` | gỡ quyền |
UI hiện thêm thành viên luôn với `full_access` (API hỗ trợ đủ 4 mức — nên cho chọn).

### 5.3 Mức quyền
| Quyền | Đọc | Đánh dấu đọc/sao | Gửi (on behalf) | Gửi (as) | Di chuyển/xoá, rule, folder, cài đặt |
|---|---|---|---|---|---|
| `read_only` | ✔ | ✔ | | | |
| `send_on_behalf` | ✔ | ✔ | ✔ `"X on behalf of Y"` | | |
| `send_as` | ✔ | ✔ | ✔ | ✔ `"Y"` | |
| `full_access` | ✔ | ✔ | ✔ | ✔ | ✔ |

### 5.4 Hành vi liên quan
- Mailbox shared hiện trong selector của thành viên (biểu tượng "Shared inbox").
- Thành viên nhận realtime cho thư mới.
- Danh bạ, rule, auto-reply của shared mailbox thuộc owner (admin).
- `/api/accounts/{id}/mailbox-access` hiện trả **410** "Multiple accounts are not available in this build" (tàn dư).

## 6. Tiêu chí chấp nhận
- [ ] Admin tạo tài khoản `bob@example.com` → bob đăng nhập được, có mailbox `bob@`.
- [ ] Admin A không sửa được tài khoản do admin B tạo (404).
- [ ] Disable bob → mọi session của bob 401 ngay.
- [ ] Đặt lại mật khẩu bob → session cũ của bob bị xoá.
- [ ] Cấp `read_only` cho bob trên `support@` → bob đọc được, không archive được, không gửi được.
- [ ] Gỡ quyền → `support@` biến khỏi selector của bob.
