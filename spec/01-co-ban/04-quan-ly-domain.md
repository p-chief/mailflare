# Quản lý domain

> **[CƠ BẢN]** (thêm, xem, xoá, rollback) · **[NÂNG CAO]** kiểm tra/sửa DNS → [02-nang-cao/17-kiem-tra-dns.md](../02-nang-cao/17-kiem-tra-dns.md)
> Phụ thuộc: [00-nen-tang/07-cloudflare-api.md](../00-nen-tang/07-cloudflare-api.md) · Liên quan: [05-quan-ly-mailbox.md](05-quan-ly-mailbox.md)

## 1. Mục tiêu
Kết nối một hostname (apex hoặc subdomain) trên zone Cloudflare để **nhận** (Email Routing → Worker) và **gửi** (sending subdomain), với khả năng hoàn tác chính xác khi lỗi, và gỡ sạch — chỉ những gì hệ thống đã bật — khi xoá.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Provision Email Routing, catch-all → Worker, sending subdomain | Chuyển DNS domain sang Cloudflare |
| Thay MX cũ theo yêu cầu | Xác minh destination address cho forward |
| Rollback đúng những gì đã đổi | Quản lý bản ghi DNS khác (A, CNAME…) |
| Xem trạng thái DNS routing/sending | Kiểm tra DNS công khai & tự tạo SPF/DKIM/DMARC (NÂNG CAO) |
| Xoá domain + dọn Cloudflare | Chế độ DNS thủ công khi không có credential ([03-tuy-chon/08](../03-tuy-chon/08-runtime-node-tu-host.md)) |

## 3. Tác nhân & quyền
- Người gọi phải đăng nhập.
- **Thêm** (`POST /api/domains`, `POST /api/domains/check`) và **xoá** domain: chỉ `role = admin`; khác → **403** "Forbidden". Domain mới thuộc `user_id` người gọi.
- Liệt kê: theo **chủ domain hiệu lực** = (`canManageMailboxes && createdByUserId`) ? `createdByUserId` : `user.id`.
- Get/DNS/Delete: chỉ khi `domain.user_id == user.id`; khác → 404 "Domain not found".

## 4. Dữ liệu
Bảng `domains`:
| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | text PK | `dom_…` |
| `user_id` | FK users CASCADE | chủ domain |
| `hostname` | text UNIQUE | lowercase |
| `zone_id` | text NOT NULL | id zone Cloudflare, hoặc `"manual"` |
| `status` | `pending`\|`active`\|`error`, mặc định `pending` | |
| `routing_status` | text null | trạng thái Email Routing (vd `ready`) hoặc `"manual"` |
| `sending_subdomain_tag` | text null | |
| `sending_requested` | bool false | người dùng muốn gửi |
| `sending_enabled` | bool false | subdomain đã bật (có thể lỗi thời — §7) |
| `routing_enabled` | bool false | Email Routing đang bật trên zone lúc provision |
| `routing_enabled_by_app` | bool false | **hệ thống** là bên bật Email Routing của zone khi provision domain này (trước đó zone chưa bật). Quyết định có tắt routing khi xoá domain hay không (§11) |
| `created_at` | ts | |

Cột `routing_enabled_by_app` phải có trong mô hình dữ liệu ([00-nen-tang/04-mo-hinh-du-lieu.md §2.3](../00-nen-tang/04-mo-hinh-du-lieu.md)) và được thêm bằng một migration SQL (`ALTER TABLE domains ADD COLUMN routing_enabled_by_app integer NOT NULL DEFAULT 0`).

Ảnh hưởng dây chuyền khi xoá dòng: `mailbox_aliases`, `routing_rules` (cascade). Không bao giờ xoá dòng domain khi còn mailbox (§11).

## 5. Luồng thêm domain — `POST /api/domains`
Body `{ hostname (≥3), enableRouting?: bool = true, enableSending?: bool = true, replaceMxRecords?: bool = false }`.

