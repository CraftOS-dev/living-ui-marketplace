/// <reference path="../pb_data/types.d.ts" />
/**
 * Opening balances (payroll-core, QA3 major): the year to date figures of
 * people who were paid before HR OS in a tax year that began earlier.
 *
 * An entity's first pay run (no regular run locked yet), or any run while a
 * go-live day is set, needs them for every person employed before HR OS's
 * first pay period in the tax year of a pack that reads earlier pay: else
 * India's TDS projects from the go-live month, US FUTA and state
 * unemployment are charged past their wage bases again, and caps and
 * averages are too small. Each such payslip gets the blocker
 * `opening_balances_missing` (the run shows them as one, for the entity)
 * until the person has an opening balance in that tax year or a person
 * confirms for the entity that nothing was paid earlier this tax year.
 *
 * The columns of the opening balances screen come from the packs: every tag
 * and code a pack reads from earlier payslips over the tax year (ytd,
 * ytd_code, and ytd_since windows read once: a fiscal year, a quarter), and
 * the statutory deductions it withholds (for the year's totals), each once.
 *
 *   historyReads(pack)                          -> { tags, codes, withheld }
 *   columnsOf(packs)                            -> [{ key, kind, label, help, pack, pack_name, use }]
 *   startOf(app, entityId, goLive, run)         -> first day HR OS pays, while openings matter ('' = not now)
 *   needOf(rc, packs, runIn, start, end, days)  -> { from, packs, tax_year_start, covered } | null
 *
 * Ops: ytd.sheet, ytd.sheet-save, ytd.import-check, ytd.import, ytd.no-earlier-pay.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}

/** Step keys that hold formulas. */
const FORMULA_KEYS = ['expr', 'when', 'else', 'amount', 'qty', 'rate', 'base', 'check'];
const YTD_FNS = { ytd: 'tags', ytd_code: 'codes' };
const SINCE_FNS = { ytd_since: 'tags', ytd_code_since: 'codes' };
/** Pack profile fields that mean "this employment paid nothing earlier this year": the entity's confirmation sets them. */
const NO_EARLIER_PAY_FIELDS = ['my_pcb_no_earlier_pay'];
const MAX_ROWS = 2000;

/* ------------------------------------------------------------ the packs */

let _reads = {};

/** What a pack reads from earlier payslips over the tax year, and the statutory deductions it withholds. */
function historyReads(pack) {
  const key = pack.code + '@' + pack.version;
  if (_reads[key] !== undefined) return _reads[key];
  const X = L('lib_expr');
  const ytd = { tags: {}, codes: {} };
  const since = { tags: {}, codes: {} };
  const steps = (pack.steps || []).concat(pack.year_end_steps || []);
  for (const s of steps) {
    for (const f of FORMULA_KEYS) {
      const src = s[f];
      if (typeof src !== 'string' || src === '') continue;
      let refs;
      try {
        refs = X.refsOf(X.compile(src).tree);
      } catch (e) {
        continue;
      }
      for (const c of refs.calls) {
        const a = c.args && c.args[0];
        if (!a || a.t !== 'str') continue;
        if (YTD_FNS[c.fn] !== undefined) ytd[YTD_FNS[c.fn]][a.v] = true;
        else if (SINCE_FNS[c.fn] !== undefined) {
          const b = c.args[1];
          const slot = since[SINCE_FNS[c.fn]];
          if (slot[a.v] === undefined) slot[a.v] = {};
          slot[a.v][b ? src.slice(b.s, b.e) : ''] = true;
        }
      }
    }
  }
  const out = { tags: Object.keys(ytd.tags), codes: Object.keys(ytd.codes), withheld: [] };
  // A window read once (since the fiscal year, the quarter) reaches back before HR OS; a tag read
  // with two windows (since this month, minus since next month) is about the month itself.
  for (const kind of ['tags', 'codes']) for (const k of Object.keys(since[kind])) if (Object.keys(since[kind][k]).length === 1 && out[kind].indexOf(k) < 0) out[kind].push(k);
  for (const s of pack.steps || []) if (s.code && s.kind === 'deduction' && s.stage === 'statutory' && out.codes.indexOf(s.code) < 0 && out.withheld.indexOf(s.code) < 0) out.withheld.push(s.code);
  if (Object.keys(_reads).length > 300) _reads = {};
  _reads[key] = out;
  return out;
}

