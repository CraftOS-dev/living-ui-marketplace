/**
 * markets registrations (SPEC 4.2): Next items (one "candidate" item per
 * radar run), its triggers (radar_sweep, map_refresh, news_digest,
 * news_insights, market_brief), Ctrl-K search over theses and maps, a
 * company's sourcing and map events in its timeline, and the Sourcing
 * settings (EDGAR User-Agent and how many items each source gives per run).
 * Plain data.
 */
module.exports = {
  on: {},
  needsYou: 'lib_markets.needsYou',
  triggers: {
    radar_sweep: {
      record: 'radars',
      param: 'radar_id',
      perm: 'markets:edit',
      label: 'Sweep a radar',
      description: "Your AI agent screens a radar run's new signals against its thesis and adds net-new candidates from its own research, each with its source",
      fires: 'Run on a radar, or each scheduled run while the switch is on',
      cooldown: 300,
      policy: { key: 'radar_sweeps', label: 'Scheduled radar sweeps', tip: 'Each radar run on its schedule is screened for new candidates.' },
      check: 'lib_markets.sweepCheck',
      lands: { 'signals.add': 'radar' },
      instruction:
        "Screen the new signals of radar radar_id against its thesis and add net-new candidates. 1) radars.get --radar <radar_id> and theses.get --thesis <its thesis>: criteria, query, sources. 2) signals.list --radar <radar_id> --status new: read each item's source; keep it only when it is a real operating company that fits. signals.screen --items '[{\"id\",\"keep\":true,\"summary\",\"context\"} | {\"id\",\"keep\":false,\"reason\"}]' in batches of up to 100 (the first marks it done). 3) Your own research for the thesis (news, registries the radar lists, licensed sources): signals.add --radar <radar_id> --name --domain --summary --source_url --kind (licensed facts: --licence internal_only). Never contact founders, never add to the Inbox, never invent a fact.",
    },
    map_refresh: {
      record: 'maps',
      param: 'map_id',
      perm: 'markets:view',
      label: 'Refresh a market map',
      description: 'Your AI agent proposes new tiles and moves for a market map, each with a source link; people accept them',
      fires: 'Refresh on a map, or every Monday while the switch is on',
      cooldown: 300,
      policy: { key: 'map_refresh', label: 'Weekly map refresh', tip: 'Every Monday each active market map gets proposed new tiles and moves.' },
      check: 'lib_markets_maps.refreshCheck',
      lands: { 'maps.propose': 'map' },
      instruction:
        "Refresh market map map_id: propose new tiles and moves, each with its source. 1) maps.get --map <map_id>: segments, the companies on it and their relation, and the proposals already waiting (do not repeat them). 2) Find companies that belong on the map and are missing, and companies whose segment changed, from the firm's records (companies.list) and public sources; every proposal needs a link that shows it. 3) maps.propose --map <map_id> --company <id, domain or exact name> (or --name --website for a new one) --segment <key> --role tracked|competitor --source_url <link> --why \"<one line>\" (the first marks it done); --remove true with --why takes one off. Never move a portfolio company without a source.",
    },
    news_digest: {
      record: '',
      param: '',
      perm: 'markets:view',
      label: 'Digest the news',
      description: 'Your AI agent picks the news that matters for the firm and summarizes each item in one sentence',
      fires: 'Every morning while the switch is on',
      cooldown: 72000,
      policy: { key: 'news_digest', label: 'Daily news digest and insights', tip: "Once a day: the news that matters, summarized, and your AI agent's take on the week." },
      check: 'lib_markets_news.digestCheck',
      instruction:
        "Pick the news that matters for the firm and summarize each in one sentence. 1) news.list --scope all --unsummarized true --limit 60 (then --cursor): items found in the last 3 days without a summary. 2) Read each article at its url. It matters when it is really about that portfolio, pipeline or competitor company (not a namesake), or changes the picture for the firm: a round in a thesis sector, a new fund, an exit, a rate move, a regulation, a launch, a leadership change. 3) news.summarize --items '[{\"id\",\"summary\":\"what happened and why it matters\"}]' (at most 60; on a Funding item add \"round\":{\"company\",\"amount_usd\",\"stage\"} as the article states). Never summarize an article you could not read.",
    },
    news_insights: {
      record: '',
      param: '',
      perm: 'markets:view',
      label: 'Write the take on the news',
      description: "Your AI agent writes 3 to 6 insights on the week's news for the firm, each citing the items it rests on",
      fires: 'Ask your AI agent on the news, or every morning while the switch is on',
      cooldown: 72000,
      policy: { key: 'news_digest', label: 'Daily news digest and insights', tip: "Once a day: the news that matters, summarized, and your AI agent's take on the week." },
      check: 'lib_markets_insights.askCheck',
      instruction:
        "Write your take on the last 7 days of news for the firm: 3 to 6 insights. 1) news.list --scope home --from <7 days ago> --limit 60 (open the articles that matter), news.insights (do not repeat a title unless the news moved), theses.summary, maps.list, and companies.get for a company in an item. 2) For each insight: news.insight-save --title \"<the point in one line>\" --analysis \"<two to four sentences with the numbers as the articles state them>\" --impact positive|negative|watch --affects '[{\"kind\":\"company|fund|thesis|sector\",\"ref\"}]' --news_ids '[\"...\"]' --next_step \"<one step>\" (the first marks it done). Every insight cites at least one item; never state a fact no cited item supports.",
    },
    market_brief: {
      record: 'research_reports',
      param: 'report_id',
      perm: 'markets:view',
      label: 'Write a market brief',
      description: 'Your AI agent researches a market from public sources and writes a seven-section brief with numbered citations',
      fires: 'Ask for a market brief (Markets, Research)',
      cooldown: 10,
      check: 'lib_markets_research.askCheck',
      asked: 'lib_markets_research.onAsked',
      ended: 'lib_markets_research.onCannot',
      instruction:
        "Write the market brief report_id. 1) research.get --report <report_id>: the topic and sector. Research public sources (reports, filings, press, company sites) and the firm's view: markets.sector --sector <sector>, news.list --scope sector --ref <sector>, maps.get. 2) research.save --report <report_id> --summary \"<one or two sentences>\" --sections '[{\"key\":\"overview\",\"body\":\"... [1]\"}, ...]' (keys overview, size, trends, players, funding, risks, implications) --citations '[{\"n\":1,\"title\",\"url\",\"source\"}]' (marks it done). Mark every fact [n]; implications name the firm's theses, portfolio and pipeline. Write \"Not enough public information\" for a section you cannot source; never invent a figure.",
    },
  },
  search: 'lib_markets.search',
  timeline: 'lib_markets.timelineFor',
  settingsKeys: { markets: { user_agent: '', edgar_limit: 25, hn_limit: 30, github_limit: 30 } },
};
