/// <reference path="../pb_data/types.d.ts" />
/**
 * Portfolio positions (SPEC 7.10): holdings, rounds, securities and
 * ownership, the Mark invested flow, SAFE previews and conversion at a
 * priced round, pro rata, and the cross-module contracts of SPEC 4.6:
 *
 *   holdingsOf(app, { company | fund }) -> [{ id, company, company_name, fund, fund_name, deal, status, currency,
 *       cost_minor, value_minor, value_basis: mark|cost|exited|written_off, ownership_ppm, first_day, exit_day,
 *       proceeds_minor, flows: [{ day, amount_minor }] (investments negative, proceeds positive) }]
 *   kpiSeries(app, companyId, key, { from_day, to_day, currency }) -> [{ period_end, value, status, ... }]
 *   runway(app, companyId) -> { months|null, state: known|not_burning|unknown, reason, ... }
 *
 * Every number comes from an engine: ownership and conversion from
 * lib_eng_safe, pro rata from lib_eng_prorata, MOIC from lib_eng_metrics,
 * runway from lib_eng_runway, KPI periods and currency from lib_eng_kpi
 * and the kernel's lib_fx. A holding's value is its latest approved mark
 * (funds lib_funds.markOf); without a mark it is held at cost and says so
 * (value_basis 'cost').
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}

const INSTRUMENTS = ['safe_cap', 'safe_discount', 'safe_mfn', 'note', 'priced'];
const INSTRUMENT_LABELS = { safe_cap: 'SAFE (cap)', safe_discount: 'SAFE (discount)', safe_mfn: 'SAFE (MFN)', note: 'Note', priced: 'Priced', common: 'Common' };
const SECURITY_KINDS = ['safe_cap', 'safe_discount', 'safe_mfn', 'note', 'priced', 'common'];
const ROUND_TYPES = ['pre_seed', 'seed', 'seed_extension', 'series_a', 'series_b', 'series_c', 'series_d_plus', 'bridge', 'other'];
const ROUND_LABELS = { pre_seed: 'Pre-seed', seed: 'Seed', seed_extension: 'Seed extension', series_a: 'Series A', series_b: 'Series B', series_c: 'Series C', series_d_plus: 'Series D+', bridge: 'Bridge', other: 'Other' };
// A company's own stage (companies.stage, set by a person) as the hero reads it.
const STAGE_LABELS = { idea: 'Idea', pre_seed: 'Pre-seed', seed: 'Seed', series_a: 'Series A', series_b: 'Series B', series_c: 'Series C', growth: 'Growth' };
const BOARD_ROLES = ['none', 'observer', 'seat'];
const STATUSES = ['active', 'exited', 'written_off'];
const E8 = 100000000;
// A notional share count for a conversion scenario when the company's real count is unknown: ownership in ppm does not depend on it.
const NOTIONAL_SHARES = 10000000;

/* ------------------------------------------------------------ helpers */

/** Compact money for cards: USD 1.2M, EUR 850K, JPY 120M. */
function short(minor, currency) {
  if (minor === null || minor === undefined || !Number.isFinite(Number(minor))) return '';
  const e = L('lib_money').exponent(currency);
  let major = Number(minor);
  for (let i = 0; i < e; i++) major = major / 10;
  const neg = major < 0;
  const a = Math.abs(major);
  let t;
  if (a >= 1e9) t = (Math.round(a / 1e8) / 10).toFixed(1).replace(/\.0$/, '') + 'B';
  else if (a >= 1e6) t = (Math.round(a / 1e5) / 10).toFixed(1).replace(/\.0$/, '') + 'M';
  else if (a >= 1e3) t = Math.round(a / 1e3) + 'K';
  else t = String(Math.round(a));
  return (neg ? '-' : '') + String(currency || '').toUpperCase() + ' ' + t;
}

/** ppm as a percent text: 74627 -> "7.46%". */
function pct(ppm, decimals) {
  if (ppm === null || ppm === undefined) return '';
  const d = decimals === undefined ? 1 : decimals;
  return (Number(ppm) / 10000).toFixed(d) + '%';
}

function fundOf(app, id) {
  if (!id) return null;
  const f = u().byId(app, 'entities', id);
  return f === null ? null : { id: f.id, name: f.getString('name'), currency: f.getString('currency') };
}

function companyMini(app, id) {
  return L('lib_records').mini(app, 'companies', id);
}

function baseCurrency(app) {
  return L('lib_settings').row(app).getString('base_currency') || 'USD';
}

function who(ctx) {
  return { actor: ctx.isAgent ? 'agent' : ctx.actor === 'person' ? 'person' : 'system', member: ctx.actor === 'person' ? ctx.memberId || '' : '' };
}

function stamp(ctx, rec) {
  const w = who(ctx);
  rec.set('actor', w.actor);
  rec.set('member', w.member);
}

function prov(ctx, source) {
  return L('lib_records').provEntry(ctx, source || '');
}

function emit(ctx, name, payload) {
  if (ctx.dryRun) return [];
  return L('lib_events').emit(ctx, name, payload);
}

/** A money param in major units of `currency` -> minor (null when absent). */
function money(p, name, currency, required) {
  return u().money(p, name, currency, { required: required === true, positive: required === true });
}

/** A whole share count param (null when absent). */
function shares(p, name) {
  return u().num(p, name, { whole: true, min: 0 });
}

/* -------------------------------------------------------------- refs */

function companyRef(app, ref) {
  return L('lib_records').resolve(app, 'companies', ref);
}

function fundRef(app, ref) {
  const f = L('lib_entities').ref(app, ref);
  if (f.getString('kind') !== 'fund' && f.getString('kind') !== 'spv') throw u().fail(400, f.getString('name') + ' is not a fund or SPV.', 'invalid_param', { param: 'fund' });
  return f;
}

/** The only fund (or SPV) of the firm, or null when there are several or none. */
function onlyFund(app) {
  const rows = u().findMany(app, 'entities', "(kind = 'fund' || kind = 'spv') && archived = false", 'created', 2);
  return rows.length === 1 ? rows[0] : null;
}

/** May ctx see this holding: its fund in scope, its deal (if any) visible. */
function visible(ctx, h) {
  const auth = L('lib_auth');
  if (ctx.actor === 'system') return true;
  if (!auth.inScope(ctx, h.getString('fund'))) return false;
  if (h.getString('deal') !== '' && !auth.dealVisible(ctx, h.getString('deal'))) return false;
  return true;
}

/** The holdings of a company ctx may see: { rows, hidden }. */
function holdingsOfCompany(ctx, companyId) {
  const all = u().findMany(ctx.app, 'holdings', "company = {:c} && deleted_at = ''", 'created', 0, { c: companyId });
  const rows = all.filter((h) => visible(ctx, h));
  return { rows: rows, hidden: all.length - rows.length };
}

/**
 * A holding ctx may see: by holding id, or by company (id, domain or name)
 * when the company has exactly one holding ctx may see (several: --fund picks).
 */
function holdingRef(ctx, ref, fundRefText) {
  const util = u();
  const r = String(ref || '').trim();
  if (r === '') throw util.fail(400, 'holding is required (a holding id or the company).', 'missing_param', { param: 'holding' });
  let h = util.byId(ctx.app, 'holdings', r);
  if (h !== null && h.getString('deleted_at') === '') {
    if (!visible(ctx, h)) throw util.fail(404, 'No holding ' + r + ' you can see.', 'not_found');
    return h;
  }
  const c = companyRef(ctx.app, r);
  const mine = holdingsOfCompany(ctx, c.id).rows;
  let pick = mine;
  if (fundRefText) {
    const f = fundRef(ctx.app, fundRefText);
    pick = mine.filter((x) => x.getString('fund') === f.id);
  }
  if (pick.length === 1) return pick[0];
  if (pick.length === 0) throw util.fail(404, 'No holding in ' + c.getString('name') + ' you can see. Run holdings.list.', 'not_found', { company: c.id, matches: [] });
  throw util.fail(409, c.getString('name') + ' is held by several funds; pass --fund.', 'ambiguous', { funds: pick.map((x) => fundOf(ctx.app, x.getString('fund'))), candidates: pick.map((x) => ({ id: x.id, name: c.getString('name') + ' (' + ((fundOf(ctx.app, x.getString('fund')) || {}).name || x.getString('fund')) + ')' })) });
}

/* ---------------------------------------------------------- positions */

/** Securities of a holding (oldest first). */
function securitiesOf(app, holdingId) {
  return u().findMany(app, 'securities', 'holding = {:h}', 'day,created', 0, { h: holdingId });
}

function costOf(app, holdingId) {
  const r = u().one(app, 'SELECT COALESCE(SUM(cost_minor), 0) AS n FROM securities WHERE holding = {:h}', { n: 0 }, { h: holdingId });
  return r === null ? 0 : r.n;
}

/** The latest ownership row: { ppm, day, basis, shares, fd_shares } or null. */
function ownershipNow(app, holdingId) {
  return u().one(app, 'SELECT ppm, day, basis, shares, fd_shares FROM ownership WHERE holding = {:h} ORDER BY day DESC, created DESC LIMIT 1', { ppm: 0, day: '', basis: '', shares: 0, fd_shares: 0 }, { h: holdingId });
}

/** The value of a holding today: approved mark, else cost (said so), exits at 0. */
function valueOf(app, h, cost, today) {
  const st = h.getString('status');
  if (st === 'exited') return { value_minor: 0, value_basis: 'exited', mark: null };
  if (st === 'written_off') return { value_minor: 0, value_basis: 'written_off', mark: null };
  const mark = L('lib_funds').markOf(app, h.id, today);
  if (mark && mark.value_minor !== null && mark.value_minor !== undefined) return { value_minor: Number(mark.value_minor), value_basis: 'mark', mark: mark };
  return { value_minor: cost, value_basis: 'cost', mark: null };
}

/** Fund-to-company flows of a holding: each security's cost on its day (negative), proceeds on the exit day. */
function flowsOf(app, h) {
  const out = [];
  for (const s of securitiesOf(app, h.id)) {
    const c = s.getInt('cost_minor');
    if (c > 0) out.push({ day: s.getString('day') || h.getString('first_day') || u().today(app), amount_minor: -c });
  }
  if (h.getInt('proceeds_minor') > 0 && h.getString('exit_day') !== '') out.push({ day: h.getString('exit_day'), amount_minor: h.getInt('proceeds_minor') });
  return out;
}

