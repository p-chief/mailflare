# Quy ước chung & quy tắc dùng lại

> **[CƠ BẢN]** · Nhóm: Nền tảng · Liên quan: [04-mo-hinh-du-lieu.md](04-mo-hinh-du-lieu.md), [05-phan-quyen.md](05-phan-quyen.md), [08-hang-so-gioi-han.md](08-hang-so-gioi-han.md)

## 1. Quy tắc sinh ID
ID = chuỗi ngẫu nhiên 21 ký tự bảng chữ URL-safe (`A-Za-z0-9_-`, ví dụ: nanoid), có tiền tố `<prefix>_` tuỳ thực thể:

| Tiền tố | Thực thể | Tiền tố | Thực thể |
|---|---|---|---|
| `usr_` | user | `key_` | API key record |
| `dom_` | domain | `ep_` | giá trị API key |
| `mbx_` | mailbox | `wh_` / `whd_` / `whsec_` | webhook / delivery / secret |
| `als_` | alias | `aud_` | audit log |
| `msg_` | message | `mac_` | mailbox access |
| `att_` | attachment | `arp_` | auto-reply delivery |
| `job_` | outbound job | `thr_` | thread (dự phòng) |
| `fld_` | folder | `sess_` | token phiên |
| `rule_` | rule | `prt_` | token reset mật khẩu |
| `bak_` | backup | `mfa_` | login challenge |
| `evt_` | calendar event | `rc_` | recovery code |
| `ts_` | idempotency key Turnstile | | |

Ngoại lệ: contact `"<userId>:<email>"`, rule chặn `"block:<mailboxId>:<email>"`, id dòng session/challenge/password-reset = chuỗi ngẫu nhiên không tiền tố.

## 2. Hash & bí mật
| Dữ liệu | Cách lưu | Cách kiểm tra |
|---|---|---|
| Mật khẩu | bcrypt cost 12 | so bcrypt |
| API key | SHA-256 hex của **toàn bộ** key (+ `prefix` 12 ký tự để tra) | tra theo `prefix`, so SHA-256 bằng so sánh thời gian hằng |
| Session / reset token / MFA challenge / recovery code | SHA-256 hex | tra trực tiếp theo hash (cột UNIQUE) |
| License key (tích hợp tùy chọn) | SHA-256 hex | — |
| Webhook secret | plain (cần để ký HMAC) | — |
| TOTP secret | AES-256-GCM (Web Crypto) bằng `TOTP_ENCRYPTION_KEY`, `additionalData = userId`; lưu `v1:<base64url(iv 12 byte)>:<base64url(ciphertext)>` — xem [02-nang-cao/15-xac-thuc-2-lop.md](../02-nang-cao/15-xac-thuc-2-lop.md) | giải mã khi xác minh mã |

**Quy tắc**: bcrypt (hoặc KDF chậm tương đương) **chỉ** dùng cho mật khẩu do người dùng chọn. Mọi token do hệ thống sinh (API key, session, reset, challenge, recovery code) là chuỗi ngẫu nhiên entropy cao nên dùng SHA-256; mọi phép so sánh hash/chữ ký dùng so sánh thời gian hằng.

Phương án thay thế cho mật khẩu: PBKDF2-HMAC-SHA256 qua Web Crypto (100 000 vòng — mức tối đa Workers hỗ trợ, salt 16 byte), lưu dạng `pbkdf2$sha256$<vòng>$<salt base64>$<hash base64>`. Hệ thống nhận diện thuật toán theo tiền tố chuỗi hash (`$2a$`/`$2b$` = bcrypt, `pbkdf2$` = PBKDF2) để có thể đổi thuật toán mà không vô hiệu hoá mật khẩu cũ.

## 3. Định dạng phản hồi & lỗi
- Thành công: JSON tuỳ endpoint.
- Lỗi: **một envelope chuẩn** cho mọi endpoint:
```json
{ "error": "<message>", "code": "<CODE>" }
```
  `error` luôn có (chuỗi hiển thị được); `code` tuỳ chọn, dạng `UPPER_SNAKE_CASE`, dùng khi client cần rẽ nhánh. Lỗi validate (400) có thể kèm `"fields": { "<field>": ["<msg>", …] }`; khi đó `error` là thông điệp của trường lỗi đầu tiên.
