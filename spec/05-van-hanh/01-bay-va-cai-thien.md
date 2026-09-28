# Yêu cầu phi chức năng & quyết định thiết kế

> Áp dụng cho mọi chức năng trong `01`–`03`. Mỗi yêu cầu có mã (`BM-`, `TC-`, `HN-`, `DL-`, `QS-`) để tham chiếu trong review và kiểm thử; cột "Chi tiết" trỏ tới file đặc tả nơi yêu cầu được hiện thực.

## 1. Bảo mật
| Mã | Yêu cầu | Chi tiết |
|---|---|---|
| BM-01 | Phiên chỉ nằm trong cookie `ep_session` (HttpOnly, Secure, SameSite=Lax, Path=/). Token phiên không bao giờ xuất hiện trong body response hay bộ nhớ trình duyệt | [01-co-ban/02](../01-co-ban/02-dang-nhap-phien.md), [04-giao-dien/00 §2](../04-giao-dien/00-ban-do-man-hinh.md) |
| BM-02 | Mọi request ghi (POST/PUT/PATCH/DELETE) xác thực bằng cookie phải có header `Origin` trùng origin ứng dụng; sai/thiếu → 403 "Invalid origin" (`CSRF_ORIGIN_MISMATCH`). Endpoint dùng API key hoặc HMAC không cần kiểm tra Origin | [00-nen-tang/05](../00-nen-tang/05-phan-quyen.md) |
| BM-03 | Bước khởi tạo lần đầu chỉ chạy khi DB chưa có bảng nào và chưa có admin; đăng ký admin đầu tiên được bảo vệ khỏi chạy đồng thời bằng ràng buộc DB (chỉ một admin được tạo trong bước setup) | [01-co-ban/01](../01-co-ban/01-khoi-tao-he-thong.md) |
| BM-04 | Email đăng nhập được trim + lowercase trước khi tra cứu; đăng nhập có rate limit (`LOGIN_RATE_LIMIT`) và Turnstile tuỳ chọn | [01-co-ban/02](../01-co-ban/02-dang-nhap-phien.md) |
| BM-05 | Mật khẩu băm bằng bcrypt (cost 12). API key ngẫu nhiên ≥ 32 byte, lưu SHA-256, so sánh constant-time | [02-nang-cao/13](../02-nang-cao/13-api-key-va-rest-v1.md) |
| BM-06 | API key: key sai/thu hồi/hết hạn → 401; key hợp lệ thiếu scope → 403 | [02-nang-cao/13](../02-nang-cao/13-api-key-va-rest-v1.md) |
| BM-07 | TOTP chống dùng lại: lưu bước thời gian cuối đã chấp nhận, từ chối mã có bước ≤ giá trị đó. TOTP secret mã hoá AES-256-GCM bằng khoá `TOTP_ENCRYPTION_KEY` | [02-nang-cao/15](../02-nang-cao/15-xac-thuc-2-lop.md) |
| BM-08 | Link đặt lại mật khẩu: băm, một lần, 30 phút; yêu cầu mới vô hiệu mọi token cũ của user; rate limit theo email và IP; response luôn giống nhau dù tài khoản có tồn tại hay không | [02-nang-cao/14](../02-nang-cao/14-quen-mat-khau.md) |
| BM-09 | HTML thư được sanitize trước khi hiển thị và render trong vùng cô lập; ảnh bên ngoài bị chặn mặc định | [01-co-ban/08](../01-co-ban/08-doc-thu.md) |
| BM-10 | Mọi kết nối ra ngoài do người dùng chỉ định host/URL (IMAP, unsubscribe one-click) qua kiểm tra chống SSRF: chặn tên nội bộ, IP riêng/loopback/link-local/ULA IPv4 + IPv6, `0.0.0.0/8`, `100.64/10`, và kiểm tra IP sau khi phân giải | [03-tuy-chon/03 §7.2](../03-tuy-chon/03-import-export.md) |
| BM-11 | Không ghi log mật khẩu, token phiên, API key, license key, secret, nội dung thư, attachment. Log chỉ chứa id, mã lỗi và thông điệp đã rút gọn | §5 |
| BM-12 | Relay inbound ký HMAC-SHA256 có timestamp (cửa sổ 300 s) và cache chữ ký để chống replay | [03-tuy-chon/08 §5.3](../03-tuy-chon/08-runtime-node-tu-host.md) |
| BM-13 | Thông báo realtime chỉ gửi tới user có quyền đọc mailbox; chủ domain hay admin không có quyền đọc thì không nhận | [02-nang-cao/04](../02-nang-cao/04-realtime.md) |
| BM-14 | Mọi truy vấn thư lọc theo tập mailbox truy cập được, không theo `user_id`; thư không có quyền trả 404 (không phải 403) để không lộ sự tồn tại | [00-nen-tang/05](../00-nen-tang/05-phan-quyen.md) |
| BM-15 | Response API không bao giờ chứa khoá nội bộ lưu trữ (`raw_r2_key`, `r2_key`), hash mật khẩu, TOTP secret hay hash key | [00-nen-tang/06](../00-nen-tang/06-quy-uoc-chung.md) |
| BM-16 | Bulk action chỉ áp cho thư user có quyền **và** thoả điều kiện của action (vd action `folder` chỉ khi folder cùng mailbox với thư); endpoint đổi trạng thái chỉ nhận `received|archived|trash|spam` | [01-co-ban/09](../01-co-ban/09-to-chuc-thu.md) |
| BM-17 | Danh sách tài khoản, audit và quyền quản trị giới hạn trong tập tài khoản admin quản lý (chính mình + tài khoản mình tạo) | [02-nang-cao/16](../02-nang-cao/16-da-nguoi-dung-shared-mailbox.md), [02-nang-cao/18](../02-nang-cao/18-nhat-ky-audit.md) |
| BM-18 | Thư hẹn giờ kiểm tra lại quyền gửi của người gửi tại thời điểm gửi; mất quyền → thư `failed` | [02-nang-cao/05](../02-nang-cao/05-hen-gio-gui.md) |
| BM-19 | Xác thực Cloudflare API: dùng `CF_TOKEN` khi có; chỉ dùng cặp `CF_EMAIL` + `CF_API_KEY` khi không có token | [00-nen-tang/07](../00-nen-tang/07-cloudflare-api.md) |
| BM-20 | Attachment tải về có `X-Content-Type-Options: nosniff`; loại có thể chạy script (HTML, SVG) luôn tải về dưới dạng `attachment` | [01-co-ban/08](../01-co-ban/08-doc-thu.md) |

