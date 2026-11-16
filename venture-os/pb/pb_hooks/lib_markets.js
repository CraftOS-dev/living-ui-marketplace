/// <reference path="../pb_data/types.d.ts" />
/**
 * Markets (SPEC 7.12): sourcing radars under a thesis and the signals they
 * bring. Market maps live in lib_markets_maps.js.
 *
 * A thesis (kernel-records theses) has one radar: the keyless public
 * sources the app pulls itself (lib_markets_pull: SEC EDGAR Form D, Show HN,
 * GitHub search), registry sources your AI agent searches with its own
 * access (UK Companies House, Japan corporate numbers: they need a key the
 * app never holds), structured filters per source, a free-text query that
 * only a source's own search and your AI agent read, and a schedule (daily
 * or weekly at HH:MM in the firm's zone; weekly Monday 08:00 by default).
 *
 * A run (cron when due, or radars.run) pulls each app source, stores every
 * new item as a signal and decides by rule only:
 *   screened_out  a structured filter failed (pooled fund, industry, year,
 *                 state, amount, points) or a required thesis criterion is
 *                 unmet by the item's structured facts (lib_theses.fit;
 *                 unknown is never unmet)
 *   known         the company is already in the firm's records (domain or
 *                 exact name; intake and deals create their companies there)
 *   new           net-new and waiting for your AI agent
 * then asks your AI agent (trigger radar_sweep { radar_id }, when a person
 * ran it, or on its schedule while the radar_sweeps switch is on): it
 * screens the new ones
 * (signals.screen: candidate with a one-line reason and context, or out)
 * and adds candidates from its own research (signals.add, with sources;
 * licensed data tagged internal_only). People see candidates in Next
 * (kind candidate, one item per radar run) and on the Markets page, and add
 * one to the Inbox (signals.to-inbox through lib_intake.add, channel
 * sourced) or dismiss it, one click each.
 *
 * Net-new: not a company in the firm's records, not already in intake or
 * deals (both create the company record), not dismissed or added before in
 * this radar (same source id or domain).
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}

const SOURCES = [
  { key: 'edgar_form_d', label: 'Form D', by: 'app', kind: 'raise_filed', limit_key: 'edgar_limit' },
  { key: 'hacker_news', label: 'Show HN', by: 'app', kind: 'launch', limit_key: 'hn_limit' },
  { key: 'github', label: 'GitHub', by: 'app', kind: 'repo', limit_key: 'github_limit' },
  { key: 'companies_house', label: 'Companies House', by: 'agent', kind: 'incorporation' },
  { key: 'jp_corporate', label: 'Japan registry', by: 'agent', kind: 'incorporation' },
];
const SOURCE_KEYS = SOURCES.map((s) => s.key);
const SIGNAL_SOURCES = SOURCE_KEYS.concat(['agent', 'person']);
const KINDS = ['raise_filed', 'launch', 'repo', 'incorporation', 'funding', 'hiring', 'founder_move', 'product', 'news', 'other'];
const STATUSES = ['new', 'candidate', 'screened_out', 'known', 'dismissed', 'added'];
const OPEN = ['new', 'candidate'];
const DISMISS_REASONS = ['not_fit', 'too_early', 'too_late', 'competitor', 'other'];
const CONTEXT_KEYS = ['founders', 'hiring', 'connections', 'prior', 'traction', 'links'];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_LABEL = { sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat' };
const DEFAULT_SCHEDULE = { every: 'weekly', day: 'mon', time: '08:00' };
const SECTORS = [
  'ai', 'fintech', 'devtools', 'infrastructure', 'security', 'data', 'enterprise_saas', 'health', 'biotech', 'climate', 'energy', 'robotics', 'industrial', 'space',
  'consumer', 'commerce', 'marketplaces', 'edtech', 'proptech', 'insurtech', 'legal_tech', 'hr_tech', 'mobility', 'logistics', 'agtech', 'food', 'media', 'gaming', 'crypto',
];
const COUNTRIES = ['US', 'CA', 'GB', 'IE', 'DE', 'FR', 'NL', 'SE', 'ES', 'CH', 'IL', 'IN', 'SG', 'ID', 'VN', 'JP', 'KR', 'AU', 'BR', 'MX', 'AE', 'NG', 'KE', 'ZA'];
const SETTINGS_KEY = 'markets';
const WEEKS = 12;
const PER_TICK = 2;
const CLEAN_DAYS = 60;
const RUN_GAP_MS = 60000;

function P() {
  return L('lib_markets_pull');
}

/* ------------------------------------------------------------ settings */

/** The firm's sourcing settings (events_markets settingsKeys, overlaid). */
function settingsOf(app) {
  return L('lib_settings').moduleOf(app, SETTINGS_KEY);
}

/** The User-Agent EDGAR sees: the one set in Settings, else the firm's name and the owner's email. */
function userAgent(app) {
  const s = settingsOf(app);
  if (String(s.user_agent || '').trim() !== '') return String(s.user_agent).trim();
  const util = u();
  const firm = L('lib_settings').row(app).getString('firm_name') || 'Venture OS';
  const owner = util.one(app, "SELECT m.email AS email FROM members m JOIN roles r ON r.id = m.role WHERE r.code = 'owner' AND m.status = 'active' ORDER BY m.created LIMIT 1", { email: '' });
  return (firm + ' ' + (owner ? owner.email : '')).trim();
}

/* ------------------------------------------------------------- filters */

function defaultFilters() {
  return {
    edgar_form_d: { industries: P().DEFAULT_INDUSTRIES.slice(), incorporated_within_years: 5, states: [], min_raise_minor: 0, max_raise_minor: 0, amendments: false },
    hacker_news: { min_points: 10 },
    github: { min_stars: 50, created_within_days: 90 },
  };
}

function wholeNumber(util, v, where, max) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > max) throw util.fail(400, where + ' must be a whole number from 0 to ' + max + '.', 'invalid_param', { param: 'filters' });
  return n;
}

/** Filters per app source, checked key by key against the defaults (unknown keys and values refused with the allowed ones). */
function cleanFilters(raw, current) {
  const util = u();
  const base = defaultFilters();
  const out = {};
  const cur = current || {};
  for (const k of Object.keys(base)) out[k] = Object.assign({}, base[k], cur[k] || {});
  if (raw === undefined) return out;
  for (const src of Object.keys(raw)) {
    if (base[src] === undefined) throw util.fail(400, 'filters takes: ' + Object.keys(base).join(', ') + ' (the registries have no app filters).', 'invalid_param', { param: 'filters', allowed: Object.keys(base) });
    const f = raw[src];
    if (f === null || typeof f !== 'object' || Array.isArray(f)) throw util.fail(400, 'filters.' + src + ' must be an object.', 'invalid_param', { param: 'filters' });
    util.keysOnly(f, Object.keys(base[src]), 'filters.' + src);
    for (const key of Object.keys(f)) {
      const v = f[key];
      const where = 'filters.' + src + '.' + key;
      if (key === 'industries') {
        if (!Array.isArray(v)) throw util.fail(400, where + ' is a list of Form D industry groups.', 'invalid_param', { param: 'filters', allowed: P().INDUSTRIES });
        for (const x of v) if (P().INDUSTRIES.indexOf(x) < 0) throw util.fail(400, where + ': "' + x + '" is not a Form D industry group. Allowed: ' + P().INDUSTRIES.join(', ') + '.', 'invalid_param', { param: 'filters', allowed: P().INDUSTRIES });
        out[src][key] = v.slice();
      } else if (key === 'states') {
        if (!Array.isArray(v)) throw util.fail(400, where + ' is a list of US state codes.', 'invalid_param', { param: 'filters' });
        const s = v.map((x) => String(x).toUpperCase());
        for (const x of s) if (P().US_STATES.indexOf(x) < 0) throw util.fail(400, where + ': "' + x + '" is not a US state code.', 'invalid_param', { param: 'filters', allowed: P().US_STATES });
        out[src][key] = s;
      } else if (key === 'amendments') {
        if (typeof v !== 'boolean') throw util.fail(400, where + ' is true or false.', 'invalid_param', { param: 'filters' });
        out[src][key] = v;
      } else if (key === 'min_raise_minor' || key === 'max_raise_minor') out[src][key] = wholeNumber(util, v, where, 1e15);
      else if (key === 'incorporated_within_years') out[src][key] = wholeNumber(util, v, where, 50);
      else if (key === 'created_within_days') out[src][key] = wholeNumber(util, v, where, 3650);
      else out[src][key] = wholeNumber(util, v, where, 1000000);
    }
  }
  const e = out.edgar_form_d;
  if (e.min_raise_minor > 0 && e.max_raise_minor > 0 && e.min_raise_minor > e.max_raise_minor) throw util.fail(400, 'filters.edgar_form_d: min_raise_minor is above max_raise_minor.', 'invalid_param', { param: 'filters' });
  return out;
}

