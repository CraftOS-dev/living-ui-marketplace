/// <reference path="../pb_data/types.d.ts" />
/**
 * People, companies and deals as typed records.
 *
 * Every field has a type that cleans what is written (emails lowercased and
 * validated, domains reduced to the root, money parsed in the deal's
 * currency) and a provenance entry: who last wrote it (user, agent, import),
 * when, in which agent run, from which source. That decides what the AI
 * agent may do (lib_setup policy):
 *   - fill an empty field, add to a list field, change a value it wrote
 *     itself: written directly, marked as the agent's
 *   - change a value the person (or an import) set: a proposal
 *   - a deal's value, currency, close date or probability: a proposal
 * unless the person made that kind of change automatic.
 *
 * Identity: people are found by email, companies by root domain (or exact
 * name), deals by exact name; a merged record's old id still resolves to the
 * survivor (aliases). Deleted records stay in the trash for 90 days.
 */

const OBJECTS = {
  people: {
    c: 'people',
    one: 'person',
    fields: [
      { key: 'first_name', label: 'First name', type: 'text', max: 80 },
      { key: 'last_name', label: 'Last name', type: 'text', max: 80 },
      { key: 'emails', label: 'Emails', type: 'emails' },
      { key: 'phones', label: 'Phones', type: 'phones' },
      { key: 'title', label: 'Title', type: 'text', max: 160 },
      { key: 'company', label: 'Company', type: 'company' },
      { key: 'linkedin', label: 'LinkedIn', type: 'url' },
      { key: 'location', label: 'Location', type: 'text', max: 160 },
      { key: 'birthday', label: 'Birthday', type: 'birthday' },
      { key: 'how_met', label: 'How you know them', type: 'longtext', max: 500 },
      { key: 'source', label: 'Source', type: 'text', max: 80 },
      { key: 'tags', label: 'Tags', type: 'tags' },
      { key: 'keep_in_touch', label: 'Keep in touch', type: 'cadence' },
    ],
  },
  companies: {
    c: 'companies',
    one: 'company',
    fields: [
      { key: 'name', label: 'Name', type: 'text', max: 200, required: true },
      { key: 'domains', label: 'Domains', type: 'domains' },
      { key: 'industry', label: 'Industry', type: 'text', max: 80 },
      { key: 'size', label: 'Size', type: 'select', options: ['1-10', '11-50', '51-200', '201-1000', '1001-5000', '5000+'] },
      { key: 'location', label: 'Location', type: 'text', max: 160 },
      { key: 'description', label: 'Description', type: 'longtext', max: 2000 },
      { key: 'linkedin', label: 'LinkedIn', type: 'url' },
      { key: 'source', label: 'Source', type: 'text', max: 80 },
      { key: 'tags', label: 'Tags', type: 'tags' },
    ],
  },
  deals: {
    c: 'deals',
    one: 'deal',
    fields: [
      { key: 'name', label: 'Name', type: 'text', max: 200, required: true },
      { key: 'value', label: 'Value', type: 'money', gate: 'deal_value' },
      { key: 'currency', label: 'Currency', type: 'currency', gate: 'deal_value' },
      { key: 'expected_close', label: 'Expected close', type: 'date', gate: 'deal_value' },
      { key: 'probability', label: 'Probability', type: 'percent', gate: 'deal_value', column: 'prob_override' },
      { key: 'company', label: 'Company', type: 'company' },
      { key: 'source', label: 'Source', type: 'text', max: 80 },
      { key: 'next_step', label: 'Next step', type: 'text', max: 300 },
      { key: 'next_step_date', label: 'Next step date', type: 'date' },
      { key: 'lost_reason', label: 'Lost reason', type: 'text', max: 300 },
      { key: 'tags', label: 'Tags', type: 'tags' },
    ],
  },
};

function U() {
  return require(`${__hooks}/lib_util.js`);
}

function fail(status, message, extra) {
  const err = new Error(message);
  err.status = status;
  if (extra) err.extra = extra;
  return err;
}

function obj(name) {
  const o = OBJECTS[name];
  if (!o) throw fail(400, 'object must be one of: people, companies, deals');
  return o;
}

function nowIso() {
  return new Date().toISOString();
}

/* ----------------------------------------------------------------- fields */

