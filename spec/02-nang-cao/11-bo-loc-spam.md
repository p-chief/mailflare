# Bộ lọc spam cục bộ

> **[NÂNG CAO]** · Phụ thuộc: [01-co-ban/06-nhan-thu.md](../01-co-ban/06-nhan-thu.md) (bước 7–8), [01-co-ban/09-to-chuc-thu.md](../01-co-ban/09-to-chuc-thu.md) (phản hồi)
> Nguồn: `src/lib/spam/**`, `docs/spam-protection.md`

## 1. Mục tiêu
Chấm điểm 0–100 cho mỗi thư đến bằng tín hiệu cục bộ (không gửi nội dung ra ngoài), đưa thư điểm cao vào Spam, và **học** từ các thao tác "Report spam" / "Not spam" của người dùng theo từng mailbox.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Phân tích thư đã chấp nhận (sau SMTP) | Từ chối ở tầng SMTP |
| Tín hiệu xác thực, quan hệ, uy tín, Bayes, cấu trúc, URL | Danh sách đen DNS (RBL), dịch vụ bên ngoài (có interface `SpamIntelligenceProvider` nhưng bản local trả rỗng) |
| Học theo mailbox từ phản hồi tường minh | Học ngầm (đọc/xoá không tính) |
| Thư forward-only | Không được phân tích (không lưu) |

## 3. Bật/tắt
`users.spam_protection_enabled` (mặc định true) — theo **owner** mailbox. `GET/PATCH /api/settings/spam {enabled}` (session, 400 nếu body sai). Chỉ ảnh hưởng thư mới; không quét lại thư cũ. UI: Settings → Inbox → "Spam Filter — Analyze incoming messages locally and detect high-confidence spam".

## 4. Chuẩn bị nội dung
```
prepared.visibleText = (subject + "\n" + text + "\n" + htmlToReadableText(html))[:250000]
prepared.urlDomains  = hostname (bỏ "www.") của mọi URL http(s) trong text+html (≤250000 ký tự), tối đa 50, không trùng
sender               = address(header From ?? envelope from).lower
```
**Token** (`tokenizeMessage`, tối đa 500):
- từ trong `visibleText.lower` khớp `[\p{L}\p{N}][\p{L}\p{N}_$%.-]{1,48}`, bỏ `._-` ở hai đầu, độ dài 2–50;
- `SUBJECT:<từ>` (2–40 ký tự chữ/số) cho mỗi từ tiêu đề;
- `FROM:<sender>`, `FROM_DOMAIN:<domain>`, `URL_DOMAIN:<d>` mỗi domain link;
- `HTML_ONLY` nếu có html mà text rỗng; `HAS_ATTACHMENT` nếu có file.

**Fingerprint** (`buildFingerprint`): FNV-1a 32-bit (hex 8 ký tự) của `subject.lower gộp khoảng trắng[:160] | domain người gửi | urlDomains đã sắp nối "," | visibleText.lower thay số bằng "#" gộp khoảng trắng[:500]`.

**Khoá uy tín**: `email:<sender>`, `domain:<domain>`, `fingerprint:<fp>`.

## 5. Tín hiệu & điểm
| Nhóm | ID tín hiệu | Điểm | Điều kiện |
|---|---|---|---|
| Xác thực (chỉ tin header `Authentication-Results` có authserv-id kết thúc `cloudflare.com` hoặc `cloudflare.net`) | `dmarc_passed` / `dmarc_failed` | −8 / +18 | `dmarc=pass|fail` |
| | `dkim_passed` / `dkim_failed` | −4 / +8 | |
| | `spf_passed` / `spf_failed` | −2 / +6 | |
| Quan hệ | `blocked_sender` | **100, dừng ngay** | contact `blocked` |
| | `manual_contact` | −15 | contact `source=manual` |
| | `previously_sent` | −25 | contact `source=outbound` |
| Uy tín (mailbox; chỉ khi `spam+ham ≥ 3`; `ratio = (spam+1)/(spam+ham+2)`) | `poor_<type>_reputation` | +25 | ratio ≥ 0.8 |
| | `good_<type>_reputation` | −15 | ratio ≤ 0.2 |
| | *chỉ giữ tín hiệu uy tín có |điểm| lớn nhất* | | |
| Bayes | `bayesian_spam` / `bayesian_ham` | ±≤30 | §6 |
| Cấu trúc | `empty_subject` | +3 | subject rỗng |
| | `thin_html_only` | +6 | có html, không text, văn bản hiển thị < 80 ký tự |
| | `zero_width_text` | +7 | có ký tự `U+200B–200D, U+2060, U+FEFF` |
| | `excessive_capitals` | +4 | > 40 chữ cái và > 65% chữ hoa |
| | `reply_to_mismatch` | +5 | domain `Reply-To` ≠ domain From |
| | `credential_phishing_pattern` | +24 | (từ xác minh/đăng nhập ≤60 ký tự gần từ tài khoản/mật khẩu) **và** từ khẩn cấp (`urgent, immediately, within 24 hours, suspended, expires today, final warning`) **và** có link |
| | `payment_scam_pattern` | +16 | (gift card/wire transfer/crypto/bitcoin/wallet/bank transfer) **và** động từ thanh toán **và** (khẩn cấp hoặc Reply-To lệch) |
| | `risky_attachment` | +10 | file `.exe .scr .js .vbs .bat .cmd .iso .img` |
| URL | `ip_address_url` | +8 | link dùng IPv4 |
| | `punycode_url` | +5 | domain chứa `xn--` |
| | `many_link_domains` | `min(8, n−8)` | > 10 domain link |
| | `displayed_link_mismatch` | +10 | `<a href="http…">http…</a>` mà hostname hiển thị ≠ đích (lấy lần đầu) |
| Biên | `score_boundary` | bù | tổng ngoài 0–100 |

