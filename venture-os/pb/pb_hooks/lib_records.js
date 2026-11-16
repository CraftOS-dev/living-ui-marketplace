/// <reference path="../pb_data/types.d.ts" />
/**
 * The firm's global records: people and companies (kernel-records, SPEC 4.5).
 *
 * Identity (CRM lib_norm): a person by lowercased email, a company by root
 * domain; a free-mail domain never makes a company. Without an email or a
 * domain, a record is matched by its normalized name (a person only within
 * the same company); several matches answer 409 with the candidates.
 *
 * Provenance: every written field keeps prov[field] = { by, at, run, source,
 * member } (by: person, agent or system). The rule for your AI agent:
 *   - it creates new records and fills empty fields directly (tagged by);
 *   - it may change a value it (or the app) wrote, and add to a list;
 *   - changing a value a person entered is a proposal (people.update or
 *     companies.update, kind `fields`) unless the owner promoted that kind.
 *
 * Writes go through ctx.app: inside an op that is the kernel's activity
 * tracker, so an op (a merge with every link it moved, a person with the
 * company their email named) is undone as one unit; the answer's _activity
 * names it. Events (emitted with the same handle, so subscribers' writes
 * join the unit): person.created { person }, company.created { company },
 * record.merged { kind, keep, drop }.
 *
 * Exports for other modules (exact signatures):
 *   upsertCompany(ctx, { company?, name?, domain?, website?, ...fields, origin?, source_ref? }) -> company view (+ created, proposal)
 *   upsertPerson(ctx, { person?, email?, name?, company?, title?, ...fields, origin?, source_ref? }) -> person view (+ created, proposal)
 *   link(ctx, personId, companyId, title, { current?, start_day?, end_day? }) -> employment
 *   merge(ctx, kind, keepId, dropId) -> { kept, dropped, filled, moved }
 *   get(ctx, kind, ref) -> view with detail
 *   resolve(app, kind, ref) -> record (follows aliases and merges)
 *   timeline(ctx, { company | person | deal, limit?, before? }) -> { items, hidden }
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}
function N() {
  return L('lib_norm');
}

const ORIGINS = ['manual', 'capture', 'intake', 'import', 'agent', 'markets', 'portfolio', 'other'];
const COMPANY_KINDS = ['startup', 'investor', 'corporate', 'service', 'other'];
const MODELS = ['saas', 'marketplace', 'transactional', 'consumer_subscription', 'advertising', 'hardware', 'licensing', 'services', 'other'];
const STAGES = ['idea', 'pre_seed', 'seed', 'series_a', 'series_b', 'series_c', 'growth'];

const FIELDS = {
  people: [
    { key: 'name', type: 'text', max: 160 },
    { key: 'email', type: 'email' },
    { key: 'emails', type: 'emails' },
    { key: 'phone', type: 'phone' },
    { key: 'title', type: 'text', max: 160 },
    { key: 'company', type: 'company' },
    { key: 'linkedin', type: 'url' },
    { key: 'location', type: 'text', max: 160 },
    { key: 'bio', type: 'longtext', max: 4000 },
    { key: 'tags', type: 'tags' },
  ],
  companies: [
    { key: 'name', type: 'text', max: 200, required: true },
    { key: 'domain', type: 'domain' },
    { key: 'domains', type: 'domains' },
    { key: 'website', type: 'url' },
    { key: 'description', type: 'longtext', max: 4000 },
    { key: 'kind', type: 'select', options: COMPANY_KINDS },
    { key: 'sector', type: 'text', max: 80 },
    { key: 'subsector', type: 'text', max: 80 },
    { key: 'stage', type: 'select', options: STAGES },
    { key: 'hq_country', type: 'country' },
    { key: 'hq_city', type: 'text', max: 120 },
    { key: 'founded_year', type: 'year' },
    { key: 'team_size', type: 'count' },
    { key: 'business_model', type: 'select', options: MODELS },
    { key: 'linkedin', type: 'url' },
    { key: 'tags', type: 'tags' },
  ],
};
const LIST_TYPES = ['emails', 'domains', 'tags'];

/* ------------------------------------------------------------- basics */

function kindOf(k) {
  const s = String(k || '').toLowerCase();
  if (s === 'person' || s === 'people') return 'people';
  if (s === 'company' || s === 'companies') return 'companies';
  throw u().fail(400, 'kind must be person or company.', 'invalid_param', { param: 'kind' });
}

function defsOf(kind) {
  const out = {};
  for (const d of FIELDS[kind]) out[d.key] = d;
  return out;
}

function who(ctx) {
  return { actor: ctx.isAgent ? 'agent' : ctx.actor === 'person' ? 'person' : 'system', run: ctx.run || '', member: ctx.memberId || '' };
}

function stampWritten(ctx, rec) {
  const w = who(ctx);
  rec.set('actor', w.actor);
  rec.set('member', w.actor === 'person' ? w.member : '');
}

/**
 * Run fn(t) with the caller's write handle (inside an op: the kernel's
 * activity tracker, so everything fn writes is one undo unit) and leave its
 * summary for the op's audit and activity rows. fn returns { summary, type, id }.
 */
function inRun(ctx, op, fn) {
  const meta = fn(ctx.app) || {};
  if (meta.summary) L('lib_audit').note(ctx, { collection: meta.type || '', record: meta.id || '', summary: meta.summary });
  return { result: meta.result };
}

/** Emit an event after commit (never during a proposal's dry run). */
function emit(ctx, name, payload) {
  if (ctx.dryRun) return [];
  return L('lib_events').emit(ctx, name, payload);
}

function nowIso() {
  return new Date().toISOString();
}

function getVal(rec, def) {
  if (LIST_TYPES.indexOf(def.type) >= 0) return u().jsonOf(rec, def.key, []) || [];
  if (def.type === 'year' || def.type === 'count') return rec.getInt(def.key);
  return rec.getString(def.key);
}

function isEmpty(def, v) {
  if (v === null || v === undefined || v === '') return true;
  if (Array.isArray(v)) return v.length === 0;
  if ((def.type === 'year' || def.type === 'count') && v === 0) return true;
  return false;
}

function same(a, b) {
  return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
}

function listOf(raw) {
  if (raw === undefined || raw === null) return [];
  if (Array.isArray(raw)) return raw;
  const s = String(raw).trim();
  if (s === '') return [];
  if (s.charAt(0) === '[') {
    try {
      const v = JSON.parse(s);
      if (Array.isArray(v)) return v;
    } catch {
      throw u().fail(400, 'Give a JSON list, e.g. ["a","b"].', 'invalid_param');
    }
  }
  return [s];
}

/** Clean a written value into its stored form (company refs are resolved later, with the write handle). */
function coerce(def, raw) {
  const util = u();
  const n = N();
  const s = raw === null || raw === undefined ? '' : Array.isArray(raw) ? raw : typeof raw === 'object' ? raw : String(raw);
  const name = def.key;
  switch (def.type) {
    case 'text': {
      const v = util.squash(s);
      if (v.length > def.max) throw util.fail(400, name + ' is too long (at most ' + def.max + ' characters).', 'invalid_param', { param: name });
      return v;
    }
    case 'longtext': {
      const v = String(s).replace(/\r\n/g, '\n').trim();
      if (v.length > def.max) throw util.fail(400, name + ' is too long (at most ' + def.max + ' characters).', 'invalid_param', { param: name });
      return v;
    }
    case 'email': {
      const e = n.email(s);
      if (e !== '' && !n.validEmail(e)) throw util.fail(400, name + ': "' + s + '" is not an email address.', 'invalid_param', { param: name });
      return e;
    }
    case 'emails':
      return n.emails(listOf(raw), name);
    case 'phone':
      return n.phone(s).slice(0, 60);
    case 'url': {
      const v = n.url(s);
      if (v.length > 300) throw util.fail(400, name + ' is too long (at most 300 characters).', 'invalid_param', { param: name });
      return v;
    }
    case 'domain': {
      if (String(s).trim() === '') return '';
      const d = n.domain(s);
      if (d === '') throw util.fail(400, name + ': "' + s + '" is not a domain or website.', 'invalid_param', { param: name });
      if (n.isFreeMail(d)) throw util.fail(400, d + ' is a free-mail domain; it never names a company.', 'free_mail_domain', { param: name });
      return d;
    }
    case 'domains': {
      const ds = n.domains(listOf(raw), name);
      for (const d of ds) if (n.isFreeMail(d)) throw util.fail(400, d + ' is a free-mail domain; it never names a company.', 'free_mail_domain', { param: name });
      return ds;
    }
    case 'tags':
      return n.tags(listOf(raw));
    case 'country':
      return n.country(s, name);
    case 'year': {
      if (String(s).trim() === '') return 0;
      const v = Number(s);
      if (!Number.isInteger(v) || v < 1800 || v > 2200) throw util.fail(400, name + ' is a year such as 2021.', 'invalid_param', { param: name });
      return v;
    }
    case 'count': {
      if (String(s).trim() === '') return 0;
      const v = Number(s);
      if (!Number.isInteger(v) || v < 0 || v > 10000000) throw util.fail(400, name + ' is a whole number.', 'invalid_param', { param: name });
      return v;
    }
    case 'select': {
      if (String(s).trim() === '') return '';
      const v = String(s).trim().toLowerCase();
      if (def.options.indexOf(v) < 0) throw util.fail(400, name + ' must be one of: ' + def.options.join(', ') + '.', 'invalid_param', { param: name });
      return v;
    }
    case 'company':
      return s;
    default:
      throw util.fail(400, 'Cannot write ' + name + '.', 'invalid_param');
  }
}

/** A stored value back in the form the update ops take (for proposals). */
function toInput(def, v) {
  if (LIST_TYPES.indexOf(def.type) >= 0) return JSON.stringify(v || []);
  if (def.type === 'year' || def.type === 'count') return v === 0 ? '' : String(v);
  return v === null || v === undefined ? '' : String(v);
}

function provOf(rec) {
  return u().jsonOf(rec, 'prov', {}) || {};
}

function provEntry(ctx, sourceRef) {
  const w = who(ctx);
  return { by: w.actor, at: nowIso(), run: w.run, source: u().clip(sourceRef || '', 300), member: w.member };
}

