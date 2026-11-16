/// <reference path="../pb_data/types.d.ts" />
/**
 * Capital calls and distributions (three steps: draft, preview, issue with
 * the PIN), payments, the ledger, opening balances and statements.
 *
 * Call: purposes (investment in a holding, management fees from the
 * engine, partnership expenses, other) -> preview: every LP's line by ILPA
 * type from lib_eng_capital (pro rata of signed commitments, fee lines only
 * to fee-paying LPs at their own rate with waivers, largest remainder so
 * lines sum exactly) with each LP's balances after the notice -> your AI
 * agent's review note (trigger notice_review) -> issue (PIN): ledger rows, a PDF
 * notice and its ILPA CSV per LP (the wire block from the sealed details;
 * every notice asks LPs to confirm wire instructions by phone), approved
 * outbound messages the minute job sends.
 *
 * Distribution: gross amount, source holding and proceeds, recallable part
 * -> preview with the waterfall estimate (lib_eng_waterfall, the fund's
 * LPA: European or American, hurdle with its compounding, catch-up, carry)
 * -> issue (PIN).
 */

// recall: capital called against recallable distributions (pro rata of each LP's recallable balance; unfunded unchanged).
// subline: repayment of the subscription facility (pro rata of commitments).
const PURPOSES = ['investment', 'fees', 'expenses', 'other', 'recall', 'subline'];
const BASIS = { committed: 'committed', invested: 'invested' };
const STEPS = ['Draft', 'Preview', 'Issued', 'Paid'];

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}
function F() {
  return L('lib_funds');
}

/* -------------------------------------------------------------- helpers */

function eventRef(ctx, ref) {
  const util = u();
  const r = String(ref || '').trim();
  if (r === '') throw util.fail(400, 'event is required (id or number such as CC-001).', 'missing_param', { param: 'event' });
  let e = util.byId(ctx.app, 'capital_events', r);
  if (e === null) e = util.findOne(ctx.app, 'capital_events', 'number = {:n}', { n: r.toUpperCase() });
  if (e === null) throw util.fail(404, 'No call or distribution ' + r + '. Run calls.list.', 'not_found', { ref: r });
  F().fundOf(ctx, e.getString('fund'));
  return e;
}

function firmName(app) {
  return L('lib_settings').row(app).getString('firm_name') || 'The General Partner';
}

function moneyOf(p, name, cur, opts) {
  return u().money(p, name, cur, opts);
}

/** An amount inside a JSON list: major text or a number of major units -> minor (null when empty). */
function amountIn(v, cur, where) {
  const util = u();
  if (v === undefined || v === null || v === '') return null;
  const t = typeof v === 'number' ? String(v) : String(v).replace(/[,\s]/g, '');
  const m = L('lib_money').toMinor(t, cur, false);
  if (m === null) throw util.fail(400, where + ' must be an amount in ' + cur + ' such as 1250000.00.', 'invalid_amount', { param: where });
  return m;
}

/** The fund's management fee schedule from its LPA: [{ from_day, rate_ppm, basis }]. */
function feeSchedule(f, lpa) {
  const util = u();
  const start = F().feeStartOf(f);
  if (start === '') throw util.fail(409, "Set the fund's first close day (Settings, Funds) so the fees can be computed.", 'fee_start_unknown');
  const basisOf = (b) => {
    if (BASIS[b] === undefined) throw util.fail(409, 'The fee basis ' + b + ' is not computed by the fee engine (committed or invested). Call the fee as Other with its amount.', 'fee_basis_unsupported', { basis: b });
    return BASIS[b];
  };
  const steps = [{ from_day: start, rate_ppm: lpa.mgmt_fee_ppm, basis: basisOf(lpa.fee_basis) }];
  for (const s of lpa.step_downs || []) {
    const day = util.addMonths(start, 12 * (s.from_year - 1));
    const step = { from_day: day, rate_ppm: s.fee_ppm, basis: basisOf(s.basis || lpa.fee_basis) };
    if (day === start) steps[0] = step;
    else steps.push(step);
  }
  return steps;
}

/** The step of a schedule in force on a day. */
function stepOn(schedule, day) {
  let s = null;
  for (const x of schedule) if (x.from_day <= day) s = x;
  return s;
}

/** Default fee period: the day after the last called fee period (or the fee start), to that quarter's end. */
function defaultFeePeriod(app, f, noticeDay) {
  const util = u();
  let from = '';
  for (const e of util.findMany(app, 'capital_events', "fund = {:f} && kind = 'call' && (status = 'issued' || status = 'settled')", '-notice_day', 50, { f: f.id })) {
    for (const pu of util.jsonOf(e, 'purposes', []) || []) if (pu.type === 'fees' && pu.to_day && pu.to_day >= from) from = util.dayAdd(pu.to_day, 1);
  }
  if (from === '') {
    const start = F().feeStartOf(f);
    from = F().qStart(F().qEnd(noticeDay));
    if (start !== '' && start > from) from = start;
  }
  return { from_day: from, to_day: F().qEnd(from) };
}

function holdingName(app, fundId, holdingId) {
  if (!holdingId) return '';
  const h = F().holdingsMap(app, fundId)[holdingId];
  return h ? h.name : '';
}

/** The purposes of a call from the simple params (purpose, amount, holding, fees, expenses) or a --purposes list. */
function callPurposes(ctx, f, p, noticeDay) {
  const util = u();
  const app = ctx.app;
  const cur = f.getString('currency');
  const holdings = F().seenHoldings(ctx, f.id);
  const checkHolding = (h, where) => {
    if (!h) return '';
    if (holdings[h] === undefined) throw util.fail(404, where + ': no holding ' + h + ' you can see in ' + f.getString('name') + '. Holdings come from the portfolio (funds.holdings).', 'not_found', { param: 'holding' });
    return h;
  };
  const out = [];
  const raw = util.list(p, 'purposes');
  if (raw !== undefined && raw.length > 0) {
    raw.forEach((x, i) => {
      const w = 'purposes[' + i + ']';
      util.keysOnly(x, ['type', 'amount', 'holding', 'label', 'from_day', 'to_day'], w);
      if (PURPOSES.indexOf(x.type) < 0) throw util.fail(400, w + '.type must be one of: ' + PURPOSES.join(', '), 'invalid_param', { param: 'purposes' });
      if (x.type === 'fees') {
        const per = defaultFeePeriod(app, f, noticeDay);
        const from = x.from_day || per.from_day;
        const to = x.to_day || F().qEnd(from);
        if (!util.isDay(from) || !util.isDay(to) || to < from) throw util.fail(400, w + ': from_day and to_day are days, to_day not before from_day.', 'invalid_param', { param: 'purposes' });
        out.push({ type: 'fees', from_day: from, to_day: to, amount_minor: 0 });
        return;
      }
      const amt = amountIn(x.amount, cur, w + '.amount');
      if (amt === null || amt <= 0) throw util.fail(400, w + '.amount must be more than 0.', 'invalid_amount', { param: 'purposes' });
      const h = x.type === 'investment' || x.type === 'recall' ? checkHolding(x.holding, w) : '';
      out.push({ type: x.type, amount_minor: amt, holding: h, holding_name: h ? holdings[h].name : '', label: util.clip(util.squash(x.label || ''), 200) });
    });
  } else {
    const purpose = util.oneOf(p, 'purpose', PURPOSES, '');
    const amt = moneyOf(p, 'amount', cur, {});
    const main = purpose !== '' ? purpose : amt !== null ? 'investment' : 'fees';
    if (main !== 'fees') {
      if (amt === null || amt <= 0) throw util.fail(400, 'amount is required for ' + main + ', e.g. --amount 1250000.00', 'missing_param', { param: 'amount' });
      const h = main === 'investment' || main === 'recall' ? checkHolding(util.str(p, 'holding', ''), 'holding') : '';
      out.push({ type: main, amount_minor: amt, holding: h, holding_name: h ? holdings[h].name : '', label: util.clip(util.squash(util.str(p, 'label', '')), 200) });
    }
    const exp = moneyOf(p, 'expenses', cur, {});
    if (exp !== null && exp > 0 && main !== 'expenses') out.push({ type: 'expenses', amount_minor: exp, holding: '', holding_name: '', label: '' });
    if (main === 'fees' || util.bool(p, 'fees', false)) {
      const per = defaultFeePeriod(app, f, noticeDay);
      const from = util.day(p, 'fee_from', per.from_day);
      const to = util.day(p, 'fee_to', F().qEnd(from));
      if (to < from) throw util.fail(400, 'fee_to is before fee_from.', 'invalid_param', { param: 'fee_to' });
      out.push({ type: 'fees', from_day: from, to_day: to, amount_minor: 0 });
    }
  }
  if (out.length === 0) throw util.fail(400, 'Give an amount and a purpose (investment, expenses, other) or --fees true.', 'missing_param', { param: 'amount' });
  if (out.filter((x) => x.type === 'fees').length > 1) throw util.fail(400, 'One fee period per call.', 'invalid_param', { param: 'purposes' });
  return out;
}

/** Each LP's ledger rows (all days), by LP. */
function rowsByLp(rows) {
  const out = {};
  for (const r of rows) {
    if (r.lp === '') continue;
    if (out[r.lp] === undefined) out[r.lp] = [];
    out[r.lp].push(r);
  }
  return out;
}

function balancesAfter(commitment, rows, extra) {
  const a = F().accountFrom(commitment, rows.concat(extra));
  return { commitment_minor: a.commitment_minor, contributed_minor: a.contributed_minor, contributed_ppm: a.contributed_ppm, unfunded_minor: a.unfunded_minor, distributed_minor: a.distributed_minor, recallable_minor: a.recallable_minor, warnings: a.warnings };
}

/* --------------------------------------------------------------- preview */

