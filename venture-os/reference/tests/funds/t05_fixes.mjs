// Funds fix round: the preferred return's compounding in the LPA, LP names in Japanese, Chinese, Korean,
// Greek, Cyrillic and accented Latin printed in the notices and packs (text read back with pdf.js), recall and
// subscription line repayment calls, void notices to LPs, and statements and opening balances through the
// kernel's importer.
//   VO_APP=<scratch app> VO_PORT=3190 VO_BRIDGE=3290 node t05_fixes.mjs
import { DEMO, addHolding, bridge, eq, fileBytes, fresh, member, newApi, ok, pdfText, refuses, section, setupFirm, summary } from './lib.mjs';

fresh();
await bridge.reset();
const api = newApi();
await setupFirm(api);
const O = { as: 'owner' };
const A = { as: 'agent' };
const FIN = { as: 'finance@venture.test' };
const PIN = { as: 'finance@venture.test', pin: true };
for (const [e, r, n] of [
  ['finance@venture.test', 'finance', 'Fiona Finance'],
  ['finance2@venture.test', 'finance', 'Fred Finance'],
  ['partner@venture.test', 'partner', 'Paul Partner'],
]) {
  await member(api, e, r, n);
  await api.op('pin.set', { password: DEMO.password, new_pin: DEMO.pin }, { as: e });
}
await api.op('entities.save', { entity: 'Fund I', first_close_day: '2025-01-15', legal_name: 'Northwind Ventures Fund I, L.P.', short_name: 'Fund I' }, O);

section('preferred return compounding lives in the LPA');
await api.op('entities.save', { entity: 'Fund I', lpa: JSON.stringify({ hurdle_ppm: 80000, pref_compounding: 'simple' }) }, O);
const g = await api.op('funds.get', { fund: 'Fund I' }, FIN);
eq(g.fund.lpa.pref_compounding, 'simple', 'funds.get reads it from the LPA');
eq((g.fund.settings.funds || {}).pref_compounding, undefined, 'and nothing is kept in the entity settings');
const ent = (await api.op('entities.get', { entity: 'Fund I' }, O)).entity;
eq(ent.lpa.pref_compounding, 'simple', 'entities.get holds it in the LPA JSON');
await refuses(api, 'entities.save', { entity: 'Fund I', lpa: JSON.stringify({ pref_compounding: 'monthly' }) }, O, 400, undefined, 'only compound or simple');

section('LP names in any script print in the PDFs');
const names = [
  ['山田ホールディングス株式会社', 'JP', 'yamada@example.jp', '20000000.00'],
  ['北京长城资本有限公司', 'CN', 'li@example.cn', '15000000.00'],
  ['한빛투자 주식회사', 'KR', 'kim@example.kr', '10000000.00'],
  ['Ελληνική Επενδυτική Α.Ε.', 'GR', 'nikos@example.gr', '3000000.00'],
  ['ООО Северный Капитал', 'RU', 'ivan@example.ru', '1000000.00'],
  ['Fondation Société Générale Ñuñoa', 'FR', 'zoe@example.fr', '1000000.00'],
];
const ids = {};
for (const [name, country, email, amount] of names) {
  const lp = (await api.op('lps.upsert', { name, kind: 'corporate', country, contacts: JSON.stringify([{ name: '担当', email, primary: true }]) }, FIN)).lp;
  ids[name] = lp.id;
  await api.op('commitments.save', { fund: 'Fund I', lp: lp.id, amount }, FIN);
}
const acme = await addHolding(api, 'Fund I', 'Acme Robotics', 100000);
await api.op('bank.change', { entity: 'Fund I', bank_name: '三菱UFJ銀行 丸の内支店', account_name: 'Northwind Ventures Fund I, L.P.', account_number: '0012345678', swift: 'BOTKJPJT' }, PIN);
await api.op('bank.approve', { block: (await api.op('bank.list', {}, FIN)).blocks[0].id }, { as: 'finance2@venture.test', pin: true });
const c1 = (await api.op('calls.draft', { fund: 'Fund I', purpose: 'investment', amount: '5000000.00', holding: acme, fees: true, notice_day: '2026-01-05', narrative: '本件は株式会社エイクミへの追加出資です。' }, FIN)).event;
await api.op('calls.preview', { event: c1.id }, FIN);
const t0 = Date.now();
const iss = (await api.op('calls.issue', { event: c1.id }, PIN)).event;
const ms = Date.now() - t0;
eq(iss.lines.length, 6, 'six notices drawn in one engine run (' + ms + ' ms)');
ok(ms < 20000, 'issue with six notices takes ' + ms + ' ms');
for (const [name] of names) {
  const line = iss.lines.find((l) => l.lp_name === name);
  const pdf = await fileBytes(api, 'calls.notice', { line: line.id }, 'finance@venture.test');
  ok(Buffer.from(pdf.bytes.slice(0, 5)).toString() === '%PDF-', name + ': a PDF');
  const text = await pdfText(pdf.bytes);
  ok(text.indexOf(name) >= 0, name + ': the name prints as written', text.slice(0, 160));
  if (name.startsWith('山田')) {
    ok(text.indexOf('三菱UFJ銀行') >= 0 && text.indexOf('本件は株式会社エイクミへの追加出資です。') >= 0, 'the bank name and the narrative print in Japanese');
    ok(pdf.bytes.length < 120000, 'the notice embeds only the glyphs it uses (' + pdf.bytes.length + ' bytes)');
  }
  ok(text.indexOf('?') < 0 || name.indexOf('?') >= 0, name + ': no character replaced by "?"');
}

