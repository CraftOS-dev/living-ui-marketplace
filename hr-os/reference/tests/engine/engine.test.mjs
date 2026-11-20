/**
 * lib_engine unit tests: input checks, pack order and requires, steps,
 * rounding on lines, tables, YTD and annualisation, proration, errors,
 * issues, explanation, determinism, and a realistic two-pack example.
 */
import { load, file, test, eq, near, ok } from './_harness.mjs';

const EN = load('lib_engine.js');
file('engine');

function pack(over) {
  return Object.assign(
    {
      code: 'zz-test', country: 'ZZ', region: '', name: 'Test pack', version: '1', effective_from: '2026-01-01', effective_to: '2026-12-31',
      currency: 'USD', tax_year: { start: '01-01' }, requires: [], order: 10, ship: 'draft',
      sources: [{ title: 'test', url: '', retrieved: '' }], notes: 'test', profile_fields: [], tags: [], tables: {}, steps: [], vectors: []
    },
    over
  );
}

function input(over) {
  const base = EN.completeInput({ currency: { code: 'USD', exponent: 2 } }, pack());
  const o = over || {};
  const out = Object.assign({}, base, o);
  out.run = Object.assign({}, base.run, o.run || {});
  return out;
}

function codes(out) {
  const m = {};
  for (const l of out.lines) m[l.code] = l.amount;
  return m;
}
function issueCodes(out) {
  return out.issues.map((i) => i.code);
}
const basic = (amount, tags) => ({ code: 'BASIC', kind: 'earning', amount: amount, tags: tags || ['gross'] });

// ---- input checks
test('input problems are blockers, nothing runs', () => {
  const p = pack({ steps: [{ code: 'A', name: 'A', kind: 'earning', amount: '1' }] });
  for (const bad of [null, {}, { run: {} }]) {
    const out = EN.calculate(bad, [p]);
    ok(out.issues.length > 0 && out.issues.every((i) => i.code === 'input_invalid'), JSON.stringify(out.issues));
    eq(out.lines, []);
  }
  const i1 = input({ run: { frequency: 'daily' } });
  ok(issueCodes(EN.calculate(i1, [p])).indexOf('input_invalid') >= 0, 'frequency');
  const i2 = input({ lines: [{ code: 'X', kind: 'bonus', amount: 1 }] });
  ok(EN.calculate(i2, [p]).issues[0].message.indexOf('kind') >= 0, 'line kind');
  const i3 = input({ history: null });
  ok(issueCodes(EN.calculate(i3, [p])).indexOf('input_invalid') >= 0, 'history');
  const i4 = input({ history_from: '' });
  ok(issueCodes(EN.calculate(i4, [p])).indexOf('input_invalid') >= 0, 'history_from');
  const i5 = input({ currency: { code: 'USD', exponent: 7 } });
  ok(issueCodes(EN.calculate(i5, [p])).indexOf('input_invalid') >= 0, 'exponent');
  const i6 = input({ lines: [{ code: 'X', kind: 'earning', amount: NaN }] });
  ok(issueCodes(EN.calculate(i6, [p])).indexOf('input_invalid') >= 0, 'NaN amount');
});

// ---- packs
test('packs run by order then code; requires, duplicates, dates, invalid packs', () => {
  const a = pack({ code: 'zz-a', order: 20, steps: [{ code: 'A', name: 'A', kind: 'earning', amount: 'line("B") + 1' }], requires: ['zz-b'] });
  const b = pack({ code: 'zz-b', order: 10, steps: [{ code: 'B', name: 'B', kind: 'earning', amount: '10' }] });
  eq(codes(EN.calculate(input(), [a, b])), { B: 10, A: 11 });
  eq(EN.calculate(input(), [a, b]).lines.map((l) => l.code), ['B', 'A']);
  ok(issueCodes(EN.calculate(input(), [a])).indexOf('pack_missing') >= 0, 'missing');
  ok(issueCodes(EN.calculate(input(), [b, b])).indexOf('pack_duplicate') >= 0, 'duplicate');
  const late = pack({ code: 'zz-late', effective_from: '2027-01-01', effective_to: '', steps: [{ code: 'L', name: 'L', kind: 'earning', amount: '1' }] });
  ok(issueCodes(EN.calculate(input(), [late])).indexOf('pack_not_in_force') >= 0, 'not in force');
  const broken = pack({ code: 'zz-broken', steps: [{ code: 'Q', name: 'Q', kind: 'earning', amount: '1 +' }] });
  const out = EN.calculate(input(), [broken, b]);
  ok(issueCodes(out).indexOf('pack_invalid') >= 0, 'invalid');
  eq(codes(out), { B: 10 });
  const same1 = pack({ code: 'zz-m', order: 10, steps: [{ code: 'M', name: 'M', kind: 'earning', amount: '1' }] });
  const same2 = pack({ code: 'zz-n', order: 10, steps: [{ code: 'N', name: 'N', kind: 'earning', amount: '1' }] });
  eq(EN.calculate(input(), [same2, same1]).lines.map((l) => l.code), ['M', 'N']);
});

