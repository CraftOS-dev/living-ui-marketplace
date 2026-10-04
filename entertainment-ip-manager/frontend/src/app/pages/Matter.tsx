/**
 * One trademark or design in one office: header with the numbers, status,
 * owner and what it protects; record what happened, check with the office,
 * file in more offices, edit. Tabs for the dates (with how the expiry is
 * worked out and the leak check), goods and services, deadlines, renewals,
 * the family, documents and history.
 */
import { useMemo, useState } from 'react';
import { CalendarPlus, GitBranchPlus, Pencil, RefreshCw } from 'lucide-react';
import { Button, Card, CardContent, Tabs, TabsContent, TabsList, TabsTrigger, cn, toast, useRecord } from '../../kit/index.ts';
import { useCollection, useLiveAsync } from '../lib/live.ts';
import { op, q } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { ago, d10, daysUntil, fmtDate, fmtDateTime, relLabel } from '../lib/format.ts';
import { bi, enumLabel, t, tf } from '../lib/i18n.ts';
import { jurisdictionName } from '../lib/labels.ts';
import { href, navigate, useHashParam } from '../lib/router.ts';
import type { DeadlineRec, FamilyRec, GoodsServiceRec, MatterRec } from '../lib/records.ts';
import type { Bi } from '../lib/shapes.ts';
import { DeadlineList, useDeadlineActions } from '../components/deadlines.tsx';
import { DeleteButton } from '../components/deleteRecord.tsx';
import { DocumentsPanel } from '../components/documents.tsx';
import { EventDialog, RegenerateDialog } from '../components/events.tsx';
import { Dot, EmptyHint, ErrorBox, Fact, FactGrid, IdentityChip, JurChip, Loading, Notice, Prose, Ref, Section, TONE_TEXT, Tag } from '../components/ui.tsx';
import { GoodsPanel } from '../components/protectGoods.tsx';
import { DesignateDialog, LeakNotice, MatterEditDialog, useLeakCheck } from '../components/protectMatterForms.tsx';
import { RenewalList } from '../components/protectRenewals.tsx';
import { DateCell, EventHistory, HeaderCell, MarkBox, MatterChip, MatterStatus, NextDeadlineCell, RecordMissing, SubjectLinks, classLabel } from '../components/protectShared.tsx';

interface MatterInfo {
  expiry: { date: string; text: Bi };
  sync: { source: string; label: string; connected: boolean };
}

type SyncResult =
  | { unchanged: true }
  | { inbox_item: string; diffs: number; events: number }
  | { duplicate: true }
  | { not_found: true }
  | { skipped: true; reason: string };

export function MatterPage({ id }: { id: string }): React.JSX.Element {
  const { record, loading } = useRecord<MatterRec>('matters', id === '' ? null : id);
  if (id === '') {
    return <RecordMissing title={t('No trademark or design chosen')} message={t('Open one from the register.')} back={href('trademarks')} backLabel={t('Open the register')} />;
  }
  if (loading && record === null) return <Loading />;
  if (record === null) {
    return <RecordMissing title={t('This record is not available')} message={t('It may have been deleted, or you may not have access to it.')} back={href('trademarks')} backLabel={t('Open the register')} />;
  }
  return <MatterView m={record} />;
}

type Dlg = 'event' | 'edit' | 'designate' | null;

