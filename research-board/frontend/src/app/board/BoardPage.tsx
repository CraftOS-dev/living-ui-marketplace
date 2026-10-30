/**
 * A board: the canvas of cards and links.
 *
 *   Add       the palette (click: in view; drag: where it should go), the
 *             toolbar's Add, a double click on empty space (a note), files
 *             dropped from the computer, or paste (an image, an address,
 *             text).
 *   Move      drag cards (selected ones move together; a section carries the
 *             cards inside it); drag the corner to resize; arrow keys nudge.
 *   Link      drag a card's top dot onto another card, then pick the kind.
 *   Select    click; Shift and click to add; Shift and drag for an area;
 *             Ctrl+A for all. Delete moves them to the trash (Undo).
 *   Look      drag empty space to pan, the wheel or a pinch to zoom, F to
 *             fit, the minimap to jump; Find dims what does not match.
 *
 * The right panel shows the selected card, link or selection, or the AI
 * agent's review of the board.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, CloudUpload, Copy, Download, FileText, Filter, LayoutGrid, PanelLeft, Plus, Search, StickyNote, Trash2 } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { useAdd } from '../components/AddCard.tsx';
import { BoardForm } from '../components/BoardForm.tsx';
import { CardPanel } from '../components/CardPanel.tsx';
import { useSidebar } from '../components/Sidebar.tsx';
import { CircleButton, Empty, MoreMenu, PillButton, Popover, StatusPill, useConfirm } from '../components/ui.tsx';
import { api, download, errMessage } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { KIND_LIST, LINK, LINK_LIST, isWebUrl, kindForFile, linkColor } from '../lib/kinds.ts';
import { useLive } from '../lib/live.ts';
import { navigate, rememberBoard } from '../lib/router.ts';
import type { BoardData, Card, Kind, Link, LinkKind } from '../lib/types.ts';
import { anyVisible, bounds, gridStyle, inside, intersects, linkPath, LinkMarkers, linkStroke, useCanvas, ZoomControls } from './canvas.tsx';
import type { Box } from './canvas.tsx';
import { CardView } from './CardView.tsx';
import type { CardActions } from './CardView.tsx';
import { DRAG_KIND, Legend, MiniMap, Tools, UndoBar } from './Overlays.tsx';
import { LinkPanel, SelectionPanel } from './Panels.tsx';
import { AskReview, ReviewPanel } from './Review.tsx';

const PANEL_W = 360;

export function BoardPage({ id, focus }: { id: string; focus: string }): React.JSX.Element {
  const data = useLive(() => api.board(id), ['boards', 'cards', 'links'], [id]);
  useEffect(() => rememberBoard(id), [id]);
  if (data.data === null && data.error !== null) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Empty icon={LayoutGrid} title="This board is not here">
          It may have been deleted. Pick another board in the sidebar.
        </Empty>
      </div>
    );
  }
  if (data.data === null) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex h-12 items-center gap-3 border-b border-[var(--rb-line)] px-3">
          <span className="rb-skeleton h-4 w-40 rounded-[4px]" />
        </div>
        <div className="rb-canvas flex-1" style={{ backgroundSize: '24px 24px' }} />
      </div>
    );
  }
  return <BoardCanvas d={data.data} focus={focus} />;
}

interface Draft {
  from: string;
  x: number;
  y: number;
}

function searchable(c: Card): string {
  return [c.title, c.body, c.source, c.url, c.digest, c.meta.site ?? '', c.meta.description ?? '', c.meta.author ?? '', c.tags.join(' ')].join(' ').toLowerCase();
}

function BoardCanvas({ d, focus }: { d: BoardData; focus: string }): React.JSX.Element {
  const board = d.board;
  const add = useAdd();
  const c = useCanvas(board.viewport);
  const [confirmEl, confirm] = useConfirm();
  const frameRef = useRef<HTMLDivElement | null>(null);

  const [sel, setSel] = useState<Set<string>>(new Set());
  const [selLink, setSelLink] = useState('');
  const [inspect, setInspect] = useState('');
  // The review opens from the toolbar, or by itself when it finishes while the board is open.
  const [showReview, setShowReview] = useState(false);
  const [editing, setEditing] = useState('');
  const [local, setLocal] = useState<Record<string, Partial<Box>>>({});
  const pending = useRef(new Set<string>());
  const [dragging, setDragging] = useState<Set<string>>(new Set());
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pick, setPick] = useState<{ from: string; to: string; sx: number; sy: number } | null>(null);
  const [hoverLink, setHoverLink] = useState('');
  const [hidden, setHidden] = useState<Set<Kind>>(new Set());
  const [q, setQ] = useState('');
  const [hitIndex, setHitIndex] = useState(0);
  const [undo, setUndo] = useState<{ ids: string[]; n: number } | null>(null);
  const [busy, setBusy] = useState<string>('');
  const [dropping, setDropping] = useState(false);
  const [editBoard, setEditBoard] = useState(false);
  const [view, setView] = useState({ w: 1000, h: 700 });
  const findRef = useRef<HTMLInputElement | null>(null);
  const lastText = useRef<Record<string, { title: string; body: string }>>({});
  const allTags = useLive(() => api.tags(), ['cards'], []);

  /* ------------------------------------------------------------ data */

  // Optimistic positions stay only while their move is on its way.
  useEffect(() => {
    setLocal((l) => {
      const next: Record<string, Partial<Box>> = {};
      for (const [id, b] of Object.entries(l)) if (pending.current.has(id)) next[id] = b;
      return next;
    });
  }, [d]);

  const cards = d.cards;
  const byId = useMemo(() => new Map(cards.map((x) => [x.id, x])), [cards]);
  const boxOf = useCallback((x: Card): Box => ({ x: local[x.id]?.x ?? x.x, y: local[x.id]?.y ?? x.y, w: local[x.id]?.w ?? x.w, h: local[x.id]?.h ?? x.h }), [local]);
  const boxMap = useMemo(() => new Map(cards.map((x) => [x.id, boxOf(x)])), [cards, boxOf]);
  const visible = useMemo(() => cards.filter((x) => !hidden.has(x.kind)), [cards, hidden]);
  const visibleIds = useMemo(() => new Set(visible.map((x) => x.id)), [visible]);
  const links = useMemo(() => d.links.filter((l) => visibleIds.has(l.source) && visibleIds.has(l.target)), [d.links, visibleIds]);
  const counts = useMemo(() => {
    const m: Partial<Record<Kind, number>> = {};
    for (const x of cards) m[x.kind] = (m[x.kind] ?? 0) + 1;
    return m;
  }, [cards]);
  const proposedCount = d.links.filter((l) => l.status === 'proposed').length;

  // Cards and links that just arrived get an entrance.
  const known = useRef<{ cards: Set<string>; links: Set<string> } | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    const ids = new Set(cards.map((x) => x.id));
    const lids = new Set(d.links.map((l) => l.id));
    if (known.current !== null) {
      const added = [...ids, ...lids].filter((i) => !known.current?.cards.has(i) && !known.current?.links.has(i));
      if (added.length > 0) {
        setFresh(new Set(added));
        const t = setTimeout(() => setFresh(new Set()), 900);
        known.current = { cards: ids, links: lids };
        return () => clearTimeout(t);
      }
    }
    known.current = { cards: ids, links: lids };
    return undefined;
  }, [cards, d.links]);

  // A review that just finished opens itself.
  const lastReview = useRef(board.review_state);
  useEffect(() => {
    if (lastReview.current !== board.review_state && (board.review_state === 'done' || board.review_state === 'failed')) setShowReview(true);
    lastReview.current = board.review_state;
  }, [board.review_state]);

  // Selections drop cards and links that are gone, but not ones just made
  // here that the live reload has not delivered yet.
  const expected = useRef(new Map<string, number>());
  const expect = (ids: string[]): void => {
    const until = Date.now() + 6000;
    for (const i of ids) expected.current.set(i, until);
  };
  useEffect(() => {
    const linkIds = new Set(d.links.map((l) => l.id));
    const now = Date.now();
    for (const [i, until] of expected.current) if (byId.has(i) || linkIds.has(i) || until < now) expected.current.delete(i);
    const keep = (i: string): boolean => byId.has(i) || expected.current.has(i);
    setSel((s) => ([...s].every(keep) ? s : new Set([...s].filter(keep))));
    if (inspect !== '' && !keep(inspect)) setInspect('');
    if (selLink !== '' && !linkIds.has(selLink) && !expected.current.has(selLink)) setSelLink('');
  }, [byId, d.links, inspect, selLink]);

  /* ------------------------------------------------------------ view */

  useEffect(() => {
    const el = c.ref.current;
    if (el === null) return;
    const ro = new ResizeObserver(() => setView({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [c.ref]);

  const panelOpenRef = useRef(false);
  const fitAll = useCallback(
    (animate = true) => {
      const b = bounds(visible.map(boxOf));
      c.fit(b, 1, animate);
    },
    [c, visible, boxOf],
  );

  const fitted = useRef(board.viewport !== null);
  const refit = useRef(false);
  useEffect(() => {
    if (cards.length === 0 || focus !== '') return;
    const el = c.ref.current;
    if (!fitted.current) {
      fitted.current = true;
      requestAnimationFrame(() => fitAll(false));
      return;
    }
    if (!refit.current && el !== null && el.clientWidth > 0 && !anyVisible(cards.map(boxOf), c.vp, el.clientWidth, el.clientHeight)) {
      refit.current = true;
      requestAnimationFrame(() => fitAll(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards.length]);

  const panelOpen = inspect !== '' || selLink !== '' || sel.size > 1 || showReview;
  panelOpenRef.current = panelOpen;
  const centerCard = useCallback(
    (card: Card, zoom?: number) => {
      const b = boxMap.get(card.id) ?? card;
      const z = zoom ?? Math.max(c.vp.zoom, 0.85);
      c.centerOn(b.x + b.w / 2, b.y + b.h / 2, z);
    },
    [boxMap, c],
  );

  // A card asked for in the address (from Home, the Library or a link).
  const focused = useRef('');
  useEffect(() => {
    if (focus === '' || focus === focused.current) return;
    const card = byId.get(focus);
    if (card === undefined) return;
    focused.current = focus;
    fitted.current = true;
    refit.current = true;
    setSel(new Set([focus]));
    setSelLink('');
    setInspect(focus);
    requestAnimationFrame(() => centerCard(card, 1));
  }, [focus, byId, centerCard]);

  // Remember the view.
  const vpKey = `${Math.round(c.vp.x)}:${Math.round(c.vp.y)}:${c.vp.zoom.toFixed(3)}`;
  useEffect(() => {
    const t = setTimeout(() => void api.updateBoard(board.id, { viewport: { x: Math.round(c.vp.x), y: Math.round(c.vp.y), zoom: Math.round(c.vp.zoom * 1000) / 1000 } }, true).catch(() => undefined), 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vpKey, board.id]);

  /* ------------------------------------------------------------ find */

  const query = q.trim().toLowerCase();
  const matches = useMemo(() => (query.length >= 2 ? new Set(visible.filter((x) => searchable(x).includes(query)).map((x) => x.id)) : null), [visible, query]);
  const hitList = useMemo(() => (matches === null ? [] : visible.filter((x) => matches.has(x.id)).sort((a, b) => a.y - b.y || a.x - b.x)), [matches, visible]);
  const goHit = (step: number): void => {
    if (hitList.length === 0) return;
    const i = (((hitIndex + step) % hitList.length) + hitList.length) % hitList.length;
    setHitIndex(i);
    const card = hitList[i] as Card;
    setSel(new Set([card.id]));
    setInspect(card.id);
    setSelLink('');
    centerCard(card);
  };

  /* --------------------------------------------------------- actions */

  const clearSelection = (): void => {
    setSel(new Set());
    setSelLink('');
    setInspect('');
    setEditing('');
    setPick(null);
  };

  const commitMove = (positions: { card: string; x?: number; y?: number; w?: number; h?: number }[], front = false): void => {
    for (const p of positions) pending.current.add(p.card);
    void api
      .moveCards(positions, front)
      .then(() => {
        for (const p of positions) pending.current.delete(p.card);
      })
      .catch((err: unknown) => {
        for (const p of positions) pending.current.delete(p.card);
        setLocal({});
        toast.error(errMessage(err));
      });
  };

  const removeCards = async (ids: string[]): Promise<void> => {
    if (ids.length === 0) return;
    try {
      await api.deleteCards(ids);
      setUndo((u) => ({ ids, n: (u?.n ?? 0) + 1 }));
      setSel(new Set());
      if (ids.includes(inspect)) setInspect('');
    } catch {
      /* toasted */
    }
  };

  const restore = async (): Promise<void> => {
    if (undo === null) return;
    const ids = undo.ids;
    setUndo(null);
    try {
      await api.restoreCards(ids);
      setSel(new Set(ids));
    } catch {
      /* toasted */
    }
  };

  const duplicate = async (ids: string[]): Promise<void> => {
    if (ids.length === 0) return;
    try {
      const r = await api.duplicateCards(ids);
      expect(r.ids);
      setSel(new Set(r.ids));
      setInspect(r.ids.length === 1 ? (r.ids[0] ?? '') : '');
    } catch {
      /* toasted */
    }
  };

  /** A note to write in: exactly where asked (double click), or at the free spot nearest the point. */
  const newNote = async (at: { x: number; y: number }, exact = false): Promise<void> => {
    try {
      const spot = exact ? { x: Math.round(at.x - 120), y: Math.round(at.y - 50) } : { near_x: Math.round(at.x - 120), near_y: Math.round(at.y - 80) };
      const r = await api.addCard({ board: board.id, kind: 'note', ...spot });
      expect([r.card.id]);
      setSel(new Set([r.card.id]));
      setInspect('');
      setSelLink('');
      setEditing(r.card.id);
    } catch {
      /* toasted */
    }
  };

  const newSection = async (around: Card[] | null, at?: { x: number; y: number }): Promise<void> => {
    const content = (around ?? []).filter((x) => x.kind !== 'section');
    const b = bounds(content.map(boxOf));
    const p = at ?? c.center();
    const box = b !== null ? { x: b.x - 32, y: b.y - 64, w: b.w + 64, h: b.h + 96 } : { x: p.x - 280, y: p.y - 190, w: 560, h: 380 };
    try {
      const r = await api.addCard({ board: board.id, kind: 'section', title: 'Section', x: Math.round(box.x), y: Math.round(box.y), w: Math.round(Math.max(240, box.w)), h: Math.round(Math.max(160, box.h)) });
      expect([r.card.id]);
      setSel(new Set([r.card.id]));
      setInspect('');
      setEditing(r.card.id);
    } catch {
      /* toasted */
    }
  };

  const tidy = (ids: string[]): void => {
    const items = ids
      .map((i) => byId.get(i))
      .filter((x): x is Card => x !== undefined && x.kind !== 'section')
      .map((x) => ({ card: x, b: boxOf(x) }))
      .sort((a, b) => a.b.y - b.b.y || a.b.x - b.b.x);
    if (items.length < 2) return;
    const cols = Math.ceil(Math.sqrt(items.length));
    const x0 = Math.min(...items.map((i) => i.b.x));
    let y = Math.min(...items.map((i) => i.b.y));
    const positions: { card: string; x: number; y: number }[] = [];
    for (let r = 0; r < items.length; r += cols) {
      const row = items.slice(r, r + cols);
      let x = x0;
      for (const it of row) {
        positions.push({ card: it.card.id, x: Math.round(x), y: Math.round(y) });
        x += it.b.w + 40;
      }
      y += Math.max(...row.map((it) => it.b.h)) + 40;
    }
    setLocal((l) => {
      const n = { ...l };
      for (const p of positions) n[p.card] = { ...n[p.card], x: p.x, y: p.y };
      return n;
    });
    commitMove(positions);
  };

  const uploadFiles = async (files: File[], at: { x: number; y: number }): Promise<void> => {
    const ok = files.filter((f) => {
      if (f.size > 200 * 1024 * 1024) {
        toast.error(`${f.name} is over 200 MB`);
        return false;
      }
      return true;
    });
    let done = 0;
    for (const [i, f] of ok.entries()) {
      setBusy(ok.length === 1 ? `Uploading ${f.name}` : `Uploading ${i + 1} of ${ok.length}`);
      try {
        await api.addFile({ board: board.id, kind: kindForFile(f.name), x: Math.round(at.x - 130 + i * 36), y: Math.round(at.y - 110 + i * 36) }, f);
        done++;
      } catch {
        /* toasted */
      }
    }
    setBusy('');
    if (done > 1) toast.success(`Added ${done} files`);
  };

  const addUrl = async (url: string, at: { x: number; y: number }): Promise<void> => {
    setBusy('Adding the link');
    try {
      const r = await api.addCard({ board: board.id, url, near_x: Math.round(at.x - 130), near_y: Math.round(at.y - 110) });
      expect([r.card.id]);
      setSel(new Set([r.card.id]));
    } catch {
      /* toasted */
    } finally {
      setBusy('');
    }
  };

  const fromPalette = (kind: Kind, at?: { x: number; y: number }): void => {
    const p = at ?? c.center();
    if (kind === 'note') void newNote(p, at !== undefined);
    else if (kind === 'section') void newSection(at === undefined && sel.size > 0 ? [...sel].map((i) => byId.get(i)).filter((x): x is Card => x !== undefined) : null, at);
    else
      add.open({
        board: board.id,
        kind,
        at: { x: p.x - 130, y: p.y - 110 },
        onAdded: (card) => {
          expect([card.id]);
          setSel(new Set([card.id]));
          setInspect('');
        },
      });
  };

  const makeLink = async (from: string, to: string, kind: LinkKind): Promise<void> => {
    setPick(null);
    try {
      const r = await api.addLink({ source: from, target: to, kind });
      expect([r.link.id]);
      if (r.existed) toast.info('These two cards are already linked');
      setSel(new Set());
      setInspect('');
      setSelLink(r.link.id);
    } catch {
      /* toasted */
    }
  };

  const exportMarkdown = async (): Promise<void> => {
    try {
      const r = await api.exportBoard(board.id);
      download(r.filename, r.content);
    } catch {
      /* toasted */
    }
  };

  const duplicateBoard = async (): Promise<void> => {
    try {
      const r = await api.duplicateBoard(board.id);
      toast.success('Board duplicated');
      navigate('board', { id: r.board.id });
    } catch {
      /* toasted */
    }
  };

  const deleteBoard = async (): Promise<void> => {
    if (!(await confirm(`"${board.name}" and its ${board.cards} ${board.cards === 1 ? 'card' : 'cards'} will be deleted for good.`, 'Delete this board?', 'Delete board'))) return;
    try {
      await api.deleteBoard(board.id);
      toast.success('Board deleted');
      navigate('board', {});
    } catch {
      /* toasted */
    }
  };

  /* ------------------------------------------------------- gestures */

  const handlers = useRef<CardActions | null>(null);
  handlers.current = {
    pointerDown: (e, card) => {
      if (e.button !== 0 || editing === card.id) return;
      e.stopPropagation();
      frameRef.current?.focus({ preventScroll: true });
      // Shift and drag inside a section selects an area, as on empty space.
      if (card.kind === 'section' && e.shiftKey) {
        e.preventDefault();
        startMarquee(e);
        return;
      }
      const additive = e.shiftKey || e.metaKey || e.ctrlKey;
      const start = c.toWorld(e.clientX, e.clientY);
      const zoom = c.vp.zoom;
      let group = sel.has(card.id) && !additive ? visible.filter((x) => sel.has(x.id)) : [card];
      // A section carries the cards inside it.
      for (const s of group.filter((g) => g.kind === 'section')) {
        const sb = boxOf(s);
        for (const x of visible) if (x.id !== s.id && x.kind !== 'section' && !group.includes(x) && inside(boxOf(x), sb)) group = [...group, x];
      }
      const origin = new Map(group.map((g) => [g.id, boxOf(g)]));
      let moved = false;
      const onMove = (ev: PointerEvent): void => {
        const p = c.toWorld(ev.clientX, ev.clientY);
        if (!moved && Math.hypot(p.x - start.x, p.y - start.y) * zoom < 4) return;
        if (!moved) {
          moved = true;
          setDragging(new Set(group.map((g) => g.id)));
        }
        const dx = Math.round(p.x - start.x);
        const dy = Math.round(p.y - start.y);
        setLocal((l) => {
          const n = { ...l };
          for (const g of group) {
            const o = origin.get(g.id) as Box;
            n[g.id] = { ...n[g.id], x: o.x + dx, y: o.y + dy };
          }
          return n;
        });
      };
      const onUp = (ev: PointerEvent): void => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        setDragging(new Set());
        if (!moved) {
          setSelLink('');
          if (additive) {
            setSel((s) => {
              const n = new Set(s);
              if (n.has(card.id)) n.delete(card.id);
              else n.add(card.id);
              return n;
            });
            setInspect('');
          } else {
            setSel(new Set([card.id]));
            setInspect(card.id);
          }
          return;
        }
        const p = c.toWorld(ev.clientX, ev.clientY);
        const dx = Math.round(p.x - start.x);
        const dy = Math.round(p.y - start.y);
        commitMove(
          group.map((g) => {
            const o = origin.get(g.id) as Box;
            return { card: g.id, x: o.x + dx, y: o.y + dy };
          }),
          true,
        );
        if (!sel.has(card.id)) {
          setSel(new Set([card.id]));
          if (inspect !== card.id) setInspect('');
        }
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    resizeStart: (e, card) => {
      e.stopPropagation();
      e.preventDefault();
      const start = c.toWorld(e.clientX, e.clientY);
      const b0 = boxOf(card);
      const min = card.kind === 'section' ? { w: 240, h: 160 } : { w: 160, h: 90 };
      const size = (ev: PointerEvent): { w: number; h: number } => {
        const p = c.toWorld(ev.clientX, ev.clientY);
        return { w: Math.round(Math.max(min.w, b0.w + p.x - start.x)), h: Math.round(Math.max(min.h, b0.h + p.y - start.y)) };
      };
      setDragging(new Set([card.id]));
      const onMove = (ev: PointerEvent): void => setLocal((l) => ({ ...l, [card.id]: { ...l[card.id], ...size(ev) } }));
      const onUp = (ev: PointerEvent): void => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        setDragging(new Set());
        commitMove([{ card: card.id, ...size(ev) }]);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    linkStart: (e, card) => {
      e.stopPropagation();
      e.preventDefault();
      const target = (ev: PointerEvent): string => {
        const el = document.elementsFromPoint(ev.clientX, ev.clientY).find((x) => x.hasAttribute('data-card') && !x.hasAttribute('data-section'));
        const id = el?.getAttribute('data-card') ?? '';
        return id === card.id ? '' : id;
      };
      const onMove = (ev: PointerEvent): void => {
        const p = c.toWorld(ev.clientX, ev.clientY);
        setDraft({ from: card.id, x: p.x, y: p.y });
      };
      const onUp = (ev: PointerEvent): void => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        setDraft(null);
        const to = target(ev);
        if (to !== '') setPick({ from: card.id, to, sx: ev.clientX, sy: ev.clientY });
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    open: (card) => {
      if (card.kind === 'note' || card.kind === 'section') {
        setSel(new Set([card.id]));
        setEditing(card.id);
        if (card.kind === 'note') setInspect('');
      } else {
        setSel(new Set([card.id]));
        setSelLink('');
        setInspect(card.id);
      }
    },
    saveText: (card, patch) => {
      lastText.current[card.id] = { title: patch.title ?? card.title, body: patch.body ?? card.body };
      void api.updateCard(card.id, patch).catch(() => undefined);
    },
    doneEditing: (card) => {
      setEditing((e) => (e === card.id ? '' : e));
      const t = lastText.current[card.id] ?? { title: card.title, body: card.body };
      delete lastText.current[card.id];
      // A note left empty was never meant: it goes without an undo.
      if (card.kind === 'note' && t.title.trim() === '' && t.body.trim() === '' && card.added_by === 'app') {
        void api.deleteCards([card.id]).catch(() => undefined);
      }
    },
  };
  const act = useMemo<CardActions>(
    () => ({
      pointerDown: (e, card) => handlers.current?.pointerDown(e, card),
      resizeStart: (e, card) => handlers.current?.resizeStart(e, card),
      linkStart: (e, card) => handlers.current?.linkStart(e, card),
      open: (card) => handlers.current?.open(card),
      saveText: (card, patch) => handlers.current?.saveText(card, patch),
      doneEditing: (card) => handlers.current?.doneEditing(card),
    }),
    [],
  );

  const startMarquee = (e: React.PointerEvent): void => {
    const s = c.toWorld(e.clientX, e.clientY);
    const base = new Set(sel);
    const area = (ev: PointerEvent): Box => {
      const p = c.toWorld(ev.clientX, ev.clientY);
      return { x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) };
    };
    const onMove = (ev: PointerEvent): void => setMarquee(area(ev));
    const onUp = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const m = area(ev);
      setMarquee(null);
      const got = visible.filter((x) => (x.kind === 'section' ? inside(boxOf(x), m) : intersects(boxOf(x), m))).map((x) => x.id);
      const next = new Set([...base, ...got]);
      setSel(next);
      setSelLink('');
      setInspect(next.size === 1 ? ([...next][0] ?? '') : '');
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  /* ------------------------------------------------------- keyboard */

  const nudgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nudge = (dx: number, dy: number): void => {
    const ids = [...sel].filter((i) => byId.has(i));
    if (ids.length === 0) return;
    const next: Record<string, Box> = {};
    for (const i of ids) {
      const b = boxOf(byId.get(i) as Card);
      next[i] = { ...b, x: b.x + dx, y: b.y + dy };
    }
    for (const i of ids) pending.current.add(i);
    setLocal((l) => {
      const n = { ...l };
      for (const i of ids) n[i] = { ...n[i], x: next[i]?.x ?? 0, y: next[i]?.y ?? 0 };
      return n;
    });
    if (nudgeTimer.current !== null) clearTimeout(nudgeTimer.current);
    nudgeTimer.current = setTimeout(() => commitMove(ids.map((i) => ({ card: i, x: next[i]?.x ?? 0, y: next[i]?.y ?? 0 }))), 450);
  };

  const keyRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keyRef.current = (e: KeyboardEvent): void => {
    if (document.querySelector('[role="dialog"]') !== null) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest('input, textarea, select, [contenteditable="true"]')) return;
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Escape') {
      if (pick !== null) setPick(null);
      else if (q !== '') setQ('');
      else clearSelection();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && sel.size > 0) {
      e.preventDefault();
      void removeCards([...sel]);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selLink !== '') {
      e.preventDefault();
      void api.deleteLink(selLink).then(() => setSelLink('')).catch(() => undefined);
    } else if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      setSel(new Set(visible.map((x) => x.id)));
      setInspect('');
      setSelLink('');
    } else if (mod && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      void duplicate([...sel]);
    } else if (mod && e.key.toLowerCase() === 'z' && undo !== null) {
      e.preventDefault();
      void restore();
    } else if (mod && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      findRef.current?.focus();
    } else if (!mod && !e.altKey && (e.key === 'f' || e.key === 'F')) fitAll();
    else if (!mod && !e.altKey && (e.key === 'n' || e.key === 'N')) {
      e.preventDefault();
      void newNote(c.center());
    } else if (e.key.startsWith('Arrow') && sel.size > 0) {
      e.preventDefault();
      const s = e.shiftKey ? 40 : 8;
      nudge(e.key === 'ArrowLeft' ? -s : e.key === 'ArrowRight' ? s : 0, e.key === 'ArrowUp' ? -s : e.key === 'ArrowDown' ? s : 0);
    } else if (!mod && (e.key === '=' || e.key === '+')) c.zoomBy(1.25);
    else if (!mod && e.key === '-') c.zoomBy(1 / 1.25);
  };

  const pasteRef = useRef<(e: ClipboardEvent) => void>(() => undefined);
  pasteRef.current = (e: ClipboardEvent): void => {
    if (document.querySelector('[role="dialog"]') !== null) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest('input, textarea, select, [contenteditable="true"]')) return;
    const files = [...(e.clipboardData?.files ?? [])];
    const at = c.center();
    if (files.length > 0) {
      e.preventDefault();
      void uploadFiles(files, at);
      return;
    }
    const text = (e.clipboardData?.getData('text/plain') ?? '').trim();
    if (text === '') return;
    e.preventDefault();
    if (isWebUrl(text) && !/\s/.test(text)) void addUrl(text, at);
    else
      void api
        .addCard({ board: board.id, kind: 'note', body: text.slice(0, 100000), near_x: Math.round(at.x - 120), near_y: Math.round(at.y - 80) })
        .then((r) => setSel(new Set([r.card.id])))
        .catch(() => undefined);
  };

  useEffect(() => {
    const k = (e: KeyboardEvent): void => keyRef.current(e);
    const p = (e: ClipboardEvent): void => pasteRef.current(e);
    window.addEventListener('keydown', k);
    window.addEventListener('paste', p);
    return () => {
      window.removeEventListener('keydown', k);
      window.removeEventListener('paste', p);
    };
  }, []);

  /* ------------------------------------------------------------ drop */

  const onDragOver = (e: React.DragEvent): void => {
    const types = [...e.dataTransfer.types];
    if (types.includes(DRAG_KIND) || types.includes('Files') || types.includes('text/uri-list')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      if (types.includes('Files') && !dropping) setDropping(true);
    }
  };
  const onDrop = (e: React.DragEvent): void => {
    setDropping(false);
    const at = c.toWorld(e.clientX, e.clientY);
    const kind = e.dataTransfer.getData(DRAG_KIND) as Kind | '';
    if (kind !== '') {
      e.preventDefault();
      fromPalette(kind, at);
      return;
    }
    const files = [...e.dataTransfer.files];
    if (files.length > 0) {
      e.preventDefault();
      void uploadFiles(files, at);
      return;
    }
    const uri = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')).split('\n')[0]?.trim() ?? '';
    if (isWebUrl(uri)) {
      e.preventDefault();
      void addUrl(uri, at);
    }
  };

  /* ---------------------------------------------------------- render */

  const ordered = useMemo(() => {
    const sections = visible.filter((x) => x.kind === 'section').sort((a, b) => a.z - b.z || a.created.localeCompare(b.created));
    const rest = visible.filter((x) => x.kind !== 'section').sort((a, b) => a.z - b.z);
    return [...sections, ...rest.filter((x) => !dragging.has(x.id)), ...rest.filter((x) => dragging.has(x.id))];
  }, [visible, dragging]);

  const selectedCards = useMemo(() => [...sel].map((i) => byId.get(i)).filter((x): x is Card => x !== undefined), [sel, byId]);
  const focusIds = useMemo(() => {
    const s = new Set(sel);
    if (inspect !== '') s.add(inspect);
    return s;
  }, [sel, inspect]);
  const linkSel = selLink !== '' ? d.links.find((l) => l.id === selLink) : undefined;
  const draftFrom = draft !== null ? boxMap.get(draft.from) : undefined;
  const kindsHere = KIND_LIST.filter((k) => (counts[k.kind] ?? 0) > 0);
  const side = useSidebar();
  const showTags = c.vp.zoom > 0.45 ? 1 : 0;
  // The minimap helps only when part of the board is out of view.
  const content = bounds(visible.map(boxOf));
  const allInView =
    content !== null &&
    content.x * c.vp.zoom + c.vp.x >= 0 &&
    content.y * c.vp.zoom + c.vp.y >= 0 &&
    (content.x + content.w) * c.vp.zoom + c.vp.x <= view.w &&
    (content.y + content.h) * c.vp.zoom + c.vp.y <= view.h;

  let panel: React.JSX.Element | null = null;
  if (inspect !== '') {
    panel = (
      <CardPanel
        id={inspect}
        host={{
          onClose: () => {
            setInspect('');
            setSel(new Set());
          },
          onSelect: (id) => {
            const card = byId.get(id);
            setSel(new Set([id]));
            setInspect(id);
            if (card !== undefined) centerCard(card);
          },
          onDeleted: (card) => {
            setUndo((u) => ({ ids: [card.id], n: (u?.n ?? 0) + 1 }));
            setInspect('');
            setSel(new Set());
          },
          onDuplicated: (ids) => {
            expect(ids);
            setSel(new Set(ids));
            setInspect(ids[0] ?? '');
          },
        }}
      />
    );
  } else if (linkSel !== undefined) {
    const from = byId.get(linkSel.source);
    const to = byId.get(linkSel.target);
    if (from !== undefined && to !== undefined) {
      panel = (
        <LinkPanel
          key={linkSel.id}
          link={linkSel}
          from={from}
          to={to}
          onClose={() => setSelLink('')}
          onSelectCard={(id) => {
            setSelLink('');
            setSel(new Set([id]));
            setInspect(id);
          }}
        />
      );
    }
  } else if (sel.size > 1) {
    panel = (
      <SelectionPanel
        cards={selectedCards}
        board={board.id}
        allTags={(allTags.data?.tags ?? []).map((t) => t.tag)}
        onClose={() => setSel(new Set())}
        onDelete={() => void removeCards([...sel])}
        onDuplicate={() => void duplicate([...sel])}
        onSection={() => void newSection(selectedCards)}
        onTidy={() => tidy([...sel])}
      />
    );
  } else if (showReview && (board.review_state === 'done' || board.review_state === 'failed')) {
    panel = (
      <ReviewPanel
        board={board}
        onClose={() => setShowReview(false)}
        onShowProposals={() => {
          const first = d.links.find((l) => l.status === 'proposed');
          if (first !== undefined) {
            setShowReview(false);
            setSelLink(first.id);
            const a = byId.get(first.source);
            if (a !== undefined) centerCard(a);
          }
        }}
      />
    );
  }

  return (
    <div ref={frameRef} tabIndex={-1} className="flex min-h-0 flex-1 flex-col overflow-hidden outline-none" aria-label={`Board ${board.name}`}>
      {/* Toolbar */}
      <div className="relative z-20 flex h-12 shrink-0 items-center gap-1 border-b border-[var(--rb-line)] bg-[var(--rb-card)] px-2">
        {!side.open && <CircleButton icon={PanelLeft} label="Show the boards" onClick={side.toggle} />}
        {side.open && <CircleButton icon={PanelLeft} label="Hide the boards" className="max-md:hidden" onClick={side.toggle} />}
        <BoardName id={board.id} name={board.name} />
        <span className="mx-1 hidden h-5 w-px bg-[var(--rb-line)] md:block" />
        <div className="hidden md:block">
          <Tools onPick={(k) => fromPalette(k)} />
        </div>
        <span className="flex-1" />
        <label className="relative hidden items-center lg:flex">
          <Search size={14} aria-hidden className="pointer-events-none absolute left-2.5 text-[var(--rb-ink-2)]" />
          <input
            ref={findRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setHitIndex(-1);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') goHit(e.shiftKey ? -1 : 1);
              if (e.key === 'Escape') {
                setQ('');
                (e.target as HTMLInputElement).blur();
              }
            }}
            placeholder="Find on the board"
            aria-label="Find on the board"
            className={cn('h-8 rounded-[7px] border border-[var(--rb-line)] bg-[var(--rb-card)] pl-8 text-[13px] outline-none transition-[width,border-color] focus:border-[var(--rb-ink)]', q !== '' ? 'w-60 pr-[5.25rem]' : 'w-44 pr-2.5 focus:w-56')}
          />
          {q !== '' && (
            <span className="absolute right-1 flex items-center">
              <span className="num px-1 text-[11px] font-semibold text-[var(--rb-ink-2)]">{matches === null ? '' : hitList.length === 0 ? 'none' : `${Math.max(1, hitIndex + 1)}/${hitList.length}`}</span>
              <button type="button" aria-label="Previous match" onClick={() => goHit(-1)} className="flex size-6 items-center justify-center rounded-[5px] hover:bg-[var(--rb-row)]">
                <ChevronLeft size={13} />
              </button>
              <button type="button" aria-label="Next match" onClick={() => goHit(1)} className="flex size-6 items-center justify-center rounded-[5px] hover:bg-[var(--rb-row)]">
                <ChevronRight size={13} />
              </button>
            </span>
          )}
        </label>
        <KindFilter kinds={kindsHere} counts={counts} hidden={hidden} onChange={setHidden} />
        <AskReview board={board} onAsked={() => setShowReview(false)} />
        {(board.review_state === 'done' || board.review_state === 'failed') && !showReview && (
          <PillButton
            variant="light"
            onClick={() => {
              setInspect('');
              setSelLink('');
              setSel(new Set());
              setShowReview(true);
            }}
          >
            {board.review_state === 'failed' ? 'Review failed' : 'Review'}
          </PillButton>
        )}
        <PillButton
          variant="dark"
          icon={Plus}
          onClick={(e) =>
            add.open({
              board: board.id,
              origin: e.currentTarget,
              at: (() => {
                const p = c.center();
                return { x: p.x - 130, y: p.y - 110 };
              })(),
              onAdded: (card) => {
                expect([card.id]);
                setSel(new Set([card.id]));
              },
            })
          }
        >
          Add
        </PillButton>
        <MoreMenu
          label="Board options"
          items={[
            { label: 'Description', icon: FileText, onClick: () => setEditBoard(true) },
            { label: 'Export as Markdown', icon: Download, onClick: () => void exportMarkdown() },
            { label: 'Duplicate board', icon: Copy, onClick: () => void duplicateBoard() },
            'divider',
            { label: 'Delete board', icon: Trash2, danger: true, onClick: () => void deleteBoard() },
          ]}
        />
      </div>

      <div className="relative flex min-h-0 flex-1">
      {/* Canvas */}
      <div className="relative min-h-0 min-w-0 flex-1" onDragOver={onDragOver} onDragLeave={(e) => e.currentTarget.contains(e.relatedTarget as Node | null) || setDropping(false)} onDrop={onDrop}>
        <div
          ref={c.ref}
          className={cn('rb-canvas absolute inset-0', c.panning && 'rb-panning')}
          style={{ ...gridStyle(c.vp), transition: c.gliding ? 'background-position 450ms cubic-bezier(0.22,1,0.36,1), background-size 450ms cubic-bezier(0.22,1,0.36,1)' : undefined }}
          onPointerDown={(e) => {
            const el = e.target as HTMLElement;
            if (el !== e.currentTarget && !el.hasAttribute('data-bg')) return;
            frameRef.current?.focus({ preventScroll: true });
            if (e.shiftKey) {
              e.preventDefault();
              startMarquee(e);
              return;
            }
            const s = { x: e.clientX, y: e.clientY };
            const up = (ev: PointerEvent): void => {
              window.removeEventListener('pointerup', up);
              if (Math.hypot(ev.clientX - s.x, ev.clientY - s.y) < 4) clearSelection();
            };
            window.addEventListener('pointerup', up);
            c.onBackgroundPointerDown(e);
          }}
          onDoubleClick={(e) => {
            const el = e.target as HTMLElement;
            if (el !== e.currentTarget && !el.hasAttribute('data-bg')) return;
            void newNote(c.toWorld(e.clientX, e.clientY), true);
          }}
        >
          <div
            data-bg
            className="absolute left-0 top-0 origin-top-left"
            style={{ transform: `translate(${c.vp.x}px, ${c.vp.y}px) scale(${c.vp.zoom})`, transition: c.gliding ? 'transform 450ms cubic-bezier(0.22,1,0.36,1)' : undefined, willChange: 'transform' }}
          >
            {/* Sections, then the links over them, then the cards. */}
            {ordered.filter((x) => x.kind === 'section').map((card) => (
              <CardView
                key={card.id}
                card={card}
                box={boxMap.get(card.id) as Box}
                selected={sel.has(card.id)}
                editing={editing === card.id}
                dim={matches !== null && !matches.has(card.id)}
                hit={matches?.has(card.id) ?? false}
                linkTarget={draft !== null && draft.from !== card.id && card.kind !== 'section'}
                dragging={dragging.has(card.id)}
                fresh={fresh.has(card.id)}
                zoom={showTags}
                act={act}
              />
            ))}
            <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1">
              <LinkMarkers />
              {links.map((l) => (
                <LinkPath
                  key={l.id}
                  l={l}
                  a={boxMap.get(l.source) as Box}
                  b={boxMap.get(l.target) as Box}
                  selected={selLink === l.id}
                  hover={hoverLink === l.id}
                  dim={(focusIds.size > 0 && !focusIds.has(l.source) && !focusIds.has(l.target)) || (matches !== null && !(matches.has(l.source) || matches.has(l.target)))}
                  fresh={fresh.has(l.id)}
                  onSelect={() => {
                    setSel(new Set());
                    setInspect('');
                    setSelLink(l.id);
                  }}
                  onHover={(h) => setHoverLink(h ? l.id : '')}
                />
              ))}
              {draft !== null && draftFrom !== undefined && (
                <path d={linkPath(draftFrom, { x: draft.x - 1, y: draft.y - 1, w: 2, h: 2 }).d} fill="none" style={{ stroke: 'var(--rb-ink-2)' }} strokeWidth={2} strokeDasharray="5 5" strokeLinecap="round" markerEnd="url(#rb-arrow-draft)" />
              )}
            </svg>
            {ordered.filter((x) => x.kind !== 'section').map((card) => (
              <CardView
                key={card.id}
                card={card}
                box={boxMap.get(card.id) as Box}
                selected={sel.has(card.id)}
                editing={editing === card.id}
                dim={matches !== null && !matches.has(card.id)}
                hit={matches?.has(card.id) ?? false}
                linkTarget={draft !== null && draft.from !== card.id && card.kind !== 'section'}
                dragging={dragging.has(card.id)}
                fresh={fresh.has(card.id)}
                zoom={showTags}
                act={act}
              />
            ))}
            {marquee !== null && <div className="pointer-events-none absolute rounded-[6px] border-[1.5px] border-[var(--rb-accent)]" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h, background: 'color-mix(in srgb, var(--rb-accent) 10%, transparent)' }} />}
          </div>
        </div>

        {/* Empty board */}
        {cards.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
            <div className="rb-pop pointer-events-auto max-w-md rounded-[10px] border border-[var(--rb-line)] bg-[var(--rb-card)] px-4">
              <Empty
                icon={StickyNote}
                title="An empty board"
                action={
                  <span className="flex flex-wrap justify-center gap-2">
                    <PillButton variant="dark" icon={Plus} onClick={() => add.open({ board: board.id, onAdded: (card) => {
                expect([card.id]);
                setSel(new Set([card.id]));
              } })}>
                      Add a card
                    </PillButton>
                    <PillButton variant="light" icon={StickyNote} onClick={() => void newNote(c.center())}>
                      Write a note
                    </PillButton>
                  </span>
                }
              >
                Add notes, links, videos, documents and quotes, then link them. Drop files here, paste an address, or double click anywhere to write.
              </Empty>
            </div>
          </div>
        )}

        {/* Status */}
        <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center">
          {busy !== '' && (
            <StatusPill tone="info" pulse className="rb-pop">
              {busy}
            </StatusPill>
          )}
        </div>

        {/* Bottom left: links legend */}
        {d.links.length > 0 && (
          <div className="pointer-events-none absolute bottom-3 left-3 z-10 hidden md:block">
            <Legend proposed={proposedCount > 0} />
          </div>
        )}

        {/* Bottom right: minimap, zoom */}
        <div className="pointer-events-none absolute bottom-3 right-3 z-10 flex flex-col items-end gap-2">
          {cards.length > 0 && view.w > 900 && !allInView && <MiniMap cards={visible} boxOf={boxOf} vp={c.vp} view={view} onCenter={(x, y) => c.setVp((v) => ({ ...v, x: view.w / 2 - x * v.zoom, y: view.h / 2 - y * v.zoom }))} />}
          <div className="pointer-events-auto">
            <ZoomControls zoom={c.vp.zoom} onZoom={c.zoomBy} onFit={() => fitAll()} />
          </div>
        </div>

        {/* Undo */}
        {undo !== null && (
          <div className="pointer-events-none absolute inset-x-0 bottom-16 z-30 flex justify-center md:bottom-5">
            <UndoBar key={undo.n} count={undo.ids.length} onUndo={() => void restore()} onDone={() => setUndo(null)} />
          </div>
        )}

        {/* Files over the board */}
        {dropping && (
          <div className="rb-fade pointer-events-none absolute inset-2 z-30 flex items-center justify-center rounded-[10px] border-2 border-dashed border-[var(--rb-ink)] bg-[var(--rb-card)]/80">
            <span className="flex flex-col items-center gap-2 text-center">
              <span className="flex size-10 items-center justify-center rounded-[9px] bg-[var(--rb-ink)] text-[var(--rb-card)]">
                <CloudUpload size={22} />
              </span>
              <span className="text-[15px] font-bold">Drop to add to the board</span>
              <span className="text-[13px] text-[var(--rb-ink-2)]">Images, videos and documents become cards where you drop them</span>
            </span>
          </div>
        )}

        {/* Link kind picker */}
        {pick !== null && <KindPicker at={pick} onPick={(k) => void makeLink(pick.from, pick.to, k)} onCancel={() => setPick(null)} />}
      </div>

      {/* Right panel, docked */}
      {panel !== null && (
        <aside
          key={inspect !== '' ? 'card' : linkSel !== undefined ? 'link' : sel.size > 1 ? 'sel' : 'review'}
          data-scroll
          onPointerDown={(e) => e.stopPropagation()}
          className="rb-slide z-20 shrink-0 overflow-y-auto border-[var(--rb-line)] bg-[var(--rb-card)] max-md:absolute max-md:inset-x-0 max-md:bottom-0 max-md:max-h-[70%] max-md:border-t md:border-l"
          style={{ width: window.innerWidth >= 768 ? PANEL_W : undefined }}
        >
          {panel}
        </aside>
      )}
      </div>

      {editBoard && <BoardForm board={board} onClose={() => setEditBoard(false)} />}
      {confirmEl}
      <span className="sr-only" aria-live="polite">
        {sel.size > 0 ? `${sel.size} selected` : ''}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------- links */

function LinkPath({ l, a, b, selected, hover, dim, fresh, onSelect, onHover }: { l: Link; a: Box; b: Box; selected: boolean; hover: boolean; dim: boolean; fresh: boolean; onSelect: () => void; onHover: (h: boolean) => void }): React.JSX.Element {
  const path = linkPath(a, b);
  const proposed = l.status === 'proposed';
  const color = linkStroke(l.kind, proposed);
  const arrow = proposed ? 'proposed' : l.kind === 'relates' ? '' : l.kind;
  const showLabel = l.label !== '' || selected || hover;
  return (
    <g
      className="pointer-events-auto cursor-pointer"
      onPointerDown={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
      style={{ opacity: dim && !selected ? 0.32 : 1, transition: 'opacity 200ms' }}
    >
      <path d={path.d} fill="none" stroke="transparent" strokeWidth={16} />
      {selected && <path d={path.d} fill="none" style={{ stroke: color, opacity: 0.18 }} strokeWidth={9} strokeLinecap="round" />}
      <path
        d={path.d}
        fill="none"
        style={{ stroke: color, ['--rb-len' as string]: Math.ceil(path.length) } as React.CSSProperties}
        strokeWidth={selected || hover ? 2.75 : 2}
        strokeLinecap="round"
        strokeDasharray={proposed ? '7 6' : undefined}
        markerEnd={arrow !== '' ? `url(#rb-arrow-${arrow})` : undefined}
        className={cn(proposed ? 'rb-flow' : fresh && 'rb-stroke')}
      />
      {showLabel && (
        <foreignObject x={path.mid.x - 90} y={path.mid.y - 12} width={180} height={24} className="pointer-events-none overflow-visible">
          <div className="flex h-6 items-center justify-center">
            <span className="max-w-[180px] truncate whitespace-nowrap rounded-[5px] border border-[var(--rb-line)] bg-[var(--rb-card)] px-1.5 text-[11.5px] font-semibold leading-[18px]" style={{ color: proposed ? 'var(--rb-ink-2)' : `var(--rb-link-${l.kind}-text)` }}>
              {proposed && l.label === '' ? `proposed · ${LINK[l.kind].verb}` : l.label !== '' ? l.label : LINK[l.kind].verb}
            </span>
          </div>
        </foreignObject>
      )}
    </g>
  );
}

function KindPicker({ at, onPick, onCancel }: { at: { sx: number; sy: number }; onPick: (k: LinkKind) => void; onCancel: () => void }): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel();
      const n = Number(e.key);
      if (n >= 1 && n <= 4) onPick((LINK_LIST[n - 1] as (typeof LINK_LIST)[number]).kind);
    };
    const onDown = (e: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(e.target as Node)) onCancel();
    };
    window.addEventListener('keydown', onKey);
    const t = setTimeout(() => window.addEventListener('mousedown', onDown), 0);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(t);
      window.removeEventListener('mousedown', onDown);
    };
  }, [onPick, onCancel]);
  const left = Math.min(window.innerWidth - 250, at.sx + 10);
  const top = Math.min(window.innerHeight - 260, at.sy + 10);
  return (
    <div ref={ref} style={{ position: 'fixed', left, top }} className="rb-pop z-50 w-[224px] rounded-[10px] border border-[var(--rb-line)] bg-[var(--rb-card)] p-1 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.35)]">
      <p className="px-2.5 pb-1 pt-1.5 text-[12px] font-bold text-[var(--rb-ink-2)]">Link as</p>
      {LINK_LIST.map((l, i) => (
        <button key={l.kind} type="button" autoFocus={i === 0} onClick={() => onPick(l.kind)} className="flex w-full items-center gap-3 rounded-[6px] px-2.5 py-1.5 text-left hover:bg-[var(--rb-row)] focus-visible:bg-[var(--rb-row)] focus-visible:outline-none">
          <span className="h-[3px] w-5 shrink-0 rounded-full" style={{ background: linkColor(l.kind) }} />
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-bold">{l.label}</span>
            <span className="block text-[11.5px] text-[var(--rb-ink-2)]">{l.hint}</span>
          </span>
          <kbd className="font-[inherit] text-[11px] font-semibold text-[var(--rb-muted)]">{i + 1}</kbd>
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------- name, filter */

/** The board's name; click to rename it in place. */
function BoardName({ id, name }: { id: string; name: string }): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(name);
  useEffect(() => setV(name), [name]);
  const save = async (): Promise<void> => {
    setEditing(false);
    const n = v.trim();
    if (n === '' || n === name) {
      setV(name);
      return;
    }
    try {
      await api.updateBoard(id, { name: n });
    } catch {
      setV(name);
    }
  };
  if (editing) {
    return (
      <input
        autoFocus
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void save();
          if (e.key === 'Escape') {
            setV(name);
            setEditing(false);
          }
        }}
        maxLength={120}
        aria-label="Board name"
        className="h-8 w-64 min-w-0 rounded-[7px] border border-[var(--rb-ink)] bg-[var(--rb-card)] px-2 text-[14px] font-bold outline-none"
      />
    );
  }
  return (
    <button type="button" onClick={() => setEditing(true)} title="Rename" className="h-8 min-w-0 max-w-[16rem] truncate rounded-[7px] px-2 text-left text-[14px] font-bold hover:bg-[var(--rb-row)]">
      {name}
    </button>
  );
}

/** Show or hide kinds of cards. */
function KindFilter({ kinds, counts, hidden, onChange }: { kinds: (typeof KIND_LIST)[number][]; counts: Partial<Record<Kind, number>>; hidden: Set<Kind>; onChange: (h: Set<Kind>) => void }): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  if (kinds.length === 0) return null;
  const on = hidden.size > 0;
  return (
    <div ref={ref} className="relative">
      <CircleButton icon={Filter} label="Show or hide kinds of cards" active={open || on} onClick={() => setOpen((o) => !o)} />
      {on && <span className="pointer-events-none absolute right-1 top-1 size-1.5 rounded-full bg-[var(--rb-ink)]" />}
      <Popover open={open} onClose={() => setOpen(false)} keep={ref} align="right" className="w-56">
        <p className="px-2.5 pb-1 pt-1.5 text-[12px] font-bold text-[var(--rb-ink-2)]">Show on the board</p>
        {kinds.map((k) => {
          const Icon = k.icon;
          const shown = !hidden.has(k.kind);
          return (
            <button
              key={k.kind}
              type="button"
              role="menuitemcheckbox"
              aria-checked={shown}
              onClick={() => {
                const n = new Set(hidden);
                if (shown) n.add(k.kind);
                else n.delete(k.kind);
                onChange(n);
              }}
              className="flex w-full items-center gap-2.5 rounded-[6px] px-2.5 py-1.5 text-left text-[13px] hover:bg-[var(--rb-row)]"
            >
              <span className={cn('flex size-4 items-center justify-center rounded-[4px] border', shown ? 'border-[var(--rb-ink)] bg-[var(--rb-ink)] text-[var(--rb-card)]' : 'border-[var(--rb-line)]')}>{shown && <Check size={11} strokeWidth={3} />}</span>
              <Icon size={15} className="text-[var(--rb-ink-2)]" />
              <span className="flex-1">{k.plural}</span>
              <span className="num text-[12px] text-[var(--rb-ink-2)]">{counts[k.kind]}</span>
            </button>
          );
        })}
        {on && (
          <button type="button" onClick={() => onChange(new Set())} className="mt-1 w-full rounded-[6px] px-2.5 py-1.5 text-left text-[12px] font-semibold hover:bg-[var(--rb-row)]">
            Show all
          </button>
        )}
      </Popover>
    </div>
  );
}
