/// <reference path="../pb_data/types.d.ts" />
/**
 * The agent's side of the board: a work queue with leases.
 *
 *   work.queue    how much work waits for the agent (what a trigger run
 *                 goes through)
 *   work.next     claim ONE card, atomically: the card, the board's
 *                 how-we-work, the column's instructions and anything the
 *                 person said since
 *   work.heartbeat  keep the lease (and say what you are doing)
 *   work.log / work.plan   activity and the plan, shown live on the card
 *   work.ask      one question to the person; the card waits on them
 *   work.submit   the result with evidence: the card moves on (review for
 *                 the person, or the next column the agent works)
 *   work.return / work.fail / work.release   end a claim another way
 *   work.resume   take over a card whose session ended without finishing it
 *                 (no heartbeat for 1.5 heartbeat intervals); a card another
 *                 session is still working is refused
 *
 * Leases: a claim holds the card for the column's lease minutes; a heartbeat
 * renews it. An expired lease puts the card back in the queue and counts an
 * attempt; after the column's max attempts the card needs attention and the
 * agent leaves it until the person retries or reassigns it. The agent never
 * moves a card to Done and never decides a review.
 *
 * Several agent sessions may work at once (one per trigger fire), up to the
 * person's limit in settings.max_working; each holds its own cards.
 *
 * Waking the agent: when a card is queued, the `work_waiting` trigger fires
 * (once for any amount of work; its cooldown and the minute cron catch up).
 */

const REMIND_MINUTES = 10;
const MAX_HANDOFFS = 3;
const QUESTION_CAP = 4;
const ACTIVE_MS = 90000;

function U() {
  return require(`${__hooks}/lib_util.js`);
}
function M() {
  return require(`${__hooks}/lib_model.js`);
}
function C() {
  return require(`${__hooks}/lib_cards.js`);
}

/* --------------------------------------------------------------- waking */

function markDirty(app) {
  app.store().set('kb_work_dirty', true);
}

/** Fire `work_waiting` when queued work exists that the agent was not yet told about. */
function fireIfNeeded(app) {
  const u = U();
  const m = M();
  if (app.store().get('kb_work_boot') !== true) {
    app.store().set('kb_work_boot', true);
    app.store().set('kb_work_dirty', true);
  }
  if (app.store().get('kb_work_dirty') !== true) return { fired: false, reason: 'idle' };
  if (m.settings(app).getBool('paused')) return { fired: false, reason: 'agent paused' };
  // The agent called within the last 90 s: it is mid-session and loops work.next itself.
  // The work stays marked, so the minute cron wakes it if it goes quiet with work waiting.
  if (Date.now() - Number(app.store().get('kb_agent_seen') || 0) < ACTIVE_MS) return { fired: false, reason: 'agent active' };
  const waiting = queueCounts(app);
  if (waiting.total === 0) {
    app.store().set('kb_work_dirty', false);
    return { fired: false, reason: 'nothing waiting' };
  }
  const last = Number(app.store().get('kb_work_fired_at') || 0);
  const newest = waiting.newest;
  // Already told about all of it: only remind after a while if it is still waiting.
  if (last > 0 && newest <= last && Date.now() - last < REMIND_MINUTES * 60000) return { fired: false, reason: 'already asked' };
  const trig = require(`${__hooks}/_triggers_lib.js`);
  const res = trig.fire(app, 'work_waiting', {}, 'hook');
  if (res && res.ok) {
    app.store().set('kb_work_fired_at', Date.now());
    app.store().set('kb_work_dirty', false);
    void u;
    return { fired: true, request: res.id };
  }
  return { fired: false, reason: (res && res.message) || 'refused' };
}

/* ------------------------------------------------------------ eligibility */

/** Can the agent take this queued card? Returns '' or the reason it cannot. */
function blocker(card, col) {
  const m = M();
  if (card.getString('agent_state') !== 'queued') return 'not queued';
  if (card.getBool('archived') || card.getBool('blocked') || card.getBool('proposed')) return 'unavailable';
  if (!col) return 'no column';
  if (m.CLOSED[col.getString('category')]) return 'finished';
  return '';
}

