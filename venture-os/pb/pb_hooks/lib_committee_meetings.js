/// <reference path="../pb_data/types.d.ts" />
/**
 * IC meetings and their agenda (SPEC 7.9, REPORT Table 25 steps 4 and 5):
 * the weekly meeting assembled from deals at stage IC and deals with a
 * submitted memo; each agenda item with its memo version, champion,
 * skeptic and cooling-off end (Connect's no-discussion window after the
 * pre-reads go out); the meeting room runs one item at a time; the bear
 * case is your AI agent's pre-read of risks and contrary evidence, with
 * citations and no recommendation.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}
function C() {
  return L('lib_committee');
}

function needView(ctx) {
  const auth = L('lib_auth');
  if (auth.can(ctx, 'committee', 'view')) return;
  auth.need(ctx, 'committee', 'view', 'see the committee');
}

/** meetings.list: the next meeting in full, then meetings (upcoming first, or past) with counts. */
function list(ctx, p) {
  const util = u();
  const app = ctx.app;
  needView(ctx);
  const pg = util.page(p, 30, 200);
  const when = util.oneOf(p, 'when', ['upcoming', 'past', 'all'], 'all');
  const filter = when === 'upcoming' ? "status != 'closed'" : when === 'past' ? "status = 'closed'" : '1=1';
  const sort = when === 'past' ? '-starts_at' : when === 'upcoming' ? 'starts_at' : '-starts_at';
  const total = util.count(app, 'SELECT COUNT(*) AS n FROM ic_meetings WHERE ' + (when === 'upcoming' ? "status != 'closed'" : when === 'past' ? "status = 'closed'" : '1 = 1'));
  const rows = app.findRecordsByFilter('ic_meetings', filter, sort, pg.limit, pg.offset);
  const next = C().nextPlanned(app, '');
  const due = ctx.memberId ? C().needsYou(ctx).filter((x) => x.kind === 'vote').length : 0;
  return {
    next: next !== null ? C().meetingOut(ctx, next, true) : null,
    meetings: rows.map((m) => C().meetingOut(ctx, m, false)),
    total: total,
    votes_due: due,
    defaults: (function () {
      const at = C().nextMeetingAt(app);
      return { day: at.day, time: at.time, cooling_hours: C().settings(app).cooling_hours };
    })(),
  };
}

/** meetings.get: one meeting (or --meeting next) with every agenda item, votes as counts until each reveal. */
function get(ctx, p) {
  needView(ctx);
  const m = C().meetingRef(ctx.app, u().str(p, 'meeting', 'next') || 'next');
  return { meeting: C().meetingOut(ctx, m, true) };
}

/** meetings.create: a meeting on a day and time (defaults: the next meeting day), its agenda assembled at once. */
function create(ctx, p) {
  const util = u();
  const app = ctx.app;
  L('lib_auth').need(ctx, 'committee', 'edit', 'create meetings');
  const def = C().nextMeetingAt(app);
  const day = util.day(p, 'day', def.day);
  const time = util.str(p, 'time', def.time);
  if (!util.isTime(time)) throw util.fail(400, 'time is HH:MM, e.g. 10:00.', 'invalid_param', { param: 'time' });
  const at = util.atOf(app, day, time);
  let fund = '';
  if (util.str(p, 'fund', '') !== '') {
    const f = L('lib_entities').ref(app, util.str(p, 'fund', ''));
    if (!L('lib_auth').inScope(ctx, f.id)) throw util.fail(403, 'That fund is outside your scope.', 'not_permitted');
    fund = f.id;
  }
  const facilitator = util.str(p, 'facilitator', '') !== '' ? L('lib_auth').memberRef(app, util.str(p, 'facilitator', '')).id : ctx.memberId;
  const m = C().createMeeting(ctx, { at: at, title: util.text(p, 'title', 120, '') || 'Investment committee', fund: fund, facilitator: facilitator, auto: false });
  const added = util.bool(p, 'assemble', true) ? C().assemble(ctx, m) : [];
  L('lib_audit').note(ctx, { collection: 'ic_meetings', record: m.id, summary: 'Created meeting ' + m.getString('number') + ' on ' + day + ' ' + time + ' with ' + added.length + ' item' + (added.length === 1 ? '' : 's') });
  return { meeting: C().meetingOut(ctx, m, true), added: added.length };
}

