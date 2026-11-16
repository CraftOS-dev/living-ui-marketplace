/// <reference path="../pb_data/types.d.ts" />
/**
 * The statutory filings calendar: structured due rules for every filing
 * code the rule packs and country data declare, and the pure date logic
 * that turns a rule into periods and due days. Plain JavaScript, no
 * PocketBase globals (Node tests load it).
 *
 * The packs describe due dates in words (`due_rule`) for people; this file
 * holds the same rules as data. A code without a rule here still gets
 * ledger rows, with no due day and the pack's words, so a person sets it.
 *
 * Rule fields:
 *   period:  month | quarter | half | year | tax_month | tax_quarter | pay_date | bonus | event
 *   basis:   calendar (default) or tax (periods follow the pack's tax year)
 *   due:     { months, day, from: 'end' (default) | 'start' } (day: 1..31 or 'last', kept inside the month)
 *            or { days } for pay_date and bonus rows (days after the pay date); null when the
 *            rule depends on facts HR OS does not hold (a person sets the day)
 *   except:  { '<MM of the period end>': { months, day } }
 *   adjust:  next_business | previous_business | none (weekends and the entity's holidays)
 *   choices: { <name>: rule } with `pref` (the entity preference key) and `default`
 *   amount:  { plus: [codes], minus: [codes] } to sum codes instead of lines filed under the code,
 *            or { filing: '<code>' } to sum the lines filed under another code (deposits of a return)
 *            (a deposit whose lines the pack files under its return, such as TDS under 24Q)
 *   skip_with_region_packs: true when a country-wide row is replaced by the state packs' own rows
 */

const QUARTER_LAST = { period: 'quarter', due: { months: 1, day: 'last' }, adjust: 'next_business' };
const MONTH_15 = { period: 'month', due: { months: 1, day: 15 }, adjust: 'none' };

