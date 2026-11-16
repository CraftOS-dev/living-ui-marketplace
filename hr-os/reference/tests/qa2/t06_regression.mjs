// QA2 t06: final regression checks on the t02 state (seeded demo plus the QA
// countries, November runs locked and paid). Each section stands alone:
//  A. time adjustments: a punch and an approved attendance request on days a
//     locked run used are paid as adjustments in the next run, once;
//  B. held pay is left out of net to pay; payout.run reconciles (balanced) for
//     every locked or paid run; the bank file total is the amount to pay;
//  C. approvals and notifications carry structured facts;
//  D. inbox.route for your AI agent;
//  E. one question asks your AI agent once (no batches, no queue);
//  F. empty or impossible agent proposals are refused when they are made;
//  G. pin.verify answers 200 on a wrong PIN;
//  H. round 1 CLI frictions that the API can show.
//
//   QA_APP=<qa2/app2> QA_PORT=3192 node t06_regression.mjs [A B C ...]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { newApi, section, ok, eq, summary, writeResult, DEMO, O, AG, APP } from './lib.mjs';

const api = newApi();
const PAY = { as: 'payroll@northwind.test' };
const PAYPIN = { as: 'payroll@northwind.test', pin: true };
const HR = { as: 'hr@northwind.test' };
const MGR = 'eng.lead@northwind.test';
const only = process.argv.slice(2).filter((a) => /^[A-H]$/.test(a));
const want = (k) => only.length === 0 || only.includes(k);
const R = {};

async function guard(name, fn) {
  try {
    await fn();
  } catch (err) {
    ok(false, name + ' threw: ' + (err.status || '') + ' ' + (err.code || '') + ' ' + String(err.message).slice(0, 400));
  }
}
async function decideAny(id, decision, order) {
  let last = null;
  for (const as of order || [MGR, 'payroll@northwind.test', 'owner', 'hr@northwind.test']) {
    const r = await api.call('approvals.decide', { approval: id, decision, note: 'QA2' }, { as, pin: true });
    if (r.status < 400) return { as, body: r.body };
    last = { as, status: r.status, body: r.body };
  }
  throw new Error('nobody could decide ' + id + ': ' + JSON.stringify(last).slice(0, 300));
}
async function approveAll(id, order) {
  const who = [];
  for (let i = 0; i < 6; i++) {
    const a = (await api.op('approvals.get', { approval: id }, O)).approval;
    if (a.status !== 'pending') return { status: a.status, who };
    who.push((await decideAny(id, 'approved', order)).as);
  }
  return { status: 'pending', who };
}
async function calcRun(runId) {
  let r = await api.op('payruns.calculate', { payrun: runId }, PAY);
  for (let i = 0; i < 80 && !r.done; i++) r = await api.op('payruns.calculate', { payrun: runId, continue: true }, PAY);
  return r;
}
async function lockRun(runId) {
  const iss = (await api.op('payruns.issues', { payrun: runId }, PAY)).issues;
  const blockers = iss.filter((i) => i.severity === 'blocker');
  if (blockers.length > 0) return { ok: false, blockers };
  if (iss.length > 0) await api.op('payruns.acknowledge', { payrun: runId, reason: 'reviewed_ok', note: 'QA2 checked' }, PAY);
  const sub = await api.op('payruns.submit', { payrun: runId }, PAY);
  if (sub.approval) await approveAll(sub.approval.id, ['owner', 'hr@northwind.test']);
  const lock = await api.op('payruns.lock', { payrun: runId }, PAYPIN);
  return { ok: lock.payrun && lock.payrun.status === 'locked', warnings: iss.map((i) => i.code) };
}
const linesOf = (slip) => slip.groups.flatMap((g) => g.lines);
async function slipOf(runId, number) {
  const got = await api.op('payruns.get', { payrun: runId, limit: 500 }, PAY);
  const row = got.payslips.find((x) => x.number === number);
  if (!row) return null;
  return (await api.op('payslips.get', { payslip: row.id }, PAY)).payslip;
}
const dir = (await api.op('people.directory', { status: 'all', limit: 500 }, O)).people;
const person = (n) => dir.find((p) => p.number === n || p.name === n);
const ents = (await api.op('entities.list', {}, O)).entities;
const entOf = (name) => ents.find((e) => e.name === name);