/** The contract row of SPEC 4.6. */
function contractRow(app, h, today) {
  const cost = costOf(app, h.id);
  const v = valueOf(app, h, cost, today);
  const own = ownershipNow(app, h.id);
  const c = companyMini(app, h.getString('company'));
  const f = fundOf(app, h.getString('fund'));
  return {
    id: h.id,
    company: h.getString('company'),
    company_name: c ? c.name : '',
    fund: h.getString('fund'),
    fund_name: f ? f.name : '',
    deal: h.getString('deal'),
    status: h.getString('status'),
    currency: h.getString('currency'),
    cost_minor: cost,
    value_minor: v.value_minor,
    value_basis: v.value_basis,
    ownership_ppm: own ? own.ppm : null,
    first_day: h.getString('first_day'),
    exit_day: h.getString('exit_day'),
    proceeds_minor: h.getInt('proceeds_minor'),
    flows: flowsOf(app, h),
  };
}

/**
 * holdingsOf(app, { company | fund, ctx }) (SPEC 4.6): every holding of a
 * company or a fund, not deleted. With `ctx` (a person, or your AI agent,
 * acting in a request) only the holdings that caller may see: funds in its
 * scope (members.funds), restricted deals by their team. Without ctx: every
 * holding (system work: NAV, metrics, cron).
 */
function holdingsOf(app, o) {
  const util = u();
  const q = o || {};
  const today = util.today(app);
  let rows;
  if (q.company) rows = util.findMany(app, 'holdings', "company = {:c} && deleted_at = ''", 'created', 0, { c: String(q.company) });
  else if (q.fund) rows = util.findMany(app, 'holdings', "fund = {:f} && deleted_at = ''", 'created', 0, { f: String(q.fund) });
  else rows = util.findMany(app, 'holdings', "deleted_at = ''", 'created', 0);
  if (q.ctx) rows = rows.filter((h) => visible(q.ctx, h));
  return rows.map((h) => contractRow(app, h, today));
}

/** holdingsFor(ctx, { company | fund }): the holdings the caller may see (holdingsOf scoped to ctx). */
function holdingsFor(ctx, o) {
  return holdingsOf(ctx.app, Object.assign({}, o || {}, { ctx: ctx }));
}

/** kpiSeries (SPEC 4.6), implemented by lib_portfolio_kpi. */
function kpiSeries(app, companyId, key, opts) {
  return L('lib_portfolio_kpi').kpiSeries(app, companyId, key, opts);
}

/** runway (SPEC 4.6), implemented by lib_portfolio_kpi. */
function runway(app, companyId) {
  return L('lib_portfolio_kpi').runwayOf(app, companyId);
}

/* -------------------------------------------------------------- views */

function securityOut(app, s) {
  const util = u();
  return {
    id: s.id,
    holding: s.getString('holding'),
    round: s.getString('round'),
    kind: s.getString('kind'),
    class: s.getString('class'),
    day: s.getString('day'),
    shares: s.getInt('shares') || null,
    cost_minor: s.getInt('cost_minor'),
    cap_minor: s.getInt('cap_minor') || null,
    discount_ppm: s.getInt('discount_ppm') || null,
    rate_ppm: s.getInt('rate_ppm') || null,
    liq_pref_e8: s.getInt('liq_pref_e8') || null,
    participating: s.getBool('participating'),
    status: s.getString('status'),
    converted_into: s.getString('converted_into'),
    converted_day: s.getString('converted_day'),
    anchors: util.jsonOf(s, 'anchors', []) || [],
    actor: s.getString('actor'),
  };
}

function roundOut(app, r) {
  const util = u();
  return {
    id: r.id,
    company: r.getString('company'),
    holding: r.getString('holding'),
    day: r.getString('day'),
    type: r.getString('type'),
    label: r.getString('label') || ROUND_LABELS[r.getString('type')] || 'Round',
    currency: r.getString('currency'),
    pre_money_minor: r.getInt('pre_money_minor') || null,
    post_money_minor: r.getInt('post_money_minor') || null,
    raised_minor: r.getInt('raised_minor') || null,
    price_e8: r.getInt('price_e8') || null,
    pre_shares: r.getInt('pre_shares') || null,
    post_shares: r.getInt('post_shares') || null,
    pool_increase_shares: r.getInt('pool_increase_shares') || null,
    cap_table: util.jsonOf(r, 'cap_table', []) || [],
    conversion: util.jsonOf(r, 'conversion', null),
    anchors: util.jsonOf(r, 'anchors', []) || [],
    note: r.getString('note'),
    actor: r.getString('actor'),
  };
}

/** The pro rata figure of a holding: the right, the ownership to keep, and the amount for the latest round after entry. */
function prorataOf(app, h, own) {
  const out = { right: h.getBool('pro_rata'), ownership_ppm: own ? own.ppm : null, amount_minor: null, round: null, currency: h.getString('currency') };
  if (!own || own.ppm <= 0) return out;
  const rows = u().findMany(app, 'rounds', 'company = {:c} && day > {:d} && raised_minor > 0', '-day', 1, { c: h.getString('company'), d: h.getString('first_day') || '0000-00-00' });
  if (rows.length === 0) return out;
  const last = rows[0];
  out.amount_minor = L('lib_eng_prorata').amount({ ownership_ppm: own.ppm, round_minor: last.getInt('raised_minor') }).amount_minor;
  out.round = { id: last.id, label: last.getString('label') || ROUND_LABELS[last.getString('type')] || 'Round', day: last.getString('day'), currency: last.getString('currency') };
  return out;
}

function holdingOut(app, h, detail) {
  const util = u();
  const today = util.today(app);
  const cost = costOf(app, h.id);
  const v = valueOf(app, h, cost, today);
  const own = ownershipNow(app, h.id);
  const g = L('lib_eng_metrics').gross({ company_flows: flowsOf(app, h), value_minor: v.value_minor, as_of_day: today });
  const deal = h.getString('deal') !== '' ? util.byId(app, 'deals', h.getString('deal')) : null;
  const out = {
    id: h.id,
    company: companyMini(app, h.getString('company')),
    fund: fundOf(app, h.getString('fund')),
    deal: deal ? { id: deal.id, number: deal.getString('number') } : null,
    status: h.getString('status'),
    currency: h.getString('currency'),
    pro_rata: h.getBool('pro_rata'),
    major_investor: h.getBool('major_investor'),
    board_role: h.getString('board_role') || 'none',
    first_day: h.getString('first_day'),
    exit_day: h.getString('exit_day'),
    proceeds_minor: h.getInt('proceeds_minor'),
    fy_end_month: h.getInt('fy_end_month') || 12,
    report_currency: h.getString('report_currency') || h.getString('currency'),
    lead: L('lib_records').mini(app, 'members', h.getString('lead')),
    note: h.getString('note'),
    cost_minor: cost,
    value_minor: v.value_minor,
    value_basis: v.value_basis,
    mark: v.mark,
    moic_e8: g.moic_e8,
    moic_reason: g.reasons.moic,
    ownership_ppm: own ? own.ppm : null,
    ownership_day: own ? own.day : '',
    prov: util.jsonOf(h, 'prov', {}) || {},
  };
  if (detail) {
    out.securities = securitiesOf(app, h.id).map((s) => securityOut(app, s));
    out.ownership = util.findMany(app, 'ownership', 'holding = {:h}', 'day,created', 0, { h: h.id }).map((o) => ({ day: o.getString('day'), ppm: o.getInt('ppm'), basis: o.getString('basis'), shares: o.getInt('shares') || null, fd_shares: o.getInt('fd_shares') || null, round: o.getString('round') }));
    out.prorata = prorataOf(app, h, own);
  }
  return out;
}

/* ------------------------------------------------------ SAFE previews */

/** Terms read from params (major units text) with the deal's defaults: { instrument, currency, amount_minor, ... }. */
function termsFrom(ctx, p, deal) {
  const util = u();
  const round = deal ? util.jsonOf(deal, 'round', {}) || {} : {};
  const fundRec = util.has(p, 'fund') && util.str(p, 'fund', '') !== '' ? fundRef(ctx.app, util.str(p, 'fund', '')) : deal && deal.getString('fund') !== '' ? util.byId(ctx.app, 'entities', deal.getString('fund')) : onlyFund(ctx.app);
  const currency = (util.str(p, 'currency', '') || (deal ? deal.getString('currency') : '') || (fundRec ? fundRec.getString('currency') : '') || baseCurrency(ctx.app)).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw util.fail(400, 'currency is a three-letter code such as USD.', 'invalid_param', { param: 'currency' });
  const dealInstr = deal ? deal.getString('instrument') : '';
  const instrument = util.oneOf(p, 'instrument', INSTRUMENTS, INSTRUMENTS.indexOf(dealInstr) >= 0 ? dealInstr : '');
  if (instrument === '') throw util.fail(400, 'instrument is required: one of ' + INSTRUMENTS.join(', ') + '.', 'missing_param', { param: 'instrument' });
  let amount = money(p, 'amount', currency, false);
  if (amount === null && deal && deal.getInt('check_minor') > 0) amount = deal.getInt('check_minor');
  if (amount === null || amount <= 0) throw util.fail(400, 'amount is required: the check in ' + currency + ', e.g. --amount 500000.', 'missing_param', { param: 'amount' });
  const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
  const t = {
    instrument: instrument,
    currency: currency,
    fund: fundRec,
    amount_minor: amount,
    day: util.day(p, 'day', util.today(ctx.app)),
    cap_minor: money(p, 'cap', currency, false),
    discount_ppm: util.ppm(p, 'discount', { min: 0, max: 1000000 }),
    rate_ppm: util.ppm(p, 'rate', { min: 0, max: 1000000 }),
    round_type: util.oneOf(p, 'round_type', ROUND_TYPES, round.type && ROUND_TYPES.indexOf(round.type) >= 0 ? round.type : ''),
    pre_money_minor: money(p, 'pre_money', currency, false),
    post_money_minor: money(p, 'post_money', currency, false),
    raise_minor: money(p, 'raise', currency, false),
    price_e8: util.e8(p, 'price', { positive: true }),
    pre_shares: shares(p, 'pre_shares'),
    post_shares: shares(p, 'post_shares'),
    shares: shares(p, 'shares'),
    class: util.text(p, 'class', 80, ''),
  };
  if (t.pre_money_minor === null && num(round.pre_money_minor) !== null) t.pre_money_minor = num(round.pre_money_minor);
  if (t.post_money_minor === null && num(round.post_money_minor) !== null) t.post_money_minor = num(round.post_money_minor);
  if (t.raise_minor === null && num(round.raise_minor) !== null) t.raise_minor = num(round.raise_minor);
  // A capped SAFE's cap is the round's post-money when the deal records one and no cap was given.
  if (instrument === 'safe_cap' && t.cap_minor === null && t.post_money_minor !== null) t.cap_minor = t.post_money_minor;
  if (instrument === 'safe_cap' && t.cap_minor === null) throw util.fail(400, 'A capped SAFE needs --cap (the post-money valuation cap).', 'missing_param', { param: 'cap' });
  if (instrument === 'safe_discount' && t.discount_ppm === null) throw util.fail(400, 'A discount SAFE needs --discount (percent, e.g. 20).', 'missing_param', { param: 'discount' });
  if (instrument === 'note' && t.rate_ppm === null) throw util.fail(400, 'A note needs --rate (annual interest percent, e.g. 6).', 'missing_param', { param: 'rate' });
  if (instrument === 'priced' && t.post_money_minor === null && (t.pre_money_minor === null || t.raise_minor === null)) throw util.fail(400, 'A priced round needs --post_money, or --pre_money and --raise.', 'missing_param', { param: 'post_money' });
  // The round price, derived when the round gives the pre-money and its fully diluted shares (price = pre-money / pre-money shares).
  if (t.price_e8 === null && t.pre_money_minor !== null && t.pre_shares !== null && t.pre_shares > 0) t.price_e8 = derivePrice(t.pre_money_minor, t.pre_shares, currency);
  return t;
}

