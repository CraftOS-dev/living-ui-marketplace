/**
 * Today: the work queue. Tasks overdue, due today, upcoming, snoozed and
 * done today, with a quick add; next to them what else wants attention
 * (deals going stale or without a next step, people to get back in touch
 * with, proposals waiting). Keys: J/K move, X done, S snooze to tomorrow,
 * Enter opens what the task is about, N adds a task.
 */
import { useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AlarmClock, ArrowRight, CalendarCheck, CalendarClock, Check, CheckCircle2, Clock, Kanban, Mail, MessageSquare, Phone, Plus, Sparkles, Trash2, Users } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api, errMessage } from '../lib/api.ts';
import { TASK_KIND_LABEL, addDays, relDay, since, today } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { go } from '../lib/router.ts';
import { useApp, useReportScreen } from '../lib/store.tsx';
import type { Task } from '../lib/types.ts';
import { useDialogs } from '../components/dialogs.tsx';
import { AiChip, Avatar, Heading, StrengthBars } from '../components/controls.tsx';
import { Btn, Empty, IconBtn, Menu, Spinner, input } from '../components/ui.tsx';

const KIND_ICON: Record<string, LucideIcon> = { todo: Check, call: Phone, email: Mail, meeting: Users, follow_up: MessageSquare };

function openTarget(t: Task): void {
  if (t.deal) go('deals', { id: t.deal.id });
  else if (t.person) go('people', { id: t.person.id });
  else if (t.company) go('companies', { id: t.company.id });
}

function Row({ t, active, onActive }: { t: Task; active: boolean; onActive: () => void }): React.JSX.Element {
  const Icon = KIND_ICON[t.kind] ?? Check;
  const done = t.state === 'done';
  const act = (p: Promise<unknown>, msg: string): void => {
    p.then(() => toast.success(msg)).catch((err: unknown) => toast.error(errMessage(err)));
  };
  return (
    <li data-task={t.id} onClick={onActive} className={cn('group flex items-center gap-3 border-b border-[var(--cr-hair)] px-4 py-2 transition-colors', active ? 'bg-[var(--cr-row-hover)]' : 'hover:bg-[var(--cr-row)]')}>
      <button type="button" aria-label={done ? 'Mark not done' : 'Mark done'} onClick={(e) => (e.stopPropagation(), act(api.completeTask(t.id, !done), done ? 'Reopened' : 'Done'))} className={cn('flex size-[18px] shrink-0 items-center justify-center rounded-full border transition-colors', done ? 'border-[var(--cr-pos)] bg-[var(--cr-pos)] text-[var(--cr-card)]' : 'border-[var(--cr-line)] hover:border-[var(--cr-pos)] hover:text-[var(--cr-pos)]')}>
        <Check size={11} strokeWidth={3} className={done ? '' : 'opacity-0 group-hover:opacity-60'} />
      </button>
      <span className="flex size-6 shrink-0 items-center justify-center bg-[var(--cr-row-hover)] text-[var(--cr-ink-2)]" title={TASK_KIND_LABEL[t.kind]}>
        <Icon size={12} />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn('flex items-center gap-1.5 text-[12.5px] font-semibold', done && 'text-[var(--cr-muted)] line-through')}>
          <span className="truncate">{t.title}</span>
          {t.by === 'agent' && <AiChip>AI</AiChip>}
        </p>
        <p className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-[var(--cr-muted)]">
          {(t.person || t.deal || t.company) && (
            <button type="button" onClick={(e) => (e.stopPropagation(), openTarget(t))} className="truncate hover:text-[var(--cr-ink)] hover:underline">
              {[t.person?.name, t.deal?.name, t.company?.name].filter(Boolean).join(' · ')}
            </button>
          )}
          {t.notes && <span className="truncate">· {t.notes}</span>}
        </p>
      </div>
      <span className={cn('num shrink-0 text-[12px]', t.state === 'overdue' ? 'font-semibold text-[var(--cr-neg-text)]' : t.state === 'today' ? 'font-semibold text-[var(--cr-ink)]' : 'text-[var(--cr-muted)]')}>{done ? since(t.done_at) : t.state === 'snoozed' ? 'until ' + relDay(t.snoozed_until) : t.due ? relDay(t.due) : 'no date'}</span>
      {!done && (
        <span className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <Menu
            align="right"
            trigger={(_, toggle) => <IconBtn icon={AlarmClock} label="Snooze" size={24} onClick={(e) => (e.stopPropagation(), toggle())} />}
            items={[
              { label: 'Tomorrow', onClick: () => act(api.snoozeTask(t.id, addDays(today(), 1)), 'Snoozed to tomorrow') },
              { label: 'In 3 days', onClick: () => act(api.snoozeTask(t.id, addDays(today(), 3)), 'Snoozed') },
              { label: 'Next week', onClick: () => act(api.snoozeTask(t.id, addDays(today(), 7)), 'Snoozed to next week') },
              ...(t.state === 'snoozed' ? [{ label: 'Bring back now', onClick: () => act(api.snoozeTask(t.id, ''), 'Back') }] : []),
            ]}
          />
          <IconBtn icon={Trash2} label="Delete" size={24} onClick={(e) => (e.stopPropagation(), act(api.deleteTask(t.id), 'Deleted (Ctrl+Z to undo)'))} />
        </span>
      )}
    </li>
  );
}

