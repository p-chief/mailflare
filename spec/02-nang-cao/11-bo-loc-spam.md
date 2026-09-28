# Bộ lọc spam cục bộ

> **[NÂNG CAO]** · Phụ thuộc: [01-co-ban/06-nhan-thu.md](../01-co-ban/06-nhan-thu.md) (bước 7–8), [01-co-ban/09-to-chuc-thu.md](../01-co-ban/09-to-chuc-thu.md) (phản hồi) · Liên quan: [10-danh-ba-va-chan.md](10-danh-ba-va-chan.md), [01-rule-mailbox.md](01-rule-mailbox.md), [18-nhat-ky-audit.md](18-nhat-ky-audit.md)

## 1. Mục tiêu
Chấm điểm 0–100 cho mỗi thư đến bằng tín hiệu cục bộ (không gửi nội dung ra ngoài), đưa thư điểm cao vào Spam, và **học** từ các thao tác "Report spam" / "Not spam" của người dùng theo từng mailbox.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Phân tích thư đã chấp nhận (sau SMTP) | Từ chối ở tầng SMTP |
| Tín hiệu xác thực, quan hệ, uy tín, Bayes, cấu trúc, URL | Danh sách đen DNS (RBL), dịch vụ chấm điểm bên ngoài |
| Học theo mailbox từ phản hồi tường minh | Học ngầm (đọc/xoá không tính) |
| Thư được lưu vào mailbox | Thư chỉ forward (không lưu) — không phân tích |

## 3. Bật/tắt
- Cột `users.spam_protection_enabled` (mặc định true) — áp theo **owner** của mailbox nhận thư (kể cả shared mailbox).
- `GET /api/settings/spam` → `{enabled}`; `PATCH /api/settings/spam {enabled: boolean}` (session; body sai → 400) → `{enabled}`.
- Chỉ ảnh hưởng thư mới; không quét lại thư cũ.
- UI: Settings → Inbox → "Spam Filter — Analyze incoming messages locally and detect high-confidence spam".

## 4. Dữ liệu
- Cột trên `messages`: `spam_score`, `spam_verdict` (`inbox|suspicious|spam`), `spam_signals` (JSON), `spam_analyzed_at`, `spam_analysis_error` (≤300).
- Bảng `spam_token_stats`, `spam_reputation`, `spam_feedback` — xem [00-nen-tang/04-mo-hinh-du-lieu.md §3.12](../00-nen-tang/04-mo-hinh-du-lieu.md).

## 5. Chuẩn bị nội dung

### 5.1 Văn bản hiển thị của HTML — `VAN_BAN_HTML(html)`
Bỏ nguyên khối `<script>`, `<style>`, `<head>`; thay `<br>`, `</p>`, `</div>`, `</li>`, `</tr>`, `</h1>`…`</h6>` bằng xuống dòng; bỏ mọi thẻ còn lại; giải mã entity HTML (`&amp;`, `&nbsp;`, `&#…;`); gộp khoảng trắng liên tiếp trong một dòng.

### 5.2 Đầu vào đã chuẩn bị
```
visibleText = (subject + "\n" + text + "\n" + VAN_BAN_HTML(html))[:250000]
urlDomains  = hostname (lowercase, bỏ tiền tố "www.") của mọi URL http(s) trong (text + html)[:250000],
              không trùng, tối đa 50
sender      = địa chỉ (header From, nếu không có → envelope from), lowercase
senderDomain = phần sau "@" của sender
```

### 5.3 Token (tối đa 500, không trùng)
- Từ trong `lowercase(visibleText)` khớp `[\p{L}\p{N}][\p{L}\p{N}_$%.-]{1,48}`, bỏ `.`, `_`, `-` ở hai đầu, giữ nếu độ dài 2–50.
- `SUBJECT:<từ>` cho mỗi từ của tiêu đề (lowercase, 2–40 ký tự chữ/số).
- `FROM:<sender>`, `FROM_DOMAIN:<senderDomain>`, `URL_DOMAIN:<d>` cho mỗi domain trong `urlDomains`.
- `HTML_ONLY` nếu có html mà text rỗng; `HAS_ATTACHMENT` nếu thư có file đính kèm.

### 5.4 Fingerprint
FNV-1a 32-bit (hex thường, 8 ký tự) của chuỗi:
```
lowercase(subject) gộp khoảng trắng, cắt 160 ký tự
+ "|" + senderDomain
+ "|" + urlDomains đã sắp xếp, nối bằng ","
+ "|" + lowercase(visibleText) thay mọi chữ số bằng "#", gộp khoảng trắng, cắt 500 ký tự
```

### 5.5 Khoá uy tín
`email:<sender>`, `domain:<senderDomain>`, `fingerprint:<fp>` — ứng với `spam_reputation.type` = `email` | `domain` | `fingerprint`.