/** price_e8 = pre-money (major) / pre-money fully diluted shares, exact (lib_eng_core). */
function derivePrice(preMoneyMinor, preShares, currency) {
  const c = L('lib_eng_core');
  return c.mulDiv(preMoneyMinor, E8, preShares * Math.pow(10, c.exponent(currency)));
}

/**
 * The engine preview for terms: ownership at signing, implied price and,
 * for SAFEs and notes, the conversion at a scenario priced round (by
 * default the next round prices at twice the cap and sells 20% of the
 * company; --scenario_pre_money and --scenario_raise change it).
 */
function previewOf(t, p) {
  const util = u();
  const S = L('lib_eng_safe');
  const input = { instrument: t.instrument, currency: t.currency, amount_minor: t.amount_minor };
  if (t.cap_minor !== null) input.cap_minor = t.cap_minor;
  if (t.discount_ppm !== null) input.discount_ppm = t.discount_ppm;
  if (t.rate_ppm !== null) input.rate_ppm = t.rate_ppm;
  input.issued_day = t.day;
  if (t.instrument === 'priced') {
    if (t.post_money_minor !== null) input.post_money_minor = t.post_money_minor;
    else {
      input.pre_money_minor = t.pre_money_minor;
      input.raise_minor = t.raise_minor;
    }
    if (t.price_e8 !== null) input.price_e8 = t.price_e8;
    else if (t.post_shares !== null && t.post_shares > 0) input.post_shares = t.post_shares;
  } else if (t.pre_shares !== null && t.pre_shares > 0) input.pre_shares = t.pre_shares;
  let scenario = null;
  if (t.instrument !== 'priced') {
    const base = t.cap_minor !== null ? t.cap_minor : t.post_money_minor;
    let sPre = money(p || {}, 'scenario_pre_money', t.currency, false);
    let sRaise = money(p || {}, 'scenario_raise', t.currency, false);
    if (sPre === null && base !== null) sPre = base * 2;
    if (sRaise === null && sPre !== null) sRaise = Math.round(sPre / 4);
    if (sPre !== null && sRaise !== null && sPre > 0 && sRaise > 0) {
      const notional = !(t.pre_shares !== null && t.pre_shares > 0);
      const preShares = notional ? NOTIONAL_SHARES : t.pre_shares;
      scenario = { pre_money_minor: sPre, raise_minor: sRaise, pre_shares: preShares, notional: notional, price_e8: derivePrice(sPre, preShares, t.currency), day: util.dayAdd(t.day, 365) };
      input.scenario = { price_e8: scenario.price_e8, pre_shares: preShares, new_money_minor: sRaise, day: scenario.day };
    }
  }
  const out = S.preview(input);
  let converted = null;
  if (out.conversion) {
    const mine = (out.conversion.safes || []).concat(out.conversion.notes || []).filter((x) => x.id === 'this')[0] || null;
    if (mine) converted = { ownership_ppm: mine.ownership_ppm, basis: mine.basis, shares: scenario && scenario.notional ? null : mine.shares, conversion_price_e8: scenario && scenario.notional ? null : mine.conversion_price_e8 };
  }
  return {
    instrument: t.instrument,
    currency: t.currency,
    amount_minor: t.amount_minor,
    cap_minor: t.cap_minor,
    discount_ppm: t.discount_ppm,
    rate_ppm: t.rate_ppm,
    post_money_minor: t.post_money_minor,
    ownership_ppm: out.ownership_ppm,
    reason: out.reason,
    implied_price_e8: out.implied_price_e8,
    price_e8: t.price_e8,
    scenario: scenario,
    converted: converted,
  };
}

/** safe.preview: the engine's answer for these terms, nothing stored. */
function opSafePreview(ctx, p) {
  const util = u();
  const dealText = util.str(p, 'deal', '');
  let deal = null;
  if (dealText !== '') {
    deal = L('lib_deals').ref(ctx.app, dealText);
    L('lib_deals').guard(ctx, deal);
  }
  const t = termsFrom(ctx, p, deal);
  const out = previewOf(t, p);
  out.fund = t.fund ? { id: t.fund.id, name: t.fund.getString('name') } : null;
  out.day = t.day;
  return out;
}

/* -------------------------------------------------------- invest flow */

/**
 * The committee's say on a deal (lib_committee.decisionOf): the latest
 * decision, and whether Mark invested waits: a latest decision other than
 * invest (code decision_not_invest) or open conditions (conditions_open).
 * No decision at all (a follow-on, an SPV, a check below the committee)
 * does not block. Owners and partners may override; it is audited.
 */
function committeeGate(ctx, deal) {
  const dec = L('lib_committee').decisionOf(ctx.app, deal.id);
  const out = { decision: null, blocked: false, code: '', message: '', may_override: ctx.owner === true || ctx.roleCode === 'partner' };
  if (!dec) return out;
  out.decision = { id: dec.id, outcome: dec.outcome, outcome_label: dec.outcome_label || dec.outcome, decided_at: dec.decided_at || '', conditions_open: Number(dec.conditions_open) || 0, conditions_total: Number(dec.conditions_total) || 0 };
  if (dec.outcome !== 'invest') {
    out.blocked = true;
    out.code = 'decision_not_invest';
    out.message = "The committee's latest decision on " + deal.getString('number') + ' is ' + (dec.outcome_label || dec.outcome) + ', not invest.';
  } else if (out.decision.conditions_open > 0) {
    out.blocked = true;
    out.code = 'conditions_open';
    out.message = out.decision.conditions_open + ' committee condition' + (out.decision.conditions_open === 1 ? ' is' : 's are') + ' still open on ' + deal.getString('number') + '.';
  }
  return out;
}

/** holdings.invest-check: what the committee says before Mark invested (the Investment tab's Terms step). */
function opInvestCheck(ctx, p) {
  const util = u();
  const D = L('lib_deals');
  const deal = D.ref(ctx.app, util.req(p, 'deal', 'D-0012'));
  D.guard(ctx, deal);
  const g = committeeGate(ctx, deal);
  return Object.assign({ deal: deal.getString('number'), status: deal.getString('status') }, g);
}

function newHolding(ctx, companyId, fundRec, o) {
  const util = u();
  const app = ctx.app;
  const h = util.newRecord(app, 'holdings');
  h.set('company', companyId);
  h.set('fund', fundRec ? fundRec.id : '');
  h.set('deal', o.deal || '');
  h.set('status', 'active');
  h.set('currency', o.currency);
  h.set('pro_rata', o.pro_rata === true);
  h.set('major_investor', o.major_investor === true);
  h.set('board_role', o.board_role || 'none');
  h.set('first_day', o.day);
  h.set('fy_end_month', o.fy_end_month || 12);
  h.set('report_currency', o.report_currency || o.currency);
  h.set('lead', o.lead || '');
  h.set('prov', { created: prov(ctx, o.source_ref) });
  stamp(ctx, h);
  app.save(h);
  return h;
}

function newRound(ctx, companyId, holdingId, t, extra) {
  const util = u();
  const r = util.newRecord(ctx.app, 'rounds');
  r.set('company', companyId);
  r.set('holding', holdingId || '');
  r.set('day', t.day);
  r.set('type', t.round_type || '');
  r.set('currency', t.currency);
  if (t.pre_money_minor !== null) r.set('pre_money_minor', t.pre_money_minor);
  if (t.post_money_minor !== null) r.set('post_money_minor', t.post_money_minor);
  else if (t.pre_money_minor !== null && t.raise_minor !== null) r.set('post_money_minor', t.pre_money_minor + t.raise_minor);
  if (t.raise_minor !== null) r.set('raised_minor', t.raise_minor);
  if (t.price_e8 !== null) r.set('price_e8', t.price_e8);
  if (t.pre_shares !== null) r.set('pre_shares', t.pre_shares);
  if (t.post_shares !== null) r.set('post_shares', t.post_shares);
  r.set('label', (extra && extra.label) || '');
  r.set('prov', { created: prov(ctx, extra && extra.source_ref) });
  stamp(ctx, r);
  ctx.app.save(r);
  return r;
}

