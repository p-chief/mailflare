# Phân quyền (Access control)

> Thuộc nhóm: Nền tảng · **[CƠ BẢN]** · Mọi chức năng đọc/ghi thư đều dựa vào file này.

## 1. Ba lớp kiểm soát

| Lớp | Câu hỏi | Nguồn |
|---|---|---|
| **Xác thực** | Ai đang gọi? | Session token (cookie `ep_session` hoặc `Authorization: Bearer sess_…`), API key (`Bearer ep_…`), hoặc public |
| **Vai trò** | Người này là `admin` hay `user`? | `users.role` |
| **Quyền mailbox** | Người này được làm gì với mailbox X? | owner / `mailbox_access` |

Ba lớp **độc lập**: vai trò admin **không** tự cho quyền đọc mailbox người khác.

## 2. Xác thực

### 2.1 Session
- Tra `sessions` theo `SHA-256(token)` với `expires_at > now`, lấy user.
- User `disabled = true` → coi như chưa đăng nhập (trả null).
- Nguồn token: ưu tiên header `Authorization: Bearer`, sau đó cookie `ep_session`.
- Thiếu/sai → **401** `{error:"Unauthorized"}`.

### 2.2 API key
- Header `Authorization: Bearer <key>`; lấy `prefix = key.slice(0,12)`, tìm các key cùng prefix, `bcrypt.compare` từng cái.
- User của key phải tồn tại và không disabled.
- `lastUsedAt` cập nhật khi null hoặc cũ hơn 60 s.
- Kiểm tra scope: `scopes.includes(required) || scopes.includes("*")`. Thiếu → **401** (bản gốc dùng 401 cho cả sai key lẫn thiếu scope; khi viết lại nên tách 401/403).
- JMAP còn chấp nhận `Authorization: Basic base64(user:key)` — username bị bỏ qua.

### 2.3 Public
Chỉ: setup status/prepare/domain/mx, register (khi chưa có admin), login, MFA verify, password reset request/confirm, inbound webhook (có HMAC), trang tĩnh.

## 3. Vai trò

| Khả năng | `admin` | `user` | Ghi chú |
|---|---|---|---|
| Thêm/xoá domain của mình | ✔ | ✔ (code không chặn role, nhưng UI chỉ cho admin) | Nên giới hạn admin khi viết lại |
| Rule cấp domain | ✔ (domain mình sở hữu) | chỉ khi `full_access` một mailbox của domain | |
| Tạo tài khoản, sửa tài khoản | ✔ (+ license Team ở bản gốc) | ✘ | chỉ tài khoản mình tạo |
| Tạo shared mailbox, cấp quyền | ✔ (+ Team) | ✘ | |
| Tạo mailbox cho tài khoản khác | ✔ (tài khoản mình tạo) | ✘ | |
| Tạo mailbox trên domain của admin | — | ✔ nếu `canManageMailboxes` | |
| Xoá mailbox | owner, hoặc admin tạo ra owner | owner **và** `canManageMailboxes` | |
| Backup, license, branding, migration, search index | ✔ | ✘ | |

### 3.1 "Chủ domain hiệu lực" của một user
```
effectiveDomainOwner(user) = (user.canManageMailboxes && user.createdByUserId) ? user.createdByUserId : user.id
```
Dùng khi liệt kê domain và khi chọn domain để tạo mailbox/alias.

## 4. Quyền trên mailbox

### 4.1 Thuật toán `getMailboxAccessLevel(user, mailboxId)`
```
mailbox = SELECT * FROM mailboxes WHERE id = ?
if !mailbox || mailbox.disabled            → null
if mailbox.user_id == user.id              → full_access (isOwner = true)
if mailbox.type != "shared"                → null
if !teamSharingEnabled                     → null      // bản gốc: license Team active; viết lại: feature flag
row = SELECT permission FROM mailbox_access WHERE mailbox_id=? AND user_id=?
row ? permission : null
```

### 4.2 Thứ bậc & cờ
```
read_only (1) < send_on_behalf (2) < send_as (3) < full_access (4)
```
| Cờ | Điều kiện | Được làm |
|---|---|---|
| `canRead` | ≥ 1 | xem danh sách/đếm/chi tiết/hội thoại, tải attachment, xem nguồn, đánh dấu đọc/chưa đọc, **gắn sao**, xem folder, xem liên hệ, tạo nháp forward từ thư này |
| `canSendOnBehalf` | ≥ 2 | tạo/sửa nháp, gửi thư. From = `"<Tên actor> on behalf of <Tên mailbox>" <addr>` |
| `canSendAs` | ≥ 3 | gửi với From = `"<Tên mailbox>" <addr>` |
| `canManage` | = 4 | đổi status (archive/trash/spam/inbox/folder), snooze, tạo folder, rule mailbox, alias, sửa mailbox, sửa tên liên hệ, chặn người gửi, huấn luyện spam, xem rule |

### 4.3 Danh sách mailbox truy cập được
`listAccessibleMailboxes(user)` =
- mailbox `user_id = user.id AND disabled = false` → `permission = full_access`, `isPrimary = (localPart@hostname == user.email)`;
- ∪ (nếu bật chia sẻ) mailbox `type = shared AND disabled = false` có dòng `mailbox_access(user)` → permission theo dòng, `isPrimary = false`.

Mỗi phần tử gồm: `id, userId, domainId, localPart, displayName, signature, autoReply*, useAllDomains, hasAvatar, type, disabled, createdAt, hostname, permission, isPrimary`.

## 5. Mẫu kiểm tra bắt buộc

### 5.1 Danh sách thư
```
if query.mailboxId:  require canRead(mailboxId) else 404 "Mailbox not found"; WHERE mailbox_id = ?
elif accessibleIds non-empty: WHERE mailbox_id IN (accessibleIds)
else: WHERE user_id = user.id
```

### 5.2 Một thư
```
msg = SELECT mailbox_id, … WHERE id = ?
if !msg || !msg.mailbox_id → 404
access = getMailboxAccessLevel(user, msg.mailbox_id)
if !access?.<cờ cần> → 404            // không tiết lộ thư tồn tại
```
Ngoại lệ: attachment của thư không có mailbox → chỉ `msg.user_id == user.id` mới xem được.

### 5.3 Nháp
Nháp dùng **quyền sở hữu trực tiếp**: `draft.user_id == user.id AND draft.status == 'draft'` (không qua mailbox access).

## 6. Tiêu chí chấp nhận
- [ ] User A không thể đọc/đổi trạng thái thư trong mailbox của B dù A là admin (khi chưa được chia sẻ) → 404.
- [ ] User có `read_only` trên shared mailbox: đọc, gắn sao, đánh dấu đọc được; archive/trash → không đổi (bulk trả 404 nếu không có thư hợp lệ).
- [ ] User `send_on_behalf` gửi thư: header From hiển thị "X on behalf of Y".
- [ ] Mailbox bị `disabled`: không ai (kể cả owner) truy cập được; không nhận thư.
- [ ] User bị disabled: mọi session và API key bị từ chối ngay (không cần xoá session).
- [ ] Tắt tính năng chia sẻ: mọi quyền delegated biến mất, owner không bị ảnh hưởng.
