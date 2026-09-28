# Quản lý mailbox

> **[CƠ BẢN]** (tạo, liệt kê, sửa tên/chữ ký, xoá) · **[NÂNG CAO]** alias & useAllDomains → [02-nang-cao/09](../02-nang-cao/09-alias-va-use-all-domains.md), auto-reply → [02-nang-cao/07](../02-nang-cao/07-tra-loi-tu-dong.md), shared → [02-nang-cao/16](../02-nang-cao/16-da-nguoi-dung-shared-mailbox.md)
> Phụ thuộc: [04-quan-ly-domain.md](04-quan-ly-domain.md), [00-nen-tang/05-phan-quyen.md](../00-nen-tang/05-phan-quyen.md)

## 1. Mục tiêu
Tạo các địa chỉ nhận/gửi thư trên domain đã kết nối, gắn owner, và giữ Email Routing trên Cloudflare đồng bộ.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| CRUD mailbox personal (và shared khi có tính năng chia sẻ) | Cấp quyền mailbox (`02-nang-cao/16`) |
| Tên hiển thị, chữ ký | Alias, useAllDomains chi tiết (`02-nang-cao/09`) |
| Primary mailbox & đồng bộ danh tính | Avatar (`02-nang-cao/19`) |
| Tạo/xoá Email Routing rule theo địa chỉ | Auto-reply (`02-nang-cao/07`) |

## 3. Khái niệm then chốt

### 3.1 Primary mailbox
Mailbox `personal` có `localPart@hostname == user.email`. `tracksAccountIdentity(mailbox, email)` = `type == personal && isPrimary`. Tên/avatar của nó **là** của user:
- hiển thị: dùng `user.name`, `user.avatarKey`;
- sửa `displayName` của nó = sửa tên user (`syncPersonalIdentity`).

### 3.2 Địa chỉ hợp lệ (`getMailboxDomainAddresses(mailbox)`)
```
primary = `${localPart}@${domain.hostname}`.lower
aliases = mọi alias của mailbox (localPart@hostname của alias)
if !useAllDomains: return unique([primary, ...aliases])
owner   = domain.user_id
others  = domains WHERE user_id = owner AND status = 'active' AND id != mailbox.domainId
taken   = domainIds nơi CÓ mailbox khác hoặc alias của mailbox khác với normalize(localPart) giống
return unique([primary, ...others.filter(d ∉ taken).map(d => `${localPart}@${d.hostname}`), ...aliases])
```
Dùng cho: (1) phân giải thư đến, (2) kiểm tra From khi gửi (`senderAddresses`), (3) tạo/xoá rule Cloudflare.

### 3.3 Đồng bộ routing
- `ensureMailboxDomainRouting(mailbox)`: với mỗi địa chỉ hợp lệ, tìm domain theo hostname (trong domain của cùng owner) → `ensureEmailRoutingRuleToWorker(zone, address)` (song song).
- `removeMailboxDomainRouting(mailbox)`: tương tự nhưng xoá rule.

> Zone đã có catch-all → Worker nên thư tới Worker kể cả khi thiếu rule theo địa chỉ. Rule theo địa chỉ giúp quản trị trên dashboard Cloudflare và giữ đúng khi catch-all bị đổi. Có thể đơn giản hoá: chỉ catch-all + reject địa chỉ lạ trong `email()`.

## 4. API

### 4.1 `POST /api/mailboxes` — tạo
Body:
| Trường | Quy tắc |
|---|---|
| `domainId` | bắt buộc |
| `localPart` | 1–64 (lưu lowercase) |
| `displayName` | tuỳ chọn |
| `type` | `personal` (mặc định) \| `shared` |
| `ownerUserId` | tuỳ chọn |

```
if type == shared: require user.role == admin && sharingEnabled → 403 "A Team license is required to create shared inboxes"
owner = type == shared ? user.id : (ownerUserId ?? user.id)
if owner != user.id:
    require user.role == admin → 403 "Forbidden"
    require users WHERE id = owner AND created_by_user_id = user.id → 404 "Account not found"
domain = domains WHERE id = domainId
canUseDomain = domain.user_id == user.id
            || (user.canManageMailboxes && user.createdByUserId && domain.user_id == user.createdByUserId)
!canUseDomain → 404 "Domain not found"
mailbox (domain, localPart) tồn tại → 409 "Mailbox already exists"
alias (domain, localPart) tồn tại   → 409 "An alias already uses this address"
INSERT mailboxes { id: mbx_…, userId: owner, domainId, localPart, displayName, type }
try ensureMailboxDomainRouting({id, domainId, localPart, useAllDomains: true})
catch → DELETE mailbox; 502 {error}
→ { id, address: `${localPart}@${hostname}`, type }
```

