/// <reference path="../pb_data/types.d.ts" />
/**
 * References on a deal (SPEC 7.8): calls partners hold with people who know
 * the founders, logged with a kind (provided, backchannel, customer,
 * expert), a signal (positive, neutral, negative) and a short note.
 *
 * Your AI agent suggests back-channel names from the firm's own records
 * (trigger refs_suggest { deal_id }): people who worked at a founder's past company
 * (employments). refs.candidates lists those overlaps from the records so
 * the suggestion rests on data; refs.suggest stores your AI agent's picks
 * as `suggested` rows; a person logs the call (refs.log) or dismisses the
 * name. People hold the calls; your AI agent never contacts anyone.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}
function DD() {
  return L('lib_diligence');
}

const KINDS = ['provided', 'backchannel', 'customer', 'expert'];
const SIGNALS = ['positive', 'neutral', 'negative'];
const STEPS = ['Queued', 'Searching', 'Ready'];

function mini(app, coll, id) {
  return L('lib_records').mini(app, coll, id);
}

function refOut(app, r) {
  const util = u();
  const company = r.getString('company') !== '' ? mini(app, 'companies', r.getString('company')) : null;
  return {
    id: r.id,
    deal: r.getString('deal'),
    person: r.getString('person') !== '' ? mini(app, 'people', r.getString('person')) : null,
    name: r.getString('name'),
    title: r.getString('title'),
    company: company,
    founder: r.getString('founder') !== '' ? mini(app, 'people', r.getString('founder')) : null,
    kind: r.getString('kind'),
    signal: r.getString('signal'),
    note: r.getString('note'),
    status: r.getString('status'),
    why: util.jsonOf(r, 'why', null),
    day: r.getString('day'),
    called_by: r.getString('called_by') !== '' ? mini(app, 'members', r.getString('called_by')) : null,
    actor: r.getString('actor'),
    created: r.getString('created'),
  };
}

function countsOf(list) {
  const byKind = {};
  const bySignal = {};
  KINDS.forEach((k) => (byKind[k] = 0));
  SIGNALS.forEach((s) => (bySignal[s] = 0));
  list.forEach((r) => {
    if (r.status !== 'logged') return;
    byKind[r.kind] = (byKind[r.kind] || 0) + 1;
    if (r.signal !== '') bySignal[r.signal] = (bySignal[r.signal] || 0) + 1;
  });
  return { by_kind: byKind, by_signal: bySignal, logged: list.filter((r) => r.status === 'logged').length, suggested: list.filter((r) => r.status === 'suggested').length };
}

/** refs.list: a deal's references (logged, newest first, then suggested names), counts by kind and signal, your AI agent's suggestion ask. */
function opList(ctx, p) {
  const util = u();
  const app = ctx.app;
  const d = DD().dealFor(ctx, util.req(p, 'deal', 'D-0001'));
  const rows = DD()
    .arr(util.findMany(app, 'references', "deal = {:d} && status != 'dismissed'", '-day,-created', 300, { d: d.id }))
    .map((r) => refOut(app, r));
  rows.sort((a, b) => (a.status === b.status ? 0 : a.status === 'logged' ? -1 : 1));
  return { deal: DD().dealMini(app, d), references: rows, counts: countsOf(rows), ask: DD().askState(app, d, 'refs_suggest', STEPS) };
}

function personRef(app, ref) {
  return L('lib_records').resolve(app, 'people', ref);
}

function currentEmployment(app, personId) {
  const util = u();
  return util.findMany(app, 'employments', 'person = {:p}', '-current,-start_day', 1, { p: personId })[0] || null;
}