function newSecurity(ctx, holdingId, roundId, s) {
  const util = u();
  const r = util.newRecord(ctx.app, 'securities');
  r.set('holding', holdingId);
  r.set('round', roundId || '');
  r.set('kind', s.kind);
  r.set('class', s.class || '');
  r.set('day', s.day || '');
  if (s.shares) r.set('shares', s.shares);
  r.set('cost_minor', s.cost_minor || 0);
  if (s.cap_minor) r.set('cap_minor', s.cap_minor);
  if (s.discount_ppm) r.set('discount_ppm', s.discount_ppm);
  if (s.rate_ppm) r.set('rate_ppm', s.rate_ppm);
  if (s.liq_pref_e8) r.set('liq_pref_e8', s.liq_pref_e8);
  r.set('participating', s.participating === true);
  r.set('status', s.status || 'outstanding');
  r.set('anchors', s.anchors || []);
  r.set('prov', { created: prov(ctx, s.source_ref) });
  stamp(ctx, r);
  ctx.app.save(r);
  return r;
}

function newOwnership(ctx, holdingId, o) {
  const util = u();
  const r = util.newRecord(ctx.app, 'ownership');
  r.set('holding', holdingId);
  r.set('day', o.day);
  r.set('ppm', Math.max(0, Math.min(1000000, Math.round(o.ppm))));
  if (o.shares) r.set('shares', o.shares);
  if (o.fd_shares) r.set('fd_shares', o.fd_shares);
  r.set('basis', o.basis);
  r.set('round', o.round || '');
  r.set('security', o.security || '');
  r.set('note', util.clip(o.note || '', 300));
  stamp(ctx, r);
  ctx.app.save(r);
  return r;
}

/** Shares bought in a priced round: given, or amount / price (rounded down). */
function pricedShares(t) {
  if (t.shares !== null && t.shares > 0) return t.shares;
  if (t.price_e8 === null || t.price_e8 <= 0) return null;
  const c = L('lib_eng_core');
  return Number(c.divFloor(BigInt(t.amount_minor) * c.BE8, BigInt(t.price_e8) * c.bpow10(c.exponent(t.currency))));
}

/**
 * holdings.create-from-deal (Mark invested): the holding (or the fund's
 * existing one in that company), the round, the security and the
 * ownership the engine gives; the deal is marked invested; closing
 * documents uploaded with it are stored on the holding and your AI agent
 * is asked to read them (closing_extract).
 */
function opCreateFromDeal(ctx, p) {
  const util = u();
  const app = ctx.app;
  L('lib_auth').need(ctx, 'pipeline', 'edit', 'mark a deal invested');
  const D = L('lib_deals');
  const deal = D.ref(app, util.req(p, 'deal', 'D-0012'));
  D.guard(ctx, deal);
  const st = deal.getString('status');
  if (st !== 'open' && st !== 'hold') throw util.fail(409, deal.getString('number') + ' is ' + st + '; only an open deal can be marked invested.', 'not_open', { status: st });
  const gate = committeeGate(ctx, deal);
  const override = util.bool(p, 'override', false);
  if (gate.blocked) {
    if (!override) throw util.fail(409, gate.message + (gate.may_override ? ' Pass --override true to mark it invested anyway (it is recorded).' : ' An owner or a partner can override.'), gate.code, { decision: gate.decision, may_override: gate.may_override });
    if (!gate.may_override) throw util.fail(403, gate.message + ' Only an owner or a partner can override the committee.', 'not_permitted', { decision: gate.decision });
  }
  const t = termsFrom(ctx, p, deal);
  if (t.fund === null) throw util.fail(400, 'fund is required (the firm has several funds or none).', 'missing_param', { param: 'fund' });
  const pv = previewOf(t, p);
  const companyId = deal.getString('company');
  let h = util.findOne(app, 'holdings', "company = {:c} && fund = {:f} && deleted_at = ''", { c: companyId, f: t.fund.id });
  const created = h === null;
  if (created) {
    h = newHolding(ctx, companyId, t.fund, {
      deal: deal.id,
      currency: t.currency,
      pro_rata: util.bool(p, 'pro_rata', false),
      major_investor: util.bool(p, 'major_investor', false),
      board_role: util.oneOf(p, 'board_role', BOARD_ROLES, 'none'),
      day: t.day,
      lead: deal.getString('point'),
      source_ref: deal.getString('number'),
    });
  } else if (h.getString('currency') !== t.currency) {
    throw util.fail(409, 'This fund already holds ' + (companyMini(app, companyId) || {}).name + ' in ' + h.getString('currency') + '; record the check in that currency.', 'currency_mismatch');
  }
  const round = t.round_type !== '' || t.pre_money_minor !== null || t.post_money_minor !== null || t.raise_minor !== null ? newRound(ctx, companyId, h.id, t, { source_ref: deal.getString('number') }) : null;
  const sec = newSecurity(ctx, h.id, round ? round.id : '', {
    kind: t.instrument,
    class: t.class || (t.instrument === 'priced' ? (ROUND_LABELS[t.round_type] || 'Preferred') + ' Preferred' : ''),
    day: t.day,
    shares: t.instrument === 'priced' ? pricedShares(t) : null,
    cost_minor: t.amount_minor,
    cap_minor: t.cap_minor,
    discount_ppm: t.discount_ppm,
    rate_ppm: t.rate_ppm,
    source_ref: deal.getString('number'),
  });
  let ownPpm = null;
  if (pv.ownership_ppm !== null) {
    let ppm = pv.ownership_ppm;
    const sh = sec.getInt('shares');
    if (t.instrument === 'priced' && sh > 0 && t.post_shares !== null && t.post_shares > 0) ppm = L('lib_eng_core').mulDiv(sh, 1000000, t.post_shares);
    // A further check into a company the fund already holds adds to its ownership (each at its own basis).
    const prior = created ? null : ownershipNow(app, h.id);
    ownPpm = (prior ? prior.ppm : 0) + ppm;
    newOwnership(ctx, h.id, { day: t.day, ppm: ownPpm, shares: sh || null, fd_shares: t.instrument === 'priced' ? t.post_shares : null, basis: t.instrument === 'safe_cap' ? 'cap' : 'priced', round: round ? round.id : '', security: sec.id });
  }
  if (!ctx.dryRun) D.setStatus(ctx, deal.id, 'invested', 'Invested ' + short(t.amount_minor, t.currency));
  // Closing documents: stored on the holding, read by your AI agent.
  const files = [];
  for (const f of ctx.e ? L('lib_files').uploadedAll(ctx.e, 'file') : []) files.push(L('lib_files').add(ctx, { owner_collection: 'holdings', owner_id: h.id, folder: 'Closing', origin: 'upload', upload: f }));
  // Closing documents added by a person ask your AI agent to read them (trigger closing_extract).
  let request = '';
  if (files.length > 0 && !ctx.dryRun && !ctx.isAgent) request = L('lib_agent').ask(app, 'closing_extract', app.findRecordById('holdings', h.id), {}, { by: ctx.memberId || '' });
  L('lib_audit').note(ctx, { collection: 'holdings', record: h.id, summary: deal.getString('number') + ' marked invested: ' + short(t.amount_minor, t.currency) + ' ' + t.instrument.replace('_', ' ') + ' from ' + t.fund.getString('name') + (gate.blocked ? ' (over the committee: ' + gate.message + ')' : '') });
  if (created) emit(ctx, 'holding.created', { holding: h.id, company: companyId, fund: t.fund.id, deal: deal.id });
  return { holding: holdingOut(app, app.findRecordById('holdings', h.id), true), security: securityOut(app, sec), round: round ? roundOut(app, round) : null, preview: pv, ownership_ppm: ownPpm, files: files, request: request, created: created, overrode: gate.blocked ? gate.code : '' };
}

/* --------------------------------------------------- rounds, securities */

/** The holdings of a company with outstanding SAFEs or notes, for conversion at a priced round. */
function outstandingConvertibles(app, companyId) {
  const out = [];
  for (const h of u().findMany(app, 'holdings', "company = {:c} && deleted_at = '' && status = 'active'", 'created', 0, { c: companyId })) {
    for (const s of securitiesOf(app, h.id)) {
      const k = s.getString('kind');
      if (s.getString('status') === 'outstanding' && (k === 'safe_cap' || k === 'safe_discount' || k === 'safe_mfn' || k === 'note')) out.push({ holding: h, security: s });
    }
  }
  return out;
}

/** Convert the fund's outstanding SAFEs and notes at a priced round (engine); answers the engine's result. */
function convertAt(ctx, round) {
  const util = u();
  const app = ctx.app;
  const companyId = round.getString('company');
  const list = outstandingConvertibles(app, companyId);
  if (list.length === 0) return null;
  const price = round.getInt('price_e8');
  const pre = round.getInt('pre_shares');
  if (price <= 0 || pre <= 0) return null;
  const currency = round.getString('currency');
  const safes = [];
  const notes = [];
  for (const x of list) {
    const s = x.security;
    if (x.holding.getString('currency') !== currency) throw util.fail(409, 'A SAFE or note is held in ' + x.holding.getString('currency') + ' but the round is in ' + currency + '; convert by hand with securities.save.', 'currency_mismatch');
    if (s.getString('kind') === 'note') notes.push({ id: s.id, principal_minor: s.getInt('cost_minor'), rate_ppm: s.getInt('rate_ppm'), issued_day: s.getString('day'), cap_minor: s.getInt('cap_minor') || null, discount_ppm: s.getInt('discount_ppm') || null });
    else safes.push({ id: s.id, amount_minor: s.getInt('cost_minor'), cap_minor: s.getString('kind') === 'safe_mfn' ? null : s.getInt('cap_minor') || null, discount_ppm: s.getString('kind') === 'safe_mfn' ? null : s.getInt('discount_ppm') || null, mfn: s.getString('kind') === 'safe_mfn', issued_day: s.getString('day') });
  }
  const input = { currency: currency, price_e8: price, pre_shares: pre, safes: safes, notes: notes, day: round.getString('day') };
  if (round.getInt('raised_minor') > 0) input.new_money_minor = round.getInt('raised_minor');
  else throw util.fail(400, 'The round needs --raise (new money) to convert SAFEs and notes.', 'missing_param', { param: 'raise' });
  if (round.getInt('pool_increase_shares') > 0) input.pool_increase_shares = round.getInt('pool_increase_shares');
  const res = L('lib_eng_safe').convert(input);
  const byId = {};
  for (const x of (res.safes || []).concat(res.notes || [])) byId[x.id] = x;
  const label = round.getString('label') || ROUND_LABELS[round.getString('type')] || 'Round';
  const touched = {};
  for (const x of list) {
    const r = byId[x.security.id];
    if (!r) continue;
    const s = app.findRecordById('securities', x.security.id);
    const ns = newSecurity(ctx, x.holding.id, round.id, { kind: 'priced', class: label + ' Preferred (converted)', day: round.getString('day'), shares: r.shares, cost_minor: 0, source_ref: 'conversion' });
    s.set('status', 'converted');
    s.set('converted_into', ns.id);
    s.set('converted_day', round.getString('day'));
    app.save(s);
    touched[x.holding.id] = true;
  }
  for (const hid of Object.keys(touched)) restateOwnership(ctx, hid, round, res.post_shares, 'converted');
  return res;
}

