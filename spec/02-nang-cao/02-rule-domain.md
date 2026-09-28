# Rule cấp domain: chặn, chuyển tiếp, catch-all

> **[NÂNG CAO]** · Phạm vi `scope = 'domain'` · Chạy trong handler `email()` **khi phân giải địa chỉ** · Phụ thuộc: [01-co-ban/06-nhan-thu.md §4](../01-co-ban/06-nhan-thu.md), [01-rule-mailbox.md §6](01-rule-mailbox.md) (thủ tục so khớp `KHOP_RULE`) · Liên quan: [08-chuyen-tiep-tai-khoan.md](08-chuyen-tiep-tai-khoan.md)

## 1. Mục tiêu
Cho quản trị viên quyết định số phận thư **trước khi** giao vào mailbox: từ chối người gửi (block list), chuyển tiếp ra ngoài, hoặc hứng mọi địa chỉ lạ (catch-all) vào một mailbox.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Rule `reject` / `forward` / `store` theo domain | Lọc vào folder/spam/trash (rule mailbox — [01-rule-mailbox.md](01-rule-mailbox.md)) |
| 3 pha đánh giá, thống kê match | Xác minh destination address trên Cloudflare |
| So khớp trên **envelope** (người gửi, người nhận) | So khớp tiêu đề/nội dung (cần parse MIME — không làm trong handler `email()`) |
| Quyền admin domain hoặc `full_access` mailbox | |

## 3. Ba pha (bất biến quan trọng)
```
Pha 1  reject   — chạy TRƯỚC tra mailbox: chặn được người gửi kể cả khi người nhận là mailbox thật
Pha 2  mailbox thật / alias / useAllDomains — luôn THẮNG catch-all
Pha 3  forward / store — chỉ khi không có mailbox nào khớp (catch-all, forward địa chỉ lạ)
Trong mỗi pha: priority DESC, created_at ASC; rule khớp đầu tiên thắng
```
**Phải giữ** việc tách pha này: nếu gộp, một rule `*` sẽ che mất mọi mailbox thật. Thuật toán đầy đủ nằm ở thủ tục phân giải địa chỉ nhận ([06-nhan-thu.md §4](../01-co-ban/06-nhan-thu.md)).

| Hành động | Pha | Kết quả trong handler `email()` |
|---|---|---|
| `reject` | 1 | `message.setReject(rejectReason \|\| "Message rejected by routing rule")` (API Cloudflare Email Routing) |
| `forward` | 3 | `message.forward(forwardTo, headers {X-App-Forwarded: "1"})`; `keepCopy && mailboxId` → vẫn lưu vào mailbox; forward lỗi → vẫn lưu (nếu có mailbox) để không mất thư |
| `store` | 3 | lưu vào `mailboxId` (catch-all) |

Rule bị bỏ qua (xét rule kế tiếp) khi: `enabled = false`; `forward` không có `forwardTo`; `store` không có mailbox hợp lệ (không tồn tại / `disabled`).

## 4. Dữ liệu vào khi so khớp
Trong handler `email()` chỉ có **envelope** `to` và `from` (chưa parse MIME). Do đó rule domain chỉ nhận hai trường:
| `matchField` | Giá trị so khớp |
|---|---|
| `recipient` | envelope to |
| `sender` | envelope from (địa chỉ bounce — với thư qua mailing list/ESP có thể khác header From) |

`title`, `content`, `email` **không hợp lệ** cho `scope = 'domain'` — API từ chối (§6.2), UI không hiển thị. So khớp dùng `KHOP_RULE` với `input = { toAddress, fromAddress }`.

## 5. Quyền
```
chủ = chủ domain hiệu lực của người gọi (xem 00-nen-tang/05-phan-quyen.md)
adminDomain = query KHÔNG có mailboxId && user.role == admin
              && domains.id == domainId && domains.user_id == chủ
mailboxMode = query CÓ mailboxId && canManage(mailboxId) && mailbox.domainId == domainId
!adminDomain && !mailboxMode → 403 "Domain or mailbox access is required"
```
Mailbox đích (`mailboxId` trong body, cho `store`/`forward + keepCopy`) phải: (admin) thuộc domain; (mailbox mode) thuộc domain **và** người gọi có `full_access` trên nó → khác: 403 "Mailbox access is required for the destination".

## 6. API

### 6.1 `GET /api/routing-rules/domain?domainId=[&mailboxId=]`
`domainId` bắt buộc (thiếu → 400 "domainId is required"). Kiểm tra quyền §5. Trả:
```json
{ "rules": [ …mọi rule scope='domain' của domain, ORDER BY priority DESC, created_at ASC… ],
  "mailboxes": [ { "id","localPart","displayName","disabled" } ] }
```
Mỗi rule: `{ id, name, enabled, matchField, matchOperator, matchValue, action, mailboxId, forwardTo, keepCopy, rejectReason, priority, matchCount, lastMatchedAt, createdAt }`.
`mailboxes`: admin → mọi mailbox của domain (sắp theo `localPart`); mailbox mode → các mailbox trên domain mà người gọi có `full_access`.

