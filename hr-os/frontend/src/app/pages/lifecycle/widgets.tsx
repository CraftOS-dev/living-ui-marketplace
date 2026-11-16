/**
 * What lifecycle puts elsewhere: the letter print page (#/print/lifecycle/
 * letter/<id>, A4, the entity's name as plain text), the Inbox sections
 * (the viewer's open checklist tasks; handbook pages to read) and the Home
 * widgets (starting and leaving; the new hire's first days).
 */
import { BookOpen, CheckCheck, ChevronRight, ListChecks, LogOut, UserPlus } from 'lucide-react';
import { Button, Empty, LoadError, Panel, PersonChip, Skeleton } from '../../components/ui.tsx';
import { completeTask, HANDBOOK_READS, ProgressBar, TASK_READS } from '../../components/lifecycle/bits.tsx';
import { Markdown } from '../../components/lifecycle/Markdown.tsx';
import type { HandbookPage, LetterRow, LifecycleHome, Mover, TaskList, Welcome } from '../../components/lifecycle/types.ts';
import { can, useMe } from '../../lib/auth.tsx';
import type { HomeWidgetProps, InboxItem, PageProps } from '../../lib/contract.ts';
import { addDays, dayKey, fmtDay, fmtStampDay, relDay } from '../../lib/format.ts';
import { t } from '../../lib/i18n.ts';
import { useOp } from '../../lib/live.ts';
import { navigate } from '../../lib/router.ts';
import { PrintHead } from '../print/index.tsx';

/* ------------------------------------------------------------------ print */

export function LetterPrint({ params }: PageProps): React.JSX.Element {
  const live = useOp<{ letter: LetterRow }>('letters.get', { letter: params['id'] ?? '' }, [], { name: 'lifecycle.letter.print' });
  const l = live.data?.letter ?? null;
  if (l === null) return <p>{live.error ?? t('ui.loading')}</p>;
  return (
    <>
      <PrintHead entity={l.print?.legal_name ?? l.entity_name} address={l.print?.address} title={l.kind_label} meta={[l.number, fmtDay(l.letter_day, { year: 'always' })].filter((x) => x !== '').join(' · ')} />
      {l.status === 'draft' && <p className="mb-4 border border-[#bbb] px-3 py-2 text-[12px] uppercase tracking-[0.08em] text-[#555]">{t('lifecycle.draft_not_issued')}</p>}
      {l.status === 'void' && <p className="mb-4 border border-[#bbb] px-3 py-2 text-[12px] uppercase tracking-[0.08em] text-[#555]">{t('lifecycle.void_print', { reason: l.void_reason })}</p>}
      <Markdown text={l.rendered ?? ''} tone="print" />
      {l.needs_ack && l.acked_at !== '' && <p className="mt-10 border-t border-[#ccc] pt-2 text-[12px] text-[#555]">{t('lifecycle.acked_print', { who: l.employee_name, day: fmtStampDay(l.acked_at, { entity: l.entity }) })}</p>}
    </>
  );
}

/* ------------------------------------------------------------------ inbox */

/** The viewer's open checklist tasks for the Inbox ("Done" for tasks that need no file). */
export function useTaskItems(): InboxItem[] | null {
  const soon = addDays(dayKey(), 14);
  const live = useOp<TaskList>('tasks.list', { view: 'mine', status: 'open', due_before: soon, limit: 50 }, TASK_READS, { name: 'lifecycle.inbox.tasks' });
  if (live.data === null) return null;
  return live.data.tasks.map((x) => ({
    id: x.id,
    title: x.title,
    sub: x.checklist_name,
    link: `#/lifecycle/checklists/${x.checklist}`,
    due: x.due !== '' ? x.due : undefined,
    person: x.employee_name,
    actions: x.can.act && !(x.kind === 'document' && x.document === null) ? [{ label: t('lifecycle.done_action'), outcome: 'done', run: () => completeTask(x) }] : undefined,
  }));
}