## 2. Độ tin cậy & toàn vẹn dữ liệu
| Mã | Yêu cầu | Chi tiết |
|---|---|---|
| TC-01 | Email handler phân giải địa chỉ **trước** khi ghi R2; không phân giải được → `setReject("Unknown recipient")`, không ghi object, không enqueue | [01-co-ban/06](../01-co-ban/06-nhan-thu.md) |
| TC-02 | Quyết định định tuyến của handler được truyền trong payload queue; consumer dùng quyết định đó, không phân giải lại | [01-co-ban/06](../01-co-ban/06-nhan-thu.md) |
| TC-03 | Mọi consumer idempotent (queue at-least-once): thư đến theo `(mailbox_id, raw_r2_key)`, import theo `(mailbox_id, provider_message_id)`, webhook theo delivery id, gửi hẹn giờ theo trạng thái job | [00-nen-tang/02 §4.3](../00-nen-tang/02-kien-truc-cloudflare.md) |
| TC-04 | Không có lưu nửa vời: lỗi sau khi INSERT thư → xoá dòng và object đã ghi rồi để queue retry | [01-co-ban/06](../01-co-ban/06-nhan-thu.md) |
| TC-05 | Queue cấu hình dead-letter queue sau 3 lần retry; message vào DLQ được log mức error và cảnh báo (QS-03, QS-04) | [01-co-ban/06 §11](../01-co-ban/06-nhan-thu.md) |
| TC-06 | Việc phụ (webhook, Gravatar, auto-reply, thông báo realtime) không nằm trên đường găng lưu thư: lỗi của chúng không làm thư retry hay mất | [01-co-ban/06](../01-co-ban/06-nhan-thu.md), [03-tuy-chon/07 §6](../03-tuy-chon/07-tien-ich-giao-dien.md) |
| TC-07 | Mọi trạng thái thư đều thấy được ở một thư mục: `queued`/`failed` ở Outbox/Scheduled, có gửi lại và huỷ hẹn | [01-co-ban/11 §5](../01-co-ban/11-gui-thu.md), [02-nang-cao/05](../02-nang-cao/05-hen-gio-gui.md) |
| TC-08 | Lỗi dữ liệu đầu vào khi gửi (quá số người nhận, attachment sai) trả 400 có `code`, không phải 500 | [01-co-ban/11](../01-co-ban/11-gui-thu.md) |
| TC-09 | Server xoá nháp khi gửi thành công với `draftId`; auto-reply gắn `thread_id` của thư đến | [01-co-ban/11](../01-co-ban/11-gui-thu.md), [02-nang-cao/07](../02-nang-cao/07-tra-loi-tu-dong.md) |
| TC-10 | Xoá mailbox xoá cứng thư và object R2 của nó (có xác nhận số thư); xoá domain bị chặn khi còn mailbox; không để lại thư mồ côi | [01-co-ban/05](../01-co-ban/05-quan-ly-mailbox.md), [01-co-ban/04](../01-co-ban/04-quan-ly-domain.md) |
| TC-11 | Xoá domain chỉ tắt Email Routing của zone khi chính hệ thống đã bật nó (`routing_enabled_by_app`); tắt `useAllDomains` xoá rule Cloudflare ở các domain phụ | [01-co-ban/04](../01-co-ban/04-quan-ly-domain.md), [02-nang-cao/09](../02-nang-cao/09-alias-va-use-all-domains.md) |
| TC-12 | Tác vụ nhiều bước có gọi Cloudflare (thêm domain, tạo mailbox) có rollback: lỗi ở bước sau hoàn tác bước trước | [01-co-ban/04](../01-co-ban/04-quan-ly-domain.md), [01-co-ban/05](../01-co-ban/05-quan-ly-mailbox.md) |
| TC-13 | Khôi phục backup không bao giờ để DB trống/nửa vời: kiểm tra toàn bộ trước, backup an toàn, tự hoàn tác | [03-tuy-chon/04 §8](../03-tuy-chon/04-backup.md) |
| TC-14 | Bộ đếm cập nhật nguyên tử bằng một câu lệnh (vd `UPDATE … SET match_count = match_count + 1`), không đọc-rồi-ghi | [02-nang-cao/02](../02-nang-cao/02-rule-domain.md) |
| TC-15 | Lỗi ghi audit hay thống kê không làm hỏng thao tác chính | [02-nang-cao/18](../02-nang-cao/18-nhat-ky-audit.md) |