/** After a priced round with post shares: ownership = shares held / post-round fully diluted shares. */
function restateOwnership(ctx, holdingId, round, postShares, basis) {
  const util = u();
  if (!postShares || postShares <= 0) return null;
  let held = 0;
  for (const s of securitiesOf(ctx.app, holdingId)) if (s.getString('status') === 'outstanding' && s.getInt('shares') > 0) held += s.getInt('shares');
  if (held <= 0) return null;
  return newOwnership(ctx, holdingId, { day: round.getString('day') || util.today(ctx.app), ppm: L('lib_eng_core').mulDiv(held, 1000000, postShares), shares: held, fd_shares: postShares, basis: basis, round: round.id });
}

/** rounds.save: a company's round (new or by id); a priced round converts the fund's SAFEs and notes and restates ownership. */
function opRoundSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  let r = null;
  const id = util.str(p, 'round', '');
  if (id !== '') {
    r = util.byId(app, 'rounds', id);
    if (r === null) throw util.fail(404, 'No round ' + id + '.', 'not_found', { param: 'round' });
  }
  const company = r !== null ? app.findRecordById('companies', r.getString('company')) : companyRef(app, util.req(p, 'company', 'acme.com'));
  const mine = holdingsOfCompany(ctx, company.id);
  if (mine.rows.length === 0) throw util.fail(404, 'The firm holds nothing in ' + company.getString('name') + ' you can see; rounds belong to portfolio companies.', 'not_found');
  const currency = (util.str(p, 'currency', '') || (r ? r.getString('currency') : '') || mine.rows[0].getString('currency')).toUpperCase();
  const isNew = r === null;
  if (isNew) {
    r = util.newRecord(app, 'rounds');
    r.set('company', company.id);
    r.set('holding', mine.rows.length === 1 ? mine.rows[0].id : '');
    r.set('prov', {});
  }
  r.set('currency', currency);
  const set = (field, v) => {
    if (v !== null && v !== undefined) r.set(field, v);
  };
  set('day', util.day(p, 'day', isNew ? util.today(app) : null));
  if (util.has(p, 'type')) r.set('type', util.oneOf(p, 'type', ROUND_TYPES, ''));
  if (util.has(p, 'label')) r.set('label', util.text(p, 'label', 80, ''));
  set('pre_money_minor', money(p, 'pre_money', currency));
  set('post_money_minor', money(p, 'post_money', currency));
  set('raised_minor', money(p, 'raise', currency));
  set('price_e8', util.e8(p, 'price', { positive: true }));
  set('pre_shares', shares(p, 'pre_shares'));
  set('post_shares', shares(p, 'post_shares'));
  set('pool_increase_shares', shares(p, 'pool_increase_shares'));
  if (util.has(p, 'note')) r.set('note', util.text(p, 'note', 2000, ''));
  const cap = util.list(p, 'cap_table');
  if (cap !== undefined) {
    const rows = cap.map((x, i) => {
      util.keysOnly(x, ['holder', 'class', 'shares', 'ppm'], 'cap_table[' + i + ']');
      const sh = x.shares === undefined || x.shares === null || x.shares === '' ? null : Number(x.shares);
      if (sh !== null && (!Number.isInteger(sh) || sh < 0)) throw util.fail(400, 'cap_table[' + i + '].shares must be a whole number.', 'invalid_param', { param: 'cap_table' });
      return { holder: util.clip(String(x.holder || ''), 120), class: util.clip(String(x.class || ''), 80), shares: sh };
    });
    const total = rows.reduce((a, x) => a + (x.shares || 0), 0);
    r.set('cap_table', rows.map((x) => Object.assign(x, { ppm: total > 0 && x.shares !== null ? L('lib_eng_core').mulDiv(x.shares, 1000000, total) : null })));
  }
  const anchors = util.list(p, 'anchors');
  if (anchors !== undefined) r.set('anchors', anchors.map(String).slice(0, 50));
  if (r.getInt('post_money_minor') === 0 && r.getInt('pre_money_minor') > 0 && r.getInt('raised_minor') > 0) r.set('post_money_minor', r.getInt('pre_money_minor') + r.getInt('raised_minor'));
  if (r.getInt('price_e8') === 0 && r.getInt('pre_money_minor') > 0 && r.getInt('pre_shares') > 0) r.set('price_e8', derivePrice(r.getInt('pre_money_minor'), r.getInt('pre_shares'), currency));
  const pv = util.jsonOf(r, 'prov', {}) || {};
  pv[isNew ? 'created' : 'changed'] = prov(ctx, util.str(p, 'source_ref', ''));
  r.set('prov', pv);
  stamp(ctx, r);
  app.save(r);
  let conversion = null;
  if (util.bool(p, 'convert', true) && r.getInt('price_e8') > 0 && r.getInt('pre_shares') > 0) {
    conversion = convertAt(ctx, r);
    if (conversion) {
      r.set('conversion', conversion);
      if (r.getInt('post_shares') === 0) r.set('post_shares', conversion.post_shares);
      app.save(r);
    }
  }
  // Holdings with priced shares (not just converted ones) are diluted by the round: restate them when post shares are known.
  if (conversion === null && r.getInt('post_shares') > 0) for (const h of mine.rows) restateOwnership(ctx, h.id, r, r.getInt('post_shares'), 'round');
  L('lib_audit').note(ctx, { collection: 'rounds', record: r.id, summary: (isNew ? 'Added ' : 'Changed ') + (r.getString('label') || ROUND_LABELS[r.getString('type')] || 'a round') + ' of ' + company.getString('name') + (conversion ? ' (SAFEs and notes converted)' : '') });
  return { round: roundOut(app, r), conversion: conversion };
}

function previewRound(ctx, params) {
  const app = ctx.app;
  let name = '';
  try {
    name = params.round ? (companyMini(app, app.findRecordById('rounds', params.round).getString('company')) || {}).name : companyRef(app, params.company).getString('name');
  } catch {
    name = String(params.company || '');
  }
  const fields = ['type', 'day', 'pre_money', 'post_money', 'raise', 'price', 'pre_shares', 'post_shares'].filter((k) => params[k] !== undefined && params[k] !== '').map((k) => ({ name: k, before: '', after: String(params[k]) }));
  return { label: (params.round ? 'Change a round of ' : 'Add a round to ') + name, target: params.round ? 'rounds:' + params.round : '', fields: fields, notes: params.cap_table ? ['With a summary cap table'] : [], risk: 'medium' };
}

/** securities.save: a security of a holding (new or by id). */
function opSecuritySave(ctx, p) {
  const util = u();
  const app = ctx.app;
  let s = null;
  const id = util.str(p, 'security', '');
  let h;
  if (id !== '') {
    s = util.byId(app, 'securities', id);
    if (s === null) throw util.fail(404, 'No security ' + id + '.', 'not_found', { param: 'security' });
    h = app.findRecordById('holdings', s.getString('holding'));
    if (!visible(ctx, h)) throw util.fail(404, 'No security ' + id + ' you can see.', 'not_found');
  } else h = holdingRef(ctx, util.req(p, 'holding', 'acme.com'), util.str(p, 'fund', ''));
  const currency = h.getString('currency');
  const isNew = s === null;
  if (isNew) {
    s = util.newRecord(app, 'securities');
    s.set('holding', h.id);
    s.set('status', 'outstanding');
    s.set('kind', util.oneOf(p, 'kind', SECURITY_KINDS, ''));
    if (s.getString('kind') === '') throw util.fail(400, 'kind is required: one of ' + SECURITY_KINDS.join(', ') + '.', 'missing_param', { param: 'kind' });
    s.set('prov', {});
  } else if (util.has(p, 'kind')) s.set('kind', util.oneOf(p, 'kind', SECURITY_KINDS, s.getString('kind')));
  const set = (field, v) => {
    if (v !== null && v !== undefined) s.set(field, v);
  };
  if (util.has(p, 'round')) {
    const rid = util.str(p, 'round', '');
    if (rid !== '' && util.byId(app, 'rounds', rid) === null) throw util.fail(404, 'No round ' + rid + '.', 'not_found', { param: 'round' });
    s.set('round', rid);
  }
  if (util.has(p, 'class')) s.set('class', util.text(p, 'class', 80, ''));
  set('day', util.day(p, 'day', isNew ? util.today(app) : null));
  set('shares', shares(p, 'shares'));
  set('cost_minor', money(p, 'cost', currency));
  set('cap_minor', money(p, 'cap', currency));
  set('discount_ppm', util.ppm(p, 'discount', { min: 0, max: 1000000 }));
  set('rate_ppm', util.ppm(p, 'rate', { min: 0, max: 1000000 }));
  set('liq_pref_e8', util.e8(p, 'liq_pref'));
  if (util.has(p, 'participating')) s.set('participating', util.bool(p, 'participating', false));
  const anchors = util.list(p, 'anchors');
  if (anchors !== undefined) s.set('anchors', anchors.map(String).slice(0, 50));
  if (s.getString('kind') === 'safe_cap' && s.getInt('cap_minor') <= 0) throw util.fail(400, 'A capped SAFE needs --cap.', 'missing_param', { param: 'cap' });
  const pv = util.jsonOf(s, 'prov', {}) || {};
  pv[isNew ? 'created' : 'changed'] = prov(ctx, util.str(p, 'source_ref', ''));
  s.set('prov', pv);
  stamp(ctx, s);
  app.save(s);
  // Ownership: a capped SAFE adds investment / cap (engine); priced shares restate against the round's post shares.
  let own = null;
  if (isNew && s.getString('kind') === 'safe_cap') {
    const add = L('lib_eng_safe').ownership({ amount_minor: s.getInt('cost_minor'), cap_minor: s.getInt('cap_minor') }).ownership_ppm;
    const prior = ownershipNow(app, h.id);
    own = newOwnership(ctx, h.id, { day: s.getString('day'), ppm: (prior ? prior.ppm : 0) + add, basis: 'cap', security: s.id });
  } else if (s.getInt('shares') > 0 && s.getString('round') !== '') {
    const r = app.findRecordById('rounds', s.getString('round'));
    if (r.getInt('post_shares') > 0) own = restateOwnership(ctx, h.id, r, r.getInt('post_shares'), 'round');
  }
  L('lib_audit').note(ctx, { collection: 'securities', record: s.id, summary: (isNew ? 'Added ' : 'Changed ') + 'a ' + s.getString('kind').replace('_', ' ') + ' of ' + (companyMini(app, h.getString('company')) || {}).name });
  return { security: securityOut(app, s), ownership_ppm: own ? own.getInt('ppm') : null };
}