const RULES = {
  // United States (IRS: a due date on a weekend or legal holiday moves to the next business day)
  us_941: QUARTER_LAST,
  // Form 941 taxes (income tax withheld, social security and Medicare) are deposited through EFTPS by
  // the entity's deposit schedule (IRS Pub 15 section 11); the $100,000 next-day rule is for people.
  us_941_deposit: { pref: 'us_941_deposit', default: 'monthly', amount: { filing: 'us_941' }, choices: {
    monthly: { period: 'month', due: { months: 1, day: 15 }, adjust: 'next_business' },
    semiweekly: { period: 'pay_date', due: { semiweekly: true }, adjust: 'next_business' },
  } },
  us_940: { period: 'year', due: { months: 1, day: 31 }, adjust: 'next_business' },
  us_w2: { period: 'year', due: { months: 1, day: 31 }, adjust: 'next_business', documents: true },
  us_futa_deposit: Object.assign({ amount: { plus: ['US_FUTA'] } }, QUARTER_LAST),
  us_state_quarterly: Object.assign({ skip_with_region_packs: true }, QUARTER_LAST),
  us_sui: QUARTER_LAST,
  us_wa_paidleave: QUARTER_LAST,
  us_ca_de9: QUARTER_LAST,
  us_ca_de88: { period: 'pay_date', due: null },
  us_ca_de34: { period: 'event' },
  us_az_a1qrt: QUARTER_LAST,
  us_az_ui: QUARTER_LAST,
  us_co_1094: { period: 'quarter', due: null },
  us_co_ui: QUARTER_LAST,
  us_ga_g7: QUARTER_LAST,
  us_ga_ui: QUARTER_LAST,
  us_il_941: QUARTER_LAST,
  us_il_ui: QUARTER_LAST,
  us_ma_m942: { pref: 'us_ma_m942', default: 'monthly', choices: { monthly: { period: 'month', due: { months: 1, day: 15 }, adjust: 'next_business' }, quarterly: { period: 'quarter', due: null } } },
  us_ma_pfml: QUARTER_LAST,
  us_ma_ui: QUARTER_LAST,
  us_mi_5080: { pref: 'us_mi_5080', default: 'monthly', choices: { monthly: { period: 'month', due: { months: 1, day: 20 }, adjust: 'next_business' }, quarterly: { period: 'quarter', due: { months: 1, day: 20 }, adjust: 'next_business' } } },
  us_mi_ui: { period: 'quarter', due: { months: 1, day: 25 }, adjust: 'next_business' },
  us_nc_5: { pref: 'us_nc_5', default: 'monthly', choices: { monthly: { period: 'month', due: { months: 1, day: 15 }, adjust: 'next_business' }, quarterly: QUARTER_LAST } },
  us_nc_ui: QUARTER_LAST,
  us_nj_927: { period: 'quarter', due: { months: 1, day: 30 }, adjust: 'next_business' },
  us_nj_w3: { period: 'year', due: { months: 2, day: 15 }, adjust: 'next_business' },
  us_ny_nys45: QUARTER_LAST,
  us_ny_nys1: { period: 'pay_date', due: null },
  us_oh_941: { period: 'month', due: null },
  us_oh_ui: QUARTER_LAST,
  us_pa_w3: QUARTER_LAST,
  us_pa_eit: { period: 'quarter', due: null },
  us_pa_ui: QUARTER_LAST,
  us_va_5: { pref: 'us_va_5', default: 'monthly', choices: { monthly: { period: 'month', due: { months: 1, day: 25 }, adjust: 'next_business' }, quarterly: { period: 'quarter', due: null } } },
  us_va_ui: QUARTER_LAST,

  // United Kingdom (tax year from 6 April; HMRC: pay by the last working day before a weekend or bank holiday)
  gb_fps: { period: 'pay_date', due: { days: 0 }, adjust: 'none' },
  gb_eps: { period: 'tax_month', basis: 'tax', due: { months: 0, day: 19 }, adjust: 'none' },
  gb_paye_payment: { pref: 'gb_paye_payment', default: 'monthly', amount: { plus: ['GB_PAYE', 'GB_NI_EE', 'GB_NI_ER', 'GB_STUDENT_LOAN', 'GB_PG_LOAN'] }, choices: {
    monthly: { period: 'tax_month', basis: 'tax', due: { months: 0, day: 22 }, adjust: 'previous_business' },
    quarterly: { period: 'tax_quarter', basis: 'tax', due: { months: 0, day: 22 }, adjust: 'previous_business' },
  } },
  gb_p60: { period: 'year', basis: 'tax', due: { months: 1, day: 31 }, adjust: 'none', documents: true },
  gb_p11d: { period: 'year', basis: 'tax', due: { months: 3, day: 6 }, adjust: 'none' },
  gb_p45: { period: 'event' },

  // Australia (financial year from 1 July; ATO: a due date on a weekend or public holiday moves to the next business day)
  au_stp: { period: 'pay_date', due: { days: 0 }, adjust: 'none' },
  au_stp_final: { period: 'year', basis: 'tax', due: { months: 1, day: 14 }, adjust: 'next_business' },
  au_bas_paygw: { pref: 'au_bas', default: 'quarterly', amount: { plus: ['AU_PAYGW', 'AU_STSL'] }, choices: {
    monthly: { period: 'month', due: { months: 1, day: 21 }, adjust: 'next_business' },
    quarterly: { period: 'quarter', basis: 'tax', due: { months: 1, day: 28 }, except: { '12': { months: 2, day: 28 } }, adjust: 'next_business' },
  } },
  au_bas: { pref: 'au_bas', default: 'quarterly', amount: { plus: ['AU_PAYGW', 'AU_STSL'] }, choices: {
    monthly: { period: 'month', due: { months: 1, day: 21 }, adjust: 'next_business' },
    quarterly: { period: 'quarter', basis: 'tax', due: { months: 1, day: 28 }, except: { '12': { months: 2, day: 28 } }, adjust: 'next_business' },
  } },
  au_super: { by_frequency: {
    quarterly: { period: 'quarter', basis: 'tax', due: { months: 1, day: 28 }, adjust: 'next_business' },
    // Payday super from 1 July 2026: contributions reach the fund within 7 days after each pay day
    // (SGAA as amended for payday super; the au 2026.1 pack notes). A new employee's first
    // contribution may have longer: a person sets that row's day.
    per_pay_date: { period: 'pay_date', due: { days: 7 }, adjust: 'none' },
  } },

  // Japan (国税通則法: a due date on a weekend or holiday moves to the next business day)
  jp_gensen: { pref: 'jp_special_period', default: 'monthly', choices: {
    monthly: { period: 'month', due: { months: 1, day: 10 }, adjust: 'next_business' },
    special: { period: 'half', due: { months: 1, day: 10 }, except: { '12': { months: 1, day: 20 } }, adjust: 'next_business' },
  } },
  jp_shakai_hoken: { period: 'month', due: { months: 1, day: 'last' }, adjust: 'next_business' },
  jp_juminzei: { period: 'month', due: { months: 1, day: 10 }, adjust: 'next_business' },
  jp_santei: { period: 'year', due: { from: 'start', months: 6, day: 10 }, adjust: 'next_business' },
  jp_shoyo_todoke: { period: 'bonus', due: { days: 5 }, adjust: 'none' },
  jp_rodo_hoken: { period: 'year', due: { from: 'start', months: 6, day: 10 }, adjust: 'next_business' },
  jp_hotei_chosho: { period: 'year', due: { months: 1, day: 31 }, adjust: 'next_business', documents: true },
  jp_nencho: { period: 'year', due: { months: 1, day: 31 }, adjust: 'next_business', amount: { plus: ['JP_YEA_TAX'], minus: ['JP_YEA_REFUND'] } },

  // Singapore
  sg_cpf: { period: 'month', due: { months: 1, day: 14 }, adjust: 'none' },
  sg_ir8a: { period: 'year', due: { months: 3, day: 1 }, adjust: 'none', documents: true },

  // India (financial year from 1 April)
  in_tds_deposit: { period: 'month', due: { months: 1, day: 7 }, except: { '03': { months: 1, day: 30 } }, adjust: 'none', amount: { plus: ['IN_TDS'] } },
  in_24q: { period: 'quarter', basis: 'tax', due: { months: 1, day: 'last' }, except: { '03': { months: 2, day: 31 } }, adjust: 'none' },
  in_form16: { period: 'year', basis: 'tax', due: { months: 3, day: 15 }, adjust: 'none', documents: true },
  in_ecr: MONTH_15,
  in_esic: MONTH_15,
  in_pt: { period: 'month', due: null },

  // Malaysia
  my_cp39: MONTH_15,
  my_epf: MONTH_15,
  my_perkeso: MONTH_15,
  my_hrdf: MONTH_15,
  my_ea: { period: 'year', due: { months: 2, day: 'last' }, adjust: 'none', documents: true },
  my_form_e: { period: 'year', due: { months: 3, day: 31 }, adjust: 'none' },

  // Canada (country data only; no pack yet)
  ca_t4: { period: 'year', due: { months: 2, day: 'last' }, adjust: 'next_business' },
  ca_roe: { period: 'event' },
  ca_pd7a: { period: 'month', due: null },
};

