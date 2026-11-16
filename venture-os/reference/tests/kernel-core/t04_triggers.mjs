// Triggers (fix 8): one trigger per task with params naming the record, fired from the op where a person
// asks, no job queue. The test kit's zz_review (record zz_things, param thing_id, NDA, lands on zz.save):
// a person's ask fires once with the record; asking again while it waits is refused and fires nothing;
// Retry after 24 hours, after a done request (--again) or after agent.cannot fires once; the result op marks
// it done; NDA files open to your AI agent only while a deal's ask waits; restricted deals; questions
// (chat.ask, get, answer, Next of the asker); the switches; a demo firm never fires.
import { bridge, eq, fresh, member, newApi, ok, refuses, section, setupFirm, sleep, summary } from './lib.mjs';

fresh();
const api = newApi();
await setupFirm(api);
await bridge.reset();
const O = { as: 'owner' };
const A = { as: 'agent' };
await member(api, 'partner@venture.test', 'partner', 'Paul Partner');
const PA = { as: 'partner@venture.test' };
const fired = async () => (await bridge.fires()).fires;
const cool = () => api.op('zz.cool', {}, O);

section('a person asks: one fire with the record');
const t1 = await api.op('zz.make', { name: 'Gamma', ask: true }, O);
await sleep(500);
const f1 = await fired();
eq(f1.map((f) => f.trigger), ['zz_review'], 'exactly one fire, of zz_review');
ok(t1.request !== '' && f1[0].request_id === t1.request, 'the op answers the request id the bridge got', { t1, f1 });
ok(t1.thing.pending === true && t1.thing.agent.zz_review.request === t1.request, 'the record keeps the request (pending)', t1.thing.agent);
const quiet = await api.op('zz.make', { name: 'Nobody asked' }, O);
await sleep(300);
eq([quiet.request, (await fired()).length], ['', 1], 'a write that does not ask fires nothing');

section('asking again while it waits');
await cool();
const r409 = await refuses(api, 'agent.ask', { trigger: 'zz_review', record: t1.thing.id }, O, 409, 'pending', 'asking again for the same record is refused');
ok(/24 hours/.test(r409.body.message) && r409.body.data.request === t1.request, 'in plain words, with the request it waits on', r409.body);
eq((await fired()).length, 1, '0 more fires');
const t2 = await api.op('zz.make', { name: 'Delta', ask: true }, O);
const t3 = await api.op('zz.make', { name: 'Epsilon', ask: true }, O);
ok(t2.request !== '' && t3.request === '', 'another record: 1 fire; a third a moment later is on the cooldown, so not fired now', { t2, t3 });
await sleep(300);
eq((await fired()).length, 2, '2 fires in all');
const strict = await refuses(api, 'agent.ask', { trigger: 'zz_review', record: t3.thing.id }, O, 409, 'cooldown', 'a person asking during the cooldown is told to try again shortly');
ok(/a moment ago/.test(strict.body.message), 'in plain words', strict.body);

section('people only, and the trigger list');
await refuses(api, 'agent.ask', { trigger: 'zz_review', record: t1.thing.id }, A, 403, 'agent_not_permitted', 'your AI agent does not ask itself');
await refuses(api, 'agent.ask', { trigger: 'nope_trigger' }, O, 400, 'invalid_param', 'an unknown trigger is refused');
await refuses(api, 'agent.ask', { trigger: 'question_asked', record: 'x' }, O, 400, 'invalid_param', 'question_asked is asked with chat.ask only');
await refuses(api, 'agent.ask', { trigger: 'zz_review', record: 'nope00000000000' }, O, 404, undefined, 'an unknown record is refused');
await refuses(api, 'agent.cannot', { trigger: 'zz_review', record: t1.thing.id, reason: 'x' }, O, 403, 'agent_only', 'agent.cannot is for your AI agent');
const st = await api.op('settings.get', {}, O);
const zz = st.agent_triggers.find((t) => t.name === 'zz_review');
ok(zz && zz.params[0] === 'thing_id' && zz.record === 'zz_things' && zz.cooldown_seconds === 10, 'settings.get lists the trigger with its param, record and cooldown', zz);
ok(st.agent_triggers.some((t) => t.name === 'question_asked'), 'and the kernel trigger question_asked');
const inv = await api.op('ai.inventory', {}, O);
ok(Array.isArray(inv.triggers) && inv.triggers.every((t) => t.fires !== '' && t.cooldown_seconds >= 10), 'ai.inventory lists every trigger in plain words', inv.triggers);