### 4.2 `GET /api/mailboxes` — liệt kê
1. `ensurePersonalMailbox(user)`: nếu user chưa có mailbox personal nào mà `user.email` thuộc domain có trong hệ thống và địa chỉ chưa bị chiếm → tạo rule routing (lỗi bỏ qua), INSERT mailbox (`displayName = user.name || localPart`; lỗi → trả danh sách cũ), `ensureMailboxDomainRouting` (lỗi bỏ qua).
2. Trả:
```json
{ "mailboxes": [ { ...accessibleMailbox,
                   "displayName": "<tên user nếu primary>", "hasAvatar": true,
                   "senderAddresses": ["a@x.com","a@y.com","alias@x.com"] } ],
  "canCreateShared": true }
```

### 4.3 `GET /api/mailboxes/{id}` (canRead)
`{mailbox: {id, userId, domainId, localPart, displayName, signature, autoReplyEnabled, autoReplySubject, autoReplyBody, useAllDomains, type, disabled, createdAt, hostname, hasAvatar, permission, isPrimary}}`.

### 4.4 `PATCH /api/mailboxes/{id}` (canManage)
Body (mọi trường tuỳ chọn):
| Trường | Quy tắc lưu |
|---|---|
| `displayName` | ≤100 hoặc null; trim; rỗng → null |
| `signature` | ≤10 000 hoặc null; trim; rỗng → null |
| `autoReplyEnabled` | bool |
| `autoReplySubject` | ≤200; trim; rỗng → "Out of office" |
| `autoReplyBody` | ≤10 000; trim; rỗng → "" |
| `useAllDomains` | bool |

Quy tắc:
- Primary mailbox + có `displayName` → tên rỗng: 400 "A valid account name is required"; ngược lại `syncPersonalIdentity(owner, name)` và **không** ghi `displayName` vào mailbox trực tiếp.
- `useAllDomains: true` → `ensureMailboxDomainRouting` trước; lỗi → 502 "Failed to configure inbound routing for all domains. Please try saving again."
- (Tắt `useAllDomains` hiện **không** xoá rule Cloudflare của các domain khác — nên bổ sung.)
- Trả mailbox sau cập nhật (như GET).

### 4.5 `DELETE /api/mailboxes/{id}`
```
allowed = (mailbox.user_id == user.id && user.canManageMailboxes)
if !allowed && user.role == admin:
    allowed = mailbox.user_id == user.id || owner.created_by_user_id == user.id
!allowed → 403 "Forbidden"
try removeMailboxDomainRouting(mailbox) catch → 502 (không xoá)
DELETE mailboxes WHERE id    // cascade folders, aliases, access, rules(mailbox_id set null)…
```
Thư của mailbox: `mailbox_id → NULL` (mồ côi). Lưu ý: admin **không** tự có quyền xoá primary mailbox của chính mình trừ khi… thực tế admin là owner → được phép.

## 5. Chữ ký
- Lưu text thuần. Composer chèn khối `<div data-mailflare-signature="1"><br><br>…</div>` (text → HTML, escape, xuống dòng → `<br>`).
- Đổi mailbox trong composer: thay khối chữ ký cũ bằng khối mới; nếu không có khối cũ thì nối vào cuối; nội dung chỉ gồm chữ ký được coi là "trống" (không autosave).

## 6. Tiêu chí chấp nhận
- [ ] Tạo `sales@example.com` → mailbox tồn tại, Cloudflare có rule literal `to = sales@example.com` → Worker.
- [ ] Tạo trùng → 409; trùng alias → 409.
- [ ] User thường tạo mailbox cho người khác → 403.
- [ ] Đổi `displayName` primary mailbox → `users.name` đổi theo.
- [ ] Xoá mailbox → rule Cloudflare cho mọi địa chỉ hợp lệ bị xoá.
- [ ] `GET /api/mailboxes` lần đầu sau khi admin tạo tài khoản (không mailbox) → tự tạo primary mailbox.

## 7. Ghi chú khi xây dựng lại
- Kiểm tra trùng nên dùng `normalizeRecipientLocalPart` (vì `a.b` và `ab` nhận chung thư).
- Cân nhắc cho phép **disable** mailbox (cột có sẵn) thay vì xoá.
