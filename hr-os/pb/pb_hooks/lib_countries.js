/// <reference path="../pb_data/types.d.ts" />
/**
 * Country metadata, auto-discovered from pb/pb_hooks/data/countries/<cc>.js
 * (plain data modules written by the packs builders; shape in
 * reference/notes/kernel-backend.md): code, name, currency, timezone, date
 * format, week start, weekend days, name order, regions, ID document types
 * with masks, statutory pack codes, bank file formats, default work week,
 * employment types, leave types, minimum wage and public holidays.
 *
 * Speed: the country and pack files are large (about 1 MB of data), and
 * every PocketBase runtime of the pool would load them again on its first
 * request. Boot (warm) builds two small indexes once and keeps them in the
 * app store (shared by every runtime): the country summaries and the pack
 * versions with their profile fields. Reads use the indexes; get(code)
 * loads only that country's file, packOn only that pack's file.
 */

const STORE_COUNTRIES = 'hr_country_index_v1';
const STORE_PACKS = 'hr_pack_index_v1';

const DEFAULT_EMPLOYMENT_TYPES = [
  { code: 'full_time', name: 'Full time' },
  { code: 'part_time', name: 'Part time' },
  { code: 'fixed_term', name: 'Fixed term' },
  { code: 'contractor', name: 'Contractor' },
  { code: 'intern', name: 'Intern' },
];
const DEFAULT_SCHEDULE = { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:30', break_min: 60 };

let cache = null;
let countryIndex = null;
let packIndex = null;

function dir() {
  return $filepath.join(__hooks, 'data', 'countries');
}

function load() {
  const out = {};
  let entries = [];
  try {
    entries = $os.readDir(dir());
  } catch {
    entries = [];
  }
  for (const f of entries) {
    const n = f.name();
    if (!/^[a-z]{2}\.js$/.test(n)) continue;
    const c = require(`${__hooks}/data/countries/${n}`);
    if (!c || String(c.code || '').toUpperCase() !== n.slice(0, 2).toUpperCase()) {
      console.error('[hr] data/countries/' + n + ': code must be ' + n.slice(0, 2).toUpperCase());
      continue;
    }
    out[n.slice(0, 2).toUpperCase()] = c;
  }
  return out;
}

function all() {
  if (cache === null) cache = load();
  return cache;
}

/** Problems with a country module (the shape the kernel reads). */
function problems(c) {
  const out = [];
  const reqStr = ['code', 'name', 'currency', 'timezone', 'date_format', 'name_order'];
  for (const k of reqStr) if (typeof c[k] !== 'string' || c[k] === '') out.push(k + ' is required');
  if (typeof c.week_start !== 'number') out.push('week_start is required (0 = Sunday)');
  if (!Array.isArray(c.weekend)) out.push('weekend is required (list of weekdays, 0 = Sunday)');
  if (c.name_order && ['family_first', 'given_first'].indexOf(c.name_order) < 0) out.push('name_order must be family_first or given_first');
  for (const h of c.holidays || []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(h.day || ''))) out.push('holiday with a bad day: ' + JSON.stringify(h));
    if (['public', 'company', 'optional', 'observed'].indexOf(h.kind || 'public') < 0) out.push('holiday kind must be public, company, optional or observed: ' + JSON.stringify(h));
  }
  return out;
}

/** A short view for lists and setup. */
function summary(c) {
  return {
    code: c.code,
    name: c.name,
    currency: c.currency,
    timezone: c.timezone,
    timezones: c.timezones || [c.timezone],
    date_format: c.date_format,
    week_start: c.week_start,
    weekend: c.weekend || [0, 6],
    name_order: c.name_order || 'given_first',
    regions: c.regions || [],
    packs: c.packs || [],
    region_packs: c.region_packs || {},
    has_holidays: (c.holidays || []).length > 0,
    holiday_years: years(c),
  };
}

function years(c) {
  const ys = {};
  for (const h of c.holidays || []) ys[String(h.day).slice(0, 4)] = true;
  return Object.keys(ys).sort();
}

/** A JSON value kept in the app store (shared by every runtime); each runtime parses it once. */
function stored(key, build) {
  let raw = null;
  try {
    raw = $app.store().get(key);
  } catch {
    raw = null;
  }
  if (typeof raw === 'string' && raw !== '') return JSON.parse(raw);
  const value = build();
  try {
    $app.store().set(key, JSON.stringify(value));
  } catch {
    /* outside PocketBase (Node tools) there is no store */
  }
  return value;
}

function countrySummaries() {
  const a = all();
  const out = {};
  for (const k of Object.keys(a)) out[k] = summary(a[k]);
  return out;
}

function packEntries() {
  return builtinPacks().map((p) => ({ code: p.code, name: p.name || p.code, version: p.version, effective_from: p.effective_from || '', effective_to: p.effective_to || '', file: p.__file, profile_fields: p.profile_fields || [] }));
}

