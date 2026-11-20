/**
 * The org chart on the sunk measuring grid: one card per person under their
 * manager, drawn from the reporting lines as of today. Drag to pan (no text
 * gets selected while dragging), the wheel, a trackpad scroll or pinch, or the
 * buttons to zoom (toward the pointer), Fit to see everyone; a team folds and
 * unfolds from its manager's card; finding a person brings them to the middle.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Maximize, Minus, Network, Plus, Rows3, UserPlus } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { Button, Empty, IconButton, LoadError, Loading, PageHeader, Picker, Segmented } from '../../components/ui.tsx';
import { can, useMe } from '../../lib/auth.tsx';
import type { PageProps } from '../../lib/contract.ts';
import { t, tn } from '../../lib/i18n.ts';
import { useOp } from '../../lib/live.ts';
import { navigate } from '../../lib/router.ts';
import { useUi } from '../../lib/store.tsx';
import { departmentOutline, useDepartments } from './data.ts';
import type { OrgNode } from './types.ts';
import { usePhoto } from './photo.tsx';
import { Avatar } from '../../components/ui.tsx';

const W = 208;
const H = 60;
const GX = 16;
const GY = 52;
/** Leaf teams larger than this stack in a column under their manager (keeps the chart narrow enough to read whole). */
const STACK = 2;

interface Placed {
  node: OrgNode;
  x: number;
  y: number;
  kids: number;
  folded: boolean;
}

interface Edge {
  from: { x: number; y: number };
  to: { x: number; y: number };
  stacked: boolean;
}

function layout(nodes: OrgNode[], roots: string[], folded: Set<string>): { placed: Placed[]; edges: Edge[]; width: number; height: number } {
  const byId = new Map(nodes.map((n) => [n.employee, n]));
  const kids = new Map<string, OrgNode[]>();
  for (const n of nodes) {
    if (n.manager === '' || !byId.has(n.manager)) continue;
    const arr = kids.get(n.manager) ?? [];
    arr.push(n);
    kids.set(n.manager, arr);
  }
  for (const arr of kids.values()) arr.sort((a, b) => (kids.get(b.employee)?.length ?? 0) - (kids.get(a.employee)?.length ?? 0) || a.name.localeCompare(b.name));
  const visibleKids = (id: string): OrgNode[] => (folded.has(id) ? [] : (kids.get(id) ?? []));
  const stacked = (id: string): boolean => {
    const k = visibleKids(id);
    return k.length > STACK && k.every((c) => visibleKids(c.employee).length === 0);
  };
  const widthMemo = new Map<string, number>();
  const width = (id: string, seen: Set<string>): number => {
    const m = widthMemo.get(id);
    if (m !== undefined) return m;
    if (seen.has(id)) return W;
    seen.add(id);
    const k = visibleKids(id);
    let w = W;
    if (k.length > 0 && !stacked(id)) w = Math.max(W, k.reduce((a, c) => a + width(c.employee, seen), 0) + GX * (k.length - 1));
    else if (stacked(id)) w = W + 24;
    widthMemo.set(id, w);
    return w;
  };
  const placed: Placed[] = [];
  const edges: Edge[] = [];
  let maxY = 0;
  const place = (id: string, left: number, depth: number, seen: Set<string>): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const n = byId.get(id);
    if (n === undefined) return;
    const w = width(id, new Set());
    const x = left + w / 2;
    const y = depth * (H + GY);
    maxY = Math.max(maxY, y + H);
    placed.push({ node: n, x, y, kids: kids.get(id)?.length ?? 0, folded: folded.has(id) });
    const k = visibleKids(id);
    if (k.length === 0) return;
    if (stacked(id)) {
      k.forEach((c, i) => {
        const cy = y + H + 20 + i * (H + 10);
        const cx = left + 24 + W / 2;
        placed.push({ node: c, x: cx, y: cy, kids: 0, folded: false });
        edges.push({ from: { x: left + 12, y: y + H }, to: { x: cx - W / 2, y: cy + H / 2 }, stacked: true });
        maxY = Math.max(maxY, cy + H);
        seen.add(c.employee);
      });
      return;
    }
    let cl = left + (w - (k.reduce((a, c) => a + width(c.employee, new Set()), 0) + GX * (k.length - 1))) / 2;
    for (const c of k) {
      const cw = width(c.employee, new Set());
      edges.push({ from: { x, y: y + H }, to: { x: cl + cw / 2, y: y + H + GY }, stacked: false });
      place(c.employee, cl, depth + 1, seen);
      cl += cw + GX;
    }
  };
  let left = 0;
  const seen = new Set<string>();
  for (const r of roots) {
    const w = width(r, new Set());
    place(r, left, 0, seen);
    left += w + GX * 3;
  }
  return { placed, edges, width: Math.max(left - GX * 3, W), height: maxY };
}

