# API key & REST công khai `/api/v1`

> **[NÂNG CAO]** · Phụ thuộc: [00-nen-tang/05-phan-quyen.md §2.2](../00-nen-tang/05-phan-quyen.md) · Liên quan: JMAP dùng cùng API key → [03-tuy-chon/02-jmap.md](../03-tuy-chon/02-jmap.md), [01-co-ban/11-gui-thu.md](../01-co-ban/11-gui-thu.md), [01-co-ban/04-quan-ly-domain.md](../01-co-ban/04-quan-ly-domain.md)

## 1. Mục tiêu
Cho script/ứng dụng bên ngoài gửi thư, đọc thư và quản trị domain bằng khoá bí mật có phạm vi (scope) và có thể hết hạn/thu hồi, không cần phiên đăng nhập.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Tạo, liệt kê, thu hồi key; scope; hạn dùng tuỳ chọn | Giới hạn key vào một số mailbox |
| `POST /api/v1/send`, `GET /api/v1/messages`, `/api/v1/domains/*` | Đổi trạng thái thư, quản lý mailbox qua v1 |
| Quyền mailbox như user sở hữu key | Rate limit riêng cho API |

## 3. Dữ liệu — bảng `api_keys`
| Cột | Ý nghĩa |
|---|---|
| `id` | `key_…` |
| `user_id` | FK users CASCADE |
| `name` | 1–100 ký tự |
| `prefix` | 12 ký tự đầu của key, có index — dùng để tra ứng viên |
| `key_hash` | hex(SHA-256(key)) |
| `scopes` | JSON array |
| `expires_at` | ts null — null = không hết hạn |
| `created_at`, `last_used_at` | |

## 4. Khoá
- Giá trị: `ep_` + 21 ký tự ngẫu nhiên (bảng `A-Za-z0-9_-`, ~126 bit) — tổng 24 ký tự. Entropy đủ lớn nên dùng SHA-256 (không cần hàm băm chậm như bcrypt).
- Scope: `send`, `read`, `jmap`, `domains`; `*` = tất cả.
- **Hiển thị một lần** khi tạo; server chỉ giữ `prefix` và `key_hash`.

### 4.1 Xác thực — `XAC_THUC_API_KEY(request, scopeCanCo)`
```
key = header "Authorization: Bearer <key>"       (JMAP còn nhận Basic, xem file JMAP)
key không bắt đầu "ep_"                            → 401
candidates = api_keys WHERE prefix = key[0:12]
row = candidate có key_hash == hex(SHA-256(key))   (so sánh constant-time từng ứng viên)
!row                                               → 401
row.expires_at != null && row.expires_at ≤ now     → 401
user = users WHERE id = row.user_id; !user || user.disabled → 401
!(scopes chứa scopeCanCo || scopes chứa "*")       → 403
last_used_at null hoặc cũ hơn 60 s → UPDATE last_used_at = now
```
| Tình huống | Mã | Body |
|---|---|---|
| Thiếu header, key sai, key đã thu hồi, key hết hạn, user bị disable/không tồn tại | **401** | `{error: "Unauthorized"}` |
| Key hợp lệ nhưng thiếu scope | **403** | `{error: "Missing required scope: <scope>"}` |

## 5. Quản lý key (session)
| Method | Path | Body / Trả về |
|---|---|---|
| GET | `/api/api-keys` | `{apiKeys:[{id, name, prefix, scopes (mảng), createdAt, lastUsedAt, expiresAt}]}` của user, sắp `created_at DESC` |
| POST | `/api/api-keys` | `{name (1–100), scopes: [scope] (≥1, không trùng), expiresAt? (ISO 8601)}` → 201 `{id, name, prefix, key, scopes, expiresAt}`; `expiresAt` ≤ now → 400 "Expiry must be in the future" |
| DELETE | `/api/api-keys/{id}` | key phải thuộc user (khác/không có → 404 "API key not found"); xoá dòng → `{ok: true}`. Thu hồi có hiệu lực ngay ở request kế tiếp |

UI: trang `/api-keys` — bảng key (tên, prefix, scope, tạo lúc, dùng lần cuối, hết hạn — key đã hết hạn gắn nhãn "Expired"), nút "Revoke" (hộp xác nhận), dialog tạo key (mặc định chọn `send` + `read`, tuỳ chọn hạn dùng: Never / 30 / 90 / 365 ngày → quy ra `expiresAt`), hiện key một lần kèm nút copy. Settings → Account → "Email apps" tạo key scope `["jmap"]` cho mail client (xem JMAP).

## 6. Endpoint v1