/** Handbook pages the viewer still has to read and acknowledge. */
export function useReadItems(): InboxItem[] | null {
  const live = useOp<{ pages: HandbookPage[] }>('handbook.list', { view: 'read' }, HANDBOOK_READS, { name: 'lifecycle.inbox.read' });
  if (live.data === null) return null;
  return live.data.pages
    .filter((p) => p.to_ack)
    .map((p) => ({ id: p.id, title: p.title, sub: t('lifecycle.handbook_version', { v: p.version }), link: `#/lifecycle/handbook/${p.id}` }));
}

/* ------------------------------------------------------------------- home */

function MiniMovers({ list, empty, icon }: { list: Mover[]; empty: string; icon: typeof UserPlus }): React.JSX.Element {
  if (list.length === 0) return <Empty icon={icon} title={empty} className="py-5" />;
  return (
    <ul>
      {list.slice(0, 6).map((m) => (
        <li key={m.employment} className="flex items-center gap-2 border-b border-[var(--hr-hair)] py-2 last:border-b-0">
          <a href={m.checklist !== null ? `#/lifecycle/checklists/${m.checklist.id}` : `#/people/${m.number}`} className="hr-focus min-w-0 flex-1 overflow-hidden rounded-[3px] [&_.hr-wrap]:underline [&_.hr-wrap]:decoration-[var(--hr-line-2)] [&_.hr-wrap]:underline-offset-[3px] hover:[&_.hr-wrap]:decoration-current">
            <PersonChip name={m.name} sub={fmtDay(m.day) + ' · ' + relDay(m.day)} size={22} />
          </a>
          {m.checklist !== null && <ProgressBar progress={m.checklist.progress} />}
        </li>
      ))}
    </ul>
  );
}

/** Starting and leaving in the next 30 days: two columns on a wide widget (HR), one on a narrow one (managers). */
function Movers({ narrow, index }: { narrow: boolean; index: string | undefined }): React.JSX.Element {
  const me = useMe();
  const canHire = can(me, 'people', 'full');
  const live = useOp<LifecycleHome>('lifecycle.home', {}, [...TASK_READS, 'employments', 'separations'], { name: 'lifecycle.home' });
  const h = live.data;
  const none = h !== null && h.starting.length === 0 && h.leaving.length === 0;
  return (
    <Panel index={index} label={t('lifecycle.widget_movers')} aside={<a href="#/lifecycle" className="hr-focus hr-label hit inline-flex h-6 items-center gap-0.5 rounded-[3px] hover:!text-[var(--hr-ink)]">{t('lifecycle.open')}<ChevronRight size={12} strokeWidth={2} aria-hidden /></a>}>
      {h === null ? (
        live.error !== null ? (
          <LoadError message={live.error} onRetry={live.reload} />
        ) : (
          <div className="flex flex-col gap-2.5 py-1" role="status" aria-label={t('ui.loading')}>
            <Skeleton className="w-3/5" />
            <Skeleton className="w-2/5" />
            <Skeleton className="w-1/2" />
          </div>
        )
      ) : none ? (
        <div className="flex flex-col items-start gap-2">
          <p className="flex items-center gap-2 text-[13px] text-[var(--hr-muted)]">
            <UserPlus size={14} aria-hidden />
            {t('lifecycle.none_moving', { n: h.days })}
          </p>
          {canHire && (
            <Button size="sm" icon={UserPlus} onClick={() => navigate('/people/new')}>
              {t('lifecycle.hire_someone')}
            </Button>
          )}
        </div>
      ) : (
        <div className={narrow ? 'grid grid-cols-1 gap-y-3' : 'grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2'}>
          <div className="min-w-0">
            <div className="hr-label mb-1">{t('lifecycle.starting')}</div>
            <MiniMovers list={h.starting} empty={t('lifecycle.none_starting_short')} icon={UserPlus} />
          </div>
          <div className="min-w-0">
            <div className="hr-label mb-1">{t('lifecycle.leaving')}</div>
            <MiniMovers list={h.leaving} empty={t('lifecycle.none_leaving_short')} icon={LogOut} />
          </div>
        </div>
      )}
    </Panel>
  );
}

