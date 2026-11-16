/**
 * Catalog: market research (fix 4). The pulse of each thesis sector, one
 * research page per sector (funding by month, recent rounds, market map,
 * key companies, competitors) and market briefs: a person asks, your AI
 * agent writes a structured brief with numbered citations.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});

module.exports = [
  {
    name: 'markets.pulse',
    method: 'GET',
    fn: 'lib_markets_research.opPulse',
    perm: 'markets:view',
    effect: 'read',
    desc: 'One line per thesis sector: news items and funding rounds found per week for 8 weeks, new companies found in those weeks, the latest insight.',
  },
  {
    name: 'markets.sector',
    method: 'GET',
    fn: 'lib_markets_research.opSector',
    perm: 'markets:view',
    effect: 'read',
    desc: 'One thesis sector: funding rounds and dollars by month (6 months, from Form D filings and Funding news that reports a round), the recent rounds, its market maps, key companies (portfolio, pipeline, tracked), competitors of the portfolio, the latest insight.',
    params: { sector: S('Sector key, e.g. fintech', { required: true }) },
  },
  {
    name: 'research.list',
    method: 'GET',
    fn: 'lib_markets_research.opList',
    perm: 'markets:view',
    effect: 'read',
    desc: 'Market briefs, newest first: title, topic, sector, status (requested, writing, ready, failed), summary, who asked.',
    params: { limit: N('Briefs (default 30, at most 100)') },
  },
  {
    name: 'research.get',
    method: 'GET',
    fn: 'lib_markets_research.opGet',
    perm: 'markets:view',
    effect: 'read',
    desc: 'One market brief: its sections (market overview, size, trends, key players, recent funding, risks, what it means for the firm) with [n] marks and the numbered citations.',
    params: { report: S('Brief id', { required: true }) },
  },
  {
    name: 'research.ask',
    method: 'POST',
    fn: 'lib_markets_research.opAsk',
    perm: 'markets:view',
    agent: 'deny',
    effect: 'write',
    desc: 'Ask your AI agent for a market brief on a topic (--topic "Embedded payments for vertical software") or a thesis sector (--sector fintech).',
    params: { topic: S('What the brief is about'), sector: S('A thesis sector key') },
  },
  {
    name: 'research.save',
    method: 'POST',
    fn: 'lib_markets_research.opSave',
    perm: 'markets:view',
    effect: 'write',
    desc: 'Yours only (trigger market_brief): --report --sections \'[{"key":"overview","body":"... [1]"}, ...]\' (keys overview, size, trends, players, funding, risks, implications; [n] marks cite) --citations \'[{"n":1,"title":"...","url":"<link to the source>","source":"..."}]\' --summary (one or two sentences). Never invent a figure.',
    params: {
      report: S('Brief id (payload.report)', { required: true }),
      sections: S('JSON list of {"key","body"}', { required: true }),
      citations: S('JSON list of {"n","title","url","source"}', { required: true }),
      summary: S('The brief in one or two sentences'),
      title: S('A better title (optional)'),
    },
  },
  {
    name: 'research.delete',
    method: 'POST',
    fn: 'lib_markets_research.opDelete',
    perm: 'markets:edit',
    agent: 'deny',
    effect: 'write',
    desc: 'Remove a market brief (Undo brings it back).',
    params: { report: S('Brief id', { required: true }) },
  },
];