- Endpoint auth trả header `Cache-Control: no-store`.

### 3.1 Ánh xạ status
| Status | Khi nào | `code` mặc định |
|---|---|---|
| 400 | Body/query không hợp lệ, JSON hỏng | `VALIDATION_ERROR` |
| 401 | Chưa xác thực: thiếu/sai session, API key sai | `UNAUTHORIZED` |
| 403 | Đã xác thực nhưng không được phép: thiếu vai trò, thiếu scope (`INSUFFICIENT_SCOPE`), entitlement tắt (`FEATURE_DISABLED`), CSRF (`CSRF_ORIGIN_MISMATCH`) | `FORBIDDEN` |
| 404 | Không tồn tại **hoặc** không có quyền mailbox trên tài nguyên (không tiết lộ tồn tại) | `NOT_FOUND` |
| 409 | Xung đột trạng thái: trùng địa chỉ/hostname, MX của nhà cung cấp khác (`MX_RECORDS_CONFLICT`) | `CONFLICT` |
| 413 | Body vượt giới hạn | `PAYLOAD_TOO_LARGE` |
| 426 | `/api/realtime` không có `Upgrade: websocket` | — |
| 429 | Vượt rate limit (kèm `Retry-After`) | `RATE_LIMITED` |
| 502 | Cloudflare API hoặc binding gửi thư trả lỗi | `UPSTREAM_ERROR` |
| 500 | Lỗi không lường trước (không lộ chi tiết nội bộ: `{"error":"Internal Server Error"}`) | — |

Ngoại lệ ném trong handler được bắt tại một chỗ (middleware ánh xạ lỗi) và chuyển thành envelope trên; không trả stack trace.

## 4. Quy tắc đọc body JSON
Đọc body với giới hạn `maxBytes`: từ chối nếu `Content-Length` > max hoặc body thực > max → **413**; body rỗng → `{}`; JSON hỏng → **400**.

| Endpoint | Giới hạn |
|---|---|
| login, register, MFA, password reset, webhook, setup | 16 KB |
| draft create/update | 1 MB |
| send (JSON hoặc multipart), `/api/v1/send` | 30 MB |
| inbound relay webhook | 25 MB |

## 5. Xử lý địa chỉ email

| Quy tắc | Hành vi |
|---|---|
| **Tách tên và địa chỉ** | `"Name" <a@b>` / `Name <a@b>` → `{name, address}`; khác → `{name: null, address: v.trim()}` |
| **Lấy địa chỉ** | chỉ phần địa chỉ của quy tắc trên |
| **Chuẩn hoá địa chỉ** | lấy địa chỉ, trim, lowercase |
| **Định dạng địa chỉ** | có tên → `"<tên đã escape \ và ">" <addr>`; không → `addr` |
| **Tên hiển thị** | tên nếu có, không thì local-part |
| **Tách danh sách địa chỉ** | tách theo `,` hoặc `;`, **bỏ qua** dấu phân cách nằm trong `"…"` hoặc `<…>`; bỏ phần tử rỗng |
| **Danh sách địa chỉ chuẩn hoá** | tách danh sách → chuẩn hoá từng địa chỉ → loại trùng, giữ thứ tự |
| **Nối danh sách** | nối bằng `", "` |
| **Phần tử đầu** | phần tử đầu của danh sách (dùng hiển thị "To") |
| **Danh sách từ parser MIME** | danh sách địa chỉ do parser trả về (kể cả group) → định dạng từng địa chỉ → nối `", "` |

**Quy tắc bắt buộc**: giá trị có thể là danh sách (`to_addr`, `cc_addr`, `bcc_addr`, trường `to`/`cc`/`bcc` của API) luôn xử lý bằng **Tách danh sách địa chỉ**, không bao giờ bằng **Lấy địa chỉ** (vốn chỉ trả một địa chỉ).

**Phân tích địa chỉ đơn**: lấy phần trong `<…>` nếu có, khớp `^[^@\s]+@[^@\s]+$`, trả `{local, domain}` lowercase; không khớp → không hợp lệ.

