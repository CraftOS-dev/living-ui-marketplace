/// <reference path="../pb_data/types.d.ts" />
/**
 * Candidates and applications: people added by hand, from a CSV, from a
 * referral or by your AI agent from files it was given (one record per
 * email address), a protected resume, source, consent with its date and a
 * retention day by the entity's country; applications per opening that move
 * between the opening's stages, and close as rejected (with a reason and an
 * optional message from its template) or withdrawn. Moving, rejecting and
 * hiring are a person's decisions: the catalog denies them to your AI agent.
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

const RANK = { '': 0, interviewer: 1, team: 2, all: 3 };
const CSV_COLUMNS = ['name', 'email', 'phone', 'location', 'current_title', 'current_company', 'source', 'source_detail', 'links', 'tags', 'consent', 'notes'];
const MAX_BULK = 200;

/* --------------------------------------------------------------- access */

/** 'all' | 'team' | 'interviewer' | '' for a candidate (the best over their applications). */
function candAccess(ctx, c) {
  const util = u();
  const hh = h();
  if (ctx.isAgent || ctx.actor === 'system') return 'all';
  const apps = util.findMany(ctx.app, 'applications', 'candidate = {:c}', '', 0, { c: c.id });
  if (hh.broad(ctx)) {
    const sc = L('lib_auth').scope(ctx);
    if (sc.length === 0 || apps.length === 0) return 'all';
  }
  let best = '';
  for (const a of apps) {
    const job = util.byId(ctx.app, 'openings', a.getString('opening'));
    if (job === null) continue;
    const x = hh.appAccess(ctx, a, job);
    if (RANK[x] > RANK[best]) best = x;
    if (best === 'all') break;
  }
  return best;
}

function candRef(ctx, ref) {
  const util = u();
  const s = String(ref || '').trim();
  if (s === '') throw util.fail(400, 'Give the candidate id or email.', 'missing_param', { param: 'candidate' });
  const c = util.byId(ctx.app, 'candidates', s) || (s.indexOf('@') > 0 ? util.findOne(ctx.app, 'candidates', 'email = {:e}', { e: s.toLowerCase() }) : null);
  if (c === null) throw util.fail(404, 'No candidate ' + s + '. Run candidates.list.', 'not_found');
  return c;
}

function needCand(ctx, ref, write) {
  const util = u();
  const c = candRef(ctx, ref);
  const a = candAccess(ctx, c);
  if (a === '') throw util.fail(404, 'No candidate ' + ref + ' that you can see.', 'not_found');
  if (write && !h().writable(ctx, a)) throw util.fail(403, 'Your role can look at this candidate but not change them.', 'not_permitted');
  return { rec: c, access: a };
}

function appRef(ctx, ref) {
  const util = u();
  const a = util.byId(ctx.app, 'applications', String(ref || '').trim());
  if (a === null) throw util.fail(404, 'No application ' + ref + '. Run applications.list.', 'not_found');
  return a;
}

/* ---------------------------------------------------------------- views */

function linksOf(c) {
  return (u().jsonOf(c, 'links', []) || []).map((l) => (typeof l === 'string' ? { label: '', url: l } : { label: String(l.label || ''), url: String(l.url || '') }));
}

function candView(ctx, c, access) {
  const util = u();
  const app = ctx.app;
  const hh = h();
  const today = util.today(app);
  const v = {
    id: c.id,
    name: c.getString('name'),
    location: c.getString('location'),
    current_title: c.getString('current_title'),
    current_company: c.getString('current_company'),
    links: linksOf(c),
    tags: util.jsonOf(c, 'tags', []) || [],
    has_resume: c.getString('resume') !== '',
    resume_name: c.getString('resume_name'),
    employee: c.getString('employee'),
    employee_number: c.getString('employee') !== '' ? hh.nameOf(app, 'employees', c.getString('employee'), 'number') : '',
    access: access,
    created: c.getString('created'),
  };
  if (access === 'all' || access === 'team') {
    v.email = c.getString('email');
    v.phone = c.getString('phone');
    v.source = c.getString('source');
    v.source_detail = c.getString('source_detail');
    v.consent = c.getBool('consent');
    v.consent_at = c.getString('consent_at');
    v.country = c.getString('country');
    v.retain_until = c.getString('retain_until');
    v.past_retention = c.getString('retain_until') !== '' && c.getString('retain_until') < today;
    v.notes = c.getString('notes');
    v.owner = c.getString('owner');
    v.owner_name = hh.memberName(app, c.getString('owner'));
    v.created_actor = c.getString('created_actor');
  }
  return v;
}

function appView(ctx, a, job, access) {
  const hh = h();
  const app = ctx.app;
  const st = hh.stageOf(job, a.getString('stage'));
  const cache = {};
  return {
    id: a.id,
    opening: job.id,
    opening_number: job.getString('number'),
    opening_title: job.getString('title'),
    opening_status: job.getString('status'),
    entity: job.getString('entity'),
    candidate: a.getString('candidate'),
    candidate_name: hh.nameOf(app, 'candidates', a.getString('candidate')),
    stage: a.getString('stage'),
    stage_name: st ? st.name : a.getString('stage'),
    stage_kind: st ? st.kind : '',
    stage_since: a.getString('stage_since'),
    stages: hh.stagesOf(job).map((s) => ({ key: s.key, name: s.name, kind: s.kind })),
    status: a.getString('status'),
    rejected_reason: a.getString('rejected_reason'),
    rejected_reason_name: hh.nameOf(app, 'rejection_reasons', a.getString('rejected_reason')),
    closed_note: access === 'all' || access === 'team' ? a.getString('closed_note') : '',
    closed_at: a.getString('closed_at'),
    closed_by_name: hh.memberName(app, a.getString('closed_by'), cache),
    owner: a.getString('owner'),
    owner_name: hh.memberName(app, a.getString('owner'), cache),
    applied_at: a.getString('applied_at'),
    source: a.getString('source'),
    referral: a.getString('referral'),
    hired_employment: a.getString('hired_employment'),
    hired_at: a.getString('hired_at'),
    access: access,
    can: { move: hh.writable(ctx, access) && hh.agentMay(ctx, 'applications.move') && a.getString('status') === 'active', reopen: hh.writable(ctx, access) && hh.agentMay(ctx, 'applications.reopen') && ['rejected', 'withdrawn'].indexOf(a.getString('status')) >= 0 },
  };
}

