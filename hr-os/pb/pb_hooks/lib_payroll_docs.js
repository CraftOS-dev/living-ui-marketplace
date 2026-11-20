/// <reference path="../pb_data/types.d.ts" />
/**
 * Year-end documents from locked pay runs only: US W-2 and W-3 data, Japan
 * 源泉徴収票 and 給与支払報告書 data, Singapore IR8A, India Form 16 Part B
 * and 24Q annexure data, Malaysia EA and CP8D, UK P60, P45 and P11D, and
 * Australia's income statement (payment summary) data.
 *
 * Each document is data: boxes that add (plus) and take away (minus) the
 * locked lines of the tax year by line code or component tag. `compute`
 * is pure; the ops read the lines, render rows for the print pages and the
 * CSV exports, and issue snapshots to employees (hashed, PIN).
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}

const T = (tag) => ({ tag: tag });
const C = (code) => ({ code: code });

const DOCS = {
  w2: {
    code: 'w2', country: 'US', name: 'Form W-2 data', year_start: '01-01', per: 'employee', form: 'W-2', ids: ['ssn', 'itin'],
    boxes: [
      { key: '1', label: 'Wages, tips, other compensation', plus: [T('us_fit_wages')], minus: [T('us_pretax_401k'), T('us_pretax_125'), T('us_pretax_hsa')] },
      { key: '2', label: 'Federal income tax withheld', plus: [C('US_FIT'), C('US_FIT_SUPP')] },
      { key: '3', label: 'Social security wages', plus: [T('us_fica_wages')], minus: [T('us_pretax_125'), T('us_pretax_hsa')], cap: { 2026: 18450000 } },
      { key: '4', label: 'Social security tax withheld', plus: [C('US_SS_EE')] },
      { key: '5', label: 'Medicare wages and tips', plus: [T('us_fica_wages')], minus: [T('us_pretax_125'), T('us_pretax_hsa')] },
      { key: '6', label: 'Medicare tax withheld', plus: [C('US_MED_EE'), C('US_MED_ADD')] },
      { key: '12D', label: 'Box 12 D: elective deferrals to a 401(k)', plus: [T('us_pretax_401k')] },
      { key: '12W', label: 'Box 12 W: HSA contributions through a cafeteria plan', plus: [T('us_pretax_hsa')] },
      { key: '12AA', label: 'Box 12 AA: designated Roth 401(k) contributions', plus: [C('US_ROTH_401K')] },
    ],
    state: true,
    note: 'Box 3 stops at the social security wage base of the year. State and local lines (boxes 14 to 20) are listed by state pack.',
  },
  w3: { code: 'w3', country: 'US', name: 'Form W-3 transmittal data', year_start: '01-01', per: 'entity', of: 'w2', form: 'W-3' },
  p60: {
    code: 'p60', country: 'GB', name: 'P60 end of year certificate data', year_start: '04-06', per: 'employee', form: 'P60', ids: ['nino'], profile: ['gb_tax_code', 'gb_ni_category'],
    boxes: [
      { key: 'pay', label: 'Pay in this employment', plus: [{ code: 'GB_PAYE_PAY', info: true }] },
      { key: 'tax', label: 'Tax deducted in this employment', plus: [C('GB_PAYE')] },
      { key: 'ni_ee', label: 'Employee National Insurance contributions', plus: [C('GB_NI_EE')] },
      { key: 'student_loan', label: 'Student loan deductions', plus: [C('GB_STUDENT_LOAN')] },
      { key: 'pg_loan', label: 'Postgraduate loan deductions', plus: [C('GB_PG_LOAN')] },
      { key: 'pension_ee', label: 'Employee pension contributions', plus: [C('GB_PENSION_EE'), C('GB_PENSION_EE_RAS')] },
    ],
  },
  p45: { code: 'p45', country: 'GB', name: 'P45 leaver data', year_start: '04-06', per: 'employee', form: 'P45', leavers: true, ids: ['nino'], profile: ['gb_tax_code'], same_as: 'p60' },
  p11d: {
    code: 'p11d', country: 'GB', name: 'P11D benefits data (payrolled benefits)', year_start: '04-06', per: 'employee', form: 'P11D', ids: ['nino'],
    boxes: [{ key: 'pbik', label: 'Benefits in kind processed through payroll', plus: [T('gb_pbik')] }],
  },
  jp_gensen_choshu_hyo: {
    code: 'jp_gensen_choshu_hyo', country: 'JP', name: '給与所得の源泉徴収票 data', year_start: '01-01', per: 'employee', form: '源泉徴収票', ids: [],
    boxes: [
      { key: 'shiharai', label: '支払金額', plus: [T('jp_taxable')] },
      { key: 'gensen', label: '源泉徴収税額', plus: [C('JP_WHT'), C('JP_YEA_TAX')], minus: [C('JP_YEA_REFUND')] },
      { key: 'shakai', label: '社会保険料等の金額', plus: [T('jp_si_employee')] },
      { key: 'yea_tax', label: '年末調整 不足額', plus: [C('JP_YEA_TAX')] },
      { key: 'yea_refund', label: '年末調整 還付額', plus: [C('JP_YEA_REFUND')] },
    ],
    yea: true,
    note: '給与所得控除後の金額 and 所得控除の額の合計額 come from the 年末調整 worksheet; 年末調整 shows whether it ran in this year.',
  },
  jp_kyuyo_shiharai_hokokusho: { code: 'jp_kyuyo_shiharai_hokokusho', country: 'JP', name: '給与支払報告書 data', year_start: '01-01', per: 'employee', form: '給与支払報告書', same_as: 'jp_gensen_choshu_hyo', group: 'municipality' },
  sg_ir8a: {
    code: 'sg_ir8a', country: 'SG', name: 'Form IR8A data', year_start: '01-01', per: 'employee', form: 'IR8A', ids: ['nric', 'fin'],
    boxes: [
      { key: 'salary', label: '(a) Gross salary, fees, leave pay, wages and overtime', plus: [T('sg_ow')] },
      { key: 'bonus', label: '(b) Bonus', plus: [T('sg_aw')] },
      { key: 'total', label: 'Total (a + b)', sum: ['salary', 'bonus'] },
      { key: 'cpf_ee', label: 'Employee compulsory CPF contributions', plus: [C('SG_CPF_EE')] },
      { key: 'cpf_er', label: 'Employer CPF contributions (for reference)', plus: [C('SG_CPF_ER')] },
      { key: 'donations', label: 'Donations deducted (CDAC, ECF, MBMF, SINDA)', plus: [C('SG_SHG')] },
    ],
  },
  in_form16: {
    code: 'in_form16', country: 'IN', name: 'Form 16 Part B data', year_start: '04-01', per: 'employee', form: 'Form 16 Part B', ids: ['pan'], profile: ['in_regime'],
    boxes: [
      { key: 'gross', label: 'Gross salary', plus: [T('in_salary')] },
      { key: 'hra', label: 'of which house rent allowance', plus: [T('in_hra')] },
      { key: 'pf', label: 'Employee provident fund (and VPF)', plus: [T('in_pf_employee')] },
      { key: 'pt', label: 'Professional tax', plus: [T('in_pt')] },
      { key: 'tds', label: 'Tax deducted at source', plus: [C('IN_TDS')] },
    ],
  },
  in_24q: {
    code: 'in_24q', country: 'IN', name: '24Q annexure data', year_start: '04-01', per: 'employee', form: 'Form 24Q', ids: ['pan'], quarters: true,
    boxes: [
      { key: 'paid', label: 'Amount paid or credited', plus: [T('in_salary')] },
      { key: 'tds', label: 'Tax deducted', plus: [C('IN_TDS')] },
    ],
  },
  my_ea: {
    code: 'my_ea', country: 'MY', name: 'Form EA data', year_start: '01-01', per: 'employee', form: 'EA', ids: ['mykad', 'tin', 'epf_no'],
    boxes: [
      { key: 'gross', label: 'Gross salary, wages and bonus', plus: [T('my_pcb_normal'), T('my_pcb_additional')] },
      { key: 'bonus', label: 'of which bonus and additional remuneration', plus: [T('my_pcb_additional')] },
      { key: 'epf', label: 'EPF employee contributions', plus: [T('my_epf_employee')] },
      { key: 'socso', label: 'SOCSO employee contributions', plus: [C('MY_SOCSO_EE')] },
      { key: 'eis', label: 'EIS employee contributions', plus: [C('MY_EIS_EE')] },
      { key: 'pcb', label: 'Monthly tax deductions (PCB)', plus: [C('MY_PCB')] },
      { key: 'zakat', label: 'Zakat deducted through salary', plus: [T('my_zakat')] },
    ],
  },
  my_cp8d: { code: 'my_cp8d', country: 'MY', name: 'CP8D data', year_start: '01-01', per: 'employee', form: 'CP8D', same_as: 'my_ea', list: true },
  au_payment_summary: {
    code: 'au_payment_summary', country: 'AU', name: 'Income statement data (STP finalisation)', year_start: '07-01', per: 'employee', form: 'Income statement', ids: ['tfn'],
    boxes: [
      { key: 'gross', label: 'Gross payments', plus: [T('au_paygw_pay')] },
      { key: 'tax', label: 'Tax withheld', plus: [C('AU_PAYGW'), C('AU_STSL')] },
      { key: 'super', label: 'Super guarantee (for reference)', plus: [C('AU_SG')] },
    ],
  },
};

/** The definition with `same_as` boxes filled in. */
function def(code) {
  const d = DOCS[code];
  if (!d) return null;
  const out = Object.assign({}, d);
  if (d.same_as) {
    const base = DOCS[d.same_as];
    out.boxes = base.boxes;
    if (out.ids === undefined) out.ids = base.ids;
    if (out.profile === undefined) out.profile = base.profile;
    if (out.yea === undefined) out.yea = base.yea;
    if (out.note === undefined) out.note = base.note;
  }
  if (d.of) out.boxes = DOCS[d.of].boxes;
  return out;
}

