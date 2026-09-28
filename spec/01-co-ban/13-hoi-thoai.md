# Hội thoại (Threading) & Conversation view

> **[CƠ BẢN]** gán `threadId`, xem hội thoại · **[NÂNG CAO]** gộp danh sách theo hội thoại (`group=thread`)
> Liên quan: [06-nhan-thu.md](06-nhan-thu.md), [11-gui-thu.md](11-gui-thu.md), [12-tra-loi-chuyen-tiep.md](12-tra-loi-chuyen-tiep.md)

## 1. Mục tiêu
Nhóm thư qua lại thành một hội thoại **trong phạm vi một mailbox**, dựa trên header chuẩn RFC 5322 (`Message-ID`, `In-Reply-To`, `References`), không dựa vào tiêu đề.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Gán `threadId` khi nhận, import, gửi | Gộp theo subject (không làm — tránh gộp nhầm) |
| API xem hội thoại | Hội thoại xuyên mailbox |
| Danh sách gộp theo hội thoại | Tách/gộp hội thoại thủ công |

## 3. Gán `threadId`

### 3.1 Thư đến / import / JMAP import — `resolveThreadId({mailboxId, messageId, inReplyTo, references})`
```
candidates = unique([normalize(inReplyTo), ...references])      // đã bỏ <>
if mailboxId && candidates:
   variants = candidates.flatMap(id => [id, `<${id}>`])          // DB lưu có hoặc không <>
   parent = messages WHERE mailbox_id = ? AND provider_message_id IN variants
            ORDER BY created_at ASC LIMIT 1
   if parent: return parent.threadId ?? normalize(parent.providerMessageId) ?? `thr_${nanoid}`
return normalize(messageId) ?? `thr_${nanoid}`                   // tự làm gốc hội thoại
```
- Thư đến trước thư cha (thứ tự đảo) → mỗi thư thành hội thoại riêng; hiện **không** gộp lại về sau (giới hạn đã biết).

### 3.2 Thư gửi
- Có `threadId` từ nháp/reply/forward → dùng.
- Thư mới → sau khi `EMAIL.send` thành công: `threadId = normalize(res.messageId) ?? messageId`, vì reply của người nhận sẽ nêu Message-ID Cloudflare trong `In-Reply-To`.
- `providerMessageId` của thư gửi = `res.messageId` (không `<>`).

## 4. Xem hội thoại — `GET /api/messages/{id}/thread` (canRead)
```
m = messages WHERE id (mailbox_id, user_id, thread_id); !m.mailboxId → 404; !canRead → 404
rows = m.threadId
     ? messages WHERE mailbox_id = m.mailboxId AND thread_id = m.threadId AND status NOT IN ('draft','trash')
       ORDER BY created_at ASC LIMIT 200
     : [m]
attachments của mọi rows (1 query IN)
contact names (from + người nhận đầu) và avatar flag (from) theo danh bạ của m.userId
```
Response:
```json
{ "threadId": "…",
  "messages": [ { ...cột messages trừ rawR2Key..., "fromContactName", "fromContactHasAvatar",
                  "toContactName", "attachments": [ … ] } ] }
```
Kèm body để client mở rộng từng thư không cần gọi thêm.

## 5. Conversation view — `GET /api/messages?group=thread` (NÂNG CAO)
Không áp dụng khi `status=draft`.
```
key = coalesce(thread_id, id)
total = COUNT(DISTINCT key) WHERE <bộ lọc>
latest = SELECT key AS tid, MAX(created_at) AS latest WHERE <bộ lọc> GROUP BY key
rows = messages JOIN latest ON key = tid AND created_at = latest WHERE <bộ lọc>
       ORDER BY created_at DESC LIMIT/OFFSET
// hai thư cùng thread trùng timestamp (độ phân giải giây) → giữ 1 dòng
threadMessageIds[key] = ids của mọi thư có key đó TRONG bộ lọc hiện tại
```
Mỗi dòng = thư **mới nhất khớp bộ lọc** của hội thoại, kèm `threadCount`, `threadUnread` (đếm toàn hội thoại trừ draft/trash) và `threadMessageIds`. Hành động trên dòng (archive, trash, đọc…) gửi **toàn bộ** `threadMessageIds` vào bulk API.

Client lưu lựa chọn bật/tắt conversation view (per-browser).

## 6. Tiêu chí chấp nhận
- [ ] A gửi thư → B reply → A reply: 3 thư cùng `threadId` trong mailbox A.
- [ ] Thư mới không header threading → `threadId` = Message-ID của chính nó.
- [ ] Thread view không chứa nháp và thư trong Trash.
- [ ] `group=thread` ở Inbox: hội thoại 3 thư (2 trong Inbox) hiện 1 dòng; archive dòng đó → cả 2 thư Inbox bị archive.
