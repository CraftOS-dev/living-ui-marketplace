/**
 * Formatting: dates as calendar days (never shifted by time zones), money
 * with its currency, relative day phrasing, deadline severity.
 */
import type { DeadlineRec } from './types.ts';
import type { Tone } from './labels.ts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86400000;

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

/** "22 Dec 2026" */
export function fmtDate(v: string | null | undefined): string {
  const d = d10(v);
  if (d === '') return '';
  return `${d.slice(8, 10)} ${MONTHS[Number(d.slice(5, 7)) - 1] ?? ''} ${d.slice(0, 4)}`;
}

/** "22 Dec" when in the current year, else "22 Dec 2027" */
export function fmtShort(v: string | null | undefined): string {
  const d = d10(v);
  if (d === '') return '';
  const sameYear = d.slice(0, 4) === today().slice(0, 4);
  const base = `${d.slice(8, 10)} ${MONTHS[Number(d.slice(5, 7)) - 1] ?? ''}`;
  return sameYear ? base : `${base} ${d.slice(0, 4)}`;
}

export function weekdayName(v: string): string {
  const d = d10(v);
  if (d === '') return '';
  return new Date(utc(d)).toLocaleDateString(undefined, { weekday: 'long', timeZone: 'UTC' });
}

/** "in 4 days", "today", "3 days overdue" */
export function relLabel(v: string | null | undefined): string {
  const d = d10(v);
  if (d === '') return '';
  const n = daysUntil(d);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return '1 day overdue';
  if (n < 0) return `${-n} days overdue`;
  if (n < 60) return `in ${n} days`;
  const months = Math.round(n / 30.4);
  if (months < 24) return `in ${months} months`;
  return `in ${Math.round(n / 365)} years`;
}

/** "2 days ago", "today" for past timestamps. */
export function ago(v: string | null | undefined): string {
  if (!v) return '';
  const t = new Date(v.replace(' ', 'T')).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const min = Math.round(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.round(h / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return fmtDate(v);
}

export function fmtDateTime(v: string | null | undefined): string {
  if (!v) return '';
  const t = new Date(v.replace(' ', 'T'));
  if (Number.isNaN(t.getTime())) return '';
  return t.toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function fmtMoney(amount: number | null | undefined, currency?: string): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '';
  const cur = (currency ?? '').toUpperCase();
  try {
    if (/^[A-Z]{3}$/.test(cur)) {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, maximumFractionDigits: cur === 'JPY' || cur === 'KRW' ? 0 : 2 }).format(amount);
    }
  } catch {
    /* unknown currency code */
  }
  const s = amount.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return cur ? `${cur} ${s}` : s;
}

export function fmtNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '';
  return n.toLocaleString();
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

export function deadlineSeverity(d: Pick<DeadlineRec, 'status' | 'due_date' | 'kind' | 'target_date'>): SeverityInfo {
  if (d.status !== 'open') return { severity: 'closed', tone: 'neutral', label: 'Closed', days: 0 };
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
  const t = d10(d.target_date);
  return d.status === 'open' && t !== '' && t !== d10(d.due_date) && daysUntil(t) < 0;
}

export type Window = 'overdue' | 'week' | 'd30' | 'd60' | 'd90' | 'later';

export const WINDOW_LABEL: Record<Window, string> = {
  overdue: 'Overdue',
  week: 'This week',
  d30: 'Next 30 days',
  d60: '31 to 60 days',
  d90: '61 to 90 days',
  later: 'Later',
};

export function windowOf(due: string): Window {
  const n = daysUntil(due);
  if (n < 0) return 'overdue';
  if (n <= 7) return 'week';
  if (n <= 30) return 'd30';
  if (n <= 60) return 'd60';
  if (n <= 90) return 'd90';
  return 'later';
}

export function plural(n: number, word: string, pluralWord?: string): string {
  return `${n} ${n === 1 ? word : (pluralWord ?? `${word}s`)}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter((p) => p !== '');
  const first = parts[0]?.charAt(0) ?? '?';
  const second = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? '') : '';
  return (first + second).toUpperCase();
}