/** refs.log: log a reference call (or turn a suggested name into a logged call). */
function opLog(ctx, p) {
  const util = u();
  const app = ctx.app;
  const refId = util.str(p, 'reference', '');
  let r = null;
  let d = null;
  if (refId !== '') {
    r = util.byId(app, 'references', refId);
    if (r === null || r.getString('status') === 'dismissed') throw util.fail(404, 'No reference ' + refId + '. Run refs.list.', 'not_found');
    d = DD().dealFor(ctx, r.getString('deal'));
  } else d = DD().dealFor(ctx, util.req(p, 'deal', 'D-0001'));
  const kind = util.oneOf(p, 'kind', KINDS, r !== null ? r.getString('kind') : '');
  if (kind === '') throw util.fail(400, 'kind is required: ' + KINDS.join(', ') + '.', 'missing_param', { param: 'kind', allowed: KINDS });
  // A reference offered (named in a meeting) but not called yet is kept as a name to call, without a signal (qa-cli CLI-23).
  const offered = util.bool(p, 'offered', false);
  const signal = offered ? '' : util.oneOf(p, 'signal', SIGNALS, '');
  if (signal === '' && !offered) throw util.fail(400, 'signal is required: ' + SIGNALS.join(', ') + ' (a reference offered but not called yet: --offered true).', 'missing_param', { param: 'signal', allowed: SIGNALS });
  const note = util.squash(util.text(p, 'note', 600, ''));
  const day = util.day(p, 'day', util.today(app));
  const before = r !== null ? refOut(app, r) : null;
  if (r === null) {
    const personRefText = util.str(p, 'person', '');
    const name = util.squash(util.text(p, 'name', 120, ''));
    let person = null;
    if (personRefText !== '') person = personRef(app, personRefText);
    if (person === null && name === '') throw util.fail(400, 'Give --person (id or email) or --name.', 'missing_param', { param: 'name' });
    r = util.newRecord(app, 'references');
    r.set('deal', d.id);
    if (person !== null) {
      r.set('person', person.id);
      r.set('name', person.getString('name') || person.getString('email'));
      r.set('title', person.getString('title'));
      if (person.getString('company') !== '') r.set('company', person.getString('company'));
    } else r.set('name', name);
    r.set('why', null);
    DD().stamp(ctx, r);
  }
  r.set('kind', kind);
  r.set('signal', signal);
  if (note !== '' || refId === '') r.set('note', note);
  r.set('day', day);
  if (offered && refId === '') r.set('why', { text: 'Offered on ' + day + (note !== '' ? ': ' + note : ''), company: '' });
  r.set('status', offered ? 'suggested' : 'logged');
  r.set('called_by', ctx.isAgent ? '' : ctx.memberId || '');
  r.set('run', ctx.run || '');
  DD().stamp(ctx, r);
  app.save(r);
  L('lib_audit').note(ctx, { collection: 'references', record: r.id, summary: offered ? 'Noted an offered ' + kind + ' reference for ' + DD().dealTitle(app, d) : 'Logged a ' + kind + ' reference (' + signal + ') for ' + DD().dealTitle(app, d), before: before, after: refOut(app, r) });
  return { reference: refOut(app, r) };
}

/** refs.dismiss: a person drops a suggested name. */
function opDismiss(ctx, p) {
  const util = u();
  const app = ctx.app;
  const r = util.byId(app, 'references', util.req(p, 'reference'));
  if (r === null) throw util.fail(404, 'No reference ' + util.str(p, 'reference', '') + '.', 'not_found');
  const d = DD().dealFor(ctx, r.getString('deal'));
  if (r.getString('status') !== 'suggested') throw util.fail(409, 'Only a suggested name can be dismissed.', 'conflict');
  r.set('status', 'dismissed');
  app.save(r);
  L('lib_audit').note(ctx, { collection: 'references', record: r.id, summary: 'Dismissed the suggested reference ' + r.getString('name') + ' for ' + DD().dealTitle(app, d) });
  return { reference: refOut(app, r) };
}

function founderIds(app, d) {
  return u()
    .rows(app, "SELECT DISTINCT person FROM deal_people WHERE deal = {:d} AND role = 'founder' AND person != ''", { person: '' }, { d: d.id })
    .map((r) => r.person);
}

function overlapDays(app, a0, a1, b0, b1) {
  if (!a0 || !b0) return null;
  const today = u().today(app);
  const end = (x) => (x ? x : today);
  const s = a0 > b0 ? a0 : b0;
  const e = end(a1) < end(b1) ? end(a1) : end(b1);
  if (e < s) return 0;
  return u().daysBetween(s, e);
}

