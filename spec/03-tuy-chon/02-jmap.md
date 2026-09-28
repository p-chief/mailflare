# JMAP (RFC 8620 core, RFC 8621 mail, submission)

> **[TÙY CHỌN]** · Phụ thuộc: [02-nang-cao/13-api-key-va-rest-v1.md](../02-nang-cao/13-api-key-va-rest-v1.md), [00-nen-tang/05-phan-quyen.md](../00-nen-tang/05-phan-quyen.md) · Liên quan: [01-co-ban/11-gui-thu.md](../01-co-ban/11-gui-thu.md), [01-co-ban/13-hoi-thoai.md](../01-co-ban/13-hoi-thoai.md), [01-co-ban/14-tim-kiem.md](../01-co-ban/14-tim-kiem.md), [02-nang-cao/03-folder-tuy-chinh.md](../02-nang-cao/03-folder-tuy-chinh.md)

## 1. Mục tiêu
Cho phép mail client ngoài hỗ trợ JMAP (Thunderbird, ứng dụng JMAP trên di động…) đọc, tìm, tổ chức, soạn nháp và gửi thư bằng một **app password** (API key scope `jmap`).

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Session, Mailbox, Thread, Email, SearchSnippet, Identity, EmailSubmission | `/changes`, `/queryChanges` thực (luôn `cannotCalculateChanges`) |
| Upload/download blob | `Email/copy`, `Email/parse` |
| Đẩy thay đổi qua EventSource (polling state) | Push subscription (`PushSubscription/*`) |
| Tạo nháp, import MIME vào Drafts, gửi | Đưa thư vào Inbox/folder qua JMAP (chỉ pipeline nhận thư làm việc đó) |

Bộ xử lý JMAP là một khối độc lập nhận `Request` và trả `Response` (hoặc "không phải path JMAP"), được mount trực tiếp trong handler `fetch` của Worker.

## 3. Endpoint
| Method | Path | Hành vi |
|---|---|---|
| OPTIONS | mọi path JMAP | 204 + CORS (trước xác thực) |
| GET | `/.well-known/jmap` | 301 → `<origin request>/jmap/session` (không auth) |
| GET | `/jmap/session` | Session object |
| POST | `/jmap/api` | xử lý request JMAP |
| GET | `/jmap/download/{accountId}/{blobId}/{name}[?type=]` | tải blob |
| POST | `/jmap/upload/{accountId}` | tải lên blob → 201 |
| GET | `/jmap/eventsource` | SSE (polling) |
| khác `/jmap/*` | | 404 JSON |

CORS: `Access-Control-Allow-Origin: *`, `Allow-Methods: GET, POST, OPTIONS`, `Allow-Headers: Authorization, Content-Type`, `Max-Age: 86400`. JSON: `application/json; charset=utf-8`, `Cache-Control: no-store`.

## 4. Xác thực & quyền
- API key scope `jmap` (hoặc `*`), qua `Authorization: Bearer <key>` hoặc `Basic base64(any:key)` (lấy phần sau dấu `:` đầu tiên; không có `:` → cả chuỗi là key).
- Không có / sai key → 401 + `WWW-Authenticate: Basic realm="{APP_NAME} JMAP", Bearer`; key hợp lệ nhưng thiếu scope → 403.
- **Account id = user id** của chủ key. `origin` trong URL session = `APP_URL` nếu cấu hình, ngược lại origin của request.
- Mọi truy cập thư/mailbox đi qua kiểm tra quyền mailbox chung ([00-nen-tang/05](../00-nen-tang/05-phan-quyen.md)): chỉ mailbox user có quyền mới xuất hiện.

