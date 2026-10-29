/// <reference path="../pb_data/types.d.ts" />
/**
 * CSV import and export.
 *
 * Import maps columns to fields from their headers (editable), then
 * previews what each row does: create a record, update a matching one
 * (people by email, companies by domain or exact name; only empty fields
 * are filled unless overwrite is on), skip it (nothing to identify it) or
 * stop on an ambiguous match. Applying it is one change in the activity
 * log, so the whole import is undone at once. Values from an import count
 * as the person's: the AI agent proposes changes to them.
 */

const SYN = {
  people: {
    name: ['name', 'full name', 'contact', 'contact name', 'person'],
    first_name: ['first name', 'first', 'given name', 'firstname', 'forename'],
    last_name: ['last name', 'last', 'surname', 'family name', 'lastname'],
    emails: ['email', 'e-mail', 'email address', 'work email', 'mail', 'emails', 'primary email'],
    phones: ['phone', 'phone number', 'mobile', 'tel', 'telephone', 'phones', 'cell'],
    title: ['title', 'job title', 'position', 'role', 'job'],
    company: ['company', 'organization', 'organisation', 'company name', 'account', 'employer', 'company domain'],
    linkedin: ['linkedin', 'linkedin url', 'linkedin profile', 'linkedin link'],
    location: ['location', 'city', 'address', 'country', 'region'],
    birthday: ['birthday', 'birth date', 'date of birth', 'dob'],
    how_met: ['how we met', 'how met', 'how you know them', 'met at', 'context'],
    source: ['source', 'lead source', 'origin', 'channel'],
    tags: ['tags', 'labels', 'tag', 'label'],
    note: ['notes', 'note', 'comments', 'comment'],
  },
  companies: {
    name: ['name', 'company', 'company name', 'organization', 'organisation', 'account'],
    domains: ['domain', 'website', 'url', 'company website', 'web', 'site', 'domains'],
    industry: ['industry', 'sector', 'vertical'],
    size: ['size', 'employees', 'company size', 'headcount', 'employee count'],
    location: ['location', 'city', 'country', 'hq', 'headquarters', 'address'],
    description: ['description', 'about', 'summary'],
    linkedin: ['linkedin', 'linkedin url', 'linkedin page'],
    source: ['source', 'origin', 'channel'],
    tags: ['tags', 'labels', 'tag'],
    note: ['notes', 'note', 'comments'],
  },
  deals: {
    name: ['name', 'deal', 'deal name', 'opportunity', 'title'],
    pipeline: ['pipeline'],
    stage: ['stage', 'deal stage', 'status'],
    value: ['value', 'amount', 'deal value', 'size', 'deal size', 'price'],
    currency: ['currency', 'ccy'],
    expected_close: ['expected close', 'close date', 'expected close date', 'closing date'],
    company: ['company', 'organization', 'account', 'company name'],
    person: ['contact', 'contact email', 'email', 'person', 'primary contact'],
    source: ['source', 'lead source'],
    next_step: ['next step', 'next action'],
    tags: ['tags', 'labels'],
    note: ['notes', 'note', 'comments'],
  },
};

function U() {
  return require(`${__hooks}/lib_util.js`);
}

