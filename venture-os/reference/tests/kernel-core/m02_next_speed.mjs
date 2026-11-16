// next.list speed on a seeded merged copy of APP: the first call after a
// restart under 500 ms, warm calls under 150 ms (server time, Server-Timing).
//   VO_APP=<scratch copy of APP> VO_PORT=3181 node m02_next_speed.mjs
import { DEMO, PORT, fresh, member, newApi, ok, restart, section, setupFirm, summary } from './lib.mjs';

fresh();
const api = newApi();
await setupFirm(api);
const O = { as: 'owner' };
const A = { as: 'agent' };
await member(api, 'partner@venture.test', 'partner', 'Paul Partner');
const PA = { as: 'partner@venture.test' };

section('seed');
const deals = [];
for (let i = 0; i < 25; i++) {
  const d = await api.op('deals.create', { company: 'Company ' + i, round_type: 'seed', raise: '3000000', currency: 'USD' }, PA);
  deals.push(d.deal || d);
}
for (let i = 0; i < 10; i++) {
  const c = await api.op('companies.upsert', { name: 'Proposal Co ' + i, domain: 'proposal' + i + '.com', sector: 'fintech' }, PA);
  await api.op('companies.update', { company: (c.company || c).id, sector: 'payments ' + i, why: 'deck' }, A);
}
for (let i = 0; i < 10; i++) await api.op('outbound.draft', { kind: 'pass', module: 'intake', to: '["f' + i + '@co.com"]', subject: 'Pass ' + i, body: 'Thank you.', deal: deals[i].number }, A);
const today = (await api.op('app.today', {}, PA)).today;
for (let i = 0; i < 10; i++) await api.op('tasks.save', { title: 'Follow up ' + i, due_day: today, ref_collection: 'deals', ref_id: deals[i].id }, PA);
const n0 = await api.op('next.list', {}, PA);
ok(n0.total >= 30, 'seeded Next has ' + n0.total + ' items', n0.errors);

// Sessions are signed in before the restart and reused (a sign-in is a write: it would move the data version).
async function timed(as) {
  const t0 = Date.now();
  const r = await api.call('next.list', {}, { as: as });
  const wall = Date.now() - t0;
  const server = Number(/dur=(\d+)/.exec(r.headers.get('server-timing') || '')?.[1] || -1);
  return { status: r.status, wall, server, total: r.body && r.body.total };
}

section('speed');
await api.op('auth.me', {}, PA);
await api.op('auth.me', {}, O);
restart();
await new Promise((r) => setTimeout(r, 300));
const first = await timed('partner@venture.test');
ok(first.status === 200 && first.server < 500, 'first next.list after a restart: server ' + first.server + ' ms (wall ' + first.wall + ' ms)', first);
const warm = [];
for (let i = 0; i < 30; i++) warm.push((await timed('partner@venture.test')).server);
warm.sort((a, b) => a - b);
const p90 = warm[26];
ok(p90 < 150, 'warm next.list (30 calls): median ' + warm[15] + ' ms, 90th percentile ' + p90 + ' ms, max ' + warm[29] + ' ms (a max above is a pooled runtime serving its first request)', warm);
const rebuilt = [];
for (let i = 0; i < 20; i++) {
  await api.op('tasks.save', { title: 'Later ' + i }, PA);
  rebuilt.push((await timed('partner@venture.test')).server);
}
rebuilt.sort((a, b) => a - b);
ok(rebuilt[17] < 150, 'next.list right after a change (rebuilt, 20 calls): median ' + rebuilt[10] + ' ms, 90th percentile ' + rebuilt[17] + ' ms, max ' + rebuilt[19] + ' ms', rebuilt);
const ownerFirst = await timed('owner');
ok(ownerFirst.server < 500, 'another person first call: ' + ownerFirst.server + ' ms', ownerFirst);
console.log('  port ' + PORT);

const s = summary('m02_next_speed');
process.exitCode = s.failed > 0 ? 1 : 0;
