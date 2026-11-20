// t04: Gmail capture pages by time windows until caught up. 260 messages (150 of them in the last six
// hours, more than one search page) behind a bridge that answers each header in about 70 ms: one run
// stays under about 20 seconds and resumes where it stopped; every message is read once; the window with
// a full page is split; the cursor reports caught up at the end.
import { spawn, execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP, BRIDGE, eq, firm, fresh, newApi, ok, section, sleep, summary } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
await fresh({
  ownBridge: async () => {
    execFileSync('bash', [join(APP, 'tools', 'dev', 'stop.sh'), String(BRIDGE)], { stdio: 'pipe' });
    spawn(process.execPath, [join(HERE, 'mock_paging.mjs'), String(BRIDGE), '260', '70'], { detached: true, stdio: 'ignore' }).unref();
    for (let i = 0; i < 50; i++) {
      try {
        if ((await fetch(`http://127.0.0.1:${BRIDGE}/__mock/health`)).ok) break;
      } catch {
        /* starting */
      }
      await sleep(100);
    }
  },
});
const api = newApi();
const { O } = await firm(api);
await api.op('capture.consent', { consent: true }, O);
const stats = async () => (await fetch(`http://127.0.0.1:${BRIDGE}/__mock/stats`)).json();

section('first run stops at its time cap');
let t = Date.now();
const r1 = await api.op('capture.sync', { what: 'mail' }, O);
const d1 = Date.now() - t;
const m1 = r1.mail[0];
ok(d1 < 20000, 'one run took ' + Math.round(d1 / 1000) + ' s (under about 20 s)', d1);
ok(m1.read > 100 && m1.read < 260 && m1.caught_up === false, 'it read ' + m1.read + ' headers and is not caught up yet', m1);
ok(m1.searches >= 4, 'the day with a full page was split into smaller windows (' + m1.searches + ' searches)', m1.searches);
const after1 = (await api.op('interactions.list', { limit: 1 }, O)).total;
eq(after1, m1.logged, 'every header read became a touch');

section('the next runs resume until caught up');
let rounds = 1;
let last = m1;
while (!last.caught_up && rounds < 5) {
  await sleep(31000);
  t = Date.now();
  const r = await api.op('capture.sync', { what: 'mail' }, O);
  ok(Date.now() - t < 20000, 'run ' + (rounds + 1) + ' under about 20 s', Date.now() - t);
  last = r.mail[0];
  rounds++;
}
ok(last.caught_up === true, 'caught up after ' + rounds + ' runs', last);
const total = (await api.op('interactions.list', { limit: 1 }, O)).total;
eq(total, 260, 'all 260 messages are touches, none twice');
const s = await stats();
eq(s.gets, 260, 'each header was fetched exactly once');
const st = await api.op('capture.status', {}, O);
ok(st.sources.mail_owner.counts.caught_up === true && st.sources.mail_owner.counts.backfill_days >= 30, 'capture.status shows the mailbox caught up with 30 days read', st.sources.mail_owner.counts);

section('a later run reads only new mail');
await sleep(31000);
const r3 = await api.op('capture.sync', { what: 'mail' }, O);
eq([r3.mail[0].read, r3.mail[0].caught_up], [0, true], 'nothing new: no header read, still caught up');

const out = summary('t04_paging');
process.exitCode = out.failed > 0 ? 1 : 0;
