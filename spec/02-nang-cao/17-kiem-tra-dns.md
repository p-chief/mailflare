# Kiểm tra & tự sửa DNS xác thực (MX / SPF / DKIM / DMARC)

> **[NÂNG CAO]** · Phụ thuộc: [01-co-ban/04-quan-ly-domain.md](../01-co-ban/04-quan-ly-domain.md), [00-nen-tang/07-cloudflare-api.md](../00-nen-tang/07-cloudflare-api.md) · Liên quan: [13-api-key-va-rest-v1.md](13-api-key-va-rest-v1.md) (endpoint v1)

## 1. Mục tiêu
Kiểm tra độc lập DNS **công khai** (không tin bản ghi mà Cloudflare API báo) cho 4 bản ghi quyết định khả năng nhận thư và độ tin cậy khi gửi, và cho phép tạo bản ghi thiếu bằng một cú bấm.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Tra DNS-over-HTTPS (DoH), phân loại ok/missing/unknown | Kiểm tra nội dung SPF có include đúng Cloudflare không |
| Tạo MX/SPF (bật Email Routing), DKIM (sending subdomain), DMARC `p=none` | Nâng DMARC lên quarantine/reject, báo cáo DMARC |

## 3. Tra cứu — thủ tục `TRA_DNS(name, type)`
`GET https://cloudflare-dns.com/dns-query?name=<name>&type=<type>` với header `accept: application/dns-json`, timeout 5 s.
- HTTP lỗi (non-2xx, timeout, mạng) → ném lỗi.
- `Status` ∉ {0 (NOERROR), 3 (NXDOMAIN)} → ném lỗi.
- `Answer` rỗng hoặc NXDOMAIN → `[]`.
- TXT: bỏ dấu ngoặc kép và nối các đoạn `"…"` của cùng bản ghi thành một chuỗi.

Chỉ dùng HTTP fetch, không cần resolver của hệ điều hành, nên chạy được trên mọi runtime.

## 4. Kiểm tra — thủ tục `KIEM_TRA_DNS(hostname, dnsView)`
`dnsView` là kết quả xem DNS của domain ([01-co-ban/04-quan-ly-domain.md §7](../01-co-ban/04-quan-ly-domain.md)), dùng để lấy selector DKIM.

| Bản ghi | Tên tra | Loại | Khớp khi |
|---|---|---|---|
| MX | `hostname` | MX | có ít nhất một giá trị không phải null MX (`0 .`) |
| SPF | `hostname` | TXT | có giá trị chứa `v=spf1` |
| DMARC | `_dmarc.hostname` | TXT | có giá trị chứa `v=DMARC1` |
| DKIM | `<dkimSelector>._domainkey.hostname` (selector lấy từ sending subdomain), nếu không có thì tên TXT chứa `_domainkey` trong danh sách bản ghi mong đợi của `dnsView` | TXT | có bất kỳ giá trị nào |

So khớp chuỗi không phân biệt hoa thường. Bốn tra cứu chạy song song. Kết quả mỗi bản ghi `{record, label, name, status: ok|missing|unknown, found[]}`:
- có giá trị khớp → `ok`;
- tra được nhưng không khớp → `missing`;
- tra lỗi → `unknown`;
- không xác định được tên DKIM → `unknown` với `name = "*._domainkey.<hostname>"`.

Có trong `GET /api/domains/{id}/dns` (trường `dns.audit`) và dạng tóm tắt trong `GET /api/domains?includeDns=true` (`dns[<id>].auth = {mx, spf, dkim, dmarc}` là các status).

## 5. Tự sửa — `POST /api/domains/{id}/dns/setup {record}`
Quyền: chủ domain (`domains.user_id = user.id`, khác → 404 "Domain not found"); qua API v1 cần scope `domains`. `record` ∉ {mx, spf, dkim, dmarc} → 400 "Unknown DNS record".

| record | Hành động (idempotent) |
|---|---|
| `mx`, `spf` | `POST zones/{zone}/email/routing/dns` (kèm `name` nếu hostname là subdomain của zone) + đặt catch-all → Worker `{EMAIL_WORKER_NAME}`; cập nhật `routing_enabled`, `routing_status` |
| `dkim` | tìm sending subdomain khớp hostname (chính xác hoặc wildcard) — có thì dùng lại, không thì tạo; cập nhật `sending_subdomain_tag`, `sending_enabled`, `sending_requested = true` |
| `dmarc` | nếu chưa có TXT `_dmarc.<hostname>` chứa `v=dmarc1` (không phân biệt hoa thường) → tạo TXT `v=DMARC1; p=none`, TTL 3600 |

- Zone `manual` → 400 "DNS for this domain is managed manually".
- Lỗi Cloudflare API → 500 `{error}`.
- Thành công → `{domain, dns}` (DNS view kèm audit mới).

## 6. UI
Thẻ domain: hàng MX | SPF | DKIM | DMARC với biểu tượng trạng thái; "Show details" → mỗi bản ghi có mô tả ("Routes incoming email to {APP_NAME}", "Authorizes {APP_NAME} to send email", "Signs outgoing email for deliverability", "Helps prevent email spoofing"), giá trị tìm thấy, nút "Setup" nếu chưa `ok` (ẩn với zone manual — thay bằng bảng bản ghi cần đặt thủ công).

## 7. Lỗi & biên
- DoH timeout hoặc lỗi cho một bản ghi không ảnh hưởng ba bản ghi còn lại.
- Ngay sau khi Setup, audit có thể vẫn `missing` cho tới khi DNS lan truyền; UI không coi đó là lỗi.
- Setup lặp lại không tạo bản ghi/subdomain trùng.

## 8. Tiêu chí chấp nhận
- [ ] Domain chưa có DMARC → audit `missing`; bấm Setup → có TXT `v=DMARC1; p=none`; audit `ok` (sau khi DNS lan truyền).
- [ ] Bấm Setup DKIM hai lần → không tạo sending subdomain trùng.
- [ ] DoH timeout → trạng thái `unknown`, không lỗi trang.
- [ ] Domain zone `manual` → không có nút Setup; gọi API → 400.
