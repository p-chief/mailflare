# Import & Export thư

> **[TÙY CHỌN]** (hữu ích khi chuyển từ nhà cung cấp khác) · Phụ thuộc: [01-co-ban/06-nhan-thu.md §8–9](../01-co-ban/06-nhan-thu.md), [01-co-ban/13-hoi-thoai.md](../01-co-ban/13-hoi-thoai.md) · Liên quan: [02-nang-cao/03-folder-tuy-chinh.md](../02-nang-cao/03-folder-tuy-chinh.md), [04-giao-dien/06-cai-dat.md §4–5](../04-giao-dien/06-cai-dat.md)

## 1. Mục tiêu
- Đưa thư cũ vào một mailbox từ file `.eml`/`.mbox` hoặc trực tiếp từ máy chủ IMAP, đặt đúng thư mục và hội thoại.
- Xuất toàn bộ thư của một mailbox thành file `.mbox`.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| File `.eml`, `.mbox`/`.mbx` | PST, định dạng độc quyền khác |
| IMAP qua TLS trực tiếp (cổng 993) hoặc không mã hoá (theo yêu cầu người dùng) | STARTTLS, OAuth IMAP, đồng bộ hai chiều liên tục |
| Import idempotent theo Message-ID | Chạy rule, spam, webhook, realtime, auto-reply, forwarding cho thư import |
| Export mbox một mailbox | Export nhiều mailbox cùng lúc, export cờ đọc/sao/folder dạng chuẩn |

## 3. Quyền
- Import (file và IMAP): quyền `canManage` trên mailbox đích; không có → 404.
- Liệt kê thư mục IMAP: phiên đăng nhập + `canManage` trên `mailboxId` gửi kèm.
- Export: `canRead` trên mailbox.

## 4. Đích import
Chuỗi `destination`:
| Giá trị | direction | status | folderId | owner (`user_id`) |
|---|---|---|---|---|
| `system:inbox` / `inbox` / rỗng (mặc định) | inbound | received | null | owner mailbox |
| `system:sent` | outbound | sent | null | **người import** |
| `system:drafts` | outbound | draft | null | **người import** |
| `system:archived` | inbound | archived | null | owner mailbox |
| `system:spam` / `system:trash` | inbound | spam / trash | null | owner mailbox |
| `folder:<id>` | inbound | received | id (phải thuộc mailbox → 404 "Folder not found") | owner mailbox |

`folder:` rỗng → 400 "Import folder is required"; giá trị khác → 400 "Import destination is invalid".

## 5. Thủ tục nhập một thư
`NHAP_MOT_THU(mailbox, đích, filename, raw)`:
```
parsed = parse MIME (ví dụ: postal-mime)
provider_message_id = parsed.messageId ?? `import:${filename}:${byteLength}`
đã có (mailbox_id, provider_message_id) → skipped += 1 (không lỗi)   // idempotent theo mailbox, bất kể thư mục
id = msg_…
INSERT messages { id, raw_r2_key: imports/<id>.eml, from_addr ?? "unknown", to_addr ?? "", cc_addr,
   bcc_addr (chỉ khi outbound), subject, snippet, text, html,
   status/direction/folder_id theo đích, read = (direction == outbound),
   thread_id = thủ tục phân giải hội thoại (01-co-ban/13), in_reply_to, references,
   created_at = parsed.date ?? now }
try:
   R2.put(imports/<id>.eml, raw, contentType message/rfc822)
   lưu attachment (không áp giới hạn số lượng/kích thước của composer)
   upsert liên hệ: outbound → mỗi người nhận To, kiểu 'outbound'; inbound → người gửi, kiểu 'inbound'
catch → xoá dòng message, attachment và object R2 đã ghi; errors += "<filename>: <thông điệp>"; skipped += 1
```
- **Không** chạy: rule mailbox/domain, bộ lọc spam, webhook, realtime, auto-reply, forwarding.
- Chỉ mục tìm kiếm FTS được cập nhật tự động qua trigger.
- Kết quả mọi endpoint import: `{imported, skipped, errors: string[]}`.