function customDefs(app, object) {
  const u = U();
  return app.findRecordsByFilter('fields', 'object = {:o}', 'position,label', 0, 0, { o: object }).map((f) => ({
    key: 'custom.' + f.getString('key'),
    ckey: f.getString('key'),
    label: f.getString('label'),
    type: 'custom_' + f.getString('type'),
    ctype: f.getString('type'),
    options: (u.json(f, 'options', []) || []).map((o) => (typeof o === 'string' ? o : String((o && o.value) || ''))).filter((x) => x !== ''),
    ai_prompt: f.getString('ai_prompt'),
    custom: true,
  }));
}

/** Field definitions by key (built-in and custom). */
function fieldMap(app, object) {
  const out = {};
  for (const d of obj(object).fields) out[d.key] = d;
  for (const d of customDefs(app, object)) out[d.key] = d;
  return out;
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
      /* fall through */
    }
  }
  return s.split(',');
}

/** The stored value of a field. */
function get(rec, def) {
  const u = U();
  if (def.custom) {
    const c = u.json(rec, 'custom', {}) || {};
    return c[def.ckey] === undefined ? null : c[def.ckey];
  }
  switch (def.type) {
    case 'emails':
    case 'phones':
    case 'domains':
    case 'tags':
      return u.json(rec, def.key, []) || [];
    case 'cadence':
      return rec.getInt(def.key);
    case 'money':
      return rec.getFloat(def.key);
    case 'percent': {
      const v = rec.getFloat(def.column);
      return v < 0 ? null : v;
    }
    default:
      return rec.getString(def.key);
  }
}

function put(rec, def, v) {
  const u = U();
  if (def.custom) {
    const c = u.json(rec, 'custom', {}) || {};
    if (v === null || v === '' || (Array.isArray(v) && v.length === 0) || v === false) delete c[def.ckey];
    else c[def.ckey] = v;
    rec.set('custom', c);
    return;
  }
  if (def.type === 'emails') {
    rec.set('emails', v);
    rec.set('primary_email', v[0] || '');
    return;
  }
  if (def.type === 'domains') {
    rec.set('domains', v);
    rec.set('primary_domain', v[0] || '');
    return;
  }
  if (def.type === 'percent') {
    rec.set(def.column, v === null ? -1 : v);
    return;
  }
  rec.set(def.key, v);
}

function isEmpty(def, v) {
  if (v === null || v === undefined || v === '' || v === false) return true;
  if (Array.isArray(v)) return v.length === 0;
  if ((def.type === 'cadence' || def.type === 'money') && v === 0) return true;
  return false;
}

function same(a, b) {
  return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
}

/** A list change that only adds values (an agent may always add an email or a tag). */
function additive(def, before, after) {
  if (!Array.isArray(before) || !Array.isArray(after)) return false;
  return before.every((x) => after.indexOf(x) >= 0);
}

