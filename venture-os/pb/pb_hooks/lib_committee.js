/// <reference path="../pb_data/types.d.ts" />
/**
 * Committee core: settings (scale, voters, cooling-off, rule per fund),
 * who may vote on an agenda item, the record views every committee op
 * answers with, the cross-module contract decisionOf, Next items, events,
 * search, timeline, today and cron.
 *
 * Blind votes: no view in this module ever returns a vote's choice,
 * rationale or veto before the facilitator revealed the item. Views give
 * counts and, per member, only whether they voted. The sealed ballot is
 * opened in exactly one place: votes.reveal (lib_committee_votes.reveal).
 *
 *   decisionOf(app, dealId) -> latest decision view (with conditions_open) | null
 *   addItem(ctx, { meeting?, deal?, company?, kind?, title?, champion?, source? }) -> agenda item view
 *       (other modules may call it, e.g. portfolio asks for the agenda)
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}
function RU() {
  return L('lib_committee_rules');
}

const LOCKED_SECTIONS = ['thesis', 'recommendation'];
const KINDS = ['new_investment', 'follow_on', 'portfolio', 'other'];
const KIND_LABEL = { new_investment: 'New investment', follow_on: 'Follow-on', portfolio: 'Portfolio', other: 'Other' };
const OUTCOME_LABEL = { invest: 'Invest', pass: 'Pass', more_diligence: 'More diligence', hold: 'Hold' };
const RULE_LABEL = { consensus: 'Consensus', champion: 'Champion', majority: 'Majority' };
const PASS_REASONS = ['team', 'market', 'product', 'traction', 'valuation', 'fit', 'timing', 'other'];
const REASON_LABEL = { team: 'Team', market: 'Market', product: 'Product', traction: 'Traction', valuation: 'Valuation', fit: 'Fit with thesis', timing: 'Timing', other: 'Other' };
const DEFAULTS = {
  scale: 'no_three',
  voter_roles: [],
  seniority: ['scout', 'analyst', 'platform', 'finance', 'principal', 'venture_partner', 'partner', 'owner'],
  cooling_hours: 24,
  rule: 'consensus',
  meeting_weekday: 1,
  meeting_time: '10:00',
  auto_meeting: true,
  condition_days: 14,
};

/* ----------------------------------------------------------- settings */

/** The committee settings (settings.modules.committee over the defaults). */
function settings(app) {
  const s = L('lib_settings').module(app, 'committee') || {};
  return Object.assign({}, DEFAULTS, s);
}

/** A fund's own committee settings (entities.settings.committee), {} when none. */
function fundSettings(app, fundId) {
  if (!fundId) return {};
  const f = u().byId(app, 'entities', fundId);
  if (f === null) return {};
  const s = u().jsonOf(f, 'settings', {}) || {};
  return s.committee && typeof s.committee === 'object' ? s.committee : {};
}

function scaleKey(app, fundId) {
  const f = fundSettings(app, fundId);
  const k = typeof f.scale === 'string' && RU().SCALES[f.scale] !== undefined ? f.scale : settings(app).scale;
  return RU().SCALES[k] !== undefined ? k : 'no_three';
}

function ruleOf(app, fundId) {
  const f = fundSettings(app, fundId);
  const r = typeof f.rule === 'string' && RU().RULES.indexOf(f.rule) >= 0 ? f.rule : settings(app).rule;
  return RU().RULES.indexOf(r) >= 0 ? r : 'consensus';
}

/** Role codes that vote on a fund's items: the fund's list, else the firm's list, else every role marked votes. */
function voterRoles(app, fundId) {
  const f = fundSettings(app, fundId);
  if (Array.isArray(f.voter_roles) && f.voter_roles.length > 0) return f.voter_roles.map(String);
  const s = settings(app);
  if (Array.isArray(s.voter_roles) && s.voter_roles.length > 0) return s.voter_roles.map(String);
  return u()
    .rows(app, 'SELECT code FROM roles WHERE votes = TRUE', { code: '' })
    .map((r) => r.code);
}

function seniorityOf(app, roleCode) {
  const list = settings(app).seniority || DEFAULTS.seniority;
  const i = list.indexOf(roleCode);
  return i < 0 ? 0 : i + 1;
}

/* ------------------------------------------------------------- helpers */

function mini(app, collection, id) {
  return L('lib_records').mini(app, collection, id);
}

function memberName(app, id) {
  const m = mini(app, 'members', id);
  return m ? m.name : '';
}

/** Compact money for cards: USD 3M, EUR 750K. */
function money(minor, currency) {
  if (minor === null || minor === undefined || !currency) return '';
  const e = L('lib_money').exponent(currency);
  const major = Number(minor) / Math.pow(10, e);
  const fmt = (x, s) => {
    const r = Math.round(x * 10) / 10;
    return currency + ' ' + (r === Math.round(r) ? String(Math.round(r)) : String(r)) + s;
  };
  if (Math.abs(major) >= 1e9) return fmt(major / 1e9, 'B');
  if (Math.abs(major) >= 1e6) return fmt(major / 1e6, 'M');
  if (Math.abs(major) >= 1e3) return fmt(major / 1e3, 'K');
  return currency + ' ' + String(Math.round(major));
}

function ms(at) {
  const t = Date.parse(String(at || '').replace(' ', 'T'));
  return Number.isFinite(t) ? t : NaN;
}

/** The deal of a record field, as a small view ({ id, number, title, stage, round, currency, check_minor, point }). */
function dealMini(app, dealId) {
  if (!dealId) return null;
  const d = u().byId(app, 'deals', dealId);
  if (d === null) return null;
  const c = L('lib_deals').cardOut(app, d);
  return { id: d.id, number: c.number, title: c.title, stage: c.stage, stage_label: c.stage_label, status: c.status, round_type: c.round_type, raise_minor: c.raise_minor, currency: c.currency, check_minor: c.check_minor, point: c.point, restricted: c.restricted, company: c.company };
}

function canSeeDeal(ctx, dealId) {
  if (!dealId) return true;
  return L('lib_deals').visible(ctx, dealId);
}

function needDeal(ctx, ref) {
  const D = L('lib_deals');
  const d = D.ref(ctx.app, ref);
  D.guard(ctx, d);
  return d;
}

/** Facilitator rights on a meeting: its facilitator, or committee:full (the owner). */
function isFacilitator(ctx, meeting) {
  if (ctx.isAgent) return false;
  const f = meeting.getString('facilitator');
  if (f !== '' && f === ctx.memberId) return true;
  if (f === '' && L('lib_auth').can(ctx, 'committee', 'edit')) return true;
  return L('lib_auth').can(ctx, 'committee', 'full');
}