function humanize(k) {
  const s = String(k).replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The columns of a set of packs (in pack order): figures the calculation reads, then what each pack withheld. */
function columnsOf(packs) {
  const list = packs.slice().sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || (a.code < b.code ? -1 : 1));
  const tagInfo = (tag, own) => {
    for (const pk of [own].concat(list)) for (const t of pk.tags || []) if (t.tag === tag) return { label: t.label || humanize(tag), help: t.help || '' };
    for (const pk of list) for (const s of pk.steps || []) if (s.code && (s.tags || []).indexOf(tag) >= 0 && s.name) return { label: s.name, help: '' };
    return { label: humanize(tag), help: '' };
  };
  const codeInfo = (code, own) => {
    for (const pk of [own].concat(list)) for (const s of (pk.steps || []).concat(pk.year_end_steps || [])) if (s.code === code && s.name) return { label: s.name, help: s.explain || '', tags: s.tags || [] };
    return { label: humanize(code), help: '', tags: [] };
  };
  const tagsRead = {};
  for (const pk of list) for (const t of historyReads(pk).tags) tagsRead[t] = true;
  const out = [];
  const seen = {};
  const add = (pk, key, kind, info, use) => {
    if (seen[key]) return;
    seen[key] = true;
    out.push({ key: key, kind: kind, label: info.label, help: info.help, pack: pk.code, pack_name: pk.name || pk.code, use: use });
  };
  for (const pk of list) {
    const r = historyReads(pk);
    for (const t of r.tags) add(pk, t, 'tag', tagInfo(t, pk), 'calc');
    for (const c of r.codes) add(pk, c, 'code', codeInfo(c, pk), 'calc');
    for (const c of r.withheld) {
      const info = codeInfo(c, pk);
      // A deduction already counted by a tag column (Japan's premiums under jp_si_employee) is not asked twice.
      if (info.tags.some((t) => tagsRead[t] === true)) continue;
      add(pk, c, 'code', info, 'withheld');
    }
  }
  return out;
}

/** Active pack bodies in force for a run (versions by each pack's date basis). */
function packsOn(app, codes, runIn) {
  const slot = L('lib_payroll').packRows(app, codes);
  const cands = [];
  for (const c of codes) if (slot[c]) for (const b of slot[c].active) cands.push(b);
  return L('lib_engine').pickVersions(cands, runIn);
}

/* ------------------------------------------------- when openings matter */

/**
 * The first day HR OS pays for an entity, while opening balances matter for
 * this run: the entity has no locked regular run yet, or a go-live day (the
 * first pay day in HR OS) is set. '' when they do not matter.
 */
function startOf(app, entityId, goLive, run) {
  const util = u();
  if (run.kind === 'correction' || run.kind === 'reimbursement') return '';
  if (goLive !== '' && run.pay_date < goLive) return '';
  if (goLive === '') {
    const locked = util.count(app, "SELECT COUNT(*) AS n FROM payruns WHERE entity = {:e} AND kind = 'regular' AND status IN ('locked', 'paid') AND id != {:r}", { e: entityId, r: run.id || '' });
    if (locked > 0) return '';
  }
  const first = util.one(app, "SELECT COALESCE(MIN(period_start), '') AS d FROM payruns WHERE entity = {:e} AND kind = 'regular' AND status != 'void' AND pay_date >= {:g}", { d: '' }, { e: entityId, g: goLive });
  let d = first !== null && first.d !== '' ? first.d : run.period_start;
  if (goLive === '' && run.period_start < d) d = run.period_start;
  return d;
}

/**
 * Does this payslip need opening balances? The packs in it that read earlier
 * pay over a tax year that started before HR OS while the person was
 * employed. `days` are the days of the employment's opening balances up to
 * the run's pay day: one in that tax year covers it.
 */
function needOf(from, packs, runIn, start, end, days) {
  if (!from || start >= from) return null;
  const eng = L('lib_engine');
  const hits = [];
  let tyStart = '';
  for (const pk of packs) {
    const r = historyReads(pk);
    if (r.tags.length + r.codes.length === 0) continue;
    const ty = eng.taxYearOf(pk, eng.basisDay(pk, runIn) || runIn.pay_date);
    if (ty.start >= from) continue;
    if (end && end < ty.start) continue;
    hits.push(pk.code);
    if (tyStart === '' || ty.start < tyStart) tyStart = ty.start;
  }
  if (hits.length === 0) return null;
  const covered = (days || []).some((d) => d >= tyStart);
  return { from: from, packs: hits, tax_year_start: tyStart, covered: covered };
}

