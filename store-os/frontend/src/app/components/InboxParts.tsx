/**
 * The inbox's pieces: a conversation row, message bubbles, the reply
 * composer (your AI agent's draft, the ways to send, the warnings), the
 * buyer and order panel, and the small dialogs (log a buyer message, link
 * an order, add a private note).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, AlertTriangle, Check, ChevronDown, ChevronRight, Copy, Link2, Mail, Package, PenLine, Phone, Sparkles, StickyNote } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { changed } from '../lib/live.ts';
import { copyText, op } from '../lib/api.ts';
import { ago, dayShort, dayTime, INTENT_LABEL, money, STATUS_LABEL, time, toDate } from '../lib/format.ts';
import { href } from '../lib/router.ts';
import { useStore } from '../lib/store.tsx';
import { notify } from '../lib/toast.tsx';
import type { Message, ThreadDetail, ThreadRow } from '../lib/types.ts';
import { Clock, OrderStatus, TrackPill } from './badges.tsx';
import { PlatformMark } from './PlatformMark.tsx';
import { Avatar, Button, Dialog, Field, Pill, Select, TaskBadge, TextArea, TextInput, Tip, Toggle } from './ui.tsx';

/* ---------------------------------------------------------------- helpers */

export const CHANNEL_LABEL: Record<string, string> = { chat: 'Chat', email: 'Email', whatsapp: 'WhatsApp', phone: 'Phone', social: 'Social', other: 'Other' };

/** The time of a message: "14:05" today, "29 Oct, 14:05" before. */
function when(at: string): string {
  const d = toDate(at);
  if (d === null) return '';
  return d.toDateString() === new Date().toDateString() ? time(at) : dayTime(at);
}

export function buyerName(t: Pick<ThreadRow, 'buyer' | 'customer'>): string {
  return t.buyer || t.customer?.name || 'Buyer';
}

function Spinner(): React.JSX.Element {
  return <span aria-hidden className="so-spin size-4 shrink-0 rounded-full border-2 border-current border-t-transparent" />;
}

/** A small panel under (or over) a button, for a menu or a short form. */
export function Popover({ anchor, open, onClose, children, width = 300, role = 'dialog', label }: { anchor: React.RefObject<HTMLElement | null>; open: boolean; onClose: () => void; children: ReactNode; width?: number; role?: 'dialog' | 'menu'; label: string }): React.JSX.Element | null {
  const [pos, setPos] = useState<{ left: number; top: number | undefined; bottom: number | undefined; w: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const r = anchor.current?.getBoundingClientRect();
    if (r === undefined) return;
    const w = Math.min(width, window.innerWidth - 16);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    const up = r.top > window.innerHeight - r.bottom;
    setPos(up ? { left, top: undefined, bottom: window.innerHeight - r.top + 6, w } : { left, top: r.bottom + 6, bottom: undefined, w });
  }, [open, anchor, width]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onClose);
    };
  }, [open, onClose]);
  if (!open || pos === null) return null;
  return createPortal(
    <div className="so-portal fixed inset-0 z-[70]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role={role}
        aria-label={label}
        className="so-drop absolute rounded-[16px] bg-[var(--so-card)] p-1.5 text-[var(--so-ink)] shadow-[0_18px_50px_-12px_var(--so-shadow)] ring-1 ring-[var(--so-border)]"
        style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.w }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** A compact select as a grey pill (for a card header). */
export function PillSelect({ value, onChange, label, children, className }: { value: string; onChange: (v: string) => void; label: string; children: ReactNode; className?: string }): React.JSX.Element {
  return (
    <span className={cn('relative inline-flex min-w-0', className)}>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 min-w-0 max-w-full appearance-none truncate rounded-full bg-[var(--so-tile)] pl-3 pr-8 text-[13px] font-semibold text-[var(--so-ink)] outline-none ring-[var(--so-ink)] hover:bg-[var(--so-tile-hover)] focus-visible:ring-2"
      >
        {children}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--so-muted)]" aria-hidden />
    </span>
  );
}

/* ------------------------------------------------------------ thread row */

