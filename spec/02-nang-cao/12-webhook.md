# Webhook

> **[NÂNG CAO]** · Retry dùng chung `OUTBOUND_QUEUE` · Liên quan: [01-co-ban/06-nhan-thu.md](../01-co-ban/06-nhan-thu.md), [01-co-ban/11-gui-thu.md](../01-co-ban/11-gui-thu.md)

## 1. Mục tiêu
Gửi sự kiện thư (nhận, gửi, gửi lỗi) tới endpoint HTTP của người dùng, có chữ ký HMAC, ghi lại mọi lần thử và tự retry với backoff.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| 3 loại sự kiện | Sự kiện đổi trạng thái, đọc, bounce |
| Ký HMAC-SHA256, lịch sử delivery, retry tự động/thủ công, test | Kèm nội dung thư / attachment trong payload |
| Webhook theo user | Webhook theo mailbox (chưa có — shared mailbox phát cho owner) |

## 3. Sự kiện
| type | Phát khi | `data` |
|---|---|---|
| `message.inbound` | thư đến đã lưu (mọi status, kể cả spam/trash) | `{messageId, from, to (envelope), cc?, subject, threadId, spamScore?, spamVerdict?}` |
| `message.outbound` | gửi thành công | `{messageId, providerMessageId, to, cc?}` |
| `message.failed` | `EMAIL.send` lỗi | `{messageId, error}` |
Phát theo `userId`: inbound → owner mailbox; outbound/failed → người gửi.

## 4. Gửi (attempt)
```
body = JSON.stringify({ type, data })             // test: { type:"message.inbound", test:true, data:{…mẫu} }
delivery = INSERT webhook_deliveries { id: whd_…, webhookId, eventType, payload: body, status:'pending', attempts:0 }
attempt:
  attempts += 1; start = now
  POST hook.url, redirect: "manual", signal: timeout 10 s
     Content-Type: application/json
     X-Email-Platform-Signature: hex(HMAC_SHA256(hook.secret, body))
     X-Email-Platform-Event: <type>
     X-Email-Platform-Delivery: <deliveryId>
     X-Email-Platform-Attempt: <n>
  ok = 2xx; lỗi = text response (≤500) || "Endpoint responded with <status>" || message ngoại lệ
  status = ok ? 'delivered' : (attempts < hook.maxAttempts ? 'retrying' : 'exhausted')
  nextRetryAt = retrying ? now + delay(attempts) : null
  UPDATE delivery { status, attempts, responseStatus, error[:500], durationMs, lastAttemptAt, nextRetryAt }
  retrying → OUTBOUND_QUEUE.send({ kind:"webhook.retry", deliveryId }, { delaySeconds: delay(attempts) })
delay(n) = min(60 · 2^(n−1), 3600)    // 60, 120, 240, 480, 960, 1920, 3600…
```
- Redirect 3xx **không** được theo → tính là lỗi (không 2xx).
- Lần đầu chạy **đồng bộ** trong luồng nhận/gửi (tối đa 10 s mỗi hook) — khi viết lại nên đẩy lần đầu vào queue.
- Consumer retry: `runDelivery(deliveryId)` — delivery/hook không còn → bỏ qua. Không kiểm tra `enabled` khi retry (hook bị tắt vẫn retry nốt).
- Trạng thái `failed` có trong enum nhưng không được code set.

## 5. Xác minh phía nhận
```
expected = hex(HMAC_SHA256(secret, rawBody))
so sánh constant-time với header X-Email-Platform-Signature
```
Chống replay: dùng `X-Email-Platform-Delivery` làm khoá idempotency (payload không có timestamp).

## 6. API (session; chỉ webhook của chính user — khác → 404 "Webhook not found")
| Method | Path | Mô tả |
|---|---|---|
| GET | `/api/webhooks` | `{webhooks:[{id,url,description,events,enabled,maxAttempts,createdAt,stats:{total,delivered,failing,pending,lastAttemptAt}}]}` — `failing = failed+exhausted`, `pending = pending+retrying` |
| POST | `/api/webhooks` | `{url (≤2048), description? (≤200), events (1–3), maxAttempts 1–10 = 5}` → `{id, url, secret, events}` — **secret chỉ trả 1 lần** |
| GET | `/api/webhooks/{id}` | chi tiết (không secret) |
| PATCH | `/api/webhooks/{id}` | `url?, description? (null/"" → null), events?, enabled?, maxAttempts?`; không có gì → 400 "No changes provided" |
| DELETE | `/api/webhooks/{id}` | xoá (delivery cascade) |
| GET | `/api/webhooks/{id}/deliveries?limit=25&status=` | tối đa 100; lọc status **sau** limit; `payload` cắt 2000 ký tự; kèm `maxAttempts` |
| POST | `/api/webhooks/{id}/deliveries/{deliveryId}/retry` | chạy lại ngay 1 attempt → `{status}` |
| POST | `/api/webhooks/{id}/test` | tạo delivery thử → `{deliveryId, status}` |
Body ≤ 16 KB (tạo). Secret: `whsec_<nanoid>`, lưu plain.

## 7. UI
Trang admin `/webhooks`: thẻ mỗi endpoint (URL, mô tả, sự kiện, switch bật, số liệu Deliveries/Delivered/In flight/Failed/Max attempts, "Delivery history", "Test", "Delete"). Dialog thêm: URL, mô tả, 3 sự kiện (mặc định chọn hết), max attempts; sau khi tạo hiện secret một lần với hướng dẫn xác minh. Bảng delivery làm mới 15 s, nút Retry cho dòng chưa delivered.

## 8. Tiêu chí chấp nhận
- [ ] Endpoint trả 200 → delivery `delivered`, attempts 1.
- [ ] Endpoint trả 500 → `retrying`, lần thử sau ~60 s, rồi 120 s…; sau `maxAttempts` → `exhausted`.
- [ ] Chữ ký xác minh được bằng secret đã cấp.
- [ ] Hook tắt → sự kiện mới không tạo delivery.
- [ ] User khác không xem được webhook/delivery của mình.
