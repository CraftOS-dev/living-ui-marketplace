/// <reference path="../pb_data/types.d.ts" />
/**
 * Leave: types, policies, the balance ledger and its engine, and the
 * contracts other modules call (SPEC 3.5):
 *
 *   balance(app, employmentId, typeCode, day)
 *     -> { type, unit, balance, taken, pending, granted, expiring: [{ day, amount }],
 *          name, tracked, booked, available, period: { start, end }, method }
 *   payInputs(app, employmentId, from, to)
 *     -> { unpaid_days, unpaid_hours, paid_days: { <typeCode>: days }, encash: [{ type, days, request }], issues: [{ code, message, severity }] }
 *   profileFacts(ctx, employmentId) -> { balances, on_leave, next, pending }
 *
 * The ledger. A balance is the sum of its leave_ledger rows; nothing stores a
 * balance. Rows a policy implies (grants, monthly accruals, the Japanese
 * grants on each base date, bank holidays taken from the allowance, the
 * period close with its carry-over and the expiry of each lot) are PLANNED:
 * the engine works them out from the policy and the employment, and the
 * daily run writes each one once (by its `key`) when its day arrives, plus a
 * correcting row when a later change moves the number (a cancelled leave
 * before an expiry, a policy version from a past day). People's rows (leave
 * taken, adjustments, cashing in, compensatory grants) are written when they
 * happen. Reads always run the engine, so a balance is right even before
 * the daily run, and the same walk projects any future day.
 *
 * The walk. Credits open lots (a lot may expire); leave taken uses the lot
 * that expires first (carried-over days before this year's, the oldest
 * Japanese grant first); what no lot covers is a negative balance that the
 * next credit pays back. On each day: expiries first, then the period close
 * (every open lot closes; up to the carry-over limit comes back as a new
 * lot that may expire), then credits, then leave taken.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}

/** Days ahead the attention rows and balance views look for days that lapse. */
const ATTENTION_DAYS = 61;

const METHODS = ['fixed', 'monthly_accrual', 'per_hours_worked', 'tenure_table', 'statutory_jp', 'manual', 'none'];
const RULE_KEYS = ['type', 'method', 'amount', 'tenure', 'tenure_unit', 'tenure_at', 'eligible_after_months', 'proration', 'rounding', 'accrual_day', 'per_hours', 'max_balance', 'expiry', 'carryover_max', 'carryover_expiry_months', 'grant_expiry_months', 'scale', 'scale_cap', 'deduct_holidays', 'includes', 'encash_max', 'max_hours_per_year', 'first_after_months', 'obligation', 'note'];
const CREDIT_KINDS = ['grant', 'accrual', 'carryover', 'comp_off'];
// 年次有給休暇: days granted at 0.5, 1.5, 2.5, 3.5, 4.5, 5.5 and 6.5+ years (労働基準法39条; 長野労働局 handbook 2026-02).
const JP_GRANTS = { full: [10, 11, 12, 14, 16, 18, 20], 4: [7, 8, 9, 10, 12, 13, 15], 3: [5, 6, 6, 8, 9, 10, 11], 2: [3, 4, 4, 5, 6, 6, 7], 1: [1, 2, 2, 2, 3, 3, 3] };

/* ------------------------------------------------------------- numbers */

function r2(x) {
  const n = Number(x) || 0;
  const s = n < 0 ? -1 : 1;
  return (s * Math.round(Math.abs(n) * 100 + 1e-7)) / 100;
}

function roundBy(x, mode) {
  if (mode === 'whole') return Math.round(x + 1e-9);
  if (mode === 'half') return Math.round(x * 2 + 1e-9) / 2;
  return r2(x);
}

/* ---------------------------------------------------------------- days */

function monthsBetween(a, b) {
  const y1 = Number(a.slice(0, 4));
  const m1 = Number(a.slice(5, 7));
  const d1 = Number(a.slice(8, 10));
  const y2 = Number(b.slice(0, 4));
  const m2 = Number(b.slice(5, 7));
  const d2 = Number(b.slice(8, 10));
  return (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
}

/** The leave period containing `day` for a period start 'MM-DD': { start, end }. */
function periodOf(periodStart, day) {
  const util = u();
  const ps = /^\d{2}-\d{2}$/.test(periodStart || '') ? periodStart : '01-01';
  let s = day.slice(0, 4) + '-' + ps;
  if (!util.isDay(s)) s = day.slice(0, 4) + '-' + ps.slice(0, 3) + '28';
  if (s > day) s = util.addMonths(s, -12);
  return { start: s, end: util.dayAdd(util.addMonths(s, 12), -1) };
}

// Pure date results, kept per runtime (Goja date arithmetic is slow and these repeat for every person).
const _periods = {};
const _slices = {};
let _memoSize = 0;
function memoFull() {
  _memoSize++;
  if (_memoSize > 20000) {
    for (const k of Object.keys(_periods)) delete _periods[k];
    for (const k of Object.keys(_slices)) delete _slices[k];
    _memoSize = 0;
  }
}

function periodsBetween(periodStart, from, to) {
  const k = periodStart + '|' + from + '|' + to;
  if (_periods[k] === undefined) {
    memoFull();
    _periods[k] = periodsRead(periodStart, from, to);
  }
  return _periods[k];
}

function periodsRead(periodStart, from, to) {
  const util = u();
  const out = [];
  let p = periodOf(periodStart, from);
  for (let i = 0; i < 200 && p.start <= to; i++) {
    out.push(p);
    const n = util.addMonths(p.start, 12);
    p = { start: n, end: util.dayAdd(util.addMonths(n, 12), -1) };
  }
  return out;
}

/** The 12 monthly slices of a period: [{ start, end, mid }]. */
function slices(p) {
  if (_slices[p.start] === undefined) {
    memoFull();
    _slices[p.start] = slicesRead(p);
  }
  return _slices[p.start];
}

function slicesRead(p) {
  const util = u();
  const out = [];
  for (let k = 0; k < 12; k++) {
    const s = util.addMonths(p.start, k);
    const e = util.dayAdd(util.addMonths(p.start, k + 1), -1);
    out.push({ k: k, start: s, end: e, mid: util.dayAdd(s, 14) <= e ? util.dayAdd(s, 14) : e });
  }
  return out;
}

/** How many slices of period p have their 15th day within [from, to]. */
function slicesCovered(p, from, to) {
  let n = 0;
  for (const s of slices(p)) if (s.mid >= from && s.mid <= to) n++;
  return n;
}

/** Months of period p worked by a leaver from `from` to the last day: whole months by their 15th day, the last month by its days. */
function leaverShare(p, from, last) {
  const util = u();
  let n = 0;
  for (const s of slices(p)) {
    if (s.start <= last && s.end > last) {
      const a = s.start > from ? s.start : from;
      if (a <= last) n += (util.daysBetween(a, last) + 1) / (util.daysBetween(s.start, s.end) + 1);
    } else if (s.mid >= from && s.mid <= last) n++;
  }
  return n;
}

/* ------------------------------------------------------- types, rules */

function typeView(r) {
  if (!r) return null;
  return {
    id: r.id,
    code: r.getString('code'),
    name: r.getString('name'),
    entity: r.getString('entity'),
    country: r.getString('country'),
    paid: r.getBool('paid'),
    unit: r.getString('unit') || 'day',
    color: r.getString('color') || 'ink',
    icon: r.getString('icon'),
    allow_half: r.getBool('allow_half'),
    allow_hours: r.getBool('allow_hours'),
    allow_negative: r.getBool('allow_negative'),
    max_negative: r.getFloat('max_negative'),
    attachment_after_days: r.getInt('attachment_after_days'),
    min_notice_days: r.getInt('min_notice_days'),
    max_consecutive_days: r.getInt('max_consecutive_days'),
    counts_holidays: r.getBool('counts_holidays'),
    counts_weekends: r.getBool('counts_weekends'),
    statutory: r.getBool('statutory'),
    gender_specific: r.getString('gender_specific'),
    encashable: r.getBool('encashable'),
    payout_on_exit: r.getBool('payout_on_exit'),
    comp_off: r.getBool('comp_off'),
    visibility: r.getString('visibility') || 'type',
    pay_code: r.getString('pay_code'),
    note: r.getString('note'),
    sort: r.getInt('sort'),
    archived: r.getBool('archived'),
    source: r.getString('source'),
  };
}

/** A session cache for one operation or run (records read once). */
function session(app) {
  return { app: app, types: {}, typeLists: {}, policies: {}, assigns: {}, emps: {}, ents: {}, rows: {}, today: {}, shapes: {}, ftes: {} };
}

function sess(S, app) {
  return S && S.app === app ? S : session(app);
}

function employmentOf(S, id) {
  if (S.emps[id] === undefined) S.emps[id] = u().byId(S.app, 'employments', id);
  return S.emps[id];
}

function entityOf(S, id) {
  if (S.ents[id] === undefined) S.ents[id] = u().byId(S.app, 'entities', id);
  return S.ents[id];
}

function todayOf(S, entityId) {
  if (S.today[entityId] === undefined) S.today[entityId] = u().today(S.app, entityId || undefined);
  return S.today[entityId];
}

/** Active types an entity's people use: the entity's own, then company-wide ones (entity empty). */
function typesFor(S, entityId, withArchived) {
  const k = entityId + (withArchived ? ':all' : '');
  if (S.typeLists[k] === undefined) {
    const rows = u().findMany(S.app, 'leave_types', withArchived ? "(entity = {:e} || entity = '')" : "(entity = {:e} || entity = '') && archived = false", 'sort,name', 0, { e: entityId || '-' });
    const byCode = {};
    for (const r of rows) {
      const c = r.getString('code');
      if (byCode[c] === undefined || r.getString('entity') !== '') byCode[c] = r;
    }
    S.typeLists[k] = Object.keys(byCode)
      .map((c) => byCode[c])
      .sort((a, b) => a.getInt('sort') - b.getInt('sort') || (a.getString('name') < b.getString('name') ? -1 : 1));
    for (const r of rows) S.types[r.id] = r;
  }
  return S.typeLists[k];
}

function typeById(S, id) {
  if (S.types[id] === undefined) S.types[id] = u().byId(S.app, 'leave_types', id);
  return S.types[id];
}

/** A type of the employment's entity by id or code (404 naming the list op). */
function typeRef(S, entityId, ref) {
  const util = u();
  const r = String(ref || '').trim();
  if (r === '') throw util.fail(400, 'Give the leave type (code such as annual, or its id).', 'missing_param', { param: 'type' });
  const byId = typeById(S, r);
  if (byId !== null && (byId.getString('entity') === '' || byId.getString('entity') === entityId)) return byId;
  for (const t of typesFor(S, entityId, true)) if (t.getString('code') === r || t.getString('code') === r.toLowerCase()) return t;
  throw util.fail(404, 'No leave type "' + r + '" for this entity. Run leave.types to see them.', 'not_found', { ref: r });
}

function policyParsed(S, id) {
  if (S.policies[id] === undefined) {
    const r = u().byId(S.app, 'leave_policies', id);
    if (r === null) S.policies[id] = null;
    else {
      const util = u();
      let hist = util.jsonOf(r, 'history', []) || [];
      if (hist.length === 0) hist = [{ from: '', rules: util.jsonOf(r, 'rules', []) || [] }];
      hist = hist.slice().sort((a, b) => (String(a.from || '') < String(b.from || '') ? -1 : 1));
      S.policies[id] = { id: r.id, name: r.getString('name'), entity: r.getString('entity'), period_start: r.getString('period_start') || '01-01', history: hist, rec: r };
    }
  }
  return S.policies[id];
}

/** The rule of a type code in a policy on a day (the policy version in effect that day), or null. */
function ruleOn(pol, code, day) {
  if (!pol) return null;
  let rules = pol.history[0].rules;
  for (const h of pol.history) if (String(h.from || '') <= day) rules = h.rules;
  for (const r of rules || []) if (r && r.type === code) return r;
  return null;
}

/** The employment's policy assignments as segments [{ id, from, to ('' = open), policy }]. */
function segments(S, empRec) {
  const id = empRec.id;
  if (S.assigns[id] === undefined) {
    const util = u();
    const rows = S.assignRows && S.assignRows[id] !== undefined ? S.assignRows[id] : assignmentRows(S.app, [id])[id] || [];
    const start = empRec.getString('start_day');
    const end = empRec.getString('end_day');
    const out = [];
    rows.forEach((r, i) => {
      let from = r.effective_from;
      let to = i + 1 < rows.length ? util.dayAdd(rows[i + 1].effective_from, -1) : '';
      if (from < start) from = start;
      if (end !== '' && (to === '' || to > end)) to = end;
      if (to !== '' && to < from) return;
      out.push({ id: r.id, from: from, to: to, policy: policyParsed(S, r.policy), assigned_from: r.effective_from });
    });
    S.assigns[id] = out;
  }
  return S.assigns[id];
}

/** Policy assignments of employments as plain rows by employment, oldest first (SQL with bound ids, in chunks). */
function assignmentRows(app, ids) {
  const util = u();
  const out = {};
  for (const id of ids) out[id] = [];
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const bind = {};
    const keys = chunk.map((id, j) => ((bind['e' + j] = id), '{:e' + j + '}')).join(',');
    for (const r of util.rows(app, 'SELECT id, employment, policy, effective_from FROM leave_policy_assignments WHERE employment IN (' + keys + ') ORDER BY effective_from', { id: '', employment: '', policy: '', effective_from: '' }, bind)) out[r.employment].push({ id: r.id, policy: r.policy, effective_from: r.effective_from });
  }
  return out;
}