/** Queued cards, most urgent first (no priority last), then the longest waiting. */
function queuedCards(app) {
  const rows = app.findRecordsByFilter('cards', "agent_state = 'queued' && archived = false && blocked = false && proposed = false", 'column_at', 0, 0);
  const rank = (c) => c.getInt('priority') || 5;
  return rows.map((c, i) => ({ c: c, i: i })).sort((x, y) => rank(x.c) - rank(y.c) || x.i - y.i).map((x) => x.c);
}

/** Queued work the agent can take, per board. */
function queueCounts(app) {
  const u = U();
  const cols = {};
  const boards = {};
  const per = {};
  let newest = 0;
  let total = 0;
  for (const c of queuedCards(app)) {
    const b = c.getString('board');
    if (boards[b] === undefined) {
      const br = u.byId(app, 'boards', b);
      boards[b] = br !== null && !br.getBool('frozen') && !br.getBool('archived') ? br : null;
    }
    if (boards[b] === null) continue;
    const colId = c.getString('column');
    if (cols[colId] === undefined) cols[colId] = u.byId(app, 'columns', colId);
    if (blocker(c, cols[colId]) !== '') continue;
    per[b] = (per[b] || 0) + 1;
    total++;
    newest = Math.max(newest, u.ms(c.getString('updated')));
  }
  return { boards: boards, per: per, total: total, newest: newest };
}

function maxWorking(app) {
  return M().settings(app).getInt('max_working') || 2;
}

function workingCards(app) {
  return app.findRecordsByFilter('cards', "agent_state = 'working' && archived = false", 'lease_until', 0, 0);
}

function queue(app) {
  const m = M();
  if (m.settings(app).getBool('paused')) return { boards: [], total: 0, paused: true, message: 'The person paused the agent: do nothing now.' };
  const q = queueCounts(app);
  const working = workingCards(app).length;
  const limit = maxWorking(app);
  const boards = Object.keys(q.per).map((id) => ({ key: q.boards[id].getString('key'), name: q.boards[id].getString('name'), waiting: q.per[id] }));
  return {
    boards: boards,
    total: q.total,
    working: working,
    max_working: limit,
    next_step:
      q.total === 0
        ? 'Nothing is waiting.'
        : working >= limit
          ? 'The agent already works ' + working + ' card(s), the limit. Call work.next: it lists them and says which ones a session left behind, to take over with work.resume.'
          : 'agent-app run <project> work.next, do the card, finish it (work.submit / work.ask / work.return / work.fail), repeat until work.next gives no card.',
  };
}

/* ----------------------------------------------------------------- claim */

function leaseMinutes(col) {
  return (col && col.getInt('lease_minutes')) || 15;
}

function mustAgent(app, e, p) {
  const u = U();
  const w = M().who(app, e, p);
  if (w.kind !== 'agent') throw u.fail(403, 'The work.* operations are for the agent (the agent-app CLI). In the app, use the card\'s own actions.', { code: 'agent_only' });
  return w;
}

/** The card the agent holds, checked: still working, the run it names. */
function held(app, w, p) {
  const u = U();
  const card = M().mustCard(app, u.req(p, 'card', 'OPS-12'));
  if (card.getString('agent_state') !== 'working') {
    throw u.fail(409, 'You do not hold this card (it may have been stopped by the person, reassigned, or your lease expired). Call work.next for your next card.', { code: 'not_held' });
  }
  const run = u.str(p, 'run', '');
  if (run !== '' && run !== card.getString('run')) throw u.fail(409, 'That run is over: this card now belongs to run ' + card.getString('run') + '.', { code: 'stale_run' });
  return card;
}

