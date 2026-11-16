/**
 * TEST KIT (kernel-records tests only, never shipped): doors the tests need
 * into code that runs as the app itself.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const B = (desc) => ({ type: 'boolean', desc: desc });

module.exports = [
  { name: 'testkit.events', method: 'POST', fn: 'lib_testkit.events', perm: 'settings:full', agent: 'deny', effect: 'write', track: false, desc: 'Test kit: the events emitted so far.', params: { clear: B('Clear after reading') } },
  { name: 'testkit.ask', method: 'POST', fn: 'lib_testkit.ask', perm: 'settings:full', agent: 'deny', effect: 'write', track: false, desc: "Test kit: a person's NDA ask about a deal (trigger diligence_answers) as a module makes it.", params: { deal: S('Deal id or number', { required: true }) } },
  { name: 'testkit.from-path', method: 'POST', fn: 'lib_testkit.fromPath', perm: 'settings:full', agent: 'deny', effect: 'write', desc: 'Test kit: lib_files.fromPath as the app does after download_gmail_attachment.', params: { path: S('Local path', { required: true }), deal: S('Deal'), company: S('Company'), name: S('Name') } },
  { name: 'testkit.bulk-deals', method: 'POST', fn: 'lib_testkit.bulkDeals', perm: 'settings:full', agent: 'deny', effect: 'write', track: false, desc: 'Test kit: open many deals at once, spread over the stages (speed tests).', params: { count: { type: 'number', desc: 'How many', required: true } } },
];