/** RFC 4180 CSV (also ; or tab separated, detected from the header). */
function parse(text) {
  const t = String(text || '').replace(/^﻿/, '');
  const first = t.split(/\r?\n/)[0] || '';
  const sep = (first.match(/\t/g) || []).length > (first.match(/,/g) || []).length ? '\t' : (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t.charAt(i);
    if (q) {
      if (ch === '"') {
        if (t.charAt(i + 1) === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') q = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t.charAt(i + 1) === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

function autoMap(app, object, headers) {
  const syn = SYN[object];
  const custom = require(`${__hooks}/lib_records.js`).customDefs(app, object);
  const used = {};
  return headers.map((h) => {
    const k = String(h || '')
      .trim()
      .toLowerCase()
      .replace(/[_\-]+/g, ' ');
    for (const f of Object.keys(syn)) {
      if (!used[f] && syn[f].indexOf(k) >= 0) {
        used[f] = true;
        return f;
      }
    }
    const c = custom.find((d) => d.label.toLowerCase() === k || d.ckey === k.replace(/\s+/g, '_'));
    if (c && !used[c.key]) {
      used[c.key] = true;
      return c.key;
    }
    return '';
  });
}

function rowValues(cells, mapping) {
  const v = {};
  mapping.forEach((f, i) => {
    if (!f) return;
    const cell = String(cells[i] === undefined ? '' : cells[i]).trim();
    if (cell === '') return;
    if (f === 'emails' || f === 'phones' || f === 'tags' || f === 'domains') v[f] = (v[f] ? v[f] + ',' : '') + cell;
    else v[f] = cell;
  });
  return v;
}

/** Which existing record a row matches: { rec } | { ambiguous: [...] } | {}. */
function match(app, object, v) {
  const recs = require(`${__hooks}/lib_records.js`);
  const norm = require(`${__hooks}/lib_norm.js`);
  if (object === 'people') {
    const found = {};
    for (const e of recs.listOf(v.emails)) {
      const n = norm.email(e);
      if (!norm.validEmail(n)) continue;
      const o = recs.emailOwner(app, n, '');
      if (o && o.getString('deleted') === '') found[o.id] = o;
    }
    const ids = Object.keys(found);
    if (ids.length === 1) return { rec: found[ids[0]] };
    if (ids.length > 1) return { ambiguous: ids.map((id) => recs.personName(found[id])) };
    return {};
  }
  if (object === 'companies') {
    for (const d of recs.listOf(v.domains)) {
      const n = norm.domain(d);
      if (n === '') continue;
      const o = recs.domainOwner(app, n, '');
      if (o && o.getString('deleted') === '') return { rec: o };
    }
    if (v.name) {
      const key = norm.companyKey(v.name);
      const hits = app.findRecordsByFilter('companies', "deleted = ''", '', 0, 0).filter((c) => norm.companyKey(c.getString('name')) === key);
      if (hits.length === 1) return { rec: hits[0] };
      if (hits.length > 1) return { ambiguous: hits.map((c) => c.getString('name')) };
    }
    return {};
  }
  return {};
}

/** What applying would do, without writing. */
function preview(app, object, text, mapping) {
  const rows = parse(text);
  if (rows.length < 2) throw U().fail(400, 'The file needs a header row and at least one row');
  if (rows.length > 5001) throw U().fail(400, 'Import at most 5,000 rows at a time');
  const headers = rows[0].map((h) => String(h).trim());
  const map = mapping && mapping.length === headers.length ? mapping : autoMap(app, object, headers);
  const counts = { create: 0, update: 0, skip: 0, conflict: 0 };
  const sample = [];
  for (let i = 1; i < rows.length; i++) {
    const v = rowValues(rows[i], map);
    let action = 'create';
    let note = '';
    if (object === 'people' && !v.name && !v.first_name && !v.last_name && !v.emails) {
      action = 'skip';
      note = 'No name or email';
    } else if (object !== 'people' && !v.name && !(object === 'companies' && v.domains)) {
      action = 'skip';
      note = 'No name';
    } else {
      const m = match(app, object, v);
      if (m.ambiguous) {
        action = 'conflict';
        note = 'Matches ' + m.ambiguous.join(', ');
      } else if (m.rec) {
        action = 'update';
        note = require(`${__hooks}/lib_records.js`).nameOf(object, m.rec);
      }
    }
    counts[action]++;
    if (sample.length < 50) sample.push({ row: i, action: action, note: note, values: v });
  }
  return { headers: headers, mapping: map, fields: Object.keys(SYN[object]).concat(require(`${__hooks}/lib_records.js`).customDefs(app, object).map((d) => d.key)), rows: rows.length - 1, counts: counts, sample: sample };
}

/** Apply an import (inside lib_activity.run). who: the importer as written into provenance. */
function apply(t, object, text, mapping, opts) {
  const u = U();
  const recs = require(`${__hooks}/lib_records.js`);
  const deals = require(`${__hooks}/lib_deals.js`);
  const work = require(`${__hooks}/lib_work.js`);
  const who = { actor: 'import', run: '' };
  const pv = preview(t, object, text, mapping);
  const rows = parse(text);
  const map = pv.mapping;
  const out = { created: 0, updated: 0, skipped: 0, errors: [] };
  const ids = [];
  for (let i = 1; i < rows.length; i++) {
    const v = rowValues(rows[i], map);
    const note = v.note;
    delete v.note;
    try {
      let rec = null;
      if (object === 'deals') {
        if (!v.name) {
          out.skipped++;
          continue;
        }
        const p = Object.assign({}, v);
        if (p.person) {
          p.people = [p.person];
          delete p.person;
        }
        rec = deals.create(t, who, p, { source: 'import' });
        out.created++;
      } else {
        const m = match(t, object, v);
        if (m.ambiguous) {
          out.skipped++;
          out.errors.push({ row: i, error: 'Matches ' + m.ambiguous.join(', ') });
          continue;
        }
        if (object === 'people' && !v.name && !v.first_name && !v.last_name && !v.emails) {
          out.skipped++;
          continue;
        }
        if (object === 'companies' && !v.name && !v.domains) {
          out.skipped++;
          continue;
        }
        if (m.rec) {
          rec = m.rec;
          const vals = Object.assign({}, v);
          if (object === 'people' && vals.name) {
            const parts = require(`${__hooks}/lib_norm.js`).splitName(vals.name);
            vals.first_name = vals.first_name || parts[0];
            vals.last_name = vals.last_name || parts[1];
            delete vals.name;
          }
          const defs = recs.fieldMap(t, object);
          const fill = {};
          for (const k of Object.keys(vals)) {
            const def = defs[k];
            if (!def) continue;
            const cur = recs.get(rec, def);
            if (['emails', 'phones', 'tags', 'domains'].indexOf(def.type) >= 0) fill[k] = (cur || []).concat(recs.listOf(vals[k]));
            else if (opts.overwrite || recs.isEmpty(def, cur)) fill[k] = vals[k];
          }
          recs.update(t, who, object, rec, fill, { source: 'import' });
          out.updated++;
        } else {
          rec = object === 'people' ? recs.createPerson(t, who, v, { source: 'import' }, {}) : recs.createCompany(t, who, v, { source: 'import' });
          out.created++;
        }
      }
      if (rec && opts.list) {
        const f = object === 'companies' ? 'company' : 'person';
        if (!u.findOne(t, 'list_entries', 'list = {:l} && ' + f + ' = {:r}', { l: opts.list, r: rec.id })) {
          const le = new Record(t.findCollectionByNameOrId('list_entries'));
          le.set('list', opts.list);
          le.set(f, rec.id);
          t.save(le);
        }
      }
      if (rec && note) work.createNote(t, { actor: 'import', run: '' }, { [object === 'people' ? 'person' : object === 'companies' ? 'company' : 'deal']: rec.id, body: note });
      if (rec) ids.push(rec.id);
    } catch (err) {
      if (!err || !err.status) throw err;
      out.skipped++;
      out.errors.push({ row: i, error: String(err.message || err) });
    }
  }
  out.errors = out.errors.slice(0, 50);
  out.ids = ids.slice(0, 5000);
  return out;
}

function csvCell(v) {
  const s = Array.isArray(v) ? v.join(', ') : v === null || v === undefined ? '' : String(v);
  return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** Rows as CSV with the given columns ([{key,label}]). */
function toCsv(rows, columns) {
  const lines = [columns.map((c) => csvCell(c.label)).join(',')];
  for (const r of rows) {
    lines.push(
      columns
        .map((c) => {
          if (c.key.indexOf('custom.') === 0) return csvCell(r.custom ? r.custom[c.key.slice(7)] : '');
          return csvCell(r[c.key]);
        })
        .join(','),
    );
  }
  return lines.join('\n') + '\n';
}

module.exports = { SYN: SYN, parse: parse, autoMap: autoMap, preview: preview, apply: apply, toCsv: toCsv };
