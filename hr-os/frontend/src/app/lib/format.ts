/**
 * Days, times and names as people read them. Days travel as 'YYYY-MM-DD'
 * text and are never shifted by the browser's time zone (they are read at
 * noon local). Timestamps are PocketBase UTC dates ("2026-11-04 08:02:09.874Z").
 *
 * ONE date style for the whole app, the company's (Settings, Company, Date
 * style) or, when that is "entity", the legal entity's country format:
 *
 *   style   fmtDay('2026-11-16')   no year     fmtRange same month   time()
 *   dmy     16 Nov 2026            16 Nov      16 to 18 Nov          14:05
 *   mdy     Nov 16, 2026           Nov 16      Nov 16 to 18          2:05 PM
 *   ymd     2026/11/16             11/16       11/16 to 11/18        14:05
 *   iso     2026-11-16             11-16       11-16 to 11-18        14:05
 *
 * The entity is the one passed ({ entity: id } or { country: 'JP' }), else
 * the sidebar's selected entity, else the viewer's own (their employment's),
 * else the first one. Every module formats days and times with these helpers
 * only (fmtDay, fmtRange, fmtMonth, fmtDateTime, time, ago, relDay); never
 * toLocaleDateString, never an ISO day on screen.
 *
 * Time zones: a timestamp (PocketBase UTC) is read in that same entity's time
 * zone, so "today" and the day of a timestamp are the office's, not UTC's or
 * the browser's: `today()`, `dayOf(ts)`, and fmtDay / time / ago given a
 * timestamp. Never `toISOString().slice(0, 10)` or `created.slice(0, 10)`.
 */
import { t, tn } from './i18n.ts';
import { getUi } from './store.tsx';

/* ------------------------------------------------------------ date style */

export type DateOrder = 'dmy' | 'mdy' | 'ymd' | 'iso';

const STYLE_PATTERN: Record<string, string> = { iso: 'YYYY-MM-DD', dmy: 'DD/MM/YYYY', mdy: 'MM/DD/YYYY', ymd: 'YYYY/MM/DD' };

let companyStyle = 'entity';
let firstEntity = '';
let viewerEntity = '';
const entityPattern = new Map<string, string>();
const entityZone = new Map<string, string>();
const countryPattern = new Map<string, string>();
let styleVersion = 0;

/**
 * The session sets these: the company's style, the entities (country and time
 * zone), the countries' formats, and the viewer's own entity (their primary
 * employment's; '' for a sign-in without one).
 */
export function setDateStyles(style: string, entities: { id: string; country: string; timezone?: string | undefined }[], countries?: Record<string, string> | undefined, viewer = ''): void {
  companyStyle = style === '' ? 'entity' : style;
  viewerEntity = viewer;
  entityZone.clear();
  for (const e of entities) if (e.timezone !== undefined && e.timezone !== '') entityZone.set(e.id, e.timezone);
  if (countries !== undefined) {
    countryPattern.clear();
    for (const [c, f] of Object.entries(countries)) countryPattern.set(c.toUpperCase(), f);
  }
  entityPattern.clear();
  for (const e of entities) {
    const f = countryPattern.get(e.country.toUpperCase());
    if (f !== undefined) entityPattern.set(e.id, f);
  }
  firstEntity = entities[0]?.id ?? '';
  styleVersion++;
}

/** Changes when the date style changes (a key for memoised text). */
export function dateStyleVersion(): number {
  return styleVersion;
}

export interface DateFor {
  /** The legal entity whose country format applies (when the company style is "entity"). */
  entity?: string | undefined;
  /** A country code instead of an entity. */
  country?: string | undefined;
}

function patternFor(f: DateFor = {}): string {
  if (companyStyle !== 'entity') return STYLE_PATTERN[companyStyle] ?? STYLE_PATTERN['dmy'] ?? 'DD/MM/YYYY';
  if (f.country !== undefined && f.country !== '') {
    const c = countryPattern.get(f.country.toUpperCase());
    if (c !== undefined) return c;
  }
  return entityPattern.get(entityFor(f)) ?? entityPattern.get(firstEntity) ?? 'DD/MM/YYYY';
}

/** The entity a date belongs to: the one given, the sidebar's, the viewer's own, the first. */
function entityFor(f: DateFor): string {
  if (f.entity !== undefined && f.entity !== '') return f.entity;
  const ui = getUi().entity;
  if (ui !== '') return ui;
  if (viewerEntity !== '') return viewerEntity;
  return firstEntity;
}