/** May your AI agent write this value without a person's say? */
function agentMay(def, ov, nv, pv) {
  if (isEmpty(def, ov)) return true;
  if (pv && (pv.by === 'agent' || pv.by === 'system')) return true;
  if (Array.isArray(ov) && Array.isArray(nv) && ov.every((x) => nv.indexOf(x) >= 0)) return true;
  return false;
}

/* ------------------------------------------------------------ resolve */

function personName(rec) {
  return rec.getString('name') || rec.getString('email') || 'Unnamed person';
}

function nameOf(kind, rec) {
  return kind === 'people' ? personName(rec) : rec.getString('name');
}

function followMerge(app, collection, rec) {
  let r = rec;
  for (let i = 0; i < 10 && r !== null && r.getString('merged_into') !== ''; i++) r = u().byId(app, collection, r.getString('merged_into'));
  return r;
}

function cand(kind, rec) {
  return { id: rec.id, name: nameOf(kind, rec), email: kind === 'people' ? rec.getString('email') : undefined, domain: kind === 'companies' ? rec.getString('domain') : undefined };
}

function byEmail(app, e) {
  const rows = app.findRecordsByFilter('people', "merged_into = '' && (email = {:e} || emails ~ {:q})", '', 2, 0, { e: e, q: '"' + e + '"' });
  return rows.length > 0 ? rows[0] : null;
}

function byDomain(app, d) {
  const rows = app.findRecordsByFilter('companies', "merged_into = '' && (domain = {:d} || domains ~ {:q})", '', 2, 0, { d: d, q: '"' + d + '"' });
  return rows.length > 0 ? rows[0] : null;
}

/**
 * A person or company by id (merged and aliased ids follow to the
 * survivor), a person by email or exact name, a company by domain or exact
 * name. 404 when none, 409 with candidates when several. opts.deleted: also the trash.
 */
function resolve(app, kind, ref, opts) {
  const util = u();
  const k = kindOf(kind);
  const one = k === 'people' ? 'person' : 'company';
  const r = String(ref || '').trim();
  if (r === '') throw util.fail(400, one + ' is required.', 'missing_param', { param: one });
  let rec = util.byId(app, k, r);
  if (rec === null) {
    const al = util.findOne(app, 'aliases', 'kind = {:k} && old_id = {:id}', { k: k, id: r });
    if (al !== null) rec = util.byId(app, k, al.getString('new_id'));
  }
  if (rec === null) {
    if (k === 'people') {
      const e = N().email(r);
      if (e.indexOf('@') > 0) rec = byEmail(app, e);
      else {
        const rows = app.findRecordsByFilter('people', "merged_into = '' && deleted_at = '' && name_key = {:k}", '', 3, 0, { k: N().nameKey(r) });
        if (rows.length > 1) throw util.fail(409, 'Several people are called "' + r + '"; use the email or the id.', 'ambiguous', { candidates: rows.map((x) => cand(k, x)) });
        if (rows.length === 1) rec = rows[0];
      }
    } else {
      const d = r.indexOf(' ') < 0 && r.indexOf('.') > 0 ? N().domain(r) : '';
      if (d !== '') rec = byDomain(app, d);
      if (rec === null) {
        const rows = app.findRecordsByFilter('companies', "merged_into = '' && deleted_at = '' && name_key = {:k}", '', 3, 0, { k: N().companyKey(r) });
        if (rows.length > 1) throw util.fail(409, 'Several companies are called "' + r + '"; use the id.', 'ambiguous', { candidates: rows.map((x) => cand(k, x)) });
        if (rows.length === 1) rec = rows[0];
      }
    }
  }
  if (rec !== null) rec = followMerge(app, k, rec);
  if (rec === null) {
    const refs = L('lib_refs');
    const live = "deleted_at = '' AND merged_into = ''";
    let found = refs.matches(app, k, 'name', r, { where: live });
    if (k === 'people' && found.length < 5) for (const m of refs.matches(app, 'people', 'email', r, { where: live })) if (found.filter((f) => f.id === m.id).length === 0 && found.length < 5) found.push({ id: m.id, name: m.name });
    if (k === 'companies' && found.length < 5) for (const m of refs.matches(app, 'companies', 'domain', r, { where: live })) if (found.filter((f) => f.id === m.id).length === 0 && found.length < 5) found.push({ id: m.id, name: m.name });
    found = found.map((f) => {
      const x = util.byId(app, k, f.id);
      return x === null ? f : cand(k, x);
    });
    throw refs.notFound(one, r, found, k + '.list --q <name>');
  }
  if (rec.getString('deleted_at') !== '' && !(opts && opts.deleted)) throw util.fail(409, nameOf(k, rec) + ' was deleted.', 'deleted', { id: rec.id });
  return rec;
}

/* ------------------------------------------------------------ companies */

/** Find the company that `values` identify (domain first, then a lone name match). */
function findCompany(app, values) {
  const util = u();
  const n = N();
  if (values.domain !== '') {
    const hit = byDomain(app, values.domain);
    if (hit !== null) return { rec: hit, how: 'domain' };
  }
  if (values.name === '') return { rec: null };
  const rows = app.findRecordsByFilter('companies', "merged_into = '' && deleted_at = '' && name_key = {:k}", '', 5, 0, { k: n.companyKey(values.name) });
  if (values.domain !== '') {
    const bare = rows.filter((r) => r.getString('domain') === '');
    return { rec: bare.length === 1 ? bare[0] : null, how: 'name' };
  }
  if (rows.length > 1) throw util.fail(409, 'Several companies are called "' + values.name + '"; give the domain or the id.', 'ambiguous', { candidates: rows.map((x) => cand('companies', x)) });
  return { rec: rows.length === 1 ? rows[0] : null, how: 'name' };
}

/** Create a company with the write handle t; returns the record. */
function createCompanyIn(ctx, t, clean, meta) {
  const util = u();
  const n = N();
  const rec = util.newRecord(t, 'companies');
  const prov = {};
  const name = clean.name || (clean.domain ? n.companyFromDomain(clean.domain) : '');
  if (name === '') throw util.fail(400, 'A company needs a name or a domain.', 'missing_param', { param: 'name' });
  rec.set('name', name);
  rec.set('name_key', n.companyKey(name));
  rec.set('kind', clean.kind || 'startup');
  rec.set('domains', []);
  rec.set('tags', []);
  for (const key of Object.keys(clean)) {
    if (key === 'name' || key === 'kind') continue;
    const def = defsOf('companies')[key];
    if (def === undefined || isEmpty(def, clean[key])) continue;
    rec.set(key, clean[key]);
    prov[key] = provEntry(ctx, meta.source_ref);
  }
  prov.name = provEntry(ctx, meta.source_ref);
  const d = rec.getString('domain');
  const ds = util.jsonOf(rec, 'domains', []) || [];
  if (d !== '' && ds.indexOf(d) < 0) ds.unshift(d);
  if (d === '' && ds.length > 0) rec.set('domain', ds[0]);
  rec.set('domains', ds);
  for (const dd of ds) {
    const owner = byDomain(t, dd);
    if (owner !== null) throw util.fail(409, dd + ' already belongs to ' + owner.getString('name') + '.', 'duplicate', { candidates: [cand('companies', owner)] });
  }
  rec.set('origin', meta.origin || defaultOrigin(ctx));
  rec.set('prov', prov);
  rec.set('merged_into', '');
  rec.set('deleted_at', '');
  stampWritten(ctx, rec);
  t.save(rec);
  return rec;
}

function defaultOrigin(ctx) {
  return ctx.isAgent ? 'agent' : ctx.actor === 'person' ? 'manual' : 'other';
}

function cleanValues(kind, values) {
  const defs = defsOf(kind);
  const out = {};
  for (const key of Object.keys(values)) {
    if (values[key] === undefined) continue;
    const def = defs[key];
    if (def === undefined) throw u().fail(400, 'Unknown field "' + key + '" for ' + (kind === 'people' ? 'a person' : 'a company') + '. Fields: ' + Object.keys(defs).join(', ') + '.', 'unknown_key', { key: key });
    out[key] = coerce(def, values[key]);
  }
  return out;
}

function pickFields(kind, o) {
  const out = {};
  for (const d of FIELDS[kind]) if (o[d.key] !== undefined && o[d.key] !== null) out[d.key] = o[d.key];
  return out;
}

/** A company id for a ref inside a write (id, domain or name; created when missing). */
function companyIdIn(ctx, t, ref, meta, state) {
  if (ref === '' || ref === null || ref === undefined) return '';
  const util = u();
  const n = N();
  if (typeof ref === 'object') {
    const res = upsertCompanyIn(ctx, t, ref, meta, state);
    return res.rec.id;
  }
  const r = String(ref).trim();
  const byId = util.byId(t, 'companies', r);
  if (byId !== null) return followMerge(t, 'companies', byId).id;
  const looksDomain = r.indexOf(' ') < 0 && r.indexOf('.') > 0;
  const res = upsertCompanyIn(ctx, t, looksDomain ? { domain: r } : { name: r }, meta, state);
  return res.rec.id;
}

/**
 * Write fields onto an existing record with the agent rule. mode:
 *   'upsert': people write; your AI agent fills, its own values change, a person's value becomes a proposal
 *   'fill':   everyone fills empty fields only; a person's call keeps the rest, your AI agent's proposes it
 *   'update': write everything (people, or your AI agent once a person accepted or the kind is automatic)
 * Returns { changes: [{field, from, to}], proposed: {field: inputValue}, kept: [field] }.
 */
