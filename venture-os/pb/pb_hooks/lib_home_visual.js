/// <reference path="../pb_data/types.d.ts" />
/**
 * Home's visual dashboard (SPEC 3.1, the redesign): the figures behind the
 * hero constellation, the pipeline Sankey, deal flow by source, the day
 * timeline, the portfolio treemap, fund performance by quarter, the runway
 * strip, the sector mix and the growth small multiples. home.summary answers
 * them as `visual`, in the same read as the rest of Home.
 *
 *   visual(ctx, ref, next)  -> { currency, readouts, constellation, flow, sources, day,
 *                               portfolio, performance, sectors, next_items, hidden, timing }
 *
 * Every figure comes from the owning module's contract or engine: fund NAV,
 * multiples and quarters (lib_funds.books/metricsOf/jcurve, lib_eng_metrics),
 * holdings, values, KPI series and runways (lib_portfolio, lib_portfolio_kpi),
 * the cohort funnel (lib_deals_flow.funnel through lib_home.funnel), meetings
 * (lib_network.upcoming). Home only groups, sorts and converts to the firm's
 * currency through lib_fx. The heavy parts are kept in the app store under a
 * fingerprint of the tables they read (lib_home.cached), so they build again
 * only when those rows change. A part the caller may not see is named in
 * `hidden` and answers null; a part that fails is named in `errors` (empty).
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}
function H() {
  return L('lib_home');
}

const FUND_TABLES = ['ledger', 'marks', 'holdings', 'entities', 'capital_events', 'securities', 'fx_rates', 'commitments'];
/**
 * The rows the portfolio blocks read (lib_home.cached fingerprints each set by its row count and last
 * update): only the held companies, so an edit to a pipeline company never rebuilds them.
 */
const PORT_TABLES = ['holdings', 'securities', "marks WHERE status = 'approved'", 'kpi_values', 'kpi_defs', 'fx_rates', "entities WHERE kind IN ('fund', 'spv')", "companies WHERE id IN (SELECT company FROM holdings WHERE deleted_at = '')"];
const FLOW_TABLES = ['intake_items', 'deals', 'stage_events', 'deal_people', 'members', 'pipelines'];
const SOURCE_KEYS = ['email', 'upload', 'scout', 'sourced', 'introduced'];
const GROWTH_TOP = 8;
const PASSED_DAYS = 180;
const PASSED_MAX = 48;

/** The firm's currency (settings.base_currency). */
function baseCurrency(app) {
  return L('lib_settings').row(app).getString('base_currency') || 'USD';
}

/** Minor units in `ccy` to the firm's currency at the day's rate (lib_fx); null without a rate. */
function toBase(app, minor, ccy, base, day) {
  if (minor === null || minor === undefined) return null;
  const n = Number(minor);
  if (!Number.isFinite(n)) return null;
  if (n === 0 || !ccy || String(ccy).toUpperCase() === base) return n;
  const c = L('lib_fx').convert(app, n, ccy, base, day, 'end');
  return c.minor === null ? null : Number(c.minor);
}

function who(ctx) {
  return ctx.isAgent ? 'agent' : ctx.memberId || 'system';
}

function sectorKey(raw) {
  const s = u().squash(String(raw || '')).toLowerCase();
  return s === '' ? 'other' : s;
}

/** The fund the caller scoped (sidebar), resolved against the funds they may see: { id } or null; '-' when unknown. */
function scopedFund(ctx, ref) {
  if (ref === '') return '';
  const fv = L('lib_funds')
    .visibleFunds(ctx)
    .filter((f) => f.id === ref || f.name === ref || f.short_name === ref)[0];
  return fv === undefined ? '-' : fv.id;
}

/* ------------------------------------------------------------- funds */

/**
 * Each visible fund's NAV and multiples today (lib_funds.metricsOf), its signed commitments, the
 * part called and the uncalled rest (lib_funds.overviewOf), its size and the day it started, the
 * firm's NAV, committed, called and uncalled capital in its own currency, and the firm's multiples
 * and net IRR over every fund's LP flows (lib_eng_metrics.multiples, netIrr).
 */