/** The time zone timestamps are read in (that entity's, else the first entity's, else the browser's). */
export function zoneFor(f: DateFor = {}): string | undefined {
  return entityZone.get(entityFor(f)) ?? entityZone.get(firstEntity);
}

const zoneDays = new Map<string, Intl.DateTimeFormat>();
/** The calendar day of a moment in a time zone: "2026-11-05". */
function dayIn(n: number, zone: string | undefined): string {
  if (zone === undefined) return dayKey(new Date(n));
  let f = zoneDays.get(zone);
  if (f === undefined) {
    try {
      f = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
    } catch {
      return dayKey(new Date(n));
    }
    zoneDays.set(zone, f);
  }
  const p = f.formatToParts(new Date(n));
  const g = (k: string): string => p.find((x) => x.type === k)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')}`;
}

/** Today in the entity's time zone ("2026-11-05" in Tokyo while UTC is still on the 4th). */
export function today(f: DateFor = {}): string {
  return dayIn(Date.now(), zoneFor(f));
}

/** The day of a timestamp in the entity's time zone (a 'YYYY-MM-DD' day comes back as it is). */
export function dayOf(v: string | null | undefined, f: DateFor = {}): string {
  if (v === null || v === undefined || v === '') return '';
  if (v.length === 10) return v;
  const n = ms(v);
  return n === 0 ? '' : dayIn(n, zoneFor(f));
}

/** The order and separator the style uses ("DD.MM.YYYY" -> dmy with "."). */
export function dateOrder(f: DateFor = {}): { order: DateOrder; sep: string } {
  const p = patternFor(f);
  if (p === 'YYYY-MM-DD') return { order: 'iso', sep: '-' };
  const sep = /[^A-Z]/.exec(p)?.[0] ?? '/';
  if (p.startsWith('YYYY')) return { order: 'ymd', sep };
  if (p.startsWith('MM')) return { order: 'mdy', sep };
  return { order: 'dmy', sep };
}

const MON = (m: number): string => new Date(2026, m, 1).toLocaleDateString('en', { month: 'short' });
const WEEKDAY = (d: Date): string => d.toLocaleDateString('en', { weekday: 'short' });

function partsOf(d: Date, order: DateOrder, sep: string, year: boolean): string {
  const y = String(d.getFullYear());
  const m2 = String(d.getMonth() + 1).padStart(2, '0');
  const d2 = String(d.getDate()).padStart(2, '0');
  if (order === 'iso') return year ? `${y}-${m2}-${d2}` : `${m2}-${d2}`;
  if (order === 'ymd') return year ? `${y}${sep}${m2}${sep}${d2}` : `${m2}${sep}${d2}`;
  if (order === 'mdy') return year ? `${MON(d.getMonth())} ${d.getDate()}, ${y}` : `${MON(d.getMonth())} ${d.getDate()}`;
  return year ? `${d.getDate()} ${MON(d.getMonth())} ${y}` : `${d.getDate()} ${MON(d.getMonth())}`;
}

export function ms(v: string | null | undefined): number {
  if (v === undefined || v === null || v === '') return 0;
  const s = v.length === 10 ? v + 'T12:00:00' : v.replace(' ', 'T');
  const n = Date.parse(s);
  return Number.isFinite(n) ? n : 0;
}

