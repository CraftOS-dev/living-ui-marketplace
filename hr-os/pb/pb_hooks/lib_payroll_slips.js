/// <reference path="../pb_data/types.d.ts" />
/**
 * Payslips (payroll-core): the payslip view (earnings, deductions, employer
 * costs, net, year to date, every line with its explanation: the rule, the
 * inputs and the values), the employee's own payslips, a line's full
 * explanation, and the first view mark.
 *
 * Who sees a payslip: payroll (view and up, in scope) at any status; the
 * person and, when the company allows it, their managers once it is
 * published; your AI agent when the owner lets it see pay.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}

const GROUPS = [
  { key: 'earnings', label: 'Earnings', test: (l) => l.kind === 'earning' },
  { key: 'pre', label: 'Deductions before tax', test: (l) => l.kind === 'deduction' && l.stage === 'pre' },
  { key: 'statutory', label: 'Tax and statutory deductions', test: (l) => l.kind === 'deduction' && l.stage === 'statutory' },
  { key: 'post', label: 'Other deductions', test: (l) => l.kind === 'deduction' && l.stage !== 'pre' && l.stage !== 'statutory' },
  { key: 'reimbursements', label: 'Reimbursements', test: (l) => l.kind === 'reimbursement' },
  { key: 'employer', label: 'Employer costs', test: (l) => l.kind === 'employer' },
  { key: 'info', label: 'For your information', test: (l) => l.kind === 'info' },
];

/** 'payroll' | 'self' | 'team' | 'agent' | 'none' for this payslip. */
function access(ctx, slip) {
  const auth = L('lib_auth');
  const app = ctx.app;
  if (ctx.isAgent) return L('lib_settings').row(app).getBool('agent_sees_pay') ? 'agent' : 'none';
  if (auth.can(ctx, 'payroll', 'view') && auth.inScope(ctx, slip.getString('entity'))) return 'payroll';
  const published = slip.getString('status') === 'published';
  if (!published) return 'none';
  if (auth.selfEmployee(ctx) === slip.getString('employee')) return 'self';
  const m = app.findRecordById('employments', slip.getString('employment'));
  if (L('lib_settings').row(app).getBool('managers_see_pay') && auth.isManagerOf(ctx, m.id, u().today(app, m.getString('entity')))) return 'team';
  return 'none';
}

function slipRef(ctx, ref) {
  const util = u();
  const s = util.byId(ctx.app, 'payslips', String(ref || ''));
  if (s === null) throw util.fail(404, 'No payslip ' + ref + '.', 'not_found');
  const a = access(ctx, s);
  if (a === 'none') throw util.fail(403, 'You cannot see this payslip.', 'not_permitted');
  return { rec: s, access: a };
}

function lineView(r) {
  const util = u();
  return {
    id: r.id,
    code: r.getString('code'),
    name: r.getString('name'),
    kind: r.getString('kind'),
    stage: r.getString('stage'),
    amount_minor: r.getInt('amount_minor'),
    qty: r.getFloat('qty'),
    rate: r.getFloat('rate'),
    base_minor: r.getInt('base_minor'),
    pack: r.getString('pack'),
    pack_version: r.getString('pack_version'),
    step: r.getInt('step'),
    phase: r.getString('phase'),
    source: r.getString('source'),
    tags: util.jsonOf(r, 'tags', []) || [],
    ref_kind: r.getString('ref_kind'),
    payee: r.getString('payee'),
    group: r.getString('payslip_group'),
    explain: util.jsonOf(r, 'explain', {}) || {},
    sort: r.getInt('sort'),
  };
}

