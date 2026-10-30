/// <reference path="../pb_data/types.d.ts" />
/**
 * Settings (with the agent's pause and limit), the inbox (what needs you,
 * and what the agent did while you were away), flow insights with the
 * agent's report card, the activity log with revert and undo, the agent's
 * status, and what is on screen for the agent.
 */

function U() {
  return require(`${__hooks}/lib_util.js`);
}
function M() {
  return require(`${__hooks}/lib_model.js`);
}

const DAY = 86400000;

/* -------------------------------------------------------------- settings */

function settingsJson(app) {
  const s = M().settings(app);
  return {
    name: s.getString('name'),
    paused: s.getBool('paused'),
    attention: M().json(s, 'attention', {}),
    defaults: M().json(s, 'defaults', {}),
    max_working: s.getInt('max_working') || 2,
    last_seen: s.getString('last_seen'),
  };
}

function settingsUpdate(app, e, p) {
  const u = U();
  const m = M();
  const w = m.who(app, e, p);
  m.personOnly(w, 'Changing settings');
  const s = m.settings(app);
  const was = s.getBool('paused');
  if (u.has(p, 'name')) s.set('name', u.squash(u.str(p, 'name', '')).slice(0, 80));
  if (u.has(p, 'paused')) s.set('paused', u.bool(p, 'paused', false));
  if (u.has(p, 'max_working')) s.set('max_working', u.int(p, 'max_working', 2, 1, 10));
  if (u.has(p, 'attention')) {
    const a = u.obj(p, 'attention', '{"questions":"interrupt"}') || {};
    const cur = m.json(s, 'attention', {}) || {};
    for (const k of ['reviews', 'questions', 'attention', 'updates']) if (a[k] !== undefined) cur[k] = ['interrupt', 'inbox', 'digest'].indexOf(a[k]) >= 0 ? a[k] : cur[k];
    s.set('attention', cur);
  }
  if (u.has(p, 'defaults')) {
    const d = u.obj(p, 'defaults', '{"lease_minutes":15}') || {};
    const cur = m.json(s, 'defaults', {}) || {};
    if (d.lease_minutes !== undefined) cur.lease_minutes = Math.max(2, Math.min(240, Math.round(Number(d.lease_minutes) || 15)));
    if (d.max_attempts !== undefined) cur.max_attempts = Math.max(1, Math.min(10, Math.round(Number(d.max_attempts) || 3)));
    s.set('defaults', cur);
  }
  app.save(s);
  const now = s.getBool('paused');
  if (was !== now) {
    m.log(app, { actor: w, kind: now ? 'agent_paused' : 'agent_resumed', text: now ? 'Paused the agent' : 'The agent may work again' });
    if (!now) {
      require(`${__hooks}/lib_work.js`).markDirty(app);
      require(`${__hooks}/lib_work.js`).fireIfNeeded(app);
    }
  }
  return settingsJson(app);
}

/* ----------------------------------------------------------------- agent */

/** The agent's report card over the last days (optionally one board). */
function agentStats(app, days, boardId) {
  const u = U();
  const bind = { t: u.pbTime(Date.now() - days * DAY), b: boardId || '' };
  const runs = app.findRecordsByFilter('runs', 'started >= {:t}' + (boardId ? ' && board = {:b}' : ''), '-started', 0, 0, bind);
  const count = (f) => runs.filter(f).length;
  const decided = runs.filter((r) => r.getString('decision') !== '');
  const approved = decided.filter((r) => r.getString('decision') === 'approved');
  // First pass: approved without you ever asking for changes on that card.
  const reworked = {};
  for (const r of decided) if (r.getString('decision') === 'changes') reworked[r.getString('card')] = true;
  const firstPass = approved.filter((r) => !reworked[r.getString('card')]).length;
  const durations = runs.filter((r) => r.getString('ended') !== '').map((r) => (u.ms(r.getString('ended')) - u.ms(r.getString('started'))) / 60000);
  durations.sort((a, z) => a - z);
  return {
    runs: runs.length,
    submitted: count((r) => r.getString('outcome') === 'submitted'),
    asked: count((r) => r.getString('outcome') === 'asked'),
    returned: count((r) => r.getString('outcome') === 'returned'),
    failed: count((r) => r.getString('outcome') === 'failed'),
    expired: count((r) => r.getString('outcome') === 'expired'),
    stopped: count((r) => r.getString('outcome') === 'stopped'),
    approved: approved.length,
    changes: decided.filter((r) => r.getString('decision') === 'changes').length,
    rejected: decided.filter((r) => r.getString('decision') === 'rejected').length,
    approval_rate: decided.length > 0 ? approved.length / decided.length : null,
    first_pass_rate: approved.length > 0 ? firstPass / approved.length : null,
    median_minutes: durations.length > 0 ? Math.round(durations[Math.floor(durations.length / 2)] * 10) / 10 : null,
    cost: runs.reduce((sum, r) => sum + (r.getFloat('cost') || 0), 0),
  };
}

