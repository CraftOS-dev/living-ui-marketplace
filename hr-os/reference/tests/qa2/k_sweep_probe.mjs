// QA2 probe: the kernel-backend t03 seeded read sweep (every GET op as five
// callers with sampled required params), timed per call with a 60 s abort, to
// find the read that left kernel t03 waiting over 300 s for headers.
// Run from <suite copy>/reference/tests/kernel-backend/ with HR_APP and HR_PORT set,
// on a seeded scratch database:  node k_sweep_probe.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP, PORT, newApi, sample } from './lib.mjs';

const api = newApi();
const O = { as: 'owner' };
const all = (await api.op('people.directory', { status: 'all', limit: 100 }, O)).people;
const sam = all.find((p) => p.work_email === 'sam@northwind.test');
const manifest = JSON.parse(readFileSync(join(APP, 'operations.json'), 'utf8'));
const reads = manifest.operations.filter((o) => !o.system && o.executor.method === 'GET');
const ctx = { employee: sam.number, employment: sam.employment, entity: 'Northwind Pte Ltd', calendar: 'SG' };
const rows = [];
for (const as of ['owner', 'eng.lead@northwind.test', 'sam@northwind.test', 'hr@northwind.test', 'agent']) {
  await api.op('auth.me', {}, { as }).catch(() => null);
  for (const o of reads) {
    const params = {};
    for (const [k, d] of Object.entries(o.params)) if (d.required) params[k] = sample(k, ctx);
    const t0 = performance.now();
    let status = 0;
    let note = '';
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 60000);
    try {
      const r = await Promise.race([
        api.call(o.name, params, { as }),
        new Promise((_, rej) => ac.signal.addEventListener('abort', () => rej(new Error('no answer in 60 s')))),
      ]);
      status = r.status;
    } catch (err) {
      note = String(err.message || err).slice(0, 200);
    }
    clearTimeout(timer);
    const ms = Math.round(performance.now() - t0);
    rows.push({ as, op: o.name, params, status, ms, note });
    if (ms > 5000 || note) console.log('SLOW ' + as + ' ' + o.name + ' ' + JSON.stringify(params) + ' -> ' + status + ' ' + ms + ' ms ' + note);
  }
  console.log(as + ': ' + reads.length + ' reads, max ' + Math.max(...rows.filter((r) => r.as === as).map((r) => r.ms)) + ' ms');
}
writeFileSync(join(APP, '..', 'results', 'k_sweep_probe_' + PORT + '.json'), JSON.stringify(rows.sort((a, b) => b.ms - a.ms).slice(0, 40), null, 1));
