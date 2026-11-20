// attendance.board at scale: timing (best of 5, client and server ms) and the
// answers for several callers and days, kept to compare before and after a change.
//   node board_check.mjs <out.json> [<before.json>]
// With a before file it compares (late minutes of people late right now move
// with the clock, so they are left out of the comparison).
import { readFileSync, writeFileSync } from 'node:fs';
import { newApi, dayAdd } from './lib.mjs';

const api = newApi();
const out = process.argv[2];
const before = process.argv[3] ? JSON.parse(readFileSync(process.argv[3], 'utf8')) : null;
const HR = { as: 'hr@scale.test' };
const today = (await api.op('attendance.board', {}, HR)).today;
const cases = [
  ['owner today', {}, { as: 'owner' }],
  ['hr today', {}, HR],
  ['manager today', {}, { as: 'mgr@scale.test' }],
  ['employee today', {}, { as: 'emp@scale.test' }],
  ['agent today', {}, { as: 'agent' }],
  ['hr yesterday', { day: dayAdd(today, -1) }, HR],
  ['hr 3 days ago', { day: dayAdd(today, -3) }, HR],
  ['hr in 2 days', { day: dayAdd(today, 2) }, HR],
  ['manager yesterday', { day: dayAdd(today, -1) }, { as: 'mgr@scale.test' }],
  ['hr team', { team: true }, HR],
];
const res = {};
for (const [name, p, o] of cases) {
  const ms = [];
  const server = [];
  let body = null;
  for (let k = 0; k < 5; k++) {
    const t0 = performance.now();
    const r = await api.call('attendance.board', p, o);
    ms.push(Math.round(performance.now() - t0));
    const st = r.headers.get('server-timing') || '';
    const m = /dur=([0-9.]+)/.exec(st);
    server.push(m ? Math.round(Number(m[1])) : null);
    body = { status: r.status, body: r.body };
  }
  res[name] = { ms, server, best: Math.min(...ms), best_server: Math.min(...server.filter((x) => x !== null)), people: body.body && body.body.people ? body.body.people.length : 0, body };
  console.log(name.padEnd(18), String(res[name].people).padStart(4), 'people', 'best', res[name].best, 'ms (server', res[name].best_server + ')', ms.join('/'));
}
writeFileSync(out, JSON.stringify(res));
if (before !== null) {
  const norm = (b) => {
    const x = JSON.parse(JSON.stringify(b));
    if (x && x.body && Array.isArray(x.body.people)) for (const r of x.body.people) if (r.state === 'late') r.late_min = 'moving';
    return JSON.stringify(x);
  };
  let same = 0;
  for (const k of Object.keys(res)) {
    if (norm(res[k].body) === norm(before[k].body)) same++;
    else {
      const a = before[k].body.body.people || [];
      const b = res[k].body.body.people || [];
      console.log('DIFF', k, 'status', before[k].body.status, res[k].body.status, 'people', a.length, b.length);
      for (let i = 0; i < Math.max(a.length, b.length); i++) if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) { console.log('  before', JSON.stringify(a[i]).slice(0, 400)); console.log('  after ', JSON.stringify(b[i]).slice(0, 400)); break; }
    }
  }
  console.log(same === Object.keys(res).length ? 'BOARD SAME (' + same + ' cases)' : 'BOARD DIFFERS in ' + (Object.keys(res).length - same) + ' cases');
}
