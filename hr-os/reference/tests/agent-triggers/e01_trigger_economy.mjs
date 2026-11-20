// The trigger economy on a SEEDED scratch copy (tools/dev/seed_demo.mjs), with the mock bridge recording
// every fire the app nudges:
//   HR_APP=<seeded scratch copy> HR_PORT=3185 HR_BRIDGE=3285 node e01_trigger_economy.mjs
// It copies zz_sim.pb.js into the copy's pb_hooks (removed at the end), starts mock_bridge.mjs, restarts the
// app with the bridge in its environment and proves:
//   - 24 simulated hours with no person action and every Automatic work switch off: 0 fires;
//   - each person action fires exactly its own trigger once, with the record's id in its params;
//   - asking again while that ask is open (a repeat click, a second receipt on the same claim): 0 more fires;
//   - an ask nobody picked up in 24 hours shows as unanswered, nothing asks again on its own (0 fires in a
//     simulated day), Retry fires once, and a second Retry of the same request fires nothing;
//   - an ask the cooldown held back is sent once by the minute job;
//   - each Automatic work switch on alone: at most its schedule's fires, and 0 with it off.
import { copyFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = process.env.HR_APP;
const PORT = Number(process.env.HR_PORT ?? 3185);
const BRIDGE = Number(process.env.HR_BRIDGE ?? 3285);
if (!APP || /agent_app[\\/]hr_os_37878b99/.test(APP)) throw new Error('HR_APP must be a seeded scratch copy, never the delivered app folder');
if ((PORT >= 3100 && PORT <= 3179) || (BRIDGE >= 3100 && BRIDGE <= 3179)) throw new Error('never a live port');
const { client, DEMO } = await import('file:///' + join(APP, 'tools', 'dev', 'api.mjs').replace(/\\/g, '/'));
const DEV = join(APP, 'tools', 'dev');
const SIM = join(APP, 'pb', 'pb_hooks', 'zz_sim.pb.js');
const TOKEN = readFileSync(join(APP, '.agent-token'), 'utf8').trim();
const BASE = `http://127.0.0.1:${PORT}`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const SKIP = ['reports_warm'];
const TRIGGERS = ['receipt_review', 'payrun_review', 'variance_explain', 'pack_update_draft', 'rule_update_check', 'letter_draft', 'job_post_draft', 'interview_summary', 'timesheet_review', 'timesheet_check', 'review_summary_draft', 'onboarding_help', 'question_asked'];

let passed = 0;
let failed = 0;
const failures = [];
let current = '';
const section = (n) => ((current = n), console.log('\n## ' + n));
function ok(cond, msg, extra) {
  if (cond) {
    passed++;
    console.log('  ok   ' + msg);
  } else {
    failed++;
    failures.push(current + ': ' + msg);
    console.log('  FAIL ' + msg + (extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 500) : ''));
  }
}
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* -------------------------------------------------------------- servers */