## 6. Chuẩn hoá địa chỉ nhận
```
CHUAN_HOA_LOCAL(lp) = lowercase( xoá mọi "." khỏi ( phần của lp trước dấu "+" đầu tiên ) )
PHAN_TICH_DIA_CHI_NHAN(addr) = { original, localPart: CHUAN_HOA_LOCAL(local), domain,
                                 normalizedAddress: `${CHUAN_HOA_LOCAL(local)}@${domain}` }
```
Không phân tích được hoặc local sau chuẩn hoá rỗng → không hợp lệ. Dùng khi so khớp thư đến với mailbox/alias (xem [01-co-ban/06-nhan-thu.md](../01-co-ban/06-nhan-thu.md)).

> **Quyết định thiết kế** — dấu chấm và `+tag` trong local-part.
> - **Mặc định**: bỏ `+tag` **và** bỏ dấu chấm (kiểu Gmail): `John.Doe+news@x.com`, `johndoe@x.com`, `j.o.h.n.doe@x.com` → cùng một mailbox. Hệ quả bắt buộc: khi tạo mailbox/alias, kiểm tra trùng phải so theo `CHUAN_HOA_LOCAL`, nên không thể tồn tại đồng thời `john.doe` và `johndoe` trên cùng domain (409).
> - **Thay thế**: chỉ bỏ `+tag`, giữ dấu chấm (`CHUAN_HOA_LOCAL(lp) = lowercase(phần của lp trước dấu "+" đầu tiên)`); kiểm tra trùng khi tạo theo cùng quy tắc đó.

## 7. Message-ID
| Quy tắc | Hành vi |
|---|---|
| **Chuẩn hoá Message-ID** | trim, bỏ `<` đầu và `>` cuối; rỗng → null |
| **Tách danh sách Message-ID** | tách theo khoảng trắng/dấu phẩy, chuẩn hoá từng id, loại trùng |
| **Định dạng header Message-ID** | `<a> <b> <c>` |
| **Dựng References cho thư trả lời** | References của thư cha + Message-ID thư cha (không lặp); > 30 id → giữ id đầu + 29 id cuối |

## 8. Snippet
**Quy tắc dựng snippet** (`max = 200`): nguồn = `text.trim()` nếu có, không thì **HTML → văn bản đọc được** của `html`; lấy **phần nội dung mới nhất** (bỏ trích dẫn theo quy tắc dưới); gộp khoảng trắng; cắt `max` ký tự.

**HTML → văn bản đọc được**: bỏ `<style|script|head>…`, `<br>` → `\n`, thẻ đóng `p|div|li|tr|blockquote|h1-6` → `\n`, bỏ mọi thẻ còn lại, giải mã `&nbsp; &amp; &lt; &gt; &quot; &#39;`.

**Tách nội dung trả lời** — tách văn bản thành "nội dung mới" và "phần trích dẫn", dấu hiệu theo thứ tự ưu tiên:
1. Dòng `-----Original Message-----` (≥ 2 gạch mỗi bên) → header From/To/Cc/Subject/Date/Sent ngay sau đó.
2. Dòng ≥ 8 dấu `_` (Outlook).
3. Dòng `On … wrote:`.
4. Dòng đầu tiên bắt đầu bằng `>`.

Phần trích dẫn được tách đệ quy (lồng nhau); mỗi phần có `dateLine` và `direction` (`sent` nếu From là một địa chỉ của chính mailbox, ngược lại `received`).

## 9. Nhật ký lỗi
- Lỗi phụ (cập nhật match count của routing rule, audit log của auth, notify realtime, webhook, auto-reply) **không** được làm hỏng luồng chính → bắt lỗi + `console.error`/`console.warn`.
- Lỗi có thể mất dữ liệu (lưu thư, lưu attachment) → ném để queue retry, đồng thời dọn phần đã ghi dở.

## 10. Ghi chú triển khai
- bcrypt cost 12 chạy thuần JavaScript tốn đáng kể CPU trên Workers; khi gặp giới hạn CPU, dùng phương án PBKDF2 ở §2 hoặc nâng CPU limit của Worker.
- So sánh thời gian hằng: so độ dài trước, rồi XOR từng byte và cộng dồn; hoặc dùng `crypto.subtle.timingSafeEqual` nếu runtime hỗ trợ.
