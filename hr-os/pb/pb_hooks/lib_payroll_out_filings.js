/// <reference path="../pb_data/types.d.ts" />
/**
 * The statutory filings ledger. Each entity's enabled packs (their
 * `filings`), its country data (`filings`) and HR OS's builtins give the
 * obligations; lib_payroll_out_calendar turns each into periods with due
 * days. A row's amount comes from locked lines filed under its code (the
 * pack step's `filing`). People prepare a worksheet and data file, submit
 * outside HR OS and record the reference, then the result.
 *
 * Statuses: todo -> prepared -> submitted -> accepted | rejected; not_needed;
 * amend (the figures changed after a submission: a correction run locked).
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}

const OPEN = ['todo', 'prepared', 'amend', 'rejected'];

function cal() {
  return L('lib_payroll_out_calendar');
}

/** Active rule pack bodies enabled for an entity (the version in force on `day`, else the newest active one). */
function packBodies(app, entity, day) {
  const u = L('lib_util');
  const codes = u.jsonOf(entity, 'packs', []) || [];
  const out = [];
  for (const code of codes) {
    const rows = u.findMany(app, 'rule_packs', 'code = {:c} && status = "active"', '-effective_from', 20, { c: code });
    if (rows.length === 0) continue;
    let pick = rows[0];
    for (const r of rows) if (r.getString('effective_from') <= day && (r.getString('effective_to') === '' || r.getString('effective_to') >= day)) { pick = r; break; }
    const body = u.jsonOf(pick, 'body', null);
    if (body) out.push(body);
  }
  return out;
}

function taxStartOf(bodies, packCode, country) {
  for (const b of bodies) if (b.code === packCode && b.tax_year && b.tax_year.start) return b.tax_year.start;
  const main = ((country && country.packs) || [])[0];
  for (const b of bodies) if (b.code === main && b.tax_year && b.tax_year.start) return b.tax_year.start;
  for (const b of bodies) if (b.country && b.tax_year && b.tax_year.start && b.region === '') return b.tax_year.start;
  return '01-01';
}

function calendarFor(app, entity) {
  const u = L('lib_util');
  const own = u.findOne(app, 'holiday_calendars', 'entity = {:e} && archived = false', { e: entity.id });
  if (own !== null) return own.id;
  const region = entity.getString('region');
  const code = entity.getString('country') + (region ? '-' + region : '');
  const c = u.findOne(app, 'holiday_calendars', 'code = {:c}', { c: code }) || u.findOne(app, 'holiday_calendars', 'code = {:c}', { c: entity.getString('country') });
  return c ? c.id : '';
}

/** Sum of locked lines of an entity between two pay dates, by filing code or by listed codes. */
function amountOf(app, entityId, rule, code, from, to, runId) {
  const u = L('lib_util');
  const base = "FROM payslip_lines l JOIN payslips s ON s.id = l.payslip JOIN payruns r ON r.id = l.payrun WHERE r.entity = {:e} AND r.status IN ('locked','paid') AND s.status != 'void'";
  const where = runId ? ' AND r.id = {:run}' : ' AND s.pay_date >= {:f} AND s.pay_date <= {:t}';
  const bind = { e: entityId, f: from, t: to, run: runId || '' };
  let amount = 0;
  const filing = rule && rule.amount && rule.amount.filing ? rule.amount.filing : code;
  if (rule && rule.amount && !rule.amount.filing) {
    for (const c of rule.amount.plus || []) amount += u.one(app, 'SELECT CAST(COALESCE(SUM(l.amount_minor),0) AS INTEGER) AS a ' + base + where + ' AND l.code = {:c}', { a: 0 }, Object.assign({ c: c }, bind)).a;
    for (const c of rule.amount.minus || []) amount -= u.one(app, 'SELECT CAST(COALESCE(SUM(l.amount_minor),0) AS INTEGER) AS a ' + base + where + ' AND l.code = {:c}', { a: 0 }, Object.assign({ c: c }, bind)).a;
  } else {
    amount = u.one(app, 'SELECT CAST(COALESCE(SUM(l.amount_minor),0) AS INTEGER) AS a ' + base + where + ' AND l.filing = {:c}', { a: 0 }, Object.assign({ c: filing }, bind)).a;
  }
  const runs = u.rows(app, "SELECT DISTINCT r.id AS id, r.number AS number, r.pay_date AS pay_date FROM payruns r JOIN payslips s ON s.payrun = r.id WHERE r.entity = {:e} AND r.status IN ('locked','paid') AND s.status != 'void'" + (runId ? ' AND r.id = {:run}' : ' AND s.pay_date >= {:f} AND s.pay_date <= {:t}') + ' ORDER BY r.pay_date', { id: '', number: '', pay_date: '' }, bind);
  // the payee of the lines the amount is made of (listed codes, else the filing code)
  const byCodes = rule && rule.amount && !rule.amount.filing && (rule.amount.plus || []).length > 0;
  const of = byCodes ? ' AND l.code IN (' + rule.amount.plus.map((c) => "'" + String(c).replace(/[^A-Z0-9_]/g, '') + "'").join(',') + ')' : ' AND l.filing = {:c}';
  const payee = u.one(app, "SELECT l.payee AS payee, COUNT(*) AS n " + base + where + of + " AND l.payee != '' GROUP BY l.payee ORDER BY n DESC LIMIT 1", { payee: '', n: 0 }, Object.assign({ c: filing }, bind));
  return { amount: amount, runs: runs.map((r) => ({ id: r.id, number: r.number, pay_date: r.pay_date })), payee: payee ? payee.payee : '' };
}

