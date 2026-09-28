# Trả lời, trả lời tất cả, chuyển tiếp (Reply / Reply-all / Forward)

> **[CƠ BẢN]** · Logic chủ yếu ở client, dùng API nháp + gửi.
> Phụ thuộc: [10-nhap-thu.md](10-nhap-thu.md), [11-gui-thu.md](11-gui-thu.md), [13-hoi-thoai.md](13-hoi-thoai.md)

## 1. Mục tiêu
Tạo thư trả lời/chuyển tiếp với đúng người nhận, địa chỉ gửi, tiêu đề, trích dẫn, header threading và (với forward) file đính kèm gốc.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Tính người nhận, From, tiêu đề, trích dẫn, threading | Gửi ([11-gui-thu.md](11-gui-thu.md)) |
| Tạo nháp trên server trước khi mở composer | Trả lời tự động ([02-nang-cao/07](../02-nang-cao/07-tra-loi-tu-dong.md)) |
| Copy attachment khi forward | |

## 3. Luồng chung
```
user bấm Reply / Reply all / Forward trên thư M
  → client tính From, recipients, subject, quote HTML, threading
  → POST /api/drafts {...}          (forward: kèm forwardOfMessageId = M.id)
  → mở composer với draftId trả về
  → người dùng sửa → autosave PATCH → Send (POST /api/send kèm draftId)
  → server gửi, rồi xoá nháp
```
Người dùng cần `canRead` trên mailbox của M để thấy nút, và `canSendOnBehalf` để tạo nháp (không có → nút ẩn; API trả 403).

## 4. Người nhận — thủ tục `NGUOI_NHAN_TRA_LOI(M, ownAddresses, mode)`
`ownAddresses` = tập địa chỉ hợp lệ của mailbox đang dùng (`DIA_CHI_HOP_LE`, [11-gui-thu.md §3](11-gui-thu.md)). Hàm phụ `DUY_NHAT(list)` loại địa chỉ rỗng, địa chỉ **của chính mình** (thuộc `ownAddresses`), và địa chỉ trùng (so theo địa chỉ lowercase, giữ lần xuất hiện đầu cùng tên hiển thị).

| M | Reply | Reply-all |
|---|---|---|
| inbound | `to = DUY_NHAT([M.from])`, `cc = []` | `to = DUY_NHAT([M.from])`, `cc = DUY_NHAT(tách(M.to) ∪ tách(M.cc))` |
| outbound (thư mình gửi) | `to = DUY_NHAT(tách(M.to))`, `cc = []` | `to = DUY_NHAT(tách(M.to))`, `cc = DUY_NHAT(tách(M.cc))` |

- "tách" = tách chuỗi header thành danh sách địa chỉ ([00-nen-tang/06 §5](../00-nen-tang/06-quy-uoc-chung.md)).
- Nút Reply-all chỉ hiện khi `|to|+|cc|` của reply-all lớn hơn của reply.
- Reply không có người nhận (vd M.from là chính mình) → lỗi "Sender address is required".
- `bcc` gốc không bao giờ được thêm.

## 5. Tiêu đề
| Loại | Quy tắc |
|---|---|
| Reply | trim; rỗng → `Re:`; đã bắt đầu `re:` (không phân biệt hoa thường) → giữ; khác → `Re: <subject>` |
| Forward | trim; rỗng → `Fwd:`; đã bắt đầu `fwd:` hoặc `fw:` → giữ; khác → `Fwd: <subject>` |

## 6. Threading — thủ tục `THREADING_TRA_LOI(M)`
```
parentId   = trim(M.providerMessageId) bỏ <> || null
chain      = tách(M.references, khoảng trắng) bỏ <> ; nếu parentId && parentId ∉ chain → push(parentId)
inReplyTo  = parentId
references = chain.join(" ") || null
threadId   = M.threadId ?? parentId
```
- Reply: gửi cả `inReplyTo`, `references`, `threadId`.
- Forward: gửi `references` và `threadId` (không `inReplyTo`) — người nhận đã có thư gốc sẽ thấy liên kết; thư forward vẫn nằm trong hội thoại của người gửi.
- Server khi gửi giới hạn References tối đa 30 id (giữ id đầu + 29 id cuối) — [11-gui-thu.md §4.3](11-gui-thu.md).

