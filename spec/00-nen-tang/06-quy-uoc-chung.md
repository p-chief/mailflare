# Quy ước chung & tiện ích dùng lại

> Thuộc nhóm: Nền tảng · **[CƠ BẢN]**

## 1. ID
`newId(prefix?)` = `nanoid()` (21 ký tự URL-safe), có tiền tố `prefix_`:

| Tiền tố | Thực thể | Tiền tố | Thực thể |
|---|---|---|---|
| `usr_` | user | `key_` | API key record |
| `dom_` | domain | `ep_` | giá trị API key |
| `mbx_` | mailbox | `wh_` / `whd_` / `whsec_` | webhook / delivery / secret |
| `als_` | alias | `aud_` | audit log |
| `msg_` | message | `mac_` | mailbox access |
| `att_` | attachment | `arp_` | auto-reply delivery |
| `job_` | outbound job | `thr_` | thread (fallback) |
| `fld_` | folder | `sess_` | token phiên |
| `rule_` | rule | `prt_` | token reset mật khẩu |
| `bak_` | backup | `mfa_` | login challenge |
| `evt_` | calendar event | `rc_` | recovery code |
| `ts_` | idempotency key Turnstile | | |

Ngoại lệ: contact `"<userId>:<email>"`, rule chặn `"block:<mailboxId>:<email>"`, session/challenge/password-reset row id = nanoid không tiền tố.

## 2. Hash & bí mật
| Dữ liệu | Cách lưu |
|---|---|
| Mật khẩu | bcrypt cost 12 |
| API key | bcrypt cost 10 (+ prefix 12 ký tự để tra) |
| Session / reset token / MFA challenge / recovery code | SHA-256 hex |
| License key | SHA-256 hex |
| Webhook secret | plain (cần để ký HMAC) |
| TOTP secret | plain base32 (khuyến nghị mã hoá khi viết lại) |

> bcrypt đồng bộ (bcryptjs) tốn CPU trên Workers; cân nhắc PBKDF2/Argon2 qua Web Crypto hoặc tăng CPU limit.

## 3. Định dạng phản hồi
- Thành công: JSON tuỳ endpoint.
- Lỗi: `{ "error": "<message>" }` + status. Lỗi validate (zod): `{ "error": { formErrors: [], fieldErrors: { field: [msg] } } }`, status 400.
- Lỗi domain có thêm `code` (vd `MX_RECORDS_CONFLICT`).
- Endpoint auth trả header `Cache-Control: no-store`.

## 4. Giới hạn body
`readJsonBody(request, maxBytes)`: từ chối nếu `Content-Length` > max hoặc body thực > max → **413**; body rỗng → `{}`; JSON hỏng → 400.

| Endpoint | Giới hạn |
|---|---|
| login, register, MFA, password reset, webhook, setup | 16 KB |
| draft create/update | 1 MB |
| send (JSON hoặc multipart), `/api/v1/send` | 30 MB |
| inbound relay webhook | 25 MB |

## 5. Xử lý địa chỉ email (`src/lib/email/address.ts`)

| Hàm | Hành vi |
|---|---|
| `parseEmailAddressParts(v)` | `"Name" <a@b>` / `Name <a@b>` → `{name, address}`; khác → `{name:null, address:v.trim()}` |
| `getEmailAddress(v)` | chỉ phần địa chỉ |
| `normalizeEmailAddress(v)` | địa chỉ, trim, lowercase |
| `formatEmailAddress(addr, name?)` | có tên → `"<tên đã escape \ và ">" <addr>`; không → `addr` |
| `getEmailDisplayName(v)` | tên, hoặc local-part |
| `splitEmailAddressList(v)` | tách theo `,` hoặc `;`, **bỏ qua** dấu phân cách nằm trong `"…"` hoặc `<…>` |
| `getEmailAddressList(v)` | các địa chỉ lowercase, loại trùng, giữ thứ tự |
| `joinEmailAddressList(list)` | nối `", "` |
| `getFirstEmailAddressEntry(v)` | phần tử đầu (dùng hiển thị "To") |
| `formatPostalAddressList(list)` | từ postal-mime (kể cả group) → chuỗi nối `", "` |

**Quy tắc bắt buộc**: khi giá trị có thể là danh sách (`to_addr`, `cc_addr`, `bcc_addr`) luôn dùng `splitEmailAddressList`, không dùng `getEmailAddress`.

`parseAddress(v)` (utils): lấy phần trong `<…>` nếu có, khớp `^[^@\s]+@[^@\s]+$`, trả `{local, domain}` lowercase.

## 6. Chuẩn hoá địa chỉ nhận
```
normalizeRecipientLocalPart(lp) = lp.split("+")[0].replaceAll(".", "").toLowerCase()
parseRecipientAddress(addr) = { original, localPart: normalized, domain, normalizedAddress: `${normalized}@${domain}` }
```
Dùng khi so khớp thư đến với mailbox/alias. Xem cảnh báo trong [01-co-ban/06-nhan-thu.md](../01-co-ban/06-nhan-thu.md).

## 7. Message-ID
| Hàm | Hành vi |
|---|---|
| `normalizeMessageId(v)` | trim, bỏ `<` đầu và `>` cuối; rỗng → null |
| `parseMessageIdList(v)` | tách theo khoảng trắng/dấu phẩy, chuẩn hoá, loại trùng |
| `formatMessageIdHeader(ids)` | `<a> <b> <c>` |
| `buildReplyReferences(parentRefs, parentId)` | refs + parent (không lặp); > 30 → giữ phần tử đầu + 29 cuối |

## 8. Snippet
`buildSnippet(text, html, max=200)`: nguồn = `text.trim()` hoặc `htmlToReadableText(html)`; lấy **phần nội dung mới nhất** (bỏ trích dẫn, xem dưới); gộp khoảng trắng; cắt `max`.

`htmlToReadableText`: bỏ `<style|script|head>…`, `<br>` → `\n`, đóng `p|div|li|tr|blockquote|h1-6` → `\n`, bỏ thẻ, giải mã `&nbsp; &amp; &lt; &gt; &quot; &#39;`.

`splitRepliedEmailContent(text)` tách "nội dung mới" và "phần trích dẫn" theo thứ tự ưu tiên:
1. Dòng `-----Original Message-----` (≥2 gạch) → header From/To/Cc/Subject/Date/Sent sau đó.
2. Dòng ≥ 8 dấu `_` (Outlook).
3. Dòng `On … wrote:`.
4. Dòng đầu tiên bắt đầu bằng `>`.
Phần trích dẫn được tách đệ quy (lồng nhau), có `dateLine` và `direction` (`sent` nếu From là địa chỉ của mình).

## 9. Nhật ký lỗi
- Lỗi phụ (routing rule match count, audit log của auth, notify realtime, webhook, auto-reply) **không** được làm hỏng luồng chính → try/catch + `console.error/warn`.
- Lỗi có thể mất dữ liệu (lưu thư, lưu attachment) → ném để queue retry, đồng thời dọn phần đã ghi dở.