/**
 * Create and refresh the ledger rows of one entity for the periods that
 * end in `year` and have started by `today`. Idempotent. Returns counts.
 */
function generate(app, entity, year, today) {
  const u = L('lib_util');
  const C = cal();
  const po = L('lib_payroll_out');
  const country = po.countryOf(entity);
  const bodies = packBodies(app, entity, today);
  const regionPacksOn = bodies.some((b) => b.region && b.region !== '');
  const decl = C.declarations(bodies, country, regionPacksOn);
  const prefs = po.settingsOf(app, entity).filing_prefs || {};
  const weekend = (country && country.weekend) || [0, 6];
  const calId = calendarFor(app, entity);
  const holiday = {};
  const isOff = (d) => {
    if (calId === '') return false;
    if (holiday[d] === undefined) holiday[d] = L('lib_calendar').isHoliday(app, calId, d) !== null;
    return holiday[d];
  };
  const counts = { created: 0, updated: 0, amend: 0, rows: 0, dropped: 0 };
  // Obligations start when payroll starts in HR OS: the go-live day, else the
  // first locked run, else today (a new company sees the current periods only).
  const ps = u.findOne(app, 'payroll_settings', 'entity = {:e}', { e: entity.id });
  const first = u.one(app, "SELECT COALESCE(MIN(period_start), '') AS d FROM payruns WHERE entity = {:e} AND status IN ('locked','paid')", { d: '' }, { e: entity.id });
  let from = ps !== null && ps.getString('go_live_day') !== '' ? ps.getString('go_live_day') : first && first.d !== '' ? first.d : today;
  if (first && first.d !== '' && first.d < from) from = first.d;
  counts.from = from;
  counts.voided = settleVoided(app, entity);
  // the current and next month's periods, so what is coming shows before it is due
  const horizon = u.dayAdd(today, 31);
  const staffed = {};
  const hadPeople = (s, e) => {
    const k = s + e;
    if (staffed[k] === undefined) staffed[k] = u.count(app, "SELECT COUNT(*) AS n FROM employments WHERE entity = {:e} AND start_day != '' AND start_day <= {:t} AND (end_day = '' OR end_day >= {:f})", { e: entity.id, f: s, t: e }) > 0;
    return staffed[k];
  };
  for (const d of decl) {
    const rule = C.ruleFor(d.code, prefs, d.frequency);
    if (rule === null || rule.period === 'event') continue;
    const taxStart = taxStartOf(bodies, d.pack, country);
    let list = [];
    if (rule.period === 'pay_date' || rule.period === 'bonus') {
      const kinds = rule.period === 'bonus' ? "('bonus')" : "('regular','off_cycle','bonus','termination','correction')";
      const runs = u.rows(app, "SELECT id, number, period_start, period_end, pay_date FROM payruns WHERE entity = {:e} AND status IN ('locked','paid') AND kind IN " + kinds + " AND pay_date >= {:f} AND pay_date <= {:t} ORDER BY pay_date", { id: '', number: '', period_start: '', period_end: '', pay_date: '' }, { e: entity.id, f: year + '-01-01', t: year + '-12-31' });
      list = runs.map((r) => ({ period: r.number, start: r.period_start, end: r.period_end, payDate: r.pay_date, run: r.id }));
    } else {
      list = C.periods(rule, year, taxStart).filter((p) => p.start <= horizon);
    }
    for (const p of list) {
      const due = C.dueDay(rule, p, weekend, isOff);
      // Periods from the go-live on are this ledger's. An obligation due before the go-live was
      // the earlier system's; a period before it is listed only while its payment is still
      // ahead and the entity had people then (October's remittances on a November go-live;
      // nothing for a company set up today with nobody), never as late.
      if (!p.run && due !== '' && due < from) continue;
      if (!p.run && p.end < from && (due === '' || due < today || !hadPeople(p.start, p.end))) continue;
      const amt = amountOf(app, entity.id, rule, d.code, p.start, p.end, p.run);
      let rec = u.findOne(app, 'filings', 'entity = {:e} && kind = {:k} && period = {:p}', { e: entity.id, k: d.code, p: p.period });
      counts.rows += 1;
      if (rec === null) {
        rec = u.newRecord(app, 'filings');
        rec.set('entity', entity.id);
        rec.set('country', entity.getString('country'));
        rec.set('kind', d.code);
        rec.set('period', p.period);
        rec.set('status', 'todo');
        rec.set('source', d.source);
        counts.created += 1;
      } else {
        const st = rec.getString('status');
        const was = rec.getInt('amount_minor');
        if ((st === 'submitted' || st === 'accepted') && was !== amt.amount) {
          rec.set('status', 'amend');
          rec.set('note', u.clip('Figures changed after the submission (' + was + ' to ' + amt.amount + ' minor units): a run was locked or corrected later. ' + rec.getString('note'), 2000));
          counts.amend += 1;
        } else if (st === 'prepared' && was !== amt.amount) {
          rec.set('status', 'todo');
          rec.set('note', u.clip('Figures changed after it was prepared; prepare it again. ' + rec.getString('note'), 2000));
        }
        counts.updated += 1;
      }
      rec.set('name', u.clip(d.name, 200));
      rec.set('form', u.clip(d.form || '', 200));
      rec.set('pack', d.pack || '');
      rec.set('frequency', C.FREQUENCY_OF[rule.period] || 'monthly');
      rec.set('period_start', p.start);
      rec.set('period_end', p.end);
      if (!rec.getBool('due_manual')) rec.set('due_day', due);
      rec.set('due_rule', u.clip(d.due_rule || '', 300));
      rec.set('amount_minor', amt.amount);
      rec.set('currency', entity.getString('currency'));
      rec.set('payee', u.clip(amt.payee, 120));
      rec.set('payruns', amt.runs.map((r) => r.id));
      rec.set('payrun', amt.runs.length > 0 ? amt.runs[amt.runs.length - 1].id : p.run || '');
      app.save(rec);
    }
    // Rows of this kind made under another choice (a monthly depositor turned semi-weekly, a
    // change of pay frequency) are not owed: the open ones nobody worked on go, worked ones stay.
    const stale = u.findMany(app, 'filings', "entity = {:e} && kind = {:k} && frequency != {:f} && status = 'todo' && due_manual = false && period_start >= {:a} && period_start <= {:b}", 'period_start', 500, { e: entity.id, k: d.code, f: C.FREQUENCY_OF[rule.period] || 'monthly', a: year + '-01-01', b: year + '-12-31' });
    for (const s of stale) {
      app.delete(app.findRecordById('filings', s.id));
      counts.dropped += 1;
    }
  }
  return counts;
}