/** What the agent is doing now: paused, working, waiting (work queued) or idle. */
function agentNow(app) {
  const s = M().settings(app);
  const q = require(`${__hooks}/lib_work.js`).queueCounts(app);
  const working = app.findRecordsByFilter('cards', "agent_state = 'working' && archived = false", '', 0, 0).length;
  const paused = s.getBool('paused');
  return {
    status: paused ? 'paused' : working > 0 ? 'working' : q.total > 0 ? 'waiting' : 'idle',
    paused: paused,
    working: working,
    queued: q.total,
    max_working: s.getInt('max_working') || 2,
    last_seen: s.getString('agent_seen'),
  };
}

/* ----------------------------------------------------------------- inbox */

function inbox(app, p) {
  const u = U();
  const m = M();
  const s = m.settings(app);
  const ctxs = {};
  const card = (c) => {
    const b = c.getString('board');
    if (!ctxs[b]) ctxs[b] = m.ctxFor(app, b);
    const j = m.cardJson(c, ctxs[b], false);
    j.board_name = ctxs[b].board ? ctxs[b].board.getString('name') : '';
    const r = m.json(c, 'review', null);
    if (r) j.review_summary = String(r.summary || '').slice(0, 280);
    return j;
  };
  const q = (filter, sort) => app.findRecordsByFilter('cards', 'archived = false && (' + filter + ')', sort || '-updated', 100, 0).map(card);
  const needs = {
    reviews: q("review_state = 'pending'", 'column_at'),
    questions: q("agent_state = 'needs_input'", 'updated'),
    attention: q("agent_state = 'needs_attention'", '-updated'),
    proposals: q('proposed = true', '-created'),
    blocked: q('blocked = true', '-updated'),
    overdue: q("due != '' && due < {:now} && done_at = ''".replace('{:now}', "'" + u.pbTime() + "'"), 'due'),
  };
  const total = needs.reviews.length + needs.questions.length + needs.attention.length + needs.proposals.length;
  // What the agent (and rules) did since you last looked.
  const since = u.has(p, 'since') ? u.str(p, 'since', '') : s.getString('last_seen') || u.pbTime(Date.now() - DAY);
  const rows = app.findRecordsByFilter('events', "actor_kind != 'you' && created > {:t} && kind != 'claimed' && kind != 'released'", '-created', 200, 0, { t: since });
  const keys = {};
  const updates = rows.map((ev) => {
    const j = m.eventJson(ev);
    const cid = ev.getString('card');
    if (cid !== '') {
      if (keys[cid] === undefined) {
        const c = u.byId(app, 'cards', cid);
        const b = c ? u.byId(app, 'boards', c.getString('board')) : null;
        keys[cid] = c && b ? { key: m.keyOf(b, c), title: c.getString('title'), board_name: b.getString('name') } : null;
      }
      if (keys[cid]) Object.assign(j, { card_key: keys[cid].key, card_title: keys[cid].title, board_name: keys[cid].board_name });
    }
    return j;
  });
  return { needs: needs, count: total, updates: updates, since: since, attention: m.json(s, 'attention', {}) };
}

function inboxSeen(app, e, p) {
  const m = M();
  const w = m.who(app, e, p);
  if (w.kind === 'agent') return { ok: true };
  const s = m.settings(app);
  s.set('last_seen', U().pbTime());
  app.save(s);
  return { ok: true, last_seen: s.getString('last_seen') };
}

/* -------------------------------------------------------------- insights */

