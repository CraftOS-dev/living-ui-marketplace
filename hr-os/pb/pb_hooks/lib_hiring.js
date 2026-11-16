/// <reference path="../pb_data/types.d.ts" />
/**
 * Hiring, the shared part: who may see and change which hiring records,
 * the settings rows (stages, rejection reasons, offer terms, letter
 * templates, retention), the candidate timeline, pay transparency and
 * retention rules, Hiring home, the profile facts and the cron jobs.
 *
 * Access (SPEC 3.3 plus the hiring rule):
 *   - hiring:full (recruiters, HR, the owner) see and run all of hiring in
 *     their entities; hiring:view or :edit without team scope see all and
 *     change what their level allows.
 *   - Managers (team scope) see only what they are part of: openings where
 *     they are the hiring manager, the owner or on the hiring team, and the
 *     candidates and interviews of those openings.
 *   - Any member assigned to an interview (even an employee) sees that
 *     interview, the candidate's basics and resume, and writes their own
 *     scorecard. Interviewers do not see each other's scorecards for an
 *     interview until they have submitted their own.
 *   - Your AI agent reads everything (pay only when the owner allows it);
 *     it drafts job posts and neutral summaries as proposals and never
 *     scores, ranks, screens out, rejects or hires (the catalog denies it).
 */

const LEVELS = ['none', 'view', 'edit', 'full'];
const STAGE_KINDS = ['applied', 'screen', 'interview', 'offer', 'hired', 'other'];
const SOURCES = ['applied', 'referral', 'sourced', 'agency', 'job_board', 'career_site', 'event', 'internal', 'import', 'other'];
const REMOTE = ['onsite', 'hybrid', 'remote'];
const PER = ['year', 'month', 'week', 'day', 'hour'];
const RECOMMENDATIONS = ['strong_no', 'no', 'yes', 'strong_yes'];

// Pay transparency in job postings, by the job's work country and region,
// as known when this was built (2026-11). A warning on the opening, never
// a block: thresholds by headcount differ and the owner checks with counsel.
const PAY_RULES = {
  US: {
    CA: 'California Labor Code 432.3: the pay scale goes in job postings (15 or more staff).',
    CO: 'Colorado Equal Pay for Equal Work Act: the pay range and benefits go in job postings.',
    WA: 'Washington RCW 49.58.110: the wage scale and benefits go in job postings (15 or more staff).',
    NY: 'New York Labor Law 194-b: the pay range goes in job postings (4 or more staff).',
    IL: 'Illinois Equal Pay Act: the pay scale and benefits go in job postings (15 or more staff).',
    MN: 'Minnesota pay transparency law: the starting pay range and benefits go in job postings (30 or more staff).',
    VT: 'Vermont pay transparency law: the pay range goes in job postings (5 or more staff).',
    MA: 'Massachusetts pay transparency law: the pay range goes in job postings (25 or more staff).',
    MD: 'Maryland pay transparency law: the wage range and benefits go in job postings.',
    HI: 'Hawaii pay transparency law: the hourly rate or salary range goes in job listings (50 or more staff).',
    DC: 'District of Columbia Wage Transparency Act: the pay range goes in job listings.',
    NJ: 'New Jersey pay transparency law: the pay range and benefits go in job postings (10 or more staff).',
  },
  CA: {
    BC: 'British Columbia Pay Transparency Act: the expected pay or pay range goes in public job postings.',
    PE: 'Prince Edward Island Employment Standards Act: the expected pay or pay range goes in public job postings.',
    ON: 'Ontario Employment Standards Act: the expected pay or pay range goes in public job postings (25 or more staff).',
  },
};
const EU = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'];
const EU_BASIS = 'EU Pay Transparency Directive 2023/970 as your country applies it: tell applicants the starting pay or range in the posting or before the first interview.';
const US_REMOTE_BASIS = 'A remote role open to people in states such as California, Colorado, New York or Washington needs the pay range in the posting.';

// Why each suggested retention period (Hiring settings shows it as a hint).
const RETENTION_BASIS = {
  US: 'EEOC records rule (29 CFR 1602.14): keep applications at least one year.',
  GB: 'ICO guidance: usually about six months after the decision.',
  NL: 'Dutch DPA: four weeks after the decision, up to a year with consent.',
  FR: 'CNIL: up to two years after the last contact.',
  DE: 'About six months, the time to bring an equal treatment claim.',
  HK: 'PCPD Code of Practice on Human Resource Management: up to two years.',
};
const RETENTION_OTHER = 'No fixed period in law: keep it only as long as you need it.';

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}

/* -------------------------------------------------------------- access */

/** The caller's hiring level: none | view | edit | full (your AI agent and the app: full). */
function level(ctx) {
  if (ctx.isAgent || ctx.actor === 'system') return 'full';
  return L('lib_auth').level(ctx, 'hiring');
}

function atLeast(ctx, lvl) {
  return LEVELS.indexOf(level(ctx)) >= LEVELS.indexOf(lvl);
}

/** Sees every hiring record of its entities (not only what it is part of). */
function broad(ctx) {
  if (ctx.isAgent || ctx.actor === 'system') return true;
  const l = level(ctx);
  if (l === 'full') return true;
  if (l === 'none') return false;
  return !ctx.teamScope;
}

function isFull(ctx) {
  return atLeast(ctx, 'full');
}

/** 'all' (sees everything here), 'team' (hiring manager, owner or on the hiring team) or ''. */
function jobAccess(ctx, job) {
  if (ctx.isAgent || ctx.actor === 'system') return 'all';
  if (level(ctx) === 'none') return '';
  if (broad(ctx) && L('lib_auth').inScope(ctx, job.getString('entity'))) return 'all';
  const me = ctx.memberId || '';
  if (me === '') return '';
  if (job.getString('hiring_manager') === me || job.getString('owner') === me) return 'team';
  if ((u().jsonOf(job, 'team', []) || []).indexOf(me) >= 0) return 'team';
  return '';
}

/** Is the caller on the panel of some interview of this application? */
function onPanel(ctx, applicationId) {
  if (!ctx.memberId) return false;
  return u().count(ctx.app, 'SELECT COUNT(*) AS n FROM interview_feedback WHERE application = {:a} AND interviewer = {:m}', { a: applicationId, m: ctx.memberId }) > 0;
}

/** 'all' | 'team' | 'interviewer' | '' for an application (and its job record). */
function appAccess(ctx, application, job) {
  const j = job || ctx.app.findRecordById('openings', application.getString('opening'));
  const a = jobAccess(ctx, j);
  if (a !== '') return a;
  return onPanel(ctx, application.id) ? 'interviewer' : '';
}