/** One conversation in the list. */
export function ThreadItem({ row, on, view }: { row: ThreadRow; on: boolean; view: string }): React.JSX.Element {
  const from = row.last_from === 'you' ? 'You: ' : row.last_from === 'agent' ? 'Your AI agent: ' : '';
  const draftLabel = row.has_draft ? (row.draft_by === 'you' ? 'Your draft' : 'Draft ready') : '';
  const pills = row.intent !== '' || draftLabel !== '' || row.task !== null;
  return (
    <a
      href={href('inbox', view, row.id)}
      aria-current={on ? 'true' : undefined}
      className={cn('flex cursor-pointer gap-3 rounded-[14px] px-3 py-3', on ? 'bg-[var(--so-tile)] hover:bg-[var(--so-tile-hover)]' : 'hover:bg-[var(--so-row-hover)]')}
    >
      <PlatformMark platform={row.shop?.platform ?? 'other'} size={32} onCard={!on} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          {row.unread && <span aria-label="Unread" className="size-2 shrink-0 rounded-full bg-[var(--so-accent)]" />}
          <span className={cn('min-w-0 flex-1 truncate text-[14px] text-[var(--so-ink)]', row.unread ? 'font-bold' : 'font-medium')}>{buyerName(row)}</span>
          {row.hours_left !== null ? <Clock hours={row.hours_left} className="shrink-0" /> : <span className="shrink-0 whitespace-nowrap text-[12px] text-[var(--so-muted)]">{ago(row.last_at)}</span>}
        </span>
        <span className={cn('mt-0.5 block truncate text-[13px]', row.unread ? 'font-semibold text-[var(--so-ink)]' : 'text-[var(--so-ink-2)]')}>{row.subject || 'No subject'}</span>
        <span className="block truncate text-[13px] text-[var(--so-muted)]">
          {from}
          {row.snippet}
        </span>
        {pills && (
          <span className="mt-2 flex flex-wrap items-center gap-1.5">
            {row.intent !== '' && <Pill>{INTENT_LABEL[row.intent] ?? row.intent}</Pill>}
            {draftLabel !== '' && <Pill tone={row.draft_by === 'you' ? 'neutral' : 'accent'}>{draftLabel}</Pill>}
            <TaskBadge task={row.task} />
          </span>
        )}
      </span>
    </a>
  );
}

/* --------------------------------------------------------------- messages */

