# Extract the NTA withholding tables (月額表, 賞与算出率表) and the 協会けんぽ
# grade table into JSON for the jp pack generator. Sources are the official
# Excel files downloaded into ../src.
import json, re, sys, unicodedata
import xlrd, openpyxl

SRC = '../src/'

def rows_xls(path, sheet=0):
    b = xlrd.open_workbook(path)
    s = b.sheet_by_index(sheet)
    return [[s.cell_value(r, c) for c in range(s.ncols)] for r in range(s.nrows)]

def rows_xlsx(path):
    ws = openpyxl.load_workbook(path, data_only=True).active
    return [[('' if v is None else v) for v in r] for r in ws.iter_rows(values_only=True)]

def isnum(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)

def yen(s):
    s = unicodedata.normalize('NFKC', str(s))
    m = re.search(r'([\d,]+)\s*円', s)
    return int(m.group(1).replace(',', '')) if m else None

def monthly(rows):
    """Return {first_from, body: [...], ko_top: [...], otsu_top: [...]}."""
    body = []
    first_from = None
    anchors = []      # (amount, [k0..k7], otsu or None)
    rate_texts = []   # rates for ko regions in order
    otsu_rules = []   # (base, over, rate)
    for r in rows:
        c1, c2 = r[1], r[2]
        if isnum(c1) and c2 == '円未満':
            first_from = int(c1)
            continue
        if isnum(c1) and isnum(c2) and all(isnum(x) for x in r[3:12]):
            body.append({'from': int(c1), 'under': int(c2), 'k': [int(x) for x in r[3:11]], 'otsu': int(r[11])})
            continue
        if isinstance(c1, str) and re.fullmatch(r'\s*[\d,]+円\s*', unicodedata.normalize('NFKC', c1)) and all(isnum(x) for x in r[3:11]):
            amt = yen(c1)
            otsu = int(r[11]) if isnum(r[11]) else None
            anchors.append((amt, [int(x) for x in r[3:11]], otsu))
            continue
        t3 = unicodedata.normalize('NFKC', str(r[3]))
        m = re.search(r'([\d,]+)円を超える金額の([\d.]+)%', t3)
        if m:
            rate_texts.append((int(m.group(1).replace(',', '')), float(m.group(2))))
        t11 = unicodedata.normalize('NFKC', str(r[11]))
        m = re.search(r'([\d,]+)円に、.*?うち([\d,]+)円を超える金額の([\d.]+)%', t11)
        if m:
            otsu_rules.append((int(m.group(1).replace(',', '')), int(m.group(2).replace(',', '')), float(m.group(3))))
    # ko regions: anchor i applies from anchor[i] to anchor[i+1] with the rate whose 'over' == anchor[i]
    rates = {}
    for over, pct in rate_texts:
        rates.setdefault(over, pct)
    ko_top = []
    for i, (amt, ks, otsu) in enumerate(anchors):
        nxt = anchors[i + 1][0] if i + 1 < len(anchors) else None
        if amt not in rates:
            raise SystemExit('no rate for anchor %d' % amt)
        row = {'from': amt, 'rate_pct': rates[amt], 'k': ks}
        if nxt is not None:
            row['under'] = nxt
        ko_top.append(row)
    seen = []
    for o in otsu_rules:
        if o not in seen:
            seen.append(o)
    otsu_top = []
    seen.sort(key=lambda o: o[1])
    for i, (base, over, pct) in enumerate(seen):
        row = {'from': over, 'base': base, 'rate_pct': pct}
        if i + 1 < len(seen):
            row['under'] = seen[i + 1][1]
        otsu_top.append(row)
    return {'first_from': first_from, 'body': body, 'ko_top': ko_top, 'otsu_top': otsu_top}

def bonus(rows):
    cols = {('k%d' % n): [] for n in range(8)}
    cols['otsu'] = []
    for r in rows:
        if not isnum(r[1]):
            continue
        pct = float(r[1])
        for n in range(8):
            a, b = r[3 + 2 * n], r[4 + 2 * n]
            if a == '' and b == '':
                continue
            if isnum(a) and b == '千円未満':
                cols['k%d' % n].append({'under': int(a) * 1000, 'pct': pct})
            elif isnum(a) and b == '千円以上':
                cols['k%d' % n].append({'from': int(a) * 1000, 'pct': pct})
            elif isnum(a) and isnum(b):
                cols['k%d' % n].append({'from': int(a) * 1000, 'under': int(b) * 1000, 'pct': pct})
            else:
                raise SystemExit('bonus cell %r %r' % (a, b))
        a, b = r[19], r[20]
        if a != '' or b != '':
            if isnum(a) and b == '千円未満':
                cols['otsu'].append({'under': int(a) * 1000, 'pct': pct})
            elif isnum(a) and b == '千円以上':
                cols['otsu'].append({'from': int(a) * 1000, 'pct': pct})
            elif isnum(a) and isnum(b):
                cols['otsu'].append({'from': int(a) * 1000, 'under': int(b) * 1000, 'pct': pct})
    return cols

def grades():
    ws = openpyxl.load_workbook(SRC + 'kk_r8ippan3.xlsx', data_only=True)['東京']
    out = []
    for r in ws.iter_rows(values_only=True):
        g = r[0]
        if g is None or not isinstance(r[1], (int, float)):
            continue
        gs = str(g)
        m = re.fullmatch(r'(\d+)(?:\((\d+)\))?', gs)
        if not m:
            continue
        out.append({'grade': int(m.group(1)), 'pension_grade': int(m.group(2)) if m.group(2) else None,
                    'smr': int(r[1]), 'from': int(r[2]) if isinstance(r[2], (int, float)) else None,
                    'under': int(r[4]) if isinstance(r[4], (int, float)) else None})
    return out

if __name__ == '__main__':
    data = {}
    m26 = monthly(rows_xls(SRC + 'nta2026_01-07.xls'))
    m27 = monthly(rows_xlsx(SRC + 'nta2027_01-07.xlsx'))
    b26 = bonus(rows_xls(SRC + 'nta2026_15-16.xls'))
    b27 = bonus(rows_xls(SRC + 'nta2027_15-16.xls'))
    data = {'2026': {'monthly': m26, 'bonus': b26}, '2027': {'monthly': m27, 'bonus': b27}, 'grades': grades()}
    json.dump(data, open('jp_data.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    for y in ('2026', '2027'):
        m = data[y]['monthly']
        print(y, 'first_from', m['first_from'], 'body', len(m['body']), m['body'][0]['from'], m['body'][-1]['under'])
        print('  ko_top', [(r['from'], r.get('under'), r['rate_pct']) for r in m['ko_top']])
        print('  otsu_top', m['otsu_top'])
        print('  bonus', {k: len(v) for k, v in data[y]['bonus'].items()})
        # continuity check of body
        for i in range(1, len(m['body'])):
            if m['body'][i]['from'] != m['body'][i - 1]['under']:
                print('  GAP', m['body'][i - 1], m['body'][i])
    print('grades', len(data['grades']), data['grades'][0], data['grades'][-1])
