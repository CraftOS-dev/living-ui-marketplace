/**
 * Enforcement: cases (counterfeits, impersonation, piracy, leaks, clip and
 * AI misuse, trademark conflicts) moving along the action ladder, watch
 * results to review, platform rights-owner programs, and customs
 * recordations. Deep links "#/enforcement?open=<id>" open a platform
 * program or customs recordation.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Gavel, Plus, Search } from 'lucide-react';
import { Button, Card, Input, Select, Tabs, TabsContent, TabsList, TabsTrigger } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { useApp } from '../lib/context.tsx';
import { d10, fmtDate } from '../lib/format.ts';
import { enumLabel, enumOptions, joinList, t } from '../lib/i18n.ts';
import { href, navigate, useHashParam } from '../lib/router.ts';
import type { CustomsRecordationRec, DeadlineRec, PlatformEnrollmentRec } from '../lib/records.ts';
import { DataTable } from '../components/DataTable.tsx';
import type { Col } from '../components/DataTable.tsx';
import { canDelete, deleteCol } from '../components/deleteRecord.tsx';
import { EmptyHint, EnumPill, ErrorBox, Loading, PageHeader, Ref, TONE_TEXT } from '../components/ui.tsx';
import { CaseDialog } from '../components/protectCaseForms.tsx';
import type { CaseX } from '../components/protectCaseForms.tsx';
import { CustomsPanel, PlatformsPanel } from '../components/protectPlatforms.tsx';
import { dueTone, opts } from '../components/protectShared.tsx';
import { WatchPanel } from '../components/protectWatch.tsx';

const CLOSED = new Set(['settled', 'won', 'lost', 'closed']);

export function EnforcementPage(): React.JSX.Element {
  const [tab, setTab] = useHashParam('tab', 'cases');
  const [openId] = useHashParam('open', '');
  const enrollments = useCollection<PlatformEnrollmentRec>('platform_enrollments', { sort: 'platform' });
  const recordations = useCollection<CustomsRecordationRec>('customs_recordations', { sort: 'valid_until', expand: 'matter' });
  const deadlines = useCollection<DeadlineRec>('deadlines', { filter: 'status = "open" && (case_ref != "" || enrollment != "" || recordation != "")', sort: 'due_date' });

  // A deep link to a platform program or customs recordation opens its tab, once.
  const routed = useRef('');
  useEffect(() => {
    if (openId === '' || routed.current === openId) return;
    if (enrollments.records.some((r) => r.id === openId)) {
      routed.current = openId;
      setTab('platforms');
    } else if (recordations.records.some((r) => r.id === openId)) {
      routed.current = openId;
      setTab('customs');
    }
  }, [openId, enrollments.records, recordations.records, setTab]);

  return (
    <div>
      <PageHeader
        title={t('Enforcement')}
        subtitle={t('Counterfeits, impersonation, piracy, leaks and trademark conflicts, from the first notice to settlement, with watch results, platform programs and customs.')}
      />
      <Tabs value={tab} onValueChange={setTab}>
        <div className="min-w-0">
          <TabsList className="flex h-auto w-full flex-wrap">
            <TabsTrigger value="cases">{t('Cases')}</TabsTrigger>
            <TabsTrigger value="watch">{t('Watch')}</TabsTrigger>
            <TabsTrigger value="platforms">{t('Platforms')}</TabsTrigger>
            <TabsTrigger value="customs">{t('Customs')}</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="cases">
          <CasesTab deadlines={deadlines.records} />
        </TabsContent>
        <TabsContent value="watch">
          <WatchPanel />
        </TabsContent>
        <TabsContent value="platforms">
          <PlatformsPanel list={enrollments} deadlines={deadlines.records} openId={openId} />
        </TabsContent>
        <TabsContent value="customs">
          <CustomsPanel list={recordations} deadlines={deadlines.records} openId={openId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Cases                                                               */
/* ------------------------------------------------------------------ */

