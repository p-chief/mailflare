# Import & Export thư

> **[TÙY CHỌN]** (hữu ích khi chuyển từ Gmail/nhà cung cấp khác) · Phụ thuộc: [01-co-ban/06-nhan-thu.md §6–7](../01-co-ban/06-nhan-thu.md), [01-co-ban/13-hoi-thoai.md](../01-co-ban/13-hoi-thoai.md)

## 1. Đích import
Chuỗi `destination`:
| Giá trị | direction | status | folderId | owner (`user_id`) |
|---|---|---|---|---|
| `system:inbox` / `inbox` / rỗng (mặc định) | inbound | received | null | owner mailbox |
| `system:sent` | outbound | sent | null | **người import** |
| `system:drafts` | outbound | draft | null | **người import** |
| `system:archived` | inbound | archived | null | owner mailbox |
| `system:spam` / `system:trash` | inbound | spam / trash | null | owner mailbox |
| `folder:<id>` | inbound | received | id (phải thuộc mailbox → 404 "Folder not found") | owner mailbox |
`folder:` rỗng → "Import folder is required"; giá trị khác → "Import destination is invalid".

## 2. Pipeline mỗi thư (`importMessageToMailbox`)
```
parsed = parseRawMime(raw)
providerMessageId = parsed.messageId ?? `import:${filename}:${byteLength}`
đã có (mailbox_id, provider_message_id) → skipped (không lỗi)        // idempotent theo mailbox, bất kể thư mục
INSERT messages { id msg_…, rawR2Key: imports/<id>.eml, fromAddr ?? "unknown", toAddr ?? "", ccAddr,
   subject, snippet, text, html, status/direction/folderId theo đích, read = (direction == outbound),
   threadId = resolveThreadId(...), inReplyTo, references, createdAt = parsed.date ?? now }
try:
   R2.put(imports/<id>.eml, raw, message/rfc822)
   storeMessageAttachments(id, parsed.attachments, {validate:false})
   upsertContact(outbound ? toAddr : fromAddr, outbound ? 'outbound' : 'inbound')
catch → deleteMessageWithObjects; ghi lỗi "<filename>: <msg>" vào errors; skipped += 1
```
**Không** chạy: rule, spam, webhook, realtime, auto-reply, forwarding. `bccAddr` không lưu.
Kết quả `{imported, skipped, errors[]}`.

## 3. Import từ file — `POST /api/import/messages` (canManage)
Multipart `mailboxId`, `destination`, `files[]`; tổng ≤ **25 MiB**; tối đa **100 thư** sau khi tách mbox (phần dư bị **bỏ im lặng**).
- `.mbox`/`.mbx`/`application/mbox` → đọc UTF-8, tách: mỗi dòng `^From ` bắt đầu thư mới (bỏ dòng tách), bỏ 1 newline cuối, `\n>From ` → `\nFrom ` (1 cấp), bỏ thư rỗng; tên `<file>#<n>`.
- `.eml` / `message/rfc822` / type rỗng → nguyên bytes.
- File khác → bỏ qua.
Lỗi: 400/413 "Invalid import upload"; không mailbox/không thư → 400 "Select a mailbox and at least one .eml or .mbox file"; không quyền → 404.

## 4. Import IMAP (Workers `cloudflare:sockets`)
- `POST /api/import/imap/folders {host, port=993, secure=(port==993), username, password}` (session; **không kiểm tra mailbox**) → `{folders}`.
- `POST /api/import/imap {mailboxId, destination, host, port, secure, username, password, folder="INBOX", limit=25 (1–100)}` (canManage) → `{imported, skipped, errors}`; lỗi IMAP → 502.
- Chặn host: rỗng, `localhost`, `*.local`, IPv4 literal trong `10/8, 127/8, 172.16/12, 192.168/16, 169.254/16` ("Private IMAP hosts are not allowed"). **Chưa chặn**: IPv6, `0.0.0.0`, `100.64/10`, hostname phân giải ra IP nội bộ.
- Giao thức: greeting `* OK` → `LOGIN "<u>" "<p>"` → `SELECT "<folder>"` → `UID SEARCH ALL` → lấy `limit` UID **cuối** → `UID FETCH <uid> (RFC822)` tuần tự → `LOGOUT`. Không STARTTLS, không timeout, đọc hết vào bộ nhớ. `RFC822` đánh dấu `\Seen` trên server nguồn. `limit` không phải số → lấy **tất cả** (bug).
- UI: chọn các mục Inbox/Sent/Drafts/Archived/Spam/Trash/Others; ánh xạ tên thư mục (không phân biệt hoa, bỏ `[gmail]/`): Sent ← Sent, Sent Mail, [Gmail]/Sent Mail, Sent Items; Drafts ← Drafts; Archived ← Archive, Archived, [Gmail]/All Mail; Spam ← Spam, Junk, Junk Email; Trash ← Trash, Deleted, Deleted Items. "Others" = mọi thư mục IMAP còn lại → tạo folder cùng tên (tìm không phân biệt hoa hoặc `POST /api/folders`). Chạy tuần tự từng nguồn; lỗi một nguồn dừng các nguồn sau.

## 5. Export — `GET /api/export/messages?mailboxId=` (canRead)
- Mọi thư của mailbox (**kể cả** draft/spam/trash), `created_at ASC`, dựng trong bộ nhớ → `application/mbox; charset=utf-8`, `attachment; filename="<localPart>.mbox"`, no-store.
- Mỗi thư (CRLF): `From MAILER-DAEMON <UTC>`, `Message-ID` (hoặc `<id@mailflare.local>`), `Date`, `From`, `To`, `Cc?`, `In-Reply-To?`, `References?`, `Subject`, `X-Mailflare-Direction`, `X-Mailflare-Status`, `MIME-Version: 1.0`, `Content-Type: text/html|text/plain; charset=utf-8`, `Content-Transfer-Encoding: 8bit`, dòng trống, body (escape `\nFrom ` → `\n>From `).
- **Không có** attachment, raw gốc, Bcc, multipart, cờ đọc/sao/folder. (Nên xuất raw R2 khi có.)

## 6. Tiêu chí chấp nhận
- [ ] Import cùng file 2 lần → lần 2 toàn bộ `skipped`.
- [ ] Import mbox Gmail vào Sent → thư ở Sent, `read = true`, hội thoại đúng.
- [ ] Host IMAP `127.0.0.1` → lỗi.
