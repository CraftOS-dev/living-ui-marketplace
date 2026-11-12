/// <reference path="../pb_data/types.d.ts" />
/**
 * Hourly background work. Each job keeps its own cursor in settings.jobs so a
 * restart never repeats or skips work:
 *
 *   depreciation  posts every active asset's depreciation once a month has
 *                 finished (lib_assets.scheduled), as the app itself.
 *   chase         Settings, Your AI agent, "Chase overdue invoices": asks
 *                 your AI agent to draft reminders (it sends nothing) for the
 *                 invoices that fell overdue since its last ask.
 *   reorder       "Reorder low stock": asks your AI agent to draft purchase
 *                 orders when items run low that no draft order holds yet.
 *
 * One job failing never stops the others; each logs its own error.
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}
function core() {
  return require(`${__hooks}/lib_core.js`);
}

/** The app itself as the actor (the audit trail says "The app"). */
function appCtx(app, op) {
  return { e: null, app: app, op: op, actor: 'system', isAgent: false, member: null, memberId: '', name: '', role: null, roleKey: '', levels: {}, admin: false, approvalLimit: 0, employeeId: '', approving: null };
}

function cursor(app, key) {
  const jobs = u().jsonOf(core().settings(app), 'jobs') || {};
  return jobs[key];
}

function setCursor(app, key, value) {
  const s = core().settings(app);
  const jobs = u().jsonOf(s, 'jobs') || {};
  jobs[key] = value;
  s.set('jobs', jobs);
  app.save(s);
}

function routine(app) {
  return u().jsonOf(core().settings(app), 'agent') || {};
}

/** Post depreciation through last month, once per month. */
function depreciation(app) {
  const util = u();
  const month = util.addMonths(util.today().slice(0, 7), -1);
  if (String(cursor(app, 'depreciation') || '') >= month) return { done_through: month };
  const out = require(`${__hooks}/lib_assets.js`).scheduled(app, month);
  setCursor(app, 'depreciation', month);
  return out;
}

/** "Chase overdue invoices": invoices whose due date passed since the last ask (all of them the first time). */
function chase(app) {
  const util = u();
  if (routine(app).chase_overdue !== true || !require(`${__hooks}/lib_auth.js`).moduleOn(app, 'sales')) return { off: true };
  const since = String(cursor(app, 'chase') || '');
  const rows = util.rows(
    app,
    "SELECT id, due_date FROM documents WHERE type = 'invoice' AND state = 'posted' AND balance > 0 AND due_date != '' AND due_date < {:t} AND due_date > {:s} ORDER BY due_date DESC LIMIT 101",
    { id: '', due_date: '' },
    { t: util.today(), s: since },
  );
  if (rows.length === 0) return { asked: false };
  // The first ask (and a flood) covers every overdue invoice; later ones name the new ones.
  const params = { drafts_only: true };
  if (since !== '' && rows.length <= 100) params.invoices = rows.map((r) => r.id).join(',');
  const fired = require(`${__hooks}/_triggers_lib.js`).fire(app, 'collections_requested', params, 'hook');
  if (!fired || fired.ok !== true) return { asked: false, reason: fired ? fired.code : 'not_sent' };
  setCursor(app, 'chase', rows[0].due_date);
  const what = params.invoices !== undefined ? rows.length + (rows.length === 1 ? ' invoice' : ' invoices') + ' that fell overdue' : 'every overdue invoice';
  require(`${__hooks}/lib_audit.js`).write(app, appCtx(app, 'jobs.chase'), { kind: 'ask_agent', entity: '', ref: fired.id, label: 'collections_requested', summary: 'Asked your AI agent to draft reminders for ' + what + ' (Chase overdue invoices is on)' });
  return { asked: true, request: fired.id, invoices: params.invoices !== undefined ? rows.length : 'all' };
}

/** "Reorder low stock": items that ran low since the last ask and are on no draft order. */
function reorder(app) {
  const auth = require(`${__hooks}/lib_auth.js`);
  if (routine(app).auto_reorder !== true || !auth.moduleOn(app, 'purchasing') || !auth.moduleOn(app, 'inventory')) return { off: true };
  const due = require(`${__hooks}/lib_items.js`).reorderDue(app);
  const before = cursor(app, 'reorder');
  const asked = {};
  for (const id of Array.isArray(before) ? before : []) asked[id] = true;
  const fresh = due.filter((id) => asked[id] !== true);
  if (fresh.length === 0) {
    // Forget items that recovered or were drafted, so running low again asks again.
    if (Array.isArray(before) && before.length !== due.length) setCursor(app, 'reorder', due.slice(0, 500));
    return { asked: false };
  }
  const fired = require(`${__hooks}/_triggers_lib.js`).fire(app, 'reorder_review', {}, 'hook');
  if (!fired || fired.ok !== true) return { asked: false, reason: fired ? fired.code : 'not_sent' };
  setCursor(app, 'reorder', due.slice(0, 500));
  require(`${__hooks}/lib_audit.js`).write(app, appCtx(app, 'jobs.reorder'), {
    kind: 'ask_agent',
    entity: '',
    ref: fired.id,
    label: 'reorder_review',
    summary: 'Asked your AI agent to draft purchase orders: ' + fresh.length + (fresh.length === 1 ? ' item' : ' items') + ' ran low (Reorder low stock is on)',
  });
  return { asked: true, request: fired.id, items: fresh.length };
}

function hourly(app) {
  const out = {};
  for (const job of [
    ['depreciation', depreciation],
    ['chase', chase],
    ['reorder', reorder],
  ]) {
    try {
      out[job[0]] = job[1](app);
    } catch (err) {
      console.error('[erp] hourly job ' + job[0] + ' failed:', err);
      out[job[0]] = { error: String((err && err.message) || err) };
    }
  }
  return out;
}

module.exports = { hourly: hourly };