function Card({ p, onToggle, focus }: { p: Placed; onToggle: () => void; focus: boolean }): React.JSX.Element {
  const photo = usePhoto(p.node.employee, p.node.photo);
  return (
    <div className={cn('absolute flex items-center gap-2.5 rounded-[var(--hr-radius)] border bg-[var(--hr-raised)] px-2.5 shadow-[var(--hr-shadow)] transition-colors', focus ? 'border-[var(--hr-ink)]' : 'border-[var(--hr-line)] hover:border-[var(--hr-line-2)]')} style={{ left: p.x - W / 2, top: p.y, width: W, height: H }} data-org-node={p.node.employee}>
      <a href={`#/people/${p.node.number}`} className="hr-focus -ml-1.5 flex min-w-0 flex-1 items-center gap-2.5 self-stretch rounded-[4px] pl-1.5 transition-colors hover:bg-[var(--hr-hover)]" onPointerDown={(e) => e.stopPropagation()}>
        <Avatar name={p.node.name} photo={photo} size={30} />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-[13px] font-medium">{p.node.name}</span>
          <span className="block truncate text-[12px] text-[var(--hr-muted)]">{p.node.title !== '' ? p.node.title : p.node.department_name}</span>
        </span>
      </a>
      {p.kids > 0 && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onToggle}
          aria-label={p.folded ? t('org.unfold', { n: p.kids }) : t('org.fold')}
          title={p.folded ? t('org.unfold', { n: p.kids }) : t('org.fold')}
          className="hr-focus hit hr-mono flex h-6 shrink-0 items-center gap-0.5 rounded-[4px] border border-[var(--hr-line)] bg-[var(--hr-sunk)] px-1.5 text-[12px] text-[var(--hr-ink-2)] hover:bg-[var(--hr-hover)] hover:text-[var(--hr-ink)]"
        >
          {p.kids}
          {p.folded ? <ChevronDown size={11} aria-hidden /> : <ChevronUp size={11} aria-hidden />}
        </button>
      )}
    </div>
  );
}

