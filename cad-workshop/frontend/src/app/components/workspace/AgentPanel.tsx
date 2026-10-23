/**
 * Your AI agent beside the model: this part's requests as a thread (what
 * was asked, how it is going, the answer), and a box to ask for a change, a
 * review or a fix. What is selected in the view goes with the request.
 */
import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Sparkles } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { api } from '../../lib/api.ts';
import { ago } from '../../lib/format.ts';
import { keyLabel } from '../../lib/keys.ts';
import { useLive } from '../../lib/live.ts';
import type { Brief } from '../../lib/types.ts';
import { Badge, Segmented, Select, Spinner, errMessage, textareaCls } from '../ui.tsx';

type Kind = 'design' | 'review' | 'repair';

const STATUS: Record<Brief['status'], { tone: 'info' | 'good' | 'bad'; label: string }> = {
  sent: { tone: 'info', label: 'Sent' },
  working: { tone: 'info', label: 'Working' },
  done: { tone: 'good', label: 'Done' },
  failed: { tone: 'bad', label: 'Needs you' },
};

export function AgentPanel({ part, selection, failed, initialKind }: { part: string; selection: string[]; failed: boolean; initialKind: Kind }): React.JSX.Element {
  const live = useLive(() => api.requests({ part, limit: 50 }), ['briefs'], [part]);
  const [kind, setKind] = useState<Kind>(initialKind);
  const [body, setBody] = useState('');
  const [process, setProcess] = useState('fdm_print');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement | null>(null);
  const briefs = [...(live.data?.briefs ?? [])].sort((a, b) => a.created.localeCompare(b.created));
  useEffect(() => setKind(initialKind), [initialKind]);
  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [briefs.length]);

  const send = async (): Promise<void> => {
    if (kind === 'design' && body.trim() === '') return;
    setBusy(true);
    try {
      const r = await api.createRequest({ kind, part, body: body.trim(), process: kind === 'review' ? process : undefined });
      if (!r.asked) toast.error(r.message);
      setBody('');
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const kinds: { value: Kind; label: string }[] = [{ value: 'design', label: 'Change' }, { value: 'review', label: 'Review' }, ...(failed ? [{ value: 'repair' as Kind, label: 'Fix' }] : [])];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {live.data === null ? (
          <div className="flex justify-center py-6">
            <Spinner size={16} className="text-[var(--cw-muted)]" />
          </div>
        ) : briefs.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 py-8 text-center text-[var(--cw-muted)]">
            <Sparkles size={18} aria-hidden />
            <p className="text-[12px]">Ask for a change in words</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {briefs.map((b) => (
              <div key={b.id} className="flex flex-col gap-1">
                <div className="ml-6 self-end rounded-[var(--cw-r-md)] bg-[var(--cw-row)] px-2.5 py-1.5 text-[13px] leading-[18px]">
                  <p className="whitespace-pre-wrap">{b.body !== '' ? b.body : b.title}</p>
                  {b.selection.length > 0 && <p className="mt-0.5 truncate text-[12px] text-[var(--cw-muted)]">With {b.selection.slice(0, 2).map(keyLabel).join(', ') + (b.selection.length > 2 ? ' and ' + (b.selection.length - 2) + ' more' : '')}</p>}
                </div>
                <div className="flex items-center gap-1.5 text-[12px] text-[var(--cw-muted)]">
                  <Badge tone={STATUS[b.status].tone} pulse={b.status === 'sent' || b.status === 'working'}>
                    {STATUS[b.status].label}
                  </Badge>
                  <span>{(b.kind === 'design' ? 'Change' : b.kind === 'repair' ? 'Fix' : 'Review') + ' · ' + ago(b.created)}</span>
                </div>
                {b.result !== '' && <p className={cn('mr-6 whitespace-pre-wrap border-l-2 pl-2 text-[13px] leading-[18px]', b.status === 'failed' ? 'border-[var(--cw-red)]' : 'border-[var(--cw-accent)]')}>{b.result}</p>}
              </div>
            ))}
            <div ref={end} />
          </div>
        )}
      </div>
      <div className="shrink-0 border-t border-[var(--cw-line)] p-2">
        <div className="mb-1.5 flex items-center gap-1.5">
          <Segmented size="sm" label="Kind of request" value={kind} onChange={setKind} options={kinds} />
          {kind === 'review' && (
            <Select
              className="flex-1"
              ariaLabel="How it will be made"
              value={process}
              onChange={setProcess}
              options={[
                { value: 'fdm_print', label: 'Filament printing' },
                { value: 'resin_print', label: 'Resin printing' },
                { value: 'cnc_3axis', label: 'CNC (3 axis)' },
                { value: 'general', label: 'General' },
              ]}
            />
          )}
        </div>
        <div className="relative">
          <textarea
            aria-label="Message to your AI agent"
            value={body}
            rows={3}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={kind === 'design' ? 'Make the base 6 mm thick and add M3 holes in the corners' : kind === 'review' ? 'Anything to look at (optional)' : 'What went wrong (optional)'}
            className={cn(textareaCls, 'resize-none pr-9')}
          />
          <button
            type="button"
            aria-label="Send"
            title="Send (Enter)"
            disabled={busy || (kind === 'design' && body.trim() === '')}
            onClick={() => void send()}
            className="cw-on-ink absolute bottom-1.5 right-1.5 flex size-6 items-center justify-center rounded-[var(--cw-r-sm)] bg-[var(--cw-ink)] text-[var(--cw-shell)] disabled:opacity-40"
          >
            {busy ? <Spinner size={11} /> : <ArrowUp size={14} aria-hidden />}
          </button>
        </div>
        {selection.length > 0 && <p className="mt-1 truncate text-[12px] text-[var(--cw-muted)]">Sends your selection: {selection.length === 1 ? keyLabel(selection[0] ?? '') : selection.length + ' items'}</p>}
      </div>
    </div>
  );
}