function next(app, e, p) {
  const u = U();
  const m = M();
  const w = mustAgent(app, e, p);
  const none = (reason, extra) => Object.assign({ card: null, reason: reason, message: reason + '. Nothing to take now.' }, extra || {});
  if (m.settings(app).getBool('paused')) return none('The person paused the agent');
  // Sessions share one limit; a card someone else is on is never handed out twice.
  const holding = workingCards(app);
  const limit = maxWorking(app);
  if (holding.length >= limit) {
    const held = holding.map((c) => heldJson(app, c));
    const keys = held.map((h) => h.key);
    const stale = held.filter((h) => h.resumable).map((h) => h.key);
    return none('The agent already works ' + holding.length + ' card(s) (' + keys.join(', ') + '), the limit of ' + limit + ': finish one first', {
      working: keys,
      held: held,
      next_step: stale.length > 0 ? 'No other session has checked in on ' + stale.join(', ') + ' for a while: take one over with work.resume --card ' + stale[0] + ' and finish it.' : 'Other sessions are working on these cards. Stop now; you are woken again when there is room.',
    });
  }
  let boardFilter = '';
  if (u.has(p, 'board')) boardFilter = m.mustBoard(app, u.str(p, 'board', '')).id;
  const cols = {};
  const boards = {};
  for (const card of queuedCards(app)) {
    const b = card.getString('board');
    if (boardFilter !== '' && b !== boardFilter) continue;
    if (boards[b] === undefined) boards[b] = u.byId(app, 'boards', b);
    const board = boards[b];
    if (board === null || board.getBool('frozen') || board.getBool('archived')) continue;
    const colId = card.getString('column');
    if (cols[colId] === undefined) cols[colId] = u.byId(app, 'columns', colId);
    const col = cols[colId];
    if (blocker(card, col) !== '') continue;
    // Too many tries already: the person looks at it.
    const maxAttempts = (col && col.getInt('max_attempts')) || 3;
    if (card.getInt('attempt') >= maxAttempts) {
      card.set('agent_state', 'needs_attention');
      card.set('attention', 'The agent tried ' + card.getInt('attempt') + ' times without finishing.');
      app.save(card);
      continue;
    }
    // A card in to-do moves into the first started column when the agent takes it.
    let target = col;
    if ((col.getString('category') === 'todo' || col.getString('category') === 'backlog' || col.getString('category') === 'triage')) {
      const all = m.columnsOf(app, b);
      const nx = m.nextColumn(all, col);
      target = nx && nx.getString('category') === 'doing' ? nx : m.firstOf(all, ['doing']) || col;
      const wip = target.getInt('wip');
      if (target.id !== col.id && wip > 0 && m.cardsIn(app, target.id).length >= wip) continue;
      if (target.id !== col.id && target.getBool('need_criteria') && card.getString('acceptance').trim() === '') {
        // The stage it would enter needs acceptance criteria first.
        card.set('agent_state', 'needs_input');
        card.set('question', { kind: 'criteria', text: 'Add acceptance criteria so the agent can start: ' + target.getString('name') + ' needs them.', by: 'system', at: u.pbTime() });
        card.set('version', card.getInt('version') + 1);
        app.save(card);
        continue;
      }
    }
    // Claim atomically: a card another session took meanwhile is skipped.
    let claimed = null;
    app.runInTransaction((tx) => {
      const c = tx.findRecordById('cards', card.id);
      if (c.getString('agent_state') !== 'queued' || c.getInt('version') !== card.getInt('version')) return;
      const run = new Record(tx.findCollectionByNameOrId('runs'));
      run.set('card', c.id);
      run.set('board', b);
      run.set('column', target.id);
      run.set('attempt', c.getInt('attempt') + 1);
      run.set('started', u.pbTime());
      run.set('outcome', 'working');
      tx.save(run);
      c.set('agent_state', 'working');
      c.set('run', run.id);
      c.set('attempt', c.getInt('attempt') + 1);
      c.set('lease_until', u.pbTime(Date.now() + leaseMinutes(target) * 60000));
      c.set('progress', 'Starting');
      c.set('version', c.getInt('version') + 1);
      tx.save(c);
      claimed = c;
    });
    if (claimed === null) continue;
    m.log(app, { board: b, card: claimed.id, actor: w, kind: 'claimed', run: claimed.getString('run'), text: 'Started work', meta: { attempt: claimed.getInt('attempt') } });
    if (target.id !== col.id) C().place(app, w, claimed, target, { where: 'top', keepSession: true, noQueue: true, run: claimed.getString('run'), reason: 'Taken by the agent' });
    const fresh = app.findRecordById('cards', claimed.id);
    return payload(app, fresh);
  }
  return none('No card is waiting for the agent');
}

