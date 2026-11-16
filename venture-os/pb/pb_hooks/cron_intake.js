/**
 * Intake cron (firm zone; fn(app)): the Gmail sweep of the deals label every
 * 5 minutes, and the morning note on deals past their reply day.
 */
module.exports = [
  { name: 'gmail_sweep', schedule: '*/5 * * * *', fn: 'lib_intake_mail.sweep', catchUp: false },
  { name: 'reply_due', schedule: '0 8 * * *', fn: 'lib_intake.morning', catchUp: true },
];
