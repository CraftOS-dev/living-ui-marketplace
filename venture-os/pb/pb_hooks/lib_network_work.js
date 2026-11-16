/// <reference path="../pb_data/types.d.ts" />
/**
 * Network work: intros, meeting briefs, the calendar's ops and Next items.
 *
 * Intros (REPORT Table 22): a person picks a path to a target (network.paths)
 * and asks; the app records the intro and fires trigger intro_draft
 * { intro_id }; your AI agent drafts the ask (to the connector, or to the member who knows the
 * target, or to the target when the asker knows them) with a forwardable
 * blurb as an outbound draft (kind intro) that the asker approves in Next;
 * sending is the kernel's outbound. Steps: Asked, Drafted, Sent, then the
 * outcome a person records (Made, Declined, Unanswered).
 *
 * Briefs (REPORT Table 23): trigger meeting_brief { event_id } when a person
 * asks, or 18 hours before an external meeting while the firm's
 * meeting_briefs switch is on (capture's calendar run); your AI agent writes
 * the sections (who they are, history with the firm, the deal and its stage,
 * open questions, recent news with links) through briefs.save. Numbers in
 * a brief (relationship strength, stage, days) come from the app, never
 * from the text. Steps: Queued, Reading, Ready. Company research is trigger
 * company_research { company_id } (Ask your AI agent on a company).
 *
 * Next: `note` for an external meeting that ended without a note (Add
 * note opens the deal's note, No note). Intro drafts are the kernel's outbound
 * items.
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
  return L('lib_network');
}

const OPEN_INTRO = ['requested', 'drafted'];
const OUTCOMES = ['made', 'declined', 'no_answer'];
const INTRO_STATUSES = ['requested', 'drafted', 'sent', 'failed', 'made', 'declined', 'no_answer', 'cancelled'];
const NOTE_DAYS = 7;

/* --------------------------------------------------------------- steps */

function introSteps(status) {
  if (status === 'cancelled') return { labels: ['Asked', 'Cancelled'], at: 1 };
  if (status === 'failed') return { labels: ['Asked', 'Drafted', 'Failed'], at: 2 };
  if (status === 'declined') return { labels: ['Asked', 'Drafted', 'Sent', 'Declined'], at: 3 };
  if (status === 'no_answer') return { labels: ['Asked', 'Drafted', 'Sent', 'Unanswered'], at: 3 };
  const at = { requested: 0, drafted: 1, sent: 2, made: 3 }[status];
  return { labels: ['Asked', 'Drafted', 'Sent', 'Made'], at: at === undefined ? 0 : at };
}

const BRIEF_LABELS = ['Queued', 'Reading', 'Ready'];

/**
 * A brief's state: queued (asked of your AI agent), reading (your AI agent
 * writes it itself), ready, or failed (your AI agent could not, or nobody
 * picked the ask up in 24 hours: Retry asks again). The meeting keeps the
 * request (its `agent`, trigger meeting_brief).
 */
function liveBrief(app, b) {
  const A = L('lib_agent');
  let state = b.getString('state');
  let error = b.getString('error');
  const ev = b.getString('cal_event') !== '' ? u().byId(app, 'cal_events', b.getString('cal_event')) : null;
  const e = ev !== null ? A.state(ev, 'meeting_brief') : null;
  if (state === 'queued') {
    const since = Date.parse(b.getString('updated').replace(' ', 'T'));
    if (e !== null && e.error) {
      state = 'failed';
      error = e.error;
    } else if (e !== null ? !e.done_at && !A.pending(ev, 'meeting_brief') : Number.isFinite(since) && Date.now() - since > A.DAY_MS) {
      state = 'failed';
      error = "Your AI agent hasn't picked this up.";
    }
  }
  const at = state === 'ready' ? 2 : state === 'reading' ? 1 : 0;
  return { id: b.id, state: state, error: state === 'failed' ? error : '', steps: { labels: BRIEF_LABELS, at: at }, prepared_at: b.getString('prepared_at'), request: e !== null ? e.request : '' };
}

/** The brief of a calendar event: { id, state, steps } or null. */
function briefState(app, calEventId) {
  const b = u().findOne(app, 'briefs', 'cal_event = {:e}', { e: calEventId });
  return b === null ? null : liveBrief(app, b);
}

/* -------------------------------------------------------------- asking */

/**
 * The brief row of a meeting for a new ask: state queued (a person or the
 * meeting_briefs switch asked your AI agent) or reading (your AI agent
 * writes it itself). Answers the brief record.
 */
function briefRow(app, ev, state, by) {
  const util = u();
  let b = util.findOne(app, 'briefs', 'cal_event = {:e}', { e: ev.id });
  const atts = util.jsonOf(ev, 'attendees', []) || [];
  const ext = atts.filter((a) => a.external);
  if (b === null) {
    b = util.newRecord(app, 'briefs');
    b.set('cal_event', ev.id);
  }
  b.set('company', ev.getString('company'));
  b.set('deal', ev.getString('deal'));
  b.set('person', ext.length > 0 && ext[0].person ? ext[0].person : '');
  b.set('state', state);
  b.set('error', '');
  b.set('requested_by', by || '');
  b.set('actor', by ? 'person' : state === 'queued' ? 'system' : 'agent');
  b.set('member', by || '');
  app.save(b);
  return b;
}

