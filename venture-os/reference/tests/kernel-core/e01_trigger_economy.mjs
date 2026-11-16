// The triggers (fix 8) on a SEEDED scratch copy (tools/dev/seed_demo.mjs), with the mock bridge recording
// every fire:
//   VO_APP=<seeded scratch copy> VO_PORT=3181 VO_BRIDGE=3281 node e01_trigger_economy.mjs
// It copies economy/zz_sim.pb.js into the copy's pb_hooks (removed at the end), starts the mock bridge on
// fixtures it writes per phase (new deck and update emails, external meetings today), restarts the app and
// proves: the seed leaves no agent work and every switch off; a demo firm gives 0 fires (switches on,
// people asking); 24 simulated hours with no person action and every switch off give 0 fires; each person
// action fires exactly its trigger once, with the record in its params; asking again for the same record
// while it waits gives 0 more fires; Retry after 24 hours fires once (and once more after a done or refused
// ask); each switch on alone for 24 hours fires only its own triggers, at most once per record; no hook
// reads the platform's request rows.
import { copyFileSync, cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP, BRIDGE, PORT, eq, newApi, ok, section, sleep, summary } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
if (/agent_app[\\/]venture_os_10f02ad4/.test(APP)) throw new Error('refusing the delivered app folder; use a seeded scratch copy');
const DEV = join(APP, 'tools', 'dev');
const HOOKS = join(APP, 'pb', 'pb_hooks');
const SIM = join(HOOKS, 'zz_sim.pb.js');
const FX = join(APP, 'logs', 'econ_fixtures');
const OUT = join(APP, 'logs', 'mock_' + BRIDGE);
const OUTSIDE = join(APP, '..', 'econ_files');
const TOKEN = readFileSync(join(APP, '.agent-token'), 'utf8').trim();
const DAY_MIN = 1440;
// Pulls from the open web (news, filings, rates) are not agent work: the simulated day leaves them out.
const SKIP = ['markets.news', 'markets.prefetch', 'kernel.fx_rates', 'markets.cleanup', 'markets.news_cleanup'];
const SWITCHES = ['email_decks', 'meeting_briefs', 'email_updates', 'board_briefs', 'news_digest', 'radar_sweeps', 'map_refresh', 'anti_portfolio'];
// The triggers each switch lets the app fire on its own.
const TRIGGERS_OF = { email_decks: ['deck_triage', 'deck_fetch'], meeting_briefs: ['meeting_brief'], email_updates: ['update_extract'], board_briefs: ['board_brief'], news_digest: ['news_digest', 'news_insights'], radar_sweeps: ['radar_sweep'], map_refresh: ['map_refresh'], anti_portfolio: ['anti_portfolio'] };
// Weekly and yearly schedules do not fall in an arbitrary day: their function runs once in the day.
const ONCE = { map_refresh: ['lib_markets_maps.cronMaps'], anti_portfolio: ['lib_committee.cronAntiPortfolio'], news_digest: ['lib_markets_news.cronDigest', 'lib_markets_insights.cronInsights'] };

/* ------------------------------------------------------------ fixtures */

