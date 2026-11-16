/**
 * Lifecycle lists: the viewer's tasks (or all they may see) grouped by
 * when they are due, and every checklist with its progress.
 */
import { useMemo, useState } from 'react';
import { ListChecks, Plus } from 'lucide-react';
import { Button, Checkbox, DataTable, Empty, LoadError, PageBody, PageHeader, Panel, PersonChip, Segmented, StatusDot } from '../../components/ui.tsx';
import type { Column } from '../../components/ui.tsx';
import { Acts, PhoneActs } from '../../components/lifecycle/Acts.tsx';
import { kindName, MoreOnScroll, ProgressBar, SkeletonRows, TASK_READS } from '../../components/lifecycle/bits.tsx';
import { StartChecklistDialog } from '../../components/lifecycle/dialogs.tsx';
import { TaskRow } from '../../components/lifecycle/TaskRow.tsx';
import type { Checklist, Task, TaskList } from '../../components/lifecycle/types.ts';
import { can, isManager, useMe } from '../../lib/auth.tsx';
import type { PageProps } from '../../lib/contract.ts';
import { addDays, fmtDay } from '../../lib/format.ts';
import { t, tn } from '../../lib/i18n.ts';
import { useOp } from '../../lib/live.ts';
import { setQuery } from '../../lib/router.ts';

const PAGE = 100;

function groupOf(x: Task, today: string): 'overdue' | 'week' | 'later' | 'none' | 'closed' {
  if (x.status !== 'open') return 'closed';
  if (x.due === '') return 'none';
  if (x.due < today) return 'overdue';
  if (x.due <= addDays(today, 7)) return 'week';
  return 'later';
}

export function TasksPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const wide = can(me, 'people', 'view') || isManager(me);
  const view = wide && query.get('view') === 'all' ? 'all' : 'mine';
  const status = query.get('status') === 'closed' ? 'closed' : 'open';
  const overdue = query.get('overdue') === '1';
  const [limit, setLimit] = useState(PAGE);
  const live = useOp<TaskList>('tasks.list', { view, status, overdue: overdue ? true : undefined, limit }, TASK_READS, { name: 'lifecycle.tasks' });
  const d = live.data;
  const groups = useMemo(() => {
    const out: { key: string; tasks: Task[] }[] = [];
    if (d === null) return out;
    for (const key of ['overdue', 'week', 'later', 'none', 'closed']) {
      const tasks = d.tasks.filter((x) => groupOf(x, d.today) === key);
      if (tasks.length > 0) out.push({ key, tasks });
    }
    return out;
  }, [d]);
  return (
    <>
      <PageHeader title={view === 'all' ? t('lifecycle.all_tasks') : t('lifecycle.your_tasks')} meta={d !== null ? tn('lifecycle.meta_tasks', d.total) : ''} back="#/lifecycle" />
      <PageBody>
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          {wide && (
            <Segmented
              value={view}
              onChange={(v) => setQuery({ view: v === 'mine' ? undefined : v })}
              label={t('lifecycle.view')}
              size="sm"
              options={[
                { value: 'mine', label: t('lifecycle.mine') },
                { value: 'all', label: t('lifecycle.everyone') },
              ]}
            />
          )}
          <Segmented
            value={status}
            onChange={(v) => setQuery({ status: v === 'open' ? undefined : v })}
            label={t('lifecycle.status')}
            size="sm"
            options={[
              { value: 'open', label: t('lifecycle.to_do') },
              { value: 'closed', label: t('lifecycle.done') },
            ]}
          />
          <Checkbox checked={overdue} onChange={(v) => setQuery({ overdue: v ? 1 : undefined })} label={t('lifecycle.only_overdue')} />
        </div>
        {d === null ? (
          live.error !== null ? (
            <LoadError message={live.error} onRetry={live.reload} />
          ) : (
            <SkeletonRows />
          )
        ) : d.tasks.length === 0 ? (
          <div className="hr-panel">
            <Empty icon={ListChecks} title={status === 'open' ? t('lifecycle.nothing_to_do') : t('lifecycle.nothing_done')} />
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {groups.map((g, i) => (
              <Panel key={g.key} index={String(i + 1).padStart(2, '0')} label={t(`lifecycle.when.${g.key}`)} aside={<span className="hr-label">{g.tasks.length}</span>} flush>
                <ul className="px-3.5 pb-1">
                  {g.tasks.map((x) => (
                    <TaskRow key={x.id} task={x} today={d.today} show={view === 'all' ? 'lane' : 'person'} leaves={status === 'open'} />
                  ))}
                </ul>
              </Panel>
            ))}
            <MoreOnScroll active={d.total > d.tasks.length && !live.loading} onMore={() => setLimit((l) => l + PAGE)} />
          </div>
        )}
      </PageBody>
    </>
  );
}

