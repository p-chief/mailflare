# Chuyển tiếp toàn tài khoản (Account forwarding)

> **[NÂNG CAO]** · Có thể khoá bằng quyền lợi `accountForwarding` ([03-tuy-chon/01-license-branding.md](../03-tuy-chon/01-license-branding.md)) · Phụ thuộc: [01-co-ban/06-nhan-thu.md §3](../01-co-ban/06-nhan-thu.md), [00-nen-tang/07-cloudflare-api.md](../00-nen-tang/07-cloudflare-api.md) · Liên quan: [02-rule-domain.md](02-rule-domain.md), [01-co-ban/03-ho-so-mat-khau.md](../01-co-ban/03-ho-so-mat-khau.md)

Khác với rule domain `forward` ([02-rule-domain.md](02-rule-domain.md)): đây là cấu hình **theo user**, luôn giữ bản sao trong hệ thống.

## 1. Mục tiêu
Mọi thư đến bất kỳ mailbox nào mà user là owner được chuyển thêm một bản sang địa chỉ ngoài (vd hộp thư cá nhân), đồng thời vẫn lưu trong hệ thống.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Một địa chỉ đích / user | Nhiều đích, lọc theo điều kiện (dùng rule domain) |
| Chống vòng lặp bằng header | Chuyển tiếp thư đi |
| [NÂNG CAO] Tạo destination address trên Cloudflare và hiển thị trạng thái xác minh (§6) | Tự xác minh hộ người dùng (Cloudflare bắt buộc người nhận bấm link) |

## 3. Quyền lợi `accountForwarding`
- Cờ trong bộ quyền lợi (entitlements) của cài đặt. **Mặc định bật** khi người triển khai không cấu hình phân gói; khi có phân gói, người triển khai gán cờ cho gói mong muốn.
- Nơi áp dụng:
  | Nơi | Khi cờ tắt |
  |---|---|
  | Bước chuyển tiếp trong handler `email()` (§5) | Không forward (thư vẫn lưu bình thường) |
  | `PATCH /api/settings/forwarding` | 403 "Email forwarding is not available on this installation" |
  | Đặt `forwardingEmail` qua `PATCH /api/settings/profile`, `PATCH /api/accounts/{id}` | 403 cùng thông điệp — **chỉ** khi đặt giá trị mới khác rỗng; xoá hoặc giữ nguyên luôn được phép |
  | Response hồ sơ | `canForwardEmail = accountForwarding` để UI ẩn/khoá ô nhập |
- Tắt cờ không xoá `users.forwarding_email` đã lưu; bật lại → chuyển tiếp hoạt động lại ngay.

## 4. Cấu hình
`users.forwarding_email` (lowercase, null = tắt). Đặt qua:
- `PATCH /api/settings/forwarding {forwardingEmail: email | ""}` (session, chính user) — `""` → null; không phải email hợp lệ → 400 "Enter a valid email address". → `{forwardingEmail, forwardingStatus}` (§6).
- Profile / quản lý tài khoản như bảng §3.

UI (Settings → Forwarding): "Destination email" — "Incoming mail will also be sent to this verified Cloudflare Email Routing destination."; nút "Save"; ô trống + Save = tắt chuyển tiếp.