/** A call's lines from the engine (nothing stored). */
function callPreview(app, f, e) {
  const util = u();
  const CAP = L('lib_eng_capital');
  const lpa = F().lpaOf(f);
  const cur = f.getString('currency');
  const commits = F().commitmentsOf(app, f.id, 'signed').filter((c) => c.amount_minor > 0);
  if (commits.length === 0) throw util.fail(409, 'There are no signed commitments in ' + f.getString('name') + ' to call.', 'no_commitments');
  const purposes = util.jsonOf(e, 'purposes', []) || [];
  let inv = 0;
  let exp = 0;
  let other = 0;
  let recall = 0;
  let subline = 0;
  let feeP = null;
  for (const pu of purposes) {
    if (pu.type === 'investment') inv += pu.amount_minor;
    else if (pu.type === 'expenses') exp += pu.amount_minor;
    else if (pu.type === 'other') other += pu.amount_minor;
    else if (pu.type === 'recall') recall += pu.amount_minor;
    else if (pu.type === 'subline') subline += pu.amount_minor;
    else if (pu.type === 'fees') feeP = pu;
  }
  const rows = F().ledgerRows(app, f.id, '9999-12-31');
  let fees = null;
  let fee = null;
  let schedule = null;
  if (feeP !== null) {
    schedule = feeSchedule(f, lpa);
    let invested = 0;
    for (const r of rows) if (r.type === 'investment' && r.day <= feeP.from_day) invested += r.amount_minor;
    fees = { from_day: feeP.from_day, to_day: feeP.to_day, schedule: schedule, fund_invested_minor: Math.max(0, invested) };
    const st = stepOn(schedule, feeP.from_day) || schedule[0];
    fee = { from_day: feeP.from_day, to_day: feeP.to_day, rate_ppm: st.rate_ppm, basis: st.basis, schedule: schedule };
  }
  const lpsIn = commits.map((c) => {
    const o = { lp: c.lp, commitment_minor: c.amount_minor, fee_paying: c.fee_paying === true, waiver_ppm: c.waiver_ppm || 0 };
    if (c.fee_override && schedule !== null) o.schedule = [{ from_day: schedule[0].from_day, rate_ppm: c.fee_rate_ppm, basis: schedule[0].basis }];
    return o;
  });
  const res = CAP.callLines({ investment_minor: inv, expenses_minor: exp, fees: fees, lps: lpsIn });
  const byCommitment = (total) => {
    const out = {};
    if (total > 0) for (const a of CAP.allocate({ total_minor: total, lps: lpsIn.map((x) => ({ lp: x.lp, commitment_minor: x.commitment_minor })) })) out[a.lp] = a.amount_minor;
    return out;
  };
  const otherParts = byCommitment(other);
  const sublineParts = byCommitment(subline);
  const byLp = rowsByLp(rows);
  const recallParts = {};
  if (recall > 0) {
    const weights = commits.map((c) => ({ lp: c.lp, commitment_minor: Math.max(0, F().accountFrom(c.amount_minor, byLp[c.lp] || []).recallable_minor) })).filter((x) => x.commitment_minor > 0);
    const avail = weights.reduce((a, x) => a + x.commitment_minor, 0);
    if (recall > avail) throw util.fail(409, 'Only ' + F().fmt(avail, cur) + ' of distributions is recallable; a recall cannot call more.', 'over_recall', { recallable_minor: avail });
    for (const a of CAP.allocate({ total_minor: recall, lps: weights })) recallParts[a.lp] = a.amount_minor;
  }
  const names = {};
  for (const c of commits) names[c.lp] = c;
  const totals = { call_investment: 0, call_fees: 0, call_expenses: 0, call_other: 0, call_recall: 0, call_subline: 0, total_minor: 0 };
  const warnings = [];
  const lines = res.lines.map((l) => {
    const amounts = { call_investment: l.investment_minor, call_fees: l.fee_minor, call_expenses: l.expenses_minor, call_other: otherParts[l.lp] || 0, call_recall: recallParts[l.lp] || 0, call_subline: sublineParts[l.lp] || 0 };
    let total = 0;
    for (const k of Object.keys(amounts)) total += amounts[k];
    for (const k of Object.keys(amounts)) totals[k] += amounts[k];
    totals.total_minor += total;
    const extra = Object.keys(amounts)
      .filter((k) => amounts[k] !== 0)
      .map((k) => ({ id: 'new', lp: l.lp, holding: '', event: 'new', day: e.getString('due_day'), type: k, amount_minor: amounts[k], recallable_minor: 0, origin: 'call' }));
    const bal = balancesAfter(names[l.lp].amount_minor, byLp[l.lp] || [], extra);
    if (bal.warnings.length > 0) warnings.push({ lp: l.lp, lp_name: names[l.lp].lp_name, warnings: bal.warnings });
    return { lp: l.lp, lp_name: names[l.lp].lp_name, commitment: names[l.lp].id, commitment_minor: names[l.lp].amount_minor, fee_paying: names[l.lp].fee_paying, amounts: amounts, total_minor: total, fee_gross_minor: l.fee_gross_minor, fee_waiver_minor: l.fee_waiver_minor, balances: bal };
  });
  if (totals.total_minor <= 0) throw util.fail(409, 'This call adds up to nothing (no fee-paying LPs in the fee period, or no amount).', 'empty_call');
  return { kind: 'call', currency: cur, lines: lines.filter((l) => l.total_minor > 0), totals: totals, fee: fee, warnings: warnings, purposes: purposes };
}

/** The waterfall estimate for a gross distribution on a day (prior distributions and carry from the books). */
function waterfallFor(app, f, gross, day, holding, excludeEvent) {
  const util = u();
  const W = L('lib_eng_waterfall');
  const lpa = F().lpaOf(f);
  const rows = F().ledgerRows(app, f.id, '9999-12-31');
  const contrib = {};
  let priorCarry = 0;
  for (const r of rows) {
    if (F().LP_CALL.indexOf(r.type) >= 0 || r.type === 'opening_contributed') contrib[r.day] = (contrib[r.day] || 0) + r.amount_minor;
    if (r.type === 'carry') priorCarry += r.amount_minor;
  }
  const prior = util.findMany(app, 'capital_events', "fund = {:f} && kind = 'distribution' && (status = 'issued' || status = 'settled')", 'due_day', 0, { f: f.id }).filter((x) => x.id !== excludeEvent);
  const terms = { carry_ppm: lpa.carry_ppm, hurdle_ppm: lpa.hurdle_ppm > 0 ? lpa.hurdle_ppm : null, compounding: lpa.pref_compounding, catchup_ppm: lpa.hurdle_ppm > 0 && lpa.catch_up_ppm > 0 ? lpa.catch_up_ppm : null };
  const out = { estimate: true, method: lpa.waterfall, compounding: lpa.pref_compounding, carry_ppm: lpa.carry_ppm, hurdle_ppm: lpa.hurdle_ppm, gross_minor: gross, prior_carry_minor: priorCarry };
  if (lpa.waterfall === 'american') {
    if (!holding) throw util.fail(400, 'An American waterfall runs deal by deal: give the source holding.', 'missing_param', { param: 'holding' });
    const deals = {};
    const add = (h, ev) => {
      if (deals[h] === undefined) deals[h] = [];
      deals[h].push(ev);
    };
    for (const r of rows) if (r.type === 'investment' && r.holding !== '' && r.amount_minor !== 0) add(r.holding, { day: r.day, type: 'contribution', amount_minor: Math.abs(r.amount_minor) });
    for (const x of prior) {
      const pu = (util.jsonOf(x, 'purposes', []) || [])[0] || {};
      add(pu.holding || 'fund', { day: x.getString('due_day'), type: 'distribution', amount_minor: x.getInt('total_minor') });
    }
    add(holding, { day: day, type: 'distribution', amount_minor: gross });
    const res = W.american(Object.assign({ deals: Object.keys(deals).map((k) => ({ id: k, events: deals[k] })) }, terms));
    const carry = Math.max(0, Math.min(gross, res.carry_after_clawback_minor - priorCarry));
    let cost = 0;
    let back = 0;
    for (const r of rows) if (r.type === 'investment' && r.holding === holding) cost += r.amount_minor;
    for (const x of prior) {
      const pu = (util.jsonOf(x, 'purposes', []) || [])[0] || {};
      if (pu.holding === holding) back += x.getInt('total_minor');
    }
    const lp = gross - carry;
    const roc = Math.max(0, Math.min(lp, cost - back));
    return Object.assign(out, { carry_minor: carry, lp_minor: lp, roc_minor: roc, gain_minor: lp - roc, clawback_minor: res.clawback_minor, tiers: null });
  }
  const events = Object.keys(contrib)
    .sort()
    .filter((d) => contrib[d] > 0)
    .map((d) => ({ day: d, type: 'contribution', amount_minor: contrib[d] }));
  for (const x of prior) events.push({ day: x.getString('due_day'), type: 'distribution', amount_minor: x.getInt('total_minor') });
  events.push({ day: day, type: 'distribution', amount_minor: gross });
  const res = W.european(Object.assign({ events: events }, terms));
  const last = res.rows[res.rows.length - 1];
  const carry = Math.max(0, Math.min(gross, res.gp_minor - priorCarry));
  const lp = gross - carry;
  const roc = Math.max(0, Math.min(lp, last ? last.roc_minor : 0));
  return Object.assign(out, { carry_minor: carry, lp_minor: lp, roc_minor: roc, gain_minor: lp - roc, tiers: res.tiers, unreturned_minor: res.unreturned_minor, pref_owed_minor: res.pref_owed_minor });
}

/** A distribution's lines (nothing stored): the waterfall estimate, then pro rata of contributed capital. */
function distPreview(app, f, e) {
  const util = u();
  const CAP = L('lib_eng_capital');
  const cur = f.getString('currency');
  const pu = (util.jsonOf(e, 'purposes', []) || [])[0];
  if (!pu) throw util.fail(409, 'This distribution has no amount.', 'empty_distribution');
  const commits = F().commitmentsOf(app, f.id, 'signed').filter((c) => c.amount_minor > 0);
  if (commits.length === 0) throw util.fail(409, 'There are no signed commitments in ' + f.getString('name') + '.', 'no_commitments');
  const day = e.getString('due_day');
  const wf = waterfallFor(app, f, pu.amount_minor, day, pu.holding || '', e.id);
  const rows = F().ledgerRows(app, f.id, '9999-12-31');
  const byLp = rowsByLp(rows);
  const accounts = {};
  let contributedAll = 0;
  for (const c of commits) {
    accounts[c.lp] = F().accountFrom(c.amount_minor, byLp[c.lp] || []);
    contributedAll += accounts[c.lp].contributed_minor;
  }
  const weights = commits.map((c) => ({ lp: c.lp, commitment_minor: contributedAll > 0 ? accounts[c.lp].contributed_minor : c.amount_minor })).filter((x) => x.commitment_minor > 0);
  const part = (total) => {
    const out = {};
    if (total <= 0 || weights.length === 0) return out;
    for (const a of CAP.allocate({ total_minor: total, lps: weights })) out[a.lp] = a.amount_minor;
    return out;
  };
  const recallable = Math.max(0, Math.min(pu.recallable_minor || 0, wf.lp_minor));
  const cap = part(wf.roc_minor);
  const gain = part(wf.gain_minor);
  const rec = part(recallable);
  const totals = { dist_capital: 0, dist_gain: 0, total_minor: 0, recallable_minor: 0 };
  const lines = commits
    .filter((c) => weights.some((w) => w.lp === c.lp))
    .map((c) => {
      const amounts = { dist_capital: cap[c.lp] || 0, dist_gain: gain[c.lp] || 0 };
      const total = amounts.dist_capital + amounts.dist_gain;
      const r = Math.min(rec[c.lp] || 0, total);
      totals.dist_capital += amounts.dist_capital;
      totals.dist_gain += amounts.dist_gain;
      totals.total_minor += total;
      totals.recallable_minor += r;
      const extra = [];
      if (amounts.dist_capital > 0 || r > 0) extra.push({ id: 'new', lp: c.lp, holding: '', event: 'new', day: day, type: 'dist_capital', amount_minor: amounts.dist_capital, recallable_minor: r, origin: 'distribution' });
      if (amounts.dist_gain > 0) extra.push({ id: 'new', lp: c.lp, holding: '', event: 'new', day: day, type: 'dist_gain', amount_minor: amounts.dist_gain, recallable_minor: 0, origin: 'distribution' });
      return { lp: c.lp, lp_name: c.lp_name, commitment: c.id, commitment_minor: c.amount_minor, amounts: amounts, total_minor: total, recallable_minor: r, balances: balancesAfter(c.amount_minor, byLp[c.lp] || [], extra) };
    });
  let holding = null;
  if (pu.holding) {
    const nav = F().navAt(rows, day, F().marksOf(app, f.id), F().holdingsMap(app, f.id));
    const h = nav.holdings.filter((x) => x.holding === pu.holding)[0];
    const g = L('lib_eng_metrics').gross({ company_flows: F().companyFlows(rows.filter((r) => r.day <= day), pu.holding).concat(pu.proceeds_minor > 0 ? [{ day: day, amount_minor: pu.proceeds_minor }] : []), value_minor: h ? h.value_minor : 0, as_of_day: day });
    holding = { holding: pu.holding, name: pu.holding_name || (h ? h.name : ''), moic_e8: g.moic_e8, irr_ppm: g.irr_ppm };
  }
  return { kind: 'distribution', currency: cur, lines: lines, totals: totals, waterfall: wf, holding: holding, warnings: [], purposes: [pu] };
}

/* ------------------------------------------------------------------ views */

function paidOf(app, eventId) {
  return u().one(app, "SELECT COALESCE(SUM(amount_minor), 0) AS n FROM payments WHERE event = {:e} AND voided_at = ''", { n: 0 }, { e: eventId }).n;
}

