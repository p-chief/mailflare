# Danh bạ & chặn người gửi

> **[NÂNG CAO]** · Phụ thuộc: [01-rule-mailbox.md](01-rule-mailbox.md), [01-co-ban/03-ho-so-mat-khau.md §3](../01-co-ban/03-ho-so-mat-khau.md) (đồng bộ danh tính) · Liên quan: Gravatar **[TÙY CHỌN]** → [03-tuy-chon/07-tien-ich-giao-dien.md §6](../03-tuy-chon/07-tien-ich-giao-dien.md), avatar → [19-cai-dat-ca-nhan-avatar.md](19-cai-dat-ca-nhan-avatar.md), spam → [11-bo-loc-spam.md](11-bo-loc-spam.md)

## 1. Mục tiêu
Tự động ghi nhớ người đã trao đổi thư để hiển thị tên thân thiện, gợi ý người nhận khi soạn thư, cho người dùng sửa tên, chặn và bỏ chặn người gửi không mong muốn.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Upsert tự động khi nhận/gửi/import | Trang quản lý danh bạ đầy đủ, import/export vCard |
| Xem/sửa tên một liên hệ | Nhóm liên hệ, nhiều email cho một liên hệ |
| Chặn (blocked + rule trash + tín hiệu spam 100) và bỏ chặn | Chặn theo cả domain (dùng rule domain `reject`) |
| [NÂNG CAO] Gợi ý người nhận (autocomplete) trong composer | Khôi phục thư đã vào Trash khi bỏ chặn |

## 3. Quyền
| Thao tác | Quyền trên mailbox (`mailboxId` trong request) |
|---|---|
| Xem liên hệ, gợi ý người nhận | `canRead` |
| Sửa tên, chặn, bỏ chặn | `canManage` |
Không đủ quyền → 404 "Mailbox not found".

## 4. Mô hình
- Danh bạ thuộc **owner của mailbox** (`contacts.user_id`), không phải người đang xem → người được chia sẻ shared mailbox đọc/ghi danh bạ của owner.
- Khoá `(user_id, email lowercase)`; id `"<userId>:<email>"`.
- `source`: `manual` (người dùng đặt tên / danh tính chính mình) > `outbound` (đã từng gửi tới) > `inbound` (chỉ nhận từ).
- `blocked` là cờ theo owner (áp cho mọi mailbox của owner trong bộ lọc spam); rule `block:*` là theo từng mailbox.

## 5. Upsert tự động — thủ tục `UPSERT_LIEN_HE(userId, address, source)`
```
email = DIA_CHI(address)            // địa chỉ thuần lowercase (01-rule-mailbox §6); rỗng/không có '@' → return null
name  = tên hiển thị trong header (null nếu rỗng hoặc bằng chính địa chỉ)
existing = contacts WHERE user_id AND email
existing?
  displayName = existing.source == manual ? existing.displayName : (name ?? existing.displayName)
  source      = existing.source == manual || (existing.source == outbound && source == inbound)
                ? existing.source : source
  UPDATE displayName, source, lastSeenAt = now
else
  INSERT {id, userId, email, displayName: name, source, blocked: false, lastSeenAt: now}
     ON CONFLICT(user_id, email) DO NOTHING → xung đột (tạo đồng thời): chạy lại nhánh existing
  nếu tạo mới thật sự: lên lịch tra Gravatar chạy nền (TÙY CHỌN)
return contact
```
- Gọi từ: thư đến (người gửi, `inbound`), gửi thư (mọi người nhận to/cc/bcc, `outbound`), import (người gửi hoặc người nhận tuỳ chiều thư), đồng bộ danh tính (địa chỉ của chính mình, `manual`).
- **Tra Gravatar không bao giờ nằm trong đường xử lý thư**: consumer nhận thư và thủ tục gửi thư chỉ ghi dòng contact rồi đi tiếp; việc tra được lên lịch chạy nền (`waitUntil` hoặc message queue), có timeout, lỗi bỏ qua — chi tiết ở [03-tuy-chon/07 §6](../03-tuy-chon/07-tien-ich-giao-dien.md). Tắt tính năng → không có request nào ra ngoài.

## 6. Dùng tên liên hệ
Thủ tục `TEN_LIEN_HE(userId, addresses)` → map `email → displayName` (bỏ tên rỗng), một truy vấn `WHERE user_id = ? AND email IN (…)` (chia lô ≤ 90 địa chỉ). Dùng cho `fromContactName`, `toContactName` ở danh sách, chi tiết, hội thoại. Hiển thị cuối cùng: tên liên hệ → tên trong header → local-part.

## 7. API

### 7.1 `GET /api/contacts?mailboxId=&address=` (canRead)
Nếu địa chỉ là của một mailbox personal của owner → trả danh tính user (`displayName = user.name`, `hasAvatar`, `source: manual`, `blocked: false`). Ngược lại contact đã lưu, hoặc khung rỗng `{email, displayName:null, hasAvatar:false, source:null, blocked:false, lastSeenAt:null}`.

### 7.2 `PATCH /api/contacts` (canManage)
Body `{ mailboxId, address, displayName (trim 1–100) }` (sai → 400 "A valid contact name is required").
- Địa chỉ là danh tính của owner: chỉ chính owner được đổi (khác → 403 "Only the account owner can change this contact") → thủ tục đồng bộ danh tính (`DONG_BO_DANH_TINH`, [03-ho-so-mat-khau.md §3](../01-co-ban/03-ho-so-mat-khau.md)).
- Ngược lại: lưu `displayName`, `source = manual` (tạo nếu chưa có). → `{contact}`.