function pad(n) {
  return n < 10 ? '0' + n : String(n);
}

/** The tax year that starts in `year` for a document: { start, end, label }. */
function yearRange(d, year) {
  const ms = d.year_start || '01-01';
  const start = year + '-' + ms;
  const m = Number(ms.slice(0, 2));
  const dd = Number(ms.slice(3, 5));
  let endY = year + 1;
  let endM = m;
  let endD = dd - 1;
  if (endD === 0) {
    endM -= 1;
    if (endM === 0) {
      endM = 12;
      endY -= 1;
    }
    endD = new Date(Date.UTC(endY, endM, 0)).getUTCDate();
  }
  const end = endY + '-' + pad(endM) + '-' + pad(endD);
  return { start: start, end: end, label: ms === '01-01' ? String(year) : year + '-' + pad((year + 1) % 100) };
}

/**
 * Lines (each { employment, code, kind, tags: [], amount, month: 'YYYY-MM' })
 * to per-employment totals { by_code, by_tag, by_tag_info, by_code_month }.
 */
function aggregate(lines) {
  const out = {};
  for (const l of lines) {
    const e = out[l.employment] || (out[l.employment] = { by_code: {}, by_tag: {}, by_tag_info: {}, by_code_info: {}, months: {}, pack_of: {}, kind_of: {} });
    const a = Number(l.amount) || 0;
    if (l.pack) e.pack_of[l.code] = l.pack;
    e.kind_of[l.code] = l.kind;
    if (l.kind === 'info') {
      e.by_code_info[l.code] = (e.by_code_info[l.code] || 0) + a;
      for (const t of l.tags || []) e.by_tag_info[t] = (e.by_tag_info[t] || 0) + a;
    } else {
      e.by_code[l.code] = (e.by_code[l.code] || 0) + a;
      for (const t of l.tags || []) e.by_tag[t] = (e.by_tag[t] || 0) + a;
    }
    const mo = e.months[l.month] || (e.months[l.month] = { by_code: {}, by_tag: {}, by_tag_info: {}, by_code_info: {} });
    if (l.kind === 'info') {
      mo.by_code_info[l.code] = (mo.by_code_info[l.code] || 0) + a;
      for (const t of l.tags || []) mo.by_tag_info[t] = (mo.by_tag_info[t] || 0) + a;
    } else {
      mo.by_code[l.code] = (mo.by_code[l.code] || 0) + a;
      for (const t of l.tags || []) mo.by_tag[t] = (mo.by_tag[t] || 0) + a;
    }
  }
  return out;
}