function writeFields(ctx, t, kind, rec, clean, meta, mode, state) {
  const util = u();
  const n = N();
  const defs = defsOf(kind);
  const prov = provOf(rec);
  const changes = [];
  const proposed = {};
  const kept = [];
  const auto = ctx.isAgent && L('lib_settings').autoAllowed(ctx.app, 'note_fields');
  const touch = (key, from, to) => {
    changes.push({ field: key, from: from, to: to });
    prov[key] = provEntry(ctx, meta.source_ref);
  };
  for (const key of Object.keys(clean)) {
    const def = defs[key];
    let nv = clean[key];
    if (def.type === 'company') nv = companyIdIn(ctx, t, nv, meta, state);
    const ov = getVal(rec, def);
    if (same(ov, nv)) continue;
    if (def.type === 'email' || def.type === 'domain') {
      if (nv === '') continue;
      const listKey = def.type === 'email' ? 'emails' : 'domains';
      const list = util.jsonOf(rec, listKey, []) || [];
      const owner = def.type === 'email' ? byEmail(t, nv) : byDomain(t, nv);
      if (owner !== null && owner.id !== rec.id) throw util.fail(409, nv + ' already belongs to ' + nameOf(kind, owner) + '.', 'duplicate', { candidates: [cand(kind, owner)] });
      const replace = ov === '' || mode === 'update' || (mode === 'upsert' && !ctx.isAgent);
      if (list.indexOf(nv) < 0) list.push(nv);
      if (replace) {
        rec.set(key, nv);
        touch(key, ov, nv);
      } else touch(listKey, '', nv);
      list.sort((a, b) => (a === rec.getString(key) ? -1 : b === rec.getString(key) ? 1 : 0));
      rec.set(listKey, list);
      continue;
    }
    let allowed;
    if (mode === 'update') allowed = true;
    else if (mode === 'fill') allowed = isEmpty(def, ov) || (ctx.isAgent && (agentMay(def, ov, nv, prov[key]) || auto));
    else allowed = !ctx.isAgent || agentMay(def, ov, nv, prov[key]) || auto;
    if (!allowed) {
      if (ctx.isAgent) proposed[key] = toInput(def, nv);
      else kept.push(key);
      continue;
    }
    if (def.type === 'emails' || def.type === 'domains') {
      for (const x of nv) {
        const owner = def.type === 'emails' ? byEmail(t, x) : byDomain(t, x);
        if (owner !== null && owner.id !== rec.id) throw util.fail(409, x + ' already belongs to ' + nameOf(kind, owner) + '.', 'duplicate', { candidates: [cand(kind, owner)] });
      }
      const primaryKey = def.type === 'emails' ? 'email' : 'domain';
      const primary = rec.getString(primaryKey);
      if (nv.length > 0 && (primary === '' || nv.indexOf(primary) < 0)) rec.set(primaryKey, nv[0]);
      if (nv.length === 0) rec.set(primaryKey, '');
    }
    rec.set(key, nv);
    if (key === 'name') rec.set('name_key', kind === 'people' ? n.nameKey(nv) : n.companyKey(nv));
    touch(key, ov, nv);
  }
  if (changes.length > 0) {
    rec.set('prov', prov);
    t.save(rec);
    if (kind === 'people') {
      const keys = changes.map((c) => c.field);
      if (keys.indexOf('company') >= 0 || keys.indexOf('title') >= 0) setEmployment(ctx, t, rec, rec.getString('company'), rec.getString('title'));
    }
  }
  return { changes: changes, proposed: proposed, kept: kept };
}

/** Find or create a company inside a write; returns { rec, created, changes, proposed, kept }. */
function upsertCompanyIn(ctx, t, o, meta, state) {
  const util = u();
  const n = N();
  const values = pickFields('companies', o);
  if (values.domain === undefined && o.website !== undefined && String(o.website).trim() !== '') {
    const d = n.domain(o.website);
    if (d !== '' && !n.isFreeMail(d)) values.domain = d;
  }
  if (values.domain !== undefined && n.isFreeMail(n.domain(values.domain))) {
    if (values.name === undefined || String(values.name).trim() === '') throw util.fail(400, n.domain(values.domain) + ' is a free-mail domain; it never names a company.', 'free_mail_domain', { param: 'domain' });
    delete values.domain;
  }
  const clean = cleanValues('companies', values);
  let rec = null;
  if (o.company !== undefined && o.company !== null && String(o.company).trim() !== '') rec = resolve(t, 'companies', o.company);
  else {
    const found = findCompany(t, { domain: clean.domain || '', name: clean.name || '' });
    rec = found.rec;
  }
  if (rec === null) {
    if (!clean.name && !clean.domain) throw util.fail(400, 'A company needs a name or a domain.', 'missing_param', { param: 'name' });
    rec = createCompanyIn(ctx, t, clean, meta);
    state.created.push({ kind: 'companies', id: rec.id });
    return { rec: rec, created: true, changes: [], proposed: {}, kept: [] };
  }
  if (rec.getString('deleted_at') !== '') return { rec: rec, created: false, deleted: true, changes: [], proposed: {}, kept: [] };
  const w = writeFields(ctx, t, 'companies', rec, clean, meta, meta.mode || 'upsert', state);
  return { rec: rec, created: false, changes: w.changes, proposed: w.proposed, kept: w.kept };
}

/* --------------------------------------------------------------- people */

/** Close the current job when the company changes and open the new one. */
function setEmployment(ctx, t, personRec, companyId, title) {
  const util = u();
  const today = util.today(ctx.app);
  const cur = t.findRecordsByFilter('employments', 'person = {:p} && current = true', '', 0, 0, { p: personRec.id });
  let kept = false;
  for (const e of cur) {
    if (companyId !== '' && e.getString('company') === companyId) {
      if (e.getString('title') !== (title || '')) {
        e.set('title', title || '');
        t.save(e);
      }
      kept = true;
      continue;
    }
    e.set('current', false);
    e.set('end_day', today);
    t.save(e);
  }
  if (!kept && companyId !== '') {
    const e = util.newRecord(t, 'employments');
    e.set('person', personRec.id);
    e.set('company', companyId);
    e.set('title', title || '');
    e.set('current', true);
    e.set('start_day', today);
    e.set('origin', personRec.getString('origin') || defaultOrigin(ctx));
    stampWritten(ctx, e);
    t.save(e);
  }
}

function createPersonIn(ctx, t, clean, meta, state) {
  const util = u();
  const n = N();
  const rec = util.newRecord(t, 'people');
  const prov = {};
  const emails = (clean.emails || []).slice();
  if (clean.email) {
    if (emails.indexOf(clean.email) >= 0) emails.splice(emails.indexOf(clean.email), 1);
    emails.unshift(clean.email);
  }
  for (const e of emails) {
    const owner = byEmail(t, e);
    if (owner !== null) throw util.fail(409, e + ' already belongs to ' + personName(owner) + '.', 'duplicate', { candidates: [cand('people', owner)] });
  }
  const name = clean.name || (emails.length > 0 ? n.nameFromEmail(emails[0]) : '');
  if (name === '' && emails.length === 0) throw util.fail(400, 'A person needs a name or an email.', 'missing_param', { param: 'name' });
  rec.set('name', name);
  rec.set('name_key', n.nameKey(name));
  rec.set('email', emails[0] || '');
  rec.set('emails', emails);
  rec.set('tags', []);
  prov.name = provEntry(ctx, clean.name ? meta.source_ref : 'email address');
  if (emails.length > 0) prov.email = provEntry(ctx, meta.source_ref);
  let companyId = '';
  if (clean.company !== undefined && clean.company !== '') {
    companyId = companyIdIn(ctx, t, clean.company, meta, state);
    prov.company = provEntry(ctx, meta.source_ref);
  } else if (emails.length > 0 && n.workDomain(emails[0]) !== '') {
    companyId = companyIdIn(ctx, t, { domain: n.workDomain(emails[0]) }, Object.assign({}, meta, { mode: 'fill' }), state);
    prov.company = provEntry(ctx, 'email domain');
  }
  rec.set('company', companyId);
  for (const key of Object.keys(clean)) {
    if (['name', 'email', 'emails', 'company'].indexOf(key) >= 0) continue;
    const def = defsOf('people')[key];
    if (isEmpty(def, clean[key])) continue;
    rec.set(key, clean[key]);
    prov[key] = provEntry(ctx, meta.source_ref);
  }
  rec.set('origin', meta.origin || defaultOrigin(ctx));
  rec.set('prov', prov);
  rec.set('merged_into', '');
  rec.set('deleted_at', '');
  stampWritten(ctx, rec);
  t.save(rec);
  if (companyId !== '') setEmployment(ctx, t, rec, companyId, rec.getString('title'));
  state.created.push({ kind: 'people', id: rec.id });
  return rec;
}

function upsertPersonIn(ctx, t, o, meta, state) {
  const util = u();
  const n = N();
  const values = pickFields('people', o);
  const clean = cleanValues('people', values);
  let rec = null;
  if (o.person !== undefined && o.person !== null && String(o.person).trim() !== '') rec = resolve(t, 'people', o.person, { deleted: true });
  else {
    const all = (clean.email ? [clean.email] : []).concat(clean.emails || []);
    for (const e of all) {
      rec = byEmail(t, e);
      if (rec !== null) break;
    }
    if (rec === null && all.length === 0 && clean.name && clean.company !== undefined && clean.company !== '') {
      const cid = companyIdIn(ctx, t, clean.company, meta, state);
      const rows = t.findRecordsByFilter('people', "merged_into = '' && deleted_at = '' && company = {:c} && name_key = {:k}", '', 3, 0, { c: cid, k: n.nameKey(clean.name) });
      if (rows.length > 1) throw util.fail(409, 'Several people called "' + clean.name + '" work there; give the email or the id.', 'ambiguous', { candidates: rows.map((x) => cand('people', x)) });
      if (rows.length === 1) rec = rows[0];
      clean.company = cid;
    }
  }
  if (rec === null) {
    rec = createPersonIn(ctx, t, clean, meta, state);
    return { rec: rec, created: true, changes: [], proposed: {}, kept: [] };
  }
  if (rec.getString('deleted_at') !== '') return { rec: rec, created: false, deleted: true, changes: [], proposed: {}, kept: [] };
  const w = writeFields(ctx, t, 'people', rec, clean, meta, meta.mode || 'upsert', state);
  return { rec: rec, created: false, changes: w.changes, proposed: w.proposed, kept: w.kept };
}

/* ------------------------------------------------------- public writes */

function metaOf(ctx, o, mode) {
  const origin = o.origin === undefined || o.origin === null || o.origin === '' ? '' : String(o.origin);
  if (origin !== '' && ORIGINS.indexOf(origin) < 0) throw u().fail(400, 'origin must be one of: ' + ORIGINS.join(', ') + '.', 'invalid_param', { param: 'origin' });
  return { origin: origin, source_ref: o.source_ref ? String(o.source_ref) : '', mode: mode };
}

