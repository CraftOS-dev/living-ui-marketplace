/// <reference path="../pb_data/types.d.ts" />
/**
 * Funds module core: which fund, the ledger read back as LP capital
 * accounts and fund flows, NAV, the fund metrics contract (SPEC 4.6), the
 * J-curve, Next items, search and the daily job.
 *
 * Books:
 *   - The ledger (append-only) holds every flow: LP contributions by ILPA
 *     type (call_investment, call_fees, call_expenses, call_other), LP
 *     distributions (dist_capital, dist_gain, with the recallable part),
 *     opening balances, fund-to-company flows (investment, proceeds) and
 *     carry paid to the GP. A void writes reversing rows; nothing is edited.
 *   - Capital accounts come from lib_eng_capital.account over an LP's
 *     ledger rows (called amounts, not receipts; payments are separate).
 *   - NAV = holdings at their latest approved mark (at cost without one;
 *     exited or written-off holdings without a mark at 0) plus cash, where
 *     cash = called for investments and other purposes - investments made
 *     outside opening balances + proceeds - distributions - carry + opening
 *     cash. Fees and expenses are paid out as they are called.
 *   - Metrics are lib_eng_metrics.fund: net (LP flows with NAV) beside
 *     gross (company flows with holdings value), never a model's number.
 *
 * Exports for other modules (SPEC 4.6):
 *   metrics(app, fundId, asOfDay) -> { paid_in_minor, distributed_minor, nav_minor, dpi_e8, rvpi_e8, tvpi_e8,
 *                                      net_irr_ppm|null, gross_moic_e8, gross_irr_ppm|null, currency, as_of_day, reasons }
 *   markOf(app, holdingId, asOfDay) -> { value_minor, method, day } | null
 */

const LP_CALL = ['call_investment', 'call_fees', 'call_expenses', 'call_other', 'call_recall', 'call_subline'];
const LP_DIST = ['dist_capital', 'dist_gain'];
const STEP_LABELS = ['Open', 'Marks', 'Frozen', 'Letter', 'Sent'];

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}

/* --------------------------------------------------------------- funds */

/** May ctx approve marks, edit and finalise the letter: funds edit, or a partner (portfolio and committee edit). */
function approver(ctx) {
  const auth = L('lib_auth');
  if (ctx.isAgent) return false;
  return auth.can(ctx, 'funds', 'edit') || (auth.can(ctx, 'portfolio', 'edit') && auth.can(ctx, 'committee', 'edit'));
}

function needApprover(ctx, what) {
  if (!approver(ctx)) throw u().fail(403, 'Your role cannot ' + what + ' (finance, or a partner).', 'not_permitted', { module: 'funds' });
}

/** LP data (LP records, commitments, capital accounts): people with lps view; your AI agent while fund data is on. */
function needLpData(ctx) {
  const auth = L('lib_auth');
  if (auth.fundDataVisible(ctx)) return;
  if (ctx.isAgent) throw u().fail(403, 'Fund and LP data is switched off for your AI agent (Settings, Your AI agent).', 'fund_data_off');
  throw u().fail(403, 'Your role cannot see LP data (needs view access to LPs).', 'not_permitted', { module: 'lps' });
}

/** Funds and SPVs ctx may see (views). */
function visibleFunds(ctx) {
  return L('lib_entities').visible(ctx, { kinds: ['fund', 'spv'] });
}

/**
 * The fund a call names (id, name or short name); with none given, the only
 * fund ctx may see. 404 when ctx may not see it.
 */
function fundOf(ctx, ref) {
  const E = L('lib_entities');
  const r0 = String(ref === undefined || ref === null ? '' : ref).trim();
  if (r0 === '') {
    const all = visibleFunds(ctx);
    if (all.length === 1) return ctx.app.findRecordById('entities', all[0].id);
    if (all.length === 0) throw u().fail(404, 'There is no fund yet. Add one in Settings, Funds.', 'no_fund');
    throw u().fail(400, 'Give the fund: ' + all.map((f) => f.short_name || f.name).join(', ') + '.', 'missing_param', { param: 'fund' });
  }
  const r = E.ref(ctx.app, r0);
  if (r.getString('kind') === 'management') throw u().fail(400, 'The management company is not a fund.', 'invalid_param', { param: 'fund' });
  if (!E.canSee(ctx, r)) throw u().fail(404, 'No fund "' + r0 + '" you can see.', 'not_found', { param: 'fund' });
  return r;
}

/** The LPA terms (pref_compounding included) with the defaults filled. */
function lpaOf(f) {
  const E = L('lib_entities');
  const base = f.getString('kind') === 'spv' ? E.SPV_LPA : E.DEFAULT_LPA;
  return Object.assign({}, base, u().jsonOf(f, 'lpa', {}) || {});
}

function fundView(f) {
  const v = L('lib_entities').view(null, f);
  v.lpa = lpaOf(f);
  v.label = v.short_name || v.name;
  return v;
}

/** The day the fund's fees start: first close, else 1 January of the vintage, else '' (unknown). */
function feeStartOf(f) {
  const fc = f.getString('first_close_day');
  if (fc !== '') return fc;
  const v = f.getInt('vintage');
  return v > 0 ? v + '-01-01' : '';
}

/* ------------------------------------------------------------- quarters */

function qEnd(day) {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7));
  const qm = Math.ceil(m / 3) * 3;
  return u().monthEnd(y + '-' + u().pad(qm) + '-01');
}

function qStart(end) {
  const y = Number(end.slice(0, 4));
  const m = Number(end.slice(5, 7)) - 2;
  return y + '-' + u().pad(m) + '-01';
}

function qLabel(end) {
  return 'Q' + Math.ceil(Number(end.slice(5, 7)) / 3) + ' ' + end.slice(0, 4);
}

/** The last quarter end strictly before the quarter of `day`. */
function lastQEnd(day) {
  return u().dayAdd(qStart(qEnd(day)), -1);
}

function isQEnd(day) {
  return u().isDay(day) && qEnd(day) === day;
}

/* ---------------------------------------------------------------- ledger */

/** Raw SQL rows as plain objects (Goja's row objects keep their column types; a plain copy can take new fields). */
function plainRows(app, sql, shape, bind) {
  return u()
    .rows(app, sql, shape, bind)
    .map((r) => {
      const o = {};
      for (const k of Object.keys(shape)) o[k] = r[k];
      return o;
    });
}

const ROW = { id: '', lp: '', holding: '', event: '', day: '', type: '', amount_minor: 0, recallable_minor: 0, origin: '' };

/** Ledger rows of a fund up to a day (inclusive), oldest first. opts: lp. */
function ledgerRows(app, fundId, asOfDay, opts) {
  const o = opts || {};
  const bind = { f: fundId, d: asOfDay || '9999-12-31' };
  let sql = 'SELECT id, lp, holding, event, day, type, amount_minor, recallable_minor, origin FROM ledger WHERE fund = {:f} AND day <= {:d}';
  if (o.lp) {
    sql += ' AND lp = {:lp}';
    bind.lp = o.lp;
  }
  return u().rows(app, sql + ' ORDER BY day, created', ROW, bind);
}

