# Cloudflare REST API client

> **[CƠ BẢN]** · Nhóm: Nền tảng · Dùng bởi: domain, mailbox, alias, DNS, rollback · Liên quan: [02-kien-truc-cloudflare.md §3](02-kien-truc-cloudflare.md), [01-co-ban/04-quan-ly-domain.md](../01-co-ban/04-quan-ly-domain.md)

## 1. Thủ tục gọi API — `CF_REQUEST(path, init?)`
```
CF_REQUEST(path, init?):
  res  = fetch("https://api.cloudflare.com/client/v4" + path, {
            ...init, headers: { ...authHeaders, "Content-Type": "application/json", ...init.headers } })
  json = await res.json()   // { success, result, errors: [{code, message}] }
  if !json.success → ném LỖI_CLOUDFLARE { message, status: res.status, path, errors }
  return json.result
```
- **Auth**: `authHeaders` theo quy tắc chọn thông tin xác thực ở [02-kien-truc-cloudflare.md §3.1](02-kien-truc-cloudflare.md): có `CF_TOKEN` → `Authorization: Bearer <token>`; không có `CF_TOKEN` nhưng có `CF_API_KEY` + `CF_EMAIL` → `X-Auth-Email`, `X-Auth-Key`; `CF_API_KEY` thiếu `CF_EMAIL` → lỗi `"CF_EMAIL is required when using CF_API_KEY"`; không có gì → lỗi `"CF_TOKEN or CF_API_KEY is not configured"`.
- **Thông báo lỗi**: `Cloudflare API <status> on <path>: code <c>: <msg>; …`. Nếu có lỗi auth (code 10000, 9109, hoặc message chứa "auth"/"token") thêm gợi ý kiểm tra token bằng `GET /user/tokens/verify`.
- **Nhận diện mã lỗi**: `LỖI_CLOUDFLARE` mang mảng `errors`; thủ tục gọi kiểm tra `errors[].code` để bắt mã cụ thể (vd **2008** = MX conflict khi bật Email Routing → 409 `MX_RECORDS_CONFLICT`).
- **Ánh xạ HTTP**: `LỖI_CLOUDFLARE` không được bắt riêng → **502** `{"error": "<thông báo lỗi>", "code": "UPSTREAM_ERROR"}` (xem [06-quy-uoc-chung.md §3.1](06-quy-uoc-chung.md)).
- Zone `"manual"`: mọi thao tác quản lý rule theo địa chỉ trả ngay (no-op).

## 2. Danh mục endpoint dùng tới