### 6.1 `POST /api/v1/send` — scope `send`
JSON ≤ 30 MB, schema như `/api/send` (xem [01-co-ban/11-gui-thu.md §4.1](../01-co-ban/11-gui-thu.md)), attachment dạng base64:
```json
{ "from": "support@example.com", "mailboxId": "mbx_…",
  "to": ["user@example.net", "\"Maya Chen\" <maya@example.net>"], "cc": "ops@example.com", "bcc": ["audit@example.com"],
  "subject": "Report", "text": "Attached.", "html": "<p>Attached.</p>",
  "inReplyTo": "<CAF1abc@mail.example.net>", "references": ["<CAF0root@…>", "<CAF1abc@…>"],
  "scheduledAt": "2026-10-01T08:00:00Z",
  "attachments": [ { "filename": "report.pdf", "type": "application/pdf", "contentBase64": "<base64>" } ] }
```
`contentBase64` ≤ 14 MB chuỗi, giải mã sau khi bỏ khoảng trắng → `disposition: attachment`. Trả `{messageId, scheduled?}`; lỗi người gửi (không có quyền gửi từ `from`/mailbox) 400/403, lỗi khác 500.

### 6.2 `GET /api/v1/messages` — scope `read`
| Tham số | Quy tắc |
|---|---|
| `mailboxId` | tuỳ chọn; phải `canRead` → nếu không 404 "Mailbox not found" |
| `direction` | `inbound` \| `outbound` (tuỳ chọn) |
| `q` | cú pháp tìm kiếm đầy đủ ([01-co-ban/14-tim-kiem.md](../01-co-ban/14-tim-kiem.md)) |
| `limit` | 1–100, mặc định 50 |
| `cursor` | chuỗi mờ lấy từ `nextCursor` của trang trước |
| `offset` | ≥ 0; không được dùng cùng `cursor` (cả hai → 400 "Use either cursor or offset") |

- Phạm vi như danh sách thư phiên ([00-nen-tang/05-phan-quyen.md §5.1](../00-nen-tang/05-phan-quyen.md)).
- Thứ tự `created_at DESC, id DESC`. `cursor` = base64url(`<created_at ms>:<id>`) của dòng cuối trang; trang sau lấy các dòng `(created_at, id) < (cursor)`. Cursor không giải mã được → 400 "Invalid cursor".
- Trả `{messages, nextCursor}` — `nextCursor = null` khi hết. Mỗi phần tử có cùng tập trường như danh sách thư phiên ([01-co-ban/07-danh-sach-dem-thu.md](../01-co-ban/07-danh-sach-dem-thu.md)); **không bao giờ** có `rawR2Key`.

### 6.3 `/api/v1/domains` — scope `domains`
- Liệt kê: domain của **chủ domain hiệu lực** của user sở hữu key (`can_manage_mailboxes && created_by_user_id ? created_by_user_id : id`, xem [00-nen-tang/05-phan-quyen.md §3.1](../00-nen-tang/05-phan-quyen.md)).
- Lấy/xoá/DNS/setup: domain phải có `domains.user_id = key.user_id`, nếu không 404 "Domain not found".

| Method | Path | Mô tả |
|---|---|---|
| GET | `/api/v1/domains` | `{domains, dns: {<id>: {routing, sending, auth:{mx,spf,dkim,dmarc}}}}` |
| POST | `/api/v1/domains` | `{hostname, enableRouting?, enableSending?, replaceMxRecords?}` → `{domain, dns (kèm audit), changes}`; lỗi 409 `MX_RECORDS_CONFLICT` / 400 |
| GET | `/api/v1/domains/{id}` | domain |
| DELETE | `/api/v1/domains/{id}` | xoá + dọn tài nguyên Cloudflare |
| GET | `/api/v1/domains/{id}/dns` | DNS view + audit đầy đủ ([17-kiem-tra-dns.md](17-kiem-tra-dns.md)) |
| POST | `/api/v1/domains/{id}/dns/setup` | `{record: mx\|spf\|dkim\|dmarc}` (khác → 400 "Unknown DNS record") → `{domain, dns}`; lỗi Cloudflare → 500 |

## 7. Lỗi & biên
- Nhiều key có cùng `prefix` (xác suất rất thấp) vẫn đúng vì so sánh toàn bộ hash của từng ứng viên.
- Xoá user → key bị xoá theo cascade; disable user → key bị từ chối ngay (không cần xoá).
- Cập nhật `last_used_at` lỗi → không làm hỏng request.

## 8. Tiêu chí chấp nhận
- [ ] Key scope `read` gọi `/api/v1/send` → 403 `Missing required scope: send`.
- [ ] Key sai hoặc đã thu hồi → 401.
- [ ] Key có `expiresAt` đã qua → 401.
- [ ] Key của user bị disable → 401.
- [ ] `/api/v1/send` với `from` không thuộc mailbox → 403.
- [ ] `lastUsedAt` được cập nhật khi dùng key (tối đa 1 lần/phút).
- [ ] Duyệt `/api/v1/messages` bằng `nextCursor` đến hết → mỗi thư xuất hiện đúng một lần; không phần tử nào có `rawR2Key`.
- [ ] DB chỉ chứa SHA-256 của key, không chứa key.