/** Store what your AI agent may only propose, as a proposal of the update op (people.update / companies.update, kind note_fields). */
function proposeFields(ctx, kind, rec, proposed, meta) {
  if (Object.keys(proposed).length === 0) return null;
  const op = kind === 'people' ? 'people.update' : 'companies.update';
  const params = Object.assign({}, proposed);
  params[kind === 'people' ? 'person' : 'company'] = rec.id;
  if (meta.source_ref) params.source_ref = meta.source_ref;
  const spec = L('lib_catalog').get(op);
  return L('lib_proposals').fromCall(ctx, spec, params);
}

function finishWrite(ctx, kind, res, state, meta) {
  for (const c of state.created) emit(ctx, c.kind === 'people' ? 'person.created' : 'company.created', c.kind === 'people' ? { person: c.id } : { company: c.id });
  const proposal = ctx.isAgent ? proposeFields(ctx, kind, res.rec, res.proposed, meta) : null;
  const view = kind === 'people' ? personOut(ctx.app, ctx.app.findRecordById('people', res.rec.id)) : companyOut(ctx.app, ctx.app.findRecordById('companies', res.rec.id));
  view.created = res.created;
  view.changed = res.changes.map((c) => c.field);
  view.kept = res.kept;
  view.proposal = proposal ? { id: proposal.proposal, fields: Object.keys(res.proposed), message: proposal.message } : null;
  view.deleted = res.deleted === true;
  return view;
}

/** upsertCompany(ctx, {company?, name?, domain?, website?, ...fields, origin?, source_ref?}) -> company view */
function upsertCompany(ctx, o) {
  const meta = metaOf(ctx, o || {}, 'upsert');
  const state = { created: [] };
  let res = null;
  inRun(ctx, 'companies.upsert', (t) => {
    res = upsertCompanyIn(ctx, t, o || {}, meta, state);
    if (!res.created && res.changes.length === 0) return { result: null };
    return { summary: (res.created ? 'Added the company ' : 'Updated the company ') + res.rec.getString('name'), type: 'companies', id: res.rec.id, changes: res.changes };
  });
  return finishWrite(ctx, 'companies', res, state, meta);
}

/** upsertPerson(ctx, {person?, email?, name?, company?, title?, ...fields, origin?, source_ref?}) -> person view */
function upsertPerson(ctx, o) {
  const meta = metaOf(ctx, o || {}, 'upsert');
  const state = { created: [] };
  let res = null;
  inRun(ctx, 'people.upsert', (t) => {
    res = upsertPersonIn(ctx, t, o || {}, meta, state);
    if (!res.created && res.changes.length === 0 && state.created.length === 0) return { result: null };
    return { summary: (res.created ? 'Added ' : 'Updated ') + personName(res.rec), type: 'people', id: res.rec.id, changes: res.changes };
  });
  return finishWrite(ctx, 'people', res, state, meta);
}

/** update (people.update / companies.update): write the given fields of an existing record. */
function updateRecord(ctx, kind, ref, values, meta) {
  const state = { created: [] };
  let res = null;
  inRun(ctx, kind + '.update', (t) => {
    const rec = resolve(t, kind, ref);
    const clean = cleanValues(kind, values);
    if (Object.keys(clean).length === 0) throw u().fail(400, 'Give at least one field to change. Fields: ' + Object.keys(defsOf(kind)).join(', ') + '.', 'missing_param');
    const w = writeFields(ctx, t, kind, rec, clean, meta, 'update', state);
    res = { rec: rec, created: false, changes: w.changes, proposed: {}, kept: [] };
    if (w.changes.length === 0) return { result: null };
    return { summary: 'Changed ' + w.changes.map((c) => c.field).join(', ') + ' of ' + nameOf(kind, rec), type: kind, id: rec.id, changes: w.changes };
  });
  return finishWrite(ctx, kind, res, state, meta);
}

/** Fill empty fields (records.enrich); your AI agent's other changes become a proposal. */
function fillRecord(ctx, kind, ref, values, meta) {
  const state = { created: [] };
  let res = null;
  inRun(ctx, 'records.enrich', (t) => {
    const rec = resolve(t, kind, ref);
    const clean = cleanValues(kind, values);
    const w = writeFields(ctx, t, kind, rec, clean, meta, 'fill', state);
    res = { rec: rec, created: false, changes: w.changes, proposed: w.proposed, kept: w.kept };
    if (w.changes.length === 0) return { result: null };
    return { summary: 'Filled ' + w.changes.map((c) => c.field).join(', ') + ' of ' + nameOf(kind, rec), type: kind, id: rec.id, changes: w.changes };
  });
  return finishWrite(ctx, kind, res, state, meta);
}

/** link(ctx, personId, companyId, title, {current, start_day, end_day}) -> employment (a past or current job). */
function link(ctx, personId, companyId, title, opts) {
  const util = u();
  const o = opts || {};
  const current = o.current !== false;
  const meta = metaOf(ctx, o, 'fill');
  const state = { created: [] };
  let out = null;
  inRun(ctx, 'people.link', (t) => {
    const p = resolve(t, 'people', personId);
    const cid = companyIdIn(ctx, t, companyId, meta, state);
    if (cid === '') throw util.fail(400, 'company is required.', 'missing_param', { param: 'company' });
    const tl = util.squash(title || '').slice(0, 160);
    const prov0 = provOf(p);
    const mayMove = !ctx.isAgent || p.getString('company') === '' || p.getString('company') === cid || (prov0.company && (prov0.company.by === 'agent' || prov0.company.by === 'system'));
    if (current && mayMove) {
      const prov = provOf(p);
      if (p.getString('company') !== cid) {
        p.set('company', cid);
        prov.company = provEntry(ctx, meta.source_ref);
      }
      if (tl !== '' && p.getString('title') !== tl && (p.getString('title') === '' || !ctx.isAgent)) {
        p.set('title', tl);
        prov.title = provEntry(ctx, meta.source_ref);
      }
      p.set('prov', prov);
      t.save(p);
      setEmployment(ctx, t, p, cid, p.getString('title'));
      out = t.findRecordsByFilter('employments', 'person = {:p} && company = {:c} && current = true', '', 1, 0, { p: p.id, c: cid })[0];
      if (o.founder !== undefined && out && out.getBool('founder') !== (o.founder === true)) {
        out.set('founder', o.founder === true);
        t.save(out);
      }
    } else {
      const e = util.newRecord(t, 'employments');
      e.set('person', p.id);
      e.set('company', cid);
      e.set('title', tl);
      e.set('current', current);
      e.set('start_day', o.start_day || '');
      e.set('end_day', current ? '' : o.end_day || '');
      e.set('founder', o.founder === true);
      e.set('origin', meta.origin || defaultOrigin(ctx));
      stampWritten(ctx, e);
      t.save(e);
      out = e;
    }
    return { summary: 'Linked ' + personName(p) + ' to a company', type: 'people', id: p.id };
  });
  for (const c of state.created) emit(ctx, 'company.created', { company: c.id });
  const e = ctx.app.findRecordById('employments', out.id);
  return employmentOut(ctx.app, e);
}

/**
 * unlink(ctx, personRef, companyRef): the person no longer belongs to the
 * company: their current jobs there end today, their company field is
 * cleared when it names it, and their founder and contact seats on its
 * deals (the ones ctx may see) are removed. One undo unit.
 */
function unlink(ctx, personRef, companyRef) {
  const util = u();
  let out = null;
  inRun(ctx, 'people.unlink', (t) => {
    const p = resolve(t, 'people', personRef);
    const c = resolve(t, 'companies', companyRef);
    const today = util.today(ctx.app);
    let jobs = 0;
    for (const e of t.findRecordsByFilter('employments', 'person = {:p} && company = {:c} && current = true', '', 0, 0, { p: p.id, c: c.id })) {
      e.set('current', false);
      e.set('end_day', today);
      t.save(e);
      jobs++;
    }
    let cleared = false;
    if (p.getString('company') === c.id) {
      const prov = provOf(p);
      p.set('company', '');
      prov.company = provEntry(ctx, '');
      p.set('prov', prov);
      t.save(p);
      cleared = true;
    }
    const vis = L('lib_deals').visibleSql(ctx, 'd');
    const seatIds = util.rows(t, "SELECT dp.id AS id FROM deal_people dp JOIN deals d ON d.id = dp.deal WHERE d.company = {:c} AND dp.person = {:p} AND dp.team = FALSE AND dp.role IN ('founder', 'contact') AND " + vis.sql, { id: '' }, Object.assign({ c: c.id, p: p.id }, vis.bind));
    for (const sr of seatIds) t.delete(t.findRecordById('deal_people', sr.id));
    if (jobs === 0 && !cleared && seatIds.length === 0) throw util.fail(409, personName(p) + ' is not linked to ' + c.getString('name') + '.', 'not_linked');
    out = { person: p.id, company: c.id, jobs_ended: jobs, company_cleared: cleared, deal_seats_removed: seatIds.length };
    return { summary: 'Took ' + personName(p) + ' off ' + c.getString('name'), type: 'people', id: p.id };
  });
  return out;
}

/* --------------------------------------------------------------- merges */

function union(a, b) {
  const out = (a || []).slice();
  for (const x of b || []) if (out.indexOf(x) < 0) out.push(x);
  return out;
}

function repoint(t, collection, field, from, to, uniqueWith) {
  let n = 0;
  for (const r of t.findRecordsByFilter(collection, field + ' = {:id}', '', 0, 0, { id: from })) {
    if (uniqueWith) {
      const dup = t.findRecordsByFilter(collection, field + ' = {:to} && ' + uniqueWith + ' = {:w}', '', 1, 0, { to: to, w: r.getString(uniqueWith) });
      if (dup.length > 0) {
        t.delete(r);
        n++;
        continue;
      }
    }
    r.set(field, to);
    t.save(r);
    n++;
  }
  return n;
}

/**
 * merge(ctx, kind, keepId, dropId): the kept record's values win, its blanks
 * are filled from the dropped one (with their provenance), lists are
 * combined, every link moves to the kept record, the dropped one is marked
 * merged (its id keeps resolving through aliases). One activity entry: an
 * Undo restores both records and every moved link.
 */
