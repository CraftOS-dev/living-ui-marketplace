/// <reference path="../pb_data/types.d.ts" />
/**
 * The overtime rules engine of the time module, pure JavaScript (no
 * PocketBase globals, so Node tests load it as is), plus the default rule
 * sets per country that a new entity gets.
 *
 * A rule set belongs to an entity: `rules` is a list of
 *   { when, threshold_min, multiplier, component, from, to, dow, note }
 * with `when` one of
 *   daily_over    minutes worked in a day above threshold_min
 *   weekly_over   regular minutes in the workweek above threshold_min (after daily overtime is taken out)
 *   monthly_over  overtime minutes in a calendar month above threshold_min move to this rule (Japan: over 60 hours)
 *   seventh_day   the seventh consecutive day worked in a workweek (California), minutes above threshold_min
 *   rest_day      minutes worked on a rest day (optionally only the weekdays in `dow`, 0 = Sunday)
 *   holiday       minutes worked on a public holiday, above threshold_min
 *   night         minutes worked between `from` and `to` (HH:MM); a premium paid on top of the other buckets
 * Rules with the same `when` are tiers: minutes between one threshold and
 * the next go to the lower tier. `multiplier` is the share of the hourly
 * rate paid for the minutes: 1.5 is time and a half (the minutes are no
 * longer regular); a night multiplier of 0.25 is a 25% premium on top.
 *
 * `settings` (all optional):
 *   tracking       'exception' (default: nobody has to clock; a working day without punches counts as worked)
 *                  | 'punch' (people clock in and out; a working day without punches is an absence)
 *   timesheets     'optional' (default) | 'required' (pay needs an approved timesheet for every week worked) | 'off'
 *   unapproved     'warning' | 'blocker' severity of a missing or unapproved timesheet (default: blocker when required)
 *   missing_punch  'warning' (default) | 'blocker'
 *   cap_severity   'warning' (default) | 'blocker' for the hard overtime limits
 *   preapproval    false (default) | true: overtime should be approved before it is worked
 *   counts_leave   false (default) | true: paid leave and holiday hours count toward the weekly threshold
 *   week_start     0 to 6 (default: the entity's week start)
 *   auto_break_after_min  360: deduct the scheduled break when nobody punched a break and the day is longer
 * `caps` (minutes, all optional): monthly_warn, monthly_limit, avg_limit
 * (average over any 2 to 6 months), yearly_warn, yearly_limit,
 * months_over_warn (how many months a year may pass monthly_warn),
 * year_start 'MM-DD'. Warn values and yearly_limit count overtime only;
 * monthly_limit and avg_limit count overtime plus rest-day work (the
 * Japanese 36 agreement rule).
 */

const WHEN = ['daily_over', 'weekly_over', 'monthly_over', 'seventh_day', 'rest_day', 'holiday', 'night'];
const OT_WHEN = ['daily_over', 'weekly_over', 'monthly_over', 'seventh_day'];
const SETTINGS_DEFAULT = {
  tracking: 'exception',
  timesheets: 'optional',
  unapproved: '',
  missing_punch: 'warning',
  cap_severity: 'warning',
  preapproval: false,
  counts_leave: false,
  week_start: null,
  auto_break_after_min: 360,
};
const CAP_KEYS = ['monthly_warn', 'monthly_limit', 'avg_limit', 'yearly_warn', 'yearly_limit', 'months_over_warn'];

function isTime(v) {
  return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

function isMmdd(v) {
  return typeof v === 'string' && /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v);
}

