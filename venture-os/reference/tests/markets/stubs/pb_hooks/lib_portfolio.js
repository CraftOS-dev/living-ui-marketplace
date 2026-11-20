/// <reference path="../pb_data/types.d.ts" />
/**
 * SCRATCH STUB (markets builder only, never shipped): lib_portfolio.holdingsOf
 * as SPEC 4.6 names it. Holdings come from the app store key
 * vo_stub_holdings (a JSON list of company ids), set by the tests.
 */
function holdingsOf(app, o) {
  const ids = JSON.parse(app.store().get('vo_stub_holdings') || '[]');
  if (o && o.company && ids.indexOf(o.company) >= 0) return [{ id: 'stubholding' + o.company.slice(0, 5), company: o.company, cost_minor: 100000000, value_minor: 150000000, ownership_ppm: 80000 }];
  return [];
}

function setHoldings(ctx, p) {
  ctx.app.store().set('vo_stub_holdings', typeof p.companies === 'string' ? p.companies : JSON.stringify(p.companies || []));
  return { ok: true };
}

module.exports = { holdingsOf: holdingsOf, setHoldings: setHoldings };