/** One LP's ledger rows -> lib_eng_capital.account events (opening first, one event per notice; voided notices net to nothing). */
function lpEvents(rows) {
  const opening = { contributed: 0, distributed: 0, recallable: 0, recalled: 0, day: '' };
  const groups = {};
  const order = [];
  for (const r of rows) {
    if (r.type.indexOf('opening_') === 0) {
      const k = r.type.slice(8);
      if (opening[k] === undefined || k === 'day') continue;
      opening[k] += r.amount_minor;
      if (opening.day === '' || r.day < opening.day) opening.day = r.day;
      continue;
    }
    // A call against recallable capital is the engine's 'recall' (contributed and recalled up, recallable down).
    const kind = r.type === 'call_recall' ? 'recall' : LP_CALL.indexOf(r.type) >= 0 ? 'call' : LP_DIST.indexOf(r.type) >= 0 ? 'distribution' : '';
    if (kind === '') continue;
    const key = (r.event || r.id) + ':' + kind;
    if (groups[key] === undefined) {
      groups[key] = { type: kind, day: r.day, amount_minor: 0, recallable_minor: 0 };
      order.push(key);
    }
    groups[key].amount_minor += r.amount_minor;
    groups[key].recallable_minor += r.recallable_minor;
  }
  const out = [];
  if (opening.day !== '') out.push({ type: 'opening', day: opening.day, contributed_minor: Math.max(0, opening.contributed), distributed_minor: Math.max(0, opening.distributed), recallable_minor: Math.max(0, opening.recallable), recalled_minor: Math.max(0, opening.recalled) });
  for (const k of order) {
    const g = groups[k];
    if (g.amount_minor <= 0) continue;
    const ev = { type: g.type, day: g.day, amount_minor: g.amount_minor };
    if (g.type === 'distribution') ev.recallable_minor = Math.max(0, Math.min(g.recallable_minor, g.amount_minor));
    out.push(ev);
  }
  return out;
}

/** A capital account (lib_eng_capital.account) for one LP from its ledger rows. */
function accountFrom(commitmentMinor, rows) {
  return L('lib_eng_capital').account({ commitment_minor: Math.max(0, commitmentMinor || 0), events: lpEvents(rows) });
}

/** Flows by day kept apart by direction (a call and a distribution on one day stay two flows, so paid-in is not netted). */
function byDayAndSide(pairs) {
  const acc = {};
  for (const p of pairs) {
    const k = p.day + (p.out ? ':out' : ':in');
    if (acc[k] === undefined) acc[k] = { day: p.day, out: p.out, amount: 0 };
    acc[k].amount += p.amount;
  }
  return Object.keys(acc)
    .sort()
    .map((k) => acc[k])
    .filter((x) => x.amount > 0)
    .map((x) => ({ day: x.day, amount_minor: x.out ? -x.amount : x.amount }));
}

/** Signed LP flows by day (calls negative, distributions positive) for the metrics engine. */
function lpFlows(rows) {
  const pairs = [];
  for (const r of rows) {
    if (LP_CALL.indexOf(r.type) >= 0 || r.type === 'opening_contributed') pairs.push({ day: r.day, out: true, amount: r.amount_minor });
    else if (LP_DIST.indexOf(r.type) >= 0 || r.type === 'opening_distributed') pairs.push({ day: r.day, out: false, amount: r.amount_minor });
  }
  return byDayAndSide(pairs);
}

/** Fund-to-company flows by day (investments negative, proceeds positive). */
function companyFlows(rows, holding) {
  const pairs = [];
  for (const r of rows) {
    if (r.holding === '' || (holding && r.holding !== holding)) continue;
    if (r.type === 'investment') pairs.push({ day: r.day, out: true, amount: r.amount_minor });
    else if (r.type === 'proceeds') pairs.push({ day: r.day, out: false, amount: r.amount_minor });
  }
  return byDayAndSide(pairs);
}

/* ------------------------------------------------------------- holdings */

/**
 * The fund's holdings from the portfolio module: { id: { id, company, name, status, ownership_ppm } }.
 * With ctx (a person or your AI agent) only the holdings the caller may see (portfolio's holdingsFor:
 * fund scope and restricted deals); without it every holding (system work: NAV, metrics, packs, cron).
 */
function holdingsMap(app, fundId, ctx) {
  const R = L('lib_records');
  const P = L('lib_portfolio');
  const out = {};
  for (const h of (ctx ? P.holdingsFor(ctx, { fund: fundId }) : P.holdingsOf(app, { fund: fundId })) || []) {
    const co = h.company ? R.mini(app, 'companies', h.company) : null;
    out[h.id] = { id: h.id, company: h.company || '', name: co !== null ? co.name : h.id, status: h.status || 'active', ownership_ppm: h.ownership_ppm || 0 };
  }
  return out;
}

/** The caller's holdings of a fund (holdingsMap with ctx), read once per request. */
function seenHoldings(ctx, fundId) {
  if (ctx._fundsSeen === undefined) ctx._fundsSeen = {};
  if (ctx._fundsSeen[fundId] === undefined) ctx._fundsSeen[fundId] = holdingsMap(ctx.app, fundId, ctx);
  return ctx._fundsSeen[fundId];
}

/**
 * Per-holding rows the caller may see: { rows, hidden }. Fund totals (NAV, metrics) stay whole; the rows
 * of holdings outside the caller's scope are withheld and counted (SPEC 4: hidden marks withheld rows).
 */
function shownHoldings(ctx, fundId, list, key) {
  const seen = seenHoldings(ctx, fundId);
  const k = key || 'holding';
  const rows = (list || []).filter((x) => !x[k] || seen[x[k]] !== undefined);
  return { rows: rows, hidden: (list || []).length - rows.length };
}

/** A holding id the caller may act on in a fund, or a 404 that names no other holding. */
function seenHolding(ctx, f, holding, param) {
  const h = seenHoldings(ctx, f.id)[holding];
  if (h === undefined) throw u().fail(404, 'No holding ' + holding + ' you can see in ' + f.getString('name') + '. Holdings come from the portfolio (funds.holdings).', 'not_found', { param: param || 'holding' });
  return h;
}

const MARK = { holding: '', value_minor: 0, method: '', as_of_day: '', approved_at: '' };

/** Approved marks of a fund by holding, oldest first. */
function marksOf(app, fundId) {
  const out = {};
  for (const r of u().rows(app, "SELECT holding, value_minor, method, as_of_day, approved_at FROM marks WHERE fund = {:f} AND status = 'approved' ORDER BY as_of_day, approved_at", MARK, { f: fundId })) {
    if (out[r.holding] === undefined) out[r.holding] = [];
    out[r.holding].push(r);
  }
  return out;
}

function markAt(list, day) {
  let best = null;
  for (const m of list || []) if (m.as_of_day <= day) best = m;
  return best;
}

/** The latest approved mark of a holding on or before a day (SPEC 4.6): { value_minor, method, day } | null. */
function markOf(app, holdingId, asOfDay) {
  const r = u().one(app, "SELECT value_minor, method, as_of_day FROM marks WHERE holding = {:h} AND status = 'approved' AND as_of_day <= {:d} ORDER BY as_of_day DESC, approved_at DESC LIMIT 1", { value_minor: 0, method: '', as_of_day: '' }, { h: String(holdingId || ''), d: asOfDay || u().today(app) });
  return r === null ? null : { value_minor: r.value_minor, method: r.method, day: r.as_of_day };
}