/** meetings.save: a meeting's title, day and time, facilitator or fund (facilitator or committee:full; not once closed). */
function save(ctx, p) {
  const util = u();
  const app = ctx.app;
  L('lib_auth').need(ctx, 'committee', 'edit', 'change meetings');
  const m = C().meetingRef(app, util.req(p, 'meeting', 'IC-001'));
  C().needFacilitator(ctx, m, 'change it');
  if (m.getString('status') === 'closed') throw util.fail(409, m.getString('number') + ' is closed.', 'meeting_closed');
  const before = C().meetingOut(ctx, m, false);
  if (util.has(p, 'title')) {
    const t = util.squash(util.text(p, 'title', 120, ''));
    if (t === '') throw util.fail(400, 'title cannot be empty.', 'invalid_param', { param: 'title' });
    m.set('title', t);
  }
  if (util.has(p, 'day') || util.has(p, 'time')) {
    const local = util.localAt(util.zoneOf(app), C().ms(m.getString('starts_at')));
    const day = util.day(p, 'day', local.day);
    const time = util.str(p, 'time', local.time);
    if (!util.isTime(time)) throw util.fail(400, 'time is HH:MM, e.g. 10:00.', 'invalid_param', { param: 'time' });
    m.set('starts_at', util.atOf(app, day, time));
    m.set('day', day);
  }
  if (util.has(p, 'facilitator')) m.set('facilitator', L('lib_auth').memberRef(app, util.req(p, 'facilitator')).id);
  if (util.has(p, 'fund')) {
    const f = util.str(p, 'fund', '') === '' ? null : L('lib_entities').ref(app, util.str(p, 'fund', ''));
    m.set('fund', f ? f.id : '');
  }
  app.save(m);
  L('lib_audit').note(ctx, { collection: 'ic_meetings', record: m.id, summary: 'Changed meeting ' + m.getString('number'), before: before, after: C().meetingOut(ctx, m, false) });
  return { meeting: C().meetingOut(ctx, m, true) };
}

/** meetings.agenda: assemble the meeting's agenda from deals at IC and submitted memos (deterministic; adds what is missing). */
function agenda(ctx, p) {
  const app = ctx.app;
  if (!ctx.isAgent) L('lib_auth').need(ctx, 'committee', 'edit', 'assemble the agenda');
  const m = C().meetingRef(app, u().str(p, 'meeting', 'next') || 'next');
  if (m.getString('status') === 'closed') throw u().fail(409, m.getString('number') + ' is closed.', 'meeting_closed');
  const added = C().assemble(ctx, m);
  L('lib_audit').note(ctx, { collection: 'ic_meetings', record: m.id, summary: 'Assembled the agenda of ' + m.getString('number') + ': ' + added.length + ' added' });
  return { meeting: C().meetingOut(ctx, m, true), added: added.map((it) => it.id) };
}

/** Preview of an agenda item proposal (your AI agent). */
function addItemPreview(ctx, p) {
  const util = u();
  const app = ctx.app;
  let label = 'Add to the agenda';
  try {
    const m = C().meetingRef(app, util.str(p, 'meeting', 'next') || 'next');
    let what = util.str(p, 'title', '');
    if (util.str(p, 'deal', '') !== '') {
      const d = L('lib_deals').ref(app, util.str(p, 'deal', ''));
      what = (C().dealMini(app, d.id) || { title: '' }).title;
    } else if (util.str(p, 'company', '') !== '') what = L('lib_records').resolve(app, 'companies', util.str(p, 'company', '')).getString('name');
    label = 'Add ' + (what || 'an item') + ' to ' + m.getString('number');
  } catch {
    label = 'Add to the agenda';
  }
  return { label: label, target: 'ic_meetings', fields: [], notes: [], risk: 'low' };
}

