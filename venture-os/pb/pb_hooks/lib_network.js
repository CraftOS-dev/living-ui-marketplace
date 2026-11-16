/// <reference path="../pb_data/types.d.ts" />
/**
 * Network (SPEC 7.5): who knows whom, how well, and the warmest way in.
 *
 * Strength comes from the strength engine (lib_eng_strength): every
 * captured touch (interactions) of a member with a person adds its weight,
 * halved every 60 days. strengths keeps three kinds of rows: `edge` (one
 * member, one person), `person` (the person's best edge) and `company` (the
 * best edge to anyone who works there now). They are recomputed nightly
 * and for the touched people after every capture or logged touch.
 *
 * Paths come from the paths engine (lib_eng_paths): direct paths (a member
 * who knows the target) before one-hop paths (a member who knows a person
 * the firm has seen in the same thread or meeting as the target), each
 * scored by its weakest edge. Person-to-person ties are scored by the same
 * strength engine over the touches both people shared (a shared email
 * counts as a message: its direction between them is unknown).
 *
 * Contracts (SPEC 4.6):
 *   strengthOf(app, personId) -> { score, last_at, best_member }
 *   paths(ctx, { company | person }) -> [{ path: [{ member } | { person }], weakest, last_at, ... }]
 *   upcoming(ctx, { from_at, to_at }) -> [{ cal_event, start_at, attendees, company, deal, ... }]
 *
 * The firm's own people: members (by email) and the firm's domains (the
 * members' work domains plus capture_state's firm domains). Everyone else
 * on a thread or an invite is external.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}

const BANDS = ['strong', 'good', 'weak', 'none'];
const DAY_MS = 86400000;
const WINDOW_DAYS = 365;

/* ------------------------------------------------------------ the firm */

/** The firm row of capture_state (config: capture_address, capture_account, firm_domains, exclude_domains). */
function firmRow(app) {
  return u().findOne(app, 'capture_state', "kind = 'firm'", {});
}

function firmConfig(app) {
  const r = firmRow(app);
  const c = r === null ? {} : u().jsonOf(r, 'config', {}) || {};
  return {
    capture_address: String(c.capture_address || ''),
    capture_account: String(c.capture_account || ''),
    firm_domains: Array.isArray(c.firm_domains) ? c.firm_domains.map(String) : [],
    exclude_domains: Array.isArray(c.exclude_domains) ? c.exclude_domains.map(String) : [],
  };
}

/** Active and other members: [{ id, name, email, status, role }]. */
function members(app) {
  return u().rows(app, "SELECT m.id AS id, m.name AS name, LOWER(m.email) AS email, m.status AS status, COALESCE(r.code, '') AS role FROM members m LEFT JOIN roles r ON r.id = m.role ORDER BY m.created", { id: '', name: '', email: '', status: '', role: '' });
}

/** The member whose Google account CraftBot holds: the first active owner. */
function ownerMember(app) {
  const all = members(app).filter((m) => m.status === 'active' && m.role === 'owner');
  return all.length > 0 ? all[0] : null;
}

/** Per-member capture consent: { memberId: { consent, exclude: [domains] } }. */
function consents(app) {
  const out = {};
  for (const r of u().findMany(app, 'capture_state', "kind = 'member'", '', 0)) out[r.getString('who')] = { consent: r.getBool('consent'), exclude: (u().jsonOf(r, 'exclude_domains', []) || []).map(String) };
  return out;
}

function domainOf(email) {
  const e = String(email || '').toLowerCase();
  const i = e.lastIndexOf('@');
  return i > 0 ? e.slice(i + 1) : '';
}

/** Does a domain (or its parent domains) appear in the list? */
function domainIn(domain, list) {
  const d = String(domain || '').toLowerCase();
  if (d === '') return false;
  for (const x of list) {
    const y = String(x || '').toLowerCase();
    if (y !== '' && (d === y || d.slice(-(y.length + 1)) === '.' + y)) return true;
  }
  return false;
}

/**
 * Everything capture needs to sort addresses, read once per run:
 * { byEmail: { email: member }, firmDomains, exclude, consent, owner }.
 */
function firmView(app) {
  const n = L('lib_norm');
  const cfg = firmConfig(app);
  const all = members(app);
  const byEmail = {};
  const domains = cfg.firm_domains.map((d) => d.toLowerCase());
  for (const m of all) {
    if (m.email === '') continue;
    byEmail[m.email] = m;
    const wd = n.workDomain(m.email);
    if (wd !== '' && domains.indexOf(wd) < 0) domains.push(wd);
  }
  return { byEmail: byEmail, firmDomains: domains, exclude: cfg.exclude_domains.map((d) => d.toLowerCase()), consent: consents(app), owner: ownerMember(app), config: cfg };
}

/** Is this address outside the firm (not a member, not a firm domain)? */
function external(fv, email) {
  const e = String(email || '').toLowerCase();
  if (e === '' || e.indexOf('@') < 1) return false;
  if (fv.byEmail[e] !== undefined) return false;
  return !domainIn(domainOf(e), fv.firmDomains);
}

/** Is this address excluded from capture for this member (firm-wide or the member's own list)? */
function excluded(fv, memberId, email) {
  const d = domainOf(email);
  if (domainIn(d, fv.exclude)) return true;
  const c = fv.consent[memberId];
  return c !== undefined && domainIn(d, c.exclude);
}

function consented(fv, memberId) {
  const c = fv.consent[memberId];
  return c !== undefined && c.consent === true;
}

/* ------------------------------------------------------------- records */

/**
 * The person for an address: the existing record (never changed by
 * capture), or a new one (origin capture) when `create`. '' when none.
 */
function personFor(ctx, email, name, create) {
  const recs = L('lib_records');
  const e = String(email || '').toLowerCase();
  if (e === '') return '';
  try {
    const r = recs.resolve(ctx.app, 'people', e);
    if (r.getString('deleted_at') !== '') return '';
    return r.id;
  } catch (err) {
    if (u().statusOf(err) !== 404 || !create) return '';
  }
  const o = { email: e, origin: 'capture', source_ref: 'email header' };
  const nm = u().squash(String(name || ''));
  if (nm !== '' && nm.toLowerCase() !== e && nm.indexOf('@') < 0) o.name = u().clip(nm, 160);
  const v = recs.upsertPerson(ctx, o);
  return v.id;
}

/** A person's company id ('' when none). */
function companyOfPerson(app, personId) {
  const p = u().byId(app, 'people', personId);
  return p === null ? '' : p.getString('company');
}

/** The open (or held) deal of a company, most recent first ('' when none). */
function dealOfCompany(app, companyId) {
  if (!companyId) return '';
  const r = u().one(app, "SELECT id FROM deals WHERE company = {:c} AND deleted_at = '' AND status IN ('open', 'hold', 'invested') ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'hold' THEN 1 ELSE 2 END, updated DESC LIMIT 1", { id: '' }, { c: companyId });
  return r === null ? '' : r.id;
}

/** Current people of a company (employments current, or people.company). */
function peopleOfCompany(app, companyId) {
  const ids = {};
  for (const r of u().rows(app, "SELECT e.person AS id FROM employments e JOIN people p ON p.id = e.person WHERE e.company = {:c} AND e.current = TRUE AND p.deleted_at = '' AND p.merged_into = ''", { id: '' }, { c: companyId })) ids[r.id] = true;
  for (const r of u().rows(app, "SELECT id FROM people WHERE company = {:c} AND deleted_at = '' AND merged_into = ''", { id: '' }, { c: companyId })) ids[r.id] = true;
  return Object.keys(ids);
}

