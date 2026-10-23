/** Small conversions the books screens share. */
import type { JournalPreviewLine } from '../../lib/types.ts';
import type { JournalLineOut } from '../../lib/types/books.ts';

/** Posted journal lines in the shape JournalLines and BooksDetail draw. */
export function previewLines(lines: JournalLineOut[] | undefined): JournalPreviewLine[] {
  return (lines ?? []).map((l) => ({
    account: { id: l.account?.id ?? '', code: l.account?.code ?? '?', name: l.account?.name ?? 'Missing account' },
    debit: l.debit,
    credit: l.credit,
    memo: l.memo,
    party: l.party?.name ?? '',
  }));
}

/** Rows to CSV text (quoted where needed). */
export function toCsv(rows: (string | number)[][]): string {
  return rows
    .map((r) =>
      r
        .map((c) => {
          const s = String(c);
          return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(','),
    )
    .join('\r\n');
}

/** Minor units as plain CSV text ("1234.50", "-12.00"). */
export function csvAmount(minor: number, decimals = 2): string {
  const neg = minor < 0;
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 10 ** decimals);
  const frac = decimals > 0 ? `.${String(abs % 10 ** decimals).padStart(decimals, '0')}` : '';
  return `${neg ? '-' : ''}${whole}${frac}`;
}
