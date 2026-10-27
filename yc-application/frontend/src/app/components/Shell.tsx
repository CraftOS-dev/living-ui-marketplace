/**
 * The frame every step shares: a warm canvas holding one rounded shell. The
 * top bar carries the app's name, the five steps as one segmented bar (the
 * current step is an ink pill that slides between them) and two status
 * pills. Beside the step: the one thing to do next (dark card), the odds
 * (gauge) and a chat with your AI agent.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowRight, Check, Clock, Send } from 'lucide-react';
import { cn, useAgentRequest } from '../../kit/index.ts';
import { op } from '../lib/api.ts';
import { changed } from '../lib/live.ts';
import { ago, deadlineText } from '../lib/format.ts';
import { reducedMotion } from '../lib/motion.tsx';
import { href, targetHref, type Page } from '../lib/router.ts';
import type { Message, Pipeline } from '../lib/types.ts';
import { Gauge } from './Charts.tsx';
import { YcLogo } from './YcLogo.tsx';
import { AutoText, Card, CardHeader, PillButton, PillLink, StatusPill, Tip } from './ui.tsx';

export interface StepInfo {
  page: Page;
  name: string;
  /** One line under the name: a count, or what needs doing. */
  meta: string;
  /** The meta line is something to fix or answer. */
  alert: boolean;
  done: boolean;
}

export function stepsOf(p: Pipeline): StepInfo[] {
  const s = Object.fromEntries(p.stages.map((x) => [x.key, x]));
  const sec = p.sections;
  const missing = sec.reduce((n, x) => n + x.missing, 0);
  const needs = sec.reduce((n, x) => n + x.needs, 0);
  const answered = sec.reduce((n, x) => n + x.answered, 0);
  const total = sec.reduce((n, x) => n + x.total, 0);
  const teamIssues = p.top.filter((c) => c.group === 'team' && c.severity === 'blocker').length;
  const plural = (n: number, one: string, many: string): string => n + ' ' + (n === 1 ? one : many);
  const files = p.sources.filter((x) => x.file !== '').length;
  const links = p.sources.length - files;
  const added = [links > 0 ? plural(links, 'link', 'links') : '', files > 0 ? plural(files, 'file', 'files') : ''].filter((x) => x !== '').join(', ');
  return [
    { page: 'links', name: 'Links & files', meta: added === '' ? 'Add links or files' : added, alert: false, done: s.gather?.state === 'done' },
    {
      page: 'team',
      name: 'Team',
      meta: teamIssues > 0 ? teamIssues + ' to fix' : p.founders.length === 0 ? 'No founders yet' : plural(p.founders.length, 'founder', 'founders'),
      alert: teamIssues > 0,
      done: s.team?.state === 'done',
    },
    {
      page: 'answers',
      name: 'Answers',
      meta: needs > 0 ? needs + ' need you' : missing > 0 ? missing + ' empty' : answered + ' of ' + total,
      alert: needs > 0 || missing > 0,
      done: s.answers?.state === 'done',
    },
    {
      page: 'polish',
      name: 'Polish',
      meta: p.totals.blockers > 0 ? p.totals.blockers + ' to fix' : p.totals.warnings > 0 ? p.totals.warnings + ' to improve' : 'Looks good',
      alert: p.totals.blockers > 0,
      done: s.review?.state === 'done',
    },
    { page: 'submit', name: 'Submit', meta: p.settings.status !== 'preparing' ? 'Sent' : 'Send to YC', alert: false, done: s.submit?.state === 'done' },
  ];
}

/** The step to open when none is chosen: the first one not done. */
export function currentStep(p: Pipeline): Page {
  return stepsOf(p).find((x) => !x.done)?.page ?? 'submit';
}