function previewSecurity(ctx, params) {
  const fields = ['kind', 'class', 'day', 'shares', 'cost', 'cap', 'discount', 'rate'].filter((k) => params[k] !== undefined && params[k] !== '').map((k) => ({ name: k, before: '', after: String(params[k]) }));
  let name = String(params.holding || '');
  try {
    const h = params.security ? ctx.app.findRecordById('holdings', ctx.app.findRecordById('securities', params.security).getString('holding')) : holdingRef(Object.assign({}, ctx, { actor: 'system' }), params.holding, params.fund);
    name = (companyMini(ctx.app, h.getString('company')) || {}).name;
  } catch {
    /* label only */
  }
  return { label: (params.security ? 'Change a security of ' : 'Add a security to ') + name, target: params.security ? 'securities:' + params.security : '', fields: fields, notes: [], risk: 'medium' };
}

/* ------------------------------------------------------------ reads */

/** holdings.get: a holding in full (by id, or a company with one holding). */
function opGet(ctx, p) {
  const util = u();
  const h = holdingRef(ctx, util.req(p, 'holding', 'acme.com'), util.str(p, 'fund', ''));
  return { holding: holdingOut(ctx.app, h, true) };
}

/** holdings.company: everything the portfolio company page needs about positions (every holding of the company). */
function opCompany(ctx, p) {
  const util = u();
  const app = ctx.app;
  const c = companyRef(app, util.req(p, 'company', 'acme.com'));
  const mine = holdingsOfCompany(ctx, c.id);
  const rounds = util.findMany(app, 'rounds', 'company = {:c}', 'day,created', 0, { c: c.id }).map((r) => roundOut(app, r));
  return { company: companyMini(app, c.id), holdings: mine.rows.map((h) => holdingOut(app, h, true)), rounds: rounds, hidden: mine.hidden };
}

/* ------------------------------------------------- company page (portfolio.company) */

/** The first sentence of a text, at most `max` characters (a hero's one line). */
function firstSentence(text, max) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t === '') return '';
  const m = t.match(/^(.+?[.!?])(\s|$)/);
  const one = m ? m[1] : t;
  return one.length <= max ? one : one.slice(0, max - 3).replace(/\s+\S*$/, '') + '...';
}

const BOARD_FOLDER = 'Board';
const DECK_FOLDER = 'Deck';

/**
 * portfolio.company: the portfolio company page in one read. The company
 * (one line, sector, stage, HQ, founded, website), its founders (founder
 * roles on its deals, else the people at the company), quick links (the
 * latest deck, board deck and founder update, the founders' emails), the
 * fund position per holding with the last round, the latest update, open
 * asks, the next board meeting, and the files (decks, board decks, founder
 * updates and the deal room) newest first. Only what ctx may see.
 */
function opPage(ctx, p) {
  const util = u();
  const app = ctx.app;
  const F = L('lib_files');
  const D = L('lib_deals');
  const K = L('lib_portfolio_kpi');
  const c = companyRef(app, util.req(p, 'company', 'acme.com'));
  const mine = holdingsOfCompany(ctx, c.id);
  if (mine.rows.length === 0) throw util.fail(404, 'No holding in ' + c.getString('name') + ' you can see. Run holdings.list.', 'not_found', { company: c.id });
  const today = util.today(app);
  const domain = c.getString('domain');

  // Deals of the company ctx may see (founders, decks, the deal room).
  const vis = D.visibleSql(ctx, 'd');
  const deals = util.rows(app, "SELECT d.id AS id, d.number AS number, COALESCE(json_extract(d.round, '$.type'), '') AS round_type FROM deals d WHERE d.company = {:c} AND d.deleted_at = '' AND " + vis.sql + ' ORDER BY d.created DESC', { id: '', number: '', round_type: '' }, Object.assign({ c: c.id }, vis.bind));
  const dealIds = deals.map((d) => d.id);
  const inList = (ids, prefix, bind) => ids.map((id, i) => ((bind[prefix + i] = id), '{:' + prefix + i + '}')).join(', ');

  // One line: the description's first sentence, else the newest intake one-liner.
  let one = firstSentence(c.getString('description'), 160);
  if (one === '') {
    const r = util.one(app, "SELECT one_liner FROM intake_items WHERE company = {:c} AND one_liner != '' ORDER BY received_at DESC LIMIT 1", { one_liner: '' }, { c: c.id });
    if (r !== null) one = firstSentence(r.one_liner, 160);
  }
  const lastRound = util.one(app, "SELECT id, type, label, day, currency, post_money_minor, raised_minor FROM rounds WHERE company = {:c} AND (type != '' OR label != '') ORDER BY day DESC, created DESC LIMIT 1", { id: '', type: '', label: '', day: '', currency: '', post_money_minor: 0, raised_minor: 0 }, { c: c.id });
  // The stage a person gave the company wins; else the latest round's, else the deal's.
  const ownStage = STAGE_LABELS[c.getString('stage')] || '';
  const stage = ownStage !== '' ? ownStage : lastRound !== null ? lastRound.label || ROUND_LABELS[lastRound.type] || '' : deals.length > 0 && deals[0].round_type !== '' ? ROUND_LABELS[deals[0].round_type] || '' : '';

  // Founders: founder roles on its deals and current jobs there marked founder; else the people at the company.
  const people = [];
  const seen = {};
  const jobTitle = {};
  for (const r of util.rows(app, "SELECT person, title FROM employments WHERE company = {:c} AND current = TRUE AND title != ''", { person: '', title: '' }, { c: c.id })) jobTitle[r.person] = r.title;
  if (dealIds.length > 0) {
    const b = {};
    const list = inList(dealIds, 'dl', b);
    for (const r of util.rows(app, 'SELECT p.id AS id, p.name AS name, p.email AS email, p.title AS title FROM deal_people dp JOIN people p ON p.id = dp.person WHERE dp.deal IN (' + list + ") AND dp.role = 'founder' AND p.deleted_at = '' ORDER BY dp.created", { id: '', name: '', email: '', title: '' }, b)) {
      if (seen[r.id]) continue;
      seen[r.id] = true;
      people.push({ id: r.id, name: r.name || r.email, email: r.email, title: jobTitle[r.id] || r.title, role: 'founder' });
    }
  }
  for (const r of util.rows(app, "SELECT p.id AS id, p.name AS name, p.email AS email, p.title AS title FROM employments e JOIN people p ON p.id = e.person WHERE e.company = {:c} AND e.current = TRUE AND e.founder = TRUE AND p.deleted_at = '' ORDER BY e.created", { id: '', name: '', email: '', title: '' }, { c: c.id })) {
    if (seen[r.id]) continue;
    seen[r.id] = true;
    people.push({ id: r.id, name: r.name || r.email, email: r.email, title: jobTitle[r.id] || r.title, role: 'founder' });
  }
  const founders = people.length > 0;
  if (!founders)
    for (const r of util.rows(app, "SELECT id, name, email, title FROM people WHERE company = {:c} AND deleted_at = '' ORDER BY created LIMIT 8", { id: '', name: '', email: '', title: '' }, { c: c.id })) people.push({ id: r.id, name: r.name || r.email, email: r.email, title: jobTitle[r.id] || r.title, role: 'person' });

  // Files: the company's own, its deals' (the deal room), founder updates' and board decks, each once, readable only.
  const fileRecs = {};
  const add = (f) => {
    if (f === null || fileRecs[f.id] || !f.getBool('current') || f.getString('deleted_at') !== '') return;
    if (!F.canRead(ctx, f).ok) return;
    fileRecs[f.id] = f;
  };
  for (const f of util.findMany(app, 'files', "owner_collection = 'companies' && owner_id = {:c} && current = true && deleted_at = ''", '-created', 200, { c: c.id })) add(f);
  if (dealIds.length > 0) {
    const b = {};
    const list = inList(dealIds, 'df', b);
    for (const r of util.rows(app, 'SELECT id FROM files WHERE deal IN (' + list + ") AND current = TRUE AND deleted_at = '' ORDER BY created DESC LIMIT 200", { id: '' }, b)) add(util.byId(app, 'files', r.id));
  }
  const updates = util.findMany(app, 'updates', "company = {:c} && status != 'dismissed'", '-received_at,-created', 60, { c: c.id });
  const updateOf = {};
  for (const up of updates)
    for (const fid of util.jsonOf(up, 'files', []) || []) {
      updateOf[fid] = up;
      add(util.byId(app, 'files', fid));
    }
  const meetings = util.findMany(app, 'board_meetings', 'company = {:c}', '-day', 200, { c: c.id });
  const boardOf = {};
  for (const b of meetings)
    if (b.getString('deck') !== '') {
      boardOf[b.getString('deck')] = b;
      add(util.byId(app, 'files', b.getString('deck')));
    }
  const ids = Object.keys(fileRecs);
  const texts = ids.length > 0 ? F.textsOf(app, ids) : {};
  const files = [];
  for (const id of ids) {
    const f = fileRecs[id];
    const kind = boardOf[id] || f.getString('folder') === BOARD_FOLDER ? 'board' : updateOf[id] ? 'update' : f.getString('folder') === DECK_FOLDER ? 'deck' : 'file';
    const day = boardOf[id] ? boardOf[id].getString('day') : updateOf[id] ? util.dayOf(app, updateOf[id].getString('received_at')) : util.dayOf(app, f.getString('created'));
    const t = texts[id] || { pages: 0 };
    files.push({ id: 'f:' + id, kind: kind, name: f.getString('name'), day: day, file: id, update: updateOf[id] ? updateOf[id].id : '', ext: f.getString('ext'), pages: t.pages || 0, folder: f.getString('folder') });
  }
  // Founder updates sent as an email body (no file) are files of the page too.
  for (const up of updates) {
    if ((util.jsonOf(up, 'files', []) || []).length > 0) continue;
    const pe = up.getString('period_end');
    files.push({ id: 'u:' + up.id, kind: 'update', name: up.getString('subject') || (pe !== '' ? K.monthLabel(pe) + ' update' : 'Founder update'), day: util.dayOf(app, up.getString('received_at')), file: '', update: up.id, ext: '', pages: 0, folder: '' });
  }
  files.sort((a, b) => (a.day === b.day ? (a.name < b.name ? -1 : 1) : a.day < b.day ? 1 : -1));

  const newest = (kind) => files.filter((x) => x.kind === kind && x.file !== '')[0] || null;
  const latestUpd = updates.length > 0 ? updates[0] : null;
  const emails = people.map((x) => x.email).filter((e) => e !== '');

  // The fund position: each holding with its fund, cost, value, multiple, ownership.
  const position = mine.rows.map((h) => {
    const o = holdingOut(app, h, false);
    return { holding: o.id, fund: o.fund, deal: o.deal, status: o.status, currency: o.currency, invested_minor: o.cost_minor, value_minor: o.value_minor, value_basis: o.value_basis, moic_e8: o.moic_e8, ownership_ppm: o.ownership_ppm, first_day: o.first_day, board_role: o.board_role, lead: o.lead };
  });

  // Work: the latest update, open asks (in progress first), the next board meeting.
  let update = null;
  if (latestUpd !== null) {
    const pe = latestUpd.getString('period_end');
    const counts = { staged: 0, verified: 0 };
    for (const x of util.rows(app, 'SELECT status, COUNT(*) AS n FROM kpi_values WHERE "update" = {:u} GROUP BY status', { status: '', n: 0 }, { u: latestUpd.id })) if (counts[x.status] !== undefined) counts[x.status] = x.n;
    // The summary: the update's first paragraph of substance (a greeting line is too short to count).
    const paras = String(latestUpd.getString('body') || '')
      .split(/\n\s*\n/)
      .map((x) => x.replace(/\s+/g, ' ').trim())
      .filter((x) => x !== '');
    const lead = paras.filter((x) => x.length >= 40)[0] || paras.join(' ');
    update = { id: latestUpd.id, subject: latestUpd.getString('subject'), received_at: latestUpd.getString('received_at'), period_label: pe !== '' ? K.monthLabel(pe) : '', from_name: latestUpd.getString('from_name'), status: latestUpd.getString('status'), summary: lead.length <= 360 ? lead : lead.slice(0, 357).replace(/\s+\S*$/, '') + '...', counts: counts };
  }
  const asksAll = L('lib_portfolio_updates').opAsksList(ctx, { company: c.id, status: 'live' }).asks;
  const asks = asksAll.filter((a) => a.status === 'in_progress').concat(asksAll.filter((a) => a.status === 'open'));
  const next = meetings.filter((b) => b.getString('day') >= today).sort((a, b) => (a.getString('day') < b.getString('day') ? -1 : 1))[0] || null;

  const website = c.getString('website') || (domain !== '' ? 'https://' + domain : '');
  return {
    company: {
      id: c.id,
      name: c.getString('name'),
      domain: domain,
      // The company's own logo first; else the public favicon of the domain ('' in a demo firm: its companies are fictional).
      logo_url: L('lib_logos').companyUrl(c),
      logo_domain: L('lib_mail').demo(app) ? '' : domain,
      stage_key: c.getString('stage'),
      website: website,
      one_liner: one,
      description: c.getString('description'),
      sector: c.getString('sector'),
      subsector: c.getString('subsector'),
      stage: stage,
      hq_city: c.getString('hq_city'),
      hq_country: c.getString('hq_country'),
      founded_year: c.getInt('founded_year') || null,
      team_size: c.getInt('team_size') || null,
      linkedin: c.getString('linkedin'),
    },
    people: { founders: founders, list: people },
    links: {
      website: website,
      deck: newest('deck'),
      board_deck: newest('board'),
      update: latestUpd !== null ? { id: latestUpd.id, day: util.dayOf(app, latestUpd.getString('received_at')), label: update.period_label } : null,
      files: files.length,
      emails: emails,
    },
    position: position,
    last_round: lastRound !== null ? { label: lastRound.label || ROUND_LABELS[lastRound.type] || 'Round', day: lastRound.day, currency: lastRound.currency, post_money_minor: lastRound.post_money_minor || null, raised_minor: lastRound.raised_minor || null } : null,
    update: update,
    asks: { open: asksAll.filter((a) => a.status === 'open').length, in_progress: asksAll.filter((a) => a.status === 'in_progress').length, items: asks.slice(0, 5) },
    next_board: next !== null ? { id: next.id, day: next.getString('day'), time: next.getString('time'), title: next.getString('title') || 'Board meeting', brief: util.jsonOf(next, 'brief', null) !== null } : null,
    files: files.slice(0, 60),
    hidden: mine.hidden,
  };
}