function merge(ctx, kind, keepId, dropId) {
  const util = u();
  const k = kindOf(kind);
  let out = null;
  inRun(ctx, k + '.merge', (t) => {
    const keep = resolve(t, k, keepId);
    const drop = resolve(t, k, dropId);
    if (keep.id === drop.id) throw util.fail(400, 'Pick two different records to merge.', 'invalid_param');
    const kp = provOf(keep);
    const dp = provOf(drop);
    const filled = [];
    for (const def of FIELDS[k]) {
      const a = getVal(keep, def);
      const b = getVal(drop, def);
      if (LIST_TYPES.indexOf(def.type) >= 0) {
        const v = union(a, b);
        if (!same(v, a)) {
          keep.set(def.key, v);
          filled.push(def.key);
        }
        continue;
      }
      if (def.type === 'email' || def.type === 'domain') continue;
      if (isEmpty(def, a) && !isEmpty(def, b)) {
        keep.set(def.key, b);
        if (dp[def.key]) kp[def.key] = dp[def.key];
        filled.push(def.key);
      }
    }
    const primary = k === 'people' ? 'email' : 'domain';
    if (keep.getString(primary) === '' && drop.getString(primary) !== '') {
      keep.set(primary, drop.getString(primary));
      filled.push(primary);
    }
    keep.set('prov', kp);
    // The dropped record lets go of its unique keys before the kept one takes them.
    drop.set('merged_into', keep.id);
    drop.set('deleted_at', nowIso());
    drop.set(primary, '');
    drop.set(k === 'people' ? 'emails' : 'domains', []);
    t.save(drop);
    t.save(keep);
    const moved = {};
    if (k === 'people') {
      moved.employments = repoint(t, 'employments', 'person', drop.id, keep.id, 'company');
      moved.deal_people = repoint(t, 'deal_people', 'person', drop.id, keep.id, 'deal');
      moved.deals = repoint(t, 'deals', 'source_person', drop.id, keep.id);
    } else {
      moved.people = repoint(t, 'people', 'company', drop.id, keep.id);
      moved.employments = repoint(t, 'employments', 'company', drop.id, keep.id, 'person');
      moved.deals = repoint(t, 'deals', 'company', drop.id, keep.id);
    }
    let files = 0;
    for (const f of t.findRecordsByFilter('files', 'owner_collection = {:c} && owner_id = {:id}', '', 0, 0, { c: k, id: drop.id })) {
      f.set('owner_id', keep.id);
      t.save(f);
      files++;
    }
    moved.files = files;
    for (const al of t.findRecordsByFilter('aliases', 'kind = {:k} && new_id = {:id}', '', 0, 0, { k: k, id: drop.id })) {
      al.set('new_id', keep.id);
      t.save(al);
    }
    const al = util.newRecord(t, 'aliases');
    al.set('kind', k);
    al.set('old_id', drop.id);
    al.set('new_id', keep.id);
    al.set('run', ctx.run || '');
    stampWritten(ctx, al);
    t.save(al);
    // Other modules re-point their own rows inside this same run, so Undo restores them too.
    if (!ctx.dryRun) L('lib_events').emit(Object.assign({}, ctx, { app: t }), 'record.merged', { kind: k, keep: keep.id, drop: drop.id });
    out = { keep: keep.id, drop: drop.id, filled: filled, moved: moved };
    return { summary: 'Merged ' + nameOf(k, drop) + ' into ' + nameOf(k, keep), type: k, id: keep.id, changes: filled.map((f) => ({ field: f })) };
  });
  const kept = k === 'people' ? personOut(ctx.app, ctx.app.findRecordById('people', out.keep)) : companyOut(ctx.app, ctx.app.findRecordById('companies', out.keep));
  return { kept: kept, dropped: out.drop, filled: out.filled, moved: out.moved };
}

/* ---------------------------------------------------------------- views */

function mini(app, collection, id) {
  if (!id) return null;
  const r = u().byId(app, collection, id);
  if (r === null) return null;
  if (collection === 'companies') return Object.assign({ id: r.id, name: r.getString('name'), domain: r.getString('domain') }, L('lib_logos').viewOf(app, r));
  if (collection === 'people') return { id: r.id, name: personName(r), email: r.getString('email') };
  if (collection === 'members') return { id: r.id, name: r.getString('name') };
  return { id: r.id };
}

function personOut(app, rec) {
  const util = u();
  return {
    id: rec.id,
    kind: 'person',
    name: personName(rec),
    email: rec.getString('email'),
    emails: util.jsonOf(rec, 'emails', []) || [],
    phone: rec.getString('phone'),
    title: rec.getString('title'),
    company: mini(app, 'companies', rec.getString('company')),
    linkedin: rec.getString('linkedin'),
    location: rec.getString('location'),
    bio: rec.getString('bio'),
    tags: util.jsonOf(rec, 'tags', []) || [],
    origin: rec.getString('origin'),
    prov: provOf(rec),
    deleted_at: rec.getString('deleted_at'),
    merged_into: rec.getString('merged_into'),
    created: rec.getString('created'),
    updated: rec.getString('updated'),
  };
}

function companyOut(app, rec) {
  const util = u();
  return {
    id: rec.id,
    kind: 'company',
    name: rec.getString('name'),
    domain: rec.getString('domain'),
    domains: util.jsonOf(rec, 'domains', []) || [],
    website: rec.getString('website'),
    description: rec.getString('description'),
    company_kind: rec.getString('kind'),
    sector: rec.getString('sector'),
    subsector: rec.getString('subsector'),
    stage: rec.getString('stage'),
    hq_country: rec.getString('hq_country'),
    hq_city: rec.getString('hq_city'),
    founded_year: rec.getInt('founded_year') || null,
    team_size: rec.getInt('team_size') || null,
    business_model: rec.getString('business_model'),
    linkedin: rec.getString('linkedin'),
    tags: util.jsonOf(rec, 'tags', []) || [],
    logo_url: L('lib_logos').companyUrl(rec),
    logo_domain: L('lib_logos').domainOf(app, rec.getString('domain')),
    origin: rec.getString('origin'),
    prov: provOf(rec),
    deleted_at: rec.getString('deleted_at'),
    merged_into: rec.getString('merged_into'),
    created: rec.getString('created'),
    updated: rec.getString('updated'),
  };
}

function employmentOut(app, e) {
  return { id: e.id, person: mini(app, 'people', e.getString('person')), company: mini(app, 'companies', e.getString('company')), title: e.getString('title'), current: e.getBool('current'), founder: e.getBool('founder'), start_day: e.getString('start_day'), end_day: e.getString('end_day') };
}

/**
 * The people of a company as its page and edit sheet show them: founders
 * first (a founder seat on one of its deals ctx may see, or a current job
 * marked founder), then the team (everyone else with a current job there),
 * each with the title of that job (else their own title).
 */
function companyPeople(ctx, companyId) {
  const app = ctx.app;
  const util = u();
  const vis = L('lib_deals').visibleSql(ctx, 'd');
  const jobs = util.rows(app, "SELECT p.id AS id, e.title AS title, e.founder AS founder FROM employments e JOIN people p ON p.id = e.person WHERE e.company = {:c} AND e.current = TRUE AND p.deleted_at = '' AND p.merged_into = '' ORDER BY p.name LIMIT 200", { id: '', title: '', founder: false }, { c: companyId });
  const seats = util.rows(app, "SELECT DISTINCT dp.person AS id FROM deal_people dp JOIN deals d ON d.id = dp.deal JOIN people p ON p.id = dp.person WHERE d.company = {:c} AND d.deleted_at = '' AND dp.role = 'founder' AND p.deleted_at = '' AND p.merged_into = '' AND " + vis.sql + ' LIMIT 50', { id: '' }, Object.assign({ c: companyId }, vis.bind));
  const titleOf = {};
  const founder = {};
  for (const j of jobs) {
    titleOf[j.id] = j.title;
    if (j.founder) founder[j.id] = true;
  }
  for (const s0 of seats) founder[s0.id] = true;
  const out = [];
  const seen = {};
  const push = (id, role) => {
    if (seen[id]) return;
    const m = mini(app, 'people', id);
    if (m === null) return;
    seen[id] = true;
    const rec = u().byId(app, 'people', id);
    const t = titleOf[id] !== undefined && titleOf[id] !== '' ? titleOf[id] : rec !== null ? rec.getString('title') : '';
    out.push(Object.assign(m, { title: t, role: role, job: titleOf[id] !== undefined }));
  };
  for (const s0 of seats) push(s0.id, 'founder');
  for (const j of jobs) if (founder[j.id]) push(j.id, 'founder');
  for (const j of jobs) push(j.id, 'team');
  return out;
}

/** get(ctx, kind, ref) -> the record's view with its work history, people and visible deals. */
function get(ctx, kind, ref) {
  const k = kindOf(kind);
  const app = ctx.app;
  const util = u();
  const rec = resolve(app, k, ref, { deleted: true });
  const D = L('lib_deals');
  const vis = D.visibleSql(ctx, 'd');
  if (k === 'people') {
    const out = personOut(app, rec);
    out.employments = app.findRecordsByFilter('employments', 'person = {:p}', '-current,-start_day', 50, 0, { p: rec.id }).map((e) => employmentOut(app, e));
    const all = util.count(app, "SELECT COUNT(DISTINCT d.id) AS n FROM deals d JOIN deal_people dp ON dp.deal = d.id WHERE dp.person = {:p} AND d.deleted_at = ''", { p: rec.id });
    const rows = util.rows(app, "SELECT DISTINCT d.id AS id, dp.role AS role FROM deals d JOIN deal_people dp ON dp.deal = d.id WHERE dp.person = {:p} AND d.deleted_at = '' AND " + vis.sql + ' ORDER BY d.updated DESC LIMIT 50', { id: '', role: '' }, Object.assign({ p: rec.id }, vis.bind));
    out.deals = rows.map((r) => Object.assign(D.cardOut(app, app.findRecordById('deals', r.id)), { role: r.role }));
    out.deals_hidden = Math.max(0, all - util.count(app, "SELECT COUNT(DISTINCT d.id) AS n FROM deals d JOIN deal_people dp ON dp.deal = d.id WHERE dp.person = {:p} AND d.deleted_at = '' AND " + vis.sql, Object.assign({ p: rec.id }, vis.bind)));
    return out;
  }
  const out = companyOut(app, rec);
  out.people = companyPeople(ctx, rec.id);
  const all = util.count(app, "SELECT COUNT(*) AS n FROM deals d WHERE d.company = {:c} AND d.deleted_at = ''", { c: rec.id });
  out.deals = util.rows(app, "SELECT d.id AS id FROM deals d WHERE d.company = {:c} AND d.deleted_at = '' AND " + vis.sql + ' ORDER BY d.updated DESC LIMIT 50', { id: '' }, Object.assign({ c: rec.id }, vis.bind)).map((r) => D.cardOut(app, app.findRecordById('deals', r.id)));
  out.deals_hidden = Math.max(0, all - out.deals.length);
  return out;
}

