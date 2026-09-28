# JMAP (RFC 8620 core, RFC 8621 mail, submission)

> **[TÙY CHỌN]** — Chỉ cần nếu muốn dùng mail client ngoài (Thunderbird, iOS qua ứng dụng JMAP…). Khối lượng lớn; code hiện tại **không phụ thuộc framework** (`handleJmapRequest(request, env) → Response | null`) nên có thể mount thẳng trong `fetch`.
> Nguồn: `src/lib/jmap/**`, `docs/api.md`.

## 1. Endpoint
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
CORS: `Allow-Origin: *`, `Allow-Methods: GET, POST, OPTIONS`, `Allow-Headers: Authorization, Content-Type`, `Max-Age: 86400`. JSON: `application/json; charset=utf-8`, `no-store`.

## 2. Xác thực
API key scope `jmap` (hoặc `*`), qua `Bearer <key>` hoặc `Basic base64(any:key)` (phần sau dấu `:` đầu tiên; không có `:` → cả chuỗi). Không có/ sai → 401 + `WWW-Authenticate: Basic realm="Mailflare JMAP", Bearer`; thiếu scope → 403. **Account id = user id**; `origin` = `APP_URL` hoặc origin request.

## 3. Session
- Capabilities: `urn:ietf:params:jmap:core` {maxSizeUpload 10 MiB, maxConcurrentUpload 4, maxSizeRequest 10 MiB, maxConcurrentRequests 4, maxCallsInRequest 32, maxObjectsInGet 200, maxObjectsInSet 100, collationAlgorithms [i;ascii-casemap, i;unicode-casemap]}, `…:mail` {}, `…:submission` {}.
- Account: `name = email`, `isPersonal`, mail caps `{maxMailboxesPerEmail 1, maxMailboxDepth 2, maxSizeMailboxName 80, maxSizeAttachmentsPerEmail 20 MiB, emailQuerySortOptions [receivedAt, sentAt, subject, from, size, hasKeyword], mayCreateTopLevelMailbox false}`, submission `{maxDelayedSend 0}`.
- URL: `apiUrl`, `downloadUrl …/{accountId}/{blobId}/{name}?type={type}`, `uploadUrl`, `eventSourceUrl …?types={types}&closeafter={closeafter}&ping={ping}`; `state`.

## 4. Xử lý request
- `Content-Length` > 10 MiB → problem `limit`; JSON hỏng → `notJSON`; sai cấu trúc → `notRequest`; capability lạ → `unknownCapability`; > 32 call → `limit`. Problem doc: `application/problem+json` `{type: "urn:ietf:params:jmap:error:<t>", status, detail}`.
- Chạy tuần tự. Mỗi call: method lạ → `unknownMethod`; back-reference `#arg: {resultOf, name, path}` (JSON Pointer + `*`) → không thấy → `invalidResultReference`; thay mọi chuỗi `"#creationId"` đã biết bằng id thật (sâu toàn bộ args); `accountId` khác → `accountNotFound` (trừ `Core/echo`); `JmapError` → `["error", {type, description}]`; lỗi khác → `serverFail`.
- Response `{methodResponses, createdIds?, sessionState}`.

## 5. Ánh xạ mô hình
| JMAP | Mailflare |
|---|---|
| Account | user |
| Mailbox `<mailboxId>` | một mailbox (chứa mọi thư của nó; không bao giờ nằm trong `mailboxIds` của thư) |
| Mailbox `<mailboxId>~<role>` | thư mục hệ thống: `inbox↔received`, `sent↔sent/queued/failed`, `drafts↔draft`, `archive↔archived`, `junk↔spam` (tên "Spam"), `trash↔trash` |
| Mailbox `<mailboxId>~f~<folderId>` | folder tuỳ chỉnh |
| Email | message (thuộc đúng **1** mailbox: folder nếu có, ngược lại theo status) |
| Thread | `coalesce(threadId, id)` |
| Blob | `att~<attId>`, `msg~<messageId>` (raw MIME hoặc dựng lại), `up~<uploadId>` |
| Identity | `<mailboxId>~<address>` cho mỗi địa chỉ hợp lệ của mailbox có quyền ≥ send_on_behalf |
| Keywords | `$seen` = read **hoặc outbound**; `$flagged` = starred; `$draft` = status draft; keyword khác bị bỏ |

