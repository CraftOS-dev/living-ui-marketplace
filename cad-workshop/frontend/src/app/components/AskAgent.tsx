/**
 * Ask your AI agent from the app: a design change (or a new part), a fix for
 * a failed build, or a review for 3D printing or machining. The request is
 * stored with whatever is selected in the viewer, and its progress shows
 * honestly: sent, working, done with the agent's answer, or failed.
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Sparkles } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api } from '../lib/api.ts';
import { ago } from '../lib/format.ts';
import { keyLabel } from '../lib/keys.ts';
import type { Brief } from '../lib/types.ts';
import { Badge, Button, Field, Modal, Segmented, Select, errMessage, inputCls, textareaCls } from './ui.tsx';

type Kind = 'design' | 'review' | 'repair';

export function AskAgentDialog({
  open,
  onClose,
  part,
  selection,
  failed,
  initialKind,
}: {
  open: boolean;
  onClose: () => void;
  part: { id: string; name: string } | null;
  selection: string[];
  failed: boolean;
  initialKind?: Kind;
}): React.JSX.Element {
  const [kind, setKind] = useState<Kind>(initialKind ?? 'design');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [process, setProcess] = useState('fdm_print');
  const [busy, setBusy] = useState(false);

  const kinds: { value: Kind; label: string }[] = [
    { value: 'design', label: part === null ? 'Design a part' : 'Change it' },
    ...(part !== null ? [{ value: 'review' as Kind, label: 'Review it' }] : []),
    ...(part !== null && failed ? [{ value: 'repair' as Kind, label: 'Fix the build' }] : []),
  ];

  const send = async (): Promise<void> => {
    if (kind === 'design' && body.trim() === '' && title.trim() === '') {
      toast.error('Describe what you want');
      return;
    }
    setBusy(true);
    try {
      const r = await api.createRequest({ kind, part: part?.id, title: title.trim(), body: body.trim(), process: kind === 'review' ? process : undefined });
      if (r.asked) toast.success('Sent to your AI agent');
      else toast.error(r.message);
      setTitle('');
      setBody('');
      onClose();
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Ask your AI agent"
      description={part === null ? 'Describe the part; your AI agent designs it here, step by step, and you can change everything after.' : 'Your AI agent works on ' + part.name + ' through the same tools you use, and every change it makes can be undone.'}
      wide
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={Sparkles} loading={busy} onClick={() => void send()}>
            Send
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {kinds.length > 1 && <Segmented label="Kind of request" value={kind} onChange={setKind} options={kinds} />}
        {kind === 'design' && (
          <>
            <Field label="Title" hint="Optional">
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={part === null ? 'Wall bracket for a 25 mm tube' : 'Thicker base'} className={inputCls} maxLength={160} />
            </Field>
            <Field label="What you want" hint="Give the numbers that matter (sizes, screw sizes, clearances); your AI agent asks when something essential is missing.">
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={5}
                placeholder={part === null ? 'A bracket that holds a 25 mm tube 40 mm off the wall, two M5 screws, 4 mm thick, printed in PETG.' : 'Make the base 6 mm thick and add M3 heat-set insert holes in each corner.'}
                className={textareaCls}
              />
            </Field>
          </>
        )}
        {kind === 'review' && (
          <>
            <Select
              label="How it will be made"
              value={process}
              onChange={setProcess}
              options={[
                { value: 'fdm_print', label: '3D printing (filament)' },
                { value: 'resin_print', label: '3D printing (resin)' },
                { value: 'cnc_3axis', label: 'CNC machining (3 axis)' },
                { value: 'general', label: 'General' },
              ]}
            />
            <Field label="Anything to look at" hint="Optional">
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="Will the hinge print without supports?" className={textareaCls} />
            </Field>
          </>
        )}
        {kind === 'repair' && <p className="text-[13px] text-[var(--cw-ink-2)]">Your AI agent reads the error, fixes only what failed, and checks that the part builds and your checks still pass. It never deletes the failing feature to make it build.</p>}
        {selection.length > 0 && kind !== 'repair' && (
          <div className="rounded-[var(--cw-r)] border border-[var(--cw-line)] bg-[var(--cw-row)] px-2.5 py-1.5 text-[12px] text-[var(--cw-ink-2)]">
            <span className="font-semibold text-[var(--cw-ink)]">Sent with your selection: </span>
            {selection.slice(0, 4).map(keyLabel).join('; ')}
            {selection.length > 4 ? ' and ' + (selection.length - 4) + ' more' : ''}
          </div>
        )}
      </div>
    </Modal>
  );
}

const STATUS: Record<Brief['status'], { tone: 'info' | 'good' | 'bad' | 'neutral'; label: string }> = {
  sent: { tone: 'info', label: 'Sent to your AI agent' },
  working: { tone: 'info', label: 'Your AI agent is on it' },
  done: { tone: 'good', label: 'Done' },
  failed: { tone: 'bad', label: 'Needs you' },
};

/** One request as a dense row: title, state, what was asked and the answer. */
export function BriefRow({ b, showPart = false, actions }: { b: Brief; showPart?: boolean; actions?: ReactNode }): React.JSX.Element {
  const s = STATUS[b.status];
  return (
    <div className="flex flex-col gap-1 border-b border-[var(--cw-hair)] px-3 py-2 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[13px] font-bold">{b.title}</span>
        <Badge tone={s.tone} pulse={b.status === 'sent' || b.status === 'working'}>
          {s.label}
        </Badge>
      </div>
      <p className="num text-[12px] leading-4 text-[var(--cw-muted)]">
        {b.kind === 'design' ? 'Design' : b.kind === 'repair' ? 'Fix' : 'Review'}
        {showPart && b.part !== null ? ' · ' + b.part.name : ''}
        {' · ' + ago(b.created)}
      </p>
      {b.body !== '' && <p className="line-clamp-3 whitespace-pre-wrap text-[12px] leading-4 text-[var(--cw-ink-2)]">{b.body}</p>}
      {b.result !== '' && (
        <p className={cn('whitespace-pre-wrap rounded-[var(--cw-r)] border-l-2 px-2 py-1 text-[12px] leading-4', b.status === 'failed' ? 'border-[var(--cw-red)] bg-[var(--cw-red)]/8 text-[var(--cw-ink)]' : 'border-[var(--cw-line)] bg-[var(--cw-row)] text-[var(--cw-ink)]')}>{b.result}</p>
      )}
      {b.status === 'sent' && <p className="text-[12px] leading-4 text-[var(--cw-muted)]">Your AI agent picks this up while it is running.</p>}
      {actions !== undefined && <div className="flex items-center justify-end gap-1">{actions}</div>}
    </div>
  );
}
