// home.summary with 5,000 deals (SPEC 7.13 brief: under 200 ms). On the database as it is (run after t01 on
// the empty firm, or on the demo firm): adds deals until 5,000 exist (deals.create in parallel, moved
// through the first stages so the funnel has work), then times home.summary warm (server side, the
// `ms` it reports, and each block) and once right after a change (Next and the funnel rebuilt).
import { newApi, ok, section, summary } from './lib.mjs';

const api = newApi();
const O = { as: 'owner' };
const TARGET = Number(process.env.VO_DEALS ?? 5000);
const have = (await api.op('deals.list', { status: 'all', limit: 1 }, O)).total ?? 0;
section(`deals: ${have} now, ${TARGET} wanted`);
const STAGES = ['screen', 'first_meeting', 'diligence', 'partner_meeting'];
let made = 0;
const work = [];
for (let i = have; i < TARGET; i++) work.push(i);
const t0 = Date.now();
async function worker() {
  while (work.length > 0) {
    const i = work.shift();
    const d = await api.call('deals.create', { company: `Perf Company ${i}`, round_type: 'seed', raise: '3000000', post_money: '15000000', check: '1000000', currency: 'USD', instrument: 'safe_cap' }, O);
    if (d.status !== 200) continue;
    made++;
    // One deal in ten moves on through the first stages (the funnel has conversions to compute).
    const num = d.body.deal?.number ?? d.body.number;
    if (i % 10 === 0) for (let s = 0; s < 1 + (i % 4); s++) await api.call('deals.move', { deal: num, stage: STAGES[s] }, O);
    if (made % 500 === 0) console.log(`  ${made} deals in ${Math.round((Date.now() - t0) / 1000)} s`);
  }
}
await Promise.all(Array.from({ length: 12 }, worker));
const total = (await api.op('deals.list', { status: 'all', limit: 1 }, O)).total;
ok(total >= TARGET, `${total} deals`);

section('timing');
await api.op('home.summary', {}, O);
const runs = [];
for (let i = 0; i < 10; i++) {
  const r = await api.op('home.summary', {}, O);
  runs.push(r);
}
const ms = runs.map((r) => r.ms).sort((a, b) => a - b);
console.log('  blocks (last run): ' + JSON.stringify(runs.at(-1).timing));
ok(ms[5] < 200, `home.summary warm: median ${ms[5]} ms, max ${ms.at(-1)} ms with ${total} deals`, ms);
ok(runs.at(-1).funnel.open >= 1000, `the funnel counts them (${runs.at(-1).funnel.open} open)`);
// Right after a change: one deal moves, Next and the funnel are built again.
const one = (await api.op('deals.list', { status: 'open', limit: 1 }, O)).deals[0];
await api.op('deals.move', { deal: one.number, stage: 'diligence' }, O);
const after = await api.op('home.summary', {}, O);
console.log('  after a change: ' + after.ms + ' ms ' + JSON.stringify(after.timing));
ok(after.ms < 1500, `after a change: ${after.ms} ms (Next rebuilt by the kernel: ${after.timing.next} ms)`);

const res = summary('t03_perf');
process.exit(res.failed > 0 ? 1 : 0);
