/**
 * Settings, Fund terms: what notices and fee calls need per fund (legal
 * name, first close, how the preferred return compounds) and the sealed
 * wire details: last four shown, Show with the PIN for five minutes, a
 * change waits for a second member's PIN.
 */
import { useState } from 'react';
import { Check, Eye, Landmark, Pencil } from 'lucide-react';
import { Button, DataTable, DayPicker, Empty, Fact, Field, IconButton, Input, LoadError, More, Notice, Segmented, Sheet, SheetHeader, Skeleton, StatusDot, SubHeader } from '../ui.tsx';
import { op } from '../../lib/api.ts';
import { can, useMe } from '../../lib/auth.ts';
import { fmtDay } from '../../lib/format.ts';
import { act, useOp } from '../../lib/live.ts';

interface Entity {
  id: string;
  kind: string;
  name: string;
  short_name: string;
  legal_name: string;
  currency: string;
  first_close_day: string;
  archived: boolean;
  lpa: { pref_compounding?: 'compound' | 'simple' | undefined } | null;
}

interface Block {
  id: string;
  entity: string;
  status: 'active' | 'pending';
  bank_name: string;
  last4: string;
  changed_by: { id: string; name: string } | null;
  approved_by: { id: string; name: string } | null;
}

function TermsSheet({ e, onClose }: { e: Entity; onClose: () => void }): React.JSX.Element {
  const [legal, setLegal] = useState(e.legal_name);
  const [close, setClose] = useState(e.first_close_day);
  const [comp, setComp] = useState<'compound' | 'simple'>(e.lpa?.pref_compounding === 'simple' ? 'simple' : 'compound');
  const [busy, setBusy] = useState(false);
  const save = async (): Promise<void> => {
    setBusy(true);
    const out = await act([], () => op('entities.save', { entity: e.id, legal_name: legal.trim(), first_close_day: close, lpa: { pref_compounding: comp } }), ['entities']);
    setBusy(false);
    if (out !== null) onClose();
  };
  return (
    <Sheet open onClose={onClose} label={e.name} width={440}>
      <SheetHeader title={e.short_name || e.name} onClose={onClose} />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
        <Field label="Legal name">
          <Input value={legal} onChange={(x) => setLegal(x.target.value)} aria-label="Legal name" placeholder="Northwind Ventures Fund I, L.P." />
        </Field>
        <Field label="First close" tip="Management fees run from this day.">
          <DayPicker value={close} onChange={setClose} label="First close" />
        </Field>
        <More>
          <Field label="Preferred return" tip="How the hurdle grows in the waterfall estimate.">
            <Segmented label="Preferred return" value={comp} onChange={setComp} options={[{ value: 'compound', label: 'Compound' }, { value: 'simple', label: 'Simple' }]} />
          </Field>
        </More>
      </div>
      <div className="flex justify-end gap-2 border-t border-[var(--vo-hair)] px-5 py-3">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" busy={busy} onClick={() => void save()}>
          Save
        </Button>
      </div>
    </Sheet>
  );
}

const WIRE_FIELDS = [
  ['account_name', 'Account name'],
  ['account_number', 'Account number'],
  ['routing', 'Routing'],
  ['swift', 'SWIFT'],
  ['iban', 'IBAN'],
  ['bank_address', 'Bank address'],
] as const;