/* ------------------------------------------------------------ schedule */

/** "daily 08:00", "weekly mon 08:00" or JSON {every, day, time} -> { every, day, time }. */
function cleanSchedule(raw) {
  const util = u();
  let s = raw;
  if (typeof s === 'string') {
    const t = s.trim();
    if (t.charAt(0) === '{') {
      try {
        s = JSON.parse(t);
      } catch {
        throw util.fail(400, 'schedule is "daily HH:MM", "weekly mon HH:MM" or JSON {"every","day","time"}.', 'invalid_param', { param: 'schedule' });
      }
    } else {
      const parts = t.toLowerCase().split(/\s+/);
      s = parts[0] === 'weekly' ? { every: 'weekly', day: parts[1], time: parts[2] } : { every: parts[0], time: parts[1] };
    }
  }
  if (s === null || typeof s !== 'object' || Array.isArray(s)) throw util.fail(400, 'schedule is "daily HH:MM" or "weekly mon HH:MM".', 'invalid_param', { param: 'schedule' });
  util.keysOnly(s, ['every', 'day', 'time'], 'schedule');
  const every = String(s.every || '');
  if (every !== 'daily' && every !== 'weekly') throw util.fail(400, 'schedule.every is daily or weekly.', 'invalid_param', { param: 'schedule' });
  const time = String(s.time || DEFAULT_SCHEDULE.time);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw util.fail(400, 'schedule time is HH:MM (24 hours), e.g. 08:00.', 'invalid_param', { param: 'schedule' });
  const out = { every: every, time: time };
  if (every === 'weekly') {
    const day = String(s.day || DEFAULT_SCHEDULE.day).toLowerCase().slice(0, 3);
    if (DAYS.indexOf(day) < 0) throw util.fail(400, 'schedule day is one of: ' + DAYS.join(', ') + '.', 'invalid_param', { param: 'schedule' });
    out.day = day;
  }
  return out;
}

function scheduleLabel(s) {
  if (!s || !s.every) return '';
  return (s.every === 'weekly' ? DAY_LABEL[s.day] || 'Mon' : 'Daily') + ' ' + s.time;
}

/** The next run instant (ISO, UTC) strictly after `afterMs`, in the firm's zone. */
function nextRun(app, schedule, afterMs) {
  const util = u();
  const s = schedule && schedule.every ? schedule : DEFAULT_SCHEDULE;
  const today = util.today(app);
  for (let i = -1; i <= 8; i++) {
    const day = util.dayAdd(today, i);
    if (s.every === 'weekly' && util.weekday(day) !== DAYS.indexOf(s.day)) continue;
    const at = util.atOf(app, day, s.time);
    if (Date.parse(at) > afterMs) return at;
  }
  return util.atOf(app, util.dayAdd(today, 7), s.time);
}

/* --------------------------------------------------------------- views */

function srcLabel(key) {
  const s = SOURCES.filter((x) => x.key === key)[0];
  return s ? s.label : key === 'agent' ? 'Your AI agent' : key === 'person' ? 'By hand' : key;
}

/** Is the radar's sweep asked of your AI agent and not answered yet? */
function sweeping(r) {
  return L('lib_agent').pending(r, 'radar_sweep');
}

function openCount(app, radarId) {
  return u().count(app, "SELECT COUNT(*) AS n FROM signals WHERE radar = {:r} AND run > 0 AND status IN ('new', 'candidate')", { r: radarId });
}

/** The sweep's place as a StepTrack: Pull, Screen, Ready (at 1 while your AI agent screens). */
function stepsOf(app, r) {
  if (r.getInt('runs') === 0) return { labels: ['Pull', 'Screen', 'Ready'], at: 0, state: 'idle' };
  const t = L('lib_agent').track(r, 'radar_sweep', ['Pull', 'Screen', 'Ready']);
  const open = t !== null && t.open;
  return { labels: ['Pull', 'Screen', 'Ready'], at: open ? 1 : 2, state: open ? 'screening' : t !== null && t.failed ? 'failed' : 'ready', request: t !== null ? t.request : '', error: t !== null ? t.error : '' };
}

function radarOut(app, r) {
  const util = u();
  const t = util.byId(app, 'theses', r.getString('thesis'));
  const schedule = util.jsonOf(r, 'schedule', null) || DEFAULT_SCHEDULE;
  return {
    id: r.id,
    thesis: t ? { id: t.id, name: t.getString('name') } : null,
    name: r.getString('name') || (t ? t.getString('name') : ''),
    sources: util.jsonOf(r, 'sources', []) || [],
    filters: cleanFilters(undefined, util.jsonOf(r, 'filters', {}) || {}),
    query: r.getString('query'),
    schedule: Object.assign({ label: scheduleLabel(schedule) }, schedule),
    status: r.getString('status'),
    next_run_at: r.getString('next_run_at'),
    last_run_at: r.getString('last_run_at'),
    runs: r.getInt('runs'),
    last_counts: util.jsonOf(r, 'last_counts', {}) || {},
    open: openCount(app, r.id),
    steps: stepsOf(app, r),
    actor: r.getString('actor'),
    updated: r.getString('updated'),
  };
}

/** A signal without lookups (Next cards): what a row shows. */
function signalBrief(s) {
  const util = u();
  const fit = util.jsonOf(s, 'fit', null);
  return {
    id: s.id,
    display: s.getString('name') || s.getString('domain') || s.getString('title'),
    name: s.getString('name'),
    domain: s.getString('domain'),
    website: s.getString('website'),
    title: s.getString('title'),
    summary: s.getString('summary'),
    source: s.getString('source'),
    source_label: srcLabel(s.getString('source')),
    source_url: s.getString('source_url'),
    kind: s.getString('kind'),
    licence: s.getString('licence'),
    status: s.getString('status'),
    fit: fit ? { state: fit.state, counts: fit.counts } : null,
  };
}

function signalOut(app, s) {
  const util = u();
  const R = L('lib_records');
  const display = s.getString('name') || s.getString('domain') || s.getString('title');
  return {
    id: s.id,
    radar: s.getString('radar'),
    thesis: s.getString('thesis'),
    run: s.getInt('run'),
    source: s.getString('source'),
    source_label: srcLabel(s.getString('source')),
    kind: s.getString('kind'),
    ext_id: s.getString('ext_id'),
    display: display,
    name: s.getString('name'),
    domain: s.getString('domain'),
    website: s.getString('website'),
    company: R.mini(app, 'companies', s.getString('company')),
    title: s.getString('title'),
    summary: s.getString('summary'),
    source_url: s.getString('source_url'),
    payload: util.jsonOf(s, 'payload', {}) || {},
    facts: util.jsonOf(s, 'facts', {}) || {},
    fit: util.jsonOf(s, 'fit', null),
    context: util.jsonOf(s, 'context', {}) || {},
    licence: s.getString('licence'),
    status: s.getString('status'),
    reason: s.getString('reason'),
    known_as: s.getString('known_as'),
    intake_item: s.getString('intake_item'),
    actor: s.getString('actor'),
    run_at: s.getString('run_at'),
    screened_at: s.getString('screened_at'),
    decided_at: s.getString('decided_at'),
    decided_by: R.mini(app, 'members', s.getString('decided_by')),
    created: s.getString('created'),
  };
}

/* ------------------------------------------------------------ lookups */

function thesisOf(app, ref) {
  return L('lib_theses').thesisRef(app, ref);
}

