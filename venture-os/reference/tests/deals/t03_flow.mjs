// Deals module: the pipeline. Funnel figures from real moves, stalled deals, the stall Next items and
// their actions (Move with a stage chip, Pass with a reason chip, Snooze), the 08:00 stall notice once,
// merges as your AI agent's proposal accepted by a person (with undo), other pipelines on first use.
import { newApi, fresh, setupFirm, member, section, ok, eq, refuses, summary } from './lib.mjs';

fresh();
const api = newApi();
await setupFirm(api);
const partner = await member(api, 'partner@venture.test', 'partner', 'Pat Partner');
const partner2 = await member(api, 'paula@venture.test', 'partner', 'Paula Second');
const analyst = await member(api, 'analyst@venture.test', 'analyst', 'Ana Analyst');

const mk = async (domain, as = partner) => (await api.op('deals.create', { company: domain, name: domain.split('.')[0] }, { as })).deal;
const a = await mk('alpha.io');
const b = await mk('beta.io');
const c = await mk('gamma.io');
const d = await mk('delta.io');
const e = await mk('eps.io', partner2);

section('Funnel this quarter');
await api.op('deals.move', { deal: a.id, stage: 'screen' }, { as: partner });
await api.op('deals.move', { deal: a.id, stage: 'first_meeting' }, { as: partner });
await api.op('deals.move', { deal: b.id, stage: 'screen' }, { as: partner });
await api.op('deals.move', { deal: c.id, stage: 'diligence' }, { as: partner });
await api.op('deals.status', { deal: d.id, status: 'passed', reason: 'Market' }, { as: partner });
// The cohort: five intake items this quarter; three advanced (deals at Screen), one of them on to First
// meeting, one straight to Diligence (skipping First meeting), one passed at Screen.
const inItems = [];
for (const co of ['in-one.io', 'in-two.io', 'in-three.io', 'in-four.io', 'in-five.io']) inItems.push(await api.op('intake.add', { company: co }, { as: partner }));
const adv = [];
for (const it of inItems.slice(0, 3)) adv.push((await api.op('intake.advance', { item: it.id }, { as: partner })).deal);
await api.op('deals.move', { deal: adv[0].id, stage: 'first_meeting' }, { as: partner });
await api.op('deals.move', { deal: adv[1].id, stage: 'diligence' }, { as: partner });
await api.op('deals.status', { deal: adv[2].id, status: 'passed', reason: 'Market' }, { as: partner });
{
  const f = await api.op('deals.funnel', {}, { as: partner });
  const by = Object.fromEntries(f.stages.map((s) => [s.key, s]));
  eq(f.stages[0].key, 'inbound', 'the first bar is Inbound');
  eq([by.inbound.count, by.sourced.count, by.screen.count, by.first_meeting.count, by.diligence.count, by.partner_meeting.count], [5, 3, 3, 2, 1, 0], 'the cohort: 5 received, 3 advanced, 2 reached First meeting or later, 1 Diligence (deals made outside the Inbox are not in it)');
  eq(f.cohort, 5, 'cohort size');
  eq([by.sourced.conversion_ppm, by.screen.conversion_ppm, by.first_meeting.conversion_ppm, by.diligence.conversion_ppm, by.partner_meeting.conversion_ppm], [600000, 1000000, 666667, 500000, 0], 'each percentage is its bar over the bar before');
  ok(f.stages.every((s, i) => i === 0 || s.count <= f.stages[i - 1].count), 'bars only shrink');
  eq([by.sourced.now, by.screen.now, by.first_meeting.now, by.diligence.now], [1, 1, 2, 2], 'deals in each stage now (passed deals leave)');
  eq(by.inbound.now, null, 'Inbound has no now');
}
{
  const f = await api.op('deals.funnel', { quarter: '2020-Q1' }, { as: partner });
  ok(f.cohort === 0 && f.stages.every((s) => s.count === 0 && s.conversion_ppm === null), 'an old quarter has no cohort');
  const fa = await api.op('deals.funnel', {}, { as: 'agent' });
  ok(fa.stages.length === 9 && fa.cohort === 5, 'your AI agent reads the funnel');
}

section('Stalls');
await api.op('zz.backdate', { deal: a.id, days: '9' }, { as: 'owner' });
await api.op('zz.backdate', { deal: b.id, days: '3' }, { as: 'owner' });
await api.op('zz.backdate', { deal: e.id, days: '30' }, { as: 'owner' });
{
  const s = await api.op('deals.stalls', {}, { as: partner });
  eq(s.deals.map((x) => x.number).sort(), [a.number, e.number].sort(), 'a (9 days at First meeting, stall at 7) and e (30 days at Sourced) are stalled');
  const mine = await api.op('deals.stalls', { point: 'me' }, { as: partner });
  eq(mine.deals.map((x) => x.number), [a.number], 'mine only');
  ok(mine.deals[0].days_in_stage >= 8 && mine.deals[0].stall_days === 7, 'days in stage and the stall setting');
  const board = await api.op('deals.board', {}, { as: partner });
  const fm = board.stages.find((x) => x.key === 'first_meeting');
  ok(fm.deals[0].stalled === true, 'the board flags it too (the amber edge)');
}

