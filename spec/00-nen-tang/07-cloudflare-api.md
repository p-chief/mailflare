# Cloudflare REST API client

> Thuộc nhóm: Nền tảng · **[CƠ BẢN]** · Dùng bởi: domain, mailbox, alias, DNS, rollback.

## 1. Client
```
cfRequest<T>(env, path, init?) :
  fetch("https://api.cloudflare.com/client/v4" + path, {
     ...init, headers: { ...authHeaders, "Content-Type": "application/json", ...init.headers } })
  json = await res.json()   // { success, result, errors: [{code, message}] }
  if !json.success → throw CloudflareApiError(message, status, path, errors)
  return json.result
```
- **Auth**: nếu có `CF_API_KEY` + `CF_EMAIL` → headers `X-Auth-Email`, `X-Auth-Key`; else nếu có `CF_TOKEN` → `Authorization: Bearer <token>`; `CF_API_KEY` thiếu email → lỗi "CF_EMAIL is required…"; không có gì → lỗi "CF_TOKEN or CF_API_KEY is not configured".
- **Thông báo lỗi**: `Cloudflare API <status> on <path>: code <c>: <msg>; …`. Nếu có lỗi auth (code 10000, 9109, hoặc message chứa "auth"/"token") thêm gợi ý kiểm tra token bằng `GET /user/tokens/verify`.
- `isCloudflareApiErrorCode(err, code)` để bắt mã cụ thể (vd **2008** = MX conflict khi bật Email Routing).
- Zone `"manual"`: các hàm quản lý rule theo địa chỉ trả sớm (no-op).

## 2. Danh mục endpoint dùng tới

| Hàm | Method & path | Body / ghi chú |
|---|---|---|
| `getZone` | `GET /zones/{zoneId}` | → `{id, name}` |
| `findZoneByHostname` | `GET /zones?name={cand}&status=active` | thử từng ứng viên (xem §3) |
| `getEmailRoutingSettings` | `GET /zones/{z}/email/routing` | → `{enabled, status, name}` |
| `getEmailRoutingDns` | `GET /zones/{z}/email/routing/dns` | → `{record: [...], errors: [{missing: record}]}` → `{records, missing}` |
| `enableEmailRouting` | `POST /zones/{z}/email/routing/dns` | body `{name: hostname}` nếu subdomain; không body nếu apex. Tạo MX + SPF |
| `disableEmailRouting` | `DELETE /zones/{z}/email/routing/dns` | |
| `listEmailRoutingRules` | `GET /zones/{z}/email/routing/rules` | |
| `createEmailRoutingRuleToWorker` | `POST /zones/{z}/email/routing/rules` | `{actions:[{type:"worker",value:[W]}], enabled:true, matchers:[{type:"literal",field:"to",value:addr}], name:"Route <addr> to <W>"}` |
| cập nhật rule | `PUT /zones/{z}/email/routing/rules/{id}` | giữ `name`, `priority` cũ |
| `deleteEmailRoutingRule` | `DELETE /zones/{z}/email/routing/rules/{id}` | |
| `getEmailRoutingCatchAll` | `GET /zones/{z}/email/routing/rules/catch_all` | lỗi → null |
| `ensureEmailRoutingCatchAllToWorker` | `PUT …/rules/catch_all` | `{actions:[{type:"worker",value:[W]}], enabled:true, matchers:[{type:"all"}], name:"Route all email to <W>"}` |
| `restoreEmailRoutingCatchAll` | `PUT …/rules/catch_all` | bản cũ, hoặc `{actions:[{type:"drop"}], matchers:[{type:"all"}], enabled:false}` |
| `listSendingSubdomains` | `GET /zones/{z}/email/sending/subdomains` | → `[{tag, name, enabled, dkim_selector}]` |
| `createSendingSubdomain` | `POST /zones/{z}/email/sending/subdomains` | `{name: hostname}` → `{tag, name, enabled}` |
| `deleteSendingSubdomain` | `DELETE …/subdomains/{tag}` | |
| `getSendingSubdomainDns` | `GET …/subdomains/{tag}/dns` | bản ghi DKIM/SPF/… cho gửi |
| `listMxRecords` | `GET /zones/{z}/dns_records?type=MX&name={host}&per_page=5000` | |
| `listDnsRecords` | `GET /zones/{z}/dns_records?type={t}&name={n}&per_page=5000` | |
| `createDnsRecord` | `POST /zones/{z}/dns_records` | `{type, name, content, priority?, ttl, proxied?, comment?, tags?}` |
| `deleteDnsRecord` | `DELETE /zones/{z}/dns_records/{id}` | |

`W` = tên Email Worker.

## 3. Tìm zone cho hostname
```
getZoneLookupCandidates("a.b.example.com") = ["a.b.example.com", "b.example.com", "example.com"]
// dừng ở 2 nhãn cuối
for cand in candidates: zones = GET /zones?name=cand&status=active; if zone.name == cand → return
→ null  ⇒ lỗi: Zone not found for "<host>". The domain must use Cloudflare DNS on this account.
isZoneApex(hostname, zone.name) = hostname == zone.name
```

## 4. Quản lý rule theo địa chỉ
- **`ensureEmailRoutingRuleToWorker(zone, addr)`** (idempotent): liệt kê rule; tìm rule có matcher `literal/to == addr (lowercase)` **và** action `worker` chứa `W` (hoặc action worker không có value). Có & enabled → giữ. Có nhưng disabled → `PUT` bật lại. Không có → tạo mới.
- **`deleteEmailRoutingRuleForAddress(zone, addr)`**: tìm rule như trên, xoá; trả `false` nếu không có.
- **`deleteEmailRoutingRulesForDomain(zone, host)`**: xoá mọi rule có matcher `literal/to` với value `== host` hoặc kết thúc `@host`.

## 5. Tìm sending subdomain khớp
```
findSendingSubdomain(host, subs):
  exact = subs.find(s => s.name.lower == host)                  → ưu tiên
  wildcard = subs.find(s => s.name bắt đầu "*." && host kết thúc "." + base && host != base)
```

## 6. Tiêu chí chấp nhận
- [ ] Token sai → lỗi rõ ràng kèm gợi ý verify token.
- [ ] Gọi `ensureEmailRoutingRuleToWorker` hai lần không tạo rule trùng.
- [ ] Hostname `mail.example.com` trên zone `example.com` → tìm được zone, bật Email Routing với `{name:"mail.example.com"}`.
