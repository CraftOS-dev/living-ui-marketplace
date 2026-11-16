/**
 * Diligence (SPEC 7.8): the deal page's Diligence tab, the comparison grid
 * page, the Focus card for answers to check and the Settings section for
 * checklists.
 *
 * Other modules: deals makes a grid from a table selection with
 * compareDeals(ids); markets shows CompareGrid and makes grids with
 * compareCompanies(ids, 'markets', mapId) (components/diligence/*).
 */
import type { CardRenderer, DealTab, RecordLike, RouteDef, SettingsSection } from '../../lib/contract.ts';
import { AnswersCard } from '../../components/diligence/AnswersCard.tsx';
import { DiligenceTab } from '../../components/diligence/DiligenceTab.tsx';
import { TemplatesSettings } from '../../components/diligence/TemplatesSettings.tsx';
import { ComparePage } from './Compare.tsx';

export const routes: RouteDef[] = [{ path: '/compare/:id', page: ComparePage, title: 'Grid', perm: 'diligence:view|markets:view', dense: true }];

/** Fund-raise prospects are LPs, not startups: no diligence checklist or IC memo. */
const notLpRaise = ({ deal }: { deal: RecordLike }): boolean => {
  const p = (deal as Record<string, unknown>).pipeline as { kind?: string } | string | undefined;
  return (typeof p === 'string' ? p : p?.kind) !== 'lp_raise';
};

export const dealTabs: DealTab[] = [{ key: 'diligence', label: 'Diligence', order: 20, perm: 'diligence:view', component: ({ deal }) => <DiligenceTab dealId={deal.id} />, show: notLpRaise }];

/** The rows are the result: the frame leaves out its figure strip (it would repeat the counts). */
export const cards: Record<string, CardRenderer> = { answers: { body: AnswersCard, figures: false } };

export const settings: SettingsSection[] = [{ key: 'diligence', label: 'Diligence', order: 62, perm: 'diligence:view', component: TemplatesSettings }];