### 7.3 `POST /api/contacts/block` (canManage)
Body `{ mailboxId, address }` (thiếu → 400 "Mailbox and contact are required").
```
email = DIA_CHI(address); không hợp lệ → 400 "Mailbox and contact are required"
email là địa chỉ của chính mailbox/owner → 400 "You cannot block your own address"
contact tồn tại → blocked = true; không → INSERT {blocked: true, source: inbound, lastSeenAt: now}
UPSERT routing_rules (id = `block:${mailboxId}:${email}`) {
    userId: người gọi, domainId: mailbox.domainId, scope: 'mailbox', enabled: true,
    pattern: email, matchField: 'email', matchOperator: 'exact', matchValue: email,
    mailboxId, folderId: null, action: 'trash', priority: 100 }
    // đã có → bật lại (enabled = true), không tạo trùng
audit 'contact.block' {mailboxId, email}
→ { contact: { email, blocked: true } }
```
Hệ quả khi thư mới tới: rule mailbox đưa vào **Trash** (rule chạy trước spam); tín hiệu spam `blocked_sender` (điểm 100) chỉ ghi nhận. UI sau khi chặn chuyển thư đang xem vào Trash.

### 7.4 `DELETE /api/contacts/block?mailboxId=&address=` (canManage) — bỏ chặn
```
email = DIA_CHI(address); thiếu mailboxId/address → 400 "Mailbox and contact are required"
UPDATE contacts SET blocked = false WHERE user_id = owner AND email = ?
DELETE routing_rules WHERE scope = 'mailbox'
       AND mailbox_id IN (SELECT id FROM mailboxes WHERE user_id = owner)
       AND id = 'block:' || mailbox_id || ':' || :email
audit 'contact.unblock' {mailboxId, email}
→ { contact: { email, blocked: false } }
```
- Idempotent: liên hệ chưa bị chặn / không tồn tại → vẫn trả 200 (không tạo contact).
- Vì `blocked` là cờ theo owner, bỏ chặn gỡ mọi rule `block:*` của địa chỉ đó trên các mailbox của owner. Rule người dùng tự tạo (id `rule_…`) không bị động tới.
- Thư đã vào Trash trước đó không tự khôi phục.

### 7.5 [NÂNG CAO] `GET /api/contacts/suggest?mailboxId=&q=` (canRead) — gợi ý người nhận
```
q = trim(q); độ dài 1–100, không có → { contacts: [] }
p = escape ký tự LIKE (%, _, \) trong lower(q)
SELECT email, display_name, source, last_seen_at FROM contacts
WHERE user_id = owner AND blocked = 0
  AND (email LIKE p || '%' ESCAPE '\' OR lower(display_name) LIKE '%' || p || '%' ESCAPE '\'
       OR email LIKE '%@' || p || '%' ESCAPE '\')
ORDER BY CASE source WHEN 'manual' THEN 0 WHEN 'outbound' THEN 1 ELSE 2 END,
         last_seen_at DESC
LIMIT 8
→ { contacts: [{ email, displayName, source }] }
```
Loại khỏi kết quả các địa chỉ của chính mailbox đang soạn.

## 8. UI
- Dialog chi tiết liên hệ (bấm vào tên người gửi/nhận): avatar (tải lên/đổi/xoá), tên (sửa), email (khoá), nguồn, "Last seen", cờ "Blocked contact", nút "Save contact", nút "Block contact" / "Unblock contact" theo trạng thái.
- Menu thư: "Block contact" (liên hệ đã bị chặn → "Unblock contact").
- Bỏ chặn → toast "Contact unblocked. New mail from {email} will arrive in your inbox."
- [NÂNG CAO] Composer To/Cc/Bcc: gõ ≥ 1 ký tự → sau 150 ms gọi §7.5, dropdown tối đa 8 mục ("Tên — email" hoặc chỉ email); ↑/↓ chọn, Enter/Tab chèn `"Tên" <email>` thành chip, Esc đóng; bỏ qua kết quả của request cũ khi request mới đã gửi.

## 9. Tiêu chí chấp nhận
- [ ] Nhận thư từ `"Maya Chen" <maya@x.com>` → contact `maya@x.com` tên "Maya Chen", source inbound.
- [ ] Gửi thư tới maya → source thành outbound; tên không bị mất.
- [ ] Đặt tên thủ công → thư sau với tên khác không ghi đè.
- [ ] Chặn → thư mới từ maya vào Trash; rule chặn có `scope='mailbox'`, priority 100.
- [ ] Chặn hai lần → chỉ một rule `block:<mailboxId>:<email>`.
- [ ] Bỏ chặn → `blocked=false`, rule `block:*` bị xoá; thư mới từ maya vào Inbox.
- [ ] Gravatar phản hồi chậm 30 s không làm chậm việc lưu thư đến.
- [ ] [NÂNG CAO] Gõ "ma" trong ô To → gợi ý maya (liên hệ outbound xếp trước inbound); liên hệ bị chặn không xuất hiện.
- [ ] User `read_only` gọi chặn/bỏ chặn → 404.
