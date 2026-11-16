/**
 * Leave defaults per country: the leave types and one policy a new entity
 * starts with (seeded on entity.created, everything editable afterwards).
 *
 * The statutory minimums a country data file declares (data/countries/<cc>.js
 * `leave_types`, with an optional `region`) are the source: a type listed
 * there is always seeded, with the data's name and note. This file adds what
 * the data does not carry: icons and colours, the entitlement rule (tenure
 * tables, accrual, carry-over, the Japanese grant schedule) and the common
 * types a company needs (unpaid, compensatory leave). Countries without an
 * entry here get the generic set built from their data.
 *
 * Plain data (no PocketBase globals): tools and tests load it in Node.
 *
 * Rule fields (one rule per type in a policy):
 *   method: fixed | monthly_accrual | per_hours_worked | tenure_table | statutory_jp | manual | none
 *   amount, tenure [{ after, amount }], tenure_unit years | months, tenure_at period_start | anniversary,
 *   eligible_after_months, proration join | none (join also prorates a leaver's last year),
 *   rounding half | whole | none, accrual_day start | end | daily (daily: progressive, each day earns its share),
 *   per_hours { per, earn }, max_balance, expiry period | grant, carryover_max (-1 all, 0 none),
 *   carryover_expiry_months (0 never), grant_expiry_months, scale none | fte | days_per_week, scale_cap,
 *   deduct_holidays, includes [type codes], encash_max, max_hours_per_year, first_after_months, obligation
 *
 * payout_on_exit on a type: the unused balance on the last day is paid with the final pay
 * (true, or a list of regions where the law requires it).
 */

const ICONS = ['sun', 'palmtree', 'plane', 'thermometer', 'stethoscope', 'hospital', 'baby', 'heart', 'heart-handshake', 'users', 'house', 'graduation-cap', 'briefcase', 'clock', 'calendar-off', 'calendar-clock', 'hand-coins', 'award', 'scale', 'umbrella', 'flower', 'landmark', 'shield', 'star'];
const COLORS = ['rh', 'lh', 'good', 'warn', 'bad', 'ink'];

const ANNUAL = { color: 'rh', icon: 'sun', paid: true, allow_half: true, min_notice_days: 0, encashable: false };
const SICK = { color: 'lh', icon: 'thermometer', paid: true, allow_half: true };
const PARENT = { color: 'good', icon: 'baby', counts_weekends: true, counts_holidays: true, allow_half: false };
const UNPAID = { code: 'unpaid', name: 'Unpaid leave', paid: false, color: 'ink', icon: 'calendar-off', allow_half: true, rule: { method: 'none' }, note: 'Days off without pay; payroll deducts them.' };
const COMP = (months, name) => ({ code: 'comp_off', name: name || 'Compensatory leave', paid: true, color: 'warn', icon: 'clock', allow_half: true, comp_off: true, rule: { method: 'manual', expiry: 'grant', grant_expiry_months: months }, note: 'Earned by working a rest day or a holiday (approved as compensatory leave); each grant expires after ' + months + ' months.' });

const PERIOD_CLOSE = (max, months) => ({ expiry: 'period', carryover_max: max, carryover_expiry_months: months });

