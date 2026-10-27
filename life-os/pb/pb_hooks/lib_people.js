/// <reference path="../pb_data/types.d.ts" />
/**
 * People: the person's partner, family and friends, each a little villager (a drawn face picked by `look`). Being in touch is
 * one tap (people.touch logs a talk, message, meet or gift and moves
 * `last_contact`); keep-in-touch rhythms make gentle nudges; birthdays
 * count down by themselves. Events are dated plans (a family dinner, a
 * night out), optionally with someone.
 */

let u_ = null;
function u() {
  return u_ || (u_ = require(`${__hooks}/lib_util.js`));
}
let core_ = null;
function core() {
  return core_ || (core_ = require(`${__hooks}/lib_core.js`));
}
let rec_ = null;
function rec() {
  return rec_ || (rec_ = require(`${__hooks}/lib_rec.js`));
}

const CIRCLES = ['partner', 'friends', 'family'];
const TOUCH = ['talk', 'message', 'meet', 'gift', 'other'];
/** Which area each circle belongs to. */
const AREA_OF = { partner: 'relationships', friends: 'relationships', family: 'relationships' };

/** Every person's id (memoized), so links to someone deleted drop out. */
function peopleIds(app) {
  return core().memo(app, 'peopleIds', () => {
    const m = {};
    u()
      .rows(app, 'SELECT id FROM people', { id: '' }, {})
      .forEach((r) => (m[r.id] = true));
    return m;
  });
}

function personOut(app, p, today) {
  const C = core();
  const last = p.getString('last_contact');
  const every = p.getInt('keep_in_touch_days');
  const since = last === '' ? null : C.between(last, today);
  const due = every > 0 && (since === null || since >= every);
  return {
    id: p.id,
    name: p.getString('name'),
    circle: p.getString('circle'),
    area: AREA_OF[p.getString('circle')],
    relation: p.getString('relation'),
    birthday: p.getString('birthday'),
    next_birthday: C.nextBirthday(p.getString('birthday'), today),
    keep_in_touch_days: every,
    last_contact: last,
    days_since: since,
    due: due,
    overdue_by: due ? (since === null ? null : since - every) : 0,
    look: p.getInt('look'),
    links: (u().jsonOf(p, 'links') || []).filter((x) => typeof x === 'string' && peopleIds(app)[x] === true),
    notes: p.getString('notes'),
    archived: p.getBool('archived'),
    actor: p.getString('actor'),
  };
}

/** last_contact = the newest interaction's date. */
function refresh(app, refs) {
  const util = u();
  const id = refs && refs.person;
  if (!id) return;
  const p = util.byId(app, 'people', id);
  if (p === null) return;
  const r = util.one(app, 'SELECT IFNULL(MAX(date), \'\') AS d FROM interactions WHERE person = {:p}', { d: '' }, { p: id });
  p.set('last_contact', r === null ? '' : r.d);
  app.save(p);
}

function readPerson(ctx, p, r, creating) {
  const util = u();
  const C = core();
  if (creating || util.has(p, 'name')) r.set('name', C.name(p, 'name', 80));
  if (creating || util.has(p, 'circle')) r.set('circle', util.oneOf(p, 'circle', CIRCLES, creating ? 'friends' : r.getString('circle')));
  if (util.has(p, 'relation')) r.set('relation', C.name(p, 'relation', 60, ''));
  const b = C.birthday(p, 'birthday');
  if (b !== undefined) r.set('birthday', b);
  if (util.has(p, 'keep_in_touch_days')) r.set('keep_in_touch_days', util.int(p, 'keep_in_touch_days', 0, 0, 400));
  else if (creating) r.set('keep_in_touch_days', { partner: 0, friends: 30, family: 14 }[r.getString('circle')]);
  if (util.has(p, 'notes')) r.set('notes', util.text(p, 'notes', 4000, ''));
  if (util.has(p, 'look')) r.set('look', util.int(p, 'look', 0, 0, 100000));
  else if (creating) r.set('look', Math.floor(Math.random() * 1080));
  if (util.has(p, 'archived')) r.set('archived', util.bool(p, 'archived', false));
  if (creating) r.set('rank', C.nextRank(ctx.app, 'people'));
}

