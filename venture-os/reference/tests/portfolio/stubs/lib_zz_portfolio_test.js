/** SCRATCH ONLY (never shipped). */
function q(p) {
  const o = {};
  if (p.company) o.company = p.company;
  if (p.fund) o.fund = p.fund;
  return o;
}
function holdingsFor(ctx, p) {
  return { rows: require(`${__hooks}/lib_portfolio.js`).holdingsFor(ctx, q(p)) };
}
function holdingsOf(ctx, p) {
  return { rows: require(`${__hooks}/lib_portfolio.js`).holdingsOf(ctx.app, q(p)) };
}
module.exports = { holdingsFor: holdingsFor, holdingsOf: holdingsOf };
