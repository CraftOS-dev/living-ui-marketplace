/**
 * Leave cron (UTC schedule): every 15 minutes each entity checks its local
 * time, and once a local day after 00:30 it writes the grants, accruals,
 * leave year closes and expiries due, then sends the notices (leave about to
 * expire; on Mondays the Japanese five-day rule).
 */
module.exports = [{ name: 'leave_daily', schedule: '*/15 * * * *', fn: 'lib_leave.cronDaily' }];
