/**
 * One build. A planned build shows each component it needs against what the
 * warehouse holds (shortages in red) and its estimated cost; Complete
 * previews the entry (components out at average cost, the finished item in
 * at their cost plus labor and overhead) and posts it. A done build shows
 * what it used, its cost and its entry, and can be voided.
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, Ban, BookOpen, CheckCircle2, Layers, Pencil, Trash2 } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { RecordActivity } from '../../components/Activity.tsx';
import { BooksDetail, ConfirmPosting } from '../../components/Books.tsx';
import { SplitBar } from '../../components/charts.tsx';
import { Menu, ProgressBar, Stepper } from '../../components/controls.tsx';
import { buildStatus } from '../../components/make/parts.tsx';
import { RecordProposals } from '../../components/stock/RecordProposals.tsx';
import { DateField } from '../../components/pickers.tsx';
import { ActorPill, Card, CardHeader, Field, LoadError, Modal, Notice, PageHeader, PageSkeleton, PillButton, PillSelect, StatusPill, TextLink, softArea, softInput, useConfirm } from '../../components/ui.tsx';
import { errMessage, op } from '../../lib/api.ts';
import { dayLabel } from '../../lib/dates.ts';
import { money, plain, plural, price, qty } from '../../lib/format.ts';
import { READS, useLive } from '../../lib/live.ts';
import { can, useMe } from '../../lib/me.ts';
import { back, navigate, useSection } from '../../lib/router.ts';
import type { JournalPreviewLine } from '../../lib/types.ts';
import type { BuildDetail, BuildDoneComponent, BuildDraftComponent, BuildJournal, WarehouseList } from '../../lib/types/stock.ts';
import type { PageProps } from '../../routes.tsx';

function journalLines(j: BuildDetail['journal']): JournalPreviewLine[] {
  if (j === null || !('lines' in j)) return [];
  return (j as BuildJournal).lines.map((l) => ({ account: { id: l.account.id, code: l.account.code, name: l.account.name }, debit: l.debit, credit: l.credit, memo: l.memo, party: typeof l.party === 'string' ? l.party : (l.party?.name ?? '') }));
}

export function BuildPage({ query }: PageProps): React.JSX.Element {
  const id = query.get('id') ?? '';
  const me = useMe();
  useSection('build', 'builds');
  const live = useLive(() => op<BuildDetail>('builds.get', { build: id }, { quiet: true }), ['builds', 'boms', 'bom_lines', ...READS.stock, 'journals'], [id]);
  const b = live.data;
  const [completing, setCompleting] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  const [editing, setEditing] = useState(false);
  const [confirmEl, confirm] = useConfirm();

  if (b === null) {
    return live.error !== null ? (
      <div>
        <PageHeader title="Build" back={() => back('builds')} />
        <LoadError message={live.error} onRetry={live.reload} />
      </div>
    ) : (
      <PageSkeleton />
    );
  }

  const st = buildStatus(b.status);
  const draft = b.status === 'draft';
  const unit = b.item?.unit ?? '';
  const problems = b.problems ?? [];
  const shortfalls = b.shortfalls ?? 0;
  const remove = async (): Promise<void> => {
    if (!(await confirm(`The plan ${b.number} is removed. Nothing was posted, so stock and the books do not change.`, `Delete ${b.number}?`))) return;
    try {
      await op('builds.delete', { build: b.id });
      toast.success(`${b.number} deleted`);
      navigate('builds');
    } catch {
      /* shown */
    }
  };
  const lines = journalLines(b.journal);
  const voidLines = journalLines(b.void_journal);

  return (
    <div>
      <PageHeader
        back={() => back('builds')}
        eyebrow={
          <>
            <span>Build</span>
            <StatusPill tone={st.tone} size="sm">
              {st.label}
            </StatusPill>
            {b.actor === 'agent' && <ActorPill actor="agent" />}
          </>
        }
        title={<span className="num">{b.number}</span>}
        subtitle={`${qty(b.qty)} ${unit} of ${b.item?.name ?? ''} · ${b.warehouse?.name ?? ''} · ${dayLabel(b.date)}`}
        actions={
          <>
            <Menu
              items={[
                { label: 'Edit plan', icon: Pencil, hidden: !b.can.edit, onClick: () => setEditing(true) },
                { label: 'Bill of materials', icon: Layers, hidden: b.bom === null, onClick: () => navigate('bom', { id: b.bom?.id ?? '' }) },
                { label: 'Delete plan', icon: Trash2, danger: true, hidden: !b.can.delete, onClick: () => void remove() },
              ]}
            />
            {b.can.void && (
              <PillButton variant="danger" icon={Ban} onClick={() => setVoiding(true)}>
                Void
              </PillButton>
            )}
            {b.can.complete && (
              <PillButton icon={CheckCircle2} dot onClick={() => setCompleting(true)}>
                Complete build
              </PillButton>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-5 @min-[900px]:grid-cols-12 @min-[900px]:items-start">
        <div className="flex flex-col gap-5 @min-[900px]:col-span-8">
          <RecordProposals match={(p) => p.target.entity === 'builds' && p.target.id === b.id} watch={['builds']} />
          {problems.length > 0 && (
            <Notice tone="warn" icon={AlertTriangle}>
              {problems.join(' ')}
            </Notice>
          )}
          {b.status === 'void' && (
            <Notice tone="neutral" icon={Ban}>
              Voided. The finished goods went back out and the components came back, at the values they moved with.
            </Notice>
          )}

          <Card delay={1}>
            <CardHeader
              title={draft ? 'Components needed' : 'Components used'}
              subtitle={draft ? `Against what ${b.warehouse?.name ?? 'the warehouse'} holds now` : `${plural(b.components.length, 'component')} at average cost`}
              action={draft ? shortfalls > 0 ? <span className="shrink-0 whitespace-nowrap rounded-full bg-[var(--erp-red)]/12 px-3 py-1 text-[12px] font-bold text-[var(--erp-red-text)]">{shortfalls} short</span> : <span className="shrink-0 whitespace-nowrap rounded-full bg-[var(--erp-green)]/12 px-3 py-1 text-[12px] font-bold text-[var(--erp-green-text)]">All there</span> : undefined}
            />
            <ul className="flex flex-col gap-2">
              {draft
                ? (b.components as BuildDraftComponent[]).map((c) => (
                    <li key={c.line} className={cn('rounded-[18px] px-3 py-2.5', c.shortfall > 0 ? 'bg-[var(--erp-red)]/8' : 'bg-[var(--erp-row)]')}>
                      <div className="flex items-center gap-3">
                        <button type="button" onClick={() => navigate('item', { id: c.item.id })} className="min-w-0 flex-1 text-left">
                          <span className="block truncate text-[14px] font-bold hover:underline">{c.item.name}</span>
                          <span className="num block truncate text-[12px] text-[var(--erp-muted)]">
                            {qty(c.per_batch)} per batch · {price(c.avg_cost, b.currency)} each · {money(c.value, b.currency)}
                          </span>
                        </button>
                        <span className="num text-right">
                          <span className="block text-[14px] font-bold">
                            {qty(c.need)} <span className="text-[12px] font-semibold text-[var(--erp-muted)]">of {qty(c.on_hand)} here</span>
                          </span>
                          <span className={cn('block text-[12px] font-semibold', c.shortfall > 0 ? 'text-[var(--erp-red-text)]' : 'text-[var(--erp-muted)]')}>{c.shortfall > 0 ? `${qty(c.shortfall)} ${c.item.unit} short` : 'In stock'}</span>
                        </span>
                      </div>
                      <ProgressBar value={c.need > 0 ? Math.min(1, c.on_hand / c.need) : 1} tone={c.shortfall > 0 ? 'red' : 'ink'} className="mt-2" />
                    </li>
                  ))
                : (b.components as BuildDoneComponent[]).map((c) => (
                    <li key={c.line} className="flex items-center gap-3 rounded-[18px] bg-[var(--erp-row)] px-3 py-2.5">
                      <button type="button" onClick={() => navigate('item', { id: c.item.id })} className="min-w-0 flex-1 text-left">
                        <span className="block truncate text-[14px] font-bold hover:underline">{c.item.name}</span>
                        <span className="num block truncate text-[12px] text-[var(--erp-muted)]">{c.item.sku}</span>
                      </button>
                      <span className="num text-right">
                        <span className="block text-[14px] font-bold">
                          {qty(c.used)} <span className="text-[12px] font-semibold text-[var(--erp-muted)]">{c.item.unit}</span>
                        </span>
                        <span className="block text-[12px] text-[var(--erp-muted)]">{money(c.value, b.currency)}</span>
                      </span>
                    </li>
                  ))}
            </ul>
          </Card>

          {can(me, 'accounting', 'view') && lines.length > 0 && (
            <Card delay={2}>
              <CardHeader
                title="In the books"
                subtitle={
                  b.journal !== null ? (
                    <>
                      Journal{' '}
                      <TextLink onClick={() => navigate('journal', { id: b.journal?.id ?? '' })}>
                        <span className="num">{b.journal.number}</span>
                      </TextLink>
                      {b.void_journal !== null && (
                        <>
                          {', reversed by '}
                          <TextLink onClick={() => navigate('journal', { id: b.void_journal?.id ?? '' })}>
                            <span className="num">{b.void_journal.number}</span>
                          </TextLink>
                        </>
                      )}
                    </>
                  ) : undefined
                }
                icon={BookOpen}
              />
              <BooksDetail lines={lines} currency={b.currency} open label="The entry it posted" />
              {voidLines.length > 0 && (
                <div className="mt-4">
                  <BooksDetail lines={voidLines} currency={b.currency} label="The reversing entry" />
                </div>
              )}
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-5 @min-[900px]:col-span-4">
          <Card tone="dark" delay={1}>
            <p className="text-[12px] font-semibold text-[var(--erp-on-dark-muted)]">{draft ? 'Makes' : b.status === 'void' ? 'Made, then voided' : 'Made'}</p>
            <p className="mt-1 flex items-baseline gap-2">
              <span className="num text-[26px] font-extrabold leading-8 tracking-[-0.02em]">{qty(b.qty)}</span>
              <span className="text-[15px] font-semibold text-[var(--erp-on-dark-muted)]">{unit}</span>
            </p>
            {b.item !== null && (
              <button type="button" onClick={() => navigate('item', { id: b.item?.id ?? '' })} className="mt-0.5 block max-w-full truncate text-left text-[14px] font-semibold hover:underline">
                {b.item.name}
              </button>
            )}
            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="rounded-[18px] bg-[var(--erp-dark-2)] p-3">
                <span className="block text-[12px] text-[var(--erp-on-dark-muted)]">{draft ? 'Estimated cost' : 'Cost'}</span>
                <span className="num block truncate text-[15px] font-bold">{money(b.cost, b.currency)}</span>
              </div>
              <div className="rounded-[18px] bg-[var(--erp-dark-2)] p-3">
                <span className="block text-[12px] text-[var(--erp-on-dark-muted)]">Per unit</span>
                <span className="num block truncate text-[15px] font-bold">{b.unit_cost !== '' ? price(b.unit_cost, b.currency) : '-'}</span>
              </div>
            </div>
            <div className="mt-4">
              <SplitBar
                dark
                parts={[
                  { key: 'comp', label: 'Components', value: b.components_value, valueText: money(b.components_value, b.currency), fill: 'var(--erp-accent)' },
                  { key: 'extra', label: 'Labor and overhead', value: b.extra, valueText: money(b.extra, b.currency), fill: 'var(--erp-on-dark)' },
                ]}
              />
            </div>
            {draft && (
              <p className="mt-4 flex items-center gap-2 text-[13px] font-semibold">
                {b.ready === true ? (
                  <>
                    <CheckCircle2 size={16} className="text-[var(--erp-accent)]" aria-hidden /> Ready to complete
                  </>
                ) : (
                  <>
                    <AlertTriangle size={16} className="text-[var(--erp-red-on-dark)]" aria-hidden /> {shortfalls > 0 ? `Waiting for ${plural(shortfalls, 'component')}` : 'Not ready yet'}
                  </>
                )}
              </p>
            )}
          </Card>

          <Card delay={2}>
            <dl className="flex flex-col gap-2.5 text-[13px]">
              <Row label="Warehouse" value={b.warehouse?.name ?? ''} />
              <Row label={draft ? 'Planned for' : 'Date'} value={dayLabel(b.date)} />
              <Row label="Bill of materials" value={b.bom !== null ? <TextLink onClick={() => navigate('bom', { id: b.bom?.id ?? '' })}>{b.bom.name}</TextLink> : 'Deleted'} />
              <Row label="By" value={b.who} />
            </dl>
            {b.note !== '' && <p className="mt-4 rounded-[16px] bg-[var(--erp-row)] px-3 py-2.5 text-[13px] leading-5">{b.note}</p>}
          </Card>

          <RecordActivity entity="builds" refId={b.id} />
        </div>
      </div>

      <ConfirmPosting
        open={completing}
        onClose={() => setCompleting(false)}
        title={`Complete ${b.number}?`}
        verb="Complete build"
        previewOp="builds.preview-complete"
        runOp="builds.complete"
        params={{ build: b.id }}
        withDate
        defaultDate={b.date}
        onDone={() => {
          toast.success(`${b.number} done: ${qty(b.qty)} ${unit} added to stock`);
          live.reload();
        }}
      />
      <ConfirmPosting
        open={voiding}
        onClose={() => setVoiding(false)}
        title={`Void ${b.number}?`}
        verb="Void build"
        danger
        previewOp="builds.preview-void"
        runOp="builds.void"
        params={{ build: b.id }}
        extraParams={{ reason: reason.trim() === '' ? undefined : reason.trim() }}
        extra={
          <Field label="Why" optional>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2} placeholder="e.g. Built by mistake" aria-label="Why" className={softArea} />
          </Field>
        }
        onDone={() => live.reload()}
      />
      {editing && (
        <EditPlan
          b={b}
          onClose={() => setEditing(false)}
          onSaved={(r) => {
            live.set(r);
            setEditing(false);
          }}
        />
      )}
      {confirmEl}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-[var(--erp-muted)]">{label}</dt>
      <dd className="min-w-0 truncate text-right font-semibold">{value}</dd>
    </div>
  );
}

function EditPlan({ b, onClose, onSaved }: { b: BuildDetail; onClose: () => void; onSaved: (r: BuildDetail) => void }): React.JSX.Element {
  const [count, setCount] = useState(plain(b.qty));
  const [warehouse, setWarehouse] = useState(b.warehouse?.id ?? '');
  const [date, setDate] = useState(b.date);
  const [note, setNote] = useState(b.note);
  const [whs, setWhs] = useState<WarehouseList['warehouses']>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    op<WarehouseList>('warehouses.list', {}, { quiet: true })
      .then((r) => setWhs(r.warehouses.filter((w) => !w.archived)))
      .catch(() => undefined);
  }, []);
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await op<BuildDetail>('builds.update', { build: b.id, qty: count, warehouse, date, note: note.trim() }, { quiet: true });
      toast.success('Plan saved');
      onSaved(r);
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit ${b.number}`}
      footer={
        <>
          <PillButton variant="soft" onClick={onClose}>
            Cancel
          </PillButton>
          <PillButton loading={busy} onClick={() => void save()}>
            Save plan
          </PillButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="How many" hint={b.step !== undefined && b.step > 1 ? `In multiples of ${qty(b.step)}` : undefined}>
          <Stepper value={count} onChange={setCount} fractional={b.item?.fractional === true} min={0} ariaLabel="how many to build" className="self-start" />
        </Field>
        <Field label="Warehouse">
          <PillSelect soft ariaLabel="Warehouse" value={warehouse} onChange={setWarehouse} options={whs.map((w) => ({ value: w.id, label: w.name }))} />
        </Field>
        <Field label="Planned for">
          <DateField value={date} onChange={setDate} ariaLabel="Planned for" />
        </Field>
        <Field label="Note" optional>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} aria-label="Note" className={softInput} />
        </Field>
        {error !== null && (
          <Notice tone="bad" icon={AlertTriangle}>
            {error}
          </Notice>
        )}
      </div>
    </Modal>
  );
}