/* ------------------------------------------------------------- helpers */

function checkEmail(email) {
  const util = u();
  if (email === '') return '';
  const e = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 160) throw util.fail(400, 'Enter a valid email address (got "' + email + '").', 'invalid_email', { param: 'email' });
  return e;
}

function readLinks(raw) {
  const util = u();
  const out = [];
  for (const l of raw || []) {
    const url = typeof l === 'string' ? l.trim() : String((l && l.url) || '').trim();
    if (url === '') continue;
    if (!/^https?:\/\/\S+$/i.test(url) || url.length > 500) throw util.fail(400, 'links: "' + url + '" is not a web address (https://...).', 'invalid_param', { param: 'links' });
    out.push({ label: typeof l === 'string' ? '' : util.clip(String(l.label || ''), 60), url: url });
  }
  if (out.length > 10) throw util.fail(400, 'At most 10 links.', 'invalid_param', { param: 'links' });
  return out;
}

function readTags(raw) {
  const util = u();
  const out = [];
  for (const t of raw || []) {
    const s = util.clip(util.squash(t), 40);
    if (s !== '' && out.indexOf(s) < 0) out.push(s);
  }
  if (out.length > 20) throw util.fail(400, 'At most 20 tags.', 'invalid_param', { param: 'tags' });
  return out;
}

/** Fill a candidate record from params (add and update). */
function fillCandidate(ctx, c, p, isNew) {
  const util = u();
  const hh = h();
  if (isNew || util.has(p, 'name')) {
    const n = util.squash(util.text(p, 'name', 160, ''));
    if (n === '') throw util.fail(400, 'name is required, e.g. --name "Jane Doe"', 'missing_param', { param: 'name' });
    c.set('name', n);
  }
  if (util.has(p, 'email')) {
    const e = checkEmail(util.str(p, 'email', ''));
    if (e !== '') {
      const other = util.findOne(ctx.app, 'candidates', 'email = {:e} && id != {:id}', { e: e, id: c.id || '-' });
      if (other !== null) throw util.fail(409, other.getString('name') + ' already has this email (' + e + ').', 'duplicate_candidate', { candidate: other.id, name: other.getString('name') });
    }
    c.set('email', e);
  }
  for (const k of ['phone', 'location', 'current_title', 'current_company', 'source_detail']) if (util.has(p, k)) c.set(k, util.text(p, k, k === 'phone' ? 60 : 160, ''));
  if (util.has(p, 'source')) c.set('source', util.oneOf(p, 'source', hh.SOURCES, 'other'));
  else if (isNew) c.set('source', ctx.isAgent ? 'import' : 'sourced');
  if (util.has(p, 'links')) c.set('links', readLinks(util.list(p, 'links')));
  else if (isNew) c.set('links', []);
  if (util.has(p, 'tags')) c.set('tags', readTags(util.list(p, 'tags')));
  else if (isNew) c.set('tags', []);
  if (util.has(p, 'notes')) c.set('notes', util.text(p, 'notes', 8000, ''));
  if (util.has(p, 'consent')) {
    const yes = util.bool(p, 'consent', false);
    if (yes !== c.getBool('consent') || (yes && c.getString('consent_at') === '')) c.set('consent_at', yes ? util.str(p, 'consent_at', '') || util.nowIso() : '');
    c.set('consent', yes);
  }
  if (util.has(p, 'owner')) c.set('owner', util.str(p, 'owner', '') === '' ? '' : hh.memberIds(ctx.app, [util.str(p, 'owner', '')], 'owner')[0]);
  if (util.has(p, 'country')) {
    const cc = util.str(p, 'country', '').toUpperCase();
    if (cc !== '' && !/^[A-Z]{2}$/.test(cc)) throw util.fail(400, 'country is a two-letter code', 'invalid_param', { param: 'country' });
    c.set('country', cc);
  }
}

/**
 * Put a candidate on an opening (first stage unless a person names one).
 * Returns the application record. Refuses a second application to the
 * same opening and closed openings.
 */
function addApplication(ctx, cand, job, o) {
  const util = u();
  const hh = h();
  const app = ctx.app;
  const opt = o || {};
  if (['draft', 'open', 'on_hold'].indexOf(job.getString('status')) < 0) throw util.fail(409, 'Opening ' + job.getString('number') + ' is closed.', 'opening_closed');
  const dup = util.findOne(app, 'applications', 'opening = {:j} && candidate = {:c}', { j: job.id, c: cand.id });
  if (dup !== null) throw util.fail(409, cand.getString('name') + ' is already on ' + job.getString('number') + ' ' + job.getString('title') + ' (' + dup.getString('status') + ').', 'already_applied', { application: dup.id });
  let stage = hh.firstStage(job);
  if (opt.stage && !ctx.isAgent) {
    stage = hh.stagesOf(job).filter((s) => s.key === opt.stage || s.name.toLowerCase() === String(opt.stage).toLowerCase())[0] || null;
    if (stage === null) throw util.fail(400, 'No stage "' + opt.stage + '" on this opening. Stages: ' + hh.stagesOf(job).map((s) => s.key).join(', '), 'invalid_param', { param: 'stage' });
    if (stage.kind === 'hired') throw util.fail(400, 'A candidate reaches the hired stage when they are hired.', 'invalid_param', { param: 'stage' });
  }
  const a = util.newRecord(app, 'applications');
  a.set('opening', job.id);
  a.set('candidate', cand.id);
  a.set('stage', stage ? stage.key : '');
  a.set('stage_since', util.nowIso());
  a.set('status', 'active');
  a.set('applied_at', opt.applied_at || util.today(app, job.getString('entity')));
  a.set('source', opt.source || cand.getString('source'));
  a.set('owner', opt.owner || job.getString('owner') || ctx.memberId || '');
  if (opt.referral) a.set('referral', opt.referral);
  app.save(a);
  hh.event(ctx, { candidate: cand.id, application: a.id, kind: 'applied', to: a.getString('stage'), text: 'Added to ' + job.getString('number') + ' ' + job.getString('title') });
  hh.refreshRetention(app, cand.id);
  return a;
}

function stageFor(job, ref) {
  const hh = h();
  const s = String(ref || '').trim();
  return hh.stagesOf(job).filter((x) => x.key === s || x.name.toLowerCase() === s.toLowerCase())[0] || null;
}

