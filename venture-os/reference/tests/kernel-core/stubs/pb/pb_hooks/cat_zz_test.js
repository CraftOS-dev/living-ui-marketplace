/**
 * SCRATCH ONLY: the fake module's ops (kernel-core tests). Never shipped.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});

module.exports = [
  { name: 'zz.make', method: 'POST', fn: 'lib_zz_test.make', perm: 'network:edit', effect: 'write', desc: 'Test: make a thing (optionally asking your AI agent to review it).', params: { name: S('Name', { required: true }), value: N('Value'), deal: S('Deal id'), ask: B('Ask your AI agent to review it (trigger zz_review, asked by the caller)') } },
  { name: 'zz.save', method: 'POST', fn: 'lib_zz_test.save', perm: 'network:edit', agent: 'propose', kind: 'note_fields', auto: 'lib_zz_test.autoOk', effect: 'write', diff: { collection: 'zz_things', id: 'thing', fields: { name: 'name', value: 'value' } }, desc: 'Test: change a thing (a proposal for your AI agent).', params: { thing: S('Thing id', { required: true }), name: S('Name'), value: N('Value'), deal: S('Deal id or display id') } },
  { name: 'zz.half', method: 'POST', fn: 'lib_zz_test.half', perm: 'signed', effect: 'write', desc: 'Test: writes, then refuses (the write must roll back).', params: { name: S('Name') } },
  { name: 'zz.get', method: 'GET', fn: 'lib_zz_test.get', perm: 'network:view', effect: 'read', desc: 'Test: one thing.', params: { thing: S('Thing id', { required: true }) } },
  { name: 'zz.stats', method: 'GET', fn: 'lib_zz_test.stats', perm: 'signed', effect: 'read', desc: 'Test: counters.' },
  { name: 'zz.deal', method: 'POST', fn: 'lib_zz_test.deal', perm: 'settings:full', agent: 'deny', effect: 'write', desc: 'Test: a deal with a team.', params: { company: S('Company', { required: true }), fund: S('Fund id'), restricted: B('Restricted'), agent_allowed: B('Agent allowed'), team: S('JSON list of member emails') } },
  { name: 'zz.file', method: 'POST', fn: 'lib_zz_test.file', perm: 'signed', agent: 'deny', effect: 'write', desc: 'Test: a stored file from text.', params: { name: S('File name', { required: true }), text: S('Content'), deal: S('Deal id') } },
  { name: 'zz.age', method: 'POST', fn: 'lib_zz_test.age', perm: 'signed', agent: 'deny', effect: 'write', track: false, desc: "Test clock: age a proposal (and run the sweep) or a thing's ask of zz_review.", params: { what: S('proposal | asked', { required: true }), id: S('Record id', { required: true }), minutes: N('Minutes back') } },
  { name: 'zz.nda', method: 'GET', fn: 'lib_zz_test.nda', perm: 'signed', effect: 'read', desc: "Test: may your AI agent read a deal's NDA files now.", params: { deal: S('Deal id', { required: true }) } },
  { name: 'zz.cool', method: 'POST', fn: 'lib_zz_test.cool', perm: 'signed', agent: 'deny', effect: 'write', track: false, desc: 'Test clock: forget the platform cooldowns of every trigger.' },
  { name: 'zz.mail', method: 'POST', fn: 'lib_zz_test.mail', perm: 'signed', effect: 'write', track: false, desc: 'Test: the mail helpers through the bridge.', params: { query: S('Gmail query'), id: S('Message id') } },
  { name: 'zz.rmfile', method: 'POST', fn: 'lib_zz_test.rmfile', perm: 'signed', agent: 'deny', effect: 'write', track: false, desc: 'Test: remove a stored file from disk.', params: { file: S('File id', { required: true }) } },
];
