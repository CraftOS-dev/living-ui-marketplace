/**
 * Stock counts: start one for a place (and the places inside it) or for
 * everything, then walk the shelves. Counts in progress come first, then
 * finished ones with what they changed.
 */
import { useState } from 'react';
import { ClipboardCheck, EyeOff, Package, Plus } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { ProgressRing } from '../components/controls.tsx';
import { LocationSelect } from '../components/pickers.tsx';
import { Card, CardHeader, Empty, Field, Modal, PageHeader, PillButton, StatusPill, Toggle, softInput } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { ago, dayLabel } from '../lib/dates.ts';
import { money, plural, signed } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { navigate } from '../lib/router.ts';
import type { CountBrief } from '../lib/types.ts';

function StartCount({ onClose, itemId }: { onClose: () => void; itemId: string }): React.JSX.Element {
  const [location, setLocation] = useState('');
  const [includeSub, setIncludeSub] = useState(true);
  const [blind, setBlind] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const item = useLive(() => (itemId !== '' ? api.item(itemId) : Promise.resolve(null)), [], [itemId]);
  const start = async (): Promise<void> => {
    setBusy(true);
    try {
      const c = await api.startCount({ location, include_sub: includeSub, blind, note: note.trim(), ...(itemId !== '' ? { items: [itemId] } : {}) });
      onClose();
      navigate('count', { id: c.id });
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Start a count"
      description="The app notes what it expects in each place now; you count what is really there."
      footer={
        <>
          <PillButton variant="light" onClick={onClose}>
            Cancel
          </PillButton>
          <PillButton variant="dark" icon={ClipboardCheck} loading={busy} onClick={() => void start()}>
            Start counting
          </PillButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {item.data !== null && (
          <p className="flex items-center gap-2 rounded-[18px] bg-[var(--iv-row)] px-4 py-3 text-[13px]">
            <Package size={15} aria-hidden /> Only <span className="font-bold">{item.data.name}</span>
          </p>
        )}
        <Field label="What to count">
          <LocationSelect value={location} onChange={setLocation} soft allowNone noneLabel="Everything, everywhere" ariaLabel="What to count" />
        </Field>
        {location !== '' && (
          <div className="flex items-center justify-between gap-3 rounded-[20px] bg-[var(--iv-row)] px-4 py-3">
            <span className="text-[13px] font-semibold">Include the places inside it</span>
            <Toggle checked={includeSub} onChange={setIncludeSub} label="Include the places inside it" />
          </div>
        )}
        <div className="flex items-center justify-between gap-3 rounded-[20px] bg-[var(--iv-row)] px-4 py-3">
          <span>
            <span className="flex items-center gap-2 text-[13px] font-semibold">
              <EyeOff size={14} aria-hidden /> Blind count
            </span>
            <span className="block text-[12px] text-[var(--iv-muted)]">Hide the expected numbers until the review, so they do not sway the count.</span>
          </span>
          <Toggle checked={blind} onChange={setBlind} label="Blind count" />
        </div>
        <Field label="Note">
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Optional, e.g. month-end count" aria-label="Note" className={softInput} />
        </Field>
      </div>
    </Modal>
  );
}

function CountCard({ c, index }: { c: CountBrief; index: number }): React.JSX.Element {
  const { currency } = useApp();
  const progress = c.line_count > 0 ? c.counted / c.line_count : 0;
  return (
    <button
      type="button"
      onClick={() => navigate('count', { id: c.id })}
      className={cn(
        `iv-rise iv-d${Math.min(5, index + 1)} flex items-center gap-4 rounded-[24px] p-4 text-left transition-shadow hover:shadow-[0_20px_40px_-30px_rgba(29,28,26,0.6)] md:p-5`,
        c.status === 'counting' ? 'bg-[var(--iv-card)]' : 'bg-[var(--iv-card)]/70',
      )}
    >
      {c.status === 'counting' ? (
        <ProgressRing value={progress} size={56} />
      ) : (
        <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-[var(--iv-row)]">
          <ClipboardCheck size={20} aria-hidden />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-[15px] font-bold">
            {c.number} · {c.location?.path ?? 'Everything'}
          </span>
          {c.blind && c.status === 'counting' && <StatusPill tone="neutral">Blind</StatusPill>}
        </span>
        <span className="block truncate text-[13px] text-[var(--iv-muted)]">
          {c.status === 'counting'
            ? `${c.counted} of ${plural(c.line_count, 'line')} counted · started ${ago(c.created)}`
            : c.status === 'completed'
              ? c.summary !== null
                ? `${dayLabel(c.completed_on)} · ${plural(c.summary.changed, 'change')}${c.summary.changed > 0 ? ` (${signed(c.summary.units)} units, ${money(c.summary.value, currency)})` : ', everything matched'}`
                : dayLabel(c.completed_on)
              : `Cancelled · started ${ago(c.created)}`}
        </span>
        {c.note !== '' && <span className="block truncate text-[12px] text-[var(--iv-ink-2)]">{c.note}</span>}
      </span>
      <StatusPill tone={c.status === 'counting' ? 'warn' : c.status === 'completed' ? 'good' : 'neutral'}>
        {c.status === 'counting' ? 'Counting' : c.status === 'completed' ? 'Done' : 'Cancelled'}
      </StatusPill>
    </button>
  );
}

export function CountsPage({ query }: { query: URLSearchParams }): React.JSX.Element {
  const itemId = query.get('item') ?? '';
  const [starting, setStarting] = useState(itemId !== '');
  const list = useLive(() => api.counts({ limit: 200 }), ['counts', 'count_lines'], []);
  const all = list.data?.counts ?? [];
  const open = all.filter((c) => c.status === 'counting');
  const done = all.filter((c) => c.status !== 'counting');
  return (
    <div>
      <PageHeader
        title="Stock counts"
        subtitle="Count what is really on the shelves and set the stock to match"
        actions={
          <PillButton variant="dark" icon={Plus} dot onClick={() => setStarting(true)}>
            Start a count
          </PillButton>
        }
      />
      {list.data !== null && all.length === 0 ? (
        <Card>
          <Empty icon={ClipboardCheck} title="No counts yet" action={<PillButton variant="dark" icon={Plus} dot onClick={() => setStarting(true)}>Start a count</PillButton>}>
            Counting one shelf at a time keeps the numbers right without closing the stockroom. Scan each item as you count it.
          </Empty>
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          {open.length > 0 && (
            <section>
              <CardHeader title="In progress" />
              <div className="flex flex-col gap-3">
                {open.map((c, i) => (
                  <CountCard key={c.id} c={c} index={i} />
                ))}
              </div>
            </section>
          )}
          {done.length > 0 && (
            <section>
              <CardHeader title="Finished" />
              <div className="flex flex-col gap-3">
                {done.map((c, i) => (
                  <CountCard key={c.id} c={c} index={i + open.length} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
      {starting && <StartCount itemId={itemId} onClose={() => setStarting(false)} />}
    </div>
  );
}