/** Country summaries by code. */
function index() {
  if (countryIndex === null) countryIndex = stored(STORE_COUNTRIES, countrySummaries);
  return countryIndex;
}

/** Every discovered country, by name. */
function list() {
  const a = index();
  return Object.keys(a)
    .map((k) => a[k])
    .sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
}

/** One country's summary (its list() row) or null: what views need, without loading the file. */
function info(code) {
  return index()[String(code || '').toUpperCase()] || null;
}

/** The full country module (throws 400 for an unknown code). Loads only that country's file. */
function get(code) {
  const k = String(code || '')
    .trim()
    .toUpperCase();
  if (cache !== null && cache[k] !== undefined) return cache[k];
  if (index()[k] === undefined) {
    const u = require(`${__hooks}/lib_util.js`);
    const known = Object.keys(index()).sort();
    throw u.fail(400, 'Unknown country "' + code + '". Countries: ' + (known.length > 0 ? known.join(', ') : 'none installed') + '.', 'unknown_country', { country: k });
  }
  return require(`${__hooks}/data/countries/${k.toLowerCase()}.js`);
}

function has(code) {
  return index()[String(code || '').toUpperCase()] !== undefined;
}

/** Holidays of a country for the given years: region '' rows plus the region's rows. */
function holidays(code, yearsWanted, region) {
  const c = get(code);
  const ys = (yearsWanted || []).map(String);
  return (c.holidays || []).filter((h) => (ys.length === 0 || ys.indexOf(String(h.day).slice(0, 4)) >= 0) && (!h.region || h.region === '' || h.region === (region || '')));
}

/** Pack codes a new entity in this country enables (country packs plus the region's). */
function packsFor(code, region) {
  const c = get(code);
  const out = (c.packs || []).slice();
  const extra = (c.region_packs || {})[region || ''] || [];
  for (const p of extra) if (out.indexOf(p) < 0) out.push(p);
  return out;
}

function employmentTypes(code) {
  const c = get(code);
  return Array.isArray(c.employment_types) && c.employment_types.length > 0 ? c.employment_types : DEFAULT_EMPLOYMENT_TYPES;
}

function schedule(code) {
  const c = get(code);
  return c.schedule || DEFAULT_SCHEDULE;
}

function idTypes(code) {
  return get(code).id_types || [];
}

/* ------------------------------------------------------------ rule packs */

/** The built-in packs in pb/pb_hooks/packs/*.js (plain data modules; files starting with _ are helpers, not packs). */
function builtinPacks() {
  const out = [];
  let entries = [];
  try {
    entries = $os.readDir($filepath.join(__hooks, 'packs'));
  } catch {
    entries = [];
  }
  for (const f of entries) {
    const n = f.name();
    if (!/^[a-z0-9][a-z0-9_-]*\.js$/.test(n)) continue;
    const pack = require(`${__hooks}/packs/${n}`);
    if (!pack || typeof pack.code !== 'string' || typeof pack.version !== 'string') {
      console.error('[hr] packs/' + n + ' has no code or version; not seeded');
      continue;
    }
    Object.defineProperty(pack, '__file', { value: n, enumerable: false, configurable: true });
    out.push(pack);
  }
  return out;
}

/** Pack versions with their file and profile fields. */
function packIdx() {
  if (packIndex === null) packIndex = stored(STORE_PACKS, packEntries);
  return packIndex;
}

/** The index entry of the version of `code` in effect on `day` (else the newest), or null. */
function entryOn(code, day) {
  let best = null;
  let newest = null;
  for (const p of packIdx()) {
    if (p.code !== code) continue;
    if (newest === null || String(p.effective_from || '') > String(newest.effective_from || '')) newest = p;
    const from = String(p.effective_from || '');
    const to = String(p.effective_to || '');
    if ((from === '' || from <= day) && (to === '' || to >= day) && (best === null || from > String(best.effective_from || ''))) best = p;
  }
  return best || newest;
}

/** The built-in pack version of `code` in effect on `day` (else the newest), or null. Loads only that pack's file. */
function packOn(code, day) {
  const e = entryOn(code, day);
  return e === null ? null : require(`${__hooks}/packs/${e.file}`);
}

/**
 * The profile fields of the packs an entity enables, merged in pack order,
 * for the hire form and the tax panel: [{ pack, version, key, label, type,
 * options, default, required, help, form, scope }] (scope 'entity' fields
 * belong to the employer, the rest to each employee's tax profile).
 */
function profileFields(packCodes, day) {
  const out = [];
  const seen = {};
  for (const code of packCodes || []) {
    const p = entryOn(code, day);
    if (p === null) continue;
    for (const f of p.profile_fields || []) {
      if (!f || !f.key || seen[code + ':' + f.key]) continue;
      seen[code + ':' + f.key] = true;
      out.push({ pack: p.code, version: p.version, key: f.key, label: f.label || f.key, type: f.type || 'text', options: f.options || [], default: f.default === undefined ? null : f.default, required: f.required === true, help: f.help || '', form: f.form || '', scope: f.scope === 'entity' ? 'entity' : 'employee' });
    }
  }
  return out;
}

