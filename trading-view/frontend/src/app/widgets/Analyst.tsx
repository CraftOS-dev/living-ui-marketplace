/**
 * AI analyst: ask the AI agent about the linked chart (with a question or a
 * preset), follow the request while it works, and read its analyses: bias,
 * summary, key levels (drawn on the chart, one click to an alert), the
 * numbers it was based on, and its markup to keep or clear. Watchlist
 * reviews and the agent's notes on fired alerts show here too.
 */
import { useMemo, useState } from 'react';
import { BellPlus, Check, ChevronDown, ChevronRight, Sparkles, Trash2, X } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { Btn, Change, Chip, Empty, IconBtn, area } from '../components/ui.tsx';
import { api, errMessage } from '../lib/api.ts';
import { ago, num, plainPct, price, short } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { useAnalyses, useApp } from '../lib/store.tsx';
import type { Analysis, Widget } from '../lib/types.ts';
import { useDialogs } from '../workspace/Dialogs.tsx';
import { Title, WidgetShell } from '../workspace/WidgetShell.tsx';

const PRESETS = ["Explain today's move", 'Key levels and trend', 'What would invalidate the trend?', 'Risk check'];
const BIAS: Record<string, { label: string; tone: 'up' | 'down' | 'neutral' | 'warn' }> = {
  bullish: { label: 'Bullish', tone: 'up' },
  bearish: { label: 'Bearish', tone: 'down' },
  neutral: { label: 'Neutral', tone: 'neutral' },
  mixed: { label: 'Mixed', tone: 'warn' },
};

function AnalysisCard({ a, open, onToggle }: { a: Analysis; open: boolean; onToggle: () => void }): React.JSX.Element {
  const dialogs = useDialogs();
  const f = a.facts;
  const bias = BIAS[a.bias] ?? null;
  return (
    <article className="border-b border-[var(--tv-hair)] px-2.5 py-2">
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-1.5 text-left">
        {open ? <ChevronDown size={13} className="text-[var(--tv-muted)]" /> : <ChevronRight size={13} className="text-[var(--tv-muted)]" />}
        <span className="text-[12px] font-bold">{a.kind === 'watchlist' ? 'Watchlist review' : short(a.symbol) + ' · ' + (a.interval || '1D')}</span>
        {bias !== null && <Chip tone={bias.tone}>{bias.label}</Chip>}
        {a.state === 'failed' && <Chip tone="warn">Failed</Chip>}
        <span className="ml-auto shrink-0 text-[11px] text-[var(--tv-muted)]">{ago(a.updated || a.created)}</span>
      </button>
      {open && (
        <div className="mt-1.5 pl-[19px]">
          {a.focus !== '' && <p className="mb-1 text-[11.5px] italic text-[var(--tv-muted)]">“{a.focus}”</p>}
          {a.state === 'failed' ? (
            <p className="text-[12px] text-[var(--tv-ink-2)]">{a.error}</p>
          ) : (
            <p className="tv-prose text-[12.5px] leading-[18px]">{a.summary}</p>
          )}
          {a.levels.length > 0 && (
            <div className="mt-2">
              <div className="mb-0.5 text-[10.5px] font-bold uppercase tracking-[0.04em] text-[var(--tv-muted)]">Levels</div>
              {a.levels
                .slice()
                .sort((x, y) => y.price - x.price)
                .map((l, i) => (
                  <div key={i} className="group flex h-6 items-center gap-2 text-[12px]">
                    <span className={cn('w-[70px] text-[11px] font-bold uppercase', l.kind === 'support' || l.kind === 'target' || l.kind === 'entry' ? 'text-[var(--tv-up-text)]' : l.kind === 'resistance' || l.kind === 'stop' ? 'text-[var(--tv-down-text)]' : 'text-[var(--tv-ink-2)]')}>{l.kind}</span>
                    <span className="num font-semibold">{price(l.price)}</span>
                    <span className="min-w-0 flex-1 truncate text-[11.5px] text-[var(--tv-muted)]">{l.label}</span>
                    <span className="opacity-0 group-hover:opacity-100">
                      <IconBtn icon={BellPlus} size={20} label={'Alert at ' + price(l.price)} onClick={() => dialogs.newAlert({ symbol: a.symbol, price: l.price })} />
                    </span>
                  </div>
                ))}
            </div>
          )}
          {f !== null && f.price !== undefined && (
            <div className="mt-2 flex flex-wrap gap-1">
              <span className="rounded-[4px] bg-[var(--tv-row)] px-1.5 py-0.5 text-[11px] font-semibold">
                {price(f.price)} <Change value={f.change_pct ?? null} />
              </span>
              {f.rsi14 !== undefined && <span className="rounded-[4px] bg-[var(--tv-row)] px-1.5 py-0.5 text-[11px] font-semibold">RSI {num(f.rsi14, 1)}</span>}
              {f.atr_pct !== undefined && <span className="rounded-[4px] bg-[var(--tv-row)] px-1.5 py-0.5 text-[11px] font-semibold">ATR {plainPct(f.atr_pct)}</span>}
              {f.trend !== undefined && f.trend !== null && <span className="rounded-[4px] bg-[var(--tv-row)] px-1.5 py-0.5 text-[11px] font-semibold">{f.trend}</span>}
              {f.relative_volume !== undefined && f.relative_volume !== null && <span className="rounded-[4px] bg-[var(--tv-row)] px-1.5 py-0.5 text-[11px] font-semibold">RVOL {num(f.relative_volume, 2)}×</span>}
            </div>
          )}
          {a.kind === 'symbol' && a.run !== '' && a.state === 'done' && (
            <div className="mt-2 flex gap-1">
              <Btn
                size="xs"
                icon={Check}
                onClick={() =>
                  void api
                    .adopt({ symbol: a.symbol, run: a.run })
                    .then((r) => toast.success(r.adopted > 0 ? 'Kept ' + r.adopted + ' drawing' + (r.adopted === 1 ? '' : 's') : 'No AI drawings left to keep'))
                    .catch((err: unknown) => toast.error(errMessage(err)))
                }
              >
                Keep markup
              </Btn>
              <Btn
                size="xs"
                variant="ghost"
                icon={X}
                onClick={() =>
                  void api
                    .clearDrawings(a.symbol, 'agent')
                    .then((r) => toast.success(r.deleted > 0 ? 'Cleared ' + r.deleted + ' AI drawing' + (r.deleted === 1 ? '' : 's') : 'No AI drawings on the chart'))
                    .catch((err: unknown) => toast.error(errMessage(err)))
                }
              >
                Clear markup
              </Btn>
              <span className="flex-1" />
              <IconBtn icon={Trash2} size={22} label="Delete analysis" onClick={() => void api.deleteAnalysis(a.id).catch((err: unknown) => toast.error(errMessage(err)))} />
            </div>
          )}
        </div>
      )}
    </article>
  );
}

