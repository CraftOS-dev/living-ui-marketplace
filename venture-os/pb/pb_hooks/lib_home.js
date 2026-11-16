/// <reference path="../pb_data/types.d.ts" />
/**
 * Home (SPEC 3.1, 7.13): the one read behind the Home page, the firm block
 * of app.today and the optional morning digest.
 *
 *   summary(ctx, p)  home.summary: Next top 5 and count, today's meetings
 *                    (network), inbound per week for 12 weeks (intake; back to
 *                    the quarter's first week when it began earlier, each week
 *                    split into this quarter and before), the cohort funnel of
 *                    this quarter (deals: Inbound, then the stages), the scoped fund's
 *                    TVPI, DPI, Net IRR and its quarterly J-curve (funds), the
 *                    three shortest runways (portfolio), and `visual`: every
 *                    figure the Home dashboard draws (lib_home_visual).
 *   today(ctx)       app.today block { key: 'home', ... } in plain words.
 *   digestFor(app, member) / digestTick(app)   the morning digest.
 *
 * Every block reads another module's contract (SPEC 4.6) and degrades to its
 * empty state: a block that fails is reported in `errors` and answers its
 * empty value, never a 5xx. A block the caller may not see is named in
 * `hidden` (never read as empty). Numbers come from the modules' engines;
 * Home formats nothing it shows as a figure except plain counts.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}

const WEEKS = 12;
const DAY_MS = 86400000;

/* ---------------------------------------------------------------- blocks */

/** Run one block: its value, or `empty` with the error noted. */
function guard(errors, block, empty, fn, timing) {
  const t0 = Date.now();
  try {
    const v = fn();
    if (timing) timing[block] = Date.now() - t0;
    return v === undefined ? empty : v;
  } catch (err) {
    console.error('[vo] home ' + block + ' failed:', err);
    errors.push({ block: block, error: String((err && err.message) || err) });
    return empty;
  }
}

/**
 * A block's answer kept in the app store (shared by every runtime) until
 * the rows it reads change: the fingerprint is the row count and the last
 * update of each table, so a save, an import or a deletion anywhere in them
 * builds it again. Keys carry the firm's day (figures are as of today).
 */
function fingerprint(app, tables) {
  const util = u();
  return tables
    .map((t) => {
      const r = util.one(app, "SELECT COUNT(*) AS n, COALESCE(MAX(updated), '') AS m FROM " + t, { n: 0, m: '' });
      return t + ':' + (r ? r.n + ':' + r.m : '-');
    })
    .join('|');
}

function cached(app, key, tables, build) {
  const fp = fingerprint(app, tables);
  const k = 'vo_home:' + key;
  if (!app.isTransactional()) {
    const raw = app.store().get(k);
    if (typeof raw === 'string' && raw !== '') {
      try {
        const c = JSON.parse(raw);
        if (c.f === fp) return c.v;
      } catch {
        /* build again */
      }
    }
  }
  const v = build();
  if (!app.isTransactional()) app.store().set(k, JSON.stringify({ f: fp, v: v }));
  return v;
}

/** The person's first name (the greeting). */
function firstName(ctx) {
  const n = u().squash(String(ctx.name || ''));
  if (n === '' || ctx.isAgent) return '';
  return n.split(' ')[0];
}

/** The start of the week holding `day` (settings.week_start, default Monday). */
function weekStart(day, ws) {
  const wd = u().weekday(day);
  const back = (wd - ws + 7) % 7;
  return u().dayAdd(day, -back);
}

/**
 * Inbound per week, 12 weeks ending this week (intake items by the day they came in, firm zone), each
 * week split into the items of this quarter and the ones before. When the quarter began before the 12
 * weeks, the chart starts at the quarter's first week, so the quarter's weeks always add up to the
 * funnel's Inbound bar (deals counts the same items: received in the quarter, not merged).
 */
