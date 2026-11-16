/// <reference path="../pb_data/types.d.ts" />
/**
 * Interviews and scorecards. An interview belongs to an application, has a
 * panel of members (each gets a scorecard row), a day, a start time in a
 * time zone, a place or a link, and an optional kit (criteria and
 * questions). Each interviewer writes their own scorecard: a recommendation
 * from strong no to strong yes, a score of 1 to 4 per kit criterion and
 * notes. Nobody on a panel sees the others' scorecards for that interview
 * until they have submitted their own.
 *
 * Your AI agent may write a neutral summary of the submitted scorecards
 * (the interview_summary trigger; the summary is a proposal); it never
 * writes a scorecard, a recommendation or a score of its own.
 *
 * Google Calendar: when your AI agent has Google Calendar connected, a person
 * may add the interview to the calendar through the bridge action
 * create_google_calendar_event; otherwise the option is not offered.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}
function h() {
  return L('lib_hiring');
}


const KINDS = ['phone', 'video', 'onsite', 'technical', 'panel', 'other'];
const SCORE_MIN = 1;
const SCORE_MAX = 4;
const CAL_TTL_MS = 5 * 60 * 1000;
let _cal = { at: 0, v: null };

/* ------------------------------------------------------------ calendar */

/**
 * Is Google Calendar connected in CraftBot? { connected, reason }. Asked of
 * the bridge (GET /api/integrations/available) and kept five minutes.
 * Outside CraftBot there is no bridge: not connected.
 */
function calendarStatus(app) {
  if (_cal.v !== null && Date.now() - _cal.at < CAL_TTL_MS) return _cal.v;
  let v = { connected: false, reason: 'outside' };
  try {
    const base = $os.getenv('CRAFTBOT_BRIDGE_URL');
    const tok = $os.getenv('CRAFTBOT_BRIDGE_TOKEN');
    if (base && tok) {
      const res = $http.send({ url: base + '/api/integrations/available', method: 'GET', headers: { authorization: 'Bearer ' + tok }, timeout: 8 });
      const list = (res.json && res.json.integrations) || [];
      const g = list.filter((i) => i && i.id === 'google_calendar')[0];
      v = { connected: !!(g && g.connected), reason: g ? (g.connected ? '' : 'not_connected') : 'unknown' };
    }
  } catch (err) {
    v = { connected: false, reason: 'error' };
  }
  _cal = { at: Date.now(), v: v };
  return v;
}

/** Create the calendar event of an interview (people only; the op is People only). */
function createEvent(ctx, iv) {
  const util = u();
  const app = ctx.app;
  const hh = h();
  const st = calendarStatus(app);
  if (!st.connected) return { ok: false, error: 'Google Calendar is not connected to your AI agent.' };
  const cand = util.byId(app, 'candidates', iv.getString('candidate'));
  const job = util.byId(app, 'openings', iv.getString('opening'));
  const emails = [];
  for (const id of util.jsonOf(iv, 'interviewers', []) || []) {
    const m = util.byId(app, 'members', id);
    if (m !== null && m.getString('email') !== '') emails.push(m.getString('email'));
  }
  if (ctx.inviteCandidate === true && cand !== null && cand.getString('email') !== '') emails.push(cand.getString('email'));
  const title = 'Interview: ' + (cand !== null ? cand.getString('name') : '') + (job !== null ? ' for ' + job.getString('title') : '');
  const desc = [iv.getString('title'), iv.getString('link'), iv.getString('note')].filter((s) => s !== '').join('\n');
  const tz = iv.getString('timezone') || 'UTC';
  const event = {
    summary: title,
    description: desc,
    location: iv.getString('location') || iv.getString('link'),
    start: { dateTime: iv.getString('at'), timeZone: tz },
    end: { dateTime: iv.getString('end_at'), timeZone: tz },
    attendees: emails.map((e) => ({ email: e })),
  };
  const bridge = require(`${__hooks}/_craftbot_bridge.js`);
  const res = bridge.callAction('create_google_calendar_event', { event_data: event, calendar_id: 'primary', send_updates: 'all' }, { confirmIrreversible: true });
  if (!res || res.status !== 200 || res.error) return { ok: false, error: String((res && res.error) || 'The calendar did not answer.').slice(0, 300) };
  const d = res.data || {};
  const r = d.result && typeof d.result === 'object' ? d.result : d;
  const id = String(r.id || '');
  const link = String(r.htmlLink || r.hangoutLink || '');
  if (id === '' && d.status === 'error') return { ok: false, error: String(d.message || d.reason || 'The calendar refused the event.').slice(0, 300) };
  iv.set('calendar_event', util.clip(id, 300));
  iv.set('calendar_link', util.clip(link, 500));
  app.save(iv);
  hh.event(ctx, { candidate: iv.getString('candidate'), application: iv.getString('application'), kind: 'interview', text: 'Added to Google Calendar' + (emails.length > 0 ? ' with ' + emails.length + ' guest' + (emails.length === 1 ? '' : 's') : '') });
  return { ok: true, event: id, link: link };
}

/* --------------------------------------------------------------- views */

function scorecardView(app, f, cache) {
  const hh = h();
  return {
    id: f.id,
    interview: f.getString('interview'),
    interviewer: f.getString('interviewer'),
    interviewer_name: hh.memberName(app, f.getString('interviewer'), cache),
    recommendation: f.getString('recommendation'),
    scores: u().jsonOf(f, 'scores', {}) || {},
    notes: f.getString('notes'),
    status: f.getString('status'),
    submitted_at: f.getString('submitted_at'),
    updated: f.getString('updated'),
  };
}

/**
 * The scorecards of one interview the caller may read:
 * { mine, others, hidden, submitted, total, can_see_others }.
 */
