/**
 * One work (title, asset): facts and copyright term, registrations,
 * clearance and chain of title, the rights held in it (directly or through
 * its parents and property), deadlines, child works and documents.
 */
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { BookOpen, CalendarClock, Copyright, FilePlus2, Pencil, Plus, Scale, Trash2 } from 'lucide-react';
import { Button, Card, CardContent, Dialog, Input, Tabs, TabsContent, TabsList, TabsTrigger, toast, useConfirm, useRecord } from '../../kit/index.ts';
import { useCollection, useLiveAsync } from '../lib/live.ts';
import { createRecord, deleteRecord, errText, op, q } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { d10, daysUntil, fmtDate, plural, relLabel, today } from '../lib/format.ts';
import { STATUS_LABEL, WORK_TYPE_LABEL, jurisdictionName, statusTone } from '../lib/labels.ts';
import { href, navigate, useHashParam } from '../lib/router.ts';
import type { AgreementRec, DeadlineRec, GrantRec, MatterRec, PartyRec, WorkRec } from '../lib/types.ts';
import { DataTable } from '../components/DataTable.tsx';
import type { Col } from '../components/DataTable.tsx';
import { DeadlineList, useDeadlineActions } from '../components/deadlines.tsx';
import { DocumentsPanel } from '../components/documents.tsx';
import { JurisdictionSelect, dimSpecLabel } from '../components/pickers.tsx';
import { ClearanceList } from '../components/catalogClearances.tsx';
import {
  AUTHOR_KIND_LABEL,
  AGREEMENT_STATUS_LABEL,
  CHILD_WORK_TYPE,
  DIRECTION_TONE,
  DateField,
  RIGHTS_BASIS_LABEL,
  RightsBasisPill,
  RowLink,
  Thumb,
  TreeTable,
  WorkStatusPill,
  WorkTypeLabel,
  ancestorsOf,
  descendantIds,
  effectiveBasis,
  termText,
} from '../components/catalogShared.tsx';
import { WorkForm } from '../components/catalogWorkForm.tsx';
import type { WorkDefaults } from '../components/catalogWorkForm.tsx';
import {
  EmptyHint,
  ErrorBox,
  Fact,
  FactGrid,
  Field,
  JurChip,
  Loading,
  Notice,
  Pill,
  Prose,
  Ref,
  Section,
  Segmented,
  Tag,
} from '../components/ui.tsx';

interface TermRow {
  date: string;
  text: string;
}
type CopyrightTerms = Record<'US' | 'JP' | 'EU', TermRow>;

const TERM_ROWS: { key: 'US' | 'JP' | 'EU'; label: string }[] = [
  { key: 'US', label: 'United States' },
  { key: 'JP', label: 'Japan' },
  { key: 'EU', label: 'European Union' },
];

const GRANT_KIND_LABEL: Record<GrantRec['kind'], string> = {
  grant: 'Grant',
  holdback: 'Holdback',
  restriction: 'Restriction',
  reservation: 'Reserved by licensor',
};

const DIRECTION_TEXT: Record<GrantRec['direction'], string> = { in: 'Rights in', out: 'Rights out' };

interface GrantRow {
  g: GrantRec;
  a: AgreementRec | undefined;
  via: string;
}