/** Companies a set of people work at now. */
function companiesOfPeople(app, personIds) {
  const out = {};
  if (personIds.length === 0) return [];
  for (const chunk of chunks(personIds, 300)) {
    const bind = {};
    const ph = chunk.map((id, i) => {
      bind['p' + i] = id;
      return '{:p' + i + '}';
    });
    for (const r of u().rows(app, "SELECT company AS id FROM people WHERE company != '' AND id IN (" + ph.join(',') + ')', { id: '' }, bind)) out[r.id] = true;
    for (const r of u().rows(app, 'SELECT company AS id FROM employments WHERE current = TRUE AND person IN (' + ph.join(',') + ')', { id: '' }, bind)) out[r.id] = true;
  }
  return Object.keys(out);
}

function chunks(list, n) {
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

function inList(ids, prefix, bind) {
  return ids
    .map((id, i) => {
      bind[prefix + i] = id;
      return '{:' + prefix + i + '}';
    })
    .join(',');
}

function parseIds(raw) {
  if (Array.isArray(raw)) return raw.map(String);
  try {
    const v = JSON.parse(String(raw || '[]'));
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------ strength */

/**
 * Recompute strengths. personIds: only those people (and their companies);
 * null: everyone (the nightly run; rows nobody touched in a year go away).
 * Answers { edges, people, companies }.
 */
function recompute(app, personIds) {
  const util = u();
  const E = L('lib_eng_strength');
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const since = new Date(now - WINDOW_DAYS * DAY_MS).toISOString();
  const only = personIds === null ? null : personIds.filter((x) => x);
  if (only !== null && only.length === 0) return { edges: 0, people: 0, companies: 0 };
  const want = {};
  if (only !== null) for (const id of only) want[id] = true;
  // Touches of active members in the window (with the people they touched).
  const touches = [];
  for (const r of touchRows(app, only, since)) {
    let people = parseIds(r.people);
    if (only !== null) people = people.filter((p) => want[p]);
    if (people.length === 0) continue;
    if (r.kind === 'email' && r.direction !== 'in' && r.direction !== 'out') continue;
    touches.push({ member: r.who, people: people, kind: r.kind, direction: r.kind === 'email' ? r.direction : undefined, at: r.at });
  }
  const edges = E.edges(touches, now);
  const touchedPeople = {};
  for (const e of edges) touchedPeople[e.person] = true;
  const peopleSet = only !== null ? only : Object.keys(touchedPeople);
  // Edges.
  const keep = {};
  for (const e of edges) {
    saveRow(app, { kind: 'edge', who: e.member, person: e.person, company: '' }, { score: e.score, band: e.band, s: e.s, counted: e.counted, last_at: e.last_at || '', computed_at: nowIso });
    keep['edge|' + e.member + '|' + e.person] = true;
  }
  // Each person's best edge.
  const byPerson = {};
  for (const e of edges) (byPerson[e.person] = byPerson[e.person] || []).push(e);
  for (const pid of peopleSet) {
    const b = E.best(byPerson[pid] || []);
    if (b.score > 0) {
      saveRow(app, { kind: 'person', who: '', person: pid, company: '' }, { score: b.score, band: b.band, best: b.member || '', s: 0, counted: (byPerson[pid] || []).length, last_at: b.last_at || '', computed_at: nowIso });
      keep['person|' + pid] = true;
    }
  }
  // Companies of these people: the best edge to anyone who works there now.
  const companies = only !== null ? companiesOfPeople(app, peopleSet) : null;
  const companyRows = companyStrengths(app, companies, nowIso);
  // Remove what no longer holds.
  if (only === null) {
    util.exec(app, 'DELETE FROM strengths WHERE computed_at < {:t}', { t: nowIso });
    L('lib_bus').touch('strengths');
  } else {
    for (const chunk of chunks(only, 300)) {
      const b2 = { t: nowIso };
      const ph = inList(chunk, 'p', b2);
      util.exec(app, "DELETE FROM strengths WHERE kind IN ('edge', 'person') AND person IN (" + ph + ') AND computed_at < {:t}', b2);
      L('lib_bus').touch('strengths');
    }
  }
  return { edges: edges.length, people: Object.keys(byPerson).length, companies: companyRows };
}

/** Company strength rows (companyIds null: every company with a known person). Answers the row count. */
function companyStrengths(app, companyIds, nowIso) {
  const util = u();
  const E = L('lib_eng_strength');
  const bind = {};
  let where = '';
  if (companyIds !== null) {
    if (companyIds.length === 0) return 0;
    where = ' AND c.id IN (' + inList(companyIds, 'c', bind) + ')';
  }
  // Edges to people who work at the company now (employment or people.company).
  const rows = util.rows(
    app,
    "SELECT c.id AS company, s.who AS who, s.person AS person, s.score AS score, s.last_at AS last_at FROM companies c JOIN people p ON (p.company = c.id OR p.id IN (SELECT e.person FROM employments e WHERE e.company = c.id AND e.current = TRUE)) JOIN strengths s ON s.kind = 'edge' AND s.person = p.id WHERE c.deleted_at = '' AND p.deleted_at = ''" + where,
    { company: '', who: '', person: '', score: 0, last_at: '' },
    bind,
  );
  const byCompany = {};
  for (const r of rows) (byCompany[r.company] = byCompany[r.company] || []).push({ member: r.who, person: r.person, score: r.score, last_at: r.last_at === '' ? null : r.last_at });
  let n = 0;
  const ids = companyIds !== null ? companyIds : Object.keys(byCompany);
  for (const cid of ids) {
    const list = byCompany[cid] || [];
    const b = E.best(list);
    const known = {};
    for (const e of list) if (e.score > 0) known[e.person] = true;
    if (b.score > 0) {
      saveRow(app, { kind: 'company', who: '', person: '', company: cid }, { score: b.score, band: b.band, best: b.member || '', best_person: b.person || '', s: 0, counted: list.length, people_known: Object.keys(known).length, last_at: b.last_at || '', computed_at: nowIso });
      n++;
    } else {
      util.exec(app, "DELETE FROM strengths WHERE kind = 'company' AND company = {:c}", { c: cid });
      L('lib_bus').touch('strengths');
    }
  }
  return n;
}

/** Upsert one strengths row by its key. For person and company rows `best` is the member and `best_person` the person. */
function saveRow(app, key, v) {
  const util = u();
  const who = key.kind === 'edge' ? key.who : v.best || '';
  const person = key.kind === 'company' ? v.best_person || '' : key.person;
  const found = util.one(app, 'SELECT id FROM strengths WHERE kind = {:k} AND ' + (key.kind === 'edge' ? 'who = {:w} AND person = {:p}' : key.kind === 'person' ? 'person = {:p}' : 'company = {:c}') + ' LIMIT 1', { id: '' }, { k: key.kind, w: key.who, p: key.person, c: key.company });
  const rec = found !== null ? app.findRecordById('strengths', found.id) : util.newRecord(app, 'strengths');
  rec.set('kind', key.kind);
  rec.set('who', who);
  rec.set('person', person);
  rec.set('company', key.company);
  rec.set('score', v.score);
  rec.set('band', v.band);
  rec.set('s', v.s || 0);
  rec.set('counted', v.counted || 0);
  rec.set('last_at', v.last_at || '');
  rec.set('people_known', v.people_known || 0);
  rec.set('computed_at', v.computed_at);
  app.save(rec);
}

/** Touch rows of active members since `since` (only those with one of `only` when given). */
function touchRows(app, only, since) {
  const bind = { s: since };
  let sql = "SELECT i.who AS who, i.kind AS kind, i.direction AS direction, i.at AS at, i.people AS people FROM interactions i JOIN members m ON m.id = i.who WHERE m.status = 'active' AND i.at >= {:s}";
  if (only !== null) {
    const parts = [];
    const cs = chunks(only, 300);
    for (let ci = 0; ci < cs.length; ci++) parts.push('EXISTS (SELECT 1 FROM json_each(i.people) j WHERE j.value IN (' + inList(cs[ci], 'q' + ci + '_', bind) + '))');
    sql += ' AND (' + parts.join(' OR ') + ')';
  }
  return u().rows(app, sql, { who: '', kind: '', direction: '', at: '', people: '' }, bind);
}

/**
 * Each person's strength computed now from the touches the handle sees
 * (inside an op: including the op's own writes), without saving:
 * { personId: { score, band, last_at, best_member } }.
 */
function scoresFor(app, personIds) {
  const E = L('lib_eng_strength');
  const now = Date.now();
  const want = {};
  for (const id of personIds) want[id] = true;
  const touches = [];
  for (const r of touchRows(app, personIds, new Date(now - WINDOW_DAYS * DAY_MS).toISOString())) {
    const people = parseIds(r.people).filter((p) => want[p]);
    if (people.length === 0 || (r.kind === 'email' && r.direction !== 'in' && r.direction !== 'out')) continue;
    touches.push({ member: r.who, people: people, kind: r.kind, direction: r.kind === 'email' ? r.direction : undefined, at: r.at });
  }
  const by = {};
  for (const e of E.edges(touches, now)) (by[e.person] = by[e.person] || []).push(e);
  const out = {};
  for (const id of personIds) {
    const b = E.best(by[id] || []);
    out[id] = { score: b.score, band: b.band, last_at: b.last_at, best_member: b.member };
  }
  return out;
}

const DIRTY = 'vo_network_dirty';

/** Remember people whose strength must be recomputed after the current op commits (the minute job does it). */
function markDirty(app, personIds) {
  let cur = [];
  try {
    cur = JSON.parse(String($app.store().get(DIRTY) || '[]')) || [];
  } catch {
    cur = [];
  }
  for (const id of personIds) if (id && cur.indexOf(id) < 0) cur.push(id);
  $app.store().set(DIRTY, JSON.stringify(cur.slice(-20000)));
}

/** The minute job: recompute the people marked since the last minute. */
function flushDirty(app) {
  const raw = app.store().get(DIRTY);
  if (!raw) return null;
  app.store().remove(DIRTY);
  let ids = [];
  try {
    ids = JSON.parse(String(raw)) || [];
  } catch {
    ids = [];
  }
  const live = ids.filter((id) => u().byId(app, 'people', id) !== null);
  const gone = ids.filter((id) => live.indexOf(id) < 0);
  for (const id of gone) u().exec(app, 'DELETE FROM strengths WHERE person = {:p}', { p: id });
  if (gone.length > 0) L('lib_bus').touch('strengths');
  return live.length > 0 ? recompute(app, live) : null;
}

/** Nightly (cron): everyone. */
function nightly(app) {
  return recompute(app, null);
}

/** SPEC 4.6: a person's strength { score, last_at, best_member }. */
function strengthOf(app, personId) {
  const r = u().one(app, "SELECT score, last_at, who FROM strengths WHERE kind = 'person' AND person = {:p} LIMIT 1", { score: 0, last_at: '', who: '' }, { p: String(personId || '') });
  if (r === null) return { score: 0, last_at: null, best_member: null };
  return { score: r.score, last_at: r.last_at === '' ? null : r.last_at, best_member: r.who === '' ? null : r.who };
}

/** A company's strength { score, band, last_at, best_member, best_person, people_known }. */
function companyStrengthOf(app, companyId) {
  const r = u().one(app, "SELECT score, band, last_at, who, person, people_known FROM strengths WHERE kind = 'company' AND company = {:c} LIMIT 1", { score: 0, band: '', last_at: '', who: '', person: '', people_known: 0 }, { c: String(companyId || '') });
  if (r === null) return { score: 0, band: 'none', last_at: null, best_member: null, best_person: null, people_known: 0 };
  return { score: r.score, band: r.band, last_at: r.last_at || null, best_member: r.who || null, best_person: r.person || null, people_known: r.people_known };
}

/* --------------------------------------------------------------- paths */

/** Person-to-person ties around the targets, scored by the strength engine over the touches they shared. */
function linksFor(app, targets, now) {
  const util = u();
  const E = L('lib_eng_strength');
  if (targets.length === 0) return [];
  const want = {};
  for (const t of targets) want[t] = true;
  const since = new Date(now - WINDOW_DAYS * DAY_MS).toISOString();
  const pairs = {};
  for (const chunk of chunks(targets, 300)) {
    const bind = { s: since };
    const ph = inList(chunk, 't', bind);
    for (const r of util.rows(app, 'SELECT i.kind AS kind, i.at AS at, i.people AS people FROM interactions i WHERE i.at >= {:s} AND json_array_length(i.people) > 1 AND EXISTS (SELECT 1 FROM json_each(i.people) j WHERE j.value IN (' + ph + '))', { kind: '', at: '', people: '' }, bind)) {
      const people = parseIds(r.people);
      const kind = r.kind === 'email' ? 'message' : r.kind;
      for (const t of people) {
        if (!want[t]) continue;
        for (const o of people) {
          if (o === t || want[o]) continue;
          const k = o + '|' + t;
          (pairs[k] = pairs[k] || []).push({ kind: kind, at: r.at });
        }
      }
    }
  }
  const out = [];
  for (const k of Object.keys(pairs)) {
    const s = E.score(pairs[k], now);
    if (s.score <= 0) continue;
    const parts = k.split('|');
    out.push({ a: parts[0], b: parts[1], score: s.score, last_at: s.last_at });
  }
  return out;
}

function memberNames(app) {
  const out = {};
  for (const m of members(app)) out[m.id] = { id: m.id, name: m.name, email: m.email, active: m.status === 'active' };
  return out;
}

function personMini(app, id, cache) {
  if (cache[id] !== undefined) return cache[id];
  const p = u().byId(app, 'people', id);
  if (p === null) {
    cache[id] = { id: id, name: 'Unknown', email: '', company: null, title: '' };
    return cache[id];
  }
  const c = p.getString('company') !== '' ? L('lib_records').mini(app, 'companies', p.getString('company')) : null;
  cache[id] = { id: id, name: L('lib_records').personName(p), email: p.getString('email'), title: p.getString('title'), company: c };
  return cache[id];
}

/**
 * SPEC 4.6: ranked paths to a person or a company's people.
 * -> [{ path: [{ member }, { person }...], weakest, last_at, kind, member, connector, target, edges, nodes }]
 */
function paths(ctx, target) {
  const app = ctx.app;
  const util = u();
  const now = Date.now();
  let targets = [];
  if (target && target.person) targets = [L('lib_records').resolve(app, 'people', target.person).id];
  else if (target && target.company) targets = peopleOfCompany(app, L('lib_records').resolve(app, 'companies', target.company).id);
  else throw util.fail(400, 'Give --company or --person.', 'missing_param');
  if (targets.length === 0) return [];
  const links = linksFor(app, targets, now);
  const people = {};
  for (const t of targets) people[t] = true;
  for (const l of links) people[l.a] = true;
  const mm = memberNames(app);
  const memberEdges = [];
  const ids = Object.keys(people);
  for (const chunk of chunks(ids, 300)) {
    const bind = {};
    const ph = inList(chunk, 'p', bind);
    for (const r of util.rows(app, "SELECT who, person, score, last_at FROM strengths WHERE kind = 'edge' AND person IN (" + ph + ')', { who: '', person: '', score: 0, last_at: '' }, bind)) {
      if (!mm[r.who] || !mm[r.who].active) continue;
      memberEdges.push({ member: r.who, person: r.person, score: r.score, last_at: r.last_at === '' ? null : r.last_at });
    }
  }
  // A member who knows the target directly needs no one-hop path to them: those are left out (fewer, better paths).
  const all = L('lib_eng_paths').rank({ targets: targets, member_edges: memberEdges, links: links, limit: 60 });
  const knows = {};
  for (const p of all) if (p.kind === 'direct') knows[p.member + '|' + p.target] = true;
  const ranked = all.filter((p) => p.kind === 'direct' || !knows[p.member + '|' + p.target]).slice(0, 20);
  const cache = {};
  const E = L('lib_eng_strength');
  return ranked.map((p) => {
    const nodes = p.path.map((n) => (n.member !== undefined ? Object.assign({ kind: 'member' }, mm[n.member] || { id: n.member, name: 'Member' }) : Object.assign({ kind: 'person' }, personMini(app, n.person, cache))));
    return {
      path: p.path,
      weakest: p.weakest,
      band: E.band(p.weakest),
      last_at: p.last_at,
      kind: p.kind,
      member: p.member,
      connector: p.connector,
      target: p.target,
      edges: p.edges.map((e) => ({ from: e.from, to: e.to, score: e.score, band: E.band(e.score), last_at: e.last_at })),
      nodes: nodes,
    };
  });
}

/* ------------------------------------------------------------ upcoming */

function eventAttendees(r) {
  return u().jsonOf(r, 'attendees', []) || [];
}

/** May ctx see this calendar event (an attendee, the owner, your AI agent, the app)? */
function seesEvent(ctx, r) {
  if (ctx.isAgent || ctx.owner || ctx.actor === 'system') return true;
  return eventAttendees(r).some((a) => a.member === ctx.memberId);
}

/**
 * Is this meeting on the caller's day: a person's own meetings they did
 * not decline (the owner's calendar holds the owner's); for your AI agent
 * and the app, meetings at least one member did not decline.
 */
function attends(ctx, r) {
  const atts = eventAttendees(r).filter((a) => a.member);
  if (ctx.isAgent || ctx.actor === 'system') return atts.some((a) => a.response !== 'declined');
  return atts.some((a) => a.member === ctx.memberId && a.response !== 'declined');
}

function dealMini(ctx, dealId) {
  if (!dealId) return { deal: null, hidden: false };
  const d = u().byId(ctx.app, 'deals', dealId);
  if (d === null || d.getString('deleted_at') !== '') return { deal: null, hidden: false };
  if (!L('lib_auth').dealVisible(ctx, d)) return { deal: null, hidden: true };
  const v = L('lib_deals').cardOut(ctx.app, d);
  return { deal: { id: d.id, number: v.number, stage: v.stage, stage_label: v.stage_label, status: v.status }, hidden: false };
}

/**
 * SPEC 4.6: external meetings between from_at and to_at that ctx attends
 * (everyone's for the owner and your AI agent), with the brief's state.
 */
function upcoming(ctx, o) {
  const app = ctx.app;
  const from = String((o && o.from_at) || new Date().toISOString());
  const to = String((o && o.to_at) || new Date(Date.now() + DAY_MS).toISOString());
  const rows = u().findMany(app, 'cal_events', "external = true && status != 'cancelled' && status != 'gone' && end_at >= {:a} && start_at <= {:b}", 'start_at', 200, { a: from, b: to });
  const W = L('lib_network_work');
  const out = [];
  for (const r of rows) {
    if (!attends(ctx, r)) continue;
    const dm = dealMini(ctx, r.getString('deal'));
    out.push({
      cal_event: r.id,
      title: r.getString('title'),
      start_at: r.getString('start_at'),
      end_at: r.getString('end_at'),
      location: r.getString('location'),
      meet: r.getString('meet'),
      attendees: eventAttendees(r).map((a) => ({ name: a.name, email: a.email, person: a.person || null, member: a.member || null, external: a.external === true, response: a.response || '' })),
      company: r.getString('company') !== '' ? L('lib_records').mini(app, 'companies', r.getString('company')) : null,
      deal: dm.deal,
      deal_hidden: dm.hidden,
      brief: W.briefState(app, r.id),
    });
  }
  return out;
}

/* --------------------------------------------------------------- reads */

function bandParam(p) {
  return u().oneOf(p, 'band', BANDS, '');
}

/** network.strength: a person's or a company's strength with every member's edge. */
function opStrength(ctx, p) {
  const app = ctx.app;
  const recs = L('lib_records');
  const mm = memberNames(app);
  const util = u();
  if (util.str(p, 'person', '') !== '') {
    const rec = recs.resolve(app, 'people', util.str(p, 'person', ''));
    const s = strengthOf(app, rec.id);
    const edges = util.rows(app, "SELECT who, score, band, last_at, counted FROM strengths WHERE kind = 'edge' AND person = {:p} ORDER BY score DESC", { who: '', score: 0, band: '', last_at: '', counted: 0 }, { p: rec.id });
    return { person: recs.mini(app, 'people', rec.id), score: s.score, band: L('lib_eng_strength').band(s.score), last_at: s.last_at, best_member: s.best_member ? mm[s.best_member] || null : null, members: edges.map((e) => ({ member: mm[e.who] || { id: e.who, name: 'Member' }, score: e.score, band: e.band, last_at: e.last_at || null, touches: e.counted })) };
  }
  if (util.str(p, 'company', '') !== '') {
    const rec = recs.resolve(app, 'companies', util.str(p, 'company', ''));
    const s = companyStrengthOf(app, rec.id);
    const ids = peopleOfCompany(app, rec.id);
    const people = [];
    for (const chunk of chunks(ids, 300)) {
      const bind = {};
      const ph = inList(chunk, 'p', bind);
      for (const r of util.rows(app, "SELECT person, who, score, band, last_at FROM strengths WHERE kind = 'person' AND person IN (" + ph + ')', { person: '', who: '', score: 0, band: '', last_at: '' }, bind)) people.push({ person: recs.mini(app, 'people', r.person), score: r.score, band: r.band, last_at: r.last_at || null, best_member: mm[r.who] || null });
    }
    people.sort((a, b) => b.score - a.score);
    return { company: recs.mini(app, 'companies', rec.id), score: s.score, band: s.band, last_at: s.last_at, best_member: s.best_member ? mm[s.best_member] || null : null, best_person: s.best_person ? recs.mini(app, 'people', s.best_person) : null, people_known: s.people_known, people_total: ids.length, people: people };
  }
  throw util.fail(400, 'Give --person or --company.', 'missing_param');
}

/** network.paths: ranked intro paths with names, and open intros to the target. */
function opPaths(ctx, p) {
  const util = u();
  const person = util.str(p, 'person', '');
  const company = util.str(p, 'company', '');
  if (person === '' && company === '') throw util.fail(400, 'Give --person or --company.', 'missing_param');
  const recs = L('lib_records');
  const target = person !== '' ? { kind: 'person', rec: recs.resolve(ctx.app, 'people', person) } : { kind: 'company', rec: recs.resolve(ctx.app, 'companies', company) };
  const list = paths(ctx, person !== '' ? { person: target.rec.id } : { company: target.rec.id });
  const intros = L('lib_network_work').introsFor(ctx, target.kind === 'person' ? { person: target.rec.id } : { company: target.rec.id });
  // Each path in a line of names (who knows whom, the weakest link, the last contact), for whoever reads it as text.
  for (const x of list) {
    const names = (x.nodes || []).map((n) => n.name || n.email || n.id);
    x.line = names.join(' knows ') + ' (' + (x.kind === 'direct' ? 'direct' : 'through a connector') + ', weakest link ' + x.weakest + (x.band ? ' ' + x.band : '') + (x.last_at ? ', last contact ' + String(x.last_at).slice(0, 10) : '') + ')';
  }
  return {
    target: target.kind === 'person' ? Object.assign({ kind: 'person' }, personMini(ctx.app, target.rec.id, {})) : Object.assign({ kind: 'company' }, recs.mini(ctx.app, 'companies', target.rec.id)),
    people_total: target.kind === 'company' ? peopleOfCompany(ctx.app, target.rec.id).length : 1,
    paths: list,
    intros: intros,
  };
}

/** network.find: the "Who knows" field: people and companies matching q, with their strength. */
function opFind(ctx, p) {
  const util = u();
  const q = util.squash(util.str(p, 'q', ''));
  const limit = util.int(p, 'limit', 8, 1, 20);
  if (q.length < 1) return { q: q, results: [] };
  const like = util.like(q);
  const out = [];
  for (const r of util.rows(
    ctx.app,
    "SELECT c.id AS id, c.name AS name, c.domain AS domain, COALESCE(s.score, 0) AS score, COALESCE(s.band, 'none') AS band FROM companies c LEFT JOIN strengths s ON s.kind = 'company' AND s.company = c.id WHERE c.deleted_at = '' AND c.merged_into = '' AND (c.name LIKE {:q} ESCAPE '\\' OR c.domain LIKE {:q} ESCAPE '\\' OR c.domains LIKE {:q} ESCAPE '\\') ORDER BY (LOWER(c.name) = LOWER({:x})) DESC, COALESCE(s.score, 0) DESC, c.name LIMIT " + limit,
    { id: '', name: '', domain: '', score: 0, band: '' },
    { q: like, x: q },
  ))
    out.push({ kind: 'company', id: r.id, name: r.name, sub: r.domain, score: r.score, band: r.band });
  for (const r of util.rows(
    ctx.app,
    "SELECT p.id AS id, p.name AS name, p.email AS email, p.title AS title, COALESCE(c.name, '') AS company, COALESCE(s.score, 0) AS score, COALESCE(s.band, 'none') AS band FROM people p LEFT JOIN companies c ON c.id = p.company LEFT JOIN strengths s ON s.kind = 'person' AND s.person = p.id WHERE p.deleted_at = '' AND p.merged_into = '' AND (p.name LIKE {:q} ESCAPE '\\' OR p.email LIKE {:q} ESCAPE '\\' OR p.emails LIKE {:q} ESCAPE '\\') ORDER BY (LOWER(p.name) = LOWER({:x})) DESC, COALESCE(s.score, 0) DESC, p.name LIMIT " + limit,
    { id: '', name: '', email: '', title: '', company: '', score: 0, band: '' },
    { q: like, x: q },
  ))
    out.push({ kind: 'person', id: r.id, name: r.name || r.email, sub: r.company || r.email, score: r.score, band: r.band });
  return { q: q, results: out };
}

/**
 * network.coverage: pipeline (open and held deals) and portfolio (invested
 * deals) companies by their warmest connection, for the Ring.
 */
function opCoverage(ctx, p) {
  const util = u();
  const D = L('lib_deals');
  const vis = D.visibleSql(ctx, 'd');
  const all = util.count(ctx.app, "SELECT COUNT(DISTINCT d.company) AS n FROM deals d WHERE d.deleted_at = '' AND d.status IN ('open', 'hold', 'invested')");
  const rows = util.rows(
    ctx.app,
    "SELECT d.company AS company, MAX(CASE WHEN d.status = 'invested' THEN 1 ELSE 0 END) AS invested, MAX(CASE WHEN d.status IN ('open', 'hold') THEN 1 ELSE 0 END) AS open, c.name AS name, COALESCE(s.score, 0) AS score, COALESCE(s.band, 'none') AS band, COALESCE(s.last_at, '') AS last_at, COALESCE(s.who, '') AS who FROM deals d JOIN companies c ON c.id = d.company LEFT JOIN strengths s ON s.kind = 'company' AND s.company = d.company WHERE d.deleted_at = '' AND d.status IN ('open', 'hold', 'invested') AND " +
      vis.sql +
      ' GROUP BY d.company ORDER BY score DESC, c.name LIMIT 2000',
    { company: '', invested: 0, open: 0, name: '', score: 0, band: '', last_at: '', who: '' },
    vis.bind,
  );
  const scope = util.oneOf(p, 'scope', ['all', 'pipeline', 'portfolio'], 'all');
  const mm = memberNames(ctx.app);
  const bands = { strong: 0, good: 0, weak: 0, none: 0 };
  const groups = { pipeline: { strong: 0, good: 0, weak: 0, none: 0 }, portfolio: { strong: 0, good: 0, weak: 0, none: 0 } };
  const companies = [];
  for (const r of rows) {
    const inPortfolio = r.invested === 1;
    const inPipeline = r.open === 1;
    if (inPortfolio) groups.portfolio[r.band]++;
    if (inPipeline) groups.pipeline[r.band]++;
    if (scope === 'portfolio' && !inPortfolio) continue;
    if (scope === 'pipeline' && !inPipeline) continue;
    bands[r.band]++;
    companies.push({ id: r.company, name: r.name, score: r.score, band: r.band, last_at: r.last_at || null, best_member: r.who ? mm[r.who] || null : null, portfolio: inPortfolio, pipeline: inPipeline });
  }
  return { scope: scope, total: companies.length, bands: bands, groups: groups, companies: companies.slice(0, util.int(p, 'limit', 200, 1, 2000)), hidden: Math.max(0, all - rows.length) };
}

const PEOPLE_SORT = { strength: 'score DESC, p.name', last: "last_at DESC, p.name", name: 'p.name' };

/** network.people: the People table (strength, last contact, owner = the member who knows them best). */
function opPeople(ctx, p) {
  const util = u();
  const pg = util.page(p, 50, 500);
  const where = ["p.deleted_at = ''", "p.merged_into = ''"];
  const bind = {};
  const q = util.squash(util.str(p, 'q', ''));
  if (q !== '') {
    where.push("(p.name LIKE {:q} ESCAPE '\\' OR p.email LIKE {:q} ESCAPE '\\' OR p.title LIKE {:q} ESCAPE '\\' OR c.name LIKE {:q} ESCAPE '\\')");
    bind.q = util.like(q);
  }
  const band = bandParam(p);
  if (band !== '') {
    where.push("COALESCE(s.band, 'none') = {:b}");
    bind.b = band;
  }
  const company = util.str(p, 'company', '');
  if (company !== '') {
    const cid = L('lib_records').resolve(ctx.app, 'companies', company).id;
    where.push('(p.company = {:c} OR p.id IN (SELECT e.person FROM employments e WHERE e.company = {:c} AND e.current = TRUE))');
    bind.c = cid;
  }
  const member = util.str(p, 'member', '');
  if (member !== '') {
    const m = L('lib_auth').memberRef(ctx.app, member);
    where.push("p.id IN (SELECT x.person FROM strengths x WHERE x.kind = 'edge' AND x.who = {:m})");
    bind.m = m.id;
  }
  if (util.bool(p, 'known', false)) where.push('COALESCE(s.score, 0) > 0');
  const sort = PEOPLE_SORT[util.oneOf(p, 'sort', Object.keys(PEOPLE_SORT), 'strength')];
  const from = "FROM people p LEFT JOIN companies c ON c.id = p.company LEFT JOIN strengths s ON s.kind = 'person' AND s.person = p.id WHERE " + where.join(' AND ');
  const total = util.count(ctx.app, 'SELECT COUNT(*) AS n ' + from, bind);
  const mm = memberNames(ctx.app);
  const rows = util.rows(
    ctx.app,
    "SELECT p.id AS id, p.name AS name, p.email AS email, p.title AS title, p.company AS company, COALESCE(c.name, '') AS company_name, COALESCE(s.score, 0) AS score, COALESCE(s.band, 'none') AS band, COALESCE(s.last_at, '') AS last_at, COALESCE(s.who, '') AS who " + from + ' ORDER BY ' + sort + ' LIMIT ' + pg.limit + ' OFFSET ' + pg.offset,
    { id: '', name: '', email: '', title: '', company: '', company_name: '', score: 0, band: '', last_at: '', who: '' },
    bind,
  );
  return { people: rows.map((r) => ({ id: r.id, name: r.name || r.email, email: r.email, title: r.title, company: r.company ? { id: r.company, name: r.company_name } : null, score: r.score, band: r.band, last_at: r.last_at || null, owner: r.who ? mm[r.who] || null : null })), total: total, offset: pg.offset, limit: pg.limit };
}

const COMPANY_SORT = { strength: 'score DESC, c.name', last: 'last_at DESC, c.name', name: 'c.name' };

/** network.companies: the Companies table (strength, last contact, owner, people known, pipeline or portfolio). */
function opCompanies(ctx, p) {
  const util = u();
  const pg = util.page(p, 50, 500);
  const where = ["c.deleted_at = ''", "c.merged_into = ''"];
  const bind = {};
  const q = util.squash(util.str(p, 'q', ''));
  if (q !== '') {
    where.push("(c.name LIKE {:q} ESCAPE '\\' OR c.domain LIKE {:q} ESCAPE '\\' OR c.sector LIKE {:q} ESCAPE '\\')");
    bind.q = util.like(q);
  }
  const band = bandParam(p);
  if (band !== '') {
    where.push("COALESCE(s.band, 'none') = {:b}");
    bind.b = band;
  }
  const relation = util.oneOf(p, 'relation', ['all', 'pipeline', 'portfolio'], 'all');
  if (relation === 'pipeline') where.push("c.id IN (SELECT d.company FROM deals d WHERE d.deleted_at = '' AND d.status IN ('open', 'hold'))");
  if (relation === 'portfolio') where.push("c.id IN (SELECT d.company FROM deals d WHERE d.deleted_at = '' AND d.status = 'invested')");
  if (util.bool(p, 'known', false)) where.push('COALESCE(s.score, 0) > 0');
  const sort = COMPANY_SORT[util.oneOf(p, 'sort', Object.keys(COMPANY_SORT), 'strength')];
  const from = "FROM companies c LEFT JOIN strengths s ON s.kind = 'company' AND s.company = c.id WHERE " + where.join(' AND ');
  const total = util.count(ctx.app, 'SELECT COUNT(*) AS n ' + from, bind);
  const mm = memberNames(ctx.app);
  const rows = util.rows(
    ctx.app,
    "SELECT c.id AS id, c.name AS name, c.domain AS domain, c.sector AS sector, COALESCE(s.score, 0) AS score, COALESCE(s.band, 'none') AS band, COALESCE(s.last_at, '') AS last_at, COALESCE(s.who, '') AS who, COALESCE(s.people_known, 0) AS known, COALESCE((SELECT MAX(CASE WHEN d.status = 'invested' THEN 2 WHEN d.status IN ('open', 'hold') THEN 1 ELSE 0 END) FROM deals d WHERE d.company = c.id AND d.deleted_at = ''), 0) AS rel " +
      from +
      ' ORDER BY ' +
      sort +
      ' LIMIT ' +
      pg.limit +
      ' OFFSET ' +
      pg.offset,
    { id: '', name: '', domain: '', sector: '', score: 0, band: '', last_at: '', who: '', known: 0, rel: 0 },
    bind,
  );
  return { companies: rows.map((r) => ({ id: r.id, name: r.name, domain: r.domain, sector: r.sector, score: r.score, band: r.band, last_at: r.last_at || null, owner: r.who ? mm[r.who] || null : null, people_known: r.known, relation: r.rel === 2 ? 'portfolio' : r.rel === 1 ? 'pipeline' : '' })), total: total, offset: pg.offset, limit: pg.limit };
}

/**
 * network.record: the figure strip of a company or person page: strength,
 * last contact, deals (visible count), invested (portfolio holdings at cost,
 * per currency), and the next meeting.
 */
function opRecord(ctx, p) {
  const util = u();
  const app = ctx.app;
  const recs = L('lib_records');
  const mm = memberNames(app);
  const person = util.str(p, 'person', '');
  const company = util.str(p, 'company', '');
  if (person === '' && company === '') throw util.fail(400, 'Give --person or --company.', 'missing_param');
  const D = L('lib_deals');
  const vis = D.visibleSql(ctx, 'd');
  let out;
  let companyId = '';
  if (person !== '') {
    const rec = recs.resolve(app, 'people', person);
    const s = strengthOf(app, rec.id);
    companyId = rec.getString('company');
    const deals = util.count(app, "SELECT COUNT(DISTINCT d.id) AS n FROM deals d JOIN deal_people dp ON dp.deal = d.id WHERE dp.person = {:p} AND d.deleted_at = '' AND " + vis.sql, Object.assign({ p: rec.id }, vis.bind));
    out = { kind: 'person', id: rec.id, score: s.score, band: L('lib_eng_strength').band(s.score), last_at: s.last_at, best_member: s.best_member ? mm[s.best_member] || null : null, deals: deals };
  } else {
    const rec = recs.resolve(app, 'companies', company);
    companyId = rec.id;
    const s = companyStrengthOf(app, rec.id);
    const deals = util.count(app, "SELECT COUNT(*) AS n FROM deals d WHERE d.company = {:c} AND d.deleted_at = '' AND " + vis.sql, Object.assign({ c: rec.id }, vis.bind));
    out = { kind: 'company', id: rec.id, score: s.score, band: s.band, last_at: s.last_at, best_member: s.best_member ? mm[s.best_member] || null : null, people_known: s.people_known, people_total: peopleOfCompany(app, rec.id).length, deals: deals };
    // The company's own logo, else its website icon: the page's identity row shows it on first render.
    Object.assign(out, L('lib_logos').viewOf(app, rec));
  }
  // The firm's holdings in the company (the person's company on a person page), for portfolio viewers: the portfolio tab shows on first render.
  const port = companyId !== '' && L('lib_auth').can(ctx, 'portfolio', 'view') ? investedIn(app, companyId) : { count: 0, cost: [] };
  out.invested = port.count > 0;
  out.holdings = port.count;
  out.invested_cost = person === '' ? port.cost : [];
  const next = util.one(app, "SELECT id, start_at, title FROM cal_events WHERE status IN ('confirmed', 'tentative') AND start_at >= {:n} AND " + (person !== '' ? 'attendees LIKE {:p}' : 'company = {:c}') + ' ORDER BY start_at LIMIT 1', { id: '', start_at: '', title: '' }, { n: new Date().toISOString(), p: '%"person":"' + out.id + '"%', c: out.id });
  out.next_meeting = next !== null && seesEvent(ctx, app.findRecordById('cal_events', next.id)) ? next : null;
  return out;
}

/** The firm's holdings in a company (portfolio's holdingsOf): { count, cost: [{ currency, cost_minor }] } at cost per currency. */
function investedIn(app, companyId) {
  const per = {};
  const rows = L('lib_portfolio').holdingsOf(app, { company: companyId }) || [];
  for (const h of rows) {
    const cur = String(h.currency || '');
    if (cur === '') continue;
    per[cur] = (per[cur] || 0) + Number(h.cost_minor || 0);
  }
  return {
    count: rows.length,
    cost: Object.keys(per)
      .sort((a, b) => per[b] - per[a])
      .map((c) => ({ currency: c, cost_minor: per[c] })),
  };
}

/** network.recompute: strengths now (one person, one company, or everyone). */
function opRecompute(ctx, p) {
  const util = u();
  const recs = L('lib_records');
  const person = util.str(p, 'person', '');
  const company = util.str(p, 'company', '');
  let r;
  if (person !== '') r = recompute(ctx.app, [recs.resolve(ctx.app, 'people', person).id]);
  else if (company !== '') r = recompute(ctx.app, peopleOfCompany(ctx.app, recs.resolve(ctx.app, 'companies', company).id));
  else r = recompute(ctx.app, null);
  L('lib_audit').note(ctx, { collection: 'strengths', summary: 'Recomputed relationship strength (' + r.edges + ' relationships)' });
  return r;
}

/* ------------------------------------------------------------ timeline */

/**
 * Timeline items (events_network.js timeline): touches with the record's
 * people, intros and briefs. A touch's subject shows to its member and the
 * owner only; deals the viewer may not see are left out (hidden).
 */
function timelineFor(ctx, t) {
  const util = u();
  const app = ctx.app;
  const out = [];
  let hidden = 0;
  const mm = memberNames(app);
  let where = '';
  const bind = {};
  if (t.kind === 'person') {
    where = 'EXISTS (SELECT 1 FROM json_each(i.people) j WHERE j.value = {:x})';
    bind.x = t.id;
  } else if (t.kind === 'company') {
    const ids = peopleOfCompany(app, t.id);
    where = '(i.company = {:x}' + (ids.length > 0 ? ' OR EXISTS (SELECT 1 FROM json_each(i.people) j WHERE j.value IN (' + inList(ids.slice(0, 300), 'p', bind) + '))' : '') + ')';
    bind.x = t.id;
  } else if (t.kind === 'deal') {
    where = 'i.deal = {:x}';
    bind.x = t.id;
  } else return { items: [], hidden: 0 };
  const cache = {};
  for (const r of util.rows(app, 'SELECT i.id AS id, i.kind AS kind, i.direction AS direction, i.at AS at, i.who AS who, i.people AS people, i.subject AS subject, i.deal AS deal, i.cal_event AS ev FROM interactions i WHERE ' + where + ' ORDER BY i.at DESC LIMIT 200', { id: '', kind: '', direction: '', at: '', who: '', people: '', subject: '', deal: '', ev: '' }, bind)) {
    if (r.deal !== '' && !L('lib_auth').dealVisible(ctx, r.deal)) {
      hidden++;
      continue;
    }
    const m = mm[r.who] ? mm[r.who].name : 'A member';
    const names = parseIds(r.people)
      .slice(0, 3)
      .map((id) => personMini(app, id, cache).name);
    const mine = ctx.isAgent || ctx.owner || r.who === ctx.memberId;
    const subject = mine && r.subject !== '' ? ': ' + r.subject : '';
    let title;
    if (r.kind === 'meeting') title = 'Meeting, ' + m + ' with ' + names.join(', ') + subject;
    else if (r.kind === 'call') title = 'Call, ' + m + ' with ' + names.join(', ');
    else if (r.kind === 'email') title = (r.direction === 'out' ? 'Email from ' + m + ' to ' : 'Email to ' + m + ' from ') + names.join(', ') + subject;
    else title = 'Message, ' + m + ' with ' + names.join(', ');
    out.push({ at: r.at, kind: 'touch_' + r.kind, title: util.clip(title, 200), icon: r.kind === 'meeting' ? 'Users' : r.kind === 'call' ? 'Phone' : r.kind === 'email' ? 'Mail' : 'MessageSquare', ref: { collection: 'interactions', id: r.id } });
  }
  const W = L('lib_network_work');
  for (const it of W.timelineItems(ctx, t)) out.push(it);
  return { items: out, hidden: hidden };
}

/* -------------------------------------------------------------- search */

/**
 * Ctrl-K (events_network.js search): people by a second email and
 * companies by a second domain. kernel-records' search already answers
 * names, primary emails and primary domains (no duplicates here).
 */
function search(ctx, q, limit) {
  const util = u();
  if (!L('lib_auth').can(ctx, 'network', 'view')) return [];
  const per = Math.max(1, Math.min(20, Number(limit) || 6));
  const like = util.like(q);
  const out = [];
  for (const r of util.rows(ctx.app, "SELECT p.id AS id, p.name AS name, p.email AS email, COALESCE(s.band, 'none') AS band FROM people p LEFT JOIN strengths s ON s.kind = 'person' AND s.person = p.id WHERE p.deleted_at = '' AND p.merged_into = '' AND p.emails LIKE {:q} ESCAPE '\\' AND NOT (p.name LIKE {:q} ESCAPE '\\' OR p.email LIKE {:q} ESCAPE '\\') ORDER BY p.name LIMIT " + per, { id: '', name: '', email: '', band: '' }, { q: like }))
    out.push({ kind: 'person', id: r.id, title: r.name || r.email, subtitle: r.email, href: '#/people/' + r.id, icon: 'User' });
  for (const r of util.rows(ctx.app, "SELECT c.id AS id, c.name AS name, c.domain AS domain FROM companies c WHERE c.deleted_at = '' AND c.merged_into = '' AND c.domains LIKE {:q} ESCAPE '\\' AND NOT (c.name LIKE {:q} ESCAPE '\\' OR c.domain LIKE {:q} ESCAPE '\\') ORDER BY c.name LIMIT " + per, { id: '', name: '', domain: '' }, { q: like }))
    out.push({ kind: 'company', id: r.id, title: r.name, subtitle: r.domain, href: '#/companies/' + r.id, icon: 'Building2' });
  return out;
}

/* ---------------------------------------------------------- app.today */

/** app.today block: today's external meetings for the caller with the brief state. */
function today(ctx) {
  const util = u();
  const day = util.today(ctx.app);
  const from = util.atOf(ctx.app, day, '00:00');
  const to = util.atOf(ctx.app, util.dayAdd(day, 1), '00:00');
  const zone = util.zoneOf(ctx.app);
  const items = upcoming(ctx, { from_at: from, to_at: to }).map((m) => ({
    time: util.localAt(zone, Date.parse(m.start_at)).time,
    title: m.title,
    company: m.company ? m.company.name : '',
    deal: m.deal ? m.deal.number : '',
    attendees: m.attendees.filter((a) => a.external).map((a) => a.name || a.email),
    brief: m.brief ? m.brief.state : 'none',
    cal_event: m.cal_event,
  }));
  return { key: 'meetings', day: day, meetings: items };
}

/* ------------------------------------------------------------- imports */

const PERSON_IMPORT = ['name', 'email', 'company', 'title', 'phone', 'linkedin', 'location', 'tags'];
const COMPANY_IMPORT = ['name', 'domain', 'website', 'description', 'sector', 'subsector', 'hq_country', 'hq_city', 'founded_year', 'team_size', 'linkedin', 'tags'];

/** Import row: one person (found by email, else by name at the company). */
function importPerson(ctx, row, info) {
  const util = u();
  const o = { origin: 'import', source_ref: 'import ' + (info && info.import_id ? info.import_id : 'preview') + ' row ' + (info ? info.index : '') };
  for (const k of PERSON_IMPORT) if (row[k] !== undefined && row[k] !== '' && row[k] !== null) o[k] = row[k];
  if (!o.email && !o.name) throw util.fail(400, 'A person needs a name or an email.', 'missing_param');
  const v = L('lib_records').upsertPerson(ctx, o);
  return { action: v.created ? 'created' : v.changed && v.changed.length > 0 ? 'updated' : 'skipped', id: v.id, message: v.created ? '' : v.changed && v.changed.length > 0 ? 'Updated ' + v.changed.join(', ') : 'Already known' };
}

/** Import row: one company (found by domain, else by name). */
function importCompany(ctx, row, info) {
  const util = u();
  const o = { origin: 'import', source_ref: 'import ' + (info && info.import_id ? info.import_id : 'preview') + ' row ' + (info ? info.index : '') };
  for (const k of COMPANY_IMPORT) if (row[k] !== undefined && row[k] !== '' && row[k] !== null) o[k] = row[k];
  if (!o.name && !o.domain && !o.website) throw util.fail(400, 'A company needs a name or a domain.', 'missing_param');
  if (!o.domain && o.website) o.domain = L('lib_norm').domain(o.website);
  const v = L('lib_records').upsertCompany(ctx, o);
  return { action: v.created ? 'created' : v.changed && v.changed.length > 0 ? 'updated' : 'skipped', id: v.id, message: v.created ? '' : v.changed && v.changed.length > 0 ? 'Updated ' + v.changed.join(', ') : 'Already known' };
}

/* --------------------------------------------------------------- events */

/** record.merged: re-point network rows from the dropped record to the kept one (inside the merge's undo unit). */
function onMerged(ctx, p) {
  const app = ctx.app;
  const util = u();
  if (!p || !p.keep || !p.drop) return null;
  if (p.kind === 'people') {
    for (const r of app.findRecordsByFilter('interactions', 'people ~ {:d}', '', 0, 0, { d: p.drop })) {
      const ids = r.getStringSlice('people').map((x) => (x === p.drop ? p.keep : x));
      const uniq = ids.filter((x, i) => ids.indexOf(x) === i);
      r.set('people', uniq);
      app.save(r);
    }
    for (const f of ['target', 'connector']) for (const r of app.findRecordsByFilter('intros', f + ' = {:d}', '', 0, 0, { d: p.drop })) {
      r.set(f, p.keep);
      app.save(r);
    }
    for (const r of app.findRecordsByFilter('briefs', 'person = {:d}', '', 0, 0, { d: p.drop })) {
      r.set('person', p.keep);
      app.save(r);
    }
    for (const r of app.findRecordsByFilter('cal_events', 'attendees ~ {:d}', '', 0, 0, { d: '"' + p.drop + '"' })) {
      const list = (util.jsonOf(r, 'attendees', []) || []).map((a) => (a.person === p.drop ? Object.assign({}, a, { person: p.keep }) : a));
      r.set('attendees', list);
      app.save(r);
    }
    markDirty(app, [p.keep, p.drop]);
    return { dirty: [p.keep, p.drop] };
  }
  if (p.kind === 'companies') {
    for (const col of ['interactions', 'cal_events', 'briefs']) for (const r of app.findRecordsByFilter(col, 'company = {:d}', '', 0, 0, { d: p.drop })) {
      r.set('company', p.keep);
      app.save(r);
    }
    for (const r of app.findRecordsByFilter('intros', 'target_company = {:d}', '', 0, 0, { d: p.drop })) {
      r.set('target_company', p.keep);
      app.save(r);
    }
    markDirty(app, peopleOfCompany(app, p.keep));
    return { dirty_company: p.keep };
  }
  if (p.kind === 'deals') {
    for (const col of ['interactions', 'cal_events', 'briefs', 'intros']) for (const r of app.findRecordsByFilter(col, 'deal = {:d}', '', 0, 0, { d: p.drop })) {
      r.set('deal', p.keep);
      app.save(r);
    }
    return null;
  }
  return null;
}

module.exports = {
  BANDS: BANDS,
  firmRow: firmRow,
  firmConfig: firmConfig,
  firmView: firmView,
  members: members,
  memberNames: memberNames,
  ownerMember: ownerMember,
  consents: consents,
  domainOf: domainOf,
  domainIn: domainIn,
  external: external,
  excluded: excluded,
  consented: consented,
  personFor: personFor,
  personMini: personMini,
  companyOfPerson: companyOfPerson,
  dealOfCompany: dealOfCompany,
  peopleOfCompany: peopleOfCompany,
  parseIds: parseIds,
  recompute: recompute,
  scoresFor: scoresFor,
  markDirty: markDirty,
  flushDirty: flushDirty,
  nightly: nightly,
  strengthOf: strengthOf,
  companyStrengthOf: companyStrengthOf,
  paths: paths,
  upcoming: upcoming,
  seesEvent: seesEvent,
  attends: attends,
  dealMini: dealMini,
  opStrength: opStrength,
  opPaths: opPaths,
  opFind: opFind,
  opCoverage: opCoverage,
  opPeople: opPeople,
  opCompanies: opCompanies,
  opRecord: opRecord,
  opRecompute: opRecompute,
  timelineFor: timelineFor,
  search: search,
  today: today,
  importPerson: importPerson,
  importCompany: importCompany,
  onMerged: onMerged,
};