function stepsOf(e, paid) {
  const st = e.getString('status');
  const at = st === 'draft' ? 0 : st === 'previewed' ? 1 : st === 'settled' ? 3 : st === 'void' ? 2 : paid > 0 ? 3 : 2;
  return { labels: STEPS, at: at, done: st === 'settled', void: st === 'void' };
}

/** An event's purposes with the holding withheld where the caller may not see it (the amounts stay). */
function seenPurposes(ctx, fundId, purposes) {
  if (!purposes.some((x) => x.holding)) return purposes;
  const seen = F().seenHoldings(ctx, fundId);
  return purposes.map((x) => (x.holding && seen[x.holding] === undefined ? Object.assign({}, x, { holding: '', holding_name: '', withheld: true }) : x));
}

function eventOut(ctx, e, opts) {
  const util = u();
  const app = ctx.app;
  const o = opts || {};
  const f = util.byId(app, 'entities', e.getString('fund'));
  const total = e.getInt('total_minor');
  const paid = paidOf(app, e.id);
  const lpData = L('lib_auth').fundDataVisible(ctx);
  const preview = util.jsonOf(e, 'preview', null);
  const out = {
    id: e.id,
    number: e.getString('number'),
    kind: e.getString('kind'),
    status: e.getString('status'),
    fund: e.getString('fund'),
    fund_name: f ? f.getString('short_name') || f.getString('name') : '',
    currency: e.getString('currency'),
    notice_day: e.getString('notice_day'),
    due_day: e.getString('due_day'),
    purposes: seenPurposes(ctx, e.getString('fund'), util.jsonOf(e, 'purposes', []) || []),
    total_minor: total,
    carry_minor: e.getInt('carry_minor'),
    note: e.getString('note'),
    note_by: e.getString('note_by'),
    note_at: e.getString('note_at'),
    narrative: e.getString('narrative'),
    hash: e.getString('hash'),
    issued_at: e.getString('issued_at'),
    voided_at: e.getString('voided_at'),
    void_reason: e.getString('void_reason'),
    paid_minor: paid,
    paid_ppm: total > 0 ? Math.min(1000000, Math.round((paid * 1000000) / total)) : null,
    lps: preview && preview.lines ? preview.lines.length : 0,
    steps: stepsOf(e, paid),
    agent: L('lib_agent').view(e, ['notice_review']),
    created: e.getString('created'),
  };
  if (!o.detail) return out;
  if (preview !== null) {
    const seenPreview = Object.assign({}, preview, { purposes: seenPurposes(ctx, e.getString('fund'), preview.purposes || []), holding: preview.holding && preview.holding.holding && F().seenHoldings(ctx, e.getString('fund'))[preview.holding.holding] === undefined ? null : preview.holding || null });
    out.preview = lpData ? seenPreview : { totals: preview.totals, fee: preview.fee || null, waterfall: preview.waterfall || null, holding: seenPreview.holding, lines: [], hidden: (preview.lines || []).length };
  }
  if (e.getString('status') !== 'draft' && e.getString('status') !== 'previewed') {
    const lines = util.rows(
      app,
      "SELECT l.id, l.lp, p.name AS lp_name, l.total_minor, l.amounts, l.balances, l.outbound, l.notice, COALESCE((SELECT SUM(x.amount_minor) FROM payments x WHERE x.line = l.id AND x.voided_at = ''), 0) AS paid, COALESCE((SELECT o.status FROM outbound o WHERE o.id = l.outbound), '') AS sent FROM capital_lines l JOIN lps p ON p.id = l.lp WHERE l.event = {:e} ORDER BY l.total_minor DESC, p.name",
      { id: '', lp: '', lp_name: '', total_minor: 0, amounts: '', balances: '', outbound: '', notice: '', paid: 0, sent: '' },
      { e: e.id },
    );
    out.lines = lpData
      ? lines.map((l) => ({ id: l.id, lp: l.lp, lp_name: l.lp_name, total_minor: l.total_minor, amounts: JSON.parse(l.amounts || '{}'), balances: JSON.parse(l.balances || '{}'), paid_minor: l.paid, left_minor: Math.max(0, l.total_minor - l.paid), paid_ppm: l.total_minor > 0 ? Math.min(1000000, Math.round((l.paid * 1000000) / l.total_minor)) : null, sent: l.sent || (l.outbound === '' ? 'no_email' : ''), has_notice: l.notice !== '' }))
      : [];
    out.hidden = lpData ? 0 : lines.length;
  }
  return out;
}

/* ------------------------------------------------------------------ calls */

function callsList(ctx, p) {
  const util = u();
  const app = ctx.app;
  const fundRef = util.str(p, 'fund', '');
  const kind = util.oneOf(p, 'kind', ['call', 'distribution'], '');
  const status = util.oneOf(p, 'status', ['draft', 'previewed', 'issued', 'settled', 'void', 'open', 'all'], 'all');
  const funds = fundRef !== '' ? [F().fundOf(ctx, fundRef).id] : F().visibleFunds(ctx).map((v) => v.id);
  const where = [];
  const bind = {};
  if (kind !== '') {
    where.push('kind = {:k}');
    bind.k = kind;
  }
  if (status === 'open') where.push("(status = 'draft' || status = 'previewed' || status = 'issued')");
  else if (status !== 'all') {
    where.push('status = {:s}');
    bind.s = status;
  }
  const pg = util.page(p, 50, 300);
  const out = [];
  for (const fid of funds) {
    bind.f = fid;
    for (const e of util.findMany(app, 'capital_events', ['fund = {:f}'].concat(where).join(' && '), '-notice_day,-created', pg.offset + pg.limit, bind)) out.push(eventOut(ctx, e));
  }
  out.sort((a, b) => (a.notice_day < b.notice_day ? 1 : a.notice_day > b.notice_day ? -1 : a.number < b.number ? 1 : -1));
  return { events: out.slice(pg.offset, pg.offset + pg.limit), total: out.length };
}

function callsGet(ctx, p) {
  return { event: eventOut(ctx, eventRef(ctx, u().req(p, 'event')), { detail: true }) };
}

function dayParams(ctx, p, e) {
  const util = u();
  const app = ctx.app;
  const notice = util.day(p, 'notice_day', e !== null ? e.getString('notice_day') : util.today(app));
  const dueDefault = L('lib_eng_days').addBusinessDays(notice, Number(L('lib_settings').moduleOf(app, 'funds').notice_business_days) || 10, {});
  const due = util.day(p, 'due_day', e !== null && !util.has(p, 'notice_day') ? e.getString('due_day') : dueDefault);
  if (due < notice) throw util.fail(400, 'due_day is before notice_day.', 'invalid_param', { param: 'due_day' });
  return { notice: notice, due: due };
}

function editable(e) {
  const st = e.getString('status');
  if (st !== 'draft' && st !== 'previewed') throw u().fail(409, e.getString('number') + ' is ' + st + '; only a draft changes. Void it and draft another.', 'conflict');
}

/** calls.draft: the call's purposes and days (step 1). Your AI agent's draft is a proposal. */
function callsDraft(ctx, p) {
  const util = u();
  const app = ctx.app;
  const ref = util.str(p, 'event', '');
  const e0 = ref !== '' ? eventRef(ctx, ref) : null;
  if (e0 !== null) {
    editable(e0);
    if (e0.getString('kind') !== 'call') throw util.fail(400, e0.getString('number') + ' is a distribution: use distributions.draft.', 'invalid_param', { param: 'event' });
  }
  const f = e0 !== null ? F().fundOf(ctx, e0.getString('fund')) : F().fundOf(ctx, util.str(p, 'fund', ''));
  const days = dayParams(ctx, p, e0);
  const purposes = callPurposes(ctx, f, p, days.notice);
  const e = e0 !== null ? e0 : util.newRecord(app, 'capital_events');
  if (e0 === null) {
    e.set('fund', f.id);
    e.set('kind', 'call');
    e.set('number', util.nextId(app, 'CC', 3));
    e.set('currency', f.getString('currency'));
    e.set('prov', {});
  }
  e.set('status', 'draft');
  e.set('notice_day', days.notice);
  e.set('due_day', days.due);
  e.set('purposes', purposes);
  e.set('total_minor', purposes.reduce((s, x) => s + (x.amount_minor || 0), 0));
  e.set('preview', null);
  e.set('note', '');
  e.set('note_by', '');
  e.set('note_at', '');
  if (util.has(p, 'narrative')) e.set('narrative', util.text(p, 'narrative', 4000, ''));
  e.set('actor', ctx.isAgent ? 'agent' : 'person');
  e.set('member', ctx.memberId || '');
  app.save(e);
  L('lib_audit').note(ctx, { collection: 'capital_events', record: e.id, summary: (e0 === null ? 'Drafted call ' : 'Changed call ') + e.getString('number') });
  return { event: eventOut(ctx, e, { detail: true }) };
}

function previewDraft(ctx, params) {
  const app = ctx.app;
  // Names, not ids: the fund, the holding's company, the amount with its currency, every param given (qa-cli CLI-21).
  let f = null;
  try {
    f = F().fundOf(ctx, params.fund || '');
  } catch {
    f = null;
  }
  const cur = f !== null ? f.getString('currency') : '';
  let holdingName = '';
  if (params.holding) {
    try {
      const h = L('lib_portfolio').holdingRef(ctx, String(params.holding), f !== null ? f.id : '');
      const c = u().byId(app, 'companies', h.getString('company'));
      holdingName = c !== null ? c.getString('name') : h.id;
    } catch {
      holdingName = String(params.holding);
    }
  }
  const LABELS = { fund: 'Fund', purpose: 'Purpose', amount: 'Amount', holding: 'Holding', label: 'Label', fees: 'Management fees', fee_from: 'Fee period from', fee_to: 'Fee period to', expenses: 'Expenses', purposes: 'Purposes', notice_day: 'Notice day', due_day: 'Due day', narrative: 'Description' };
  const fields = [];
  for (const k of Object.keys(LABELS)) {
    if (params[k] === undefined || params[k] === '') continue;
    let after = typeof params[k] === 'string' ? params[k] : JSON.stringify(params[k]);
    if (k === 'fund' && f !== null) after = f.getString('name');
    if (k === 'holding') after = holdingName;
    if ((k === 'amount' || k === 'expenses') && cur !== '') after = cur + ' ' + after;
    fields.push({ name: k, label: LABELS[k], before: '', after: after });
  }
  const what = holdingName !== '' ? ' for ' + holdingName : params.label ? ': ' + params.label : '';
  return { label: 'Capital call' + (f !== null ? ' of ' + f.getString('name') : '') + what, target: params.event ? 'capital_events:' + params.event : '', fields: fields, notes: params.label ? [String(params.label)] : [], risk: 'medium' };
}

function storePreview(ctx, e, pv) {
  const util = u();
  e.set('preview', Object.assign({}, pv, { computed_at: util.nowIso() }));
  e.set('total_minor', pv.kind === 'call' ? pv.totals.total_minor : pv.waterfall.gross_minor);
  e.set('carry_minor', pv.kind === 'distribution' ? pv.waterfall.carry_minor : 0);
  e.set('status', 'previewed');
  e.set('note', '');
  e.set('note_by', '');
  e.set('note_at', '');
  ctx.app.save(e);
}

/** agent.ask --trigger notice_review --record <capital event>: a previewed notice, before a person issues it. */
function reviewCheck(ctx, e) {
  L('lib_auth').need(ctx, 'funds', 'edit', 'ask your AI agent to review a notice');
  F().fundOf(ctx, e.getString('fund'));
  if (e.getString('status') !== 'previewed') throw u().fail(409, e.getString('number') + ' is ' + e.getString('status') + '; your AI agent reviews a notice after its preview and before it is issued.', 'conflict');
  return {};
}

