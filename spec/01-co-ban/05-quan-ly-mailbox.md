# Quản lý mailbox

> **[CƠ BẢN]** (tạo, liệt kê, sửa tên/chữ ký, xoá) · **[NÂNG CAO]** alias & useAllDomains → [02-nang-cao/09](../02-nang-cao/09-alias-va-use-all-domains.md), auto-reply → [02-nang-cao/07](../02-nang-cao/07-tra-loi-tu-dong.md), shared → [02-nang-cao/16](../02-nang-cao/16-da-nguoi-dung-shared-mailbox.md)
> Phụ thuộc: [04-quan-ly-domain.md](04-quan-ly-domain.md), [00-nen-tang/05-phan-quyen.md](../00-nen-tang/05-phan-quyen.md) · Liên quan: [03-ho-so-mat-khau.md](03-ho-so-mat-khau.md), [06-nhan-thu.md](06-nhan-thu.md)

## 1. Mục tiêu
Tạo các địa chỉ nhận/gửi thư trên domain đã kết nối, gắn owner, giữ Email Routing trên Cloudflare đồng bộ, và xoá sạch mailbox (kể cả thư) khi không cần nữa.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| CRUD mailbox personal (và shared khi có tính năng chia sẻ) | Cấp quyền mailbox (`02-nang-cao/16`) |
| Tên hiển thị, chữ ký, tạm khoá (disable) | Alias, useAllDomains chi tiết (`02-nang-cao/09`) |
| Primary mailbox & đồng bộ danh tính | Avatar (`02-nang-cao/19`) |
| Tạo/xoá Email Routing rule theo địa chỉ | Auto-reply (`02-nang-cao/07`) |
| Xoá vĩnh viễn thư của mailbox khi xoá mailbox | |

## 3. Khái niệm then chốt

### 3.1 Primary mailbox
Mailbox `type = personal` có `localPart@hostname == user.email` (user = owner). Mailbox này **đại diện cho danh tính tài khoản**; tên/avatar của nó **là** của user:
- hiển thị: dùng `user.name`, `user.avatarKey`;
- sửa `displayName` của nó = sửa tên user, qua thủ tục `DONG_BO_DANH_TINH` ([03-ho-so-mat-khau.md §3](03-ho-so-mat-khau.md)).

### 3.2 Địa chỉ hợp lệ — thủ tục `DIA_CHI_HOP_LE(mailbox)`
`CHUAN_HOA_LOCAL(lp)` = quy tắc chuẩn hoá local-part định nghĩa ở [06-nhan-thu.md §4.1](06-nhan-thu.md) (mặc định: bỏ `+tag`, bỏ dấu `.`, lowercase).
```
primary = lower(`${localPart}@${domain.hostname}`)
aliases = mọi alias của mailbox (localPart@hostname của alias)
if !useAllDomains: return unique([primary, ...aliases])
owner   = domain.user_id
others  = domains WHERE user_id = owner AND status = 'active' AND id != mailbox.domainId
taken   = domainIds nơi CÓ mailbox khác hoặc alias của mailbox khác với CHUAN_HOA_LOCAL(localPart) giống
return unique([primary, ...others.filter(d ∉ taken).map(d => `${localPart}@${d.hostname}`), ...aliases])
```
Dùng cho: (1) phân giải thư đến, (2) danh sách địa chỉ được phép làm From khi gửi (`senderAddresses`), (3) tạo/xoá rule Cloudflare, (4) đồng bộ danh bạ của chính user.

### 3.3 Đồng bộ routing
- Thủ tục `DONG_BO_ROUTING(mailbox)`: với mỗi địa chỉ trong `DIA_CHI_HOP_LE(mailbox)`, tìm domain theo hostname (trong các domain của cùng owner) → tạo (nếu chưa có) rule Email Routing literal `to = address` → `{EMAIL_WORKER_NAME}` trên zone của domain ([00-nen-tang/07 §4](../00-nen-tang/07-cloudflare-api.md)). Chạy song song. Domain `zone_id = "manual"` bỏ qua.
- Thủ tục `GO_ROUTING(mailbox, addresses = DIA_CHI_HOP_LE(mailbox))`: tương tự nhưng xoá rule của các địa chỉ được truyền.

### 3.4 Kiểm tra trùng địa chỉ
Hai địa chỉ trên cùng domain được coi là **trùng** khi `CHUAN_HOA_LOCAL` của hai local-part bằng nhau (vì chúng nhận chung thư — `john.doe` và `johndoe` là một). Áp cho: tạo mailbox, tạo alias (`02-nang-cao/09`), đổi domain của mailbox.

## 4. API

