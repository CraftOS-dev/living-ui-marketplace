/**
 * Committee module (SPEC 7.9): the Committee page and the meeting room, the
 * deal page's IC tab (decision and memo), the Committee settings section and
 * the Focus cards for votes, decisions and drafted memo sections.
 */
import { Gavel, Plus } from 'lucide-react';
import type { CardRenderer, CommandDef, DealTab, NavItem, RecordLike, RouteDef, SettingsSection } from '../../lib/contract.ts';
import { navigate } from '../../lib/router.ts';
import { DecideCard, MemoDraftsCard, VoteCard } from '../../components/committee/cards.tsx';
import { CommitteePage } from './CommitteePage.tsx';
import { CommitteeSettings } from './CommitteeSettings.tsx';
import { IcTab } from './IcTab.tsx';
import { installIcLinks } from './links.ts';
import { MeetingRoom } from './MeetingRoom.tsx';

export const routes: RouteDef[] = [
  { path: '/committee', page: CommitteePage, title: 'Committee', perm: 'committee:view' },
  { path: '/committee/:id', page: MeetingRoom, title: 'Meeting', perm: 'committee:view' },
];

export const nav: NavItem = { key: 'committee', label: 'Committee', icon: Gavel, path: '/committee', order: 40, count: { kinds: ['vote'] }, perm: 'committee:view' };

export const cards: Record<string, CardRenderer> = {
  vote: VoteCard,
  decide: { body: DecideCard, figures: false },
  memo_drafts: MemoDraftsCard,
};

/** One tab (SPEC U8): the latest decision on top, the memo below. Old ?tab=memo and ?tab=decision links open it. */
/** Fund-raise prospects are LPs, not startups: no diligence checklist or IC memo. */
const notLpRaise = ({ deal }: { deal: RecordLike }): boolean => {
  const p = (deal as Record<string, unknown>).pipeline as { kind?: string } | string | undefined;
  return (typeof p === 'string' ? p : p?.kind) !== 'lp_raise';
};

export const dealTabs: DealTab[] = [{ key: 'ic', label: 'IC', order: 30, component: IcTab, perm: 'committee:view|pipeline:view', show: notLpRaise }];

installIcLinks();

export const settings: SettingsSection[] = [{ key: 'committee', label: 'Committee', order: 65, component: CommitteeSettings, perm: 'committee:view' }];

export const commands: CommandDef[] = [{ key: 'committee-room', label: 'Next meeting', icon: Plus, keywords: 'committee ic meeting vote', perm: 'committee:view', run: () => navigate('/committee') }];
