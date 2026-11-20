/**
 * LPs of a fund: commitment, called, distributed, unfunded and NAV share in
 * 36px rows; an LP opens its page. Add LP is one sheet: name, commitment,
 * email (the rest behind More).
 */
import { useState } from 'react';
import { Plus, Users } from 'lucide-react';
import { Avatar, Button, ChipPicker, DataTable, DayPicker, Empty, Field, Input, LoadError, MoneyInput, More, Panel, PctInput, Sheet, SheetHeader, Skeleton, Tag, Toggle } from '../ui.tsx';
import { op } from '../../lib/api.ts';
import { can, useMe } from '../../lib/auth.ts';
import { majorParam, money, pct } from '../../lib/format.ts';
import { act, useOp } from '../../lib/live.ts';
import { FUND_READS } from './common.tsx';
import type { FundView, LpRow } from './types.ts';

const KINDS = [
  { value: 'endowment', label: 'Endowment' },
  { value: 'pension', label: 'Pension' },
  { value: 'family_office', label: 'Family office' },
  { value: 'fund_of_funds', label: 'Fund of funds' },
  { value: 'foundation', label: 'Foundation' },
  { value: 'individual', label: 'Individual' },
  { value: 'corporate', label: 'Corporate' },
  { value: 'gp', label: 'GP' },
  { value: 'other', label: 'Other' },
] as const;
type Kind = (typeof KINDS)[number]['value'];

const SIDE = [
  { value: 'mfn', label: 'MFN' },
  { value: 'fee_discount', label: 'Fee discount' },
  { value: 'co_invest', label: 'Co-invest' },
  { value: 'reporting', label: 'Reporting' },
  { value: 'excuse', label: 'Excuse' },
] as const;

export interface LpEdit {
  id: string;
  name: string;
  kind: string;
  email: string;
  commitment_minor: number | null;
  fee_paying: boolean;
  fee_rate_ppm: number | null;
  waiver_ppm: number | null;
  side_letter: string[];
  closing_day: string;
}

/** Add or change an LP and its commitment to this fund. */
export function LpSheet({ fund, lp, onClose }: { fund: { id: string; currency: string }; lp: LpEdit | null; onClose: () => void }): React.JSX.Element {
  const [name, setName] = useState(lp?.name ?? '');
  const [amount, setAmount] = useState<number | null>(lp?.commitment_minor ?? null);
  const [email, setEmail] = useState(lp?.email ?? '');
  const [kind, setKind] = useState<Kind | ''>((lp?.kind as Kind | undefined) ?? '');
  const [feePaying, setFeePaying] = useState(lp?.fee_paying ?? true);
  const [feeRate, setFeeRate] = useState<number | null>(lp?.fee_rate_ppm ?? null);
  const [waiver, setWaiver] = useState<number | null>(lp?.waiver_ppm ?? null);
  const [side, setSide] = useState<string[]>(lp?.side_letter ?? []);
  const [closing, setClosing] = useState(lp?.closing_day ?? '');
  const [busy, setBusy] = useState(false);
  const save = async (): Promise<void> => {
    setBusy(true);
    const out = await act(
      [],
      async () => {
        const contacts = email.trim() !== '' ? JSON.stringify([{ name: '', email: email.trim(), primary: true }]) : undefined;
        const r = await op<{ lp: { id: string } }>('lps.upsert', { lp: lp?.id || undefined, name: name.trim(), kind: kind || undefined, contacts: lp === null || contacts !== undefined ? contacts : undefined });
        if (amount !== null) {
          await op('commitments.save', { fund: fund.id, lp: r.lp.id, amount: majorParam(amount, fund.currency), fee_paying: feePaying, fee_rate: feeRate === null ? '' : String(feeRate / 10000), waiver: waiver === null ? '0' : String(waiver / 10000), side_letter: JSON.stringify(side), closing_day: closing || undefined });
        }
        return r;
      },
      ['lps', 'commitments'],
    );
    setBusy(false);
    if (out !== null) onClose();
  };
  return (
    <Sheet open onClose={onClose} label={lp === null ? 'Add LP' : name} width={460}>
      <SheetHeader title={lp === null ? 'Add LP' : name} onClose={onClose} />
      <div className="vo-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
        <Field label="Name">
          <Input value={name} autoFocus={lp === null} onChange={(e) => setName(e.target.value)} aria-label="Name" placeholder="Alpine Endowment" />
        </Field>
        <Field label="Commitment">
          <MoneyInput value={amount} onChange={setAmount} currency={fund.currency} label="Commitment" />
        </Field>
        <Field label="Notices to" tip="The email that receives capital notices and quarterly packs.">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Notices to" placeholder="ir@lp.example" />
        </Field>
        <More>
          <Field label="Kind">
            <ChipPicker label="Kind" options={[...KINDS]} value={kind} onChange={setKind} />
          </Field>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[13px]">Fee-paying</span>
            <Toggle checked={feePaying} onChange={setFeePaying} label="Fee-paying" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Own fee rate" tip="Leave empty to use the fund's rate.">
              <PctInput value={feeRate} onChange={setFeeRate} label="Own fee rate" />
            </Field>
            <Field label="Waiver" tip="Share of the fee waived.">
              <PctInput value={waiver} onChange={setWaiver} label="Waiver" />
            </Field>
          </div>
          <Field label="Side letter">
            <ChipPicker multiple label="Side letter" options={SIDE.map((x): { value: string; label: string } => ({ value: x.value, label: x.label }))} value={side} onChange={setSide} />
          </Field>
          <Field label="Closing">
            <DayPicker value={closing} onChange={setClosing} label="Closing" clearable />
          </Field>
        </More>
      </div>
      <div className="flex justify-end gap-2 border-t border-[var(--vo-hair)] px-5 py-3">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" busy={busy} disabled={name.trim() === ''} onClick={() => void save()}>
          Save
        </Button>
      </div>
    </Sheet>
  );
}

