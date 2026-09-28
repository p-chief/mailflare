# Hội thoại (Threading) & Conversation view

> **[CƠ BẢN]** gán `threadId`, xem hội thoại · **[NÂNG CAO]** gộp danh sách theo hội thoại (`group=thread`), gộp lại khi thư cha đến muộn
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

### 3.1 Thư đến / import / JMAP import — thủ tục `XAC_DINH_THREAD(mailboxId, messageId, inReplyTo, references)`
```
candidates = unique([chuẩn hoá(inReplyTo), ...references])     // đã bỏ <>, rỗng bị loại
if mailboxId && candidates:
   variants = candidates.flatMap(id => [id, `<${id}>`])          // provider_message_id lưu có hoặc không <>
   parent = messages WHERE mailbox_id = ? AND provider_message_id IN variants
            ORDER BY created_at ASC LIMIT 1
   if parent: return parent.threadId ?? chuẩn hoá(parent.providerMessageId) ?? `thr_${idNgauNhien}`
return chuẩn hoá(messageId) ?? `thr_${idNgauNhien}`              // tự làm gốc hội thoại
```
- "chuẩn hoá" = chuẩn hoá Message-ID: trim, bỏ `<>`, rỗng → null ([00-nen-tang/06 §7](../00-nen-tang/06-quy-uoc-chung.md)).
- `idNgauNhien`: id ngẫu nhiên 21 ký tự URL-safe ([00-nen-tang/06 §1](../00-nen-tang/06-quy-uoc-chung.md)).
- Ở mức CƠ BẢN, thư đến **trước** thư cha (thứ tự đảo) thành hội thoại riêng và giữ nguyên như vậy; gộp lại là quy tắc [NÂNG CAO] ở §3.3.

### 3.2 Thư gửi
- Có `threadId` từ nháp/reply/forward → dùng.
- Thư mới → sau khi `EMAIL.send` thành công: `threadId = chuẩn hoá(res.messageId) ?? messageId`, vì reply của người nhận sẽ nêu Message-ID mà Cloudflare trả về trong `In-Reply-To`.
- `providerMessageId` của thư gửi = `res.messageId` (không `<>`).

### 3.3 [NÂNG CAO] Gộp lại khi thư cha đến muộn
Sau khi lưu một thư `N` (inbound/import) có Message-ID `mid` (đã chuẩn hoá) và `threadId = T`:
```
children = messages WHERE mailbox_id = N.mailboxId
             AND thread_id != T
             AND ( in_reply_to = mid
                   OR (' ' || references_header || ' ') LIKE ('% ' || mid || ' %') )
orphanThreads = unique(children.thread_id)
if orphanThreads:
   UPDATE messages SET thread_id = T
     WHERE mailbox_id = N.mailboxId AND thread_id IN orphanThreads
```
- Chỉ gộp các hội thoại **trong cùng mailbox**; không bao giờ tách hội thoại đã gộp.
- Giới hạn: tối đa 20 `orphanThreads` mỗi lần; vượt → chỉ gộp 20 hội thoại có thư cũ nhất, log cảnh báo.
- Chạy trong cùng lần xử lý queue của thư `N`, sau khi insert; lỗi ở bước này được log và không làm thất bại việc nhận thư.
- `in_reply_to` và `references_header` lưu không `<>` ([00-nen-tang/04 §2.5](../00-nen-tang/04-mo-hinh-du-lieu.md)), nên so khớp trực tiếp với `mid`.
- Sau khi gộp, gửi sự kiện realtime làm mới danh sách cho các user có quyền trên mailbox (nếu có realtime — [02-nang-cao/04](../02-nang-cao/04-realtime.md)).

