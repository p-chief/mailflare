# Kiến trúc runtime trên Cloudflare

> **[CƠ BẢN]** · Nhóm: Nền tảng · Liên quan: [06-quy-uoc-chung.md](06-quy-uoc-chung.md), [07-cloudflare-api.md](07-cloudflare-api.md), [08-hang-so-gioi-han.md](08-hang-so-gioi-han.md)

## 1. Mục tiêu

Toàn bộ hệ thống chạy trong **một Worker duy nhất**. Worker này là entrypoint cho mọi sự kiện: HTTP/WebSocket (`fetch`), thư đến từ Email Routing (`email`), hàng đợi (`queue`), cron (`scheduled`), và export class Durable Object phục vụ realtime. Giao diện web là SPA build ra static assets, được phục vụ bởi chính Worker đó qua binding `ASSETS`.

## 2. Bindings

| Binding | Loại | Dùng cho | Nhãn |
|---|---|---|---|
| `DB` | D1 | Dữ liệu quan hệ + FTS5 | CƠ BẢN |
| `BUCKET` | R2 | Raw MIME, attachment, avatar, backup | CƠ BẢN |
| `EMAIL` | `send_email` (`remote: true`) | Gửi thư | CƠ BẢN |
| `INBOUND_QUEUE` | Queue (producer + consumer) | Xử lý thư đến | CƠ BẢN |
| `LOGIN_RATE_LIMIT` | Rate limiting `simple: {limit: 20, period: 60}` | Đăng nhập, xác minh MFA | CƠ BẢN |
| `ASSETS` | Static assets | Phục vụ SPA | CƠ BẢN |
| `OUTBOUND_QUEUE` | Queue (producer + consumer) | Hẹn giờ gửi **và** retry webhook (chung 1 queue) | NÂNG CAO |
| `REALTIME` | Durable Object, class `RealtimeHub` (migration `new_sqlite_classes`) | WebSocket thông báo | NÂNG CAO |
| Cron `0 2 * * *` | Trigger | Dọn dẹp & lưu giữ hằng ngày, backup định kỳ | NÂNG CAO (dọn dẹp) / TÙY CHỌN (backup) |
| Cron `*/5 * * * *` | Trigger | Đánh thức thư hết snooze | NÂNG CAO |

Tên tài nguyên đặt tuỳ ý theo quy ước `<app>`: queue `<app>-inbound`, `<app>-outbound`; dead-letter queue `<app>-inbound-dlq`, `<app>-outbound-dlq`; bucket `<app>-raw`; database `<app>`.

Consumer của cả hai queue: `max_batch_size: 5`, `max_retries: 3`, `dead_letter_queue` tương ứng. Message rơi vào DLQ phải được log mức error và cảnh báo ([05-van-hanh/01 §5](../05-van-hanh/01-bay-va-cai-thien.md)).

Compatibility flags: `nodejs_compat`, `global_fetch_strictly_public` (fetch ra ngoài không được gọi địa chỉ nội bộ — bắt buộc cho webhook và import IMAP).

`observability.enabled: true`, `upload_source_maps: true`.

## 3. Secrets / biến cấu hình

