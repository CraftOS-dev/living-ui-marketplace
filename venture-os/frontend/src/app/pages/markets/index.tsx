/**
 * Markets module (SPEC 7.12, 13.2; fix 4): the Markets page (News, Overview,
 * Sectors, Theses, Research: /markets/<area>[/<sector or brief>]) and its thesis routes,
 * the sidebar place, the Focus card for a radar run's candidates, the
 * Sourcing settings section and the New thesis command.
 */
import { Plus, Radar } from 'lucide-react';
import { CandidatesCard } from '../../components/markets/CandidatesCard.tsx';
import { SourcingSettings } from '../../components/markets/SourcingSettings.tsx';
import type { CardRenderer, CommandDef, NavItem, RouteDef, SettingsSection } from '../../lib/contract.ts';
import { navigate } from '../../lib/router.ts';
import { MarketsPage } from './MarketsPage.tsx';

export const routes: RouteDef[] = [
  { path: '/markets', page: MarketsPage, title: 'Markets', perm: 'markets:view' },
  { path: '/markets/:thesis', page: MarketsPage, title: 'Markets', perm: 'markets:view' },
  { path: '/markets/:thesis/:tab', page: MarketsPage, title: 'Markets', perm: 'markets:view' },
];

export const nav: NavItem = { key: 'markets', label: 'Markets', icon: Radar, path: '/markets', order: 80, perm: 'markets:view' };

// The title already counts the candidates (Fintech infra, 7 new), so the card leaves the figure strip out.
export const cards: Record<string, CardRenderer> = { candidates: { body: CandidatesCard, figures: false } };

export const settings: SettingsSection[] = [{ key: 'sourcing', label: 'Sourcing', order: 50, component: SourcingSettings, perm: 'markets:view' }];

export const commands: CommandDef[] = [{ key: 'new-thesis', label: 'New thesis', icon: Plus, keywords: 'markets radar sourcing', perm: 'markets:edit', run: () => navigate('/markets/theses', { new: 1 }) }];