/** The meeting brief the meeting_briefs switch asks for (capture's calendar run): the brief row, then the ask. Answers the request id or ''. */
function autoBrief(app, ev) {
  if (L('lib_mail').demo(app) || !L('lib_agent').policyOn(app, 'meeting_briefs')) return '';
  briefRow(app, ev, 'queued', '');
  return L('lib_agent').ask(app, 'meeting_brief', ev, {}, { policy: true });
}

/** agent.ask --trigger meeting_brief --record <cal event>: an external meeting the person may see. */
function briefCheck(ctx, ev) {
  const util = u();
  if (!N().seesEvent(ctx, ev)) throw util.fail(404, 'No meeting ' + ev.id + ' you can see.', 'not_found');
  if (!ev.getBool('external')) throw util.fail(409, 'This meeting has nobody from outside the firm; briefs are for external meetings.', 'internal_meeting');
  return {};
}

/** After a person's agent.ask fired: the meeting's brief waits for your AI agent. */
function onBriefAsked(ctx, ev) {
  briefRow(ctx.app, ev, 'queued', ctx.memberId || '');
}

/** agent.cannot on a brief: it shows failed with the reason (Retry asks again). */
function onBriefCannot(ctx, ev, reason) {
  const b = u().findOne(ctx.app, 'briefs', 'cal_event = {:e}', { e: ev.id });
  if (b === null || b.getString('state') === 'ready') return;
  b.set('state', 'failed');
  b.set('error', u().clip(String(reason || ''), 600));
  ctx.app.save(b);
}

/** The deal of a meeting (a restricted deal your AI agent may not work on refuses the ask). */
function eventDeal(app, ev) {
  return ev.getString('deal');
}

/** agent.ask --trigger company_research --record <company>: a company the person may see. */
function researchCheck(ctx, c) {
  if (c.getString('deleted_at') !== '') throw u().fail(404, 'No company ' + c.id + '.', 'not_found');
  return {};
}

/** The open deal of a company, or '' (a restricted deal your AI agent may not work on refuses the ask). */
function researchDeal(app, c) {
  const d = u().findMany(app, 'deals', "company = {:c} && status = 'open' && deleted_at = ''", '-created', 1, { c: c.id })[0];
  return d ? d.id : '';
}

/** The deal of an intro, or ''. */
function introDeal(app, r) {
  return r.getString('deal');
}

/** agent.cannot on an intro draft: the intro shows failed (Ask again, or a person writes it). */
function onIntroCannot(ctx, r) {
  const fresh = u().byId(ctx.app, 'intros', r.id);
  if (fresh === null || fresh.getString('status') !== 'requested') return;
  fresh.set('status', 'failed');
  ctx.app.save(fresh);
}

/** agent.ask --trigger intro_draft --record <intro>: an intro asked but not drafted yet (or one that failed). */
function introCheck(ctx, r) {
  const st = r.getString('status');
  if (st !== 'requested' && st !== 'failed') throw u().fail(409, 'This intro is ' + st + '; your AI agent drafts an intro only while it waits for its draft.', 'conflict');
  return {};
}

/** After a person's agent.ask on a failed intro: it waits for its draft again. */
function onIntroAsked(ctx, r) {
  const fresh = ctx.app.findRecordById('intros', r.id);
  if (fresh.getString('status') === 'failed') {
    fresh.set('status', 'requested');
    ctx.app.save(fresh);
  }
}

/* --------------------------------------------------------------- intros */

function introOut(ctx, r) {
  const app = ctx.app;
  const util = u();
  const recs = L('lib_records');
  const mm = N().memberNames(app);
  const cache = {};
  const ob = r.getString('outbound') !== '' ? util.byId(app, 'outbound', r.getString('outbound')) : null;
  const dm = N().dealMini(ctx, r.getString('deal'));
  const status = r.getString('status');
  return {
    id: r.id,
    status: status,
    steps: introSteps(status),
    target: N().personMini(app, r.getString('target'), cache),
    target_company: r.getString('target_company') !== '' ? recs.mini(app, 'companies', r.getString('target_company')) : null,
    via: mm[r.getString('via')] || null,
    connector: r.getString('connector') !== '' ? N().personMini(app, r.getString('connector'), cache) : null,
    path_kind: r.getString('path_kind'),
    path: util.jsonOf(r, 'path', {}) || {},
    requested_by: mm[r.getString('requested_by')] || null,
    deal: dm.deal,
    note: r.getString('note'),
    to_email: r.getString('to_email'),
    outbound: ob === null ? null : { id: ob.id, status: ob.getString('status'), subject: ob.getString('subject') },
    agent: L('lib_agent').view(r, ['intro_draft']),
    created: r.getString('created'),
    drafted_at: r.getString('drafted_at'),
    sent_at: r.getString('sent_at'),
    outcome: OUTCOMES.indexOf(status) >= 0 ? status : '',
    outcome_at: r.getString('outcome_at'),
  };
}

function introRef(ctx, id) {
  const r = u().byId(ctx.app, 'intros', String(id || ''));
  if (r === null) throw u().fail(404, 'No intro ' + id + '. Run intros.list.', 'not_found');
  if (r.getString('deal') !== '' && !L('lib_auth').dealVisible(ctx, r.getString('deal'))) throw u().fail(404, 'No intro ' + id + ' you can see.', 'not_found');
  return r;
}

/** Intros to a person or a company's people (for the paths panel and the record pages). */
function introsFor(ctx, o) {
  const util = u();
  let rows;
  if (o.person) rows = util.findMany(ctx.app, 'intros', 'target = {:p} || connector = {:p}', '-created', 50, { p: o.person });
  else rows = util.findMany(ctx.app, 'intros', 'target_company = {:c}', '-created', 50, { c: o.company });
  return rows.filter((r) => r.getString('deal') === '' || L('lib_auth').dealVisible(ctx, r.getString('deal'))).map((r) => introOut(ctx, r));
}