/** agent.ask --trigger reconcile --record <statement>: a statement with differences still open. */
function reconcileCheck(ctx, s) {
  L('lib_auth').need(ctx, 'funds', 'edit', 'ask your AI agent to reconcile a statement');
  F().fundOf(ctx, s.getString('fund'));
  const open = (u().jsonOf(s, 'differences', []) || []).filter((d) => d.state !== 'resolved').length;
  if (open === 0) throw u().fail(409, 'Every difference of ' + s.getString('name') + ' is resolved.', 'nothing_open');
  return {};
}

/** calls.preview: every LP's line from the engine (step 2); Ask your AI agent then reviews it (trigger notice_review). */
function callsPreview(ctx, p) {
  const util = u();
  const e = eventRef(ctx, util.req(p, 'event'));
  editable(e);
  if (e.getString('kind') !== 'call') throw util.fail(400, 'Use distributions.preview for a distribution.', 'invalid_param', { param: 'event' });
  const f = F().fundOf(ctx, e.getString('fund'));
  const pv = callPreview(ctx.app, f, e);
  storePreview(ctx, e, pv);
  L('lib_audit').note(ctx, { collection: 'capital_events', record: e.id, summary: 'Previewed call ' + e.getString('number') + ': ' + F().fmt(pv.totals.total_minor, pv.currency) + ' over ' + pv.lines.length + ' LPs' });
  return { event: eventOut(ctx, e, { detail: true }) };
}

/** calls.note: the review note on a draft call or distribution (your AI agent's notice_review). */
function callsNote(ctx, p) {
  const util = u();
  const e = eventRef(ctx, util.req(p, 'event'));
  editable(e);
  const note = util.text(p, 'note', 8000, '');
  if (util.squash(note) === '') throw util.fail(400, 'note is required.', 'missing_param', { param: 'note' });
  e.set('note', note);
  e.set('note_by', ctx.isAgent ? 'agent' : 'person');
  e.set('note_at', util.nowIso());
  ctx.app.save(e);
  L('lib_audit').note(ctx, { collection: 'capital_events', record: e.id, summary: (ctx.isAgent ? 'Your AI agent reviewed ' : 'Review note on ') + e.getString('number') });
  return { event: eventOut(ctx, e) };
}

/** JSON with object keys sorted (stored JSON comes back with sorted keys). */
function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v !== null && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}

/** The part of a preview that must not move between preview and issue. */
function previewKey(pv) {
  return canon({ t: pv.totals, l: (pv.lines || []).map((l) => [l.lp, l.total_minor, l.amounts]) });
}

function noticeBody(firm, fundName, lpName, number, kind, amount, due) {
  return kind === 'call'
    ? 'Dear ' + lpName + ',\n\nPlease find attached capital call notice ' + number + ' (' + fundName + '). Your portion is ' + amount + ', due on ' + due + '. The notice holds the details and the wire instructions; the CSV holds the ILPA template lines.\n\nBefore you send funds, confirm the wire instructions by phone with a contact you already know at ' + firm + '. We never change wire instructions by email.\n\n' + firm
    : 'Dear ' + lpName + ',\n\nPlease find attached distribution notice ' + number + ' (' + fundName + '). Your portion is ' + amount + ', paid on ' + due + ' to the account you have on file. The CSV holds the ILPA template lines.\n\n' + firm;
}

/**
 * calls.issue / distributions.issue (PIN, step 3): fixes the preview, writes
 * the ledger, renders each LP's notice and approves its message (the minute
 * job sends them, at most 20 a minute). Not undoable: void it instead.
 */
function issue(ctx, p, kind) {
  const util = u();
  const app = ctx.app;
  const e0 = eventRef(ctx, util.req(p, 'event'));
  if (e0.getString('kind') !== kind) throw util.fail(400, e0.getString('number') + ' is a ' + e0.getString('kind') + '.', 'invalid_param', { param: 'event' });
  if (e0.getString('status') !== 'previewed') throw util.fail(409, e0.getString('number') + ' is ' + e0.getString('status') + '; preview it before issuing.', 'not_previewed');
  const f = F().fundOf(ctx, e0.getString('fund'));
  const fresh = kind === 'call' ? callPreview(app, f, e0) : distPreview(app, f, e0);
  const stored = util.jsonOf(e0, 'preview', {}) || {};
  if (previewKey(fresh) !== previewKey(stored)) throw util.fail(409, 'The figures changed since the preview (commitments or the ledger moved). Preview again.', 'stale_preview');
  let wire = null;
  if (kind === 'call') {
    const LPS = L('lib_funds_lps');
    let blk = LPS.activeBlock(app, f.id);
    if (blk === null && f.getString('parent') !== '') blk = LPS.activeBlock(app, f.getString('parent'));
    if (blk === null) throw util.fail(409, 'Add and approve wire details for ' + f.getString('name') + ' first (Settings, Funds).', 'no_wire');
    wire = LPS.detailsOf(app, blk);
  }
  const firm = firmName(app);
  const cur = f.getString('currency');
  const fundInfo = { name: f.getString('name'), legal_name: f.getString('legal_name'), currency: cur };
  const fee = fresh.fee ? { from_day: fresh.fee.from_day, to_day: fresh.fee.to_day, rate_text: L('lib_funds_docs').pct(fresh.fee.rate_ppm), basis: fresh.fee.basis } : null;
  // Every LP's notice is drawn first (one engine run), so a drawing failure issues nothing.
  const DOCS = L('lib_funds_docs');
  const purposes0 = util.jsonOf(e0, 'purposes', []) || [];
  const docIns = fresh.lines.map((line) => {
    const lpRec = app.findRecordById('lps', line.lp);
    const contacts = util.jsonOf(lpRec, 'contacts', []) || [];
    const attention = contacts.filter((x) => x.primary)[0] || contacts[0];
    return { firm: firm, fund: fundInfo, lp: { name: line.lp_name, attention: attention ? attention.name : '', country: lpRec.getString('country') }, kind: kind, number: e0.getString('number'), notice_day: e0.getString('notice_day'), due_day: e0.getString('due_day'), narrative: e0.getString('narrative'), purposes: purposes0, line: line, totals: fresh.totals, fee: fee, wire: wire, waterfall: fresh.waterfall || null, holding: fresh.holding || null };
  });
  const pdfs = DOCS.render(app, docIns.map((d) => DOCS.noticeDoc(d)));
  const outIds = [];
  const noEmail = [];
  const hash = util.sha(JSON.stringify({ number: e0.getString('number'), notice: e0.getString('notice_day'), due: e0.getString('due_day'), purposes: util.jsonOf(e0, 'purposes', []), totals: fresh.totals, lines: fresh.lines.map((l) => [l.lp, l.total_minor, l.amounts]) }));
  app.runInTransaction((tx) => {
    const c = Object.assign({}, ctx, { app: tx });
    const e = tx.findRecordById('capital_events', e0.id);
    if (e.getString('status') !== 'previewed') throw util.fail(409, 'Already ' + e.getString('status') + '.', 'conflict');
    const number = e.getString('number');
    const due = e.getString('due_day');
    e.set('status', 'issued');
    e.set('issued_at', util.nowIso());
    e.set('issued_by', ctx.memberId || '');
    e.set('hash', hash);
    e.set('preview', Object.assign({}, fresh, { computed_at: util.nowIso() }));
    tx.save(e);
    const ledger = (o) => {
      const r = util.newRecord(tx, 'ledger');
      r.set('fund', f.id);
      r.set('lp', o.lp || '');
      r.set('holding', o.holding || '');
      r.set('event', e.id);
      r.set('day', due);
      r.set('type', o.type);
      r.set('amount_minor', o.amount_minor);
      r.set('recallable_minor', o.recallable_minor || 0);
      r.set('currency', cur);
      r.set('origin', kind === 'call' ? 'call' : 'distribution');
      r.set('reverses', '');
      r.set('note', number);
      r.set('actor', 'person');
      r.set('member', ctx.memberId || '');
      tx.save(r);
    };
    const purposes = util.jsonOf(e, 'purposes', []) || [];
    for (let i = 0; i < fresh.lines.length; i++) {
      const line = fresh.lines[i];
      const lpRec = tx.findRecordById('lps', line.lp);
      const docIn = docIns[i];
      const l = util.newRecord(tx, 'capital_lines');
      l.set('event', e.id);
      l.set('lp', line.lp);
      l.set('commitment', line.commitment);
      l.set('amounts', line.amounts);
      l.set('total_minor', line.total_minor);
      l.set('balances', line.balances);
      const base = number + '-' + (util.slug(line.lp_name) || line.lp);
      l.set('notice', $filesystem.fileFromBytes(pdfs[i], base + '.pdf'));
      l.set('notice_csv', $filesystem.fileFromBytes(DOCS.noticeCsv(docIn), base + '.csv'));
      l.set('outbound', '');
      tx.save(l);
      for (const t of Object.keys(line.amounts)) {
        const amt = line.amounts[t];
        if (amt === 0 && !(t === 'dist_capital' && line.recallable_minor > 0)) continue;
        ledger({ lp: line.lp, type: t, amount_minor: amt, recallable_minor: t === 'dist_capital' ? line.recallable_minor || 0 : 0 });
      }
      const emails = L('lib_funds_lps').noticeEmails(lpRec);
      if (emails.length === 0) {
        noEmail.push(line.lp_name);
        continue;
      }
      const ob = L('lib_outbound').draft(c, {
        kind: 'notice',
        module: 'funds',
        to: emails,
        subject: (kind === 'call' ? 'Capital call ' : 'Distribution ') + number + ': ' + (f.getString('short_name') || f.getString('name')),
        body: noticeBody(firm, f.getString('legal_name') || f.getString('name'), line.lp_name, number, kind, F().fmt(line.total_minor, cur), due),
        attachments: [
          { collection: 'capital_lines', id: l.id, field: 'notice' },
          { collection: 'capital_lines', id: l.id, field: 'notice_csv' },
        ],
        ref_collection: 'capital_lines',
        ref_id: l.id,
      });
      l.set('outbound', ob.id);
      tx.save(l);
      outIds.push(ob.id);
    }
    if (kind === 'call') {
      for (const pu of purposes) if ((pu.type === 'investment' || pu.type === 'recall') && pu.holding) ledger({ holding: pu.holding, type: 'investment', amount_minor: pu.amount_minor });
    } else {
      const pu = purposes[0] || {};
      if (fresh.waterfall.carry_minor > 0) ledger({ type: 'carry', amount_minor: fresh.waterfall.carry_minor });
      if (pu.holding && pu.proceeds_minor > 0) ledger({ holding: pu.holding, type: 'proceeds', amount_minor: pu.proceeds_minor });
    }
    if (kind === 'call') L('lib_events').emit(c, 'call.issued', { event: e.id });
  });
  // The files are on disk now: approve each message (the minute job sends them).
  if (outIds.length > 0) {
    app.runInTransaction((tx) => {
      const c = Object.assign({}, ctx, { app: tx });
      for (const id of outIds) L('lib_outbound').approve(c, id);
    });
  }
  L('lib_audit').note(ctx, { collection: 'capital_events', record: e0.id, summary: 'Issued ' + (kind === 'call' ? 'call ' : 'distribution ') + e0.getString('number') + ': ' + F().fmt(fresh.totals.total_minor, cur) + ' to ' + fresh.lines.length + ' LPs' });
  const out = eventOut(ctx, app.findRecordById('capital_events', e0.id), { detail: true });
  out.queued = outIds.length;
  out.no_email = noEmail;
  return { event: out };
}

function callsIssue(ctx, p) {
  return issue(ctx, p, 'call');
}

function distributionsIssue(ctx, p) {
  return issue(ctx, p, 'distribution');
}

