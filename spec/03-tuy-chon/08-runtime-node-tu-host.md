# Triển khai ngoài Cloudflare Workers (tuỳ chọn)

> **[TÙY CHỌN]** · Phụ thuộc: [00-nen-tang/02-kien-truc-cloudflare.md](../00-nen-tang/02-kien-truc-cloudflare.md), [01-co-ban/06-nhan-thu.md](../01-co-ban/06-nhan-thu.md) · Liên quan: [01-co-ban/04-quan-ly-domain.md](../01-co-ban/04-quan-ly-domain.md), [02-nang-cao/02-rule-domain.md](../02-nang-cao/02-rule-domain.md), [02-nang-cao/08-chuyen-tiep-tai-khoan.md](../02-nang-cao/08-chuyen-tiep-tai-khoan.md)

## 1. Mục tiêu
Cho phép chạy **cùng một ứng dụng** trên một máy chủ tự quản (tiến trình Node.js hoặc container) mà không cần Cloudflare Workers, bằng một lớp adapter cung cấp các binding có cùng hình dạng. Thư đến được nhận qua SMTP trực tiếp hoặc qua một Worker relay nhỏ chuyển tiếp từ Cloudflare Email Routing.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Adapter cho DB, lưu trữ object, gửi thư, queue, realtime, rate limit, cron | Phân tán nhiều instance (adapter là đơn tiến trình) |
| SMTP listener nhận thư | SMTP submission cho mail client (AUTH) |
| Giao thức relay inbound có ký HMAC | Tự quản lý DNS (bản ghi được liệt kê để tạo tay) |
| Domain không có Cloudflare (`zoneId = "manual"`) | Tự cập nhật từ trong ứng dụng |

## 3. Lớp adapter
Mã ứng dụng chỉ truy cập nền tảng qua đối tượng `env` (bindings). Adapter dựng đối tượng có cùng giao diện:

| Binding | Adapter | Yêu cầu |
|---|---|---|
| `DB` | SQLite cục bộ (`$DATA_DIR/app.sqlite`) bọc API tương thích D1 (`prepare/bind/first/all/run/batch`) | `batch` chạy trong một transaction; hỗ trợ FTS5 và trigger |
| `BUCKET` | Lưu file dưới `$DATA_DIR/blobs` (object + file metadata JSON bên cạnh) | Hỗ trợ `get/put/delete/head` và `list({prefix, cursor, limit})` (cần cho dọn upload JMAP và backup) |
| `EMAIL` | SMTP (`SMTP_URL`) hoặc Cloudflare Email Sending REST (`CF_ACCOUNT_ID` + `CF_TOKEN`: `POST /accounts/{account_id}/email/sending/send`) | Cùng hợp đồng với binding `send_email`: trả Message-ID, ném lỗi khi gửi thất bại |
| `INBOUND_QUEUE`, `OUTBOUND_QUEUE` | Hàng đợi trong tiến trình, **lưu bền** vào một file SQLite riêng (`$DATA_DIR/queue.sqlite`) | Hỗ trợ `delaySeconds`; retry 3 lần × 10 s; công việc còn dở được chạy lại sau khi khởi động lại |
| `REALTIME` | Registry WebSocket trong bộ nhớ, cùng giao thức với Durable Object ([02-nang-cao/04](../02-nang-cao/04-realtime.md)) | Theo user id |
| `LOGIN_RATE_LIMIT` | Fixed window trong bộ nhớ, cùng hạn mức | |
| Cron | Bộ hẹn giờ kiểm tra mỗi phút | Chạy các việc hằng ngày ([05-van-hanh/01](../05-van-hanh/01-bay-va-cai-thien.md)) một lần/ngày lúc 02:00 UTC |

- Biến `APP_RUNTIME = "node"` đánh dấu runtime; mã ứng dụng kiểm tra bằng một hàm "đang chạy ngoài Workers" duy nhất, và chỉ ở các chỗ liệt kê trong §4.
- Migration được áp khi khởi động từ cùng gói migration ([03-tuy-chon/05](05-migration-self-update.md)), mỗi file một transaction, ghi vào `d1_migrations`.

## 4. Hành vi khác theo runtime
- `GET /api/auth/me` trả thêm `runtime` (`"workers"` | `"node"`) và `managesDns` (true khi có credential Cloudflare).
- Kiểm tra lúc khởi tạo ([01-co-ban/01](../01-co-ban/01-khoi-tao-he-thong.md)): Database, Outbound mail (SMTP hoặc REST cấu hình được), Cloudflare credentials (tuỳ chọn).
- Không có credential Cloudflare → domain được lưu với `zoneId = "manual"`, mọi lời gọi Cloudflare API cho domain đó là no-op, trang DNS liệt kê bản ghi cần tạo tay:
  - `MX 10 <MAIL_HOSTNAME hoặc mail.<host>>`
  - `TXT v=spf1 a:<mailHost> ~all`
  - `_dmarc TXT v=DMARC1; p=none`
- Mailbox mới không tạo rule Email Routing (không có Worker nhận thư).
- Cập nhật phiên bản: `POST /api/admin/update` → 400 "Update this installation by deploying a new image".

## 5. Nhận thư

### 5.1 Thủ tục tiếp nhận dùng chung
`TIEP_NHAN_THU(env, {from, to, raw, headers}, {reject, forward})` thực hiện đúng các bước của email handler trên Workers ([01-co-ban/06](../01-co-ban/06-nhan-thu.md)): phân giải địa chỉ + rule domain (reject → forward rule) → chuyển tiếp tài khoản → ghi raw vào R2 → enqueue `INBOUND_QUEUE`. Khác biệt duy nhất: hành động reject/forward được thực hiện qua callback do nguồn gọi cung cấp; lỗi được ném cho nguồn gọi.

