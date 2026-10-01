// Builds candidate.json. Usage: node build.mjs <vi.json> <candidate.json>
// ponytail: 8 lifelines is the renderer's cap for a scrolling sequence (no meta.viewBox => 920px canvas,
// 108px fixed columns); an authored wider viewBox must fit one 900px screen, which caps the timeline at
// ~15 messages. So email() and queue() share the worker.ts lifeline (segments name the handler) and the
// webhook endpoint has no column. Split them if the renderer ever sizes width from participant count.
import fs from 'fs';
const [,, vi, out] = process.argv;
const s = (path, line, end_line, label) => ({ path, line, end_line, label });
const P = (id, type, label, sublabel, sources) => ({ id, type, label, sublabel, sources });
const participants = [
  P('sender', 'external', 'Người gửi', 'MTA bên ngoài', [
    s('src/lib/email/auto-reply.ts', 12, 63, 'auto-reply tới fromAddress'),
    s('src/lib/email/send.ts', 116, 158, 'chèn messages + outbound_jobs'),
    s('src/lib/email/send.ts', 196, 204, 'env.EMAIL.send'),
  ]),
  P('cfRouting', 'cloud', 'Email Routing', 'Cloudflare', [
    s('src/lib/cloudflare-api.ts', 183, 202, 'rule action worker'),
    s('wrangler.jsonc', 3, 4, 'Worker mailflare'),
    s('src/lib/email/incoming.ts', 35, 48, 'message.forward'),
  ]),
  P('worker', 'backend', 'worker.ts', 'email() · queue()', [
    s('worker.ts', 49, 122, 'handler email() + queue()'),
    s('src/lib/email/inbound.ts', 35, 244, 'processInboundMessage'),
    s('src/lib/email/account-forwarding.ts', 10, 28, 'chuyển tiếp tài khoản'),
  ]),
  P('db', 'database', 'D1 · DB', 'routing + messages', [
    s('src/lib/email/routing.ts', 53, 142, 'resolveInboundAddress + scope domain'),
    s('src/lib/email/inbound.ts', 154, 199, 'insert / rollback'),
    s('src/lib/email/webhooks.ts', 43, 84, 'webhooks + webhook_deliveries'),
  ]),
  P('bucket', 'database', 'R2 · BUCKET', 'mailflare-raw', [
    s('wrangler.jsonc', 76, 81, 'binding BUCKET'),
    s('src/lib/email/inbound.ts', 246, 258, 'storeRawToR2'),
    s('src/lib/email/attachments.ts', 62, 95, 'lưu đính kèm'),
  ]),
  P('queues', 'messagebus', 'Queues', 'INBOUND · AGENT', [
    s('wrangler.jsonc', 82, 113, 'producer + consumer'),
    s('src/lib/agent/jobs/utils.ts', 26, 41, 'scheduleAutoDraft'),
    s('worker.ts', 111, 119, 'ack / retry'),
  ]),
  P('hub', 'backend', 'RealtimeHub', 'Durable Object', [
    s('src/lib/realtime/hub.ts', 5, 38, '/connect, /notify'),
    s('src/lib/realtime/utils.ts', 51, 68, 'notifyUsersOfNewMessage'),
    s('wrangler.jsonc', 24, 31, 'binding REALTIME'),
  ]),
  P('browser', 'frontend', 'Trình duyệt', 'WebSocket', [
    s('src/hooks/use-message-polling.ts', 108, 124, 'mở WebSocket + onmessage'),
    s('src/hooks/message-realtime-utils.ts', 20, 23, 'URL /api/realtime'),
    s('worker.ts', 25, 44, 'fetch() → DO /connect'),
  ]),
];
let y = 172;
const messages = [];
const GAP = 32, NOTE_GAP = 46;
const M = (id, from, to, label, variant, note) => {
  messages.push({ id, from, to, y, label, variant, ...(note ? { note } : {}) });
  y += note ? NOTE_GAP : GAP;
};
const segments = [];
const phase = (label, fn) => {
  const from = y - 22;
  fn();
  segments.push({ from, to: y - 14, label });
  y += 22;
};
phase('Email Routing → worker.ts email() — đồng bộ', () => {
  M('smtp', 'sender', 'cfRouting', 'SMTP tới địa chỉ mailbox', 'default', 'Nền tảng Cloudflare: rule action worker khớp địa chỉ nhận');
  M('invokeEmail', 'cfRouting', 'worker', 'email(message)', 'emphasis');
  M('rejectSize', 'worker', 'cfRouting', '[rawSize > 25 MiB] setReject', 'security');
  M('resolveCall', 'worker', 'db', 'resolveIncomingMail(from, to)', 'emphasis', 'resolveInboundAddress đọc domains, routing_rules (scope domain), mailboxes, alias');
  M('decision', 'db', 'worker', 'reject / store / forward', 'return', 'Pha: reject → mailbox/alias → catch-all; lỗi → null, vẫn ghi R2 + queue');
  M('rejectRule', 'worker', 'cfRouting', '[reject] setReject(rejectReason)', 'security');
  M('rejectAtt', 'worker', 'cfRouting', '[quá giới hạn đính kèm] setReject', 'security');
  M('domainFwd', 'worker', 'cfRouting', '[forward] forward(forwardTo)', 'default', 'message.forward + X-Mailflare-Forwarded: 1; dừng nếu thành công và không keepCopy');
  M('acctDest', 'worker', 'db', '[X-Mailflare-Forwarded ≠ 1] getAccountForwardingDestination', 'default', 'Cần license canForwardEmail; resolveInboundAddress → users.forwardingEmail');
  M('acctFwd', 'worker', 'cfRouting', '[đích ≠ người nhận] message.forward', 'default', 'Chuyển tiếp cấp tài khoản, cùng forwardMessage; forward lỗi không chặn việc lưu');
  M('putRaw', 'worker', 'bucket', 'storeRawToR2: inbound/<ts>-<id>.eml', 'emphasis');
  M('enqueue', 'worker', 'queues', 'INBOUND_QUEUE.send({from, to, rawR2Key, headers})', 'emphasis');
  M('failReject', 'worker', 'cfRouting', '[lỗi bất kỳ] setReject', 'security', 'catch: lý do "Processing failed"');
});
phase('worker.ts queue() → processInboundMessage', () => {
  M('deliverBatch', 'queues', 'worker', 'batch ≤ 5', 'dashed', 'isInboundQueueMessage → processInboundMessage');
  M('reResolve', 'worker', 'db', 'resolveInboundAddress lần nữa', 'default', 'Dừng nếu null, reject hoặc forward không keepCopy');
  M('reDecision', 'db', 'worker', 'decision + mailbox', 'return');
  M('dedupe', 'worker', 'db', 'tìm (mailboxId, rawR2Key)', 'default', 'Đã có → chỉ khôi phục auto-draft rồi ack');
  M('getRaw', 'worker', 'bucket', 'BUCKET.get(rawR2Key)', 'default');
  M('rawBack', 'bucket', 'worker', 'raw MIME → parseRawMime', 'return', 'postal-mime; thiếu object → dừng');
  M('dropRaw', 'worker', 'bucket', '[quá giới hạn] BUCKET.delete', 'security');
  M('inboxRule', 'worker', 'db', 'resolveInboxRuleDestination', 'default', 'Rule scope mailbox chọn thư mục / spam / trash');
  M('spam', 'worker', 'db', 'analyzeSpam (nếu bật chống spam)', 'default', 'verdict spam → status "spam", bỏ folderId');
  M('contact', 'worker', 'db', 'upsertContactFromAddress', 'default');
  M('thread', 'worker', 'db', 'resolveThreadId', 'default', 'In-Reply-To / References khớp providerMessageId cùng mailbox');
  M('insertMsg', 'worker', 'db', 'insert messages (onConflictDoNothing)', 'emphasis');
  M('putAtt', 'worker', 'bucket', 'storeMessageAttachments', 'emphasis', 'Mỗi tệp: put attachments/<msgId>/… + dòng message_attachments trong D1');
  M('rollback', 'worker', 'db', '[lỗi] xoá dòng message vừa chèn', 'default');
  M('retry', 'worker', 'queues', '[lỗi] msg.retry({ delaySeconds: 10 })', 'default', 'Lỗi được ném lại; max_retries 3');
});
phase('Sau khi lưu', () => {
  M('autoReplyDb', 'worker', 'db', '[status received] sendMailboxAutoReply', 'default', 'autoReplyEnabled, 1 lần/24 giờ mỗi người gửi; sendEmail chèn messages + outbound_jobs');
  M('autoReply', 'worker', 'sender', 'env.EMAIL.send: thư trả lời tự động', 'default', 'Binding send_email EMAIL gửi cho người gửi gốc; lỗi chỉ ghi log');
  M('notify', 'worker', 'hub', 'POST /notify', 'emphasis', 'notifyUsersOfNewMessage; bỏ qua khi spam');
  M('wsPush', 'hub', 'browser', 'WebSocket: new_message', 'default', 'socket.send tới mọi WebSocket DO đã accept');
  M('pushed', 'hub', 'worker', '204', 'return');
  M('webhook', 'worker', 'db', 'dispatchWebhooks: message.inbound', 'default', 'Ghi webhook_deliveries, POST có chữ ký tới URL người dùng; lỗi → OUTBOUND_QUEUE');
  M('autoDraft', 'worker', 'queues', 'scheduleAutoDraft', 'dashed', 'AGENT_QUEUE.send({kind: "agent.draft"}) khi đủ điều kiện');
  M('ack', 'worker', 'queues', 'msg.ack()', 'return');
});
const at = (id) => messages.find((m) => m.id === id).y;
const activations = [
  { participant: 'worker', from: at('invokeEmail') - 6, to: at('failReject') + 6, type: 'backend' },
  { participant: 'worker', from: at('deliverBatch') - 6, to: at('ack') + 6, type: 'backend' },
  { participant: 'hub', from: at('notify') - 6, to: at('pushed') + 6, type: 'backend' },
];
const doc = {
  schema_version: 1,
  diagram_type: 'sequence',
  meta: {
    title: 'Trình tự nhận thư đến (inbound)',
    output: '.archify/sequence-mailflare-inbound-20261001-113615/mailflare-inbound.html',
    quality_profile: 'showcase',
    locale: 'vi',
    translations: JSON.parse(fs.readFileSync(vi, 'utf8')),
    repository: { url: 'https://github.com/p-chief/mailflare.git', revision: '7c605c3c9523bc7f0e0a92ab718f174ecb4de1d6' },
  },
  participants,
  segments,
  messages,
  activations,
  cards: [
    { dot: 'rose', title: 'Vì sao reject/forward nằm trong email()', items: [
      'setReject() và forward() chỉ có trên ForwardableEmailMessage còn sống trong email()',
      'Consumer gọi lại resolveInboundAddress với cùng người gửi nên rule chặn cho kết quả giống nhau',
      'Forward thất bại: raw MIME vẫn được ghi R2 và vào queue, nhưng consumer chỉ chèn message khi rule có keepCopy; không keepCopy thì consumer bỏ qua',
      'Chuyển tiếp cấp tài khoản cần license canForwardEmail (Pro/Team) và bị bỏ qua khi đích trùng người nhận',
    ] },
    { dot: 'amber', title: 'Retry an toàn', items: [
      'Khử trùng lặp theo (mailboxId, rawR2Key) trước khi đọc R2',
      'Insert hoặc lưu đính kèm lỗi → xoá dòng message, ném lỗi, queue retry sau 10 giây',
      'Webhook có retry riêng trên OUTBOUND_QUEUE, không dùng retry của thư đến',
    ] },
    { dot: 'cyan', title: 'Sau khi lưu (đúng thứ tự trong code)', items: [
      'auto-reply → realtime notify → dispatchWebhooks → scheduleAutoDraft → ack',
      'Auto-reply là một lần gửi đi thật: sendEmail chèn messages + outbound_jobs rồi env.EMAIL.send, đều được await',
      'Trình duyệt đã mở WebSocket /api/realtime từ trước; worker.ts fetch() chuyển nó tới /connect của DO',
    ] },
    { dot: 'slate', title: 'Cách đọc các cột', items: [
      'Cột worker.ts gộp hai handler của cùng một Worker; khung nền cho biết đang ở email() hay queue()',
      'Cột Queues gộp INBOUND_QUEUE (thư đến) và AGENT_QUEUE (job agent.draft)',
      'Endpoint webhook không có cột riêng: dispatchWebhooks POST có chữ ký tới URL người dùng',
      'Chặng SMTP từ người gửi tới Email Routing là hành vi nền tảng Cloudflare, không nằm trong mã repo',
    ] },
  ],
};
fs.writeFileSync(out, JSON.stringify(doc, null, 2));
console.log('messages', messages.length, 'lastY', messages.at(-1).y);