export function OrgChartPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const { entity } = useUi();
  const department = query.get('department') ?? '';
  const live = useOp<{ nodes: OrgNode[]; roots: string[]; total: number; as_of: string }>('people.org-chart', { entity: entity === '' ? undefined : entity, department: department === '' ? undefined : department }, ['employees', 'employments', 'job_records'], { name: 'people.org', keep: true });
  const departments = useDepartments(entity);
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [view, setView] = useState({ x: 40, y: 40, k: 1 });
  const [focusId, setFocusId] = useState('');
  const box = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const data = live.data;
  const lay = useMemo(() => (data === null ? null : layout(data.nodes, data.roots, folded)), [data, folded]);

  /**
   * Everyone in view and centred (the Fit button and the first open). Only a
   * chart too big to read whole (under 40 percent) opens at a readable 70
   * percent centred on the top person instead.
   */
  const fit = useCallback(
    (readable = false) => {
      const el = box.current;
      if (el === null || lay === null) return;
      const pad = 40;
      const whole = Math.min(1, (el.clientWidth - pad * 2) / Math.max(1, lay.width), (el.clientHeight - pad * 2) / Math.max(1, lay.height));
      const root = lay.placed[0];
      if (readable && whole < 0.4 && root !== undefined) {
        const k = 0.7;
        setView({ k, x: el.clientWidth / 2 - root.x * k, y: pad });
        return;
      }
      const k = Math.max(0.2, whole);
      setView({ k, x: (el.clientWidth - lay.width * k) / 2, y: Math.max(pad, (el.clientHeight - lay.height * k) / 2) });
    },
    [lay],
  );
  const fitted = useRef(false);
  useLayoutEffect(() => {
    if (!fitted.current && lay !== null && lay.placed.length > 0) {
      fitted.current = true;
      fit(true);
    }
  }, [lay, fit]);

  const zoom = (f: number, cx?: number, cy?: number): void => {
    const el = box.current;
    if (el === null) return;
    const px = cx ?? el.clientWidth / 2;
    const py = cy ?? el.clientHeight / 2;
    setView((v) => {
      const k = Math.min(2, Math.max(0.2, v.k * f));
      return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
    });
  };
  useEffect(() => {
    const el = box.current;
    if (el === null) return;
    const wheel = (e: WheelEvent): void => {
      // The wheel and a trackpad scroll zoom toward the pointer (never scroll the page); a pinch (Ctrl) zooms faster per step.
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * el.clientHeight : e.deltaY;
      if (dy === 0) return;
      const f = Math.min(1.5, Math.max(1 / 1.5, Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015))));
      zoom(f, e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [lay]);

  const endPan = (el: HTMLElement): void => {
    drag.current = null;
    el.style.userSelect = '';
    el.style.webkitUserSelect = '';
  };

  const find = (id: string): void => {
    setFocusId(id);
    const p = lay?.placed.find((x) => x.node.employee === id);
    const el = box.current;
    if (p === undefined || el === undefined || el === null) return;
    setView((v) => ({ ...v, x: el.clientWidth / 2 - p.x * v.k, y: el.clientHeight / 2 - (p.y + H / 2) * v.k }));
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title={t('org.title')} meta={data !== null ? tn('people.meta_count', data.total) : undefined}>
        <Segmented
          value="org"
          onChange={(v) => v === 'list' && navigate('/people', department !== '' ? { department } : undefined)}
          label={t('people.view')}
          options={[
            { value: 'list', label: t('people.list'), icon: Rows3 },
            { value: 'org', label: t('people.org'), icon: Network },
          ]}
          className="hidden sm:inline-flex"
        />
        {can(me, 'people', 'full') && (
          <Button variant="primary" icon={UserPlus} onClick={() => navigate('/people/new')}>
            {t('people.hire')}
          </Button>
        )}
      </PageHeader>
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--hr-line)] px-4 py-2 md:px-6">
        <Picker value={focusId} onChange={(v) => v !== '' && find(v)} items={(data?.nodes ?? []).map((n) => ({ value: n.employee, label: n.name, sub: n.title, person: true }))} label={t('org.find')} placeholder={t('org.find')} className="w-[220px]" />
        <Picker
          value={department}
          onChange={(v) => {
            fitted.current = false;
            navigate('/people/org', v !== '' ? { department: v } : undefined);
          }}
          items={departmentOutline(departments ?? []).map(({ dept, depth }) => ({ value: dept.id, label: '  '.repeat(depth) + dept.name }))}
          label={t('people.col.department')}
          placeholder={t('people.any_department')}
          clearable
          className="w-[190px]"
        />
        <span className="flex-1" />
        <div className="flex items-center gap-0.5 rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)] bg-[var(--hr-raised)] p-0.5">
          <IconButton icon={Minus} label={t('org.zoom_out')} size={28} onClick={() => zoom(1 / 1.2)} />
          <span className="hr-mono hr-num w-11 text-center text-[12px] text-[var(--hr-ink-2)]">{Math.round(view.k * 100)}%</span>
          <IconButton icon={Plus} label={t('org.zoom_in')} size={28} onClick={() => zoom(1.2)} />
          <IconButton icon={Maximize} label={t('org.fit')} size={28} onClick={() => fit(false)} />
        </div>
      </div>
      {data === null ? (
        live.error !== null ? (
          <LoadError message={live.error} onRetry={live.reload} />
        ) : (
          <Loading />
        )
      ) : data.nodes.length === 0 ? (
        <div className="hr-grid flex-1">
          <Empty icon={Network} title={t('org.empty')} action={can(me, 'people', 'full') ? <Button variant="primary" icon={UserPlus} onClick={() => navigate('/people/new')}>{t('people.hire_first')}</Button> : undefined}>
            {t('org.empty_text')}
          </Empty>
        </div>
      ) : (
        <div
          ref={box}
          className="hr-grid relative min-h-[420px] flex-1 cursor-grab touch-none overflow-hidden active:cursor-grabbing"
          onPointerDown={(e) => {
            const el = e.currentTarget as HTMLElement;
            el.setPointerCapture(e.pointerId);
            // No text selection while panning (set before the browser starts one); text stays selectable otherwise.
            el.style.userSelect = 'none';
            el.style.webkitUserSelect = 'none';
            drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (d === null) return;
            setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
          }}
          onPointerUp={(e) => endPan(e.currentTarget as HTMLElement)}
          onPointerCancel={(e) => endPan(e.currentTarget as HTMLElement)}
          onLostPointerCapture={(e) => endPan(e.currentTarget as HTMLElement)}
          aria-label={t('org.title')}
        >
          {lay !== null && (
            <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, width: lay.width, height: lay.height }}>
              <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={lay.width} height={lay.height} aria-hidden>
                {lay.edges.map((e, i) => {
                  const mid = e.from.y + (e.to.y - e.from.y) / 2;
                  const d = e.stacked ? `M${e.from.x} ${e.from.y} V${e.to.y} H${e.to.x}` : `M${e.from.x} ${e.from.y} V${mid} H${e.to.x} V${e.to.y}`;
                  return <path key={i} d={d} fill="none" stroke="var(--hr-line-2)" strokeWidth={1.2} />;
                })}
              </svg>
              {lay.placed.map((p) => (
                <Card
                  key={p.node.employee}
                  p={p}
                  focus={p.node.employee === focusId}
                  onToggle={() =>
                    setFolded((f) => {
                      const next = new Set(f);
                      if (next.has(p.node.employee)) next.delete(p.node.employee);
                      else next.add(p.node.employee);
                      return next;
                    })
                  }
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
