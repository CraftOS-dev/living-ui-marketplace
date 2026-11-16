// A Gmail stand-in for the paging test (network tests only): search_gmail honours after: and before: in
// epoch seconds (newest first, at most max_results), get_gmail answers headers after a delay like the real
// bridge, the calendar is empty. node mock_paging.mjs <port> <count> <delay ms>
import { createServer } from 'node:http';

const port = Number(process.argv[2] || 3284);
const count = Number(process.argv[3] || 260);
const delay = Number(process.argv[4] || 70);
if (port >= 3100 && port <= 3179) process.exit(2);
const now = Date.now();
const msgs = [];
for (let i = 0; i < count; i++) {
  // 150 in the last six hours (a day holding more than one page), the rest over 20 days.
  const ago = i < 150 ? Math.floor((i / 150) * 6 * 3600000) : 86400000 + Math.floor(((i - 150) / Math.max(1, count - 150)) * 19 * 86400000);
  msgs.push({ id: 'pg' + String(i).padStart(4, '0'), at: now - ago - 60000, i });
}
const ok = (result) => ({ status: 200, data: { status: 'success', result } });
let gets = 0;
let searches = 0;
const server = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const send = (code, body) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.url.startsWith('/__mock/health')) return send(200, { ok: true });
    if (req.url.startsWith('/__mock/stats')) return send(200, { gets, searches });
    const body = raw === '' ? {} : JSON.parse(raw);
    if (req.url === '/api/bridge/agent_request') return send(200, { ok: true });
    const p = body.params || {};
    if (body.action === 'search_gmail') {
      searches++;
      const after = /after:(\d+)/.exec(p.query || '');
      const before = /before:(\d+)/.exec(p.query || '');
      const lo = after ? Number(after[1]) * 1000 : -Infinity;
      const hi = before ? Number(before[1]) * 1000 : Infinity;
      const hits = msgs.filter((m) => m.at >= lo && m.at < hi).sort((a, b) => b.at - a.at);
      return send(200, ok({ messages: hits.slice(0, Number(p.max_results || 25)).map((m) => ({ id: m.id, threadId: m.id })), resultSizeEstimate: hits.length }));
    }
    if (body.action === 'get_gmail') {
      gets++;
      const m = msgs.find((x) => x.id === p.message_id);
      setTimeout(() => {
        if (!m) return send(200, { status: 200, data: { status: 'error', message: 'Failed to get email.' } });
        send(200, ok({ id: m.id, threadId: m.id, labelIds: ['INBOX'], internalDate: String(m.at), headers: { From: `Founder ${m.i} <f${m.i}@co${m.i % 40}.example>`, To: 'owner@venture.test', Subject: 'Hello ' + m.i, 'Message-ID': `<${m.id}@paging>` } }));
      }, delay);
      return;
    }
    if (body.action === 'list_google_calendar_events') return send(200, ok([]));
    return send(404, { error: 'Unknown action' });
  });
});
server.listen(port, '127.0.0.1');
