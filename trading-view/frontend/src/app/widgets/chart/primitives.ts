/**
 * Canvas layers the chart library does not draw itself: fills between two
 * lines (Bollinger, Keltner, Ichimoku cloud), extended-hours shading, and a
 * countdown to the bar's close under the last-price label.
 */
import type { IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive, ISeriesPrimitiveAxisView, Logical, PrimitivePaneViewZOrder, SeriesAttachedParameter, Time } from 'lightweight-charts';

type Target = Parameters<IPrimitivePaneRenderer['draw']>[0];

class View implements IPrimitivePaneView {
  constructor(
    private readonly drawFn: (target: Target) => void,
    private readonly z: PrimitivePaneViewZOrder,
  ) {}
  zOrder(): PrimitivePaneViewZOrder {
    return this.z;
  }
  renderer(): IPrimitivePaneRenderer {
    return { draw: (t) => this.drawFn(t), drawBackground: () => undefined };
  }
}

/** Base: keeps the chart and series handed over on attach. */
abstract class Layer implements ISeriesPrimitive<Time> {
  protected p: SeriesAttachedParameter<Time> | null = null;
  attached(param: SeriesAttachedParameter<Time>): void {
    this.p = param;
  }
  detached(): void {
    this.p = null;
  }
  update(): void {
    try {
      this.p?.requestUpdate();
    } catch {
      /* the chart is gone */
    }
  }
}

/* ------------------------------------------------------------- band fill */

/** Fill between two value arrays aligned with the main bars (index = logical). */
export class BandFill extends Layer {
  private upper: (number | null)[] = [];
  private lower: (number | null)[] = [];
  private shift = 0;
  private colorUp = 'rgba(0,0,0,0.06)';
  private colorDown = '';
  private readonly views: IPrimitivePaneView[];

  constructor() {
    super();
    this.views = [new View((t) => this.draw(t), 'bottom')];
  }

  set(upper: (number | null)[], lower: (number | null)[], color: string, shift = 0, colorDown = ''): void {
    this.upper = upper;
    this.lower = lower;
    this.colorUp = color;
    this.colorDown = colorDown;
    this.shift = shift;
    this.update();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  private draw(target: Target): void {
    const p = this.p;
    if (p === null) return;
    const ts = p.chart.timeScale();
    const range = ts.getVisibleLogicalRange();
    if (range === null) return;
    const from = Math.max(0, Math.floor(range.from) - 2 - this.shift);
    const to = Math.min(this.upper.length - 1, Math.ceil(range.to) + 2 - this.shift);
    target.useMediaCoordinateSpace(({ context: ctx }) => {
      // Contiguous runs where both values exist, split where the cloud flips color.
      let run: { x: number; u: number; l: number }[] = [];
      let runUp = true;
      const flush = (): void => {
        if (run.length < 2) {
          run = [];
          return;
        }
        ctx.beginPath();
        run.forEach((pt, i) => (i === 0 ? ctx.moveTo(pt.x, pt.u) : ctx.lineTo(pt.x, pt.u)));
        for (let i = run.length - 1; i >= 0; i--) {
          const pt = run[i];
          if (pt !== undefined) ctx.lineTo(pt.x, pt.l);
        }
        ctx.closePath();
        ctx.fillStyle = runUp || this.colorDown === '' ? this.colorUp : this.colorDown;
        ctx.fill();
        run = [];
      };
      for (let i = from; i <= to; i++) {
        const uv = this.upper[i];
        const lv = this.lower[i];
        if (uv === null || uv === undefined || lv === null || lv === undefined) {
          flush();
          continue;
        }
        const x = ts.logicalToCoordinate((i + this.shift) as Logical);
        const uy = p.series.priceToCoordinate(uv);
        const ly = p.series.priceToCoordinate(lv);
        if (x === null || uy === null || ly === null) {
          flush();
          continue;
        }
        const up = uv >= lv;
        if (this.colorDown !== '' && run.length > 0 && up !== runUp) {
          const last = run[run.length - 1];
          flush();
          if (last !== undefined) run.push(last);
        }
        runUp = up;
        run.push({ x, u: uy, l: ly });
      }
      flush();
    });
  }
}

/* ---------------------------------------------------- extended-hours wash */

export class SessionShade extends Layer {
  private flags: boolean[] = [];
  private color = 'rgba(0,0,0,0.04)';
  private readonly views: IPrimitivePaneView[];

  constructor() {
    super();
    this.views = [new View((t) => this.draw(t), 'bottom')];
  }

  set(flags: boolean[], color: string): void {
    this.flags = flags;
    this.color = color;
    this.update();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  private draw(target: Target): void {
    const p = this.p;
    if (p === null || this.flags.length === 0) return;
    const ts = p.chart.timeScale();
    const range = ts.getVisibleLogicalRange();
    if (range === null) return;
    const from = Math.max(0, Math.floor(range.from) - 1);
    const to = Math.min(this.flags.length - 1, Math.ceil(range.to) + 1);
    const a = ts.logicalToCoordinate(0 as Logical);
    const b = ts.logicalToCoordinate(1 as Logical);
    const half = a !== null && b !== null ? Math.abs(b - a) / 2 : 3;
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      ctx.fillStyle = this.color;
      let start: number | null = null;
      for (let i = from; i <= to + 1; i++) {
        const on = i <= to && this.flags[i] === true;
        if (on && start === null) start = i;
        if (!on && start !== null) {
          const x1 = ts.logicalToCoordinate(start as Logical);
          const x2 = ts.logicalToCoordinate((i - 1) as Logical);
          if (x1 !== null && x2 !== null) ctx.fillRect(x1 - half, 0, x2 - x1 + half * 2, mediaSize.height);
          start = null;
        }
      }
    });
  }
}

/* -------------------------------------------------------------- countdown */

class CountdownView implements ISeriesPrimitiveAxisView {
  y = 0;
  label = '';
  fg = '#fff';
  bg = '#000';
  show = false;
  coordinate(): number {
    return this.y;
  }
  text(): string {
    return this.label;
  }
  textColor(): string {
    return this.fg;
  }
  backColor(): string {
    return this.bg;
  }
  visible(): boolean {
    return this.show;
  }
  tickVisible(): boolean {
    return false;
  }
}

/** Time left in the current bar, drawn just under the last-price label. */
export class Countdown extends Layer {
  private readonly view = new CountdownView();
  private price: number | null = null;
  private closeAt = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  set(price: number | null, closeAt: number, fg: string, bg: string): void {
    this.price = price;
    this.closeAt = closeAt;
    this.view.fg = fg;
    this.view.bg = bg;
    this.update();
  }

  override attached(param: SeriesAttachedParameter<Time>): void {
    super.attached(param);
    this.timer = setInterval(() => this.update(), 1000);
  }

  override detached(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    super.detached();
  }

  updateAllViews(): void {
    const p = this.p;
    const v = this.view;
    v.show = false;
    if (p === null || this.price === null || this.closeAt === 0) return;
    const left = this.closeAt - Math.floor(Date.now() / 1000);
    if (left <= 0 || left > 86400 * 2) return;
    const y = p.series.priceToCoordinate(this.price);
    if (y === null) return;
    const h = Math.floor(left / 3600);
    const m = Math.floor((left % 3600) / 60);
    const s = left % 60;
    v.label = (h > 0 ? h + ':' + String(m).padStart(2, '0') : String(m).padStart(2, '0')) + ':' + String(s).padStart(2, '0');
    v.y = y + 17;
    v.show = true;
  }

  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    return [this.view];
  }
}
