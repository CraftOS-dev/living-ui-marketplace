/**
 * Deals module cron (firm zone): every morning at 08:00 the point partner of
 * each deal that stalled (days in stage past the stage's stall days) is told
 * once, and empty meeting drafts nobody wrote in 30 days are cleared. The
 * stall itself shows in Next (kind stall) as soon as it happens.
 */
module.exports = [{ name: 'deal_stalls', schedule: '0 8 * * *', fn: 'lib_deals_flow.stallCron', catchUp: true }];