function view(app, s, acc) {
  const util = u();
  const people = L('lib_people');
  const run = app.findRecordById('payruns', s.getString('payrun'));
  const ent = app.findRecordById('entities', s.getString('entity'));
  const emp = app.findRecordById('employees', s.getString('employee'));
  const m = app.findRecordById('employments', s.getString('employment'));
  const job = people.rowOn(app, 'job_records', m.id, s.getString('period_end'));
  const st = L('lib_payroll').settingsView(app, L('lib_payroll').ensureSettings(app, ent), ent);
  const lines = util.findMany(app, 'payslip_lines', 'payslip = {:p}', 'sort,created', 0, { p: s.id }).map(lineView);
  const groups = GROUPS.map((g) => ({ key: g.key, label: g.label, lines: lines.filter(g.test), total_minor: lines.filter(g.test).reduce((a, l) => a + l.amount_minor, 0) })).filter((g) => g.lines.length > 0);
  const split = (util.jsonOf(s, 'bank_split', []) || []).map((b) => ({ label: b.label, bank_name: b.bank_name, number_masked: b.number_masked, split: b.split }));
  const out = {
    id: s.id,
    payrun: run.id,
    payrun_number: run.getString('number'),
    payrun_status: run.getString('status'),
    kind: s.getString('kind'),
    status: s.getString('status'),
    entity: ent.id,
    entity_name: ent.getString('name'),
    entity_legal_name: ent.getString('legal_name') || ent.getString('name'),
    entity_address: util.jsonOf(ent, 'address', {}) || {},
    entity_tax_ids: util.jsonOf(ent, 'tax_ids', {}) || {},
    country: ent.getString('country'),
    employee: emp.id,
    employee_number: emp.getString('number'),
    employee_name: people.displayName(emp),
    legal_name: emp.getString('legal_name'),
    employment: m.id,
    title: job ? job.getString('title') : '',
    department: job && job.getString('department') !== '' ? (util.byId(app, 'departments', job.getString('department')) || { getString: () => '' }).getString('name') : '',
    period_start: s.getString('period_start'),
    period_end: s.getString('period_end'),
    pay_date: s.getString('pay_date'),
    currency: s.getString('currency'),
    gross_minor: s.getInt('gross_minor'),
    pre_minor: s.getInt('pre_minor'),
    statutory_minor: s.getInt('statutory_minor'),
    post_minor: s.getInt('post_minor'),
    deductions_minor: s.getInt('deductions_minor'),
    employer_minor: s.getInt('employer_minor'),
    reimbursement_minor: s.getInt('reimbursement_minor'),
    net_minor: s.getInt('net_minor'),
    held: s.getBool('held'),
    pay_method: s.getString('pay_method'),
    bank_split: split,
    groups: groups,
    ytd: st.payslip_show_ytd ? util.jsonOf(s, 'ytd', null) : null,
    packs: util.jsonOf(s, 'packs', []) || [],
    published_at: s.getString('published_at'),
    viewed_at: s.getString('viewed_at'),
    hash: s.getString('hash'),
    corrects: run.getString('corrects'),
    access: acc,
  };
  if (acc === 'payroll' || acc === 'agent') {
    out.issues = util.jsonOf(s, 'issues', []) || [];
    out.variance = util.jsonOf(s, 'variance', {}) || {};
    out.proration = util.jsonOf(s, 'proration', {}) || {};
    const ex = util.jsonOf(s, 'explain', {}) || {};
    out.explain_packs = ex.packs || [];
    out.agent = L('lib_agent').view(s, 'variance_explain');
  }
  return out;
}

function get(ctx, p) {
  const x = slipRef(ctx, u().req(p, 'payslip'));
  return { payslip: view(ctx.app, x.rec, x.access) };
}

/** payslips.mine: your own published payslips, latest first. */
function mine(ctx, p) {
  const util = u();
  const self = L('lib_auth').selfEmployee(ctx);
  if (self === '') return { payslips: [], total: 0 };
  const pg = util.page(p, 24, 200);
  const rows = util.rows(
    ctx.app,
    "SELECT s.id AS id, s.kind AS kind, s.period_start AS period_start, s.period_end AS period_end, s.pay_date AS pay_date, s.currency AS currency, s.gross_minor AS gross, s.deductions_minor AS ded, s.net_minor AS net, s.viewed_at AS viewed_at, e.name AS entity_name FROM payslips s JOIN entities e ON e.id = s.entity WHERE s.employee = {:e} AND s.status = 'published' ORDER BY s.pay_date DESC, s.created DESC LIMIT {:l} OFFSET {:o}",
    { id: '', kind: '', period_start: '', period_end: '', pay_date: '', currency: '', gross: 0, ded: 0, net: 0, viewed_at: '', entity_name: '' },
    { e: self, l: pg.limit, o: pg.offset },
  );
  const total = util.count(ctx.app, "SELECT COUNT(*) AS n FROM payslips WHERE employee = {:e} AND status = 'published'", { e: self });
  return { payslips: rows.map((r) => ({ id: r.id, kind: r.kind, period_start: r.period_start, period_end: r.period_end, pay_date: r.pay_date, currency: r.currency, gross_minor: r.gross, deductions_minor: r.ded, net_minor: r.net, viewed: r.viewed_at !== '', entity_name: r.entity_name })), total: total };
}

