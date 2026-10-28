/// <reference path="../pb_data/types.d.ts" />
/**
 * Record rules and background jobs.
 *
 * The rules (lib_rules.js) live on the RECORD, not only in the ops, so they
 * hold for every writer: the UI, the agent's ops, and raw `agent-app data`
 * writes. Handlers run in isolated VMs: helpers are required inside them.
 */

onRecordCreate((e) => {
  require(`${__hooks}/lib_rules.js`).checkLink(e.app, e.record);
  e.next();
}, 'links');

onRecordUpdate((e) => {
  require(`${__hooks}/lib_rules.js`).checkLink(e.app, e.record);
  e.next();
}, 'links');

onRecordCreate((e) => {
  require(`${__hooks}/lib_rules.js`).checkCard(e.record);
  e.next();
}, 'cards');

onRecordUpdate((e) => {
  require(`${__hooks}/lib_rules.js`).checkCard(e.record);
  e.next();
}, 'cards');

// Every minute: ask the AI agent about waiting summaries and reviews whose
// ask was refused (trigger cooldown) or lost to a restart, and end work the
// agent took but left unfinished. Touches the database only when something
// is pending (in-memory flags, see lib_agent.js).
cronAdd('rb_agent', '* * * * *', () => {
  const agent = require(`${__hooks}/lib_agent.js`);
  for (const q of ['digest', 'review']) {
    try {
      agent.fireIfNeeded($app, q);
    } catch (err) {
      console.error('[research-board] asking the AI agent failed:', q, err);
    }
    try {
      agent.settleStale($app, q);
    } catch (err) {
      console.error('[research-board] settling unfinished work failed:', q, err);
    }
  }
});

// Hourly: cards in the trash for more than a day are deleted for good
// (with their files and links).
cronAdd('rb_trash', '17 * * * *', () => {
  try {
    const cut = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().replace('T', ' ');
    const old = $app.findRecordsByFilter('cards', "trashed != '' && trashed < {:cut}", '', 500, 0, { cut: cut });
    for (const r of old) $app.delete(r);
  } catch (err) {
    console.error('[research-board] emptying the trash failed:', err);
  }
});
