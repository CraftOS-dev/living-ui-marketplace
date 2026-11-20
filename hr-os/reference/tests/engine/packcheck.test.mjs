/**
 * lib_packcheck tests: what validate() catches, runVectors() reporting,
 * checkSet() across versions, and the shipped generic pack.
 */
import { load, file, test, eq, ok } from './_harness.mjs';

const PC = load('lib_packcheck.js');
const generic = load('packs/generic.js');
file('packcheck');

function good(over) {
  return Object.assign(
    {
      code: 'zz-good', country: 'ZZ', region: '', name: 'Good pack', version: '2026.1', effective_from: '2026-01-01', effective_to: '2026-12-31',
      currency: 'USD', tax_year: { start: '01-01' }, requires: [], order: 10, ship: 'active',
      sources: [{ title: 'Official guide', url: 'https://example.org/guide', retrieved: '2026-11-04' }],
      notes: 'covers a flat tax',
      profile_fields: [
        { key: 'status', label: 'Status', type: 'enum', options: [{ value: 'single', label: 'Single' }, { value: 'married', label: 'Married' }], default: 'single' },
        { key: 'er_rate', label: 'Employer rate', type: 'number', scope: 'entity', default: 0.01 }
      ],
      tags: [{ tag: 'taxable', label: 'Taxable pay' }],
      tables: {
        t_single: { type: 'brackets', rows: [{ over: 0, rate: 0.1 }] },
        t_married: { type: 'brackets', rows: [{ over: 0, rate: 0.05 }] },
        bands: { type: 'bands', rows: [{ to: 100, values: { a: 1 } }, { over: 100, values: { a: 2 } }] },
        pref: { type: 'map', rows: { '13': { h: 0.1 } } }
      },
      steps: [
        { var: 'base', expr: 'sum("taxable")' },
        { code: 'TAX', name: 'Tax', kind: 'deduction', stage: 'statutory', amount: 'table("t_" + profile.status, base) + band("bands", base, "a") * 0 + map("pref", "13", "h") * 0', tags: ['tax'] },
        { code: 'ER', name: 'Employer', kind: 'employer', amount: 'base * entity.er_rate' }
      ],
      vectors: [{ name: 'basic', source: 'official', reference: 'guide example 1', input: { lines: [{ code: 'BASIC', kind: 'earning', amount: 1000, tags: ['taxable'] }] }, expect: { TAX: 100, ER: 10 } }]
    },
    over
  );
}
const errs = (pack, others) => PC.validate(pack, others).filter((p) => p.level === 'error');
const warns = (pack, others) => PC.validate(pack, others).filter((p) => p.level === 'warning');
const has = (list, code) => list.some((p) => p.code === code);
const steps = (...s) => ({ steps: s });

