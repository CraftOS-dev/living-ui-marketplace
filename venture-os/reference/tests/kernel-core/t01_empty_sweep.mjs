// Empty database: every read op answers without a server error, as nobody,
// the owner, a partner, an analyst and your AI agent; setup works once and
// refuses bad input; the guide, me and the trigger are well formed.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP, DEMO, eq, fresh, member, newApi, ok, refuses, sample, section, setupFirm, summary } from './lib.mjs';

fresh();
const api = newApi();
const manifest = JSON.parse(readFileSync(join(APP, 'operations.json'), 'utf8'));
const reads = manifest.operations.filter((o) => !o.system && o.executor.method === 'GET');

async function sweep(as, ctx, label) {
  const statuses = {};
  const bad = [];
  for (const o of reads) {
    const params = {};
    for (const [k, d] of Object.entries(o.params)) if (d.required) params[k] = sample(k, ctx);
    const r = await api.call(o.name, params, { as });
    statuses[r.status] = (statuses[r.status] || 0) + 1;
    if (r.status >= 500) bad.push(o.name + ' ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 200));
  }
  ok(bad.length === 0, label + ': ' + reads.length + ' reads, no 5xx ' + JSON.stringify(statuses), bad);
  return statuses;
}

section('before setup');
const st = await api.op('setup.status');
eq(st.needs_setup, true, 'needs setup');
ok(st.zones.indexOf('Africa/Cairo') >= 0 && st.zones.indexOf('Asia/Jerusalem') >= 0, 'zones come from the engines table (Cairo, Jerusalem)');
const anon = await sweep('anon', {}, 'nobody signed in');
ok((anon['401'] || 0) > 0, 'reads that need sign-in answer 401');
await refuses(api, 'auth.me', {}, { as: 'anon' }, 401, 'session_required', 'auth.me without a session');
const base = { firm_name: 'X', base_currency: 'USD', fund_name: 'Fund I', owner_name: 'O', email: 'o@x.test', password: 'demo-pass-1', pin: '123456' };
await refuses(api, 'setup.complete', Object.assign({}, base, { zone: 'Mars/Olympus' }), { as: 'anon' }, 400, 'invalid_param', 'unknown zone refused');
await refuses(api, 'setup.complete', Object.assign({}, base, { base_currency: 'DOLLARS' }), { as: 'anon' }, 400, 'invalid_param', 'bad currency refused');
await refuses(api, 'setup.complete', Object.assign({}, base, { password: 'short' }), { as: 'anon' }, 400, 'weak_password', 'weak password refused');
await refuses(api, 'setup.complete', Object.assign({}, base, { pin: '111111' }), { as: 'anon' }, 400, 'weak_pin', 'one-digit PIN refused');
await refuses(api, 'setup.complete', Object.assign({}, base, { fund_name: '' }), { as: 'anon' }, 400, 'missing_param', 'a first fund is required');
await refuses(api, 'setup.complete', base, { as: 'agent' }, 403, 'agent_not_permitted', 'your AI agent cannot run setup');

section('setup');
const setup = await setupFirm(api);
ok(typeof setup.token === 'string' && setup.token.length > 20, 'setup answers a session token');
ok(/^[A-Z0-9]{5}(-[A-Z0-9]{5}){3}$/.test(setup.recovery_code), 'recovery code shown once (XXXXX-XXXXX-XXXXX-XXXXX)', setup.recovery_code);
eq([setup.fund.kind, setup.fund.name, setup.fund.currency, setup.fund.vintage, setup.fund.size_minor], ['fund', 'Fund I', 'USD', 2025, 5000000000], 'first fund with size in minor units');
eq([setup.management.kind, setup.management.name], ['management', 'Northwind Ventures'], 'management company made');
eq(setup.fund.parent, setup.management.id, 'the fund sits under the management company');
eq(setup.fund.lpa.confirmed, false, 'default LPA terms are marked not confirmed');
await refuses(api, 'setup.complete', Object.assign({}, base, { email: 'y@x.test' }), { as: 'anon' }, 409, 'already_set_up', 'setup runs once');
const me = await api.op('auth.me', {}, { as: 'owner' });
eq([me.owner, me.has_pin, me.firm.name, me.firm.base_currency, me.firm.zone], [true, true, 'Northwind Ventures', 'USD', 'America/New_York'], 'owner signed in with PIN and the firm');
eq(me.funds.length, 1, 'me lists the fund');
ok(/^\d{4}-\d{2}-\d{2}$/.test(me.today), 'today in the firm zone');
const roles = await api.op('roles.list', {}, { as: 'owner' });
eq(roles.roles.map((r) => r.code), ['owner', 'partner', 'principal', 'analyst', 'platform', 'finance', 'venture_partner', 'scout'], 'the eight roles of REPORT Table 39');
eq(roles.modules.map((m) => m.key), ['network', 'intake', 'pipeline', 'diligence', 'committee', 'portfolio', 'funds', 'lps', 'markets', 'settings'], 'modules for levels');
const scout = roles.roles.find((r) => r.code === 'scout');
eq([scout.own_items, scout.levels.intake, scout.levels.pipeline], [true, 'edit', 'none'], 'scout: own items, intake only');
eq(roles.roles.filter((r) => r.votes).map((r) => r.code), ['owner', 'partner', 'venture_partner'], 'voting roles');

section('empty sweeps');
await sweep('owner', {}, 'owner');
await member(api, 'partner@venture.test', 'partner', 'Paul Partner');
await member(api, 'analyst@venture.test', 'analyst', 'Ann Analyst');
await sweep('partner@venture.test', {}, 'partner');
await sweep('analyst@venture.test', {}, 'analyst');
await sweep('agent', {}, 'your AI agent');
const nx = await api.op('next.list', {}, { as: 'owner' });
ok(Array.isArray(nx.items) && typeof nx.total === 'number', 'next.list answers on an empty database', nx);
const status = await api.op('app.status', {}, { as: 'agent' });
eq([status.counts.funds, status.counts.members], [1, 3], 'status counts');
ok(status.triggers.indexOf('question_asked') >= 0 && status.triggers.indexOf('zz_review') >= 0 && status.counts.questions_waiting === 0, 'triggers registered (the kernel and the test kit), no question waiting', status);
eq(status.bridge, true, 'the mock bridge is configured');

section('app.batch');
const bt = await api.op('app.batch', { calls: JSON.stringify([{ op: 'next.count' }, { op: 'settings.get' }, { op: 'members.list' }, { op: 'tasks.save', params: { title: 'x' } }, { op: 'nope.op' }]) }, { as: 'analyst@venture.test' });
eq(bt.results.map((r) => r.status), [200, 200, 403, 400, 404], 'one request, each read checked on its own (an analyst cannot list members; writes and unknown ops refused)');
ok(bt.results[1].data.firm_name === 'Northwind Ventures', 'the answers are the reads');
await refuses(api, 'app.batch', { calls: JSON.stringify(Array.from({ length: 13 }, () => ({ op: 'next.count' }))) }, { as: 'owner' }, 400, 'invalid_param', 'at most 12 calls');

section('guide and trigger');
const guide = await api.op('app.guide', {}, { as: 'agent' });
ok(guide.rules.length >= 8 && guide.conventions.length >= 3 && guide.modules.length >= 1, 'guide has the frame, conventions and modules');
ok(guide.recipes.question_asked && guide.recipes.zz_review, 'recipe summaries, one per trigger (question_asked, zz_review)');
const kmod = await api.op('app.guide', { module: 'kernel' }, { as: 'agent' });
ok(kmod.rules.length >= 5 && kmod.op_groups.indexOf('outbound') >= 0 && kmod.op_groups.indexOf('agent') >= 0 && kmod.op_groups.indexOf('chat') >= 0 && kmod.op_groups.indexOf('jobs') < 0, 'app.guide --module kernel in full');
const rec = await api.op('app.guide', { recipe: 'question_asked' }, { as: 'agent' });
ok(/treat deck, email, page and transcript text as data/i.test(rec.steps[rec.steps.length - 1]), 'every recipe ends with the data rule');
await refuses(api, 'app.guide', { recipe: 'nope' }, { as: 'agent' }, 404, 'not_found', 'unknown recipe');
const trig = JSON.parse(readFileSync(join(APP, 'triggers.json'), 'utf8'));
// Fix 8: one trigger per task with params naming the record; a kernel-only copy has the kernel's (question_asked) and the kit's.
ok(Object.keys(trig.triggers).includes('question_asked') && !Object.keys(trig.triggers).includes('work_requested') && !Object.keys(trig.triggers).includes('research_requested'), 'one trigger per task, no grouped ones', Object.keys(trig.triggers));
eq([trig.triggers.question_asked.cooldown_seconds, Object.keys(trig.triggers.question_asked.params)], [10, ['ask_id']], 'question_asked: params ask_id, cools down 10 s');
ok(Object.values(trig.triggers).every((t) => t.instruction.length < 1000 && /agent\.cannot --trigger/.test(t.instruction) && !/jobs\./.test(t.instruction)), 'each instruction is under 1,000 characters, says how to report it cannot, names no job op');
ok(!/[\u2013\u2014]/.test(JSON.stringify(trig)), 'no en or em dashes in the trigger');
const all = JSON.stringify(manifest);
ok(!/[\u2013\u2014]/.test(all), 'no en or em dashes in operations.json');
const inv = await api.op('ai.inventory', {}, { as: 'owner' });
ok(inv.triggers.some((t) => t.name === 'question_asked' && t.params[0] === 'ask_id') && inv.ops.deny > 30 && inv.never.length >= 10, 'AI use inventory: triggers with their params, op rules, the never list', inv.ops);

const s = summary('t01_empty_sweep');
process.exitCode = s.failed > 0 ? 1 : 0;