## 6. Tín hiệu & điểm
| Nhóm | ID tín hiệu | Điểm | Điều kiện |
|---|---|---|---|
| Xác thực (chỉ tin header `Authentication-Results` có authserv-id kết thúc bằng `cloudflare.com` hoặc `cloudflare.net`; header khác bị bỏ qua) | `dmarc_passed` / `dmarc_failed` | −8 / +18 | `dmarc=pass` / `dmarc=fail` |
| | `dkim_passed` / `dkim_failed` | −4 / +8 | `dkim=pass` / `dkim=fail` |
| | `spf_passed` / `spf_failed` | −2 / +6 | `spf=pass` / `spf=fail` |
| Quan hệ (danh bạ của owner mailbox) | `blocked_sender` | **100, dừng ngay** | contact của `sender` có `blocked = true` |
| | `manual_contact` | −15 | contact `source = manual` |
| | `previously_sent` | −25 | contact `source = outbound` |
| Uy tín (theo mailbox; chỉ xét khoá có `spam_count + ham_count ≥ 3`; `ratio = (spam+1)/(spam+ham+2)`) | `poor_<type>_reputation` | +25 | ratio ≥ 0.8 |
| | `good_<type>_reputation` | −15 | ratio ≤ 0.2 |
| | *trong nhóm uy tín chỉ giữ **một** tín hiệu có \|điểm\| lớn nhất* | | |
| Bayes | `bayesian_spam` / `bayesian_ham` | ±≤30 | §7 |
| Cấu trúc | `empty_subject` | +3 | subject rỗng (sau trim) |
| | `thin_html_only` | +6 | có html, không có text, văn bản hiển thị < 80 ký tự |
| | `zero_width_text` | +7 | chứa ký tự `U+200B–U+200D`, `U+2060`, `U+FEFF` |
| | `excessive_capitals` | +4 | > 40 chữ cái và > 65% trong số đó là chữ hoa |
| | `reply_to_mismatch` | +5 | domain của `Reply-To` ≠ `senderDomain` |
| | `credential_phishing_pattern` | +24 | (từ xác minh/đăng nhập `verify\|confirm\|validate\|log in\|login\|sign in` nằm trong khoảng ≤ 60 ký tự quanh `account\|password\|credentials`) **và** từ khẩn cấp (`urgent`, `immediately`, `within 24 hours`, `suspended`, `expires today`, `final warning`) **và** có ít nhất một link |
| | `payment_scam_pattern` | +16 | (`gift card` / `wire transfer` / `crypto` / `bitcoin` / `wallet` / `bank transfer`) **và** động từ thanh toán (`pay`, `send`, `transfer`, `buy`, `purchase`, `deposit`) **và** (từ khẩn cấp **hoặc** `reply_to_mismatch`) |
| | `risky_attachment` | +10 | có file đuôi `.exe .scr .js .vbs .bat .cmd .iso .img` |
| URL | `ip_address_url` | +8 | link có host là địa chỉ IPv4 |
| | `punycode_url` | +5 | domain link chứa `xn--` |
| | `many_link_domains` | `min(8, n − 8)` | `n = số domain link > 10` |
| | `displayed_link_mismatch` | +10 | `<a href="http…">http…</a>` mà hostname của chữ hiển thị ≠ hostname đích (xét cặp đầu tiên tìm thấy) |
| Biên | `score_boundary` | bù phần vượt | tổng ngoài 0–100 |

- Mọi so khớp từ khoá không phân biệt hoa thường, trên `visibleText`.
- `score = clamp(Σ điểm, 0, 100)`; khi bị kẹp, thêm tín hiệu `score_boundary` với điểm bằng phần bù.
- Lưu vào `spam_signals` các tín hiệu có |điểm| ≥ 2 (luôn giữ `score_boundary`), mỗi phần tử `{id, score, reason, metadata?}`.
- **Verdict**: `score ≥ 70 → spam`, `40–69 → suspicious`, `< 40 → inbox`.

## 7. Bayes (theo mailbox)
```
spamTotal / hamTotal = số dòng spam_feedback của mailbox theo classification
nếu spamTotal = 0 hoặc hamTotal = 0 hoặc không có token → không đóng góp
rows = spam_token_stats WHERE mailbox_id = ? AND token IN (tokens)     -- truy vấn theo lô 90 token
với mỗi token có dòng:
   sr = (spam_count + 1) / (spamTotal + 2)
   hr = (ham_count + 1)  / (hamTotal + 2)
   p  = clamp( sr / (sr + hr), 0.1, 0.9 )
chọn 20 token có |p − 0.5| lớn nhất
P = Π p / (Π p + Π (1 − p))
contribution = round( (P − 0.5) · 30 · 2 · min(1, min(spamTotal, hamTotal) / 20) )
contribution > 0 → bayesian_spam; < 0 → bayesian_ham; = 0 → không có tín hiệu
```
Tín hiệu kèm metadata `{probability: P, trainedMessages: spamTotal + hamTotal}`.

