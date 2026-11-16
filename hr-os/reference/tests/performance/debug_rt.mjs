// Debug: subscribe to the realtime topic "hr" and print every changed-collections message for N seconds,
// while calling a few read ops, to find reads that announce changes.
import { newApi, OWNER } from './lib.mjs';
const PORT = Number(process.env.HR_PORT ?? 3189);
const base = `http://127.0.0.1:${PORT}`;
const secs = Number(process.argv[2] ?? 15);
const ctrl = new AbortController();
const res = await fetch(base + '/api/realtime', { signal: ctrl.signal });
const reader = res.body.getReader();
const dec = new TextDecoder();
let buf = '';
let clientId = '';
const t0 = Date.now();
const api = newApi();
(async () => {
  for (;;) {
    const { value, done } = await reader.read().catch(() => ({ done: true }));
    if (done) return;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const ev = /event:(.*)/.exec(chunk)?.[1]?.trim();
      const data = /data:(.*)/.exec(chunk)?.[1]?.trim();
      if (ev === 'PB_CONNECT') {
        clientId = JSON.parse(data).clientId;
        await fetch(base + '/api/realtime', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientId, subscriptions: ['hr'] }) });
        console.log('subscribed', clientId);
      } else console.log(((Date.now() - t0) / 1000).toFixed(1) + 's', ev, data);
    }
  }
})();
await new Promise((r) => setTimeout(r, 1500));
for (const [name, p] of [['perf.home', {}], ['reviews.list', { view: 'to_write' }], ['feedback.list', { view: 'requests' }], ['app.home', {}], ['goals.list', {}], ['skills.matrix', {}], ['trainings.list', {}], ['perf.profile', { employee: 'E0005' }]]) {
  const r = await api.call(name, p, OWNER);
  console.log(((Date.now() - t0) / 1000).toFixed(1) + 's called', name, r.status);
  await new Promise((r2) => setTimeout(r2, 700));
}
await new Promise((r) => setTimeout(r, secs * 1000));
ctrl.abort();
process.exit(0);