### 4.1 `POST /api/mailboxes` — tạo
Body:
| Trường | Quy tắc |
|---|---|
| `domainId` | bắt buộc |
| `localPart` | 1–64, `[a-zA-Z0-9._%+-]` (lưu lowercase + trim) |
| `displayName` | tuỳ chọn |
| `type` | `personal` (mặc định) \| `shared` |
| `ownerUserId` | tuỳ chọn |

```
if type == shared: require user.role == admin && tính năng chia sẻ mailbox được bật (03-tuy-chon/01)
                   → 403 {error:"This feature is not enabled on this installation.", code:"FEATURE_DISABLED"} (entitlement `multiUser`, [03-tuy-chon/01](../03-tuy-chon/01-license-branding.md))
owner = type == shared ? user.id : (ownerUserId ?? user.id)
if owner != user.id:
    require user.role == admin → 403 "Forbidden"
    require users WHERE id = owner AND created_by_user_id = user.id → 404 "Account not found"
domain = domains WHERE id = domainId
canUseDomain = domain.user_id == user.id
            || (user.canManageMailboxes && user.createdByUserId && domain.user_id == user.createdByUserId)
!canUseDomain → 404 "Domain not found"
key = CHUAN_HOA_LOCAL(localPart)
có mailbox trên domain với CHUAN_HOA_LOCAL(local_part) == key → 409 "Mailbox already exists"
có alias trên domain với CHUAN_HOA_LOCAL(local_part) == key   → 409 "An alias already uses this address"
INSERT mailboxes { id: mbx_…, userId: owner, domainId, localPart, displayName, type }
try DONG_BO_ROUTING({id, domainId, localPart, useAllDomains: true})
catch → DELETE mailbox; 502 {error}
→ { id, address: `${localPart}@${hostname}`, type }
```

### 4.2 `GET /api/mailboxes` — liệt kê
1. Thủ tục `DAM_BAO_MAILBOX_CA_NHAN(user)`: nếu user chưa có mailbox personal nào mà `user.email` thuộc một domain có trong hệ thống và địa chỉ chưa bị chiếm (theo §3.4) → tạo rule routing literal cho `user.email` (lỗi bỏ qua), INSERT mailbox (`displayName = user.name || localPart`; lỗi → trả danh sách hiện có), `DONG_BO_ROUTING` (lỗi bỏ qua).
2. Trả các mailbox mà user có quyền truy cập ([00-nen-tang/05](../00-nen-tang/05-phan-quyen.md)):
```json
{ "mailboxes": [ { ...accessibleMailbox,
                   "displayName": "<tên user nếu primary>", "hasAvatar": true,
                   "senderAddresses": ["a@x.com","a@y.com","alias@x.com"] } ],
  "canCreateShared": true }
```

### 4.3 `GET /api/mailboxes/{id}` (canRead)
`{mailbox: {id, userId, domainId, localPart, displayName, signature, autoReplyEnabled, autoReplySubject, autoReplyBody, useAllDomains, type, disabled, createdAt, hostname, hasAvatar, permission, isPrimary}}`. Không có quyền → 404 "Mailbox not found".

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
| `disabled` | bool — **[NÂNG CAO]**; cần quyền như xoá (§4.5) |

Quy tắc:
- Primary mailbox + có `displayName` → tên rỗng: 400 "A valid account name is required"; ngược lại gọi `DONG_BO_DANH_TINH(owner, name)` và **không** ghi `displayName` vào mailbox trực tiếp.
- `useAllDomains` false → true: cập nhật cột rồi `DONG_BO_ROUTING`; lỗi → hoàn lại cột, 502 "Failed to configure inbound routing for all domains. Please try saving again."
- `useAllDomains` true → false:
  ```
  before = DIA_CHI_HOP_LE(mailbox với useAllDomains = true)
  after  = DIA_CHI_HOP_LE(mailbox với useAllDomains = false)
  GO_ROUTING(mailbox, before − after)     // rule của các domain phụ
  lỗi → 502 "Failed to remove inbound routing for other domains. Please try saving again." (cột giữ nguyên)
  UPDATE mailboxes SET use_all_domains = false
  ```
- `disabled: true` → mailbox không còn được phân giải khi nhận thư (thư tới bị từ chối "Unknown recipient", hoặc rơi vào rule catch-all của domain nếu có — [06-nhan-thu.md §4](06-nhan-thu.md)), không dùng làm From được; thư cũ vẫn đọc được. Rule Cloudflare giữ nguyên để bật lại tức thì.
- Trả mailbox sau cập nhật (như GET).

### 4.5 `DELETE /api/mailboxes/{id}[?confirm=true]` — xoá vĩnh viễn
Xoá mailbox **xoá vĩnh viễn toàn bộ thư của nó** (inbound, sent, draft, mọi trạng thái) cùng mọi object R2 liên quan. Không có thư mồ côi.

