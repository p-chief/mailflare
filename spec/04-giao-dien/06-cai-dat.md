# Màn hình cài đặt (Settings)

> Menu trái: **Settings** — Account, Inbox, Rules & Routing · **Mailbox** — Import, Export. Nghiệp vụ: [01-co-ban/03-ho-so-mat-khau.md](../01-co-ban/03-ho-so-mat-khau.md), [02-nang-cao/19-cai-dat-ca-nhan-avatar.md](../02-nang-cao/19-cai-dat-ca-nhan-avatar.md), [02-nang-cao/15-xac-thuc-2-lop.md](../02-nang-cao/15-xac-thuc-2-lop.md), [02-nang-cao/18-nhat-ky-audit.md](../02-nang-cao/18-nhat-ky-audit.md)

## 1. Account `/settings/account`
Tải `GET /api/auth/me` (khung chờ; lỗi hiện màu đỏ kèm "Try again").

**Account details** [CƠ BẢN]
- Hồ sơ: avatar (`POST /api/profile/avatar`, xoá bằng `DELETE`), Name (bắt buộc), "Current email" (chỉ đọc) → "Save profile" (khoá khi chưa thay đổi) → `PATCH /api/settings/profile` → "Saved".
- Recovery email → "Save recovery email" (cùng endpoint).
- Forwarding email [NÂNG CAO] (chỉ khi entitlement `accountForwarding` bật — [03-tuy-chon/01](../03-tuy-chon/01-license-branding.md)):
  - tải `GET /api/settings/forwarding`; ô "Destination email" + helper giải thích đích phải được xác minh;
  - "Save" → `PATCH /api/settings/forwarding`; để trống = tắt chuyển tiếp;
  - huy hiệu trạng thái: "Verified" / "Pending verification — open the link Cloudflare sent to {email}." / "Not registered with Cloudflare" + nút "Send verification email" (`POST /api/settings/forwarding/verify`) — xem [02-nang-cao/08](../02-nang-cao/08-chuyen-tiep-tai-khoan.md).
- Chữ ký (mailbox đang chọn): textarea 6 dòng; chỉ user `full_access` sửa được (ngược lại hiện "Full access is required to edit this signature.") → `PATCH /api/mailboxes/{id} {signature}`.

**Security**
- Đổi mật khẩu [CƠ BẢN]: mật khẩu hiện tại, mới (≥ 8), xác nhận ("New passwords do not match") → `PATCH /api/settings/password` → "Password changed. Other sessions have been signed out."
- 2FA [NÂNG CAO]: trạng thái từ `GET /api/settings/mfa`.
  - Đang tắt → "Turn on two-factor": nhập mật khẩu → QR (link "Can't scan?" hiện secret) → nhập mã 6 số → hiện 8 mã khôi phục (nút "Copy codes", ghi chú "Other sessions have been signed out.").
  - Đang bật → "New recovery codes" (dialog nhập mật khẩu), "Turn off" (dialog mật khẩu + mã).
- **Recent sign-ins** [NÂNG CAO]: `GET /api/settings/login-history` → danh sách (sự kiện Sign in/Sign out/…, thời gian, thiết bị • platform, IP, city • country); nút "Load more" theo `nextCursor`; rỗng → "No sign-in activity yet".

**Email apps (JMAP)** [TÙY CHỌN]
- Tên thiết bị (mặc định "Mail app") → "Create app password" → `POST /api/api-keys {name, scopes: ["jmap"]}`.
- Hiện **một lần**: Server (origin), Username "any value", Password (key), nút Copy từng dòng; ghi chú địa chỉ tự khám phá `<origin>/.well-known/jmap`.
- Danh sách app password hiện có (key scope `jmap` của user) với nút "Revoke" → xác nhận "Revoke {name}? Apps using this key will stop working immediately." → `DELETE /api/api-keys/{id}`.