function StepItem({ st, n, active }: { st: StepInfo; n: number; active: boolean }): React.JSX.Element {
  return (
    <a
      href={href(st.page)}
      aria-current={active ? 'step' : undefined}
      className={cn(
        'group relative flex h-11 min-w-0 items-center justify-center gap-2.5 rounded-full transition-[background-color] duration-300 md:h-14 md:w-auto md:flex-1 md:justify-start md:px-2.5',
        active ? 'flex-1 px-2' : 'w-11 flex-none hover:bg-[var(--yc-hover)]',
      )}
    >
      {active && <span data-pill aria-hidden className="absolute inset-0 origin-left rounded-full bg-[var(--yc-ink)]" />}
      <span
        className={cn(
          'num relative flex size-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold transition-colors duration-300 md:size-9',
          active ? 'bg-[var(--yc-accent)] text-[var(--yc-on-accent)]' : st.done ? 'bg-[var(--yc-green)] text-white' : 'bg-[var(--yc-row)] text-[var(--yc-ink-2)] group-hover:bg-[var(--yc-card)]',
        )}
      >
        {st.done && !active ? <Check size={16} strokeWidth={3} /> : n}
      </span>
      <span className={cn('relative min-w-0', active ? 'block' : 'hidden md:block')}>
        <span className={cn('block truncate text-[13px] font-bold md:text-[14px]', active ? 'text-[var(--yc-shell)]' : 'text-[var(--yc-ink)]')}>{st.name}</span>
        <span className={cn('hidden items-center gap-1.5 text-[12px] md:flex', active ? 'text-[var(--yc-on-dark-muted)]' : 'text-[var(--yc-muted)]')}>
          {st.alert && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--yc-accent)]" />}
          <span className="truncate">{st.meta}</span>
        </span>
      </span>
    </a>
  );
}