section('Retry: after 24 hours, after done, after agent.cannot');
await api.op('zz.age', { what: 'asked', id: t1.thing.id, minutes: 25 * 60 }, O);
const g1 = await api.op('zz.get', { thing: t1.thing.id }, O);
ok(g1.thing.pending === false && g1.thing.agent.zz_review.stale === true, 'asked 25 hours ago and not answered: no longer waiting (Retry)', g1.thing.agent);
await cool();
const rt = await api.op('agent.ask', { trigger: 'zz_review', record: t1.thing.id }, O);
await sleep(400);
const f2 = await fired();
ok(f2.length === 3 && f2[2].request_id === rt.request, 'Retry: exactly 1 fire', f2);
await cool();
await refuses(api, 'agent.ask', { trigger: 'zz_review', record: t1.thing.id }, O, 409, 'pending', 'Retry at once again: refused');
await refuses(api, 'agent.ask', { trigger: 'zz_review', record: t1.thing.id, again: 'nope00000000000' }, O, 409, 'pending', '--again with another request is refused');
const ag = await api.op('agent.ask', { trigger: 'zz_review', record: t1.thing.id, again: rt.request }, O);
await sleep(400);
ok(ag.request !== '' && (await fired()).length === 4, 'the screen saw it done or rejected: --again with that request fires once', ag);
const cn = await api.op('agent.cannot', { trigger: 'zz_review', record: t1.thing.id, reason: 'The thing has no value to read; add one first.' }, A);
eq(cn.error, 'The thing has no value to read; add one first.', 'agent.cannot records why');
const g2 = await api.op('zz.get', { thing: t1.thing.id }, PA);
ok(g2.thing.pending === false && g2.thing.agent.zz_review.done_at !== '' && /no value/.test(g2.thing.agent.zz_review.error), 'the person sees why', g2.thing.agent);
await cool();
await api.op('agent.ask', { trigger: 'zz_review', record: t1.thing.id }, O);
await sleep(400);
eq((await fired()).length, 5, 'and may ask again at once: 1 fire');

section('the result op marks it done');
const sv = await api.op('zz.save', { thing: t1.thing.id, value: 7, why: 'Reviewed', evidence: 'the thing', confidence: 0.9 }, A);
ok(sv, 'your AI agent saves its result (zz.save, lands on zz_review)', sv);
const pend = await api.op('proposals.list', { status: 'pending' }, O).catch(() => ({ proposals: [] }));
const prop = (pend.proposals || []).find((p) => p.op === 'zz.save');
if (prop) await api.op('proposals.approve', { proposal: prop.id }, O);
const g3 = await api.op('zz.get', { thing: t1.thing.id }, O);
ok(g3.thing.pending === false && g3.thing.agent.zz_review.done_at !== '' && g3.thing.agent.zz_review.error === '', 'done: not waiting any more', g3.thing.agent);
await cool();
await api.op('agent.ask', { trigger: 'zz_review', record: t1.thing.id }, O);
await sleep(300);
eq((await fired()).length, 6, 'asking again after the result fires once');

section('NDA and restricted deals');
const deal = (await api.op('zz.deal', { company: 'Secret Co', restricted: true, agent_allowed: true }, O)).deal;
const blocked = (await api.op('zz.deal', { company: 'Closed Co', restricted: true }, O)).deal;
const other = (await api.op('zz.deal', { company: 'Other Co' }, O)).deal;
eq((await api.op('zz.nda', { deal: deal.id }, O)).allowed, false, 'NDA files closed to your AI agent before any ask');
await cool();
const tn = await api.op('zz.make', { name: 'Theta', deal: deal.id, ask: true }, O);
ok(tn.request !== '', 'a person asks about a thing of a restricted deal your AI agent may see', tn);
eq((await api.op('zz.nda', { deal: deal.id }, O)).allowed, true, 'NDA files of that deal open while the ask waits');
eq((await api.op('zz.nda', { deal: other.id }, O)).allowed, false, 'not of another deal');
await api.op('agent.cannot', { trigger: 'zz_review', record: tn.thing.id, reason: 'done' }, A);
eq((await api.op('zz.nda', { deal: deal.id }, O)).allowed, false, 'closed again once it is answered');
await cool();
const tb = await api.op('zz.make', { name: 'Iota', deal: blocked.id }, O);
const before = (await fired()).length;
await refuses(api, 'agent.ask', { trigger: 'zz_review', record: tb.thing.id }, O, 409, 'agent_off', 'a deal your AI agent may not see: refused in plain words');
eq((await fired()).length, before, '0 fires');

