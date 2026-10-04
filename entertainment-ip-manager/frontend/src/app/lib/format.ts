/**
 * Formatting: dates as calendar days (never shifted by time zones), money
 * with its currency, relative day phrasing, deadline severity. Everything
 * follows the reader's language ("22 Dec 2026" or "2026年12月22日").
 */
import type { DeadlineRec } from './records.ts';
import type { Tone } from './labels.ts';
import { isJa, t, tn } from './i18n.ts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86400000;

function locale(): string {
  return isJa() ? 'ja-JP' : 'en-GB';
}

/** "YYYY-MM-DD" from any PocketBase date string, '' when empty. */
export function d10(v: string | null | undefined): string {
  if (v === null || v === undefined) return '';
  const s = v.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

/** PocketBase date value for a calendar day. */
export function toPb(day: string): string {
  const d = d10(day);
  return d === '' ? '' : `${d} 00:00:00.000Z`;
}

/** The user's local calendar day. */
export function today(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

function utc(day: string): number {
  return Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
}

export function addDays(day: string, n: number): string {
  const d = d10(day);
  if (d === '') return '';
  const x = new Date(utc(d) + n * DAY_MS);
  return x.toISOString().slice(0, 10);
}

export function addMonths(day: string, n: number): string {
  const d = d10(day);
  if (d === '') return '';
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7)) - 1 + n;
  const ny = y + Math.floor(m / 12);
  const nm = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  const day2 = Math.min(Number(d.slice(8, 10)), last);
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(day2).padStart(2, '0')}`;
}

export function daysBetween(a: string, b: string): number {
  const x = d10(a);
  const y = d10(b);
  if (x === '' || y === '') return 0;
  return Math.round((utc(y) - utc(x)) / DAY_MS);
}

export function daysUntil(day: string): number {
  return daysBetween(today(), day);
}

/** "22 Dec 2026" / "2026年12月22日" */
export function fmtDate(v: string | null | undefined): string {
  const d = d10(v);
  if (d === '') return '';
  if (isJa()) return `${d.slice(0, 4)}年${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;
  return `${d.slice(8, 10)} ${MONTHS[Number(d.slice(5, 7)) - 1] ?? ''} ${d.slice(0, 4)}`;
}

/** "22 Dec" / "12月22日" in the current year, else with the year. */
export function fmtShort(v: string | null | undefined): string {
  const d = d10(v);
  if (d === '') return '';
  const sameYear = d.slice(0, 4) === today().slice(0, 4);
  if (isJa()) return sameYear ? `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日` : fmtDate(d);
  const base = `${d.slice(8, 10)} ${MONTHS[Number(d.slice(5, 7)) - 1] ?? ''}`;
  return sameYear ? base : `${base} ${d.slice(0, 4)}`;
}

/** "2026-04" to "Apr 2026" / "2026年4月". */
export function fmtMonth(ym: string): string {
  if (!/^\d{4}-\d{2}/.test(ym)) return ym;
  if (isJa()) return `${ym.slice(0, 4)}年${Number(ym.slice(5, 7))}月`;
  return `${MONTHS[Number(ym.slice(5, 7)) - 1] ?? ''} ${ym.slice(0, 4)}`;
}

export function weekdayName(v: string): string {
  const d = d10(v);
  if (d === '') return '';
  return new Date(utc(d)).toLocaleDateString(locale(), { weekday: 'long', timeZone: 'UTC' });
}

/** "in 4 days", "today", "3 days overdue" (and the Japanese equivalents). */
export function relLabel(v: string | null | undefined): string {
  const d = d10(v);
  if (d === '') return '';
  const n = daysUntil(d);
  if (n === 0) return t('today');
  if (n === 1) return t('tomorrow');
  if (n < 0) return tn(-n, '{n} day overdue', '{n} days overdue');
  if (n < 60) return tn(n, 'in {n} day', 'in {n} days');
  const months = Math.round(n / 30.4);
  if (months < 24) return tn(months, 'in {n} month', 'in {n} months');
  return tn(Math.round(n / 365), 'in {n} year', 'in {n} years');
}