function Steps({ p, on, className }: { p: Pipeline; on: Page; className?: string }): React.JSX.Element {
  const steps = stepsOf(p);
  const nav = useRef<HTMLElement>(null);
  const last = useRef<{ x: number; w: number } | null>(null);
  // The ink pill slides from the step it was on to the new one.
  useLayoutEffect(() => {
    const pill = nav.current?.querySelector<HTMLElement>('[data-pill]');
    const item = pill?.parentElement;
    if (!pill || !item) return;
    const now = { x: item.offsetLeft, w: item.offsetWidth };
    const prev = last.current;
    last.current = now;
    if (prev === null || reducedMotion() || (prev.x === now.x && prev.w === now.w)) return;
    pill.animate([{ transform: `translateX(${prev.x - now.x}px) scaleX(${prev.w / now.w})` }, { transform: 'none' }], { duration: 360, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
  }, [on]);
  // Keep the slide's starting point true when the window changes size.
  useLayoutEffect(() => {
    const el = nav.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const item = el.querySelector<HTMLElement>('[data-pill]')?.parentElement;
      if (item) last.current = { x: item.offsetLeft, w: item.offsetWidth };
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <nav ref={nav} aria-label="Steps" className={cn('yc-rise flex min-w-0 items-center gap-1 rounded-full border border-[var(--yc-border)] bg-[var(--yc-card)] p-1.5', className)}>
      {steps.map((st, i) => (
        <StepItem key={st.page} st={st} n={i + 1} active={st.page === on} />
      ))}
    </nav>
  );
}

/** The one thing to do next, from where the application stands. */
function nextAction(p: Pipeline, gatherStatus: string): { title: string; sub: string; href: string; label: string } {
  const sec = p.sections;
  const needs = sec.reduce((n, x) => n + x.needs, 0);
  const missing = sec.reduce((n, x) => n + x.missing, 0);
  const unconfirmed = sec.reduce((n, x) => n + x.unconfirmed, 0);
  if (p.settings.status !== 'preparing') return { title: 'Sent to YC', sub: 'Track the interview and the decision', href: href('submit'), label: 'Open' };
  if (p.sources.length === 0 && p.counts.answered === 0) return { title: 'Add links or files', sub: 'Your website, LinkedIn, pitch deck or business plan', href: href('links'), label: 'Add them' };
  const g = p.settings.gather_state;
  if ((g === 'requested' || g === 'working') && (gatherStatus === '' || gatherStatus === 'pending' || gatherStatus === 'claimed')) return { title: 'Your AI agent is filling it in', sub: gatherStatus === 'claimed' || g === 'working' ? 'Reading your links and files now' : 'Starts as soon as it is online', href: href('links'), label: 'Watch' };
  if (g !== 'done' && p.counts.answered < 8 && p.sources.length > 0) return { title: 'Let your AI agent fill it', sub: 'It reads your links and files and writes the answers', href: href('links'), label: 'Fill it' };
  const teamBlock = p.top.find((c) => c.group === 'team' && c.severity === 'blocker');
  if (p.founders.length === 0 || teamBlock) return { title: teamBlock ? teamBlock.title : 'Add your founders', sub: teamBlock ? teamBlock.fix : 'Name, title, who writes code', href: href('team'), label: 'Go to team' };
  if (needs > 0) return { title: needs === 1 ? 'Answer 1 question' : 'Answer ' + needs + ' questions', sub: 'Things only you know', href: href('answers', 'needs'), label: 'Answer' };
  if (missing > 0) return { title: missing === 1 ? 'Fill 1 empty answer' : 'Fill ' + missing + ' empty answers', sub: 'YC needs them', href: href('answers', 'missing'), label: 'Fill' };
  if (unconfirmed > 0) return { title: unconfirmed === 1 ? 'Confirm 1 answer' : 'Confirm ' + unconfirmed + ' answers', sub: 'Read what your AI agent wrote', href: href('answers', 'confirm'), label: 'Read' };
  const blocker = p.top.find((c) => c.severity === 'blocker');
  if (blocker) return { title: blocker.title, sub: blocker.fix, href: targetHref(blocker.target), label: 'Fix' };
  return { title: 'Send it to YC', sub: 'Your AI agent fills the form; you press Submit', href: href('submit'), label: 'Go' };
}

function NextCard({ p }: { p: Pipeline }): React.JSX.Element {
  const { request } = useAgentRequest(p.settings.gather_request !== '' ? p.settings.gather_request : null);
  const n = nextAction(p, request?.status ?? '');
  return (
    <Card tone="dark">
      <StatusPill tone="dark">Next</StatusPill>
      <div>
        <p className="mt-4 text-[15px] font-bold leading-[22px]">{n.title}</p>
        <p className="mt-1 text-[13px] text-[var(--yc-muted)]">{n.sub}</p>
      </div>
      <PillLink variant="accent" className="mt-5 w-full" href={n.href}>
        {n.label} <ArrowRight size={16} />
      </PillLink>
    </Card>
  );
}

function OddsCard({ p }: { p: Pipeline }): React.JSX.Element {
  const o = p.odds;
  return (
    <Card>
      <CardHeader
        title="Your odds"
        subtitle={o.ready ? o.band : 'Add your team and a few answers'}
        action={
          <a href={href('polish')} className="text-[13px] font-semibold underline underline-offset-4 hover:decoration-2">
            Why
          </a>
        }
      />
      <Gauge odds={o} size={190} />
      {o.ready && <p className="mt-1 text-center text-[13px] text-[var(--yc-muted)]">{o.rank}</p>}
    </Card>
  );
}

function Waiting({ m }: { m: Message }): React.JSX.Element | null {
  const open = m.role === 'person' && m.state !== 'answered';
  const { request } = useAgentRequest(open && m.request !== '' ? m.request : null);
  if (!open) return null;
  return <span> · {m.state === 'failed' ? 'not delivered' : request?.status === 'claimed' ? 'working on it' : 'waiting'}</span>;
}

function AskCard({ messages }: { messages: Message[] }): React.JSX.Element {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async (): Promise<void> => {
    const t = text.trim();
    if (t === '' || busy) return;
    setBusy(true);
    setText('');
    try {
      await op('messages.send', { text: t });
      changed('messages');
    } catch {
      setText(t);
    } finally {
      setBusy(false);
    }
  };
  const last = messages.slice(-4);
  return (
    <Card>
      <CardHeader title="Tell your AI agent" />
      {last.length > 0 && (
        <div className="mb-3 grid max-h-[260px] gap-2 overflow-y-auto">
          {last.map((m) => (
            <div key={m.id} className={cn('rounded-[18px] px-4 py-3 text-[13px] leading-5', m.role === 'person' ? 'ml-6 bg-[var(--yc-ink)] text-[var(--yc-shell)]' : 'mr-6 bg-[var(--yc-row)]')}>
              <div className={cn('mb-0.5 text-[12px]', m.role === 'person' ? 'opacity-70' : 'text-[var(--yc-muted)]')}>
                {m.role === 'agent' ? 'Your AI agent' : 'You'}, {ago(m.created)}
                <Waiting m={m} />
              </div>
              <div className="whitespace-pre-wrap">{m.text}</div>
            </div>
          ))}
        </div>
      )}
      <AutoText
        minRows={2}
        value={text}
        placeholder="We signed our 4th customer today"
        aria-label="Tell your AI agent"
        className="text-[14px]"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void send();
          }
        }}
      />
      <PillButton variant="dark" className="mt-3 w-full" icon={Send} disabled={busy || text.trim() === ''} onClick={() => void send()}>
        Send
      </PillButton>
    </Card>
  );
}

