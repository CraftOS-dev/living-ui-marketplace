/**
 * Step 3, Answers: YC's six sections as tiles with progress rings, four
 * filters, and the questions as rows that open in place.
 */
import { useEffect, useState } from 'react';
import { ArrowRight, CheckCheck, PenLine } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { op } from '../lib/api.ts';
import { changed, useLive } from '../lib/live.ts';
import { href, type Route } from '../lib/router.ts';
import type { Answer, AnswerList, Pipeline } from '../lib/types.ts';
import { MiniRing } from '../components/Charts.tsx';
import { QuestionCard } from '../components/QuestionCard.tsx';
import { Card, Empty, PageHeader, PillButton, PillLink, StartCard } from '../components/ui.tsx';

const FILTERS: { key: string; label: string; pick: (a: Answer) => boolean }[] = [
  { key: 'needs', label: 'Needs you', pick: (a) => a.open && a.need !== '' },
  { key: 'missing', label: 'Empty', pick: (a) => a.open && a.required && a.value === '' },
  { key: 'confirm', label: 'To confirm', pick: (a) => a.open && a.value !== '' && !a.confirmed },
  { key: 'flagged', label: 'Flagged', pick: (a) => a.open && a.value !== '' && (a.flags > 0 || (a.failing_checks?.length ?? 0) > 0) },
];

export function AnswersPage({ p, route }: { p: Pipeline; route: Route }): React.JSX.Element {
  const list = useLive<AnswerList>('answers', (signal) => op<AnswerList>('answers.list', {}, { signal, quiet: true }), ['answers', 'founders']);
  const [open, setOpen] = useState<string>(route.focus);
  const [myself, setMyself] = useState(false);
  useEffect(() => {
    if (route.focus !== '') setOpen(route.focus);
  }, [route.focus]);
  const data = list.data;
  if (data === null) return <p className="py-16 text-center text-[13px] text-[var(--yc-muted)]">{list.error ?? 'Loading'}</p>;
  const form = data.items.filter((a) => a.section !== 'profile');
  const focusItem = route.focus !== '' ? form.find((a) => a.key === route.focus) : undefined;
  const filter = FILTERS.find((f) => f.key === route.sub);
  const section = filter !== undefined ? '' : data.sections.some((s) => s.key === route.sub) ? route.sub : focusItem?.section ?? 'founders';
  // The open card stays put while it is being edited, even once it no longer matches the filter.
  const shown = filter !== undefined ? data.items.filter((a) => filter.pick(a) || a.key === open) : form.filter((a) => a.section === section && a.open);
  const locked = p.settings.status !== 'preparing';
  const unconfirmedHere = shown.filter((a) => a.value !== '' && !a.confirmed).length;
  const answered = form.filter((a) => a.open && a.value !== '').length;
  const total = form.filter((a) => a.open).length;
  const g = p.settings.gather_state;

  if (answered === 0 && !myself && route.focus === '' && filter === undefined) {
    return (
      <>
        <PageHeader title="Your answers" />
        <StartCard
          icon={PenLine}
          title={g === 'requested' || g === 'working' ? 'Your AI agent is filling it in' : 'Nothing answered yet'}
          actions={
            <>
              {p.sources.length === 0 && (
                <PillLink variant="dark" dot icon={ArrowRight} href={href('links')}>
                  Add links or files
                </PillLink>
              )}
              <PillButton variant="row" onClick={() => setMyself(true)}>
                Answer myself
              </PillButton>
            </>
          }
        >
          {p.sources.length === 0 ? 'Add your links or pitch deck first, and your AI agent fills most answers for you.' : 'Your answers show here as your AI agent writes them, or answer them yourself.'}
        </StartCard>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Your answers"
        subtitle={answered + ' of ' + total + ' answered'}
        actions={
          <PillLink variant="dark" dot icon={ArrowRight} href={href('polish')}>
            Next: polish
          </PillLink>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 2xl:grid-cols-6">
        {p.sections
          .filter((s) => s.key !== 'profile')
          .map((s) => {
            const on = section === s.key;
            return (
              <a
                key={s.key}
                href={href('answers', s.key)}
                aria-current={on ? 'page' : undefined}
                className={cn('hit flex items-center gap-3 rounded-[20px] px-3 py-3 transition-colors', on ? 'border border-[var(--yc-ink)] bg-[var(--yc-ink)] text-[var(--yc-shell)]' : 'yc-edge border border-[var(--yc-border)] bg-[var(--yc-card)]')}
              >
                <span className={cn('inline-flex', on && '[--yc-ink:var(--yc-shell)] [--yc-line:var(--yc-dark-line)]')}>
                  <MiniRing value={s.total === 0 ? 0 : s.answered / s.total} done={s.missing === 0 && s.total > 0}>
                    {s.answered}
                  </MiniRing>
                </span>
                <span className="min-w-0">
                  <span className="block text-[14px] font-bold">{s.label}</span>
                  <span className={cn('block text-[12px]', on ? 'opacity-70' : 'text-[var(--yc-muted)]')}>{s.missing > 0 ? s.missing + ' empty' : s.needs > 0 ? s.needs + ' need you' : 'of ' + s.total}</span>
                </span>
              </a>
            );
          })}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => {
          const n = data.items.filter(f.pick).length;
          const on = filter?.key === f.key;
          return (
            <a
              key={f.key}
              href={on ? href('answers', 'founders') : href('answers', f.key)}
              className={cn('hit inline-flex h-9 items-center gap-2 rounded-full px-4 text-[13px] font-semibold transition-colors', on ? 'border border-[var(--yc-ink)] bg-[var(--yc-ink)] text-[var(--yc-shell)]' : 'yc-edge border border-[var(--yc-border)] bg-[var(--yc-card)]')}
            >
              {f.label}
              <span className={cn('num rounded-full px-1.5 text-[12px]', on ? 'bg-[var(--yc-card)] text-[var(--yc-ink)]' : 'bg-[var(--yc-row)]')}>{n}</span>
            </a>
          );
        })}
        {!locked && unconfirmedHere > 1 && filter === undefined && (
          <PillButton variant="ghost" icon={CheckCheck} className="ml-auto h-9" onClick={() => void op('answers.confirm', { section }).then(() => changed('answers'))}>
            Confirm all {unconfirmedHere}
          </PillButton>
        )}
      </div>

      <Card>
        {shown.length === 0 ? (
          <Empty icon={CheckCheck} title="Nothing here" />
        ) : (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
            {shown.map((a) => (
              <QuestionCard key={a.key} a={a} months={data.months} confirms={p.settings.confirms} open={open === a.key} onToggle={() => setOpen((o) => (o === a.key ? '' : a.key))} locked={locked} />
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