function needFacilitator(ctx, meeting, what) {
  if (isFacilitator(ctx, meeting)) return;
  throw u().fail(403, 'Only the facilitator of ' + meeting.getString('number') + ' (' + (memberName(ctx.app, meeting.getString('facilitator')) || 'not set') + ') can ' + what + '.', 'not_facilitator');
}

/* ---------------------------------------------------------- eligibility */

function memberCtx(app, m) {
  return L('lib_auth').contextFor(app, m);
}

/** Members who may vote on an item now: active, a voting role for its fund, the fund in their scope, the deal visible to them. */
function eligible(app, item) {
  const util = u();
  const fund = item.getString('fund');
  const roles = voterRoles(app, fund);
  const deal = item.getString('deal');
  const out = [];
  for (const m of util.findMany(app, 'members', "status = 'active'", 'created', 0)) {
    const role = util.byId(app, 'roles', m.getString('role'));
    if (role === null) continue;
    const code = role.getString('code');
    if (roles.indexOf(code) < 0) continue;
    const funds = (util.jsonOf(m, 'funds', []) || []).filter((x) => typeof x === 'string' && x !== '');
    if (code !== 'owner' && fund !== '' && funds.length > 0 && funds.indexOf(fund) < 0) continue;
    if (deal !== '' && !L('lib_auth').dealVisible(memberCtx(app, m), deal)) continue;
    out.push({ id: m.id, name: m.getString('name'), role: code, seniority: seniorityOf(app, code), joined: m.getString('created') });
  }
  return out;
}

function isEligible(ctx, item) {
  if (ctx.isAgent || !ctx.memberId) return false;
  const fund = item.getString('fund');
  if (voterRoles(ctx.app, fund).indexOf(ctx.roleCode) < 0) return false;
  if (!ctx.owner && fund !== '' && ctx.funds.length > 0 && ctx.funds.indexOf(fund) < 0) return false;
  const deal = item.getString('deal');
  return deal === '' || L('lib_auth').dealVisible(ctx, deal);
}

/** Who voted on an item (member ids), never what. */
function votedIds(app, itemId) {
  return u()
    .rows(app, 'SELECT member FROM votes WHERE item = {:i}', { member: '' }, { i: itemId })
    .map((r) => r.member);
}

/* --------------------------------------------------------------- views */

function memoBrief(app, memoId) {
  const m = memoId ? u().byId(app, 'memos', memoId) : null;
  if (m === null) return null;
  return { id: m.id, number: m.getString('number'), version: m.getInt('version'), status: m.getString('status'), hash: m.getString('hash'), submitted_at: m.getString('submitted_at') };
}

function coolingOf(item) {
  const end = item.getString('cooling_end_at');
  if (end === '') return { state: 'none', ends_at: '' };
  return { state: ms(end) > Date.now() ? 'cooling' : 'over', ends_at: end };
}

/**
 * One agenda item as a screen or your AI agent sees it. Before the reveal
 * the votes part has counts and, per eligible member, only `voted`.
 */
function itemOut(ctx, item, opts) {
  const app = ctx.app;
  const o = opts || {};
  const revealed = item.getString('revealed_at') !== '';
  const status = item.getString('status');
  const out = {
    id: item.id,
    meeting: item.getString('meeting'),
    kind: item.getString('kind'),
    kind_label: KIND_LABEL[item.getString('kind')] || item.getString('kind'),
    title: '',
    sort: item.getInt('sort'),
    deal: dealMini(app, item.getString('deal')),
    company: mini(app, 'companies', item.getString('company')),
    fund: fundMini(app, item.getString('fund')),
    memo: memoBrief(app, item.getString('memo')),
    champion: mini(app, 'members', item.getString('champion')),
    skeptic: mini(app, 'members', item.getString('skeptic')),
    preread_at: item.getString('preread_at'),
    cooling: coolingOf(item),
    voting: item.getString('voting'),
    status: status,
    scale: item.getString('scale') || scaleKey(app, item.getString('fund')),
    rule: item.getString('rule') || ruleOf(app, item.getString('fund')),
    revealed: revealed,
    revealed_at: item.getString('revealed_at'),
    decision: item.getString('decision') !== '' ? decisionBrief(app, item.getString('decision')) : null,
    bearcase: bearOut(ctx, item),
    bearcase_at: item.getString('bearcase_at'),
    bearcase_by: item.getString('bearcase_by'),
    bearcase_ask: L('lib_agent').track(item, 'bear_case', ['Asked', 'Ready']),
    source: item.getString('source'),
  };
  out.title = item.getString('title') || (out.deal !== null ? out.deal.title : '') || (out.company !== null ? out.company.name : '');
  out.scale_choices = RU().scale(out.scale).choices;
  out.scale_label = RU().scale(out.scale).label;
  if (o.votes !== false) out.votes = votesOf(ctx, item);
  if (revealed) out.tally = u().jsonOf(item, 'tally', null);
  return out;
}

/** The votes part of an item: counts, per member voted or not, and choices only after the reveal. */
function votesOf(ctx, item) {
  const app = ctx.app;
  const revealed = item.getString('revealed_at') !== '';
  const voted = votedIds(app, item.id);
  const elig = revealed ? u().jsonOf(item, 'eligible', []) || [] : eligible(app, item);
  const ids = elig.map((x) => x.id);
  for (const v of voted) {
    if (ids.indexOf(v) < 0) {
      const m = u().byId(app, 'members', v);
      elig.push({ id: v, name: m ? m.getString('name') : 'Former member', role: '', seniority: 0, joined: m ? m.getString('created') : '' });
      ids.push(v);
    }
  }
  let members;
  if (revealed) {
    const tally = u().jsonOf(item, 'tally', null) || { votes: [] };
    const byMember = {};
    for (const v of tally.votes || []) byMember[v.member] = v;
    members = RU()
      .juniorFirst(elig)
      .map((e) => {
        const v = byMember[e.id];
        return { id: e.id, name: e.name, voted: v !== undefined, choice: v ? v.choice : null, lean: v ? v.lean : null, veto: v ? v.veto : false, rationale: v ? v.rationale : '' };
      });
  } else {
    members = elig
      .slice()
      .sort((a, b) => String(a.name).localeCompare(String(b.name)))
      .map((e) => ({ id: e.id, name: e.name, voted: voted.indexOf(e.id) >= 0 }));
  }
  const me = ctx.memberId ? { eligible: ids.indexOf(ctx.memberId) >= 0 && (revealed || isEligible(ctx, item) || voted.indexOf(ctx.memberId) >= 0), voted: voted.indexOf(ctx.memberId) >= 0 } : { eligible: false, voted: false };
  return { eligible: elig.length, voted: voted.length, waiting: Math.max(0, elig.length - voted.length), revealed: revealed, members: members, me: me };
}

function fundMini(app, id) {
  const f = id ? u().byId(app, 'entities', id) : null;
  return f ? { id: f.id, name: f.getString('name') } : null;
}

