/**
 * Focus mode's body for an intake verdict (NextItem.card 'triage'): the same
 * card as the Inbox's, without its header and buttons (the Focus frame draws
 * the title, the chips and Advance / Pass / Hold).
 */
import type { CardProps } from '../../lib/contract.ts';
import { DeckSheet } from './DeckPage.tsx';
import { ItemCard } from './ItemCard.tsx';

export function TriageCard({ item }: CardProps): React.JSX.Element | null {
  const id = typeof item.data?.['item'] === 'string' ? item.data['item'] : '';
  if (id === '') return null;
  return (
    <>
      <ItemCard id={id} compact />
      <DeckSheet />
    </>
  );
}
