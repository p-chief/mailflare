# Rule cấp mailbox (bộ lọc sau khi giao thư)

> **[NÂNG CAO]** · Phạm vi `scope = 'mailbox'` · Khác hoàn toàn với rule domain → [02-rule-domain.md](02-rule-domain.md)
> Phụ thuộc: [03-folder-tuy-chinh.md](03-folder-tuy-chinh.md), [01-co-ban/06-nhan-thu.md](../01-co-ban/06-nhan-thu.md)

## 1. Mục tiêu
Sau khi thư đã được xác định thuộc mailbox nào, tự động xếp nó vào folder, hoặc đưa thẳng vào Spam/Trash, theo điều kiện trên người gửi/nhận, tiêu đề, nội dung.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| CRUD rule theo mailbox | Reject / forward / catch-all (rule domain) |
| Đánh giá khi nhận thư (bước 6 consumer) | Áp rule lên thư **đã có** (không hỗ trợ "chạy lại") |
| Rule "chặn người gửi" & "trash không unsubscribe" | Nhãn nhiều folder cho một thư |

## 3. Quyền
`canManage` (full_access) trên mailbox cho mọi thao tác, kể cả xem danh sách rule.

## 4. API

### 4.1 `GET /api/routing-rules?mailboxId=`
Không có `mailboxId` → `{rules: []}`. Không đủ quyền → 404. Trả mọi rule `mailbox_id = ? AND scope = 'mailbox'` (không sắp xếp phía server).

### 4.2 `POST /api/routing-rules`
| Trường | Quy tắc |
|---|---|
| `mailboxId` | bắt buộc |
| `matchField` | `email` (mặc định) \| `content` \| `title` |
| `matchOperator` | `contains` (mặc định) \| `exact` |
| `matchValue` | trim, 1–500 |
| `destination` | `spam` \| `trash` \| `folder:<folderId>` |
| `folderId` | (cũ) tương đương `destination = folder:<id>` |
| `priority` | số nguyên, mặc định 0 (UI mặc định 10) |
| `domainId`, `pattern`, `action`, `forwardTo` | bị bỏ qua / cũ |

```
!canManage(mailboxId) → 404 "Mailbox not found"
systemAction = destination ∈ {spam, trash} ? destination : null
folderId     = destination bắt đầu "folder:" ? phần sau : null
!systemAction && !folderId → 400 "Destination is required"
folderId && folder không thuộc mailbox → 404 "Folder not found"
INSERT routing_rules { id: rule_…, userId, domainId: mailbox.domainId, scope:'mailbox',
   pattern: value, matchField, matchOperator, matchValue: value, action: systemAction ?? 'store',
   mailboxId, folderId, forwardTo: null, priority }
→ { id, ...input }
```

### 4.3 `PATCH /api/routing-rules/{id}`
Body như POST (bắt buộc `mailboxId` = mailbox của rule, khác → 404). Kiểm tra quyền, đích như trên; cập nhật `pattern, matchField, matchOperator, matchValue, action, folderId, forwardTo=null, priority`. → `{ok:true}`.

### 4.4 `DELETE /api/routing-rules/{id}`
Rule phải có `mailboxId` và người gọi `canManage` → xoá. (Không kiểm tra `scope`, nên về lý thuyết xoá được rule domain nếu nó có mailboxId — nên thêm điều kiện `scope='mailbox'`.)

## 5. Đánh giá — `resolveInboxRuleDestination(mailboxId, input)`
```
rules = routing_rules WHERE mailbox_id = ? AND scope = 'mailbox' AND enabled = 1
        ORDER BY priority DESC, created_at ASC
for rule in rules:
   if !matchesRule(rule, input): continue
   if rule.action ∈ {spam, trash}: return { status: rule.action, folderId: null }
   if !rule.folderId: continue
   folder = folders WHERE id = rule.folderId AND mailbox_id = mailboxId → không có: continue
   return { status: 'received', folderId }
return { status: 'received', folderId: null }
```
`input = { toAddress: envelope to, fromAddress: header From, subject, content: text + html + snippet }`.

**Rule khớp đầu tiên thắng** (không cộng dồn).

## 6. So khớp — `matchesRule(rule, input)` (dùng chung với rule domain)
```
raw = (rule.matchValue || rule.pattern).trim()
raw == "*" → true
values = field:
   email     → [from, to]      (khớp nếu một trong hai khớp)
   sender    → [from]
   recipient → [to]
   title     → [subject]
   content   → [content]
normalize(v) = field ∈ {email, sender, recipient} ? getEmailAddress(v).trim().lower : v.lower
compare(op):
   exact       → value == ruleValue
   starts_with → value.startsWith(ruleValue)
   ends_with   → value.endsWith(ruleValue)
   regex       → new RegExp(raw, "i").test(value)   // lỗi regex → false, không ném
   default     → value.includes(ruleValue)          // contains
```
Lưu ý: với `email/sender/recipient`, **giá trị rule cũng bị rút về địa chỉ** — rule "contains `@example.com`" vẫn hoạt động (getEmailAddress giữ nguyên chuỗi không có `<>`).

## 7. Rule tự sinh
| Nguồn | Rule |
|---|---|
| "Chặn liên hệ" (`POST /api/contacts/block`) | id `block:<mailboxId>:<email>`, `email exact <email>` → `trash`, priority **100**, scope mặc định `mailbox` (không set tường minh — nên set) |
| "Trash, không có unsubscribe" (client) | `POST /api/routing-rules {matchField:'email', matchOperator:'exact', matchValue:<sender>, destination:'trash', priority:0}` |

## 8. Tương tác với spam
- Rule → `spam`: thư vào Spam, điểm spam bị ghi đè 100 với tín hiệu `mailbox_rule_spam`.
- Rule → `trash`: thư vào Trash, vẫn realtime + webhook.
- Rule → folder nhưng điểm spam ≥ 70: vẫn vào **Spam** (`folderId = null`).

## 9. Tiêu chí chấp nhận
- [ ] Rule `title contains invoice → folder Receipts`: thư tiêu đề "Your Invoice #1" vào folder Receipts, không ở Inbox.
- [ ] Hai rule cùng khớp: priority cao hơn thắng; bằng nhau → rule tạo trước thắng.
- [ ] Folder của rule bị xoá → rule bị bỏ qua, xét rule kế tiếp.
- [ ] Regex sai cú pháp không làm lỗi pipeline.
- [ ] User `read_only` gọi API rule → 404.

## 10. Ghi chú khi xây dựng lại
- Thêm trường `enabled` vào API (DB có, API mailbox rule chưa cho sửa).
- Cân nhắc "Áp dụng cho thư hiện có" khi tạo rule.
- Cho phép operator `starts_with/ends_with/regex` như rule domain (DB đã hỗ trợ).