/** Clean a written value into its stored form. ctx: { currency, home, create (companies), who }. */
function coerce(app, def, raw, ctx) {
  const u = U();
  const norm = require(`${__hooks}/lib_norm.js`);
  const name = def.label;
  const s = raw === null || raw === undefined ? '' : Array.isArray(raw) ? raw : String(raw);
  switch (def.type) {
    case 'text': {
      const v = u.squash(s).slice(0, def.max || 200);
      if (def.required && v === '') throw fail(400, name + ' is required');
      return v;
    }
    case 'longtext':
      return String(s).replace(/\r\n/g, '\n').trim().slice(0, def.max || 2000);
    case 'emails':
      return norm.emails(listOf(raw), name);
    case 'phones':
      return norm.phones(listOf(raw));
    case 'domains':
      return norm.domains(listOf(raw), name);
    case 'tags':
      return norm.tags(listOf(raw));
    case 'url':
      return norm.url(s).slice(0, 300);
    case 'birthday':
      return norm.birthday(s, name);
    case 'cadence': {
      if (s === '') return 0;
      const n = Number(s);
      if (!isFinite(n) || n < 0 || n > 3650 || Math.floor(n) !== n) throw fail(400, name + ' is a number of days from 0 (off) to 3650');
      return n;
    }
    case 'select': {
      if (s === '') return '';
      const hit = def.options.find((o) => o.toLowerCase() === String(s).toLowerCase());
      if (!hit) throw fail(400, name + ' must be one of: ' + def.options.join(', '));
      return hit;
    }
    case 'date':
      return s === '' ? '' : require(`${__hooks}/lib_dates.js`).parse(s, def.key);
    case 'money': {
      if (s === '') return 0;
      const v = require(`${__hooks}/lib_money.js`).parse(String(s), ctx.currency, name);
      if (v < 0) throw fail(400, name + ' cannot be negative');
      return v;
    }
    case 'currency': {
      const c = String(s).toUpperCase().trim();
      if (!require(`${__hooks}/lib_money.js`).known(c)) throw fail(400, 'Unknown currency ' + s);
      return c;
    }
    case 'percent': {
      if (s === '' || s === 'null' || s === 'stage') return null;
      const n = Number(String(s).replace('%', ''));
      if (!isFinite(n) || n < 0 || n > 100) throw fail(400, name + ' is a percent from 0 to 100 (or empty for the stage probability)');
      return Math.round(n);
    }
    case 'company':
      return s === '' ? '' : resolveCompany(app, String(s), { create: ctx.create !== false, who: ctx.who }).id;
    case 'custom_text':
      return u.squash(s).slice(0, 500);
    case 'custom_number': {
      if (s === '') return null;
      const n = Number(s);
      if (!isFinite(n)) throw fail(400, name + ' must be a number');
      return n;
    }
    case 'custom_currency':
      return s === '' ? null : require(`${__hooks}/lib_money.js`).parse(String(s), ctx.home, name);
    case 'custom_date':
      return s === '' ? null : require(`${__hooks}/lib_dates.js`).parse(s, def.ckey);
    case 'custom_select': {
      if (s === '') return null;
      const hit = def.options.find((o) => o.toLowerCase() === String(s).toLowerCase());
      if (!hit) throw fail(400, name + ' must be one of: ' + def.options.join(', '));
      return hit;
    }
    case 'custom_multi_select': {
      const out = [];
      for (const x of listOf(raw)) {
        const hit = def.options.find((o) => o.toLowerCase() === String(x).trim().toLowerCase());
        if (!hit) throw fail(400, name + ' values must be from: ' + def.options.join(', '));
        if (out.indexOf(hit) < 0) out.push(hit);
      }
      return out;
    }
    case 'custom_checkbox':
      return raw === true || s === 'true' || s === '1' || s === 'yes';
    case 'custom_url':
      return s === '' ? null : norm.url(s).slice(0, 300);
    case 'custom_rating': {
      if (s === '') return null;
      const n = Number(s);
      if (!isFinite(n) || n < 0 || n > 5 || Math.floor(n) !== n) throw fail(400, name + ' is a rating from 0 to 5');
      return n;
    }
    default:
      throw fail(400, 'Cannot write ' + name);
  }
}

/** A value in words, for change lists and proposals. */
function display(app, def, v, currency) {
  if (v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) return '';
  const money = require(`${__hooks}/lib_money.js`);
  switch (def.type) {
    case 'company': {
      const c = U().byId(app, 'companies', v);
      return c ? c.getString('name') : '';
    }
    case 'money':
      return money.format(v, currency);
    case 'custom_currency':
      return money.format(v, currency);
    case 'percent':
      return v + '%';
    case 'cadence':
      return v > 0 ? 'every ' + v + ' days' : '';
    case 'custom_checkbox':
      return v ? 'Yes' : 'No';
    default:
      return Array.isArray(v) ? v.join(', ') : String(v);
  }
}

/** A stored value back in the form the operations accept (for proposals). */
function toInput(def, v, currency) {
  if (def.type === 'money' || def.type === 'custom_currency') return v === null ? '' : require(`${__hooks}/lib_money.js`).toDecimal(v, currency);
  if (def.type === 'percent') return v === null ? '' : String(v);
  return v === null ? '' : v;
}

function provOf(rec) {
  return U().json(rec, 'prov', {}) || {};
}

/* ----------------------------------------------------------------- naming */

function personName(rec) {
  const n = (rec.getString('first_name') + ' ' + rec.getString('last_name')).trim();
  return n || rec.getString('primary_email') || 'Unnamed person';
}

function nameOf(object, rec) {
  if (object === 'people') return personName(rec);
  return rec.getString('name') || (object === 'companies' ? rec.getString('primary_domain') : 'Deal');
}

/* ---------------------------------------------------------------- resolve */

function followMerge(app, collection, rec) {
  let r = rec;
  for (let i = 0; i < 10 && r && r.getString('merged_into') !== ''; i++) r = U().byId(app, collection, r.getString('merged_into'));
  return r;
}

function cand(object, rec) {
  return { id: rec.id, name: nameOf(object, rec), deleted: rec.getString('deleted') !== '' };
}

/**
 * Find a record by id (merged ids follow to the survivor), or people by
 * email, companies by domain or exact name, deals by exact name. Several
 * matches: 409 with the candidates. opts.deleted: also the trash.
 */
