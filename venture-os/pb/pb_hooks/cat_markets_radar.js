/**
 * Catalog: markets sourcing (theses summary, radars, signals). Radars pull
 * keyless public sources on a schedule; your AI agent screens what they
 * pull and adds its own candidates; people add candidates to the Inbox or
 * dismiss them.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const PAGE = { limit: N('Rows (default 50)'), offset: N('Rows to skip') };
const RADAR = S('Radar id, or the thesis id or name');
const SOURCES = ['edgar_form_d', 'hacker_news', 'github', 'companies_house', 'jp_corporate'];
const SIGNAL_SOURCES = SOURCES.concat(['agent', 'person']);
const KINDS = ['raise_filed', 'launch', 'repo', 'incorporation', 'funding', 'hiring', 'founder_move', 'product', 'news', 'other'];

module.exports = [
  {
    name: 'theses.summary',
    method: 'GET',
    fn: 'lib_markets.opSummary',
    perm: 'markets:view',
    effect: 'read',
    desc: 'One line per thesis for the Markets page: net-new count (candidates plus unscreened), candidates added per week for 12 weeks, maps, and its radar (sources, schedule, last run with counts per source, the sweep step).',
    params: { status: S('active (default), archived or all', { enum: ['active', 'archived', 'all'] }) },
  },
  {
    name: 'radars.options',
    method: 'GET',
    fn: 'lib_markets.opOptions',
    perm: 'markets:view',
    effect: 'read',
    desc: 'What a radar can use: sources (by app: pulled by Venture OS; by agent: registries you search with your own access), default filters, Form D industry groups, US states, sector suggestions, stages, countries, dismiss reasons, the EDGAR User-Agent.',
  },
  {
    name: 'radars.list',
    method: 'GET',
    fn: 'lib_markets.opList',
    perm: 'markets:view',
    effect: 'read',
    desc: 'Radars with their thesis, sources, filters, query, schedule, next and last run, counts per source of the last run, open signals and the sweep step.',
    params: { thesis: S('Only the radar of this thesis (id or name)'), status: S('active, paused or all (default)', { enum: ['active', 'paused', 'all'] }) },
  },
  {
    name: 'radars.get',
    method: 'GET',
    fn: 'lib_markets.opGet',
    perm: 'markets:view',
    effect: 'read',
    desc: 'One radar (by id, or by its thesis).',
    params: { radar: Object.assign({ required: true }, RADAR) },
  },
  {
    name: 'radars.save',
    method: 'POST',
    fn: 'lib_markets.opSave',
    perm: 'markets:edit',
    agent: 'propose',
    kind: 'radars',
    preview: 'lib_markets.previewSave',
    effect: 'write',
    desc: 'Add the radar of a thesis (--thesis) or change one (--radar): --sources \'["edgar_form_d","hacker_news","github"]\', --filters \'{"edgar_form_d":{"industries":[...],"incorporated_within_years":5},"github":{"min_stars":50}}\', --query (GitHub search), --schedule "weekly mon 08:00" or "daily 08:00". For you it is a proposal.',
    params: {
      radar: S('Radar id, or its thesis (to change one)'),
      thesis: S('Thesis id or name (to add its radar)'),
      name: S('Name (default: the thesis name)'),
      sources: S('JSON list of: ' + SOURCES.join(', ')),
      filters: S('JSON {"edgar_form_d":{industries, states, incorporated_within_years, min_raise_minor, max_raise_minor, amendments}, "hacker_news":{min_points}, "github":{min_stars, created_within_days}}'),
      query: S('Keywords for GitHub search and for your own research'),
      schedule: S('"daily HH:MM" or "weekly mon HH:MM" in the firm zone'),
      status: S('active or paused', { enum: ['active', 'paused'] }),
      source_ref: S('Where the change came from'),
    },
  },
  {
    name: 'radars.run',
    method: 'POST',
    fn: 'lib_markets.opRun',
    perm: 'markets:edit',
    effect: 'write',
    track: false,
    desc: 'Run a radar now: pull its app sources (new items only), store each as a signal (filtered, known or new), then, when a person runs it, ask your AI agent to sweep it (trigger radar_sweep). Answers the counts per source and the request id.',
    params: { radar: Object.assign({ required: true }, RADAR) },
  },
  {
    name: 'signals.list',
    method: 'GET',
    fn: 'lib_markets.opSignals',
    perm: 'markets:view',
    effect: 'read',
    desc: 'Signals of a radar or thesis: open by default (candidates first, then new ones waiting for screening), each with source link, structured facts, thesis fit, your one line and context, licence.',
    params: Object.assign(
      {
        radar: S('Radar id, or the thesis id or name'),
        thesis: S('Thesis id or name'),
        status: S('open (default: new and candidate), all, or one of: new, candidate, screened_out, known, dismissed, added'),
        source: S('One source', { enum: SIGNAL_SOURCES }),
        run: N('Only this run number'),
      },
      PAGE,
    ),
  },
  {
    name: 'signals.add',
    method: 'POST',
    fn: 'lib_markets.opAdd',
    perm: 'markets:edit',
    effect: 'write',
    desc: 'Add a candidate to a radar from your research: --name or --domain, --summary (one line on the fit), --source_url (required), --kind, --context \'{"founders","hiring","connections","prior","traction","links"}\', --facts (fact keys), --licence internal_only for licensed data. A repeat or a known company is answered, not added.',
    params: {
      radar: RADAR,
      thesis: S('Thesis id or name (its radar)'),
      name: S('Company name'),
      domain: S('Company domain'),
      website: S('Company website'),
      title: S('Headline as the source states it'),
      summary: S('One line: why it fits the thesis'),
      kind: S('Signal kind', { enum: KINDS }),
      source: S('Where it came from (default: agent for you)', { enum: SIGNAL_SOURCES }),
      source_url: S('The link where it was found'),
      ext_id: S('The source\'s own id (dedupe)'),
      context: S('JSON {"founders","hiring","connections","prior","traction","links":[...]}'),
      facts: S('JSON of fact keys, e.g. {"sector":"fintech","raise_minor":300000000,"currency":"USD"}'),
      licence: S('public (default) or internal_only (licensed data; never in LP outputs)', { enum: ['public', 'internal_only'] }),
    },
  },
  {
    name: 'signals.screen',
    method: 'POST',
    fn: 'lib_markets.opScreen',
    perm: 'markets:edit',
    effect: 'write',
    desc: 'Your verdict on new signals: --items \'[{"id":"...","keep":true,"summary":"one line","name":"...","domain":"...","context":{...},"facts":{...}},{"id":"...","keep":false,"reason":"..."}]\' (at most 100). Kept ones become candidates unless the company is known.',
    params: { items: S('JSON list of verdicts', { required: true }) },
  },
  {
    name: 'signals.dismiss',
    method: 'POST',
    fn: 'lib_markets.opDismiss',
    perm: 'markets:edit',
    agent: 'deny',
    effect: 'write',
    desc: 'Dismiss candidates (one id or a JSON list), with an optional reason.',
    params: { signals: S('Signal id or JSON list of ids', { required: true }), reason: S('Reason', { enum: ['not_fit', 'too_early', 'too_late', 'competitor', 'other'] }) },
  },
  {
    name: 'signals.to-inbox',
    method: 'POST',
    fn: 'lib_markets.opToInbox',
    perm: 'markets:edit',
    agent: 'deny',
    effect: 'write',
    desc: 'Add candidates to the Inbox (one id or a JSON list): each becomes a sourced intake item with its company, link and context, and is read like any inbound deck.',
    params: { signals: S('Signal id or JSON list of ids', { required: true }) },
  },
];