/* ------------------------------------------------- A. time adjustments */
let decRun = null;
if (want('A') || want('B')) {
  section('A. Punches and an approved request on days a locked run used are paid once, as adjustments');
  await guard('A', async () => {
    const us = entOf('Northwind Inc');
    const runs = (await api.op('payruns.list', { entity: us.id, status: 'all', limit: 100 }, PAY)).payruns;
    const nov = runs.find((r) => r.kind === 'regular' && r.period_start === '2026-11-01' && (r.status === 'locked' || r.status === 'paid'));
    ok(nov !== undefined, 'the US November regular run is locked (' + (nov && nov.number + ' ' + nov.status) + ')');
    const grace = person('Grace Kim');
    const pay = await api.op('pay.history', { employment: grace.employment }, O);
    const rec = pay.records.find((x) => x.state === 'current');
    ok(rec && rec.basis === 'hourly', 'Grace Kim is paid by the hour (' + (rec && rec.amount_minor + ' ' + rec.per) + ')');
    const rate = rec.amount_minor;
    const days = {};
    for (const d of ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']) {
      const a = await api.call('attendance.get', { employment: grace.employment, day: d }, O);
      const at = a.body && (a.body.attendance || a.body.day || a.body);
      days[d] = { status: a.status, locked: at && at.locked, worked_min: at && at.worked_min, source: at && at.source, payrun: at && at.payrun };
    }
    R.adjust = { before: days };
    ok(days['2026-11-03'].locked === true, 'the November lock locked 3 Nov for Grace (' + JSON.stringify(days['2026-11-03']) + ')');
    // A sign-in for Grace.
    let GR = { as: 'grace@northwind.test' };
    let signed = false;
    try {
      signed = (await api.call('auth.me', {}, GR)).status === 200;
    } catch {
      signed = false;
    }
    if (!signed) {
      const inv = await api.op('members.invite', { email: 'grace@northwind.test', name: 'Grace Kim', role: 'employee', employee: grace.employee }, { as: 'owner', pin: true });
      const joined = await api.op('auth.accept-invite', { email: 'grace@northwind.test', code: inv.code, password: DEMO.password });
      api.setToken('grace@northwind.test', joined.token);
    }
    // 1. Punches today (a day the November lock used, if today is locked) and 2. a missed punch request for 3 Nov.
    const pin = await api.call('clock.punch', { kind: 'in' }, GR);
    const pout = await api.call('clock.punch', { kind: 'out' }, GR);
    ok(pin.status === 200 && pout.status === 200, 'punches on a locked day are taken, never refused (' + pin.status + ', ' + pout.status + ')', [pin.body, pout.body]);
    const req = await api.call('attendance-requests.add', { kind: 'missed_punch', from_day: '2026-11-03', in_time: '08:00', out_time: '19:30', break_min: 30, reason: 'QA2: forgot to clock' }, GR);
    ok(req.status === 200, 'Grace asks to fix 3 Nov (a locked day): ' + req.status + ' ' + ((req.body && req.body.code) || ''), req.body);
    const rq = req.body.request || req.body;
    const apId = rq.approval || (req.body.approval && req.body.approval.id);
    if (apId) {
      const ap = await approveAll(apId, [MGR, 'hr@northwind.test', 'owner']);
      ok(ap.status === 'approved', 'the request on the locked day is approved (' + ap.who.join(', ') + ')', ap);
    }
    const a3 = (await api.call('attendance.get', { employment: grace.employment, day: '2026-11-03' }, O)).body;
    const at3 = a3.attendance || a3.day || a3;
    R.adjust.after3 = { locked: at3.locked, worked_min: at3.worked_min, adjusted_after_lock: at3.adjusted_after_lock, after_lock: at3.after_lock };
    ok(at3.locked === true && at3.adjusted_after_lock === true, '3 Nov stays locked and is marked adjusted after lock', R.adjust.after3);
    // Pay inputs of December list the differences.
    const tp = await api.op('time.pay-inputs', { employment: grace.employment, from: '2026-12-01', to: '2026-12-31' }, O);
    const adj = tp.adjustments || [];
    R.adjust.inputs = adj;
    ok(adj.some((x) => x.day === '2026-11-03'), 'December pay inputs list 3 Nov as an adjustment (' + adj.map((x) => x.day + ' ' + x.component + ' ' + x.minutes).join(', ') + ')', tp);
    ok((tp.issues || []).some((x) => x.code === 'adjustments_after_lock'), 'with the adjustments_after_lock issue');
    // The December run pays them.
    const home = await api.op('payroll.home', { entity: us.id }, PAY);
    const sch = home.schedules.find((s) => s.entity === us.id);
    decRun = (await api.op('payruns.create', { schedule: sch.schedule }, PAY)).payrun;
    ok(decRun.period_start === '2026-12-01', 'the next US regular run is December (' + decRun.number + ' ' + decRun.period_start + '..' + decRun.period_end + ')');
    await calcRun(decRun.id);
    const slip = await slipOf(decRun.id, grace.number);
    const al = linesOf(slip).filter((l) => (l.explain && l.explain.source === 'time_adjustment') || l.source === 'time_adjustment');
    R.adjust.lines = al.map((l) => ({ code: l.code, name: l.name, qty: l.qty, rate: l.rate, amount_minor: l.amount_minor, explain: l.explain }));
    const payable = adj.filter((x) => x.component !== 'late' && x.component !== 'absent' && x.minutes !== 0);
    eq(al.length, payable.length, 'December pays each difference as its own line (' + al.map((l) => l.name + ' ' + l.amount_minor).join('; ') + ')');
    const reg = adj.filter((x) => x.component === 'regular').reduce((s, x) => s + x.minutes, 0);
    const regLine = al.filter((l) => l.explain && l.explain.component === 'regular').reduce((s, l) => s + l.amount_minor, 0);
    eq(regLine, Math.round((reg / 60) * rate), 'regular adjustment minutes ' + reg + ' at ' + rate / 100 + ' an hour');
    for (const x of payable.filter((y) => y.component !== 'regular')) {
      const l = al.find((y) => y.explain && y.explain.day === x.day && y.explain.component === x.component);
      ok(l && Math.abs(l.amount_minor - Math.round((x.minutes / 60) * rate * x.multiplier)) <= 1, 'premium adjustment ' + x.day + ' ' + x.component + ' ' + x.minutes + ' min x ' + x.multiplier + ' = ' + (l && l.amount_minor));
    }
    // Recalculating does not double them.
    await calcRun(decRun.id);
    const slip2 = await slipOf(decRun.id, grace.number);
    const al2 = linesOf(slip2).filter((l) => (l.explain && l.explain.source === 'time_adjustment') || l.source === 'time_adjustment');
    eq(al2.reduce((s, l) => s + l.amount_minor, 0), al.reduce((s, l) => s + l.amount_minor, 0), 'recalculating December keeps the adjustments once');
    // The leaver E0011 (final pay locked to 15 Dec) is not paid again in the December regular run.
    const leaver = await slipOf(decRun.id, 'E0011');
    ok(leaver === null || leaver.gross_minor === 0, 'the leaver E0011 (final pay run locked) is not paid again in the December regular run (' + (leaver ? leaver.gross_minor : 'no payslip') + ')');
    R.adjust.leaver_slip = leaver && { gross: leaver.gross_minor, net: leaver.net_minor, lines: linesOf(leaver).map((l) => l.code + '=' + l.amount_minor) };
  });
}

