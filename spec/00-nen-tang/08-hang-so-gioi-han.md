# Hằng số & giới hạn

> Thuộc nhóm: Nền tảng. Tất cả giá trị đều lấy từ code hiện tại.

## 1. Xác thực
| Hằng số | Giá trị | Nơi dùng |
|---|---|---|
| Hạn session | 30 ngày | cookie `ep_session` (`HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000; Secure` khi production) |
| Rate limit | 20 lần / 60 s / IP (`cf-connecting-ip`) | login, MFA verify |
| `Retry-After` khi 429 | 60 | |
| bcrypt | 12 (mật khẩu), 10 (API key) | |
| Mật khẩu | tối thiểu 8; đổi/reset/admin đặt: tối đa 128 | |
| Username / localPart | 1–64, `^[a-zA-Z0-9._%+-]+$` | register, tạo tài khoản, alias, account mailbox |
| Token reset mật khẩu | 30 phút, dùng 1 lần | |
| Login challenge MFA | 5 phút | |
| Recovery codes | 8 mã, dạng `xxxxx-xxxxx`, bảng chữ `abcdefghjkmnpqrstuvwxyz23456789` | |
| TOTP | HMAC-SHA1, 30 s, 6 số, chấp nhận ±1 bước, secret 20 byte | |
| Turnstile timeout | 10 s | |
| API key `lastUsedAt` | ghi tối đa 1 lần / 60 s | |

## 2. Thư
| Hằng số | Giá trị |
|---|---|
| Người nhận | ≤ 50 mỗi trường (validate), ≤ 50 tổng To+Cc+Bcc (send) |
| Chuỗi recipient | ≤ 5000 ký tự; mỗi phần tử mảng 3–500 ký tự |
| Subject khi gửi | 1–500 |
| `from` | 3–500 |
| `mailboxId` | 1–200 |
| `inReplyTo`, `threadId` | ≤ 998 |
| `references` | chuỗi ≤ 5000 hoặc mảng ≤ 50 phần tử ≤ 998 |
| Body text / html | ≤ 2 MB mỗi phần |
| Attachment gửi | ≤ 10 file, ≤ 10 MB/file, ≤ 20 MB tổng; base64 (API) ≤ 14 MB chuỗi |
| Attachment nhận | không kiểm tra trong app |
| Filename attachment (API) | 1–255 |
| Snippet | 200 ký tự |
| References giữ lại | 30 id |
| Danh sách thư | limit mặc định 50, tối đa 100 |
| Nháp liệt kê | 100 gần nhất |
| Thread view | 200 thư |
| Header đọc List-Unsubscribe | 64 KB đầu của raw |
| Hẹn giờ gửi | delay mỗi bước ≤ 86 400 s |
| Queue retry | 10 s, tối đa 3 lần |

## 3. Tổ chức & tự động
| Hằng số | Giá trị |
|---|---|
| Tên folder | 1–80 (trim) |
| Màu folder | `#2563eb` Blue (mặc định), `#7c3aed` Purple, `#db2777` Pink, `#dc2626` Red, `#ea580c` Orange, `#d97706` Amber, `#16a34a` Green, `#0d9488` Teal |
| Rule mailbox `matchValue` | 1–500; `pattern` ≤ 200 |
| Rule domain `name` | ≤ 120; `rejectReason` ≤ 200; `priority` 0–1000 |
| Rule chặn người gửi | priority 100 |
| Chữ ký | ≤ 10 000 |
| Auto-reply subject / body | ≤ 200 / ≤ 10 000; mặc định subject "Out of office" |
| Auto-reply chống lặp | 24 giờ / người gửi / mailbox |
| displayName mailbox / tên user / tên liên hệ | ≤ 100 |

## 4. Spam
| Hằng số | Giá trị |
|---|---|
| Ngưỡng | suspicious ≥ 40, spam ≥ 70 |
| Token ứng viên tối đa | 500 |
| Token Bayes mạnh nhất dùng | 20 |
| Đóng góp nội dung tối đa | ±30 |
| Độ tin cậy Bayes | `min(1, min(spamTotal, hamTotal)/20)` |
| Reputation tối thiểu | 3 phản hồi |
| Văn bản phân tích tối đa | 250 000 ký tự; ≤ 50 domain URL |

## 5. Tích hợp
| Hằng số | Giá trị |
|---|---|
| Webhook timeout | 10 s |
| Webhook backoff | `min(60·2^(attempt−1), 3600)` s → 1m, 2m, 4m, 8m, 16m, 32m, 60m… |
| Webhook maxAttempts | 1–10, mặc định 5 |
| Webhook error snippet | 500 ký tự; payload preview khi liệt kê 2000 ký tự |
| Webhook events | `message.inbound`, `message.outbound`, `message.failed` |
| Deliveries liệt kê | limit 25, tối đa 100 |
| API key scopes | `send`, `read`, `jmap`, `domains` (`*` = tất cả) |
| DoH timeout | 5 s |

## 6. Giao diện
| Hằng số | Giá trị |
|---|---|
| Autosave nháp | debounce 900 ms |
| Kích thước trang danh sách (UI) | 25 (API mặc định 50) |
| Polling danh sách & đếm | 15 s |
| WebSocket heartbeat | `"ping"` mỗi 25 s |
| WebSocket reconnect | `min(1000·2^attempt, 30 000)` ms |
| Fallback khi mất WebSocket | phát sự kiện làm mới mỗi 60 s |
| Popup thư mới | tự ẩn sau 8 s |
| Toast composer | 3,2 s |
| Debounce ô tìm kiếm | 250 ms |
| Chuỗi phím tắt | reset sau 800 ms |
| Sidebar | 200–480 px (mặc định 260), thu gọn 72 px |
| Cột danh sách (split view) | mặc định 360, 250 … (container − 280) |
| Avatar | ảnh nguồn jpeg/png/webp/gif ≤ 10 MB → client resize WebP: ≤512 px q0.85 (≤1 MB) + ≤16 px q0.7 (≤32 KB); cache immutable 1 năm khi có `?v=` |
| Gravatar | ≤ 2 MB, gif/jpeg/png/webp, `s=256`, `d=404`, `r=g` |
