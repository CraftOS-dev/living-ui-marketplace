"""Independent expected values for the Venture OS engine golden vectors.

Written separately from the JavaScript engines: exact fractions (Fraction),
scipy's brentq for XIRR, numpy's business-day functions and the IANA zone
database (zoneinfo). Run:  python expected.py  -> expected.json next to it.
The tests read expected.json; reference/ENGINES.md records the values.
"""

import json
import math
import os
import re
from datetime import date, datetime, timedelta, timezone
from fractions import Fraction as F
from zoneinfo import ZoneInfo

import numpy as np
from scipy.optimize import brentq

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = {}


def rnd(x):
    """Round half away from zero to an int."""
    x = F(x)
    s = -1 if x < 0 else 1
    a = abs(x)
    q = a.numerator // a.denominator
    if (a - q) * 2 >= 1:
        q += 1
    return s * q


def d(s):
    return date.fromisoformat(s)


# ------------------------------------------------------------------ SAFE
OUT["safe"] = {
    "own_500k_6_7m_ppm": rnd(F(500_000, 6_700_000) * 10**6),
    "own_1m_6_7m_ppm": rnd(F(1_000_000, 6_700_000) * 10**6),
}

# Single capped SAFE: C = S0 / (1 - a/cap).
S0 = 9_000_000
P = F(2)
C = F(S0) / (1 - F(1_000_000, 10_000_000))
safe_a = math.floor(F(1_000_000) * C / 10_000_000)
new = math.floor(F(5_000_000) / P)
OUT["safe"]["single"] = {"cap_shares": int(C), "safe_shares": safe_a, "new_shares": new, "post": S0 + safe_a + new, "own_ppm": rnd(F(safe_a, S0 + safe_a + new) * 10**6)}

# Capped SAFE plus a discount-only SAFE (20%).
disc_price = P * F(8, 10)
b_shares = math.floor(F(500_000) / disc_price)
C2 = (S0 + b_shares) / (1 - F(1, 10))
a_shares = math.floor(F(1_000_000) * C2 / 10_000_000)
cap_price = F(10_000_000) / C2
OUT["safe"]["two"] = {"a_shares": a_shares, "b_shares": b_shares, "cap_price_e8": rnd(cap_price * 10**8), "capitalization": S0 + a_shares + b_shares, "post": S0 + a_shares + b_shares + new}

# Cap above the round: converts at P.
OUT["safe"]["cap_above_round"] = {"shares": math.floor(F(1_000_000) / P)}

# Note: 100,000 at 8% for 365 days, pre-money cap 8M on S0, then a capped SAFE.
note_interest = rnd(F(10_000_000) * F(80_000, 10**6) * 365 / 365)  # minor units
note_amount = 10_000_000 + note_interest
note_shares = math.floor(F(note_amount) * S0 / 800_000_000)
C3 = (S0 + note_shares) / (1 - F(1, 10))
s_shares = math.floor(F(1_000_000) * C3 / 10_000_000)
OUT["safe"]["note_and_safe"] = {"interest_minor": note_interest, "note_shares": note_shares, "safe_shares": s_shares, "post": S0 + note_shares + s_shares + new}
OUT["safe"]["interest_6pct_182d_minor"] = rnd(F(10_000_000) * F(60_000, 10**6) * (d("2024-07-01") - d("2024-01-01")).days / 365)

# MFN: takes s1's cap (10M) when it gives the lowest price.
s2_shares = math.floor(F(500_000) / disc_price)
own = F(1_000_000, 10_000_000) + F(250_000, 10_000_000)
C4 = (S0 + s2_shares) / (1 - own)
OUT["safe"]["mfn"] = {"mfn_shares": math.floor(F(250_000) * C4 / 10_000_000), "s1_shares": math.floor(F(1_000_000) * C4 / 10_000_000), "s2_shares": s2_shares, "cap_price_e8": rnd(F(10_000_000) / C4 * 10**8)}

# Implied price of a capped SAFE at signing: cap / (S0 / (1 - own)).
own5 = F(500_000, 6_700_000)
OUT["safe"]["implied_price_e8"] = rnd(F(6_700_000) / (F(S0) / (1 - own5)) * 10**8)