/* ------------------------------------------- B. held pay and reconciliation */
if (want('B')) {
  section('B. Held pay is left out of net to pay; every locked run reconciles');
  await guard('B', async () => {
    if (decRun) {
      const taylor = person('E0026');
      const h = await api.call('holds.hold', { payrun: decRun.id, employment: taylor.employment, reason: 'QA2: missing documents' }, PAY);
      ok(h.status === 200, 'payroll holds Taylor Brooks\' December pay (' + h.status + ' ' + ((h.body && h.body.code) || '') + ')', h.body);
      await calcRun(decRun.id);
      const lk = await lockRun(decRun.id);
      ok(lk.ok, 'the December US run locks (' + JSON.stringify(lk.blockers ? lk.blockers.map((b) => b.code + ' ' + (b.employee_name || '') + ': ' + b.message).slice(0, 5) : lk.warnings) + ')');
      R.held = { lock: lk };
      if (lk.ok) {
        const ts = await slipOf(decRun.id, 'E0026');
        const pr = (await api.op('payruns.get', { payrun: decRun.id }, PAY)).payrun;
        const po = await api.op('payout.run', { payrun: decRun.id, format: 'nacha_ppd' }, PAY);
        const t = po.totals;
        R.held.totals = t;
        eq(t.held_minor, ts.net_minor, 'held pay = Taylor\'s net ' + ts.net_minor);
        eq(t.to_pay_minor, pr.net_minor - ts.net_minor, 'net to pay = run net less held pay');
        ok(t.balanced === true, 'payout.run balanced (to pay ' + t.to_pay_minor + ' = bank ' + t.bank_minor + ' + cash ' + t.cash_minor + ' + cheque ' + t.cheque_minor + ')', t);
        ok(!(po.payments || po.bank || []).some((p) => p.number === 'E0026' || p.employee_number === 'E0026'), 'the held person has no bank payment');
        const ex = await api.call('bankfiles.export', { payrun: decRun.id, format: 'nacha_ppd' }, PAYPIN);
        ok(ex.status === 200, 'the bank file is written (' + ex.status + ' ' + ((ex.body && ex.body.code) || '') + ')', ex.body);
        if (ex.status === 200) eq(ex.body.bank_file.total_minor, t.to_pay_minor, 'bank file total = net to pay (held pay left out)');
        const ov = await api.op('payout.overview', { entity: entOf('Northwind Inc').id }, PAY);
        R.held.overview = (ov.runs || ov.payruns || []).map((r) => ({ number: r.number, totals: r.totals }));
        // Pay inputs of January no longer list the November adjustments: they were paid once.
        const grace = person('Grace Kim');
        const jan = await api.op('time.pay-inputs', { employment: grace.employment, from: '2027-01-01', to: '2027-01-31' }, O);
        ok(!(jan.adjustments || []).some((x) => x.day === '2026-11-03'), 'after the December lock, January pay inputs no longer list 3 Nov (paid once)', jan.adjustments);
        R.adjust = Object.assign(R.adjust || {}, { january: jan.adjustments });
      }
    }
    // Every locked or paid run: payout.run reconciles.
    const all = (await api.op('payruns.list', { status: 'all', limit: 200 }, PAY)).payruns;
    const done = all.filter((r) => r.status === 'locked' || r.status === 'paid');
    const rows = [];
    for (const r of done) {
      const po = await api.call('payout.run', { payrun: r.id }, PAY);
      const t = po.body && po.body.totals;
      rows.push({ number: r.number, kind: r.kind, status: r.status, currency: r.currency, net: r.net_minor, http: po.status, held: t && t.held_minor, to_pay: t && t.to_pay_minor, bank: t && t.bank_minor, cash: t && t.cash_minor, cheque: t && t.cheque_minor, balanced: t && t.balanced });
    }
    R.reconcile = rows;
    const bad = rows.filter((x) => x.balanced !== true);
    ok(bad.length === 0, 'every locked or paid run reconciles (' + rows.length + ' runs, ' + bad.length + ' not balanced)', bad);
    console.log('  runs: ' + rows.map((x) => x.number + ' ' + x.kind + ' ' + x.status + ' ' + x.balanced).join('; '));
  });
}