/** calls.void (PIN): a draft is dropped; an issued notice without payments is reversed in the ledger (rows are never edited). */
function callsVoid(ctx, p) {
  const util = u();
  const app = ctx.app;
  const e = eventRef(ctx, util.req(p, 'event'));
  const st = e.getString('status');
  if (st === 'void') throw util.fail(409, e.getString('number') + ' is already void.', 'conflict');
  const reason = util.text(p, 'reason', 600, '');
  let voidNotices = 0;
  if (st === 'issued' || st === 'settled') {
    if (paidOf(app, e.id) > 0) throw util.fail(409, 'Payments are recorded on ' + e.getString('number') + '. Undo them first, or issue a correcting notice.', 'payments_recorded');
    for (const r of util.findMany(app, 'ledger', "event = {:e} && origin != 'void'", 'created', 0, { e: e.id })) {
      const x = util.newRecord(app, 'ledger');
      for (const k of ['fund', 'lp', 'holding', 'event', 'day', 'type', 'currency']) x.set(k, r.get(k));
      x.set('amount_minor', -r.getInt('amount_minor'));
      x.set('recallable_minor', -r.getInt('recallable_minor'));
      x.set('origin', 'void');
      x.set('reverses', r.id);
      x.set('note', 'Void ' + e.getString('number'));
      x.set('actor', 'person');
      x.set('member', ctx.memberId || '');
      app.save(x);
    }
    const f = app.findRecordById('entities', e.getString('fund'));
    const firm = firmName(app);
    const call = e.getString('kind') === 'call';
    for (const l of util.findMany(app, 'capital_lines', 'event = {:e}', '', 0, { e: e.id })) {
      const ob = l.getString('outbound') !== '' ? util.byId(app, 'outbound', l.getString('outbound')) : null;
      if (ob !== null && ['draft', 'approved', 'failed'].indexOf(ob.getString('status')) >= 0) {
        ob.set('status', 'cancelled');
        app.save(ob);
        continue;
      }
      // The LP received the notice: a void notice waits in Next for a person to approve and send.
      if (ob === null || (ob.getString('status') !== 'sent' && ob.getString('status') !== 'sending')) continue;
      const lp = app.findRecordById('lps', l.getString('lp'));
      const emails = L('lib_funds_lps').noticeEmails(lp);
      if (emails.length === 0) continue;
      const fundName = f.getString('legal_name') || f.getString('name');
      L('lib_outbound').draft(ctx, {
        kind: 'notice',
        module: 'funds',
        to: emails,
        subject: 'Void: ' + (call ? 'capital call ' : 'distribution ') + e.getString('number') + ' (' + (f.getString('short_name') || f.getString('name')) + ')',
        body: 'Dear ' + lp.getString('name') + ',\n\n' + (call ? 'Capital call notice ' : 'Distribution notice ') + e.getString('number') + ' of ' + fundName + ' dated ' + e.getString('notice_day') + ' is void' + (reason !== '' ? ': ' + reason : '') + '. ' + (call ? 'Please do not send the ' + F().fmt(l.getInt('total_minor'), e.getString('currency')) + ' it asked for. ' : 'No payment will be made under it. ') + 'Your capital account is as it was before the notice.\n\nIf you have any question, call a contact you already know at ' + firm + '.\n\n' + firm,
        ref_collection: 'capital_lines',
        ref_id: l.id,
      });
      voidNotices++;
    }
  }
  e.set('status', 'void');
  e.set('voided_at', util.nowIso());
  e.set('voided_by', ctx.memberId || '');
  e.set('void_reason', reason);
  app.save(e);
  L('lib_audit').note(ctx, { collection: 'capital_events', record: e.id, summary: 'Voided ' + e.getString('number') + (reason !== '' ? ': ' + reason : '') + (voidNotices > 0 ? ' (' + voidNotices + ' void notices drafted)' : '') });
  return { event: eventOut(ctx, e, { detail: true }), void_notices: voidNotices };
}

/* ---------------------------------------------------------- distributions */

/** distributions.draft: the gross amount, source holding and proceeds, recallable part and days. Your AI agent's draft is a proposal. */
function distributionsDraft(ctx, p) {
  const util = u();
  const app = ctx.app;
  const ref = util.str(p, 'event', '');
  const e0 = ref !== '' ? eventRef(ctx, ref) : null;
  if (e0 !== null) {
    editable(e0);
    if (e0.getString('kind') !== 'distribution') throw util.fail(400, e0.getString('number') + ' is a call: use calls.draft.', 'invalid_param', { param: 'event' });
  }
  const f = e0 !== null ? F().fundOf(ctx, e0.getString('fund')) : F().fundOf(ctx, util.str(p, 'fund', ''));
  const cur = f.getString('currency');
  const old = e0 !== null ? (util.jsonOf(e0, 'purposes', []) || [])[0] || {} : {};
  const amount = util.has(p, 'amount') ? moneyOf(p, 'amount', cur, { required: true, positive: true }) : old.amount_minor;
  if (!amount || amount <= 0) throw util.fail(400, 'amount is required, e.g. --amount 2500000.00', 'missing_param', { param: 'amount' });
  const holding = util.has(p, 'holding') ? util.str(p, 'holding', '') : old.holding || '';
  if (holding !== '') F().seenHolding(ctx, f, holding);
  const proceeds = util.has(p, 'proceeds') ? moneyOf(p, 'proceeds', cur, {}) || 0 : old.proceeds_minor || 0;
  const recallable = util.has(p, 'recallable') ? moneyOf(p, 'recallable', cur, {}) || 0 : old.recallable_minor || 0;
  if (recallable > amount) throw util.fail(400, 'recallable cannot be more than the amount.', 'invalid_amount', { param: 'recallable' });
  const days = dayParams(ctx, p, e0);
  const e = e0 !== null ? e0 : util.newRecord(app, 'capital_events');
  if (e0 === null) {
    e.set('fund', f.id);
    e.set('kind', 'distribution');
    e.set('number', util.nextId(app, 'DI', 3));
    e.set('currency', cur);
    e.set('prov', {});
  }
  e.set('status', 'draft');
  e.set('notice_day', days.notice);
  e.set('due_day', days.due);
  e.set('purposes', [{ type: 'distribution', amount_minor: amount, holding: holding, holding_name: holding !== '' ? holdingName(app, f.id, holding) : '', proceeds_minor: proceeds, recallable_minor: recallable }]);
  e.set('total_minor', amount);
  e.set('preview', null);
  e.set('note', '');
  e.set('note_by', '');
  e.set('note_at', '');
  if (util.has(p, 'narrative')) e.set('narrative', util.text(p, 'narrative', 4000, ''));
  e.set('actor', ctx.isAgent ? 'agent' : 'person');
  e.set('member', ctx.memberId || '');
  app.save(e);
  L('lib_audit').note(ctx, { collection: 'capital_events', record: e.id, summary: (e0 === null ? 'Drafted distribution ' : 'Changed distribution ') + e.getString('number') });
  return { event: eventOut(ctx, e, { detail: true }) };
}

function previewDistDraft(ctx, params) {
  const fields = [];
  for (const k of ['fund', 'amount', 'holding', 'proceeds', 'recallable', 'notice_day', 'due_day']) if (params[k] !== undefined && params[k] !== '') fields.push({ name: k, before: '', after: String(params[k]) });
  return { label: 'Draft a distribution', target: params.event ? 'capital_events:' + params.event : '', fields: fields, risk: 'medium' };
}

function distributionsPreview(ctx, p) {
  const util = u();
  const e = eventRef(ctx, util.req(p, 'event'));
  editable(e);
  if (e.getString('kind') !== 'distribution') throw util.fail(400, 'Use calls.preview for a call.', 'invalid_param', { param: 'event' });
  const f = F().fundOf(ctx, e.getString('fund'));
  const pv = distPreview(ctx.app, f, e);
  storePreview(ctx, e, pv);
  L('lib_audit').note(ctx, { collection: 'capital_events', record: e.id, summary: 'Previewed distribution ' + e.getString('number') });
  return { event: eventOut(ctx, e, { detail: true }) };
}

/** waterfall.preview: what a gross distribution would pay the GP and LPs today (an estimate until the administrator confirms). */
function waterfallPreview(ctx, p) {
  const util = u();
  const f = F().fundOf(ctx, util.str(p, 'fund', ''));
  const amount = moneyOf(p, 'amount', f.getString('currency'), { required: true, positive: true });
  const day = util.day(p, 'day', util.today(ctx.app));
  const holding = util.str(p, 'holding', '');
  return { fund: { id: f.id, name: f.getString('name'), currency: f.getString('currency') }, day: day, waterfall: waterfallFor(ctx.app, f, amount, day, holding, '') };
}

/* --------------------------------------------------------------- payments */

function lineRef(ctx, p) {
  const util = u();
  const app = ctx.app;
  let l = null;
  if (util.str(p, 'line', '') !== '') l = util.byId(app, 'capital_lines', util.str(p, 'line', ''));
  else if (util.str(p, 'event', '') !== '' && util.str(p, 'lp', '') !== '') {
    const e = eventRef(ctx, util.str(p, 'event', ''));
    const lp = L('lib_funds_lps').lpRef(ctx, util.str(p, 'lp', ''));
    l = util.findOne(app, 'capital_lines', 'event = {:e} && lp = {:l}', { e: e.id, l: lp.id });
  } else throw util.fail(400, 'Give --line, or --event and --lp.', 'missing_param', { param: 'line' });
  if (l === null) throw util.fail(404, 'No such line on an issued notice.', 'not_found', { param: 'line' });
  eventRef(ctx, l.getString('event'));
  return l;
}

function linePaid(app, lineId) {
  return u().one(app, "SELECT COALESCE(SUM(amount_minor), 0) AS n FROM payments WHERE line = {:l} AND voided_at = ''", { n: 0 }, { l: lineId }).n;
}

function paymentsList(ctx, p) {
  F().needLpData(ctx);
  const util = u();
  const app = ctx.app;
  const today = util.today(app);
  const evRef = util.str(p, 'event', '');
  const events = evRef !== '' ? [eventRef(ctx, evRef)] : util.findMany(app, 'capital_events', "(status = 'issued' || status = 'settled') && fund = {:f}", '-due_day', 100, { f: F().fundOf(ctx, util.str(p, 'fund', '')).id });
  const lines = [];
  for (const e of events) {
    for (const l of util.rows(app, "SELECT l.id, l.lp, x.name AS lp_name, l.total_minor FROM capital_lines l JOIN lps x ON x.id = l.lp WHERE l.event = {:e} ORDER BY x.name", { id: '', lp: '', lp_name: '', total_minor: 0 }, { e: e.id })) {
      const paid = linePaid(app, l.id);
      const left = Math.max(0, l.total_minor - paid);
      const state = left === 0 ? 'paid' : paid > 0 ? 'partial' : e.getString('due_day') < today ? 'overdue' : 'due';
      if (util.bool(p, 'open', false) && left === 0) continue;
      lines.push({ line: l.id, event: e.id, number: e.getString('number'), kind: e.getString('kind'), lp: l.lp, lp_name: l.lp_name, due_day: e.getString('due_day'), currency: e.getString('currency'), total_minor: l.total_minor, paid_minor: paid, left_minor: left, state: state, payments: util.findMany(app, 'payments', "line = {:l} && voided_at = ''", 'day', 50, { l: l.id }).map((x) => ({ id: x.id, amount_minor: x.getInt('amount_minor'), day: x.getString('day'), reference: x.getString('reference'), source: x.getString('source') })) });
    }
  }
  return { lines: lines, overdue: lines.filter((x) => x.state === 'overdue').length };
}