function pct(sorted, q) {
  if (sorted.length === 0) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return Math.round(sorted[i] * 10) / 10;
}

function flow(app, p) {
  const u = U();
  const m = M();
  const days = u.int(p, 'days', 30, 7, 180);
  const board = u.has(p, 'board') ? m.mustBoard(app, u.str(p, 'board', '')) : null;
  const bf = board ? ' && board = {:b}' : '';
  const bind = { b: board ? board.id : '', t: u.pbTime(Date.now() - days * DAY) };
  const now = Date.now();
  const cols = board ? m.columnsOf(app, board.id) : [];
  const colById = {};
  for (const c of board ? cols : app.findAllRecords('columns')) colById[c.id] = c;
  const done = app.findRecordsByFilter('cards', "done_at >= {:t} && done_kind != 'canceled' && done_kind != ''" + bf, 'done_at', 0, 0, bind);
  const points = done.map((c) => {
    const start = u.ms(c.getString('started_at')) || u.ms(c.getString('created'));
    const b = u.byId(app, 'boards', c.getString('board'));
    return { key: b ? m.keyOf(b, c) : '', title: c.getString('title'), done_at: c.getString('done_at'), days: Math.max(0, Math.round(((u.ms(c.getString('done_at')) - start) / DAY) * 10) / 10), kind: c.getString('done_kind') === 'agent' ? 'agent' : 'you' };
  });
  const all = points.map((x) => x.days).sort((a, z) => a - z);
  const ofKind = (k) =>
    points
      .filter((x) => x.kind === k)
      .map((x) => x.days)
      .sort((a, z) => a - z);
  const percentiles = { p50: pct(all, 0.5), p85: pct(all, 0.85), p95: pct(all, 0.95), agent_p50: pct(ofKind('agent'), 0.5), you_p50: pct(ofKind('you'), 0.5) };
  // Throughput per week (oldest first).
  const weeks = Math.max(4, Math.ceil(days / 7));
  const through = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const end = now - i * 7 * DAY;
    const startW = end - 7 * DAY;
    const inW = points.filter((x) => {
      const t = u.ms(x.done_at);
      return t > startW && t <= end;
    });
    through.push({ week_end: new Date(end).toISOString().slice(0, 10), agent: inW.filter((x) => x.kind === 'agent').length, you: inW.filter((x) => x.kind === 'you').length });
  }
  // Work in progress and its age.
  const active = app.findRecordsByFilter('cards', "archived = false && done_at = ''" + bf, 'column_at', 0, 0, bind);
  const aging = [];
  const wip = {};
  for (const c of active) {
    const col = colById[c.getString('column')];
    if (!col) continue;
    const cat = col.getString('category');
    wip[col.id] = (wip[col.id] || 0) + 1;
    if (cat !== 'doing' && cat !== 'review') continue;
    const start = u.ms(c.getString('started_at')) || u.ms(c.getString('column_at')) || u.ms(c.getString('created'));
    const b = u.byId(app, 'boards', c.getString('board'));
    const a = c.getString('assignee');
    aging.push({ key: b ? m.keyOf(b, c) : '', id: c.id, title: c.getString('title'), column: col.id, column_name: col.getString('name'), age: Math.round(((now - start) / DAY) * 10) / 10, kind: a === 'agent' ? 'agent' : 'you', state: c.getString('agent_state'), review: c.getString('review_state') });
  }
  // Cumulative flow: cards per category at the end of each day, rebuilt from moves.
  const cfdCats = ['backlog', 'todo', 'doing', 'review', 'done'];
  const cfd = [];
  if (board) {
    const cards = app.findRecordsByFilter('cards', 'board = {:b}', '', 0, 0, { b: board.id });
    const moves = app.findRecordsByFilter('events', "board = {:b} && kind = 'moved'", 'created', 0, 0, { b: board.id });
    const byCard = {};
    for (const ev of moves) {
      const cid = ev.getString('card');
      if (cid === '') continue;
      (byCard[cid] = byCard[cid] || []).push({ t: u.ms(ev.getString('created')), from: (u.getJson(ev, 'before') || {}).id, to: (u.getJson(ev, 'after') || {}).id });
    }
    const catOf = (id) => {
      const c = colById[id];
      if (!c) return null;
      const k = c.getString('category');
      return k === 'triage' ? 'backlog' : k === 'canceled' ? null : k;
    };
    for (let i = days - 1; i >= 0; i--) {
      const end = now - i * DAY;
      const row = { day: new Date(end).toISOString().slice(0, 10) };
      for (const k of cfdCats) row[k] = 0;
      for (const c of cards) {
        if (u.ms(c.getString('created')) > end) continue;
        const ms = byCard[c.id] || [];
        let col = ms.length > 0 ? ms[0].from : c.getString('column');
        for (const mv of ms) if (mv.t <= end) col = mv.to;
        const k = catOf(col);
        if (k) row[k]++;
      }
      cfd.push(row);
    }
  }
  // Review wait: submitted to decision.
  const decisions = app.findRecordsByFilter('runs', "decided >= {:t} && decision != ''" + bf, '', 0, 0, bind);
  const waits = decisions.map((r) => (u.ms(r.getString('decided')) - u.ms(r.getString('ended'))) / 3600000).filter((x) => x >= 0).sort((a, z) => a - z);
  const reworked = {};
  for (const r of decisions) if (r.getString('decision') === 'changes') reworked[r.getString('card')] = true;
  const firstPass = decisions.filter((r) => r.getString('decision') === 'approved' && !reworked[r.getString('card')]).length;
  const approvedRuns = decisions.filter((r) => r.getString('decision') === 'approved').length;
  const waiting = app.findRecordsByFilter('cards', "review_state = 'pending' && archived = false" + bf, '', 0, 0, bind);
  return {
    days: days,
    board: board ? m.boardJson(board) : null,
    columns: cols.map((c) => ({ id: c.id, name: c.getString('name'), category: c.getString('category'), wip: c.getInt('wip'), count: wip[c.id] || 0 })),
    kpis: {
      wip: aging.length,
      throughput: points.length,
      by_agent: points.filter((x) => x.kind === 'agent').length,
      cycle_p50: percentiles.p50,
      cycle_p85: percentiles.p85,
      review_wait_hours: waits.length > 0 ? Math.round(waits[Math.floor(waits.length / 2)] * 10) / 10 : null,
      in_review: waiting.length,
      first_pass_rate: approvedRuns > 0 ? firstPass / approvedRuns : null,
    },
    percentiles: percentiles,
    cycle: points,
    throughput: through,
    aging: aging,
    cfd: cfd,
    agent: agentStats(app, days, board ? board.id : ''),
  };
}

