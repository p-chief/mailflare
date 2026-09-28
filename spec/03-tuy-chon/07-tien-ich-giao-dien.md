# Tiện ích giao diện: phím tắt, command palette, unsubscribe, Gravatar

> **[TÙY CHỌN]** · Phụ thuộc: [01-co-ban/08-doc-thu.md](../01-co-ban/08-doc-thu.md) · Liên quan: [02-nang-cao/01-rule-mailbox.md](../02-nang-cao/01-rule-mailbox.md), [02-nang-cao/10-danh-ba-va-chan.md](../02-nang-cao/10-danh-ba-va-chan.md), [04-giao-dien/04-doc-thu.md](../04-giao-dien/04-doc-thu.md)

## 1. Mục tiêu
Các tiện ích tăng tốc thao tác: phím tắt bàn phím, command palette, huỷ đăng ký nhận thư (unsubscribe) một chạm, và ảnh đại diện liên hệ tự động từ Gravatar.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Bộ phím tắt cố định, bật/tắt theo user | Tuỳ biến phím |
| Command palette với danh sách lệnh cố định | Tìm thư trong palette |
| Unsubscribe: one-click (RFC 8058), `mailto:`, mở link, fallback rule Trash | Quản lý danh sách đã huỷ đăng ký |
| Gravatar khi tạo liên hệ mới | Làm mới ảnh định kỳ |

## 3. Phím tắt

### 3.1 Bật/tắt
- `users.keyboard_shortcuts_enabled` (mặc định true); `GET/PATCH /api/settings/shortcuts {enabled}` (phiên đăng nhập).
- UI Settings → Inbox: switch cập nhật lạc quan, hoàn tác khi lỗi. Khi đang tải trạng thái → coi là tắt; tải lỗi → coi là bật.

### 3.2 Quy tắc bắt phím
- Bỏ qua khi focus đang ở `input`, `textarea`, `select` hoặc vùng soạn thảo có thể sửa (trừ `Escape` và ⌘/Ctrl+K).
- Chuỗi phím (vd `g i`): sau phím `g`, chờ phím thứ hai tối đa **800 ms**; phím thứ hai **luôn thuộc về chuỗi** và không kích hoạt phím tắt đơn (vd `g !` chỉ là "Go to Spam", không kích hoạt "Report spam").
- Phím đơn không modifier chỉ kích hoạt khi không giữ Ctrl/Meta/Alt.

| Phím | Hành động | Phạm vi |
|---|---|---|
| ⌘K / Ctrl+K | Command palette | toàn cục |
| `?` | Bảng phím tắt | toàn cục |
| `c` | Soạn thư | toàn cục |
| `/` | Focus ô tìm kiếm | toàn cục |
| `g i` `g s` `g z` `g t` `g d` `g a` `g !` `g x` | Inbox, Starred, Snoozed, Sent, Drafts, Archived, Spam, Trash | toàn cục |
| `Escape` | Đóng palette/bảng trợ giúp | toàn cục |
| `j` / `k` | Thư kế tiếp / thư trước | trang đọc thư |
| `e` / `y` | Archive | trang đọc thư |
| `#` | Trash | trang đọc thư |
| `r` | Reply | trang đọc thư |
| `a` | Reply all | trang đọc thư |
| `f` | Forward | trang đọc thư |
| `!` | Report spam (thư đến chưa ở Spam) | trang đọc thư |
| `u` | Quay lại danh sách | trang đọc thư |

## 4. Command palette
- Mở bằng ⌘K/Ctrl+K. Lệnh: Compose, 8 lệnh điều hướng thư mục, "Account Settings", "Keyboard Shortcuts Cheat Sheet".
- Lọc chuỗi con không phân biệt hoa trên title/subtitle/category/keywords; ↑/↓ di chuyển vòng, Enter chạy, Esc đóng.
- Không có kết quả → `No matching commands found for "<q>"`.

## 5. Unsubscribe

