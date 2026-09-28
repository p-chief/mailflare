# Alias & "dùng trên mọi domain" (useAllDomains)

> **[NÂNG CAO]** · Phụ thuộc: [01-co-ban/05-quan-ly-mailbox.md §3.2](../01-co-ban/05-quan-ly-mailbox.md)

## 1. Mục tiêu
Cho một mailbox nhận và gửi thư dưới nhiều địa chỉ: địa chỉ phụ tường minh (alias) và cùng username trên các domain khác của cùng chủ.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Alias `localPart@domain` → 1 mailbox | Alias trỏ nhiều mailbox (dùng rule domain / shared) |
| useAllDomains tự động mở rộng khi thêm domain | Alias wildcard |
| Dùng alias làm From khi gửi | |

## 3. Alias

### 3.1 Dữ liệu
`mailbox_aliases(id als_…, mailbox_id, domain_id, local_part)`, UNIQUE `(domain_id, local_part)`.

### 3.2 `GET /api/mailboxes/{id}/aliases` (canManage)
`{ aliases: [{id, domainId, localPart, hostname, createdAt}], availableDomains: [{id, hostname}] }` — `availableDomains` = domain **active** của chủ domain của mailbox.

### 3.3 `POST /api/mailboxes/{id}/aliases` (canManage)
Body `{ domainId, localPart }` (`localPart` trim, 1–64, `[a-zA-Z0-9._%+-]`, lowercase). Sai → 400 "Enter a valid alias username and domain".
```
domain phải thuộc chủ domain của mailbox và active → 404 "Domain not found"
có mailbox (domain, localPart) → 409 "A mailbox already uses this address"
có alias (domain, localPart)   → 409 "An alias already uses this address"
INSERT … ON CONFLICT DO NOTHING RETURNING → rỗng: 409 (race)
try ensureEmailRoutingRuleToWorker(zone, `${localPart}@${hostname}`)
catch → DELETE alias; 502 "Failed to create the Cloudflare Email Routing rule for this alias. Please try again."
→ { aliases }   (danh sách sau cập nhật)
```

### 3.4 `DELETE /api/mailboxes/{id}/aliases?aliasId=` (canManage)
```
alias phải thuộc mailbox → 404 "Alias not found"
nếu KHÔNG còn mailbox useAllDomains khác (khác id, !disabled) cùng localPart:
    try deleteEmailRoutingRuleForAddress(...) catch → 502 (giữ alias)
DELETE alias → { aliases }
```

## 4. useAllDomains
- Cờ trên mailbox, **mặc định true**. UI: "Receive and send mail as this username on every active domain in this admin account."
- Địa chỉ mở rộng: `localPart@D` cho mỗi domain `active` D ≠ domain chính của **cùng chủ domain**, trừ D đã có mailbox khác hoặc alias của mailbox khác với localPart (chuẩn hoá) trùng.
- Nhận thư: pha 2 bước 3 của phân giải (sau mailbox chính xác và alias).
- Gửi thư: có trong `senderAddresses` → dùng được làm From.
- Khi **thêm domain mới**: mọi mailbox `useAllDomains` của chủ đó được tạo rule Cloudflare cho địa chỉ trên domain mới.
- Bật lại (`PATCH useAllDomains: true`) → tạo rule cho mọi domain; lỗi → 502.
- **Tắt** hiện không xoá rule Cloudflare đã tạo (khuyến nghị bổ sung). Do có catch-all → Worker, việc giữ rule không làm thư sai mailbox (phân giải vẫn theo DB).

## 5. Thứ tự ưu tiên khi nhận
`mailbox chính xác` > `alias trên domain` > `mailbox useAllDomains` > `rule domain (catch-all/forward)`.

## 6. Tiêu chí chấp nhận
- [ ] Thêm alias `sales@b.com` cho mailbox `me@a.com` → thư tới `sales@b.com` vào mailbox `me`; composer có From `sales@b.com`.
- [ ] Tạo alias trùng địa chỉ mailbox → 409.
- [ ] Có domain `a.com`, `b.com`; mailbox `me@a.com` useAllDomains → thư tới `me@b.com` vào `me@a.com`, trừ khi đã có mailbox `me@b.com` riêng.
- [ ] Xoá alias → rule Cloudflare bị xoá (nếu không còn ai dùng địa chỉ đó).