export function MoversWidget({ index }: HomeWidgetProps): React.JSX.Element {
  return <Movers narrow={false} index={index} />;
}

export function MoversWidgetNarrow({ index }: HomeWidgetProps): React.JSX.Element {
  return <Movers narrow index={index} />;
}

/** The new hire's first days on their Home while onboarding is open or there is something to read; a quiet line otherwise (always a panel, so Home's numbering has no gap). */
export function FirstDaysWidget({ index }: HomeWidgetProps): React.JSX.Element {
  const live = useOp<Welcome>('lifecycle.welcome', {}, [...TASK_READS, ...HANDBOOK_READS, 'letters'], { name: 'lifecycle.welcome' });
  const w = live.data;
  if (w === null)
    return (
      <Panel index={index} label={t('lifecycle.widget_to_do')}>
        {live.error !== null ? (
          <LoadError message={live.error} onRetry={live.reload} />
        ) : (
          <div className="flex flex-col gap-2.5 py-1" role="status" aria-label={t('ui.loading')}>
            <Skeleton className="w-3/5" />
            <Skeleton className="w-2/5" />
          </div>
        )}
      </Panel>
    );
  const open = (w.tasks ?? []).filter((x) => x.status === 'open');
  const toRead = (w.documents ?? []).filter((d) => d.acked_at === '').length + (w.handbook ?? []).length;
  const onboarding = w.checklist !== null && w.checklist !== undefined && w.checklist.status === 'open';
  if (!w.linked || (!onboarding && open.length === 0 && toRead === 0))
    return (
      <Panel index={index} label={t('lifecycle.widget_to_do')}>
        <p className="flex items-center gap-2 text-[13px] text-[var(--hr-muted)]">
          <CheckCheck size={14} aria-hidden />
          {t('lifecycle.widget_nothing')}
        </p>
      </Panel>
    );
  const fd = w.first_day ?? null;
  return (
    <Panel index={index} label={onboarding ? t('lifecycle.widget_first_days') : t('lifecycle.widget_to_do')} aside={<a href="#/lifecycle/welcome" className="hr-focus hr-label hit inline-flex h-6 items-center gap-0.5 rounded-[3px] hover:!text-[var(--hr-ink)]">{t('lifecycle.open')}<ChevronRight size={12} strokeWidth={2} aria-hidden /></a>}>
      {fd !== null && fd.days_to_go > 0 && (
        <div className="mb-2 flex items-baseline gap-2">
          <span className="hr-mono hr-num text-[26px] font-light leading-none">{fd.days_to_go}</span>
          <span className="text-[13px] text-[var(--hr-muted)]">{t('lifecycle.days_to_first', { day: fmtDay(fd.day) })}</span>
        </div>
      )}
      {w.checklist !== null && w.checklist !== undefined && <ProgressBar progress={w.checklist.progress} wide className="mb-2 w-full" />}
      <div className="flex flex-col gap-1 text-[13px]">
        <a href="#/lifecycle/welcome" className="hr-link hr-focus inline-flex items-center gap-1.5 rounded-[3px]">
          <ListChecks size={13} aria-hidden />
          {t('lifecycle.n_tasks_open', { n: open.length })}
        </a>
        {toRead > 0 && (
          <a href="#/lifecycle/welcome" className="hr-link hr-focus inline-flex items-center gap-1.5 rounded-[3px]">
            <BookOpen size={13} aria-hidden />
            {t('lifecycle.n_to_read', { n: toRead })}
          </a>
        )}
      </div>
    </Panel>
  );
}