/**
 * refs.candidates: people in the firm's records who share a past company
 * with a founder of the deal (employments), with the overlap in days when
 * both have dates (null when unknown). Founders, people already on the
 * reference list and the deal's own company are left out.
 */
function opCandidates(ctx, p) {
  const util = u();
  const app = ctx.app;
  const d = DD().dealFor(ctx, util.req(p, 'deal', 'D-0001'));
  const founders = founderIds(app, d);
  if (founders.length === 0) return { deal: DD().dealMini(app, d), founders: [], candidates: [], note: 'This deal has no founders on record (deals.people adds them).' };
  const bind = { co: d.getString('company') };
  const list = founders.map((f, i) => ((bind['f' + i] = f), '{:f' + i + '}')).join(', ');
  const rows = util.rows(
    app,
    'SELECT e2.person AS person, e1.person AS founder, e1.company AS company, e1.start_day AS f0, e1.end_day AS f1, e2.start_day AS p0, e2.end_day AS p1, e2.title AS title FROM employments e1 JOIN employments e2 ON e2.company = e1.company AND e2.person != e1.person JOIN people pp ON pp.id = e2.person WHERE e1.person IN (' +
      list +
      ") AND e1.company != {:co} AND pp.deleted_at = '' AND pp.merged_into = '' LIMIT 500",
    { person: '', founder: '', company: '', f0: '', f1: '', p0: '', p1: '', title: '' },
    bind,
  );
  const taken = {};
  founders.forEach((f) => (taken[f] = true));
  util.rows(app, "SELECT person FROM {{references}} WHERE deal = {:d} AND person != '' AND status != 'dismissed'", { person: '' }, { d: d.id }).forEach((r) => (taken[r.person] = true));
  const best = {};
  rows.forEach((r) => {
    if (taken[r.person]) return;
    const ov = overlapDays(app, r.f0, r.f1, r.p0, r.p1);
    const k = r.person;
    const cur = best[k];
    const score = ov === null ? -1 : ov === 0 ? -2 : ov;
    if (cur === undefined || score > cur.score) best[k] = { score: score, row: r, overlap: ov };
  });
  const out = Object.keys(best)
    .map((k) => best[k])
    .sort((a, b) => b.score - a.score)
    .slice(0, 50)
    .map((b) => ({
      person: mini(app, 'people', b.row.person),
      title: b.row.title,
      founder: mini(app, 'people', b.row.founder),
      company: mini(app, 'companies', b.row.company),
      founder_span: [b.row.f0, b.row.f1],
      person_span: [b.row.p0, b.row.p1],
      overlap_days: b.overlap,
    }));
  return { deal: DD().dealMini(app, d), founders: founders.map((f) => mini(app, 'people', f)), candidates: out };
}

