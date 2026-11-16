/**
 * lib_expr unit tests: tokenizer, parser, every operator and function,
 * rounding edge cases, tables, limits and error paths.
 */
import { load, file, test, eq, near, ok, throws } from './_harness.mjs';

const X = load('lib_expr.js');
file('expr');

/** A small environment like the engine's, over plain data. */
function env(data) {
  const d = data || {};
  const tables = {};
  for (const k of Object.keys(d.tables || {})) tables[k] = X.prepareTable(k, d.tables[k]);
  const e = {
    reads: [],
    usedTables: [],
    name(path, text) {
      let v;
      if (path.length === 1) {
        if (!Object.prototype.hasOwnProperty.call(d.vars || {}, path[0])) throw X.exprError('expr_name', 'unknown name ' + text);
        v = d.vars[path[0]];
      } else {
        let o = d[path[0]] || {};
        for (let i = 1; i < path.length; i++) {
          o = o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, path[i]) ? o[path[i]] : null;
        }
        v = o === undefined ? null : o;
      }
      e.reads.push([text, v]);
      return v;
    },
    sum: (tag) => (d.sums || {})[tag] || 0,
    sumCode: (code) => (d.codes || {})[code] || 0,
    line: (code) => {
      if (!Object.prototype.hasOwnProperty.call(d.lines || {}, code)) throw X.exprError('expr_name', 'line(' + code + ') unknown');
      return d.lines[code];
    },
    ytd: (tag) => (d.ytd || {})[tag] || 0,
    ytdCode: (code) => (d.ytdCodes || {})[code] || 0,
    total: (g) => (d.totals || {})[g] || 0,
    table(name, type) {
      if (!tables[name]) throw X.exprError('expr_table', 'no table ' + name);
      if (tables[name].type !== type) throw X.exprError('expr_table', 'table ' + name + ' is not ' + type);
      return tables[name];
    },
    used: (u) => e.usedTables.push(u),
    birthDate: () => (d.employee || {}).birth_date
  };
  return e;
}

function ev(src, data) {
  return X.compile(src).run(env(data));
}

const run = { periods_per_year: 12, worked_days: 15, working_days_in_period: 20, pay_date: '2026-06-25', kind: 'regular' };

