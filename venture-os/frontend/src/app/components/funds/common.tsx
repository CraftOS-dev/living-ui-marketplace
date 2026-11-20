/**
 * Funds screens' shared parts: which fund is shown, the fund switch, the
 * readers that every funds view refreshes on, and small readouts.
 */
import { useMemo } from 'react';
import { Lock } from 'lucide-react';
import { Segmented, Tag } from '../ui.tsx';
import { Meter } from '../charts.tsx';
import { useMe } from '../../lib/auth.ts';
import { money, multiple, pct, toMajor } from '../../lib/format.ts';
import { setUi, useUi } from '../../lib/store.ts';
import type { FundRef } from '../../lib/types.ts';
import { METHOD_LABEL } from './types.ts';

/** Collections whose changes refresh the funds views. */
export const FUND_READS = ['ledger', 'marks', 'quarters', 'capital_events', 'capital_lines', 'payments', 'commitments', 'lps', 'entities', 'reports', 'statements', 'reserves', 'scenarios', 'bank_blocks', 'agent_requests', 'nav'];

/** The funds a member may see, funds before SPVs. */
export function useFunds(): FundRef[] {
  const me = useMe();
  return useMemo(() => (me.funds ?? []).filter((f) => (f.kind === 'fund' || f.kind === 'spv') && f.archived !== true).sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'fund' ? -1 : 1)), [me.funds]);
}

/** The fund shown: the route's, else the sidebar scope, else the first. */
export function useFundId(routeFund?: string | undefined): { fundId: string; funds: FundRef[] } {
  const funds = useFunds();
  const ui = useUi();
  const pick = (id: string | undefined): string => (id !== undefined && id !== '' && funds.some((f) => f.id === id) ? id : '');
  const fundId = pick(routeFund) || pick(ui.fund) || (funds[0]?.id ?? '');
  return { fundId, funds };
}

/** A segmented fund switch, only when there is more than one fund. */
export function FundSwitch({ funds, value, onChange }: { funds: FundRef[]; value: string; onChange?: ((id: string) => void) | undefined }): React.JSX.Element | null {
  if (funds.length < 2) return null;
  return (
    <Segmented
      size="sm"
      label="Fund"
      value={value}
      onChange={(v) => {
        setUi({ fund: v });
        onChange?.(v);
      }}
      options={funds.map((f) => ({ value: f.id, label: f.short_name || f.name }))}
      className="self-start"
    />
  );
}

export function mult(e8: number | null | undefined): string | null {
  return e8 === null || e8 === undefined ? null : multiple(e8, 2);
}

export function rate(ppm: number | null | undefined): string | null {
  return ppm === null || ppm === undefined ? null : pct(ppm, 1);
}

export function MethodTag({ method }: { method: string }): React.JSX.Element {
  const tone = method === 'write_off' || method === 'written_off' ? 'bad' : method === 'write_down' ? 'warn' : method === 'cost' ? 'faint' : 'neutral';
  return <Tag tone={tone}>{METHOD_LABEL[method] ?? method}</Tag>;
}

/** Money in progress: the paid share as a bar with its percent. */
export function PaidBar({ paid, total, label, className }: { paid: number; total: number; label?: string | undefined; className?: string | undefined }): React.JSX.Element {
  return <Meter value={total > 0 ? paid : null} max={total > 0 ? total : 1} label={label} tone={paid >= total && total > 0 ? 'good' : 'ink'} className={className ?? 'w-full'} />;
}

/** A change in money with its sign and meaning colour. */
export function Change({ minor, currency }: { minor: number; currency: string }): React.JSX.Element {
  const tone = minor > 0 ? 'text-[var(--vo-good)]' : minor < 0 ? 'text-[var(--vo-bad)]' : 'text-[var(--vo-muted)]';
  return <span className={`vo-mono vo-num ${tone}`}>{minor === 0 ? '0' : money(minor, currency, { compact: true, sign: true, bare: true })}</span>;
}

/** Charts take major units. */
export function major(minor: number, currency: string): number {
  return toMajor(minor, currency);
}

/** Short quarter labels for chart axes: 'Q3 2026' -> "Q3 '26". */
export function shortQ(label: string): string {
  const m = /^Q(\d) (\d{4})$/.exec(label);
  return m ? `Q${m[1]} '${m[2]?.slice(2)}` : label;
}

/** The count of holdings on restricted deals the reader may not see (rows withheld; totals stay the fund's). */
export function HiddenHoldings({ n }: { n: number }): React.JSX.Element | null {
  if (n <= 0) return null;
  return (
    <Tag icon={Lock} tone="faint" title="Holdings on restricted deals">
      {n}
    </Tag>
  );
}