/** The bear case with its citations resolved for screens. */
function bearOut(ctx, item) {
  const b = u().jsonOf(item, 'bearcase', null);
  if (b === null || !Array.isArray(b.points)) return null;
  const M = L('lib_committee_memos');
  return { points: b.points.map((pt) => ({ kind: pt.kind, text: pt.text, citations: M.citationsOut(ctx, item.getString('deal'), pt.citations || []) })) };
}

function meetingOut(ctx, m, full) {
  const app = ctx.app;
  const util = u();
  const items = util.findMany(app, 'agenda_items', 'meeting = {:m}', 'sort,created', 0, { m: m.id });
  let hidden = 0;
  const visible = [];
  for (const it of items) {
    if (canSeeDeal(ctx, it.getString('deal'))) visible.push(it);
    else hidden++;
  }
  const out = {
    id: m.id,
    number: m.getString('number'),
    title: m.getString('title'),
    starts_at: m.getString('starts_at'),
    day: m.getString('day'),
    status: m.getString('status'),
    fund: fundMini(app, m.getString('fund')),
    facilitator: mini(app, 'members', m.getString('facilitator')),
    current_item: m.getString('current_item'),
    started_at: m.getString('started_at'),
    closed_at: m.getString('closed_at'),
    auto: m.getBool('auto'),
    items_total: visible.length,
    items_decided: visible.filter((x) => x.getString('status') === 'decided').length,
    hidden: hidden,
    me: { facilitator: isFacilitator(ctx, m) },
  };
  if (full) out.items = visible.map((it) => itemOut(ctx, it));
  return out;
}

function decisionBrief(app, id) {
  const d = id ? u().byId(app, 'decisions', id) : null;
  if (d === null) return null;
  return { id: d.id, outcome: d.getString('outcome'), outcome_label: OUTCOME_LABEL[d.getString('outcome')], rule: d.getString('rule'), decided_at: d.getString('decided_at') };
}

function conditionOut(app, c) {
  const today = u().today(app);
  const due = c.getString('due_day');
  return {
    id: c.id,
    decision: c.getString('decision'),
    deal: dealMini(app, c.getString('deal')),
    text: c.getString('text'),
    owner: mini(app, 'members', c.getString('owner')),
    due_day: due,
    overdue: c.getString('status') === 'open' && due !== '' && due < today,
    status: c.getString('status'),
    evidence: c.getString('evidence'),
    completed_at: c.getString('completed_at'),
    completed_by: mini(app, 'members', c.getString('completed_by')),
    actor: c.getString('actor'),
    created: c.getString('created'),
  };
}

/* ------------------------------------------------------- NDA quotes */

const NDA_REASONS = ['nda', 'nda_not_asked'];

/**
 * Who may read a file's quotes, the rule anchors.resolve applies
 * (lib_files.canRead: an NDA file opens to the deal team, and to your AI
 * agent only while a person's NDA ask about that deal is pending). ->
 * fn(fileId) -> { ok, reason } with reason nda, nda_not_asked or
 * not_visible; cached per file.
 */
function quoteRights(ctx) {
  const util = u();
  const seen = {};
  return (fileId) => {
    const id = String(fileId || '');
    if (seen[id] === undefined) {
      const f = util.byId(ctx.app, 'files', id);
      const r = f === null ? { ok: false, reason: 'not_visible' } : L('lib_files').canRead(ctx, f, { deleted: true });
      seen[id] = r.ok ? { ok: true } : { ok: false, reason: NDA_REASONS.indexOf(r.reason) >= 0 ? r.reason : 'not_visible' };
    }
    return seen[id];
  };
}

/**
 * The decision snapshot as ctx may read it. The stored snapshot keeps the
 * facts and confirmed diligence answers whole (what the firm knew); every
 * read withholds the verbatim quotes of files ctx may not open (quoteRights):
 * quote '', hidden true and hidden_reason. Values, grades, pages and anchor
 * ids stay; a diligence citation also drops its file name, as diligence shows it.
 */
function snapshotView(ctx, snap) {
  if (snap === null || typeof snap !== 'object' || !ctx || ctx.actor === 'system') return snap;
  const can = quoteRights(ctx);
  const out = Object.assign({}, snap);
  if (Array.isArray(snap.facts)) {
    out.facts = snap.facts.map((f) => {
      if (!f || !f.file || !f.quote) return f;
      const r = can(f.file);
      return r.ok ? f : Object.assign({}, f, { quote: '', hidden: true, hidden_reason: r.reason });
    });
  }
  const dd = snap.diligence;
  if (dd && typeof dd === 'object' && Array.isArray(dd.answers)) {
    out.diligence = Object.assign({}, dd, {
      answers: dd.answers.map((a) => {
        if (!a || !Array.isArray(a.cites)) return a;
        return Object.assign({}, a, {
          cites: a.cites.map((c) => {
            if (!c || !c.file || !c.quote) return c;
            const r = can(c.file);
            return r.ok ? c : Object.assign({}, c, { quote: '', file_name: '', hidden: true, hidden_reason: r.reason });
          }),
        });
      }),
    });
  }
  return out;
}

/**
 * A decision; `full` adds the snapshot (NDA quotes withheld from those who
 * may not read them), the votes with
 * rationales (junior first), conditions, reviews and corrections.
 */
function decisionOut(ctx, d, full) {
  const app = ctx.app;
  const util = u();
  const tally = util.jsonOf(d, 'tally', null);
  const corrected = util.one(app, 'SELECT id FROM decisions WHERE corrects = {:d} ORDER BY decided_at DESC LIMIT 1', { id: '' }, { d: d.id });
  const out = {
    id: d.id,
    deal: dealMini(app, d.getString('deal')),
    company: mini(app, 'companies', d.getString('company')),
    meeting: d.getString('meeting') !== '' ? { id: d.getString('meeting'), number: (util.byId(app, 'ic_meetings', d.getString('meeting')) || { getString: () => '' }).getString('number') } : null,
    item: d.getString('item'),
    outcome: d.getString('outcome'),
    outcome_label: OUTCOME_LABEL[d.getString('outcome')],
    rule: d.getString('rule'),
    rule_label: RULE_LABEL[d.getString('rule')],
    rule_result: d.getString('rule_result'),
    reason: d.getString('reason'),
    reason_label: REASON_LABEL[d.getString('reason')] || '',
    note: d.getString('note'),
    tally: tally === null ? null : { scale: tally.scale, scale_label: tally.scale_label, rule: tally.rule, choices: tally.choices, for: tally.for, against: tally.against, neutral: tally.neutral, vetoes: tally.vetoes, voted: tally.voted, eligible: tally.eligible, result: tally.result, reason: tally.reason },
    memo: d.getString('memo') !== '' ? { id: d.getString('memo'), version: d.getInt('memo_version'), hash: d.getString('memo_hash') } : null,
    decided_by: mini(app, 'members', d.getString('decided_by')),
    decided_at: d.getString('decided_at'),
    corrects: d.getString('corrects'),
    corrected_by: corrected ? corrected.id : '',
    conditions_open: util.count(app, "SELECT COUNT(*) AS n FROM conditions WHERE decision = {:d} AND status = 'open'", { d: d.id }),
    conditions_total: util.count(app, 'SELECT COUNT(*) AS n FROM conditions WHERE decision = {:d}', { d: d.id }),
    reviews: util.jsonOf(d, 'reviews', []) || [],
  };
  if (full) {
    out.votes = tally ? tally.votes || [] : [];
    out.snapshot = snapshotView(ctx, util.jsonOf(d, 'snapshot', null));
    out.conditions = util.findMany(app, 'conditions', 'decision = {:d}', 'due_day,created', 0, { d: d.id }).map((c) => conditionOut(app, c));
  }
  return out;
}