## 6. Phương thức
| Method | Hỗ trợ |
|---|---|
| `Core/echo` | trả nguyên args |
| `Mailbox/get` | toàn bộ hoặc theo ids; `myRights` (read luôn; add/remove/seen/keywords khi ≠ read_only; rename/delete chỉ folder + full_access; submit khi ≥ send_on_behalf); đếm unread chỉ cho inbox |
| `Mailbox/query` | filter phẳng `parentId, name (chứa, không phân biệt hoa), role, hasAnyRole`; luôn sắp `sortOrder` |
| `Mailbox/set` | chỉ folder: create (dưới mailbox cấp account, full_access, tên 1–80, trùng → invalidProperties), update `name`, destroy (`onDestroyRemoveEmails` → thư vào Trash; còn thư → `mailboxHasEmail`) |
| `Thread/get` | cần ids |
| `Email/get` | ≤200 ids; thuộc tính đầy đủ; `bodyValues` khi fetch*; `header:<name>[:asAddresses|asMessageIds|asDate|asText]` chỉ subject/from/to/cc/bcc/message-id/in-reply-to/references/date |
| `Email/query` | filter `inMailbox, inMailboxOtherThan, before, after, hasKeyword, notKeyword, from, to, cc, bcc, subject, body, text (LIKE, không FTS), hasAttachment, minSize, maxSize, header (Message-ID / In-Reply-To / References; header khác → unsupportedFilter)`, AND/OR/NOT; sort `receivedAt, sentAt, subject, from, to, size, hasKeyword`; `collapseThreads`, `anchor`, `limit ≤ 250`, tối đa 10 000 dòng |
| `Email/set` | create **chỉ vào Drafts**; update `mailboxIds` (chỉ trong cùng mailbox Mailflare; inbound không vào Sent) và `$seen`/`$flagged`; destroy: lần 1 → Trash, lần 2 (hoặc draft) → xoá hẳn |
| `Email/import` | blob `up~` → parse → **chỉ vào Drafts**; lưu raw `drafts/<id>.eml`; giữ Message-ID có `<>`; `receivedAt` → Date header → now; `$seen/$flagged`; xoá upload sau khi thành công; lỗi `blobNotFound, invalidEmail, invalidProperties, forbidden, tooLarge` |
| `SearchSnippet/get` | highlight `<mark>` theo `filter.text|body|subject` |
| `Identity/get` | như §5; `Identity/set` → forbidden |
| `EmailSubmission/set` | create: draft của chính user + identity → `sendEmail` (tạo message Sent mới) → xoá draft, thêm phản hồi `Email/set` ngầm `destroyed:[draftId]`; lỗi → `forbidden` |
| `*/changes`, `*/queryChanges` | `cannotCalculateChanges` |
| `Email/copy`, `Email/parse` | `unknownMethod` |

## 7. Blob
- Upload: body ≤ 10 MiB (413), `Content-Type` hoặc octet-stream, tên từ `Content-Disposition`; R2 `jmap-uploads/<userId>/<upl_id>` → `201 {accountId, blobId: "up~<id>", type, size}`. Không tự dọn upload không dùng.
- Download: `att~` (qua quyền mailbox), `msg~` (raw nếu có, nếu không dựng MIME tối giản From/To/Cc/Subject/Date/Message-ID/In-Reply-To + body), `up~` (của chính user). Header: `Content-Disposition: attachment; filename*=UTF-8''…`, `private, max-age=3600`, `CSP: default-src 'none'; sandbox`.

## 8. State & đẩy thay đổi
- Không có `updated_at` ⇒ state là **digest số đếm**: email state `total.maxRowid.readCount.starredCount.sum(len(status)).folderCount`; mailbox state `mailboxCount.folderCount.maxFolderRowid.sum(len(name)).emailState`; session state `mailboxState:total`.
- `/jmap/eventsource`: mỗi `ping` giây (mặc định 30, tối thiểu 10) tính lại state; khác → `event: state` `{"@type":"StateChange","changed":{acc:{Mailbox,Email,Thread}}}`, không → `event: ping`; `closeafter=state` đóng sau lần đầu. Không dùng Durable Object.

## 9. Điểm cần quyết định nếu làm lại
- Thêm `updated_at` + bảng change log để hỗ trợ `/changes` thật.
- `NOT` hiện là `NOT(AND)` thay vì `NOT(OR)` theo RFC.
- `text` filter nên dùng FTS5.
- Hai đường tạo Email có mặc định khác nhau (`Email/set`: read=true, không threadId; `Email/import`: read theo `$seen`, có threadId, giữ raw).
- Dọn `jmap-uploads/` định kỳ.
