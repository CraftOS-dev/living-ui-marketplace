// SCRATCH ONLY (performance tests): run the module's cron functions on demand. Never shipped.
const B = (desc) => ({ type: 'boolean', desc: desc });
module.exports = [
  { name: 'perftest.cron', method: 'POST', fn: 'lib_perftest.cron', perm: 'signed', effect: 'write', desc: 'Test: run the performance cron function as the minute job would.', params: {} },
  { name: 'perftest.remind', method: 'POST', fn: 'lib_perftest.remind', perm: 'signed', effect: 'write', desc: 'Test: run review and training reminders now (hour and weekday ignored).', params: { training: B('training reminders too') } },
];
