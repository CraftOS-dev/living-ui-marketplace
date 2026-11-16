/**
 * Catalog: deals and pipelines (kernel-records). Agent rules (REPORT Table
 * 34): reads within scope; opening an open deal at the pipeline's first
 * stage, filling empty fields (records.enrich) and adding founders and
 * contacts are direct; other updates, moves, assignment and the deal team
 * are proposals; restricting and status changes are people only.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});

const STATUSES = ['open', 'invested', 'passed', 'lost', 'hold'];
const SOURCES = ['inbound', 'referral', 'outbound', 'scout', 'event', 'sourced', 'co_investor', 'portfolio', 'other'];
const ROUND_TYPES = ['pre_seed', 'seed', 'seed_extension', 'series_a', 'series_b', 'series_c', 'series_d_plus', 'bridge', 'other'];
const INSTRUMENTS = ['safe_cap', 'safe_discount', 'safe_mfn', 'note', 'priced', 'other'];
const DEAL = S('Deal id or display id', { required: true, example: 'D-0012' });
const TERMS = {
  round_type: S('Round', { enum: ROUND_TYPES }),
  raise: S('Round size in major units of the currency, e.g. 3000000'),
  pre_money: S('Pre-money valuation in major units'),
  post_money: S('Post-money valuation in major units'),
  check: S('The firm\'s check in major units'),
  currency: S('Currency of the round and check (default: the firm\'s)'),
  instrument: S('Instrument', { enum: INSTRUMENTS }),
};
const LIST = {
  pipeline: S('deal_flow (default), spv, lp_raise, program'),
  status: S('active (open and hold, the default), all, or one status', { enum: ['active', 'all'].concat(STATUSES) }),
  point: S('Point partner: member id or email, or "me"'),
  fund: S('Fund id or name'),
  company: S('Company id, domain or name'),
  q: S('Search: display id, deal name, company name or domain'),
  restricted: B('true: only restricted deals; false: only open ones'),
};

module.exports = [
  {
    name: 'deals.list',
    method: 'GET',
    fn: 'lib_deals.opList',
    perm: 'signed',
    effect: 'read',
    desc: 'Deals you may see, newest activity first, with stage, days in stage and stall: filters --pipeline, --stage, --status, --point, --fund, --company, --q, --min_days (in their stage at least N days; deals.stalls --days N is the stall list). hidden counts deals that match but are restricted from you.',
    params: Object.assign({}, LIST, { pipeline: S('One pipeline: deal_flow, spv, lp_raise or program (default: every pipeline)'), stage: S('Stage key'), min_days: N('Only deals in their current stage at least this many days'), sort: S('updated, created, stage_entered_at, number or days_in_stage (longest in stage first)', { enum: ['updated', 'created', 'stage_entered_at', 'number', 'days_in_stage'] }), limit: N('Rows (default 50)'), offset: N('Rows to skip') }),
  },
  {
    name: 'deals.board',
    method: 'GET',
    fn: 'lib_deals.opBoard',
    perm: 'signed',
    effect: 'read',
    desc: 'One pipeline as a board: each stage with its count and its deals, longest in stage first, stalled ones flagged (days in stage past the stage\'s stall days). hidden counts restricted deals you may not see.',
    params: Object.assign({}, LIST, { limit: N('Deals per stage (default 100)') }),
  },
  {
    name: 'deals.get',
    method: 'GET',
    fn: 'lib_deals.opGet',
    perm: 'signed',
    effect: 'read',
    desc: 'One deal in full: company, pipeline stages and where the deal is, status, point partner, deal team, founders and contacts, round terms and check (minor units), ownership_ppm, fund, restriction, provenance, file count. Restricted deals answer 403 restricted unless you may see them.',
    params: { deal: DEAL },
  },
  {
    name: 'deals.create',
    method: 'POST',
    fn: 'lib_deals.opCreate',
    perm: 'pipeline:edit',
    agent: 'allow',
    effect: 'write',
    desc: 'Open a deal for a company (found or created by id, domain or name) at the pipeline\'s first stage. One open deal per company and pipeline (409 duplicate names it). For you, a later --stage becomes a proposal. --people \'[{"person":"jane@acme.com","role":"founder"}]\'.',
    params: Object.assign(
      {
        company: S('Company id, domain or name', { required: true, example: 'acme.com' }),
        pipeline: S('deal_flow (default), spv, lp_raise, program'),
        stage: S('Stage key (default: the first stage)'),
        name: S('Deal name (default: the company name)'),
        source: S('How the deal came', { enum: SOURCES }),
        source_person: S('Who brought it: person id or email'),
        point: S('Point partner: member id or email, or "me" (default: you)'),
        fund: S('Fund id or name'),
        restricted: B('true: only the deal team and the owner see it'),
        agent_allowed: B('true: your AI agent may work on this restricted deal'),
        people: S('JSON list of {"person","role"} (role founder, contact, co_investor, advisor, referrer)'),
        source_ref: S('Where the deal came from (a link, an email)'),
      },
      TERMS,
    ),
  },
  {
    name: 'deals.update',
    method: 'POST',
    fn: 'lib_deals.opUpdate',
    perm: 'pipeline:edit',
    agent: 'propose',
    kind: 'note_fields',
    auto: 'lib_deals.autoUpdate',
    preview: 'lib_deals.previewUpdate',
    effect: 'write',
    desc: 'Change a deal\'s name, source, terms, fund or tags. For you it is a proposal (to fill empty fields directly use records.enrich --deal).',
    params: Object.assign({ deal: DEAL, name: S('Deal name'), source: S('How the deal came', { enum: SOURCES }), source_person: S('Person id or email'), fund: S('Fund id or name'), tags: S('JSON list of tags'), source_ref: S('Where the values came from') }, TERMS),
  },
  {
    name: 'deals.move',
    method: 'POST',
    fn: 'lib_deals.opMove',
    perm: 'pipeline:edit',
    agent: 'propose',
    kind: 'stage_moves',
    auto: 'lib_deals.autoMove',
    preview: 'lib_deals.previewMove',
    effect: 'write',
    desc: 'Move an open deal to another stage of its pipeline (writes a stage event; emits deal.moved). For you it is a proposal (when the owner promoted stage moves, only a move to screen runs directly).',
    params: { deal: DEAL, stage: S('Stage key or label', { required: true, example: 'first_meeting' }), note: S('Why, in a line'), on_day: S('People: the day it really moved, when logging an earlier move (YYYY-MM-DD, not in the future)') },
  },
  {
    name: 'deals.status',
    method: 'POST',
    fn: 'lib_deals.opStatus',
    perm: 'pipeline:edit',
    agent: 'deny',
    effect: 'write',
    desc: 'Set a deal\'s status: open (reopen), invested, passed, lost or hold, with a reason. Emits deal.closed for every status but open.',
    params: { deal: DEAL, status: S('New status', { required: true, enum: STATUSES }), reason: S('Why, in a line') },
  },
  {
    name: 'deals.assign',
    method: 'POST',
    fn: 'lib_deals.opAssign',
    perm: 'pipeline:edit',
    agent: 'propose',
    kind: 'deals',
    preview: 'lib_deals.previewAssign',
    effect: 'write',
    desc: 'Make a member the point partner of a deal (they join the deal team; the former point partner stays on it). For you it is a proposal.',
    params: { deal: DEAL, point: S('Member id or email, or "me"', { required: true }) },
  },
  {
    name: 'deals.team',
    method: 'POST',
    fn: 'lib_deals.opTeam',
    perm: 'pipeline:edit',
    agent: 'propose',
    kind: 'deals',
    preview: 'lib_deals.previewTeam',
    effect: 'write',
    desc: 'Add or remove members of a deal\'s team (--add and --remove: JSON lists of member ids or emails). The team sees a restricted deal and its NDA files. For you it is a proposal.',
    params: { deal: DEAL, add: S('JSON list of member ids or emails'), remove: S('JSON list of member ids or emails') },
  },
  {
    name: 'deals.people',
    method: 'POST',
    fn: 'lib_deals.opPeople',
    perm: 'pipeline:edit',
    agent: 'allow',
    effect: 'write',
    desc: 'Add or remove founders and contacts of a deal: --add \'[{"person":"jane@acme.com","role":"founder"}]\' (a person by id, email or {"name","email"}, created when new; roles founder, contact, co_investor, advisor, referrer), --remove \'["jane@acme.com"]\'.',
    params: { deal: DEAL, add: S('JSON list of {"person","role"}'), remove: S('JSON list of person ids or emails'), source_ref: S('Where you found them') },
  },
  {
    name: 'deals.restrict',
    method: 'POST',
    fn: 'lib_deals.opRestrict',
    perm: 'pipeline:edit',
    agent: 'deny',
    effect: 'write',
    desc: 'Restrict a deal to its deal team (and the owner), or open it to the firm; --agent_allowed lets your AI agent work on a restricted deal. Restricting puts you on the team.',
    params: { deal: DEAL, restricted: B('true: only the deal team sees it'), agent_allowed: B('true: your AI agent may work on it') },
  },
  {
    name: 'pipelines.list',
    method: 'GET',
    fn: 'lib_deals.opPipelines',
    perm: 'signed',
    effect: 'read',
    desc: 'The pipelines with their stages (key, label, stall days) and open deals each. deal_flow always exists; spv, lp_raise and program appear when first used.',
  },
  {
    name: 'pipelines.save',
    method: 'POST',
    fn: 'lib_deals.opPipelineSave',
    perm: 'settings:edit',
    agent: 'deny',
    effect: 'write',
    desc: 'Rename a pipeline or set its stages: --stages \'[{"key":"screen","label":"Screen","stall_days":7}]\' (keep a stage\'s key to keep its deals; stall_days 0 never stalls; a stage holding deals cannot be removed).',
    params: { pipeline: S('Pipeline key or id: deal_flow, spv, lp_raise, program', { required: true }), name: S('Pipeline name'), stages: S('JSON list of {"key","label","stall_days"}') },
  },
];
