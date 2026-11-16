/**
 * SCRATCH STUB ops (markets builder only, never shipped): read what the
 * intake stub received, set the portfolio stub's holdings, and the markets contract and cron entry points for the tests.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
module.exports = [
  { name: 'zzstub.intake-calls', method: 'GET', fn: 'lib_intake.calls', perm: 'signed', effect: 'read', desc: 'Stub: calls received by lib_intake.add.' },
  { name: 'zzstub.holdings', method: 'POST', fn: 'lib_portfolio.setHoldings', perm: 'signed', effect: 'write', track: false, desc: 'Stub: company ids that hold a holding.', params: { companies: S('JSON list of company ids') } },
  { name: 'zzstub.candidates', method: 'GET', fn: 'lib_zz_markets.candidates', perm: 'signed', effect: 'read', desc: 'Stub: lib_markets.candidatesFor.', params: { thesis: S('Thesis', { required: true }) } },
  { name: 'zzstub.cron-radars', method: 'POST', fn: 'lib_zz_markets.cronRadars', perm: 'signed', effect: 'write', track: false, desc: 'Stub: run the radars cron now.' },
  { name: 'zzstub.prefetch', method: 'POST', fn: 'lib_zz_markets.prefetch', perm: 'signed', effect: 'write', track: false, desc: 'Stub: run the prefetch cron now.' },
  { name: 'zzstub.cron-maps', method: 'POST', fn: 'lib_zz_markets.cronMaps', perm: 'signed', effect: 'write', track: false, desc: 'Stub: run the weekly map cron now.' },
  { name: 'zzstub.due', method: 'POST', fn: 'lib_zz_markets.setDue', perm: 'signed', effect: 'write', track: false, desc: 'Stub: make a radar due now.', params: { radar: S('Radar id', { required: true }) } },
];