/** intros.request: a person asks for an intro through one path; your AI agent drafts the ask. */
function opRequest(ctx, p) {
  const util = u();
  const app = ctx.app;
  const recs = L('lib_records');
  const target = recs.resolve(app, 'people', util.req(p, 'target'));
  const via = L('lib_auth').memberRef(app, util.req(p, 'via'));
  const connectorRef = util.str(p, 'connector', '');
  const connector = connectorRef !== '' ? recs.resolve(app, 'people', connectorRef) : null;
  // The path must be one the app ranks now (a path is never made up).
  const ranked = N().paths(ctx, { person: target.id });
  const match = ranked.filter((x) => x.member === via.id && (connector === null ? x.kind === 'direct' : x.connector === connector.id))[0];
  if (match === undefined) throw util.fail(409, 'That path is not one the firm has now. Pick one of network.paths --person ' + target.id + '.', 'path_gone', { paths: ranked.slice(0, 5).map((x) => ({ via: x.member, connector: x.connector })) });
  const open = util.findOne(app, 'intros', "target = {:t} && requested_by = {:m} && (status = 'requested' || status = 'drafted')", { t: target.id, m: ctx.memberId });
  if (open !== null) throw util.fail(409, (ctx.isAgent ? 'An intro to ' + recs.personName(target) + ' is already asked' : 'You already asked for an intro to ' + recs.personName(target)) + ' (intro ' + open.id + ').', 'already_asked', { intro: open.id });
  let to = '';
  if (connector !== null) to = connector.getString('email');
  else if (via.id !== ctx.memberId) to = via.getString('email');
  else to = target.getString('email');
  if (to === '') throw util.fail(409, 'No email address for ' + (connector !== null ? recs.personName(connector) : via.id !== ctx.memberId ? via.getString('name') : recs.personName(target)) + '; add it first.', 'no_email');
  let deal = '';
  const dealRef = util.str(p, 'deal', '');
  if (dealRef !== '') {
    const d = L('lib_deals').ref(app, dealRef);
    L('lib_deals').guard(ctx, d);
    deal = d.id;
  } else deal = N().dealOfCompany(app, target.getString('company'));
  if (deal !== '' && !L('lib_auth').dealVisible(ctx, deal)) deal = '';
  let company = target.getString('company');
  const companyRef = util.str(p, 'company', '');
  if (companyRef !== '') company = recs.resolve(app, 'companies', companyRef).id;
  const r = util.newRecord(app, 'intros');
  r.set('target', target.id);
  r.set('target_company', company);
  r.set('via', via.id);
  r.set('connector', connector !== null ? connector.id : '');
  r.set('path_kind', match.kind);
  r.set('path', { nodes: match.nodes, edges: match.edges, weakest: match.weakest, last_at: match.last_at });
  r.set('requested_by', ctx.memberId);
  r.set('deal', deal);
  r.set('note', util.text(p, 'note', 2000, ''));
  r.set('status', 'requested');
  r.set('to_email', to.toLowerCase());
  r.set('actor', 'person');
  r.set('member', ctx.memberId);
  app.save(r);
  // Your AI agent's call is checked here and stored as a proposal; the person who accepts it asks, and the draft follows.
  if (ctx.dryRun) return introOut(ctx, r);
  L('lib_agent').ask(app, 'intro_draft', r, {}, { by: ctx.memberId });
  L('lib_audit').note(ctx, { collection: 'intros', record: r.id, summary: 'Asked for an intro to ' + recs.personName(target) });
  return introOut(ctx, r);
}

/** The proposal of your AI agent's intros.request: who to meet, through whom (the path as the app ranks it now). */
function previewRequest(ctx, params) {
  const util = u();
  const app = ctx.app;
  const recs = L('lib_records');
  const P = L('lib_proposals');
  const target = recs.resolve(app, 'people', params.target);
  const via = L('lib_auth').memberRef(app, params.via);
  const connector = params.connector ? recs.resolve(app, 'people', params.connector) : null;
  const ranked = N().paths(ctx, { person: target.id });
  const match = ranked.filter((x) => x.member === via.id && (connector === null ? x.kind === 'direct' : x.connector === connector.id))[0];
  const fields = [P.line('Intro to', '', recs.personName(target), 'text', 'target'), P.line('Through', '', via.getString('name') + (connector !== null ? ', then ' + recs.personName(connector) : ' (knows them directly)'), 'text', 'via')];
  if (match !== undefined) fields.push(P.line('Path strength', '', String(match.weakest) + ' (weakest link, 0 to 100)', 'text', 'weakest'));
  const notes = [];
  if (params.note) notes.push(String(params.note));
  notes.push('Accepting asks for the intro as you; your AI agent then drafts the ask for you to approve.');
  return { label: 'Intro: ' + recs.personName(target) + ' through ' + (connector !== null ? recs.personName(connector) : via.getString('name')), target: 'people:' + target.id, fields: fields.filter((x) => x !== null), notes: notes, risk: 'low' };
}