function visibleScorecards(ctx, iv, access, cache) {
  const util = u();
  const app = ctx.app;
  const rows = util.findMany(app, 'interview_feedback', 'interview = {:i}', 'created', 0, { i: iv.id });
  const me = ctx.memberId || '';
  const mineRec = me !== '' ? rows.filter((f) => f.getString('interviewer') === me)[0] || null : null;
  const submitted = rows.filter((f) => f.getString('status') === 'submitted');
  let see = false;
  if (ctx.isAgent || ctx.actor === 'system') see = true;
  else if (mineRec !== null) see = mineRec.getString('status') === 'submitted';
  else see = access === 'all' || access === 'team';
  const others = see ? submitted.filter((f) => f.getString('interviewer') !== me).map((f) => scorecardView(app, f, cache)) : [];
  return {
    mine: mineRec !== null ? scorecardView(app, mineRec, cache) : null,
    others: others,
    hidden: see ? 0 : submitted.filter((f) => f.getString('interviewer') !== me).length,
    submitted: submitted.length,
    total: rows.length,
    can_see_others: see,
  };
}

function interviewView(ctx, iv, access, cache, opts) {
  const util = u();
  const app = ctx.app;
  const hh = h();
  const o = opts || {};
  const job = util.byId(app, 'openings', iv.getString('opening'));
  const cand = util.byId(app, 'candidates', iv.getString('candidate'));
  const st = job !== null ? hh.stageOf(job, iv.getString('stage')) : null;
  const sc = visibleScorecards(ctx, iv, access, cache);
  const panelStatus = {};
  for (const r of util.rows(app, 'SELECT interviewer, status FROM interview_feedback WHERE interview = {:i}', { interviewer: '', status: '' }, { i: iv.id })) panelStatus[r.interviewer] = r.status;
  const v = {
    id: iv.id,
    application: iv.getString('application'),
    opening: iv.getString('opening'),
    opening_number: job !== null ? job.getString('number') : '',
    opening_title: job !== null ? job.getString('title') : '',
    entity: job !== null ? job.getString('entity') : '',
    candidate: iv.getString('candidate'),
    candidate_name: cand !== null ? cand.getString('name') : '',
    stage: iv.getString('stage'),
    stage_name: st ? st.name : '',
    kind: iv.getString('kind'),
    title: iv.getString('title'),
    kit: iv.getString('kit'),
    kit_name: hh.nameOf(app, 'interview_kits', iv.getString('kit')),
    day: iv.getString('day'),
    start: iv.getString('start'),
    timezone: iv.getString('timezone'),
    at: iv.getString('at'),
    end_at: iv.getString('end_at'),
    duration_min: iv.getInt('duration_min'),
    interviewers: (util.jsonOf(iv, 'interviewers', []) || []).map((id) => ({ id: id, name: hh.memberName(app, id, cache), scorecard: panelStatus[id] || '' })),
    location: iv.getString('location'),
    link: iv.getString('link'),
    status: iv.getString('status'),
    note: iv.getString('note'),
    calendar_event: iv.getString('calendar_event'),
    calendar_link: iv.getString('calendar_link'),
    mine: ctx.memberId ? panelStatus[ctx.memberId] !== undefined : false,
    my_scorecard: ctx.memberId ? panelStatus[ctx.memberId] || '' : '',
    scorecards: { submitted: sc.submitted, total: sc.total },
    summary: sc.can_see_others ? iv.getString('summary') : '',
    summary_at: sc.can_see_others ? iv.getString('summary_at') : '',
    summary_actor: sc.can_see_others ? iv.getString('summary_actor') : '',
    access: access,
    scheduled_by_name: hh.memberName(app, iv.getString('scheduled_by'), cache),
    created: iv.getString('created'),
  };
  if (o.full) {
    v.scorecard = sc;
    const kit = iv.getString('kit') !== '' ? util.byId(app, 'interview_kits', iv.getString('kit')) : null;
    v.kit_detail = kit !== null ? L('lib_hiring_jobs').kitView(kit) : null;
    v.agent = L('lib_agent').view(iv, 'interview_summary');
    v.can = {
      edit: hh.writable(ctx, access) && hh.agentMay(ctx, 'interviews.update') && iv.getString('status') !== 'cancelled',
      scorecard: v.mine && hh.agentMay(ctx, 'scorecards.save') && iv.getString('status') !== 'cancelled',
      summarize: hh.writable(ctx, access) && hh.agentMay(ctx, 'interviews.summarize') && sc.submitted > 0,
      calendar: hh.writable(ctx, access) && hh.agentMay(ctx, 'interviews.calendar') && iv.getString('status') === 'scheduled' && calendarStatus(app).connected,
    };
  }
  return v;
}

function ivRef(ctx, ref) {
  const util = u();
  const iv = util.byId(ctx.app, 'interviews', String(ref || '').trim());
  if (iv === null) throw util.fail(404, 'No interview ' + ref + '. Run interviews.list.', 'not_found');
  return iv;
}

/** The interview and the caller's access to it (interviewers reach only their own interviews). */
function needInterview(ctx, ref, write) {
  const util = u();
  const app = ctx.app;
  const hh = h();
  const iv = ivRef(ctx, ref);
  const a = app.findRecordById('applications', iv.getString('application'));
  const job = app.findRecordById('openings', iv.getString('opening') || a.getString('opening'));
  let access = hh.jobAccess(ctx, job);
  if (access === '') {
    const onThis = ctx.memberId ? util.count(app, 'SELECT COUNT(*) AS n FROM interview_feedback WHERE interview = {:i} AND interviewer = {:m}', { i: iv.id, m: ctx.memberId }) > 0 : false;
    if (!onThis) throw util.fail(404, 'No interview ' + ref + ' that you can see.', 'not_found');
    access = 'interviewer';
  }
  if (write && !hh.writable(ctx, access)) throw util.fail(403, 'Your role can look at this interview but not change it.', 'not_permitted');
  return { rec: iv, access: access, app: a, job: job };
}