function segmentOn(S, empRec, day) {
  let best = null;
  for (const s of segments(S, empRec)) if (s.from <= day && (s.to === '' || s.to >= day)) best = s;
  return best;
}

/** The rule for a type on a day for an employment (null when the policy has none). */
function ruleFor(S, empRec, code, day) {
  const seg = segmentOn(S, empRec, day);
  return seg ? ruleOn(seg.policy, code, day) : null;
}

function tracked(rule) {
  return rule !== null && rule.method !== 'none';
}

function tenureAmount(rule, startDay, day) {
  const months = monthsBetween(startDay, day);
  const done = rule.tenure_unit === 'months' ? months : Math.floor(months / 12);
  let amt = 0;
  for (const row of rule.tenure || []) if (done >= Number(row.after || 0)) amt = Number(row.amount) || 0;
  return amt;
}

/** Days a week and hours a week on a day from the employment's schedule. */
function weekShape(S, empId, day) {
  const k = empId + '|' + day;
  if (S.shapes && S.shapes[k] !== undefined) return S.shapes[k];
  const out = weekShapeRead(S, empId, day);
  if (S.shapes) S.shapes[k] = out;
  return out;
}

function weekShapeRead(S, empId, day) {
  const sch = L('lib_calendar').scheduleOf(S.app, empId, day);
  if (sch === null) return { days: 5, hours: 40 };
  const dows = {};
  for (const r of sch.week || []) if (L('lib_calendar').rowMinutes(r) > 0) dows[r.dow] = true;
  return { days: Object.keys(dows).length, hours: Number(sch.hours_per_week) || 0 };
}

function fteOn(S, empId, day) {
  const k = empId + '|' + day;
  if (S.ftes && S.ftes[k] !== undefined) return S.ftes[k];
  const job = L('lib_people').rowOn(S.app, 'job_records', empId, day);
  const f = job !== null && job.getFloat('fte') > 0 ? job.getFloat('fte') : 1;
  if (S.ftes) S.ftes[k] = f;
  return f;
}

function scaleOf(S, empId, rule, day) {
  if (rule.scale === 'fte') return fteOn(S, empId, day);
  if (rule.scale === 'days_per_week') return Math.min(7, weekShape(S, empId, day).days) / 5;
  return 1;
}

function jpGrant(S, empId, k, day) {
  const w = weekShape(S, empId, day);
  const i = Math.min(k, 6);
  if (w.hours >= 30 || w.days >= 5) return { amount: JP_GRANTS.full[i], basis: 'full', days: w.days, hours: w.hours };
  const d = Math.max(0, Math.min(4, w.days));
  if (d === 0) return { amount: 0, basis: 'none', days: w.days, hours: w.hours };
  return { amount: JP_GRANTS[d][i], basis: 'proportional', days: w.days, hours: w.hours };
}

/* --------------------------------------------------------------- plan */

/**
 * The planned credits and holiday takes of one type for an employment up to
 * `until`: [{ key, day, kind, amount, expires, phase, note, cap, meta }],
 * plus the period closes [{ key, day, phase: 1, rule }].
 */
