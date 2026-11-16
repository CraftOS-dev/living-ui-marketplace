// SCRATCH ONLY (kernel-backend tests).
module.exports = [{ name: 'test_every_minute', schedule: '* * * * *', fn: 'lib_testkit.cronPing' }];
