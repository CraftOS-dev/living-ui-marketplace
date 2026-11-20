// SCRATCH ONLY (kernel-backend tests).
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc) => ({ type: 'number', desc: desc });
const B = (desc) => ({ type: 'boolean', desc: desc });
module.exports = [
  { name: 'testkit.open', method: 'POST', fn: 'lib_testkit.open', perm: 'signed', effect: 'write', desc: 'Test: open an approval.', params: { kind: S('kind'), employment: S('employment'), summary: S('summary'), amount_minor: N('amount'), currency: S('currency'), days: N('days'), needs_pin: B('pin') } },
  { name: 'testkit.emit', method: 'POST', fn: 'lib_testkit.emit', perm: 'signed', effect: 'write', desc: 'Test: emit test.ping.', params: { n: N('n') } },
  { name: 'testkit.state', method: 'GET', fn: 'lib_testkit.state', perm: 'signed', effect: 'read', desc: 'Test: what subscribers saw.' },
  { name: 'testkit.contract', method: 'GET', fn: 'lib_testkit.contract', perm: 'signed', effect: 'read', desc: 'Test: kernel contract functions.', params: { employment: S('employment', { required: true }), day: S('day', { required: true }), from: S('from'), to: S('to') } },
  { name: 'testkit.tick', method: 'POST', fn: 'lib_testkit.tick', perm: 'signed', effect: 'write', desc: 'Test: run the minute and hourly jobs.' },
];
