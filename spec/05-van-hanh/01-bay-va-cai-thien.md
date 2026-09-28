# Các bẫy đã biết & điểm nên cải thiện khi xây dựng lại

> Mỗi mục: **hiện trạng** → **khuyến nghị**. Nhãn mức độ: 🔴 dữ liệu/bảo mật · 🟠 nghiệp vụ sai/khó hiểu · 🟡 hiệu năng/vận hành.

## 1. Nhận thư
| # | Mức | Hiện trạng | Khuyến nghị | File |
|---|---|---|---|---|
| 1 | 🟡 | Thư tới địa chỉ không tồn tại vẫn ghi R2 + enqueue; consumer bỏ → object mồ côi mãi | `setReject("Unknown recipient")` trong `email()` khi không phân giải được | [06-nhan-thu](../01-co-ban/06-nhan-thu.md) |
| 2 | 🟠 | Chuẩn hoá bỏ `.` và `+tag` → `a.b` và `ab` là một; tạo mailbox chỉ kiểm tra trùng chính xác | Quyết định có giữ quy tắc; nếu giữ, kiểm tra trùng theo dạng chuẩn hoá | [05-quan-ly-mailbox](../01-co-ban/05-quan-ly-mailbox.md) |
| 3 | 🟠 | Rule domain theo `title/content` không bao giờ khớp (handler chỉ có envelope) | Bỏ lựa chọn hoặc đọc header trong handler | [02-rule-domain](../02-nang-cao/02-rule-domain.md) |
| 4 | 🟡 | Phân giải địa chỉ 2 lần (handler + consumer), có thể lệch | Truyền `decision` trong payload queue | |
| 5 | 🟡 | Đọc toàn bộ thư vào bộ nhớ ở handler và consumer | Stream thẳng lên R2, giới hạn kích thước | |
| 6 | 🟡 | Webhook, Gravatar, auto-reply chạy đồng bộ trong consumer | Đẩy sang queue riêng | |
| 7 | 🟡 | Queue hết retry → thư bị bỏ | Cấu hình dead-letter queue + cảnh báo | |

## 2. Gửi thư
| # | Mức | Hiện trạng | Khuyến nghị |
|---|---|---|---|
| 8 | 🟠 | Thư `failed`/`queued` không hiện ở thư mục nào | Thư mục Outbox/Scheduled, nút gửi lại, huỷ hẹn giờ |
| 9 | 🟠 | Không kiểm tra lại quyền người gửi khi thư hẹn giờ tới giờ | Kiểm tra lại trong consumer |
| 10 | 🟠 | Lỗi "quá 50 người nhận"/attachment trả 500 | Map thành 400 |
| 11 | 🟠 | Server không xoá nháp sau khi gửi (client làm) | Server xoá nháp khi `draftId` có mặt và gửi thành công |
| 12 | 🟠 | Auto-reply không gắn `threadId` | Truyền threadId của thư đến |

## 3. Tổ chức & dữ liệu
| # | Mức | Hiện trạng | Khuyến nghị |
|---|---|---|---|
| 13 | 🔴 | Không có xoá vĩnh viễn; Trash/Spam tích luỹ; session/token/challenge hết hạn không dọn | Endpoint xoá vĩnh viễn + cron dọn dẹp (`scheduled`) |
| 14 | 🔴 | Xoá domain/mailbox để lại thư mồ côi (`mailbox_id NULL`) và object R2 | Chặn xoá khi còn thư, hoặc xoá cứng kèm R2 |
| 15 | 🔴 | Bulk `folder` không kiểm tra folder cùng mailbox với thư | Thêm điều kiện |
| 16 | 🟠 | `POST /status` cho phép set `sent`/`draft` cho thư bất kỳ | Giới hạn `received|archived|trash|spam` |
| 17 | 🟠 | Xoá domain tắt Email Routing của zone kể cả khi routing có từ trước | Chỉ tắt nếu hệ thống bật (lưu cờ lúc provision) |
| 18 | 🟠 | Tắt `useAllDomains` không xoá rule Cloudflare | Xoá rule các domain phụ |
| 19 | 🟠 | Không có sửa/xoá folder, bỏ chặn liên hệ, thu hồi API key, xoá tài khoản qua REST | Bổ sung |
| 20 | 🟡 | `/api/messages/counts` tải mọi dòng | `GROUP BY` trong SQL |
| 21 | 🟡 | FTS index cả thẻ HTML | Index text đã strip |

