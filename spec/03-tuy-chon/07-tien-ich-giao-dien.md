# Tiện ích giao diện: phím tắt, command palette, unsubscribe, Gravatar

> **[TÙY CHỌN]**

## 1. Phím tắt
- Bật/tắt theo user: `users.keyboard_shortcuts_enabled` (mặc định true); `GET/PATCH /api/settings/shortcuts {enabled}`; UI Settings → Inbox, cập nhật lạc quan + hoàn tác khi lỗi. Đang tải → coi là tắt; tải lỗi → coi là bật.
- Quy tắc: bỏ qua khi đang gõ trong `input/textarea/select/contentEditable` (trừ `Escape` và ⌘/Ctrl+K); chuỗi phím (vd `g i`) reset sau **800 ms**; phím đơn không modifier yêu cầu không giữ Ctrl/Meta/Alt.

| Phím | Hành động | Phạm vi |
|---|---|---|
| ⌘K / Ctrl+K | Command palette | toàn cục |
| `?` | Bảng phím tắt | toàn cục |
| `c` | Soạn thư | toàn cục |
| `/` | Focus ô tìm kiếm | toàn cục |
| `g i` `g s` `g z` `g t` `g d` `g a` `g !` `g x` | Inbox, Starred, Snoozed, Sent, Drafts, Archived, Spam, Trash | toàn cục |
| `Escape` | Đóng palette/bảng trợ giúp | toàn cục |
| `e` / `y` | Archive | trang đọc thư |
| `#` | Trash | trang đọc thư |
| `r` | Reply | trang đọc thư |
| `!` | Report spam (thư đến chưa spam) | trang đọc thư |
| `u` | Quay lại | trang đọc thư |
(Xung đột đã biết: `g !` trong trang đọc kích hoạt cả "Go to Spam" và "Report spam".)

## 2. Command palette
Lệnh sẵn có: Compose, 8 lệnh điều hướng thư mục, "Account Settings", "Keyboard Shortcuts Cheat Sheet". Lọc chuỗi con không phân biệt hoa trên title/subtitle/category/keywords; ↑/↓ vòng, Enter chạy, Esc đóng; rỗng → "No matching commands found for "q"".

## 3. Unsubscribe
- Server tính `unsubscribeUrl` từ header `List-Unsubscribe` (xem [01-co-ban/08-doc-thu.md §3.1](../01-co-ban/08-doc-thu.md)); không hỗ trợ `List-Unsubscribe-Post` (one-click RFC 8058).
- Menu thư đến "Unsubscribe": có URL → mở tab mới (`noopener,noreferrer`), không gọi server.
- Không có URL → confirm "This email does not provide an unsubscribe link. It will be moved to Trash, and future emails from this sender will also be moved to Trash." → tạo rule mailbox `email exact <sender> → trash` → chuyển thư vào Trash.
- Đề xuất: hỗ trợ one-click POST từ server; `mailto:` → gửi thư unsubscribe tự động.

## 4. Gravatar
Chỉ khi **tạo mới** contact: `GET https://gravatar.com/avatar/<sha256(email)>?d=404&r=g&s=256` → nhận gif/jpeg/png/webp ≤ 2 MB → R2 `contact-avatars/<userId>/<encodeURIComponent(email)>`; preview `s=16` ≤ 32 KB. Lỗi → bỏ qua. Chạy **đồng bộ** trong pipeline nhận/gửi, không timeout → nên bỏ hoặc chuyển sang queue.