/* --------------------------------------------------------------- C. facts */
if (want('C')) {
  section('C. Approvals and notifications carry structured facts');
  await guard('C', async () => {
    const ap = await api.op('approvals.list', { view: 'all', status: 'any', limit: 200 }, O);
    const kinds = {};
    const bad = [];
    for (const a of ap.approvals) {
      const f = a.facts;
      const k = (kinds[a.kind] = kinds[a.kind] || { n: 0, with: 0 });
      k.n++;
      if (Array.isArray(f) && f.length > 0) k.with++;
      for (const x of Array.isArray(f) ? f : []) if (typeof x !== 'object' || typeof x.label !== 'string' || (x.value === undefined && x.from === undefined && x.amount_minor === undefined && x.minor === undefined)) bad.push({ kind: a.kind, fact: x });
    }
    R.facts = { approvals: kinds };
    const without = Object.entries(kinds).filter(([, v]) => v.with < v.n);
    ok(ap.approvals.length > 0 && without.length === 0, 'every approval has facts (' + ap.approvals.length + ' approvals, kinds ' + Object.entries(kinds).map(([k, v]) => k + ' ' + v.with + '/' + v.n).join(', ') + ')', without);
    ok(bad.length === 0, 'every approval fact has a label and a value (' + bad.length + ' not)', bad.slice(0, 5));
    const sample = ap.approvals.find((a) => a.kind === 'payrun') || ap.approvals[0];
    console.log('  sample facts (' + sample.kind + '): ' + JSON.stringify(sample.facts).slice(0, 400));
    const nk = {};
    const nbad = [];
    for (const who of ['owner', 'hr@northwind.test', 'payroll@northwind.test', MGR, 'sam@northwind.test']) {
      const n = await api.op('notifications.list', { limit: 100 }, { as: who });
      for (const x of n.notifications || n.items || []) {
        const k = (nk[x.kind] = nk[x.kind] || { n: 0, with: 0 });
        k.n++;
        if (Array.isArray(x.facts) && x.facts.length > 0) k.with++;
        else nbad.push({ who, kind: x.kind, title: x.title });
      }
    }
    R.facts.notifications = nk;
    R.facts.notifications_without = nbad.slice(0, 40);
    ok(Object.keys(nk).length > 0, 'notifications exist (' + Object.entries(nk).map(([k, v]) => k + ' ' + v.with + '/' + v.n).join(', ') + ')');
    ok(nbad.length === 0, 'every notification has facts (' + nbad.length + ' without)', nbad.slice(0, 8));
  });
}

