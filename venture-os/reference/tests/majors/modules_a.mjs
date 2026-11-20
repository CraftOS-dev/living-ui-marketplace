// Majors fix, module batch A: checks of M3 (marks.approve visibility), M4 (pin flag on the funds opening
// import targets), M5 (NDA quotes in intake), M2 (a domain never renames a company), UI-04 (committee.next-step)
// and UI-01 (the cohort funnel). Runs on a seeded scratch copy (node tools/dev/seed_demo.mjs <copy> 3185 3285 --fresh)
// on VO_PORT (default 3185): node reference/tests/majors/modules_a.mjs (VO_APP: the copy, default this app).
import { client } from '../../../tools/dev/api.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = process.env.VO_APP ?? join(HERE, '..', '..', '..');
const api = client({ port: Number(process.env.VO_PORT ?? 3185), app: APP });
const O = { as: 'owner' };
const OP = { as: 'owner', pin: true };
const FIN = { as: 'finance@venture.test' };
const FINP = { as: 'finance@venture.test', pin: true };
const A = { as: 'agent' };
let pass = 0;
let fail = 0;
function ok(c, msg, extra) {
  if (c) pass++;
  else {
    fail++;
    console.log('FAIL', msg, extra === undefined ? '' : JSON.stringify(extra).slice(0, 600));
  }
}

/* ---------------------------------------------------------- M3 marks */
{
  const ml = await api.op('marks.list', { fund: 'Fund I' }, O);
  const q = ml.quarter;
  const day = q.period_end ? q.period_end.slice(0, 8) + '01' : '2026-08-15';
  const mk = async (domain, name) => {
    const d = (await api.op('deals.create', { company: domain, name: name, round_type: 'seed', raise: '2000000', check: '400000', instrument: 'safe_cap', currency: 'USD', fund: ml.fund.id }, O)).deal;
    const hc = await api.call('holdings.create-from-deal', { deal: d.number, fund: ml.fund.id, cap: '10000000', day: day, override: true }, O);
    ok(hc.status === 200, 'holding from ' + name, hc.body);
    const holding = hc.body.holding ? hc.body.holding.id : hc.body.id;
    const lr = await api.call('ledger.record', { fund: ml.fund.id, type: 'investment', holding: holding, amount: '400000', day: day }, O);
    ok(lr.status === 200, 'ledger investment for ' + name, lr.body);
    return { deal: d, holding: holding };
  };
  const hid = await mk('quietvault-m3-' + Date.now() + '.io', 'Quiet Vault M3');
  const INPUTS = JSON.stringify([{ label: 'Last round price', value: '1.00', source: 'Closing documents' }]);
  const dm = await api.call('marks.draft', { quarter: q.id, holding: hid.holding, method: 'calibrated_round', value: '400000', rationale: 'Last round.', inputs: INPUTS }, O);
  ok(dm.status === 200, 'mark drafted for the hidden holding', dm.body);
  const markId = dm.body.mark.id;
  // A holding finance sees, drafted too: Approve all approves it and leaves the hidden one.
  const vis = await mk('openvault-m3-' + Date.now() + '.io', 'Open Vault M3');
  const dv = await api.call('marks.draft', { quarter: q.id, holding: vis.holding, method: 'calibrated_round', value: '400000', rationale: 'Last round.', inputs: INPUTS }, O);
  ok(dv.status === 200, 'mark drafted for the visible holding', dv.body);
  const rs = await api.call('deals.restrict', { deal: hid.deal.number, restricted: true }, O);
  ok(rs.status === 200, 'deal restricted (finance not on its team)', rs.body);
  const lf = await api.op('marks.list', { fund: 'Fund I', quarter: q.id }, FIN);
  ok(lf.hidden >= 1, 'finance: marks.list hides the restricted holding', { hidden: lf.hidden });
  const one = await api.call('marks.approve', { mark: markId }, FINP);
  ok(one.status === 404, 'finance cannot approve the hidden mark by id (404)', { status: one.status, body: one.body });
  const all = await api.call('marks.approve', { quarter: q.id }, FINP);
  ok(all.status === 200, 'finance approves the quarter', all.body);
  ok(all.body.hidden === 1, 'one mark counted hidden', { hidden: all.body.hidden });
  ok(all.body.approved.some((m) => m.holding === vis.holding), 'the visible mark is approved', all.body.approved && all.body.approved.map((m) => m.holding));
  ok(!JSON.stringify(all.body).includes(hid.holding) && !JSON.stringify(all.body).includes('Quiet Vault'), 'the hidden mark is not returned');
  const lo = await api.op('marks.list', { fund: 'Fund I', quarter: q.id }, O);
  const row = lo.holdings.find((h) => h.holding === hid.holding);
  ok(row && row.quarter_mark && row.quarter_mark.status === 'draft', 'the hidden mark stays a draft', row && row.quarter_mark);
  const own = await api.call('marks.approve', { mark: markId }, OP);
  ok(own.status === 200 && own.body.approved.length === 1 && own.body.hidden === 0, 'the owner (who sees it) approves it', own.body);
}