// ---- steps
test('var steps, when and else, rounding a var', () => {
  const p = pack({
    profile_fields: [{ key: 'on', label: 'On', type: 'boolean', default: false }],
    steps: [
      { var: 'a', expr: '10 / 3', round: { mode: 'down', step: 0.1 } },
      { var: 'b', expr: '100', when: 'profile.on', else: '7' },
      { var: 'c', expr: '1', when: 'profile.on' },
      { code: 'X', name: 'X', kind: 'earning', amount: 'a + b + c' }
    ]
  });
  const out = EN.calculate(input(), [p]);
  eq(out.vars['zz-test'], { a: 3.3, b: 7, c: 0 });
  eq(codes(out), { X: 10.3 });
  const on = EN.calculate(input({ profile: { on: true } }), [p]);
  eq(on.vars['zz-test'], { a: 3.3, b: 100, c: 1 });
});
test('line steps: when false, zero lines, keep_zero, tags feed later sums', () => {
  const p = pack({
    steps: [
      { code: 'A', name: 'A', kind: 'earning', amount: '100', tags: ['t'] },
      { code: 'B', name: 'B', kind: 'earning', amount: '50', when: 'false', tags: ['t'] },
      { code: 'Z', name: 'Z', kind: 'earning', amount: '0' },
      { code: 'K', name: 'K', kind: 'info', amount: '0', keep_zero: true },
      { code: 'S', name: 'S', kind: 'info', amount: 'sum("t") + line("B") + sum("gross") + sum_code("BASIC")' }
    ]
  });
  const out = EN.calculate(input({ lines: [basic(1000)] }), [p]);
  eq(codes(out), { BASIC: 1000, A: 100, K: 0, S: 2100 });
});
test('a code emitted twice is a step error', () => {
  const p = pack({ steps: [{ code: 'BASIC', name: 'again', kind: 'earning', amount: '1' }] });
  const out = EN.calculate(input({ lines: [basic(10)] }), [p]);
  ok(out.issues.some((i) => i.code === 'step_error' && i.message.indexOf('already on this payslip') >= 0));
});
test('check steps add blockers and warnings with their own codes', () => {
  const p = pack({
    profile_fields: [{ key: 'n', label: 'N', type: 'number', default: 5 }],
    steps: [
      { check: 'profile.n < 10', severity: 'blocker', issue: 'n_too_big', message: 'N is too big' },
      { check: 'profile.n != 5', severity: 'warning', issue: 'n_is_five', message: 'N is five' },
      { check: 'false', when: 'profile.n > 100', severity: 'blocker', issue: 'never', message: 'x' },
      { code: 'A', name: 'A', kind: 'earning', amount: 'profile.n' }
    ]
  });
  eq(issueCodes(EN.calculate(input(), [p])), ['n_is_five']);
  const big = EN.calculate(input({ profile: { n: 12 } }), [p]);
  eq(issueCodes(big), ['n_too_big']);
  eq(big.issues[0].severity, 'blocker');
  eq(big.issues[0].step, 0);
  eq(codes(big), { A: 12 });
});

// ---- rounding on lines
test('line rounding: half_up negatives, half_even, steps 1, 10, 100, and the currency unit', () => {
  const steps = [
    { code: 'NEG', name: 'n', kind: 'deduction', stage: 'post', amount: '-2.345' },
    { code: 'EVEN', name: 'e', kind: 'info', amount: '2.345', round: { mode: 'half_even', step: 0.01 } },
    { code: 'ONE', name: 'o', kind: 'info', amount: '1234.5', round: { mode: 'half_even', step: 1 } },
    { code: 'TEN', name: 't', kind: 'info', amount: '1235', round: { mode: 'half_up', step: 10 } },
    { code: 'HUND', name: 'h', kind: 'info', amount: '1250', round: { mode: 'down', step: 100 } },
    { code: 'UP', name: 'u', kind: 'info', amount: '-0.001', round: { mode: 'up', step: 0.01 } },
    { code: 'FINE', name: 'f', kind: 'info', amount: '1.23456', round: { mode: 'half_up', step: 0.0001 } },
    { code: 'NYC', name: 'nyc', kind: 'info', amount: '2250 * 0.0425 + 93.17', round: { mode: 'half_up', step: 0.01 } }
  ];
  const out = EN.calculate(input(), [pack({ steps: steps })]);
  eq(codes(out), { NEG: -2.35, EVEN: 2.34, ONE: 1234, TEN: 1240, HUND: 1200, UP: -0.01, FINE: 1.23, NYC: 188.8 });
  const neg = out.lines.find((l) => l.code === 'NEG');
  eq(neg.explain.rounded, { mode: 'half_up', step: 0.01 });
  eq(neg.explain.value, -2.345);
});
test('JPY exponent 0: lines become whole yen, step 10 rounding, half_down 50 sen', () => {
  const p = pack({
    currency: 'JPY',
    steps: [
      { code: 'A', name: 'a', kind: 'deduction', stage: 'statutory', amount: '12345.5' },
      { code: 'B', name: 'b', kind: 'deduction', stage: 'statutory', amount: '12345.5', round: { mode: 'half_down', step: 1 } },
      { code: 'C', name: 'c', kind: 'deduction', stage: 'statutory', amount: '12345.51', round: { mode: 'half_down', step: 1 } },
      { code: 'D', name: 'd', kind: 'deduction', stage: 'statutory', amount: '8295.625', round: { mode: 'half_up', step: 10 } },
      { code: 'E', name: 'e', kind: 'deduction', stage: 'statutory', amount: '0.4', round: { mode: 'half_up', step: 0.01 } }
    ]
  });
  const i = input({ currency: { code: 'JPY', exponent: 0 }, lines: [basic(300000)] });
  const out = EN.calculate(i, [p]);
  eq(codes(out), { BASIC: 300000, A: 12346, B: 12345, C: 12346, D: 8300 });
  eq(out.totals.statutory, 45337);
  eq(out.totals.net, 254663);
});