/**
 * NAV of a fund on a day from its ledger rows (all rows; those after the day
 * are ignored), approved marks and holding statuses.
 */
function navAt(rows, day, marks, holdings) {
  const per = {};
  let cash = 0;
  for (const r of rows) {
    if (r.day > day) break;
    // Fees and expenses are paid out as called; money called for investments, other purposes, recalls and
    // subscription line repayments (which settle line-funded investments booked as negative cash) stays as cash.
    if (r.type === 'call_investment' || r.type === 'call_other' || r.type === 'call_recall' || r.type === 'call_subline' || r.type === 'opening_cash') cash += r.amount_minor;
    else if (LP_DIST.indexOf(r.type) >= 0 || r.type === 'carry') cash -= r.amount_minor;
    else if (r.type === 'investment' || r.type === 'proceeds') {
      if (per[r.holding] === undefined) per[r.holding] = { holding: r.holding, cost_minor: 0, proceeds_minor: 0, first_day: r.day, buys: [] };
      if (r.type === 'investment') {
        per[r.holding].cost_minor += r.amount_minor;
        per[r.holding].buys.push(r);
        if (r.origin !== 'opening') cash -= r.amount_minor;
      } else {
        per[r.holding].proceeds_minor += r.amount_minor;
        cash += r.amount_minor;
      }
    }
  }
  const list = [];
  let value = 0;
  for (const k of Object.keys(per)) {
    const p = per[k];
    if (p.cost_minor <= 0 && p.proceeds_minor <= 0) continue;
    const h = holdings[k] || { name: k, status: 'active', company: '' };
    const m = markAt(marks[k], day);
    let v;
    let method;
    if (m !== null) {
      // Money invested after the mark's day is held at cost until the next mark.
      let after = 0;
      for (const x of p.buys) if (x.day > m.as_of_day) after += x.amount_minor;
      v = Math.max(0, m.value_minor + after);
      method = m.method;
    } else if (h.status === 'exited' || h.status === 'written_off') {
      v = 0;
      method = h.status;
    } else {
      v = Math.max(0, p.cost_minor);
      method = 'cost';
    }
    value += v;
    list.push({ holding: k, name: h.name, company: h.company, status: h.status, cost_minor: p.cost_minor, proceeds_minor: p.proceeds_minor, value_minor: v, method: method, mark_day: m !== null ? m.as_of_day : '', first_day: p.first_day });
  }
  list.sort((a, b) => b.value_minor - a.value_minor);
  return { day: day, nav_minor: value + cash, holdings_value_minor: value, cash_minor: cash, holdings: list };
}

/** Everything the fund's numbers need, read once: { f, rows, marks, holdings }. */
function books(app, f, asOfDay) {
  return { f: f, rows: ledgerRows(app, f.id, asOfDay), marks: marksOf(app, f.id), holdings: holdingsMap(app, f.id) };
}

function metricsOf(b, day) {
  const nav = navAt(b.rows, day, b.marks, b.holdings);
  const rows = b.rows.filter((r) => r.day <= day);
  const out = L('lib_eng_metrics').fund({ currency: b.f.getString('currency'), as_of_day: day, lp_flows: lpFlows(rows), nav_minor: nav.nav_minor, company_flows: companyFlows(rows), holdings_value_minor: nav.holdings_value_minor });
  out.holdings_value_minor = nav.holdings_value_minor;
  out.cash_minor = nav.cash_minor;
  return { metrics: out, nav: nav };
}

/** SPEC 4.6: the fund's metrics on a day (net beside gross), from the engines. */
function metrics(app, fundId, asOfDay) {
  const f = app.findRecordById('entities', fundId);
  const day = asOfDay || u().today(app);
  return metricsOf(books(app, f, day), day).metrics;
}

/** Signed commitments of a fund: [{ id, lp, lp_name, amount_minor, fee_paying, fee_override, fee_rate_ppm, waiver_ppm, side_letter, closing_day }]. */
function commitmentsOf(app, fundId, status) {
  const shape = { id: '', lp: '', lp_name: '', status: '', amount_minor: 0, fee_paying: false, fee_override: false, fee_rate_ppm: 0, waiver_ppm: 0, side_letter: '', closing_day: '', deal: '' };
  const where = status ? ' AND c.status = {:s}' : '';
  return plainRows(app, "SELECT c.id, c.lp, l.name AS lp_name, c.status, c.amount_minor, c.fee_paying, c.fee_override, c.fee_rate_ppm, c.waiver_ppm, c.side_letter, c.closing_day, c.deal FROM commitments c JOIN lps l ON l.id = c.lp WHERE c.fund = {:f} AND l.deleted_at = ''" + where + ' ORDER BY c.amount_minor DESC, l.name', shape, { f: fundId, s: status || '' })
    .map((c) => {
      let side = [];
      try {
        side = JSON.parse(c.side_letter || '[]') || [];
      } catch {
        side = [];
      }
      c.side_letter = side;
      return c;
    });
}

/** NAV shares by LP (pro rata of signed commitments, largest remainder): { lp: minor }. */
function navShares(navMinor, commits) {
  const out = {};
  const w = commits.filter((c) => c.amount_minor > 0);
  if (w.length === 0) return out;
  for (const a of L('lib_eng_capital').allocate({ total_minor: navMinor, lps: w.map((c) => ({ lp: c.lp, commitment_minor: c.amount_minor })) })) out[a.lp] = a.amount_minor;
  return out;
}

/** Each LP's account in a fund: { lp: account } for the signed commitments, from rows up to day. */
function accountsOf(b, commits, day) {
  const byLp = {};
  for (const r of b.rows) {
    if (r.lp === '' || r.day > day) continue;
    if (byLp[r.lp] === undefined) byLp[r.lp] = [];
    byLp[r.lp].push(r);
  }
  const out = {};
  for (const c of commits) out[c.lp] = accountFrom(c.amount_minor, byLp[c.lp] || []);
  return out;
}

/** J-curve by quarter: calls (negative), distributions and NAV at each quarter end (today for the current quarter). */
function jcurve(b, today) {
  const lpRows = b.rows.filter((r) => r.lp !== '');
  const first = b.rows.length > 0 ? b.rows[0].day : feeStartOf(b.f) || today;
  let end = qEnd(first > today ? today : first);
  const last = qEnd(today);
  const out = [];
  let guard = 0;
  while (end <= last && guard < 60) {
    guard++;
    const start = qStart(end);
    let calls = 0;
    let dists = 0;
    for (const r of lpRows) {
      if (r.day < start || r.day > end) continue;
      if (LP_CALL.indexOf(r.type) >= 0 || r.type === 'opening_contributed') calls += r.amount_minor;
      else if (LP_DIST.indexOf(r.type) >= 0 || r.type === 'opening_distributed') dists += r.amount_minor;
    }
    const at = end > today ? today : end;
    out.push({ quarter: qLabel(end), end: end, calls_minor: -calls, dist_minor: dists, nav_minor: navAt(b.rows, at, b.marks, b.holdings).nav_minor });
    end = qEnd(u().dayAdd(end, 1));
  }
  return out.slice(-40);
}