## 3. Hiệu năng & tài nguyên
| Mã | Yêu cầu | Chi tiết |
|---|---|---|
| HN-01 | Đếm thư theo thư mục bằng **một** truy vấn `GROUP BY` / `SUM(CASE …)`, không tải từng dòng về ứng dụng | [01-co-ban/07](../01-co-ban/07-danh-sach-dem-thu.md) |
| HN-02 | Danh sách thư phân trang bằng `limit/offset` (≤ 100), dùng index `(mailbox_id, status, created_at)` và tương đương | [00-nen-tang/04](../00-nen-tang/04-mo-hinh-du-lieu.md) |
| HN-03 | Tìm kiếm văn bản dùng FTS5; chỉ mục chứa văn bản đã bỏ thẻ HTML | [01-co-ban/14](../01-co-ban/14-tim-kiem.md) |
| HN-04 | Raw MIME được stream thẳng lên R2 trong handler; kích thước tối đa theo [00-nen-tang/08](../00-nen-tang/08-hang-so-gioi-han.md), vượt → reject | [01-co-ban/06](../01-co-ban/06-nhan-thu.md) |
| HN-05 | Export mbox và backup ghi theo luồng, không giữ toàn bộ dữ liệu trong bộ nhớ Worker (128 MB) | [03-tuy-chon/03 §8](../03-tuy-chon/03-import-export.md), [03-tuy-chon/04 §5](../03-tuy-chon/04-backup.md) |
| HN-06 | Tác vụ hàng loạt (empty trash, cron, retention) chạy theo lô với ngân sách thời gian, trả `remaining` hoặc để phần còn lại cho lần sau | [01-co-ban/09 §7](../01-co-ban/09-to-chuc-thu.md) |
| HN-07 | Cờ entitlement đọc một lần mỗi request, có thể cache trong isolate ≤ 60 s; không ghi DB khi đọc | [03-tuy-chon/01 §3.3](../03-tuy-chon/01-license-branding.md) |
| HN-08 | Mọi lời gọi HTTP ra ngoài có timeout (Cloudflare API, webhook, Gravatar, license, nguồn phát hành, unsubscribe, IMAP) | từng file chức năng |
| HN-09 | Client poll danh sách/đếm không nhanh hơn 15 s; realtime là kênh chính | [04-giao-dien/00 §5](../04-giao-dien/00-ban-do-man-hinh.md) |

