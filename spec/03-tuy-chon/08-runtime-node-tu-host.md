# Runtime Node/Docker tự host & relay inbound

> **[TÙY CHỌN]** — Không cần nếu chỉ chạy trên Cloudflare Workers. Ghi lại để hiểu các nhánh `isNodeRuntime(env)` và endpoint `/api/inbound`.

## 1. Ý tưởng
Cùng một mã ứng dụng chạy trên Node bằng cách dựng một đối tượng `env` cùng hình dạng với Workers:
| Binding | Thay thế |
|---|---|
| `DB` | better-sqlite3 (`$DATA_DIR/mailflare.sqlite`) bọc API giống D1 |
| `BUCKET` | FileBucket (`$DATA_DIR/blobs`, file + `*.meta.json`; `list()` chưa hỗ trợ) |
| `EMAIL` | nodemailer (`SMTP_URL`) hoặc Cloudflare Email Sending REST (`CF_ACCOUNT_ID` + `CF_TOKEN`: `POST /accounts/{id}/email/sending/send`) |
| Queues | hàng đợi trong tiến trình (setTimeout, retry 3 × 10 s, **mất khi restart**) |
| `REALTIME` | registry WebSocket trong bộ nhớ |
| `LOGIN_RATE_LIMIT` | fixed window trong bộ nhớ |
| Cron | kiểm tra mỗi phút, chạy backup một lần/ngày lúc 02 UTC |
`MAILFLARE_RUNTIME = "node"`. Migration chạy lúc khởi động (theo `meta/_journal.json`, tách theo `--> statement-breakpoint`, mỗi file một transaction).

## 2. Chỗ khác biệt theo runtime
- `/api/auth/me` trả `runtime`, `managesDns`.
- Setup checks: Database, Outbound mail, Cloudflare credentials (tuỳ chọn).
- Không có credential Cloudflare → domain `zoneId = "manual"`, mọi lời gọi Cloudflare là no-op, trang DNS liệt kê bản ghi cần tạo tay: `MX 10 <MAIL_HOSTNAME|mail.<host>>`, `TXT v=spf1 a:<mailHost> ~all`, `_dmarc TXT v=DMARC1; p=none`.
- Không đặt catch-all → Worker trên Node.
- Self-update → 400 (cập nhật bằng image mới).

## 3. Nhận thư trên Node
### 3.1 SMTP listener (`smtp-server`, cổng `SMTP_INBOUND_PORT`=25)
Không AUTH; STARTTLS khi có `SMTP_TLS_KEY/CERT`; `SMTP_MAX_SIZE` (25 MiB, vượt → 552). Mỗi RCPT → `intakeIncomingMail(env, {from, to, raw, headers}, {reject, forward: sendRaw})`; lỗi → 451; có reject → 550 cho cả DATA. (Forward trên SMTP không thêm header chống vòng lặp.)

### 3.2 Relay Worker + `POST /api/inbound`
Worker nhỏ (`deploy/cloudflare-email-relay`) nhận Email Routing rồi POST về server:
- Body: raw RFC 5322 (`message/rfc822`).
- Headers: `X-Mailflare-From`, `X-Mailflare-To` (1 người nhận/request), `X-Mailflare-Headers` (JSON, không ký), `X-Mailflare-Signature` = hex `HMAC-SHA256(INBOUND_WEBHOOK_SECRET, "<from>\n<to>\n" + raw)`.
- Server: không có secret → 503; > 25 MiB → 413; chữ ký sai → 401 (so sánh constant-time); gọi intake → `200 {action: reject|forward|store, reason?, rawR2Key?, forwardedTo?, forwardTo, forwardHeaders}`.
- Relay: lỗi mạng/không 2xx → `setReject("Mailflare is temporarily unavailable, please retry")`; `reject` → `setReject(reason)`; có `forwardTo` → `message.forward(forwardTo, forwardHeaders)`.
- Không chống replay (không timestamp/nonce).

### 3.3 `intakeIncomingMail` (dùng chung)
Giống hệt handler `email()` (reject → forward rule → account forwarding → R2 → queue) nhưng hành động reject/forward thực hiện qua callback; lỗi được ném cho caller.

## 4. Docker
Image `node:22-bookworm-slim`, build `npm run build:node` (esbuild `server/index.ts` → `dist/server.mjs`), chạy user `node`, `VOLUME /data`, `EXPOSE 3000 25`, healthcheck `GET /api/setup/status`. Biến: `PORT`, `HOST`, `DATA_DIR`, `APP_URL`, `SMTP_INBOUND_PORT`, `MAIL_HOSTNAME`, `SMTP_MAX_SIZE`, `SMTP_TLS_KEY/CERT`, `SMTP_URL`, `SMTP_TLS_REJECT_UNAUTHORIZED`, `CF_ACCOUNT_ID`, `CF_TOKEN`, `INBOUND_WEBHOOK_SECRET`, `TURNSTILE_SECRET_KEY`.