/* ------------------------------------------------------------ quarter steps */

/** The StepTrack of a quarter close: Open, Marks, Frozen, Letter, Sent. */
function quarterSteps(app, q) {
  if (q === null) return null;
  const st = q.getString('status');
  let at = 0;
  if (st === 'sent') at = 4;
  else if (st === 'final') at = 4;
  else if (st === 'frozen') at = u().count(app, "SELECT COUNT(*) AS n FROM reports WHERE quarter = {:q} AND kind = 'letter' AND paragraphs != '[]' AND paragraphs != ''", { q: q.id }) > 0 ? 3 : 2;
  else {
    const drafts = u().count(app, "SELECT COUNT(*) AS n FROM marks WHERE quarter = {:q} AND status != 'superseded'", { q: q.id });
    at = drafts > 0 ? 1 : 0;
  }
  return { labels: STEP_LABELS, at: at, done: st === 'sent' };
}

function quarterOut(app, q) {
  return { id: q.id, fund: q.getString('fund'), period_end: q.getString('period_end'), label: q.getString('label'), status: q.getString('status'), hash: q.getString('hash'), frozen_at: q.getString('frozen_at'), finalized_at: q.getString('finalized_at'), sent_at: q.getString('sent_at'), steps: quarterSteps(app, q), agent: L('lib_agent').view(q, ['mark_notes', 'lp_letter']) };
}

/* ------------------------------------------------------------------- ops */

function overviewOf(b, commits, accounts) {
  let commitment = 0;
  let contributed = 0;
  let distributed = 0;
  let unfunded = 0;
  let recallable = 0;
  for (const c of commits) {
    const a = accounts[c.lp];
    commitment += c.amount_minor;
    contributed += a.contributed_minor;
    distributed += a.distributed_minor;
    unfunded += a.unfunded_minor;
    recallable += a.recallable_minor;
  }
  return { commitment_minor: commitment, called_minor: contributed, called_ppm: commitment > 0 ? Math.round((contributed * 1000000) / commitment) : null, unfunded_minor: unfunded, distributed_minor: distributed, recallable_minor: recallable, lps: commits.length };
}

/** funds.list: the funds and SPVs the caller may see, each with its headline figures (net beside gross). */
function list(ctx) {
  const app = ctx.app;
  const day = u().today(app);
  const out = visibleFunds(ctx).map((v) => {
    const f = app.findRecordById('entities', v.id);
    const b = books(app, f, day);
    const commits = commitmentsOf(app, f.id, 'signed');
    const mo = metricsOf(b, day);
    return Object.assign(fundView(f), { metrics: mo.metrics, overview: overviewOf(b, commits, accountsOf(b, commits, day)) });
  });
  return { funds: out, total: out.length, today: day };
}

/** funds.get: one fund's dashboard: metrics, J-curve, overview, the latest quarter's steps. */
function get(ctx, p) {
  const app = ctx.app;
  const f = fundOf(ctx, u().str(p, 'fund', ''));
  const today = u().today(app);
  const day = u().day(p, 'day', today);
  const b = books(app, f, day);
  const commits = commitmentsOf(app, f.id, 'signed');
  const mo = metricsOf(b, day);
  const q = u().findOne(app, 'quarters', 'fund = {:f}', { f: f.id }) === null ? null : app.findRecordsByFilter('quarters', 'fund = {:f}', '-period_end', 1, 0, { f: f.id })[0];
  const counts = {
    events_open: u().count(app, "SELECT COUNT(*) AS n FROM capital_events WHERE fund = {:f} AND status IN ('draft','previewed')", { f: f.id }),
    marks_draft: u().count(app, "SELECT COUNT(*) AS n FROM marks WHERE fund = {:f} AND status = 'draft'", { f: f.id }),
    holdings: mo.nav.holdings.length,
  };
  return {
    fund: fundView(f),
    funds: visibleFunds(ctx).map((v) => ({ id: v.id, name: v.name, short_name: v.short_name, kind: v.kind })),
    metrics: mo.metrics,
    overview: overviewOf(b, commits, accountsOf(b, commits, day)),
    jcurve: jcurve(b, day),
    quarter: q === null ? null : quarterOut(app, q),
    next_quarter_end: lastQEnd(today),
    counts: counts,
    today: today,
  };
}

/** metrics.fund: the fund's figures on a day, with each figure's reason when it is unknown. */
function metricsFund(ctx, p) {
  const f = fundOf(ctx, u().str(p, 'fund', ''));
  const day = u().day(p, 'day', u().today(ctx.app));
  const b = books(ctx.app, f, day);
  const mo = metricsOf(b, day);
  return { fund: { id: f.id, name: f.getString('name'), currency: f.getString('currency') }, metrics: mo.metrics, nav: { nav_minor: mo.nav.nav_minor, holdings_value_minor: mo.nav.holdings_value_minor, cash_minor: mo.nav.cash_minor } };
}

/** metrics.lp: one LP's account and net figures in a fund (its own flows and its NAV share). */
function metricsLp(ctx, p) {
  needLpData(ctx);
  const app = ctx.app;
  const f = fundOf(ctx, u().str(p, 'fund', ''));
  const lp = L('lib_funds_lps').lpRef(ctx, u().req(p, 'lp'));
  const day = u().day(p, 'day', u().today(app));
  const b = books(app, f, day);
  const commits = commitmentsOf(app, f.id, 'signed');
  const mine = commits.filter((c) => c.lp === lp.id)[0];
  if (mine === undefined) throw u().fail(404, lp.getString('name') + ' has no signed commitment in ' + f.getString('name') + '.', 'not_found');
  const nav = navAt(b.rows, day, b.marks, b.holdings);
  const share = navShares(nav.nav_minor, commits)[lp.id] || 0;
  const rows = b.rows.filter((r) => r.lp === lp.id);
  const m = L('lib_eng_metrics');
  const flows = lpFlows(rows);
  let paid = 0;
  let dist = 0;
  for (const x of flows) {
    if (x.amount_minor < 0) paid -= x.amount_minor;
    else dist += x.amount_minor;
  }
  const mult = m.multiples({ paid_in_minor: paid, distributed_minor: dist, nav_minor: share });
  const irr = m.netIrr({ lp_flows: flows, nav_minor: share, as_of_day: day });
  return {
    fund: { id: f.id, name: f.getString('name'), currency: f.getString('currency') },
    lp: { id: lp.id, name: lp.getString('name') },
    account: accountFrom(mine.amount_minor, rows),
    nav_share_minor: share,
    metrics: { paid_in_minor: paid, distributed_minor: dist, nav_minor: share, dpi_e8: mult.dpi_e8, rvpi_e8: mult.rvpi_e8, tvpi_e8: mult.tvpi_e8, net_irr_ppm: irr.irr_ppm, reasons: { dpi: mult.reasons.dpi, rvpi: mult.reasons.rvpi, tvpi: mult.reasons.tvpi, net_irr: irr.reason } },
    estimate: { nav_share: 'pro rata of signed commitments' },
  };
}

