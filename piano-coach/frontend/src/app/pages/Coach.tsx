/**
 * The conversation with the coach (CraftBot): ask for a song, a plan, or
 * anything about practice; session reviews arrive here too. Each message
 * shows whether CraftBot has picked it up, and songs the coach added sit
 * under its answer, ready to practise.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Sparkle, CalendarCheck, Music, Play, RotateCcw, Send } from 'lucide-react';
import { cn, toast, useAgentRequest } from '../../kit/index.ts';
import { MiniRoll } from '../components/charts.tsx';
import { Button, PageHeader, Spinner, Textarea, errMessage } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { ago, levelName, time } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { href } from '../lib/router.ts';
import type { Message, Song } from '../lib/types.ts';

const QUICK = ['Add a song for my level', 'What should I practise today?', 'How do I play faster without mistakes?'];

export function CoachPage(): React.JSX.Element {
  const app = useApp();
  const live = useLive(() => api.messages(), ['messages', 'songs'], [], 120, 800);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement | null>(null);
  const msgs = live.data?.messages ?? null;
  const count = msgs?.length ?? 0;

  useEffect(() => {
    if (count > 0 && (app.unread ?? 0) > 0) void api.read().catch(() => undefined);
  }, [count, app.unread]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el !== null) el.scrollTo({ top: el.scrollHeight, behavior: count > 0 ? 'smooth' : 'auto' });
  }, [count]);

  const send = (t = text): void => {
    const body = t.trim();
    if (body === '') return;
    setBusy(true);
    api
      .send({ text: body, kind: /\b(add|song|piece|learn)\b/i.test(body) ? 'request' : 'chat', context: { view: 'coach' } })
      .then((r) => {
        setText('');
        if (!r.asked) toast.info(r.reason);
      })
      .catch((err: unknown) => toast.error(errMessage(err)))
      .finally(() => setBusy(false));
  };

  const st = app.state;
  const status = (st?.pending ?? 0) > 0 ? (st?.agent_active === true ? 'Working' : 'Waiting for CraftBot') : 'Ready';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Coach" meta={status} />
      <div ref={scroller} className="pc-scroll min-h-0 flex-1 overflow-y-auto px-5 md:px-7">
        <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4 py-5">
          {msgs === null ? (
            <div className="flex h-40 items-center justify-center text-[var(--pc-muted)]">
              <Spinner size={18} />
            </div>
          ) : msgs.length === 0 ? (
            <Intro level={app.settings?.level ?? 1} onPick={(q) => send(q)} />
          ) : (
            msgs.map((m) => <Bubble key={m.id} m={m} />)
          )}
        </div>
      </div>
      <div className="shrink-0 border-t border-[var(--pc-line)] bg-[var(--pc-page)] px-5 py-3 md:px-7">
        <div className="mx-auto w-full max-w-[760px]">
          {msgs !== null && msgs.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {QUICK.map((q) => (
                <button key={q} type="button" onClick={() => setText(q)} className="pc-focus h-7 rounded-full border border-[var(--pc-line)] bg-[var(--pc-raised)] px-3 text-[12px] text-[var(--pc-ink-2)] transition-colors hover:bg-[var(--pc-hover)] hover:text-[var(--pc-ink)]">
                  {q}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2 rounded-[var(--pc-radius)] border border-[var(--pc-line)] bg-[var(--pc-raised)] p-1.5 focus-within:border-[var(--pc-ink-2)]">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              minRows={1}
              maxRows={6}
              placeholder="Ask for a song, a plan, or anything about practice"
              className="border-0 bg-transparent shadow-none focus:shadow-none"
            />
            <Button variant="coach" icon={Send} busy={busy} disabled={text.trim() === ''} onClick={() => send()} aria-label="Send" className="h-9 w-9 px-0" />
          </div>
        </div>
      </div>
    </div>
  );
}

function Intro({ level, onPick }: { level: number; onPick: (q: string) => void }): React.JSX.Element {
  const ideas = [`A waltz for level ${level} (${levelName(level).toLowerCase()})`, 'Scales in G major, both hands', 'What should I practise today?'];
  return (
    <div className="pc-rise flex flex-col items-center gap-4 py-14 text-center">
      <span className="flex size-12 items-center justify-center rounded-[14px] bg-[var(--pc-coach)] text-[var(--pc-coach-ink)]">
        <Sparkle size={24} aria-hidden />
      </span>
      <div>
        <div className="text-[16px] font-semibold">Your coach</div>
        <p className="mt-1 max-w-[420px] text-[13px] leading-5 text-[var(--pc-muted)]">Ask for any piece and it is written at your level. After each session you get a short review and tomorrow’s plan.</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {ideas.map((q) => (
          <button key={q} type="button" onClick={() => onPick(q)} className="pc-focus h-8 rounded-full border border-[var(--pc-line)] bg-[var(--pc-raised)] px-3.5 text-[12.5px] transition-colors hover:bg-[var(--pc-hover)]">
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

function Bubble({ m }: { m: Message }): React.JSX.Element {
  if (m.role === 'you') return <Mine m={m} />;
  const review = m.kind === 'review';
  return (
    <div className="pc-in flex items-start gap-2.5">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-[var(--pc-coach)] text-[var(--pc-coach-ink)]">
        <Sparkle size={15} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="pc-label mb-1 flex items-center gap-2">
          {review ? (
            <>
              <CalendarCheck size={12} aria-hidden /> Session review
            </>
          ) : m.kind === 'plan' ? (
            'Plan'
          ) : (
            'Coach'
          )}
          <span className="text-[var(--pc-faint)]">· {ago(m.created)}</span>
        </div>
        <div className={cn('whitespace-pre-wrap rounded-[var(--pc-radius)] px-3.5 py-2.5 text-[13.5px] leading-[21px]', review ? 'border border-[var(--pc-line)] border-l-2 border-l-[var(--pc-coach)] bg-[var(--pc-panel)]' : 'bg-[var(--pc-panel)] ring-1 ring-inset ring-[var(--pc-line)]')}>{m.text}</div>
        {m.songs !== undefined && m.songs.length > 0 && <Added songs={m.songs} />}
      </div>
    </div>
  );
}

function Mine({ m }: { m: Message }): React.JSX.Element {
  const req = useAgentRequest(m.status === 'pending' && m.request_id !== '' ? m.request_id : null);
  const [retrying, setRetrying] = useState(false);
  let line: React.ReactNode = null;
  if (m.status === 'pending') {
    if (m.request_id === '' && m.error !== '')
      line = (
        <span className="flex items-center gap-2">
          <span className="text-[var(--pc-bad)]">{m.error}</span>
          <button
            type="button"
            disabled={retrying}
            onClick={() => {
              setRetrying(true);
              api
                .retry(m.id)
                .then((r) => !r.asked && toast.info(r.reason))
                .catch((err: unknown) => toast.error(errMessage(err)))
                .finally(() => setRetrying(false));
            }}
            className="pc-focus inline-flex items-center gap-1 font-medium text-[var(--pc-ink)] hover:underline"
          >
            <RotateCcw size={11} aria-hidden /> Ask again
          </button>
        </span>
      );
    else if (req.request?.status === 'claimed')
      line = (
        <span className="flex items-center gap-1.5">
          <span className="pc-pulse size-1.5 rounded-full bg-[var(--pc-good)]" /> CraftBot is working on it
        </span>
      );
    else if (req.request?.status === 'rejected') line = <span className="text-[var(--pc-bad)]">CraftBot could not do this{req.request.error !== '' ? `: ${req.request.error}` : ''}</span>;
    else
      line = (
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-[var(--pc-warn)]" /> Waiting for CraftBot
        </span>
      );
  }
  return (
    <div className="pc-in flex flex-col items-end gap-1">
      <div className="max-w-[80%] whitespace-pre-wrap rounded-[var(--pc-radius)] bg-[var(--pc-ink)] px-3.5 py-2 text-[13.5px] leading-[21px] text-[var(--pc-page)]">{m.text}</div>
      <div className="pc-label flex items-center gap-2 normal-case tracking-normal">
        {line}
        <span className="text-[var(--pc-faint)]">{time(m.created)}</span>
      </div>
      {m.songs !== undefined && m.songs.length > 0 && <Added songs={m.songs} />}
    </div>
  );
}

function Added({ songs }: { songs: Song[] }): React.JSX.Element {
  return (
    <div className="mt-2 flex w-full max-w-[440px] flex-col gap-2">
      {songs.map((s) => (
        <div key={s.id} className="pc-pop flex items-center gap-3 rounded-[var(--pc-radius)] border border-[var(--pc-line)] bg-[var(--pc-raised)] p-2">
          <span className="w-[76px] shrink-0 overflow-hidden rounded-[4px] border border-[var(--pc-hair)]">
            <MiniRoll preview={s.preview} height={40} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 truncate text-[13px] font-semibold">
              <Music size={12} aria-hidden className="shrink-0 text-[var(--pc-muted)]" />
              {s.title}
            </span>
            <span className="pc-label block truncate">
              Level {s.level} · {s.key} · {s.bars} bars
            </span>
          </span>
          <a href={href('practice', { song: s.id })} className="pc-focus inline-flex h-8 items-center gap-1 rounded-[var(--pc-radius-sm)] bg-[var(--pc-ink)] px-2.5 text-[12px] font-medium text-[var(--pc-page)] hover:brightness-125">
            <Play size={12} fill="currentColor" aria-hidden /> Play
          </a>
        </div>
      ))}
    </div>
  );
}