export function ChecklistsPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const status = (['open', 'done', 'cancelled', 'all'] as const).find((s) => s === query.get('status')) ?? 'open';
  const kind = query.get('kind') ?? '';
  const [limit, setLimit] = useState(50);
  const [start, setStart] = useState(false);
  const live = useOp<{ checklists: Checklist[]; total: number }>('checklists.list', { status, kind: kind === '' ? undefined : kind, limit }, TASK_READS, { name: 'lifecycle.checklists' });
  const columns: Column<Checklist>[] = [
    { key: 'person', label: t('lifecycle.person'), width: 'minmax(200px,1.6fr)', phone: 'title', sort: (r) => r.employee_name, render: (r) => <PersonChip name={r.employee_name} sub={[r.employee_number, r.title].filter((x) => x !== '').join(' · ')} size={24} /> },
    { key: 'kind', label: t('lifecycle.f.kind'), width: '120px', sort: (r) => r.kind, render: (r) => kindName(r.kind) },
    { key: 'name', label: t('lifecycle.checklist'), width: 'minmax(140px,1.2fr)', hideBelow: 'lg', render: (r) => r.name },
    { key: 'day', label: t('lifecycle.from_day'), width: '110px', mono: true, sort: (r) => r.anchor_day, render: (r) => fmtDay(r.anchor_day) },
    { key: 'progress', label: t('lifecycle.progress'), width: 'minmax(160px,1fr)', phone: 'end', sort: (r) => r.progress.percent, render: (r) => (r.status === 'open' ? <ProgressBar progress={r.progress} wide /> : <StatusDot tone={r.status === 'done' ? 'good' : 'faint'} label={t(`lifecycle.cl_status.${r.status}`)} />) },
  ];
  const d = live.data;
  const startBtn = can(me, 'people', 'edit') ? (
    <Button variant="primary" icon={Plus} onClick={() => setStart(true)}>
      {t('lifecycle.start_checklist')}
    </Button>
  ) : null;
  return (
    <>
      <PageHeader title={t('lifecycle.checklists')} meta={d !== null ? tn('lifecycle.meta_checklists', d.total) : ''} back="#/lifecycle">
        {startBtn !== null && <Acts>{startBtn}</Acts>}
      </PageHeader>
      <PageBody>
        {startBtn !== null && <PhoneActs>{startBtn}</PhoneActs>}
        <div className="hr-panel hr-in min-w-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--hr-line)] px-4 py-2.5">
            <Segmented
              value={status}
              onChange={(v) => setQuery({ status: v === 'open' ? undefined : v })}
              label={t('lifecycle.status')}
              size="sm"
              options={[
                { value: 'open', label: t('lifecycle.cl_status.open') },
                { value: 'done', label: t('lifecycle.cl_status.done') },
                { value: 'cancelled', label: t('lifecycle.cl_status.cancelled') },
                { value: 'all', label: t('lifecycle.all') },
              ]}
            />
            <Segmented
              value={kind}
              onChange={(v) => setQuery({ kind: v === '' ? undefined : v })}
              label={t('lifecycle.f.kind')}
              size="sm"
              options={[
                { value: '', label: t('lifecycle.all') },
                { value: 'onboarding', label: kindName('onboarding') },
                { value: 'offboarding', label: kindName('offboarding') },
                { value: 'custom', label: kindName('custom') },
              ]}
            />
          </div>
          {d === null ? (
            live.error !== null ? (
              <LoadError message={live.error} onRetry={live.reload} />
            ) : (
              <SkeletonRows />
            )
          ) : (
            <DataTable
              label={t('lifecycle.checklists')}
              columns={columns}
              rows={d.checklists}
              rowKey={(r) => r.id}
              rowHref={(r) => `#/lifecycle/checklists/${r.id}`}
              hasMore={d.total > d.checklists.length}
              onMore={() => setLimit((l) => l + 50)}
              loadingMore={live.loading}
              empty={<Empty icon={ListChecks} title={t('lifecycle.no_checklists')} action={can(me, 'people', 'edit') ? <Button icon={Plus} onClick={() => setStart(true)}>{t('lifecycle.start_checklist')}</Button> : undefined} />}
            />
          )}
        </div>
      </PageBody>
      <StartChecklistDialog open={start} onClose={() => setStart(false)} />
    </>
  );
}