/** Check and normalise a rules list; throws an Error with `.field` naming the item. */
function normaliseRules(raw) {
  if (!Array.isArray(raw)) throw bad('rules must be a list of {when, threshold_min, multiplier, component}', 'rules');
  if (raw.length > 40) throw bad('A rule set has at most 40 rules.', 'rules');
  return raw.map((r, i) => {
    const where = 'rule ' + (i + 1);
    if (r === null || typeof r !== 'object' || Array.isArray(r)) throw bad(where + ' must be an object', 'rules');
    for (const k of Object.keys(r)) if (['when', 'threshold_min', 'multiplier', 'component', 'from', 'to', 'dow', 'note'].indexOf(k) < 0) throw bad(where + ': unknown key "' + k + '" (it takes when, threshold_min, multiplier, component, from, to, dow, note)', 'rules');
    if (WHEN.indexOf(r.when) < 0) throw bad(where + ': when is one of ' + WHEN.join(', '), 'rules');
    const t = r.threshold_min === undefined || r.threshold_min === null || r.threshold_min === '' ? 0 : Number(r.threshold_min);
    if (!Number.isInteger(t) || t < 0 || t > 50000) throw bad(where + ': threshold_min is whole minutes from 0', 'rules');
    const m = Number(r.multiplier);
    if (!Number.isFinite(m) || m < 0 || m > 10) throw bad(where + ': multiplier is a number from 0 to 10 (1.5 = time and a half; 0.25 = a 25% premium)', 'rules');
    const c = String(r.component || '').trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]{0,23}$/.test(c)) throw bad(where + ': component is a pay component code such as OT150', 'rules');
    const out = { when: r.when, threshold_min: t, multiplier: Math.round(m * 10000) / 10000, component: c };
    if (r.when === 'night') {
      if (!isTime(r.from) || !isTime(r.to)) throw bad(where + ': a night rule needs from and to as HH:MM, e.g. 22:00 and 05:00', 'rules');
      out.from = r.from;
      out.to = r.to;
    }
    if (r.dow !== undefined && r.dow !== null && r.dow !== '') {
      if (!Array.isArray(r.dow) || r.dow.some((d) => !Number.isInteger(Number(d)) || Number(d) < 0 || Number(d) > 6)) throw bad(where + ': dow is a list of weekdays 0 (Sunday) to 6', 'rules');
      out.dow = r.dow.map(Number);
    }
    if (r.note !== undefined && r.note !== null && String(r.note) !== '') out.note = String(r.note).slice(0, 300);
    return out;
  });
}

function normaliseSettings(raw) {
  const s = Object.assign({}, SETTINGS_DEFAULT);
  if (raw === undefined || raw === null) return s;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw bad('settings must be an object', 'settings');
  const enums = { tracking: ['exception', 'punch'], timesheets: ['optional', 'required', 'off'], unapproved: ['', 'warning', 'blocker'], missing_punch: ['warning', 'blocker'], cap_severity: ['warning', 'blocker'] };
  for (const k of Object.keys(raw)) {
    if (!(k in SETTINGS_DEFAULT)) throw bad('settings: unknown key "' + k + '" (it takes ' + Object.keys(SETTINGS_DEFAULT).join(', ') + ')', 'settings');
    const v = raw[k];
    if (enums[k]) {
      if (enums[k].indexOf(String(v)) < 0) throw bad('settings.' + k + ' is one of ' + enums[k].filter((x) => x !== '').join(', '), 'settings');
      s[k] = String(v);
    } else if (k === 'preapproval' || k === 'counts_leave') s[k] = v === true || v === 'true';
    else if (k === 'week_start') {
      if (v === null || v === '') s[k] = null;
      else {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 0 || n > 6) throw bad('settings.week_start is 0 (Sunday) to 6', 'settings');
        s[k] = n;
      }
    } else if (k === 'auto_break_after_min') {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 1440) throw bad('settings.auto_break_after_min is whole minutes', 'settings');
      s[k] = n;
    }
  }
  return s;
}

function normaliseCaps(raw) {
  const out = {};
  if (raw === undefined || raw === null) return out;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw bad('caps must be an object', 'caps');
  for (const k of Object.keys(raw)) {
    if (k === 'year_start') {
      if (raw[k] === '' || raw[k] === null) continue;
      if (!isMmdd(raw[k])) throw bad('caps.year_start is MM-DD, e.g. 04-01', 'caps');
      out.year_start = raw[k];
      continue;
    }
    if (CAP_KEYS.indexOf(k) < 0) throw bad('caps: unknown key "' + k + '" (it takes ' + CAP_KEYS.concat(['year_start']).join(', ') + ')', 'caps');
    if (raw[k] === '' || raw[k] === null) continue;
    const n = Number(raw[k]);
    if (!Number.isInteger(n) || n < 0 || n > 600000) throw bad('caps.' + k + ' is whole minutes (months_over_warn a count)', 'caps');
    out[k] = n;
  }
  return out;
}