// ---- tables in packs
test('progressive tables (segments, base with from, quick deduction), bands and maps in a pack', () => {
  const p = pack({
    profile_fields: [{ key: 'status', label: 'Status', type: 'enum', options: [{ value: 'single', label: 'S' }, { value: 'married', label: 'M' }], default: 'single' }],
    tables: {
      fit_single: { type: 'brackets', rows: [{ from: 0, rate: 0, base: 0 }, { from: 6400, rate: 0.1, base: 0 }, { from: 18325, rate: 0.12, base: 1192.5 }] },
      fit_married: { type: 'brackets', rows: [{ over: 0, rate: 0.05 }, { over: 10000, rate: 0.1 }] },
      jp: { type: 'brackets', rows: [{ over: 0, rate: 0.05105, less: 0 }, { over: 162500, rate: 0.1021, less: 8296 }] },
      sdl: { type: 'bands', rows: [{ to: 800, values: { amt: 2 } }, { over: 800, to: 4500, values: { pct: 0.0025 } }, { over: 4500, values: { amt: 11.25 } }] },
      pref: { type: 'map', rows: { '13': { health: 0.0985 }, '27': { health: 0.1013 } } }
    },
    steps: [
      { code: 'FIT', name: 'f', kind: 'info', amount: 'table("fit_" + profile.status, 20000)' },
      { code: 'JPT', name: 'j', kind: 'info', amount: 'table("jp", 162500)' },
      { code: 'SDL', name: 's', kind: 'info', amount: 'band("sdl", 3000, "pct") * 3000' },
      { code: 'HI', name: 'h', kind: 'info', amount: 'map("pref", 27, "health") * 300000' }
    ]
  });
  const out = EN.calculate(input(), [p]);
  eq(codes(out), { FIT: 1393.5, JPT: 8295.63, SDL: 7.5, HI: 30390 });
  eq(codes(EN.calculate(input({ profile: { status: 'married' } }), [p])).FIT, 1500);
  const fit = out.lines[0].explain;
  eq(fit.tables[0], { fn: 'table', table: 'fit_single', x: 20000, value: 1393.5, rows: [{ from: 18325, rate: 0.12, base: 1192.5 }] });
  eq(fit.reads[0], { name: 'profile.status', value: 'single' });
});

