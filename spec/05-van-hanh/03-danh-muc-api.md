# Danh mục API

> Quyền: **P** public · **S** phiên (cookie `ep_session`) · **A** admin · **K(scope)** API key · **H** chữ ký HMAC. Nhãn: **C** cơ bản · **N** nâng cao · **T** tùy chọn. Cột "Spec" trỏ tới file đặc tả chi tiết.
>
> Mọi request ghi dùng quyền S/A phải kèm header `Origin` hợp lệ ([05-van-hanh/01 BM-02](01-bay-va-cai-thien.md)). "canRead / canManage / chủ …" là điều kiện quyền mailbox bổ sung ([00-nen-tang/05](../00-nen-tang/05-phan-quyen.md)).

## 1. Setup & xác thực
| Method | Path | Quyền | Nhãn | Spec |
|---|---|---|---|---|
| GET | `/api/setup/status` | P | C | [01-co-ban/01](../01-co-ban/01-khoi-tao-he-thong.md) |
| POST | `/api/setup/prepare` | P (DB trống, chưa có admin) | C | 〃 |
| POST | `/api/setup/domain`, `/api/setup/domain/mx` | P (chưa có admin) | C | 〃 |
| POST | `/api/auth/register` | P (chưa có admin) | C | 〃 |
| POST | `/api/auth/login` | P | C | [01-co-ban/02](../01-co-ban/02-dang-nhap-phien.md) |
| POST | `/api/auth/logout` | S | C | 〃 |
| GET | `/api/auth/me` | S | C | 〃 |
| POST | `/api/auth/mfa/verify` | P + challenge | N | [02-nang-cao/15](../02-nang-cao/15-xac-thuc-2-lop.md) |
| POST | `/api/auth/password-reset/request`, `/confirm` | P | N | [02-nang-cao/14](../02-nang-cao/14-quen-mat-khau.md) |
| WS | `/api/realtime` | S (cookie) | N | [02-nang-cao/04](../02-nang-cao/04-realtime.md) |

## 2. Thư
| Method | Path | Quyền | Nhãn | Spec |
|---|---|---|---|---|
| GET | `/api/messages` (kể cả `scheduled=true`, `outbox=true`, `status` dạng danh sách) | S | C | [01-co-ban/07](../01-co-ban/07-danh-sach-dem-thu.md) |
| GET | `/api/messages/counts` | S | C | 〃 |
| POST | `/api/messages/bulk` (action `read|unread|archive|trash|spam|inbox|folder|delete`) | S (canRead/canManage theo action) | C | [01-co-ban/09](../01-co-ban/09-to-chuc-thu.md) |
| GET | `/api/messages/{id}`, `/api/messages/{id}/metadata` | S canRead | C | [01-co-ban/08](../01-co-ban/08-doc-thu.md) |
| DELETE | `/api/messages/{id}` — xoá vĩnh viễn (chỉ thư ở Trash/Spam) | S canManage | C | [01-co-ban/09 §7.2](../01-co-ban/09-to-chuc-thu.md) |
| GET | `/api/messages/{id}/thread` | S canRead | C | [01-co-ban/13](../01-co-ban/13-hoi-thoai.md) |
| POST | `/api/messages/{id}/read` | S canRead | C | [01-co-ban/08](../01-co-ban/08-doc-thu.md) |
| POST | `/api/messages/{id}/status` | S canManage | C | [01-co-ban/09](../01-co-ban/09-to-chuc-thu.md) |
| POST | `/api/messages/{id}/star` | S canRead | C | 〃 |
| POST/DELETE | `/api/messages/{id}/snooze` | S canManage | N | [02-nang-cao/06](../02-nang-cao/06-snooze.md) |
| POST | `/api/messages/{id}/retry-send` | S (người gửi ban đầu) | C | [01-co-ban/11 §5.2](../01-co-ban/11-gui-thu.md) |
| POST | `/api/messages/{id}/unschedule` | S (người tạo thư hoặc canManage) | N | [02-nang-cao/05 §5.3](../02-nang-cao/05-hen-gio-gui.md) |
| POST | `/api/messages/{id}/unsubscribe` | S canManage | T | [03-tuy-chon/07 §5.2](../03-tuy-chon/07-tien-ich-giao-dien.md) |
| GET | `/api/messages/{id}/attachments/{attId}` | S canRead | C | [01-co-ban/08](../01-co-ban/08-doc-thu.md) |
| GET | `/api/messages/{id}/original` | S canRead | C | 〃 |
| POST | `/api/mailboxes/{id}/empty-trash` | S canManage | C | [01-co-ban/09 §7.4](../01-co-ban/09-to-chuc-thu.md) |
| GET/POST | `/api/drafts` | S | C | [01-co-ban/10](../01-co-ban/10-nhap-thu.md) |
| GET/PATCH/DELETE | `/api/drafts/{id}` | S chủ nháp | C | 〃 |
| DELETE | `/api/drafts/{id}/attachments/{attId}` | S chủ nháp | C | 〃 |
| POST | `/api/send` | S | C | [01-co-ban/11](../01-co-ban/11-gui-thu.md) |

