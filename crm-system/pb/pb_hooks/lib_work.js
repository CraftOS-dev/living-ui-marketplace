/// <reference path="../pb_data/types.d.ts" />
/**
 * The work on records: notes, tasks and emails.
 *
 * Tasks feed the Today queue: overdue, due today, upcoming, snoozed (until
 * a date) and done. A task linked to a deal is its next activity on the
 * board; completing one resets the deal's rotting clock.
 *
 * Emails: the person (or the AI agent) drafts; sending queues the email for
 * the AI agent, which sends it through its own email integration and
 * reports back (emails.sent or emails.fail). A sent email is logged as an
 * interaction. The AI agent's own sends are proposals unless the person
 * made email automatic.
 */

function U() {
  return require(`${__hooks}/lib_util.js`);
}

function nowIso() {
  return new Date().toISOString();
}

/** Resolve the optional person / company / deal a note, task or email is about. */
function targets(app, p) {
  const u = U();
  const recs = require(`${__hooks}/lib_records.js`);
  const out = { person: '', company: '', deal: '' };
  if (u.str(p, 'person', '') !== '') out.person = recs.resolve(app, 'people', u.str(p, 'person', '')).id;
  if (u.str(p, 'company', '') !== '') out.company = recs.resolve(app, 'companies', u.str(p, 'company', '')).id;
  if (u.str(p, 'deal', '') !== '') out.deal = recs.resolve(app, 'deals', u.str(p, 'deal', '')).id;
  return out;
}

function names(app, rec) {
  const u = U();
  const recs = require(`${__hooks}/lib_records.js`);
  const out = {};
  const p = rec.getString('person') ? u.byId(app, 'people', rec.getString('person')) : null;
  if (p) out.person = { id: p.id, name: recs.personName(p) };
  let cid = '';
  try {
    cid = rec.getString('company');
  } catch {
    cid = '';
  }
  const c = cid ? u.byId(app, 'companies', cid) : null;
  if (c) out.company = { id: c.id, name: c.getString('name') };
  const d = rec.getString('deal') ? u.byId(app, 'deals', rec.getString('deal')) : null;
  if (d) out.deal = { id: d.id, name: d.getString('name') };
  return out;
}

/* ------------------------------------------------------------------ notes */

function serializeNote(app, rec) {
  return Object.assign({ id: rec.id, body: rec.getString('body'), pinned: rec.getBool('pinned'), by: rec.getString('by'), run: rec.getString('run'), created: rec.getString('created'), updated: rec.getString('updated') }, names(app, rec));
}

function createNote(app, who, p) {
  const u = U();
  const body = u.text(p, 'body', '');
  if (body === '') throw u.fail(400, 'body is required');
  const t = targets(app, p);
  if (!t.person && !t.company && !t.deal) throw u.fail(400, 'A note is about a person, a company or a deal');
  const rec = new Record(app.findCollectionByNameOrId('notes'));
  rec.set('body', body.slice(0, 20000));
  rec.set('person', t.person);
  rec.set('company', t.company);
  rec.set('deal', t.deal);
  rec.set('pinned', u.bool(p, 'pinned', false));
  rec.set('by', who.actor);
  rec.set('run', who.run || '');
  app.save(rec);
  if (t.deal) require(`${__hooks}/lib_interactions.js`).touchDeal(app, t.deal);
  return rec;
}

/* ------------------------------------------------------------------ tasks */

function taskState(rec, today) {
  if (rec.getString('done_at') !== '') return 'done';
  const sn = rec.getString('snoozed_until');
  if (sn !== '' && sn > today) return 'snoozed';
  const due = rec.getString('due');
  if (due === '') return 'upcoming';
  if (due < today) return 'overdue';
  if (due === today) return 'today';
  return 'upcoming';
}

function serializeTask(app, rec) {
  const today = require(`${__hooks}/lib_dates.js`).today();
  return Object.assign(
    {
      id: rec.id,
      title: rec.getString('title'),
      notes: rec.getString('notes'),
      due: rec.getString('due'),
      done_at: rec.getString('done_at'),
      snoozed_until: rec.getString('snoozed_until'),
      kind: rec.getString('kind') || 'todo',
      state: taskState(rec, today),
      by: rec.getString('by'),
      run: rec.getString('run'),
      created: rec.getString('created'),
      updated: rec.getString('updated'),
    },
    names(app, rec),
  );
}

function createTask(app, who, p) {
  const u = U();
  const dates = require(`${__hooks}/lib_dates.js`);
  const title = u.squash(u.str(p, 'title', '')).slice(0, 300);
  if (title === '') throw u.fail(400, 'title is required');
  const t = targets(app, p);
  const rec = new Record(app.findCollectionByNameOrId('tasks'));
  rec.set('title', title);
  rec.set('notes', u.text(p, 'notes', '').slice(0, 4000));
  rec.set('due', u.str(p, 'due', '') === '' ? '' : dates.parse(u.str(p, 'due', ''), 'due'));
  rec.set('kind', u.oneOf(p, 'kind', ['todo', 'call', 'email', 'meeting', 'follow_up'], 'todo'));
  rec.set('person', t.person);
  rec.set('company', t.company);
  rec.set('deal', t.deal);
  rec.set('done_at', '');
  rec.set('snoozed_until', '');
  rec.set('by', who.actor);
  rec.set('run', who.run || '');
  app.save(rec);
  return rec;
}

