# Khung ứng dụng, điều hướng, chọn mailbox, tìm kiếm, thông báo

> Nghiệp vụ: [01-co-ban/07-danh-sach-dem-thu.md](../01-co-ban/07-danh-sach-dem-thu.md), [01-co-ban/14-tim-kiem.md](../01-co-ban/14-tim-kiem.md), [02-nang-cao/04-realtime.md](../02-nang-cao/04-realtime.md)

## 1. Layout dashboard [CƠ BẢN]
Lưới `[sidebar] [nội dung]`. Header: ô tìm kiếm, link trợ giúp (→ `/settings/account`), chỉ báo license (TÙY CHỌN), mailbox selector. Composer nổi được gắn toàn cục. Layout settings tương tự nhưng không có thanh kéo độ rộng.

## 2. Sidebar
- Độ rộng 200–480 px (mặc định 260), lưu theo user; chế độ thu gọn 72 px (lưu theo user). Kéo cạnh để đổi (giới hạn thêm `innerWidth − 570`), lưu khi thả.
- Header: nút thu gọn/mở rộng, logo + tên app → `/inbox`.
- Footer (khi không thu gọn): nút "Shortcuts ?" (nếu bật phím tắt), "Powered by Mailflare v<version>".

## 3. Menu thư mục [CƠ BẢN]
Thứ tự: **Compose** (nút chính, mở composer nổi) · Inbox · Starred · Snoozed · Sent · Drafts · Archived · Spam · Trash · mục **Folders**.
- Số: `counts.folders[x].unread` của mailbox đang chọn; chỉ hiện khi > 0, > 99 → "99+"; thu gọn → chấm xanh. Folder tuỳ chỉnh dùng `customFolders[id].unread`.
- Active khi `pathname == href` hoặc bắt đầu `href + "/"`.
- **Điều hướng có tải trước**: thanh tiến trình (12 → +8 mỗi 80 ms, tối đa 90) → prefetch route → tải trang 1 danh sách (limit 25) chờ tối thiểu 350 ms → 100% → chờ 160 ms → chuyển trang. Bỏ qua khi giữ phím modifier.
- **Thả thư** (kéo từ Inbox) lên: Archived → `archive`, Spam → `spam`, Trash → `trash`, folder → `folder`. Payload MIME `application/x-mailflare-message-ids`.
- **Folders**: `GET /api/folders?mailboxId=`; rỗng → "No folders yet"; nút "+" → dialog "Create folder" (tên placeholder "Receipts", chọn 1/8 màu) → `POST /api/folders`; lỗi im lặng.

## 4. Mailbox provider & selector [CƠ BẢN]
- `GET /api/mailboxes` (cache theo phiên). Chọn mặc định: `selected-mailbox-id` còn tồn tại → primary mailbox → mailbox đầu.
- Nút avatar (ảnh hoặc chữ cái trên nền màu băm). Dropdown 360 px:
  - thẻ mailbox đang chọn (tên, biểu tượng "Shared inbox", địa chỉ);
  - link "Calendar", "Settings";
  - "Other accounts": các mailbox khác kèm số unread (đếm không lọc mailbox, chỉ tải khi mở menu);
  - "Admin" (chỉ admin);
  - "Sign out" → logout → `/login`.
- Đổi mailbox → mọi danh sách, đếm, folder, composer From theo mailbox mới.

## 5. Ô tìm kiếm [CƠ BẢN]
- Debounce **250 ms**; xoá ô → áp dụng ngay.
- Placeholder "Search mail (press / to focus)" (khi bật phím tắt) hoặc "Search mail"; nút X xoá; chip "⌘K" khi ô rỗng.
- `is:unread|read`, `:unread|:read` tách thành tham số `read`; phần còn lại gửi `q`. Toggle "chỉ chưa đọc" ở Inbox ưu tiên hơn `read` từ chuỗi.
- Tìm trong thư mục đang mở.

## 6. Thông báo thư mới [NÂNG CAO]
- WebSocket `/api/realtime` (xem file realtime): heartbeat 25 s, reconnect `min(1000·2^n, 30 000)` ms, fallback làm mới 60 s.
- Popup góc phải trên: "New email", subject hoặc "(no subject)", "From <tên>"; click → `/inbox/<id>`; X để đóng; tự ẩn **8 s**.
- `Notification` trình duyệt chỉ khi quyền đã `granted` và tab ẩn. **Không có** nút xin quyền — nên thêm.