## 5. Session
- Capabilities: `urn:ietf:params:jmap:core` {maxSizeUpload 10 MiB, maxConcurrentUpload 4, maxSizeRequest 10 MiB, maxConcurrentRequests 4, maxCallsInRequest 32, maxObjectsInGet 200, maxObjectsInSet 100, collationAlgorithms [i;ascii-casemap, i;unicode-casemap]}, `urn:ietf:params:jmap:mail` {}, `urn:ietf:params:jmap:submission` {}.
- Account: `name = email` của user, `isPersonal: true`, `isReadOnly: false`; mail caps `{maxMailboxesPerEmail 1, maxMailboxDepth 2, maxSizeMailboxName 80, maxSizeAttachmentsPerEmail 20 MiB, emailQuerySortOptions [receivedAt, sentAt, subject, from, size, hasKeyword], mayCreateTopLevelMailbox false}`; submission `{maxDelayedSend 0, submissionExtensions {}}`.
- `primaryAccounts` trỏ account này cho cả 3 capability.
- URL: `apiUrl`, `downloadUrl …/jmap/download/{accountId}/{blobId}/{name}?type={type}`, `uploadUrl …/jmap/upload/{accountId}`, `eventSourceUrl …/jmap/eventsource?types={types}&closeafter={closeafter}&ping={ping}`; `username`; `state` (§10).

## 6. Xử lý request
- `Content-Length` > 10 MiB → problem `limit`; JSON hỏng → `notJSON`; sai cấu trúc → `notRequest`; capability trong `using` không hỗ trợ → `unknownCapability`; > 32 call → `limit`. Problem document: `Content-Type: application/problem+json`, body `{type: "urn:ietf:params:jmap:error:<t>", status, detail}`.
- Các call chạy **tuần tự** theo thứ tự. Với mỗi call:
  1. Method không hỗ trợ → `["error", {type: "unknownMethod"}]`.
  2. Back-reference `#arg: {resultOf, name, path}` (JSON Pointer, hỗ trợ `*`) → không thấy kết quả tương ứng → `invalidResultReference`.
  3. Thay mọi chuỗi `"#creationId"` đã biết bằng id thật (duyệt sâu toàn bộ args).
  4. `accountId` khác account của key → `accountNotFound` (trừ `Core/echo`).
  5. Lỗi JMAP có kiểu → `["error", {type, description}]`; lỗi khác → `serverFail` (log chi tiết phía server, không lộ ra client).
- Response `{methodResponses, createdIds?, sessionState}`.

## 7. Ánh xạ mô hình
| JMAP | Hệ thống |
|---|---|
| Account | user |
| Mailbox `<mailboxId>` | một mailbox (vai trò "gốc"; chứa mọi thư của nó về mặt cây nhưng **không bao giờ** nằm trong `mailboxIds` của thư) |
| Mailbox `<mailboxId>~<role>` | thư mục hệ thống: `inbox↔received`, `sent↔sent/queued/failed`, `drafts↔draft`, `archive↔archived`, `junk↔spam` (tên hiển thị "Spam"), `trash↔trash` |
| Mailbox `<mailboxId>~f~<folderId>` | folder tuỳ chỉnh |
| Email | message; thuộc đúng **1** JMAP mailbox: folder nếu `folderId` có giá trị, ngược lại theo `status` |
| Thread | `coalesce(threadId, id)` |
| Blob | `att~<attId>` (attachment), `msg~<messageId>` (raw MIME hoặc dựng lại), `up~<uploadId>` (upload) |
| Identity | `<mailboxId>~<address>` cho mỗi địa chỉ gửi hợp lệ của mailbox mà user có quyền ≥ `send_on_behalf` |
| Keywords | `$seen` = `read` **hoặc** thư outbound; `$flagged` = `starred`; `$draft` = `status = draft`; keyword khác bị bỏ qua khi ghi và không trả về |

Phân tích id mailbox: tách theo `~`; phần 1 = mailboxId; không có phần 2 → gốc; phần 2 là role → thư mục hệ thống; phần 2 = `f` + phần 3 → folder. Dạng khác → `notFound`.

