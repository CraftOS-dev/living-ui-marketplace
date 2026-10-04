/**
 * One property (franchise, brand, product line): what it holds, where its
 * trademarks are protected class by class, its registrations, works,
 * agreements and documents, and what is coming up.
 */
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { CalendarClock, FileSignature, Layers, Pencil, Plus, Scale, Shield, Trash2 } from 'lucide-react';
import { Button, Card, CardContent, DropdownMenu, Tabs, TabsContent, TabsList, TabsTrigger, toast, useConfirm, useRecord } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { deleteRecord, q } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { d10, daysUntil, fmtDate, plural } from '../lib/format.ts';
import { AGREEMENT_STATUS_TONE, AGREEMENT_TYPE_LABEL, DIRECTION_LABEL, IP_TYPE_LABEL, STATUS_LABEL, statusTone } from '../lib/labels.ts';
import { href, navigate, useHashParam } from '../lib/router.ts';
import type { Page } from '../lib/router.ts';
import type { AgreementRec, DeadlineRec, GrantRec, MatterRec, PartyRec, PropertyRec, WorkRec } from '../lib/types.ts';
import { DataTable } from '../components/DataTable.tsx';
import type { Col } from '../components/DataTable.tsx';
import { DeadlineList, useDeadlineActions } from '../components/deadlines.tsx';
import { DocumentsPanel } from '../components/documents.tsx';
import { CoverageMatrix } from '../components/catalogCoverage.tsx';
import { PropertyForm } from '../components/catalogPropertyForm.tsx';
import {
  AGREEMENT_STATUS_LABEL,
  DIRECTION_TONE,
  PROPERTY_KIND_LABEL,
  PropertyStatusPill,
  RightsBasisPill,
  RowLink,
  Thumb,
  TreeTable,
  WorkStatusPill,
  WorkTypeLabel,
  ancestorsOf,
  childrenOf,
  termText,
} from '../components/catalogShared.tsx';
import { WorkForm } from '../components/catalogWorkForm.tsx';
import { EmptyHint, ErrorBox, JurChip, ListRow, Loading, Pill, Prose, Ref, Section, StatTile, Tag } from '../components/ui.tsx';

const ACTIVE_AGREEMENT = new Set(['active', 'renewed']);
const TYPE_PAGE: { page: Page; label: string }[] = [
  { page: 'trademarks', label: 'Trademark' },
  { page: 'patents', label: 'Patent' },
  { page: 'designs', label: 'Design' },
  { page: 'copyrights', label: 'Copyright' },
];

interface DealRow {
  id: string;
  a: AgreementRec;
  via: 'agreement' | 'grant';
}

function countsOf(matters: MatterRec[], types: MatterRec['ip_type'][]): { live: number; pending: number } {
  let live = 0;
  let pending = 0;
  for (const m of matters) {
    if (!types.includes(m.ip_type)) continue;
    if (m.status_group === 'live') live += 1;
    else if (m.status_group === 'pending') pending += 1;
  }
  return { live, pending };
}

