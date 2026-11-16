// A stand-in for the CraftBot bridge (scratch tests only). It records every
// trigger fire the app nudges (POST /api/bridge/agent_request) and answers the
// integration calls the app makes (Gmail, Calendar) so nothing leaves the machine.
//   node mock_bridge.mjs <port>
//   GET  /__mock/health   ok
//   GET  /__mock/fires    { fires: [{ request_id, trigger, at }] }
//   POST /__mock/reset    forget the fires
import { createServer } from 'node:http';

const port = Number(process.argv[2] || 3285);
let fires = [];
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
    res.setHeader('content-type', 'application/json');
    if (req.url === '/__mock/health') return res.end('{"ok":true}');
    if (req.url === '/__mock/fires') return res.end(JSON.stringify({ fires }));
    if (req.url === '/__mock/reset') {
      fires = [];
      return res.end('{"ok":true}');
    }
    if (req.url === '/api/bridge/agent_request' && json) {
      fires.push({ request_id: String(json.request_id || ''), trigger: String(json.trigger || ''), at: new Date().toISOString() });
      return res.end('{"ok":true}');
    }
    if (req.url === '/api/integrations/available') return res.end(JSON.stringify({ integrations: [{ id: 'google_calendar', connected: true }, { id: 'gmail', connected: true }] }));
    if (req.url === '/api/integrations/action') return res.end(JSON.stringify({ status: 200, data: { status: 'success', result: {} } }));
    res.end('{"ok":true}');
  });
}).listen(port, '127.0.0.1');
