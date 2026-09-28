# Tìm kiếm thư

> **[CƠ BẢN]** tìm theo từ khoá (FTS5) · **[NÂNG CAO]** toán tử kiểu Gmail
> Phụ thuộc: [00-nen-tang/04-mo-hinh-du-lieu.md §2.8](../00-nen-tang/04-mo-hinh-du-lieu.md), [07-danh-sach-dem-thu.md](07-danh-sach-dem-thu.md)

## 1. Mục tiêu
Tìm nhanh thư theo nội dung, người gửi/nhận, tiêu đề, cờ và ngày, trong phạm vi quyền của người dùng, **không cho phép** chèn cú pháp FTS.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Parse chuỗi tìm kiếm, dựng điều kiện SQL | Tìm trong nội dung file đính kèm |
| Chỉ mục FTS5 tự đồng bộ bằng trigger | Xếp hạng theo độ liên quan (kết quả vẫn theo ngày) |
| Admin kiểm tra/rebuild index | Gợi ý/tự hoàn thành |

## 3. Nơi dùng
`GET /api/messages?q=…` (session) và `GET /api/v1/messages?q=…` (API key `read`). Điều kiện tìm kiếm luôn AND với phạm vi mailbox + bộ lọc thư mục. Tìm "trong thư mục đang mở" là hành vi mặc định của UI.

## 4. Cú pháp
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
| `is:unread`, `is:read`, `is:starred` (và `:unread`, `:read` cũ) | cờ | NÂNG CAO |
| `after:YYYY-MM-DD` / `newer:` | `created_at >= 00:00 UTC ngày đó` | NÂNG CAO |
| `before:YYYY-MM-DD` / `older:` | `created_at < 00:00 UTC ngày đó` (loại trừ) | NÂNG CAO |
Ngày chấp nhận `-` hoặc `/`. Toán tử không nhận ra (`has:foo`, `is:bar`) bị bỏ. Mọi điều kiện kết hợp **AND**.

## 5. Dựng truy vấn

### 5.1 Parse — `parseSearchQuery(raw)`
Regex toán tử `(?:^|\s)(from|to|subject|title|has|is|after|before|newer|older):(?:"([^"]*)"|(\S+))` (không phân biệt hoa thường) — lấy ra và xoá khỏi chuỗi; phần còn lại (gộp khoảng trắng) là `text`.

### 5.2 Tách từ — `tokenizeSearchText(text)`
Regex `(-?)"([^"]+)"|(-?)(\S+)` → `{term, negate, phrase}`.

### 5.3 Từ → biểu thức FTS5 an toàn — `ftsTerm(term, phrase)`
```
cleaned = term.replace(/[^\p{L}\p{N}\s]+/gu, " ").collapse().trim()    // "maya@acme.test" → "maya acme test"
cleaned rỗng → bỏ
phrase || cleaned có dấu cách → "cleaned"        (khớp nguyên từ)
khác                          → "cleaned"*       (khớp tiền tố)
ftsString(v) = '"' + v.replaceAll('"', '""') + '"'   // người dùng không thể chèn toán tử FTS
```

### 5.4 Ghép — `buildFtsMatch(parsed)`
```
parts = text tokens → expr (phủ định → "NOT expr")
column("subject", parsed.subject), column("from_addr", parsed.from), column("{to_addr cc_addr}", parsed.to)
   // column(name, value) = `${name} : (${terms.join(" AND ")})`
positives = parts không NOT; negatives = phần NOT
base = positives.join(" AND ") || '""*'                 // FTS5 không có NOT một ngôi
match = negatives ? `(${base}) NOT (${negatives.join(" OR ")})` : base
```

### 5.5 SQL
```sql
messages.rowid IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?)
AND EXISTS (SELECT 1 FROM message_attachments WHERE message_id = messages.id AND disposition = 'attachment')  -- has:attachment
AND read = 1|0 AND starred = 1 AND created_at >= ? AND created_at < ?
```
Không có điều kiện nào → không thêm gì (trả toàn bộ theo bộ lọc thư mục).

### 5.6 Client
`is:unread`/`is:read` (và `:unread`/`:read`) được tách khỏi chuỗi và chuyển thành tham số `read=` để đồng bộ với nút lọc "chưa đọc"; phần còn lại gửi nguyên trong `q`.

## 6. Chỉ mục
- FTS5 external-content, tokenizer `unicode61 remove_diacritics 2` → **tìm không dấu được** ("tieng viet" khớp "tiếng việt").
- Trigger insert/update/delete giữ đồng bộ; ứng dụng không ghi index.
- `GET /api/admin/search-index` (admin) → `{indexed, messages}`; `POST` → `INSERT INTO messages_fts(messages_fts) VALUES('rebuild')` rồi trả số đếm. Cần khi restore backup hoặc số đếm lệch.
- HTML body được index **nguyên thẻ** → tìm "div" có thể khớp. Khi viết lại có thể index cột text đã strip.

## 7. Tiêu chí chấp nhận
- [ ] `inv` tìm thấy thư có "Invoice" trong subject hoặc body.
- [ ] `from:maya -newsletter has:attachment after:2026-09-01` trả đúng tập giao.
- [ ] Chuỗi `"a" OR x NEAR(` không gây lỗi SQL và không đổi nghĩa truy vấn.
- [ ] Tìm trong mailbox không có quyền → không trả thư nào.
- [ ] Thư mới nhận tìm thấy được ngay (không cần rebuild).
