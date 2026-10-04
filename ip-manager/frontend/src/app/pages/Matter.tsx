/**
 * One right in one jurisdiction: header with status, next deadline and the
 * office connection; the family strip; tabs for the official data and key
 * dates, deadlines, goods and services, documents, people, agreements,
 * renewals and history.
 */
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { CalendarPlus, CalendarX2, FolderTree, ListPlus, MoreHorizontal, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Button, Card, CardContent, DropdownMenu, Tabs, TabsContent, TabsList, TabsTrigger, cn, toast, useConfirm, useRecord } from '../../kit/index.ts';
import { useCollection, useLiveAsync } from '../lib/live.ts';
import { OpError, deleteRecord, fileUrl, op, q } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { addMonths, ago, d10, daysUntil, fmtDate, relLabel, today } from '../lib/format.ts';
import { IP_TYPE_LABEL, RELATION_LABEL, ROUTE_LABEL, STATUS_LABEL, jurisdictionName, statusTone } from '../lib/labels.ts';
import { href, navigate, useHashParam } from '../lib/router.ts';
import type { DeadlineRec, FamilyRec, GoodsServicesRec, MatterRec, WorkRec } from '../lib/types.ts';
import { Timeline } from '../components/charts.tsx';
import type { TimelineMarker, TimelineSegment } from '../components/charts.tsx';
import { DeadlineList, useDeadlineActions } from '../components/deadlines.tsx';
import { DocumentsPanel } from '../components/documents.tsx';
import { EventDialog, RegenerateDialog } from '../components/events.tsx';
import {
  AddDeadlineDialog,
  GoodsServicesEditor,
  MatterEditDialog,
  NationalPhaseDialog,
  NewMatterDialog,
  childRelationsFor,
} from '../components/matterDialogs.tsx';
import type { NewMatterDefaults } from '../components/matterDialogs.tsx';
import {
  ENTITY_SIZE_LABEL,
  FAMILY_KIND_LABEL,
  NICE_HEADING,
  TM_BASIS_LABEL,
  TM_REGISTER_LABEL,
  MatterChip,
  classesOf,
  htmlToText,
  isPatentLike,
  portfolioPageOf,
  routeText,
} from '../components/matterShared.tsx';
import { MatterAgreementsTab, MatterHistoryTab, MatterPeopleTab, MatterRenewalsTab } from '../components/matterTabs.tsx';
import { Dot, EmptyHint, ErrorBox, Fact, FactGrid, IdentityChip, JurChip, Loading, Pill, Prose, Ref, Section, Tag } from '../components/ui.tsx';

interface MatterInfo {
  expiry: { date: string; text: string };
  sync: { source: string; label: string; connected: boolean };
}

type SyncResult =
  | { unchanged: true }
  | { inbox_item: string; diffs: number; events: number }
  | { duplicate: true }
  | { not_found: true }
  | { skipped: true; reason: string };

/** Open US declaration of use or renewal deadlines (rule codes from the seed rules). */
const US_USE_RULES = new Set(['US-TM-SEC8', 'US-TM-SEC71', 'US-TM-RENEWAL']);

export function MatterPage({ id }: { id: string }): React.JSX.Element {
  const { record, loading, error } = useRecord<MatterRec>('matters', id === '' ? null : id);
  if (id === '') {
    return (
      <Card>
        <EmptyHint icon={FolderTree} title="No record chosen" message="Open a patent, trademark, design or copyright from its list." action={<Button onClick={() => navigate('patents')}>Open patents</Button>} />
      </Card>
    );
  }
  if (loading && record === null) return <Loading label="Loading the record" />;
  if (record === null) {
    return (
      <Card>
        <EmptyHint
          icon={CalendarX2}
          title="This record is not available"
          message={error !== null ? 'It may have been deleted, or you may not have access to it.' : 'It may have been deleted.'}
          action={<Button onClick={() => navigate('patents')}>Back to the portfolio</Button>}
        />
      </Card>
    );
  }
  return <MatterView m={record} />;
}

type Dlg = 'event' | 'edit' | 'deadline' | 'country' | 'newcountry' | null;

