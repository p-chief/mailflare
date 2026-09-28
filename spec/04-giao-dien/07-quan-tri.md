# Màn hình quản trị (Admin)

> Guard: đăng nhập + role admin + có mailbox. Menu: **Overview** · **Email** — Mailboxes, Domains, Routing, Webhooks, API keys · **Administration** — Accounts (ẩn khi entitlement `multiUser` tắt), Activity, Audit log, Backups · **Product** — Branding (ẩn khi entitlement `branding` tắt), Licenses (ẩn khi không cấu hình máy chủ license).
>
> Mọi thao tác xoá/gỡ/thu hồi dùng dialog xác nhận theo [00-ban-do-man-hinh.md §6](00-ban-do-man-hinh.md).

## 1. Overview `/admin`
- Thẻ liên kết: Mailboxes, Domains, Accounts, Branding, Licenses (chỉ các mục đang hiện trong menu).
- Thẻ "Application update" và dòng migration (luôn hiển thị) — [03-tuy-chon/05 §7](../03-tuy-chon/05-migration-self-update.md) [TÙY CHỌN].
- Thẻ bảo trì: số thư đã index / tổng thư; nút "Rebuild search index" khi hai số khác nhau ([03-tuy-chon/05 §5](../03-tuy-chon/05-migration-self-update.md)).

## 2. Domains `/domains` [CƠ BẢN]
- `GET /api/auth/me` → `managesDns` chọn mô tả trang (Cloudflare quản lý DNS hay DNS tạo tay).
- `GET /api/domains?includeDns=true`; rỗng → "No domains yet".
- Thẻ domain:
  - favicon `https://<host>/favicon.ico` (fallback biểu tượng quả địa cầu), hostname;
  - huy hiệu status / routing / sending;
  - hàng MX | SPF | DKIM | DMARC (xanh/vàng/đỏ);
  - "Show details" (tải `GET /api/domains/{id}/dns`, cache);
  - ⋮ "Remove domain" → xác nhận → `DELETE /api/domains/{id}`; 409 `DOMAIN_HAS_MAILBOXES` → "Delete the mailboxes on this domain first."
- Chi tiết:
  - Email Routing: "configured" / "{n} DNS record(s) missing" / "No routing DNS records found";
  - Email Sending: "Sending for {sub} is enabled/disabled";
  - từng bản ghi có mô tả, giá trị tìm thấy, nút "Setup" (`POST /api/domains/{id}/dns/setup`; ẩn với domain `zoneId = "manual"`, thay bằng giá trị cần tạo tay và nút Copy).
- Dialog "New domain":
  - rời ô → `POST /api/domains/check`;
  - switch "Enable sending" khoá tới khi kiểm xong, kiểm thành công → **bật mặc định** (cùng mặc định với wizard setup);
  - "Add" → `POST /api/domains`; `MX_RECORDS_CONFLICT` → cảnh báo + nút "Delete MX records and continue".
  - Lỗi quyền Cloudflare hiển thị kèm danh sách quyền token cần:
    - All accounts: DNS Settings:Edit, Email Routing Addresses:Edit, Email Sending:Edit;
    - All zones: DNS Settings:Edit, Email Routing Rules:Edit, Zone Settings:Edit, DNS:Edit.

## 3. Mailboxes `/mailboxes` [CƠ BẢN]
- Danh sách: avatar, tên, pill "Shared", địa chỉ → `/mailboxes/{id}`; rỗng → "No mailboxes yet".
- Dialog "New mailbox" ("Add an address and provision its routing rule automatically."):
  - Type (Personal/Shared — chỉ khi `canCreateShared`);
  - Personal: chọn Account (các tài khoản được quản lý + chính mình; chọn → điền sẵn tên); Shared: ghi chú "Choose members after creating the mailbox.";
  - Name, Email (local part + domain);
  - "Create" → `POST /api/mailboxes`; shared → chuyển tới trang cấu hình của mailbox mới.