/* ------------------------------------------------------------ timeline */

/** The `timeline` providers of every module (events_*.js, read by the kernel's lib_events). */
function timelineProviders() {
  return L('lib_events').timelineFns();
}

/**
 * timeline(ctx, { company | person | deal, limit?, before? }) -> { items, hidden }:
 * every module's dated items for one record, newest first. An item:
 * { at, module, kind, title, href?, icon?, actor?, ref?: { collection, id } }.
 */
function timeline(ctx, target) {
  const util = u();
  const t = resolveTarget(ctx, target);
  const limit = Math.max(1, Math.min(200, Number(target.limit) || 50));
  const before = String(target.before || '');
  const items = [];
  let hidden = 0;
  for (const p of timelineProviders()) {
    const parts = p.fn.split('.');
    let rows = [];
    try {
      rows = require(`${__hooks}/${parts[0]}.js`)[parts[1]](ctx, t) || [];
    } catch (err) {
      console.error('[vo] timeline ' + p.fn + ' failed:', err);
      continue;
    }
    if (rows && !Array.isArray(rows) && Array.isArray(rows.items)) {
      hidden += Number(rows.hidden) || 0;
      rows = rows.items;
    }
    for (const r of rows) {
      if (!r || typeof r.at !== 'string' || r.at === '') continue;
      const at = r.at.replace(' ', 'T');
      if (before !== '' && !(at < before.replace(' ', 'T'))) continue;
      items.push(Object.assign({ module: p.module }, r, { at: at }));
    }
  }
  items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const page = items.slice(0, limit);
  return { target: { kind: t.kind, id: t.id }, items: page, hidden: hidden, next_before: items.length > limit ? page[page.length - 1].at : null };
}

/** { kind: 'company'|'person'|'deal', id, company?, person?, deal? } with rights checked. */
function resolveTarget(ctx, target) {
  const util = u();
  const app = ctx.app;
  if (target.deal) {
    const d = L('lib_deals').ref(app, target.deal);
    L('lib_deals').guard(ctx, d);
    return { kind: 'deal', id: d.id, deal: d.id, company: d.getString('company') };
  }
  if (target.person) {
    L('lib_auth').need(ctx, 'network', 'view');
    const p = resolve(app, 'people', target.person, { deleted: true });
    return { kind: 'person', id: p.id, person: p.id, company: p.getString('company') };
  }
  if (target.company) {
    L('lib_auth').need(ctx, 'network', 'view');
    const c = resolve(app, 'companies', target.company, { deleted: true });
    return { kind: 'company', id: c.id, company: c.id };
  }
  throw util.fail(400, 'Give --company, --person or --deal.', 'missing_param');
}

/** This module's timeline items (events_records.js timeline): created, jobs, deal stages, files. */
function timelineFor(ctx, t) {
  const util = u();
  const app = ctx.app;
  const out = [];
  let hidden = 0;
  const D = L('lib_deals');
  const vis = D.visibleSql(ctx, 'd');
  if (t.kind === 'company' || t.kind === 'person') {
    const rec = app.findRecordById(t.kind === 'company' ? 'companies' : 'people', t.id);
    out.push({ at: rec.getString('created'), kind: 'created', title: (t.kind === 'company' ? 'Company added' : 'Person added') + (rec.getString('origin') !== '' ? ' (' + rec.getString('origin') + ')' : ''), icon: t.kind === 'company' ? 'Building2' : 'UserPlus', actor: rec.getString('actor') });
  }
  if (t.kind === 'person') {
    for (const e of app.findRecordsByFilter('employments', 'person = {:p}', '-created', 50, 0, { p: t.id })) {
      const c = mini(app, 'companies', e.getString('company'));
      out.push({ at: e.getString('created'), kind: 'employment', title: (e.getBool('current') ? 'Works at ' : 'Worked at ') + (c ? c.name : 'a company') + (e.getString('title') !== '' ? ', ' + e.getString('title') : ''), icon: 'Briefcase', href: c ? '#/companies/' + c.id : '', ref: { collection: 'employments', id: e.id } });
    }
  }
  if (t.kind === 'company') {
    for (const e of app.findRecordsByFilter('employments', 'company = {:c} && current = true', '-created', 50, 0, { c: t.id })) {
      const p = mini(app, 'people', e.getString('person'));
      out.push({ at: e.getString('created'), kind: 'employment', title: (p ? p.name : 'Someone') + ' joined' + (e.getString('title') !== '' ? ' as ' + e.getString('title') : ''), icon: 'UserPlus', href: p ? '#/people/' + p.id : '', ref: { collection: 'employments', id: e.id } });
    }
  }
  // Deal stage history: the deal itself, or the visible deals of the company or person.
  let dealIds = [];
  if (t.kind === 'deal') dealIds = [t.id];
  else {
    const sql = t.kind === 'company' ? "SELECT d.id AS id FROM deals d WHERE d.company = {:x} AND d.deleted_at = ''" : "SELECT DISTINCT d.id AS id FROM deals d JOIN deal_people dp ON dp.deal = d.id WHERE dp.person = {:x} AND d.deleted_at = ''";
    const all = util.rows(app, sql, { id: '' }, { x: t.id }).length;
    dealIds = util.rows(app, sql + ' AND ' + vis.sql, { id: '' }, Object.assign({ x: t.id }, vis.bind)).map((r) => r.id);
    hidden += all - dealIds.length;
  }
  for (const id of dealIds) {
    const d = app.findRecordById('deals', id);
    const pl = u().byId(app, 'pipelines', d.getString('pipeline'));
    const stages = pl ? D.stagesOf(pl) : [];
    const label = (key) => {
      const s = stages.filter((x) => x.key === key)[0];
      return s ? s.label : key;
    };
    for (const ev of app.findRecordsByFilter('stage_events', 'deal = {:d}', '-at', 100, 0, { d: id })) {
      const kind = ev.getString('kind');
      const title =
        kind === 'created' ? 'Deal ' + d.getString('number') + ' opened at ' + label(ev.getString('to_stage')) : kind === 'moved' ? 'Moved to ' + label(ev.getString('to_stage')) : 'Marked ' + ev.getString('to_status');
      out.push({ at: ev.getString('at'), kind: 'deal_' + kind, title: title, icon: kind === 'status' ? 'CircleDot' : 'ArrowRight', href: '#/deals/' + d.getString('number'), actor: ev.getString('actor'), ref: { collection: 'stage_events', id: ev.id } });
    }
  }
  // Files added: to the record itself, or (for a deal) its room.
  const F = L('lib_files');
  const fileRows = t.kind === 'deal' ? app.findRecordsByFilter('files', "deal = {:d} && deleted_at = ''", '-created', 100, 0, { d: t.id }) : app.findRecordsByFilter('files', "owner_collection = {:c} && owner_id = {:id} && deleted_at = ''", '-created', 100, 0, { c: t.kind === 'company' ? 'companies' : 'people', id: t.id });
  for (const f of fileRows) {
    if (!F.canRead(ctx, f, {}).ok) {
      hidden++;
      continue;
    }
    out.push({ at: f.getString('created'), kind: 'file', title: (f.getInt('version') > 1 ? 'New version of ' : 'File added: ') + f.getString('name'), icon: 'FileText', actor: f.getString('actor'), ref: { collection: 'files', id: f.id } });
  }
  return { items: out, hidden: hidden };
}

/* --------------------------------------------------------------- search */

/** Ctrl-K provider (events_records.js search, fn(ctx, q, limit)): people, companies, deals, files the caller may see. */
function search(ctx, q, limit) {
  const util = u();
  const auth = L('lib_auth');
  const app = ctx.app;
  const like = util.like(q);
  const per = Math.max(1, Math.min(20, Number(limit) || 6));
  const out = [];
  if (auth.can(ctx, 'network', 'view')) {
    for (const r of util.rows(app, "SELECT id, name, email, title FROM people WHERE deleted_at = '' AND (name LIKE {:q} ESCAPE '\\' OR email LIKE {:q} ESCAPE '\\') ORDER BY name LIMIT " + per, { id: '', name: '', email: '', title: '' }, { q: like }))
      out.push({ kind: 'person', id: r.id, title: r.name || r.email, subtitle: r.title || r.email, href: '#/people/' + r.id, icon: 'User' });
    for (const r of util.rows(app, "SELECT id, name, domain FROM companies WHERE deleted_at = '' AND (name LIKE {:q} ESCAPE '\\' OR domain LIKE {:q} ESCAPE '\\') ORDER BY name LIMIT " + per, { id: '', name: '', domain: '' }, { q: like }))
      out.push({ kind: 'company', id: r.id, title: r.name, subtitle: r.domain, href: '#/companies/' + r.id, icon: 'Building2' });
  }
  const vis = L('lib_deals').visibleSql(ctx, 'd');
  for (const r of util.rows(
    app,
    "SELECT d.id AS id, d.number AS number, COALESCE(NULLIF(d.name, ''), c.name) AS title, d.stage AS stage FROM deals d JOIN companies c ON c.id = d.company WHERE d.deleted_at = '' AND (d.number LIKE {:q} ESCAPE '\\' OR d.name LIKE {:q} ESCAPE '\\' OR c.name LIKE {:q} ESCAPE '\\') AND " + vis.sql + ' ORDER BY d.updated DESC LIMIT ' + per,
    { id: '', number: '', title: '', stage: '' },
    Object.assign({ q: like }, vis.bind),
  ))
    out.push({ kind: 'deal', id: r.id, title: r.title, subtitle: r.number, href: '#/deals/' + r.number, icon: 'Briefcase' });
  const F = L('lib_files');
  let nf = 0;
  for (const f of app.findRecordsByFilter('files', "current = true && deleted_at = '' && nda = false && name ~ {:q}", '-created', 30, 0, { q: q })) {
    if (nf >= per) break;
    if (!F.canRead(ctx, f, {}).ok) continue;
    out.push({ kind: 'file', id: f.id, title: f.getString('name'), subtitle: f.getString('folder'), href: F.hrefOf(app, f), icon: 'FileText' });
    nf++;
  }
  return out;
}