## 3. Domain / mailbox / folder / rule
| Method | Path | Quyền | Nhãn | Spec |
|---|---|---|---|---|
| GET/POST | `/api/domains` | S | C | [01-co-ban/04](../01-co-ban/04-quan-ly-domain.md) |
| POST | `/api/domains/check` | S | C | 〃 |
| GET/DELETE | `/api/domains/{id}` | S chủ domain | C | 〃 |
| GET | `/api/domains/{id}/dns` | S chủ domain | C | 〃 |
| POST | `/api/domains/{id}/dns/setup` | S chủ domain | N | [02-nang-cao/17](../02-nang-cao/17-kiem-tra-dns.md) |
| GET/POST | `/api/mailboxes` | S | C | [01-co-ban/05](../01-co-ban/05-quan-ly-mailbox.md) |
| GET/PATCH/DELETE | `/api/mailboxes/{id}` (DELETE có `?confirm=true` khi còn thư) | S | C | 〃 |
| GET/POST/DELETE | `/api/mailboxes/{id}/aliases` | S canManage | N | [02-nang-cao/09](../02-nang-cao/09-alias-va-use-all-domains.md) |
| GET/POST/PATCH/DELETE | `/api/mailboxes/{id}/access` | A (chủ mailbox shared) | N | [02-nang-cao/16 §5.2](../02-nang-cao/16-da-nguoi-dung-shared-mailbox.md) |
| GET/POST | `/api/mailboxes/{id}/avatar` | S | T | [02-nang-cao/19](../02-nang-cao/19-cai-dat-ca-nhan-avatar.md) |
| GET/POST | `/api/folders` | S canRead / canManage | N | [02-nang-cao/03](../02-nang-cao/03-folder-tuy-chinh.md) |
| PATCH/DELETE | `/api/folders/{id}` (DELETE có `?moveTo=inbox|trash`) | S canManage | N | 〃 |
| GET/POST · PATCH/DELETE | `/api/routing-rules` · `/api/routing-rules/{id}` | S canManage | N | [02-nang-cao/01](../02-nang-cao/01-rule-mailbox.md) |
| POST | `/api/routing-rules/{id}/apply` | S canManage | N | [02-nang-cao/01 §4.5](../02-nang-cao/01-rule-mailbox.md) |
| GET/POST · PATCH/DELETE | `/api/routing-rules/domain` · `/api/routing-rules/domain/{id}` | A / canManage | N | [02-nang-cao/02](../02-nang-cao/02-rule-domain.md) |

## 4. Người dùng, cài đặt, liên hệ
| Method | Path | Quyền | Nhãn | Spec |
|---|---|---|---|---|
| PATCH | `/api/settings/password` | S | C | [01-co-ban/03](../01-co-ban/03-ho-so-mat-khau.md) |
| PATCH | `/api/settings/profile` | S | C | 〃 |
| GET/PATCH | `/api/settings/forwarding` | S | N | [02-nang-cao/08](../02-nang-cao/08-chuyen-tiep-tai-khoan.md) |
| POST | `/api/settings/forwarding/verify` | S | N | 〃 |
| GET/PATCH | `/api/settings/spam` | S | N | [02-nang-cao/11](../02-nang-cao/11-bo-loc-spam.md) |
| GET/PATCH | `/api/settings/shortcuts` | S | T | [03-tuy-chon/07](../03-tuy-chon/07-tien-ich-giao-dien.md) |
| GET · POST | `/api/settings/mfa` · `/enroll`, `/confirm`, `/recovery-codes`, `/disable` | S | N | [02-nang-cao/15](../02-nang-cao/15-xac-thuc-2-lop.md) |
| GET | `/api/settings/login-history?limit&cursor` — lịch sử đăng nhập của chính user | S | N | [02-nang-cao/18 §5.5](../02-nang-cao/18-nhat-ky-audit.md) |
| GET/POST/DELETE | `/api/profile/avatar` | S | T | [02-nang-cao/19](../02-nang-cao/19-cai-dat-ca-nhan-avatar.md) |
| GET/PATCH | `/api/contacts` | S canRead / canManage | N | [02-nang-cao/10](../02-nang-cao/10-danh-ba-va-chan.md) |
| GET | `/api/contacts/suggest?mailboxId&q` — gợi ý người nhận | S canRead | N | [02-nang-cao/10 §7.5](../02-nang-cao/10-danh-ba-va-chan.md) |
| POST | `/api/contacts/block` | S canManage | N | 〃 |
| DELETE | `/api/contacts/block?mailboxId&address` — bỏ chặn | S canManage | N | [02-nang-cao/10 §7.4](../02-nang-cao/10-danh-ba-va-chan.md) |
| GET/POST/DELETE | `/api/contacts/avatar` | S | T | [02-nang-cao/19](../02-nang-cao/19-cai-dat-ca-nhan-avatar.md) |
| GET/POST | `/api/accounts` | A | N | [02-nang-cao/16](../02-nang-cao/16-da-nguoi-dung-shared-mailbox.md) |
| GET/PATCH | `/api/accounts/{id}` | A | N | 〃 |
| GET | `/api/accounts/{id}/mailboxes` | A | N | 〃 |
| GET/POST | `/api/accounts/{id}/avatar` | A | T | [02-nang-cao/19](../02-nang-cao/19-cai-dat-ca-nhan-avatar.md) |
| GET | `/api/activity?limit&cursor` | A | N | [02-nang-cao/18 §5.3](../02-nang-cao/18-nhat-ky-audit.md) |
| GET | `/api/audit-logs?action&userId&mailboxId&limit&cursor` | A | N | [02-nang-cao/18 §5.4](../02-nang-cao/18-nhat-ky-audit.md) |

