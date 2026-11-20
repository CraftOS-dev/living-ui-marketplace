/**
 * The market map board (fix 3): segments as columns of company tiles on the
 * kernel Board (sorted inside a segment and moved between segments, with
 * the shadow placeholder, the Move menu and Alt+Arrow keys). Each tile says
 * who it is and its relation to the firm in words, in that relation's
 * colour; the legend above names all five, always.
 */
import { Check } from 'lucide-react';
import { Board, type BoardColumn } from '../ui.tsx';
import { cn } from '../../../kit/index.ts';
import type { MapEntry, Relation } from './types.ts';
import { RELATION_HELP, RELATION_WORD, RELATIONS, word } from './types.ts';

export const REL_DOT: Record<Relation, string> = { portfolio: 'var(--vo-a)', pipeline: 'var(--vo-b)', passed: 'var(--vo-line-2)', tracked: 'var(--vo-ink-2)', competitor: 'var(--vo-warn)' };
const REL_TEXT: Record<Relation, string> = { portfolio: 'text-[var(--vo-a)]', pipeline: 'text-[var(--vo-b)]', passed: 'text-[var(--vo-muted)]', tracked: 'text-[var(--vo-ink-2)]', competitor: 'text-[var(--vo-warn)]' };

/** All five relations, always (what a colour means never depends on the map). */
export function RelationLegend(): React.JSX.Element {
  return (
    <div role="list" aria-label="What the colours mean" className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-[var(--vo-ink-2)]">
      {RELATIONS.map((r) => (
        <span key={r} role="listitem" title={RELATION_HELP[r]} className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: REL_DOT[r] }} />
          {RELATION_WORD[r]}
        </span>
      ))}
    </div>
  );
}

/** A tile: the company, then its relation in words ("In pipeline: Diligence"). */
function TileBody({ e, selecting, on }: { e: MapEntry; selecting: boolean; on: boolean }): React.JSX.Element {
  const rel = RELATION_WORD[e.relation] + (e.relation === 'pipeline' && e.deal !== null && e.deal.stage !== '' ? `: ${word(e.deal.stage)}` : '');
  return (
    <span data-map-tile={e.id} className="flex min-w-0 items-start gap-2 pr-5">
      {selecting && (
        <span aria-hidden className={cn('mt-[3px] flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border', on ? 'border-[var(--vo-ink)] bg-[var(--vo-ink)] text-[var(--vo-on-ink)]' : 'border-[var(--vo-line-2)]')}>
          {on && <Check size={10} strokeWidth={3} />}
        </span>
      )}
      <span aria-hidden className="mt-[5px] size-2.5 shrink-0 rounded-[3px]" style={{ background: REL_DOT[e.relation] }} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="vo-wrap text-[13px] font-medium leading-[18px] text-[var(--vo-ink)]">{e.company?.name ?? ''}</span>
        <span className={cn('truncate text-[12px] leading-4', REL_TEXT[e.relation])}>{rel}</span>
      </span>
    </span>
  );
}

export type BoardMode = 'edit' | 'select' | 'read';

export function MapBoard({
  segments,
  entries,
  mode,
  selected,
  onToggle,
  onMove,
  onOpenTile,
}: {
  segments: { key: string; label: string }[];
  entries: MapEntry[];
  mode: BoardMode;
  selected: Set<string>;
  onToggle: (companyId: string) => void;
  onMove: (entry: MapEntry, segment: string, index: number) => Promise<unknown>;
  onOpenTile: (entry: MapEntry, anchor: HTMLElement) => void;
}): React.JSX.Element {
  const columns: BoardColumn<MapEntry>[] = segments.map((s) => ({
    key: s.key,
    label: s.label,
    items: entries.filter((e) => e.segment === s.key).sort((a, b) => a.position - b.position),
  }));
  const byId = new Map(entries.map((e) => [e.id, e]));
  const anchorOf = (id: string): HTMLElement | null => {
    const el = document.querySelector<HTMLElement>(`[data-map-tile="${id}"]`);
    return (el?.closest<HTMLElement>('[data-vo-board-card]') ?? el?.closest<HTMLElement>('[data-stub-card]') ?? el) || null;
  };
  return (
    <Board<MapEntry>
      label="Market map"
      columns={columns}
      itemKey={(e) => e.id}
      cardLabel={(e) => e.company?.name ?? 'Company'}
      renderCard={(e) => <TileBody e={e} selecting={mode === 'select'} on={selected.has(e.company?.id ?? e.id)} />}
      onMove={
        mode === 'edit'
          ? (id, to, index) => {
              const e = byId.get(id);
              return e === undefined ? Promise.resolve() : onMove(e, to, index);
            }
          : undefined
      }
      onOpen={(e) => {
        if (mode === 'select') {
          onToggle(e.company?.id ?? e.id);
          return;
        }
        const a = anchorOf(e.id);
        if (a !== null) onOpenTile(e, a);
      }}
    />
  );
}
