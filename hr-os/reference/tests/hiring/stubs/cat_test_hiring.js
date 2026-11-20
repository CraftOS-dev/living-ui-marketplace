// SCRATCH ONLY (hiring tests). Never copied into APP.
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
module.exports = [
  { name: 'testhiring.cron', method: 'POST', fn: 'lib_testhiring.cron', perm: 'signed', agent: 'deny', effect: 'write', desc: 'Test: run a hiring cron function now.', params: { which: S('retention | messages', { required: true }) } },
  { name: 'testhiring.backdate', method: 'POST', fn: 'lib_testhiring.backdate', perm: 'signed', agent: 'deny', effect: 'write', desc: 'Test: set a candidate retention day.', params: { candidate: S('candidate', { required: true }), retain_until: S('day', { required: true }) } },
  { name: 'testhiring.facts', method: 'GET', fn: 'lib_testhiring.facts', perm: 'signed', effect: 'read', desc: 'Test: profile facts of an employment.', params: { employment: S('employment', { required: true }) } },
];
