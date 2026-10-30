/**
 * Time zones for charts. The chart library draws its axis in UTC, so bar
 * times are shifted by the chosen zone's offset at that moment (daylight
 * saving included). Intraday bars use the person's choice (exchange, local
 * or UTC); daily and longer bars always use the exchange's zone, because a
 * daily bar is a trading date, not a moment.
 */
import type { Sessions, TzMode } from './types.ts';

const dtf = new Map<string, Intl.DateTimeFormat>();
const offsets = new Map<string, number>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = dtf.get(tz);
  if (f === undefined) {
    try {
      f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    } catch {
      f = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    }
    dtf.set(tz, f);
  }
  return f;
}

/** Seconds to add to a UTC time to get the wall clock of `tz` at that moment. */
export function tzOffset(tz: string, t: number): number {
  if (tz === 'UTC' || tz === 'Etc/UTC' || tz === '') return 0;
  // Offsets change at most at whole hours: cache per zone and quarter hour.
  const bucket = Math.floor(t / 900);
  const key = tz + '|' + bucket;
  const hit = offsets.get(key);
  if (hit !== undefined) return hit;
  const parts = formatter(tz).formatToParts(new Date(bucket * 900 * 1000));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second')) / 1000;
  const off = Math.round((wall - bucket * 900) / 60) * 60;
  if (offsets.size > 20000) offsets.clear();
  offsets.set(key, off);
  return off;
}

export function localZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** The zone a chart's axis uses. */
export function chartZone(mode: TzMode, exchangeTz: string, intraday: boolean): string {
  if (!intraday) return exchangeTz || 'UTC';
  if (mode === 'utc') return 'UTC';
  if (mode === 'local') return localZone();
  return exchangeTz || 'UTC';
}

/** A short label for a zone: "New York", "UTC", "London". */
export function zoneLabel(tz: string): string {
  if (tz === 'UTC' || tz === 'Etc/UTC') return 'UTC';
  const city = tz.split('/').pop() ?? tz;
  return city.replace(/_/g, ' ');
}

/** "UTC−4" for a zone at a moment. */
export function utcLabel(tz: string, t: number): string {
  const off = tzOffset(tz, t) / 3600;
  if (off === 0) return 'UTC';
  const h = Math.trunc(Math.abs(off));
  const m = Math.round((Math.abs(off) - h) * 60);
  return 'UTC' + (off > 0 ? '+' : '−') + h + (m ? ':' + String(m).padStart(2, '0') : '');
}

/** Minute of the day (0..1439) of a moment in a zone. */
export function minuteOfDay(tz: string, t: number): number {
  const local = t + tzOffset(tz, t);
  return Math.floor((((local % 86400) + 86400) % 86400) / 60);
}

/** Whether a bar opening at t lies outside the regular session (pre or post market). */
export function isExtended(sessions: Sessions | null, tz: string, t: number): boolean {
  if (sessions === null) return false;
  const m = minuteOfDay(tz, t);
  return m < sessions.regular[0] || m >= sessions.regular[1];
}
