/**
 * A period picker for the books: preset chips (This month, Last month...)
 * and, for Custom, two day fields. The range lives in the page's URL.
 */
import { useState } from 'react';
import { Chips } from '../controls.tsx';
import { DateField } from '../pickers.tsx';
import { PRESETS, presetOf, rangeOf } from './period.ts';
import type { Preset } from './period.ts';

export function PeriodBar({
  from,
  to,
  fiscalStart,
  onChange,
  presets = PRESETS.map((p) => p.value),
  className,
}: {
  from: string;
  to: string;
  fiscalStart: number;
  onChange: (from: string, to: string) => void;
  presets?: Preset[] | undefined;
  className?: string | undefined;
}): React.JSX.Element {
  const matched = presetOf(from, to, fiscalStart);
  const [custom, setCustom] = useState(matched === 'custom');
  const current: Preset = custom || matched === 'custom' ? 'custom' : matched;
  return (
    <div className={className}>
      <div className="flex flex-col gap-3 @min-[1100px]:flex-row @min-[1100px]:items-center">
        <Chips
          ariaLabel="Period"
          value={current}
          onChange={(p: Preset) => {
            if (p === 'custom') {
              setCustom(true);
              return;
            }
            setCustom(false);
            const r = rangeOf(p, fiscalStart);
            onChange(r.from, r.to);
          }}
          options={PRESETS.filter((p) => presets.includes(p.value)).map((p) => ({ value: p.value, label: p.label }))}
        />
        {current === 'custom' && (
          <div className="flex flex-wrap items-center gap-2">
            <DateField value={from} onChange={(d) => d !== '' && onChange(d, d > to ? d : to)} ariaLabel="From" max={to} className="w-40 [&>button]:bg-[var(--erp-card)]" />
            <span className="text-[13px] text-[var(--erp-muted)]">to</span>
            <DateField value={to} onChange={(d) => d !== '' && onChange(d < from ? d : from, d)} ariaLabel="To" min={from} className="w-40 [&>button]:bg-[var(--erp-card)]" align="right" />
          </div>
        )}
      </div>
    </div>
  );
}