Thủ tục `THEM_DOMAIN(userId, hostname, opts)` = §5.1 rồi §5.2. Dùng cả ở đây và khi setup ([01-khoi-tao-he-thong.md](01-khoi-tao-he-thong.md)).

### 5.1 Provision trên Cloudflare — thủ tục `PROVISION_DOMAIN(hostname, opts)`
```
host = lower(trim(hostname))
if không có credential Cloudflare → trả kết quả "manual" (zoneId "manual", routingEnabled = enableRouting ?? true,
                                sendingRequested = enableSending ?? true, sendingEnabled = false,
                                routingStatus "manual", changes rỗng)
zone = tìm zone chứa host (00-nen-tang/07 §3)  → không có: lỗi "Zone not found…"
changes = { zoneId, enabledEmailRouting:false, createdSendingSubdomainTag:null,
            previousCatchAll:null, createdAddressRules:[], deletedMxRecords:[] }
try:
  if enableRouting:
     routingWasEnabled = (GET email/routing).enabled === true   // đọc lỗi → giả định TRUE (an toàn: không bao giờ tắt nhầm)
     changes.previousCatchAll = routingWasEnabled ? GET catch_all : null
     routingName = (host == zone.name) ? không truyền : host
     if replaceMxRecords: xoá mọi MX tại (routingName ?? zone.name) có nội dung KHÔNG kết thúc ".mx.cloudflare.net",
                          push từng bản ghi đầy đủ vào changes.deletedMxRecords (bản ghi thiếu id → lỗi)
     routing = POST email/routing/dns {name: routingName?}
     changes.enabledEmailRouting = !routingWasEnabled
     routingEnabled = routing.enabled ?? true; routingStatus = routing.status
     trừ khi chạy runtime tự host (không có Email Worker): PUT catch_all → {EMAIL_WORKER_NAME}
  if enableSending:
     subs = GET sending/subdomains
     existing = subs có name == host
     existing ? (tag, enabled lấy từ existing)
              : (created = POST {name: host}; changes.createdSendingSubdomainTag = created.tag)
catch e:
  ROLLBACK_PROVISION(changes); throw e
return { hostname, zone, routingEnabled, routingEnabledByApp: changes.enabledEmailRouting,
         sendingRequested: enableSending, sendingEnabled, sendingSubdomainTag, routingStatus, changes }
```

### 5.2 Ghi DB
```
existing = domains WHERE hostname = host
if existing && existing.user_id != userId → ROLLBACK_PROVISION(changes); lỗi "Domain is already registered"
values = { id: existing?.id ?? dom_…, userId, hostname, zoneId,
           status: (routingEnabled || sendingEnabled) ? "active" : "pending",
           routingStatus, sendingSubdomainTag, sendingRequested, sendingEnabled, routingEnabled,
           routingEnabledByApp: (existing?.routingEnabledByApp ?? false) || routingEnabledByApp }   // cột routing_enabled_by_app
existing ? UPDATE : INSERT (ghi nhớ id vừa INSERT)
// mở rộng mailbox "useAllDomains" sang domain mới
for mailbox in mailboxes (thuộc các domain của userId) WHERE use_all_domains = true:
    DONG_BO_ROUTING(mailbox)      // 05-quan-ly-mailbox §3.3; chạy song song, lỗi từng cái chỉ log
catch: ROLLBACK_PROVISION(changes); nếu vừa INSERT thì DELETE dòng đó; throw
dns = XEM_DNS(domain)   // NGOÀI vùng rollback; lỗi → view rỗng với trạng thái từ provision
return { domain, dns, changes }
```
- Thêm lại cùng hostname của chính mình = cập nhật (idempotent). `routing_enabled_by_app` chỉ có thể chuyển false → true khi cập nhật, không bao giờ bị hạ xuống (lần thêm lại thấy routing đã bật — do chính hệ thống bật lần trước).

