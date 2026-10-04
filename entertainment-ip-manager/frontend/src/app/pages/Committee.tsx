/**
 * One production committee (製作委員会): the header with its status and
 * key dates, then tabs for the overview and waterfall, members and shares,
 * windows (窓口), "who decides" for a use, money (distributions and
 * recoupment), consent requests, deadlines and documents. Members who log
 * in through the portal see their statements and consent requests there.
 */
import { useState } from 'react';
import { ChevronDown, Landmark, Pencil } from 'lucide-react';
import { Button, Card, DropdownMenu, Tabs, TabsContent, TabsList, TabsTrigger, toast, useRecord } from '../../kit/index.ts';
import { updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { useCollection } from '../lib/live.ts';
import { fmtDate } from '../lib/format.ts';
import { enumLabel, enumOptions, t } from '../lib/i18n.ts';
import { href, navigate, useHashParam } from '../lib/router.ts';
import type { CommitteeRec, ConsentRequestRec } from '../lib/records.ts';
import { DeleteButton } from '../components/deleteRecord.tsx';
import { DocumentsPanel } from '../components/documents.tsx';
import { EmptyHint, EnumPill, Fact, FactGrid, Loading, Tag } from '../components/ui.tsx';
import { CommitteeDeadlinesTab, CommitteeForm, MembersTab, OverviewTab, WhoDecidesTab, WindowsTab } from '../components/rightsCommittee.tsx';
import { ConsentTab, MoneyTab } from '../components/rightsCommitteeMoney.tsx';

type TabKey = 'overview' | 'members' | 'windows' | 'decides' | 'money' | 'consent' | 'deadlines' | 'documents';
const TABS: TabKey[] = ['overview', 'members', 'windows', 'decides', 'money', 'consent', 'deadlines', 'documents'];

function newest(a: CommitteeRec | null, b: CommitteeRec | null): CommitteeRec | null {
  if (a === null) return b;
  if (b === null || b.id !== a.id) return a;
  return b.updated > a.updated ? b : a;
}

export function CommitteePage({ id }: { id: string }): React.JSX.Element {
  const { can, on, nameOf } = useApp();
  const live = useRecord<CommitteeRec>('committees', id !== '' ? id : null);
  const [saved, setSaved] = useState<CommitteeRec | null>(null);
  const c = newest(live.record, saved);
  const openConsents = useCollection<ConsentRequestRec>('consent_requests', { filter: `committee = "${id}" && status = "open"` });
  const [tabParam, setTab] = useHashParam('tab', 'overview');
  const [edit, setEdit] = useState(false);

  if (live.loading && c === null) return <Loading />;
  if (c === null) {
    return (
      <Card>
        <EmptyHint
          icon={Landmark}
          title={t('This committee could not be opened')}
          message={t('It may have been deleted, or the link is incomplete.')}
          action={
            <Button variant="outline" onClick={() => navigate('committees')}>
              {t('Back to Committees')}
            </Button>
          }
        />
      </Card>
    );
  }

  const tab: TabKey = (TABS as string[]).includes(tabParam) ? (tabParam as TabKey) : 'overview';

  const changeStatus = async (s: string): Promise<void> => {
    try {
      setSaved(await updateRecord<CommitteeRec>('committees', c.id, { status: s }));
      toast.success(t('Status changed to {status}.', { status: enumLabel('committees.status', s) }));
    } catch {
      /* toast shown by the client */
    }
  };

  const tabLabel = (k: TabKey): string =>
    ({
      overview: t('Overview'),
      members: t('Members'),
      windows: t('Windows'),
      decides: t('Who decides'),
      money: t('Money|terms'),
      consent: t('Consent'),
      deadlines: t('Deadlines'),
      documents: t('Documents'),
    })[k];

  return (
    <div className="min-w-0">
      <Card className="mb-5">
        <div className="px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <a href={href('committees')} className="text-xs text-[var(--agent-app-muted)] hover:underline">
                  {t('Committees')}
                </a>
                <span className="text-xs text-[var(--agent-app-muted)]" aria-hidden>
                  /
                </span>
                <Tag>{enumLabel('committees.form', c.form)}</Tag>
                {can.rights ? (
                  <DropdownMenu
                    align="left"
                    trigger={
                      <span className="inline-flex items-center gap-0.5" title={t('Change status')}>
                        <EnumPill field="committees.status" value={c.status} />
                        <ChevronDown size={12} className="text-[var(--agent-app-muted)]" aria-hidden />
                      </span>
                    }
                    items={enumOptions('committees.status')
                      .filter(([v]) => v !== c.status)
                      .map(([v, label]) => ({ label: t('Mark as {status}', { status: label }), onSelect: () => void changeStatus(v) }))}
                  />
                ) : (
                  <EnumPill field="committees.status" value={c.status} />
                )}
              </div>
              <h1 className="mt-2 break-words text-xl font-semibold tracking-tight">{c.name}</h1>
            </div>
            <div className="flex min-w-0 max-w-full flex-wrap gap-2">
              {can.rights && (
                <Button variant="outline" size="sm" onClick={() => setEdit(true)}>
                  <Pencil size={13} aria-hidden /> {t('Edit')}
                </Button>
              )}
              <DeleteButton collection="committees" id={c.id} onDeleted={() => navigate('committees')} />
            </div>
          </div>
          <div className="mt-4">
            <FactGrid cols={4}>
              <Fact
                label={c.work === '' && c.franchise !== '' ? t('Franchise') : t('Title')}
                value={
                  c.work !== '' ? (
                    on('titles') ? (
                      <a className="hover:underline" href={href('title', c.work)}>
                        {nameOf('work', c.work)}
                      </a>
                    ) : (
                      nameOf('work', c.work)
                    )
                  ) : c.franchise !== '' ? (
                    on('franchises') ? (
                      <a className="hover:underline" href={href('franchise', c.franchise)}>
                        {nameOf('franchise', c.franchise)}
                      </a>
                    ) : (
                      nameOf('franchise', c.franchise)
                    )
                  ) : (
                    ''
                  )
                }
              />
              <Fact label={t('Formed|date')} value={fmtDate(c.formed_date)} />
              <Fact label={t('Term ends|committee')} value={fmtDate(c.term_end)} />
              <Fact label={t('Review date')} value={fmtDate(c.review_date)} />
            </FactGrid>
          </div>
        </div>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <div className="overflow-x-auto">
          <TabsList>
            {TABS.map((k) => (
              <TabsTrigger key={k} value={k} className="whitespace-nowrap">
                {tabLabel(k)}
                {k === 'consent' && openConsents.records.length > 0 && <span className="ml-1.5 tabular-nums text-[var(--agent-app-muted)]">{openConsents.records.length}</span>}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="overview">
          <OverviewTab committee={c} onEdit={can.rights ? () => setEdit(true) : null} />
        </TabsContent>
        <TabsContent value="members">
          <MembersTab committee={c} />
        </TabsContent>
        <TabsContent value="windows">
          <WindowsTab committee={c} />
        </TabsContent>
        <TabsContent value="decides">
          <WhoDecidesTab committee={c} />
        </TabsContent>
        <TabsContent value="money">
          <MoneyTab committee={c} />
        </TabsContent>
        <TabsContent value="consent">
          <ConsentTab committee={c} />
        </TabsContent>
        <TabsContent value="deadlines">
          <CommitteeDeadlinesTab committee={c} />
        </TabsContent>
        <TabsContent value="documents">
          <DocumentsPanel relation="committee" relationId={c.id} defaultType="contract" />
        </TabsContent>
      </Tabs>

      {edit && <CommitteeForm committee={c} onClose={() => setEdit(false)} onSaved={setSaved} />}
    </div>
  );
}