function plan(S, empRec, typeRec, until) {
  const util = u();
  const code = typeRec.getString('code');
  const empId = empRec.id;
  const start = empRec.getString('start_day');
  const endDay = empRec.getString('end_day');
  const today = todayOf(S, empRec.getString('entity'));
  const out = [];
  for (const seg of segments(S, empRec)) {
    if (seg.policy === null || seg.from > until) continue;
    const segTo = seg.to === '' ? '9999-12-31' : seg.to;
    const segEnd = segTo < until ? segTo : until;
    const pol = seg.policy;
    const assignEndsEarly = seg.to !== '' && (endDay === '' || seg.to < endDay);
    // Japanese statutory grants on each base date.
    const r0 = ruleOn(pol, code, seg.from);
    const lastRule = ruleOn(pol, code, segEnd);
    if ((r0 && r0.method === 'statutory_jp') || (lastRule && lastRule.method === 'statutory_jp')) {
      for (let k = 0; k < 80; k++) {
        const rr = r0 || lastRule;
        const b = util.addMonths(start, Number(rr.first_after_months === undefined ? 6 : rr.first_after_months) + 12 * k);
        if (b > segEnd) break;
        if (b < seg.from) continue;
        const rule = ruleOn(pol, code, b);
        if (!rule || rule.method !== 'statutory_jp') continue;
        const g = jpGrant(S, empId, k, b);
        if (g.amount <= 0) continue;
        out.push({ key: 'J:' + b, day: b, kind: 'grant', amount: g.amount, expires: util.addMonths(b, Number(rule.grant_expiry_months) || 24), phase: 2, note: 'Granted on the base date (' + (k === 0 ? 'after 6 months' : k + 0.5 + ' years of service') + ', ' + (g.basis === 'full' ? 'full-time table' : g.days + ' days a week') + ')', meta: { jp: true, base: b, deadline: util.dayAdd(util.addMonths(b, 12), -1), granted: g.amount, basis: g.basis, obligation: rule.obligation !== false && g.amount >= 10 } });
      }
      continue;
    }
    for (const P of periodsBetween(pol.period_start, seg.from, segEnd)) {
      const covFrom = P.start > seg.from ? P.start : seg.from;
      const covTo = P.end < segTo ? P.end : segTo;
      const rule = ruleOn(pol, code, covFrom);
      if (P.start > seg.from && P.start <= segEnd && (endDay === '' || P.start <= endDay)) {
        const closing = ruleOn(pol, code, util.dayAdd(P.start, -1));
        if (closing && closing.method !== 'none' && closing.method !== 'statutory_jp' && (closing.expiry || 'period') === 'period') out.push({ key: 'PC:' + P.start, day: P.start, kind: 'expire', phase: 1, rule: closing });
      }
      if (!rule || rule.method === 'none' || rule.method === 'manual' || rule.method === 'statutory_jp') continue;
      const elig = util.addMonths(start, Number(rule.eligible_after_months) || 0);
      const lotExpiry = (day) => ((rule.expiry || 'period') === 'grant' && Number(rule.grant_expiry_months) > 0 ? util.addMonths(day, Number(rule.grant_expiry_months)) : '');
      if (rule.method === 'fixed' || rule.method === 'tenure_table') {
        const grantDay = covFrom > elig ? covFrom : elig;
        if (grantDay > covTo || grantDay > until || (endDay !== '' && grantDay > endDay)) continue;
        const atDay = rule.method === 'tenure_table' ? (rule.tenure_at === 'anniversary' ? grantDay : covFrom) : grantDay;
        const base = rule.method === 'fixed' ? Number(rule.amount) || 0 : tenureAmount(rule, start, atDay);
        const joined = covFrom === start && covFrom > P.start;
        const cutStart = covFrom > P.start && (!joined || rule.proration === 'join');
        // A leaver's year is prorated to the last day like a joiner's (proration 'join' covers joining and leaving).
        const leaves = !assignEndsEarly && endDay !== '' && covTo === endDay && covTo < P.end && rule.proration === 'join';
        const cutEnd = covTo < P.end && assignEndsEarly;
        const frac = leaves ? leaverShare(P, cutStart ? covFrom : P.start, endDay) / 12 : cutStart || cutEnd ? slicesCovered(P, cutStart ? covFrom : P.start, cutEnd ? covTo : P.end) / 12 : 1;
        let amount = base * frac * scaleOf(S, empId, rule, grantDay);
        if (rule.scale_cap && Number(rule.scale_cap) > 0 && rule.scale === 'days_per_week') amount = Math.min(amount, Number(rule.scale_cap) * frac);
        amount = roundBy(amount, rule.rounding || 'half');
        if (amount !== 0) out.push({ key: 'G:' + P.start + ':' + seg.from, day: grantDay, kind: 'grant', amount: amount, expires: lotExpiry(grantDay), phase: 2, note: 'Granted for the leave year from ' + P.start + (frac < 1 ? ' (' + Math.round(frac * 120) / 10 + ' of 12 months' + (leaves ? ', to the last day ' + endDay : '') + ')' : '') });
        if (rule.method === 'tenure_table' && rule.tenure_at === 'anniversary') {
          let prev = base;
          for (const row of (rule.tenure || []).slice().sort((a, b) => Number(a.after) - Number(b.after))) {
            const x = rule.tenure_unit === 'months' ? util.addMonths(start, Number(row.after)) : util.addMonths(start, 12 * Number(row.after));
            if (x <= grantDay || x > covTo || x > until || (endDay !== '' && x > endDay)) continue;
            const now = tenureAmount(rule, start, x);
            const diff = roundBy((now - prev) * scaleOf(S, empId, rule, x), rule.rounding || 'none');
            prev = now;
            if (diff > 0) out.push({ key: 'T:' + P.start + ':' + seg.from + ':' + x, day: x, kind: 'grant', amount: diff, expires: lotExpiry(x), phase: 2, note: 'More days after ' + row.after + ' ' + (rule.tenure_unit === 'months' ? 'months' : 'years') + ' of service' });
          }
        }
      } else if (rule.method === 'monthly_accrual' && rule.accrual_day === 'daily') {
        // Progressive accrual (Australia): each day earns its share of the month. A finished month is one
        // ledger row at its end; the month in progress accrues day by day in the walk and is written when it ends.
        for (const sl of slices(P)) {
          const from = [sl.start, covFrom, elig].reduce((a, b) => (a > b ? a : b));
          const to = endDay !== '' && endDay < sl.end && endDay < covTo ? endDay : sl.end < covTo ? sl.end : covTo;
          if (from > to || from > until) continue;
          const r = ruleOn(pol, code, from) || rule;
          if (r.method !== 'monthly_accrual') continue;
          const a = (r.tenure && r.tenure.length > 0 ? tenureAmount(r, start, from) : Number(r.amount) || 0) * scaleOf(S, empId, r, from);
          const month = r2((a * (sl.k + 1)) / 12) - r2((a * sl.k) / 12);
          const sliceDays = util.daysBetween(sl.start, sl.end) + 1;
          const covered = util.daysBetween(from, to) + 1;
          const total = r2((month * covered) / sliceDays);
          const key = 'A:' + sl.start + ':' + seg.from;
          const cap = Number(r.max_balance) > 0 ? Number(r.max_balance) : 0;
          const note = 'Accrued for ' + sl.start.slice(0, 7) + (covered < sliceDays ? ' (' + covered + ' of ' + sliceDays + ' days)' : '');
          if (to < today || (to === today && (to === sl.end || to === endDay))) {
            if (total !== 0) out.push({ key: key, day: to, kind: 'accrual', amount: total, expires: lotExpiry(to), phase: 2, note: note, cap: cap });
            continue;
          }
          const last = to < until ? to : until;
          for (let d = from, i = 1; d <= last; d = util.dayAdd(d, 1), i++) {
            const amt = r2((total * i) / covered) - r2((total * (i - 1)) / covered);
            if (amt !== 0) out.push({ key: key, day: d, kind: 'accrual', amount: amt, expires: lotExpiry(to), phase: 2, note: note, cap: cap, aggregate: true, open: true, close_day: to });
          }
        }
      } else if (rule.method === 'monthly_accrual' || rule.method === 'per_hours_worked') {
        for (const sl of slices(P)) {
          // A leaver's last month counts to the last day (by days); otherwise a month counts when its 15th day is covered.
          const leaving = endDay !== '' && endDay >= sl.start && endDay < sl.end && endDay <= covTo && covFrom <= endDay;
          if (!leaving && (sl.mid < covFrom || sl.mid > covTo)) continue;
          let day = rule.accrual_day === 'start' ? (sl.start > covFrom ? sl.start : covFrom) : sl.end < covTo ? sl.end : covTo;
          if (rule.method === 'per_hours_worked') day = sl.end < covTo ? sl.end : covTo;
          if (endDay !== '' && day > endDay) day = endDay;
          if (day < elig || day > until) continue;
          const r = ruleOn(pol, code, day) || rule;
          if (r.method !== rule.method) continue;
          let amount = 0;
          let note = '';
          let estimate = false;
          if (r.method === 'monthly_accrual') {
            const a = (r.tenure && r.tenure.length > 0 ? tenureAmount(r, start, day) : Number(r.amount) || 0) * scaleOf(S, empId, r, day);
            amount = r2((a * (sl.k + 1)) / 12) - r2((a * sl.k) / 12);
            note = 'Accrued for ' + sl.start.slice(0, 7);
            if (leaving) {
              const from = sl.start > covFrom ? sl.start : covFrom;
              const covered = util.daysBetween(from, endDay) + 1;
              const sliceDays = util.daysBetween(sl.start, sl.end) + 1;
              amount = r2((amount * covered) / sliceDays);
              note += ' (to the last day, ' + covered + ' of ' + sliceDays + ' days)';
            }
          } else {
            const ph = r.per_hours || {};
            const per = Number(ph.per) || 30;
            const earn = Number(ph.earn) || 1;
            const from = sl.start > covFrom ? sl.start : covFrom;
            let minutes = 0;
            const wkey = 'W:' + sl.start + ':' + seg.from;
            // Hours already counted are reused; the daily run counts the last two months again (late time corrections).
            const prior = S.recompute && sl.end >= util.addMonths(today, -2) ? null : writtenSum(S, empId, typeRec.id, wkey);
            if (day <= today && prior !== null) minutes = (prior / earn) * per * 60;
            else if (day <= today) minutes = Number(L('lib_time').payInputs(S.app, empId, from, day).worked_minutes) || 0;
            else {
              const wd = L('lib_calendar').workingDays(S.app, empId, from, day);
              const w = weekShape(S, empId, from);
              minutes = wd.count * (w.days > 0 ? (w.hours * 60) / w.days : 480);
              estimate = true;
            }
            amount = r2((minutes / 60 / per) * earn);
            note = (estimate ? 'Expected to accrue for ' : 'Accrued for hours worked in ') + sl.start.slice(0, 7) + ' (' + earn + ' per ' + per + ' hours)';
          }
          if (amount !== 0) out.push({ key: (r.method === 'monthly_accrual' ? 'A:' : 'W:') + sl.start + ':' + seg.from, day: day, kind: 'accrual', amount: amount, expires: lotExpiry(day), phase: 2, note: note, cap: Number(r.max_balance) > 0 ? Number(r.max_balance) : 0, estimate: estimate });
        }
      }
      if (rule.deduct_holidays === true) {
        const to = covTo < until ? covTo : until;
        if (covFrom <= to) {
          const wd = workingDaysOf(S, empId, covFrom, to);
          for (const h of wd.holidays) {
            const amt = typeRec.getString('unit') === 'hour' ? r2((L('lib_calendar').expectedMinutes(S.app, empId, h.day) || 480) / 60) : h.half ? 0.5 : 1;
            out.push({ key: 'H:' + h.day, day: h.day, kind: 'take', amount: -amt, expires: '', phase: 3, note: 'Public holiday: ' + h.name });
          }
        }
      }
    }
  }
  return out;
}

/** The written sum of one planned key (null when none is written): reads reuse hours already counted. */
function writtenSum(S, empId, typeId, key) {
  let t = null;
  for (const r of ledgerRows(S, empId, typeId)) if (r.key === key) t = (t || 0) + r.amount;
  return t === null ? null : r2(t);
}

function workingDaysOf(S, empId, from, to) {
  if (!S.wd) S.wd = {};
  const k = empId + '|' + from + '|' + to;
  if (S.wd[k] === undefined) S.wd[k] = L('lib_calendar').workingDays(S.app, empId, from, to);
  return S.wd[k];
}

/* --------------------------------------------------------------- walk */

function ledgerRows(S, empId, typeId) {
  const k = empId + ':' + typeId;
  if (S.rows[k] === undefined) {
    S.rows[k] = u()
      .rows(S.app, "SELECT id, day, amount, kind, [[key]] AS k, expires, ref, note, created FROM leave_ledger WHERE employment = {:e} AND type = {:t} ORDER BY day, created", { id: '', day: '', amount: -0, kind: '', k: '', expires: '', ref: '', note: '', created: '' }, { e: empId, t: typeId })
      .map((r) => ({ id: r.id, day: r.day, amount: r.amount, kind: r.kind, key: r.k, expires: r.expires, ref: r.ref, note: r.note, created: r.created }));
  }
  return S.rows[k];
}

/** Read many employment records at once into the session. */
function loadEmployments(S, empIds) {
  const want = (empIds || []).filter((id) => S.emps[id] === undefined);
  for (let i = 0; i < want.length; i += 500) for (const r of S.app.findRecordsByIds('employments', want.slice(i, i + 500))) S.emps[r.id] = r;
}

