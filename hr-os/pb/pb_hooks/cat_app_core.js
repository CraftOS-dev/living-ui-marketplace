/**
 * Catalog: the app itself (guide, status, home, setup, countries, search).
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});

module.exports = [
  { name: 'app.guide', method: 'GET', fn: 'lib_guide.guide', perm: 'signed', effect: 'read', desc: 'Read this first: the rules for your AI agent, how to read answers, the modules with their op groups and triggers, a recipe per trigger. --module <name>: a module in full; --recipe <trigger>: one.', params: { module: { type: 'string', desc: 'A module from the index, e.g. leave' }, recipe: { type: 'string', desc: 'A trigger, e.g. receipt_review' } } },
  { name: 'app.status', method: 'GET', fn: 'lib_guide.status', perm: 'signed', effect: 'read', desc: 'The state of the app: company, setup steps, counts (entities, people, members, pending approvals and proposals, questions waiting for an answer), installed countries and modules, event subscriptions.' },
  { name: 'app.home', method: 'GET', fn: 'lib_guide.home', perm: 'signed', effect: 'read', desc: 'Home facts for the caller: setup progress (administrators), approvals waiting, proposals, open agent jobs, people counts, starting and leaving soon, documents to acknowledge, unread notifications.' },
  { name: 'setup.status', method: 'GET', fn: 'lib_settings.setupStatus', perm: 'public', effect: 'read', desc: 'Whether HR OS still needs its first-run setup (no accounts yet).' },
  { name: 'setup.countries', method: 'GET', fn: 'lib_countries.listOp', perm: 'public', effect: 'read', desc: 'The countries HR OS knows (name, currency, time zone, regions, packs) for the setup screen.' },
  {
    name: 'setup.complete',
    method: 'POST',
    fn: 'lib_settings.setupComplete',
    perm: 'public',
    agent: 'deny',
    effect: 'write',
    desc: 'First run: create the company, its first entity (country defaults) and the owner (password and PIN). Answers the session and a one-time recovery code.',
    params: {
      company_name: S('Company name', { required: true, example: '"Northwind Global"' }),
      entity_name: S('First legal entity (default: the company name)'),
      legal_name: S('Registered legal name of the entity'),
      country: S('Country code of the entity, e.g. SG', { required: true }),
      region: S('Region code (state, prefecture), e.g. CA'),
      currency: S('Pay currency (default: the country currency)'),
      timezone: S('IANA time zone (default: the country one)'),
      reporting_currency: S('Currency for reports across entities (default: the entity currency)'),
      owner_name: S('Your name', { required: true }),
      email: S('Your email (sign-in)', { required: true }),
      password: S('Sign-in password (8 characters or more)', { required: true, secret: true }),
      pin: S('Six-digit approval PIN', { required: true, secret: true }),
    },
  },
  { name: 'countries.list', method: 'GET', fn: 'lib_countries.listOp', perm: 'signed', effect: 'read', desc: 'Countries HR OS knows: code, name, currency, time zone, regions, default packs, holiday years.' },
  { name: 'countries.get', method: 'GET', fn: 'lib_countries.getOp', perm: 'signed', effect: 'read', desc: 'One country in full: identity document types, bank file formats, default work week, employment and leave types, minimum wage reference, sources.', params: { country: S('Country code, e.g. JP', { required: true }) } },
  { name: 'search.query', method: 'GET', fn: 'lib_search.query', perm: 'signed', effect: 'read', desc: 'Search people, departments, entities, pay runs, leave requests, expense claims and candidates the caller may see.', params: { q: S('At least two characters', { required: true }), limit: N('Results per group (default 6)') } },
];
