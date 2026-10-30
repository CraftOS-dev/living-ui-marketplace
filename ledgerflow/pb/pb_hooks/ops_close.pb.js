/// <reference path="../pb_data/types.d.ts" />
/**
 * Operations: reconciliation, reports and month-end close.
 */

/* ------------------------------------------------------------- reconcile */

routerAdd('GET', '/api/ops/reconcile/overview', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => ({ accounts: require(`${__hooks}/lib_recon.js`).overview(app) })));

routerAdd('GET', '/api/ops/reconcile/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const acc = u.str(p, 'account', '');
    return { reconciliations: require(`${__hooks}/lib_recon.js`).list(app, acc ? require(`${__hooks}/lib_ledger.js`).account(app, acc).id : '') };
  }),
);

routerAdd('POST', '/api/ops/reconcile/start', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const recon = require(`${__hooks}/lib_recon.js`);
    const who = u.actor(e);
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'reconcile.start', (t) => {
      const r = recon.start(t, u.req(p, 'account'), u.req(p, 'statement_date'), u.req(p, 'statement_balance'), who);
      const acc = t.findRecordById('accounts', r.getString('account'));
      return { summary: 'Started reconciling ' + acc.getString('name') + ' to ' + r.getString('statement_date'), type: 'reconciliation', id: r.id, merge: true, result: { state: recon.state(t, r) } };
    });
  }),
);

routerAdd('GET', '/api/ops/reconcile/get', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const recon = require(`${__hooks}/lib_recon.js`);
    let r = null;
    if (u.str(p, 'reconciliation', '')) r = recon.mustGet(app, u.str(p, 'reconciliation', ''));
    else {
      const acc = require(`${__hooks}/lib_ledger.js`).account(app, u.req(p, 'account'));
      r = recon.openFor(app, acc.id);
      if (!r) return { state: null, hint: recon.statementHint(app, acc.id), last: recon.lastFinished(app, acc.id) ? recon.serialize(recon.lastFinished(app, acc.id)) : null };
    }
    return { state: recon.state(app, r) };
  }),
);

routerAdd('POST', '/api/ops/reconcile/toggle', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const recon = require(`${__hooks}/lib_recon.js`);
    const who = u.actor(e);
    const ids = u.has(p, 'postings') ? u.list(p, 'postings') : [u.req(p, 'posting')];
    const on = u.bool(p, 'cleared', true);
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'reconcile.toggle', (t) => {
      const r = recon.mustGet(t, u.req(p, 'reconciliation'));
      recon.toggle(t, r, ids, on, who);
      return { summary: (on ? 'Ticked ' : 'Unticked ') + ids.length + ' entr' + (ids.length === 1 ? 'y' : 'ies') + ' while reconciling', type: 'reconciliation', id: r.id, merge: true, result: { state: recon.state(t, r) } };
    });
  }),
);

routerAdd('POST', '/api/ops/reconcile/finish', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const recon = require(`${__hooks}/lib_recon.js`);
    const who = u.actor(e);
    if (who.actor === 'agent') throw u.fail(403, 'The person finishes a reconciliation; tick entries and tell them the difference');
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'reconcile.finish', (t) => {
      const r = recon.mustGet(t, u.req(p, 'reconciliation'));
      recon.finish(t, r, u.bool(p, 'adjust', false), u.str(p, 'adjust_account', ''), who);
      const acc = t.findRecordById('accounts', r.getString('account'));
      return { summary: 'Reconciled ' + acc.getString('name') + ' through ' + r.getString('statement_date') + ' (' + r.getInt('cleared_count') + ' entries)', type: 'reconciliation', id: r.id, undoable: false, result: { reconciliation: recon.serialize(r) } };
    });
  }),
);

routerAdd('POST', '/api/ops/reconcile/undo', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const recon = require(`${__hooks}/lib_recon.js`);
    const who = u.actor(e);
    if (who.actor === 'agent') throw u.fail(403, 'Only the person undoes a reconciliation');
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'reconcile.undo', (t) => {
      const r = recon.mustGet(t, u.req(p, 'reconciliation'));
      recon.undo(t, r, who);
      const acc = t.findRecordById('accounts', r.getString('account'));
      return { summary: 'Undid the reconciliation of ' + acc.getString('name') + ' through ' + r.getString('statement_date'), type: 'reconciliation', id: r.id, undoable: false, result: { reconciliation: recon.serialize(r) } };
    });
  }),
);

