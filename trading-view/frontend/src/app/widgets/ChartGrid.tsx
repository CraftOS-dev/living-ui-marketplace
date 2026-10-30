/**
 * Multi-timeframe: one symbol on several intervals side by side (2 to 6
 * charts). Each pane's interval is picked from its corner label.
 */
import { Sparkles } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { Change, Menu, Select } from '../components/ui.tsx';
import { price, short } from '../lib/format.ts';
import { useQuote } from '../lib/live.ts';
import { useApp } from '../lib/store.tsx';
import { INTERVALS } from '../lib/types.ts';
import type { Interval, Widget } from '../lib/types.ts';
import { useDialogs } from '../workspace/Dialogs.tsx';
import { WidgetShell } from '../workspace/WidgetShell.tsx';
import { ChartView } from './chart/ChartView.tsx';
import { ivLabel } from './chart/ChartWidget.tsx';

const LAYOUTS: Record<string, { cols: number; rows: number; n: number }> = {
  '1x2': { cols: 2, rows: 1, n: 2 },
  '2x1': { cols: 1, rows: 2, n: 2 },
  '2x2': { cols: 2, rows: 2, n: 4 },
  '1x3': { cols: 3, rows: 1, n: 3 },
  '3x1': { cols: 1, rows: 3, n: 3 },
  '2x3': { cols: 3, rows: 2, n: 6 },
};
const DEFAULTS: Interval[] = ['1D', '4h', '1h', '15m', '5m', '1W'];

export function ChartGridWidget({ w }: { w: Widget }): React.JSX.Element {
  const app = useApp();
  const dialogs = useDialogs();
  const { symbol } = app.shows(w);
  const q = useQuote(symbol);
  const layout = LAYOUTS[w.config.layout ?? '2x2'] ?? LAYOUTS['2x2']!;
  const intervals: Interval[] = Array.from({ length: layout.n }, (_, i) => w.config.intervals?.[i] ?? DEFAULTS[i] ?? '1D');
  const type = w.config.type ?? 'candles';
  const setInterval = (i: number, iv: Interval): void => {
    const next = intervals.slice();
    next[i] = iv;
    app.configure(w, { intervals: next });
  };
  return (
    <WidgetShell
      w={w}
      title={
        <span className="flex min-w-0 items-center gap-1.5">
          <button type="button" className="tv-nodrag rounded-[4px] px-1 text-[12.5px] font-bold hover:bg-[var(--tv-row)]" onClick={() => dialogs.searchSymbol('', (s) => app.show(w, { symbol: s }))}>
            {short(symbol)}
          </button>
          {q?.price !== undefined && q.price !== null && (
            <span className="num flex items-baseline gap-1 text-[12px] font-semibold">
              {price(q.price, q.price_hint)} <Change value={q.change_pct} className="text-[11.5px]" />
            </span>
          )}
          <span className="text-[11px] font-semibold text-[var(--tv-muted)]">Multi-timeframe</span>
        </span>
      }
      actions={
        <>
          <Select small label="Layout" value={w.config.layout ?? '2x2'} onChange={(v) => app.configure(w, { layout: v })} options={Object.keys(LAYOUTS).map((k) => ({ value: k, label: k.replace('x', ' × ') }))} className="w-[70px]" />
          <button type="button" onClick={() => dialogs.askAI({ symbol, interval: intervals[0] ?? '1D', focus: 'Read the trend across ' + intervals.join(', ') })} className="flex h-6 items-center gap-1 rounded-[4px] px-1.5 text-[11.5px] font-bold text-[var(--tv-accent-text)] hover:bg-[var(--tv-accent-soft)]">
            <Sparkles size={13} /> Ask AI
          </button>
        </>
      }
    >
      <div className="grid h-full gap-px bg-[var(--tv-line)]" style={{ gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))` }}>
        {intervals.map((iv, i) => (
          <div key={i} className="relative min-h-0 min-w-0 bg-[var(--tv-card)]">
            <ChartView symbol={symbol} interval={iv} type={type} scale="normal" indicators={[{ id: 'volume', params: {} }]} compare={[]} ext={false} compact onInterval={(v) => setInterval(i, v)} onTypeSymbol={(t) => dialogs.searchSymbol(t, (s) => app.show(w, { symbol: s }))} />
            <span className="absolute right-[62px] top-1 z-[3]">
              <Menu
                align="right"
                items={INTERVALS.map((x) => ({ label: x, checked: x === iv, onClick: () => setInterval(i, x) }))}
                trigger={(open, toggle) => (
                  <button type="button" onClick={toggle} className={cn('tv-nodrag h-5 rounded-[3px] border border-[var(--tv-line)] bg-[var(--tv-card)] px-1.5 text-[11px] font-bold', open && 'bg-[var(--tv-row)]')}>
                    {ivLabel(iv)}
                  </button>
                )}
              />
            </span>
          </div>
        ))}
      </div>
    </WidgetShell>
  );
}
