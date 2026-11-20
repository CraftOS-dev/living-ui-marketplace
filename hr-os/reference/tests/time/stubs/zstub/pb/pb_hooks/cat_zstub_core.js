// SCRATCH ONLY (time builder's copy; never shipped).
const S = (d, x) => Object.assign({ type: 'string', desc: d }, x || {});
module.exports = [
  { name: 'zstub.lock-days', method: 'POST', fn: 'lib_zstub.lockDays', perm: 'time:full', agent: 'deny', effect: 'write', desc: 'Scratch: lib_time.lockDays.', params: { employment: S('e', { required: true }), from: S('f', { required: true }), to: S('t', { required: true }), payrun: S('p', { required: true }) } },
  { name: 'zstub.unlock-days', method: 'POST', fn: 'lib_zstub.unlockDays', perm: 'time:full', agent: 'deny', effect: 'write', desc: 'Scratch: lib_time.unlockDays.', params: { payrun: S('p', { required: true }) } },
  { name: 'zstub.pay-inputs', method: 'GET', fn: 'lib_zstub.payInputs', perm: 'time:view', effect: 'read', desc: 'Scratch: lib_time.payInputs.', params: { employment: S('e', { required: true }), from: S('f', { required: true }), to: S('t', { required: true }) } },
  { name: 'zstub.cron', method: 'POST', fn: 'lib_zstub.cron', perm: 'time:full', agent: 'deny', effect: 'write', desc: 'Scratch: run a time cron job.', params: { job: S('auto | review') } },
  { name: 'zstub.facts', method: 'GET', fn: 'lib_zstub.facts', perm: 'signed', effect: 'read', desc: 'Scratch: lib_time.profileFacts.', params: { employment: S('e', { required: true }) } },
  { name: 'zstub.pay-bench', method: 'GET', fn: 'lib_zstub.payBench', perm: 'time:view', effect: 'read', desc: 'Scratch: time payInputs timing over everyone.', params: { from: S('f', { required: true }), to: S('t', { required: true }), skip_old: S('true to skip the old copy') } },
  { name: 'zstub.pay-profile', method: 'GET', fn: 'lib_zstub.payProfile', perm: 'time:view', effect: 'read', desc: 'Scratch: where payInputs time goes.', params: { from: S('f', { required: true }), to: S('t', { required: true }) } },
  { name: 'zstub.board-profile', method: 'GET', fn: 'lib_zstub.boardProfile', perm: 'time:view', effect: 'read', desc: 'Scratch: where attendance.board time goes.', params: {} },
];