function CasesTab({ deadlines }: { deadlines: DeadlineRec[] }): React.JSX.Element {
  const { can, on, users, userName, nameOf } = useApp();
  const cases = useCollection<CaseX>('enforcement_cases', { sort: '-opened_date,-created' });
  const [qParam, setQParam] = useHashParam('q', '');
  const [type, setType] = useHashParam('type', '');
  const [status, setStatus] = useHashParam('status', 'open');
  const [forum, setForum] = useHashParam('forum', '');
  const [assignee, setAssignee] = useHashParam('assignee', '');
  const [text, setText] = useState(qParam);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (text.trim() !== qParam) setQParam(text.trim());
    }, 250);
    return () => clearTimeout(timer);
  }, [text, qParam, setQParam]);

  const nextOf = useMemo(() => {
    const m = new Map<string, DeadlineRec>();
    for (const d of deadlines) if (d.case_ref !== '' && !m.has(d.case_ref)) m.set(d.case_ref, d);
    return m;
  }, [deadlines]);

  const rows = useMemo(() => {
    const needle = qParam.trim().toLowerCase();
    return cases.records.filter((c) => {
      if (status === 'open' ? CLOSED.has(c.status) : status !== '' && c.status !== status) return false;
      if (type !== '' && c.case_type !== type) return false;
      if (forum !== '' && c.forum !== forum) return false;
      if (assignee !== '' && c.assignee !== assignee) return false;
      if (needle === '') return true;
      return [c.ref, c.title, c.platform, c.their_party, ...(c.urls ?? []).map(String)].some((x) => x.toLowerCase().includes(needle));
    });
  }, [cases.records, status, type, forum, assignee, qParam]);

  const linked = (c: CaseX): string => {
    const names = [...(on('franchises') ? c.characters.map((id) => nameOf('character', id)) : []), ...(on('talents') ? c.talents.map((id) => nameOf('talent', id)) : [])].filter((x) => x !== '');
    return joinList(names);
  };

  const columns: Col<CaseX>[] = [
    {
      key: 'ref',
      label: t('Reference'),
      value: (c) => c.ref,
      render: (c) => (
        <a href={href('case', c.id)} onClick={(e) => e.stopPropagation()} className="whitespace-nowrap hover:underline">
          <Ref dead={CLOSED.has(c.status)}>{c.ref}</Ref>
        </a>
      ),
    },
    { key: 'title', label: t('Title|case'), value: (c) => c.title, render: (c) => <span className="block max-w-[18rem] truncate font-medium" title={c.title}>{c.title}</span> },
    { key: 'case_type', label: t('Type'), value: (c) => enumLabel('enforcement_cases.case_type', c.case_type), render: (c) => <span className="whitespace-nowrap">{enumLabel('enforcement_cases.case_type', c.case_type)}</span> },
    { key: 'forum', label: t('Forum'), value: (c) => enumLabel('enforcement_cases.forum', c.forum), render: (c) => <span className="whitespace-nowrap">{enumLabel('enforcement_cases.forum', c.forum) || '-'}</span> },
    { key: 'platform', label: t('Platform'), value: (c) => c.platform, render: (c) => <span className="block max-w-[10rem] truncate">{c.platform || '-'}</span> },
    { key: 'status', label: t('Status'), value: (c) => enumLabel('enforcement_cases.status', c.status), render: (c) => <EnumPill field="enforcement_cases.status" value={c.status} /> },
    { key: 'linked', label: t('Characters and talents'), value: (c) => linked(c), render: (c) => <span className="block max-w-[12rem] truncate" title={linked(c)}>{linked(c) || '-'}</span> },
    { key: 'opened', label: t('Opened'), value: (c) => d10(c.opened_date), render: (c) => <span className="whitespace-nowrap tabular-nums">{fmtDate(c.opened_date) || '-'}</span> },
    { key: 'assignee', label: t('Assignee'), value: (c) => userName(c.assignee), render: (c) => <span className="whitespace-nowrap">{userName(c.assignee) || '-'}</span> },
    {
      key: 'next',
      label: t('Next deadline'),
      value: (c) => d10(nextOf.get(c.id)?.due_date ?? ''),
      render: (c) => {
        const d = nextOf.get(c.id);
        if (d === undefined) return <span className="text-[var(--agent-app-muted)]">-</span>;
        const tone = dueTone(d.due_date);
        return (
          <span className={`whitespace-nowrap tabular-nums ${tone !== 'neutral' ? TONE_TEXT[tone] : ''}`}>
            {fmtDate(d.due_date)}
          </span>
        );
      },
    },
    { key: 'their_party', label: t('Other party'), optional: true, value: (c) => c.their_party },
    { key: 'role', label: t('Our role'), optional: true, value: (c) => enumLabel('enforcement_cases.role', c.role) },
    ...deleteCol<CaseX>('enforcement_cases', canDelete(can, 'enforcement_cases')),
  ];

  const filtersOn = qParam !== '' || type !== '' || status !== 'open' || forum !== '' || assignee !== '';
  const clear = (): void => {
    setText('');
    setQParam('');
    setType('');
    setStatus('open');
    setForum('');
    setAssignee('');
  };

  const newButton = can.edit ? (
    <Button onClick={() => setCreating(true)}>
      <Plus size={14} aria-hidden /> {t('New case')}
    </Button>
  ) : undefined;

  if (cases.error !== null && cases.records.length === 0) return <ErrorBox message={cases.error} onRetry={cases.refresh} />;
  if (cases.loading && cases.records.length === 0) return <Loading />;

  return (
    <div className="flex flex-col gap-3">
      {cases.records.length === 0 ? (
        <Card>
          <EmptyHint
            icon={Gavel}
            title={t('No cases yet')}
            message={t('Open a case for a counterfeit listing, an impersonating account, a leak or a conflicting trademark. Watch results can be escalated into cases.')}
            action={newButton}
          />
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-64">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-[var(--agent-app-muted)]" aria-hidden />
              <Input aria-label={t('Search')} className="pl-8" placeholder={t('Reference, title, platform or URL')} value={text} onChange={(e) => setText(e.target.value)} />
            </div>
            <div className="ml-auto">{newButton}</div>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Select aria-label={t('Type')} value={type} placeholder={t('Any type')} options={opts(enumOptions('enforcement_cases.case_type'))} onChange={(e) => setType(e.target.value)} />
            <Select aria-label={t('Status')} value={status} placeholder={t('Any status')} options={[{ value: 'open', label: t('Open cases') }, ...opts(enumOptions('enforcement_cases.status'))]} onChange={(e) => setStatus(e.target.value)} />
            <Select aria-label={t('Forum')} value={forum} placeholder={t('Any forum')} options={opts(enumOptions('enforcement_cases.forum'))} onChange={(e) => setForum(e.target.value)} />
            <Select
              aria-label={t('Assignee')}
              value={assignee}
              placeholder={t('Anyone')}
              options={users.filter((u) => u.role !== 'licensee' && u.role !== 'committee_member' && u.role !== 'reviewer').map((u) => ({ value: u.id, label: u.name || u.email }))}
              onChange={(e) => setAssignee(e.target.value)}
            />
          </div>
          {filtersOn && (
            <div>
              <Button size="sm" variant="ghost" onClick={clear}>
                {t('Clear filters')}
              </Button>
            </div>
          )}
          <Card className="overflow-hidden">
            <DataTable<CaseX>
              tableId="protect-cases"
              rows={rows}
              columns={columns}
              exportName="enforcement-cases"
              onRowClick={(c) => navigate('case', c.id)}
              rowClassName={(c) => (CLOSED.has(c.status) ? 'opacity-70' : '')}
              empty={
                <EmptyHint
                  compact
                  icon={Search}
                  title={t('Nothing matches these filters')}
                  message={status === 'open' ? t('Closed cases are hidden. Choose another status to see them.') : undefined}
                  action={
                    <Button size="sm" onClick={clear}>
                      {t('Clear filters')}
                    </Button>
                  }
                />
              }
            />
          </Card>
        </>
      )}
      {creating && <CaseDialog onClose={() => setCreating(false)} />}
    </div>
  );
}