const sh = (script, args, env) => execFileSync('bash', [join(DEV, script), ...args.map(String)], { stdio: 'pipe', env: Object.assign({}, process.env, env || {}) }).toString();
async function startBridge() {
  sh('stop.sh', [BRIDGE]);
  const child = spawn(process.execPath, [join(HERE, 'mock_bridge.mjs'), String(BRIDGE)], { detached: true, stdio: 'ignore', windowsHide: true });
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
const resetFires = () => fetch(`http://127.0.0.1:${BRIDGE}/__mock/reset`, { method: 'POST' });
async function sim(action, body = {}) {
  const r = await fetch(`${BASE}/__sim/${action}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-sim-token': TOKEN }, body: JSON.stringify(body) });
  const j = await r.json();
  if (r.status !== 200) throw new Error('sim ' + action + ': ' + JSON.stringify(j));
  return j;
}
/** Simulated hours from `start` (ms): each minute the kernel minute work and the module cron jobs run. */
async function hours(n, start) {
  const s = Math.floor((start ?? Date.now()) / 60000) * 60000;
  let ran = 0;
  const bad = [];
  for (let m = 0; m < n * 60; m += 120) {
    const r = await sim('day', { start: s + m * 60000, minutes: Math.min(120, n * 60 - m), skip: SKIP });
    ran += r.ran;
    bad.push(...r.failed);
  }
  return { ran, failed: bad };
}
const clearCooldowns = () => sim('cooldowns', { triggers: TRIGGERS });
async function requestRow(id) {
  const r = await fetch(`${BASE}/api/collections/agent_requests/records/${id}`);
  return r.ok ? r.json() : null;
}
async function requestCount() {
  const r = await fetch(`${BASE}/api/collections/agent_requests/records?perPage=1`);
  return (await r.json()).totalItems;
}

/** Run an action and expect exactly one fire of `trigger` naming `record` (by its param). */
async function firesOnce(label, trigger, param, action) {
  await clearCooldowns();
  await resetFires();
  const out = await action();
  await sleep(150);
  const f = await fires();
  const rec = typeof out.record === 'function' ? await out.record() : out.record;
  const row = f.length === 1 ? await requestRow(f[0].request_id) : null;
  ok(f.length === 1 && f[0].trigger === trigger && row !== null && row.params && row.params[param] === rec, `${label}: 1 fire of ${trigger} with ${param} = the record`, { fires: f, params: row && row.params, record: rec });
  return { out, fire: f[0], row };
}
/** Run an action and expect no fire at all. */
async function firesNone(label, action) {
  await clearCooldowns();
  await resetFires();
  await action();
  await sleep(150);
  const f = await fires();
  eq(f.length, 0, label + ': 0 fires');
}

async function upload(api, name, fields, files, as) {
  await api.op('auth.me', {}, { as });
  const token = api.tokens.get(as === 'owner' ? DEMO.owner : as);
  const page = await fetch(BASE + '/', { redirect: 'manual' });
  await page.text();
  const set = typeof page.headers.getSetCookie === 'function' ? page.headers.getSetCookie() : [];
  const cookie = set.map((c) => String(c).split(';')[0]).filter((c) => c.startsWith('a2app_s_')).join('; ');
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields || {})) fd.append(k, String(v));
  for (const [k, f] of Object.entries(files || {})) fd.append(k, new Blob([f.data], { type: f.type }), f.name);
  const res = await fetch(BASE + '/api/ops/' + name.replace('.', '/'), { method: 'POST', headers: Object.assign({ authorization: token, accept: 'application/json' }, cookie ? { cookie } : {}), body: fd });
  return { status: res.status, body: await res.json() };
}

/* ---------------------------------------------------------------- start */

copyFileSync(join(HERE, 'zz_sim.pb.js'), SIM);
let api;
try {
  await startBridge();
  sh('stop.sh', [PORT]);
  sh('serve.sh', [APP, PORT], { CRAFTBOT_BRIDGE_URL: `http://127.0.0.1:${BRIDGE}`, CRAFTBOT_BRIDGE_TOKEN: 'econ-test-token' });
  api = client({ port: PORT, app: APP });
  const O = { as: 'owner' };
  const A = { as: 'agent' };
  const HR = { as: 'hr@northwind.test' };
  const PAY = { as: 'payroll@northwind.test' };
  const ENG = { as: 'eng.lead@northwind.test' };
  const SAM = 'sam@northwind.test';
  const HARUTO = 'haruto@northwind.test';
  const setAuto = (on) => api.op('settings.automatic', { automatic: JSON.stringify(Object.assign({ checklist_tasks: false, weekly_timesheet_check: false, monthly_rule_checks: false }, on)) }, O);

  section('24 simulated hours, nobody asks, every switch off');
  await setAuto({});
  await resetFires();
  const rows0 = await requestCount();
  const idle = await hours(24);
  ok(idle.ran > 1000 && idle.failed.length === 0, `the module cron jobs ran (${idle.ran} runs) without errors`, idle.failed);
  eq((await fires()).length, 0, '24 idle hours: 0 fires');
  eq(await requestCount(), rows0, 'no request row was added');

  section('each person action fires exactly its own trigger, with its record');
  const q = await firesOnce('a question', 'question_asked', 'question_id', async () => {
    const r = await api.op('questions.ask', { question: 'How many people work in Japan?' }, O);
    return { record: r.question.id };
  });
  const rc = await firesOnce('a receipt photo', 'receipt_review', 'claim_id', async () => {
    const r = await upload(api, 'claim-lines.add', {}, { receipt: { data: PNG, type: 'image/png', name: 'taxi.png' } }, SAM);
    return { record: r.body.claim.id, body: r.body };
  });
  ok(rc.out.body.line.receipt_status === 'waiting' && rc.out.body.claim.agent.open === true, 'the line waits and the claim shows the open ask', rc.out.body.claim.agent);
  const runs = (await api.op('payruns.list', { status: 'all' }, PAY)).payruns;
  const run = runs.find((r) => r.status === 'locked');
  const rr = await firesOnce('Review, on a pay run', 'payrun_review', 'payrun_id', async () => {
    await api.op('payruns.review', { payrun: run.id, focus: 'Overtime' }, PAY);
    return { record: run.id };
  });
  const slips = (await api.op('payruns.get', { payrun: run.id }, PAY)).payslips;
  await firesOnce('Ask why, on a payslip', 'variance_explain', 'payslip_id', async () => {
    const r = await api.op('payruns.explain', { payrun: run.id, employment: slips[0].employment }, PAY);
    return { record: r.agent.record };
  });
  const packs = (await api.op('packs.list', {}, PAY)).packs.filter((p) => p.status === 'active' && p.in_use > 0);
  const pk = await firesOnce('Ask for an update, on a rule pack', 'pack_update_draft', 'pack_id', async () => {
    await api.op('packs.ask-update', { pack: packs[0].id, note: 'The 2027 rates' }, PAY);
    return { record: packs[0].id };
  });
  await firesOnce('Check for updates, on another rule pack', 'pack_update_draft', 'pack_id', async () => {
    await api.op('packs.check-updates', { pack: packs[1].id }, PAY);
    return { record: packs[1].id };
  });
  await firesOnce('Ask your AI agent to write a letter', 'letter_draft', 'letter_id', async () => {
    const r = await api.op('letters.request-draft', { employee: 'E0002', instructions: 'Visa support letter confirming role and start day' }, HR);
    return { record: r.letter.id };
  });
  const opening = (await api.op('openings.add', { entity: 'Northwind Pte Ltd', title: 'Platform engineer' }, O)).opening;
  await firesOnce('Draft the post, on an opening', 'job_post_draft', 'opening_id', async () => {
    await api.op('openings.draft-post', { opening: opening.id, notes: 'Stress the platform team' }, O);
    return { record: opening.id };
  });
  const cand = await api.op('candidates.add', { name: 'Riley Chen', email: 'riley@example.com', source: 'job_board', opening: opening.id, consent: true }, O);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const iv = (await api.op('interviews.schedule', { application: cand.application.id, day: tomorrow, start: '10:00', interviewers: [DEMO.owner] }, O)).interview;
  await api.op('scorecards.save', { interview: iv.id, recommendation: 'yes', notes: 'Clear and kind', submit: true }, O);
  await firesOnce('Summarise, on an interview', 'interview_summary', 'interview_id', async () => {
    await api.op('interviews.summarize', { interview: iv.id }, O);
    return { record: iv.id };
  });
  await firesOnce('Ask your AI agent to check a week of timesheets', 'timesheet_review', 'review_id', async () => {
    const r = await api.op('timesheets.review-ask', { entity: 'Northwind Pte Ltd' }, HR);
    return { record: r.review.id };
  });
  const today = new Date().toISOString().slice(0, 10);
  const add = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
  const phases = [
    { key: 'self', start: today, end: add(today, 10) },
    { key: 'manager', start: today, end: add(today, 14) },
  ];
  const cyc = (await api.op('cycles.create', { kind: 'annual', name: 'Economy 2026', template: 'Annual review', participants: { departments: ['Engineering'] }, phases }, HR)).cycle;
  await api.op('cycles.launch', { cycle: cyc.id }, HR);
  const mgrReview = (await api.op('reviews.list', {}, ENG)).reviews.find((x) => x.kind === 'manager');
  await firesOnce('Ask for a summary, on a review', 'review_summary_draft', 'summary_id', async () => {
    const r = await api.op('reviews.request-summary', { review: mgrReview.id }, ENG);
    return { record: r.summary.id };
  });
  const lists = (await api.op('checklists.list', { status: 'open' }, HR)).checklists;
  const cl = lists[0];
  await firesOnce('Ask your AI agent, on a checklist', 'onboarding_help', 'checklist_id', async () => {
    const r = await api.call('checklists.ask-agent', { checklist: cl.id }, HR);
    if (r.status !== 200) await api.op('tasks.add', { checklist: cl.id, title: 'Draft the welcome note', assignee: 'agent' }, HR);
    return { record: cl.id };
  });

  section('asking again while the ask is open fires nothing');
  await firesNone('Review clicked again', async () => {
    const r = await api.op('payruns.review', { payrun: run.id }, PAY);
    eq(r.asked, false, 'the answer says it is already asked');
  });
  await firesNone('a second receipt on the same claim', async () => {
    const r = await upload(api, 'claim-lines.add', {}, { receipt: { data: PNG, type: 'image/png', name: 'lunch.png' } }, SAM);
    eq(r.body.claim.id, rc.out.record, 'it joins the same draft claim');
  });
  await firesNone('Ask for an update clicked again', () => api.op('packs.ask-update', { pack: packs[0].id }, PAY));
  await firesNone('Draft the post clicked again', () => api.op('openings.draft-post', { opening: opening.id }, O));
  await firesNone('Summarise clicked again', () => api.op('interviews.summarize', { interview: iv.id }, O));
  await firesNone('Ask your AI agent on the checklist again', () => api.call('checklists.ask-agent', { checklist: cl.id }, HR));
  await firesNone('Ask for a summary again', () => api.op('reviews.request-summary', { review: mgrReview.id }, ENG));

  section('the work arrives: the ask closes, and a new ask may fire again');
  await api.op('payruns.note', { payrun: run.id, kind: 'review', body: 'Checked the run; overtime as expected.' }, A);
  const closed = (await api.op('payruns.get', { payrun: run.id }, PAY)).payrun.agent;
  ok(closed.ended_at !== '' && closed.open === false && closed.outcome === 'done', 'your AI agent\'s review note closed the ask', closed);
  await api.op('questions.answer', { question: q.out.record, answer: 'Six people work in Japan.' }, A);
  eq((await api.op('questions.get', { question: q.out.record }, O)).question.status, 'answered', 'the answer reached the question');

  section('not picked up in 24 hours: unanswered, nothing asks again, Retry fires once');
  const pr = (await api.op('packs.get', { pack: packs[0].id }, PAY)).agent;
  await sim('age', { collection: 'rule_packs', id: packs[0].id, trigger: 'pack_update_draft', hours: 25 });
  const aged = (await api.op('packs.get', { pack: packs[0].id }, PAY)).agent;
  ok(aged.unanswered === true && aged.open === false, 'the pack shows the ask as unanswered', aged);
  await resetFires();
  const d2 = await hours(24);
  ok(d2.failed.length === 0, 'another simulated day ran', d2.failed);
  eq((await fires()).length, 0, 'a day later: still 0 fires (no re-ask)');
  await firesOnce('Retry', 'pack_update_draft', 'pack_id', async () => {
    await api.op('agent.retry', { trigger: 'pack_update_draft', record: packs[0].id, request: pr.request }, PAY);
    return { record: packs[0].id };
  });
  await firesNone('Retry of the same request again', async () => {
    const r = await api.call('agent.retry', { trigger: 'pack_update_draft', record: packs[0].id, request: pr.request }, PAY);
    eq([r.status, r.body.code], [409, 'already_asked'], 'refused: already asked again');
  });
  const refused = await api.call('agent.retry', { trigger: 'pack_update_draft', record: packs[0].id, request: 'x' }, A);
  eq(refused.status, 403, 'your AI agent may not ask itself again');

  section('an ask the cooldown held back is sent once, a minute later');
  await clearCooldowns();
  await resetFires();
  const r1 = await upload(api, 'claim-lines.add', {}, { receipt: { data: PNG, type: 'image/png', name: 'a.png' } }, HARUTO);
  const r2 = await upload(api, 'claim-lines.add', {}, { receipt: { data: PNG, type: 'image/png', name: 'b.png' } }, 'ananya@northwind.test');
  ok(r1.body.claim.agent.request !== '' && r2.body.claim.agent.waiting === true, 'the first fires, the second (another claim, within the cooldown) waits', [r1.body.claim.agent, r2.body.claim.agent]);
  eq((await fires()).length, 1, '1 fire now');
  await hours(1, Date.now() + 60000);
  const after = await fires();
  ok(after.length === 2 && after[1].trigger === 'receipt_review', 'the minute job sent the held ask once: 2 fires in all', after);
  await hours(2, Date.now() + 2 * 3600000);
  eq((await fires()).length, 2, 'and never again');

  section('Automatic work, each switch alone');
  // Monthly payroll rule checks: one pack a day at most.
  await clearCooldowns();
  await resetFires();
  const off1 = await hours(24, Date.now() + 2 * 86400000);
  eq([(await fires()).length, off1.failed.length], [0, 0], 'switch off: 0 rule checks in a day');
  await setAuto({ monthly_rule_checks: true });
  const on1 = await hours(24, Date.now() + 3 * 86400000);
  const rf = await fires();
  ok(rf.length === 1 && rf[0].trigger === 'rule_update_check' && on1.failed.length === 0, 'Monthly payroll rule checks on, one day: 1 fire of rule_update_check', { fires: rf, failed: on1.failed });
  await setAuto({});

  // Weekly timesheet check: last week of each entity with a missed punch, on its first workday at 07:00.
  const ents = (await api.op('entities.list', {}, O)).entities;
  const now = Date.now();
  const toMon = (8 - new Date(now).getUTCDay()) % 7 || 7;
  const monday = new Date(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate() + toMon)).getTime();
  const lastWed = new Date(monday - 5 * 86400000).toISOString().slice(0, 10);
  for (const en of ents.slice(0, 2)) await sim('missed', { entity: en.id, day: lastWed });
  await clearCooldowns();
  await resetFires();
  const off2 = await hours(36, monday - 12 * 3600000);
  eq([(await fires()).length, off2.failed.length], [0, 0], 'switch off: no weekly check');
  await setAuto({ weekly_timesheet_check: true });
  // The week before the simulated Monday (and Sunday, for an entity whose week starts on Sunday) has a missed punch.
  const thatWed = new Date(monday + 2 * 86400000).toISOString().slice(0, 10);
  for (const en of ents.slice(0, 2)) await sim('missed', { entity: en.id, day: thatWed });
  await clearCooldowns();
  await resetFires();
  const on2 = await hours(36, monday + 7 * 86400000 - 12 * 3600000);
  const wf = await fires();
  ok(on2.failed.length === 0 && wf.length >= 1 && wf.length <= 2 && wf.every((f) => f.trigger === 'timesheet_check'), `Weekly timesheet check on, its Monday: ${wf.length} fire(s) of timesheet_check (at most one per entity with a missed punch, 2)`, { fires: wf, failed: on2.failed });
  await setAuto({});

  // Start your AI agent's checklist tasks: a hire opens onboarding with a task for your AI agent.
  await clearCooldowns();
  await resetFires();
  await api.op('people.hire', { entity: 'Northwind Pte Ltd', legal_name: 'Off Switch', start_day: add(today, 20), title: 'Analyst' }, O);
  await hours(1, Date.now() + 60000);
  eq((await fires()).length, 0, 'switch off: a hire asks nothing');
  await setAuto({ checklist_tasks: true });
  await clearCooldowns();
  await resetFires();
  await api.op('people.hire', { entity: 'Northwind Pte Ltd', legal_name: 'On Switch', start_day: add(today, 21), title: 'Analyst' }, O);
  await hours(1, Date.now() + 120000);
  const cf = await fires();
  ok(cf.length === 1 && cf[0].trigger === 'onboarding_help', 'switch on: the hire\'s onboarding asks once (1 fire of onboarding_help)', cf);
  await hours(3, Date.now() + 2 * 3600000);
  eq((await fires()).length, 1, 'and never again');
  await setAuto({});

  section('people only, and the agent rules');
  eq((await api.call('questions.ask', { question: 'x' }, A)).status, 403, 'your AI agent does not ask itself questions');
  eq((await api.call('settings.automatic', { automatic: '{"monthly_rule_checks":true}' }, A)).status, 403, 'your AI agent does not switch Automatic work on');
} finally {
  if (existsSync(SIM)) rmSync(SIM);
  try {
    sh('stop.sh', [PORT]);
    sh('stop.sh', [BRIDGE]);
  } catch {
    /* already stopped */
  }
}
console.log(`\ne01_trigger_economy: ${passed} passed, ${failed} failed`);
for (const f of failures) console.log('  - ' + f);
process.exit(failed > 0 ? 1 : 0);