/** The applications a bulk op names (--application or --applications), each checked for write access. */
function appsParam(ctx, p) {
  const util = u();
  const ids = [];
  if (util.str(p, 'application', '') !== '') ids.push(util.str(p, 'application', ''));
  for (const x of util.list(p, 'applications') || []) if (ids.indexOf(String(x)) < 0) ids.push(String(x));
  if (ids.length === 0) throw util.fail(400, 'Give --application <id> or --applications \'["id1","id2"]\'.', 'missing_param', { param: 'application' });
  if (ids.length > MAX_BULK) throw util.fail(400, 'At most ' + MAX_BULK + ' applications at once.', 'too_many');
  return ids.map((id) => {
    const a = appRef(ctx, id);
    const job = ctx.app.findRecordById('openings', a.getString('opening'));
    h().needApp(ctx, a, true, job);
    return { app: a, job: job };
  });
}

function messageVars(ctx, cand, job) {
  return { candidate_name: cand.getString('name'), job_title: job.getString('title'), company: h().companyName(ctx.app), sender_name: ctx.isAgent ? h().companyName(ctx.app) : ctx.name };
}

/** Write a message to a candidate on the timeline; queue it as an email when emailing is on and asked for. */
function queueMessage(ctx, cand, a, job, subject, body, send) {
  const hh = h();
  const vars = messageVars(ctx, cand, job);
  const s = hh.render(subject, vars);
  const b = hh.render(body, vars);
  const email = cand.getString('email');
  const can = send && email !== '' && hh.cfg(ctx.app).getBool('email_candidates');
  hh.event(ctx, { candidate: cand.id, application: a ? a.id : '', kind: 'message', subject: s, text: b, delivery: can ? 'pending' : 'none', to_email: can ? email : '' });
  return can ? 'queued' : email === '' ? 'no_email' : send ? 'email_off' : 'logged';
}

/* ------------------------------------------------------------ candidates */

function list(ctx, p) {
  const util = u();
  const app = ctx.app;
  const hh = h();
  if (hh.level(ctx) === 'none') return { candidates: [], total: 0 };
  const where = ['1 = 1'];
  const bind = {};
  const view = util.oneOf(p, 'view', ['all', 'active', 'pool', 'hired', 'retention', 'mine'], 'all');
  if (!hh.broad(ctx) || L('lib_auth').scope(ctx).length > 0) {
    const jb = {};
    const jw = hh.jobWhere(ctx, jb, 'jj');
    Object.assign(bind, jb);
    const pool = hh.broad(ctx) ? ' OR NOT EXISTS (SELECT 1 FROM applications ap WHERE ap.candidate = c.id)' : '';
    where.push('(EXISTS (SELECT 1 FROM applications aa JOIN openings jj ON jj.id = aa.opening WHERE aa.candidate = c.id AND ' + jw + ')' + pool + ')');
  }
  if (view === 'active') where.push("EXISTS (SELECT 1 FROM applications a1 WHERE a1.candidate = c.id AND a1.status = 'active')");
  else if (view === 'pool') where.push("NOT EXISTS (SELECT 1 FROM applications a1 WHERE a1.candidate = c.id AND a1.status IN ('active', 'hired'))");
  else if (view === 'hired') where.push("EXISTS (SELECT 1 FROM applications a1 WHERE a1.candidate = c.id AND a1.status = 'hired')");
  else if (view === 'retention') {
    where.push("c.retain_until != '' AND c.retain_until < {:today} AND NOT EXISTS (SELECT 1 FROM applications a1 WHERE a1.candidate = c.id AND a1.status IN ('active', 'hired'))");
    bind.today = util.today(app);
  } else if (view === 'mine') {
    where.push('c.owner = {:me}');
    bind.me = ctx.memberId || '-';
  }
  const opening = util.str(p, 'opening', '');
  if (opening !== '') {
    const job = L('lib_hiring_jobs').openingRef(ctx, opening);
    where.push('EXISTS (SELECT 1 FROM applications a2 WHERE a2.candidate = c.id AND a2.opening = {:op})');
    bind.op = job.id;
  }
  const source = util.str(p, 'source', '');
  if (source !== '') {
    where.push('c.source = {:src}');
    bind.src = source;
  }
  const tag = util.squash(util.str(p, 'tag', ''));
  if (tag !== '') {
    where.push("c.tags LIKE {:tag} ESCAPE '\\'");
    bind.tag = util.like('"' + tag + '"');
  }
  const q = util.squash(util.str(p, 'q', ''));
  if (q !== '') {
    where.push("(c.name LIKE {:q} ESCAPE '\\' OR c.email LIKE {:q} ESCAPE '\\' OR c.current_title LIKE {:q} ESCAPE '\\' OR c.current_company LIKE {:q} ESCAPE '\\' OR c.tags LIKE {:q} ESCAPE '\\')");
    bind.q = util.like(q);
  }
  const email = util.str(p, 'email', '');
  if (email !== '') {
    where.push('c.email = {:em}');
    bind.em = email.toLowerCase();
  }
  const sort = util.oneOf(p, 'sort', ['recent', 'name', 'retention'], view === 'retention' ? 'retention' : 'recent');
  const order = sort === 'name' ? 'c.name' : sort === 'retention' ? 'c.retain_until' : 'c.updated DESC';
  const pg = util.page(p, 50, 500);
  const w = where.join(' AND ');
  const total = util.count(app, 'SELECT COUNT(*) AS n FROM candidates c WHERE ' + w, bind);
  const ids = util.rows(app, 'SELECT c.id AS id FROM candidates c WHERE ' + w + ' ORDER BY ' + order + ' LIMIT ' + pg.limit + ' OFFSET ' + pg.offset, { id: '' }, bind);
  const out = ids.map((x) => {
    const c = app.findRecordById('candidates', x.id);
    const access = candAccess(ctx, c);
    const v = candView(ctx, c, access === '' ? 'interviewer' : access);
    v.applications = util
      .rows(app, "SELECT a.id AS id, a.status AS status, a.stage AS stage, j.id AS opening, j.number AS number, j.title AS title, j.stages AS stages FROM applications a JOIN openings j ON j.id = a.opening WHERE a.candidate = {:c} ORDER BY a.created DESC LIMIT 10", { id: '', status: '', stage: '', opening: '', number: '', title: '', stages: '' }, { c: c.id })
      .map((r) => {
        let stages = [];
        try {
          stages = JSON.parse(r.stages || '[]') || [];
        } catch {
          stages = [];
        }
        const st = stages.filter((s) => s.key === r.stage)[0];
        return { id: r.id, status: r.status, stage: r.stage, stage_name: st ? st.name : r.stage, opening: r.opening, opening_number: r.number, opening_title: r.title };
      });
    return v;
  });
  return { candidates: out, total: total, view: view, today: util.today(app), can: { add: hh.atLeast(ctx, 'edit') && hh.agentMay(ctx, 'candidates.add'), delete: hh.isFull(ctx) && hh.agentMay(ctx, 'candidates.delete'), export: hh.isFull(ctx) && hh.agentMay(ctx, 'candidates.export') } };
}