/** payslips.recent: the payslips of one employment the caller may see (profile Pay tab). */
function recent(ctx, p) {
  const util = u();
  const app = ctx.app;
  const m = L('lib_people').employmentRef(app, util.req(p, 'employment'));
  L('lib_people').needSee(ctx, m);
  const n = util.int(p, 'limit', 6, 1, 60);
  const rows = util.findMany(app, 'payslips', "employment = {:e} && (status = 'locked' || status = 'published')", '-pay_date,-created', 0, { e: m.id }).filter((s) => access(ctx, s) !== 'none');
  return { payslips: rows.slice(0, n).map((s) => ({ id: s.id, kind: s.getString('kind'), period_start: s.getString('period_start'), period_end: s.getString('period_end'), pay_date: s.getString('pay_date'), currency: s.getString('currency'), gross_minor: s.getInt('gross_minor'), net_minor: s.getInt('net_minor'), status: s.getString('status') })), total: rows.length };
}

/** payslips.list: payslips of a run or an employment (payroll). */
function list(ctx, p) {
  const util = u();
  const app = ctx.app;
  L('lib_payroll').need(ctx, 'view');
  const where = [];
  const bind = {};
  const run = util.str(p, 'payrun', '');
  if (run !== '') {
    where.push('payrun = {:r}');
    bind.r = L('lib_payroll_runs').runRef(app, run).id;
  }
  const er = util.str(p, 'employment', '');
  if (er !== '') {
    where.push('employment = {:e}');
    bind.e = L('lib_people').employmentRef(app, er).id;
  }
  if (where.length === 0) throw util.fail(400, 'Give --payrun or --employment.', 'missing_param');
  const pg = util.page(p, 100, 1000);
  const rows = util.findMany(app, 'payslips', where.join(' && '), '-pay_date,employment', 0, bind).filter((s) => L('lib_auth').inScope(ctx, s.getString('entity')));
  return {
    payslips: rows.slice(pg.offset, pg.offset + pg.limit).map((s) => {
      const e = app.findRecordById('employees', s.getString('employee'));
      return { id: s.id, payrun: s.getString('payrun'), employment: s.getString('employment'), employee_number: e.getString('number'), employee_name: L('lib_people').displayName(e), kind: s.getString('kind'), status: s.getString('status'), period_start: s.getString('period_start'), period_end: s.getString('period_end'), pay_date: s.getString('pay_date'), currency: s.getString('currency'), gross_minor: s.getInt('gross_minor'), deductions_minor: s.getInt('deductions_minor'), employer_minor: s.getInt('employer_minor'), net_minor: s.getInt('net_minor'), held: s.getBool('held') };
    }),
    total: rows.length,
  };
}

/** payslips.line: one line in full: how it was worked out (formula, every value it read, tables), the pack and its sources. */
function line(ctx, p) {
  const util = u();
  const app = ctx.app;
  const r = util.byId(app, 'payslip_lines', util.req(p, 'line'));
  if (r === null) throw util.fail(404, 'No such payslip line.', 'not_found');
  const x = slipRef(ctx, r.getString('payslip'));
  const v = lineView(r);
  const out = { line: v, payslip: x.rec.id, currency: x.rec.getString('currency') };
  if (v.source === 'pack' && v.pack !== '') {
    const pk = util.findOne(app, 'rule_packs', 'code = {:c} && version = {:v}', { c: v.pack, v: v.pack_version });
    const body = pk ? L('lib_payroll').packBody(pk) : null;
    if (body) {
      const steps = v.phase === 'year_end' ? body.year_end_steps || [] : body.steps || [];
      const step = steps[v.step] || null;
      out.pack = { code: body.code, name: body.name, version: body.version, sources: body.sources || [], notes: body.notes || '' };
      out.step = step ? { code: step.code, name: step.name, amount: step.amount, when: step.when || '', explain: step.explain || '', round: step.round || null, payee: step.payee || '', filing: step.filing || '' } : null;
      const ex = util.jsonOf(x.rec, 'explain', {}) || {};
      const vars = ex.vars && ex.vars[v.pack] ? ex.vars[v.pack] : {};
      const used = {};
      for (const rd of (v.explain && v.explain.reads) || []) if (vars[rd.name] !== undefined) used[rd.name] = vars[rd.name];
      out.vars = used;
    }
  }
  return out;
}

/** payslips.viewed: the person opened their payslip (first time only). */
function viewed(ctx, p) {
  const util = u();
  const x = slipRef(ctx, util.req(p, 'payslip'));
  if (x.access !== 'self') return { viewed: false };
  if (x.rec.getString('viewed_at') === '') {
    x.rec.set('viewed_at', util.nowIso());
    ctx.app.save(x.rec);
  }
  ctx.audited = true;
  return { viewed: true };
}

module.exports = { GROUPS: GROUPS, access: access, view: view, get: get, mine: mine, recent: recent, list: list, line: line, viewed: viewed };