const people = rec().crud({
  collection: 'people',
  param: 'person',
  one: 'person',
  noun: (r) => r.getString('name'),
  fields: ['name', 'circle', 'relation', 'birthday', 'keep_in_touch_days', 'last_contact', 'look', 'notes', 'rank', 'archived'],
  read: readPerson,
  out: (app, r) => personOut(app, r, core().today(app)),
});

/** people.create: a new person, already linked to the people they know (--links). */
function create(ctx, p) {
  const util = u();
  const C = core();
  const links = util.ids(p, 'links', 50);
  links.forEach((id) => C.need(ctx.app, 'people', id, 'person they know'));
  const q = Object.assign({}, p);
  delete q.links;
  const res = people.create(ctx, q);
  if (links.length === 0) return res;
  links.forEach((id) => setLink(ctx, { a: res.person.id, b: id, linked: true }));
  return { person: personOut(ctx.app, ctx.app.findRecordById('people', res.person.id), C.today(ctx.app)) };
}

/** Connect or disconnect two people, on both sides. */
function setLink(ctx, args) {
  const C = core();
  const util = u();
  const a = C.need(ctx.app, 'people', args.a, 'person');
  const b = C.need(ctx.app, 'people', args.b, 'other person');
  [
    [a, b],
    [b, a],
  ].forEach(([x, y]) => {
    const links = (util.jsonOf(x, 'links') || []).filter((id) => id !== y.id);
    if (args.linked) links.push(y.id);
    x.set('links', links);
    ctx.app.save(x);
  });
}

/** people.link: two people who know each other get a line on the connection map. */
function link(ctx, p) {
  const util = u();
  const C = core();
  const a = util.req(p, 'person');
  const b = util.req(p, 'other');
  if (a === b) throw util.fail(400, 'A person cannot be connected to themselves.', 'invalid_param', { param: 'other' });
  const linked = util.bool(p, 'linked', true);
  ctx.app.runInTransaction((tx) => {
    const tctx = Object.assign({}, ctx, { app: tx });
    const pa = C.need(tx, 'people', a, 'person');
    const pb = C.need(tx, 'people', b, 'other person');
    const was = (util.jsonOf(pa, 'links') || []).indexOf(b) >= 0;
    setLink(tctx, { a: a, b: b, linked: linked });
    require(`${__hooks}/lib_activity.js`).write(tx, ctx, { label: (linked ? 'Connected ' : 'Took the line away between ') + pa.getString('name') + ' and ' + pb.getString('name'), target: 'people', record: a, undo: { fn: 'lib_people.setLink', args: { a: a, b: b, linked: was } } });
  });
  return { person: personOut(ctx.app, ctx.app.findRecordById('people', a), C.today(ctx.app)) };
}

/** people.list: everyone (or one circle), the ones to reach out to first. */
function list(ctx, p) {
  const util = u();
  const C = core();
  const today = C.today(ctx.app);
  const circle = util.oneOf(p, 'circle', CIRCLES, '');
  const area = C.kind(p, 'area', false) || '';
  const where = [util.bool(p, 'archived', false) ? 'archived = true' : 'archived = false'];
  const bind = {};
  if (circle !== '') {
    where.push('circle = {:c}');
    bind.c = circle;
  } else if (area !== '') {
    const cs = Object.keys(AREA_OF).filter((k) => AREA_OF[k] === area);
    if (cs.length === 0) return { people: [], today: today };
    where.push('(' + cs.map((c, i) => 'circle = {:c' + i + '}').join(' || ') + ')');
    cs.forEach((c, i) => (bind['c' + i] = c));
  }
  const out = ctx.app.findRecordsByFilter('people', where.join(' && '), 'rank,name', 0, 0, bind).map((r) => personOut(ctx.app, r, today));
  return { people: out, today: today };
}