/** intros.draft: the ask as an outbound draft (kind intro) the asker approves in Next. */
function opDraft(ctx, p) {
  const util = u();
  const app = ctx.app;
  const r = introRef(ctx, util.req(p, 'intro'));
  const st = r.getString('status');
  if (st !== 'requested' && st !== 'failed') {
    const ob = r.getString('outbound');
    throw util.fail(409, st === 'drafted' ? 'This intro already has a draft' + (ob !== '' ? ' (outbound ' + ob + '; change it with outbound.update --outbound ' + ob + ')' : '') + '.' : 'This intro is ' + st + '.', 'already_drafted', { outbound: ob });
  }
  const view = L('lib_outbound').draft(ctx, {
    kind: 'intro',
    module: 'network',
    to: [r.getString('to_email')],
    subject: util.req(p, 'subject'),
    body: typeof p.body === 'string' ? p.body : util.req(p, 'body'),
    ref_collection: 'intros',
    ref_id: r.id,
    deal: r.getString('deal'),
    approver: r.getString('requested_by'),
  });
  r.set('status', 'drafted');
  r.set('outbound', view.id);
  r.set('drafted_at', util.nowIso());
  app.save(r);
  if (ctx.isAgent) L('lib_agent').landed(app, 'intro_draft', r);
  L('lib_audit').note(ctx, { collection: 'intros', record: r.id, summary: (ctx.isAgent ? 'Your AI agent drafted' : 'Drafted') + ' the intro ask to ' + r.getString('to_email') });
  return Object.assign(introOut(ctx, r), { draft: view });
}

/** intros.outcome: a person records how the intro went. */
function opOutcome(ctx, p) {
  const util = u();
  const r = introRef(ctx, util.req(p, 'intro'));
  const outcome = util.oneOf(p, 'outcome', OUTCOMES, '');
  if (outcome === '') throw util.fail(400, 'outcome is one of: ' + OUTCOMES.join(', ') + '.', 'missing_param', { param: 'outcome' });
  const st = r.getString('status');
  if (st === 'requested' || st === 'cancelled') throw util.fail(409, 'This intro was not asked yet; record the outcome once the ask went out.', 'conflict');
  const before = st;
  r.set('status', outcome);
  r.set('outcome_at', util.nowIso());
  r.set('outcome_by', ctx.memberId);
  ctx.app.save(r);
  L('lib_audit').note(ctx, { collection: 'intros', record: r.id, summary: 'Intro to ' + N().personMini(ctx.app, r.getString('target'), {}).name + ': ' + outcome.replace('_', ' '), before: { status: before }, after: { status: outcome } });
  return introOut(ctx, r);
}

/** intros.cancel: drop an intro that was not sent (its draft goes too). */
function opCancel(ctx, p) {
  const util = u();
  const app = ctx.app;
  const r = introRef(ctx, util.req(p, 'intro'));
  const st = r.getString('status');
  if (['requested', 'drafted', 'failed'].indexOf(st) < 0) throw util.fail(409, 'This intro is ' + st + '; only an intro not yet sent can be cancelled.', 'conflict');
  if (r.getString('requested_by') !== ctx.memberId && !ctx.owner) L('lib_auth').need(ctx, 'network', 'full', 'cancel another person\'s intro');
  const ob = r.getString('outbound') !== '' ? util.byId(app, 'outbound', r.getString('outbound')) : null;
  if (ob !== null && ['draft', 'failed', 'approved'].indexOf(ob.getString('status')) >= 0) L('lib_outbound').cancel(ctx, ob.id);
  r.set('status', 'cancelled');
  app.save(r);
  L('lib_audit').note(ctx, { collection: 'intros', record: r.id, summary: 'Cancelled the intro to ' + N().personMini(app, r.getString('target'), {}).name });
  return introOut(ctx, r);
}

function opListIntros(ctx, p) {
  const util = u();
  const where = [];
  const bind = {};
  const recs = L('lib_records');
  const person = util.str(p, 'person', '');
  if (person !== '') {
    where.push('(target = {:p} || connector = {:p})');
    bind.p = recs.resolve(ctx.app, 'people', person).id;
  }
  const company = util.str(p, 'company', '');
  if (company !== '') {
    where.push('target_company = {:c}');
    bind.c = recs.resolve(ctx.app, 'companies', company).id;
  }
  const status = util.oneOf(p, 'status', INTRO_STATUSES.concat(['open', 'all']), 'all');
  if (status === 'open') where.push("(status = 'requested' || status = 'drafted' || status = 'sent')");
  else if (status !== 'all') {
    where.push('status = {:s}');
    bind.s = status;
  }
  if (util.bool(p, 'mine', false)) {
    where.push('requested_by = {:m}');
    bind.m = ctx.memberId || '-';
  }
  const pg = util.page(p, 50, 300);
  const all = util.findMany(ctx.app, 'intros', where.length > 0 ? where.join(' && ') : '1=1', '-created', pg.offset + pg.limit + 200, bind);
  const rows = all.filter((r) => r.getString('deal') === '' || L('lib_auth').dealVisible(ctx, r.getString('deal')));
  return { intros: rows.slice(pg.offset, pg.offset + pg.limit).map((r) => introOut(ctx, r)), total: rows.length, hidden: all.length - rows.length };
}

function opGetIntro(ctx, p) {
  return { intro: introOut(ctx, introRef(ctx, u().req(p, 'intro'))) };
}

/** outbound.sent / outbound.failed: an intro ask left (or bounced). */
function onOutbound(ctx, p) {
  if (!p || p.module !== 'network' || p.ref_collection !== 'intros' || !p.ref_id) return null;
  const app = ctx.app;
  const r = u().byId(app, 'intros', p.ref_id);
  if (r === null) return null;
  const ob = u().byId(app, 'outbound', p.outbound);
  const sent = ob !== null && ob.getString('status') === 'sent';
  if (r.getString('status') !== 'drafted' && r.getString('status') !== 'failed') return null;
  r.set('status', sent ? 'sent' : 'failed');
  if (sent) r.set('sent_at', u().nowIso());
  app.save(r);
  return { intro: r.id, status: r.getString('status') };
}

