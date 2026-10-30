/**
 * A strip of quotes across the top of a workspace. Clicking one shows it on
 * link channel 1 (or the strip's own channel).
 */
import { useEffect, useRef, useState } from 'react';
import { Pencil, Plus, X } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { Btn, Change, IconBtn, Modal } from '../components/ui.tsx';
import { price, short } from '../lib/format.ts';
import { useQuotes } from '../lib/live.ts';
import { useApp } from '../lib/store.tsx';
import type { Widget } from '../lib/types.ts';
import { useDialogs } from '../workspace/Dialogs.tsx';
import { WidgetShell } from '../workspace/WidgetShell.tsx';

const NAMES: Record<string, string> = {
  '^GSPC': 'S&P 500',
  '^IXIC': 'Nasdaq',
  '^DJI': 'Dow',
  '^RUT': 'Russell 2000',
  '^VIX': 'VIX',
  '^TNX': 'US 10Y',
  '^FTSE': 'FTSE 100',
  '^GDAXI': 'DAX',
  '^N225': 'Nikkei',
  '^HSI': 'Hang Seng',
  'GC=F': 'Gold',
  'CL=F': 'Crude oil',
  'SI=F': 'Silver',
  'NG=F': 'Nat gas',
  'ES=F': 'S&P fut',
  'NQ=F': 'Nasdaq fut',
  'DX-Y.NYB': 'Dollar index',
};

export function TickerWidget({ w }: { w: Widget }): React.JSX.Element {
  const app = useApp();
  const dialogs = useDialogs();
  const symbols = w.config.symbols ?? [];
  const quotes = useQuotes(symbols);
  const [editing, setEditing] = useState(false);
  const current = app.shows(w).symbol;
  const ref = useRef<HTMLDivElement | null>(null);
  const [overflow, setOverflow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const ro = new ResizeObserver(() => setOverflow(el.scrollWidth > el.clientWidth + 2));
    ro.observe(el);
    return () => ro.disconnect();
  }, [symbols.length]);

  const pick = (s: string): void => {
    if (w.link !== '') app.show(w, { symbol: s });
    else app.focusChannel('1', { symbol: s });
  };

  return (
    <WidgetShell w={w} strip title={null} actions={<IconBtn icon={Pencil} label="Edit symbols" size={22} onClick={() => setEditing(true)} />}>
      <div
        ref={ref}
        className={cn('tv-nodrag flex h-full items-stretch overflow-x-auto', overflow && '[scrollbar-width:thin]')}
        onWheel={(e) => {
          if (ref.current !== null && e.deltaY !== 0) ref.current.scrollLeft += e.deltaY;
        }}
      >
        {symbols.map((s) => {
          const q = quotes[s];
          return (
            <button key={s} type="button" onClick={() => pick(s)} className={cn('flex shrink-0 flex-col justify-center border-r border-[var(--tv-hair)] px-2.5 text-left hover:bg-[var(--tv-row)]', s === current && 'bg-[var(--tv-row)]')} title={q?.name ?? s}>
              <span className="text-[10.5px] font-bold uppercase tracking-[0.02em] text-[var(--tv-muted)]">{NAMES[s] ?? short(s)}</span>
              <span className="num flex items-baseline gap-1.5 text-[12px] font-semibold leading-4">
                {price(q?.price, q?.price_hint)}
                <Change value={q?.change_pct} className="text-[11px]" />
              </span>
            </button>
          );
        })}
      </div>
      {editing && (
        <Modal open width="sm" onClose={() => setEditing(false)} title="Ticker symbols" footer={<Btn variant="primary" onClick={() => setEditing(false)}>Done</Btn>}>
          <div className="flex flex-col">
            {symbols.map((s, i) => (
              <div key={s} className="flex h-8 items-center justify-between rounded-[4px] px-1 hover:bg-[var(--tv-row)]">
                <span className="text-[12.5px] font-semibold">
                  {short(s)} <span className="text-[11.5px] font-normal text-[var(--tv-muted)]">{NAMES[s] ?? ''}</span>
                </span>
                <IconBtn icon={X} label={'Remove ' + s} size={22} onClick={() => app.configure(w, { symbols: symbols.filter((_, j) => j !== i) })} />
              </div>
            ))}
            <Btn className="mt-2 self-start" icon={Plus} onClick={() => dialogs.searchSymbol('', (s) => !symbols.includes(s) && app.configure(w, { symbols: [...symbols, s].slice(0, 40) }), 'Add to ticker')}>
              Add symbol
            </Btn>
          </div>
        </Modal>
      )}
    </WidgetShell>
  );
}