/**
 * Boot: insert each built-in pack version that rule_packs does not have yet
 * (code + version). `ship: 'active'` packs are seeded active only when
 * lib_packcheck.validate(pack, others) has no error and runVectors(pack,
 * others) passes every vector, else draft; `ship: 'draft'`
 * packs are seeded as drafts a person completes and activates.
 */
function seedPacks(app) {
  const u = require(`${__hooks}/lib_util.js`);
  const packs = builtinPacks();
  if (packs.length === 0) return { inserted: 0, active: 0 };
  const check = require(`${__hooks}/lib_packcheck.js`);
  let inserted = 0;
  let active = 0;
  for (const pack of packs) {
    if (u.findOne(app, 'rule_packs', 'code = {:c} && version = {:v}', { c: pack.code, v: pack.version }) !== null) continue;
    let passed = 0;
    let total = 0;
    let ok = false;
    let problems = [];
    try {
      const others = packs.filter((x) => x !== pack);
      problems = (check.validate(pack, others) || []).filter((x) => x && x.level === 'error');
      const res = check.runVectors(pack, others);
      passed = res.passed;
      total = res.total;
      ok = problems.length === 0 && total > 0 && res.passed === res.total;
      if (!ok && pack.ship === 'active') console.error('[hr] pack ' + pack.code + ' ' + pack.version + ' did not pass its checks (vectors ' + passed + '/' + total + ', ' + problems.length + ' errors); seeded as a draft. ' + JSON.stringify(problems.slice(0, 3).concat((res.failures || []).slice(0, 3))));
    } catch (err) {
      console.error('[hr] pack ' + pack.code + ' ' + pack.version + ' could not be checked:', err);
    }
    const status = pack.ship === 'active' && ok ? 'active' : 'draft';
    const r = u.newRecord(app, 'rule_packs');
    r.set('code', pack.code);
    r.set('country', pack.country || '');
    r.set('region', pack.region || '');
    r.set('name', u.clip(pack.name || pack.code, 200));
    r.set('version', pack.version);
    r.set('effective_from', pack.effective_from || '');
    r.set('effective_to', pack.effective_to || '');
    r.set('status', status);
    r.set('body', JSON.parse(JSON.stringify(pack)));
    r.set('vectors_passed', passed);
    r.set('vectors_total', total);
    r.set('tested_at', u.nowIso());
    r.set('activated_at', status === 'active' ? u.nowIso() : '');
    r.set('source', 'builtin');
    r.set('notes', u.clip(pack.notes || '', 4000));
    app.save(r);
    inserted++;
    if (status === 'active') active++;
  }
  return { inserted: inserted, active: active };
}

/**
 * Boot: build the country and pack indexes from the files and keep them in
 * the app store, so no runtime loads the files to answer a read.
 */
function warm(app) {
  const countries = countrySummaries();
  const packs = packEntries();
  app.store().set(STORE_COUNTRIES, JSON.stringify(countries));
  app.store().set(STORE_PACKS, JSON.stringify(packs));
  countryIndex = countries;
  packIndex = packs;
  return { countries: Object.keys(countries).length, packs: packs.length };
}

/* ------------------------------------------------------------------- ops */

/** Display names of pack codes ({ code: name }, the newest version's name). */
function packNames(codes) {
  const out = {};
  for (const code of codes || []) {
    const e = entryOn(code, '9999-12-31');
    out[code] = e !== null ? e.name || code : code;
  }
  return out;
}

function listOp() {
  return {
    countries: list().map((c) => {
      const extra = {};
      for (const k of Object.keys(c.region_packs || {})) for (const code of c.region_packs[k]) extra[code] = true;
      return Object.assign({}, c, { pack_names: packNames((c.packs || []).concat(Object.keys(extra))) });
    }),
  };
}

function getOp(ctx, p) {
  const u = require(`${__hooks}/lib_util.js`);
  const c = get(u.req(p, 'country', 'SG'));
  return {
    country: Object.assign(summary(c), {
      id_types: c.id_types || [],
      bank_formats: c.bank_formats || [],
      schedule: schedule(c.code),
      employment_types: employmentTypes(c.code),
      leave_types: c.leave_types || [],
      min_wage: c.min_wage || null,
      region_packs: c.region_packs || {},
      sources: c.sources || [],
      notes: c.notes || '',
      problems: problems(c),
    }),
  };
}

module.exports = { warm: warm, info: info, builtinPacks: builtinPacks, packOn: packOn, profileFields: profileFields, seedPacks: seedPacks, DEFAULT_EMPLOYMENT_TYPES: DEFAULT_EMPLOYMENT_TYPES, DEFAULT_SCHEDULE: DEFAULT_SCHEDULE, all: all, list: list, get: get, has: has, holidays: holidays, packsFor: packsFor, employmentTypes: employmentTypes, schedule: schedule, idTypes: idTypes, problems: problems, summary: summary, listOp: listOp, getOp: getOp };
