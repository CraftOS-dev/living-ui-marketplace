/**
 * app.guide section and the full recipes of its triggers: markets (theses,
 * radars, signals, maps, news, market briefs). Plain data.
 */
module.exports = {
  title: 'Markets: theses, radars and maps',
  section: [
    'A thesis (theses.get) has one radar (radars.list --thesis): sources, structured filters, a query and a schedule. Venture OS itself pulls the keyless sources (SEC EDGAR Form D, Show HN, GitHub search) when the radar is due; UK Companies House and the Japan corporate registry need a key the app never holds, so when a radar lists them you search them with your own access.',
    'A pulled item is a signal. The app decides by rule only: screened_out (a structured filter, or a required thesis criterion unmet by its facts), known (already a company in the firm\'s records) or new. You screen the new ones (signals.screen) and add candidates from your own research (signals.add, always with --source_url and a one-line --summary). Data from a licensed source is --licence internal_only.',
    'People decide: a candidate goes to the Inbox (signals.to-inbox) or is dismissed (signals.dismiss). You never do either, and you never contact founders.',
    'Theses and radars: radars.save is a proposal for you; theses.save too (kernel). theses.summary answers one line per thesis.',
    'News (news.list --scope home|all|thesis|company|sector --ref --category, news.stats): the app searches the public news every 2 hours in eight categories (portfolio, pipeline, competitors, funding, exits, macro, policy, sectors), each item set by the search that found it, with a picture where the feed carries one. You never add news; you summarize the items that matter (news.summarize, trigger news_digest), may add a lead picture you found (news.set-image), and write your take (news.insight-save, trigger news_insights). People save, hide and add items.',
    'Market research (markets.pulse, markets.sector --sector, research.list, research.get): a person asks for a market brief (research.ask, trigger market_brief); you write it with research.save, every figure cited.',
    'Maps (maps.list, maps.get): segments are columns, companies are tiles. portfolio, pipeline and passed come from the firm\'s deals and holdings; tracked and competitor are placed. You propose tiles and moves with maps.propose --map --company (or --name --website for a new one) --segment --source_url --why; people accept them. maps.get --as_of YYYY-MM-DD shows an older map.',
  ],
  events: [],
  radar_sweep: [
    'Screen a radar\'s new signals against its thesis and add net-new candidates from your own research (trigger radar_sweep { radar_id }).',
    '1) radars.get --radar <radar_id> and theses.get --thesis <its thesis>: the criteria, the query and the sources (those marked for you: companies_house, jp_corporate).',
    '2) signals.list --radar <radar_id> --status new: for each, read its source link and what it carries, then decide. Keep it only when it is a real operating company that fits the thesis. Give the company name and domain when the item lacks them, one line on why it fits, and context you can source (founders and their history, hiring, connections to the firm from people.list and companies.list, any prior decision). signals.screen --items \'[...]\' in batches of at most 100; a dropped item gets a short reason.',
    '3) Your own research for the thesis: news, the registries the radar lists for you (companies_house, jp_corporate) with your own access, and any licensed source the firm gave you. For each net-new company: signals.add --radar <radar_id> --name --domain --summary --source_url --kind --context. Facts from licensed data get --licence internal_only. A company already known or already on the radar is answered, not added: move on.',
    '4) Never contact a founder, never add anything to the Inbox yourself, never invent a fact; mark unknowns as unknown.',
    '5) Your first screening (or addition) marks the sweep done.',
  ],
  map_refresh: [
    'Refresh a market map: propose new tiles and moves, each with its source (trigger map_refresh { map_id }).',
    '1) maps.get --map <map_id>: segments, the companies on it and their relation, the proposals already waiting (do not repeat them).',
    '2) Find companies that belong on the map and are missing, and companies whose segment changed. Use the firm\'s records (companies.list) and public sources; every proposal needs a link that shows it.',
    '3) maps.propose --map <map_id> --company <id, domain or exact name> (or --name --website for a company not in the records) --segment <key> --role tracked|competitor --source_url <link> --why "<one line>". To take a company off: --remove true with --why. Never change the segment of a portfolio company without a source.',
    '4) Your first proposal marks the refresh done. Nothing to propose: agent.cannot --trigger map_refresh --record <map_id> --reason "Nothing new: <what you checked>".',
  ],
  news_digest: [
    'Pick the news that matters for the firm and summarize each in one sentence (trigger news_digest).',
    '1) news.list --scope all --unsummarized true --limit 60 (then --cursor): the items found in the last 3 days without a summary (id, title, source, published_at, url, category, topic, about, image_url). Read each article at its url. It matters when it is really about that portfolio, pipeline or competitor company (not a namesake), or when it changes the picture for the firm: a funding round in a thesis sector, a new fund or LP move, an exit, a rate or market move, a regulation, a launch, a leadership change, a large customer.',
    '2) For the items that matter: news.summarize --items \'[{"id":"...","summary":"one sentence: what happened and why it matters to the firm"}]\' (at most 60). On a Funding item (category funding) that reports one company raising a round, add "round":{"company":"<name as written>","amount_usd":<whole dollars as the article states, or leave it out>,"stage":"Seed"}. Leave the others without a summary.',
    '3) Optional: for an item you summarized whose image_url is empty, when the article page shows its own lead picture, download that picture to a local file and run news.set-image --id <id> --paths \'["<absolute path>"]\' --source_url <article url>. Never draw, generate or edit a picture.',
    '4) Never invent news or facts, never add items, never summarize an article you could not read; say what the article says, with its numbers as written.',
    '5) Your first news.summarize marks the digest done.',
  ],
  news_insights: [
    "Write your take on the week's news for the firm: 3 to 6 insights (trigger news_insights).",
    '1) news.list --scope home --from <7 days ago> --limit 60 gives the items; news.insights shows your recent insights (do not repeat a title unless the news moved). Read the items (open the articles that matter) and the firm\'s context: theses.summary, maps.list, and for a company in an item companies.get. Group the news into what moves the firm: a portfolio company, a competitor of one, a thesis sector, the funding market, exits and the IPO window, rates and valuations, a regulation.',
    '2) Write 3 to 6 insights, each with news.insight-save --title "<the point in one line>" --analysis "<two to four sentences: what happened, with the numbers as the articles state them, and what it means for the firm>" --impact positive|negative|watch --affects \'[{"kind":"company|fund|thesis|sector","ref":"<id, name or sector key>"}]\' --news_ids \'["<the items it rests on>"]\' --next_step "<one concrete step for the team>".',
    '3) Every insight cites at least one item; never state a fact no cited item supports; do not repeat a recent title unless the news moved. Fewer than 3 is fine when the week has less to say. Your first insight marks the ask done.',
  ],
  market_brief: [
    'Write the market brief a person asked for (trigger market_brief { report_id }).',
    '1) research.get --report <report_id>: the topic and the sector. Research the topic from public sources: market reports, filings, reputable press, company sites. Use the firm\'s own view too: markets.sector --sector <sector> when given (funding rounds, map, key companies, competitors), news.list --scope sector --ref <sector>, news.insights --ref <sector>, maps.get.',
    '2) research.save --report <report_id> --summary "<the brief in one or two sentences>" --sections \'[{"key":"overview","body":"..."},{"key":"size","body":"..."},{"key":"trends","body":"..."},{"key":"players","body":"..."},{"key":"funding","body":"..."},{"key":"risks","body":"..."},{"key":"implications","body":"..."}]\' --citations \'[{"n":1,"title":"...","url":"<link to the source>","source":"Publisher"}]\'. Bodies are short paragraphs or lines starting with "- "; mark every fact with its source as [n]; the size section gives figures with their source and year.',
    '3) The implications section says what it means for the firm: its theses, portfolio companies and pipeline (by name), and the questions to answer next. Write "Not enough public information" for a section you cannot source; never invent a figure, a company or a quote.',
    '4) That save marks the brief ready. If you cannot write it: agent.cannot --trigger market_brief --record <report_id> --reason "<why>" (the report shows failed).',
  ],
};