/** payments.record: money received for (or paid out on) an LP's line; the event settles when every line is paid. Your AI agent's match is a proposal. */
function paymentsRecord(ctx, p) {
  F().needLpData(ctx);
  const util = u();
  const app = ctx.app;
  const l = lineRef(ctx, p);
  const e = app.findRecordById('capital_events', l.getString('event'));
  if (e.getString('status') !== 'issued' && e.getString('status') !== 'settled') throw util.fail(409, e.getString('number') + ' is ' + e.getString('status') + '.', 'conflict');
  const cur = e.getString('currency');
  const left = l.getInt('total_minor') - linePaid(app, l.id);
  if (left <= 0) throw util.fail(409, 'This line is already paid in full.', 'already_paid');
  const amount = util.has(p, 'amount') ? moneyOf(p, 'amount', cur, { required: true, positive: true }) : left;
  if (amount > left) throw util.fail(409, 'That is more than the ' + F().fmt(left, cur) + ' still due on this line.', 'over_payment', { left_minor: left });
  const r = util.newRecord(app, 'payments');
  r.set('event', e.id);
  r.set('line', l.id);
  r.set('lp', l.getString('lp'));
  r.set('amount_minor', amount);
  r.set('day', util.day(p, 'day', util.today(app)));
  r.set('reference', util.text(p, 'reference', 200, ''));
  r.set('source', util.oneOf(p, 'source', ['manual', 'statement', 'reconcile'], 'manual'));
  r.set('statement', util.str(p, 'statement', ''));
  r.set('voided_at', '');
  r.set('actor', ctx.isAgent ? 'agent' : 'person');
  r.set('member', ctx.memberId || '');
  app.save(r);
  const total = e.getInt('total_minor');
  if (e.getString('status') === 'issued' && total > 0 && paidOf(app, e.id) >= total) {
    e.set('status', 'settled');
    app.save(e);
  }
  const lp = app.findRecordById('lps', l.getString('lp'));
  L('lib_audit').note(ctx, { collection: 'payments', record: r.id, summary: 'Recorded ' + F().fmt(amount, cur) + ' from ' + lp.getString('name') + ' on ' + e.getString('number') });
  return { payment: { id: r.id, amount_minor: amount, day: r.getString('day') }, line: { id: l.id, paid_minor: linePaid(app, l.id), total_minor: l.getInt('total_minor') }, event: eventOut(ctx, e) };
}

function previewPayment(ctx, params) {
  const util = u();
  const l = params.line ? util.byId(ctx.app, 'capital_lines', String(params.line)) : null;
  const e = l !== null ? util.byId(ctx.app, 'capital_events', l.getString('event')) : null;
  const lp = l !== null ? util.byId(ctx.app, 'lps', l.getString('lp')) : null;
  return { label: 'Record a payment' + (lp ? ' from ' + lp.getString('name') : '') + (e ? ' on ' + e.getString('number') : ''), target: l !== null ? 'capital_lines:' + l.id : '', fields: ['amount', 'day', 'reference'].filter((k) => params[k] !== undefined).map((k) => ({ name: k, before: '', after: String(params[k]) })), risk: 'medium' };
}

/** payments.remind (people): a reminder with the notice attached to an LP whose payment is late (sent within a minute). */
function paymentsRemind(ctx, p) {
  F().needLpData(ctx);
  const util = u();
  const app = ctx.app;
  const l = lineRef(ctx, p);
  const e = app.findRecordById('capital_events', l.getString('event'));
  const lp = app.findRecordById('lps', l.getString('lp'));
  const f = app.findRecordById('entities', e.getString('fund'));
  const emails = L('lib_funds_lps').noticeEmails(lp);
  if (emails.length === 0) throw util.fail(409, lp.getString('name') + ' has no contact for notices. Add one on the LP.', 'no_email');
  const left = l.getInt('total_minor') - linePaid(app, l.id);
  if (left <= 0) throw util.fail(409, 'This line is paid.', 'already_paid');
  const firm = firmName(app);
  const ob = L('lib_outbound').draft(ctx, {
    kind: 'notice',
    module: 'funds',
    to: emails,
    subject: 'Reminder: capital call ' + e.getString('number') + ' for ' + (f.getString('short_name') || f.getString('name')),
    body: 'Dear ' + lp.getString('name') + ',\n\nOur records show ' + F().fmt(left, e.getString('currency')) + ' of capital call ' + e.getString('number') + ' (due ' + e.getString('due_day') + ') is still outstanding. The notice is attached again. If you have already sent it, thank you, and please let us know the date and reference.\n\nBefore you send funds, confirm the wire instructions by phone with a contact you already know at ' + firm + '. We never change wire instructions by email.\n\n' + firm,
    attachments: l.getString('notice') !== '' ? [{ collection: 'capital_lines', id: l.id, field: 'notice' }] : [],
    ref_collection: 'capital_lines',
    ref_id: l.id,
  });
  const sent = L('lib_outbound').approve(ctx, ob.id);
  L('lib_audit').note(ctx, { collection: 'outbound', record: ob.id, summary: 'Reminded ' + lp.getString('name') + ' of ' + e.getString('number') });
  return { message: { id: sent.id, status: sent.status, to: emails } };
}

/* ----------------------------------------------------------------- ledger */

function ledgerList(ctx, p) {
  F().needLpData(ctx);
  const util = u();
  const app = ctx.app;
  const f = F().fundOf(ctx, util.str(p, 'fund', ''));
  const where = ['g.fund = {:f}'];
  const bind = { f: f.id };
  const lpRef0 = util.str(p, 'lp', '');
  if (lpRef0 !== '') {
    where.push('g.lp = {:lp}');
    bind.lp = L('lib_funds_lps').lpRef(ctx, lpRef0).id;
  }
  const holding = util.str(p, 'holding', '');
  if (holding !== '') {
    where.push('g.holding = {:h}');
    bind.h = holding;
  }
  const type = util.str(p, 'type', '');
  if (type !== '') {
    where.push('g.type = {:t}');
    bind.t = type;
  }
  const from = util.day(p, 'from', '');
  if (from !== '') {
    where.push('g.day >= {:a}');
    bind.a = from;
  }
  const to = util.day(p, 'to', '');
  if (to !== '') {
    where.push('g.day <= {:b}');
    bind.b = to;
  }
  const pg = util.page(p, 100, 1000);
  bind.l = pg.limit;
  bind.o = pg.offset;
  const rows = F().plainRows(app, "SELECT g.id, g.day, g.type, g.amount_minor, g.recallable_minor, g.origin, g.lp, COALESCE(l.name, '') AS lp_name, g.holding, g.event, COALESCE(e.number, '') AS number, g.note, g.reverses FROM ledger g LEFT JOIN lps l ON l.id = g.lp LEFT JOIN capital_events e ON e.id = g.event WHERE " + where.join(' AND ') + ' ORDER BY g.day DESC, g.created DESC LIMIT {:l} OFFSET {:o}', { id: '', day: '', type: '', amount_minor: 0, recallable_minor: 0, origin: '', lp: '', lp_name: '', holding: '', event: '', number: '', note: '', reverses: '' }, bind);
  const total = util.count(app, 'SELECT COUNT(*) AS n FROM ledger g WHERE ' + where.join(' AND '), bind);
  // A row of a holding the caller may not see keeps its amount (the fund's books) and withholds the holding.
  const names = F().seenHoldings(ctx, f.id);
  let hidden = 0;
  for (const r of rows) {
    if (r.holding !== '' && names[r.holding] === undefined) {
      r.holding = '';
      r.holding_name = '';
      r.withheld = true;
      hidden++;
    } else r.holding_name = r.holding !== '' ? names[r.holding].name : '';
  }
  return { fund: { id: f.id, name: f.getString('name'), currency: f.getString('currency') }, rows: rows, total: total, hidden: hidden };
}

/** ledger.opening (PIN): the capital accounts and holdings at cost of a fund moving in; before anything else is on its ledger. */
function ledgerOpening(ctx, p) {
  F().needLpData(ctx);
  const util = u();
  const app = ctx.app;
  const f = F().fundOf(ctx, util.req(p, 'fund'));
  const cur = f.getString('currency');
  const day = util.day(p, 'day', '');
  if (day === '') throw util.fail(400, 'day is required: the opening balances are as of that day.', 'missing_param', { param: 'day' });
  if (util.count(app, 'SELECT COUNT(*) AS n FROM ledger WHERE fund = {:f}', { f: f.id }) > 0) throw util.fail(409, f.getString('name') + ' already has entries on its ledger; opening balances come first.', 'opening_exists');
  const lps = util.list(p, 'lps') || [];
  const holdings = util.list(p, 'holdings') || [];
  const cash = moneyOf(p, 'cash', cur, { allowNegative: true });
  if (lps.length === 0 && holdings.length === 0 && cash === null) throw util.fail(400, 'Give --lps, --holdings or --cash.', 'missing_param', { param: 'lps' });
  const add = (o) => {
    const r = util.newRecord(app, 'ledger');
    r.set('fund', f.id);
    r.set('lp', o.lp || '');
    r.set('holding', o.holding || '');
    r.set('event', '');
    r.set('day', o.day || day);
    r.set('type', o.type);
    r.set('amount_minor', o.amount_minor);
    r.set('recallable_minor', 0);
    r.set('currency', cur);
    r.set('origin', 'opening');
    r.set('reverses', '');
    r.set('note', 'Opening balance');
    r.set('actor', 'person');
    r.set('member', ctx.memberId || '');
    app.save(r);
  };
  let n = 0;
  lps.forEach((x, i) => {
    const w = 'lps[' + i + ']';
    util.keysOnly(x, ['lp', 'contributed', 'distributed', 'recallable', 'recalled'], w);
    const lp = L('lib_funds_lps').lpRef(ctx, x.lp);
    const v = {};
    for (const k of ['contributed', 'distributed', 'recallable', 'recalled']) v[k] = amountIn(x[k], cur, w + '.' + k) || 0;
    if (v.recallable > v.distributed) throw util.fail(400, w + ': recallable cannot exceed distributed.', 'invalid_amount', { param: 'lps' });
    for (const k of Object.keys(v)) if (v[k] > 0) add({ lp: lp.id, type: 'opening_' + k, amount_minor: v[k] });
    n++;
  });
  const hm = F().seenHoldings(ctx, f.id);
  holdings.forEach((x, i) => {
    const w = 'holdings[' + i + ']';
    util.keysOnly(x, ['holding', 'cost', 'day'], w);
    if (hm[x.holding] === undefined) throw util.fail(404, w + ': no holding ' + x.holding + ' you can see in ' + f.getString('name') + '.', 'not_found', { param: 'holdings' });
    const cost = amountIn(x.cost, cur, w + '.cost');
    if (cost === null || cost <= 0) throw util.fail(400, w + '.cost must be more than 0.', 'invalid_amount', { param: 'holdings' });
    const d = x.day ? String(x.day) : day;
    if (!util.isDay(d) || d > day) throw util.fail(400, w + '.day is a day on or before the opening day.', 'invalid_param', { param: 'holdings' });
    add({ holding: x.holding, type: 'investment', amount_minor: cost, day: d });
  });
  if (cash !== null && cash !== 0) add({ type: 'opening_cash', amount_minor: cash });
  L('lib_audit').note(ctx, { collection: 'ledger', summary: 'Opening balances for ' + f.getString('name') + ' as of ' + day + ': ' + n + ' LPs, ' + holdings.length + ' holdings' });
  return { fund: f.id, day: day, lps: n, holdings: holdings.length, metrics: F().metrics(app, f.id, day) };
}