// ---- literals and tokens
test('number literals', () => {
  eq(ev('12'), 12);
  eq(ev('0.062'), 0.062);
  eq(ev('1e3'), 1000);
  eq(ev('2.5E-2'), 0.025);
  eq(ev('.5'), 0.5);
  eq(ev('-3'), -3);
});
test('text literals and escapes', () => {
  eq(ev('"abc"'), 'abc');
  eq(ev('"a\\"b"'), 'a"b');
  eq(ev('"a\\\\b"'), 'a\\b');
  eq(ev('"\\u0041\\n"'), 'A\n');
  eq(ev('"東京"'), '東京');
});
test('booleans', () => {
  eq(ev('true'), true);
  eq(ev('false'), false);
});
test('syntax errors', () => {
  throws(() => X.parse('1 +'), 'expr_syntax', 'ends too early');
  throws(() => X.parse('(1 + 2'), 'expr_syntax', 'expected ")"');
  throws(() => X.parse('"open'), 'expr_syntax', 'not closed');
  throws(() => X.parse("'single'"), 'expr_syntax', 'double quotes');
  throws(() => X.parse('a = 1'), 'expr_syntax', 'use ==');
  throws(() => X.parse('a & b'), 'expr_syntax', '&&');
  throws(() => X.parse('a | b'), 'expr_syntax', '||');
  throws(() => X.parse('1 2'), 'expr_syntax', 'missing operator');
  throws(() => X.parse('12abc'), 'expr_syntax');
  throws(() => X.parse('1.'), 'expr_syntax');
  throws(() => X.parse('1e'), 'expr_syntax');
  throws(() => X.parse('a[0]'), 'expr_syntax', 'not part of the language');
  throws(() => X.parse(''), 'expr_syntax', 'empty');
  throws(() => X.parse('+1'), 'expr_syntax');
  throws(() => X.parse('1 ? 2'), 'expr_syntax', 'expected ":"');
  throws(() => X.parse('1 : 2'), 'expr_syntax', '":" without');
  throws(() => X.parse('a < b < c'), 'expr_syntax', 'chained');
  throws(() => X.parse('a == b == c'), 'expr_syntax', 'chained');
  throws(() => X.parse('run.'), 'expr_syntax');
  throws(() => X.parse('"\\q"'), 'expr_syntax', 'unknown escape');
  throws(() => X.parse('1 # 2'), 'expr_syntax', 'unexpected character');
});
test('names: roots, forbidden parts, unknown functions, arity', () => {
  throws(() => X.parse('window.alert'), 'expr_name', 'dotted names start with');
  throws(() => X.parse('profile.__proto__'), 'expr_name', 'not allowed');
  throws(() => X.parse('context.constructor'), 'expr_name', 'not allowed');
  throws(() => X.parse('run'), 'expr_name', 'group of fields');
  throws(() => X.parse('eval("1")'), 'expr_syntax', 'unknown function');
  throws(() => X.parse('Function("x")'), 'expr_syntax', 'unknown function');
  throws(() => X.parse('profile.x(1)'), 'expr_syntax', 'unknown function');
  throws(() => X.parse('abs(1, 2)'), 'expr_syntax', 'takes 1 argument');
  throws(() => X.parse('clamp(1, 2)'), 'expr_syntax', 'takes 3 arguments');
  throws(() => X.parse('min()'), 'expr_syntax', '1 or more');
  throws(() => X.parse('periods(1)'), 'expr_syntax', 'takes 0 arguments');
});
test('limits: length, depth, arguments', () => {
  throws(() => X.parse('1+'.repeat(2500) + '1'), 'expr_limit', 'longer than');
  throws(() => X.parse('('.repeat(60) + '1' + ')'.repeat(60)), 'expr_limit', 'nested deeper');
  throws(() => X.parse('-'.repeat(60) + '1'), 'expr_limit');
  throws(() => X.parse('max(' + Array(70).fill('1').join(',') + ')'), 'expr_limit', 'arguments');
  eq(ev('(((((1)))))'), 1);
});

