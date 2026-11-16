/**
 * Payroll cron (payroll-core), five fields in UTC; local hours per entity
 * are checked inside each job.
 */
module.exports = [
  { name: 'payroll_publish', schedule: '*/15 * * * *', fn: 'lib_payroll_runs.cronPublish' },
  { name: 'payroll_reminders', schedule: '*/15 * * * *', fn: 'lib_payroll_runs.cronReminders' },
  { name: 'payroll_calc_continue', schedule: '* * * * *', fn: 'lib_payroll_runs.cronContinue' },
];
