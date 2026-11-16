/**
 * Goals: opens on what needs an update (at risk, off track, overdue, due
 * soon, no check-in for a while), then every goal the viewer may see as
 * compact rows with quiet progress bars. Views: mine, team (managers),
 * company, all; a list or the alignment tree. CSV export and import.
 */
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Download, FileUp, ListTree, Plus, Rows3, Target } from 'lucide-react';
import { Button, DataTable, Dialog, Empty, Field, LoadError, Loading, Notice, PageBody, PageHeader, Panel, SearchInput, Segmented, Tag, Textarea, toast } from '../../components/ui.tsx';
import type { Column } from '../../components/ui.tsx';
import { CheckinDialog, GoalDialog } from '../../components/performance/dialogs.tsx';
import { GoalStatusDot, ProgressBar, Reasons } from '../../components/performance/bits.tsx';
import type { Goal, GoalList, TreeNode } from '../../components/performance/types.ts';
import { READS } from '../../components/performance/types.ts';
import { op, saveText } from '../../lib/api.ts';
import { can, isManager, useMe } from '../../lib/auth.tsx';
import type { PageProps } from '../../lib/contract.ts';
import { ago, fmtDay } from '../../lib/format.ts';
import { t, tn } from '../../lib/i18n.ts';
import { changed, useOp } from '../../lib/live.ts';
import { setQuery } from '../../lib/router.ts';
import { cn } from '../../../kit/index.ts';

type View = 'mine' | 'team' | 'company' | 'all';
const PAGE = 50;

