/**
 * Matter page tabs that load their own data: people (involvements),
 * agreements that cover the right, renewals, and history (events and the
 * change log).
 */
import { useMemo, useState } from 'react';
import { FileSignature, FileText, History, Plus, RefreshCcw, Trash2, UserPlus, Users } from 'lucide-react';
import { Button, Input, Select, Textarea, toast, useConfirm } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { createRecord, deleteRecord, fileUrl, q } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { ago, d10, fmtDate, fmtDateTime, fmtMoney } from '../lib/format.ts';
import {
  AGREEMENT_STATUS_TONE,
  AGREEMENT_TYPE_LABEL,
  DIRECTION_LABEL,
  INSTRUCTION_LABEL,
  RENEWAL_DECISION_LABEL,
  SOURCE_LABEL,
  STATUS_LABEL,
} from '../lib/labels.ts';
import { href, navigate } from '../lib/router.ts';
import type {
  AgreementRec,
  AuditRec,
  DocumentRec,
  EventRec,
  GrantRec,
  InvolvementRec,
  MatterRec,
  MatterStatus,
  PartyRec,
  PriorityClaim,
  RenewalRec,
} from '../lib/types.ts';
import { RecordPicker } from './pickers.tsx';
import { AGREEMENT_STATUS_LABEL, INVOLVEMENT_ROLE_LABEL, RENEWAL_DECISION_TONE, toOptions } from './matterShared.tsx';
import { EmptyHint, ErrorBox, Field, IdentityChip, Loading, Pill, Ref, Section, Segmented, Tag } from './ui.tsx';

/* ------------------------------------------------------------------ */
/* People                                                              */
/* ------------------------------------------------------------------ */

const ROLE_ORDER = Object.keys(INVOLVEMENT_ROLE_LABEL);

function defaultRole(m: MatterRec): InvolvementRec['role'] {
  if (m.ip_type === 'patent' || m.ip_type === 'utility_model') return 'inventor';
  if (m.ip_type === 'copyright') return 'author';
  if (m.ip_type === 'design') return 'inventor';
  return 'owner';
}

