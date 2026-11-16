/**
 * Hiring cron (UTC, five fields; the kernel's minute job runs what matches).
 *   hiring_retention: daily, flags candidates past their retention day and
 *     tells the people who run hiring. It never deletes anything.
 *   hiring_messages: every minute, sends queued candidate emails.
 */
module.exports = [
  { name: 'hiring_retention', schedule: '20 2 * * *', fn: 'lib_hiring.cronRetention' },
  { name: 'hiring_messages', schedule: '* * * * *', fn: 'lib_hiring.cronMessages' },
];