/* ------------------------------------------------------ contract (4.6) */

/** lib_committee.decisionOf(app, dealId) -> the latest decision on the deal (a correction is the newest) or null. */
function decisionOf(app, dealId) {
  if (!dealId) return null;
  const last = app.findRecordsByFilter('decisions', 'deal = {:d}', '-decided_at,-created', 1, 0, { d: dealId })[0];
  return last ? decisionOut(L('lib_auth').systemCtx(app), last, false) : null;
}

/* ------------------------------------------------------------ meetings */

/** The next meeting day and time from settings (weekday, HH:MM in the firm zone), from today on. */
function nextMeetingAt(app) {
  const s = settings(app);
  const today = u().today(app);
  const wd = Math.max(0, Math.min(6, Number(s.meeting_weekday)));
  const time = u().isTime(String(s.meeting_time)) ? String(s.meeting_time) : '10:00';
  let day = today;
  for (let i = 0; i < 8; i++) {
    const d = u().dayAdd(today, i);
    if (u().weekday(d) === wd && ms(u().atOf(app, d, time)) > Date.now()) {
      day = d;
      break;
    }
  }
  return { day: day, time: time, at: u().atOf(app, day, time) };
}

/** The next planned meeting (optionally of a fund), or null. */
function nextPlanned(app, fundId) {
  const rows = app.findRecordsByFilter('ic_meetings', "status = 'planned' || status = 'live'", 'starts_at', 20, 0);
  for (const m of rows) {
    if (fundId && m.getString('fund') !== '' && m.getString('fund') !== fundId) continue;
    return m;
  }
  return null;
}

function meetingRef(app, ref) {
  const util = u();
  const r = String(ref || '').trim();
  if (r === '' || r === 'next') {
    const m = nextPlanned(app, '');
    if (m === null) throw util.fail(404, 'No planned meeting. Create one with meetings.create.', 'not_found');
    return m;
  }
  let m = util.byId(app, 'ic_meetings', r);
  if (m === null) m = util.findOne(app, 'ic_meetings', 'number = {:n}', { n: r.toUpperCase() });
  if (m === null) throw util.fail(404, 'No meeting ' + r + '. Run meetings.list.', 'not_found');
  return m;
}

function itemRef(ctx, ref) {
  const util = u();
  const it = util.byId(ctx.app, 'agenda_items', String(ref || '').trim());
  if (it === null) throw util.fail(404, 'No agenda item ' + ref + '. Run meetings.get.', 'not_found');
  if (!canSeeDeal(ctx, it.getString('deal'))) throw util.fail(403, 'This item is on a deal you cannot see.', 'restricted');
  return it;
}

/** Create a meeting record (number IC-001) at a UTC instant. */
function createMeeting(ctx, o) {
  const util = u();
  const app = ctx.app;
  const m = util.newRecord(app, 'ic_meetings');
  m.set('number', util.nextId(app, 'IC', 3));
  m.set('title', util.clip(o.title || 'Investment committee', 120));
  m.set('fund', o.fund || '');
  m.set('starts_at', o.at);
  m.set('day', util.dayOf(app, o.at));
  m.set('status', 'planned');
  m.set('facilitator', o.facilitator || '');
  m.set('auto', o.auto === true);
  L('lib_records').stampWritten(ctx, m);
  app.save(m);
  return m;
}

/** The owner who facilitates an automatic meeting (the first active owner). */
function firstOwner(app) {
  const r = u().one(app, "SELECT m.id AS id FROM members m JOIN roles r ON r.id = m.role WHERE r.code = 'owner' AND m.status = 'active' ORDER BY m.created LIMIT 1", { id: '' });
  return r ? r.id : '';
}

/** The latest memo of a deal (any status), or null. */
function latestMemo(app, dealId) {
  const r = app.findRecordsByFilter('memos', 'deal = {:d}', '-version', 1, 0, { d: dealId });
  return r.length > 0 ? r[0] : null;
}

/** Is the deal already waiting on an open agenda (an item not decided or skipped, in a planned or live meeting)? */
function onOpenAgenda(app, dealId) {
  return (
    u().count(app, "SELECT COUNT(*) AS n FROM agenda_items a JOIN ic_meetings m ON m.id = a.meeting WHERE a.deal = {:d} AND a.status IN ('waiting', 'voting', 'revealed') AND m.status IN ('planned', 'live')", { d: dealId }) > 0
  );
}

function itemKindFor(app, deal) {
  const holdings = L('lib_portfolio').holdingsOf(app, { company: deal.getString('company') }) || [];
  return holdings.length > 0 ? 'follow_on' : 'new_investment';
}

/** Point the item at the deal's latest submitted memo; pre-reads go out then, cooling-off follows. */
function attachMemo(app, item, memo) {
  if (memo === null || (memo.getString('status') !== 'submitted' && memo.getString('status') !== 'final')) return false;
  if (item.getString('memo') === memo.id && item.getString('memo_hash') === memo.getString('hash')) return false;
  item.set('memo', memo.id);
  item.set('memo_version', memo.getInt('version'));
  item.set('memo_hash', memo.getString('hash'));
  const at = memo.getString('submitted_at') || u().nowIso();
  item.set('preread_at', at);
  item.set('cooling_end_at', new Date(ms(at) + settings(app).cooling_hours * 3600000).toISOString());
  return true;
}

/**
 * addItem(ctx, { meeting?, deal?, company?, kind?, title?, champion?, source? }) -> item view.
 * One open item per deal; a deal's item takes its fund, champion (point partner) and latest submitted memo.
 */