section('recall and subscription line repayment calls');
const di = (await api.op('distributions.draft', { fund: 'Fund I', amount: '2000000.00', recallable: '1000000.00', notice_day: '2026-03-02' }, FIN)).event;
await api.op('distributions.preview', { event: di.id }, FIN);
await api.op('distributions.issue', { event: di.id }, PIN);
const accBefore = (await api.op('metrics.lp', { fund: 'Fund I', lp: ids['山田ホールディングス株式会社'] }, FIN)).account;
const r0 = (await api.op('calls.draft', { fund: 'Fund I', purpose: 'recall', amount: '5000000.00', notice_day: '2026-04-06' }, FIN)).event;
await refuses(api, 'calls.preview', { event: r0.id }, FIN, 409, 'over_recall', 'a recall beyond the recallable balance is refused');
await api.op('calls.void', { event: r0.id }, PIN);
const r1 = (await api.op('calls.draft', { fund: 'Fund I', purpose: 'recall', amount: '600000.00', holding: acme, notice_day: '2026-04-06' }, FIN)).event;
const rp = (await api.op('calls.preview', { event: r1.id }, FIN)).event.preview;
eq(rp.totals.call_recall, 60000000, 'recall 600,000.00');
eq(rp.lines.reduce((s, l) => s + l.amounts.call_recall, 0), 60000000, 'lines sum exactly');
const yl = rp.lines.find((l) => l.lp_name.startsWith('山田'));
eq(yl.balances.unfunded_minor, accBefore.unfunded_minor, 'a recall leaves unfunded unchanged');
eq(yl.balances.recallable_minor, accBefore.recallable_minor - yl.amounts.call_recall, 'and draws the recallable balance down');
await api.op('calls.issue', { event: r1.id }, PIN);
const accAfter = (await api.op('metrics.lp', { fund: 'Fund I', lp: ids['山田ホールディングス株式会社'] }, FIN)).account;
eq(accAfter.recalled_minor, yl.amounts.call_recall, 'the capital account counts it as recalled');
const s1 = (await api.op('calls.draft', { fund: 'Fund I', purpose: 'subline', amount: '1000000.00', label: 'Silicon Bank facility', notice_day: '2026-05-04' }, FIN)).event;
const sp = (await api.op('calls.preview', { event: s1.id }, FIN)).event.preview;
eq(sp.totals.call_subline, 100000000, 'subscription line repayment 1,000,000.00');
eq(sp.lines.find((l) => l.lp_name.startsWith('山田')).amounts.call_subline, 40000000, 'pro rata of commitments (20M of 50M)');
const si = (await api.op('calls.issue', { event: s1.id }, PIN)).event;
const sn = await pdfText((await fileBytes(api, 'calls.notice', { line: si.lines[0].id }, 'finance@venture.test')).bytes);
ok(sn.indexOf('subscription facility repayment') >= 0 && sn.indexOf('Silicon Bank facility') >= 0, 'the notice names the line repayment');
const csv = String((await api.call('calls.notice', { line: si.lines[0].id, format: 'csv' }, FIN)).body);
ok(csv.indexOf('Capital call: subscription facility repayment') > 0, 'with its ILPA transaction type in the CSV');

