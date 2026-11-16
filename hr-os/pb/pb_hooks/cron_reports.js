/**
 * Reports cron (five fields, UTC; the kernel's minute job runs what matches).
 *   reports_warm  every 10 minutes: the current month's absence and overtime figures and today's
 *                 leave balances counted again when their inputs changed (lib_reports_cache.js)
 */
module.exports = [{ name: 'reports_warm', schedule: '*/10 * * * *', fn: 'lib_reports_cache.warm' }];