## 4. Xem hội thoại — `GET /api/messages/{id}/thread` (canRead)
```
m = messages WHERE id (mailbox_id, user_id, thread_id); !m || !m.mailboxId → 404; !canRead → 404
rows = m.threadId
     ? messages WHERE mailbox_id = m.mailboxId AND thread_id = m.threadId AND status NOT IN ('draft','trash')
       ORDER BY created_at ASC LIMIT 200
     : [m]
attachments của mọi rows (1 query IN)
tên liên hệ (from + người nhận đầu tiên) và cờ có avatar (from) theo danh bạ của m.userId
```
Response:
```json
{ "threadId": "…",
  "messages": [ { ...mọi trường của thư (trừ rawR2Key)..., "fromContactName": "…|null", "fromContactHasAvatar": false,
                  "toContactName": "…|null", "attachments": [ … ] } ] }
```
- Mỗi thư kèm đầy đủ `textBody`/`htmlBody` để client mở rộng từng thư không cần gọi thêm; `raw_r2_key` không bao giờ được trả ra.
- Nếu chính `m` đang ở Trash, hội thoại vẫn trả các thư khác (không phải Trash) cùng thread; client hiển thị `m` từ chi tiết thư.

## 5. Conversation view — `GET /api/messages?group=thread` (NÂNG CAO)
Không áp dụng khi `status=draft`.
```
key = coalesce(thread_id, id)
total = COUNT(DISTINCT key) WHERE <bộ lọc>
latest = SELECT key AS tid, MAX(created_at) AS latest WHERE <bộ lọc> GROUP BY key
rows = messages JOIN latest ON key = tid AND created_at = latest WHERE <bộ lọc>
       ORDER BY created_at DESC LIMIT/OFFSET
// hai thư cùng thread trùng timestamp (độ phân giải giây) → giữ 1 dòng (id lớn nhất)
threadMessageIds[key] = ids của mọi thư có key đó TRONG bộ lọc hiện hành
```
Mỗi dòng = thư **mới nhất khớp bộ lọc** của hội thoại, kèm `threadCount`, `threadUnread` (đếm toàn hội thoại trừ `draft`/`trash`) và `threadMessageIds`. Hành động trên dòng (archive, trash, đọc…) gửi **toàn bộ** `threadMessageIds` vào bulk API ([09-to-chuc-thu.md](09-to-chuc-thu.md)).

Client lưu lựa chọn bật/tắt conversation view theo trình duyệt (khoá `app-conversation-view`).

## 6. Lỗi & biên
| Tình huống | Hành vi |
|---|---|
| Thư không có header threading | `threadId` = Message-ID của chính nó (hoặc `thr_…` nếu thiếu Message-ID) |
| `References` trỏ tới thư ở mailbox khác | không khớp — thư mới thành hội thoại riêng trong mailbox của nó |
| Hội thoại > 200 thư | trả 200 thư cũ nhất |
| Thư cha đến sau thư con | CƠ BẢN: hai hội thoại riêng; NÂNG CAO: gộp theo §3.3 |

## 7. Tiêu chí chấp nhận
- [ ] A gửi thư → B reply → A reply: 3 thư cùng `threadId` trong mailbox A.
- [ ] Thư mới không header threading → `threadId` = Message-ID của chính nó.
- [ ] Thread view không chứa nháp và thư trong Trash.
- [ ] Response thread không chứa `rawR2Key`.
- [ ] `group=thread` ở Inbox: hội thoại 3 thư (2 trong Inbox) hiện 1 dòng; archive dòng đó → cả 2 thư Inbox bị archive.
- [ ] (NÂNG CAO) Reply đến trước thư gốc → khi thư gốc đến, cả hai cùng `threadId`.

## 8. Ghi chú triển khai
- Index `(mailbox_id, provider_message_id)` và `(mailbox_id, thread_id)` là bắt buộc cho §3.1 và §4.
- Truy vấn `LIKE` ở §3.3 quét theo mailbox; chấp nhận được vì chỉ chạy một lần cho mỗi thư đến. Nếu mailbox rất lớn, có thể thêm bảng phụ `(mailbox_id, referenced_id, message_id)` ghi lúc nhận thư để tra cứu bằng index.