/** When a working card last heard from its session, and whether a new session may take it over. */
function heldJson(app, card) {
  const u = U();
  const b = u.byId(app, 'boards', card.getString('board'));
  const col = u.byId(app, 'columns', card.getString('column'));
  const lease = leaseMinutes(col);
  const every = Math.max(1, Math.floor(lease / 3));
  const lastBeat = u.ms(card.getString('lease_until')) - lease * 60000;
  const quiet = Math.max(0, Math.round((Date.now() - lastBeat) / 60000));
  return {
    key: b ? M().keyOf(b, card) : card.id,
    title: card.getString('title'),
    progress: card.getString('progress'),
    lease_until: card.getString('lease_until'),
    quiet_minutes: quiet,
    resumable: quiet >= every * 1.5,
  };
}

/** Take over a card whose session ended without finishing it: a new run on the same attempt. */
function resume(app, e, p) {
  const u = U();
  const m = M();
  const w = mustAgent(app, e, p);
  if (m.settings(app).getBool('paused')) throw u.fail(423, 'The person paused the agent. Stop and report what you were doing.', { code: 'agent_paused' });
  const card = m.mustCard(app, u.req(p, 'card', 'OPS-12'));
  if (card.getString('agent_state') !== 'working') throw u.fail(409, 'Nobody is working on this card, so there is nothing to take over: call work.next for work.', { code: 'not_working' });
  const board = u.byId(app, 'boards', card.getString('board'));
  m.agentMayWrite(app, w, board);
  const h = heldJson(app, card);
  if (!h.resumable) {
    throw u.fail(409, 'Another session checked in on ' + h.key + ' ' + h.quiet_minutes + ' min ago, so it is still being worked. Take other work with work.next, or stop.', { code: 'active', quiet_minutes: h.quiet_minutes });
  }
  const col = u.byId(app, 'columns', card.getString('column'));
  const oldRun = card.getString('run');
  C().endSession(app, card, 'released', 'Taken over by another session');
  const run = new Record(app.findCollectionByNameOrId('runs'));
  run.set('card', card.id);
  run.set('board', card.getString('board'));
  run.set('column', card.getString('column'));
  run.set('attempt', card.getInt('attempt'));
  run.set('started', u.pbTime());
  run.set('outcome', 'working');
  app.save(run);
  card.set('agent_state', 'working');
  card.set('run', run.id);
  card.set('lease_until', u.pbTime(Date.now() + leaseMinutes(col) * 60000));
  card.set('progress', 'Picked up again');
  card.set('version', card.getInt('version') + 1);
  app.save(card);
  m.log(app, { board: card.getString('board'), card: card.id, actor: w, kind: 'claimed', run: run.id, text: 'Took the card over from a session that went quiet', meta: { attempt: card.getInt('attempt'), resumed: true, from_run: oldRun } });
  return Object.assign(payload(app, app.findRecordById('cards', card.id)), { resumed: true });
}