function resolve(app, object, ref, opts) {
  const u = U();
  const o = obj(object);
  const r = String(ref || '').trim();
  if (r === '') throw fail(400, o.one + ' is required');
  let rec = u.byId(app, o.c, r);
  if (!rec) {
    const al = u.findOne(app, 'aliases', 'old_id = {:id}', { id: r });
    if (al) rec = u.byId(app, o.c, al.getString('new_id'));
  }
  if (rec) {
    rec = followMerge(app, o.c, rec);
    if (!rec) throw fail(404, 'No ' + o.one + ' ' + r);
    if (rec.getString('deleted') !== '' && !(opts && opts.deleted)) throw fail(409, nameOf(object, rec) + ' is in the trash; restore it first (records.restore)');
    return rec;
  }
  const norm = require(`${__hooks}/lib_norm.js`);
  let rows = [];
  if (object === 'people') {
    const e = norm.email(r);
    if (e.indexOf('@') > 0) rows = app.findRecordsByFilter('people', "deleted = '' && (primary_email = {:e} || emails ~ {:q})", '', 5, 0, { e: e, q: '"' + e + '"' });
    else {
      const all = app.findRecordsByFilter('people', "deleted = ''", '', 0, 0);
      const key = norm.nameKey(r, '');
      rows = all.filter((p) => norm.nameKey(p.getString('first_name'), p.getString('last_name')) === key);
    }
  } else if (object === 'companies') {
    const d = r.indexOf(' ') < 0 && r.indexOf('.') > 0 ? norm.domain(r) : '';
    if (d !== '') rows = app.findRecordsByFilter('companies', "deleted = '' && (primary_domain = {:d} || domains ~ {:q})", '', 5, 0, { d: d, q: '"' + d + '"' });
    if (rows.length === 0) {
      const key = norm.companyKey(r);
      rows = app.findRecordsByFilter('companies', "deleted = ''", '', 0, 0).filter((c) => norm.companyKey(c.getString('name')) === key);
    }
  } else {
    rows = app.findRecordsByFilter('deals', "deleted = '' && name = {:n}", '-updated', 5, 0, { n: r });
    if (rows.length === 0) rows = app.findRecordsByFilter('deals', "deleted = ''", '-updated', 0, 0).filter((d) => d.getString('name').toLowerCase() === r.toLowerCase());
  }
  if (rows.length === 1) return rows[0];
  if (rows.length > 1) throw fail(409, 'Several ' + object + ' match "' + r + '"; pass an id', { candidates: rows.map((x) => cand(object, x)) });
  throw fail(404, 'No ' + o.one + ' "' + r + '" (search with ' + object + '.list --q)');
}

/** A company by id, domain or name; created (named from the domain) when missing and opts.create. */
function resolveCompany(app, ref, opts) {
  const norm = require(`${__hooks}/lib_norm.js`);
  try {
    return resolve(app, 'companies', ref);
  } catch (err) {
    if (!err || err.status !== 404 || !opts || !opts.create) throw err;
  }
  const r = String(ref).trim();
  const d = r.indexOf(' ') < 0 && r.indexOf('.') > 0 ? norm.domain(r) : '';
  return createCompany(app, opts.who || { actor: 'user', run: '' }, { name: d !== '' ? norm.companyFromDomain(d) : r, domains: d !== '' ? [d] : [] }, {});
}

/* ------------------------------------------------------------- uniqueness */

function emailOwner(app, e, exceptId) {
  const rows = app.findRecordsByFilter('people', '(primary_email = {:e} || emails ~ {:q}) && id != {:x}', '', 5, 0, { e: e, q: '"' + e + '"', x: exceptId || '' });
  return rows.length > 0 ? rows[0] : null;
}

function domainOwner(app, d, exceptId) {
  const rows = app.findRecordsByFilter('companies', '(primary_domain = {:d} || domains ~ {:q}) && id != {:x}', '', 5, 0, { d: d, q: '"' + d + '"', x: exceptId || '' });
  return rows.length > 0 ? rows[0] : null;
}

