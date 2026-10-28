/**
 * The workspace: widgets on a 24 by 36 grid that fills the window, dragged
 * by their header and resized from the right edge, the bottom edge or the
 * corner. 1px gaps show the rule color, so widgets read as panes of one
 * surface. A maximized widget takes the whole area; on a phone the widgets
 * stack in one column.
 *
 * Gestures: the grid library re-renders an item only when its grid cell
 * changes, so on its own a dragged widget sits still and then jumps a whole
 * cell. The grid re-renders once per animation frame while a drag or resize
 * is on (cheap: widget contents are memoized and do not re-render), so the
 * widget follows the pointer exactly. During a gesture the page takes no
 * text selection and widgets take no hover (lib: gesture class on <html>).
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactGridLayout from 'react-grid-layout';
import type { Layout } from 'react-grid-layout';
import { LayoutGrid, Plus } from 'lucide-react';
import { Btn, Empty, Spinner } from '../components/ui.tsx';
import { useApp } from '../lib/store.tsx';
import type { Widget } from '../lib/types.ts';
import { DEF } from './registry.tsx';

const COLS = 24;
const ROWS = 36;
const GAP = 1;

/** A widget's content; memoized so grid re-renders during a gesture skip it. */
const Body = memo(function Body({ w }: { w: Widget }): React.JSX.Element {
  const def = DEF[w.type];
  if (def === undefined) return <div className="h-full bg-[var(--tv-card)]" />;
  const C = def.component;
  return <C w={w} />;
});

function gestureOn(): void {
  document.documentElement.classList.add('tv-gesture-on');
}

const GESTURE_TARGET = '.react-resizable-handle, .tv-drag';
const NOT_A_GESTURE = '.tv-nodrag, button, input, select, textarea, a, [role="button"]';

/**
 * From the press on a header or resize handle: no text selection (the
 * press itself would start one). Once the drag or resize has begun
 * (`gestureOn`), widgets under the pointer also stop taking hover; doing
 * that at the press would move the press's target and the drag would not
 * start.
 */
function startGesture(e: React.PointerEvent): void {
  if (e.button !== 0) return;
  const t = e.target as HTMLElement;
  if (t.closest(GESTURE_TARGET) === null) return;
  if (!t.classList.contains('react-resizable-handle') && t.closest(NOT_A_GESTURE) !== null) return;
  const root = document.documentElement;
  const handle = /react-resizable-handle-(se|e|s)\b/.exec(t.className);
  root.dataset['gesture'] = handle !== null ? (handle[1] ?? 'se') : 'drag';
  root.classList.add('tv-gesture');
  window.getSelection()?.removeAllRanges();
  const end = (): void => {
    root.classList.remove('tv-gesture', 'tv-gesture-on');
    delete root.dataset['gesture'];
    window.getSelection()?.removeAllRanges();
    window.removeEventListener('pointerup', end, true);
    window.removeEventListener('pointercancel', end, true);
    window.removeEventListener('blur', end);
  };
  window.addEventListener('pointerup', end, true);
  window.addEventListener('pointercancel', end, true);
  window.addEventListener('blur', end);
}

export function Grid({ onAddWidget }: { onAddWidget: () => void }): React.JSX.Element {
  const app = useApp();
  const ws = app.ws;
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  // One re-render per frame during a drag or resize (see the header).
  const [, setFrame] = useState(0);
  const frameReq = useRef<number | null>(null);
  const follow = useCallback(() => {
    if (frameReq.current !== null) return;
    frameReq.current = requestAnimationFrame(() => {
      frameReq.current = null;
      setFrame((n) => n + 1);
    });
  }, []);
  useEffect(
    () => () => {
      if (frameReq.current !== null) cancelAnimationFrame(frameReq.current);
    },
    [],
  );

  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const ro = new ResizeObserver((e) => {
      const r = e[0]?.contentRect;
      if (r !== undefined) setSize({ w: Math.floor(r.width), h: Math.floor(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rowHeight = Math.max(14, Math.floor((size.h - (ROWS - 1) * GAP) / ROWS));
  const phone = size.w > 0 && size.w < 720;
  const locked = ws?.locked === true;

  const layout: Layout = useMemo(
    () =>
      (ws?.widgets ?? []).map((w) => {
        const d = DEF[w.type];
        return { i: w.id, x: w.x, y: w.y, w: w.w, h: w.h, minW: d?.minW ?? 3, minH: d?.minH ?? 2, resizeHandles: ['se', 'e', 's'] as const };
      }) as unknown as Layout,
    [ws?.widgets],
  );

  const save = (l: Layout): void => app.saveLayout(l.map((it) => ({ id: it.i, x: it.x, y: it.y, w: it.w, h: it.h })));

  if (ws === null)
    return (
      <div ref={ref} className="flex min-h-0 flex-1 items-center justify-center">
        <Spinner className="text-[var(--tv-muted)]" />
      </div>
    );

  if (ws.widgets.length === 0)
    return (
      <div ref={ref} className="min-h-0 flex-1">
        <Empty icon={LayoutGrid} title="This workspace is empty" action={<Btn variant="primary" icon={Plus} onClick={onAddWidget}>Add widget</Btn>}>
          Add a chart, a watchlist, the AI analyst or any other widget, then drag and resize them.
        </Empty>
      </div>
    );

  const max = app.maximized !== '' ? ws.widgets.find((w) => w.id === app.maximized) : undefined;

  return (
    <div ref={ref} className="tv-grid relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden" onPointerDownCapture={startGesture}>
      {max !== undefined ? (
        <div className="absolute inset-0">
          <Body w={max} />
        </div>
      ) : phone ? (
        <div className="tv-stack flex flex-col gap-px">
          {ws.widgets
            .slice()
            .sort((a, b) => a.y - b.y || a.x - b.x)
            .map((w) => (
              <div key={w.id} style={{ height: w.type === 'ticker' ? 48 : Math.max(280, Math.min(560, w.h * 18)) }}>
                <Body w={w} />
              </div>
            ))}
        </div>
      ) : (
        size.w > 0 && (
          <ReactGridLayout
            layout={layout}
            width={size.w}
            gridConfig={{ cols: COLS, rowHeight, margin: [GAP, GAP], containerPadding: [0, 0] }}
            dragConfig={{ enabled: !locked, handle: '.tv-drag', cancel: '.tv-nodrag, button, input, select, textarea, a, [role="button"]' }}
            resizeConfig={{ enabled: !locked, handles: ['se', 'e', 's'] }}
            onDragStart={gestureOn}
            onResizeStart={gestureOn}
            onDrag={follow}
            onResize={follow}
            onDragStop={(l: Layout) => save(l)}
            onResizeStop={(l: Layout) => save(l)}
          >
            {ws.widgets.map((w) => (
              <div key={w.id} className="overflow-hidden">
                <Body w={w} />
              </div>
            ))}
          </ReactGridLayout>
        )
      )}
    </div>
  );
}