/** A radar by id, or the radar of a thesis (id or name). */
function radarRef(app, ref) {
  const util = u();
  const r = String(ref || '').trim();
  if (r === '') throw util.fail(400, 'radar is required (a radar id, or the thesis id or name).', 'missing_param', { param: 'radar' });
  const byId = util.byId(app, 'radars', r);
  if (byId !== null) return byId;
  let t = null;
  try {
    t = thesisOf(app, r);
  } catch {
    t = null;
  }
  if (t !== null) {
    const x = util.findOne(app, 'radars', 'thesis = {:t}', { t: t.id });
    if (x !== null) return x;
    throw util.fail(404, 'The thesis ' + t.getString('name') + ' has no radar yet. Add one with radars.save --thesis.', 'not_found', { thesis: t.id });
  }
  throw util.fail(404, 'No radar "' + r + '". Run radars.list.', 'not_found', { ref: r });
}

/** The company already in the firm's records for a domain or an exact name: 'company:<id>' or ''. */
function knownAs(app, domain, name) {
  const util = u();
  const n = L('lib_norm');
  if (domain) {
    const hit = util.one(app, "SELECT id FROM companies WHERE merged_into = '' AND deleted_at = '' AND (domain = {:d} OR domains LIKE {:q}) LIMIT 1", { id: '' }, { d: domain, q: '%"' + domain + '"%' });
    if (hit !== null) return hit.id;
  }
  const key = n.companyKey(name || '');
  if (key !== '') {
    const hit = util.one(app, "SELECT id FROM companies WHERE merged_into = '' AND deleted_at = '' AND name_key = {:k} LIMIT 1", { id: '' }, { k: key });
    if (hit !== null) return hit.id;
  }
  return '';
}

/** A signal of this radar for the same source id or domain (repeats are not stored twice). */
function duplicateIn(app, radarId, source, extId, domain) {
  const util = u();
  if (extId) {
    const x = util.findOne(app, 'signals', 'radar = {:r} && source = {:s} && ext_id = {:e}', { r: radarId, s: source, e: extId });
    if (x !== null) return x;
  }
  if (domain) {
    const x = util.findOne(app, 'signals', 'radar = {:r} && domain = {:d}', { r: radarId, d: domain });
    if (x !== null) return x;
  }
  return null;
}

/** The engine's thesis fit of structured facts, compact (null when there are no facts). */
function fitOf(app, thesisId, facts) {
  if (!facts || Object.keys(facts).length === 0) return null;
  const f = L('lib_theses').fit(app, thesisId, facts);
  return { state: f.required.state, counts: f.counts, checks: f.checks.map((c) => ({ key: c.key, label: c.label, status: c.status, required: c.required === true })) };
}

/** Facts given by your AI agent or a person: fact keys only, plain values or {value, grade}. */
function cleanFacts(raw) {
  const util = u();
  if (raw === undefined) return {};
  const keys = L('lib_theses').FACT_KEYS;
  const out = {};
  for (const k of Object.keys(raw)) {
    if (keys.indexOf(k) < 0) {
      const near = util.nearest(k, keys);
      throw util.fail(400, 'Unknown fact key "' + k + '"' + (near !== '' ? ' (did you mean ' + near + '?)' : '') + '. theses.keys lists them.', 'invalid_param', { param: 'facts', allowed: keys });
    }
    const v = raw[k];
    out[k] = v !== null && typeof v === 'object' && !Array.isArray(v) && 'value' in v ? { value: v.value, grade: String(v.grade || 'public') } : { value: v, grade: 'public' };
  }
  return out;
}