/** Read the employment records, ledger rows and policy assignments of many employments in a few queries (lists and the daily run). */
function preload(S, empIds) {
  const util = u();
  if (!empIds || empIds.length === 0) return;
  loadEmployments(S, empIds);
  for (let i = 0; i < empIds.length; i += 500) {
    const chunk = empIds.slice(i, i + 500);
    const bind = {};
    const keys = chunk.map((id, j) => ((bind['e' + j] = id), '{:e' + j + '}')).join(',');
    const byKey = {};
    for (const id of chunk) {
      const emp = employmentOf(S, id);
      if (emp === null) continue;
      for (const t of typesFor(S, emp.getString('entity'), true)) byKey[id + ':' + t.id] = [];
    }
    for (const r of util.rows(S.app, 'SELECT id, employment, type, day, amount, kind, [[key]] AS k, expires, ref, note, created FROM leave_ledger WHERE employment IN (' + keys + ') ORDER BY day, created', { id: '', employment: '', type: '', day: '', amount: -0, kind: '', k: '', expires: '', ref: '', note: '', created: '' }, bind)) {
      const k = r.employment + ':' + r.type;
      if (byKey[k] === undefined) byKey[k] = [];
      byKey[k].push({ id: r.id, day: r.day, amount: r.amount, kind: r.kind, key: r.k, expires: r.expires, ref: r.ref, note: r.note, created: r.created });
    }
    for (const k of Object.keys(byKey)) if (S.rows[k] === undefined) S.rows[k] = byKey[k];
    S.assignRows = Object.assign(S.assignRows || {}, assignmentRows(S.app, chunk));
    if (!S.pending) S.pending = {};
    for (const id of chunk) S.pending[id] = [];
    for (const r of util.rows(S.app, "SELECT id, employment, type, [[start]] AS s, [[end]] AS e, amount, day_list FROM leave_requests WHERE status = 'pending' AND employment IN (" + keys + ')', { id: '', employment: '', type: '', s: '', e: '', amount: -0, day_list: '' }, bind)) S.pending[r.employment].push(r);
  }
}

function forget(S, empId) {
  for (const k of Object.keys(S.rows)) if (k.indexOf(empId + ':') === 0) delete S.rows[k];
  delete S.assigns[empId];
  if (S.assignRows) delete S.assignRows[empId];
  if (S.pending) delete S.pending[empId];
  delete S.emps[empId];
}

/**
 * Run the ledger of one type for an employment up to `until`.
 * opts.extra: more debits [{ day, amount, ref, note }] (a request being checked).
 * opts.at: also keep the state on that day (`at`: { balance, lots, debt }) while walking on to `until`.
 * Returns { tracked, rule, timeline, balance, lots, debt, targets, written, min, at }.
 */
function simulate(S0, empRec, typeRec, until, opts) {
  const S = S0;
  const util = u();
  const o = opts || {};
  const code = typeRec.getString('code');
  const segs = segments(S, empRec);
  const lastRule = ruleFor(S, empRec, code, until < empRec.getString('start_day') ? empRec.getString('start_day') : until);
  let isTracked = false;
  for (const s of segs) for (const h of s.policy ? s.policy.history : []) for (const r of h.rules || []) if (r && r.type === code && r.method !== 'none') isTracked = true;
  const rows = ledgerRows(S, empRec.id, typeRec.id);
  const written = {};
  const manual = {};
  for (const r of rows) {
    if (r.key !== '') {
      written[r.key] = r2((written[r.key] || 0) + r.amount);
      continue;
    }
    if (r.day > until) continue;
    const g = r.day + '|' + (r.ref !== '' ? r.ref : 'R:' + r.id) + '|' + (r.amount >= 0 && CREDIT_KINDS.indexOf(r.kind) >= 0 ? 'c' : r.kind === 'take' ? 't' : r.kind + (r.amount >= 0 ? '+' : '-'));
    if (manual[g] === undefined) manual[g] = { key: 'R:' + r.id, day: r.day, kind: r.kind, amount: 0, expires: r.expires, ref: r.ref, note: r.note, ids: [] };
    manual[g].amount = r2(manual[g].amount + r.amount);
    manual[g].ids.push(r.id);
    if (r.expires !== '' && manual[g].expires === '') manual[g].expires = r.expires;
  }
  const events = isTracked ? plan(S, empRec, typeRec, until) : [];
  for (const g of Object.keys(manual)) {
    const m = manual[g];
    if (Math.abs(m.amount) < 0.005) continue;
    events.push({ key: m.key, day: m.day, kind: m.kind, amount: m.amount, expires: m.amount > 0 ? m.expires : '', phase: m.amount > 0 ? 2 : 3, note: m.note, ref: m.ref, manual: true });
  }
  for (const x of o.extra || []) events.push({ key: 'Q:' + x.day + ':' + (x.ref || ''), day: x.day, kind: 'take', amount: -Math.abs(x.amount), expires: '', phase: 3, note: x.note || '', ref: x.ref || '', extra: true });
  events.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.phase - b.phase || (a.key < b.key ? -1 : 1)));

  const lots = [];
  let debt = 0;
  const timeline = [];
  const targets = {};
  const bal = () => {
    let t = 0;
    for (const l of lots) t += l.remaining;
    return r2(t - debt);
  };
  const record = (ev, amount, extra) => {
    const e = Object.assign({ day: ev.day, kind: ev.kind, key: ev.key, amount: r2(amount), note: ev.note || '', ref: ev.ref || '', expires: ev.expires || '', planned: !ev.manual && !ev.extra, extra: ev.extra === true, estimate: ev.estimate === true, meta: ev.meta || null }, extra || {});
    e.balance = bal();
    timeline.push(e);
    if (!ev.manual && !ev.extra) {
      const prev = ev.aggregate ? targets[ev.key] : undefined;
      if (prev !== undefined) {
        prev.amount = r2(prev.amount + amount);
        prev.day = ev.day;
      } else targets[ev.key] = { day: ev.day, kind: ev.kind, amount: r2(amount), expires: ev.expires || '', note: ev.note || '', open: ev.open === true };
    }
    return e;
  };
  const credit = (amount, key, day, expires) => {
    let a = amount;
    if (debt > 0) {
      const use = Math.min(debt, a);
      debt = r2(debt - use);
      a = r2(a - use);
    }
    if (a > 0) lots.push({ key: key, day: day, remaining: a, expires: expires || '', done: false });
  };
  const debit = (amount) => {
    let a = amount;
    const open = lots.filter((l) => l.remaining > 0).sort((x, y) => (x.expires === y.expires ? (x.day < y.day ? -1 : 1) : x.expires === '' ? 1 : y.expires === '' ? -1 : x.expires < y.expires ? -1 : 1));
    for (const l of open) {
      if (a <= 0) break;
      const use = Math.min(l.remaining, a);
      l.remaining = r2(l.remaining - use);
      a = r2(a - use);
    }
    if (a > 0) debt = r2(debt + a);
  };
  const expireDue = (limit) => {
    for (;;) {
      let next = null;
      for (const l of lots) if (!l.done && l.expires !== '' && l.expires <= limit && (next === null || l.expires < next.expires)) next = l;
      if (next === null) return;
      next.done = true;
      const amt = next.remaining;
      next.remaining = 0;
      record({ day: next.expires, kind: 'expire', key: 'X:' + next.key, note: 'Expired (granted ' + next.day + ')' }, -amt, { lot: next.key, granted: next.day });
    }
  };
  let min = null;
  let minFrom = o.minFrom || '';
  const lotsLeft = () => lots.filter((l) => l.remaining > 0).map((l) => ({ key: l.key, day: l.day, remaining: l.remaining, expires: l.expires }));
  const snapAt = o.at && o.at < until ? o.at : '';
  let at = null;
  const snap = () => {
    expireDue(snapAt);
    at = { balance: bal(), lots: lotsLeft(), debt: debt };
  };
  for (const ev of events) {
    if (snapAt !== '' && at === null && ev.day > snapAt) snap();
    expireDue(ev.day);
    if (ev.phase === 1) {
      const rule = ev.rule;
      let total = 0;
      for (const l of lots) total += l.remaining;
      total = r2(total);
      for (const l of lots) {
        l.remaining = 0;
        l.done = true;
      }
      const cap = rule.carryover_max === undefined || rule.carryover_max === null ? 0 : Number(rule.carryover_max);
      record({ day: ev.day, kind: 'expire', key: ev.key, note: 'Leave year closed' }, -total, { cap: cap });
      const carried = total > 0 ? (cap < 0 ? total : Math.min(total, cap)) : 0;
      const months = Number(rule.carryover_expiry_months) || 0;
      const exp = months > 0 ? util.addMonths(ev.day, months) : '';
      if (carried > 0) credit(carried, 'CO:' + ev.day, ev.day, exp);
      record({ day: ev.day, kind: 'carryover', key: 'CO:' + ev.day, expires: exp, note: carried > 0 ? 'Carried over' + (total > carried ? ' (' + r2(total - carried) + ' over the limit of ' + cap + ' lapsed)' : '') + (exp !== '' ? ', to use by ' + util.dayAdd(exp, -1) : '') : total > 0 ? 'Nothing carries over (' + total + ' lapsed)' : 'Nothing to carry over' }, carried);
      continue;
    }
    if (ev.amount > 0) {
      let a = ev.amount;
      if (ev.cap > 0) a = Math.max(0, Math.min(a, r2(ev.cap - bal())));
      credit(a, ev.key, ev.day, ev.expires);
      record(ev, a, ev.cap > 0 && a < ev.amount ? { note: (ev.note || '') + ' (capped at ' + ev.cap + ')' } : null);
    } else if (ev.amount < 0) {
      debit(-ev.amount);
      record(ev, ev.amount);
    }
    if (minFrom !== '' && ev.day >= minFrom) {
      const b = bal();
      if (min === null || b < min) min = b;
    }
  }
  if (snapAt !== '' && at === null) snap();
  expireDue(until);
  if (minFrom !== '') {
    const b = bal();
    if (min === null || b < min) min = b;
  }
  const left = lotsLeft();
  return { tracked: isTracked, rule: lastRule, timeline: timeline, balance: bal(), lots: left, debt: debt, targets: targets, written: written, min: min, at: at || { balance: bal(), lots: left, debt: debt } };
}

/* ------------------------------------------------------------ balance */

function pendingView(r) {
  let dl = [];
  try {
    dl = JSON.parse(r.day_list || '[]') || [];
  } catch {
    dl = [];
  }
  return { id: r.id, start: r.s, end: r.e, amount: r.amount, days: dl };
}

/** Requests waiting for a decision, summed by "employment:type", for many employments. */
function pendingTotals(S, empIds) {
  const util = u();
  const out = {};
  for (let i = 0; i < empIds.length; i += 500) {
    const bind = {};
    const keys = empIds.slice(i, i + 500).map((id, j) => ((bind['e' + j] = id), '{:e' + j + '}')).join(',');
    for (const r of util.rows(S.app, "SELECT employment, type, CAST(COALESCE(SUM(amount), 0) AS REAL) AS n FROM leave_requests WHERE status = 'pending' AND employment IN (" + keys + ') GROUP BY employment, type', { employment: '', type: '', n: -0 }, bind)) out[r.employment + ':' + r.type] = r2(r.n);
  }
  return out;
}