## 6. Import từ file — `POST /api/import/messages`
Multipart: `mailboxId`, `destination`, `files[]`.
- Tổng upload ≤ **25 MiB** (vượt → 413 "Invalid import upload").
- Tối đa **100 thư** mỗi request sau khi tách mbox. Thư thứ 101 trở đi **không** được nhập và kết quả có thêm một dòng lỗi `"<file>: only the first 100 messages were imported; split the file and import the rest"`; không có gì bị bỏ âm thầm.
- Nhận diện file:
  - `.mbox`/`.mbx` hoặc `application/mbox` → đọc UTF-8 và tách: mỗi dòng bắt đầu bằng `From ` mở một thư mới (bỏ chính dòng tách); bỏ một newline cuối mỗi thư; `\n>From ` → `\nFrom ` (bỏ escape một cấp); bỏ thư rỗng; tên thư `<file>#<n>`.
  - `.eml`, `message/rfc822` hoặc content-type rỗng → nguyên bytes là một thư.
  - File khác → không nhập, thêm lỗi `"<file>: unsupported file type"`.
- Lỗi: body không phải multipart hợp lệ → 400 "Invalid import upload"; thiếu mailbox hoặc không có thư nào → 400 "Select a mailbox and at least one .eml or .mbox file"; không quyền → 404.

## 7. Import IMAP
Dùng TCP socket của Workers (`connect()` với `secureTransport: "on"` khi TLS).

### 7.1 Endpoint
- `POST /api/import/imap/folders {mailboxId, host, port = 993, secure = (port == 993), username, password}` → `{folders: string[]}`.
- `POST /api/import/imap {mailboxId, destination, host, port, secure, username, password, folder = "INBOX", limit = 25}` → `{imported, skipped, errors}`.
  - `limit` phải là số nguyên 1–100; thiếu → 25; không phải số hoặc ngoài khoảng → 400 "Message limit must be a number between 1 and 100".
- Lỗi IMAP (kết nối, đăng nhập, lệnh `NO`/`BAD`, timeout) → 502 `{error: "<thông điệp IMAP đã rút gọn>"}`. Mật khẩu không bao giờ xuất hiện trong thông điệp lỗi hoặc log.

### 7.2 Kiểm tra an toàn host (chống SSRF)
Thủ tục `KIEM_TRA_HOST_IMAP(host)` chạy trước mọi kết nối; vi phạm → 400 "Private IMAP hosts are not allowed":
1. Host rỗng, `localhost`, kết thúc bằng `.localhost`, `.local`, `.internal`, `.home.arpa` → chặn.
2. Host là IP literal (IPv4 hoặc IPv6, kể cả trong `[]`) → kiểm tra theo danh sách chặn ở bước 4.
3. Host là tên miền → phân giải A và AAAA (qua DNS-over-HTTPS, ví dụ `https://cloudflare-dns.com/dns-query`); không phân giải được → 400 "IMAP host could not be resolved"; kiểm tra **mọi** IP trả về theo bước 4. Kết nối tới hostname (để TLS SNI đúng), chấp nhận rủi ro DNS rebinding còn lại trong thời gian ngắn giữa kiểm tra và kết nối.
4. Dải bị chặn:

| Họ | Dải |
|---|---|
| IPv4 | `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`, `192.0.0.0/24`, `192.168.0.0/16`, `198.18.0.0/15`, `224.0.0.0/4`, `240.0.0.0/4`, `255.255.255.255/32` |
| IPv6 | `::/128`, `::1/128` (loopback), `fc00::/7` (ULA), `fe80::/10` (link-local), `ff00::/8` (multicast), `::ffff:0:0/96` (IPv4-mapped → kiểm tra phần IPv4 theo bảng IPv4), `64:ff9b::/96` (NAT64 → kiểm tra phần IPv4) |

5. Cổng chỉ cho phép 143 và 993 (khác → 400 "IMAP port must be 143 or 993").

### 7.3 Giao thức
```
chờ greeting "* OK"
LOGIN "<user>" "<pass>"            (escape \ và " trong chuỗi)
LIST "" "*"                         // chỉ cho /folders; trả tên thư mục (bỏ thư mục \Noselect)
SELECT "<folder>"
UID SEARCH ALL
lấy `limit` UID cuối (mới nhất)
với từng UID, tuần tự: UID FETCH <uid> (BODY.PEEK[])    // PEEK: không đánh dấu \Seen trên máy chủ nguồn
   → NHAP_MOT_THU(mailbox, đích, "<folder>/<uid>", literal)
LOGOUT
```
- Timeout **30 s** cho mỗi lệnh và cho greeting; vượt → 502 "IMAP server did not respond in time".
- Mỗi thư ≤ 25 MiB; literal lớn hơn → bỏ thư đó, thêm lỗi `"<folder>/<uid>: message exceeds 25 MB"`.
- Luôn đóng socket (kể cả khi lỗi).