/** Filings HR OS adds for a country beyond the packs and country data. */
const BUILTIN = {
  US: [{ code: 'us_941_deposit', name: 'Federal income tax and FICA deposit (EFTPS)', frequency: 'monthly', due_rule: 'Monthly depositors: by the 15th of the next month. Semi-weekly depositors: wages paid Wednesday to Friday by the next Wednesday, Saturday to Tuesday by the next Friday. A $100,000 liability in a day: the next business day.', form: 'EFTPS' }],
  JP: [{ code: 'jp_nencho', name: '年末調整 (year-end adjustment)', frequency: 'yearly', due_rule: 'with the last pay of the year; the difference is settled in the January payment, records by 31 January', form: '年末調整' }],
};

const FREQUENCY_OF = { month: 'monthly', tax_month: 'monthly', quarter: 'quarterly', tax_quarter: 'quarterly', half: 'half_yearly', year: 'annual', pay_date: 'per_pay_date', bonus: 'per_bonus' };

/** Fallback periods for a code with no rule, from the pack's frequency word. */
const PERIOD_OF_FREQUENCY = { monthly: 'month', quarterly: 'quarter', half_yearly: 'half', annual: 'year', yearly: 'year', per_pay_date: 'pay_date', per_bonus: 'bonus', event: 'event' };