function QuickAdd(): React.JSX.Element {
  const [title, setTitle] = useState('');
  const [due, setDue] = useState(today());
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const on = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      if (e.key === 'n' && !e.ctrlKey && !e.metaKey && document.querySelector('[role="dialog"]') === null) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);
  const add = (): void => {
    if (title.trim() === '') return;
    api
      .addTask({ title, due })
      .then(() => setTitle(''))
      .catch((err: unknown) => toast.error(errMessage(err)));
  };
  return (
    <div className="flex items-center gap-2 border-b border-[var(--cr-line)] px-4 py-2">
      <Plus size={15} className="text-[var(--cr-muted)]" />
      <input ref={ref} value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Add a task for today (N)" className="h-8 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[var(--cr-muted)]" />
      <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={cn(input, 'num h-7 w-[132px]')} aria-label="Due" />
      <Btn size="sm" variant="primary" onClick={add} disabled={title.trim() === ''}>
        Add
      </Btn>
    </div>
  );
}

/** Placeholder rows while a side list loads, so an empty state never flashes first. */
function Loading({ rows = 3, error }: { rows?: number | undefined; error: string | null }): React.JSX.Element {
  if (error !== null) return <p className="text-[12px] text-[var(--cr-neg-text)]">Could not load: {error}</p>;
  return (
    <div className="flex flex-col gap-2 py-1" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="h-3.5 animate-pulse bg-[var(--cr-row-hover)]" style={{ width: `${88 - i * 17}%` }} />
      ))}
    </div>
  );
}