/** Everything the agent needs to work a card it holds. */
function payload(app, card) {
  const u = U();
  const m = M();
  const ctx = m.ctxFor(app, card.getString('board'));
  const col = ctx.cols[card.getString('column')];
  const cols = m.columnsOf(app, card.getString('board'));
  const nx = col ? m.nextColumn(cols, col) : null;
  // Copy before reversing: reverse() on the Go slice a query returns mirrors it (goja).
  const events = Array.from(app.findRecordsByFilter('events', "card = {:c} && (kind = 'comment' || kind = 'answer' || kind = 'changes_requested' || kind = 'question' || kind = 'submitted')", '-created', 12, 0, { c: card.id })).reverse();
  const out = {
    card: m.cardJson(card, ctx, true),
    run: card.getString('run'),
    lease_until: card.getString('lease_until'),
    heartbeat_every_minutes: Math.max(1, Math.floor(leaseMinutes(col) / 3)),
    board: { id: ctx.board.id, name: ctx.board.getString('name'), key: ctx.board.getString('key'), how_we_work: ctx.board.getString('instructions') },
    column: col
      ? {
          name: col.getString('name'),
          category: col.getString('category'),
          policy: col.getString('policy'),
          instructions: col.getString('instructions'),
          plan_first: col.getBool('plan_first'),
          checklist_must_be_done: col.getBool('need_checklist'),
          after_submit: nx ? nx.getString('name') + (nx.getString('category') === 'review' ? ' (the person reviews it)' : m.CLOSED[nx.getString('category')] ? ' (after the person approves your work)' : '') : 'the person reviews it here',
        }
      : null,
    feedback: card.getString('feedback'),
    conversation: events.map((ev) => ({ kind: ev.getString('kind'), who: ev.getString('actor_kind') === 'you' ? 'person' : ev.getString('actor_kind'), text: ev.getString('text'), at: ev.getString('created') })),
  };
  if (col && col.getBool('plan_first') && !card.getBool('plan_ok')) {
    out.instructions = 'This column needs an approved plan first: post it with work.plan --card ' + out.card.key + ' --steps \'["step one","step two"]\' and stop on this card; the person approves it and the card comes back to you.';
  } else {
    out.instructions = 'Do the card. Pass --run ' + out.run + ' on every work.* call for it. Log notable steps with work.log, renew your lease with work.heartbeat every ' + out.heartbeat_every_minutes + ' min, then finish with work.submit (summary, evidence, criteria), work.ask, work.return or work.fail. Never move it to Done yourself.';
  }
  void u;
  return out;
}

/* ------------------------------------------------------------- the lease */

function heartbeat(app, e, p) {
  const u = U();
  const m = M();
  const w = mustAgent(app, e, p);
  const card = held(app, w, p);
  const board = u.byId(app, 'boards', card.getString('board'));
  m.agentMayWrite(app, w, board);
  const col = u.byId(app, 'columns', card.getString('column'));
  card.set('lease_until', u.pbTime(Date.now() + leaseMinutes(col) * 60000));
  const progress = u.str(p, 'progress', '');
  if (progress !== '') card.set('progress', progress.slice(0, 300));
  const cost = u.number(p, 'cost', { min: 0 });
  if (cost !== null) card.set('cost', card.getFloat('cost') + cost);
  app.save(card);
  const fb = card.getString('feedback');
  return { ok: true, lease_until: card.getString('lease_until'), feedback: fb, message: fb !== '' ? 'The person said: ' + fb : undefined };
}

function logStep(app, e, p) {
  const u = U();
  const m = M();
  const w = mustAgent(app, e, p);
  const card = held(app, w, p);
  m.agentMayWrite(app, w, u.byId(app, 'boards', card.getString('board')));
  const kind = u.oneOf(p, 'kind', ['thought', 'action', 'note', 'result'], 'action');
  const text = u.req(p, 'text', '"Read the brand guide and the last three posts"').slice(0, 8000);
  m.log(app, { board: card.getString('board'), card: card.id, actor: w, kind: kind, text: text, run: card.getString('run') });
  card.set('progress', text.split('\n')[0].slice(0, 300));
  const col = u.byId(app, 'columns', card.getString('column'));
  card.set('lease_until', u.pbTime(Date.now() + leaseMinutes(col) * 60000));
  app.save(card);
  return { ok: true };
}

