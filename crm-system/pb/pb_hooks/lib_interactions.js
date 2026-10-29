/// <reference path="../pb_data/types.d.ts" />
/**
 * Interactions (emails, calls, meetings, messages) and what they drive:
 * last interaction, relationship strength and the next keep-in-touch date
 * on people and companies, and the last activity of a deal (which resets
 * its rotting clock).
 *
 * Strength (0-100) weighs recency and frequency: each interaction in the
 * last year adds its weight (meeting 3, call 2, email received 1.5, email
 * sent or message 1) halved every 60 days, and the sum s maps to
 * 100 x (1 - e^(-s/3)). 60+ is strong, 30-59 good, below 30 weak.
 * Synced items carry an ext_id, so the same email logged twice is one.
 */

const WEIGHT = { meeting: 3, call: 2, email_in: 1.5, email_out: 1, email: 1, message: 1 };
const HALF_LIFE_DAYS = 60;

function U() {
  return require(`${__hooks}/lib_util.js`);
}

function weight(kind, direction) {
  if (kind === 'email') return direction === 'in' ? WEIGHT.email_in : WEIGHT.email_out;
  return WEIGHT[kind] || 1;
}

function strengthOf(rows, now) {
  let s = 0;
  for (const r of rows) {
    const t = Date.parse(String(r.at).replace(' ', 'T'));
    if (!isFinite(t)) continue;
    const age = Math.max(0, (now - t) / 86400000);
    if (age > 365) continue;
    s += weight(r.kind, r.direction) * Math.pow(0.5, age / HALF_LIFE_DAYS);
  }
  return Math.round(100 * (1 - Math.exp(-s / 3)));
}

function band(strength) {
  return strength >= 60 ? 'strong' : strength >= 30 ? 'good' : strength > 0 ? 'weak' : 'none';
}

function rowsFor(app, filter, prm) {
  return app.findRecordsByFilter('interactions', filter, '-at', 600, 0, prm).map((r) => ({ at: r.getString('at'), kind: r.getString('kind'), direction: r.getString('direction') }));
}

/** Recompute a person's last interaction, touches, strength and next keep-in-touch date. */
function recomputePerson(app, id, now) {
  const recs = require(`${__hooks}/lib_records.js`);
  const p = U().byId(app, 'people', id);
  if (!p) return null;
  const t = now || Date.now();
  const rows = rowsFor(app, 'people ~ {:id}', { id: id });
  const yearAgo = new Date(t - 365 * 86400000).toISOString();
  const last = rows.length > 0 ? rows[0].at : '';
  const touches = rows.filter((r) => String(r.at) >= yearAgo).length;
  const strength = strengthOf(rows, t);
  const before = [p.getString('last_interaction'), p.getInt('touches'), p.getInt('strength'), p.getString('next_touch')].join('|');
  p.set('last_interaction', last);
  p.set('touches', touches);
  p.set('strength', strength);
  recs.refreshNextTouch(p);
  const after = [p.getString('last_interaction'), p.getInt('touches'), p.getInt('strength'), p.getString('next_touch')].join('|');
  if (before !== after) app.save(p);
  return p;
}

/** A company: the latest of its own and its people's interactions; strength the best of them. */
function recomputeCompany(app, id, now) {
  const c = U().byId(app, 'companies', id);
  if (!c) return null;
  const t = now || Date.now();
  const own = rowsFor(app, 'company = {:id}', { id: id });
  let last = own.length > 0 ? own[0].at : '';
  let strength = strengthOf(own, t);
  for (const p of app.findRecordsByFilter('people', "company = {:id} && deleted = ''", '', 0, 0, { id: id })) {
    if (p.getString('last_interaction') > last) last = p.getString('last_interaction');
    if (p.getInt('strength') > strength) strength = p.getInt('strength');
  }
  if (c.getString('last_interaction') !== last || c.getInt('strength') !== strength) {
    c.set('last_interaction', last);
    c.set('strength', strength);
    app.save(c);
  }
  return c;
}