/* --------------------------------------------------------------- briefs */

function briefRef(ctx, p) {
  const util = u();
  const app = ctx.app;
  const id = util.str(p, 'brief', '');
  const ev = util.str(p, 'event', '');
  let b = null;
  if (id !== '') b = util.byId(app, 'briefs', id);
  else if (ev !== '') {
    const e = eventRef(ctx, ev);
    b = util.findOne(app, 'briefs', 'cal_event = {:e}', { e: e.id });
    if (b === null) throw util.fail(404, 'No brief for this meeting yet. Ask for one with briefs.request --event ' + e.id + '.', 'no_brief', { event: e.id });
  } else throw util.fail(400, 'Give --brief or --event.', 'missing_param', { param: 'brief' });
  if (b === null) throw util.fail(404, 'No brief ' + id + '. Run briefs.list.', 'not_found');
  const e = b.getString('cal_event') !== '' ? util.byId(app, 'cal_events', b.getString('cal_event')) : null;
  if (e !== null && !N().seesEvent(ctx, e)) throw util.fail(404, 'No brief ' + b.id + ' you can see.', 'not_found');
  return b;
}

function eventRef(ctx, id) {
  const util = u();
  let e = util.byId(ctx.app, 'cal_events', String(id || ''));
  if (e === null) e = util.findOne(ctx.app, 'cal_events', 'ext_id = {:x}', { x: String(id || '') });
  if (e === null || !N().seesEvent(ctx, e)) throw util.fail(404, 'No meeting ' + id + ' you can see. Run calendar.list.', 'not_found');
  return e;
}

function sectionsOf(b) {
  const s = u().jsonOf(b, 'sections', {}) || {};
  return { who: Array.isArray(s.who) ? s.who : [], history: String(s.history || ''), deal: String(s.deal || ''), questions: Array.isArray(s.questions) ? s.questions : [], news: Array.isArray(s.news) ? s.news : [] };
}

/** A UTC instant as the firm's local day and time ({ day, time, weekday }), so nobody converts by hand (qa-cli CLI-15). */
function localOf(app, at) {
  const util = u();
  const ms = Date.parse(String(at || '').replace(' ', 'T'));
  if (!Number.isFinite(ms)) return null;
  const x = util.localAt(util.zoneOf(app), ms);
  return { day: x.day, time: x.time, weekday: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][x.weekday] };
}

function eventOut(ctx, e) {
  const app = ctx.app;
  const dm = N().dealMini(ctx, e.getString('deal'));
  const st = localOf(app, e.getString('start_at'));
  const en = localOf(app, e.getString('end_at'));
  return {
    id: e.id,
    title: e.getString('title'),
    start_at: e.getString('start_at'),
    end_at: e.getString('end_at'),
    local: st === null ? null : { day: st.day, weekday: st.weekday, start: st.time, end: en !== null ? en.time : '' },
    location: e.getString('location'),
    meet: e.getString('meet'),
    link: e.getString('link'),
    status: e.getString('status'),
    company: e.getString('company') !== '' ? L('lib_records').mini(app, 'companies', e.getString('company')) : null,
    deal: dm.deal,
    deal_hidden: dm.hidden,
    note_state: e.getString('note_state'),
    ended: e.getString('ended_at') !== '',
  };
}

/** A brief in full: the app's facts (attendees with relationship strength, the deal's stage) and the written sections. */
function briefOut(ctx, b) {
  const app = ctx.app;
  const util = u();
  const mm = N().memberNames(app);
  const e = b.getString('cal_event') !== '' ? util.byId(app, 'cal_events', b.getString('cal_event')) : null;
  const atts = e === null ? [] : util.jsonOf(e, 'attendees', []) || [];
  const live = liveBrief(app, b);
  const dm = N().dealMini(ctx, b.getString('deal'));
  const sections = sectionsOf(b);
  if (dm.hidden) sections.deal = '';
  return {
    id: b.id,
    state: live.state,
    steps: live.steps,
    error: live.error,
    event: e === null ? null : eventOut(ctx, e),
    company: b.getString('company') !== '' ? L('lib_records').mini(app, 'companies', b.getString('company')) : null,
    deal: dm.deal,
    deal_hidden: dm.hidden,
    attendees: atts.map((a) => {
      const s = a.person ? N().strengthOf(app, a.person) : null;
      return { name: a.name || a.email, email: a.email, person: a.person || null, member: a.member ? mm[a.member] || null : null, external: a.external === true, response: a.response || '', strength: s === null ? null : { score: s.score, band: L('lib_eng_strength').band(s.score), last_at: s.last_at, best_member: s.best_member ? mm[s.best_member] || null : null } };
    }),
    sections: sections,
    prepared_at: b.getString('prepared_at'),
    actor: b.getString('actor'),
    agent: b.getString('actor') === 'agent',
    request: live.request,
    ask: e !== null ? L('lib_agent').view(e, ['meeting_brief']).meeting_brief || null : null,
  };
}

function opGetBrief(ctx, p) {
  return { brief: briefOut(ctx, briefRef(ctx, p)) };
}