/** Profile values the entity's confirmation sets (only fields the packs in the calculation declare). */
function confirmedProfile(packs, profile) {
  const out = {};
  for (const pk of packs) for (const f of pk.profile_fields || []) if (NO_EARLIER_PAY_FIELDS.indexOf(f.key) >= 0 && (f.scope || 'employee') === 'employee' && profile[f.key] !== true) out[f.key] = true;
  return out;
}

/* ---------------------------------------------------------- the screen */

/** The basis of the sheet: the run asked about, else the entity's first open regular run, else its next period. */
function basisOf(app, ent, st, run) {
  const util = u();
  const pr = L('lib_payroll');
  const goLive = st.go_live_day;
  if (run !== null) {
    const r = { id: run.id, kind: run.getString('kind'), period_start: run.getString('period_start'), period_end: run.getString('period_end'), pay_date: run.getString('pay_date') };
    const from = startOf(app, ent.id, goLive, r);
    if (from !== '') return { from: from, run: r, required: true };
  }
  const lockedRegular = util.count(app, "SELECT COUNT(*) AS n FROM payruns WHERE entity = {:e} AND kind = 'regular' AND status IN ('locked', 'paid')", { e: ent.id });
  const open = util.findMany(app, 'payruns', "entity = {:e} && kind = 'regular' && status != 'void' && pay_date >= {:g}", 'period_start', 1, { e: ent.id, g: goLive });
  if (open.length > 0 && (goLive !== '' || lockedRegular === 0)) {
    const o = open[0];
    const r = { id: o.id, kind: 'regular', period_start: o.getString('period_start'), period_end: o.getString('period_end'), pay_date: o.getString('pay_date') };
    return { from: startOf(app, ent.id, goLive, r) || r.period_start, run: r, required: true };
  }
  const sched = util.byId(app, 'pay_schedules', ent.getString('default_pay_schedule')) || util.findOne(app, 'pay_schedules', 'entity = {:e} && active = true', { e: ent.id });
  if (lockedRegular === 0 || goLive !== '') {
    let period = null;
    if (sched !== null) {
      const s = pr.schedObj(sched);
      period = goLive !== '' ? pr.periodContaining(s, goLive) : null;
      const info = period !== null ? pr.periodInfo(app, ent, sched, period, {}) : pr.nextPeriod(app, sched);
      return { from: info.period_start, run: { id: '', kind: 'regular', period_start: info.period_start, period_end: info.period_end, pay_date: info.pay_date }, required: true };
    }
    const d = goLive !== '' ? goLive : util.today(app, ent.id);
    return { from: d, run: { id: '', kind: 'regular', period_start: d, period_end: d, pay_date: d }, required: true };
  }
  // HR OS already locked a regular run and no go-live day is set: openings no longer stop a run.
  const first = util.findMany(app, 'payruns', "entity = {:e} && kind = 'regular' && (status = 'locked' || status = 'paid')", 'period_start', 1, { e: ent.id })[0];
  const r = { id: first.id, kind: 'regular', period_start: first.getString('period_start'), period_end: first.getString('period_end'), pay_date: first.getString('pay_date') };
  return { from: r.period_start, run: r, required: false };
}

function runInOf(b, frequency) {
  return { kind: b.run.kind || 'regular', period_start: b.run.period_start, period_end: b.run.period_end, pay_date: b.run.pay_date, frequency: frequency || 'monthly', periods_per_year: 12, days_in_period: 30, working_days_in_period: 21, worked_days: 21, year_end: false };
}

/** The pack codes of an employment on a day: the tax profile's, else the entity's. */
function codesOf(app, ent, employmentId, day) {
  const util = u();
  const tax = L('lib_people').rowOn(app, 'tax_profiles', employmentId, day);
  const list = tax !== null ? util.jsonOf(tax, 'packs', []) || [] : [];
  return list.length > 0 ? list : util.jsonOf(ent, 'packs', []) || [];
}

