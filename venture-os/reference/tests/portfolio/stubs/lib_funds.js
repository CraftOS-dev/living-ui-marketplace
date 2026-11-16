/**
 * SCRATCH STUB (never shipped): funds' lib_funds.markOf for the portfolio
 * builder's tests. Marks come from <pb_data>/vo_test_marks.json
 * ({ holdingId: value_minor }), written by the tests.
 */
function readJson(app, name) {
  try {
    const raw = toString($os.readFile($filepath.join(app.dataDir(), name)));
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}
function markOf(app, holdingId, asOfDay) {
  const marks = readJson(app, 'vo_test_marks.json');
  if (marks[holdingId] === undefined) return null;
  return { value_minor: marks[holdingId], method: 'calibrated_round', day: asOfDay };
}
module.exports = { markOf: markOf };
