# Phân gói tính năng (entitlements) & branding

> **[TÙY CHỌN]** · Phụ thuộc: [00-nen-tang/05-phan-quyen.md](../00-nen-tang/05-phan-quyen.md) · Liên quan: [02-nang-cao/08-chuyen-tiep-tai-khoan.md](../02-nang-cao/08-chuyen-tiep-tai-khoan.md), [02-nang-cao/16-da-nguoi-dung-shared-mailbox.md](../02-nang-cao/16-da-nguoi-dung-shared-mailbox.md), [02-nang-cao/15-xac-thuc-2-lop.md](../02-nang-cao/15-xac-thuc-2-lop.md)

## 1. Mục tiêu
- Cho phép người triển khai bật/tắt một số nhóm tính năng theo **cờ quyền lợi (entitlement)**, cấu hình tĩnh hoặc lấy từ một máy chủ license bên ngoài (tuỳ chọn).
- Cho admin đổi tên hiển thị và biểu tượng của hệ thống (branding) khi cờ `branding` bật.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| 4 cờ entitlement và nơi áp dụng từng cờ | Thanh toán, trang mua, giá |
| Nguồn cờ: cấu hình tĩnh hoặc máy chủ license | Tự động gia hạn, kiểm tra định kỳ không cần admin |
| Kích hoạt / kiểm tra / huỷ license qua hợp đồng chung | Nhiều license đồng thời cho một bản cài |
| Tên app + icon tuỳ chỉnh | Theme màu, CSS tuỳ chỉnh, domain white-label |

## 3. Cờ entitlement

### 3.1 Danh sách cờ, nơi áp dụng và hành vi khi tắt
| Cờ | Nơi áp dụng | Khi tắt |
|---|---|---|
| `branding` | Thủ tục đọc branding hiệu lực (§6.3); `PUT /api/branding`; mục menu admin "Branding" | Mọi nơi dùng tên `{APP_NAME}` mặc định và icon mặc định; `PUT /api/branding` → 403; menu Branding ẩn. Giá trị đã lưu trong `app_settings` được giữ nguyên, bật lại cờ thì dùng lại |
| `accountForwarding` | Bước chuyển tiếp toàn tài khoản trong email handler ([02-nang-cao/08](../02-nang-cao/08-chuyen-tiep-tai-khoan.md)); `PATCH /api/settings/forwarding`; trường forwarding khi admin sửa tài khoản (`PATCH /api/accounts/{id}`) | Email handler **bỏ qua** bước chuyển tiếp (thư vẫn được lưu bình thường); đặt forwarding khác rỗng → 403; xoá forwarding (giá trị rỗng) vẫn được phép; UI ẩn trường Forwarding |
| `multiUser` | Mọi `/api/accounts*`; `/api/mailboxes/{id}/access`; tạo mailbox `type = shared`; cờ `canCreateShared` trả về cho UI | 403 `{error: "This feature is not enabled on this installation.", code: "FEATURE_DISABLED"}`; UI ẩn Accounts và lựa chọn "Shared" |
| `mailboxSharing` | Kiểm tra quyền mailbox (bảng `mailbox_access` chỉ được xét khi cờ bật); liệt kê mailbox truy cập được; tập người nhận thông báo realtime | Chỉ **chủ mailbox** truy cập được mailbox; các dòng `mailbox_access` giữ nguyên nhưng không có hiệu lực; realtime chỉ gửi cho chủ mailbox |

Quy tắc chung:
- Cờ được đọc **một lần mỗi request** (hoặc mỗi lần xử lý một thư đến) qua thủ tục `DOC_ENTITLEMENTS(env)` định nghĩa ở §3.3. Không có chỗ nào tự đọc bảng license trực tiếp.
- Đọc cờ lỗi (DB lỗi, dữ liệu hỏng) → mọi cờ = `false` và ghi log cảnh báo; không làm request lỗi.
- Tắt cờ không bao giờ xoá dữ liệu.

### 3.2 Gói (plan) → cờ
Khi dùng máy chủ license, cờ suy ra từ **plan** của license đang hoạt động. Bảng ánh xạ là cấu hình của bản triển khai; mặc định:
| Plan | `branding` | `accountForwarding` | `multiUser` | `mailboxSharing` |
|---|---|---|---|---|
| `community` (không có license) | – | – | – | – |
| `pro` | ✓ | ✓ | – | – |
| `team` | ✓ | ✓ | ✓ | ✓ |

Mảng `features` do máy chủ license trả về được lưu để tham khảo nhưng **không** dùng để tính cờ; chỉ plan quyết định.