/** Requests waiting for a decision of one type (read with the session's preload for lists). */
function pendingOf(S, empId, typeId) {
  if (S.pending && S.pending[empId] !== undefined) return S.pending[empId].filter((r) => r.type === typeId).map(pendingView);
  return u()
    .rows(S.app, "SELECT id, [[start]] AS s, [[end]] AS e, amount, day_list FROM leave_requests WHERE employment = {:e} AND type = {:t} AND status = 'pending'", { id: '', s: '', e: '', amount: -0, day_list: '' }, { e: empId, t: typeId })
    .map(pendingView);
}

/** The period that frames "this year" for a type on a day: the leave year, or the Japanese grant year. */
function frameOf(S, empRec, typeRec, day, sim) {
  const util = u();
  const seg = segmentOn(S, empRec, day) || segments(S, empRec)[segments(S, empRec).length - 1] || null;
  const rule = seg ? ruleOn(seg.policy, typeRec.getString('code'), day) : null;
  if (rule && rule.method === 'statutory_jp') {
    let base = '';
    for (const e of sim.timeline) if (e.meta && e.meta.jp && e.day <= day) base = e.day;
    if (base !== '') return { start: base, end: util.dayAdd(util.addMonths(base, 12), -1), kind: 'grant_year' };
    return { start: empRec.getString('start_day'), end: util.dayAdd(util.addMonths(empRec.getString('start_day'), 6), -1), kind: 'before_first_grant' };
  }
  const p = periodOf(seg && seg.policy ? seg.policy.period_start : '01-01', day);
  return { start: p.start, end: p.end, kind: 'leave_year' };
}

/**
 * How far a balance view of a type on a day walks: `horizon` (the day, today,
 * or the last leave already booked, so "booked" sees it) and `reach` (also the
 * next year close, except Japanese grant years that expire by grant, so
 * "expiring" counts what lapses over the carry-over limit; and at least the
 * attention window).
 */
function spanOf(S, empRec, typeRec, day) {
  const util = u();
  const today = todayOf(S, empRec.getString('entity'));
  let horizon = day > today ? day : today;
  for (const r of ledgerRows(S, empRec.id, typeRec.id)) if (r.key === '' && r.day > horizon) horizon = r.day;
  const rule = ruleFor(S, empRec, typeRec.getString('code'), day >= empRec.getString('start_day') ? day : empRec.getString('start_day'));
  let reach = horizon;
  if (rule && rule.method !== 'statutory_jp') {
    const seg = segmentOn(S, empRec, day) || segments(S, empRec)[segments(S, empRec).length - 1] || null;
    const close = util.dayAdd(periodOf(seg && seg.policy ? seg.policy.period_start : '01-01', day).end, 1);
    if (close > reach) reach = close;
  }
  const window = util.dayAdd(day, ATTENTION_DAYS);
  if (window > reach) reach = window;
  return { today: today, horizon: horizon, reach: reach, rule: rule };
}

/**
 * A full balance view of one type on a day (the contract fields plus what screens show).
 * opts.sim: a walk already made for the day over spanOf's reach (the sync's); opts.noPending: leave out waiting requests.
 */
function balanceInfo(S, empRec, typeRec, day, opts) {
  const o = opts || {};
  const tv = typeRec;
  const unit = tv.getString('unit') || 'day';
  const span = spanOf(S, empRec, typeRec, day);
  const today = span.today;
  const horizon = span.horizon;
  const reach = span.reach;
  const rule = span.rule;
  let pending = 0;
  if (!o.noPending) for (const p of pendingOf(S, empRec.id, typeRec.id)) pending = r2(pending + p.amount);
  const base = { type: tv.getString('code'), type_id: tv.id, name: tv.getString('name'), icon: tv.getString('icon'), color: tv.getString('color'), unit: unit, paid: tv.getBool('paid'), day: day, pending: pending, in_policy: rule !== null, method: rule ? rule.method : '' };
  const sim = o.sim || simulate(S, empRec, typeRec, reach, { at: day });
  const frame = frameOf(S, empRec, typeRec, day, sim);
  let taken = 0;
  let granted = 0;
  let carried = 0;
  let booked = 0;
  let balance = 0;
  for (const e of sim.timeline) {
    if (e.day <= day) balance = e.balance;
    if (e.day > day) {
      if (e.day <= horizon && e.kind === 'take' && e.amount < 0) booked = r2(booked - e.amount);
      continue;
    }
    if (e.day < frame.start) continue;
    if (e.kind === 'take') taken = r2(taken - e.amount);
    else if (e.kind === 'carryover') carried = r2(carried + e.amount);
    else if (e.kind !== 'expire') granted = r2(granted + e.amount);
  }
  if (sim.timeline.length === 0 || sim.timeline[0].day > day) balance = 0;
  if (!sim.tracked) {
    return Object.assign(base, { tracked: false, balance: null, taken: takenFromRequests(S, empRec.id, typeRec.id, frame.start, day), granted: 0, booked: 0, available: null, expiring: [], period: { start: frame.start, end: frame.end } });
  }
  const atDay = sim.at;
  const expiring = lapsesOf(sim, day, reach, true);
  const out = Object.assign(base, {
    tracked: true,
    balance: atDay.balance,
    taken: taken,
    granted: granted,
    carried: carried,
    booked: booked,
    available: r2(atDay.balance - booked - pending),
    expiring: expiring,
    period: { start: frame.start, end: frame.end, kind: frame.kind },
    allow_negative: tv.getBool('allow_negative'),
    max_negative: tv.getFloat('max_negative'),
  });
  if (o.explain) out.explain = explain(sim, frame, day);
  if (o.projectTo && o.projectTo > day) {
    const fut = simulate(S, empRec, typeRec, o.projectTo, {});
    let after = 0;
    for (const e of fut.timeline) if (e.day > o.projectTo && e.kind === 'take') after = r2(after - e.amount);
    out.projection = { day: o.projectTo, balance: fut.balance, available: r2(fut.balance - after - pending), estimate: fut.timeline.some((e) => e.estimate && e.day > today) };
  }
  return out;
}

function takenFromRequests(S, empId, typeId, from, to) {
  let t = 0;
  for (const r of u().rows(S.app, "SELECT day_list FROM leave_requests WHERE employment = {:e} AND type = {:t} AND status IN ('approved', 'cancelling') AND [[start]] <= {:to} AND [[end]] >= {:from}", { day_list: '' }, { e: empId, t: typeId, from: from, to: to })) {
    let dl = [];
    try {
      dl = JSON.parse(r.day_list || '[]') || [];
    } catch {
      dl = [];
    }
    for (const d of dl) if (d.day >= from && d.day <= to) t += Number(d.amount) || 0;
  }
  return r2(t);
}

/** How today's number was reached: the frame's opening balance and every movement since, leave grouped by request. */
function explain(sim, frame, day) {
  const lines = [];
  let opening = 0;
  for (const e of sim.timeline) if (e.day < frame.start) opening = e.balance;
  const before = sim.timeline.some((e) => e.day < frame.start);
  if (before) lines.push({ day: frame.start, kind: 'opening', label: 'opening', amount: opening, balance: opening });
  const byRef = {};
  for (const e of sim.timeline) {
    if (e.day < frame.start || e.day > day) continue;
    if (Math.abs(e.amount) < 0.005 && e.kind !== 'carryover') continue;
    if (e.kind === 'carryover' && Math.abs(e.amount) < 0.005) continue;
    if (e.kind === 'take' && e.ref !== '' && !e.planned) {
      if (byRef[e.ref] !== undefined) {
        const l = lines[byRef[e.ref]];
        l.amount = r2(l.amount + e.amount);
        l.to = e.day;
        l.balance = e.balance;
        continue;
      }
      byRef[e.ref] = lines.length;
      lines.push({ day: e.day, to: e.day, kind: 'take', label: 'leave', ref: e.ref, amount: e.amount, balance: e.balance, note: e.note });
      continue;
    }
    lines.push({ day: e.day, kind: e.kind, label: e.kind, key: e.key, ref: e.ref, amount: e.amount, balance: e.balance, note: e.note, expires: e.expires, estimate: e.estimate });
  }
  return lines;
}

/**
 * What is lost after `day` up to `to`, by the day it is gone: lots reaching their expiry day and,
 * at a year close, the part over the carry-over limit (if nothing more is taken than is booked).
 * A type that carries nothing over (sick leave and most entitlements) starts each year afresh: its
 * year close is not counted as days lost.
 * `later`: also lots granted by `day` that still hold days at `to` and expire afterwards.
 * [{ day: the last day to use them, expires: the day they are gone, amount }].
 */
function lapsesOf(sim, day, to, later) {
  const util = u();
  const by = {};
  const add = (gone, amount) => {
    if (amount > 0.004) by[gone] = r2((by[gone] || 0) + amount);
  };
  let close = null;
  for (const e of sim.timeline) {
    if (e.day <= day || e.day > to) continue;
    if (e.kind === 'expire' && e.key.indexOf('PC:') === 0) close = e.cap === 0 ? null : e;
    else if (e.kind === 'carryover') {
      if (close === null) continue;
      add(close.day, -close.amount - e.amount);
      close = null;
    } else if (e.kind === 'expire' && e.amount < 0) add(e.day, -e.amount);
  }
  if (later) for (const l of sim.lots) if (l.expires !== '' && l.expires > to && l.day <= day) add(l.expires, l.remaining);
  return Object.keys(by)
    .sort()
    .map((g) => ({ day: util.dayAdd(g, -1), expires: g, amount: by[g] }));
}

/** The contract: lib_leave.balance(app, employmentId, typeCode, day). */
function balance(app, employmentId, typeCode, day) {
  const S = session(app);
  const emp = employmentOf(S, employmentId);
  if (emp === null) throw u().fail(404, 'No employment ' + employmentId + '.', 'not_found');
  const t = typeRef(S, emp.getString('entity'), typeCode);
  const d = day || todayOf(S, emp.getString('entity'));
  const b = balanceInfo(S, emp, t, d, {});
  return { type: b.type, unit: b.unit, balance: b.balance, taken: b.taken, pending: b.pending, granted: b.granted, expiring: b.expiring, name: b.name, tracked: b.tracked, booked: b.booked, available: b.available, period: b.period, method: b.method };
}