// ---- periods, YTD, annualisation
test('period position in tax years starting 01-01, 04-01 and 04-06', () => {
  const run = (pay, freq, ppy) => ({ kind: 'regular', period_start: pay, period_end: pay, pay_date: pay, frequency: freq || 'monthly', periods_per_year: ppy || 12 });
  const jan = pack({ tax_year: { start: '01-01' } });
  const apr1 = pack({ tax_year: { start: '04-01' } });
  const apr6 = pack({ tax_year: { start: '04-06' } });
  const pick = (o) => [o.tax_year_start, o.period_index, o.periods_remaining, o.first_period_of_year];
  eq(pick(EN.periodInfo(jan, run('2026-01-31'))), ['2026-01-01', 1, 11, true]);
  eq(pick(EN.periodInfo(jan, run('2026-12-31'))), ['2026-01-01', 12, 0, false]);
  eq(pick(EN.periodInfo(apr1, run('2026-04-30'))), ['2026-04-01', 1, 11, true]);
  eq(pick(EN.periodInfo(apr1, run('2026-06-25'))), ['2026-04-01', 3, 9, false]);
  eq(pick(EN.periodInfo(apr1, run('2027-03-31'))), ['2026-04-01', 12, 0, false]);
  eq(pick(EN.periodInfo(apr1, run('2026-03-31'))), ['2025-04-01', 12, 0, false]);
  eq(EN.periodInfo(apr1, run('2026-06-25')).tax_year_end, '2027-03-31');
  eq(pick(EN.periodInfo(apr6, run('2026-04-30'))), ['2026-04-06', 1, 11, true]);
  eq(pick(EN.periodInfo(apr6, run('2026-05-05'))), ['2026-04-06', 1, 11, true]);
  eq(pick(EN.periodInfo(apr6, run('2026-05-06'))), ['2026-04-06', 2, 10, false]);
  eq(pick(EN.periodInfo(apr6, run('2027-04-05'))), ['2026-04-06', 12, 0, false]);
  eq(pick(EN.periodInfo(apr6, run('2026-04-05'))), ['2025-04-06', 12, 0, false]);
  // weekly and biweekly from 6 April
  eq(EN.periodInfo(apr6, run('2026-04-12', 'weekly', 52)).period_index, 1);
  eq(EN.periodInfo(apr6, run('2026-04-13', 'weekly', 52)).period_index, 2);
  const w53 = EN.periodInfo(apr6, run('2027-04-05', 'weekly', 52));
  eq([w53.period_index, w53.periods_remaining, w53.tax_week, w53.tax_month], [53, 0, 53, 12]);
  eq(EN.periodInfo(apr6, run('2026-04-19', 'biweekly', 26)).period_index, 1);
  eq(EN.periodInfo(apr6, run('2026-04-20', 'biweekly', 26)).period_index, 2);
  eq(EN.periodInfo(apr6, run('2026-04-20', 'biweekly', 26)).tax_week, 3);
  // semi monthly from 1 January: 1 to 15 is the first half
  eq(EN.periodInfo(jan, run('2026-01-15', 'semi_monthly', 24)).period_index, 1);
  eq(EN.periodInfo(jan, run('2026-01-31', 'semi_monthly', 24)).period_index, 2);
  eq(EN.periodInfo(jan, run('2026-12-31', 'semi_monthly', 24)).periods_remaining, 0);
  // date basis
  const pe = pack({ tax_year: { start: '04-01' }, date_basis: 'period_end' });
  eq(EN.periodInfo(pe, { pay_date: '2026-04-10', period_end: '2026-03-31', frequency: 'monthly', periods_per_year: 12 }).tax_year_start, '2025-04-01');
});
test('ytd reads earlier payslips inside the pack\'s own tax year; periods_paid counts regular ones', () => {
  const p = pack({
    tax_year: { start: '04-06' },
    steps: [
      { var: 'y', expr: 'ytd("t")' },
      { var: 'yc', expr: 'ytd_code("TAX")' },
      { var: 'paid', expr: 'run.periods_paid' },
      { code: 'A', name: 'a', kind: 'info', amount: 'y + yc', keep_zero: true }
    ]
  });
  const history = [
    { id: 'h0', kind: 'regular', pay_date: '2026-04-05', by_tag: { t: 1000 }, by_code: { TAX: 100 } },
    { id: 'h1', kind: 'regular', pay_date: '2026-04-30', by_tag: { t: 2000 }, by_code: { TAX: 200 } },
    { id: 'h2', kind: 'bonus', pay_date: '2026-05-15', by_tag: { t: 500 }, by_code: { TAX: 50 } },
    { id: 'h3', kind: 'regular', pay_date: '2026-05-29', by_tag: { t: 2000, other: 7 }, by_code: { TAX: 200 } }
  ];
  const i = input({ run: { period_start: '2026-06-01', period_end: '2026-06-30', pay_date: '2026-06-30' }, history: history });
  const out = EN.calculate(i, [p]);
  eq(out.vars['zz-test'], { y: 4500, yc: 450, paid: 2 });
  const jan = pack({ code: 'zz-jan', tax_year: { start: '01-01' }, steps: [{ var: 'y', expr: 'ytd("t")' }, { code: 'B', name: 'b', kind: 'info', amount: 'y' }] });
  eq(EN.calculate(i, [jan]).vars['zz-jan'].y, 5500);
});
test('annualisation with periods_remaining (India style, tax year from 04-01)', () => {
  const p = pack({
    tax_year: { start: '04-01' },
    tables: { slab: { type: 'brackets', rows: [{ over: 0, rate: 0 }, { over: 400000, rate: 0.05 }, { over: 800000, rate: 0.1 }] } },
    steps: [
      { var: 'now', expr: 'sum("taxable")' },
      { var: 'annual', expr: 'ytd("taxable") + now * (run.periods_remaining + 1)' },
      { var: 'tax', expr: 'table("slab", annual)' },
      { code: 'TDS', name: 'TDS', kind: 'deduction', stage: 'statutory', amount: 'max(0, (tax - ytd_code("TDS")) / (run.periods_remaining + 1))', round: { mode: 'half_up', step: 1 }, tags: ['taxable_none'] }
    ]
  });
  const i = input({
    currency: { code: 'INR', exponent: 2 },
    run: { period_start: '2026-06-01', period_end: '2026-06-30', pay_date: '2026-06-30' },
    lines: [basic(100000, ['taxable'])],
    history: [
      { id: 'a', kind: 'regular', pay_date: '2026-04-30', by_tag: { taxable: 100000 }, by_code: { TDS: 2667 } },
      { id: 'b', kind: 'regular', pay_date: '2026-05-31', by_tag: { taxable: 100000 }, by_code: { TDS: 2667 } }
    ]
  });
  const out = EN.calculate(i, [p]);
  // annual = 200000 + 100000 * 10 = 1,200,000; tax = 20,000 + 40,000 = 60,000; (60,000 - 5,334) / 10 = 5,466.6 -> 5,467
  eq(out.vars['zz-test'].annual, 1200000);
  eq(out.vars['zz-test'].tax, 60000);
  eq(codes(out).TDS, 5467);
  eq(out.explain.packs[0].periods_remaining, 9);
});
test('ytd_since, prev_regular and friends', () => {
  const p = pack({
    steps: [
      { var: 'since', expr: 'ytd_since("bonus", "2026-04-01")' },
      { var: 'since_code', expr: 'ytd_code_since("HI", month_start(run.pay_date))' },
      { var: 'prev', expr: 'prev_regular("pay")' },
      { var: 'prev_code', expr: 'prev_regular_code("WHT")' },
      { var: 'has', expr: 'has_prev_regular()' },
      { var: 'pd', expr: 'prev_regular_date()' },
      { var: 'nov', expr: 'regular_in_month("pay", add_months(month_start(run.pay_date), -1))' },
      { var: 'nov_code', expr: 'regular_in_month_code("WHT", "2026-11-15")' },
      { var: 'nov_n', expr: 'regular_count_in_month("2026-11-01")' },
      { var: 'dec_n', expr: 'regular_count_in_month(run.pay_date)' },
      { code: 'A', name: 'a', kind: 'info', amount: 'since + since_code + prev + prev_code' }
    ]
  });
  const history = [
    { id: 'r1', kind: 'regular', pay_date: '2026-11-25', period_end: '2026-11-30', by_tag: { pay: 300000 }, by_code: { WHT: 7000 } },
    { id: 'r0', kind: 'regular', pay_date: '2026-10-23', period_end: '2026-10-31', by_tag: { pay: 290000 }, by_code: { WHT: 6800 } },
    { id: 'b1', kind: 'bonus', pay_date: '2026-07-10', by_tag: { bonus: 500000 }, by_code: { HI: 1 } },
    { id: 'b0', kind: 'bonus', pay_date: '2026-03-10', by_tag: { bonus: 400000 } },
    { id: 'b2', kind: 'bonus', pay_date: '2026-12-02', by_tag: { bonus: 10 }, by_code: { HI: 25000 } }
  ];
  const i = input({ run: { kind: 'bonus', period_start: '2026-12-01', period_end: '2026-12-31', pay_date: '2026-12-10' }, history: history });
  const v = EN.calculate(i, [p]).vars['zz-test'];
  eq(v, { since: 500010, since_code: 25000, prev: 300000, prev_code: 7000, has: true, pd: '2026-11-25', nov: 300000, nov_code: 7000, nov_n: 1, dec_n: 0 });
  const none = EN.calculate(input({ history: [] }), [p]).vars['zz-test'];
  eq([none.prev, none.has, none.pd], [0, false, '']);
});
test('history that starts too late is a blocker', () => {
  const p = pack({ tax_year: { start: '01-01' }, steps: [{ code: 'A', name: 'a', kind: 'info', amount: 'ytd("t")', keep_zero: true }] });
  const i = input({ history_from: '2026-03-01', employee: { hire_day: '2020-01-01', birth_date: '1990-01-01' } });
  ok(issueCodes(EN.calculate(i, [p])).indexOf('history_short') >= 0, 'short');
  const hired = input({ history_from: '2026-03-01', employee: { hire_day: '2026-03-01', birth_date: '1990-01-01' } });
  ok(issueCodes(EN.calculate(hired, [p])).indexOf('history_short') < 0, 'hired mid year is fine');
});
test('prorate in a pack', () => {
  const p = pack({ steps: [{ code: 'PAY', name: 'p', kind: 'earning', amount: 'prorate(3000)' }] });
  eq(codes(EN.calculate(input({ run: { worked_days: 15, working_days_in_period: 20 } }), [p])).PAY, 2250);
  eq(codes(EN.calculate(input({ run: { worked_days: 7, working_days_in_period: 22 } }), [p])).PAY, 954.55);
  const zero = EN.calculate(input({ run: { worked_days: 0, working_days_in_period: 0 } }), [p]);
  ok(zero.issues.some((x) => x.code === 'step_error' && x.error === 'expr_math'), 'div by zero');
});