# --------------------------------------------------------------- pro rata
OUT["prorata"] = {"after_skip_ppm": rnd(F(25_000) * (1 - F(200_000, 10**6))), "keep": rnd(F(25_000) * 1_250_000 / 1_000_000)}

# ---------------------------------------------------------------- capital
commit = 50_000_000_00
contributed = 18_250_000_00 + 1_750_000_00
OUT["capital"] = {
    "ilpa": {"contributed_minor": contributed, "contributed_ppm": rnd(F(contributed, commit) * 10**6), "unfunded_minor": commit - contributed, "distributed_minor": 10_000_000_00, "recallable_minor": 5_000_000_00},
}


def fee_months(a, b):
    """Months between days a..b inclusive: whole months 1, part months days/dim."""
    total = F(0)
    cur = a
    while cur <= b:
        dim = (date(cur.year + (cur.month == 12), cur.month % 12 + 1, 1) - date(cur.year, cur.month, 1)).days
        month_end = date(cur.year, cur.month, dim)
        end = min(month_end, b)
        total += F((end - cur).days + 1, dim)
        cur = end + timedelta(days=1)
    return total


OUT["capital"]["fee_year_minor"] = rnd(F(1_000_000_000) * F(20_000, 10**6) * fee_months(d("2026-01-01"), d("2026-12-31")) / 12)
OUT["capital"]["fee_q1_minor"] = rnd(F(1_000_000_000) * F(20_000, 10**6) * fee_months(d("2026-01-01"), d("2026-03-31")) / 12)
OUT["capital"]["fee_partial_minor"] = rnd(F(1_000_000_000) * F(20_000, 10**6) * fee_months(d("2026-02-15"), d("2026-03-31")) / 12)
h1 = F(1_000_000_000) * F(20_000, 10**6) * fee_months(d("2026-01-01"), d("2026-06-30")) / 12
h2 = F(600_000_000) * F(15_000, 10**6) * fee_months(d("2026-07-01"), d("2026-12-31")) / 12
OUT["capital"]["fee_stepdown_minor"] = rnd(h1 + h2)
OUT["capital"]["fee_stepdown_waived_half_minor"] = rnd(h1 + h2) - rnd(F(rnd(h1 + h2)) / 2)
# A partial month with a step inside it: 2026-03-10..2026-04-20, 2% committed then 1% committed from 2026-04-01.
seg1 = F(1_000_000_000) * F(20_000, 10**6) * fee_months(d("2026-03-10"), d("2026-03-31")) / 12
seg2 = F(1_000_000_000) * F(10_000, 10**6) * fee_months(d("2026-04-01"), d("2026-04-20")) / 12
OUT["capital"]["fee_split_month_minor"] = rnd(seg1 + seg2)

# -------------------------------------------------------------- waterfall


def waterfall(events, carry, hurdle, catchup, compounding="compound"):
    """Tier machine (independent re-implementation). Amounts in minor units."""
    unret = 0
    pref_owed = 0
    pref_paid = 0
    cu_vol = 0
    last = None
    gp = lp = 0
    tiers = dict(roc=0, pref=0, cu_gp=0, cu_lp=0, sp_gp=0, sp_lp=0)
    for day, kind, amt in sorted(events, key=lambda e: (d(e[0]), 0 if e[1] == "c" else 1)):
        t = d(day)
        if hurdle and last is not None and t > last:
            days = (t - last).days
            if compounding == "simple":
                pref_owed += rnd(F(unret) * F(hurdle, 10**6) * days / 365)
            else:
                pref_owed += round((unret + pref_owed) * ((1 + hurdle / 1e6) ** (days / 365) - 1))
        last = t
        if kind == "c":
            unret += amt
            continue
        left = amt
        roc = min(left, unret); left -= roc; unret -= roc
        pf = min(left, pref_owed); left -= pf; pref_owed -= pf; pref_paid += pf
        cg = cl = 0
        if catchup and hurdle:
            target = rnd(F(carry * pref_paid, catchup - carry))
            room = max(0, target - cu_vol)
            t3 = min(left, room); left -= t3; cu_vol += t3
            cg = rnd(F(t3 * catchup, 10**6)); cl = t3 - cg
        sg = rnd(F(left * carry, 10**6)); sl = left - sg
        for k, v in (("roc", roc), ("pref", pf), ("cu_gp", cg), ("cu_lp", cl), ("sp_gp", sg), ("sp_lp", sl)):
            tiers[k] += v
        gp += cg + sg
        lp += roc + pf + cl + sl
    return {"gp": gp, "lp": lp, "tiers": tiers, "pref_owed": pref_owed}


