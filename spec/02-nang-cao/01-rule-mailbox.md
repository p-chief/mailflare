# Rule cấp mailbox (bộ lọc sau khi giao thư)

> **[NÂNG CAO]** · Phạm vi `scope = 'mailbox'` · Phụ thuộc: [03-folder-tuy-chinh.md](03-folder-tuy-chinh.md), [01-co-ban/06-nhan-thu.md](../01-co-ban/06-nhan-thu.md) · Liên quan: rule domain (cơ chế khác hoàn toàn) → [02-rule-domain.md](02-rule-domain.md)

## 1. Mục tiêu
Sau khi thư đã được xác định thuộc mailbox nào, tự động xếp nó vào folder, hoặc đưa thẳng vào Spam/Trash, theo điều kiện trên người gửi/nhận, tiêu đề, nội dung.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| CRUD rule theo mailbox, bật/tắt rule | Reject / forward / catch-all (rule domain) |
| Đánh giá khi nhận thư (bước "xác định đích trong mailbox" của consumer nhận thư) | Nhãn nhiều folder cho một thư |
| [NÂNG CAO] Áp một rule lên thư đã có trong mailbox (§4.5) | Rule theo header tuỳ ý, theo kích thước, theo attachment |
| Rule "chặn người gửi" & "trash không unsubscribe" (§7) | |

## 3. Quyền
`canManage` (`full_access`, owner hoặc admin — xem [00-nen-tang/05-phan-quyen.md](../00-nen-tang/05-phan-quyen.md)) trên mailbox cho mọi thao tác, kể cả xem danh sách rule. Không đủ quyền luôn trả **404** (không lộ sự tồn tại của mailbox/rule).

## 4. API

### 4.1 `GET /api/routing-rules?mailboxId=`
Không có `mailboxId` → `{rules: []}`. Không đủ quyền → 404 "Mailbox not found".
Trả mọi rule `mailbox_id = ? AND scope = 'mailbox'`, sắp **đúng thứ tự đánh giá**: `priority DESC, created_at ASC`.
Mỗi rule: `{ id, mailboxId, matchField, matchOperator, matchValue, destination, folderId, priority, enabled, createdAt }` với `destination` = `spam` | `trash` | `folder:<folderId>`.

### 4.2 `POST /api/routing-rules`
| Trường | Quy tắc |
|---|---|
| `mailboxId` | bắt buộc |
| `matchField` | `email` (mặc định) \| `title` \| `content` |
| `matchOperator` | `contains` (mặc định) \| `exact` \| `starts_with` \| `ends_with` \| `regex` |
| `matchValue` | trim, 1–500 ký tự; `*` = mọi thư |
| `destination` | bắt buộc: `spam` \| `trash` \| `folder:<folderId>` |
| `priority` | số nguyên 0–1000, mặc định 0 (form UI mặc định 10) |
| `enabled` | bool, mặc định `true` |
Các trường khác trong body bị bỏ qua (rule mailbox không có `forwardTo`, `keepCopy`, `rejectReason`).

```
!canManage(mailboxId)                         → 404 "Mailbox not found"
body sai schema                               → 400 (thông điệp validate đầu tiên)
matchOperator == regex && biên dịch regex(matchValue, không phân biệt hoa thường) lỗi
                                              → 400 "Enter a valid regular expression"
systemAction = destination ∈ {spam, trash} ? destination : null
folderId     = destination bắt đầu "folder:" ? phần sau dấu ":" : null
!systemAction && !folderId                    → 400 "Destination is required"
folderId && folder không thuộc mailbox        → 404 "Folder not found"
INSERT routing_rules { id: rule_…, userId: người gọi, domainId: mailbox.domainId, scope: 'mailbox',
   name: null, enabled, pattern: matchValue, matchField, matchOperator, matchValue,
   action: systemAction ?? 'store', mailboxId, folderId, forwardTo: null, keepCopy: false,
   rejectReason: null, priority }
→ 201 { id, mailboxId, matchField, matchOperator, matchValue, destination, priority, enabled }
```
`scope` **luôn** được ghi tường minh là `'mailbox'`; `pattern` là bản sao của `matchValue` (cột NOT NULL).

### 4.3 `PATCH /api/routing-rules/{id}`
Body như POST. Tải rule `id = ? AND scope = 'mailbox'` (không có → 404 "Rule not found"). `mailboxId` trong body phải bằng mailbox của rule (khác → 404 "Rule not found") — rule không chuyển được sang mailbox khác. Kiểm tra quyền, regex, đích như POST; ghi đè `pattern, matchField, matchOperator, matchValue, action, folderId, priority, enabled` (`forwardTo = null`). → `{ok:true}`.