// ---- fields
test('profile and entity fields: defaults, coercion, enums, required, scope', () => {
  const p = pack({
    profile_fields: [
      { key: 'n', label: 'N', type: 'number', default: 2 },
      { key: 'm', label: 'Money', type: 'money' },
      { key: 'flag', label: 'Flag', type: 'boolean', default: false },
      { key: 'st', label: 'Status', type: 'enum', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], default: 'a' },
      { key: 'd', label: 'Day', type: 'date' },
      { key: 'rate', label: 'Rate', type: 'number', scope: 'entity', default: 0.5 }
    ],
    steps: [{ code: 'A', name: 'a', kind: 'info', amount: 'profile.n * entity.rate + coalesce(profile.m, 0)', keep_zero: true }, { var: 'st', expr: 'profile.st' }, { var: 'd', expr: 'coalesce(profile.d, "none")' }, { var: 'f', expr: 'profile.flag' }]
  });
  const out = EN.calculate(input(), [p]);
  eq(codes(out).A, 1);
  eq(out.vars['zz-test'], { st: 'a', d: 'none', f: false });
  const strs = EN.calculate(input({ profile: { n: '3', m: '10.5', flag: 'true', st: 'b', d: '2026-02-01' }, entity: { rate: '2' } }), [p]);
  eq(codes(strs).A, 16.5);
  eq(strs.vars['zz-test'], { st: 'b', d: '2026-02-01', f: true });
  const badEnum = EN.calculate(input({ profile: { st: 'c' } }), [p]);
  eq(issueCodes(badEnum), ['profile_invalid', 'zero_gross']);
  eq(badEnum.explain.packs[0].skipped, true);
  eq(badEnum.lines.length, 0);
  ok(issueCodes(EN.calculate(input({ profile: { n: 'x' } }), [p])).indexOf('profile_invalid') >= 0);
  ok(issueCodes(EN.calculate(input({ profile: { d: '2026-13-01' } }), [p])).indexOf('profile_invalid') >= 0);
  ok(issueCodes(EN.calculate(input({ entity: { rate: 'high' } }), [p])).indexOf('entity_invalid') >= 0);
  const req = pack({ profile_fields: [{ key: 'tfn', label: 'Tax file number choice', type: 'text', required: true, form: 'TFN declaration' }], steps: [{ code: 'A', name: 'a', kind: 'info', amount: 'len(profile.tfn)' }] });
  const miss = EN.calculate(input(), [req]);
  eq(issueCodes(miss), ['profile_missing', 'zero_gross']);
  ok(miss.issues[0].message.indexOf('TFN declaration') >= 0, 'form named');
  // an undeclared field is an unknown name at run time
  const und = pack({ steps: [{ code: 'A', name: 'a', kind: 'info', amount: 'profile.nope' }] });
  ok(EN.calculate(input(), [und]).issues[0].message.indexOf('no pack in this calculation declares') >= 0);
  // two packs share one field when the types agree, conflict when they do not
  const p2 = pack({ code: 'zz-two', order: 20, profile_fields: [{ key: 'n', label: 'N', type: 'text' }], steps: [{ code: 'B', name: 'b', kind: 'info', amount: '1' }] });
  ok(issueCodes(EN.calculate(input(), [p, p2])).indexOf('field_conflict') >= 0);
});

