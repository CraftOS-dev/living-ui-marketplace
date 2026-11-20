/**
 * Home's hero (Fix 4): the firm's key numbers as a clean column on the left
 * and the firm constellation beside it, directly on the page.
 *
 * The column (from home.summary's readouts, every figure computed by the
 * funds engines, nothing here): Firm NAV (the scoped fund's NAV when the
 * sidebar scopes a fund), TVPI, DPI, Net IRR, Called (share of
 * commitments), Dry powder, Portfolio companies and Open deals; each label
 * above its mono figure, a hairline between them. NAV, companies and deals
 * open their pages.
 *
 * The drawing (Constellation.tsx): the sphere is the firm, the thick circle
 * committed capital (solid called, dashed dry powder), each orbit a fund
 * (its name beside it) and each node on it a company (its name beside it;
 * solid healthy, a pulsing red ring needs attention, sized by value); the
 * axes are TVPI (up) and DPI (right). It moves slowly; hover or focus on a
 * company stops it and shows the detail, a click opens the company or the
 * fund. On a phone the drawing comes first and the figures sit below it in
 * two columns.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { money, months, multiple, pct, plural } from '../../lib/format.ts';
import { navigate } from '../../lib/router.ts';
import { Button, Skeleton, Tip } from '../ui.tsx';
import { Constellation, VIEW_H, VIEW_W } from './Constellation.tsx';
import type { Hover } from './Constellation.tsx';
import type { Visual } from './types.ts';

function useMedia(q: string): boolean {
  const [on, setOn] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(q).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const m = window.matchMedia(q);
    const f = (): void => setOn(m.matches);
    f();
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, [q]);
  return on;
}

/**
 * True only when the person's system asks for reduced motion (the media query matches "reduce"); a browser or a
 * frame that does not support the query, or reports "no-preference", gets the motion.
 */
export function useReducedMotion(): boolean {
  return useMedia('(prefers-reduced-motion: reduce)');
}

