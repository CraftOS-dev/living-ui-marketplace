/// <reference path="../pb_data/types.d.ts" />
/**
 * Background jobs. Handlers run in isolated VMs: helpers are required
 * inside them.
 */

// Every minute: ask the AI agent about waiting work whose ask was refused
// (trigger cooldown) or lost to a restart, hand back work the agent took but
// left unfinished, and after a start recompute relationship numbers once.
cronAdd('cr_agent', '* * * * *', () => {
  const agent = require(`${__hooks}/lib_agent.js`);
  for (const q of ['asks', 'research', 'meetings', 'emails']) {
    try {
      agent.fireIfNeeded($app, q);
    } catch (err) {
      console.error('[crm] asking the AI agent failed:', q, err);
    }
    try {
      agent.settleStale($app, q);
    } catch (err) {
      console.error('[crm] settling unfinished work failed:', q, err);
    }
  }
  if ($app.store().get('cr_recalc_boot') !== true) {
    $app.store().set('cr_recalc_boot', true);
    try {
      require(`${__hooks}/lib_interactions.js`).recomputeAll($app);
    } catch (err) {
      console.error('[crm] recomputing relationships failed:', err);
    }
  }
  // The daily brief, at the hour the person chose.
  try {
    const setup = require(`${__hooks}/lib_setup.js`);
    const s = setup.row($app);
    const pol = setup.policy(s);
    if (pol.daily_brief && s.getBool('setup_done')) {
      const now = new Date();
      const today = require(`${__hooks}/lib_dates.js`).today();
      if (now.getHours() >= pol.brief_hour && s.getString('brief_last') !== today) {
        s.set('brief_last', today);
        $app.save(s);
        agent.ask($app, 'brief', 'Prepare my day: what matters today, who to follow up with, which deals are slipping, and drafts where a follow-up is due.', require(`${__hooks}/lib_guide.js`).context($app));
        agent.nudge($app, 'asks');
      }
    }
  } catch (err) {
    console.error('[crm] daily brief failed:', err);
  }
});

// Nightly: strength decays with time; the trash keeps 90 days; the activity
// log a year.
cronAdd('cr_nightly', '23 3 * * *', () => {
  try {
    require(`${__hooks}/lib_interactions.js`).recomputeAll($app);
  } catch (err) {
    console.error('[crm] recomputing relationships failed:', err);
  }
  try {
    require(`${__hooks}/lib_data.js`).purge($app);
  } catch (err) {
    console.error('[crm] emptying the trash failed:', err);
  }
  try {
    const cut = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString().replace('T', ' ');
    $app.db().newQuery('DELETE FROM activity WHERE created < {:c}').bind({ c: cut }).execute();
    $app.db().newQuery("DELETE FROM asks WHERE created < {:c} AND (status = 'done' OR status = 'failed')").bind({ c: cut }).execute();
  } catch (err) {
    console.error('[crm] pruning failed:', err);
  }
});