## 4. Lưu giữ & dọn dẹp (cron)
Một cron trigger `0 2 * * *` (02:00 UTC). Handler `scheduled` chạy các việc dưới đây **độc lập** (lỗi việc này không chặn việc khác), mỗi việc theo lô và ngân sách thời gian; phần còn lại xử lý ở lần chạy sau. Mỗi việc ghi một dòng log JSON `{job, deleted, remaining, durationMs}`.

| Việc | Điều kiện xoá / hành động | Cấu hình | Chi tiết |
|---|---|---|---|
| Session hết hạn | `sessions.expires_at <= now` | — | [01-co-ban/02 §4.6](../01-co-ban/02-dang-nhap-phien.md) |
| Token đặt lại mật khẩu | `password_reset_tokens.expires_at < now` hoặc `used_at` khác null | — | [02-nang-cao/14](../02-nang-cao/14-quen-mat-khau.md) |
| Login challenge (MFA) | `login_challenges.expires_at < now` | — | [02-nang-cao/15](../02-nang-cao/15-xac-thuc-2-lop.md) |
| Nhật ký auto-reply | `auto_reply_deliveries.sent_at < now − 24 giờ` (ra khỏi cửa sổ chống lặp) | — | [02-nang-cao/07](../02-nang-cao/07-tra-loi-tu-dong.md) |
| Thư Trash/Spam cũ | `status ∈ {trash, spam}` và `coalesce(trashed_at, created_at) < now − N ngày`, xoá bằng thủ tục xoá vĩnh viễn (dòng + object R2) | `TRASH_RETENTION_DAYS` (mặc định 30; `0` = tắt) | [01-co-ban/09 §7.5](../01-co-ban/09-to-chuc-thu.md) |
| Audit log cũ | `audit_logs.created_at < now − N ngày`, lô 1000 dòng | `AUDIT_RETENTION_DAYS` (mặc định 365; `0` = giữ mãi) | [02-nang-cao/18 §6](../02-nang-cao/18-nhat-ky-audit.md) |
| Upload JMAP chưa dùng | object `jmap-uploads/…` upload cách đây > 24 giờ | — | [03-tuy-chon/02 §9](../03-tuy-chon/02-jmap.md) |
| Webhook deliveries cũ | `webhook_deliveries` đã kết thúc (`delivered` hoặc hết lượt thử) cũ hơn N ngày; delivery còn đang retry không bị xoá | `WEBHOOK_DELIVERY_RETENTION_DAYS` (mặc định 30) | yêu cầu tại mục này; bảng: [02-nang-cao/12](../02-nang-cao/12-webhook.md) |
| Backup kẹt | `backups` `queued|running` quá 30 phút → `failed` | — | [03-tuy-chon/04 §6](../03-tuy-chon/04-backup.md) |
| Backup định kỳ + retention | theo `backup_settings` | `backup_settings` | [03-tuy-chon/04 §6](../03-tuy-chon/04-backup.md) |

## 5. Quan sát (observability)
| Mã | Yêu cầu |
|---|---|
| QS-01 | Log có cấu trúc JSON một dòng: `{ts, level, event, requestId?, userId?, mailboxId?, messageId?, durationMs?, error?}`; bật Workers Logs (hoặc Logpush) để truy vấn |
| QS-02 | Mỗi request HTTP có `requestId` (từ `cf-ray` hoặc sinh mới), trả lại trong header `X-Request-Id` và có trong mọi log của request đó; lỗi 500 trả `{error, requestId}` |
| QS-03 | Các sự kiện phải log (mức): thư bị reject (info), thư lưu thành công (info), retry queue (warn), message vào DLQ (error), gửi thư lỗi (warn), webhook hết lượt thử (warn), lỗi Cloudflare API (warn, kèm mã lỗi Cloudflare), cron job (info) |
| QS-04 | Cảnh báo vận hành (qua công cụ log/alert của nền tảng): DLQ có message; tỉ lệ gửi lỗi > 10% trong 1 giờ; cron không chạy trong 26 giờ |
| QS-05 | `GET /api/setup/status` dùng làm health check (không cần auth, không lộ dữ liệu) |
| QS-06 | Không log PII vượt mức cần thiết: địa chỉ email chỉ log ở sự kiện nhận/gửi/reject; không log subject, body, header đầy đủ |