function get(ctx, p) {
  const util = u();
  const app = ctx.app;
  const hh = h();
  const x = needCand(ctx, util.req(p, 'candidate'), false);
  const c = x.rec;
  const cache = {};
  const ivs = L('lib_hiring_interviews');
  const offers = L('lib_hiring_offers');
  const applications = [];
  for (const a of util.findMany(app, 'applications', 'candidate = {:c}', '-created', 0, { c: c.id })) {
    const job = util.byId(app, 'openings', a.getString('opening'));
    if (job === null) continue;
    const acc = hh.appAccess(ctx, a, job);
    if (acc === '') continue;
    const v = appView(ctx, a, job, acc);
    v.interviews = ivs.forApplication(ctx, a.id, acc, cache);
    v.offers = acc === 'interviewer' ? [] : offers.forApplication(ctx, a.id, acc);
    applications.push(v);
  }
  const full = x.access === 'all' || x.access === 'team';
  const visibleApps = applications.map((a) => a.id);
  const timeline = full
    ? util
        .findMany(app, 'hiring_events', 'candidate = {:c}', '-created', 300, { c: c.id })
        .filter((e) => e.getString('application') === '' || visibleApps.indexOf(e.getString('application')) >= 0)
        .map((e) => hh.eventView(app, e, cache))
    : [];
  const referral = util.findOne(app, 'referrals', 'candidate = {:c}', { c: c.id });
  return {
    candidate: candView(ctx, c, x.access),
    applications: applications,
    timeline: timeline,
    referral: referral !== null && full ? { id: referral.id, referrer_name: referral.getString('referrer') !== '' ? L('lib_people').displayName(util.byId(app, 'employees', referral.getString('referrer'))) : hh.memberName(app, referral.getString('referrer_member'), cache), relationship: referral.getString('relationship'), note: referral.getString('note'), created: referral.getString('created') } : null,
    can: { edit: hh.writable(ctx, x.access) && hh.agentMay(ctx, 'candidates.update'), delete: hh.isFull(ctx) && hh.agentMay(ctx, 'candidates.delete'), add_to_opening: hh.atLeast(ctx, 'edit') && full && hh.agentMay(ctx, 'applications.add'), note: full && hh.agentMay(ctx, 'candidates.note') },
  };
}

/** Is an email already on a candidate? (the add form checks as you type). */
function check(ctx, p) {
  const util = u();
  const e = checkEmail(util.str(p, 'email', ''));
  if (e === '') return { exists: false };
  const c = util.findOne(ctx.app, 'candidates', 'email = {:e}', { e: e });
  if (c === null) return { exists: false };
  const acc = candAccess(ctx, c);
  return { exists: true, candidate: acc === '' ? null : { id: c.id, name: c.getString('name') }, visible: acc !== '' };
}

function add(ctx, p) {
  const util = u();
  const app = ctx.app;
  const hh = h();
  const c = util.newRecord(app, 'candidates');
  fillCandidate(ctx, c, p, true);
  c.set('created_actor', ctx.isAgent ? 'agent' : ctx.actor === 'person' ? 'person' : 'system');
  if (c.getString('owner') === '' && !ctx.isAgent) c.set('owner', ctx.memberId || '');
  let job = null;
  if (util.str(p, 'opening', '') !== '') {
    const x = L('lib_hiring_jobs').needOpening(ctx, util.str(p, 'opening', ''), true);
    job = x.rec;
    if (c.getString('country') === '') c.set('country', hh.nameOf(app, 'entities', job.getString('entity'), 'country'));
  }
  app.save(c);
  hh.event(ctx, { candidate: c.id, kind: 'imported', text: 'New candidate' + (util.str(p, 'source_detail', '') !== '' ? ' from ' + util.str(p, 'source_detail', '') : '') });
  let application = null;
  if (job !== null) application = addApplication(ctx, c, job, { stage: util.str(p, 'stage', ''), source: c.getString('source') });
  hh.refreshRetention(app, c.id);
  const fresh = app.findRecordById('candidates', c.id);
  L('lib_audit').note(ctx, { collection: 'candidates', record: c.id, summary: 'Added candidate ' + c.getString('name') + (job !== null ? ' to ' + job.getString('number') + ' ' + job.getString('title') : '') });
  return { candidate: candView(ctx, fresh, 'all'), application: application !== null ? appView(ctx, application, job, 'all') : null };
}

function update(ctx, p) {
  const util = u();
  const app = ctx.app;
  const hh = h();
  const x = needCand(ctx, util.req(p, 'candidate'), true);
  const c = x.rec;
  const before = candView(ctx, c, 'all');
  fillCandidate(ctx, c, p, false);
  app.save(c);
  if (util.has(p, 'consent') || util.has(p, 'country')) hh.refreshRetention(app, c.id);
  const fresh = app.findRecordById('candidates', c.id);
  const after = candView(ctx, fresh, 'all');
  const changed = ['name', 'email', 'phone', 'location', 'current_title', 'current_company', 'source', 'source_detail', 'links', 'tags', 'consent', 'notes', 'owner_name', 'country'].filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  if (changed.length > 0) hh.event(ctx, { candidate: c.id, kind: 'edited', text: 'Changed ' + changed.join(', ') });
  L('lib_audit').note(ctx, { collection: 'candidates', record: c.id, summary: 'Changed candidate ' + c.getString('name') + (changed.length > 0 ? ' (' + changed.join(', ') + ')' : ''), before: before, after: after });
  return { candidate: candView(ctx, fresh, x.access) };
}

