# Trả lời, trả lời tất cả, chuyển tiếp (Reply / Reply-all / Forward)

> **[CƠ BẢN]** · Logic chủ yếu ở client, dùng API nháp + gửi.
> Phụ thuộc: [10-nhap-thu.md](10-nhap-thu.md), [11-gui-thu.md](11-gui-thu.md), [13-hoi-thoai.md](13-hoi-thoai.md)

## 1. Mục tiêu
Tạo thư trả lời/chuyển tiếp với đúng người nhận, tiêu đề, trích dẫn, header threading và (với forward) file đính kèm gốc.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Tính người nhận, tiêu đề, trích dẫn, threading | Gửi (file gửi) |
| Tạo nháp trên server trước khi mở composer | |
| Copy attachment khi forward | |

## 3. Luồng chung
```
user bấm Reply / Reply all / Forward trên thư M
  → client tính recipients, subject, quote HTML, threading
  → POST /api/drafts {...}          (forward: kèm forwardOfMessageId = M.id)
  → mở composer với draftId trả về
  → người dùng sửa → autosave PATCH → Send (POST /api/send, kèm draftId nếu nháp có attachment)
```

## 4. Người nhận — `getReplyRecipients(M, ownAddresses, mode)`
`ownAddresses` = mọi địa chỉ hợp lệ của mailbox đang dùng (`senderAddresses`). Hàm `unique` loại địa chỉ rỗng, **của chính mình**, và trùng (so theo địa chỉ lowercase).

| M | Reply | Reply-all |
|---|---|---|
| inbound | `to = unique([M.from])`, `cc = []` | `to = unique([M.from])`, `cc = unique(split(M.to) ∪ split(M.cc))` |
| outbound (thư mình gửi) | `to = unique(split(M.to))`, `cc = []` | `to = unique(split(M.to))`, `cc = unique(split(M.cc))` |

- Nút Reply-all chỉ hiện khi `|to|+|cc|` của reply-all > của reply (`hasAdditionalRecipients`).
- Reply không có người nhận (vd M.from là chính mình) → lỗi "Sender address is required".
- `bcc` gốc không bao giờ được thêm.

## 5. Tiêu đề
| Loại | Quy tắc |
|---|---|
| Reply | trim; rỗng → `Re:`; đã bắt đầu `re:` (không phân biệt hoa thường) → giữ; khác → `Re: <subject>` |
| Forward | trim; rỗng → `Fwd:`; đã bắt đầu `fwd:` hoặc `fw:` → giữ; khác → `Fwd: <subject>` |

## 6. Threading — `getReplyThreading(M)`
```
parentId   = trim(M.providerMessageId) bỏ <> || null
chain      = split(M.references, whitespace) bỏ <> ; nếu parentId ∉ chain → push(parentId)
inReplyTo  = parentId
references = chain.join(" ") || null
threadId   = M.threadId ?? parentId
```
- Reply: gửi cả `inReplyTo`, `references`, `threadId`.
- Forward: gửi `references` và `threadId` (không `inReplyTo`) — người nhận đã có thư gốc sẽ thấy liên kết; thư forward vẫn nằm trong hội thoại của mình.
- Server khi gửi: References giới hạn 30 id (giữ id đầu + 29 cuối).

## 7. Nội dung trích dẫn

### 7.1 Reply — `buildReplyQuoteHtml(sender, sentAt, text, html)`
```
original = html ? sanitizeEmailHtml(html) : textToHtml(text)      // không có → không quote
when     = sentAt ? format("ddd, MMM D, YYYY [at] h:mm A") : "an earlier date"
wrapQuotedHtml(
  `<div style="margin-top:1.4em">On ${when}, ${escape(sender)} wrote:</div>
   <blockquote style="margin:0;border-left:1px solid #ccc;padding-left:1ex;opacity:0.6">${original}</blockquote>`)
```
`sender` = header From của M. Nháp tạo với `html = quote`, `text = htmlToPlainText(quote)`.

### 7.2 Forward — `buildForwardHtml(M, text, html)`
```
<div>---------- Forwarded message ---------<br>
From: <M.from><br>Date: <ddd, MMM D, YYYY at h:mm A><br>Subject: <M.subject ?? "(no subject)"><br>
To: <M.to>[<br>Cc: <M.cc>]</div><br>
+ original (sanitize hoặc text→html)
→ wrapQuotedHtml(...)
```
Nháp forward: `to = ""`, `from` = địa chỉ của mailbox, `forwardOfMessageId = M.id` → server copy attachment.

### 7.3 Trích dẫn trong composer
`splitQuotedHtml(html)` tách phần trước `<div class="mailflare-quote" data-mailflare-quote="1">` (body sửa được) và phần quote (thu gọn, có nút mở). Khi lưu/gửi: `joinQuotedHtml(body, quote)`.

### 7.4 Bản text cũ (legacy)
`buildReplyQuote(sender, text)`: `\n\n<addr> wrote:\n> dòng…` từ phần nội dung mới nhất — không còn dùng cho HTML composer.

## 8. From của reply
`ownAddress = getOwnAddressForMessage(M)`:
- M outbound → địa chỉ From của M;
- M inbound → địa chỉ **đầu tiên trong To/Cc của M** mà mailbox được phép gửi (`senderAddresses`) — nhờ vậy trả lời thư gửi tới alias/domain phụ sẽ dùng đúng địa chỉ đó;
- không có → `senderAddresses[0]`, cuối cùng là địa chỉ To.

Client gửi `from = getEmailAddress(ownAddress)`; API từ chối (403) nếu không thuộc mailbox.

## 9. Tiêu chí chấp nhận
- [ ] Reply-all thư gửi tới `me, a, b` cc `c` → To: người gửi; Cc: `a, b, c` (không có `me`).
- [ ] Reply thư mình đã gửi → To = người nhận gốc.
- [ ] Subject `RE: Hello` → giữ nguyên; `Hello` → `Re: Hello`.
- [ ] Thư trả lời có `In-Reply-To` = Message-ID gốc, `References` kết thúc bằng Message-ID gốc.
- [ ] Forward thư có attachment → người nhận nhận đủ file.
