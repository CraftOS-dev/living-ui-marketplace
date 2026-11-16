/**
 * Cron (UTC): the filings ledger refresh every hour (reminders once a day per
 * filing, kept by reminded_on), and once a day, only when the company switched
 * the monthly rule checks on, one pack in use for your AI agent to check.
 */
module.exports = [
  { name: 'filings_refresh', schedule: '20 * * * *', fn: 'lib_payroll_out_filings.cronDaily' },
  { name: 'rule_checks_daily', schedule: '0 2 * * *', fn: 'lib_payroll_out_packs.cronDaily' },
];
