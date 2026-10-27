/**
 * Catalog: the founders.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});

const FOUNDER = S('Founder id or full name', { required: true });
const FIELDS = {
  role: S('Title, e.g. CEO, CTO'),
  email: S('Email'),
  linkedin: S('LinkedIn URL'),
  github: S('GitHub URL'),
  x: S('X (Twitter) URL'),
  website: S('Personal site'),
  location: S('Where they live now, e.g. "San Francisco, US"'),
  education: S('Education, one line per school with degree and year'),
  work: S('Work history, one line per role with years'),
  technical: B('Writes code or does the technical work (leave out when not known)'),
  full_time: B('Works on the company full-time (leave out when not known)'),
  equity: N('Equity percent, 0 to 100'),
  need: S('Your AI agent: what you need this founder to tell you ("" clears it)'),
};

module.exports = [
  { name: 'founders.list', method: 'GET', fn: 'lib_team.list', effect: 'read', desc: 'The founders with their facts (technical, full-time, equity) and whether they confirmed them.', params: {} },
  { name: 'founders.get', method: 'GET', fn: 'lib_team.get', effect: 'read', desc: 'One founder with their profile answers (most impressive thing, hack story, things built, awards).', params: { founder: FOUNDER } },
  { name: 'founders.add', method: 'POST', fn: 'lib_team.add', effect: 'write', desc: 'Add a founder. Never guess equity, technical or full-time: leave them out and ask with --need.', params: Object.assign({ name: S('Full name', { required: true }) }, FIELDS) },
  { name: 'founders.update', method: 'POST', fn: 'lib_team.update', effect: 'write', desc: 'Change a founder\'s facts. Your AI agent fills empty fields; values a founder confirmed are kept and reported back.', params: Object.assign({ founder: FOUNDER, name: S('Full name') }, FIELDS) },
  { name: 'founders.confirm', method: 'POST', fn: 'lib_team.confirm', effect: 'confirm', agent: 'deny', press: '"Looks right" on the card of that founder on the Team step', desc: 'A founder confirms their row is right.', params: { founder: FOUNDER } },
  { name: 'founders.reorder', method: 'POST', fn: 'lib_team.reorder', effect: 'write', desc: 'Put the founders in order (the first is the lead).', params: { order: S('JSON list of founder ids or names in order', { required: true }) } },
  { name: 'founders.remove', method: 'POST', fn: 'lib_team.remove', effect: 'write', destructive: true, lookup: 'lib_team.lookup', desc: 'Remove a founder and their profile answers.', params: { founder: FOUNDER } },
];
