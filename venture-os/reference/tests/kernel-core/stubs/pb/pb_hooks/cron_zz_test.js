/**
 * SCRATCH ONLY: the fake module's cron (a catch-up job). Never shipped.
 */
module.exports = [{ name: 'tick', schedule: '0 7 * * *', fn: 'lib_zz_test.tick', catchUp: true }];