## 5. Luồng (trong handler `email()`, sau rule domain)
```
if message.headers["X-App-Forwarded"] == "1": bỏ qua bước này     // thư do chính hệ thống (hoặc hệ thống cùng loại) đã forward
dest = DICH_CHUYEN_TIEP(to):
   !accountForwarding → null
   decision = phân giải địa chỉ nhận(to, from); !decision.mailbox → null     // 06-nhan-thu §4
   owner = users WHERE id = decision.mailbox.userId; owner disabled → null
   dest = trim(owner.forwarding_email)
   dest rỗng || DIA_CHI(dest) == DIA_CHI(to) → null
if dest: message.forward(dest, headers {X-App-Forwarded: "1"})   // API Cloudflare; lỗi chỉ log
→ tiếp tục lưu R2 + enqueue như bình thường
```
`DIA_CHI(v)` = địa chỉ thuần lowercase ([01-rule-mailbox.md §6](01-rule-mailbox.md)).
- Áp dụng cho **mọi** mailbox mà user là owner (kể cả shared mailbox do user đó sở hữu); người được chia sẻ mailbox không làm thư được forward sang địa chỉ của họ.
- Rule domain forward-only (không keepCopy) đã kết thúc xử lý thì không tới bước này.
- Thư bị rule domain reject không bao giờ được forward.
- Thư sau đó bị phân loại Spam/Trash trong consumer **vẫn** đã được forward (quyết định forward xảy ra trước khi parse MIME).

## 6. [NÂNG CAO] Destination address trên Cloudflare
`message.forward()` chỉ gửi tới **destination address đã xác minh** trong Email Routing của account Cloudflare. Để người dùng không phải tự vào dashboard:
```
Khi lưu forwardingEmail mới (khác rỗng) và domain không ở chế độ "manual":
   accountId = account.id trong kết quả đọc zone (GET /zones/{zoneId}) của một domain active
   CF_REQUEST POST /accounts/{accountId}/email/routing/addresses { email: forwardingEmail }
       thành công            → Cloudflare gửi thư xác minh tới địa chỉ đó
       lỗi "đã tồn tại"      → coi là thành công
       lỗi khác              → log; vẫn lưu forwardingEmail; forwardingStatus = "unknown"
forwardingStatus (tính khi đọc cài đặt):
   GET /accounts/{accountId}/email/routing/addresses → tìm email (lowercase)
       có & verified != null → "verified"
       có & verified == null → "pending"
       không có               → "missing"
       lỗi API / không có credentials → "unknown"
```
- `GET /api/settings/forwarding` → `{forwardingEmail, forwardingStatus}`.
- UI theo trạng thái: `verified` → "Verified"; `pending` → "Pending verification — open the link Cloudflare sent to {email}."; `missing` → "Not registered with Cloudflare" + nút "Send verification email" (gọi lại POST ở trên qua `POST /api/settings/forwarding/verify`); `unknown` → không hiển thị huy hiệu.
- Token Cloudflare cần quyền "Email Routing Addresses: Edit" ở cấp account; thiếu quyền → trạng thái `unknown`, không chặn lưu.

## 7. Lỗi & biên
| Tình huống | Kết quả |
|---|---|
| Đích chưa xác minh | `message.forward` lỗi → log, thư vẫn lưu |
| Đích trùng chính địa chỉ nhận | Không forward |
| Hai hệ thống cùng loại forward cho nhau | Thư mang `X-App-Forwarded: 1` không bị forward lần nữa → không vòng lặp |
| Runtime tự host (không có `message.forward`) | Cùng logic, hành động forward do runtime thực hiện (gửi lại raw qua đường gửi của nó, hoặc relay Worker gọi `message.forward`) — xem [03-tuy-chon/08-runtime-node-tu-host.md](../03-tuy-chon/08-runtime-node-tu-host.md); luôn kèm header `X-App-Forwarded: 1` |

## 8. Tiêu chí chấp nhận
- [ ] Đặt forwarding tới địa chỉ đã xác minh → thư đến được chuyển và vẫn có trong Inbox.
- [ ] Đích trùng chính địa chỉ nhận → không forward.
- [ ] Hai cài đặt của hệ thống forward cho nhau → không vòng lặp.
- [ ] Quyền lợi `accountForwarding` tắt → đặt địa chỉ mới bị 403, xoá địa chỉ vẫn được; thư đến không bị forward.
- [ ] [NÂNG CAO] Lưu địa chỉ mới → Cloudflare gửi thư xác minh; UI hiện "Pending verification" tới khi người dùng xác minh, sau đó "Verified".
