/**
 * People: the directory as compact rows (name, title, department, manager,
 * site, start, status) under a headcount strip, filtered by department
 * (the sidebar tree sets it too), location, status and a search. Scroll
 * loads more. On an empty database it offers the first hire and an import.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, FileUp, Network, Plus, Rows3, UserPlus, Users } from 'lucide-react';
import { Button, DataTable, Empty, LoadError, Loading, PageBody, PageHeader, Picker, SearchInput, Segmented, StatTile, StatusDot } from '../../components/ui.tsx';
import type { Column, Tone } from '../../components/ui.tsx';
import { op, saveText } from '../../lib/api.ts';
import { can, useMe } from '../../lib/auth.tsx';
import type { PageProps } from '../../lib/contract.ts';
import { fmtDay } from '../../lib/format.ts';
import { t, tn } from '../../lib/i18n.ts';
import { useOp } from '../../lib/live.ts';
import { navigate, setQuery } from '../../lib/router.ts';
import { useUi } from '../../lib/store.tsx';
import { departmentOutline, pickItems, useDepartments, useOrgList } from './data.ts';
import { PersonPhoto } from './photo.tsx';
import { FirstPeople } from './Start.tsx';
import type { Directory as Dir, DirectoryRow } from './types.ts';

type Status = 'current' | 'upcoming' | 'former' | 'all';

export const STATUS_TONE: Record<string, Tone> = { active: 'good', on_leave: 'lh', leaving: 'warn', left: 'faint', pre_hire: 'rh', notice: 'warn', ended: 'faint' };

export function statusLabel(s: string): string {
  return t(`people.status.${s}`);
}

const PAGE = 50;

export function DirectoryPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const { entity } = useUi();
  const [q, setQ] = useState(query.get('q') ?? '');
  const [debounced, setDebounced] = useState(q);
  const status = (query.get('status') as Status | null) ?? 'current';
  const department = query.get('department') ?? '';
  const location = query.get('location') ?? '';
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => {
    const h = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(h);
  }, [q]);
  useEffect(() => setLimit(PAGE), [debounced, status, department, location, entity]);

  const params = { q: debounced === '' ? undefined : debounced, status, department: department === '' ? undefined : department, location: location === '' ? undefined : location, entity: entity === '' ? undefined : entity, limit };
  const live = useOp<Dir>('people.directory', params, ['employees', 'employments', 'job_records', 'departments', 'locations'], { name: 'people.directory', keep: true });
  const counts = useOp<Dir>('people.directory', { status: 'current', limit: 1, entity: entity === '' ? undefined : entity }, ['employees', 'employments'], { name: 'people.count.current', keep: true });
  const upcoming = useOp<Dir>('people.directory', { status: 'upcoming', limit: 1, entity: entity === '' ? undefined : entity }, ['employees', 'employments'], { name: 'people.count.upcoming', keep: true });
  const departments = useDepartments(entity);
  const locations = useOrgList('locations', entity).items;
  const dir = live.data;
  const deptName = departments?.find((d) => d.id === department)?.name ?? '';
  const canHire = can(me, 'people', 'full');
  const ent = me.entities.find((e) => e.id === entity) ?? (me.entities.length === 1 ? me.entities[0] : undefined);

  const columns: Column<DirectoryRow>[] = useMemo(
    () => [
      { key: 'name', label: t('people.col.name'), width: 'minmax(220px,2.2fr)', sort: (r) => r.name, phone: 'title', render: (r) => <PersonPhoto employee={r.employee} has={r.photo} name={r.name} sub={r.number} size={26} /> },
      { key: 'title', label: t('people.col.title'), width: 'minmax(140px,1.4fr)', sort: (r) => r.title, render: (r) => r.title },
      { key: 'department', label: t('people.col.department'), width: 'minmax(120px,1.1fr)', sort: (r) => r.department_name, render: (r) => r.department_name },
      { key: 'manager', label: t('people.col.manager'), width: 'minmax(120px,1.1fr)', sort: (r) => r.manager_name, hideBelow: 'lg', render: (r) => r.manager_name },
      { key: 'location', label: t('people.col.location'), width: 'minmax(100px,1fr)', sort: (r) => r.location_name, hideBelow: 'xl', render: (r) => r.location_name },
      { key: 'entity', label: t('people.col.entity'), width: 'minmax(100px,1fr)', sort: (r) => r.entity_name, hideBelow: 'xl', phone: 'hide', render: (r) => r.entity_name },
      { key: 'start', label: t('people.col.start'), width: '124px', mono: true, sort: (r) => r.start_day, hideBelow: 'lg', render: (r) => fmtDay(r.start_day) },
      { key: 'status', label: t('people.col.status'), width: '112px', sort: (r) => r.status, phone: 'end', render: (r) => <StatusDot tone={STATUS_TONE[r.status] ?? 'neutral'} label={statusLabel(r.status)} /> },
    ],
    [],
  );

  const exportCsv = useCallback(async () => {
    try {
      const r = await op<{ csv: string; filename: string }>('people.export', { entity: entity === '' ? undefined : entity, status });
      saveText(r.csv, r.filename);
    } catch {
      /* toast shown */
    }
  }, [entity, status]);

  const filtered = debounced !== '' || department !== '' || location !== '' || status !== 'current';
  const headcount = counts.data?.total ?? 0;
  const meta = [ent?.name ?? t('shell.all_entities_short'), tn('people.meta_count', headcount)].join(' · ');

  return (
    <>
      <PageHeader title={deptName !== '' ? deptName : t('people.title')} meta={meta}>
        <Segmented
          value="list"
          onChange={(v) => v === 'org' && navigate('/people/org', department !== '' ? { department } : undefined)}
          label={t('people.view')}
          options={[
            { value: 'list', label: t('people.list'), icon: Rows3 },
            { value: 'org', label: t('people.org'), icon: Network },
          ]}
          className="hidden sm:inline-flex"
        />
        {canHire && (
          <Button variant="primary" icon={UserPlus} onClick={() => navigate('/people/new', department !== '' ? { department } : undefined)}>
            {t('people.hire')}
          </Button>
        )}
      </PageHeader>
      <PageBody>
        <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile index="01" label={t('people.kpi.headcount')} value={headcount} onClick={() => setQuery({ status: 'current' })} />
          <StatTile index="02" label={t('people.kpi.joining')} value={upcoming.data?.total ?? 0} onClick={() => setQuery({ status: 'upcoming' })} />
          <StatTile index="03" label={t('people.kpi.departments')} value={departments?.length ?? 0} onClick={() => navigate('/settings/org')} />
          <StatTile index="04" label={t('people.kpi.locations')} value={locations?.length ?? 0} onClick={() => navigate('/settings/locations')} />
        </div>
        <div className="hr-panel hr-in min-w-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--hr-line)] px-4 py-2.5">
            <SearchInput value={q} onChange={setQ} placeholder={t('people.search')} className="w-full sm:w-[260px]" />
            <Segmented
              value={status}
              onChange={(v) => setQuery({ status: v === 'current' ? undefined : v })}
              label={t('people.col.status')}
              size="sm"
              options={[
                { value: 'current', label: t('people.f.current') },
                { value: 'upcoming', label: t('people.f.upcoming') },
                { value: 'former', label: t('people.f.former') },
                { value: 'all', label: t('people.f.all') },
              ]}
            />
            <Picker
              value={department}
              onChange={(v) => setQuery({ department: v === '' ? undefined : v })}
              items={departmentOutline(departments ?? []).map(({ dept, depth }) => ({ value: dept.id, label: (depth > 0 ? '  '.repeat(depth) : '') + dept.name, sub: dept.people > 0 ? tn('people.n_people', dept.people) : undefined }))}
              label={t('people.col.department')}
              placeholder={t('people.any_department')}
              clearable
              className="min-w-[140px] flex-1 sm:w-[180px] sm:flex-none"
            />
            <Picker value={location} onChange={(v) => setQuery({ location: v === '' ? undefined : v })} items={pickItems(locations)} label={t('people.col.location')} placeholder={t('people.any_location')} clearable className="min-w-[140px] flex-1 sm:w-[160px] sm:flex-none" />
            <span className="flex-1" />
            <Button size="sm" variant="ghost" icon={Download} onClick={() => void exportCsv()}>
              {t('ui.export')}
            </Button>
            {canHire && (
              <Button size="sm" variant="ghost" icon={FileUp} onClick={() => navigate('/settings/data', { kind: 'people' })}>
                {t('ui.import')}
              </Button>
            )}
          </div>
          {dir === null ? (
            live.error !== null ? (
              <LoadError message={live.error} onRetry={live.reload} />
            ) : (
              <Loading />
            )
          ) : (
            <DataTable
              label={t('people.title')}
              columns={columns}
              rows={dir.people}
              rowKey={(r) => r.employment}
              rowHref={(r) => `#/people/${r.number}`}
              hasMore={dir.total > dir.people.length}
              onMore={() => setLimit((l) => l + PAGE)}
              loadingMore={live.loading}
              empty={
                filtered ? (
                  <Empty icon={Users} title={t('people.none_match')} action={<Button onClick={() => (setQ(''), setQuery({ status: undefined, department: undefined, location: undefined }))}>{t('ui.clear_filters')}</Button>} />
                ) : canHire ? (
                  <FirstPeople />
                ) : (
                  <Empty icon={Users} title={t('people.empty')}>
                    {t('people.empty_text')}
                  </Empty>
                )
              }
            />
          )}
        </div>
      </PageBody>
    </>
  );
}