/** Balances of every type an employment can use on a day. */
function balancesOf(S, empRec, day, opts) {
  const out = [];
  for (const t of typesFor(S, empRec.getString('entity'), false)) {
    const rule = ruleFor(S, empRec, t.getString('code'), day >= empRec.getString('start_day') ? day : empRec.getString('start_day'));
    if (rule === null && !(opts && opts.all)) continue;
    out.push(balanceInfo(S, empRec, t, day, opts || {}));
  }
  return out;
}

/* --------------------------------------------------------------- sync */

/**
 * Write the planned rows of one type that are due (day <= today) and not
 * written yet, and a correcting row where the written sum differs from the
 * plan. Returns the number of rows written. Runs inside the caller's
 * transaction when there is one.
 */
function syncType(S, empRec, typeRec, today, sims) {
  const util = u();
  S.recompute = true;
  // With `sims`, the walk goes on over a balance view's span (the rows written are the same: only what is due by today).
  const sim = simulate(S, empRec, typeRec, sims ? spanOf(S, empRec, typeRec, today).reach : today, sims ? { at: today } : {});
  S.recompute = false;
  if (sims) sims[typeRec.id] = sim;
  if (!sim.tracked && Object.keys(sim.written).length === 0) return 0;
  const keys = {};
  for (const k of Object.keys(sim.targets)) if (sim.targets[k].day <= today) keys[k] = true;
  for (const k of Object.keys(sim.written)) keys[k] = true;
  let n = 0;
  for (const k of Object.keys(keys)) {
    const t = sim.targets[k];
    // A month still accruing day by day (progressive accrual) is written when it ends.
    if (t && t.open) continue;
    const target = t && t.day <= today ? t.amount : 0;
    const w = sim.written[k] || 0;
    const diff = r2(target - w);
    if (Math.abs(diff) < 0.005) continue;
    const rec = util.newRecord(S.app, 'leave_ledger');
    rec.set('employment', empRec.id);
    rec.set('type', typeRec.id);
    const prior = ledgerRows(S, empRec.id, typeRec.id).filter((r) => r.key === k)[0];
    rec.set('day', t ? t.day : prior ? prior.day : today);
    rec.set('amount', diff);
    rec.set('kind', t ? t.kind : prior ? prior.kind : 'adjust');
    rec.set('key', k);
    rec.set('expires', t ? t.expires : '');
    rec.set('note', util.clip((t ? t.note : 'No longer due') + (w !== 0 ? ' (correction after a change on ' + today + ')' : ''), 600));
    rec.set('actor', 'system');
    S.app.save(rec);
    n++;
  }
  if (n > 0) delete S.rows[empRec.id + ':' + typeRec.id];
  return n;
}

/** Sync every type of one employment (types of its entity). */
function syncEmployment(S0, app, employmentId, skipExit) {
  const S = sess(S0, app);
  const emp = employmentOf(S, employmentId);
  if (emp === null) return 0;
  const today = todayOf(S, emp.getString('entity'));
  let n = 0;
  const sims = {};
  for (const t of typesFor(S, emp.getString('entity'), true)) n += syncType(S, emp, t, today, sims);
  let walked = sims;
  // A leaver's payout on termination follows every change until payroll pays it.
  if (!skipExit && u().count(app, "SELECT COUNT(*) AS n FROM leave_encash_requests WHERE employment = {:e} AND kind = 'exit' AND status = 'approved'", { e: emp.id }) > 0) {
    const ch = L('lib_leave_req').exitPayouts(null, app, emp.id, '').changed;
    n += ch;
    forget(S, emp.id);
    if (ch > 0) walked = null;
  }
  writeDerived(S, app, emp, today, walked);
  return n;
}

/**
 * Replace an employment's derived rows, read by lists of many people:
 * leave_balances (each tracked type's balance view on the day, for the
 * balances table) and leave_attention (the Leave home and the daily notices:
 * days that lapse within ATTENTION_DAYS, an expiry or the year close over the
 * carry-over limit; a balance below zero; the five-day rule at risk or missed
 * in Japan). `sims`: the sync's walks by type id over spanOf's reach (walked
 * again when missing). Only for employments current on the day.
 */
function writeDerived(S, app, emp, today, sims) {
  const util = u();
  util.exec(app, 'DELETE FROM leave_attention WHERE employment = {:e}', { e: emp.id });
  util.exec(app, 'DELETE FROM leave_balances WHERE employment = {:e}', { e: emp.id });
  const end = emp.getString('end_day');
  if (emp.getString('start_day') > today || (end !== '' && end < today)) return 0;
  const to = util.dayAdd(today, ATTENTION_DAYS);
  const attn = [];
  const bals = [];
  const add = (t, kind, day, amount, detail) => attn.push({ employment: emp.id, entity: emp.getString('entity'), type: t.id, kind: kind, day: day, amount: r2(amount), detail: JSON.stringify(detail), computed: today });
  for (const t of typesFor(S, emp.getString('entity'), false)) {
    const rule = ruleFor(S, emp, t.getString('code'), today);
    if (!tracked(rule)) continue;
    const sim = (sims && sims[t.id]) || simulate(S, emp, t, spanOf(S, emp, t, today).reach, { at: today });
    if (!sim.tracked) continue;
    const b = balanceInfo(S, emp, t, today, { sim: sim, noPending: true });
    bals.push({ employment: emp.id, type: t.id, computed: today, balance: Number(b.balance) || 0, taken: Number(b.taken) || 0, booked: Number(b.booked) || 0, granted: Number(b.granted) || 0, carried: Number(b.carried) || 0, expiring: JSON.stringify(b.expiring) });
    for (const x of lapsesOf(sim, today, to, false)) add(t, 'expiring', x.day, x.amount, { expires: x.expires });
    if (sim.at.balance < 0) add(t, 'negative', today, sim.at.balance, {});
    if (rule.method === 'statutory_jp') {
      const past = { timeline: sim.timeline.filter((e) => e.day <= today) };
      for (const o of L('lib_leave_views').obligationOf(S, emp, t, today, past)) if (o.status === 'at_risk' || o.status === 'missed') add(t, 'obligation', o.deadline, o.short, o);
    }
  }
  insertRows(app, 'leave_balances', bals);
  insertRows(app, 'leave_attention', attn);
  return attn.length;
}

/** Derived rows written in one statement (the daily run writes thousands; record saves cost a millisecond each). */
function insertRows(app, table, rows) {
  if (rows.length === 0) return;
  const stamp = new Date().toISOString().replace('T', ' ');
  const cols = ['id'].concat(Object.keys(rows[0]), ['created', 'updated']);
  const bind = {};
  const values = rows.map((row, i) => {
    const v = Object.assign({ id: $security.randomStringWithAlphabet(15, 'abcdefghijklmnopqrstuvwxyz0123456789') }, row, { created: stamp, updated: stamp });
    return '(' + cols.map((c, j) => ((bind['v' + i + '_' + j] = v[c]), '{:v' + i + '_' + j + '}')).join(', ') + ')';
  });
  u().exec(app, 'INSERT INTO ' + table + ' (' + cols.map((c) => '[[' + c + ']]').join(', ') + ') VALUES ' + values.join(', '), bind);
}

/** Sync an employment in its own transaction (after a change outside one). */
function syncNow(app, employmentId) {
  let n = 0;
  const run = (tx) => {
    n = syncEmployment(null, tx, employmentId);
  };
  if (app.isTransactional()) run(app);
  else app.runInTransaction((tx) => run(tx));
  return n;
}

/** Employments of an entity the daily run keeps up to date (current, starting soon, or ended within 3 years). */
function syncTargets(app, entityId, today) {
  return u()
    .rows(app, "SELECT id FROM employments WHERE entity = {:e} AND (end_day = '' OR end_day >= {:from})", { id: '' }, { e: entityId, from: u().addMonths(today, -36) })
    .map((r) => r.id);
}

/** The daily run for one entity: grants, accruals, closes and expiries due by today (local), plus the notices. */
function runEntity(app, entityId, force) {
  const util = u();
  const started = Date.now();
  const today = util.today(app, entityId);
  if (!force && util.findOne(app, 'leave_sync', 'entity = {:e} && day = {:d}', { e: entityId, d: today }) !== null) return null;
  let rows = 0;
  let errors = 0;
  const notes = [];
  const ids = syncTargets(app, entityId, today);
  const one = (id) => {
    try {
      app.runInTransaction((tx) => {
        rows += syncEmployment(null, tx, id);
      });
    } catch (err) {
      errors++;
      if (notes.length < 5) notes.push(id + ': ' + String((err && err.message) || err));
      console.error('[hr] leave sync of ' + id + ' failed:', err);
    }
  };
  for (let i = 0; i < ids.length; i += 25) {
    const batch = ids.slice(i, i + 25);
    let got = 0;
    try {
      app.runInTransaction((tx) => {
        const S = session(tx);
        preload(S, batch);
        for (const id of batch) got += syncEmployment(S, tx, id);
      });
      rows += got;
    } catch (err) {
      for (const id of batch) one(id);
    }
  }
  try {
    L('lib_leave_views').dailyNotices(app, entityId, today);
  } catch (err) {
    notes.push('notices: ' + String((err && err.message) || err));
    console.error('[hr] leave notices failed:', err);
  }
  let rec = util.findOne(app, 'leave_sync', 'entity = {:e} && day = {:d}', { e: entityId, d: today });
  if (rec === null) {
    rec = util.newRecord(app, 'leave_sync');
    rec.set('entity', entityId);
    rec.set('day', today);
  }
  rec.set('employments', ids.length);
  rec.set('rows', rows + (rec.getInt('rows') || 0) * (force ? 1 : 0));
  rec.set('errors', errors);
  rec.set('ms', Date.now() - started);
  rec.set('note', util.clip(notes.join('; '), 2000));
  app.save(rec);
  return { entity: entityId, day: today, employments: ids.length, rows: rows, errors: errors, ms: Date.now() - started };
}

/** Cron (every 15 minutes, UTC): each entity runs once a local day, after 00:30 local time. */
function cronDaily(app) {
  const util = u();
  const out = [];
  for (const r of util.rows(app, 'SELECT id FROM entities WHERE active = TRUE ORDER BY created', { id: '' })) {
    const now = util.localNow(app, r.id);
    if (now.time < '00:30') continue;
    const res = runEntity(app, r.id, false);
    if (res !== null) out.push(res);
  }
  return out;
}

/* ------------------------------------------------------------- access */

/**
 * What the caller may do with an employment's leave: 'full' | 'edit' |
 * 'view' (leave rights within their entities), 'self', 'team' (a manager
 * of the person), or 'none'. Your AI agent: 'view' (its writes are
 * proposals); the app itself: 'full'.
 */