function fundsOf(ctx) {
  const util = u();
  const app = ctx.app;
  const F = L('lib_funds');
  const day = util.today(app);
  const base = baseCurrency(app);
  const vis = F.visibleFunds(ctx).filter((f) => f.archived !== true);
  const ids = vis.map((f) => f.id).sort();
  return H().cached(app, 'v5:funds:' + day + ':' + $security.sha256(ids.join(',')), FUND_TABLES, () => {
    const funds = [];
    let nav = 0;
    let navKnown = false;
    let navOk = true;
    let paid = 0;
    let dist = 0;
    let flowsOk = true;
    let committed = 0;
    let called = 0;
    let unfunded = 0;
    let capitalOk = true;
    const firmFlows = [];
    for (const v of vis) {
      const f = app.findRecordById('entities', v.id);
      const b = F.books(app, f, day);
      const m = F.metricsOf(b, day).metrics;
      const ccy = m.currency || f.getString('currency') || base;
      const commits = F.commitmentsOf(app, f.id, 'signed');
      const ov = F.overviewOf(b, commits, F.accountsOf(b, commits, day));
      const cBase = toBase(app, ov.commitment_minor, ccy, base, day);
      const kBase = toBase(app, ov.called_minor, ccy, base, day);
      const uBase = toBase(app, ov.unfunded_minor, ccy, base, day);
      if (cBase === null || kBase === null || uBase === null) capitalOk = false;
      else {
        committed += cBase;
        called += kBase;
        unfunded += uBase;
      }
      const sizeOwn = f.getInt('size_minor') || f.getInt('target_minor') || ov.commitment_minor;
      const fc = f.getString('first_close_day');
      if (m.nav_minor !== null && m.nav_minor !== undefined) {
        const nb = toBase(app, m.nav_minor, ccy, base, day);
        if (nb === null) navOk = false;
        else {
          nav += nb;
          navKnown = true;
        }
      }
      for (const fl of F.lpFlows(b.rows.filter((r) => r.day <= day))) {
        const a = toBase(app, Math.abs(Number(fl.amount_minor)), ccy, base, fl.day);
        if (a === null) flowsOk = false;
        else {
          if (Number(fl.amount_minor) < 0) paid += a;
          else dist += a;
          firmFlows.push({ day: fl.day, amount_minor: Number(fl.amount_minor) < 0 ? -a : a });
        }
      }
      funds.push({
        id: f.id,
        name: f.getString('name'),
        label: f.getString('short_name') || f.getString('name'),
        kind: f.getString('kind'),
        vintage: f.getInt('vintage'),
        currency: ccy,
        nav_minor: m.nav_minor === undefined ? null : m.nav_minor,
        paid_in_minor: m.paid_in_minor,
        tvpi_e8: m.tvpi_e8,
        dpi_e8: m.dpi_e8,
        net_irr_ppm: m.net_irr_ppm,
        reasons: { tvpi: m.reasons ? m.reasons.tvpi : null },
        size_minor: toBase(app, sizeOwn, ccy, base, day),
        nav_base_minor: m.nav_minor === null || m.nav_minor === undefined ? null : toBase(app, m.nav_minor, ccy, base, day),
        committed_minor: cBase,
        called_minor: kBase,
        called_ppm: ov.called_ppm,
        unfunded_minor: uBase,
        start_day: fc !== '' ? fc : f.getInt('vintage') > 0 ? f.getInt('vintage') + '-01-01' : '',
      });
    }
    funds.sort((a, b) => (a.vintage || 9999) - (b.vintage || 9999) || (a.label < b.label ? -1 : 1));
    const firmNav = !navOk ? null : navKnown ? nav : null;
    let firm = { tvpi_e8: null, dpi_e8: null, rvpi_e8: null, net_irr_ppm: null, reason: funds.length === 0 ? 'no_fund' : 'no_rate' };
    if (flowsOk && navOk) {
      const E = L('lib_eng_metrics');
      const mm = E.multiples({ paid_in_minor: paid, distributed_minor: dist, nav_minor: firmNav });
      // The firm's net IRR: XIRR of every fund's LP flows in the firm's currency, the firm's NAV as the last inflow.
      const irr = firmNav === null ? null : E.netIrr({ lp_flows: firmFlows.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0)), nav_minor: firmNav, as_of_day: day }).irr_ppm;
      firm = { tvpi_e8: mm.tvpi_e8, dpi_e8: mm.dpi_e8, rvpi_e8: mm.rvpi_e8, net_irr_ppm: irr === undefined ? null : irr, reason: mm.reasons.tvpi };
    }
    return {
      funds: funds,
      nav_minor: firmNav,
      nav_reason: funds.length === 0 ? 'no_fund' : navOk ? (navKnown ? null : 'no_nav') : 'no_rate',
      paid_in_minor: paid,
      committed_minor: capitalOk ? committed : null,
      called_minor: capitalOk ? called : null,
      called_ppm: capitalOk && committed > 0 ? Math.round((called * 1000000) / committed) : null,
      unfunded_minor: capitalOk ? unfunded : null,
      firm: firm,
    };
  });
}

/**
 * Fund performance by quarter for one fund: at each quarter end (today for the current quarter) the
 * engine's net TVPI, DPI, RVPI and gross MOIC (lib_funds.metricsOf), with the quarter's calls
 * (negative) and distributions (lib_funds.jcurve), and today's net and gross IRR.
 */