Bật/tắt nhanh từ UI gửi lại toàn bộ rule với `enabled` mới.

### 4.4 `DELETE /api/routing-rules/{id}?scope=mailbox`
- `scope` bắt buộc và phải là `mailbox` (thiếu/khác → 400 "scope=mailbox is required"). Rule domain xoá qua endpoint riêng ([02-rule-domain.md §6.4](02-rule-domain.md)).
- Tải rule `id = ? AND scope = 'mailbox'` → không có → 404 "Rule not found"; người gọi không `canManage` mailbox của rule → 404.
- Xoá → `{ok:true}`. Xoá rule `block:<mailboxId>:<email>` không tự bỏ cờ `blocked` của liên hệ — bỏ chặn dùng API ở [10-danh-ba-va-chan.md §6.4](10-danh-ba-va-chan.md).

### 4.5 [NÂNG CAO] `POST /api/routing-rules/{id}/apply` — Áp dụng cho thư hiện có
Chạy một rule lên các thư **đã có** trong mailbox (UI: checkbox "Also apply to existing messages" khi lưu rule, hoặc nút "Apply now" trên dòng rule).
```
rule = routing_rules WHERE id AND scope='mailbox'         → không có: 404 "Rule not found"
!canManage(rule.mailboxId)                                → 404
!rule.enabled                                             → 400 "Enable the rule before applying it"
rule đích folder mà folder không còn thuộc mailbox        → 404 "Folder not found"
ứng viên = messages WHERE mailbox_id = rule.mailboxId AND direction = 'inbound'
           AND status = 'received' AND folder_id IS NULL        // chỉ thư đang ở Inbox
           ORDER BY created_at DESC LIMIT 5000
khớp = ứng viên lọc bằng KHOP_RULE(rule, input(thư))      // input dựng như §5, toAddress = to_addr
theo lô 90 id (D1 giới hạn 100 tham số bind mỗi câu lệnh):
   spam   → UPDATE status='spam',  folder_id=NULL
   trash  → UPDATE status='trash', folder_id=NULL
   folder → UPDATE folder_id = rule.folderId               // status giữ 'received'
→ { matched: n, updated: n, truncated: ứng viên đã chạm giới hạn 5000 }
```
- Không ghi đè điểm spam, không gửi webhook, không realtime cho thư đã có; client làm mới danh sách/đếm sau khi nhận kết quả.
- Thư đã nằm trong folder, Spam, Trash, Archive không bị động tới (tránh làm xáo trộn việc người dùng đã tự phân loại).
- `truncated = true` → UI báo "Applied to the 5,000 most recent messages."

## 5. Đánh giá khi nhận thư — thủ tục `XAC_DINH_DICH_MAILBOX(mailboxId, input)`
Được consumer nhận thư gọi sau khi đã có mailbox đích, trước bước phân tích spam ([06-nhan-thu.md](../01-co-ban/06-nhan-thu.md)).
```
rules = routing_rules WHERE mailbox_id = ? AND scope = 'mailbox' AND enabled = 1
        ORDER BY priority DESC, created_at ASC
for rule in rules:
   if !KHOP_RULE(rule, input): continue
   if rule.action ∈ {spam, trash}: return { status: rule.action, folderId: null }
   if !rule.folderId: continue
   folder = folders WHERE id = rule.folderId AND mailbox_id = mailboxId → không có: continue
   return { status: 'received', folderId: folder.id }
return { status: 'received', folderId: null }
```
`input = { toAddress: envelope to, fromAddress: header From (fallback envelope from), subject, content: text + " " + html + " " + snippet }`.

**Rule khớp đầu tiên thắng** (không cộng dồn). Rule mailbox không ghi `match_count`/`last_matched_at` (chỉ rule domain có thống kê).

## 6. So khớp — thủ tục `KHOP_RULE(rule, input)` (dùng chung với rule domain)
Định nghĩa `DIA_CHI(v)`: rút địa chỉ email thuần từ một chuỗi header (`"Maya" <maya@x.com>` → `maya@x.com`); chuỗi không có `<…>` được giữ nguyên; kết quả trim + lowercase.
```
raw = (rule.matchValue || rule.pattern).trim()
raw == "*" → true
values = theo rule.matchField:
   email     → [fromAddress, toAddress]   (khớp nếu MỘT trong hai khớp)
   sender    → [fromAddress]
   recipient → [toAddress]
   title     → [subject]
   content   → [content]
   (giá trị null/undefined → "")
normalize(v)  = matchField ∈ {email, sender, recipient} ? DIA_CHI(v) : lower(v)
ruleValue     = normalize(raw)
khớp nếu ∃ value ∈ values.map(normalize) thoả:
   exact       → value == ruleValue
   starts_with → value bắt đầu bằng ruleValue
   ends_with   → value kết thúc bằng ruleValue
   contains    → value chứa ruleValue
   regex       → regex(raw, cờ "i") khớp value (dùng `raw`, không normalize)
                 regex biên dịch lỗi → coi là KHÔNG khớp, không ném lỗi
```
- Với trường địa chỉ, **giá trị rule cũng được rút về địa chỉ**: rule "contains `@example.com`" vẫn hoạt động vì chuỗi không có `<>` được giữ nguyên.
- Regex chỉ nhận `matchValue` ≤ 500 ký tự và được validate khi lưu (§4.2); chạy trên nội dung đã giới hạn (content cắt tối đa 100 000 ký tự) để tránh regex tốn CPU trong consumer.