function cleanContext(raw) {
  const util = u();
  if (raw === undefined) return undefined;
  util.keysOnly(raw, CONTEXT_KEYS, 'context');
  const out = {};
  for (const k of Object.keys(raw)) {
    if (k === 'links') {
      const list = Array.isArray(raw.links) ? raw.links : [];
      out.links = list.slice(0, 6).map((x) => util.clip(String(x || '').trim(), 500)).filter((x) => /^https?:\/\//i.test(x));
    } else out[k] = util.clip(util.squash(String(raw[k] === null || raw[k] === undefined ? '' : raw[k])), 400);
  }
  return out;
}

/* ---------------------------------------------------------- ingesting */

/** Store one pulled or added item for a radar; decides new | known | screened_out by rule. */
function store(app, ctx, radar, run, runAt, source, it, pass) {
  const util = u();
  const thesisId = radar.getString('thesis');
  const domain = it.domain || '';
  const rec = util.newRecord(app, 'signals');
  rec.set('radar', radar.id);
  rec.set('thesis', thesisId);
  rec.set('run', run);
  rec.set('run_at', runAt);
  rec.set('source', source);
  rec.set('kind', KINDS.indexOf(it.kind) >= 0 ? it.kind : 'other');
  rec.set('ext_id', util.clip(it.ext_id || '', 120));
  rec.set('name', util.clip(util.squash(it.name || ''), 200));
  rec.set('domain', domain);
  rec.set('website', util.clip(it.website || '', 500));
  rec.set('title', util.clip(util.squash(it.title || ''), 300));
  rec.set('summary', util.clip(util.squash(it.summary || ''), 240));
  rec.set('source_url', util.clip(it.source_url || '', 1000));
  rec.set('facts', it.facts || {});
  rec.set('context', it.context || {});
  rec.set('licence', it.licence === 'internal_only' ? 'internal_only' : 'public');
  let status = 'new';
  let reason = '';
  // A filtered item is kept whole: its id stops the next pull from fetching it again, and another
  // radar with other filters reuses the document (cachedFormD) instead of asking SEC again.
  rec.set('payload', it.payload || {});
  if (pass && pass.ok === false) {
    status = 'screened_out';
    reason = 'filter:' + pass.reason;
  } else {
    const known = knownAs(app, domain, it.name || '');
    if (known !== '') {
      status = 'known';
      rec.set('company', known);
      rec.set('known_as', 'company:' + known);
    } else {
      const fit = fitOf(app, thesisId, it.facts || {});
      rec.set('fit', fit);
      if (fit !== null && fit.state === 'unmet') {
        status = 'screened_out';
        reason = 'thesis_unmet';
      } else if (it.screened === true) status = 'candidate';
    }
  }
  rec.set('status', status);
  rec.set('reason', reason);
  if (status === 'candidate') rec.set('screened_at', util.nowIso());
  L('lib_records').stampWritten(ctx, rec);
  try {
    app.save(rec);
  } catch (err) {
    // A pull running beside another one stored this item first: keep theirs.
    if (String((err && err.message) || err).indexOf('UNIQUE') >= 0 || String((err && err.message) || err).indexOf('unique') >= 0) return duplicateIn(app, radar.id, source, it.ext_id || '', '');
    throw err;
  }
  return rec;
}

/** A Form D another radar already read (its parsed fields), or null. */
function cachedFormD(app, accession) {
  const row = u().one(app, "SELECT payload FROM signals WHERE source = 'edgar_form_d' AND ext_id = {:a} LIMIT 1", { payload: '' }, { a: accession });
  if (row === null || row.payload === '') return null;
  try {
    const p = JSON.parse(row.payload);
    return p && p.entity !== undefined && p.industry !== undefined ? p : null;
  } catch {
    return null;
  }
}

/**
 * Pull the radar's app sources (only `keys` of them) and store what is new
 * with run 0 (delivered with the next run). Between runs (prefetch) only
 * Form D and Show HN are read, so a weekly radar misses nothing; GitHub
 * searches its whole window at the run. -> { errors: { source: code }, left: { source: n } }
 */
function pullInto(app, ctx, radar, keys, prefetch) {
  const util = u();
  const s = settingsOf(app);
  const P0 = P();
  const sources = util.jsonOf(radar, 'sources', []) || [];
  const filters = cleanFilters(undefined, util.jsonOf(radar, 'filters', {}) || {});
  const cursors = util.jsonOf(radar, 'cursors', {}) || {};
  const today = util.today(app);
  const ua = userAgent(app);
  const errors = {};
  const left = {};
  for (const src of SOURCES) {
    if (src.by !== 'app' || sources.indexOf(src.key) < 0 || keys.indexOf(src.key) < 0) continue;
    const seen = (ext) => util.findOne(app, 'signals', 'radar = {:r} && source = {:s} && ext_id = {:e}', { r: radar.id, s: src.key, e: ext }) !== null;
    const max = src.key === 'edgar_form_d' ? 300 : 50;
    const limit = Math.max(1, Math.min(max, Number(s[src.limit_key] || 25), prefetch ? 30 : max));
    const o = { filters: filters[src.key], limit: limit, pages: prefetch ? 1 : 2, user_agent: ua, query: radar.getString('query'), today: today, year: Number(today.slice(0, 4)), seen: seen, cached: (acc) => cachedFormD(app, acc), since_at: cursors[src.key] || '' };
    const res = src.key === 'edgar_form_d' ? P0.pullEdgar(app, o) : src.key === 'hacker_news' ? P0.pullHackerNews(app, o) : P0.pullGithub(app, o);
    // The network is done; store the source's items in one write (readers are not held up item by item).
    app.runInTransaction((tx) => {
      for (const x of res.items) {
        if (duplicateIn(tx, radar.id, src.key, x.item.ext_id, x.item.domain) !== null) continue;
        store(tx, ctx, radar, 0, '', src.key, x.item, x.pass);
      }
    });
    if (res.counts.error !== '') errors[src.key] = res.counts.error;
    if (res.counts.left > 0) left[src.key] = res.counts.left;
    if (res.cursor !== undefined) cursors[src.key] = res.cursor;
  }
  const r = app.findRecordById('radars', radar.id);
  r.set('cursors', cursors);
  app.save(r);
  return { errors: errors, left: left };
}

/** Counts of one run per source: { source: { by, pulled, new, known, out, error, left } }. */
function runCounts(app, radar, run, errors, left) {
  const util = u();
  const sources = util.jsonOf(radar, 'sources', []) || [];
  const counts = {};
  for (const src of SOURCES) {
    if (sources.indexOf(src.key) < 0) continue;
    counts[src.key] = src.by === 'agent' ? { by: 'agent' } : { by: 'app', pulled: 0, new: 0, known: 0, out: 0, error: errors[src.key] || '', left: left[src.key] || 0 };
  }
  for (const row of util.rows(app, 'SELECT source, status, COUNT(*) AS n FROM signals WHERE radar = {:r} AND run = {:run} GROUP BY source, status', { source: '', status: '', n: 0 }, { r: radar.id, run: run })) {
    const c = counts[row.source];
    if (!c || c.by !== 'app') continue;
    c.pulled += row.n;
    if (row.status === 'new' || row.status === 'candidate') c.new += row.n;
    else if (row.status === 'known') c.known += row.n;
    else c.out += row.n;
  }
  return counts;
}

/**
 * A radar run: pull every app source, deliver everything pulled since the
 * last run as this run, and ask your AI agent to sweep it (trigger
 * radar_sweep: it screens the new ones and researches its own) when a
 * person ran it, or on its schedule while the radar_sweeps switch is on.
 * -> { radar, run, counts, new, request }
 */
function runOf(app, ctx, radar) {
  const util = u();
  const pulled = pullInto(app, ctx, radar, SOURCE_KEYS, false);
  const r0 = app.findRecordById('radars', radar.id);
  const run = r0.getInt('runs') + 1;
  const runAt = util.nowIso();
  util.exec(app, 'UPDATE signals SET run = {:run}, run_at = {:at} WHERE radar = {:r} AND run = 0', { run: run, at: runAt, r: radar.id });
  const counts = runCounts(app, r0, run, pulled.errors, pulled.left);
  let fresh = 0;
  for (const k of Object.keys(counts)) fresh += counts[k].new || 0;
  const sources = util.jsonOf(r0, 'sources', []) || [];
  const t = util.byId(app, 'theses', r0.getString('thesis'));
  const agentSources = SOURCES.filter((x) => x.by === 'agent' && sources.indexOf(x.key) >= 0).map((x) => x.key);
  const r = app.findRecordById('radars', radar.id);
  r.set('runs', run);
  r.set('last_run_at', runAt);
  r.set('last_counts', counts);
  r.set('next_run_at', r.getString('status') === 'active' ? nextRun(app, util.jsonOf(r, 'schedule', null), Date.now()) : '');
  app.save(r);
  // A person's run asks for the sweep; a scheduled run asks only while the radar_sweeps switch is on; your AI agent's own run asks nothing.
  const worth = fresh > 0 || agentSources.length > 0;
  let request = '';
  if (worth && !ctx.isAgent && ctx.actor === 'person') request = L('lib_agent').ask(app, 'radar_sweep', r, {}, { by: ctx.memberId || '' });
  else if (worth && ctx.actor === 'system') request = L('lib_agent').ask(app, 'radar_sweep', r, {}, { policy: true });
  L('lib_bus').touch('signals');
  L('lib_bus').touch('radars');
  return { radar: app.findRecordById('radars', radar.id), run: run, counts: counts, new: fresh, request: request };
}

/* -------------------------------------------------------------- ops */

/** radars.options: what the New thesis sheet offers (sources with their filters, sectors, stages, countries, schedule). */
function opOptions(ctx) {
  const util = u();
  const app = ctx.app;
  const used = util.rows(app, "SELECT DISTINCT LOWER(sector) AS s FROM companies WHERE sector != '' AND deleted_at = '' LIMIT 200", { s: '' }).map((r) => r.s);
  const sectors = SECTORS.slice();
  for (const t of app.findRecordsByFilter('theses', '1=1', '', 500, 0)) {
    for (const c of util.jsonOf(t, 'criteria', []) || []) if (c.key === 'sector' && Array.isArray(c.values)) for (const v of c.values) used.push(String(v).toLowerCase());
  }
  for (const s of used) if (s !== '' && sectors.indexOf(s) < 0) sectors.push(s);
  const s = settingsOf(app);
  return {
    sources: SOURCES.map((x) => ({ key: x.key, label: x.label, by: x.by, kind: x.kind })),
    defaults: { sources: ['edgar_form_d', 'hacker_news'], filters: defaultFilters(), schedule: Object.assign({ label: scheduleLabel(DEFAULT_SCHEDULE) }, DEFAULT_SCHEDULE) },
    industries: P().INDUSTRIES,
    states: P().US_STATES,
    sectors: sectors,
    stages: L('lib_theses').COMPANY_STAGES,
    countries: COUNTRIES,
    days: DAYS,
    dismiss_reasons: DISMISS_REASONS,
    limits: { edgar_limit: s.edgar_limit, hn_limit: s.hn_limit, github_limit: s.github_limit },
    user_agent: userAgent(app),
  };
}

function opList(ctx, p) {
  const util = u();
  const app = ctx.app;
  const where = [];
  const bind = {};
  const status = util.oneOf(p, 'status', ['active', 'paused', 'all'], 'all');
  if (status !== 'all') {
    where.push('status = {:s}');
    bind.s = status;
  }
  if (util.str(p, 'thesis', '') !== '') {
    where.push('thesis = {:t}');
    bind.t = thesisOf(app, util.str(p, 'thesis', '')).id;
  }
  const rows = app.findRecordsByFilter('radars', where.length > 0 ? where.join(' && ') : '1=1', 'created', 0, 0, bind);
  return { radars: rows.map((r) => radarOut(app, r)), total: rows.length };
}

function opGet(ctx, p) {
  return { radar: radarOut(ctx.app, radarRef(ctx.app, u().req(p, 'radar'))) };
}

/** radars.save: add a thesis's radar (--thesis) or change one (--radar). */
function opSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  const ref = util.str(p, 'radar', '');
  let rec = ref !== '' ? radarRef(app, ref) : null;
  let thesis = null;
  if (rec === null) {
    thesis = thesisOf(app, util.req(p, 'thesis'));
    rec = util.findOne(app, 'radars', 'thesis = {:t}', { t: thesis.id });
  } else thesis = app.findRecordById('theses', rec.getString('thesis'));
  const isNew = rec === null;
  const before = isNew ? null : radarOut(app, rec);
  let sources;
  if (util.has(p, 'sources')) {
    const list = util.list(p, 'sources');
    for (const s of list) if (SOURCE_KEYS.indexOf(s) < 0) throw util.fail(400, 'sources: "' + s + '" is not a source. Sources: ' + SOURCE_KEYS.join(', ') + '.', 'invalid_param', { param: 'sources', allowed: SOURCE_KEYS });
    sources = SOURCE_KEYS.filter((k) => list.indexOf(k) >= 0);
  }
  const filters = util.has(p, 'filters') ? cleanFilters(util.obj(p, 'filters'), isNew ? {} : util.jsonOf(rec, 'filters', {}) || {}) : undefined;
  const schedule = util.has(p, 'schedule') ? cleanSchedule(p.schedule) : undefined;
  const status = util.oneOf(p, 'status', ['active', 'paused'], '');
  const query = util.has(p, 'query') ? util.squash(util.text(p, 'query', 300, '')) : undefined;
  if (isNew) {
    rec = util.newRecord(app, 'radars');
    rec.set('thesis', thesis.id);
    rec.set('sources', sources !== undefined ? sources : ['edgar_form_d', 'hacker_news']);
    rec.set('filters', filters !== undefined ? filters : defaultFilters());
    rec.set('schedule', schedule !== undefined ? schedule : DEFAULT_SCHEDULE);
    rec.set('status', status !== '' ? status : 'active');
    rec.set('query', query !== undefined ? query : '');
    rec.set('runs', 0);
    rec.set('last_counts', {});
  } else {
    if (sources !== undefined) rec.set('sources', sources);
    if (filters !== undefined) rec.set('filters', filters);
    if (schedule !== undefined) rec.set('schedule', schedule);
    if (status !== '') rec.set('status', status);
    if (query !== undefined) rec.set('query', query);
  }
  if (util.has(p, 'name')) rec.set('name', util.squash(util.text(p, 'name', 160, '')));
  const prov = util.jsonOf(rec, 'prov', {}) || {};
  for (const k of ['sources', 'filters', 'schedule', 'status', 'query', 'name']) if (util.has(p, k)) prov[k] = L('lib_records').provEntry(ctx, util.str(p, 'source_ref', ''));
  rec.set('prov', prov);
  rec.set('next_run_at', rec.getString('status') === 'active' ? nextRun(app, util.jsonOf(rec, 'schedule', null), Date.now()) : '');
  L('lib_records').stampWritten(ctx, rec);
  app.save(rec);
  L('lib_audit').note(ctx, { collection: 'radars', record: rec.id, summary: (isNew ? 'Added the radar of ' : 'Changed the radar of ') + thesis.getString('name'), before: before, after: radarOut(app, rec) });
  return { radar: radarOut(app, rec) };
}

