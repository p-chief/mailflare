# Trả lời tự động (Auto-reply / Out of office)

> **[NÂNG CAO]** · Phụ thuộc: [01-co-ban/06-nhan-thu.md](../01-co-ban/06-nhan-thu.md) (bước gửi auto-reply của consumer), [01-co-ban/11-gui-thu.md](../01-co-ban/11-gui-thu.md) · Liên quan: [01-co-ban/13-hoi-thoai.md](../01-co-ban/13-hoi-thoai.md)

## 1. Mục tiêu
Tự động gửi một thư phản hồi cố định cho người gửi khi mailbox bật chế độ vắng mặt, **không** tạo vòng lặp thư và **không** spam người gửi.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Cấu hình theo mailbox (bật/tắt, tiêu đề, nội dung text) | Lịch bật/tắt tự động theo ngày |
| Chống vòng lặp, chống gửi lặp trong 24 h | Nội dung HTML, trả lời khác nhau theo người gửi |
| Auto-reply nằm trong cùng hội thoại với thư đến | |

## 3. Quyền
Sửa cấu hình: `canManage` (`full_access`) trên mailbox. Auto-reply được gửi **nhân danh owner mailbox**, không phụ thuộc người đang đăng nhập.

## 4. Cấu hình
Trên `mailboxes`: `auto_reply_enabled`, `auto_reply_subject` (mặc định "Out of office"), `auto_reply_body`. Sửa qua `PATCH /api/mailboxes/{id}` — xem [05-quan-ly-mailbox.md](../01-co-ban/05-quan-ly-mailbox.md).
- Bật (`autoReplyEnabled: true`) mà body sau trim rỗng → 400 "Enter an auto-reply message before enabling it."
- `auto_reply_subject` trim ≤ 200; `auto_reply_body` ≤ 10 000 ký tự.

UI (Settings → Inbox → Automatic response): switch "Enable auto-reply for {address}" — "Each sender receives at most one automatic response every 24 hours."; ô Subject, ô Message; bật mà body rỗng → "Enter an auto-reply message before enabling it."; user không có `full_access` không thấy mục này.

## 5. Điều kiện gửi — thủ tục `GUI_TRA_LOI_TU_DONG(mailbox, thưĐến)`
Consumer nhận thư chỉ gọi khi thư được lưu với `status = 'received'` (thư vào Spam/Trash không được trả lời). Chuẩn hoá: `recipient = DIA_CHI(from)` — địa chỉ thuần, lowercase ([01-rule-mailbox.md §6](01-rule-mailbox.md)), lấy từ header From, fallback envelope from.

Bỏ qua (không gửi) nếu **bất kỳ** điều kiện nào:
1. `recipient` không chứa `@`.
2. `recipient == DIA_CHI(deliveredAddress)` (tự gửi cho mình).
3. Local-part người gửi khớp `^(mailer-daemon|postmaster|no-?reply|do-?not-?reply)$` (không phân biệt hoa thường).
4. Header `Auto-Submitted` có mặt với giá trị khác `no`.
5. Header `Precedence` là `bulk`, `junk` hoặc `list`.
6. Có một trong các header: `List-Id`, `X-Autoreply`, `X-Autorespond`, `X-Auto-Response-Suppress`.
7. Người gửi là **chính mailbox này**: thủ tục phân giải địa chỉ nhận ([06-nhan-thu.md §4](../01-co-ban/06-nhan-thu.md)) với `recipient` trả về mailbox có id = `mailbox.id`.
8. Mailbox chưa bật auto-reply hoặc body trim rỗng.
9. Đã có `auto_reply_deliveries(mailbox_id, recipient)` với `sent_at ≥ now − 24h`.

`deliveredAddress` = địa chỉ envelope to của thư đến (địa chỉ thực sự nhận — có thể là alias hoặc địa chỉ trên domain phụ).

## 6. Gửi
```
headers = { "Auto-Submitted": "auto-replied", "X-Auto-Response-Suppress": "All" }
nếu thư đến có Message-ID m: headers["In-Reply-To"] = headers["References"] = m
thủ tục gửi thư (11-gui-thu §4.3) với:
   { userId: owner mailbox, mailboxId: mailbox.id,
     from: định dạng(deliveredAddress, mailbox.displayName),
     to: recipient, subject: trim(auto_reply_subject) || "Out of office", text: trim(auto_reply_body),
     inReplyTo: m, references: [m], threadId: thưĐến.threadId, headers }
UPSERT auto_reply_deliveries(mailbox_id, recipient) SET sent_at = now     // UNIQUE(mailbox_id, recipient)
```
- Gửi từ **đúng địa chỉ đã nhận** (alias/domain phụ cũng vậy); bỏ qua kiểm tra quyền gửi của actor (hệ thống gửi thay owner) nhưng địa chỉ vẫn phải thuộc tập địa chỉ của mailbox.
- `threadId` = `thread_id` của thư đến vừa lưu → auto-reply hiện trong cùng hội thoại ở Sent và ở chế độ conversation view.
- Đi qua thủ tục gửi thư đầy đủ → có bản trong Sent, upsert liên hệ, webhook `message.outbound`, audit.
- Ghi `auto_reply_deliveries` **sau** khi gửi thành công; gửi lỗi → không ghi (lần thư sau sẽ thử lại).
- Lỗi chỉ log, không ảnh hưởng việc lưu thư đến và không làm consumer retry.

## 7. Lỗi & biên
| Tình huống | Kết quả |
|---|---|
| Queue giao lại cùng thư đến | Consumer dừng ở bước idempotency trước khi tới đây → không gửi lần 2 |
| Hai thư cùng người gửi xử lý đồng thời | Có thể gửi 2 auto-reply (chấp nhận được); UPSERT không lỗi |
| Domain không bật gửi thư | Gửi lỗi → log, thư đến vẫn lưu |

## 8. Tiêu chí chấp nhận
- [ ] Bật auto-reply, A gửi 2 thư trong 1 giờ → A nhận đúng 1 auto-reply.
- [ ] Sau 24 h, A gửi thư mới → nhận auto-reply lần nữa.
- [ ] Thư từ `noreply@…` hoặc có `List-Id` → không auto-reply.
- [ ] Hai mailbox cùng bật auto-reply gửi cho nhau → không vòng lặp (header `Auto-Submitted`).
- [ ] Thư vào Spam → không auto-reply.
- [ ] Auto-reply có `In-Reply-To` = Message-ID thư đến và cùng `thread_id` với thư đến.
- [ ] Thư tới alias `sales@b.com` → auto-reply gửi từ `sales@b.com`.