### 5.3 Mã lỗi
| Nguyên nhân | HTTP | Body |
|---|---|---|
| Không phải admin | 403 | `{error:"Forbidden"}` |
| Validate | 400 | `{error: <lỗi theo trường>}` |
| Cloudflare code **2008** (MX của nhà cung cấp khác) | **409** | `{error:"Existing MX records currently deliver mail to another provider. Continue to delete them and replace them with Cloudflare Email Routing.", code:"MX_RECORDS_CONFLICT"}` |
| Không tìm thấy zone | 404 | `{error:"Zone not found for \"<host>\". The domain must use Cloudflare DNS on this account.", code:"ZONE_NOT_FOUND"}` |
| Hostname đã thuộc user khác | 409 | `{error:"Domain is already registered", code:"CONFLICT"}` |
| Lỗi Cloudflare API khác | 502 | `{error: <thông điệp Cloudflare đã định dạng>, code:"UPSTREAM_ERROR"}` |
| Lỗi không lường trước | 500 | `{error:"Internal Server Error"}` |

UI khi nhận `MX_RECORDS_CONFLICT`: hỏi xác nhận rồi gọi lại với `replaceMxRecords: true`.

## 6. Rollback — thủ tục `ROLLBACK_PROVISION(changes)`
Nguyên tắc: **chỉ hoàn tác những gì lần này làm**; thứ tái sử dụng (subdomain có sẵn, routing đã bật) giữ nguyên. Mỗi bước bọc try/catch, **chỉ log**, không ném (tránh che lỗi gốc).
1. Xoá rule theo địa chỉ trong `createdAddressRules`.
2. Nếu `createdSendingSubdomainTag` → xoá sending subdomain.
3. Nếu `previousCatchAll` **hoặc** `enabledEmailRouting` → khôi phục catch-all (bản cũ, hoặc mặc định drop/disabled). *Phải làm trước khi tắt routing* vì Cloudflare giữ cấu hình khi tắt; để catch-all → Worker lại sẽ "hồi sinh" khi ai đó bật routing sau này.
4. Nếu `enabledEmailRouting` → tắt Email Routing.
5. Nếu có `deletedMxRecords` → tạo lại từng MX (`type, name, content, priority, ttl ?? 1, proxied?, comment?, tags?`).

## 7. Xem DNS — thủ tục `XEM_DNS(domain)`, endpoint `GET /api/domains/{id}/dns`
```
if zoneId == "manual" → view "manual" (xem 03-tuy-chon/08)
[routingDns, routingSettings, subs] = song song(
    GET email/routing/dns, GET email/routing, GET sending/subdomains (lỗi → []))
sub = sending subdomain khớp hostname (00-nen-tang/07 §5)
sending = sub?.tag ? GET sending/subdomains/{tag}/dns (lỗi → []) : []
view = { routing: {records, missing, status}, sending, sendingEnabled: sub?.enabled ?? false,
         dkimSelector: sub?.dkim_selector, sendingSubdomain: sub ? {name, tag} : undefined }
+ audit DNS công khai (NÂNG CAO) → view.audit
```
Trả `{ domain: {...domain, sendingEnabled: view.sendingEnabled}, dns: view }`. Lỗi → 500.

`sendingEnabled` đọc **trạng thái thật** trên zone vì cột DB có thể lỗi thời (bật ngoài hệ thống, hoặc dòng ghi trước khi subdomain tồn tại). Thiếu quyền Email Sending không được làm hỏng view.

## 8. Liệt kê — `GET /api/domains[?includeDns=true]`
- Không `includeDns`: `{domains}`.
- Có: với mỗi domain (song song, lỗi từng domain không làm hỏng cả danh sách) tính tóm tắt:
```json
"dns": { "<domainId>": {
   "routing": { "configured": true, "missing": ["MX"] },
   "sending": { "configured": true, "records": ["TXT","CNAME"] },
   "auth": { "mx":"ok", "spf":"ok", "dkim":"missing", "dmarc":"unknown" } } }
```
`routing.configured = missing.length == 0 && (records.length > 0 || routingEnabled)`; `sending.configured = sendingEnabled ?? records.length > 0`. `domains[].sendingEnabled` được ghi đè bằng giá trị thật.

