/**
 * Focus card bodies of the funds module (the kernel frame draws the title,
 * chips, figures and actions):
 *   marks    the quarter's draft marks: each holding's method, value and change
 *   payment  how much of the LP's line is paid, as a bar
 */
import { AgentTag, Skeleton } from '../ui.tsx';
import { Meter } from '../charts.tsx';
import type { CardProps } from '../../lib/contract.ts';
import { money } from '../../lib/format.ts';
import { useOp } from '../../lib/live.ts';
import { Change, MethodTag } from './common.tsx';
import type { MarksList } from './types.ts';

export function MarksCard({ item }: CardProps): React.JSX.Element {
  const data = (item.data ?? {}) as { quarter?: string; fund?: string };
  const live = useOp<MarksList>('marks.list', { fund: data.fund ?? '', quarter: data.quarter ?? '' }, ['marks'], { name: 'marks.list.card' });
  if (live.data === null) return <Skeleton className="h-24" />;
  const cur = live.data.fund.currency;
  const rows = live.data.holdings.filter((h) => h.quarter_mark !== null && h.quarter_mark.status === 'draft');
  return (
    <ul className="flex min-w-0 flex-col divide-y divide-[var(--vo-hair)]">
      {rows.map((h) => {
        const m = h.quarter_mark;
        if (m === null) return null;
        return (
          <li key={h.holding} className="flex min-h-9 min-w-0 items-center gap-3 py-1.5 text-[13px]">
            <span className="vo-wrap min-w-0 flex-1 truncate">{h.name}</span>
            {m.actor === 'agent' && <AgentTag />}
            <MethodTag method={m.method} />
            <span className="vo-mono vo-num w-24 text-right">{money(m.value_minor, cur, { compact: true, bare: true })}</span>
            <span className="w-24 text-right">
              <Change minor={m.change_minor} currency={cur} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function PaymentCard({ item }: CardProps): React.JSX.Element {
  const d = (item.data ?? {}) as { total_minor?: number; paid_minor?: number; currency?: string };
  const total = d.total_minor ?? 0;
  const paid = d.paid_minor ?? 0;
  return <Meter value={total > 0 ? paid : null} max={total || 1} label="Paid" height={8} format={() => money(paid, d.currency ?? 'USD', { compact: true }) + ' / ' + money(total, d.currency ?? 'USD', { compact: true, bare: true })} />;
}