/** refs.suggest: your AI agent's back-channel names (people in the firm's records), stored as suggested references. */
function opSuggest(ctx, p) {
  const util = u();
  const app = ctx.app;
  const d = DD().dealFor(ctx, util.req(p, 'deal', 'D-0001'));
  const items = util.list(p, 'suggestions') || [];
  if (items.length === 0) throw util.fail(400, 'Give --suggestions \'[{"person":"<id or email>","founder":"<id>","company":"<id>","why":"Both at Stripe 2019 to 2021"}]\'.', 'missing_param', { param: 'suggestions' });
  if (items.length > 30) throw util.fail(400, 'At most 30 names at once.', 'too_many');
  const founders = founderIds(app, d);
  const checked = items.map((it, i) => {
    const where = 'Suggestion ' + (i + 1);
    util.keysOnly(it, ['person', 'founder', 'company', 'kind', 'why'], where);
    const person = personRef(app, String((it && it.person) || ''));
    if (founders.indexOf(person.id) >= 0) throw util.fail(400, where + ': ' + person.getString('name') + ' is a founder of this deal.', 'invalid_param');
    let founder = null;
    if (it.founder) {
      founder = personRef(app, String(it.founder));
      if (founders.indexOf(founder.id) < 0) throw util.fail(400, where + ': founder must be a founder of this deal (refs.candidates lists them).', 'invalid_param', { param: 'founder' });
    }
    let company = null;
    if (it.company) company = L('lib_records').resolve(app, 'companies', String(it.company));
    const kind = it.kind ? String(it.kind) : 'backchannel';
    if (KINDS.indexOf(kind) < 0) throw util.fail(400, where + ': kind is one of ' + KINDS.join(', ') + '.', 'invalid_param', { param: 'kind' });
    const why = util.squash(it.why);
    if (why.length > 300) throw util.fail(400, where + ': why is at most 300 characters.', 'invalid_param');
    return { person: person, founder: founder, company: company, kind: kind, why: why };
  });
  const added = [];
  const kept = [];
  checked.forEach((c) => {
    const same = util.findOne(app, 'references', "deal = {:d} && person = {:p} && status != 'dismissed'", { d: d.id, p: c.person.id });
    if (same !== null) {
      kept.push(same.id);
      return;
    }
    const emp = c.company === null ? currentEmployment(app, c.person.id) : null;
    const r = util.newRecord(app, 'references');
    r.set('deal', d.id);
    r.set('person', c.person.id);
    r.set('name', c.person.getString('name') || c.person.getString('email'));
    r.set('title', c.person.getString('title'));
    r.set('company', c.company !== null ? c.company.id : emp !== null ? emp.getString('company') : c.person.getString('company'));
    if (c.founder !== null) r.set('founder', c.founder.id);
    r.set('kind', c.kind);
    r.set('signal', '');
    r.set('note', '');
    r.set('status', 'suggested');
    r.set('why', { text: c.why, company: c.company !== null ? c.company.getString('name') : '' });
    r.set('run', ctx.run || '');
    DD().stamp(ctx, r);
    app.save(r);
    added.push(r.id);
  });
  if (ctx.isAgent) L('lib_agent').landed(app, 'refs_suggest', app.findRecordById('deals', d.id));
  L('lib_audit').note(ctx, { collection: 'deals', record: d.id, summary: (ctx.isAgent ? 'Your AI agent suggested ' : 'Suggested ') + added.length + ' reference name' + (added.length === 1 ? '' : 's') + ' for ' + DD().dealTitle(app, d) });
  return { added: added.length, kept: kept.length, references: added.map((id) => refOut(app, app.findRecordById('references', id))) };
}

/** agent.ask --trigger refs_suggest --record <deal>: a deal your AI agent may work on. */
function askCheck(ctx, d) {
  DD().dealFor(ctx, d.id);
  L('lib_auth').need(ctx, 'diligence', 'edit', 'ask your AI agent for reference names');
  if (d.getBool('restricted') && !d.getBool('agent_allowed')) throw u().fail(409, 'Your AI agent is off for this restricted deal (the deal team can allow it).', 'agent_off');
  return {};
}

/** refs.ask: Ask your AI agent for back-channel names now (trigger refs_suggest). */
function opAsk(ctx, p) {
  const util = u();
  const app = ctx.app;
  const d = DD().dealFor(ctx, util.req(p, 'deal', 'D-0001'));
  askCheck(ctx, d);
  const r = L('lib_agent').requestFor(ctx, 'refs_suggest', d, {}, { again: util.str(p, 'again', '') });
  L('lib_audit').note(ctx, { collection: 'deals', record: d.id, summary: 'Asked your AI agent for reference names for ' + DD().dealTitle(app, d) });
  return { request: r.request, step: DD().askState(app, app.findRecordById('deals', d.id), 'refs_suggest', STEPS) };
}

module.exports = { KINDS: KINDS, SIGNALS: SIGNALS, STEPS: STEPS, refOut: refOut, opList: opList, opLog: opLog, opDismiss: opDismiss, opCandidates: opCandidates, opSuggest: opSuggest, opAsk: opAsk, askCheck: askCheck };
