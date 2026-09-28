# Kiến trúc runtime trên Cloudflare (không dùng Next.js)

> Thuộc nhóm: Nền tảng · Liên quan: [06-quy-uoc-chung.md](06-quy-uoc-chung.md), [07-cloudflare-api.md](07-cloudflare-api.md)

## 1. Bindings

| Binding | Loại | Dùng cho | Nhãn |
|---|---|---|---|
| `DB` | D1 | Dữ liệu quan hệ + FTS5 | CƠ BẢN |
| `BUCKET` | R2 | Raw MIME, attachment, avatar, backup | CƠ BẢN |
| `EMAIL` | `send_email` (`remote: true`) | Gửi thư | CƠ BẢN |
| `INBOUND_QUEUE` | Queue (producer + consumer) | Xử lý thư đến | CƠ BẢN |
| `LOGIN_RATE_LIMIT` | Rate limiting `simple: {limit: 20, period: 60}` | Đăng nhập, xác minh MFA | CƠ BẢN |
| `ASSETS` | Static assets | Phục vụ SPA | CƠ BẢN (tuỳ cách build UI) |
| `OUTBOUND_QUEUE` | Queue (producer + consumer) | Hẹn giờ gửi **và** retry webhook (chung 1 queue) | NÂNG CAO |
| `REALTIME` | Durable Object, class `RealtimeHub` (migration `new_sqlite_classes`) | WebSocket thông báo | NÂNG CAO |
| Cron `0 2 * * *` | Trigger | Backup định kỳ | TÙY CHỌN |
| `IMAGES`, `WORKER_SELF_REFERENCE` | | Chỉ phục vụ OpenNext/Next.js | **Bỏ** |

Consumer của cả hai queue: `max_batch_size: 5`, `max_retries: 3`.

Compatibility flags: `nodejs_compat`, `global_fetch_strictly_public` (fetch ra ngoài không được gọi địa chỉ nội bộ — quan trọng cho webhook và IMAP import).

`observability.enabled: true`, `upload_source_maps: true` (khuyến nghị giữ).

## 2. Secrets / biến môi trường

| Tên | Ý nghĩa | Nhãn |
|---|---|---|
| `CF_TOKEN` | API token Cloudflare. Quyền cần: Zone:Read, DNS:Edit, Email Routing Rules/Addresses:Edit, Zone Settings (Email Routing), Email Sending:Edit | CƠ BẢN |
| `CF_EMAIL` + `CF_API_KEY` | Global API key (cũ). Code hiện tại **ưu tiên** cặp này nếu có cả hai | Thay thế |
| `TURNSTILE_SECRET_KEY` | Bật captcha cho login/register | TÙY CHỌN |
| `GITHUB_UPDATE_TOKEN/REF/REPO` | Self-update | TÙY CHỌN |
| `INBOUND_WEBHOOK_SECRET`, `CF_ACCOUNT_ID`, `APP_URL`, `MAILFLARE_RUNTIME` | Runtime Node tự host | TÙY CHỌN |

**Tên Email Worker** (`getEmailWorkerName()` = `"mailflare"`, đang hard-code) phải trùng tên Worker đã deploy vì mọi rule Email Routing trỏ `{"type":"worker","value":["<tên>"]}`. Khi viết lại: đưa vào biến cấu hình (ví dụ `EMAIL_WORKER_NAME`).

## 3. Handler của Worker

```ts
export default {
  fetch(request, env, ctx)       // HTTP + WebSocket
  email(message, env, ctx)       // Email Routing
  queue(batch, env)              // INBOUND_QUEUE + OUTBOUND_QUEUE
  scheduled(controller, env, ctx) // cron
}
export class RealtimeHub extends DurableObject { ... }
```

### 3.1 `fetch`
| Đường dẫn | Xử lý |
|---|---|
| `/api/realtime` | Yêu cầu `Upgrade: websocket` (không → **426**). Lấy token từ cookie `ep_session`, tra user; không có hoặc disabled → **401**. Chuyển tiếp tới `env.REALTIME.getByName(user.id).fetch("https://…/connect", request)`. |
| `/api/*` | REST API (router tuỳ chọn: Hono, itty-router…). |
| `/jmap/*`, `/.well-known/jmap` | JMAP (tùy chọn). |
| Còn lại | Static assets của SPA, fallback `index.html`. |

### 3.2 `email` — xem [01-co-ban/06-nhan-thu.md](../01-co-ban/06-nhan-thu.md)
Không bao giờ parse MIME ở đây. Mọi lỗi → `message.setReject("Processing failed")`.

### 3.3 `queue` — một consumer, phân loại theo payload
```ts
for (const msg of batch.messages) {
  try {
    if (isInbound(msg.body))            await processInboundMessage(env, msg.body);   // có rawR2Key, from, to
    else if (isWebhookRetry(msg.body))  await processWebhookRetry(env, msg.body);     // kind === "webhook.retry" && deliveryId
    else                                await processOutboundQueue(env, msg.body);    // kind === "email.scheduled"
    msg.ack();
  } catch { msg.retry({ delaySeconds: 10 }); }
}
```
Queue là **at-least-once** → mọi consumer phải idempotent (xem từng file chức năng).

### 3.4 `scheduled`
`ctx.waitUntil(runScheduledDatabaseBackup(env, new Date(controller.scheduledTime)))`. Khi viết lại nên dùng thêm cron này cho dọn dẹp (session hết hạn, token, Trash cũ… — xem [05-van-hanh/01-bay-va-cai-thien.md](../05-van-hanh/01-bay-va-cai-thien.md)).

## 4. Tổ chức mã đề xuất (không bắt buộc)

```
worker/
  index.ts            // export default {fetch, email, queue, scheduled}; export RealtimeHub
  http/               // router + middleware (auth session, auth api-key, body limit, error mapping)
  email/              // email handler, inbound consumer, send, threading, parse
  domain/             // domains, mailboxes, access control
  integrations/       // cloudflare-api client, webhooks, jmap
  db/                 // schema + migrations (drizzle hoặc SQL thuần)
web/                  // SPA (React/Vue/Svelte…) build ra static assets
```

Nguyên tắc giữ lại từ bản gốc:
- Mọi truy cập binding đi qua một đối tượng `env` duy nhất — không import ngữ cảnh framework.
- Tách **hàm thuần** (parse, match rule, tính quyền, build query) khỏi I/O để test bằng `node:test` không cần binding.
- Logic nghiệp vụ không phụ thuộc HTTP framework (JMAP handler hiện đã "framework-free").