function inbound(ctx) {
  const util = u();
  const app = ctx.app;
  const s = L('lib_settings').row(app);
  const ws = s.getInt('week_start');
  const today = util.today(app);
  const q = L('lib_deals_funnel').quarterOf(today);
  let first = util.dayAdd(weekStart(today, ws), -7 * (WEEKS - 1));
  const qFirst = weekStart(q.start_day, ws);
  if (qFirst < first) first = qFirst;
  const n = Math.floor(util.daysBetween(first, weekStart(today, ws)) / 7) + 1;
  const fromAt = util.atOf(app, first, '00:00');
  let sql = "SELECT received_at, created FROM intake_items WHERE status != 'merged' AND ((received_at != '' AND received_at >= {:a}) OR (received_at = '' AND created >= {:a}))";
  const bind = { a: fromAt };
  if (ctx.ownOnly) {
    sql += ' AND submitted_by = {:m}';
    bind.m = ctx.memberId || '-';
  }
  const weeks = [];
  for (let i = 0; i < n; i++) weeks.push({ start_day: util.dayAdd(first, 7 * i), count: 0, quarter: 0 });
  let inQuarter = 0;
  for (const r of util.rows(app, sql, { received_at: '', created: '' }, bind)) {
    const at = r.received_at !== '' ? r.received_at : r.created;
    const d = util.dayOf(app, at);
    if (d === '' || d < first) continue;
    const i = Math.floor(util.daysBetween(first, d) / 7);
    if (i < 0 || i >= n) continue;
    weeks[i].count++;
    if (d >= q.start_day && d < q.end_day) {
      weeks[i].quarter++;
      inQuarter++;
    }
  }
  let total = 0;
  for (const w of weeks) total += w.count;
  return { weeks: weeks, total: total, this_week: weeks[n - 1].count, last_week: weeks[n - 2].count, quarter: { key: q.key, start_day: q.start_day, count: inQuarter } };
}

/**
 * The deal flow funnel of this quarter, exactly as deals answers it (lib_deals_flow.funnel: the cohort
 * of intake items received in the quarter as the first bar Inbound, then how many of them reached each
 * stage; each conversion is a bar over the bar before). Kept per person (deal visibility differs) until
 * intake items, deals, their stage events, teams or members change.
 */
function funnel(ctx) {
  const who = ctx.isAgent ? 'agent' : ctx.memberId || 'system';
  return cached(ctx.app, 'funnel:' + who + ':' + u().today(ctx.app), ['intake_items', 'deals', 'stage_events', 'deal_people', 'members', 'pipelines'], () => funnelOf(ctx));
}

function funnelOf(ctx) {
  const f = L('lib_deals_flow').funnel(ctx, { pipeline: 'deal_flow', quarter: '' });
  return {
    quarter: f.quarter,
    stages: f.stages.map((s) => ({ key: s.key, label: s.label, count: s.count, now: s.now, conversion_ppm: s.conversion_ppm === undefined ? null : s.conversion_ppm })),
    cohort: f.cohort,
    open: f.open,
    hidden: f.hidden,
  };
}

const CALL_TYPES = "('call_investment', 'call_fees', 'call_expenses', 'call_other', 'opening_contributed')";

/**
 * The fund the Funds block shows: the one asked for (when ctx may see it),
 * else the first of the member's fund scope, else the fund with the most
 * capital called (where most of the LPs' money is at work), else the newest
 * fund. null when there is none.
 */
function pickFund(ctx, ref) {
  const util = u();
  const all = L('lib_funds')
    .visibleFunds(ctx)
    .filter((f) => f.archived !== true);
  if (all.length === 0) return null;
  if (ref !== '') {
    const hit = all.filter((f) => f.id === ref || f.name === ref || f.short_name === ref)[0];
    if (hit !== undefined) return hit;
  }
  const funds = all.filter((f) => f.kind === 'fund');
  const pool = funds.length > 0 ? funds : all;
  if (ctx.funds && ctx.funds.length > 0) {
    const mine = pool.filter((f) => ctx.funds.indexOf(f.id) >= 0)[0];
    if (mine !== undefined) return mine;
  }
  const called = {};
  for (const r of util.rows(ctx.app, 'SELECT fund, COALESCE(SUM(ABS(amount_minor)), 0) AS n FROM ledger WHERE type IN ' + CALL_TYPES + ' GROUP BY fund', { fund: '', n: 0 })) called[r.fund] = r.n;
  const sorted = pool.slice().sort((a, b) => (called[b.id] || 0) - (called[a.id] || 0) || (b.vintage || 0) - (a.vintage || 0));
  return sorted[0];
}