/** Interviews of one application the caller may see. */
function forApplication(ctx, applicationId, access, cache) {
  const util = u();
  const rows = util.findMany(ctx.app, 'interviews', 'application = {:a}', 'at', 0, { a: applicationId });
  return rows
    .filter((iv) => access !== 'interviewer' || (ctx.memberId && util.count(ctx.app, 'SELECT COUNT(*) AS n FROM interview_feedback WHERE interview = {:i} AND interviewer = {:m}', { i: iv.id, m: ctx.memberId }) > 0))
    .map((iv) => {
      const v = interviewView(ctx, iv, access, cache, {});
      v.scorecard = visibleScorecards(ctx, iv, access, cache);
      return v;
    });
}

/** Interviews in a window the caller may see (or only theirs). */
function visibleInterviews(ctx, o, cache) {
  const util = u();
  const app = ctx.app;
  const hh = h();
  const bind = { from: o.from, to: o.to };
  const where = ['i.at >= {:from}', 'i.at <= {:to}'];
  if (o.status && o.status !== 'all') {
    where.push('i.status = {:st}');
    bind.st = o.status;
  }
  if (o.opening) {
    where.push('i.opening = {:op}');
    bind.op = o.opening;
  }
  if (o.application) {
    where.push('i.application = {:ap}');
    bind.ap = o.application;
  }
  const panel = 'EXISTS (SELECT 1 FROM interview_feedback f WHERE f.interview = i.id AND f.interviewer = {:me})';
  bind.me = ctx.memberId || '-';
  if (o.mine) where.push(panel);
  else if (!(ctx.isAgent || ctx.actor === 'system')) {
    if (hh.level(ctx) === 'none') where.push(panel);
    else where.push('(' + hh.jobWhere(ctx, bind, 'j') + ' OR ' + panel + ')');
  }
  const ids = util.rows(app, 'SELECT i.id AS id FROM interviews i JOIN openings j ON j.id = i.opening WHERE ' + where.join(' AND ') + ' ORDER BY i.at LIMIT ' + (o.limit || 500), { id: '' }, bind);
  return ids.map((x) => {
    const iv = app.findRecordById('interviews', x.id);
    const job = app.findRecordById('openings', iv.getString('opening'));
    const acc = hh.jobAccess(ctx, job) || 'interviewer';
    return interviewView(ctx, iv, acc, cache, {});
  });
}

/** Scorecards the caller owes: interviews that started and their card is not in. */
function owed(ctx, cache) {
  const util = u();
  const app = ctx.app;
  if (!ctx.memberId) return [];
  const rows = util.rows(
    app,
    "SELECT f.id AS id, f.status AS status, i.id AS interview, i.at AS at, i.day AS day, i.start AS start, i.timezone AS timezone, i.title AS title, c.name AS candidate_name, c.id AS candidate, j.title AS opening_title FROM interview_feedback f JOIN interviews i ON i.id = f.interview JOIN candidates c ON c.id = i.candidate JOIN openings j ON j.id = i.opening WHERE f.interviewer = {:m} AND f.status != 'submitted' AND i.status IN ('scheduled', 'done') AND i.at <= {:now} ORDER BY i.at",
    { id: '', status: '', interview: '', at: '', day: '', start: '', timezone: '', title: '', candidate_name: '', candidate: '', opening_title: '' },
    { m: ctx.memberId, now: new Date().toISOString() },
  );
  return rows.map((r) => ({ scorecard: r.id, status: r.status, interview: r.interview, at: r.at, day: r.day, start: r.start, timezone: r.timezone, title: r.title, candidate: r.candidate, candidate_name: r.candidate_name, opening_title: r.opening_title }));
}

/* ----------------------------------------------------------------- ops */

function list(ctx, p) {
  const util = u();
  const app = ctx.app;
  const fromDay = util.day(p, 'from', util.dayAdd(util.today(app), -1));
  const toDay = util.day(p, 'to', util.dayAdd(fromDay, 14));
  if (toDay < fromDay) throw util.fail(400, 'to is before from.', 'invalid_param', { param: 'to' });
  if (util.daysBetween(fromDay, toDay) > 400) throw util.fail(400, 'At most about a year at once.', 'invalid_param', { param: 'to' });
  const o = {
    from: fromDay + 'T00:00:00.000Z',
    to: toDay + 'T23:59:59.999Z',
    status: util.oneOf(p, 'status', ['scheduled', 'done', 'cancelled', 'no_show', 'all'], 'all'),
    mine: util.bool(p, 'mine', false),
    limit: util.int(p, 'limit', 500, 1, 2000),
  };
  if (util.str(p, 'opening', '') !== '') o.opening = L('lib_hiring_jobs').needOpening(ctx, util.str(p, 'opening', ''), false).rec.id;
  if (util.str(p, 'application', '') !== '') o.application = L('lib_hiring_candidates').appRef(ctx, util.str(p, 'application', '')).id;
  const cache = {};
  const rows = visibleInterviews(ctx, o, cache);
  return { interviews: rows, from: fromDay, to: toDay, owed: owed(ctx, cache), calendar: calendarStatus(app) };
}

function get(ctx, p) {
  const x = needInterview(ctx, u().req(p, 'interview'), false);
  const cache = {};
  const v = interviewView(ctx, x.rec, x.access, cache, { full: true });
  const cand = ctx.app.findRecordById('candidates', x.rec.getString('candidate'));
  return { interview: v, candidate: L('lib_hiring_candidates').candView(ctx, cand, x.access) };
}