W = OUT["waterfall"] = {}
W["angellist"] = waterfall([("2025-01-01", "c", 500_000), ("2026-01-01", "d", 10_000_000)], 200_000, None, None)
W["hurdle_full_catchup"] = waterfall([("2025-01-01", "c", 100_000_000), ("2026-01-01", "d", 150_000_000)], 200_000, 80_000, 1_000_000)
W["hurdle_80_catchup"] = waterfall([("2025-01-01", "c", 100_000_000), ("2026-01-01", "d", 150_000_000)], 200_000, 80_000, 800_000)
W["catchup_short"] = waterfall([("2025-01-01", "c", 100_000_000), ("2026-01-01", "d", 109_000_000)], 200_000, 80_000, 1_000_000)
W["hurdle_no_catchup"] = waterfall([("2025-01-01", "c", 100_000_000), ("2026-01-01", "d", 150_000_000)], 200_000, 80_000, None)
W["pref_compound_2y"] = waterfall([("2024-01-01", "c", 100_000_000), ("2026-01-01", "d", 100_000_000)], 200_000, 80_000, 1_000_000)
W["pref_simple_2y"] = waterfall([("2024-01-01", "c", 100_000_000), ("2026-01-01", "d", 100_000_000)], 200_000, 80_000, 1_000_000, "simple")
multi = [("2024-01-01", "c", 60_000_000), ("2024-07-01", "c", 40_000_000), ("2025-06-30", "d", 50_000_000), ("2026-06-30", "d", 120_000_000)]
W["multi"] = waterfall(multi, 200_000, 80_000, 1_000_000)
# American: deal A 100 -> 300, deal B 100 -> 0 (in major units x 100).
A = waterfall([("2024-01-01", "c", 10_000), ("2026-01-01", "d", 30_000)], 200_000, None, None)
B = waterfall([("2024-01-01", "c", 10_000)], 200_000, None, None)
FUND = waterfall([("2024-01-01", "c", 10_000), ("2024-01-01", "c", 10_000), ("2026-01-01", "d", 30_000)], 200_000, None, None)
W["american"] = {"deal_a_gp": A["gp"], "deal_b_gp": B["gp"], "fund_gp": FUND["gp"], "clawback": A["gp"] + B["gp"] - FUND["gp"]}

# ---------------------------------------------------------------- metrics


def xirr(flows):
    t0 = min(d(x[0]) for x in flows)

    def npv(r):
        return sum(v / (1 + r) ** ((d(day) - t0).days / 365) for day, v in flows)

    return brentq(npv, -0.99, 10, xtol=1e-14, rtol=1e-14, maxiter=500)


EXCEL = [("2008-01-01", -10000), ("2008-03-01", 2750), ("2008-10-30", 4250), ("2009-02-15", 3250), ("2009-04-01", 2750)]
FUND_LP = [("2020-01-15", -100_000_000), ("2020-09-30", -200_000_000), ("2021-06-30", -150_000_000), ("2022-12-31", 50_000_000), ("2024-03-31", 120_000_000)]
NAV = 600_000_000
GROSS = [("2020-03-01", -100_000_000), ("2021-03-01", -50_000_000), ("2023-06-30", 30_000_000)]
VALUE = 400_000_000
paid = 450_000_000
dist = 170_000_000
OUT["metrics"] = {
    "excel_xirr": xirr(EXCEL),
    "excel_doc_value": 0.373362535,
    "fund_net_irr": xirr(FUND_LP + [("2026-09-30", NAV)]),
    "dpi_e8": rnd(F(dist, paid) * 10**8),
    "rvpi_e8": rnd(F(NAV, paid) * 10**8),
    "tvpi_direct_e8": rnd(F(dist + NAV, paid) * 10**8),
    "gross_moic_e8": rnd(F(30_000_000 + VALUE, 150_000_000) * 10**8),
    "gross_irr": xirr(GROSS + [("2026-09-30", VALUE)]),
}