function addItem(ctx, o) {
  const util = u();
  const app = ctx.app;
  const meeting = o.meeting ? (typeof o.meeting === 'string' ? meetingRef(app, o.meeting) : o.meeting) : meetingRef(app, 'next');
  if (meeting.getString('status') === 'closed') throw util.fail(409, meeting.getString('number') + ' is closed.', 'meeting_closed');
  let deal = null;
  if (o.deal) {
    deal = typeof o.deal === 'string' ? needDeal(ctx, o.deal) : o.deal;
    if (deal.getString('status') !== 'open' && deal.getString('status') !== 'hold') throw util.fail(409, (deal.getString('number') || 'The deal') + ' is ' + deal.getString('status') + '.', 'deal_closed');
    if (onOpenAgenda(app, deal.id)) {
      const ex = app.findRecordsByFilter('agenda_items', "deal = {:d} && (status = 'waiting' || status = 'voting' || status = 'revealed')", '-created', 1, 0, { d: deal.id })[0];
      throw util.fail(409, (deal.getString('number') || 'The deal') + ' is already on an open agenda.', 'already_on_agenda', { item: ex ? ex.id : '' });
    }
  }
  const company = deal !== null ? deal.getString('company') : o.company ? L('lib_records').resolve(app, 'companies', o.company).id : '';
  if (deal === null && company === '' && !o.title) throw util.fail(400, 'Give --deal, --company or --title.', 'missing_param', { param: 'deal' });
  const kind = o.kind ? o.kind : deal !== null ? itemKindFor(app, deal) : 'portfolio';
  if (KINDS.indexOf(kind) < 0) throw util.fail(400, 'kind must be one of: ' + KINDS.join(', '), 'invalid_param', { param: 'kind' });
  const it = util.newRecord(app, 'agenda_items');
  it.set('meeting', meeting.id);
  it.set('kind', kind);
  it.set('deal', deal !== null ? deal.id : '');
  it.set('company', company);
  it.set('title', util.clip(o.title || '', 200));
  const last = util.one(app, 'SELECT COALESCE(MAX(sort), 0) AS n FROM agenda_items WHERE meeting = {:m}', { n: 0 }, { m: meeting.id });
  it.set('sort', (last ? last.n : 0) + 1);
  it.set('fund', deal !== null ? deal.getString('fund') : meeting.getString('fund'));
  it.set('champion', o.champion ? L('lib_auth').memberRef(app, o.champion).id : deal !== null ? deal.getString('point') : '');
  it.set('voting', 'open');
  it.set('status', 'waiting');
  it.set('source', o.source || 'manual');
  if (deal !== null) attachMemo(app, it, latestMemo(app, deal.id));
  if (deal === null) it.set('preread_at', util.nowIso());
  L('lib_records').stampWritten(ctx, it);
  app.save(it);
  return it;
}

/**
 * Assemble a meeting's agenda: every open deal at stage IC or with a
 * submitted memo not decided yet, not already on an open agenda, in the
 * meeting's fund when it has one. -> items added (records)
 */
function assemble(ctx, meeting) {
  const util = u();
  const app = ctx.app;
  const rows = util.rows(
    app,
    "SELECT d.id AS id FROM deals d WHERE d.status = 'open' AND d.deleted_at = '' AND (d.stage = 'ic' OR d.id IN (SELECT deal FROM memos WHERE status = 'submitted')) ORDER BY d.stage_entered_at",
    { id: '' },
  );
  const added = [];
  for (const r of rows) {
    const d = app.findRecordById('deals', r.id);
    if (meeting.getString('fund') !== '' && d.getString('fund') !== '' && d.getString('fund') !== meeting.getString('fund')) continue;
    if (onOpenAgenda(app, d.id)) continue;
    const lastDecision = app.findRecordsByFilter('decisions', 'deal = {:d}', '-decided_at', 1, 0, { d: d.id })[0];
    const memo = latestMemo(app, d.id);
    if (lastDecision && (memo === null || memo.getString('status') !== 'submitted' || memo.getString('submitted_at') < lastDecision.getString('decided_at'))) continue;
    if (!L('lib_auth').dealVisible(L('lib_auth').systemCtx(app), d)) continue;
    added.push(addItem(ctx, { meeting: meeting, deal: d, source: d.getString('stage') === 'ic' ? 'stage' : 'memo' }));
  }
  return added;
}

/* --------------------------------------------------------------- events */

/** deal.moved: a deal reaching IC joins the next planned meeting (a new one on the meeting day when none is planned). */
function onDealMoved(ctx, p) {
  if (!p || p.to !== 'ic' || ctx.dryRun) return null;
  const app = ctx.app;
  const d = u().byId(app, 'deals', p.deal);
  if (d === null || onOpenAgenda(app, d.id)) return null;
  let meeting = nextPlanned(app, d.getString('fund'));
  if (meeting === null) {
    if (settings(app).auto_meeting !== true) return null;
    const at = nextMeetingAt(app);
    meeting = createMeeting(ctx, { at: at.at, title: 'Investment committee', facilitator: firstOwner(app), auto: true });
  }
  const it = addItem(ctx, { meeting: meeting, deal: d, source: 'stage' });
  return { item: it.id, meeting: meeting.id };
}

/** deal.closed: a deal passed, lost or held outside the committee leaves the open agendas. */
function onDealClosed(ctx, p) {
  if (!p || p.status === 'invested' || ctx.dryRun) return null;
  const app = ctx.app;
  let n = 0;
  for (const it of app.findRecordsByFilter('agenda_items', "deal = {:d} && (status = 'waiting' || status = 'voting')", '', 0, 0, { d: p.deal })) {
    it.set('status', 'skipped');
    app.save(it);
    n++;
  }
  return { skipped: n };
}

/* ------------------------------------------------------------------ Next */

function scaleOptions(scaleKeyV) {
  const s = RU().scale(scaleKeyV);
  return s.choices.map((c) => ({ value: c, label: c === 'yes' ? 'Yes' : c === 'no' ? 'No' : c }));
}

