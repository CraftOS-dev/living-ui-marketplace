/**
 * The people directory: everyone as a card (photo or initials, name, job,
 * department, manager, status), department chips with counts, search, and
 * a status filter. "Add person" opens the form (?new=1 too); departments
 * are managed in their own dialog.
 */
import { useEffect, useState } from 'react';
import { Building, ChevronRight, Network, UserPlus, Users } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { Chips, SearchBox, useDebounced } from '../../components/controls.tsx';
import { EMPLOYEE_STATUS, PersonAvatar } from '../../components/people/common.tsx';
import { DepartmentsModal } from '../../components/people/Departments.tsx';
import { EmployeeForm } from '../../components/people/EmployeeForm.tsx';
import { Pager } from '../../components/table.tsx';
import { Card, Empty, LoadError, PageHeader, PillButton, PillSelect, Skeleton, StatusPill } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { plural } from '../../lib/format.ts';
import { useLive } from '../../lib/live.ts';
import { baseCurrency, can, useMe } from '../../lib/me.ts';
import { navigate, replaceQuery } from '../../lib/router.ts';
import type { Employee, EmployeeList } from '../../lib/types/people.ts';
import type { PageProps } from '../../routes.tsx';

const LIMIT = 60;
type StatusFilter = 'current' | 'active' | 'on_leave' | 'left' | 'all';

function PersonCard({ e, delay }: { e: Employee; delay: number }): React.JSX.Element {
  const st = EMPLOYEE_STATUS[e.status];
  return (
    <button
      type="button"
      onClick={() => navigate('employee', { id: e.id })}
      className={cn('erp-rise flex w-full min-w-0 flex-col gap-3 rounded-[22px] bg-[var(--erp-card)] p-3 text-left transition-transform active:scale-[0.99] @min-[480px]:p-4', `erp-d${Math.min(5, delay)}`)}
    >
      <span className="flex w-full min-w-0 items-center gap-3">
        <PersonAvatar name={e.name} photo={e.photo} size={52} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-bold leading-[22px]">{e.name}</span>
          <span className="block truncate text-[13px] text-[var(--erp-ink-2)]">{e.job_title !== '' ? e.job_title : 'No job title'}</span>
        </span>
        {e.status !== 'active' && st !== undefined && (
          <StatusPill tone={st.tone} size="sm">
            {st.label}
          </StatusPill>
        )}
        <ChevronRight size={16} aria-hidden className="shrink-0 text-[var(--erp-muted)] @min-[480px]:hidden" />
      </span>
      <span className="hidden w-full min-w-0 items-center gap-2 border-t border-[var(--erp-line)] pt-3 text-[12px] text-[var(--erp-muted)] @min-[480px]:flex">
        {e.department !== null ? <span className="shrink-0 rounded-full bg-[var(--erp-row)] px-2.5 py-0.5 font-semibold text-[var(--erp-ink-2)]">{e.department.name}</span> : <span className="shrink-0">No department</span>}
        <span className="min-w-0 flex-1 truncate text-right">
          {(e.reports ?? 0) > 0 ? <span className="font-semibold text-[var(--erp-ink-2)]">{plural(e.reports ?? 0, 'report')}</span> : e.manager !== null ? `Reports to ${e.manager.name}` : 'Top of the chart'}
        </span>
      </span>
    </button>
  );
}

