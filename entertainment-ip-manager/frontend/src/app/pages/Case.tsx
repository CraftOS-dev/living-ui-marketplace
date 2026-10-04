/**
 * One enforcement case: header (type, forum, our role, status, platform,
 * the other party, assignee), the action ladder with "Record next step",
 * and tabs for the overview (URLs, rights relied on, outcome and
 * settlement), notice drafts, evidence, deadlines, documents and history.
 */
import { useState } from 'react';
import { CalendarPlus, Pencil } from 'lucide-react';
import { Button, Card, CardContent, Tabs, TabsContent, TabsList, TabsTrigger, useRecord } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { q } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { fmtDate } from '../lib/format.ts';
import { enumLabel, t, tf } from '../lib/i18n.ts';
import { href, navigate, useHashParam } from '../lib/router.ts';
import type { DeadlineRec } from '../lib/records.ts';
import { DeadlineList, useDeadlineActions } from '../components/deadlines.tsx';
import { DeleteButton } from '../components/deleteRecord.tsx';
import { DocumentsPanel } from '../components/documents.tsx';
import { EventDialog } from '../components/events.tsx';
import { EmptyHint, EnumPill, ErrorBox, IdentityChip, Loading, Prose, Ref, Section, Tag } from '../components/ui.tsx';
import { CaseDialog, OutcomeSection, RightsSection, UrlsSection } from '../components/protectCaseForms.tsx';
import type { CaseX } from '../components/protectCaseForms.tsx';
import { ActionLadder, EvidencePanel, NoticePanel } from '../components/protectCaseTabs.tsx';
import { EventHistory, HeaderCell, RecordMissing } from '../components/protectShared.tsx';

export function CasePage({ id }: { id: string }): React.JSX.Element {
  const { record, loading } = useRecord<CaseX>('enforcement_cases', id === '' ? null : id);
  if (id === '') return <RecordMissing title={t('No case chosen')} message={t('Open a case from the enforcement list.')} back={href('enforcement')} backLabel={t('Open enforcement')} />;
  if (loading && record === null) return <Loading />;
  if (record === null) return <RecordMissing title={t('This record is not available')} message={t('It may have been deleted, or you may not have access to it.')} back={href('enforcement')} backLabel={t('Open enforcement')} />;
  return <CaseView c={record} />;
}

