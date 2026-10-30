/// <reference path="../pb_data/types.d.ts" />
/**
 * Background jobs. Handlers run in isolated VMs: helpers are required
 * inside them.
 */

// Every minute: ask the AI agent about waiting work whose ask was refused
// (trigger cooldown) or lost to a restart, and hand back work the agent took
// but left unfinished.
cronAdd('lf_agent', '* * * * *', () => {
  const agent = require(`${__hooks}/lib_agent.js`);
  for (const q of ['lines', 'files', 'asks', 'close']) {
    try {
      agent.fireIfNeeded($app, q);
    } catch (err) {
      console.error('[ledgerflow] asking the AI agent failed:', q, err);
    }
    try {
      agent.settleStale($app, q);
    } catch (err) {
      console.error('[ledgerflow] settling unfinished work failed:', q, err);
    }
  }
});

// Every hour: create recurring entries, invoices and bills that are due.
cronAdd('lf_recurring', '7 * * * *', () => {
  try {
    const due = $app.findRecordsByFilter('recurring', "active = true && next_date != '' && next_date <= {:d}", '', 1, 0, { d: require(`${__hooks}/lib_dates.js`).today() });
    if (due.length === 0) return;
    const who = { actor: 'recurring', run: '' };
    require(`${__hooks}/lib_activity.js`).run($app, who, 'recurring.run', (t) => {
      const res = require(`${__hooks}/lib_recurring.js`).runDue(t, '', who);
      for (const err of res.errors) console.warn('[ledgerflow] recurring schedule failed:', err.name, err.error);
      return { summary: res.made.length > 0 ? 'Created ' + res.made.length + ' recurring item' + (res.made.length === 1 ? '' : 's') + ': ' + res.made.map((m) => m.name).join(', ') : '', type: 'recurring', result: res };
    });
  } catch (err) {
    console.error('[ledgerflow] running recurring schedules failed:', err);
  }
});

// Nightly: activity older than a year (the books themselves are never pruned).
cronAdd('lf_prune', '41 3 * * *', () => {
  try {
    const cut = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString().replace('T', ' ');
    $app.db().newQuery('DELETE FROM activity WHERE created < {:c}').bind({ c: cut }).execute();
    $app.db().newQuery("DELETE FROM asks WHERE created < {:c} AND (status = 'done' OR status = 'failed')").bind({ c: cut }).execute();
  } catch (err) {
    console.error('[ledgerflow] pruning failed:', err);
  }
});