/**
 * The fund block: metrics (engine) and the J-curve by quarter: the LPs' net
 * cash flow to date (distributions less calls) and the net value (that plus
 * NAV), which dips with fees and early marks and rises as value is created.
 */
function fundBlock(ctx, ref) {
  const app = ctx.app;
  const v = pickFund(ctx, ref);
  if (v === null) return null;
  const day = u().today(app);
  return cached(app, 'fund:' + v.id + ':' + day, ['ledger', 'marks', 'holdings', 'entities', 'capital_events'], () => fundFigures(app, v.id, day));
}

function fundFigures(app, fundId, day) {
  const F = L('lib_funds');
  const f = app.findRecordById('entities', fundId);
  const b = F.books(app, f, day);
  const m = F.metricsOf(b, day).metrics;
  let net = 0;
  const curve = F.jcurve(b, day).map((q) => {
    net += Number(q.calls_minor || 0) + Number(q.dist_minor || 0);
    const nav = q.nav_minor === undefined || q.nav_minor === null ? null : Number(q.nav_minor);
    return { quarter: q.quarter, end: q.end, net_minor: net, nav_minor: nav, value_minor: nav === null ? null : net + nav };
  });
  return {
    id: f.id,
    name: f.getString('name'),
    label: f.getString('short_name') || f.getString('name'),
    currency: m.currency || f.getString('currency'),
    as_of_day: day,
    tvpi_e8: m.tvpi_e8,
    dpi_e8: m.dpi_e8,
    rvpi_e8: m.rvpi_e8,
    net_irr_ppm: m.net_irr_ppm,
    paid_in_minor: m.paid_in_minor,
    reasons: { tvpi: m.reasons ? m.reasons.tvpi : null, dpi: m.reasons ? m.reasons.dpi : null, net_irr: m.reasons ? m.reasons.net_irr : null },
    curve: curve,
  };
}

/** The three shortest known runways among the active holdings ctx may see (in the fund scope when given). */
function runways(ctx, ref) {
  const util = u();
  const app = ctx.app;
  const P = L('lib_portfolio');
  const s = L('lib_settings').module(app, 'portfolio') || {};
  const threshold = Number(s.runway_months) > 0 ? Number(s.runway_months) : 6;
  let fundId = '';
  if (ref !== '') {
    const fv = L('lib_funds')
      .visibleFunds(ctx)
      .filter((f) => f.id === ref || f.name === ref || f.short_name === ref)[0];
    fundId = fv === undefined ? '-' : fv.id;
  }
  const seen = {};
  const companies = [];
  let hidden = 0;
  for (const h of util.findMany(app, 'holdings', "status = 'active' && deleted_at = ''", 'created', 0)) {
    if (fundId !== '' && h.getString('fund') !== fundId) continue;
    if (!P.visible(ctx, h)) {
      hidden++;
      continue;
    }
    const c = h.getString('company');
    if (c === '' || seen[c]) continue;
    seen[c] = true;
    companies.push(c);
  }
  companies.sort();
  const key = 'runways:' + util.today(app) + ':' + $security.sha256(companies.join(','));
  const r = cached(app, key, ['kpi_values', 'holdings', 'fx_rates', 'companies'], () => shortest(app, companies));
  return { rows: r.rows, companies: companies.length, unknown: r.unknown, threshold_months: threshold, hidden: hidden };
}

/** Runway of each company (portfolio's engine contract), the three shortest known first. */
function shortest(app, companies) {
  const P = L('lib_portfolio');
  const known = [];
  let unknown = 0;
  for (const c of companies) {
    const r = P.runway(app, c);
    if (r.state === 'known' && r.months !== null) {
      const mini = L('lib_records').mini(app, 'companies', c);
      known.push({ company: { id: c, name: mini ? mini.name : '' }, months: r.months, as_of_day: r.as_of_day, zero_day: r.zero_day });
    } else if (r.state === 'unknown') unknown++;
  }
  known.sort((a, b) => a.months - b.months || (a.company.name < b.company.name ? -1 : 1));
  return { rows: known.slice(0, 3), unknown: unknown };
}

/** Next: the top 6 and the count (kernel aggregator, snoozes applied); the summary's block keeps the top 5. */
function nextTop(ctx) {
  const l = L('lib_next').list(ctx, { limit: 6 });
  return { items: l.items, total: l.total, counts: l.counts };
}