function readWhen(app, p, job, iv) {
  const util = u();
  const day = util.has(p, 'day') ? util.day(p, 'day', '') : iv ? iv.getString('day') : '';
  if (day === '') throw util.fail(400, 'day is required, e.g. --day 2026-11-12', 'missing_param', { param: 'day' });
  const start = util.has(p, 'start') ? util.str(p, 'start', '') : iv ? iv.getString('start') : '';
  if (!util.isTime(start)) throw util.fail(400, 'start is a time HH:MM, e.g. --start 14:30', 'invalid_param', { param: 'start' });
  let tz = util.has(p, 'timezone') ? util.str(p, 'timezone', '') : iv ? iv.getString('timezone') : '';
  if (tz === '') tz = util.zoneOf(app, job.getString('entity'));
  if (!util.isZone(tz)) throw util.fail(400, 'Unknown time zone ' + tz + '. Use one of: ' + Object.keys(util.ZONES).join(', '), 'invalid_timezone', { param: 'timezone' });
  return { day: day, start: start, timezone: tz };
}

/** Proposal preview of interviews.schedule: "Interview <round> with <candidate> for <role> on <when>". */
function previewSchedule(ctx, p) {
  const util = u();
  const app = ctx.app;
  const hh = h();
  let label = 'Schedule an interview';
  const fields0 = [];
  try {
    const a = L('lib_hiring_candidates').appRef(ctx, util.str(p, 'application', ''));
    const rec = a.rec || a;
    const cand = app.findRecordById('candidates', rec.getString('candidate'));
    const job = app.findRecordById('openings', rec.getString('opening'));
    const zone = util.str(p, 'timezone', '') || util.zoneOf(app, job.getString('entity'));
    const round = util.squash(util.str(p, 'title', '')) || 'Interview';
    label = round + ' with ' + cand.getString('name') + ' for ' + job.getString('number') + ' ' + job.getString('title');
    if (!util.has(p, 'timezone')) fields0.push({ name: 'timezone', before: '', after: zone });
  } catch {
    // checked by the dry run
  }
  const fields = Object.keys(p)
    .filter((k) => k !== 'why' && k !== 'application' && util.has(p, k) && hh.shownValue(p[k]) !== '')
    .map((k) => ({ name: k, before: '', after: hh.shownValue(p[k]) }))
    .concat(fields0);
  return { label: label, target: '', fields: fields, notes: [], risk: 'low' };
}

/** Proposal preview of interviews.update: what moves or changes, before and after. */
function previewUpdate(ctx, p) {
  const util = u();
  const app = ctx.app;
  const hh = h();
  const iv = util.byId(app, 'interviews', util.str(p, 'interview', ''));
  if (iv === null) return { label: 'Change an interview', target: '', fields: [], notes: [], risk: 'low' };
  const cand = util.byId(app, 'candidates', iv.getString('candidate'));
  const fields = [];
  for (const k of ['day', 'start', 'timezone', 'duration_min', 'kind', 'title', 'kit', 'location', 'link', 'note', 'interviewers']) {
    if (!util.has(p, k)) continue;
    const before = k === 'interviewers' ? hh.shownValue(util.jsonOf(iv, 'interviewers', [])) : hh.shownValue(iv.get(k));
    const after = hh.shownValue(p[k]);
    if (before !== after) fields.push({ name: k, before: before, after: after });
  }
  const moved = util.has(p, 'day') || util.has(p, 'start') || util.has(p, 'timezone');
  const who = cand !== null ? ' with ' + cand.getString('name') : '';
  const label = (moved ? 'Move ' : 'Change ') + iv.getString('title') + who;
  return { label: label, target: 'interviews:' + iv.id, fields: fields, notes: [], risk: 'low' };
}

function setWhen(iv, when, minutes) {
  const util = u();
  const ms = util.utcOf(when.timezone, when.day, when.start);
  iv.set('day', when.day);
  iv.set('start', when.start);
  iv.set('timezone', when.timezone);
  iv.set('at', new Date(ms).toISOString());
  iv.set('duration_min', minutes);
  iv.set('end_at', new Date(ms + minutes * 60000).toISOString());
}

/** Make sure each panel member has a scorecard row (removed members lose theirs unless it was submitted). */
function syncPanel(app, iv, ids) {
  const util = u();
  const existing = util.findMany(app, 'interview_feedback', 'interview = {:i}', '', 0, { i: iv.id });
  const added = [];
  for (const f of existing) {
    if (ids.indexOf(f.getString('interviewer')) >= 0) continue;
    if (f.getString('status') !== 'submitted') app.delete(f);
  }
  for (const id of ids) {
    if (existing.some((f) => f.getString('interviewer') === id)) continue;
    const f = util.newRecord(app, 'interview_feedback');
    f.set('interview', iv.id);
    f.set('application', iv.getString('application'));
    f.set('interviewer', id);
    f.set('status', 'pending');
    f.set('scores', {});
    app.save(f);
    added.push(id);
  }
  return added;
}

