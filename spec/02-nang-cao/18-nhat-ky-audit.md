# Nhật ký hoạt động (Audit log & Activity)

> **[NÂNG CAO]**

## 1. Mục tiêu
Ghi lại các hành động quan trọng (đăng nhập, gửi, đọc, di chuyển thư…) và cho admin xem lịch sử đăng nhập/đăng xuất.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi (chưa có) |
|---|---|
| Ghi audit cho auth & thao tác thư | Giao diện xem audit thao tác thư |
| Trang Activity (login/logout) | Lọc, phân trang, xuất, lưu giữ có thời hạn |

## 3. Ghi — `createAuditLog({actorUserId, targetUserId?, mailboxId?, messageId?, action, metadata?})`
| action | Khi | metadata |
|---|---|---|
| `auth.login` | login thành công (1 bước hoặc sau MFA) | `{ipAddress, city, country, device, platform, userAgent}` |
| `auth.mfa_verified` | bước 2 thành công | như trên |
| `auth.logout` | logout có session hợp lệ | như trên |
| `auth.password_reset` | redeem link reset | `{ipAddress}` |
| `email.send` | gửi thành công | `{to, cc?, subject}` |
| `email.read` | mở thư; bulk read/unread | `{bulkAction?}` |
| `email.delete` | mọi đổi status/folder (đơn & bulk) | `{status}` hoặc `{bulkAction}` |
| `email.spam_feedback` | report spam / not spam | `{classification}` |
Metadata auth: IP = `cf-connecting-ip` → `x-forwarded-for[0]` → "Unknown"; city/country từ `cf-ipcity`/`cf-ipcountry`; device `Tablet|Mobile|Desktop`; platform `Windows|iOS|Android|macOS|Linux|Unknown`. Lỗi ghi log auth bị nuốt.

## 4. Đọc (admin)
| Method | Path | Trả về |
|---|---|---|
| GET | `/api/activity?limit=` | `{activities:[{id, action, metadata (chuỗi JSON), createdAt, actorEmail}]}` |
| GET | `/api/audit-logs?limit=` | `{auditLogs:[{id, action, metadata, createdAt, actorEmail, targetEmail, mailboxLocalPart, mailboxHostname}]}` |
Cả hai: chỉ `action IN ('auth.login','auth.logout')`, `created_at DESC`, `limit` mặc định 100, tối đa 200 (không offset). Phạm vi **toàn hệ thống** (admin nào cũng thấy mọi user).

UI `/activity`: bảng Activity (Login/Logout), User (email + city • country), Device (thiết bị + platform • IP), Time; rỗng → "No login or logout activity yet". `/audit-logs` chuyển hướng sang `/activity`.

## 5. Đề xuất khi viết lại
- Đổi tên `email.delete` → `email.move`; thêm `email.delete_permanent`.
- Trang audit đầy đủ có lọc action/user/mailbox, phân trang cursor.
- Cho user thường xem lịch sử đăng nhập của chính mình.
- Cron xoá audit cũ hơn N ngày.
- `limit` không phải số → hiện là NaN, cần kiểm tra.

## 6. Tiêu chí chấp nhận
- [ ] Mỗi login thành công có một dòng `auth.login` với IP và thiết bị.
- [ ] User thường gọi `/api/activity` → 403.
