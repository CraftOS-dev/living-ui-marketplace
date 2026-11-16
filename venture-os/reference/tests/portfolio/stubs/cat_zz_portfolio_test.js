/** SCRATCH ONLY (never shipped): exposes lib_portfolio.holdingsFor and holdingsOf to the portfolio fix tests. */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
module.exports = [
  { name: 'zzp.holdings-for', method: 'GET', fn: 'lib_zz_portfolio_test.holdingsFor', perm: 'signed', effect: 'read', desc: 'Test only: lib_portfolio.holdingsFor(ctx).', params: { company: S('Company id'), fund: S('Fund id') } },
  { name: 'zzp.holdings-of', method: 'GET', fn: 'lib_zz_portfolio_test.holdingsOf', perm: 'signed', effect: 'read', desc: 'Test only: lib_portfolio.holdingsOf(app).', params: { company: S('Company id'), fund: S('Fund id') } },
];