/** Everything the sheet shows and checks, for an entity. */
function sheetData(app, ent, st, run) {
  const util = u();
  const people = L('lib_people');
  const money = L('lib_money');
  const cur = ent.getString('currency');
  const b = basisOf(app, ent, st, run);
  const from = b.from;
  const openingDay = util.dayAdd(from, -1);
  const runIn = runInOf(b);
  const packCache = {};
  const rows = [];
  const allPacks = {};
  const candidates = people.activeEmployments(app, { entity: ent.id, from: util.dayAdd(from, -400), to: openingDay });
  for (const m of candidates) {
    if (m.start_day >= from) continue;
    const codes = codesOf(app, ent, m.id, from);
    const key = codes.slice().sort().join(',');
    if (packCache[key] === undefined) packCache[key] = packsOn(app, codes, runIn);
    const packs = packCache[key];
    const ops = util.findMany(app, 'ytd_openings', 'employment = {:e} && day <= {:t}', '-day', 0, { e: m.id, t: b.run.pay_date > openingDay ? b.run.pay_date : openingDay });
    const need = needOf(from, packs, runIn, m.start_day, m.end_day, ops.map((o) => o.getString('day')));
    if (need === null) continue;
    const inYear = ops.filter((o) => o.getString('day') >= need.tax_year_start && (o.getString('currency') === '' || o.getString('currency') === cur));
    const op = inYear.find((o) => o.getString('day') === openingDay) || inYear[0] || null;
    const mine = packs.filter((pk) => need.packs.indexOf(pk.code) >= 0);
    for (const pk of mine) allPacks[pk.code + '@' + pk.version] = pk;
    const keys = columnsOf(mine).map((c) => c.key);
    const values = {};
    if (op !== null) {
      const byTag = util.jsonOf(op, 'by_tag', {}) || {};
      const byCode = util.jsonOf(op, 'by_code', {}) || {};
      for (const k of Object.keys(byTag)) values[k] = money.majorToMinor(Number(byTag[k]) || 0, cur);
      for (const k of Object.keys(byCode)) values[k] = money.majorToMinor(Number(byCode[k]) || 0, cur);
    }
    rows.push({
      employment: m.id,
      number: m.employee_number,
      name: m.name,
      start_day: m.start_day,
      end_day: m.end_day,
      tax_year_start: need.tax_year_start,
      packs: need.packs,
      columns: keys,
      opening: op === null ? null : { id: op.id, day: op.getString('day'), source: op.getString('source'), note: op.getString('note'), values_minor: values },
      status: op !== null ? 'done' : st.no_earlier_pay ? 'confirmed' : 'needed',
    });
  }
  const columns = columnsOf(Object.keys(allPacks).map((k) => allPacks[k]));
  return { basis: b, from: from, opening_day: openingDay, columns: columns, people: rows, currency: cur };
}

function confirmedView(app, rec) {
  const util = u();
  const by = rec.getString('no_earlier_pay_by');
  const mem = by !== '' ? util.byId(app, 'members', by) : null;
  return { on: rec.getBool('no_earlier_pay'), by_name: mem !== null ? mem.getString('name') : '', at: rec.getString('no_earlier_pay_at') };
}

function runParam(ctx, p) {
  const ref = u().str(p, 'payrun', '');
  return ref === '' ? null : L('lib_payroll_runs').runRef(ctx.app, ref);
}

/** ytd.sheet: the people who need opening balances before HR OS's first pay run, with the columns their packs read. */
function sheet(ctx, p) {
  const app = ctx.app;
  const pr = L('lib_payroll');
  const run = runParam(ctx, p);
  const ent = run !== null ? app.findRecordById('entities', run.getString('entity')) : pr.entityParam(ctx, p, true);
  pr.need(ctx, 'view', ent.id);
  const rec = pr.ensureSettings(app, ent);
  const st = pr.settingsView(app, rec, ent);
  const d = sheetData(app, ent, st, run);
  const needed = d.people.filter((x) => x.status === 'needed').length;
  return {
    entity: { id: ent.id, name: ent.getString('name'), country: ent.getString('country'), currency: d.currency },
    go_live_day: st.go_live_day,
    from: d.from,
    opening_day: d.opening_day,
    required: d.basis.required,
    payrun: run !== null ? { id: run.id, number: run.getString('number'), label: run.getString('label'), status: run.getString('status'), kind: run.getString('kind'), period_start: run.getString('period_start'), period_end: run.getString('period_end') } : null,
    confirmed: confirmedView(app, rec),
    columns: d.columns,
    people: d.people,
    needed: d.basis.required && !st.no_earlier_pay ? needed : 0,
    can: { edit: pr.canPayroll(ctx, 'full', ent.id), confirm: pr.canPayroll(ctx, 'full', ent.id) && !ctx.isAgent },
  };
}

