# Thông báo thời gian thực (Durable Object WebSocket)

> **[NÂNG CAO]** · Phương án tối thiểu thay thế: polling 15 s · Phụ thuộc: [01-co-ban/06-nhan-thu.md](../01-co-ban/06-nhan-thu.md), [00-nen-tang/05-phan-quyen.md](../00-nen-tang/05-phan-quyen.md) · Liên quan: [06-snooze.md](06-snooze.md), [16-da-nguoi-dung-shared-mailbox.md](16-da-nguoi-dung-shared-mailbox.md)

## 1. Mục tiêu
Báo ngay cho các trình duyệt đang mở khi có thư mới, để làm mới danh sách/số đếm và hiện popup — không phải chờ polling.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Sự kiện `new_message` cho thư đến không phải spam | Sự kiện cho mọi thay đổi trạng thái, thư gửi đi |
| Sự kiện `snooze_expired` ([NÂNG CAO], [06-snooze.md §6](06-snooze.md)) | Web Push khi mọi tab đã đóng |
| Kết nối WS theo user, heartbeat, reconnect | Đồng bộ trạng thái đọc giữa các tab qua WS |
| Popup trong app, Notification trình duyệt, lời mời bật Notification | |

## 3. Kiến trúc
```
Browser ──WS /api/realtime──► Worker.fetch ──(xác thực cookie ep_session)──► REALTIME.getByName(userId) → "/connect"
                                                                               │  DO RealtimeHub (1 instance / user)
Consumer (thư mới) ──► REALTIME.getByName(uid) → "/notify" (POST json) ──► broadcast tới mọi socket của user
```
- Mỗi user một Durable Object (tên = userId). Dùng **WebSocket Hibernation API** của Durable Objects (chấp nhận socket qua `ctx.acceptWebSocket`, liệt kê qua `ctx.getWebSockets()`, nhận tin qua handler `webSocketMessage`) để DO ngủ khi không có tin.
- Cấu hình Wrangler: `durable_objects.bindings [{name:"REALTIME", class_name:"RealtimeHub"}]`, `migrations [{tag:"v1", new_sqlite_classes:["RealtimeHub"]}]`.
- Handshake tại Worker: thiếu `Upgrade: websocket` → 426; cookie không hợp lệ / user disabled → 401 (xem [00-nen-tang/02-kien-truc-cloudflare.md](../00-nen-tang/02-kien-truc-cloudflare.md)).

## 4. RealtimeHub
| Đường dẫn | Hành vi |
|---|---|
| `/connect` | Cần `Upgrade: websocket` (không → 426); tạo cặp WebSocket, chấp nhận đầu server bằng Hibernation API, trả 101 với đầu client |
| `/notify` (POST) | Đọc JSON, gửi chuỗi JSON tới mọi socket đang mở; gửi lỗi trên socket nào → đóng socket đó với mã `1011` "Delivery failed"; trả 204 |
| khác | 404 |
| tin nhắn đến từ socket | `"ping"` → trả `"pong"`; tin khác bỏ qua |

`/notify` chỉ được gọi nội bộ qua binding (không có route công khai tới nó).

## 5. Ai được thông báo — thủ tục `NGUOI_NHAN_THONG_BAO(mailboxId)`
**Chỉ những user có `canRead` trên mailbox** (cùng quy tắc với kiểm tra quyền mailbox ở [05-phan-quyen.md §4](../00-nen-tang/05-phan-quyen.md)):
```
mailbox = mailboxes WHERE id; không có hoặc disabled → []
ids = { mailbox.user_id }                                          // owner
nếu mailbox.type == 'shared' && chia sẻ mailbox đang bật:
    ids ∪= mailbox_access.user_id WHERE mailbox_id = ?             // mọi mức quyền ≥ read_only
loại user disabled; loại trùng
```
Chủ domain hay admin **không** có quyền đọc mailbox thì **không** được thông báo (popup của họ sẽ dẫn tới 404).
Gửi song song tới DO của từng user, chờ tất cả xong theo kiểu "settled" — lỗi ở một DO không ảnh hưởng người khác và không làm lỗi consumer.

