/// <reference path="../pb_data/types.d.ts" />
/**
 * Board rules: When <something happens to a card>, If <conditions>, Then
 * <actions>. Rules run in their board's order.
 *
 * Guardrails: a rule's own actions never trigger rules (no chains), and a
 * rule that fires 5 times on the same card within 10 minutes is switched off
 * with the reason shown, so a loop cannot run away. Every run is an event.
 * Agent work is not a rule: a column's agent setting queues cards on entry.
 */

const WHEN = {
  enters_column: 'A card enters a column',
  created: 'A card is created',
  checklist_done: 'Its checklist is complete',
  approved: 'A review is approved',
  changes_requested: 'Changes are requested',
  needs_attention: 'A card needs your attention',
  blocked: 'A card is flagged blocked',
  idle: 'A card sits untouched for some days',
  due_soon: 'A card is due within some days',
};
const ACTIONS = ['move', 'assign', 'priority', 'label', 'unlabel', 'request_review', 'block', 'comment', 'archive'];
const LOOP_RUNS = 5;
const LOOP_MINUTES = 10;

function U() {
  return require(`${__hooks}/lib_util.js`);
}
function M() {
  return require(`${__hooks}/lib_model.js`);
}

function matches(app, rule, card) {
  const m = M();
  const cond = m.json(rule, 'conditions', {}) || {};
  if (Array.isArray(cond.priority) && cond.priority.length > 0 && cond.priority.indexOf(card.getInt('priority')) < 0) return false;
  if (Array.isArray(cond.labels) && cond.labels.length > 0) {
    const mine = card.getStringSlice('labels');
    if (!cond.labels.some((l) => mine.indexOf(l) >= 0)) return false;
  }
  if (typeof cond.assignee === 'string' && cond.assignee !== '') {
    const a = card.getString('assignee') || 'none';
    if (cond.assignee !== a) return false;
  }
  void app;
  return true;
}

/** Run the rules of a card's board for one happening. Never throws into the caller. */
function run(app, when, cardId, ctx) {
  const u = U();
  const m = M();
  let card = u.byId(app, 'cards', cardId);
  if (card === null || card.getBool('archived')) return 0;
  const rules = app.findRecordsByFilter('rules', 'board = {:b} && enabled = true && when = {:w}', 'position,created', 0, 0, { b: card.getString('board'), w: when });
  let n = 0;
  for (const rule of rules) {
    if (when === 'enters_column' && rule.getString('column') !== '' && rule.getString('column') !== (ctx && ctx.column)) continue;
    card = u.byId(app, 'cards', cardId);
    if (card === null || card.getBool('archived')) break;
    if (!matches(app, rule, card)) continue;
    // Loop guard.
    const recent = app.findRecordsByFilter('events', "card = {:c} && kind = 'rule' && actor = {:r} && created >= {:t}", '', 0, 0, { c: card.id, r: 'rule:' + rule.id, t: u.pbTime(Date.now() - LOOP_MINUTES * 60000) }).length;
    if (recent >= LOOP_RUNS) {
      rule.set('enabled', false);
      rule.set('paused_reason', 'Switched off: it ran ' + recent + ' times on ' + m.keyOf(u.byId(app, 'boards', card.getString('board')), card) + ' within ' + LOOP_MINUTES + ' minutes (a loop?).');
      app.save(rule);
      m.log(app, { board: card.getString('board'), card: card.id, actor: { kind: 'system', id: 'system' }, kind: 'rule_stopped', text: rule.getString('paused_reason'), meta: { rule: rule.id } });
      continue;
    }
    try {
      const done = apply(app, rule, card);
      rule.set('runs', rule.getInt('runs') + 1);
      rule.set('last_run', u.pbTime());
      app.save(rule);
      m.log(app, { board: card.getString('board'), card: card.id, actor: { kind: 'rule', id: 'rule:' + rule.id }, kind: 'rule', text: (rule.getString('name') || 'Rule') + ': ' + done.join(', '), meta: { rule: rule.id, when: when } });
      n++;
    } catch (err) {
      m.log(app, { board: card.getString('board'), card: card.id, actor: { kind: 'system', id: 'system' }, kind: 'rule_failed', text: (rule.getString('name') || 'Rule') + ' could not run: ' + String((err && err.message) || err), meta: { rule: rule.id } });
    }
  }
  return n;
}

