/// <reference path="../pb_data/types.d.ts" />
/**
 * Background jobs. Handlers run in isolated VMs: helpers are required
 * inside them.
 */

// Every minute: check every active alert (it works with the app closed).
cronAdd('tv_alerts', '* * * * *', () => {
  try {
    require(`${__hooks}/lib_alerts.js`).checkAll($app);
  } catch (err) {
    console.error('[trading-view] checking alerts failed:', err);
  }
});

// Every minute: ask the AI agent about waiting analyses and alert reactions
// whose ask was refused (trigger cooldown) or lost to a restart, and end
// work the agent took but left unfinished.
cronAdd('tv_agent', '* * * * *', () => {
  const agent = require(`${__hooks}/lib_agent.js`);
  for (const q of ['analysis', 'alert']) {
    try {
      agent.fireIfNeeded($app, q);
    } catch (err) {
      console.error('[trading-view] asking the AI agent failed:', q, err);
    }
    try {
      agent.settleStale($app, q);
    } catch (err) {
      console.error('[trading-view] settling unfinished work failed:', q, err);
    }
  }
});

// Nightly: drop old intraday bars (they are refetched when asked for), and
// activity older than 90 days.
cronAdd('tv_prune', '23 3 * * *', () => {
  try {
    require(`${__hooks}/lib_market.js`).prune($app);
    const cut = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString().replace('T', ' ');
    $app.db().newQuery('DELETE FROM activity WHERE created < {:c}').bind({ c: cut }).execute();
    $app.db().newQuery('DELETE FROM alert_events WHERE created < {:c} AND seen = TRUE').bind({ c: cut }).execute();
  } catch (err) {
    console.error('[trading-view] pruning failed:', err);
  }
});
