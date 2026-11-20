// Manual probe against the markets scratch server (not part of run_all):
//   node tests/smoke.mjs <op> '<json params>' [as]
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
const APP = process.env.VO_APP ?? join(HERE, '..', 'app');
const { client } = await import('file:///' + join(APP, 'tools', 'dev', 'api.mjs').replace(/\\/g, '/'));
const api = client({ port: Number(process.env.VO_PORT ?? 3191), app: APP });
const [op, params, as] = process.argv.slice(2);
const r = await api.call(op, JSON.parse(params || '{}'), { as: as || 'owner' });
console.log(r.status, JSON.stringify(r.body, null, 1));
