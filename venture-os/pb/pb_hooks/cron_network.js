/**
 * Network cron (five fields in the firm's zone; fn(app)): mail headers every
 * 15 minutes, the calendar every 10 minutes (briefs and meeting.ended ride
 * on it), relationship strength nightly (with catch-up), and the minute
 * recompute of people touched by an op since the last minute.
 */
module.exports = [
  { name: 'capture_mail', schedule: '*/15 * * * *', fn: 'lib_network_capture.cronMail' },
  { name: 'capture_calendar', schedule: '*/10 * * * *', fn: 'lib_network_capture.cronCalendar' },
  { name: 'strength', schedule: '35 2 * * *', fn: 'lib_network.nightly', catchUp: true },
  { name: 'strength_touched', schedule: '* * * * *', fn: 'lib_network.flushDirty' },
];
