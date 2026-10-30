/** Dates and numbers as people read them. */

export function ms(v: string | null | undefined): number {
  if (v === undefined || v === null || v === '') return 0;
  const t = Date.parse(v.replace(' ', 'T'));
  return Number.isFinite(t) ? t : 0;
}

/** "just now", "5 min ago", "3 h ago", "yesterday", "12 Oct". */
export function ago(v: string): string {
  const t = ms(v);
  if (t === 0) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 172800) return 'yesterday';
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} days ago`;
  return day(v);
}

/** "in 12 min", "in 2 h", "now" for a time ahead. */
export function until(v: string): string {
  const t = ms(v);
  if (t === 0) return '';
  const s = (t - Date.now()) / 1000;
  if (s <= 30) return 'now';
  if (s < 3600) return `${Math.round(s / 60)} min`;
  return `${Math.round(s / 3600)} h`;
}

export function day(v: string): string {
  const t = ms(v);
  if (t === 0) return '';
  const d = new Date(t);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}

export function time(v: string): string {
  const t = ms(v);
  if (t === 0) return '';
  return new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** Due date relative to today: overdue, today, tomorrow, or the day. */
export function due(v: string): { text: string; tone: 'red' | 'amber' | 'muted' } {
  const t = ms(v);
  if (t === 0) return { text: '', tone: 'muted' };
  const d = new Date(t);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const that = new Date(d);
  that.setHours(0, 0, 0, 0);
  const diff = Math.round((that.getTime() - today.getTime()) / 86400000);
  if (diff < 0) return { text: diff === -1 ? 'Yesterday' : day(v), tone: 'red' };
  if (diff === 0) return { text: 'Today', tone: 'amber' };
  if (diff === 1) return { text: 'Tomorrow', tone: 'amber' };
  return { text: day(v), tone: 'muted' };
}

/** A date input value (yyyy-mm-dd) from a stored date. */
export function dateInput(v: string): string {
  const t = ms(v);
  if (t === 0) return '';
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function pct(v: number | null | undefined): string {
  if (v === null || v === undefined) return '–';
  return `${Math.round(v * 100)}%`;
}

export function num(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined) return '–';
  const r = Math.round(v * 10 ** digits) / 10 ** digits;
  return String(r);
}

export function minutes(v: number | null | undefined): string {
  if (v === null || v === undefined) return '–';
  if (v < 60) return `${Math.round(v)} min`;
  return `${Math.round((v / 60) * 10) / 10} h`;
}

export function plural(n: number, one: string, many?: string): string {
  return `${n} ${n === 1 ? one : (many ?? one + 's')}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) {
    const w = parts[0] ?? '?';
    const cap = /^.[^A-Z]*([A-Z])/.exec(w);
    return (cap !== null ? (w[0] ?? '') + (cap[1] ?? '') : w.slice(0, 2)).toUpperCase();
  }
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
}