function note(ctx, p) {
  const util = u();
  const hh = h();
  const x = needCand(ctx, util.req(p, 'candidate'), false);
  if (x.access !== 'all' && x.access !== 'team') throw util.fail(403, 'Interviewers write in their scorecard; notes are for the hiring team.', 'not_permitted');
  const text = util.text(p, 'text', 8000, '');
  if (util.squash(text) === '') throw util.fail(400, 'text is required', 'missing_param', { param: 'text' });
  let appId = util.str(p, 'application', '');
  if (appId !== '') {
    const a = appRef(ctx, appId);
    if (a.getString('candidate') !== x.rec.id) throw util.fail(400, 'That application belongs to another candidate.', 'invalid_param', { param: 'application' });
    appId = a.id;
  }
  const ev = hh.event(ctx, { candidate: x.rec.id, application: appId, kind: 'note', text: text });
  L('lib_audit').note(ctx, { collection: 'candidates', record: x.rec.id, summary: 'Note on ' + x.rec.getString('name') });
  return { event: hh.eventView(ctx.app, ev, {}) };
}

function resume(ctx, p) {
  const util = u();
  const x = needCand(ctx, util.req(p, 'candidate'), false);
  if (x.rec.getString('resume') === '') throw util.fail(404, x.rec.getString('name') + ' has no resume yet.', 'not_found');
  return L('lib_files').serve(ctx, x.rec, 'resume', x.rec.getString('resume_name') || x.rec.getString('name') + ' resume', util.bool(p, 'download', false));
}

function resumeSet(ctx, p) {
  const util = u();
  const app = ctx.app;
  const x = needCand(ctx, util.req(p, 'candidate'), true);
  const c = x.rec;
  if (util.bool(p, 'clear', false)) {
    c.set('resume', null);
    c.set('resume_name', '');
    app.save(c);
    h().event(ctx, { candidate: c.id, kind: 'edited', text: 'Removed the resume' });
    return { candidate: candView(ctx, app.findRecordById('candidates', c.id), x.access) };
  }
  const f = L('lib_files').fileParam(ctx, p, 'resume', 'path');
  if (f === null) throw util.fail(400, 'Upload the resume (field "resume"), or your AI agent gives --path.', 'missing_param', { param: 'resume' });
  let original = '';
  try {
    original = String(f.originalName || f.name || '');
  } catch {
    original = '';
  }
  c.set('resume', f);
  c.set('resume_name', util.clip(original.split(/[\\/]/).pop() || 'resume', 200));
  app.save(c);
  h().event(ctx, { candidate: c.id, kind: 'edited', text: 'Added a resume (' + c.getString('resume_name') + ')' });
  L('lib_audit').note(ctx, { collection: 'candidates', record: c.id, summary: 'Resume for ' + c.getString('name') });
  return { candidate: candView(ctx, app.findRecordById('candidates', c.id), x.access) };
}

/** Delete candidates a person chose (retention review or a wrong entry); never one who was hired. */
function remove(ctx, p) {
  const util = u();
  const app = ctx.app;
  const ids = [];
  if (util.str(p, 'candidate', '') !== '') ids.push(util.str(p, 'candidate', ''));
  for (const x of util.list(p, 'candidates') || []) if (ids.indexOf(String(x)) < 0) ids.push(String(x));
  if (ids.length === 0) throw util.fail(400, 'Give --candidate <id> or --candidates \'["id1","id2"]\'.', 'missing_param', { param: 'candidate' });
  if (ids.length > 500) throw util.fail(400, 'At most 500 at once.', 'too_many');
  const deleted = [];
  const kept = [];
  for (const id of ids) {
    const x = needCand(ctx, id, true);
    const c = x.rec;
    const hired = util.count(app, "SELECT COUNT(*) AS n FROM applications WHERE candidate = {:c} AND status = 'hired'", { c: c.id });
    const accepted = util.count(app, "SELECT COUNT(*) AS n FROM offers WHERE candidate = {:c} AND status = 'accepted'", { c: c.id });
    if (hired > 0 || accepted > 0) {
      kept.push({ candidate: c.id, name: c.getString('name'), reason: 'hired or accepted an offer; their record is part of the hire' });
      continue;
    }
    const name = c.getString('name');
    app.runInTransaction((tx) => {
      for (const r of u().findMany(tx, 'referrals', 'candidate = {:c}', '', 0, { c: c.id })) tx.delete(r);
      tx.delete(tx.findRecordById('candidates', c.id));
    });
    deleted.push({ candidate: c.id, name: name });
  }
  L('lib_audit').note(ctx, { collection: 'candidates', record: deleted.length === 1 ? deleted[0].candidate : '', summary: 'Deleted ' + deleted.length + ' candidate' + (deleted.length === 1 ? ' (' + deleted[0].name + ')' : 's') + ' with their applications, interviews and scorecards', after: { deleted: deleted.map((d) => d.candidate), kept: kept.map((k) => k.candidate) } });
  return { deleted: deleted, kept: kept };
}

function exportCsv(ctx, p) {
  const util = u();
  const app = ctx.app;
  const res = list(ctx, { view: util.str(p, 'view', 'all'), opening: util.str(p, 'opening', ''), limit: 500, offset: 0 });
  const rows = [['name', 'email', 'phone', 'location', 'current_title', 'current_company', 'source', 'source_detail', 'tags', 'consent', 'consent_at', 'retain_until', 'openings']];
  let offset = 0;
  let batch = res.candidates;
  let total = res.total;
  while (batch.length > 0) {
    for (const c of batch) rows.push([c.name, c.email || '', c.phone || '', c.location, c.current_title, c.current_company, c.source || '', c.source_detail || '', (c.tags || []).join(';'), c.consent ? 'yes' : 'no', c.consent_at || '', c.retain_until || '', (c.applications || []).map((a) => a.opening_number + ' ' + a.stage_name + ' (' + a.status + ')').join('; ')]);
    offset += batch.length;
    if (offset >= total) break;
    const next = list(ctx, { view: util.str(p, 'view', 'all'), opening: util.str(p, 'opening', ''), limit: 500, offset: offset });
    batch = next.candidates;
    total = next.total;
  }
  L('lib_audit').note(ctx, { collection: 'candidates', summary: 'Exported ' + (rows.length - 1) + ' candidates to CSV' });
  return { filename: 'candidates-' + util.today(app) + '.csv', rows: rows.length - 1, csv: util.csvText(rows) };
}