function opListBriefs(ctx, p) {
  const util = u();
  const app = ctx.app;
  const where = ["cal_event != ''"];
  const bind = {};
  const dealRef = util.str(p, 'deal', '');
  if (dealRef !== '') {
    const d = L('lib_deals').ref(app, dealRef);
    L('lib_deals').guard(ctx, d);
    where.push('deal = {:d}');
    bind.d = d.id;
  }
  const companyRef = util.str(p, 'company', '');
  if (companyRef !== '') {
    where.push('company = {:c}');
    bind.c = L('lib_records').resolve(app, 'companies', companyRef).id;
  }
  const scoped = dealRef !== '' || companyRef !== '';
  // A deal's or company's briefs: every meeting, the latest first; otherwise from yesterday, the soonest first.
  const from = util.str(p, 'from_at', '') || (scoped ? '' : new Date(Date.now() - 86400000).toISOString());
  const state = util.oneOf(p, 'state', ['queued', 'reading', 'ready', 'failed', 'all'], 'all');
  const out = [];
  let hidden = 0;
  for (const b of util.findMany(app, 'briefs', where.join(' && '), '-created', 500, bind)) {
    const e = util.byId(app, 'cal_events', b.getString('cal_event'));
    if (e === null || (from !== '' && e.getString('start_at') < from)) continue;
    if (!N().seesEvent(ctx, e) || (b.getString('deal') !== '' && !L('lib_auth').dealVisible(ctx, b.getString('deal')))) {
      hidden++;
      continue;
    }
    const live = liveBrief(app, b);
    if (state !== 'all' && live.state !== state) continue;
    out.push({ id: b.id, state: live.state, steps: live.steps, event: eventOut(ctx, e), prepared_at: b.getString('prepared_at'), agent: b.getString('actor') === 'agent' });
  }
  out.sort((a, b) => (scoped ? (a.event.start_at < b.event.start_at ? 1 : -1) : a.event.start_at < b.event.start_at ? -1 : 1));
  return { briefs: out.slice(0, util.int(p, 'limit', 50, 1, 300)), hidden: hidden };
}

/** briefs.request: a brief for a meeting now (a brief that is ready is answered as it is; a failed one is asked again). Your AI agent asking gets the brief to write itself. */
function opRequestBrief(ctx, p) {
  const util = u();
  const e = eventRef(ctx, util.req(p, 'event'));
  if (!e.getBool('external')) throw util.fail(409, 'This meeting has nobody from outside the firm; briefs are for external meetings.', 'internal_meeting');
  const b = util.findOne(ctx.app, 'briefs', 'cal_event = {:e}', { e: e.id });
  if (b !== null) {
    const live = liveBrief(ctx.app, b);
    // Your AI agent starts the brief it was asked for: the person sees Reading.
    if (ctx.isAgent && live.state === 'queued') {
      b.set('state', 'reading');
      ctx.app.save(b);
      return { brief: briefOut(ctx, b), queued: false, next: 'Write it now: briefs.save --brief ' + b.id + ' --sections \'{...}\' (app.guide --recipe meeting_brief).' };
    }
    if (live.state !== 'failed' && !util.bool(p, 'again', false)) return { brief: briefOut(ctx, b), queued: false };
  }
  if (ctx.isAgent) {
    const nb = briefRow(ctx.app, e, 'reading', '');
    return { brief: briefOut(ctx, nb), queued: false, next: 'Write it now: briefs.save --brief ' + nb.id + ' --sections \'{...}\' (app.guide --recipe meeting_brief).' };
  }
  const r = L('lib_agent').requestFor(ctx, 'meeting_brief', e, {}, { again: util.str(p, 'request', '') });
  const nb = briefRow(ctx.app, e, 'queued', ctx.memberId || '');
  L('lib_audit').note(ctx, { collection: 'briefs', record: nb.id, summary: 'Asked for a brief: ' + e.getString('title') });
  return { brief: briefOut(ctx, nb), queued: true, request: r.request };
}

function cleanText(v, max, name) {
  const util = u();
  const s = String(v === undefined || v === null ? '' : v).trim();
  if (s.length > max) throw util.fail(400, name + ' is too long (at most ' + max + ' characters).', 'invalid_param', { param: 'sections' });
  return s;
}