## 9. Preflight — `POST /api/domains/check` (admin)
Body `{hostname}` → `{domain: {hostname, zone}}` hoặc 404 `ZONE_NOT_FOUND` (thông điệp như §5.3)

## 10. Lấy 1 domain — `GET /api/domains/{id}`
Chỉ chủ domain; khác → 404 "Domain not found".

## 11. Xoá domain — `DELETE /api/domains/{id}` (admin)
Chính sách thư: **chặn xoá khi domain còn mailbox**. Người dùng phải xoá (hoặc chuyển) mailbox trước ([05-quan-ly-mailbox.md §4.5](05-quan-ly-mailbox.md) — xoá mailbox xoá vĩnh viễn thư của nó). Nhờ vậy không bao giờ có thư mồ côi (`mailbox_id` NULL).

```
domain = domains WHERE id AND user_id = user.id        → không có: 404 "Domain not found"
n = COUNT(mailboxes WHERE domain_id = domain.id)
if n > 0 → 409 {error:"Remove this domain's mailboxes before deleting it", code:"DOMAIN_HAS_MAILBOXES", mailboxCount: n}
if zone_id != "manual":
  try xoá mọi rule Email Routing của zone có matcher literal `to` == host hoặc kết thúc "@host"
  sameZone = domains WHERE zone_id = domain.zone_id AND id != domain.id    // domain khác của hệ thống trên cùng zone
  if domain.routing_enabled_by_app && sameZone rỗng:
      try đặt catch-all về mặc định (drop, disabled)       // trước khi tắt, cùng lý do như §6 bước 3
      try tắt Email Routing của zone
  if sending_subdomain_tag: try xoá sending subdomain
DELETE domains WHERE id           // cascade: mailbox_aliases (kể cả alias của mailbox thuộc domain khác), routing_rules
→ { ok: true }
```
- Mỗi bước Cloudflare lỗi chỉ log, không chặn xoá dòng DB.
- Email Routing của zone **chỉ** bị tắt khi hệ thống là bên bật nó (`routing_enabled_by_app`) **và** không còn domain nào khác của hệ thống dùng zone đó. Zone đã bật routing từ trước khi thêm vào hệ thống giữ nguyên trạng thái bật.
- Địa chỉ mở rộng của mailbox `useAllDomains` (thuộc domain khác) trên domain này biến mất cùng các rule theo địa chỉ ở bước đầu; thư tới các địa chỉ đó sau khi xoá bị từ chối "Unknown recipient" ([06-nhan-thu.md](06-nhan-thu.md)).

## 12. Tiêu chí chấp nhận
- [ ] Thêm `example.com` → Email Routing bật, MX Cloudflare có trong zone, catch-all → Worker, sending subdomain tồn tại, domain `active`.
- [ ] Thêm domain trên zone chưa bật routing → `routing_enabled_by_app = true`; zone đã bật từ trước → `false`.
- [ ] Thêm `mail.example.com` (zone `example.com`) → routing bật với `name: mail.example.com`.
- [ ] User không phải admin gọi thêm/xoá → 403.
- [ ] Zone có MX Google, không đồng ý thay → 409 `MX_RECORDS_CONFLICT`, zone không đổi.
- [ ] Đồng ý thay → MX Google bị xoá; nếu bước sau lỗi, MX Google được tạo lại.
- [ ] Hostname đã thuộc user khác → lỗi, zone được rollback.
- [ ] Mailbox `useAllDomains` có sẵn → sau khi thêm domain mới có rule routing cho `local@domain-mới`.
- [ ] Xoá domain còn mailbox → 409 `DOMAIN_HAS_MAILBOXES`, không đổi gì trên DB lẫn Cloudflare.
- [ ] Xoá domain không còn mailbox → không còn rule Cloudflare nào trỏ `*@domain`, sending subdomain bị xoá.
- [ ] Xoá domain có `routing_enabled_by_app = false` → Email Routing của zone vẫn bật.
- [ ] Xoá `mail.example.com` khi `example.com` vẫn còn trong hệ thống → Email Routing của zone vẫn bật.