/** meetings.add-item */
function addItem(ctx, p) {
  const util = u();
  if (!ctx.isAgent) L('lib_auth').need(ctx, 'committee', 'edit', 'change the agenda');
  const it = C().addItem(ctx, {
    meeting: util.str(p, 'meeting', '') || 'next',
    deal: util.str(p, 'deal', ''),
    company: util.str(p, 'company', ''),
    kind: util.oneOf(p, 'kind', C().KINDS, ''),
    title: util.text(p, 'title', 200, ''),
    champion: util.str(p, 'champion', ''),
    source: ctx.isAgent ? 'proposal' : 'manual',
  });
  L('lib_audit').note(ctx, { collection: 'agenda_items', record: it.id, summary: 'Added ' + (C().itemOut(ctx, it, { votes: false }).title || 'an item') + ' to the agenda' });
  return { item: C().itemOut(ctx, it) };
}

/** meetings.remove-item: take an item off the agenda (never once votes were cast or revealed). */
function removeItem(ctx, p) {
  const util = u();
  const app = ctx.app;
  L('lib_auth').need(ctx, 'committee', 'edit', 'change the agenda');
  const it = C().itemRef(ctx, util.req(p, 'item'));
  const meeting = app.findRecordById('ic_meetings', it.getString('meeting'));
  C().needFacilitator(ctx, meeting, 'change its agenda');
  if (it.getString('status') === 'revealed' || it.getString('status') === 'decided') throw util.fail(409, 'This item was revealed; record or correct its decision instead.', 'item_revealed');
  const n = util.count(app, 'SELECT COUNT(*) AS n FROM votes WHERE item = {:i}', { i: it.id });
  if (n > 0) throw util.fail(409, n + ' vote' + (n === 1 ? ' was' : 's were') + ' cast on this item. Close the meeting to skip it instead.', 'votes_cast', { votes: n });
  const title = C().itemOut(ctx, it, { votes: false }).title;
  if (meeting.getString('current_item') === it.id) {
    meeting.set('current_item', '');
    app.save(meeting);
  }
  app.delete(app.findRecordById('agenda_items', it.id));
  L('lib_audit').note(ctx, { collection: 'agenda_items', record: it.id, summary: 'Removed ' + title + ' from ' + meeting.getString('number') });
  return { removed: it.id };
}

/** meetings.item-save: an item's champion, skeptic, kind, title, place, or a cooling-off restarted now. */
function itemSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  L('lib_auth').need(ctx, 'committee', 'edit', 'change the agenda');
  const it = C().itemRef(ctx, util.req(p, 'item'));
  const meeting = app.findRecordById('ic_meetings', it.getString('meeting'));
  C().needFacilitator(ctx, meeting, 'change its agenda');
  if (it.getString('status') === 'decided') throw util.fail(409, 'This item is decided.', 'item_decided');
  const auth = L('lib_auth');
  if (util.has(p, 'champion')) it.set('champion', util.str(p, 'champion', '') === '' ? '' : auth.memberRef(app, util.str(p, 'champion', '')).id);
  if (util.has(p, 'skeptic')) it.set('skeptic', util.str(p, 'skeptic', '') === '' ? '' : auth.memberRef(app, util.str(p, 'skeptic', '')).id);
  if (util.has(p, 'kind')) it.set('kind', util.oneOf(p, 'kind', C().KINDS, it.getString('kind')));
  if (util.has(p, 'title')) it.set('title', util.text(p, 'title', 200, ''));
  if (util.has(p, 'cooling_hours')) {
    const h = util.num(p, 'cooling_hours', { min: 0, max: 24 * 14 });
    const from = util.nowIso();
    if (it.getString('preread_at') === '') it.set('preread_at', from);
    it.set('cooling_end_at', h === 0 ? '' : new Date(Date.now() + h * 3600000).toISOString());
  }
  if (util.has(p, 'position')) {
    const pos = util.int(p, 'position', 1, 1, 1000);
    const items = util.findMany(app, 'agenda_items', 'meeting = {:m}', 'sort,created', 0, { m: meeting.id }).filter((x) => x.id !== it.id);
    items.splice(Math.min(pos - 1, items.length), 0, it);
    items.forEach((x, i) => {
      if (x.getInt('sort') !== i + 1 || x.id === it.id) {
        x.set('sort', i + 1);
        if (x.id !== it.id) app.save(x);
      }
    });
  }
  app.save(it);
  L('lib_audit').note(ctx, { collection: 'agenda_items', record: it.id, summary: 'Changed the agenda item ' + C().itemOut(ctx, it, { votes: false }).title });
  return { item: C().itemOut(ctx, it) };
}