/** Amount text (major units, thousands separators allowed) to minor units, or null when not a number. */
function amountMinor(v, cur) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[\s,]/g, '');
  if (s === '') return null;
  return L('lib_money').toMinor(s, cur, true);
}

/**
 * Write one person's opening figures (minor units by column key; null removes
 * one), merged into their opening balance of this tax year, dated the day
 * before HR OS's first pay period. Returns the opening record.
 */
function writeOpening(ctx, app, d, row, valuesMinor, source, note) {
  const util = u();
  const money = L('lib_money');
  const cur = d.currency;
  const byKey = {};
  for (const c of d.columns) byKey[c.key] = c;
  let rec = row.opening !== null ? app.findRecordById('ytd_openings', row.opening.id) : util.newRecord(app, 'ytd_openings');
  const byTag = rec.id ? util.jsonOf(rec, 'by_tag', {}) || {} : {};
  const byCode = rec.id ? util.jsonOf(rec, 'by_code', {}) || {} : {};
  for (const k of Object.keys(valuesMinor)) {
    const c = byKey[k];
    const target = c.kind === 'tag' ? byTag : byCode;
    if (valuesMinor[k] === null) delete target[k];
    else target[k] = money.toMajor(valuesMinor[k], cur);
  }
  rec.set('employment', row.employment);
  if (!rec.id) rec.set('day', d.opening_day);
  rec.set('currency', cur);
  rec.set('by_tag', byTag);
  rec.set('by_code', byCode);
  rec.set('source', source || 'migration');
  if (note !== undefined) rec.set('note', util.clip(note, 1000));
  rec.set('created_by', ctx.memberId || '');
  app.save(rec);
  return rec;
}

/** Check a values object ({ key: amount }) against a person's columns: { minor, problems }. */
function checkValues(d, row, values) {
  const out = {};
  const problems = [];
  const byKey = {};
  for (const c of d.columns) byKey[c.key] = c;
  for (const k of Object.keys(values || {})) {
    const c = byKey[k] || d.columns.find((x) => x.key.toLowerCase() === String(k).toLowerCase() || x.label.toLowerCase() === String(k).toLowerCase());
    if (c === undefined || row.columns.indexOf(c.key) < 0) {
      problems.push({ column: k, message: 'No figure "' + k + '" for ' + row.name + '. Figures: ' + row.columns.join(', ') });
      continue;
    }
    const raw = values[k];
    if (raw === null || raw === '') {
      out[c.key] = null;
      continue;
    }
    const mi = amountMinor(typeof raw === 'number' ? String(raw) : raw, d.currency);
    if (mi === null) problems.push({ column: c.key, message: c.label + ' must be an amount in ' + d.currency + ' (for example 12345.67), not "' + raw + '".' });
    else out[c.key] = mi;
  }
  return { minor: out, problems: problems };
}

function rowFor(app, d, ref) {
  const util = u();
  const m = L('lib_people').employmentRef(app, ref);
  const row = d.people.find((x) => x.employment === m.id);
  if (row === undefined) throw util.fail(400, 'No opening balance is asked for ' + L('lib_people').displayName(app.findRecordById('employees', m.getString('employee'))) + ': they started on or after HR OS\'s first pay period, or no pack reads earlier pay.', 'not_needed', { param: 'employment' });
  return row;
}

function stale(ctx, app, employmentId) {
  L('lib_payroll_runs').staleFor(app, ctx, employmentId, 'Opening balances changed.', '');
}

/** ytd.sheet-save: one person's opening figures (by column key, major units; empty removes one). */
function sheetSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  const pr = L('lib_payroll');
  const run = runParam(ctx, p);
  const m0 = L('lib_people').employmentRef(app, util.req(p, 'employment'));
  const ent = app.findRecordById('entities', m0.getString('entity'));
  pr.need(ctx, 'full', ent.id, 'set opening balances');
  const st = pr.settingsView(app, pr.ensureSettings(app, ent), ent);
  const d = sheetData(app, ent, st, run !== null && run.getString('entity') === ent.id ? run : null);
  const row = rowFor(app, d, m0.id);
  const values = util.obj(p, 'values') || {};
  if (Object.keys(values).length === 0) throw util.fail(400, 'Give at least one figure.', 'missing_param', { param: 'values' });
  const chk = checkValues(d, row, values);
  if (chk.problems.length > 0) throw util.fail(400, chk.problems[0].message, 'invalid_param', { param: 'values', problems: chk.problems });
  const before = row.opening !== null ? row.opening.values_minor : {};
  let rec = null;
  app.runInTransaction((tx) => {
    rec = writeOpening(ctx, tx, d, row, chk.minor, row.opening !== null ? row.opening.source : 'migration', util.has(p, 'note') ? util.text(p, 'note', 1000, '') : undefined);
    stale(ctx, tx, row.employment);
  });
  L('lib_audit').note(ctx, { collection: 'ytd_openings', record: rec.id, summary: 'Saved opening year to date figures for ' + row.name + ' (to ' + d.opening_day + ')', before: before, after: chk.minor });
  return { opening: { id: rec.id, day: rec.getString('day') }, employment: row.employment };
}

