# Tìm kiếm thư

> **[CƠ BẢN]** tìm theo từ khoá (FTS5) · **[NÂNG CAO]** toán tử kiểu Gmail
> Phụ thuộc: [00-nen-tang/04-mo-hinh-du-lieu.md §2.8](../00-nen-tang/04-mo-hinh-du-lieu.md), [07-danh-sach-dem-thu.md](07-danh-sach-dem-thu.md)

## 1. Mục tiêu
Tìm nhanh thư theo nội dung, người gửi/nhận, tiêu đề, cờ và ngày, trong phạm vi quyền của người dùng, **không cho phép** chèn cú pháp FTS.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Parse chuỗi tìm kiếm, dựng điều kiện SQL | Tìm trong nội dung file đính kèm |
| Chỉ mục FTS5 tự đồng bộ bằng trigger, nội dung text rút từ HTML | Xếp hạng theo độ liên quan (kết quả vẫn theo ngày) |
| Admin kiểm tra/rebuild index | Gợi ý/tự hoàn thành |

## 3. Nơi dùng
`GET /api/messages?q=…` (session) và `GET /api/v1/messages?q=…` (API key scope `read` — [02-nang-cao/13](../02-nang-cao/13-api-key-va-rest-v1.md)). Điều kiện tìm kiếm luôn AND với phạm vi mailbox được phép + bộ lọc thư mục. Tìm "trong thư mục đang mở" là hành vi mặc định của UI.

## 4. Dữ liệu & chỉ mục

### 4.1 Cột `messages.search_text`
| Cột | Kiểu | Ghi chú |
|---|---|---|
| `search_text` | text null | văn bản thuần dùng để index nội dung thư; ứng dụng tính khi ghi thư |

`search_text = VAN_BAN_TIM_KIEM(text_body, html_body)`:
```
t = collapse(text_body ?? "")
h = collapse(BO_THE_HTML(html_body ?? ""))
search_text = (h == "" || h == t) ? t : (t == "" ? h : t + "\n" + h)
search_text rỗng → null; dài hơn 200 000 ký tự → cắt còn 200 000
```
`BO_THE_HTML(html)`: xoá hẳn `<script>`, `<style>`, `<head>` cùng nội dung và comment `<!-- -->`; thẻ khối (`p div br li tr td th h1–h6 blockquote pre hr`) → xuống dòng/khoảng trắng; xoá mọi thẻ còn lại (giữ text con); giải mã entity HTML (tên và số: `&amp;`, `&nbsp;`, `&#39;`, `&#x2F;`…). `collapse` = gộp mọi khoảng trắng liên tiếp thành một dấu cách, trim.

Nhờ vậy tên thẻ, thuộc tính, CSS và URL ảnh trong HTML **không** vào chỉ mục (tìm "div" hay "font" không khớp mọi thư HTML).

**Mọi** thao tác ghi `text_body` hoặc `html_body` (nhận thư, import, JMAP import, tạo/sửa nháp, gửi) phải ghi `search_text` trong cùng câu lệnh `INSERT`/`UPDATE`. Đây là cột dữ liệu thường, được backup/restore như các cột khác.

### 4.2 Bảng FTS và trigger
```sql
CREATE VIRTUAL TABLE messages_fts USING fts5(
  subject, from_addr, to_addr, cc_addr, search_text,
  content='messages', content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2');

CREATE TRIGGER messages_fts_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, subject, from_addr, to_addr, cc_addr, search_text)
  VALUES (new.rowid, new.subject, new.from_addr, new.to_addr, new.cc_addr, new.search_text);
END;

CREATE TRIGGER messages_fts_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, subject, from_addr, to_addr, cc_addr, search_text)
  VALUES ('delete', old.rowid, old.subject, old.from_addr, old.to_addr, old.cc_addr, old.search_text);
END;

CREATE TRIGGER messages_fts_au AFTER UPDATE OF subject, from_addr, to_addr, cc_addr, search_text ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, subject, from_addr, to_addr, cc_addr, search_text)
  VALUES ('delete', old.rowid, old.subject, old.from_addr, old.to_addr, old.cc_addr, old.search_text);
  INSERT INTO messages_fts(rowid, subject, from_addr, to_addr, cc_addr, search_text)
  VALUES (new.rowid, new.subject, new.from_addr, new.to_addr, new.cc_addr, new.search_text);
END;
```
- Tokenizer `unicode61 remove_diacritics 2` → **tìm không dấu được** ("tieng viet" khớp "tiếng việt").
- Ứng dụng không bao giờ ghi `messages_fts` trực tiếp; trigger giữ đồng bộ. Đổi `status`, `read`, `folder_id`… không chạm index.
- Khi tách câu lệnh SQL để chạy migration phải giữ nguyên thân trigger (`BEGIN … END;`).
- Backup bỏ qua `messages_fts%` (bảng dẫn xuất); sau restore chạy rebuild (§7).