function performanceOf(ctx, ref) {
  const app = ctx.app;
  const v = H().pickFund(ctx, ref);
  if (v === null) return null;
  const day = u().today(app);
  return H().cached(app, 'v:perf:' + v.id + ':' + day, FUND_TABLES, () => {
    const F = L('lib_funds');
    const f = app.findRecordById('entities', v.id);
    const b = F.books(app, f, day);
    const quarters = F.jcurve(b, day).map((q) => {
      const at = q.end > day ? day : q.end;
      const m = F.metricsOf(b, at).metrics;
      return {
        quarter: q.quarter,
        end: q.end,
        calls_minor: Number(q.calls_minor || 0),
        dist_minor: Number(q.dist_minor || 0),
        nav_minor: q.nav_minor === undefined ? null : q.nav_minor,
        tvpi_e8: m.tvpi_e8,
        dpi_e8: m.dpi_e8,
        rvpi_e8: m.rvpi_e8,
        gross_moic_e8: m.gross_moic_e8,
      };
    });
    const now = F.metricsOf(b, day).metrics;
    return {
      fund: { id: f.id, name: f.getString('name'), label: f.getString('short_name') || f.getString('name'), currency: now.currency || f.getString('currency') },
      quarters: quarters,
      net: { tvpi_e8: now.tvpi_e8, dpi_e8: now.dpi_e8, rvpi_e8: now.rvpi_e8, irr_ppm: now.net_irr_ppm },
      gross: { moic_e8: now.gross_moic_e8, irr_ppm: now.gross_irr_ppm },
      paid_in_minor: now.paid_in_minor,
    };
  });
}

/* ---------------------------------------------------------- portfolio */

/**
 * Every active holding the caller may see (lib_portfolio.visible: fund scope, restricted deals),
 * from the firm's whole set, which is built once for everyone (holdingsAll).
 */
function holdingsOf(ctx) {
  const util = u();
  const app = ctx.app;
  const all = holdingsAll(app);
  if (ctx.actor === 'system') return all;
  const P = L('lib_portfolio');
  const seen = {};
  let hidden = 0;
  for (const h of util.findMany(app, 'holdings', "deleted_at = ''", 'created', 0)) {
    if (P.visible(ctx, h)) seen[h.id] = true;
    else hidden++;
  }
  return { rows: all.rows.filter((r) => seen[r.holding] === true), hidden: hidden };
}

/**
 * Every active holding of the firm, as the Portfolio page answers it (lib_portfolio_kpi
 * .portfolioList: value at the latest approved mark else cost, the KPI series), with the company's
 * sector, its runway (lib_portfolio.runway: verified cash and burn), the holding's gross MOIC
 * (lib_eng_metrics.gross) and value and cost in the firm's currency. Kept until those rows change.
 */
function holdingsAll(app) {
  const util = u();
  const day = util.today(app);
  return H().cached(app, 'v3:port:all:' + day, PORT_TABLES, () => {
    const base = baseCurrency(app);
    const list = L('lib_portfolio_kpi').portfolioList(L('lib_auth').systemCtx(app), { status: 'active', limit: 1000 });
    const rows = list.rows || [];
    const sector = {};
    for (const r of util.rows(app, "SELECT c.id AS id, c.sector AS sector FROM companies c WHERE c.id IN (SELECT company FROM holdings WHERE deleted_at = '')", { id: '', sector: '' })) sector[r.id] = r.sector;
    const proceeds = {};
    const firstDay = {};
    for (const r of util.rows(app, "SELECT h.id AS id, h.proceeds_minor AS proceeds_minor, COALESCE(NULLIF(h.first_day, ''), (SELECT MIN(s.day) FROM securities s WHERE s.holding = h.id AND s.day != ''), '') AS first_day FROM holdings h WHERE h.deleted_at = ''", { id: '', proceeds_minor: 0, first_day: '' })) {
      proceeds[r.id] = r.proceeds_minor;
      firstDay[r.id] = r.first_day || '';
    }
    const runway = {};
    const P = L('lib_portfolio');
    const E = L('lib_eng_metrics');
    const out = [];
    for (const r of rows) {
      const cid = r.company ? r.company.id : '';
      if (cid === '') continue;
      if (runway[cid] === undefined) {
        const rw = P.runway(app, cid);
        runway[cid] = { months: rw.state === 'known' ? rw.months : null, state: rw.state, as_of_day: rw.as_of_day || '' };
      }
      const ccy = r.currency || base;
      const pr = Number(proceeds[r.id] || 0);
      const g = E.gross({ company_flows: [{ day: day, amount_minor: -Math.max(0, Number(r.cost_minor || 0)) }].concat(pr > 0 ? [{ day: day, amount_minor: pr }] : []), value_minor: Math.max(0, Number(r.value_minor || 0)), as_of_day: day });
      const spark = (r.kpi && r.kpi.spark) || [];
      out.push({
        holding: r.id,
        company: { id: cid, name: r.company.name || '' },
        fund: r.fund ? r.fund.id : '',
        sector: sectorKey(sector[cid]),
        currency: ccy,
        cost_minor: Number(r.cost_minor || 0),
        value_minor: Number(r.value_minor || 0),
        proceeds_minor: pr,
        value_basis: r.value_basis,
        cost_base_minor: toBase(app, r.cost_minor, ccy, base, day),
        value_base_minor: toBase(app, r.value_minor, ccy, base, day),
        proceeds_base_minor: toBase(app, pr, ccy, base, day),
        moic_e8: g.moic_e8,
        first_day: firstDay[r.id] || '',
        runway: runway[cid],
        kpi: r.kpi ? { key: r.kpi.key, label: r.kpi.label, currency: r.kpi.currency, points: spark.map((x) => ({ period_end: x.period_end, value: x.value, status: x.status })) } : null,
      });
    }
    return { rows: out, hidden: 0 };
  });
}