/** people.get: one person with their history and plans together. */
function get(ctx, p) {
  const util = u();
  const C = core();
  const r = C.need(ctx.app, 'people', util.req(p, 'person'), 'person');
  const today = C.today(ctx.app);
  const o = personOut(ctx.app, r, today);
  o.knows = o.links.map((id) => {
    const x = u().byId(ctx.app, 'people', id);
    return { id: id, name: x === null ? '' : x.getString('name') };
  });
  o.interactions = ctx.app.findRecordsByFilter('interactions', 'person = {:p}', '-date,-created', 40, 0, { p: r.id }).map(interactionOut);
  o.events = ctx.app.findRecordsByFilter('events', 'person = {:p} && date >= {:t}', 'date', 20, 0, { p: r.id, t: today }).map((e) => eventOut(ctx.app, e));
  o.tasks = ctx.app.findRecordsByFilter('tasks', "person = {:p} && state = 'open'", 'do_date,rank', 20, 0, { p: r.id }).map((t) => ({ id: t.id, title: t.getString('title'), do_date: t.getString('do_date') }));
  return { person: o };
}

function interactionOut(i) {
  return { id: i.id, person: i.getString('person'), date: i.getString('date'), kind: i.getString('kind'), note: i.getString('note'), actor: i.getString('actor') };
}

/** people.touch: you were in touch (today by default). */
function touch(ctx, p) {
  const util = u();
  const C = core();
  const id = util.req(p, 'person');
  const out = rec().tx(ctx.app, (t) => {
    const r = C.need(t, 'people', id, 'person');
    const i = util.newRecord(t, 'interactions');
    i.set('person', r.id);
    i.set('date', util.day(p, 'date', C.today(t)));
    i.set('kind', util.oneOf(p, 'kind', TOUCH, 'talk'));
    i.set('note', util.text(p, 'note', 1000, ''));
    i.set('actor', ctx.actor);
    t.save(i);
    refresh(t, { person: r.id });
    const verb = { talk: 'Talked with ', message: 'Messaged ', meet: 'Met ', gift: 'Gave a gift to ', other: 'In touch with ' }[i.getString('kind')];
    require(`${__hooks}/lib_activity.js`).write(t, ctx, { label: verb + r.getString('name') + (i.getString('date') !== C.today(t) ? ' (' + C.words(t, i.getString('date')) + ')' : ''), target: 'interactions', record: i.id, undo: { fn: 'lib_rec.undoCreate', args: { collection: 'interactions', id: i.id, after: 'lib_people.refresh', refs: { person: r.id } } } });
    return i.id;
  });
  return { interaction: interactionOut(ctx.app.findRecordById('interactions', out)), person: personOut(ctx.app, ctx.app.findRecordById('people', id), C.today(ctx.app)) };
}

/** people.untouch: take an interaction back. */
function untouch(ctx, p) {
  const util = u();
  const C = core();
  const i0 = C.need(ctx.app, 'interactions', util.req(p, 'interaction'), 'interaction');
  rec().tx(ctx.app, (t) => {
    const i = t.findRecordById('interactions', i0.id);
    const person = i.getString('person');
    const fields = rec().snapshot(i, ['person', 'date', 'kind', 'note', 'actor']);
    t.delete(i);
    refresh(t, { person: person });
    require(`${__hooks}/lib_activity.js`).write(t, ctx, { label: 'Took back a note of being in touch', target: 'interactions', record: i0.id, undo: { fn: 'lib_rec.undoRemove', args: { collection: 'interactions', id: i0.id, fields: fields, after: 'lib_people.refresh', refs: { person: person } } } });
  });
  return { deleted: true };
}

/** Who to reach out to (due, most overdue first) and birthdays in the next `days`. */
function nudges(app, days) {
  const C = core();
  const today = C.today(app);
  const all = app.findRecordsByFilter('people', 'archived = false', 'rank,name', 0, 0).map((r) => personOut(app, r, today));
  const due = all.filter((x) => x.due).sort((a, b) => (b.days_since === null ? 9999 : b.days_since - b.keep_in_touch_days) - (a.days_since === null ? 9999 : a.days_since - a.keep_in_touch_days));
  const birthdays = all.filter((x) => x.next_birthday !== null && x.next_birthday.in_days <= (days || 30)).sort((a, b) => a.next_birthday.in_days - b.next_birthday.in_days);
  return { due: due, birthdays: birthdays, count: all.length };
}

