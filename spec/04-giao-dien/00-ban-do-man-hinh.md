# Bản đồ màn hình & hạ tầng phía client

> Nhóm giao diện mô tả **hành vi màn hình** cần có, không ràng buộc framework hay thư viện UI. Nghiệp vụ server nằm ở `01-co-ban/`, `02-nang-cao/`, `03-tuy-chon/`.

## 1. Bản đồ route
| URL | Guard | Màn hình | Nhãn |
|---|---|---|---|
| `/` | public | Landing | TÙY CHỌN |
| `/login` | chưa có admin → `/setup`; đã đăng nhập → `/inbox` | Đăng nhập + bước MFA | CƠ BẢN |
| `/setup` | xem [01-xac-thuc-khoi-tao.md](01-xac-thuc-khoi-tao.md) | Wizard lần đầu / Onboarding | CƠ BẢN |
| `/register`, `/onboarding` | → `/setup` | | |
| `/forgot-password`, `/reset-password?token=` | public | Quên / đặt lại mật khẩu | NÂNG CAO |
| `/inbox`, `/starred`, `/snoozed`, `/sent`, `/scheduled`, `/outbox`, `/archived`, `/spam`, `/trash`, `/folders/{id}` | đăng nhập | Danh sách + khung đọc | CƠ BẢN (starred/snoozed/scheduled/folders: NÂNG CAO) |
| `/<thư mục>/{messageId}` | đăng nhập | Đọc thư | CƠ BẢN |
| `/drafts`, `/drafts/{id}` | đăng nhập | Nháp (click mở composer) | CƠ BẢN |
| `/compose` | đăng nhập | Composer toàn trang | CƠ BẢN |
| `/calendar` | đăng nhập | Lịch | TÙY CHỌN |
| `/settings/account`, `/settings/inbox`, `/settings/rules`, `/settings/import`, `/settings/export` | đăng nhập | Cài đặt | CƠ BẢN/NÂNG CAO |
| `/admin`, `/domains`, `/mailboxes`, `/mailboxes/{id}`, `/accounts`, `/accounts/{id}[/permissions|/mailboxes]`, `/routing`, `/webhooks`, `/api-keys`, `/backups`, `/licenses`, `/branding`, `/activity`, `/audit-logs` | admin + có mailbox | Quản trị | xem [07-quan-tri.md](07-quan-tri.md) |

Chuyển hướng: `/rules`, `/settings` → `/settings/account`; `/import-export`, `/settings/import-export` → `/settings/import`; `/settings/auto-reply` → `/settings/inbox`.

`/scheduled` liệt kê thư đang hẹn giờ ([02-nang-cao/05-hen-gio-gui.md](../02-nang-cao/05-hen-gio-gui.md)); `/outbox` liệt kê thư đi `queued`/`failed` còn lại, có nút gửi lại ([01-co-ban/11-gui-thu.md §5](../01-co-ban/11-gui-thu.md)).

## 2. Guard
Phiên đăng nhập **chỉ** nằm trong cookie HttpOnly `ep_session`; client không lưu và không đọc token phiên. Mọi request ghi gửi kèm cookie; server kiểm tra header `Origin` (chống CSRF).
1. Gọi `GET /api/auth/me` (cookie, timeout 5 s).
2. Không OK: trang bảo vệ + 401 → `/login`; lỗi khác (mạng, 5xx) → vẫn hiển thị khung với thông báo lỗi và nút thử lại.
3. OK + trang public (`/login`, `/`) → `/inbox`.
4. Trang cần mailbox + admin + `hasMailboxes = false` + `isSetup = false` → `/setup`.
5. Ở `/setup` mà `isSetup = true` → `/inbox`.
6. Trang cần role mà role không khớp → `/inbox`.
7. Mọi response 401 sau đó (phiên hết hạn giữa chừng) → `/login?next=<đường dẫn hiện tại>`.

Lần tải đầu hiển thị loader toàn màn hình tối thiểu 600 ms; điều hướng sau có thanh tiến trình trên cùng.

## 3. Sự kiện nội bộ phía client
Các màn hình đồng bộ với nhau qua sự kiện nội bộ (tên có tiền tố `app:`):
| Sự kiện | Phát bởi | Tác dụng |
|---|---|---|
| `app:messages-changed` | bulk, snooze, gửi, xoá nháp, xoá vĩnh viễn, import, realtime, fallback 60 s, đánh dấu đọc | làm mới danh sách, đếm, hội thoại |
| `app:message-counts-changed` | gắn sao | làm mới đếm |
| `app:message-counts-delta {inboxUnreadDelta}` | đọc/chưa đọc lạc quan | chỉnh số unread Inbox cục bộ (≥ 0) |
| `app:auth-session-changed` | đăng nhập/đăng xuất | xoá cache người dùng và mailbox đã chọn; khởi động lại WebSocket |
| `app:conversation-view-changed`, `app:latest-messages-first-changed` | cài đặt | đọc lại tuỳ chọn hiển thị |
| `app:contact-changed`, đổi avatar/tên | form liên hệ/hồ sơ | cập nhật tên/ảnh ở mọi nơi |

