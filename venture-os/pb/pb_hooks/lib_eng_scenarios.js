/**
 * Memo scenarios (REPORT Table 33; Bessemer's outcomes analysis).
 *
 * Expected multiple = sum of probability x exit multiple. Probabilities are
 * ppm and must sum to exactly 1,000,000 (100%), else the scenarios are
 * refused with code probabilities_not_100. Multiples are e8 (3x = 300000000).
 * With a check size, expected proceeds = check x expected multiple.
 * An exit multiple can come from an exit: exit value x ownership at exit /
 * invested.
 *
 * Pure: no PocketBase globals.
 */

let _c = null;
function C() {
  if (_c === null) _c = require((typeof __hooks === 'string' ? __hooks : __dirname) + '/lib_eng_core.js');
  return _c;
}

/**
 * input: { scenarios: [{ label, probability_ppm, multiple_e8 }], check_minor? }
 * -> { expected_multiple_e8, expected_proceeds_minor|null,
 *      rows: [{ label, probability_ppm, multiple_e8, weighted_e8 }] }
 */
function expected(input) {
  const c = C();
  const x = input || {};
  if (!Array.isArray(x.scenarios) || x.scenarios.length === 0 || x.scenarios.length > 12) throw c.fail(400, 'scenarios must list 1 to 12 outcomes', 'invalid_param', { field: 'scenarios' });
  let sum = 0;
  let num = c.B0;
  const rows = x.scenarios.map((s, i) => {
    const w = 'scenarios[' + i + ']';
    c.ppmCheck(s.probability_ppm, w + '.probability_ppm');
    const m = c.bigPos(s.multiple_e8, w + '.multiple_e8');
    sum += s.probability_ppm;
    const part = BigInt(s.probability_ppm) * m;
    num = num + part;
    return { label: c.isNil(s.label) ? '' : String(s.label), probability_ppm: s.probability_ppm, multiple_e8: c.num(m), weighted_e8: c.num(c.divRound(part, c.BE6)) };
  });
  if (sum !== c.E6) throw c.fail(400, 'Probabilities add up to ' + sum / 10000 + '%, not 100%', 'probabilities_not_100', { field: 'scenarios', sum_ppm: sum });
  const exp = c.divRound(num, c.BE6);
  let proceeds = null;
  if (!c.isNil(x.check_minor)) proceeds = c.num(c.divRound(c.bigPos(x.check_minor, 'check_minor') * num, c.BE6 * c.BE8), 'expected_proceeds_minor');
  return { expected_multiple_e8: c.num(exp), expected_proceeds_minor: proceeds, rows: rows };
}

/**
 * Exit multiple from an exit. input: { exit_value_minor, ownership_ppm, invested_minor } -> { multiple_e8 }
 */
function multipleFromExit(input) {
  const c = C();
  const x = input || {};
  c.ppmCheck(x.ownership_ppm, 'ownership_ppm');
  const inv = c.bigPos(x.invested_minor, 'invested_minor');
  if (inv === c.B0) throw c.fail(400, 'invested_minor must be positive', 'invalid_number', { field: 'invested_minor' });
  return { multiple_e8: c.num(c.divRound(c.bigPos(x.exit_value_minor, 'exit_value_minor') * BigInt(x.ownership_ppm) * c.BE8, inv * c.BE6), 'multiple_e8') };
}

module.exports = { expected: expected, multipleFromExit: multipleFromExit };