function pick(sum, sel) {
  if (sel.code) return (sel.info ? sum.by_code_info[sel.code] : sum.by_code[sel.code]) || 0;
  if (sel.tag) return (sel.info ? sum.by_tag_info[sel.tag] : sum.by_tag[sel.tag]) || 0;
  return 0;
}

/** Box values of one employment's totals for a document (minor units). */
function boxes(d, sum, year) {
  const out = {};
  for (const b of d.boxes || []) {
    if (b.sum) continue;
    let v = 0;
    for (const s of b.plus || []) v += pick(sum, s);
    for (const s of b.minus || []) v -= pick(sum, s);
    if (b.cap && b.cap[year] !== undefined) v = Math.min(v, b.cap[year]);
    out[b.key] = v;
  }
  for (const b of d.boxes || []) if (b.sum) out[b.key] = b.sum.reduce((s, k) => s + (out[k] || 0), 0);
  return out;
}

/** Quarter (1 to 4) of a month within a tax year that starts in month `startMonth`. */
function quarterOf(month, startMonth) {
  const m = Number(month.slice(5, 7));
  return Math.floor(((m - startMonth + 12) % 12) / 3) + 1;
}

/** Pure: document rows and totals from aggregated sums ({ employment: sums }). */
function compute(d, sums, year) {
  const rows = [];
  const totals = {};
  for (const b of d.boxes || []) totals[b.key] = 0;
  for (const emp of Object.keys(sums)) {
    const s = sums[emp];
    const row = { employment: emp, boxes: boxes(d, s, year) };
    if (d.quarters) {
      const sm = Number((d.year_start || '04-01').slice(0, 2));
      row.quarters = {};
      for (const mo of Object.keys(s.months)) {
        const q = quarterOf(mo, sm);
        const bx = boxes(d, s.months[mo], year);
        const cur = row.quarters[q] || (row.quarters[q] = {});
        for (const k of Object.keys(bx)) cur[k] = (cur[k] || 0) + bx[k];
      }
    }
    if (d.yea) row.yea_done = (s.by_code.JP_YEA_TAX || 0) !== 0 || (s.by_code.JP_YEA_REFUND || 0) !== 0 || Object.prototype.hasOwnProperty.call(s.by_code, 'JP_YEA_TAX') || Object.prototype.hasOwnProperty.call(s.by_code, 'JP_YEA_REFUND');
    if (d.state) {
      row.state = {};
      // state and local withholding: deduction lines of the state packs (us-ca, us-ny, ...), not federal ones
      for (const code of Object.keys(s.by_code)) {
        const pk = (s.pack_of || {})[code] || '';
        if (pk.indexOf('us-') === 0 && pk !== 'us-federal' && (s.kind_of || {})[code] === 'deduction') row.state[code] = s.by_code[code];
      }
    }
    for (const k of Object.keys(row.boxes)) totals[k] = (totals[k] || 0) + row.boxes[k];
    rows.push(row);
  }
  return { rows: rows, totals: totals };
}

