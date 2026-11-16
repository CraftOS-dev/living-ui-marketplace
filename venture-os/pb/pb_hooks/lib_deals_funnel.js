/**
 * The cohort funnel of one pipeline for one period (pure: no PocketBase
 * globals, Node testable). The deals module feeds it the period's cohort; it
 * never reads the database itself.
 *
 *   funnel({ stages, cohort, inbound, counts, moves }) -> { stages: [bar], cohort }
 *
 * stages   [{ key, label }] in pipeline order
 * cohort   [{ id, reached }]: the period's cohort (deal flow: the intake items
 *          received in the period); reached = the index of the furthest stage
 *          its deal ever reached, -1 when it has none (not advanced, or a deal
 *          the caller may not see)
 * inbound  true: the first bar is Inbound, the whole cohort
 * counts   { <stage key>: deals in the stage now } (open and held)
 * moves    [{ from_stage, days_in_from }]: moves out of a stage in the period
 *
 * A bar: { key, label, count, conversion_ppm, now, median_days }
 * - Inbound: count = the cohort; now and median_days null.
 * - Stage i: count = the cohort members whose deal reached stage i or a later
 *   one (a skipped stage counts as passed). Bars only shrink.
 * - conversion_ppm = this bar over the bar before it; null for the first bar
 *   and when the bar before is 0. Never above 100%.
 * - now: deals in the stage now. median_days: median days in the stage of the
 *   moves out of it in the period (lower middle, whole days); null when none.
 */

function median(list) {
  if (list.length === 0) return null;
  const s = list.slice().sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
}

function funnel(input) {
  const stages = (input.stages || []).map((s) => ({ key: String(s.key), label: String(s.label) }));
  const index = {};
  stages.forEach((s, i) => {
    index[s.key] = i;
  });
  const counts = input.counts || {};
  const cohort = input.cohort || [];
  const outDays = stages.map(() => []);
  for (const m of input.moves || []) {
    const fi = index[String(m.from_stage || '')];
    if (fi !== undefined) outDays[fi].push(Math.max(0, Math.round(Number(m.days_in_from) || 0)));
  }
  const bars = [];
  if (input.inbound === true) bars.push({ key: 'inbound', label: 'Inbound', count: cohort.length, conversion_ppm: null, now: null, median_days: null });
  stages.forEach((s, i) => {
    let n = 0;
    for (const c of cohort) if (Number(c.reached) >= i) n++;
    bars.push({ key: s.key, label: s.label, count: n, conversion_ppm: null, now: Math.max(0, Math.round(Number(counts[s.key]) || 0)), median_days: median(outDays[i]) });
  });
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1].count;
    bars[i].conversion_ppm = prev > 0 ? Math.round((bars[i].count * 1000000) / prev) : null;
  }
  return { stages: bars, cohort: cohort.length };
}

/** The calendar quarter of a day: { key: 'YYYY-Qn', start_day, end_day (exclusive: the next quarter's first day) }. */
function quarterOf(day) {
  const y = Number(String(day).slice(0, 4));
  const m = Number(String(day).slice(5, 7));
  const q = Math.floor((m - 1) / 3) + 1;
  const sm = (q - 1) * 3 + 1;
  const pad = (n) => (n < 10 ? '0' + n : String(n));
  const start = y + '-' + pad(sm) + '-01';
  const end = q === 4 ? y + 1 + '-01-01' : y + '-' + pad(sm + 3) + '-01';
  return { key: y + '-Q' + q, start_day: start, end_day: end };
}

/** 'YYYY-Qn' -> quarterOf its first day; null when the text is not a quarter. */
function parseQuarter(text) {
  const m = /^(\d{4})-Q([1-4])$/.exec(String(text || '').trim());
  if (m === null) return null;
  const sm = (Number(m[2]) - 1) * 3 + 1;
  return quarterOf(m[1] + '-' + (sm < 10 ? '0' + sm : String(sm)) + '-01');
}

module.exports = { funnel: funnel, quarterOf: quarterOf, parseQuarter: parseQuarter, median: median };