function apply(app, rule, card) {
  const u = U();
  const m = M();
  const C = require(`${__hooks}/lib_cards.js`);
  const w = { kind: 'rule', id: 'rule:' + rule.id, name: rule.getString('name') || 'Rule' };
  const actions = m.json(rule, 'actions', []) || [];
  const done = [];
  for (const a of actions) {
    const fresh = u.byId(app, 'cards', card.id);
    if (fresh === null) break;
    if (a.do === 'move') {
      const col = u.byId(app, 'columns', String(a.column || ''));
      if (col === null || col.getString('board') !== fresh.getString('board')) throw new Error('its column no longer exists');
      if (col.id !== fresh.getString('column')) {
        C.place(app, w, fresh, col, { where: 'top', fromRule: true });
        done.push('moved to ' + col.getString('name'));
      }
    } else if (a.do === 'assign') {
      const to = String(a.to || '');
      const value = to === 'you' || to === 'agent' ? to : '';
      C.setAssignee(app, w, fresh, value, 'Assigned by a rule');
      done.push('assigned to ' + (value === 'you' ? 'you' : value === 'agent' ? 'the agent' : 'nobody'));
    } else if (a.do === 'priority') {
      const before = fresh.getInt('priority');
      const v = Math.max(0, Math.min(4, Number(a.value) || 0));
      if (v !== before) {
        fresh.set('priority', v);
        fresh.set('version', fresh.getInt('version') + 1);
        app.save(fresh);
        m.log(app, { board: fresh.getString('board'), card: fresh.id, actor: w, kind: 'updated', field: 'priority', before: before, after: v });
        done.push('priority ' + C.PRIORITY_LABEL[v].toLowerCase());
      }
    } else if (a.do === 'label' || a.do === 'unlabel') {
      const l = u.byId(app, 'labels', String(a.label || ''));
      if (l === null) throw new Error('its label no longer exists');
      const before = fresh.getStringSlice('labels');
      const after = a.do === 'label' ? (before.indexOf(l.id) >= 0 ? before : before.concat([l.id])) : before.filter((x) => x !== l.id);
      if (after.length !== before.length) {
        fresh.set('labels', after);
        fresh.set('version', fresh.getInt('version') + 1);
        app.save(fresh);
        m.log(app, { board: fresh.getString('board'), card: fresh.id, actor: w, kind: 'updated', field: 'labels', before: before, after: after });
        done.push((a.do === 'label' ? 'labeled ' : 'unlabeled ') + l.getString('name'));
      }
    } else if (a.do === 'request_review') {
      if (fresh.getString('review_state') !== 'pending') {
        fresh.set('review_state', 'pending');
        if (!m.json(fresh, 'review', null)) fresh.set('review', { by: 'rule', at: u.pbTime(), summary: 'Sent for your review by the rule "' + (rule.getString('name') || 'Rule') + '".', evidence: [], unverified: [], criteria: [] });
        fresh.set('version', fresh.getInt('version') + 1);
        app.save(fresh);
        const cols = m.columnsOf(app, fresh.getString('board'));
        const rv = m.firstOf(cols, ['review']);
        if (rv && rv.id !== fresh.getString('column')) C.place(app, w, fresh, rv, { where: 'top', fromRule: true, keepReview: true });
        done.push('sent for review');
      }
    } else if (a.do === 'block') {
      fresh.set('blocked', true);
      fresh.set('blocked_reason', String(a.reason || 'Blocked by a rule').slice(0, 600));
      fresh.set('version', fresh.getInt('version') + 1);
      app.save(fresh);
      done.push('flagged blocked');
    } else if (a.do === 'comment') {
      m.log(app, { board: fresh.getString('board'), card: fresh.id, actor: w, kind: 'comment', text: String(a.text || '').slice(0, 4000) });
      done.push('commented');
    } else if (a.do === 'archive') {
      fresh.set('archived', true);
      fresh.set('version', fresh.getInt('version') + 1);
      if (fresh.getString('agent_state') === 'working') C.endSession(app, fresh, 'stopped', 'Archived by a rule');
      fresh.set('agent_state', '');
      app.save(fresh);
      m.log(app, { board: fresh.getString('board'), card: fresh.id, actor: w, kind: 'archived', field: 'archived', before: false, after: true });
      done.push('archived');
    }
  }
  if (done.length === 0) done.push('nothing to change');
  return done;
}

/** Hourly: idle and due-soon rules, at most once a day per card and rule. */
function sweep(app) {
  const u = U();
  const rules = app.findRecordsByFilter('rules', "enabled = true && (when = 'idle' || when = 'due_soon')", '', 0, 0);
  let n = 0;
  for (const rule of rules) {
    const days = rule.getFloat('days') || 3;
    const board = rule.getString('board');
    let cards = [];
    if (rule.getString('when') === 'idle') {
      cards = app.findRecordsByFilter('cards', "board = {:b} && archived = false && updated < {:t} && done_at = ''", '', 200, 0, { b: board, t: u.pbTime(Date.now() - days * 86400000) });
    } else {
      cards = app.findRecordsByFilter('cards', "board = {:b} && archived = false && due != '' && due <= {:t} && done_at = ''", '', 200, 0, { b: board, t: u.pbTime(Date.now() + days * 86400000) });
    }
    for (const c of cards) {
      const today = app.findRecordsByFilter('events', "card = {:c} && kind = 'rule' && actor = {:r} && created >= {:t}", '', 1, 0, { c: c.id, r: 'rule:' + rule.id, t: u.pbTime(Date.now() - 86400000) });
      if (today.length > 0) continue;
      n += run(app, rule.getString('when'), c.id, {});
    }
  }
  return n;
}