/** briefs.save: write a brief's sections (your AI agent for the meeting_brief it was asked, or a person by hand; your AI agent's save marks the ask done). */
function opSaveBrief(ctx, p) {
  const util = u();
  const app = ctx.app;
  // Your AI agent writing the brief of a meeting it was asked about makes the row when there is none yet.
  const evRef = util.str(p, 'event', '');
  const b = ctx.isAgent && util.str(p, 'brief', '') === '' && evRef !== '' && util.findOne(app, 'briefs', 'cal_event = {:e}', { e: eventRef(ctx, evRef).id }) === null ? briefRow(app, eventRef(ctx, evRef), 'reading', '') : briefRef(ctx, p);
  const raw = util.obj(p, 'sections');
  if (raw === undefined) throw util.fail(400, 'sections is required: {"who":[{"name","email","text"}],"history":"...","deal":"...","questions":["..."],"news":[{"title","url","day"}]}', 'missing_param', { param: 'sections' });
  util.keysOnly(raw, ['who', 'history', 'deal', 'questions', 'news'], 'sections');
  if (ctx.isAgent && b.getString('state') === 'ready' && b.getString('actor') === 'person') throw util.fail(409, 'A person wrote this brief; leave it as it is.', 'written_by_person');
  const who = (Array.isArray(raw.who) ? raw.who : []).slice(0, 20).map((w, i) => {
    util.keysOnly(w, ['name', 'email', 'person', 'text'], 'sections.who[' + i + ']');
    return { name: cleanText(w.name, 160, 'who.name'), email: cleanText(w.email, 254, 'who.email').toLowerCase(), person: cleanText(w.person, 30, 'who.person'), text: cleanText(w.text, 2000, 'who.text') };
  });
  const questions = (Array.isArray(raw.questions) ? raw.questions : []).slice(0, 12).map((q) => cleanText(q, 400, 'questions'));
  const news = (Array.isArray(raw.news) ? raw.news : []).slice(0, 12).map((n, i) => {
    util.keysOnly(n, ['title', 'url', 'day', 'source'], 'sections.news[' + i + ']');
    const url = cleanText(n.url, 1000, 'news.url');
    if (!/^https?:\/\/[^\s]+$/.test(url)) throw util.fail(400, 'sections.news[' + i + '].url must be a web link (https://...); news without a link is left out.', 'invalid_param', { param: 'sections' });
    const day = cleanText(n.day, 10, 'news.day');
    if (day !== '' && !util.isDay(day)) throw util.fail(400, 'sections.news[' + i + '].day is YYYY-MM-DD.', 'invalid_param', { param: 'sections' });
    return { title: cleanText(n.title, 300, 'news.title'), url: url, day: day, source: cleanText(n.source, 120, 'news.source') };
  });
  const sections = { who: who, history: cleanText(raw.history, 4000, 'history'), deal: cleanText(raw.deal, 4000, 'deal'), questions: questions, news: news };
  if (who.length === 0 && sections.history === '' && sections.deal === '' && questions.length === 0 && news.length === 0) throw util.fail(400, 'sections is empty.', 'invalid_param', { param: 'sections' });
  b.set('sections', sections);
  b.set('state', 'ready');
  b.set('error', '');
  b.set('prepared_at', util.nowIso());
  b.set('actor', ctx.isAgent ? 'agent' : 'person');
  b.set('member', ctx.memberId || '');
  b.set('run', ctx.isAgent ? ctx.run || '' : '');
  app.save(b);
  // The brief is written (by your AI agent or by hand): the meeting's ask is answered.
  if (b.getString('cal_event') !== '') L('lib_agent').landed(app, 'meeting_brief', app.findRecordById('cal_events', b.getString('cal_event')));
  L('lib_audit').note(ctx, { collection: 'briefs', record: b.id, summary: (ctx.isAgent ? 'Your AI agent wrote' : 'Wrote') + ' the brief' });
  return { brief: briefOut(ctx, b) };
}

/* ------------------------------------------------------------- calendar */

/** calendar.list: the caller's meetings in a window (default today), with each brief's state. */
function opCalendar(ctx, p) {
  const util = u();
  const app = ctx.app;
  const day = util.day(p, 'day', util.today(app));
  const days = util.int(p, 'days', 1, 1, 14);
  const from = util.atOf(app, day, '00:00');
  const to = util.atOf(app, util.dayAdd(day, days), '00:00');
  const all = util.bool(p, 'all', false);
  const rows = util.findMany(app, 'cal_events', "status != 'gone' && end_at >= {:a} && start_at < {:b}" + (all ? '' : ' && external = true'), 'start_at', 300, { a: from, b: to });
  const out = [];
  for (const e of rows) {
    if (!N().attends(ctx, e)) continue;
    const atts = util.jsonOf(e, 'attendees', []) || [];
    out.push(Object.assign(eventOut(ctx, e), { external: e.getBool('external'), attendees: atts.map((a) => ({ name: a.name || a.email, email: a.email, person: a.person || null, member: a.member || null, external: a.external === true, response: a.response || '' })), brief: briefState(app, e.id) }));
  }
  const src = util.findOne(app, 'capture_state', "kind = 'source' && source = 'calendar'", {});
  return { day: day, days: days, zone: util.zoneOf(app), events: out, calendar: src === null ? 'never' : src.getString('state'), synced_at: src === null ? '' : src.getString('last_ok_at') };
}

/** Has a note been written for this meeting (its deal's note for the event, or a note since it started)? */
function noted(app, e) {
  const deal = e.getString('deal');
  if (deal === '') return false;
  const start = e.getString('start_at');
  for (const n of L('lib_deals_notes').forDeal(app, deal) || []) {
    if (n.empty === true) continue;
    if (n.cal_event === e.id || String(n.created || '').replace(' ', 'T') >= start) return true;
  }
  return false;
}

function noteHref(app, e) {
  const deal = e.getString('deal');
  if (deal !== '') {
    const d = u().byId(app, 'deals', deal);
    if (d !== null) return '#/deals/' + d.getString('number') + '?tab=notes&event=' + e.id;
  }
  if (e.getString('company') !== '') return '#/companies/' + e.getString('company') + '?tab=notes&event=' + e.id;
  return '#/network';
}

/** calendar.add-note: open the meeting's note (the deal's, else the company's); the Next item goes. */
function opAddNote(ctx, p) {
  const e = eventRef(ctx, u().req(p, 'event'));
  e.set('note_state', 'opened');
  ctx.app.save(e);
  L('lib_audit').note(ctx, { collection: 'cal_events', record: e.id, summary: 'Opened the note of ' + e.getString('title') });
  return { event: e.id, href: noteHref(ctx.app, e), deal: e.getString('deal'), company: e.getString('company') };
}