/** sheet-save proposals: who and which figures. */
function previewSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  const m = L('lib_people').employmentRef(app, util.req(p, 'employment'));
  const name = L('lib_people').displayName(app.findRecordById('employees', m.getString('employee')));
  const values = util.obj(p, 'values') || {};
  return { label: 'Opening balances for ' + name, target: 'employments:' + m.id, fields: Object.keys(values).map((k) => ({ name: k, before: '', after: values[k] === null ? '' : String(values[k]) })), notes: ['Year to date figures from before HR OS, dated the day before its first pay period.'], risk: 'medium' };
}

/** A CSV of opening figures checked against the sheet: one row per person, columns employee and the figure keys or labels. */
function importPlan(ctx, p) {
  const util = u();
  const app = ctx.app;
  const pr = L('lib_payroll');
  const run = runParam(ctx, p);
  const ent = run !== null ? app.findRecordById('entities', run.getString('entity')) : pr.entityParam(ctx, p, true);
  pr.need(ctx, 'view', ent.id);
  const st = pr.settingsView(app, pr.ensureSettings(app, ent), ent);
  const d = sheetData(app, ent, st, run);
  const text = L('lib_files').csvInput(ctx, p, 'file', 'csv');
  const parsed = util.csvObjects(text);
  const problems = [];
  const keyOf = {};
  for (const h of parsed.header) {
    if (h === 'employee' || h === 'name' || h === 'number') continue;
    const c = d.columns.find((x) => x.key.toLowerCase() === h || x.label.toLowerCase() === h);
    if (c === undefined) problems.push({ row: 1, column: h, message: 'Unknown column "' + h + '". Columns: employee, ' + d.columns.map((x) => x.key).join(', ') });
    else keyOf[h] = c.key;
  }
  if (parsed.header.indexOf('employee') < 0) problems.push({ row: 1, message: 'The column employee (number, work email or name) is required.' });
  if (parsed.items.length > MAX_ROWS) problems.push({ row: 0, message: 'At most ' + MAX_ROWS + ' rows at a time.' });
  const rows = [];
  if (problems.length === 0) {
    const seen = {};
    parsed.items.forEach((it, i) => {
      const line = i + 2;
      if (Object.keys(it).every((k) => it[k] === '')) return;
      try {
        const row = rowFor(app, d, it.employee);
        if (seen[row.employment]) throw util.fail(400, row.name + ' is on more than one row.', 'duplicate');
        seen[row.employment] = true;
        const vals = {};
        for (const h of Object.keys(keyOf)) if (it[h] !== '' && row.columns.indexOf(keyOf[h]) >= 0) vals[keyOf[h]] = it[h];
        const chk = checkValues(d, row, vals);
        for (const x of chk.problems) problems.push({ row: line, column: x.column, message: x.message });
        if (chk.problems.length === 0) rows.push({ row: line, employment: row.employment, number: row.number, name: row.name, values_minor: chk.minor, replaces: row.opening !== null });
      } catch (err) {
        problems.push({ row: line, message: String((err && err.message) || err) });
      }
    });
  }
  return { ent: ent, d: d, rows: rows, problems: problems, ok: problems.length === 0 && rows.length > 0 };
}

/** ytd.import-check: a dry run of a CSV of opening figures (nothing changes). */
function importCheck(ctx, p) {
  const plan = importPlan(ctx, p);
  return { entity: plan.ent.id, opening_day: plan.d.opening_day, currency: plan.d.currency, columns: plan.d.columns.map((c) => c.key), rows: plan.rows, problems: plan.problems, ok: plan.ok, would_save: plan.ok ? plan.rows.length : 0 };
}

