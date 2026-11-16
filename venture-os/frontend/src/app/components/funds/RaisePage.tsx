/**
 * The fund raise: LP prospects by stage (drag to move) with target and
 * soft-circled amounts in mono, and signed plus soft against the target as
 * one bar. Add prospect is one sheet; a card opens its soft circle.
 */
import { useState } from 'react';
import { Handshake, Plus } from 'lucide-react';
import { Avatar, Board, Button, Empty, Field, Input, LoadError, MoneyInput, PageBody, PageHeader, Panel, Sheet, SheetHeader, Skeleton } from '../ui.tsx';
import { Meter } from '../charts.tsx';
import { op } from '../../lib/api.ts';
import { can, useMe } from '../../lib/auth.ts';
import type { PageProps } from '../../lib/contract.ts';
import { majorParam, money } from '../../lib/format.ts';
import { act, patch, useOp } from '../../lib/live.ts';
import { getUi } from '../../lib/store.ts';
import { FUND_READS, FundSwitch, useFundId } from './common.tsx';

interface Prospect {
  id: string;
  number: string;
  title: string;
  company: { id: string; name: string } | null;
  stage: string;
  target_minor: number;
  soft_minor: number;
  commitment_status: string;
  stalled: boolean;
}

interface RaiseBoard {
  fund: { id: string; name: string; currency: string };
  stages: { key: string; label: string; prospects: Prospect[]; target_minor: number; soft_minor: number }[];
  totals: { target_minor: number; signed_minor: number; soft_minor: number; pipeline_minor: number };
}

function AddSheet({ fund, currency, onClose }: { fund: string; currency: string; onClose: () => void }): React.JSX.Element {
  const [company, setCompany] = useState('');
  const [target, setTarget] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (): Promise<void> => {
    setBusy(true);
    const out = await act([], () => op('raise.add', { fund, company: company.trim(), target: majorParam(target, currency) }), ['deals', 'commitments']);
    setBusy(false);
    if (out !== null) onClose();
  };
  return (
    <Sheet open onClose={onClose} label="Add prospect" width={420}>
      <SheetHeader title="Add prospect" onClose={onClose} />
      <div className="flex flex-col gap-4 p-5">
        <Field label="LP">
          <Input value={company} autoFocus onChange={(e) => setCompany(e.target.value)} aria-label="LP" placeholder="Granite Pension or granite.example" />
        </Field>
        <Field label="Target">
          <MoneyInput value={target} onChange={setTarget} currency={currency} label="Target" />
        </Field>
      </div>
      <div className="mt-auto flex justify-end gap-2 border-t border-[var(--vo-hair)] px-5 py-3">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" busy={busy} disabled={company.trim() === ''} onClick={() => void save()}>
          Add
        </Button>
      </div>
    </Sheet>
  );
}

function SoftSheet({ p, currency, onClose }: { p: Prospect; currency: string; onClose: () => void }): React.JSX.Element {
  const [amount, setAmount] = useState<number | null>(p.soft_minor > 0 ? p.soft_minor : p.target_minor > 0 ? p.target_minor : null);
  const [busy, setBusy] = useState(false);
  const save = async (): Promise<void> => {
    setBusy(true);
    const out = await act([patch(p.id, { soft_minor: amount ?? 0 })], () => op('raise.soft', { deal: p.id, amount: majorParam(amount, currency) }), ['commitments', 'lps']);
    setBusy(false);
    if (out !== null) onClose();
  };
  return (
    <Sheet open onClose={onClose} label={p.title} width={420}>
      <SheetHeader title={p.title} onClose={onClose} />
      <div className="flex flex-col gap-4 p-5">
        <Field label="Soft circle">
          <MoneyInput value={amount} onChange={setAmount} currency={currency} label="Soft circle" autoFocus />
        </Field>
      </div>
      <div className="mt-auto flex justify-end gap-2 border-t border-[var(--vo-hair)] px-5 py-3">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" busy={busy} disabled={amount === null || amount <= 0 || p.commitment_status === 'signed'} onClick={() => void save()}>
          Save
        </Button>
      </div>
    </Sheet>
  );
}

