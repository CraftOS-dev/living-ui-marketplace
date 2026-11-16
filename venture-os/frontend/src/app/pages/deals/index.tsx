/**
 * The deals module (SPEC 7.7): the Deals page (funnel strip, board or
 * table), the deal page and its Overview, Files and Notes tabs, the
 * company Notes tab, the stall Focus card, Settings "Pipelines".
 */
import { KanbanSquare, Rows3 } from 'lucide-react';
import { FilesTab } from '../../components/deals/FilesTab.tsx';
import { NotesTab } from '../../components/deals/NotesTab.tsx';
import { OverviewTab } from '../../components/deals/OverviewTab.tsx';
import { PipelinesSettings } from '../../components/deals/PipelinesSettings.tsx';
import { StallCard } from '../../components/deals/StallCard.tsx';
import type { Deal } from '../../components/deals/types.ts';
import { allowed, useMe } from '../../lib/auth.ts';
import type { CommandDef, CompanyTab, DealTab, NavItem, RecordLike, RouteDef, SettingsSection } from '../../lib/contract.ts';
import { navigate } from '../../lib/router.ts';
import { DealPage, useCanEdit } from './DealPage.tsx';
import { DealsPage } from './DealsPage.tsx';

function Overview({ deal }: { deal: RecordLike }): React.JSX.Element {
  const d = deal as unknown as Deal;
  return <OverviewTab deal={d} canWrite={useCanEdit(d)} />;
}

function Files({ deal }: { deal: RecordLike }): React.JSX.Element {
  const d = deal as unknown as Deal;
  return <FilesTab dealId={d.id} canWrite={useCanEdit(d)} />;
}

function Notes({ deal }: { deal: RecordLike }): React.JSX.Element {
  const d = deal as unknown as Deal;
  return <NotesTab home={{ deal: { id: d.id, stage: d.stage, currency: d.currency } }} canWrite={useCanEdit(d)} />;
}

function CompanyNotes({ company }: { company: RecordLike }): React.JSX.Element {
  const me = useMe();
  return <NotesTab home={{ company: company.id }} canWrite={allowed(me, 'pipeline:edit|portfolio:edit')} />;
}

export const routes: RouteDef[] = [
  { path: '/deals', page: DealsPage, title: 'Deals', dense: true, perm: 'pipeline:view' },
  { path: '/deals/:id', page: DealPage, title: 'Deal' },
];

export const nav: NavItem = { key: 'deals', label: 'Deals', icon: KanbanSquare, path: '/deals', order: 30, perm: 'pipeline:view' };

export const cards = { stall: StallCard };

export const dealTabs: DealTab[] = [
  { key: 'overview', label: 'Overview', order: 10, component: Overview },
  { key: 'files', label: 'Files', order: 70, component: Files },
  { key: 'notes', label: 'Notes', order: 80, component: Notes },
];

export const companyTabs: CompanyTab[] = [{ key: 'notes', label: 'Notes', order: 80, component: CompanyNotes, perm: 'pipeline:view|portfolio:view' }];

export const settings: SettingsSection[] = [{ key: 'pipelines', label: 'Pipelines', order: 40, component: PipelinesSettings, perm: 'settings:edit' }];

export const commands: CommandDef[] = [
  { key: 'deals-board', label: 'Deal board', icon: KanbanSquare, keywords: 'pipeline kanban stages', perm: 'pipeline:view', run: () => navigate('/deals') },
  { key: 'deals-table', label: 'Deals table', icon: Rows3, keywords: 'pipeline list saved views', perm: 'pipeline:view', run: () => navigate('/deals', { view: 'table' }) },
];