## 4. Bảo mật
| # | Mức | Hiện trạng | Khuyến nghị |
|---|---|---|---|
| 22 | 🔴 | Token phiên trả trong JSON + lưu localStorage + Bearer | Chỉ cookie HttpOnly + chống CSRF (kiểm tra `Origin`) |
| 23 | 🔴 | `/api/setup/prepare` public chạy migration khi chưa có admin (không kiểm tra DB trống) | Giới hạn bằng secret setup hoặc chỉ khi chưa có bảng |
| 24 | 🔴 | Register không khoá đồng thời | Ràng buộc DB / khoá |
| 25 | 🔴 | Ảnh remote trong thư tải trực tiếp (tracking) | Chặn mặc định / proxy ảnh |
| 26 | 🔴 | IMAP SSRF guard chỉ chặn tên + IPv4 literal | Chặn IPv6, 0.0.0.0, 100.64/10; kiểm tra IP sau phân giải |
| 27 | 🔴 | License key bị log plain (Paymug) | Bỏ log (hoặc bỏ license) |
| 28 | 🟠 | Email đăng nhập không lowercase | Chuẩn hoá |
| 29 | 🟠 | TOTP không chống dùng lại trong cửa sổ 30 s | Lưu counter cuối |
| 30 | 🟠 | Reset mật khẩu: token cũ vẫn hiệu lực khi yêu cầu mới; không rate limit | Vô hiệu token cũ; rate limit theo email/IP |
| 31 | 🟠 | Relay `/api/inbound` không chống replay | Thêm timestamp vào chữ ký |
| 32 | 🟠 | TOTP secret, webhook secret lưu plain | Mã hoá bằng khoá trong secret Worker |
| 33 | 🟠 | Chủ domain nhận realtime cho mailbox mình không đọc được | Chỉ thông báo user có `canRead` |

## 5. API & nhất quán
| # | Mức | Hiện trạng | Khuyến nghị |
|---|---|---|---|
| 34 | 🟠 | Nhiều route cũ `requireUser` ném → 500 khi chưa đăng nhập; route backup/license trả 403/400 chung chung | Middleware chuẩn 401/403, map lỗi rõ ràng |
| 35 | 🟠 | API key: sai key và thiếu scope đều 401 | 401 vs 403 |
| 36 | 🟠 | `/api/v1/messages`, `/api/messages/{id}` trả `rawR2Key` | Loại khỏi response |
| 37 | 🟠 | `GET /api/accounts` liệt kê mọi user (không lọc theo người tạo) | Lọc nhất quán |
| 38 | 🟠 | Admin sửa tên tài khoản → đổi `displayName` mọi mailbox personal; avatar tài khoản không sync | Dùng `syncPersonalIdentity` |
| 39 | 🟡 | `CF_API_KEY+CF_EMAIL` ưu tiên hơn `CF_TOKEN` | Chọn một quy tắc, ghi rõ |
| 40 | 🟡 | Tên Email Worker hard-code `"mailflare"` | Biến cấu hình |
| 41 | 🟡 | bcrypt đồng bộ cho mỗi request API key | SHA-256 + so sánh constant-time cho key ngẫu nhiên |
| 42 | 🟡 | `recordRuleMatch` đọc-rồi-ghi | `UPDATE … SET match_count = match_count + 1` |
| 43 | 🟡 | Kiểm tra license ghi DB mỗi lần đọc | Bỏ license hoặc cache |

## 6. Giao diện
| # | Hiện trạng | Khuyến nghị |
|---|---|---|
| 44 | Thiếu xác nhận ở nhiều thao tác xoá | Thêm confirm |
| 45 | "Move to" không có folder; chỉ kéo thả | Thêm folder vào menu |
| 46 | Không có thư trước/sau, cuộn vô hạn, xin quyền Notification | Bổ sung |
| 47 | Composer nổi vẫn mở sau khi gửi | Đóng |
| 48 | Wizard setup mặc định tắt sending, dialog domain admin mặc định bật | Thống nhất |
| 49 | Import không hiện danh sách lỗi | Hiện `errors[]` |
