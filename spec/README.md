# Đặc tả hệ thống email trên Cloudflare

Tài liệu này là đặc tả độc lập của một hệ thống email tự vận hành chạy hoàn toàn trên Cloudflare: Workers (HTTP, Email Routing handler, Queue consumer, Cron), Email Routing, Email Sending (`send_email`), D1, R2, Queues, Durable Objects và Rate Limiting. Người đọc chỉ cần thư mục `spec/` là đủ để xây dựng hệ thống: nhận thư cho nhiều domain, đọc, tìm kiếm, tổ chức, soạn và gửi thư, quản trị domain/mailbox/người dùng, cùng các tích hợp (webhook, REST API, JMAP).

Các giá trị phụ thuộc bản triển khai được viết dưới dạng placeholder và do người triển khai cấu hình:

| Placeholder | Ý nghĩa | Ví dụ |
|---|---|---|
| `{APP_NAME}` | Tên hiển thị của hệ thống trong UI, tiêu đề thư hệ thống, issuer TOTP, PRODID lịch | `Acme Mail` |
| `{APP_HOST}` | Hostname công khai của ứng dụng; dùng cho Message-ID/UID tự sinh (`<id@{APP_HOST}>`) | `mail.example.com` |
| `{EMAIL_WORKER_NAME}` | Tên Worker nhận thư mà rule Email Routing trỏ tới; phải trùng tên Worker đã deploy | `acme-mail` |

## Cách đọc
1. Đọc `00-nen-tang/` trước. Nhóm này gồm kiến trúc, thuật ngữ, dữ liệu, phân quyền và quy ước dùng chung.
2. Mỗi file trong `01`–`03` mô tả **một chức năng**, theo cùng khuôn mẫu:
   - **Mục tiêu**
   - **Ranh giới** (trong / ngoài phạm vi)
   - **Quyền**
   - **Dữ liệu**
   - **Luồng / API**
   - **Quy tắc**
   - **Lỗi & biên**
   - **Tiêu chí chấp nhận**
   - **Ghi chú triển khai** (tuỳ chọn, chỉ gợi ý kỹ thuật)
3. `04-giao-dien/` mô tả hành vi màn hình phía client (không ràng buộc framework). `05-van-hanh/` gồm yêu cầu phi chức năng, lộ trình triển khai và danh mục API.

Nhãn phân loại:

| Nhãn | Ý nghĩa |
|---|---|
| **[CƠ BẢN]** | Bắt buộc cho MVP: thiếu thì không nhận, gửi hay đọc thư được |
| **[NÂNG CAO]** | Làm sau MVP |
| **[TÙY CHỌN]** | Có thể bỏ hoặc để rất muộn |

## Mục lục

### 00 — Nền tảng
| File | Nội dung |
|---|---|
| [01-tong-quan.md](00-nen-tang/01-tong-quan.md) | Hệ thống làm gì, luồng tổng quát, ranh giới |
| [02-kien-truc-cloudflare.md](00-nen-tang/02-kien-truc-cloudflare.md) | Bindings, secrets, 4 handler của Worker, tổ chức mã đề xuất |
| [03-thuat-ngu-trang-thai.md](00-nen-tang/03-thuat-ngu-trang-thai.md) | Thuật ngữ, máy trạng thái thư và các thực thể |
| [04-mo-hinh-du-lieu.md](00-nen-tang/04-mo-hinh-du-lieu.md) | Toàn bộ bảng, FTS5, khoá R2, migration |
| [05-phan-quyen.md](00-nen-tang/05-phan-quyen.md) | Xác thực, vai trò, quyền mailbox, mẫu kiểm tra |
| [06-quy-uoc-chung.md](00-nen-tang/06-quy-uoc-chung.md) | ID, hash, lỗi, giới hạn body, xử lý địa chỉ, Message-ID, snippet |
| [07-cloudflare-api.md](00-nen-tang/07-cloudflare-api.md) | Client REST Cloudflare và mọi endpoint được dùng |
| [08-hang-so-gioi-han.md](00-nen-tang/08-hang-so-gioi-han.md) | Mọi hằng số và giới hạn |

### 01 — Cơ bản
| # | Chức năng |
|---|---|
| [01](01-co-ban/01-khoi-tao-he-thong.md) | Khởi tạo hệ thống lần đầu |
| [02](01-co-ban/02-dang-nhap-phien.md) | Đăng nhập, phiên, đăng xuất |
| [03](01-co-ban/03-ho-so-mat-khau.md) | Hồ sơ & đổi mật khẩu |
| [04](01-co-ban/04-quan-ly-domain.md) | Quản lý domain (provision, rollback, DNS, xoá) |
| [05](01-co-ban/05-quan-ly-mailbox.md) | Quản lý mailbox |
| [06](01-co-ban/06-nhan-thu.md) | Nhận thư (email handler → R2 → queue → lưu) |
| [07](01-co-ban/07-danh-sach-dem-thu.md) | Danh sách thư & đếm chưa đọc |
| [08](01-co-ban/08-doc-thu.md) | Đọc thư, attachment, nguồn gốc, sanitize HTML |
| [09](01-co-ban/09-to-chuc-thu.md) | Trạng thái, gắn sao, bulk action, xoá vĩnh viễn |
| [10](01-co-ban/10-nhap-thu.md) | Thư nháp & autosave |
| [11](01-co-ban/11-gui-thu.md) | Gửi thư |
| [12](01-co-ban/12-tra-loi-chuyen-tiep.md) | Reply / Reply-all / Forward |
| [13](01-co-ban/13-hoi-thoai.md) | Hội thoại (threading) |
| [14](01-co-ban/14-tim-kiem.md) | Tìm kiếm |

