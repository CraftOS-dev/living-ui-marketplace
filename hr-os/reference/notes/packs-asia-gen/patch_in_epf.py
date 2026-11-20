# Fix round 1 (QA B-9): in-epf 2026.2 (maintained by hand in APP since the
# packs-verify round) becomes 2026.3: PF, EPS and EDLI over the whole wage
# period across payslips. Text edits on the APP file keep its formatting.
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()

def rep(old, new, count=1):
    global s
    if s.count(old) != count:
        raise SystemExit('expected %d of %r, found %d' % (count, old[:80], s.count(old)))
    s = s.replace(old, new)

M = lambda t: '(ytd_since(\\"%s\\", wage_month) - ytd_since(\\"%s\\", next_month))' % (t, t)
MC = lambda c: '(ytd_code_since(\\"%s\\", wage_month) - ytd_code_since(\\"%s\\", next_month))' % (c, c)

rep('// India rule pack: EPF, EPS, EDLI under the Code on Social Security 2020, version 2026.2.',
    '// India rule pack: EPF, EPS, EDLI under the Code on Social Security 2020, version 2026.3.\n// Fix round 1 (packs-asia): contributions over the whole wage period across payslips.')
rep('  version: "2026.2",', '  version: "2026.3",')
rep('''    {
      var: "rem",
      expr: "sum(\\"in_remuneration\\")",
      explain: "All remuneration in the period (Code on Social Security 2020, section 2(88))."
    },
    {
      var: "excl",
      expr: "sum(\\"in_code_excluded\\")",
      explain: "Components the Code excludes from wages (items (a) to (i) of section 2(88))."
    },''', '''    {
      var: "wage_month",
      expr: "month_start(run.period_end)",
      explain: "Contributions are due on the wages of the wage period (the month), across every payslip of the period."
    },
    { var: "next_month", expr: "add_months(wage_month, 1)" },
    {
      var: "rem",
      expr: "sum(\\"in_remuneration\\") + %s",
      explain: "All remuneration in the wage period, earlier payslips of the period included (Code on Social Security 2020, section 2(88))."
    },
    {
      var: "excl",
      expr: "sum(\\"in_code_excluded\\") + %s",
      explain: "Components the Code excludes from wages (items (a) to (i) of section 2(88)), earlier payslips of the period included."
    },''' % (M('in_remuneration'), M('in_code_excluded')))
rep('      amount: "rate * pf_base",', '      amount: "round(rate * pf_base, 0) - %s",' % MC('IN_PF_EE'))
rep('      amount: "profile.in_vpf_rate * pf_base",', '      amount: "round(profile.in_vpf_rate * pf_base, 0) - %s",' % MC('IN_VPF'))
rep('      amount: "0.0833 * min(eps_wages, ceiling)",', '      amount: "round(0.0833 * min(eps_wages, ceiling), 0) - %s",' % MC('IN_EPS_ER'))
rep('      amount: "round(rate * pf_base, 0) - line(\\"IN_EPS_ER\\")",', '      amount: "round(rate * pf_base, 0) - (eps_on ? round(0.0833 * min(eps_wages, ceiling), 0) : 0) - %s",' % MC('IN_EPF_ER'))
rep('      amount: "0.005 * min(wages, ceiling)",', '      amount: "round(0.005 * min(wages, ceiling), 0) - %s",' % MC('IN_EDLI_ER'))
rep('      amount: "entity.in_pf_admin_rate * pf_base",', '      amount: "entity.in_pf_admin_rate * pf_base - %s",' % MC('IN_PF_ADMIN_ER'))
rep('Not covered: higher pension at 9.49 percent', 'The wage period is computed as one: wages, the ceiling and the 50 percent rule apply to the period\'s total across payslips (regular, bonus, final and off-cycle), and each payslip carries the period\'s contribution less what earlier payslips of the period paid, so a bonus run never charges the ceiling twice. Not covered: higher pension at 9.49 percent')
vec = '''    {
      name: "QA B-9: bonus run after the regular run of the same period",
      source: "derived",
      reference: "Regular pay 3,00,000 in November 2026 paid PF 3,000, EPS 2,083, employer PF 917 and EDLI 125 on the 25,000 ceiling. A 50,000 bonus (excluded under section 2(88)) in the same wage period: the period's wages stay 3,00,000 - 50,000 + 0 over the ceiling, so the period's contributions are unchanged and the bonus payslip carries 0 for each.",
      input: {
        run: { kind: "bonus", period_start: "2026-11-01", period_end: "2026-11-30", pay_date: "2026-11-30" },
        employee: { birth_date: "1990-01-01" },
        entity: { in_pf_admin_rate: 0.005 },
        lines: [{ code: "IN_BONUS", kind: "earning", amount: 50000, tags: ["in_remuneration", "in_code_excluded"] }],
        history: [{ pay_date: "2026-11-30", period_end: "2026-11-30", kind: "regular", by_tag: { in_remuneration: 300000, in_pf_employee: 3000 }, by_code: { IN_PF_EE: 3000, IN_EPS_ER: 2083, IN_EPF_ER: 917, IN_EDLI_ER: 125, IN_PF_ADMIN_ER: 125 } }]
      },
      expect: { IN_PF_EE: 0, IN_EPS_ER: 0, IN_EPF_ER: 0, IN_EDLI_ER: 0, IN_PF_ADMIN_ER: 0 }
    },
    {
      name: "Second payslip of a period below the ceiling: only the difference",
      source: "derived",
      reference: "Regular pay 20,000 in November 2026 paid PF 2,400, EPS 1,666, employer PF 734, EDLI 100. Arrears of basic 10,000 in the same period: wages 30,000, PF base 25,000: PF 3,000 - 2,400 = 600; EPS 2,083 - 1,666 = 417; employer PF (3,000 - 2,083) - 734 = 183; EDLI 125 - 100 = 25.",
      input: {
        run: { kind: "off_cycle", period_start: "2026-11-01", period_end: "2026-11-30", pay_date: "2026-11-30" },
        employee: { birth_date: "1990-01-01" },
        entity: { in_pf_admin_rate: 0.005 },
        lines: [{ code: "IN_ARREARS", kind: "earning", amount: 10000, tags: ["in_remuneration"] }],
        history: [{ pay_date: "2026-11-30", period_end: "2026-11-30", kind: "regular", by_tag: { in_remuneration: 20000, in_pf_employee: 2400 }, by_code: { IN_PF_EE: 2400, IN_EPS_ER: 1666, IN_EPF_ER: 734, IN_EDLI_ER: 100, IN_PF_ADMIN_ER: 100 } }]
      },
      expect: { IN_PF_EE: 600, IN_EPS_ER: 417, IN_EPF_ER: 183, IN_EDLI_ER: 25, IN_PF_ADMIN_ER: 25 }
    },
    {
      name: "A period spanning 17 September 2026 is blocked",'''
rep('''    {
      name: "A period spanning 17 September 2026 is blocked",''', vec)
open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('patched', p)