/** Today's external meetings (network's contract, as its app.today block shapes them). */
function meetings(ctx) {
  return L('lib_network').today(ctx).meetings;
}

/* ---------------------------------------------------------------- summary */

/**
 * home.summary: the whole Home page in one read. `opts.visual === false` leaves the dashboard's
 * figures out (app.today reads the summary in words only).
 */
function summary(ctx, p, opts) {
  const util = u();
  const auth = L('lib_auth');
  const started = Date.now();
  const ref = util.str(p || {}, 'fund', '');
  const errors = [];
  const hidden = [];
  const timing = {};
  const out = { today: util.today(ctx.app), first_name: firstName(ctx), next: null, meetings: [], inbound: null, funnel: null, fund: null, runways: null, visual: null, hidden: hidden, errors: errors, timing: timing };
  const next6 = guard(errors, 'next', { items: [], total: 0, counts: {} }, () => nextTop(ctx), timing);
  out.next = { items: next6.items.slice(0, 5), total: next6.total, counts: next6.counts };
  if (auth.can(ctx, 'network', 'view')) out.meetings = guard(errors, 'meetings', [], () => meetings(ctx), timing);
  else hidden.push('meetings');
  if (auth.can(ctx, 'intake', 'view')) out.inbound = guard(errors, 'inbound', null, () => inbound(ctx), timing);
  else hidden.push('inbound');
  if (auth.can(ctx, 'pipeline', 'view')) out.funnel = guard(errors, 'funnel', null, () => funnel(ctx), timing);
  else hidden.push('funnel');
  if (auth.can(ctx, 'funds', 'view')) out.fund = guard(errors, 'fund', null, () => fundBlock(ctx, ref), timing);
  else hidden.push('fund');
  if (auth.can(ctx, 'portfolio', 'view')) out.runways = guard(errors, 'runways', null, () => runways(ctx, ref), timing);
  else hidden.push('runways');
  if (!(opts && opts.visual === false)) {
    const t0 = Date.now();
    out.visual = guard(errors, 'visual', null, () => L('lib_home_visual').visual(ctx, ref, next6, errors, out.funnel), timing);
    timing.visual = Date.now() - t0;
  }
  out.ms = Date.now() - started;
  return out;
}

/* ------------------------------------------------------------ app.today */

function multipleText(e8) {
  if (e8 === null || e8 === undefined) return null;
  return (Number(e8) / 1e8).toFixed(2) + 'x';
}

function pctText(ppm) {
  if (ppm === null || ppm === undefined) return null;
  return (Number(ppm) / 10000).toFixed(1) + '%';
}

/** app.today: the firm's picture in plain words (meetings, Next and votes come from the kernel and the modules' own blocks). */
function today(ctx) {
  const s = summary(ctx, {}, { visual: false });
  const out = { key: 'home', hidden: s.hidden };
  if (s.inbound !== null) {
    const last12 = s.inbound.weeks.slice(-WEEKS);
    out.inbound = { this_week: s.inbound.this_week, last_week: s.inbound.last_week, weeks: last12.map((w) => w.count), total_12_weeks: last12.reduce((a, w) => a + w.count, 0), this_quarter: s.inbound.quarter.count };
  }
  if (s.funnel !== null)
    out.funnel = {
      quarter: s.funnel.quarter ? s.funnel.quarter.key : '',
      stages: s.funnel.stages.map((x) => ({ stage: x.label, reached: x.count, now: x.now, conversion: x.conversion_ppm === null ? null : pctText(x.conversion_ppm) })),
    };
  if (s.fund !== null)
    out.fund = {
      name: s.fund.name,
      tvpi: multipleText(s.fund.tvpi_e8) || 'unknown: ' + (s.fund.reasons.tvpi || 'no data'),
      dpi: multipleText(s.fund.dpi_e8) || 'unknown: ' + (s.fund.reasons.dpi || 'no data'),
      net_irr: pctText(s.fund.net_irr_ppm) || 'unknown: ' + (s.fund.reasons.net_irr || 'no data'),
    };
  if (s.runways !== null) out.runway_shortest = s.runways.rows.map((r) => ({ company: r.company.name, months: r.months, as_of_day: r.as_of_day }));
  if (s.errors.length > 0) out.errors = s.errors;
  return out;
}