function CaseView({ c }: { c: CaseX }): React.JSX.Element {
  const { can, userName } = useApp();
  const [tab, setTab] = useHashParam('tab', 'overview');
  const [dlg, setDlg] = useState<'edit' | { kind: 'event'; code: string | undefined } | null>(null);
  const dl = useDeadlineActions();
  const deadlines = useCollection<DeadlineRec>('deadlines', { filter: `case_ref = ${q(c.id)}`, sort: 'due_date' });
  const open = deadlines.records.filter((d) => d.status === 'open');
  const closed = c.status === 'closed' || c.status === 'won' || c.status === 'lost' || c.status === 'settled';

  return (
    <div className="flex flex-col gap-4">
      {dl.dialogs}
      <Card>
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1 basis-72">
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <Ref dead={closed} className="text-[13px]">
                  {c.ref}
                </Ref>
                <Tag>{enumLabel('enforcement_cases.case_type', c.case_type)}</Tag>
                {c.forum !== '' && <span className="text-xs text-[var(--agent-app-muted)]">{enumLabel('enforcement_cases.forum', c.forum)}</span>}
                {c.role !== '' && <span className="text-xs text-[var(--agent-app-muted)]">{enumLabel('enforcement_cases.role', c.role)}</span>}
              </div>
              <h1 className="mt-1.5 break-words text-xl font-semibold tracking-tight">{c.title}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-[var(--agent-app-muted)]">
                <EnumPill field="enforcement_cases.status" value={c.status} />
                {c.opened_date !== '' && <span>{t('Opened {date}', { date: fmtDate(c.opened_date) })}</span>}
              </div>
            </div>
            {can.edit && (
              <div className="flex min-w-0 flex-wrap gap-2">
                <Button onClick={() => setDlg({ kind: 'event', code: undefined })}>
                  <CalendarPlus size={14} aria-hidden /> {t('Record event')}
                </Button>
                <Button variant="outline" onClick={() => setDlg('edit')}>
                  <Pencil size={14} aria-hidden /> {t('Edit')}
                </Button>
                <DeleteButton collection="enforcement_cases" id={c.id} className="h-9" onDeleted={() => navigate('enforcement')} />
              </div>
            )}
          </div>
          <div className="mt-4 grid gap-4 border-t border-[var(--agent-app-border)] pt-3 sm:grid-cols-2 lg:grid-cols-4">
            <HeaderCell label={t('Platform')}>
              <span className="block truncate text-[13px]">{c.platform || '-'}</span>
            </HeaderCell>
            <HeaderCell label={t('Other party')}>
              <span className="block break-words text-[13px]">{c.their_party || '-'}</span>
            </HeaderCell>
            <HeaderCell label={t('Assignee')}>
              {c.assignee !== '' ? (
                <span className="flex min-w-0 items-center gap-2 text-[13px]">
                  <IdentityChip name={userName(c.assignee)} size="sm" />
                  <span className="truncate">{userName(c.assignee)}</span>
                </span>
              ) : (
                <span className="text-[13px] text-[var(--agent-app-muted)]">{t('Nobody assigned')}</span>
              )}
            </HeaderCell>
            <HeaderCell label={t('Next deadline')}>
              {open[0] !== undefined ? (
                <button type="button" className="block w-full min-w-0 text-left hover:underline" onClick={() => setTab('deadlines')}>
                  <span className="block truncate text-[13px] font-medium">{tf(open[0], 'title')}</span>
                  <span className="text-xs tabular-nums text-[var(--agent-app-muted)]">{fmtDate(open[0].due_date)}</span>
                </button>
              ) : (
                <span className="text-[13px] text-[var(--agent-app-muted)]">{t('No open deadlines')}</span>
              )}
            </HeaderCell>
          </div>
        </CardContent>
      </Card>

      <ActionLadder c={c} onRecord={(code) => setDlg({ kind: 'event', code })} />

      <Tabs value={tab} onValueChange={setTab}>
        <div className="min-w-0">
          <TabsList className="flex h-auto w-full flex-wrap">
            <TabsTrigger value="overview">{t('Overview')}</TabsTrigger>
            <TabsTrigger value="notice">{t('Notice')}</TabsTrigger>
            <TabsTrigger value="evidence">{t('Evidence')}</TabsTrigger>
            <TabsTrigger value="deadlines">
              {t('Deadlines')}
              {open.length > 0 && <span className="ml-1.5 tabular-nums text-[var(--agent-app-muted)]">{open.length}</span>}
            </TabsTrigger>
            <TabsTrigger value="documents">{t('Documents')}</TabsTrigger>
            <TabsTrigger value="history">{t('History')}</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-4">
              <UrlsSection c={c} />
              <RightsSection c={c} />
              {c.notes.trim() !== '' && (
                <Section title={t('Notes')}>
                  <Prose>{c.notes.replace(/<[^>]+>/g, '')}</Prose>
                </Section>
              )}
            </div>
            <div className="flex min-w-0 flex-col gap-4">
              <OutcomeSection key={c.id} c={c} />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="notice">
          <NoticePanel c={c} />
        </TabsContent>

        <TabsContent value="evidence">
          <EvidencePanel c={c} />
        </TabsContent>

        <TabsContent value="deadlines">
          <Section
            title={t('Deadlines')}
            meta={deadlines.records.length > 0 ? t('{open} open, {closed} closed', { open: open.length, closed: deadlines.records.length - open.length }) : undefined}
            flush
            actions={
              can.edit ? (
                <Button size="sm" onClick={() => setDlg({ kind: 'event', code: undefined })}>
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
                    message={t('Record each step (removal request, counter-notice, disclosure request) and the rules add the clocks that follow, such as the 7-day platform decision or the DMCA restore window.')}
                  />
                }
              />
            )}
          </Section>
        </TabsContent>

        <TabsContent value="documents">
          <DocumentsPanel relation="case_ref" relationId={c.id} docketing defaultType="platform_notice" />
        </TabsContent>

        <TabsContent value="history">
          <EventHistory field="case_ref" id={c.id} emptyText={t('Notices, removal requests, counter-notices and other steps appear here as they are recorded.')} />
        </TabsContent>
      </Tabs>

      {dlg === 'edit' && <CaseDialog record={c} onClose={() => setDlg(null)} />}
      {dlg !== null && dlg !== 'edit' && <EventDialog subjectType="case" subjectId={c.id} initialCode={dlg.code} onClose={() => setDlg(null)} onDone={() => undefined} />}
    </div>
  );
}