function MatterView({ m }: { m: MatterRec }): React.JSX.Element {
  const { can, userName } = useApp();
  const [tabParam, setTab] = useHashParam('tab', 'overview');
  const [dlg, setDlg] = useState<Dlg>(null);
  const [regen, setRegen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [inboxId, setInboxId] = useState('');
  const dl = useDeadlineActions();

  const family = useRecord<FamilyRec>('families', m.family !== '' ? m.family : null).record;
  const parent = useRecord<MatterRec>('matters', m.parent !== '' ? m.parent : null).record;
  const members = useCollection<MatterRec>('matters', { filter: m.family !== '' ? `family = ${q(m.family)}` : `id = ${q(m.id)}`, sort: 'jurisdiction,ref' });
  const children = useCollection<MatterRec>('matters', { filter: `parent = ${q(m.id)}`, sort: 'jurisdiction,ref' });
  const deadlines = useCollection<DeadlineRec>('deadlines', { filter: `matter = ${q(m.id)}`, sort: 'due_date' });
  const tm = m.ip_type === 'trademark';
  const goods = useCollection<GoodsServiceRec>('goods_services', { filter: `matter = ${q(m.id)}`, sort: 'nice_class' });
  const info = useLiveAsync(() => op<MatterInfo>('matters/info', { matter_id: m.id }), [m.id, m.updated], ['office_connections', 'events', 'renewals']);
  const announce = d10(m.announcement_date) || d10(family?.announcement_date ?? '');
  const leak = useLeakCheck(m.filing_date, announce, m.jurisdiction);

  const tab = tabParam === 'goods' && !tm ? 'overview' : tabParam;
  const open = deadlines.records.filter((d) => d.status === 'open');
  const classes = useMemo(
    () => [...new Set(goods.records.filter((g) => g.class_status !== 'deleted' && g.class_status !== 'cancelled').map((g) => g.nice_class))].sort((a, b) => a - b),
    [goods.records],
  );
  const dead = m.status_group === 'dead';
  // The term as the office rules give it today (renewals recorded since the last save included).
  const expiry = !m.expiry_override && info.data !== null && d10(info.data.expiry.date) !== '' ? d10(info.data.expiry.date) : d10(m.expiry_date);
  const canSync = m.sync_source !== '' && m.sync_source !== 'none';

  const sync = async (): Promise<void> => {
    setSyncing(true);
    try {
      const r = await op<SyncResult>('matters/sync', { matter_id: m.id });
      if ('inbox_item' in r) {
        setInboxId(r.inbox_item);
        toast.success(t('Changes at the office are in the Inbox for review'));
      } else if ('unchanged' in r) toast.info(t('No changes at the office'));
      else if ('duplicate' in r) toast.info(t('These changes are already waiting in the Inbox'));
      else if ('not_found' in r) toast.error(t('The office has no record for this number'));
      else toast.info(t('Nothing to check: add the application or registration number first.'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  };

  const next = open[0];

  return (
    <div>
      {dl.dialogs}
      <Card className="mb-4">
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 flex-1 basis-72 gap-4">
              {family !== null && family.mark_image !== '' && (
                <span className="hidden shrink-0 sm:block">
                  <MarkBox family={family} fallback={m.title} size="sm" />
                </span>
              )}
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-[13px]">
                  <Ref dead={dead} className="text-[13px]">
                    {m.ref}
                  </Ref>
                  <JurChip code={m.jurisdiction} />
                  <span className="text-[var(--agent-app-muted)]">{jurisdictionName(m.jurisdiction)}</span>
                  <Tag>{enumLabel('matters.ip_type', m.ip_type)}</Tag>
                  {m.route !== '' && m.route !== 'national' && <span className="text-xs text-[var(--agent-app-muted)]">{enumLabel('matters.route', m.route)}</span>}
                  {parent !== null && (
                    <span className="text-xs text-[var(--agent-app-muted)]">
                      {enumLabel('matters.relation', m.relation)}{' '}
                      <a href={href('matter', parent.id)} className="font-mono text-[var(--agent-app-text)]/80 hover:underline">
                        {parent.ref}
                      </a>
                    </span>
                  )}
                </div>
                <h1 className={cn('mt-1.5 break-words text-xl font-semibold tracking-tight', dead && 'text-[var(--agent-app-muted)]')}>{m.title}</h1>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <MatterStatus m={m} />
                  {d10(m.status_date) !== '' && <span className="text-xs tabular-nums text-[var(--agent-app-muted)]">{t('since {date}', { date: fmtDate(m.status_date) })}</span>}
                  {m.office_status !== '' && <span className="break-words text-xs text-[var(--agent-app-muted)]">{t('Office: {status}', { status: m.office_status })}</span>}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
                  {m.application_no !== '' && (
                    <span>
                      <span className="text-[var(--agent-app-muted)]">{t('Application number')}: </span>
                      <span className="font-mono">{m.application_no}</span>
                    </span>
                  )}
                  {m.registration_no !== '' && (
                    <span>
                      <span className="text-[var(--agent-app-muted)]">{t('Registration number')}: </span>
                      <span className="font-mono">{m.registration_no}</span>
                    </span>
                  )}
                  {m.owner_of_record !== '' && (
                    <span className="min-w-0 break-words">
                      <span className="text-[var(--agent-app-muted)]">{t('Owner of record')}: </span>
                      {m.owner_of_record}
                    </span>
                  )}
                </div>
                <SubjectLinks franchise={m.franchise} character={m.character} talent={m.talent} className="mt-1.5" />
              </div>
            </div>
            {can.edit && (
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Button onClick={() => setDlg('event')}>
                  <CalendarPlus size={14} aria-hidden /> {t('Record event')}
                </Button>
                {canSync && (
                  <Button variant="outline" onClick={() => void sync()} loading={syncing}>
                    <RefreshCw size={14} aria-hidden /> {t('Sync with office')}
                  </Button>
                )}
                <Button variant="outline" onClick={() => setDlg('designate')}>
                  <GitBranchPlus size={14} aria-hidden /> {t('Designate')}
                </Button>
                <Button variant="outline" onClick={() => setDlg('edit')}>
                  <Pencil size={14} aria-hidden /> {t('Edit')}
                </Button>
                <DeleteButton collection="matters" id={m.id} className="h-9" onDeleted={() => navigate('trademarks')} />
              </div>
            )}
          </div>

          <div className="mt-4 grid gap-4 border-t border-[var(--agent-app-border)] pt-3 sm:grid-cols-3">
            <HeaderCell label={t('Next deadline')}>
              {next !== undefined ? (
                <button type="button" className="block w-full min-w-0 text-left hover:underline" onClick={() => setTab('deadlines')}>
                  <span className="block truncate text-[13px] font-medium" title={tf(next, 'title')}>
                    {tf(next, 'title')}
                  </span>
                  <span className={cn('text-xs tabular-nums', daysUntil(next.due_date) < 0 ? TONE_TEXT.bad : 'text-[var(--agent-app-muted)]')}>
                    {fmtDate(next.due_date)}, {relLabel(next.due_date)}
                  </span>
                </button>
              ) : (
                <span className="text-[13px] text-[var(--agent-app-muted)]">{deadlines.loading ? t('Loading') : t('No open deadlines')}</span>
              )}
            </HeaderCell>
            <HeaderCell label={t('Office data')}>
              <SyncState m={m} info={info.data} inboxId={inboxId} />
            </HeaderCell>
            <HeaderCell label={t('Responsible')}>
              {m.responsible !== '' ? (
                <span className="flex min-w-0 items-center gap-2 text-[13px]">
                  <IdentityChip name={userName(m.responsible)} size="sm" />
                  <span className="truncate">{userName(m.responsible)}</span>
                </span>
              ) : (
                <span className="text-[13px] text-[var(--agent-app-muted)]">{t('Nobody assigned')}</span>
              )}
            </HeaderCell>
          </div>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <div className="min-w-0">
          <TabsList className="flex h-auto w-full flex-wrap">
            <TabsTrigger value="overview">{t('Overview')}</TabsTrigger>
            {tm && <TabsTrigger value="goods">{t('Goods and services')}</TabsTrigger>}
            <TabsTrigger value="deadlines">
              {t('Deadlines')}
              {open.length > 0 && <span className="ml-1.5 tabular-nums text-[var(--agent-app-muted)]">{open.length}</span>}
            </TabsTrigger>
            <TabsTrigger value="renewals">{t('Renewals')}</TabsTrigger>
            <TabsTrigger value="family">{t('Family')}</TabsTrigger>
            <TabsTrigger value="documents">{t('Documents')}</TabsTrigger>
            <TabsTrigger value="history">{t('History')}</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview">
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
              <Section title={t('Dates')}>
                <div className="flex flex-col gap-4">
                  <FactGrid cols={3}>
                    <Fact label={t('Filing date')} value={fmtDate(m.filing_date)} />
                    <Fact label={t('Publication date')} value={fmtDate(m.publication_date)} />
                    <Fact label={t('Publication number')} value={m.publication_no} mono />
                    <Fact label={t('Registration date')} value={fmtDate(m.registration_date)} />
                    <Fact label={t('Expiry')} value={expiry !== '' ? `${fmtDate(expiry)}${m.expiry_override ? ` (${t('set by hand')})` : ''}` : ''} />
                    <Fact label={t('Announcement date')} value={fmtDate(announce)} />
                    {tm && <Fact label={t('Classes')} value={classes.length > 0 ? <span className="font-mono tabular-nums" title={classes.map(classLabel).join(', ')}>{classes.join(', ')}</span> : ''} />}
                  </FactGrid>
                  {info.data !== null && bi(info.data.expiry.text) !== '' && (
                    <p className="border-t border-[var(--agent-app-border)] pt-3 text-xs leading-relaxed text-[var(--agent-app-muted)]">
                      <span className="font-medium text-[var(--agent-app-text)]/80">{t('How the expiry is worked out:')} </span>
                      {m.expiry_override ? t('Entered by hand; not recalculated.') : bi(info.data.expiry.text)}
                    </p>
                  )}
                  {(m.priority_claims ?? []).length > 0 && (
                    <div>
                      <div className="mb-1 text-[11px] text-[var(--agent-app-muted)]">{t('Priority claims')}</div>
                      <div className="flex flex-col gap-1">
                        {(m.priority_claims ?? []).map((p, i) => (
                          <span key={`${p.jurisdiction}-${p.number}-${i}`} className="flex flex-wrap items-center gap-2 text-[13px]">
                            <JurChip code={p.jurisdiction} />
                            <span className="font-mono">{p.number || '-'}</span>
                            {d10(p.date) !== '' && <span className="text-xs text-[var(--agent-app-muted)]">{fmtDate(p.date)}</span>}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {leak !== null && <LeakNotice res={leak} />}
                </div>
              </Section>
              <Section title={t('Next deadlines')} flush actions={open.length > 3 ? <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setTab('deadlines')}>{t('Show all')}</Button> : undefined}>
                {open.length === 0 ? (
                  <p className="px-4 py-4 text-[13px] text-[var(--agent-app-muted)]">{t('No open deadlines. Record what happened and the rules add the deadlines that follow.')}</p>
                ) : (
                  <DeadlineList deadlines={open.slice(0, 3)} actions={dl.actions} canEdit={dl.canEdit} showSubject={false} grouped={false} bulk={false} />
                )}
              </Section>
              <Section title={t('Notes')}>{m.notes.trim() !== '' ? <Prose>{m.notes.replace(/<[^>]+>/g, '')}</Prose> : <p className="text-[13px] text-[var(--agent-app-muted)]">{t('No notes.')}</p>}</Section>
            </div>
            <div className="flex min-w-0 flex-col gap-4">
              <Section title={t('Office')}>
                <FactGrid cols={2}>
                  <Fact label={t('Office status')} className="col-span-2" value={m.office_status} />
                  <Fact label={t('Data source')} value={m.sync_source !== '' && m.sync_source !== 'none' ? enumLabel('matters.sync_source', m.sync_source) : t('Entered by hand')} />
                  <Fact label={t('Last synced')} value={d10(m.last_synced) !== '' ? <span title={fmtDateTime(m.last_synced)}>{ago(m.last_synced)}</span> : ''} />
                  {m.sync_error !== '' && <Fact label={t('Sync error')} className="col-span-2" value={<span className={cn('whitespace-normal break-words', TONE_TEXT.bad)}>{m.sync_error}</span>} />}
                </FactGrid>
              </Section>
              <Section title={t('Links')}>
                <FactGrid cols={2}>
                  <Fact label={t('Family')} className="col-span-2" value={family !== null ? <a href={href('family', family.id)} className="hover:underline">{family.title}</a> : ''} />
                  {parent !== null && (
                    <Fact
                      label={enumLabel('matters.relation', m.relation) || t('Parent filing')}
                      className="col-span-2"
                      value={
                        <a href={href('matter', parent.id)} className="hover:underline">
                          <Ref>{parent.ref}</Ref> <span className="text-[var(--agent-app-muted)]">{parent.title}</span>
                        </a>
                      }
                    />
                  )}
                  {children.records.length > 0 && (
                    <div className="col-span-2">
                      <div className="text-[11px] text-[var(--agent-app-muted)]">{t('Filings based on this one')}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {children.records.map((c) => (
                          <MatterChip key={c.id} m={c} />
                        ))}
                      </div>
                    </div>
                  )}
                </FactGrid>
                <SubjectLinks franchise={m.franchise} character={m.character} talent={m.talent} className="mt-3 flex-col" />
              </Section>
              <Section title={t('Details')}>
                <FactGrid cols={2}>
                  <Fact label={t('Route')} value={enumLabel('matters.route', m.route)} />
                  <Fact label={t('Relation')} value={enumLabel('matters.relation', m.relation)} />
                  <Fact label={t('Applicants')} value={m.applicants} />
                  <Fact label={t('Counsel')} value={m.counsel} />
                  <Fact label={t('Client reference')} value={m.client_ref} mono />
                  <Fact label={t('Cost center')} value={m.cost_center} />
                  {tm && m.jurisdiction === 'US' && <Fact label={t('Register|us')} value={enumLabel('matters.tm_register', m.tm_register)} />}
                  {tm && m.jurisdiction === 'US' && <Fact label={t('Filing basis')} value={m.tm_basis} />}
                  <Fact label={t('Docketer')} value={userName(m.docketer)} />
                  <Fact label={t('Added')} value={fmtDate(m.created)} />
                </FactGrid>
              </Section>
            </div>
          </div>
        </TabsContent>

        {tm && (
          <TabsContent value="goods">
            <GoodsPanel matter={m} />
          </TabsContent>
        )}

        <TabsContent value="deadlines">
          <Section
            title={t('Deadlines')}
            meta={deadlines.records.length > 0 ? t('{open} open, {closed} closed', { open: open.length, closed: deadlines.records.length - open.length }) : undefined}
            flush
            actions={
              can.edit ? (
                <Button size="sm" onClick={() => setDlg('event')}>
                  <CalendarPlus size={13} aria-hidden /> {t('Record event')}
                </Button>
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
                actions={dl.actions}
                canEdit={dl.canEdit}
                showSubject={false}
                empty={
                  <EmptyHint
                    compact
                    icon={CalendarPlus}
                    title={t('No deadlines')}
                    message={t('Record what happened (filed, office action, registered) and the rules create the deadlines that follow.')}
                    action={
                      can.edit ? (
                        <Button size="sm" onClick={() => setDlg('event')}>
                          {t('Record event')}
                        </Button>
                      ) : undefined
                    }
                  />
                }
              />
            )}
          </Section>
        </TabsContent>

        <TabsContent value="renewals">
          <RenewalList matterId={m.id} />
        </TabsContent>

        <TabsContent value="family">
          <FamilyTab m={m} family={family} parent={parent} members={members.records} kids={children.records} onDesignate={can.edit ? () => setDlg('designate') : undefined} />
        </TabsContent>

        <TabsContent value="documents">
          <DocumentsPanel relation="matter" relationId={m.id} docketing defaultType="office_action" />
        </TabsContent>

        <TabsContent value="history">
          <EventHistory field="matter" id={m.id} emptyText={t('Filing, publication, office actions, registration and renewals appear here as they are recorded.')} />
        </TabsContent>
      </Tabs>

      {dlg === 'event' && <EventDialog subjectType="matter" subjectId={m.id} jurisdiction={m.jurisdiction} onClose={() => setDlg(null)} onDone={() => undefined} />}
      {dlg === 'edit' && (
        <MatterEditDialog
          matter={m}
          onClose={() => setDlg(null)}
          onSaved={(changed) => {
            if (changed) setRegen(true);
          }}
        />
      )}
      {dlg === 'designate' && <DesignateDialog matter={m} classes={classes} onClose={() => setDlg(null)} />}
      {regen && <RegenerateDialog subjectType="matter" subjectId={m.id} onClose={() => setRegen(false)} onDone={() => undefined} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Office data state                                                   */
/* ------------------------------------------------------------------ */

function SyncState({ m, info, inboxId }: { m: MatterRec; info: MatterInfo | null; inboxId: string }): React.JSX.Element {
  const { can } = useApp();
  if (info === null) return <span className="text-[13px] text-[var(--agent-app-muted)]">{t('Checking')}</span>;
  if (info.sync.source === '') {
    return <span className="text-[13px] text-[var(--agent-app-muted)]">{t('No office data feed for {office}. Keep it up to date by hand.', { office: jurisdictionName(m.jurisdiction) })}</span>;
  }
  if (!info.sync.connected) {
    return (
      <span className="flex flex-col gap-0.5 text-[13px]">
        <span className="flex items-center gap-1.5">
          <Dot tone="neutral" /> {t('{office}: not connected', { office: info.sync.label })}
        </span>
        {can.admin ? (
          <a href={href('settings', undefined, { tab: 'offices' })} className="text-xs font-medium text-[var(--agent-app-accent)] hover:underline">
            {t('Connect it in Settings')}
          </a>
        ) : (
          <span className="text-xs text-[var(--agent-app-muted)]">{t('An admin can connect it in Settings.')}</span>
        )}
      </span>
    );
  }
  const state = m.sync_state;
  const tone = state === 'error' ? 'bad' : state === 'not_found' ? 'warn' : state === 'connected' ? 'good' : 'neutral';
  const text =
    state === 'error'
      ? t('Last check failed')
      : state === 'not_found'
        ? t('The office has no record for this number')
        : d10(m.last_synced) !== ''
          ? t('Checked {when}', { when: ago(m.last_synced) })
          : t('Not checked yet');
  return (
    <div className="flex flex-col gap-1 text-[13px]">
      <span className="flex min-w-0 items-center gap-1.5">
        <Dot tone={tone} />
        <span className="truncate" title={m.sync_error || text}>
          {info.sync.label}
          <span className="text-[var(--agent-app-muted)]">: {text}</span>
        </span>
      </span>
      {!m.sync_enabled && <span className="text-xs text-[var(--agent-app-muted)]">{t('Automatic checks off')}</span>}
      {inboxId !== '' && (
        <a href={href('inbox', inboxId)} className="text-xs font-medium text-[var(--agent-app-accent)] hover:underline">
          {t('Review in the Inbox')}
        </a>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Family                                                              */
/* ------------------------------------------------------------------ */

function FamilyTab({
  m,
  family,
  parent,
  members,
  kids,
  onDesignate,
}: {
  m: MatterRec;
  family: FamilyRec | null;
  parent: MatterRec | null;
  members: MatterRec[];
  kids: MatterRec[];
  onDesignate?: (() => void) | undefined;
}): React.JSX.Element {
  const others = members.filter((x) => x.id !== m.id);
  return (
    <div className="flex flex-col gap-4">
      {family !== null ? (
        <Section
          title={family.title}
          meta={enumLabel('families.kind', family.kind)}
          actions={
            <a href={href('family', family.id)} className="text-xs font-medium text-[var(--agent-app-accent)] hover:underline">
              {t('Open the family')}
            </a>
          }
        >
          <FactGrid cols={4}>
            {family.mark_type !== '' && <Fact label={t('Mark type')} value={enumLabel('families.mark_type', family.mark_type)} />}
            <Fact label={t('Word element')} value={family.word_element} />
            <Fact label={t('Strategy')} value={enumLabel('families.strategy', family.strategy)} />
            <Fact label={t('Filings')} value={String(members.length)} />
          </FactGrid>
        </Section>
      ) : (
        <Notice>{t('This filing is not in a family. Add it to one with Edit, or create filings in more offices with Designate.')}</Notice>
      )}
      <Section
        title={t('Other filings in the family')}
        meta={others.length > 0 ? String(others.length) : undefined}
        flush
        actions={
          onDesignate !== undefined ? (
            <Button size="sm" variant="outline" onClick={onDesignate}>
              <GitBranchPlus size={13} aria-hidden /> {t('Designate')}
            </Button>
          ) : undefined
        }
      >
        {others.length === 0 ? (
          <p className="px-4 py-4 text-[13px] text-[var(--agent-app-muted)]">{t('No other filings yet.')}</p>
        ) : (
          others.map((x) => <MemberRow key={x.id} m={x} relation={x.parent === m.id ? enumLabel('matters.relation', x.relation) : x.id === parent?.id ? t('Parent filing') : ''} />)
        )}
      </Section>
      {kids.filter((c) => c.family !== m.family || m.family === '').length > 0 && (
        <Section title={t('Filings based on this one')} flush>
          {kids
            .filter((c) => c.family !== m.family || m.family === '')
            .map((x) => (
              <MemberRow key={x.id} m={x} relation={enumLabel('matters.relation', x.relation)} />
            ))}
        </Section>
      )}
    </div>
  );
}

function MemberRow({ m, relation }: { m: MatterRec; relation: string }): React.JSX.Element {
  return (
    <a
      href={href('matter', m.id)}
      className="grid gap-1 border-b border-[var(--agent-app-border)]/70 px-4 py-2.5 last:border-0 hover:bg-[var(--agent-app-border)]/20 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,12rem)] sm:items-center sm:gap-4"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <JurChip code={m.jurisdiction} />
        <Ref dead={m.status_group === 'dead'}>{m.ref}</Ref>
        <span className="min-w-0 truncate text-[13px]">{m.title}</span>
        {relation !== '' && <Tag>{relation}</Tag>}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
        <MatterStatus m={m} />
        <span className="font-mono text-[var(--agent-app-muted)]">{m.registration_no || m.application_no}</span>
      </div>
      <div className="min-w-0 text-[13px]">{d10(m.next_deadline) !== '' ? <NextDeadlineCell m={m} /> : <DateCell v={m.expiry_date} />}</div>
    </a>
  );
}
