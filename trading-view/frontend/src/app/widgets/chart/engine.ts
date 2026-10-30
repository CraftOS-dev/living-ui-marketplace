/**
 * The chart engine: one lightweight-charts instance with the price series,
 * volume, indicators (overlays on the price pane, oscillators in panes of
 * their own), comparison lines, price lines (alerts, the AI agent's levels,
 * extended-hours price), extended-hours shading, a bar-close countdown and
 * the drawing layer.
 *
 * Times: the library draws its axis in UTC, so bar times are shifted into
 * the chart's zone (lib/time.ts). Drawings and alerts keep real unix times;
 * timeToX / xToTime convert through the bars' logical indexes, which also
 * places drawings correctly at any interval.
 */
import {
  AreaSeries,
  BarSeries,
  BaselineSeries,
  CandlestickSeries,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  PriceScaleMode,
  TickMarkType,
} from 'lightweight-charts';
import type { IChartApi, IPriceLine, ISeriesApi, ISeriesMarkersPluginApi, Logical, MouseEventParams, SeriesType, Time, UTCTimestamp } from 'lightweight-charts';
import * as ta from '../../lib/ta.js';
import type { Computed, IndicatorDef, TaBar } from '../../lib/ta.js';
import { price as fmtPrice, decimals, compact } from '../../lib/format.ts';
import { chartColors } from '../../lib/themeColors.ts';
import { isExtended, tzOffset } from '../../lib/time.ts';
import type { Bar, ChartType, Events, IndicatorConf, Interval, Meta, Scale } from '../../lib/types.ts';
import { INTRADAY, IV_SEC } from '../../lib/types.ts';
import { BandFill, Countdown, SessionShade } from './primitives.ts';
import { DrawingLayer } from './drawings.ts';
import type { Geo } from './drawings.ts';

export interface IndicatorView {
  key: string;
  index: number;
  conf: IndicatorConf;
  def: IndicatorDef;
  label: string;
  pane: number;
  colors: Record<string, string>;
  computed: Computed;
}

export interface Legend {
  bar: Bar | null;
  prev: Bar | null;
  indicators: { key: string; index: number; label: string; hidden: boolean; pane: number; values: { label: string; value: string; color: string }[] }[];
  compare: { symbol: string; value: string; color: string }[];
}

interface IndSeries {
  view: IndicatorView;
  series: Map<string, ISeriesApi<SeriesType>>;
  fill: BandFill | null;
  bands: IPriceLine[];
}

const SCALE_MODE: Record<Scale, PriceScaleMode> = { normal: PriceScaleMode.Normal, log: PriceScaleMode.Logarithmic, percent: PriceScaleMode.Percentage, indexed: PriceScaleMode.IndexedTo100 };

function heikin(bars: Bar[]): Bar[] {
  const out: Bar[] = [];
  let po = 0;
  let pc = 0;
  bars.forEach((b, i) => {
    const c = (b.o + b.h + b.l + b.c) / 4;
    const o = i === 0 ? (b.o + b.c) / 2 : (po + pc) / 2;
    out.push({ t: b.t, o, h: Math.max(b.h, o, c), l: Math.min(b.l, o, c), c, v: b.v });
    po = o;
    pc = c;
  });
  return out;
}

export class ChartEngine {
  readonly chart: IChartApi;
  main: ISeriesApi<SeriesType>;
  private volume: ISeriesApi<'Histogram'> | null = null;
  private type: ChartType = 'candles';
  private scale: Scale = 'normal';
  bars: Bar[] = [];
  private disp: number[] = [];
  meta: Meta | null = null;
  interval: Interval = '1D';
  zone = 'UTC';
  ext = false;
  private indicators: IndSeries[] = [];
  private confs: IndicatorConf[] = [];
  private compare = new Map<string, { series: ISeriesApi<'Line'>; bars: Bar[]; color: string }>();
  private priceLines: IPriceLine[] = [];
  private markers: ISeriesMarkersPluginApi<Time> | null = null;
  private events: Events | null = null;
  readonly shade = new SessionShade();
  readonly countdown = new Countdown();
  readonly drawings = new DrawingLayer();
  private hoverIndex: number | null = null;
  onLegend: ((l: Legend) => void) | null = null;
  private readonly crosshairHandler: (p: MouseEventParams<Time>) => void;

