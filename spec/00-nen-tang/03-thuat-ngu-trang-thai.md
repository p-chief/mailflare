# Thuật ngữ & máy trạng thái

> **[CƠ BẢN]** · Nhóm: Nền tảng · Liên quan: [04-mo-hinh-du-lieu.md](04-mo-hinh-du-lieu.md), [05-phan-quyen.md](05-phan-quyen.md)

## 1. Thuật ngữ

| Thuật ngữ | Định nghĩa |
|---|---|
| **User / Account** | Người đăng nhập. `email` đăng nhập = địa chỉ mailbox chính `username@domain`. Vai trò `admin` / `user`. |
| **Chủ domain** | User sở hữu dòng `domains` (thường là admin). User do admin tạo có `canManageMailboxes` được dùng domain của admin. |
| **Domain** | Hostname (apex hoặc subdomain của một zone Cloudflare). |
| **Zone** | Zone DNS trên Cloudflare chứa domain. `zoneId = "manual"` khi không quản lý qua API. |
| **Mailbox** | Hộp thư có địa chỉ `localPart@domain`, loại `personal` hoặc `shared`, có 1 owner. |
| **Primary mailbox** | Mailbox `personal` có địa chỉ bằng `user.email`. Tên và avatar của nó **là** tên và avatar của user. |
| **Alias** | Địa chỉ phụ trên một domain, giao vào một mailbox. |
| **useAllDomains** | Mailbox tự nhận/gửi được `localPart@` mọi domain active khác của cùng chủ domain (trừ nơi localPart đã bị chiếm). |
| **Địa chỉ hợp lệ của mailbox** | Tập địa chỉ = chính + alias + (nếu useAllDomains) các domain khác. Dùng cho nhận thư, kiểm tra From, tạo rule Cloudflare. |
| **Envelope from/to** | Địa chỉ SMTP (`MAIL FROM`/`RCPT TO`) — có trong handler `email`. Khác với header From/To trong MIME. |
| **Message** | Một thư. `direction` = `inbound` (đến) / `outbound` (đi). |
| **Status** | Cột text quyết định "thư mục ảo" của thư. |
| **Folder** | Thư mục do người dùng tạo, thuộc một mailbox. Thư có `folderId`. |
| **Thread** | Hội thoại; mọi thư cùng `threadId` trong cùng mailbox. |
| **Rule mailbox** (`scope=mailbox`) | Bộ lọc chạy **sau khi** thư đã được giao vào mailbox: chọn folder/spam/trash. |
| **Rule domain** (`scope=domain`) | Quy tắc chạy **khi phân giải địa chỉ** trong handler `email`: reject, forward, catch-all store. |
| **Catch-all (Cloudflare)** | Rule đặc biệt của zone gửi *mọi* địa chỉ tới Worker. Khác với *rule domain catch-all* (quyết định mailbox nào nhận thư lạ). |
| **Mailbox access** | Cấp quyền shared mailbox cho user khác. |
| **Contact** | Danh bạ theo user (owner của mailbox). |
| **Outbound job** | Bản ghi theo dõi một lần gửi thư. |
| **Delivery (webhook)** | Một lần gửi sự kiện tới một webhook, có thể nhiều attempt. |
| **Entitlement** | Cờ quyền lợi tính năng (vd `mailboxSharing`) bật/tắt bằng cấu hình — xem [03-tuy-chon/01-license-branding.md](../03-tuy-chon/01-license-branding.md). |

## 2. Máy trạng thái của Message

### 2.1 Giá trị `status`