function writeFixtures(phase) {
  const base = join(DEV, 'fixtures');
  mkdirSync(join(FX, 'gmail'), { recursive: true });
  mkdirSync(join(FX, 'calendar'), { recursive: true });
  for (const sub of ['decks', 'updates']) cpSync(join(base, sub), join(FX, sub), { recursive: true });
  writeFileSync(join(FX, 'rules.json'), '{}');
  // The fixture emails with new ids each phase: new decks arrive, and the founder updates come from two
  // portfolio founders of the demo firm (so they are filed to their companies).
  const FOUNDERS = ['Will Harper <will@pinecrestlogistics.com>', 'Nadia Volkova <nadia@kestrelrobotics.com>'];
  let k = 0;
  const msgs = JSON.parse(readFileSync(join(base, 'gmail', 'messages.json'), 'utf8')).map((m) => {
    const out = Object.assign({}, m, { id: m.id + '_' + phase, threadId: (m.threadId || m.id) + '_' + phase, received_hours_ago: 0.5 });
    if ((m.labels || []).includes('Venture OS/Updates')) out.headers = Object.assign({}, m.headers, { From: FOUNDERS[k++ % FOUNDERS.length], 'Message-ID': '<' + out.id + '@econ.test>' });
    return out;
  });
  writeFileSync(join(FX, 'gmail', 'messages.json'), JSON.stringify(msgs, null, 1));
  // Four external meetings in the next hours (new event ids each phase).
  const me = { email: 'owner@venture.test', displayName: 'Olivia Hart', responseStatus: 'accepted', self: true };
  const ev = (i, summary, h, who) => ({ id: 'econ_' + phase + '_' + i, summary, start_in_hours: h, duration_minutes: 45, organizer: { email: me.email, displayName: me.displayName, self: true }, attendees: [me, ...who] });
  writeFileSync(
    join(FX, 'calendar', 'events.json'),
    JSON.stringify([
      ev(1, 'Orchard AI: partner meeting', 2, [{ email: 'priya@orchard-ai.com', displayName: 'Priya Natarajan', responseStatus: 'accepted' }]),
      ev(2, 'Pallas Microgrid intro call', 3, [{ email: 'sofia@pallasmicrogrid.com', displayName: 'Sofia Lindqvist', responseStatus: 'accepted' }]),
      ev(3, 'Cascade Teachers Pension: check-in', 5, [{ email: 'h.morales@cascadepension.example', displayName: 'Helena Morales', responseStatus: 'accepted' }]),
      ev(4, 'Rivet Health follow-up', 7, [{ email: 'marcus@rivethealth.com', displayName: 'Marcus Bell', responseStatus: 'accepted' }]),
    ]),
  );
}

/* -------------------------------------------------------------- servers */

