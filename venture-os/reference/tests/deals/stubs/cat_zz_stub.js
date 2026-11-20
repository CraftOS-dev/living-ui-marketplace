/**
 * SCRATCH ONLY (never shipped): stand-ins for other wave 2 modules' ops the
 * deals module calls: diligence refs.log, intake intake.verdict, network
 * briefs.list. Their real catalogs replace these in APP.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
module.exports = [
  { name: 'refs.log', method: 'POST', fn: 'lib_zz_stub.refsLog', perm: 'diligence:edit|pipeline:edit', agent: 'allow', effect: 'write', desc: 'Stub of diligence refs.log.', params: { deal: S('Deal', { required: true }), kind: S('Kind', { enum: ['provided', 'backchannel', 'customer', 'expert'] }), signal: S('Signal', { enum: ['positive', 'neutral', 'negative'] }), person: S('Who'), note: S('Note') } },
  { name: 'intake.verdict', method: 'GET', fn: 'lib_zz_stub.verdict', perm: 'signed', agent: 'allow', effect: 'read', desc: 'Stub of intake intake.verdict.', params: { deal: S('Deal', { required: true }) } },
  { name: 'zz.emit', method: 'POST', fn: 'lib_zz_stub.emit', perm: 'settings:full', agent: 'deny', effect: 'write', track: false, desc: 'Test only: emit an event as the app.', params: { event: S('Event', { required: true }), payload: S('JSON payload', { required: true }) } },
  { name: 'zz.cron', method: 'POST', fn: 'lib_zz_stub.cron', perm: 'settings:full', agent: 'deny', effect: 'write', track: false, desc: 'Test only: run a cron fn now.', params: { fn: S('lib_x.fn', { required: true }) } },
  { name: 'zz.backdate', method: 'POST', fn: 'lib_zz_stub.backdate', perm: 'settings:full', agent: 'deny', effect: 'write', track: false, desc: 'Test only: move a deal back in time (stage entry and its last stage event).', params: { deal: S('Deal', { required: true }), days: S('Days back', { required: true }) } },
  { name: 'compare.save', method: 'POST', fn: 'lib_zz_stub.compareSave', perm: 'diligence:edit', agent: 'allow', effect: 'write', desc: 'Stub of diligence compare.save.', params: { grid: S('Grid'), name: S('Name'), deals: S('Deals'), companies: S('Companies'), columns: S('Columns'), origin: S('Origin'), market_ref: S('Map'), fill: S('Fill') } },
  { name: 'briefs.list', method: 'GET', fn: 'lib_zz_stub.briefs', perm: 'network:view', agent: 'allow', effect: 'read', desc: 'Stub of network briefs.list.', params: { from_at: S('ISO time'), state: S('State'), limit: S('Rows') } },
  { name: 'briefs.get', method: 'GET', fn: 'lib_zz_stub.brief', perm: 'network:view', agent: 'allow', effect: 'read', desc: 'Stub of network briefs.get.', params: { brief: S('Brief id'), event: S('Event id') } },
];
