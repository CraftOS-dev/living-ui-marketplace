// Deals module timing on a larger pipeline: 600 deals with moves; deals.funnel, deals.board,
// deals.stalls and next.list (stall items) must stay fast (home.summary calls the funnel).
import { newApi, fresh, setupFirm, member, section, ok, summary } from './lib.mjs';

fresh();
const api = newApi();
await setupFirm(api);
const pat = await member(api, 'pat@venture.test', 'partner', 'Pat Lin');
const N = Number(process.env.VO_DEALS ?? 600);
const order = ['sourced', 'screen', 'first_meeting', 'diligence', 'partner_meeting', 'ic', 'term_sheet'];
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const t0 = Date.now();
const jobs = [];
for (let i = 0; i < N; i++) {
  jobs.push(
    (async () => {
      const d = (await api.op('deals.create', { company: 'co' + i + '.io', name: 'Co ' + i, point: i % 3 === 0 ? pat : undefined }, { as: 'owner' })).deal;
      const to = Math.floor(rnd() * 5);
      for (const s of order.slice(1, to + 1)) await api.op('deals.move', { deal: d.id, stage: s }, { as: 'owner' });
      if (i % 4 === 0) await api.op('zz.backdate', { deal: d.id, days: String(5 + (i % 30)) }, { as: 'owner' });
    })(),
  );
  if (jobs.length >= 8) await Promise.all(jobs.splice(0));
}
await Promise.all(jobs);
console.log('seeded ' + N + ' deals in ' + Math.round((Date.now() - t0) / 1000) + ' s');

const time = async (name, params, as) => {
  await api.op(name, params, { as });
  const s = Date.now();
  const r = await api.op(name, params, { as });
  return { ms: Date.now() - s, r };
};
section('Timing with ' + N + ' deals');
for (const [name, params, as, max] of [
  ['deals.funnel', {}, 'owner', 400],
  ['deals.board', {}, 'owner', 1500],
  ['deals.stalls', {}, 'owner', 1500],
  ['next.list', { kinds: 'stall' }, pat, 1500],
  ['deals.list', { point: 'me' }, pat, 400],
]) {
  const { ms, r } = await time(name, params, as);
  ok(ms < max, name + ' in ' + ms + ' ms (under ' + max + ')', { size: JSON.stringify(r).length });
}
summary('t04_perf');