/* ---------------------------------------------------------------- data */

function docsFor(app, entity) {
  const u = L('lib_util');
  const codes = u.jsonOf(entity, 'packs', []) || [];
  const out = [];
  const seen = {};
  for (const code of codes) {
    const r = u.findMany(app, 'rule_packs', 'code = {:c} && (status = "active" || status = "draft")', '-effective_from', 1, { c: code });
    if (r.length === 0) continue;
    const body = u.jsonOf(r[0], 'body', {}) || {};
    for (const doc of body.documents || []) {
      if (!doc || !DOCS[doc.code] || seen[doc.code]) continue;
      seen[doc.code] = true;
      out.push(doc.code);
    }
  }
  return out;
}

/** Locked lines of an entity in a range, grouped by employment, code, kind, tags and month. */
function lockedLines(app, entityId, from, to, employment) {
  const u = L('lib_util');
  const rows = u.rows(
    app,
    "SELECT l.employment AS employment, l.code AS code, l.kind AS kind, MAX(l.pack) AS pack, CAST(COALESCE(l.tags, '[]') AS TEXT) AS tags, substr(s.pay_date, 1, 7) AS month, CAST(COALESCE(SUM(l.amount_minor),0) AS INTEGER) AS amount " +
      "FROM payslip_lines l JOIN payslips s ON s.id = l.payslip JOIN payruns r ON r.id = l.payrun WHERE r.entity = {:e} AND r.status IN ('locked','paid') AND s.status != 'void' AND s.pay_date >= {:f} AND s.pay_date <= {:t}" +
      (employment ? ' AND l.employment = {:m}' : '') +
      ' GROUP BY l.employment, l.code, l.kind, l.tags, month',
    { employment: '', code: '', kind: '', pack: '', tags: '', month: '', amount: 0 },
    { e: entityId, f: from, t: to, m: employment || '' },
  );
  return rows.map((r) => {
    let tags = [];
    try {
      tags = JSON.parse(r.tags || '[]') || [];
    } catch {
      tags = [];
    }
    return { employment: r.employment, code: r.code, kind: r.kind, pack: r.pack, tags: tags, month: r.month, amount: r.amount };
  });
}