/** Health by runway: bad under the threshold, warn under twice it, good beyond, unknown without one. */
function healthOf(months, threshold) {
  if (months === null || months === undefined) return 'unknown';
  if (months < threshold) return 'bad';
  if (months < threshold * 2) return 'warn';
  return 'good';
}

/** Per company within the fund scope: value, cost and proceeds summed in the firm's currency, the gross MOIC over them. */
function byCompany(app, rows, day) {
  const E = L('lib_eng_metrics');
  const acc = {};
  const order = [];
  for (const r of rows) {
    const k = r.company.id;
    if (acc[k] === undefined) {
      acc[k] = { company: r.company, sector: r.sector, value: 0, cost: 0, proceeds: 0, ok: true, holdings: 0, runway: r.runway, kpi: r.kpi, kpiValue: -1 };
      order.push(k);
    }
    const a = acc[k];
    a.holdings++;
    if (r.value_base_minor === null || r.cost_base_minor === null || r.proceeds_base_minor === null) a.ok = false;
    else {
      a.value += r.value_base_minor;
      a.cost += r.cost_base_minor;
      a.proceeds += r.proceeds_base_minor;
    }
  }
  return order.map((k) => {
    const a = acc[k];
    let moic = null;
    if (a.ok && a.cost > 0) moic = E.gross({ company_flows: [{ day: day, amount_minor: -a.cost }].concat(a.proceeds > 0 ? [{ day: day, amount_minor: a.proceeds }] : []), value_minor: a.value, as_of_day: day }).moic_e8;
    return { company: a.company, sector: a.sector, value_minor: a.ok ? a.value : null, cost_minor: a.ok ? a.cost : null, moic_e8: moic, runway: a.runway, kpi: a.kpi, holdings: a.holdings };
  });
}

/** Growth over the series window (lib_eng_kpi.growth of the last point over the first) and the months it spans. */
function growthOf(points) {
  const v = (points || []).filter((x) => x.value !== null && x.value !== undefined);
  if (v.length < 2) return { growth_ppm: null, months: 0 };
  const first = v[0];
  const last = v[v.length - 1];
  const g = L('lib_eng_kpi').growth(last.value, first.value);
  const months = Math.round(u().daysBetween(first.period_end, last.period_end) / 30.44);
  return { growth_ppm: g.growth_ppm, months: months };
}

/* ----------------------------------------------------------- pipeline */

/** Open deals of the deal flow pipeline the caller may see, with their stage index; and the sector counts. */
function pipelineOf(ctx) {
  const util = u();
  const app = ctx.app;
  const D = L('lib_deals');
  const pl = D.pipelineOf(app, 'deal_flow');
  const stages = D.stagesOf(pl);
  const index = {};
  stages.forEach((s, i) => {
    index[s.key] = i;
  });
  const vis = D.visibleSql(ctx, 'd');
  const bind = Object.assign({ pl: pl.id }, vis.bind);
  const deals = util
    .rows(app, "SELECT d.id AS id, d.number AS number, d.name AS name, d.stage AS stage, COALESCE(c.name, '') AS company, COALESCE(c.sector, '') AS sector FROM deals d LEFT JOIN companies c ON c.id = d.company WHERE d.deleted_at = '' AND d.pipeline = {:pl} AND d.status = 'open' AND " + vis.sql + ' ORDER BY d.stage_entered_at', { id: '', number: '', name: '', stage: '', company: '', sector: '' }, bind)
    .map((r) => ({ id: r.id, number: r.number, name: r.company || r.name, stage: r.stage, stage_index: index[r.stage] === undefined ? 0 : index[r.stage], sector: sectorKey(r.sector) }));
  return { stages: stages.map((s) => ({ key: s.key, label: s.label })), deals: deals };
}

/** Deals passed in the last six months: the Inbox's passes (intake) and the pipeline's (deals passed or lost). */
function passedOf(ctx) {
  const util = u();
  const app = ctx.app;
  const auth = L('lib_auth');
  const since = util.atOf(app, util.dayAdd(util.today(app), -PASSED_DAYS), '00:00').replace('T', ' ');
  const out = [];
  if (auth.can(ctx, 'pipeline', 'view')) {
    const D = L('lib_deals');
    const vis = D.visibleSql(ctx, 'd');
    for (const r of util.rows(app, "SELECT COALESCE(c.name, d.name) AS name, d.status_at AS at FROM deals d LEFT JOIN companies c ON c.id = d.company WHERE d.deleted_at = '' AND d.status IN ('passed', 'lost') AND REPLACE(d.status_at, 'T', ' ') >= {:s} AND " + vis.sql + ' ORDER BY d.status_at DESC LIMIT ' + PASSED_MAX, { name: '', at: '' }, Object.assign({ s: since }, vis.bind)))
      out.push({ name: r.name, at: r.at });
  }
  if (auth.can(ctx, 'intake', 'view')) {
    let sql = "SELECT name, decided_at AS at FROM intake_items WHERE status = 'passed' AND REPLACE(decided_at, 'T', ' ') >= {:s}";
    const bind = { s: since };
    if (ctx.ownOnly) {
      sql += ' AND submitted_by = {:m}';
      bind.m = ctx.memberId || '-';
    }
    for (const r of util.rows(app, sql + ' ORDER BY decided_at DESC LIMIT ' + PASSED_MAX, { name: '', at: '' }, bind)) out.push({ name: r.name, at: r.at });
  }
  out.sort((a, b) => (a.at < b.at ? 1 : -1));
  return out.slice(0, PASSED_MAX).map((r) => ({ name: r.name, day: util.dayOf(app, r.at) }));
}

