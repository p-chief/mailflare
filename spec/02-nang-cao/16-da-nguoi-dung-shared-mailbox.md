# Đa người dùng & shared mailbox

> **[NÂNG CAO]** · Phụ thuộc: [00-nen-tang/05-phan-quyen.md](../00-nen-tang/05-phan-quyen.md), [01-co-ban/05-quan-ly-mailbox.md](../01-co-ban/05-quan-ly-mailbox.md) · Liên quan: [01-co-ban/03-ho-so-mat-khau.md](../01-co-ban/03-ho-so-mat-khau.md) (đồng bộ danh tính), [03-tuy-chon/01-license-branding.md](../03-tuy-chon/01-license-branding.md) (entitlement tuỳ chọn), [08-chuyen-tiep-tai-khoan.md](08-chuyen-tiep-tai-khoan.md)

## 1. Mục tiêu
Cho admin tạo tài khoản cho người khác trên domain của mình, quản lý vai trò/khoá tài khoản, và tạo hộp thư chung (shared inbox) chia sẻ với nhiều người theo mức quyền chọn được.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Tạo/sửa tài khoản (tên, role, disabled, canManageMailboxes, forwarding, đặt lại mật khẩu) | Xoá tài khoản (thiết kế chỉ khoá — §4.5) |
| Tạo mailbox cho tài khoản do mình tạo | Mời qua email, tự đăng ký |
| Shared mailbox + 4 mức quyền | Chia sẻ mailbox personal |
| | Nhóm (group), phân quyền theo domain |

## 3. Mô hình sở hữu & cổng truy cập
- `users.created_by_user_id` = admin đã tạo tài khoản. Tập **tài khoản được quản lý** của admin A = {A} ∪ {u : `u.created_by_user_id = A.id`}. Admin chỉ xem và sửa tài khoản trong tập này.
- Shared mailbox: `mailboxes.type = 'shared'`, owner (`user_id`) = admin tạo.
- Chia sẻ: `mailbox_access(mailbox_id, user_id, permission)` UNIQUE `(mailbox_id, user_id)`, chỉ có hiệu lực với mailbox `shared` và khi tính năng đa người dùng bật.

### 3.1 Tính năng đa người dùng
Mặc định **bật**, không cần entitlement. Nếu người triển khai dùng phân gói tính năng ([03-tuy-chon/01-license-branding.md](../03-tuy-chon/01-license-branding.md)), cờ entitlement `multiUser` quyết định: tắt → mọi endpoint §4–§5 trả 403 `{error:"This feature is not enabled on this installation.", code:"FEATURE_DISABLED"}`. Hiệu lực của quyền chia sẻ (`mailbox_access`) do cờ riêng `mailboxSharing` quyết định; tắt cờ đó thì chỉ owner truy cập được mailbox ([05-phan-quyen §4.1](../00-nen-tang/05-phan-quyen.md)).

### 3.2 Cổng — `YEU_CAU_ADMIN_DA_NGUOI_DUNG(request)`
Chạy đầu mọi endpoint quản lý tài khoản và thành viên shared mailbox:
```
chưa đăng nhập                 → 401 "Unauthorized"
user.role != 'admin'           → 403 "Forbidden"
tính năng đa người dùng tắt    → 403 FEATURE_DISABLED "This feature is not enabled on this installation."
```

## 4. Tài khoản

### 4.1 `GET /api/accounts`
Chỉ các tài khoản được quản lý của admin (chính admin + tài khoản admin đã tạo), sắp `created_at DESC`:
`{accounts:[{id, email, name, resetEmail, role, disabled, hasAvatar, canManageMailboxes, forwardingEmail, createdAt}]}`.