function maskedId(app, employeeId, types) {
  const u = L('lib_util');
  for (const t of types || []) {
    const r = u.findOne(app, 'identity_docs', 'employee = {:e} && type = {:t}', { e: employeeId, t: t });
    if (r !== null) return { type: t, masked: r.getString('number_masked') };
  }
  return null;
}

function personOf(app, employmentId, d, range) {
  const u = L('lib_util');
  const em = app.findRecordById('employments', employmentId);
  const emp = app.findRecordById('employees', em.getString('employee'));
  const addr = u.jsonOf(emp, 'address', {}) || {};
  const kana = u.jsonOf(emp, 'kana', {}) || {};
  const out = {
    employment: em.id, employee: emp.id, number: emp.getString('number'), name: L('lib_people').displayName(emp), legal_name: emp.getString('legal_name'),
    kana: [kana.family || '', kana.given || ''].filter((x) => x).join(' '), address: addr, municipality: addr.city || '',
    start_day: em.getString('start_day'), end_day: em.getString('end_day'), id: maskedId(app, emp.id, d.ids),
  };
  if (d.profile && d.profile.length) {
    const tp = u.one(app, 'SELECT id FROM tax_profiles WHERE employment = {:e} AND effective_from <= {:d} ORDER BY effective_from DESC LIMIT 1', { id: '' }, { e: em.id, d: range.end });
    const fields = tp ? u.jsonOf(app.findRecordById('tax_profiles', tp.id), 'fields', {}) || {} : {};
    out.profile = {};
    for (const k of d.profile) out.profile[k] = fields[k] === undefined ? '' : fields[k];
  }
  return out;
}

function employerOf(entity) {
  const u = L('lib_util');
  return { id: entity.id, name: entity.getString('name'), legal_name: entity.getString('legal_name') || entity.getString('name'), country: entity.getString('country'), currency: entity.getString('currency'), address: u.jsonOf(entity, 'address', {}) || {}, tax_ids: u.jsonOf(entity, 'tax_ids', {}) || {}, registration: u.jsonOf(entity, 'registration', {}) || {} };
}

/** The document for an entity and tax year (rows per employee, totals), from locked runs only. */
function build(app, entity, docCode, year, employment) {
  const u = L('lib_util');
  const d = def(docCode);
  if (d === null) throw u.fail(404, 'No year-end document ' + docCode + '.', 'not_found');
  const range = yearRange(d, year);
  const lines = lockedLines(app, entity.id, range.start, range.end, employment);
  const sums = aggregate(lines);
  const res = compute(d, sums, year);
  let rows = res.rows.map((r) => Object.assign(r, { person: personOf(app, r.employment, d, range) }));
  if (d.leavers) rows = rows.filter((r) => r.person.end_day !== '' && r.person.end_day >= range.start && r.person.end_day <= range.end);
  rows.sort((a, b) => a.person.number.localeCompare(b.person.number));
  const totals = {};
  for (const b of d.boxes || []) totals[b.key] = 0;
  for (const r of rows) for (const k of Object.keys(r.boxes)) totals[k] = (totals[k] || 0) + r.boxes[k];
  const open = u.count(app, "SELECT COUNT(*) AS n FROM payruns WHERE entity = {:e} AND status IN ('draft','calculating','calculated','approved') AND pay_date >= {:f} AND pay_date <= {:t}", { e: entity.id, f: range.start, t: range.end });
  const warnings = [];
  if (open > 0) warnings.push({ code: 'open_runs', message: open + ' pay run' + (open === 1 ? ' is' : 's are') + ' not locked yet in this year; their figures are not in the document.' });
  if (d.boxes && d.boxes.some((b) => b.cap && b.cap[year] === undefined)) warnings.push({ code: 'cap_unknown', message: 'The wage base for ' + year + ' is not in HR OS; the capped box shows the uncapped amount.' });
  let groups = null;
  if (d.group === 'municipality') {
    groups = {};
    for (const r of rows) {
      const g = r.person.municipality || '(unknown)';
      const x = groups[g] || (groups[g] = { municipality: g, count: 0, totals: {} });
      x.count += 1;
      for (const k of Object.keys(r.boxes)) x.totals[k] = (x.totals[k] || 0) + r.boxes[k];
    }
    groups = Object.keys(groups).sort().map((k) => groups[k]);
  }
  return {
    doc: { code: d.code, name: d.name, form: d.form, country: d.country, per: d.per, boxes: (d.boxes || []).map((b) => ({ key: b.key, label: b.label })), note: d.note || '', quarters: !!d.quarters, state: !!d.state, yea: !!d.yea, list: !!d.list || d.per === 'entity' },
    year: year, range: range, employer: employerOf(entity), currency: entity.getString('currency'), rows: d.per === 'entity' ? [] : rows, totals: totals, count: rows.length, groups: groups, warnings: warnings,
  };
}