function schedule(ctx, p) {
  const util = u();
  const app = ctx.app;
  const hh = h();
  const cands = L('lib_hiring_candidates');
  const a = cands.appRef(ctx, util.req(p, 'application'));
  const job = app.findRecordById('openings', a.getString('opening'));
  const access = hh.needApp(ctx, a, true, job);
  if (a.getString('status') !== 'active') throw util.fail(409, 'This application is ' + a.getString('status') + '.', 'conflict');
  const cand = app.findRecordById('candidates', a.getString('candidate'));
  let kit = null;
  if (util.str(p, 'kit', '') !== '') {
    kit = util.byId(app, 'interview_kits', util.str(p, 'kit', ''));
    if (kit === null || (kit.getString('opening') !== '' && kit.getString('opening') !== job.id)) throw util.fail(400, 'No interview kit ' + util.str(p, 'kit', '') + ' for this opening. Run interview-kits.list --opening ' + job.getString('number'), 'invalid_param', { param: 'kit' });
  }
  const stageKey = util.str(p, 'stage', '') !== '' ? util.str(p, 'stage', '') : a.getString('stage');
  const st = hh.stageOf(job, stageKey);
  if (st === null) throw util.fail(400, 'No stage ' + stageKey + ' on this opening.', 'invalid_param', { param: 'stage' });
  if (kit === null && st.kit) kit = util.byId(app, 'interview_kits', st.kit);
  const ids = hh.memberIds(app, util.list(p, 'interviewers') || [], 'interviewers');
  if (ids.length === 0) throw util.fail(400, 'Give at least one interviewer, e.g. --interviewers \'["eng.lead@northwind.test"]\'', 'missing_param', { param: 'interviewers' });
  if (ids.length > 12) throw util.fail(400, 'At most 12 interviewers.', 'invalid_param', { param: 'interviewers' });
  const when = readWhen(app, p, job, null);
  const minutes = util.int(p, 'duration_min', kit !== null && kit.getInt('duration_min') > 0 ? kit.getInt('duration_min') : 45, 5, 600);
  const iv = util.newRecord(app, 'interviews');
  iv.set('application', a.id);
  iv.set('opening', job.id);
  iv.set('candidate', cand.id);
  iv.set('stage', st.key);
  iv.set('kind', util.oneOf(p, 'kind', KINDS, kit !== null && kit.getString('kind') !== '' ? kit.getString('kind') : 'video'));
  iv.set('title', util.text(p, 'title', 160, '') || (kit !== null ? kit.getString('name') : st.name));
  iv.set('kit', kit !== null ? kit.id : '');
  setWhen(iv, when, minutes);
  iv.set('interviewers', ids);
  iv.set('location', util.text(p, 'location', 300, ''));
  const link = util.text(p, 'link', 500, '');
  if (link !== '' && !/^https?:\/\/\S+$/i.test(link)) throw util.fail(400, 'link is a web address (https://...)', 'invalid_param', { param: 'link' });
  iv.set('link', link);
  iv.set('note', util.text(p, 'note', 4000, ''));
  iv.set('status', 'scheduled');
  iv.set('scheduled_by', ctx.memberId || '');
  app.save(iv);
  syncPanel(app, iv, ids);
  hh.event(ctx, { candidate: cand.id, application: a.id, kind: 'interview', text: iv.getString('title') + ' scheduled', ref: iv.id, day: when.day, start: when.start, zone: when.timezone });
  L('lib_notify').notify(app, ids.filter((x) => x !== ctx.memberId), { kind: 'hiring', title: 'Interview: ' + cand.getString('name') + ' for ' + job.getString('title'), body: iv.getString('title') + '. The time is on the interview page.', link: '#/hiring/interviews/' + iv.id });
  const warnings = [];
  const rule = hh.payRule(job.getString('country'), job.getString('region'), job.getString('remote'));
  if (rule !== null && rule.when === 'before_interview' && (job.getInt('salary_min_minor') <= 0 || job.getInt('salary_max_minor') <= 0)) warnings.push({ code: 'pay_range_missing', message: 'Tell the candidate the pay range before the interview: ' + rule.basis });
  let calendar = null;
  if (util.bool(p, 'calendar', false) && !ctx.isAgent) {
    const c2 = Object.assign({}, ctx, { inviteCandidate: util.bool(p, 'invite_candidate', true) });
    calendar = createEvent(c2, app.findRecordById('interviews', iv.id));
  }
  L('lib_audit').note(ctx, { collection: 'interviews', record: iv.id, summary: 'Scheduled ' + iv.getString('title') + ' with ' + cand.getString('name') + ' on ' + when.day + ' ' + when.start });
  return { interview: interviewView(ctx, app.findRecordById('interviews', iv.id), access, {}, { full: true }), calendar: calendar, warnings: warnings };
}

function update(ctx, p) {
  const util = u();
  const app = ctx.app;
  const hh = h();
  hh.needChange(p, 'interview');
  const x = needInterview(ctx, util.req(p, 'interview'), true);
  const iv = x.rec;
  if (iv.getString('status') === 'cancelled') throw util.fail(409, 'This interview was cancelled; schedule a new one.', 'conflict');
  const before = interviewView(ctx, iv, x.access, {}, {});
  const timeChange = util.has(p, 'day') || util.has(p, 'start') || util.has(p, 'timezone') || util.has(p, 'duration_min');
  if (timeChange) setWhen(iv, readWhen(app, p, x.job, iv), util.int(p, 'duration_min', iv.getInt('duration_min') || 45, 5, 600));
  if (util.has(p, 'kind')) iv.set('kind', util.oneOf(p, 'kind', KINDS, 'video'));
  if (util.has(p, 'title')) iv.set('title', util.text(p, 'title', 160, '') || iv.getString('title'));
  if (util.has(p, 'kit')) {
    const k = util.str(p, 'kit', '');
    if (k !== '') {
      const kit = util.byId(app, 'interview_kits', k);
      if (kit === null || (kit.getString('opening') !== '' && kit.getString('opening') !== x.job.id)) throw util.fail(400, 'No such interview kit for this opening.', 'invalid_param', { param: 'kit' });
    }
    iv.set('kit', k);
  }
  if (util.has(p, 'location')) iv.set('location', util.text(p, 'location', 300, ''));
  if (util.has(p, 'link')) {
    const link = util.text(p, 'link', 500, '');
    if (link !== '' && !/^https?:\/\/\S+$/i.test(link)) throw util.fail(400, 'link is a web address (https://...)', 'invalid_param', { param: 'link' });
    iv.set('link', link);
  }
  if (util.has(p, 'note')) iv.set('note', util.text(p, 'note', 4000, ''));
  let added = [];
  if (util.has(p, 'interviewers')) {
    const ids = hh.memberIds(app, util.list(p, 'interviewers') || [], 'interviewers');
    if (ids.length === 0) throw util.fail(400, 'Keep at least one interviewer.', 'invalid_param', { param: 'interviewers' });
    iv.set('interviewers', ids);
    app.save(iv);
    added = syncPanel(app, iv, ids);
  }
  app.save(iv);
  const cand = app.findRecordById('candidates', iv.getString('candidate'));
  if (timeChange) {
    hh.event(ctx, { candidate: cand.id, application: iv.getString('application'), kind: 'interview', text: iv.getString('title') + ' moved', ref: iv.id, day: iv.getString('day'), start: iv.getString('start'), zone: iv.getString('timezone') });
    const notifyIds = (util.jsonOf(iv, 'interviewers', []) || []).filter((id) => id !== ctx.memberId && added.indexOf(id) < 0);
    L('lib_notify').notify(app, notifyIds, { kind: 'hiring', title: 'Interview moved: ' + cand.getString('name'), body: iv.getString('title') + ' has a new time. It is on the interview page.', link: '#/hiring/interviews/' + iv.id });
  }
  if (added.length > 0) L('lib_notify').notify(app, added.filter((id) => id !== ctx.memberId), { kind: 'hiring', title: 'Interview: ' + cand.getString('name') + ' for ' + x.job.getString('title'), body: iv.getString('title') + '. The time is on the interview page.', link: '#/hiring/interviews/' + iv.id });
  const after = interviewView(ctx, iv, x.access, {}, { full: true });
  L('lib_audit').note(ctx, { collection: 'interviews', record: iv.id, summary: 'Changed the interview ' + iv.getString('title') + ' with ' + cand.getString('name'), before: before, after: after });
  return { interview: after, calendar_stale: timeChange && iv.getString('calendar_event') !== '' };
}

