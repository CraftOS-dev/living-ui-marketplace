/**
 * A record's history, newest first: interactions, notes, tasks, emails,
 * stage moves and field changes, each with who did it (you or the AI agent).
 * Notes can be pinned, tasks finished and drafts sent in place.
 */
import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight, CheckSquare, Mail, MessageSquare, Pencil, Phone, Pin, PinOff, Send, Sparkles, Square, StickyNote, Trash2, Users } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api, errMessage } from '../lib/api.ts';
import { IX_LABEL, ago, day, relDay, stageColor } from '../lib/format.ts';
import { go } from '../lib/router.ts';
import type { Email, TimelineItem } from '../lib/types.ts';
import { useDialogs } from './dialogs.tsx';
import { AiChip } from './controls.tsx';
import { Chip, IconBtn } from './ui.tsx';

const IX_ICON: Record<string, LucideIcon> = { email: Mail, call: Phone, meeting: Users, message: MessageSquare };

function Tile({ icon: Icon, tone = 'none' }: { icon: LucideIcon; tone?: 'none' | 'accent' | 'pos' | 'neg' | undefined }): React.JSX.Element {
  return (
    <span className={cn('relative z-[1] mt-px flex size-6 shrink-0 items-center justify-center rounded-[6px]', tone === 'accent' ? 'bg-[var(--cr-accent-soft)] text-[var(--cr-accent-text)]' : tone === 'pos' ? 'bg-[var(--cr-pos-soft)] text-[var(--cr-pos-text)]' : tone === 'neg' ? 'bg-[var(--cr-neg-soft)] text-[var(--cr-neg-text)]' : 'bg-[var(--cr-row-hover)] text-[var(--cr-ink-2)]')}>
      <Icon size={12} strokeWidth={2.1} />
    </span>
  );
}

function Who({ by, run }: { by: string; run?: string | undefined }): React.JSX.Element | null {
  if (by === 'agent') return <AiChip title={run ? 'Run ' + run.slice(-5) : undefined}>AI agent</AiChip>;
  if (by === 'import') return <Chip>Import</Chip>;
  return null;
}