/** needsYou(ctx): votes due, reveals and decisions to record, conditions due, memo drafts to review. */
function needsYou(ctx) {
  if (ctx.isAgent || !ctx.memberId) return [];
  const util = u();
  const app = ctx.app;
  const out = [];
  const auth = L('lib_auth');
  if (auth.can(ctx, 'committee', 'view')) {
    const open = util.rows(
      app,
      "SELECT a.id AS id FROM agenda_items a JOIN ic_meetings m ON m.id = a.meeting WHERE a.status IN ('waiting', 'voting', 'revealed') AND m.status IN ('planned', 'live') ORDER BY m.starts_at, a.sort",
      { id: '' },
    );
    for (const r of open) {
      const it = app.findRecordById('agenda_items', r.id);
      if (!canSeeDeal(ctx, it.getString('deal'))) continue;
      const meeting = app.findRecordById('ic_meetings', it.getString('meeting'));
      const view = itemOut(ctx, it, { votes: false });
      const d = view.deal;
      const title = view.title || (d ? d.title : 'Agenda item');
      const figures = [];
      if (d && d.raise_minor !== null) figures.push({ label: 'Raise', value: money(d.raise_minor, d.currency) });
      if (d && d.check_minor !== null) figures.push({ label: 'Check', value: money(d.check_minor, d.currency) });
      if (view.memo) figures.push({ label: 'Memo', value: 'v' + view.memo.version });
      const chips = [{ label: view.kind_label, tone: 'neutral' }];
      if (view.cooling.state === 'cooling') chips.push({ label: 'Cooling-off', tone: 'warn' });
      const href = '#/committee/' + meeting.id;
      const st = it.getString('status');
      const hasPrereads = it.getString('preread_at') !== '';
      if ((st === 'waiting' || st === 'voting') && it.getString('voting') === 'open' && hasPrereads && isEligible(ctx, it) && votedIds(app, it.id).indexOf(ctx.memberId) < 0) {
        out.push({
          key: 'committee:vote:' + it.id,
          kind: 'vote',
          card: 'vote',
          title: title,
          figures: figures,
          chips: chips,
          rank: 10,
          at: meeting.getString('starts_at'),
          href: href,
          data: { item: it.id, meeting: meeting.getString('number'), starts_at: meeting.getString('starts_at'), scale: view.scale, scale_label: view.scale_label, choices: view.scale_choices, cooling_end_at: view.cooling.ends_at, memo: view.memo, deal: d ? d.number : '' },
          actions: [{ label: 'Vote', op: 'votes.cast', params: { item: it.id }, primary: true, choose: { param: 'choice', options: scaleOptions(view.scale) } }],
        });
      }
      if (isFacilitator(ctx, meeting)) {
        if ((st === 'waiting' || st === 'voting') && view.cooling.state !== 'cooling') {
          const elig = eligible(app, it);
          const voted = votedIds(app, it.id);
          const missing = elig.filter((e) => voted.indexOf(e.id) < 0).length;
          if (voted.length > 0 && (missing === 0 || it.getString('voting') === 'closed')) {
            out.push({ key: 'committee:reveal:' + it.id, kind: 'decision', card: '', title: title, figures: [{ label: 'Votes', value: voted.length + ' of ' + Math.max(elig.length, voted.length) }].concat(figures.slice(0, 2)), chips: chips, rank: 10, at: meeting.getString('starts_at'), href: href, data: { item: it.id, meeting: meeting.getString('number') }, actions: [{ label: 'Reveal', op: 'votes.reveal', params: { item: it.id }, primary: true }] });
          }
        }
        if (st === 'revealed') {
          const tally = util.jsonOf(it, 'tally', null) || {};
          const rule = it.getString('rule') || ruleOf(app, it.getString('fund'));
          const first = tally.result === 'invest' ? 'invest' : 'pass';
          out.push({
            key: 'committee:decide:' + it.id,
            kind: 'decision',
            card: 'decide',
            title: title,
            figures: [{ label: 'For', value: String(tally.for || 0) }, { label: 'Against', value: String(tally.against || 0) }, { label: 'Rule', value: RULE_LABEL[rule] }],
            chips: tally.vetoes > 0 ? [{ label: 'Veto', tone: 'bad' }] : [],
            rank: 10,
            at: meeting.getString('starts_at'),
            href: href,
            data: { item: it.id, tally: tally, rule: rule, outcome: first, champion: it.getString('champion') },
            actions: [{ label: 'Record decision', op: 'decisions.record', params: { item: it.id, rule: rule, outcome: first }, primary: true }],
          });
        }
      }
    }
  }
  const today = util.today(app);
  const soon = util.dayAdd(today, 3);
  for (const c of util.findMany(app, 'conditions', "status = 'open' && due_day != '' && due_day <= {:s}", 'due_day', 200, { s: soon })) {
    const owner = c.getString('owner');
    const deal = u().byId(app, 'deals', c.getString('deal'));
    const mine = owner !== '' ? owner === ctx.memberId : deal !== null && deal.getString('point') === ctx.memberId;
    if (!mine || !canSeeDeal(ctx, c.getString('deal'))) continue;
    const dm = dealMini(app, c.getString('deal'));
    const due = c.getString('due_day');
    out.push({
      key: 'committee:condition:' + c.id,
      kind: 'condition',
      title: c.getString('text'),
      figures: [{ label: 'Due', value: due }, { label: 'Deal', value: dm ? dm.title : '' }],
      chips: due < today ? [{ label: 'Overdue', tone: 'bad' }] : due === today ? [{ label: 'Due today', tone: 'warn' }] : [],
      rank: due <= today ? 10 : 50,
      at: util.atOf(app, due, '08:00'),
      href: dm ? '#/deals/' + dm.number + '?tab=ic' : '#/committee',
      data: { condition: c.id },
      actions: [{ label: 'Done', op: 'conditions.complete', params: { condition: c.id }, primary: true }],
    });
  }
  const drafts = util.rows(
    app,
    "SELECT m.id AS id, COUNT(b.id) AS n, MAX(b.created) AS at FROM memos m JOIN memo_blocks b ON b.memo = m.id AND b.state = 'proposed' JOIN deals d ON d.id = m.deal WHERE m.status = 'draft' AND (m.author = {:me} OR d.point = {:me}) GROUP BY m.id",
    { id: '', n: 0, at: '' },
    { me: ctx.memberId },
  );
  for (const r of drafts) {
    const m = app.findRecordById('memos', r.id);
    if (!canSeeDeal(ctx, m.getString('deal'))) continue;
    const dm = dealMini(app, m.getString('deal'));
    const blocks = util.findMany(app, 'memo_blocks', "memo = {:m} && state = 'proposed'", 'created', 20, { m: m.id });
    out.push({
      key: 'committee:draft:' + m.id,
      kind: 'draft',
      card: 'memo_drafts',
      title: (dm ? dm.title : 'Memo') + ': ' + r.n + (r.n === 1 ? ' section drafted' : ' sections drafted'),
      figures: [{ label: 'Memo', value: m.getString('number') + ' v' + m.getInt('version') }],
      chips: [],
      agent: true,
      rank: 30,
      at: r.at,
      href: dm ? '#/deals/' + dm.number + '?tab=ic&part=memo' : '#/committee',
      data: { memo: m.id, blocks: blocks.map((b) => ({ id: b.id, section: b.getString('section'), label: sectionLabel(app, m, b.getString('section')), content: u().clip(b.getString('content'), 1200), uncited: b.getInt('uncited') })) },
      actions: [
        { label: 'Keep all', op: 'memos.keep', params: { memo: m.id, blocks: 'all' }, primary: true },
        { label: 'Discard all', op: 'memos.discard', params: { memo: m.id, blocks: 'all' } },
      ],
    });
  }
  return out;
}