function view(app, r, today) {
  const due = r.getString('due_day');
  const st = r.getString('status');
  let days = null;
  if (due !== '') days = Math.round((Date.parse(due + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000);
  const ent = app.findRecordById('entities', r.getString('entity'));
  return {
    id: r.id, entity: ent.id, entity_name: ent.getString('name'), country: r.getString('country'), kind: r.getString('kind'), name: r.getString('name'), form: r.getString('form'),
    pack: r.getString('pack'), frequency: r.getString('frequency'), period: r.getString('period'), period_start: r.getString('period_start'), period_end: r.getString('period_end'),
    due_day: due, due_manual: r.getBool('due_manual'), due_rule: r.getString('due_rule'), days_left: days, overdue: days !== null && days < 0 && OPEN.indexOf(st) >= 0,
    status: st, amount_minor: r.getInt('amount_minor'), currency: r.getString('currency'), payee: r.getString('payee'), payruns: L('lib_payroll_out').jsonField(r, 'payruns', []),
    reference: r.getString('reference'), note: r.getString('note'), prepared_at: r.getString('prepared_at'), prepared_by: L('lib_payroll_out').memberName(app, r.getString('prepared_by')),
    submitted_on: r.getString('submitted_on'), submitted_by: L('lib_payroll_out').memberName(app, r.getString('submitted_by')), result_at: r.getString('result_at'),
    has_file: r.getString('file') !== '', source: r.getString('source'), documents: (cal().RULES[r.getString('kind')] || {}).documents === true,
  };
}

/** The live worksheet of a row: lines by code, people and runs (from locked runs only). */
function worksheet(app, r) {
  const u = L('lib_util');
  const C = cal();
  const code = r.getString('kind');
  const rule = C.RULES[code] && C.RULES[code].amount ? { amount: C.RULES[code].amount } : null;
  const runIds = L('lib_payroll_out').jsonField(r, 'payruns', []);
  const byCodes = rule && rule.amount && !rule.amount.filing;
  const by = byCodes ? 'l.code IN (' + (rule.amount.plus || []).concat(rule.amount.minus || []).map((c) => "'" + String(c).replace(/[^A-Z0-9_]/g, '') + "'").join(',') + ')' : 'l.filing = {:c}';
  const base = "FROM payslip_lines l JOIN payslips s ON s.id = l.payslip JOIN payruns r ON r.id = l.payrun WHERE r.entity = {:e} AND r.status IN ('locked','paid') AND s.status != 'void' AND s.pay_date >= {:f} AND s.pay_date <= {:t} AND " + by;
  const bind = { e: r.getString('entity'), f: r.getString('period_start'), t: r.getString('period_end'), c: rule && rule.amount && rule.amount.filing ? rule.amount.filing : code };
  if (r.getString('frequency') === 'per_pay_date' || r.getString('frequency') === 'per_bonus') {
    bind.f = '0000-00-00';
    bind.t = '9999-99-99';
  }
  const runFilter = runIds.length > 0 && (r.getString('frequency') === 'per_pay_date' || r.getString('frequency') === 'per_bonus') ? ' AND r.id = {:run}' : '';
  if (runFilter) bind.run = runIds[0];
  const codes = u.rows(app, 'SELECT l.code AS code, MAX(l.name) AS name, l.kind AS kind, CAST(COALESCE(SUM(l.amount_minor),0) AS INTEGER) AS amount, COUNT(DISTINCT l.employment) AS people ' + base + runFilter + ' GROUP BY l.code, l.kind ORDER BY l.kind, l.code', { code: '', name: '', kind: '', amount: 0, people: 0 }, bind);
  const per = u.rows(app, 'SELECT l.employment AS employment, l.code AS code, CAST(COALESCE(SUM(l.amount_minor),0) AS INTEGER) AS amount ' + base + runFilter + ' GROUP BY l.employment, l.code', { employment: '', code: '', amount: 0 }, bind);
  const people = {};
  for (const x of per) {
    if (people[x.employment] === undefined) {
      const em = u.byId(app, 'employments', x.employment);
      const emp = em ? u.byId(app, 'employees', em.getString('employee')) : null;
      people[x.employment] = { employment: x.employment, employee_number: emp ? emp.getString('number') : '', name: emp ? L('lib_people').displayName(emp) : '', by_code: {}, total_minor: 0 };
    }
    people[x.employment].by_code[x.code] = x.amount;
    people[x.employment].total_minor += byCodes && (rule.amount.minus || []).indexOf(x.code) >= 0 ? -x.amount : x.amount;
  }
  let employee = 0;
  let employer = 0;
  for (const c of codes) {
    if (c.kind === 'employer') employer += c.amount;
    else if (c.kind === 'deduction') employee += c.amount;
  }
  const list = Object.keys(people).map((k) => people[k]).sort((a, b) => a.employee_number.localeCompare(b.employee_number));
  const runs = runIds.map((id) => {
    const x = u.byId(app, 'payruns', id);
    return x ? { id: id, number: x.getString('number'), pay_date: x.getString('pay_date'), kind: x.getString('kind') } : null;
  }).filter((x) => x !== null);
  return { code: code, codes: codes, people: list, runs: runs, employee_minor: employee, employer_minor: employer, total_minor: r.getInt('amount_minor'), currency: r.getString('currency') };
}

function worksheetCsv(ws) {
  const codes = ws.codes.map((c) => c.code);
  const rows = [['employee_number', 'name'].concat(codes).concat(['total'])];
  const B = L('lib_bankfiles');
  const exp = B.exponentOf(ws.currency);
  for (const p of ws.people) rows.push([p.employee_number, p.name].concat(codes.map((c) => B.majorText(p.by_code[c] || 0, exp))).concat([B.majorText(p.total_minor, exp)]));
  rows.push(['', 'Total'].concat(ws.codes.map((c) => B.majorText(c.amount, exp))).concat([B.majorText(ws.total_minor, exp)]));
  return L('lib_util').csvText(rows);
}

function rec(ctx, ref) {
  const u = L('lib_util');
  const r = u.byId(ctx.app, 'filings', String(ref || ''));
  if (r === null) throw u.fail(404, 'No filing "' + ref + '". Run filings.list to see them.', 'not_found');
  if (!L('lib_auth').inScope(ctx, r.getString('entity'))) throw u.fail(403, 'That filing is outside your access.', 'not_permitted');
  return r;
}

/* ----------------------------------------------------------------- ops */

function list(ctx, p) {
  const u = L('lib_util');
  L('lib_auth').need(ctx, 'payroll', 'view');
  L('lib_payroll_out').gatePay(ctx);
  const ids = L('lib_payroll_out').entityIds(ctx, p.entity);
  if (ids.length === 0) return { filings: [], total: 0, counts: { overdue: 0, due_7: 0, open: 0, rejected: 0 } };
  const show = u.oneOf(p, 'show', ['open', 'due', 'done', 'all'], 'open');
  const days = u.int(p, 'days', 30, 0, 400);
  fillEmpty(ctx.app, ids);
  const marks = ids.map((_, i) => '{:e' + i + '}').join(',');
  const bind = {};
  ids.forEach((id, i) => (bind['e' + i] = id));
  let where = 'entity IN (' + marks + ')';
  const today = u.today(ctx.app, ids.length === 1 ? ids[0] : undefined);
  bind.today = today;
  bind.soon = u.dayAdd(today, 7);
  bind.window = u.dayAdd(today, days);
  if (show === 'open') where += " AND status IN ('todo','prepared','amend','rejected')";
  else if (show === 'due') where += " AND (status = 'rejected' OR (status IN ('todo','prepared','amend') AND due_day != '' AND due_day <= {:window}))";
  else if (show === 'done') where += " AND status IN ('submitted','accepted','not_needed')";
  if (u.str(p, 'year', '') !== '') {
    bind.y0 = u.str(p, 'year', '') + '-01-01';
    bind.y1 = u.str(p, 'year', '') + '-12-31';
    where += ' AND period_end >= {:y0} AND period_end <= {:y1}';
  }
  if (u.str(p, 'kind', '') !== '') {
    bind.k = u.str(p, 'kind', '');
    where += ' AND kind = {:k}';
  }
  const pg = u.page(p, 100, 500);
  const order = show === 'done' ? 'period_end DESC, kind' : "(due_day = '') ASC, due_day ASC, kind";
  const rows = u.rows(ctx.app, 'SELECT id FROM filings WHERE ' + where + ' ORDER BY ' + order + ' LIMIT ' + pg.limit + ' OFFSET ' + pg.offset, { id: '' }, bind);
  const total = u.count(ctx.app, 'SELECT COUNT(*) AS n FROM filings WHERE ' + where, bind);
  const cnt = (extra) => u.count(ctx.app, 'SELECT COUNT(*) AS n FROM filings WHERE entity IN (' + marks + ') AND ' + extra, bind);
  return {
    filings: rows.map((r) => view(ctx.app, ctx.app.findRecordById('filings', r.id), today)), total: total, today: today, days: show === 'due' ? days : null,
    counts: {
      overdue: cnt("status IN ('todo','prepared','amend','rejected') AND due_day != '' AND due_day < {:today}"),
      due_7: cnt("status IN ('todo','prepared','amend','rejected') AND due_day != '' AND due_day >= {:today} AND due_day <= {:soon}"),
      due_window: cnt("status IN ('todo','prepared','amend','rejected') AND due_day != '' AND due_day >= {:today} AND due_day <= {:window}"),
      open: cnt("status IN ('todo','prepared','amend','rejected')"),
      rejected: cnt("status = 'rejected'"),
      no_due: cnt("status IN ('todo','prepared','amend') AND due_day = ''"),
    },
  };
}

/** An entity whose ledger was never built (installed before the cron ran) gets it now. */
function fillEmpty(app, ids) {
  const u = L('lib_util');
  for (const id of ids) {
    if (u.count(app, 'SELECT COUNT(*) AS n FROM filings WHERE entity = {:e}', { e: id }) > 0) continue;
    const entity = app.findRecordById('entities', id);
    const today = u.today(app, id);
    generate(app, entity, Number(today.slice(0, 4)), today);
  }
}

function get(ctx, p) {
  L('lib_auth').need(ctx, 'payroll', 'view');
  L('lib_payroll_out').gatePay(ctx);
  const r = rec(ctx, p.filing);
  const today = L('lib_util').today(ctx.app, r.getString('entity'));
  const v = view(ctx.app, r, today);
  const stored = L('lib_payroll_out').jsonField(r, 'worksheet', null);
  const frozen = ['submitted', 'accepted'].indexOf(v.status) >= 0 && stored && stored.codes;
  v.worksheet = frozen ? stored : worksheet(ctx.app, r);
  v.worksheet_frozen = !!frozen;
  const rule = cal().ruleFor(v.kind, L('lib_payroll_out').settingsOf(ctx.app, ctx.app.findRecordById('entities', v.entity)).filing_prefs, v.frequency);
  v.rule = rule ? { period: rule.period, due: rule.due || null, adjust: rule.adjust || 'none', choice: rule.choice || '', choice_pref: rule.choice_pref || '', choice_options: rule.choice_options || [] } : null;
  return { filing: v };
}

function generateOp(ctx, p) {
  const u = L('lib_util');
  L('lib_auth').need(ctx, 'payroll', 'edit');
  const ids = L('lib_payroll_out').entityIds(ctx, p.entity);
  const out = { created: 0, updated: 0, amend: 0, rows: 0 };
  for (const id of ids) {
    const entity = ctx.app.findRecordById('entities', id);
    const today = u.today(ctx.app, id);
    const year = u.int(p, 'year', Number(today.slice(0, 4)), 2000, 2100);
    const c = generate(ctx.app, entity, year, today);
    for (const k of Object.keys(out)) out[k] += c[k];
  }
  L('lib_audit').note(ctx, { collection: 'filings', summary: 'Refreshed the filings ledger (' + out.created + ' new rows, ' + out.amend + ' to amend)' });
  return out;
}

function prepare(ctx, p) {
  const u = L('lib_util');
  L('lib_auth').need(ctx, 'payroll', 'edit');
  const r = rec(ctx, p.filing);
  if (['submitted', 'accepted', 'not_needed'].indexOf(r.getString('status')) >= 0) throw u.fail(409, 'This filing is ' + r.getString('status') + '; reopen it first.', 'closed');
  const ws = worksheet(ctx.app, r);
  const text = worksheetCsv(ws);
  const bytes = L('lib_bankfiles').utf8Bytes(text);
  const name = r.getString('kind') + '-' + r.getString('period').replace(/[^A-Za-z0-9-]+/g, '_') + '.csv';
  r.set('worksheet', ws);
  r.set('worksheet_hash', L('lib_bankfiles').sha256(bytes));
  r.set('file', L('lib_payroll_out').fileFrom(bytes, name));
  r.set('status', 'prepared');
  if (ctx.memberId) r.set('prepared_by', ctx.memberId);
  r.set('prepared_at', u.nowIso());
  ctx.app.save(r);
  L('lib_audit').note(ctx, { collection: 'filings', record: r.id, summary: 'Prepared ' + r.getString('name') + ' for ' + r.getString('period') });
  return Object.assign(get(ctx, { filing: r.id }), { next: 'Submit it on the authority\'s site, then record the reference here.' });
}

function submit(ctx, p) {
  const u = L('lib_util');
  L('lib_auth').need(ctx, 'payroll', 'edit');
  const r = rec(ctx, p.filing);
  if (['accepted', 'not_needed'].indexOf(r.getString('status')) >= 0) throw u.fail(409, 'This filing is ' + r.getString('status') + '.', 'closed');
  const reference = u.text(p, 'reference', 200, '').trim();
  if (reference === '') throw u.fail(400, 'Give the submission reference (receipt, acknowledgement or payment number).', 'missing_param', { param: 'reference' });
  if (r.getString('worksheet') === '' || r.getString('worksheet') === 'null') r.set('worksheet', worksheet(ctx.app, r));
  r.set('status', 'submitted');
  r.set('reference', reference);
  r.set('submitted_on', u.day(p, 'submitted_on', u.today(ctx.app, r.getString('entity'))));
  if (ctx.memberId) r.set('submitted_by', ctx.memberId);
  r.set('submitted_at', u.nowIso());
  if (u.str(p, 'note', '') !== '') r.set('note', u.text(p, 'note', 2000, ''));
  ctx.app.save(r);
  L('lib_audit').note(ctx, { collection: 'filings', record: r.id, summary: 'Submitted ' + r.getString('name') + ' ' + r.getString('period') + ', reference ' + reference });
  return get(ctx, { filing: r.id });
}

function result(ctx, p) {
  const u = L('lib_util');
  L('lib_auth').need(ctx, 'payroll', 'edit');
  const r = rec(ctx, p.filing);
  if (r.getString('status') !== 'submitted') throw u.fail(409, 'Record the result of a submitted filing (this one is ' + r.getString('status') + ').', 'not_submitted');
  const res = u.oneOf(p, 'result', ['accepted', 'rejected'], '');
  if (res === '') throw u.fail(400, 'result is accepted or rejected.', 'missing_param', { param: 'result' });
  r.set('status', res);
  r.set('result_at', u.nowIso());
  if (u.str(p, 'note', '') !== '') r.set('note', u.text(p, 'note', 2000, ''));
  ctx.app.save(r);
  L('lib_audit').note(ctx, { collection: 'filings', record: r.id, summary: (res === 'accepted' ? 'Accepted: ' : 'Rejected: ') + r.getString('name') + ' ' + r.getString('period') });
  return get(ctx, { filing: r.id });
}

function skip(ctx, p) {
  const u = L('lib_util');
  L('lib_auth').need(ctx, 'payroll', 'edit');
  const r = rec(ctx, p.filing);
  if (['submitted', 'accepted'].indexOf(r.getString('status')) >= 0) throw u.fail(409, 'A submitted filing cannot be marked not needed.', 'closed');
  const reason = u.text(p, 'reason', 2000, '').trim();
  if (reason === '') throw u.fail(400, 'Say why it is not needed (for example: no payments in the period, under the threshold).', 'missing_param', { param: 'reason' });
  r.set('status', 'not_needed');
  r.set('note', reason);
  ctx.app.save(r);
  L('lib_audit').note(ctx, { collection: 'filings', record: r.id, summary: 'Not needed: ' + r.getString('name') + ' ' + r.getString('period') });
  return get(ctx, { filing: r.id });
}

function reopen(ctx, p) {
  L('lib_auth').need(ctx, 'payroll', 'edit');
  const u = L('lib_util');
  const r = rec(ctx, p.filing);
  if (r.getString('status') === 'todo') return get(ctx, { filing: r.id });
  const was = r.getString('status');
  r.set('status', was === 'submitted' || was === 'accepted' ? 'amend' : 'todo');
  if (u.str(p, 'note', '') !== '') r.set('note', u.text(p, 'note', 2000, ''));
  ctx.app.save(r);
  L('lib_audit').note(ctx, { collection: 'filings', record: r.id, summary: 'Reopened ' + r.getString('name') + ' ' + r.getString('period') + ' (was ' + was + ')' });
  return get(ctx, { filing: r.id });
}

function setDue(ctx, p) {
  const u = L('lib_util');
  L('lib_auth').need(ctx, 'payroll', 'edit');
  const r = rec(ctx, p.filing);
  const d = u.str(p, 'due_day', '');
  if (d !== '' && !u.isDay(d)) throw u.fail(400, 'due_day is YYYY-MM-DD (or empty to go back to the rule).', 'invalid_param', { param: 'due_day' });
  r.set('due_manual', d !== '');
  if (d !== '') r.set('due_day', d);
  ctx.app.save(r);
  if (d === '') generate(ctx.app, ctx.app.findRecordById('entities', r.getString('entity')), Number(r.getString('period_end').slice(0, 4)), u.today(ctx.app, r.getString('entity')));
  L('lib_audit').note(ctx, { collection: 'filings', record: r.id, summary: 'Set the due day of ' + r.getString('name') + ' ' + r.getString('period') + ' to ' + (d || 'the rule') });
  return get(ctx, { filing: r.id });
}

function downloadOp(ctx, p) {
  L('lib_auth').need(ctx, 'payroll', 'edit', 'download filing data');
  const r = rec(ctx, p.filing);
  if (r.getString('file') === '') throw L('lib_util').fail(404, 'Prepare the filing first; it has no data file yet.', 'not_prepared');
  L('lib_audit').write(ctx, { op: 'filings.download', collection: 'filings', record: r.id, summary: 'Downloaded the data file of ' + r.getString('name') + ' ' + r.getString('period') });
  return L('lib_files').serve(ctx, r, 'file', r.getString('kind') + '-' + r.getString('period') + '.csv', true);
}

/** What an entity must file: every declaration with its rule, choices and the preference set. */
function calendarOp(ctx, p) {
  const u = L('lib_util');
  L('lib_auth').need(ctx, 'payroll', 'view');
  const po = L('lib_payroll_out');
  const entity = po.entityRec(ctx, p.entity);
  const today = u.today(ctx.app, entity.id);
  const bodies = packBodies(ctx.app, entity, today);
  const country = po.countryOf(entity);
  const prefs = po.settingsOf(ctx.app, entity).filing_prefs || {};
  const C = cal();
  const decl = C.declarations(bodies, country, bodies.some((b) => b.region && b.region !== ''));
  return {
    entity: entity.id, country: entity.getString('country'), prefs: prefs,
    filings: decl.map((d) => {
      const raw = C.RULES[d.code] || null;
      const rule = C.ruleFor(d.code, prefs, d.frequency);
      return Object.assign({}, d, {
        period: rule ? rule.period : '', has_due_rule: !!(rule && rule.due), adjust: rule ? rule.adjust || 'none' : '',
        choice_pref: raw && raw.pref ? raw.pref : '', choice: rule && rule.choice ? rule.choice : '', choices: raw && raw.choices ? Object.keys(raw.choices) : [],
      });
    }),
  };
}

/* ---------------------------------------------------------------- cron */

/** Hourly: refresh every active entity's ledger (last year, this year, and next year from late December) and remind payroll people once a day of what is due within 7 days or late. */
function cronDaily(app) {
  const u = L('lib_util');
  const ents = u.rows(app, 'SELECT id FROM entities WHERE active = TRUE', { id: '' });
  for (const e of ents) {
    try {
      const entity = app.findRecordById('entities', e.id);
      const today = u.today(app, e.id);
      const y = Number(today.slice(0, 4));
      const last = Number(u.dayAdd(today, 31).slice(0, 4));
      for (let year = y - 1; year <= last; year++) generate(app, entity, year, today);
      remind(app, entity, today);
    } catch (err) {
      console.error('[hr] filings refresh failed for entity ' + e.id + ':', err);
    }
  }
}

function remind(app, entity, today) {
  const u = L('lib_util');
  const soon = u.dayAdd(today, 7);
  const rows = u.findMany(app, 'filings', "entity = {:e} && (status = 'todo' || status = 'prepared' || status = 'amend' || status = 'rejected') && due_day != '' && due_day <= {:s} && reminded_on != {:t}", 'due_day', 200, { e: entity.id, s: soon, t: today });
  if (rows.length === 0) return 0;
  const late = rows.filter((r) => r.getString('due_day') < today).length;
  // A short title; the counts and the next due day are facts (the page lists the filings).
  const title = (late > 0 ? 'Filings late: ' : 'Filings due: ') + entity.getString('name');
  const names = rows.map((r) => r.getString('name'));
  const body = names.slice(0, 4).join(', ') + (names.length > 4 ? ' and ' + (names.length - 4) + ' more' : '');
  const n = { kind: 'filing_due', title: title, body: body, link: '#/payroll/filings', facts: (late > 0 ? [{ type: 'number', key: 'late', label: 'Late', value: late, unit: late === 1 ? 'filing late' : 'filings late' }] : []).concat(rows.length - late > 0 ? [{ type: 'number', key: 'due', label: 'Due within 7 days', value: rows.length - late, unit: rows.length - late === 1 ? 'filing due' : 'filings due' }] : [], [{ type: 'day', key: 'next_due', label: 'Next due', value: rows[0].getString('due_day') }]) };
  for (const role of ['payroll_admin', 'owner']) {
    try {
      L('lib_notify').toRole(app, role, n);
    } catch (err) {
      console.error('[hr] filing reminder to ' + role + ' failed:', err);
    }
  }
  for (const r of rows) {
    r.set('reminded_on', today);
    app.save(r);
  }
  return rows.length;
}

/**
 * Rows made for one pay run (per pay date, per bonus) whose run was voided:
 * not needed any more, or to amend when they were already submitted. The
 * replacement run gets its own rows when it is locked. Returns the count.
 */
function settleVoided(app, entity) {
  const u = L('lib_util');
  const rows = u.rows(app, "SELECT f.id AS id FROM filings f JOIN payruns r ON r.id = f.payrun WHERE f.entity = {:e} AND r.status = 'void' AND f.frequency IN ('per_pay_date','per_bonus') AND f.status IN ('todo','prepared','submitted','accepted','amend')", { id: '' }, { e: entity.id });
  let n = 0;
  for (const x of rows) {
    const f = app.findRecordById('filings', x.id);
    const run = app.findRecordById('payruns', f.getString('payrun'));
    let repl = '';
    try {
      const rb = run.getString('replaced_by');
      if (rb !== '') repl = app.findRecordById('payruns', rb).getString('number');
    } catch {
      repl = '';
    }
    const why = 'Pay run ' + run.getString('number') + ' was voided' + (repl !== '' ? '; its replacement ' + repl + ' gets its own row when it is locked' : '') + '.';
    const st = f.getString('status');
    if (st === 'submitted' || st === 'accepted') {
      if (f.getString('note').indexOf(why) >= 0) continue;
      f.set('status', 'amend');
      f.set('note', u.clip(why + ' It was already filed: correct it with the authority. ' + f.getString('note'), 2000));
    } else if (st === 'amend') {
      continue;
    } else {
      f.set('status', 'not_needed');
      f.set('note', u.clip(why + ' ' + f.getString('note'), 2000));
    }
    app.save(f);
    n += 1;
  }
  return n;
}

/** Event subscriber: a new entity gets its ledger at once. */
function onEntityCreated(ctx, payload) {
  const u = L('lib_util');
  const entity = u.byId(ctx.app, 'entities', String((payload && payload.entity) || ''));
  if (entity === null) return { refreshed: 0 };
  const today = u.today(ctx.app, entity.id);
  const c = generate(ctx.app, entity, Number(today.slice(0, 4)), today);
  return { refreshed: c.rows };
}

/** Event subscriber: a run locked, voided or paid; refresh its entity's ledger for the run's year. */
function onRunChanged(ctx, payload) {
  const u = L('lib_util');
  const run = u.byId(ctx.app, 'payruns', String((payload && payload.payrun) || ''));
  if (run === null) return { refreshed: 0 };
  const entity = ctx.app.findRecordById('entities', run.getString('entity'));
  const today = u.today(ctx.app, entity.id);
  const year = Number(run.getString('pay_date').slice(0, 4));
  const c = generate(ctx.app, entity, year, today > run.getString('pay_date') ? today : run.getString('pay_date'));
  if (Number(today.slice(0, 4)) !== year) generate(ctx.app, entity, Number(today.slice(0, 4)), today);
  return { refreshed: c.rows, amend: c.amend, voided: c.voided };
}

module.exports = { OPEN: OPEN, onRunChanged: onRunChanged, onEntityCreated: onEntityCreated, settleVoided: settleVoided, generate: generate, worksheet: worksheet, worksheetCsv: worksheetCsv, list: list, get: get, generateOp: generateOp, prepare: prepare, submit: submit, result: result, skip: skip, reopen: reopen, setDue: setDue, downloadOp: downloadOp, calendarOp: calendarOp, cronDaily: cronDaily, remind: remind };