/** metrics.holding: one holding's cost, proceeds, value (its mark), gross MOIC and IRR in a fund. */
function metricsHolding(ctx, p) {
  const app = ctx.app;
  // The holding by id or by its company (name or domain); its fund when --fund is not given (qa-cli CLI-22).
  const hr = L('lib_portfolio').holdingRef(ctx, u().req(p, 'holding'), u().str(p, 'fund', ''));
  const f = fundOf(ctx, u().str(p, 'fund', '') || hr.getString('fund'));
  const holding = hr.id;
  seenHolding(ctx, f, holding);
  const day = u().day(p, 'day', u().today(app));
  const b = books(app, f, day);
  const nav = navAt(b.rows, day, b.marks, b.holdings);
  const h = nav.holdings.filter((x) => x.holding === holding)[0];
  if (h === undefined) throw u().fail(404, 'Holding ' + holding + ' has no investment in ' + f.getString('name') + ' on the ledger.', 'not_found');
  const g = L('lib_eng_metrics').gross({ company_flows: companyFlows(b.rows.filter((r) => r.day <= day), holding), value_minor: h.value_minor, as_of_day: day });
  return { fund: { id: f.id, name: f.getString('name'), currency: f.getString('currency') }, holding: h, gross: g, marks: (b.marks[holding] || []).slice().reverse() };
}

/** metrics.sources: the inputs behind the figures (flows, NAV parts, holdings and their marks). */
function metricsSources(ctx, p) {
  const app = ctx.app;
  const f = fundOf(ctx, u().str(p, 'fund', ''));
  const day = u().day(p, 'day', u().today(app));
  const b = books(app, f, day);
  const mo = metricsOf(b, day);
  const rows = b.rows.filter((r) => r.day <= day);
  const shown = shownHoldings(ctx, f.id, mo.nav.holdings);
  return {
    fund: { id: f.id, name: f.getString('name'), currency: f.getString('currency') },
    as_of_day: day,
    metrics: mo.metrics,
    lp_flows: lpFlows(rows),
    company_flows: companyFlows(rows),
    nav: Object.assign({}, mo.nav, { holdings: shown.rows }),
    hidden: shown.hidden,
    rules: {
      net: 'XIRR of LP flows (calls negative, distributions positive) with NAV as a final inflow on the day (lib_eng_metrics).',
      gross: 'Fund-to-company flows (investments negative, proceeds positive) with the holdings value as a final inflow.',
      nav: 'Holdings at the latest approved mark (cost without one; exited or written off at 0) plus cash: called for investments and other purposes, less investments, plus proceeds, less distributions and carry.',
    },
  };
}

/** A day for the bridge: YYYY-MM-DD, or a quarter label ("Q3 2026": its last day). */
function bridgeDay(p, name, dflt) {
  const util = u();
  const raw = util.str(p, name, '').trim();
  if (raw === '') return dflt;
  const m = /^Q([1-4])[\s-]*(\d{4})$/i.exec(raw);
  if (m) return qEnd(m[2] + '-' + util.pad(Number(m[1]) * 3) + '-01');
  return util.day(p, name, dflt);
}

function multiple(e8) {
  return e8 === null || e8 === undefined ? 'unknown' : (Number(e8) / 1e8).toFixed(2) + 'x';
}

/**
 * metrics.bridge: why a fund's figures moved between two days (SPEC qa-cli RULING CLI-17): the
 * figures on each day from the engines, the LP calls and distributions in between, and each
 * holding's value change (new marks, new money, exits), largest first. Nothing is estimated.
 */
function metricsBridge(ctx, p) {
  const util = u();
  const app = ctx.app;
  const f = fundOf(ctx, util.str(p, 'fund', ''));
  const cur = f.getString('currency');
  const to = bridgeDay(p, 'to', util.today(app));
  const from = bridgeDay(p, 'from', lastQEnd(to));
  if (from >= to) throw util.fail(400, 'from must be before to (days YYYY-MM-DD or quarter labels such as "Q2 2026").', 'invalid_param', { param: 'from' });
  const b = books(app, f, to);
  const a0 = metricsOf(b, from);
  const a1 = metricsOf(b, to);
  let called = 0;
  let distributed = 0;
  const notices = {};
  for (const r of b.rows) {
    if (r.day <= from || r.day > to) continue;
    if (LP_CALL.indexOf(r.type) >= 0) called += r.amount_minor;
    else if (LP_DIST.indexOf(r.type) >= 0) distributed += r.amount_minor;
    else continue;
    if (r.event !== '') notices[r.event] = true;
  }
  const before = {};
  for (const h of a0.nav.holdings) before[h.holding] = h;
  const seen = seenHoldings(ctx, f.id);
  const moves = [];
  let hidden = 0;
  const keys = {};
  for (const h of a1.nav.holdings) keys[h.holding] = true;
  for (const h of a0.nav.holdings) keys[h.holding] = true;
  for (const k of Object.keys(keys)) {
    const x0 = before[k] || null;
    const x1 = a1.nav.holdings.filter((h) => h.holding === k)[0] || null;
    const v0 = x0 ? x0.value_minor : 0;
    const v1 = x1 ? x1.value_minor : 0;
    const cost = (x1 ? x1.cost_minor : 0) - (x0 ? x0.cost_minor : 0);
    const proceeds = (x1 ? x1.proceeds_minor : 0) - (x0 ? x0.proceeds_minor : 0);
    if (v0 === v1 && cost === 0 && proceeds === 0) continue;
    if (seen[k] === undefined) {
      hidden++;
      continue;
    }
    const why = [];
    if (cost !== 0) why.push('new money ' + fmt(cost, cur));
    if (proceeds !== 0) why.push('proceeds ' + fmt(proceeds, cur));
    if (x1 && x0 && x1.mark_day !== x0.mark_day && x1.mark_day !== '') why.push('marked ' + x1.method + ' on ' + x1.mark_day);
    if (x1 && (x1.status === 'exited' || x1.status === 'written_off') && (!x0 || x0.status !== x1.status)) why.push(x1.status.replace('_', ' '));
    moves.push({ holding: k, name: (x1 || x0).name, value_from_minor: v0, value_to_minor: v1, change_minor: v1 - v0, new_cost_minor: cost, proceeds_minor: proceeds, method: x1 ? x1.method : 'none', mark_day: x1 ? x1.mark_day : '', why: why.join(', ') });
  }
  moves.sort((x, y) => Math.abs(y.change_minor) - Math.abs(x.change_minor));
  const pick = (m, nav) => ({ paid_in_minor: m.paid_in_minor, distributed_minor: m.distributed_minor, nav_minor: nav.nav_minor, holdings_value_minor: nav.holdings_value_minor, cash_minor: nav.cash_minor, tvpi_e8: m.tvpi_e8, dpi_e8: m.dpi_e8, rvpi_e8: m.rvpi_e8, net_irr_ppm: m.net_irr_ppm, gross_moic_e8: m.gross_moic_e8 });
  const s0 = pick(a0.metrics, a0.nav);
  const s1 = pick(a1.metrics, a1.nav);
  const marksChange = moves.reduce((acc, x) => acc + x.change_minor - x.new_cost_minor, 0);
  return {
    fund: { id: f.id, name: f.getString('name'), currency: cur },
    from: Object.assign({ day: from }, s0),
    to: Object.assign({ day: to }, s1),
    change: { tvpi: multiple(s0.tvpi_e8) + ' to ' + multiple(s1.tvpi_e8), dpi: multiple(s0.dpi_e8) + ' to ' + multiple(s1.dpi_e8), nav_minor: s1.nav_minor - s0.nav_minor, paid_in_minor: s1.paid_in_minor - s0.paid_in_minor, distributed_minor: s1.distributed_minor - s0.distributed_minor, holdings_value_minor: s1.holdings_value_minor - s0.holdings_value_minor, cash_minor: s1.cash_minor - s0.cash_minor },
    flows: { called_minor: called, distributed_minor: distributed, notices: Object.keys(notices).length, notice_list: Object.keys(notices).map((id) => { const ev = u().byId(app, 'capital_events', id); return ev === null ? { id: id } : { number: ev.getString('number'), kind: ev.getString('kind'), notice_day: ev.getString('notice_day'), purposes: (u().jsonOf(ev, 'purposes', []) || []).map((x) => x.type).join(', ') }; }) },
    holdings: moves,
    hidden: hidden,
    summary: f.getString('name') + ' net TVPI ' + multiple(s0.tvpi_e8) + ' on ' + from + ' to ' + multiple(s1.tvpi_e8) + ' on ' + to + ': LPs paid in ' + fmt(called, cur) + ' and received ' + fmt(distributed, cur) + '; holdings moved ' + fmt(marksChange, cur) + ' on marks, exits and write-offs, besides ' + fmt(moves.reduce((acc, x) => acc + x.new_cost_minor, 0), cur) + ' of new money; NAV ' + fmt(s0.nav_minor, cur) + ' to ' + fmt(s1.nav_minor, cur) + '.',
    rules: 'TVPI = (distributed + NAV) / paid-in, from the engines on each day; a holding without a mark is held at cost.',
  };
}