/* -------------------------------------------------------------- activity */

function activity(app, p) {
  const u = U();
  const m = M();
  const filters = ["id != ''"];
  const bind = {};
  if (u.has(p, 'board')) {
    filters.push('board = {:b}');
    bind.b = m.mustBoard(app, u.str(p, 'board', '')).id;
  }
  if (u.has(p, 'card')) {
    filters.push('card = {:c}');
    bind.c = m.mustCard(app, u.str(p, 'card', '')).id;
  }
  const actor = u.oneOf(p, 'actor', ['you', 'agent', 'rule', 'system'], '');
  if (actor !== '') {
    filters.push('actor_kind = {:k}');
    bind.k = actor;
  }
  if (u.has(p, 'before')) {
    filters.push('created < {:before}');
    bind.before = u.str(p, 'before', '');
  }
  const limit = u.int(p, 'limit', 80, 1, 400);
  const rows = app.findRecordsByFilter('events', filters.join(' && '), '-created', limit + 1, 0, bind);
  const keys = {};
  const out = rows.slice(0, limit).map((ev) => {
    const j = m.eventJson(ev);
    j.revertible = REVERTIBLE[j.kind] === true && !j.reverted;
    const cid = ev.getString('card');
    if (cid !== '') {
      if (keys[cid] === undefined) {
        const c = u.byId(app, 'cards', cid);
        const b = c ? u.byId(app, 'boards', c.getString('board')) : null;
        keys[cid] = c && b ? { key: m.keyOf(b, c), title: c.getString('title'), board_name: b.getString('name') } : null;
      }
      if (keys[cid]) Object.assign(j, { card_key: keys[cid].key, card_title: keys[cid].title, board_name: keys[cid].board_name });
    }
    return j;
  });
  return { events: out, more: rows.length > limit };
}