### 7.4 Ánh xạ thư mục (dùng bởi UI)
So khớp không phân biệt hoa, bỏ tiền tố `[gmail]/`:
| Mục | Tên thư mục IMAP |
|---|---|
| Inbox | `INBOX` |
| Sent | Sent, Sent Mail, [Gmail]/Sent Mail, Sent Items |
| Drafts | Drafts |
| Archived | Archive, Archived, [Gmail]/All Mail |
| Spam | Spam, Junk, Junk Email |
| Trash | Trash, Deleted, Deleted Items |
| Others | mọi thư mục IMAP còn lại → tạo (hoặc dùng lại, so tên không phân biệt hoa) folder tuỳ chỉnh cùng tên, đích `folder:<id>` |

UI chạy tuần tự từng nguồn; lỗi một nguồn được ghi vào danh sách lỗi hiển thị và **tiếp tục** nguồn kế tiếp.

## 8. Export — `GET /api/export/messages?mailboxId=`
- Mọi thư của mailbox (**kể cả** draft/spam/trash), `created_at ASC`, trả về dạng **stream** (không dựng toàn bộ trong bộ nhớ): `Content-Type: application/mbox; charset=utf-8`, `Content-Disposition: attachment; filename="<localPart>.mbox"`, `Cache-Control: no-store`.
- Mỗi thư bắt đầu bằng `From MAILER-DAEMON <ngày UTC dạng asctime>` rồi:
  - **Có raw MIME** (`raw_r2_key` trỏ tới object tồn tại) → ghi nguyên raw từ R2, chỉ escape `From ` đầu dòng thành `>From ` (mboxrd). Không thêm header.
  - **Không có raw** → dựng MIME (CRLF): `Message-ID` (hoặc `<id@{APP_HOST}>`), `Date`, `From`, `To`, `Cc?`, `Bcc?` (chỉ thư outbound), `In-Reply-To?`, `References?`, `Subject` (mã hoá RFC 2047 khi có ký tự ngoài ASCII), `X-App-Direction`, `X-App-Status`, `MIME-Version: 1.0`; không attachment → `Content-Type: text/html|text/plain; charset=utf-8`, `Content-Transfer-Encoding: 8bit`; có attachment → `multipart/mixed` gồm phần nội dung + từng attachment (base64, `Content-Disposition` + tên file) đọc từ R2; body escape `From ` đầu dòng.
- Kết thúc mỗi thư bằng một dòng trống.
- Object R2 thiếu (raw hoặc attachment) → dựng MIME không có phần đó và ghi `X-App-Export-Warning: missing <raw|attachment name>`; không làm hỏng cả file.
- Không quyền → 404.

## 9. Lỗi & biên
- File mbox không có dòng `From ` nào → coi cả file là một thư.
- Thư không parse được → vào `errors`, không dừng các thư khác.
- Import vào mailbox đã bị xoá giữa chừng → các thư còn lại lỗi, kết quả vẫn trả số đã nhập.
- IMAP folder không tồn tại → 502 với thông điệp `NO` của máy chủ.

## 10. Tiêu chí chấp nhận
- [ ] Import cùng file 2 lần → lần 2 toàn bộ `skipped`, `imported = 0`.
- [ ] Import mbox 150 thư → 100 thư được nhập, `errors` có dòng báo phần còn lại.
- [ ] Import mbox vào Sent → thư ở Sent, `read = true`, hội thoại đúng.
- [ ] Host IMAP `127.0.0.1`, `[::1]`, `0.0.0.0`, `100.64.1.1`, `fd00::1`, `fe80::1` → 400 "Private IMAP hosts are not allowed".
- [ ] Hostname phân giải ra `10.0.0.5` → 400.
- [ ] `limit: "abc"` → 400.
- [ ] Sau import IMAP, thư trên máy chủ nguồn vẫn chưa đọc.
- [ ] Export mailbox có thư nhận (có raw) và thư gửi có attachment → file mbox chứa raw nguyên bản và thư gửi dạng multipart có attachment; import lại file đó vào mailbox khác cho cùng số thư.

## 11. Ghi chú triển khai
- Import có thể mất nhiều thời gian với 100 thư lớn; nếu vượt giới hạn CPU của request, chuyển sang xử lý qua queue và trả `jobId` để UI poll (định dạng kết quả giữ nguyên).