routerAdd('POST', '/api/ops/reconcile/cancel', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const recon = require(`${__hooks}/lib_recon.js`);
    const who = u.actor(e);
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'reconcile.cancel', (t) => {
      const r = recon.mustGet(t, u.req(p, 'reconciliation'));
      recon.cancel(t, r);
      return { summary: 'Stopped a reconciliation (ticks are kept)', type: 'reconciliation', id: r.id, result: { cancelled: true } };
    });
  }),
);

/* ---------------------------------------------------------------- reports */

routerAdd('GET', '/api/ops/reports/pnl', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    return require(`${__hooks}/lib_reports.js`).pnl(app, { range: u.str(p, 'range', ''), from: u.str(p, 'from', ''), to: u.str(p, 'to', ''), basis: u.oneOf(p, 'basis', ['accrual', 'cash'], 'accrual'), by: u.oneOf(p, 'by', ['total', 'month', 'quarter'], 'total'), compare: u.oneOf(p, 'compare', ['none', 'previous_period', 'previous_year'], 'none'), zero: u.bool(p, 'zero', false) });
  }),
);

routerAdd('GET', '/api/ops/reports/balance', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    return require(`${__hooks}/lib_reports.js`).balance(app, { to: u.str(p, 'to', ''), range: u.str(p, 'range', ''), compare: u.oneOf(p, 'compare', ['none', 'previous_period', 'previous_year'], 'none'), zero: u.bool(p, 'zero', false) });
  }),
);

routerAdd('GET', '/api/ops/reports/cashflow', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    return require(`${__hooks}/lib_reports.js`).cashflow(app, { range: u.str(p, 'range', ''), from: u.str(p, 'from', ''), to: u.str(p, 'to', '') });
  }),
);

routerAdd('GET', '/api/ops/reports/trial', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    return require(`${__hooks}/lib_reports.js`).trial(app, { to: u.str(p, 'to', '') });
  }),
);

routerAdd('GET', '/api/ops/reports/aged', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    return require(`${__hooks}/lib_reports.js`).aged(app, { side: u.oneOf(p, 'side', ['receivables', 'payables'], 'receivables'), to: u.str(p, 'to', '') });
  }),
);

routerAdd('GET', '/api/ops/reports/tax', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    return require(`${__hooks}/lib_reports.js`).tax(app, { range: u.str(p, 'range', ''), from: u.str(p, 'from', ''), to: u.str(p, 'to', ''), zero: u.bool(p, 'zero', false) });
  }),
);

routerAdd('GET', '/api/ops/reports/networth', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    return require(`${__hooks}/lib_reports.js`).networth(app, { months: u.int(p, 'months', 12, 2, 36) });
  }),
);

routerAdd('GET', '/api/ops/reports/spending', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    return require(`${__hooks}/lib_reports.js`).spending(app, { range: u.str(p, 'range', ''), from: u.str(p, 'from', ''), to: u.str(p, 'to', '') });
  }),
);

routerAdd('GET', '/api/ops/reports/drill', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const out = require(`${__hooks}/lib_reports.js`).drill(app, { account: u.req(p, 'account'), range: u.str(p, 'range', ''), from: u.str(p, 'from', ''), to: u.str(p, 'to', ''), limit: u.int(p, 'limit', 500, 1, 5000) });
    const names = {};
    for (const c of app.findRecordsByFilter('contacts', 'id != ""', '', 0, 0)) names[c.id] = c.getString('name');
    for (const r of out.rows) r.contact_name = names[r.contact] || '';
    return out;
  }),
);

routerAdd('POST', '/api/ops/reports/explain', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const agent = require(`${__hooks}/lib_agent.js`);
    const report = u.oneOf(p, 'report', ['pnl', 'balance', 'cashflow', 'trial', 'aged', 'tax', 'budget', 'networth', 'spending'], '');
    if (!report) throw u.fail(400, 'report is required');
    const params = u.obj(p, 'params') || {};
    const question = u.text(p, 'question', '') || 'Explain this report: what changed, what stands out, and anything that looks wrong.';
    let rec = null;
    app.runInTransaction((tx) => {
      rec = agent.ask(tx, 'explain', question, { report: report, params: params });
    });
    const fired = agent.nudge(app, 'asks');
    return { ask: agent.serializeAsk(rec), asked: fired.fired === true || fired.reason === 'already asked', reason: fired.fired ? '' : fired.reason || '' };
  }),
);

/* ------------------------------------------------------------------ close */

routerAdd('GET', '/api/ops/close/list', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => ({ periods: require(`${__hooks}/lib_close.js`).periods(app) })));