/**
 * The quarter's cohort as a flow: the funnel's bars (deals' cohort funnel, lib_home.funnel) as the
 * columns, and where each member of the cohort stopped: invested, passed, held or still open at its
 * furthest stage (the same cohort deals counts: intake items received in the quarter, not merged; a
 * deal the caller may not see counts as not reached).
 */
function flowOf(ctx) {
  const app = ctx.app;
  return H().cached(app, 'v:flow:' + who(ctx) + ':' + u().today(app), FLOW_TABLES, () => {
    const util = u();
    const D = L('lib_deals');
    const pl = D.pipelineOf(app, 'deal_flow');
    const stages = D.stagesOf(pl);
    const index = {};
    stages.forEach((s, i) => {
      index[s.key] = i;
    });
    const win = L('lib_deals_flow').windowOf(app, '');
    const vis = D.visibleSql(ctx, 'd');
    const bind = Object.assign({ pl: pl.id, fa: String(win.from_at).replace('T', ' '), ta: String(win.to_at).replace('T', ' ') }, vis.bind);
    const at = "REPLACE(COALESCE(NULLIF(i.received_at, ''), i.created), 'T', ' ')";
    let own = '';
    if (ctx.ownOnly) {
      own = ' AND i.submitted_by = {:own}';
      bind.own = ctx.memberId || '-';
    }
    const reached = "COALESCE((SELECT GROUP_CONCAT(DISTINCT e.to_stage) FROM stage_events e WHERE e.deal = d.id AND e.kind IN ('created', 'moved')), '')";
    const rows = util.rows(
      app,
      "SELECT i.status AS istatus, CASE WHEN d.id IS NULL THEN 0 WHEN " + vis.sql + " THEN 1 ELSE 0 END AS seen, COALESCE(d.stage, '') AS stage, COALESCE(d.status, '') AS dstatus, CASE WHEN d.id IS NULL THEN '' ELSE " + reached + " END AS reached FROM intake_items i LEFT JOIN deals d ON d.id = i.deal AND d.deleted_at = '' AND d.pipeline = {:pl} WHERE i.status != 'merged' AND " + at + ' >= {:fa} AND ' + at + ' < {:ta}' + own,
      { istatus: '', seen: 0, stage: '', dstatus: '', reached: '' },
      bind,
    );
    // Columns: 0 Inbound, 1.. the stages. Each member stops at the column of its furthest stage.
    const n = stages.length + 1;
    const exits = [];
    for (let i = 0; i < n; i++) exits.push({ col: i, passed: 0, invested: 0, held: 0, open: 0 });
    const counts = [];
    for (let i = 0; i < n; i++) counts.push(0);
    for (const r of rows) {
      let far = -1;
      if (r.seen === 1) for (const k of [r.stage].concat(String(r.reached || '').split(','))) if (index[k] !== undefined && index[k] > far) far = index[k];
      const col = far + 1;
      for (let i = 0; i <= col; i++) counts[i]++;
      let outcome = 'open';
      if (r.seen === 1) outcome = r.dstatus === 'invested' ? 'invested' : r.dstatus === 'passed' || r.dstatus === 'lost' ? 'passed' : r.dstatus === 'hold' ? 'held' : 'open';
      else outcome = r.istatus === 'passed' ? 'passed' : r.istatus === 'held' ? 'held' : 'open';
      exits[col][outcome]++;
    }
    return { counts: counts, exits: exits };
  });
}

/* ------------------------------------------------------------- sources */