function bad(message, field) {
  const err = new Error(message);
  err.status = 400;
  err.code = 'invalid_param';
  err.extra = { param: field };
  return err;
}

/* -------------------------------------------------------------- days */

function utc(d) {
  return Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
}

function dayAdd(d, n) {
  const x = new Date(utc(d) + n * 86400000);
  const p = (v) => (v < 10 ? '0' + v : String(v));
  return x.getUTCFullYear() + '-' + p(x.getUTCMonth() + 1) + '-' + p(x.getUTCDate());
}

function weekday(d) {
  return new Date(utc(d)).getUTCDay();
}

/** The first day of the workweek holding `d`. */
function weekStartOf(d, ws) {
  const back = (weekday(d) - (ws || 0) + 7) % 7;
  return dayAdd(d, -back);
}

/* ---------------------------------------------------------- classify */

function tiersOf(rules, when) {
  return rules.filter((r) => r.when === when).sort((a, b) => a.threshold_min - b.threshold_min);
}

/** Split `minutes` into tiers: [{ rule, minutes }] for the part above each threshold, up to the next. */
function splitTiers(minutes, tiers) {
  const out = [];
  for (let i = 0; i < tiers.length; i++) {
    const lo = tiers[i].threshold_min;
    const hi = i + 1 < tiers.length ? tiers[i + 1].threshold_min : Infinity;
    const m = Math.max(0, Math.min(minutes, hi) - lo);
    if (m > 0) out.push({ rule: tiers[i], minutes: m });
  }
  return out;
}

/** Minutes of the interval (a, b) inside (lo, hi). */
function overlap(a, b, lo, hi) {
  return Math.max(0, Math.min(b, hi) - Math.max(a, lo));
}

function addPart(res, rule, minutes, when) {
  if (minutes <= 0) return;
  for (const p of res.parts) {
    if (p.component === rule.component && p.multiplier === rule.multiplier && p.when === when) {
      p.minutes += minutes;
      return;
    }
  }
  res.parts.push({ component: rule.component, multiplier: rule.multiplier, minutes: minutes, when: when });
}

/**
 * Classify worked minutes into regular and overtime buckets.
 *
 *   days: [{ day, kind: 'work'|'rest'|'holiday', worked, night, leave }] in day order
 *         (leave: paid leave or holiday minutes, counted toward the weekly
 *         threshold only when counts_leave)
 *   opts: { week_start, counts_leave }
 *
 * Returns [{ day, regular, parts: [{ component, multiplier, minutes, when }] }]
 * where the night premium is a part of its own (it does not reduce regular).
 */
