# Alias & "dùng trên mọi domain" (useAllDomains)

> **[NÂNG CAO]** · Phụ thuộc: [01-co-ban/05-quan-ly-mailbox.md §3.2–3.3](../01-co-ban/05-quan-ly-mailbox.md), [00-nen-tang/07-cloudflare-api.md §4](../00-nen-tang/07-cloudflare-api.md) · Liên quan: [01-co-ban/06-nhan-thu.md §4](../01-co-ban/06-nhan-thu.md), [01-co-ban/11-gui-thu.md](../01-co-ban/11-gui-thu.md)

## 1. Mục tiêu
Cho một mailbox nhận và gửi thư dưới nhiều địa chỉ: địa chỉ phụ tường minh (alias) và cùng username trên các domain khác của cùng chủ.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Alias `localPart@domain` → 1 mailbox | Alias trỏ nhiều mailbox (dùng rule domain / shared mailbox) |
| useAllDomains tự động mở rộng khi thêm domain | Alias wildcard |
| Dùng alias / địa chỉ mở rộng làm From khi gửi | Tên hiển thị riêng theo alias |

## 3. Quyền
`canManage` (`full_access`) trên mailbox cho mọi thao tác alias và đổi `useAllDomains`. Không đủ quyền → 404 "Mailbox not found".

## 4. Alias

### 4.1 Dữ liệu
`mailbox_aliases(id als_…, mailbox_id, domain_id, local_part, created_at)`, UNIQUE `(domain_id, local_part)`; `local_part` lưu lowercase.

### 4.2 `GET /api/mailboxes/{id}/aliases`
`{ aliases: [{id, domainId, localPart, hostname, createdAt}], availableDomains: [{id, hostname}] }` — `availableDomains` = các domain **active** của chủ domain của mailbox.

### 4.3 `POST /api/mailboxes/{id}/aliases`
Body `{ domainId, localPart }` (`localPart` trim, 1–64, `[a-zA-Z0-9._%+-]`, lưu lowercase). Sai → 400 "Enter a valid alias username and domain".
```
domain phải thuộc chủ domain của mailbox và active     → 404 "Domain not found"
có mailbox (domain, CHUAN_HOA_LOCAL(localPart) trùng)  → 409 "A mailbox already uses this address"
có alias   (domain, CHUAN_HOA_LOCAL(localPart) trùng)  → 409 "An alias already uses this address"
INSERT … ON CONFLICT DO NOTHING RETURNING → rỗng: 409 "An alias already uses this address" (tranh chấp)
try đảm bảo rule địa chỉ → Worker (zone của domain, `${localPart}@${hostname}`)   // 07-cloudflare-api §4
catch → DELETE alias vừa tạo; 502 "Failed to create the Cloudflare Email Routing rule for this alias. Please try again."
→ 201 { aliases }   (danh sách sau cập nhật)
```
`CHUAN_HOA_LOCAL` định nghĩa ở [06-nhan-thu.md §4.1](../01-co-ban/06-nhan-thu.md). Domain `zone_id = "manual"` → bỏ qua bước Cloudflare.

### 4.4 `DELETE /api/mailboxes/{id}/aliases?aliasId=`
```
alias phải thuộc mailbox → 404 "Alias not found"
nếu KHÔNG còn mailbox useAllDomains khác (khác id, !disabled) cùng CHUAN_HOA_LOCAL(localPart)
   có địa chỉ này trong DIA_CHI_HOP_LE của nó:
    try xoá rule của địa chỉ (zone, `${localPart}@${hostname}`)
    catch → 502 "Failed to remove the Cloudflare Email Routing rule for this alias. Please try again." (giữ alias)
DELETE alias → { aliases }
```

## 5. useAllDomains
- Cờ trên mailbox, **mặc định true**. UI: "Receive and send mail as this username on every active domain in this admin account."
- Địa chỉ mở rộng: `localPart@D` cho mỗi domain `active` D ≠ domain chính, thuộc **cùng chủ domain**, trừ D đã có mailbox khác hoặc alias của mailbox khác với local-part (chuẩn hoá) trùng — công thức đầy đủ là thủ tục `DIA_CHI_HOP_LE(mailbox)` ([05-quan-ly-mailbox.md §3.2](../01-co-ban/05-quan-ly-mailbox.md)).
- Nhận thư: Pha 2, bước thứ ba của phân giải địa chỉ nhận (sau mailbox chính xác và alias).
- Gửi thư: có trong `senderAddresses` → dùng được làm From.
- **Thêm domain mới**: mọi mailbox `useAllDomains` (không disabled) của chủ đó được tạo rule Cloudflare cho địa chỉ trên domain mới; lỗi từng địa chỉ chỉ log (domain vẫn được thêm); tắt rồi bật lại useAllDomains chạy lại đồng bộ.
- **Bật** (`PATCH /api/mailboxes/{id} {useAllDomains: true}`) → đồng bộ routing cho mọi địa chỉ; lỗi → hoàn lại cờ, 502.
- **Tắt** (`useAllDomains: false`) → xoá rule Cloudflare của các địa chỉ trên domain phụ (`DIA_CHI_HOP_LE` khi bật − khi tắt), trừ địa chỉ vẫn được alias hoặc mailbox khác dùng; lỗi → 502, cờ giữ nguyên. Chi tiết ở [05-quan-ly-mailbox.md §4.4](../01-co-ban/05-quan-ly-mailbox.md).
- **Xoá domain phụ**: rule của domain bị xoá theo quy trình dọn domain; địa chỉ mở rộng trên domain đó tự biến mất khỏi `DIA_CHI_HOP_LE`.

## 6. Thứ tự ưu tiên khi nhận
`mailbox chính xác` > `alias trên domain` > `mailbox useAllDomains` > `rule domain (catch-all/forward)`. Rule domain `reject` chạy trước tất cả (xem [02-rule-domain.md §3](02-rule-domain.md)).

## 7. UI (Settings → Mailbox → Addresses)
- Danh sách địa chỉ: địa chỉ chính (nhãn "Primary"), các alias (nút xoá), các địa chỉ mở rộng khi bật useAllDomains (nhãn "All domains", không xoá riêng được).
- Form "Add alias": ô username + chọn domain (`availableDomains`) + nút "Add"; lỗi hiển thị nguyên thông điệp API.
- Switch useAllDomains với mô tả ở §5; 502 → toast thông điệp và switch trở lại trạng thái cũ.

## 8. Tiêu chí chấp nhận
- [ ] Thêm alias `sales@b.com` cho mailbox `me@a.com` → thư tới `sales@b.com` vào mailbox `me`; composer có From `sales@b.com`.
- [ ] Tạo alias trùng địa chỉ mailbox → 409; trùng alias khác → 409.
- [ ] Cloudflare lỗi khi tạo rule → 502 và alias không còn trong DB.
- [ ] Có domain `a.com`, `b.com`; mailbox `me@a.com` useAllDomains → thư tới `me@b.com` vào `me@a.com`, trừ khi đã có mailbox `me@b.com` riêng.
- [ ] Tắt useAllDomains → rule Cloudflare cho `me@b.com` bị xoá; `me@b.com` không còn là From hợp lệ.
- [ ] Xoá alias → rule Cloudflare bị xoá (nếu không còn ai dùng địa chỉ đó).
