// Probe: run every home and report read on the current database and print timing and a summary.
//   node probe.mjs [as] [op ...]
import { newApi, READS } from './lib.mjs';

const api = newApi();
const as = process.argv[2] || 'owner';
const only = process.argv.slice(3);
const list = [...READS, ['home.directory', {}]].filter(([n]) => only.length === 0 || only.includes(n));
for (const [name, params] of list) {
  const t0 = Date.now();
  const r = await api.call(name, params, { as });
  const ms = Date.now() - t0;
  const b = r.body || {};
  const brief = r.status >= 400 ? JSON.stringify(b).slice(0, 300) : JSON.stringify(b.readouts || b.total || b.groups || b.counts || Object.keys(b)).slice(0, 300);
  console.log(`${String(r.status).padEnd(4)} ${String(ms).padStart(5)}ms ${name} ${JSON.stringify(params)}  ${brief}`);
}