/* ------------------------------------------------------------------ ops */

function originParam(p) {
  return u().str(p, 'origin', '');
}

function opUpsertPerson(ctx, p) {
  L('lib_auth').need(ctx, 'network', 'edit');
  const o = valuesFromParams('people', p);
  o.person = u().str(p, 'person', '');
  o.origin = originParam(p);
  o.source_ref = u().str(p, 'source_ref', '');
  return { person: upsertPerson(ctx, o) };
}

function opUpsertCompany(ctx, p) {
  L('lib_auth').need(ctx, 'network', 'edit');
  const o = valuesFromParams('companies', p);
  o.company = u().str(p, 'company', '');
  o.origin = originParam(p);
  o.source_ref = u().str(p, 'source_ref', '');
  return { company: upsertCompany(ctx, o) };
}

function valuesFromParams(kind, p) {
  const out = {};
  for (const d of FIELDS[kind]) {
    if (kind === 'people' && d.key === 'company') {
      if (u().has(p, 'company')) out.company = u().str(p, 'company', '');
      continue;
    }
    if (u().has(p, d.key)) out[d.key] = LIST_TYPES.indexOf(d.type) >= 0 ? p[d.key] : u().str(p, d.key, '');
  }
  return out;
}

function opUpdatePerson(ctx, p) {
  L('lib_auth').need(ctx, 'network', 'edit');
  return { person: updateRecord(ctx, 'people', u().req(p, 'person'), valuesFromParams('people', p), metaOf(ctx, { source_ref: u().str(p, 'source_ref', '') }, 'update')) };
}

function opUpdateCompany(ctx, p) {
  L('lib_auth').need(ctx, 'network', 'edit');
  const v = valuesFromParams('companies', p);
  delete v.company;
  return { company: updateRecord(ctx, 'companies', u().req(p, 'company'), v, metaOf(ctx, { source_ref: u().str(p, 'source_ref', '') }, 'update')) };
}

/** records.enrich: fill empty fields of a person, company or deal from a named source. */
function opEnrich(ctx, p) {
  const util = u();
  const fields = util.obj(p, 'fields');
  if (fields === undefined || Object.keys(fields).length === 0) throw util.fail(400, 'fields is a JSON object of field: value, e.g. {"sector":"fintech"}.', 'missing_param', { param: 'fields' });
  const sourceRef = util.str(p, 'source_ref', '');
  if (ctx.isAgent && sourceRef === '') throw util.fail(400, 'source_ref is required for your AI agent: the link or document each value came from.', 'missing_param', { param: 'source_ref' });
  const given = ['person', 'company', 'deal'].filter((k) => util.str(p, k, '') !== '');
  if (given.length !== 1) throw util.fail(400, 'Give exactly one of --person, --company or --deal.', 'missing_param');
  if (given[0] === 'deal') return { deal: L('lib_deals').fill(ctx, util.str(p, 'deal', ''), fields, sourceRef) };
  L('lib_auth').need(ctx, 'network', 'edit');
  const kind = given[0] === 'person' ? 'people' : 'companies';
  const view = fillRecord(ctx, kind, util.str(p, given[0], ''), fields, metaOf(ctx, { source_ref: sourceRef }, 'fill'));
  // Your AI agent's sourced facts on a company are its research landing (trigger company_research).
  if (ctx.isAgent && kind === 'companies' && view && view.id) {
    const c = util.byId(ctx.app, 'companies', view.id);
    if (c !== null) L('lib_agent').landed(ctx.app, 'company_research', c);
  }
  const out = {};
  out[given[0]] = view;
  return out;
}

function opLink(ctx, p) {
  const util = u();
  L('lib_auth').need(ctx, 'network', 'edit');
  return { employment: link(ctx, util.req(p, 'person'), util.req(p, 'company'), util.str(p, 'title', ''), { current: util.bool(p, 'current', true), founder: util.has(p, 'founder') ? util.bool(p, 'founder', false) : undefined, start_day: util.day(p, 'start_day', ''), end_day: util.day(p, 'end_day', ''), source_ref: util.str(p, 'source_ref', '') }) };
}

function opUnlink(ctx, p) {
  const util = u();
  L('lib_auth').need(ctx, 'network', 'edit');
  return unlink(ctx, util.req(p, 'person'), util.req(p, 'company'));
}

function previewUnlink(ctx, params) {
  const app = ctx.app;
  const pr = resolve(app, 'people', params.person);
  const c = resolve(app, 'companies', params.company);
  const ln = L('lib_proposals').line('Company', c.getString('name'), 'None', 'text', 'company');
  return { label: personName(pr) + ': Leaves ' + c.getString('name'), target: 'people:' + pr.id, fields: ln !== null ? [ln] : [], notes: ['Ends the job there and removes them as founder or contact on its deals.'], risk: 'low' };
}

function opMergePeople(ctx, p) {
  L('lib_auth').need(ctx, 'network', 'edit');
  return merge(ctx, 'people', u().req(p, 'keep'), u().req(p, 'drop'));
}

function opMergeCompanies(ctx, p) {
  L('lib_auth').need(ctx, 'network', 'edit');
  return merge(ctx, 'companies', u().req(p, 'keep'), u().req(p, 'drop'));
}

function softDelete(ctx, kind, ref) {
  inRun(ctx, kind + '.delete', (t) => {
    const rec = resolve(t, kind, ref);
    rec.set('deleted_at', nowIso());
    t.save(rec);
    return { summary: 'Deleted ' + nameOf(kind, rec), type: kind, id: rec.id };
  });
  return { deleted: true };
}

function opDeletePerson(ctx, p) {
  L('lib_auth').need(ctx, 'network', 'full');
  return softDelete(ctx, 'people', u().req(p, 'person'));
}

function opDeleteCompany(ctx, p) {
  L('lib_auth').need(ctx, 'network', 'full');
  return softDelete(ctx, 'companies', u().req(p, 'company'));
}

function opGetPerson(ctx, p) {
  L('lib_auth').need(ctx, 'network', 'view');
  const out = { person: get(ctx, 'people', u().req(p, 'person')) };
  // Your AI agent sees what already waits for a person on this record, so it does not propose it twice.
  if (ctx.isAgent) out.pending_proposals = L('lib_proposals').pendingFor(ctx.app, 'people', out.person.id);
  return out;
}

function opGetCompany(ctx, p) {
  L('lib_auth').need(ctx, 'network', 'view');
  const out = { company: get(ctx, 'companies', u().req(p, 'company')) };
  if (ctx.isAgent) out.pending_proposals = L('lib_proposals').pendingFor(ctx.app, 'companies', out.company.id);
  return out;
}

function opTimelinePerson(ctx, p) {
  return timeline(ctx, { person: u().req(p, 'person'), limit: u().int(p, 'limit', 50, 1, 200), before: u().str(p, 'before', '') });
}

function opTimelineCompany(ctx, p) {
  return timeline(ctx, { company: u().req(p, 'company'), limit: u().int(p, 'limit', 50, 1, 200), before: u().str(p, 'before', '') });
}

function opTimeline(ctx, p) {
  const util = u();
  return timeline(ctx, { company: util.str(p, 'company', ''), person: util.str(p, 'person', ''), deal: util.str(p, 'deal', ''), limit: util.int(p, 'limit', 50, 1, 200), before: util.str(p, 'before', '') });
}

function opListPeople(ctx, p) {
  const util = u();
  L('lib_auth').need(ctx, 'network', 'view');
  const app = ctx.app;
  const pg = util.page(p, 50, 500);
  const where = [util.bool(p, 'deleted', false) ? "p.deleted_at != '' AND p.merged_into = ''" : "p.deleted_at = ''"];
  const bind = {};
  const q = util.str(p, 'q', '');
  if (q !== '') {
    where.push("(p.name LIKE {:q} ESCAPE '\\' OR p.email LIKE {:q} ESCAPE '\\' OR p.emails LIKE {:q} ESCAPE '\\' OR p.title LIKE {:q} ESCAPE '\\')");
    bind.q = util.like(q);
  }
  const company = util.str(p, 'company', '');
  if (company !== '') {
    where.push('p.company = {:c}');
    bind.c = resolve(app, 'companies', company).id;
  }
  const tag = util.str(p, 'tag', '');
  if (tag !== '') {
    where.push('p.tags LIKE {:t}');
    bind.t = '%' + JSON.stringify(tag) + '%';
  }
  const origin = util.oneOf(p, 'origin', ORIGINS, '');
  if (origin !== '') {
    where.push('p.origin = {:o}');
    bind.o = origin;
  }
  const sort = util.oneOf(p, 'sort', ['name', 'created', 'updated'], 'name');
  const order = sort === 'name' ? 'p.name COLLATE NOCASE' : 'p.' + sort + ' DESC';
  const w = where.join(' AND ');
  const total = util.count(app, 'SELECT COUNT(*) AS n FROM people p WHERE ' + w, bind);
  const ids = util.rows(app, 'SELECT p.id AS id FROM people p WHERE ' + w + ' ORDER BY ' + order + ' LIMIT ' + pg.limit + ' OFFSET ' + pg.offset, { id: '' }, bind);
  return { people: ids.map((r) => personOut(app, app.findRecordById('people', r.id))), total: total, limit: pg.limit, offset: pg.offset };
}