/** funds.holdings: the fund's holdings from the portfolio (for pickers), with their cost and value on the ledger. */
function holdingsList(ctx, p) {
  const app = ctx.app;
  const f = fundOf(ctx, u().str(p, 'fund', ''));
  const day = u().today(app);
  const b = books(app, f, '9999-12-31');
  const nav = navAt(b.rows, day, b.marks, b.holdings);
  const onBooks = {};
  for (const h of nav.holdings) onBooks[h.holding] = h;
  const seen = seenHoldings(ctx, f.id);
  const out = Object.keys(seen).map((k) => {
    const h = seen[k];
    const n = onBooks[k];
    return { id: k, name: h.name, company: h.company, status: h.status, ownership_ppm: h.ownership_ppm, cost_minor: n ? n.cost_minor : 0, value_minor: n ? n.value_minor : 0, method: n ? n.method : '' };
  });
  out.sort((a, b2) => (a.name < b2.name ? -1 : 1));
  return { fund: { id: f.id, name: f.getString('name'), currency: f.getString('currency') }, holdings: out, hidden: Object.keys(b.holdings).length - out.length };
}

/* ----------------------------------------------------------------- Next */

function fmt(minor, cur) {
  return L('lib_money').format(minor, cur);
}

/** A short amount for a Next figure: 'USD 27.7M' (exact amounts stay on the pages). */
function fmtShort(minor, cur) {
  const major = L('lib_money').toMajor(Math.abs(minor), cur);
  const sign = minor < 0 ? '-' : '';
  const one = (v, s) => {
    const t = (Math.round(v * 10) / 10).toFixed(1);
    return (t.slice(-2) === '.0' ? t.slice(0, -2) : t) + s;
  };
  const body = major >= 1e9 ? one(major / 1e9, 'B') : major >= 1e6 ? one(major / 1e6, 'M') : major >= 1e3 ? one(major / 1e3, 'K') : String(Math.round(major));
  return String(cur).toUpperCase() + ' ' + sign + body;
}

/** A change with its sign after the currency: 'USD +1.1M'. */
function fmtSigned(minor, cur) {
  const t = fmtShort(Math.abs(minor), cur);
  const i = t.indexOf(' ');
  return t.slice(0, i + 1) + (minor > 0 ? '+' : minor < 0 ? '-' : '') + t.slice(i + 1);
}

