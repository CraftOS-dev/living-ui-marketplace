/**
 * Lifecycle cron (UTC schedule; the job itself waits for 09:00 local in each
 * entity): task reminders once a day and approved separations completed
 * after the last day. Your AI agent is never asked again on its own.
 */
module.exports = [
  { name: 'lifecycle_daily', schedule: '5 * * * *', fn: 'lib_lifecycle.cronDaily' },
];