/** ytd.import: save every row of a checked CSV (all rows or none), merged into each person's opening balance. */
function importCommit(ctx, p) {
  const util = u();
  const app = ctx.app;
  const plan = importPlan(ctx, p);
  L('lib_payroll').need(ctx, 'full', plan.ent.id, 'set opening balances');
  if (!plan.ok) throw util.fail(400, 'The CSV has problems (' + plan.problems.length + '); nothing was saved. Run ytd.import-check.', 'import_problems', { problems: plan.problems.slice(0, 50) });
  app.runInTransaction((tx) => {
    for (const r of plan.rows) {
      const row = plan.d.people.find((x) => x.employment === r.employment);
      writeOpening(ctx, tx, plan.d, row, r.values_minor, 'migration', 'Imported from a spreadsheet');
      stale(ctx, tx, r.employment);
    }
  });
  L('lib_audit').note(ctx, { collection: 'ytd_openings', summary: 'Imported opening year to date figures for ' + plan.rows.length + ' people of ' + plan.ent.getString('name') + ' (to ' + plan.d.opening_day + ')' });
  return { saved: plan.rows.length, opening_day: plan.d.opening_day };
}

/** ytd.import proposals: how many people and figures. */
function previewImport(ctx, p) {
  const plan = importPlan(ctx, p);
  return { label: 'Opening balances for ' + plan.rows.length + ' people of ' + plan.ent.getString('name') + ' from a spreadsheet', target: 'entities:' + plan.ent.id, fields: plan.rows.slice(0, 20).map((r) => ({ name: r.name, before: r.replaces ? 'has figures' : '', after: Object.keys(r.values_minor).length + ' figures' })), notes: plan.problems.slice(0, 5).map((x) => 'Row ' + x.row + ': ' + x.message), risk: plan.ok ? 'medium' : 'high' };
}

/** ytd.no-earlier-pay: a person confirms (or withdraws) that nobody of the entity was paid earlier this tax year. */
function noEarlierPay(ctx, p) {
  const util = u();
  const app = ctx.app;
  const pr = L('lib_payroll');
  if (ctx.isAgent) throw util.fail(403, 'Only a person confirms that nothing was paid earlier this tax year.', 'not_permitted');
  const ent = pr.entityParam(ctx, p, true);
  pr.need(ctx, 'full', ent.id, 'confirm earlier pay');
  if (!util.has(p, 'on')) throw util.fail(400, 'Say on (true) or off (false).', 'missing_param', { param: 'on' });
  const on = util.bool(p, 'on', false);
  const rec = pr.ensureSettings(app, ent);
  const before = confirmedView(app, rec);
  app.runInTransaction((tx) => {
    const r = tx.findRecordById('payroll_settings', rec.id);
    r.set('no_earlier_pay', on);
    r.set('no_earlier_pay_by', on ? ctx.memberId || '' : '');
    r.set('no_earlier_pay_at', on ? util.nowIso() : '');
    tx.save(r);
    // Open runs of the entity calculate again with the answer.
    for (const x of util.rows(tx, "SELECT id FROM payruns WHERE entity = {:e} AND status IN ('calculated', 'approved')", { id: '' }, { e: ent.id })) {
      const run = tx.findRecordById('payruns', x.id);
      if (run.getString('approval') !== '') L('lib_payroll_runs').cancelApproval(tx, ctx, run, 'Earlier pay was confirmed for the entity.');
      run.set('status', 'draft');
      tx.save(run);
    }
  });
  const after = confirmedView(app, app.findRecordById('payroll_settings', rec.id));
  L('lib_audit').note(ctx, { collection: 'payroll_settings', record: rec.id, summary: (on ? 'Confirmed that nobody of ' : 'Withdrew the confirmation that nobody of ') + ent.getString('name') + ' was paid earlier this tax year', before: before, after: after });
  return { entity: ent.id, confirmed: after };
}

module.exports = {
  NO_EARLIER_PAY_FIELDS: NO_EARLIER_PAY_FIELDS,
  historyReads: historyReads,
  columnsOf: columnsOf,
  packsOn: packsOn,
  startOf: startOf,
  needOf: needOf,
  confirmedProfile: confirmedProfile,
  sheet: sheet,
  sheetSave: sheetSave,
  previewSave: previewSave,
  importCheck: importCheck,
  importCommit: importCommit,
  previewImport: previewImport,
  noEarlierPay: noEarlierPay,
};