## 7. Rule tự sinh
| Nguồn | Rule |
|---|---|
| "Chặn liên hệ" (`POST /api/contacts/block`, [10-danh-ba-va-chan.md](10-danh-ba-va-chan.md)) | id `block:<mailboxId>:<email>`, `scope: 'mailbox'` (set tường minh), `email exact <email>` → `trash`, priority **100**, enabled |
| "Trash, không có unsubscribe" (client, menu thư) | `POST /api/routing-rules {mailboxId, matchField:'email', matchOperator:'exact', matchValue:<địa chỉ người gửi>, destination:'trash', priority:0}` |

## 8. Tương tác với spam
- Rule → `spam`: thư vào Spam; kết quả spam bị ghi đè điểm 100, verdict `spam`, tín hiệu `mailbox_rule_spam` ("A mailbox rule marked this message as spam").
- Rule → `trash`: thư vào Trash, vẫn realtime + webhook.
- Rule → folder nhưng bộ lọc spam cho verdict `spam`: thư vẫn vào **Spam** (`folderId = null`) — xem [11-bo-loc-spam.md](11-bo-loc-spam.md).

## 9. UI (Settings → Rules, theo mailbox đang chọn)
- Danh sách rule theo thứ tự đánh giá; mỗi dòng: `{Field} {operator} "{value}" → {Spam | Trash | tên folder}`, "Priority p", switch bật/tắt, nút xoá.
- Form: field (Sender or recipient / Subject / Content), operator (contains / is exactly / starts with / ends with / matches regex), value, đích (Spam, Trash, danh sách folder của mailbox), priority (mặc định 10), checkbox "Also apply to existing messages" ([NÂNG CAO] — gọi §4.5 sau khi lưu).
- User không có `full_access` không thấy mục này.

## 10. Lỗi & biên
| Tình huống | Kết quả |
|---|---|
| Folder đích bị xoá (FK `folder_id` SET NULL) | Rule còn nhưng không có folder → bị bỏ qua khi đánh giá; UI hiện "Folder deleted" và cho sửa |
| Regex lỗi trong DB (dữ liệu cũ, nhập ngoài API) | Không khớp, không làm lỗi pipeline |
| Rule `disabled` | Không được đánh giá, không được áp (§4.5 → 400) |
| Mailbox bị xoá | Rule xoá theo (FK) hoặc `mailbox_id` null → không bao giờ được chọn |

## 11. Tiêu chí chấp nhận
- [ ] Rule `title contains invoice → folder Receipts`: thư tiêu đề "Your Invoice #1" vào folder Receipts, không ở Inbox.
- [ ] Rule `email ends_with @news.example.com → trash`: thư từ `a@news.example.com` vào Trash.
- [ ] Hai rule cùng khớp: priority cao hơn thắng; bằng nhau → rule tạo trước thắng.
- [ ] Tắt rule (`enabled=false`) → thư mới không bị rule đó xử lý; bật lại → có hiệu lực.
- [ ] Folder của rule bị xoá → rule bị bỏ qua, xét rule kế tiếp.
- [ ] Lưu rule regex sai cú pháp → 400 "Enter a valid regular expression"; regex sai có sẵn trong DB không làm lỗi pipeline.
- [ ] `DELETE /api/routing-rules/{id}` thiếu `scope=mailbox` → 400; với id của rule domain → 404.
- [ ] Rule chặn tạo từ "Block contact" có `scope='mailbox'`.
- [ ] [NÂNG CAO] Áp rule `title contains invoice → Receipts` cho thư cũ → các thư Inbox khớp chuyển vào Receipts, thư đã ở folder khác không đổi; kết quả trả đúng số lượng.
- [ ] User `read_only` gọi bất kỳ API rule nào → 404.

## 12. Ghi chú triển khai
- Cache danh sách rule theo mailbox trong một lần xử lý batch queue (cùng mailbox thường nhận nhiều thư liên tiếp) — không cache xuyên request.
- Biên dịch regex một lần cho mỗi rule trong một lần đánh giá.
