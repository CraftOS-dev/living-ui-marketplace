/**
 * Small pieces the money and books screens share: the in/out arrow, a
 * signed amount, and an account code chip.
 */
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { money } from '../../lib/format.ts';
import type { Direction } from '../../lib/types/money.ts';

export function DirIcon({ dir, size = 32 }: { dir: Direction; size?: number | undefined }): React.JSX.Element {
  const Icon = dir === 'in' ? ArrowDownLeft : ArrowUpRight;
  return (
    <span
      className={cn('flex shrink-0 items-center justify-center rounded-full', dir === 'in' ? 'bg-[var(--erp-accent-soft)] text-[var(--erp-ink)]' : 'bg-[var(--erp-row)] text-[var(--erp-ink-2)]')}
      style={{ width: size, height: size }}
      aria-label={dir === 'in' ? 'Money in' : 'Money out'}
    >
      <Icon size={Math.round(size * 0.47)} strokeWidth={2.2} />
    </span>
  );
}

/** "+$120.00" in green for money in, "−$45.20" in ink for money out. */
export function Signed({ minor, currency, className, muted = false }: { minor: number; currency: string; className?: string | undefined; muted?: boolean | undefined }): React.JSX.Element {
  return (
    <span className={cn('num font-bold', muted ? 'text-[var(--erp-muted)]' : minor > 0 ? 'text-[var(--erp-green-text)]' : 'text-[var(--erp-ink)]', className)}>
      {minor > 0 ? '+' : minor < 0 ? '−' : ''}
      {money(Math.abs(minor), currency)}
    </span>
  );
}

/** An account's code in a small rounded chip. */
export function CodeChip({ code }: { code: string }): React.JSX.Element {
  return <span className="num inline-flex h-6 shrink-0 items-center rounded-[8px] bg-[var(--erp-row)] px-2 text-[12px] font-bold text-[var(--erp-ink-2)]">{code}</span>;
}
