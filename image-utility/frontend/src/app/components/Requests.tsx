/**
 * A request to the AI agent as a row: what was asked, its status and the
 * answer. One the agent never got (the fire was refused, or its task was
 * turned down) says so and can be sent again.
 */
import { useState } from 'react';
import { FileText, ImageIcon, PenLine, RotateCcw } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api } from '../lib/api.ts';
import { ago } from '../lib/format.ts';
import { navigate } from '../lib/router.ts';
import type { RequestRec } from '../lib/types.ts';
import { Badge, Button, errMessage } from './ui.tsx';
import type { Tone } from './ui.tsx';

const STATUS: Record<RequestRec['status'], { label: string; tone: Tone; pulse: boolean }> = {
  sent: { label: 'Sent', tone: 'info', pulse: false },
  working: { label: 'Working', tone: 'info', pulse: true },
  done: { label: 'Done', tone: 'good', pulse: false },
  failed: { label: 'Needs you', tone: 'warn', pulse: false },
};

const NOT_SENT = { label: 'Not sent', tone: 'warn' as Tone, pulse: false };

export function RequestRow({ r, compact = false }: { r: RequestRec; compact?: boolean }): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const st = r.asked ? STATUS[r.status] : NOT_SENT;
  const resend = async (): Promise<void> => {
    setBusy(true);
    try {
      const res = await api.resendRequest(r.id);
      if (res.asked) toast.success(res.message);
      else toast.error(res.message);
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const Icon = r.kind === 'describe' ? FileText : PenLine;
  return (
    <li className={cn('flex flex-col gap-1 rounded-[var(--iu-r)] border border-[var(--iu-line)] bg-[var(--iu-card)]', compact ? 'p-2' : 'p-3')}>
      <div className="flex items-start gap-2">
        <Icon size={14} aria-hidden className="mt-0.5 shrink-0 text-[var(--iu-ink-2)]" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold leading-5">{r.title || (r.kind === 'describe' ? 'Describe' : 'Edit')}</p>
          <p className="flex flex-wrap items-center gap-x-1.5 text-[12px] leading-4 text-[var(--iu-muted)]">
            {r.kind === 'describe' ? 'Description' : 'Edit'} · {ago(r.created)}
            {!compact && r.image !== null && (
              <button type="button" onClick={() => r.image !== null && navigate('image', { id: r.image.id })} className="inline-flex items-center gap-1 font-semibold text-[var(--iu-ink-2)] hover:text-[var(--iu-ink)] hover:underline">
                <ImageIcon size={11} aria-hidden /> {r.image.name}
              </button>
            )}
            {!compact && r.images.length > 0 && r.image === null && <span>{r.images.length} images</span>}
            {r.region !== null && <span className="num">region {r.region.w} × {r.region.h}</span>}
          </p>
        </div>
        <Badge tone={st.tone} pulse={st.pulse}>
          {st.label}
        </Badge>
      </div>
      {r.body !== '' && r.body !== r.title && <p className={cn('whitespace-pre-wrap text-[12px] leading-4 text-[var(--iu-ink-2)]', compact && 'line-clamp-3')}>{r.body}</p>}
      {!r.asked && (
        <div className="flex items-center gap-2 rounded-[var(--iu-r-sm)] bg-[var(--iu-amber)]/15 py-1 pl-2 pr-1">
          <p className="min-w-0 flex-1 text-[12px] leading-4 text-[var(--iu-ink)]">{r.ask_error !== '' ? `Your AI agent did not take it: ${r.ask_error}` : 'Your AI agent was not asked.'}</p>
          <Button size="sm" variant="ghost" icon={RotateCcw} loading={busy} onClick={() => void resend()}>
            Retry
          </Button>
        </div>
      )}
      {r.result !== '' && (
        <p className={cn('whitespace-pre-wrap rounded-[var(--iu-r-sm)] px-2 py-1.5 text-[12px] leading-4', r.status === 'failed' ? 'bg-[var(--iu-amber)]/15 text-[var(--iu-ink)]' : 'bg-[var(--iu-row)] text-[var(--iu-ink)]')}>
          <span className="font-semibold">{r.status === 'failed' ? 'Your AI agent asks: ' : 'Your AI agent: '}</span>
          {r.result}
        </p>
      )}
    </li>
  );
}
