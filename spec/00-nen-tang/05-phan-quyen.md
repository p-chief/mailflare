# Phân quyền (Access control)

> **[CƠ BẢN]** · Nhóm: Nền tảng · Mọi chức năng đọc/ghi thư đều dựa vào file này · Liên quan: [06-quy-uoc-chung.md](06-quy-uoc-chung.md), [02-nang-cao/16-da-nguoi-dung-shared-mailbox.md](../02-nang-cao/16-da-nguoi-dung-shared-mailbox.md)

## 1. Ba lớp kiểm soát

| Lớp | Câu hỏi | Nguồn |
|---|---|---|
| **Xác thực** | Ai đang gọi? | Session (cookie HttpOnly `ep_session`), API key (`Authorization: Bearer ep_…`), hoặc public |
| **Vai trò** | Người này là `admin` hay `user`? | `users.role` |
| **Quyền mailbox** | Người này được làm gì với mailbox X? | owner / `mailbox_access` |

**Quy tắc**: ba lớp **độc lập**. Vai trò `admin` **không** cấp quyền đọc hay ghi thư trong mailbox của người khác; admin chỉ truy cập được mailbox mình sở hữu hoặc được chia sẻ qua `mailbox_access`, như mọi user.

## 2. Xác thực

### 2.1 Session
- Token phiên (`sess_…`) **chỉ** được mang bằng cookie `ep_session` (`HttpOnly; SameSite=Lax; Path=/; Secure` khi production). Header `Authorization` không bao giờ được hiểu là session; `Authorization: Bearer` dành riêng cho API key.
- Tra `sessions` theo `SHA-256(token)` với `expires_at > now`, lấy user.
- User `disabled = true` → coi như chưa đăng nhập.
- Thiếu/sai/hết hạn → **401** `{"error":"Unauthorized"}`.

### 2.2 Chống CSRF
Với request dùng cookie session và method ghi (`POST`, `PUT`, `PATCH`, `DELETE`):
- Header `Origin` phải có và bằng origin của `APP_URL` (hoặc origin của chính request khi không cấu hình `APP_URL`).
- Thiếu hoặc lệch → **403** `{"error":"Invalid origin","code":"CSRF_ORIGIN_MISMATCH"}`, không thực hiện thao tác. Quy tắc đầy đủ (phạm vi áp dụng, miễn trừ, WebSocket): [01-co-ban/02-dang-nhap-phien.md §4.8](../01-co-ban/02-dang-nhap-phien.md).
- Request xác thực bằng API key (Bearer) và các endpoint public có chữ ký (inbound webhook HMAC) không áp dụng kiểm tra này.

### 2.3 API key
- Header `Authorization: Bearer <key>`; `prefix = 12 ký tự đầu của key`, lấy các dòng `api_keys` cùng `prefix`, tính `SHA-256(key)` và **so sánh thời gian hằng** với `key_hash` từng dòng.
- User của key phải tồn tại và không disabled.
- `lastUsedAt` cập nhật khi null hoặc cũ hơn 60 s.
- Key không bắt đầu `ep_` / không tồn tại / sai / hết hạn (`expires_at ≤ now`) / user disabled → **401** `{"error":"Unauthorized"}`.
- Key hợp lệ nhưng thiếu scope (`!(scopes.includes(required) || scopes.includes("*"))`) → **403** `{"error":"Missing required scope: <scope>","code":"INSUFFICIENT_SCOPE"}`. Chi tiết: [02-nang-cao/13-api-key-va-rest-v1.md](../02-nang-cao/13-api-key-va-rest-v1.md).
- JMAP còn chấp nhận `Authorization: Basic base64(user:key)` — username bị bỏ qua, quy tắc 401/403 như trên.

### 2.4 Public
Chỉ: setup status/prepare/domain/mx, register (khi chưa có admin), login, MFA verify, password reset request/confirm, inbound webhook (có HMAC), trang tĩnh.

## 3. Vai trò

| Khả năng | `admin` | `user` | Ghi chú |
|---|---|---|---|
| Thêm/xoá domain của mình | ✔ | ✘ (403) | |
| Rule cấp domain | ✔ (domain mình sở hữu) | chỉ khi `full_access` một mailbox của domain | |
| Tạo tài khoản, sửa tài khoản | ✔ (khi entitlement `multiUser` bật) | ✘ | chỉ tài khoản mình tạo |
| Tạo shared mailbox, cấp quyền | ✔ (khi entitlement `multiUser` bật) | ✘ | |
| Tạo mailbox cho tài khoản khác | ✔ (tài khoản mình tạo) | ✘ | |
| Tạo mailbox trên domain của admin | — | ✔ nếu `canManageMailboxes` | |
| Xoá mailbox | owner, hoặc admin tạo ra owner | owner **và** `canManageMailboxes` | |
| Backup, license, branding, migration, search index | ✔ | ✘ | |

Thiếu vai trò hoặc entitlement cần thiết → **403** (xem thông điệp ở từng file chức năng). Entitlement là cờ cấu hình, mô tả ở [03-tuy-chon/01-license-branding.md](../03-tuy-chon/01-license-branding.md).

