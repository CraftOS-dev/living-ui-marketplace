/**
 * Numbers on screen. Data is always millimetres and degrees; inches are a
 * display choice (Settings). Every number reads "1,234.5" whatever the
 * browser's language, and a true minus sign reads better than a hyphen.
 */

export type Unit = 'mm' | 'in';

const fmt4 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 });
const fmt3 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 });
const fmt2 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const fmt1 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const fmt0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

function minus(s: string): string {
  return s.replace('-', '−');
}

/** A plain number with up to `digits` decimals. */
export function num(n: number, digits = 3): string {
  const f = digits >= 4 ? fmt4 : digits === 3 ? fmt3 : digits === 2 ? fmt2 : digits === 1 ? fmt1 : fmt0;
  return minus(f.format(n));
}

/** A length in the display unit, with the unit. */
export function length(mm: number, unit: Unit, withUnit = true): string {
  if (unit === 'in') return num(mm / 25.4, 4) + (withUnit ? ' in' : '');
  return num(mm, 3) + (withUnit ? ' mm' : '');
}

/** "60 x 40 x 30 mm". */
export function size(s: [number, number, number] | null | undefined, unit: Unit): string {
  if (s === null || s === undefined) return '';
  return s.map((v) => length(v, unit, false)).join(' × ') + (unit === 'in' ? ' in' : ' mm');
}

/** A volume: mm3 below a cubic centimetre, else cm3 (in3 for inches). */
export function volume(mm3: number, unit: Unit): string {
  if (unit === 'in') return num(mm3 / 16387.064, 3) + ' in³';
  if (Math.abs(mm3) < 1000) return num(mm3, 1) + ' mm³';
  return num(mm3 / 1000, 2) + ' cm³';
}

export function area(mm2: number, unit: Unit): string {
  if (unit === 'in') return num(mm2 / 645.16, 3) + ' in²';
  if (Math.abs(mm2) < 100) return num(mm2, 2) + ' mm²';
  return num(mm2 / 100, 2) + ' cm²';
}

export function mass(g: number | null | undefined): string {
  if (g === null || g === undefined) return '';
  if (Math.abs(g) >= 1000) return num(g / 1000, 3) + ' kg';
  return num(g, 1) + ' g';
}

export function signed(n: number, digits = 3): string {
  return (n > 0 ? '+' : '') + num(n, digits);
}

export function bytes(n: number): string {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return num(n / 1024, 1) + ' KB';
  return num(n / 1024 / 1024, 1) + ' MB';
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

export function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Good evening';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}
