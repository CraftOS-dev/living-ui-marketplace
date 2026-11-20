// Fix round: (1) lib_portfolio.holdingsFor(ctx) / holdingsOf(app, { ctx }) keep Fund II holdings from a member
// scoped to Fund I (through the scratch-only zzp.* test ops); (2) mail from any portfolio company (its domain,
// its founders at free-mail addresses) is filed as an update without the label, deduped by message id, and not
// when the firm turns company mail off. Uses a mock bridge with extra fixture messages (restored at the end).
import { execSync, spawn } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newApi, fresh, setupFirm, section, ok, eq, summary, PEOPLE, APP, BRIDGE, dealFor, DEMO, bridge } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MOCK = join(APP, 'tools', 'dev', 'mock_bridge.mjs');

function killPort(port) {
  try {
    const out = execSync('netstat -ano', { encoding: 'utf8' });
    for (const line of out.split(/\r?\n/)) {
      if (line.indexOf('127.0.0.1:' + port + ' ') >= 0 && line.indexOf('LISTENING') >= 0) {
        const pid = line.trim().split(/\s+/).pop();
        execSync('taskkill /PID ' + pid + ' /F', { stdio: 'ignore' });
      }
    }
  } catch {
    /* nothing listening */
  }
}

async function startMock(fixtures) {
  killPort(BRIDGE);
  const rec = join(APP, 'logs', 'mock_' + BRIDGE);
  mkdirSync(rec, { recursive: true });
  const child = spawn(process.execPath, [MOCK, String(BRIDGE), fixtures, rec], { detached: true, stdio: 'ignore' });
  child.unref();
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${BRIDGE}/__mock/health`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

// Fixtures: the kernel's plus three unlabeled emails from portfolio senders.
const FX = join(HERE, 'fixtures_t05');
cpSync(join(APP, 'tools', 'dev', 'fixtures'), FX, { recursive: true });
const msgsPath = join(FX, 'gmail', 'messages.json');
const raw = JSON.parse(readFileSync(msgsPath, 'utf8'));
const list = Array.isArray(raw) ? raw : raw.messages;
const extra = [
  { id: '18c9a0mail00quiet', labels: [], received_hours_ago: 3, headers: { From: 'Quinn Q <quinn@quietco.com>', To: 'owner@venture.test', Subject: 'Quiet Co: October numbers', Date: 'Mon, 9 Nov 2026 09:00:00 +0000', 'Message-ID': '<quiet1@quietco.com>' }, snippet: 'October revenue USD 52,000', body: 'Hi Olivia,\n\nOctober revenue USD 52,000, net burn USD 95,000, cash USD 610,000.\n\nQuinn', attachments: [] },
  { id: '18c9a0mail00zoe', labels: [], received_hours_ago: 2, headers: { From: 'Zoe Zeta <zoe.zeta@gmail.com>', To: 'owner@venture.test', Subject: 'Zeta: quick numbers', Date: 'Tue, 10 Nov 2026 09:00:00 +0000', 'Message-ID': '<zoe1@gmail.com>' }, snippet: 'MRR EUR 12,000', body: 'Hi,\n\nMRR EUR 12,000 in October.\n\nZoe', attachments: [] },
];
const all = list.concat(extra);
writeFileSync(msgsPath, JSON.stringify(Array.isArray(raw) ? all : Object.assign({}, raw, { messages: all }), null, 1));
await startMock(FX);

await fresh();
await bridge.mode('search_gmail', 'offline');
const api = newApi();
const firm = await setupFirm(api);

section('fund scope: holdingsFor(ctx) answers only the funds a member may see');
const f2 = await api.op('entities.save', { kind: 'fund', name: 'Fund II', currency: 'USD', vintage: 2026, size: '80000000' }, { as: 'owner' });
const fund2 = (f2.entity || f2).id;
await dealFor(api, 'alphaone.com', 'Alpha One', [{ email: 'al@alphaone.com', name: 'Al One' }], { round_type: 'seed', check: '500000', instrument: 'safe_cap', post_money: '10000000' }).then((d) => api.op('holdings.create-from-deal', { deal: d.number, fund: 'Fund I' }, { as: 'owner' }));
await dealFor(api, 'betatwo.com', 'Beta Two', [{ email: 'bea@betatwo.com', name: 'Bea Two' }], { round_type: 'seed', check: '700000', instrument: 'safe_cap', post_money: '14000000' }).then((d) => api.op('holdings.create-from-deal', { deal: d.number, fund: fund2 }, { as: 'owner' }));
const scoped = 'scoped@northwind.test';
const inv = await api.op('members.invite', { email: scoped, name: 'Scoped Partner', role: 'partner', funds: JSON.stringify([firm.fund.id ?? firm.fund]) }, { as: 'owner', pin: true });
const joined = await api.op('auth.accept-invite', { email: scoped, code: inv.code, password: DEMO.password });
api.setToken(scoped, joined.token);
const allOf = await api.op('zzp.holdings-of', {}, { as: scoped });
eq(allOf.rows.length, 2, 'holdingsOf(app): both holdings (system work)');
const mine = await api.op('zzp.holdings-for', {}, { as: scoped });
ok(mine.rows.length === 1 && mine.rows[0].company_name === 'Alpha One', 'holdingsFor(ctx): only the Fund I holding for a member scoped to Fund I', mine.rows);
const byCo = await api.op('zzp.holdings-for', { company: (await api.op('companies.get', { company: 'betatwo.com' }, { as: 'owner' })).company?.id ?? 'betatwo.com' }, { as: scoped });
eq(byCo.rows.length, 0, 'holdingsFor(ctx, { company }) of a Fund II company: nothing');
eq((await api.op('zzp.holdings-for', {}, { as: 'owner' })).rows.length, 2, 'the owner sees both');
eq((await api.op('zzp.holdings-for', {}, { as: 'agent' })).rows.length, 2, 'your AI agent (no fund scope) sees both');
const pl = await api.op('holdings.list', {}, { as: scoped });
ok(pl.rows.length === 1 && pl.hidden === 1, 'holdings.list: one row, hidden 1', { rows: pl.rows.length, hidden: pl.hidden });

section('company mail: filed from any portfolio sender unless turned off');
await dealFor(api, 'quietco.com', 'Quiet Co', [{ email: 'quinn@quietco.com', name: 'Quinn Q' }], { round_type: 'seed', check: '300000', instrument: 'safe_cap', post_money: '6000000' }).then((d) => api.op('holdings.create-from-deal', { deal: d.number, fund: 'Fund I' }, { as: 'owner' }));
// Only one portfolio sender at a time: the mock bridge reads no OR in from: (real Gmail does).
await api.op('holdings.update', { holding: 'alphaone.com', status: 'exited' }, { as: 'owner' });
await api.op('holdings.update', { holding: 'betatwo.com', status: 'exited' }, { as: 'owner' });
const off = await api.op('requests.template-save', { company_mail: false }, { as: PEOPLE.partner });
eq(off.company_mail, false, 'company mail turned off in Settings');
await bridge.mode('search_gmail', 'ok');
await api.op('updates.sweep', {}, { as: PEOPLE.partner });
const u1 = await api.op('updates.list', {}, { as: 'owner' });
ok(!u1.updates.some((x) => x.from_email === 'quinn@quietco.com'), 'off: Quiet Co mail without the label is not filed', u1.updates.map((x) => x.from_email));
const on = await api.op('requests.template-save', { company_mail: true }, { as: PEOPLE.partner });
eq(on.company_mail, true, 'company mail on again');
await api.op('settings.update', { agent_policy: '{"email_updates":true}' }, { as: 'owner' });
await api.op('updates.sweep', {}, { as: PEOPLE.partner });
const u2 = await api.op('updates.list', { company: 'quietco.com' }, { as: 'owner' });
ok(u2.updates.length === 1 && u2.updates[0].from_email === 'quinn@quietco.com' && u2.updates[0].source === 'email', 'on: the unlabeled Quiet Co email is filed to Quiet Co (no request was ever sent)', u2.updates);
await api.op('updates.sweep', {}, { as: PEOPLE.partner });
eq((await api.op('updates.list', { company: 'quietco.com' }, { as: 'owner' })).updates.length, 1, 'a second sweep files it once (deduped by message id)');
const ua = (await api.op('updates.get', { update: u2.updates[0].id }, { as: 'owner' })).update.agent.update_extract;
ok(ua && ua.pending, 'your AI agent is asked to read it (the switch is on)', ua);

section('a founder at a free-mail address');
await api.op('holdings.update', { holding: 'quietco.com', status: 'exited' }, { as: 'owner' });
await api.op('companies.upsert', { name: 'Zeta Labs' }, { as: 'owner' });
await api.op('people.upsert', { email: 'zoe.zeta@gmail.com', name: 'Zoe Zeta', company: 'Zeta Labs' }, { as: 'owner' });
const dz = (await api.op('deals.create', { company: 'Zeta Labs', round_type: 'seed', check: '200000', instrument: 'safe_cap', post_money: '5000000', people: JSON.stringify([{ person: 'zoe.zeta@gmail.com', role: 'founder' }]) }, { as: 'owner' })).deal;
await api.op('holdings.create-from-deal', { deal: dz.number, fund: 'Fund I' }, { as: 'owner' });
await api.op('updates.sweep', {}, { as: PEOPLE.partner });
const uz = await api.op('updates.list', { company: 'Zeta Labs' }, { as: 'owner' });
ok(uz.updates.length === 1 && uz.updates[0].from_email === 'zoe.zeta@gmail.com', 'the founder\'s gmail.com email is filed to Zeta Labs', uz.updates);

// Restore the standard mock bridge for the other tests.
await startMock(join(APP, 'tools', 'dev', 'fixtures'));
summary('t05 fixes');
