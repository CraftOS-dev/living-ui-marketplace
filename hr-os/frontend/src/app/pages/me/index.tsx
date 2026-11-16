/**
 * Me (home-reports module): the employee self-service hub that the phone
 * bottom bar's "Me" opens, with my profile (personal details, emergency
 * contacts, address, bank change requests, tax details, kiosk PIN), my
 * documents, my requests across every module, the company directory and my
 * questions to your AI agent. Pay, tasks, goals and the handbook open the
 * modules' own pages, which serve the person their own view.
 */
import type { NavChild, RouteDef } from '../../lib/contract.ts';
import { t } from '../../lib/i18n.ts';
import { MeAskPage, MeDirectoryPage, MeDocumentsPage, MeHubPage, MeProfilePage, MeRequestsPage } from './Pages.tsx';

export const routes: RouteDef[] = [
  { path: '/me', page: MeHubPage, title: t('me.title') },
  { path: '/me/profile', page: MeProfilePage, title: t('me.profile.title') },
  { path: '/me/documents', page: MeDocumentsPage, title: t('me.documents.title') },
  { path: '/me/requests', page: MeRequestsPage, title: t('me.requests') },
  { path: '/me/directory', page: MeDirectoryPage, title: t('me.directory.title') },
  { path: '/me/ask', page: MeAskPage, title: t('me.ask.title') },
];

export const nav: NavChild[] = [
  { key: 'profile', label: t('me.place.profile'), to: '/me/profile', perm: 'employee' },
  { key: 'requests', label: t('me.place.requests'), to: '/me/requests', perm: 'employee' },
  { key: 'documents', label: t('me.place.documents'), to: '/me/documents', perm: 'employee' },
  { key: 'directory', label: t('me.place.directory'), to: '/me/directory' },
];