function MatterView({ m }: { m: MatterRec }): React.JSX.Element {
  const { can, vocab, propertyName, userName } = useApp();
  const [tabParam, setTab] = useHashParam('tab', 'overview');
  const [dlg, setDlg] = useState<Dlg>(null);
  const [regen, setRegen] = useState(false);
  const [confirmEl, confirm] = useConfirm();
  const { actions, dialogs } = useDeadlineActions();

  const members = useCollection<MatterRec>('matters', { filter: m.family !== '' ? `family = ${q(m.family)}` : 'id = "__none__"', sort: 'ref' });
  const family = useRecord<FamilyRec>('families', m.family !== '' ? m.family : null).record;
  const parent = useRecord<MatterRec>('matters', m.parent !== '' ? m.parent : null).record;
  const work = useRecord<WorkRec>('works', m.work !== '' ? m.work : null).record;
  const deadlines = useCollection<DeadlineRec>('deadlines', { filter: `matter = ${q(m.id)}`, sort: 'due_date' });
  const goods = useCollection<GoodsServicesRec>('goods_services', {
    filter: m.ip_type === 'trademark' ? `matter = ${q(m.id)}` : 'id = "__none__"',
    sort: 'nice_class',
  });
  const info = useLiveAsync(() => op<MatterInfo>('matters/info', { matter_id: m.id }), [m.id, m.updated], ['office_connections', 'goods_services', 'events']);

  const tm = m.ip_type === 'trademark';
  const dead = m.status_group === 'dead';
  const tab = tabParam === 'goods' && !tm ? 'overview' : tabParam;
  const open = deadlines.records.filter((d) => d.status === 'open');
  const next = open[0];
  const declarationDue = tm ? (open.find((d) => US_USE_RULES.has(d.rule_code)) ?? null) : null;
  const familyList = m.family !== '' && members.records.length > 0 ? members.records : [m];
  const children = members.records.filter((x) => x.parent === m.id);
  const liveClasses = classesOf(goods.records.filter((g) => g.class_status !== 'deleted' && g.class_status !== 'cancelled'));

  const addCountry = (): void => {
    if (childRelationsFor(m).length > 0) setDlg('country');
    else setDlg('newcountry');
  };

  const newCountryDefaults = useMemo((): NewMatterDefaults => {
    const filing = d10(m.filing_date);
    const months = isPatentLike(m.ip_type) ? 12 : 6;
    const inPriority = filing !== '' && m.application_no !== '' && addMonths(filing, months) >= today();
    return {
      title: m.title,
      property: m.property,
      family: m.family,
      work: m.work,
      relation: inPriority ? 'priority' : 'related',
      parent: m.id,
      priority_claims: inPriority ? [{ country: m.jurisdiction, number: m.application_no, date: filing }] : [],
    };
  }, [m]);

  const remove = async (): Promise<void> => {
    const ok = await confirm(
      `Delete ${m.ref} (${m.title})? Its deadlines, events, classes and renewals are deleted with it and cannot be restored. Documents stay in the system. To record that the right ended, use Record what happened instead.`,
      `Delete ${m.ref}`,
    );
    if (!ok) return;
    try {
      await deleteRecord('matters', m.id);
      toast.success(`${m.ref} deleted`);
      navigate(portfolioPageOf(m.ip_type));
    } catch {
      /* the client already showed the error */
    }
  };

  const menuItems = [
    ...(can.edit ? [{ label: 'Add deadline', icon: <ListPlus size={14} />, onSelect: () => setDlg('deadline') }] : []),
    ...(m.family !== '' ? [{ label: `Open ${family !== null ? FAMILY_KIND_LABEL[family.kind].toLowerCase() : 'family'}`, icon: <FolderTree size={14} />, onSelect: () => navigate('family', m.family) }] : []),
    ...(can.manage ? [{ label: 'Delete', icon: <Trash2 size={14} />, danger: true, onSelect: () => void remove() }] : []),
  ];

  const openCount = open.length;

  return (
    <div>
      {confirmEl}
      {dialogs}

      {/* Header */}
      <Card className="mb-3">
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 flex-1 basis-72 gap-4">
              {tm && family !== null && family.mark_image !== '' && (
                <span className="hidden size-16 shrink-0 items-center justify-center overflow-hidden border border-[var(--agent-app-border)] bg-[var(--agent-app-bg)] sm:flex">
                  <img src={fileUrl(family, family.mark_image, '100x100')} alt={family.title} className="max-h-full max-w-full object-contain" />
                </span>
              )}
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-[13px]">
                  <Ref dead={dead} className="text-[13px]">
                    {m.ref}
                  </Ref>
                  <JurChip code={m.jurisdiction} />
                  <span className="text-[var(--agent-app-muted)]">{jurisdictionName(m.jurisdiction)}</span>
                  <Tag>{IP_TYPE_LABEL[m.ip_type]}</Tag>
                  {routeText(m) !== '' && (
                    <span className="text-xs text-[var(--agent-app-muted)]">
                      {routeText(m)}
                      {parent !== null && (
                        <>
                          {' of '}
                          <a href={href('matter', parent.id)} className="font-mono text-[var(--agent-app-text)]/80 hover:underline">
                            {parent.ref}
                          </a>
                        </>
                      )}
                    </span>
                  )}
                </div>
                <h1 className={cn('mt-1.5 text-xl font-semibold tracking-tight', dead && 'text-[var(--agent-app-muted)]')}>{m.title}</h1>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <Pill tone={statusTone(m.status, m.status_group)}>{STATUS_LABEL[m.status]}</Pill>
                  {d10(m.status_date) !== '' && <span className="text-xs tabular-nums text-[var(--agent-app-muted)]">since {fmtDate(m.status_date)}</span>}
                  {m.office_status !== '' && (
                    <span className="text-xs text-[var(--agent-app-muted)]" title="As the office words it">
                      Office: {m.office_status}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {can.edit && (
                <Button onClick={() => setDlg('event')}>
                  <CalendarPlus size={14} aria-hidden /> Record what happened
                </Button>
              )}
              {can.edit && (
                <Button variant="outline" onClick={() => setDlg('edit')}>
                  <Pencil size={14} aria-hidden /> Edit
                </Button>
              )}
              {menuItems.length > 0 && (
                <DropdownMenu
                  align="right"
                  trigger={
                    <Button variant="outline" size="icon" aria-label="More actions">
                      <MoreHorizontal size={16} />
                    </Button>
                  }
                  items={menuItems}
                />
              )}
            </div>
          </div>

          <div className="mt-4 grid gap-4 border-t border-[var(--agent-app-border)] pt-3 sm:grid-cols-3">
            <HeaderCell label="Next deadline">
              {next !== undefined ? (
                <button type="button" className="block w-full min-w-0 text-left hover:underline" onClick={() => navigate('deadlines', next.id)}>
                  <span className="block truncate text-[13px] font-medium" title={next.title}>
                    {next.title}
                  </span>
                  <span className={cn('text-xs tabular-nums', daysUntil(next.due_date) < 0 ? 'text-red-700 dark:text-red-400' : 'text-[var(--agent-app-muted)]')}>
                    {fmtDate(next.due_date)}, {relLabel(next.due_date)}
                  </span>
                </button>
              ) : (
                <span className="text-[13px] text-[var(--agent-app-muted)]">{deadlines.loading ? 'Loading' : 'No open deadlines'}</span>
              )}
            </HeaderCell>
            <HeaderCell label="Office data">
              <SyncBox m={m} info={info.data} />
            </HeaderCell>
            <HeaderCell label="Responsible">
              {m.responsible !== '' ? (
                <span className="flex items-center gap-2 text-[13px]">
                  <IdentityChip name={userName(m.responsible)} size="sm" />
                  {userName(m.responsible)}
                  {m.docketer !== '' && m.docketer !== m.responsible && (
                    <span className="truncate text-xs text-[var(--agent-app-muted)]">docketing: {userName(m.docketer)}</span>
                  )}
                </span>
              ) : (
                <span className="text-[13px] text-[var(--agent-app-muted)]">Nobody{can.edit ? ' (set it with Edit)' : ''}</span>
              )}
            </HeaderCell>
          </div>
        </CardContent>
      </Card>

      {/* Family strip */}
      <div className="mb-5 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">
          {family !== null ? (
            <a href={href('family', family.id)} className="hover:text-[var(--agent-app-text)] hover:underline">
              {FAMILY_KIND_LABEL[family.kind]}: {family.title}
            </a>
          ) : (
            'Filings'
          )}
        </span>
        {familyList.map((x) => (
          <MatterChip key={x.id} m={x} current={x.id === m.id} />
        ))}
        {can.edit && (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={addCountry}>
            <Plus size={13} aria-hidden /> Add country
          </Button>
        )}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <div className="max-w-full overflow-x-auto">
          <TabsList className="whitespace-nowrap">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="deadlines">
              Deadlines{openCount > 0 && <span className="ml-1.5 tabular-nums text-[var(--agent-app-muted)]">{openCount}</span>}
            </TabsTrigger>
            {tm && <TabsTrigger value="goods">Goods and services</TabsTrigger>}
            <TabsTrigger value="documents">Documents</TabsTrigger>
            <TabsTrigger value="people">People</TabsTrigger>
            <TabsTrigger value="agreements">Agreements</TabsTrigger>
            <TabsTrigger value="renewals">Renewals</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview">
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
              <Section title="Official data">
                <OfficialFacts m={m} family={family} classes={liveClasses} info={info.data} />
              </Section>
              <Section title="Key dates">
                <KeyDates m={m} open={open} />
              </Section>
              {m.abstract !== '' && (
                <Section title="Abstract">
                  <Prose>{m.abstract}</Prose>
                </Section>
              )}
              <Section title="Notes">
                {htmlToText(m.notes) !== '' ? (
                  <Prose>{htmlToText(m.notes)}</Prose>
                ) : (
                  <p className="text-[13px] text-[var(--agent-app-muted)]">No notes{can.edit ? '. Add them with Edit.' : '.'}</p>
                )}
              </Section>
            </div>
            <div className="flex min-w-0 flex-col gap-4">
              <Section title="Links">
                <FactGrid cols={2}>
                  <Fact
                    label={vocab.property}
                    className="col-span-2"
                    value={m.property !== '' ? <a href={href('property', m.property)} className="hover:underline">{propertyName(m.property) || 'Open'}</a> : ''}
                  />
                  {family !== null && (
                    <Fact
                      label={FAMILY_KIND_LABEL[family.kind]}
                      className="col-span-2"
                      value={
                        <a href={href('family', family.id)} className="hover:underline">
                          {family.title}
                        </a>
                      }
                    />
                  )}
                  {m.ip_type === 'copyright' && (
                    <Fact
                      label={vocab.work}
                      className="col-span-2"
                      value={work !== null ? <a href={href('work', work.id)} className="hover:underline">{work.title}</a> : ''}
                    />
                  )}
                  {parent !== null && (
                    <Fact
                      label={RELATION_LABEL[m.relation] ?? 'Parent'}
                      className="col-span-2"
                      value={
                        <a href={href('matter', parent.id)} className="hover:underline">
                          <Ref>{parent.ref}</Ref> <span className="text-[var(--agent-app-muted)]">{parent.title}</span>
                        </a>
                      }
                    />
                  )}
                  {children.length > 0 && (
                    <div className="col-span-2">
                      <div className="text-[11px] text-[var(--agent-app-muted)]">Filings based on this one</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {children.map((c) => (
                          <MatterChip key={c.id} m={c} />
                        ))}
                      </div>
                    </div>
                  )}
                </FactGrid>
              </Section>
              <Section title="Details">
                <FactGrid cols={2}>
                  <Fact label="Route" value={ROUTE_LABEL[m.route] ?? m.route} />
                  <Fact label="Relation" value={RELATION_LABEL[m.relation] ?? m.relation} />
                  <Fact label="Counsel" value={m.counsel} />
                  <Fact label="Client reference" value={m.client_ref} mono />
                  <Fact label="Cost center" value={m.cost_center} />
                  {isPatentLike(m.ip_type) && m.jurisdiction === 'US' && <Fact label="Entity size" value={ENTITY_SIZE_LABEL[m.entity_size] ?? ''} />}
                  {tm && m.jurisdiction === 'US' && <Fact label="Filing basis" value={TM_BASIS_LABEL[m.tm_basis] ?? m.tm_basis} />}
                  {tm && m.jurisdiction === 'US' && <Fact label="Register" value={TM_REGISTER_LABEL[m.tm_register] ?? ''} />}
                  {tm && m.jurisdiction === 'JP' && <Fact label="Registration fee" value={m.options?.['jp_split_fee'] === true ? 'Two 5-year halves' : 'Full 10 years'} />}
                  {isPatentLike(m.ip_type) && m.claims_count > 0 && (
                    <Fact label="Claims" value={`${m.claims_count}${m.independent_claims > 0 ? ` (${m.independent_claims} independent)` : ''}`} />
                  )}
                  <Fact label="Docketer" value={userName(m.docketer)} />
                  <Fact label="Added" value={fmtDate(m.created)} />
                </FactGrid>
              </Section>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="deadlines">
          <Section
            title="Deadlines"
            meta={deadlines.records.length > 0 ? `${openCount} open, ${deadlines.records.length - openCount} closed` : undefined}
            flush
            actions={
              can.edit ? (
                <>
                  <Button size="sm" variant="outline" onClick={() => setDlg('deadline')}>
                    <ListPlus size={13} aria-hidden /> Add deadline
                  </Button>
                  <Button size="sm" onClick={() => setDlg('event')}>
                    <CalendarPlus size={13} aria-hidden /> Record what happened
                  </Button>
                </>
              ) : undefined
            }
          >
            {deadlines.loading && deadlines.records.length === 0 ? (
              <Loading />
            ) : deadlines.error !== null ? (
              <div className="p-4">
                <ErrorBox message={deadlines.error} onRetry={deadlines.refresh} />
              </div>
            ) : (
              <DeadlineList
                deadlines={deadlines.records}
                actions={can.edit ? actions : null}
                empty={
                  <EmptyHint
                    compact
                    icon={CalendarPlus}
                    title="No deadlines"
                    message="Record what happened (filed, office action, granted) and the rules create the deadlines that follow."
                    action={
                      can.edit ? (
                        <Button size="sm" onClick={() => setDlg('event')}>
                          Record what happened
                        </Button>
                      ) : undefined
                    }
                  />
                }
              />
            )}
          </Section>
        </TabsContent>

        {tm && (
          <TabsContent value="goods">
            <GoodsServicesEditor matter={m} declarationDue={declarationDue} />
          </TabsContent>
        )}

        <TabsContent value="documents">
          <DocumentsPanel relation="matter" relationId={m.id} docketing matterId={m.id} />
        </TabsContent>

        <TabsContent value="people">
          <MatterPeopleTab matter={m} />
        </TabsContent>

        <TabsContent value="agreements">
          <MatterAgreementsTab matter={m} />
        </TabsContent>

        <TabsContent value="renewals">
          <MatterRenewalsTab matter={m} />
        </TabsContent>

        <TabsContent value="history">
          <MatterHistoryTab matter={m} />
        </TabsContent>
      </Tabs>

      {dlg === 'event' && <EventDialog subjectId={m.id} ipType={m.ip_type} jurisdiction={m.jurisdiction} onClose={() => setDlg(null)} onDone={() => undefined} />}
      {dlg === 'edit' && (
        <MatterEditDialog
          matter={m}
          expiryText={info.data?.expiry.text}
          onClose={() => setDlg(null)}
          onSaved={(baseChanged) => {
            if (baseChanged) setRegen(true);
          }}
        />
      )}
      {dlg === 'deadline' && <AddDeadlineDialog matter={m} onClose={() => setDlg(null)} />}
      {dlg === 'country' && <NationalPhaseDialog matter={m} familyMembers={members.records} onClose={() => setDlg(null)} />}
      {dlg === 'newcountry' && (
        <NewMatterDialog
          ipType={m.ip_type}
          heading={`Add a country to ${family !== null ? family.title : m.ref}`}
          defaults={newCountryDefaults}
          initialPath="blank"
          onClose={() => setDlg(null)}
        />
      )}
      {regen && <RegenerateDialog subjectId={m.id} onClose={() => setRegen(false)} onDone={() => undefined} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Header pieces                                                       */
/* ------------------------------------------------------------------ */

function HeaderCell({ label, children }: { label: string; children: ReactNode }): React.JSX.Element {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">{label}</div>
      {children}
    </div>
  );
}

function SyncBox({ m, info }: { m: MatterRec; info: MatterInfo | null }): React.JSX.Element {
  const { can } = useApp();
  const [busy, setBusy] = useState(false);
  const [inboxId, setInboxId] = useState('');

  if (info === null) return <span className="text-[13px] text-[var(--agent-app-muted)]">Checking</span>;
  if (info.sync.source === '') {
    return <span className="text-[13px] text-[var(--agent-app-muted)]">No office data feed for {m.jurisdiction} {IP_TYPE_LABEL[m.ip_type].toLowerCase()}s. Keep it up to date by hand.</span>;
  }
  if (!info.sync.connected) {
    return (
      <span className="text-[13px]">
        <span className="flex items-center gap-1.5">
          <Dot tone="neutral" /> {info.sync.label}: not connected
        </span>
        {can.admin ? (
          <a href={href('settings', undefined, { tab: 'offices' })} className="text-xs font-medium text-[var(--agent-app-accent)] hover:underline">
            Connect it in Settings
          </a>
        ) : (
          <span className="text-xs text-[var(--agent-app-muted)]">An admin can connect it in Settings.</span>
        )}
      </span>
    );
  }

  const check = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await op<SyncResult>('matters/sync', { matter_id: m.id });
      if ('inbox_item' in r) {
        setInboxId(r.inbox_item);
        toast.success('Changes filed in the Inbox for review');
      } else if ('unchanged' in r) {
        toast.info('No changes at the office');
      } else if ('duplicate' in r) {
        toast.info('These changes are already waiting in the Inbox');
      } else if ('not_found' in r) {
        toast.error(`${info.sync.label} has no record for this number`);
      } else {
        toast.info(r.reason);
      }
    } catch (err) {
      toast.error(err instanceof OpError ? `${info.sync.label}: ${err.message}` : String(err));
    } finally {
      setBusy(false);
    }
  };

  const state = m.sync_state;
  const tone = state === 'error' ? 'bad' : state === 'not_found' ? 'warn' : state === 'connected' ? 'good' : 'neutral';
  const stateText =
    state === 'error'
      ? `Last check failed${m.sync_error !== '' ? `: ${m.sync_error}` : ''}`
      : state === 'not_found'
        ? 'The office has no record for this number'
        : d10(m.last_synced) !== ''
          ? `Checked ${ago(m.last_synced)}`
          : 'Not checked yet';

  return (
    <div className="flex flex-col gap-1 text-[13px]">
      <span className="flex min-w-0 items-center gap-1.5" title={stateText}>
        <Dot tone={tone} />
        <span className="truncate">
          {info.sync.label}
          <span className="text-[var(--agent-app-muted)]">: {stateText}</span>
        </span>
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {can.edit && (
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" loading={busy} onClick={() => void check()}>
            <RefreshCw size={12} aria-hidden /> Check with office now
          </Button>
        )}
        {inboxId !== '' && (
          <a href={href('inbox', inboxId)} className="text-xs font-medium text-[var(--agent-app-accent)] hover:underline">
            Review in the Inbox
          </a>
        )}
        {!m.sync_enabled && <span className="text-xs text-[var(--agent-app-muted)]">Automatic checks off</span>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Overview pieces                                                     */
/* ------------------------------------------------------------------ */

function priorityText(m: MatterRec): ReactNode {
  const claims = m.priority_claims ?? [];
  if (claims.length === 0) return '';
  return (
    <span className="flex flex-col gap-0.5 whitespace-normal">
      {claims.map((p, i) => (
        <span key={`${p.country}-${p.number}-${i}`} className="flex flex-wrap items-center gap-1.5">
          <JurChip code={p.country} />
          <span className="font-mono text-[12.5px]">{p.number}</span>
          {d10(p.date) !== '' && <span className="text-xs text-[var(--agent-app-muted)]">{fmtDate(p.date)}</span>}
        </span>
      ))}
    </span>
  );
}

function MarkBox({ family, fallback }: { family: FamilyRec | null; fallback: string }): React.JSX.Element {
  if (family !== null && family.mark_image !== '') {
    return (
      <span className="inline-flex h-20 max-w-full items-center justify-center border border-[var(--agent-app-border)] bg-[var(--agent-app-bg)] p-1.5">
        <img src={fileUrl(family, family.mark_image, '400x0')} alt={family.title} className="max-h-full max-w-full object-contain" />
      </span>
    );
  }
  const word = family?.word_element || fallback;
  return <span className="inline-block border border-[var(--agent-app-border)] px-3 py-1.5 text-base font-semibold tracking-wide">{word}</span>;
}

function OfficialFacts({ m, family, classes, info }: { m: MatterRec; family: FamilyRec | null; classes: number[]; info: MatterInfo | null }): React.JSX.Element {
  const expiry = d10(m.expiry_date) !== '' ? `${fmtDate(m.expiry_date)}${m.expiry_override ? ' (set by hand)' : ''}` : '';
  const expiryHelp = m.expiry_override ? 'Entered by hand; not recalculated.' : (info?.expiry.text ?? '');
  const t = m.ip_type;

  let facts: ReactNode;
  if (t === 'trademark') {
    facts = (
      <>
        <Fact label="Application number" inid="210" value={m.application_no} mono />
        <Fact label="Filing date" inid="220" value={fmtDate(m.filing_date)} />
        <Fact label="Publication date" inid="450" value={fmtDate(m.publication_date)} />
        <Fact label="Registration number" inid="111" value={m.registration_no} mono />
        <Fact label="Registration date" inid="151" value={fmtDate(m.registration_date)} />
        <Fact label="Expiry" inid="180" value={expiry} />
        <Fact
          label="Nice classes"
          inid="511"
          value={
            classes.length > 0 ? (
              <span className="font-mono tabular-nums" title={classes.map((c) => `${c}: ${NICE_HEADING[c] ?? ''}`).join('\n')}>
                {classes.join(', ')}
              </span>
            ) : (
              ''
            )
          }
        />
        <Fact label="Owner" inid="732" value={m.owner_of_record} />
        <Fact label="Priority" inid="300" value={priorityText(m)} />
        <Fact label="Mark" inid="540" className="col-span-2 lg:col-span-3" value={<MarkBox family={family} fallback={m.title} />} />
      </>
    );
  } else if (t === 'design') {
    facts = (
      <>
        <Fact label="Application number" inid="21" value={m.application_no} mono />
        <Fact label="Filing date" inid="22" value={fmtDate(m.filing_date)} />
        <Fact label="Registration number" inid="11" value={m.registration_no} mono />
        <Fact label="Registration date" inid="15" value={fmtDate(m.registration_date)} />
        <Fact label="Publication date" inid="45" value={fmtDate(m.publication_date)} />
        <Fact label="Expiry" inid="18" value={expiry} />
        <Fact label="Owner" inid="73" value={m.owner_of_record} />
        <Fact label="Applicants" value={m.applicants} />
        <Fact label="Priority" inid="30" value={priorityText(m)} />
      </>
    );
  } else if (t === 'copyright' || t === 'domain') {
    facts = (
      <>
        <Fact label="Application number" value={m.application_no} mono />
        <Fact label="Filing date" value={fmtDate(m.filing_date)} />
        <Fact label="Registration number" value={m.registration_no} mono />
        <Fact label="Registration date" value={fmtDate(m.registration_date)} />
        <Fact label="Term ends" value={expiry} />
        <Fact label="Owner of record" value={m.owner_of_record} />
      </>
    );
  } else {
    facts = (
      <>
        <Fact label="Application number" inid="21" value={m.application_no} mono />
        <Fact label="Filing date" inid="22" value={fmtDate(m.filing_date)} />
        <Fact label="Publication number" inid="11" value={m.publication_no} mono />
        <Fact label="Publication date" inid="43" value={fmtDate(m.publication_date)} />
        <Fact label="Patent number" inid="11" value={m.registration_no} mono />
        <Fact label="Grant date" inid="45" value={fmtDate(m.registration_date)} />
        <Fact label="Expiry" value={expiry} />
        <Fact label="Owner of record" inid="73" value={m.owner_of_record} />
        <Fact label="Applicants" inid="71" value={m.applicants} />
        <Fact label="Priority" inid="30" className="col-span-2 lg:col-span-1" value={priorityText(m)} />
        {m.jurisdiction === 'US' && m.pta_days > 0 && <Fact label="Patent term adjustment" value={`${m.pta_days} days`} />}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <FactGrid cols={3}>{facts}</FactGrid>
      {expiryHelp !== '' && (
        <p className="border-t border-[var(--agent-app-border)] pt-3 text-xs leading-relaxed text-[var(--agent-app-muted)]">
          <span className="font-medium text-[var(--agent-app-text)]/80">How the term is worked out: </span>
          {expiryHelp}
        </p>
      )}
    </div>
  );
}

function KeyDates({ m, open }: { m: MatterRec; open: DeadlineRec[] }): React.JSX.Element {
  const filing = d10(m.filing_date);
  const reg = d10(m.registration_date);
  const exp = d10(m.expiry_date);
  const now = today();
  const dead = m.status_group === 'dead';
  const deadEnd = d10(m.status_date) !== '' ? d10(m.status_date) : now;

  const segments: TimelineSegment[] = [];
  if (filing !== '') {
    const end = reg !== '' ? reg : dead ? deadEnd : now;
    if (end >= filing) segments.push({ start: filing, end, label: 'Pending', className: 'bg-sky-500/25 text-sky-800 dark:text-sky-300', title: `Pending: ${fmtDate(filing)} to ${reg !== '' ? fmtDate(reg) : dead ? fmtDate(end) : 'today'}` });
  }
  if (reg !== '') {
    const end = dead ? (exp !== '' && exp < deadEnd ? exp : deadEnd) : exp !== '' ? exp : now;
    if (end >= reg) {
      segments.push({
        start: reg,
        end,
        label: dead ? 'Ended' : 'In force',
        className: dead ? 'bg-[var(--agent-app-border)] text-[var(--agent-app-muted)]' : 'bg-emerald-500/25 text-emerald-800 dark:text-emerald-300',
        title: `${dead ? 'Was in force' : 'In force'}: ${fmtDate(reg)} to ${fmtDate(end)}`,
      });
    }
  }
  const markers: TimelineMarker[] = [
    ...(m.priority_claims ?? [])
      .filter((p) => d10(p.date) !== '')
      .map((p) => ({ date: d10(p.date), label: `Priority ${p.country} ${p.number}`, className: 'bg-[var(--agent-app-muted)]' })),
    ...open.map((d) => ({ date: d10(d.due_date), label: d.title, className: 'bg-amber-500' })),
    { date: now, label: 'Today', className: 'bg-[var(--agent-app-accent)]' },
  ];

  if (filing === '' && reg === '') {
    return (
      <EmptyHint
        compact
        icon={CalendarPlus}
        title="No dates yet"
        message="Once the filing date is recorded, this shows the pending and in-force periods with the open deadlines."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Timeline
        rows={[
          {
            key: m.id,
            label: (
              <span className="flex items-center gap-1.5">
                <JurChip code={m.jurisdiction} />
                <Ref dead={dead}>{m.ref}</Ref>
              </span>
            ),
            segments,
            markers,
          },
        ]}
      />
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--agent-app-muted)]">
        <Legend className="bg-sky-500/25" label="Pending" />
        <Legend className="bg-emerald-500/25" label="In force" />
        <Legend className="rotate-45 bg-amber-500" label={`Open deadline${open.length === 1 ? '' : 's'} (${open.length})`} small />
        {(m.priority_claims ?? []).length > 0 && <Legend className="rotate-45 bg-[var(--agent-app-muted)]" label="Priority date" small />}
        <Legend className="rotate-45 bg-[var(--agent-app-accent)]" label="Today" small />
      </div>
      <div className="grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-3">
        <KeyDate label="Filed" v={filing} />
        <KeyDate label={isPatentLike(m.ip_type) ? 'Granted' : 'Registered'} v={reg} />
        <KeyDate label={m.ip_type === 'copyright' ? 'Term ends' : 'Expires'} v={exp} />
      </div>
    </div>
  );
}

function KeyDate({ label, v }: { label: string; v: string }): React.JSX.Element {
  return (
    <div>
      <span className="text-[var(--agent-app-muted)]">{label}: </span>
      {v !== '' ? (
        <span className="tabular-nums">
          {fmtDate(v)} <span className="text-xs text-[var(--agent-app-muted)]">({v > today() ? relLabel(v) : sinceLabel(v)})</span>
        </span>
      ) : (
        <span className="text-[var(--agent-app-muted)]">not yet</span>
      )}
    </div>
  );
}

/** "3 years ago" for a past calendar day. */
function sinceLabel(v: string): string {
  const n = -daysUntil(v);
  if (n <= 0) return 'today';
  if (n === 1) return 'yesterday';
  if (n < 60) return `${n} days ago`;
  if (n < 730) return `${Math.round(n / 30.4)} months ago`;
  return `${Math.round(n / 365)} years ago`;
}

function Legend({ className, label, small = false }: { className: string; label: string; small?: boolean | undefined }): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('inline-block', small ? 'size-2' : 'h-2.5 w-4', className)} aria-hidden />
      {label}
    </span>
  );
}
