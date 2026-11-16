/**
 * Performance check: 1,000 payslips with three packs must take under 2 s in
 * Node (SPEC engine contract). node tests/bench.mjs [n]
 */
import { createRequire } from 'node:module';
import { load, hooks } from './_harness.mjs';

const require = createRequire(import.meta.url);
const B = require('./bench_data.cjs');
const engine = load('lib_engine.js');
const generic = load('packs/generic.js');
const n = Number(process.argv[2] || 1000);
const now = () => Number(process.hrtime.bigint()) / 1e6;
B.run(engine, generic, 20, now);
const cold = B.run(engine, generic, n, now);
const warm = B.run(engine, generic, n, now);
console.log(JSON.stringify({ hooks, n, cold_ms: Math.round(cold.ms), warm_ms: Math.round(warm.ms), per_payslip_ms: +(warm.ms / n).toFixed(3), blockers: warm.blockers, hash: warm.hash, first: warm.first }));
if (cold.ms >= 2000 || warm.blockers > 0) process.exit(1);
