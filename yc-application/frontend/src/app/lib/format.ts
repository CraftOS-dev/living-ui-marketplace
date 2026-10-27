/** Dates and small text helpers. */

/** PocketBase datetimes come as "2026-10-26 13:25:07.525Z"; ISO elsewhere. */
export function toDate(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "3 minutes ago", HN style. */
export function ago(s: string): string {
  const d = toDate(s);
  if (d === null) return '';
  const sec = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return min + (min === 1 ? ' minute ago' : ' minutes ago');
  const h = Math.round(min / 60);
  if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
  const days = Math.round(h / 24);
  return days + (days === 1 ? ' day ago' : ' days ago');
}

/** The deadline in the founder's own time zone, and how long is left. */
export function deadlineText(iso: string): { when: string; left: string; late: boolean } {
  const d = toDate(iso);
  if (d === null) return { when: '', left: '', late: false };
  const when = d.toLocaleString(undefined, { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const ms = d.getTime() - Date.now();
  const late = ms < 0;
  const days = Math.floor(Math.abs(ms) / 86400000);
  const hours = Math.floor((Math.abs(ms) % 86400000) / 3600000);
  const span = days > 0 ? days + (days === 1 ? ' day' : ' days') : hours + (hours === 1 ? ' hour' : ' hours');
  return { when, left: late ? span + ' late' : span + ' left', late };
}

export function plural(n: number, one: string, many?: string): string {
  return n + ' ' + (n === 1 ? one : (many ?? one + 's'));
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function money(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US');
}

/** "2026-09" as "Sep 2026". */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return ym;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }) + ' ' + y;
}

/** An ISO time as "YYYY-MM-DD HH:MM" in the founder's time zone. */
export function toLocalText(iso: string): string {
  const d = toDate(iso);
  if (d === null) return '';
  const pad = (n: number): string => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

/** "YYYY-MM-DD HH:MM" (or just the day) in the founder's time zone as ISO; null when it is not a date. */
export function fromLocalText(s: string): string | null {
  const m = s.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 23), Number(m[5] ?? 59));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