routerAdd('GET', '/api/ops/close/get', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const close = require(`${__hooks}/lib_close.js`);
    let rec = null;
    app.runInTransaction((tx) => {
      rec = close.period(tx, u.req(p, 'period'));
    });
    const out = close.serializePeriod(app, rec, true);
    const s = require(`${__hooks}/lib_setup.js`).serialize(require(`${__hooks}/lib_setup.js`).row(app));
    out.lock_date = s.lock_date;
    out.agent_lock_date = s.agent_lock_date;
    out.locked = s.lock_date !== '' && out.to <= s.lock_date;
    return { period: out };
  }),
);

routerAdd('GET', '/api/ops/close/checks', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const r = require(`${__hooks}/lib_reports.js`).span(app, { range: u.str(p, 'range', ''), from: u.str(p, 'from', ''), to: u.str(p, 'to', '') }, 'this_month');
    return { from: r.from, to: r.to, checks: require(`${__hooks}/lib_close.js`).checks(app, r.from, r.to) };
  }),
);

routerAdd('POST', '/api/ops/close/tick', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const close = require(`${__hooks}/lib_close.js`);
    const who = u.actor(e);
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'close.tick', (t) => {
      const rec = close.period(t, u.req(p, 'period'));
      if (u.has(p, 'item')) close.tick(t, rec, u.req(p, 'item'), u.bool(p, 'done', true));
      if (u.has(p, 'notes')) {
        rec.set('notes', u.text(p, 'notes', '').slice(0, 4000));
        t.save(rec);
      }
      return { summary: 'Updated the close checklist for ' + rec.getString('period'), type: 'period', id: rec.id, merge: true, result: { period: close.serializePeriod(t, rec, false) } };
    });
  }),
);

routerAdd('POST', '/api/ops/close/sign_off', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const close = require(`${__hooks}/lib_close.js`);
    const who = u.actor(e);
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'close.sign_off', (t) => {
      const rec = close.period(t, u.req(p, 'period'));
      const lock = u.bool(p, 'lock', true);
      close.signOff(t, rec, lock, u.bool(p, 'force', false), who);
      return { summary: 'Closed ' + rec.getString('period') + (lock ? ' and locked the books through it' : ''), type: 'period', id: rec.id, result: { period: close.serializePeriod(t, rec, false) } };
    });
  }),
);

routerAdd('POST', '/api/ops/close/reopen', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const close = require(`${__hooks}/lib_close.js`);
    const who = u.actor(e);
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'close.reopen', (t) => {
      const rec = close.period(t, u.req(p, 'period'));
      close.reopen(t, rec, who);
      return { summary: 'Reopened ' + rec.getString('period'), type: 'period', id: rec.id, result: { period: close.serializePeriod(t, rec, false) } };
    });
  }),
);

routerAdd('POST', '/api/ops/close/request_review', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const close = require(`${__hooks}/lib_close.js`);
    let rec = null;
    app.runInTransaction((tx) => {
      rec = close.period(tx, u.req(p, 'period'));
      rec.set('agent_state', 'waiting');
      rec.set('agent_at', new Date().toISOString());
      rec.set('agent_note', '');
      if (u.has(p, 'note')) rec.set('notes', u.text(p, 'note', '').slice(0, 4000));
      tx.save(rec);
    });
    const fired = require(`${__hooks}/lib_agent.js`).nudge(app, 'close');
    return { period: close.serializePeriod(app, rec, false), asked: fired.fired === true || fired.reason === 'already asked', reason: fired.fired ? '' : fired.reason || '' };
  }),
);

routerAdd('POST', '/api/ops/close/start', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const close = require(`${__hooks}/lib_close.js`);
    const rec = close.period(app, u.req(p, 'period'));
    require(`${__hooks}/lib_agent.js`).start(app, 'close', rec);
    return { period: close.serializePeriod(app, rec, true) };
  }),
);

routerAdd('POST', '/api/ops/close/complete', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const close = require(`${__hooks}/lib_close.js`);
    const rec = close.period(app, u.req(p, 'period'));
    const note = u.text(p, 'note', '');
    if (note === '') throw u.fail(400, 'note is required: what is done and what the person must still do');
    rec.set('agent_state', 'done');
    rec.set('agent_note', note.slice(0, 8000));
    rec.set('agent_at', new Date().toISOString());
    app.save(rec);
    return { period: close.serializePeriod(app, rec, false) };
  }),
);

routerAdd('POST', '/api/ops/close/fail', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const close = require(`${__hooks}/lib_close.js`);
    const rec = close.period(app, u.req(p, 'period'));
    rec.set('agent_state', 'failed');
    rec.set('agent_note', u.text(p, 'reason', 'Could not prepare the close').slice(0, 8000));
    rec.set('agent_at', new Date().toISOString());
    app.save(rec);
    return { period: close.serializePeriod(app, rec, false) };
  }),
);
