/**
 * Catalog: network capture, touches and relationship strength (SPEC 7.5).
 * Capture reads headers only, for members who opted in; consent is each
 * person's own and never your AI agent's. Strength and paths come from the
 * engines (lib_eng_strength, lib_eng_paths).
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});

const BANDS = ['strong', 'good', 'weak', 'none'];
const TARGET = { person: S('Person id or email'), company: S('Company id, domain or name') };

module.exports = [
  {
    name: 'capture.status',
    method: 'GET',
    fn: 'lib_network_capture.opStatus',
    perm: 'signed',
    effect: 'read',
    desc: 'Capture state: gmail (connected, waiting, offline = CraftBot is not connected, error), each source (mail_owner, mail_firm, calendar) with its last run, the firm capture settings, the mail labels used, and each member with their consent.',
    params: {},
  },
  {
    name: 'capture.consent',
    method: 'POST',
    fn: 'lib_network_capture.opConsent',
    perm: 'signed',
    agent: 'deny',
    effect: 'write',
    desc: 'A person turns capture of their own email headers and meetings on (--consent true) or off, and lists domains never captured for them (--exclude_domains). People only.',
    params: { consent: B('true to capture my email headers and meetings, false to stop'), exclude_domains: S('JSON list of domains never captured for me, e.g. ["family.com"]') },
  },
  {
    name: 'capture.configure',
    method: 'POST',
    fn: 'lib_network_capture.opConfigure',
    perm: 'settings:edit',
    agent: 'deny',
    effect: 'write',
    desc: 'The firm capture settings: the capture mailbox address members BCC, the CraftBot Gmail account that holds it, extra firm domains (members\' domains count already) and domains never captured for anyone. People only.',
    params: { capture_address: S('The capture mailbox address, e.g. capture@firm.com (empty to remove)'), capture_account: S('The CraftBot Gmail account name of the capture mailbox (empty: none)'), firm_domains: S('JSON list of the firm\'s own domains besides the members\''), exclude_domains: S('JSON list of domains never captured for anyone') },
  },
  {
    name: 'capture.sync',
    method: 'POST',
    fn: 'lib_network_capture.opSync',
    perm: 'signed',
    track: false,
    effect: 'write',
    desc: 'Read mail headers and the calendar now instead of waiting for the next run (at most once in 30 seconds). Answers each source\'s result.',
    params: { what: S('all, mail or calendar (default all)', { enum: ['all', 'mail', 'calendar'] }) },
  },
  {
    name: 'interactions.list',
    method: 'GET',
    fn: 'lib_network_capture.opList',
    perm: 'network:view',
    effect: 'read',
    desc: 'Touches (meetings, calls, emails, messages) newest first, of a --person, a --company (its people too), a --deal or a --member. A touch\'s subject shows only to its member and the owner (subject_hidden).',
    params: Object.assign({}, TARGET, { deal: S('Deal id or number'), member: S('Member email or id'), kind: S('meeting, call, email or message', { enum: ['meeting', 'call', 'email', 'message'] }), limit: N('Rows (default 50)'), offset: N('Rows to skip') }),
  },
  {
    name: 'interactions.log',
    method: 'POST',
    fn: 'lib_network_capture.opLog',
    perm: 'network:edit',
    agent: 'allow',
    effect: 'write',
    desc: 'Log one touch a member had with people outside the firm (a call, a meeting, an email, a message). --people takes ids or emails (new addresses become people). --ext_id makes a repeat count once. For you: give --member; only members who turned capture on.',
    params: { kind: S('meeting, call, email or message', { required: true, enum: ['meeting', 'call', 'email', 'message'] }), people: S('JSON list of person ids or emails', { required: true, example: '["maya@acmerobotics.ai"]' }), member: S('Whose touch (member email or id; default you)'), direction: S('in or out (emails and messages)', { enum: ['in', 'out'] }), at: S('When (ISO time or YYYY-MM-DD; default now)'), subject: S('Subject or one line'), deal: S('Deal id or number'), ext_id: S('Your own id for this touch, so logging it twice counts once') },
  },
  {
    name: 'network.strength',
    method: 'GET',
    fn: 'lib_network.opStrength',
    perm: 'network:view',
    effect: 'read',
    desc: 'How well the firm knows a --person (score 0 to 100, band strong, good, weak or none, last contact, and every member\'s own strength) or a --company (its best connection and each known person).',
    params: TARGET,
  },
  {
    name: 'network.paths',
    method: 'GET',
    fn: 'lib_network.opPaths',
    perm: 'network:view',
    effect: 'read',
    desc: 'Who knows a --person or a --company: ranked intro paths (direct before one hop through a person seen with the target; each scored by its weakest edge, with last contact) and the intros already asked.',
    params: TARGET,
  },
  {
    name: 'network.find',
    method: 'GET',
    fn: 'lib_network.opFind',
    perm: 'network:view',
    effect: 'read',
    desc: 'Companies and people matching --q (name, email, domain), each with the firm\'s strength: the "Who knows" field.',
    params: { q: S('Name, email or domain', { required: true }), limit: N('Of each kind (default 8)') },
  },
  {
    name: 'network.coverage',
    method: 'GET',
    fn: 'lib_network.opCoverage',
    perm: 'network:view',
    effect: 'read',
    desc: 'Pipeline and portfolio companies by their warmest connection (strong, good, weak, none), with counts per band.',
    params: { scope: S('all, pipeline or portfolio (default all)', { enum: ['all', 'pipeline', 'portfolio'] }), limit: N('Companies (default 200)') },
  },
  {
    name: 'network.people',
    method: 'GET',
    fn: 'lib_network.opPeople',
    perm: 'network:view',
    effect: 'read',
    desc: 'People with strength, last contact and owner (the member who knows them best). --q searches; --band, --company, --member, --known true narrow; --sort strength, last or name.',
    params: { q: S('Search text'), band: S('strong, good, weak or none', { enum: BANDS }), company: S('Company id, domain or name'), member: S('Member email or id'), known: B('true: only people the firm knows'), sort: S('strength, last or name', { enum: ['strength', 'last', 'name'] }), limit: N('Rows (default 50)'), offset: N('Rows to skip') },
  },
  {
    name: 'network.companies',
    method: 'GET',
    fn: 'lib_network.opCompanies',
    perm: 'network:view',
    effect: 'read',
    desc: 'Companies with strength, last contact, owner and people known. --relation pipeline or portfolio; --band, --known true narrow; --sort strength, last or name.',
    params: { q: S('Search text'), band: S('strong, good, weak or none', { enum: BANDS }), relation: S('all, pipeline or portfolio', { enum: ['all', 'pipeline', 'portfolio'] }), known: B('true: only companies the firm knows someone at'), sort: S('strength, last or name', { enum: ['strength', 'last', 'name'] }), limit: N('Rows (default 50)'), offset: N('Rows to skip') },
  },
  {
    name: 'network.record',
    method: 'GET',
    fn: 'lib_network.opRecord',
    perm: 'network:view',
    effect: 'read',
    desc: 'The figures of a company or person page: strength, last contact, best member, deals you can see, invested (true when the firm holds the company; on a person page their company), holdings (count) and invested_cost per currency (portfolio viewers), the next meeting, and for a company its logo_url (its own logo) and logo_domain (its website icon).',
    params: TARGET,
  },
  {
    name: 'network.recompute',
    method: 'POST',
    fn: 'lib_network.opRecompute',
    perm: 'network:edit',
    track: false,
    effect: 'write',
    desc: 'Recompute relationship strength now for a --person, a --company or everyone (it runs nightly and after each capture anyway).',
    params: TARGET,
  },
];
