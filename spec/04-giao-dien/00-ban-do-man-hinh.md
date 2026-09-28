# Bản đồ màn hình & hạ tầng phía client

> Nhóm giao diện mô tả **hành vi** cần giữ khi dựng lại UI (không ràng buộc framework). Nghiệp vụ server nằm ở `01-co-ban/`, `02-nang-cao/`.

## 1. Bản đồ route
| URL | Guard | Màn hình | Nhãn |
|---|---|---|---|
| `/` | public | Landing | TÙY CHỌN |
| `/login` | chưa có admin → `/setup`; đã đăng nhập → `/inbox` | Đăng nhập + bước MFA | CƠ BẢN |
| `/setup` | xem [01-xac-thuc-khoi-tao.md](01-xac-thuc-khoi-tao.md) | Wizard lần đầu / Onboarding | CƠ BẢN |
| `/register`, `/onboarding` | → `/setup` | | |
| `/forgot-password`, `/reset-password?token=` | public | Quên / đặt lại mật khẩu | NÂNG CAO |
| `/inbox`, `/starred`, `/snoozed`, `/sent`, `/archived`, `/spam`, `/trash`, `/folders/{id}` | đăng nhập | Danh sách + khung đọc | CƠ BẢN (starred/snoozed/folders: NÂNG CAO) |
| `/<thư mục>/{messageId}` | đăng nhập | Đọc thư | CƠ BẢN |
| `/drafts`, `/drafts/{id}` | đăng nhập | Nháp (click mở composer) | CƠ BẢN |
| `/compose` | đăng nhập | Composer toàn trang | CƠ BẢN |
| `/calendar` | đăng nhập | Lịch | TÙY CHỌN |
| `/settings/account`, `/settings/inbox`, `/settings/rules`, `/settings/import`, `/settings/export` | đăng nhập | Cài đặt | CƠ BẢN/NÂNG CAO |
| `/admin`, `/domains`, `/mailboxes`, `/mailboxes/{id}`, `/accounts`, `/accounts/{id}[/permissions|/mailboxes]`, `/routing`, `/webhooks`, `/api-keys`, `/backups`, `/licenses`, `/branding`, `/activity` | admin + có mailbox | Quản trị | xem [07-quan-tri.md](07-quan-tri.md) |
Chuyển hướng: `/rules`, `/settings` → `/settings/account`; `/import-export`, `/settings/import-export` → `/settings/import`; `/settings/auto-reply` → `/settings/inbox`; `/audit-logs` → `/activity`.

## 2. Guard (AuthGuard)
1. Gọi `GET /api/auth/me` (cookie, timeout 5 s); 401 → thử lại với Bearer.
2. Không OK: trang bảo vệ + 401 → `/login`; lỗi khác → vẫn hiển thị.
3. OK + trang public → `/inbox`.
4. `requireMailbox` + admin + `hasMailboxes=false` + `isSetup=false` → `/setup`.
5. Ở `/setup` mà `isSetup=true` → `/inbox`.
6. `requireRole` không khớp → `/inbox`.
Lần tải đầu hiển thị loader toàn màn hình tối thiểu 600 ms; điều hướng sau có thanh tiến trình trên cùng.

## 3. Bus sự kiện phía client
| Sự kiện | Phát bởi | Tác dụng |
|---|---|---|
| `messages-changed` | bulk, snooze, gửi, xoá nháp, import, realtime, fallback 60 s, đánh dấu đọc | làm mới danh sách, đếm, hội thoại |
| `message-counts-changed` | gắn sao | làm mới đếm |
| `message-counts-delta {inboxUnreadDelta}` | đọc/chưa đọc lạc quan | chỉnh số unread Inbox cục bộ (≥0) |
| `auth-session-changed` | đăng nhập/đăng xuất | xoá cache người dùng, mailbox đã chọn; khởi động lại WebSocket |
| `conversation-view-changed`, `latest-messages-first-changed` | cài đặt | đọc lại localStorage |
| `contact-changed`, đổi avatar/tên | form liên hệ/hồ sơ | cập nhật tên/ảnh ở mọi nơi |

## 4. Bộ nhớ trình duyệt
`mailflare-session-token` (khuyến nghị bỏ — chỉ dùng cookie), `selected-mailbox-id`, `mailflare-sidebar-minimal:<uid>`, `mailflare-column-width:sidebar:<uid>`, `mailflare-column-width:message-list:<uid>`, `mailflare-conversation-view`, `mailflare-latest-messages-first`.

## 5. Cache & làm mới
React Query: không refetch khi focus/reconnect/mount, `staleTime` 60 s. Danh sách thư và đếm: cache theo query string, poll **15 s**. Webhook deliveries poll 15 s; backups poll 5 s khi đang chạy.

## 6. Quy ước chung UI
- Hầu hết màn hình dùng thông báo inline; toast chỉ có trong composer (3,2 s).
- `DialogContent` dài phải có `max-h-[calc(100vh-4rem)] overflow-y-auto`.
- Hỏi xác nhận chỉ có ở: xoá mailbox, xoá sự kiện lịch, restore backup, huỷ license, unsubscribe không có link. **Không** hỏi khi: xoá domain, webhook, rule, alias, thành viên, backup, mailbox của tài khoản — nên bổ sung khi viết lại.
- Tiêu đề trang danh sách: `"<Thư mục> (<n>) - <địa chỉ mailbox>"` (n = unread nếu > 0, ngược lại tổng).

## 7. Các file trong nhóm
| File | Nội dung |
|---|---|
| [01-xac-thuc-khoi-tao.md](01-xac-thuc-khoi-tao.md) | Landing, login, MFA, setup wizard, onboarding, quên/đặt lại mật khẩu |
| [02-khung-dieu-huong.md](02-khung-dieu-huong.md) | Layout, sidebar, nav + đếm, folder, mailbox selector, tìm kiếm, realtime/popup |
| [03-danh-sach-thu.md](03-danh-sach-thu.md) | Danh sách, dòng thư, chọn & bulk, hover actions, snooze, split view |
| [04-doc-thu.md](04-doc-thu.md) | Trang đọc, toolbar, hội thoại, attachment, nguồn, liên hệ |
| [05-soan-thu.md](05-soan-thu.md) | Composer, người nhận, editor, chữ ký, attachment, hẹn giờ, gửi |
| [06-cai-dat.md](06-cai-dat.md) | Settings: account, inbox, rules, import/export |
| [07-quan-tri.md](07-quan-tri.md) | Admin: overview, domains, mailboxes, accounts, routing, webhooks, api-keys, backups, licenses, branding, activity |