function access(ctx, empRec) {
  const auth = L('lib_auth');
  if (ctx.isAgent) return 'view';
  if (ctx.actor === 'system') return 'full';
  const lvl = auth.level(ctx, 'leave');
  if (lvl !== 'none' && auth.inScope(ctx, empRec.getString('entity'))) return lvl;
  if (auth.selfEmployee(ctx) !== '' && auth.selfEmployee(ctx) === empRec.getString('employee')) return 'self';
  if (auth.isManagerOf(ctx, empRec.id, u().today(ctx.app, empRec.getString('entity')))) return 'team';
  return 'none';
}

function needSee(ctx, empRec) {
  const a = access(ctx, empRec);
  if (a === 'none') throw u().fail(403, "You cannot see this person's leave.", 'not_permitted');
  return a;
}

/** May act for the person: themself, their manager, or leave edit rights (your AI agent through proposals). */
function needAct(ctx, empRec) {
  const a = access(ctx, empRec);
  if (a === 'self' || a === 'team' || a === 'edit' || a === 'full' || ctx.isAgent) return a;
  throw u().fail(403, "You cannot change this person's leave.", 'not_permitted');
}

/** The employment a request is about: the given one, or the caller's own primary employment. */
function employmentParam(ctx, p) {
  const util = u();
  const people = L('lib_people');
  const ref = util.str(p, 'employment', '');
  if (ref !== '') return people.employmentRef(ctx.app, ref);
  const self = L('lib_auth').selfEmployee(ctx);
  if (self === '') throw util.fail(400, 'Give the employment (employee number such as E0001).', 'missing_param', { param: 'employment' });
  const id = people.primaryEmployment(ctx.app, self, util.today(ctx.app));
  if (id === '') throw util.fail(404, 'You have no employment yet.', 'not_found');
  return ctx.app.findRecordById('employments', id);
}

/**
 * The rows of a list of many people in a few queries: per employment its
 * record fields, the person, and the job record on `day` (or the start day
 * when later) with its department, work week and holiday calendar.
 * Fills S.people (personIn) too.
 */
function roster(S, ids, day) {
  const util = u();
  const app = S.app;
  const out = {};
  if (!S.people) S.people = {};
  const deps = {};
  const scheds = {};
  const locs = {};
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const bind = { d: day };
    const keys = chunk.map((id, j) => ((bind['e' + j] = id), '{:e' + j + '}')).join(',');
    for (const r of util.rows(
      app,
      'SELECT m.id AS id, m.entity AS entity, m.start_day AS start_day, m.end_day AS end_day, e.id AS employee, e.number AS number, e.legal_name AS legal_name, e.preferred_name AS preferred_name, e.family_name AS family_name, e.given_name AS given_name, e.name_order AS name_order, e.member AS member, e.gender AS gender, n.default_schedule AS dsch, n.default_calendar AS dcal FROM employments m JOIN employees e ON e.id = m.employee JOIN entities n ON n.id = m.entity WHERE m.id IN (' + keys + ')',
      { id: '', entity: '', start_day: '', end_day: '', employee: '', number: '', legal_name: '', preferred_name: '', family_name: '', given_name: '', name_order: '', member: '', gender: '', dsch: '', dcal: '' },
      bind,
    )) {
      const person = { id: r.employee, number: r.number, name: L('lib_people').displayName(r), member: r.member, gender: r.gender };
      S.people[r.id] = person;
      out[r.id] = { id: r.id, entity: r.entity, start_day: r.start_day, end_day: r.end_day, person: person, job: null, dsch: r.dsch, dcal: r.dcal };
    }
    for (const j of util.rows(app, 'SELECT employment, title, department, location, schedule, calendar, effective_from FROM job_records WHERE employment IN (' + keys + ') ORDER BY effective_from', { employment: '', title: '', department: '', location: '', schedule: '', calendar: '', effective_from: '' }, bind)) {
      const o = out[j.employment];
      if (!o) continue;
      const at = o.start_day > day ? o.start_day : day;
      if (j.effective_from <= at) o.job = j;
    }
  }
  for (const id of Object.keys(out)) {
    const j = out[id].job;
    if (j && j.department) deps[j.department] = '';
    if (j && j.location) locs[j.location] = '';
  }
  const named = (table, field, map) => {
    const list = Object.keys(map);
    for (let i = 0; i < list.length; i += 500) {
      const bind = {};
      const keys = list.slice(i, i + 500).map((id, j) => ((bind['x' + j] = id), '{:x' + j + '}')).join(',');
      for (const r of util.rows(app, 'SELECT id, ' + field + ' AS v FROM ' + table + ' WHERE id IN (' + keys + ')', { id: '', v: '' }, bind)) map[r.id] = r.v;
    }
  };
  named('departments', 'name', deps);
  named('locations', 'calendar', locs);
  for (const id of Object.keys(out)) {
    const o = out[id];
    const j = o.job;
    o.department_name = j && j.department ? deps[j.department] || '' : '';
    o.schedule = j && j.schedule ? j.schedule : o.dsch;
    o.calendar = j && j.calendar ? j.calendar : j && j.location && locs[j.location] ? locs[j.location] : o.dcal;
    if (o.schedule) scheds[o.schedule] = '';
  }
  named('work_schedules', 'week', scheds);
  const cal = L('lib_calendar');
  for (const id of Object.keys(out)) {
    const o = out[id];
    let week = [];
    try {
      week = o.schedule && scheds[o.schedule] ? JSON.parse(scheds[o.schedule]) || [] : [];
    } catch (e) {
      week = [];
    }
    const work = {};
    for (const r of week) if (cal.rowMinutes(r) > 0) work[r.dow] = true;
    o.week_off = o.schedule && scheds[o.schedule] !== undefined ? [0, 1, 2, 3, 4, 5, 6].filter((d) => !work[d]) : [0, 1, 2, 3, 4, 5, 6];
  }
  return out;
}

/** The person of an employment, from the session when a list read it (roster). */
function personIn(S, empRec) {
  if (S.people && S.people[empRec.id] !== undefined) return S.people[empRec.id];
  if (!S.people) S.people = {};
  S.people[empRec.id] = personOf(S.app, empRec);
  return S.people[empRec.id];
}

function personOf(app, empRec) {
  const e = u().byId(app, 'employees', empRec.getString('employee'));
  return { id: e ? e.id : '', number: e ? e.getString('number') : '', name: e ? L('lib_people').displayName(e) : '', member: e ? e.getString('member') : '', gender: e ? e.getString('gender') : '' };
}

/* ------------------------------------------------------ payroll contract */

