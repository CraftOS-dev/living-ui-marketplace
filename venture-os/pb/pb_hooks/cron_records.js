/**
 * kernel-records cron: the text step of stored files. Every minute it stores
 * the engine's finished answers, retries a file whose engine stopped without
 * one, and starts waiting files (lib_files.textTick, a few milliseconds when
 * there is nothing to do).
 */
module.exports = [{ name: 'text_step', schedule: '* * * * *', fn: 'lib_files.textTick', catchUp: false }];