function previewSave(ctx, params) {
  const app = ctx.app;
  let rec = null;
  let label = '';
  try {
    rec = params.radar ? radarRef(app, params.radar) : null;
    if (rec === null && params.thesis) {
      const t = thesisOf(app, params.thesis);
      rec = u().findOne(app, 'radars', 'thesis = {:t}', { t: t.id });
      label = t.getString('name');
    }
  } catch {
    rec = null;
  }
  if (rec !== null && label === '') {
    const t = u().byId(app, 'theses', rec.getString('thesis'));
    label = t ? t.getString('name') : '';
  }
  const fields = [];
  for (const k of ['sources', 'filters', 'schedule', 'query', 'status', 'name']) {
    if (params[k] === undefined) continue;
    const before = rec === null ? '' : k === 'query' || k === 'status' || k === 'name' ? rec.getString(k) : JSON.stringify(u().jsonOf(rec, k, null));
    fields.push({ name: k, before: before, after: typeof params[k] === 'string' ? params[k] : JSON.stringify(params[k]) });
  }
  return { label: (rec === null ? 'Add the radar of ' : 'Change the radar of ') + label, target: rec === null ? '' : 'radars:' + rec.id, fields: fields, notes: [], risk: 'low' };
}

/** radars.run: pull the radar's app sources now and ask your AI agent to sweep it (untracked: network calls). */
function opRun(ctx, p) {
  const util = u();
  const app = ctx.app;
  const radar = radarRef(app, util.req(p, 'radar'));
  const last = Date.parse(radar.getString('last_run_at'));
  if (Number.isFinite(last) && Date.now() - last < RUN_GAP_MS) throw util.fail(409, 'This radar ran less than a minute ago; its results are in signals.list.', 'too_soon', { last_run_at: radar.getString('last_run_at') });
  const res = runOf(app, ctx, radar);
  L('lib_audit').note(ctx, { collection: 'radars', record: radar.id, summary: 'Ran the radar (' + res.new + ' new)' });
  return { radar: radarOut(app, res.radar), run: res.run, counts: res.counts, new: res.new, request: res.request };
}

/** theses.summary: the Markets landing data, one tile per thesis. */
function opSummary(ctx, p) {
  const util = u();
  const app = ctx.app;
  const status = util.oneOf(p, 'status', ['active', 'archived', 'all'], 'active');
  const theses = app.findRecordsByFilter('theses', status === 'all' ? '1=1' : 'status = {:s}', 'sort,name', 0, 0, { s: status });
  const now = Date.now();
  const since = new Date(now - WEEKS * 7 * 86400000).toISOString().replace('T', ' ');
  const out = theses.map((t) => {
    const r = util.findOne(app, 'radars', 'thesis = {:t}', { t: t.id });
    const weekly = [];
    for (let i = 0; i < WEEKS; i++) weekly.push(0);
    for (const row of util.rows(app, "SELECT created FROM signals WHERE thesis = {:t} AND run > 0 AND created >= {:s} AND status IN ('candidate', 'added', 'dismissed')", { created: '' }, { t: t.id, s: since })) {
      const age = Math.floor((now - Date.parse(row.created.replace(' ', 'T'))) / (7 * 86400000));
      if (age >= 0 && age < WEEKS) weekly[WEEKS - 1 - age]++;
    }
    const counts = util.one(app, "SELECT COALESCE(SUM(CASE WHEN status = 'candidate' THEN 1 ELSE 0 END), 0) AS candidate, COALESCE(SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END), 0) AS fresh, COALESCE(SUM(CASE WHEN status = 'added' THEN 1 ELSE 0 END), 0) AS added FROM signals WHERE thesis = {:t} AND run > 0", { candidate: 0, fresh: 0, added: 0 }, { t: t.id });
    const maps = util.count(app, "SELECT COUNT(*) AS n FROM maps WHERE thesis = {:t} AND status = 'active'", { t: t.id });
    return {
      id: t.id,
      name: t.getString('name'),
      status: t.getString('status'),
      criteria: L('lib_theses').thesisOut(app, t).criteria,
      net_new: counts.candidate + counts.fresh,
      candidates: counts.candidate,
      unscreened: counts.fresh,
      added: counts.added,
      weekly: weekly,
      maps: maps,
      radar: r === null ? null : radarOut(app, r),
    };
  });
  return { theses: out, total: out.length };
}

/* ------------------------------------------------------------- signals */

/** The SQL condition of a signals.list call. */
function signalsWhere(ctx, p) {
  const util = u();
  const app = ctx.app;
  const where = ['run > 0'];
  const bind = {};
  if (util.str(p, 'radar', '') !== '') {
    where.push('radar = {:r}');
    bind.r = radarRef(app, util.str(p, 'radar', '')).id;
  }
  if (util.str(p, 'thesis', '') !== '') {
    where.push('thesis = {:t}');
    bind.t = thesisOf(app, util.str(p, 'thesis', '')).id;
  }
  const status = util.str(p, 'status', 'open');
  if (status === 'open') where.push("status IN ('new', 'candidate')");
  else if (status !== 'all') {
    if (STATUSES.indexOf(status) < 0) throw util.fail(400, 'status is open, all or one of: ' + STATUSES.join(', ') + '.', 'invalid_param', { param: 'status' });
    where.push('status = {:st}');
    bind.st = status;
  }
  if (util.str(p, 'source', '') !== '') {
    where.push('source = {:src}');
    bind.src = util.oneOf(p, 'source', SIGNAL_SOURCES, '');
  }
  if (util.has(p, 'run')) {
    where.push('run = {:run}');
    bind.run = util.int(p, 'run', 0, 0, 1000000);
  }
  return { sql: where.length > 0 ? where.join(' AND ') : '1=1', bind: bind };
}