export function AnalystWidget({ w }: { w: Widget }): React.JSX.Element {
  const app = useApp();
  const dialogs = useDialogs();
  const { symbol, interval } = app.shows(w);
  const analyses = useAnalyses(symbol);
  const reviews = useLive(() => api.analyses({ state: 'any', limit: 10 }).then((r) => r.analyses.filter((a) => a.kind === 'watchlist')), ['analyses'], []);
  const notes = useLive(() => api.alertEvents({ symbol, limit: 20 }).then((r) => r.events.filter((e) => e.agent_state !== '')), ['alert_events'], [symbol], (e) => e.record['symbol'] === symbol);
  const [focus, setFocus] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const list = analyses.data ?? [];
  const pending = list.find((a) => a.state === 'waiting' || a.state === 'working') ?? null;
  const done = useMemo(() => list.filter((a) => a.state === 'done' || a.state === 'failed'), [list]);

  const ask = async (q: string): Promise<void> => {
    setBusy(true);
    try {
      const r = await api.requestAnalysis({ symbol, interval, focus: q });
      if (!r.asked && r.reason !== '') toast.info('Queued: ' + r.reason);
      setFocus('');
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <WidgetShell
      w={w}
      title={
        <span className="flex min-w-0 items-center gap-1.5">
          <Sparkles size={13} className="shrink-0 text-[var(--tv-accent-text)]" />
          <Title detail={short(symbol) + ' · ' + interval}>AI analyst</Title>
        </span>
      }
    >
      <div className="flex h-full flex-col">
        <div className="shrink-0 border-b border-[var(--tv-hair)] p-2">
          <div className="flex gap-1.5">
            <textarea
              rows={1}
              value={focus}
              maxLength={1000}
              onChange={(e) => setFocus(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void ask(focus);
                }
              }}
              placeholder={'Ask about ' + short(symbol) + ' (' + interval + ')'}
              aria-label="Question for your AI agent"
              className={area + ' min-h-7 flex-1 resize-none'}
            />
            <Btn variant="accent" icon={Sparkles} loading={busy} disabled={pending !== null} onClick={() => void ask(focus)}>
              Ask
            </Btn>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {PRESETS.map((p) => (
              <button key={p} type="button" disabled={pending !== null || busy} onClick={() => void ask(p)} className="h-[22px] rounded-[4px] bg-[var(--tv-row)] px-1.5 text-[11px] font-semibold text-[var(--tv-ink-2)] hover:bg-[var(--tv-row-hover)] hover:text-[var(--tv-ink)] disabled:opacity-40">
                {p}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {pending !== null && (
            <div className="flex items-center gap-2 border-b border-[var(--tv-hair)] bg-[var(--tv-accent-soft)] px-2.5 py-2">
              <Sparkles size={14} className="tv-pulse shrink-0 text-[var(--tv-accent-text)]" />
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-semibold">{pending.state === 'working' ? 'Your AI agent is reading the chart' : 'Waiting for your AI agent'}</p>
                <p className="truncate text-[11px] text-[var(--tv-ink-2)]">{pending.focus !== '' ? '“' + pending.focus + '”' : 'Full analysis of ' + short(pending.symbol) + ' · ' + pending.interval}</p>
              </div>
              {pending.state === 'waiting' && <IconBtn icon={X} size={22} label="Cancel" onClick={() => void api.cancelAnalysis(pending.id).catch((err: unknown) => toast.error(errMessage(err)))} />}
            </div>
          )}
          {done.length === 0 && pending === null && (
            <Empty icon={Sparkles} title={'No AI analysis of ' + short(symbol) + ' yet'}>
              Ask a question or pick a preset: your AI agent reads the chart, marks levels and writes what it sees.
            </Empty>
          )}
          {done.map((a, i) => (
            <AnalysisCard key={a.id} a={a} open={open[a.id] ?? i === 0} onToggle={() => setOpen((o) => ({ ...o, [a.id]: !(o[a.id] ?? i === 0) }))} />
          ))}
          {(notes.data ?? []).length > 0 && (
            <div className="border-b border-[var(--tv-hair)] px-2.5 py-2">
              <div className="mb-1 text-[10.5px] font-bold uppercase tracking-[0.04em] text-[var(--tv-muted)]">On your alerts</div>
              {(notes.data ?? []).slice(0, 5).map((e) => (
                <div key={e.id} className="mb-1.5 border-l-2 border-[var(--tv-accent)] pl-2">
                  <p className="text-[11.5px] font-semibold text-[var(--tv-ink-2)]">
                    {e.detail} · {ago(e.created)}
                  </p>
                  <p className="tv-prose text-[12px] leading-[17px]">{e.agent_state === 'done' || e.agent_state === 'failed' ? e.agent_note : 'Looking into it'}</p>
                </div>
              ))}
            </div>
          )}
          {(reviews.data ?? []).length > 0 && (
            <div>
              <div className="px-2.5 pb-0.5 pt-2 text-[10.5px] font-bold uppercase tracking-[0.04em] text-[var(--tv-muted)]">Watchlist reviews</div>
              {(reviews.data ?? []).slice(0, 3).map((a) =>
                a.state === 'waiting' || a.state === 'working' ? (
                  <p key={a.id} className="tv-pulse px-2.5 py-1.5 text-[12px] text-[var(--tv-muted)]">
                    Reviewing {app.lists.find((l) => l.id === a.watchlist)?.name ?? 'a watchlist'}
                  </p>
                ) : (
                  <AnalysisCard key={a.id} a={a} open={open[a.id] ?? false} onToggle={() => setOpen((o) => ({ ...o, [a.id]: !(o[a.id] ?? false) }))} />
                ),
              )}
            </div>
          )}
          {app.lists.length > 0 && (
            <div className="px-2.5 py-2">
              <button type="button" className="text-[11.5px] font-semibold text-[var(--tv-accent-text)] hover:underline" onClick={() => dialogs.askAI({ watchlist: app.lists[0]?.id ?? '', watchlistName: app.lists[0]?.name ?? '' })}>
                Ask AI to review the "{app.lists[0]?.name}" watchlist
              </button>
            </div>
          )}
        </div>
      </div>
    </WidgetShell>
  );
}
