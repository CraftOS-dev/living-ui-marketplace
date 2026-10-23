/**
 * Document line math on screen, exactly as the server does it
 * (pb_hooks/lib_money.js line()): quantity in thousandths, unit price in
 * ten-thousandths, discount and tax in basis points, integer arithmetic with
 * rounding half away from zero. Live totals therefore match what is saved.
 */
import { decimalsOf, normalizeNumber } from '../../lib/format.ts';

const TEN_K = 10000n;

function pow10(n: number): bigint {
  let v = 1n;
  for (let i = 0; i < n; i++) v *= 10n;
  return v;
}

/** round(n / d) half away from zero. */
function divRound(n: bigint, d: bigint): bigint {
  const neg = n < 0n !== d < 0n;
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  let q = an / ad;
  if ((an - q * ad) * 2n >= ad) q += 1n;
  return neg ? -q : q;
}

/** "12.5" with `scale` decimals as an integer ("12.5", 4 -> 125000), or null. */
export function scaled(text: string, scale: number): bigint | null {
  const t = text.trim();
  if (t === '') return null;
  const n = normalizeNumber(t, scale);
  if (n === null) return null;
  const [whole = '0', frac = ''] = n.split('.');
  return BigInt(whole) * pow10(scale) + BigInt((frac + '0'.repeat(scale)).slice(0, scale) || '0');
}

export interface LineMath {
  gross: number;
  discount: number;
  net: number;
  tax: number;
  total: number;
}

/**
 * One line in minor units of `currency`. Quantity and price as typed text,
 * discount as percent text, the tax rate in basis points.
 */
export function lineMath(qtyText: string, priceText: string, discountText: string, rateBp: number, inclusive: boolean, currency: string): LineMath | null {
  const q = scaled(qtyText, 3);
  const p = priceText.trim() === '' ? 0n : scaled(priceText, 4);
  const d = discountText.trim() === '' ? 0n : scaled(discountText, 2);
  if (q === null || p === null || d === null || d > TEN_K) return null;
  const e = decimalsOf(currency);
  const den = 1000n * pow10(4 - e) * TEN_K;
  const gross = divRound(q * p * TEN_K, den);
  const after = divRound(q * p * (TEN_K - d), den);
  const rate = BigInt(Math.max(0, Math.round(rateBp)));
  let net: bigint;
  let tax: bigint;
  if (inclusive) {
    net = rate > 0n ? divRound(after * TEN_K, TEN_K + rate) : after;
    tax = after - net;
  } else {
    net = after;
    tax = rate > 0n ? divRound(net * rate, TEN_K) : 0n;
  }
  return { gross: Number(gross), discount: Number(gross - after), net: Number(net), tax: Number(tax), total: Number(net + tax) };
}

/** A positive quantity with at most 3 decimals (whole when `whole`). */
export function validQty(text: string, whole: boolean): boolean {
  const n = normalizeNumber(text, whole ? 0 : 3);
  return n !== null && Number(n) > 0;
}