/** signals.list: candidates first, then unscreened, newest first; paged by offset. */
function opSignals(ctx, p) {
  const util = u();
  const app = ctx.app;
  const w = signalsWhere(ctx, p);
  const pg = util.page(p, 50, 500);
  const total = util.count(app, 'SELECT COUNT(*) AS n FROM signals WHERE ' + w.sql, w.bind);
  const ids = util
    .rows(app, "SELECT id FROM signals WHERE " + w.sql + " ORDER BY CASE status WHEN 'candidate' THEN 0 WHEN 'new' THEN 1 ELSE 2 END, created DESC, id LIMIT " + pg.limit + ' OFFSET ' + pg.offset, { id: '' }, w.bind)
    .map((r) => r.id);
  const out = ids.map((id) => signalOut(app, app.findRecordById('signals', id)));
  return { signals: out, total: total, next_offset: pg.offset + out.length < total ? pg.offset + out.length : null };
}

/** The radar a call names (--radar, or --thesis for the thesis's radar). */
function radarParam(app, p) {
  const util = u();
  if (util.str(p, 'radar', '') !== '') return radarRef(app, util.str(p, 'radar', ''));
  if (util.str(p, 'thesis', '') !== '') return radarRef(app, util.str(p, 'thesis', ''));
  throw util.fail(400, 'Give --radar (or --thesis).', 'missing_param', { param: 'radar' });
}

