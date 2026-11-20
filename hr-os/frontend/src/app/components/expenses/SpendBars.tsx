/**
 * Spend as quiet horizontal bars: one row per category or department, the
 * approved part in the primary series colour and the part still waiting for
 * approval in its soft step, a 2px gap between them, rounded data ends,
 * the total as text in ink at the end of the row and a tooltip on hover or
 * focus. A two-swatch legend names the parts. Every figure is also text, so
 * the bars never carry meaning alone.
 */
import { useState } from 'react';
import { Money } from '../ui.tsx';
import { t } from '../../lib/i18n.ts';
import type { SpendGroup } from '../../pages/expenses/types.ts';
import { CategoryIcon } from './parts.tsx';

export function SpendLegend(): React.JSX.Element {
  return (
    <span className="flex items-center gap-3 text-[12px] text-[var(--hr-muted)]">
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="h-2 w-3 rounded-[2px] bg-[var(--hr-rh)]" />
        {t('exp.spend.approved')}
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="h-2 w-3 rounded-[2px] bg-[var(--hr-rh-soft)] ring-1 ring-inset ring-[var(--hr-rh)]" />
        {t('exp.spend.waiting')}
      </span>
    </span>
  );
}

export function SpendBars({ groups, currency, icons, max = 8, label }: { groups: SpendGroup[]; currency: string; icons?: boolean | undefined; max?: number | undefined; label: string }): React.JSX.Element {
  const [hover, setHover] = useState('');
  const rows = groups.slice(0, max);
  const top = Math.max(1, ...rows.map((g) => g.total_minor));
  return (
    <ul aria-label={label} className="flex flex-col gap-1.5">
      {rows.map((g) => {
        const a = (g.approved_minor / top) * 100;
        const w = (g.waiting_minor / top) * 100;
        const on = hover === g.key;
        return (
          <li
            key={g.key}
            tabIndex={0}
            onMouseEnter={() => setHover(g.key)}
            onMouseLeave={() => setHover('')}
            onFocus={() => setHover(g.key)}
            onBlur={() => setHover('')}
            className="hr-focus relative grid grid-cols-[minmax(0,140px)_minmax(0,1fr)_auto] items-center gap-3 rounded-[3px] py-1 sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)_auto]"
          >
            <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-[var(--hr-ink-2)]">
              {icons === true && <CategoryIcon name={g.icon} size={13} className="shrink-0 text-[var(--hr-muted)]" />}
              <span className="truncate">{g.label}</span>
            </span>
            <span aria-hidden className="flex h-3.5 min-w-0 items-center">
              {g.approved_minor > 0 && <span className={`h-full bg-[var(--hr-rh)] ${g.waiting_minor > 0 ? 'rounded-l-[4px]' : 'rounded-[4px]'}`} style={{ width: `${a}%`, minWidth: 3 }} />}
              {g.approved_minor > 0 && g.waiting_minor > 0 && <span className="h-full w-[2px] shrink-0 bg-[var(--hr-panel)]" />}
              {g.waiting_minor > 0 && <span className={`h-full bg-[var(--hr-rh-soft)] shadow-[inset_0_0_0_1px_var(--hr-rh)] ${g.approved_minor > 0 ? 'rounded-r-[4px]' : 'rounded-[4px]'}`} style={{ width: `${w}%`, minWidth: 3 }} />}
            </span>
            <Money minor={g.total_minor} currency={currency} format={{ compact: true }} className="text-right text-[12px] text-[var(--hr-ink)]" />
            {on && (
              <span role="tooltip" className="pointer-events-none absolute -top-9 left-[140px] z-20 flex items-center gap-3 whitespace-nowrap rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)] bg-[var(--hr-raised)] px-2.5 py-1.5 text-[12px] shadow-[var(--hr-shadow-lg)] sm:left-[180px]">
                <span className="font-medium">{g.label}</span>
                <span className="text-[var(--hr-muted)]">{t('exp.spend.approved')}</span>
                <Money minor={g.approved_minor} currency={currency} />
                <span className="text-[var(--hr-muted)]">{t('exp.spend.waiting')}</span>
                <Money minor={g.waiting_minor} currency={currency} />
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
