# Fix round 1: in-esi 2026.2 (maintained by hand in APP since the packs-verify
# round) becomes 2026.3: coverage and contributions on the wage period's total
# across payslips (a bonus payslip alone no longer looks like a low wage).
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

rep('// India rule pack: ESI under the Code on Social Security 2020, version 2026.2.',
    '// India rule pack: ESI under the Code on Social Security 2020, version 2026.3.\n// Fix round 1 (packs-asia): coverage and contributions over the whole wage period across payslips.')
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
      explain: "ESI is due on the wages of the wage period (the month), across every payslip of the period."
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
    },
    {
      var: "ee_before",
      expr: "%s",
      explain: "ESI already deducted by earlier payslips of this wage period."
    },''' % (M('in_remuneration'), M('in_code_excluded'), MC('IN_ESI_EE')))
rep('''      expr: "profile.in_esi_status == \\"covered\\" || (profile.in_esi_status == \\"auto\\" && wages > 0 && wages <= 21000)",
      explain: "Covered when wages are within 21,000, or when set as covered for the contribution period."''',
    '''      expr: "profile.in_esi_status == \\"covered\\" || (profile.in_esi_status == \\"auto\\" && wages > 0 && (wages <= 21000 || ee_before > 0))",
      explain: "Covered when the wage period's wages are within 21,000 (or an earlier payslip of the period already paid ESI), or when set as covered for the contribution period."''')
rep('      amount: "0.0075 * wages",', '      amount: "round_up(0.0075 * wages, 1) - ee_before",')
rep('      amount: "0.0325 * wages",', '      amount: "round_up(0.0325 * wages, 1) - %s",' % MC('IN_ESI_ER'))
vec = '''    {
      name: "Bonus payslip for an employee above the limit: no ESI",
      source: "derived",
      reference: "Regular pay 30,000 in November 2026 (above 21,000, no ESI). A 5,000 bonus (excluded under section 2(88)) in the same period: the period's wages are 30,000, so no ESI on the bonus payslip.",
      input: {
        run: { kind: "bonus", period_start: "2026-11-01", period_end: "2026-11-30", pay_date: "2026-11-30" },
        lines: [{ code: "IN_BONUS", kind: "earning", amount: 5000, tags: ["in_remuneration", "in_code_excluded"] }],
        history: [{ pay_date: "2026-11-30", period_end: "2026-11-30", kind: "regular", by_tag: { in_remuneration: 30000 }, by_code: {} }]
      },
      expect: { IN_ESI_EE: 0, IN_ESI_ER: 0 }
    },
    {
      name: "Second payslip of a covered period: only the difference",
      source: "derived",
      reference: "Regular pay 18,000 in November 2026 paid ESI 135 and 585. Arrears 2,000 in the same period: wages 20,000; employee 0.75% = 150, less 135 = 15; employer 3.25% = 650, less 585 = 65.",
      input: {
        run: { kind: "off_cycle", period_start: "2026-11-01", period_end: "2026-11-30", pay_date: "2026-11-30" },
        lines: [{ code: "IN_ARREARS", kind: "earning", amount: 2000, tags: ["in_remuneration"] }],
        history: [{ pay_date: "2026-11-30", period_end: "2026-11-30", kind: "regular", by_tag: { in_remuneration: 18000 }, by_code: { IN_ESI_EE: 135, IN_ESI_ER: 585 } }]
      },
      expect: { IN_ESI_EE: 15, IN_ESI_ER: 65 }
    },
    {
      name: "A period ending before 8 May 2026 is blocked",'''
rep('''    {
      name: "A period ending before 8 May 2026 is blocked",''', vec)
open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('patched', p)