function WireSheet({ e, blocks, onClose }: { e: Entity; blocks: Block[]; onClose: () => void }): React.JSX.Element {
  const me = useMe();
  const active = blocks.find((b) => b.status === 'active');
  const pending = blocks.find((b) => b.status === 'pending');
  const [shown, setShown] = useState<Record<string, string> | null>(null);
  const [changing, setChanging] = useState(false);
  const [f, setF] = useState<Record<string, string>>({ bank_name: '' });
  const [busy, setBusy] = useState(false);
  const show = async (): Promise<void> => {
    const r = await act([], () => op<{ details: Record<string, string> }>('bank.view', { entity: e.id }), []);
    if (r !== null) {
      setShown(r.details);
      window.setTimeout(() => setShown(null), 5 * 60 * 1000);
    }
  };
  const change = async (): Promise<void> => {
    setBusy(true);
    const out = await act([], () => op('bank.change', { entity: e.id, ...f }), ['bank_blocks']);
    setBusy(false);
    if (out !== null) setChanging(false);
  };
  const mine = pending !== undefined && pending.changed_by?.id === me.member.id;
  return (
    <Sheet open onClose={onClose} label="Wire details" width={460}>
      <SheetHeader title={(e.short_name || e.name) + ' wire'} onClose={onClose} />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
        {!changing && (
          <>
            {active !== undefined ? (
              <div className="flex flex-col gap-2">
                <Fact label="Bank">{active.bank_name}</Fact>
                <Fact label="Account" mono>
                  {shown !== null ? shown['account_number'] || shown['iban'] || '' : active.last4}
                </Fact>
                {shown !== null &&
                  WIRE_FIELDS.filter(([k]) => k !== 'account_number' && (shown[k] ?? '') !== '').map(([k, l]) => (
                    <Fact key={k} label={l} mono={k !== 'bank_address' && k !== 'account_name'}>
                      {shown[k]}
                    </Fact>
                  ))}
                {active.approved_by !== null && <Fact label="Approved">{active.approved_by.name}</Fact>}
              </div>
            ) : (
              <Empty icon={Landmark} title="No wire details" />
            )}
            {pending !== undefined && (
              <Notice
                tone="warn"
                action={
                  !mine ? (
                    <Button size="sm" icon={Check} onClick={() => void act([], () => op('bank.approve', { block: pending.id }), ['bank_blocks'])}>
                      Approve
                    </Button>
                  ) : undefined
                }
              >
                {(pending.bank_name + ' ' + pending.last4).trim()}
              </Notice>
            )}
          </>
        )}
        {changing && (
          <>
            <Field label="Bank">
              <Input value={f['bank_name'] ?? ''} autoFocus onChange={(x) => setF({ ...f, bank_name: x.target.value })} aria-label="Bank" />
            </Field>
            <Field label="Account number">
              <Input className="vo-mono" value={f['account_number'] ?? ''} onChange={(x) => setF({ ...f, account_number: x.target.value })} aria-label="Account number" autoComplete="off" />
            </Field>
            <Field label="Routing">
              <Input className="vo-mono" value={f['routing'] ?? ''} onChange={(x) => setF({ ...f, routing: x.target.value })} aria-label="Routing" autoComplete="off" />
            </Field>
            <More>
              {WIRE_FIELDS.filter(([k]) => k !== 'account_number' && k !== 'routing').map(([k, l]) => (
                <Field key={k} label={l}>
                  <Input value={f[k] ?? ''} onChange={(x) => setF({ ...f, [k]: x.target.value })} aria-label={l} autoComplete="off" />
                </Field>
              ))}
            </More>
          </>
        )}
      </div>
      {can(me, 'funds', 'full') && (
        <div className="flex justify-end gap-2 border-t border-[var(--vo-hair)] px-5 py-3">
          {changing ? (
            <>
              <Button onClick={() => setChanging(false)}>Cancel</Button>
              <Button variant="primary" busy={busy} disabled={(f['bank_name'] ?? '').trim() === '' || ((f['account_number'] ?? '').trim() === '' && (f['iban'] ?? '').trim() === '')} onClick={() => void change()}>
                Save
              </Button>
            </>
          ) : (
            <>
              {active !== undefined && shown === null && (
                <Button icon={Eye} onClick={() => void show()}>
                  Show
                </Button>
              )}
              <Button variant="primary" onClick={() => setChanging(true)}>
                Change
              </Button>
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}

export function FundTerms(): React.JSX.Element {
  const me = useMe();
  const live = useOp<{ entities: Entity[] }>('entities.list', {}, ['entities'], { name: 'funds.terms' });
  const bank = useOp<{ blocks: Block[] }>('bank.list', {}, ['bank_blocks'], { name: 'bank.list.all' });
  const [terms, setTerms] = useState<Entity | null>(null);
  const [wire, setWire] = useState<Entity | null>(null);
  const edit = can(me, 'funds', 'full') || can(me, 'settings', 'full');
  if (live.data === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Skeleton className="h-40" />;
  const rows = live.data.entities.filter((x) => (x.kind === 'fund' || x.kind === 'spv') && !x.archived);
  const blocks = bank.data?.blocks ?? [];
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <SubHeader title="Fund terms" />
      <div className="vo-panel min-w-0 overflow-hidden">
        <DataTable<Entity>
          label="Fund terms"
          rows={rows}
          rowKey={(r) => r.id}
          onRowClick={edit ? (r) => setTerms(r) : undefined}
          stickyTop={0}
          empty={<Empty icon={Landmark} title="No funds yet" />}
          columns={[
            { key: 'name', label: 'Fund', fixed: true, phone: 'title', render: (r) => r.short_name || r.name },
            { key: 'close', label: 'First close', mono: true, phone: 'sub', render: (r) => fmtDay(r.first_close_day) },
            { key: 'pref', label: 'Preferred', phone: 'hide', render: (r) => (r.lpa?.pref_compounding === 'simple' ? 'Simple' : 'Compound') },
            {
              key: 'wire',
              label: 'Wire',
              width: '170px',
              phone: 'end',
              render: (r) => {
                const a = blocks.find((b) => b.entity === r.id && b.status === 'active');
                const p = blocks.find((b) => b.entity === r.id && b.status === 'pending');
                return (
                  <span className="flex items-center justify-end gap-2">
                    {p !== undefined ? <StatusDot tone="warn" label="Waiting" /> : a !== undefined ? <span className="vo-mono text-[12px]">{a.last4}</span> : <StatusDot tone="faint" label="None" />}
                    <IconButton icon={Pencil} label="Wire details" size={28} onRow onClick={(ev) => (ev.stopPropagation(), setWire(r))} />
                  </span>
                );
              },
            },
          ]}
        />
      </div>
      {terms !== null && <TermsSheet e={terms} onClose={() => setTerms(null)} />}
      {wire !== null && <WireSheet e={wire} blocks={blocks.filter((b) => b.entity === wire.id)} onClose={() => setWire(null)} />}
    </div>
  );
}