function Clamp({ text }: { text: string }): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  if (text === '') return null;
  const long = text.length > 280 || text.split('\n').length > 4;
  return (
    <div className="mt-1">
      <p className={cn('cr-prose text-[12.5px] leading-[18px] text-[var(--cr-ink-2)]', long && !open && 'line-clamp-4')}>{text}</p>
      {long && (
        <button type="button" onClick={() => setOpen(!open)} className="mt-0.5 text-[11.5px] font-semibold text-[var(--cr-muted)] hover:text-[var(--cr-ink)]">
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

function EmailItem({ m }: { m: Email }): React.JSX.Element {
  const d = useDialogs();
  const tone = m.status === 'sent' ? 'pos' : m.status === 'failed' ? 'neg' : 'none';
  return (
    <>
      <Tile icon={Send} tone={tone} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
          <span className="font-semibold">{m.subject || '(no subject)'}</span>
          <span className="text-[var(--cr-muted)]">to {m.to || 'no one yet'}</span>
          <Chip tone={m.status === 'sent' ? 'pos' : m.status === 'failed' ? 'neg' : m.status === 'draft' ? 'neutral' : 'accent'}>{m.status === 'queued' || m.status === 'sending' ? 'sending' : m.status}</Chip>
          <Who by={m.by} run={m.run} />
        </p>
        {m.status === 'failed' && <p className="mt-0.5 text-[12px] text-[var(--cr-neg-text)]">{m.error}</p>}
        <Clamp text={m.body} />
        {(m.status === 'draft' || m.status === 'failed') && (
          <div className="mt-1.5 flex gap-1.5">
            <button type="button" onClick={() => d.openEmail(m.person ? { person: m.person, deal: m.deal } : {}, m)} className="h-6 rounded-[4px] border border-[var(--cr-line)] px-2 text-[11.5px] font-semibold hover:bg-[var(--cr-row)]">
              Edit and send
            </button>
            <button type="button" onClick={() => void api.deleteEmail(m.id).catch((err: unknown) => toast.error(errMessage(err)))} className="h-6 rounded-[4px] px-2 text-[11.5px] font-semibold text-[var(--cr-muted)] hover:text-[var(--cr-ink)]">
              Discard
            </button>
          </div>
        )}
      </div>
    </>
  );
}

export function Timeline({ items, showTarget = false, empty }: { items: TimelineItem[]; showTarget?: boolean | undefined; empty?: string | undefined }): React.JSX.Element {
  if (items.length === 0) return <p className="py-6 text-center text-[12.5px] text-[var(--cr-muted)]">{empty ?? 'Nothing yet. Log a call, a meeting or a note and it shows here.'}</p>;
  return (
    <ol className="relative">
      <span aria-hidden className="absolute bottom-3 left-[11.5px] top-3 w-px bg-[var(--cr-hair)]" />
      {items.map((it, i) => (
        <li key={it.type + i + it.at} className="group relative flex gap-3 py-2">
          <Item it={it} showTarget={showTarget} />
          <span className="num shrink-0 pt-1 text-[11px] text-[var(--cr-muted)]" title={it.at}>
            {ago(it.at)}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Item({ it, showTarget }: { it: TimelineItem; showTarget: boolean }): React.JSX.Element {
  switch (it.type) {
    case 'interaction': {
      const x = it.interaction;
      const who = x.people.map((p) => p.name).join(', ') || x.company?.name || '';
      const verb = x.kind === 'email' ? (x.direction === 'in' ? 'Email from ' : 'Email to ') : x.kind === 'message' ? (x.direction === 'in' ? 'Message from ' : 'Message to ') : IX_LABEL[x.kind] + ' with ';
      return (
        <>
          <Tile icon={IX_ICON[x.kind] ?? Users} tone={x.by === 'agent' ? 'accent' : 'none'} />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
              <span className="font-semibold">
                {verb}
                {who}
              </span>
              {x.subject && <span className="text-[var(--cr-ink-2)]">· {x.subject}</span>}
              {x.deal && showTarget && (
                <button type="button" onClick={() => go('deals', { id: x.deal!.id })} className="text-[var(--cr-muted)] hover:underline">
                  on {x.deal.name}
                </button>
              )}
              <Who by={x.by} run={x.run} />
              {x.agent_state === 'waiting' || x.agent_state === 'working' ? (
                <Chip tone="accent">
                  <Sparkles size={10} className="cr-pulse" /> AI reviewing
                </Chip>
              ) : x.agent_state === 'done' && x.agent_note ? (
                <span className="text-[11.5px] text-[var(--cr-accent-text)]" title={x.agent_note}>
                  AI: {x.agent_note}
                </span>
              ) : null}
            </p>
            <p className="num text-[11px] text-[var(--cr-muted)]">
              {day(x.at.slice(0, 10))} {x.source && '· ' + x.source}
            </p>
            <Clamp text={x.summary} />
          </div>
        </>
      );
    }
    case 'note': {
      const n = it.note;
      return (
        <>
          <Tile icon={StickyNote} tone={n.by === 'agent' ? 'accent' : 'none'} />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-[12.5px]">
              <span className="font-semibold">Note</span>
              {n.pinned && (
                <Chip>
                  <Pin size={9} /> Pinned
                </Chip>
              )}
              <Who by={n.by} run={n.run} />
              <span className="flex-1" />
              <span className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                <IconBtn icon={n.pinned ? PinOff : Pin} label={n.pinned ? 'Unpin' : 'Pin'} size={22} onClick={() => void api.updateNote(n.id, { pinned: !n.pinned }).catch((err: unknown) => toast.error(errMessage(err)))} />
                <IconBtn icon={Trash2} label="Delete note" size={22} onClick={() => void api.deleteNote(n.id).then(() => toast.success('Note deleted (undo with Ctrl+Z)')).catch((err: unknown) => toast.error(errMessage(err)))} />
              </span>
            </p>
            <Clamp text={n.body} />
          </div>
        </>
      );
    }
    case 'task': {
      const t = it.task;
      const done = t.state === 'done';
      return (
        <>
          <button type="button" aria-label={done ? 'Mark not done' : 'Mark done'} onClick={() => void api.completeTask(t.id, !done).catch((err: unknown) => toast.error(errMessage(err)))} className="relative z-[1] mt-px flex size-6 shrink-0 items-center justify-center rounded-[6px] bg-[var(--cr-row-hover)] text-[var(--cr-ink-2)] hover:text-[var(--cr-ink)]">
            {done ? <CheckSquare size={13} /> : <Square size={13} />}
          </button>
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
              <span className={cn('font-semibold', done && 'text-[var(--cr-muted)] line-through')}>{t.title}</span>
              {!done && t.due && <span className={cn('text-[11.5px]', t.state === 'overdue' ? 'font-semibold text-[var(--cr-neg-text)]' : 'text-[var(--cr-muted)]')}>due {relDay(t.due)}</span>}
              <Who by={t.by} run={t.run} />
            </p>
            {t.notes && <Clamp text={t.notes} />}
          </div>
        </>
      );
    }
    case 'email':
      return <EmailItem m={it.email} />;
    case 'stage': {
      const s = it.stage;
      return (
        <>
          <Tile icon={ArrowRight} tone={s.to_kind === 'won' ? 'pos' : s.to_kind === 'lost' ? 'neg' : s.actor === 'agent' ? 'accent' : 'none'} />
          <p className="min-w-0 flex-1 pt-[3px] text-[12.5px]">
            {s.from ? (
              <>
                Moved from <b>{s.from}</b> to{' '}
              </>
            ) : (
              'Created in '
            )}
            <b style={{ color: stageColor(undefined, s.to_kind) === 'var(--cr-ink-2)' ? undefined : stageColor(undefined, s.to_kind) }}>{s.to}</b> {s.actor === 'agent' && <AiChip>AI agent</AiChip>}
          </p>
        </>
      );
    }
    case 'change': {
      const c = it.change;
      return (
        <>
          <Tile icon={Pencil} tone={c.actor === 'agent' ? 'accent' : 'none'} />
          <div className="min-w-0 flex-1 pt-[3px] text-[12.5px]">
            <p className="flex flex-wrap items-center gap-1.5">
              <span className="text-[var(--cr-ink-2)]">{c.summary}</span>
              {c.actor === 'agent' ? <AiChip>AI agent</AiChip> : c.actor === 'import' ? <Chip>Import</Chip> : null}
            </p>
            {c.changes.length > 0 && c.changes.length <= 4 && (
              <ul className="mt-0.5 text-[11.5px] text-[var(--cr-muted)]">
                {c.changes.map((x, i) => (
                  <li key={i} className="truncate">
                    {x.field}: <span className="line-through">{String(x.before ?? '') || 'empty'}</span> → <span className="text-[var(--cr-ink-2)]">{String(x.after ?? '') || 'empty'}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      );
    }
  }
}