const COUNTRIES = {
  JP: {
    period_start: '04-01',
    policy: 'Japan statutory leave',
    types: [
      Object.assign({}, ANNUAL, {
        code: 'annual',
        name: '年次有給休暇 (annual paid leave)',
        statutory: true,
        allow_hours: true,
        rule: { method: 'statutory_jp', first_after_months: 6, expiry: 'grant', grant_expiry_months: 24, obligation: true, max_hours_per_year: 40 },
      }),
      { code: 'child_nursing', name: '子の看護等休暇 (child nursing leave)', paid: false, color: 'good', icon: 'heart', allow_half: true, allow_hours: true, statutory: true, rule: { method: 'fixed', amount: 5, proration: 'none', expiry: 'period', carryover_max: 0 }, note: 'Five days a year for one child up to the end of the third year of elementary school (ten with two or more); usually unpaid. Set ten days for people with two or more children.' },
      { code: 'care_days', name: '介護休暇 (family care days)', paid: false, color: 'good', icon: 'heart-handshake', allow_half: true, allow_hours: true, statutory: true, rule: { method: 'fixed', amount: 5, proration: 'none', expiry: 'period', carryover_max: 0 }, note: 'Five days a year for one family member who needs care (ten with two or more); usually unpaid.' },
      Object.assign({}, PARENT, { code: 'maternity', name: '産前産後休業 (maternity leave)', paid: false, statutory: true, gender_specific: 'female', max_consecutive_days: 98, rule: { method: 'none' } }),
      Object.assign({}, PARENT, { code: 'childcare', name: '育児休業 (childcare leave)', paid: false, statutory: true, rule: { method: 'none' } }),
      Object.assign({}, PARENT, { code: 'family_care', name: '介護休業 (family care leave)', paid: false, statutory: true, icon: 'heart-handshake', max_consecutive_days: 93, rule: { method: 'none' } }),
      COMP(3, '代休 (compensatory day off)'),
      Object.assign({}, UNPAID, { name: '欠勤・無給休暇 (unpaid leave)' }),
    ],
  },
  SG: {
    period_start: '01-01',
    policy: 'Singapore Employment Act leave',
    types: [
      Object.assign({}, ANNUAL, {
        code: 'annual',
        name: 'Annual leave',
        statutory: true,
        encashable: true,
        payout_on_exit: true,
        rule: Object.assign({ method: 'tenure_table', tenure: [{ after: 0, amount: 7 }, { after: 1, amount: 8 }, { after: 2, amount: 9 }, { after: 3, amount: 10 }, { after: 4, amount: 11 }, { after: 5, amount: 12 }, { after: 6, amount: 13 }, { after: 7, amount: 14 }], tenure_unit: 'years', tenure_at: 'period_start', eligible_after_months: 3, proration: 'join', rounding: 'half', encash_max: 0 }, PERIOD_CLOSE(5, 12)),
      }),
      Object.assign({}, SICK, {
        code: 'sick',
        name: 'Outpatient sick leave',
        statutory: true,
        attachment_after_days: 1,
        rule: Object.assign({ method: 'tenure_table', tenure: [{ after: 3, amount: 5 }, { after: 4, amount: 8 }, { after: 5, amount: 11 }, { after: 6, amount: 14 }], tenure_unit: 'months', tenure_at: 'anniversary', proration: 'none', rounding: 'none' }, PERIOD_CLOSE(0, 0)),
      }),
      Object.assign({}, SICK, {
        code: 'hospitalisation',
        name: 'Hospitalisation leave',
        icon: 'hospital',
        statutory: true,
        attachment_after_days: 1,
        rule: Object.assign({ method: 'tenure_table', tenure: [{ after: 3, amount: 15 }, { after: 4, amount: 30 }, { after: 5, amount: 45 }, { after: 6, amount: 60 }], tenure_unit: 'months', tenure_at: 'anniversary', proration: 'none', rounding: 'none', includes: ['sick'] }, PERIOD_CLOSE(0, 0)),
        note: 'Up to 60 days a year including the outpatient sick days taken (MOM).',
      }),
      { code: 'childcare', name: 'Childcare leave', paid: true, color: 'good', icon: 'heart', allow_half: true, statutory: true, rule: Object.assign({ method: 'fixed', amount: 6, eligible_after_months: 3, proration: 'none' }, PERIOD_CLOSE(0, 0)), note: 'Six days a year with a Singapore citizen child under 7; two days of extended childcare leave for a child aged 7 to 12 (check MOM for the current scheme).' },
      Object.assign({}, PARENT, { code: 'maternity', name: 'Maternity leave', paid: true, statutory: true, gender_specific: 'female', max_consecutive_days: 112, rule: { method: 'none' }, note: '16 weeks of government-paid maternity leave for an eligible Singapore citizen child (check MOM).' }),
      { code: 'paternity', name: 'Paternity leave', paid: true, color: 'good', icon: 'baby', statutory: true, max_consecutive_days: 20, rule: { method: 'none' }, note: 'Four weeks of government-paid paternity leave, within 12 months of the birth (check MOM).' },
      { code: 'shared_parental', name: 'Shared parental leave', paid: true, color: 'good', icon: 'users', statutory: true, rule: { method: 'none' }, note: 'Shared between both parents for an eligible child; the number of weeks depends on the birth date (check MOM).' },
      COMP(3, 'Off in lieu'),
      UNPAID,
    ],
  },
  MY: {
    period_start: '01-01',
    policy: 'Malaysia Employment Act leave',
    types: [
      Object.assign({}, ANNUAL, {
        code: 'annual',
        name: 'Annual leave',
        statutory: true,
        encashable: true,
        payout_on_exit: true,
        rule: Object.assign({ method: 'tenure_table', tenure: [{ after: 0, amount: 8 }, { after: 2, amount: 12 }, { after: 5, amount: 16 }], tenure_unit: 'years', tenure_at: 'period_start', proration: 'join', rounding: 'half' }, PERIOD_CLOSE(5, 6)),
      }),
      Object.assign({}, SICK, {
        code: 'sick',
        name: 'Sick leave',
        statutory: true,
        attachment_after_days: 1,
        rule: Object.assign({ method: 'tenure_table', tenure: [{ after: 0, amount: 14 }, { after: 2, amount: 18 }, { after: 5, amount: 22 }], tenure_unit: 'years', tenure_at: 'period_start', proration: 'none', rounding: 'none' }, PERIOD_CLOSE(0, 0)),
      }),
      Object.assign({}, SICK, { code: 'hospitalisation', name: 'Hospitalisation leave', icon: 'hospital', statutory: true, attachment_after_days: 1, rule: Object.assign({ method: 'fixed', amount: 60, proration: 'none', includes: ['sick'] }, PERIOD_CLOSE(0, 0)), note: 'Up to 60 days a year in all, including the sick leave days taken.' }),
      Object.assign({}, PARENT, { code: 'maternity', name: 'Maternity leave', paid: true, statutory: true, gender_specific: 'female', max_consecutive_days: 98, rule: { method: 'none' } }),
      { code: 'paternity', name: 'Paternity leave', paid: true, color: 'good', icon: 'baby', statutory: true, counts_weekends: true, counts_holidays: true, max_consecutive_days: 7, rule: { method: 'none' } },
      COMP(3, 'Replacement leave'),
      UNPAID,
    ],
  },
  IN: {
    period_start: '01-01',
    policy: 'India leave (editable defaults)',
    note: 'State Shops and Establishments Acts (and the Factories Act) set different minimums, accrual and carry-forward limits: check the rules of your state and change these defaults.',
    types: [
      Object.assign({}, ANNUAL, { code: 'earned', name: 'Earned leave', encashable: true, payout_on_exit: true, rule: Object.assign({ method: 'monthly_accrual', amount: 15, accrual_day: 'end', proration: 'join', rounding: 'none' }, PERIOD_CLOSE(30, 0)), note: 'Editable default: 15 days a year accrued monthly, up to 30 carried forward. State Shops and Establishments Acts differ.' }),
      { code: 'casual', name: 'Casual leave', paid: true, color: 'lh', icon: 'umbrella', allow_half: true, rule: Object.assign({ method: 'fixed', amount: 7, proration: 'join', rounding: 'half' }, PERIOD_CLOSE(0, 0)), note: 'Editable default: 7 days a year, not carried forward. State Shops and Establishments Acts differ.' },
      Object.assign({}, SICK, { code: 'sick', name: 'Sick leave', attachment_after_days: 3, rule: Object.assign({ method: 'fixed', amount: 7, proration: 'join', rounding: 'half' }, PERIOD_CLOSE(0, 0)), note: 'Editable default: 7 days a year; a certificate for three days or more. State Shops and Establishments Acts differ.' }),
      Object.assign({}, PARENT, { code: 'maternity', name: 'Maternity leave', paid: true, statutory: true, gender_specific: 'female', max_consecutive_days: 182, rule: { method: 'none' }, note: '26 weeks for the first two children under the Maternity Benefit Act (12 weeks from the third).' }),
      COMP(3, 'Compensatory off'),
      Object.assign({}, UNPAID, { name: 'Loss of pay' }),
    ],
  },
  US: {
    period_start: '01-01',
    policy: 'United States PTO',
    types: [
      Object.assign({}, ANNUAL, { code: 'pto', name: 'Paid time off', allow_hours: true, payout_on_exit: ['CA'], rule: Object.assign({ method: 'fixed', amount: 15, proration: 'join', rounding: 'half' }, PERIOD_CLOSE(5, 0)), note: 'Company policy (no federal mandate): 15 days a year by default, up to 5 carried forward. California pays the unused balance on leaving (Labor Code section 227.3); some other states require it too.' }),
      { code: 'sick_ca', region: 'CA', name: 'California paid sick leave', unit: 'hour', paid: true, color: 'lh', icon: 'thermometer', allow_half: true, allow_hours: true, statutory: true, rule: Object.assign({ method: 'fixed', amount: 40, proration: 'none', rounding: 'none' }, PERIOD_CLOSE(0, 0)), note: 'California: at least 40 hours or 5 days a year, given here up front each year (the accrual alternative is 1 hour per 30 hours worked). Check the current Labor Code section 246.' },
      { code: 'fmla', name: 'Family and medical leave (FMLA)', paid: false, color: 'good', icon: 'heart-handshake', statutory: true, rule: Object.assign({ method: 'fixed', amount: 60, proration: 'none', rounding: 'none' }, PERIOD_CLOSE(0, 0)) },
      UNPAID,
    ],
  },
  GB: {
    period_start: '01-01',
    policy: 'United Kingdom holiday entitlement',
    types: [
      Object.assign({}, ANNUAL, {
        code: 'annual',
        name: 'Annual leave',
        statutory: true,
        payout_on_exit: true,
        rule: Object.assign({ method: 'fixed', amount: 28, scale: 'days_per_week', scale_cap: 28, deduct_holidays: true, proration: 'join', rounding: 'half' }, PERIOD_CLOSE(5, 3)),
        note: '5.6 weeks a year (28 days for a five-day week, pro rata for fewer days), here including bank holidays: each bank holiday on a working day is taken from the allowance. Switch "Bank holidays come out of the allowance" off when bank holidays are given on top.',
      }),
      Object.assign({}, SICK, { code: 'sick', name: 'Sick leave (SSP)', attachment_after_days: 8, rule: { method: 'none' } }),
      Object.assign({}, PARENT, { code: 'maternity', name: 'Maternity leave', paid: true, statutory: true, gender_specific: 'female', max_consecutive_days: 364, rule: { method: 'none' }, note: 'Up to 52 weeks of statutory maternity leave (statutory maternity pay for up to 39 weeks).' }),
      Object.assign({}, PARENT, { code: 'paternity', name: 'Paternity leave', paid: true, statutory: true, max_consecutive_days: 14, rule: { method: 'none' }, note: 'One or two weeks of statutory paternity leave.' }),
      COMP(3, 'Time off in lieu'),
      UNPAID,
    ],
  },
  AU: {
    period_start: '07-01',
    policy: 'Australia National Employment Standards',
    types: [
      Object.assign({}, ANNUAL, { code: 'annual', name: 'Annual leave', statutory: true, allow_hours: true, encashable: true, payout_on_exit: true, rule: Object.assign({ method: 'monthly_accrual', amount: 20, accrual_day: 'daily', proration: 'join', rounding: 'none', scale: 'fte' }, PERIOD_CLOSE(-1, 0)), note: 'Four weeks a year for full-time staff, accruing progressively from the first day; the unused balance is paid on leaving (Fair Work Act section 90(2)).' }),
      Object.assign({}, SICK, { code: 'personal_carer', name: "Personal/carer's leave", statutory: true, allow_hours: true, rule: Object.assign({ method: 'monthly_accrual', amount: 10, accrual_day: 'daily', proration: 'join', rounding: 'none', scale: 'fte' }, PERIOD_CLOSE(-1, 0)) }),
      { code: 'compassionate', name: 'Compassionate leave', paid: true, color: 'ink', icon: 'flower', statutory: true, max_consecutive_days: 2, rule: { method: 'none' }, note: 'Two days each time a family or household member dies or has a life-threatening illness.' },
      { code: 'family_violence', name: 'Family and domestic violence leave', paid: true, color: 'ink', icon: 'shield', statutory: true, visibility: 'away', rule: Object.assign({ method: 'fixed', amount: 10, proration: 'none', rounding: 'none' }, PERIOD_CLOSE(0, 0)), note: '10 days of paid leave each year; shown to colleagues only as away.' },
      { code: 'long_service', name: 'Long service leave', paid: true, color: 'rh', icon: 'award', statutory: true, rule: { method: 'manual' }, note: 'Set by state and territory laws (often after 7 to 10 years of service): record each balance with an adjustment.' },
      COMP(3, 'Time off in lieu'),
      UNPAID,
    ],
  },
};