/** "2 days ago", "just now" for past timestamps. */
export function ago(v: string | null | undefined): string {
  if (!v) return '';
  const ms = new Date(v.replace(' ', 'T')).getTime();
  if (Number.isNaN(ms)) return '';
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 1) return t('just now');
  if (min < 60) return t('{n} min ago', { n: min });
  const h = Math.round(min / 60);
  if (h < 24) return t('{n} h ago', { n: h });
  const days = Math.round(h / 24);
  if (days < 30) return tn(days, '{n} day ago', '{n} days ago');
  return fmtDate(v);
}

export function fmtDateTime(v: string | null | undefined): string {
  if (!v) return '';
  const x = new Date(v.replace(' ', 'T'));
  if (Number.isNaN(x.getTime())) return '';
  return x.toLocaleString(locale(), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const ZERO_DECIMALS = new Set(['JPY', 'KRW', 'TWD', 'VND', 'IDR']);

export function fmtMoney(amount: number | null | undefined, currency?: string): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '';
  const cur = (currency ?? '').toUpperCase();
  try {
    if (/^[A-Z]{3}$/.test(cur)) {
      return new Intl.NumberFormat(locale(), { style: 'currency', currency: cur, maximumFractionDigits: ZERO_DECIMALS.has(cur) ? 0 : 2 }).format(amount);
    }
  } catch {
    /* unknown currency code */
  }
  const s = amount.toLocaleString(locale(), { maximumFractionDigits: 2 });
  return cur ? `${cur} ${s}` : s;
}

export function fmtNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '';
  return n.toLocaleString(locale());
}

export function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '';
  return `${n.toLocaleString(locale(), { maximumFractionDigits: 2 })}%`;
}

/* ------------------------------------------------------------------ */
/* Deadline severity: computed from the binding date, shown in words.  */
/* ------------------------------------------------------------------ */

export type Severity = 'overdue' | 'critical' | 'soon' | 'upcoming' | 'later' | 'closed';

export interface SeverityInfo {
  severity: Severity;
  tone: Tone;
  label: string;
  days: number;
}

const STATUTORY = new Set(['hard', 'extendable', 'designated']);

export function isStatutory(kind: string): boolean {
  return STATUTORY.has(kind);
}

export function deadlineSeverity(d: Pick<DeadlineRec, 'status' | 'due_date' | 'kind' | 'target_date'>): SeverityInfo {
  if (d.status !== 'open') return { severity: 'closed', tone: 'neutral', label: t('Closed'), days: 0 };
  const due = d10(d.due_date);
  const days = daysUntil(due);
  const statutory = STATUTORY.has(d.kind);
  if (days < 0) return { severity: 'overdue', tone: 'bad', label: relLabel(due), days };
  if (days <= 7) return { severity: 'critical', tone: statutory ? 'bad' : 'warn', label: relLabel(due), days };
  if (days <= 30) return { severity: 'soon', tone: 'warn', label: relLabel(due), days };
  if (days <= 90) return { severity: 'upcoming', tone: 'info', label: relLabel(due), days };
  return { severity: 'later', tone: 'neutral', label: relLabel(due), days };
}

export function targetPassed(d: Pick<DeadlineRec, 'status' | 'target_date' | 'due_date'>): boolean {
  const tg = d10(d.target_date);
  return d.status === 'open' && tg !== '' && tg !== d10(d.due_date) && daysUntil(tg) < 0;
}

export type Window = 'overdue' | 'week' | 'd30' | 'd60' | 'd90' | 'later';

export function windowLabel(w: Window): string {
  return {
    overdue: t('Overdue'),
    week: t('This week'),
    d30: t('Next 30 days'),
    d60: t('31 to 60 days'),
    d90: t('61 to 90 days'),
    later: t('Later'),
  }[w];
}

export function windowOf(due: string): Window {
  const n = daysUntil(due);
  if (n < 0) return 'overdue';
  if (n <= 7) return 'week';
  if (n <= 30) return 'd30';
  if (n <= 60) return 'd60';
  if (n <= 90) return 'd90';
  return 'later';
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter((p) => p !== '');
  const first = parts[0]?.charAt(0) ?? '?';
  const second = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? '') : '';
  return (first + second).toUpperCase();
}
