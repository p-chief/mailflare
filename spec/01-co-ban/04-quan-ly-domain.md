# Quản lý domain

> **[CƠ BẢN]** (thêm, xem, xoá, rollback) · **[NÂNG CAO]** kiểm tra/sửa DNS → [02-nang-cao/17-kiem-tra-dns.md](../02-nang-cao/17-kiem-tra-dns.md)
> Phụ thuộc: [00-nen-tang/07-cloudflare-api.md](../00-nen-tang/07-cloudflare-api.md)

## 1. Mục tiêu
Kết nối một hostname (apex hoặc subdomain) trên zone Cloudflare để **nhận** (Email Routing → Worker) và **gửi** (sending subdomain), với khả năng hoàn tác chính xác khi lỗi, và gỡ sạch khi xoá.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Provision Email Routing, catch-all → Worker, sending subdomain | Chuyển DNS domain sang Cloudflare |
| Thay MX cũ theo yêu cầu | Xác minh destination address cho forward |
| Rollback đúng những gì đã đổi | Quản lý bản ghi DNS khác (A, CNAME…) |
| Xem trạng thái DNS routing/sending | Kiểm tra DNS công khai & tự tạo SPF/DKIM/DMARC (NÂNG CAO) |
| Xoá domain + dọn Cloudflare | |

## 3. Tác nhân & quyền
- Người gọi phải đăng nhập. Domain thuộc `user_id` người gọi.
- Liệt kê: theo **chủ domain hiệu lực** (`canManageMailboxes && createdByUserId ? createdByUserId : id`).
- Get/DNS/Delete: chỉ khi `domain.user_id == user.id`.
- (Khuyến nghị) chỉ admin được thêm/xoá domain.

## 4. Dữ liệu
Bảng `domains`; ảnh hưởng dây chuyền: `mailboxes`, `mailbox_aliases`, `routing_rules` (cascade).

## 5. Luồng thêm domain — `POST /api/domains`
Body `{ hostname (≥3), enableRouting?: bool = true, enableSending?: bool = true, replaceMxRecords?: bool = false }`.

### 5.1 Provision trên Cloudflare (`provisionDomainOnCloudflare`)
```
host = lower(trim(hostname))
if !hasCloudflareCredentials → trả kết quả "manual" (zoneId "manual", routingEnabled=enableRouting??true,
                                sendingRequested=enableSending??true, sendingEnabled=false, routingStatus "manual")
zone = findZoneByHostname(host)  → không có: lỗi "Zone not found…"
changes = { zoneId, enabledEmailRouting:false, createdSendingSubdomainTag:null,
            previousCatchAll:null, createdAddressRules:[], deletedMxRecords:[] }
try:
  if enableRouting:
     routingWasEnabled = (GET email/routing).enabled === true   // đọc lỗi → giả định TRUE (an toàn)
     changes.previousCatchAll = routingWasEnabled ? GET catch_all : null
     routingName = (host == zone.name) ? undefined : host
     if replaceMxRecords: xoá mọi MX tại (routingName ?? zone.name) KHÔNG kết thúc ".mx.cloudflare.net",
                          push từng bản ghi vào changes.deletedMxRecords (thiếu id → lỗi)
     routing = POST email/routing/dns {name: routingName?}
     changes.enabledEmailRouting = !routingWasEnabled
     routingEnabled = routing.enabled ?? true; routingStatus = routing.status
     if !nodeRuntime: PUT catch_all → worker
  if enableSending:
     subs = GET sending/subdomains
     existing = subs.find(s => s.name == host)
     existing ? (tag, enabled = existing) : (created = POST {name: host}; changes.createdSendingSubdomainTag = created.tag)
catch e:
  rollbackDomainProvisioning(changes); throw e
return { hostname, zone, routingEnabled, sendingRequested: enableSending, sendingEnabled, sendingSubdomainTag, routingStatus, changes }
```

### 5.2 Ghi DB (`addDomainForUser`)
```
existing = domains WHERE hostname = host
if existing && existing.user_id != userId → lỗi "Domain is already registered"
values = { id: existing?.id ?? dom_…, userId, hostname, zoneId,
           status: (routingEnabled || sendingEnabled) ? "active" : "pending",
           routingStatus, sendingSubdomainTag, sendingRequested, sendingEnabled, routingEnabled }
existing ? UPDATE : INSERT (ghi nhớ insertedDomainId)
// mở rộng mailbox "useAllDomains" sang domain mới
for mailbox in mailboxes(of domains owned by userId) WHERE use_all_domains = true:
    ensureMailboxDomainRouting(mailbox)      // lỗi từng cái chỉ log (allSettled)
catch: rollback zone; nếu vừa INSERT thì DELETE dòng; throw
dns = getDomainDns(domain)   // NGOÀI vùng rollback; lỗi → view rỗng với trạng thái từ provision
return { domain, dns, changes }
```
Thêm lại cùng hostname của chính mình = cập nhật (idempotent).

### 5.3 Mã lỗi
| Nguyên nhân | HTTP | Body |
|---|---|---|
| Validate | 400 | `{error: flatten}` |
| Cloudflare code **2008** (MX của nhà cung cấp khác) | **409** | `{error:"Existing MX records currently deliver mail to another provider. Continue to delete them and replace them with Cloudflare Email Routing.", code:"MX_RECORDS_CONFLICT"}` |
| Lỗi khác | 400 | `{error: message}` |