export function Frame({ p, on, messages, children }: { p: Pipeline; on: Page; messages: Message[]; children: ReactNode }): React.JSX.Element {
  const dl = deadlineText(p.settings.deadline);
  return (
    <div className="yc-app min-h-screen bg-[var(--yc-canvas)] md:p-4">
      <div className="mx-auto min-h-screen max-w-[1440px] bg-[var(--yc-shell)] px-4 pb-16 pt-5 md:min-h-[calc(100vh-32px)] md:rounded-[36px] md:px-8 md:pt-7">
        <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-4 xl:grid-cols-[auto_minmax(0,1fr)_auto] xl:gap-x-6">
          <a href={href(currentStep(p))} className="yc-rise flex items-center gap-2.5 whitespace-nowrap text-[15px] font-extrabold tracking-[-0.01em]">
            <YcLogo size={28} />
            YC Application
          </a>
          <Steps p={p} on={on} className="col-span-2 row-start-3 sm:row-start-2 xl:col-span-1 xl:col-start-2 xl:row-start-1 xl:mx-auto xl:w-full xl:max-w-[900px]" />
          <div className="yc-rise col-span-2 row-start-2 flex flex-wrap items-center gap-2 sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:justify-end xl:col-start-3 xl:row-start-1">
            {p.odds.ready && (
              <Tip text={p.odds.band + '. ' + p.odds.rank}>
                <a href={href('polish')} className="yc-edge inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--yc-border)] bg-[var(--yc-card)] px-3.5 text-[13px] font-semibold">
                  <span aria-hidden className="size-1.5 rounded-full bg-[var(--yc-accent)]" />
                  {p.odds.percent !== null ? p.odds.percent + '% odds' : 'Odds n/a'}
                </a>
              </Tip>
            )}
            {dl.left !== '' && p.settings.status === 'preparing' && (
              <Tip text={p.settings.batch + ' deadline: ' + dl.when}>
                <a href={href('submit')} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[var(--yc-ink)] px-3.5 text-[13px] font-semibold text-[var(--yc-shell)] transition-colors hover:bg-[var(--yc-ink-2)]">
                  <Clock size={14} /> {dl.left}
                </a>
              </Tip>
            )}
          </div>
        </header>
        <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <main className="min-w-0">{children}</main>
          <aside className="grid content-start gap-4">
            <NextCard p={p} />
            {on !== 'polish' && <OddsCard p={p} />}
            <AskCard messages={messages} />
          </aside>
        </div>
      </div>
    </div>
  );
}
