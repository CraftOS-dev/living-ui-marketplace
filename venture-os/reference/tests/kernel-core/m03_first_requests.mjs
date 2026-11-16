// First requests on a freshly started server, as a browser makes them: the
// page-load reads fired together (Home and the module landing pages), then
// each landing read alone. Server time from Server-Timing; wall from the client.
//   VO_APP=<scratch copy of APP> VO_PORT=3181 node m03_first_requests.mjs
//   (PB_SERVE_FLAGS=--hooksPool=120 compares a bigger runtime pool)
import { fresh, member, newApi, ok, restart, section, setupFirm, summary } from './lib.mjs';

fresh();
const api = newApi();
await setupFirm(api);
const O = { as: 'owner' };
await member(api, 'partner@venture.test', 'partner', 'Paul Partner');
const PA = { as: 'partner@venture.test' };

section('seed');
for (let i = 0; i < 15; i++) await api.op('deals.create', { company: 'Board Co ' + i, round_type: 'seed', raise: '2000000', currency: 'USD' }, PA);
for (let i = 0; i < 8; i++) await api.op('intake.add', { channel: 'upload', name: 'Inbound ' + i, website: 'https://inbound' + i + '.io', text: 'We are raising a seed round.' }, PA).catch((e) => console.log('  (intake.add: ' + e.message + ')'));
const today = (await api.op('app.today', {}, PA)).today;
for (let i = 0; i < 6; i++) await api.op('tasks.save', { title: 'Call ' + i, due_day: today }, PA);
ok(true, 'seeded');

async function timed(name, params) {
  const t0 = Date.now();
  const r = await api.call(name, params || {}, PA);
  const server = Number(/dur=(\d+)/.exec(r.headers.get('server-timing') || '')?.[1] || -1);
  return { name, status: r.status, server, wall: Date.now() - t0 };
}

const PAGE = [
  ['auth.me', {}],
  ['next.count', {}],
  ['next.list', { limit: 50 }],
  ['app.today', {}],
  ['deals.board', {}],
  ['intake.list', {}],
  ['funds.list', {}],
  ['holdings.list', {}],
  ['network.people', {}],
  ['notifications.list', {}],
];

section('page load after a restart (all together), pool flags: ' + (process.env.PB_SERVE_FLAGS || 'default'));
await api.op('auth.me', {}, PA);
restart();
const t0 = Date.now();
const all = await Promise.all(PAGE.map(([n, p]) => timed(n, p)));
const span = Date.now() - t0;
for (const r of all) console.log('    ' + r.name.padEnd(20) + ' status ' + r.status + '  server ' + String(r.server).padStart(5) + ' ms  wall ' + String(r.wall).padStart(5) + ' ms');
ok(all.every((r) => r.status < 500), 'no server errors');
ok(span < 1500, 'the whole page load answered in ' + span + ' ms');

section('the same page load as one app.batch after a restart');
restart();
const b0 = Date.now();
const br = await api.call('app.batch', { calls: JSON.stringify(PAGE.map(([op, params]) => ({ op, params }))) }, PA);
const bWall = Date.now() - b0;
const bServer = Number(/dur=(\d+)/.exec(br.headers.get('server-timing') || '')?.[1] || -1);
ok(br.status === 200 && br.body.results.length === PAGE.length && br.body.results.every((x) => x.status === 200), 'every call answered 200', br.body && br.body.results && br.body.results.map((x) => x.op + ' ' + x.status + ' ' + (x.message || '')));
console.log('    app.batch (' + PAGE.length + ' reads)   server ' + String(bServer).padStart(5) + ' ms  wall ' + String(bWall).padStart(5) + ' ms');
ok(bWall < 1500, 'the batched page load answered in ' + bWall + ' ms');
const bb = await api.call('app.batch', { calls: JSON.stringify([{ op: 'tasks.save', params: {} }, { op: 'nope.op' }, { op: 'next.count' }]) }, PA);
ok(bb.body.results[0].status === 400 && bb.body.results[1].status === 404 && bb.body.results[2].status === 200, 'writes and unknown ops are refused per call; the rest answer', bb.body.results);

section('each landing read alone after a restart');
for (const [n, p] of [PAGE[2], PAGE[4], PAGE[6]]) {
  restart();
  const r = await timed(n, p);
  console.log('    ' + n.padEnd(20) + ' server ' + String(r.server).padStart(5) + ' ms  wall ' + String(r.wall).padStart(5) + ' ms');
  ok(r.status < 500 && r.server < 500, n + ' first call ' + r.server + ' ms');
}

const s = summary('m03_first_requests');
process.exitCode = s.failed > 0 ? 1 : 0;