function opListCompanies(ctx, p) {
  const util = u();
  L('lib_auth').need(ctx, 'network', 'view');
  const app = ctx.app;
  const pg = util.page(p, 50, 500);
  const where = [util.bool(p, 'deleted', false) ? "c.deleted_at != '' AND c.merged_into = ''" : "c.deleted_at = ''"];
  const bind = {};
  const q = util.str(p, 'q', '');
  if (q !== '') {
    where.push("(c.name LIKE {:q} ESCAPE '\\' OR c.domain LIKE {:q} ESCAPE '\\' OR c.domains LIKE {:q} ESCAPE '\\')");
    bind.q = util.like(q);
  }
  const kind = util.oneOf(p, 'kind', COMPANY_KINDS, '');
  if (kind !== '') {
    where.push('c.kind = {:k}');
    bind.k = kind;
  }
  const sector = util.str(p, 'sector', '');
  if (sector !== '') {
    where.push('LOWER(c.sector) = LOWER({:s})');
    bind.s = sector;
  }
  const country = util.str(p, 'hq_country', '');
  if (country !== '') {
    where.push('c.hq_country = {:hc}');
    bind.hc = N().country(country, 'hq_country');
  }
  const tag = util.str(p, 'tag', '');
  if (tag !== '') {
    where.push('c.tags LIKE {:t}');
    bind.t = '%' + JSON.stringify(tag) + '%';
  }
  const sort = util.oneOf(p, 'sort', ['name', 'created', 'updated'], 'name');
  const order = sort === 'name' ? 'c.name COLLATE NOCASE' : 'c.' + sort + ' DESC';
  const w = where.join(' AND ');
  const vis = L('lib_deals').visibleSql(ctx, 'd');
  const total = util.count(app, 'SELECT COUNT(*) AS n FROM companies c WHERE ' + w, bind);
  const rows = util.rows(
    app,
    "SELECT c.id AS id, (SELECT COUNT(*) FROM deals d WHERE d.company = c.id AND d.deleted_at = '' AND d.status IN ('open', 'hold') AND " +
      vis.sql +
      ') AS open_deals, (SELECT COUNT(*) FROM employments e WHERE e.company = c.id AND e.current = TRUE) AS people FROM companies c WHERE ' +
      w +
      ' ORDER BY ' +
      order +
      ' LIMIT ' +
      pg.limit +
      ' OFFSET ' +
      pg.offset,
    { id: '', open_deals: 0, people: 0 },
    Object.assign({}, bind, vis.bind),
  );
  return { companies: rows.map((r) => Object.assign(companyOut(app, app.findRecordById('companies', r.id)), { open_deals: r.open_deals, people: r.people })), total: total, limit: pg.limit, offset: pg.offset };
}

/** records.dupes: likely duplicates (same normalized name), minus the pairs a person dismissed. */
function opDupes(ctx, p) {
  const util = u();
  L('lib_auth').need(ctx, 'network', 'view');
  const app = ctx.app;
  const kind = kindOf(util.oneOf(p, 'kind', ['person', 'company'], 'company'));
  const ignored = {};
  for (const r of util.findMany(app, 'dupe_ignores', 'kind = {:k}', '', 0, { k: kind })) ignored[r.getString('a') + ':' + r.getString('b')] = true;
  const groups = util.rows(app, "SELECT name_key AS k, COUNT(*) AS n FROM " + kind + " WHERE deleted_at = '' AND name_key != '' GROUP BY name_key HAVING COUNT(*) > 1 ORDER BY n DESC LIMIT 200", { k: '', n: 0 });
  const out = [];
  for (const g of groups) {
    const recs = app.findRecordsByFilter(kind, "deleted_at = '' && name_key = {:k}", 'created', 20, 0, { k: g.k });
    const pairs = [];
    for (let i = 0; i < recs.length; i++)
      for (let j = i + 1; j < recs.length; j++) {
        const a = recs[i].id < recs[j].id ? recs[i].id : recs[j].id;
        const b = recs[i].id < recs[j].id ? recs[j].id : recs[i].id;
        if (!ignored[a + ':' + b]) pairs.push([a, b]);
      }
    if (pairs.length === 0) continue;
    out.push({ kind: kind === 'people' ? 'person' : 'company', records: recs.map((r) => (kind === 'people' ? personOut(app, r) : companyOut(app, r))), pairs: pairs });
    if (out.length >= util.int(p, 'limit', 50, 1, 200)) break;
  }
  return { groups: out };
}

function opIgnoreDupe(ctx, p) {
  const util = u();
  L('lib_auth').need(ctx, 'network', 'edit');
  const kind = kindOf(util.req(p, 'kind'));
  const a0 = resolve(ctx.app, kind, util.req(p, 'a')).id;
  const b0 = resolve(ctx.app, kind, util.req(p, 'b')).id;
  if (a0 === b0) throw util.fail(400, 'Give two different records.', 'invalid_param');
  const a = a0 < b0 ? a0 : b0;
  const b = a0 < b0 ? b0 : a0;
  if (util.findOne(ctx.app, 'dupe_ignores', 'kind = {:k} && a = {:a} && b = {:b}', { k: kind, a: a, b: b }) !== null) return { ignored: true };
  inRun(ctx, 'records.ignore-dupe', (t) => {
    const r = util.newRecord(t, 'dupe_ignores');
    r.set('kind', kind);
    r.set('a', a);
    r.set('b', b);
    stampWritten(ctx, r);
    t.save(r);
    return { summary: 'Not duplicates', type: kind, id: a };
  });
  return { ignored: true };
}

/* -------------------------------------------------------------- previews */

/** Field labels people see in proposals ("hq_country" -> "HQ country"). */
const FIELD_LABELS = { stage: 'Stage', linkedin: 'LinkedIn', hq_country: 'HQ country', hq_city: 'HQ city', founded_year: 'Founded', team_size: 'Team size', business_model: 'Business model', emails: 'Other emails', domains: 'Other domains' };

function fieldLabel(def) {
  if (FIELD_LABELS[def.key] !== undefined) return FIELD_LABELS[def.key];
  const s = def.key.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** One field as a proposal line (lists as lists, a company by its name). */
function lineOf(app, def, before, after) {
  const P = L('lib_proposals');
  if (def.type === 'company') {
    const b = mini(app, 'companies', before);
    const a = after === '' || after === null || after === undefined ? null : u().byId(app, 'companies', String(after));
    return P.line(fieldLabel(def), b ? b.name : '', a ? a.getString('name') : String(after || ''), 'text', def.key);
  }
  if (LIST_TYPES.indexOf(def.type) >= 0) return P.line(fieldLabel(def), before, after, 'list', def.key);
  if (def.type === 'year' || def.type === 'count') return P.line(fieldLabel(def), toInput(def, before), after, def.type === 'count' ? 'int' : 'text', def.key);
  return P.line(fieldLabel(def), toInput(def, before), after, 'text', def.key);
}

function previewUpdate(ctx, kind, params, refKey) {
  const app = ctx.app;
  const rec = resolve(app, kind, params[refKey]);
  const fields = [];
  for (const def of FIELDS[kind]) {
    if (params[def.key] === undefined) continue;
    const ln = lineOf(app, def, getVal(rec, def), params[def.key]);
    if (ln !== null) fields.push(ln);
  }
  return { label: L('lib_proposals').titleOf(nameOf(kind, rec), fields), target: kind + ':' + rec.id, fields: fields, notes: params.source_ref ? ['Source: ' + params.source_ref] : [], risk: 'low' };
}

function previewPerson(ctx, params) {
  return previewUpdate(ctx, 'people', params, 'person');
}

function previewCompany(ctx, params) {
  return previewUpdate(ctx, 'companies', params, 'company');
}

function previewMerge(ctx, kind, params) {
  const app = ctx.app;
  const keep = resolve(app, kind, params.keep);
  const drop = resolve(app, kind, params.drop);
  const fields = [];
  const P = L('lib_proposals');
  const merged = P.line('Merge', '', nameOf(kind, drop), 'text', 'merge');
  if (merged !== null) fields.push(merged);
  for (const def of FIELDS[kind]) {
    const a = getVal(keep, def);
    const b = getVal(drop, def);
    if (isEmpty(def, b) || same(a, b)) continue;
    const ln = lineOf(app, def, a, LIST_TYPES.indexOf(def.type) >= 0 ? union(a, b) : isEmpty(def, a) ? b : a);
    if (ln !== null) fields.push(ln);
  }
  return { label: nameOf(kind, keep) + ': Merge ' + nameOf(kind, drop), target: kind + ':' + keep.id, fields: fields, notes: ['Keeps ' + nameOf(kind, keep) + '; ' + nameOf(kind, drop) + ' resolves to it afterwards.'], risk: 'medium' };
}

function previewMergePeople(ctx, params) {
  return previewMerge(ctx, 'people', params);
}

function previewMergeCompanies(ctx, params) {
  return previewMerge(ctx, 'companies', params);
}

module.exports = {
  FIELDS: FIELDS,
  ORIGINS: ORIGINS,
  COMPANY_KINDS: COMPANY_KINDS,
  BUSINESS_MODELS: MODELS,
  who: who,
  inRun: inRun,
  emit: emit,
  stampWritten: stampWritten,
  provEntry: provEntry,
  agentMay: agentMay,
  resolve: resolve,
  upsertCompany: upsertCompany,
  upsertPerson: upsertPerson,
  upsertCompanyIn: upsertCompanyIn,
  upsertPersonIn: upsertPersonIn,
  link: link,
  unlink: unlink,
  companyPeople: companyPeople,
  merge: merge,
  get: get,
  timeline: timeline,
  timelineFor: timelineFor,
  search: search,
  personOut: personOut,
  companyOut: companyOut,
  mini: mini,
  personName: personName,
  opUpsertPerson: opUpsertPerson,
  opUpsertCompany: opUpsertCompany,
  opUpdatePerson: opUpdatePerson,
  opUpdateCompany: opUpdateCompany,
  opEnrich: opEnrich,
  opLink: opLink,
  opUnlink: opUnlink,
  previewUnlink: previewUnlink,
  opMergePeople: opMergePeople,
  opMergeCompanies: opMergeCompanies,
  opDeletePerson: opDeletePerson,
  opDeleteCompany: opDeleteCompany,
  opGetPerson: opGetPerson,
  opGetCompany: opGetCompany,
  opTimelinePerson: opTimelinePerson,
  opTimelineCompany: opTimelineCompany,
  opTimeline: opTimeline,
  opListPeople: opListPeople,
  opListCompanies: opListCompanies,
  opDupes: opDupes,
  opIgnoreDupe: opIgnoreDupe,
  previewPerson: previewPerson,
  previewCompany: previewCompany,
  previewMergePeople: previewMergePeople,
  previewMergeCompanies: previewMergeCompanies,
};
