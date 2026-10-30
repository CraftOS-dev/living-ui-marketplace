/**
 * The image stage: the picture on a quiet field (a checkerboard behind
 * transparency), zoom around the pointer with the wheel or pinch, pan by
 * dragging (or Space / middle button while a tool draws), Fit and 100 %.
 *
 * Previews are 1600 px; zoomed past that, a full-resolution tile of the
 * visible part is rendered after a pause and laid over the preview, so
 * 100 % shows the real pixels. Tools draw in image pixels through the
 * overlay slot (crop box, marks, redaction boxes, a region for the agent).
 *
 * Floating over the stage, as in desktop editors: the open tool's dialog at
 * the top left, a badge at the top centre, the pointer's pixel at the bottom
 * left and the view bar at the bottom centre.
 */
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode, Ref } from 'react';
import { ChevronDown, Maximize2, Minimize2, Minus, Plus, Scan, SquareDashed } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { api, fileUrl } from '../../lib/api.ts';
import type { EditKind, Params, Region } from '../../lib/types.ts';
import { Popover, Spinner, menuItem } from '../ui.tsx';

export interface View {
  /** Screen pixels per image pixel. */
  s: number;
  x: number;
  y: number;
}

/** Where a full-resolution tile comes from (the same render, at a region). */
export interface DetailSource {
  image: string;
  upto?: string | undefined;
  original?: boolean | undefined;
  proposal?: string | undefined;
  draft?: { kind: EditKind; params: Params } | undefined;
  /** false: the photo without its layers (the layers are drawn over it). */
  layers?: boolean | undefined;
}

export interface Picture {
  url: string;
  /** Full-resolution size the preview stands for. */
  w: number;
  h: number;
  detail?: DetailSource | null;
}

export interface OverlayApi {
  view: View;
  /** Image pixels under a client point. */
  toImage: (clientX: number, clientY: number) => [number, number];
  viewport: { w: number; h: number };
}

export interface StageHandle {
  fit: () => void;
  actual: () => void;
  zoomBy: (f: number) => void;
  /** Screen pixels per image pixel (2 = 200 %). */
  zoomTo: (s: number) => void;
}

export type Backdrop = 'checker' | 'light' | 'dark';

const MAX_SCALE = 32;
const PAD = 24;
const BAR_H = 44;

export const BAR = 'flex items-center gap-0.5 rounded-[var(--iu-r-md)] border border-[var(--iu-line)] bg-[var(--iu-card)] p-0.5 shadow-[var(--iu-shadow)]';

export function BarButton({ on = false, label, onClick, children, disabled = false }: { on?: boolean; label: string; onClick: () => void; children: ReactNode; disabled?: boolean }): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-6 min-w-6 items-center justify-center gap-1 rounded-[var(--iu-r-sm)] px-1 text-[12px] font-semibold transition-colors disabled:opacity-40',
        on ? 'iu-on-ink bg-[var(--iu-ink)] text-[var(--iu-shell)]' : 'text-[var(--iu-ink-2)] hover:bg-[var(--iu-row)] hover:text-[var(--iu-ink)]',
      )}
    >
      {children}
    </button>
  );
}

export const Sep = (): React.JSX.Element => <span className="mx-0.5 h-4 w-px bg-[var(--iu-line)]" />;

function fitView(w: number, h: number, vw: number, vh: number): View {
  const aw = Math.max(40, vw - PAD * 2);
  const ah = Math.max(40, vh - PAD * 2 - BAR_H);
  let s = Math.min(aw / w, ah / h);
  // Small images show at 100 % (up to 4x when they are tiny), never blown up past that.
  s = Math.min(s, Math.max(w, h) < 256 ? 4 : 1);
  return { s, x: Math.round((vw - w * s) / 2), y: Math.round((vh - BAR_H - h * s) / 2) };
}