/* ------------------------------------------------------------ days */

function pad(n) {
  return n < 10 ? '0' + n : String(n);
}

function dayText(y, m, d) {
  return y + '-' + pad(m) + '-' + pad(d);
}

function parts(day) {
  return { y: Number(day.slice(0, 4)), m: Number(day.slice(5, 7)), d: Number(day.slice(8, 10)) };
}

function daysIn(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function addDays(day, n) {
  const p = parts(day);
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
  return dayText(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** The month `months` after the month of `day`, at `dayOfMonth` (a number kept inside the month, or 'last'). */
function monthDay(day, months, dayOfMonth) {
  const p = parts(day);
  let m = p.m + months;
  let y = p.y;
  while (m > 12) { m -= 12; y += 1; }
  while (m < 1) { m += 12; y -= 1; }
  const last = daysIn(y, m);
  const d = dayOfMonth === 'last' ? last : Math.min(Number(dayOfMonth), last);
  return dayText(y, m, d);
}

function weekdayOf(day) {
  const p = parts(day);
  return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
}

/** Move a due day off weekends and holidays. `isOff(day)` says whether a day is a holiday. */
function adjust(day, mode, weekend, isOff) {
  if (!day || !mode || mode === 'none') return day;
  const off = (d) => (weekend || [0, 6]).indexOf(weekdayOf(d)) >= 0 || (typeof isOff === 'function' && isOff(d) === true);
  let d = day;
  const step = mode === 'previous_business' ? -1 : 1;
  for (let i = 0; i < 15 && off(d); i++) d = addDays(d, step);
  return d;
}

/* --------------------------------------------------------- periods */

/** The rule for a code (after choices by the entity's preferences and the pack's frequency), or null. */
function ruleFor(code, prefs, frequency) {
  let r = RULES[code] || null;
  if (r === null) {
    const period = PERIOD_OF_FREQUENCY[frequency || ''];
    return period ? { period: period, due: null, fallback: true } : null;
  }
  if (r.by_frequency) r = r.by_frequency[frequency] || r.by_frequency[Object.keys(r.by_frequency)[0]];
  if (r.choices) {
    const want = (prefs || {})[r.pref];
    const key = want && r.choices[want] ? want : r.default;
    r = Object.assign({ choice: key, choice_pref: r.pref, choice_options: Object.keys(r.choices) }, r.amount ? { amount: r.amount } : {}, r.choices[key]);
  }
  return r;
}

/** The tax year start ('MM-DD') to use for a rule; calendar rules start on 01-01. */
function yearStart(rule, taxStart) {
  return rule.basis === 'tax' ? taxStart || '01-01' : '01-01';
}

/**
 * Periods of a rule that END inside calendar year `year`, as
 * [{ period, start, end }]. Tax-year periods use `taxStart` ('MM-DD').
 */
function periods(rule, year, taxStart) {
  const out = [];
  const start = yearStart(rule, taxStart);
  const sm = Number(start.slice(0, 2));
  const sd = Number(start.slice(3, 5));
  const inYear = (p) => Number(p.end.slice(0, 4)) === year;
  if (rule.period === 'month') {
    for (let m = 1; m <= 12; m++) out.push({ period: year + '-' + pad(m), start: dayText(year, m, 1), end: dayText(year, m, daysIn(year, m)) });
    return out;
  }
  if (rule.period === 'half') {
    out.push({ period: year + '-H1', start: dayText(year, 1, 1), end: dayText(year, 6, 30) });
    out.push({ period: year + '-H2', start: dayText(year, 7, 1), end: dayText(year, 12, 31) });
    return out;
  }
  if (rule.period === 'quarter' || rule.period === 'tax_quarter' || rule.period === 'tax_month') {
    const n = rule.period === 'tax_month' ? 1 : 3;
    // walk from the start of the tax year before `year` to the end of `year`
    for (let ty = year - 1; ty <= year; ty++) {
      const first = dayText(ty, sm, sd);
      for (let k = 0; k < 12 / n; k++) {
        const s = monthDay(first, k * n, sd);
        const e = addDays(monthDay(first, (k + 1) * n, sd), -1);
        const label = rule.period === 'tax_month' ? taxYearLabel(ty, start) + ' M' + pad(k + 1) : start === '01-01' ? ty + '-Q' + (k + 1) : taxYearLabel(ty, start) + ' Q' + (k + 1);
        const p = { period: label, start: s, end: e };
        if (inYear(p)) out.push(p);
      }
    }
    return out;
  }
  if (rule.period === 'year') {
    if (start === '01-01') return [{ period: String(year), start: dayText(year, 1, 1), end: dayText(year, 12, 31) }];
    // the tax year that ends in `year`
    const ty = year - 1;
    const s = dayText(ty, sm, sd);
    return [{ period: taxYearLabel(ty, start), start: s, end: addDays(monthDay(s, 12, sd), -1) }];
  }
  return out;
}

function taxYearLabel(startYear, start) {
  if (start === '01-01') return String(startYear);
  return startYear + '-' + pad((startYear + 1) % 100);
}

/** The due day of one period (before the business day adjustment), or '' when the rule has none. */
function dueOf(rule, p) {
  if (!rule || !rule.due) return '';
  if (rule.due.days !== undefined) return addDays(p.payDate || p.end, rule.due.days);
  if (rule.due.semiweekly) {
    // pay day Wednesday to Friday: the next Wednesday; Saturday to Tuesday: the next Friday
    const day = p.payDate || p.end;
    const wd = weekdayOf(day);
    const target = wd >= 3 && wd <= 5 ? 3 : 5;
    const delta = (target - wd + 7) % 7 || 7;
    return addDays(day, delta);
  }
  const endMonth = p.end.slice(5, 7);
  const ex = rule.except && rule.except[endMonth] ? rule.except[endMonth] : null;
  const months = ex ? ex.months : rule.due.months;
  const day = ex ? ex.day : rule.due.day;
  const base = rule.due.from === 'start' ? p.start : p.end;
  return monthDay(base, months, day);
}

/** Due day after the business day rule. */
function dueDay(rule, p, weekend, isOff) {
  const d = dueOf(rule, p);
  if (d === '') return '';
  return adjust(d, rule.adjust || 'none', weekend, isOff);
}

/** Merge a country's filing declarations: active packs first, then country data, then builtins (by code). */
function declarations(packs, country, regionPacksOn) {
  const out = [];
  const seen = {};
  for (const pk of packs || []) {
    for (const f of pk.filings || []) {
      if (!f || !f.code || seen[f.code]) continue;
      seen[f.code] = true;
      out.push({ code: f.code, name: f.name || f.code, frequency: f.frequency || '', due_rule: f.due_rule || f.due || '', form: f.form || '', pack: pk.code, source: 'pack' });
    }
  }
  for (const f of (country && country.filings) || []) {
    if (!f || !f.code || seen[f.code]) continue;
    const r = RULES[f.code];
    if (r && r.skip_with_region_packs && regionPacksOn) continue;
    seen[f.code] = true;
    out.push({ code: f.code, name: f.name || f.code, frequency: f.frequency || '', due_rule: f.due_rule || f.due || '', form: f.form || '', pack: '', source: 'country' });
  }
  for (const f of BUILTIN[(country && country.code) || ''] || []) {
    if (seen[f.code]) continue;
    seen[f.code] = true;
    out.push(Object.assign({ pack: '', source: 'builtin' }, f));
  }
  return out;
}

module.exports = {
  RULES: RULES,
  BUILTIN: BUILTIN,
  FREQUENCY_OF: FREQUENCY_OF,
  ruleFor: ruleFor,
  periods: periods,
  dueOf: dueOf,
  dueDay: dueDay,
  adjust: adjust,
  addDays: addDays,
  monthDay: monthDay,
  weekdayOf: weekdayOf,
  declarations: declarations,
  taxYearLabel: taxYearLabel,
};