function cancel(ctx, p) {
  const util = u();
  const app = ctx.app;
  const hh = h();
  const x = needInterview(ctx, util.req(p, 'interview'), true);
  const iv = x.rec;
  if (iv.getString('status') === 'cancelled') return { interview: interviewView(ctx, iv, x.access, {}, { full: true }) };
  iv.set('status', 'cancelled');
  app.save(iv);
  for (const f of util.findMany(app, 'interview_feedback', "interview = {:i} && status != 'submitted'", '', 0, { i: iv.id })) app.delete(f);
  const cand = app.findRecordById('candidates', iv.getString('candidate'));
  const reason = util.text(p, 'reason', 400, '');
  hh.event(ctx, { candidate: cand.id, application: iv.getString('application'), kind: 'interview', text: 'Cancelled ' + iv.getString('title') + (reason !== '' ? ': ' + reason : ''), ref: iv.id });
  L('lib_notify').notify(app, (util.jsonOf(iv, 'interviewers', []) || []).filter((id) => id !== ctx.memberId), { kind: 'hiring', title: 'Interview cancelled: ' + cand.getString('name'), body: iv.getString('title') + ' was cancelled.', link: '#/hiring/candidates/' + cand.id });
  L('lib_audit').note(ctx, { collection: 'interviews', record: iv.id, summary: 'Cancelled the interview ' + iv.getString('title') + ' with ' + cand.getString('name') });
  return { interview: interviewView(ctx, iv, x.access, {}, { full: true }), calendar_event_left: iv.getString('calendar_event') !== '' };
}

/** Cancel the interviews still ahead of an application that closed; their unsubmitted scorecards go. */
function cancelOpenFor(ctx, applicationId, reason) {
  const util = u();
  const app = ctx.app;
  let n = 0;
  for (const iv of util.findMany(app, 'interviews', "application = {:a} && status = 'scheduled' && at >= {:now}", '', 0, { a: applicationId, now: new Date().toISOString() })) {
    iv.set('status', 'cancelled');
    iv.set('note', util.clip((iv.getString('note') !== '' ? iv.getString('note') + '\n' : '') + reason, 4000));
    app.save(iv);
    for (const f of util.findMany(app, 'interview_feedback', "interview = {:i} && status != 'submitted'", '', 0, { i: iv.id })) app.delete(f);
    n++;
  }
  return n;
}

function setStatus(ctx, p) {
  const util = u();
  const app = ctx.app;
  const x = needInterview(ctx, util.req(p, 'interview'), true);
  const iv = x.rec;
  const status = util.oneOf(p, 'status', ['scheduled', 'done', 'no_show'], '');
  if (status === '') throw util.fail(400, 'status is scheduled, done or no_show', 'missing_param', { param: 'status' });
  if (iv.getString('status') === 'cancelled') throw util.fail(409, 'This interview was cancelled.', 'conflict');
  const was = iv.getString('status');
  iv.set('status', status);
  app.save(iv);
  h().event(ctx, { candidate: iv.getString('candidate'), application: iv.getString('application'), kind: 'interview', text: iv.getString('title') + ': ' + (status === 'done' ? 'took place' : status === 'no_show' ? 'the candidate did not come' : 'scheduled again'), ref: iv.id });
  L('lib_audit').note(ctx, { collection: 'interviews', record: iv.id, summary: 'Interview ' + iv.getString('title') + ' marked ' + status, before: { status: was }, after: { status: status } });
  return { interview: interviewView(ctx, iv, x.access, {}, { full: true }) };
}