function Side(): React.JSX.Element {
  const app = useApp();
  const rot = useLive(() => api.deals({ preset: 'rotting', limit: 6, sort: 'idle_days', dir: 'desc' }), ['deals', 'interactions', 'tasks', 'notes'], [], 500);
  const nns = useLive(() => api.deals({ preset: 'no_next_step', limit: 6 }), ['deals', 'tasks'], [], 500);
  const kit = useLive(() => api.people({ preset: 'keep_in_touch', limit: 8 }), ['people', 'interactions'], [], 500);
  const dlg = useDialogs();
  return (
    <aside className="flex w-full flex-col gap-5 overflow-y-auto border-l border-[var(--cr-line)] px-4 py-3 xl:w-[360px] xl:shrink-0">
      {(app.summary?.proposals ?? 0) > 0 && (
        <button type="button" onClick={() => go('review')} className="flex items-center gap-2.5 border border-[var(--cr-accent)] bg-[var(--cr-accent-soft)] px-3 py-2.5 text-left text-[12.5px] text-[var(--cr-accent-text)]">
          <Sparkles size={15} />
          <span className="flex-1">
            <b>{app.summary?.proposals}</b> change{app.summary?.proposals === 1 ? '' : 's'} from your AI agent to review
          </span>
          <ArrowRight size={14} />
        </button>
      )}
      <section>
        <Heading>
          <span className="inline-flex items-center gap-1.5">
            <Clock size={11} /> Going stale
          </span>
        </Heading>
        {rot.data === null ? (
          <Loading error={rot.error} />
        ) : rot.data.deals.length === 0 ? (
          <p className="text-[12px] text-[var(--cr-muted)]">No deal is going stale.</p>
        ) : (
          rot.data.deals.map((d) => (
            <button key={d.id} type="button" onClick={() => go('deals', { id: d.id })} className="flex w-full items-center gap-2 py-1.5 text-left text-[12.5px] hover:bg-[var(--cr-row)]">
              <Kanban size={13} className="shrink-0 text-[var(--cr-neg-text)]" />
              <span className="min-w-0 flex-1 truncate font-semibold">{d.name}</span>
              <span className="text-[11.5px] text-[var(--cr-neg-text)]">{d.idle_days} d quiet</span>
            </button>
          ))
        )}
      </section>
      <section>
        <Heading>
          <span className="inline-flex items-center gap-1.5">
            <CalendarClock size={11} /> No next step
          </span>
        </Heading>
        {nns.data === null ? (
          <Loading error={nns.error} />
        ) : nns.data.deals.length === 0 ? (
          <p className="text-[12px] text-[var(--cr-muted)]">Every open deal has a next step.</p>
        ) : (
          nns.data.deals.map((d) => (
            <div key={d.id} className="flex items-center gap-2 py-1 text-[12.5px]">
              <button type="button" onClick={() => go('deals', { id: d.id })} className="min-w-0 flex-1 truncate text-left font-semibold hover:underline">
                {d.name}
              </button>
              <Btn size="xs" variant="ghost" icon={Plus} onClick={() => dlg.openTask({ deal: { id: d.id, name: d.name } })}>
                Task
              </Btn>
            </div>
          ))
        )}
      </section>
      <section>
        <Heading action={<button type="button" onClick={() => go('people', { preset: 'keep_in_touch' })} className="text-[11.5px] font-semibold text-[var(--cr-muted)] hover:text-[var(--cr-ink)]">All</button>}>
          <span className="inline-flex items-center gap-1.5">
            <Users size={11} /> Keep in touch
          </span>
        </Heading>
        {kit.data === null ? (
          <Loading error={kit.error} />
        ) : kit.data.people.length === 0 ? (
          <p className="text-[12px] text-[var(--cr-muted)]">Nobody is due. Set a cadence on the people who matter.</p>
        ) : (
          kit.data.people.map((p) => (
            <div key={p.id} className="flex items-center gap-2 py-1 text-[12.5px]">
              <Avatar name={p.name} size={22} />
              <button type="button" onClick={() => go('people', { id: p.id })} className="min-w-0 flex-1 text-left">
                <span className="block truncate font-semibold">{p.name}</span>
                <span className="block truncate text-[11px] text-[var(--cr-muted)]">last {p.last_interaction ? since(p.last_interaction) : 'never'}</span>
              </button>
              <StrengthBars value={p.strength} />
              <IconBtn icon={MessageSquare} label={'Log a touch with ' + p.name} size={24} onClick={() => dlg.openLog({ person: { id: p.id, name: p.name } }, 'message')} />
            </div>
          ))
        )}
      </section>
    </aside>
  );
}

