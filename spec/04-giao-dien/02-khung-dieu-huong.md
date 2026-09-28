# Khung ứng dụng, điều hướng, chọn mailbox, tìm kiếm, thông báo

> Nghiệp vụ: [01-co-ban/07-danh-sach-dem-thu.md](../01-co-ban/07-danh-sach-dem-thu.md), [01-co-ban/14-tim-kiem.md](../01-co-ban/14-tim-kiem.md), [02-nang-cao/03-folder-tuy-chinh.md](../02-nang-cao/03-folder-tuy-chinh.md), [02-nang-cao/04-realtime.md](../02-nang-cao/04-realtime.md)

## 1. Layout dashboard [CƠ BẢN]
Lưới `[sidebar] [nội dung]`. Header: ô tìm kiếm, link trợ giúp (→ `/settings/account`), mailbox selector. Composer nổi được gắn toàn cục (mở được từ mọi màn hình dashboard). Layout Settings tương tự nhưng không có thanh kéo độ rộng.

## 2. Sidebar
- Độ rộng 200–480 px (mặc định 260), lưu theo user; chế độ thu gọn 72 px (lưu theo user). Kéo cạnh để đổi (giới hạn thêm `innerWidth − 570`), lưu khi thả.
- Header: nút thu gọn/mở rộng, logo + tên app (`{APP_NAME}` hoặc branding tuỳ chỉnh) → `/inbox`.
- Footer (khi không thu gọn): nút "Shortcuts ?" (chỉ khi bật phím tắt) mở bảng phím tắt.

## 3. Menu thư mục [CƠ BẢN]
Thứ tự: **Compose** (nút chính, mở composer nổi) · Inbox · Starred · Snoozed · Sent · Scheduled · Outbox · Drafts · Archived · Spam · Trash · mục **Folders**.
- Số hiển thị: `counts.folders[x].unread` của mailbox đang chọn; chỉ hiện khi > 0; > 99 → "99+"; chế độ thu gọn → chấm màu. Folder tuỳ chỉnh dùng `customFolders[id].unread`.
- **Scheduled** hiện số `total` của bucket `scheduled`, ẩn khi bằng 0 ([02-nang-cao/05](../02-nang-cao/05-hen-gio-gui.md)).
- **Outbox** hiện số thư `failed` (nổi bật màu đỏ); ẩn khi Outbox trống ([01-co-ban/11 §5](../01-co-ban/11-gui-thu.md)).
- Mục active khi `pathname == href` hoặc bắt đầu bằng `href + "/"`.
- **Điều hướng có tải trước**: thanh tiến trình (12 → +8 mỗi 80 ms, tối đa 90) → tải trước route → tải trang 1 danh sách (limit 25), chờ tối thiểu 350 ms → 100% → chờ 160 ms → chuyển trang. Giữ phím modifier (mở tab mới) → bỏ qua cơ chế này.
- **Thả thư** (kéo từ danh sách) lên: Inbox → `inbox`, Archived → `archive`, Spam → `spam`, Trash → `trash`, folder → `folder`. Dữ liệu kéo dùng kiểu MIME riêng `application/x-app-message-ids`; mục đích thả được làm nổi khi kéo qua.
- **Folders**:
  - `GET /api/folders?mailboxId=`; mỗi dòng: chấm màu + tên + số chưa đọc; rỗng → "No folders yet".
  - Nút "+" → dialog "Create folder" (tên, placeholder "Receipts"; chọn 1/8 màu) → `POST /api/folders`; lỗi (vd trùng tên) hiển thị inline trong dialog.
  - Menu ngữ cảnh mỗi folder (chỉ khi user có quyền quản lý mailbox): "Rename" / "Change color" (dialog như tạo, điền sẵn) → `PATCH /api/folders/{id}`; "Delete folder" → dialog xác nhận `Delete "{name}"?` với lựa chọn "Move emails to Inbox" (mặc định) / "Move emails to Trash" → `DELETE /api/folders/{id}?moveTo=inbox|trash`.
  - Folder đang mở bị xoá → điều hướng về `/inbox`.

## 4. Mailbox selector [CƠ BẢN]
- `GET /api/mailboxes` (cache theo phiên). Chọn mặc định: `app-selected-mailbox-id` còn tồn tại → primary mailbox → mailbox đầu tiên.
- Nút avatar (ảnh hoặc chữ cái đầu trên nền màu băm từ địa chỉ). Dropdown 360 px:
  - thẻ mailbox đang chọn (tên, biểu tượng "Shared inbox" nếu là shared, địa chỉ);
  - link "Calendar", "Settings";
  - "Other accounts": các mailbox khác kèm số unread (đếm không lọc mailbox, chỉ tải khi mở menu);
  - "Admin" (chỉ admin);
  - "Sign out" → `POST /api/auth/logout` → phát `app:auth-session-changed` → `/login`.
- Đổi mailbox → mọi danh sách, đếm, folder và From mặc định của composer chuyển sang mailbox mới; lưu lựa chọn.

## 5. Ô tìm kiếm [CƠ BẢN]
- Debounce **250 ms**; xoá ô → áp dụng ngay.
- Placeholder "Search mail (press / to focus)" (khi bật phím tắt) hoặc "Search mail"; nút X xoá; chip "⌘K" khi ô rỗng.
- `is:unread|read`, `:unread|:read` được tách thành tham số `read`; phần còn lại gửi làm `q`. Toggle "chỉ chưa đọc" ở Inbox ưu tiên hơn `read` lấy từ chuỗi.
- Tìm trong thư mục đang mở; kết quả dùng cùng cấu hình danh sách ([03-danh-sach-thu.md](03-danh-sach-thu.md)).

## 6. Thông báo thư mới [NÂNG CAO]
- WebSocket `/api/realtime` (xem [02-nang-cao/04](../02-nang-cao/04-realtime.md)): heartbeat 25 s, reconnect `min(1000·2^n, 30 000)` ms, fallback làm mới mỗi 60 s khi mất kết nối.
- Popup góc phải trên: "New email", subject hoặc "(no subject)", "From <tên>"; click → `/inbox/<id>`; nút X đóng; tự ẩn sau **8 s**.
- Notification của trình duyệt khi quyền `granted` **và** tab đang ẩn (title = subject hoặc "New email", body "From …", click → focus tab và mở thư).
- **Lời mời bật thông báo**: khi quyền Notification đang `default`, hiện banner có thể đóng ở đầu danh sách thư: "Get notified about new email" + nút "Enable notifications" (chỉ khi bấm mới gọi yêu cầu quyền của trình duyệt) và "Not now" (ẩn banner, ghi nhớ `app-notification-prompt-dismissed:<uid>`). Quyền `denied` hoặc trình duyệt không hỗ trợ → không hiện banner.

## 7. Tiêu chí chấp nhận
- [ ] Sidebar không có chân trang quảng bá; chỉ có nút "Shortcuts ?" khi bật phím tắt.
- [ ] Một thư gửi lỗi → Outbox xuất hiện với số 1 màu đỏ; gửi lại thành công → Outbox ẩn.
- [ ] Kéo thư lên folder ở sidebar → thư vào folder, danh sách làm mới.
- [ ] Banner thông báo chỉ gọi yêu cầu quyền khi bấm "Enable notifications"; "Not now" không hiện lại sau khi tải lại trang.