  constructor(container: HTMLElement) {
    const c = chartColors();
    this.chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { color: c.card },
        textColor: c.ink2,
        fontFamily: 'Manrope Variable, Manrope, system-ui, sans-serif',
        fontSize: 11,
        attributionLogo: false,
        panes: { separatorColor: c.line, separatorHoverColor: c.accentSoft, enableResize: true },
      },
      grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: c.crosshair, width: 1, style: LineStyle.Dashed, labelBackgroundColor: c.label },
        horzLine: { color: c.crosshair, width: 1, style: LineStyle.Dashed, labelBackgroundColor: c.label },
      },
      rightPriceScale: { borderColor: c.line, scaleMargins: { top: 0.08, bottom: 0.08 }, minimumWidth: 56 },
      timeScale: { borderColor: c.line, rightOffset: 8, barSpacing: 7, minBarSpacing: 0.4, shiftVisibleRangeOnNewBar: true, tickMarkFormatter: (t: Time, kind: TickMarkType) => this.tickLabel(t, kind) },
      localization: { priceFormatter: (p: number) => fmtPrice(p, this.meta?.price_hint), timeFormatter: (t: Time) => this.timeLabel(t) },
      handleScale: { axisPressedMouseMove: { time: true, price: true }, mouseWheel: true, pinch: true },
      kineticScroll: { mouse: false, touch: true },
    });
    this.main = this.makeMain('candles');
    this.crosshairHandler = (p) => {
      const lg = p.logical === undefined ? null : Math.round(p.logical);
      this.hoverIndex = lg !== null && lg >= 0 && lg < this.bars.length ? lg : null;
      this.emitLegend();
    };
    this.chart.subscribeCrosshairMove(this.crosshairHandler);
    const geo: Geo = {
      timeToX: (t) => this.timeToX(t),
      xToTime: (x) => this.xToTime(x),
      priceToY: (p) => this.main.priceToCoordinate(p),
      yToPrice: (y) => this.main.coordinateToPrice(y),
      hint: () => decimals(this.bars[this.bars.length - 1]?.c ?? 1, this.meta?.price_hint),
      barsBetween: (a, b) => Math.round(Math.abs(this.logicalOf(b) - this.logicalOf(a))),
    };
    this.drawings.setGeo(geo);
  }

  destroy(): void {
    this.onLegend = null;
    this.chart.unsubscribeCrosshairMove(this.crosshairHandler);
    // Detach layers first: the countdown's timer must stop before the chart goes.
    for (const p of [this.shade, this.drawings, this.countdown]) {
      try {
        this.main.detachPrimitive(p);
      } catch {
        /* already detached */
      }
    }
    for (const ind of this.indicators) {
      if (ind.fill === null) continue;
      try {
        this.main.detachPrimitive(ind.fill);
      } catch {
        /* already detached */
      }
    }
    this.markers?.detach();
    this.markers = null;
    this.chart.remove();
    this.disposed = true;
  }

  disposed = false;

  /* -------------------------------------------------------------- time */

  private shiftTime(t: number): number {
    return t + tzOffset(this.zone, t);
  }

  /** Axis labels in the chart's zone (times are already shifted): the library says what each tick marks. */
  private tickLabel(t: Time, kind: TickMarkType): string {
    const d = new Date((t as number) * 1000);
    switch (kind) {
      case TickMarkType.Year:
        return String(d.getUTCFullYear());
      case TickMarkType.Month:
        return d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
      case TickMarkType.DayOfMonth:
        return String(d.getUTCDate());
      default:
        return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
    }
  }

  private timeLabel(t: Time): string {
    const d = new Date((t as number) * 1000);
    const date = d.toLocaleString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' });
    if (!INTRADAY[this.interval]) return date;
    return date + '  ' + String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
  }

  /** Fractional logical index of a real unix time (extrapolated past both ends). */
  logicalOf(t: number): number {
    const b = this.bars;
    const n = b.length;
    if (n === 0) return 0;
    const iv = IV_SEC[this.interval];
    const first = b[0] as Bar;
    const last = b[n - 1] as Bar;
    if (t <= first.t) return (t - first.t) / iv;
    if (t >= last.t) return n - 1 + (t - last.t) / iv;
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if ((b[mid] as Bar).t <= t) lo = mid;
      else hi = mid;
    }
    const a = b[lo] as Bar;
    const c = b[hi] as Bar;
    // Inside a bar's own span the position follows the clock; across a
    // session break it snaps to the bar.
    const within = Math.min(1, (t - a.t) / iv);
    return lo + (c.t - a.t > iv * 1.5 ? Math.min(within, 0.999) : (t - a.t) / (c.t - a.t));
  }

  timeToX(t: number): number | null {
    if (this.bars.length === 0) return null;
    return this.chart.timeScale().logicalToCoordinate(this.logicalOf(t) as Logical);
  }

  xToTime(x: number): number | null {
    const lg = this.chart.timeScale().coordinateToLogical(x);
    if (lg === null || this.bars.length === 0) return null;
    const n = this.bars.length;
    const iv = IV_SEC[this.interval];
    const first = this.bars[0] as Bar;
    const last = this.bars[n - 1] as Bar;
    if (lg <= 0) return Math.round(first.t + lg * iv);
    if (lg >= n - 1) return Math.round(last.t + (lg - (n - 1)) * iv);
    const i = Math.floor(lg);
    const a = this.bars[i] as Bar;
    const b = this.bars[i + 1] as Bar;
    const f = lg - i;
    return Math.round(b.t - a.t > iv * 1.5 ? a.t + f * iv : a.t + f * (b.t - a.t));
  }

  /** Bar nearest an x (for the magnet and the context menu). */
  barAt(x: number): Bar | null {
    const lg = this.chart.timeScale().coordinateToLogical(x);
    if (lg === null) return null;
    const i = Math.max(0, Math.min(this.bars.length - 1, Math.round(lg)));
    return this.bars[i] ?? null;
  }

  /* ------------------------------------------------------------- series */

  private makeMain(type: ChartType): ISeriesApi<SeriesType> {
    const c = chartColors();
    const common = { priceLineVisible: true, lastValueVisible: true, priceLineStyle: LineStyle.Dotted, priceLineWidth: 1 as const };
    let s: ISeriesApi<SeriesType>;
    switch (type) {
      case 'bars':
        s = this.chart.addSeries(BarSeries, { ...common, upColor: c.up, downColor: c.down, thinBars: false });
        break;
      case 'line':
        s = this.chart.addSeries(LineSeries, { ...common, color: c.ink, lineWidth: 2 });
        break;
      case 'area':
        s = this.chart.addSeries(AreaSeries, { ...common, lineColor: c.accent, topColor: c.accentSoft, bottomColor: 'rgba(0,0,0,0)', lineWidth: 2 });
        break;
      case 'baseline':
        s = this.chart.addSeries(BaselineSeries, { ...common, topLineColor: c.up, bottomLineColor: c.down, topFillColor1: c.upWash, topFillColor2: 'rgba(0,0,0,0)', bottomFillColor1: 'rgba(0,0,0,0)', bottomFillColor2: c.downWash, lineWidth: 2 });
        break;
      case 'hollow':
        s = this.chart.addSeries(CandlestickSeries, { ...common, upColor: 'rgba(0,0,0,0)', downColor: c.down, borderUpColor: c.up, borderDownColor: c.down, wickUpColor: c.up, wickDownColor: c.down });
        break;
      default:
        s = this.chart.addSeries(CandlestickSeries, { ...common, upColor: c.up, downColor: c.down, borderUpColor: c.up, borderDownColor: c.down, wickUpColor: c.up, wickDownColor: c.down });
    }
    s.attachPrimitive(this.shade);
    s.attachPrimitive(this.drawings);
    s.attachPrimitive(this.countdown);
    this.type = type;
    return s;
  }

  setType(type: ChartType): void {
    if (type === this.type) return;
    const old = this.main;
    old.detachPrimitive(this.shade);
    old.detachPrimitive(this.drawings);
    old.detachPrimitive(this.countdown);
    this.markers?.detach();
    this.markers = null;
    this.priceLines = [];
    this.chart.removeSeries(old);
    this.main = this.makeMain(type);
    this.main.setSeriesOrder(0);
    this.applyScale();
    this.refreshMain();
    this.applyMarkers();
  }

  private mainData(): unknown[] {
    const src = this.type === 'heikin' ? heikin(this.bars) : this.bars;
    const single = this.type === 'line' || this.type === 'area' || this.type === 'baseline';
    return src.map((b, i) => (single ? { time: this.disp[i] as UTCTimestamp, value: b.c } : { time: this.disp[i] as UTCTimestamp, open: b.o, high: b.h, low: b.l, close: b.c }));
  }

  private refreshMain(): void {
    (this.main as ISeriesApi<'Candlestick'>).setData(this.mainData() as Parameters<ISeriesApi<'Candlestick'>['setData']>[0]);
    if (this.type === 'baseline' && this.bars.length > 0) {
      const base = this.bars[Math.max(0, this.bars.length - 200)]?.c ?? 0;
      (this.main as ISeriesApi<'Baseline'>).applyOptions({ baseValue: { type: 'price', price: base } });
    }
    this.updateCountdown();
  }

  /** Replace all bars (new symbol, interval, zone or extended hours). */
  setBars(bars: Bar[], meta: Meta, interval: Interval, zone: string, ext: boolean): void {
    this.bars = bars;
    this.meta = meta;
    this.interval = interval;
    this.zone = zone;
    this.ext = ext;
    this.disp = bars.map((b) => this.shiftTime(b.t));
    this.chart.applyOptions({ timeScale: { timeVisible: INTRADAY[interval], secondsVisible: false } });
    this.refreshMain();
    this.recomputeIndicators(true);
    this.refreshCompare();
    this.refreshShade();
    this.applyMarkers();
    this.emitLegend();
  }

  /** Older bars in front (scrolling back); keeps the view where it was. */
  prepend(older: Bar[]): number {
    const first = this.bars[0]?.t ?? Infinity;
    const add = older.filter((b) => b.t < first);
    if (add.length === 0) return 0;
    const range = this.chart.timeScale().getVisibleLogicalRange();
    this.bars = add.concat(this.bars);
    this.disp = add.map((b) => this.shiftTime(b.t)).concat(this.disp);
    this.refreshMain();
    this.recomputeIndicators(true);
    this.refreshCompare();
    this.refreshShade();
    this.applyMarkers();
    if (range !== null) this.chart.timeScale().setVisibleLogicalRange({ from: range.from + add.length, to: range.to + add.length });
    return add.length;
  }

  /** Newest bars from the live feed: update the last bar or append new ones. */
  applyTail(tail: Bar[]): boolean {
    if (this.bars.length === 0 || tail.length === 0) return false;
    let changed = false;
    let appended = false;
    for (const b of tail) {
      const n = this.bars.length;
      const last = this.bars[n - 1] as Bar;
      if (b.t < last.t) {
        // Correct an earlier bar in place (provider revisions).
        const i = this.indexOf(b.t);
        if (i >= 0) {
          const old = this.bars[i] as Bar;
          if (old.c !== b.c || old.h !== b.h || old.l !== b.l || old.v !== b.v) {
            this.bars[i] = b;
            changed = true;
          }
        }
        continue;
      }
      if (b.t === last.t) {
        if (last.c === b.c && last.h === b.h && last.l === b.l && last.v === b.v) continue;
        this.bars[n - 1] = b;
        changed = true;
        continue;
      }
      this.bars.push(b);
      this.disp.push(this.shiftTime(b.t));
      changed = true;
      appended = true;
    }
    if (!changed) return false;
    if (appended || this.type === 'heikin') this.refreshMain();
    else this.updateLast();
    this.recomputeIndicators(false);
    if (appended) this.refreshShade();
    this.updateCountdown();
    this.emitLegend();
    return true;
  }

  /** Move the last bar's close to a fresher quote price (stretching its range). */
  patchLast(price: number): void {
    const n = this.bars.length;
    const last = this.bars[n - 1];
    if (last === undefined || last.c === price) return;
    const iv = IV_SEC[this.interval];
    // Only while the last bar is the current one.
    if (INTRADAY[this.interval] && Date.now() / 1000 - last.t > iv * 2) return;
    this.bars[n - 1] = { ...last, c: price, h: Math.max(last.h, price), l: Math.min(last.l, price) };
    if (this.type === 'heikin') this.refreshMain();
    else this.updateLast();
    this.recomputeIndicators(false);
    this.updateCountdown();
    this.emitLegend();
  }

  private indexOf(t: number): number {
    let lo = 0;
    let hi = this.bars.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const v = (this.bars[mid] as Bar).t;
      if (v === t) return mid;
      if (v < t) lo = mid + 1;
      else hi = mid - 1;
    }
    return -1;
  }

  private updateLast(): void {
    const n = this.bars.length;
    const b = this.bars[n - 1];
    if (b === undefined) return;
    const time = this.disp[n - 1] as UTCTimestamp;
    const single = this.type === 'line' || this.type === 'area' || this.type === 'baseline';
    (this.main as ISeriesApi<'Candlestick'>).update((single ? { time, value: b.c } : { time, open: b.o, high: b.h, low: b.l, close: b.c }) as Parameters<ISeriesApi<'Candlestick'>['update']>[0]);
  }

  private updateCountdown(): void {
    const c = chartColors();
    const last = this.bars[this.bars.length - 1];
    if (last === undefined || !INTRADAY[this.interval]) {
      this.countdown.set(null, 0, c.onLabel, c.label);
      return;
    }
    const closeAt = last.t + IV_SEC[this.interval];
    const up = this.bars.length < 2 || last.c >= (this.bars[this.bars.length - 2] as Bar).c;
    this.countdown.set(last.c, closeAt, '#ffffff', up ? c.up : c.down);
  }

  private refreshShade(): void {
    const c = chartColors();
    const s = this.meta?.sessions ?? null;
    if (!this.ext || !INTRADAY[this.interval] || s === null || this.meta === null) {
      this.shade.set([], c.extWash);
      return;
    }
    const tz = this.meta.tz;
    this.shade.set(
      this.bars.map((b) => isExtended(s, tz, b.t)),
      c.extWash,
    );
  }

  /* --------------------------------------------------------------- scale */

  setScale(scale: Scale): void {
    this.scale = scale;
    this.applyScale();
  }

  private applyScale(): void {
    const mode = this.compare.size > 0 && this.scale === 'normal' ? PriceScaleMode.Percentage : SCALE_MODE[this.scale];
    this.main.priceScale().applyOptions({ mode });
  }

  autoScale(): void {
    this.main.priceScale().setAutoScale(true);
    this.chart.timeScale().resetTimeScale();
  }

  /* ---------------------------------------------------------- indicators */

  setIndicators(list: IndicatorConf[]): void {
    const sig = (l: IndicatorConf[]): string => JSON.stringify(l.map((x) => [x.id, x.params, x.hidden === true, x.color ?? '']));
    if (sig(list) === sig(this.confs) && this.indicators.length === list.length) return;
    this.confs = list.map((x) => ({ ...x, params: { ...x.params } }));
    for (const ind of this.indicators) {
      for (const s of ind.series.values()) this.chart.removeSeries(s);
      if (ind.fill !== null) this.main.detachPrimitive(ind.fill);
    }
    this.indicators = [];
    if (this.volume !== null) {
      this.chart.removeSeries(this.volume);
      this.volume = null;
    }
    const c = chartColors();
    let pane = 0;
    let colorIdx = 0;
    this.confs.forEach((conf, index) => {
      const def = ta.find(conf.id);
      if (def === null) return;
      const params = ta.params(conf.id, conf.params);
      const label = ta.label(conf.id, params);
      const view: IndicatorView = { key: conf.id + ':' + index, index, conf, def, label, pane: 0, colors: {}, computed: { id: conf.id, params, label, outputs: {}, offsets: {} } };
      if (conf.id === 'volume') {
        this.volume = this.chart.addSeries(HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false, visible: conf.hidden !== true });
        this.chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 }, visible: false });
        const ma = this.chart.addSeries(LineSeries, { priceScaleId: 'vol', color: c.lines[1] ?? c.ink2, lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false, visible: conf.hidden !== true });
        view.colors = { volume: c.muted, ma: c.lines[1] ?? c.ink2 };
        this.indicators.push({ view, series: new Map([['ma', ma as ISeriesApi<SeriesType>]]), fill: null, bands: [] });
        return;
      }
      if (!def.overlay) pane += 1;
      view.pane = def.overlay ? 0 : pane;
      const series = new Map<string, ISeriesApi<SeriesType>>();
      const visibleOuts = def.outputs.filter((o) => o.kind !== 'hidden');
      visibleOuts.forEach((o, k) => {
        const base = conf.color !== undefined && conf.color !== '' && k === 0 ? conf.color : (c.lines[(colorIdx + k) % c.lines.length] ?? c.ink);
        let color = base;
        if (conf.id === 'supertrend') color = o.key === 'up' ? c.up : c.down;
        if ((conf.id === 'bb' || conf.id === 'kc' || conf.id === 'donchian' || conf.id === 'envelope') && o.key !== 'basis') color = c.lines[colorIdx % c.lines.length] ?? c.ink;
        view.colors[o.key] = color;
        const opts = { color, lineWidth: 1 as const, lastValueVisible: o.key === visibleOuts[0]?.key && !def.overlay, priceLineVisible: false, crosshairMarkerVisible: false, visible: conf.hidden !== true };
        let s: ISeriesApi<SeriesType>;
        if (o.kind === 'histogram') s = this.chart.addSeries(HistogramSeries, { ...opts, base: conf.id === 'rvol' ? 0 : 0 }, view.pane);
        else if (o.kind === 'dots') s = this.chart.addSeries(LineSeries, { ...opts, lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 1.5 }, view.pane);
        else s = this.chart.addSeries(LineSeries, opts, view.pane);
        series.set(o.key, s);
      });
      colorIdx += def.overlay ? (['bb', 'kc', 'donchian', 'envelope'].includes(conf.id) ? 1 : visibleOuts.length) : visibleOuts.length;
      let fill: BandFill | null = null;
      if (def.fill !== undefined && conf.hidden !== true) {
        fill = new BandFill();
        this.main.attachPrimitive(fill);
      }
      const bands: IPriceLine[] = [];
      const first = series.values().next().value;
      if (def.bands !== undefined && first !== undefined) {
        for (const b of def.bands) bands.push(first.createPriceLine({ price: b, color: c.line, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '' }));
      }
      this.indicators.push({ view, series, fill, bands });
    });
    this.recomputeIndicators(true);
    this.layoutPanes();
    this.emitLegend();
  }

  private layoutPanes(): void {
    const panes = this.chart.panes();
    if (panes.length <= 1) return;
    const total = panes.reduce((n, p) => n + p.getHeight(), 0);
    const sub = Math.max(60, Math.min(140, Math.round((total * 0.42) / (panes.length - 1))));
    panes.forEach((p, i) => {
      if (i > 0) p.setHeight(sub);
    });
  }

  private recomputeIndicators(full: boolean): void {
    if (this.bars.length === 0) return;
    const c = chartColors();
    const tb = this.bars as TaBar[];
    const n = this.bars.length;
    for (const ind of this.indicators) {
      const comp = ta.compute(ind.view.conf.id, tb, ind.view.conf.params, { offset: this.meta?.gmtoffset ?? 0, periodsPerYear: this.periodsPerYear() });
      ind.view.computed = comp;
      ind.view.label = comp.label;
      if (ind.view.conf.id === 'volume') {
        if (this.volume !== null) {
          const vol = comp.outputs['volume'] ?? [];
          const data = this.bars.map((b, i) => ({ time: this.disp[i] as UTCTimestamp, value: vol[i] ?? 0, color: b.c >= b.o ? c.upSoft : c.downSoft }));
          if (full) this.volume.setData(data);
          else {
            const last = data[n - 1];
            if (last !== undefined) this.volume.update(last);
          }
        }
        const ma = ind.series.get('ma');
        if (ma !== undefined) this.setLine(ma, comp.outputs['ma'] ?? [], 0, full);
        continue;
      }
      for (const [key, s] of ind.series) {
        const vals = comp.outputs[key] ?? [];
        const shift = comp.offsets[key] ?? 0;
        if (s.seriesType() === 'Histogram') {
          const data = this.bars.map((_, i) => {
            const v = vals[i];
            const prev = vals[i - 1];
            const pos = v !== null && v !== undefined && v >= (ind.view.conf.id === 'rvol' ? 1 : 0);
            const rising = v !== null && v !== undefined && prev !== null && prev !== undefined && v >= prev;
            return v === null || v === undefined ? { time: this.disp[i] as UTCTimestamp } : { time: this.disp[i] as UTCTimestamp, value: v, color: pos ? (rising ? c.up : c.upSoft) : rising ? c.downSoft : c.down };
          });
          if (full) (s as ISeriesApi<'Histogram'>).setData(data);
          else {
            const last = data[n - 1];
            if (last !== undefined) (s as ISeriesApi<'Histogram'>).update(last);
          }
        } else this.setLine(s, vals, shift, full);
      }
      if (ind.fill !== null) {
        const def = ind.view.def;
        const [a, b] = def.fill ?? ['upper', 'lower'];
        const cloud = ind.view.conf.id === 'ichimoku';
        ind.fill.set(comp.outputs[a] ?? [], comp.outputs[b] ?? [], cloud ? c.upWash : (c.linesSoft[this.indicators.indexOf(ind) % c.linesSoft.length] ?? c.accentSoft), comp.offsets[a] ?? 0, cloud ? c.downWash : '');
      }
    }
  }

  private periodsPerYear(): number {
    const crypto = this.meta?.provider === 'binance' || this.meta?.type === 'CRYPTOCURRENCY';
    const days = crypto ? 365 : 252;
    const iv = IV_SEC[this.interval];
    if (iv >= 86400) return (days * 86400) / iv;
    return days * ((crypto ? 86400 : 6.5 * 3600) / iv);
  }

  /** A line series from values aligned with the bars, shifted by `shift` bars. */
  private setLine(s: ISeriesApi<SeriesType>, vals: (number | null)[], shift: number, full: boolean): void {
    const n = this.bars.length;
    const iv = IV_SEC[this.interval];
    const timeAt = (i: number): number => {
      if (i < n) return this.disp[i] as number;
      const last = this.bars[n - 1] as Bar;
      return this.shiftTime(last.t + (i - n + 1) * iv);
    };
    if (!full && shift === 0) {
      const v = vals[n - 1];
      const t = this.disp[n - 1];
      if (t !== undefined) (s as ISeriesApi<'Line'>).update(v === null || v === undefined ? { time: t as UTCTimestamp } : { time: t as UTCTimestamp, value: v });
      return;
    }
    const data: { time: UTCTimestamp; value?: number }[] = [];
    for (let i = 0; i < vals.length; i++) {
      const j = i + shift;
      if (j < 0) continue;
      const v = vals[i];
      data.push(v === null || v === undefined ? { time: timeAt(j) as UTCTimestamp } : { time: timeAt(j) as UTCTimestamp, value: v });
    }
    (s as ISeriesApi<'Line'>).setData(data as Parameters<ISeriesApi<'Line'>['setData']>[0]);
  }

  /* ------------------------------------------------------------- compare */

  setCompare(symbol: string, bars: Bar[] | null): void {
    const c = chartColors();
    const existing = this.compare.get(symbol);
    if (bars === null) {
      if (existing !== undefined) {
        this.chart.removeSeries(existing.series);
        this.compare.delete(symbol);
        this.applyScale();
      }
      return;
    }
    if (existing !== undefined) {
      existing.bars = bars;
    } else {
      const color = c.lines[(4 + this.compare.size) % c.lines.length] ?? c.ink2;
      const series = this.chart.addSeries(LineSeries, { color, lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: symbol.replace('BINANCE:', '') });
      this.compare.set(symbol, { series, bars, color });
      this.applyScale();
    }
    this.refreshCompare();
  }

  compareSymbols(): string[] {
    return [...this.compare.keys()];
  }

  private refreshCompare(): void {
    if (this.bars.length === 0) return;
    const first = (this.bars[0] as Bar).t;
    for (const x of this.compare.values()) {
      // Align to the main bars' times so both lines share the axis.
      const data: { time: UTCTimestamp; value: number }[] = [];
      let j = 0;
      for (let i = 0; i < this.bars.length; i++) {
        const t = (this.bars[i] as Bar).t;
        while (j < x.bars.length - 1 && (x.bars[j + 1] as Bar).t <= t) j++;
        const b = x.bars[j];
        if (b === undefined || b.t > t || t < first) continue;
        data.push({ time: this.disp[i] as UTCTimestamp, value: b.c });
      }
      x.series.setData(data);
    }
  }

  /* ---------------------------------------------------------- price lines */

  setPriceLines(lines: { price: number; title: string; color: string; dashed?: boolean; axis?: boolean }[]): void {
    for (const pl of this.priceLines) this.main.removePriceLine(pl);
    this.priceLines = lines.map((l) =>
      this.main.createPriceLine({ price: l.price, color: l.color, lineWidth: 1, lineStyle: l.dashed === false ? LineStyle.Solid : LineStyle.Dashed, axisLabelVisible: l.axis !== false, title: l.title, axisLabelColor: l.color, axisLabelTextColor: '#ffffff' }),
    );
  }

  /* ------------------------------------------------------------- markers */

  setEvents(ev: Events | null): void {
    this.events = ev;
    this.applyMarkers();
  }

  private applyMarkers(): void {
    const c = chartColors();
    if (this.markers === null) this.markers = createSeriesMarkers(this.main, []);
    const ev = this.events;
    if (ev === null || INTRADAY[this.interval] || this.bars.length === 0) {
      this.markers.setMarkers([]);
      return;
    }
    const first = (this.bars[0] as Bar).t;
    const out: { time: UTCTimestamp; position: 'belowBar'; shape: 'circle'; color: string; text: string; size: number }[] = [];
    const place = (t: number, text: string): void => {
      if (t < first) return;
      let i = this.indexOf(t);
      if (i < 0) {
        const lg = Math.round(this.logicalOf(t));
        i = Math.max(0, Math.min(this.bars.length - 1, lg));
      }
      out.push({ time: this.disp[i] as UTCTimestamp, position: 'belowBar', shape: 'circle', color: c.muted, text, size: 0.6 });
    };
    for (const d of ev.dividends) place(d.t, 'D');
    for (const s of ev.splits) place(s.t, 'S ' + s.ratio);
    out.sort((a, b) => a.time - b.time);
    this.markers.setMarkers(out);
  }

  /* -------------------------------------------------------------- legend */

  private emitLegend(): void {
    if (this.onLegend === null) return;
    const n = this.bars.length;
    const i = this.hoverIndex ?? n - 1;
    const bar = this.bars[i] ?? null;
    const prev = this.bars[i - 1] ?? null;
    const hint = this.meta?.price_hint;
    const indicators = this.indicators.map((ind) => {
      const vals: { label: string; value: string; color: string }[] = [];
      for (const o of ind.view.def.outputs) {
        if (o.kind === 'hidden') continue;
        const arr = ind.view.computed.outputs[o.key] ?? [];
        const v = arr[i - (ind.view.computed.offsets[o.key] ?? 0)];
        const big = ind.view.conf.id === 'volume' || ind.view.conf.id === 'obv';
        vals.push({ label: o.label, value: v === null || v === undefined ? '-' : big ? compact(v) : ind.view.def.overlay ? fmtPrice(v, hint) : Math.abs(v) >= 1000 ? compact(v) : v.toFixed(2), color: ind.view.colors[o.key] ?? chartColors().ink2 });
      }
      return { key: ind.view.key, index: ind.view.index, label: ind.view.label, hidden: ind.view.conf.hidden === true, pane: ind.view.pane, values: vals };
    });
    const compare = [...this.compare.entries()].map(([sym, x]) => {
      const t = bar?.t ?? 0;
      let v: number | null = null;
      for (let j = x.bars.length - 1; j >= 0; j--) {
        const b = x.bars[j] as Bar;
        if (b.t <= t) {
          v = b.c;
          break;
        }
      }
      return { symbol: sym, value: v === null ? '-' : fmtPrice(v), color: x.color };
    });
    this.onLegend({ bar, prev, indicators, compare });
  }

  /* ---------------------------------------------------------- appearance */

  applyTheme(): void {
    const c = chartColors();
    this.chart.applyOptions({
      layout: { background: { color: c.card }, textColor: c.ink2, panes: { separatorColor: c.line, separatorHoverColor: c.accentSoft } },
      grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
      crosshair: { vertLine: { color: c.crosshair, labelBackgroundColor: c.label }, horzLine: { color: c.crosshair, labelBackgroundColor: c.label } },
      rightPriceScale: { borderColor: c.line },
      timeScale: { borderColor: c.line },
    });
    const t = this.type;
    this.type = 'line' === t ? 'candles' : 'line';
    this.setType(t);
    const confs = this.confs;
    this.confs = [];
    this.setIndicators(confs);
    for (const [sym, x] of [...this.compare.entries()]) {
      this.chart.removeSeries(x.series);
      this.compare.delete(sym);
      this.setCompare(sym, x.bars);
    }
    this.refreshShade();
    this.drawings.update();
  }

  /** Visible range by preset: the last `seconds` of bars. */
  showLast(seconds: number | 'all' | 'ytd'): void {
    const n = this.bars.length;
    if (n === 0) return;
    const last = this.bars[n - 1] as Bar;
    let from = 0;
    if (seconds === 'ytd') {
      const y = new Date(last.t * 1000).getUTCFullYear();
      const start = Date.UTC(y, 0, 1) / 1000;
      from = Math.max(0, Math.floor(this.logicalOf(start)));
    } else if (seconds !== 'all') from = Math.max(0, Math.floor(this.logicalOf(last.t - seconds)));
    this.chart.timeScale().setVisibleLogicalRange({ from: from - 0.5, to: n - 1 + 6 });
  }

  screenshot(): HTMLCanvasElement {
    return this.chart.takeScreenshot(true, false);
  }
}
