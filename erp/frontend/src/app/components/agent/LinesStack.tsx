/**
 * Journal lines for a narrow screen: one row per line (account, then debit
 * or credit), and the totals, so nothing scrolls sideways on a phone.
 */
import { cn } from '../../../kit/index.ts';
import { amount, money } from '../../lib/format.ts';
import { navigate } from '../../lib/router.ts';
import type { JournalPreviewLine } from '../../lib/types.ts';

export function LinesStack({ lines, currency, className }: { lines: JournalPreviewLine[]; currency: string; className?: string | undefined }): React.JSX.Element {
  const dr = lines.reduce((s, l) => s + l.debit, 0);
  const cr = lines.reduce((s, l) => s + l.credit, 0);
  return (
    <div className={cn('rounded-[18px] bg-[var(--erp-row)] p-2', className)}>
      <ul className="flex flex-col">
        {lines.map((l, i) => (
          <li key={i} className="flex items-start gap-3 border-b border-[var(--erp-line)] px-2 py-2.5 last:border-b-0">
            <button type="button" onClick={() => navigate('account', { id: l.account.id })} className="min-w-0 flex-1 text-left">
              <span className="block text-[13px] font-semibold">
                <span className="num">{l.account.code}</span> {l.account.name}
              </span>
              {(l.memo !== '' || l.party !== '') && <span className="block text-[12px] text-[var(--erp-muted)]">{[l.party, l.memo].filter((x) => x !== '').join(' · ')}</span>}
            </button>
            <span className="shrink-0 text-right">
              <span className="block text-[12px] text-[var(--erp-muted)]">{l.debit !== 0 ? 'Debit' : 'Credit'}</span>
              <span className="num block text-[13px] font-semibold">{amount(l.debit !== 0 ? l.debit : l.credit, currency)}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-1 flex justify-between gap-3 rounded-[14px] bg-[var(--erp-card)] px-3 py-2 text-[13px] font-bold">
        <span>Debits {money(dr, currency)}</span>
        <span>Credits {money(cr, currency)}</span>
      </div>
    </div>
  );
}
