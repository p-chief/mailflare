# License (Paymug) & Branding

> **[TÙY CHỌN]** — Khuyến nghị: **bỏ license** khi xây dựng lại cho riêng bạn; thay bằng cấu hình/feature flag nội bộ. Branding có thể giữ dạng cấu hình tĩnh.

## 1. License

### 1.1 Gói & quyền lợi
| Gói | Giá (UI) | Mở khoá |
|---|---|---|
| `community` | mặc định | — |
| `pro` | $19 (gạch $39) | `canCustomizeBranding`, `canForwardEmail` |
| `team` | $249 | như Pro + `canManageAccounts` + chia sẻ shared mailbox |
Chỉ **plan** quyết định; mảng `features` từ Paymug được lưu nhưng không dùng. `active = state == 'active' && plan ∈ {pro, team}`. Lỗi đọc → mọi quyền = false.

### 1.2 Danh sách chỗ bị khoá (cần gỡ khi viết lại)
| Quyền | Nơi | Khi không có |
|---|---|---|
| canCustomizeBranding | `getBranding`, `PUT /api/branding`, `/api/branding/icon`, menu Branding | dùng mặc định "Mailflare"/icon gốc; PUT 403 |
| canForwardEmail | account forwarding trong `email()`/intake; `PATCH /api/settings/forwarding`; đặt forwarding qua profile/account | không forward; 403 khi đặt mới |
| canManageAccounts | mọi `/api/accounts*`, `/api/mailboxes/{id}/access`, tạo mailbox shared, `canCreateShared` | 403 "A Team license is required…" |
| isTeamMailboxSharingEnabled (plan team + active, đọc trực tiếp) | `getMailboxAccessLevel`, `listAccessibleMailboxes`, người nhận realtime | chỉ owner truy cập mailbox |

### 1.3 Dữ liệu & Paymug
- `license_settings` (1 dòng `default`): `instance_id` (UUID tạo lần đầu, có thể bị thay bằng id Paymug trả về), `instance_url`, `license_key_hash` (SHA-256), `plan`, `state`, `features`, `activated_at`, `validated_at`.
- `getOrCreateLicenseSettings` = `INSERT … ON CONFLICT DO NOTHING` + SELECT **mỗi lần đọc quyền** (kể cả mỗi thư đến) — tốn ghi.
- Paymug: `POST https://app.paymug.co/api/v1/licenses/{activate|validate|deactivate}`, timeout 15 s; body `{licenseKey, productId, instanceId, instanceUrl, appVersion}` (deactivate: `{productId, instanceId}`). Product ID: pro `ebafa58f-af9f-4b8a-a48d-6cfd44dd2053`, team `6e42b54c-3221-4f8f-93a7-bab494f9e224`.
- Map lỗi: mạng → "Unable to reach Paymug…"; 409 → "active on another installation"; 401/403 → "rejected this license key"; ≥500 → tạm thời không khả dụng.
- Validate chỉ khi admin bấm (không có kiểm tra định kỳ). Gotcha: code log **license key dạng plain**.

### 1.4 API (admin; mọi lỗi auth → 403)
`GET /api/licenses` → `{license}`; `POST /api/licenses/activate {licenseKey, plan}`; `/validate {licenseKey}`; `/deactivate`. Zod lỗi → 400 "Enter a valid license key"; thiếu bảng → 503.

## 2. Branding

### 2.1 Dữ liệu
`app_settings` (id `default`): `app_name` (mặc định "Mailflare"), `icon_key` (R2 `branding/app-icon`).

### 2.2 API
| Method | Path | Quyền | Hành vi |
|---|---|---|---|
| GET | `/api/branding` | **public** | `{appName, hasCustomIcon, canCustomizeBranding}` (no-store) |
| PUT | `/api/branding` | admin (+ quyền branding) | multipart `appName` (trim 1–60) + `icon?` (png/jpeg/webp/gif, ≤ 2 MB → 413); lưu nguyên ảnh, upsert settings |
| GET | `/api/branding/icon` | public | icon tuỳ chỉnh từ R2 (`no-cache`, nosniff) hoặc `/icon-96.png` từ assets |
Không có cách xoá icon về mặc định.

### 2.3 Dùng ở đâu
Favicon (`/api/branding/icon`), tên/biểu tượng ở sidebar, trang auth, loader, landing; `document.title` mặc định; **issuer TOTP**; tiêu đề/nội dung thư reset mật khẩu.

## 3. Khuyến nghị khi viết lại
- Xoá hoàn toàn bảng `license_settings`, các kiểm tra entitlement; bật tất cả tính năng.
- Branding: biến môi trường `APP_NAME` + file icon tĩnh, hoặc giữ `app_settings` không khoá.