### 02 — Nâng cao
| # | Chức năng |
|---|---|
| [01](02-nang-cao/01-rule-mailbox.md) | Rule cấp mailbox (lọc vào folder/spam/trash) |
| [02](02-nang-cao/02-rule-domain.md) | Rule cấp domain (chặn, forward, catch-all) |
| [03](02-nang-cao/03-folder-tuy-chinh.md) | Folder tuỳ chỉnh |
| [04](02-nang-cao/04-realtime.md) | Realtime (Durable Object WebSocket) |
| [05](02-nang-cao/05-hen-gio-gui.md) | Hẹn giờ gửi |
| [06](02-nang-cao/06-snooze.md) | Snooze |
| [07](02-nang-cao/07-tra-loi-tu-dong.md) | Trả lời tự động |
| [08](02-nang-cao/08-chuyen-tiep-tai-khoan.md) | Chuyển tiếp toàn tài khoản |
| [09](02-nang-cao/09-alias-va-use-all-domains.md) | Alias & useAllDomains |
| [10](02-nang-cao/10-danh-ba-va-chan.md) | Danh bạ & chặn người gửi |
| [11](02-nang-cao/11-bo-loc-spam.md) | Bộ lọc spam cục bộ |
| [12](02-nang-cao/12-webhook.md) | Webhook |
| [13](02-nang-cao/13-api-key-va-rest-v1.md) | API key & REST `/api/v1` |
| [14](02-nang-cao/14-quen-mat-khau.md) | Quên mật khẩu |
| [15](02-nang-cao/15-xac-thuc-2-lop.md) | Xác thực hai lớp (TOTP) |
| [16](02-nang-cao/16-da-nguoi-dung-shared-mailbox.md) | Đa người dùng & shared mailbox |
| [17](02-nang-cao/17-kiem-tra-dns.md) | Kiểm tra & sửa DNS (MX/SPF/DKIM/DMARC) |
| [18](02-nang-cao/18-nhat-ky-audit.md) | Nhật ký hoạt động |
| [19](02-nang-cao/19-cai-dat-ca-nhan-avatar.md) | Cài đặt cá nhân & avatar |

### 03 — Tùy chọn
| # | Chức năng |
|---|---|
| [01](03-tuy-chon/01-license-branding.md) | Phân gói tính năng (entitlements) & branding |
| [02](03-tuy-chon/02-jmap.md) | JMAP |
| [03](03-tuy-chon/03-import-export.md) | Import / export (eml, mbox, IMAP) |
| [04](03-tuy-chon/04-backup.md) | Backup & khôi phục |
| [05](03-tuy-chon/05-migration-self-update.md) | Migration & cập nhật phiên bản |
| [06](03-tuy-chon/06-lich-va-mau-thu.md) | Lịch & mẫu thư |
| [07](03-tuy-chon/07-tien-ich-giao-dien.md) | Phím tắt, command palette, unsubscribe, Gravatar |
| [08](03-tuy-chon/08-runtime-node-tu-host.md) | Triển khai ngoài Cloudflare Workers & relay inbound |

### 04 — Giao diện
[00 Bản đồ màn hình](04-giao-dien/00-ban-do-man-hinh.md) · [01 Xác thực & khởi tạo](04-giao-dien/01-xac-thuc-khoi-tao.md) · [02 Khung & điều hướng](04-giao-dien/02-khung-dieu-huong.md) · [03 Danh sách thư](04-giao-dien/03-danh-sach-thu.md) · [04 Đọc thư](04-giao-dien/04-doc-thu.md) · [05 Soạn thư](04-giao-dien/05-soan-thu.md) · [06 Cài đặt](04-giao-dien/06-cai-dat.md) · [07 Quản trị](04-giao-dien/07-quan-tri.md)

### 05 — Vận hành
[01 Yêu cầu phi chức năng & quyết định thiết kế](05-van-hanh/01-bay-va-cai-thien.md) · [02 Lộ trình triển khai](05-van-hanh/02-lo-trinh-trien-khai.md) · [03 Danh mục API](05-van-hanh/03-danh-muc-api.md)

## Bản đồ phụ thuộc giữa các chức năng
```
phân quyền ─┬─► mọi chức năng đọc/ghi thư
Cloudflare API ─► domain ─► mailbox ─┬─► nhận thư ─┬─► danh sách/đếm ─► đọc ─► tổ chức
                                     │             ├─► hội thoại ◄───────────────┐
                                     │             ├─ rule mailbox, spam, danh bạ │
                                     │             └─ auto-reply, realtime, webhook
                                     └─► nháp ─► gửi ─► reply/forward ────────────┘
                    rule domain, forwarding ─► (trong email handler, trước khi lưu)
```