## 6. Quyết định thiết kế cần chốt
Các lựa chọn sản phẩm dưới đây có phương án mặc định; người triển khai chốt trước khi bắt đầu và giữ nhất quán ở mọi nơi liên quan.

| # | Quyết định | Mặc định | Phương án thay thế | Chi tiết |
|---|---|---|---|---|
| 1 | Chuẩn hoá local-part khi nhận thư | Bỏ `+tag`, bỏ dấu chấm, lowercase (kiểu Gmail); kiểm tra trùng khi tạo mailbox/alias theo dạng chuẩn hoá | Chỉ bỏ `+tag` + lowercase, giữ dấu chấm | [00-nen-tang/06 §6](../00-nen-tang/06-quy-uoc-chung.md), [01-co-ban/06](../01-co-ban/06-nhan-thu.md) |
| 2 | Xoá tài khoản người dùng | Không xoá, chỉ khoá (`disabled`); mailbox vẫn nhận thư | `DELETE /api/accounts/{id}` xoá dây chuyền (rule Cloudflare, R2, dữ liệu) với các điều kiện chặn | [02-nang-cao/16 §4.5](../02-nang-cao/16-da-nguoi-dung-shared-mailbox.md) |
| 3 | Tự xoá Trash/Spam | Sau 30 ngày | Không tự xoá (chỉ thủ công) — `TRASH_RETENTION_DAYS=0` | [00-nen-tang/02 §4.4](../00-nen-tang/02-kien-truc-cloudflare.md) |
| 4 | Thời hạn lưu audit log | 365 ngày | Giữ mãi (`AUDIT_RETENTION_DAYS=0`) | [02-nang-cao/18 §6](../02-nang-cao/18-nhat-ky-audit.md) |
| 5 | Email khôi phục thuộc domain của hệ thống | Chấp nhận + cảnh báo trên UI | API từ chối 400 | [01-co-ban/03 §5](../01-co-ban/03-ho-so-mat-khau.md) |
| 6 | Nơi lưu tuỳ chọn hiển thị (conversation view, latest first) | Bộ nhớ trình duyệt, theo từng thiết bị | Lưu trên `users` + `/api/settings/display`, đồng bộ nhiều thiết bị | [02-nang-cao/19](../02-nang-cao/19-cai-dat-ca-nhan-avatar.md) |
| 7 | Danh sách người gửi tin cậy để tự hiện ảnh | Bộ nhớ trình duyệt | Lưu trong cài đặt người dùng | [01-co-ban/08 §5.2](../01-co-ban/08-doc-thu.md) |
| 8 | Tra Gravatar cho liên hệ mới (gửi hash email ra bên thứ ba) | Bật | Tắt (`GRAVATAR_ENABLED=false`) | [03-tuy-chon/07 §6](../03-tuy-chon/07-tien-ich-giao-dien.md) |
| 9 | Secret ký webhook | Lưu trong D1 dạng rõ (cần để ký; ai đọc được D1 đã có toàn quyền) | Mã hoá AES-GCM như TOTP secret | [02-nang-cao/12](../02-nang-cao/12-webhook.md) |
| 10 | Nguồn entitlement | Không cấu hình gì → bật mọi tính năng | Cờ tĩnh `ENTITLEMENTS` hoặc máy chủ license | [03-tuy-chon/01](../03-tuy-chon/01-license-branding.md) |
| 11 | Khôi phục thảm hoạ | D1 Time Travel + versioning R2 | Backup JSON trong ứng dụng | [03-tuy-chon/04](../03-tuy-chon/04-backup.md) |

## 7. Tiêu chí chấp nhận chung
- [ ] Grep log của một chu trình đăng nhập → gửi → nhận → đọc không thấy mật khẩu, token, API key, subject hay body.
- [ ] Thư tới địa chỉ không tồn tại bị reject và không để lại object R2.
- [ ] POST có cookie hợp lệ nhưng `Origin` lạ → 403.
- [ ] Mỗi việc cron ghi đúng một dòng log `{job, deleted, remaining}` mỗi lần chạy.
- [ ] Mọi lỗi 500 có `requestId` trùng với header `X-Request-Id` và tìm được trong log.