function classify(days, rules, opts) {
  const o = opts || {};
  const ws = o.week_start || 0;
  const daily = tiersOf(rules, 'daily_over');
  const weekly = tiersOf(rules, 'weekly_over');
  const monthly = tiersOf(rules, 'monthly_over');
  const seventh = tiersOf(rules, 'seventh_day');
  const hol = tiersOf(rules, 'holiday');
  const rest = rules.filter((r) => r.when === 'rest_day');
  const night = rules.filter((r) => r.when === 'night')[0] || null;
  const out = [];
  const byDay = {};
  // Each day's number (days since 1970-01-01, a Thursday), weekday and
  // workweek start (as a day number), worked out once: every pass asks.
  const dnOf = {};
  const wkOf = {};
  const dowOf = {};
  const weekOf = (day) => {
    if (wkOf[day] === undefined) {
      const dn = Math.round(utc(day) / 86400000);
      const dw = (((dn + 4) % 7) + 7) % 7;
      dnOf[day] = dn;
      dowOf[day] = dw;
      wkOf[day] = dn - ((dw - (ws || 0) + 7) % 7);
    }
    return wkOf[day];
  };
  const restBy = {};
  const restOn = (dow) => {
    if (restBy[dow] === undefined) restBy[dow] = rest.filter((r) => !r.dow || r.dow.indexOf(dow) >= 0).sort((a, b) => a.threshold_min - b.threshold_min);
    return restBy[dow];
  };
  for (const d of days) {
    const res = { day: d.day, kind: d.kind, regular: Math.max(0, d.worked || 0), parts: [] };
    out.push(res);
    byDay[d.day] = res;
  }
  // Consecutive days worked inside each workweek (for seventh_day).
  const workedInWeek = {};
  for (const d of days) {
    const wk = weekOf(d.day);
    if (workedInWeek[wk] === undefined) workedInWeek[wk] = {};
    if ((d.worked || 0) > 0) workedInWeek[wk][dnOf[d.day]] = true;
  }
  const isSeventh = (day) => {
    const wk = weekOf(day);
    if (wk + 6 !== dnOf[day]) return false;
    for (let i = 0; i < 7; i++) if (!workedInWeek[wk][wk + i]) return false;
    return true;
  };
  // 1. Day rules: holiday, rest day, seventh day, else daily.
  for (const d of days) {
    const res = byDay[d.day];
    const w = res.regular;
    if (w <= 0) continue;
    let tiers = null;
    let when = '';
    weekOf(d.day);
    const restTiers = restOn(dowOf[d.day]);
    if (d.kind === 'holiday' && hol.length > 0) {
      tiers = hol;
      when = 'holiday';
    } else if (d.kind === 'rest' && restTiers.length > 0) {
      tiers = restTiers;
      when = 'rest_day';
    } else if (seventh.length > 0 && isSeventh(d.day)) {
      tiers = seventh;
      when = 'seventh_day';
    } else if (daily.length > 0) {
      tiers = daily;
      when = 'daily_over';
    }
    if (tiers === null) continue;
    for (const s of splitTiers(w, tiers)) {
      addPart(res, s.rule, s.minutes, when);
      res.regular -= s.minutes;
    }
  }
  // 2. Weekly threshold on the regular minutes left.
  if (weekly.length > 0) {
    const cum = {};
    for (const d of days) {
      const res = byDay[d.day];
      const wk = weekOf(d.day);
      if (cum[wk] === undefined) cum[wk] = 0;
      if (o.counts_leave && (d.leave || 0) > 0) cum[wk] += d.leave;
      const before = cum[wk];
      const after = before + res.regular;
      for (let i = 0; i < weekly.length; i++) {
        const lo = weekly[i].threshold_min;
        const hi = i + 1 < weekly.length ? weekly[i + 1].threshold_min : Infinity;
        const m = overlap(before, after, lo, hi);
        if (m > 0) {
          addPart(res, weekly[i], m, 'weekly_over');
          res.regular -= m;
        }
      }
      cum[wk] = after;
    }
  }
  // 3. Monthly: overtime minutes beyond the month's threshold move to the monthly tier.
  if (monthly.length > 0) {
    const cum = {};
    for (const d of days) {
      const res = byDay[d.day];
      const mo = d.day.slice(0, 7);
      if (cum[mo] === undefined) cum[mo] = 0;
      const moved = [];
      for (const p of res.parts) {
        if (p.when !== 'daily_over' && p.when !== 'weekly_over' && p.when !== 'seventh_day') continue;
        const before = cum[mo];
        const after = before + p.minutes;
        for (let i = 0; i < monthly.length; i++) {
          const lo = monthly[i].threshold_min;
          const hi = i + 1 < monthly.length ? monthly[i + 1].threshold_min : Infinity;
          const m = overlap(before, after, lo, hi);
          if (m > 0) {
            p.minutes -= m;
            moved.push({ rule: monthly[i], minutes: m });
          }
        }
        cum[mo] = after;
      }
      res.parts = res.parts.filter((p) => p.minutes > 0);
      for (const mv of moved) addPart(res, mv.rule, mv.minutes, 'monthly_over');
    }
  }
  // 4. Night premium on top.
  if (night !== null) {
    for (const d of days) if ((d.night || 0) > 0) addPart(byDay[d.day], night, Math.min(d.night, Math.max(0, d.worked || 0)), 'night');
  }
  return out;
}

/** The night window of a rule set ({ from, to }) or null. */
function nightWindow(rules) {
  const n = (rules || []).filter((r) => r.when === 'night')[0];
  return n ? { from: n.from, to: n.to } : null;
}

