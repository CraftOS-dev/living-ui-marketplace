/**
 * The Agent tab: ask your AI agent to edit this image (optionally pointing
 * at a region drawn on it) or to describe it, with quick asks for the
 * usual jobs; what it is working on and what it answered.
 */
import { useState } from 'react';
import { Inbox, Send, SquareDashedMousePointer, X } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { api } from '../../lib/api.ts';
import { useApp } from '../../lib/context.tsx';
import type { ImageDetail, Region, RequestRec } from '../../lib/types.ts';
import { RequestRow } from '../Requests.tsx';
import { Badge, Button, Empty, PropSection, Segmented, errMessage, textareaCls } from '../ui.tsx';

const QUICK: { kind: 'edit' | 'describe'; label: string; body: string }[] = [
  { kind: 'edit', label: 'Remove the background', body: 'Cut out the subject onto a transparent background and export a PNG.' },
  { kind: 'edit', label: 'Hide faces and plates', body: 'Find every face, number plate and screen with personal details and redact them (pixelate faces, solid boxes over text).' },
  { kind: 'edit', label: 'Straighten and crop', body: 'Straighten the horizon if it is tilted and crop to a pleasing composition; keep the subject.' },
  { kind: 'edit', label: 'Web-ready', body: 'Make it web-ready: auto light and colour, longest edge 2048, and export the smallest of WebP and AVIF that still looks right.' },
  { kind: 'edit', label: 'Annotate for a guide', body: 'Annotate this screenshot for a how-to guide: number the steps with arrows and short labels, and redact anything private.' },
  { kind: 'describe', label: 'Alt text and keywords', body: '' },
];

export function AgentPanel({ d, region, picking, onPick, onClearRegion }: { d: ImageDetail; region: Region | null; picking: boolean; onPick: (on: boolean) => void; onClearRegion: () => void }): React.JSX.Element {
  const { settings } = useApp();
  const [kind, setKind] = useState<'edit' | 'describe'>('edit');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async (k: 'edit' | 'describe', text: string): Promise<void> => {
    setBusy(true);
    try {
      const r = await api.createRequest({ kind: k, image: d.id, body: text, region: k === 'edit' ? region : null });
      if (r.asked) toast.success(r.message);
      else toast.error(r.message);
      setBody('');
      onClearRegion();
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const open = d.requests.filter((r) => r.status === 'sent' || r.status === 'working');
  const policy = settings?.policy.agent_edits ?? 'propose';
  return (
    <div className="flex flex-col">
      <PropSection title="Ask your AI agent" actions={<Badge tone="neutral">{policy === 'propose' ? 'It proposes, you decide' : 'It edits directly'}</Badge>}>
        <div className="flex flex-col gap-2">
          <Segmented
            label="Ask for"
            size="sm"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'edit', label: 'An edit' },
              { value: 'describe', label: 'A description' },
            ]}
          />
          {kind === 'edit' ? (
            <>
              <textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="What should change? e.g. blur the people in the background and warm it up a little" className={textareaCls} />
              <div className="flex flex-wrap items-center gap-1">
                <Button size="sm" variant={picking ? 'primary' : 'secondary'} icon={SquareDashedMousePointer} onClick={() => onPick(!picking)}>
                  {picking ? 'Drag on the image' : region !== null ? 'Redraw the region' : 'Point at a region'}
                </Button>
                {region !== null && (
                  <span className="num inline-flex h-6 items-center gap-1 rounded-[var(--iu-r-sm)] bg-[var(--iu-row)] pl-1.5 text-[12px]">
                    {region.w} × {region.h} at {region.x}, {region.y}
                    <button type="button" aria-label="Clear the region" onClick={onClearRegion} className="flex size-5 items-center justify-center text-[var(--iu-muted)] hover:text-[var(--iu-ink)]">
                      <X size={11} aria-hidden />
                    </button>
                  </span>
                )}
              </div>
              <Button variant="accent" icon={Send} loading={busy} disabled={body.trim() === ''} onClick={() => void send('edit', body.trim())}>
                Send to your AI agent
              </Button>
            </>
          ) : (
            <>
              <p className="text-[12px] leading-4 text-[var(--iu-muted)]">Your AI agent looks at the image and writes alt text (under 125 characters), a title and keywords. Exports carry them in the file.</p>
              <textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="Anything to include? (optional: language, tone, a product name)" className={textareaCls} />
              <Button variant="accent" icon={Send} loading={busy} onClick={() => void send('describe', body.trim())}>
                Ask for a description
              </Button>
            </>
          )}
        </div>
      </PropSection>
      <PropSection title="Quick asks">
        <div className="flex flex-wrap gap-1">
          {QUICK.map((q) => (
            <button
              key={q.label}
              type="button"
              disabled={busy}
              onClick={() => {
                if (q.kind === 'describe') void send('describe', '');
                else {
                  setKind('edit');
                  setBody(q.body);
                }
              }}
              className={cn('h-6 rounded-[var(--iu-r-sm)] border border-[var(--iu-line)] bg-[var(--iu-card)] px-1.5 text-[12px] font-semibold text-[var(--iu-ink-2)] hover:border-[var(--iu-muted)] hover:text-[var(--iu-ink)] disabled:opacity-50')}
            >
              {q.label}
            </button>
          ))}
        </div>
      </PropSection>
      <PropSection title={open.length > 0 ? 'Working on' : 'Requests'}>
        {d.requests.length === 0 ? (
          <Empty icon={Inbox} title="No requests for this image" compact>
            What you ask lands here with its answer; proposals show in the Edits panel.
          </Empty>
        ) : (
          <ul className="flex flex-col gap-1">
            {d.requests.slice(0, 10).map((r: RequestRec) => (
              <RequestRow key={r.id} r={r} compact />
            ))}
          </ul>
        )}
      </PropSection>
    </div>
  );
}