/** Can the caller change records it reaches with `access` (edit level or more)? */
/**
 * The agent half of a `can` flag. A person: true (their rights are checked
 * beside it). Your AI agent: whether the op is open to it, run directly or
 * as a proposal (its catalog rule is not deny).
 */
function agentMay(ctx, op) {
  if (!ctx.isAgent) return true;
  let spec = null;
  try {
    spec = L('lib_catalog').get(op);
  } catch {
    spec = null;
  }
  return spec !== null && spec !== undefined && (spec.agent || 'allow') !== 'deny';
}

/** A change op named only its record: refuse instead of saving (or proposing) nothing. */
function needChange(p, idParam) {
  const util = u();
  const given = Object.keys(p || {}).filter((k) => k !== idParam && k !== 'why' && util.has(p, k));
  if (given.length === 0) throw util.fail(400, 'Nothing to change: give at least one field besides --' + idParam + '.', 'nothing_to_change', { param: idParam });
}

function shownValue(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/**
 * Preview of an add-or-change op: 'Add <noun> "<name>"' or 'Change <noun>
 * "<name>"', with the before and after of each param given.
 * o: { collection, id: '<id param>', noun, name: '<name field>', nameParam, fields: { <param>: '<field>' }, json: ['<field>'] }
 */
function savePreview(ctx, p, o) {
  const util = u();
  const id = util.str(p, o.id, '');
  const rec = id !== '' ? util.byId(ctx.app, o.collection, id) : null;
  const given = util.has(p, o.nameParam) ? util.squash(util.str(p, o.nameParam, '')) : '';
  const name = given !== '' ? given : rec !== null ? rec.getString(o.name) : '';
  const json = o.json || [];
  const fields = [];
  for (const k of Object.keys(o.fields)) {
    if (!util.has(p, k)) continue;
    const f = o.fields[k];
    const before = rec === null ? '' : json.indexOf(f) >= 0 ? shownValue(util.jsonOf(rec, f, '')) : shownValue(rec.get(f));
    const after = shownValue(p[k]);
    if (before !== after) fields.push({ name: k, before: before, after: after });
  }
  return { label: (rec !== null ? 'Change ' : 'Add ') + o.noun + (name !== '' ? ' "' + name + '"' : ''), target: rec !== null ? o.collection + ':' + rec.id : '', fields: fields, notes: [], risk: 'low' };
}

function previewReason(ctx, p) {
  return savePreview(ctx, p, { collection: 'rejection_reasons', id: 'reason', noun: 'rejection reason', name: 'name', nameParam: 'name', fields: { name: 'name', kind: 'kind', subject: 'subject', message: 'message', sort: 'sort', archived: 'archived' } });
}

function previewTerm(ctx, p) {
  return savePreview(ctx, p, { collection: 'offer_terms', id: 'term', noun: 'offer term', name: 'title', nameParam: 'title', fields: { title: 'title', text: 'text', category: 'category', sort: 'sort', archived: 'archived' } });
}

function previewTemplate(ctx, p) {
  return savePreview(ctx, p, { collection: 'offer_templates', id: 'template', noun: 'offer letter template', name: 'name', nameParam: 'name', fields: { name: 'name', body: 'body', entity: 'entity', is_default: 'is_default', archived: 'archived' } });
}

function writable(ctx, access) {
  if (ctx.isAgent || ctx.actor === 'system') return true;
  return (access === 'all' || access === 'team') && atLeast(ctx, 'edit');
}

function needJob(ctx, job, write) {
  const util = u();
  const a = jobAccess(ctx, job);
  if (a === '') throw util.fail(404, 'No opening ' + job.id + ' that you can see. Run openings.list.', 'not_found');
  if (write && !writable(ctx, a)) throw util.fail(403, 'Your role can look at this opening but not change it.', 'not_permitted');
  return a;
}

function needApp(ctx, application, write, job) {
  const util = u();
  const a = appAccess(ctx, application, job);
  if (a === '') throw util.fail(404, 'No application ' + application.id + ' that you can see.', 'not_found');
  if (write && !writable(ctx, a)) throw util.fail(403, 'Your role can look at this candidate but not change their application.', 'not_permitted');
  return a;
}

/** Ids of openings the caller is part of (hiring manager, owner, team). */
function involvedJobIds(ctx) {
  if (!ctx.memberId) return [];
  return u()
    .rows(ctx.app, 'SELECT id FROM openings WHERE hiring_manager = {:m} OR owner = {:m} OR team LIKE {:t}', { id: '' }, { m: ctx.memberId, t: '%"' + ctx.memberId + '"%' })
    .map((r) => r.id);
}

/**
 * A SQL condition on the jobs table alias `j` limiting rows to what the
 * caller may see (bind gets its values), or '1 = 1'.
 */
function jobWhere(ctx, bind, alias) {
  const a = alias || 'j';
  if (ctx.isAgent || ctx.actor === 'system') return '1 = 1';
  if (broad(ctx)) {
    const sc = L('lib_auth').scope(ctx);
    if (sc.length === 0) return '1 = 1';
    const keys = sc.map((id, i) => {
      bind['sc' + i] = id;
      return '{:sc' + i + '}';
    });
    return a + '.entity IN (' + keys.join(',') + ')';
  }
  if (level(ctx) === 'none' || !ctx.memberId) return '1 = 0';
  bind.jm = ctx.memberId;
  bind.jt = '%"' + ctx.memberId + '"%';
  return '(' + a + '.hiring_manager = {:jm} OR ' + a + '.owner = {:jm} OR ' + a + '.team LIKE {:jt})';
}

/** May the caller see pay on hiring records it reaches with `access`? */
function seesPay(ctx, access) {
  if (ctx.isAgent) return L('lib_settings').row(ctx.app).getBool('agent_sees_pay');
  if (ctx.actor === 'system') return true;
  return access === 'all' || access === 'team';
}

/* ------------------------------------------------------------- config */

function cfg(app) {
  const r = u().findOne(app, 'hiring_config', '1=1', {});
  if (r === null) throw u().fail(500, 'hiring settings row is missing (migration 1730005000)');
  return r;
}

function defaultStages(app) {
  return u().jsonOf(cfg(app), 'default_stages', []) || [];
}

function retentionDays(app, country, consent) {
  const c = cfg(app);
  const map = u().jsonOf(c, 'retention', {}) || {};
  const base = map[String(country || '').toUpperCase()] !== undefined ? Number(map[String(country || '').toUpperCase()]) : c.getInt('retention_default') || 365;
  return consent ? Math.max(base, c.getInt('consent_days') || base) : base;
}

/** Stages of an opening: [{ key, name, kind, kit }]. */
function stagesOf(job) {
  return u().jsonOf(job, 'stages', []) || [];
}

function stageOf(job, key) {
  return stagesOf(job).filter((s) => s.key === key)[0] || null;
}

function firstStage(job) {
  const st = stagesOf(job);
  return st.length > 0 ? st[0] : null;
}

function hiredStage(job) {
  return stagesOf(job).filter((s) => s.kind === 'hired')[0] || null;
}

/**
 * Check and normalise a stages list: names required and unique, keys kept
 * (new ones from the name), the first stage is 'applied', exactly one
 * 'hired' stage and it is last.
 */
function cleanStages(raw, where) {
  const util = u();
  if (!Array.isArray(raw) || raw.length < 2) throw util.fail(400, where + ': give at least two stages (Applied ... Hired).', 'invalid_param', { param: 'stages' });
  if (raw.length > 20) throw util.fail(400, where + ': at most 20 stages.', 'invalid_param', { param: 'stages' });
  const out = [];
  const keys = {};
  const names = {};
  raw.forEach((s, i) => {
    util.keysOnly(s, ['key', 'name', 'kind', 'kit'], 'stage ' + (i + 1));
    const name = util.clip(util.squash(s.name), 40);
    if (name === '') throw util.fail(400, 'stage ' + (i + 1) + ': name is required.', 'invalid_param', { param: 'stages' });
    if (names[name.toLowerCase()]) throw util.fail(400, 'Two stages are called "' + name + '".', 'invalid_param', { param: 'stages' });
    names[name.toLowerCase()] = true;
    const kind = String(s.kind || (i === 0 ? 'applied' : i === raw.length - 1 ? 'hired' : 'other'));
    if (STAGE_KINDS.indexOf(kind) < 0) throw util.fail(400, 'stage "' + name + '": kind is one of ' + STAGE_KINDS.join(', ') + '.', 'invalid_param', { param: 'stages' });
    let key = String(s.key || '').trim();
    if (key === '') key = util.slug(name).replace(/-/g, '_').slice(0, 30) || 'stage';
    if (!/^[a-z0-9_]{1,40}$/.test(key)) throw util.fail(400, 'stage "' + name + '": key uses a to z, 0 to 9 and _.', 'invalid_param', { param: 'stages' });
    let k = key;
    let n = 2;
    while (keys[k]) k = key + '_' + n++;
    keys[k] = true;
    out.push({ key: k, name: name, kind: kind, kit: typeof s.kit === 'string' ? s.kit : '' });
  });
  if (out[0].kind !== 'applied') throw util.fail(400, 'The first stage is where new candidates land; give it kind "applied".', 'invalid_param', { param: 'stages' });
  if (out.filter((s) => s.kind === 'applied').length > 1) throw util.fail(400, 'Only the first stage has kind "applied".', 'invalid_param', { param: 'stages' });
  const hired = out.filter((s) => s.kind === 'hired');
  if (hired.length !== 1 || out[out.length - 1].kind !== 'hired') throw util.fail(400, 'The last stage, and only the last, has kind "hired" (candidates reach it when they are hired).', 'invalid_param', { param: 'stages' });
  return out;
}

/* --------------------------------------------------------------- names */

/** Member names by id, cached in `cache`. */
function memberName(app, id, cache) {
  if (!id) return '';
  const c = cache || {};
  if (c[id] === undefined) {
    const m = u().byId(app, 'members', id);
    c[id] = m === null ? 'Former member' : m.getString('name');
  }
  return c[id];
}

function membersBrief(app, ids, cache) {
  return (ids || []).filter((x) => typeof x === 'string' && x !== '').map((id) => ({ id: id, name: memberName(app, id, cache) }));
}

/** A list of member refs (ids or emails) -> active member ids (unique). */
function memberIds(app, refs, param) {
  const util = u();
  const out = [];
  for (const r of refs || []) {
    let m;
    try {
      m = L('lib_auth').memberRef(app, String(r));
    } catch {
      throw util.fail(400, (param || 'member') + ': no member "' + r + '" (give a member id or their sign-in email).', 'invalid_param', { param: param || 'member' });
    }
    if (m.getString('status') !== 'active') throw util.fail(400, m.getString('name') + ' cannot sign in yet (invite pending or disabled).', 'invalid_param', { param: param || 'member' });
    if (out.indexOf(m.id) < 0) out.push(m.id);
  }
  return out;
}

function nameOf(app, collection, id, field) {
  if (!id) return '';
  const r = u().byId(app, collection, id);
  return r === null ? '' : r.getString(field || 'name');
}

/* ------------------------------------------------------------ timeline */

/** Write one candidate timeline row. */
function event(ctx, o) {
  const util = u();
  const r = util.newRecord(ctx.app, 'hiring_events');
  r.set('candidate', o.candidate);
  r.set('application', o.application || '');
  r.set('kind', o.kind);
  r.set('from_stage', o.from || '');
  r.set('to_stage', o.to || '');
  r.set('subject', util.clip(o.subject || '', 200));
  r.set('text', util.clip(o.text || '', 20000));
  r.set('actor', ctx.isAgent ? 'agent' : ctx.actor === 'person' ? 'person' : 'system');
  r.set('member', ctx.actor === 'person' ? ctx.memberId || '' : '');
  r.set('delivery', o.delivery || 'none');
  r.set('to_email', o.to_email || '');
  r.set('ref', o.ref || '');
  // An interview's time travels as data (the UI writes it in the viewer's format).
  r.set('day', o.day || '');
  r.set('start', o.start || '');
  r.set('zone', o.zone || '');
  ctx.app.save(r);
  return r;
}

function eventView(app, r, cache) {
  return {
    id: r.id,
    kind: r.getString('kind'),
    application: r.getString('application'),
    from_stage: r.getString('from_stage'),
    to_stage: r.getString('to_stage'),
    subject: r.getString('subject'),
    text: r.getString('text'),
    actor: r.getString('actor'),
    who: r.getString('actor') === 'agent' ? 'Your AI agent' : r.getString('actor') === 'system' ? 'HR OS' : memberName(app, r.getString('member'), cache),
    delivery: r.getString('delivery'),
    to_email: r.getString('to_email'),
    ref: r.getString('ref'),
    day: r.getString('day'),
    start: r.getString('start'),
    zone: r.getString('zone'),
    at: r.getString('created'),
  };
}

/* ------------------------------------------------------ text templates */

/** Replace {{name}} placeholders; unknown names stay visible so a person fixes them. */
function render(template, vars) {
  return String(template || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (all, k) => (vars[k] === undefined || vars[k] === null ? all : String(vars[k])));
}

function companyName(app) {
  return L('lib_settings').row(app).getString('company_name');
}

/** 2026-12-01 -> "1 December 2026". */
function longDay(d) {
  if (!u().isDay(d)) return d || '';
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return Number(d.slice(8, 10)) + ' ' + months[Number(d.slice(5, 7)) - 1] + ' ' + d.slice(0, 4);
}

/* -------------------------------------------------- pay transparency */

/** The pay transparency rule for a work place: { basis } or null. */
function payRule(country, region, remote) {
  const cc = String(country || '').toUpperCase();
  const rg = String(region || '').toUpperCase();
  if (PAY_RULES[cc] && PAY_RULES[cc][rg]) return { basis: PAY_RULES[cc][rg], when: 'posting' };
  if (cc === 'US' && remote === 'remote') return { basis: US_REMOTE_BASIS, when: 'posting' };
  if (EU.indexOf(cc) >= 0) return { basis: EU_BASIS, when: 'before_interview' };
  return null;
}

/** Warnings of an opening (pay range missing where the law wants it, upside-down range). */
function jobIssues(job) {
  const out = [];
  const rule = payRule(job.getString('country'), job.getString('region'), job.getString('remote'));
  const lo = job.getInt('salary_min_minor');
  const hi = job.getInt('salary_max_minor');
  if (rule !== null && (lo <= 0 || hi <= 0)) out.push({ code: 'pay_range_missing', severity: 'warning', field: 'salary', message: 'Add the pay range: ' + rule.basis });
  if (lo > 0 && hi > 0 && lo > hi) out.push({ code: 'pay_range_order', severity: 'warning', field: 'salary', message: 'The lowest pay is above the highest.' });
  return out;
}

/* ----------------------------------------------------------- retention */

/**
 * Work out a candidate's retention day: the later of the day they were
 * added and the last day an application of theirs was made or closed,
 * plus the days for the country (longer with consent). A candidate in
 * process or hired keeps the day but is never listed as due.
 */
function refreshRetention(app, candidateId) {
  const util = u();
  const c = util.byId(app, 'candidates', candidateId);
  if (c === null) return null;
  let base = String(c.getString('created')).slice(0, 10);
  let country = c.getString('country');
  const rows = util.rows(
    app,
    "SELECT a.applied_at AS applied, a.closed_at AS closed, COALESCE(e.country, '') AS country FROM applications a JOIN openings j ON j.id = a.opening LEFT JOIN entities e ON e.id = j.entity WHERE a.candidate = {:c} ORDER BY a.created",
    { applied: '', closed: '', country: '' },
    { c: candidateId },
  );
  for (const r of rows) {
    const d1 = r.applied;
    const d2 = String(r.closed || '').slice(0, 10);
    if (d1 > base) base = d1;
    if (d2 > base) base = d2;
    if (r.country !== '') country = r.country;
  }
  if (!util.isDay(base)) base = util.today(app);
  const until = util.dayAdd(base, retentionDays(app, country, c.getBool('consent')));
  if (c.getString('retain_until') !== until || c.getString('country') !== country) {
    c.set('retain_until', until);
    c.set('country', country);
    if (until > util.today(app)) c.set('retention_flagged', '');
    app.save(c);
  }
  return until;
}

/** Candidates past their retention day with nothing in process (a person decides each deletion). */
function dueForDeletion(app, limit) {
  const util = u();
  return util.rows(
    app,
    "SELECT c.id AS id, c.name AS name, c.email AS email, c.retain_until AS retain_until, c.country AS country, c.consent AS consent FROM candidates c WHERE c.retain_until != '' AND c.retain_until < {:d} AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.candidate = c.id AND (a.status = 'active' OR a.status = 'hired')) ORDER BY c.retain_until LIMIT " + Math.max(1, Math.min(2000, limit || 500)),
    { id: '', name: '', email: '', retain_until: '', country: '', consent: false },
    { d: util.today(app) },
  );
}

/* ------------------------------------------------------ settings rows */

function reasonView(r) {
  return { id: r.id, name: r.getString('name'), kind: r.getString('kind'), subject: r.getString('subject'), message: r.getString('message'), sort: r.getInt('sort'), archived: r.getBool('archived') };
}

function termView(r) {
  return { id: r.id, title: r.getString('title'), text: r.getString('text'), category: r.getString('category'), sort: r.getInt('sort'), archived: r.getBool('archived') };
}

function templateView(app, r) {
  return { id: r.id, name: r.getString('name'), entity: r.getString('entity'), entity_name: nameOf(app, 'entities', r.getString('entity')), body: r.getString('body'), is_default: r.getBool('is_default'), archived: r.getBool('archived') };
}

const PLACEHOLDERS = {
  offer: ['today', 'candidate_name', 'title', 'company', 'entity', 'entity_legal_name', 'department', 'department_line', 'location', 'employment_type', 'start_day', 'pay', 'components', 'terms', 'expires_day', 'sender_name', 'country'],
  message: ['candidate_name', 'job_title', 'company', 'sender_name'],
};

/** hiring.settings: everything Hiring settings shows. */
/** Real names for placeholder previews: the company and the caller's first entity. */
function sampleOf(ctx) {
  const util = u();
  const app = ctx.app;
  const scope = L('lib_auth').scope(ctx);
  const ents = util.findMany(app, 'entities', '1=1', 'name', 50).filter((e) => scope.length === 0 || scope.indexOf(e.id) >= 0);
  const e = ents[0] || null;
  let country = '';
  if (e !== null) {
    try {
      country = L('lib_countries').get(e.getString('country')).name || e.getString('country');
    } catch {
      country = e.getString('country');
    }
  }
  return {
    company: companyName(app),
    entity: e !== null ? e.getString('name') : '',
    entity_legal_name: e !== null ? e.getString('legal_name') || e.getString('name') : '',
    country: country,
    currency: e !== null ? e.getString('currency') : '',
  };
}

function settingsGet(ctx) {
  const util = u();
  const app = ctx.app;
  const c = cfg(app);
  const ret = util.jsonOf(c, 'retention', {}) || {};
  const countries = Object.keys(ret)
    .sort()
    .map((cc) => ({ country: cc, days: Number(ret[cc]), basis: RETENTION_BASIS[cc] || RETENTION_OTHER }));
  return {
    default_stages: util.jsonOf(c, 'default_stages', []) || [],
    stage_kinds: STAGE_KINDS,
    retention: { default_days: c.getInt('retention_default'), consent_days: c.getInt('consent_days'), countries: countries, other_basis: RETENTION_OTHER },
    email_candidates: c.getBool('email_candidates'),
    rejection_reasons: util.findMany(app, 'rejection_reasons', '1=1', 'sort,name').map(reasonView),
    offer_terms: util.findMany(app, 'offer_terms', '1=1', 'sort,title').map(termView),
    offer_templates: util.findMany(app, 'offer_templates', '1=1', '-is_default,name').map((r) => templateView(app, r)),
    placeholders: PLACEHOLDERS,
    sample: sampleOf(ctx),
    calendar: L('lib_hiring_interviews').calendarStatus(app),
    can_edit: isFull(ctx) && agentMay(ctx, 'hiring.settings-update'),
  };
}

function settingsUpdate(ctx, p) {
  const util = u();
  const app = ctx.app;
  const c = cfg(app);
  const before = { default_stages: util.jsonOf(c, 'default_stages', []), retention: util.jsonOf(c, 'retention', {}), retention_default: c.getInt('retention_default'), consent_days: c.getInt('consent_days'), email_candidates: c.getBool('email_candidates') };
  if (util.has(p, 'default_stages')) c.set('default_stages', cleanStages(util.list(p, 'default_stages'), 'default_stages'));
  if (util.has(p, 'retention')) {
    const raw = util.obj(p, 'retention') || {};
    const out = {};
    for (const k of Object.keys(raw)) {
      const cc = String(k).toUpperCase();
      if (!/^[A-Z]{2}$/.test(cc)) throw util.fail(400, 'retention: keys are two-letter country codes, e.g. {"US":365}.', 'invalid_param', { param: 'retention' });
      const d = Number(raw[k]);
      if (!Number.isInteger(d) || d < 1 || d > 3650) throw util.fail(400, 'retention ' + cc + ': days from 1 to 3650.', 'invalid_param', { param: 'retention' });
      out[cc] = d;
    }
    c.set('retention', out);
  }
  if (util.has(p, 'retention_default')) c.set('retention_default', util.int(p, 'retention_default', 365, 1, 3650));
  if (util.has(p, 'consent_days')) c.set('consent_days', util.int(p, 'consent_days', 730, 1, 3650));
  if (util.has(p, 'email_candidates')) c.set('email_candidates', util.bool(p, 'email_candidates', false));
  app.save(c);
  if (util.has(p, 'retention') || util.has(p, 'retention_default') || util.has(p, 'consent_days')) {
    for (const r of util.rows(app, 'SELECT id FROM candidates', { id: '' })) refreshRetention(app, r.id);
  }
  L('lib_audit').note(ctx, { collection: 'hiring_config', record: c.id, summary: 'Changed the hiring settings', before: before, after: { default_stages: util.jsonOf(c, 'default_stages', []), retention: util.jsonOf(c, 'retention', {}), retention_default: c.getInt('retention_default'), consent_days: c.getInt('consent_days'), email_candidates: c.getBool('email_candidates') } });
  return settingsGet(ctx);
}

function reasonsList(ctx, p) {
  const util = u();
  const all = util.bool(p, 'archived', false);
  return { reasons: util.findMany(ctx.app, 'rejection_reasons', all ? '1=1' : 'archived = false', 'sort,name').map(reasonView) };
}

function reasonsSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  const id = util.str(p, 'reason', '');
  if (id !== '') needChange(p, 'reason');
  const r = id !== '' ? util.byId(app, 'rejection_reasons', id) : util.newRecord(app, 'rejection_reasons');
  if (r === null) throw util.fail(404, 'No rejection reason ' + id + '. Run rejection-reasons.list.', 'not_found');
  const before = id !== '' ? reasonView(r) : null;
  if (id === '' || util.has(p, 'name')) {
    const name = util.squash(util.text(p, 'name', 120, ''));
    if (name === '') throw util.fail(400, 'name is required, e.g. --name "Role filled"', 'missing_param', { param: 'name' });
    r.set('name', name);
  }
  if (id === '' || util.has(p, 'kind')) r.set('kind', util.oneOf(p, 'kind', ['company', 'candidate'], id === '' ? 'company' : r.getString('kind')));
  if (util.has(p, 'subject')) r.set('subject', util.text(p, 'subject', 200, ''));
  if (util.has(p, 'message')) r.set('message', util.text(p, 'message', 8000, ''));
  if (util.has(p, 'sort')) r.set('sort', util.int(p, 'sort', 0, 0, 10000));
  else if (id === '') r.set('sort', util.count(app, 'SELECT COUNT(*) AS n FROM rejection_reasons') + 1);
  if (util.has(p, 'archived')) r.set('archived', util.bool(p, 'archived', false));
  app.save(r);
  L('lib_audit').note(ctx, { collection: 'rejection_reasons', record: r.id, summary: (id === '' ? 'Added' : 'Changed') + ' the rejection reason "' + r.getString('name') + '"', before: before, after: reasonView(r) });
  return { reason: reasonView(r) };
}

