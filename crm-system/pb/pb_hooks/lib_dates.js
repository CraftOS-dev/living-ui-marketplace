/// <reference path="../pb_data/types.d.ts" />
/**
 * Book dates are text YYYY-MM-DD: a day in the books, not a moment, so no
 * time zone can move an entry into another month. Helpers here do calendar
 * arithmetic on them in UTC.
 */

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function pad(n) {
  return (n < 10 ? '0' : '') + n;
}

function fromDate(d) {
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
}

function toDate(s) {
  return new Date(Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10))));
}

/** Today in the computer's local calendar (what the person calls today). */
function today() {
  const d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function valid(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return fromDate(toDate(s)) === s;
}

/**
 * A date param: YYYY-MM-DD, or "today", "yesterday", "t-3" (Xero style),
 * or a full ISO timestamp (its date part).
 */
function parse(v, name, dflt) {
  let s = String(v === undefined || v === null ? '' : v).trim();
  if (s === '') {
    if (dflt !== undefined) return dflt;
    throw fail(400, name + ' is required, written YYYY-MM-DD');
  }
  const low = s.toLowerCase();
  if (low === 'today' || low === 't') return today();
  if (low === 'yesterday') return addDays(today(), -1);
  const rel = /^t([+-]\d+)$/.exec(low);
  if (rel) return addDays(today(), Number(rel[1]));
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) s = s.slice(0, 10);
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(s)) s = s.replace(/\//g, '-');
  if (!valid(s)) throw fail(400, name + ' must be a date written YYYY-MM-DD (got "' + v + '")');
  return s;
}

function addDays(s, n) {
  const d = toDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return fromDate(d);
}

/** Add months, clamping to the month's last day (Jan 31 + 1 month = Feb 28/29). */
function addMonths(s, n) {
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7)) - 1 + n;
  const day = Number(s.slice(8, 10));
  const ty = y + Math.floor(m / 12);
  const tm = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return ty + '-' + pad(tm + 1) + '-' + pad(Math.min(day, last));
}

function daysBetween(a, b) {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86400000);
}

function monthStart(s) {
  return s.slice(0, 8) + '01';
}

function monthEnd(s) {
  const d = toDate(monthStart(s));
  return fromDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}

/** First day of the fiscal year containing s (fyStart = 1..12). */
function fiscalYearStart(s, fyStart) {
  const m = Number(s.slice(5, 7));
  const fy = fyStart >= 1 && fyStart <= 12 ? fyStart : 1;
  const y = Number(s.slice(0, 4)) - (m < fy ? 1 : 0);
  return y + '-' + pad(fy) + '-01';
}

/** "2026-10" for a date. */
function period(s) {
  return s.slice(0, 7);
}

function periodBounds(p) {
  if (!/^\d{4}-\d{2}$/.test(p)) throw fail(400, 'period must be written YYYY-MM');
  return { from: p + '-01', to: monthEnd(p + '-01') };
}

/** Named ranges used by reports and filters. */
function range(name, fyStart, ref) {
  const t = ref || today();
  switch (name) {
    case 'this_month':
      return { from: monthStart(t), to: monthEnd(t) };
    case 'last_month': {
      const s = addMonths(monthStart(t), -1);
      return { from: s, to: monthEnd(s) };
    }
    case 'this_quarter': {
      const m = Number(t.slice(5, 7));
      const qs = t.slice(0, 4) + '-' + pad(Math.floor((m - 1) / 3) * 3 + 1) + '-01';
      return { from: qs, to: monthEnd(addMonths(qs, 2)) };
    }
    case 'last_quarter': {
      const m = Number(t.slice(5, 7));
      const qs = addMonths(t.slice(0, 4) + '-' + pad(Math.floor((m - 1) / 3) * 3 + 1) + '-01', -3);
      return { from: qs, to: monthEnd(addMonths(qs, 2)) };
    }
    case 'this_year': {
      const s = fiscalYearStart(t, fyStart);
      return { from: s, to: addDays(addMonths(s, 12), -1) };
    }
    case 'last_year': {
      const s = addMonths(fiscalYearStart(t, fyStart), -12);
      return { from: s, to: addDays(addMonths(s, 12), -1) };
    }
    case 'ytd':
      return { from: fiscalYearStart(t, fyStart), to: t };
    case 'last_12_months':
      return { from: addMonths(monthStart(t), -11), to: monthEnd(t) };
    default:
      return null;
  }
}

/** The same span shifted back: the previous period of equal length or the same period last year. */
function compareRange(from, to, mode) {
  if (mode === 'previous_year') return { from: addMonths(from, -12), to: addMonths(to, -12) };
  // Whole months shift by months, other spans by days.
  if (from.slice(8) === '01' && to === monthEnd(to)) {
    const months = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7)) + 1;
    const f = addMonths(from, -months);
    return { from: f, to: monthEnd(addMonths(f, months - 1)) };
  }
  const n = daysBetween(from, to) + 1;
  return { from: addDays(from, -n), to: addDays(to, -n) };
}

module.exports = {
  today: today,
  valid: valid,
  parse: parse,
  addDays: addDays,
  addMonths: addMonths,
  daysBetween: daysBetween,
  monthStart: monthStart,
  monthEnd: monthEnd,
  fiscalYearStart: fiscalYearStart,
  period: period,
  periodBounds: periodBounds,
  range: range,
  compareRange: compareRange,
};
