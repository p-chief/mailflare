# Trả lời tự động (Auto-reply / Out of office)

> **[NÂNG CAO]** · Phụ thuộc: [01-co-ban/06-nhan-thu.md](../01-co-ban/06-nhan-thu.md) (bước 12), [01-co-ban/11-gui-thu.md](../01-co-ban/11-gui-thu.md)

## 1. Mục tiêu
Tự động gửi một thư phản hồi cố định cho người gửi khi mailbox bật chế độ vắng mặt, **không** tạo vòng lặp thư và **không** spam người gửi.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Cấu hình theo mailbox (bật/tắt, tiêu đề, nội dung text) | Lịch bật/tắt tự động theo ngày |
| Chống vòng lặp, chống gửi lặp 24 h | Nội dung HTML, trả lời khác nhau theo người gửi |

## 3. Cấu hình
Trên `mailboxes`: `auto_reply_enabled`, `auto_reply_subject` (mặc định "Out of office"), `auto_reply_body`. Sửa qua `PATCH /api/mailboxes/{id}` (canManage) — xem [05-quan-ly-mailbox.md](../01-co-ban/05-quan-ly-mailbox.md).

UI (Settings → Inbox → Automatic response): switch "Enable auto-reply for {address}" — "Each sender receives at most one automatic response every 24 hours."; bật mà body rỗng → "Enter an auto-reply message before enabling it."; cần full_access.

## 4. Điều kiện gửi — `sendMailboxAutoReply`
Chỉ gọi khi thư được lưu với `status = 'received'` (không cho spam/trash). Bỏ qua (không gửi) nếu **bất kỳ** điều kiện nào:
1. `recipient = normalize(from)` không chứa `@`.
2. `recipient == normalize(deliveredAddress)` (tự gửi cho mình).
3. Local-part người gửi khớp `^(mailer-daemon|postmaster|no-?reply|do-?not-?reply)$` (không phân biệt hoa thường).
4. Header `Auto-Submitted` có giá trị khác `no`.
5. Header `Precedence` là `bulk`, `junk` hoặc `list`.
6. Có một trong các header: `List-Id`, `X-Autoreply`, `X-Autorespond`, `X-Auto-Response-Suppress`.
7. Người gửi phân giải về **chính mailbox này** (`resolveInboundAddress(recipient).mailbox == mailboxId`).
8. Mailbox chưa bật hoặc body trim rỗng.
9. Đã gửi auto-reply cho `(mailbox, recipient)` với `sent_at ≥ now − 24h`.

## 5. Gửi
```
headers = { "Auto-Submitted": "auto-replied", "X-Auto-Response-Suppress": "All" }
nếu thư đến có Message-ID: headers["In-Reply-To"] = headers["References"] = messageId
sendEmail({ userId: owner, mailboxId, from: format(deliveredAddress, mailbox.displayName),
            to: recipient, subject: trim(subject) || "Out of office", text: trim(body), headers })
UPSERT auto_reply_deliveries(mailboxId, recipient) SET sent_at = now
```
- Gửi từ **đúng địa chỉ đã nhận** (alias/domain phụ cũng vậy).
- Đi qua `sendEmail` đầy đủ → có bản trong Sent, contact upsert, webhook `message.outbound`, audit.
- Lỗi chỉ log, không ảnh hưởng việc lưu thư.
- (Hạn chế) `threadId` không được truyền → auto-reply thành hội thoại riêng.

## 6. Tiêu chí chấp nhận
- [ ] Bật auto-reply, A gửi 2 thư trong 1 giờ → A nhận đúng 1 auto-reply.
- [ ] Thư từ `noreply@…` hoặc có `List-Id` → không auto-reply.
- [ ] Hai mailbox cùng bật auto-reply gửi cho nhau → không vòng lặp (header `Auto-Submitted`).
- [ ] Thư vào Spam → không auto-reply.
