/**
 * Focus card body `answers` (NextItem kind verify from diligence): the
 * answers your AI agent proposed for one deal (or one grid), one row each in
 * the tab's layout (the question above its answer, grade and source, Reject
 * and Confirm). The frame's one primary action is Confirm all (its chips ask
 * High grade or All when only some are high grade); the figures stay off the
 * card (the rows are the result). A citation opens the reader at the page.
 */
import { useState } from 'react';
import type { CardProps } from '../../lib/contract.ts';
import type { Grade } from '../ui.tsx';
import { ReaderSheet } from './Reader.tsx';
import { CheckRow, decide, shown } from './parts.tsx';
import type { CheckItem } from './parts.tsx';
import type { Cite, QType, Raw, ReadTarget } from './types.ts';

interface CardAnswer {
  id: string;
  question: string;
  text: string;
  value: string;
  type: QType;
  raw: Raw;
  unit: string;
  grade: Grade;
  high: boolean;
  num_kind: string;
  formula: string;
  quote: string;
  hidden: boolean;
  anchor: string;
  file: string;
  file_name: string;
  page: number;
  source: string;
}

const READS = ['*'];

function itemOf(a: CardAnswer): CheckItem {
  const cite: Cite | null = a.anchor !== '' ? { anchor: a.anchor, file: a.file, file_name: a.file_name, page: a.page, quote: a.hidden ? null : a.quote, nda: a.hidden, hidden: a.hidden } : null;
  return { id: a.id, question: a.text, type: a.type, value: a.value, raw: a.raw, unit: a.unit, formula: a.formula, grade: a.grade, cites: cite !== null ? [cite] : [], sources: a.source !== '' ? [a.source] : [] };
}

export function AnswersCard({ item }: CardProps): React.JSX.Element {
  const list = Array.isArray(item.data?.['answers']) ? (item.data['answers'] as CardAnswer[]) : [];
  const [gone, setGone] = useState<Record<string, boolean>>({});
  const [reading, setReading] = useState<ReadTarget | null>(null);
  const left = list.filter((a) => gone[a.id] !== true);
  const one = async (a: CardAnswer, confirm: boolean): Promise<void> => {
    setGone((g) => ({ ...g, [a.id]: true }));
    if (!(await decide(a.id, confirm, READS))) setGone((g) => ({ ...g, [a.id]: false }));
  };
  if (left.length === 0) return <span className="text-[13px] text-[var(--vo-muted)]">All decided</span>;
  return (
    <div className="flex min-w-0 flex-col">
      <ul className="vo-scroll -mx-4 max-h-[420px] min-w-0 divide-y divide-[var(--vo-hair)] overflow-y-auto">
        {left.map((a) => (
          <CheckRow key={a.id} item={itemOf(a)} onDecide={(c) => void one(a, c)} onOpen={(c) => setReading({ cite: c, question: a.text, answer: { id: a.id, value: shown(a), status: 'agent_proposed', grade: a.grade } })} />
        ))}
      </ul>
      <ReaderSheet target={reading} onClose={() => setReading(null)} />
    </div>
  );
}
