/**
 * Network module (SPEC 7.5, 13.2): the Network page, the Company and Person
 * pages with their own tabs, the Capture section of Settings and Ctrl K
 * "Who knows". A meeting without a note uses the generic Next card. Home
 * takes the Today panel from components/network/Today.tsx.
 *
 * Every page, tab and section loads on first use (lazyPage), so the
 * module adds only this file to the main chunk.
 */
import { Waypoints } from 'lucide-react';
import type { CommandDef, CompanyTab, NavItem, PersonTab, RouteDef, SettingsSection } from '../../lib/contract.ts';
import { lazyPage } from '../../lib/lazy.ts';
import { navigate } from '../../lib/router.ts';

const NetworkPage = lazyPage(() => import('./NetworkPage.tsx'), 'NetworkPage');
const CompanyPage = lazyPage(() => import('./RecordPages.tsx'), 'CompanyPage');
const PersonPage = lazyPage(() => import('./RecordPages.tsx'), 'PersonPage');
const CompanyOverview = lazyPage(() => import('./RecordPages.tsx'), 'CompanyOverview');
const PersonOverview = lazyPage(() => import('./RecordPages.tsx'), 'PersonOverview');
const NetworkTab = lazyPage(() => import('./RecordPages.tsx'), 'NetworkTab');
const CaptureSettings = lazyPage(() => import('../../components/network/CaptureSettings.tsx'), 'CaptureSettings');

export const routes: RouteDef[] = [
  { path: '/network', page: NetworkPage, title: 'Network', perm: 'network:view' },
  { path: '/companies/:id', page: CompanyPage, title: 'Company', perm: 'network:view' },
  { path: '/people/:id', page: PersonPage, title: 'Person', perm: 'network:view' },
];

export const nav: NavItem = { key: 'network', label: 'Network', icon: Waypoints, path: '/network', order: 70, perm: 'network:view' };

export const companyTabs: CompanyTab[] = [
  { key: 'overview', label: 'Overview', order: 10, component: CompanyOverview },
  { key: 'network', label: 'Network', order: 20, component: NetworkTab },
];

export const personTabs: PersonTab[] = [
  { key: 'overview', label: 'Overview', order: 10, component: PersonOverview },
  { key: 'network', label: 'Network', order: 20, component: NetworkTab },
];

export const settings: SettingsSection[] = [{ key: 'capture', label: 'Capture', order: 80, component: CaptureSettings }];

export const commands: CommandDef[] = [{ key: 'who-knows', label: 'Who knows', icon: Waypoints, keywords: 'intro path network relationship warm', perm: 'network:view', run: () => navigate('/network', { focus: 1 }) }];