Endpoint chỉ tồn tại khi chọn phương án thay thế của một quyết định thiết kế ([05-van-hanh/01 §6](01-bay-va-cai-thien.md)):
| Method | Path | Quyền | Điều kiện | Spec |
|---|---|---|---|---|
| DELETE | `/api/accounts/{id}` | A | chọn "xoá tài khoản thật" thay vì chỉ khoá | [02-nang-cao/16 §4.5](../02-nang-cao/16-da-nguoi-dung-shared-mailbox.md) |
| GET/PATCH | `/api/settings/display` | S | chọn lưu tuỳ chọn hiển thị trên server | [02-nang-cao/19](../02-nang-cao/19-cai-dat-ca-nhan-avatar.md) |

## 5. Tích hợp
| Method | Path | Quyền | Nhãn | Spec |
|---|---|---|---|---|
| GET/POST | `/api/api-keys` | S | N | [02-nang-cao/13](../02-nang-cao/13-api-key-va-rest-v1.md) |
| DELETE | `/api/api-keys/{id}` — thu hồi | S (chủ key) | N | 〃 |
| POST | `/api/v1/send` | K(send) | N | 〃 |
| GET | `/api/v1/messages` | K(read) | N | 〃 |
| GET/POST · GET/DELETE | `/api/v1/domains` · `/api/v1/domains/{id}` | K(domains) | N | 〃 |
| GET · POST | `/api/v1/domains/{id}/dns` · `/api/v1/domains/{id}/dns/setup` | K(domains) | N | 〃 |
| GET/POST | `/api/webhooks` | S | N | [02-nang-cao/12](../02-nang-cao/12-webhook.md) |
| GET/PATCH/DELETE | `/api/webhooks/{id}` | S | N | 〃 |
| GET | `/api/webhooks/{id}/deliveries` | S | N | 〃 |
| POST | `/api/webhooks/{id}/deliveries/{deliveryId}/retry`, `/api/webhooks/{id}/test` | S | N | 〃 |
| * | `/.well-known/jmap`, `/jmap/*` | K(jmap) | T | [03-tuy-chon/02](../03-tuy-chon/02-jmap.md) |
| POST | `/api/inbound` | H (có timestamp) | T | [03-tuy-chon/08 §5.3](../03-tuy-chon/08-runtime-node-tu-host.md) |

## 6. Vận hành & sản phẩm (TÙY CHỌN)
| Method | Path | Quyền | Spec |
|---|---|---|---|
| GET/PUT/POST | `/api/backups` (POST → 202) | A | [03-tuy-chon/04](../03-tuy-chon/04-backup.md) |
| DELETE · GET | `/api/backups/{id}` · `/api/backups/{id}/download` | A | 〃 |
| POST | `/api/backups/restore` | A | 〃 |
| GET/POST | `/api/admin/migrations` | A | [03-tuy-chon/05](../03-tuy-chon/05-migration-self-update.md) |
| GET/POST | `/api/admin/update` | A | 〃 |
| GET/POST | `/api/admin/search-index` | A | [03-tuy-chon/05 §5](../03-tuy-chon/05-migration-self-update.md), [01-co-ban/14](../01-co-ban/14-tim-kiem.md) |
| GET · POST | `/api/licenses` · `/api/licenses/activate`, `/validate`, `/deactivate` | A | [03-tuy-chon/01](../03-tuy-chon/01-license-branding.md) |
| GET/PUT · GET | `/api/branding` · `/api/branding/icon` | P/A · P | 〃 |
| GET/POST · PATCH/DELETE | `/api/calendar/events` · `/api/calendar/events/{id}` | S | [03-tuy-chon/06](../03-tuy-chon/06-lich-va-mau-thu.md) |
| POST | `/api/import/messages`, `/api/import/imap`, `/api/import/imap/folders` | S canManage | [03-tuy-chon/03](../03-tuy-chon/03-import-export.md) |
| GET | `/api/export/messages` | S canRead | 〃 |