const REVERTIBLE = { updated: true, moved: true, assigned: true, proposed: true, created: true, archived: true, restored: true, blocked: true, unblocked: true };
const FIELDS = { title: 1, description: 1, acceptance: 1, priority: 1, labels: 1, due: 1, estimate: 1, checklist: 1 };

function revertEvent(app, w, ev) {
  const u = U();
  const m = M();
  const C = require(`${__hooks}/lib_cards.js`);
  if (ev.getBool('reverted')) throw u.fail(409, 'Already reverted');
  const kind = ev.getString('kind');
  if (!REVERTIBLE[kind]) throw u.fail(409, 'This kind of change (' + kind + ') cannot be reverted');
  const card = u.byId(app, 'cards', ev.getString('card'));
  if (card === null) throw u.fail(409, 'The card is gone');
  const before = u.getJson(ev, 'before');
  const after = u.getJson(ev, 'after');
  let text = '';
  if (kind === 'updated') {
    const field = ev.getString('field');
    if (!FIELDS[field]) throw u.fail(409, 'This field cannot be reverted');
    const cur = field === 'labels' ? card.getStringSlice('labels') : field === 'priority' ? card.getInt(field) : field === 'estimate' ? card.getFloat(field) : field === 'checklist' ? m.json(card, field, null) : card.getString(field);
    if (u.canonical(cur) !== u.canonical(after)) throw u.fail(409, 'The ' + field + ' changed again since; revert the later change first', { code: 'changed_since' });
    card.set(field, before === null ? (field === 'labels' || field === 'checklist' ? [] : field === 'priority' || field === 'estimate' ? 0 : '') : before);
    card.set('version', card.getInt('version') + 1);
    app.save(card);
    m.log(app, { board: card.getString('board'), card: card.id, actor: w, kind: 'updated', field: field, before: after, after: before, meta: { reverts: ev.id } });
    text = 'Put the ' + field + ' back';
  } else if (kind === 'moved') {
    if (card.getString('column') !== (after && after.id)) throw u.fail(409, 'The card moved again since', { code: 'changed_since' });
    const col = u.byId(app, 'columns', before && before.id);
    if (col === null) throw u.fail(409, 'Its old column is gone');
    C.place(app, w, card, col, { where: 'top', reason: 'Undo', keepReview: true });
    text = 'Moved back to ' + col.getString('name');
  } else if (kind === 'assigned') {
    if (card.getString('assignee') !== after) throw u.fail(409, 'The card was reassigned since', { code: 'changed_since' });
    C.setAssignee(app, w, card, before || '', 'Undo');
    text = 'Assigned back';
  } else if (kind === 'proposed' || kind === 'created' || kind === 'restored' || kind === 'unblocked' || kind === 'archived' || kind === 'blocked') {
    if (kind === 'blocked' || kind === 'unblocked') {
      card.set('blocked', kind === 'unblocked');
      if (kind === 'blocked') card.set('blocked_reason', '');
    } else card.set('archived', kind !== 'archived');
    card.set('version', card.getInt('version') + 1);
    app.save(card);
    text = kind === 'archived' ? 'Restored' : kind === 'blocked' ? 'Unblocked' : kind === 'unblocked' ? 'Blocked again' : 'Archived';
    m.log(app, { board: card.getString('board'), card: card.id, actor: w, kind: kind === 'archived' ? 'restored' : kind === 'blocked' ? 'unblocked' : kind === 'unblocked' ? 'blocked' : 'archived', meta: { reverts: ev.id } });
  }
  ev.set('reverted', true);
  app.save(ev);
  return text;
}

function revert(app, e, p) {
  const u = U();
  const m = M();
  const w = m.who(app, e, p);
  m.personOnly(w, 'Reverting changes');
  const ids = (u.list(p, 'events') || []).map(String);
  if (u.has(p, 'event')) ids.push(u.str(p, 'event', ''));
  if (u.has(p, 'run')) {
    for (const ev of app.findRecordsByFilter('events', 'run = {:r} && reverted = false', '-created', 0, 0, { r: u.str(p, 'run', '') })) if (REVERTIBLE[ev.getString('kind')]) ids.push(ev.id);
  }
  if (ids.length === 0) throw u.fail(400, 'event (or events, or run) is required');
  const done = [];
  for (const id of ids) {
    const ev = u.byId(app, 'events', id);
    if (ev === null) throw u.fail(404, 'No event ' + id);
    done.push(revertEvent(app, w, ev));
  }
  return { ok: true, reverted: done.length, done: done };
}

