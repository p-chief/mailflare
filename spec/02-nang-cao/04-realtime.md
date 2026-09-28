# Thông báo thời gian thực (Durable Object WebSocket)

> **[NÂNG CAO]** · MVP thay thế: polling 15 s · Phụ thuộc: [01-co-ban/06-nhan-thu.md](../01-co-ban/06-nhan-thu.md)

## 1. Mục tiêu
Báo ngay cho các trình duyệt đang mở khi có thư mới, để làm mới danh sách/số đếm và hiện popup — không phải chờ polling.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Sự kiện `new_message` cho thư đến không phải spam | Sự kiện cho thay đổi trạng thái, thư gửi đi |
| Kết nối WS theo user, heartbeat, reconnect | Web Push khi tab đóng |
| Popup trong app, Notification trình duyệt (nếu đã được cấp quyền) | Xin quyền Notification (chưa có) |

## 3. Kiến trúc
```
Browser ──WS /api/realtime──► Worker.fetch ──(xác thực cookie)──► REALTIME.getByName(userId).fetch("/connect")
                                                                      │  DO RealtimeHub (1 instance / user)
Consumer (thư mới) ──► REALTIME.getByName(uid).fetch("/notify", POST json) ──► broadcast tới mọi socket
```
- Mỗi user một Durable Object (tên = userId). Dùng **WebSocket Hibernation API** (`ctx.acceptWebSocket`, `ctx.getWebSockets()`, `webSocketMessage`) để DO ngủ khi không có tin.
- Wrangler: `durable_objects.bindings [{name:"REALTIME", class_name:"RealtimeHub"}]`, `migrations [{tag:"v1", new_sqlite_classes:["RealtimeHub"]}]`.

## 4. RealtimeHub
| Đường dẫn | Hành vi |
|---|---|
| `/connect` | Cần `Upgrade: websocket` (không → 426); tạo `WebSocketPair`, `acceptWebSocket(server)`, trả 101 |
| `/notify` (POST) | Đọc JSON, `send` tới mọi socket; lỗi → `socket.close(1011, "Delivery failed")`; trả 204 |
| khác | 404 |
| `webSocketMessage` | nhận `"ping"` → gửi `"pong"` |

## 5. Ai được thông báo — `getMailboxNotificationUserIds(mailboxId, ownerUserId)`
Tập hợp (loại trùng): owner mailbox · **chủ domain** của mailbox · (nếu mailbox `shared` và bật chia sẻ) mọi user trong `mailbox_access`.
Gửi song song, `allSettled` (lỗi một DO không ảnh hưởng người khác).

Payload:
```json
{ "type":"new_message", "messageId":"msg_…", "mailboxId":"mbx_…",
  "from":"\"Maya\" <maya@x.com>", "fromName":"Maya|null", "subject":"…|null" }
```
Không gửi cho thư có `status = spam`.

> Chú ý: chủ domain được thông báo nhưng **không** đọc được thư (không có quyền mailbox) — popup sẽ dẫn tới 404. Nên chỉ thông báo cho user có `canRead`.

## 6. Client
- Kết nối `ws(s)://<host>/api/realtime` khi có phiên. Mở → reset bộ đếm reconnect, heartbeat `"ping"` mỗi **25 s**.
- Nhận tin: bỏ `"pong"`/không phải chuỗi; parse `new_message` → phát `mailflare:messages-changed` (làm mới danh sách + đếm), hiện popup, và `Notification` nếu quyền đã `granted` **và** tab đang ẩn (title = subject hoặc "New email", body "From …", tag = messageId, click → `/inbox/<id>`).
- Lỗi → đóng socket; đóng → reconnect sau `min(1000·2^attempt, 30 000)` ms; trong lúc mất kết nối, fallback phát làm mới mỗi **60 s**.
- Đổi phiên → đóng (1000 "Session changed") và kết nối lại.
- Popup: "New email", subject hoặc "(no subject)", "From <tên>", click → mở thư, tự ẩn sau **8 s**.
- Độc lập với realtime, danh sách và số đếm **vẫn polling 15 s**.

## 7. Tiêu chí chấp nhận
- [ ] Mở 2 tab cùng user → thư mới đến → cả 2 tab làm mới trong ≤ 1–2 s.
- [ ] User B được chia sẻ shared mailbox nhận thông báo cho thư vào mailbox đó.
- [ ] Thư bị đánh spam → không có thông báo.
- [ ] Ngắt mạng rồi nối lại → tự reconnect.
- [ ] Không có cookie hợp lệ → handshake 401.
