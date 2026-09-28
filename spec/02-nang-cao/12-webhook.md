# Webhook

> **[NÂNG CAO]** · Phụ thuộc: `OUTBOUND_QUEUE` (dùng chung cho mọi lần gửi webhook) · Liên quan: [01-co-ban/06-nhan-thu.md](../01-co-ban/06-nhan-thu.md), [01-co-ban/11-gui-thu.md](../01-co-ban/11-gui-thu.md), [00-nen-tang/02-kien-truc-cloudflare.md](../00-nen-tang/02-kien-truc-cloudflare.md)

## 1. Mục tiêu
Gửi sự kiện thư (nhận, gửi, gửi lỗi) tới endpoint HTTP của người dùng, có chữ ký HMAC kèm timestamp, ghi lại mọi lần thử và tự retry với backoff — không bao giờ làm chậm luồng nhận/gửi thư.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| 3 loại sự kiện | Sự kiện đổi trạng thái, đọc, bounce |
| Ký HMAC-SHA256, lịch sử delivery, retry tự động/thủ công, test | Kèm nội dung thư / attachment trong payload |
| Webhook theo user | Webhook theo mailbox (sự kiện của shared mailbox phát cho owner) |

## 3. Dữ liệu
- `webhooks`: `id` `wh_…`, `user_id`, `description`, `url`, `secret` (`whsec_<nanoid>`, lưu dạng rõ vì cần để ký), `events` JSON, `enabled`, `max_attempts` (mặc định 5), `created_at`.
- `webhook_deliveries`: `id` `whd_…`, `webhook_id` (CASCADE), `event_type`, `payload` (body JSON gửi đi), `status`, `attempts`, `response_status`, `error` (≤500), `duration_ms`, `last_attempt_at`, `next_retry_at`, `created_at`.

### 3.1 Trạng thái delivery
| status | Ý nghĩa | Kết thúc? |
|---|---|---|
| `pending` | đã tạo, đã (hoặc đang) đưa vào queue, chưa có lần thử nào | không |
| `retrying` | lần thử gần nhất lỗi, đã lên lịch thử lại | không |
| `delivered` | có một lần thử trả 2xx | có |
| `exhausted` | lỗi và `attempts ≥ max_attempts` | có |
| `failed` | dừng trước khi hết lượt vì webhook đã bị tắt (`enabled = false`) khi đến lượt thử tự động | có |

`delivered`, `exhausted`, `failed` là trạng thái kết thúc: consumer queue gặp chúng thì bỏ qua (ack). Chỉ thao tác thủ công (§6 retry) mới chạy tiếp được.

## 4. Sự kiện
| type | Phát khi | `data` |
|---|---|---|
| `message.inbound` | thư đến đã lưu (mọi status, kể cả spam/trash) | `{messageId, from, to (envelope), cc?, subject, threadId, spamScore?, spamVerdict?}` |
| `message.outbound` | gửi thành công | `{messageId, providerMessageId, to, cc?}` |
| `message.failed` | lệnh gửi qua binding `EMAIL` lỗi | `{messageId, error}` |

Người nhận sự kiện (`userId`): inbound → owner của mailbox; outbound/failed → người gửi.

## 5. Luồng

### 5.1 Phát sự kiện — `PHAT_SU_KIEN(userId, type, data)`
Chạy trong luồng nhận/gửi thư; **không** gọi HTTP.
```
hooks = webhooks WHERE user_id = userId AND enabled = 1 AND events chứa type
for hook in hooks:
   body = JSON.stringify({ type, data })
   delivery = INSERT webhook_deliveries { id: whd_…, webhookId: hook.id, eventType: type,
                                          payload: body, status: 'pending', attempts: 0 }
   OUTBOUND_QUEUE.send({ kind: "webhook.retry", deliveryId: delivery.id })
```
- Thông điệp queue `{kind: "webhook.retry", deliveryId}` dùng cho **mọi** lần thử, kể cả lần đầu; consumer phân biệt nó với thư gửi đi bằng `kind`.
- Lỗi khi tạo delivery hoặc enqueue → log lỗi, **không** làm hỏng luồng thư. Delivery kẹt ở `pending` vẫn hiện trong lịch sử và có thể Retry thủ công.