function reasonsDelete(ctx, p) {
  const util = u();
  const r = util.byId(ctx.app, 'rejection_reasons', util.req(p, 'reason'));
  if (r === null) throw util.fail(404, 'No such rejection reason.', 'not_found');
  const used = util.count(ctx.app, 'SELECT COUNT(*) AS n FROM applications WHERE rejected_reason = {:r}', { r: r.id });
  if (used > 0) {
    r.set('archived', true);
    ctx.app.save(r);
    L('lib_audit').note(ctx, { collection: 'rejection_reasons', record: r.id, summary: 'Archived the rejection reason "' + r.getString('name') + '" (used by ' + used + ' applications)' });
    return { archived: true, used: used };
  }
  ctx.app.delete(r);
  L('lib_audit').note(ctx, { collection: 'rejection_reasons', record: r.id, summary: 'Deleted the rejection reason "' + r.getString('name') + '"' });
  return { deleted: true };
}

function termsList(ctx, p) {
  const util = u();
  return { terms: util.findMany(ctx.app, 'offer_terms', util.bool(p, 'archived', false) ? '1=1' : 'archived = false', 'sort,title').map(termView) };
}

function termsSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  const id = util.str(p, 'term', '');
  if (id !== '') needChange(p, 'term');
  const r = id !== '' ? util.byId(app, 'offer_terms', id) : util.newRecord(app, 'offer_terms');
  if (r === null) throw util.fail(404, 'No offer term ' + id + '. Run offer-terms.list.', 'not_found');
  const before = id !== '' ? termView(r) : null;
  if (id === '' || util.has(p, 'title')) {
    const t = util.squash(util.text(p, 'title', 160, ''));
    if (t === '') throw util.fail(400, 'title is required, e.g. --title "Probation"', 'missing_param', { param: 'title' });
    r.set('title', t);
  }
  if (util.has(p, 'text')) r.set('text', util.text(p, 'text', 8000, ''));
  if (util.has(p, 'category')) r.set('category', util.text(p, 'category', 60, ''));
  if (util.has(p, 'sort')) r.set('sort', util.int(p, 'sort', 0, 0, 10000));
  else if (id === '') r.set('sort', util.count(app, 'SELECT COUNT(*) AS n FROM offer_terms') + 1);
  if (util.has(p, 'archived')) r.set('archived', util.bool(p, 'archived', false));
  app.save(r);
  L('lib_audit').note(ctx, { collection: 'offer_terms', record: r.id, summary: (id === '' ? 'Added' : 'Changed') + ' the offer term "' + r.getString('title') + '"', before: before, after: termView(r) });
  return { term: termView(r) };
}