### 3.3 Thủ tục `DOC_ENTITLEMENTS(env)`
```
nếu env.ENTITLEMENTS được đặt (vd "branding,accountForwarding" hoặc "all"):
    → cờ = đúng danh sách đó (cấu hình tĩnh, bỏ qua bảng license)
nếu không cấu hình máy chủ license (thiếu LICENSE_SERVER_URL):
    → mọi cờ = true                     // bản tự dùng: bật hết
ngược lại:
    row = SELECT * FROM license_settings WHERE id = 'default'
    active = row.state == 'active' AND row.plan ∈ plan có trong bảng ánh xạ
    → cờ = active ? ánh xạ(row.plan) : ánh xạ('community')
```
Kết quả có thể cache trong bộ nhớ isolate tối đa 60 s; mọi thao tác activate/validate/deactivate xoá cache.

## 4. Dữ liệu
`license_settings` (một dòng `id = 'default'`, tạo bởi migration khởi tạo — không INSERT khi đọc):
| Cột | Ý nghĩa |
|---|---|
| `instance_id` | UUID tạo lúc khởi tạo; được thay bằng id máy chủ license trả về nếu có |
| `instance_url` | Origin công khai của bản cài (`APP_URL`) |
| `license_key_hash` | SHA-256 hex của license key. **Không bao giờ lưu key dạng rõ** |
| `plan` | `community` \| `pro` \| `team` (hoặc plan khác trong bảng ánh xạ) |
| `state` | `inactive` \| `active` \| `invalid` \| `expired` |
| `features` | JSON mảng chuỗi từ máy chủ license (tham khảo) |
| `activated_at`, `validated_at` | Thời điểm kích hoạt / kiểm tra thành công gần nhất |

Cấu hình (biến môi trường / secret):
| Biến | Ý nghĩa |
|---|---|
| `ENTITLEMENTS` | Tuỳ chọn. Danh sách cờ tĩnh, phân tách dấu phẩy, hoặc `all` |
| `LICENSE_SERVER_URL` | Tuỳ chọn. URL gốc máy chủ license; không đặt = không dùng license |
| `LICENSE_PRODUCT_IDS` | JSON `{plan: productId}` gửi kèm request tới máy chủ license |

## 5. Tích hợp máy chủ license (tuỳ chọn)

### 5.1 Hợp đồng chung
Mọi lời gọi: `POST <LICENSE_SERVER_URL>/<action>`, `Content-Type: application/json`, timeout **15 s**.
| Action | Body | Response 2xx |
|---|---|---|
| `activate` | `{licenseKey, productId, instanceId, instanceUrl, appVersion}` | `{plan, state, features?, instanceId?}` |
| `validate` | `{licenseKey, productId, instanceId, instanceUrl, appVersion}` | `{plan, state, features?}` |
| `deactivate` | `{productId, instanceId}` | `{}` |

Ánh xạ lỗi (thông điệp trả cho admin):
| Tình huống | HTTP trả về | Thông điệp |
|---|---|---|
| Lỗi mạng / timeout | 502 | "Unable to reach the license server. Please try again." |
| Máy chủ trả 409 | 409 | "This license is already active on another installation." |
| Máy chủ trả 401/403 | 400 | "The license server rejected this license key." |
| Máy chủ trả ≥ 500 | 503 | "The license server is temporarily unavailable. Please try again later." |
| Response 2xx nhưng thiếu `plan`/`state` | 502 | "The license server returned an invalid response." |

### 5.2 API (admin; Origin check cho mọi POST)
| Method | Path | Hành vi |
|---|---|---|
| GET | `/api/licenses` | `{license: {plan, state, active, activatedAt, validatedAt, entitlements: {branding, accountForwarding, multiUser, mailboxSharing}, configured}}` (`configured` = có `LICENSE_SERVER_URL`) |
| POST | `/api/licenses/activate` | `{licenseKey, plan}` → gọi `activate` → lưu hash, plan, state, features, `activated_at`, `validated_at` → `{license}` |
| POST | `/api/licenses/validate` | `{licenseKey}`; hash phải khớp `license_key_hash` (sai → 400 "This license key does not match the active license.") → gọi `validate` → cập nhật plan/state/`validated_at` |
| POST | `/api/licenses/deactivate` | gọi `deactivate` (lỗi mạng vẫn xoá cục bộ và trả cảnh báo) → xoá hash, `plan = community`, `state = inactive` |
- 401 không phiên, 403 không phải admin hoặc Origin sai.
- Body sai (key rỗng, > 256 ký tự, plan không có trong bảng ánh xạ) → 400 "Enter a valid license key".
- Không cấu hình máy chủ license → các POST trả 404 "License activation is not configured".
- Mỗi thao tác thành công ghi audit `license.activate|validate|deactivate` (không kèm key).