export function LpsTab({ fund }: { fund: FundView }): React.JSX.Element {
  const me = useMe();
  const live = useOp<{ lps: LpRow[]; totals: { commitment_minor: number } }>('lps.list', { fund: fund.id, limit: 500 }, FUND_READS, { name: 'lps.list' });
  const [adding, setAdding] = useState(false);
  const cur = fund.currency;
  const m = (v: number): string => money(v, cur, { compact: true, bare: true });
  const edit = can(me, 'lps', 'edit');
  if (live.data === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Skeleton className="h-60" />;
  const rows = live.data.lps;
  return (
    <>
      <Panel flush aside={edit && rows.length > 0 ? <Button size="sm" icon={Plus} onClick={() => setAdding(true)}>Add LP</Button> : undefined}>
        <DataTable<LpRow>
          label="LPs"
          rows={rows}
          rowKey={(r) => r.id}
          rowHref={(r) => '#/funds/lps/' + r.id}
          stickyTop={0}
          initialSort={{ key: 'commitment', dir: 'desc' }}
          empty={<Empty icon={Users} title="No LPs yet" action={edit ? <Button icon={Plus} onClick={() => setAdding(true)}>Add LP</Button> : undefined} />}
          columns={[
            {
              key: 'name',
              label: 'LP',
              width: 'minmax(200px,2fr)',
              fixed: true,
              phone: 'title',
              sort: (r) => r.name,
              render: (r) => (
                <span className="flex min-w-0 items-center gap-2">
                  <Avatar name={r.name} size={22} square />
                  <span className="vo-wrap min-w-0 truncate">{r.name}</span>
                  {r.status === 'soft' && <Tag tone="warn">Soft</Tag>}
                  {!r.fee_paying && <Tag tone="faint">No fee</Tag>}
                </span>
              ),
            },
            { key: 'commitment', label: 'Commitment', align: 'right', mono: true, sort: (r) => r.commitment_minor, render: (r) => m(r.commitment_minor) },
            { key: 'called', label: 'Called', align: 'right', mono: true, sort: (r) => r.called_minor, render: (r) => (r.status === 'soft' ? '' : m(r.called_minor)), phone: 'end' },
            { key: 'pct', label: 'Called %', align: 'right', mono: true, optional: true, sort: (r) => r.called_ppm ?? 0, render: (r) => (r.called_ppm === null ? '' : pct(r.called_ppm, 1)) },
            { key: 'dist', label: 'Distributed', align: 'right', mono: true, sort: (r) => r.distributed_minor, render: (r) => (r.status === 'soft' ? '' : m(r.distributed_minor)), phone: 'hide' },
            { key: 'unfunded', label: 'Unfunded', align: 'right', mono: true, sort: (r) => r.unfunded_minor, render: (r) => m(r.unfunded_minor), phone: 'hide' },
            { key: 'nav', label: 'NAV share', align: 'right', mono: true, sort: (r) => r.nav_share_minor, render: (r) => (r.status === 'soft' ? '' : m(r.nav_share_minor)), phone: 'hide' },
          ]}
        />
      </Panel>
      {adding && <LpSheet fund={fund} lp={null} onClose={() => setAdding(false)} />}
    </>
  );
}