export function EmployeesPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const [q, setQ] = useState(query.get('q') ?? '');
  const dq = useDebounced(q.trim(), 250);
  const dept = query.get('dept') ?? 'all';
  const status = (query.get('status') ?? 'current') as StatusFilter;
  const [offset, setOffset] = useState(0);
  const [adding, setAdding] = useState(query.get('new') !== null);
  const [depts, setDepts] = useState(false);

  useEffect(() => {
    if (query.get('new') !== null) setAdding(true);
  }, [query]);
  useEffect(() => setOffset(0), [dq, dept, status]);

  const live = useLive(
    () => op<EmployeeList>('employees.list', { q: dq === '' ? undefined : dq, department: dept === 'all' ? undefined : dept === 'none' ? 'none' : dept, status, limit: LIMIT, offset }, { quiet: true }),
    ['employees', 'departments'],
    [dq, dept, status, offset],
  );
  const d = live.data;
  const setQuery = (patch: Record<string, string | undefined>): void => replaceQuery('employees', { dept: dept === 'all' ? undefined : dept, status: status === 'current' ? undefined : status, ...patch });
  const closeAdd = (): void => {
    setAdding(false);
    if (query.get('new') !== null) setQuery({ new: undefined });
  };
  const deptCount = d?.counts.departments.filter((x) => x.id !== '').length ?? 0;
  const people = d !== null ? d.counts.status.active + d.counts.status.on_leave : 0;

  return (
    <div>
      <PageHeader
        title="People"
        subtitle={d !== null ? `${plural(people, 'person', 'people')} in ${plural(deptCount, 'department')}${d.counts.status.on_leave > 0 ? `, ${d.counts.status.on_leave} on leave` : ''}` : undefined}
        actions={
          <>
            {can(me, 'people') && (
              <PillButton variant="light" icon={Building} onClick={() => setDepts(true)}>
                Departments
              </PillButton>
            )}
            <PillButton variant="light" icon={Network} onClick={() => navigate('org')}>
              Org chart
            </PillButton>
            {d?.can.add === true && (
              <PillButton icon={UserPlus} dot onClick={() => setAdding(true)}>
                Add person
              </PillButton>
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-col gap-3 @min-[480px]:flex-row @min-[480px]:items-center">
        <SearchBox value={q} onChange={setQ} placeholder="Search name, job, email or number" ariaLabel="Search people" className="@min-[480px]:max-w-md @min-[480px]:flex-1" />
        <PillSelect
          value={status}
          onChange={(v) => setQuery({ status: v === 'current' ? undefined : v })}
          ariaLabel="Status"
          className="@min-[480px]:w-48"
          options={[
            { value: 'current', label: 'Current staff' },
            { value: 'active', label: 'Active' },
            { value: 'on_leave', label: 'On leave' },
            { value: 'left', label: 'Left' },
            { value: 'all', label: 'Everyone' },
          ]}
        />
      </div>
      {d !== null && d.counts.departments.length > 1 && (
        <Chips
          ariaLabel="Department"
          className="mb-5"
          value={dept}
          onChange={(v) => setQuery({ dept: v === 'all' ? undefined : v })}
          options={[
            { value: 'all', label: 'All', count: people },
            ...d.counts.departments.map((x) => ({ value: x.id === '' ? 'none' : x.id, label: x.name, count: x.count })),
          ]}
        />
      )}

      {live.error !== null && d === null ? (
        <LoadError message={live.error} onRetry={live.reload} />
      ) : d === null ? (
        <div className="grid grid-cols-1 gap-3 @min-[480px]:grid-cols-2 @min-[900px]:grid-cols-3 @min-[1300px]:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-[76px] @min-[480px]:h-[126px]" rounded="rounded-[22px]" />
          ))}
        </div>
      ) : d.employees.length === 0 ? (
        <Card>
          <Empty
            icon={Users}
            title={dq !== '' ? 'Nobody matches' : 'Nobody here yet'}
            action={
              d.can.add && dq === '' ? (
                <PillButton icon={UserPlus} dot onClick={() => setAdding(true)}>
                  Add person
                </PillButton>
              ) : undefined
            }
          >
            {dq !== '' ? `No one matches "${dq}".` : 'People you add show here with their job, department and manager.'}
          </Empty>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-2 @min-[480px]:grid-cols-2 @min-[480px]:gap-3 @min-[900px]:grid-cols-3 @min-[1300px]:grid-cols-4">
            {d.employees.map((e, i) => (
              <PersonCard key={e.id} e={e} delay={Math.floor(i / 4) + 1} />
            ))}
          </div>
          <Pager offset={offset} limit={LIMIT} total={d.total} onChange={setOffset} />
        </>
      )}

      <EmployeeForm open={adding} onClose={closeAdd} employee={null} canPay={d?.can.pay === true} currency={baseCurrency(me)} onSaved={(e) => navigate('employee', { id: e.id })} />
      {depts && <DepartmentsModal open={depts} onClose={() => setDepts(false)} />}
    </div>
  );
}
