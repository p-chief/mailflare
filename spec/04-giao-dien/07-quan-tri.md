# Màn hình quản trị (Admin)

> Guard: đăng nhập + role admin + có mailbox. Menu: **Overview** · **Email** — Mailboxes, Domains, Routing, Webhooks · **Administration** — Accounts, Activity, Backups · **Product** — Branding (ẩn khi không có quyền), Licenses. `/api-keys` tồn tại nhưng không có trong menu.

## 1. Overview `/admin`
Thẻ liên kết: Mailboxes, Domains, Branding, Licenses, Accounts. Thẻ "Application update" + dòng migration (TÙY CHỌN — [03-tuy-chon/05](../03-tuy-chon/05-migration-self-update.md)).

## 2. Domains `/domains` [CƠ BẢN]
- `GET /api/auth/me` → `managesDns` chọn mô tả (Cloudflare hay DNS tay).
- `GET /api/domains?includeDns=true`; rỗng → "No domains yet".
- Thẻ domain:
  - favicon `https://<host>/favicon.ico` (fallback quả địa cầu), hostname;
  - badge status / routing / sending;
  - hàng MX | SPF | DKIM | DMARC;
  - "Show details" (tải `GET /api/domains/{id}/dns`, cache);
  - ⋮ "Remove domain" → `DELETE` (**không confirm** — nên thêm).
- Chi tiết:
  - Email Routing: "configured" / "{n} DNS record(s) missing" / "No routing DNS records found";
  - Email Sending: "Sending for {sub} is enabled/disabled";
  - từng bản ghi có mô tả, giá trị tìm thấy, nút "Setup" (ẩn với zone manual).
- Dialog "New domain":
  - rời ô → check;
  - thành công → switch "Enable sending" **bật mặc định** (khác wizard setup);
  - Add → `POST /api/domains`.
  - Lỗi hiện kèm danh sách quyền token cần:
    - All accounts: DNS Settings:Edit, Email Routing Addresses:Edit, Email Sending:Edit;
    - All zones: DNS Settings:Edit, Email Routing Rules:Edit, Zone Settings:Edit, DNS:Edit.

## 3. Mailboxes `/mailboxes` [CƠ BẢN]
- Danh sách: avatar, tên, pill "Shared", địa chỉ → `/mailboxes/{id}`; rỗng → "No mailboxes yet".
- Dialog "New mailbox" ("Add an address and provision its routing rule automatically."):
  - Type (Personal/Shared, chỉ khi `canCreateShared`);
  - Personal: chọn Account (tài khoản + chính mình, chọn → điền tên); Shared: ghi chú chọn thành viên sau;
  - Name, Email (local part + domain);
  - Create → `POST /api/mailboxes`; shared → chuyển tới trang cấu hình.

## 4. Mailbox settings `/mailboxes/{id}`
Header "Settings", địa chỉ, badge Shared/Primary.
- **Account**: avatar, Name, checkbox "Use all domains" → Save `PATCH {displayName, useAllDomains}` → "Mailbox settings saved".
- **Aliases** [NÂNG CAO]: danh sách, thêm (local part + domain), xoá (không confirm); rỗng "No aliases yet."
- **Shared access** [NÂNG CAO] (chỉ mailbox shared):
  - thêm user (luôn `full_access` — nên cho chọn mức), gỡ;
  - rỗng "No Team members have access yet."
- **Danger zone**:
  - "deleting removes the Cloudflare routing rule; existing messages are kept but hidden";
  - confirm "Delete {address}? This removes its email routing rule and cannot be undone." → `DELETE` → `/mailboxes`.

## 5. Accounts `/accounts` [NÂNG CAO]
- Danh sách: avatar, tên, pill role, email → `/accounts/{id}`. Lỗi chứa "team license" → overlay "Team license required".
- Dialog "Add user account": username + domain (mặc định domain đầu), password (≥ 8), role User/Admin → `POST /api/accounts`.

## 6. Account detail `/accounts/{id}` (Details · Permissions · Mailboxes)
- **Details**:
  - "Change avatar", Email (chỉ đọc), Name;
  - Forwarding email (nếu có quyền);
  - "Reset password (optional)" — "Setting a password signs this account out everywhere.";
  - "Account enabled".
  - Save → `PATCH /api/accounts/{id}` → "Account details updated[ and password reset]".
- **Permissions**: "Administrator access", "Manage mailboxes — Allow this account to add and remove its own inboxes." → "Permissions updated".
- **Mailboxes**:
  - danh sách, xoá (không confirm);
  - thêm (local part + domain) → `POST /api/mailboxes {ownerUserId, …, type:"personal"}`;
  - rỗng "No mailboxes yet."

## 7. Routing `/routing` [NÂNG CAO]
Chọn "Managed domain" (mặc định domain đầu) → cùng UI rule domain ở chế độ admin (không `mailboxId`). Không có domain → "Add a domain before configuring routing rules."

## 8. Webhooks `/webhooks` [NÂNG CAO]
Xem [02-nang-cao/12-webhook.md §7](../02-nang-cao/12-webhook.md).
- Cột trạng thái delivery: Pending, Delivered, Failed, Retrying, "Gave up" (exhausted).
- Attempts `a / max(maxAttempts, a)`, response status + thời gian + lỗi, lần thử cuối, lần thử kế, nút Retry.

## 9. API keys `/api-keys` [NÂNG CAO]
- Danh sách: tên, `{prefix}...`, badge scope; **không có thu hồi**.
- Tạo: tên + checkbox scope (mặc định send + read) → "Copy your key now:".

## 10. Backups `/backups` [TÙY CHỌN]
Xem [03-tuy-chon/04-backup.md §7](../03-tuy-chon/04-backup.md).

## 11. Licenses `/licenses`, Branding `/branding` [TÙY CHỌN]
Xem [03-tuy-chon/01-license-branding.md](../03-tuy-chon/01-license-branding.md).
- Licenses: thẻ Pro/Team + form kích hoạt/validate/huỷ.
- Branding: tên app (≤ 60), icon (xem trước) → "Branding updated".

## 12. Activity `/activity` [NÂNG CAO]
Xem [02-nang-cao/18-nhat-ky-audit.md §4](../02-nang-cao/18-nhat-ky-audit.md). Không có lọc/phân trang/làm mới.