/** One message: the buyer on the left, you and your AI agent on the right, private notes across. */
export function MessageItem({ m, onRetry }: { m: Message; onRetry: (text: string) => void }): React.JSX.Element {
  if (m.direction === 'note') {
    return (
      <div className="rounded-[14px] bg-[var(--so-amber-soft)] px-4 py-3">
        <div className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-[var(--so-amber-text)]">
          <StickyNote size={13} strokeWidth={2.2} aria-hidden />
          <span>{m.author === 'agent' ? 'Note by your AI agent' : 'Note'}</span>
          <span className="ml-auto font-medium">{when(m.at)}</span>
        </div>
        <p className="whitespace-pre-wrap break-words text-[14px] leading-[22px] text-[var(--so-ink)]">{m.body}</p>
      </div>
    );
  }
  const mine = m.direction === 'out';
  const byAgent = mine && (m.author === 'agent' || m.via === 'agent');
  const via = mine && m.state === 'sent' ? (m.via === 'copied' ? 'Pasted in seller centre' : m.via === 'manual' ? 'Sent another way' : '') : '';
  return (
    <div className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}>
      {byAgent && (
        <span className="mb-1 inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--so-accent-text)]">
          <Sparkles size={12} strokeWidth={2.2} aria-hidden />
          Your AI agent
        </span>
      )}
      <div
        className={cn(
          'max-w-[min(560px,88%)] whitespace-pre-wrap break-words rounded-[18px] px-4 py-2.5 text-[14px] leading-[22px]',
          mine ? 'rounded-br-[6px] bg-[var(--so-primary)] text-[var(--so-on-primary)]' : 'rounded-bl-[6px] bg-[var(--so-tile)] text-[var(--so-ink)]',
        )}
      >
        {m.body}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[12px] text-[var(--so-muted)]">
        {m.state === 'sending' && (
          <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--so-accent-text)]">
            <span aria-hidden className="so-breathe size-1.5 rounded-full bg-[var(--so-accent)]" />
            Your AI agent is sending
          </span>
        )}
        {via !== '' && <span>{via}</span>}
        <span>{when(m.at)}</span>
      </div>
      {m.state === 'failed' && (
        <div className="mt-1 flex max-w-[min(560px,88%)] flex-wrap items-start justify-end gap-x-2 text-[12px] font-semibold text-[var(--so-red-text)]">
          <span className="inline-flex items-start gap-1">
            <AlertCircle size={13} strokeWidth={2.2} className="mt-0.5 shrink-0" aria-hidden />
            <span>Not sent{m.error !== '' ? ': ' + m.error : ''}</span>
          </span>
          <button type="button" onClick={() => onRetry(m.body)} className="hit rounded-full underline underline-offset-2 hover:text-[var(--so-red)]">
            Send it again
          </button>
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- composer */

export type SendMode = 'copied' | 'agent' | 'manual';

interface SendChoice {
  mode: SendMode;
  label: string;
  tip: string;
  icon: LucideIcon;
}

function choicesFor(shop: ThreadDetail['shop_detail']): [SendChoice, SendChoice, SendChoice] {
  const url = shop?.admin_url ?? '';
  return [
    {
      mode: 'copied',
      label: url !== '' ? 'Copy and open seller centre' : 'Copy and mark as sent',
      tip: url !== '' ? 'Copies the reply, opens the ' + (shop?.name ?? '') + ' seller centre to paste it, and records it as sent' : 'Copies the reply to paste where the buyer wrote, and records it as sent',
      icon: Copy,
    },
    { mode: 'agent', label: 'Send with your AI agent', tip: 'Your AI agent sends it and confirms here', icon: Sparkles },
    { mode: 'manual', label: 'Mark as sent', tip: 'You already sent it another way', icon: Check },
  ];
}

const SEND_KEY = 'so-inbox-send:';

function readChoice(shopId: string): SendMode {
  try {
    const v = window.localStorage.getItem(SEND_KEY + shopId);
    if (v === 'copied' || v === 'agent' || v === 'manual') return v;
  } catch {
    /* storage can be blocked; the default stands */
  }
  return 'copied';
}

function keepChoice(shopId: string, mode: SendMode): void {
  try {
    window.localStorage.setItem(SEND_KEY + shopId, mode);
  } catch {
    /* storage can be blocked; nothing to keep */
  }
}

/**
 * The reply box. Your AI agent's draft (or yours) is edited in place and
 * saved when you leave the box; sending records the reply the way you pick.
 * `seed` puts a text in the box (a reply that could not be sent).
 */
export function Composer({ thread, seed }: { thread: ThreadDetail; seed: { text: string; n: number } | null }): React.JSX.Element {
  const shopId = thread.shop_detail?.id ?? thread.shop?.id ?? 'none';
  const choices = choicesFor(thread.shop_detail);
  const [text, setText] = useState(thread.draft);
  const [base, setBase] = useState(thread.draft);
  const [mode, setMode] = useState<SendMode>(() => readChoice(shopId));
  const [close, setClose] = useState(false);
  const [busy, setBusy] = useState<SendMode | 'ask' | null>(null);
  const [whyOpen, setWhyOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [askNote, setAskNote] = useState('');
  const area = useRef<HTMLTextAreaElement>(null);
  const split = useRef<HTMLDivElement>(null);
  const askAnchor = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ text, base });
  latest.current = { text, base };

  // A new draft from the server replaces the box only while you have not changed it.
  useEffect(() => {
    if (latest.current.text === latest.current.base) setText(thread.draft);
    setBase(thread.draft);
  }, [thread.draft]);

  useEffect(() => {
    if (seed === null) return;
    setText(seed.text);
    area.current?.focus();
  }, [seed]);

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(Math.max(el.scrollHeight, 88), 280) + 'px';
  }, [text]);

  const save = useCallback(async (): Promise<void> => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const t = latest.current.text;
    if (t === latest.current.base) return;
    try {
      await op('inbox.draft', { thread: thread.id, text: t, why: thread.draft_why }, { quiet: true });
      latest.current = { text: latest.current.text, base: t };
      setBase(t);
      changed('threads');
    } catch {
      /* the text stays in the box */
    }
  }, [thread.id, thread.draft_why]);

  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(
    () => () => {
      void saveRef.current();
    },
    [],
  );

  const send = async (m: SendMode): Promise<void> => {
    const body = text.trim();
    if (body === '' || busy !== null) return;
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setMode(m);
    keepChoice(shopId, m);
    setBusy(m);
    try {
      if (m === 'copied') {
        const ok = await copyText(body);
        if (!ok) {
          notify.error('Could not copy. Copy the reply yourself, then choose Mark as sent.');
          return;
        }
        const url = thread.shop_detail?.admin_url ?? '';
        if (url !== '') window.open(url, '_blank', 'noopener,noreferrer');
      }
      await op('inbox.reply', { thread: thread.id, text: body, mode: m, close });
      latest.current = { text: '', base: '' };
      setText('');
      setBase('');
      setClose(false);
      notify.info(m === 'agent' ? 'Handed to your AI agent' : m === 'copied' ? 'Copied and marked as sent' : 'Marked as sent');
      changed('threads', 'messages', 'tasks');
    } catch {
      /* op showed why */
    } finally {
      setBusy(null);
    }
  };

  const ask = async (): Promise<void> => {
    setBusy('ask');
    try {
      await save();
      await op('inbox.ask-draft', { thread: thread.id, note: askNote.trim() || undefined });
      setAskOpen(false);
      setAskNote('');
      notify.info('Asked your AI agent for a draft');
      changed('tasks', 'threads');
    } catch {
      /* op showed why */
    } finally {
      setBusy(null);
    }
  };

  const current = choices.find((c) => c.mode === mode) ?? choices[0];
  const CurrentIcon = current.icon;
  const framed = thread.draft !== '';
  const byAgent = thread.draft_by === 'agent';
  const drafting = thread.task !== null && thread.task.kind === 'draft_reply';
  const empty = text.trim() === '';
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const closeAsk = useCallback(() => setAskOpen(false), []);

  return (
    <div className="shrink-0 border-t border-[var(--so-line)] p-3 sm:p-4">
      <div className={cn('rounded-[16px]', framed && 'bg-[var(--so-accent-soft)] p-3')}>
        {framed ? (
          <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--so-accent-text)]">
              {byAgent ? <Sparkles size={14} strokeWidth={2.2} aria-hidden /> : <PenLine size={14} strokeWidth={2.2} aria-hidden />}
              {byAgent ? 'Draft by your AI agent' : 'Your draft'}
            </span>
            {thread.draft_at !== '' && <span className="text-[12px] text-[var(--so-muted)]">{ago(thread.draft_at)}</span>}
          </div>
        ) : null}
        {framed && thread.draft_why !== '' ? (
          <button type="button" onClick={() => setWhyOpen(!whyOpen)} aria-expanded={whyOpen} className="mb-2 flex w-full items-start gap-1 rounded-[8px] text-left text-[12px] leading-[18px] text-[var(--so-muted)] hover:text-[var(--so-ink)]">
            {whyOpen ? <ChevronDown size={14} className="mt-0.5 shrink-0" aria-hidden /> : <ChevronRight size={14} className="mt-0.5 shrink-0" aria-hidden />}
            <span className={cn('min-w-0 flex-1 whitespace-pre-wrap', !whyOpen && 'truncate')}>
              <span className="font-semibold">Why: </span>
              {thread.draft_why}
            </span>
          </button>
        ) : null}
        {framed && thread.draft_lint.length > 0 ? (
          <ul className="mb-2 space-y-1">
            {thread.draft_lint.map((l) => (
              <li key={l} className="flex items-start gap-1.5 text-[12px] font-medium leading-[18px] text-[var(--so-amber-text)]">
                <AlertTriangle size={13} strokeWidth={2.2} className="mt-0.5 shrink-0" aria-hidden />
                {l}
              </li>
            ))}
          </ul>
        ) : null}
        <textarea
          ref={area}
          value={text}
          aria-label="Reply"
          placeholder={drafting ? 'Your AI agent is drafting a reply' : 'Write a reply'}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => {
            if (timer.current !== null) {
              clearTimeout(timer.current);
              timer.current = null;
            }
          }}
          onBlur={() => {
            if (timer.current !== null) clearTimeout(timer.current);
            timer.current = setTimeout(() => void save(), 250);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void send(mode);
            }
          }}
          className={cn(
            'block w-full resize-none rounded-[12px] px-3.5 py-2.5 text-[14px] leading-[22px] text-[var(--so-ink)] outline-none ring-[var(--so-ink)] transition-shadow focus-visible:ring-2',
            framed ? 'bg-[var(--so-card)]' : 'bg-[var(--so-tile)]',
          )}
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div ref={split} className="inline-flex max-w-full rounded-full bg-[var(--so-primary)] text-[var(--so-on-primary)]">
          <Tip text={current.tip + ' (Ctrl+Enter)'} className="min-w-0">
            <button
              type="button"
              disabled={empty || busy !== null}
              onClick={() => void send(mode)}
              className="so-press inline-flex h-10 min-w-0 items-center gap-2 rounded-l-full pl-4 pr-3 text-[14px] font-semibold hover:bg-[var(--so-primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy !== null && busy !== 'ask' ? <Spinner /> : <CurrentIcon size={16} strokeWidth={2} aria-hidden className="shrink-0" />}
              <span className="truncate">{current.label}</span>
            </button>
          </Tip>
          <span aria-hidden className="my-2 w-px bg-[color-mix(in_srgb,var(--so-on-primary)_28%,transparent)]" />
          <button
            type="button"
            aria-label="Ways to send"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            disabled={busy !== null}
            onClick={() => setMenuOpen(!menuOpen)}
            className="hit so-press inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-r-full hover:bg-[var(--so-primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ChevronDown size={16} strokeWidth={2} aria-hidden />
          </button>
        </div>
        <span ref={askAnchor} className="inline-flex">
          <Button variant="secondary" icon={Sparkles} loading={busy === 'ask'} disabled={busy !== null && busy !== 'ask'} onClick={() => setAskOpen(!askOpen)}>
            Draft with your AI agent
          </Button>
        </span>
        {thread.status !== 'closed' && (
          <Tip text="Close the conversation once the reply is sent" className="ml-auto items-center gap-2">
            <Toggle checked={close} onChange={setClose} label="Close after sending" />
            <span className="text-[13px] font-medium text-[var(--so-ink-2)]">Close</span>
          </Tip>
        )}
      </div>
      <Popover anchor={split} open={menuOpen} onClose={closeMenu} width={320} role="menu" label="Ways to send">
        {choices.map((c) => {
          const I = c.icon;
          return (
            <button
              key={c.mode}
              type="button"
              role="menuitemradio"
              aria-checked={c.mode === mode}
              disabled={empty}
              onClick={() => {
                setMenuOpen(false);
                void send(c.mode);
              }}
              className="flex w-full items-start gap-2.5 rounded-[10px] px-2.5 py-2 text-left hover:bg-[var(--so-tile)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <I size={15} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold">{c.label}</span>
                <span className="block text-[12px] leading-[18px] text-[var(--so-muted)]">{c.tip}</span>
              </span>
              {c.mode === mode && <Check size={15} strokeWidth={2.4} className="mt-0.5 shrink-0" aria-label="Default" />}
            </button>
          );
        })}
      </Popover>
      <Popover anchor={askAnchor} open={askOpen} onClose={closeAsk} width={340} label="Draft with your AI agent">
        <div className="p-2">
          <p className="mb-2 text-[13px] font-semibold">Draft with your AI agent</p>
          <TextArea rows={3} autoFocus value={askNote} onChange={(e) => setAskNote(e.target.value)} placeholder="What should it say? (optional)" />
          <div className="mt-3 flex justify-end">
            <Button size="sm" icon={Sparkles} loading={busy === 'ask'} onClick={() => void ask()}>
              Ask for a draft
            </Button>
          </div>
        </div>
      </Popover>
    </div>
  );
}