/**
 * Overtime limit checks for one month (36 agreement style). `months` maps
 * 'YYYY-MM' to { ot, rest } minutes (overtime classified by the daily,
 * weekly, monthly and seventh-day rules; rest-day work) for the month and
 * the months before it; `month` is the month checked; `yearMonths` lists
 * the months of the agreement year up to `month`.
 * Returns [{ code, message, severity, minutes, limit }].
 */
function capIssues(caps, months, month, yearMonths, severity) {
  const out = [];
  const h = (m) => Math.round((m / 60) * 10) / 10;
  const cur = months[month] || { ot: 0, rest: 0 };
  if (caps.monthly_warn !== undefined && cur.ot > caps.monthly_warn) out.push({ code: 'ot_month_over_warn', message: 'Overtime this month is ' + h(cur.ot) + ' h, over the ' + h(caps.monthly_warn) + ' h monthly limit (allowed only under a special clause).', severity: 'warning', minutes: cur.ot, limit: caps.monthly_warn });
  if (caps.monthly_limit !== undefined && cur.ot + cur.rest >= caps.monthly_limit) out.push({ code: 'ot_month_over_limit', message: 'Overtime and rest-day work this month is ' + h(cur.ot + cur.rest) + ' h, at or over the ' + h(caps.monthly_limit) + ' h ceiling.', severity: severity, minutes: cur.ot + cur.rest, limit: caps.monthly_limit });
  if (caps.avg_limit !== undefined) {
    const keys = Object.keys(months).sort();
    const idx = keys.indexOf(month);
    if (idx >= 0) {
      for (let n = 2; n <= 6 && idx - n + 1 >= 0; n++) {
        let t = 0;
        for (let i = idx - n + 1; i <= idx; i++) t += (months[keys[i]].ot || 0) + (months[keys[i]].rest || 0);
        const avg = t / n;
        if (avg > caps.avg_limit) {
          out.push({ code: 'ot_average_over_limit', message: 'Average overtime and rest-day work over the last ' + n + ' months is ' + h(avg) + ' h, over the ' + h(caps.avg_limit) + ' h average limit.', severity: severity, minutes: Math.round(avg), limit: caps.avg_limit });
          break;
        }
      }
    }
  }
  if (yearMonths && yearMonths.length > 0) {
    let year = 0;
    let over = 0;
    for (const m of yearMonths) {
      const v = months[m] || { ot: 0, rest: 0 };
      year += v.ot;
      if (caps.monthly_warn !== undefined && v.ot > caps.monthly_warn) over++;
    }
    if (caps.yearly_warn !== undefined && year > caps.yearly_warn) out.push({ code: 'ot_year_over_warn', message: 'Overtime this agreement year is ' + h(year) + ' h, over the ' + h(caps.yearly_warn) + ' h yearly limit (allowed only under a special clause).', severity: 'warning', minutes: year, limit: caps.yearly_warn });
    if (caps.yearly_limit !== undefined && year > caps.yearly_limit) out.push({ code: 'ot_year_over_limit', message: 'Overtime this agreement year is ' + h(year) + ' h, over the ' + h(caps.yearly_limit) + ' h ceiling.', severity: severity, minutes: year, limit: caps.yearly_limit });
    if (caps.months_over_warn !== undefined && over > caps.months_over_warn) out.push({ code: 'ot_months_over_warn', message: over + ' months this agreement year passed the monthly limit; at most ' + caps.months_over_warn + ' may.', severity: 'warning', minutes: over, limit: caps.months_over_warn });
  }
  return out;
}

/* ------------------------------------------------------ country defaults */

/**
 * The default rule set for a new entity, by country (and region). These are
 * editable starting points, not legal advice; each carries its notes.
 */