| Tên | Ý nghĩa | Nhãn |
|---|---|---|
| `EMAIL_WORKER_NAME` | Tên Worker đã deploy. Mọi rule Email Routing trỏ `{"type":"worker","value":["{EMAIL_WORKER_NAME}"]}`, nên giá trị này **phải trùng** tên Worker trong cấu hình deploy. | CƠ BẢN |
| `APP_NAME` | Tên sản phẩm mặc định `{APP_NAME}` dùng trong UI và thư hệ thống (có thể bị ghi đè bởi `app_settings.app_name` — xem [03-tuy-chon/01-license-branding.md](../03-tuy-chon/01-license-branding.md)). | CƠ BẢN |
| `APP_HOST` | Hostname dùng để sinh Message-ID dự phòng `<id@{APP_HOST}>`, UID lịch `@{APP_HOST}`. | CƠ BẢN |
| `APP_URL` | URL công khai của ứng dụng (link trong thư reset mật khẩu, kiểm tra `Origin`). | CƠ BẢN |
| `CF_TOKEN` | API token Cloudflare (**phương thức ưu tiên**). Quyền cần: Zone:Read, DNS:Edit, Email Routing Rules/Addresses:Edit, Zone Settings (Email Routing), Email Sending:Edit | CƠ BẢN |
| `CF_EMAIL` + `CF_API_KEY` | Global API key — phương thức **thay thế**, chỉ dùng khi **không có** `CF_TOKEN` | Thay thế |
| `TOTP_ENCRYPTION_KEY` | Khoá 32 byte (base64) để mã hoá TOTP secret khi lưu (xem [02-nang-cao/15-xac-thuc-2-lop.md](../02-nang-cao/15-xac-thuc-2-lop.md)) | NÂNG CAO (bắt buộc khi bật MFA) |
| `TURNSTILE_SECRET_KEY` | Bật captcha cho login/register | TÙY CHỌN |
| `INBOUND_WEBHOOK_SECRET`, `CF_ACCOUNT_ID`, `APP_RUNTIME` | Runtime Node tự host (xem [03-tuy-chon/08-runtime-node-tu-host.md](../03-tuy-chon/08-runtime-node-tu-host.md)) | TÙY CHỌN |
| `SETUP_TOKEN` | Cho phép chạy bước chuẩn bị khởi tạo khi DB đã có bảng (header `X-Setup-Token`) — [01-co-ban/01](../01-co-ban/01-khoi-tao-he-thong.md) | TÙY CHỌN |
| `MAX_INBOUND_SIZE` | Kích thước thư đến tối đa (mặc định 25 MB) — [01-co-ban/06](../01-co-ban/06-nhan-thu.md) | CƠ BẢN |
| `TRASH_RETENTION_DAYS` | Số ngày trước khi tự xoá Trash/Spam (mặc định 30; `0` = tắt) | NÂNG CAO |
| `AUDIT_RETENTION_DAYS` | Số ngày lưu audit log (mặc định 365; `0` = giữ mãi) | NÂNG CAO |
| `WEBHOOK_DELIVERY_RETENTION_DAYS` | Số ngày lưu webhook delivery đã kết thúc (mặc định 30) | NÂNG CAO |
| `GRAVATAR_ENABLED` | Tra Gravatar cho liên hệ mới (mặc định bật) | TÙY CHỌN |
| `ENTITLEMENTS`, `LICENSE_SERVER_URL`, `LICENSE_PRODUCT_IDS` | Phân gói tính năng — [03-tuy-chon/01](../03-tuy-chon/01-license-branding.md). Không đặt gì → mọi tính năng bật | TÙY CHỌN |
| `APP_VERSION`, `RELEASE_SOURCE_URL`, `UPDATE_WEBHOOK_URL`, `UPDATE_WEBHOOK_TOKEN` | Kiểm tra & kích hoạt cập nhật phiên bản — [03-tuy-chon/05](../03-tuy-chon/05-migration-self-update.md) | TÙY CHỌN |

### 3.1 Quy tắc chọn thông tin xác thực Cloudflare
```
if CF_TOKEN có giá trị                 → Authorization: Bearer <CF_TOKEN>
elif CF_API_KEY và CF_EMAIL đều có     → X-Auth-Email: <CF_EMAIL>, X-Auth-Key: <CF_API_KEY>
elif CF_API_KEY có nhưng thiếu CF_EMAIL → lỗi "CF_EMAIL is required when using CF_API_KEY"
else                                   → lỗi "CF_TOKEN or CF_API_KEY is not configured"
```
Khi có cả hai phương thức, `CF_TOKEN` luôn thắng; cặp `CF_EMAIL` + `CF_API_KEY` bị bỏ qua. "Có thông tin xác thực Cloudflare" nghĩa là một trong hai nhánh đầu đúng.

## 4. Handler của Worker

```ts
export default {
  fetch(request, env, ctx)        // HTTP + WebSocket
  email(message, env, ctx)        // Email Routing
  queue(batch, env)               // INBOUND_QUEUE + OUTBOUND_QUEUE
  scheduled(controller, env, ctx) // cron
}
export class RealtimeHub extends DurableObject { ... }   // xem 02-nang-cao/04-realtime.md
```