function calendarOp(ctx, p) {
  const util = u();
  const x = needInterview(ctx, util.req(p, 'interview'), true);
  if (x.rec.getString('status') !== 'scheduled') throw util.fail(409, 'Only a scheduled interview goes on the calendar.', 'conflict');
  const st = calendarStatus(ctx.app);
  if (!st.connected) throw util.fail(409, 'Google Calendar is not connected to your AI agent.', 'calendar_not_connected', st);
  const res = createEvent(Object.assign({}, ctx, { inviteCandidate: util.bool(p, 'invite_candidate', true) }), x.rec);
  if (!res.ok) throw util.fail(502, 'Google Calendar did not take the event: ' + res.error, 'calendar_failed');
  L('lib_audit').note(ctx, { collection: 'interviews', record: x.rec.id, summary: 'Added the interview ' + x.rec.getString('title') + ' to Google Calendar' });
  return { interview: interviewView(ctx, ctx.app.findRecordById('interviews', x.rec.id), x.access, {}, { full: true }), calendar: res };
}

function calendarStatusOp(ctx) {
  return { calendar: calendarStatus(ctx.app) };
}

/** Set the neutral summary of an interview's scorecards (your AI agent's is a proposal). */
function summary(ctx, p) {
  const util = u();
  const app = ctx.app;
  const x = needInterview(ctx, util.req(p, 'interview'), true);
  const iv = x.rec;
  const text = util.text(p, 'summary', 20000, '');
  if (util.squash(text) !== '' && util.count(app, "SELECT COUNT(*) AS n FROM interview_feedback WHERE interview = {:i} AND status = 'submitted'", { i: iv.id }) === 0) throw util.fail(409, 'No scorecard is in yet; a summary waits for them.', 'no_scorecards');
  const before = iv.getString('summary');
  iv.set('summary', text);
  iv.set('summary_at', text === '' ? '' : util.nowIso());
  iv.set('summary_actor', text === '' ? '' : ctx.isAgent ? 'agent' : 'person');
  app.save(iv);
  if (!ctx.isAgent) L('lib_agent').end(app, iv, 'interview_summary', 'closed', 'A person wrote the summary.');
  L('lib_audit').note(ctx, { collection: 'interviews', record: iv.id, summary: (text === '' ? 'Cleared' : 'Saved') + ' the summary of ' + iv.getString('title') + ' with ' + h().nameOf(app, 'candidates', iv.getString('candidate')), before: { summary: before }, after: { summary: text } });
  return { interview: interviewView(ctx, iv, x.access, {}, { full: true }) };
}

function previewSummary(ctx, p) {
  const util = u();
  const iv = ivRef(ctx, util.str(p, 'interview', ''));
  return { label: 'Summary of ' + iv.getString('title') + ' with ' + h().nameOf(ctx.app, 'candidates', iv.getString('candidate')), target: 'interviews:' + iv.id, fields: [{ name: 'summary', before: iv.getString('summary'), after: util.str(p, 'summary', '') }], notes: ['A neutral account of what the interviewers wrote; it does not recommend.'], risk: 'low' };
}

/** agent.retry on interview_summary: hiring edit rights on the interview, with a scorecard in. */
function mayAsk(ctx, iv) {
  needInterview(ctx, iv.id, true);
  if (u().count(ctx.app, "SELECT COUNT(*) AS n FROM interview_feedback WHERE interview = {:i} AND status = 'submitted'", { i: iv.id }) === 0) throw u().fail(409, 'No scorecard is in yet.', 'no_scorecards');
}

/** Ask your AI agent for a neutral summary of the submitted scorecards (interview_summary with the interview's id). */
function summarize(ctx, p) {
  const util = u();
  const app = ctx.app;
  const x = needInterview(ctx, util.req(p, 'interview'), true);
  const iv = x.rec;
  mayAsk(ctx, iv);
  const cand = h().nameOf(app, 'candidates', iv.getString('candidate'));
  const a = L('lib_agent').ask(ctx, iv, 'interview_summary', {});
  L('lib_audit').note(ctx, { collection: 'interviews', record: iv.id, summary: (a.asked ? 'Asked your AI agent to summarise the scorecards of ' : 'Your AI agent is already asked to summarise ') + iv.getString('title') + ' with ' + cand, after: { trigger: 'interview_summary', request: a.request } });
  return { asked: a.asked, agent: L('lib_agent').view(app.findRecordById('interviews', iv.id), 'interview_summary') };
}

/* ------------------------------------------------------------- scorecards */

function scorecardsMine(ctx, p) {
  const util = u();
  const app = ctx.app;
  if (!ctx.memberId) return { scorecards: [], owed: [] };
  const status = util.oneOf(p, 'status', ['owed', 'submitted', 'all'], 'all');
  const where = ['f.interviewer = {:m}', "i.status != 'cancelled'"];
  if (status === 'submitted') where.push("f.status = 'submitted'");
  if (status === 'owed') where.push("f.status != 'submitted'");
  const rows = util.rows(
    app,
    'SELECT f.id AS id, f.status AS status, f.recommendation AS recommendation, f.submitted_at AS submitted_at, i.id AS interview, i.title AS title, i.at AS at, i.day AS day, i.start AS start, i.timezone AS timezone, i.status AS interview_status, c.id AS candidate, c.name AS candidate_name, j.title AS opening_title FROM interview_feedback f JOIN interviews i ON i.id = f.interview JOIN candidates c ON c.id = i.candidate JOIN openings j ON j.id = i.opening WHERE ' + where.join(' AND ') + ' ORDER BY i.at DESC LIMIT ' + util.int(p, 'limit', 100, 1, 500),
    { id: '', status: '', recommendation: '', submitted_at: '', interview: '', title: '', at: '', day: '', start: '', timezone: '', interview_status: '', candidate: '', candidate_name: '', opening_title: '' },
    { m: ctx.memberId },
  );
  return { scorecards: rows.map((r) => Object.assign({}, r)), owed: owed(ctx, {}) };
}

