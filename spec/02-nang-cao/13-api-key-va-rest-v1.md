# API key & REST công khai `/api/v1`

> **[NÂNG CAO]** · Phụ thuộc: [00-nen-tang/05-phan-quyen.md §2.2](../00-nen-tang/05-phan-quyen.md) · JMAP dùng cùng API key → [03-tuy-chon/02-jmap.md](../03-tuy-chon/02-jmap.md)

## 1. Mục tiêu
Cho script/ứng dụng bên ngoài gửi thư, đọc thư và quản trị domain bằng khoá bí mật có phạm vi (scope), không cần phiên đăng nhập.

## 2. Ranh giới
| Trong phạm vi | Ngoài phạm vi (chưa có) |
|---|---|
| Tạo, liệt kê key; scope | Thu hồi / xoá key, hết hạn key |
| `POST /api/v1/send`, `GET /api/v1/messages`, `/api/v1/domains/*` | Đổi trạng thái thư, quản lý mailbox qua v1 |
| Quyền mailbox như user sở hữu key | Rate limit riêng cho API |

## 3. Khoá
- Giá trị: `ep_<nanoid>` (24 ký tự). `prefix` = 12 ký tự đầu (index để tra). Lưu `bcrypt(key, 10)`.
- Scope: `send`, `read`, `jmap`, `domains`; `*` = tất cả.
- **Hiển thị một lần** khi tạo.
- Xác thực: `Authorization: Bearer <key>` → tra prefix → `bcrypt.compare` từng ứng viên → user không disabled → cập nhật `last_used_at` (≤1 lần/phút).

## 4. Quản lý key (session)
| Method | Path | Body / Trả về |
|---|---|---|
| GET | `/api/api-keys` | `{apiKeys:[{id, name, prefix, scopes (chuỗi JSON), createdAt, lastUsedAt}]}` của user |
| POST | `/api/api-keys` | `{name (≥1), scopes: [scope] (≥1)}` → `{id, name, prefix, key}` |
UI: trang `/api-keys` (không có link trong menu), mặc định chọn `send` + `read`. Settings → Account → "Email apps" tạo key scope `["jmap"]` cho mail client (xem JMAP).

## 5. Endpoint v1
Lỗi xác thực **và** thiếu scope đều → **401** `{error:"Unauthorized"}`.

### 5.1 `POST /api/v1/send` — scope `send`
JSON ≤ 30 MB, schema như `/api/send` (xem [01-co-ban/11-gui-thu.md §4.1](../01-co-ban/11-gui-thu.md)), attachment dạng:
```json
{ "from": "support@example.com", "mailboxId": "mbx_…",
  "to": ["user@example.net", "\"Maya Chen\" <maya@example.net>"], "cc": "ops@example.com", "bcc": ["audit@example.com"],
  "subject": "Report", "text": "Attached.", "html": "<p>Attached.</p>",
  "inReplyTo": "<CAF1abc@mail.example.net>", "references": ["<CAF0root@…>", "<CAF1abc@…>"],
  "scheduledAt": "2026-10-01T08:00:00Z",
  "attachments": [ { "filename": "report.pdf", "type": "application/pdf", "contentBase64": "<base64>" } ] }
```
`contentBase64` ≤ 14 MB chuỗi, giải mã (bỏ khoảng trắng) → `disposition: attachment`. Trả `{messageId, scheduled?}`; lỗi người gửi 400/403, khác 500.

### 5.2 `GET /api/v1/messages?mailboxId&direction&q&limit` — scope `read`
Phạm vi như danh sách session (§5 phân quyền); `q` dùng cú pháp tìm kiếm đầy đủ; `limit` ≤ 100 (mặc định 50); **không có offset**. Trả `{messages: [dòng messages đầy đủ]}` — *(lưu ý: hiện trả cả `rawR2Key`, nên loại bỏ)*.

### 5.3 `/api/v1/domains` — scope `domains`
Chủ domain hiệu lực như UI (`canManageMailboxes && createdByUserId ? createdByUserId : id`) cho list; get/delete/dns/setup dùng `domain.user_id == key.userId`.
| Method | Path | Mô tả |
|---|---|---|
| GET | `/api/v1/domains` | `{domains, dns: {id: {routing, sending, auth:{mx,spf,dkim,dmarc}}}}` |
| POST | `/api/v1/domains` | `{hostname, enableRouting?, enableSending?, replaceMxRecords?}` → `{domain, dns (kèm audit), changes}`; lỗi 409 `MX_RECORDS_CONFLICT` / 400 |
| GET | `/api/v1/domains/{id}` | domain |
| DELETE | `/api/v1/domains/{id}` | xoá + dọn Cloudflare |
| GET | `/api/v1/domains/{id}/dns` | DNS view + audit đầy đủ |
| POST | `/api/v1/domains/{id}/dns/setup` | `{record: mx|spf|dkim|dmarc}` (khác → 400 "Unknown DNS record") → `{domain, dns}`; lỗi 500 |

## 6. Tiêu chí chấp nhận
- [ ] Key scope `read` gọi `/api/v1/send` → 401.
- [ ] Key của user bị disable → 401.
- [ ] `/api/v1/send` với `from` không thuộc mailbox → 403.
- [ ] `lastUsedAt` được cập nhật khi dùng key.

## 7. Đề xuất khi viết lại
- `DELETE /api/api-keys/{id}` (thu hồi), `expiresAt`, giới hạn mailbox cho key.
- Tách 401 (sai key) / 403 (thiếu scope).
- bcrypt cho API key tốn CPU mỗi request → cân nhắc SHA-256 (key đã đủ entropy) + so sánh constant-time.