function csvOf(built) {
  const B = L('lib_bankfiles');
  const exp = B.exponentOf(built.currency);
  const keys = built.doc.boxes.map((b) => b.key);
  const head = ['employee_number', 'name', 'legal_name', 'id_type', 'id_masked'].concat(built.doc.boxes.map((b) => b.key + ' ' + b.label));
  if (built.doc.quarters) for (let q = 1; q <= 4; q++) for (const k of keys) head.push('Q' + q + ' ' + k);
  const rows = [head];
  for (const r of built.rows) {
    const line = [r.person.number, r.person.name, r.person.legal_name, r.person.id ? r.person.id.type : '', r.person.id ? r.person.id.masked : ''].concat(keys.map((k) => B.majorText(r.boxes[k] || 0, exp)));
    if (built.doc.quarters) for (let q = 1; q <= 4; q++) for (const k of keys) line.push(B.majorText(((r.quarters || {})[q] || {})[k] || 0, exp));
    rows.push(line);
  }
  rows.push(['', 'Total', '', '', ''].concat(keys.map((k) => B.majorText(built.totals[k] || 0, exp))));
  return L('lib_util').csvText(rows);
}

/* ----------------------------------------------------------------- ops */

/**
 * The tax year asked for, or by default the one people work on: the
 * previous tax year during the five months after it ends (document season),
 * else the current one.
 */
function defaultYear(today, yearStart) {
  const ys = yearStart || '01-01';
  let cy = Number(today.slice(0, 4));
  if (today.slice(5) < ys) cy -= 1;
  const start = cy + '-' + ys;
  const m = Number(ys.slice(0, 2)) + 5;
  const season = (m > 12 ? cy + 1 : cy) + '-' + pad(m > 12 ? m - 12 : m) + '-' + ys.slice(3, 5);
  return today >= start && today < season ? cy - 1 : cy;
}

function yearParam(app, p, entity, docCode) {
  const u = L('lib_util');
  if (u.str(p, 'year', '') !== '') return u.int(p, 'year', 2026, 2000, 2100);
  const d = docCode ? def(docCode) : null;
  return defaultYear(u.today(app, entity.id), d ? d.year_start : '01-01');
}

function overview(ctx, p) {
  const u = L('lib_util');
  const po = L('lib_payroll_out');
  L('lib_auth').need(ctx, 'payroll', 'view');
  po.gatePay(ctx);
  const ents = po.entityIds(ctx, p.entity).map((id) => ctx.app.findRecordById('entities', id));
  const out = [];
  for (const entity of ents) {
    for (const code of docsFor(ctx.app, entity)) {
      const d = def(code);
      const year = u.str(p, 'year', '') !== '' ? u.int(p, 'year', 2026, 2000, 2100) : yearParam(ctx.app, p, entity, code);
      const range = yearRange(d, year);
      const people = u.count(ctx.app, "SELECT COUNT(DISTINCT s.employment) AS n FROM payslips s JOIN payruns r ON r.id = s.payrun WHERE r.entity = {:e} AND r.status IN ('locked','paid') AND s.status != 'void' AND s.pay_date >= {:f} AND s.pay_date <= {:t}", { e: entity.id, f: range.start, t: range.end });
      const locked = u.count(ctx.app, "SELECT COUNT(*) AS n FROM payruns WHERE entity = {:e} AND status IN ('locked','paid') AND pay_date >= {:f} AND pay_date <= {:t}", { e: entity.id, f: range.start, t: range.end });
      const open = u.count(ctx.app, "SELECT COUNT(*) AS n FROM payruns WHERE entity = {:e} AND status IN ('draft','calculating','calculated','approved') AND pay_date >= {:f} AND pay_date <= {:t}", { e: entity.id, f: range.start, t: range.end });
      const issued = u.count(ctx.app, "SELECT COUNT(*) AS n FROM yearend_docs WHERE entity = {:e} AND doc = {:d} AND year = {:y} AND status = 'issued'", { e: entity.id, d: code, y: String(year) });
      out.push({ entity: entity.id, entity_name: entity.getString('name'), country: entity.getString('country'), doc: code, name: d.name, form: d.form, per: d.per, year: year, label: range.label, start: range.start, end: range.end, people: people, locked_runs: locked, open_runs: open, issued: issued });
    }
  }
  return { documents: out };
}