function touchDeal(app, dealId, at) {
  if (!dealId) return;
  const d = U().byId(app, 'deals', dealId);
  if (!d) return;
  const when = at || new Date().toISOString();
  if (when > d.getString('last_activity')) {
    d.set('last_activity', when);
    app.save(d);
  }
}

/** Everything an interaction touches, recomputed. */
function refresh(app, peopleIds, companyId, dealId, at) {
  const companies = {};
  if (companyId) companies[companyId] = true;
  for (const pid of peopleIds) {
    const p = recomputePerson(app, pid);
    if (p && p.getString('company')) companies[p.getString('company')] = true;
  }
  for (const cid of Object.keys(companies)) recomputeCompany(app, cid);
  touchDeal(app, dealId, at);
}

function parseAt(raw) {
  const s = String(raw || '').trim();
  if (s === '' || s === 'now') return new Date().toISOString();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s + 'T12:00:00.000Z';
  const t = Date.parse(s.replace(' ', 'T'));
  if (!isFinite(t)) throw U().fail(400, 'at must be an ISO date-time like 2026-10-29T14:30:00Z or a date YYYY-MM-DD');
  return new Date(t).toISOString();
}

/**
 * Log an interaction. params: kind, direction, at, subject, summary,
 * people (ids or emails; unknown emails become people unless
 * create_people=false), company, deal, source, ext_id.
 * Returns { interaction, created, review } (review: queue it for the
 * agent's meeting review).
 */
function log(app, who, p) {
  const u = U();
  const recs = require(`${__hooks}/lib_records.js`);
  const norm = require(`${__hooks}/lib_norm.js`);
  const kind = u.oneOf(p, 'kind', ['email', 'call', 'meeting', 'message'], '');
  if (kind === '') throw u.fail(400, 'kind is required: email, call, meeting or message');
  const extId = u.str(p, 'ext_id', '').slice(0, 200);
  if (extId !== '') {
    const ex = u.findOne(app, 'interactions', 'ext_id = {:x}', { x: extId });
    if (ex) return { interaction: ex, created: false, review: false };
  }
  const peopleIds = [];
  const createPeople = u.bool(p, 'create_people', true);
  for (const ref of recs.listOf(u.has(p, 'people') ? u.list(p, 'people', true) : [])) {
    const r = String(ref || '').trim();
    if (r === '') continue;
    let person = null;
    try {
      person = recs.resolve(app, 'people', r);
    } catch (err) {
      if (err && err.status === 404 && r.indexOf('@') > 0 && createPeople) person = recs.createPerson(app, who, { emails: [norm.email(r)] }, { source: 'interaction' }, {});
      else throw err;
    }
    if (peopleIds.indexOf(person.id) < 0) peopleIds.push(person.id);
  }
  if (u.has(p, 'person')) {
    const person = recs.resolve(app, 'people', u.str(p, 'person', ''));
    if (peopleIds.indexOf(person.id) < 0) peopleIds.push(person.id);
  }
  let companyId = '';
  if (u.str(p, 'company', '') !== '') companyId = recs.resolve(app, 'companies', u.str(p, 'company', '')).id;
  let dealId = '';
  if (u.str(p, 'deal', '') !== '') {
    const d = recs.resolve(app, 'deals', u.str(p, 'deal', ''));
    dealId = d.id;
    if (companyId === '' && d.getString('company')) companyId = d.getString('company');
  }
  if (peopleIds.length === 0 && companyId === '' && dealId === '') throw u.fail(400, 'Say who it was with: people (ids or emails), a company or a deal');
  if (companyId === '' && peopleIds.length > 0) {
    const first = u.byId(app, 'people', peopleIds[0]);
    if (first && first.getString('company')) companyId = first.getString('company');
  }
  const rec = new Record(app.findCollectionByNameOrId('interactions'));
  const at = parseAt(u.str(p, 'at', ''));
  rec.set('kind', kind);
  rec.set('direction', kind === 'email' || kind === 'message' ? u.oneOf(p, 'direction', ['in', 'out'], 'out') : u.oneOf(p, 'direction', ['in', 'out'], ''));
  rec.set('at', at);
  rec.set('subject', u.squash(u.str(p, 'subject', '')).slice(0, 200));
  rec.set('summary', u.text(p, 'summary', '').slice(0, 8000));
  rec.set('people', peopleIds);
  rec.set('company', companyId);
  rec.set('deal', dealId);
  rec.set('source', u.str(p, 'source', who.actor === 'agent' ? 'AI agent' : '').slice(0, 40));
  rec.set('ext_id', extId);
  rec.set('by', who.actor);
  rec.set('run', who.run || '');
  // A meeting or call with notes goes to the AI agent's meeting review.
  const setup = require(`${__hooks}/lib_setup.js`);
  const pol = setup.policy(setup.row(app));
  const review = who.actor !== 'agent' && pol.meeting_review && (kind === 'meeting' || kind === 'call') && rec.getString('summary').length >= 40 && u.bool(p, 'review', true);
  if (review) rec.set('agent_state', 'waiting');
  app.save(rec);
  refresh(app, peopleIds, companyId, dealId, at);
  return { interaction: rec, created: true, review: review };
}

