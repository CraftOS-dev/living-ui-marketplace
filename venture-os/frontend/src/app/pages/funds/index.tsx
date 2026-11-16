/**
 * The funds module's registrations (SPEC 13.2): the Funds place, its pages
 * (the fund, an LP, a call or distribution, the fund raise), the Focus card
 * bodies for marks and payments, the Fund terms settings section and the
 * Ctrl K commands.
 */
import { Handshake, Landmark, Plus } from 'lucide-react';
import type { CardRenderer, CommandDef, NavItem, RouteDef, SettingsSection } from '../../lib/contract.ts';
import { navigate } from '../../lib/router.ts';
import { FundsPage } from '../../components/funds/FundsPage.tsx';
import { EventPage } from '../../components/funds/EventPage.tsx';
import { LpPage } from '../../components/funds/LpPage.tsx';
import { RaisePage } from '../../components/funds/RaisePage.tsx';
import { FundTerms } from '../../components/funds/FundTerms.tsx';
import { MarksCard, PaymentCard } from '../../components/funds/cards.tsx';

export const routes: RouteDef[] = [
  { path: '/funds', page: FundsPage, title: 'Funds', perm: 'funds:view' },
  { path: '/funds/raise', page: RaisePage, title: 'Fund raise', perm: 'lps:view', dense: true },
  { path: '/funds/lps/:id', page: LpPage, title: 'LP', perm: 'lps:view' },
  { path: '/funds/:fund', page: FundsPage, title: 'Funds', perm: 'funds:view' },
  { path: '/funds/:fund/events/:event', page: EventPage, title: 'Notice', perm: 'funds:view' },
];

export const nav: NavItem = {
  key: 'funds',
  label: 'Funds',
  icon: Landmark,
  path: '/funds',
  order: 60,
  perm: 'funds:view',
  children: [{ key: 'raise', label: 'Fund raise', path: '/funds/raise' }],
};

export const cards: Record<string, CardRenderer> = {
  marks: MarksCard,
  payment: PaymentCard,
};

export const settings: SettingsSection[] = [{ key: 'fund_terms', label: 'Fund terms', order: 22, component: FundTerms, perm: 'funds:view' }];

export const commands: CommandDef[] = [
  { key: 'funds-new-call', label: 'New call', icon: Plus, keywords: 'capital call notice LP', perm: 'funds:edit', run: () => navigate('/funds', { new: 'call' }) },
  { key: 'funds-raise', label: 'Fund raise', icon: Handshake, keywords: 'LP prospects fundraising', perm: 'lps:view', run: () => navigate('/funds/raise') },
];