export function GoalsPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const hr = can(me, 'performance', 'view');
  const views: { value: View; label: string }[] = [];
  if (me.employee !== null) views.push({ value: 'mine', label: t('perf.goals.mine') });
  if (isManager(me)) views.push({ value: 'team', label: t('perf.goals.team') });
  views.push({ value: 'company', label: t('perf.goals.company') });
  views.push({ value: 'all', label: hr ? t('perf.goals.all') : t('perf.goals.all_visible') });
  const employee = query.get('employee') ?? '';
  const wanted = query.get('view') as View | null;
  const view: View = employee !== '' ? 'all' : wanted !== null && views.some((v) => v.value === wanted) ? wanted : hr ? 'all' : (views[0]?.value ?? 'all');
  const mode = query.get('mode') === 'tree' ? 'tree' : 'list';
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [goalOpen, setGoalOpen] = useState(false);
  const [checkin, setCheckin] = useState<Goal | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  useEffect(() => {
    const h = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(h);
  }, [q]);
  useEffect(() => setLimit(PAGE), [view, debounced, employee]);
  const base = { view, employee: employee === '' ? undefined : employee, q: debounced === '' ? undefined : debounced };
  const needs = useOp<GoalList>('goals.list', { ...base, needs_update: true, limit: 20 }, READS.goals, { name: 'perf.goals.needs' });
  const all = useOp<GoalList>('goals.list', { ...base, status: 'all', limit }, READS.goals, { name: 'perf.goals.all' });
  const who = employee !== '' ? all.data?.goals.find((g) => g.employee?.id === employee)?.employee?.name ?? '' : '';

  const columns: Column<Goal>[] = useMemo(
    () => [
      {
        key: 'title',
        label: t('perf.goal.goal'),
        width: 'minmax(240px,2.6fr)',
        phone: 'title',
        sort: (g) => g.title,
        render: (g) => (
          <span className="min-w-0">
            <span className="hr-wrap block font-medium">{g.title}</span>
            <span className="block truncate text-[12px] text-[var(--hr-muted)]">{g.scope === 'personal' ? g.employee?.name : g.scope === 'team' ? g.department?.name : t('perf.goal.scope.company')}{g.parent !== null ? ` · ${t('perf.goal.aligns_to', { title: g.parent.title })}` : ''}</span>
          </span>
        ),
      },
      { key: 'progress', label: t('perf.progress'), width: 'minmax(140px,1.2fr)', sort: (g) => g.progress, render: (g) => <ProgressBar value={g.progress} status={g.status} label={g.title} /> },
      { key: 'status', label: t('perf.goal.status_col'), width: '120px', sort: (g) => g.status, phone: 'end', render: (g) => <GoalStatusDot status={g.status} /> },
      { key: 'due', label: t('perf.goal.due'), width: '100px', mono: true, sort: (g) => g.due || '9999', hideBelow: 'lg', render: (g) => fmtDay(g.due) },
      { key: 'last', label: t('perf.goal.last_checkin'), width: '110px', sort: (g) => g.last_checkin, hideBelow: 'xl', phone: 'hide', render: (g) => <span className="text-[12px] text-[var(--hr-muted)]">{g.last_checkin !== '' ? ago(g.last_checkin) : t('perf.goal.never')}</span> },
    ],
    [],
  );

  const exportCsv = async (): Promise<void> => {
    try {
      const r = await op<{ csv: string; filename: string }>('goals.export', { ...base, status: 'all' });
      saveText(r.csv, r.filename);
    } catch {
      /* toast shown */
    }
  };

  const meta = all.data === null || mode === 'tree' ? '' : [tn('perf.goals.count', all.data.total), tn('perf.goals.need_count', needs.data?.total ?? 0)].join(' · ');
  return (
    <>
      <PageHeader title={who !== '' ? t('perf.goals.of', { name: who }) : t('perf.goals.title')} meta={meta} back={employee !== '' ? '#/performance/goals' : undefined}>
        <Segmented
          value={mode}
          onChange={(v) => setQuery({ mode: v === 'list' ? undefined : v })}
          label={t('perf.goals.layout')}
          options={[
            { value: 'list', label: t('perf.goals.list'), icon: Rows3 },
            { value: 'tree', label: t('perf.goals.tree'), icon: ListTree },
          ]}
          className="hidden sm:inline-flex"
        />
        <Button variant="primary" icon={Plus} onClick={() => setGoalOpen(true)}>
          {t('perf.goal.add')}
        </Button>
      </PageHeader>
      <PageBody>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {employee === '' && mode === 'list' && views.length > 1 && <Segmented value={view} onChange={(v) => setQuery({ view: v })} options={views} label={t('perf.goals.view')} size="sm" />}
          {mode === 'list' && <SearchInput value={q} onChange={setQ} placeholder={t('perf.goals.search')} className="w-full sm:w-[240px]" />}
          <span className="flex-1" />
          <Button size="sm" variant="ghost" icon={Download} onClick={() => void exportCsv()}>
            {t('ui.export')}
          </Button>
          {can(me, 'performance', 'edit') && (
            <Button size="sm" variant="ghost" icon={FileUp} onClick={() => setImportOpen(true)}>
              {t('ui.import')}
            </Button>
          )}
        </div>
        {mode === 'tree' ? (
          <GoalTree />
        ) : (
          <div className="flex flex-col gap-3">
            {needs.data !== null && needs.data.goals.length > 0 && (
              <Panel index="01" label={t('perf.goals.needs_update')} aside={<span className="hr-label">{needs.data.total}</span>} flush>
                <ul className="flex flex-col px-1.5 pb-1.5">
                  {needs.data.goals.map((g) => (
                    <li key={g.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-[var(--hr-hair)] px-2 py-2.5 last:border-b-0">
                      <a href={`#/performance/goals/${g.id}`} className="hr-focus hit min-w-0 flex-1 basis-[240px] rounded-[3px]">
                        <span className="hr-link hr-wrap block text-[13px] font-medium">{g.title}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-2">
                          {g.employee !== null && view !== 'mine' && <span className="text-[12px] text-[var(--hr-muted)]">{g.employee.name}</span>}
                          <Reasons goal={g} withStatus />
                        </span>
                      </a>
                      <ProgressBar value={g.progress} status={g.status} className="w-[160px]" label={g.title} />
                      {g.can.edit && (
                        <Button size="sm" onClick={() => setCheckin(g)}>
                          {t('perf.checkin.short')}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
            <Panel index={needs.data !== null && needs.data.goals.length > 0 ? '02' : '01'} label={t('perf.goals.every')} flush>
              {all.data === null ? (
                all.error !== null ? (
                  <LoadError message={all.error} onRetry={all.reload} />
                ) : (
                  <Loading />
                )
              ) : (
                <DataTable
                  label={t('perf.goals.title')}
                  columns={columns}
                  rows={all.data.goals}
                  rowKey={(g) => g.id}
                  rowHref={(g) => `#/performance/goals/${g.id}`}
                  rowClass={(g) => (g.status === 'done' || g.status === 'dropped' ? 'opacity-60' : '')}
                  hasMore={all.data.total > all.data.goals.length}
                  onMore={() => setLimit((l) => l + PAGE)}
                  loadingMore={all.loading}
                  empty={
                    <Empty icon={Target} title={debounced !== '' ? t('perf.goals.none_match') : t('perf.goals.empty')} action={<Button icon={Plus} onClick={() => setGoalOpen(true)}>{t('perf.goals.first')}</Button>}>
                      {debounced === '' ? t('perf.goals.empty_text') : undefined}
                    </Empty>
                  }
                />
              )}
            </Panel>
          </div>
        )}
      </PageBody>
      <GoalDialog open={goalOpen} onClose={() => setGoalOpen(false)} employee={employee !== '' && who !== '' ? { id: employee, name: who } : undefined} />
      <CheckinDialog open={checkin !== null} onClose={() => setCheckin(null)} goal={checkin} />
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </>
  );
}

/** The alignment tree: company goals, the team goals under them, personal goals under those. */
function GoalTree(): React.JSX.Element {
  const live = useOp<{ nodes: TreeNode[]; roots: string[] }>('goals.tree', {}, READS.goals, { name: 'perf.goals.tree' });
  const [closed, setClosed] = useState<Set<string>>(new Set());
  if (live.data === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />;
  const byParent = new Map<string, TreeNode[]>();
  for (const n of live.data.nodes) {
    const k = live.data.roots.includes(n.id) ? '' : n.parent;
    byParent.set(k, [...(byParent.get(k) ?? []), n]);
  }
  const order = { company: 0, team: 1, personal: 2 };
  const rows: { node: TreeNode; depth: number }[] = [];
  const walk = (parent: string, depth: number): void => {
    const kids = (byParent.get(parent) ?? []).sort((a, b) => order[a.scope] - order[b.scope] || a.title.localeCompare(b.title));
    for (const k of kids) {
      rows.push({ node: k, depth });
      if (!closed.has(k.id)) walk(k.id, depth + 1);
    }
  };
  walk('', 0);
  if (rows.length === 0) return <Empty icon={ListTree} title={t('perf.goals.tree_empty')}>{t('perf.goals.tree_empty_text')}</Empty>;
  return (
    <div className="hr-panel hr-grid hr-in overflow-x-auto p-3">
      <ul role="tree" aria-label={t('perf.goals.tree')} className="flex min-w-[560px] flex-col gap-1">
        {rows.map(({ node: n, depth }) => (
          <li key={n.id} role="treeitem" aria-expanded={n.children > 0 ? !closed.has(n.id) : undefined} aria-level={depth + 1} className="flex items-center gap-2" style={{ paddingLeft: depth * 22 }}>
            {n.children > 0 ? (
              <button type="button" aria-label={closed.has(n.id) ? t('perf.goals.expand') : t('perf.goals.collapse')} onClick={() => setClosed((s) => { const x = new Set(s); if (x.has(n.id)) x.delete(n.id); else x.add(n.id); return x; })} className="hr-focus hit flex size-6 shrink-0 items-center justify-center rounded-[3px] text-[var(--hr-muted)] hover:bg-[var(--hr-hover)] hover:text-[var(--hr-ink)]">
                {closed.has(n.id) ? <ChevronRight size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
              </button>
            ) : (
              <span className="size-6 shrink-0" />
            )}
            <a href={`#/performance/goals/${n.id}`} className={cn('hr-focus flex min-h-10 min-w-0 flex-1 items-center gap-3 rounded-[var(--hr-radius-sm)] border bg-[var(--hr-raised)] px-3 py-2 transition-colors hover:border-[var(--hr-line-2)] hover:bg-[var(--hr-hover)]', n.scope === 'company' ? 'border-[var(--hr-ink-2)]' : 'border-[var(--hr-line)]')}>
              <Tag tone={n.scope === 'company' ? 'neutral' : 'faint'}>{t(`perf.goal.scope.${n.scope}`)}</Tag>
              <span className="hr-wrap min-w-0 flex-1 text-[13px] font-medium">{n.title}</span>
              <span className="hidden truncate text-[12px] text-[var(--hr-muted)] md:block">{n.owner !== null ? n.owner.name : n.department}</span>
              <ProgressBar value={n.progress} status={n.status} className="w-[140px] shrink-0" label={n.title} />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element | null {
  const [csv, setCsv] = useState('');
  const [check, setCheck] = useState<{ ok: boolean; goals: number; rows: number; problems: { row: number; message: string }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setCsv('');
      setCheck(null);
    }
  }, [open]);
  if (!open) return null;
  const run = async (commit: boolean): Promise<void> => {
    setBusy(true);
    try {
      if (!commit) setCheck(await op('goals.import-check', { csv }));
      else {
        const r = await op<{ imported: number }>('goals.import', { csv });
        changed(...READS.goals);
        toast.success(tn('perf.goals.imported', r.imported));
        onClose();
      }
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      width={620}
      title={t('perf.goals.import')}
      footer={
        <>
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          {check !== null && check.ok ? (
            <Button variant="primary" busy={busy} onClick={() => void run(true)}>
              {tn('perf.goals.import_n', check.goals)}
            </Button>
          ) : (
            <Button variant="primary" busy={busy} disabled={csv.trim() === ''} onClick={() => void run(false)}>
              {t('perf.goals.check')}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('perf.goals.csv')} hint={t('perf.goals.csv_hint')}>
          <Textarea value={csv} onChange={(e) => (setCsv(e.target.value), setCheck(null))} minRows={6} maxRows={14} className="hr-mono text-[12px]" placeholder="employee,title,due,kr_title,kr_target,kr_unit" />
        </Field>
        {check !== null && (check.ok ? <Notice tone="good">{t('perf.goals.check_ok', { goals: check.goals, rows: check.rows })}</Notice> : (
          <Notice tone="bad">
            <ul className="flex flex-col gap-0.5">
              {check.problems.slice(0, 12).map((p, i) => (
                <li key={i}>{t('perf.goals.row_problem', { row: p.row, message: p.message })}</li>
              ))}
            </ul>
          </Notice>
        ))}
      </div>
    </Dialog>
  );
}