section('a void notice for LPs who received the notice');
let sent = [];
for (let i = 0; i < 40 && sent.length < 6; i++) {
  sent = (await bridge.sent()).sent.filter((x) => String(x.subject).indexOf(c1.number) >= 0);
  if (sent.length < 6) await new Promise((r) => setTimeout(r, 2500));
}
eq(sent.length, 6, 'the six notices of ' + c1.number + ' were sent');
const v = await api.op('calls.void', { event: c1.id, reason: 'Wrong fee period' }, PIN);
eq(v.void_notices, 6, 'six void notices drafted');
const drafts = (await api.op('next.list', { kinds: 'draft' }, FIN)).items.filter((i) => i.title.startsWith('Void: capital call ' + c1.number));
eq(drafts.length, 6, 'they wait in Next for a person to approve');
ok(drafts.every((d) => d.actions[0].op === 'outbound.approve'), 'with Approve and send');
const body = (await api.op('outbound.get', { outbound: drafts[0].data.outbound }, FIN)).message.body;
ok(body.indexOf('is void: Wrong fee period') > 0 && body.indexOf('do not send') > 0, 'the void notice says it is void and why');

section('statements and opening balances through the kernel importer');
const targets = (await api.op('imports.targets', {}, FIN)).targets.map((t) => t.target || t.name || t.key);
for (const t of ['statement_lines', 'bank_lines', 'opening_balances', 'opening_holdings']) ok(targets.indexOf(t) >= 0, t + ' is an import target');
const admin = 'Fund,As of,Investor Name,Paid-in\nFund I,2026-06-30,北京长城资本有限公司,"1,000,000.00"\nFund I,2026-06-30,한빛투자 주식회사,1.00\n';
const pv = await api.op('imports.preview', { target: 'statement_lines', csv: admin }, FIN);
ok(JSON.stringify(pv).indexOf('error') < 0 || (pv.counts && !pv.counts.error), 'the preview maps the columns', pv.counts);
await api.op('imports.run', { target: 'statement_lines', csv: admin }, FIN);
const st = (await api.op('statements.list', { fund: 'Fund I' }, FIN)).statements.find((s) => s.source === 'administrator');
ok(st && st.differences >= 1, 'an administrator statement with its differences (' + (st && st.differences) + ')');
const rj = await api.op('agent.ask', { trigger: 'reconcile', record: st.id }, FIN);
ok(rj.request !== '', 'Ask your AI agent: it is asked to reconcile it', rj);
const bank = 'Fund,Date,Amount,Reference,Payer\nFund I,2026-05-20,"400,000.00",LINE REPAY,YAMADA HD\n';
await api.op('imports.run', { target: 'bank_lines', csv: bank }, FIN);
const bs = (await api.op('statements.list', { fund: 'Fund I' }, FIN)).statements.find((s) => s.source === 'bank');
const bg = (await api.op('statements.get', { statement: bs.id }, FIN)).statement;
eq(bg.diffs[0].match && bg.diffs[0].match.lp_name, '山田ホールディングス株式会社', 'the bank receipt matches the line still due of that amount');
const ag = await api.op('imports.run', { target: 'bank_lines', csv: bank }, A);
ok(ag.proposed === true, "your AI agent's import is a proposal");
await api.op('entities.save', { kind: 'fund', name: 'Fund II', short_name: 'Fund II', currency: 'USD', vintage: 2020, first_close_day: '2020-03-01' }, O);
await api.op('commitments.save', { fund: 'Fund II', lp: ids['北京长城资本有限公司'], amount: '20000000.00' }, FIN);
const orbit = await addHolding(api, 'Fund II', 'Orbit Labs', 50000);
const op1 = 'Fund,As of,LP,Contributed,Distributed,Recallable\nFund II,2025-12-31,北京长城资本有限公司,"12,000,000.00","3,000,000.00","1,000,000.00"\n';
await refuses(api, 'imports.run', { target: 'opening_balances', csv: op1 }, { as: 'partner@venture.test' }, 403, undefined, 'opening balances need full access to funds');
await api.op('imports.run', { target: 'opening_balances', csv: op1 }, FIN);
await api.op('imports.run', { target: 'opening_holdings', csv: 'Fund,Company,Cost,Day\nFund II,Orbit Labs,9000000,2021-05-01\n' }, FIN);
const m2 = (await api.op('metrics.fund', { fund: 'Fund II', day: '2025-12-31' }, FIN)).metrics;
eq(m2.paid_in_minor, 1200000000, 'Fund II paid-in 12,000,000.00 from the imported opening');
eq(m2.holdings_value_minor, 900000000, 'Orbit at cost 9,000,000.00');
const again = await api.op('imports.preview', { target: 'opening_balances', csv: op1 }, FIN);
ok(JSON.stringify(again).indexOf('already has an opening balance') > 0, 'an LP has one opening balance');