/* ------------------------------------------------------------ next step */

/**
 * The caller's next committee step on a deal, or null:
 *   vote      my vote is due on its open agenda item (pre-reads out, voting open)
 *   reveal    I facilitate, every eligible member voted, the cooling-off is over
 *   record    I facilitate, the votes are revealed, no decision yet
 *   open      its meeting is live (nothing above is mine to do)
 *   schedule  the deal is at Partner meeting with no open agenda item and I may move it
 * -> { key, label, op, params, href, pin, ready }: op is the operation that
 * finishes the step (pin: it asks the PIN); ready: op with params finishes it
 * in one call (Reveal, Schedule IC); otherwise the person makes the choice at
 * href (the meeting room on that item).
 */
function nextStep(ctx, d) {
  const util = u();
  const app = ctx.app;
  if (d.getString('status') !== 'open') return null;
  const it = app.findRecordsByFilter('agenda_items', "deal = {:d} && (status = 'waiting' || status = 'voting' || status = 'revealed')", '-created', 10, 0, { d: d.id }).filter((x) => {
    const m = util.byId(app, 'ic_meetings', x.getString('meeting'));
    return m !== null && (m.getString('status') === 'planned' || m.getString('status') === 'live');
  })[0];
  if (it === undefined) {
    if (d.getString('stage') !== 'partner_meeting') return null;
    const stages = L('lib_deals').stagesOf(L('lib_deals').pipelineOf(app, d.getString('pipeline')));
    if (!stages.some((s) => s.key === 'ic')) return null;
    if (!ctx.isAgent && !L('lib_auth').can(ctx, 'pipeline', 'edit')) return null;
    return { key: 'schedule', label: 'Schedule IC', op: 'deals.move', params: { deal: d.id, stage: 'ic' }, href: '', pin: false, ready: true };
  }
  const meeting = app.findRecordById('ic_meetings', it.getString('meeting'));
  const href = '#/committee/' + meeting.id + '?item=' + it.id;
  const st = it.getString('status');
  const voted = votedIds(app, it.id);
  if ((st === 'waiting' || st === 'voting') && it.getString('voting') === 'open' && it.getString('preread_at') !== '' && isEligible(ctx, it) && voted.indexOf(ctx.memberId) < 0) {
    return { key: 'vote', label: 'Vote', op: 'votes.cast', params: { item: it.id }, href: href + '&vote=1', pin: true, ready: false };
  }
  if (isFacilitator(ctx, meeting)) {
    if ((st === 'waiting' || st === 'voting') && coolingOf(it).state !== 'cooling' && voted.length > 0) {
      const elig = eligible(app, it);
      if (elig.every((e) => voted.indexOf(e.id) >= 0) || it.getString('voting') === 'closed') return { key: 'reveal', label: 'Reveal', op: 'votes.reveal', params: { item: it.id }, href: href, pin: true, ready: true };
    }
    if (st === 'revealed' && it.getString('decision') === '') return { key: 'record', label: 'Record decision', op: 'decisions.record', params: { item: it.id }, href: href, pin: true, ready: false };
  }
  if (meeting.getString('status') === 'live') return { key: 'open', label: 'Open meeting', op: '', params: {}, href: href, pin: false, ready: false };
  return null;
}

/** committee.next-step: the caller's next committee step on a deal (nextStep), or step null. */
function opNextStep(ctx, p) {
  const d = needDeal(ctx, u().req(p, 'deal'));
  return { deal: { id: d.id, number: d.getString('number') }, step: nextStep(ctx, d) };
}

/** A section's label in a memo's template (the key when unknown). */
function sectionLabel(app, memo, key) {
  const t = memo.getString('template') !== '' ? u().byId(app, 'memo_templates', memo.getString('template')) : null;
  const list = t ? u().jsonOf(t, 'sections', []) || [] : [];
  const s = list.filter((x) => x.key === key)[0];
  return s ? s.label : key;
}

/* --------------------------------------------------- search, timeline, today */

function search(ctx, q, limit) {
  const util = u();
  const app = ctx.app;
  if (!L('lib_auth').can(ctx, 'committee', 'view') && !L('lib_auth').can(ctx, 'pipeline', 'view')) return [];
  const per = Math.max(1, Math.min(20, Number(limit) || 6));
  const like = util.like(q);
  const out = [];
  for (const r of util.rows(app, "SELECT id, number, title, starts_at FROM ic_meetings WHERE number LIKE {:q} ESCAPE '\\' OR title LIKE {:q} ESCAPE '\\' ORDER BY starts_at DESC LIMIT " + per, { id: '', number: '', title: '', starts_at: '' }, { q: like }))
    out.push({ kind: 'meeting', id: r.id, title: r.number + ' ' + r.title, subtitle: util.dayOf(app, r.starts_at), href: '#/committee/' + r.id, icon: 'Gavel' });
  let n = 0;
  for (const r of util.rows(app, "SELECT m.id AS id, m.number AS number, m.version AS version, m.deal AS deal FROM memos m WHERE m.number LIKE {:q} ESCAPE '\\' ORDER BY m.updated DESC LIMIT 30", { id: '', number: '', version: 0, deal: '' }, { q: like })) {
    if (n >= per) break;
    if (!canSeeDeal(ctx, r.deal)) continue;
    const dm = dealMini(app, r.deal);
    out.push({ kind: 'memo', id: r.id, title: r.number + ' v' + r.version, subtitle: dm ? dm.title : '', href: dm ? '#/deals/' + dm.number + '?tab=ic&part=memo' : '#/committee', icon: 'FileText' });
    n++;
  }
  return out;
}

/** Timeline items for a deal or company: memo submissions, agenda, decisions. */
function timelineFor(ctx, t) {
  const util = u();
  const app = ctx.app;
  if (!t || (t.kind !== 'deal' && t.kind !== 'company')) return [];
  const deals = t.kind === 'deal' ? [t.id] : util.rows(app, "SELECT id FROM deals WHERE company = {:c} AND deleted_at = ''", { id: '' }, { c: t.id }).map((r) => r.id);
  const out = [];
  let hidden = 0;
  for (const id of deals) {
    if (!canSeeDeal(ctx, id)) {
      hidden++;
      continue;
    }
    const dm = dealMini(app, id);
    const href = dm ? '#/deals/' + dm.number : '';
    for (const m of util.findMany(app, 'memos', "deal = {:d} && submitted_at != ''", '-version', 20, { d: id })) out.push({ at: m.getString('submitted_at'), module: 'committee', kind: 'memo_submitted', title: 'Memo ' + m.getString('number') + ' v' + m.getInt('version') + ' submitted', icon: 'FileText', href: href + '?tab=ic&part=memo', actor: 'person', ref: { collection: 'memos', id: m.id } });
    for (const d of util.findMany(app, 'decisions', 'deal = {:d}', '-decided_at', 20, { d: id })) out.push({ at: d.getString('decided_at'), module: 'committee', kind: 'decision', title: 'Committee: ' + OUTCOME_LABEL[d.getString('outcome')] + (d.getString('corrects') !== '' ? ' (correction)' : ''), icon: 'Gavel', href: href + '?tab=ic', actor: 'person', ref: { collection: 'decisions', id: d.id } });
    for (const a of util.findMany(app, 'agenda_items', 'deal = {:d}', '-created', 20, { d: id })) {
      const mt = util.byId(app, 'ic_meetings', a.getString('meeting'));
      if (mt !== null) out.push({ at: a.getString('created'), module: 'committee', kind: 'agenda', title: 'On the agenda of ' + mt.getString('number'), icon: 'CalendarCheck', href: '#/committee/' + mt.id, actor: a.getString('actor'), ref: { collection: 'agenda_items', id: a.id } });
    }
  }
  return { items: out, hidden: hidden };
}

