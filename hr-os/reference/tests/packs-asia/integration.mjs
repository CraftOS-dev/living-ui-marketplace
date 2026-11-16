// Cross-pack checks: the country packs run together as an entity enables them.
// node tests/integration.mjs  (exits 1 on a failure)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
// Works from the packs-asia scratch folder (tests/ next to pb_hooks/) and from APP/reference/tests/packs-asia/.
const HOOKS = [path.join(here, '..', 'pb_hooks'), path.join(here, '..', '..', '..', 'pb', 'pb_hooks')].find((d) => fs.existsSync(path.join(d, 'packs', 'jp.js')));
const ENGINE = [path.join(HOOKS, 'lib_engine.js'), path.join(here, '..', '..', 'engine', 'pb_hooks', 'lib_engine.js')].find((f) => fs.existsSync(f));
const eng = require(ENGINE);
const P = (f) => require(path.join(HOOKS, 'packs', f));
let fails = 0;
function run(name, packs, partial, expect, opts = {}) {
  const input = eng.completeInput(partial, packs[0]);
  const out = opts.yearEnd ? eng.yearEnd(input, packs) : eng.calculate(input, packs);
  const got = {};
  for (const l of out.lines) got[l.code] = (got[l.code] || 0) + l.amount;
  const bad = [];
  for (const [k, v] of Object.entries(expect)) if (Math.abs((got[k] || 0) - v) > 1e-9) bad.push(k + ' got ' + (got[k] || 0) + ' want ' + v);
  const blockers = out.issues.filter((i) => i.severity === 'blocker');
  if (blockers.length) bad.push('blockers ' + blockers.map((i) => i.code + ': ' + i.message).join(' | '));
  if (bad.length) { fails++; console.log('FAIL', name, '\n  ' + bad.join('\n  ')); }
  else console.log('ok  ', name, JSON.stringify(Object.fromEntries(out.lines.filter((l) => l.source === 'pack').map((l) => [l.code, l.amount]))), 'net', out.totals.net);
  return out;
}

// Malaysia: EPF pack feeds PCB (LHDN January example: wages 5,500 give EPF 605 and PCB 110.00)
run('MY: my-epf + my-socso + my-hrdf + my (PCB reads the EPF line)', [P('my.js'), P('my-epf.js'), P('my-socso.js'), P('my-hrdf.js')], {
  run: { period_start: '2026-01-01', period_end: '2026-01-31', pay_date: '2026-01-31' },
  employee: { birth_date: '1990-03-01' },
  profile: { my_pcb_category: '3', my_children: 3, my_epf_category: 'citizen' },
  entity: { my_hrdf_rate: '1' },
  lines: [{ code: 'MY_BASIC', kind: 'earning', amount: 5500, tags: ['my_pcb_normal', 'my_epf_wages', 'my_socso_wages', 'my_hrdf_wages'] }]
}, { MY_EPF_EE: 605, MY_PCB: 110, MY_HRDF_ER: 55 });

// Malaysia bonus month: the EPF pack emits MY_EPF_EE_NORMAL so PCB splits K1 and Kt
run('MY: bonus month splits EPF for PCB', [P('my.js'), P('my-epf.js')], {
  run: { period_start: '2026-04-01', period_end: '2026-04-30', pay_date: '2026-04-30' },
  employee: { birth_date: '1990-03-01' },
  profile: { my_pcb_category: '3', my_children: 3, my_epf_category: 'citizen' },
  lines: [{ code: 'MY_BASIC', kind: 'earning', amount: 5500, tags: ['my_pcb_normal', 'my_epf_wages'] }, { code: 'MY_BONUS', kind: 'earning', amount: 8300, tags: ['my_pcb_additional', 'my_epf_wages', 'my_epf_wages_add'] }],
  history: [{ pay_date: '2026-03-31', period_end: '2026-03-31', kind: 'regular', by_tag: { my_pcb_normal: 16500, my_epf_employee: 1815 }, by_code: { MY_PCB: 330 } }]
}, { MY_EPF_EE_NORMAL: 605 });

// India: PF and PT lines feed old-regime TDS
run('IN: in-epf + in-esi + in-pt-mh + in (old regime reads PF and PT)', [P('in.js'), P('in-epf.js'), P('in-esi.js'), P('in-pt-mh.js')], {
  run: { period_start: '2026-10-01', period_end: '2026-10-31', pay_date: '2026-10-31' },
  employee: { birth_date: '1990-01-01', gender: 'male' },
  profile: { in_regime: 'old', in_80c_annual: 50000 },
  lines: [
    { code: 'IN_BASIC', kind: 'earning', amount: 40000, tags: ['in_salary', 'in_salary_recurring', 'in_basic_da', 'in_remuneration', 'in_pt_wages'] },
    { code: 'IN_HRA', kind: 'earning', amount: 20000, tags: ['in_salary', 'in_salary_recurring', 'in_hra', 'in_remuneration', 'in_code_excluded', 'in_pt_wages'] }
  ]
}, { IN_PF_EE: 3000, IN_PT: 200 });

// Japan: December pay with the year-end adjustment pack (year_end run)
run('JP: jp + jp-yea in a December year-end run', [P('jp.js'), P('jp-yea.js')], {
  run: { period_start: '2026-12-01', period_end: '2026-12-31', pay_date: '2026-12-25', year_end: true },
  employee: { birth_date: '1990-04-15' },
  profile: { jp_column: 'ko', jp_prefecture: '13', jp_smr: 300000 },
  entity: { jp_insurer: 'kyokai' },
  lines: [{ code: 'JP_BASE', kind: 'earning', amount: 300000, tags: ['jp_taxable', 'jp_ei_wages'] }],
  history: [{ pay_date: '2026-11-25', period_end: '2026-11-30', kind: 'regular', by_tag: { jp_taxable: 3300000, jp_si_employee: 484000 }, by_code: { JP_WHT: 80000 } }]
}, {});

// Singapore and Japan packs side by side never collide on fields (different countries, separate runs)
run('SG: citizen with SHG', [P('sg.js')], { run: { period_start: '2026-09-01', period_end: '2026-09-30', pay_date: '2026-09-30' }, employee: { birth_date: '1985-01-01' }, profile: { sg_residency: 'sc', sg_shg: 'cdac' }, lines: [{ code: 'SG_BASIC', kind: 'earning', amount: 6000, tags: ['sg_ow'] }] }, { SG_CPF_EE: 1200, SG_CPF_ER: 1020, SG_SHG: 2, SG_SDL: 11.25 });

console.log(fails ? fails + ' failed' : 'all integration checks pass');
process.exit(fails ? 1 : 0);
