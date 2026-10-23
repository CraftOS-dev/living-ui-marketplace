/**
 * Catalog: Discover (searches, saved searches and alerts, candidates), the
 * citation map and reference lists.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});

const SEARCH = {
  sources: S('Registries, comma-separated: crossref, arxiv, openalex, pubmed (default crossref, arxiv, openalex)'),
  from_year: N('From this year'),
  to_year: N('Up to this year'),
  type: S('Kind', { enum: ['article', 'preprint', 'book', 'conference'] }),
  oa: B('Open access only'),
  rows: N('Results per registry (default 20)'),
};

module.exports = [
  {
    name: 'search.run',
    method: 'POST',
    fn: 'lib_discover.run',
    effect: 'capture',
    desc: 'Search the registries now (a new query, or a saved search again with --search). The run records each executed query, counts per registry and why it stopped; results become candidates.',
    params: Object.assign({ search: S('A saved search to run again'), query: S('What to search for'), name: S('A name to keep it under'), save: B('Keep it as a saved search'), project: S('The project it is for') }, SEARCH),
  },
  { name: 'search.list', method: 'GET', fn: 'lib_discover.searches', effect: 'read', desc: 'Saved searches (or every recent search with --saved false), with their last run and new candidates.', params: { saved: B('Only saved ones (default true)'), limit: N('Rows') } },
  { name: 'search.get', method: 'GET', fn: 'lib_discover.getSearch', effect: 'read', desc: 'One search with its runs (executed queries and counts).', params: { search: S('Search', { required: true }) } },
  { name: 'search.update', method: 'POST', fn: 'lib_discover.update', effect: 'capture', desc: 'Name a search, keep it, set an alert (off, daily, weekly) or change its query and filters.', params: Object.assign({ search: S('Search', { required: true }), name: S('Name'), saved: B('Keep it'), alert: S('Alert', { enum: ['off', 'daily', 'weekly'] }), query: S('Query') }, SEARCH) },
  { name: 'search.delete', method: 'POST', fn: 'lib_discover.remove', effect: 'change', agent: 'deny', destructive: true, desc: 'Delete a search and its candidates (papers added from it stay).', params: { search: S('Search', { required: true }) } },
  { name: 'candidates.list', method: 'GET', fn: 'lib_discover.candidates', effect: 'read', desc: 'Candidates of a search (or all), by triage (new, relevant, not_relevant, added, dismissed; comma-separated), sorted by rank, citations, year or newest.', params: { search: S('Search'), triage: S('Triage states'), sort: S('Order', { enum: ['rank', 'cited_by', 'year', 'newest'] }), limit: N('Rows'), offset: N('Skip') } },
  { name: 'candidates.triage', method: 'POST', fn: 'lib_discover.triage', effect: 'judge', agent: 'deny', desc: 'Mark candidates relevant, not relevant, dismissed, or new again.', params: { candidates: S('Candidate ids', { required: true }), triage: S('Triage', { required: true, enum: ['new', 'relevant', 'not_relevant', 'dismissed'] }) } },
  { name: 'candidates.add', method: 'POST', fn: 'lib_discover.add', effect: 'capture', agent: 'deny', desc: 'Add candidates to the library (by their identifiers).', params: { candidates: S('Candidate ids', { required: true }), collection: S('Collection'), project: S('Project') } },
  { name: 'candidates.file', method: 'POST', fn: 'lib_discover.file', effect: 'judge', desc: 'File papers you found with your own searching as candidates of a search: JSON [{"identifier":"10.x/..","title":"..","year":2024,"venue":"..","relevance":"high","reason":".."}]. Each needs an identifier.', params: { search: S('Search', { required: true }), items: S('JSON list', { required: true }) } },
  { name: 'candidates.assess', method: 'POST', fn: 'lib_discover.assess', effect: 'judge', desc: 'Your relevance (high, medium, low) and reason for candidates: JSON [{"candidate":"..","relevance":"high","reason":".."}].', params: { items: S('JSON list', { required: true }) } },
  { name: 'citations.map', method: 'GET', fn: 'lib_citemap.map', effect: 'read', desc: 'The citation network around seed papers (--works, --collection or --project): their references and the papers citing them, with Top cited (shared references) and Top citing (follow-on work). From OpenAlex.', params: { works: S('Seed papers'), collection: S('Collection'), project: S('Project'), citing: B('Include citing papers (default true)') } },
  { name: 'references.list', method: 'GET', fn: 'lib_citemap.refs', effect: 'read', desc: "A paper's reference list (Crossref or OpenAlex), each marked when it is in the library.", params: { work: S('Paper', { required: true }), fetch: B('Look it up when not stored yet (default true)') } },
  { name: 'citations.citing', method: 'GET', fn: 'lib_citemap.citing', effect: 'read', desc: 'Papers citing a paper, most cited first (OpenAlex).', params: { work: S('Paper', { required: true }), limit: N('How many (default 25)') } },
];
