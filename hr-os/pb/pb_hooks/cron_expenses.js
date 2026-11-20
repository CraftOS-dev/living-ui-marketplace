/**
 * Expenses cron (UTC, run by the kernel's minute job):
 *   receipts every 30 minutes: a receipt left waiting with no open job is asked again once, then marked failed.
 *   reminders on Mondays 01:00: drafts left for a week, approved claims paid by bank still unpaid.
 */
module.exports = [
  { name: 'expenses_reminders', schedule: '0 1 * * 1', fn: 'lib_expenses.cronReminders' },
];