export function PropertyPage({ id }: { id: string }): React.JSX.Element {
  const { vocab, can, properties } = useApp();
  const { record: property, loading, error } = useRecord<PropertyRec>('properties', id !== '' ? id : null);
  const [tab, setTab] = useHashParam('tab', 'overview');
  const [editing, setEditing] = useState(false);
  const [newWork, setNewWork] = useState(false);
  const [confirmEl, confirm] = useConfirm();
  const pid = q(id);
  const matters = useCollection<MatterRec>('matters', { filter: `property = ${pid} || family.property = ${pid}`, sort: 'ref' });
  const works = useCollection<WorkRec>('works', { filter: `property = ${pid}`, sort: 'title' });
  const agreements = useCollection<AgreementRec>('agreements', { filter: `property = ${pid}`, sort: '-term_start', expand: 'counterparty' });
  const grants = useCollection<GrantRec>('grants', { filter: `properties ~ ${pid}`, expand: 'agreement,agreement.counterparty' });
  const deadlines = useCollection<DeadlineRec>('deadlines', {
    filter: `status = "open" && (matter.property = ${pid} || matter.family.property = ${pid} || agreement.property = ${pid} || work.property = ${pid})`,
    sort: 'due_date',
    expand: 'matter,agreement,work',
  });
  const { actions, dialogs, canEdit } = useDeadlineActions();

  const deals = useMemo((): DealRow[] => {
    const out = new Map<string, DealRow>();
    for (const a of agreements.records) out.set(a.id, { id: a.id, a, via: 'agreement' });
    for (const g of grants.records) {
      const a = g.expand?.['agreement'] as AgreementRec | undefined;
      if (a !== undefined && !out.has(a.id)) out.set(a.id, { id: a.id, a, via: 'grant' });
    }
    return [...out.values()].sort((x, y) => x.a.ref.localeCompare(y.a.ref, undefined, { numeric: true }));
  }, [agreements.records, grants.records]);

  const coming = useMemo(() => deadlines.records.filter((d) => daysUntil(d10(d.due_date)) <= 120), [deadlines.records]);
  const overdue = deadlines.records.filter((d) => daysUntil(d10(d.due_date)) < 0).length;
  const coverageKey = useMemo(() => matters.records.map((m) => `${m.id}:${m.updated}`).join('|'), [matters.records]);

  if (id === '') {
    return (
      <EmptyHint
        icon={Layers}
        title={`Choose a ${vocab.property.toLowerCase()}`}
        action={
          <Button onClick={() => navigate('properties')}>
            Open {vocab.properties.toLowerCase()}
          </Button>
        }
      />
    );
  }
  if (loading && property === null) return <Loading />;
  if (property === null) {
    return (
      <Card>
        <EmptyHint
          icon={Layers}
          title={`This ${vocab.property.toLowerCase()} was not found`}
          message={error ?? 'It may have been deleted.'}
          action={
            <Button variant="outline" onClick={() => navigate('properties')}>
              Back to {vocab.properties.toLowerCase()}
            </Button>
          }
        />
      </Card>
    );
  }

  const parent = properties.find((p) => p.id === property.parent);
  const lineage = ancestorsOf(properties, property.id).reverse();
  const inheritedFrom = property.rights_basis === '' ? ancestorsOf(properties, property.id).find((a) => a.rights_basis !== '') : undefined;
  const children = properties.filter((p) => p.parent === property.id);

  const tm = countsOf(matters.records, ['trademark']);
  const pat = countsOf(matters.records, ['patent', 'utility_model']);
  const des = countsOf(matters.records, ['design']);
  const cr = countsOf(matters.records, ['copyright']);
  const activeDeals = deals.filter((d) => ACTIVE_AGREEMENT.has(d.a.status)).length;
  const subOf = (c: { live: number; pending: number }): string =>
    [c.live > 0 ? `${c.live} in force` : '', c.pending > 0 ? `${c.pending} pending` : ''].filter((x) => x !== '').join(', ') || 'None on file';

  const remove = async (): Promise<void> => {
    const kids = children.length > 0 ? ` ${plural(children.length, `nested ${vocab.property.toLowerCase()}`)} move${children.length === 1 ? 's' : ''} to the top level.` : '';
    const ok = await confirm(
      `Delete "${property.name}"? Its registrations, ${vocab.works.toLowerCase()}, agreements and documents stay in IP Manager but lose the link to this ${vocab.property.toLowerCase()}.${kids} This cannot be undone.`,
      `Delete ${vocab.property.toLowerCase()}`,
    );
    if (!ok) return;
    try {
      await deleteRecord('properties', property.id);
      toast.success(`${property.name} deleted`);
      navigate('properties');
    } catch {
      /* the client already showed the error */
    }
  };

  const subjectLabel = (d: DeadlineRec): ReactNode => {
    const m = d.expand?.['matter'] as MatterRec | undefined;
    if (m !== undefined) return m.title;
    const a = d.expand?.['agreement'] as AgreementRec | undefined;
    if (a !== undefined) return a.title;
    const w = d.expand?.['work'] as WorkRec | undefined;
    return w?.title;
  };

  const matterCols: Col<MatterRec>[] = [
    { key: 'ref', label: 'Reference', render: (m) => <Ref dead={m.status_group === 'dead'}>{m.ref || 'No reference'}</Ref> },
    { key: 'ip_type', label: 'Type', value: (m) => IP_TYPE_LABEL[m.ip_type], render: (m) => <span className="text-[var(--agent-app-muted)]">{IP_TYPE_LABEL[m.ip_type]}</span> },
    { key: 'title', label: 'Title', render: (m) => <span className="block max-w-[22rem] truncate font-medium">{m.title}</span> },
    { key: 'jurisdiction', label: 'Jurisdiction', render: (m) => <JurChip code={m.jurisdiction} /> },
    {
      key: 'status',
      label: 'Status',
      value: (m) => STATUS_LABEL[m.status],
      render: (m) => <Pill tone={statusTone(m.status, m.status_group)}>{STATUS_LABEL[m.status]}</Pill>,
    },
    { key: 'application_no', label: 'Application no.', render: (m) => <span className="font-mono text-[12px]">{m.application_no}</span> },
    {
      key: 'registration',
      label: 'Registration',
      value: (m) => m.registration_no,
      render: (m) =>
        m.registration_no !== '' || d10(m.registration_date) !== '' ? (
          <span className="flex flex-col">
            <span className="font-mono text-[12px]">{m.registration_no}</span>
            <span className="text-xs text-[var(--agent-app-muted)]">{fmtDate(m.registration_date)}</span>
          </span>
        ) : null,
    },
    { key: 'expiry', label: 'Expiry', value: (m) => d10(m.expiry_date), render: (m) => <span className="whitespace-nowrap tabular-nums">{fmtDate(m.expiry_date)}</span> },
    {
      key: 'next',
      label: 'Next deadline',
      value: (m) => d10(m.next_deadline),
      render: (m) =>
        d10(m.next_deadline) !== '' ? (
          <span className="flex flex-col">
            <span className="whitespace-nowrap tabular-nums">{fmtDate(m.next_deadline)}</span>
            <span className="block max-w-[12rem] truncate text-xs text-[var(--agent-app-muted)]">{m.next_deadline_title}</span>
          </span>
        ) : null,
    },
  ];

  const dealCols: Col<DealRow>[] = [
    { key: 'ref', label: 'Reference', value: (r) => r.a.ref, render: (r) => <Ref>{r.a.ref}</Ref> },
    {
      key: 'title',
      label: 'Title',
      value: (r) => r.a.title,
      render: (r) => (
        <span className="flex flex-col">
          <span className="max-w-[20rem] truncate font-medium">{r.a.title}</span>
          {r.via === 'grant' && <span className="text-xs text-[var(--agent-app-muted)]">Named in a rights grant</span>}
        </span>
      ),
    },
    { key: 'direction', label: 'Direction', value: (r) => DIRECTION_LABEL[r.a.direction] ?? r.a.direction, render: (r) => <Pill tone={DIRECTION_TONE[r.a.direction] ?? 'neutral'}>{DIRECTION_LABEL[r.a.direction] ?? r.a.direction}</Pill> },
    { key: 'type', label: 'Type', value: (r) => AGREEMENT_TYPE_LABEL[r.a.agreement_type], render: (r) => <span className="text-[var(--agent-app-muted)]">{AGREEMENT_TYPE_LABEL[r.a.agreement_type]}</span> },
    {
      key: 'counterparty',
      label: 'Counterparty',
      value: (r) => (r.a.expand?.['counterparty'] as PartyRec | undefined)?.name ?? '',
      render: (r) => (r.a.expand?.['counterparty'] as PartyRec | undefined)?.name ?? <span className="text-[var(--agent-app-muted)]">Not set</span>,
    },
    { key: 'term', label: 'Term', value: (r) => d10(r.a.term_start), render: (r) => <span className="whitespace-nowrap text-[12.5px]">{termText(r.a.term_start, r.a.term_end, r.a.perpetual)}</span> },
    {
      key: 'status',
      label: 'Status',
      value: (r) => AGREEMENT_STATUS_LABEL[r.a.status] ?? r.a.status,
      render: (r) => <Pill tone={AGREEMENT_STATUS_TONE[r.a.status] ?? 'neutral'}>{AGREEMENT_STATUS_LABEL[r.a.status] ?? r.a.status}</Pill>,
    },
  ];

  const workChildren = childrenOf(works.records);
  const newWorkButton = can.edit ? (
    <Button size="sm" variant="outline" onClick={() => setNewWork(true)}>
      <Plus size={13} aria-hidden /> New {vocab.work.toLowerCase()}
    </Button>
  ) : undefined;

  return (
    <div>
      {confirmEl}
      {dialogs}
      <nav className="mb-3 flex flex-wrap items-center gap-1.5 text-[12px] text-[var(--agent-app-muted)]" aria-label="Breadcrumb">
        <a href={href('properties')} className="hover:text-[var(--agent-app-text)] hover:underline">
          {vocab.properties}
        </a>
        {lineage.map((a) => (
          <span key={a.id} className="flex items-center gap-1.5">
            <span aria-hidden>/</span>
            <a href={href('property', a.id)} className="hover:text-[var(--agent-app-text)] hover:underline">
              {a.name}
            </a>
          </span>
        ))}
      </nav>

      <Card className="mb-5">
        <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start">
          <Thumb record={property} image={property.image} name={property.name} size="xl" />
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold tracking-tight">{property.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
              {property.kind !== '' && <Tag>{PROPERTY_KIND_LABEL[property.kind]}</Tag>}
              <RightsBasisPill basis={inheritedFrom?.rights_basis ?? property.rights_basis} inherited={inheritedFrom?.name} />
              <PropertyStatusPill status={property.status} />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-[var(--agent-app-muted)]">
              {parent !== undefined && (
                <span>
                  Part of{' '}
                  <a href={href('property', parent.id)} className="font-medium text-[var(--agent-app-text)] hover:underline">
                    {parent.name}
                  </a>
                </span>
              )}
              {property.business_unit !== '' && <span>Business unit: {property.business_unit}</span>}
            </div>
            {property.description !== '' && <p className="mt-2 line-clamp-2 max-w-3xl text-[13px] text-[var(--agent-app-text)]/85">{property.description}</p>}
          </div>
          {(can.edit || can.manage) && (
            <div className="flex shrink-0 gap-2">
              {can.edit && (
                <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                  <Pencil size={13} aria-hidden /> Edit
                </Button>
              )}
              {can.manage && (
                <Button variant="outline" size="sm" onClick={() => void remove()} aria-label={`Delete ${property.name}`}>
                  <Trash2 size={13} aria-hidden /> Delete
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <div className="overflow-x-auto">
          <TabsList>
            <TabsTrigger className="whitespace-nowrap" value="overview">Overview</TabsTrigger>
            <TabsTrigger className="whitespace-nowrap" value="coverage">Trademark coverage</TabsTrigger>
            <TabsTrigger className="whitespace-nowrap" value="registrations">Registrations</TabsTrigger>
            <TabsTrigger className="whitespace-nowrap" value="works">{vocab.works}</TabsTrigger>
            <TabsTrigger className="whitespace-nowrap" value="agreements">Agreements</TabsTrigger>
            <TabsTrigger className="whitespace-nowrap" value="documents">Documents</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview" className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 2xl:grid-cols-7">
            <StatTile label="Trademarks" value={tm.live + tm.pending} sub={subOf(tm)} onClick={() => setTab('coverage')} />
            <StatTile label="Patents" value={pat.live + pat.pending} sub={subOf(pat)} onClick={() => setTab('registrations')} />
            <StatTile label="Designs" value={des.live + des.pending} sub={subOf(des)} onClick={() => setTab('registrations')} />
            <StatTile label="Copyrights" value={cr.live + cr.pending} sub={subOf(cr)} onClick={() => setTab('registrations')} />
            <StatTile label={vocab.works} value={works.records.length} sub={`${workChildren.get('')?.length ?? 0} top level`} onClick={() => setTab('works')} />
            <StatTile label="Active agreements" value={activeDeals} sub={`${deals.length} in total`} onClick={() => setTab('agreements')} />
            <StatTile label="Open deadlines" value={deadlines.records.length} tone={overdue > 0 ? 'bad' : undefined} sub={overdue > 0 ? `${overdue} overdue` : 'None overdue'} />
          </div>

          <Section title="Coming up" meta={coming.length > 0 ? `${coming.length} in the next 120 days` : undefined} flush>
            {deadlines.loading && deadlines.records.length === 0 ? (
              <Loading />
            ) : deadlines.error !== null && deadlines.records.length === 0 ? (
              <div className="p-4">
                <ErrorBox message={deadlines.error} onRetry={deadlines.refresh} />
              </div>
            ) : (
              <DeadlineList
                deadlines={coming}
                actions={canEdit ? actions : null}
                subjectLabel={subjectLabel}
                empty={
                  <EmptyHint
                    compact
                    icon={CalendarClock}
                    title="Nothing due in the next 120 days"
                    message={
                      deadlines.records.length > 0
                        ? `${plural(deadlines.records.length, 'open deadline')} fall${deadlines.records.length === 1 ? 's' : ''} later. The Deadlines page shows them all.`
                        : `Deadlines for this ${vocab.property.toLowerCase()}'s registrations, ${vocab.works.toLowerCase()} and agreements appear here.`
                    }
                    action={
                      <Button size="sm" variant="outline" onClick={() => navigate('deadlines')}>
                        Open deadlines
                      </Button>
                    }
                  />
                }
              />
            )}
          </Section>

          {children.length > 0 && (
            <Section title={`Nested ${vocab.properties.toLowerCase()}`} meta={String(children.length)} flush>
              {children.map((c) => (
                <ListRow
                  key={c.id}
                  leading={<Thumb record={c} image={c.image} name={c.name} size="sm" />}
                  primary={c.name}
                  secondary={[c.kind !== '' ? PROPERTY_KIND_LABEL[c.kind] : '', c.business_unit].filter((x) => x !== '').join(', ') || undefined}
                  trailing={<PropertyStatusPill status={c.status} />}
                  onClick={() => navigate('property', c.id)}
                />
              ))}
            </Section>
          )}

          {(property.description !== '' || (property.tags ?? []).length > 0) && (
            <Section title="About">
              {property.description !== '' && <Prose>{property.description}</Prose>}
              {(property.tags ?? []).length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {(property.tags ?? []).map((t) => (
                    <Tag key={t}>{t}</Tag>
                  ))}
                </div>
              )}
            </Section>
          )}
        </TabsContent>

        <TabsContent value="coverage">
          <CoverageMatrix
            propertyId={property.id}
            refreshKey={coverageKey}
            counts={[
              { label: 'Trademarks', value: tm.live + tm.pending, sub: subOf(tm) },
              { label: 'Patents', value: pat.live + pat.pending, sub: subOf(pat) },
              { label: 'Designs', value: des.live + des.pending, sub: subOf(des) },
              { label: 'Copyrights', value: cr.live + cr.pending, sub: subOf(cr) },
            ]}
          />
        </TabsContent>

        <TabsContent value="registrations">
          <Section
            title="Registrations"
            meta={matters.records.length > 0 ? String(matters.records.length) : undefined}
            flush
            actions={
              can.edit ? (
                <DropdownMenu
                  align="right"
                  trigger={
                    <Button size="sm" variant="outline">
                      <Plus size={13} aria-hidden /> New registration
                    </Button>
                  }
                  items={TYPE_PAGE.map((t) => ({ label: t.label, onSelect: () => navigate(t.page, undefined, { new: '1' }) }))}
                />
              ) : undefined
            }
          >
            {matters.loading && matters.records.length === 0 ? (
              <Loading />
            ) : matters.error !== null && matters.records.length === 0 ? (
              <div className="p-4">
                <ErrorBox message={matters.error} onRetry={matters.refresh} />
              </div>
            ) : (
              <DataTable<MatterRec>
                tableId="property-registrations"
                rows={matters.records}
                columns={matterCols}
                onRowClick={(m) => navigate('matter', m.id)}
                exportName={`${property.name} registrations`}
                empty={
                  <EmptyHint
                    compact
                    icon={Shield}
                    title="No registrations yet"
                    message={`Trademarks, patents, designs and copyrights linked to ${property.name} (directly or through their family) are listed here.`}
                  />
                }
              />
            )}
          </Section>
        </TabsContent>

        <TabsContent value="works">
          <Section title={vocab.works} meta={works.records.length > 0 ? String(works.records.length) : undefined} flush actions={newWorkButton}>
            {works.loading && works.records.length === 0 ? (
              <Loading />
            ) : works.error !== null && works.records.length === 0 ? (
              <div className="p-4">
                <ErrorBox message={works.error} onRetry={works.refresh} />
              </div>
            ) : works.records.length === 0 ? (
              <EmptyHint
                compact
                icon={Layers}
                title={`No ${vocab.works.toLowerCase()} yet`}
                message={vocab.workHint}
                action={
                  can.edit ? (
                    <Button size="sm" onClick={() => setNewWork(true)}>
                      <Plus size={13} aria-hidden /> New {vocab.work.toLowerCase()}
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <TreeTable<WorkRec>
                items={works.records}
                primaryLabel={vocab.work}
                rowHref={(w) => href('work', w.id)}
                primary={(w) => (
                  <span className="flex min-w-0 items-center gap-2">
                    <WorkTypeLabel type={w.work_type} iconOnly />
                    <RowLink to={href('work', w.id)}>{w.title}</RowLink>
                  </span>
                )}
                columns={[
                  { key: 'type', label: 'Type', className: 'hidden sm:table-cell', render: (w) => <WorkTypeLabel type={w.work_type} /> },
                  { key: 'status', label: 'Status', render: (w) => <WorkStatusPill status={w.status} /> },
                  { key: 'pub', label: 'Published', className: 'hidden md:table-cell', render: (w) => <span className="whitespace-nowrap tabular-nums">{fmtDate(w.publication_date)}</span> },
                ]}
              />
            )}
          </Section>
        </TabsContent>

        <TabsContent value="agreements">
          <Section
            title="Agreements"
            meta={deals.length > 0 ? String(deals.length) : undefined}
            flush
            actions={
              <Button size="sm" variant="outline" onClick={() => navigate('rights', undefined, { property: property.id })}>
                <Scale size={13} aria-hidden /> Check rights availability
              </Button>
            }
          >
            {(agreements.loading || grants.loading) && deals.length === 0 ? (
              <Loading />
            ) : agreements.error !== null && deals.length === 0 ? (
              <div className="p-4">
                <ErrorBox message={agreements.error} onRetry={agreements.refresh} />
              </div>
            ) : (
              <DataTable<DealRow>
                tableId="property-agreements"
                rows={deals}
                columns={dealCols}
                onRowClick={(r) => navigate('agreement', r.a.id)}
                exportName={`${property.name} agreements`}
                empty={
                  <EmptyHint
                    compact
                    icon={FileSignature}
                    title="No agreements yet"
                    message={`Agreements linked to ${property.name}, or whose rights grants name it, are listed here.`}
                    action={
                      <Button size="sm" variant="outline" onClick={() => navigate('agreements')}>
                        Open agreements
                      </Button>
                    }
                  />
                }
              />
            )}
          </Section>
        </TabsContent>

        <TabsContent value="documents">
          <DocumentsPanel relation="property" relationId={property.id} />
        </TabsContent>
      </Tabs>

      {editing && <PropertyForm property={property} onClose={() => setEditing(false)} />}
      {newWork && <WorkForm work={null} defaults={{ property: property.id }} onClose={() => setNewWork(false)} onSaved={(w) => navigate('work', w.id)} />}
    </div>
  );
}