/** The first item not decided or skipped, in agenda order. */
function firstOpen(app, meetingId) {
  const rows = u().findMany(app, 'agenda_items', "meeting = {:m} && status != 'decided' && status != 'skipped'", 'sort,created', 1, { m: meetingId });
  return rows.length > 0 ? rows[0] : null;
}

/** meetings.start: start the meeting (live) on its first open item, or move the room to --item. */
function start(ctx, p) {
  const util = u();
  const app = ctx.app;
  L('lib_auth').need(ctx, 'committee', 'edit', 'run meetings');
  const m = C().meetingRef(app, util.req(p, 'meeting', 'IC-001'));
  C().needFacilitator(ctx, m, 'run it');
  if (m.getString('status') === 'closed') throw util.fail(409, m.getString('number') + ' is closed.', 'meeting_closed');
  if (m.getString('facilitator') === '') m.set('facilitator', ctx.memberId);
  if (m.getString('status') !== 'live') {
    m.set('status', 'live');
    m.set('started_at', util.nowIso());
  }
  const ref = util.str(p, 'item', '');
  let item = null;
  if (ref === 'next') {
    const items = util.findMany(app, 'agenda_items', 'meeting = {:m}', 'sort,created', 0, { m: m.id });
    const at = items.map((x) => x.id).indexOf(m.getString('current_item'));
    item = items.slice(at + 1).filter((x) => x.getString('status') !== 'decided' && x.getString('status') !== 'skipped')[0] || null;
  } else if (ref !== '') {
    item = C().itemRef(ctx, ref);
    if (item.getString('meeting') !== m.id) throw util.fail(400, 'That item is on another meeting.', 'invalid_param', { param: 'item' });
  } else item = m.getString('current_item') !== '' ? util.byId(app, 'agenda_items', m.getString('current_item')) : firstOpen(app, m.id);
  m.set('current_item', item !== null ? item.id : '');
  app.save(m);
  L('lib_audit').note(ctx, { collection: 'ic_meetings', record: m.id, summary: (ref === '' ? 'Started ' : 'Moved ') + m.getString('number') + (item !== null ? ' to ' + C().itemOut(ctx, item, { votes: false }).title : '') });
  return { meeting: C().meetingOut(ctx, m, true) };
}

/** meetings.close: close the meeting; items not decided are skipped (their deals join the next agenda; their sealed votes are never opened). */
function close(ctx, p) {
  const util = u();
  const app = ctx.app;
  L('lib_auth').need(ctx, 'committee', 'edit', 'run meetings');
  const m = C().meetingRef(app, util.req(p, 'meeting', 'IC-001'));
  C().needFacilitator(ctx, m, 'close it');
  if (m.getString('status') === 'closed') return { meeting: C().meetingOut(ctx, m, true), skipped: 0 };
  let skipped = 0;
  for (const it of util.findMany(app, 'agenda_items', "meeting = {:m} && status != 'decided' && status != 'skipped'", '', 0, { m: m.id })) {
    if (it.getString('status') === 'revealed') throw util.fail(409, 'Record the decision on ' + C().itemOut(ctx, it, { votes: false }).title + ' first: its votes are revealed.', 'decision_pending', { item: it.id });
    it.set('status', 'skipped');
    it.set('voting', 'closed');
    app.save(it);
    skipped++;
  }
  m.set('status', 'closed');
  m.set('closed_at', util.nowIso());
  m.set('current_item', '');
  app.save(m);
  L('lib_audit').note(ctx, { collection: 'ic_meetings', record: m.id, summary: 'Closed ' + m.getString('number') + (skipped > 0 ? ', ' + skipped + ' skipped' : '') });
  return { meeting: C().meetingOut(ctx, m, true), skipped: skipped };
}

/* ------------------------------------------------------------ bear case */