/**
 * CSV import (name required; email, phone, location, current_title,
 * current_company, source, source_detail, links and tags separated by ";",
 * consent yes or no, notes). An existing email is never duplicated: with
 * --opening that person is added to the opening instead. --dry_run reports
 * and changes nothing.
 */
function importCsv(ctx, p) {
  const util = u();
  const app = ctx.app;
  const hh = h();
  const text = L('lib_files').csvInput(ctx, p, 'file', 'csv');
  const parsed = util.csvObjects(text);
  if (parsed.items.length === 0) throw util.fail(400, 'The CSV has no rows under its header (name, email, ...).', 'empty_csv');
  if (parsed.items.length > 2000) throw util.fail(400, 'At most 2000 rows in one import.', 'too_many');
  if (parsed.header.indexOf('name') < 0) throw util.fail(400, 'The CSV needs a "name" column. Columns: ' + CSV_COLUMNS.join(', '), 'missing_column', { column: 'name' });
  const ignored = parsed.header.filter((x) => CSV_COLUMNS.indexOf(x) < 0);
  const dry = util.bool(p, 'dry_run', false);
  let job = null;
  if (util.str(p, 'opening', '') !== '') job = L('lib_hiring_jobs').needOpening(ctx, util.str(p, 'opening', ''), true).rec;
  const defaultSource = util.oneOf(p, 'source', hh.SOURCES, 'import');
  const report = [];
  const seen = {};
  let added = 0;
  let attached = 0;
  parsed.items.forEach((row, i) => {
    const n = i + 2;
    try {
      const name = util.squash(row.name);
      if (name === '') throw util.fail(400, 'name is empty', 'invalid');
      const email = checkEmail(row.email || '');
      if (email !== '' && seen[email]) throw util.fail(400, 'the same email is on row ' + seen[email], 'invalid');
      if (email !== '') seen[email] = n;
      const source = row.source ? String(row.source).trim().toLowerCase() : defaultSource;
      if (hh.SOURCES.indexOf(source) < 0) throw util.fail(400, 'source "' + row.source + '" is not one of ' + hh.SOURCES.join(', '), 'invalid');
      const consentRaw = String(row.consent || '').trim().toLowerCase();
      if (['', 'yes', 'no', 'true', 'false', '1', '0', 'y', 'n'].indexOf(consentRaw) < 0) throw util.fail(400, 'consent is yes or no', 'invalid');
      const existing = email !== '' ? util.findOne(app, 'candidates', 'email = {:e}', { e: email }) : null;
      if (existing !== null) {
        if (job !== null && util.findOne(app, 'applications', 'opening = {:j} && candidate = {:c}', { j: job.id, c: existing.id }) === null) {
          if (!dry) addApplication(ctx, existing, job, { source: source });
          attached++;
          report.push({ row: n, status: 'existing_added_to_opening', candidate: existing.id, name: existing.getString('name') });
        } else report.push({ row: n, status: 'duplicate', candidate: existing.id, name: existing.getString('name'), message: 'already here with this email' });
        return;
      }
      const params = {
        name: name,
        email: email,
        phone: row.phone || '',
        location: row.location || '',
        current_title: row.current_title || '',
        current_company: row.current_company || '',
        source: source,
        source_detail: row.source_detail || '',
        links: String(row.links || '').split(/[;\s]+/).filter((x) => x !== ''),
        tags: String(row.tags || '').split(';').map((x) => x.trim()).filter((x) => x !== ''),
        consent: ['yes', 'true', '1', 'y'].indexOf(consentRaw) >= 0,
        notes: row.notes || '',
      };
      const c = util.newRecord(app, 'candidates');
      fillCandidate(ctx, c, params, true);
      c.set('created_actor', ctx.isAgent ? 'agent' : 'person');
      if (job !== null) c.set('country', hh.nameOf(app, 'entities', job.getString('entity'), 'country'));
      if (!dry) {
        app.save(c);
        hh.event(ctx, { candidate: c.id, kind: 'imported', text: 'Imported from a CSV' + (ctx.isAgent ? ' by your AI agent' : '') });
        if (job !== null) addApplication(ctx, c, job, { source: source });
        hh.refreshRetention(app, c.id);
      }
      added++;
      report.push({ row: n, status: 'added', candidate: dry ? '' : c.id, name: name });
    } catch (err) {
      report.push({ row: n, status: 'invalid', message: String((err && err.message) || err) });
    }
  });
  const summary = { rows: parsed.items.length, added: added, added_to_opening: attached, duplicates: report.filter((r) => r.status === 'duplicate').length, invalid: report.filter((r) => r.status === 'invalid').length, ignored_columns: ignored, dry_run: dry };
  if (!dry) {
    L('lib_files').recordImport(ctx, 'candidates', 'committed', { summary: summary, report: report.slice(0, 500) }, added);
    L('lib_audit').note(ctx, { collection: 'candidates', summary: 'Imported ' + added + ' candidates from a CSV' + (job !== null ? ' into ' + job.getString('number') : '') });
  }
  return { summary: summary, report: report };
}

/* ---------------------------------------------------------- applications */

function appsList(ctx, p) {
  const util = u();
  const app = ctx.app;
  const hh = h();
  const where = [];
  const bind = {};
  const op = util.str(p, 'opening', '');
  if (op !== '') {
    const x = L('lib_hiring_jobs').needOpening(ctx, op, false);
    where.push('a.opening = {:j}');
    bind.j = x.rec.id;
  } else {
    if (hh.level(ctx) === 'none') return { applications: [], total: 0 };
    where.push(hh.jobWhere(ctx, bind, 'j'));
  }
  const cand = util.str(p, 'candidate', '');
  if (cand !== '') {
    where.push('a.candidate = {:c}');
    bind.c = candRef(ctx, cand).id;
  }
  const status = util.oneOf(p, 'status', ['active', 'hired', 'rejected', 'withdrawn', 'all'], 'active');
  if (status !== 'all') {
    where.push('a.status = {:s}');
    bind.s = status;
  }
  const stage = util.str(p, 'stage', '');
  if (stage !== '') {
    where.push('a.stage = {:st}');
    bind.st = stage;
  }
  const q = util.squash(util.str(p, 'q', ''));
  if (q !== '') {
    where.push("(c.name LIKE {:q} ESCAPE '\\' OR c.email LIKE {:q} ESCAPE '\\')");
    bind.q = util.like(q);
  }
  const pg = util.page(p, 100, 500);
  const w = where.join(' AND ');
  const base = ' FROM applications a JOIN openings j ON j.id = a.opening JOIN candidates c ON c.id = a.candidate WHERE ' + w;
  const total = util.count(app, 'SELECT COUNT(*) AS n' + base, bind);
  const ids = util.rows(app, 'SELECT a.id AS id' + base + ' ORDER BY a.stage_since LIMIT ' + pg.limit + ' OFFSET ' + pg.offset, { id: '' }, bind);
  const jobs = {};
  return {
    applications: ids
      .map((x) => {
        const a = app.findRecordById('applications', x.id);
        const jid = a.getString('opening');
        if (jobs[jid] === undefined) jobs[jid] = app.findRecordById('openings', jid);
        const acc = hh.appAccess(ctx, a, jobs[jid]);
        return acc === '' ? null : appView(ctx, a, jobs[jid], acc);
      })
      .filter((v) => v !== null),
    total: total,
  };
}