function documentOp(ctx, p) {
  const u = L('lib_util');
  const po = L('lib_payroll_out');
  L('lib_auth').need(ctx, 'payroll', 'view');
  po.gatePay(ctx);
  const entity = po.entityRec(ctx, p.entity);
  const code = u.req(p, 'doc', 'w2');
  if (!def(code)) throw u.fail(404, 'No year-end document ' + code + '. Documents: ' + Object.keys(DOCS).join(', '), 'not_found');
  const year = yearParam(ctx.app, p, entity, code);
  let employment = '';
  if (u.str(p, 'employment', '') !== '') employment = L('lib_people').employmentRef(ctx.app, p.employment).id;
  return build(ctx.app, entity, code, year, employment);
}

function csvOp(ctx, p) {
  L('lib_auth').need(ctx, 'payroll', 'view');
  const built = documentOp(ctx, p);
  L('lib_audit').write(ctx, { op: 'yearend.csv', collection: 'payslip_lines', summary: 'Exported ' + built.doc.name + ' ' + built.range.label + ' as CSV (' + built.count + ' people)' });
  return { filename: built.doc.code + '-' + built.range.label + '.csv', csv: csvOf(built) };
}

/** Issue the document to each employee (a hashed snapshot they can open in self-service). */
function issue(ctx, p) {
  const u = L('lib_util');
  const po = L('lib_payroll_out');
  L('lib_auth').need(ctx, 'payroll', 'full', 'issue year-end documents');
  const built = documentOp(ctx, p);
  if (built.doc.per === 'entity') throw u.fail(409, built.doc.name + ' is an employer summary, not issued to employees.', 'not_issuable');
  if (built.warnings.some((w) => w.code === 'open_runs')) throw u.fail(409, 'Lock or void the open pay runs of this year first; documents come from locked runs only.', 'open_runs');
  const only = u.list(p, 'employments');
  const entity = po.entityRec(ctx, p.entity);
  let n = 0;
  ctx.app.runInTransaction((tx) => {
    for (const r of built.rows) {
      if (only && only.length && only.indexOf(r.employment) < 0 && only.indexOf(r.person.number) < 0) continue;
      const data = { doc: built.doc, year: built.year, range: built.range, employer: built.employer, currency: built.currency, person: r.person, boxes: r.boxes, quarters: r.quarters || null, state: r.state || null, yea_done: r.yea_done === true };
      const text = JSON.stringify(data);
      let rec = u.findOne(tx, 'yearend_docs', 'doc = {:d} && year = {:y} && employment = {:m}', { d: built.doc.code, y: String(built.year), m: r.employment });
      if (rec === null) rec = u.newRecord(tx, 'yearend_docs');
      rec.set('entity', entity.id);
      rec.set('employment', r.employment);
      rec.set('employee', r.person.employee);
      rec.set('doc', built.doc.code);
      rec.set('year', String(built.year));
      rec.set('period_start', built.range.start);
      rec.set('period_end', built.range.end);
      rec.set('data', data);
      rec.set('currency', built.currency);
      rec.set('hash', L('lib_bankfiles').sha256(L('lib_bankfiles').utf8Bytes(text)));
      rec.set('status', 'issued');
      if (ctx.memberId) rec.set('issued_by', ctx.memberId);
      rec.set('issued_at', u.nowIso());
      tx.save(rec);
      n += 1;
      try {
        L('lib_notify').toEmployee(tx, r.person.employee, { kind: 'yearend_doc', title: 'Your ' + built.doc.form + ' for ' + built.range.label + ' is ready', body: built.employer.name, link: '#/print/payroll/year-end/doc/' + rec.id, facts: [{ type: 'range', key: 'period', label: 'Period', from: built.range.start, to: built.range.end }, { type: 'text', key: 'form', label: 'Form', value: built.doc.form }, { type: 'text', key: 'employer', label: 'Employer', value: built.employer.name }] });
      } catch (err) {
        console.error('[hr] year-end notice failed:', err);
      }
    }
  });
  L('lib_audit').note(ctx, { collection: 'yearend_docs', summary: 'Issued ' + built.doc.name + ' ' + built.range.label + ' to ' + n + ' people' });
  return { issued: n, doc: built.doc.code, year: built.year };
}

