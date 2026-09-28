# Chuyển tiếp toàn tài khoản (Account forwarding)

> **[NÂNG CAO]** (bản gốc: cần license Pro/Team) · Phụ thuộc: [01-co-ban/06-nhan-thu.md §3](../01-co-ban/06-nhan-thu.md)
> Khác với rule domain `forward` ([02-rule-domain.md](02-rule-domain.md)): đây là cấu hình **theo user**, luôn giữ bản sao.

## 1. Mục tiêu
Mọi thư đến bất kỳ mailbox nào của một user được chuyển thêm một bản sang địa chỉ ngoài (vd Gmail cá nhân), đồng thời vẫn lưu trong hệ thống.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Một địa chỉ đích / user | Nhiều đích, lọc theo điều kiện |
| Chống vòng lặp bằng header | Tự tạo/xác minh destination address trên Cloudflare |

## 3. Cấu hình
`users.forwarding_email`. Đặt qua:
- `PATCH /api/settings/forwarding {forwardingEmail: email | ""}` — cần quyền forwarding (403 "A Pro or Team license is required for email forwarding").
- `PATCH /api/settings/profile` / `PATCH /api/accounts/{id}` — chỉ chặn khi **đặt giá trị mới khác rỗng**; xoá hoặc giữ nguyên luôn được phép.
UI: "Destination email" — "Incoming mail will also be sent to this verified Cloudflare Email Routing destination."

## 4. Luồng (trong `email()` handler, sau rule domain)
```
if message.headers["X-Mailflare-Forwarded"] == "1": bỏ qua        // thư do chính hệ thống forward
dest = getAccountForwardingDestination(to):
   !entitled → null
   decision = resolveInboundAddress(to); !decision.mailbox → null
   dest = trim(owner.forwardingEmail)
   dest rỗng || address(dest) == address(to) → null
if dest: message.forward(dest, {X-Mailflare-Forwarded: "1"})       // lỗi chỉ log
→ tiếp tục lưu R2 + enqueue như bình thường
```
- Áp dụng cho **mọi** mailbox mà user là owner (kể cả shared mailbox do admin sở hữu).
- Kiểm tra forward rule domain trước: nếu rule forward-only đã `return` thì không tới bước này.

## 5. Ràng buộc Cloudflare
`message.forward()` chỉ gửi tới **destination address đã xác minh** trong Email Routing của account. Địa chỉ chưa xác minh → forward lỗi (thư vẫn lưu). Khi viết lại có thể gọi API `POST /accounts/{account_id}/email/routing/addresses` để tạo destination và hướng dẫn người dùng bấm link xác minh.

## 6. Tiêu chí chấp nhận
- [ ] Đặt forwarding tới địa chỉ đã xác minh → thư đến được chuyển và vẫn có trong Inbox.
- [ ] Đích trùng chính địa chỉ nhận → không forward.
- [ ] Hai hệ thống Mailflare forward cho nhau → không vòng lặp.
