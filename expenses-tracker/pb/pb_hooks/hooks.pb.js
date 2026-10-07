/// <reference path="../pb_data/types.d.ts" />
/**
 * Record rules and background jobs.
 *
 * The expense rules live on the RECORD, not only in the ops, so they hold
 * for every writer: the UI, the agent's ops, and raw `agent-app data` writes.
 */

onRecordCreate((e) => {
  require(`${__hooks}/lib_expenses.js`).checkRecord(e.record);
  e.next();
}, 'expenses');

onRecordUpdate((e) => {
  require(`${__hooks}/lib_expenses.js`).checkRecord(e.record);
  e.next();
}, 'expenses');

// Categories always wear an icon from the curated set.
onRecordCreate((e) => {
  const icons = require(`${__hooks}/lib_icons.js`);
  const icon = e.record.getString('icon');
  if (icon === '') e.record.set('icon', icons.DEFAULT_ICON);
  else if (!icons.isIcon(icon)) throw new BadRequestError('icon must be one of: ' + icons.ICONS.join(', '));
  e.next();
}, 'categories');

onRecordUpdate((e) => {
  const icons = require(`${__hooks}/lib_icons.js`);
  const icon = e.record.getString('icon');
  if (icon === '') e.record.set('icon', icons.DEFAULT_ICON);
  else if (!icons.isIcon(icon)) throw new BadRequestError('icon must be one of: ' + icons.ICONS.join(', '));
  e.next();
}, 'categories');

// A receipt waiting to be read asks the AI agent (one ask drains every waiting receipt).
onRecordAfterCreateSuccess((e) => {
  try {
    if (e.record.getString('status') === 'waiting') {
      const rc = require(`${__hooks}/lib_receipts.js`);
      rc.markDirty(e.app);
      rc.fireIfNeeded(e.app);
    }
  } catch (err) {
    console.error('[expenses] asking the AI agent about a receipt failed:', err);
  }
  e.next();
}, 'receipts');

// Every minute: re-ask about receipts whose ask was refused (trigger cooldown)
// or lost to a restart. Touches the database only when something is pending.
cronAdd('et_receipts', '* * * * *', () => {
  try {
    require(`${__hooks}/lib_receipts.js`).fireIfNeeded($app);
  } catch (err) {
    console.error('[expenses] receipt ask failed:', err);
  }
});

// Recurring expenses: hourly, plus once in the first minute after a start (catch-up).
cronAdd('et_recurring', '7 * * * *', () => {
  try {
    const u = require(`${__hooks}/lib_util.js`);
    require(`${__hooks}/lib_recurring.js`).runDue($app, u.today());
  } catch (err) {
    console.error('[expenses] recurring run failed:', err);
  }
});

cronAdd('et_recurring_boot', '* * * * *', () => {
  if ($app.store().get('et_recurring_booted') === true) return;
  $app.store().set('et_recurring_booted', true);
  try {
    const u = require(`${__hooks}/lib_util.js`);
    require(`${__hooks}/lib_recurring.js`).runDue($app, u.today());
  } catch (err) {
    console.error('[expenses] recurring catch-up failed:', err);
  }
});