### 6.2 `POST /api/routing-rules/domain[?mailboxId=]`
| Trường | Quy tắc |
|---|---|
| `domainId` | bắt buộc |
| `name` | trim, ≤120, tuỳ chọn |
| `enabled` | bool, mặc định true |
| `matchField` | `recipient` (mặc định) \| `sender` — giá trị khác → 400 "Domain rules can only match the sender or recipient" |
| `matchOperator` | `contains` (mặc định) \| `exact` \| `starts_with` \| `ends_with` \| `regex` |
| `matchValue` | trim, 1–500; `*` = mọi thư |
| `action` | `store` \| `forward` \| `reject` (bắt buộc) |
| `mailboxId` | bắt buộc với `store`; bắt buộc với `forward + keepCopy` |
| `forwardTo` | email hợp lệ, bắt buộc với `forward` |
| `keepCopy` | bool, mặc định false |
| `rejectReason` | ≤200 |
| `priority` | 0–1000, mặc định 0 |

Lỗi validate (400) kèm thông điệp: "Choose the mailbox that should receive matching mail", "A forwarding destination is required", "Keeping a copy requires a destination mailbox", "Enter a valid regular expression", "Domain rules can only match the sender or recipient".

Chuẩn hoá khi lưu (thủ tục `COT_RULE_DOMAIN(input)`, dùng chung cho POST và PATCH):
```
scope        = 'domain'                     // luôn set tường minh
name         = trim(name) || null
pattern      = matchValue
mailboxId    = action == reject  ? null : mailboxId
folderId     = null
forwardTo    = action == forward ? trim(forwardTo) : null
keepCopy     = action == forward ? keepCopy : false
rejectReason = action == reject  ? (trim(rejectReason) || null) : null
matchCount = 0, lastMatchedAt = null        // chỉ khi tạo mới
```
→ 201 `{id}`.

### 6.3 `PATCH /api/routing-rules/domain/{id}[?mailboxId=]`
Tải rule `id = ? AND scope='domain'` (không có → 404 "Rule not found"), kiểm tra quyền §5 theo domain của rule. Body như POST nhưng **`domainId` bị ép bằng domain của rule** (không cho chuyển rule sang domain khác). Ghi đè toàn bộ cột qua `COT_RULE_DOMAIN`, giữ nguyên `match_count`, `last_matched_at`. → `{ok:true}`.

### 6.4 `DELETE /api/routing-rules/domain/{id}[?mailboxId=]`
Kiểm tra như PATCH → xoá. → `{ok:true}`. UI không hỏi xác nhận.

## 7. Thống kê
Mỗi lần một rule domain tạo ra quyết định tại điểm tiếp nhận thư (handler `email()`, hoặc đường tiếp nhận thư của runtime tự host), ghi **nguyên tử** trong một câu lệnh:
```sql
UPDATE routing_rules
SET match_count = match_count + 1, last_matched_at = :now
WHERE id = :ruleId;
```
- Lỗi ghi thống kê chỉ log, không ảnh hưởng quyết định routing.
- Consumer nhận thư phân giải lại địa chỉ (để có mailbox đích) **không** ghi thống kê — mỗi thư chỉ được đếm một lần.

## 8. UI
- Hai nhóm: **Block rules** ("Evaluated before delivery. Matching mail is rejected at the edge.") và **Catch-all and forwarding** ("Evaluated only when no mailbox on the domain matched the recipient.").
- Mô tả dòng: `Any message` khi `*`, ngược lại `{Field} {operator} "{value}"` + `→ reject` / `→ forward to X [and keep a copy]` / `→ deliver to local@host`; "Priority p · matched n× · last <date|Never>"; switch bật/tắt.
- Field chỉ có hai lựa chọn: "Recipient", "Sender".
- Mặc định form: recipient / contains / store / priority **100** / enabled.
- Có ở 2 nơi: `/routing` (admin, chọn domain) và `/settings/rules` (mailbox mode, domain của mailbox đang chọn).

## 9. Lỗi & biên
| Tình huống | Kết quả |
|---|---|
| Lỗi bất kỳ khi phân giải (DB lỗi, rule hỏng) | Handler log và coi như không có quyết định rule — không được chặn việc lưu thư |
| Regex lỗi trong DB | Không khớp (xem `KHOP_RULE`) |
| `forwardTo` chưa là destination đã xác minh trên Cloudflare | `message.forward` lỗi → nếu có mailbox thì lưu thư, ngược lại thư rơi (log cảnh báo) |
| Mailbox đích bị disable/xoá | Rule `store` bị bỏ qua; `forward + keepCopy` chỉ forward |

## 10. Tiêu chí chấp nhận
- [ ] Rule `sender ends_with @spam.com → reject`: thư từ `x@spam.com` tới mailbox thật bị bounce với lý do cấu hình.
- [ ] Rule `recipient contains * → store vào catch-all@`: thư tới `random@domain` vào mailbox catch-all; thư tới mailbox thật vẫn vào mailbox thật.
- [ ] Rule forward không keepCopy: thư chỉ được forward, không lưu; forward lỗi → thư được lưu (nếu có mailbox).
- [ ] Tạo rule domain với `matchField: "title"` → 400 "Domain rules can only match the sender or recipient".
- [ ] Rule bị disable không có hiệu lực.
- [ ] `match_count` tăng đúng 1 mỗi thư khớp, kể cả khi nhiều thư tới đồng thời (không mất lượt đếm).
- [ ] User không phải admin, không có `full_access` mailbox của domain → 403.