// ---- errors
test('a step error is a blocker with pack, step and field; the pack stops, others go on', () => {
  const a = pack({ code: 'zz-a', order: 10, steps: [{ code: 'A1', name: 'a', kind: 'earning', amount: '100' }, { var: 'x', expr: 'sum("gross") / (sum("none"))' }, { code: 'A2', name: 'a', kind: 'earning', amount: '1' }] });
  const b = pack({ code: 'zz-b', order: 20, steps: [{ code: 'B1', name: 'b', kind: 'earning', amount: '5' }] });
  const out = EN.calculate(input({ lines: [basic(1000)] }), [a, b]);
  eq(codes(out), { BASIC: 1000, A1: 100, B1: 5 });
  const e = out.issues.find((i) => i.code === 'step_error');
  eq([e.severity, e.pack, e.step, e.field, e.error, e.name], ['blocker', 'zz-a', 1, 'expr', 'expr_math', 'x']);
  ok(e.message.indexOf('division by zero') >= 0, e.message);
  const nan = pack({ steps: [{ code: 'N', name: 'n', kind: 'info', amount: '1e308 * 1e10' }] });
  ok(EN.calculate(input(), [nan]).issues.some((i) => i.error === 'expr_math'));
  const unk = pack({ steps: [{ code: 'U', name: 'u', kind: 'info', amount: 'missing_var + 1' }] });
  ok(EN.calculate(input(), [unk]).issues.some((i) => i.error === 'expr_name'));
  const tbl = pack({ steps: [{ code: 'T', name: 't', kind: 'info', amount: 'table("nope", 1)' }] });
  ok(EN.calculate(input(), [tbl]).issues.some((i) => i.error === 'expr_table'));
  const later = pack({ steps: [{ code: 'L1', name: 'l', kind: 'info', amount: 'line("L2")' }, { code: 'L2', name: 'l', kind: 'info', amount: '1' }] });
  ok(EN.calculate(input(), [later]).issues[0].message.indexOf('computed later') >= 0);
  const typ = pack({ steps: [{ code: 'W', name: 'w', kind: 'info', amount: '1', when: '1' }] });
  ok(EN.calculate(input(), [typ]).issues[0].message.indexOf('when must give true or false') >= 0);
  const txt = pack({ steps: [{ code: 'S', name: 's', kind: 'info', amount: '"abc"' }] });
  ok(EN.calculate(input(), [txt]).issues[0].message.indexOf('amount must be a number') >= 0);
});
test('payslip issues: negative net, zero gross, below minimum wage', () => {
  const p = pack({ min_wage: { hourly: 10 }, steps: [{ code: 'D', name: 'd', kind: 'deduction', stage: 'post', amount: 'sum("gross") * 1.5' }] });
  const neg = EN.calculate(input({ lines: [basic(100)] }), [p]);
  ok(issueCodes(neg).indexOf('negative_net') >= 0);
  eq(neg.totals.net, -50);
  const zero = pack({ steps: [{ code: 'Z', name: 'z', kind: 'info', amount: '0' }] });
  eq(issueCodes(EN.calculate(input(), [zero])), ['zero_gross']);
  eq(issueCodes(EN.calculate(input({ run: { kind: 'reimbursement' } }), [zero])), []);
  const mw = EN.calculate(input({ lines: [basic(900)], context: { hours_worked: 100 } }), [zero]);
  eq(issueCodes(mw), []);
  const mw2 = EN.calculate(input({ lines: [basic(900)], context: { hours_worked: 100, min_wage_hourly: 9.5 } }), [pack({ min_wage: { hourly: 10 }, steps: [{ code: 'Z', name: 'z', kind: 'info', amount: '0' }] })]);
  eq(issueCodes(mw2), ['below_min_wage']);
  eq(mw2.issues[0].minimum, 10);
  eq(mw2.issues[0].rate, 9);
  // only regular runs: a bonus, off-cycle, termination, correction or reimbursement payslip never gets it
  const low = { lines: [basic(900)], context: { hours_worked: 100, min_wage_hourly: 9.5 } };
  for (const kind of ['bonus', 'off_cycle', 'termination', 'correction', 'reimbursement']) {
    const o = EN.calculate(input(Object.assign({}, low, { run: { kind: kind } })), [pack({ min_wage: { hourly: 10 }, steps: [{ code: 'Z', name: 'z', kind: 'info', amount: '0' }] })]);
    ok(issueCodes(o).indexOf('below_min_wage') < 0, kind);
  }
  // no hours known: no check
  eq(issueCodes(EN.calculate(input({ lines: [basic(900)], context: { min_wage_hourly: 9.5 } }), [zero])), []);
});

// ---- year end
test('year_end_steps run after steps when run.year_end; yearEnd() keeps only packs that have them', () => {
  const p = pack({
    steps: [{ var: 'monthly', expr: '100' }, { code: 'WHT', name: 'w', kind: 'deduction', stage: 'statutory', amount: 'monthly' }],
    year_end_steps: [{ var: 'annual_tax', expr: '1100' }, { code: 'YEA', name: 'adjust', kind: 'deduction', stage: 'statutory', amount: 'annual_tax - ytd_code("WHT") - line("WHT")' }]
  });
  const other = pack({ code: 'zz-other', order: 5, steps: [{ code: 'O', name: 'o', kind: 'info', amount: '1' }] });
  const hist = [{ id: 'x', kind: 'regular', pay_date: '2026-06-30', by_code: { WHT: 1100 } }];
  const i = input({ run: { period_start: '2026-12-01', period_end: '2026-12-31', pay_date: '2026-12-25' }, lines: [basic(5000)], history: hist });
  eq(codes(EN.calculate(i, [p, other])), { BASIC: 5000, O: 1, WHT: 100 });
  const ye = Object.assign({}, i, { run: Object.assign({}, i.run, { year_end: true }) });
  const out = EN.calculate(ye, [p, other]);
  eq(codes(out), { BASIC: 5000, O: 1, WHT: 100, YEA: -100 });
  eq(out.lines.find((l) => l.code === 'YEA').phase, 'year_end');
  const y2 = EN.yearEnd(i, [p, other]);
  eq(codes(y2), { BASIC: 5000, WHT: 100, YEA: -100 });
  eq(y2.phase, 'year_end');
  // a year-end pack keeps the packs it requires
  const needs = Object.assign({}, p, { code: 'zz-ye', order: 20, requires: ['zz-other'], year_end_steps: [{ code: 'YE2', name: 'y', kind: 'info', amount: 'line("O") + 1' }] });
  eq(codes(EN.yearEnd(i, [needs, other])), { BASIC: 5000, O: 1, WHT: 100, YE2: 2 });
});

