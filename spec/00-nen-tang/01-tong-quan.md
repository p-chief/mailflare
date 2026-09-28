# Tổng quan hệ thống

> **[CƠ BẢN]** · Nhóm: Nền tảng · Đọc trước mọi file khác · Liên quan: [02-kien-truc-cloudflare.md](02-kien-truc-cloudflare.md), [03-thuat-ngu-trang-thai.md](03-thuat-ngu-trang-thai.md)

## 1. Hệ thống làm gì

Hệ thống là một dịch vụ **email tự host trên tài khoản Cloudflare của chính người triển khai**, giao diện kiểu webmail (danh sách thư, đọc thư, soạn thư, thư mục, tìm kiếm). Tên hiển thị của sản phẩm là cấu hình `{APP_NAME}` do người triển khai đặt.

| Năng lực | Dịch vụ Cloudflare đảm nhận |
|---|---|
| Nhận SMTP cho domain | **Email Routing** → gọi **Email Worker** |
| Gửi thư | Binding **`send_email`** (Cloudflare Email Sending, cần *sending subdomain* trên zone) |
| Lưu dữ liệu quan hệ, nội dung text/html, chỉ mục tìm kiếm | **D1** (SQLite + FTS5) |
| Lưu MIME gốc, file đính kèm, avatar, backup | **R2** |
| Xử lý thư đến bất đồng bộ, hẹn giờ gửi, retry webhook | **Queues** |
| Thông báo thư mới theo thời gian thực | **Durable Objects** (WebSocket) |
| Backup định kỳ, dọn dẹp dữ liệu hết hạn | **Cron Trigger** |
| Chống brute-force đăng nhập | **Rate Limiting binding** |
| Tự cấu hình DNS/Email Routing/Sending cho domain | **Cloudflare REST API** (gọi lúc chạy) |

Đặc điểm quan trọng: quản trị domain và mailbox **gọi Cloudflare API trong lúc chạy** — thêm domain là bật Email Routing + đặt catch-all về Worker + tạo sending subdomain; tạo mailbox là tạo Email Routing rule cho địa chỉ đó. Vì vậy tên Worker đã deploy phải trùng với biến cấu hình `{EMAIL_WORKER_NAME}` (xem [02-kien-truc-cloudflare.md §3](02-kien-truc-cloudflare.md)).

## 2. Luồng tổng quát

```
                SMTP                     (đồng bộ với phiên SMTP)
Người gửi ──► Email Routing ──► Worker: handler email
                                  ├─ rule reject ─────────► message.setReject   (dừng)
                                  ├─ rule forward ────────► message.forward     (có thể dừng ở đây)
                                  ├─ chuyển tiếp tài khoản ► message.forward    (vẫn lưu)
                                  ├─ R2 put inbound/<ts>-<id>.eml
                                  └─ INBOUND_QUEUE send {from, to, rawR2Key, headers}
                                                   │  (bất đồng bộ, at-least-once)
                                                   ▼
                                  Worker: handler queue → thủ tục XỬ LÝ THƯ ĐẾN
                                  ├─ phân giải mailbox, kiểm tra idempotency
                                  ├─ parse MIME (ví dụ: postal-mime)
                                  ├─ rule mailbox, chấm điểm spam
                                  ├─ INSERT messages + attachments (R2)
                                  ├─ contacts, trả lời tự động
                                  ├─ Durable Object: thông báo realtime
                                  └─ webhooks

Trình duyệt / API client ──► Worker: handler fetch ──► REST API ──► D1 / R2 / EMAIL send / OUTBOUND_QUEUE
Cron 02:00 UTC ──► Worker: handler scheduled ──► backup JSON lên R2 + dọn dẹp dữ liệu hết hạn
```

Thủ tục XỬ LÝ THƯ ĐẾN được đặc tả đầy đủ ở [01-co-ban/06-nhan-thu.md](../01-co-ban/06-nhan-thu.md).

## 3. Bản đồ tài liệu

| Thư mục | Nội dung |
|---|---|
| `00-nen-tang/` | Kiến trúc, thuật ngữ, trạng thái, dữ liệu, phân quyền, quy ước, Cloudflare API, hằng số |
| `01-co-ban/` | Chức năng MVP (bắt buộc) — mỗi file một chức năng |
| `02-nang-cao/` | Chức năng nên có sau MVP |
| `03-tuy-chon/` | Chức năng có thể bỏ |
| `04-giao-dien/` | Màn hình và quy tắc phía client |
| `05-van-hanh/` | Bẫy cần tránh, lộ trình triển khai, danh mục API |

Nhãn dùng xuyên suốt: **[CƠ BẢN]** (bắt buộc cho MVP), **[NÂNG CAO]** (nên có), **[TÙY CHỌN]** (có thể bỏ mà không ảnh hưởng phần còn lại).

## 4. Ranh giới hệ thống

**Trong phạm vi**: nhận/gửi/đọc/tổ chức thư cho domain trên Cloudflare; quản trị domain, mailbox, người dùng; tích hợp API/webhook.

**Ngoài phạm vi** (hệ thống không làm):
- Không tự chạy SMTP server trên Workers (Email Routing làm việc đó).
- Không có IMAP/POP3 server (thay bằng JMAP — tùy chọn, xem [03-tuy-chon/02-jmap.md](../03-tuy-chon/02-jmap.md)).
- Không quản lý DNS ngoài Cloudflare (trừ runtime Node tự host, nơi DNS được khai báo tay — xem [03-tuy-chon/08-runtime-node-tu-host.md](../03-tuy-chon/08-runtime-node-tu-host.md)).
- Không lọc virus trong file đính kèm.
- Không mã hoá đầu-cuối (S/MIME/PGP).