/* ---------------------------------------------------------------- digest */

/** The member's digest settings: { on, link, zone, time }. */
function digestPrefs(app, m) {
  const util = u();
  const prefs = util.jsonOf(m, 'prefs', {}) || {};
  const set = L('lib_settings').module(app, 'home') || {};
  const zoneRaw = m.getString('zone');
  return {
    on: prefs.digest === true,
    link: typeof prefs.digest_link === 'string' ? prefs.digest_link : '',
    zone: util.isZone(zoneRaw) ? zoneRaw : util.zoneOf(app),
    time: util.isTime(set.digest_time) ? set.digest_time : '07:00',
  };
}

/** The address a line links to: the app's own page when the member's link is known, else the page's name. */
function linkOf(base, href) {
  if (href === '' || href === undefined || href === null) return '';
  if (base === '') return '';
  const b = base.charAt(base.length - 1) === '/' ? base : base + '/';
  return b + (href.charAt(0) === '#' ? href : '#' + href);
}

const DIGEST_KINDS = { stall: 'Past due', vote: 'Vote due', decision: 'Decision due', alert: 'Alert' };

/**
 * One member's digest for their local day: the day's meetings, items past
 * their SLA (stall), votes and decisions due, alerts. One line per item.
 * { day, zone, lines: [{ kind, text, href, link }], subject, body, empty }
 */
function digestFor(app, member) {
  const util = u();
  const auth = L('lib_auth');
  const ctx = auth.contextFor(app, member);
  const pr = digestPrefs(app, member);
  const local = util.localAt(pr.zone, Date.now());
  const lines = [];
  if (auth.can(ctx, 'network', 'view')) {
    const from = new Date(util.utcOf(pr.zone, local.day, '00:00')).toISOString();
    const to = new Date(util.utcOf(pr.zone, util.dayAdd(local.day, 1), '00:00')).toISOString();
    for (const mt of L('lib_network').upcoming(ctx, { from_at: from, to_at: to })) {
      const t = util.localAt(pr.zone, Date.parse(mt.start_at)).time;
      const href = mt.deal && mt.deal.number ? '#/deals/' + mt.deal.number : mt.company ? '#/companies/' + mt.company.id : '';
      lines.push({ kind: 'meeting', text: t + '  ' + (mt.title !== '' ? mt.title : mt.company ? mt.company.name : 'Meeting'), href: href });
    }
  }
  const next = L('lib_next').collect(ctx, []).items;
  for (const it of next) {
    const label = DIGEST_KINDS[it.kind];
    if (label === undefined) continue;
    const fig = it.kind !== 'alert' && it.figures && it.figures.length > 0 ? ' (' + it.figures[0].label + ' ' + it.figures[0].value + ')' : '';
    lines.push({ kind: it.kind, text: label + ': ' + it.title + fig, href: it.href || '' });
  }
  const total = next.length;
  for (const l of lines) l.link = linkOf(pr.link, l.href);
  const meetingsN = lines.filter((l) => l.kind === 'meeting').length;
  const subject = 'Your day at ' + (L('lib_settings').row(app).getString('firm_name') || 'Venture OS') + ': ' + meetingsN + ' meeting' + (meetingsN === 1 ? '' : 's') + ', ' + total + ' in Next';
  const body = [];
  body.push('Good morning' + (firstName(ctx) !== '' ? ', ' + firstName(ctx) : '') + '.');
  body.push('');
  const groups = [
    ['meeting', 'Meetings'],
    ['stall', 'Past due'],
    ['vote', 'Votes due'],
    ['decision', 'Decisions due'],
    ['alert', 'Alerts'],
  ];
  for (const [k, title] of groups) {
    const ls = lines.filter((l) => l.kind === k);
    if (ls.length === 0) continue;
    body.push(title);
    for (const l of ls) body.push('- ' + (k === 'meeting' ? l.text : l.text.slice(l.text.indexOf(': ') + 2)) + (l.link !== '' ? '  ' + l.link : ''));
    body.push('');
  }
  body.push(total + ' item' + (total === 1 ? '' : 's') + ' wait in Next.' + (pr.link !== '' ? ' ' + linkOf(pr.link, '#/focus') : ''));
  body.push('');
  body.push('You turned this digest on in Venture OS (Settings, Digest).');
  return { day: local.day, zone: pr.zone, time: pr.time, on: pr.on, lines: lines, next_total: total, subject: subject, body: body.join('\n'), empty: lines.length === 0 };
}