### 5.2 Consumer — `XU_LY_DELIVERY(deliveryId)`
```
delivery = webhook_deliveries WHERE id = deliveryId        → không có: ack, bỏ qua
delivery.status ∈ {delivered, exhausted, failed}           → ack, bỏ qua (queue giao lặp)
hook = webhooks WHERE id = delivery.webhook_id             → không có: ack, bỏ qua
!hook.enabled → UPDATE delivery SET status='failed', error='Webhook disabled', next_retry_at=NULL; ack
THU_GUI(delivery, hook, lenLich = true)
```

### 5.3 Một lần thử — `THU_GUI(delivery, hook, lenLich)`
```
attempts = delivery.attempts + 1; start = now
timestamp = floor(unix_seconds(now))
signature = hex(HMAC_SHA256(key = hook.secret, msg = timestamp + "." + delivery.payload))
POST hook.url, redirect: "manual", timeout 10 s, body = delivery.payload
   Content-Type: application/json
   X-Email-Platform-Signature: <signature>
   X-Email-Platform-Timestamp: <timestamp>
   X-Email-Platform-Event: <event_type>
   X-Email-Platform-Delivery: <deliveryId>
   X-Email-Platform-Attempt: <attempts>
ok    = status 2xx
error = ok ? null : (text response cắt 500 || "Endpoint responded with <status>" || thông điệp ngoại lệ/timeout)
if ok:                               status = 'delivered'
elif attempts >= hook.max_attempts:  status = 'exhausted'
elif lenLich && hook.enabled:        status = 'retrying'
else:                                status = 'exhausted'
nextRetryAt = status == 'retrying' ? now + delay(attempts) : null
UPDATE delivery { status, attempts, response_status, error[:500], duration_ms: now − start,
                  last_attempt_at: now, next_retry_at: nextRetryAt }
status == 'retrying' → OUTBOUND_QUEUE.send({ kind:"webhook.retry", deliveryId }, { delaySeconds: delay(attempts) })
return status

delay(n) = min(60 · 2^(n−1), 3600)      // 60, 120, 240, 480, 960, 1920, 3600…
```
- Redirect 3xx **không** được theo → tính là lỗi.
- Chữ ký và timestamp được tính lại ở **mỗi** lần thử; `payload` không đổi giữa các lần thử.
- Retry tự động chỉ diễn ra khi webhook đang bật: nếu webhook bị tắt giữa hai lần thử, lần thử kế tiếp lấy từ queue chuyển delivery sang `failed` (§5.2).
- Lỗi ném ra trong consumer (ví dụ D1 lỗi) → `retry({delaySeconds: 10})` theo quy ước chung của consumer.

## 6. API (session; chỉ webhook của chính user — khác → 404 "Webhook not found")
| Method | Path | Mô tả |
|---|---|---|
| GET | `/api/webhooks` | `{webhooks:[{id,url,description,events,enabled,maxAttempts,createdAt,stats:{total,delivered,failing,pending,lastAttemptAt}}]}` — `failing = failed + exhausted`, `pending = pending + retrying`; thống kê bằng một truy vấn `GROUP BY webhook_id` với `SUM(CASE…)` |
| POST | `/api/webhooks` | body ≤ 16 KB: `{url (URL http/https hợp lệ, ≤2048), description? (≤200), events (1–3 giá trị ở §4, không trùng), maxAttempts (1–10, mặc định 5)}` → `{id, url, secret, events}` — **secret chỉ trả một lần** |
| GET | `/api/webhooks/{id}` | chi tiết (không có secret) |
| PATCH | `/api/webhooks/{id}` | `url?, description? (null/"" → null), events?, enabled?, maxAttempts?`; body rỗng → 400 "No changes provided" |
| DELETE | `/api/webhooks/{id}` | xoá (delivery bị xoá theo cascade; thông điệp queue còn tồn sẽ tự bỏ qua) |
| GET | `/api/webhooks/{id}/deliveries?limit=25&status=` | `limit` 1–100 (mặc định 25); `status` lọc **trong truy vấn** trước khi áp `limit`; sắp `created_at DESC`; `payload` cắt 2000 ký tự; kèm `maxAttempts` |
| POST | `/api/webhooks/{id}/deliveries/{deliveryId}/retry` | delivery phải thuộc webhook (404 "Delivery not found"); `delivered` → 409 "Delivery already succeeded"; chạy ngay **một** lần thử đồng bộ trong request (`THU_GUI(…, lenLich = true)`) → `{status}` |
| POST | `/api/webhooks/{id}/test` | tạo delivery `{type:"message.inbound", test:true, data:{…dữ liệu mẫu}}` và chạy ngay một lần thử đồng bộ → `{deliveryId, status}` |