/* ------------------------------------------------------------ D. inbox.route */
if (want('D')) {
  section('D. inbox.route: your AI agent hands a refused request to a person');
  await guard('D', async () => {
    const bank = await api.call('bank.add', { employee: 'E0015', number: '1234567' }, AG);
    eq(bank.status, 403, 'bank.add is refused for your AI agent');
    const before = (await api.op('notifications.list', { limit: 100 }, PAY)).unread;
    const r = await api.call('inbox.route', { request: 'Kenji asked in chat to change his bank account to 1234567 (ends 4567).', op: 'bank.add', employee: 'E0015', link: '#/people/E0015?tab=bank' }, AG);
    ok(r.status === 200, 'inbox.route answers 200 for your AI agent', r.body);
    R.route = r.body;
    const n = await api.op('notifications.list', { limit: 100 }, PAY);
    const got = (n.notifications || []).find((x) => JSON.stringify(x).includes('1234567') || JSON.stringify(x).includes('bank'));
    ok(got !== undefined, 'the payroll administrator gets it in the Inbox (' + (got && got.title) + ', unread ' + before + ' -> ' + n.unread + ')', (n.notifications || []).slice(0, 3));
    if (got) ok(Array.isArray(got.facts) && got.facts.length > 0, 'with facts (' + JSON.stringify(got.facts).slice(0, 200) + ')');
    const r2 = await api.call('inbox.route', { request: 'Please approve the November pay run for Northwind Inc.', role: 'owner' }, AG);
    ok(r2.status === 200, 'inbox.route to a role (owner) answers 200', r2.body);
    const r3 = await api.call('inbox.route', { request: '' }, AG);
    ok(r3.status === 400, 'an empty request is refused (' + r3.status + ' ' + (r3.body && r3.body.code) + ')');
    const r4 = await api.call('inbox.route', { request: 'x', role: 'nobody' }, AG);
    ok(r4.status >= 400 && r4.status < 500, 'an unknown role is refused (' + r4.status + ' ' + (r4.body && r4.body.code) + ')');
    const r5 = await api.call('inbox.route', { request: 'Spam' }, { as: 'sam@northwind.test' });
    R.route_employee = { status: r5.status, code: r5.body && r5.body.code };
  });
}

/* ------------------------------------------------------- E. questions */
if (want('E')) {
  section('E. one question asks your AI agent once; there is no queue to take from');
  await guard('E', async () => {
    const SAM = { as: 'sam@northwind.test' };
    const q = (await api.op('questions.ask', { question: 'QA2 question: how many leave days do I have?' }, SAM)).question;
    ok(q.ask && q.ask.trigger === 'question_asked' && q.ask.record === q.id, 'the question carries its own ask (question_asked with its id)', q.ask);
    const list = await api.op('questions.list', { status: 'asked' }, AG);
    R.questions = { waiting: list.questions.length, size: JSON.stringify(list).length };
    ok(list.questions.some((x) => x.id === q.id), 'your AI agent finds it with questions.list');
    const gone = await fetch(api.base + '/api/ops/jobs/next', { method: 'POST' });
    ok(gone.status === 404, 'jobs.next no longer exists (' + gone.status + ')');
    const cancel = await api.call('questions.cancel', { question: q.id }, SAM);
    ok(cancel.status === 200 && cancel.body.question.status === 'cancelled', 'the person who asked cancels it');
  });
}