## 8. Phương thức
| Method | Hành vi |
|---|---|
| `Core/echo` | trả nguyên args |
| `Mailbox/get` | toàn bộ hoặc theo `ids`; `myRights`: `mayReadItems` luôn true; `mayAddItems/mayRemoveItems/maySetSeen/maySetKeywords` khi quyền ≠ `read_only`; `mayRename/mayDelete` chỉ với folder và quyền `full_access`; `maySubmit` khi ≥ `send_on_behalf`; `totalEmails`/`unreadEmails` (unread chỉ tính cho inbox, các mailbox khác = 0); `totalThreads`/`unreadThreads` tương ứng |
| `Mailbox/query` | filter phẳng `parentId, name (chứa chuỗi, không phân biệt hoa), role, hasAnyRole`; luôn sắp theo `sortOrder` |
| `Mailbox/set` | chỉ folder. create: `parentId` phải là mailbox gốc, cần `full_access`, tên 1–80 ký tự, trùng tên trong cùng mailbox → `invalidProperties`; update: chỉ `name`; destroy: còn thư và không `onDestroyRemoveEmails` → `mailboxHasEmail`; có `onDestroyRemoveEmails` → thư chuyển vào Trash rồi xoá folder. Mailbox gốc và thư mục hệ thống → `forbidden` |
| `Thread/get` | bắt buộc `ids`; `emailIds` sắp theo `created_at ASC` |
| `Email/get` | ≤ 200 ids (vượt → `requestTooLarge`); thuộc tính đầy đủ RFC 8621; `bodyValues` khi `fetchTextBodyValues`/`fetchHTMLBodyValues`/`fetchAllBodyValues` (tôn trọng `maxBodyValueBytes`, đặt `isTruncated`); `header:<name>[:asAddresses|asMessageIds|asDate|asText|asRaw]` hỗ trợ subject/from/to/cc/bcc/message-id/in-reply-to/references/date — header khác trả `null` |
| `Email/query` | xem §8.1 |
| `Email/set` | xem §8.2 |
| `Email/import` | xem §8.3 |
| `SearchSnippet/get` | theo `emailIds` + `filter`; highlight `<mark>` các từ trong `filter.text`, `filter.body`, `filter.subject`; trả `subject` và `preview` đã escape HTML |
| `Identity/get` | như §7 (`name` = display name mailbox, `email` = địa chỉ, `mayDelete: false`); `Identity/set` → `forbidden` |
| `EmailSubmission/set` | xem §8.4 |
| `*/changes`, `*/queryChanges` | `cannotCalculateChanges` |
| `Email/copy`, `Email/parse`, `EmailSubmission/get|query` | `unknownMethod` |

### 8.1 `Email/query`
- Filter điều kiện: `inMailbox, inMailboxOtherThan, before, after, hasKeyword, notKeyword, from, to, cc, bcc, subject, body, text, hasAttachment, minSize, maxSize, header`.
- Toán tử `AND`, `OR`, `NOT` lồng nhau; **`NOT` = NOT(OR(điều kiện con))** theo RFC 8620 §5.5 (không có điều kiện con nào khớp).
- `from/to/cc/bcc/subject/body`: so khớp chuỗi con không phân biệt hoa trên cột tương ứng.
- `text`: dùng **chỉ mục FTS5** `messages_fts` (cùng cơ chế với tìm kiếm [01-co-ban/14](../01-co-ban/14-tim-kiem.md)): `rowid IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?)`, giá trị được escape thành các cụm từ trong ngoặc kép (`"từ1" "từ2"`) để ký tự đặc biệt FTS không gây lỗi cú pháp.
- `header: [name, value?]` trả lời từ cột, không parse MIME:
  - `Message-ID` ↔ `provider_message_id`, so sánh cả dạng có và không có `<>` (thư đến lưu có `<>`, thư đi lưu không có);
  - `In-Reply-To` ↔ `in_reply_to`;
  - `References` ↔ `references` bằng `LIKE '% ' || ? || ' %'` trên chuỗi đã đệm khoảng trắng hai đầu;
  - chỉ có `name` (không `value`) → header tồn tại (cột khác rỗng);
  - header khác → lỗi `unsupportedFilter`. **Không bao giờ bỏ qua âm thầm** một điều kiện filter: client khử trùng lặp bằng `header` sẽ khớp mọi thư nếu điều kiện bị bỏ.
- Sort: `receivedAt, sentAt, subject, from, to, size, hasKeyword($seen|$flagged|$draft)`; tie-break theo id. Sort khác → `unsupportedSort`.
- `collapseThreads` (một thư mới nhất mỗi thread), `position`, `anchor` + `anchorOffset` (anchor không có trong kết quả → `anchorNotFound`), `limit` ≤ 250 (mặc định 250), `calculateTotal`. Tối đa quét 10 000 dòng mỗi query.
- `queryState` = email state (§10), `canCalculateChanges: false`.

