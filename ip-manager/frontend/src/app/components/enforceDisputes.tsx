/**
 * Disputes: oppositions, cancellations, litigation, takedowns and letters,
 * whether we attack or defend. Each dispute keeps its own deadlines and
 * documents next to the facts of the case.
 */
import { useMemo, useState } from 'react';
import { CalendarPlus, Gavel, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button, Dialog, Drawer, Input, Select, Textarea, toast, useConfirm } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { createRecord, deleteRecord, q, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { d10, fmtDate, toPb } from '../lib/format.ts';
import { DISPUTE_TYPE_LABEL, KIND_HELP } from '../lib/labels.ts';
import type { Tone } from '../lib/labels.ts';
import { href, useHashParam } from '../lib/router.ts';
import type { DeadlineRec, DisputeRec, FamilyRec, MatterRec } from '../lib/types.ts';
import { DataTable } from './DataTable.tsx';
import type { Col } from './DataTable.tsx';
import { DeadlineList, useDeadlineActions } from './deadlines.tsx';
import { DocumentsPanel } from './documents.tsx';
import { RecordPicker, UserSelect } from './pickers.tsx';
import { EmptyHint, ErrorBox, Fact, FactGrid, Field, Loading, Pill, Prose, Ref, Section, Segmented, Tag } from './ui.tsx';

export type DisputeX = DisputeRec & { expand?: { matter?: MatterRec; family?: FamilyRec } };
type DisputeStatus = DisputeRec['status'];
type DisputeType = DisputeRec['dispute_type'];

export const DISPUTE_STATUS_LABEL: Record<DisputeStatus, string> = {
  monitoring: 'Monitoring',
  pending: 'Pending',
  active: 'Active',
  settled: 'Settled',
  won: 'Won',
  lost: 'Lost',
  withdrawn: 'Withdrawn',
  closed: 'Closed',
};

export const DISPUTE_STATUS_TONE: Record<DisputeStatus, Tone> = {
  monitoring: 'neutral',
  pending: 'info',
  active: 'warn',
  settled: 'good',
  won: 'good',
  lost: 'bad',
  withdrawn: 'neutral',
  closed: 'neutral',
};

const ROLE_TEXT: Record<DisputeRec['role'], string> = {
  offense: 'We attack',
  defense: 'We defend',
};

const OPEN_STATUSES: DisputeStatus[] = ['monitoring', 'pending', 'active'];

type Scope = 'open' | 'closed' | 'all';

function StatusPill({ status }: { status: DisputeStatus }): React.JSX.Element {
  return <Pill tone={DISPUTE_STATUS_TONE[status] ?? 'neutral'}>{DISPUTE_STATUS_LABEL[status] ?? status}</Pill>;
}

/* ------------------------------------------------------------------ */
/* Tab                                                                 */
/* ------------------------------------------------------------------ */

export function DisputesTab(): React.JSX.Element {
  const { can } = useApp();
  const list = useCollection<DisputeX>('disputes', { sort: '-created', expand: 'matter,family' });
  const [openId, setOpenId] = useHashParam('dispute', '');
  const [scopeRaw, setScope] = useHashParam('dstatus', 'open');
  const scope: Scope = scopeRaw === 'closed' || scopeRaw === 'all' ? scopeRaw : 'open';
  const [editing, setEditing] = useState<DisputeX | 'new' | null>(null);

  const counts = useMemo(() => {
    const open = list.records.filter((d) => OPEN_STATUSES.includes(d.status)).length;
    return { open, closed: list.records.length - open, all: list.records.length };
  }, [list.records]);

  const rows = useMemo(
    () => list.records.filter((d) => scope === 'all' || (scope === 'open' ? OPEN_STATUSES.includes(d.status) : !OPEN_STATUSES.includes(d.status))),
    [list.records, scope],
  );

  const open = openId !== '' ? (list.records.find((d) => d.id === openId) ?? null) : null;

  const columns: Col<DisputeX>[] = [
    {
      key: 'title',
      label: 'Dispute',
      render: (d) => (
        <div className="min-w-0">
          <div className="font-medium">{d.title}</div>
          {d.their_mark !== '' && <div className="truncate text-xs text-[var(--agent-app-muted)]">Their mark: {d.their_mark}</div>}
        </div>
      ),
    },
    { key: 'dispute_type', label: 'Type', value: (d) => DISPUTE_TYPE_LABEL[d.dispute_type] ?? d.dispute_type },
    { key: 'role', label: 'Role', value: (d) => ROLE_TEXT[d.role] ?? d.role, render: (d) => <Tag>{ROLE_TEXT[d.role] ?? d.role}</Tag> },
    {
      key: 'matter',
      label: 'Our right',
      value: (d) => d.expand?.matter?.ref ?? d.expand?.family?.title ?? '',
      render: (d) =>
        d.expand?.matter !== undefined ? (
          <a href={href('matter', d.expand.matter.id)} className="hover:underline" onClick={(e) => e.stopPropagation()}>
            <Ref>{d.expand.matter.ref}</Ref>
          </a>
        ) : d.expand?.family !== undefined ? (
          <a href={href('family', d.expand.family.id)} className="hover:underline" onClick={(e) => e.stopPropagation()}>
            {d.expand.family.title}
          </a>
        ) : (
          <span className="text-[var(--agent-app-muted)]">-</span>
        ),
    },
    { key: 'other_party', label: 'Other party', render: (d) => <span className="line-clamp-2 max-w-56">{d.other_party || '-'}</span> },
    { key: 'forum', label: 'Forum', render: (d) => <span className="line-clamp-2 max-w-56">{d.forum || '-'}</span> },
    { key: 'proceeding_no', label: 'Proceeding no.', render: (d) => (d.proceeding_no !== '' ? <span className="font-mono text-xs">{d.proceeding_no}</span> : <span className="text-[var(--agent-app-muted)]">-</span>) },
    { key: 'status', label: 'Status', value: (d) => DISPUTE_STATUS_LABEL[d.status] ?? d.status, render: (d) => <StatusPill status={d.status} /> },
    {
      key: 'filed_date',
      label: 'Filed',
      value: (d) => d10(d.filed_date),
      render: (d) => (d10(d.filed_date) !== '' ? <span className="whitespace-nowrap tabular-nums">{fmtDate(d.filed_date)}</span> : <span className="text-[var(--agent-app-muted)]">-</span>),
    },
    { key: 'counsel', label: 'Counsel', optional: true },
  ];

  return (
    <div className="flex flex-col gap-4">
      {list.loading && list.records.length === 0 ? (
        <Loading />
      ) : list.error !== null ? (
        <ErrorBox message={list.error} onRetry={list.refresh} />
      ) : (
        <Section
          title="Disputes"
          meta={String(list.records.length)}
          flush
          actions={
            can.edit ? (
              <Button size="sm" onClick={() => setEditing('new')}>
                <Plus size={13} aria-hidden /> New dispute
              </Button>
            ) : undefined
          }
        >
          <DataTable<DisputeX>
            tableId="enforce-disputes"
            rows={rows}
            columns={columns}
            exportName={`disputes-${scope}`}
            onRowClick={(d) => setOpenId(d.id)}
            toolbar={
              <Segmented<Scope>
                size="sm"
                value={scope}
                ariaLabel="Show disputes"
                options={[
                  { value: 'open', label: `Open ${counts.open}` },
                  { value: 'closed', label: `Closed ${counts.closed}` },
                  { value: 'all', label: `All ${counts.all}` },
                ]}
                onChange={setScope}
              />
            }
            empty={
              list.records.length === 0 ? (
                <EmptyHint
                  icon={Gavel}
                  title="No disputes"
                  message="Track oppositions, cancellations, litigation, takedowns and cease-and-desist letters, with their deadlines and documents. Watch hits can open one directly."
                  action={can.edit ? <Button onClick={() => setEditing('new')}>New dispute</Button> : undefined}
                />
              ) : (
                <EmptyHint compact title={scope === 'open' ? 'No open disputes' : 'No closed disputes'} action={<Button size="sm" variant="outline" onClick={() => setScope('all')}>Show all disputes</Button>} />
              )
            }
          />
        </Section>
      )}

      {open !== null && <DisputeDrawer key={open.id} d={open} onClose={() => setOpenId('')} onEdit={() => setEditing(open)} />}
      {editing !== null && (
        <DisputeDialog
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(rec) => {
            list.refresh();
            if (editing === 'new') setOpenId(rec.id);
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Create / edit                                                       */
/* ------------------------------------------------------------------ */

interface DisputeForm {
  title: string;
  dispute_type: DisputeType;
  role: DisputeRec['role'];
  status: DisputeStatus;
  matter: string;
  family: string;
  other_party: string;
  their_mark: string;
  forum: string;
  proceeding_no: string;
  filed_date: string;
  counsel: string;
  outcome: string;
  notes: string;
}

function DisputeDialog({ initial, onClose, onSaved }: { initial: DisputeX | null; onClose: () => void; onSaved: (rec: DisputeRec) => void }): React.JSX.Element {
  const [f, setF] = useState<DisputeForm>(() => ({
    title: initial?.title ?? '',
    dispute_type: initial?.dispute_type ?? 'opposition',
    role: initial?.role ?? 'offense',
    status: initial?.status ?? 'pending',
    matter: initial?.matter ?? '',
    family: initial?.family ?? '',
    other_party: initial?.other_party ?? '',
    their_mark: initial?.their_mark ?? '',
    forum: initial?.forum ?? '',
    proceeding_no: initial?.proceeding_no ?? '',
    filed_date: d10(initial?.filed_date ?? ''),
    counsel: initial?.counsel ?? '',
    outcome: initial?.outcome ?? '',
    notes: initial?.notes ?? '',
  }));
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof DisputeForm>(k: K, v: DisputeForm[K]): void => setF((cur) => ({ ...cur, [k]: v }));

  const submit = async (): Promise<void> => {
    if (f.title.trim() === '') {
      toast.error('Give the dispute a title.');
      return;
    }
    setBusy(true);
    const body = { ...f, title: f.title.trim(), filed_date: toPb(f.filed_date) };
    try {
      const rec = initial === null ? await createRecord<DisputeRec>('disputes', body) : await updateRecord<DisputeRec>('disputes', initial.id, body);
      toast.success(initial === null ? 'Dispute created' : 'Dispute saved');
      onSaved(rec);
      onClose();
    } catch {
      /* toast shown by the client */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={initial === null ? 'New dispute' : 'Edit dispute'}
      className="w-[min(94vw,44rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={f.title.trim() === ''}>
            {initial === null ? 'Create dispute' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="flex max-h-[65vh] flex-col gap-3 overflow-y-auto pr-1">
        <Input label="Title" value={f.title} maxLength={300} autoFocus placeholder="For example: Opposition against STARFALLEN (EUIPO)" onChange={(e) => set('title', e.target.value)} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Select
            label="Type"
            value={f.dispute_type}
            options={Object.entries(DISPUTE_TYPE_LABEL).map(([value, label]) => ({ value, label }))}
            onChange={(e) => set('dispute_type', e.target.value as DisputeType)}
          />
          <Select
            label="Our role"
            value={f.role}
            options={[
              { value: 'offense', label: 'We attack' },
              { value: 'defense', label: 'We defend' },
            ]}
            onChange={(e) => set('role', e.target.value as DisputeRec['role'])}
          />
          <Select
            label="Status"
            value={f.status}
            options={(Object.keys(DISPUTE_STATUS_LABEL) as DisputeStatus[]).map((s) => ({ value: s, label: DISPUTE_STATUS_LABEL[s] }))}
            onChange={(e) => set('status', e.target.value as DisputeStatus)}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <RecordPicker<MatterRec>
            collection="matters"
            value={f.matter}
            onChange={(id) => set('matter', id)}
            label="Our right (matter)"
            placeholder="Search by reference, title or number"
            searchFields={['ref', 'title', 'application_no', 'registration_no']}
            labelOf={(m) => `${m.ref} · ${m.title}`}
          />
          <RecordPicker<FamilyRec>
            collection="families"
            value={f.family}
            onChange={(id) => set('family', id)}
            label="Our family or mark"
            placeholder="Search families and marks"
            searchFields={['title', 'word_element']}
            labelOf={(x) => x.title}
          />
          <Input label="Other party" value={f.other_party} maxLength={300} onChange={(e) => set('other_party', e.target.value)} />
          <Input label="Their mark or product" value={f.their_mark} maxLength={300} onChange={(e) => set('their_mark', e.target.value)} />
          <Input label="Forum" value={f.forum} maxLength={200} placeholder="Office, board, court or platform" onChange={(e) => set('forum', e.target.value)} />
          <Input label="Proceeding number" value={f.proceeding_no} maxLength={80} onChange={(e) => set('proceeding_no', e.target.value)} />
          <Input label="Filed on" type="date" value={f.filed_date} onChange={(e) => set('filed_date', e.target.value)} />
          <Input label="Counsel" value={f.counsel} maxLength={200} placeholder="Firm or person handling it" onChange={(e) => set('counsel', e.target.value)} />
        </div>
        <Textarea label="Outcome" rows={2} value={f.outcome} onChange={(e) => set('outcome', e.target.value)} placeholder="Decision, settlement terms, what was agreed" />
        <Textarea label="Notes" rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Detail drawer                                                       */
/* ------------------------------------------------------------------ */

function DisputeDrawer({ d, onClose, onEdit }: { d: DisputeX; onClose: () => void; onEdit: () => void }): React.JSX.Element {
  const { can } = useApp();
  const deadlines = useCollection<DeadlineRec>('deadlines', { filter: `dispute = ${q(d.id)}`, sort: 'due_date' });
  const dl = useDeadlineActions(deadlines.refresh);
  const [adding, setAdding] = useState(false);
  const [confirmEl, confirm] = useConfirm();
  const matter = d.expand?.matter;
  const family = d.expand?.family;

  const setStatus = async (status: DisputeStatus): Promise<void> => {
    try {
      await updateRecord('disputes', d.id, { status });
      toast.success(`Status: ${DISPUTE_STATUS_LABEL[status]}`);
    } catch {
      /* toast shown by the client */
    }
  };

  const remove = async (): Promise<void> => {
    const n = deadlines.records.length;
    if (!(await confirm(`Delete "${d.title}"?${n > 0 ? ` Its ${n} deadline${n === 1 ? ' is' : 's are'} deleted too.` : ''} Documents are kept.`, 'Delete dispute'))) return;
    try {
      await deleteRecord('disputes', d.id);
      toast.success('Dispute deleted');
      onClose();
    } catch {
      /* toast shown by the client */
    }
  };

  return (
    <Drawer open onClose={onClose} title={d.title} width={760}>
      {confirmEl}
      {dl.dialogs}
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={d.status} />
            <Tag>{DISPUTE_TYPE_LABEL[d.dispute_type] ?? d.dispute_type}</Tag>
            <Tag>{ROLE_TEXT[d.role] ?? d.role}</Tag>
          </div>
          {can.edit && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="w-36">
                <Select
                  aria-label="Status"
                  value={d.status}
                  options={(Object.keys(DISPUTE_STATUS_LABEL) as DisputeStatus[]).map((s) => ({ value: s, label: DISPUTE_STATUS_LABEL[s] }))}
                  onChange={(e) => void setStatus(e.target.value as DisputeStatus)}
                />
              </div>
              <Button size="sm" variant="outline" onClick={onEdit}>
                <Pencil size={13} aria-hidden /> Edit
              </Button>
              {can.manage && (
                <Button size="sm" variant="ghost" className="text-red-600" onClick={() => void remove()} aria-label="Delete dispute">
                  <Trash2 size={13} aria-hidden />
                </Button>
              )}
            </div>
          )}
        </div>

        <FactGrid cols={2}>
          <Fact
            label="Our right"
            value={
              matter !== undefined ? (
                <a href={href('matter', matter.id)} className="hover:underline" onClick={onClose}>
                  <Ref>{matter.ref}</Ref> {matter.title}
                </a>
              ) : (
                ''
              )
            }
          />
          <Fact
            label="Family or mark"
            value={
              family !== undefined ? (
                <a href={href('family', family.id)} className="hover:underline" onClick={onClose}>
                  {family.title}
                </a>
              ) : (
                ''
              )
            }
          />
          <Fact label="Other party" value={d.other_party} />
          <Fact label="Their mark or product" value={d.their_mark} />
          <Fact label="Forum" value={d.forum} />
          <Fact label="Proceeding number" value={d.proceeding_no} mono />
          <Fact label="Filed on" value={fmtDate(d.filed_date)} />
          <Fact label="Counsel" value={d.counsel} />
        </FactGrid>

        <Section
          title="Deadlines"
          meta={deadlines.records.length > 0 ? String(deadlines.records.length) : undefined}
          flush
          actions={
            can.edit ? (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setAdding(true)}>
                <CalendarPlus size={13} aria-hidden /> Add deadline
              </Button>
            ) : undefined
          }
        >
          <DeadlineList
            deadlines={deadlines.records}
            actions={can.edit ? dl.actions : null}
            bulk={false}
            empty={
              <EmptyHint
                compact
                title="No deadlines yet"
                message="Add the dates set by the office, board or court, such as the notice of opposition, evidence rounds and hearings."
                action={
                  can.edit ? (
                    <Button size="sm" onClick={() => setAdding(true)}>
                      Add a deadline
                    </Button>
                  ) : undefined
                }
              />
            }
          />
        </Section>

        <DocumentsPanel relation="dispute" relationId={d.id} title="Documents" defaultType="correspondence" />

        <Section title="Outcome and notes">
          <div className="flex flex-col gap-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">Outcome</div>
              {d.outcome !== '' ? <Prose className="mt-1">{d.outcome}</Prose> : <p className="mt-1 text-[13px] text-[var(--agent-app-muted)]">Not decided yet</p>}
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">Notes</div>
              {d.notes !== '' ? <Prose className="mt-1">{d.notes}</Prose> : <p className="mt-1 text-[13px] text-[var(--agent-app-muted)]">No notes</p>}
            </div>
          </div>
        </Section>
      </div>
      {adding && <AddDeadlineDialog dispute={d} onClose={() => setAdding(false)} onDone={deadlines.refresh} />}
    </Drawer>
  );
}

/* ------------------------------------------------------------------ */
/* Add a deadline to a dispute                                         */
/* ------------------------------------------------------------------ */

function AddDeadlineDialog({ dispute, onClose, onDone }: { dispute: DisputeRec; onClose: () => void; onDone: () => void }): React.JSX.Element {
  const { me } = useApp();
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [kind, setKind] = useState<'hard' | 'designated'>('designated');
  const [assignee, setAssignee] = useState(me?.id ?? '');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    if (title.trim() === '' || d10(due) === '') {
      toast.error('Enter what is due and the date.');
      return;
    }
    setBusy(true);
    try {
      await createRecord('deadlines', {
        title: title.trim(),
        dispute: dispute.id,
        matter: dispute.matter,
        kind,
        category: 'dispute',
        status: 'open',
        due_date: toPb(due),
        source: 'manual',
        assignee,
        notes: notes.trim(),
      });
      toast.success('Deadline added');
      onDone();
      onClose();
    } catch {
      /* toast shown by the client */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Add a deadline"
      description={`For ${dispute.title}. It appears in Deadlines, Today and the calendar feed like every other deadline.`}
      className="w-[min(94vw,32rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={title.trim() === '' || d10(due) === ''}>
            Add deadline
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Input label="What is due" value={title} maxLength={400} autoFocus placeholder="For example: File evidence in support of the opposition" onChange={(e) => setTitle(e.target.value)} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Due date" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          <Field label="Kind" help={KIND_HELP[kind]}>
            <Select
              aria-label="Kind"
              value={kind}
              options={[
                { value: 'designated', label: 'Set by the office or court' },
                { value: 'hard', label: 'Statutory (set by law)' },
              ]}
              onChange={(e) => setKind(e.target.value === 'hard' ? 'hard' : 'designated')}
            />
          </Field>
        </div>
        <UserSelect label="Assigned to" value={assignee} onChange={setAssignee} />
        <Textarea label="Notes (optional)" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
    </Dialog>
  );
}