/** ledger.record (people): a fund-to-company flow outside a call or distribution (an investment paid from cash, proceeds received). */
function ledgerRecord(ctx, p) {
  const util = u();
  const app = ctx.app;
  const f = F().fundOf(ctx, util.req(p, 'fund'));
  const cur = f.getString('currency');
  const type = util.oneOf(p, 'type', ['investment', 'proceeds'], '');
  if (type === '') throw util.fail(400, 'type is investment or proceeds.', 'missing_param', { param: 'type' });
  const holding = util.req(p, 'holding');
  F().seenHolding(ctx, f, holding);
  const amount = moneyOf(p, 'amount', cur, { required: true, positive: true });
  const r = util.newRecord(app, 'ledger');
  r.set('fund', f.id);
  r.set('lp', '');
  r.set('holding', holding);
  r.set('event', '');
  r.set('day', util.day(p, 'day', util.today(app)));
  r.set('type', type);
  r.set('amount_minor', amount);
  r.set('recallable_minor', 0);
  r.set('currency', cur);
  r.set('origin', 'manual');
  r.set('reverses', '');
  r.set('note', util.text(p, 'note', 600, ''));
  r.set('actor', 'person');
  r.set('member', ctx.memberId || '');
  app.save(r);
  L('lib_audit').note(ctx, { collection: 'ledger', record: r.id, summary: 'Recorded ' + type + ' of ' + F().fmt(amount, cur) });
  return { row: { id: r.id, day: r.getString('day'), type: type, amount_minor: amount, holding: holding } };
}

/* ------------------------------------------------------------- statements */

const ADMIN_COLS = { lp: ['lp', 'limitedpartner', 'investor', 'partner', 'name', 'lpname', 'investorname'], contributed: ['contributed', 'paidin', 'contributions', 'contributedcapital', 'called', 'paidincapital'], distributed: ['distributed', 'distributions'], recallable: ['recallable', 'recallablecapital'], nav: ['nav', 'endingcapital', 'capitalbalance', 'endingbalance', 'closingcapital', 'endingcapitalbalance'] };
const BANK_COLS = { day: ['day', 'date', 'valuedate', 'bookingdate', 'transactiondate'], amount: ['amount', 'credit', 'received', 'creditamount'], reference: ['reference', 'ref', 'description', 'memo', 'details'], payer: ['payer', 'from', 'counterparty', 'remitter', 'name', 'ordering'] };

