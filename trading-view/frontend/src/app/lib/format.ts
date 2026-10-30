/** Number, price and time formatting. Prices keep the instrument's precision. */

const nf = new Map<string, Intl.NumberFormat>();

function fmt(min: number, max: number): Intl.NumberFormat {
  const k = min + ':' + max;
  let f = nf.get(k);
  if (f === undefined) {
    f = new Intl.NumberFormat('en-US', { minimumFractionDigits: min, maximumFractionDigits: max });
    nf.set(k, f);
  }
  return f;
}

/** Decimals for a price: the instrument's hint, else by magnitude. */
export function decimals(v: number, hint?: number | null): number {
  if (hint !== undefined && hint !== null && hint > 0) {
    const a = Math.abs(v);
    // Yahoo says 2 for most; very small prices (some crypto, FX crosses) need more.
    if (a > 0 && a < 1 && hint <= 2) return a < 0.01 ? 6 : 4;
    return Math.min(8, hint);
  }
  const a = Math.abs(v);
  if (a === 0) return 2;
  if (a < 0.0001) return 8;
  if (a < 0.01) return 6;
  if (a < 1) return 4;
  if (a < 10) return 3;
  return 2;
}

export function price(v: number | null | undefined, hint?: number | null): string {
  if (v === null || v === undefined || !isFinite(v)) return '-';
  const d = decimals(v, hint);
  return fmt(d, d).format(v);
}

export function signed(v: number | null | undefined, hint?: number | null): string {
  if (v === null || v === undefined || !isFinite(v)) return '-';
  return (v > 0 ? '+' : v < 0 ? '−' : '') + price(Math.abs(v), hint);
}

export function pct(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !isFinite(v)) return '-';
  return (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(digits, digits).format(Math.abs(v)) + '%';
}

export function plainPct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !isFinite(v)) return '-';
  return fmt(digits, digits).format(v) + '%';
}

export function num(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !isFinite(v)) return '-';
  return fmt(0, digits).format(v);
}

/** 1.2K, 3.4M, 5.6B, 7.8T */
export function compact(v: number | null | undefined): string {
  if (v === null || v === undefined || !isFinite(v)) return '-';
  const a = Math.abs(v);
  const s = v < 0 ? '−' : '';
  if (a >= 1e12) return s + fmt(1, 2).format(a / 1e12) + 'T';
  if (a >= 1e9) return s + fmt(1, 2).format(a / 1e9) + 'B';
  if (a >= 1e6) return s + fmt(1, 2).format(a / 1e6) + 'M';
  if (a >= 1e3) return s + fmt(1, 1).format(a / 1e3) + 'K';
  return s + fmt(0, 2).format(a);
}

export type Tone = 'up' | 'down' | 'flat';

export function tone(v: number | null | undefined): Tone {
  if (v === null || v === undefined || !isFinite(v) || v === 0) return 'flat';
  return v > 0 ? 'up' : 'down';
}

export const TONE_TEXT: Record<Tone, string> = { up: 'text-[var(--tv-up-text)]', down: 'text-[var(--tv-down-text)]', flat: 'text-[var(--tv-ink-2)]' };

/** How a symbol reads in lists: no provider prefix, no Yahoo suffix for currencies. */
export function short(sym: string): string {
  if (sym.startsWith('BINANCE:')) return sym.slice(8);
  if (sym.endsWith('=X')) return sym.slice(0, -2);
  return sym;
}

export function venue(sym: string): string {
  return sym.startsWith('BINANCE:') ? 'Binance' : '';
}

/** "3m ago", "2h ago", "Oct 12" */
export function ago(value: string | number): string {
  const t = typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : Date.parse(value.replace(' ', 'T'));
  if (!isFinite(t)) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  if (s < 86400 * 7) return Math.round(s / 86400) + 'd ago';
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** "Oct 12, 14:05" in the browser's time zone. */
export function stamp(value: string | number): string {
  const t = typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : Date.parse(value.replace(' ', 'T'));
  if (!isFinite(t)) return '';
  return new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}