export function TodayView(): React.JSX.Element {
  const live = useLive(() => api.today(), ['tasks'], [], 200);
  const [active, setActive] = useState('');
  useReportScreen('today', null);
  const d = live.data;
  const groups: { key: keyof NonNullable<typeof d>; label: string; icon: LucideIcon; tone?: string }[] = [
    { key: 'overdue', label: 'Overdue', icon: Clock, tone: 'text-[var(--cr-neg-text)]' },
    { key: 'today', label: 'Today', icon: CalendarCheck },
    { key: 'upcoming', label: 'Upcoming', icon: CalendarClock },
    { key: 'snoozed', label: 'Snoozed', icon: AlarmClock },
    { key: 'done', label: 'Done today', icon: CheckCircle2 },
  ];
  const flat = d ? [...d.overdue, ...d.today, ...d.upcoming, ...d.snoozed] : [];
  useEffect(() => {
    const on = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
      if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector('[role="dialog"]') !== null) return;
      const i = flat.findIndex((t) => t.id === active);
      const cur = flat[i];
      if (e.key === 'j' || e.key === 'k') {
        e.preventDefault();
        const n = flat[Math.max(0, Math.min(flat.length - 1, e.key === 'j' ? i + 1 : i - 1))];
        if (n) {
          setActive(n.id);
          document.querySelector(`[data-task="${n.id}"]`)?.scrollIntoView({ block: 'nearest' });
        }
      } else if (e.key === 'x' && cur) {
        e.preventDefault();
        api.completeTask(cur.id).then(() => toast.success('Done: ' + cur.title)).catch((err: unknown) => toast.error(errMessage(err)));
      } else if (e.key === 's' && cur) {
        e.preventDefault();
        api.snoozeTask(cur.id, addDays(today(), 1)).then(() => toast.success('Snoozed to tomorrow')).catch((err: unknown) => toast.error(errMessage(err)));
      } else if (e.key === 'Enter' && cur) {
        e.preventDefault();
        openTarget(cur);
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });
  const empty = d !== null && flat.length === 0 && d.done.length === 0;
  return (
    <div className="flex h-full min-h-0 flex-col xl:flex-row">
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <QuickAdd />
        <div className="min-h-0 flex-1 overflow-y-auto">
          {d === null ? (
            <div className="flex h-40 items-center justify-center">
              <Spinner />
            </div>
          ) : empty ? (
            <Empty icon={CheckCircle2} title="Nothing to do today">
              Add tasks as you go, or log a meeting: your AI agent turns the follow-ups it implies into tasks.
            </Empty>
          ) : (
            groups.map((g) => {
              const list = d[g.key];
              if (list.length === 0) return null;
              const Icon = g.icon;
              return (
                <div key={g.key} className="cr-rise">
                  <h3 className={cn('sticky top-0 z-[1] flex h-8 items-center gap-1.5 border-b border-[var(--cr-hair)] bg-[var(--cr-card)] px-4 text-[11px] font-bold uppercase tracking-[0.05em]', g.tone ?? 'text-[var(--cr-muted)]')}>
                    <Icon size={12} /> {g.label}
                    <span className="num font-semibold">{list.length}</span>
                  </h3>
                  <ul>
                    {list.map((t) => (
                      <Row key={t.id} t={t} active={t.id === active} onActive={() => setActive(t.id)} />
                    ))}
                  </ul>
                </div>
              );
            })
          )}
        </div>
        <div className="hidden h-8 shrink-0 items-center gap-3 border-t border-[var(--cr-line)] px-4 text-[11.5px] text-[var(--cr-muted)] md:flex">
          <span>
            <b className="text-[var(--cr-ink-2)]">J K</b> move
          </span>
          <span>
            <b className="text-[var(--cr-ink-2)]">X</b> done
          </span>
          <span>
            <b className="text-[var(--cr-ink-2)]">S</b> snooze
          </span>
          <span>
            <b className="text-[var(--cr-ink-2)]">Enter</b> open
          </span>
          <span>
            <b className="text-[var(--cr-ink-2)]">N</b> new task
          </span>
        </div>
      </section>
      <Side />
    </div>
  );
}
