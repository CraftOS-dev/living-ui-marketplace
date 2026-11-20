/**
 * Intake (SPEC 7.6, 13.2): the Inbox page, the sidebar's Add deal, decks
 * dropped anywhere, the Focus card for verdicts and the Intake settings.
 */
import { FileSpreadsheet, Inbox, Plus } from 'lucide-react';
import type { CardRenderer, CommandDef, DropHandler, NavItem, PrimaryAction, RouteDef, SettingsSection } from '../../lib/contract.ts';
import { addDeck, openAddDeal, openImport } from '../../components/intake/addDeal.tsx';
import { IntakeSettings } from '../../components/intake/Settings.tsx';
import { TriageCard } from '../../components/intake/TriageCard.tsx';
import { isDeck } from '../../components/intake/types.ts';
import { InboxPage } from './Inbox.tsx';

export const routes: RouteDef[] = [{ path: '/inbox', page: InboxPage, title: 'Inbox', perm: 'intake:view' }];

export const nav: NavItem = { key: 'inbox', label: 'Inbox', icon: Inbox, path: '/inbox', order: 20, count: { kinds: ['verdict', 'stall'] }, perm: 'intake:view' };

/** The sidebar's black button: Add deal (one drop). */
export const primary: PrimaryAction = { label: 'Add deal', icon: Plus, run: openAddDeal, perm: 'intake:edit' };

/** A deck dropped or pasted anywhere becomes a new deal in the Inbox. */
export const drops: DropHandler[] = [
  {
    key: 'intake.deck',
    label: 'New deal',
    order: 50,
    accepts: (i) => i.files.length > 0 && i.files.some((f) => /\.(pdf|pptx?|key)$/i.test(f.name)),
    handle: async (i) => {
      const n = await addDeck(i.files.filter(isDeck));
      return n !== '' ? '#/inbox?item=' + n : '#/inbox';
    },
  },
];

export const cards: Record<string, CardRenderer> = { triage: { body: TriageCard, figures: false } };

export const settings: SettingsSection[] = [{ key: 'intake', label: 'Intake', order: 45, component: IntakeSettings, perm: 'intake:view' }];

export const commands: CommandDef[] = [
  { key: 'intake.add', label: 'Add deal', icon: Plus, keywords: 'deck new inbound upload', perm: 'intake:edit', run: openAddDeal },
  { key: 'intake.import', label: 'Import a deal list', icon: FileSpreadsheet, keywords: 'csv xlsx spreadsheet', perm: 'intake:edit', run: openImport },
];