### 8.2 `Email/set`
- **create**: chỉ vào đúng **một** Drafts mailbox (`<mailboxId>~drafts`) mà user có quyền ≥ `send_on_behalf`; `mailboxIds` khác → `invalidProperties`. Dùng chung thủ tục chèn nháp với `Email/import` (§8.5). Thuộc tính nhận: `from, to, cc, bcc, replyTo, subject, keywords, textBody/htmlBody/bodyValues, attachments (blobId), inReplyTo, references, messageId`.
- **update**:
  - `mailboxIds`: chỉ di chuyển trong **cùng** mailbox của hệ thống; đích là role → đổi `status` (thư inbound không được vào Sent, thư outbound không vào Inbox/Spam → `invalidProperties`), đích là folder → đặt `folderId` (và `status = received` nếu đang ở trash/spam); cần quyền ≠ `read_only`.
  - `keywords/$seen` → `read`; `keywords/$flagged` → `starred`; patch dạng `keywords/<k>` được hỗ trợ.
- **destroy**: thư chưa ở Trash → chuyển Trash; đã ở Trash hoặc là draft → xoá vĩnh viễn (xoá dòng, attachment và object R2 như [01-co-ban/09](../01-co-ban/09-to-chuc-thu.md)); cần quyền `full_access` cho xoá vĩnh viễn, ngược lại `forbidden`.

### 8.3 `Email/import`
- Mỗi mục `{blobId: "up~…", mailboxIds, keywords, receivedAt?}`; `mailboxIds` phải là một Drafts mailbox (như §8.2).
- Đọc blob upload của chính user → parse MIME (ví dụ: postal-mime) → chèn qua thủ tục §8.5 với:
  - `provider_message_id` = `Message-ID` của MIME **giữ nguyên `<>`** (như thư đến);
  - raw bytes lưu tại `drafts/<messageId>.eml`, `raw_r2_key` trỏ tới đó để download `msg~` trả lại đúng MIME của client;
  - `created_at` = `receivedAt` → header `Date` → now.
- Thành công → xoá object `jmap-uploads/…` đã dùng.
- Lỗi theo mục: `blobNotFound`, `invalidEmail` (parse lỗi), `invalidProperties`, `forbidden`, `tooLarge` (> 20 MiB tổng attachment).

### 8.4 `EmailSubmission/set`
- create `{emailId, identityId, envelope?}`: `emailId` phải là draft của một mailbox user có quyền ≥ `send_on_behalf`; `identityId` phải thuộc mailbox đó. Gọi thủ tục gửi thư ([01-co-ban/11](../01-co-ban/11-gui-thu.md)) với nội dung, người nhận, threading và attachment của draft → tạo message Sent mới → xoá draft.
- Response thêm một phản hồi `Email/set` ngầm `{destroyed: [draftId]}` khi có `onSuccessDestroyEmail` hoặc luôn luôn (vì draft đã bị xoá).
- `sendAt`/delay → `invalidProperties` (`maxDelayedSend 0`). Lỗi gửi → `forbidden` kèm `description` là thông điệp lỗi gửi.

### 8.5 Thủ tục chèn nháp dùng chung
`CHEN_NHAP_JMAP(user, draftsMailbox, dữ liệu, raw?)` — dùng cho cả `Email/set` create và `Email/import`:
```
kiểm tra quyền ≥ send_on_behalf trên draftsMailbox.mailboxId
id = msg_…
INSERT messages { id, mailbox_id, user_id = user.id, direction = outbound, status = draft,
   folder_id = null, from_addr, to_addr, cc_addr, bcc_addr, subject, snippet, text, html,
   read = keywords có $seen, starred = keywords có $flagged,
   in_reply_to, references, provider_message_id,
   thread_id = thủ tục phân giải hội thoại (01-co-ban/13) theo In-Reply-To/References,
   raw_r2_key = raw ? drafts/<id>.eml : null, created_at }
raw → R2.put(drafts/<id>.eml)
attachment (blob att~ hoặc phần MIME) → lưu như attachment của nháp (01-co-ban/10)
lỗi giữa chừng → xoá dòng + object đã ghi
```
Hai đường tạo có cùng mặc định: `read`/`starred` theo keywords, luôn tính `thread_id`; chỉ khác ở chỗ có raw hay không.