// ---- operators and precedence
test('arithmetic and precedence', () => {
  eq(ev('1 + 2 * 3'), 7);
  eq(ev('(1 + 2) * 3'), 9);
  eq(ev('10 - 4 - 3'), 3);
  eq(ev('100 / 10 / 5'), 2);
  eq(ev('7 % 3'), 1);
  eq(ev('-7 % 3'), -1);
  eq(ev('-2 * -3'), 6);
  eq(ev('- (2 + 3)'), -5);
  eq(ev('2 * -x', { vars: { x: 4 } }), -8);
  eq(ev('-x', { vars: { x: 0 } }), 0);
  eq(ev('1 + 2 < 4'), true);
  eq(ev('1 < 2 == true'), true);
  eq(ev('1 < 2 && 2 < 3'), true);
  eq(ev('true || false && false'), true);
  eq(ev('(true || false) && false'), false);
  eq(ev('!true || true'), true);
  eq(ev('!(1 > 2)'), true);
});
test('ternary is right associative and lazy', () => {
  eq(ev('true ? 1 : 2'), 1);
  eq(ev('false ? 1 : false ? 2 : 3'), 3);
  eq(ev('false ? 1 / 0 : 5'), 5);
  eq(ev('1 > 0 ? "yes" : "no"'), 'yes');
});
test('text concatenation', () => {
  eq(ev('"fit_" + profile.s', { profile: { s: 'single' } }), 'fit_single');
  eq(ev('"n" + 1.5'), 'n1.5');
  eq(ev('2 + "x"'), '2x');
  eq(ev('"a" + (0.1 + 0.2)'), 'a0.3');
  throws(() => ev('"a" + true'), 'expr_type');
  throws(() => ev('"a" + profile.x', { profile: {} }), 'expr_type', 'no value');
});
test('comparisons on numbers and texts', () => {
  eq(ev('0.1 + 0.2 == 0.3'), true);
  eq(ev('0.1 + 0.2 <= 0.3'), true);
  eq(ev('"2026-04-01" <= run.pay_date', { run }), true);
  eq(ev('"b" > "a"'), true);
  eq(ev('1 != 2'), true);
  eq(ev('"a" == "a"'), true);
  throws(() => ev('"1" == 1'), 'expr_type', 'different kinds');
  throws(() => ev('"1" < 1'), 'expr_type', 'cannot order');
  throws(() => ev('true < false'), 'expr_type');
});
test('no value (null) rules', () => {
  eq(ev('profile.x == profile.y', { profile: {} }), true);
  eq(ev('profile.x == "A"', { profile: {} }), false);
  eq(ev('profile.x != "A"', { profile: {} }), true);
  throws(() => ev('profile.x + 1', { profile: {} }), 'expr_type', 'coalesce');
  throws(() => ev('profile.x * 2', { profile: {} }), 'expr_type', 'no value');
  throws(() => ev('!profile.flag', { profile: {} }), 'expr_type', 'no value');
});
test('type errors for booleans and numbers', () => {
  throws(() => ev('1 && true'), 'expr_type', 'true or false');
  throws(() => ev('true + 1'), 'expr_type');
  throws(() => ev('!1'), 'expr_type');
  throws(() => ev('-"a"'), 'expr_type');
  throws(() => ev('"a" * 2'), 'expr_type');
  throws(() => ev('1 ? 2 : 3'), 'expr_type');
  throws(() => ev('if(1, 2, 3)'), 'expr_type');
});
test('numeric errors: division by zero, remainder by zero, overflow', () => {
  throws(() => ev('1 / 0'), 'expr_math', 'division by zero');
  throws(() => ev('x / (y - y)', { vars: { x: 1, y: 3 } }), 'expr_math', 'division by zero');
  throws(() => ev('5 % 0'), 'expr_math', 'remainder by zero');
  throws(() => ev('1e308 * 10'), 'expr_math', 'finite');
  throws(() => ev('1e308 + 1e308'), 'expr_math', 'finite');
});
test('names read from the environment and are recorded', () => {
  const e = env({ run, vars: { a: 2 } });
  eq(X.compile('a * run.periods_per_year').run(e), 24);
  eq(e.reads, [['a', 2], ['run.periods_per_year', 12]]);
  eq(ev('context.region.code', { context: { region: { code: 'CA' } } }), 'CA');
});

