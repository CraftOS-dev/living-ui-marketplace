// A stand-in for the CraftBot bridge (scratch tests only): answers
// /api/integrations/available (Google Calendar and Gmail connected) and
// /api/integrations/action (create_google_calendar_event, send_gmail),
// and logs every call to a JSON-lines file.
//   node fake_bridge.mjs <port> <log file>
import { createServer } from 'node:http';
import { appendFileSync, writeFileSync } from 'node:fs';
const port = Number(process.argv[2] || 3198);
const log = process.argv[3];
writeFileSync(log, '');
let n = 0;
createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    let json = null;
    try {
      json = body ? JSON.parse(body) : null;
    } catch {
      json = null;
    }
    appendFileSync(log, JSON.stringify({ method: req.method, url: req.url, auth: req.headers.authorization || '', body: json }) + '\n');
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/integrations/available') return res.end(JSON.stringify({ integrations: [{ id: 'google_calendar', connected: true }, { id: 'gmail', connected: true }] }));
    if (req.url === '/api/integrations/action' && json) {
      if (json.action === 'create_google_calendar_event') {
        n++;
        return res.end(JSON.stringify({ status: 200, data: { status: 'success', result: { id: 'evt_' + n, htmlLink: 'https://calendar.google.com/event?eid=evt_' + n } } }));
      }
      if (json.action === 'send_gmail') return res.end(JSON.stringify({ status: 200, data: { status: 'success' } }));
      res.statusCode = 404;
      return res.end(JSON.stringify({ error: 'Unknown action' }));
    }
    res.end(JSON.stringify({ ok: true }));
  });
}).listen(port, '127.0.0.1');