## 9. Blob
- **Upload**: body ≤ 10 MiB (vượt → 413), `Content-Type` từ header hoặc `application/octet-stream`, tên từ `Content-Disposition` nếu có; lưu R2 `jmap-uploads/<userId>/<upl_id>` kèm metadata `{type, name, size, userId}` → `201 {accountId, blobId: "up~<upl_id>", type, size}`.
- **Dọn upload**: cron hằng ngày xoá mọi object dưới `jmap-uploads/` có thời điểm upload cũ hơn **24 giờ** (liệt kê R2 theo prefix, xoá theo lô) — xem [05-van-hanh/01](../05-van-hanh/01-bay-va-cai-thien.md).
- **Download**:
  - `att~` — kiểm tra quyền đọc mailbox của thư chứa attachment;
  - `msg~` — raw từ R2 nếu có; nếu không, dựng MIME tối giản (From/To/Cc/Subject/Date/Message-ID/In-Reply-To + body text/html);
  - `up~` — chỉ upload của chính user.
  - Header: `Content-Disposition: attachment; filename*=UTF-8''<name>`, `Cache-Control: private, max-age=3600`, `Content-Security-Policy: default-src 'none'; sandbox`, `X-Content-Type-Options: nosniff`, `Content-Type` = `?type=` nếu có, ngược lại type đã lưu.
- Không thấy / không có quyền → 404.

## 10. State & đẩy thay đổi
- State là **digest số đếm** (vì không có change log):
  - email state = `total.maxRowid.readCount.starredCount.sum(len(status)).folderCount` trên các mailbox user truy cập được;
  - mailbox state = `mailboxCount.folderCount.maxFolderRowid.sum(len(name)).emailState`;
  - session state = `mailboxState:total`.
- Thread state = email state.
- `/jmap/eventsource`: `Content-Type: text/event-stream`; mỗi `ping` giây (mặc định 30, tối thiểu 10) tính lại state; khác lần trước → `event: state` với data `{"@type":"StateChange","changed":{"<accountId>":{"Mailbox":…,"Email":…,"Thread":…}}}` (chỉ các kiểu trong `types`, `*` = tất cả); không đổi → `event: ping` data `{"interval": ping}`. `closeafter=state` → đóng stream sau sự kiện state đầu tiên. Không dùng Durable Object.

## 11. Lỗi & biên
- `accountId` trong URL upload/download khác account của key → 404.
- Request có call dùng back-reference tới call bị lỗi → `invalidResultReference`.
- `Email/set` update đồng thời nhiều thuộc tính mà một thuộc tính sai → cả update đó `notUpdated` với `invalidProperties` liệt kê `properties`.
- Thư của mailbox user mất quyền giữa hai request → coi như không tồn tại (`notFound`).

## 12. Tiêu chí chấp nhận
- [ ] `GET /.well-known/jmap` → 301 tới `/jmap/session`; session không auth → 401 có `WWW-Authenticate`.
- [ ] Key scope `send` (không `jmap`) → 403.
- [ ] `Email/query` với `NOT: [{from: "a"}, {from: "b"}]` loại mọi thư từ `a` **hoặc** `b`.
- [ ] `Email/query` với `header: ["X-Custom", "1"]` → `unsupportedFilter`, không trả mọi thư.
- [ ] `Email/query` `text: "hoá đơn"` dùng FTS và trả cùng kết quả với ô tìm kiếm web.
- [ ] `Email/import` một file .eml → thư ở Drafts, download `msg~<id>` trả đúng bytes đã upload, upload bị xoá.
- [ ] `Email/set` create với `mailboxIds` là Inbox → `invalidProperties`.
- [ ] `EmailSubmission/set` → thư xuất hiện ở Sent, draft bị xoá, response có `Email/set destroyed`.
- [ ] Upload không dùng tới bị xoá sau lần cron kế tiếp quá 24 giờ.

## 13. Ghi chú triển khai
- Để hỗ trợ `/changes` thật cần cột `updated_at` + bảng change log (hoặc modseq tăng dần theo mailbox); thiết kế state dạng digest cho phép bổ sung sau mà không đổi API.
- `maxMailboxesPerEmail = 1` phản ánh mô hình "một thư, một vị trí"; client gắn nhiều mailbox sẽ nhận `invalidProperties`.
