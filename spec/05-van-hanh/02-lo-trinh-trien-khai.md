# Lộ trình triển khai đề xuất

> Mỗi giai đoạn có **đầu ra kiểm chứng được**. Thứ tự trong giai đoạn là thứ tự phụ thuộc. Yêu cầu phi chức năng ở [01-bay-va-cai-thien.md](01-bay-va-cai-thien.md) áp dụng từ giai đoạn 0.

## Giai đoạn 0 — Nền tảng
| Việc | Spec | Xong khi |
|---|---|---|
| Cấu hình Wrangler: D1, R2, `INBOUND_QUEUE` (+ DLQ), `send_email`, rate limit, static assets, tên Worker = `{EMAIL_WORKER_NAME}` | [00-nen-tang/02](../00-nen-tang/02-kien-truc-cloudflare.md) | `wrangler deploy` chạy, bindings có mặt |
| Schema lõi + FTS5 + trigger (một migration khởi tạo) | [00-nen-tang/04](../00-nen-tang/04-mo-hinh-du-lieu.md) | migration áp được trên D1 trống |
| Router HTTP, middleware xác thực (cookie + kiểm tra Origin), giới hạn body, map lỗi, `requestId` | [00-nen-tang/06](../00-nen-tang/06-quy-uoc-chung.md), [05-van-hanh/01 §5](01-bay-va-cai-thien.md) | 401/403/413 đúng, log JSON có `requestId` |
| Client Cloudflare API | [00-nen-tang/07](../00-nen-tang/07-cloudflare-api.md) | gọi được zone của token |
| Thủ tục thuần: chuẩn hoá địa chỉ, Message-ID, snippet, so khớp rule — kèm test đơn vị chạy không cần binding | [00-nen-tang/06](../00-nen-tang/06-quy-uoc-chung.md) | test xanh |
| Chốt các quyết định thiết kế | [05-van-hanh/01 §6](01-bay-va-cai-thien.md) | có ghi nhận phương án đã chọn |

## Giai đoạn 1 — MVP nhận / đọc / gửi (CƠ BẢN)
| # | Việc | Spec |
|---|---|---|
| 1 | Setup lần đầu + đăng ký admin (có rollback) | [01-co-ban/01](../01-co-ban/01-khoi-tao-he-thong.md) |
| 2 | Đăng nhập / phiên / đăng xuất / `/me` / rate limit | [01-co-ban/02](../01-co-ban/02-dang-nhap-phien.md) |
| 3 | Hồ sơ, đổi mật khẩu | [01-co-ban/03](../01-co-ban/03-ho-so-mat-khau.md) |
| 4 | Domain: thêm (provision + rollback), xem DNS, xoá | [01-co-ban/04](../01-co-ban/04-quan-ly-domain.md) |
| 5 | Mailbox: tạo, liệt kê, sửa tên/chữ ký, xoá | [01-co-ban/05](../01-co-ban/05-quan-ly-mailbox.md) |
| 6 | Pipeline nhận (handler + consumer, idempotent, attachment, threading, DLQ) | [01-co-ban/06](../01-co-ban/06-nhan-thu.md), [13](../01-co-ban/13-hoi-thoai.md) |
| 7 | Danh sách + đếm | [01-co-ban/07](../01-co-ban/07-danh-sach-dem-thu.md) |
| 8 | Đọc thư, attachment, nguồn gốc, sanitize, chặn ảnh bên ngoài | [01-co-ban/08](../01-co-ban/08-doc-thu.md) |
| 9 | Trạng thái, sao, bulk, xoá vĩnh viễn, empty trash | [01-co-ban/09](../01-co-ban/09-to-chuc-thu.md) |
| 10 | Nháp + autosave | [01-co-ban/10](../01-co-ban/10-nhap-thu.md) |
| 11 | Gửi thư, Outbox, gửi lại | [01-co-ban/11](../01-co-ban/11-gui-thu.md) |
| 12 | Reply / Reply-all / Forward | [01-co-ban/12](../01-co-ban/12-tra-loi-chuyen-tiep.md) |
| 13 | Tìm kiếm văn bản (FTS5) | [01-co-ban/14](../01-co-ban/14-tim-kiem.md) |
| 14 | UI: xác thực, khung, danh sách, đọc, composer, settings account, admin domains/mailboxes | [04-giao-dien](../04-giao-dien/00-ban-do-man-hinh.md) |
| 15 | Cron dọn dẹp: session, token, login challenge, Trash/Spam cũ | [05-van-hanh/01 §4](01-bay-va-cai-thien.md) |