function appsGet(ctx, p) {
  const util = u();
  const a = appRef(ctx, util.req(p, 'application'));
  const job = ctx.app.findRecordById('openings', a.getString('opening'));
  const acc = h().needApp(ctx, a, false, job);
  const v = appView(ctx, a, job, acc);
  v.interviews = L('lib_hiring_interviews').forApplication(ctx, a.id, acc, {});
  v.offers = acc === 'interviewer' ? [] : L('lib_hiring_offers').forApplication(ctx, a.id, acc);
  return { application: v, candidate: candView(ctx, ctx.app.findRecordById('candidates', a.getString('candidate')), acc) };
}

function appsAdd(ctx, p) {
  const util = u();
  const app = ctx.app;
  const x = needCand(ctx, util.req(p, 'candidate'), false);
  const jx = L('lib_hiring_jobs').needOpening(ctx, util.req(p, 'opening'), true);
  if (x.access === 'interviewer') throw util.fail(403, 'Only the hiring team adds candidates to openings.', 'not_permitted');
  const a = addApplication(ctx, x.rec, jx.rec, { stage: util.str(p, 'stage', ''), source: util.str(p, 'source', ''), owner: util.str(p, 'owner', '') === '' ? '' : h().memberIds(app, [util.str(p, 'owner', '')], 'owner')[0] });
  L('lib_audit').note(ctx, { collection: 'applications', record: a.id, summary: 'Added ' + x.rec.getString('name') + ' to ' + jx.rec.getString('number') + ' ' + jx.rec.getString('title') });
  return { application: appView(ctx, a, jx.rec, jx.access) };
}

function move(ctx, p) {
  const util = u();
  const app = ctx.app;
  const hh = h();
  const items = appsParam(ctx, p);
  const target = util.req(p, 'stage', 'interview');
  const moved = [];
  const skipped = [];
  for (const it of items) {
    const a = it.app;
    const job = it.job;
    const cand = app.findRecordById('candidates', a.getString('candidate'));
    if (a.getString('status') !== 'active') {
      skipped.push({ application: a.id, name: cand.getString('name'), reason: 'the application is ' + a.getString('status') });
      continue;
    }
    const st = stageFor(job, target);
    if (st === null) {
      skipped.push({ application: a.id, name: cand.getString('name'), reason: 'no stage "' + target + '" on ' + job.getString('number') });
      continue;
    }
    if (st.kind === 'hired') {
      skipped.push({ application: a.id, name: cand.getString('name'), reason: 'a candidate reaches "' + st.name + '" when they are hired from an accepted offer' });
      continue;
    }
    if (st.key === a.getString('stage')) {
      skipped.push({ application: a.id, name: cand.getString('name'), reason: 'already in ' + st.name });
      continue;
    }
    const from = a.getString('stage');
    a.set('stage', st.key);
    a.set('stage_since', util.nowIso());
    app.save(a);
    const fromSt = hh.stageOf(job, from);
    hh.event(ctx, { candidate: cand.id, application: a.id, kind: 'moved', from: from, to: st.key, text: 'From ' + (fromSt ? fromSt.name : from) + ' to ' + st.name });
    moved.push({ application: a.id, name: cand.getString('name'), stage: st.key, stage_name: st.name });
  }
  if (items.length === 1 && moved.length === 0 && skipped.length === 1) throw util.fail(409, skipped[0].name + ': ' + skipped[0].reason + '.', 'not_moved');
  L('lib_audit').note(ctx, { collection: 'applications', record: moved.length === 1 ? moved[0].application : '', summary: 'Moved ' + (moved.length === 1 ? moved[0].name + ' to ' + moved[0].stage_name : moved.length + ' candidates to ' + target) });
  return { moved: moved, skipped: skipped };
}