/** The caller's scorecard for an interview, with the kit and the candidate's basics. */
function scorecardGet(ctx, p) {
  const util = u();
  const x = needInterview(ctx, util.req(p, 'interview'), false);
  const cache = {};
  const v = interviewView(ctx, x.rec, x.access, cache, { full: true });
  const cand = ctx.app.findRecordById('candidates', x.rec.getString('candidate'));
  if (v.scorecard.mine === null) throw util.fail(403, 'You are not on the panel of this interview.', 'not_on_panel');
  return { interview: v, scorecard: v.scorecard.mine, candidate: L('lib_hiring_candidates').candView(ctx, cand, x.access), scale: { min: SCORE_MIN, max: SCORE_MAX, labels: ['Not shown', 'Some', 'Good', 'Strong'] }, recommendations: h().RECOMMENDATIONS };
}

function scorecardSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  const hh = h();
  const x = needInterview(ctx, util.req(p, 'interview'), false);
  const iv = x.rec;
  if (!ctx.memberId) throw util.fail(403, 'Scorecards are written by the interviewers.', 'not_permitted');
  const f = util.findOne(app, 'interview_feedback', 'interview = {:i} && interviewer = {:m}', { i: iv.id, m: ctx.memberId });
  if (f === null) throw util.fail(403, 'You are not on the panel of this interview.', 'not_on_panel');
  if (iv.getString('status') === 'cancelled') throw util.fail(409, 'This interview was cancelled.', 'conflict');
  const before = scorecardView(app, f, {});
  const kit = iv.getString('kit') !== '' ? util.byId(app, 'interview_kits', iv.getString('kit')) : null;
  const keys = kit !== null ? (util.jsonOf(kit, 'criteria', []) || []).map((c) => c.key) : null;
  if (util.has(p, 'recommendation')) {
    const r = util.str(p, 'recommendation', '');
    if (r !== '' && hh.RECOMMENDATIONS.indexOf(r) < 0) throw util.fail(400, 'recommendation is one of ' + hh.RECOMMENDATIONS.join(', '), 'invalid_param', { param: 'recommendation' });
    f.set('recommendation', r);
  }
  if (util.has(p, 'scores')) {
    const raw = util.obj(p, 'scores') || {};
    const out = {};
    for (const k of Object.keys(raw)) {
      if (raw[k] === null || raw[k] === '') continue;
      if (keys !== null && keys.indexOf(k) < 0) throw util.fail(400, 'scores: "' + k + '" is not a criterion of this interview (' + keys.join(', ') + ').', 'invalid_param', { param: 'scores' });
      const n = Number(raw[k]);
      if (!Number.isInteger(n) || n < SCORE_MIN || n > SCORE_MAX) throw util.fail(400, 'scores: ' + k + ' is a whole number from ' + SCORE_MIN + ' to ' + SCORE_MAX + '.', 'invalid_param', { param: 'scores' });
      out[k] = n;
    }
    f.set('scores', out);
  }
  if (util.has(p, 'notes')) f.set('notes', util.text(p, 'notes', 20000, ''));
  const submit = util.bool(p, 'submit', false);
  const first = submit && f.getString('status') !== 'submitted';
  if (submit) {
    if (f.getString('recommendation') === '') throw util.fail(400, 'Choose a recommendation before you submit.', 'missing_param', { param: 'recommendation' });
    f.set('status', 'submitted');
    if (first) f.set('submitted_at', util.nowIso());
  } else if (f.getString('status') !== 'submitted') f.set('status', 'draft');
  app.save(f);
  if (first) {
    const cand = app.findRecordById('candidates', iv.getString('candidate'));
    hh.event(ctx, { candidate: cand.id, application: iv.getString('application'), kind: 'feedback', text: ctx.name + ' submitted a scorecard for ' + iv.getString('title'), ref: iv.id });
    const left = util.count(app, "SELECT COUNT(*) AS n FROM interview_feedback WHERE interview = {:i} AND status != 'submitted'", { i: iv.id });
    if (left === 0) {
      const who = [x.job.getString('owner'), x.job.getString('hiring_manager')].filter((id) => id !== '' && id !== ctx.memberId);
      L('lib_notify').notify(app, who, { kind: 'hiring', title: 'All scorecards are in: ' + cand.getString('name') + ' (' + iv.getString('title') + ')', body: '', link: '#/hiring/candidates/' + cand.id });
      if (iv.getString('status') === 'scheduled' && iv.getString('at') <= util.nowIso()) {
        iv.set('status', 'done');
        app.save(iv);
      }
    }
  }
  L('lib_audit').note(ctx, { collection: 'interview_feedback', record: f.id, summary: (first ? 'Submitted' : 'Saved') + ' a scorecard for ' + iv.getString('title') + ' with ' + hh.nameOf(app, 'candidates', iv.getString('candidate')), before: before, after: scorecardView(app, f, {}) });
  return { scorecard: scorecardView(app, f, {}), interview: interviewView(ctx, app.findRecordById('interviews', iv.id), x.access, {}, { full: true }) };
}

module.exports = {
  mayAsk: mayAsk,
  KINDS: KINDS,
  calendarStatus: calendarStatus,
  createEvent: createEvent,
  scorecardView: scorecardView,
  visibleScorecards: visibleScorecards,
  interviewView: interviewView,
  needInterview: needInterview,
  forApplication: forApplication,
  visibleInterviews: visibleInterviews,
  owed: owed,
  cancelOpenFor: cancelOpenFor,
  list: list,
  get: get,
  schedule: schedule,
  update: update,
  cancel: cancel,
  setStatus: setStatus,
  calendarOp: calendarOp,
  calendarStatusOp: calendarStatusOp,
  summary: summary,
  previewSummary: previewSummary,
  previewSchedule: previewSchedule,
  previewUpdate: previewUpdate,
  summarize: summarize,
  scorecardsMine: scorecardsMine,
  scorecardGet: scorecardGet,
  scorecardSave: scorecardSave,
};