`score = clamp(Σ, 0, 100)`; lưu tín hiệu có |điểm| ≥ 2 (và `score_boundary`).
**Verdict**: `≥ 70 → spam`, `40–69 → suspicious`, `< 40 → inbox`.

## 6. Bayes (theo mailbox)
```
spamTotal/hamTotal = số dòng spam_feedback của mailbox theo phân loại
nếu một trong hai = 0 hoặc không có token → không đóng góp
rows = spam_token_stats(mailbox, token IN tokens)   (truy vấn theo lô 90)
p(token) = clamp( sr/(sr+hr), 0.1, 0.9 ),  sr = (spam+1)/(spamTotal+2), hr = (ham+1)/(hamTotal+2)
chọn 20 token có |p − 0.5| lớn nhất
P = Π p / (Π p + Π (1−p))
contribution = round( (P − 0.5)·30·2 · min(1, min(spamTotal, hamTotal)/20) )
```
Tín hiệu kèm metadata `{probability, trainedMessages}`.

## 7. Áp dụng trong pipeline
- Lỗi phân tích → `spam_analysis_error` (≤300 ký tự), thư giao bình thường.
- Rule mailbox → spam: ghi đè `score 100`, verdict spam, tín hiệu `mailbox_rule_spam`.
- `received` + verdict spam → `status = spam`, `folderId = null`; không auto-reply, không realtime (vẫn webhook).
- Mỗi thư được phân tích: `recordReputationObservation` → upsert `spam_reputation(mailbox, type, key)` `messages_seen += 1`, `last_seen_at` (1 batch).
- Log JSON `{messageId, spamScore, verdict, signals:[ids]}`.

## 8. Huấn luyện — `applySpamFeedback(user, messageId, 'spam'|'ham')`
Kích hoạt bởi: bulk `spam`, status `spam`; bulk `inbox` / status `received` trên thư đang `spam`.
```
message inbound có mailbox, user canManage → khác: false
previous = spam_feedback(messageId)
status = classification == spam ? 'spam' : 'received'
previous.classification == classification → chỉ UPDATE status, folderId=null; return
tokens/keys = previous ? (đã lưu) : tính lại từ nội dung đã lưu trong messages
batch D1 (1 giao dịch):
   nếu previous: trừ 1 khỏi spam_count/ham_count cũ cho mọi token & key (MAX(0,…))
   cộng 1 cho phân loại mới (token_stats & reputation)
   UPSERT spam_feedback {message_id, mailbox_id, actor, classification, training_tokens, reputation_keys, tokenizer_version 1}
   UPDATE messages SET status, folder_id = NULL
audit 'email.spam_feedback' {classification}
```
Đổi ý → hoàn tác lần học trước rồi học lại; bấm lặp cùng phân loại → không học 2 lần.

## 9. Hiển thị
Chi tiết thư: "Spam score: {score} · {verdict}" hoặc "Spam analysis unavailable"; mở rộng "Why Mailflare gave this score" liệt kê `+N reason` (đỏ) / `−N reason` (xanh); không tín hiệu → "No significant spam signals were found."

## 10. Tiêu chí chấp nhận
- [ ] Thư DMARC fail + link phishing khẩn cấp → điểm ≥ 70 → Spam, không popup.
- [ ] Người gửi mình đã từng gửi thư tới → −25.
- [ ] Report spam 20 thư + Not spam 20 thư cùng mailbox → Bayes bắt đầu đóng góp đầy đủ.
- [ ] Report spam rồi Not spam cùng thư → bảng thống kê trở về như trước khi report.
- [ ] Tắt bộ lọc → thư mới không có `spam_score`.
