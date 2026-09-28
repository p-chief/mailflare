# Danh bạ & chặn người gửi

> **[NÂNG CAO]** · Gravatar là **[TÙY CHỌN]** → [03-tuy-chon/07](../03-tuy-chon/07-tien-ich-giao-dien.md) · Avatar → [19-cai-dat-ca-nhan-avatar.md](19-cai-dat-ca-nhan-avatar.md)

## 1. Mục tiêu
Tự động ghi nhớ người đã trao đổi thư để hiển thị tên thân thiện, cho người dùng sửa tên, và chặn người gửi không mong muốn.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Upsert tự động khi nhận/gửi/import | Trang quản lý danh bạ đầy đủ, import vCard |
| Xem/sửa tên một liên hệ | Gợi ý người nhận (autocomplete) — chưa có |
| Chặn (blocked + rule trash + spam 100) | Bỏ chặn (chưa có API) |

## 3. Mô hình
- Danh bạ thuộc **owner của mailbox** (`contacts.user_id`), không phải người đang xem → người được chia sẻ shared mailbox đọc/ghi danh bạ của owner.
- Khoá `(user_id, email lowercase)`; id `"<userId>:<email>"`.
- `source`: `manual` (người dùng đặt tên / danh tính chính mình) > `outbound` (đã từng gửi tới) > `inbound` (chỉ nhận từ).

## 4. Upsert tự động — `upsertContactFromAddress(userId, address, source)`
```
email = normalize(address); rỗng → null
name  = tên hiển thị trong header (null nếu bằng chính địa chỉ)
existing?
  displayName = existing.source == manual ? existing.displayName : (name ?? existing.displayName)
  source      = existing.source == manual || (existing.source == outbound && source == inbound) ? existing.source : source
  UPDATE displayName, source, lastSeenAt = now
else
  INSERT {id, userId, email, displayName: name, source, lastSeenAt: now}
  avatarKey = importGravatarAvatar(...)  (TÙY CHỌN)  → UPDATE nếu có
```
Gọi từ: thư đến (người gửi, `inbound`), gửi thư (mọi người nhận, `outbound`), import (người gửi hoặc người nhận), `syncPersonalIdentity` (địa chỉ của chính mình, `manual`).

## 5. Dùng tên liên hệ
`getContactDisplayNameMap(userId, addresses)` → map `email → displayName` (bỏ tên rỗng). Dùng cho `fromContactName`, `toContactName` ở danh sách, chi tiết, hội thoại. Hiển thị cuối cùng: tên liên hệ → tên trong header → local-part.

## 6. API
### 6.1 `GET /api/contacts?mailboxId=&address=` (canRead)
Nếu địa chỉ là của một mailbox personal của owner → trả danh tính user (`displayName = user.name`, `hasAvatar`, `source: manual`). Ngược lại contact đã lưu, hoặc khung rỗng `{email, displayName:null, hasAvatar:false, source:null, blocked:false, lastSeenAt:null}`.

### 6.2 `PATCH /api/contacts` (canManage)
Body `{ mailboxId, address, displayName (trim 1–100) }` (sai → 400 "A valid contact name is required").
- Địa chỉ là danh tính của owner: chỉ chính owner được đổi (403 "Only the account owner can change this contact") → `syncPersonalIdentity`.
- Lưu `displayName`, `source = manual` (tạo nếu chưa có). → `{contact}`.

### 6.3 `POST /api/contacts/block` (canManage)
Body `{ mailboxId, address }` (thiếu → 400 "Mailbox and contact are required").
```
email = normalize(address)
contact tồn tại → blocked = true; không → INSERT {blocked: true, source: inbound, …} (+ Gravatar)
nếu chưa có rule mailbox (mailboxId, matchField email, exact, matchValue email, action trash):
   INSERT routing_rules { id: `block:${mailboxId}:${email}`, userId, domainId, pattern: email,
                          matchField:'email', matchOperator:'exact', matchValue: email,
                          mailboxId, action:'trash', priority: 100 }
→ { contact: { email, blocked: true } }
```
Hệ quả khi thư mới tới: rule mailbox đưa vào **Trash** (rule chạy trước spam; điểm spam 100 "Sender is blocked" chỉ ghi nhận). UI sau khi chặn chuyển thư hiện tại vào Trash.

## 7. UI
Dialog chi tiết liên hệ (bấm vào tên người gửi/nhận): avatar (tải lên/đổi/xoá), tên (sửa), email (khoá), nguồn, "Last seen", cờ "Blocked contact", nút "Save contact". Menu thư: "Block contact".

## 8. Đề xuất khi viết lại
- `DELETE /api/contacts/block` (bỏ chặn: `blocked=false` + xoá rule `block:*`).
- Autocomplete người nhận từ danh bạ (sắp theo `lastSeenAt`, ưu tiên `outbound`).
- Không gọi Gravatar đồng bộ trong pipeline nhận thư.

## 9. Tiêu chí chấp nhận
- [ ] Nhận thư từ `"Maya Chen" <maya@x.com>` → contact `maya@x.com` tên "Maya Chen", source inbound.
- [ ] Gửi thư tới maya → source thành outbound; tên không bị mất.
- [ ] Đặt tên thủ công → thư sau với tên khác không ghi đè.
- [ ] Chặn → thư mới từ maya vào Trash.
