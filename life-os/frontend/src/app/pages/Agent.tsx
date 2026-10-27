/**
 * Your AI agent: ask it something about your life, keep or decline what it
 * hands back (plans, new goals or people, small field suggestions), let it
 * look in on a schedule (a morning note, an evening check-in, the week's
 * recap), and see everything done, by whom, with undo.
 */
import { useState } from 'react';
import { Send, Undo2, User } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { op } from '../lib/api.ts';
import { useStatus } from '../lib/context.tsx';
import { ago } from '../lib/format.ts';
import { ALL, changed, useLive } from '../lib/live.ts';
import type { ActivityEntry, Ask, Habit, Proposal, Routine, Suggestion } from '../lib/types.ts';
import { ProposalCard, SuggestionChip } from '../components/agent.tsx';
import { AREA_NAMES, AreaArt, Avatar, HabitArt, Mascot } from '../components/art.tsx';
import { Chip } from '../components/bits.tsx';
import { ColumnArt, ThingArt } from '../components/art2.tsx';
import { Panel } from '../components/panel.tsx';
import { PageBody } from '../components/page.tsx';
import { RecordPicker, TimeField, WeekdayPicker } from '../components/pickers.tsx';
import { snack } from '../components/snack.tsx';
import { Button, LoadError, Skeleton, Spinner, Toggle } from '../components/ui.tsx';

type About = Ask['about'];

function AskBox(): React.JSX.Element {
  const status = useStatus().data;
  const [about, setAbout] = useState<About>('life');
  const [target, setTarget] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const habits = useLive<{ habits: Habit[] }>((signal) => op('habits.list', {}, { quiet: true, signal }), ['habits'], []);
  const options =
    about === 'goal'
      ? (status?.goals ?? []).map((g) => ({ value: g.id, label: g.title, art: <AreaArt kind={g.area} size={18} /> }))
      : about === 'area'
        ? (status?.areas ?? []).map((k) => ({ value: k, label: AREA_NAMES[k], art: <AreaArt kind={k} size={18} /> }))
        : about === 'habit'
          ? (habits.data?.habits ?? []).map((h) => ({ value: h.id, label: h.name, art: <HabitArt art={h.art} size={18} /> }))
          : about === 'person'
            ? (status?.people ?? []).map((p) => ({ value: p.id, label: p.name, art: <Avatar look={p.look} size={18} /> }))
            : [];
  const needsTarget = about !== 'life';
  const send = async (): Promise<void> => {
    if (text.trim() === '' || (needsTarget && target === '')) return;
    setBusy(true);
    try {
      const r = await op<{ asked: boolean; code: string }>('asks.create', { question: text.trim(), about, ...(needsTarget ? { target } : {}) });
      changed('asks');
      setText('');
      if (!r.asked) toast.error('Saved. Your AI agent could not be reached right now; it will see it when it is back.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {(
          [
            ['life', 'My life'],
            ['area', 'A part of life'],
            ['goal', 'A goal'],
            ['habit', 'A habit'],
            ['person', 'Someone'],
          ] as [About, string][]
        ).map(([k, l]) => (
          <Chip
            key={k}
            active={about === k}
            onClick={() => {
              setAbout(k);
              setTarget('');
            }}
            className="h-7 text-[12px]"
          >
            {l}
          </Chip>
        ))}
        {needsTarget && <RecordPicker size="sm" value={target} options={options} onChange={setTarget} placeholder="Which one" />}
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void send();
          }
        }}
        rows={2}
        placeholder="Why do my weeks feel so full? What should I do about money this month?"
        aria-label="Your question"
        className="lo-autosize min-h-20 w-full resize-none rounded-[var(--lo-r)] border border-[var(--lo-line)] bg-[var(--lo-card)] px-3 py-2 text-[15px] leading-6 outline-none placeholder:text-[var(--lo-muted)] focus:border-[var(--lo-accent)]"
      />
      <div className="flex justify-end">
        <Button variant="primary" icon={Send} loading={busy} disabled={text.trim() === '' || (needsTarget && target === '')} onClick={() => void send()}>
          Ask
        </Button>
      </div>
    </div>
  );
}