/** The generic set for a country without an entry: annual leave, sick leave, unpaid, compensatory. */
function generic(dataTypes) {
  const out = [];
  const has = (code) => dataTypes.some((t) => t.code === code);
  const paidDays = dataTypes.some((t) => t.paid !== false && Number(t.days) > 0 && !/sick|carer|medical/.test(t.code));
  if (!has('annual') && !paidDays) out.push(Object.assign({}, ANNUAL, { code: 'annual', name: 'Annual leave', rule: Object.assign({ method: 'fixed', amount: 20, proration: 'join', rounding: 'half' }, PERIOD_CLOSE(5, 3)), note: 'Set by you: 20 days a year by default.' }));
  if (!has('sick')) out.push(Object.assign({}, SICK, { code: 'sick', name: 'Sick leave', rule: Object.assign({ method: 'fixed', amount: 10, proration: 'join', rounding: 'half' }, PERIOD_CLOSE(0, 0)), note: 'Set by you: 10 days a year by default.' }));
  out.push(COMP(3));
  out.push(UNPAID);
  return out;
}

/** A type from the country data alone (no entry here for its code). */
function fromData(t) {
  const days = Number(t.days) || 0;
  const rule = days > 0 ? Object.assign({ method: 'fixed', amount: days, proration: 'join', rounding: 'half' }, PERIOD_CLOSE(0, 0)) : { method: 'none' };
  const sick = /sick|carer|medical/.test(t.code);
  return Object.assign({}, sick ? SICK : t.paid === false ? { color: 'ink', icon: 'calendar-off' } : ANNUAL, { code: t.code, name: t.name, paid: t.paid !== false, unit: t.unit === 'hour' ? 'hour' : 'day', statutory: t.statutory === true, region: t.region || '', rule: rule, note: t.note || '' });
}

