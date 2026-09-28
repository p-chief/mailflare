# Màn hình cài đặt (Settings)

> Menu phải: **Settings** — Account, Inbox, Rules & Routing · **Mailbox** — Import, Export.

## 1. Account `/settings/account`
Tải `GET /api/auth/me` (skeleton, lỗi đỏ).

**Account details** [CƠ BẢN]
- Hồ sơ: avatar (`POST /api/profile/avatar`), Name (bắt buộc), "Current email" (chỉ đọc) → "Save profile" (khoá khi chưa đổi) → `PATCH /api/settings/profile` → "Saved".
- Recovery email → "Save recovery email" (cùng endpoint).
- Forwarding email (NÂNG CAO, chỉ khi `canForwardEmail`): "Destination email" + helper về destination đã xác minh → `PATCH /api/settings/forwarding`.
- Chữ ký (mailbox đang chọn): textarea 6 dòng; chỉ `full_access` ("Full access is required to edit this signature.") → `PATCH /api/mailboxes/{id} {signature}`.

**Security**
- Đổi mật khẩu [CƠ BẢN]: hiện tại, mới (≥ 8), xác nhận ("New passwords do not match") → `PATCH /api/settings/password` → "Password changed".
- 2FA [NÂNG CAO]: trạng thái `GET /api/settings/mfa`.
  - Tắt → "Turn on two-factor": mật khẩu → QR ("Can't scan?" hiện key) → mã 6 số → 8 mã khôi phục ("Copy codes", "Other sessions have been signed out.").
  - Bật → "New recovery codes" (mật khẩu), "Turn off" (mật khẩu + mã).

**Email apps (JMAP)** [TÙY CHỌN]
- Tên thiết bị (mặc định "Mail app") → "Create app password" → `POST /api/api-keys {name, scopes:["jmap"]}`.
- Hiện **một lần**: Server (origin), Username "any value", Password (key), nút Copy; ghi chú `<origin>/.well-known/jmap`.

## 2. Inbox `/settings/inbox`
- Spam Filter [NÂNG CAO]: switch → `GET/PATCH /api/settings/spam` (lạc quan).
- Threading (localStorage): "Group emails into conversations", "Sort latest messages first".
- Keyboard shortcuts [TÙY CHỌN]: switch → `PATCH /api/settings/shortcuts`.
- Automatic response [NÂNG CAO] (mailbox đang chọn, cần full_access): switch "Enable auto-reply for {address}"; khi bật: Subject (mặc định "Out of office"), Message (7 dòng); bật mà rỗng → "Enter an auto-reply message before enabling it."; "Save" (chỉ khi đổi) → `PATCH /api/mailboxes/{id}`.

## 3. Rules & Routing `/settings/rules` [NÂNG CAO]
**Domain routing** (domain của mailbox đang chọn; cần full_access — "Full access to the selected inbox is required to manage domain routing."):
- Hai nhóm "Block rules" / "Catch-all and forwarding" — mô tả, trường form, mặc định: xem [02-nang-cao/02-rule-domain.md §8](../02-nang-cao/02-rule-domain.md).
- API `…/routing-rules/domain?mailboxId=`.

**Mailbox rules** ("Applied after delivery."):
- Tải rule + folder.
- Dòng: "{Email address|Content|Title} {contains|exact match} {value}" → đích (Spam, Trash, tên folder, "Unknown folder"). Click để sửa, hover để xoá (không confirm).
- Dialog "New rule":
  - Field: Email address / Content / Title;
  - Match: Contains / Exact match;
  - Value (placeholder `sender@example.com` hoặc "Invoice");
  - Destination: Spam / Trash / folder.
  - Lưu khi có đích và value.
- Priority giữ nguyên khi sửa, mặc định 10.

## 4. Import `/settings/import` [TÙY CHỌN]
- Nguồn: "Backup File" hoặc "IMAP".
- Chọn mục (mặc định tất cả): Inbox, Sent, Drafts, Archived, Spam, Trash, Others.
- **File**:
  - nhận `.eml, .mbox, .mbx`;
  - tất cả vào mục đầu tiên được chọn (không phải Others);
  - có Others → cảnh báo file không phân mục được;
  - upload có tiến trình 0–70% ("Uploading files") → "Importing messages" 100%;
  - kết quả "{n} imported, {m} skipped" (không hiện danh sách lỗi — nên hiện).
- **IMAP**:
  - Host (placeholder `imap.gmail.com`), Port 993, Username, Password/app password, "Message limit per source" 25 (1–100), "Use TLS" bật;
  - luồng tìm thư mục → tạo folder cho Others → import tuần tự từng nguồn (tiến trình n/tổng);
  - thành công xoá mật khẩu khỏi form.
- Chi tiết: [03-tuy-chon/03-import-export.md](../03-tuy-chon/03-import-export.md).

## 5. Export `/settings/export` [TÙY CHỌN]
"Download .mbox" (mailbox đang chọn) → tải `<localPart>.mbox`; "Preparing..."; ghi chú không kèm attachment.
