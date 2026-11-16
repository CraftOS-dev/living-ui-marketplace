/**
 * markets cron (five fields in the firm's zone; fn(app)):
 *   radars       every minute, runs the radars whose own schedule is due
 *                (daily or weekly at HH:MM); a radar missed while the app
 *                was down is due at the first minute after boot
 *   prefetch     every 15 minutes, reads new Form D filings and Show HN
 *                stories for each active radar, delivered with its next run
 *   map_refresh  Monday 07:00, asks your AI agent to refresh every map
 *   cleanup      nightly, deletes signals screened out or known 60+ days ago
 *   news         every 2 hours, searches the public news in every category
 *                (portfolio, pipeline, competitors, policy, exits, funding,
 *                macro, sectors), with pictures where the feed carries one
 *   news_digest  daily 07:30, asks your AI agent to pick and summarize the
 *                news found since the last digest
 *   news_insights daily 08:15, asks your AI agent for its take on the
 *                week's news (3 to 6 insights)
 *   news_cleanup nightly, deletes news older than 60 days
 */
module.exports = [
  { name: 'radars', schedule: '* * * * *', fn: 'lib_markets.cronRadars', catchUp: false },
  { name: 'prefetch', schedule: '7,22,37,52 * * * *', fn: 'lib_markets.cronPrefetch', catchUp: false },
  { name: 'map_refresh', schedule: '0 7 * * 1', fn: 'lib_markets_maps.cronMaps', catchUp: true },
  { name: 'cleanup', schedule: '47 3 * * *', fn: 'lib_markets.cronCleanup', catchUp: false },
  { name: 'news', schedule: '11 */2 * * *', fn: 'lib_markets_news.cronNews', catchUp: true },
  { name: 'news_digest', schedule: '30 7 * * *', fn: 'lib_markets_news.cronDigest', catchUp: true },
  { name: 'news_insights', schedule: '15 8 * * *', fn: 'lib_markets_insights.cronInsights', catchUp: true },
  { name: 'news_cleanup', schedule: '53 3 * * *', fn: 'lib_markets_news.cronCleanup', catchUp: false },
];