function plan(app, e, p) {
  const u = U();
  const m = M();
  const w = mustAgent(app, e, p);
  const card = held(app, w, p);
  m.agentMayWrite(app, w, u.byId(app, 'boards', card.getString('board')));
  const raw = u.list(p, 'steps', '["Outline","Draft","Check facts"]');
  if (!raw || raw.length === 0) throw u.fail(400, 'steps is required: a list of steps, e.g. steps=\'["Outline","Draft","Check facts"]\' (or objects with text and status)');
  const steps = raw
    .map((s) => (typeof s === 'string' ? { text: s.trim(), status: 'pending' } : { text: String(s.text || '').trim(), status: ['pending', 'doing', 'done', 'skipped'].indexOf(s.status) >= 0 ? s.status : 'pending' }))
    .filter((s) => s.text !== '')
    .slice(0, 40);
  const before = m.json(card, 'plan', []);
  const changedText = before.map((s) => s.text).join('\n') !== steps.map((s) => s.text).join('\n');
  card.set('plan', steps);
  const col = u.byId(app, 'columns', card.getString('column'));
  let waiting = false;
  if (col && col.getBool('plan_first') && !card.getBool('plan_ok')) {
    C().endSession(app, card, 'planned', 'Plan posted for approval');
    // A plan round is not a try at the work: it does not count against the attempts.
    card.set('attempt', Math.max(0, card.getInt('attempt') - 1));
    card.set('agent_state', 'needs_input');
    card.set('question', { kind: 'plan', text: 'Approve this plan before the agent starts', by: 'agent', at: u.pbTime() });
    card.set('feedback', '');
    waiting = true;
  } else card.set('lease_until', u.pbTime(Date.now() + leaseMinutes(col) * 60000));
  card.set('version', card.getInt('version') + 1);
  app.save(card);
  if (changedText || waiting) m.log(app, { board: card.getString('board'), card: card.id, actor: w, kind: 'plan', text: steps.map((s, i) => i + 1 + '. ' + s.text).join('\n'), run: card.getString('run'), meta: { waiting: waiting } });
  return { ok: true, waiting_for_approval: waiting, message: waiting ? 'Plan sent to the person. Stop work on this card; it comes back to you once approved.' : undefined };
}

function ask(app, e, p) {
  const u = U();
  const m = M();
  const w = mustAgent(app, e, p);
  const card = held(app, w, p);
  m.agentMayWrite(app, w, u.byId(app, 'boards', card.getString('board')));
  const text = u.req(p, 'question', '"Which audience is this for: customers or the internal team?"').slice(0, 2000);
  const asked = app.findRecordsByFilter('events', "card = {:c} && kind = 'question' && created >= {:t}", '', 0, 0, { c: card.id, t: u.pbTime(Date.now() - 86400000) }).length;
  if (asked >= QUESTION_CAP) throw u.fail(429, 'You asked ' + asked + ' questions on this card today. Use your best judgment and say what you assumed in work.submit, or hand it back with work.return.', { code: 'question_cap' });
  const options = (u.list(p, 'options') || []).map((x) => String(x).slice(0, 200)).slice(0, 6);
  const runId = card.getString('run');
  C().endSession(app, card, 'asked', text);
  // Asking is not failing: the question round does not count against the attempts.
  card.set('attempt', Math.max(0, card.getInt('attempt') - 1));
  card.set('agent_state', 'needs_input');
  card.set('question', { kind: 'question', text: text, options: options, by: 'agent', at: u.pbTime() });
  card.set('feedback', '');
  card.set('version', card.getInt('version') + 1);
  app.save(card);
  m.log(app, { board: card.getString('board'), card: card.id, actor: w, kind: 'question', text: text, run: runId, meta: { options: options } });
  return { ok: true, message: 'Asked. Stop work on this card; it comes back to you (work.next) with the answer.' };
}

