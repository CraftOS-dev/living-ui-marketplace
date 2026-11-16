/**
 * Kernel cron (five fields, read in the firm's zone; fn(app)). The one
 * minute job of hooks.pb.js runs every matching entry of every cron_*.js.
 */
module.exports = [
  { name: 'reask', schedule: '* * * * *', fn: 'lib_agent.reask' },
  { name: 'outbound', schedule: '* * * * *', fn: 'lib_outbound.sendQueued' },
  { name: 'proposal_expiry', schedule: '23 3 * * *', fn: 'lib_proposals.expire', catchUp: true },
  { name: 'snooze_cleanup', schedule: '41 3 * * *', fn: 'lib_next.cleanup' },
  { name: 'fx_rates', schedule: '17 6 * * *', fn: 'lib_fx.refresh', catchUp: true },
  { name: 'optimize', schedule: '5 * * * *', fn: 'lib_util.optimize' },
];