/** ownership.get: the dated ownership series of a holding and the summary cap table of each round. */
function opOwnership(ctx, p) {
  const util = u();
  const app = ctx.app;
  const h = holdingRef(ctx, util.req(p, 'holding', 'acme.com'), util.str(p, 'fund', ''));
  const out = holdingOut(app, h, true);
  const rounds = util.findMany(app, 'rounds', 'company = {:c}', 'day,created', 0, { c: h.getString('company') }).map((r) => roundOut(app, r));
  return { holding: h.id, company: out.company, ownership_ppm: out.ownership_ppm, series: out.ownership, rounds: rounds.map((r) => ({ id: r.id, label: r.label, day: r.day, post_money_minor: r.post_money_minor, price_e8: r.price_e8, post_shares: r.post_shares, cap_table: r.cap_table })) };
}

/** prorata.preview: what keeping ownership through a round costs, and ownership if the fund skips it. */
function opProrata(ctx, p) {
  const util = u();
  const app = ctx.app;
  const h = holdingRef(ctx, util.req(p, 'holding', 'acme.com'), util.str(p, 'fund', ''));
  const own = ownershipNow(app, h.id);
  if (!own || own.ppm <= 0) throw util.fail(409, 'Ownership of this holding is not known yet (a SAFE without a cap converts at the next priced round).', 'unknown_ownership');
  const currency = h.getString('currency');
  const P = L('lib_eng_prorata');
  const raise = money(p, 'raise', currency, false);
  const post = money(p, 'post_money', currency, false);
  const out = { holding: h.id, currency: currency, ownership_ppm: own.ppm, right: h.getBool('pro_rata') };
  if (raise !== null) {
    out.amount_minor = P.amount({ ownership_ppm: own.ppm, round_minor: raise }).amount_minor;
    if (post !== null && post > raise) {
      const newPpm = L('lib_eng_core').mulDiv(raise, 1000000, post);
      out.new_ppm = newPpm;
      out.ownership_if_skip_ppm = P.afterSkip({ ownership_ppm: own.ppm, new_ppm: newPpm }).ownership_ppm;
    }
  }
  const newShares = shares(p, 'new_shares');
  if (newShares !== null && own.shares > 0 && own.fd_shares > 0) {
    const m = P.toMaintain({ held_shares: own.shares, pre_shares: own.fd_shares, new_shares: newShares, price_e8: util.e8(p, 'price', { positive: true }), currency: currency });
    out.shares_to_buy = m.shares_to_buy;
    out.cost_minor = m.cost_minor;
    out.ownership_if_skip_ppm = m.ownership_if_skip_ppm;
  }
  if (out.amount_minor === undefined && out.shares_to_buy === undefined) throw util.fail(400, 'Give --raise (the round\'s new money, with --post_money for dilution) or --new_shares with --price.', 'missing_param', { param: 'raise' });
  return out;
}

/** holdings.update: status (exit, write-off), exit proceeds, pro rata, board role, fiscal year end, reporting currency, lead, note. */
function opUpdate(ctx, p) {
  const util = u();
  const app = ctx.app;
  const h = holdingRef(ctx, util.req(p, 'holding', 'acme.com'), util.str(p, 'fund', ''));
  const before = holdingOut(app, h, false);
  if (util.has(p, 'status')) h.set('status', util.oneOf(p, 'status', STATUSES, h.getString('status')));
  if (util.has(p, 'exit_day')) h.set('exit_day', util.day(p, 'exit_day', ''));
  if (util.has(p, 'proceeds')) h.set('proceeds_minor', money(p, 'proceeds', h.getString('currency')) || 0);
  if (h.getString('status') === 'exited' && h.getString('exit_day') === '') h.set('exit_day', util.today(app));
  if (util.has(p, 'pro_rata')) h.set('pro_rata', util.bool(p, 'pro_rata', false));
  if (util.has(p, 'major_investor')) h.set('major_investor', util.bool(p, 'major_investor', false));
  if (util.has(p, 'board_role')) h.set('board_role', util.oneOf(p, 'board_role', BOARD_ROLES, 'none'));
  if (util.has(p, 'fy_end_month')) h.set('fy_end_month', util.int(p, 'fy_end_month', 12, 1, 12));
  if (util.has(p, 'report_currency')) {
    const c = util.str(p, 'report_currency', '').toUpperCase();
    if (!/^[A-Z]{3}$/.test(c)) throw util.fail(400, 'report_currency is a three-letter code such as EUR.', 'invalid_param', { param: 'report_currency' });
    h.set('report_currency', c);
  }
  if (util.has(p, 'lead')) {
    const l = util.str(p, 'lead', '');
    h.set('lead', l === '' ? '' : L('lib_auth').memberRef(app, l === 'me' ? ctx.memberId : l).id);
  }
  if (util.has(p, 'note')) h.set('note', util.text(p, 'note', 2000, ''));
  const pv = util.jsonOf(h, 'prov', {}) || {};
  pv.changed = prov(ctx, util.str(p, 'source_ref', ''));
  h.set('prov', pv);
  app.save(h);
  const after = holdingOut(app, h, false);
  L('lib_audit').note(ctx, { collection: 'holdings', record: h.id, summary: 'Changed the holding in ' + (after.company || {}).name, before: before, after: after });
  return { holding: after };
}