// ---- functions
test('min max abs floor ceil', () => {
  eq(ev('min(3, 1, 2)'), 1);
  eq(ev('max(3, 1, 2)'), 3);
  eq(ev('min(5)'), 5);
  eq(ev('abs(-2.5)'), 2.5);
  eq(ev('floor(2.7)'), 2);
  eq(ev('floor(-2.1)'), -3);
  eq(ev('ceil(2.1)'), 3);
  eq(ev('ceil(-2.9)'), -2);
  eq(ev('floor(0.29 * 100)'), 29);
  eq(ev('ceil(0.1 * 3 * 10)'), 3);
  throws(() => ev('min(1, "a")'), 'expr_type');
});
test('round half away from zero, with decimals', () => {
  eq(ev('round(2.5)'), 3);
  eq(ev('round(-2.5)'), -3);
  eq(ev('round(1.005, 2)'), 1.01);
  eq(ev('round(-1.005, 2)'), -1.01);
  eq(ev('round(2.675, 2)'), 2.68);
  eq(ev('round(1234.5678, 2)'), 1234.57);
  eq(ev('round(1250, -2)'), 1300);
  eq(ev('round(-1250, -2)'), -1300);
  eq(ev('round(0.4999999999999999)'), 1);
  eq(ev('round(0.49)'), 0);
  throws(() => ev('round(1, 0.5)'), 'expr_type', 'whole number');
  throws(() => ev('round(1, 20)'), 'expr_math');
});
test('round_even (bankers)', () => {
  eq(ev('round_even(2.5)'), 2);
  eq(ev('round_even(3.5)'), 4);
  eq(ev('round_even(-2.5)'), -2);
  eq(ev('round_even(-3.5)'), -4);
  eq(ev('round_even(1.005, 2)'), 1);
  eq(ev('round_even(1.015, 2)'), 1.02);
  eq(ev('round_even(1.0151, 2)'), 1.02);
  eq(ev('round_even(2.4)'), 2);
});
test('round_up and round_down go away from and toward zero', () => {
  eq(ev('round_up(1.01, 1)'), 2);
  eq(ev('round_up(-1.01, 1)'), -2);
  eq(ev('round_up(2, 1)'), 2);
  eq(ev('round_up(1.15, 0.01)'), 1.15);
  eq(ev('round_up(1.151, 0.01)'), 1.16);
  eq(ev('round_up(1234, 10)'), 1240);
  eq(ev('round_up(1201, 100)'), 1300);
  eq(ev('round_down(1.99, 1)'), 1);
  eq(ev('round_down(-1.99, 1)'), -1);
  eq(ev('round_down(1239, 10)'), 1230);
  eq(ev('round_down(1299.99, 100)'), 1200);
  eq(ev('round_down(0.29 * 100, 1)'), 29);
  throws(() => ev('round_up(1, 0)'), 'expr_math', 'step must be above 0');
  throws(() => ev('round_down(1, -1)'), 'expr_math');
});
test('round_to and round_half_down', () => {
  eq(ev('round_to(1234, 10)'), 1230);
  eq(ev('round_to(1235, 10)'), 1240);
  eq(ev('round_to(-1235, 10)'), -1240);
  eq(ev('round_to(2.675, 0.05)'), 2.7);
  eq(ev('round_to(2.625, 0.05)'), 2.65);
  eq(ev('round_to(7.5, 5)'), 10);
  eq(ev('round_half_down(100.5, 1)'), 100);
  eq(ev('round_half_down(100.51, 1)'), 101);
  eq(ev('round_half_down(-100.5, 1)'), -100);
  eq(ev('round_half_down(15, 10)'), 10);
});
test('clamp, if, coalesce, in', () => {
  eq(ev('clamp(5, 0, 3)'), 3);
  eq(ev('clamp(-1, 0, 3)'), 0);
  eq(ev('clamp(2, 0, 3)'), 2);
  throws(() => ev('clamp(1, 3, 0)'), 'expr_math', 'above the high end');
  eq(ev('if(true, 1, 1 / 0)'), 1);
  eq(ev('if(false, 1 / 0, 2)'), 2);
  eq(ev('coalesce(profile.a, profile.b, 7)', { profile: {} }), 7);
  eq(ev('coalesce(profile.a, 1 / 0)', { profile: { a: 3 } }), 3);
  eq(ev('coalesce(profile.a, profile.b)', { profile: {} }), null);
  eq(ev('coalesce(profile.a, 0)', { profile: { a: 0 } }), 0);
  eq(ev('in(profile.s, "a", "b")', { profile: { s: 'b' } }), true);
  eq(ev('in(3, 1, 2)'), false);
  eq(ev('in(0.3, 0.1 + 0.2)'), true);
});
test('payslip functions: sum, sum_code, line, ytd, ytd_code, total', () => {
  const d = { sums: { fit_wages: 5000.5 }, codes: { BASIC: 4000 }, lines: { US_SS: 310 }, ytd: { ss_wages: 120000 }, ytdCodes: { US_SS: 7440 }, totals: { gross: 5000.5 } };
  eq(ev('sum("fit_wages")', d), 5000.5);
  eq(ev('sum("missing")', d), 0);
  eq(ev('sum_code("BASIC")', d), 4000);
  eq(ev('line("US_SS")', d), 310);
  throws(() => ev('line("NOPE")', d), 'expr_name');
  eq(ev('ytd("ss_wages")', d), 120000);
  eq(ev('ytd_code("US_SS")', d), 7440);
  eq(ev('total("gross")', d), 5000.5);
  throws(() => ev('sum(1)', d), 'expr_type', 'needs text');
});
test('periods and prorate', () => {
  eq(ev('periods()', { run }), 12);
  eq(ev('prorate(2000)', { run }), 1500);
  throws(() => ev('prorate(2000)', { run: { worked_days: 5, working_days_in_period: 0 } }), 'expr_math', 'division by zero');
});
test('days: days_between, months_between, add_days, year, month', () => {
  eq(ev('days_between("2026-01-01", "2026-01-31")'), 30);
  eq(ev('days_between("2026-03-01", "2026-02-01")'), -28);
  eq(ev('days_between("2024-02-28", "2024-03-01")'), 2);
  eq(ev('months_between("2026-01-15", "2026-02-14")'), 0);
  eq(ev('months_between("2026-01-15", "2026-02-15")'), 1);
  eq(ev('months_between("2026-01-31", "2026-02-28")'), 1);
  eq(ev('months_between("2020-04-01", "2026-03-31")'), 71);
  eq(ev('months_between("2026-02-15", "2026-01-15")'), -1);
  eq(ev('add_days("2026-12-31", 1)'), '2027-01-01');
  eq(ev('add_days("2024-03-01", -1)'), '2024-02-29');
  eq(ev('year("2026-06-25")'), 2026);
  eq(ev('month("2026-06-25")'), 6);
  throws(() => ev('year("2026-6-25")'), 'expr_type', 'YYYY-MM-DD');
  throws(() => ev('month("2026-02-30")'), 'expr_type');
  throws(() => ev('add_days("2026-01-01", 1.5)'), 'expr_type', 'whole number');
});
test('age_on including 29 February', () => {
  eq(ev('age_on("2026-06-25")', { employee: { birth_date: '1986-06-25' } }), 40);
  eq(ev('age_on("2026-06-24")', { employee: { birth_date: '1986-06-25' } }), 39);
  eq(ev('age_on("2025-02-28")', { employee: { birth_date: '2004-02-29' } }), 20);
  eq(ev('age_on("2025-03-01")', { employee: { birth_date: '2004-02-29' } }), 21);
  eq(ev('age_on("2028-02-29")', { employee: { birth_date: '2004-02-29' } }), 24);
  throws(() => ev('age_on("2026-01-01")', { employee: {} }), 'expr_type', 'birth_date');
});
test('text functions', () => {
  eq(ev('len("1257L")'), 5);
  eq(ev('upper("s1257l")'), 'S1257L');
  eq(ev('lower("BR")'), 'br');
  eq(ev('trim("  K475 ")'), 'K475');
  eq(ev('substr("S1257L", 1)'), '1257L');
  eq(ev('substr("S1257L", 1, 4)'), '1257');
  eq(ev('starts_with("K475", "K")'), true);
  eq(ev('ends_with("1257L", "L")'), true);
  eq(ev('ends_with("1257L", "")'), true);
  eq(ev('contains("1257L M1", " M1")'), true);
  eq(ev('digits("SK475W1")'), '4751');
  eq(ev('is_number("1257")'), true);
  eq(ev('is_number("-3.5")'), true);
  eq(ev('is_number("1e3")'), false);
  eq(ev('is_number("")'), false);
  eq(ev('is_number(12)'), false);
  eq(ev('num("1257")'), 1257);
  throws(() => ev('num(" 12")'), 'expr_type', 'plain number');
  eq(ev('text(12.5)'), '12.5');
  eq(ev('text(true)'), 'true');
  throws(() => ev('num("12a")'), 'expr_type', 'plain number');
  throws(() => ev('substr("abc", -1)'), 'expr_math');
  throws(() => ev('upper(1)'), 'expr_type', 'needs text');
});

