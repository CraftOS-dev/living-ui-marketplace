/**
 * Catalog: the app itself (guide, status, the day, search, first-run setup).
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});

module.exports = [
  { name: 'app.guide', method: 'GET', fn: 'lib_guide.guide', perm: 'signed', effect: 'read', desc: 'Read this first: the rules for your AI agent, how to read answers, the modules with their op groups and triggers, a recipe per trigger. --module <name> gives a module in full; --recipe <trigger> one recipe.', params: { module: S('A module from the index, e.g. intake'), recipe: S('A trigger, e.g. deck_triage') } },
  { name: 'app.status', method: 'GET', fn: 'lib_guide.status', perm: 'signed', effect: 'read', desc: 'The state of the app: firm, zone, today and the local time, setup steps, counts (funds, members, pending proposals, questions waiting for your AI agent, drafts), the triggers, whether the Gmail bridge is connected. --detail true adds installed modules, event subscriptions and cron.', params: { detail: { type: 'boolean', desc: 'true: also the modules, event subscriptions, cron schedules and server' } } },
  { name: 'app.today', method: 'GET', fn: 'lib_guide.today', perm: 'signed', effect: 'read', desc: "The caller's day: today in the firm's zone, the top of Next, tasks due, questions waiting for your AI agent, unread notifications, and a block from each module (meetings, votes due, alerts)." },
  { name: 'app.batch', method: 'GET', fn: 'lib_ops.batch', perm: 'signed', effect: 'read', desc: 'Several reads in one request (a page first load): --calls \'[{"op":"next.list","params":{}}]\' (at most 12). Each answers { op, status, data } or its error; one failing call does not stop the others.', params: { calls: S('JSON list of {op, params}, reads only', { required: true }) } },
  { name: 'search.query', method: 'GET', fn: 'lib_search.query', perm: 'signed', effect: 'read', desc: 'Search funds, people, companies, deals, LPs and files the caller may see (each module adds its own records).', params: { q: S('At least two characters', { required: true }), limit: N('Results per module (default 6)') } },
  { name: 'setup.status', method: 'GET', fn: 'lib_settings.setupStatus', perm: 'public', effect: 'read', desc: 'Whether Venture OS still needs its first-run setup (no accounts yet), with the time zones it knows.' },
  {
    name: 'setup.complete',
    method: 'POST',
    fn: 'lib_settings.setupComplete',
    perm: 'public',
    agent: 'deny',
    effect: 'write',
    track: false,
    desc: 'First run: the firm (name, base currency, zone), the management company, the first fund (name, size, vintage, currency) and the owner (password and PIN). Answers the session and a recovery code shown once.',
    params: {
      firm_name: S('Firm name', { required: true, example: '"Northwind Ventures"' }),
      base_currency: S('Base currency, e.g. USD', { required: true }),
      zone: S('IANA time zone of the firm, e.g. America/New_York (default UTC)'),
      fund_name: S('First fund, e.g. "Fund I"', { required: true }),
      fund_size: S('Fund size in the fund currency (major units)'),
      fund_vintage: N('Vintage year (default this year)'),
      fund_currency: S('Fund currency (default the base currency)'),
      owner_name: S('Your name', { required: true }),
      email: S('Your email (sign-in)', { required: true }),
      password: S('Sign-in password (8 characters or more)', { required: true, secret: true }),
      pin: S('Six-digit approval PIN', { required: true, secret: true }),
    },
  },
];