section('Stall Next items and their actions');
let item;
{
  const n = await api.op('next.list', { kinds: 'stall' }, { as: partner });
  eq(n.items.map((i) => i.title), ['alpha'], 'Pat sees only his stalled deal');
  item = n.items[0];
  eq([item.kind, item.rank, item.module, item.href], ['stall', 60, 'deals', '#/deals/' + a.number], 'kind stall, rank 60, links the deal');
  eq(item.actions.map((x) => x.label), ['Move', 'Pass', 'Snooze'], 'Move, Pass, Snooze');
  eq(item.actions[0].choose.options.map((o) => o.value), ['diligence', 'partner_meeting', 'ic', 'term_sheet', 'closed'], 'Move offers the later stages as chips');
  ok(item.actions[1].choose.param === 'reason' && item.actions[1].choose.options.length === 8, 'Pass asks for a reason chip');
  const n2 = await api.op('next.list', { kinds: 'stall' }, { as: partner2 });
  eq(n2.items.map((i) => i.title), ['eps'], 'Paula sees hers');
  const na = await api.op('next.list', { kinds: 'stall' }, { as: analyst });
  eq(na.items.length, 0, 'an analyst (not point) sees none');
}
{
  const sn = item.actions[2];
  await api.op(sn.op, sn.params, { as: partner });
  const n = await api.op('next.list', { kinds: 'stall' }, { as: partner });
  ok(n.items.length === 0 && n.snoozed === 1, 'Snooze hides it for a week');
  await api.op('next.snooze', { key: item.key, until: '' }, { as: partner });
  const mv = item.actions[0];
  const moved = await api.op(mv.op, Object.assign({}, mv.params, { stage: 'diligence' }), { as: partner });
  ok(moved.deal.stage === 'diligence', 'Move with the chosen chip moves the deal');
  const n3 = await api.op('next.list', { kinds: 'stall' }, { as: partner });
  eq(n3.items.length, 0, 'no longer stalled');
}
{
  const n = await api.op('next.list', { kinds: 'stall' }, { as: partner2 });
  const ps = n.items[0].actions[1];
  const r = await api.op(ps.op, Object.assign({}, ps.params, { reason: 'Timing' }), { as: partner2 });
  // One pass flow for every deal (qa-cli RULING CLI-03): the stall card passes through passes.create and keeps a pass.
  const dd = await api.op('deals.get', { deal: r.deal.id }, { as: partner2 });
  ok(r.deal.status === 'passed' && dd.deal.status_reason === 'Timing' && r.pass && r.pass.reason === 'timing', 'Pass with a reason chip (and its pass kept)', { deal: r.deal, pass: r.pass && r.pass.reason });
}

section('The morning stall notice: once per stall');
const f2 = await mk('zeta.io');
await api.op('zz.backdate', { deal: f2.id, days: '12' }, { as: 'owner' });
{
  const r1 = await api.op('zz.cron', { fn: 'lib_deals_flow.stallCron' }, { as: 'owner' });
  eq(r1.result, 1, 'one notice');
  const nl = await api.op('notifications.list', {}, { as: partner });
  ok(nl.notifications.some((x) => x.kind === 'stall' && x.title.indexOf('zeta') === 0), 'Pat is told zeta stalled');
  await api.op('notifications.read-all', {}, { as: partner });
  const r2 = await api.op('zz.cron', { fn: 'lib_deals_flow.stallCron' }, { as: 'owner' });
  eq(r2.result, 0, 'read or not, the same stall is not told twice');
}

