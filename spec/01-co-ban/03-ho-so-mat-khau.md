# Hồ sơ cá nhân & đổi mật khẩu

> **[CƠ BẢN]** · Liên quan: [05-quan-ly-mailbox.md](05-quan-ly-mailbox.md) (primary mailbox), [02-nang-cao/08-chuyen-tiep-tai-khoan.md](../02-nang-cao/08-chuyen-tiep-tai-khoan.md)

## 1. Mục tiêu
Cho người dùng tự sửa tên hiển thị, email khôi phục, và đổi mật khẩu an toàn.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Tên, `resetEmail`, (tuỳ chọn) `forwardingEmail` qua profile | Đổi email đăng nhập (không hỗ trợ) |
| Đổi mật khẩu khi biết mật khẩu cũ | Quên mật khẩu (`02-nang-cao/14`) |
| Đồng bộ tên với primary mailbox & danh bạ | Avatar (`02-nang-cao/19`) |

## 3. Đồng bộ danh tính (`syncPersonalIdentity`)
Khi tên (hoặc avatar) user thay đổi:
1. `UPDATE users SET name, avatar_key`.
2. Với mỗi mailbox **personal** của user:
   - nếu là primary mailbox (địa chỉ = `user.email`) → `UPDATE mailboxes SET display_name = name, avatar_key`;
   - với **mọi địa chỉ hợp lệ** của mailbox đó → upsert `contacts(userId, email)` với `displayName` (primary: tên user; khác: tên mailbox hoặc tên user), `avatarKey`, `source = 'manual'`.

Hệ quả: người dùng luôn thấy chính mình trong danh bạ với tên đúng, và thư gửi đi hiển thị tên mới.

## 4. API

### 4.1 `PATCH /api/settings/profile` (session)
Body:
| Trường | Quy tắc |
|---|---|
| `name` | trim, 1–100, bắt buộc |
| `resetEmail` | email hợp lệ hoặc `""` (→ null), bắt buộc có mặt |
| `forwardingEmail` | tuỳ chọn; email hoặc `""` (→ null); không gửi → giữ nguyên |

Luồng: validate (400) → nếu đặt `forwardingEmail` mới mà không có quyền forwarding (bản gốc: license Pro/Team) → 403 → `syncPersonalIdentity(name)` → `UPDATE users SET reset_email, forwarding_email` → trả `{user: {id, email, name, resetEmail, forwardingEmail, canForwardEmail}}`.

### 4.2 `PATCH /api/settings/password` (session)
Body `{ currentPassword (≥1), newPassword (8–128) }`.
1. Sai `currentPassword` → 400 "Current password is incorrect".
2. `newPassword` trùng mật khẩu cũ → 400 "New password must be different from the current password".
3. `UPDATE users SET password_hash = bcrypt(newPassword, 12)`.
4. `deleteUserSessions(userId, keepToken = token của request)` — đăng xuất mọi thiết bị khác, **giữ** phiên hiện tại.
5. `{ok: true}`.

## 5. Tiêu chí chấp nhận
- [ ] Đổi tên → danh sách mailbox hiển thị tên mới cho primary mailbox; thư gửi mới có From với tên mới.
- [ ] Đổi mật khẩu → session ở trình duyệt khác bị 401, session hiện tại vẫn dùng được.
- [ ] `resetEmail: ""` → cột thành null; không thể reset mật khẩu qua email nữa.

## 6. Ghi chú khi xây dựng lại
- `resetEmail` nên khác domain của hệ thống (nếu hệ thống hỏng thì vẫn nhận được link) — hiện không kiểm tra.
- Admin sửa tên tài khoản khác (`PATCH /api/accounts/{id}`) hiện ghi `displayName` cho **mọi** mailbox personal của user đó (không chỉ primary) — không nhất quán với quy tắc ở §3; nên dùng chung `syncPersonalIdentity`.