## 4. Bộ nhớ trình duyệt
Chỉ lưu **tuỳ chọn hiển thị** của từng người xem (không bao giờ lưu token hay dữ liệu thư):
`app-selected-mailbox-id`, `app-sidebar-minimal:<uid>`, `app-column-width:sidebar:<uid>`, `app-column-width:message-list:<uid>`, `app-conversation-view`, `app-latest-messages-first`, `app-notification-prompt-dismissed:<uid>`.
Đọc/ghi phải chịu lỗi (chế độ riêng tư, bị chặn) và rơi về giá trị mặc định.

## 5. Cache & làm mới
- Cache phía client: không tự tải lại khi focus/kết nối lại/mount; dữ liệu được coi là mới trong 60 s.
- Danh sách thư và đếm: cache theo query string, poll **15 s** (ngoài realtime).
- Webhook deliveries poll 15 s; backups poll 5 s khi có backup `queued|running`.

## 6. Quy ước chung UI
- Thông báo kết quả thao tác: inline trong màn hình; toast dùng cho composer và các hành động trên thư (3,2 s).
- Dialog có nhiều trường giới hạn chiều cao theo viewport (`100vh − 4rem`) và cuộn bên trong, để nút xác nhận luôn truy cập được.
- **Mọi thao tác phá huỷ phải có dialog xác nhận** nêu rõ đối tượng và hậu quả, nút xác nhận kiểu "destructive". Danh sách tối thiểu:

| Thao tác | Thông điệp xác nhận |
|---|---|
| Xoá mailbox | "Delete {address}? This removes its email routing rule and permanently deletes its {n} email(s). This cannot be undone." (phần số thư chỉ khi n > 0) |
| Xoá domain | "Remove {hostname}? Its email routing and sending setup on Cloudflare will be removed." (domain còn mailbox → server trả 409, UI hiển thị "Delete the mailboxes on this domain first.") |
| Xoá alias | "Remove alias {address}?" |
| Xoá rule mailbox / rule domain | "Delete this rule?" |
| Xoá folder | `Delete "{name}"?` kèm lựa chọn "Move emails to Inbox" (mặc định) / "Move emails to Trash" |
| Xoá webhook | "Delete webhook {url}? Pending retries will be cancelled." |
| Thu hồi API key | "Revoke {name}? Apps using this key will stop working immediately." |
| Gỡ thành viên shared mailbox | "Remove {email} from {address}?" |
| Xoá mailbox của tài khoản | như "Xoá mailbox" |
| Xoá backup | "Delete this backup? The file will be removed from storage." |
| Restore backup | "Restore this backup? A safety backup is created first. This replaces all current database records and may sign you out." |
| Xoá vĩnh viễn thư / Empty trash | "Delete {n} email(s) forever? This cannot be undone." / "Delete all emails in Trash forever? This cannot be undone." |
| Xoá sự kiện lịch | "Delete this event?" |
| Huỷ license | "Deactivate this license? Features included in this license will be turned off." |
| Unsubscribe không có link | xem [03-tuy-chon/07 §5.3](../03-tuy-chon/07-tien-ich-giao-dien.md) |
| Bỏ chặn liên hệ | "Unblock {email}? Their emails will be delivered to the inbox again." |
| Tắt 2FA, tạo lại mã khôi phục | yêu cầu mật khẩu (dialog nhập) |

- Tiêu đề trang danh sách: `"<Thư mục> (<n>) - <địa chỉ mailbox>"` (n = unread nếu > 0, ngược lại tổng); không có n khi bằng 0.

## 7. Các file trong nhóm
| File | Nội dung |
|---|---|
| [01-xac-thuc-khoi-tao.md](01-xac-thuc-khoi-tao.md) | Landing, login, MFA, setup wizard, onboarding, quên/đặt lại mật khẩu |
| [02-khung-dieu-huong.md](02-khung-dieu-huong.md) | Layout, sidebar, nav + đếm, folder, mailbox selector, tìm kiếm, realtime/thông báo |
| [03-danh-sach-thu.md](03-danh-sach-thu.md) | Danh sách, dòng thư, chọn & bulk, hover actions, snooze, split view |
| [04-doc-thu.md](04-doc-thu.md) | Trang đọc, toolbar, điều hướng trước/sau, hội thoại, ảnh remote, attachment, nguồn, liên hệ |
| [05-soan-thu.md](05-soan-thu.md) | Composer, người nhận, editor, chữ ký, attachment, hẹn giờ, gửi |
| [06-cai-dat.md](06-cai-dat.md) | Settings: account, inbox, rules, import/export |
| [07-quan-tri.md](07-quan-tri.md) | Admin: overview, domains, mailboxes, accounts, routing, webhooks, api-keys, backups, licenses, branding, activity, audit log |