/* ---------------------------------------------------------- M4 pin flag */
{
  const ev = (await import('node:module')).createRequire(import.meta.url)(join(APP, 'pb', 'pb_hooks', 'events_funds.js'));
  ok(ev.imports.opening_balances.pin === true && ev.imports.opening_holdings.pin === true, 'opening_balances and opening_holdings register pin: true');
}

/* ---------------------------------------------------------- M5 NDA quotes */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** A deck by email, read by the simulated agent with page quotes, advanced to a deal (the QA journey's first stage). */
async function deckDeal() {
  const fs = await import('node:fs');
  const fx = join(APP, 'logs', 'demo_fixtures');
  fs.mkdirSync(join(fx, 'gmail'), { recursive: true });
  fs.mkdirSync(join(fx, 'decks'), { recursive: true });
  fs.copyFileSync(join(APP, 'tools', 'dev', 'fixtures', 'decks', 'acme_robotics_seed.pdf'), join(fx, 'decks', 'acme_robotics_seed.pdf'));
  const all = JSON.parse(fs.readFileSync(join(APP, 'tools', 'dev', 'fixtures', 'gmail', 'messages.json'), 'utf8'));
  const acme = all.find((m) => m.id === '18c9a0deck00acme1');
  acme.received_hours_ago = 1;
  fs.writeFileSync(join(fx, 'gmail', 'messages.json'), JSON.stringify([acme], null, 1));
  await api.op('intake.sweep', {}, O);
  const l = await api.op('intake.list', { segment: 'all', q: 'Acme' }, O);
  const item = (l.items || []).find((i) => /acme/i.test(i.name + ' ' + (i.email_subject || '')));
  if (!item) return null;
  const wk = await api.op('triage.start', { item: item.id }, A);
  const fileId = wk.files[0].id;
  for (let i = 0; i < 60; i++) {
    const f = await api.op('files.get', { file: fileId }, A);
    if (['ready', 'none', 'failed'].includes(f.file.text_state)) break;
    await sleep(1000);
  }
  const facts = [
    { key: 'round_type', value: 'seed', grade: 'founder_reported', file: fileId, page: 1, quote: 'Seed round, November 2026' },
    { key: 'raise_minor', value: '3000000', currency: 'USD', grade: 'founder_reported', file: fileId, page: 7, quote: 'Raising USD 3,000,000 on a post-money SAFE' },
    { key: 'currency', value: 'USD', grade: 'founder_reported', file: fileId, page: 7 },
  ];
  const fs1 = await api.call('triage.facts-save', { item: item.id, facts, company: { name: 'Acme Robotics', domain: 'acmerobotics.ai' }, one_liner: 'Mobile picking arms for mid-size warehouses', founders: [{ name: 'Maya Chen', email: 'maya@acmerobotics.ai', title: 'CEO' }], missing: [], questions: [] }, A);
  if (fs1.status !== 200) console.log('facts-save', JSON.stringify(fs1.body).slice(0, 300));
  const adv = await api.op('intake.advance', { item: item.id }, O);
  return adv.deal;
}
{
  const board = await api.op('deals.list', { status: 'all', limit: 200 }, O);
  let target = null;
  const find = async (deals) => {
    for (const d of deals) {
      const v = await api.op('intake.verdict', { deal: d.id }, O);
      const f = (v.facts || []).find((x) => x.file && x.quote);
      if (f) return { deal: d, fact: f };
    }
    return null;
  };
  target = await find(board.deals);
  if (target === null) {
    const d = await deckDeal();
    if (d) target = await find([d]);
  }
  ok(target !== null, 'a deal with deck quotes exists');
  if (target !== null) {
    const nda = await api.call('files.set-nda', { file: target.fact.file, nda: true }, O);
    ok(nda.status === 200, 'the deck is marked NDA', nda.body);
    const q = target.fact.quote;
    const va = await api.op('intake.verdict', { deal: target.deal.id }, A);
    const fa = va.facts.find((x) => x.key === target.fact.key);
    ok(!JSON.stringify(va).includes(q), 'intake.verdict as your AI agent nobody asked about the deal: no NDA quote');
    ok(fa && fa.hidden === true && fa.quote === '' && fa.hidden_reason === 'nda_not_asked', 'the fact is marked hidden (nda_not_asked)', fa);
    const item = va.item.id;
    const ga = await api.op('intake.get', { item }, A);
    ok(!JSON.stringify(ga).includes(q), 'intake.get as the agent: no NDA quote');
    // A member outside the deal team (and a team member).
    const team = await api.op('deals.get', { deal: target.deal.id }, O);
    const teamIds = (team.deal.team || []).map((t) => t.id);
    const members = (await api.op('deals.members', {}, O)).members;
    const outsider = members.find((m) => !teamIds.includes(m.id) && ['partner', 'principal', 'analyst'].includes(String(m.role).toLowerCase()));
    const insider = members.find((m) => teamIds.includes(m.id));
    if (outsider) {
      const vo = await api.op('intake.verdict', { deal: target.deal.id }, { as: outsider.email });
      ok(!JSON.stringify(vo).includes(q) && vo.facts.find((x) => x.key === target.fact.key).hidden_reason === 'nda', 'intake.verdict outside the deal team: withheld (nda)', outsider.email);
      const go = await api.call('intake.get', { item }, { as: outsider.email });
      ok(go.status !== 200 || !JSON.stringify(go.body).includes(q), 'intake.get outside the deal team: withheld');
    } else ok(false, 'an outsider member exists');
    if (insider) {
      const vi = await api.op('intake.verdict', { deal: target.deal.id }, { as: insider.email });
      ok(JSON.stringify(vi).includes(q), 'the deal team still reads the quote', insider.email);
    }
    const nx = await api.op('next.list', {}, A).catch(() => ({}));
    ok(!JSON.stringify(nx).includes(q), 'Next for the agent carries no NDA quote');
    await api.call('files.set-nda', { file: target.fact.file, nda: false }, O);
  }
}

/* ---------------------------------------------------------- M2 domain import */
{
  const before = await api.op('holdings.list', {}, O);
  const arc = before.rows.find((r) => r.company.domain === 'arclightsec.com');
  ok(arc !== undefined, 'Arclight Security is held');
  const run = await api.call('imports.run', { target: 'holdings', rows: JSON.stringify([{ company: 'arclightsec.com', fund: 'Larkspur Fund I', instrument: 'priced', amount: '123456', day: '2026-07-01', currency: 'USD' }]) }, O);
  if (run.status !== 200) {
    const t = await api.op('imports.targets', {}, O);
    console.log('imports.run answer', run.status, JSON.stringify(run.body).slice(0, 300), (t.targets || []).map((x) => x.target).join(','));
  }
  ok(run.status === 200, 'holdings import runs', run.body);
  const after = await api.op('holdings.list', {}, O);
  const arc2 = after.rows.find((r) => r.company.domain === 'arclightsec.com');
  ok(arc2 && arc2.company.name === 'Arclight Security', 'a domain matches the company and never renames it', arc2 && arc2.company);
  ok(after.rows.length === before.rows.length, 'no new holding (it matched the held company)', { before: before.rows.length, after: after.rows.length });
}

/* ---------------------------------------------------------- UI-04 next step */
{
  const d30 = await api.op('committee.next-step', { deal: 'D-0030' }, O);
  console.log('D-0030 owner step:', JSON.stringify(d30.step));
  ok(d30.step !== null && ['reveal', 'record', 'vote', 'open'].includes(d30.step.key), 'the deal at IC has a committee step for the owner', d30);
  if (d30.step) ok(typeof d30.step.label === 'string' && 'op' in d30.step && 'params' in d30.step && 'href' in d30.step && 'pin' in d30.step, 'shape { label, op, params, href, pin }');
  const ag = await api.op('committee.next-step', { deal: 'D-0030' }, A);
  ok(ag.step === null || ag.step.key === 'open' || ag.step.key === 'schedule', 'your AI agent never gets vote, reveal or record', ag.step);
  // Partner meeting with no agenda item: Schedule IC.
  const pm = (await api.op('deals.list', { stage: 'partner_meeting', status: 'active', limit: 50 }, O)).deals;
  let checked = false;
  for (const d of pm) {
    const s = await api.op('committee.next-step', { deal: d.id }, O);
    if (s.step && s.step.key === 'schedule') {
      ok(s.step.op === 'deals.move' && s.step.params.stage === 'ic' && s.step.ready === true, 'Schedule IC moves the deal to IC', s.step);
      checked = true;
      break;
    }
  }
  ok(checked || pm.length === 0, 'a Partner meeting deal offers Schedule IC', pm.map((d) => d.number));
  const vf = await api.call('committee.next-step', { deal: 'D-9999' }, O);
  ok(vf.status === 404, 'unknown deal 404', vf.status);
  // Every member gets an answer (no 5xx).
  for (const who of ['partner@venture.test', 'partner2@venture.test', 'principal@venture.test', 'analyst@venture.test', 'finance@venture.test', 'platform@venture.test']) {
    const r = await api.call('committee.next-step', { deal: 'D-0030' }, { as: who });
    ok(r.status < 500, who + ' no 5xx', r.status);
    if (r.status === 200 && r.body.step) console.log('  ', who, r.body.step.key);
  }
}

/* ---------------------------------------------------------- UI-01 funnel */
{
  const f = await api.op('deals.funnel', {}, O);
  console.log('funnel:', f.stages.map((s) => s.label + ' ' + s.count + (s.conversion_ppm !== null ? ' (' + Math.round(s.conversion_ppm / 10000) + '%)' : '')).join(' > '));
  ok(f.stages[0].key === 'inbound' && f.stages[0].label === 'Inbound' && f.stages[0].count === f.cohort, 'first bar Inbound = the cohort');
  let shrink = true;
  for (let i = 1; i < f.stages.length; i++) {
    if (f.stages[i].count > f.stages[i - 1].count) shrink = false;
    const prev = f.stages[i - 1].count;
    const want = prev > 0 ? Math.round((f.stages[i].count * 1000000) / prev) : null;
    ok(f.stages[i].conversion_ppm === want, 'conversion of ' + f.stages[i].key + ' is the bar over the bar before', { got: f.stages[i].conversion_ppm, want });
  }
  ok(shrink, 'bars only shrink');
  ok(f.cohort > 0, 'the seeded quarter has inbound');
  ok(f.stages.slice(1).every((s) => typeof s.now === 'number'), 'stage bars carry now');
  const old = await api.op('deals.funnel', { quarter: '2020-Q1' }, O);
  ok(old.cohort === 0 && old.stages.every((s) => s.count === 0 && (s.key === 'inbound' || s.conversion_ppm === null)), 'an empty quarter: zeros, conversion unknown');
  const spv = await api.op('deals.funnel', { pipeline: 'spv' }, O);
  ok(spv.stages.length > 0 && spv.stages[0].key !== 'inbound', 'other pipelines: no Inbound bar');
  const fa = await api.op('deals.funnel', {}, A);
  ok(fa.stages[0].key === 'inbound', 'your AI agent reads the funnel');
  const home = await api.call('home.summary', {}, O);
  ok(home.status === 200, 'home.summary still answers', home.status);
}

console.log(`majors_a: ${pass} passed, ${fail} failed`);
process.exitCode = fail > 0 ? 1 : 0;