| status | direction | Thư mục UI | Tạo bởi |
|---|---|---|---|
| `received` (không `folderId`, không snooze) | inbound | Inbox | pipeline nhận, "Move to inbox", "Not spam" |
| `received` + `folderId` | inbound (hoặc outbound nếu import) | Folder tuỳ chỉnh | rule mailbox, bulk `folder` |
| `received` + `snoozedUntil > now` | inbound | Snoozed | snooze |
| `archived` | bất kỳ | Archived | bulk `archive` |
| `spam` | inbound | Spam | pipeline (rule / điểm spam / chặn), "Report spam" |
| `trash` | bất kỳ | Trash | rule, bulk `trash` |
| `draft` | outbound | Drafts | tạo nháp |
| `queued` | outbound | Outbox / Scheduled | gửi (đang gửi / hẹn giờ) |
| `sent` | outbound | Sent | gửi thành công |
| `failed` | outbound | Outbox | gửi lỗi (có thể gửi lại) |

`starred` và `read` là cờ **trực giao** với status.

Thư mục Scheduled liệt kê thư `status = queued` có outbound job với `scheduled_at > now`; Outbox liệt kê các thư `queued`/`failed` còn lại (xem [02-nang-cao/05-hen-gio-gui.md](../02-nang-cao/05-hen-gio-gui.md)).

### 2.2 Chuyển trạng thái thư đến

```
            ┌─────────── archive ───────────┐
            ▼                               │
 [queue] → received ── trash ──► trash ─────┤  (mọi trạng thái đều có thể
     │        │  ▲                          │   chuyển về received bằng "inbox")
     │        │  └──── inbox ◄──────────────┘
     │        ├── folder(X) ──► received+folderId=X
     │        ├── spam (feedback: spam) ──► spam ── inbox (feedback: ham) ──► received
     │        └── snooze(t) ──► received+snoozedUntil=t  (tự hiện lại khi quá t)
     ├──► spam   (rule mailbox action=spam | điểm ≥ 70 | người gửi bị chặn)
     └──► trash  (rule mailbox action=trash | rule "chặn người gửi")

 trash / spam ── xoá vĩnh viễn (thủ công, hoặc cron sau 30 ngày) ──► [xoá hẳn: dòng + object R2]
```
Khi chuyển sang `archived|trash|spam|received(inbox)` → `folderId = null`.

### 2.3 Chuyển trạng thái thư đi

```
 (composer) ──autosave──► draft ──(xoá)──► [xoá hẳn]
                            │
                         (gửi) ── tạo message MỚI ──► queued ──EMAIL send ok──► sent
                                                       │
                                                       └──lỗi──► failed ──(gửi lại)──► queued
                            client xoá draft cũ sau khi gửi thành công
```
Hẹn giờ: `queued` giữ nguyên tới khi consumer gửi; huỷ hẹn giờ đưa thư về `draft` (xem [02-nang-cao/05-hen-gio-gui.md](../02-nang-cao/05-hen-gio-gui.md)).

## 3. Trạng thái các thực thể khác

| Thực thể | Trạng thái | Chuyển |
|---|---|---|
| Domain `status` | `pending` → `active` khi routing hoặc sending bật. `error` là giá trị dự trữ cho hiển thị; luồng thêm domain không bao giờ lưu dòng ở trạng thái lỗi vì lỗi provision luôn được rollback và trả lỗi cho người gọi. | set khi thêm/cập nhật domain |
| Outbound job | `queued` → `sending` → `sent` / `failed`; `queued` → `cancelled` (huỷ hẹn giờ); `failed` → `queued` (gửi lại) | thủ tục gửi thư ([01-co-ban/11-gui-thu.md](../01-co-ban/11-gui-thu.md)), gửi hẹn giờ ([02-nang-cao/05-hen-gio-gui.md](../02-nang-cao/05-hen-gio-gui.md)) |
| Webhook delivery | `pending` → `delivered` / `retrying` → … → `delivered` / `exhausted` | mỗi attempt |
| Backup | `queued` → `running` → `completed` / `failed` | runner backup |
| License (tích hợp tùy chọn) | `inactive` → `active` / `invalid` / `expired` / `deactivated` | theo phản hồi máy chủ license |
| MFA | secret đã lưu (`totpEnabled=false`) → `totpEnabled=true` | enroll → confirm |
| Password reset token | mới → `usedAt` set (hoặc hết hạn 30') | confirm |