function termsDelete(ctx, p) {
  const util = u();
  const r = util.byId(ctx.app, 'offer_terms', util.req(p, 'term'));
  if (r === null) throw util.fail(404, 'No such offer term.', 'not_found');
  ctx.app.delete(r);
  L('lib_audit').note(ctx, { collection: 'offer_terms', record: r.id, summary: 'Deleted the offer term "' + r.getString('title') + '" (offers keep their own copy)' });
  return { deleted: true };
}

function templatesList(ctx, p) {
  const util = u();
  return { templates: util.findMany(ctx.app, 'offer_templates', util.bool(p, 'archived', false) ? '1=1' : 'archived = false', '-is_default,name').map((r) => templateView(ctx.app, r)), placeholders: PLACEHOLDERS.offer };
}

function templatesSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  const id = util.str(p, 'template', '');
  if (id !== '') needChange(p, 'template');
  const r = id !== '' ? util.byId(app, 'offer_templates', id) : util.newRecord(app, 'offer_templates');
  if (r === null) throw util.fail(404, 'No letter template ' + id + '. Run offer-templates.list.', 'not_found');
  const before = id !== '' ? templateView(app, r) : null;
  if (id === '' || util.has(p, 'name')) {
    const n = util.squash(util.text(p, 'name', 120, ''));
    if (n === '') throw util.fail(400, 'name is required', 'missing_param', { param: 'name' });
    r.set('name', n);
  }
  if (util.has(p, 'body')) r.set('body', util.text(p, 'body', 40000, ''));
  else if (id === '') throw util.fail(400, 'body is required (markdown with {{placeholders}})', 'missing_param', { param: 'body' });
  if (util.has(p, 'entity')) r.set('entity', util.str(p, 'entity', '') === '' ? '' : L('lib_org').entityRef(app, util.str(p, 'entity', '')).id);
  if (util.has(p, 'archived')) r.set('archived', util.bool(p, 'archived', false));
  const makeDefault = util.bool(p, 'is_default', id === '' ? util.count(app, 'SELECT COUNT(*) AS n FROM offer_templates WHERE is_default = TRUE') === 0 : r.getBool('is_default'));
  r.set('is_default', makeDefault);
  app.save(r);
  if (makeDefault) util.exec(app, 'UPDATE offer_templates SET is_default = FALSE WHERE id != {:id}', { id: r.id });
  L('lib_audit').note(ctx, { collection: 'offer_templates', record: r.id, summary: (id === '' ? 'Added' : 'Changed') + ' the letter template "' + r.getString('name') + '"', before: before, after: templateView(app, r) });
  return { template: templateView(app, r) };
}

