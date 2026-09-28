# Lộ trình triển khai đề xuất

> Mỗi giai đoạn có **đầu ra kiểm chứng được**. Thứ tự trong giai đoạn là thứ tự phụ thuộc.

## Giai đoạn 0 — Nền tảng
| Việc | Spec | Xong khi |
|---|---|---|
| Wrangler: D1, R2, `INBOUND_QUEUE`, `send_email`, rate limit, assets | [00-nen-tang/02](../00-nen-tang/02-kien-truc-cloudflare.md) | `wrangler deploy` chạy, bindings có mặt |
| Schema lõi + FTS5 + trigger (1 migration khởi tạo) | [00-nen-tang/04](../00-nen-tang/04-mo-hinh-du-lieu.md) | migration áp trên D1 trống |
| Router HTTP, middleware auth (cookie), giới hạn body, map lỗi | [00-nen-tang/06](../00-nen-tang/06-quy-uoc-chung.md) | 401/403/413 đúng |
| Cloudflare API client | [00-nen-tang/07](../00-nen-tang/07-cloudflare-api.md) | gọi được zone của token |
| Hàm thuần: địa chỉ, Message-ID, snippet, match rule + test `node:test` | [00-nen-tang/06](../00-nen-tang/06-quy-uoc-chung.md) | test xanh |

## Giai đoạn 1 — MVP nhận / đọc / gửi (CƠ BẢN)
| # | Việc | Spec |
|---|---|---|
| 1 | Setup lần đầu + đăng ký admin (có rollback) | [01-co-ban/01](../01-co-ban/01-khoi-tao-he-thong.md) |
| 2 | Đăng nhập / phiên / đăng xuất / `/me` / rate limit | [01-co-ban/02](../01-co-ban/02-dang-nhap-phien.md) |
| 3 | Hồ sơ, đổi mật khẩu | [01-co-ban/03](../01-co-ban/03-ho-so-mat-khau.md) |
| 4 | Domain: thêm (provision + rollback), DNS view, xoá | [01-co-ban/04](../01-co-ban/04-quan-ly-domain.md) |
| 5 | Mailbox: tạo, liệt kê, sửa tên/chữ ký, xoá | [01-co-ban/05](../01-co-ban/05-quan-ly-mailbox.md) |
| 6 | Pipeline nhận (handler + consumer, idempotent, attachment, threading) | [01-co-ban/06](../01-co-ban/06-nhan-thu.md), [13](../01-co-ban/13-hoi-thoai.md) |
| 7 | Danh sách + đếm | [01-co-ban/07](../01-co-ban/07-danh-sach-dem-thu.md) |
| 8 | Đọc thư, attachment, nguồn, sanitize | [01-co-ban/08](../01-co-ban/08-doc-thu.md) |
| 9 | Trạng thái, sao, bulk (+ xoá vĩnh viễn) | [01-co-ban/09](../01-co-ban/09-to-chuc-thu.md) |
| 10 | Nháp + autosave | [01-co-ban/10](../01-co-ban/10-nhap-thu.md) |
| 11 | Gửi thư | [01-co-ban/11](../01-co-ban/11-gui-thu.md) |
| 12 | Reply / Reply-all / Forward | [01-co-ban/12](../01-co-ban/12-tra-loi-chuyen-tiep.md) |
| 13 | Tìm kiếm text (FTS5) | [01-co-ban/14](../01-co-ban/14-tim-kiem.md) |
| 14 | UI: auth, khung, danh sách, đọc, composer, settings account, admin domains/mailboxes | [04-giao-dien](../04-giao-dien/00-ban-do-man-hinh.md) |
| 15 | Cron dọn dẹp (session, token, Trash cũ) | [05-van-hanh/01](01-bay-va-cai-thien.md) |
**Đầu ra**: gửi/nhận thư thật với một domain, đọc/trả lời/forward, tìm kiếm, xoá.

## Giai đoạn 2 — NÂNG CAO ưu tiên cao (trải nghiệm người dùng)
Realtime ([02-nang-cao/04](../02-nang-cao/04-realtime.md)) · Folder + rule mailbox ([03](../02-nang-cao/03-folder-tuy-chinh.md), [01](../02-nang-cao/01-rule-mailbox.md)) · Conversation view ([01-co-ban/13 §5](../01-co-ban/13-hoi-thoai.md)) · Toán tử tìm kiếm · Danh bạ + chặn ([10](../02-nang-cao/10-danh-ba-va-chan.md)) · Auto-reply ([07](../02-nang-cao/07-tra-loi-tu-dong.md)) · Snooze ([06](../02-nang-cao/06-snooze.md)) · Hẹn giờ gửi ([05](../02-nang-cao/05-hen-gio-gui.md)) · Quên mật khẩu ([14](../02-nang-cao/14-quen-mat-khau.md)) · 2FA ([15](../02-nang-cao/15-xac-thuc-2-lop.md)).

## Giai đoạn 3 — NÂNG CAO còn lại (quản trị & tích hợp)
Rule domain ([02](../02-nang-cao/02-rule-domain.md)) · Alias & useAllDomains ([09](../02-nang-cao/09-alias-va-use-all-domains.md)) · Account forwarding ([08](../02-nang-cao/08-chuyen-tiep-tai-khoan.md)) · Đa người dùng + shared ([16](../02-nang-cao/16-da-nguoi-dung-shared-mailbox.md)) · Bộ lọc spam ([11](../02-nang-cao/11-bo-loc-spam.md)) · API key + v1 ([13](../02-nang-cao/13-api-key-va-rest-v1.md)) · Webhook ([12](../02-nang-cao/12-webhook.md)) · Kiểm tra DNS ([17](../02-nang-cao/17-kiem-tra-dns.md)) · Audit ([18](../02-nang-cao/18-nhat-ky-audit.md)) · Avatar ([19](../02-nang-cao/19-cai-dat-ca-nhan-avatar.md)).

## Giai đoạn 4 — TÙY CHỌN
Import/export ([03-tuy-chon/03](../03-tuy-chon/03-import-export.md)) · Backup hoặc D1 Time Travel ([04](../03-tuy-chon/04-backup.md)) · Phím tắt, unsubscribe ([07](../03-tuy-chon/07-tien-ich-giao-dien.md)) · JMAP ([02](../03-tuy-chon/02-jmap.md)) · Calendar ([06](../03-tuy-chon/06-lich-va-mau-thu.md)). **Không làm**: license, self-update, runtime Node (trừ khi cần tự host ngoài Cloudflare).