### 5.1 Payload
```json
{ "type":"new_message", "messageId":"msg_…", "mailboxId":"mbx_…",
  "from":"\"Maya\" <maya@x.com>", "fromName":"Maya|null", "subject":"…|null" }
```
- Không gửi cho thư có `status = spam`. Thư vào Trash do rule vẫn được gửi.
- `fromName` = tên liên hệ trong danh bạ owner (nếu có), ngược lại null.

```json
{ "type":"snooze_expired", "messageId":"msg_…", "mailboxId":"mbx_…", "subject":"…|null" }
```
Gửi khi cron đánh thức thư snooze ([06-snooze.md §6](06-snooze.md)).

## 6. Client
- Kết nối `ws(s)://<host>/api/realtime` khi có phiên. Mở → reset bộ đếm reconnect, heartbeat `"ping"` mỗi **25 s**.
- Nhận tin: bỏ `"pong"` và tin không phải chuỗi; parse JSON, bỏ qua `type` lạ.
  - `new_message` → phát sự kiện `app:messages-changed` (làm mới danh sách + đếm), hiện popup, và Notification trình duyệt nếu quyền đã `granted` **và** tab đang ẩn (title = subject hoặc "New email", body "From …", tag = messageId, click → focus tab và mở `/inbox/<id>`).
  - `snooze_expired` → chỉ phát `app:messages-changed` (không popup, không Notification).
- Lỗi → đóng socket; đóng → reconnect sau `min(1000·2^attempt, 30 000)` ms; trong lúc mất kết nối, fallback phát làm mới mỗi **60 s**.
- Đổi phiên (đăng xuất/đăng nhập user khác) → đóng (1000 "Session changed") và kết nối lại.
- Popup: "New email", subject hoặc "(no subject)", "From <tên>", click → mở thư, tự ẩn sau **8 s**.
- Độc lập với realtime, danh sách và số đếm **vẫn polling 15 s** (lưới an toàn khi WS không tới được).

### 6.1 Lời mời bật Notification trình duyệt
- Khi quyền Notification đang `default` (chưa hỏi), hiện một banner nhỏ có thể đóng ở đầu danh sách thư: "Get notified about new email" với nút "Enable notifications" và "Not now".
- Chỉ gọi yêu cầu quyền của trình duyệt **khi người dùng bấm** "Enable notifications" (trình duyệt chặn yêu cầu không do thao tác người dùng).
- "Not now" → ẩn banner, ghi nhớ theo trình duyệt (`localStorage` key `app-notification-prompt-dismissed`, bọc try/catch); quyền `denied` hoặc trình duyệt không hỗ trợ Notification → không hiện banner.
- Settings → Notifications có nút tương đương và hiển thị trạng thái hiện tại (Allowed / Blocked in browser settings / Not enabled).

## 7. Lỗi & biên
| Tình huống | Kết quả |
|---|---|
| DO không phản hồi / lỗi khi `/notify` | Log, bỏ qua; thư đã lưu, client thấy thư qua polling |
| Socket chết không đóng sạch | Lần gửi kế tiếp lỗi → socket bị đóng 1011; client reconnect theo backoff |
| User bị thu hồi quyền shared mailbox | Lần thông báo sau không còn gửi cho user đó |
| User bị disable khi đang kết nối | Không nhận thông báo mới; lần reconnect bị 401 |

## 8. Tiêu chí chấp nhận
- [ ] Mở 2 tab cùng user → thư mới đến → cả 2 tab làm mới trong ≤ 1–2 s.
- [ ] User B được chia sẻ shared mailbox (kể cả `read_only`) nhận thông báo cho thư vào mailbox đó.
- [ ] Chủ domain không có quyền trên mailbox của user khác → không nhận thông báo cho thư của mailbox đó.
- [ ] Thư bị đánh spam → không có thông báo.
- [ ] Ngắt mạng rồi nối lại → tự reconnect.
- [ ] Không có cookie hợp lệ → handshake 401.
- [ ] Quyền Notification `default` → banner hiện; bấm "Enable notifications" mới hiện hộp thoại xin quyền của trình duyệt; "Not now" → không hiện lại.
