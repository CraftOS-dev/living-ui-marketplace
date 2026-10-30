/** Numbers, sizes and times as the app writes them. */

export function num(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return '–';
  const r = Number(n.toFixed(digits));
  return r.toLocaleString(undefined, { maximumFractionDigits: digits });
}

/** File sizes in binary units, as file managers show them. */
export function bytes(n: number): string {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return num(n / 1024, n < 10 * 1024 ? 1 : 0) + ' KB';
  if (n < 1024 * 1024 * 1024) return num(n / 1024 / 1024, 1) + ' MB';
  return num(n / 1024 / 1024 / 1024, 2) + ' GB';
}

export function dims(w: number, h: number): string {
  return num(w, 0) + ' × ' + num(h, 0);
}

export function megapixels(w: number, h: number): string {
  return num((w * h) / 1e6, 1) + ' MP';
}

/** "−62 %" for a smaller file, "+8 %" for a bigger one. */
export function saving(pct: number | null | undefined): string {
  if (pct === null || pct === undefined) return '';
  if (Math.abs(pct) < 0.5) return 'same size';
  return (pct > 0 ? '−' : '+') + num(Math.abs(pct), 0) + ' %';
}

export function ms(n: number): string {
  if (n < 1000) return Math.round(n) + ' ms';
  return num(n / 1000, 1) + ' s';
}

export function plural(n: number, word: string, many?: string): string {
  return num(n, 0) + ' ' + (n === 1 ? word : (many ?? word + 's'));
}

function parseTs(ts: string): number {
  return Date.parse(ts.replace(' ', 'T'));
}

/** "just now", "5 min ago", "yesterday 14:05", "3 Oct". */
export function ago(ts: string): string {
  const t = parseTs(ts);
  if (Number.isNaN(t)) return '';
  const s = (Date.now() - t) / 1000;
  if (s < 45) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  const d = new Date(t);
  const now = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return 'today ' + time;
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'yesterday ' + time;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

/** The calendar day of a timestamp (for grouping): "2026-10-29". */
export function day(ts: string): string {
  const t = parseTs(ts);
  if (Number.isNaN(t)) return '';
  const d = new Date(t);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

export function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Good evening';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

/** Format names as people write them. */
export const FORMAT_LABEL: Record<string, string> = {
  webp: 'WebP',
  avif: 'AVIF',
  jpeg: 'JPEG',
  png: 'PNG',
  gif: 'GIF',
  ico: 'ICO',
  tiff: 'TIFF',
};

export function formatLabel(f: string): string {
  return FORMAT_LABEL[f.toLowerCase()] ?? f.toUpperCase();
}