/**
 * The defaults for an entity in `country` (`data`: the country data object or
 * null) and `region`: { period_start, policy, note, types: [type with rule] }.
 * Types tagged with a region apply only to an entity in that region.
 */
function forCountry(country, region, data) {
  const dataTypes = (data && Array.isArray(data.leave_types) ? data.leave_types : []).filter((t) => !t.region || t.region === region);
  const base = COUNTRIES[country];
  const list = base ? base.types.slice() : generic(dataTypes);
  const out = [];
  const seen = {};
  for (const t of list) {
    if (t.region && t.region !== region) continue;
    const d = dataTypes.filter((x) => x.code === t.code)[0];
    const merged = Object.assign({ unit: 'day' }, t);
    merged.payout_on_exit = Array.isArray(t.payout_on_exit) ? t.payout_on_exit.indexOf(region) >= 0 : t.payout_on_exit === true;
    if (d) {
      merged.name = d.name || merged.name;
      if (d.note) merged.note = d.note;
      if (d.statutory === true) merged.statutory = true;
    }
    out.push(merged);
    seen[t.code] = true;
  }
  for (const d of dataTypes) if (!seen[d.code]) out.push(fromData(d));
  const name = base ? base.policy : ((data && data.name) || country) + ' leave';
  return { period_start: base ? base.period_start : (data && data.fiscal_year_start) || '01-01', policy: name, note: base && base.note ? base.note : '', types: out };
}

module.exports = { ICONS: ICONS, COLORS: COLORS, COUNTRIES: COUNTRIES, forCountry: forCountry, generic: generic, fromData: fromData };