## 5. Cú pháp
| Cú pháp | Nghĩa | Nhãn |
|---|---|---|
| `invoice` | khớp tiền tố ở mọi cột (`inv` tìm được "invoice") | CƠ BẢN |
| `"private window"` | cụm từ nguyên vẹn | CƠ BẢN |
| `-word`, `-"cụm từ"` | loại trừ | NÂNG CAO |
| `from:maya` | cột `from_addr` | NÂNG CAO |
| `to:sam` | cột `to_addr` **và** `cc_addr` | NÂNG CAO |
| `subject:report`, `title:report` | cột `subject` | NÂNG CAO |
| giá trị có dấu cách: `to:"sam okoro"` | | NÂNG CAO |
| `has:attachment` / `has:attachments` | có ≥1 attachment `disposition='attachment'` | NÂNG CAO |
| `is:unread`, `is:read`, `is:starred` (bí danh `:unread`, `:read`) | cờ | NÂNG CAO |
| `after:YYYY-MM-DD` / `newer:` | `created_at >= 00:00 UTC ngày đó` | NÂNG CAO |
| `before:YYYY-MM-DD` / `older:` | `created_at < 00:00 UTC ngày đó` (loại trừ) | NÂNG CAO |

Ngày chấp nhận `-` hoặc `/`; ngày không hợp lệ → toán tử bị bỏ. Toán tử không nhận ra (`has:foo`, `is:bar`) bị bỏ. Mọi điều kiện kết hợp **AND**.

## 6. Dựng truy vấn

### 6.1 Parse — thủ tục `PHAN_TICH_TRUY_VAN(raw)`
Regex toán tử `(?:^|\s)(from|to|subject|title|has|is|after|before|newer|older):(?:"([^"]*)"|(\S+))` (không phân biệt hoa thường) — lấy ra và xoá khỏi chuỗi; phần còn lại (gộp khoảng trắng) là `text`. Kết quả `{text, from[], to[], subject[], hasAttachment, read?, starred, after?, before?}`.

### 6.2 Tách từ — thủ tục `TACH_TU(text)`
Regex `(-?)"([^"]+)"|(-?)(\S+)` → danh sách `{term, negate, phrase}`.

### 6.3 Từ → biểu thức FTS5 an toàn — thủ tục `BIEU_THUC_FTS(term, phrase)`
```
cleaned = term.replace(/[^\p{L}\p{N}\s]+/gu, " ").collapse().trim()    // "maya@acme.test" → "maya acme test"
cleaned rỗng → bỏ
phrase || cleaned có dấu cách → CHUOI_FTS(cleaned)          (khớp nguyên cụm)
khác                          → CHUOI_FTS(cleaned) + "*"    (khớp tiền tố)
CHUOI_FTS(v) = '"' + v.replaceAll('"', '""') + '"'           // người dùng không thể chèn toán tử FTS
```

### 6.4 Ghép — thủ tục `GHEP_MATCH(parsed)`
```
parts = token của text → BIEU_THUC_FTS (phủ định → "NOT expr")
COT("subject", parsed.subject), COT("from_addr", parsed.from), COT("{to_addr cc_addr}", parsed.to)
   // COT(name, values) = `${name} : (${values.map(BIEU_THUC_FTS).join(" AND ")})`, bỏ nếu rỗng
positives = parts không NOT; negatives = phần NOT (bỏ tiền tố NOT)
base = positives.join(" AND ") || '""*'                 // FTS5 không có NOT một ngôi; '""*' khớp mọi dòng
match = negatives ? `(${base}) NOT (${negatives.join(" OR ")})` : base
```
Token văn bản không giới hạn cột → khớp ở mọi cột (`subject`, `from_addr`, `to_addr`, `cc_addr`, `search_text`).