function templatesDelete(ctx, p) {
  const util = u();
  const r = util.byId(ctx.app, 'offer_templates', util.req(p, 'template'));
  if (r === null) throw util.fail(404, 'No such letter template.', 'not_found');
  const used = util.count(ctx.app, 'SELECT COUNT(*) AS n FROM offers WHERE template = {:t}', { t: r.id });
  if (used > 0) {
    r.set('archived', true);
    r.set('is_default', false);
    ctx.app.save(r);
    L('lib_audit').note(ctx, { collection: 'offer_templates', record: r.id, summary: 'Archived the letter template "' + r.getString('name') + '" (used by ' + used + ' offers)' });
    return { archived: true, used: used };
  }
  ctx.app.delete(r);
  L('lib_audit').note(ctx, { collection: 'offer_templates', record: r.id, summary: 'Deleted the letter template "' + r.getString('name') + '"' });
  return { deleted: true };
}

/* ---------------------------------------------------------------- home */

/** hiring.home: what needs the caller in hiring now. */
function home(ctx, p) {
  const util = u();
  const app = ctx.app;
  const auth = L('lib_auth');
  const cache = {};
  const today = util.today(app);
  const lvl = level(ctx);
  const out = { level: lvl, broad: broad(ctx), today: today, openings: [], interviews_today: [], interviews_week: [], feedback_owed: [], offers_waiting: [], requisitions_waiting: [], ready_to_hire: [], retention_due: 0, counts: {} };

  if (lvl !== 'none') {
    const bind = {};
    const w = jobWhere(ctx, bind, 'j');
    const jobs = util.rows(app, "SELECT j.id AS id, j.number AS number, j.title AS title, j.entity AS entity, COALESCE(e.name, '') AS entity_name, j.status AS status, j.stages AS stages, j.positions AS positions, j.opened_at AS opened_at FROM openings j LEFT JOIN entities e ON e.id = j.entity WHERE j.status IN ('open', 'on_hold') AND " + w + ' ORDER BY j.opened_at DESC, j.created DESC LIMIT 100', { id: '', number: '', title: '', entity: '', entity_name: '', status: '', stages: '', positions: 0, opened_at: '' }, bind);
    for (const j of jobs) {
      let stages = [];
      try {
        stages = JSON.parse(j.stages || '[]') || [];
      } catch {
        stages = [];
      }
      const counts = {};
      for (const r of util.rows(app, "SELECT stage, COUNT(*) AS n FROM applications WHERE opening = {:j} AND status = 'active' GROUP BY stage", { stage: '', n: 0 }, { j: j.id })) counts[r.stage] = r.n;
      const hired = util.count(app, "SELECT COUNT(*) AS n FROM applications WHERE opening = {:j} AND status = 'hired'", { j: j.id });
      out.openings.push({ id: j.id, number: j.number, title: j.title, entity: j.entity, entity_name: j.entity_name, status: j.status, positions: j.positions, hired: hired, opened_at: j.opened_at, stages: stages.map((s) => ({ key: s.key, name: s.name, kind: s.kind, count: s.kind === 'hired' ? hired : counts[s.key] || 0 })), active: Object.keys(counts).reduce((a, k) => a + counts[k], 0) });
    }
  }

  // Interviews: the caller's own (panel), plus everything they can see when they run hiring.
  const now = Date.now();
  const from = new Date(now - 12 * 3600000).toISOString();
  const weekEnd = new Date(now + 7 * 86400000).toISOString();
  const ivs = L('lib_hiring_interviews').visibleInterviews(ctx, { from: from, to: weekEnd, status: 'scheduled', mine: lvl === 'none' || !broad(ctx) }, cache);
  const localToday = today;
  for (const iv of ivs) {
    if (iv.day === localToday) out.interviews_today.push(iv);
    else out.interviews_week.push(iv);
  }
  out.feedback_owed = L('lib_hiring_interviews').owed(ctx, cache);

  if (lvl !== 'none') {
    const bind = {};
    const w = jobWhere(ctx, bind, 'j');
    const offers = util.rows(app, "SELECT o.id AS id, o.status AS status, o.title AS title, o.start_day AS start_day, o.expires_day AS expires_day, o.application AS application, c.name AS candidate_name, c.id AS candidate, o.employment AS employment, o.approval AS approval FROM offers o JOIN openings j ON j.id = o.opening JOIN candidates c ON c.id = o.candidate WHERE o.status IN ('draft', 'pending', 'approved', 'sent', 'accepted') AND " + w + ' ORDER BY o.updated DESC LIMIT 100', { id: '', status: '', title: '', start_day: '', expires_day: '', application: '', candidate_name: '', candidate: '', employment: '', approval: '' }, bind);
    for (const o of offers) {
      if (o.status === 'accepted') {
        if (o.employment === '') out.ready_to_hire.push(o);
      } else out.offers_waiting.push(o);
    }
    const rb = {};
    const rw = broad(ctx) ? reqScopeWhere(ctx, rb) : '(r.requested_by = {:rm} OR r.hiring_manager = {:rm})';
    if (!broad(ctx)) rb.rm = ctx.memberId || '-';
    out.requisitions_waiting = util.rows(app, "SELECT r.id AS id, r.number AS number, r.title AS title, r.status AS status, r.headcount AS headcount, COALESCE(e.name, '') AS entity_name FROM requisitions r LEFT JOIN entities e ON e.id = r.entity WHERE r.status IN ('pending', 'approved') AND " + rw + ' AND NOT EXISTS (SELECT 1 FROM openings j WHERE j.requisition = r.id) ORDER BY r.updated DESC LIMIT 50', { id: '', number: '', title: '', status: '', headcount: 0, entity_name: '' }, rb);
    if (isFull(ctx)) out.retention_due = dueForDeletion(app, 2000).length;
  }
  out.can = { hire: (ctx.isAgent || auth.can(ctx, 'people', 'full')) && agentMay(ctx, 'people.hire'), edit: atLeast(ctx, 'edit') && agentMay(ctx, 'openings.add'), full: isFull(ctx) && agentMay(ctx, 'hiring.settings-update') };
  out.referrals = ctx.memberId ? util.count(app, "SELECT COUNT(*) AS n FROM referrals WHERE referrer_member = {:m} AND status = 'submitted'", { m: ctx.memberId }) : 0;
  return out;
}