/** The module where this member may draft messages (outbound needs edit on a module). '' when none. */
function draftModule(ctx) {
  const auth = L('lib_auth');
  for (const m of ['pipeline', 'intake', 'portfolio', 'committee', 'network', 'diligence', 'funds', 'markets', 'lps', 'settings']) if (auth.can(ctx, m, 'edit')) return m;
  return '';
}

/** The member's digest sent on this local day already? (outbound kind digest for the member). */
function sentOn(app, member, zone, day) {
  const util = u();
  const from = new Date(util.utcOf(zone, day, '00:00')).toISOString().replace('T', ' ');
  return util.count(app, "SELECT COUNT(*) AS n FROM outbound WHERE kind = 'digest' AND ref_collection = 'members' AND ref_id = {:m} AND created >= {:f} AND status IN ('approved', 'sending', 'sent')", { m: member.id, f: from }) > 0;
}

/**
 * Draft the member's digest as a kernel outbound message (kind digest, to
 * their own address, approver themselves) and approve it as them: they
 * turned the digest on, which is their standing approval. Sends at once
 * outside a transaction. Answers the outbound view, or null when there is
 * nothing to say.
 */
function sendDigest(app, member, opts) {
  const auth = L('lib_auth');
  const ctx = auth.contextFor(app, member);
  const d = digestFor(app, member);
  if (d.empty && !(opts && opts.always)) return null;
  const module = draftModule(ctx);
  if (module === '') throw u().fail(409, 'Your role cannot send messages, so the digest cannot go out.', 'not_permitted');
  const O = L('lib_outbound');
  const draft = O.draft(ctx, { kind: 'digest', module: module, to: [member.getString('email')], subject: d.subject, body: d.body, ref_collection: 'members', ref_id: member.id, approver: member.id });
  return O.approve(ctx, { outbound: draft.id });
}

/** Cron (every 15 minutes): each member who turned the digest on gets it once on their local morning. */
function digestTick(app) {
  const util = u();
  if (!L('lib_mail').bridgeUp()) return 0;
  let sent = 0;
  for (const m of util.findMany(app, 'members', "status = 'active'", 'created', 500)) {
    const pr = digestPrefs(app, m);
    if (!pr.on || m.getString('email') === '') continue;
    const local = util.localAt(pr.zone, Date.now());
    if (local.time < pr.time || local.hour >= 12) continue;
    if (sentOn(app, m, pr.zone, local.day)) continue;
    try {
      if (sendDigest(app, m, {}) !== null) sent++;
    } catch (err) {
      console.error('[vo] digest for ' + m.id + ' failed:', err);
    }
  }
  return sent;
}

/** home.digest: my digest settings and what today's digest says (a preview; nothing is sent). */
function opDigest(ctx) {
  const util = u();
  if (!ctx.memberId) throw util.fail(400, 'Only a signed-in person has a digest.', 'invalid');
  const m = ctx.app.findRecordById('members', ctx.memberId);
  const d = digestFor(ctx.app, m);
  return { on: d.on, time: d.time, zone: d.zone, day: d.day, can_send: draftModule(ctx) !== '', bridge: L('lib_mail').bridgeUp(), subject: d.subject, lines: d.lines, body: d.body, next_total: d.next_total };
}

/** home.digest-send: send my digest now (a test; also when the day is empty). */
function opDigestSend(ctx) {
  const util = u();
  if (!ctx.memberId) throw util.fail(400, 'Only a signed-in person has a digest.', 'invalid');
  const m = ctx.app.findRecordById('members', ctx.memberId);
  const out = sendDigest(ctx.app, m, { always: true });
  return { message: out };
}

module.exports = {
  WEEKS: WEEKS,
  DAY_MS: DAY_MS,
  cached: cached,
  fingerprint: fingerprint,
  summary: summary,
  today: today,
  inbound: inbound,
  funnel: funnel,
  pickFund: pickFund,
  fundBlock: fundBlock,
  runways: runways,
  digestFor: digestFor,
  sendDigest: sendDigest,
  digestTick: digestTick,
  opDigest: opDigest,
  opDigestSend: opDigestSend,
};
