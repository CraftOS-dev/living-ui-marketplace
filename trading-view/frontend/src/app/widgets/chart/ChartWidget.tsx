/**
 * The chart widget: header (symbol, live price, interval, chart type,
 * indicators, comparisons, extended hours, alert, Ask AI, snapshot), the
 * chart, and a footer with range presets and price-scale modes.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AreaChart,
  BarChart3,
  BellPlus,
  Camera,
  CandlestickChart,
  ChartCandlestick,
  Clock,
  LineChart,
  Plus,
  Sparkles,
  Sigma,
  Waves,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { IndicatorPicker, IndicatorSettings } from '../../components/IndicatorDialog.tsx';
import { Change, IconBtn, Menu, Select } from '../../components/ui.tsx';
import { downloadBlob } from '../../lib/api.ts';
import { price as fmtPrice, short } from '../../lib/format.ts';
import { useQuote } from '../../lib/live.ts';
import { useApp } from '../../lib/store.tsx';
import * as ta from '../../lib/ta.js';
import { chartZone, localZone, utcLabel, zoneLabel } from '../../lib/time.ts';
import { INTERVALS, INTRADAY } from '../../lib/types.ts';
import type { ChartType, IndicatorConf, Interval, Meta, Scale, TzMode, Widget } from '../../lib/types.ts';
import { useDialogs } from '../../workspace/Dialogs.tsx';
import { WidgetShell } from '../../workspace/WidgetShell.tsx';
import type { ChartEngine } from './engine.ts';
import { ChartView } from './ChartView.tsx';

const TYPES: { value: ChartType; label: string; icon: LucideIcon }[] = [
  { value: 'candles', label: 'Candles', icon: CandlestickChart },
  { value: 'hollow', label: 'Hollow candles', icon: ChartCandlestick },
  { value: 'heikin', label: 'Heikin Ashi', icon: ChartCandlestick },
  { value: 'bars', label: 'Bars (OHLC)', icon: BarChart3 },
  { value: 'line', label: 'Line', icon: LineChart },
  { value: 'area', label: 'Area', icon: AreaChart },
  { value: 'baseline', label: 'Baseline', icon: Waves },
];

const FAVORITES: Interval[] = ['1m', '5m', '15m', '1h', '4h', '1D', '1W'];

const RANGES: { label: string; interval: Interval; span: number | 'ytd' | 'all' }[] = [
  { label: '1D', interval: '5m', span: 86400 },
  { label: '5D', interval: '15m', span: 5 * 86400 },
  { label: '1M', interval: '1h', span: 31 * 86400 },
  { label: '3M', interval: '4h', span: 92 * 86400 },
  { label: '6M', interval: '1D', span: 183 * 86400 },
  { label: 'YTD', interval: '1D', span: 'ytd' },
  { label: '1Y', interval: '1D', span: 366 * 86400 },
  { label: '5Y', interval: '1W', span: 5 * 366 * 86400 },
  { label: 'All', interval: '1M', span: 'all' },
];

export function ivLabel(iv: Interval): string {
  return iv === '1D' ? 'D' : iv === '1W' ? 'W' : iv === '1M' ? 'M' : iv;
}

export function ChartWidget({ w }: { w: Widget }): React.JSX.Element {
  const app = useApp();
  const dialogs = useDialogs();
  const shows = app.shows(w);
  const { symbol, interval } = shows;
  const cfg = w.config;
  const type = cfg.type ?? 'candles';
  const scale = cfg.scale ?? 'normal';
  const indicators = cfg.indicators ?? [];
  const compare = cfg.compare ?? [];
  const ext = cfg.ext === true;
  const quote = useQuote(symbol);
  const engine = useRef<ChartEngine | null>(null);
  const pendingRange = useRef<number | 'ytd' | 'all' | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [picker, setPicker] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [width, setWidth] = useState(800);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (el === null) return;
    const ro = new ResizeObserver((entries) => setWidth(entries[0]?.contentRect.width ?? 800));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const setIndicators = useCallback((list: IndicatorConf[]) => app.configure(w, { indicators: list }), [app, w]);
  const onMeta = useCallback((m: Meta | null) => {
    setMeta(m);
    const span = pendingRange.current;
    if (span !== null && engine.current !== null) {
      pendingRange.current = null;
      requestAnimationFrame(() => {
        const e = engine.current;
        if (e !== null && !e.disposed) e.showLast(span);
      });
    }
  }, []);

  const typeIcon = TYPES.find((t) => t.value === type)?.icon ?? CandlestickChart;
  const extPossible = meta?.ext_hours === true && INTRADAY[interval];
  const narrow = width < 560;
  const roomy = width >= 780;
  const extRoom = width >= 960;
  const wide = width >= 1150;

  const snapshot = (): void => {
    const e = engine.current;
    if (e === null) return;
    e.screenshot().toBlob((b) => {
      if (b !== null) downloadBlob(`${short(symbol)}_${interval}_${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.png`, b);
    });
  };

  const title = (
    <span className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap">
      <button type="button" className="tv-nodrag flex min-w-0 shrink-0 items-baseline gap-1.5 rounded-[4px] px-1 hover:bg-[var(--tv-row)]" onClick={() => dialogs.searchSymbol('', (s) => app.show(w, { symbol: s }))} title={(meta?.name ?? '') + ' · change symbol (or type on the chart)'}>
        <span className="text-[12.5px] font-bold">{short(symbol)}</span>
        {wide && <span className="max-w-[160px] truncate text-[11px] font-semibold text-[var(--tv-muted)]">{meta?.name ?? quote?.name ?? ''}</span>}
      </button>
      {quote?.price !== null && quote?.price !== undefined && (
        <span className="num flex shrink-0 items-baseline gap-1 text-[12px] font-semibold">
          {fmtPrice(quote.price, quote.price_hint)}
          <Change value={quote.change_pct} className="text-[11.5px]" />
        </span>
      )}
      {quote?.ext_price !== null && quote?.ext_price !== undefined && extRoom && (
        <span className="num text-[11px] font-semibold text-[var(--tv-muted)]" title={quote.state === 'pre' ? 'Pre-market' : 'Post-market'}>
          {quote.state === 'pre' ? 'Pre' : 'Post'} {fmtPrice(quote.ext_price, quote.price_hint)} <Change value={quote.ext_change_pct} className="text-[11px]" />
        </span>
      )}
      {quote !== undefined && quote.provider === 'yahoo' && quote.state !== 'open' && wide && <span className="text-[10.5px] font-bold uppercase text-[var(--tv-muted)]">{quote.state === 'closed' ? 'Closed' : quote.state === 'pre' ? 'Pre-market' : quote.state === 'post' ? 'After hours' : ''}</span>}
    </span>
  );

  const actions = (
    <>
      {!roomy ? (
        <Select small label="Interval" value={interval} onChange={(v) => app.show(w, { interval: v as Interval })} options={INTERVALS.map((i) => ({ value: i, label: ivLabel(i) }))} className="w-[58px]" />
      ) : (
        <span className="mr-0.5 flex items-center">
          {FAVORITES.map((iv) => (
            <button key={iv} type="button" onClick={() => app.show(w, { interval: iv })} className={cn('h-6 min-w-6 rounded-[4px] px-1 text-[11.5px] font-bold', iv === interval ? 'bg-[var(--tv-row-hover)] text-[var(--tv-ink)]' : 'text-[var(--tv-ink-2)] hover:bg-[var(--tv-row)]')}>
              {ivLabel(iv)}
            </button>
          ))}
          {!FAVORITES.includes(interval) && <span className="h-6 rounded-[4px] bg-[var(--tv-row-hover)] px-1 text-[11.5px] font-bold leading-6">{ivLabel(interval)}</span>}
          <Menu
            align="right"
            items={INTERVALS.map((iv) => ({ label: iv, checked: iv === interval, onClick: () => app.show(w, { interval: iv }) }))}
            trigger={(open, toggle) => <IconBtn icon={Clock} label="All intervals (or type digits on the chart)" size={24} active={open} onClick={toggle} />}
          />
        </span>
      )}
      <Menu
        align="right"
        items={TYPES.map((t) => ({ label: t.label, icon: t.icon, checked: t.value === type, onClick: () => app.configure(w, { type: t.value }) }))}
        trigger={(open, toggle) => <IconBtn icon={typeIcon} label="Chart type" size={24} active={open} onClick={toggle} />}
      />
      <button type="button" onClick={() => setPicker(true)} className="flex h-6 items-center gap-1 rounded-[4px] px-1.5 text-[11.5px] font-bold text-[var(--tv-ink-2)] hover:bg-[var(--tv-row)] hover:text-[var(--tv-ink)]" title="Indicators">
        <Sigma size={14} /> {!narrow && 'Indicators'}
      </button>
      {!narrow && (
        <Menu
          align="right"
          items={[
            { label: 'Add a symbol to compare', icon: Plus, onClick: () => dialogs.searchSymbol('', (s) => !compare.includes(s) && s !== symbol && app.configure(w, { compare: [...compare, s].slice(0, 5) }), 'Compare with') },
            ...(compare.length > 0 ? (['divider'] as const) : []),
            ...compare.map((s) => ({ label: 'Remove ' + short(s), icon: X, onClick: () => app.configure(w, { compare: compare.filter((x) => x !== s) }) })),
          ]}
          trigger={(open, toggle) => (
            <button type="button" onClick={toggle} className={cn('flex h-6 items-center gap-1 rounded-[4px] px-1.5 text-[11.5px] font-bold hover:bg-[var(--tv-row)]', open || compare.length > 0 ? 'text-[var(--tv-ink)]' : 'text-[var(--tv-ink-2)]')} title="Compare symbols">
              <Plus size={13} /> Compare{compare.length > 0 ? ' ' + compare.length : ''}
            </button>
          )}
        />
      )}
      {extPossible && (
        <button type="button" onClick={() => app.configure(w, { ext: !ext })} className={cn('h-6 rounded-[4px] px-1.5 text-[11.5px] font-bold hover:bg-[var(--tv-row)]', ext ? 'bg-[var(--tv-row-hover)] text-[var(--tv-ink)]' : 'text-[var(--tv-ink-2)]')} title="Extended hours: pre- and post-market trading">
          ETH
        </button>
      )}
      <IconBtn icon={BellPlus} label="New alert (Alt+A)" size={24} onClick={() => dialogs.newAlert({ symbol, interval, ...(quote?.price !== null && quote?.price !== undefined ? { price: quote.price } : {}) })} />
      <button type="button" onClick={() => dialogs.askAI({ symbol, interval })} className="flex h-6 items-center gap-1 rounded-[4px] px-1.5 text-[11.5px] font-bold text-[var(--tv-accent-text)] hover:bg-[var(--tv-accent-soft)]" title="Ask your AI agent to analyze this chart">
        <Sparkles size={13} /> {!narrow && 'Ask AI'}
      </button>
      {!narrow && <IconBtn icon={Camera} label="Save a picture of the chart" size={24} onClick={snapshot} />}
    </>
  );

  const scaleBtn = (s: Scale, label: string, title: string): React.JSX.Element => (
    <button type="button" title={title} onClick={() => app.configure(w, { scale: scale === s ? 'normal' : s })} className={cn('h-5 rounded-[3px] px-1.5 text-[11px] font-bold', scale === s ? 'bg-[var(--tv-row-hover)] text-[var(--tv-ink)]' : 'text-[var(--tv-muted)] hover:text-[var(--tv-ink)]')}>
      {label}
    </button>
  );

  return (
    <WidgetShell
      w={w}
      title={title}
      actions={actions}
      menu={[
        { label: 'Indicators', icon: Sigma, onClick: () => setPicker(true) },
        ...(w.link !== ''
          ? [{ label: 'Keep its own interval', icon: Clock, checked: cfg.interval_own === true, onClick: () => app.configure(w, cfg.interval_own === true ? { interval_own: false } : { interval_own: true, interval }) }]
          : []),
        { label: 'Save a picture', icon: Camera, onClick: snapshot },
        { label: 'Ask AI about this chart', icon: Sparkles, onClick: () => dialogs.askAI({ symbol, interval }) },
      ]}
    >
      <div ref={boxRef} className="flex h-full min-h-0 flex-col">
        <div className="min-h-0 flex-1">
          <ChartView
            symbol={symbol}
            interval={interval}
            type={type}
            scale={scale}
            indicators={indicators}
            compare={compare}
            ext={ext && extPossible}
            compact={width < 380}
            onTypeSymbol={(t) => dialogs.searchSymbol(t, (s) => app.show(w, { symbol: s }))}
            onInterval={(iv) => app.show(w, { interval: iv })}
            onIndicators={setIndicators}
            onEditIndicator={setEditing}
            onAlert={(p) => dialogs.newAlert({ symbol, interval, ...(p.price !== undefined ? { price: p.price } : {}), ...(p.drawing !== undefined ? { drawing: p.drawing } : {}) })}
            onAskAI={() => dialogs.askAI({ symbol, interval })}
            onEngine={(e) => (engine.current = e)}
            onMeta={onMeta}
          />
        </div>
        {width >= 380 && (
          <div className="flex h-6 shrink-0 items-center gap-0.5 overflow-hidden whitespace-nowrap border-t border-[var(--tv-hair)] px-1">
            {RANGES.filter((r) => width >= 520 || ['1D', '5D', '1M', '1Y', 'All'].includes(r.label)).map((r) => (
              <button
                key={r.label}
                type="button"
                onClick={() => {
                  if (r.interval === interval) engine.current?.showLast(r.span);
                  else {
                    pendingRange.current = r.span;
                    app.show(w, { interval: r.interval });
                  }
                }}
                className="h-5 rounded-[3px] px-1.5 text-[11px] font-bold text-[var(--tv-muted)] hover:bg-[var(--tv-row)] hover:text-[var(--tv-ink)]"
              >
                {r.label}
              </button>
            ))}
            <span className="flex-1" />
            {meta !== null && width >= 520 && (
              <Menu
                align="right"
                items={(
                  [
                    ['exchange', 'Exchange time (' + zoneLabel(meta.tz) + ')'],
                    ['local', 'My time (' + zoneLabel(localZone()) + ')'],
                    ['utc', 'UTC'],
                  ] as [TzMode, string][]
                ).map(([m, label]) => ({ label, checked: (app.settings?.tz_mode ?? 'exchange') === m, onClick: () => app.updateSettings({ tz_mode: m }) }))}
                trigger={(open, toggle) => {
                  const zone = chartZone(app.settings?.tz_mode ?? 'exchange', meta.tz, INTRADAY[interval]);
                  return (
                    <button type="button" onClick={toggle} title="Time zone of the axis (daily bars use the exchange's date)" className={cn('mr-1 h-5 rounded-[3px] px-1.5 text-[11px] font-semibold text-[var(--tv-muted)] hover:text-[var(--tv-ink)]', open && 'bg-[var(--tv-row)]')}>
                      {zoneLabel(zone) === 'UTC' ? 'UTC' : zoneLabel(zone) + ' ' + utcLabel(zone, Math.floor(Date.now() / 1000))}
                    </button>
                  );
                }}
              />
            )}
            {scaleBtn('percent', '%', 'Percent scale')}
            {scaleBtn('indexed', '100', 'Indexed to 100')}
            {scaleBtn('log', 'log', 'Logarithmic scale')}
            <button type="button" title="Reset view (Alt+R)" onClick={() => engine.current?.autoScale()} className="h-5 rounded-[3px] px-1.5 text-[11px] font-bold text-[var(--tv-muted)] hover:text-[var(--tv-ink)]">
              auto
            </button>
          </div>
        )}
      </div>
      <IndicatorPicker
        open={picker}
        onClose={() => setPicker(false)}
        current={indicators}
        onAdd={(id) => {
          if (indicators.length >= 16) {
            toast.error('A chart holds at most 16 indicators');
            return;
          }
          setIndicators([...indicators, { id, params: ta.params(id, {}) }]);
        }}
      />
      {editing !== null && indicators[editing] !== undefined && (
        <IndicatorSettings
          key={editing}
          conf={indicators[editing] ?? null}
          onClose={() => setEditing(null)}
          onSave={(c) => setIndicators(indicators.map((x, i) => (i === editing ? c : x)))}
        />
      )}
    </WidgetShell>
  );
}
