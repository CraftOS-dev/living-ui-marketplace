// QA t03b: every agent read on the seeded demo timed twice in isolation
// (the t03 sweep ran next to another server's test); lists reads over 1.5 s.
import { newApi, catalog, timed, dummyParams, writeResult, AG } from './lib.mjs';
const api = newApi();
const dir = (await api.op('people.directory', { status: 'all', limit: 500 }, { as: 'owner' })).people;
const sam = dir.find((p) => p.number === 'E0005');
const ents = (await api.op('entities.list', {}, { as: 'owner' })).entities;
const S = { employment: sam.employment, employee: sam.employee, entity: ents[0].id, type: 'annual', day: '2026-11-02' };
const out = [];
for (const op of catalog().filter((o) => o.effect === 'read' && o.agent !== 'deny')) {
  const a = await timed(api, op.name, dummyParams(op, S), AG);
  const b = await timed(api, op.name, dummyParams(op, S), AG);
  out.push({ op: op.name, ms: [Math.round(a.ms), Math.round(b.ms)], server: [a.server, b.server], status: a.status });
}
out.sort((x, y) => Math.min(...y.ms) - Math.min(...x.ms));
writeResult('t03b_read_times.json', out);
for (const r of out.slice(0, 15)) console.log(r.op.padEnd(28), r.status, r.ms.join(' / '), 'server', r.server.join(' / '));
console.log('over 1.5 s on both tries: ' + out.filter((r) => Math.min(...r.ms) > 1500).length + ' of ' + out.length);