# ------------------------------------------------------------- reserves


def reserve_rounds(o, t, rounds, allocated):
    needed = 0
    plan = []
    op = o
    left = allocated
    oo = o
    for raise_, post, pool in rounds:
        f = F(raise_, post) + F(pool, 10**6)
        skip = oo * (1 - f)
        a = max(0, rnd((t - skip) * post)) if t > skip else 0
        a = min(a, raise_)
        needed += a
        oo = skip + F(a, post)
        skip_p = op * (1 - f)
        ap = max(0, rnd((t - skip_p) * post)) if t > skip_p else 0
        ap = min(ap, raise_, left)
        left -= ap
        op = skip_p + F(ap, post)
        plan.append({"needed": a, "plan": ap, "after_ppm": rnd(oo * 10**6), "after_plan_ppm": rnd(op * 10**6)})
    return {"needed": needed, "rounds": plan, "end_ppm": rnd(oo * 10**6), "end_plan_ppm": rnd(op * 10**6)}


OUT["reserves"] = {
    "two_rounds": reserve_rounds(F(1, 10), F(1, 10), [(10_000_000_00, 50_000_000_00, 0), (30_000_000_00, 150_000_000_00, 0)], 2_500_000_00),
    "with_pool": reserve_rounds(F(1, 10), F(1, 10), [(10_000_000_00, 50_000_000_00, 50_000)], 5_000_000_00),
}

# ------------------------------------------------------------ scenarios
OUT["scenarios"] = {"expected_e8": rnd(F(500_000) * 0 + F(300_000) * 3 * 10**8 / 10**6 + F(150_000) * 10 * 10**8 / 10**6 + F(50_000) * 30 * 10**8 / 10**6 + 0), "proceeds_minor": rnd(F(100_000_000) * F(39, 10))}

# ------------------------------------------------------------- strength
NOW = datetime(2026, 11, 12, tzinfo=timezone.utc)
touches = [(3, 0), (2, 30), (1.5, 60), (1, 120)]
s = sum(w * 0.5 ** (age / 60) for w, age in touches)
OUT["strength"] = {"s": s, "score": round(100 * (1 - math.exp(-s / 3))), "meeting_today": round(100 * (1 - math.exp(-1))), "meeting_60d": round(100 * (1 - math.exp(-0.5)))}

# ----------------------------------------------------------------- runway
cash = 165_000_000
avg = rnd(F(10_000_000 + 12_000_000 + 11_000_000, 3))
OUT["runway"] = {"avg": avg, "months": rnd(F(cash * 10, avg)) / 10, "zero_day": (d("2026-09-30") + timedelta(days=rnd(F(cash * 36525, avg * 1200)))).isoformat()}

# --------------------------------------------------------------------- kpi
jan, feb, mar = 108_000_000, 110_000_000, 112_000_000
q1_avg = rnd(F(31 * jan + 28 * feb + 31 * mar, 90))
OUT["kpi"] = {
    "q1_avg_rate_e8": q1_avg,
    "q1_flow_usd_minor": rnd(F(30_000_000) * q1_avg / 10**8),
    "mar_cash_usd_minor": rnd(F(100_000_000) * mar / 10**8),
    "feb_flow_usd_minor": rnd(F(10_000_000) * feb / 10**8),
    "eur_to_jpy_minor": rnd(F(100_000) * 16_000_000_000 * 1 / (100 * 10**8)),
    "cmgr_ppm": round((2 ** (1 / 12) - 1) * 10**6),
}

# ------------------------------------------------------------------- days
WEEKMASK_SAT_SUN = "1111100"  # Mon..Sun
WEEKMASK_FRI_SAT = "1111001"


def add_bd(day, n, weekmask=WEEKMASK_SAT_SUN, holidays=()):
    return str(np.busday_offset(day, n, roll="backward", weekmask=weekmask, holidays=list(holidays)))


def bd_between(a, b, weekmask=WEEKMASK_SAT_SUN, holidays=()):
    return int(np.busday_count(d(a) + timedelta(days=1), d(b) + timedelta(days=1), weekmask=weekmask, holidays=list(holidays)))