### 5.2 SMTP listener
- Cổng `SMTP_INBOUND_PORT` (mặc định 25); không AUTH; STARTTLS khi có `SMTP_TLS_KEY` và `SMTP_TLS_CERT`; kích thước tối đa `SMTP_MAX_SIZE` (mặc định 25 MiB, vượt → `552`).
- Mỗi `RCPT TO` → gọi `TIEP_NHAN_THU` với callback:
  - `reject(reason)` → trả `550 <reason>` cho DATA;
  - `forward(to, headers)` → gửi lại nguyên raw qua adapter `EMAIL` tới `to`, **thêm header `X-App-Forwarded: 1`** (cùng header chống vòng lặp như trên Workers, [02-nang-cao/08](../02-nang-cao/08-chuyen-tiep-tai-khoan.md)) và các `headers` được yêu cầu.
- Lỗi xử lý → `451 Temporary failure, please retry`.
- Thư đã có `X-App-Forwarded` không bị chuyển tiếp lần nữa.

### 5.3 Relay Worker + `POST /api/inbound`
Một Worker nhỏ gắn với Cloudflare Email Routing nhận thư và POST về máy chủ tự quản.

**Request từ relay**
| Thành phần | Giá trị |
|---|---|
| Method / path | `POST <APP_URL>/api/inbound` |
| Body | raw RFC 5322, `Content-Type: message/rfc822` |
| `X-App-From` | envelope from |
| `X-App-To` | envelope to (**một** người nhận mỗi request) |
| `X-App-Headers` | JSON các header đã parse mà Email Routing cung cấp |
| `X-App-Timestamp` | Unix time (giây) lúc ký |
| `X-App-Signature` | hex `HMAC-SHA256(INBOUND_WEBHOOK_SECRET, "<timestamp>\n<from>\n<to>\n<X-App-Headers>\n" + raw)` |

**Xử lý phía máy chủ**
```
không cấu hình INBOUND_WEBHOOK_SECRET → 503
Content-Length hoặc body > 25 MiB → 413
thiếu header bắt buộc → 400
|now − timestamp| > 300 s → 401 "Stale inbound request"
chữ ký sai (so sánh constant-time) → 401
chữ ký đã thấy trong 10 phút gần nhất (cache chữ ký) → 200 lặp lại kết quả trước, không xử lý lại
TIEP_NHAN_THU(...) với callback ghi lại quyết định (không tự reject/forward)
→ 200 {action: "reject" | "forward" | "store", reason?, rawR2Key?, forwardTo?, forwardHeaders?}
lỗi → 500
```

**Hành vi relay**
- Lỗi mạng / timeout 30 s / phản hồi không 2xx → `message.setReject("{APP_NAME} is temporarily unavailable, please retry")`.
- `action = reject` → `message.setReject(reason)`.
- Có `forwardTo` → `message.forward(forwardTo, forwardHeaders)` (forwardHeaders gồm `X-App-Forwarded: 1`).
- Relay có cùng `INBOUND_WEBHOOK_SECRET` (secret Worker) và `APP_URL`.

## 6. Cấu hình
| Biến | Ý nghĩa |
|---|---|
| `PORT`, `HOST` | Địa chỉ HTTP listen (mặc định 3000, `0.0.0.0`) |
| `DATA_DIR` | Thư mục dữ liệu (DB, blobs, queue); cần volume bền |
| `APP_URL` | Origin công khai |
| `APP_RUNTIME` | `node` |
| `SMTP_INBOUND_PORT`, `MAIL_HOSTNAME`, `SMTP_MAX_SIZE`, `SMTP_TLS_KEY`, `SMTP_TLS_CERT` | SMTP nhận |
| `SMTP_URL`, `SMTP_TLS_REJECT_UNAUTHORIZED` | SMTP gửi |
| `CF_ACCOUNT_ID`, `CF_TOKEN` | Gửi qua Cloudflare REST và/hoặc quản lý DNS |
| `INBOUND_WEBHOOK_SECRET` | Ký relay inbound (≥ 32 byte ngẫu nhiên) |
| `TURNSTILE_SECRET_KEY` | Turnstile (tuỳ chọn) |

Container: chạy dưới user không phải root, mount `DATA_DIR` là volume, mở cổng HTTP và SMTP, healthcheck `GET /api/setup/status`.

## 7. Lỗi & biên
- Khởi động lại khi còn job trong queue → job được chạy lại; pipeline nhận thư idempotent theo `(mailbox_id, raw_r2_key)` ([01-co-ban/06 §8](../01-co-ban/06-nhan-thu.md)) nên không tạo trùng.
- Relay gửi lại cùng thư sau timeout → chữ ký/timestamp mới; idempotency của pipeline chặn bản trùng.
- Đồng hồ máy chủ lệch > 5 phút so với relay → mọi request 401; cần đồng bộ NTP.

## 8. Tiêu chí chấp nhận
- [ ] Cùng bộ test nghiệp vụ chạy qua được trên cả Workers và adapter Node.
- [ ] Request `/api/inbound` có timestamp cũ 10 phút → 401.
- [ ] Gửi lại nguyên một request hợp lệ trong 10 phút → không tạo thư thứ hai.
- [ ] Forward qua SMTP thêm `X-App-Forwarded: 1`; thư quay vòng về lại không bị forward lần hai.
- [ ] Tắt tiến trình khi có thư trong `INBOUND_QUEUE` → sau khởi động thư được lưu.
- [ ] Không có credential Cloudflare → thêm domain thành công với `zoneId = "manual"`, trang DNS liệt kê 3 bản ghi.
