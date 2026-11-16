/**
 * Performance cron (UTC schedule; the function acts per entity at 09:00
 * local time): review reminders daily during a phase that ends within the
 * reminder window or is overdue, required training reminders on Mondays.
 */
module.exports = [{ name: 'performance_reminders', schedule: '5 * * * *', fn: 'lib_performance.cronReminders' }];