function withdraw(ctx, p) {
  const u = L('lib_util');
  L('lib_auth').need(ctx, 'payroll', 'full', 'withdraw year-end documents');
  const rec = u.byId(ctx.app, 'yearend_docs', String(p.id || ''));
  if (rec === null) throw u.fail(404, 'No issued document "' + p.id + '".', 'not_found');
  if (!L('lib_auth').inScope(ctx, rec.getString('entity'))) throw u.fail(403, 'That document is outside your access.', 'not_permitted');
  rec.set('status', 'withdrawn');
  ctx.app.save(rec);
  L('lib_audit').note(ctx, { collection: 'yearend_docs', record: rec.id, summary: 'Withdrew ' + rec.getString('doc') + ' ' + rec.getString('year') });
  return { id: rec.id, status: 'withdrawn' };
}

function issuedView(r) {
  return { id: r.id, doc: r.getString('doc'), year: r.getString('year'), entity: r.getString('entity'), employment: r.getString('employment'), employee: r.getString('employee'), status: r.getString('status'), issued_at: r.getString('issued_at'), hash: r.getString('hash'), data: L('lib_payroll_out').jsonField(r, 'data', {}) };
}

/** The caller's own issued year-end documents. */
function mine(ctx) {
  const u = L('lib_util');
  const me = L('lib_auth').selfEmployee(ctx);
  if (me === '') return { documents: [] };
  return { documents: u.findMany(ctx.app, 'yearend_docs', 'employee = {:e} && status = "issued"', '-year,doc', 100, { e: me }).map((r) => {
    const v = issuedView(r);
    return { id: v.id, doc: v.doc, year: v.year, entity: v.entity, issued_at: v.issued_at, name: (v.data.doc || {}).name || v.doc, form: (v.data.doc || {}).form || '', label: (v.data.range || {}).label || v.year, employer: (v.data.employer || {}).name || '' };
  }) };
}

/** One issued document (the person themself, or payroll). */
function viewOp(ctx, p) {
  const u = L('lib_util');
  const rec = u.byId(ctx.app, 'yearend_docs', String(p.id || ''));
  if (rec === null) throw u.fail(404, 'No issued document "' + p.id + '".', 'not_found');
  const self = L('lib_auth').selfEmployee(ctx) === rec.getString('employee');
  if (!self) {
    L('lib_auth').need(ctx, 'payroll', 'view');
    L('lib_payroll_out').gatePay(ctx);
    if (!L('lib_auth').inScope(ctx, rec.getString('entity'))) throw u.fail(403, 'That document is outside your access.', 'not_permitted');
  } else if (rec.getString('status') !== 'issued') throw u.fail(404, 'This document was withdrawn.', 'withdrawn');
  if (self && rec.getString('viewed_at') === '') {
    rec.set('viewed_at', u.nowIso());
    ctx.app.save(rec);
  }
  return { document: issuedView(rec) };
}

function issuedList(ctx, p) {
  const u = L('lib_util');
  const po = L('lib_payroll_out');
  L('lib_auth').need(ctx, 'payroll', 'view');
  const entity = po.entityRec(ctx, p.entity);
  const code = u.req(p, 'doc', 'w2');
  const year = String(u.int(p, 'year', 2026, 2000, 2100));
  return { documents: u.findMany(ctx.app, 'yearend_docs', 'entity = {:e} && doc = {:d} && year = {:y}', 'employment', 2000, { e: entity.id, d: code, y: year }).map((r) => ({ id: r.id, employment: r.getString('employment'), employee: r.getString('employee'), status: r.getString('status'), issued_at: r.getString('issued_at'), viewed_at: r.getString('viewed_at'), hash: r.getString('hash') })) };
}

module.exports = { DOCS: DOCS, def: def, defaultYear: defaultYear, yearRange: yearRange, aggregate: aggregate, boxes: boxes, compute: compute, quarterOf: quarterOf, build: build, csvOf: csvOf, docsFor: docsFor, overview: overview, documentOp: documentOp, csvOp: csvOp, issue: issue, withdraw: withdraw, mine: mine, viewOp: viewOp, issuedList: issuedList };