/** Inbound by month for twelve months, by source: the Inbox's channels and the deals added straight to the pipeline. */
function sourcesOf(ctx) {
  const util = u();
  const app = ctx.app;
  const auth = L('lib_auth');
  const today = util.today(app);
  const first = util.addMonths(today.slice(0, 8) + '01', -11);
  const months = [];
  const pos = {};
  for (let i = 0; i < 12; i++) {
    const m = util.addMonths(first, i).slice(0, 7);
    pos[m] = i;
    months.push({ month: m, email: 0, upload: 0, scout: 0, sourced: 0, introduced: 0 });
  }
  const from = util.atOf(app, first, '00:00').replace('T', ' ');
  return H().cached(app, 'v:src:' + who(ctx) + ':' + today, ['intake_items', 'deals', 'deal_people', 'members'], () => {
    const add = (at, key) => {
      const d = util.dayOf(app, at);
      const i = pos[d.slice(0, 7)];
      if (i !== undefined) months[i][key]++;
    };
    if (auth.can(ctx, 'intake', 'view')) {
      let sql = "SELECT channel, received_at, created FROM intake_items WHERE status != 'merged' AND REPLACE(COALESCE(NULLIF(received_at, ''), created), 'T', ' ') >= {:a}";
      const bind = { a: from };
      if (ctx.ownOnly) {
        sql += ' AND submitted_by = {:m}';
        bind.m = ctx.memberId || '-';
      }
      for (const r of util.rows(app, sql, { channel: '', received_at: '', created: '' }, bind)) {
        const k = r.channel === 'upload' || r.channel === 'csv' ? 'upload' : r.channel === 'scout' ? 'scout' : r.channel === 'sourced' ? 'sourced' : 'email';
        add(r.received_at !== '' ? r.received_at : r.created, k);
      }
    }
    if (auth.can(ctx, 'pipeline', 'view')) {
      const D = L('lib_deals');
      const pl = D.pipelineOf(app, 'deal_flow');
      const vis = D.visibleSql(ctx, 'd');
      for (const r of util.rows(app, "SELECT d.source AS source, d.created AS created FROM deals d WHERE d.deleted_at = '' AND d.pipeline = {:pl} AND d.intake_item = '' AND REPLACE(d.created, 'T', ' ') >= {:a} AND " + vis.sql, { source: '', created: '' }, Object.assign({ pl: pl.id, a: from }, vis.bind))) {
        const k = r.source === 'scout' ? 'scout' : r.source === 'outbound' || r.source === 'sourced' ? 'sourced' : 'introduced';
        add(r.created, k);
      }
    }
    let total = 0;
    for (const m of months) for (const k of SOURCE_KEYS) total += m[k];
    return { keys: SOURCE_KEYS, months: months, total: total };
  });
}

/* ---------------------------------------------------------------- day */

/** Today's external meetings the caller attends (lib_network.upcoming), placed in minutes of the firm's day. */
function dayOf(ctx) {
  const util = u();
  const app = ctx.app;
  const day = util.today(app);
  const zone = util.zoneOf(app);
  const list = L('lib_network').upcoming(ctx, { from_at: util.atOf(app, day, '00:00'), to_at: util.atOf(app, util.dayAdd(day, 1), '00:00') });
  const minuteOf = (iso, fallback) => {
    const ms = Date.parse(String(iso || ''));
    if (!Number.isFinite(ms)) return fallback;
    const l = util.localAt(zone, ms);
    if (l.day < day) return 0;
    if (l.day > day) return 1440;
    return l.hour * 60 + l.minute;
  };
  const meetings = list.map((m) => {
    const start = minuteOf(m.start_at, 0);
    const end = Math.max(start + 15, minuteOf(m.end_at, start + 30));
    const ext = (m.attendees || []).filter((a) => a.external).map((a) => a.name || a.email);
    return {
      id: m.cal_event,
      title: m.title,
      company: m.company ? { id: m.company.id, name: m.company.name } : null,
      deal: m.deal ? { number: m.deal.number, stage_label: m.deal.stage_label } : null,
      start_at: m.start_at,
      end_at: m.end_at,
      start_min: start,
      end_min: Math.min(1440, end),
      attendees: ext.slice(0, 4),
      more: Math.max(0, ext.length - 4),
      brief: m.brief ? m.brief.state : null,
    };
  });
  return { day: day, zone: zone, meetings: meetings };
}

/* ---------------------------------------------------------------- all */

function guard(errors, block, empty, fn, timing) {
  const t0 = Date.now();
  try {
    const v = fn();
    timing[block] = Date.now() - t0;
    return v === undefined ? empty : v;
  } catch (err) {
    console.error('[vo] home visual ' + block + ' failed:', err);
    errors.push({ block: 'visual.' + block, error: String((err && err.message) || err) });
    return empty;
  }
}

/**
 * The visual blocks in one answer. `ref` is the sidebar's fund scope (id or name, '' for all);
 * `next` the kernel's Next list (top 6) and `funnel` the cohort funnel, both already read by home.summary.
 */