function checkUnique(app, object, rec, values) {
  if (object === 'people') {
    for (const e of values.emails || []) {
      const o = emailOwner(app, e, rec ? rec.id : '');
      if (o && o.getString('merged_into') === '')
        throw fail(409, o.getString('deleted') !== '' ? e + ' belongs to ' + personName(o) + ', who is in the trash; restore them instead' : e + ' already belongs to ' + personName(o), { candidates: [cand('people', o)] });
    }
  }
  if (object === 'companies') {
    for (const d of values.domains || []) {
      const o = domainOwner(app, d, rec ? rec.id : '');
      if (o && o.getString('merged_into') === '')
        throw fail(409, o.getString('deleted') !== '' ? d + ' belongs to ' + o.getString('name') + ', which is in the trash; restore it instead' : d + ' already belongs to ' + o.getString('name'), { candidates: [cand('companies', o)] });
    }
  }
}

/* ------------------------------------------------------------ employments */

/** Close the current job when the company changes and open the new one. */
function setEmployment(app, personRec, companyId, title) {
  const dates = require(`${__hooks}/lib_dates.js`);
  const cur = app.findRecordsByFilter('employments', 'person = {:p} && current = true', '', 0, 0, { p: personRec.id });
  let kept = false;
  for (const e of cur) {
    if (companyId !== '' && e.getString('company') === companyId) {
      if (title !== undefined && e.getString('title') !== title) {
        e.set('title', title);
        app.save(e);
      }
      kept = true;
      continue;
    }
    e.set('current', false);
    e.set('end', dates.today());
    app.save(e);
  }
  if (!kept && companyId !== '') {
    const e = new Record(app.findCollectionByNameOrId('employments'));
    e.set('person', personRec.id);
    e.set('company', companyId);
    e.set('title', title === undefined ? personRec.getString('title') : title);
    e.set('start', dates.today());
    e.set('current', true);
    app.save(e);
  }
}

/* ------------------------------------------------------- create / update */

function blank(app, object) {
  const rec = new Record(app.findCollectionByNameOrId(obj(object).c));
  rec.set('tags', []);
  rec.set('custom', {});
  rec.set('prov', {});
  rec.set('deleted', '');
  rec.set('merged_into', '');
  if (object === 'people') {
    rec.set('emails', []);
    rec.set('phones', []);
    rec.set('keep_in_touch', 0);
    rec.set('strength', 0);
    rec.set('touches', 0);
  }
  if (object === 'companies') {
    rec.set('domains', []);
    rec.set('strength', 0);
  }
  return rec;
}

function ctxFor(app, object, rec, values, who) {
  const fx = require(`${__hooks}/lib_fx.js`);
  const home = fx.home(app);
  let currency = home;
  if (object === 'deals') {
    currency = rec ? rec.getString('currency') || home : home;
    if (values && values.currency !== undefined && String(values.currency).trim() !== '') currency = String(values.currency).toUpperCase().trim();
  }
  return { currency: currency, home: home, who: who, create: true };
}

/**
 * Write provided values onto a new record (people and companies; deals go
 * through lib_deals). Returns the saved record. Duplicates are refused with
 * the existing record as the candidate.
 */
function createWith(app, who, object, values, meta) {
  const defs = fieldMap(app, object);
  const rec = blank(app, object);
  const ctx = ctxFor(app, object, null, values, who);
  const prov = {};
  const clean = {};
  for (const key of Object.keys(values)) {
    if (values[key] === undefined) continue;
    const def = defs[key];
    if (!def) throw fail(400, 'Unknown field "' + key + '" for ' + object + '; fields: ' + Object.keys(defs).join(', '));
    const v = coerce(app, def, values[key], ctx);
    if (isEmpty(def, v)) continue;
    clean[key] = v;
  }
  checkUnique(app, object, null, clean);
  for (const key of Object.keys(clean)) {
    put(rec, defs[key], clean[key]);
    prov[key] = { by: who.actor, at: nowIso(), run: who.run || '', source: (meta && meta.source) || '' };
  }
  rec.set('prov', prov);
  return { rec: rec, clean: clean };
}

