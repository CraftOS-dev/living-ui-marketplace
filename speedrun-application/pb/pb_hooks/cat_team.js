/**
 * Catalog: the founders.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});

const FOUNDER = S('Founder id or full name', { required: true });
const FIELDS = {
  first_name: S('First name, as the founder writes it'),
  last_name: S('Last name (family name)'),
  role: S('Title, e.g. CEO, CTO'),
  email: S('Email'),
  phone: S('Phone with country code, e.g. +1 415 555 2671'),
  linkedin: S('LinkedIn URL (required for the CEO on the form)'),
  github: S('GitHub URL'),
  x: S('X (Twitter) URL'),
  website: S('Portfolio: personal website, project portfolio or side project'),
  country: S('Country where they live, as the form lists it (questions.list countries), e.g. "United States of America"'),
  state: S('State, for the United States'),
  city: S('City where they live'),
  citizenship: S('Citizenship, a country as the form lists it'),
  college: S('College or university'),
  education: S('Highest education: "High School Degree", "Bachelor\'s Degree (BA, BS)", "Master\'s / Professional Degree (MD, MBA, JD, etc.)" or "Doctoral Degree (PhD)" ("" clears it)'),
  years: S('Years of professional experience, a whole number ("" when not known)'),
  technical: B('Technical enough to build the product end-to-end (leave out when not known)'),
  full_time: B('Works on the startup full-time (leave out when not known)'),
  need: S('Your AI agent: what you need this founder to tell you ("" clears it)'),
};

module.exports = [
  { name: 'founders.list', method: 'GET', fn: 'lib_team.list', effect: 'read', desc: 'The founders, CEO first, with the per-founder fields of speedrun\'s form and whether they confirmed them.', params: {} },
  { name: 'founders.get', method: 'GET', fn: 'lib_team.get', effect: 'read', desc: 'One founder with their relevant experience answer.', params: { founder: FOUNDER } },
  { name: 'founders.add', method: 'POST', fn: 'lib_team.add', effect: 'write', desc: 'Add a founder (founders hold over 10% equity; the first is the CEO who applies). Give --first_name and --last_name, or --name to split at the last word. Never guess technical, full-time or years: leave them out and ask with --need.', params: Object.assign({ name: S('Full name (split into first and last at the last word)') }, FIELDS) },
  { name: 'founders.update', method: 'POST', fn: 'lib_team.update', effect: 'write', desc: 'Change a founder\'s fields. Your AI agent fills empty fields; values a founder confirmed are kept and reported back.', params: Object.assign({ founder: FOUNDER, name: S('Full name (split into first and last at the last word)') }, FIELDS) },
  { name: 'founders.confirm', method: 'POST', fn: 'lib_team.confirm', effect: 'confirm', agent: 'deny', press: '"Looks right" on the card of that founder on the Team step', desc: 'A founder confirms their row is right.', params: { founder: FOUNDER } },
  { name: 'founders.reorder', method: 'POST', fn: 'lib_team.reorder', effect: 'write', desc: 'Put the founders in order: the first is the CEO who applies.', params: { order: S('JSON list of founder ids or names in order', { required: true }) } },
  { name: 'founders.remove', method: 'POST', fn: 'lib_team.remove', effect: 'write', destructive: true, lookup: 'lib_team.lookup', desc: 'Remove a founder and their relevant experience answer.', params: { founder: FOUNDER } },
];