section("holdings are read for the caller (portfolio's holdingsFor)");
await member(api, 'scoped@venture.test', 'finance', 'Sid Scoped', { funds: JSON.stringify(['Fund I']) });
const SC = { as: 'scoped@venture.test' };
await refuses(api, 'funds.holdings', { fund: 'Fund II' }, SC, 404, 'not_found', "a member scoped to Fund I cannot list Fund II's holdings");
await refuses(api, 'metrics.holding', { fund: 'Fund II', holding: orbit }, SC, 404, 'not_found', 'nor read one of them');
ok((await api.op('funds.holdings', { fund: 'Fund I' }, SC)).holdings.some((h) => h.id === acme), 'and sees its own fund\'s holdings');
await api.op('companies.upsert', { domain: 'secretco.com', name: 'Secret Co' }, O);
const sd = (await api.op('deals.create', { company: 'secretco.com', name: 'Secret Co', fund: 'Fund I', restricted: true, check: '250000', instrument: 'safe_cap', post_money: '10000000', round_type: 'seed' }, O)).deal;
await api.op('holdings.create-from-deal', { deal: sd.number, override: true, day: '2026-02-01' }, O);
const secret = (await api.op('funds.holdings', { fund: 'Fund I' }, O)).holdings.find((h) => h.name === 'Secret Co').id;
await api.op('ledger.record', { fund: 'Fund I', type: 'investment', holding: secret, amount: '250000.00', day: '2026-02-01' }, O);
const fh = await api.op('funds.holdings', { fund: 'Fund I' }, FIN);
ok(!fh.holdings.some((h) => h.id === secret) && fh.hidden === 1, 'a restricted deal\'s holding is withheld from finance off the deal team (hidden: 1)', fh.hidden);
const own = await api.op('metrics.fund', { fund: 'Fund I' }, O);
const fin = await api.op('metrics.fund', { fund: 'Fund I' }, FIN);
eq(fin.nav.nav_minor, own.nav.nav_minor, 'the fund NAV stays whole for everyone');
const src = await api.op('metrics.sources', { fund: 'Fund I' }, FIN);
ok(!src.nav.holdings.some((h) => h.holding === secret) && src.hidden === 1, 'metrics.sources withholds its row');
await refuses(api, 'metrics.holding', { fund: 'Fund I', holding: secret }, FIN, 404, 'not_found', 'its metrics are not found');
await refuses(api, 'calls.draft', { fund: 'Fund I', purpose: 'investment', amount: '1000.00', holding: secret }, FIN, 404, 'not_found', 'and a call cannot name it');
const ml = await api.op('marks.list', { fund: 'Fund I' }, FIN);
ok(!ml.holdings.some((h) => h.holding === secret) && ml.hidden === 1, 'marks withhold it');
const rv = await api.op('reserves.get', { fund: 'Fund I' }, FIN);
ok(!rv.holdings.some((h) => h.holding === secret) && rv.hidden === 1, 'reserves withhold it');
const lg = await api.op('ledger.list', { fund: 'Fund I' }, FIN);
const wrow = lg.rows.find((r) => r.withheld === true);
ok(wrow !== undefined && wrow.holding === '' && wrow.amount_minor === 25000000 && lg.hidden === 1, 'the ledger keeps the amount and withholds the holding');
ok((await api.op('funds.holdings', { fund: 'Fund I' }, O)).holdings.some((h) => h.id === secret), 'the owner sees it');

const s = summary('t05_fixes');
process.exitCode = s.failed > 0 ? 1 : 0;