// ---- tables
const T = {
  fit: { type: 'brackets', rows: [{ over: 0, rate: 0.1 }, { over: 10000, rate: 0.2 }, { over: 40000, rate: 0.3 }] },
  fitb: { type: 'brackets', rows: [{ over: 0, rate: 0.1, base: 0 }, { over: 10000, rate: 0.2, base: 1000 }, { over: 40000, rate: 0.3, base: 7000 }] },
  jp4: { type: 'brackets', rows: [{ over: 0, rate: 0.05105, less: 0 }, { over: 162500, rate: 0.1021, less: 8296 }, { over: 275000, rate: 0.2042, less: 36374 }] },
  epf: { type: 'bands', rows: [{ from: 0, to: 10, values: { ee: 0, er: 0 } }, { over: 10, to: 20, values: { ee: 3, er: 3 } }, { over: 20, to: 40, values: { ee: 5, er: 6 } }, { over: 40, values: { ee: 9, er: 11 } }] },
  grade: { type: 'bands', rows: [{ under: 63000, value: 58000 }, { from: 63000, under: 73000, value: 68000 }, { from: 73000, value: 78000 }] },
  pref: { type: 'map', rows: { '13': { health: 0.0985, care: 0.0162 }, '27': { health: 0.1013, care: 0.0162 } } },
  flat: { type: 'map', rows: { single: 1, married: 2 }, default: 0 },
  cat: { type: 'map', rows: { A: 'x' } }
};
test('brackets: segments add up', () => {
  eq(ev('table("fit", 5000)', { tables: T }), 500);
  eq(ev('table("fit", 10000)', { tables: T }), 1000);
  eq(ev('table("fit", 25000)', { tables: T }), 4000);
  eq(ev('table("fit", 50000)', { tables: T }), 10000);
  eq(ev('table("fit", 0)', { tables: T }), 0);
  eq(ev('table("fit", -5)', { tables: T }), 0);
});
test('brackets: base form matches the segment form', () => {
  for (const x of [0, 1, 9999.99, 10000, 10000.01, 25000, 40000, 123456.78]) {
    near(ev('table("fitb", ' + x + ')', { tables: T }), ev('table("fit", ' + x + ')', { tables: T }), 'x=' + x);
  }
});
test('brackets: quick deduction form, a row applies strictly over its "over"', () => {
  near(ev('table("jp4", 162500)', { tables: T }), 162500 * 0.05105);
  near(ev('table("jp4", 162501)', { tables: T }), 162501 * 0.1021 - 8296);
  near(ev('table("jp4", 300000)', { tables: T }), 300000 * 0.2042 - 36374);
});
test('brackets: explanation lists the rows used', () => {
  const e = env({ tables: T });
  X.compile('table("fit", 25000)').run(e);
  eq(e.usedTables[0].rows, [{ over: 0, rate: 0.1, part: 1000 }, { over: 10000, rate: 0.2, part: 3000 }]);
});
test('bands: inclusive and exclusive bounds, open ends', () => {
  eq(ev('band("epf", 10, "ee")', { tables: T }), 0);
  eq(ev('band("epf", 10.01, "ee")', { tables: T }), 3);
  eq(ev('band("epf", 20, "er")', { tables: T }), 3);
  eq(ev('band("epf", 1000000, "er")', { tables: T }), 11);
  eq(ev('band("grade", 62999)', { tables: T }), 58000);
  eq(ev('band("grade", 63000)', { tables: T }), 68000);
  eq(ev('band("grade", 72999.99)', { tables: T }), 68000);
  eq(ev('band("grade", 73000)', { tables: T }), 78000);
  eq(ev('band("grade", -10)', { tables: T }), 58000);
  eq(ev('band("grade", 6299.9 * 10)', { tables: T }), 58000);
  eq(ev('band("epf", 0.1 + 0.2 + 19.7, "ee")', { tables: T }), 3);
  throws(() => ev('band("epf", -1, "ee")', { tables: T }), 'expr_table', 'no row');
  throws(() => ev('band("epf", 15, "zz")', { tables: T }), 'expr_table', 'no column');
  throws(() => ev('band("epf", 15)', { tables: T }), 'expr_table', 'give a column');
  const e = env({ tables: T });
  X.compile('band("epf", 15, "ee")').run(e);
  eq(e.usedTables[0], { fn: 'band', table: 'epf', x: 15, value: 3, row: { row: 2, over: 10, to: 20 }, column: 'ee' });
});
test('bands: a gap between rows is an error', () => {
  const g = { gap: { type: 'bands', rows: [{ from: 0, to: 10, value: 1 }, { from: 10.01, to: 20, value: 2 }] } };
  throws(() => ev('band("gap", 10.005)', { tables: g }), 'expr_table', 'no row');
  eq(ev('band("gap", 10.01)', { tables: g }), 2);
});
test('map: values, columns, default, missing keys', () => {
  eq(ev('map("pref", "13", "health")', { tables: T }), 0.0985);
  eq(ev('map("pref", 27, "health")', { tables: T }), 0.1013);
  eq(ev('map("flat", "married")', { tables: T }), 2);
  eq(ev('map("flat", "other")', { tables: T }), 0);
  eq(ev('map("cat", "A")', { tables: T }), 'x');
  throws(() => ev('map("pref", "99", "health")', { tables: T }), 'expr_table', 'no key');
  throws(() => ev('map("pref", "13")', { tables: T }), 'expr_table', 'give a column name');
  throws(() => ev('map("pref", "13", "nope")', { tables: T }), 'expr_table', 'no column');
  throws(() => ev('map("pref", "__proto__", "health")', { tables: T }), 'expr_table');
  throws(() => ev('map("flat", profile.x)', { tables: T, profile: {} }), 'expr_type', 'no value');
});
test('table type is checked by the function', () => {
  throws(() => ev('table("epf", 5)', { tables: T }), 'expr_table', 'not brackets');
  throws(() => ev('band("fit", 5, "x")', { tables: T }), 'expr_table');
});
test('prepareTable rejects bad shapes', () => {
  throws(() => X.prepareTable('t', { type: 'brackets', rows: [] }), 'expr_table', 'at least one');
  throws(() => X.prepareTable('t', { type: 'brackets', rows: [{ over: 10, rate: 0.1 }, { over: 5, rate: 0.2 }] }), 'expr_table', 'larger than');
  throws(() => X.prepareTable('t', { type: 'brackets', rows: [{ over: 0, rate: 0.1, base: 0 }, { over: 5, rate: 0.2 }] }), 'expr_table', 'every row needs "base"');
  throws(() => X.prepareTable('t', { type: 'brackets', rows: [{ over: 0, rate: 0.1, base: 0 }, { over: 5, rate: 0.2, less: 1 }] }), 'expr_table', 'mixes');
  throws(() => X.prepareTable('t', { type: 'brackets', rows: [{ over: 0, rate: '10%' }] }), 'expr_table', 'must be a number');
  throws(() => X.prepareTable('t', { type: 'bands', rows: [{ from: 0, to: 10, value: 1 }, { from: 10, to: 20, value: 2 }] }), 'expr_table', 'overlaps');
  throws(() => X.prepareTable('t', { type: 'bands', rows: [{ from: 0, to: 10, value: 1 }, { to: 20, value: 2 }] }), 'expr_table', 'needs "from" or "over"');
  throws(() => X.prepareTable('t', { type: 'bands', rows: [{ from: 0, value: 1 }, { from: 5, to: 20, value: 2 }] }), 'expr_table', 'needs "to" or "under"');
  throws(() => X.prepareTable('t', { type: 'bands', rows: [{ from: 5, to: 1, value: 1 }] }), 'expr_table', 'empty');
  throws(() => X.prepareTable('t', { type: 'bands', rows: [{ from: 0, to: 1 }] }), 'expr_table', 'value');
  throws(() => X.prepareTable('t', { type: 'map', rows: [] }), 'expr_table');
  throws(() => X.prepareTable('t', { type: 'list', rows: [] }), 'expr_table', 'unknown type');
  ok(X.prepareTable('t', { type: 'bands', rows: [{ from: 0, to: 10, value: 1 }, { over: 10, to: 20, value: 2 }] }));
});