/** Close an application (rejected or withdrawn): open interviews are cancelled; an open offer stops it. */
function closeApps(ctx, p, status) {
  const util = u();
  const app = ctx.app;
  const hh = h();
  const items = appsParam(ctx, p);
  let reason = null;
  const reasonRef = util.str(p, 'reason', '');
  if (reasonRef !== '') {
    reason = util.byId(app, 'rejection_reasons', reasonRef) || util.findOne(app, 'rejection_reasons', 'name = {:n}', { n: reasonRef });
    if (reason === null) throw util.fail(400, 'No rejection reason "' + reasonRef + '". Run rejection-reasons.list.', 'invalid_param', { param: 'reason' });
  } else if (status === 'rejected') throw util.fail(400, 'Give the reason (--reason, from rejection-reasons.list).', 'missing_param', { param: 'reason' });
  const noteText = util.text(p, 'note', 2000, '');
  const sendMsg = util.bool(p, 'message', false);
  const subject = util.text(p, 'subject', 200, '') || (reason !== null ? reason.getString('subject') : '');
  const body = util.text(p, 'body', 8000, '') || (reason !== null ? reason.getString('message') : '');
  const done = [];
  const skipped = [];
  const messages = {};
  for (const it of items) {
    const a = it.app;
    const job = it.job;
    const cand = app.findRecordById('candidates', a.getString('candidate'));
    if (a.getString('status') !== 'active') {
      skipped.push({ application: a.id, name: cand.getString('name'), reason: 'the application is already ' + a.getString('status') });
      continue;
    }
    const open = util.findOne(app, 'offers', "application = {:a} && (status = 'pending' || status = 'approved' || status = 'sent')", { a: a.id });
    if (open !== null) {
      skipped.push({ application: a.id, name: cand.getString('name'), reason: 'an offer is ' + open.getString('status') + '; withdraw it first' });
      continue;
    }
    a.set('status', status);
    a.set('rejected_reason', reason !== null ? reason.id : '');
    a.set('closed_note', noteText);
    a.set('closed_at', util.nowIso());
    a.set('closed_by', ctx.memberId || '');
    app.save(a);
    const cancelled = L('lib_hiring_interviews').cancelOpenFor(ctx, a.id, status === 'rejected' ? 'Application closed' : 'Candidate withdrew');
    hh.event(ctx, { candidate: cand.id, application: a.id, kind: status, text: (reason !== null ? reason.getString('name') : status === 'withdrawn' ? 'Withdrew' : '') + (noteText !== '' ? ': ' + noteText : '') + (cancelled > 0 ? ' (' + cancelled + ' interview' + (cancelled === 1 ? '' : 's') + ' cancelled)' : '') });
    let msg = '';
    if (sendMsg && util.squash(body) !== '') {
      msg = queueMessage(ctx, cand, a, job, subject || 'Your application for {{job_title}}', body, true);
      messages[msg] = (messages[msg] || 0) + 1;
    }
    hh.refreshRetention(app, cand.id);
    done.push({ application: a.id, name: cand.getString('name'), interviews_cancelled: cancelled, message: msg });
  }
  if (items.length === 1 && done.length === 0) throw util.fail(409, skipped[0].name + ': ' + skipped[0].reason + '.', 'not_closed');
  L('lib_audit').note(ctx, { collection: 'applications', record: done.length === 1 ? done[0].application : '', summary: (status === 'rejected' ? 'Rejected ' : 'Withdrew ') + (done.length === 1 ? done[0].name : done.length + ' candidates') + (reason !== null ? ' (' + reason.getString('name') + ')' : '') });
  return { done: done, skipped: skipped, messages: messages };
}

function reject(ctx, p) {
  return closeApps(ctx, p, 'rejected');
}

function withdraw(ctx, p) {
  return closeApps(ctx, p, 'withdrawn');
}

function reopen(ctx, p) {
  const util = u();
  const app = ctx.app;
  const hh = h();
  const a = appRef(ctx, util.req(p, 'application'));
  const job = app.findRecordById('openings', a.getString('opening'));
  hh.needApp(ctx, a, true, job);
  if (['rejected', 'withdrawn'].indexOf(a.getString('status')) < 0) throw util.fail(409, 'This application is ' + a.getString('status') + '.', 'conflict');
  if (['draft', 'open', 'on_hold'].indexOf(job.getString('status')) < 0) throw util.fail(409, 'Opening ' + job.getString('number') + ' is closed; open it again first.', 'opening_closed');
  const st = util.str(p, 'stage', '') !== '' ? stageFor(job, util.str(p, 'stage', '')) : hh.stageOf(job, a.getString('stage')) || hh.firstStage(job);
  if (st === null) throw util.fail(400, 'No such stage on this opening.', 'invalid_param', { param: 'stage' });
  if (st.kind === 'hired') throw util.fail(400, 'A candidate reaches the hired stage when they are hired.', 'invalid_param', { param: 'stage' });
  a.set('status', 'active');
  a.set('stage', st.key);
  a.set('stage_since', util.nowIso());
  a.set('rejected_reason', '');
  a.set('closed_at', '');
  a.set('closed_by', '');
  app.save(a);
  hh.event(ctx, { candidate: a.getString('candidate'), application: a.id, kind: 'reopened', to: st.key, text: 'Back in ' + st.name + (util.str(p, 'note', '') !== '' ? ': ' + util.text(p, 'note', 2000, '') : '') });
  hh.refreshRetention(app, a.getString('candidate'));
  L('lib_audit').note(ctx, { collection: 'applications', record: a.id, summary: 'Reopened the application of ' + hh.nameOf(app, 'candidates', a.getString('candidate')) + ' (' + st.name + ')' });
  return { application: appView(ctx, app.findRecordById('applications', a.id), job, 'all') };
}

function message(ctx, p) {
  const util = u();
  const app = ctx.app;
  const items = appsParam(ctx, p);
  const subject = util.text(p, 'subject', 200, '');
  const body = util.text(p, 'body', 8000, '');
  if (util.squash(body) === '') throw util.fail(400, 'body is required (placeholders: {{candidate_name}}, {{job_title}}, {{company}}, {{sender_name}})', 'missing_param', { param: 'body' });
  const send = util.bool(p, 'send', h().cfg(app).getBool('email_candidates'));
  const counts = {};
  for (const it of items) {
    const cand = app.findRecordById('candidates', it.app.getString('candidate'));
    const r = queueMessage(ctx, cand, it.app, it.job, subject || 'About your application for {{job_title}}', body, send);
    counts[r] = (counts[r] || 0) + 1;
  }
  L('lib_audit').note(ctx, { collection: 'hiring_events', summary: 'Message to ' + items.length + ' candidate' + (items.length === 1 ? '' : 's') + (send ? ' (email)' : '') });
  return { results: counts, email_enabled: h().cfg(app).getBool('email_candidates') };
}

function linkHire(ctx, p) {
  const util = u();
  const a = appRef(ctx, util.req(p, 'application'));
  const job = ctx.app.findRecordById('openings', a.getString('opening'));
  h().needApp(ctx, a, true, job);
  const m = L('lib_people').employmentRef(ctx.app, util.req(p, 'employment', 'E0025'));
  const out = L('lib_hiring_offers').linkHire(ctx, a.id, m.id, m.getString('employee'));
  if (!out.linked) throw util.fail(409, out.reason, 'not_linked');
  return out;
}

module.exports = {
  CSV_COLUMNS: CSV_COLUMNS,
  candAccess: candAccess,
  candRef: candRef,
  needCand: needCand,
  appRef: appRef,
  candView: candView,
  appView: appView,
  addApplication: addApplication,
  queueMessage: queueMessage,
  list: list,
  get: get,
  check: check,
  add: add,
  update: update,
  note: note,
  resume: resume,
  resumeSet: resumeSet,
  remove: remove,
  exportCsv: exportCsv,
  importCsv: importCsv,
  appsList: appsList,
  appsGet: appsGet,
  appsAdd: appsAdd,
  move: move,
  reject: reject,
  withdraw: withdraw,
  reopen: reopen,
  message: message,
  linkHire: linkHire,
};