### 5.3 Bảo mật
- License key **không bao giờ** được ghi log, ghi audit, trả về trong response hay lưu dạng rõ. Log lỗi chỉ ghi action, mã HTTP và 8 ký tự đầu của hash.
- Kiểm tra license chỉ xảy ra khi admin thao tác; không có kiểm tra ngầm ở mỗi request.

## 6. Branding

### 6.1 Dữ liệu
`app_settings` (một dòng `id = 'default'`): `app_name` (null = dùng `{APP_NAME}` cấu hình), `icon_key` (null hoặc khoá R2 `branding/app-icon`), `updated_at`.

### 6.2 API
| Method | Path | Quyền | Hành vi |
|---|---|---|---|
| GET | `/api/branding` | **public** | `{appName, hasCustomIcon, canCustomizeBranding}` (`Cache-Control: no-store`); giá trị là branding **hiệu lực** (§6.3) |
| PUT | `/api/branding` | admin + cờ `branding` + Origin | multipart: `appName` (trim, 1–60 ký tự; sai → 400 "App name must be 1–60 characters"), `icon?` (png/jpeg/webp/gif, ≤ 2 MB → 413 "Icon must be 2 MB or smaller"; loại khác → 400 "Icon must be PNG, JPEG, WebP or GIF"), `removeIcon?` (`"true"` → xoá object R2, `icon_key = null`). Lưu nguyên ảnh (không resize), upsert `app_settings` → `{appName, hasCustomIcon}` |
| GET | `/api/branding/icon` | public | Icon tuỳ chỉnh từ R2 (`Cache-Control: no-cache`, `X-Content-Type-Options: nosniff`, content-type đã lưu) hoặc icon mặc định từ static assets |

### 6.3 Thủ tục đọc branding hiệu lực
```
cờ = DOC_ENTITLEMENTS(env)
nếu !cờ.branding → {appName: APP_NAME cấu hình, icon: mặc định}
row = app_settings 'default'
→ {appName: row.app_name ?? APP_NAME, icon: row.icon_key ? tuỳ chỉnh : mặc định}
```

### 6.4 Nơi dùng branding
Favicon (`/api/branding/icon`), tên + biểu tượng ở sidebar, trang xác thực, màn hình loader, landing; `document.title` mặc định; **issuer TOTP** khi tạo QR ([02-nang-cao/15](../02-nang-cao/15-xac-thuc-2-lop.md)); tiêu đề và nội dung thư đặt lại mật khẩu ([02-nang-cao/14](../02-nang-cao/14-quen-mat-khau.md)); realm `WWW-Authenticate` của JMAP.

## 7. Lỗi & biên
- Tắt cờ `multiUser` khi đã có mailbox shared: mailbox vẫn tồn tại, chủ mailbox (người tạo) vẫn truy cập; thành viên mất quyền cho tới khi bật lại.
- Tắt cờ `accountForwarding` khi user đã có forwarding: giá trị giữ nguyên nhưng không có hiệu lực; UI hiển thị trạng thái "Forwarding is not available on this installation." nếu có giá trị.
- Upload icon lỗi R2 → 500, `app_settings` không đổi.

## 8. Tiêu chí chấp nhận
- [ ] Không đặt `LICENSE_SERVER_URL` và `ENTITLEMENTS` → mọi tính năng hoạt động, `/api/licenses` trả `configured: false`.
- [ ] `ENTITLEMENTS=branding` → `PATCH /api/settings/forwarding` với email khác rỗng trả 403; `PUT /api/branding` thành công.
- [ ] Cờ `mailboxSharing` tắt → thành viên được chia sẻ nhận 404 khi đọc thư của mailbox shared; bật lại → đọc được.
- [ ] Activate với key bị máy chủ từ chối (401) → 400 "The license server rejected this license key.", DB không đổi.
- [ ] Grep log sau activate/validate không thấy license key.
- [ ] `PUT /api/branding` với icon 3 MB → 413; với `removeIcon=true` → `/api/branding/icon` trả icon mặc định.
- [ ] Cờ `branding` tắt → `GET /api/branding` trả `appName = {APP_NAME}` cấu hình dù `app_settings.app_name` có giá trị.

## 9. Ghi chú triển khai
- Bản dùng riêng có thể bỏ hẳn máy chủ license: không đặt `LICENSE_SERVER_URL`, mọi cờ bật; bảng `license_settings` vẫn tồn tại để schema ổn định.
- Hash license key bằng SHA-256 là đủ vì key do máy chủ license sinh ngẫu nhiên, độ dài lớn.