/* ------------------------------------------------------------ buyer panel */

function Section({ title, action, children, className }: { title: string; action?: ReactNode; children: ReactNode; className?: string }): React.JSX.Element {
  return (
    <section className={cn('border-t border-[var(--so-line)] px-5 py-4 first:border-t-0', className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[12px] font-semibold text-[var(--so-muted)]">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Thumb({ src }: { src: string }): React.JSX.Element {
  return (
    <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-[var(--so-tile)] text-[var(--so-muted)]">
      {src !== '' ? <img src={src} alt="" className="size-full object-cover" /> : <Package size={16} aria-hidden />}
    </span>
  );
}

const POLICIES: { key: 'returns' | 'shipping' | 'faq'; label: string }[] = [
  { key: 'returns', label: 'Returns' },
  { key: 'shipping', label: 'Shipping' },
  { key: 'faq', label: 'FAQ' },
];

/** The policy that answers this kind of question, open by default. */
function policyFor(intent: string): string {
  if (intent === 'return' || intent === 'refund' || intent === 'complaint') return 'returns';
  if (intent === 'where_is_order' || intent === 'change_address' || intent === 'cancel') return 'shipping';
  if (intent === 'product_question') return 'faq';
  return '';
}

function Policies({ thread }: { thread: ThreadDetail }): React.JSX.Element | null {
  const shop = thread.shop_detail;
  const [open, setOpen] = useState<string>(() => policyFor(thread.intent));
  if (shop === null) return null;
  const written = POLICIES.some((p) => shop.policies[p.key].trim() !== '');
  return (
    <Section
      title={shop.name + ' policies'}
      action={
        <a href={href('shop', shop.id)} className="rounded-full px-2 py-1 text-[12px] font-semibold text-[var(--so-ink-2)] hover:bg-[var(--so-row-hover)] hover:text-[var(--so-ink)]">
          {written ? 'Edit' : 'Add'}
        </a>
      }
    >
      {!written ? (
        <p className="text-[13px] text-[var(--so-muted)]">No policies yet. Your AI agent quotes them in drafts.</p>
      ) : (
        <div className="-mx-2 space-y-0.5">
          {POLICIES.map((p) => {
            const body = shop.policies[p.key].trim();
            const on = open === p.key;
            return (
              <div key={p.key}>
                <button type="button" aria-expanded={on} onClick={() => setOpen(on ? '' : p.key)} className="flex h-9 w-full items-center gap-2 rounded-[10px] px-2 text-left text-[13px] font-semibold hover:bg-[var(--so-row-hover)]">
                  {on ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
                  <span className="flex-1">{p.label}</span>
                  {body === '' && <span className="text-[12px] font-medium text-[var(--so-faint)]">Empty</span>}
                </button>
                {on && <p className="whitespace-pre-wrap break-words px-2 pb-2 pl-8 text-[13px] leading-5 text-[var(--so-ink-2)]">{body !== '' ? body : 'Nothing written yet.'}</p>}
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

/** The buyer, the order the conversation is about, their other orders and the shop's policies. */
export function BuyerPanel({ thread, onLinkOrder }: { thread: ThreadDetail; onLinkOrder: () => void }): React.JSX.Element {
  const c = thread.customer_detail;
  const o = thread.order_detail;
  const name = c?.name || buyerName(thread);
  const ship = o !== null ? (o.shipments[o.shipments.length - 1] ?? null) : null;
  const others = thread.customer_orders.filter((r) => r.id !== o?.id).slice(0, 6);
  const [linking, setLinking] = useState('');

  const link = async (orderId: string): Promise<void> => {
    setLinking(orderId);
    try {
      await op('inbox.update', { thread: thread.id, order: orderId });
      notify.info('Order linked');
      changed('threads');
    } catch {
      /* op showed why */
    } finally {
      setLinking('');
    }
  };

  return (
    <div>
      <Section title="Buyer" action={c !== null ? <a href={href('customers', 'all', c.id)} className="rounded-full px-2 py-1 text-[12px] font-semibold text-[var(--so-ink-2)] hover:bg-[var(--so-row-hover)] hover:text-[var(--so-ink)]">Open</a> : undefined}>
        <div className="flex items-center gap-3">
          <Avatar name={name} size={40} />
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold">{name}</p>
            <p className="text-[12px] text-[var(--so-muted)]">Via {CHANNEL_LABEL[thread.channel] ?? thread.channel}</p>
          </div>
        </div>
        {c !== null && (c.email !== '' || c.phone !== '') && (
          <div className="mt-3 space-y-1.5 text-[13px]">
            {c.email !== '' && (
              <a href={'mailto:' + c.email} className="flex min-w-0 items-center gap-2 text-[var(--so-ink-2)] hover:text-[var(--so-ink)]">
                <Mail size={14} className="shrink-0 text-[var(--so-muted)]" aria-hidden />
                <span className="truncate">{c.email}</span>
              </a>
            )}
            {c.phone !== '' && (
              <a href={'tel:' + c.phone.replace(/\s+/g, '')} className="flex min-w-0 items-center gap-2 text-[var(--so-ink-2)] hover:text-[var(--so-ink)]">
                <Phone size={14} className="shrink-0 text-[var(--so-muted)]" aria-hidden />
                <span className="truncate">{c.phone}</span>
              </a>
            )}
          </div>
        )}
        {c !== null && c.note !== '' && <p className="mt-3 whitespace-pre-wrap rounded-[12px] bg-[var(--so-tile)] px-3 py-2 text-[13px] leading-5 text-[var(--so-ink-2)]">{c.note}</p>}
      </Section>

      <Section
        title="Order"
        action={
          o !== null ? (
            <a href={href('orders', 'all', o.id)} className="rounded-full px-2 py-1 text-[12px] font-semibold text-[var(--so-ink-2)] hover:bg-[var(--so-row-hover)] hover:text-[var(--so-ink)]">
              Open order
            </a>
          ) : undefined
        }
      >
        {o === null ? (
          <div className="flex items-center justify-between gap-3 rounded-[14px] bg-[var(--so-tile)] px-3 py-2.5">
            <span className="text-[13px] text-[var(--so-muted)]">No order linked</span>
            <Button size="sm" variant="secondary" icon={Link2} onClick={onLinkOrder}>
              Link
            </Button>
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="num truncate text-[15px] font-semibold">{o.number}</span>
              <OrderStatus status={o.status} health={o.health} />
            </div>
            <p className="mt-0.5 truncate text-[12px] text-[var(--so-muted)]">
              {dayShort(o.placed_at)}, {o.shop.name}
            </p>
            <ul className="mt-3 space-y-2">
              {o.lines_detail.map((l) => (
                <li key={l.id} className="flex items-center gap-2.5">
                  <Thumb src={l.image} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{l.title}</span>
                    {l.option !== '' && <span className="block truncate text-[12px] text-[var(--so-muted)]">{l.option}</span>}
                  </span>
                  <span className="num shrink-0 text-[12px] text-[var(--so-muted)]">x{l.qty}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex items-center justify-between border-t border-[var(--so-line)] pt-3 text-[13px]">
              <span className="text-[var(--so-muted)]">Total</span>
              <span className="num font-semibold">{money(o.total, o.currency)}</span>
            </div>
            {(o.status === 'to_ship' || o.status === 'unpaid') && o.ship_by !== '' && (
              <div className="mt-2 flex items-center justify-between gap-2 text-[13px]">
                <span className="text-[var(--so-muted)]">Ship by {dayShort(o.ship_by)}</span>
                <Clock hours={o.hours_left} />
              </div>
            )}
            {ship !== null && (
              <div className="mt-3 rounded-[12px] bg-[var(--so-tile)] px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-[13px] font-semibold">{[ship.carrier, ship.tracking].filter((x) => x !== '').join(' ') || 'Shipment'}</span>
                  <TrackPill status={ship.status} />
                </div>
                {ship.last_event !== '' && (
                  <p className="mt-1 text-[12px] leading-[18px] text-[var(--so-muted)]">
                    {ship.last_event}
                    {ship.last_event_at !== '' ? ', ' + ago(ship.last_event_at) : ''}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </Section>

      {others.length > 0 && (
        <Section title={o !== null ? 'Other orders' : 'Their orders'}>
          <ul className="-mx-2 space-y-0.5">
            {others.map((r) => (
              <li key={r.id} className="flex items-center gap-1">
                <a href={href('orders', 'all', r.id)} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-[12px] px-2 py-2 hover:bg-[var(--so-row-hover)]">
                  <PlatformMark platform={r.shop.platform} size={24} />
                  <span className="min-w-0 flex-1">
                    <span className="num block truncate text-[13px] font-semibold">{r.number}</span>
                    <span className="block truncate text-[12px] text-[var(--so-muted)]">{r.first_item}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="num block text-[13px] font-semibold">{money(r.total, r.currency)}</span>
                    <span className="block text-[12px] text-[var(--so-muted)]">{STATUS_LABEL[r.status] ?? r.status}</span>
                  </span>
                </a>
                <Tip text="Link to this conversation">
                  <button
                    type="button"
                    aria-label={'Link order ' + r.number}
                    disabled={linking !== ''}
                    onClick={() => void link(r.id)}
                    className="hit flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--so-ink-2)] hover:bg-[var(--so-row-hover)] hover:text-[var(--so-ink)] disabled:opacity-50"
                  >
                    {linking === r.id ? <Spinner /> : <Link2 size={15} aria-hidden />}
                  </button>
                </Tip>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Policies thread={thread} />
    </div>
  );
}

/* ---------------------------------------------------------------- dialogs */

const CHANNELS = ['chat', 'email', 'whatsapp', 'phone', 'social', 'other'] as const;

function defaultChannel(platform: string, chat: string): string {
  if (platform === 'direct') return 'whatsapp';
  if (chat === 'email') return 'email';
  return 'chat';
}

function LogMessageForm({ onClose, thread, onLogged }: { onClose: () => void; thread: { id: string; buyer: string } | undefined; onLogged: (threadId: string) => void }): React.JSX.Element {
  const { shops } = useStore();
  const first = shops.find((s) => s.platform === 'direct') ?? shops[0];
  const [shop, setShop] = useState(first?.id ?? '');
  const [channel, setChannel] = useState(defaultChannel(first?.platform ?? 'direct', first?.chat ?? 'direct'));
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [order, setOrder] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const pickShop = (id: string): void => {
    setShop(id);
    const s = shops.find((x) => x.id === id);
    if (s !== undefined) setChannel(defaultChannel(s.platform, s.chat));
  };

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (text.trim() === '' || busy) return;
    setBusy(true);
    const c = contact.trim();
    const email = c.includes('@');
    try {
      const r = await op<{ thread: ThreadDetail }>(
        'inbox.add',
        thread !== undefined
          ? { thread: thread.id, text: text.trim() }
          : {
              shop: shop || undefined,
              buyer_name: name.trim() || undefined,
              buyer_email: email && c !== '' ? c : undefined,
              buyer_phone: !email && c !== '' ? c : undefined,
              order: order.trim() || undefined,
              channel,
              text: text.trim(),
            },
      );
      notify.info('Message logged');
      changed('threads', 'messages', 'customers');
      onClose();
      onLogged(r.thread.id);
    } catch {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={thread !== undefined ? 'Log a message from ' + (thread.buyer || 'the buyer') : 'Log a message'}
      subtitle="One that came by chat, email or phone"
      footer={
        <>
          <Button variant="tile" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="so-log-message" loading={busy} disabled={text.trim() === ''}>
            Log message
          </Button>
        </>
      }
    >
      <form id="so-log-message" onSubmit={(e) => void submit(e)} className="space-y-4">
        {thread === undefined && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Shop">
                <Select value={shop} onChange={(e) => pickShop(e.target.value)}>
                  {shops.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Came by">
                <Select value={channel} onChange={(e) => setChannel(e.target.value)}>
                  {CHANNELS.map((c) => (
                    <option key={c} value={c}>
                      {CHANNEL_LABEL[c] ?? c}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Buyer name">
                <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Aina" autoComplete="off" />
              </Field>
              <Field label="Phone or email">
                <TextInput value={contact} onChange={(e) => setContact(e.target.value)} autoComplete="off" />
              </Field>
            </div>
            <Field label="Order number" hint="Optional">
              <TextInput value={order} onChange={(e) => setOrder(e.target.value)} autoComplete="off" />
            </Field>
          </>
        )}
        <Field label="Message">
          <TextArea rows={4} autoFocus={thread !== undefined} value={text} onChange={(e) => setText(e.target.value)} placeholder="What the buyer wrote" />
        </Field>
      </form>
    </Dialog>
  );
}

/** Log a buyer message that came outside the shops (or one more in this conversation). */
export function LogMessageDialog({ open, onClose, thread, onLogged }: { open: boolean; onClose: () => void; thread?: { id: string; buyer: string } | undefined; onLogged: (threadId: string) => void }): React.JSX.Element | null {
  if (!open) return null;
  return <LogMessageForm onClose={onClose} thread={thread} onLogged={onLogged} />;
}

function LinkOrderForm({ thread, onClose }: { thread: ThreadDetail; onClose: () => void }): React.JSX.Element {
  const [value, setValue] = useState(thread.order?.number ?? '');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (value.trim() === '' || busy) return;
    setBusy(true);
    try {
      await op('inbox.update', { thread: thread.id, order: value.trim() });
      notify.info('Order linked');
      changed('threads');
      onClose();
    } catch {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Link to an order"
      width={420}
      footer={
        <>
          <Button variant="tile" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="so-link-order" loading={busy} disabled={value.trim() === ''}>
            Link order
          </Button>
        </>
      }
    >
      <form id="so-link-order" onSubmit={(e) => void submit(e)}>
        <Field label="Order number" hint={thread.shop !== null ? thread.shop.name : undefined}>
          <TextInput autoFocus value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" />
        </Field>
      </form>
    </Dialog>
  );
}

export function LinkOrderDialog({ open, thread, onClose }: { open: boolean; thread: ThreadDetail; onClose: () => void }): React.JSX.Element | null {
  if (!open) return null;
  return <LinkOrderForm thread={thread} onClose={onClose} />;
}

function NoteForm({ threadId, onClose }: { threadId: string; onClose: () => void }): React.JSX.Element {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (text.trim() === '' || busy) return;
    setBusy(true);
    try {
      await op('inbox.note', { thread: threadId, text: text.trim() });
      notify.info('Note added');
      changed('messages', 'threads');
      onClose();
    } catch {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Private note"
      subtitle="Only you and your AI agent see it"
      width={460}
      footer={
        <>
          <Button variant="tile" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="so-thread-note" loading={busy} disabled={text.trim() === ''}>
            Add note
          </Button>
        </>
      }
    >
      <form id="so-thread-note" onSubmit={(e) => void submit(e)}>
        <TextArea rows={4} autoFocus aria-label="Note" value={text} onChange={(e) => setText(e.target.value)} />
      </form>
    </Dialog>
  );
}

export function NoteDialog({ open, threadId, onClose }: { open: boolean; threadId: string; onClose: () => void }): React.JSX.Element | null {
  if (!open) return null;
  return <NoteForm threadId={threadId} onClose={onClose} />;
}

