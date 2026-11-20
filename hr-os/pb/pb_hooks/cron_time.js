/**
 * Time module cron (five fields, UTC; the kernel's minute job runs what matches).
 *   time_auto_attendance  every 30 minutes: attendance from punches for yesterday and today in every entity
 *   time_review           hourly, only with the Weekly timesheet check switched on: at 07:00 local on an entity's first workweek day, last week goes to your AI agent when punches are missing
 */
module.exports = [
  { name: 'time_auto_attendance', schedule: '*/30 * * * *', fn: 'lib_time.cronAuto' },
  { name: 'time_review', schedule: '5 * * * *', fn: 'lib_time_sheet.cronReview' },
];