## 4. Mailbox settings `/mailboxes/{id}`
Header "Settings", địa chỉ, huy hiệu Shared/Primary.
- **Account**: avatar, Name, checkbox "Use all domains" → "Save" → `PATCH /api/mailboxes/{id} {displayName, useAllDomains}` → "Mailbox settings saved".
- **Aliases** [NÂNG CAO]: danh sách; thêm (local part + domain) → `POST /api/mailboxes/{id}/aliases`; gỡ → xác nhận → `DELETE`; rỗng "No aliases yet."
- **Shared access** [NÂNG CAO] (chỉ mailbox shared, khi entitlement `multiUser` bật):
  - danh sách thành viên: tên, email, dropdown mức quyền (`read_only` / `send_on_behalf` / `send_as` / `full_access`, kèm mô tả ngắn từng mức) — đổi → `PATCH /api/mailboxes/{id}/access`; nút gỡ → xác nhận → `DELETE …/access?userId=`;
  - thêm: chọn tài khoản trong `availableUsers` + chọn mức quyền (mặc định `read_only`) → `POST …/access`;
  - rỗng "No members have access yet."
  - Chi tiết: [02-nang-cao/16 §5](../02-nang-cao/16-da-nguoi-dung-shared-mailbox.md).
- **Danger zone**:
  - mô tả "Deleting removes the Cloudflare routing rule and permanently deletes all emails in this mailbox.";
  - nút "Delete mailbox" → gọi `DELETE /api/mailboxes/{id}`; 409 `MAILBOX_NOT_EMPTY` → dialog xác nhận nêu `messageCount` ("Delete {address}? This removes its email routing rule and permanently deletes its {n} email(s). This cannot be undone.") → gọi lại với `?confirm=true` → `/mailboxes`.

## 5. Accounts `/accounts` [NÂNG CAO]
- Chỉ hiện khi entitlement `multiUser` bật; truy cập trực tiếp khi tắt → thông báo "This feature is not enabled on this installation."
- Danh sách: avatar, tên, pill role, email, nhãn "Disabled" nếu bị khoá → `/accounts/{id}`.
- Dialog "Add user account": username + domain (mặc định domain đầu tiên), password (≥ 8), role User/Admin → `POST /api/accounts`.

## 6. Account detail `/accounts/{id}` (Details · Permissions · Mailboxes)
- **Details**:
  - "Change avatar", Email (chỉ đọc), Name;
  - Forwarding email (khi entitlement `accountForwarding` bật);
  - "Reset password (optional)" — "Setting a password signs this account out everywhere.";
  - "Account enabled" (tắt = khoá tài khoản; tài khoản không bị xoá — [02-nang-cao/16 §4.5](../02-nang-cao/16-da-nguoi-dung-shared-mailbox.md)); tắt → xác nhận "Disable {email}? They will be signed out and cannot sign in until re-enabled. Their mailboxes keep receiving mail."
  - "Save" → `PATCH /api/accounts/{id}` → "Account details updated" (thêm " and password reset" khi có đặt mật khẩu).
- **Permissions**: "Administrator access", "Manage mailboxes — Allow this account to add and remove its own inboxes." → "Permissions updated".
- **Mailboxes**:
  - danh sách mailbox của tài khoản; xoá → cùng luồng xác nhận như §4 Danger zone;
  - thêm (local part + domain) → `POST /api/mailboxes {ownerUserId, …, type: "personal"}`;
  - rỗng "No mailboxes yet."

## 7. Routing `/routing` [NÂNG CAO]
Chọn "Managed domain" (mặc định domain đầu tiên) → cùng UI rule domain như Settings ([06-cai-dat.md §3](06-cai-dat.md)) ở chế độ admin (không kèm `mailboxId`). Không có domain → "Add a domain before configuring routing rules."

