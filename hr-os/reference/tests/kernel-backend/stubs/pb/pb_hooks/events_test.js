// SCRATCH ONLY (kernel-backend tests): a test approval kind and event subscribers.
module.exports = {
  on: { 'employment.hired': 'lib_testkit.onHired', 'record.editing': 'lib_testkit.onEditing', 'test.ping': ['lib_testkit.onPing', 'lib_testkit.onPingFail'] },
  approvals: { test_kind: 'lib_testkit.onDecision' },
  profileFacts: 'lib_testkit.facts',
};