/** Next items of the funds module for this person (SPEC 4.3). */
function needsYou(ctx) {
  const app = ctx.app;
  const auth = L('lib_auth');
  if (ctx.isAgent || !ctx.memberId) return [];
  if (!auth.can(ctx, 'funds', 'view') && !approver(ctx)) return [];
  const util = u();
  const today = util.today(app);
  const funds = {};
  for (const v of visibleFunds(ctx)) funds[v.id] = v;
  const out = [];
  const label = (fid) => (funds[fid] ? funds[fid].short_name || funds[fid].name : '');

  // Overdue payments.
  if (auth.can(ctx, 'funds', 'edit') && auth.fundDataVisible(ctx)) {
    const shape = { line: '', lp: '', lp_name: '', total_minor: 0, event: '', number: '', due_day: '', currency: '', fund: '', paid: 0 };
    const late = util.rows(
      app,
      "SELECT l.id AS line, l.lp, p.name AS lp_name, l.total_minor, e.id AS event, e.number, e.due_day, e.currency, e.fund, COALESCE((SELECT SUM(x.amount_minor) FROM payments x WHERE x.line = l.id AND x.voided_at = ''), 0) AS paid FROM capital_lines l JOIN capital_events e ON e.id = l.event JOIN lps p ON p.id = l.lp WHERE e.kind = 'call' AND e.status = 'issued' AND e.due_day < {:t} AND l.total_minor > 0",
      shape,
      { t: today },
    );
    for (const r of late) {
      if (funds[r.fund] === undefined || r.paid >= r.total_minor) continue;
      const left = r.total_minor - r.paid;
      out.push({
        key: 'funds:pay:' + r.line,
        kind: 'payment',
        card: 'payment',
        title: r.lp_name,
        figures: [
          { label: 'Due', value: fmt(left, r.currency) },
          { label: 'Call', value: r.number },
          { label: 'Late', value: util.daysBetween(r.due_day, today) + ' d' },
        ],
        chips: [{ label: label(r.fund), tone: 'neutral' }, { label: 'Overdue', tone: 'bad' }],
        rank: 35,
        at: util.atOf(app, r.due_day, '09:00'),
        href: '#/funds/' + r.fund + '/events/' + r.event,
        data: { line: r.line, event: r.event, lp: r.lp, lp_name: r.lp_name, due_day: r.due_day, total_minor: r.total_minor, paid_minor: r.paid, currency: r.currency },
        actions: [
          { label: 'Record received', op: 'payments.record', params: { line: r.line }, primary: true },
          { label: 'Remind', op: 'payments.remind', params: { line: r.line } },
        ],
      });
    }
  }

  // Draft marks ready for approval, one card per quarter.
  if (approver(ctx)) {
    const shape = { quarter: '', fund: '', label: '', n: 0, value: 0, prior: 0, agent: 0, currency: '' };
    for (const r of util.rows(app, "SELECT q.id AS quarter, q.fund, q.label, COUNT(m.id) AS n, COALESCE(SUM(m.value_minor), 0) AS value, COALESCE(SUM(m.prior_minor), 0) AS prior, COALESCE(SUM(CASE WHEN m.actor = 'agent' THEN 1 ELSE 0 END), 0) AS agent, MAX(m.currency) AS currency FROM marks m JOIN quarters q ON q.id = m.quarter WHERE m.status = 'draft' GROUP BY q.id", shape)) {
      if (funds[r.fund] === undefined) continue;
      const change = r.value - r.prior;
      out.push({
        key: 'funds:marks:' + r.quarter,
        kind: 'mark',
        card: 'marks',
        title: label(r.fund) + ' ' + r.label + ' marks',
        figures: [
          { label: 'Holdings', value: String(r.n) },
          { label: 'Value', value: fmtShort(r.value, r.currency) },
          { label: 'Change', value: fmtSigned(change, r.currency) },
        ],
        chips: r.agent > 0 ? [{ label: 'Your AI agent', tone: 'agent' }] : [],
        agent: r.agent > 0,
        rank: 30,
        at: util.nowIso(),
        href: '#/funds/' + r.fund + '?tab=marks',
        data: { quarter: r.quarter, fund: r.fund },
        actions: [{ label: 'Approve all', op: 'marks.approve', params: { quarter: r.quarter }, primary: true, pin: true }],
      });
    }
  }

  // Calls and distributions ready to issue.
  if (auth.can(ctx, 'funds', 'full')) {
    for (const e of util.findMany(app, 'capital_events', "status = 'previewed'", 'notice_day', 50)) {
      if (funds[e.getString('fund')] === undefined) continue;
      const call = e.getString('kind') === 'call';
      const pv = util.jsonOf(e, 'preview', {}) || {};
      out.push({
        key: 'funds:issue:' + e.id,
        kind: 'draft',
        title: (call ? 'Call ' : 'Distribution ') + e.getString('number') + ' ready',
        figures: [
          { label: 'Total', value: fmtShort(e.getInt('total_minor'), e.getString('currency')) },
          { label: 'LPs', value: String((pv.lines || []).length) },
          { label: 'Due', value: e.getString('due_day') },
        ],
        chips: [{ label: label(e.getString('fund')), tone: 'neutral' }].concat(e.getString('note') !== '' ? [{ label: 'Reviewed', tone: e.getString('note_by') === 'agent' ? 'agent' : 'good' }] : []),
        agent: e.getString('note_by') === 'agent',
        rank: 30,
        at: e.getString('updated'),
        href: '#/funds/' + e.getString('fund') + '/events/' + e.id,
        data: { event: e.id, note: e.getString('note') },
        actions: [{ label: call ? 'Issue call' : 'Issue', op: call ? 'calls.issue' : 'distributions.issue', params: { event: e.id }, primary: true, pin: true }],
      });
    }
  }

  // Wire details waiting for a second person.
  if (auth.can(ctx, 'funds', 'full')) {
    for (const bb of util.findMany(app, 'bank_blocks', "status = 'pending'", 'created', 20)) {
      if (bb.getString('changed_by') === ctx.memberId) continue;
      const ent = util.byId(app, 'entities', bb.getString('entity'));
      if (ent === null || !L('lib_entities').canSee(ctx, ent)) continue;
      out.push({
        key: 'funds:bank:' + bb.id,
        kind: 'verify',
        title: 'Wire details: ' + (ent.getString('short_name') || ent.getString('name')),
        figures: [
          { label: 'Bank', value: bb.getString('bank_name') },
          { label: 'Account', value: bb.getString('last4') },
        ],
        chips: [{ label: 'Second approval', tone: 'warn' }],
        rank: 30,
        at: bb.getString('created'),
        href: '#/settings/funds',
        data: { block: bb.id },
        actions: [{ label: 'Approve', op: 'bank.approve', params: { block: bb.id }, primary: true, pin: true }],
      });
    }
  }

  // Statement differences.
  if (auth.can(ctx, 'funds', 'edit')) {
    for (const s of util.findMany(app, 'statements', "status = 'imported'", '-created', 20)) {
      if (funds[s.getString('fund')] === undefined) continue;
      const diffs = (util.jsonOf(s, 'differences', []) || []).filter((d) => d.state !== 'resolved');
      if (diffs.length === 0) continue;
      const explained = diffs.filter((d) => d.explanation).length;
      out.push({
        key: 'funds:stmt:' + s.id,
        kind: 'verify',
        title: (s.getString('source') === 'bank' ? 'Bank statement ' : 'Statement ') + (s.getString('period_end') || s.getString('name')),
        figures: [
          { label: 'Differences', value: String(diffs.length) },
          { label: 'Explained', value: String(explained) },
        ],
        chips: explained > 0 ? [{ label: 'Your AI agent', tone: 'agent' }] : [],
        agent: explained > 0,
        rank: 40,
        at: s.getString('created'),
        href: '#/funds/' + s.getString('fund') + '?tab=capital&statement=' + s.id,
        data: { statement: s.id },
        actions: [{ label: 'Accept all', op: 'statements.resolve', params: { statement: s.id, all: true }, primary: true }],
      });
    }
  }

  // Quarter close steps.
  if (auth.can(ctx, 'funds', 'edit') || approver(ctx)) {
    const prev = lastQEnd(today);
    for (const fid of Object.keys(funds)) {
      const has = util.findOne(app, 'quarters', 'fund = {:f} && period_end = {:e}', { f: fid, e: prev });
      const active = util.count(app, 'SELECT COUNT(*) AS n FROM ledger WHERE fund = {:f} AND day <= {:e}', { f: fid, e: prev }) > 0;
      if (has === null && active && auth.can(ctx, 'funds', 'edit')) {
        out.push({ key: 'funds:qopen:' + fid + ':' + prev, kind: 'task', title: label(fid) + ' ' + qLabel(prev) + ' close', figures: [{ label: 'Quarter end', value: prev }], chips: [], rank: 60, at: util.atOf(app, util.dayAdd(prev, 1), '08:00'), href: '#/funds/' + fid + '?tab=reports', data: { fund: fid, period_end: prev }, actions: [{ label: 'Open quarter', op: 'quarters.open', params: { fund: fid, period_end: prev }, primary: true }] });
      }
    }
    for (const q of util.findMany(app, 'quarters', "status = 'frozen' || status = 'final'", '-period_end', 20)) {
      if (funds[q.getString('fund')] === undefined) continue;
      const letter = util.findOne(app, 'reports', "quarter = {:q} && kind = 'letter'", { q: q.id });
      const paras = letter === null ? [] : util.jsonOf(letter, 'paragraphs', []) || [];
      if (q.getString('status') === 'frozen' && paras.length > 0 && approver(ctx)) {
        out.push({ key: 'funds:letter:' + q.id, kind: 'draft', title: label(q.getString('fund')) + ' ' + q.getString('label') + ' letter', figures: [{ label: 'Paragraphs', value: String(paras.length) }], chips: paras.some((x) => x.by === 'agent') ? [{ label: 'Your AI agent', tone: 'agent' }] : [], agent: paras.some((x) => x.by === 'agent'), rank: 30, at: letter.getString('updated'), href: '#/funds/' + q.getString('fund') + '?tab=reports&quarter=' + q.id, data: { quarter: q.id }, actions: [{ label: 'Finalize', op: 'reports.finalize', params: { quarter: q.id }, primary: true, pin: true }] });
      } else if (q.getString('status') === 'final' && auth.can(ctx, 'funds', 'edit') && util.count(app, "SELECT COUNT(*) AS n FROM reports WHERE quarter = {:q} AND kind = 'pack' AND (status = 'failed' OR (status = 'final' AND outbound = ''))", { q: q.id }) > 0) {
        out.push({ key: 'funds:packs:' + q.id, kind: 'draft', title: label(q.getString('fund')) + ' ' + q.getString('label') + ' LP packs', figures: [{ label: 'LPs', value: String(util.count(app, "SELECT COUNT(*) AS n FROM reports WHERE quarter = {:q} AND kind = 'pack'", { q: q.id })) }], chips: [], rank: 30, at: q.getString('finalized_at'), href: '#/funds/' + q.getString('fund') + '?tab=reports&quarter=' + q.id, data: { quarter: q.id }, actions: [{ label: 'Send packs', op: 'reports.send', params: { quarter: q.id }, primary: true }] });
      }
    }
  }
  return out;
}