function defaultsFor(country, region) {
  const cc = String(country || '').toUpperCase();
  const rg = String(region || '').toUpperCase();
  if (cc === 'US') {
    const rules = [{ when: 'weekly_over', threshold_min: 2400, multiplier: 1.5, component: 'OT150', note: 'FLSA: time and a half over 40 hours in the workweek' }];
    let notes = 'United States (FLSA): non-exempt employees get time and a half for hours over 40 in a workweek. Exempt employees need no overtime: give them a rule set of their own (applies) with no rules.';
    if (rg === 'CA') {
      rules.unshift(
        { when: 'daily_over', threshold_min: 480, multiplier: 1.5, component: 'OT150', note: 'California: over 8 hours in a day' },
        { when: 'daily_over', threshold_min: 720, multiplier: 2, component: 'OT200', note: 'California: over 12 hours in a day' },
        { when: 'seventh_day', threshold_min: 0, multiplier: 1.5, component: 'OT150', note: 'California: the first 8 hours of the seventh consecutive day in a workweek' },
        { when: 'seventh_day', threshold_min: 480, multiplier: 2, component: 'OT200', note: 'California: over 8 hours on the seventh consecutive day' },
      );
      notes += ' California adds daily overtime (over 8 hours 1.5x, over 12 hours 2x) and the seventh-day rule; weekly overtime counts only hours that are not already daily overtime.';
    }
    return { name: cc + (rg === 'CA' ? '-CA' : '') + ' overtime', rules: rules, settings: { tracking: 'exception', timesheets: 'optional' }, caps: {}, notes: notes };
  }
  if (cc === 'JP') {
    return {
      name: 'JP overtime (Labour Standards Act)',
      rules: [
        { when: 'daily_over', threshold_min: 480, multiplier: 1.25, component: 'OT125', note: 'Over 8 hours a day: 25% premium' },
        { when: 'weekly_over', threshold_min: 2400, multiplier: 1.25, component: 'OT125', note: 'Over 40 hours a week: 25% premium' },
        { when: 'monthly_over', threshold_min: 3600, multiplier: 1.5, component: 'OT150', note: 'Overtime beyond 60 hours a month: 50% premium (all employers since April 2023)' },
        { when: 'rest_day', threshold_min: 0, multiplier: 1.35, component: 'OT135', dow: [0], note: 'Statutory rest day (Sunday by default; change dow to your work rules): 35% premium' },
        { when: 'night', threshold_min: 0, multiplier: 0.25, component: 'NIGHT25', from: '22:00', to: '05:00', note: 'Late night 22:00 to 05:00: 25% premium on top' },
      ],
      settings: { tracking: 'exception', timesheets: 'optional', cap_severity: 'warning' },
      caps: { monthly_warn: 2700, monthly_limit: 6000, avg_limit: 4800, yearly_warn: 21600, yearly_limit: 43200, months_over_warn: 6, year_start: '04-01' },
      notes: 'Japan: 25% over 8 hours a day or 40 a week, 50% beyond 60 hours of overtime a month, 35% on the statutory rest day, 25% late night (added to the others). The 36 agreement limits are shown as warnings: 45 hours a month and 360 a year normally; with a special clause under 100 hours a month and an 80 hour average over 2 to 6 months (both including rest-day work), 720 hours a year, and at most 6 months a year over 45 hours. Set year_start to your agreement start.',
    };
  }
  if (cc === 'SG') {
    return {
      name: 'SG overtime (Employment Act Part IV)',
      rules: [
        { when: 'daily_over', threshold_min: 540, multiplier: 1.5, component: 'OT150', note: 'Over 9 hours a day (5-day week); use 480 for a longer week' },
        { when: 'weekly_over', threshold_min: 2640, multiplier: 1.5, component: 'OT150', note: 'Over 44 hours a week' },
        { when: 'rest_day', threshold_min: 0, multiplier: 2, component: 'RD200', note: 'Rest day work at the employer\'s request is paid by the day (half or one day\'s pay); 2x hours approximates a full day. Check your contracts.' },
        { when: 'holiday', threshold_min: 0, multiplier: 2, component: 'PH200', note: 'Public holiday work: an extra day\'s pay; 2x hours approximates it' },
      ],
      settings: { tracking: 'exception', timesheets: 'optional' },
      caps: { monthly_limit: 4320 },
      notes: 'Singapore: employees under Part IV of the Employment Act (workmen and other employees under the monthly salary limits the Ministry of Manpower sets) get 1.5x their hourly basic rate for work beyond their normal hours (44 a week), at most 72 overtime hours a month. Rest-day and public-holiday pay is by the day; the 2x rules approximate it. Employees outside Part IV need no overtime: give them a rule set of their own.',
    };
  }
  if (cc === 'IN') {
    return {
      name: 'IN overtime (Factories and Shops Acts)',
      rules: [
        { when: 'daily_over', threshold_min: 540, multiplier: 2, component: 'OT200', note: 'Over 9 hours a day: twice the ordinary rate' },
        { when: 'weekly_over', threshold_min: 2880, multiplier: 2, component: 'OT200', note: 'Over 48 hours a week: twice the ordinary rate' },
      ],
      settings: { tracking: 'exception', timesheets: 'optional' },
      caps: {},
      notes: 'India: twice the ordinary rate beyond 9 hours a day or 48 a week (Factories Act; state Shops and Establishments Acts are similar). Quarterly overtime caps vary by state: add caps if yours sets them.',
    };
  }
  if (cc === 'MY') {
    return {
      name: 'MY overtime (Employment Act 1955)',
      rules: [
        { when: 'daily_over', threshold_min: 480, multiplier: 1.5, component: 'OT150', note: 'Normal working day: 1.5x beyond normal hours' },
        { when: 'weekly_over', threshold_min: 2700, multiplier: 1.5, component: 'OT150', note: 'Over 45 hours a week' },
        { when: 'rest_day', threshold_min: 0, multiplier: 2, component: 'OT200', note: 'Rest day: 2x' },
        { when: 'holiday', threshold_min: 0, multiplier: 2, component: 'PH200', note: 'Public holiday, normal hours: 2x (an extra day\'s pay on top of holiday pay)' },
        { when: 'holiday', threshold_min: 480, multiplier: 3, component: 'OT300', note: 'Public holiday beyond normal hours: 3x' },
      ],
      settings: { tracking: 'exception', timesheets: 'optional' },
      caps: { monthly_limit: 6240 },
      notes: 'Malaysia: overtime, rest-day and public-holiday rates (1.5x, 2x, 3x) apply to employees under the wage limit of the First Schedule and to manual workers; give others a rule set of their own. The monthly overtime limit is 104 hours.',
    };
  }
  if (cc === 'GB') {
    return { name: 'GB overtime', rules: [], settings: { tracking: 'exception', timesheets: 'optional' }, caps: {}, notes: 'United Kingdom: no statutory overtime premium (pay what the contract says; add rules for it). The Working Time Regulations cap the average working week at 48 hours over 17 weeks unless the worker opted out in writing.' };
  }
  if (cc === 'AU') {
    return {
      name: 'AU overtime (award placeholders)',
      rules: [
        { when: 'daily_over', threshold_min: 456, multiplier: 1.5, component: 'OT150', note: 'Placeholder: over 7.6 hours a day, first 2 hours 1.5x' },
        { when: 'daily_over', threshold_min: 576, multiplier: 2, component: 'OT200', note: 'Placeholder: after 2 hours of overtime, 2x' },
        { when: 'weekly_over', threshold_min: 2280, multiplier: 1.5, component: 'OT150', note: 'Placeholder: over 38 hours a week' },
        { when: 'rest_day', threshold_min: 0, multiplier: 2, component: 'SUN200', dow: [0], note: 'Placeholder: Sunday 2x' },
        { when: 'holiday', threshold_min: 0, multiplier: 2.5, component: 'PH250', note: 'Placeholder: public holiday 2.5x' },
      ],
      settings: { tracking: 'exception', timesheets: 'optional' },
      caps: {},
      notes: 'Australia: overtime and penalty rates come from the employee\'s modern award or agreement. These rules are placeholders to edit from your award (Clerks, Retail, Hospitality and others differ).',
    };
  }
  return { name: (cc || 'Default') + ' overtime', rules: [], settings: { tracking: 'exception', timesheets: 'optional' }, caps: {}, notes: 'No overtime rules were set for this country. Add the rules your law or contracts require.' };
}

module.exports = {
  WHEN: WHEN,
  OT_WHEN: OT_WHEN,
  SETTINGS_DEFAULT: SETTINGS_DEFAULT,
  CAP_KEYS: CAP_KEYS,
  normaliseRules: normaliseRules,
  normaliseSettings: normaliseSettings,
  normaliseCaps: normaliseCaps,
  classify: classify,
  splitTiers: splitTiers,
  nightWindow: nightWindow,
  capIssues: capIssues,
  defaultsFor: defaultsFor,
  weekStartOf: weekStartOf,
  dayAdd: dayAdd,
  weekday: weekday,
};