function normKey(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/** Rows (objects) -> objects keyed by our column names (header synonyms). */
function mapRows(rows, cols) {
  const keys = {};
  for (const k of Object.keys(cols)) for (const s of cols[k]) keys[s] = k;
  return rows.map((r) => {
    const o = {};
    for (const h of Object.keys(r || {})) {
      const k = keys[normKey(h)];
      if (k !== undefined && o[k] === undefined) o[k] = r[h];
    }
    return o;
  });
}

function differencesOf(app, f, source, periodEnd, rows) {
  const util = u();
  const cur = f.getString('currency');
  const out = [];
  if (source === 'administrator') {
    const day = periodEnd || util.today(app);
    const b = F().books(app, f, day);
    const commits = F().commitmentsOf(app, f.id, 'signed');
    const accounts = F().accountsOf(b, commits, day);
    const nav = F().navAt(b.rows, day, b.marks, b.holdings);
    const shares = F().navShares(nav.nav_minor, commits);
    const byName = {};
    for (const c of commits) byName[c.lp_name.toLowerCase()] = c;
    rows.forEach((r, i) => {
      const key = String(r.lp || '').trim();
      const c = byName[key.toLowerCase()] || commits.filter((x) => x.lp === key)[0];
      if (!c) {
        out.push({ index: out.length, row: i, kind: 'unknown_lp', lp: '', lp_name: key, field: 'lp', ours_minor: null, theirs_minor: null, diff_minor: null, state: 'open', explanation: '', explained_by: '' });
        return;
      }
      const a = accounts[c.lp];
      const ours = { contributed: a.contributed_minor, distributed: a.distributed_minor, recallable: a.recallable_minor, nav: shares[c.lp] || 0 };
      for (const k of ['contributed', 'distributed', 'recallable', 'nav']) {
        if (r[k] === undefined || r[k] === '') continue;
        const theirs = amountIn(r[k], cur, 'row ' + (i + 1) + ' ' + k);
        if (theirs === null || theirs === ours[k]) continue;
        out.push({ index: out.length, row: i, kind: 'account', lp: c.lp, lp_name: c.lp_name, field: k, ours_minor: ours[k], theirs_minor: theirs, diff_minor: theirs - ours[k], state: 'open', explanation: '', explained_by: '' });
      }
    });
    return out;
  }
  const open = util.rows(
    app,
    "SELECT l.id AS line, l.lp, p.name AS lp_name, e.id AS event, e.number, l.total_minor, COALESCE((SELECT SUM(x.amount_minor) FROM payments x WHERE x.line = l.id AND x.voided_at = ''), 0) AS paid FROM capital_lines l JOIN capital_events e ON e.id = l.event JOIN lps p ON p.id = l.lp WHERE e.fund = {:f} AND e.kind = 'call' AND e.status = 'issued'",
    { line: '', lp: '', lp_name: '', event: '', number: '', total_minor: 0, paid: 0 },
    { f: f.id },
  ).filter((x) => x.paid < x.total_minor);
  rows.forEach((r, i) => {
    const amt = amountIn(r.amount, cur, 'row ' + (i + 1) + ' amount');
    if (amt === null || amt <= 0) return;
    const same = open.filter((x) => x.total_minor - x.paid === amt);
    const match = same.length === 1 ? { line: same[0].line, event: same[0].event, number: same[0].number, lp: same[0].lp, lp_name: same[0].lp_name } : null;
    out.push({ index: out.length, row: i, kind: 'receipt', lp: match ? match.lp : '', lp_name: match ? match.lp_name : '', field: 'amount', ours_minor: null, theirs_minor: amt, diff_minor: amt, day: util.isDay(String(r.day || '')) ? String(r.day) : '', reference: util.clip(String(r.reference || ''), 200), payer: util.clip(String(r.payer || ''), 200), match: match, candidates: same.length, state: 'open', explanation: '', explained_by: '' });
  });
  return out;
}

function statementOut(app, s, detail) {
  const util = u();
  const diffs = util.jsonOf(s, 'differences', []) || [];
  const out = { id: s.id, fund: s.getString('fund'), source: s.getString('source'), period_end: s.getString('period_end'), name: s.getString('name'), status: s.getString('status'), rows: (util.jsonOf(s, 'rows', []) || []).length, differences: diffs.length, open: diffs.filter((d) => d.state !== 'resolved').length, agent: L('lib_agent').view(s, ['reconcile']), created: s.getString('created') };
  if (detail) {
    out.lines = util.jsonOf(s, 'rows', []) || [];
    out.diffs = diffs;
  }
  return out;
}

/** statements.import: an administrator's capital account statement or a bank statement; differences against the books are listed; Ask your AI agent reconciles them (trigger reconcile). Your AI agent's import is a proposal. */
function statementsImport(ctx, p) {
  F().needLpData(ctx);
  const util = u();
  const app = ctx.app;
  const f = F().fundOf(ctx, util.req(p, 'fund'));
  const source = util.oneOf(p, 'source', ['administrator', 'bank'], 'administrator');
  const periodEnd = util.day(p, 'period_end', '');
  if (source === 'administrator' && periodEnd === '') throw util.fail(400, 'period_end is required for an administrator statement.', 'missing_param', { param: 'period_end' });
  let raw = util.list(p, 'rows');
  if (raw === undefined) {
    const t = util.str(p, 'csv', '');
    if (t === '') throw util.fail(400, 'Give --rows (JSON objects) or --csv text.', 'missing_param', { param: 'rows' });
    raw = util.csvObjects(t).items;
  }
  if (raw.length === 0) throw util.fail(400, 'The statement has no rows.', 'empty');
  if (raw.length > 2000) throw util.fail(400, 'At most 2,000 rows in one statement.', 'too_many');
  const rows = mapRows(raw, source === 'administrator' ? ADMIN_COLS : BANK_COLS);
  const needed = source === 'administrator' ? 'lp' : 'amount';
  if (!rows.some((r) => r[needed] !== undefined)) throw util.fail(400, 'No ' + needed + ' column found. Columns: ' + Object.keys(raw[0] || {}).join(', ') + '.', 'missing_column', { param: 'rows' });
  const diffs = differencesOf(app, f, source, periodEnd, rows);
  const s = util.newRecord(app, 'statements');
  s.set('fund', f.id);
  s.set('source', source);
  s.set('period_end', periodEnd);
  s.set('file', util.str(p, 'file', ''));
  s.set('name', util.text(p, 'name', 200, '') || (source === 'bank' ? 'Bank statement' : 'Administrator statement ' + periodEnd));
  s.set('rows', rows);
  s.set('differences', diffs);
  s.set('status', diffs.length === 0 ? 'reconciled' : 'imported');
  s.set('actor', ctx.isAgent ? 'agent' : 'person');
  s.set('member', ctx.memberId || '');
  app.save(s);
  L('lib_audit').note(ctx, { collection: 'statements', record: s.id, summary: 'Imported ' + s.getString('name') + ': ' + rows.length + ' rows, ' + diffs.length + ' differences' });
  return { statement: statementOut(app, s, true) };
}

function previewImport(ctx, params) {
  const rows = typeof params.rows === 'string' ? params.rows.length : Array.isArray(params.rows) ? params.rows.length : 0;
  return { label: 'Import a ' + (params.source || 'administrator') + ' statement' + (params.period_end ? ' for ' + params.period_end : ''), target: '', fields: [{ name: 'fund', before: '', after: String(params.fund || '') }, { name: 'rows', before: '', after: String(rows || (params.csv ? 'CSV' : '')) }], risk: 'low' };
}

function statementRef(ctx, ref) {
  const s = u().byId(ctx.app, 'statements', String(ref || ''));
  if (s === null) throw u().fail(404, 'No statement ' + ref + '. Run statements.list.', 'not_found');
  F().fundOf(ctx, s.getString('fund'));
  return s;
}

function statementsList(ctx, p) {
  const util = u();
  const f = F().fundOf(ctx, util.str(p, 'fund', ''));
  return { statements: util.findMany(ctx.app, 'statements', 'fund = {:f}', '-created', 100, { f: f.id }).map((s) => statementOut(ctx.app, s, false)) };
}

function statementsGet(ctx, p) {
  F().needLpData(ctx);
  return { statement: statementOut(ctx.app, statementRef(ctx, u().req(p, 'statement')), true) };
}

/** statements.explain: an explanation for one difference (your AI agent asked to reconcile, or a person). */
function statementsExplain(ctx, p) {
  F().needLpData(ctx);
  const util = u();
  const s = statementRef(ctx, util.req(p, 'statement'));
  const idx = util.int(p, 'index', -1, 0, 100000);
  const text = util.text(p, 'explanation', 2000, '');
  if (util.squash(text) === '') throw util.fail(400, 'explanation is required.', 'missing_param', { param: 'explanation' });
  const diffs = util.jsonOf(s, 'differences', []) || [];
  const d = diffs[idx];
  if (d === undefined) throw util.fail(404, 'No difference ' + idx + ' (0 to ' + (diffs.length - 1) + ').', 'not_found', { param: 'index' });
  if (d.state === 'resolved') throw util.fail(409, 'This difference is resolved.', 'conflict');
  d.explanation = text;
  d.explained_by = ctx.isAgent ? 'agent' : 'person';
  d.state = 'explained';
  s.set('differences', diffs);
  ctx.app.save(s);
  L('lib_audit').note(ctx, { collection: 'statements', record: s.id, summary: 'Explained difference ' + idx + ' of ' + s.getString('name') });
  return { difference: d };
}

/** statements.resolve (people): accept differences as explained or fixed (--index, or --all true). */
function statementsResolve(ctx, p) {
  F().needLpData(ctx);
  const util = u();
  const s = statementRef(ctx, util.req(p, 'statement'));
  const diffs = util.jsonOf(s, 'differences', []) || [];
  const all = util.bool(p, 'all', false);
  const idx = util.int(p, 'index', -1, 0, 100000);
  if (!all && diffs[idx] === undefined) throw util.fail(400, 'Give --index or --all true.', 'missing_param', { param: 'index' });
  let n = 0;
  diffs.forEach((d, i) => {
    if ((all || i === idx) && d.state !== 'resolved') {
      d.state = 'resolved';
      n++;
    }
  });
  s.set('differences', diffs);
  if (diffs.every((d) => d.state === 'resolved')) s.set('status', 'reconciled');
  ctx.app.save(s);
  L('lib_audit').note(ctx, { collection: 'statements', record: s.id, summary: 'Resolved ' + n + ' differences of ' + s.getString('name') });
  return { statement: statementOut(ctx.app, s, true) };
}

/** calls.notice (people): one LP's notice of an issued call or distribution, as PDF or its ILPA CSV. */
function callsNotice(ctx, p) {
  F().needLpData(ctx);
  const util = u();
  const l = util.byId(ctx.app, 'capital_lines', util.req(p, 'line'));
  if (l === null) throw util.fail(404, 'No such line.', 'not_found', { param: 'line' });
  const e = eventRef(ctx, l.getString('event'));
  const field = util.oneOf(p, 'format', ['pdf', 'csv'], 'pdf') === 'csv' ? 'notice_csv' : 'notice';
  if (l.getString(field) === '') throw util.fail(404, 'This line has no notice.', 'not_found');
  const lp = ctx.app.findRecordById('lps', l.getString('lp'));
  return L('lib_files').serve(ctx, l, field, e.getString('number') + ' ' + lp.getString('name') + (field === 'notice' ? '.pdf' : '.csv'), util.bool(p, 'download', false));
}

/* -------------------------------------------------------------- imports */

/** Keep explanations and states of differences that are still the same after a statement changed. */
function carryDiffs(old, fresh) {
  const key = (d) => [d.kind, d.lp_name, d.field, d.theirs_minor, d.day || '', d.reference || ''].join('|');
  const seen = {};
  for (const d of old || []) seen[key(d)] = d;
  return fresh.map((d, i) => {
    const o = seen[key(d)];
    return Object.assign(d, { index: i }, o ? { explanation: o.explanation, explained_by: o.explained_by, state: o.state } : {});
  });
}

/** The open statement of a fund for a source (and period), or a new one. */
function openStatement(app, ctx, f, source, periodEnd) {
  const util = u();
  const s0 = util.findOne(app, 'statements', "fund = {:f} && source = {:s} && period_end = {:e} && status = 'imported'", { f: f.id, s: source, e: periodEnd });
  if (s0 !== null) return { s: s0, rows: util.jsonOf(s0, 'rows', []) || [] };
  const s = util.newRecord(app, 'statements');
  s.set('fund', f.id);
  s.set('source', source);
  s.set('period_end', periodEnd);
  s.set('file', '');
  s.set('name', source === 'bank' ? 'Bank statement' : 'Administrator statement ' + periodEnd);
  s.set('rows', []);
  s.set('differences', []);
  s.set('status', 'imported');
  s.set('actor', ctx.isAgent ? 'agent' : 'person');
  s.set('member', ctx.memberId || '');
  return { s: s, rows: [] };
}

function saveStatement(app, ctx, f, s, rows, info) {
  const util = u();
  const diffs = carryDiffs(util.jsonOf(s, 'differences', []) || [], differencesOf(app, f, s.getString('source'), s.getString('period_end'), rows));
  s.set('rows', rows);
  s.set('differences', diffs);
  s.set('status', diffs.some((d) => d.state !== 'resolved') ? 'imported' : 'reconciled');
  app.save(s);
}

/** Import row (target statement_lines): one LP's line of an administrator's capital account statement; the fund's open statement for that day takes it and its differences are listed again. */
function importStatementRow(ctx, row, info) {
  F().needLpData(ctx);
  const util = u();
  const app = ctx.app;
  const f = F().fundOf(ctx, String(row.fund || ''));
  const end = String(row.period_end || '');
  if (!util.isDay(end)) throw util.fail(400, 'period_end is a day.', 'invalid_param');
  const lp = util.squash(String(row.lp || ''));
  if (lp === '') throw util.fail(400, 'The LP is empty.', 'missing_param');
  const line = { lp: lp };
  for (const k of ['contributed', 'distributed', 'recallable', 'nav']) {
    if (row[k] === undefined || row[k] === null || row[k] === '') continue;
    amountIn(row[k], f.getString('currency'), k);
    line[k] = String(row[k]);
  }
  if (Object.keys(line).length === 1) throw util.fail(400, 'The row has no amounts (contributed, distributed, recallable or nav).', 'missing_param');
  const st = openStatement(app, ctx, f, 'administrator', end);
  const rows = st.rows.filter((r) => String(r.lp || '').toLowerCase() !== lp.toLowerCase());
  const had = rows.length !== st.rows.length;
  rows.push(line);
  saveStatement(app, ctx, f, st.s, rows, info);
  return { action: had ? 'updated' : 'created', id: st.s.id, message: lp };
}

/** Import row (target bank_lines): one receipt of a bank statement; the fund's open bank statement takes it (the same day, amount and reference once). */
function importBankRow(ctx, row, info) {
  F().needLpData(ctx);
  const util = u();
  const app = ctx.app;
  const f = F().fundOf(ctx, String(row.fund || ''));
  const cur = f.getString('currency');
  const amt = amountIn(row.amount, cur, 'amount');
  if (amt === null || amt <= 0) throw util.fail(400, 'amount must be more than 0.', 'invalid_amount');
  const line = { day: util.isDay(String(row.day || '')) ? String(row.day) : '', amount: String(row.amount), reference: util.clip(String(row.reference || ''), 200), payer: util.clip(String(row.payer || ''), 200) };
  const st = openStatement(app, ctx, f, 'bank', '');
  if (st.rows.some((r) => r.day === line.day && amountIn(r.amount, cur, 'amount') === amt && String(r.reference || '') === line.reference)) return { action: 'skipped', id: st.s.id, message: 'already on the statement' };
  saveStatement(app, ctx, f, st.s, st.rows.concat([line]), info);
  return { action: 'created', id: st.s.id, message: line.reference || line.payer };
}

/** Opening balances come before anything else on a fund's ledger. */
function openingAllowed(app, f) {
  if (u().count(app, "SELECT COUNT(*) AS n FROM ledger WHERE fund = {:f} AND origin != 'opening'", { f: f.id }) > 0) throw u().fail(409, f.getString('name') + ' already has calls or distributions on its ledger; opening balances come first.', 'opening_exists');
}

function openingRow(app, ctx, f, o) {
  const r = u().newRecord(app, 'ledger');
  r.set('fund', f.id);
  r.set('lp', o.lp || '');
  r.set('holding', o.holding || '');
  r.set('event', '');
  r.set('day', o.day);
  r.set('type', o.type);
  r.set('amount_minor', o.amount_minor);
  r.set('recallable_minor', 0);
  r.set('currency', f.getString('currency'));
  r.set('origin', 'opening');
  r.set('reverses', '');
  r.set('note', 'Opening balance (import)');
  r.set('actor', ctx.isAgent ? 'agent' : 'person');
  r.set('member', ctx.memberId || '');
  app.save(r);
}

/** Import row (target opening_balances): one LP's opening capital account in a fund moving in. */
function importOpeningRow(ctx, row) {
  F().needLpData(ctx);
  const util = u();
  const app = ctx.app;
  const f = F().fundOf(ctx, String(row.fund || ''));
  const day = String(row.day || '');
  if (!util.isDay(day)) throw util.fail(400, 'day is the opening day.', 'invalid_param');
  openingAllowed(app, f);
  const lp = L('lib_funds_lps').lpRef(ctx, String(row.lp || ''));
  if (util.count(app, "SELECT COUNT(*) AS n FROM ledger WHERE fund = {:f} AND lp = {:l} AND origin = 'opening'", { f: f.id, l: lp.id }) > 0) throw util.fail(409, lp.getString('name') + ' already has an opening balance in ' + f.getString('name') + '.', 'opening_exists');
  const cur = f.getString('currency');
  const v = {};
  for (const k of ['contributed', 'distributed', 'recallable', 'recalled']) v[k] = amountIn(row[k], cur, k) || 0;
  if (v.recallable > v.distributed) throw util.fail(400, 'recallable cannot exceed distributed.', 'invalid_amount');
  if (v.recalled > v.contributed) throw util.fail(400, 'recalled cannot exceed contributed.', 'invalid_amount');
  let n = 0;
  for (const k of Object.keys(v)) {
    if (v[k] <= 0) continue;
    openingRow(app, ctx, f, { lp: lp.id, day: day, type: 'opening_' + k, amount_minor: v[k] });
    n++;
  }
  if (n === 0) return { action: 'skipped', id: lp.id, message: 'no amounts' };
  return { action: 'created', id: lp.id, message: lp.getString('name') };
}

/** Import row (target opening_holdings): a holding at cost in a fund moving in (by company name or holding id). */
function importOpeningHoldingRow(ctx, row) {
  const util = u();
  const app = ctx.app;
  const f = F().fundOf(ctx, String(row.fund || ''));
  const day = String(row.day || '');
  if (!util.isDay(day)) throw util.fail(400, 'day is the investment day.', 'invalid_param');
  openingAllowed(app, f);
  const ref = util.squash(String(row.holding || ''));
  const hm = F().seenHoldings(ctx, f.id);
  const hits = Object.keys(hm).filter((k) => k === ref || hm[k].name.toLowerCase() === ref.toLowerCase());
  if (hits.length !== 1) throw util.fail(404, hits.length === 0 ? 'No holding "' + ref + '" you can see in ' + f.getString('name') + ' (add it in Portfolio first).' : 'More than one holding is called "' + ref + '"; use the id.', 'not_found');
  const h = hits[0];
  if (util.count(app, "SELECT COUNT(*) AS n FROM ledger WHERE fund = {:f} AND holding = {:h} AND type = 'investment'", { f: f.id, h: h }) > 0) throw util.fail(409, hm[h].name + ' already has its cost on the ledger.', 'opening_exists');
  const cost = amountIn(row.cost, f.getString('currency'), 'cost');
  if (cost === null || cost <= 0) throw util.fail(400, 'cost must be more than 0.', 'invalid_amount');
  openingRow(app, ctx, f, { holding: h, day: day, type: 'investment', amount_minor: cost });
  return { action: 'created', id: h, message: hm[h].name };
}

module.exports = {
  reviewCheck: reviewCheck,
  reconcileCheck: reconcileCheck,
  importStatementRow: importStatementRow,
  importBankRow: importBankRow,
  importOpeningRow: importOpeningRow,
  importOpeningHoldingRow: importOpeningHoldingRow,
  callsNotice: callsNotice,
  PURPOSES: PURPOSES,
  eventRef: eventRef,
  eventOut: eventOut,
  feeSchedule: feeSchedule,
  callPreview: callPreview,
  distPreview: distPreview,
  waterfallFor: waterfallFor,
  callsList: callsList,
  callsGet: callsGet,
  callsDraft: callsDraft,
  previewDraft: previewDraft,
  callsPreview: callsPreview,
  callsNote: callsNote,
  callsIssue: callsIssue,
  callsVoid: callsVoid,
  distributionsDraft: distributionsDraft,
  previewDistDraft: previewDistDraft,
  distributionsPreview: distributionsPreview,
  distributionsIssue: distributionsIssue,
  waterfallPreview: waterfallPreview,
  paymentsList: paymentsList,
  paymentsRecord: paymentsRecord,
  previewPayment: previewPayment,
  paymentsRemind: paymentsRemind,
  ledgerList: ledgerList,
  ledgerOpening: ledgerOpening,
  ledgerRecord: ledgerRecord,
  statementsImport: statementsImport,
  previewImport: previewImport,
  statementsList: statementsList,
  statementsGet: statementsGet,
  statementsExplain: statementsExplain,
  statementsResolve: statementsResolve,
};
