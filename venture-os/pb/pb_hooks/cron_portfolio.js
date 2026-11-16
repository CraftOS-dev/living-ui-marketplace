/**
 * Portfolio cron (five fields in the firm's zone; fn(app)): the Gmail sweep
 * of founder updates every 5 minutes, founder requests and reminders each
 * morning, the alert rules daily, and board briefs asked for 48 hours
 * ahead (hourly).
 */
module.exports = [
  { name: 'portfolio_mail', schedule: '*/5 * * * *', fn: 'lib_portfolio_updates.sweep', catchUp: false },
  { name: 'portfolio_requests', schedule: '0 9 * * *', fn: 'lib_portfolio_updates.requestsDue', catchUp: true },
  { name: 'portfolio_alerts', schedule: '30 7 * * *', fn: 'lib_portfolio_kpi.alertsDaily', catchUp: true },
  { name: 'portfolio_board', schedule: '20 * * * *', fn: 'lib_portfolio_updates.boardDue', catchUp: false },
];
