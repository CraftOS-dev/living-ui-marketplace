/**
 * Numbering: the prefix and number of digits of each series, with a live
 * example of the next number. The next number can move forward (never
 * back, so numbers already used stay unique).
 */
import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import type { CompanySettings, SeriesConfig } from '../../lib/types/settings.ts';
import { Stepper } from '../controls.tsx';
import { NumberInput } from '../pickers.tsx';
import { Card, CircleButton, cellInput } from '../ui.tsx';

const GROUPS: { title: string; series: [string, string][] }[] = [
  { title: 'Sales', series: [['quote', 'Quotes'], ['sales_order', 'Sales orders'], ['delivery', 'Deliveries'], ['invoice', 'Invoices'], ['credit_note', 'Credit notes']] },
  { title: 'Purchasing', series: [['purchase_order', 'Purchase orders'], ['goods_receipt', 'Goods receipts'], ['bill', 'Bills'], ['supplier_credit', 'Supplier credits']] },
  { title: 'Money and books', series: [['payment_in', 'Money in'], ['payment_out', 'Money out'], ['journal', 'Journal entries'], ['asset', 'Fixed assets']] },
  { title: 'Stock and making', series: [['item', 'Items (SKU)'], ['stock_change', 'Stock changes'], ['build', 'Builds']] },
  { title: 'People and work', series: [['employee', 'Employees'], ['claim', 'Expense claims'], ['payroll', 'Pay runs'], ['project', 'Projects'], ['party', 'Customers and suppliers']] },
];

function nextNumber(cfg: SeriesConfig): number {
  const tail = cfg.next.startsWith(cfg.prefix) ? cfg.next.slice(cfg.prefix.length) : cfg.next.replace(/^\D+/, '');
  const n = Number(tail);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function NumberingSection({ s, onSaved }: { s: CompanySettings; onSaved: (s: CompanySettings) => void }): React.JSX.Element {
  const numbering = s.numbering ?? {};
  const known = new Set(GROUPS.flatMap((g) => g.series.map(([k]) => k)));
  const extra = Object.keys(numbering).filter((k) => !known.has(k));
  const groups = extra.length > 0 ? [...GROUPS, { title: 'Other', series: extra.map((k) => [k, k.replace(/_/g, ' ')] as [string, string]) }] : GROUPS;
  return (
    <div className="flex flex-col gap-5">
      {groups.map((g, i) => (
        <Card key={g.title} delay={Math.min(5, i + 1)}>
          <h2 className="mb-2 text-[15px] font-bold">{g.title}</h2>
          <div className="hidden grid-cols-[minmax(0,1.3fr)_120px_120px_120px_minmax(0,1fr)_40px] gap-3 px-1 pb-1 text-[12px] font-semibold text-[var(--erp-muted)] @min-[900px]:grid">
            <span>Series</span>
            <span>Prefix</span>
            <span>Digits</span>
            <span>Next number</span>
            <span>Next one reads</span>
            <span />
          </div>
          <div className="flex flex-col">
            {g.series
              .filter(([k]) => numbering[k] !== undefined)
              .map(([k, label]) => (
                <SeriesRow key={k} series={k} label={label} cfg={numbering[k] as SeriesConfig} onSaved={onSaved} />
              ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

function SeriesRow({ series, label, cfg, onSaved }: { series: string; label: string; cfg: SeriesConfig; onSaved: (s: CompanySettings) => void }): React.JSX.Element {
  const current = nextNumber(cfg);
  const [prefix, setPrefix] = useState(cfg.prefix);
  const [width, setWidth] = useState(String(cfg.width));
  const [next, setNext] = useState(String(current));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setPrefix(cfg.prefix);
    setWidth(String(cfg.width));
    setNext(String(nextNumber(cfg)));
  }, [cfg]);

  const w = Math.min(10, Math.max(1, Number(width) || 1));
  const n = Math.max(1, Math.round(Number(next) || current));
  const back = n < current;
  const badPrefix = !/^[A-Za-z0-9\-/._]*$/.test(prefix);
  const dirty = prefix !== cfg.prefix || w !== cfg.width || n !== current;
  const example = `${prefix}${String(n).padStart(w, '0')}`;

  const save = async (): Promise<void> => {
    if (back || badPrefix) return;
    setBusy(true);
    try {
      const p: Record<string, string | number> = { series };
      if (prefix !== cfg.prefix) p['prefix'] = prefix;
      if (w !== cfg.width) p['width'] = w;
      if (n !== current) p['next'] = n;
      const r = await op<CompanySettings>('settings.numbering', p);
      onSaved(r);
      toast.success(`${label}: the next one is ${example}`);
    } catch {
      /* shown */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-2 items-center gap-3 border-b border-[var(--erp-line)] py-3 last:border-b-0 @min-[900px]:grid-cols-[minmax(0,1.3fr)_120px_120px_120px_minmax(0,1fr)_40px] @min-[900px]:py-2">
      <span className="col-span-2 text-[14px] font-semibold @min-[900px]:col-span-1">{label}</span>
      <label className="flex flex-col gap-1 @min-[900px]:block">
        <span className="text-[12px] font-semibold text-[var(--erp-muted)] @min-[900px]:hidden">Prefix</span>
        <input value={prefix} onChange={(e) => setPrefix(e.target.value)} maxLength={12} aria-label={`${label} prefix`} aria-invalid={badPrefix} className={cn(cellInput, 'font-semibold', badPrefix && 'ring-2 ring-[var(--erp-red)]')} />
      </label>
      <label className="flex flex-col gap-1 @min-[900px]:block">
        <span className="text-[12px] font-semibold text-[var(--erp-muted)] @min-[900px]:hidden">Digits</span>
        <Stepper value={String(w)} onChange={(v) => setWidth(String(Math.min(10, Math.max(1, Number(v) || 1))))} min={1} ariaLabel={`${label} digits`} size="sm" />
      </label>
      <label className="flex flex-col gap-1 @min-[900px]:block">
        <span className="text-[12px] font-semibold text-[var(--erp-muted)] @min-[900px]:hidden">Next number</span>
        <NumberInput value={next} onChange={setNext} ariaLabel={`${label} next number`} decimals={0} size="cell" />
      </label>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="text-[12px] font-semibold text-[var(--erp-muted)] @min-[900px]:hidden">Next one reads</span>
        <span className={cn('num inline-flex h-9 w-fit max-w-full items-center truncate rounded-full px-3 text-[13px] font-bold', back ? 'bg-[var(--erp-red)]/12 text-[var(--erp-red-text)]' : dirty ? 'bg-[var(--erp-accent-soft)] text-[var(--erp-ink)]' : 'bg-[var(--erp-row)] text-[var(--erp-ink)]')}>
          {back ? `Only forward from ${current}` : example}
        </span>
      </span>
      <span className="flex justify-end">
        {dirty && <CircleButton icon={Check} label={`Save ${label}`} variant="dark" size={36} disabled={busy || back || badPrefix} onClick={() => void save()} />}
      </span>
    </div>
  );
}
