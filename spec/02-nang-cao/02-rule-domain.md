# Rule cấp domain: chặn, chuyển tiếp, catch-all

> **[NÂNG CAO]** · Phạm vi `scope = 'domain'` · Chạy trong `email()` handler **khi phân giải địa chỉ**
> Phụ thuộc: [01-co-ban/06-nhan-thu.md §4](../01-co-ban/06-nhan-thu.md), [01-rule-mailbox.md §6](01-rule-mailbox.md) (hàm so khớp)

## 1. Mục tiêu
Cho quản trị viên quyết định số phận thư **trước khi** giao vào mailbox: từ chối người gửi (block list), chuyển tiếp ra ngoài, hoặc hứng mọi địa chỉ lạ (catch-all) vào một mailbox.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Rule reject/forward/store theo domain | Lọc vào folder/spam/trash (rule mailbox) |
| 3 pha đánh giá, thống kê match | Xác minh destination address trên Cloudflare |
| Quyền admin domain hoặc full_access mailbox | |

## 3. Ba pha (bất biến quan trọng)
```
Pha 1  reject   — chạy TRƯỚC tra mailbox: chặn được người gửi kể cả khi người nhận là mailbox thật
Pha 2  mailbox thật / alias / useAllDomains — luôn THẮNG catch-all
Pha 3  forward / store — chỉ khi không có mailbox nào khớp (catch-all, forward địa chỉ lạ)
Trong mỗi pha: priority DESC, created_at ASC; rule khớp đầu tiên thắng
```
**Phải giữ** việc tách pha này: nếu gộp, một rule `*` sẽ che mất mọi mailbox thật.

| Hành động | Pha | Kết quả trong `email()` |
|---|---|---|
| `reject` | 1 | `message.setReject(rejectReason || "Message rejected by routing rule")` |
| `forward` | 3 | `message.forward(forwardTo, {X-Mailflare-Forwarded: 1})`; `keepCopy && mailboxId` → vẫn lưu vào mailbox; forward lỗi → vẫn lưu (nếu có mailbox) |
| `store` | 3 | lưu vào `mailboxId` (catch-all) |

Rule bị bỏ qua khi: `enabled = false`; `forward` không có `forwardTo`; `store` không có mailbox hợp lệ (không tồn tại / disabled).

## 4. Dữ liệu vào khi so khớp
Trong `email()` chỉ có **envelope** `to` và `from`. Do đó:
- `recipient` → envelope to; `sender` → envelope from.
- `title`, `content` → **luôn rỗng** ⇒ rule domain theo tiêu đề/nội dung **không bao giờ khớp** (trừ `*`). UI vẫn cho chọn — nên bỏ lựa chọn hoặc đọc header trong handler.

## 5. Quyền
```
adminDomain = !mailboxId query && user.role == admin
              && domain.id == ? && domain.user_id == (user.canManageMailboxes && createdByUserId ? createdByUserId : user.id)
mailboxMode = mailboxId query && canManage(mailboxId) && mailbox.domainId == domainId
!adminDomain && !mailboxMode → 403 "Domain or mailbox access is required"
```
Mailbox đích (`mailboxId` trong body) phải: (admin) thuộc domain; (mailbox mode) người gọi `full_access` và thuộc domain → khác: 403 "Mailbox access is required for the destination".

## 6. API

### 6.1 `GET /api/routing-rules/domain?domainId=[&mailboxId=]`
`domainId` bắt buộc (400). Trả:
```json
{ "rules": [ …mọi rule scope=domain của domain, ORDER BY priority DESC, created_at ASC… ],
  "mailboxes": [ { "id","localPart","displayName","disabled" } ] }
```
`mailboxes`: admin → mọi mailbox của domain (theo localPart); mailbox mode → các mailbox người gọi full_access trên domain.

### 6.2 `POST /api/routing-rules/domain[?mailboxId=]`
| Trường | Quy tắc |
|---|---|
| `domainId` | bắt buộc |
| `name` | trim, ≤120, tuỳ chọn |
| `enabled` | bool, mặc định true |
| `matchField` | `recipient` (mặc định) \| `sender` \| `title` \| `content` |
| `matchOperator` | `contains` (mặc định) \| `exact` \| `starts_with` \| `ends_with` \| `regex` |
| `matchValue` | trim, 1–500; `*` = mọi thư |
| `action` | `store` \| `forward` \| `reject` (bắt buộc) |
| `mailboxId` | bắt buộc với `store`; bắt buộc với `forward + keepCopy` |
| `forwardTo` | email, bắt buộc với `forward` |
| `keepCopy` | bool, mặc định false |
| `rejectReason` | ≤200 |
| `priority` | 0–1000, mặc định 0 |
Lỗi validate (400) kèm thông điệp: "Choose the mailbox that should receive matching mail", "A forwarding destination is required", "Keeping a copy requires a destination mailbox", "Enter a valid regular expression".

Chuẩn hoá khi lưu (`toRuleColumns`):
```
scope 'domain'; name trim || null; pattern = matchValue
mailboxId    = action == reject  ? null : mailboxId
folderId     = null
forwardTo    = action == forward ? trim(forwardTo) : null
keepCopy     = action == forward ? keepCopy : false
rejectReason = action == reject  ? trim || null : null
```
→ `{id}`.

### 6.3 `PATCH /api/routing-rules/domain/{id}[?mailboxId=]`
Tải rule `scope='domain'` (404 "Rule not found"), kiểm tra quyền theo domain của rule. Body như POST nhưng **`domainId` bị ép bằng domain của rule** (không cho chuyển rule sang domain khác). Ghi đè toàn bộ cột. → `{ok:true}`.

### 6.4 `DELETE /api/routing-rules/domain/{id}[?mailboxId=]`
Kiểm tra như PATCH → xoá. Không hỏi xác nhận ở UI.

## 7. Thống kê
Mỗi lần một rule domain tạo ra quyết định (trong `email()` hoặc intake): `match_count += 1`, `last_matched_at = now` (đọc rồi ghi — không atomic; nên dùng `UPDATE … SET match_count = match_count + 1`). Consumer phân giải lại **không** ghi thống kê.

## 8. UI (tóm tắt)
- Hai nhóm: **Block rules** ("Evaluated before delivery. Matching mail is rejected at the edge.") và **Catch-all and forwarding** ("Evaluated only when no mailbox on the domain matched the recipient.").
- Mô tả dòng: `Any message` khi `*`, ngược lại `{Field} {operator} "{value}"` + `→ reject` / `→ forward to X [and keep a copy]` / `→ deliver to local@host`; "Priority p · matched n× · last <date|Never>"; switch bật/tắt.
- Mặc định form: recipient / contains / store / priority **100** / enabled.
- Có ở 2 nơi: `/routing` (admin, chọn domain) và `/settings/rules` (mailbox mode, domain của mailbox đang chọn).

## 9. Tiêu chí chấp nhận
- [ ] Rule `sender ends_with @spam.com → reject`: thư từ `x@spam.com` tới mailbox thật bị bounce với lý do cấu hình.
- [ ] Rule `recipient contains * → store vào catch-all@`: thư tới `random@domain` vào mailbox catch-all; thư tới mailbox thật vẫn vào mailbox thật.
- [ ] Rule forward không keepCopy: thư chỉ được forward, không lưu; forward lỗi → thư được lưu (nếu có mailbox).
- [ ] Rule bị disable không có hiệu lực.
- [ ] `match_count` tăng mỗi lần khớp.
- [ ] User không phải admin, không có full_access mailbox của domain → 403.
