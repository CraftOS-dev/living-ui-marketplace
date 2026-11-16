# Check the my-epf band construction against the official KWSP Third Schedule
# (EPF Act 1991 Third Schedule, June 2022 edition; copy of the kwsp.gov.my PDF
# archived by web.archive.org on 2024-07-28). Every row is compared with:
# contribution on the band's upper limit, each share rounded up to the ringgit
# (RM20 bands to 5,000, RM100 bands to 20,000); Parts B and D: employer RM5.
# Input: ../src/kwsp_raw.txt from `pdftotext -raw`.
import math, re, json
t = chr(10) + open('../src/kwsp_raw.txt', encoding='utf-8').read()
parts = re.split(r'\n\s*PART ([A-E])\n', t)
row = re.compile(r'^\s*(?:From)?\s+([\d,]+\.\d\d)\s+to\s+([\d,]+\.\d\d)\s+([\d,]+\.\d\d|NIL)\s+([\d,]+\.\d\d|NIL)\s+([\d,]+\.\d\d|NIL)\s*$')
num = lambda s: 0.0 if s == 'NIL' else float(s.replace(',', ''))
RATES = {'A': (0.13, 0.12, 0.11), 'B': ('rm5', 'rm5', 0.11), 'C': (0.065, 0.06, 0.055), 'D': ('rm5', 'rm5', 0.055), 'E': (0.04, 0.04, 0.0)}
def ceil_r(x):
    return math.ceil(round(x, 6))
def band_hi(w):
    return math.ceil(round(w / 20, 9)) * 20 if w <= 5000 else math.ceil(round(w / 100, 9)) * 100
report = {}
for i in range(1, len(parts), 2):
    p = parts[i]; body = parts[i + 1]
    ok = bad = 0; samples = []; his = []
    for line in body.split('\n'):
        m = row.match(line)
        if not m: continue
        lo, hi, er, ee, tot = [num(x) for x in m.groups()]
        if hi <= 10: continue
        his.append((lo, hi))
        r_er_lo, r_er_hi, r_ee = RATES[p]
        want_er = 5.0 if r_er_lo == 'rm5' else ceil_r((r_er_lo if hi <= 5000 else r_er_hi) * hi)
        want_ee = ceil_r(r_ee * hi)
        good = abs(want_er - er) < 1e-9 and abs(want_ee - ee) < 1e-9 and abs(er + ee - tot) < 1e-9 and band_hi(lo + 0.005) == hi
        if good: ok += 1
        else:
            bad += 1
            if len(samples) < 5: samples.append(line.strip())
    contiguous = all(abs(his[k][0] - his[k - 1][1] - 0.01) < 1e-6 for k in range(1, len(his)))
    report[p] = {'rows': ok + bad, 'match': ok, 'mismatch': bad, 'first': his[0] if his else None, 'last': his[-1] if his else None, 'contiguous': contiguous, 'samples': samples}
print(json.dumps(report, indent=1))