section('Merging a duplicate: your AI agent proposes, a person accepts, Undo restores');
const dup = await (async () => {
  await api.op('deals.status', { deal: b.id, status: 'lost', reason: 'Duplicate test' }, { as: partner });
  return (await api.op('deals.create', { company: 'beta.io', name: 'beta again' }, { as: partner })).deal;
})();
const keep = (await api.op('deals.create', { company: 'beta-labs.io', name: 'beta labs' }, { as: partner })).deal;
const nn = (await api.op('notes.create', { deal: dup.id, sections: { team: 'dup note' }, save: true }, { as: partner })).note;
await api.op('tasks.save', { title: 'Call beta', ref_collection: 'deals', ref_id: dup.id, due_day: '2026-12-01' }, { as: partner });
await api.op('deals.team', { deal: dup.id, add: JSON.stringify([partner2]) }, { as: partner });
await refuses(api, 'deals.merge', { keep: keep.id, drop: keep.id }, { as: partner }, 400, 'invalid_param', 'a deal does not merge into itself');
const prop = await api.op('deals.merge', { keep: keep.id, drop: dup.id, why: 'Same founders, same deck', evidence: 'beta labs is beta', confidence: 0.8 }, { as: 'agent' });
ok(prop.proposed === true && prop.label.indexOf('Merge ' + dup.number + ' into ' + keep.number) === 0, 'for your AI agent a merge is a proposal: ' + prop.label);
const acc = await api.op('proposals.accept', { proposal: prop.proposal }, { as: partner });
ok(acc.applied === 1, 'the partner accepts');
{
  const k = (await api.op('deals.get', { deal: keep.id }, { as: partner })).deal;
  ok(k.team.some((m) => m.name === 'Paula Second'), 'the team moved');
  const notes = await api.op('notes.list', { deal: keep.id }, { as: partner });
  ok(notes.notes.some((x) => x.id === nn.id), 'the note moved');
  const tasks = await api.op('tasks.list', { deal: keep.id, view: 'all' }, { as: partner });
  ok(tasks.tasks.some((t) => t.title === 'Call beta' && t.ref_id === keep.id), 'the task moved');
  // lib_deals.ref (kernel-records) answers 404 for a soft-deleted deal before it reads aliases; the alias row is written for when it does.
  await refuses(api, 'deals.get', { deal: dup.id }, { as: partner }, 404, 'not_found', 'the dropped deal is gone from the pipeline');
  const bd = await api.op('deals.list', { q: dup.number }, { as: partner });
  eq(bd.total, 0, 'and from lists');
  await api.op('activity.undo', { entry: acc.activity[0] }, { as: partner });
  const back = await api.op('deals.get', { deal: dup.id }, { as: partner });
  ok(back.deal.id === dup.id, 'Undo restores the dropped deal');
  const nb = await api.op('notes.list', { deal: dup.id }, { as: partner });
  ok(nb.notes.some((x) => x.id === nn.id), 'and its note');
}

section('Agent rules on the pipeline');
{
  const mv = await api.op('deals.move', { deal: c.id, stage: 'ic', evidence: 'IC next week', why: 'Ready' }, { as: 'agent' });
  ok(mv.proposed === true, 'a move by your AI agent is a proposal');
  await refuses(api, 'deals.status', { deal: c.id, status: 'passed' }, { as: 'agent' }, 403, 'agent_not_permitted', 'your AI agent never passes a deal');
  await refuses(api, 'deals.merge', { keep: keep.id, drop: dup.id }, { as: analyst }, 403, 'not_permitted', 'an analyst cannot merge');
}

section('The committee decides: the deal follows (decision.recorded)');
{
  const ic = await mk('ic-co.io');
  await api.op('deals.move', { deal: ic.id, stage: 'ic' }, { as: partner });
  const emit = (outcome, extra = {}) => api.op('zz.emit', { event: 'decision.recorded', payload: JSON.stringify(Object.assign({ decision: 'dec000000000001', deal: ic.id, outcome }, extra)) }, { as: 'owner' });
  const get = async () => (await api.op('deals.get', { deal: ic.id }, { as: partner })).deal;
  await emit('more_diligence');
  eq((await get()).stage, 'diligence', 'more diligence: back to Diligence');
  await emit('hold');
  eq((await get()).status, 'hold', 'hold: on hold');
  await emit('invest', { corrects: 'dec000000000001' });
  const d = await get();
  eq([d.status, d.stage], ['open', 'term_sheet'], 'invest (a correction): reopened and at Term sheet');
  await emit('pass');
  const p = await get();
  eq([p.status, p.status_reason], ['passed', 'IC decision: pass'], 'pass: passed with the reason');
}

section('Other pipelines on first use; the same board');
{
  const s = await mk('spv-target.io');
  const sp = (await api.op('deals.create', { company: 'spv-target.io', pipeline: 'spv', name: 'SPV for spv-target' }, { as: partner })).deal;
  ok(sp.pipeline.key === 'spv' && sp.stage === 'sourced', 'an SPV pipeline appears on first use');
  const pl = await api.op('pipelines.list', {}, { as: partner });
  eq(pl.pipelines.map((p) => p.key), ['deal_flow', 'spv'], 'two pipelines now');
  const bd = await api.op('deals.board', { pipeline: 'spv' }, { as: partner });
  eq(bd.stages.map((x) => x.label), ['Sourced', 'Allocation', 'Documents', 'Funding', 'Closed'], 'its board');
  const fu = await api.op('deals.funnel', { pipeline: 'spv' }, { as: partner });
  eq([fu.stages[0].key, fu.stages[0].count, fu.cohort], ['sourced', 1, 1], 'its funnel: the deals created this quarter, no Inbound bar');
  ok(s.pipeline === 'deal_flow' || s.pipeline.key === 'deal_flow', 'the deal flow deal stays');
}

summary('t03_flow');
