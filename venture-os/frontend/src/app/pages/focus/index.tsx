/**
 * The Focus page: Next one card at a time (components/Focus.tsx).
 * `#/focus?at=<key>` opens at one item (Home's rows do). Also the kernel's
 * own cards (proposal, draft) and their pages (kernelCards.tsx).
 */
import { Play } from 'lucide-react';
import { Focus } from '../../components/Focus.tsx';
import { PageBody, PageHeader } from '../../components/ui.tsx';
import type { CardRenderer, CommandDef, PageProps, RouteDef } from '../../lib/contract.ts';
import { navigate } from '../../lib/router.ts';
import { lazyPage } from '../../lib/lazy.ts';
import { DraftCard, ProposalCard } from './kernelCards.tsx';

const ProposalPage = lazyPage(() => import('./KernelPages.tsx'), 'ProposalPage');
const DraftPage = lazyPage(() => import('./KernelPages.tsx'), 'DraftPage');

function FocusPage({ query }: PageProps): React.JSX.Element {
  return (
    <>
      <PageHeader title="Next" back="#/" />
      <PageBody className="max-w-[760px]">
        <Focus at={query.get('at') ?? undefined} />
      </PageBody>
    </>
  );
}

export const routes: RouteDef[] = [
  { path: '/focus', page: FocusPage, title: 'Next' },
  { path: '/next/proposal/:id', page: ProposalPage, title: 'Proposal' },
  { path: '/next/draft/:id', page: DraftPage, title: 'Draft' },
];

/** The kernel's own Next cards (kernel-core sends card 'proposal' and 'draft'). */
export const cards: Record<string, CardRenderer> = { proposal: { body: ProposalCard, figures: false }, draft: { body: DraftCard, figures: false } };

export const commands: CommandDef[] = [{ key: 'focus', label: 'Start Next', icon: Play, keywords: 'focus queue', run: () => navigate('/focus') }];
