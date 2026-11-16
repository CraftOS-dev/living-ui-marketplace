// Empty database first: every intake read op as owner, partner, analyst, a scout and your AI agent:
// no 5xx. People-only ops refuse your AI agent before any param check. Then the same sweep with data.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { newApi, fresh, setupFirm, section, ok, summary, PEOPLE, APP, upload, deck } from './lib.mjs';

const GROUPS = ['intake.', 'triage.', 'passes.', 'scouts.'];
const manifest = JSON.parse(readFileSync(join(APP, 'operations.json'), 'utf8'));
const mine = manifest.operations.filter((o) => GROUPS.some((g) => o.name.startsWith(g)));
const reads = mine.filter((o) => o.executor.method === 'GET');
const writes = mine.filter((o) => o.executor.method === 'POST');

fresh();
const api = newApi();

section('before setup');
for (const op of reads) {
  const r = await api.call(op.name, {}, { as: 'agent' });
  ok(r.status < 500, op.name + ' before setup answers ' + r.status, r.body);
}

await setupFirm(api);
const who = ['owner', PEOPLE.partner, PEOPLE.analyst, PEOPLE.scout, PEOPLE.finance, 'agent'];

function sample(ids, k) {
  const map = { item: ids.item || 'IN-9999', deal: ids.deal || 'D-9999', pass: ids.pass || 'nope00000000000' };
  return map[k] ?? 'x';
}

async function sweep(label, ids) {
  section(label);
  let n = 0;
  let bad = 0;
  for (const op of reads) {
    const params = {};
    for (const [k, d] of Object.entries(op.params || {})) if (d.required) params[k] = sample(ids, k);
    for (const w of who) {
      const r = await api.call(op.name, params, { as: w });
      n++;
      if (r.status >= 500) {
        bad++;
        ok(false, op.name + ' as ' + w + ' answered ' + r.status, r.body);
      }
    }
    for (const seg of ['new', 'waiting', 'held', 'passed', 'advanced', 'all']) {
      if (op.name !== 'intake.list') break;
      for (const w of who) {
        const r = await api.call(op.name, { segment: seg, q: 'ac' }, { as: w });
        n++;
        if (r.status >= 500) {
          bad++;
          ok(false, 'intake.list ' + seg + ' as ' + w + ' answered ' + r.status, r.body);
        }
      }
    }
  }
  for (const w of who) {
    for (const name of ['next.list', 'next.count', 'search.query', 'app.today', 'app.guide', 'imports.targets']) {
      const r = await api.call(name, name === 'search.query' ? { q: 'acme' } : {}, { as: w });
      n++;
      if (r.status >= 500) {
        bad++;
        ok(false, name + ' as ' + w + ' answered ' + r.status, r.body);
      }
    }
  }
  ok(bad === 0, n + ' read calls (' + reads.length + ' intake ops x ' + who.length + ' callers, plus Next, search, today, guide), none 5xx');
}

await sweep('empty database', {});

section('empty answers');
const l0 = await api.op('intake.list', {}, { as: 'owner' });
ok(l0.items.length === 0 && l0.counts.new === 0 && l0.sla_days === 5, 'the Inbox is empty, counts zero, SLA 5 business days', l0);
const n0 = await api.op('next.list', {}, { as: 'owner' });
ok(n0.errors.length === 0, 'next.list has no module errors', n0.errors);
const s0 = await api.op('intake.settings', {}, { as: 'owner' });
ok(s0.deals_label === 'Venture OS/Deals' && s0.pass_reasons.length === 8 && s0.pass_reasons.every((r) => r.on), 'settings: deals label and the 8 pass reasons', s0);

section('people-only ops refuse your AI agent before any param check');
const denied = writes.filter((o) => o.description.indexOf('[People only') >= 0);
for (const op of denied) {
  const r = await api.call(op.name, {}, { as: 'agent' });
  ok(r.status === 403 && r.body.code === 'agent_not_permitted', op.name + ' -> 403 agent_not_permitted', r.body);
}
ok(denied.length === 11, 'eleven people-only intake ops (passes.create for deals, qa-cli RULING CLI-03): ' + denied.map((o) => o.name).join(', '));

section('with data');
const up = await upload(api, 'intake.add', {}, [{ name: 'Acme Robotics - Seed 2026.pdf'.replace(' - ', ' '), bytes: deck('acme_robotics_seed.pdf') }], PEOPLE.partner);
ok(up.status === 200 && up.body.number === 'IN-0001', 'a partner dropped a deck: IN-0001', up.body);
const d = await api.op('deals.create', { company: 'lumenhealth.io' }, { as: 'owner' });
await sweep('with data', { item: 'IN-0001', deal: d.number });

summary('t01 empty sweep');
