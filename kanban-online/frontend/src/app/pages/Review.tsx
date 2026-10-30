/**
 * The review queue: every card waiting for a person's decision, urgent and
 * old first: the ones you asked for (and ones nobody owns), or everyone's.
 * The list on the left; on the right the agent's evidence, the card itself,
 * and Approve / Request changes / Reject. J and K move through the queue,
 * A approves, R asks for changes.
 */
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCheck, ExternalLink } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { ReviewActions, ReviewPacketView } from '../components/card/Review.tsx';
import { PriorityIcon } from '../components/marks.tsx';
import { Button, Empty, Kbd, MenuButton, PartyAvatar, Segmented, Spinner } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { ago } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { Markdown } from '../lib/markdown.tsx';
import { navigate } from '../lib/router.ts';

export function ReviewPage(): React.JSX.Element {
  const app = useApp();
  const [mine, setMine] = useState(app.me?.prefs.inbox !== 'all');
  const live = useLive(() => api.reviews(mine), ['cards'], [mine]);
  const cards = useMemo(() => live.data?.cards ?? [], [live.data]);
  const [sel, setSel] = useState<string | null>(null);
  const cur = cards.find((c) => c.id === sel) ?? cards[0] ?? null;
  useEffect(() => {
    void api.reportUi({ view: 'review', card: cur?.id }).catch(() => undefined);
  }, [cur?.id]);
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable || document.querySelector('[role="dialog"]') !== null) return;
      if (cur === null || e.ctrlKey || e.metaKey || e.altKey) return;
      const i = cards.findIndex((c) => c.id === cur.id);
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setSel(cards[Math.min(cards.length - 1, i + 1)]?.id ?? null);
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setSel(cards[Math.max(0, i - 1)]?.id ?? null);
      } else if (e.key === 'a') {
        e.preventDefault();
        (document.querySelector('[data-kb-review] button') as HTMLButtonElement | null)?.click();
      } else if (e.key === 'r') {
        e.preventDefault();
        (document.querySelector('[data-kb-review] [data-kb-changes]') as HTMLButtonElement | null)?.click();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [cards, cur]);
  return (
    <div className="flex h-full min-w-0 flex-col">
      <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-[var(--kb-hair)] px-3 md:gap-3 md:px-6">
        <MenuButton />
        <h1 className="text-[15px] font-semibold">Review</h1>
        <span className="kb-num text-[13px] text-[var(--kb-muted)]">{cards.length} waiting</span>
        <span className="flex-1" />
        <Segmented size="sm" label="Whose" value={mine ? 'mine' : 'all'} onChange={(v) => (setMine(v === 'mine'), setSel(null))} options={[{ value: 'mine', label: 'Mine', title: 'Cards you asked for, and ones nobody owns' }, { value: 'all', label: 'Everyone', title: 'Every card waiting for review' }]} />
        <span className="hidden items-center gap-1.5 text-[12px] text-[var(--kb-muted)] md:inline-flex">
          <Kbd>J</Kbd>
          <Kbd>K</Kbd> move <span className="mx-1">·</span> <Kbd>A</Kbd> approve <span className="mx-1">·</span> <Kbd>R</Kbd> request changes
        </span>
      </header>
      {live.data === null ? (
        <div className="flex flex-1 items-center justify-center text-[var(--kb-muted)]">
          <Spinner size={18} />
        </div>
      ) : cards.length === 0 ? (
        <Empty icon={CheckCheck} title={mine ? 'Nothing waits for your review' : 'Nothing waits for review'} className="flex-1">
          When an agent submits work, it comes here with its evidence: each acceptance criterion, how it was checked and what it could not verify. Anyone on the team may decide; the person who asked for it is told.
        </Empty>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className={cn('kb-scroll w-full shrink-0 overflow-y-auto p-2 md:block md:w-[340px] md:border-r md:border-[var(--kb-hair)]', sel !== null && 'hidden')}>
            {cards.map((c) => {
              const unmet = (c.review?.criteria ?? []).filter((x) => !x.met).length;
              return (
                <button key={c.id} type="button" onClick={() => setSel(c.id)} className={cn('kb-focus flex w-full flex-col gap-1 rounded-[var(--kb-radius)] px-3 py-2.5 text-left transition-colors', cur?.id === c.id ? 'bg-[var(--kb-active)]' : 'hover:bg-[var(--kb-main-hover)]')}>
                  <span className="flex items-center gap-1.5 text-[11.5px] text-[var(--kb-muted)]">
                    <PriorityIcon priority={c.priority} size={12} />
                    <span className="kb-num font-medium">{c.key}</span>
                    <span className="truncate">· {c.board_name}</span>
                    <span className="ml-auto shrink-0">{ago(c.column_at)}</span>
                  </span>
                  <span className="line-clamp-2 text-[13px] font-medium leading-[18px]">{c.title}</span>
                  <span className="flex items-center gap-1.5 text-[12px] text-[var(--kb-muted)]">
                    <PartyAvatar party={c.review?.by_party} size={16} />
                    {c.review?.by_party?.name ?? 'A rule'}
                    {c.requester !== null && c.requester.id !== app.me?.id && <span className="truncate">· for {c.requester.name}</span>}
                    {unmet > 0 && <span className="text-[var(--kb-red)]">· {unmet} criteria not met</span>}
                  </span>
                </button>
              );
            })}
          </div>
          {cur !== null && (
            <div className={cn('kb-scroll min-w-0 flex-1 overflow-y-auto md:block', sel === null && 'hidden')}>
              <div className="mx-auto flex max-w-[760px] flex-col gap-5 px-4 py-4 md:px-8 md:py-6">
                <button type="button" onClick={() => setSel(null)} className="kb-focus -mb-2 inline-flex w-max items-center gap-1.5 rounded-[var(--kb-radius-sm)] text-[13px] text-[var(--kb-muted)] hover:text-[var(--kb-ink)] md:hidden">
                  <ArrowLeft size={14} aria-hidden /> All reviews
                </button>
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] text-[var(--kb-muted)]">
                      <span className="kb-num font-medium">{cur.key}</span> · {cur.board_name}
                    </div>
                    <h2 className="mt-1 text-[18px] font-semibold leading-6">{cur.title}</h2>
                  </div>
                  <Button icon={ExternalLink} aria-label="Open card" className="px-2 sm:px-3" onClick={() => app.setOpenCard(cur.id)}>
                    <span className="hidden sm:inline">Open card</span>
                  </Button>
                </div>
                <div data-kb-review="">
                  <ReviewActions card={cur} keys onDone={() => setSel(cards[cards.findIndex((c) => c.id === cur.id) + 1]?.id ?? null)} />
                </div>
                <ReviewPacketView card={cur} />
                {cur.acceptance.trim() !== '' && (
                  <section className="flex flex-col gap-1.5">
                    <h3 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--kb-muted)]">The card&apos;s acceptance criteria</h3>
                    <Markdown text={cur.acceptance} />
                  </section>
                )}
                {cur.description.trim() !== '' && (
                  <section className="flex flex-col gap-1.5 rounded-[var(--kb-radius)] border border-[var(--kb-hair)] bg-[var(--kb-card)] p-4">
                    <h3 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--kb-muted)]">Description</h3>
                    <Markdown text={cur.description} />
                  </section>
                )}
                <button type="button" onClick={() => navigate('board', { id: cur.board })} className="w-max text-[12.5px] text-[var(--kb-muted)] hover:text-[var(--kb-ink)] hover:underline">
                  Go to the board
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