### 3.1 "Chủ domain hiệu lực" của một user
```
CHU_DOMAIN_HIEU_LUC(user) = (user.canManageMailboxes && user.createdByUserId) ? user.createdByUserId : user.id
```
Dùng khi liệt kê domain và khi chọn domain để tạo mailbox/alias.

## 4. Quyền trên mailbox

### 4.1 Thủ tục `QUYEN_MAILBOX(user, mailboxId)`
Trả mức quyền của `user` trên mailbox, hoặc `null` nếu không có quyền.
```
mailbox = SELECT * FROM mailboxes WHERE id = ?
if !mailbox || mailbox.disabled            → null
if mailbox.user_id == user.id              → full_access (isOwner = true)
if mailbox.type != "shared"                → null
if !entitlement(mailboxSharing)            → null
row = SELECT permission FROM mailbox_access WHERE mailbox_id=? AND user_id=?
row ? permission : null
```
Tính năng chia sẻ mailbox bật/tắt bằng cấu hình (entitlement `mailboxSharing`). Khi tắt, mọi quyền được chia sẻ mất hiệu lực ngay; dòng `mailbox_access` vẫn giữ và có hiệu lực lại khi bật.

### 4.2 Thứ bậc & cờ
```
read_only (1) < send_on_behalf (2) < send_as (3) < full_access (4)
```
| Cờ | Điều kiện | Được làm |
|---|---|---|
| `canRead` | ≥ 1 | xem danh sách/đếm/chi tiết/hội thoại, tải attachment, xem nguồn, đánh dấu đọc/chưa đọc, **gắn sao**, xem folder, xem liên hệ, tạo nháp forward từ thư này |
| `canSendOnBehalf` | ≥ 2 | tạo/sửa nháp, gửi thư. From = `"<Tên actor> on behalf of <Tên mailbox>" <addr>` |
| `canSendAs` | ≥ 3 | gửi với From = `"<Tên mailbox>" <addr>` |
| `canManage` | = 4 | đổi status (archive/trash/spam/inbox/folder), xoá vĩnh viễn, snooze, tạo folder, rule mailbox, alias, sửa mailbox, sửa tên liên hệ, chặn người gửi, huấn luyện spam, xem rule |

### 4.3 Thủ tục `DS_MAILBOX_TRUY_CAP(user)`
Danh sách mailbox user truy cập được =
- mailbox `user_id = user.id AND disabled = false` → `permission = full_access`, `isPrimary = (localPart@hostname == user.email)`;
- ∪ (nếu entitlement `mailboxSharing` bật) mailbox `type = shared AND disabled = false` có dòng `mailbox_access(user)` → permission theo dòng, `isPrimary = false`.

Mỗi phần tử gồm: `id, userId, domainId, localPart, displayName, signature, autoReply*, useAllDomains, hasAvatar, type, disabled, createdAt, hostname, permission, isPrimary`.

## 5. Mẫu kiểm tra bắt buộc

### 5.1 Danh sách thư
Truy vấn thư luôn lọc theo **id mailbox truy cập được**, không lọc theo `user_id`:
```
if query.mailboxId:  require QUYEN_MAILBOX(user, mailboxId) có canRead, else 404 "Mailbox not found"; WHERE mailbox_id = ?
elif accessibleIds non-empty: WHERE mailbox_id IN (accessibleIds)
else: WHERE user_id = user.id
```

### 5.2 Một thư
```
msg = SELECT mailbox_id, … WHERE id = ?
if !msg || !msg.mailbox_id → 404
access = QUYEN_MAILBOX(user, msg.mailbox_id)
if !access?.<cờ cần> → 404            // không tiết lộ thư tồn tại
```
Ngoại lệ: attachment của thư không có mailbox → chỉ `msg.user_id == user.id` mới xem được.

**Quy tắc**: thiếu quyền mailbox luôn trả **404**, không phải 403, để không tiết lộ sự tồn tại của thư hay mailbox.

### 5.3 Nháp
Nháp dùng **quyền sở hữu trực tiếp**: `draft.user_id == user.id AND draft.status == 'draft'` (không qua mailbox access).

## 6. Tiêu chí chấp nhận
- [ ] User A không thể đọc/đổi trạng thái thư trong mailbox của B dù A là admin (khi chưa được chia sẻ) → 404.
- [ ] User có `read_only` trên shared mailbox: đọc, gắn sao, đánh dấu đọc được; archive/trash → không đổi (bulk trả 404 nếu không có thư hợp lệ).
- [ ] User `send_on_behalf` gửi thư: header From hiển thị "X on behalf of Y".
- [ ] Mailbox bị `disabled`: không ai (kể cả owner) truy cập được; không nhận thư.
- [ ] User bị disabled: mọi session và API key bị từ chối ngay (không cần xoá session).
- [ ] Tắt entitlement `mailboxSharing`: mọi quyền được chia sẻ biến mất, owner không bị ảnh hưởng.
- [ ] Gửi `Authorization: Bearer sess_…` thay cho cookie → 401.
- [ ] Request ghi bằng cookie với `Origin` lạ → 403, dữ liệu không đổi.
- [ ] API key sai → 401; API key đúng nhưng thiếu scope → 403 `INSUFFICIENT_SCOPE`.
- [ ] User thường gọi thêm domain → 403.