/** Requisitions in the caller's entities (alias r). */
function reqScopeWhere(ctx, bind) {
  const sc = L('lib_auth').scope(ctx);
  if (sc.length === 0) return '1 = 1';
  const keys = sc.map((id, i) => {
    bind['rs' + i] = id;
    return '{:rs' + i + '}';
  });
  return 'r.entity IN (' + keys.join(',') + ')';
}

/* --------------------------------------------------------- profile facts */

/** Facts on a profile and Home: interviews the person is on this week and scorecards they owe. */
function profileFacts(ctx, employmentId) {
  const util = u();
  const app = ctx.app;
  const emp = util.byId(app, 'employments', employmentId);
  if (emp === null) return [];
  const employee = util.byId(app, 'employees', emp.getString('employee'));
  if (employee === null) return [];
  const memberId = employee.getString('member');
  if (memberId === '') return [];
  const own = !ctx.isAgent && ctx.memberId === memberId;
  if (!own && !(ctx.isAgent || atLeast(ctx, 'view'))) return [];
  const now = Date.now();
  const upcoming = util.rows(
    app,
    "SELECT i.id AS id, i.at AS at FROM interviews i JOIN interview_feedback f ON f.interview = i.id WHERE f.interviewer = {:m} AND i.status = 'scheduled' AND i.at >= {:from} AND i.at <= {:to} ORDER BY i.at",
    { id: '', at: '' },
    { m: memberId, from: new Date(now - 3600000).toISOString(), to: new Date(now + 7 * 86400000).toISOString() },
  );
  const owed = util.count(app, "SELECT COUNT(*) AS n FROM interview_feedback f JOIN interviews i ON i.id = f.interview WHERE f.interviewer = {:m} AND f.status != 'submitted' AND i.status IN ('scheduled', 'done') AND i.at <= {:now}", { m: memberId, now: new Date(now).toISOString() });
  const out = [];
  if (upcoming.length > 0 || owed > 0) {
    out.push({ label: own ? 'Interviews this week' : 'Interviewing this week', value: String(upcoming.length), tone: 'neutral', link: own ? '#/hiring/interviews?mine=1' : undefined });
    out.push({ label: own ? 'Scorecards you owe' : 'Scorecards owed', value: String(owed), tone: owed > 0 ? 'warn' : 'neutral', link: own ? '#/hiring/interviews?mine=1' : undefined });
  }
  const refs = util.count(app, "SELECT COUNT(*) AS n FROM referrals WHERE referrer = {:e} AND status = 'submitted'", { e: employee.id });
  if (refs > 0) out.push({ label: 'Referrals', value: String(refs), tone: 'neutral', link: own ? '#/hiring/referrals' : undefined });
  return out.map((f) => {
    if (f.link === undefined) delete f.link;
    return f;
  });
}