function visual(ctx, ref, next, errors, funnel) {
  const util = u();
  const app = ctx.app;
  const auth = L('lib_auth');
  const day = util.today(app);
  const base = baseCurrency(app);
  const timing = {};
  const hidden = [];
  const canFunds = auth.can(ctx, 'funds', 'view');
  const canPort = auth.can(ctx, 'portfolio', 'view');
  const canPipe = auth.can(ctx, 'pipeline', 'view');
  const canIntake = auth.can(ctx, 'intake', 'view');
  const canNet = auth.can(ctx, 'network', 'view');
  const scope = scopedFund(ctx, ref);
  const pset = L('lib_settings').module(app, 'portfolio') || {};
  const threshold = Number(pset.runway_months) > 0 ? Number(pset.runway_months) : 6;

  const funds = canFunds ? guard(errors, 'funds', null, () => fundsOf(ctx), timing) : null;
  const port = canPort ? guard(errors, 'portfolio', null, () => holdingsOf(ctx), timing) : null;
  const pipe = canPipe ? guard(errors, 'pipeline', null, () => pipelineOf(ctx), timing) : null;
  const passed = canPipe || canIntake ? guard(errors, 'passed', [], () => passedOf(ctx), timing) : [];
  if (!canFunds) hidden.push('funds');
  if (!canPort) hidden.push('portfolio');
  if (!canPipe) hidden.push('pipeline');

  // Readouts: the firm's NAV; TVPI, DPI, net IRR, committed, called and uncalled capital of the scoped fund (else of
  // all funds), with the fund's own NAV; portfolio companies in the scope; open deals; Next.
  const scoped = funds !== null && scope !== '' ? funds.funds.filter((f) => f.id === scope)[0] || null : null;
  const inScope = port === null ? null : scope === '' ? port.rows : port.rows.filter((r) => r.fund === scope);
  const companySet = {};
  if (inScope !== null) for (const r of inScope) companySet[r.company.id] = true;
  const readouts = {
    nav_minor: funds !== null ? funds.nav_minor : null,
    nav_reason: funds !== null ? funds.nav_reason : null,
    fund_nav_minor: scoped !== null ? scoped.nav_base_minor : null,
    tvpi_e8: funds === null ? null : scoped !== null ? scoped.tvpi_e8 : funds.firm.tvpi_e8,
    tvpi_reason: funds === null ? null : scoped !== null ? scoped.reasons.tvpi : funds.firm.reason,
    dpi_e8: funds === null ? null : scoped !== null ? scoped.dpi_e8 : funds.firm.dpi_e8,
    net_irr_ppm: funds === null ? null : scoped !== null ? (scoped.net_irr_ppm === undefined ? null : scoped.net_irr_ppm) : funds.firm.net_irr_ppm,
    tvpi_fund: scoped !== null ? { id: scoped.id, label: scoped.label } : null,
    committed_minor: funds === null ? null : scoped !== null ? scoped.committed_minor : funds.committed_minor,
    called_minor: funds === null ? null : scoped !== null ? scoped.called_minor : funds.called_minor,
    called_ppm: funds === null ? null : scoped !== null ? (scoped.called_ppm === undefined ? null : scoped.called_ppm) : funds.called_ppm,
    dry_powder_minor: funds === null ? null : scoped !== null ? scoped.unfunded_minor : funds.unfunded_minor,
    funds: funds !== null ? funds.funds.length : 0,
    companies: inScope !== null ? Object.keys(companySet).length : null,
    open_deals: pipe !== null ? pipe.deals.length : null,
    next_total: next !== null ? next.total : 0,
  };

  // The constellation: one orbit per fund (sized by the fund), a node per holding placed by the day it was
  // first invested; a node needs attention when its runway is under the threshold or it is marked below cost.
  let constellation = null;
  if (funds !== null || port !== null || pipe !== null) {
    const fundList = funds !== null ? funds.funds : [];
    const ringIds = {};
    for (const f of fundList) ringIds[f.id] = true;
    const nodes = [];
    if (port !== null)
      for (const r of port.rows) {
        const short = r.runway.months !== null && r.runway.months !== undefined && r.runway.months < threshold;
        const down = r.moic_e8 !== null && r.moic_e8 !== undefined && r.moic_e8 < 1e8;
        nodes.push({
          holding: r.holding,
          company: r.company,
          fund: r.fund,
          value_minor: r.value_base_minor !== null ? r.value_base_minor : r.value_minor,
          value_basis: r.value_basis,
          moic_e8: r.moic_e8,
          runway_months: r.runway.months,
          health: healthOf(r.runway.months, threshold),
          first_day: r.first_day || '',
          attention: short || down,
          reasons: (short ? ['runway'] : []).concat(down ? ['marked_down'] : []),
        });
        if (!ringIds[r.fund] && r.fund !== '') ringIds[r.fund] = true;
      }
    const rings = fundList.map((f) => ({ id: f.id, label: f.label, vintage: f.vintage, scoped: f.id === scope, size_minor: f.size_minor, start_day: f.start_day, nav_minor: f.nav_base_minor, tvpi_e8: f.tvpi_e8, dpi_e8: f.dpi_e8, net_irr_ppm: f.net_irr_ppm, committed_minor: f.committed_minor, called_minor: f.called_minor, unfunded_minor: f.unfunded_minor }));
    // Holdings of a fund the caller cannot read figures for still get their ring (no label figures).
    for (const id of Object.keys(ringIds)) if (!rings.some((x) => x.id === id)) rings.push({ id: id, label: '', vintage: 0, scoped: id === scope, size_minor: null, start_day: '', nav_minor: null, tvpi_e8: null, dpi_e8: null, net_irr_ppm: null, committed_minor: null, called_minor: null, unfunded_minor: null });
    constellation = {
      rings: rings,
      nodes: nodes,
      stages: pipe !== null ? pipe.stages : [],
      deals: pipe !== null ? pipe.deals.map((d) => ({ id: d.id, number: d.number, name: d.name, stage: d.stage, stage_index: d.stage_index })) : [],
      passed: passed,
      threshold_months: threshold,
    };
  }

  // The pipeline flow of this quarter's cohort (deals' funnel bars, where each member stopped).
  let flow = null;
  if (canPipe) {
    const fn = funnel !== undefined && funnel !== null ? funnel : guard(errors, 'flow_funnel', null, () => H().funnel(ctx), timing);
    const fx = fn === null ? null : guard(errors, 'flow', null, () => flowOf(ctx), timing);
    if (fn !== null)
      flow = {
        quarter: fn.quarter,
        columns: fn.stages.map((s) => ({ key: s.key, label: s.label, count: s.count, conversion_ppm: s.conversion_ppm, now: s.now })),
        exits: fx !== null ? fx.exits : [],
        counts: fx !== null ? fx.counts : [],
        cohort: fn.cohort,
      };
  } else hidden.push('flow');

  const sources = canIntake || canPipe ? guard(errors, 'sources', null, () => sourcesOf(ctx), timing) : null;
  if (!canIntake && !canPipe) hidden.push('sources');
  const today = canNet ? guard(errors, 'day', { day: day, zone: util.zoneOf(app), meetings: [] }, () => dayOf(ctx), timing) : null;
  if (!canNet) hidden.push('day');

  // Portfolio blocks in the fund scope: treemap, runway strip, growth, invested by sector.
  let portfolio = null;
  if (port !== null) {
    const rows = scope === '' ? port.rows : port.rows.filter((r) => r.fund === scope);
    const cos = byCompany(app, rows, day);
    const tree = cos.filter((c) => c.value_minor !== null && c.value_minor > 0).sort((a, b) => b.value_minor - a.value_minor);
    const runway = cos
      .map((c) => ({ company: c.company, months: c.runway.months, state: c.runway.state, as_of_day: c.runway.as_of_day, health: healthOf(c.runway.months, threshold) }))
      .sort((a, b) => (a.months === null ? 1 : 0) - (b.months === null ? 1 : 0) || (a.months || 0) - (b.months || 0) || (a.company.name < b.company.name ? -1 : 1));
    const growth = cos
      .filter((c) => c.kpi !== null && c.kpi.points.filter((x) => x.value !== null).length >= 2)
      .sort((a, b) => (b.value_minor || 0) - (a.value_minor || 0))
      .slice(0, GROWTH_TOP)
      .map((c) => {
        const g = growthOf(c.kpi.points);
        return { company: c.company, key: c.kpi.key, label: c.kpi.label, currency: c.kpi.currency, points: c.kpi.points, growth_ppm: g.growth_ppm, months: g.months };
      });
    const sec = {};
    for (const c of cos) {
      if (sec[c.sector] === undefined) sec[c.sector] = { sector: c.sector, value_minor: 0, companies: 0 };
      sec[c.sector].value_minor += c.cost_minor || 0;
      sec[c.sector].companies++;
    }
    portfolio = {
      currency: base,
      treemap: tree.map((c) => ({ company: c.company, value_minor: c.value_minor, cost_minor: c.cost_minor, moic_e8: c.moic_e8, holdings: c.holdings })),
      runway: { rows: runway, threshold_months: threshold },
      growth: growth,
      invested: Object.keys(sec)
        .map((k) => sec[k])
        .sort((a, b) => b.value_minor - a.value_minor),
      companies: cos.length,
      hidden: port.hidden,
    };
  }

  let pipelineSectors = null;
  if (pipe !== null) {
    const s = {};
    for (const d of pipe.deals) s[d.sector] = (s[d.sector] || 0) + 1;
    pipelineSectors = Object.keys(s)
      .map((k) => ({ sector: k, deals: s[k] }))
      .sort((a, b) => b.deals - a.deals || (a.sector < b.sector ? -1 : 1));
  }

  const performance = canFunds ? guard(errors, 'performance', null, () => performanceOf(ctx, ref), timing) : null;

  return {
    currency: base,
    readouts: readouts,
    constellation: constellation,
    flow: flow,
    sources: sources,
    day: today,
    portfolio: portfolio,
    pipeline_sectors: pipelineSectors,
    performance: performance,
    next_items: next !== null ? next.items : [],
    hidden: hidden,
    timing: timing,
  };
}

module.exports = {
  visual: visual,
  fundsOf: fundsOf,
  performanceOf: performanceOf,
  holdingsOf: holdingsOf,
  pipelineOf: pipelineOf,
  passedOf: passedOf,
  flowOf: flowOf,
  sourcesOf: sourcesOf,
  dayOf: dayOf,
  healthOf: healthOf,
  growthOf: growthOf,
};