/** A calendar day key: "2026-11-04". Without a date: today in the viewer's entity's time zone (see today()). */
export function dayKey(d?: Date): string {
  if (d === undefined) return today();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function isDay(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T12:00:00'));
}

export function dateOf(day: string): Date {
  return new Date(day + 'T12:00:00');
}

export function addDays(day: string, n: number): string {
  const d = dateOf(day);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

export function addMonths(day: string, n: number): string {
  const d = dateOf(day);
  const want = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(want, last));
  return dayKey(d);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((dateOf(b).getTime() - dateOf(a).getTime()) / 86400000);
}

export function startOfMonth(day: string): string {
  return day.slice(0, 8) + '01';
}

/** A day in the date style: "16 Nov 2026", "Nov 16, 2026", "2026/11/16" (the year only when it is not this year, unless asked). */
export function fmtDay(day: string | null | undefined, opts: { year?: 'always' | 'auto' | 'never'; weekday?: boolean } & DateFor = {}): string {
  if (day === null || day === undefined || day === '') return '';
  // A timestamp is shown as its day in the entity's time zone.
  const key = day.length > 10 ? dayOf(day, opts) : day;
  const n = ms(key);
  if (n === 0) return day;
  const d = new Date(n);
  const { order, sep } = dateOrder(opts);
  const showYear = opts.year === 'always' || (opts.year !== 'never' && d.getFullYear() !== new Date().getFullYear());
  const text = partsOf(d, order, sep, showYear);
  if (opts.weekday !== true) return text;
  return order === 'mdy' ? `${WEEKDAY(d)}, ${text}` : `${WEEKDAY(d)} ${text}`;
}

/** Two days in the date style: "16 to 18 Nov", "Nov 16 to 18", "30 Nov to 2 Dec", "11/16 to 11/18". */
export function fmtRange(from: string, to: string, f: DateFor = {}): string {
  if (from === '' && to === '') return '';
  if (to === '' || from === to) return fmtDay(from, f);
  if (from === '') return t('format.until', { day: fmtDay(to, f) });
  const a = dateOf(from);
  const b = dateOf(to);
  const { order } = dateOrder(f);
  const thisYear = new Date().getFullYear();
  const sameYear = a.getFullYear() === b.getFullYear();
  const yearTo = b.getFullYear() !== thisYear || !sameYear;
  if (sameYear && a.getMonth() === b.getMonth() && (order === 'dmy' || order === 'mdy')) {
    const end = fmtDay(to, { ...f, year: yearTo ? 'always' : 'never' });
    // "16 to 18 Nov 2026" and "Nov 16 to 18, 2026" keep the month once.
    if (order === 'dmy') return t('format.range', { from: String(a.getDate()), to: end });
    const y = yearTo ? `, ${b.getFullYear()}` : '';
    return t('format.range', { from: fmtDay(from, { ...f, year: 'never' }), to: String(b.getDate()) + y });
  }
  // Year-first styles carry the year on the first day, the others on the last.
  const yearFirst = order === 'ymd' || order === 'iso';
  const fromYear = !sameYear || (yearFirst && yearTo);
  const toYear = !sameYear || (!yearFirst && yearTo);
  return t('format.range', { from: fmtDay(from, { ...f, year: fromYear ? 'always' : 'never' }), to: fmtDay(to, { ...f, year: toYear ? 'always' : 'never' }) });
}

/** A month in the date style: "Nov 2026" ("2026/11" for year-first styles). */
export function fmtMonth(month: string, f: DateFor = {}): string {
  if (month === '') return '';
  const d = dateOf(month.length === 7 ? month + '-01' : month);
  const { order, sep } = dateOrder(f);
  if (order === 'iso') return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  if (order === 'ymd') return `${d.getFullYear()}${sep}${String(d.getMonth() + 1).padStart(2, '0')}`;
  return `${MON(d.getMonth())} ${d.getFullYear()}`;
}

/* --------------------------------------------------------- timestamps */

/**
 * A PocketBase timestamp ("2026-11-04 20:30:00.000Z") as its day key in the
 * entity's time zone ("2026-11-05" in Tokyo), for grouping and comparing. A
 * 'YYYY-MM-DD' day comes back as it is, '' for nothing. Use it wherever a
 * timestamp would be cut with `.slice(0, 10)` (that is the UTC day).
 */
export function stampDayKey(ts: string | null | undefined, f: DateFor = {}): string {
  return dayOf(ts, f);
}

/** A timestamp as a day in the date style and the entity's time zone: "5 Nov". */
export function fmtStampDay(ts: string | null | undefined, opts: { year?: 'always' | 'auto' | 'never'; weekday?: boolean } & DateFor = {}): string {
  return fmtDay(dayOf(ts, opts), opts);
}

/** A timestamp as a day and a time in the date style and the entity's time zone: "5 Nov 2026, 09:12". */
export function fmtStamp(ts: string | null | undefined, f: DateFor = {}): string {
  return fmtDateTime(ts, f);
}

/** A timestamp as a day and a time in the style and the entity's time zone: "16 Nov 2026, 14:05". */
export function fmtDateTime(v: string | null | undefined, f: DateFor = {}): string {
  const n = ms(v);
  if (n === 0) return '';
  return `${fmtDay(dayOf(v, f), f)}, ${time(v ?? '', f)}`;
}

export function weekday(day: string, style: 'narrow' | 'short' | 'long' = 'short'): string {
  return dateOf(day).toLocaleDateString('en', { weekday: style });
}

export function monthName(month: number, style: 'short' | 'long' = 'long'): string {
  return new Date(2026, month - 1, 1).toLocaleDateString('en', { month: style });
}

/** A clock time in the style: 24 hours ("14:05"), or 12 for month-first styles ("2:05 PM"). Takes a timestamp or "HH:MM". */
export function time(v: string, f: DateFor = {}): string {
  if (/^\d{1,2}:\d{2}$/.test(v)) {
    const [h, m] = v.split(':').map(Number);
    const d = new Date(2026, 0, 1, h ?? 0, m ?? 0);
    return dateOrder(f).order === 'mdy' ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }
  const n = ms(v);
  if (n === 0) return '';
  const d = new Date(n);
  // A timestamp reads in the entity's time zone.
  const zone = zoneFor(f);
  const tz = zone !== undefined ? { timeZone: zone } : {};
  try {
    return dateOrder(f).order === 'mdy' ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...tz }) : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', ...tz });
  } catch {
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }
}