/** app.today block: today's meetings and the caller's votes due. */
function today(ctx) {
  const util = u();
  const app = ctx.app;
  const day = util.today(app);
  const meetings = util.findMany(app, 'ic_meetings', "day = {:d} && status != 'closed'", 'starts_at', 10, { d: day }).map((m) => ({ id: m.id, number: m.getString('number'), title: m.getString('title'), starts_at: m.getString('starts_at'), status: m.getString('status') }));
  const due = ctx.memberId ? needsYou(ctx).filter((x) => x.kind === 'vote').length : 0;
  return { key: 'committee', meetings: meetings, votes_due: due };
}

/* ------------------------------------------------------------------ cron */

/** Daily: keep the next meeting's agenda assembled from deals at IC (a meeting is created on the meeting day when deals wait). */
function cronAssemble(app) {
  const s = settings(app);
  const ctx = L('lib_auth').systemCtx(app);
  app.runInTransaction((tx) => {
    const c = Object.assign({}, ctx, { app: tx });
    let meeting = nextPlanned(tx, '');
    if (meeting === null) {
      if (s.auto_meeting !== true) return;
      const waiting = u().count(tx, "SELECT COUNT(*) AS n FROM deals WHERE status = 'open' AND deleted_at = '' AND stage = 'ic'");
      if (waiting === 0) return;
      const at = nextMeetingAt(tx);
      meeting = createMeeting(c, { at: at.at, title: 'Investment committee', facilitator: firstOwner(tx), auto: true });
    }
    assemble(c, meeting);
  });
}

/** Daily: tell owners of conditions due today. */
function cronConditions(app) {
  const util = u();
  const day = util.today(app);
  for (const c of util.findMany(app, 'conditions', "status = 'open' && due_day = {:d}", '', 200, { d: day })) {
    let who = c.getString('owner');
    if (who === '') {
      const d = util.byId(app, 'deals', c.getString('deal'));
      who = d ? d.getString('point') : '';
    }
    if (who === '') continue;
    const dm = dealMini(app, c.getString('deal'));
    L('lib_notify').notify(app, [who], { kind: 'condition', title: 'Condition due today: ' + util.clip(c.getString('text'), 120), body: dm ? dm.title : '', link: dm ? '#/deals/' + dm.number + '?tab=ic' : '#/committee', ref: 'conditions:' + c.id + ':' + day });
  }
}

/** Yearly while the firm's anti_portfolio switch is on: ask your AI agent to look up later outcomes of passed companies (trigger anti_portfolio). */
function cronAntiPortfolio(app) {
  if (u().count(app, "SELECT COUNT(*) AS n FROM decisions WHERE outcome = 'pass'") === 0) return;
  L('lib_agent').ask(app, 'anti_portfolio', L('lib_settings').row(app), {}, { policy: true });
}

/** agent.ask --trigger anti_portfolio: the firm passed on companies to look up. */
function antiCheck(ctx) {
  L('lib_auth').need(ctx, 'committee', 'view', 'ask for the anti-portfolio review');
  if (u().count(ctx.app, "SELECT COUNT(*) AS n FROM decisions WHERE outcome = 'pass'") === 0) throw u().fail(409, 'The firm has not passed on a company at a committee yet.', 'nothing_to_do');
  return {};
}

/** The deal of an agenda item (a restricted deal your AI agent may not work on refuses the ask; its NDA files open while it is asked). */
function itemDeal(app, it) {
  return it.getString('deal');
}

module.exports = {
  LOCKED_SECTIONS: LOCKED_SECTIONS,
  KINDS: KINDS,
  KIND_LABEL: KIND_LABEL,
  OUTCOME_LABEL: OUTCOME_LABEL,
  RULE_LABEL: RULE_LABEL,
  PASS_REASONS: PASS_REASONS,
  REASON_LABEL: REASON_LABEL,
  DEFAULTS: DEFAULTS,
  settings: settings,
  fundSettings: fundSettings,
  scaleKey: scaleKey,
  ruleOf: ruleOf,
  voterRoles: voterRoles,
  seniorityOf: seniorityOf,
  money: money,
  ms: ms,
  mini: mini,
  memberName: memberName,
  dealMini: dealMini,
  canSeeDeal: canSeeDeal,
  needDeal: needDeal,
  isFacilitator: isFacilitator,
  needFacilitator: needFacilitator,
  eligible: eligible,
  isEligible: isEligible,
  votedIds: votedIds,
  memoBrief: memoBrief,
  fundMini: fundMini,
  bearOut: bearOut,
  itemOut: itemOut,
  votesOf: votesOf,
  antiCheck: antiCheck,
  itemDeal: itemDeal,
  meetingOut: meetingOut,
  decisionBrief: decisionBrief,
  decisionOut: decisionOut,
  NDA_REASONS: NDA_REASONS,
  quoteRights: quoteRights,
  snapshotView: snapshotView,
  conditionOut: conditionOut,
  decisionOf: decisionOf,
  nextMeetingAt: nextMeetingAt,
  nextPlanned: nextPlanned,
  meetingRef: meetingRef,
  itemRef: itemRef,
  createMeeting: createMeeting,
  firstOwner: firstOwner,
  latestMemo: latestMemo,
  onOpenAgenda: onOpenAgenda,
  attachMemo: attachMemo,
  addItem: addItem,
  assemble: assemble,
  onDealMoved: onDealMoved,
  onDealClosed: onDealClosed,
  needsYou: needsYou,
  nextStep: nextStep,
  opNextStep: opNextStep,
  sectionLabel: sectionLabel,
  search: search,
  timelineFor: timelineFor,
  today: today,
  cronAssemble: cronAssemble,
  cronConditions: cronConditions,
  cronAntiPortfolio: cronAntiPortfolio,
};
