# Hồ sơ cá nhân & đổi mật khẩu

> **[CƠ BẢN]** · Liên quan: [05-quan-ly-mailbox.md](05-quan-ly-mailbox.md) (primary mailbox), [02-nang-cao/08-chuyen-tiep-tai-khoan.md](../02-nang-cao/08-chuyen-tiep-tai-khoan.md), [02-nang-cao/16-da-nguoi-dung-shared-mailbox.md](../02-nang-cao/16-da-nguoi-dung-shared-mailbox.md)

## 1. Mục tiêu
Cho người dùng tự sửa tên hiển thị, email khôi phục, và đổi mật khẩu an toàn; giữ tên của tài khoản nhất quán ở mọi nơi nó hiển thị.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Tên, `resetEmail`, (tuỳ chọn) `forwardingEmail` qua profile | Đổi email đăng nhập (không hỗ trợ) |
| Đổi mật khẩu khi biết mật khẩu cũ | Quên mật khẩu (`02-nang-cao/14`) |
| Đồng bộ tên với primary mailbox & danh bạ | Avatar (`02-nang-cao/19`) |
| Quy tắc đồng bộ khi admin sửa tên tài khoản khác | Các trường khác của quản lý tài khoản (`02-nang-cao/16`) |

## 3. Đồng bộ danh tính — thủ tục `DONG_BO_DANH_TINH(userId, name, avatarKey?)`
Là **cách duy nhất** để đổi tên (hoặc avatar) của một tài khoản — dùng chung cho: người dùng tự sửa profile (§4.1), sửa `displayName` của primary mailbox ([05-quan-ly-mailbox.md §4.4](05-quan-ly-mailbox.md)), admin sửa tài khoản khác (§4.3), đổi avatar (`02-nang-cao/19`).

1. `UPDATE users SET name, avatar_key` (avatar chỉ khi được truyền).
2. Với mỗi mailbox **personal** của user:
   - nếu là primary mailbox (địa chỉ `localPart@hostname` = `user.email`) → `UPDATE mailboxes SET display_name = name, avatar_key`;
   - mailbox personal khác → **không** đổi `display_name`;
   - với **mọi địa chỉ hợp lệ** của mailbox đó ([05-quan-ly-mailbox.md §3.2](05-quan-ly-mailbox.md)) → upsert `contacts(userId, email)` với `displayName` (primary: tên user; khác: `display_name` của mailbox, nếu null thì tên user), `avatarKey`, `source = 'manual'`.

Hệ quả: người dùng luôn thấy chính mình trong danh bạ với tên đúng, và thư gửi đi hiển thị tên mới.

## 4. API

### 4.1 `PATCH /api/settings/profile` (session)
Body:
| Trường | Quy tắc |
|---|---|
| `name` | trim, 1–100, bắt buộc |
| `resetEmail` | email hợp lệ hoặc `""` (→ null), bắt buộc có mặt |
| `forwardingEmail` | tuỳ chọn; email hoặc `""` (→ null); không gửi → giữ nguyên |

Luồng:
1. Validate schema (400).
2. Đặt `forwardingEmail` mới (khác null) mà tài khoản không có quyền lợi chuyển tiếp (`canForwardEmail = false`, xem [03-tuy-chon/01](../03-tuy-chon/01-license-branding.md)) → 403.
3. `DONG_BO_DANH_TINH(user.id, name)`.
4. `UPDATE users SET reset_email, forwarding_email` (lowercase).
5. Trả `{user: {id, email, name, resetEmail, forwardingEmail, canForwardEmail}}`.

### 4.2 `PATCH /api/settings/password` (session)
Body `{ currentPassword (≥1), newPassword (8–128) }`.
1. Sai `currentPassword` → 400 "Current password is incorrect".
2. `newPassword` trùng mật khẩu cũ → 400 "New password must be different from the current password".
3. `UPDATE users SET password_hash = bcrypt(newPassword, 12)`.
4. Xoá mọi session của user **trừ** session của request hiện tại — đăng xuất mọi thiết bị khác, giữ phiên đang dùng.
5. `{ok: true}`.

### 4.3 Admin sửa tên tài khoản khác — `PATCH /api/accounts/{id}` với trường `name`
Quyền và các trường khác: xem [02-nang-cao/16](../02-nang-cao/16-da-nguoi-dung-shared-mailbox.md). Khi body có `name`:
- trim, 1–100; rỗng → 400 "A valid account name is required";
- gọi `DONG_BO_DANH_TINH(targetUserId, name)` — **cùng quy tắc** như khi người dùng tự sửa (§3): chỉ primary mailbox nhận `display_name` mới, các mailbox personal khác giữ nguyên tên riêng; danh bạ của tài khoản đích được cập nhật.

## 5. Quyết định thiết kế
**Email khôi phục thuộc domain của chính hệ thống.** Nếu hệ thống hỏng thì link reset gửi tới địa chỉ nội bộ sẽ không đọc được.
- Mặc định: API chấp nhận; UI hiển thị cảnh báo khi `resetEmail` thuộc một domain có trong bảng `domains` ("Use an address outside this system so you can still receive reset links if it is unavailable.").
- Thay thế: API từ chối 400 với cùng điều kiện.

## 6. Tiêu chí chấp nhận
- [ ] Đổi tên → danh sách mailbox hiển thị tên mới cho primary mailbox; thư gửi mới có From với tên mới; danh bạ của chính user có tên mới.
- [ ] Đổi tên không thay `display_name` của mailbox personal không phải primary.
- [ ] Admin đổi tên tài khoản khác → kết quả giống hệt khi chủ tài khoản tự đổi (cùng mailbox bị ảnh hưởng).
- [ ] Đổi mật khẩu → session ở trình duyệt khác bị 401, session hiện tại vẫn dùng được.
- [ ] `resetEmail: ""` → cột thành null; không thể reset mật khẩu qua email nữa.
- [ ] Đặt `forwardingEmail` khi không có quyền lợi chuyển tiếp → 403, không đổi gì.
