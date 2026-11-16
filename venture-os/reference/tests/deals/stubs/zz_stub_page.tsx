/**
 * SCRATCH ONLY (never shipped): stand-ins for other modules' registry
 * exports the deals pages meet: intake's Add deal (primary) and the deal
 * tabs of diligence, committee and portfolio, so screenshots show the deal
 * page as partners will see it.
 */
import { CircleCheck, ClipboardList, FileSignature, Gavel, Plus } from 'lucide-react';
import { Empty } from '../../components/ui.tsx';
import type { DealTab, PrimaryAction, RecordLike } from '../../lib/contract.ts';

const stub = (icon: typeof Plus, title: string) =>
  function Stub(): React.JSX.Element {
    return <Empty icon={icon} title={title} />;
  };

const later = (d: RecordLike): boolean => ['term_sheet', 'closed'].includes(String(d['stage'])) || d['status'] === 'invested';

export const primary: PrimaryAction = { label: 'Add deal', icon: Plus, run: () => window.dispatchEvent(new CustomEvent('zz-add-deal')) };

export const dealTabs: DealTab[] = [
  { key: 'diligence', label: 'Diligence', order: 20, component: stub(ClipboardList, 'Diligence stub') },
  { key: 'memo', label: 'Memo', order: 30, component: stub(FileSignature, 'Memo stub') },
  { key: 'decision', label: 'Decision', order: 40, component: stub(Gavel, 'Decision stub'), show: ({ deal }) => !later(deal) },
  { key: 'investment', label: 'Investment', order: 50, component: stub(CircleCheck, 'Investment stub'), show: ({ deal }) => later(deal) },
];
