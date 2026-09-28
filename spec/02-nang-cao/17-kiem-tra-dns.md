# Kiểm tra & tự sửa DNS xác thực (MX / SPF / DKIM / DMARC)

> **[NÂNG CAO]** · Phụ thuộc: [01-co-ban/04-quan-ly-domain.md](../01-co-ban/04-quan-ly-domain.md), [00-nen-tang/07-cloudflare-api.md](../00-nen-tang/07-cloudflare-api.md)

## 1. Mục tiêu
Kiểm tra độc lập DNS **công khai** (không tin bản ghi mà Cloudflare API báo) cho 4 bản ghi quyết định khả năng nhận và độ tin cậy khi gửi, và cho phép tạo bản ghi thiếu bằng một cú bấm.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Tra DoH, phân loại ok/missing/unknown | Kiểm tra nội dung SPF có include đúng Cloudflare không |
| Tạo MX/SPF (bật Email Routing), DKIM (sending subdomain), DMARC `p=none` | Nâng DMARC lên quarantine/reject, báo cáo DMARC |

## 3. Tra cứu — `queryDns(name, type)`
`GET https://cloudflare-dns.com/dns-query?name=<n>&type=<t>` với `accept: application/dns-json`, timeout 5 s.
- HTTP lỗi → ném. `Status` ∉ {0 (NOERROR), 3 (NXDOMAIN)} → ném.
- `Answer` rỗng / NXDOMAIN → `[]`.
- TXT: nối các đoạn `"…"`.
Hoạt động giống nhau trên Workers và Node (không dùng module `dns`).

## 4. Audit — `auditDomainDns(hostname, view)`
| Bản ghi | Tên tra | Loại | Khớp khi |
|---|---|---|---|
| MX | `hostname` | MX | có giá trị không phải null MX (`0 .`) |
| SPF | `hostname` | TXT | chứa `v=spf1` |
| DMARC | `_dmarc.hostname` | TXT | chứa `v=DMARC1` |
| DKIM | `<dkimSelector>._domainkey.hostname` (selector từ sending subdomain), hoặc tên TXT chứa `_domainkey` trong bản ghi mong đợi | TXT | có bất kỳ giá trị |
Kết quả mỗi bản ghi `{record, label, name, status: ok|missing|unknown, found[]}`: có khớp → `ok`; tra được nhưng không khớp → `missing`; tra lỗi → `unknown`; không xác định được tên DKIM → `unknown` với tên `*._domainkey.<host>`.

Có trong `GET /api/domains/{id}/dns` (`dns.audit`) và tóm tắt trong `GET /api/domains?includeDns=true` (`dns[id].auth`).

## 5. Tự sửa — `POST /api/domains/{id}/dns/setup {record}` (chủ domain; v1: scope `domains`)
| record | Hành động (idempotent) |
|---|---|
| `mx`, `spf` | `POST email/routing/dns` (có `name` nếu subdomain) + catch-all → Worker; cập nhật `routing_enabled`, `routing_status` |
| `dkim` | tìm sending subdomain khớp (chính xác hoặc wildcard) — có thì dùng lại, không thì tạo; cập nhật `sending_subdomain_tag`, `sending_enabled`, `sending_requested = true` |
| `dmarc` | nếu chưa có TXT `_dmarc.<host>` chứa `v=dmarc1` → tạo TXT `v=DMARC1; p=none`, TTL 3600 |
Zone `manual` → lỗi "DNS for this domain is managed manually". Trả `{domain, dns}` sau cập nhật.

## 6. UI
Thẻ domain: hàng MX | SPF | DKIM | DMARC với biểu tượng trạng thái; "Show details" → mỗi bản ghi có mô tả ("Routes incoming email to Mailflare", "Authorizes Mailflare to send email", "Signs outgoing email for deliverability", "Helps prevent email spoofing"), giá trị tìm thấy, nút "Setup" nếu chưa ok (ẩn với zone manual).

## 7. Tiêu chí chấp nhận
- [ ] Domain chưa có DMARC → audit `missing`; bấm Setup → có TXT `v=DMARC1; p=none`; audit `ok` (sau khi DNS lan truyền).
- [ ] Bấm Setup DKIM hai lần → không tạo subdomain trùng.
- [ ] DoH timeout → trạng thái `unknown`, không lỗi trang.