## 8. Áp dụng trong pipeline nhận thư
Chạy sau khi đã xác định mailbox và kết quả rule mailbox (xem [01-co-ban/06-nhan-thu.md](../01-co-ban/06-nhan-thu.md)), chỉ khi owner bật bộ lọc:
1. Lỗi khi phân tích → ghi `spam_analysis_error` (≤300 ký tự), các cột điểm để null, thư giao bình thường.
2. Rule mailbox đưa vào spam → ghi đè `spam_score = 100`, verdict `spam`, thêm tín hiệu `mailbox_rule_spam`.
3. Thư đang `received` + verdict `spam` → `status = 'spam'`, `folder_id = null`; **không** trả lời tự động, **không** gửi thông báo realtime (webhook `message.inbound` vẫn phát).
4. Mỗi thư được phân tích ghi nhận quan sát uy tín: với 3 khoá ở §5.5, upsert `spam_reputation(mailbox_id, type, key)` với `messages_seen += 1`, `last_seen_at = now` (`first_seen_at` khi tạo mới) — một batch D1.
5. Ghi log JSON `{messageId, spamScore, verdict, signals: [id…]}`.

## 9. Huấn luyện — thủ tục `HOC_PHAN_HOI(user, messageId, phanLoai ∈ {spam, ham})`
Được gọi bởi: bulk action `spam`; đổi status đơn thành `spam`; bulk action `inbox` hoặc đổi status thành `received` trên thư **đang** `spam` (→ `ham`). Xem [01-co-ban/09-to-chuc-thu.md](../01-co-ban/09-to-chuc-thu.md).
```
msg = messages WHERE id = messageId
msg không phải thư đến, không có mailbox_id, hoặc user không có quyền full_access trên mailbox → trả false (không làm gì)
previous  = spam_feedback WHERE message_id = messageId
newStatus = phanLoai == spam ? 'spam' : 'received'
nếu previous.classification == phanLoai:
    UPDATE messages SET status = newStatus, folder_id = NULL; return true     -- không học lần 2
tokens, keys = previous ? (previous.training_tokens, previous.reputation_keys)
                        : tính lại theo §5 từ nội dung đã lưu của thư (subject, text, html, from, file đính kèm, header)
một batch D1 (một giao dịch):
   nếu previous: trừ 1 khỏi cột của phân loại cũ (spam_count hoặc ham_count, MAX(0, …)) cho mọi token và mọi khoá uy tín
   cộng 1 vào cột của phân loại mới cho mọi token (spam_token_stats, upsert) và mọi khoá (spam_reputation, upsert)
   UPSERT spam_feedback { message_id, mailbox_id, actor_user_id: user.id, classification: phanLoai,
                          training_tokens, reputation_keys, tokenizer_version: 1, updated_at: now }
   UPDATE messages SET status = newStatus, folder_id = NULL
ghi audit 'email.spam_feedback' {classification: phanLoai}
return true
```
Đổi ý → hoàn tác lần học trước rồi học lại; bấm lặp cùng phân loại → không học 2 lần.

## 10. Hiển thị
Chi tiết thư: "Spam score: {score} · {verdict}" hoặc "Spam analysis unavailable" (khi có `spam_analysis_error`); phần mở rộng "Why {APP_NAME} gave this score" liệt kê `+N reason` (đỏ) / `−N reason` (xanh); không có tín hiệu → "No significant spam signals were found." Thư chưa phân tích (bộ lọc tắt) → không hiển thị khối này.

## 11. Lỗi & biên
- Không có header `Authentication-Results` tin cậy → bỏ qua cả nhóm xác thực (không cộng/trừ).
- `blocked_sender` dừng ngay: không chạy các tín hiệu còn lại, điểm 100.
- Thư không có `mailbox_id` (bị reject/forward) → không phân tích, không học.
- Huấn luyện là một giao dịch: lỗi giữa chừng → không thay đổi bảng thống kê lẫn status.

## 12. Tiêu chí chấp nhận
- [ ] Thư DMARC fail + link phishing khẩn cấp → điểm ≥ 70 → Spam, không thông báo realtime.
- [ ] Người gửi mà mình đã từng gửi thư tới → −25.
- [ ] Report spam 20 thư + Not spam 20 thư cùng mailbox → Bayes đóng góp đầy đủ (hệ số 1).
- [ ] Report spam rồi Not spam cùng thư → `spam_count` của mọi token/khoá trở về như trước khi report, `ham_count` tăng 1.
- [ ] Report spam hai lần cùng thư → thống kê chỉ tăng một lần.
- [ ] Tắt bộ lọc → thư mới không có `spam_score`.
- [ ] Header `Authentication-Results` giả mạo (authserv-id khác Cloudflare) → không ảnh hưởng điểm.