**Đầu ra**: gửi/nhận thư thật với một domain; đọc, trả lời, forward, tìm kiếm, xoá vĩnh viễn; thư gửi lỗi hiện ở Outbox và gửi lại được.

## Giai đoạn 2 — NÂNG CAO ưu tiên cao (trải nghiệm người dùng)
Realtime + lời mời bật thông báo ([02-nang-cao/04](../02-nang-cao/04-realtime.md)) · Folder + rule mailbox ([03](../02-nang-cao/03-folder-tuy-chinh.md), [01](../02-nang-cao/01-rule-mailbox.md)) · Conversation view ([01-co-ban/13](../01-co-ban/13-hoi-thoai.md)) · Toán tử tìm kiếm ([01-co-ban/14](../01-co-ban/14-tim-kiem.md)) · Danh bạ, gợi ý người nhận, chặn/bỏ chặn ([10](../02-nang-cao/10-danh-ba-va-chan.md)) · Auto-reply ([07](../02-nang-cao/07-tra-loi-tu-dong.md)) · Snooze ([06](../02-nang-cao/06-snooze.md)) · Hẹn giờ gửi + huỷ hẹn ([05](../02-nang-cao/05-hen-gio-gui.md)) · Quên mật khẩu ([14](../02-nang-cao/14-quen-mat-khau.md)) · 2FA ([15](../02-nang-cao/15-xac-thuc-2-lop.md)).

**Đầu ra**: thư mới hiện ngay không cần tải lại; người dùng tự tổ chức thư bằng folder và rule; đăng nhập có 2FA.

## Giai đoạn 3 — NÂNG CAO còn lại (quản trị & tích hợp)
Rule domain ([02](../02-nang-cao/02-rule-domain.md)) · Alias & useAllDomains ([09](../02-nang-cao/09-alias-va-use-all-domains.md)) · Chuyển tiếp tài khoản ([08](../02-nang-cao/08-chuyen-tiep-tai-khoan.md)) · Đa người dùng + shared mailbox ([16](../02-nang-cao/16-da-nguoi-dung-shared-mailbox.md)) · Bộ lọc spam ([11](../02-nang-cao/11-bo-loc-spam.md)) · API key + REST v1 ([13](../02-nang-cao/13-api-key-va-rest-v1.md)) · Webhook ([12](../02-nang-cao/12-webhook.md)) · Kiểm tra DNS ([17](../02-nang-cao/17-kiem-tra-dns.md)) · Audit log, lịch sử đăng nhập, retention ([18](../02-nang-cao/18-nhat-ky-audit.md)) · Cài đặt cá nhân & avatar ([19](../02-nang-cao/19-cai-dat-ca-nhan-avatar.md)).

**Đầu ra**: nhiều người dùng và shared mailbox; tích hợp ngoài qua API key và webhook; admin tra cứu được audit.

## Giai đoạn 4 — TÙY CHỌN
Chọn theo nhu cầu, không có thứ tự bắt buộc:
- Import/export ([03-tuy-chon/03](../03-tuy-chon/03-import-export.md)).
- Backup JSON, hoặc chỉ dùng D1 Time Travel ([04](../03-tuy-chon/04-backup.md)).
- Phím tắt, command palette, unsubscribe, Gravatar ([07](../03-tuy-chon/07-tien-ich-giao-dien.md)).
- JMAP ([02](../03-tuy-chon/02-jmap.md)).
- Lịch ([06](../03-tuy-chon/06-lich-va-mau-thu.md)).
- Phân gói tính năng & branding ([01](../03-tuy-chon/01-license-branding.md)) — chỉ cần khi muốn giới hạn tính năng theo gói hoặc cho đổi tên/icon.
- Migration trong ứng dụng & kiểm tra phiên bản ([05](../03-tuy-chon/05-migration-self-update.md)) — tuỳ chọn; có thể chỉ dùng `wrangler d1 migrations apply` trong CI/CD.
- Triển khai ngoài Cloudflare Workers ([08](../03-tuy-chon/08-runtime-node-tu-host.md)) — chỉ khi cần tự host.