/** signals.add: a candidate from your AI agent's research (or a person), with its source. Repeats answer the existing signal. */
function opAdd(ctx, p) {
  const util = u();
  const app = ctx.app;
  const n = L('lib_norm');
  const radar = radarParam(app, p);
  const source = util.oneOf(p, 'source', SIGNAL_SOURCES, ctx.isAgent ? 'agent' : 'person');
  if ((ctx.isAgent && source === 'person') || (!ctx.isAgent && source === 'agent')) throw util.fail(400, 'source ' + source + ' is for ' + (source === 'agent' ? 'your AI agent' : 'people') + '.', 'invalid_param', { param: 'source' });
  const sourceUrl = util.text(p, 'source_url', 1000, '');
  if (ctx.isAgent && !/^https?:\/\//i.test(sourceUrl)) throw util.fail(400, 'source_url is required: the link where you found it.', 'missing_param', { param: 'source_url' });
  const summary = util.squash(util.text(p, 'summary', 240, ''));
  if (ctx.isAgent && summary === '') throw util.fail(400, 'summary is required: one line on why it fits the thesis.', 'missing_param', { param: 'summary' });
  const website = util.text(p, 'website', 500, '');
  const domain = P().companyDomain(util.str(p, 'domain', '') || website);
  const name = util.squash(util.text(p, 'name', 200, ''));
  if (name === '' && domain === '') throw util.fail(400, 'Give --name or --domain (or --website) of the company.', 'missing_param', { param: 'name' });
  const extId = util.text(p, 'ext_id', 120, '');
  const dup = duplicateIn(app, radar.id, source, extId, domain) || (name !== '' ? util.findOne(app, 'signals', "radar = {:r} && name = {:n} && name != ''", { r: radar.id, n: name }) : null);
  if (dup !== null) return { signal: signalOut(app, dup), duplicate: true, message: 'Already on this radar (' + dup.getString('status') + '). Nothing added.' };
  const it = {
    ext_id: extId,
    kind: util.oneOf(p, 'kind', KINDS, (SOURCES.filter((x) => x.key === source)[0] || {}).kind || 'other'),
    name: name,
    domain: domain,
    website: website !== '' ? n.url(website) : domain !== '' ? n.url(domain) : '',
    title: util.text(p, 'title', 300, '') || name || domain,
    summary: summary,
    source_url: sourceUrl,
    facts: cleanFacts(util.obj(p, 'facts')),
    context: cleanContext(util.obj(p, 'context')) || {},
    payload: {},
    licence: util.oneOf(p, 'licence', ['public', 'internal_only'], 'public'),
    screened: true,
  };
  const r = app.findRecordById('radars', radar.id);
  const rec = store(app, ctx, r, Math.max(1, r.getInt('runs')), r.getString('last_run_at') || util.nowIso(), source, it, null);
  L('lib_audit').note(ctx, { collection: 'signals', record: rec.id, summary: 'Added the candidate ' + (name || domain) + ' (' + rec.getString('status') + ')' });
  const out = { signal: signalOut(app, rec) };
  if (rec.getString('status') === 'known') out.message = 'Already in the firm\'s records (' + rec.getString('known_as') + '): kept as known, not a candidate.';
  if (rec.getString('status') === 'screened_out') out.message = 'A required thesis criterion is unmet by these facts: kept as screened out.';
  return out;
}

function idsParam(p, name) {
  const util = u();
  const raw = util.has(p, name) ? util.scalar(p[name]) : undefined;
  let v;
  if (typeof raw === 'string' && raw.trim().charAt(0) !== '[') v = raw.trim() === '' ? [] : [raw.trim()];
  else v = util.list(p, name) || [];
  if (v.length === 0) throw util.fail(400, name + ' is required: a signal id or a JSON list of ids.', 'missing_param', { param: name });
  if (v.length > 200) throw util.fail(400, 'At most 200 at once.', 'too_many');
  return v.map((x) => String(x));
}

function signalRef(app, id) {
  const s = u().byId(app, 'signals', id);
  if (s === null) throw u().fail(404, 'No signal ' + id + '. Run signals.list.', 'not_found', { ref: id });
  return s;
}

/** signals.screen: your AI agent's verdict on new signals, one by one in a batch. */
function opScreen(ctx, p) {
  const util = u();
  const app = ctx.app;
  const raw = util.list(p, 'items');
  if (raw === undefined || raw.length === 0) throw util.fail(400, 'items is a JSON list [{"id","keep":true,"summary":"one line","context":{...}} | {"id","keep":false,"reason":"..."}].', 'missing_param', { param: 'items' });
  if (raw.length > 100) throw util.fail(400, 'At most 100 at once.', 'too_many');
  const done = [];
  raw.forEach((x, i) => {
    const where = 'Item ' + (i + 1);
    if (x === null || typeof x !== 'object' || Array.isArray(x)) throw util.fail(400, where + ' must be an object.', 'invalid_param', { param: 'items' });
    util.keysOnly(x, ['id', 'keep', 'summary', 'reason', 'context', 'facts', 'name', 'domain', 'website', 'kind', 'licence'], where);
    if (typeof x.keep !== 'boolean') throw util.fail(400, where + ': keep is true or false.', 'invalid_param', { param: 'items' });
    const s = signalRef(app, String(x.id || ''));
    if (OPEN.indexOf(s.getString('status')) < 0) throw util.fail(409, where + ': ' + (s.getString('name') || s.getString('title')) + ' is ' + s.getString('status') + ', not open to screening.', 'conflict', { id: s.id });
    if (x.name !== undefined) s.set('name', util.clip(util.squash(String(x.name)), 200));
    if (x.domain !== undefined || x.website !== undefined) {
      const d = P().companyDomain(String(x.domain || x.website || ''));
      if (d !== '') s.set('domain', d);
      if (x.website !== undefined) s.set('website', util.clip(L('lib_norm').url(String(x.website)), 500));
    }
    if (x.kind !== undefined) {
      if (KINDS.indexOf(x.kind) < 0) throw util.fail(400, where + ': kind is one of ' + KINDS.join(', ') + '.', 'invalid_param', { param: 'items' });
      s.set('kind', x.kind);
    }
    if (x.licence !== undefined) s.set('licence', x.licence === 'internal_only' ? 'internal_only' : 'public');
    if (x.context !== undefined) s.set('context', Object.assign(util.jsonOf(s, 'context', {}) || {}, cleanContext(x.context)));
    if (x.facts !== undefined) {
      const facts = Object.assign(util.jsonOf(s, 'facts', {}) || {}, cleanFacts(x.facts));
      s.set('facts', facts);
      s.set('fit', fitOf(app, s.getString('thesis'), facts));
    }
    if (x.keep) {
      const summary = util.squash(String(x.summary || ''));
      if (summary === '') throw util.fail(400, where + ': summary (one line on why it fits) is required to keep it.', 'missing_param', { param: 'items' });
      s.set('summary', util.clip(summary, 240));
      const known = knownAs(app, s.getString('domain'), s.getString('name'));
      const fit = util.jsonOf(s, 'fit', null);
      if (known !== '') {
        s.set('status', 'known');
        s.set('company', known);
        s.set('known_as', 'company:' + known);
      } else if (fit !== null && fit.state === 'unmet') {
        s.set('status', 'screened_out');
        s.set('reason', 'thesis_unmet');
      } else s.set('status', 'candidate');
    } else {
      s.set('status', 'screened_out');
      s.set('reason', util.clip(util.squash(String(x.reason || 'agent')), 300));
    }
    s.set('screened_at', util.nowIso());
    app.save(s);
    done.push({ id: s.id, status: s.getString('status') });
  });
  const kept = done.filter((d) => d.status === 'candidate').length;
  if (ctx.isAgent) {
    // Your AI agent's screening lands the sweep asked of each radar it screened.
    const seen = {};
    for (const d of done) {
      const s = app.findRecordById('signals', d.id);
      const rid = s.getString('radar');
      if (rid === '' || seen[rid]) continue;
      seen[rid] = true;
      const r = util.byId(app, 'radars', rid);
      if (r !== null) L('lib_agent').landed(app, 'radar_sweep', r);
    }
  }
  L('lib_audit').note(ctx, { collection: 'signals', record: done.length === 1 ? done[0].id : '', summary: 'Screened ' + done.length + ' signals (' + kept + ' candidates)' });
  return { screened: done.length, candidates: kept, items: done };
}

/** signals.dismiss: a person sets candidates aside (one click; an optional reason chip). */
function opDismiss(ctx, p) {
  const util = u();
  const app = ctx.app;
  const ids = idsParam(p, 'signals');
  const reason = util.oneOf(p, 'reason', DISMISS_REASONS, '');
  const out = [];
  for (const id of ids) {
    const s = signalRef(app, id);
    if (OPEN.indexOf(s.getString('status')) < 0) continue;
    s.set('status', 'dismissed');
    s.set('reason', reason);
    s.set('decided_at', util.nowIso());
    s.set('decided_by', ctx.memberId || '');
    app.save(s);
    out.push(s.id);
  }
  L('lib_audit').note(ctx, { collection: 'signals', record: out.length === 1 ? out[0] : '', summary: 'Dismissed ' + out.length + (out.length === 1 ? ' candidate' : ' candidates') });
  return { dismissed: out.length, signals: out };
}

/** The text an Inbox item starts from (data for triage: what was found and where). */
function inboxText(app, s) {
  const lines = [];
  const t = u().byId(app, 'theses', s.getString('thesis'));
  lines.push('Sourced by the radar ' + (t ? t.getString('name') : '') + ' (' + srcLabel(s.getString('source')) + ').');
  if (s.getString('summary') !== '') lines.push(s.getString('summary'));
  if (s.getString('title') !== '' && s.getString('title') !== s.getString('name')) lines.push(s.getString('title'));
  const ctxt = u().jsonOf(s, 'context', {}) || {};
  for (const k of CONTEXT_KEYS) if (k !== 'links' && ctxt[k]) lines.push(k.charAt(0).toUpperCase() + k.slice(1) + ': ' + ctxt[k]);
  if (s.getString('source_url') !== '') lines.push('Source: ' + s.getString('source_url'));
  return lines.join('\n');
}

/** signals.to-inbox: a person adds candidates to the Inbox (channel sourced); each becomes an intake item. */
function opToInbox(ctx, p) {
  const util = u();
  const app = ctx.app;
  const ids = idsParam(p, 'signals');
  const R = L('lib_records');
  const added = [];
  for (const id of ids) {
    const s = signalRef(app, id);
    if (OPEN.indexOf(s.getString('status')) < 0) continue;
    let company = s.getString('company');
    if (company === '' && (s.getString('name') !== '' || s.getString('domain') !== '')) {
      const c = R.upsertCompany(ctx, { name: s.getString('name') || undefined, domain: s.getString('domain') || undefined, website: s.getString('website') || undefined, origin: 'markets', source_ref: s.getString('source_url') });
      company = c.id;
    }
    // The source link (an SEC filing, a Show HN post, a repository) goes in the text, never as the item's
    // url: intake would read its host as the company's website. The licence travels as intake's own field.
    const item = L('lib_intake').add(ctx, {
      channel: 'sourced',
      company: company !== '' ? company : undefined,
      name: company === '' ? s.getString('name') || s.getString('title') || undefined : undefined,
      website: s.getString('website') || undefined,
      text: inboxText(app, s),
      thesis: s.getString('thesis'),
      licence: s.getString('licence') === 'internal_only' ? 'internal_only' : 'public',
    });
    const rec = app.findRecordById('signals', s.id);
    rec.set('status', 'added');
    rec.set('company', company);
    rec.set('intake_item', String((item && item.id) || ''));
    rec.set('decided_at', util.nowIso());
    rec.set('decided_by', ctx.memberId || '');
    app.save(rec);
    added.push({ signal: rec.id, intake_item: rec.getString('intake_item'), company: company, number: (item && item.number) || '' });
  }
  L('lib_audit').note(ctx, { collection: 'signals', record: added.length === 1 ? added[0].signal : '', summary: 'Added ' + added.length + ' sourced ' + (added.length === 1 ? 'company' : 'companies') + ' to the Inbox' });
  return { added: added.length, items: added };
}

/* ----------------------------------------------- contract, Next, search */

/** lib_markets.candidatesFor(ctx, thesisId) -> signals: the thesis's net-new candidates (screened in, not decided). */
function candidatesFor(ctx, thesisId) {
  const app = ctx.app;
  const t = thesisOf(app, thesisId);
  return app.findRecordsByFilter('signals', "thesis = {:t} && run > 0 && status = 'candidate'", '-created', 500, 0, { t: t.id }).map((s) => signalOut(app, s));
}

/**
 * Next: one "candidate" item per radar run with open signals (rank 60).
 * Unscreened signals of the newest run wait while your AI agent screens
 * them (its sweep is asked and not answered); after that, or for older runs, they show
 * too, marked unscreened, so a person can always do the work by hand.
 */
function needsYou(ctx) {
  const util = u();
  const app = ctx.app;
  if (ctx.isAgent || !L('lib_auth').can(ctx, 'markets', 'view')) return [];
  const out = [];
  for (const r of app.findRecordsByFilter('radars', '1=1', 'created', 0, 0)) {
    const t = util.byId(app, 'theses', r.getString('thesis'));
    if (t === null || t.getString('status') !== 'active') continue;
    const busy = sweeping(r);
    const rows = app.findRecordsByFilter('signals', "radar = {:r} && run > 0 && (status = 'new' || status = 'candidate')", '-run,status,-created', 400, 0, { r: r.id });
    const runs = {};
    const order = [];
    for (const s of rows) {
      const run = s.getInt('run');
      if (s.getString('status') === 'new' && busy && run === r.getInt('runs')) continue;
      if (runs[run] === undefined) {
        runs[run] = [];
        order.push(run);
      }
      runs[run].push(s);
    }
    for (const run of order) {
      const list = runs[run];
      const cand = list.filter((s) => s.getString('status') === 'candidate').length;
      const raw = list.length - cand;
      const ids = list.map((s) => s.id);
      const srcs = [];
      for (const s of list) if (srcs.indexOf(srcLabel(s.getString('source'))) < 0) srcs.push(srcLabel(s.getString('source')));
      const chips = srcs.slice(0, 3).map((x) => ({ label: x, tone: x === 'Your AI agent' ? 'agent' : 'neutral' }));
      if (raw > 0) chips.push({ label: raw + ' unscreened', tone: 'warn' });
      out.push({
        key: 'markets:run:' + r.id + ':' + run,
        kind: 'candidate',
        card: 'candidates',
        title: t.getString('name') + ' · ' + list.length + ' new',
        figures: [{ label: 'New', value: String(list.length) }],
        chips: chips,
        agent: cand > 0,
        rank: 60,
        at: list[0].getString('run_at') || list[0].getString('created'),
        href: '#/markets/' + t.id,
        data: { thesis: { id: t.id, name: t.getString('name') }, radar: r.id, run: run, candidates: list.slice(0, 40).map((s) => signalBrief(s)), more: Math.max(0, list.length - 40) },
        actions: [
          { label: 'Add all', op: 'signals.to-inbox', params: { signals: ids }, primary: true },
          { label: 'Dismiss all', op: 'signals.dismiss', params: { signals: ids } },
        ],
      });
    }
  }
  return out;
}

/** Ctrl-K: theses and maps by name. */
function search(ctx, q, limit) {
  const util = u();
  const app = ctx.app;
  if (!ctx.isAgent && !L('lib_auth').can(ctx, 'markets', 'view')) return [];
  const per = Math.max(1, Math.min(20, Number(limit) || 6));
  const like = util.like(q);
  const out = [];
  for (const r of util.rows(app, "SELECT id, name, status FROM theses WHERE name LIKE {:q} ESCAPE '\\' ORDER BY sort, name LIMIT " + per, { id: '', name: '', status: '' }, { q: like }))
    out.push({ kind: 'thesis', id: r.id, title: r.name, subtitle: r.status === 'active' ? 'Thesis' : 'Thesis, archived', href: '#/markets/' + r.id, icon: 'Target' });
  for (const r of util.rows(app, "SELECT id, name, thesis FROM maps WHERE status = 'active' AND name LIKE {:q} ESCAPE '\\' ORDER BY name LIMIT " + per, { id: '', name: '', thesis: '' }, { q: like }))
    out.push({ kind: 'map', id: r.id, title: r.name, subtitle: 'Market map', href: r.thesis !== '' ? '#/markets/' + r.thesis + '/map' : '#/markets', icon: 'LayoutGrid' });
  return out;
}

/** A company's (or a deal's company's) timeline: where markets found it, and the maps it sits on. */
function timelineFor(ctx, t) {
  const util = u();
  const app = ctx.app;
  let company = '';
  if (t.kind === 'company') company = t.id;
  else if (t.kind === 'deal') {
    const d = util.byId(app, 'deals', t.id);
    company = d ? d.getString('company') : '';
  }
  if (company === '') return [];
  const items = [];
  for (const s of app.findRecordsByFilter('signals', "company = {:c} && (status = 'added' || status = 'known')", '-created', 20, 0, { c: company })) {
    const th = util.byId(app, 'theses', s.getString('thesis'));
    items.push({ at: s.getString('decided_at') || s.getString('created'), kind: 'sourced', title: (s.getString('status') === 'added' ? 'Sourced by the radar ' : 'Seen by the radar ') + (th ? th.getString('name') : '') + ' (' + srcLabel(s.getString('source')) + ')', icon: 'Radar', href: th ? '#/markets/' + th.id : '', actor: s.getString('actor'), ref: { collection: 'signals', id: s.id } });
  }
  for (const e of app.findRecordsByFilter('map_entries', "company = {:c} && status = 'active'", '-created', 20, 0, { c: company })) {
    const m = util.byId(app, 'maps', e.getString('map'));
    if (m === null) continue;
    items.push({ at: e.getString('created'), kind: 'mapped', title: 'On the map ' + m.getString('name'), icon: 'LayoutGrid', href: m.getString('thesis') !== '' ? '#/markets/' + m.getString('thesis') + '/map' : '#/markets', actor: e.getString('actor'), ref: { collection: 'map_entries', id: e.id } });
  }
  return items;
}

/* ---------------------------------------------------------------- cron */

/** Every minute: run the radars that are due (a few per tick; the rest wait for the next minute). */
function cronRadars(app) {
  const util = u();
  const now = new Date().toISOString();
  const ctx = L('lib_auth').systemCtx(app);
  for (const r of app.findRecordsByFilter('radars', "status = 'active' && next_run_at = ''", '', 50, 0)) {
    r.set('next_run_at', nextRun(app, util.jsonOf(r, 'schedule', null), Date.now()));
    app.save(r);
  }
  const due = app.findRecordsByFilter('radars', "status = 'active' && next_run_at != '' && next_run_at <= {:n}", 'next_run_at', PER_TICK, 0, { n: now });
  for (const r of due) {
    // Claim the run first: a minute tick that starts while this one is still pulling skips it.
    r.set('next_run_at', nextRun(app, util.jsonOf(r, 'schedule', null), Date.now()));
    app.save(r);
    try {
      runOf(app, ctx, r);
    } catch (err) {
      console.error('[vo] radar ' + r.id + ' failed:', err);
      const again = app.findRecordById('radars', r.id);
      again.set('last_counts', { error: String((err && err.message) || err).slice(0, 200) });
      app.save(again);
    }
  }
  L('lib_bus').flush(app);
}

/** Every 15 minutes: read new Form D filings and Show HN stories for each active radar (delivered with its next run). */
function cronPrefetch(app) {
  const util = u();
  const ctx = L('lib_auth').systemCtx(app);
  for (const r of app.findRecordsByFilter('radars', "status = 'active'", 'created', 0, 0)) {
    const sources = util.jsonOf(r, 'sources', []) || [];
    if (sources.indexOf('edgar_form_d') < 0 && sources.indexOf('hacker_news') < 0) continue;
    try {
      pullInto(app, ctx, r, ['edgar_form_d', 'hacker_news'], true);
    } catch (err) {
      console.error('[vo] radar prefetch ' + r.id + ' failed:', err);
    }
  }
}

/** Nightly: signals screened out or known more than 60 days ago are deleted (the feeds no longer show them). */
function cronCleanup(app) {
  const util = u();
  const before = new Date(Date.now() - CLEAN_DAYS * 86400000).toISOString().replace('T', ' ');
  util.exec(app, "DELETE FROM signals WHERE status IN ('screened_out', 'known') AND created < {:b}", { b: before });
}

/** agent.ask --trigger radar_sweep --record <radar>: a radar of an active thesis that ran at least once. */
function sweepCheck(ctx, r) {
  L('lib_auth').need(ctx, 'markets', 'edit', 'ask your AI agent to sweep a radar');
  if (r.getInt('runs') === 0) throw u().fail(409, 'Run the radar first (radars.run): your AI agent screens what a run pulled.', 'nothing_to_do');
  return {};
}

module.exports = {
  sweepCheck: sweepCheck,
  SOURCES: SOURCES,
  SOURCE_KEYS: SOURCE_KEYS,
  SIGNAL_SOURCES: SIGNAL_SOURCES,
  KINDS: KINDS,
  STATUSES: STATUSES,
  DISMISS_REASONS: DISMISS_REASONS,
  CONTEXT_KEYS: CONTEXT_KEYS,
  SECTORS: SECTORS,
  DEFAULT_SCHEDULE: DEFAULT_SCHEDULE,
  settingsOf: settingsOf,
  userAgent: userAgent,
  defaultFilters: defaultFilters,
  cleanFilters: cleanFilters,
  cleanSchedule: cleanSchedule,
  scheduleLabel: scheduleLabel,
  nextRun: nextRun,
  radarOut: radarOut,
  signalOut: signalOut,
  signalBrief: signalBrief,
  radarRef: radarRef,
  knownAs: knownAs,
  fitOf: fitOf,
  runOf: runOf,
  opOptions: opOptions,
  opList: opList,
  opGet: opGet,
  opSave: opSave,
  previewSave: previewSave,
  opRun: opRun,
  opSummary: opSummary,
  opSignals: opSignals,
  opAdd: opAdd,
  opScreen: opScreen,
  opDismiss: opDismiss,
  opToInbox: opToInbox,
  candidatesFor: candidatesFor,
  needsYou: needsYou,
  search: search,
  timelineFor: timelineFor,
  cronRadars: cronRadars,
  cronPrefetch: cronPrefetch,
  cronCleanup: cronCleanup,
  pullInto: pullInto,
};