function createPerson(app, who, values, meta, opts) {
  const norm = require(`${__hooks}/lib_norm.js`);
  const v = Object.assign({}, values);
  if (v.name !== undefined) {
    const parts = norm.splitName(v.name);
    if (v.first_name === undefined) v.first_name = parts[0];
    if (v.last_name === undefined) v.last_name = parts[1];
    delete v.name;
  }
  const { rec, clean } = createWith(app, who, 'people', v, meta);
  if (!clean.first_name && !clean.last_name && !(clean.emails && clean.emails.length)) throw fail(400, 'A person needs a name or an email');
  // A work email names the company when none was given.
  if (!clean.company && clean.emails && clean.emails.length > 0 && !(opts && opts.auto_company === false)) {
    const d = norm.workDomain(clean.emails[0]);
    if (d !== '') {
      const c = resolveCompany(app, d, { create: true, who: who });
      rec.set('company', c.id);
      const prov = provOf(rec);
      prov.company = { by: who.actor, at: nowIso(), run: who.run || '', source: 'email domain' };
      rec.set('prov', prov);
    }
  }
  const s = require(`${__hooks}/lib_setup.js`).row(app);
  if (!clean.keep_in_touch && s.getInt('keep_in_touch_default') > 0) rec.set('keep_in_touch', s.getInt('keep_in_touch_default'));
  if (rec.getInt('keep_in_touch') > 0) rec.set('next_touch', require(`${__hooks}/lib_dates.js`).addDays(require(`${__hooks}/lib_dates.js`).today(), rec.getInt('keep_in_touch')));
  app.save(rec);
  if (rec.getString('company') !== '') setEmployment(app, rec, rec.getString('company'), rec.getString('title'));
  return rec;
}

function createCompany(app, who, values, meta) {
  const norm = require(`${__hooks}/lib_norm.js`);
  const v = Object.assign({}, values);
  if (v.domain !== undefined) {
    v.domains = listOf(v.domains).concat(listOf(v.domain));
    delete v.domain;
  }
  if ((v.name === undefined || String(v.name).trim() === '') && v.domains !== undefined) {
    const d = norm.domains(listOf(v.domains), 'domains')[0];
    if (d) v.name = norm.companyFromDomain(d);
  }
  const { rec } = createWith(app, who, 'companies', v, meta);
  if (rec.getString('name') === '') throw fail(400, 'A company needs a name or a domain');
  app.save(rec);
  return rec;
}

/**
 * Change fields of a record with the agent policy applied. Returns
 * { changes: [{field, label, from, to}], proposal }: what was written and
 * the proposal holding what the AI agent may only propose.
 */
function update(app, who, object, rec, values, meta) {
  const setup = require(`${__hooks}/lib_setup.js`);
  const defs = fieldMap(app, object);
  const pol = setup.policy(setup.row(app));
  const isAgent = who && who.actor === 'agent';
  const ctx = ctxFor(app, object, rec, values, who);
  const oldCurrency = object === 'deals' ? rec.getString('currency') : ctx.home;
  const prov = provOf(rec);
  const direct = [];
  const proposed = [];
  const keys = Object.keys(values).filter((k) => values[k] !== undefined);
  // A deal's currency first, so a value in the same call parses in it.
  keys.sort((a, b) => (a === 'currency' ? -1 : b === 'currency' ? 1 : 0));
  for (const key of keys) {
    const def = defs[key];
    if (!def) throw fail(400, 'Unknown field "' + key + '" for ' + object + '; fields: ' + Object.keys(defs).join(', '));
    const nv = coerce(app, def, values[key], ctx);
    const ov = get(rec, def);
    if (same(ov, nv)) continue;
    let propose = false;
    if (isAgent) {
      if (def.gate) propose = pol.autonomy[def.gate] !== 'auto';
      else {
        const pv = prov[key];
        const fill = isEmpty(def, ov) || (pv && pv.by === 'agent') || additive(def, ov, nv);
        propose = !fill && pol.autonomy.update !== 'auto';
      }
    }
    (propose ? proposed : direct).push({ def: def, ov: ov, nv: nv });
  }
  const changes = [];
  const directKeys = direct.map((d) => d.def.key);
  if (object === 'people') {
    const em = direct.find((d) => d.def.key === 'emails');
    if (em) checkUnique(app, 'people', rec, { emails: em.nv });
  }
  if (object === 'companies') {
    const dm = direct.find((d) => d.def.key === 'domains');
    if (dm) checkUnique(app, 'companies', rec, { domains: dm.nv });
  }
  for (const d of direct) {
    const cur = d.def.key === 'value' ? ctx.currency : oldCurrency;
    changes.push({ field: d.def.key, label: d.def.label, from: display(app, d.def, d.ov, d.def.type === 'money' ? oldCurrency : cur), to: display(app, d.def, d.nv, ctx.currency) });
    put(rec, d.def, d.nv);
    prov[d.def.key] = { by: who.actor, at: nowIso(), run: who.run || '', source: (meta && meta.source) || '' };
  }
  // A new currency without a new value: the same amount, rescaled to its minor unit.
  if (object === 'deals' && directKeys.indexOf('currency') >= 0 && directKeys.indexOf('value') < 0 && oldCurrency !== ctx.currency) {
    const money = require(`${__hooks}/lib_money.js`);
    rec.set('value', money.parse(money.toDecimal(rec.getFloat('value'), oldCurrency), ctx.currency, 'value'));
  }
  let proposal = null;
  if (direct.length > 0) {
    rec.set('prov', prov);
    if (object === 'deals') rec.set('last_activity', nowIso());
    if (object === 'people' && rec.getInt('keep_in_touch') >= 0) refreshNextTouch(rec);
    app.save(rec);
    if (object === 'people' && (directKeys.indexOf('company') >= 0 || directKeys.indexOf('title') >= 0)) setEmployment(app, rec, rec.getString('company'), rec.getString('title'));
  }
  if (proposed.length > 0) {
    const review = require(`${__hooks}/lib_review.js`);
    const vals = {};
    for (const p of proposed) vals[p.def.key] = toInput(p.def, p.nv, p.def.type === 'money' ? ctx.currency : ctx.home);
    if (object === 'deals' && proposed.some((p) => p.def.key === 'value') && vals.currency === undefined && values.currency !== undefined) vals.currency = ctx.currency;
    proposal = review.create(app, who, {
      kind: proposed.some((p) => p.def.gate) ? 'deal_value' : 'update',
      object: object,
      target: rec.id,
      title: 'Change ' + proposed.map((p) => p.def.label.toLowerCase()).join(', ') + ' of ' + nameOf(object, rec),
      changes: proposed.map((p) => ({ field: p.def.key, label: p.def.label, from: display(app, p.def, p.ov, oldCurrency), to: display(app, p.def, p.nv, ctx.currency) })),
      payload: { op: 'records.update', object: object, id: rec.id, values: vals },
      meta: meta,
    });
  }
  return { changes: changes, proposal: proposal };
}