// ---- rounding helper directly (the engine uses it for step rounding)
test('roundStep modes and steps 0.01, 1, 10, 100, JPY 1', () => {
  const R = X.roundStep;
  eq(R(2.345, 0.01, 'half_up'), 2.35);
  eq(R(-2.345, 0.01, 'half_up'), -2.35);
  eq(R(2.345, 0.01, 'half_even'), 2.34);
  eq(R(2.355, 0.01, 'half_even'), 2.36);
  eq(R(2.345, 0.01, 'half_down'), 2.34);
  eq(R(2.3451, 0.01, 'half_down'), 2.35);
  eq(R(2.341, 0.01, 'up'), 2.35);
  eq(R(-2.341, 0.01, 'up'), -2.35);
  eq(R(2.349, 0.01, 'down'), 2.34);
  eq(R(-2.349, 0.01, 'down'), -2.34);
  eq(R(1234.5, 1, 'half_up'), 1235);
  eq(R(1234.5, 1, 'half_even'), 1234);
  eq(R(1235.5, 1, 'half_even'), 1236);
  eq(R(-0.5, 1, 'half_up'), -1);
  eq(R(-0.5, 1, 'half_even'), 0);
  eq(R(-0.4, 1, 'half_up'), 0);
  eq(R(1234, 10, 'half_up'), 1230);
  eq(R(1235, 10, 'half_up'), 1240);
  eq(R(1235, 10, 'half_even'), 1240);
  eq(R(1225, 10, 'half_even'), 1220);
  eq(R(1250, 100, 'half_up'), 1300);
  eq(R(1250, 100, 'half_even'), 1200);
  eq(R(1250, 100, 'down'), 1200);
  eq(R(1201, 100, 'up'), 1300);
  eq(R(8295.625, 1, 'down'), 8295);
  eq(R(4234.5, 1, 'half_down'), 4234);
  eq(R(0.1 + 0.2, 0.01, 'up'), 0.3);
  eq(R(1.15, 0.01, 'half_up'), 1.15);
  eq(R(10.005, 0.01, 'half_up'), 10.01);
  eq(R(123456789.125, 0.01, 'half_even'), 123456789.12);
  eq(R(123456789.135, 0.01, 'half_even'), 123456789.14);
  eq(R(2.675, 0.05, 'half_up'), 2.7);
  eq(R(0.125, 0.001, 'half_up'), 0.125);
  eq(R(0.0005, 0.001, 'half_up'), 0.001);
  throws(() => R(1, 0, 'half_up'), 'expr_math');
  throws(() => R(1, 0.01, 'nearest'), 'expr_math', 'unknown rounding mode');
  throws(() => R(NaN, 0.01, 'half_up'), 'expr_math');
});
test('snap removes binary noise only', () => {
  eq(X.snap(0.1 + 0.2), 0.3);
  eq(X.snap(1.005 * 100), 100.5);
  eq(X.snap(1 / 3), 0.333333333333333);
  eq(X.snap(0), 0);
  eq(X.snap(-0), 0);
});
test('compile caches by formula text', () => {
  const a = X.compile('1 + 2 + 3');
  const b = X.compile('1 + 2 + 3');
  ok(a === b, 'same object');
  ok(X.refsOf(X.parse('a + run.x * sum("t")')).names.length === 2);
  eq(X.refsOf(X.parse('if(a, table("x", b), 0)')).calls.map((c) => c.fn), ['if', 'table']);
});
test('no global or prototype access through any path', () => {
  throws(() => X.parse('globalThis.x'), 'expr_name');
  throws(() => X.parse('profile.prototype'), 'expr_name');
  throws(() => ev('this', {}), 'expr_name');
  // a bare unknown name is an engine error (the environment refuses it)
  throws(() => ev('process', {}), 'expr_name');
  throws(() => ev('require', {}), 'expr_name');
});
