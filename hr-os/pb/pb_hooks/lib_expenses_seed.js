/// <reference path="../pb_data/types.d.ts" />
/**
 * Expenses defaults for a new legal entity: the standard categories, a
 * common mileage rate per country (an editable default, never a statutory
 * claim), the receipt rule and the amount above which finance also
 * approves. Plain data plus two pure functions; nothing here touches the
 * database.
 *
 * Mileage rates are minor units of the entity currency per unit:
 *   US  72.5 cents a mile  (IRS business standard mileage rate for 2026)
 *   GB  45 pence a mile    (HMRC approved mileage allowance, first 10,000 miles)
 *   AU  88 cents a km      (ATO cents per kilometre method, 2024-25 and 2025-26)
 *   CA  72 cents a km      (CRA reasonable allowance, first 5,000 km, 2025)
 *   DE  30 cents a km      (Dienstreise Kilometerpauschale)
 *   SG, MY (60), JP (20 yen), IN (12 rupees) a km: a common company rate, no statutory one.
 *   Every other country starts at 0: the company sets its rate before the first mileage line.
 * People change them in Settings; a mileage line keeps the rate it used.
 */

const CATEGORIES = [
  { code: 'meals', name: 'Meals', icon: 'Utensils', description: 'Meals while working away or with colleagues.' },
  { code: 'travel', name: 'Travel', icon: 'Plane', description: 'Flights, trains, taxis, parking and tolls.' },
  { code: 'lodging', name: 'Lodging', icon: 'BedDouble', description: 'Hotels and other places to stay on business.' },
  { code: 'mileage', name: 'Mileage', icon: 'Car', kind: 'mileage', description: 'Business driving in your own vehicle, by distance.' },
  { code: 'phone_internet', name: 'Phone and internet', icon: 'Smartphone', description: 'Work calls, data and home internet for work.' },
  { code: 'training', name: 'Training', icon: 'GraduationCap', description: 'Courses, books, exams and conference fees.' },
  { code: 'office_supplies', name: 'Office supplies', icon: 'Paperclip', description: 'Stationery, small equipment and postage.' },
  { code: 'client_entertainment', name: 'Client entertainment', icon: 'Handshake', description: 'Meals and events with clients; name who attended.' },
  { code: 'other', name: 'Other', icon: 'Receipt', description: 'Anything that fits no other category.' },
];

// [rate in minor units per unit, unit]
const MILEAGE = {
  US: [72.5, 'mile'],
  GB: [45, 'mile'],
  AU: [88, 'km'],
  CA: [72, 'km'],
  DE: [30, 'km'],
  SG: [60, 'km'],
  MY: [60, 'km'],
  JP: [20, 'km'],
  IN: [1200, 'km'],
};

// Finance also approves a claim at or above this amount (major units of the currency).
const FINANCE_OVER = { USD: 1000, SGD: 1000, JPY: 100000, INR: 50000, MYR: 3000, GBP: 1000, EUR: 1000, AUD: 1500, CAD: 1500, NZD: 1500, HKD: 8000, CNY: 7000, KRW: 1300000, TWD: 30000, PHP: 50000, IDR: 15000000, THB: 35000, VND: 25000000, AED: 3500, SAR: 3500, CHF: 1000 };

// The United States: receipts are kept for 75 dollars and more (IRS accountable plans) and always for lodging.
const RECEIPT_OVER = { USD: 75 };

/** The standard categories for an entity of `country` paying in `currency` (minor-unit fields filled). */
function categoriesFor(country, currency, exponent) {
  const scale = Math.pow(10, exponent);
  const mileage = MILEAGE[String(country || '').toUpperCase()] || [0, 'km'];
  return CATEGORIES.map((c, i) => {
    const kind = c.kind || 'standard';
    let rule = 'always';
    let over = 0;
    if (kind === 'mileage') rule = 'never';
    else if (RECEIPT_OVER[currency] !== undefined && c.code !== 'lodging') {
      rule = 'over';
      over = Math.round(RECEIPT_OVER[currency] * scale);
    }
    return {
      code: c.code,
      name: c.name,
      icon: c.icon,
      description: c.description,
      kind: kind,
      limit_minor: 0,
      per_day_limit_minor: 0,
      receipt_rule: rule,
      receipt_over_minor: over,
      mileage_rate_minor: kind === 'mileage' ? mileage[0] : 0,
      unit: kind === 'mileage' ? mileage[1] : 'km',
      taxable: false,
      component: 'REIMB',
      gl_account: '',
      sort: (i + 1) * 10,
    };
  });
}

/** The default policy of an entity paying in `currency`. */
function policyFor(currency, exponent) {
  const scale = Math.pow(10, exponent);
  return {
    finance_over_minor: FINANCE_OVER[currency] !== undefined ? Math.round(FINANCE_OVER[currency] * scale) : 0,
    max_age_days: 90,
    flag_weekends: true,
    pay_via: 'payroll',
    advance_pay_via: 'bank',
    advance_recover_via: 'claim',
    recover_after_days: 30,
    note: '',
  };
}

module.exports = { CATEGORIES: CATEGORIES, MILEAGE: MILEAGE, FINANCE_OVER: FINANCE_OVER, categoriesFor: categoriesFor, policyFor: policyFor };
