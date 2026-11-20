/** SCRATCH STUB (committee tests only, never shipped): lib_portfolio.holdingsOf. A company tagged "held" counts as held. */
function holdingsOf(app, o) {
  if (!o || !o.company) return [];
  const c = app.findRecordById('companies', o.company);
  let tags = [];
  try {
    tags = JSON.parse(c.getString('tags') || '[]') || [];
  } catch {
    tags = [];
  }
  return tags.indexOf('held') >= 0 ? [{ id: 'stub_holding', company: o.company, cost_minor: 100000000, value_minor: 150000000, ownership_ppm: 80000 }] : [];
}
module.exports = { holdingsOf: holdingsOf };