### 4.2 `POST /api/accounts`
Body `{ username (trim, 1–64, ^[a-zA-Z0-9._%+-]+$), domainId, password (8–128), role ∈ {user, admin} = 'user', canManageMailboxes? = false }`.
```
domain = domains WHERE id = domainId AND user_id = admin.id → không có: 404 "Domain not found"
localPart = lower(username); email = localPart + "@" + domain.hostname
users có email                         → 409 "Email already registered"
mailboxes có (domain, localPart)       → 409 "Email address is already assigned"
try:
   tạo rule Email Routing trên Cloudflare cho `email` trỏ tới Worker {EMAIL_WORKER_NAME}
      (bỏ qua với zone "manual"; xem 00-nen-tang/07-cloudflare-api.md)
   INSERT users { id usr_…, email, password_hash: bcrypt(password, 12), name: username, role,
                  can_manage_mailboxes, created_by_user_id: admin.id }
   INSERT mailboxes { type: 'personal', user_id: user.id, domain_id, local_part: localPart, display_name: username }
   cập nhật routing của domain cho mailbox mới (như khi tạo mailbox — 01-co-ban/05-quan-ly-mailbox.md)
catch lỗi:
   xoá mailbox và user vừa tạo (nếu có), gỡ rule Cloudflare vừa tạo (nếu có)
   → 502 { error: <thông điệp lỗi> }
→ 201 { account }
```
Tài khoản mới không có `resetEmail` (người dùng tự đặt sau trong hồ sơ).

### 4.3 `GET /api/accounts/{id}` / `PATCH /api/accounts/{id}`
Tài khoản phải thuộc tập được quản lý (khác → 404 "Account not found").

PATCH body (mọi trường tuỳ chọn, rỗng → 400 "No changes provided"):
| Trường | Quy tắc |
|---|---|
| `name` | trim, 1–100 |
| `role` | `user` \| `admin` |
| `disabled` | boolean |
| `canManageMailboxes` | boolean |
| `forwardingEmail` | email hoặc `""` (→ null) |
| `password` | 8–128, hoặc `""` (= không đổi) |

```
id == admin.id && (role == 'user' || disabled == true)
      → 400 "You cannot remove your own admin access or disable your own account"
đặt forwardingEmail mới khác null mà tài khoản không có quyền forwarding → 403 (xem 08-chuyen-tiep-tai-khoan.md)
name đổi       → thủ tục đồng bộ danh tính cá nhân (01-co-ban/03-ho-so-mat-khau.md §3) với tên mới
password có    → UPDATE password_hash = bcrypt(password, 12);
                 DELETE sessions của tài khoản (nếu tài khoản là chính admin: giữ session hiện tại)
disabled = true → mọi session/API key của tài khoản bị từ chối ngay (kiểm tra ở tầng xác thực)
UPDATE users SET role, disabled, can_manage_mailboxes, forwarding_email (các trường có mặt)
→ { account }
```

### 4.4 Mailbox của tài khoản
- `GET /api/accounts/{id}/mailboxes` → `{mailboxes:[{id, localPart, displayName, domainId, hostname}]}`.
- Thêm mailbox cho tài khoản: `POST /api/mailboxes {ownerUserId, domainId, localPart, displayName, type:'personal'}` — `ownerUserId` phải thuộc tập được quản lý của admin (xem [01-co-ban/05-quan-ly-mailbox.md](../01-co-ban/05-quan-ly-mailbox.md)).

### 4.5 Quyết định thiết kế — chỉ khoá, không xoá tài khoản
**Mặc định:** tài khoản không bao giờ bị xoá qua API; admin dùng `disabled = true`. Lý do: tài khoản sở hữu thư, file đính kèm trên R2, rule Email Routing trên Cloudflare, dòng audit, và có thể là owner của shared mailbox — xoá dây chuyền dễ làm mất dữ liệu không thể khôi phục.

Hành vi khi khoá:
- Đăng nhập → 403 "Account disabled"; session và API key hiện có → 401 ngay.
- Mailbox personal của tài khoản **vẫn nhận và lưu thư**, dữ liệu giữ nguyên; mở khoá (`disabled = false`) là dùng lại được như cũ.
- Muốn ngừng nhận thư cho địa chỉ đó: admin xoá mailbox ([01-co-ban/05-quan-ly-mailbox.md](../01-co-ban/05-quan-ly-mailbox.md)).
- Tài khoản bị khoá không xuất hiện trong `availableUsers` khi thêm thành viên shared mailbox; dòng `mailbox_access` cũ vẫn giữ nhưng vô hiệu vì user không xác thực được.