const sh = (script, ...a) => execFileSync('bash', [join(DEV, script), ...a.map(String)], { stdio: 'pipe' }).toString();
async function startBridge() {
  sh('stop.sh', BRIDGE);
  mkdirSync(OUT, { recursive: true });
  const child = spawn(process.execPath, [join(DEV, 'mock_bridge.mjs'), String(BRIDGE), FX, OUT], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${BRIDGE}/__mock/health`)).ok) return;
    } catch {
      /* not yet */
    }
    await sleep(250);
  }
  throw new Error('the mock bridge did not start');
}
const fires = async () => (await (await fetch(`http://127.0.0.1:${BRIDGE}/__mock/fires`)).json()).fires;
const resetFires = async () => (await fetch(`http://127.0.0.1:${BRIDGE}/__mock/reset`, { method: 'POST' })).json();
async function sim(action, body = {}) {
  const r = await fetch(`http://127.0.0.1:${PORT}/__sim/${action}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-sim-token': TOKEN }, body: JSON.stringify(body) });
  const j = await r.json();
  if (r.status !== 200) throw new Error('sim ' + action + ': ' + JSON.stringify(j));
  return j;
}
/** 24 simulated hours from now: every cron entry at each minute (in chunks of 2 hours). */
async function day() {
  const start = Math.floor(Date.now() / 60000) * 60000;
  let ran = 0;
  const failed = [];
  for (let m = 0; m < DAY_MIN; m += 120) {
    const r = await sim('day', { start: start + m * 60000, minutes: 120, skip: SKIP });
    ran += r.ran;
    failed.push(...r.failed);
  }
  return { ran, failed };
}
const ids = async (collection, filter, limit = 12, sort = '-created', field = '') => (await sim('ids', { collection, filter, limit, sort, field })).ids;
const requestsSince = async (since) => (await sim('requests', { since })).requests;
const nowSql = () => new Date().toISOString().replace('T', ' ');

/* ---------------------------------------------------------------- start */

writeFixtures('start');
copyFileSync(join(HERE, 'economy', 'zz_sim.pb.js'), SIM);
await startBridge();
sh('serve.sh', APP, PORT, BRIDGE);
const api = newApi();
const O = { as: 'owner' };
const A = { as: 'agent' };
const OFF = Object.fromEntries(SWITCHES.map((k) => [k, false]));
const setPolicy = (on) => api.op('settings.update', { agent_policy: JSON.stringify(Object.assign({}, OFF, on)) }, O);
const setDemo = (demo) => api.op('settings.update', { mail: { demo } }, O);
const clearCooldowns = () => sim('cooldowns');

/**
 * One person action: clear the cooldowns, run it, then expect exactly one new fire, of this trigger,
 * whose request names the record. Answers the record id (or null).
 */
async function personAsk(trigger, param, how, run) {
  await clearCooldowns();
  const before = (await fires()).length;
  const since = nowSql();
  let out;
  try {
    out = await run();
  } catch (err) {
    ok(false, `${trigger}: ${how}`, { error: String(err && err.message ? err.message : err), body: err && err.body });
    return null;
  }
  if (!out || !out.ok) {
    ok(false, `${trigger}: ${how}`, out);
    return null;
  }
  await sleep(350);
  const fresh = (await fires()).slice(before);
  const rows = await requestsSince(since);
  const row = fresh.length === 1 ? rows.find((r) => r.id === fresh[0].request_id) : null;
  const got = row ? (param ? String((row.params || {})[param] ?? '') : '') : '?';
  const want = param ? out.record : '';
  ok(fresh.length === 1 && fresh[0].trigger === trigger && row !== null && got === want, `${trigger}: ${how} fires it once, with ${param ? param + ' ' + want : 'no record'}`, { fires: fresh, row });
  if (trigger !== 'question_asked') await askAgainWhilePending(trigger, out.record);
  return out.record;
}

/** Try records until the action answers 200 (a check may refuse some): { ok, record, body }. */
async function firstOk(cands, fn) {
  let last = null;
  for (const id of cands) {
    const r = await fn(id);
    if (r.status === 200) return { ok: true, record: id, body: r.body };
    last = { id, status: r.status, body: r.body };
  }
  return { ok: false, last };
}
const asked = (trigger, record) => api.call('agent.ask', record ? { trigger, record } : { trigger }, O);

/** Asking again for the same record while it waits: 409 pending, 0 more fires. */
async function askAgainWhilePending(trigger, record) {
  await clearCooldowns();
  const before = (await fires()).length;
  const r = await asked(trigger, record);
  await sleep(250);
  const more = (await fires()).length - before;
  ok(r.status === 409 && r.body && r.body.code === 'pending' && more === 0, `${trigger}: asking again while it waits is refused (409 pending), 0 more fires`, { status: r.status, body: r.body, more });
}

const scratchFile = (name, from) => {
  mkdirSync(OUTSIDE, { recursive: true });
  const to = join(OUTSIDE, name);
  copyFileSync(from, to);
  return to;
};

try {
  section('the seeded demo firm');
  const st = await api.op('settings.get', {}, O);
  eq(st.agent_policy, OFF, 'every switch is off');
  eq(st.mail.demo, true, 'it is a demo firm');
  eq((st.agent_triggers || []).length, 28, '28 triggers, one per task');
  eq((await requestsSince('2000-01-01 00:00:00')).length, 0, 'the seed asked your AI agent nothing (0 request rows)');
  const waiting = await api.op('chat.list', { status: 'waiting' }, O);
  eq((waiting.asks ?? waiting.questions ?? []).length, 0, 'no question waits for an answer');

  section('static: hooks never read the request rows');
  // The platform's own trigger plane (files starting with _) owns agent_requests; the app's hooks never query it.
  const READ = /(findRecords?By\w*|findFirstRecordBy\w*|countRecords|findRecordById)\(\s*['"]agent_requests['"]|FROM\s+agent_requests|JOIN\s+agent_requests/;
  const readers = readdirSync(HOOKS).filter((f) => f.endsWith('.js') && !f.startsWith('_') && f !== 'zz_sim.pb.js' && READ.test(readFileSync(join(HOOKS, f), 'utf8')));
  eq(readers, [], "no app hook queries agent_requests (only the platform's trigger plane does)");
  const jobsLeft = readdirSync(HOOKS).filter((f) => /^lib_(jobs|wake)\.js$/.test(f));
  eq(jobsLeft, [], 'lib_jobs.js and lib_wake.js are gone');

  section('a demo firm never fires');
  await setPolicy(Object.fromEntries(SWITCHES.map((k) => [k, true])));
  await resetFires();
  await clearCooldowns();
  writeFixtures('demo');
  const companies = await ids('companies', "deleted_at = ''", 6, 'name');
  const dr = await asked('company_research', companies[0]);
  ok(dr.status === 409 && dr.body.code === 'demo' && /demo firm/.test(dr.body.message), 'a person asking is told: this is the demo firm (409)', dr.body);
  const dc = await api.op('chat.ask', { text: 'What changed this week?' }, O);
  ok(dc.ask && dc.ask.status === 'failed' && /demo firm/.test(dc.ask.failure), 'a question in a demo firm says your AI agent is not asked', dc);
  const dd = await day();
  await sim('run', { fns: ['lib_markets_maps.cronMaps', 'lib_committee.cronAntiPortfolio', 'lib_markets_news.cronDigest', 'lib_markets_insights.cronInsights'] });
  await sleep(400);
  console.log(`  (${dd.ran} cron runs${dd.failed.length > 0 ? ', failed: ' + dd.failed.slice(0, 3).join('; ') : ''})`);
  eq((await fires()).length, 0, '0 fires in 24 hours with every switch on and people asking');
  await setPolicy({});
  await setDemo(false);

  section('24 simulated hours, no person action, every switch off');
  writeFixtures('idle');
  await resetFires();
  await clearCooldowns();
  const since0 = nowSql();
  const d0 = await day();
  await sim('run', { fns: ['lib_markets_maps.cronMaps', 'lib_committee.cronAntiPortfolio', 'lib_markets_news.cronDigest', 'lib_markets_insights.cronInsights', 'lib_portfolio_updates.boardDue', 'lib_agent.reask'] });
  await sleep(400);
  console.log(`  (${d0.ran} cron runs${d0.failed.length > 0 ? ', failed: ' + d0.failed.slice(0, 3).join('; ') : ''})`);
  eq((await fires()).length, 0, '0 fires in 24 hours (decks, updates and meetings arrived)');
  eq((await requestsSince(since0)).length, 0, 'and no request row');

  section('each person action fires exactly its trigger, with its record');
  await resetFires();
  const R = {};
  // Inbox
  R.deck_triage = await personAsk('deck_triage', 'item_id', 'Add deal with the deck as text (intake.add)', async () => {
    const r = await api.op('intake.add', { name: 'Econ Robotics', text: 'Econ Robotics builds warehouse picking robots for mid-size grocers. Raising a USD 3M seed; 4 pilots live.' }, O);
    return { ok: true, record: r.id ?? r.item?.id };
  });
  R.deck_fetch = await personAsk('deck_fetch', 'item_id', 'Add deal with a DocSend link (intake.add)', async () => {
    const r = await api.op('intake.add', { name: 'Econ Grid', url: 'https://docsend.com/view/econgrid42' }, O);
    return { ok: true, record: r.id ?? r.item?.id };
  });
  R.pass_draft = await personAsk('pass_draft', 'pass_id', 'Pass with an email (intake.pass)', async () => {
    // An item with nothing to read (no fire of its own), passed with an email to its founder.
    const it = await api.op('intake.add', { company: 'Econ Pass Co', source_person: { name: 'Pat Econ', email: 'pat@econpass.test' } }, O);
    await api.op('intake.pass', { item: it.id, reason: 'timing', email: true }, O);
    const p = await ids('passes', `item = '${it.id}'`, 1);
    return { ok: p.length === 1, record: p[0] };
  });
  // Deals, network
  R.note_review = await personAsk('note_review', 'note_id', 'Ask your AI agent on a saved note (notes.review)', async () => firstOk(await ids('notes', "status = 'saved' && body_text != '' && deleted_at = ''"), (id) => api.call('notes.review', { note: id }, O)));
  const extEvents = await ids('cal_events', 'external = true', 20, '-created');
  R.meeting_brief = await personAsk('meeting_brief', 'event_id', 'Brief on a meeting (briefs.request)', async () => firstOk(extEvents, (id) => api.call('briefs.request', { event: id }, O)));
  R.company_research = await personAsk('company_research', 'company_id', 'Ask your AI agent on a company (agent.ask)', async () => firstOk(companies, (id) => asked('company_research', id)));
  R.intro_draft = await personAsk('intro_draft', 'intro_id', 'Ask for an intro on a path (intros.request)', async () => {
    for (const person of await ids('people', "email != '' && deleted_at = ''", 60, '-created')) {
      const np = await api.call('network.paths', { person }, O);
      const path = np.status === 200 ? (np.body.paths ?? [])[0] : undefined;
      if (!path) continue;
      const ir = await api.call('intros.request', { target: person, via: path.member, connector: path.connector?.id ?? '', note: 'Econ test intro' }, O);
      if (ir.status === 200) return { ok: true, record: ir.body.id ?? ir.body.intro?.id };
    }
    return { ok: false, last: 'no person with a path' };
  });
  // Diligence
  const dealIds = (await ids('deals', "stage = 'diligence' && status = 'open'", 10)).concat(await ids('deals', "status = 'open'", 30));
  R.diligence_answers = await personAsk('diligence_answers', 'deal_id', 'Ask your AI agent on a checklist (dd.ask)', async () => firstOk(dealIds, (id) => api.call('dd.ask', { deal: id }, O)));
  R.refs_suggest = await personAsk('refs_suggest', 'deal_id', "Ask your AI agent on a deal's references (refs.ask)", async () => firstOk(dealIds, (id) => api.call('refs.ask', { deal: id }, O)));
  R.page_ocr = await personAsk('page_ocr', 'file_id', 'Ask your AI agent on a file with scanned pages (agent.ask)', async () =>
    firstOk(await ids('pages', '1=1', 400, '-created', 'file'), async (id) => {
      await sim('scan', { file: id });
      return asked('page_ocr', id);
    }),
  );
  R.grid_answers = await personAsk('grid_answers', 'grid_id', 'Ask your AI agent on a comparison grid (agent.ask)', async () => {
    // A grid of a company without a deal room and no answers yet (made without filling, so nothing fires).
    for (const c of companies.slice(0, 6)) {
      const g = await api.call('compare.save', { name: 'Econ grid', companies: JSON.stringify([c]), columns: JSON.stringify(['traction_arr']), fill: false }, O);
      if (g.status !== 200) continue;
      const r = await asked('grid_answers', g.body.grid.id);
      if (r.status === 200) return { ok: true, record: g.body.grid.id, body: r.body };
    }
    return { ok: false, last: 'no grid with an empty cell' };
  });
  // Committee
  R.memo_sections = await personAsk('memo_sections', 'memo_id', 'Draft on a memo (memos.draft-sections)', async () => firstOk(await ids('memos', "status = 'draft'"), (id) => api.call('memos.draft-sections', { memo: id }, O)));
  R.bear_case = await personAsk('bear_case', 'item_id', 'Bear case on an agenda item (bearcase.request)', async () => firstOk(await ids('agenda_items', '1=1', 12), (id) => api.call('bearcase.request', { item: id }, O)));
  R.anti_portfolio = await personAsk('anti_portfolio', '', 'Ask your AI agent on the anti-portfolio (agent.ask)', async () => {
    const r = await asked('anti_portfolio');
    return { ok: r.status === 200, record: null, body: r.body };
  });
  // Portfolio
  const holdingIds = await ids('holdings', '1=1', 10, 'created');
  R.update_extract = await personAsk('update_extract', 'update_id', 'Add a founder update (updates.add)', async () => {
    const h = await api.op('holdings.list', {}, O);
    const co = (h.holdings ?? h.rows ?? [])[0].company;
    await api.op('updates.add', { company: co.id ?? co.name ?? co, subject: 'Econ: October update', text: 'Revenue USD 210k in October, up 8%. Burn USD 140k. Cash USD 2.1M. Hired a VP Sales.' }, O);
    const u = await ids('updates', '1=1', 1);
    return { ok: true, record: u[0] };
  });
  R.closing_extract = await personAsk('closing_extract', 'holding_id', 'Ask your AI agent on a holding with closing documents (agent.ask)', async () => {
    const pdf = scratchFile('econ_closing.pdf', join(DEV, 'fixtures', 'decks', 'acme_robotics_seed.pdf'));
    await api.op('files.upload', { owner_collection: 'holdings', owner_id: holdingIds[0], folder: 'Closing', paths: JSON.stringify([pdf]) }, A);
    const r = await asked('closing_extract', holdingIds[0]);
    return { ok: r.status === 200, record: holdingIds[0], body: r.body };
  });
  R.board_brief = await personAsk('board_brief', 'meeting_id', 'Brief on a board meeting (agent.ask)', async () => firstOk(await ids('board_meetings', '1=1', 10, '-day'), (id) => asked('board_brief', id)));
  // Funds
  const openQ = await ids('quarters', "status = 'open'", 1);
  R.mark_notes = await personAsk('mark_notes', 'quarter_id', 'Ask your AI agent for marks on an open quarter (agent.ask)', async () => firstOk(openQ, (id) => asked('mark_notes', id)));
  R.notice_review = await personAsk('notice_review', 'event_id', 'Ask your AI agent on a previewed call (agent.ask)', async () => {
    const d = await api.op('calls.draft', { fund: 'Fund I', purpose: 'expenses', amount: '25000.00', label: 'Econ audit fees' }, O);
    const id = (d.event ?? d).id;
    await api.op('calls.preview', { event: id }, O);
    const r = await asked('notice_review', id);
    return { ok: r.status === 200, record: id, body: r.body };
  });
  R.reconcile = await personAsk('reconcile', 'statement_id', 'Ask your AI agent on a statement with open differences (agent.ask)', async () => {
    const s = await api.op('statements.import', { fund: 'Fund I', source: 'bank', rows: JSON.stringify([{ date: '2026-11-02', amount: '12345.67', reference: 'Unknown wire ECON', payer: 'Nobody Known' }]) }, O);
    const r = await asked('reconcile', s.statement.id);
    return { ok: r.status === 200, record: s.statement.id, body: r.body };
  });
  R.lp_letter = await personAsk('lp_letter', 'quarter_id', 'Ask your AI agent for the letter of a frozen quarter (agent.ask)', async () => {
    const q = openQ[0];
    const fr = await api.call('quarters.freeze', { quarter: q }, { as: 'owner', pin: true });
    if (fr.status !== 200) await sim('set', { collection: 'quarters', id: q, fields: { status: 'frozen' } });
    const r = await asked('lp_letter', q);
    return { ok: r.status === 200, record: q, body: r.body };
  });
  R.lp_answer = await personAsk('lp_answer', 'question_id', "Log an LP's question (lpq.log)", async () => {
    await api.op('lpq.log', { lp: 'Aster Insurance Group', question: 'When is the next Fund I distribution expected?', fund: 'Fund I' }, O);
    const q = await ids('lp_questions', '1=1', 1);
    return { ok: true, record: q[0] };
  });
  // Markets
  R.radar_sweep = await personAsk('radar_sweep', 'radar_id', 'Run on a radar (radars.run)', async () =>
    firstOk(await ids('radars', "status = 'active'"), async (id) => {
      const r = await api.call('radars.run', { radar: id }, O);
      return r.status === 200 && !r.body.request ? { status: 409, body: r.body } : r;
    }),
  );
  R.map_refresh = await personAsk('map_refresh', 'map_id', 'Refresh on a map (agent.ask)', async () => firstOk(await ids('maps', "status = 'active'"), (id) => asked('map_refresh', id)));
  R.news_digest = await personAsk('news_digest', '', 'Ask your AI agent for the news digest (agent.ask)', async () => {
    const r = await asked('news_digest');
    return { ok: r.status === 200, record: null, body: r.body };
  });
  R.news_insights = await personAsk('news_insights', '', 'Ask your AI agent on the news (news.insights-ask)', async () => {
    const r = await api.call('news.insights-ask', {}, O);
    return { ok: r.status === 200, record: null, body: r.body };
  });
  R.market_brief = await personAsk('market_brief', 'report_id', 'Ask for a market brief (research.ask)', async () => {
    await api.op('research.ask', { topic: 'Grid-scale batteries in Southeast Asia', sector: 'climate' }, O);
    const r = await ids('research_reports', '1=1', 1);
    return { ok: true, record: r[0] };
  });
  R.question_asked = await personAsk('question_asked', 'ask_id', 'Tell your AI agent (chat.ask)', async () => {
    const r = await api.op('chat.ask', { text: 'Which deals wait on a partner meeting?' }, O);
    return { ok: true, record: r.ask.id };
  });
  const firedAll = await fires();
  const names = [...new Set(firedAll.map((f) => f.trigger))].sort();
  eq(names.length, 28, 'all 28 triggers fired from a person action (' + names.length + ')');
  eq(firedAll.length, 28, 'and 28 fires in all, one per action');

  section('the same screens asked again while it waits');
  await clearCooldowns();
  const before2 = (await fires()).length;
  const rb = await api.call('briefs.request', { event: R.meeting_brief }, O);
  const rn = await api.call('notes.review', { note: R.note_review }, O);
  const ri = await api.call('intake.add', { name: 'Econ Robotics', text: 'Econ Robotics builds warehouse picking robots.' }, O);
  await sleep(300);
  ok(rb.status === 200 && rb.body.queued === false && rb.body.brief.ask.pending === true, 'Brief on the same meeting again shows the brief it waits for (not asked again)', rb.body);
  ok(rn.status === 409 && rn.body.code === 'pending', 'Review the same note again: 409 pending', rn.body);
  eq((await fires()).length - before2, ri.status === 200 ? 1 : 0, 'only the new Inbox item fired (a new record)');

  section('Retry after 24 hours, and after an answer or a refusal');
  await clearCooldowns();
  let n = (await fires()).length;
  const early = await api.call('notes.review', { note: R.note_review }, O);
  ok(early.status === 409 && /24 hours/.test(early.body.message), 'Retry before 24 hours is refused, in plain words', early.body);
  await sim('age', { collection: 'notes', id: R.note_review, trigger: 'note_review', hours: 25 });
  const g = await api.op('notes.get', { note: R.note_review }, O).catch(() => null);
  const rv = g && (g.note ?? g).review;
  ok(rv && rv.state === 'failed' && /picked this up/.test(rv.error), 'asked 25 hours ago and not answered: the note says your AI agent has not picked it up', rv);
  await clearCooldowns();
  const rt = await api.call('notes.review', { note: R.note_review }, O);
  await sleep(350);
  const f1 = (await fires()).slice(n);
  ok(rt.status === 200 && f1.length === 1 && f1[0].trigger === 'note_review', 'Retry: exactly 1 fire', { status: rt.status, body: rt.body, f1 });
  await clearCooldowns();
  const rt2 = await api.call('notes.review', { note: R.note_review }, O);
  ok(rt2.status === 409, 'Retry again at once: refused (it waits again)', rt2.body);
  // The platform says done (your AI agent finished without the result op): the screen asks once more with --again.
  await sim('finish', { request: rt.body.request, status: 'done', result: 'Reviewed' });
  await clearCooldowns();
  n = (await fires()).length;
  const wrong = await api.call('notes.review', { note: R.note_review, again: 'nope00000000000' }, O);
  ok(wrong.status === 409, '--again with another request id is refused', wrong.body);
  const ag = await api.call('notes.review', { note: R.note_review, again: rt.body.request }, O);
  await sleep(350);
  ok(ag.status === 200 && (await fires()).length - n === 1, 'Ask again after it was done: exactly 1 fire', ag.body);
  // Your AI agent could not: the record shows why and a person may ask again at once.
  const cn = await api.call('agent.cannot', { trigger: 'company_research', record: R.company_research, reason: 'The website is down; try again tomorrow.' }, A);
  ok(cn.status === 200, 'agent.cannot records why', cn.body);
  await clearCooldowns();
  n = (await fires()).length;
  const ac = await asked('company_research', R.company_research);
  await sleep(350);
  ok(ac.status === 200 && (await fires()).length - n === 1, 'Ask again after a refusal: exactly 1 fire', ac.body);
  // The result lands: the record is no longer waiting, so another ask is welcome.
  const landed = await api.call('records.enrich', { company: R.company_research, fields: JSON.stringify({ description: 'Econ test: a short description from public sources.' }), source_ref: 'https://example.com/econ' }, A);
  await clearCooldowns();
  n = (await fires()).length;
  const al = await asked('company_research', R.company_research);
  await sleep(350);
  ok(landed.status === 200 && al.status === 200 && (await fires()).length - n === 1, 'after the result op landed, asking again fires once', { landed: landed.body, al: al.body });

  section('each switch on alone, 24 hours');
  // A board meeting tomorrow (the board brief schedule needs one with no brief yet), and every radar due.
  await api.op('board.save', { company: 'pinecrestlogistics.com', day: new Date(Date.now() + 86400000).toISOString().slice(0, 10), time: '10:00', title: 'Board meeting: plan review' }, O).catch(() => null);
  const table = [];
  // The firm-wide asks a person made above are a day old now (nobody answered), so the schedules may ask again.
  for (const t of ['news_digest', 'news_insights', 'anti_portfolio']) await sim('age', { collection: 'settings', trigger: t, hours: 25 });
  for (const key of SWITCHES) {
    writeFixtures(key);
    await clearCooldowns();
    await setPolicy({ [key]: true });
    if (key === 'radar_sweeps') await sim('radars_due');
    await resetFires();
    const since = nowSql();
    await day();
    if (ONCE[key]) await sim('run', { fns: ONCE[key] });
    await sim('run', { fns: ['lib_agent.reask'] });
    await sleep(500);
    const f = await fires();
    const rows = await requestsSince(since);
    const other = f.filter((x) => !TRIGGERS_OF[key].includes(x.trigger));
    const perRecord = {};
    for (const r of rows) {
      const k = r.trigger + ':' + Object.values(r.params || {}).join(',');
      perRecord[k] = (perRecord[k] || 0) + 1;
    }
    const twice = Object.entries(perRecord).filter(([, c]) => c > 1);
    table.push(`${key}: ${f.length} fire${f.length === 1 ? '' : 's'} (${[...new Set(f.map((x) => x.trigger))].join(', ') || 'none'})`);
    ok(f.length >= 1, `${key}: its schedule asks (${f.length} fire${f.length === 1 ? '' : 's'})`);
    eq(other.length, 0, `${key}: only ${TRIGGERS_OF[key].join(' or ')} fire`);
    eq(twice, [], `${key}: no record asked twice in the day`);
    if (['news_digest', 'anti_portfolio'].includes(key)) ok(f.length <= TRIGGERS_OF[key].length, `${key}: at most one fire of each firm trigger (${f.length})`);
    // A second day while nobody answered: what waits is not asked again.
    await clearCooldowns();
    const mid = nowSql();
    await day();
    if (ONCE[key]) await sim('run', { fns: ONCE[key] });
    await sleep(400);
    const repeats = (await requestsSince(mid)).filter((r) => perRecord[r.trigger + ':' + Object.values(r.params || {}).join(',')] !== undefined);
    eq(repeats.length, 0, `${key}: a second day while nobody answered asks nothing again for the same record`);
    await setPolicy({});
  }
  console.log('  ' + table.join('\n  '));
} finally {
  await setPolicy({}).catch(() => null);
  await setDemo(true).catch(() => null);
  rmSync(SIM, { force: true });
  rmSync(OUTSIDE, { recursive: true, force: true });
  sh('stop.sh', PORT);
  sh('stop.sh', BRIDGE);
}

const s = summary('e01_trigger_economy');
process.exitCode = s.failed > 0 ? 1 : 0;