### 5.1 Dữ liệu từ thư
- Chi tiết và metadata thư trả `unsubscribeUrl` (http(s) được ưu tiên, sau đó `mailto:`, hoặc `null`) — cách đọc header `List-Unsubscribe` từ 64 KB đầu của raw: xem [01-co-ban/08-doc-thu.md §4.1](../01-co-ban/08-doc-thu.md).
- Endpoint §5.2 đọc lại cùng khối header đó và tính thêm:
```
candidates = mọi URL http(s) và mailto: trong List-Unsubscribe (theo thứ tự xuất hiện)
oneClick   = header "List-Unsubscribe-Post: List-Unsubscribe=One-Click" có mặt
             và tồn tại URL https trong candidates
```

### 5.2 API — `POST /api/messages/{id}/unsubscribe`
Quyền: `canManage` trên mailbox của thư; chỉ thư inbound. Thứ tự xử lý:
1. `oneClick` → server gửi `POST <URL https đầu tiên>` với body `List-Unsubscribe=One-Click` (`application/x-www-form-urlencoded`), timeout 10 s, không theo redirect, host phải qua kiểm tra chống SSRF như IMAP ([03-tuy-chon/03 §7.2](03-import-export.md)) → 2xx: `{method: "one-click", ok: true}`; khác: 502 "The sender did not accept the unsubscribe request".
2. Có `mailto:` trong candidates → gửi thư từ địa chỉ nhận của mailbox tới địa chỉ đó (subject từ query hoặc "unsubscribe", body từ query hoặc "unsubscribe") qua thủ tục gửi thư ([01-co-ban/11](../01-co-ban/11-gui-thu.md)) → `{method: "mailto", ok: true}`.
3. Có URL http(s) → không gọi gì, trả `{method: "link", url}` để client mở tab mới.
4. Không có gì → 400 "This email does not provide an unsubscribe method" (client dùng fallback §5.3).

Ghi audit `email.unsubscribe` với `{messageId, method}`.

### 5.3 Hành vi UI
- Menu thư đến "Unsubscribe": `unsubscribeUrl` khác null → gọi API; `link` → mở tab mới (`noopener,noreferrer`); `one-click`/`mailto` → thông báo "Unsubscribe request sent".
- `unsubscribeUrl = null` (hoặc API trả 400) → confirm "This email does not provide an unsubscribe link. It will be moved to Trash, and future emails from this sender will also be moved to Trash." → tạo rule mailbox `email exact <sender> → trash` ([02-nang-cao/01](../02-nang-cao/01-rule-mailbox.md)) → chuyển thư vào Trash → điều hướng `/trash`.

## 6. Gravatar
- Chỉ khi **tạo mới** một liên hệ (không phải cập nhật), và khi cấu hình `GRAVATAR_ENABLED` khác `false` (mặc định bật).
- Chạy **bất đồng bộ**, không chặn pipeline nhận/gửi thư (`waitUntil` hoặc queue), timeout **5 s** mỗi request.
- `GET https://gravatar.com/avatar/<sha256(lowercase(trim(email)))>?d=404&r=g&s=256`:
  - 200 với content-type gif/jpeg/png/webp và ≤ 2 MB → lưu R2 `contact-avatars/<userId>/<encodeURIComponent(email)>`;
  - thêm bản xem trước `s=16` (≤ 32 KB) nếu dùng cho danh sách;
  - 404 / lỗi / timeout / sai loại → bỏ qua, không thử lại.
- Không ghi đè ảnh liên hệ người dùng đã tự tải lên ([02-nang-cao/19](../02-nang-cao/19-cai-dat-ca-nhan-avatar.md)).

## 7. Tiêu chí chấp nhận
- [ ] Trong trang đọc, gõ `g !` chỉ điều hướng tới Spam, thư hiện tại không bị báo spam.
- [ ] Gõ `c` khi đang focus ô tìm kiếm → không mở composer.
- [ ] Thư có `List-Unsubscribe-Post: List-Unsubscribe=One-Click` → bấm Unsubscribe gửi POST từ server, UI báo đã gửi, không mở tab.
- [ ] Thư chỉ có `mailto:` → một thư unsubscribe xuất hiện trong Sent.
- [ ] Thư không có header → confirm, rule Trash được tạo, thư sau từ cùng người gửi vào Trash.
- [ ] Gravatar chậm 30 s không làm chậm việc lưu thư đến.
- [ ] `GRAVATAR_ENABLED=false` → không có request tới gravatar.com.