/** hiring.people: active members to pick as interviewers, hiring managers or team (names and work emails only). */
function people(ctx, p) {
  const util = u();
  const app = ctx.app;
  const q = util.squash(util.str(p, 'q', '')).toLowerCase();
  const out = [];
  for (const m of util.findMany(app, 'members', "status = 'active'", 'name', 2000)) {
    const role = util.byId(app, 'roles', m.getString('role'));
    const emp = m.getString('employee') !== '' ? util.byId(app, 'employees', m.getString('employee')) : null;
    const row = { id: m.id, name: m.getString('name'), email: m.getString('email'), title: m.getString('title'), role: role !== null ? role.getString('name') : '', employee_number: emp !== null ? emp.getString('number') : '' };
    if (q !== '' && (row.name + ' ' + row.email + ' ' + row.title).toLowerCase().indexOf(q) < 0) continue;
    out.push(row);
  }
  return { people: out };
}

/* ------------------------------------------------------------- reads */

function retentionList(ctx, p) {
  const util = u();
  const rows = dueForDeletion(ctx.app, util.int(p, 'limit', 500, 1, 2000));
  return { candidates: rows.map((r) => ({ id: r.id, name: r.name, email: r.email, retain_until: r.retain_until, country: r.country, consent: r.consent })), total: rows.length, today: util.today(ctx.app) };
}