/** The drawing's box in the stage: scale and offsets of the view box (xMidYMid meet). */
function useFit(stage: React.RefObject<HTMLDivElement | null>): { w: number; s: number; ox: number; oy: number } {
  const [fit, setFit] = useState({ w: 0, s: 1, ox: 0, oy: 0 });
  useLayoutEffect(() => {
    const el = stage.current;
    if (el === null) return;
    const measure = (): void => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const s = Math.min(w / VIEW_W, h / VIEW_H);
      setFit({ w, s, ox: (w - VIEW_W * s) / 2, oy: (h - VIEW_H * s) / 2 });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [stage]);
  return fit;
}

function Row({ k, v, mono = true }: { k: string; v: ReactNode; mono?: boolean | undefined }): React.JSX.Element {
  return (
    <>
      <dt className="opacity-75">{k}</dt>
      <dd className={cn('text-right', mono && 'vo-mono vo-num')}>{v}</dd>
    </>
  );
}

interface Figure {
  key: string;
  label: string;
  tip: string;
  value: ReactNode;
  /** Opens a page. */
  to?: string | undefined;
  big?: boolean | undefined;
}

/** One figure of the column: its label above, the mono value under it; a link when it opens a page. */
function FigureCell({ f }: { f: Figure }): React.JSX.Element {
  const value = <span className={cn('vo-mono vo-num block min-w-0 truncate font-light tracking-tight text-[var(--vo-ink)]', f.big === true ? 'text-[26px] leading-8' : 'text-[15px] leading-5')}>{f.value}</span>;
  return (
    <div className={cn('min-w-0', f.big === true && 'col-span-2 lg:col-span-1')} data-vo-figure={f.key}>
      <div className="mb-0.5 truncate text-[12px] leading-4 text-[var(--vo-muted)]">
        <Tip text={f.tip}>{f.label}</Tip>
      </div>
      {f.to !== undefined ? (
        <a href={'#' + f.to} className="vo-focus -mx-1 block w-fit max-w-full rounded-[var(--vo-radius-sm)] px-1 transition-colors duration-150 hover:bg-[var(--vo-hover)]">
          {value}
        </a>
      ) : (
        value
      )}
    </div>
  );
}

/** The hero: the key numbers and the constellation. `v` null while Home loads. */
export function Hero({ v, today, className }: { v: Visual | null; today: string; className?: string | undefined }): React.JSX.Element {
  const stage = useRef<HTMLDivElement | null>(null);
  const fit = useFit(stage);
  const reduced = useReducedMotion();
  const [hover, setHover] = useState<Hover | null>(null);
  const c = v?.constellation ?? null;
  const r = v?.readouts ?? null;
  const cur = v?.currency ?? 'USD';
  const seeFunds = v !== null && !v.hidden.includes('funds');
  const seePort = v !== null && !v.hidden.includes('portfolio');
  const seePipe = v !== null && !v.hidden.includes('pipeline');
  const tvpi = r !== null && r.tvpi_e8 !== null ? r.tvpi_e8 / 1e8 : null;
  const dpi = r !== null && r.dpi_e8 !== null ? r.dpi_e8 / 1e8 : null;
  const called = r !== null && r.called_ppm !== null ? r.called_ppm / 1e6 : null;
  const threshold = c?.threshold_months ?? 6;
  const scope = r?.tvpi_fund ?? null;

  // The detail for what the pointer or focus rests on.
  let tip: ReactNode = null;
  if (hover !== null && v !== null) {
    if (hover.kind === 'node' && c !== null) {
      const n = c.nodes.find((x) => x.holding === hover.key);
      const ring = n !== undefined ? c.rings.find((x) => x.id === n.fund) : undefined;
      if (n !== undefined)
        tip = (
          <>
            <div className="truncate text-[13px] font-medium">{n.company.name}</div>
            {ring !== undefined && ring.label !== '' && <div className="truncate opacity-75">{ring.label}</div>}
            <dl className="mt-1.5 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5">
              <Row k={n.value_basis === 'cost' ? 'Value (at cost)' : 'Value'} v={money(n.value_minor, cur, { compact: true })} />
              {n.moic_e8 !== null && <Row k="Multiple" v={multiple(n.moic_e8)} />}
              {n.runway_months !== null && <Row k="Runway" v={months(n.runway_months)} />}
            </dl>
            {n.attention && <div className="mt-1.5 font-medium">{n.reasons.includes('runway') ? `Runway under ${threshold} months` : 'Valued below cost'}</div>}
          </>
        );
    } else if (hover.kind === 'orbit' && c !== null) {
      const ring = c.rings.find((x) => x.id === hover.key);
      const n = c.nodes.filter((x) => x.fund === hover.key).length;
      if (ring !== undefined)
        tip = (
          <>
            <div className="truncate text-[13px] font-medium">{ring.label !== '' ? ring.label : 'Fund'}</div>
            <dl className="mt-1.5 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5">
              {ring.size_minor !== null && <Row k="Fund size" v={money(ring.size_minor, cur, { compact: true })} />}
              <Row k="Portfolio" v={plural(n, 'company', 'companies')} mono={false} />
              {seeFunds && ring.nav_minor != null && <Row k="NAV" v={money(ring.nav_minor, cur, { compact: true })} />}
              {seeFunds && ring.tvpi_e8 != null && <Row k="TVPI" v={multiple(ring.tvpi_e8)} />}
              {seeFunds && ring.dpi_e8 != null && <Row k="DPI" v={multiple(ring.dpi_e8)} />}
              {seeFunds && ring.net_irr_ppm != null && <Row k="Net IRR" v={pct(ring.net_irr_ppm)} />}
              {seeFunds && ring.called_minor != null && <Row k="Called" v={money(ring.called_minor, cur, { compact: true })} />}
              {seeFunds && ring.unfunded_minor != null && <Row k="Dry powder" v={money(ring.unfunded_minor, cur, { compact: true })} />}
            </dl>
          </>
        );
    } else if (hover.kind === 'firm' && c !== null && seeFunds) {
      const funds = c.rings.filter((x) => x.label !== '');
      if (funds.length > 0)
        tip = (
          <>
            <div className="text-[13px] font-medium">Your funds</div>
            <table className="mt-1.5 whitespace-nowrap text-[12px]">
              <thead>
                <tr className="opacity-75">
                  <th className="pr-3 text-left font-normal" />
                  {funds.map((f) => (
                    <th key={f.id} className="pl-3 text-right font-normal">{f.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="vo-mono">
                {([
                  ['NAV', (f: (typeof funds)[number]) => (f.nav_minor != null ? money(f.nav_minor, cur, { compact: true }) : '-')],
                  ['TVPI', (f: (typeof funds)[number]) => (f.tvpi_e8 != null ? multiple(f.tvpi_e8) : '-')],
                  ['DPI', (f: (typeof funds)[number]) => (f.dpi_e8 != null ? multiple(f.dpi_e8) : '-')],
                  ['Net IRR', (f: (typeof funds)[number]) => (f.net_irr_ppm != null ? pct(f.net_irr_ppm) : '-')],
                  ['Called', (f: (typeof funds)[number]) => (f.called_minor != null ? money(f.called_minor, cur, { compact: true }) : '-')],
                  ['Dry powder', (f: (typeof funds)[number]) => (f.unfunded_minor != null ? money(f.unfunded_minor, cur, { compact: true }) : '-')],
                ] as const).map(([k, val]) => (
                  <tr key={k}>
                    <td className="pr-3 opacity-75" style={{ fontFamily: 'var(--vo-font)' }}>{k}</td>
                    {funds.map((f) => (
                      <td key={f.id} className="pl-3 text-right">{val(f)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        );
    } else if (hover.kind === 'capital' && r !== null && r.committed_minor !== null && r.called_minor !== null) {
      tip = (
        <>
          <div className="text-[13px] font-medium">{scope !== null ? scope.label : 'Committed capital'}</div>
          <dl className="mt-1.5 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5">
            <Row k="Committed" v={money(r.committed_minor, cur, { compact: true })} />
            <Row k="Called" v={money(r.called_minor, cur, { compact: true })} />
            {r.dry_powder_minor !== null && <Row k="Dry powder" v={money(r.dry_powder_minor, cur, { compact: true })} />}
          </dl>
        </>
      );
    }
  }
  const tx = hover !== null ? fit.ox + hover.x * fit.s : 0;
  const ty = hover !== null ? fit.oy + hover.y * fit.s : 0;
  const wide = hover !== null && hover.kind === 'firm';
  // Place the card where it fits: measured after render, above the point when there is room,
  // else below, and always kept inside the drawing on every side.
  const tipRef = useRef<HTMLDivElement | null>(null);
  const [tipPos, setTipPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = tipRef.current;
    const st = stage.current;
    if (el === null || st === null || hover === null) {
      setTipPos(null);
      return;
    }
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const sw = st.clientWidth;
    const sh = st.clientHeight;
    const gap = 14;
    let top = wide ? ty + gap : ty - gap - h;
    if (top < 0) top = ty + gap;
    if (top + h > sh) top = ty - gap - h >= 0 ? ty - gap - h : Math.max(0, sh - h);
    const left = Math.max(0, Math.min(Math.max(0, sw - w), tx - w / 2));
    setTipPos((p) => (p !== null && p.left === left && p.top === top ? p : { left, top }));
  }, [hover, tx, ty, wide, fit.w, fit.s]);

  const summary =
    c === null
      ? 'Your firm'
      : `Your firm: ${c.rings.map((ring) => `${ring.label || 'Fund'} with ${plural(c.nodes.filter((n) => n.fund === ring.id).length, 'company', 'companies')}`).join(', ')}; ${plural(c.nodes.filter((n) => n.attention).length, 'company needs', 'companies need')} attention${tvpi !== null ? `; TVPI ${multiple(tvpi * 1e8)}` : ''}${dpi !== null ? `, DPI ${multiple(dpi * 1e8)}` : ''}${called !== null ? `; ${Math.round(called * 100)}% of committed capital called` : ''}`;

  // The key numbers: only what the person may see and what is known.
  const figures: Figure[] = [];
  if (r !== null && seeFunds) {
    const nav = scope !== null ? r.fund_nav_minor : r.nav_minor;
    if (nav !== null) figures.push({ key: 'nav', label: scope !== null ? `${scope.label} NAV` : 'Firm NAV', tip: scope !== null ? `Net asset value of ${scope.label} today.` : 'Net asset value of every fund you can see, today.', value: money(nav, cur, { compact: true }), to: scope !== null ? '/funds/' + scope.id : '/funds', big: true });
    if (r.tvpi_e8 !== null) figures.push({ key: 'tvpi', label: 'TVPI', tip: 'Total value to paid-in: distributions plus NAV, over the capital LPs paid in.', value: multiple(r.tvpi_e8) });
    if (r.net_irr_ppm !== null) figures.push({ key: 'irr', label: 'Net IRR', tip: "The annual return to LPs after fees and carry, with today's NAV as the last inflow.", value: pct(r.net_irr_ppm) });
    if (r.dry_powder_minor !== null) figures.push({ key: 'dry', label: 'Dry powder', tip: 'Commitments not called yet: what the funds can still call to invest and pay fees.', value: money(r.dry_powder_minor, cur, { compact: true }) });
  }
  if (r !== null && seePort && r.companies !== null) figures.push({ key: 'companies', label: 'Portfolio companies', tip: 'Companies the funds hold today.', value: plural(r.companies, 'company', 'companies'), to: '/portfolio' });
  if (r !== null && seePipe && r.open_deals !== null) figures.push({ key: 'deals', label: 'Open deals', tip: 'Deals open in Deal flow.', value: plural(r.open_deals, 'deal'), to: '/deals' });

  let column: ReactNode;
  if (v === null)
    column = (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-8 w-32" />
      </div>
    );
  else if (seeFunds && r !== null && r.funds === 0)
    column = (
      <div className="flex flex-col items-start gap-2">
        <span className="text-[13px] text-[var(--vo-ink-2)]">Add a fund to see your firm here</span>
        <Button size="sm" icon={Plus} onClick={() => navigate('/settings/funds')}>
          Add fund
        </Button>
      </div>
    );
  else if (figures.length === 0) column = null;
  else
    column = (
      <div aria-label="Key numbers" role="group" className="vo-sections grid min-w-0 grid-cols-2 gap-x-6 lg:flex lg:flex-col lg:gap-0" data-pad="tight" data-vo-figures="">
        {figures.map((f) => (
          <FigureCell key={f.key} f={f} />
        ))}
      </div>
    );

  return (
    <section aria-label="Your firm" className={cn('vo-in relative grid min-w-0 grid-cols-1 items-center gap-x-6 gap-y-4 lg:grid-cols-[minmax(176px,212px)_minmax(0,1fr)]', className)}>
      <div className="order-2 min-w-0 lg:order-1 lg:self-center lg:pl-1">{column}</div>
      <div ref={stage} className="relative order-1 h-[280px] min-w-0 sm:h-[360px] lg:order-2 lg:h-[420px]" data-constellation="">
        <Constellation data={c} currency={cur} today={today} tvpi={seeFunds ? tvpi : null} dpi={seeFunds ? dpi : null} called={seeFunds ? called : null} reduced={reduced} scale={fit.s} hover={hover} onHover={setHover} label={summary} />
        {tip !== null && hover !== null && (
          <div ref={tipRef} role="tooltip" className={`pointer-events-none absolute z-10 ${wide ? 'w-max max-w-[360px]' : 'w-[208px]'} rounded-[4px] bg-[var(--vo-ink)] px-3 py-2 text-[12px] leading-[17px] text-[var(--vo-on-ink)] shadow-[var(--vo-shadow-lg)]`} style={{ left: tipPos?.left ?? 0, top: tipPos?.top ?? 0, visibility: tipPos === null ? 'hidden' : 'visible' }}>
            {tip}
          </div>
        )}
      </div>
    </section>
  );
}
