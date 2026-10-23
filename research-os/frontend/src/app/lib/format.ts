/** Dates, numbers and words for the screens. Numbers always read "1,234". */

const NUMBER_LOCALE = 'en-US';

export function num(n: number): string {
  return n.toLocaleString(NUMBER_LOCALE);
}

export function plural(n: number, one: string, many?: string): string {
  return num(n) + ' ' + (n === 1 ? one : (many ?? one + 's'));
}

function toDate(ts: string): Date | null {
  if (ts === '') return null;
  const d = new Date(ts.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Oct 21" this year, "Oct 21, 2025" otherwise. */
export function shortDate(ts: string): string {
  const d = toDate(ts);
  if (d === null) return '';
  const now = new Date();
  return MONTHS[d.getMonth()] + ' ' + d.getDate() + (d.getFullYear() !== now.getFullYear() ? ', ' + d.getFullYear() : '');
}

/** "just now", "5 min ago", "3 h ago", "yesterday", then the date. */
export function ago(ts: string): string {
  const d = toDate(ts);
  if (d === null) return '';
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  if (s < 172800) return 'yesterday';
  if (s < 7 * 86400) return Math.floor(s / 86400) + ' days ago';
  return shortDate(ts);
}

export function time(ts: string): string {
  const d = toDate(ts);
  if (d === null) return '';
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

export function greeting(): string {
  const h = new Date().getHours();
  return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export function todayLong(): string {
  const d = new Date();
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return days[d.getDay()] + ', ' + months[d.getMonth()] + ' ' + d.getDate();
}

export function bytes(n: number): string {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

export const TYPE_LABEL: Record<string, string> = {
  article: 'Journal article',
  preprint: 'Preprint',
  conference: 'Conference paper',
  book: 'Book',
  chapter: 'Book chapter',
  thesis: 'Thesis',
  report: 'Report',
  dataset: 'Dataset',
  software: 'Software',
  webpage: 'Web page',
  other: 'Other',
};

export const KIND_LABEL: Record<string, string> = { question: 'Question', claim: 'Claim', evidence: 'Evidence' };
export const REL_LABEL: Record<string, string> = { supports: 'supports', opposes: 'opposes', informs: 'informs' };
export const REL_IN_LABEL: Record<string, string> = { supports: 'Supported by', opposes: 'Opposed by', informs: 'Informed by' };

/** "Vaswani et al. · NeurIPS · 2017" */
export function byline(w: { authors_short: string; container: string; year: number }): string {
  return [w.authors_short, w.container, w.year > 0 ? String(w.year) : ''].filter((x) => x !== '').join(' · ');
}

/** A short quote for cards ("..." when cut). */
export function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
}
