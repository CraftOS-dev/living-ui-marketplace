/**
 * People (kernel): the directory, the org chart, hiring and the employee
 * profile. In the sidebar, People expands to its departments (with an
 * inline "+" to hire into one) and the org chart.
 */
import { useMemo } from 'react';
import type { NavChild, NavTree, ProfileTab, RouteDef } from '../../lib/contract.ts';
import { can, useMe } from '../../lib/auth.tsx';
import { t } from '../../lib/i18n.ts';
import { navigate } from '../../lib/router.ts';
import { useUi } from '../../lib/store.tsx';
import { departmentOutline, useDepartments } from './data.ts';
import { DirectoryPage } from './Directory.tsx';
import { HirePage } from './Hire.tsx';
import { OrgChartPage } from './OrgChart.tsx';
import { ProfilePage } from './Profile.tsx';
import { PersonPrint } from './Print.tsx';
import { BankApprovalView } from './ApprovalViews.tsx';

export const routes: RouteDef[] = [
  { path: '/people', page: DirectoryPage, title: t('people.title'), perm: 'people:view|team' },
  { path: '/people/org', page: OrgChartPage, title: t('org.title'), perm: 'people:view|team' },
  { path: '/people/new', page: HirePage, title: t('hire.title'), perm: 'people:full' },
  { path: '/people/:id', page: ProfilePage, title: t('people.profile') },
  { path: '/print/people/:id', page: PersonPrint, title: t('print.person'), frame: 'print' },
];

export const nav: NavChild[] = [{ key: 'org', label: t('org.title'), to: '/people/org', perm: 'people:view|team' }];

/** Departments under People, each with "+" to hire into it. */
export function useNavTree(): NavTree | null {
  const me = useMe();
  const { entity } = useUi();
  const list = useDepartments(entity);
  const hire = can(me, 'people', 'full');
  return useMemo(() => {
    if (list === null || !can(me, 'people', 'view')) return null;
    return {
      children: departmentOutline(list)
        .filter((x) => x.depth === 0)
        .map(({ dept }) => ({ id: dept.id, label: dept.name, to: `/people?department=${dept.id}`, count: dept.people })),
      onAdd: hire ? () => navigate('/people/new') : undefined,
      addLabel: t('people.hire'),
      addTo: hire ? (id: string) => navigate('/people/new', { department: id }) : undefined,
      addToLabel: t('people.hire_into'),
    };
  }, [list, me, hire]);
}

export const profileTabs: ProfileTab[] = [];

export const approvalViews = { bank_account: BankApprovalView };