/** people.reach: who to reach out to and whose birthday comes soon. */
function reach(ctx, p) {
  return nudges(ctx.app, u().int(p, 'days', 30, 1, 366));
}

/* ------------------------------------------------------------- events */

function eventOut(app, e) {
  const pm = core().personMap(app);
  const person = pm[e.getString('person')] || null;
  return { id: e.id, title: e.getString('title'), date: e.getString('date'), time: e.getString('time'), area: e.getString('area'), place: e.getString('place'), person: person, actor: e.getString('actor') };
}

function readEvent(ctx, p, r, creating) {
  const util = u();
  const C = core();
  if (creating || util.has(p, 'title')) r.set('title', C.name(p, 'title', 200));
  if (creating || util.has(p, 'date')) r.set('date', util.day(p, 'date', C.today(ctx.app)));
  if (util.has(p, 'time')) r.set('time', C.time(p, 'time', ''));
  const k = C.kind(p, 'area', creating);
  if (k !== undefined) r.set('area', k);
  if (util.has(p, 'place')) r.set('place', util.text(p, 'place', 200, ''));
  const person = C.ref(ctx.app, p, 'person', 'people', 'person');
  if (person !== undefined) r.set('person', person);
}

const events = rec().crud({
  collection: 'events',
  param: 'event',
  one: 'event',
  noun: (r) => 'the plan "' + r.getString('title') + '"',
  fields: ['title', 'date', 'time', 'area', 'place', 'person'],
  read: readEvent,
  out: eventOut,
  sort: 'date,time',
  where: (ctx, p) => {
    const util = u();
    const C = core();
    const from = util.day(p, 'from', C.today(ctx.app));
    const to = util.day(p, 'to', C.addDays(from, 365));
    const area = C.kind(p, 'area', false) || '';
    return { filter: 'date >= {:f} && date <= {:t}' + (area !== '' ? ' && area = {:a}' : ''), bind: { f: from, t: to, a: area } };
  },
});

/** Preview of a change to the people list your AI agent proposes. */
function preview(ctx, p) {
  const util = u();
  const op = ctx.op;
  if (op === 'people.create') {
    const C = core();
    const knows = util.ids(p, 'links', 50).map((id) => C.need(ctx.app, 'people', id, 'person they know').getString('name'));
    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const b = /(\d{2})-(\d{2})$/.exec(String(p.birthday || ''));
    const bday = b ? Number(b[2]) + ' ' + (MONTHS[Number(b[1]) - 1] || '') : '';
    return { kind: 'person', title: 'Add ' + util.text(p, 'name', 80, '') + ' to your people', summary: [p.circle ? 'Circle: ' + p.circle : '', p.relation ? String(p.relation) : '', knows.length > 0 ? 'Knows ' + C.listWords(knows) : '', bday !== '' ? 'Birthday ' + bday : ''].filter((x) => x !== '').join('. '), preview: { fields: p, knows: knows } };
  }
  const r = core().need(ctx.app, 'people', util.req(p, 'person'), 'person');
  if (op === 'people.delete') return { kind: 'person', title: 'Remove ' + r.getString('name'), summary: 'Their history goes with them.', preview: {}, target: { collection: 'people', id: r.id } };
  const changes = {};
  for (const k of Object.keys(p)) if (k !== 'person') changes[k] = { from: r.get(k), to: p[k] };
  return { kind: 'person', title: 'Change ' + r.getString('name'), summary: Object.keys(changes).join(', '), preview: { changes: JSON.parse(JSON.stringify(changes)) }, target: { collection: 'people', id: r.id } };
}

module.exports = {
  link: link,
  setLink: setLink,
  CIRCLES: CIRCLES,
  AREA_OF: AREA_OF,
  personOut: personOut,
  refresh: refresh,
  list: list,
  get: get,
  create: create,
  update: people.update,
  remove: people.remove,
  touch: touch,
  untouch: untouch,
  nudges: nudges,
  reach: reach,
  eventOut: eventOut,
  eventList: events.list,
  eventCreate: events.create,
  eventUpdate: events.update,
  eventRemove: events.remove,
  preview: preview,
};