section('questions');
await refuses(api, 'chat.ask', { text: '   ' }, PA, 400, 'missing_param', 'an empty question is refused');
await refuses(api, 'chat.ask', { text: 'hi' }, A, 403, 'agent_not_permitted', 'chat.ask is for people');
await cool();
const fb = (await fired()).length;
const c1 = await api.op('chat.ask', { text: 'How many funds do we have?', context: '#/home' }, PA);
await sleep(400);
const fc = (await fired()).slice(fb);
ok(c1.ask.status === 'waiting' && c1.ask.request !== '' && fc.length === 1 && fc[0].trigger === 'question_asked', 'chat.ask: a question waiting, 1 fire of question_asked', { c1, fc });
const cg = await api.op('chat.get', { ask: c1.ask.id }, A);
ok(cg.ask.question === 'How many funds do we have?' && cg.ask.asked_by_name === 'Paul Partner' && Array.isArray(cg.ask.asker_next) && cg.ask.local, 'your AI agent reads the question, who asked, their Next and the local time', cg.ask);
const nx = await api.call('next.list', { member: 'partner@venture.test' }, A);
eq(nx.status, 200, "next.list --member: the asker's Next while their question waits");
await refuses(api, 'chat.answer', { ask: c1.ask.id, answer: 'x' }, PA, 403, 'agent_only', 'chat.answer is for your AI agent');
const ca = await api.op('chat.answer', { ask: c1.ask.id, answer: 'One fund: Fund I.' }, A);
eq([ca.ask.status, ca.ask.answer], ['answered', 'One fund: Fund I.'], 'answered');
const mine = await api.op('chat.list', { status: 'answered' }, PA);
ok(mine.asks.some((a) => a.id === c1.ask.id && a.answer === 'One fund: Fund I.'), 'the asker reads the answer');
const notes = await api.op('notifications.list', {}, PA);
ok(notes.notifications.some((n) => n.kind === 'agent' && /answered/.test(n.title)), 'the asker is told', notes.notifications);
await refuses(api, 'next.list', { member: 'partner@venture.test' }, A, 403, 'no_open_question', 'next.list --member once nothing they asked waits: refused');

section('switches and the demo firm');
const s0 = await api.op('settings.get', {}, O);
// The switches come from the modules' triggers (the merged app has eight; the kernel build has none).
ok(Object.values(s0.agent_policy).every((v) => v === false) && s0.agent_switches.length === Object.keys(s0.agent_policy).length, 'every switch off by default (' + s0.agent_switches.length + ')', s0.agent_policy);
await refuses(api, 'settings.update', { agent_policy: '{"nope":true}' }, O, 400, 'invalid_param', 'an unknown switch is refused');
await refuses(api, 'settings.update', { agent_policy: '{}' }, A, 403, 'agent_not_permitted', 'your AI agent never switches them');
if (s0.agent_switches.length > 0) {
  const key = s0.agent_switches[0].key;
  const on = await api.op('settings.update', { agent_policy: JSON.stringify({ [key]: true }) }, O);
  eq(on.agent_policy[key], true, 'the owner switches one on');
  await api.op('settings.update', { agent_policy: JSON.stringify({ [key]: false }) }, O);
}
await api.op('settings.update', { mail: { demo: true } }, O);
await cool();
const fd = (await fired()).length;
const td = await api.op('zz.make', { name: 'Demo', ask: true }, O);
const dr = await refuses(api, 'agent.ask', { trigger: 'zz_review', record: td.thing.id }, O, 409, 'demo', 'a demo firm: a person asking is told');
ok(/demo firm/.test(dr.body.message), 'in plain words', dr.body);
const dq = await api.op('chat.ask', { text: 'Anything new?' }, O);
await sleep(400);
ok(td.request === '' && dq.ask.status === 'failed' && /demo firm/.test(dq.ask.failure) && (await fired()).length === fd, 'a demo firm never fires (a question says why)', { td, dq });
await api.op('settings.update', { mail: { demo: false } }, O);

const s = summary('t04_triggers');
process.exitCode = s.failed > 0 ? 1 : 0;
