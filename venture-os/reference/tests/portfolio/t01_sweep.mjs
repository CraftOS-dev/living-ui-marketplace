// Every portfolio read op on an empty database, then with data, as owner, partner, analyst, platform
// lead and your AI agent: no 5xx. People-only ops refuse your AI agent before any param check.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { newApi, fresh, setupFirm, section, ok, summary, PEOPLE, APP, dealFor, bridge } from './lib.mjs';

const GROUPS = ['holdings.', 'safe.', 'rounds.', 'securities.', 'ownership.', 'prorata.', 'kpis.', 'kpi-defs.', 'alerts.', 'requests.', 'updates.', 'asks.', 'board.'];
const manifest = JSON.parse(readFileSync(join(APP, 'operations.json'), 'utf8'));
const mine = manifest.operations.filter((o) => GROUPS.some((g) => o.name.startsWith(g)));
const reads = mine.filter((o) => o.executor.method === 'GET');
const writes = mine.filter((o) => o.executor.method === 'POST');

await fresh();
// The cron Gmail sweep runs every 5 minutes; keep Gmail search offline so the empty database stays empty.
await bridge.mode('search_gmail', 'offline');
const api = newApi();
const who = ['owner', PEOPLE.partner, PEOPLE.analyst, PEOPLE.platform, 'agent'];

section('before setup: reads answer without a 5xx');
for (const op of reads) {
  const r = await api.call(op.name, {}, { as: 'anon' });
  ok(r.status < 500, op.name + ' anonymous -> ' + r.status);
}

await setupFirm(api);

function sample(ids, k) {
  const map = { holding: ids.company || 'nowhere.test', company: ids.company || 'nowhere.test', update: ids.update || 'nope00000000000', deal: ids.deal || 'D-9999', alert: 'nope00000000000', meeting: 'nope00000000000' };
  return map[k] ?? 'x';
}

async function sweep(label, ids) {
  section(label);
  let n = 0;
  let bad = 0;
  for (const op of reads) {
    const variants = [{}];
    const req = {};
    for (const [k, d] of Object.entries(op.params || {})) if (d.required) req[k] = sample(ids, k);
    variants.push(req);
    if (ids.company && (op.params || {}).company) variants.push({ company: ids.company });
    if (op.name === 'safe.preview' && ids.deal) variants.push({ deal: ids.deal }, { instrument: 'safe_cap', amount: '500000', cap: '6700000' });
    if (op.name === 'prorata.preview' && ids.company) variants.push({ holding: ids.company, raise: '10000000', post_money: '50000000' });
    for (const params of variants) {
      for (const w of who) {
        const r = await api.call(op.name, params, { as: w });
        n++;
        if (r.status >= 500) {
          bad++;
          ok(false, op.name + ' ' + JSON.stringify(params) + ' as ' + w + ' answered ' + r.status, r.body);
        }
      }
    }
  }
  ok(bad === 0, n + ' read calls over ' + reads.length + ' ops and ' + who.length + ' callers, none 5xx');
}

await sweep('empty database', {});

section('empty database: the pages\' reads answer empty shapes');
const list = await api.op('holdings.list', {}, { as: 'owner' });
ok(list.rows.length === 0 && list.figures.companies === 0 && list.figures.invested_minor === 0, 'holdings.list empty with zero figures');
const rq = await api.op('requests.list', {}, { as: 'owner' });
ok(rq.companies.length === 0 && typeof rq.template.body === 'string' && rq.template.body.length > 20, 'requests.list: no companies, the template prefilled');
const defs = await api.op('kpi-defs.list', {}, { as: PEOPLE.analyst });
ok(defs.defs.length === 10 && defs.defs.some((d) => d.key === 'runway' && d.kind === 'computed'), 'ten seeded KPI definitions, runway computed');
ok((await api.op('alerts.list', {}, { as: 'owner' })).alerts.length === 0, 'no alerts');
ok((await api.op('updates.list', {}, { as: 'owner' })).updates.length === 0, 'no updates');
ok((await api.op('asks.list', {}, { as: 'owner' })).asks.length === 0, 'no asks');
ok((await api.op('board.list', {}, { as: 'owner' })).meetings.length === 0, 'no board meetings');
ok((await api.call('holdings.list', {}, { as: PEOPLE.outsider })).status === 200, 'a partner reads the portfolio');

const d = await dealFor(api, 'acmerobotics.ai', 'Acme Robotics', [{ email: 'maya@acmerobotics.ai', name: 'Maya Chen' }], { round_type: 'seed', post_money: '15000000', check: '500000', instrument: 'safe_cap' });
await api.op('holdings.create-from-deal', { deal: d.number }, { as: 'owner' });
await api.op('kpis.save', { company: 'acmerobotics.ai', key: 'cash', period_end: '2026-10-31', value: '900000' }, { as: 'owner' });
const up = await api.op('updates.add', { company: 'acmerobotics.ai', text: 'October: revenue USD 80,000. Cash USD 900,000.' }, { as: 'owner' });
await sweep('with data', { company: 'acmerobotics.ai', deal: d.number, update: up.update.id });

section('people-only ops refuse your AI agent before any param check');
const denied = writes.filter((o) => o.description.indexOf('[People only') >= 0);
for (const op of denied) {
  const r = await api.call(op.name, {}, { as: 'agent' });
  ok(r.status === 403 && r.body.code === 'agent_not_permitted', op.name + ' -> 403 agent_not_permitted', r.body);
}
const want = ['holdings.create-from-deal', 'kpis.verify', 'kpis.reject', 'kpis.save', 'kpi-defs.save', 'alerts.ack', 'alerts.rules-save', 'requests.schedule', 'requests.send', 'requests.template-save', 'updates.dismiss', 'updates.sweep', 'asks.update'];
ok(want.every((n) => denied.some((o) => o.name === n)) && denied.length === want.length, denied.length + ' people-only ops: ' + denied.map((o) => o.name).join(', '));

section('an analyst (portfolio view) cannot write');
const r1 = await api.call('kpis.verify', { update: up.update.id }, { as: PEOPLE.analyst });
ok(r1.status === 403, 'analyst kpis.verify -> 403', r1.body);
const r2 = await api.call('requests.schedule', { companies: '["acmerobotics.ai"]' }, { as: PEOPLE.analyst });
ok(r2.status === 403, 'analyst requests.schedule -> 403', r2.body);

summary('t01 sweep');