/** agent.ask --trigger bear_case --record <agenda item>: an item with a deal. */
function bearCheck(ctx, it) {
  L('lib_auth').need(ctx, 'committee', 'edit', 'ask for a bear case');
  if (it.getString('deal') === '') throw u().fail(400, 'A bear case needs a deal on the item.', 'invalid_param', { param: 'item' });
  return {};
}

/** bearcase.request: Ask your AI agent for the bear case of an item (risks and contrary evidence, cited, no recommendation; trigger bear_case). */
function bearRequest(ctx, p) {
  const util = u();
  const app = ctx.app;
  const it = C().itemRef(ctx, util.req(p, 'item'));
  bearCheck(ctx, it);
  const dm = C().dealMini(app, it.getString('deal'));
  const r = L('lib_agent').requestFor(ctx, 'bear_case', it, {}, { again: util.str(p, 'again', '') });
  L('lib_audit').write(ctx, { op: 'bearcase.request', collection: 'agenda_items', record: it.id, summary: 'Asked your AI agent for the bear case of ' + (dm ? dm.title : 'an item') });
  ctx.audited = true;
  return { request: r.request, ask: L('lib_agent').track(app.findRecordById('agenda_items', it.id), 'bear_case', ['Asked', 'Ready']), item: it.id };
}

/** bearcase.save: the bear case points (risks and contrary evidence, each cited; no recommendation). */
function bearSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  if (!ctx.isAgent) L('lib_auth').need(ctx, 'committee', 'edit', 'write a bear case');
  const it = C().itemRef(ctx, util.req(p, 'item'));
  if (it.getString('deal') === '') throw util.fail(400, 'A bear case needs a deal on the item.', 'invalid_param', { param: 'item' });
  const raw = util.list(p, 'points');
  if (raw === undefined || raw.length === 0) throw util.fail(400, 'points is a JSON list: [{"kind":"risk","text":"...","citations":[...]}, {"kind":"contrary","text":"..."}].', 'missing_param', { param: 'points' });
  if (raw.length > 15) throw util.fail(400, 'At most 15 points.', 'invalid_param', { param: 'points' });
  const M = L('lib_committee_memos');
  const points = raw.map((x, i) => {
    util.keysOnly(x, ['kind', 'text', 'citations'], 'Point ' + (i + 1));
    const kind = String(x.kind || '');
    if (kind !== 'risk' && kind !== 'contrary') throw util.fail(400, 'Point ' + (i + 1) + ': kind is risk or contrary.', 'invalid_param', { param: 'points' });
    const text = util.squash(String(x.text || ''));
    if (text === '' || text.length > 600) throw util.fail(400, 'Point ' + (i + 1) + ': text is 1 to 600 characters.', 'invalid_param', { param: 'points' });
    const citations = M.cleanCitations(ctx, it.getString('deal'), Array.isArray(x.citations) ? x.citations : []);
    M.checkMarkers(text, citations);
    return { kind: kind, text: text, citations: citations };
  });
  it.set('bearcase', { points: points });
  it.set('bearcase_at', util.nowIso());
  it.set('bearcase_by', ctx.isAgent ? 'agent' : 'person');
  L('lib_records').stampWritten(ctx, it);
  app.save(it);
  if (ctx.isAgent) L('lib_agent').landed(app, 'bear_case', it);
  L('lib_audit').note(ctx, { collection: 'agenda_items', record: it.id, summary: (ctx.isAgent ? 'Your AI agent wrote' : 'Wrote') + ' the bear case of ' + C().itemOut(ctx, it, { votes: false }).title + ' (' + points.length + ' points)' });
  const view = C().itemOut(ctx, it, { votes: false });
  return { item: it.id, bearcase: { points: points.map((pt) => Object.assign({}, pt, { citations: M.citationsOut(ctx, it.getString('deal'), pt.citations) })) }, title: view.title };
}

module.exports = { bearCheck: bearCheck, list: list, get: get, create: create, save: save, agenda: agenda, addItem: addItem, addItemPreview: addItemPreview, removeItem: removeItem, itemSave: itemSave, start: start, close: close, bearRequest: bearRequest, bearSave: bearSave };