function previewUpdate(ctx, params) {
  const fields = ['status', 'exit_day', 'proceeds', 'pro_rata', 'board_role', 'fy_end_month', 'report_currency', 'lead', 'note'].filter((k) => params[k] !== undefined && params[k] !== '').map((k) => ({ name: k, before: '', after: String(params[k]) }));
  return { label: 'Change the holding ' + String(params.holding || ''), target: '', fields: fields, notes: [], risk: params.status ? 'high' : 'medium' };
}

/** Ctrl-K: portfolio companies by name. */
function search(ctx, q, limit) {
  const util = u();
  if (!L('lib_auth').can(ctx, 'portfolio', 'view')) return [];
  const rows = util.rows(ctx.app, "SELECT h.id AS id, h.company AS company, h.fund AS fund, c.name AS name FROM holdings h JOIN companies c ON c.id = h.company WHERE h.deleted_at = '' AND c.name LIKE {:q} ESCAPE '\\' ORDER BY c.name LIMIT {:n}", { id: '', company: '', fund: '', name: '' }, { q: util.like(q), n: Math.max(1, Math.min(20, limit || 8)) });
  const out = [];
  const seen = {};
  for (const r of rows) {
    if (seen[r.company]) continue;
    const h = ctx.app.findRecordById('holdings', r.id);
    if (!visible(ctx, h)) continue;
    seen[r.company] = true;
    const f = fundOf(ctx.app, r.fund);
    out.push({ kind: 'holding', id: r.company, title: r.name, subtitle: f ? f.name : 'Portfolio', href: '#/portfolio/' + r.company, icon: 'Briefcase' });
  }
  return out;
}

/** Timeline items for a company: investments and rounds (the updates library adds updates, values, alerts, board meetings). */
function timelineFor(ctx, target) {
  const util = u();
  if (!target || target.kind !== 'company' || !L('lib_auth').can(ctx, 'portfolio', 'view')) return [];
  const app = ctx.app;
  const items = [];
  const mine = holdingsOfCompany(ctx, target.id);
  for (const h of mine.rows) {
    const f = fundOf(app, h.getString('fund'));
    for (const s of securitiesOf(app, h.id)) {
      if (s.getInt('cost_minor') <= 0) continue;
      items.push({ at: util.atOf(app, s.getString('day') || h.getString('first_day') || util.today(app)), module: 'portfolio', kind: 'invested', title: 'Invested ' + short(s.getInt('cost_minor'), h.getString('currency')) + (f ? ' from ' + f.name : ''), href: '#/portfolio/' + target.id + '?tab=holdings', icon: 'Briefcase', ref: 'securities:' + s.id });
    }
  }
  for (const r of util.findMany(app, 'rounds', 'company = {:c}', 'day', 0, { c: target.id })) {
    if (r.getString('day') === '') continue;
    items.push({ at: util.atOf(app, r.getString('day')), module: 'portfolio', kind: 'round', title: (r.getString('label') || ROUND_LABELS[r.getString('type')] || 'Round') + (r.getInt('raised_minor') > 0 ? ' ' + short(r.getInt('raised_minor'), r.getString('currency')) : ''), href: '#/portfolio/' + target.id + '?tab=holdings', icon: 'Layers', ref: 'rounds:' + r.id });
  }
  return { items: items.concat(L('lib_portfolio_updates').timelineItems(ctx, target.id)), hidden: mine.hidden };
}

/* ------------------------------------------------------------ imports */

/**
 * Holdings CSV row: company (name or domain), fund, instrument, amount, day,
 * valuation (a SAFE's post-money cap or a priced round's post-money),
 * currency. A row whose holding already has a security of that day and
 * cost is skipped.
 */
function importHolding(ctx, row) {
  const util = u();
  const app = ctx.app;
  const fundRec = row.fund ? fundRef(app, row.fund) : onlyFund(app);
  if (fundRec === null) throw util.fail(400, 'fund is empty and the firm has several funds.', 'missing_param');
  const currency = String(row.currency || fundRec.getString('currency') || baseCurrency(app)).toUpperCase();
  const instrument = String(row.instrument || 'priced').toLowerCase();
  if (INSTRUMENTS.indexOf(instrument) < 0) throw util.fail(400, 'instrument must be one of: ' + INSTRUMENTS.join(', '), 'invalid_param');
  const amount = L('lib_money').toMinor(String(row.amount || ''), currency, false);
  if (amount === null || amount <= 0) throw util.fail(400, 'amount is not an amount in ' + currency, 'invalid_amount');
  const valuation = row.valuation ? L('lib_money').toMinor(String(row.valuation), currency, false) : null;
  const day = row.day || util.today(app);
  // A domain matches the company by its domain and never renames it; a name matches (or creates) by name.
  const ref = util.squash(String(row.company || ''));
  const isDomain = ref.indexOf('.') > 0 && ref.indexOf(' ') < 0;
  const company = L('lib_records').upsertCompany(ctx, Object.assign(isDomain ? { domain: ref } : { name: ref }, { origin: 'portfolio', source_ref: 'import' }));
  let h = util.findOne(app, 'holdings', "company = {:c} && fund = {:f} && deleted_at = ''", { c: company.id, f: fundRec.id });
  if (h !== null && util.findOne(app, 'securities', 'holding = {:h} && day = {:d} && cost_minor = {:a}', { h: h.id, d: day, a: amount }) !== null) return { action: 'skipped', id: h.id, message: 'Already recorded' };
  const created = h === null;
  if (created) h = newHolding(ctx, company.id, fundRec, { currency: currency, day: day, source_ref: 'import' });
  const s = newSecurity(ctx, h.id, '', { kind: instrument, day: day, cost_minor: amount, cap_minor: instrument === 'safe_cap' ? valuation : null, source_ref: 'import' });
  if (valuation !== null && valuation > 0 && (instrument === 'safe_cap' || instrument === 'priced')) {
    const add = L('lib_eng_safe').ownership({ amount_minor: amount, cap_minor: valuation }).ownership_ppm;
    const prior = created ? null : ownershipNow(app, h.id);
    newOwnership(ctx, h.id, { day: day, ppm: (prior ? prior.ppm : 0) + add, basis: 'import', security: s.id });
  }
  if (created) emit(ctx, 'holding.created', { holding: h.id, company: company.id, fund: fundRec.id, deal: '' });
  return { action: created ? 'created' : 'updated', id: h.id, message: company.name };
}

/* ------------------------------------------------------------ the list */

/** holdings.list: the Portfolio page (figure strip and one row per holding). */
function opList(ctx, p) {
  return L('lib_portfolio_kpi').portfolioList(ctx, p);
}

/** agent.ask --trigger closing_extract --record <holding>: a holding with closing documents. */
function closingCheck(ctx, h) {
  L('lib_auth').need(ctx, 'portfolio', 'edit', 'ask your AI agent to read closing documents');
  if (u().count(ctx.app, "SELECT COUNT(*) AS n FROM files WHERE owner_collection = 'holdings' AND owner_id = {:h} AND deleted_at = '' AND current = TRUE", { h: h.id }) === 0) throw u().fail(409, 'This holding has no closing documents: add them first.', 'nothing_to_read');
  return {};
}

/** The deal a holding came from (a restricted deal your AI agent may not work on refuses the ask). */
function holdingDeal(app, h) {
  return h.getString('deal');
}

module.exports = {
  closingCheck: closingCheck,
  holdingDeal: holdingDeal,
  INSTRUMENTS: INSTRUMENTS,
  INSTRUMENT_LABELS: INSTRUMENT_LABELS,
  SECURITY_KINDS: SECURITY_KINDS,
  ROUND_TYPES: ROUND_TYPES,
  ROUND_LABELS: ROUND_LABELS,
  BOARD_ROLES: BOARD_ROLES,
  STATUSES: STATUSES,
  short: short,
  pct: pct,
  fundOf: fundOf,
  companyMini: companyMini,
  baseCurrency: baseCurrency,
  stamp: stamp,
  prov: prov,
  emit: emit,
  companyRef: companyRef,
  fundRef: fundRef,
  onlyFund: onlyFund,
  visible: visible,
  holdingsOfCompany: holdingsOfCompany,
  holdingRef: holdingRef,
  securitiesOf: securitiesOf,
  costOf: costOf,
  ownershipNow: ownershipNow,
  valueOf: valueOf,
  flowsOf: flowsOf,
  holdingsOf: holdingsOf,
  holdingsFor: holdingsFor,
  kpiSeries: kpiSeries,
  runway: runway,
  holdingOut: holdingOut,
  securityOut: securityOut,
  roundOut: roundOut,
  termsFrom: termsFrom,
  derivePrice: derivePrice,
  previewOf: previewOf,
  opSafePreview: opSafePreview,
  opCreateFromDeal: opCreateFromDeal,
  committeeGate: committeeGate,
  opInvestCheck: opInvestCheck,
  convertAt: convertAt,
  opRoundSave: opRoundSave,
  previewRound: previewRound,
  opSecuritySave: opSecuritySave,
  previewSecurity: previewSecurity,
  opGet: opGet,
  opCompany: opCompany,
  opPage: opPage,
  opOwnership: opOwnership,
  opProrata: opProrata,
  opUpdate: opUpdate,
  previewUpdate: previewUpdate,
  opList: opList,
  search: search,
  timelineFor: timelineFor,
  importHolding: importHolding,
};