// ---- explanation and determinism
test('every line carries its explanation: formula, reads with values, rounding, note', () => {
  const p = pack({
    profile_fields: [{ key: 'rate', label: 'Rate', type: 'number', default: 0.1 }],
    steps: [{ var: 'base', expr: 'sum("gross")' }, { code: 'T', name: 'Tax', kind: 'deduction', stage: 'statutory', when: 'base > 0', amount: 'base * profile.rate', explain: 'flat rate', base: 'base', rate: 'profile.rate', payee: 'Tax office', filing: 'zz_monthly' }]
  });
  const out = EN.calculate(input({ lines: [basic(1234.56)] }), [p]);
  const t = out.lines.find((l) => l.code === 'T');
  eq(t.amount, 123.46);
  eq([t.base, t.rate, t.pack, t.pack_version, t.step, t.payee, t.filing], [1234.56, 0.1, 'zz-test', '1', 1, 'Tax office', 'zz_monthly']);
  eq(t.explain.expr, 'base * profile.rate');
  eq(t.explain.when, 'base > 0');
  eq(t.explain.reads, [{ name: 'base', value: 1234.56 }, { name: 'profile.rate', value: 0.1 }]);
  eq(t.explain.value, 123.456);
  eq(t.explain.note, 'flat rate');
  eq(out.explain.vars['zz-test'].base.reads, [{ name: 'sum("gross")', value: 1234.56 }]);
  eq(out.lines[0].explain, { source: 'input' });
});
test('deterministic: same input, same bytes and hash; any change changes the hash; pack order in the list does not matter', () => {
  const a = pack({ code: 'zz-a', order: 10, steps: [{ code: 'A', name: 'a', kind: 'deduction', stage: 'statutory', amount: 'sum("gross") * 0.0765', tags: ['t'] }] });
  const b = pack({ code: 'zz-b', order: 20, steps: [{ code: 'B', name: 'b', kind: 'deduction', stage: 'statutory', amount: 'sum("t") * 0.5' }] });
  const i = input({ lines: [basic(4321.09)] });
  const o1 = EN.calculate(i, [a, b]);
  const o2 = EN.calculate(JSON.parse(JSON.stringify(i)), [b, a]);
  eq(JSON.stringify(o1), JSON.stringify(o2));
  ok(/^[0-9a-f]{16}$/.test(o1.hash), o1.hash);
  const o3 = EN.calculate(input({ lines: [basic(4321.1)] }), [a, b]);
  ok(o3.hash !== o1.hash, 'hash changes');
  eq(EN.hash({ b: 1, a: [1, 'x', null] }), EN.hash({ a: [1, 'x', null], b: 1 }));
  ok(EN.hash('a') !== EN.hash('b'));
});
test('totals add up by group', () => {
  const lines = [
    basic(5000),
    { code: 'OT', kind: 'earning', amount: 250.25 },
    { code: 'K401', kind: 'deduction', stage: 'pre', amount: 300 },
    { code: 'UNION', kind: 'deduction', stage: '', amount: 20 },
    { code: 'LOAN', kind: 'deduction', stage: 'post', amount: 100 },
    { code: 'REIMB', kind: 'reimbursement', amount: 45.5 },
    { code: 'NOTE', kind: 'info', amount: 999 }
  ];
  const p = pack({ steps: [{ code: 'TAX', name: 't', kind: 'deduction', stage: 'statutory', amount: '500.1' }, { code: 'ER', name: 'e', kind: 'employer', amount: '400' }, { var: 'g', expr: 'total("gross") + total("pre") + total("net")' }] });
  const out = EN.calculate(input({ lines: lines }), [p]);
  eq(out.totals, { gross: 5250.25, pre: 300, statutory: 500.1, post: 120, deductions: 920.1, employer: 400, reimbursement: 45.5, net: 4375.65, employer_cost: 5695.75 });
  eq(out.vars['zz-test'].g, 5250.25 + 300 + 4375.65);
});
test('pickVersions keeps the version in force on each pack\'s basis day', () => {
  const v26 = pack({ code: 'jp', version: '2026.1', effective_from: '2026-01-01', effective_to: '2026-12-31' });
  const v27 = pack({ code: 'jp', version: '2027.1', effective_from: '2027-01-01', effective_to: '2027-12-31' });
  const us = pack({ code: 'us', version: '2026.1', effective_from: '2026-01-01', effective_to: '2026-12-31' });
  eq(EN.pickVersions([v26, v27, us], { pay_date: '2027-01-25' }).map((p) => p.code + '@' + p.version), ['jp@2027.1']);
  eq(EN.pickVersions([v27, v26, us], { pay_date: '2026-12-25' }).map((p) => p.code + '@' + p.version), ['jp@2026.1', 'us@2026.1']);
});
test('preview fills defaults like a vector', () => {
  const p = pack({ steps: [{ code: 'A', name: 'a', kind: 'earning', amount: '42' }] });
  const out = EN.preview(p, {});
  eq(codes(out), { A: 42 });
  eq(out.explain.packs[0].basis_day, '2026-01-31');
  const ci = EN.completeInput({}, pack({ effective_from: '2026-04-06', currency: 'GBP' }));
  eq([ci.run.period_start, ci.run.period_end, ci.currency.exponent], ['2026-05-01', '2026-05-31', 2]);
  eq(EN.completeInput({}, pack({ currency: 'JPY' })).currency.exponent, 0);
  eq(EN.completeInput({}, pack({ currency: 'KWD' })).currency.exponent, 3);
});