/** calendar.skip-note: no note for this meeting. */
function opSkipNote(ctx, p) {
  const e = eventRef(ctx, u().req(p, 'event'));
  e.set('note_state', 'skipped');
  ctx.app.save(e);
  L('lib_audit').note(ctx, { collection: 'cal_events', record: e.id, summary: 'No note for ' + e.getString('title') });
  return { event: e.id, note_state: 'skipped' };
}

/* ----------------------------------------------------------------- Next */

/** Next items: external meetings I attended that ended in the last week without a note. */
function needsYou(ctx) {
  const util = u();
  if (ctx.isAgent || !ctx.memberId) return [];
  const app = ctx.app;
  const since = new Date(Date.now() - NOTE_DAYS * 86400000).toISOString();
  const zone = util.zoneOf(app);
  const out = [];
  for (const e of util.findMany(app, 'cal_events', "external = true && ended_at != '' && note_state = 'none' && end_at >= {:s} && attendees ~ {:m}", '-end_at', 50, { s: since, m: '"' + ctx.memberId + '"' })) {
    const atts = util.jsonOf(e, 'attendees', []) || [];
    if (!atts.some((a) => a.member === ctx.memberId && a.response !== 'declined')) continue;
    if (noted(app, e)) continue;
    const dm = N().dealMini(ctx, e.getString('deal'));
    const company = e.getString('company') !== '' ? L('lib_records').mini(app, 'companies', e.getString('company')) : null;
    const ext = atts.filter((a) => a.external).map((a) => a.name || a.email);
    const end = util.localAt(zone, Date.parse(e.getString('end_at')));
    out.push({
      key: 'network:note:' + e.id,
      kind: 'note',
      title: e.getString('title'),
      figures: [
        { label: 'Ended', value: (end.day === util.today(app) ? '' : end.day.slice(5) + ' ') + end.time },
        { label: 'With', value: ext.slice(0, 2).join(', ') + (ext.length > 2 ? ' +' + (ext.length - 2) : '') },
      ],
      chips: (company ? [{ label: company.name, tone: 'neutral' }] : []).concat(dm.deal ? [{ label: dm.deal.stage_label, tone: 'neutral' }] : []),
      agent: false,
      rank: 60,
      at: e.getString('end_at'),
      href: noteHref(app, e),
      data: { event: e.id, title: e.getString('title'), deal: dm.deal, company: company, attendees: ext },
      actions: [
        { label: 'Add note', op: 'calendar.add-note', params: { event: e.id }, primary: true },
        { label: 'No note', op: 'calendar.skip-note', params: { event: e.id } },
      ],
    });
  }
  return out;
}

/* ------------------------------------------------------------- timeline */

/** Timeline items of intros (a person, a company) and briefs (a company, a deal). */
function timelineItems(ctx, t) {
  const util = u();
  const app = ctx.app;
  const out = [];
  if (t.kind === 'person' || t.kind === 'company') {
    const rows = t.kind === 'person' ? util.findMany(app, 'intros', 'target = {:x} || connector = {:x}', '-created', 50, { x: t.id }) : util.findMany(app, 'intros', 'target_company = {:x}', '-created', 50, { x: t.id });
    for (const r of rows) {
      if (r.getString('deal') !== '' && !L('lib_auth').dealVisible(ctx, r.getString('deal'))) continue;
      const tg = N().personMini(app, r.getString('target'), {});
      out.push({ at: r.getString('created'), kind: 'intro', title: 'Intro asked: ' + tg.name + (r.getString('status') !== 'requested' ? ' (' + r.getString('status').replace('_', ' ') + ')' : ''), icon: 'Waypoints', href: '#/people/' + tg.id, ref: { collection: 'intros', id: r.id } });
    }
  }
  if (t.kind === 'company' || t.kind === 'deal') {
    for (const b of util.findMany(app, 'briefs', (t.kind === 'company' ? 'company' : 'deal') + " = {:x} && state = 'ready'", '-prepared_at', 30, { x: t.id })) {
      const e = b.getString('cal_event') !== '' ? util.byId(app, 'cal_events', b.getString('cal_event')) : null;
      if (e !== null && !N().seesEvent(ctx, e)) continue;
      out.push({ at: b.getString('prepared_at'), kind: 'brief', title: 'Brief ready' + (e !== null ? ': ' + e.getString('title') : ''), icon: 'FileText', actor: b.getString('actor'), ref: { collection: 'briefs', id: b.id } });
    }
  }
  return out;
}

module.exports = {
  OUTCOMES: OUTCOMES,
  introSteps: introSteps,
  liveBrief: liveBrief,
  briefState: briefState,
  briefRow: briefRow,
  autoBrief: autoBrief,
  briefCheck: briefCheck,
  onBriefAsked: onBriefAsked,
  onBriefCannot: onBriefCannot,
  eventDeal: eventDeal,
  researchCheck: researchCheck,
  researchDeal: researchDeal,
  introDeal: introDeal,
  introCheck: introCheck,
  onIntroAsked: onIntroAsked,
  onIntroCannot: onIntroCannot,
  introsFor: introsFor,
  opRequest: opRequest,
  previewRequest: previewRequest,
  opDraft: opDraft,
  opOutcome: opOutcome,
  opCancel: opCancel,
  opListIntros: opListIntros,
  opGetIntro: opGetIntro,
  onOutbound: onOutbound,
  opGetBrief: opGetBrief,
  opListBriefs: opListBriefs,
  opRequestBrief: opRequestBrief,
  opSaveBrief: opSaveBrief,
  opCalendar: opCalendar,
  opAddNote: opAddNote,
  opSkipNote: opSkipNote,
  needsYou: needsYou,
  timelineItems: timelineItems,
};
