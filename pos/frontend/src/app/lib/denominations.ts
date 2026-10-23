/**
 * Notes and coins per currency, in minor units, largest first: the cash
 * count (float and close) and the quick-cash buttons ("next note up") use
 * them. A currency not listed falls back to a generic decimal ladder.
 */

const TABLE: Record<string, number[]> = {
  MYR: [10000, 5000, 2000, 1000, 500, 100, 50, 20, 10, 5],
  SGD: [10000, 5000, 1000, 500, 200, 100, 50, 20, 10, 5],
  JPY: [10000, 5000, 2000, 1000, 500, 100, 50, 10, 5, 1],
  AUD: [10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5],
  NZD: [10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10],
  GBP: [5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 2, 1],
  USD: [10000, 5000, 2000, 1000, 500, 100, 25, 10, 5, 1],
  EUR: [50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 2, 1],
  HKD: [100000, 50000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10],
  THB: [100000, 50000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 25],
  IDR: [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100],
  PHP: [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 100, 25, 5, 1],
  INR: [50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100],
  CNY: [10000, 5000, 2000, 1000, 500, 100, 50, 10],
  KRW: [50000, 10000, 5000, 1000, 500, 100, 50, 10],
  TWD: [100000, 50000, 20000, 10000, 5000, 1000, 500, 100],
  CAD: [10000, 5000, 2000, 1000, 500, 200, 100, 25, 10, 5],
};

export function denominations(currency: string, exp: number): number[] {
  const known = TABLE[currency];
  if (known !== undefined) return known;
  const unit = 10 ** exp;
  return [100, 50, 20, 10, 5, 2, 1].map((x) => x * unit).concat(exp >= 2 ? [unit / 2, unit / 5, unit / 10] : []);
}

/** The notes of a currency (the bigger half of the ladder). */
export function notesOf(currency: string, exp: number): number[] {
  const all = denominations(currency, exp);
  const unit = 10 ** exp;
  const notes = all.filter((d) => d >= unit);
  return notes.length > 0 ? notes : all;
}

/**
 * Quick-cash amounts for a sum due: the exact amount, then the next round
 * amounts a customer is likely to hand over (the next note up, the next two
 * notes, a round number), distinct and ascending, at most four.
 */
export function quickCash(due: number, currency: string, exp: number): number[] {
  if (due <= 0) return [];
  const notes = notesOf(currency, exp).slice().sort((a, b) => a - b);
  const out = new Set<number>([due]);
  for (const n of notes) {
    const up = Math.ceil(due / n) * n;
    if (up > due) out.add(up);
    if (out.size >= 4) break;
  }
  return [...out].sort((a, b) => a - b).slice(0, 4);
}