def local_day(zone, iso):
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(ZoneInfo(zone)).date().isoformat()


days = OUT["days"] = {}
recv = "2026-11-12T23:30:00Z"
days["tokyo_received"] = local_day("Asia/Tokyo", recv)
days["ny_received"] = local_day("America/New_York", recv)
days["tokyo_due"] = add_bd(days["tokyo_received"], 5)
days["ny_due"] = add_bd(days["ny_received"], 5)
days["sat_due"] = add_bd("2026-11-14", 5)
days["frisat_due"] = add_bd("2026-11-12", 5, WEEKMASK_FRI_SAT)
days["holiday_due"] = add_bd("2026-12-22", 5, holidays=("2026-12-25", "2027-01-01"))
days["ten_bd_due"] = add_bd("2026-12-18", 10, holidays=("2026-12-25", "2027-01-01"))
days["between_fri_mon"] = bd_between("2026-11-13", "2026-11-16")
days["between_month"] = bd_between("2026-11-01", "2026-11-30")
days["between_holidays"] = bd_between("2026-12-20", "2027-01-05", holidays=("2026-12-25", "2027-01-01"))
days["stall_utc_entered"] = local_day("UTC", "2026-11-01T14:30:00Z")
days["stall_tokyo_entered"] = local_day("Asia/Tokyo", "2026-11-01T14:30:00Z")
days["stall_utc_now"] = local_day("UTC", "2026-11-08T15:30:00Z")
days["stall_tokyo_now"] = local_day("Asia/Tokyo", "2026-11-08T15:30:00Z")

# Zone table check: every DST transition in 2025..2027 for each zone in the
# engine's table, one minute before and after, plus two mid-season samples.
src = open(os.path.join(HERE, "..", "..", "pb", "pb_hooks", "lib_eng_days.js"), encoding="utf-8").read()
zones = re.findall(r"^\s+'?([A-Za-z_/]+)'?: \[-?\d+, '\w+'\],$", src, re.M)
checks = []
for z in zones:
    tz = ZoneInfo(z)
    t = datetime(2025, 1, 1, tzinfo=timezone.utc)
    end = datetime(2028, 1, 1, tzinfo=timezone.utc)
    prev = t.astimezone(tz).utcoffset()
    while t < end:
        n = t + timedelta(hours=1)
        off = n.astimezone(tz).utcoffset()
        if off != prev:
            lo, hi = t, n
            while (hi - lo) > timedelta(minutes=1):
                mid = lo + (hi - lo) / 2
                mid = mid.replace(second=0, microsecond=0)
                if mid <= lo:
                    break
                if mid.astimezone(tz).utcoffset() == prev:
                    lo = mid
                else:
                    hi = mid
            for inst in (hi - timedelta(minutes=1), hi + timedelta(minutes=1)):
                checks.append({"zone": z, "at": inst.strftime("%Y-%m-%dT%H:%M:%SZ"), "offset": int(inst.astimezone(tz).utcoffset().total_seconds() // 60), "day": inst.astimezone(tz).date().isoformat()})
            prev = off
        t = n
    for inst in (datetime(2026, 1, 15, 12, tzinfo=timezone.utc), datetime(2026, 7, 15, 12, tzinfo=timezone.utc), datetime(2026, 11, 12, 23, 30, tzinfo=timezone.utc)):
        checks.append({"zone": z, "at": inst.strftime("%Y-%m-%dT%H:%M:%SZ"), "offset": int(inst.astimezone(tz).utcoffset().total_seconds() // 60), "day": inst.astimezone(tz).date().isoformat()})
days["zone_count"] = len(zones)
days["zone_checks"] = checks

with open(os.path.join(HERE, "expected.json"), "w", encoding="utf-8") as fh:
    json.dump(OUT, fh, indent=1, sort_keys=True)
print("zones", len(zones), "zone checks", len(checks))
print(json.dumps({k: v for k, v in OUT.items() if k != "days"}, indent=1, sort_keys=True))
print(json.dumps({k: v for k, v in days.items() if k != "zone_checks"}, indent=1, sort_keys=True))