- Thao tác thủ công (retry, test) chạy được cả khi webhook đang tắt và cả khi delivery đã `exhausted`/`failed` (`attempts` vẫn tăng); sau lần thử thủ công lỗi, lịch retry tự động chỉ được đặt nếu còn lượt **và** webhook đang bật, nếu không delivery kết thúc ở `exhausted`.
- Nếu một lần thử thủ công thành công trong khi còn thông điệp queue đang chờ, consumer sẽ thấy `delivered` và bỏ qua.

## 7. Xác minh phía nhận
```
ts        = header X-Email-Platform-Timestamp (số nguyên giây Unix)
expected  = hex(HMAC_SHA256(secret, ts + "." + rawBody))      // rawBody: byte nguyên văn, chưa parse
hợp lệ    = expected == header X-Email-Platform-Signature   (so sánh constant-time)
            && |now − ts| ≤ 300 s
```
Chống replay và trùng lặp:
- Từ chối request có timestamp lệch quá 5 phút (chữ ký bao gồm timestamp nên không sửa được).
- Queue giao **ít nhất một lần** và retry thủ công gửi lại cùng delivery → dùng `X-Email-Platform-Delivery` làm khoá idempotency: đã xử lý delivery id đó thì trả 2xx mà không xử lý lại. Lưu các id đã thấy ít nhất 5 phút là đủ để chặn replay (ngoài cửa sổ đó timestamp đã bị từ chối); lưu lâu hơn nếu muốn chống xử lý trùng giữa các lần retry.

## 8. UI
Trang admin `/webhooks`: thẻ mỗi endpoint (URL, mô tả, sự kiện, switch bật, số liệu Deliveries/Delivered/In flight/Failed/Max attempts, "Delivery history", "Test", "Delete"). Dialog thêm: URL, mô tả, 3 sự kiện (mặc định chọn hết), max attempts; sau khi tạo hiện secret một lần kèm hướng dẫn xác minh (§7). Bảng delivery tự làm mới mỗi 15 s, nút Retry cho dòng chưa `delivered`.

## 9. Tiêu chí chấp nhận
- [ ] Nhận một thư khi endpoint chậm 10 s → thư được lưu và thông báo ngay; delivery được xử lý từ queue.
- [ ] Endpoint trả 200 → delivery `delivered`, attempts 1.
- [ ] Endpoint trả 500 → `retrying`, lần thử sau ~60 s, rồi 120 s…; sau `maxAttempts` → `exhausted`.
- [ ] Tắt webhook khi delivery đang `retrying` → lần thử kế tiếp không gửi HTTP, delivery `failed`.
- [ ] Chữ ký xác minh được bằng secret đã cấp với chuỗi `timestamp + "." + body`.
- [ ] Hook tắt → sự kiện mới không tạo delivery.
- [ ] Lọc `status=delivered&limit=5` trả đúng 5 dòng delivered gần nhất (nếu có đủ).
- [ ] User khác không xem được webhook/delivery của mình (404).