export function WorkPage({ id }: { id: string }): React.JSX.Element {
  const { vocab, can, properties, dimensions, dimValues } = useApp();
  const { record: work, loading, error } = useRecord<WorkRec>('works', id !== '' ? id : null);
  const all = useCollection<WorkRec>('works', { sort: 'title' });
  const [tab, setTab] = useHashParam('tab', 'overview');
  const [form, setForm] = useState<'edit' | 'child' | null>(null);
  const [addReg, setAddReg] = useState(false);
  const [dlView, setDlView] = useState<'open' | 'all'>('open');
  const [confirmEl, confirm] = useConfirm();
  const wid = q(id);

  const ancestors = useMemo(() => ancestorsOf(all.records, id), [all.records, id]);
  const descendants = useMemo(() => descendantIds(all.records, id), [all.records, id]);

  // Properties above this work: its own, its parents', and their parent properties.
  const propertyChain = useMemo(() => {
    const byId = new Map(properties.map((p) => [p.id, p]));
    const start = [work?.property ?? '', ...ancestors.map((a) => a.property)].filter((x) => x !== '');
    const out: string[] = [];
    for (const s of start) {
      let cur = byId.get(s);
      if (cur === undefined && !out.includes(s)) out.push(s);
      while (cur !== undefined && !out.includes(cur.id)) {
        out.push(cur.id);
        cur = cur.parent !== '' ? byId.get(cur.parent) : undefined;
      }
    }
    return out;
  }, [work?.property, ancestors, properties]);

  const grantFilter = useMemo(
    () => [`works ~ ${wid}`, ...ancestors.map((a) => `works ~ ${q(a.id)}`), ...propertyChain.map((p) => `properties ~ ${q(p)}`)].join(' || '),
    [wid, ancestors, propertyChain],
  );

  const matters = useCollection<MatterRec>('matters', { filter: `work = ${wid} && ip_type = "copyright"`, sort: 'jurisdiction' });
  const deadlines = useCollection<DeadlineRec>('deadlines', { filter: `work = ${wid} || matter.work = ${wid}`, sort: 'due_date', expand: 'matter' });
  const grants = useCollection<GrantRec>('grants', { filter: grantFilter, sort: 'created', expand: 'agreement,agreement.counterparty' });
  const terms = useLiveAsync(
    () => (work === null ? Promise.resolve(null) : op<CopyrightTerms>('works/copyright-term', { work_id: work.id })),
    [work?.id ?? '', work?.updated ?? ''],
    ['works', 'matters'],
  );
  const { actions, dialogs, canEdit } = useDeadlineActions();

  const grantRows = useMemo((): GrantRow[] => {
    const titleOf = new Map(ancestors.map((a) => [a.id, a.title]));
    const propName = new Map(properties.map((p) => [p.id, p.name]));
    return grants.records.map((g) => {
      const a = g.expand?.['agreement'] as AgreementRec | undefined;
      let via = '';
      if (!(g.works ?? []).includes(id)) {
        const anc = ancestors.find((x) => (g.works ?? []).includes(x.id));
        if (anc !== undefined) via = titleOf.get(anc.id) ?? '';
        else {
          const p = propertyChain.find((x) => (g.properties ?? []).includes(x));
          if (p !== undefined) via = propName.get(p) ?? '';
        }
      }
      return { g, a, via };
    });
  }, [grants.records, ancestors, properties, propertyChain, id]);

  const enabledDims = useMemo(() => dimensions.filter((d) => d.enabled).sort((x, y) => x.order - y.order), [dimensions]);

  if (id === '') {
    return <EmptyHint icon={BookOpen} title={`Choose a ${vocab.work.toLowerCase()}`} action={<Button onClick={() => navigate('works')}>Open {vocab.works.toLowerCase()}</Button>} />;
  }
  if (loading && work === null) return <Loading />;
  if (work === null) {
    return (
      <Card>
        <EmptyHint
          icon={BookOpen}
          title={`This ${vocab.work.toLowerCase()} was not found`}
          message={error ?? 'It may have been deleted.'}
          action={
            <Button variant="outline" onClick={() => navigate('works')}>
              Back to {vocab.works.toLowerCase()}
            </Button>
          }
        />
      </Card>
    );
  }

  const property = properties.find((p) => p.id === work.property);
  const parent = ancestors[0];
  const basis = effectiveBasis(work, all.records, properties);
  const childItems = all.records.filter((w) => descendants.has(w.id));
  const directChildren = all.records.filter((w) => w.parent === work.id).length;
  const shownDeadlines = dlView === 'open' ? deadlines.records.filter((d) => d.status === 'open') : deadlines.records;
  const openDeadlines = deadlines.records.filter((d) => d.status === 'open').length;

  const childDefaults: WorkDefaults = { parent: work.id, property: work.property, work_type: CHILD_WORK_TYPE[work.work_type] };

  const remove = async (): Promise<void> => {
    const kids = directChildren > 0 ? ` ${plural(directChildren, `child ${vocab.work.toLowerCase()}`)} move${directChildren === 1 ? 's' : ''} up to the top level.` : '';
    const ok = await confirm(
      `Delete "${work.title}"? Its clearance items, history and deadlines are deleted too. Registrations, documents and agreements stay but lose the link.${kids} This cannot be undone.`,
      `Delete ${vocab.work.toLowerCase()}`,
    );
    if (!ok) return;
    try {
      await deleteRecord('works', work.id);
      toast.success(`${work.title} deleted`);
      if (parent !== undefined) navigate('work', parent.id);
      else navigate('works');
    } catch {
      /* the client already showed the error */
    }
  };

  const idFacts: { label: string; value: string }[] = [
    { label: 'EIDR', value: work.eidr },
    { label: 'ISRC', value: work.isrc },
    { label: 'ISWC', value: work.iswc },
    { label: 'ISBN', value: work.isbn },
    { label: 'Other identifiers', value: work.other_ids },
  ].filter((f) => f.value !== '');

  const regCols: Col<MatterRec>[] = [
    { key: 'ref', label: 'Reference', render: (m) => <Ref dead={m.status_group === 'dead'}>{m.ref || 'No reference'}</Ref> },
    { key: 'jurisdiction', label: 'Jurisdiction', render: (m) => <JurChip code={m.jurisdiction} /> },
    { key: 'registration_no', label: 'Registration no.', value: (m) => m.registration_no || m.application_no, render: (m) => <span className="font-mono text-[12px]">{m.registration_no || (m.application_no !== '' ? `${m.application_no} (application)` : '')}</span> },
    { key: 'registration_date', label: 'Registration date', value: (m) => d10(m.registration_date), render: (m) => <span className="whitespace-nowrap tabular-nums">{fmtDate(m.registration_date)}</span> },
    { key: 'owner_of_record', label: 'Claimant', optional: true },
    { key: 'status', label: 'Status', value: (m) => STATUS_LABEL[m.status], render: (m) => <Pill tone={statusTone(m.status, m.status_group)}>{STATUS_LABEL[m.status]}</Pill> },
  ];

  const subjectLabel = (d: DeadlineRec): ReactNode => {
    const m = d.expand?.['matter'] as MatterRec | undefined;
    return m !== undefined ? `${m.ref} ${m.title}` : undefined;
  };

  return (
    <div>
      {confirmEl}
      {dialogs}
      <nav className="mb-3 flex flex-wrap items-center gap-1.5 text-[12px] text-[var(--agent-app-muted)]" aria-label="Breadcrumb">
        <a href={href('works')} className="hover:text-[var(--agent-app-text)] hover:underline">
          {vocab.works}
        </a>
        {[...ancestors].reverse().map((a) => (
          <span key={a.id} className="flex items-center gap-1.5">
            <span aria-hidden>/</span>
            <a href={href('work', a.id)} className="hover:text-[var(--agent-app-text)] hover:underline">
              {a.title}
            </a>
          </span>
        ))}
      </nav>

      <Card className="mb-5">
        <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start">
          <Thumb record={work} image={work.image} name={work.title} size="xl" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Tag>{WORK_TYPE_LABEL[work.work_type]}</Tag>
              <WorkStatusPill status={work.status} />
            </div>
            <h1 className="mt-1.5 text-xl font-semibold tracking-tight">{work.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-[var(--agent-app-muted)]">
              {property !== undefined && (
                <span>
                  {vocab.property}:{' '}
                  <a href={href('property', property.id)} className="font-medium text-[var(--agent-app-text)] hover:underline">
                    {property.name}
                  </a>
                </span>
              )}
              {parent !== undefined && (
                <span>
                  Part of{' '}
                  <a href={href('work', parent.id)} className="font-medium text-[var(--agent-app-text)] hover:underline">
                    {parent.title}
                  </a>
                </span>
              )}
              <span className="inline-flex items-center gap-1.5">
                Rights: <RightsBasisPill basis={basis.basis} inherited={basis.from} />
              </span>
            </div>
          </div>
          {(can.edit || can.manage) && (
            <div className="flex shrink-0 flex-wrap gap-2">
              {can.edit && (
                <>
                  <Button variant="outline" size="sm" onClick={() => setForm('edit')}>
                    <Pencil size={13} aria-hidden /> Edit
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setForm('child')}>
                    <Plus size={13} aria-hidden /> Add child
                  </Button>
                </>
              )}
              {can.manage && (
                <Button variant="outline" size="sm" onClick={() => void remove()} aria-label={`Delete ${work.title}`}>
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
            <TabsTrigger className="whitespace-nowrap" value="registrations">Registrations{matters.records.length > 0 ? ` (${matters.records.length})` : ''}</TabsTrigger>
            <TabsTrigger className="whitespace-nowrap" value="clearance">Clearance</TabsTrigger>
            <TabsTrigger className="whitespace-nowrap" value="rights">Rights</TabsTrigger>
            <TabsTrigger className="whitespace-nowrap" value="deadlines">Deadlines{openDeadlines > 0 ? ` (${openDeadlines})` : ''}</TabsTrigger>
            <TabsTrigger className="whitespace-nowrap" value="children">
              {vocab.works}
              {childItems.length > 0 ? ` (${childItems.length})` : ''}
            </TabsTrigger>
            <TabsTrigger className="whitespace-nowrap" value="documents">Documents</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview" className="flex flex-col gap-5">
          <Section title="Facts">
            <FactGrid cols={4}>
              <Fact label="Created" value={fmtDate(work.creation_date)} />
              <Fact
                label="First published"
                value={
                  d10(work.publication_date) !== '' ? (
                    <span className="inline-flex items-center gap-1.5">
                      {fmtDate(work.publication_date)}
                      {work.publication_country !== '' && <JurChip code={work.publication_country} />}
                    </span>
                  ) : work.publication_country !== '' ? (
                    jurisdictionName(work.publication_country)
                  ) : (
                    ''
                  )
                }
              />
              <Fact label="Language" value={work.language} />
              <Fact label="Made for hire" value={work.made_for_hire ? 'Yes' : 'No'} />
              <Fact label="Authors" value={work.authors} />
              <Fact label="Author type" value={work.author_kind !== '' ? AUTHOR_KIND_LABEL[work.author_kind] : ''} />
              <Fact label="Author death year" value={work.author_death_year > 0 ? String(work.author_death_year) : ''} />
              {idFacts.length === 0 ? (
                <Fact label="Identifiers" value="" />
              ) : (
                idFacts.map((f) => <Fact key={f.label} label={f.label} value={f.value} mono />)
              )}
            </FactGrid>
          </Section>

          <Section title="Copyright term" meta="When protection ends, by law">
            {terms.loading && terms.data === null ? (
              <p className="text-sm text-[var(--agent-app-muted)]">Working out the term...</p>
            ) : terms.error !== null && terms.data === null ? (
              <ErrorBox message={terms.error} onRetry={terms.reload} />
            ) : terms.data !== null ? (
              <div className="-my-2">
                {TERM_ROWS.map((r) => {
                  const t = terms.data?.[r.key];
                  const date = d10(t?.date);
                  return (
                    <div key={r.key} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5 border-b border-[var(--agent-app-border)]/60 py-2.5 last:border-0 sm:grid-cols-[11rem_9rem_minmax(0,1fr)]">
                      <span className="flex items-center gap-2 text-[13px] font-medium">
                        <JurChip code={r.key} />
                        {r.label}
                      </span>
                      <span className="text-right text-[13px] tabular-nums sm:text-left">
                        {date !== '' ? (
                          <span title={relLabel(date)} className={daysUntil(date) < 0 ? 'text-[var(--agent-app-muted)]' : undefined}>
                            {fmtDate(date)}
                            {daysUntil(date) < 0 && ' (ended)'}
                          </span>
                        ) : (
                          <span className="text-[var(--agent-app-muted)]">Unknown</span>
                        )}
                      </span>
                      <span className="col-span-2 text-xs leading-relaxed text-[var(--agent-app-muted)] sm:col-span-1 sm:text-[12.5px]">{t?.text ?? ''}</span>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </Section>

          {(work.description !== '' || (work.tags ?? []).length > 0) && (
            <Section title="Description">
              {work.description !== '' && <Prose>{work.description}</Prose>}
              {(work.tags ?? []).length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {(work.tags ?? []).map((t) => (
                    <Tag key={t}>{t}</Tag>
                  ))}
                </div>
              )}
            </Section>
          )}
          {work.notes !== '' && (
            <Section title="Notes">
              <Prose>{work.notes}</Prose>
            </Section>
          )}
        </TabsContent>

        <TabsContent value="registrations">
          <Section
            title="Copyright registrations"
            meta={matters.records.length > 0 ? String(matters.records.length) : undefined}
            flush
            actions={
              can.edit ? (
                <Button size="sm" variant="outline" onClick={() => setAddReg(true)}>
                  <Plus size={13} aria-hidden /> Add registration
                </Button>
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
                tableId="work-registrations"
                rows={matters.records}
                columns={regCols}
                onRowClick={(m) => navigate('matter', m.id)}
                exportName={`${work.title} registrations`}
                empty={
                  <EmptyHint
                    compact
                    icon={Copyright}
                    title="Not registered anywhere yet"
                    message="Copyright exists without registration, but a US registration is needed to sue and, made in time, unlocks statutory damages and fees."
                    action={
                      can.edit ? (
                        <Button size="sm" onClick={() => setAddReg(true)}>
                          <Plus size={13} aria-hidden /> Add registration
                        </Button>
                      ) : undefined
                    }
                  />
                }
              />
            )}
          </Section>
        </TabsContent>

        <TabsContent value="clearance">
          <ClearanceList work={work} />
        </TabsContent>

        <TabsContent value="rights" className="flex flex-col gap-4">
          {basis.basis !== '' && (
            <Notice tone={basis.basis === 'owned' ? 'good' : basis.basis === 'acquired' ? 'info' : 'warn'} icon={Scale}>
              <b>{RIGHTS_BASIS_LABEL[basis.basis]}</b>
              {basis.from !== undefined ? ` (from ${basis.from})` : ''}:{' '}
              {basis.basis === 'owned'
                ? 'everything is available unless an agreement below licenses it out, holds it back or restricts it.'
                : basis.basis === 'acquired'
                  ? 'only what the rights-in grants below give you is available.'
                  : 'some rights are owned and some come from the agreements below. Check availability before licensing.'}
            </Notice>
          )}
          <Section
            title="Rights grants"
            meta={grantRows.length > 0 ? String(grantRows.length) : undefined}
            flush
            actions={
              <Button size="sm" variant="outline" onClick={() => navigate('rights', undefined, { work: work.id })}>
                <Scale size={13} aria-hidden /> Check availability
              </Button>
            }
          >
            {grants.loading && grants.records.length === 0 ? (
              <Loading />
            ) : grants.error !== null && grants.records.length === 0 ? (
              <div className="p-4">
                <ErrorBox message={grants.error} onRetry={grants.refresh} />
              </div>
            ) : grantRows.length === 0 ? (
              <EmptyHint
                compact
                icon={Scale}
                title="No agreement grants rights in this yet"
                message={`Grants in agreements that name this ${vocab.work.toLowerCase()}, a parent ${vocab.work.toLowerCase()} or its ${vocab.property.toLowerCase()} appear here.`}
                action={
                  can.edit ? (
                    <Button size="sm" variant="outline" onClick={() => navigate('agreements')}>
                      Open agreements
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              grantRows.map(({ g, a, via }) => (
                <div key={g.id} className="border-b border-[var(--agent-app-border)]/70 px-4 py-3 last:border-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {a !== undefined ? (
                      <a href={href('agreement', a.id)} className="flex min-w-0 items-center gap-2 hover:underline">
                        <Ref>{a.ref}</Ref>
                        <span className="truncate text-sm font-medium">{a.title}</span>
                      </a>
                    ) : (
                      <span className="text-sm text-[var(--agent-app-muted)]">Agreement not available</span>
                    )}
                    <Pill tone={DIRECTION_TONE[g.direction] ?? 'neutral'}>{DIRECTION_TEXT[g.direction]}</Pill>
                    <Tag>{GRANT_KIND_LABEL[g.kind]}</Tag>
                    <Tag>{g.exclusive ? 'Exclusive' : 'Non-exclusive'}</Tag>
                    {a !== undefined && a.status !== 'active' && a.status !== 'renewed' && <Tag>{AGREEMENT_STATUS_LABEL[a.status] ?? a.status}</Tag>}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--agent-app-muted)]">
                    {enabledDims.map((d) => (
                      <span key={d.id}>
                        {d.label}: <span className="text-[var(--agent-app-text)]/85">{dimSpecLabel(dimValues.filter((v) => v.dimension === d.key), g.dims?.[d.key])}</span>
                      </span>
                    ))}
                    <span>
                      Term:{' '}
                      <span className="text-[var(--agent-app-text)]/85">
                        {termText(g.term_start, g.term_end) || (a !== undefined ? termText(a.term_start, a.term_end, a.perpetual) : '') || 'As the agreement'}
                      </span>
                    </span>
                    {a !== undefined && (a.expand?.['counterparty'] as PartyRec | undefined) !== undefined && (
                      <span>With {(a.expand?.['counterparty'] as PartyRec).name}</span>
                    )}
                  </div>
                  {via !== '' && <p className="mt-1 text-xs text-[var(--agent-app-muted)]">Applies through {via}.</p>}
                  {g.rights_text !== '' && <p className="mt-1 line-clamp-2 text-xs text-[var(--agent-app-text)]/80">{g.rights_text}</p>}
                </div>
              ))
            )}
          </Section>
        </TabsContent>

        <TabsContent value="deadlines">
          <Section
            title="Deadlines"
            meta={openDeadlines > 0 ? `${openDeadlines} open` : undefined}
            flush
            actions={
              <Segmented<'open' | 'all'>
                size="sm"
                ariaLabel="Which deadlines"
                value={dlView}
                onChange={setDlView}
                options={[
                  { value: 'open', label: 'Open' },
                  { value: 'all', label: 'All' },
                ]}
              />
            }
          >
            {deadlines.loading && deadlines.records.length === 0 ? (
              <Loading />
            ) : deadlines.error !== null && deadlines.records.length === 0 ? (
              <div className="p-4">
                <ErrorBox message={deadlines.error} onRetry={deadlines.refresh} />
              </div>
            ) : (
              <DeadlineList
                deadlines={shownDeadlines}
                actions={canEdit ? actions : null}
                subjectLabel={subjectLabel}
                empty={
                  <EmptyHint
                    compact
                    icon={CalendarClock}
                    title={dlView === 'open' ? 'No open deadlines' : 'No deadlines'}
                    message="The US registration reminder after publication and the deadlines of this work's registrations appear here."
                    action={
                      dlView === 'open' && deadlines.records.length > 0 ? (
                        <Button size="sm" variant="outline" onClick={() => setDlView('all')}>
                          Show closed deadlines
                        </Button>
                      ) : undefined
                    }
                  />
                }
              />
            )}
          </Section>
        </TabsContent>

        <TabsContent value="children">
          <Section
            title={`${vocab.works} under this one`}
            meta={childItems.length > 0 ? String(childItems.length) : undefined}
            flush
            actions={
              can.edit ? (
                <Button size="sm" variant="outline" onClick={() => setForm('child')}>
                  <Plus size={13} aria-hidden /> Add child
                </Button>
              ) : undefined
            }
          >
            {all.loading && all.records.length === 0 ? (
              <Loading />
            ) : childItems.length === 0 ? (
              <EmptyHint
                compact
                icon={FilePlus2}
                title={`No child ${vocab.works.toLowerCase()}`}
                message="Build the tree: seasons under a series, episodes under a season, tracks under an album, characters under a film."
                action={
                  can.edit ? (
                    <Button size="sm" onClick={() => setForm('child')}>
                      <Plus size={13} aria-hidden /> Add child
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <TreeTable<WorkRec>
                items={childItems}
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

        <TabsContent value="documents">
          <DocumentsPanel relation="work" relationId={work.id} defaultType="chain_of_title" />
        </TabsContent>
      </Tabs>

      {form === 'edit' && <WorkForm work={work} exclude={[work.id, ...descendants]} onClose={() => setForm(null)} />}
      {form === 'child' && <WorkForm work={null} defaults={childDefaults} onClose={() => setForm(null)} onSaved={(w) => navigate('work', w.id)} />}
      {addReg && <AddRegistrationDialog work={work} onClose={() => setAddReg(false)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Add a copyright registration                                        */
/* ------------------------------------------------------------------ */

function AddRegistrationDialog({ work, onClose }: { work: WorkRec; onClose: () => void }): React.JSX.Element {
  const { settings } = useApp();
  const [jurisdiction, setJurisdiction] = useState(work.publication_country || 'US');
  const [status, setStatus] = useState<'registered' | 'filed'>('registered');
  const [number, setNumber] = useState('');
  const [date, setDate] = useState(today());
  const [claimant, setClaimant] = useState(settings?.org_name ?? '');
  const [errors, setErrors] = useState<{ jurisdiction?: string; date?: string }>({});
  const [busy, setBusy] = useState(false);
  const registered = status === 'registered';

  const submit = async (): Promise<void> => {
    const errs: { jurisdiction?: string; date?: string } = {};
    if (jurisdiction === '') errs.jurisdiction = 'Choose where it was registered.';
    if (d10(date) === '') errs.date = registered ? 'Enter the registration (effective) date.' : 'Enter the filing date.';
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setBusy(true);
    let matter: MatterRec;
    try {
      matter = await createRecord<MatterRec>('matters', {
        ip_type: 'copyright',
        title: work.title,
        work: work.id,
        property: work.property,
        jurisdiction,
        ...(registered ? { registration_no: number.trim() } : { application_no: number.trim() }),
        owner_of_record: claimant.trim(),
        status,
      });
    } catch {
      setBusy(false);
      return;
    }
    try {
      const r = await op<{ created: { id: string }[] }>('matters/record-event', {
        matter_id: matter.id,
        code: registered ? 'REGISTERED' : 'FILED',
        date: d10(date),
      });
      const ref = matter.ref !== '' ? ` ${matter.ref}` : '';
      toast.success(`Registration${ref} added${r.created.length > 0 ? `, ${plural(r.created.length, 'deadline')} created` : ''}`);
      onClose();
    } catch (e) {
      toast.error(`The registration was added, but its ${registered ? 'registration' : 'filing'} date could not be recorded: ${errText(e)}. Record it on the registration page.`);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Add copyright registration"
      description={`Records a copyright registration or application for "${work.title}".`}
      className="w-[min(94vw,34rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={busy}>
            Add registration
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Status">
          <Segmented<'registered' | 'filed'>
            ariaLabel="Status"
            value={status}
            onChange={setStatus}
            options={[
              { value: 'registered', label: 'Registered' },
              { value: 'filed', label: 'Applied, not yet registered' },
            ]}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Jurisdiction" error={errors.jurisdiction}>
            <JurisdictionSelect value={jurisdiction} onChange={setJurisdiction} preferred={settings?.jurisdictions ?? undefined} />
          </Field>
          <DateField
            label={registered ? 'Registration (effective) date' : 'Filing date'}
            value={date}
            onChange={setDate}
            required
            error={errors.date}
          />
        </div>
        <Input
          label={registered ? 'Registration number' : 'Application or case number'}
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          className="font-mono"
          placeholder={registered ? 'For example PA0002345678' : 'For example 1-12345678901'}
        />
        <Input label="Claimant" value={claimant} onChange={(e) => setClaimant(e.target.value)} placeholder="The copyright owner named in the registration" />
      </div>
    </Dialog>
  );
}