/** next_touch from the last interaction (or now) plus the cadence (Dex: contact resets it). */
function refreshNextTouch(rec) {
  const dates = require(`${__hooks}/lib_dates.js`);
  const days = rec.getInt('keep_in_touch');
  if (days <= 0) {
    rec.set('next_touch', '');
    return;
  }
  const base = String(rec.getString('last_interaction') || '').slice(0, 10) || String(rec.getString('created') || '').slice(0, 10) || dates.today();
  rec.set('next_touch', dates.addDays(base, days));
}

/* ------------------------------------------------------- trash and merges */

function softDelete(app, object, rec) {
  rec.set('deleted', nowIso());
  app.save(rec);
}

function restore(app, object, rec) {
  if (rec.getString('merged_into') !== '') throw fail(409, nameOf(object, rec) + ' was merged into another record; undo the merge instead');
  if (object === 'people') checkUnique(app, 'people', rec, { emails: U().json(rec, 'emails', []) || [] });
  if (object === 'companies') checkUnique(app, 'companies', rec, { domains: U().json(rec, 'domains', []) || [] });
  rec.set('deleted', '');
  app.save(rec);
}

function union(a, b) {
  const out = (a || []).slice();
  for (const x of b || []) if (out.indexOf(x) < 0) out.push(x);
  return out;
}

/** Point every link at `from` to `to` (dropping duplicates of membership rows). */
function moveLinks(app, object, from, to) {
  const u = U();
  const field = object === 'people' ? 'person' : object === 'companies' ? 'company' : 'deal';
  const simple = { people: ['notes', 'tasks', 'emails', 'employments'], companies: ['notes', 'tasks', 'interactions', 'employments', 'deals', 'people'], deals: ['notes', 'tasks', 'interactions', 'emails'] }[object];
  for (const c of simple) {
    const f = c === 'people' || c === 'deals' ? 'company' : field;
    for (const r of app.findRecordsByFilter(c, f + ' = {:id}', '', 0, 0, { id: from })) {
      r.set(f, to);
      app.save(r);
    }
  }
  if (object === 'people') {
    for (const r of app.findRecordsByFilter('interactions', 'people ~ {:id}', '', 0, 0, { id: from })) {
      const ids = r.getStringSlice('people').map((x) => (x === from ? to : x));
      r.set('people', ids.filter((x, i) => ids.indexOf(x) === i));
      app.save(r);
    }
    for (const r of app.findRecordsByFilter('deal_people', 'person = {:id}', '', 0, 0, { id: from })) {
      if (u.findOne(app, 'deal_people', 'person = {:p} && deal = {:d}', { p: to, d: r.getString('deal') })) app.delete(r);
      else {
        r.set('person', to);
        app.save(r);
      }
    }
  }
  if (object === 'deals') {
    for (const r of app.findRecordsByFilter('deal_people', 'deal = {:id}', '', 0, 0, { id: from })) {
      if (u.findOne(app, 'deal_people', 'deal = {:d} && person = {:p}', { d: to, p: r.getString('person') })) app.delete(r);
      else {
        r.set('deal', to);
        app.save(r);
      }
    }
  }
  if (object !== 'deals') {
    for (const r of app.findRecordsByFilter('list_entries', field + ' = {:id}', '', 0, 0, { id: from })) {
      if (u.findOne(app, 'list_entries', 'list = {:l} && ' + field + ' = {:t}', { l: r.getString('list'), t: to })) app.delete(r);
      else {
        r.set(field, to);
        app.save(r);
      }
    }
  }
}

