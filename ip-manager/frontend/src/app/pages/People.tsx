/**
 * People and companies: the parties directory (inventors, authors, talent,
 * licensees, licensors, counsel, agents, vendors). A party links to matters,
 * works, inventions and families through involvements, and to agreements as
 * the counterparty. #/people/<id> opens that party's detail drawer.
 */
import { useMemo, useState } from 'react';
import { Building2, FileSignature, Pencil, Plus, Search, Trash2, User, Users, X } from 'lucide-react';
import { Button, Dialog, Drawer, Input, Select, Textarea, cn, toast, useConfirm } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { createRecord, deleteRecord, q, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { fmtDate } from '../lib/format.ts';
import { AGREEMENT_STATUS_TONE, AGREEMENT_TYPE_LABEL, DIRECTION_LABEL, DISCLOSURE_STAGE_LABEL, IP_TYPE_LABEL, WORK_TYPE_LABEL, jurisdictionName } from '../lib/labels.ts';
import { href, navigate, useHashParam, useRoute } from '../lib/router.ts';
import type { Page } from '../lib/router.ts';
import type { AgreementRec, DisclosureRec, FamilyRec, InvolvementRec, MatterRec, PartyRec, WorkRec } from '../lib/types.ts';
import { DataTable } from '../components/DataTable.tsx';
import type { Col } from '../components/DataTable.tsx';
import { JurisdictionSelect, UserSelect } from '../components/pickers.tsx';
import { EmptyHint, Fact, FactGrid, Field, GroupHeader, IdentityChip, JurChip, Loading, ErrorBox, PageHeader, Pill, Prose, Ref, Segmented, Tag, Toolbar } from '../components/ui.tsx';

/* ------------------------------------------------------------------ */
/* Labels                                                              */
/* ------------------------------------------------------------------ */

const PARTY_ROLES = ['inventor', 'author', 'talent', 'owner', 'licensee', 'licensor', 'distributor', 'counsel', 'agent', 'vendor', 'other'] as const;

const PARTY_ROLE_LABEL: Record<string, string> = {
  inventor: 'Inventor',
  author: 'Author',
  talent: 'Talent',
  owner: 'Owner',
  licensee: 'Licensee',
  licensor: 'Licensor',
  distributor: 'Distributor',
  counsel: 'Counsel',
  agent: 'Agent',
  vendor: 'Vendor',
  other: 'Other',
};

const INVOLVEMENT_ROLE_LABEL: Record<string, string> = {
  inventor: 'Inventor',
  author: 'Author',
  applicant: 'Applicant',
  owner: 'Owner',
  assignee: 'Assignee',
  licensee: 'Licensee',
  licensor: 'Licensor',
  counsel: 'Counsel',
  agent: 'Agent',
  talent: 'Talent',
  contributor: 'Contributor',
  claimant: 'Claimant',
  other: 'Other',
};

const KIND_LABEL: Record<PartyRec['kind'], string> = { person: 'Person', organization: 'Company' };

function roleLabel(r: string): string {
  return PARTY_ROLE_LABEL[r] ?? r;
}

type KindFilter = 'all' | 'person' | 'organization';

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function PeoplePage({ id }: { id: string }): React.JSX.Element {
  const { can, userName } = useApp();
  const route = useRoute();
  const parties = useCollection<PartyRec>('parties', { sort: 'name' });
  const [kindParam, setKind] = useHashParam('kind', 'all');
  const [role, setRole] = useHashParam('role', '');
  const [query, setQuery] = useHashParam('q', '');
  const [search, setSearch] = useState(query);
  const [editing, setEditing] = useState<PartyRec | 'new' | null>(null);
  const [confirmEl, confirm] = useConfirm();
  const kind: KindFilter = kindParam === 'person' || kindParam === 'organization' ? kindParam : 'all';

  const paramsObj = (): Record<string, string> => Object.fromEntries(route.params.entries());
  const open = (pid: string): void => navigate('people', pid, paramsObj());
  const close = (): void => navigate('people', '', paramsObj());

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    return parties.records.filter((p) => {
      if (kind !== 'all' && p.kind !== kind) return false;
      if (role !== '' && !(p.roles ?? []).includes(role)) return false;
      if (term !== '') {
        const hay = `${p.name} ${p.organization} ${p.email} ${p.external_ref} ${p.phone}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [parties.records, kind, role, query]);

  const filtered = kind !== 'all' || role !== '' || query.trim() !== '';

  const remove = async (p: PartyRec): Promise<void> => {
    const ok = await confirm(
      `Delete ${p.name}? Their involvements on matters, works, inventions and families are removed too. Agreements where they are the counterparty stay, without a counterparty.`,
      'Delete this party?',
    );
    if (!ok) return;
    try {
      await deleteRecord('parties', p.id);
      toast.success(`${p.name} deleted`);
      if (id === p.id) close();
    } catch {
      /* the client already showed the server's message */
    }
  };

  const columns: Col<PartyRec>[] = [
    {
      key: 'name',
      label: 'Name',
      value: (r) => r.name,
      render: (r) => (
        <div className="flex min-w-0 items-center gap-2">
          <IdentityChip name={r.name} size="sm" square={r.kind === 'organization'} />
          <span className="truncate font-medium">{r.name}</span>
        </div>
      ),
    },
    { key: 'kind', label: 'Kind', value: (r) => KIND_LABEL[r.kind] },
    {
      key: 'roles',
      label: 'Roles',
      sortable: false,
      value: (r) => (r.roles ?? []).map(roleLabel).join(', '),
      render: (r) => (
        <div className="flex flex-wrap gap-1">
          {(r.roles ?? []).map((x) => (
            <Tag key={x}>{roleLabel(x)}</Tag>
          ))}
        </div>
      ),
    },
    { key: 'organization', label: 'Organization' },
    {
      key: 'email',
      label: 'Email',
      render: (r) =>
        r.email !== '' ? (
          <span className="text-[var(--agent-app-text)]/85">{r.email}</span>
        ) : (
          <span className="text-[var(--agent-app-muted)]">-</span>
        ),
    },
    { key: 'country', label: 'Country', value: (r) => r.country, render: (r) => (r.country !== '' ? <JurChip code={r.country} /> : '') },
    { key: 'phone', label: 'Phone', optional: true },
    { key: 'external_ref', label: 'External reference', optional: true, render: (r) => <Ref>{r.external_ref}</Ref> },
    {
      key: 'user',
      label: 'Linked account',
      value: (r) => userName(r.user),
      render: (r) => (r.user !== '' ? userName(r.user) : <span className="text-[var(--agent-app-muted)]">-</span>),
    },
  ];

  const selected = id !== '' ? (parties.records.find((p) => p.id === id) ?? null) : null;

  return (
    <div>
      {confirmEl}
      <PageHeader
        title="People and companies"
        meta={parties.loading ? undefined : String(parties.records.length)}
        subtitle="Inventors, authors, talent, licensees, licensors, counsel and agents."
        actions={
          can.edit ? (
            <Button onClick={() => setEditing('new')}>
              <Plus size={14} aria-hidden /> Add person or company
            </Button>
          ) : undefined
        }
      />

      <Toolbar>
        <div className="relative w-full sm:w-64">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-[var(--agent-app-muted)]" aria-hidden />
          <Input
            aria-label="Search people and companies"
            placeholder="Search name, email, reference"
            className="pl-8"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setQuery(e.target.value);
            }}
          />
        </div>
        <Segmented<KindFilter>
          ariaLabel="Kind"
          value={kind}
          onChange={(v) => setKind(v)}
          options={[
            { value: 'all', label: 'All' },
            { value: 'person', label: 'People' },
            { value: 'organization', label: 'Companies' },
          ]}
        />
        <div className="w-44">
          <Select
            aria-label="Role"
            value={role}
            placeholder="Any role"
            options={PARTY_ROLES.map((r) => ({ value: r, label: PARTY_ROLE_LABEL[r] ?? r }))}
            onChange={(e) => setRole(e.target.value)}
          />
        </div>
        {filtered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch('');
              setQuery('');
              setKind('all');
              setRole('');
            }}
          >
            <X size={13} aria-hidden /> Clear
          </Button>
        )}
      </Toolbar>

      <div className="border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)]">
        {parties.loading ? (
          <Loading />
        ) : parties.error !== null ? (
          <div className="p-4">
            <ErrorBox message={parties.error} onRetry={parties.refresh} />
          </div>
        ) : (
          <DataTable<PartyRec>
            tableId="parties"
            exportName="people-and-companies"
            rows={rows}
            columns={columns}
            onRowClick={(r) => open(r.id)}
            rowClassName={(r) => (r.id === id ? 'bg-[var(--agent-app-accent)]/5' : '')}
            empty={
              parties.records.length === 0 ? (
                <EmptyHint
                  icon={Users}
                  title="No people or companies yet"
                  message="Add inventors, authors, licensees and counsel once, then name them on matters, works, inventions and agreements."
                  action={
                    can.edit ? (
                      <Button onClick={() => setEditing('new')}>
                        <Plus size={14} aria-hidden /> Add person or company
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                <EmptyHint
                  compact
                  icon={Search}
                  title="Nothing matches these filters"
                  message="Try another name or role."
                  action={
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSearch('');
                        setQuery('');
                        setKind('all');
                        setRole('');
                      }}
                    >
                      Clear filters
                    </Button>
                  }
                />
              )
            }
          />
        )}
      </div>

      {id !== '' && (
        <PartyDrawer
          id={id}
          party={selected}
          loading={parties.loading}
          onClose={close}
          onEdit={(p) => setEditing(p)}
          onDelete={(p) => void remove(p)}
        />
      )}

      {editing !== null && (
        <PartyForm
          party={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(p) => {
            setEditing(null);
            if (editing === 'new') open(p.id);
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Detail drawer                                                        */
/* ------------------------------------------------------------------ */

interface InvolvementExpanded extends InvolvementRec {
  expand?: {
    matter?: MatterRec;
    work?: WorkRec;
    disclosure?: DisclosureRec;
    family?: FamilyRec;
    agreement?: AgreementRec;
  };
}

interface LinkRow {
  key: string;
  page: Page;
  targetId: string;
  ref: string;
  title: string;
  sub: string;
  roles: { role: string; share: number; note: string }[];
}

function groupRows(list: InvolvementExpanded[], pick: (i: InvolvementExpanded) => LinkRow | null): LinkRow[] {
  const map = new Map<string, LinkRow>();
  for (const inv of list) {
    const row = pick(inv);
    if (row === null) continue;
    const existing = map.get(row.key);
    const entry = { role: inv.role, share: inv.share, note: inv.note };
    if (existing === undefined) map.set(row.key, { ...row, roles: [entry] });
    else existing.roles.push(entry);
  }
  return [...map.values()].sort((a, b) => (a.ref || a.title).localeCompare(b.ref || b.title, undefined, { numeric: true }));
}

function PartyDrawer({
  id,
  party,
  loading,
  onClose,
  onEdit,
  onDelete,
}: {
  id: string;
  party: PartyRec | null;
  loading: boolean;
  onClose: () => void;
  onEdit: (p: PartyRec) => void;
  onDelete: (p: PartyRec) => void;
}): React.JSX.Element {
  const { can, userName } = useApp();
  const inv = useCollection<InvolvementExpanded>('involvements', {
    filter: `party = ${q(id)}`,
    expand: 'matter,work,disclosure,family,agreement',
  });
  const agreements = useCollection<AgreementRec>('agreements', { filter: `counterparty = ${q(id)}`, sort: '-term_start' });

  const matters = groupRows(inv.records, (i) => {
    const m = i.expand?.matter;
    if (m === undefined) return null;
    return { key: m.id, page: 'matter', targetId: m.id, ref: m.ref, title: m.title, sub: `${IP_TYPE_LABEL[m.ip_type]} · ${jurisdictionName(m.jurisdiction)}`, roles: [] };
  });
  const works = groupRows(inv.records, (i) => {
    const w = i.expand?.work;
    if (w === undefined) return null;
    return { key: w.id, page: 'work', targetId: w.id, ref: '', title: w.title, sub: WORK_TYPE_LABEL[w.work_type], roles: [] };
  });
  const inventions = groupRows(inv.records, (i) => {
    const d = i.expand?.disclosure;
    if (d === undefined) return null;
    return { key: d.id, page: 'invention', targetId: d.id, ref: d.ref, title: d.title, sub: DISCLOSURE_STAGE_LABEL[d.stage], roles: [] };
  });
  const families = groupRows(inv.records, (i) => {
    const f = i.expand?.family;
    if (f === undefined) return null;
    const kind = f.kind === 'trademark' ? 'Trademark family' : f.kind === 'design' ? 'Design family' : 'Patent family';
    return { key: f.id, page: 'family', targetId: f.id, ref: '', title: f.title, sub: kind, roles: [] };
  });
  const agreementInv = groupRows(inv.records, (i) => {
    const a = i.expand?.agreement;
    if (a === undefined) return null;
    return { key: a.id, page: 'agreement', targetId: a.id, ref: a.ref, title: a.title, sub: AGREEMENT_TYPE_LABEL[a.agreement_type], roles: [] };
  });

  const total = matters.length + works.length + inventions.length + families.length + agreementInv.length + agreements.records.length;

  if (party === null) {
    return (
      <Drawer open onClose={onClose} title={loading ? 'Loading' : 'Not found'} width={560}>
        {loading ? (
          <Loading />
        ) : (
          <EmptyHint icon={Users} title="This person or company no longer exists" message="It may have been deleted." action={<Button variant="outline" onClick={onClose}>Back to the list</Button>} />
        )}
      </Drawer>
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={party.name}
      width={600}
      footer={
        can.edit ? (
          <>
            {can.manage && (
              <Button variant="ghost" className="mr-auto text-red-600" onClick={() => onDelete(party)}>
                <Trash2 size={14} aria-hidden /> Delete
              </Button>
            )}
            <Button variant="outline" onClick={() => onEdit(party)}>
              <Pencil size={14} aria-hidden /> Edit
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-6">
        <div className="flex items-start gap-3">
          <IdentityChip name={party.name} square={party.kind === 'organization'} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-[13px] text-[var(--agent-app-muted)]">
              {party.kind === 'organization' ? <Building2 size={13} aria-hidden /> : <User size={13} aria-hidden />}
              {KIND_LABEL[party.kind]}
              {party.organization !== '' && <span>· {party.organization}</span>}
            </div>
            {(party.roles ?? []).length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {(party.roles ?? []).map((r) => (
                  <Tag key={r}>{roleLabel(r)}</Tag>
                ))}
              </div>
            )}
          </div>
        </div>

        <FactGrid cols={2}>
          <Fact label="Email" value={party.email !== '' ? <a className="text-[var(--agent-app-accent)] hover:underline" href={`mailto:${party.email}`}>{party.email}</a> : ''} />
          <Fact label="Phone" value={party.phone} />
          <Fact label="Country" value={party.country !== '' ? `${party.country.toUpperCase()} · ${jurisdictionName(party.country)}` : ''} />
          <Fact label="External reference" value={party.external_ref} mono />
          <Fact label="Linked account" value={party.user !== '' ? userName(party.user) : ''} />
          <Fact label={party.kind === 'organization' ? 'Parent company' : 'Organization'} value={party.organization} />
        </FactGrid>
        {party.address !== '' && (
          <div>
            <div className="text-[11px] text-[var(--agent-app-muted)]">Address</div>
            <Prose className="mt-0.5">{party.address}</Prose>
          </div>
        )}
        {party.notes !== '' && (
          <div>
            <div className="text-[11px] text-[var(--agent-app-muted)]">Notes</div>
            <Prose className="mt-0.5">{party.notes}</Prose>
          </div>
        )}

        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="text-[13px] font-semibold">Involved in</h3>
            <span className="text-xs tabular-nums text-[var(--agent-app-muted)]">{inv.loading || agreements.loading ? '' : total}</span>
          </div>
          {inv.loading || agreements.loading ? (
            <Loading />
          ) : inv.error !== null ? (
            <ErrorBox message={inv.error} onRetry={inv.refresh} />
          ) : total === 0 ? (
            <div className="border border-[var(--agent-app-border)]">
              <EmptyHint
                compact
                icon={FileSignature}
                title="Not named anywhere yet"
                message="Name this party on a matter, work or invention, or choose them as the counterparty of an agreement."
              />
            </div>
          ) : (
            <div className="border border-[var(--agent-app-border)]">
              <LinkGroup label="Matters" rows={matters} />
              <LinkGroup label="Works" rows={works} />
              <LinkGroup label="Inventions" rows={inventions} />
              <LinkGroup label="Families" rows={families} />
              <LinkGroup label="Named on agreements" rows={agreementInv} />
              {agreements.records.length > 0 && (
                <div>
                  <GroupHeader label="Counterparty on agreements" count={agreements.records.length} />
                  {agreements.records.map((a) => (
                    <a
                      key={a.id}
                      href={href('agreement', a.id)}
                      className="flex min-h-11 items-center gap-3 border-b border-[var(--agent-app-border)]/70 px-4 py-2 last:border-0 hover:bg-[var(--agent-app-border)]/20"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2 truncate text-sm font-medium">
                          {a.ref !== '' && <Ref>{a.ref}</Ref>}
                          <span className="truncate">{a.title}</span>
                        </div>
                        <div className="truncate text-xs text-[var(--agent-app-muted)]">
                          {AGREEMENT_TYPE_LABEL[a.agreement_type]} · {DIRECTION_LABEL[a.direction] ?? a.direction}
                          {a.perpetual ? ' · Perpetual' : a.term_end !== '' ? ` · Ends ${fmtDate(a.term_end)}` : ''}
                        </div>
                      </div>
                      <Pill tone={AGREEMENT_STATUS_TONE[a.status] ?? 'neutral'}>{a.status.charAt(0).toUpperCase() + a.status.slice(1)}</Pill>
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Drawer>
  );
}

function LinkGroup({ label, rows }: { label: string; rows: LinkRow[] }): React.JSX.Element | null {
  if (rows.length === 0) return null;
  return (
    <div>
      <GroupHeader label={label} count={rows.length} />
      {rows.map((r) => (
        <a
          key={r.key}
          href={href(r.page, r.targetId)}
          className="flex min-h-11 items-center gap-3 border-b border-[var(--agent-app-border)]/70 px-4 py-2 last:border-0 hover:bg-[var(--agent-app-border)]/20"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 truncate text-sm font-medium">
              {r.ref !== '' && <Ref>{r.ref}</Ref>}
              <span className="truncate">{r.title}</span>
            </div>
            <div className="truncate text-xs text-[var(--agent-app-muted)]">{r.sub}</div>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-1">
            {r.roles.map((x, i) => (
              <Tag key={`${x.role}-${i}`} title={x.note !== '' ? x.note : undefined}>
                {INVOLVEMENT_ROLE_LABEL[x.role] ?? x.role}
                {x.share > 0 ? ` ${x.share}%` : ''}
              </Tag>
            ))}
          </div>
        </a>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Create / edit                                                        */
/* ------------------------------------------------------------------ */

interface PartyDraft {
  name: string;
  kind: PartyRec['kind'];
  roles: string[];
  email: string;
  phone: string;
  organization: string;
  country: string;
  address: string;
  external_ref: string;
  notes: string;
  user: string;
}

function draftOf(p: PartyRec | null): PartyDraft {
  return {
    name: p?.name ?? '',
    kind: p?.kind ?? 'person',
    roles: p?.roles ?? [],
    email: p?.email ?? '',
    phone: p?.phone ?? '',
    organization: p?.organization ?? '',
    country: p?.country ?? '',
    address: p?.address ?? '',
    external_ref: p?.external_ref ?? '',
    notes: p?.notes ?? '',
    user: p?.user ?? '',
  };
}

function PartyForm({ party, onClose, onSaved }: { party: PartyRec | null; onClose: () => void; onSaved: (p: PartyRec) => void }): React.JSX.Element {
  const { settings } = useApp();
  const [d, setD] = useState<PartyDraft>(() => draftOf(party));
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof PartyDraft>(k: K, v: PartyDraft[K]): void => setD((x) => ({ ...x, [k]: v }));
  const emailBad = d.email.trim() !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim());

  const save = async (): Promise<void> => {
    if (d.name.trim() === '') {
      toast.error('Enter a name.');
      return;
    }
    if (emailBad) {
      toast.error('Check the email address.');
      return;
    }
    setBusy(true);
    const data: Record<string, unknown> = {
      name: d.name.trim(),
      kind: d.kind,
      roles: d.roles,
      email: d.email.trim(),
      phone: d.phone.trim(),
      organization: d.organization.trim(),
      country: d.country.toUpperCase(),
      address: d.address.trim(),
      external_ref: d.external_ref.trim(),
      notes: d.notes.trim(),
      user: d.user,
    };
    try {
      const saved = party === null ? await createRecord<PartyRec>('parties', data) : await updateRecord<PartyRec>('parties', party.id, data);
      toast.success(party === null ? `${saved.name} added` : 'Changes saved');
      onSaved(saved);
    } catch {
      /* the client already showed the server's message */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={party === null ? 'Add a person or company' : `Edit ${party.name}`}
      className="max-h-[92vh] w-[min(94vw,40rem)] overflow-y-auto"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void save()} disabled={d.name.trim() === ''}>
            {party === null ? 'Add' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <Input label="Name" value={d.name} autoFocus onChange={(e) => set('name', e.target.value)} />
          <Segmented<PartyRec['kind']>
            ariaLabel="Kind"
            value={d.kind}
            onChange={(v) => set('kind', v)}
            options={[
              { value: 'person', label: 'Person' },
              { value: 'organization', label: 'Company' },
            ]}
          />
        </div>

        <Field label="Roles" help="What this party usually is to you. Their role on each matter or agreement is set there.">
          <div className="flex flex-wrap gap-1.5">
            {PARTY_ROLES.map((r) => {
              const on = d.roles.includes(r);
              return (
                <button
                  key={r}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set('roles', on ? d.roles.filter((x) => x !== r) : [...d.roles, r])}
                  className={cn(
                    'border px-2 py-1 text-xs',
                    on
                      ? 'border-[var(--agent-app-accent)] bg-[var(--agent-app-accent)]/10 text-[var(--agent-app-accent)]'
                      : 'border-[var(--agent-app-border)] text-[var(--agent-app-text)]/80 hover:bg-[var(--agent-app-border)]/30',
                  )}
                >
                  {PARTY_ROLE_LABEL[r]}
                </button>
              );
            })}
          </div>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Email" type="email" value={d.email} error={emailBad ? 'This does not look like an email address.' : undefined} onChange={(e) => set('email', e.target.value)} />
          <Input label="Phone" type="tel" value={d.phone} onChange={(e) => set('phone', e.target.value)} />
          <Input
            label={d.kind === 'organization' ? 'Parent company' : 'Organization'}
            value={d.organization}
            placeholder={d.kind === 'organization' ? 'Group or holding company' : 'Employer or firm'}
            onChange={(e) => set('organization', e.target.value)}
          />
          <JurisdictionSelect label="Country" value={d.country} placeholder="Not set" preferred={settings?.jurisdictions ?? undefined} onChange={(v) => set('country', v)} />
        </div>

        <Textarea label="Address" rows={2} value={d.address} onChange={(e) => set('address', e.target.value)} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="External reference" help="Their ID in another system, such as a vendor or talent number.">
            <Input aria-label="External reference" className="font-mono" value={d.external_ref} onChange={(e) => set('external_ref', e.target.value)} />
          </Field>
          <Field label="Linked user account" help="For inventors and colleagues who sign in to IP Manager. An inventor account linked here can read every invention this person is named on, not only the ones they submitted.">
            <UserSelect value={d.user} includeInventors placeholder="No account" onChange={(v) => set('user', v)} />
          </Field>
        </div>

        <Textarea label="Notes" rows={3} value={d.notes} onChange={(e) => set('notes', e.target.value)} />
      </div>
    </Dialog>
  );
}