export function MatterPeopleTab({ matter }: { matter: MatterRec }): React.JSX.Element {
  const { can } = useApp();
  const inv = useCollection<InvolvementRec>('involvements', { filter: `matter = ${q(matter.id)}`, expand: 'party' });
  const [confirmEl, confirm] = useConfirm();
  const [adding, setAdding] = useState(false);

  const rows = useMemo(() => {
    const list = inv.records.map((r) => ({ r, party: r.expand?.['party'] as PartyRec | undefined }));
    list.sort((a, b) => ROLE_ORDER.indexOf(a.r.role) - ROLE_ORDER.indexOf(b.r.role) || (a.party?.name ?? '').localeCompare(b.party?.name ?? ''));
    return list;
  }, [inv.records]);

  const remove = async (r: InvolvementRec, name: string): Promise<void> => {
    const role = INVOLVEMENT_ROLE_LABEL[r.role] ?? r.role;
    if (!(await confirm(`Remove ${name} as ${role.toLowerCase()} on ${matter.ref}? The person stays in People.`, 'Remove person'))) return;
    try {
      await deleteRecord('involvements', r.id);
      toast.success(`${name} removed`);
    } catch {
      /* the client already showed the error */
    }
  };

  return (
    <Section
      title="People"
      meta={rows.length > 0 ? String(rows.length) : undefined}
      flush
      actions={
        can.edit && !adding ? (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <UserPlus size={13} aria-hidden /> Add person
          </Button>
        ) : undefined
      }
    >
      {confirmEl}
      {adding && <AddInvolvement matter={matter} onDone={() => setAdding(false)} />}
      {inv.loading && inv.records.length === 0 ? (
        <Loading />
      ) : inv.error !== null ? (
        <div className="p-4">
          <ErrorBox message={inv.error} onRetry={inv.refresh} />
        </div>
      ) : rows.length === 0 ? (
        !adding && (
          <EmptyHint
            compact
            icon={Users}
            title="Nobody linked yet"
            message="Record inventors, authors, owners and agents here, with their share where it matters."
            action={
              can.edit ? (
                <Button size="sm" onClick={() => setAdding(true)}>
                  Add person
                </Button>
              ) : undefined
            }
          />
        )
      ) : (
        rows.map(({ r, party }) => {
          const name = party?.name ?? 'Removed person';
          return (
            <div key={r.id} className="group flex min-h-11 items-center gap-3 border-b border-[var(--agent-app-border)]/70 px-4 py-2 last:border-0">
              <IdentityChip name={name} size="sm" square={party?.kind === 'organization'} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {party !== undefined ? (
                    <a href={href('people', party.id)} className="truncate text-sm font-medium hover:underline">
                      {name}
                    </a>
                  ) : (
                    <span className="text-sm text-[var(--agent-app-muted)]">{name}</span>
                  )}
                  <Tag>{INVOLVEMENT_ROLE_LABEL[r.role] ?? r.role}</Tag>
                  {r.share > 0 && <span className="text-xs tabular-nums text-[var(--agent-app-muted)]">{r.share}% share</span>}
                </div>
                <div className="truncate text-xs text-[var(--agent-app-muted)]">
                  {[party?.organization, party?.email, r.note].filter((x) => x !== undefined && x !== '').join(' · ')}
                </div>
              </div>
              {can.edit && (
                <button
                  type="button"
                  aria-label={`Remove ${name}`}
                  className="flex size-8 items-center justify-center text-[var(--agent-app-muted)] opacity-60 hover:text-red-600 group-hover:opacity-100"
                  onClick={() => void remove(r, name)}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          );
        })
      )}
    </Section>
  );
}

function AddInvolvement({ matter, onDone }: { matter: MatterRec; onDone: () => void }): React.JSX.Element {
  const [role, setRole] = useState<InvolvementRec['role']>(defaultRole(matter));
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [partyId, setPartyId] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'person' | 'organization'>('person');
  const [email, setEmail] = useState('');
  const [share, setShare] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async (): Promise<void> => {
    if (mode === 'existing' && partyId === '') {
      toast.error('Choose a person or company, or create a new one.');
      return;
    }
    if (mode === 'new' && name.trim() === '') {
      toast.error('Enter the name.');
      return;
    }
    const pct = share.trim() === '' ? 0 : Number(share);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      toast.error('Share is a percentage from 0 to 100.');
      return;
    }
    setBusy(true);
    try {
      let pid = partyId;
      let label = '';
      if (mode === 'new') {
        const p = await createRecord<PartyRec>('parties', { name: name.trim(), kind, email: email.trim(), roles: [role] });
        pid = p.id;
        label = p.name;
      }
      await createRecord<InvolvementRec>('involvements', { party: pid, role, matter: matter.id, share: pct, note: note.trim() });
      toast.success(`${label !== '' ? label : 'Person'} added as ${(INVOLVEMENT_ROLE_LABEL[role] ?? role).toLowerCase()}`);
      onDone();
    } catch {
      /* the client already showed the error */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 border-b border-[var(--agent-app-border)] bg-[var(--agent-app-border)]/10 px-4 py-4">
      <div className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
        <Select label="Role" value={role} options={toOptions(INVOLVEMENT_ROLE_LABEL)} onChange={(e) => setRole(e.target.value as InvolvementRec['role'])} />
        <Field label="Who">
          <div className="flex flex-col gap-2">
            <Segmented
              size="sm"
              value={mode}
              ariaLabel="Existing or new"
              options={[
                { value: 'existing', label: 'From People' },
                { value: 'new', label: 'New person or company' },
              ]}
              onChange={setMode}
            />
            {mode === 'existing' ? (
              <RecordPicker<PartyRec>
                collection="parties"
                value={partyId}
                onChange={(id) => setPartyId(id)}
                labelOf={(p) => (p.organization !== '' ? `${p.name} (${p.organization})` : p.name)}
                searchFields={['name', 'email', 'organization']}
                placeholder="Search by name, email or company"
              />
            ) : (
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <Input aria-label="Name" value={name} placeholder="Full name or company name" onChange={(e) => setName(e.target.value)} />
                <Segmented
                  size="sm"
                  value={kind}
                  ariaLabel="Person or company"
                  options={[
                    { value: 'person', label: 'Person' },
                    { value: 'organization', label: 'Company' },
                  ]}
                  onChange={setKind}
                />
                <Input aria-label="Email" type="email" value={email} placeholder="Email (optional)" onChange={(e) => setEmail(e.target.value)} />
              </div>
            )}
          </div>
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
        <Input label="Share (%)" type="number" min={0} max={100} value={share} placeholder="Optional" onChange={(e) => setShare(e.target.value)} />
        <Textarea label="Note" rows={1} className="min-h-9" value={note} placeholder="Optional, for example: employee inventor, assignment signed" onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => void save()} loading={busy}>
          <Plus size={13} aria-hidden /> Add
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Agreements                                                          */
/* ------------------------------------------------------------------ */

const GRANT_KIND_LABEL: Record<GrantRec['kind'], string> = {
  grant: 'Grant',
  holdback: 'Holdback',
  restriction: 'Restriction',
  reservation: 'Reservation',
};

export function MatterAgreementsTab({ matter }: { matter: MatterRec }): React.JSX.Element {
  const { can } = useApp();
  const grants = useCollection<GrantRec>('grants', { filter: `matters ~ ${q(matter.id)}`, expand: 'agreement' });
  const list = useMemo(() => {
    const map = new Map<string, { a: AgreementRec; grants: GrantRec[] }>();
    for (const g of grants.records) {
      const a = g.expand?.['agreement'] as AgreementRec | undefined;
      if (a === undefined) continue;
      const e = map.get(a.id) ?? { a, grants: [] };
      e.grants.push(g);
      map.set(a.id, e);
    }
    return [...map.values()].sort((x, y) => (x.a.status === 'active' ? -1 : 0) - (y.a.status === 'active' ? -1 : 0) || x.a.ref.localeCompare(y.a.ref));
  }, [grants.records]);

  return (
    <Section title="Agreements covering this right" meta={list.length > 0 ? String(list.length) : undefined} flush>
      {grants.loading && grants.records.length === 0 ? (
        <Loading />
      ) : grants.error !== null ? (
        <div className="p-4">
          <ErrorBox message={grants.error} onRetry={grants.refresh} />
        </div>
      ) : list.length === 0 ? (
        <EmptyHint
          compact
          icon={FileSignature}
          title="No agreement covers this right"
          message="Licences, assignments and options appear here when one of their grants names this right."
          action={
            can.edit ? (
              <Button size="sm" onClick={() => navigate('agreements')}>
                Open agreements
              </Button>
            ) : undefined
          }
        />
      ) : (
        list.map(({ a, grants: gs }) => (
          <a
            key={a.id}
            href={href('agreement', a.id)}
            className="flex flex-col gap-1.5 border-b border-[var(--agent-app-border)]/70 px-4 py-2.5 last:border-0 hover:bg-[var(--agent-app-border)]/20 sm:flex-row sm:items-center sm:gap-3"
          >
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <Ref>{a.ref}</Ref>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{a.title}</div>
                <div className="flex flex-wrap items-center gap-x-2 text-xs text-[var(--agent-app-muted)]">
                  <span>{AGREEMENT_TYPE_LABEL[a.agreement_type] ?? a.agreement_type}</span>
                  <span>
                    {gs
                      .map((g) => `${g.exclusive ? 'Exclusive ' : ''}${(GRANT_KIND_LABEL[g.kind] ?? g.kind).toLowerCase()}`)
                      .join(', ')}
                  </span>
                  {(d10(a.term_start) !== '' || d10(a.term_end) !== '' || a.perpetual) && (
                    <span className="tabular-nums">
                      {d10(a.term_start) !== '' ? fmtDate(a.term_start) : 'Start not set'} to {a.perpetual ? 'perpetual' : d10(a.term_end) !== '' ? fmtDate(a.term_end) : 'no end date'}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Pill tone="neutral">{DIRECTION_LABEL[a.direction] ?? a.direction}</Pill>
              <Pill tone={AGREEMENT_STATUS_TONE[a.status] ?? 'neutral'}>{AGREEMENT_STATUS_LABEL[a.status] ?? a.status}</Pill>
            </div>
          </a>
        ))
      )}
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Renewals                                                            */
/* ------------------------------------------------------------------ */

export function MatterRenewalsTab({ matter }: { matter: MatterRec }): React.JSX.Element {
  const rens = useCollection<RenewalRec>('renewals', { filter: `matter = ${q(matter.id)}`, sort: 'due_date' });
  return (
    <Section
      title="Renewals and annuities"
      meta={rens.records.length > 0 ? String(rens.records.length) : undefined}
      flush
      actions={
        <Button size="sm" variant="outline" onClick={() => navigate('renewals')}>
          <RefreshCcw size={13} aria-hidden /> Open Renewals
        </Button>
      }
    >
      {rens.loading && rens.records.length === 0 ? (
        <Loading />
      ) : rens.error !== null ? (
        <div className="p-4">
          <ErrorBox message={rens.error} onRetry={rens.refresh} />
        </div>
      ) : rens.records.length === 0 ? (
        <EmptyHint
          compact
          icon={RefreshCcw}
          title="No renewals yet"
          message="Renewal fees, annuities and declarations created by the rules appear here with their costs and decisions."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-[var(--agent-app-border)] bg-[var(--agent-app-border)]/20 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">
                <th className="px-4 py-2">Cycle</th>
                <th className="px-3 py-2">Due</th>
                <th className="px-3 py-2">Grace ends</th>
                <th className="px-3 py-2 text-right">Fee</th>
                <th className="px-3 py-2">Decision</th>
                <th className="px-3 py-2">Instruction</th>
              </tr>
            </thead>
            <tbody>
              {rens.records.map((r) => {
                const total = r.official_fee + r.other_fee;
                const showHome = r.home_currency !== '' && r.home_currency.toUpperCase() !== r.currency.toUpperCase() && r.home_amount > 0;
                return (
                  <tr key={r.id} className="border-b border-[var(--agent-app-border)]/60 last:border-0">
                    <td className="px-4 py-2.5 font-medium">{r.cycle_label || `Cycle ${r.cycle}`}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{fmtDate(r.due_date)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-[var(--agent-app-muted)]">{d10(r.grace_end) !== '' ? fmtDate(r.grace_end) : '-'}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums" title={r.fee_note || undefined}>
                      {r.fee_known ? (
                        <>
                          {fmtMoney(total, r.currency)}
                          {showHome && <div className="text-xs text-[var(--agent-app-muted)]">about {fmtMoney(r.home_amount, r.home_currency)}</div>}
                        </>
                      ) : (
                        <span className="text-[var(--agent-app-muted)]">Fee not on file</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <Pill tone={RENEWAL_DECISION_TONE[r.decision] ?? 'neutral'} title={r.rationale || undefined}>
                        {RENEWAL_DECISION_LABEL[r.decision] ?? r.decision}
                      </Pill>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-[var(--agent-app-muted)]">
                      {INSTRUCTION_LABEL[r.instruction_status] ?? r.instruction_status}
                      {d10(r.paid_date) !== '' && <div className="text-xs tabular-nums">Paid {fmtDate(r.paid_date)}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

const FIELD_LABEL: Record<string, string> = {
  title: 'Title',
  ref: 'Reference',
  status: 'Status',
  office_status: 'Office status',
  jurisdiction: 'Office',
  route: 'Route',
  relation: 'Relation',
  application_no: 'Application number',
  filing_date: 'Filing date',
  publication_no: 'Publication number',
  publication_date: 'Publication date',
  registration_no: 'Registration number',
  registration_date: 'Registration date',
  expiry_date: 'Expiry',
  expiry_override: 'Expiry set by hand',
  priority_claims: 'Priority claims',
  status_date: 'Status date',
  entity_size: 'Entity size',
  tm_basis: 'Filing basis',
  tm_register: 'Register',
  owner_of_record: 'Owner of record',
  applicants: 'Applicants',
  counsel: 'Counsel',
  client_ref: 'Client reference',
  cost_center: 'Cost center',
  responsible: 'Responsible',
  docketer: 'Docketer',
  sync_enabled: 'Automatic office checks',
  sync_source: 'Office data source',
  abstract: 'Abstract',
  claims_count: 'Claims',
  independent_claims: 'Independent claims',
  pta_days: 'Patent term adjustment',
  options: 'Options',
  notes: 'Notes',
  property: 'Property',
  family: 'Family',
  work: 'Work',
  parent: 'Parent',
  code: 'Event',
  date: 'Date',
  source: 'Source',
  number: 'Number',
  members: 'Family members added',
  deadlines: 'Deadlines created',
  children: 'Records created',
  moved: 'Deadlines moved',
  created: 'Created',
  from_invention: 'From an invention disclosure',
  unchanged: 'Unchanged',
};

/** Derived fields the server maintains; changes to them are noise in the log. */
const DERIVED_FIELDS = new Set(['status_group', 'next_deadline', 'next_deadline_title', 'last_synced', 'sync_state', 'sync_error', 'official_data']);
const DATE_FIELDS = new Set(['filing_date', 'publication_date', 'registration_date', 'expiry_date', 'status_date', 'date']);
const USER_FIELDS = new Set(['responsible', 'docketer']);
const LINK_FIELDS = new Set(['family', 'work', 'parent', 'from_invention']);

const ACTION_LABEL: Record<string, string> = {
  create: 'Created',
  update: 'Changed',
  delete: 'Deleted',
  import: 'Imported',
  event: 'Recorded an event',
  generate: 'Created deadlines',
  regenerate: 'Recalculated deadlines',
  close: 'Closed',
  extend: 'Extended',
  move: 'Moved dates',
  decide: 'Decided',
  instruct: 'Instructed',
  accept: 'Accepted from the Inbox',
  reject: 'Rejected in the Inbox',
  sync: 'Synced',
};

/** One line for an item of a logged list (deadlines created, records created, dates moved). */
function itemText(x: unknown): string {
  if (typeof x !== 'object' || x === null) return String(x);
  const o = x as Record<string, unknown>;
  const str = (k: string): string => (typeof o[k] === 'string' ? (o[k] as string) : '');
  const title = str('title') || str('ref') || str('label');
  const due = str('due') || str('due_date');
  if (str('from') !== '' && str('to') !== '') return `${title}: ${fmtDate(str('from'))} → ${fmtDate(str('to'))}`;
  if (due !== '') return `${title} (due ${fmtDate(due)})`;
  if (str('jurisdiction') !== '' && title !== '') return title;
  return title !== '' ? title : JSON.stringify(o).slice(0, 80);
}

function humanKey(k: string): string {
  const s = k.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function isFromTo(v: unknown): v is { from: unknown; to: unknown } {
  return typeof v === 'object' && v !== null && 'from' in v && 'to' in v;
}

export function MatterHistoryTab({ matter }: { matter: MatterRec }): React.JSX.Element {
  const { can, meta, userName, propertyName } = useApp();
  const events = useCollection<EventRec>('events', { filter: `matter = ${q(matter.id)}`, sort: '-date,-created', expand: 'document' });
  const audit = useCollection<AuditRec>('audit_log', { filter: can.edit ? `record_id = ${q(matter.id)}` : 'id = "__none__"', sort: '-created' });

  const fmtVal = (field: string, v: unknown): string => {
    if (v === null || v === undefined || v === '') return 'empty';
    if (typeof v === 'boolean') return v ? 'yes' : 'no';
    if (typeof v === 'number') return String(v);
    if (typeof v === 'string') {
      if (DATE_FIELDS.has(field)) return d10(v) !== '' ? fmtDate(v) : v;
      if (USER_FIELDS.has(field)) return userName(v) || 'nobody';
      if (field === 'property') return propertyName(v) || 'another record';
      if (field === 'status') return STATUS_LABEL[v as MatterStatus] ?? v;
      if (LINK_FIELDS.has(field)) return 'a linked record';
      return v.length > 140 ? `${v.slice(0, 140)}...` : v;
    }
    if (field === 'priority_claims' && Array.isArray(v)) {
      const list = v as PriorityClaim[];
      return list.length === 0 ? 'none' : list.map((p) => `${p.country} ${p.number}${d10(p.date) !== '' ? ` (${fmtDate(p.date)})` : ''}`).join('; ');
    }
    if (Array.isArray(v)) {
      if (v.length === 0) return 'none';
      const shown = v.slice(0, 6).map(itemText).join('; ');
      return v.length > 6 ? `${shown}; and ${v.length - 6} more` : shown;
    }
    const json = JSON.stringify(v);
    return json.length > 140 ? `${json.slice(0, 140)}...` : json;
  };

  const lines = (a: AuditRec): { label: string; from?: string; to?: string; text?: string }[] => {
    const ch = a.changes ?? {};
    const out: { label: string; from?: string; to?: string; text?: string }[] = [];
    for (const [k, v] of Object.entries(ch)) {
      if (DERIVED_FIELDS.has(k)) continue;
      const label = FIELD_LABEL[k] ?? humanKey(k);
      if (a.action === 'delete' && k === 'deleted') {
        out.push({ label: 'Record', text: 'deleted; a copy is kept in the log' });
      } else if (isFromTo(v)) {
        out.push({ label, from: fmtVal(k, v.from), to: fmtVal(k, v.to) });
      } else {
        out.push({ label, text: fmtVal(k, v) });
      }
    }
    return out;
  };

  return (
    <div className="flex flex-col gap-4">
      <Section title="Events" meta={events.records.length > 0 ? String(events.records.length) : undefined} flush>
        {events.loading && events.records.length === 0 ? (
          <Loading />
        ) : events.error !== null ? (
          <div className="p-4">
            <ErrorBox message={events.error} onRetry={events.refresh} />
          </div>
        ) : events.records.length === 0 ? (
          <EmptyHint compact icon={History} title="No events recorded" message="Filing, publication, office actions and grants appear here as they are recorded." />
        ) : (
          events.records.map((ev) => {
            const codeLabel = meta?.event_codes[ev.code]?.label ?? ev.code;
            const doc = ev.expand?.['document'] as DocumentRec | undefined;
            return (
              <div key={ev.id} className="flex flex-col gap-1 border-b border-[var(--agent-app-border)]/70 px-4 py-2.5 last:border-0 sm:flex-row sm:items-center sm:gap-4">
                <span className="w-28 shrink-0 text-[13px] tabular-nums text-[var(--agent-app-muted)]">{fmtDate(ev.date)}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{codeLabel}</div>
                  {ev.label !== '' && ev.label !== codeLabel && <div className="truncate text-xs text-[var(--agent-app-muted)]">{ev.label}</div>}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs text-[var(--agent-app-muted)]">
                  {ev.source !== '' && <Tag>{SOURCE_LABEL[ev.source] ?? ev.source}</Tag>}
                  {ev.created_by !== '' && <span>{userName(ev.created_by)}</span>}
                  {doc !== undefined && doc.file !== '' && (
                    <a href={fileUrl(doc, doc.file)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--agent-app-accent)] hover:underline">
                      <FileText size={12} aria-hidden /> {doc.title}
                    </a>
                  )}
                </div>
              </div>
            );
          })
        )}
      </Section>

      <Section title="Change log" meta={can.edit && audit.records.length > 0 ? String(audit.records.length) : undefined} flush>
        {!can.edit ? (
          <p className="px-4 py-4 text-[13px] text-[var(--agent-app-muted)]">The change log is visible to managers and counsel.</p>
        ) : audit.loading && audit.records.length === 0 ? (
          <Loading />
        ) : audit.error !== null ? (
          <div className="p-4">
            <ErrorBox message={audit.error} onRetry={audit.refresh} />
          </div>
        ) : audit.records.length === 0 ? (
          <EmptyHint compact icon={History} title="No changes logged" message="Every change to this record is logged here with who made it and when." />
        ) : (
          audit.records.map((a) => {
            const who = a.actor_name || userName(a.actor) || 'System';
            const ls = lines(a);
            return (
              <div key={a.id} className="border-b border-[var(--agent-app-border)]/70 px-4 py-2.5 last:border-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
                  <IdentityChip name={who} size="xs" />
                  <span className="font-medium">{who}</span>
                  <span className="text-[var(--agent-app-muted)]">{(ACTION_LABEL[a.action] ?? humanKey(a.action)).toLowerCase()}</span>
                  <span className="ml-auto text-xs tabular-nums text-[var(--agent-app-muted)]" title={fmtDateTime(a.created)}>
                    {ago(a.created)}
                  </span>
                </div>
                {ls.length > 0 && (
                  <ul className="mt-1.5 flex flex-col gap-0.5 pl-7 text-xs">
                    {ls.map((l, i) => (
                      <li key={`${l.label}-${i}`} className="min-w-0 break-words">
                        <span className="text-[var(--agent-app-muted)]">{l.label}: </span>
                        {l.text !== undefined ? (
                          <span>{l.text}</span>
                        ) : (
                          <>
                            <span className="text-[var(--agent-app-muted)] line-through decoration-1">{l.from}</span>
                            <span className="text-[var(--agent-app-muted)]"> → </span>
                            <span className="font-medium">{l.to}</span>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {a.reason !== '' && <p className="mt-1 pl-7 text-xs text-[var(--agent-app-muted)]">{a.reason}</p>}
              </div>
            );
          })
        )}
      </Section>
    </div>
  );
}