```
mailbox = mailboxes WHERE id                                  → 404 "Mailbox not found"
owner   = users WHERE id = mailbox.user_id
allowed = (mailbox.user_id == user.id && user.canManageMailboxes)
if !allowed && user.role == admin:
    allowed = mailbox.user_id == user.id || owner.created_by_user_id == user.id
!allowed → 403 "Forbidden"

n = COUNT(messages WHERE mailbox_id = mailbox.id)
if n > 0 && query.confirm != "true"
    → 409 {error:"This mailbox contains messages. Deleting it permanently deletes them.",
           code:"MAILBOX_NOT_EMPTY", messageCount: n}

try GO_ROUTING(mailbox) catch → 502 {error} (không xoá gì)

keys = messages.raw_r2_key (mọi thư của mailbox, khác null)
     ∪ message_attachments.r2_key (của các thư đó)
     ∪ mailboxes.avatar_key (nếu có)
DB, trong một batch nguyên tử:
    UPDATE outbound_jobs SET status='failed', error='Mailbox deleted'
           WHERE status='queued' AND message_id IN (thư của mailbox)
    DELETE messages WHERE mailbox_id = mailbox.id        // message_attachments cascade; FTS dọn bằng trigger
    DELETE mailboxes WHERE id = mailbox.id               // cascade folders, aliases, access, rule mailbox…
R2: xoá keys theo lô ≤ 1000 key/lần; lỗi → log (object không còn tham chiếu nào)
audit mailbox.delete {mailboxId, address, messageCount: n}
→ { ok: true, deletedMessages: n }
```
- Mailbox không có thư: xoá ngay, không cần `confirm`.
- UI luôn hiển thị hộp xác nhận nêu số thư sẽ bị xoá trước khi gửi `confirm=true`.
- Xoá primary mailbox là được phép; lần `GET /api/mailboxes` sau có thể tạo lại mailbox rỗng qua `DAM_BAO_MAILBOX_CA_NHAN`.

## 5. Chữ ký
- Lưu text thuần. Composer chèn khối `<div data-app-signature="1"><br><br>…</div>` (text → HTML, escape, xuống dòng → `<br>`).
- Đổi mailbox trong composer: thay khối chữ ký cũ bằng khối mới; nếu không có khối cũ thì nối vào cuối; nội dung chỉ gồm chữ ký được coi là "trống" (không autosave).

## 6. Lỗi & biên
| Tình huống | Kết quả |
|---|---|
| Tạo `john.doe` khi đã có `johndoe` trên cùng domain | 409 "Mailbox already exists" |
| Tạo `sales` khi alias `s.ales` đã có | 409 "An alias already uses this address" |
| Cloudflare lỗi khi tạo | 502, không còn dòng mailbox |
| Xoá mailbox có thư, không `confirm` | 409 `MAILBOX_NOT_EMPTY` |
| Cloudflare lỗi khi xoá | 502, mailbox và thư còn nguyên |
| R2 lỗi khi xoá object | Mailbox và thư đã xoá khỏi DB; lỗi được log |

## 7. Tiêu chí chấp nhận
- [ ] Tạo `sales@example.com` → mailbox tồn tại, Cloudflare có rule literal `to = sales@example.com` → Worker.
- [ ] Tạo trùng (kể cả khác dấu chấm / `+tag`) → 409; trùng alias → 409.
- [ ] User thường tạo mailbox cho người khác → 403.
- [ ] Đổi `displayName` primary mailbox → `users.name` đổi theo.
- [ ] Tắt `useAllDomains` → rule Cloudflare cho `local@domain-phụ` bị xoá, rule của domain chính còn.
- [ ] Xoá mailbox → rule Cloudflare cho mọi địa chỉ hợp lệ bị xoá.
- [ ] Xoá mailbox có thư với `confirm=true` → không còn dòng `messages`/`message_attachments` của mailbox, object raw và attachment trên R2 bị xoá.
- [ ] `GET /api/mailboxes` lần đầu sau khi admin tạo tài khoản (không mailbox) → tự tạo primary mailbox.

## 8. Ghi chú triển khai
- Zone đã có catch-all → Worker nên thư tới Worker kể cả khi thiếu rule theo địa chỉ. Rule theo địa chỉ giúp quản trị trên dashboard Cloudflare và giữ đúng khi catch-all bị đổi; địa chỉ không hợp lệ luôn bị Worker từ chối.
- Mailbox rất nhiều thư: thay batch nguyên tử bằng xoá theo lô (vd 500 thư/lô) và đẩy việc xoá R2 sang queue để tránh giới hạn subrequest của một request; khi đó đặt `disabled = true` trước để mailbox ngừng nhận thư trong lúc xoá, và chỉ xoá dòng `mailboxes` sau lô cuối.