## 2. Inbox `/settings/inbox`
- Spam Filter [NÂNG CAO]: switch → `GET/PATCH /api/settings/spam` (cập nhật lạc quan, hoàn tác khi lỗi).
- Threading (tuỳ chọn hiển thị trong trình duyệt): "Group emails into conversations", "Sort latest messages first"; đổi → phát sự kiện tương ứng.
- Keyboard shortcuts [TÙY CHỌN]: switch → `PATCH /api/settings/shortcuts`.
- Automatic response [NÂNG CAO] (mailbox đang chọn, cần `full_access`):
  - switch "Enable auto-reply for {address}";
  - khi bật: Subject (mặc định "Out of office"), Message (textarea 7 dòng);
  - bật mà Message rỗng → "Enter an auto-reply message before enabling it.";
  - "Save" (chỉ bật khi có thay đổi) → `PATCH /api/mailboxes/{id}`.

## 3. Rules & Routing `/settings/rules` [NÂNG CAO]
**Domain routing** (domain của mailbox đang chọn; cần `full_access` — nếu không: "Full access to the selected inbox is required to manage domain routing."):
- Hai nhóm "Block rules" / "Catch-all and forwarding" — mô tả, trường form, mặc định: xem [02-nang-cao/02-rule-domain.md](../02-nang-cao/02-rule-domain.md).
- API `/api/routing-rules/domain?mailboxId=`.
- Xoá rule → xác nhận "Delete this rule?".

**Mailbox rules** (ghi chú "Applied after delivery."):
- Tải rule và folder của mailbox.
- Danh sách, form tạo/sửa, "Also apply to existing messages": xem [02-nang-cao/01-rule-mailbox.md §9](../02-nang-cao/01-rule-mailbox.md).
- Click dòng để sửa (priority giữ nguyên); xoá → xác nhận "Delete this rule?".
- Đích là folder đã bị xoá → hiển thị "Unknown folder" và cảnh báo rule không có hiệu lực.

## 4. Import `/settings/import` [TÙY CHỌN]
- Nguồn: "Backup File" hoặc "IMAP".
- Chọn mục (mặc định tất cả): Inbox, Sent, Drafts, Archived, Spam, Trash, Others.
- **File**:
  - nhận `.eml, .mbox, .mbx`;
  - mọi file vào **mục đầu tiên** được chọn (không tính Others);
  - có chọn Others → cảnh báo "Files cannot be sorted into folders; they will be imported into {mục}.";
  - tiến trình: tải lên 0–70% ("Uploading files") → "Importing messages" → 100%.
- **IMAP**:
  - Host (placeholder `imap.gmail.com`), Port 993, Username, Password/app password, "Message limit per source" 25 (1–100, ô số), "Use TLS" bật;
  - luồng: lấy danh sách thư mục → tạo folder cho Others → import tuần tự từng nguồn (tiến trình "{n}/{tổng} sources");
  - lỗi một nguồn không dừng các nguồn còn lại;
  - xong (thành công hay có lỗi) → xoá mật khẩu khỏi form.
- **Kết quả**: "{n} imported, {m} skipped" và, nếu `errors` không rỗng, danh sách lỗi đầy đủ ("{k} errors" có thể mở rộng; mỗi dòng một lỗi `<nguồn>: <thông điệp>`, nút "Copy errors").
- Chi tiết: [03-tuy-chon/03-import-export.md](../03-tuy-chon/03-import-export.md).

## 5. Export `/settings/export` [TÙY CHỌN]
Nút "Download .mbox" (mailbox đang chọn) → tải `<localPart>.mbox`; trạng thái "Preparing..." khi đang tải; ghi chú "Includes every message in this mailbox with its original source and attachments."

## 6. Tiêu chí chấp nhận
- [ ] Import có lỗi → màn hình liệt kê từng lỗi, không chỉ số đếm.
- [ ] Entitlement `accountForwarding` tắt → mục Forwarding không hiển thị.
- [ ] Recent sign-ins chỉ hiển thị lần đăng nhập của chính user.
- [ ] Revoke app password → mail client dùng key đó nhận 401 ở request kế tiếp.