/* ---------------------------------------------------------------- cron */

/**
 * Daily: flag candidates who passed their retention day (nothing in
 * process) and tell the people who run hiring. Never deletes: a person
 * deletes each one from the list (candidates.delete).
 */
function cronRetention(app) {
  const util = u();
  const due = dueForDeletion(app, 2000);
  const fresh = [];
  const today = util.today(app);
  for (const r of due) {
    const c = util.byId(app, 'candidates', r.id);
    if (c === null || c.getString('retention_flagged') !== '') continue;
    c.set('retention_flagged', today);
    app.save(c);
    fresh.push(r.id);
  }
  if (fresh.length === 0) return { due: due.length, flagged: 0 };
  const ids = fullMembers(app);
  L('lib_notify').notify(app, ids, { kind: 'hiring', title: fresh.length + (fresh.length === 1 ? ' candidate is' : ' candidates are') + ' past the retention day', body: 'Review the list and delete what you no longer need. Nothing is deleted automatically.', link: '#/hiring/candidates?view=retention', facts: [{ type: 'number', key: 'candidates', label: 'Past retention', value: fresh.length, unit: fresh.length === 1 ? 'candidate' : 'candidates' }] });
  return { due: due.length, flagged: fresh.length };
}

/** Active members whose role holds hiring full. */
function fullMembers(app) {
  const util = u();
  const auth = L('lib_auth');
  const out = [];
  for (const m of util.findMany(app, 'members', "status = 'active'", 'created')) {
    const role = util.byId(app, 'roles', m.getString('role'));
    if (role === null) continue;
    if (role.getString('code') === 'owner' || auth.levelsOfRole(role).hiring === 'full') out.push(m.id);
  }
  return out;
}

/** Every minute: send queued candidate emails through your AI agent's Gmail (20 a minute). */
function cronMessages(app) {
  const util = u();
  const rows = util.findMany(app, 'hiring_events', "delivery = 'pending'", 'created', 20);
  if (rows.length === 0) return { sent: 0 };
  const bridge = require(`${__hooks}/_craftbot_bridge.js`);
  let sent = 0;
  for (const r of rows) {
    const res = bridge.callAction('send_gmail', { to: r.getString('to_email'), subject: r.getString('subject'), body: r.getString('text') }, { confirmIrreversible: true });
    const okSent = res && res.status === 200 && !res.error;
    r.set('delivery', okSent ? 'sent' : 'failed');
    app.save(r);
    if (okSent) sent++;
    else console.log('[hr] hiring email not sent: ' + JSON.stringify(res).slice(0, 300));
  }
  return { sent: sent, tried: rows.length };
}

module.exports = {
  LEVELS: LEVELS,
  STAGE_KINDS: STAGE_KINDS,
  SOURCES: SOURCES,
  REMOTE: REMOTE,
  PER: PER,
  RECOMMENDATIONS: RECOMMENDATIONS,
  PLACEHOLDERS: PLACEHOLDERS,
  level: level,
  atLeast: atLeast,
  broad: broad,
  isFull: isFull,
  jobAccess: jobAccess,
  appAccess: appAccess,
  onPanel: onPanel,
  writable: writable,
  agentMay: agentMay,
  needChange: needChange,
  shownValue: shownValue,
  savePreview: savePreview,
  previewReason: previewReason,
  previewTerm: previewTerm,
  previewTemplate: previewTemplate,
  needJob: needJob,
  needApp: needApp,
  involvedJobIds: involvedJobIds,
  jobWhere: jobWhere,
  reqScopeWhere: reqScopeWhere,
  seesPay: seesPay,
  cfg: cfg,
  defaultStages: defaultStages,
  retentionDays: retentionDays,
  stagesOf: stagesOf,
  stageOf: stageOf,
  firstStage: firstStage,
  hiredStage: hiredStage,
  cleanStages: cleanStages,
  memberName: memberName,
  membersBrief: membersBrief,
  memberIds: memberIds,
  nameOf: nameOf,
  event: event,
  eventView: eventView,
  render: render,
  companyName: companyName,
  longDay: longDay,
  payRule: payRule,
  jobIssues: jobIssues,
  refreshRetention: refreshRetention,
  dueForDeletion: dueForDeletion,
  fullMembers: fullMembers,
  settingsGet: settingsGet,
  settingsUpdate: settingsUpdate,
  reasonsList: reasonsList,
  reasonsSave: reasonsSave,
  reasonsDelete: reasonsDelete,
  termsList: termsList,
  termsSave: termsSave,
  termsDelete: termsDelete,
  templatesList: templatesList,
  templatesSave: templatesSave,
  templatesDelete: templatesDelete,
  home: home,
  profileFacts: profileFacts,
  retentionList: retentionList,
  people: people,
  cronRetention: cronRetention,
  cronMessages: cronMessages,
};
