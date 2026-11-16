/**
 * Funds cron (five fields in the firm's zone; fn(app)): each morning, calls
 * fully paid are settled and finance hears once about payments past due.
 */
module.exports = [{ name: 'daily', schedule: '12 8 * * *', fn: 'lib_funds.daily', catchUp: true }];