/** Finish: the result goes to review (or on to the next column the agent works). */
function submit(app, e, p) {
  const u = U();
  const m = M();
  const w = mustAgent(app, e, p);
  const card = held(app, w, p);
  const board = u.byId(app, 'boards', card.getString('board'));
  m.agentMayWrite(app, w, board);
  const summary = u.req(p, 'summary', '"Wrote the draft (640 words) in the description; checked every link"').slice(0, 8000);
  const evidence = (u.list(p, 'evidence') || []).map((x) => String(x).slice(0, 2000)).slice(0, 30);
  const unverified = (u.list(p, 'unverified') || []).map((x) => String(x).slice(0, 1000)).slice(0, 30);
  let criteria = u.list(p, 'criteria');
  const acceptance = card.getString('acceptance').trim();
  if (acceptance !== '' && (!criteria || criteria.length === 0)) {
    throw u.fail(400, 'This card has acceptance criteria: report each one in criteria, e.g. criteria=\'[{"text":"Under 800 words","met":true,"note":"640 words"}]\'. The criteria: ' + acceptance.slice(0, 600), { code: 'criteria_required' });
  }
  criteria = (criteria || []).map((c) => (typeof c === 'string' ? { text: c, met: true } : { text: String(c.text || ''), met: c.met !== false && c.met !== 'false', note: String(c.note || '').slice(0, 500) })).slice(0, 30);
  const col = u.byId(app, 'columns', card.getString('column'));
  const items = m.json(card, 'checklist', []);
  const open = items.filter((x) => x && !x.done).length;
  if (col && col.getBool('need_checklist') && open > 0) throw u.fail(409, 'Tick every checklist item first (' + open + ' open): cards.check --card ' + m.keyOf(board, card) + ' --item <n> --done true', { code: 'checklist_open' });
  const cost = u.number(p, 'cost', { min: 0 });
  if (cost !== null) card.set('cost', card.getFloat('cost') + cost);
  const runId = card.getString('run');
  const review = { by: 'agent', at: u.pbTime(), summary: summary, evidence: evidence, unverified: unverified, criteria: criteria, run: runId, attempt: card.getInt('attempt'), from: col ? col.getString('name') : '' };
  const cols = m.columnsOf(app, card.getString('board'));
  const nx = col ? m.nextColumn(cols, col) : null;
  if (nx && !m.CLOSED[nx.getString('category')] && nx.getInt('wip') > 0 && m.cardsIn(app, nx.id).filter((c) => c.id !== card.id).length >= nx.getInt('wip')) {
    throw u.fail(409, nx.getString('name') + ' is at its WIP limit (' + nx.getInt('wip') + '): the person has to clear some of it first. Keep the card (heartbeat) and try again later, or release it.', { code: 'wip_full' });
  }
  C().endSession(app, card, 'submitted', summary);
  card.set('review', review);
  card.set('feedback', '');
  card.set('plan_ok', false);
  card.set('agent_state', '');
  if (col && col.getString('category') === 'doing') card.set('work_column', col.id);
  m.log(app, { board: board.id, card: card.id, actor: w, kind: 'submitted', text: summary, run: runId, meta: { evidence: evidence, unverified: unverified, criteria: criteria } });
  let where = 'review';
  if (nx && (nx.getString('category') === 'doing' || nx.getString('category') === 'todo') && nx.getBool('agent')) {
    // On to the next stage the agent works.
    card.set('handoffs', card.getInt('handoffs') + 1);
    if (card.getInt('handoffs') > MAX_HANDOFFS) {
      card.set('review_state', 'pending');
      card.set('version', card.getInt('version') + 1);
      app.save(card);
      where = 'review (handoff limit)';
    } else {
      card.set('assignee', 'agent');
      card.set('review_state', '');
      C().place(app, w, card, nx, { where: 'top', run: runId, reason: 'Moved on by the agent' });
      where = nx.getString('name');
    }
  } else if (nx && nx.getString('category') === 'review') {
    card.set('review_state', 'pending');
    C().place(app, w, card, nx, { where: 'top', run: runId, reason: 'Submitted for review' });
    where = nx.getString('name');
  } else {
    // The next stage is the person's (Done) or there is none: review in place.
    card.set('review_state', 'pending');
    card.set('version', card.getInt('version') + 1);
    app.save(card);
    where = 'review';
  }
  return { ok: true, now_in: where, message: 'Submitted. The card is with ' + (where.indexOf('review') === 0 || (nx && nx.getString('category') === 'review') ? 'the person for review' : where) + '. Call work.next for your next card.' };
}