UI khi nhận `MX_RECORDS_CONFLICT`: hỏi xác nhận rồi gọi lại với `replaceMxRecords: true`.

## 6. Rollback (`rollbackDomainProvisioning(changes)`)
Nguyên tắc: **chỉ hoàn tác những gì lần này làm**; thứ tái sử dụng (subdomain có sẵn, routing đã bật) giữ nguyên. Mỗi bước bọc try/catch, **chỉ log**, không ném (tránh che lỗi gốc).
1. Xoá rule theo địa chỉ trong `createdAddressRules`.
2. Nếu `createdSendingSubdomainTag` → xoá sending subdomain.
3. Nếu `previousCatchAll` **hoặc** `enabledEmailRouting` → khôi phục catch-all (bản cũ, hoặc mặc định drop/disabled). *Phải làm trước khi tắt routing* vì Cloudflare giữ cấu hình khi tắt; để catch-all → Worker lại sẽ "hồi sinh" khi ai đó bật routing sau này.
4. Nếu `enabledEmailRouting` → tắt Email Routing.
5. Nếu có `deletedMxRecords` → tạo lại từng MX (`type, name, content, priority, ttl ?? 1, proxied?, comment?, tags?`).

## 7. Xem DNS — `GET /api/domains/{id}/dns`
```
if zoneId == "manual" → view "manual" (xem 03-tuy-chon/08)
[routingDns, routingSettings, subs] = parallel(
    GET email/routing/dns, GET email/routing, GET sending/subdomains (lỗi → []))
sub = findSendingSubdomain(hostname, subs)
sending = sub?.tag ? GET subdomains/{tag}/dns (lỗi → []) : []
view = { routing: {records, missing, status}, sending, sendingEnabled: sub?.enabled ?? false,
         dkimSelector: sub?.dkim_selector, sendingSubdomain: sub ? {name, tag} : undefined }
+ audit DNS công khai (NÂNG CAO) → view.audit
```
Trả `{ domain: {...domain, sendingEnabled: view.sendingEnabled}, dns: view }`. Lỗi → 500.

`sendingEnabled` đọc **trạng thái thật** trên zone vì cột DB có thể lỗi thời (bật ngoài hệ thống, hoặc dòng ghi trước khi subdomain tồn tại). Thiếu quyền Email Sending không được làm hỏng view.

## 8. Liệt kê — `GET /api/domains[?includeDns=true]`
- Không `includeDns`: `{domains}`.
- Có: với mỗi domain (song song, allSettled) tính tóm tắt:
```json
"dns": { "<domainId>": {
   "routing": { "configured": true, "missing": ["MX"] },
   "sending": { "configured": true, "records": ["TXT","CNAME"] },
   "auth": { "mx":"ok", "spf":"ok", "dkim":"missing", "dmarc":"unknown" } } }
```
`routing.configured = missing.length == 0 && (records.length > 0 || routingEnabled)`; `sending.configured = sendingEnabled ?? records.length > 0`. `domains[].sendingEnabled` được ghi đè bằng giá trị thật.

## 9. Preflight — `POST /api/domains/check` (session)
Body `{hostname}` → `{domain: {hostname, zone}}` hoặc 502 zone not found.

## 10. Lấy 1 domain — `GET /api/domains/{id}`
Chỉ chủ domain; 404 nếu không.

## 11. Xoá domain — `DELETE /api/domains/{id}`
```
domain = domains WHERE id AND user_id = user.id   → không có: 400 "Domain not found"
try deleteEmailRoutingRulesForDomain(zone, hostname)   // rule literal to == host hoặc *@host
if routingEnabled: try disableEmailRouting(zone)
if sendingSubdomainTag: try deleteSendingSubdomain(zone, tag)
DELETE domains WHERE id           // cascade: mailboxes, aliases, routing_rules
```
Mỗi bước Cloudflare lỗi chỉ log. Thư còn lại: `messages.mailbox_id` → NULL (thư mồ côi, R2 vẫn giữ) — xem [05-van-hanh/01](../05-van-hanh/01-bay-va-cai-thien.md).

Lưu ý: xoá domain **tắt Email Routing của cả zone** nếu `routingEnabled` — kể cả khi routing đã được bật trước khi thêm vào hệ thống. Nên chỉ tắt nếu hệ thống là bên bật (lưu cờ này lúc provision).

## 12. Tiêu chí chấp nhận
- [ ] Thêm `example.com` → Email Routing bật, MX Cloudflare có trong zone, catch-all → Worker, sending subdomain tồn tại, domain `active`.
- [ ] Thêm `mail.example.com` (zone `example.com`) → routing bật với `name: mail.example.com`.
- [ ] Zone có MX Google, không đồng ý thay → 409 `MX_RECORDS_CONFLICT`, zone không đổi.
- [ ] Đồng ý thay → MX Google bị xoá; nếu bước sau lỗi, MX Google được tạo lại.
- [ ] Hostname đã thuộc user khác → lỗi, zone được rollback.
- [ ] Mailbox `useAllDomains` có sẵn → sau khi thêm domain mới có rule routing cho `local@domain-mới`.
- [ ] Xoá domain → không còn rule Cloudflare nào trỏ `*@domain`, sending subdomain bị xoá.