/** "just now", "5 min ago", "3 h ago", "yesterday", "12 Oct". */
export function ago(v: string | null | undefined): string {
  const n = ms(v);
  if (n === 0) return '';
  const s = Math.max(0, (Date.now() - n) / 1000);
  if (s < 45) return t('format.just_now');
  if (s < 3600) return t('format.min_ago', { n: Math.round(s / 60) });
  if (s < 86400) return t('format.h_ago', { n: Math.round(s / 3600) });
  if (s < 172800) return t('format.yesterday');
  if (s < 7 * 86400) return t('format.days_ago', { n: Math.floor(s / 86400) });
  return fmtDay(v ?? '');
}

/** "today", "tomorrow", "in 3 days", "2 days ago" for a day. */
export function relDay(day: string, today = dayKey()): string {
  if (day === '') return '';
  const n = daysBetween(today, day);
  if (n === 0) return t('format.today');
  if (n === 1) return t('format.tomorrow');
  if (n === -1) return t('format.yesterday');
  if (n > 1) return tn('format.in_days', n);
  return tn('format.days_before', -n);
}

/** A length of service or an age: "3 y 2 m". */
export function tenure(from: string, to = dayKey()): string {
  if (from === '') return '';
  const a = dateOf(from);
  const b = dateOf(to);
  let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (b.getDate() < a.getDate()) months -= 1;
  if (months < 0) return '';
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return t('format.months', { n: m });
  return m === 0 ? t('format.years', { n: y }) : t('format.years_months', { y, m });
}

export function minutes(v: number | null | undefined): string {
  if (v === null || v === undefined) return '';
  const h = Math.floor(Math.abs(v) / 60);
  const m = Math.round(Math.abs(v) - h * 60);
  const sign = v < 0 ? '-' : '';
  if (h === 0) return `${sign}${m}m`;
  return m === 0 ? `${sign}${h}h` : `${sign}${h}h ${m}m`;
}

export function pad2(n: number): string {
  return String(Math.max(0, Math.round(n))).padStart(2, '0');
}

export function number(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/* ------------------------------------------------------------------ names */

export interface NameParts {
  preferred_name?: string | undefined;
  given_name?: string | undefined;
  family_name?: string | undefined;
  legal_name?: string | undefined;
  name_order?: 'family_first' | 'given_first' | '' | undefined;
  name?: string | undefined;
}

/**
 * A person's name in the right order: the stored order wins (family_first
 * for Japanese, Chinese, Korean, Hungarian names), the preferred name
 * replaces the given name, and a single `name` is shown as it is.
 */
export function personName(p: NameParts | null | undefined, style: 'full' | 'short' = 'full'): string {
  if (p === null || p === undefined) return '';
  const given = (p.preferred_name ?? '') !== '' ? (p.preferred_name ?? '') : (p.given_name ?? '');
  const family = p.family_name ?? '';
  if (given === '' && family === '') return p.name ?? p.legal_name ?? '';
  if (style === 'short') return p.name_order === 'family_first' ? family || given : given || family;
  if (p.name_order === 'family_first') return [family, given].filter((x) => x !== '').join(' ');
  return [given, family].filter((x) => x !== '').join(' ');
}

/** Two letters for an avatar, in the name's own order. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter((x) => x !== '');
  if (parts.length === 0) return '?';
  const chars = (s: string): string => Array.from(s)[0] ?? '';
  if (parts.length === 1) return Array.from(parts[0] ?? '').slice(0, 2).join('').toUpperCase();
  return (chars(parts[0] ?? '') + chars(parts[parts.length - 1] ?? '')).toUpperCase();
}

/** Lower-case words for status enums ("on_leave" -> "On leave"). */
export function humanize(v: string): string {
  if (v === '') return '';
  const s = v.replace(/[_-]+/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