function giveBack(app, e, p) {
  const u = U();
  const m = M();
  const w = mustAgent(app, e, p);
  const card = held(app, w, p);
  const reason = u.req(p, 'reason', '"This needs a decision about pricing that only you can make"').slice(0, 2000);
  const why = u.oneOf(p, 'why', ['cant', 'scope', 'judgment', 'access', 'budget', 'other'], 'other');
  const runId = card.getString('run');
  C().endSession(app, card, 'returned', reason);
  card.set('assignee', 'you');
  card.set('agent_state', 'needs_attention');
  card.set('attention', ('Handed back by the agent: ' + reason).slice(0, 600));
  card.set('version', card.getInt('version') + 1);
  app.save(card);
  m.log(app, { board: card.getString('board'), card: card.id, actor: w, kind: 'returned', text: reason, run: runId, meta: { why: why } });
  return { ok: true, message: 'Handed back to the person.' };
}

function fail(app, e, p) {
  const u = U();
  const m = M();
  const w = mustAgent(app, e, p);
  const card = held(app, w, p);
  const reason = u.req(p, 'reason', '"The source page returns 404"').slice(0, 2000);
  const runId = card.getString('run');
  const col = u.byId(app, 'columns', card.getString('column'));
  const max = (col && col.getInt('max_attempts')) || 3;
  C().endSession(app, card, 'failed', reason);
  if (card.getInt('attempt') >= max) {
    card.set('agent_state', 'needs_attention');
    card.set('attention', ('Failed ' + card.getInt('attempt') + ' times. Last: ' + reason).slice(0, 600));
  } else {
    card.set('agent_state', 'queued');
    card.set('feedback', ('Your last try failed: ' + reason).slice(0, 4000));
    markDirty(app);
  }
  card.set('version', card.getInt('version') + 1);
  app.save(card);
  m.log(app, { board: card.getString('board'), card: card.id, actor: w, kind: 'failed', text: reason, run: runId, meta: { attempt: card.getInt('attempt'), of: max } });
  return { ok: true, retry: card.getString('agent_state') === 'queued' };
}

function release(app, e, p) {
  const u = U();
  const m = M();
  const w = mustAgent(app, e, p);
  const card = held(app, w, p);
  const runId = card.getString('run');
  const note = u.str(p, 'reason', '');
  C().endSession(app, card, 'released', note);
  card.set('agent_state', 'queued');
  card.set('attempt', Math.max(0, card.getInt('attempt') - 1));
  card.set('version', card.getInt('version') + 1);
  app.save(card);
  m.log(app, { board: card.getString('board'), card: card.id, actor: w, kind: 'released', text: note, run: runId });
  markDirty(app);
  return { ok: true };
}

/* ------------------------------------------------------------- the clock */

/** Leases that ran out: back to the queue, or to the person after too many tries. */
function expire(app) {
  const u = U();
  const m = M();
  const rows = app.findRecordsByFilter('cards', "agent_state = 'working' && lease_until != '' && lease_until < {:t}", '', 0, 0, { t: u.pbTime() });
  let n = 0;
  for (const card of rows) {
    const runId = card.getString('run');
    const col = u.byId(app, 'columns', card.getString('column'));
    const max = (col && col.getInt('max_attempts')) || 3;
    C().endSession(app, card, 'expired', 'No heartbeat before the lease ran out');
    if (card.getInt('attempt') >= max) {
      card.set('agent_state', 'needs_attention');
      card.set('attention', 'The agent stopped responding ' + card.getInt('attempt') + ' times.');
    } else {
      card.set('agent_state', 'queued');
      markDirty(app);
    }
    card.set('version', card.getInt('version') + 1);
    app.save(card);
    m.log(app, { board: card.getString('board'), card: card.id, actor: { kind: 'system', id: 'system' }, kind: 'expired', text: 'The lease ran out without a heartbeat', run: runId });
    n++;
  }
  return n;
}

module.exports = {
  markDirty: markDirty,
  fireIfNeeded: fireIfNeeded,
  queueCounts: queueCounts,
  blocker: blocker,
  queue: queue,
  next: next,
  heartbeat: heartbeat,
  log: logStep,
  plan: plan,
  ask: ask,
  submit: submit,
  resume: resume,
  giveBack: giveBack,
  fail: fail,
  release: release,
  expire: expire,
};