**Phương án thay thế (nếu cần xoá thật):** `DELETE /api/accounts/{id}` chỉ cho tài khoản do admin tạo, không phải chính admin, không sở hữu shared mailbox; xoá rule Cloudflare của mọi mailbox, xoá object R2 (raw MIME, attachment, avatar) theo mailbox, rồi xoá user (cascade). Không nằm trong phạm vi mặc định.

### 4.6 `canManageMailboxes`
User có cờ này (và do admin tạo) được: thấy domain của admin (chủ domain hiệu lực — [05-phan-quyen §3.1](../00-nen-tang/05-phan-quyen.md)), tạo mailbox cho **chính mình** trên domain đó, xoá mailbox **của mình**, quản lý rule domain (qua mailbox `full_access`).

## 5. Shared mailbox

### 5.1 Tạo
`POST /api/mailboxes {type:'shared', domainId, localPart, displayName}` — chỉ admin, khi tính năng đa người dùng bật (khác → 403 như §3.2). Owner = admin. UI sau khi tạo chuyển sang trang cấu hình để chọn thành viên.

### 5.2 Thành viên — `/api/mailboxes/{id}/access`
Người gọi phải qua cổng §3.2 **và** là owner của mailbox, mailbox phải `type = 'shared'` (khác → 404 "Mailbox not found").
| Method | Hành vi |
|---|---|
| GET | `{members:[{id, userId, userEmail, userName, permission, createdAt}], availableUsers:[{id, email, name}]}` — `availableUsers` = tài khoản do admin tạo, không disabled, chưa là thành viên |
| POST `{userId, permission}` | `permission` ∈ 4 mức §5.3, `userId` ≠ owner (body sai → 400 "Choose a valid account"); user phải do admin tạo và không disabled (404 "Account not found"); **upsert** theo `(mailbox_id, user_id)` → `{member}` |
| PATCH `{userId, permission}` | đổi mức quyền của thành viên hiện có (không có → 404) → `{member}` |
| DELETE `?userId=` | gỡ quyền → `{ok: true}` |

UI: danh sách thành viên với dropdown mức quyền (đổi → PATCH), nút gỡ; ô thêm thành viên gồm chọn tài khoản + chọn mức quyền (mặc định `read_only`), kèm mô tả ngắn từng mức.

### 5.3 Mức quyền
| Quyền | Đọc | Đánh dấu đọc/sao | Gửi (on behalf) | Gửi (as) | Di chuyển/xoá, rule, folder, cài đặt |
|---|---|---|---|---|---|
| `read_only` | ✔ | ✔ | | | |
| `send_on_behalf` | ✔ | ✔ | ✔ `"X on behalf of Y"` | | |
| `send_as` | ✔ | ✔ | ✔ | ✔ `"Y"` | |
| `full_access` | ✔ | ✔ | ✔ | ✔ | ✔ |

### 5.4 Hành vi liên quan
- Mailbox shared hiện trong selector của thành viên (biểu tượng "Shared inbox").
- Thành viên nhận realtime cho thư mới của mailbox.
- Danh bạ, rule, auto-reply, bộ lọc spam, webhook của shared mailbox thuộc owner (admin).

## 6. Tiêu chí chấp nhận
- [ ] Admin tạo tài khoản `bob@example.com` → bob đăng nhập được, có mailbox `bob@`.
- [ ] `GET /api/accounts` của admin A không chứa tài khoản do admin B tạo; A sửa tài khoản đó → 404.
- [ ] Admin tự đặt `role: 'user'` hoặc `disabled: true` cho chính mình → 400.
- [ ] Disable bob → mọi session của bob 401 ngay; thư tới `bob@` vẫn được lưu.
- [ ] Đặt lại mật khẩu bob → session cũ của bob bị xoá.
- [ ] Đổi tên bob → tên primary mailbox và contact của bob đổi theo; mailbox personal khác giữ tên riêng.
- [ ] Thêm bob vào `support@` với `read_only` → bob đọc được, không archive được, không gửi được; đổi sang `send_as` → bob gửi được với From "Support".
- [ ] Gỡ quyền → `support@` biến khỏi selector của bob.
- [ ] Entitlement `multiUser` tắt (khi dùng phân gói) → `/api/accounts` 403, bob mất quyền vào `support@`.
