/**
 * SCRATCH STUB (never shipped): committee's lib_committee.decisionOf for the
 * portfolio builder's tests. Decisions come from <pb_data>/vo_test_decisions.json
 * ({ dealId: 'invest' | 'pass' | ... }), written by the tests.
 */
function readJson(app, name) {
  try {
    const dir = app.dataDir();
    const raw = toString($os.readFile($filepath.join(dir, name)));
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}
function decisionOf(app, dealId) {
  const all = readJson(app, 'vo_test_decisions.json');
  const v = all[dealId];
  if (v === undefined) return null;
  const outcome = typeof v === 'string' ? v : v.outcome;
  const open = typeof v === 'string' ? 0 : Number(v.open || 0);
  return { id: 'dec_' + dealId, deal: { id: dealId }, outcome: outcome, outcome_label: outcome.charAt(0).toUpperCase() + outcome.slice(1), decided_at: '2026-11-01T10:00:00Z', conditions_open: open, conditions_total: open };
}
module.exports = { decisionOf: decisionOf };