## 7. Nội dung trích dẫn
Wrapper trích dẫn chuẩn (dùng chung cho reply và forward):
```html
<div class="app-quote" data-app-quote="1"> …nội dung trích dẫn… </div>
```

### 7.1 Reply — `TRICH_DAN_TRA_LOI(sender, sentAt, text, html)`
```
original = html ? làm sạch HTML theo [08-doc-thu.md §5.1](08-doc-thu.md) : văn bản → HTML (escape, xuống dòng → <br>)
           // không có nội dung → không có trích dẫn
when     = sentAt ? format("ddd, MMM D, YYYY [at] h:mm A", giờ địa phương trình duyệt) : "an earlier date"
bọc trong wrapper:
  <div style="margin-top:1.4em">On ${when}, ${escape(sender)} wrote:</div>
  <blockquote style="margin:0;border-left:1px solid #ccc;padding-left:1ex;opacity:0.6">${original}</blockquote>
```
`sender` = header From của M (nguyên chuỗi, có tên). Nháp tạo với `html = quote`, `text` = quote chuyển sang text thuần ([11-gui-thu.md §6](11-gui-thu.md)).

### 7.2 Forward — `NOI_DUNG_CHUYEN_TIEP(M, text, html)`
```
<div>---------- Forwarded message ---------<br>
From: <M.from><br>Date: <ddd, MMM D, YYYY at h:mm A><br>Subject: <M.subject ?? "(no subject)"><br>
To: <M.to>[<br>Cc: <M.cc>]</div><br>
+ original (làm sạch HTML hoặc văn bản → HTML)
→ bọc trong wrapper
```
Mọi giá trị header chèn vào đều được escape HTML. Nháp forward: `to = ""`, `from` = địa chỉ theo §8, `forwardOfMessageId = M.id` → server copy attachment ([10-nhap-thu.md §5.1](10-nhap-thu.md)).

### 7.3 Trích dẫn trong composer
Khi mở nháp, composer tách HTML thành hai phần tại wrapper `<div class="app-quote" data-app-quote="1">`: phần trước là body sửa được, phần wrapper là trích dẫn (thu gọn, có nút mở "Show quoted text"). Khi lưu/gửi: `html = body + wrapper`. Người dùng xoá trích dẫn → gửi không có wrapper.

## 8. From của reply/forward — thủ tục `DIA_CHI_CUA_MINH(M)`
- M outbound → địa chỉ From của M;
- M inbound → địa chỉ **đầu tiên trong To rồi Cc của M** thuộc `DIA_CHI_HOP_LE` của mailbox — nhờ vậy trả lời thư gửi tới alias/domain phụ sẽ dùng đúng địa chỉ đó;
- không có → địa chỉ đầu tiên của `DIA_CHI_HOP_LE` (địa chỉ chính của mailbox), cuối cùng là địa chỉ To đầu tiên của M.

Client gửi `from` = phần địa chỉ (không tên) của kết quả; server tự dựng tên hiển thị và từ chối (403) nếu địa chỉ không thuộc mailbox ([11-gui-thu.md §3](11-gui-thu.md)).

## 9. Lỗi & biên
| Tình huống | Hành vi |
|---|---|
| M không có Message-ID (`providerMessageId` null) | `inReplyTo = null`, `references` = chain cũ, `threadId = M.threadId` |
| M không có nội dung | nháp không có trích dẫn |
| Thư nguồn forward có attachment bị mất object R2 | file đó bị bỏ qua, các file khác vẫn được copy |
| Người dùng không có `canSendOnBehalf` | `POST /api/drafts` 403 "You do not have permission to send from this mailbox" |

## 10. Tiêu chí chấp nhận
- [ ] Reply-all thư gửi tới `me, a, b` cc `c` → To: người gửi; Cc: `a, b, c` (không có `me`).
- [ ] Reply thư mình đã gửi → To = người nhận gốc.
- [ ] Reply thư gửi tới alias `sales@` của mailbox → From = `sales@`.
- [ ] Subject `RE: Hello` → giữ nguyên; `Hello` → `Re: Hello`.
- [ ] Thư trả lời có `In-Reply-To` = Message-ID gốc, `References` kết thúc bằng Message-ID gốc.
- [ ] Forward thư có attachment → người nhận nhận đủ file.
- [ ] Trích dẫn nằm trong `<div class="app-quote" data-app-quote="1">` và được thu gọn khi đọc.
