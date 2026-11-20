// Home on an EMPTY firm (fresh database, setup only): every home read as owner, partner, principal,
// analyst, finance, platform, scout, venture partner and your AI agent answers 200 with every block in its
// empty state (never an error), hidden names what a role may not see, app.today carries the home block,
// the digest previews and sends through the mock bridge as a kernel outbound message, your AI agent is
// refused the people-only ops before any param. Then the whole catalog's read ops as owner and agent: no 5xx.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP, BRIDGE, fresh, member, newApi, ok, refuses, section, setupFirm, summary } from './lib.mjs';

fresh();
const api = newApi();

section('before setup');
await refuses(api, 'home.summary', {}, {}, 401, undefined, 'home.summary needs a session');

section('setup and team');
await setupFirm(api);
const ROLES = { partner: 'p@venture.test', principal: 'pr@venture.test', analyst: 'an@venture.test', finance: 'fi@venture.test', platform: 'pl@venture.test', scout: 'sc@venture.test', venture_partner: 'vp@venture.test' };
for (const [role, email] of Object.entries(ROLES)) await member(api, email, role, role.charAt(0).toUpperCase() + role.slice(1) + ' Person');

section('home.summary on an empty firm, every role');
const expectHidden = {
  owner: [],
  agent: [],
  partner: [],
  principal: ['runways'].filter(() => false),
  analyst: [],
  finance: ['inbound', 'funnel'],
  platform: ['inbound', 'funnel', 'fund'],
  scout: ['meetings', 'funnel', 'fund', 'runways'],
  venture_partner: ['inbound', 'fund', 'runways'],
};
for (const who of ['owner', 'agent', ...Object.keys(ROLES)]) {
  const as = who === 'owner' || who === 'agent' ? who : ROLES[who];
  const r = await api.call('home.summary', {}, { as });
  ok(r.status === 200, `${who}: 200`, r.body);
  if (r.status !== 200) continue;
  const s = r.body;
  ok(Array.isArray(s.errors) && s.errors.length === 0, `${who}: no block failed`, s.errors);
  ok(s.next && Array.isArray(s.next.items) && typeof s.next.total === 'number', `${who}: Next block shaped`);
  ok(Array.isArray(s.meetings) && s.meetings.length === 0, `${who}: no meetings`);
  if (!s.hidden.includes('inbound')) ok(s.inbound !== null && s.inbound.weeks.length >= 12 && s.inbound.weeks.length <= 14 && s.inbound.total === 0 && s.inbound.quarter.count === 0, `${who}: 12 empty weeks of inbound`, s.inbound);
  if (!s.hidden.includes('funnel')) ok(s.funnel !== null && s.funnel.stages.length === 9 && s.funnel.stages[0].key === 'inbound' && s.funnel.cohort === 0 && s.funnel.stages.every((x) => x.count === 0 && x.conversion_ppm === null), `${who}: Inbound and 8 stages, all 0, conversion unknown (never 0)`, s.funnel);
  if (!s.hidden.includes('fund')) ok(s.fund !== null && s.fund.paid_in_minor === 0 && s.fund.tvpi_e8 === null && s.fund.reasons.tvpi !== null, `${who}: fund figures unknown with a reason`, s.fund && { tvpi: s.fund.tvpi_e8, reasons: s.fund.reasons });
  if (!s.hidden.includes('runways')) ok(s.runways !== null && s.runways.rows.length === 0, `${who}: no runways`);
  for (const h of expectHidden[who] ?? []) ok(s.hidden.includes(h), `${who}: ${h} hidden`, s.hidden);
  for (const h of s.hidden) ok(s[h] === null || (h === 'meetings' && s[h].length === 0), `${who}: a hidden block carries nothing (${h})`);
  ok(typeof s.ms === 'number' && s.ms < 2000, `${who}: answered in ${s.ms} ms`);
}

section('app.today home block');
const td = await api.op('app.today', {}, { as: 'owner' });
const hb = td.blocks.find((b) => b.key === 'home');
ok(hb !== undefined && hb.inbound.weeks.length === 12 && hb.fund.tvpi.startsWith('unknown'), 'home block in app.today: weeks and an honest unknown TVPI', hb);
ok(td.errors.length === 0, 'app.today: no block failed', td.errors);
const tdA = await api.op('app.today', {}, { as: 'agent' });
ok(tdA.blocks.some((b) => b.key === 'home'), 'your AI agent gets the home block');

section('digest');
await refuses(api, 'home.digest', {}, { as: 'agent' }, 403, 'agent_not_permitted', 'home.digest is people only');
await refuses(api, 'home.digest-send', {}, { as: 'agent' }, 403, 'agent_not_permitted', 'home.digest-send is people only');
const d0 = await api.op('home.digest', {}, { as: 'owner' });
ok(d0.on === false && d0.time === '07:00' && d0.zone === 'America/New_York' && d0.lines.length === 0, 'digest off by default, 07:00 in the firm zone, nothing today', d0);
await api.op('auth.update-profile', { prefs: { digest: true, digest_link: 'http://127.0.0.1:3192/' } }, { as: 'owner' });
ok((await api.op('home.digest', {}, { as: 'owner' })).on === true, 'turned on through the profile preference');
await fetch(`http://127.0.0.1:${BRIDGE}/__mock/reset`, { method: 'POST' });
const sent = await api.op('home.digest-send', {}, { as: 'owner' });
ok(sent.message && sent.message.kind === 'digest' && sent.message.status === 'sent' && sent.message.to.includes('owner@venture.test'), 'Send now: a kernel outbound message of kind digest, sent to my own address', sent.message);
const mock = await (await fetch(`http://127.0.0.1:${BRIDGE}/__mock/sent`)).json();
ok(mock.sent.some((m) => m.to.includes('owner@venture.test') && /Your day at/.test(m.subject)), 'the mock bridge received it', mock.sent.slice(-1));
const ob = await api.op('outbound.list', { kind: 'digest', status: 'all' }, { as: 'owner' });
ok(ob.messages.length === 1 && ob.messages[0].approved_by !== '', 'one digest in outbound, approved by me', ob.messages[0]);
const nx = await api.op('next.list', {}, { as: 'owner' });
ok(!nx.items.some((i) => i.kind === 'draft'), 'a sent digest leaves nothing in Next');
const dp = await api.op('home.digest', {}, { as: ROLES.partner });
ok(dp.on === false, "a partner's digest stays off (per member)");

section('every read op of the catalog on the empty firm (owner and your AI agent): no 5xx');
const opsJson = JSON.parse(readFileSync(join(APP, 'operations.json'), 'utf8'));
const reads = opsJson.operations.filter((o) => o.executor && o.executor.method === 'GET' && !o.system);
let fives = 0;
for (const o of reads) {
  const params = {};
  for (const [k, v] of Object.entries(o.params ?? {})) if (v.required) params[k] = k === 'day' ? '2026-11-02' : 'nope00000000000';
  for (const as of ['owner', 'agent']) {
    const r = await api.call(o.name, params, { as });
    if (r.status >= 500) {
      fives++;
      ok(false, `${o.name} as ${as}: ${r.status}`, r.body);
    }
  }
}
ok(fives === 0, `${reads.length} read ops x 2 callers: no 5xx`);

const res = summary('t01_empty');
process.exit(res.failed > 0 ? 1 : 0);