/** Undo your last change (within half an hour). */
function undo(app, e, p) {
  const u = U();
  const m = M();
  const w = m.who(app, e, p);
  m.personOnly(w, 'Undo');
  const rows = app.findRecordsByFilter('events', "actor_kind = 'you' && reverted = false && created >= {:t}", '-created', 30, 0, { t: u.pbTime(Date.now() - 30 * 60000) });
  for (const ev of rows) {
    if (!REVERTIBLE[ev.getString('kind')]) continue;
    const meta = u.getJson(ev, 'meta') || {};
    if (meta.reverts) continue;
    const text = revertEvent(app, w, ev);
    const c = u.byId(app, 'cards', ev.getString('card'));
    const b = c ? u.byId(app, 'boards', c.getString('board')) : null;
    return { ok: true, undone: (c && b ? m.keyOf(b, c) + ': ' : '') + text };
  }
  throw u.fail(409, 'Nothing of yours to undo from the last 30 minutes');
}

/* ------------------------------------------------------------- the screen */

const UI_KEY = 'kb.ui';

function ui(app, e, p) {
  const u = U();
  app.store().set(UI_KEY, { view: u.str(p, 'view', ''), board: u.str(p, 'board', ''), card: u.str(p, 'card', ''), at: u.now() });
  return { ok: true };
}

function context(app) {
  const u = U();
  const m = M();
  const s = app.store().get(UI_KEY) || {};
  const out = { screen: s, agent: agentNow(app) };
  if (s.board) {
    const b = u.byId(app, 'boards', s.board);
    if (b !== null) out.board = m.boardJson(b);
  }
  if (s.card) {
    const c = u.byId(app, 'cards', s.card);
    if (c !== null) out.card = m.cardJson(c, m.ctxFor(app, c.getString('board')), true);
  }
  return out;
}

/**
 * Everything the app's frame shows in one call (settings, boards with live
 * counts, the agent's status, what needs you), so the sidebar, the badges
 * and the notices cost one request per change, not four.
 */
function state(app) {
  const m = M();
  const B = require(`${__hooks}/lib_boards.js`);
  const brief = (c) => {
    const b = U().byId(app, 'boards', c.getString('board'));
    return {
      id: c.id,
      key: b ? m.keyOf(b, c) : '',
      title: c.getString('title'),
      board: c.getString('board'),
      question: m.json(c, 'question', null),
      attention: c.getString('attention'),
      assignee: c.getString('assignee'),
      updated: c.getString('updated'),
      column_at: c.getString('column_at'),
    };
  };
  const pick = (filter) => app.findRecordsByFilter('cards', 'archived = false && (' + filter + ')', '-updated', 60, 0).map(brief);
  const needs = { reviews: pick("review_state = 'pending'"), questions: pick("agent_state = 'needs_input'"), attention: pick("agent_state = 'needs_attention'"), proposals: pick('proposed = true') };
  return {
    settings: settingsJson(app),
    boards: B.list(app, {}).boards,
    agent: agentNow(app),
    needs: needs,
    count: needs.questions.length + needs.attention.length + needs.proposals.length,
    reviews: needs.reviews.length,
  };
}

function status(app) {
  const a = agentNow(app);
  return {
    paused: a.paused,
    working: a.working,
    queued: a.queued,
    max_working: a.max_working,
    needs_you: app.findRecordsByFilter('cards', "archived = false && (review_state = 'pending' || agent_state = 'needs_input' || agent_state = 'needs_attention' || proposed = true)", '', 0, 0).length,
  };
}

module.exports = {
  settingsJson: settingsJson,
  settingsUpdate: settingsUpdate,
  agentStats: agentStats,
  agentNow: agentNow,
  inbox: inbox,
  inboxSeen: inboxSeen,
  flow: flow,
  activity: activity,
  revert: revert,
  undo: undo,
  ui: ui,
  context: context,
  status: status,
  state: state,
};
