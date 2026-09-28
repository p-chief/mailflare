# Tổng quan hệ thống

> Thuộc nhóm: Nền tảng · Đọc trước mọi file khác.

## 1. Hệ thống làm gì

Mailflare là hệ thống **email tự host trên tài khoản Cloudflare của chính bạn**, giao diện kiểu Gmail:

| Năng lực | Dịch vụ Cloudflare đảm nhận |
|---|---|
| Nhận SMTP cho domain | **Email Routing** → gọi **Email Worker** |
| Gửi thư | Binding **`send_email`** (Cloudflare Email Sending, cần *sending subdomain* trên zone) |
| Lưu dữ liệu quan hệ, nội dung text/html, chỉ mục tìm kiếm | **D1** (SQLite + FTS5) |
| Lưu MIME gốc, file đính kèm, avatar, backup | **R2** |
| Xử lý thư đến bất đồng bộ, hẹn giờ gửi, retry webhook | **Queues** |
| Thông báo thư mới theo thời gian thực | **Durable Objects** (WebSocket) |
| Backup định kỳ | **Cron Trigger** |
| Chống brute-force đăng nhập | **Rate Limiting binding** |
| Tự cấu hình DNS/Email Routing/Sending cho domain | **Cloudflare REST API** (gọi lúc chạy) |

Điểm khác biệt quan trọng: quản trị domain và mailbox **gọi Cloudflare API trong lúc chạy** — thêm domain là bật Email Routing + đặt catch-all về Worker + tạo sending subdomain; tạo mailbox là tạo Email Routing rule cho địa chỉ đó.

## 2. Luồng tổng quát

```
                SMTP                     (đồng bộ với phiên SMTP)
Người gửi ──► Email Routing ──► Worker.email()
                                  ├─ rule reject ─────────► message.setReject()
                                  ├─ rule forward ────────► message.forward()  (có thể dừng ở đây)
                                  ├─ account forwarding ──► message.forward()  (vẫn lưu)
                                  ├─ R2.put(inbound/<ts>-<id>.eml)
                                  └─ INBOUND_QUEUE.send({from,to,rawR2Key,headers})
                                                   │  (bất đồng bộ, at-least-once)
                                                   ▼
                                  Worker.queue() → processInboundMessage
                                  ├─ phân giải mailbox, idempotency
                                  ├─ parse MIME (postal-mime)
                                  ├─ rule mailbox, chấm điểm spam
                                  ├─ INSERT messages + attachments (R2)
                                  ├─ contacts, auto-reply
                                  ├─ Durable Object: thông báo realtime
                                  └─ webhooks

Trình duyệt / API client ──► Worker.fetch() ──► REST API ──► D1 / R2 / EMAIL.send() / OUTBOUND_QUEUE
Cron 02:00 UTC ──► Worker.scheduled() ──► backup JSON lên R2
```

## 3. Bản đồ tài liệu

| Thư mục | Nội dung |
|---|---|
| `00-nen-tang/` | Kiến trúc, thuật ngữ, trạng thái, dữ liệu, phân quyền, quy ước, Cloudflare API, hằng số |
| `01-co-ban/` | Chức năng MVP (bắt buộc) — mỗi file một chức năng |
| `02-nang-cao/` | Chức năng nên có sau MVP |
| `03-tuy-chon/` | Chức năng có thể bỏ |
| `04-giao-dien/` | Màn hình và quy tắc phía client |
| `05-van-hanh/` | Bẫy đã biết, lộ trình, danh mục API |

## 4. Ranh giới hệ thống

**Trong phạm vi**: nhận/gửi/đọc/tổ chức thư cho domain trên Cloudflare; quản trị domain, mailbox, người dùng; tích hợp API/webhook.

**Ngoài phạm vi** (hệ thống không làm):
- Không tự chạy SMTP server trên Workers (Email Routing làm việc đó).
- Không có IMAP/POP3 server (thay bằng JMAP — tùy chọn).
- Không quản lý DNS ngoài Cloudflare (trừ runtime Node tự host, nơi DNS được khai báo tay).
- Không lọc virus trong file đính kèm.
- Không mã hoá đầu-cuối (S/MIME/PGP).