| Thao tác | Method & path | Body / ghi chú |
|---|---|---|
| Đọc zone | `GET /zones/{zoneId}` | → `{id, name}` |
| Tìm zone theo hostname | `GET /zones?name={cand}&status=active` | thử từng ứng viên (xem §3) |
| Đọc cài đặt Email Routing | `GET /zones/{z}/email/routing` | → `{enabled, status, name}` |
| Đọc DNS Email Routing | `GET /zones/{z}/email/routing/dns` | → `{record: [...], errors: [{missing: record}]}` → chuyển thành `{records, missing}` |
| Bật Email Routing | `POST /zones/{z}/email/routing/dns` | body `{name: hostname}` nếu subdomain; không body nếu apex. Tạo MX + SPF |
| Tắt Email Routing | `DELETE /zones/{z}/email/routing/dns` | |
| Liệt kê rule Email Routing | `GET /zones/{z}/email/routing/rules` | |
| Tạo rule địa chỉ → Worker | `POST /zones/{z}/email/routing/rules` | `{actions:[{type:"worker",value:[W]}], enabled:true, matchers:[{type:"literal",field:"to",value:addr}], name:"Route <addr> to <W>"}` |
| Cập nhật rule | `PUT /zones/{z}/email/routing/rules/{id}` | giữ `name`, `priority` đang có |
| Xoá rule | `DELETE /zones/{z}/email/routing/rules/{id}` | |
| Đọc catch-all | `GET /zones/{z}/email/routing/rules/catch_all` | lỗi → null |
| Đặt catch-all → Worker | `PUT …/rules/catch_all` | `{actions:[{type:"worker",value:[W]}], enabled:true, matchers:[{type:"all"}], name:"Route all email to <W>"}` |
| Khôi phục catch-all | `PUT …/rules/catch_all` | cấu hình đã lưu trước khi thay, hoặc mặc định `{actions:[{type:"drop"}], matchers:[{type:"all"}], enabled:false}` |
| Liệt kê sending subdomain | `GET /zones/{z}/email/sending/subdomains` | → `[{tag, name, enabled, dkim_selector}]` |
| Tạo sending subdomain | `POST /zones/{z}/email/sending/subdomains` | `{name: hostname}` → `{tag, name, enabled}` |
| Xoá sending subdomain | `DELETE …/subdomains/{tag}` | |
| Đọc DNS sending subdomain | `GET …/subdomains/{tag}/dns` | bản ghi DKIM/SPF/… cho gửi |
| Liệt kê MX | `GET /zones/{z}/dns_records?type=MX&name={host}&per_page=5000` | |
| Liệt kê bản ghi DNS | `GET /zones/{z}/dns_records?type={t}&name={n}&per_page=5000` | |
| Tạo bản ghi DNS | `POST /zones/{z}/dns_records` | `{type, name, content, priority?, ttl, proxied?, comment?, tags?}` |
| Xoá bản ghi DNS | `DELETE /zones/{z}/dns_records/{id}` | |

`W` = `{EMAIL_WORKER_NAME}`.

## 3. Tìm zone cho hostname
```
UNG_VIEN_ZONE("a.b.example.com") = ["a.b.example.com", "b.example.com", "example.com"]
// bỏ dần nhãn bên trái, dừng ở 2 nhãn cuối
for cand in UNG_VIEN_ZONE(host):
    zones = GET /zones?name=cand&status=active
    if zone có zone.name == cand → return zone
→ null  ⇒ lỗi: Zone not found for "<host>". The domain must use Cloudflare DNS on this account.
LA_APEX(hostname, zone) = hostname == zone.name
```

## 4. Quản lý rule theo địa chỉ
- **Đảm bảo rule địa chỉ → Worker** `(zone, addr)` (idempotent): liệt kê rule; tìm rule có matcher `literal/to == lowercase(addr)` **và** action `worker` chứa `W` (hoặc action `worker` không có value). Có & enabled → giữ. Có nhưng disabled → `PUT` bật lại. Không có → tạo mới.
- **Xoá rule của một địa chỉ** `(zone, addr)`: tìm rule như trên và xoá; trả `false` nếu không có.
- **Xoá mọi rule của domain** `(zone, host)`: xoá mọi rule có matcher `literal/to` với value `== host` hoặc kết thúc bằng `@host`.

## 5. Tìm sending subdomain khớp
```
TIM_SENDING_SUBDOMAIN(host, subs):
  exact    = subs.find(s => lowercase(s.name) == host)                                  → ưu tiên
  wildcard = subs.find(s => s.name bắt đầu "*." && host kết thúc "." + base && host != base)  // base = s.name bỏ "*."
  return exact ?? wildcard ?? null
```

## 6. Tiêu chí chấp nhận
- [ ] Token sai → lỗi rõ ràng kèm gợi ý verify token.
- [ ] Có cả `CF_TOKEN` và `CF_EMAIL`+`CF_API_KEY` → request dùng `Authorization: Bearer`, không gửi `X-Auth-Key`.
- [ ] Gọi "Đảm bảo rule địa chỉ → Worker" hai lần không tạo rule trùng.
- [ ] Hostname `mail.example.com` trên zone `example.com` → tìm được zone, bật Email Routing với `{name:"mail.example.com"}`.
- [ ] Lỗi Cloudflare không được xử lý riêng → HTTP 502 với envelope lỗi chuẩn.