### 4.1 `fetch`
| Đường dẫn | Xử lý |
|---|---|
| `/api/realtime` | Yêu cầu `Upgrade: websocket` (không → **426**). Lấy token từ cookie `ep_session`, tra user; không có hoặc disabled → **401**. Lấy stub bằng `env.REALTIME.getByName` với khoá `user.id` rồi chuyển tiếp request tới `https://…/connect` của stub đó. |
| `/api/*` | REST API: router + middleware (xác thực session, xác thực API key, giới hạn body, kiểm tra `Origin`, ánh xạ lỗi theo [06-quy-uoc-chung.md §3](06-quy-uoc-chung.md)). |
| `/jmap/*`, `/.well-known/jmap` | JMAP (tùy chọn). |
| Còn lại | Static assets của SPA qua `ASSETS`, fallback `index.html`. |

### 4.2 `email` — xem [01-co-ban/06-nhan-thu.md](../01-co-ban/06-nhan-thu.md)
Không bao giờ parse MIME ở đây (giới hạn CPU/thời gian của email handler). Mọi lỗi → gọi `message.setReject` với lý do `"Processing failed"`.

### 4.3 `queue` — một consumer, phân loại theo payload
```ts
for (const msg of batch.messages) {
  try {
    if (LA_THU_DEN(msg.body))            await XU_LY_THU_DEN(env, msg.body);       // có rawR2Key, from, to
    else if (LA_RETRY_WEBHOOK(msg.body)) await XU_LY_RETRY_WEBHOOK(env, msg.body); // kind === "webhook.retry" && deliveryId
    else                               await XU_LY_GUI_HEN_GIO(env, msg.body);   // kind === "email.scheduled"
    msg.ack();
  } catch { msg.retry({ delaySeconds: 10 }); }
}
```
- `LA_THU_DEN(body)`: body là object có `rawR2Key`, `from`, `to` kiểu string.
- `LA_RETRY_WEBHOOK(body)`: `body.kind === "webhook.retry"` và có `deliveryId`.
- `XU_LY_THU_DEN` — [01-co-ban/06-nhan-thu.md](../01-co-ban/06-nhan-thu.md); `XU_LY_RETRY_WEBHOOK` — [02-nang-cao/12-webhook.md](../02-nang-cao/12-webhook.md); `XU_LY_GUI_HEN_GIO` — [02-nang-cao/05-hen-gio-gui.md](../02-nang-cao/05-hen-gio-gui.md).

Queue là **at-least-once** → mọi consumer phải idempotent (xem từng file chức năng).

### 4.4 `scheduled`
Handler phân biệt theo `controller.cron` và chạy mỗi việc qua `ctx.waitUntil`, **độc lập** (lỗi của việc này không chặn việc kia), theo lô với ngân sách thời gian; phần còn lại để lần chạy sau.

| Trigger | Việc |
|---|---|
| `0 2 * * *` | Toàn bộ danh sách dọn dẹp & lưu giữ ở [05-van-hanh/01 §4](../05-van-hanh/01-bay-va-cai-thien.md) (session, token, challenge, auto-reply, Trash/Spam, audit, upload JMAP, webhook deliveries, backup kẹt) và backup định kỳ [TÙY CHỌN] với thời điểm `new Date(controller.scheduledTime)` — [03-tuy-chon/04-backup.md](../03-tuy-chon/04-backup.md) |
| `*/5 * * * *` | Đánh thức thư hết snooze — [02-nang-cao/06-snooze.md](../02-nang-cao/06-snooze.md) |

> **Quyết định thiết kế** — thời hạn tự xoá Trash/Spam: mặc định **30 ngày** (`TRASH_RETENTION_DAYS`). Phương án thay thế: không tự xoá (`TRASH_RETENTION_DAYS=0`, chỉ xoá vĩnh viễn thủ công).

## 5. Tổ chức mã đề xuất (không bắt buộc)

```
worker/
  index        // export default {fetch, email, queue, scheduled}; export RealtimeHub
  http/        // router + middleware (auth session, auth api-key, body limit, Origin check, error mapping)
  email/       // email handler, inbound consumer, send, threading, parse
  domain/      // domains, mailboxes, access control
  integrations/// cloudflare-api client, webhooks, jmap
  db/          // schema + migration SQL
web/           // SPA build ra static assets
```

Nguyên tắc:
- Mọi truy cập binding đi qua một đối tượng `env` duy nhất được truyền vào từ handler.
- Tách **hàm thuần** (parse, match rule, tính quyền, build query) khỏi I/O để test đơn vị mà không cần binding.
- Logic nghiệp vụ không phụ thuộc thư viện router HTTP; JMAP handler nhận `Request` và trả `Response` thuần.
