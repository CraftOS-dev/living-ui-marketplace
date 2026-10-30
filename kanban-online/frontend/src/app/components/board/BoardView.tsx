/**
 * A board: columns as stages (each showing its contract: count against the
 * WIP limit, who works it: people, any agent or one agent), cards anyone on
 * the team drags between them, optional swimlanes (by assignee or priority;
 * dropping a card in another lane reassigns it), a filter bar, quick add,
 * the board's live status (agents working, queued, waiting on people) and
 * who else is looking at the board right now.
 *
 * Moves show at once and are saved through cards.move, which enforces the
 * rules: a column agents work queues the card for them, WIP limits warn
 * people, Done records who finished it.
 *
 * Motion: a dragged card lifts off the board and tilts with the pointer,
 * the cards around the drop point make room, and the card settles into
 * place when you let go. Cards that teammates and agents move glide to
 * their new column.
 */
import { Component, Fragment, createRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { ArrowLeft, ArrowRight, ChevronsLeftRight, Filter, MoreHorizontal, Plus, Rows3, Search, Settings2, Snowflake, SquareKanban, Trash2, UserX, X } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { api } from '../../lib/api.ts';
import { useApp } from '../../lib/context.tsx';
import { useLive } from '../../lib/live.ts';
import { navigate } from '../../lib/router.ts';
import type { BoardDetail, Card, Column, Party } from '../../lib/types.ts';
import { CATEGORY_HINT, CategoryIcon, LabelDot, PRIORITY_LABEL, PriorityIcon } from '../marks.tsx';
import { assigneeKey } from '../people.tsx';
import { AgentAvatar, AvatarStack, Button, Chip, Empty, IconButton, MenuButton, MenuItem, MenuLabel, MenuSep, PartyAvatar, PersonAvatar, PoolAvatar, Popover, Segmented, Spinner, Textarea, errMessage, partyName, useConfirm } from '../ui.tsx';
import { BoardSettings } from './BoardSettings.tsx';
import { CardFace } from './CardFace.tsx';
import { ColumnSettings } from './ColumnSettings.tsx';

interface Filters {
  assignee: string[];
  labels: string[];
  priority: number[];
  state: string[];
}

interface Target {
  col: string;
  lane: string;
  index: number;
  before?: string | undefined;
  after?: string | undefined;
}

/** What React renders during a drag: the card, its size and the slot it would drop into. */
interface Drag {
  id: string;
  w: number;
  h: number;
  target: Target | null;
}

/** The pointer during a drag, updated every frame outside React. */
interface Pointer {
  id: string;
  x: number;
  y: number;
  dx: number;
  dy: number;
  lastX: number;
  tilt: number;
  target: Target | null;
}

/** Where a released card was, so it can settle from there into its slot. */
interface Landing {
  id: string;
  left: number;
  top: number;
  tilt: number;
}

const NO_FILTERS: Filters = { assignee: [], labels: [], priority: [], state: [] };
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

function laneKey(card: Card, mode: string): string {
  if (mode === 'priority') return String(card.priority);
  return assigneeKey(card.assignee) || 'none';
}

/** Who a queued card waits for, in words. */
function queuedFor(card: { assignee: Party | null }): string {
  return card.assignee?.kind === 'pool' ? 'any agent' : (card.assignee?.name ?? 'an agent');
}

function stateKey(card: Card): string {
  if (card.agent_state === 'working') return 'working';
  if (card.agent_state === 'needs_input') return 'needs_input';
  if (card.agent_state === 'needs_attention') return 'needs_attention';
  if (card.review_state === 'pending') return 'review';
  if (card.agent_state === 'queued') return 'queued';
  if (card.blocked) return 'blocked';
  return '';
}

function sameTarget(a: Target | null, b: Target | null): boolean {
  if (a === null || b === null) return a === b;
  return a.col === b.col && a.lane === b.lane && a.index === b.index;
}

function reducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** A card flies across the board above everything (columns clip their own scroll areas). */
function fly(el: HTMLElement, from: { left: number; top: number }, to: DOMRect, opts: { tilt?: number; lifted?: boolean; duration?: number }): void {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.removeAttribute('data-card');
  clone.setAttribute('aria-hidden', 'true');
  Object.assign(clone.style, { position: 'fixed', left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px`, margin: '0', zIndex: '95', pointerEvents: 'none' });
  document.body.appendChild(clone);
  el.style.opacity = '0';
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  const start = `translate(${dx}px, ${dy}px)` + (opts.lifted === true ? ` rotate(${(opts.tilt ?? 0).toFixed(2)}deg) scale(1.035)` : '');
  const duration = opts.duration ?? 280;
  const tile = clone.firstElementChild as HTMLElement | null;
  if (tile !== null && opts.lifted === true) {
    const css = getComputedStyle(document.documentElement);
    tile.animate([{ boxShadow: css.getPropertyValue('--kb-shadow-lift') }, { boxShadow: css.getPropertyValue('--kb-shadow-card') }], { duration, easing: EASE });
  }
  const anim = clone.animate([{ transform: start }, { transform: 'none' }], { duration, easing: EASE });
  const done = (): void => {
    clone.remove();
    el.style.opacity = '';
  };
  anim.onfinish = done;
  anim.oncancel = done;
}

/**
 * FLIP for the board: measures every card just before React changes the
 * DOM and animates each one from where it was to where it is now. Cards
 * that change column fly above the columns; new cards fade in.
 */
class Glide extends Component<{ children: ReactNode; landing: RefObject<Landing | null> }> {
  root = createRef<HTMLDivElement>();

  override getSnapshotBeforeUpdate(): Map<string, { rect: DOMRect; col: string }> {
    const out = new Map<string, { rect: DOMRect; col: string }>();
    const root = this.root.current;
    if (root === null) return out;
    for (const el of root.querySelectorAll<HTMLElement>('[data-card]')) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0) continue; // the hidden card being dragged
      out.set(el.dataset.card ?? '', { rect, col: el.closest<HTMLElement>('[data-col]')?.dataset.col ?? '' });
    }
    return out;
  }

  override componentDidUpdate(_p: unknown, _s: unknown, before: Map<string, { rect: DOMRect; col: string }>): void {
    const root = this.root.current;
    const land = this.props.landing.current;
    this.props.landing.current = null;
    if (root === null || reducedMotion()) return;
    for (const el of root.querySelectorAll<HTMLElement>('[data-card]')) {
      const id = el.dataset.card ?? '';
      for (const a of el.getAnimations()) if (a.id === 'kb-glide') a.cancel();
      const now = el.getBoundingClientRect();
      if (now.width === 0) continue;
      if (land !== null && land.id === id) {
        fly(el, land, now, { tilt: land.tilt, lifted: true, duration: 260 });
        continue;
      }
      const prev = before.get(id);
      if (prev === undefined) {
        if (before.size > 0) {
          const a = el.animate([{ opacity: 0, transform: 'translateY(6px) scale(0.98)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: EASE });
          a.id = 'kb-glide';
        }
        continue;
      }
      const dx = prev.rect.left - now.left;
      const dy = prev.rect.top - now.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      const col = el.closest<HTMLElement>('[data-col]')?.dataset.col ?? '';
      if (col !== prev.col) {
        fly(el, prev.rect, now, { duration: 340 });
        continue;
      }
      const a = el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 220, easing: EASE });
      a.id = 'kb-glide';
    }
  }

  override render(): ReactNode {
    return (
      <div ref={this.root} className="contents">
        {this.props.children}
      </div>
    );
  }
}

export function BoardView({ id }: { id: string }): React.JSX.Element {
  const app = useApp();
  const live = useLive(() => api.board(id), ['cards', 'columns', 'labels', 'boards', 'rules'], [id], 120);
  const d = live.data;
  const [over, setOver] = useState<Record<string, { column: string; position: number }>>({});
  const pending = useRef(0);
  useEffect(() => {
    if (pending.current === 0) setOver({});
  }, [d]);
  useEffect(() => {
    app.setLastBoard(id);
    void api.reportUi({ view: 'board', board: id, card: app.openCard ?? undefined }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, app.openCard]);

  // Teammates looking at this board right now (you are not listed).
  const here = app.people.filter((p) => p.online && p.id !== app.me?.id && p.where?.board === id);

  const [q, setQ] = useState('');
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterBtn = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [columnOpen, setColumnOpen] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmEl, confirm] = useConfirm();

  useEffect(() => {
    const on = (): void => searchRef.current?.focus();
    window.addEventListener('kb-search', on);
    return () => window.removeEventListener('kb-search', on);
  }, []);
  useEffect(() => {
    setQ('');
    setFilters(NO_FILTERS);
  }, [id]);

  const lanesMode = d?.board.swimlanes ?? 'none';

  // Cards as they are now, with moves you just made shown before the server confirms them.
  const cards = useMemo(() => {
    if (d === null) return [] as Card[];
    return d.cards.map((c) => (over[c.id] !== undefined ? { ...c, column: over[c.id]!.column, position: over[c.id]!.position } : c));
  }, [d, over]);

  const visible = useMemo(() => {
    const words = q.trim().toLowerCase();
    return cards.filter((c) => {
      if (words !== '' && !c.title.toLowerCase().includes(words) && !c.key.toLowerCase().includes(words)) return false;
      if (filters.assignee.length > 0 && !filters.assignee.includes(assigneeKey(c.assignee) || 'none')) return false;
      if (filters.labels.length > 0 && !c.labels.some((l) => filters.labels.includes(l.id))) return false;
      if (filters.priority.length > 0 && !filters.priority.includes(c.priority)) return false;
      if (filters.state.length > 0 && !filters.state.includes(stateKey(c))) return false;
      return true;
    });
  }, [cards, q, filters]);

  const byCell = useMemo(() => {
    const m = new Map<string, Card[]>();
    for (const c of visible) {
      const k = c.column + '|' + (lanesMode === 'none' ? '' : laneKey(c, lanesMode));
      const list = m.get(k) ?? [];
      list.push(c);
      m.set(k, list);
    }
    for (const list of m.values()) list.sort((a, z) => a.position - z.position);
    return m;
  }, [visible, lanesMode]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cards) m.set(c.column, (m.get(c.column) ?? 0) + 1);
    return m;
  }, [cards]);

  const lanes = useMemo(() => {
    if (lanesMode === 'none') return [{ key: '', label: '', party: null as Party | null }];
    if (lanesMode === 'priority') return [1, 2, 3, 4, 0].map((p) => ({ key: String(p), label: PRIORITY_LABEL[p] ?? '', party: null as Party | null }));
    // A lane for you, then everyone and every agent with cards here, any agent, and nobody.
    const seen = new Map<string, Party>();
    for (const c of cards) if (c.assignee !== null) seen.set(assigneeKey(c.assignee), c.assignee);
    const meKey = app.me ? 'user:' + app.me.id : '';
    const out: { key: string; label: string; party: Party | null }[] = [];
    if (app.me !== null) out.push({ key: meKey, label: 'You', party: { kind: 'person', id: app.me.id, name: app.me.name, tone: app.me.tone } });
    const rank = (k: string): number => (k.startsWith('user:') ? 0 : k.startsWith('agent:') ? 1 : 2);
    const rest = [...seen.entries()].filter(([k]) => k !== meKey && k !== 'pool').sort((a, z) => rank(a[0]) - rank(z[0]) || a[1].name.localeCompare(z[1].name));
    for (const [k, party] of rest) out.push({ key: k, label: party.name, party });
    out.push({ key: 'pool', label: 'Any agent', party: { kind: 'pool', name: 'Any agent' } });
    out.push({ key: 'none', label: 'Unassigned', party: null });
    return out;
  }, [lanesMode, cards, app.me]);

  /* ------------------------------------------------------------ drag */

  const ptr = useRef<Pointer | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const ghost = useRef<HTMLDivElement | null>(null);
  const landing = useRef<Landing | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const raf = useRef<number | null>(null);

  const hit = useCallback((x: number, y: number, dragId: string): Target | null => {
    const els = document.elementsFromPoint(x, y);
    const zone = els.find((el) => (el as HTMLElement).dataset?.drop === '1') as HTMLElement | undefined;
    if (zone === undefined) return ptr.current?.target ?? null;
    const list = Array.from(zone.querySelectorAll<HTMLElement>('[data-card]')).filter((c) => c.dataset.card !== dragId);
    let index = list.length;
    for (let i = 0; i < list.length; i++) {
      const r = list[i]!.getBoundingClientRect();
      if (y < r.top + r.height / 2) {
        index = i;
        break;
      }
    }
    return { col: zone.dataset.col ?? '', lane: zone.dataset.lane ?? '', index, before: list[index]?.dataset.card, after: list[index - 1]?.dataset.card };
  }, []);

  const retarget = useCallback(
    (p: Pointer) => {
      const t = hit(p.x, p.y, p.id);
      if (sameTarget(t, p.target)) return;
      p.target = t;
      setDrag((cur) => (cur === null ? cur : { ...cur, target: t }));
    },
    [hit],
  );

  // Every frame of a drag: scroll near the edges, tilt with the pointer's speed, move the ghost.
  const frame = useCallback(() => {
    const p = ptr.current;
    const el = scroller.current;
    if (p === null || el === null) {
      raf.current = null;
      return;
    }
    const r = el.getBoundingClientRect();
    const edge = 70;
    let sx = 0;
    if (p.x < r.left + edge) sx = -Math.ceil((r.left + edge - p.x) / 5);
    else if (p.x > r.right - edge) sx = Math.ceil((p.x - (r.right - edge)) / 5);
    let sy = 0;
    if (p.y < r.top + edge) sy = -Math.ceil((r.top + edge - p.y) / 6);
    else if (p.y > r.bottom - edge) sy = Math.ceil((p.y - (r.bottom - edge)) / 6);
    if (sx !== 0) el.scrollLeft += sx;
    if (sy !== 0) {
      const zone = (document.elementsFromPoint(p.x, p.y).find((n) => (n as HTMLElement).dataset?.scrolls === '1') as HTMLElement | undefined) ?? el;
      zone.scrollTop += sy;
    }
    if (sx !== 0 || sy !== 0) retarget(p);
    const vx = p.x - p.lastX;
    p.lastX = p.x;
    const want = Math.max(-9, Math.min(9, vx * 0.7));
    p.tilt += (want - p.tilt) * 0.18;
    const g = ghost.current;
    if (g !== null) g.style.transform = `translate3d(${p.x - p.dx}px, ${p.y - p.dy}px, 0) rotate(${p.tilt.toFixed(2)}deg)`;
    raf.current = requestAnimationFrame(frame);
  }, [retarget]);

  const drop = useCallback(
    (card: Card, t: Target) => {
      if (d === null) return;
      const laneNow = lanesMode === 'none' ? '' : laneKey(card, lanesMode);
      const laneChanged = lanesMode !== 'none' && t.lane !== laneNow;
      const list = (byCell.get(t.col + '|' + t.lane) ?? []).filter((c) => c.id !== card.id);
      const prev = list[t.index - 1];
      const next = list[t.index];
      if (!laneChanged && t.col === card.column) {
        const cur = (byCell.get(card.column + '|' + laneNow) ?? []).filter((c) => c.id !== card.id);
        const was = (byCell.get(card.column + '|' + laneNow) ?? []).findIndex((c) => c.id === card.id);
        if (cur[was - 1]?.id === prev?.id && cur[was]?.id === next?.id) return;
      }
      const position = prev !== undefined && next !== undefined ? (prev.position + next.position) / 2 : prev !== undefined ? prev.position + 1000 : next !== undefined ? next.position - 1000 : 1000;
      setOver((o) => ({ ...o, [card.id]: { column: t.col, position } }));
      pending.current++;
      const movedColumn = t.col !== card.column;
      const run = async (): Promise<void> => {
        const res = await api.moveCard(card.id, t.col, { before: next?.id, after: next === undefined ? prev?.id : undefined });
        for (const w of res.warnings) toast.info(w);
        if (laneChanged) {
          if (lanesMode === 'priority') await api.updateCard(card.id, { priority: Number(t.lane) });
          else await api.assign(card.id, t.lane === 'none' ? '' : t.lane);
        }
        if (movedColumn && res.card.agent_state === 'queued') toast.info(`${res.card.key} is queued for ${queuedFor(res.card)}`);
        if (movedColumn && res.card.agent_state === 'needs_input' && res.card.question?.kind === 'criteria') toast.info(`${res.card.key} needs acceptance criteria before an agent can start`);
      };
      run()
        .catch((err: unknown) => {
          toast.error(errMessage(err));
          setOver((o) => {
            const n = { ...o };
            delete n[card.id];
            return n;
          });
        })
        .finally(() => {
          pending.current--;
          live.reload();
        });
    },
    [d, byCell, lanesMode, live],
  );

  const onCardDown = useCallback(
    (e: React.PointerEvent, card: Card) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest('button,a,input,textarea,select')) return;
      const el = e.currentTarget as HTMLElement;
      const rect = el.getBoundingClientRect();
      const sx = e.clientX;
      const sy = e.clientY;
      // A finger picks a card up with a short press and hold, so a swipe still scrolls the board.
      const touch = e.pointerType === 'touch';
      let started = false;
      let last = { x: sx, y: sy };
      let hold: number | null = null;
      const noScroll = (ev: TouchEvent): void => {
        if (started) ev.preventDefault();
      };
      const begin = (x: number, y: number): void => {
        started = true;
        document.body.classList.add('kb-dragging');
        ptr.current = { id: card.id, x, y, dx: sx - rect.left, dy: sy - rect.top, lastX: x, tilt: 0, target: null };
        setDrag({ id: card.id, w: rect.width, h: rect.height, target: null });
        if (raf.current === null) raf.current = requestAnimationFrame(frame);
      };
      if (touch) {
        window.addEventListener('touchmove', noScroll, { passive: false });
        hold = window.setTimeout(() => {
          hold = null;
          if (typeof navigator.vibrate === 'function') navigator.vibrate(8);
          begin(last.x, last.y);
          const p = ptr.current;
          if (p !== null) retarget(p);
        }, 280);
      }
      const move = (ev: PointerEvent): void => {
        last = { x: ev.clientX, y: ev.clientY };
        if (!started) {
          const far = Math.hypot(ev.clientX - sx, ev.clientY - sy);
          if (touch) {
            // Moving before the hold is a scroll: let it go.
            if (far > 8 && hold !== null) {
              window.clearTimeout(hold);
              hold = null;
            }
            return;
          }
          if (far < 5) return;
          begin(ev.clientX, ev.clientY);
        }
        const p = ptr.current;
        if (p === null) return;
        p.x = ev.clientX;
        p.y = ev.clientY;
        retarget(p);
      };
      const end = (ev: PointerEvent): void => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
        window.removeEventListener('touchmove', noScroll);
        if (hold !== null) window.clearTimeout(hold);
        document.body.classList.remove('kb-dragging');
        if (!started) {
          if (ev.type === 'pointerup' && Math.hypot(last.x - sx, last.y - sy) < 10) app.setOpenCard(card.id);
          return;
        }
        const p = ptr.current;
        ptr.current = null;
        if (raf.current !== null) cancelAnimationFrame(raf.current);
        raf.current = null;
        // The card settles from where you let go: into its new slot, or back home.
        if (p !== null) landing.current = { id: card.id, left: p.x - p.dx, top: p.y - p.dy, tilt: p.tilt };
        setDrag(null);
        if (ev.type === 'pointerup' && p !== null && p.target !== null) drop(card, p.target);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
    },
    [app, frame, drop, retarget],
  );

  /* --------------------------------------------------------- columns */

  const saveColumn = (col: Column, p: Parameters<typeof api.updateColumn>[1]): void => {
    api.updateColumn(col.id, p).catch((err: unknown) => toast.error(errMessage(err)));
  };

  const removeColumn = async (col: Column): Promise<void> => {
    if (d === null) return;
    const n = counts.get(col.id) ?? 0;
    const others = d.columns.filter((c) => c.id !== col.id);
    const to = others.find((c) => c.position > col.position) ?? others[others.length - 1];
    const ok = await confirm(n > 0 ? `Its ${n} card${n === 1 ? '' : 's'} move to "${to?.name ?? ''}".` : 'The column is empty.', `Remove the column "${col.name}"?`, 'Remove');
    if (!ok) return;
    api.removeColumn(col.id, n > 0 ? to?.id : undefined).catch((err: unknown) => toast.error(errMessage(err)));
  };

  const shiftColumn = (col: Column, dir: -1 | 1): void => {
    if (d === null) return;
    const i = d.columns.findIndex((c) => c.id === col.id);
    const to = i + dir;
    if (to < 0 || to >= d.columns.length) return;
    api.moveColumn(col.id, to).catch((err: unknown) => toast.error(errMessage(err)));
  };

  /* ---------------------------------------------------------- render */

  if (live.error !== null && d === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <Empty icon={SquareKanban} title="This board is not here" action={<Button onClick={() => navigate('board')}>Open another board</Button>}>
          It may have been deleted.
        </Empty>
      </div>
    );
  }
  if (d === null) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--kb-muted)]">
        <Spinner size={18} />
      </div>
    );
  }

  const stats = d.board.stats;
  const activeFilters = filters.assignee.length + filters.labels.length + filters.priority.length + filters.state.length;
  const dragCard = drag !== null ? (cards.find((c) => c.id === drag.id) ?? null) : null;
  const agingOf = (col: Column): number => col.aging_days || 3;
  const target = drag?.target ?? null;
  const p0 = ptr.current;
  // A column lights up only when the drop would take the card somewhere new (another column or lane).
  const from = dragCard !== null ? { col: dragCard.column, lane: lanesMode === 'none' ? '' : laneKey(dragCard, lanesMode) } : null;
  const lit = (colId: string, lane = ''): boolean => target !== null && from !== null && target.col === colId && (lanesMode === 'none' || target.lane === lane) && (from.col !== colId || from.lane !== lane);

  const cell = (col: Column, lane: { key: string }, lanes: boolean): React.JSX.Element => {
    const list = byCell.get(col.id + '|' + lane.key) ?? [];
    const here = target !== null && target.col === col.id && target.lane === lane.key;
    let i = 0;
    const placeholder = <div key="ph" aria-hidden className="kb-ph shrink-0 rounded-[var(--kb-radius)]" style={{ height: drag?.h ?? 60 }} />;
    return (
      <div data-drop="1" data-col={col.id} data-lane={lane.key} data-scrolls={lanes ? undefined : '1'} className={cn('flex min-h-[48px] flex-col gap-2 pb-2', !lanes && 'kb-scroll min-h-0 flex-1 overflow-y-auto px-2 pt-0.5')}>
        {list.map((c) => {
          // The card being dragged stays in the page, hidden: a touch keeps sending its moves to
          // the element it started on, and they stop if that element leaves the page.
          const dragging = c.id === drag?.id;
          const idx = dragging ? -1 : i++;
          return (
            <Fragment key={c.id}>
              {!dragging && here && target.index === idx && placeholder}
              <div
                data-card={c.id}
                role="button"
                tabIndex={dragging ? -1 : 0}
                aria-hidden={dragging ? true : undefined}
                aria-label={`${c.key} ${c.title}`}
                onPointerDown={(e) => onCardDown(e, c)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    app.setOpenCard(c.id);
                  }
                }}
                className={cn('kb-focus kb-touch-card cursor-pointer touch-manipulation rounded-[var(--kb-radius)]', dragging && 'hidden')}
              >
                <CardFace card={c} agingDays={agingOf(col)} selected={app.openCard === c.id} />
              </div>
            </Fragment>
          );
        })}
        {here && target.index >= i && placeholder}
        <QuickAdd boardId={d.board.id} column={col} lane={lane.key} lanesMode={lanesMode} />
      </div>
    );
  };

  return (
    <div className="flex h-full min-w-0 flex-col">
      {/* The board's bar. */}
      <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-[var(--kb-line)] px-3 md:px-4">
        <MenuButton />
        <div className="flex min-w-[96px] shrink items-center gap-2">
          <h1 className="truncate text-[15px] font-semibold" title={d.board.description || d.board.name}>
            {d.board.name}
          </h1>
          <span className="kb-num hidden shrink-0 rounded-[4px] bg-[var(--kb-card)] px-1.5 py-px text-[11px] font-semibold text-[var(--kb-muted)] ring-1 ring-inset ring-[var(--kb-hair)] sm:inline">{d.board.key}</span>
          {d.board.frozen && (
            <Chip tone="blue" icon={Snowflake} title="Agents cannot change this board until someone unfreezes it">
              Frozen
            </Chip>
          )}
        </div>
        {stats !== undefined && (
          <div className="hidden shrink-0 items-center gap-3 whitespace-nowrap pl-1 text-[12px] text-[var(--kb-muted)] xl:flex">
            {stats.working > 0 && (
              <span className="inline-flex items-center gap-1.5" title="Cards agents are working on now">
                <span className="kb-pulse size-1.5 rounded-full bg-[var(--kb-green)]" /> {stats.working} working
              </span>
            )}
            {stats.queued > 0 && <span title="Cards waiting for an agent">{stats.queued} queued</span>}
            {stats.needs_people > 0 && (
              <span className="font-medium text-[var(--kb-accent-text)]" title="Questions, reviews, proposals and cards needing attention">
                {stats.needs_people} need people
              </span>
            )}
          </div>
        )}
        <span className="flex-1" />
        {here.length > 0 && (
          <AvatarStack className="hidden pr-1 sm:flex" >
            {here.slice(0, 4).map((p) => (
              <span key={p.id} title={`${p.name} is looking at this board`}>
                <PersonAvatar person={p} size={24} ring online />
              </span>
            ))}
            {here.length > 4 && <span className="kb-num z-[1] inline-flex size-6 items-center justify-center rounded-full bg-[var(--kb-card)] text-[11px] font-semibold text-[var(--kb-ink-2)] ring-2 ring-[var(--kb-main)]">+{here.length - 4}</span>}
          </AvatarStack>
        )}
        <label className="kb-field hidden h-8 w-[220px] min-w-[150px] shrink items-center gap-1.5 px-2 md:flex">
          <Search size={14} aria-hidden className="shrink-0 text-[var(--kb-muted)]" />
          <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search cards" aria-label="Search cards" className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[var(--kb-faint)]" onKeyDown={(e) => e.key === 'Escape' && (setQ(''), (e.target as HTMLInputElement).blur())} />
          {q !== '' && (
            <button type="button" aria-label="Clear search" onClick={() => setQ('')} className="text-[var(--kb-muted)] hover:text-[var(--kb-ink)]">
              <X size={13} aria-hidden />
            </button>
          )}
        </label>
        <Button ref={filterBtn} variant={activeFilters > 0 ? 'default' : 'ghost'} icon={Filter} onClick={() => setFilterOpen((o) => !o)} aria-expanded={filterOpen} aria-label="Filter" className="px-2 sm:px-3">
          <span className="hidden sm:inline">Filter</span>
          {activeFilters > 0 ? <span className="kb-num">{activeFilters}</span> : null}
        </Button>
        <FilterMenu anchor={filterBtn} open={filterOpen} onClose={() => setFilterOpen(false)} d={d} cards={cards} filters={filters} onChange={setFilters} />
        <span title="Swimlanes" className="hidden xl:inline-flex">
          <Segmented
            size="sm"
            label="Swimlanes"
            value={lanesMode}
            onChange={(v) => api.updateBoard(d.board.id, { swimlanes: v }).catch((err: unknown) => toast.error(errMessage(err)))}
            options={[
              { value: 'none', label: <Rows3 size={13} aria-label="No lanes" />, title: 'No swimlanes' },
              { value: 'assignee', label: 'Assignee', title: 'A lane for you, each teammate and agent with cards here, any agent, and unassigned cards' },
              { value: 'priority', label: 'Priority', title: 'A lane per priority' },
            ]}
          />
        </span>
        <IconButton icon={Settings2} label="Board settings" size={32} onClick={() => setSettingsOpen(true)} />
        <Button variant="primary" icon={Plus} onClick={() => app.setCompose({ board: d.board.id })} aria-label="New card" className="px-2 sm:px-3">
          <span className="hidden sm:inline">New card</span>
        </Button>
      </header>
      {stats !== undefined && (stats.working > 0 || stats.queued > 0 || stats.needs_people > 0) && (
        <div className="flex h-8 shrink-0 items-center gap-3 whitespace-nowrap border-b border-[var(--kb-hair)] px-3 text-[12px] text-[var(--kb-muted)] md:px-4 xl:hidden">
          {stats.working > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <span className="kb-pulse size-1.5 rounded-full bg-[var(--kb-green)]" /> {stats.working} working
            </span>
          )}
          {stats.queued > 0 && <span>{stats.queued} queued</span>}
          {stats.needs_people > 0 && <span className="font-medium text-[var(--kb-accent-text)]">{stats.needs_people} need people</span>}
          {here.length > 0 && (
            <AvatarStack className="ml-auto sm:hidden">
              {here.slice(0, 3).map((p) => (
                <PersonAvatar key={p.id} person={p} size={18} ring />
              ))}
            </AvatarStack>
          )}
        </div>
      )}

      {/* The columns. */}
      <div ref={scroller} className={cn('kb-scroll min-h-0 flex-1 overflow-auto', lanesMode === 'none' ? 'kb-snap flex' : 'block')}>
        <Glide landing={landing}>
          {lanesMode === 'none' ? (
            <div className="flex h-full min-w-max gap-3 px-3 pb-3 pt-3 md:px-4">
              {d.columns.map((col) =>
                col.collapsed ? (
                  <CollapsedColumn key={col.id} col={col} count={counts.get(col.id) ?? 0} over={lit(col.id)} onOpen={() => saveColumn(col, { collapsed: false })} />
                ) : (
                  <section key={col.id} aria-label={col.name} className={cn('kb-col kb-snap-col flex h-full w-[min(284px,calc(100vw-56px))] shrink-0 flex-col rounded-[var(--kb-radius-lg)]', lit(col.id) && 'kb-col-over')}>
                    <ColumnHead col={col} count={counts.get(col.id) ?? 0} onSettings={() => setColumnOpen(col.id)} onCollapse={() => saveColumn(col, { collapsed: true })} onShift={(dir) => shiftColumn(col, dir)} onRemove={() => void removeColumn(col)} onAdd={() => app.setCompose({ board: d.board.id, column: col.id })} first={d.columns[0]?.id === col.id} last={d.columns[d.columns.length - 1]?.id === col.id} />
                    {cell(col, { key: '' }, false)}
                  </section>
                ),
              )}
              <AddColumn boardId={d.board.id} />
            </div>
          ) : (
            <div className="min-w-max px-4 pb-6">
              <div className="sticky top-0 z-10 flex gap-3 bg-[var(--kb-main)] pb-1 pt-3">
                {d.columns.map((col) => (
                  <div key={col.id} className={cn('kb-col shrink-0 rounded-[var(--kb-radius)]', col.collapsed ? 'w-[44px]' : 'w-[284px]')}>
                    {col.collapsed ? <CollapsedHead col={col} onOpen={() => saveColumn(col, { collapsed: false })} /> : <ColumnHead col={col} count={counts.get(col.id) ?? 0} onSettings={() => setColumnOpen(col.id)} onCollapse={() => saveColumn(col, { collapsed: true })} onShift={(dir) => shiftColumn(col, dir)} onRemove={() => void removeColumn(col)} onAdd={() => app.setCompose({ board: d.board.id, column: col.id })} first={d.columns[0]?.id === col.id} last={d.columns[d.columns.length - 1]?.id === col.id} />}
                  </div>
                ))}
              </div>
              {lanes.map((lane) => {
                const n = d.columns.reduce((s, col) => s + (byCell.get(col.id + '|' + lane.key)?.length ?? 0), 0);
                return (
                  <div key={lane.key} className="mt-3">
                    <div className="sticky left-4 z-[5] mb-2 flex h-7 w-max items-center gap-2 pr-2 text-[12.5px] font-semibold">
                      {lanesMode === 'assignee' && lane.party !== null && <PartyAvatar party={lane.party} size={18} />}
                      {lanesMode === 'assignee' && lane.key === 'none' && <UserX size={14} aria-hidden className="text-[var(--kb-muted)]" />}
                      {lanesMode === 'priority' && <PriorityIcon priority={Number(lane.key)} size={13} />}
                      <span>{lane.label}</span>
                      <span className="kb-num font-normal text-[var(--kb-muted)]">{n}</span>
                    </div>
                    <div className="flex gap-3">
                      {d.columns.map((col) => (
                        <div key={col.id} className={cn('shrink-0 rounded-[var(--kb-radius)] px-2 pt-2', col.collapsed ? 'w-[44px] bg-transparent' : 'kb-col w-[284px]', !col.collapsed && lit(col.id, lane.key) && 'kb-col-over')}>
                          {!col.collapsed && cell(col, lane, true)}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Glide>
      </div>

      {/* The card under the pointer: lifted, tilting with the pointer, moved every frame. */}
      {drag !== null && dragCard !== null && (
        <div
          ref={ghost}
          className="pointer-events-none fixed left-0 top-0 z-[90]"
          style={{ width: drag.w, transformOrigin: p0 !== null ? `${p0.dx}px ${p0.dy}px` : undefined, transform: p0 !== null ? `translate3d(${p0.x - p0.dx}px, ${p0.y - p0.dy}px, 0) rotate(${p0.tilt.toFixed(2)}deg)` : undefined }}
        >
          <div className="kb-ghost-lift">
            <CardFace card={dragCard} agingDays={3} ghost />
          </div>
        </div>
      )}

      {columnOpen !== null && d.columns.some((c) => c.id === columnOpen) && <ColumnSettings d={d} column={d.columns.find((c) => c.id === columnOpen)!} onClose={() => setColumnOpen(null)} />}
      {settingsOpen && <BoardSettings d={d} onClose={() => setSettingsOpen(false)} onOpenColumn={(cid) => setColumnOpen(cid)} />}
      {confirmEl}
    </div>
  );
}

/* ------------------------------------------------------------- pieces */

function ColumnHead({ col, count, onSettings, onCollapse, onShift, onRemove, onAdd, first, last }: { col: Column; count: number; onSettings: () => void; onCollapse: () => void; onShift: (dir: -1 | 1) => void; onRemove: () => void; onAdd: () => void; first: boolean; last: boolean }): React.JSX.Element {
  const [menu, setMenu] = useState(false);
  const btn = useRef<HTMLButtonElement | null>(null);
  const over = col.wip > 0 && count > col.wip;
  const full = col.wip > 0 && count >= col.wip;
  const gates = [col.plan_first && 'plan first', col.need_criteria && 'needs criteria', col.need_checklist && 'checklist done'].filter(Boolean).join(' · ');
  return (
    <div className="flex flex-col gap-1 px-2.5 pb-1.5 pt-2.5">
      <div className="flex h-6 items-center gap-2">
        <span title={CATEGORY_HINT[col.category]} className="flex">
          <CategoryIcon category={col.category} />
        </span>
        <button type="button" onClick={onSettings} className="kb-focus min-w-0 truncate rounded-sm text-left text-[13px] font-semibold hover:underline" title={col.policy || 'Column settings'}>
          {col.name}
        </button>
        <span className={cn('kb-num rounded-full px-1.5 text-[12px] font-medium', over ? 'bg-[var(--kb-red-soft)] font-semibold text-[var(--kb-red)]' : full ? 'bg-[var(--kb-amber-soft)] text-[var(--kb-amber)]' : 'bg-[var(--kb-main)] text-[var(--kb-ink-2)]')} title={col.wip > 0 ? `WIP limit ${col.wip}: binding for agents, a warning for people` : undefined}>
          {count}
          {col.wip > 0 ? `/${col.wip}` : ''}
        </span>
        <span className="flex-1" />
        <IconButton icon={Plus} label={`Add a card to ${col.name}`} size={24} onClick={onAdd} />
        <IconButton ref={btn} icon={MoreHorizontal} label="Column menu" size={24} onClick={() => setMenu((m) => !m)} />
        <Popover anchor={btn} open={menu} onClose={() => setMenu(false)} align="end" width={210}>
          <MenuItem icon={Settings2} onClick={() => (setMenu(false), onSettings())}>
            Column settings
          </MenuItem>
          <MenuItem icon={ChevronsLeftRight} onClick={() => (setMenu(false), onCollapse())}>
            Collapse
          </MenuItem>
          <MenuItem icon={ArrowLeft} disabled={first} onClick={() => (setMenu(false), onShift(-1))}>
            Move left
          </MenuItem>
          <MenuItem icon={ArrowRight} disabled={last} onClick={() => (setMenu(false), onShift(1))}>
            Move right
          </MenuItem>
          <MenuSep />
          <MenuItem icon={Trash2} danger onClick={() => (setMenu(false), onRemove())}>
            Remove column
          </MenuItem>
        </Popover>
      </div>
      {(col.agent_mode !== 'off' || gates !== '') && (
        <div className="flex flex-wrap items-center gap-1">
          {col.agent_mode !== 'off' && (
            <button type="button" onClick={onSettings} className="inline-flex h-5 max-w-full items-center gap-1 rounded-full bg-[var(--kb-main)] pl-0.5 pr-1.5 text-[11.5px] font-medium text-[var(--kb-ink-2)] ring-1 ring-inset ring-[var(--kb-col-line)]" title={col.agent_mode === 'one' ? `Every card entering ${col.name} goes to ${col.agent?.name ?? 'its agent'}` : `Every card entering ${col.name} is queued for the first free agent`}>
              {col.agent_mode === 'one' ? <AgentAvatar agent={col.agent} size={16} /> : <PoolAvatar size={16} />}
              <span className="truncate">{col.agent_mode === 'one' ? `${col.agent?.name ?? 'An agent'} works here` : 'Any agent works here'}</span>
            </button>
          )}
          {gates !== '' && (
            <span className="text-[11.5px] text-[var(--kb-muted)]" title="Gates agents pass here">
              {gates}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function CollapsedHead({ col, onOpen }: { col: Column; onOpen: () => void }): React.JSX.Element {
  return (
    <button type="button" onClick={onOpen} title={`Expand ${col.name}`} className="flex h-9 w-full items-center justify-center">
      <CategoryIcon category={col.category} />
    </button>
  );
}

function CollapsedColumn({ col, count, over, onOpen }: { col: Column; count: number; over: boolean; onOpen: () => void }): React.JSX.Element {
  return (
    <button type="button" onClick={onOpen} title={`Expand ${col.name}`} data-drop="1" data-col={col.id} data-lane="" className={cn('kb-col kb-focus flex h-full w-[44px] shrink-0 flex-col items-center gap-2 rounded-[var(--kb-radius-lg)] py-3 hover:bg-[var(--kb-col-over)]', over && 'kb-col-over')}>
      <CategoryIcon category={col.category} />
      <span className="kb-num text-[12px] text-[var(--kb-muted)]">{count}</span>
      <span className="text-[12.5px] font-semibold [writing-mode:vertical-rl]">{col.name}</span>
    </button>
  );
}

function QuickAdd({ boardId, column, lane, lanesMode }: { boardId: string; column: Column; lane: string; lanesMode: string }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const add = async (): Promise<void> => {
    const title = text.trim();
    if (title === '') return;
    setBusy(true);
    try {
      const extra: { assignee?: string; priority?: number } = {};
      if (lanesMode === 'assignee' && lane !== '') extra.assignee = lane === 'none' ? '' : lane;
      if (lanesMode === 'priority' && lane !== '') extra.priority = Number(lane);
      const r = await api.addCard({ board: boardId, column: column.id, title, position: 'bottom', ...extra, assignee: extra.assignee === '' ? undefined : extra.assignee });
      setText('');
      if (r.card.agent_state === 'queued') toast.info(`${r.card.key} is queued for ${queuedFor(r.card)}`);
      if (r.card.agent_state === 'needs_input') toast.info(`${r.card.key} needs acceptance criteria before an agent can start`);
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="kb-focus flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--kb-radius-sm)] px-2 text-[12.5px] text-[var(--kb-muted)] transition-colors hover:bg-[var(--kb-col-over)] hover:text-[var(--kb-ink)]">
        <Plus size={14} aria-hidden /> Add card
      </button>
    );
  return (
    <div className="kb-in shrink-0 rounded-[var(--kb-radius)] border border-[var(--kb-line)] bg-[var(--kb-main)] p-1.5 shadow-[var(--kb-shadow)]">
      <Textarea
        autoFocus
        aria-label="Card title"
        value={text}
        minRows={2}
        placeholder="What needs doing? Enter to add"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void add();
          } else if (e.key === 'Escape') {
            setOpen(false);
            setText('');
          }
        }}
        className="border-0 shadow-none focus:shadow-none"
      />
      <div className="flex items-center gap-1 px-1 pt-1">
        <Button size="sm" variant="primary" busy={busy} onClick={() => void add()} disabled={text.trim() === ''}>
          Add
        </Button>
        <Button size="sm" variant="ghost" onClick={() => (setOpen(false), setText(''))}>
          Cancel
        </Button>
        {column.agent_mode !== 'off' && (
          <span className="ml-auto inline-flex min-w-0 items-center gap-1 text-[11.5px] text-[var(--kb-muted)]" title="Cards added here are queued for agents">
            {column.agent_mode === 'one' ? <AgentAvatar agent={column.agent} size={14} /> : <PoolAvatar size={14} />}
            <span className="truncate">goes to {column.agent_mode === 'one' ? (column.agent?.name ?? 'its agent') : 'any agent'}</span>
          </span>
        )}
      </div>
    </div>
  );
}

function AddColumn({ boardId }: { boardId: string }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const add = (): void => {
    const n = name.trim();
    if (n === '') return;
    api
      .addColumn(boardId, { name: n, category: 'todo' })
      .then(() => {
        setName('');
        setOpen(false);
      })
      .catch((err: unknown) => toast.error(errMessage(err)));
  };
  return (
    <div className="w-[240px] shrink-0 pr-4">
      {open ? (
        <div className="kb-col kb-in flex flex-col gap-1.5 rounded-[var(--kb-radius-lg)] p-2">
          <input autoFocus aria-label="Column name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Column name" onKeyDown={(e) => (e.key === 'Enter' ? add() : e.key === 'Escape' ? setOpen(false) : undefined)} className="kb-field h-8 px-2.5 text-[13px]" />
          <div className="flex gap-1">
            <Button size="sm" variant="primary" onClick={add}>
              Add column
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="kb-focus flex h-10 w-full items-center gap-1.5 rounded-[var(--kb-radius-lg)] border border-dashed border-[var(--kb-line)] px-3 text-[13px] text-[var(--kb-muted)] transition-colors hover:border-[var(--kb-col-line)] hover:bg-[var(--kb-col)] hover:text-[var(--kb-ink)]">
          <Plus size={14} aria-hidden /> Add column
        </button>
      )}
    </div>
  );
}

function FilterMenu({ anchor, open, onClose, d, cards, filters, onChange }: { anchor: React.RefObject<HTMLButtonElement | null>; open: boolean; onClose: () => void; d: BoardDetail; cards: Card[]; filters: Filters; onChange: (f: Filters) => void }): React.JSX.Element {
  const app = useApp();
  const toggle = <K extends keyof Filters>(k: K, v: Filters[K][number]): void => {
    const cur = filters[k] as (typeof v)[];
    onChange({ ...filters, [k]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] });
  };
  const STATES: { key: string; label: string }[] = [
    { key: 'working', label: 'An agent is working' },
    { key: 'queued', label: 'Queued for agents' },
    { key: 'needs_input', label: 'Waiting on people' },
    { key: 'needs_attention', label: 'Needs attention' },
    { key: 'review', label: 'In review' },
    { key: 'blocked', label: 'Blocked' },
  ];
  // Everyone the cards here are with, you first.
  const meKey = app.me ? 'user:' + app.me.id : '';
  const parties = new Map<string, Party>();
  if (app.me !== null) parties.set(meKey, { kind: 'person', id: app.me.id, name: app.me.name, tone: app.me.tone });
  for (const c of cards) if (c.assignee !== null) parties.set(assigneeKey(c.assignee), c.assignee);
  return (
    <Popover anchor={anchor} open={open} onClose={onClose} align="end" width={260}>
      <MenuLabel>Assignee</MenuLabel>
      {[...parties.entries()].map(([k, party]) => (
        <MenuItem key={k} selected={filters.assignee.includes(k)} onClick={() => toggle('assignee', k)}>
          <span className="inline-flex items-center gap-2">
            <PartyAvatar party={party} size={16} /> {partyName(party, app.me?.id)}
          </span>
        </MenuItem>
      ))}
      <MenuItem icon={UserX} selected={filters.assignee.includes('none')} onClick={() => toggle('assignee', 'none')}>
        Unassigned
      </MenuItem>
      <MenuSep />
      <MenuLabel>Agent state</MenuLabel>
      {STATES.map((s) => (
        <MenuItem key={s.key} selected={filters.state.includes(s.key)} onClick={() => toggle('state', s.key)}>
          {s.label}
        </MenuItem>
      ))}
      <MenuSep />
      <MenuLabel>Priority</MenuLabel>
      {[1, 2, 3, 4, 0].map((p) => (
        <MenuItem key={p} selected={filters.priority.includes(p)} onClick={() => toggle('priority', p)}>
          <span className="inline-flex items-center gap-2">
            <PriorityIcon priority={p} size={13} /> {PRIORITY_LABEL[p]}
          </span>
        </MenuItem>
      ))}
      {d.labels.length > 0 && (
        <>
          <MenuSep />
          <MenuLabel>Labels</MenuLabel>
          {d.labels.map((l) => (
            <MenuItem key={l.id} selected={filters.labels.includes(l.id)} onClick={() => toggle('labels', l.id)}>
              <span className="inline-flex items-center gap-2">
                <LabelDot color={l.color} /> {l.name}
              </span>
            </MenuItem>
          ))}
        </>
      )}
      <MenuSep />
      <MenuItem icon={X} onClick={() => onChange(NO_FILTERS)}>
        Clear filters
      </MenuItem>
    </Popover>
  );
}