function Answers(): React.JSX.Element {
  const asks = useLive<{ asks: Ask[] }>((signal) => op('asks.list', { limit: 30 }, { quiet: true, signal }), ['asks', 'agent_requests'], []);
  const list = asks.data?.asks ?? [];
  if (asks.data === null) return <Skeleton className="h-24 w-full" />;
  if (list.length === 0) return <p className="text-[13px] text-[var(--lo-muted)]">Questions and answers show up here.</p>;
  return (
    <ul className="flex flex-col gap-4">
      {list.map((a) => (
        <li key={a.id} className="flex flex-col gap-2">
          <p className="ml-auto max-w-[80%] rounded-[var(--lo-r-lg)] rounded-br-[4px] bg-[var(--lo-primary)] px-4 py-2 text-[14px] font-semibold text-white">{a.question}</p>
          <div className="flex max-w-[86%] items-end gap-2">
            <Mascot size={32} className="shrink-0" />
            <div className="rounded-[var(--lo-r-lg)] rounded-bl-[4px] bg-[var(--lo-card)] px-4 py-2.5 text-[14px] leading-6 shadow-[var(--lo-shadow-sm)]">
              {a.status === 'answered' ? (
                <p className="whitespace-pre-wrap">{a.answer}</p>
              ) : a.status === 'failed' ? (
                <p className="text-[var(--lo-red-text)]">Could not answer: {a.failure !== '' ? a.failure : 'no reason given'}</p>
              ) : (
                <p className="flex items-center gap-2 text-[var(--lo-muted)]">
                  <Spinner size={12} /> {a.status === 'working' ? 'Thinking about it' : 'Asked'}
                </p>
              )}
              <p className="mt-1 text-[12px] text-[var(--lo-muted)]">{ago(a.updated !== '' ? a.updated : a.created)}</p>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Waiting(): React.JSX.Element {
  const props = useLive<{ proposals: Proposal[] }>((signal) => op('proposals.list', { status: 'waiting', limit: 50 }, { quiet: true, signal }), ['proposals'], []);
  const sugg = useLive<{ suggestions: Suggestion[] }>((signal) => op('suggestions.list', {}, { quiet: true, signal }), ['suggestions'], []);
  const ps = (props.data?.proposals ?? []).filter((p) => p.status === 'waiting');
  const ss = sugg.data?.suggestions ?? [];
  if (props.data === null) return props.error !== null ? <LoadError message={props.error} onRetry={props.reload} /> : <Skeleton className="h-24 w-full" />;
  if (ps.length === 0 && ss.length === 0) return <p className="text-[13px] text-[var(--lo-muted)]">Nothing waiting on you. What your AI agent suggests lands here for you to keep or decline.</p>;
  return (
    <div className="flex flex-col gap-3">
      {ps.map((p) => (
        <ProposalCard key={p.id} proposal={p} />
      ))}
      {ss.length > 0 && (
        <ul className="flex flex-col gap-2">
          {ss.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-bold">{s.target_title}</span>
              <SuggestionChip s={s} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const ROUTINE_WORDS: Record<Routine['kind'], { title: string; what: string }> = {
  morning_note: { title: 'A morning note', what: 'A few lines on Home about the day ahead: the weather, birthdays, what matters.' },
  evening_checkin: { title: 'An evening check-in', what: 'A gentle nudge to close the day: what got done, how it felt.' },
  weekly_recap: { title: 'The week in a few words', what: 'A short paragraph on your week, written into the recap in the journal.' },
};

function Routines(): React.JSX.Element {
  const status = useStatus().data;
  const live = useLive<{ routines: Routine[]; quiet: { start: string; end: string } }>((signal) => op('routines.list', {}, { quiet: true, signal }), ['routines', 'routine_runs'], []);
  const save = async (r: Routine, patch: Record<string, unknown>): Promise<void> => {
    await op('routines.update', { routine: r.id, ...patch });
    changed('routines');
  };
  if (live.data === null) return <Skeleton className="h-24 w-full" />;
  return (
    <ul className="flex flex-col gap-3">
      {live.data.routines.map((r) => (
        <li key={r.id} className={cn('rounded-[var(--lo-r-lg)] p-4', r.enabled ? 'bg-[var(--lo-card)] shadow-[var(--lo-shadow-sm)]' : 'bg-[var(--lo-sunk)]')}>
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-bold">{ROUTINE_WORDS[r.kind].title}</p>
              <p className="text-[13px] text-[var(--lo-ink-2)]">{ROUTINE_WORDS[r.kind].what}</p>
            </div>
            <Toggle checked={r.enabled} onChange={(v) => void save(r, { enabled: v })} label={ROUTINE_WORDS[r.kind].title} />
          </div>
          {r.enabled && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <TimeField value={r.time} onChange={(v) => void save(r, { time: v })} label="At" />
              <WeekdayPicker value={r.days} onChange={(v) => void save(r, { days: JSON.stringify(v) })} weekStartsOn={status?.week_starts_on ?? 1} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function Activity(): React.JSX.Element {
  const [who, setWho] = useState<'' | 'agent' | 'person'>('');
  const live = useLive<{ entries: ActivityEntry[]; more: boolean }>((signal) => op('activity.list', { limit: 60, ...(who !== '' ? { actor: who } : {}) }, { quiet: true, signal }), ['activity'], [who]);
  const undo = async (e: ActivityEntry): Promise<void> => {
    await op('activity.undo', { entry: e.id });
    changed(...ALL);
    snack('Undone', { undo: false });
  };
  return (
    <div>
      <div className="mb-2 flex gap-1.5">
        {(
          [
            ['', 'Everyone'],
            ['agent', 'Your AI agent'],
            ['person', 'You'],
          ] as ['' | 'agent' | 'person', string][]
        ).map(([k, l]) => (
          <Chip key={k} active={who === k} onClick={() => setWho(k)} className="h-7 text-[12px]">
            {l}
          </Chip>
        ))}
      </div>
      {live.data === null ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <ul className="flex max-h-[520px] flex-col overflow-y-auto">
          {live.data.entries.map((e) => (
            <li key={e.id} className="flex min-h-10 items-center gap-3 rounded-[var(--lo-r-sm)] px-2 hover:bg-[var(--lo-sunk)]">
              {e.actor === 'agent' ? <Mascot size={22} /> : <span title={e.actor === 'system' ? 'Life OS' : 'You'} className="flex size-[22px] items-center justify-center rounded-full bg-[var(--lo-sunk)] text-[var(--lo-ink-2)]"><User size={12} /></span>}
              <span className={cn('min-w-0 flex-1 truncate text-[13px] font-semibold', e.undone && 'text-[var(--lo-muted)] line-through')}>{e.label}</span>
              <span className="shrink-0 text-[12px] text-[var(--lo-muted)]">{ago(e.created)}</span>
              {e.undoable && (
                <button type="button" onClick={() => void undo(e)} className="flex h-7 items-center gap-1 rounded-[var(--lo-r-sm)] px-2 text-[12px] font-bold text-[var(--lo-ink-2)] hover:bg-[var(--lo-card)]">
                  <Undo2 size={12} /> Undo
                </button>
              )}
            </li>
          ))}
          {live.data.entries.length === 0 && <p className="px-2 py-2 text-[13px] text-[var(--lo-muted)]">Nothing yet.</p>}
        </ul>
      )}
    </div>
  );
}

export default function AgentPage(): React.JSX.Element {
  const status = useStatus().data;
  const c = status?.counts;
  const waiting = c !== undefined ? c.proposals + c.suggestions : 0;
  return (
    <div>
      <header className="border-b border-[var(--lo-hair)] bg-[var(--lo-accent-soft)]">
        <div className="mx-auto flex max-w-[1320px] items-center gap-5 px-5 py-6 md:px-8">
          <Mascot size={96} className="shrink-0" />
          <div className="min-w-0">
            <h1 className="serif text-[26px] font-semibold leading-9">Your AI agent</h1>
            <p className="max-w-xl text-[14px] font-semibold text-[var(--lo-ink-2)]">It works in this app the way you do: plans your day when you ask, notes the weather and birthdays each morning, sums up your week. Anything big comes to you first.</p>
          </div>
        </div>
      </header>
      <PageBody>
        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-12">
          <div className="flex min-w-0 flex-col gap-5 xl:col-span-7">
            <Panel title="Ask your AI agent" art={<Mascot size={26} />}>
              <AskBox />
              <div className="mt-5 border-t border-[var(--lo-hair)] pt-5">
                <Answers />
              </div>
            </Panel>
            <Panel title="What was done" art={<ColumnArt kind="done" size={24} />}>
              <Activity />
            </Panel>
          </div>
          <div className="flex min-w-0 flex-col gap-5 xl:col-span-5">
            <Panel title="Waiting on you" art={<ColumnArt kind="inbox" size={24} />} note={waiting > 0 ? String(waiting) : undefined}>
              <Waiting />
            </Panel>
            <Panel title="On a schedule" art={<ThingArt kind="timer" size={24} />}>
              <Routines />
            </Panel>
          </div>
        </div>
      </PageBody>
    </div>
  );
}