export function RaisePage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const all = useFundId(query.get('fund') ?? undefined);
  const funds = all.funds;
  const raising = funds.find((f) => f.status === 'raising');
  const fundId = query.get('fund') ?? (raising !== undefined && getUi().fund === '' ? raising.id : all.fundId);
  const live = useOp<RaiseBoard>('raise.board', { fund: fundId }, FUND_READS.concat(['deals', 'stage_events']), { name: 'raise.board', skip: fundId === '' });
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<Prospect | null>(null);
  const d = live.data;
  const edit = can(me, 'lps', 'edit');
  const cur = d?.fund.currency ?? 'USD';
  const c = (v: number): string => money(v, cur, { compact: true });
  return (
    <>
      <PageHeader title="Fund raise" back="#/funds">
        {edit && d !== null && (
          <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>
            Add prospect
          </Button>
        )}
      </PageHeader>
      <PageBody wide>
        <FundSwitch funds={funds} value={fundId} />
        {d === null && (live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Skeleton className="h-80" />)}
        {d !== null && (
          <>
            <Panel>
              <div className="flex min-w-0 flex-wrap items-end gap-x-8 gap-y-3">
                <div className="min-w-0 flex-1">
                  <Meter value={d.totals.signed_minor + d.totals.soft_minor} max={d.totals.target_minor || 1} label="Raised" height={8} marks={d.totals.signed_minor > 0 && d.totals.target_minor > 0 ? [{ value: d.totals.signed_minor, label: 'Signed', tone: 'ink' }] : undefined} />
                </div>
                <div className="vo-mono vo-num flex gap-6 text-[13px]">
                  <span>
                    <span className="mr-1.5 font-sans text-[12px] text-[var(--vo-muted)]">Signed</span>
                    {c(d.totals.signed_minor)}
                  </span>
                  <span>
                    <span className="mr-1.5 font-sans text-[12px] text-[var(--vo-muted)]">Soft</span>
                    {c(d.totals.soft_minor)}
                  </span>
                  <span>
                    <span className="mr-1.5 font-sans text-[12px] text-[var(--vo-muted)]">Target</span>
                    {c(d.totals.target_minor)}
                  </span>
                </div>
              </div>
            </Panel>
            {d.stages.every((s) => s.prospects.length === 0) ? (
              <Empty icon={Handshake} title="No prospects yet" action={edit ? <Button icon={Plus} onClick={() => setAdding(true)}>Add prospect</Button> : undefined} />
            ) : (
              <Board<Prospect>
                sortable={false}
                label="Fund raise"
                columns={d.stages.map((s) => ({ key: s.key, label: s.label, items: s.prospects }))}
                itemKey={(p) => p.id}
                stalled={(p) => p.stalled}
                onOpen={edit ? (p) => setOpen(p) : undefined}
                onMove={edit ? (id, to) => void act([patch(id, { stage: to })], () => op('raise.move', { deal: id, stage: to }), ['deals', 'stage_events']) : undefined}
                renderCard={(p) => (
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <Avatar name={p.title} size={20} square />
                      <span className="vo-wrap min-w-0 truncate text-[13px] font-medium">{p.title}</span>
                    </div>
                    <div className="vo-mono vo-num flex justify-between text-[12px] text-[var(--vo-ink-2)]">
                      <span>{p.target_minor > 0 ? c(p.target_minor) : ''}</span>
                      {p.soft_minor > 0 && <span className="text-[var(--vo-b)]">{c(p.soft_minor)}</span>}
                    </div>
                  </div>
                )}
              />
            )}
          </>
        )}
      </PageBody>
      {adding && d !== null && <AddSheet fund={d.fund.id} currency={cur} onClose={() => setAdding(false)} />}
      {open !== null && <SoftSheet p={open} currency={cur} onClose={() => setOpen(null)} />}
    </>
  );
}