test('a good pack has no errors and its vector passes', () => {
  eq(errs(good()), []);
  eq(PC.runVectors(good()), { passed: 1, total: 1, failures: [] });
});
test('schema: identity, dates, ship, sources, notes', () => {
  ok(has(errs(good({ code: 'US Federal' })), 'code'));
  ok(has(errs(good({ country: 'usa' })), 'country'));
  ok(has(errs(good({ version: 2026 })), 'version'));
  ok(has(errs(good({ effective_from: '2026-1-1' })), 'effective_from'));
  ok(has(errs(good({ effective_to: '2025-12-31' })), 'effective_order'));
  ok(has(errs(good({ currency: 'yen' })), 'currency'));
  ok(has(errs(good({ tax_year: { start: '04-31' } })), 'tax_year'));
  ok(has(errs(good({ tax_year: { start: '02-29' } })), 'tax_year'));
  ok(has(errs(good({ date_basis: 'payday' })), 'date_basis'));
  ok(has(errs(good({ ship: 'live' })), 'ship'));
  ok(has(errs(good({ ship: undefined })), 'ship'));
  ok(has(errs(good({ sources: [] })), 'sources'));
  ok(has(errs(good({ sources: [{ title: 'x', url: 'https://a.b' }] })), 'source_retrieved'));
  ok(has(errs(good({ sources: [{ title: 'x', url: 'ftp://a.b', retrieved: '2026-01-01' }] })), 'source_url'));
  ok(has(errs(good({ sources: [{ title: 'x' }] })), 'source_official'));
  ok(!has(errs(good({ sources: [{ title: 'x' }], ship: 'draft' })), 'source_official'));
  ok(has(errs(good({ notes: '' })), 'notes'));
  ok(has(errs(good({ order: '10' })), 'order'));
  ok(has(warns(good({ colour: 'blue' })), 'unknown_key'));
  ok(has(errs(good({ notes: 'x', min_wage: { hourly: NaN } })), 'not_json'));
  ok(has(errs(good({ filings: [undefined] })), 'not_json'));
  ok(has(errs(good({ documents: [{ code: 'a', name: 'b', render: () => 1 }] })), 'not_json'));
  ok(has(errs(good({ tables: { d: { type: 'map', rows: { a: new Date(0) } } } })), 'not_json'));
});
test('unknown names, scopes and run keys', () => {
  ok(has(errs(good(steps({ code: 'A', name: 'a', kind: 'info', amount: 'profile.nope' }))), 'unknown_name'));
  ok(has(errs(good(steps({ code: 'A', name: 'a', kind: 'info', amount: 'run.month' }))), 'unknown_name'));
  ok(has(errs(good(steps({ code: 'A', name: 'a', kind: 'info', amount: 'employee.salary' }))), 'unknown_name'));
  ok(has(errs(good(steps({ code: 'A', name: 'a', kind: 'info', amount: 'nothing + 1' }))), 'unknown_name'));
  const scope = errs(good(steps({ code: 'A', name: 'a', kind: 'info', amount: 'profile.er_rate' })));
  ok(has(scope, 'field_scope') && scope[0].message.indexOf('entity.er_rate') >= 0, JSON.stringify(scope));
  ok(has(errs(good(steps({ code: 'A', name: 'a', kind: 'info', amount: 'entity.status == "x" ? 1 : 0' }))), 'field_scope'));
  ok(has(warns(good(steps({ code: 'A', name: 'a', kind: 'info', amount: 'coalesce(context.region_rate, 0)' }))), 'context_key'));
  eq(warns(good(steps({ code: 'A', name: 'a', kind: 'info', amount: 'coalesce(context.min_wage_hourly, 0) + run.tax_week + run.periods_remaining' }))).filter((w) => w.code === 'context_key'), []);
});
test('syntax errors and limits are reported with the step path', () => {
  const e = errs(good(steps({ code: 'A', name: 'a', kind: 'info', amount: 'max(1,' })));
  ok(has(e, 'syntax') && e.find((x) => x.code === 'syntax').path === 'steps[0].amount', JSON.stringify(e));
  ok(has(errs(good(steps({ code: 'A', name: 'a', kind: 'info', amount: 1 }))), 'line_amount'));
});
test('tables: unknown, wrong type, unknown columns and keys, dynamic names listed from enum options', () => {
  ok(has(errs(good(steps({ code: 'A', name: 'a', kind: 'info', amount: 'table("nope", 1)' }))), 'unknown_table'));
  ok(has(errs(good(steps({ code: 'A', name: 'a', kind: 'info', amount: 'table("bands", 1)' }))), 'table_type'));
  ok(has(errs(good(steps({ code: 'A', name: 'a', kind: 'info', amount: 'band("bands", 1, "zz")' }))), 'unknown_column'));
  ok(has(errs(good(steps({ code: 'A', name: 'a', kind: 'info', amount: 'band("bands", 1)' }))), 'band_column'));
  ok(has(errs(good(steps({ code: 'A', name: 'a', kind: 'info', amount: 'map("pref", "27", "h")' }))), 'unknown_key'));
  ok(has(errs(good(steps({ code: 'A', name: 'a', kind: 'info', amount: 'map("pref", "13")' }))), 'map_column'));
  // "t_" + status covers t_single and t_married; drop one table and the checker names it
  const p = good();
  delete p.tables.t_married;
  const w = warns(p);
  ok(w.some((x) => x.code === 'unknown_table' && x.message.indexOf('t_married') >= 0), JSON.stringify(w));
  // through a var, and a key listed from run.frequency
  const viaVar = good(steps({ var: 'tn', expr: '"t_" + profile.status' }, { code: 'A', name: 'a', kind: 'info', amount: 'table(tn, 1) + map("freq", run.frequency)' }));
  viaVar.tables.freq = { type: 'map', rows: { monthly: 1, weekly: 2 } };
  eq(errs(viaVar), []);
  const ww = warns(viaVar).filter((x) => x.code === 'unknown_key').map((x) => x.message.split('"')[1]);
  eq(ww, ['semi_monthly', 'biweekly']);
  ok(has(warns(good(steps({ var: 'n', expr: '"t_" + text(sum("taxable"))' }, { code: 'A', name: 'a', kind: 'info', amount: 'table(n, 1)' }))), 'table_dynamic'));
  ok(has(errs(good({ tables: { bad: { type: 'brackets', rows: [{ over: 5, rate: 0.1 }, { over: 1, rate: 0.2 }] } } })), 'table'));
});
test('vars: duplicates, reserved names, used before set or by themselves', () => {
  ok(has(errs(good(steps({ var: 'a', expr: '1' }, { var: 'a', expr: '2' }, { code: 'A', name: 'a', kind: 'info', amount: 'a' }))), 'var_duplicate'));
  ok(has(errs(good(steps({ var: 'sum', expr: '1' }, { code: 'A', name: 'a', kind: 'info', amount: '1' }))), 'var_name'));
  ok(has(errs(good(steps({ var: 'run', expr: '1' }, { code: 'A', name: 'a', kind: 'info', amount: '1' }))), 'var_name'));
  ok(has(errs(good(steps({ var: 'a', expr: 'a + 1' }, { code: 'A', name: 'a', kind: 'info', amount: 'a' }))), 'var_order'));
  ok(has(errs(good(steps({ var: 'a', expr: 'b + 1' }, { var: 'b', expr: 'a' }, { code: 'A', name: 'a', kind: 'info', amount: 'a' }))), 'var_order'));
  ok(has(errs(good(steps({ var: '9lives', expr: '1' }, { code: 'A', name: 'a', kind: 'info', amount: '1' }))), 'var_name'));
});
test('lines: codes, kinds, stages, duplicates, line() order and across required packs', () => {
  ok(has(errs(good(steps({ code: 'us_fit', name: 'a', kind: 'info', amount: '1' }))), 'line_code'));
  ok(has(errs(good(steps({ code: 'A', name: 'a', kind: 'tax', amount: '1' }))), 'line_kind'));
  ok(has(errs(good(steps({ code: 'A', name: 'a', kind: 'deduction', amount: '1' }))), 'line_stage'));
  ok(has(errs(good(steps({ code: 'A', name: '', kind: 'info', amount: '1' }))), 'line_name'));
  ok(has(errs(good(steps({ code: 'A', name: 'a', kind: 'info', amount: '1' }, { code: 'A', name: 'a', kind: 'info', amount: '2' }))), 'code_duplicate'));
  ok(has(errs(good(steps({ code: 'A', name: 'a', kind: 'info', amount: 'line("B")' }, { code: 'B', name: 'b', kind: 'info', amount: '2' }))), 'line_order'));
  ok(has(errs(good(steps({ code: 'A', name: 'a', kind: 'info', amount: 'line("NOPE")' }))), 'line_unknown'));
  ok(has(errs(good(steps({ code: 'A', name: 'a', kind: 'info', amount: '1', round: { mode: 'nearest', step: 1 } }))), 'round'));
  ok(has(errs(good(steps({ code: 'A', name: 'a', kind: 'info', amount: '1', round: { mode: 'half_up', step: 0 } }))), 'round'));
  ok(has(warns(good(steps({ code: 'A', name: 'a', kind: 'info', amount: '1', round: { mode: 'half_up', step: 0.001 } }))), 'round_fine'));
  ok(has(errs(good(steps({ code: 'A', name: 'a', kind: 'info', amount: 'total("gross_pay")' }))), 'total_group'));
  ok(has(errs(good(steps({ code: 'A', amount: '1', var: 'x', name: 'a', kind: 'info' }))), 'step_kind'));
  // across packs: base pack emits FED; the state pack requires it and reads it
  const fed = good({ code: 'zz-fed', order: 10, steps: [{ code: 'FED', name: 'f', kind: 'info', amount: '1', tags: ['fed_wages'] }] });
  const st = good({ code: 'zz-st', order: 20, requires: ['zz-fed'], profile_fields: [], steps: [{ code: 'ST', name: 's', kind: 'info', amount: 'line("FED") + sum("fed_wages")' }], vectors: [{ name: 'v', source: 'official', reference: 'r', expect: { ST: 2 } }] });
  eq(errs(st, [fed, st]), []);
  eq(warns(st, [fed, st]).filter((w) => w.code === 'tag_unknown'), []);
  ok(has(warns(st), 'line_other'), 'without the others it is a warning');
  ok(has(errs(st, [st]), 'requires_missing'));
  ok(has(errs(good({ code: 'zz-st2', order: 5, requires: ['zz-fed'] }), [fed]), 'requires_order'));
  ok(has(errs(good({ code: 'zz-fed', order: 10, steps: [{ code: 'FED', name: 'x', kind: 'info', amount: '1' }], requires: ['zz-fed'] })), 'requires_self'));
  eq(PC.runVectors(st, [fed, st]).passed, 1);
  // a code that the required pack also emits
  const dup = good({ code: 'zz-dup', order: 20, requires: ['zz-fed'], steps: [{ code: 'FED', name: 'f', kind: 'info', amount: '1' }] });
  ok(has(errs(dup, [fed]), 'code_duplicate'));
});
test('checks: severity, issue code, message', () => {
  ok(has(errs(good(steps({ check: 'true', severity: 'error', issue: 'x', message: 'm' }, { code: 'A', name: 'a', kind: 'info', amount: '1' }))), 'check_severity'));
  ok(has(errs(good(steps({ check: 'true', severity: 'warning', issue: 'Bad Code', message: 'm' }, { code: 'A', name: 'a', kind: 'info', amount: '1' }))), 'check_issue'));
  ok(has(errs(good(steps({ check: 'true', severity: 'warning', issue: 'x' }, { code: 'A', name: 'a', kind: 'info', amount: '1' }))), 'check_message'));
});
test('fields: keys, types, options, defaults, scope', () => {
  ok(has(errs(good({ profile_fields: [{ key: 'Bad', label: 'x', type: 'number' }] })), 'field_key'));
  ok(has(errs(good({ profile_fields: [{ key: 'a', label: 'x', type: 'integer' }] })), 'field_type'));
  ok(has(errs(good({ profile_fields: [{ key: 'a', label: 'x', type: 'enum', options: [] }] })), 'field_options'));
  ok(has(errs(good({ profile_fields: [{ key: 'a', label: 'x', type: 'enum', options: [{ value: 'p', label: 'P' }], default: 'q' }] })), 'field_default'));
  ok(has(errs(good({ profile_fields: [{ key: 'a', label: 'x', type: 'number', default: '1' }] })), 'field_default'));
  ok(has(errs(good({ profile_fields: [{ key: 'a', label: 'x', type: 'number', scope: 'company' }] })), 'field_scope'));
  ok(has(errs(good({ profile_fields: [{ key: 'a', label: 'x', type: 'number' }, { key: 'a', label: 'y', type: 'number' }] })), 'field_duplicate'));
  ok(has(errs(good({ profile_fields: [{ key: 'a', label: '', type: 'number' }] })), 'field_label'));
});
test('vectors: required for active packs, names, sources, expectations', () => {
  ok(has(errs(good({ vectors: [] })), 'vectors_none'));
  ok(!has(errs(good({ vectors: [], ship: 'draft' })), 'vectors_none'));
  ok(has(errs(good({ vectors: [{ name: 'a', source: 'guess', reference: 'r', expect: { TAX: 1 } }] })), 'vector_source'));
  ok(has(errs(good({ vectors: [{ name: 'a', source: 'official', reference: '', expect: { TAX: 1 } }] })), 'vector_reference'));
  ok(has(errs(good({ vectors: [{ name: 'a', source: 'official', reference: 'r' }] })), 'vector_expect'));
  ok(has(errs(good({ vectors: [{ name: 'a', source: 'official', reference: 'r', expect: { TAX: '1' } }] })), 'vector_expect'));
  ok(has(errs(good({ vectors: [{ name: 'a', source: 'official', reference: 'r', expect: { TAX: 1 } }, { name: 'a', source: 'official', reference: 'r', expect: { TAX: 1 } }] })), 'vector_name'));
  ok(has(warns(good({ vectors: [{ name: 'a', source: 'derived', reference: 'r', expect: { TAX: 1 } }] })), 'vectors_official'));
  ok(has(warns(good({ vectors: [{ name: 'a', source: 'official', reference: 'r', expect: { NOPE: 1 } }] })), 'vector_code'));
});
test('runVectors reports line, var and total differences, unexpected blockers, missing issues', () => {
  const p = good({
    vectors: [
      { name: 'wrong line', source: 'official', reference: 'r', input: { lines: [{ code: 'BASIC', kind: 'earning', amount: 1000, tags: ['taxable'] }] }, expect: { TAX: 99 } },
      { name: 'wrong var', source: 'official', reference: 'r', input: { lines: [{ code: 'BASIC', kind: 'earning', amount: 1000, tags: ['taxable'] }] }, expect_vars: { base: 1 } },
      { name: 'wrong total', source: 'official', reference: 'r', input: { lines: [{ code: 'BASIC', kind: 'earning', amount: 1000, tags: ['taxable'] }] }, expect_totals: { net: 1 } },
      { name: 'unexpected blocker', source: 'official', reference: 'r', input: { profile: { status: 'widowed' } }, expect: { TAX: 0 } },
      { name: 'missing issue', source: 'official', reference: 'r', input: { lines: [{ code: 'BASIC', kind: 'earning', amount: 1000, tags: ['taxable'] }] }, expect_issues: ['negative_net'] },
      { name: 'right', source: 'official', reference: 'r', input: { lines: [{ code: 'BASIC', kind: 'earning', amount: 1000, tags: ['taxable'] }], profile: { status: 'married' } }, expect: { TAX: 50 }, expect_vars: { base: 1000 }, expect_totals: { net: 950, employer: 10 } }
    ]
  });
  const r = PC.runVectors(p);
  eq([r.passed, r.total], [1, 6]);
  const by = {};
  for (const f of r.failures) by[f.name] = f.problems[0];
  eq(by['wrong line'], { what: 'line', code: 'TAX', expected: 99, actual: 100 });
  eq(by['wrong var'], { what: 'var', code: 'base', expected: 1, actual: 1000 });
  eq(by['wrong total'].what, 'total');
  eq(by['unexpected blocker'].code, 'profile_invalid');
  eq(by['missing issue'].what, 'issue');
});
test('checkSet: duplicate versions, overlapping versions, missing requires', () => {
  const a = good({ version: '2026.1', effective_from: '2026-01-01', effective_to: '2026-12-31' });
  const b = good({ version: '2027.1', effective_from: '2027-01-01', effective_to: '' });
  eq(PC.checkSet([a, b]), []);
  ok(has(PC.checkSet([a, good({ version: '2026.1' })]), 'version_duplicate'));
  ok(has(PC.checkSet([a, good({ version: '2026.2', effective_from: '2026-07-01', effective_to: '' })]), 'version_overlap'));
  ok(has(PC.checkSet([good({ effective_to: '' }), b]), 'version_overlap'));
  ok(has(PC.checkSet([good({ requires: ['zz-none'] })]), 'requires_missing'));
});
test('the shipped generic pack validates clean and passes its vectors', () => {
  eq(errs(generic), []);
  const r = PC.runVectors(generic);
  eq(r.failures, []);
  ok(r.total >= 8, 'has vectors');
});