/* --------------------------------------------- F. proposals refused when made */
if (want('F')) {
  section('F. Empty or impossible agent proposals are refused when they are made');
  await guard('F', async () => {
    const cases = [
      ['recurring.save', {}, 400],
      ['people.import', {}, 400],
      ['openings.add', {}, 400],
      ['pay.update', { employment: 'E0005' }, 400],
      ['leave.adjust', { employment: 'E9999', type: 'annual', amount: 2, reason: 'QA2' }, 404],
      ['people.hire', { entity: 'Northwind KK', legal_name: 'Validation Probe', job_title: 'Software Engineer', location: 'Atlantis', start_day: '2026-12-01', pay_amount: '6000000', pay_per: 'year' }, 404],
      ['people.hire', { entity: 'Northwind KK', legal_name: 'Validation Probe', job_title: 'Software Engineer', location: 'Tokyo', start_day: '2026-12-01', pay_amount: '6000000', pay_per: 'year' }, 404],
      ['people.hire', { entity: 'Nowhere Corp', legal_name: 'Validation Probe', start_day: '2026-12-01', pay_amount: '100', pay_per: 'year' }, 404],
      ['proposals.create', { items: [] }, 400],
      ['departments.add', {}, 400],
      ['leave.request', { employment: 'E0005', type: 'nosuchtype', start: '2026-12-21' }, 404],
    ];
    const rows = [];
    for (const [name, p, st] of cases) {
      const r = await api.call(name, Object.assign({ why: 'QA2 probe' }, p), AG);
      rows.push({ op: name, params: p, status: r.status, code: r.body && r.body.code, message: r.body && String(r.body.message || '').slice(0, 200), data: r.body && r.body.data, proposed: r.body && r.body.proposed });
      ok(r.status === st || (r.status >= 400 && r.status < 500 && !(r.body && r.body.proposed)), name + ' ' + JSON.stringify(p).slice(0, 80) + ' refused at creation: ' + r.status + ' ' + (r.body && r.body.code) + ' (' + String((r.body && r.body.message) || '').slice(0, 140) + ')');
    }
    R.proposals = rows;
    const good = await api.call('people.hire', { entity: 'Northwind KK', legal_name: 'Valid Probe', job_title: 'Software Engineer', location: 'Tokyo Office', start_day: '2026-12-01', pay_amount: '6000000', pay_per: 'year', why: 'QA2' }, AG);
    ok(good.status === 200 && good.body.proposed === true, 'a valid hire becomes a proposal (' + good.status + ', label "' + (good.body && good.body.label) + '")');
    R.proposal_good = good.body && { label: good.body.label, preview: good.body.preview };
    if (good.body && good.body.proposal) await api.call('proposals.withdraw', { proposal: good.body.proposal }, AG);
    const op = await api.call('openings.add', { entity: 'Northwind India Pvt Ltd', title: 'Payroll Specialist', location_text: 'Bengaluru', country: 'IN', region: 'KA', description: '# Payroll Specialist', why: 'QA2' }, AG);
    R.opening = op.body && { status: op.status, label: op.body.label };
    ok(op.status === 200 && op.body.label && !/^Draft a job opening from an approved requisition/.test(op.body.label), 'an opening proposal is labelled by what it makes ("' + (op.body && op.body.label) + '")');
    if (op.body && op.body.proposal) await api.call('proposals.withdraw', { proposal: op.body.proposal }, AG);
    const ol = await api.op('openings.list', {}, AG);
    R.opening.list_can = { can_add: ol.can_add, can: ol.can };
    ok(ol.can_add !== false || (ol.can && ol.can.add !== false), 'openings.list tells your AI agent it can add (as a proposal): ' + JSON.stringify({ can_add: ol.can_add, can: ol.can }));
  });
}

/* ------------------------------------------------------------- G. pin.verify */
if (want('G')) {
  section('G. pin.verify');
  await guard('G', async () => {
    const w = await api.call('pin.verify', { pin: '000000' }, { as: 'hr@northwind.test' });
    ok(w.status === 200 && w.body.ok === false && w.body.code === 'wrong_pin', 'a wrong PIN answers 200 { ok: false, code: wrong_pin } (' + w.status + ' ' + JSON.stringify(w.body).slice(0, 160) + ')');
    const g = await api.call('pin.verify', { pin: DEMO.pin }, { as: 'hr@northwind.test' });
    ok(g.status === 200 && g.body.ok === true, 'the right PIN answers { ok: true } (' + JSON.stringify(g.body).slice(0, 100) + ')');
    const e = await api.call('pin.verify', {}, { as: 'hr@northwind.test' });
    R.pin = { wrong: w.body, right: g.body, empty: { status: e.status, body: e.body } };
    const a = await api.call('pin.verify', { pin: DEMO.pin }, AG);
    eq(a.status, 403, 'your AI agent cannot verify a PIN');
  });
}

