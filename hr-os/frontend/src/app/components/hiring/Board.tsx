/**
 * The pipeline board of an opening: one column per stage, a card per
 * candidate. On a desk, cards drag between columns; on a phone the stages
 * stack and each card has a "Move to" list. The hired column takes no drops
 * (a candidate gets there when they are hired from an accepted offer).
 * Cards are in waiting order (longest in the stage first), never by merit.
 */
import { useState } from 'react';
import { ArrowRightLeft, CalendarClock, ClipboardCheck, FileText, Handshake } from 'lucide-react';
import { Count, Menu, MenuItem, MenuLabel, Tag } from '../ui.tsx';
import { fmtDay } from '../../lib/format.ts';
import { t, tn } from '../../lib/i18n.ts';
import type { Board as BoardData, BoardCard } from '../../pages/hiring/types.ts';
import { cx, statusLabel, statusTone } from './bits.tsx';

interface Props {
  board: BoardData;
  canMove: boolean;
  onMove: (applications: string[], stage: string) => void;
  onOpen: (card: BoardCard) => void;
}

function MoveMenu({ board, card, onMove }: { board: BoardData; card: BoardCard; onMove: Props['onMove'] }): React.JSX.Element {
  return (
    <Menu icon={ArrowRightLeft} label={t('hiring.move_to_named', { name: card.name })} width={200}>
      {(close) => (
        <>
          <MenuLabel>{t('hiring.move_to')}</MenuLabel>
          {board.columns
            .filter((c) => c.kind !== 'hired')
            .map((c) => (
              <MenuItem
                key={c.key}
                selected={c.key === card.stage}
                disabled={c.key === card.stage}
                onClick={() => {
                  close();
                  onMove([card.application], c.key);
                }}
              >
                {c.name}
              </MenuItem>
            ))}
        </>
      )}
    </Menu>
  );
}

function Card({ board, card, canMove, onMove, onOpen, draggable }: { board: BoardData; card: BoardCard; canMove: boolean; onMove: Props['onMove']; onOpen: Props['onOpen']; draggable: boolean }): React.JSX.Element {
  const [dragging, setDragging] = useState(false);
  return (
    <div
      draggable={draggable && canMove}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', card.application);
        e.dataTransfer.effectAllowed = 'move';
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      className={cx('group relative rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)] bg-[var(--hr-panel)] transition-colors hover:border-[var(--hr-line-2)] hover:bg-[var(--hr-hover)]', dragging && 'opacity-50', draggable && canMove && 'cursor-grab active:cursor-grabbing')}
    >
      <button type="button" onClick={() => onOpen(card)} className="hr-focus block w-full cursor-pointer rounded-[var(--hr-radius-sm)] px-2.5 py-2 pr-9 text-left">
        <div className="hr-wrap text-[13px] font-medium leading-tight">{card.name}</div>
        {(card.current_title !== '' || card.current_company !== '') && <div className="hr-wrap mt-0.5 text-[12px] leading-tight text-[var(--hr-muted)]">{[card.current_title, card.current_company].filter((x) => x !== '').join(' · ')}</div>}
        <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-[var(--hr-muted)]">
          <span className="hr-mono hr-num" title={t('hiring.days_in_stage')}>
            {tn('hiring.n_days', card.days_in_stage)}
          </span>
          {card.next_interview !== '' && (
            <span className="inline-flex items-center gap-1" title={t('hiring.next_interview')}>
              <CalendarClock size={12} aria-hidden />
              {fmtDay(card.next_interview)}
            </span>
          )}
          {card.scorecards.total > 0 && (
            <span className="hr-mono hr-num inline-flex items-center gap-1" title={t('hiring.scorecards_in')}>
              <ClipboardCheck size={12} aria-hidden />
              {card.scorecards.submitted}/{card.scorecards.total}
            </span>
          )}
          {card.has_resume && <FileText size={12} aria-label={t('hiring.has_resume')} />}
          {card.referred && <Handshake size={12} aria-label={t('hiring.referred')} />}
          {card.offer !== '' && <Tag tone={statusTone('offer', card.offer)}>{statusLabel('offer', card.offer)}</Tag>}
        </div>
      </button>
      {canMove && (
        <div className="hover-only absolute right-1 top-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 [&_button:hover]:bg-[var(--hr-active)]">
          <MoveMenu board={board} card={card} onMove={onMove} />
        </div>
      )}
    </div>
  );
}

export function Board({ board, canMove, onMove, onOpen }: Props): React.JSX.Element {
  const [over, setOver] = useState('');
  return (
    <>
      <div className="hr-scroll hidden gap-2 overflow-x-auto pb-2 md:flex" role="list" aria-label={t('hiring.pipeline')}>
        {board.columns.map((col) => {
          const accepts = canMove && col.kind !== 'hired';
          return (
            <section
              key={col.key}
              role="listitem"
              aria-label={col.name}
              onDragOver={(e) => {
                if (!accepts) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (over !== col.key) setOver(col.key);
              }}
              onDragLeave={() => setOver((o) => (o === col.key ? '' : o))}
              onDrop={(e) => {
                e.preventDefault();
                setOver('');
                const id = e.dataTransfer.getData('text/plain');
                if (accepts && id !== '') onMove([id], col.key);
              }}
              className={cx('flex min-w-[220px] max-w-[320px] flex-1 flex-col rounded-[var(--hr-radius)] border bg-[var(--hr-sunk)] transition-colors', over === col.key ? 'border-[var(--hr-ink-2)]' : 'border-[var(--hr-line)]')}
            >
              <header className="flex items-center gap-2 border-b border-[var(--hr-line)] px-2.5 py-2">
                <span className="hr-label min-w-0 flex-1 truncate">{col.name}</span>
                {col.kind === 'hired' ? <span className="hr-mono hr-num text-[12px] text-[var(--hr-muted)]">{board.totals.hired}</span> : <Count n={col.cards.length} />}
              </header>
              <div className="flex min-h-[120px] flex-col gap-1.5 p-1.5">
                {col.kind === 'hired' ? (
                  <p className="px-1 py-2 text-[12px] text-[var(--hr-faint)]">{tn('hiring.hired_n', board.totals.hired)}</p>
                ) : col.cards.length === 0 ? (
                  <p className="px-1 py-2 text-[12px] text-[var(--hr-faint)]">{canMove ? t('hiring.drop_here') : t('hiring.no_one_here')}</p>
                ) : (
                  col.cards.map((c) => <Card key={c.application} board={board} card={c} canMove={canMove} onMove={onMove} onOpen={onOpen} draggable />)
                )}
              </div>
            </section>
          );
        })}
      </div>
      <div className="flex flex-col gap-3 md:hidden">
        {board.columns
          .filter((c) => c.kind !== 'hired')
          .map((col) => (
            <section key={col.key} aria-label={col.name}>
              <div className="mb-1.5 flex items-center gap-2 px-0.5">
                <span className="hr-label flex-1">{col.name}</span>
                <Count n={col.cards.length} />
              </div>
              {col.cards.length === 0 ? (
                <p className="rounded-[var(--hr-radius-sm)] border border-dashed border-[var(--hr-line)] px-3 py-2 text-[12px] text-[var(--hr-faint)]">{t('hiring.no_one_here')}</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {col.cards.map((c) => (
                    <Card key={c.application} board={board} card={c} canMove={canMove} onMove={onMove} onOpen={onOpen} draggable={false} />
                  ))}
                </div>
              )}
            </section>
          ))}
      </div>
    </>
  );
}