/**
 * Merge `secondary` into `primary`: the primary's values win, its blanks are
 * filled from the secondary, emails/phones/domains/tags are combined, every
 * link moves to the primary, and the secondary goes to the trash marked as
 * merged (its id keeps resolving to the primary). Undo restores both.
 */
function merge(app, object, primary, secondary) {
  const u = U();
  if (primary.id === secondary.id) throw fail(400, 'Pick two different records to merge');
  for (const r of [primary, secondary]) if (r.getString('deleted') !== '') throw fail(409, nameOf(object, r) + ' is in the trash; restore it before merging');
  const defs = fieldMap(app, object);
  const pp = provOf(primary);
  const sp = provOf(secondary);
  const filled = [];
  for (const key of Object.keys(defs)) {
    const def = defs[key];
    const a = get(primary, def);
    const b = get(secondary, def);
    if (['emails', 'phones', 'domains', 'tags'].indexOf(def.type) >= 0) {
      const v = union(a, b);
      if (!same(v, a)) {
        put(primary, def, v);
        filled.push(def.label);
      }
      continue;
    }
    if (isEmpty(def, a) && !isEmpty(def, b)) {
      put(primary, def, b);
      if (sp[key]) pp[key] = sp[key];
      filled.push(def.label);
    }
  }
  primary.set('prov', pp);
  if (object === 'people' || object === 'companies') {
    const la = primary.getString('last_interaction');
    const lb = secondary.getString('last_interaction');
    if (lb > la) primary.set('last_interaction', lb);
  }
  // The secondary's unique keys move to the primary before it is saved.
  secondary.set('deleted', nowIso());
  secondary.set('merged_into', primary.id);
  if (object === 'people') {
    secondary.set('primary_email', '');
    secondary.set('emails', []);
  }
  if (object === 'companies') {
    secondary.set('primary_domain', '');
    secondary.set('domains', []);
  }
  app.save(secondary);
  app.save(primary);
  moveLinks(app, object, secondary.id, primary.id);
  for (const al of app.findRecordsByFilter('aliases', 'new_id = {:id}', '', 0, 0, { id: secondary.id })) {
    al.set('new_id', primary.id);
    app.save(al);
  }
  const al = new Record(app.findCollectionByNameOrId('aliases'));
  al.set('object', object);
  al.set('old_id', secondary.id);
  al.set('new_id', primary.id);
  app.save(al);
  for (const p of app.findRecordsByFilter('proposals', "target = {:id} && status = 'pending'", '', 0, 0, { id: secondary.id })) {
    p.set('target', primary.id);
    app.save(p);
  }
  if (object === 'people') require(`${__hooks}/lib_interactions.js`).recomputePerson(app, primary.id);
  if (object === 'companies') require(`${__hooks}/lib_interactions.js`).recomputeCompany(app, primary.id);
  return { filled: filled };
}

module.exports = {
  OBJECTS: OBJECTS,
  fail: fail,
  obj: obj,
  customDefs: customDefs,
  fieldMap: fieldMap,
  listOf: listOf,
  get: get,
  put: put,
  isEmpty: isEmpty,
  coerce: coerce,
  display: display,
  toInput: toInput,
  provOf: provOf,
  personName: personName,
  nameOf: nameOf,
  resolve: resolve,
  resolveCompany: resolveCompany,
  checkUnique: checkUnique,
  setEmployment: setEmployment,
  createPerson: createPerson,
  createCompany: createCompany,
  update: update,
  refreshNextTouch: refreshNextTouch,
  softDelete: softDelete,
  restore: restore,
  merge: merge,
  emailOwner: emailOwner,
  domainOwner: domainOwner,
};