/* -------------------------------------------------- H. round 1 CLI frictions */
if (want('H')) {
  section('H. Round 1 CLI frictions the API shows');
  await guard('H', async () => {
    const opsJson = JSON.parse(readFileSync(join(APP, 'operations.json'), 'utf8'));
    const list = opsJson.operations || opsJson;
    const peopleOnly = list.filter((o) => /\[People only/.test(o.description || ''));
    const withReq = peopleOnly.filter((o) => Object.values(o.params || {}).some((d) => d.required) || (o.params || {}).pin);
    ok(withReq.length === 0, 'F1: people-only ops list no required params or pin in operations.json, so the CLI shows the 403 first (' + peopleOnly.length + ' ops, ' + withReq.length + ' with)', withReq.slice(0, 5).map((o) => o.name));
    const lock = await api.call('payruns.lock', {}, AG);
    ok(lock.status === 403 && lock.body.code === 'agent_not_permitted', 'F1: payruns.lock with no params answers 403 agent_not_permitted for your AI agent', lock.body);
    R.cli = { lock_message: lock.body.message };
    const descChars = list.reduce((s, o) => s + (o.description || '').length, 0);
    const over200 = list.filter((o) => (o.description || '').length > 200).length;
    R.cli.ops = { count: list.length, description_chars: descChars, over_200: over200, json_chars: JSON.stringify(list).length };
    const gd = await api.call('app.guide', {}, AG);
    const gdm = await api.call('app.guide', { module: 'leave' }, AG);
    const gdr = await api.call('app.guide', { recipe: 'draft_job_post' }, AG);
    R.cli.guide = { all: JSON.stringify(gd.body).length, leave: JSON.stringify(gdm.body).length, recipe: JSON.stringify(gdr.body).length, recipe_mentions_openings_add: JSON.stringify(gdr.body).includes('openings.add') };
    ok(R.cli.guide.all < 20000, 'F2: app.guide is ' + R.cli.guide.all + ' chars (was 92K), --module leave ' + R.cli.guide.leave + ', --recipe ' + R.cli.guide.recipe);
    ok(R.cli.guide.recipe_mentions_openings_add, 'F9: the draft_job_post recipe covers a post with no opening (openings.add)');
    // F3 units text in answers.
    let units = 0;
    let n = 0;
    for (const [name, p] of [['people.directory', { limit: 5 }], ['leave.balance', { employment: 'E0002', type: 'annual' }], ['payruns.list', {}], ['payslips.recent', { employment: 'E0005' }], ['filings.list', {}]]) {
      const r = await api.call(name, p, AG);
      n++;
      if (r.body && typeof r.body === 'object' && r.body.units !== undefined) units++;
    }
    ok(units === 0, 'F3: no units text repeated in answers (' + units + ' of ' + n + ')');
    // F5 a rule pack ask answers briefly.
    const cu = await api.call('packs.check-updates', { pack: 'us-federal' }, AG);
    R.cli.check_updates = { status: cu.status, chars: JSON.stringify(cu.body).length };
    ok(cu.status === 200 && R.cli.check_updates.chars < 2000, 'F5: packs.check-updates --pack us-federal answers ' + R.cli.check_updates.chars + ' chars (the ask, not the pack)');
    // F7 filings.
    const f30 = await api.call('filings.list', { show: 'due', days: 30 }, AG);
    R.cli.filings30 = { status: f30.status, n: f30.body && (f30.body.filings || []).length, kinds: f30.body && (f30.body.filings || []).map((f) => f.kind + ' ' + f.period + ' due ' + f.due_day) };
    ok(f30.status === 200, 'F7: filings.list --days 30 works (' + R.cli.filings30.n + ' due)');
    // F8 expiring.
    const pr = await api.call('leave.balance', { employment: 'E0002', type: 'annual', project_to: '2027-01-01' }, AG);
    R.cli.expiring = { expiring: pr.body.expiring, projection: pr.body.projection, available: pr.body.available, lots: pr.body.lots && pr.body.lots.slice(0, 4) };
    const lapse = (pr.body.expiring || []).reduce((s, x) => s + Number(x.amount || 0), 0);
    ok(lapse === pr.body.available - Math.max(0, (pr.body.projection && pr.body.projection.available) - 11) || lapse >= 10, 'F8: expiring says ' + lapse + ' lapse at the year close for Priya (available ' + pr.body.available + ', 2027 opens at ' + (pr.body.projection && pr.body.projection.available) + ')', pr.body.expiring);
    // F10 names for --employment.
    const nm = await api.call('leave.balance', { employment: 'Priya Raman', type: 'annual' }, AG);
    ok(nm.status === 200, 'F10: --employment takes a name ("Priya Raman": ' + nm.status + ')', nm.body && nm.body.message);
    // F12 run-level warnings once.
    const runs = (await api.op('payruns.list', { status: 'all', limit: 200 }, PAY)).payruns;
    const pr1 = runs.find((r) => r.number === 'PR-0001');
    const is1 = await api.op('payruns.issues', { payrun: pr1.id }, PAY);
    const po = is1.issues.filter((i) => i.code === 'period_open');
    R.cli.issues = { total: is1.issues.length, period_open: po.length, chars: JSON.stringify(is1).length, codes: is1.issues.map((i) => i.code) };
    ok(po.length <= 1, 'F12: a run-level warning (period_open) is one row, not one per person (' + po.length + ' rows in PR-0001)');
    // F13 India packs.
    const pk = await api.op('packs.list', { country: 'IN' }, AG);
    R.cli.in_packs = (pk.packs || []).map((p) => p.code + ' ' + p.version + ' ' + p.status + ' in_use=' + p.in_use);
    const my = await api.op('packs.list', { country: 'MY' }, AG);
    R.cli.my_packs = (my.packs || []).map((p) => p.code + ' ' + p.version + ' ' + p.status + ' in_use=' + p.in_use);
    // F14 app.status.
    const st = await api.op('app.status', {}, AG);
    R.cli.status_keys = Object.keys(st);
    R.cli.status_jobs = Object.fromEntries(Object.entries(st).filter(([k]) => /job/.test(k)));
    // F15 leave.home week and location.
    const lh = await api.call('leave.home', { location: 'Singapore HQ' }, AG);
    R.cli.leave_home = { status: lh.status, week: lh.body && { week_start: lh.body.week_start, week_end: lh.body.week_end }, code: lh.body && lh.body.code };
    // F16 SG self-help group.
    const sgRun = runs.find((r) => r.number === 'PR-0001');
    const slips = (await api.op('payruns.get', { payrun: sgRun.id, limit: 50 }, PAY)).payslips;
    const lim = slips.find((s) => s.number === 'E0008');
    const ls = (await api.op('payslips.get', { payslip: lim.id }, PAY)).payslip;
    R.cli.sg_shg = { lines: linesOf(ls).map((l) => l.code), notes: (ls.notes || ls.explain || ls.issues || []).toString().slice(0, 300), issues: (ls.issues || []).map((i) => i.code) };
    // F17 letters: signer param and Indian grouping.
    const lt = list.find((o) => o.name === 'letters.draft');
    R.cli.letters_params = Object.keys(lt.params || {});
    const tpl = await api.call('letter-templates.list', {}, O);
    const sal = tpl.body && (tpl.body.templates || []).find((t) => /salary/i.test(t.name || t.title || ''));
    if (sal) {
      const d = await api.call('letters.draft', { template: sal.id, employee: 'E0020', why: 'QA2' }, O);
      const text = JSON.stringify(d.body);
      R.cli.letter = { status: d.status, indian_grouping: /4,50,000/.test(text), western_grouping: /450,000/.test(text), signer_placeholder: /\[Signed by\]|\[Title of the signer\]/.test(text), sample: text.slice(0, 300) };
    }
    // Minor: payruns.list --status all.
    const la = await api.call('payruns.list', { status: 'all' }, PAY);
    ok(la.status === 200 && (la.body.payruns || []).length > 0, 'payruns.list --status all returns runs (' + ((la.body.payruns || []).length) + ')');
    // Minor: documents.delete is deny for your AI agent.
    const dd = list.find((o) => o.name === 'documents.delete');
    ok(/People only/.test(dd.description || ''), 'documents.delete is people only');
  });
}

writeResult('t06_results.json', R);
const s = summary('t06_regression');
process.exitCode = s.failed > 0 ? 1 : 0;