/** The Today queue: open tasks by state with the ones done today. */
function today(app) {
  const dates = require(`${__hooks}/lib_dates.js`);
  const t = dates.today();
  const open = app.findRecordsByFilter('tasks', "done_at = ''", 'due,created', 0, 0);
  const doneToday = app.findRecordsByFilter('tasks', 'done_at >= {:d}', '-done_at', 50, 0, { d: t });
  const out = { overdue: [], today: [], upcoming: [], snoozed: [], done: [] };
  for (const r of open) out[taskState(r, t)].push(serializeTask(app, r));
  out.done = doneToday.map((r) => serializeTask(app, r));
  out.upcoming.sort((a, b) => (a.due === '' ? 1 : b.due === '' ? -1 : a.due < b.due ? -1 : 1));
  return out;
}

/* ----------------------------------------------------------------- emails */

function serializeEmail(app, rec) {
  return Object.assign(
    {
      id: rec.id,
      to: rec.getString('to'),
      cc: rec.getString('cc'),
      subject: rec.getString('subject'),
      body: rec.getString('body'),
      status: rec.getString('status'),
      by: rec.getString('by'),
      run: rec.getString('run'),
      queued_at: rec.getString('queued_at'),
      sent_at: rec.getString('sent_at'),
      error: rec.getString('error'),
      created: rec.getString('created'),
      updated: rec.getString('updated'),
    },
    names(app, rec),
  );
}

function addresses(raw, name, required) {
  const norm = require(`${__hooks}/lib_norm.js`);
  const list = String(raw || '')
    .split(/[,;\s]+/)
    .filter((x) => x !== '');
  const out = norm.emails(list, name);
  if (required && out.length === 0) throw U().fail(400, name + ' needs at least one email address');
  return out.join(', ');
}

/** Draft an email; `to` defaults to the person's email. */
function draft(app, who, p) {
  const u = U();
  const t = targets(app, p);
  let to = u.str(p, 'to', '');
  if (to === '' && t.person) to = u.byId(app, 'people', t.person).getString('primary_email');
  const rec = new Record(app.findCollectionByNameOrId('emails'));
  rec.set('to', addresses(to, 'to', false));
  rec.set('cc', addresses(u.str(p, 'cc', ''), 'cc', false));
  rec.set('subject', u.squash(u.str(p, 'subject', '')).slice(0, 300));
  rec.set('body', u.text(p, 'body', '').slice(0, 20000));
  rec.set('status', 'draft');
  rec.set('person', t.person);
  rec.set('deal', t.deal);
  rec.set('by', who.actor);
  rec.set('run', who.run || '');
  app.save(rec);
  return rec;
}

function queueEmail(app, rec) {
  const u = U();
  if (rec.getString('status') === 'sent') throw u.fail(409, 'Already sent');
  addresses(rec.getString('to'), 'to', true);
  if (rec.getString('subject') === '' && rec.getString('body') === '') throw u.fail(400, 'The email is empty');
  rec.set('status', 'queued');
  rec.set('queued_at', nowIso());
  rec.set('error', '');
  app.save(rec);
  return rec;
}

/** The AI agent reports an email sent: it becomes an interaction on the person (and deal). */
function markSent(app, who, rec) {
  const u = U();
  const norm = require(`${__hooks}/lib_norm.js`);
  rec.set('status', 'sent');
  rec.set('sent_at', nowIso());
  rec.set('error', '');
  app.save(rec);
  const people = [];
  if (rec.getString('person')) people.push(rec.getString('person'));
  for (const e of rec.getString('to').split(/[,;\s]+/)) {
    const n = norm.email(e);
    if (n === '') continue;
    const owner = require(`${__hooks}/lib_records.js`).emailOwner(app, n, '');
    if (owner && owner.getString('deleted') === '' && people.indexOf(owner.id) < 0) people.push(owner.id);
  }
  if (people.length > 0 || rec.getString('deal')) {
    require(`${__hooks}/lib_interactions.js`).log(app, who, {
      kind: 'email',
      direction: 'out',
      at: rec.getString('sent_at'),
      subject: rec.getString('subject'),
      summary: rec.getString('body').slice(0, 2000),
      people: people,
      deal: rec.getString('deal'),
      source: 'sent from CRM',
      ext_id: 'email:' + rec.id,
      review: 'false',
    });
  }
  u.byId(app, 'emails', rec.id);
  return rec;
}

module.exports = {
  targets: targets,
  serializeNote: serializeNote,
  createNote: createNote,
  taskState: taskState,
  serializeTask: serializeTask,
  createTask: createTask,
  today: today,
  serializeEmail: serializeEmail,
  addresses: addresses,
  draft: draft,
  queueEmail: queueEmail,
  markSent: markSent,
};