function remove(app, rec) {
  const ids = rec.getStringSlice('people');
  const c = rec.getString('company');
  const d = rec.getString('deal');
  app.delete(rec);
  refresh(app, ids, c, '', '');
  if (d) {
    // The deal's last activity stays: the rotting clock only moves forward.
  }
}

function serialize(app, rec, names) {
  const u = U();
  const ids = rec.getStringSlice('people');
  const nm = names || {};
  const personName = (id) => {
    if (nm[id] !== undefined) return nm[id];
    const p = u.byId(app, 'people', id);
    return p ? require(`${__hooks}/lib_records.js`).personName(p) : '';
  };
  const cName = (id) => {
    if (!id) return '';
    const c = u.byId(app, 'companies', id);
    return c ? c.getString('name') : '';
  };
  const dName = (id) => {
    if (!id) return '';
    const d = u.byId(app, 'deals', id);
    return d ? d.getString('name') : '';
  };
  return {
    id: rec.id,
    kind: rec.getString('kind'),
    direction: rec.getString('direction'),
    at: rec.getString('at'),
    subject: rec.getString('subject'),
    summary: rec.getString('summary'),
    people: ids.map((id) => ({ id: id, name: personName(id) })),
    company: rec.getString('company') ? { id: rec.getString('company'), name: cName(rec.getString('company')) } : null,
    deal: rec.getString('deal') ? { id: rec.getString('deal'), name: dName(rec.getString('deal')) } : null,
    source: rec.getString('source'),
    ext_id: rec.getString('ext_id'),
    by: rec.getString('by'),
    run: rec.getString('run'),
    agent_state: rec.getString('agent_state'),
    agent_note: rec.getString('agent_note'),
    created: rec.getString('created'),
  };
}

/** Nightly: strength decays with time even without new interactions. */
function recomputeAll(app) {
  const now = Date.now();
  let n = 0;
  for (const p of app.findRecordsByFilter('people', "deleted = ''", '', 0, 0)) {
    recomputePerson(app, p.id, now);
    n++;
  }
  for (const c of app.findRecordsByFilter('companies', "deleted = ''", '', 0, 0)) recomputeCompany(app, c.id, now);
  return n;
}

module.exports = { WEIGHT: WEIGHT, strengthOf: strengthOf, band: band, recomputePerson: recomputePerson, recomputeCompany: recomputeCompany, touchDeal: touchDeal, refresh: refresh, parseAt: parseAt, log: log, remove: remove, serialize: serialize, recomputeAll: recomputeAll };
