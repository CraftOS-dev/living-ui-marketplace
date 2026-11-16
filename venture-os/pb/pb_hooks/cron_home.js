/**
 * Home cron. The morning digest goes out at the digest time (settings
 * home.digest_time, default 07:00) in each member's own zone, so the tick
 * runs every 15 minutes and sends each member's digest once per local day,
 * before noon, only to members who turned it on. No catch-up: a digest of a
 * morning that has passed is not sent late.
 */
module.exports = [{ name: 'home_digest', schedule: '*/15 * * * *', fn: 'lib_home.digestTick', catchUp: false }];