### 6.5 SQL
```sql
messages.rowid IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?)
AND EXISTS (SELECT 1 FROM message_attachments WHERE message_id = messages.id AND disposition = 'attachment')  -- has:attachment
AND read = 1|0 AND starred = 1 AND created_at >= ? AND created_at < ?
```
Chỉ thêm phần tương ứng với điều kiện có mặt; không có điều kiện nào → không thêm gì (trả toàn bộ theo bộ lọc thư mục). Chuỗi `MATCH` luôn truyền bằng tham số bind, không nối vào SQL.

### 6.6 Client
`is:unread`/`is:read` (và `:unread`/`:read`) được tách khỏi chuỗi và chuyển thành tham số `read=` để đồng bộ với nút lọc "chưa đọc"; phần còn lại gửi nguyên trong `q`.

## 7. Quản trị chỉ mục
- `GET /api/admin/search-index` (admin) → `{ indexed, messages, pendingText }`: `indexed` = số dòng `messages_fts`, `messages` = số dòng `messages`, `pendingText` = số thư có `search_text IS NULL` nhưng `text_body` hoặc `html_body` khác null.
- `POST /api/admin/search-index` (admin):
  1. Backfill: lặp theo lô 200 thư có `pendingText`, tính `VAN_BAN_TIM_KIEM` và `UPDATE search_text` (trigger cập nhật index). Vượt ngân sách thời gian (vd 25 s) → dừng, trả `{…, remaining:true}` để client gọi lại.
  2. Khi hết backfill: `INSERT INTO messages_fts(messages_fts) VALUES('rebuild')`.
  3. Trả số đếm như `GET`.
- Cần chạy sau khi restore backup, sau migration thêm `search_text` cho dữ liệu cũ, hoặc khi `indexed ≠ messages`.

## 8. Lỗi & biên
| Tình huống | Hành vi |
|---|---|
| Chuỗi chỉ gồm ký tự đặc biệt (`@@@`) | mọi token bị bỏ → không thêm điều kiện FTS |
| Chỉ có từ phủ định (`-newsletter`) | `(""*) NOT ("newsletter"*)`, tức mọi thư trừ thư chứa từ đó |
| Cú pháp FTS do người dùng gõ (`OR`, `NEAR(`, `*`, `:`) | bị trung hoà thành chuỗi trong ngoặc kép, không lỗi SQL |
| Thư chỉ có HTML | nội dung text rút từ HTML vẫn tìm được |

## 9. Tiêu chí chấp nhận
- [ ] `inv` tìm thấy thư có "Invoice" trong subject hoặc body.
- [ ] `from:maya -newsletter has:attachment after:2026-09-01` trả đúng tập giao.
- [ ] Chuỗi `"a" OR x NEAR(` không gây lỗi SQL và không đổi nghĩa truy vấn.
- [ ] Tìm `div` không khớp thư HTML chỉ vì có thẻ `<div>`; tìm một từ chỉ nằm trong HTML (không có trong text part) vẫn khớp.
- [ ] Tìm trong mailbox không có quyền → không trả thư nào.
- [ ] Thư mới nhận tìm thấy được ngay (không cần rebuild).
- [ ] Thư bị xoá vĩnh viễn không còn trong kết quả.

## 10. Ghi chú triển khai
- `messages` dùng `rowid` ngầm định (khoá chính là text). SQLite có thể đánh số lại `rowid` khi `VACUUM` hoặc khi dữ liệu được nạp lại (restore) — khi đó bắt buộc chạy rebuild (§7).
- `wrangler d1 export` không chạy với database có bảng ảo; dùng backup JSON của ứng dụng ([03-tuy-chon/04](../03-tuy-chon/04-backup.md)).
- `BO_THE_HTML` chạy ở server nên không dùng DOM; có thể dùng bộ phân tích HTML dạng stream (ví dụ HTMLRewriter trên Workers) hoặc regex đơn giản vì kết quả chỉ dùng để index, không để hiển thị.