// ---- a realistic synthetic two-pack example
test('two packs: social contributions then tax with YTD annualisation (worked by hand)', () => {
  const social = pack({
    code: 'zz-social', order: 10, tax_year: { start: '01-01' },
    profile_fields: [{ key: 'resident', label: 'Resident', type: 'boolean', default: true }, { key: 'er_rate', label: 'Employer rate', type: 'number', scope: 'entity', default: 0.1 }],
    tables: {
      ee_rate: { type: 'bands', rows: [{ under: 55, value: 0.2 }, { from: 55, under: 60, value: 0.15 }, { from: 60, value: 0.075 }] },
      ceiling: { type: 'map', rows: { monthly: 8000, weekly: 1850 } }
    },
    steps: [
      { var: 'age', expr: 'age_on(run.period_end)' },
      { var: 'ow', expr: 'min(sum("ow"), map("ceiling", run.frequency))' },
      { code: 'ZZ_SOC_EE', name: 'Social (employee)', kind: 'deduction', stage: 'statutory', when: 'profile.resident', amount: 'ow * band("ee_rate", age)', round: { mode: 'down', step: 1 }, tags: ['soc_ee'] },
      { code: 'ZZ_SOC_ER', name: 'Social (employer)', kind: 'employer', amount: 'ow * entity.er_rate' },
      { check: 'age < 75', severity: 'warning', issue: 'zz_over_75', message: 'over 75' }
    ]
  });
  const tax = pack({
    code: 'zz-tax', order: 20, tax_year: { start: '04-01' }, requires: ['zz-social'],
    tables: { annual: { type: 'brackets', rows: [{ from: 0, rate: 0, base: 0 }, { from: 12000, rate: 0.1, base: 0 }, { from: 40000, rate: 0.2, base: 2800 }] } },
    steps: [
      { var: 'taxable_now', expr: 'sum("taxable") - line("ZZ_SOC_EE")' },
      { var: 'annual', expr: 'ytd("tax_base") + taxable_now * (run.periods_remaining + 1)' },
      { var: 'annual_tax', expr: 'table("annual", annual)' },
      { code: 'ZZ_TAX_BASE', name: 'Taxable pay', kind: 'info', amount: 'taxable_now', tags: ['tax_base'] },
      { code: 'ZZ_TAX', name: 'Income tax', kind: 'deduction', stage: 'statutory', amount: 'max(0, (annual_tax - ytd_code("ZZ_TAX")) / (run.periods_remaining + 1))', round: { mode: 'half_up', step: 1 } }
    ]
  });
  const i = input({
    run: { period_start: '2026-06-01', period_end: '2026-06-30', pay_date: '2026-06-30' },
    employee: { id: 'e1', birth_date: '1970-07-15', hire_day: '2015-01-01' },
    entity: { er_rate: 0.17 },
    lines: [
      { code: 'BASIC', kind: 'earning', amount: 9000, tags: ['ow', 'taxable'] },
      { code: 'ALLOW', kind: 'earning', amount: 500, tags: ['ow', 'taxable'] }
    ],
    history: [
      { id: 'mar', kind: 'regular', pay_date: '2026-03-31', by_tag: { tax_base: 9999 }, by_code: { ZZ_TAX: 999 } },
      { id: 'apr', kind: 'regular', pay_date: '2026-04-30', by_tag: { tax_base: 8300 }, by_code: { ZZ_TAX: 400 } },
      { id: 'may', kind: 'regular', pay_date: '2026-05-29', by_tag: { tax_base: 8300 }, by_code: { ZZ_TAX: 400 } }
    ]
  });
  const out = EN.calculate(i, [tax, social]);
  // age 55 -> 15%; ow = min(9,500, 8,000) = 8,000; employee 1,200; employer 8,000 x 0.17 = 1,360
  // tax year from 1 April: June is period 3, 9 remain; taxable now 9,500 - 1,200 = 8,300
  // annual = 16,600 + 8,300 x 10 = 99,600; tax = 2,800 + 59,600 x 0.2 = 14,720; (14,720 - 800) / 10 = 1,392
  eq(codes(out), { BASIC: 9000, ALLOW: 500, ZZ_SOC_EE: 1200, ZZ_SOC_ER: 1360, ZZ_TAX_BASE: 8300, ZZ_TAX: 1392 });
  eq(out.vars['zz-tax'], { taxable_now: 8300, annual: 99600, annual_tax: 14720 });
  eq(out.totals, { gross: 9500, pre: 0, statutory: 2592, post: 0, deductions: 2592, employer: 1360, reimbursement: 0, net: 6908, employer_cost: 10860 });
  eq(out.issues, []);
  eq(out.explain.packs.map((p) => [p.code, p.tax_year_start, p.period_index, p.periods_remaining, p.periods_paid]), [['zz-social', '2026-01-01', 6, 6, 3], ['zz-tax', '2026-04-01', 3, 9, 2]]);
  const nonres = EN.calculate(Object.assign({}, i, { profile: { resident: false } }), [tax, social]);
  eq(codes(nonres).ZZ_SOC_EE, undefined);
  // (14,720 recomputed on 9,500 a month: annual 16,600 + 95,000 = 111,600; tax 17,120; (17,120 - 800) / 10 = 1,632)
  eq(codes(nonres).ZZ_TAX, 1632);
});