/* ------------------------------------------------------------ the ops */

function ruleJson(r) {
  const m = M();
  return {
    id: r.id,
    board: r.getString('board'),
    name: r.getString('name'),
    enabled: r.getBool('enabled'),
    when: r.getString('when'),
    column: r.getString('column'),
    days: r.getFloat('days') || 0,
    conditions: m.json(r, 'conditions', {}) || {},
    actions: m.json(r, 'actions', []) || [],
    position: r.getFloat('position'),
    runs: r.getInt('runs'),
    last_run: r.getString('last_run'),
    paused_reason: r.getString('paused_reason'),
  };
}

function list(app, p) {
  const u = U();
  const m = M();
  const board = m.mustBoard(app, u.req(p, 'board', 'OPS'));
  const rows = app.findRecordsByFilter('rules', 'board = {:b}', 'position,created', 0, 0, { b: board.id });
  return { rules: rows.map(ruleJson), when: WHEN, actions: ACTIONS };
}

function save(app, e, p) {
  const u = U();
  const m = M();
  const w = m.who(app, e, p);
  m.personOnly(w, 'Changing board rules');
  let rule = null;
  let board = null;
  if (u.has(p, 'rule')) {
    rule = u.byId(app, 'rules', u.str(p, 'rule', ''));
    if (rule === null) throw u.fail(404, 'No rule ' + u.str(p, 'rule', ''));
    board = u.byId(app, 'boards', rule.getString('board'));
  } else {
    board = m.mustBoard(app, u.req(p, 'board', 'OPS'));
    rule = new Record(app.findCollectionByNameOrId('rules'));
    rule.set('board', board.id);
    rule.set('enabled', true);
    rule.set('position', app.findRecordsByFilter('rules', 'board = {:b}', '', 0, 0, { b: board.id }).length);
  }
  if (u.has(p, 'name')) rule.set('name', u.str(p, 'name', '').slice(0, 120));
  if (u.has(p, 'enabled')) {
    rule.set('enabled', u.bool(p, 'enabled', true));
    if (rule.getBool('enabled')) rule.set('paused_reason', '');
  }
  if (u.has(p, 'when')) rule.set('when', u.oneOf(p, 'when', Object.keys(WHEN), 'enters_column'));
  if (rule.getString('when') === '') throw u.fail(400, 'when is required: ' + Object.keys(WHEN).join(', '));
  if (u.has(p, 'column')) {
    const c = u.str(p, 'column', '');
    rule.set('column', c === '' ? '' : m.mustColumn(app, c, board.id).id);
  }
  if (u.has(p, 'days')) rule.set('days', u.number(p, 'days', { min: 0, max: 365 }) || 0);
  if (u.has(p, 'conditions')) {
    const c = u.obj(p, 'conditions', '{"priority":[1,2]}') || {};
    rule.set('conditions', { priority: Array.isArray(c.priority) ? c.priority.map(Number) : [], labels: Array.isArray(c.labels) ? c.labels.map(String) : [], assignee: ['you', 'agent', 'none'].indexOf(c.assignee) >= 0 ? c.assignee : '' });
  }
  if (u.has(p, 'actions')) {
    const acts = u.list(p, 'actions', '[{"do":"assign","to":"you"}]') || [];
    for (const a of acts) {
      if (!a || ACTIONS.indexOf(a.do) < 0) throw u.fail(400, 'Each action needs "do": one of ' + ACTIONS.join(', '));
      if (a.do === 'move' && m.mustColumn(app, String(a.column || ''), board.id) === null) throw u.fail(400, 'move needs a column');
      if (a.do === 'assign' && ['you', 'agent', ''].indexOf(String(a.to || '')) < 0) throw u.fail(400, 'assign takes to: you, agent or "" (nobody)');
    }
    if (acts.length === 0) throw u.fail(400, 'A rule needs at least one action');
    rule.set('actions', acts.slice(0, 10));
  }
  if (!rule.get('actions') || (m.json(rule, 'actions', []) || []).length === 0) throw u.fail(400, 'actions is required, e.g. actions=\'[{"do":"assign","to":"you"}]\'');
  if (rule.getString('when') === 'enters_column' && rule.getString('column') === '') throw u.fail(400, 'Pick the column the card enters');
  app.save(rule);
  m.log(app, { board: board.id, actor: w, kind: 'rule_saved', text: rule.getString('name') || WHEN[rule.getString('when')] });
  return { ok: true, rule: ruleJson(rule) };
}

function remove(app, e, p) {
  const u = U();
  const m = M();
  const w = m.who(app, e, p);
  m.personOnly(w, 'Removing board rules');
  const rule = u.byId(app, 'rules', u.req(p, 'rule', '<rule id>'));
  if (rule === null) throw u.fail(404, 'No such rule');
  app.delete(rule);
  return { ok: true };
}

module.exports = { WHEN: WHEN, ACTIONS: ACTIONS, run: run, sweep: sweep, list: list, save: save, remove: remove, ruleJson: ruleJson };