function dayListOf(raw) {
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** The contract: lib_leave.payInputs(app, employmentId, from, to). */
function payInputs(app, employmentId, from, to) {
  const util = u();
  const S = session(app);
  const emp = employmentOf(S, employmentId);
  if (emp === null) throw util.fail(404, 'No employment ' + employmentId + '.', 'not_found');
  const out = { unpaid_days: 0, unpaid_hours: 0, paid_days: {}, encash: [], issues: [] };
  const reqs = util.rows(
    app,
    "SELECT id, type, status, [[start]] AS s, [[end]] AS e, hours, day_list, unit FROM leave_requests WHERE employment = {:m} AND [[start]] <= {:to} AND [[end]] >= {:from} AND status IN ('approved', 'cancelling', 'pending')",
    { id: '', type: '', status: '', s: '', e: '', hours: -0, day_list: '', unit: '' },
    { m: employmentId, from: from, to: to },
  );
  let pending = 0;
  let cancelling = 0;
  for (const r of reqs) {
    if (r.status === 'pending') {
      pending++;
      continue;
    }
    if (r.status === 'cancelling') cancelling++;
    const t = typeById(S, r.type);
    if (t === null) continue;
    const code = t.getString('code');
    const hourUnit = (r.unit || t.getString('unit')) === 'hour';
    for (const d of dayListOf(r.day_list)) {
      if (d.day < from || d.day > to) continue;
      const amt = Number(d.amount) || 0;
      const hrs = Number(d.hours) || 0;
      if (t.getBool('paid')) {
        const days = hourUnit ? Number(d.days) || 0 : amt;
        out.paid_days[code] = r2((out.paid_days[code] || 0) + days);
      } else if (hourUnit || hrs > 0) out.unpaid_hours = r2(out.unpaid_hours + (hourUnit ? amt : hrs));
      else out.unpaid_days = r2(out.unpaid_days + amt);
    }
  }
  // A cash-in released from a voided run is reserved for its replacement, which pays it from the copy payroll made at void.
  // kind: voluntary (a person asked to cash in) or exit (unused balance paid out on termination).
  for (const r of util.rows(app, "SELECT id, type, days, kind FROM leave_encash_requests WHERE employment = {:m} AND status = 'approved' AND reserved_for = '' AND pay_on >= {:from} AND pay_on <= {:to} ORDER BY pay_on", { id: '', type: '', days: -0, kind: '' }, { m: employmentId, from: from, to: to })) {
    const t = typeById(S, r.type);
    out.encash.push({ type: t ? t.getString('code') : '', days: r.days, request: r.id, kind: r.kind });
  }
  if (pending > 0) out.issues.push({ code: 'leave_pending', message: pending + (pending === 1 ? ' leave request in this period is' : ' leave requests in this period are') + ' still waiting for a decision.', severity: 'warning' });
  if (cancelling > 0) out.issues.push({ code: 'leave_cancelling', message: cancelling + (cancelling === 1 ? ' approved leave in this period has' : ' approved leaves in this period have') + ' a cancellation waiting for a decision (counted as taken).', severity: 'warning' });
  const pendEnc = util.count(app, "SELECT COUNT(*) AS n FROM leave_encash_requests WHERE employment = {:m} AND status = 'pending'", { m: employmentId });
  if (pendEnc > 0) out.issues.push({ code: 'leave_encash_pending', message: 'A request to cash in leave is still waiting for a decision.', severity: 'warning' });
  return out;
}

function payHistory(r) {
  const h = u().jsonOf(r, 'pay_history', []);
  return Array.isArray(h) ? h : [];
}

/** Is a pay run void (a payment by it no longer stands)? */
function runVoid(app, payrunId) {
  if (!payrunId) return false;
  const run = u().byId(app, 'payruns', payrunId);
  return run !== null && run.getString('status') === 'void';
}

/**
 * Payroll marks cashed-in leave as paid when its run is locked (not in SPEC
 * 3.5; documented in the guide). A cash-in released from a voided run, or
 * still marked with a run that is now void, is marked again with the new
 * run; one already paid by a run that stands is left alone (paid once).
 */
function markEncashPaid(app, requestIds, payrunId) {
  const util = u();
  const run = String(payrunId || '');
  let n = 0;
  for (const id of requestIds || []) {
    const r = util.byId(app, 'leave_encash_requests', id);
    if (r === null) continue;
    const st = r.getString('status');
    if (st === 'paid' && (r.getString('payrun') === run || !runVoid(app, r.getString('payrun')))) continue;
    if (st !== 'approved' && st !== 'paid') continue;
    const h = payHistory(r);
    h.push({ event: 'paid', payrun: run, at: util.nowIso(), note: st === 'paid' ? 'Paid again: the run that paid it before was voided' : '' });
    r.set('status', 'paid');
    r.set('payrun', run);
    r.set('paid_at', util.nowIso());
    r.set('reserved_for', '');
    r.set('pay_history', h);
    app.save(r);
    n++;
  }
  return n;
}

/**
 * payrun.voided { payrun, replaced_by }: the cash-ins the void run paid go
 * back to approved and unpaid, reserved for the replacement (payroll copies
 * them into it). The ledger is not touched: the days left the balance when
 * the cash-in was approved and are still cashed in; only who pays them
 * changes. The release is kept in pay_history and the audit trail.
 */
function onPayrunVoided(ctx, payload) {
  const util = u();
  const voided = String(payload.payrun || '');
  const repl = String(payload.replaced_by || '');
  let n = 0;
  const run = (tx) => {
    for (const r of util.findMany(tx, 'leave_encash_requests', "(payrun = {:v} && status = 'paid') || (reserved_for = {:v} && status = 'approved')", 'created', 0, { v: voided })) {
      const h = payHistory(r);
      h.push({ event: 'released', payrun: voided, replaced_by: repl, at: util.nowIso(), note: 'The pay run was voided; its replacement pays this cash-in' });
      r.set('status', 'approved');
      r.set('payrun', '');
      r.set('paid_at', '');
      r.set('reserved_for', repl);
      r.set('pay_history', h);
      tx.save(r);
      L('lib_audit').write(L('lib_auth').withApp(ctx, tx), { op: 'payrun.voided', collection: 'leave_encash_requests', record: r.id, summary: 'Cash-in of ' + r2(r.getFloat('days')) + ' days released from a voided pay run, to be paid by its replacement', before: { status: 'paid', payrun: voided }, after: { status: 'approved', reserved_for: repl } });
      n++;
    }
  };
  if (ctx.app.isTransactional()) run(ctx.app);
  else ctx.app.runInTransaction((tx) => run(tx));
  return { released: n };
}

/** payrun.locked { payrun }: cash-ins reserved for this run are paid by it when it carries them (its lines or pay inputs name the cash-in). */
function onPayrunLocked(ctx, payload) {
  const util = u();
  const runId = String(payload.payrun || '');
  const reserved = util.findMany(ctx.app, 'leave_encash_requests', "reserved_for = {:r} && status = 'approved'", 'created', 0, { r: runId });
  const ids = [];
  for (const r of reserved) {
    const inLines = util.count(ctx.app, 'SELECT COUNT(*) AS n FROM payslip_lines WHERE payrun = {:r} AND ref = {:x}', { r: runId, x: r.id }) > 0;
    const inInputs = util.count(ctx.app, 'SELECT COUNT(*) AS n FROM pay_inputs WHERE payrun = {:r} AND ref = {:x}', { r: runId, x: r.id }) > 0;
    if (inLines || inInputs) ids.push(r.id);
  }
  if (ids.length === 0) return { paid: 0 };
  let n = 0;
  ctx.app.runInTransaction((tx) => {
    n = markEncashPaid(tx, ids, runId);
  });
  return { paid: n };
}

/* ------------------------------------------------------- profile facts */


/**
 * Facts the profile ("At a glance") and Home show, as [{ label, value, link, key }]:
 * the balances people use most (up to three), leave today or the next leave,
 * and requests waiting.
 */
function profileFacts(ctx, employmentId) {
  const util = u();
  const S = session(ctx.app);
  const emp = employmentOf(S, employmentId);
  if (emp === null) return [];
  const a = access(ctx, emp);
  if (a === 'none') return [];
  const today = todayOf(S, emp.getString('entity'));
  const person = personOf(ctx.app, emp);
  const link = '#/people/' + person.number + '?tab=leave';
  const out = [];
  const bal = balancesOf(S, emp, today, {}).filter((b) => b.tracked && (b.granted > 0 || b.carried > 0 || b.balance !== 0 || b.taken > 0));
  // Typed facts (the kernel's ProfileFact): the kernel formats days, hours, dates and counts.
  for (const b of bal.slice(0, 3)) out.push({ key: 'balance:' + b.type, label: b.name, value: r2(b.available), kind: b.unit === 'hour' ? 'hours' : 'days', tone: b.available < 0 ? 'bad' : undefined, link: link });
  const req = (where, sort) =>
    util.rows(ctx.app, "SELECT [[r.start]] AS s, [[r.end]] AS e, t.name AS name, t.visibility AS vis FROM leave_requests r JOIN leave_types t ON t.id = r.type WHERE r.employment = {:m} AND " + where + ' ORDER BY ' + sort + ' LIMIT 1', { s: '', e: '', name: '', vis: '' }, { m: emp.id, d: today })[0] || null;
  const showType = (r) => r.vis !== 'away' || a === 'self' || a === 'full' || a === 'edit' || a === 'view';
  const now = req("r.status IN ('approved', 'cancelling') AND [[r.start]] <= {:d} AND [[r.end]] >= {:d}", '[[r.start]]');
  if (now !== null) out.push({ key: 'on_leave', label: showType(now) ? now.name + ' until' : 'On leave until', value: now.e, kind: 'date', link: link });
  else {
    const next = req("r.status IN ('approved', 'cancelling') AND [[r.start]] > {:d}", '[[r.start]]');
    if (next !== null) out.push({ key: 'next_leave', label: 'Next leave' + (showType(next) ? ' (' + next.name + ')' : ''), value: next.s, kind: 'date', link: link });
  }
  const pending = util.count(ctx.app, "SELECT COUNT(*) AS n FROM leave_requests WHERE employment = {:m} AND status = 'pending'", { m: emp.id });
  if (pending > 0) out.push({ key: 'pending', label: 'Leave requests waiting', value: pending, kind: 'count', tone: 'warn', link: link });
  return out;
}

/* ------------------------------------------------------------- events */

/** entity.created: seed the country's leave types and default policy. */
function onEntityCreated(ctx, payload) {
  let out = null;
  const run = (tx) => {
    out = L('lib_leave_admin').seedEntity(L('lib_auth').withApp(ctx, tx), payload.entity);
  };
  if (ctx.app.isTransactional()) run(ctx.app);
  else ctx.app.runInTransaction((tx) => run(tx));
  return out;
}

/** employment.hired: follow the entity's default policy from the first day, and write what is due. */
function onHired(ctx, payload) {
  const util = u();
  let out = { assigned: false, rows: 0 };
  const run = (tx) => {
    const emp = util.byId(tx, 'employments', payload.employment);
    if (emp === null) return;
    const ent = tx.findRecordById('entities', emp.getString('entity'));
    const pol = ent.getString('default_leave_policy');
    if (pol !== '' && util.byId(tx, 'leave_policies', pol) !== null && util.findOne(tx, 'leave_policy_assignments', 'employment = {:e}', { e: emp.id }) === null) {
      const r = util.newRecord(tx, 'leave_policy_assignments');
      r.set('employment', emp.id);
      r.set('policy', pol);
      r.set('effective_from', emp.getString('start_day'));
      r.set('note', 'The entity default, from the first day');
      r.set('by', ctx.memberId || '');
      tx.save(r);
      out.assigned = true;
    }
    out.rows = syncEmployment(null, tx, emp.id);
  };
  if (ctx.app.isTransactional()) run(ctx.app);
  else ctx.app.runInTransaction((tx) => run(tx));
  return out;
}

/** employment.changed / employment.ended: schedules, hours and end days move grants and accruals. */
function onChanged(ctx, payload) {
  return { rows: syncNow(ctx.app, payload.employment) };
}

module.exports = {
  METHODS: METHODS,
  RULE_KEYS: RULE_KEYS,
  JP_GRANTS: JP_GRANTS,
  r2: r2,
  roundBy: roundBy,
  monthsBetween: monthsBetween,
  periodOf: periodOf,
  periodsBetween: periodsBetween,
  slices: slices,
  slicesCovered: slicesCovered,
  typeView: typeView,
  session: session,
  sess: sess,
  employmentOf: employmentOf,
  entityOf: entityOf,
  todayOf: todayOf,
  typesFor: typesFor,
  typeById: typeById,
  typeRef: typeRef,
  policyParsed: policyParsed,
  ruleOn: ruleOn,
  segments: segments,
  segmentOn: segmentOn,
  ruleFor: ruleFor,
  tracked: tracked,
  tenureAmount: tenureAmount,
  weekShape: weekShape,
  jpGrant: jpGrant,
  plan: plan,
  ledgerRows: ledgerRows,
  preload: preload,
  forget: forget,
  simulate: simulate,
  pendingOf: pendingOf,
  frameOf: frameOf,
  balanceInfo: balanceInfo,
  writeDerived: writeDerived,
  pendingTotals: pendingTotals,
  spanOf: spanOf,
  ATTENTION_DAYS: ATTENTION_DAYS,
  roster: roster,
  personIn: personIn,
  loadEmployments: loadEmployments,
  lapsesOf: lapsesOf,
  balancesOf: balancesOf,
  balance: balance,
  syncType: syncType,
  syncEmployment: syncEmployment,
  syncNow: syncNow,
  runEntity: runEntity,
  cronDaily: cronDaily,
  access: access,
  needSee: needSee,
  needAct: needAct,
  employmentParam: employmentParam,
  personOf: personOf,
  dayListOf: dayListOf,
  payInputs: payInputs,
  markEncashPaid: markEncashPaid,
  onPayrunVoided: onPayrunVoided,
  onPayrunLocked: onPayrunLocked,
  profileFacts: profileFacts,
  onEntityCreated: onEntityCreated,
  onHired: onHired,
  onChanged: onChanged,
};