export function Stage({
  picture,
  handle,
  overlay,
  captures = false,
  panel,
  panelSide = 'left',
  badge,
  empty,
  busy = false,
  bar,
  backdrop,
  onBackdrop,
  className,
}: {
  picture: Picture | null;
  handle?: Ref<StageHandle>;
  overlay?: ((o: OverlayApi) => ReactNode) | undefined;
  /** True while a tool draws with the left button (then Space or the middle button pans). */
  captures?: boolean;
  panel?: ReactNode;
  /** Which side the panel floats on (away from what it edits). */
  panelSide?: 'left' | 'right';
  badge?: ReactNode;
  empty?: ReactNode;
  busy?: boolean;
  bar?: ReactNode;
  backdrop: Backdrop;
  onBackdrop: (b: Backdrop) => void;
  className?: string;
}): React.JSX.Element {
  const host = useRef<HTMLDivElement | null>(null);
  const [vp, setVp] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ s: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [natural, setNatural] = useState<{ url: string; w: number } | null>(null);
  const [tile, setTile] = useState<{ url: string; r: Region; src: string } | null>(null);
  const [tileBusy, setTileBusy] = useState(false);
  const [hover, setHover] = useState<[number, number] | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [zoomMenu, setZoomMenu] = useState(false);
  const zoomBtn = useRef<HTMLButtonElement | null>(null);
  const space = useRef(false);
  const [panning, setPanning] = useState(false);

  // The viewport size.
  useLayoutEffect(() => {
    const el = host.current;
    if (el === null) return;
    const ro = new ResizeObserver(() => setVp({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setVp({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const pw = picture?.w ?? 0;
  const ph = picture?.h ?? 0;
  const fit = useCallback((): void => {
    if (pw > 0 && ph > 0 && vp.w > 0) setView(fitView(pw, ph, vp.w, vp.h));
  }, [pw, ph, vp.w, vp.h]);

  // Fit when the picture's size changes (a crop, another image) or the stage resizes; keep the view otherwise.
  const fitKey = pw + 'x' + ph + '@' + vp.w + 'x' + vp.h;
  useEffect(() => {
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  const zoomAt = useCallback((f: number, cx?: number, cy?: number): void => {
    setView((v) => {
      const min = Math.min(0.02, v.s);
      const s = Math.min(MAX_SCALE, Math.max(min, v.s * f));
      const px = cx ?? vp.w / 2;
      const py = cy ?? (vp.h - BAR_H) / 2;
      return { s, x: px - ((px - v.x) * s) / v.s, y: py - ((py - v.y) * s) / v.s };
    });
  }, [vp.w, vp.h]);

  const setScale = useCallback(
    (s: number): void => {
      const v = viewRef.current;
      zoomAt(s / v.s);
    },
    [zoomAt],
  );

  useImperativeHandle(handle, () => ({ fit, actual: () => setScale(1), zoomBy: (f: number) => zoomAt(f), zoomTo: setScale }), [fit, setScale, zoomAt]);

  // Wheel and pinch zoom around the pointer (non-passive, to keep the page still).
  useEffect(() => {
    const el = host.current;
    if (el === null) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018));
      zoomAt(f, e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  // Space held: pan with the left button even while a tool draws.
  useEffect(() => {
    const typing = (t: EventTarget | null): boolean => {
      const el = t as HTMLElement | null;
      return el !== null && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
    };
    const down = (e: KeyboardEvent): void => {
      if (e.code === 'Space' && !typing(e.target)) {
        space.current = true;
        if (host.current?.matches(':hover') === true) e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent): void => {
      if (e.code === 'Space') space.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && document.querySelector('[role="dialog"]') === null) setExpanded(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  const toImage = useCallback((clientX: number, clientY: number): [number, number] => {
    const el = host.current;
    const v = viewRef.current;
    if (el === null) return [0, 0];
    const r = el.getBoundingClientRect();
    return [(clientX - r.left - v.x) / v.s, (clientY - r.top - v.y) / v.s];
  }, []);

  const startPan = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const start = { x: e.clientX, y: e.clientY, v: viewRef.current };
    setPanning(true);
    const move = (ev: PointerEvent): void => setView({ s: start.v.s, x: start.v.x + ev.clientX - start.x, y: start.v.y + ev.clientY - start.y });
    const up = (): void => {
      setPanning(false);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  // The full-resolution tile: after a pause, when the preview is shown larger than it is.
  const url = picture?.url ?? '';
  const nat = natural !== null && natural.url === url ? natural.w : 0;
  const detail = picture?.detail ?? null;
  const detailKey = detail === null ? '' : JSON.stringify(detail);
  const zoomedPast = nat > 0 && pw * view.s > nat * 1.2;
  useEffect(() => {
    setTile(null);
  }, [url]);
  useEffect(() => {
    if (!zoomedPast || detail === null || pw === 0) return;
    const t = setTimeout(() => {
      const v = viewRef.current;
      const x0 = Math.max(0, Math.floor(-v.x / v.s));
      const y0 = Math.max(0, Math.floor(-v.y / v.s));
      const x1 = Math.min(pw, Math.ceil((vp.w - v.x) / v.s));
      const y1 = Math.min(ph, Math.ceil((vp.h - v.y) / v.s));
      if (x1 - x0 < 2 || y1 - y0 < 2) return;
      const r: Region = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      setTileBusy(true);
      api
        .render(detail.image, { upto: detail.upto, original: detail.original, proposal: detail.proposal, draft: detail.draft, layers: detail.layers, region: r, max: 4000 }, true)
        .then((res) => setTile({ url: res.url, r, src: url }))
        .catch(() => undefined)
        .finally(() => setTileBusy(false));
    }, 380);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomedPast, view.s, Math.round(view.x / 40), Math.round(view.y / 40), detailKey, url, pw, ph, vp.w, vp.h]);

  const pixelated = view.s >= 2;
  const imgStyle = { left: view.x, top: view.y, width: pw * view.s, height: ph * view.s };
  const pct = Math.round(view.s * 100);
  const inside = hover !== null && hover[0] >= 0 && hover[1] >= 0 && hover[0] < pw && hover[1] < ph;
  const api_: OverlayApi = { view, toImage, viewport: vp };

  return (
    <div className={cn('relative flex min-h-0 flex-col overflow-hidden bg-[var(--iu-stage)]', backdrop === 'dark' && 'bg-[#1b1b1d]', backdrop === 'light' && 'bg-[#f4f4f2]', expanded && 'fixed inset-0 z-[55]', className)}>
      <div
        ref={host}
        className={cn('iu-stage absolute inset-0', panning && 'iu-panning', !captures && !panning && picture !== null && 'cursor-grab')}
        onPointerDownCapture={(e) => {
          // Space or the middle button pans, before any tool sees the press.
          if (e.button === 1 || (e.button === 0 && space.current)) {
            e.stopPropagation();
            startPan(e);
          }
        }}
        onPointerDown={(e) => {
          if (e.button === 0 && !captures) startPan(e);
        }}
        onPointerMove={(e) => setHover(toImage(e.clientX, e.clientY))}
        onPointerLeave={() => setHover(null)}
        onDoubleClick={(e) => {
          if (!captures && e.target === e.currentTarget) fit();
        }}
      >
        {picture !== null && pw > 0 && (
          <>
            <div aria-hidden className={cn('pointer-events-none absolute shadow-[0_1px_10px_rgba(0,0,0,0.18)]', backdrop === 'checker' && 'iu-checker')} style={imgStyle} />
            <img
              key={url}
              src={fileUrl(url)}
              alt=""
              draggable={false}
              onLoad={(e) => setNatural({ url, w: e.currentTarget.naturalWidth })}
              className={cn('pointer-events-none absolute max-w-none select-none', pixelated && 'iu-pixelated')}
              style={imgStyle}
            />
            {tile !== null && tile.src === url && (
              <img
                src={fileUrl(tile.url)}
                alt=""
                draggable={false}
                className={cn('pointer-events-none absolute max-w-none select-none', pixelated && 'iu-pixelated')}
                style={{ left: view.x + tile.r.x * view.s, top: view.y + tile.r.y * view.s, width: tile.r.w * view.s, height: tile.r.h * view.s }}
              />
            )}
          </>
        )}
        {overlay !== undefined && picture !== null && <div className="absolute inset-0">{overlay(api_)}</div>}
      </div>

      {picture === null && empty !== undefined && <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 [&>*]:pointer-events-auto">{empty}</div>}
      {busy && (
        <div className={cn('pointer-events-none absolute top-3 flex items-center gap-1.5 rounded-[var(--iu-r)] bg-[var(--iu-card)] px-2 py-1 text-[12px] font-semibold text-[var(--iu-ink-2)] shadow-[var(--iu-shadow-sm)]', panel !== undefined && panel !== null && panelSide === 'right' ? 'left-3' : 'right-3')}>
          <Spinner size={11} /> Rendering
        </div>
      )}

      {/* Top left (or right): the open tool or the selected layer. */}
      {panel !== undefined && panel !== null && <div className={cn('pointer-events-none absolute bottom-14 top-2 z-10 flex flex-col', panelSide === 'right' ? 'right-2 items-end' : 'left-2 items-start')}>{panel}</div>}
      {/* Top centre: what is shown, when it is not the result. */}
      {badge !== undefined && badge !== null && <div className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 [&>*]:pointer-events-auto">{badge}</div>}

      {/* Bottom left: the pixel under the pointer. */}
      {inside && hover !== null && (
        <div className="num pointer-events-none absolute bottom-[52px] left-2 hidden rounded-[var(--iu-r)] border border-[var(--iu-line)] bg-[var(--iu-card)] px-2 py-0.5 text-[12px] text-[var(--iu-ink-2)] shadow-[var(--iu-shadow-sm)] sm:block">
          x {Math.floor(hover[0])} · y {Math.floor(hover[1])}
        </div>
      )}

      {/* Bottom centre: the view. */}
      <div className="pointer-events-none absolute inset-x-2 bottom-2 flex justify-center">
        <div className={cn(BAR, 'pointer-events-auto max-w-full flex-wrap justify-center')}>
          {bar !== undefined && (
            <>
              {bar}
              <Sep />
            </>
          )}
          <BarButton label="Zoom out (−)" onClick={() => zoomAt(1 / 1.25)} disabled={picture === null}>
            <Minus size={14} aria-hidden />
          </BarButton>
          <div className="relative">
            <button
              ref={zoomBtn}
              type="button"
              aria-label="Zoom"
              title="Zoom"
              disabled={picture === null}
              onClick={() => setZoomMenu((o) => !o)}
              className="num inline-flex h-6 w-[58px] items-center justify-center gap-0.5 rounded-[var(--iu-r-sm)] text-[12px] font-semibold text-[var(--iu-ink-2)] hover:bg-[var(--iu-row)] hover:text-[var(--iu-ink)] disabled:opacity-40"
            >
              {pct} % <ChevronDown size={11} aria-hidden />
              {tileBusy && <span aria-hidden className="iu-pulse absolute right-0.5 top-0.5 size-1 rounded-full bg-[var(--iu-accent)]" />}
            </button>
            <Popover open={zoomMenu} onClose={() => setZoomMenu(false)} align="left" keep={zoomBtn} className="bottom-8 top-auto w-40">
              {[
                { label: 'Fit to view', key: '0', f: () => fit() },
                { label: '50 %', key: '', f: () => setScale(0.5) },
                { label: '100 % (real pixels)', key: '1', f: () => setScale(1) },
                { label: '200 %', key: '2', f: () => setScale(2) },
                { label: '400 %', key: '', f: () => setScale(4) },
              ].map((z) => (
                <button
                  key={z.label}
                  type="button"
                  className={menuItem}
                  onClick={() => {
                    setZoomMenu(false);
                    z.f();
                  }}
                >
                  <span className="flex-1">{z.label}</span>
                  {z.key !== '' && <span className="text-[12px] text-[var(--iu-muted)]">{z.key}</span>}
                </button>
              ))}
            </Popover>
          </div>
          <BarButton label="Zoom in (+)" onClick={() => zoomAt(1.25)} disabled={picture === null}>
            <Plus size={14} aria-hidden />
          </BarButton>
          <BarButton label="Fit (0)" onClick={fit} disabled={picture === null}>
            <Scan size={14} aria-hidden />
          </BarButton>
          <Sep />
          <BarButton label={backdrop === 'checker' ? 'Backdrop: checkerboard' : backdrop === 'light' ? 'Backdrop: light' : 'Backdrop: dark'} onClick={() => onBackdrop(backdrop === 'checker' ? 'light' : backdrop === 'light' ? 'dark' : 'checker')}>
            <SquareDashed size={14} aria-hidden />
          </BarButton>
          <BarButton label={expanded ? 'Exit full screen (Esc)' : 'Full screen'} onClick={() => setExpanded((x) => !x)}>
            {expanded ? <Minimize2 size={14} aria-hidden /> : <Maximize2 size={14} aria-hidden />}
          </BarButton>
        </div>
      </div>
    </div>
  );
}