/* ---------------------------------------------------------------- search */

function search(ctx, q, limit) {
  const util = u();
  const auth = L('lib_auth');
  const out = [];
  const n = limit || 8;
  const t = String(q || '').trim();
  if (t === '') return out;
  const seeFunds = {};
  for (const v of visibleFunds(ctx)) seeFunds[v.id] = true;
  if (auth.fundDataVisible(ctx)) {
    for (const r of util.rows(app0(ctx), "SELECT id, name, kind FROM lps WHERE deleted_at = '' AND name LIKE {:q} ESCAPE '\\' ORDER BY name LIMIT {:n}", { id: '', name: '', kind: '' }, { q: util.like(t), n: n })) out.push({ kind: 'lp', id: r.id, title: r.name, subtitle: 'LP', href: '#/funds/lps/' + r.id, icon: 'Landmark' });
  }
  if (auth.can(ctx, 'funds', 'view') || ctx.isAgent) {
    for (const r of util.rows(app0(ctx), "SELECT id, number, kind, fund, total_minor, currency FROM capital_events WHERE number LIKE {:q} ESCAPE '\\' ORDER BY created DESC LIMIT {:n}", { id: '', number: '', kind: '', fund: '', total_minor: 0, currency: '' }, { q: util.like(t), n: n })) {
      if (!seeFunds[r.fund]) continue;
      out.push({ kind: r.kind, id: r.id, title: r.number, subtitle: (r.kind === 'call' ? 'Call ' : 'Distribution ') + fmt(r.total_minor, r.currency), href: '#/funds/' + r.fund + '/events/' + r.id, icon: r.kind === 'call' ? 'ArrowDownToLine' : 'ArrowUpFromLine' });
    }
  }
  return out.slice(0, n);
}

function app0(ctx) {
  return ctx.app;
}

/* ---------------------------------------------------------------- events */

/** outbound.sent / outbound.failed: notices and LP packs record their delivery. */
function onOutbound(ctx, payload) {
  const util = u();
  const app = ctx.app;
  if (!payload || payload.module !== 'funds') return null;
  if (payload.ref_collection === 'reports') {
    const r = util.byId(app, 'reports', payload.ref_id);
    if (r === null) return null;
    const ob = util.byId(app, 'outbound', payload.outbound);
    r.set('status', ob !== null && ob.getString('status') === 'sent' ? 'sent' : 'failed');
    app.save(r);
    const q = util.byId(app, 'quarters', r.getString('quarter'));
    if (q !== null && q.getString('status') === 'final' && util.count(app, "SELECT COUNT(*) AS n FROM reports WHERE quarter = {:q} AND kind = 'pack' AND status != 'sent'", { q: q.id }) === 0) {
      q.set('status', 'sent');
      q.set('sent_at', util.nowIso());
      app.save(q);
    }
  }
  return null;
}

/* ------------------------------------------------------------------ cron */

/** Daily: settle calls that are fully paid; tell finance about payments that became overdue (once each). */
function daily(app) {
  const util = u();
  const today = util.today(app);
  for (const e of util.findMany(app, 'capital_events', "status = 'issued'", 'due_day', 500)) {
    const due = e.getInt('total_minor');
    const paid = util.one(app, "SELECT COALESCE(SUM(amount_minor), 0) AS n FROM payments WHERE event = {:e} AND voided_at = ''", { n: 0 }, { e: e.id }).n;
    if (due > 0 && paid >= due) {
      e.set('status', 'settled');
      app.save(e);
      continue;
    }
    if (e.getString('kind') === 'call' && e.getString('due_day') < today) {
      L('lib_notify').toLevel(app, 'funds', 'full', { kind: 'payment', title: 'Payments overdue on ' + e.getString('number'), body: 'Some LPs have not paid call ' + e.getString('number') + ' (due ' + e.getString('due_day') + ').', link: '#/funds/' + e.getString('fund') + '/events/' + e.id, ref: 'funds:overdue:' + e.id });
    }
  }
}

module.exports = {
  metricsBridge: metricsBridge,
  LP_CALL: LP_CALL,
  plainRows: plainRows,
  LP_DIST: LP_DIST,
  STEP_LABELS: STEP_LABELS,
  approver: approver,
  needApprover: needApprover,
  needLpData: needLpData,
  visibleFunds: visibleFunds,
  fundOf: fundOf,
  lpaOf: lpaOf,
  fundView: fundView,
  feeStartOf: feeStartOf,
  qEnd: qEnd,
  qStart: qStart,
  qLabel: qLabel,
  lastQEnd: lastQEnd,
  isQEnd: isQEnd,
  ledgerRows: ledgerRows,
  lpEvents: lpEvents,
  accountFrom: accountFrom,
  lpFlows: lpFlows,
  companyFlows: companyFlows,
  holdingsMap: holdingsMap,
  seenHoldings: seenHoldings,
  shownHoldings: shownHoldings,
  seenHolding: seenHolding,
  marksOf: marksOf,
  markOf: markOf,
  navAt: navAt,
  books: books,
  metricsOf: metricsOf,
  metrics: metrics,
  commitmentsOf: commitmentsOf,
  navShares: navShares,
  accountsOf: accountsOf,
  jcurve: jcurve,
  quarterSteps: quarterSteps,
  quarterOut: quarterOut,
  overviewOf: overviewOf,
  fmt: fmt,
  fmtSigned: fmtSigned,
  fmtShort: fmtShort,
  list: list,
  get: get,
  metricsFund: metricsFund,
  holdingsList: holdingsList,
  metricsLp: metricsLp,
  metricsHolding: metricsHolding,
  metricsSources: metricsSources,
  needsYou: needsYou,
  search: search,
  onOutbound: onOutbound,
  daily: daily,
};