## 8. Webhooks `/webhooks` [NÂNG CAO]
Xem [02-nang-cao/12-webhook.md](../02-nang-cao/12-webhook.md).
- Danh sách webhook; xoá → xác nhận.
- Bảng delivery: trạng thái Pending, Delivered, Failed, Retrying, "Gave up" (hết lượt thử).
- Cột Attempts `a / max(maxAttempts, a)`, response status + thời gian + lỗi, lần thử cuối, lần thử kế; nút "Retry".

## 9. API keys `/api-keys` [NÂNG CAO]
Xem [02-nang-cao/13-api-key-va-rest-v1.md](../02-nang-cao/13-api-key-va-rest-v1.md).
- Bảng: tên, `{prefix}...`, huy hiệu scope, tạo lúc, dùng lần cuối, hết hạn (nhãn "Expired" khi quá hạn); nút "Revoke" → xác nhận → `DELETE /api/api-keys/{id}`.
- Dialog tạo: tên + checkbox scope (mặc định `send` + `read`) + hạn dùng (Never / 30 / 90 / 365 ngày) → hiện "Copy your key now:" với key đầy đủ một lần.

## 10. Backups `/backups` [TÙY CHỌN]
Xem [03-tuy-chon/04-backup.md](../03-tuy-chon/04-backup.md).
- Nút "Back up now" (→ 202, dòng mới ở trạng thái Queued) và "Restore" (chọn file JSON → xác nhận "Restore this backup? A safety backup is created first. This replaces all current database records and may sign you out.").
- Thẻ "Automatic backup": bật/tắt, tần suất (Daily/Weekly/Monthly), ngày trong tuần / ngày trong tháng, "Delete backups older than {N} days".
- Bảng lịch sử: file, loại (Manual/Scheduled/Pre-restore), trạng thái, kích thước, ngày, nút tải về, nút xoá (xác nhận; khoá khi đang chạy).
- Tự làm mới mỗi 5 s khi có backup `queued|running`.
- Kết quả restore: thành công → thông báo + đăng xuất nếu phiên bị thay; lỗi → hiển thị thông điệp server (kể cả "…the previous data was put back").

## 11. Licenses `/licenses`, Branding `/branding` [TÙY CHỌN]
Xem [03-tuy-chon/01-license-branding.md](../03-tuy-chon/01-license-branding.md).
- Licenses: plan và trạng thái hiện tại, bảng cờ entitlement đang bật; form nhập license key + chọn plan → "Activate"; "Validate" (nhập lại key); "Deactivate" (xác nhận).
- Branding: tên app (1–60 ký tự), icon (xem trước, nút "Remove icon") → "Save" → "Branding updated".

## 12. Activity `/activity` & Audit log `/audit-logs` [NÂNG CAO]
Xem [02-nang-cao/18-nhat-ky-audit.md §7](../02-nang-cao/18-nhat-ky-audit.md).
- Activity: bảng Activity (Login/Logout), User (email + city • country), Device (thiết bị + platform • IP), Time; nút "Refresh"; "Load more" theo `nextCursor`; rỗng → "No login or logout activity yet".
- Audit log: bộ lọc Action (các action + "All auth" / "All email"), Account, Mailbox → `GET /api/audit-logs?action&userId&mailboxId`; bảng Time, Action, Actor, Target, Mailbox, Details (rút gọn, mở rộng xem JSON); "Load more"; rỗng → "No audit entries match these filters". Đổi bộ lọc → tải lại từ đầu.

## 13. Tiêu chí chấp nhận
- [ ] Xoá domain, alias, webhook, rule, thành viên, backup, API key đều hỏi xác nhận trước khi gọi API.
- [ ] Dialog "New domain": kiểm thành công → "Enable sending" bật, giống wizard setup.
- [ ] Thêm thành viên shared mailbox với mức `send_as` → thành viên gửi được với From là mailbox.
- [ ] Revoke API key → key biến khỏi bảng, request kế tiếp bằng key đó nhận 401.
- [ ] Audit log lọc `Action = All auth` → chỉ hiện action `auth.*`.
