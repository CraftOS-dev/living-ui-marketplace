/**
 * The reader. Pages drawn by pdf.js with the app's stored text layer over
 * them, so a selection names the same characters your AI agent anchors.
 *
 *   Select text      a popup: eight colors (1 to 8), underline (U), comment,
 *                    Evidence (Backslash), Claim, Question, Copy with citation
 *   Tools            Alt+1 highlight, Alt+2 underline, Alt+3 comment, Alt+5
 *                    area (drag a box over a figure or table); Esc back to select
 *   Marks            click one to recolor, comment, make it evidence, or remove
 *   Find             Ctrl+F; zoom with + and -, 0 fits the width
 *
 * Left: pages, outline, highlights, claims. Right: the paper, its note,
 * its claims, questions to your AI agent, references.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BookOpenText, ChevronDown, ChevronUp, CircleHelp, Copy, Highlighter, Lightbulb, Maximize2, MessageSquare, MousePointer2, PanelLeft, PanelRight, Quote, ScanLine, Search, Sparkles, SquareDashed, Trash2, Underline, X, ZoomIn, ZoomOut } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { op, opForm, opUrl } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { changed, listen, useLive } from '../lib/live.ts';
import { KIND_LABEL, clip } from '../lib/format.ts';
import { back, navigate } from '../lib/router.ts';
import type { Anchor, Annotation, FileInfo, GNode, PageData, Rect, WorkDetail } from '../lib/types.ts';
import { askAgent, DecideButtons, decideNodes, RequestStatus } from '../components/agent.tsx';
import { hueOfSlot } from '../components/paper.tsx';
import { LeftPanel, RightPanel } from '../components/reader/Panels.tsx';
import type { LeftTab, RightTab } from '../components/reader/Panels.tsx';
import { PageView, selectionOffsets } from '../components/reader/PageView.tsx';
import type { EvidenceMark, Tool } from '../components/reader/PageView.tsx';
import { PromoteDialog } from '../components/reader/Promote.tsx';
import type { PromoteTarget } from '../components/reader/Promote.tsx';
import { itemOffsets, occurrences, pageText, rectsFor } from '../components/reader/geometry.ts';
import { openDocument } from '../components/reader/pdf.ts';
import type { PDFDocumentProxy } from '../components/reader/pdf.ts';
import { Badge, ButtonGroup, Empty, IconButton, Kbd, LoadError, Spinner, textareaCls } from '../components/ui.tsx';

const GAP = 28;
const BATCH = 20;
const TABS_KEY = 'ro_reader_tabs';

interface Tab {
  file: string;
  title: string;
}

function readTabs(): Tab[] {
  try {
    const v = JSON.parse(localStorage.getItem(TABS_KEY) ?? '[]') as Tab[];
    return Array.isArray(v) ? v.slice(0, 8) : [];
  } catch {
    return [];
  }
}

function writeTabs(t: Tab[]): void {
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify(t.slice(0, 8)));
  } catch {
    /* a convenience */
  }
}

export default function ReaderPage({ file, page }: { file: string; page: number }): React.JSX.Element {
  const info = useLive((signal) => op<FileInfo>('files.get', { file }, { quiet: true, signal }), ['files'], [file], 300);
  if (file === '') return <Empty icon={BookOpenText} title="No paper open" />;
  if (info.error !== null)
    return (
      <div className="p-4">
        <LoadError message={info.error} onRetry={info.reload} />
      </div>
    );
  if (info.data === null)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size={20} />
      </div>
    );
  return <Reader info={info.data} initialPage={page} />;
}

function Reader({ info, initialPage }: { info: FileInfo; initialPage: number }): React.JSX.Element {
  const { slot } = useApp();
  const fileId = info.id;
  const work = useLive((signal) => op<{ work: WorkDetail }>('works.get', { work: info.work }, { quiet: true, signal }).then((r) => r.work), ['works', 'project_works'], [info.work], 300);
  const marks = useLive((signal) => op<{ annotations: Annotation[] }>('annotations.list', { file: fileId }, { quiet: true, signal }).then((r) => r.annotations), ['annotations'], [fileId], 120);
  const nodes = useLive((signal) => op<{ nodes: GNode[] }>('nodes.list', { work: info.work, passages: true, limit: 2000 }, { quiet: true, signal }).then((r) => r.nodes.filter((n) => n.status !== 'researcher_rejected')), ['nodes', 'node_anchors', 'relations'], [info.work], 200);

  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [docError, setDocError] = useState<string | null>(null);
  const [pages, setPages] = useState<Map<number, PageData>>(new Map());
  const loading = useRef(new Set<number>());
  const scroller = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(800);
  const [zoom, setZoom] = useState<'fit' | number>(() => {
    try {
      const z = localStorage.getItem('ro_reader_zoom');
      return z === null || z === 'fit' ? 'fit' : Number(z) || 'fit';
    } catch {
      return 'fit';
    }
  });
  const [current, setCurrent] = useState(1);
  const [near, setNear] = useState<[number, number]>([1, 4]);
  const [tool, setTool] = useState<Tool>('select');
  const [toolSlot, setToolSlot] = useState(1);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [leftTab, setLeftTab] = useState<LeftTab>('marks');
  const [rightTab, setRightTab] = useState<RightTab>('paper');
  const [popup, setPopup] = useState<{ page: number; start: number; end: number; x: number; y: number; text: string } | null>(null);
  const [markPop, setMarkPop] = useState<{ a: Annotation; x: number; y: number } | null>(null);
  const [evPop, setEvPop] = useState<{ ev: EvidenceMark; x: number; y: number } | null>(null);
  const [promote, setPromote] = useState<PromoteTarget | null>(null);
  const [comment, setComment] = useState<{ page: number; start: number; end: number; x: number; y: number } | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findQ, setFindQ] = useState('');
  const [hitPages, setHitPages] = useState<{ page_no: number; snippet: string }[]>([]);
  const [hitIndex, setHitIndex] = useState(0);
  const [flash, setFlash] = useState('');
  const [tabs, setTabs] = useState<Tab[]>(readTabs);
  const [ocrReq, setOcrReq] = useState('');
  const thumbDone = useRef(info.has_thumb);
  const restored = useRef(false);
  const root = useRef<HTMLDivElement | null>(null);

  /* ------------------------------------------------------------ document */

  useEffect(() => {
    let gone = false;
    openDocument(fileId, opUrl('files.content', { file: fileId }))
      .then((d) => !gone && setDoc(d))
      .catch((err: unknown) => !gone && setDocError(String((err as Error).message ?? err)));
    return () => {
      gone = true;
    };
  }, [fileId]);

  const ensure = useCallback(
    (n: number) => {
      const start = Math.floor((n - 1) / BATCH) * BATCH + 1;
      if (loading.current.has(start)) return;
      loading.current.add(start);
      op<{ pages: PageData[] }>('pages.get', { file: fileId, from: start, to: start + BATCH - 1 }, { quiet: true })
        .then((r) =>
          setPages((prev) => {
            const m = new Map(prev);
            for (const p of r.pages) m.set(p.page, p);
            return m;
          }),
        )
        .catch(() => loading.current.delete(start));
    },
    [fileId],
  );

  useEffect(() => {
    if (info.text_state === 'ready' || info.text_state === 'needs_ocr') ensure(1);
  }, [ensure, info.text_state]);

  // Pages your AI agent read (OCR) or the text worker finished: load them again.
  useEffect(
    () =>
      listen(['pages', 'files'], () => {
        loading.current = new Set();
        setPages(new Map());
      }),
    [],
  );

  useEffect(() => {
    if (pages.size === 0 && (info.text_state === 'ready' || info.text_state === 'needs_ocr')) {
      for (let p = near[0]; p <= near[1]; p++) ensure(p);
    }
  }, [pages.size, info.text_state, near, ensure]);

  /* -------------------------------------------------------------- layout */

  useEffect(() => {
    const el = scroller.current;
    if (el === null) return;
    const ro = new ResizeObserver((e) => setWidth(Math.max(240, e[0]?.contentRect.width ?? 800)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const count = info.pages > 0 ? info.pages : (doc?.numPages ?? 0);
  const base = pages.get(1) ?? Array.from(pages.values())[0];
  const sizeOf = (n: number): { w: number; h: number } => {
    const p = pages.get(n) ?? base;
    return { w: p?.width ?? 612, h: p?.height ?? 792 };
  };
  const maxW = Math.max(...Array.from({ length: Math.max(1, Math.min(count, 50)) }, (_, i) => sizeOf(i + 1).w));
  const fit = Math.max(0.3, Math.min(3, (width - 48) / maxW));
  const scale = zoom === 'fit' ? fit : zoom;
  const tops = useMemo(() => {
    const out: number[] = [];
    let y = 24;
    for (let i = 1; i <= count; i++) {
      out.push(y);
      y += sizeOf(i).h * scale + GAP;
    }
    out.push(y);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, scale, pages]);

  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (el === null || count === 0) return;
    const probe = el.scrollTop + el.clientHeight * 0.3;
    let cur = 1;
    for (let i = 0; i < count; i++) if ((tops[i] as number) <= probe) cur = i + 1;
    setCurrent((c) => (c === cur ? c : cur));
    const lo = Math.max(1, cur - 2);
    const hi = Math.min(count, cur + 3);
    setNear((n) => (n[0] === lo && n[1] === hi ? n : [lo, hi]));
    for (let p = lo; p <= hi; p++) if (!pages.has(p)) ensure(p);
  }, [count, tops, pages, ensure]);

  useEffect(() => {
    onScroll();
  }, [onScroll]);

  const jump = useCallback(
    (n: number, yInPage = 0) => {
      const el = scroller.current;
      if (el === null) return;
      const p = Math.max(1, Math.min(count, n));
      el.scrollTo({ top: (tops[p - 1] ?? 0) + yInPage * scale - 60, behavior: 'auto' });
    },
    [count, tops, scale],
  );

  const jumpAnchor = useCallback(
    (a: Anchor) => {
      if (a.file !== fileId) {
        navigate('read', { file: a.file, page: String(a.page) });
        return;
      }
      jump(a.page, a.rects[0]?.[1] ?? 0);
      const mark = marks.data?.find((m) => m.anchor?.id === a.id);
      setFlash(mark ? mark.id : a.id);
      setTimeout(() => setFlash(''), 1600);
    },
    [fileId, jump, marks.data],
  );

  // Restore where you were (or the page asked for) once the layout is known.
  useEffect(() => {
    if (restored.current || count === 0 || base === undefined) return;
    restored.current = true;
    const target = initialPage > 0 ? initialPage : info.pos_page > 1 ? info.pos_page : 1;
    const frac = initialPage > 0 ? 0 : info.pos_frac;
    if (target > 1 || frac > 0) setTimeout(() => jump(target, frac * sizeOf(target).h), 30);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, base]);

  // Keep the place when the zoom changes.
  const keep = useRef<{ page: number; frac: number } | null>(null);
  const setZoomKeep = (z: 'fit' | number): void => {
    const el = scroller.current;
    if (el !== null) {
      const top = tops[current - 1] ?? 0;
      keep.current = { page: current, frac: (el.scrollTop - top) / (sizeOf(current).h * scale) };
    }
    setZoom(z);
    try {
      localStorage.setItem('ro_reader_zoom', String(z));
    } catch {
      /* a convenience */
    }
  };
  useEffect(() => {
    const k = keep.current;
    if (k === null) return;
    keep.current = null;
    const el = scroller.current;
    if (el !== null) el.scrollTop = (tops[k.page - 1] ?? 0) + k.frac * sizeOf(k.page).h * scale;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale]);

  // Remember the reading position.
  useEffect(() => {
    if (count === 0) return;
    const t = setTimeout(() => {
      const el = scroller.current;
      if (el === null) return;
      const top = tops[current - 1] ?? 0;
      const frac = Math.max(0, Math.min(1, (el.scrollTop - top) / (sizeOf(current).h * scale)));
      void op('files.position', { file: fileId, page: current, frac: Math.round(frac * 1000) / 1000 }, { quiet: true }).catch(() => undefined);
    }, 1400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, fileId]);

  // Tabs of open papers.
  useEffect(() => {
    const title = work.data?.title;
    if (title === undefined) return;
    setTabs((prev) => {
      const next = [{ file: fileId, title }, ...prev.filter((t) => t.file !== fileId)].slice(0, 8);
      const ordered = prev.some((t) => t.file === fileId) ? prev.map((t) => (t.file === fileId ? { file: fileId, title } : t)) : next;
      writeTabs(ordered);
      return ordered;
    });
  }, [fileId, work.data?.title]);

  /* ----------------------------------------------------------- marks data */

  const marksByPage = useMemo(() => {
    const m = new Map<number, Annotation[]>();
    for (const a of marks.data ?? []) m.set(a.page, [...(m.get(a.page) ?? []), a]);
    return m;
  }, [marks.data]);

  const evidenceByPage = useMemo(() => {
    const m = new Map<number, EvidenceMark[]>();
    for (const n of nodes.data ?? []) {
      for (const a of n.anchors ?? []) {
        if (a.file !== fileId) continue;
        const ev: EvidenceMark = { key: n.id + ':' + a.id, node: n.id, status: n.status, kind: n.kind, title: n.title, rects: a.rects };
        m.set(a.page, [...(m.get(a.page) ?? []), ev]);
      }
    }
    return m;
  }, [nodes.data, fileId]);

  const hitsByPage = useMemo(() => {
    const m = new Map<number, Rect[][]>();
    if (!findOpen || findQ.trim().length < 2) return m;
    for (const [n, p] of pages) {
      const text = pageText(p.items);
      const starts = itemOffsets(p.items);
      const occ = occurrences(text, findQ);
      if (occ.length > 0) m.set(n, occ.map(([s, e]) => rectsFor(p.items, starts, s, e)));
    }
    return m;
  }, [pages, findQ, findOpen]);

  /* ------------------------------------------------------------ actions */

  const createMark = useCallback(
    async (sel: { page: number; start: number; end: number }, kind: 'highlight' | 'underline' | 'note', colorSlot: number, text = '') => {
      setPopup(null);
      window.getSelection()?.removeAllRanges();
      try {
        await op('annotations.create', { file: fileId, page: sel.page, start: sel.start, end: sel.end, kind, color_slot: colorSlot, comment: text });
        changed('annotations');
      } catch {
        /* toasted */
      }
    },
    [fileId],
  );

  const quoteOf = (sel: { page: number; start: number; end: number }): string => {
    const p = pages.get(sel.page);
    return p ? pageText(p.items).slice(sel.start, sel.end).replace(/\s*\n\s*/g, ' ').trim() : '';
  };

  const copyCitation = async (sel: { page: number; start: number; end: number }): Promise<void> => {
    const label = work.data?.label ?? '';
    await navigator.clipboard.writeText('“' + quoteOf(sel) + '” (' + label + ', p. ' + sel.page + ')');
    toast.success('Quote copied with its citation');
    setPopup(null);
  };

  const onPointerUp = (e: React.PointerEvent): void => {
    if (tool === 'area') return;
    const x = e.clientX;
    const y = e.clientY;
    setTimeout(() => {
      const s = selectionOffsets();
      if (s === null) {
        // A click on a mark under the text opens it.
        const hit = document.elementsFromPoint(x, y).find((el) => el.hasAttribute('data-mark'));
        if (hit) {
          const id = hit.getAttribute('data-mark') as string;
          const a = (marks.data ?? []).find((m) => m.id === id);
          if (a) {
            setMarkPop({ a, x, y });
            return;
          }
          for (const list of evidenceByPage.values()) {
            const ev = list.find((v) => v.key === id);
            if (ev) {
              setEvPop({ ev, x, y });
              return;
            }
          }
        }
        setPopup(null);
        return;
      }
      if (tool === 'highlight') void createMark(s, 'highlight', toolSlot);
      else if (tool === 'underline') void createMark(s, 'underline', toolSlot);
      else if (tool === 'note') setComment({ page: s.page, start: s.start, end: s.end, x: s.rect.left, y: s.rect.bottom + 6 });
      else setPopup({ page: s.page, start: s.start, end: s.end, x: s.rect.left + s.rect.width / 2, y: s.rect.bottom + 8, text: s.text });
    }, 0);
  };

  const openPromote = (sel: { page: number; start: number; end: number }, kind: PromoteTarget['kind']): void => {
    setPopup(null);
    setPromote({ file: fileId, work: info.work, page: sel.page, start: sel.start, end: sel.end, quote: quoteOf(sel), kind });
  };

  const onArea = useCallback(
    async (pageNo: number, box: [number, number, number, number]) => {
      try {
        await op('annotations.create', { file: fileId, page: pageNo, kind: 'area', area: JSON.stringify(box), color_slot: toolSlot });
        changed('annotations');
      } catch {
        /* toasted */
      }
    },
    [fileId, toolSlot],
  );

  // The first page's picture, once, for covers.
  const onFirstDraw = useCallback(
    (canvas: HTMLCanvasElement) => {
      if (thumbDone.current) return;
      thumbDone.current = true;
      const w = 300;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = Math.round((canvas.height / canvas.width) * w);
      c.getContext('2d')?.drawImage(canvas, 0, 0, c.width, c.height);
      c.toBlob((b) => {
        if (b) void opForm('files.set-thumb', { file: fileId }, { thumb: new File([b], 'thumb.webp', { type: 'image/webp' }) }, { quiet: true }).then(() => changed('files')).catch(() => undefined);
      }, 'image/webp', 0.85);
    },
    [fileId],
  );

  /* ------------------------------------------------------------ keyboard */

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      const typing = t !== null && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setFindOpen(true);
        setTimeout(() => document.getElementById('ro-find')?.focus(), 0);
        return;
      }
      if (typing) return;
      if (e.altKey && ['1', '2', '3', '5'].includes(e.key)) {
        e.preventDefault();
        setTool(({ '1': 'highlight', '2': 'underline', '3': 'note', '5': 'area' } as Record<string, Tool>)[e.key] ?? 'select');
        return;
      }
      const sel = popup ?? (() => {
        const s = selectionOffsets();
        return s ? { page: s.page, start: s.start, end: s.end, x: 0, y: 0, text: s.text } : null;
      })();
      if (sel !== null && /^[1-8]$/.test(e.key) && !e.altKey && !e.ctrlKey) {
        e.preventDefault();
        void createMark(sel, 'highlight', Number(e.key));
        return;
      }
      if (sel !== null && e.key.toLowerCase() === 'u' && !e.ctrlKey) {
        e.preventDefault();
        void createMark(sel, 'underline', 1);
        return;
      }
      if (sel !== null && e.key === '\\') {
        e.preventDefault();
        openPromote(sel, 'evidence');
        return;
      }
      if (e.key === 'Escape') {
        setPopup(null);
        setTool('select');
        window.getSelection()?.removeAllRanges();
        return;
      }
      if (e.key === '+' || e.key === '=') setZoomKeep(Math.min(4, scale * 1.15));
      else if (e.key === '-') setZoomKeep(Math.max(0.3, scale / 1.15));
      else if (e.key === '0') setZoomKeep('fit');
      else if (e.key === 'n' || e.key === 'j') jump(current + 1);
      else if (e.key === 'p' || e.key === 'k') jump(current - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popup, scale, current, createMark]);

  const runFind = async (dir: 1 | -1 = 1): Promise<void> => {
    if (findQ.trim().length < 2) return;
    let list = hitPages;
    if (list.length === 0) {
      const r = await op<{ hits: { page_no: number; snippet: string }[] }>('pages.find', { file: fileId, q: findQ }, { quiet: true }).catch(() => ({ hits: [] }));
      list = r.hits;
      setHitPages(list);
      setHitIndex(0);
      if (list[0]) jump(list[0].page_no);
      return;
    }
    const next = (hitIndex + dir + list.length) % list.length;
    setHitIndex(next);
    const h = list[next];
    if (h) jump(h.page_no);
  };

  const projectsOfWork = (work.data?.projects ?? []).map((p) => p.id);
  const ctxProjects = useApp().projects.filter((p) => projectsOfWork.includes(p.id));

  /* ---------------------------------------------------------------- view */

  const textReady = info.text_state === 'ready' || info.text_state === 'needs_ocr';
  return (
    <div ref={root} className="flex h-full min-h-0 flex-col @container">
      <header className="flex h-11 shrink-0 items-center gap-1.5 border-b border-[var(--ro-line)] bg-[var(--ro-card)] px-2">
        <IconButton icon={ArrowLeft} label="Back" onClick={() => back('library')} />
        <IconButton icon={PanelLeft} label="Sidebar" active={leftOpen} onClick={() => setLeftOpen((o) => !o)} className="hidden @min-[760px]:inline-flex" />
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {tabs.map((t) => (
            <div key={t.file} className={cn('group flex h-7 max-w-[220px] shrink-0 items-center gap-1 rounded-[var(--ro-r)] pl-2 pr-1 text-[12px] font-semibold', t.file === fileId ? 'bg-[var(--ro-row-hover)] text-[var(--ro-ink)]' : 'text-[var(--ro-ink-2)] hover:bg-[var(--ro-row)]')}>
              <button type="button" onClick={() => t.file !== fileId && navigate('read', { file: t.file })} className="min-w-0 flex-1 truncate text-left" title={t.title}>
                {t.title}
              </button>
              <button
                type="button"
                aria-label={'Close ' + t.title}
                onClick={() => {
                  const rest = tabs.filter((x) => x.file !== t.file);
                  setTabs(rest);
                  writeTabs(rest);
                  if (t.file === fileId) {
                    if (rest[0]) navigate('read', { file: rest[0].file });
                    else back('library');
                  }
                }}
                className="flex size-5 shrink-0 items-center justify-center rounded-[3px] text-[var(--ro-muted)] opacity-0 hover:bg-[var(--ro-row-hover)] group-hover:opacity-100"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
        <ButtonGroup label="Tools" className="hidden @min-[640px]:inline-flex">
          <IconButton icon={MousePointer2} label="Select text (Esc)" size={24} active={tool === 'select'} onClick={() => setTool('select')} />
          <IconButton icon={Highlighter} label="Highlight tool (Alt+1)" size={24} active={tool === 'highlight'} onClick={() => setTool('highlight')} />
          <IconButton icon={Underline} label="Underline tool (Alt+2)" size={24} active={tool === 'underline'} onClick={() => setTool('underline')} />
          <IconButton icon={MessageSquare} label="Comment tool (Alt+3)" size={24} active={tool === 'note'} onClick={() => setTool('note')} />
          <IconButton icon={SquareDashed} label="Area tool: drag a box (Alt+5)" size={24} active={tool === 'area'} onClick={() => setTool('area')} />
          {tool !== 'select' && (
            <span className="flex items-center gap-0.5 px-1">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
                <button key={s} type="button" title={slot(s).meaning} aria-label={slot(s).meaning} onClick={() => setToolSlot(s)} className={cn('size-3.5 rounded-full', toolSlot === s && 'ring-2 ring-[var(--ro-ink)] ring-offset-1 ring-offset-[var(--ro-card)]')} style={{ background: `var(--ro-hl-${hueOfSlot(s)})` }} />
              ))}
            </span>
          )}
        </ButtonGroup>
        <ButtonGroup label="Zoom">
          <IconButton icon={ZoomOut} label="Zoom out (-)" size={24} onClick={() => setZoomKeep(Math.max(0.3, scale / 1.15))} />
          <button type="button" onClick={() => setZoomKeep('fit')} title="Fit the width (0)" className="num h-6 w-11 rounded-[var(--ro-r-sm)] text-[12px] font-semibold hover:bg-[var(--ro-row)]">
            {Math.round(scale * 100)}%
          </button>
          <IconButton icon={ZoomIn} label="Zoom in (+)" size={24} onClick={() => setZoomKeep(Math.min(4, scale * 1.15))} />
        </ButtonGroup>
        <span className="num hidden shrink-0 text-[12px] text-[var(--ro-muted)] @min-[900px]:inline">
          {current} / {count}
        </span>
        <IconButton icon={Search} label="Find in the paper (Ctrl+F)" active={findOpen} onClick={() => { setFindOpen((o) => !o); setTimeout(() => document.getElementById('ro-find')?.focus(), 0); }} />
        <IconButton icon={PanelRight} label="Panel" active={rightOpen} onClick={() => setRightOpen((o) => !o)} className="hidden @min-[1100px]:inline-flex" />
      </header>
      <div className="flex min-h-0 flex-1">
        {leftOpen && (
          <aside className="hidden w-60 shrink-0 border-r border-[var(--ro-line)] bg-[var(--ro-card)] @min-[760px]:block">
            <LeftPanel tab={leftTab} onTab={setLeftTab} info={info} doc={doc} current={current} pageCount={count} marks={marks.data ?? []} nodes={nodes.data ?? []} onJump={(n) => jump(n)} onJumpAnchor={jumpAnchor} />
          </aside>
        )}
        <div className="relative flex min-w-0 flex-1 flex-col">
          {findOpen && (
            <div className="absolute right-3 top-2 z-20 flex w-[min(92%,380px)] flex-col overflow-hidden rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)] shadow-[var(--ro-shadow)]">
              <form className="flex items-center gap-1 p-1.5" onSubmit={(e) => { e.preventDefault(); void runFind(1); }}>
                <Search size={14} className="ml-1 shrink-0 text-[var(--ro-muted)]" />
                <input id="ro-find" value={findQ} onChange={(e) => { setFindQ(e.target.value); setHitPages([]); }} onKeyDown={(e) => { if (e.key === 'Escape') setFindOpen(false); if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); void runFind(-1); } }} placeholder="Find in this paper" className="h-7 min-w-0 flex-1 bg-transparent text-[13px] outline-none" aria-label="Find in this paper" />
                {hitPages.length > 0 && <span className="num shrink-0 text-[12px] text-[var(--ro-muted)]">{hitIndex + 1} / {hitPages.length}</span>}
                <IconButton icon={ChevronUp} label="Previous (Shift+Enter)" size={24} onClick={() => void runFind(-1)} />
                <IconButton icon={ChevronDown} label="Next (Enter)" size={24} onClick={() => void runFind(1)} />
                <IconButton icon={X} label="Close (Esc)" size={24} onClick={() => setFindOpen(false)} />
              </form>
              {hitPages.length > 0 && (
                <ul className="max-h-56 overflow-y-auto border-t border-[var(--ro-hair)]">
                  {hitPages.map((h, i) => (
                    <li key={h.page_no}>
                      <button type="button" onClick={() => { setHitIndex(i); jump(h.page_no); }} className={cn('flex w-full gap-2 px-2.5 py-1.5 text-left text-[12px] leading-4 hover:bg-[var(--ro-row)]', i === hitIndex && 'bg-[var(--ro-row)]')}>
                        <span className="num w-8 shrink-0 font-bold">p. {h.page_no}</span>
                        <span className="min-w-0 flex-1 text-[var(--ro-ink-2)]" dangerouslySetInnerHTML={{ __html: escapeHtml(h.snippet).replace(/\[\[/g, '<b>').replace(/\]\]/g, '</b>') }} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div ref={scroller} onScroll={onScroll} onPointerUp={onPointerUp} className="min-h-0 flex-1 overflow-auto bg-[var(--ro-desk)]" style={{ touchAction: 'pan-x pan-y pinch-zoom' }}>
            {docError !== null ? (
              <div className="p-6"><LoadError message={docError} /></div>
            ) : (
              <div className="relative" style={{ height: tops[count] ?? 0, minWidth: maxW * scale + 48 }}>
                {info.text_state === 'needs_ocr' && (
                  <div className="sticky top-3 z-10 mx-auto mb-2 flex w-fit items-center gap-2 rounded-[var(--ro-r)] bg-[var(--ro-card)] px-3 py-1.5 text-[12px] font-semibold shadow-[var(--ro-shadow)]">
                    <ScanLine size={13} /> {info.pages - info.pages_with_text > 0 ? info.pages - info.pages_with_text + ' scanned pages have no text yet' : 'Scanned pages have no text yet'}
                    {ocrReq !== '' ? <RequestStatus id={ocrReq} /> : <button type="button" onClick={() => void askAgent('ocr_requested', {}, 'Your AI agent is asked to read the scanned pages').then(setOcrReq)} className="inline-flex items-center gap-1 rounded-[var(--ro-r-sm)] bg-[var(--ro-row)] px-2 py-0.5 hover:bg-[var(--ro-row-hover)]"><Sparkles size={12} /> Ask your AI agent to read them</button>}
                  </div>
                )}
                {!textReady && (
                  <div className="sticky top-3 z-10 mx-auto mb-2 flex w-fit items-center gap-2 rounded-[var(--ro-r)] bg-[var(--ro-card)] px-3 py-1.5 text-[12px] font-semibold shadow-[var(--ro-shadow)]">
                    {info.text_state === 'failed' ? <><ScanLine size={13} /> The text of this PDF could not be read: {info.text_error}</> : <><Spinner size={12} /> Reading the text; highlights work in a moment</>}
                  </div>
                )}
                {Array.from({ length: count }, (_, i) => {
                  const n = i + 1;
                  const sz = sizeOf(n);
                  const isNear = n >= near[0] - 1 && n <= near[1] + 1;
                  return (
                    <div key={n} className="absolute left-0 right-0" style={{ top: tops[i] }}>
                      <PageView
                        pageNo={n}
                        width={sz.w}
                        height={sz.h}
                        data={pages.get(n)}
                        doc={doc}
                        scale={scale}
                        near={isNear}
                        marks={marksByPage.get(n) ?? []}
                        evidence={evidenceByPage.get(n) ?? []}
                        hits={hitsByPage.get(n) ?? []}
                        activeHit={hitPages[hitIndex]?.page_no === n ? 0 : -1}
                        flash={flash}
                        tool={tool}
                        onArea={(pg, box) => void onArea(pg, box)}
                        onMarkClick={(a, x, y) => setMarkPop({ a, x, y })}
                        onEvidenceClick={(ev, x, y) => setEvPop({ ev, x, y })}
                        {...(n === 1 ? { onFirstDraw } : {})}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        {rightOpen && (
          <aside className="hidden w-[360px] shrink-0 border-l border-[var(--ro-line)] bg-[var(--ro-card)] @min-[1100px]:block">
            <RightPanel tab={rightTab} onTab={setRightTab} workId={info.work} projects={ctxProjects} nodes={nodes.data ?? []} onJumpAnchor={jumpAnchor} />
          </aside>
        )}
      </div>
      {popup !== null && (
        <SelectionPopup
          x={popup.x}
          y={popup.y}
          onColor={(s) => void createMark(popup, 'highlight', s)}
          onUnderline={() => void createMark(popup, 'underline', 1)}
          onComment={() => {
            setComment({ page: popup.page, start: popup.start, end: popup.end, x: popup.x - 140, y: popup.y });
            setPopup(null);
          }}
          onPromote={(k) => openPromote(popup, k)}
          onCopy={() => void copyCitation(popup)}
          onClose={() => setPopup(null)}
        />
      )}
      {comment !== null && <CommentBox x={comment.x} y={comment.y} onSave={(t) => { void createMark(comment, 'note', toolSlot, t); setComment(null); }} onClose={() => setComment(null)} />}
      {markPop !== null && <MarkPopover pop={markPop} onClose={() => setMarkPop(null)} onPromote={(a) => { setMarkPop(null); if (a.anchor) setPromote({ file: fileId, work: info.work, page: a.page, anchor: a.anchor.id, quote: a.anchor.quote, kind: 'evidence' }); }} label={work.data?.label ?? ''} />}
      {evPop !== null && <EvidencePopover pop={evPop} nodes={nodes.data ?? []} onClose={() => setEvPop(null)} />}
      {promote !== null && <PromoteDialog target={promote} projectsOfWork={projectsOfWork} onClose={() => setPromote(null)} />}
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function place(x: number, y: number, w: number, h: number): { left: number; top: number } {
  return { left: Math.max(8, Math.min(window.innerWidth - w - 8, x - w / 2)), top: y + h > window.innerHeight - 8 ? Math.max(8, y - h - 40) : y };
}

function SelectionPopup({ x, y, onColor, onUnderline, onComment, onPromote, onCopy, onClose }: { x: number; y: number; onColor: (s: number) => void; onUnderline: () => void; onComment: () => void; onPromote: (k: 'evidence' | 'claim' | 'question') => void; onCopy: () => void; onClose: () => void }): React.JSX.Element {
  const { slot } = useApp();
  const pos = place(x, y, 420, 40);
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (!(e.target as HTMLElement).closest('[data-popup]')) onClose();
    };
    const t = setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);
  return (
    <div data-popup style={{ position: 'fixed', ...pos }} className="ro-pop z-50 flex items-center gap-0.5 rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)] p-1 shadow-[var(--ro-shadow)]" onMouseDown={(e) => e.preventDefault()}>
      {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
        <button key={s} type="button" onClick={() => onColor(s)} title={(slot(s).meaning || 'Highlight') + ' (' + s + ')'} aria-label={slot(s).meaning || 'Highlight ' + s} className="flex size-7 items-center justify-center rounded-[var(--ro-r-sm)] hover:bg-[var(--ro-row)]">
          <span className="size-3.5 rounded-full" style={{ background: `var(--ro-hl-${hueOfSlot(s)})` }} />
        </button>
      ))}
      <span className="mx-0.5 h-5 w-px bg-[var(--ro-line)]" />
      <IconButton icon={Underline} label="Underline (U)" size={28} onClick={onUnderline} />
      <IconButton icon={MessageSquare} label="Comment" size={28} onClick={onComment} />
      <span className="mx-0.5 h-5 w-px bg-[var(--ro-line)]" />
      <button type="button" onClick={() => onPromote('evidence')} title="Evidence (Backslash)" className="inline-flex h-7 items-center gap-1 rounded-[var(--ro-r-sm)] px-1.5 text-[12px] font-semibold hover:bg-[var(--ro-row)]">
        <Quote size={13} style={{ color: 'var(--ro-kind-evidence-text)' }} /> Evidence <Kbd className="ml-0.5">\</Kbd>
      </button>
      <IconButton icon={Lightbulb} label="Claim" size={28} onClick={() => onPromote('claim')} />
      <IconButton icon={CircleHelp} label="Question" size={28} onClick={() => onPromote('question')} />
      <span className="mx-0.5 h-5 w-px bg-[var(--ro-line)]" />
      <IconButton icon={Copy} label="Copy with citation" size={28} onClick={onCopy} />
    </div>
  );
}

function CommentBox({ x, y, onSave, onClose }: { x: number; y: number; onSave: (t: string) => void; onClose: () => void }): React.JSX.Element {
  const [t, setT] = useState('');
  return (
    <div data-popup style={{ position: 'fixed', ...place(x + 140, y, 300, 120) }} className="ro-pop z-50 flex w-[300px] flex-col gap-1.5 rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)] p-2 shadow-[var(--ro-shadow)]">
      <textarea autoFocus rows={3} value={t} onChange={(e) => setT(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSave(t); } if (e.key === 'Escape') onClose(); }} placeholder="Your comment" className={textareaCls} aria-label="Comment" />
      <div className="flex justify-end gap-1">
        <button type="button" onClick={onClose} className="h-6 rounded-[var(--ro-r-sm)] px-2 text-[12px] font-semibold hover:bg-[var(--ro-row)]">Cancel</button>
        <button type="button" onClick={() => onSave(t)} className="h-6 rounded-[var(--ro-r-sm)] bg-[var(--ro-primary)] px-2 text-[12px] font-semibold text-white hover:bg-[var(--ro-primary-hover)]">Save</button>
      </div>
    </div>
  );
}

function MarkPopover({ pop, onClose, onPromote, label }: { pop: { a: Annotation; x: number; y: number }; onClose: () => void; onPromote: (a: Annotation) => void; label: string }): React.JSX.Element {
  const { slot } = useApp();
  const [comment, setComment] = useState(pop.a.comment);
  const a = pop.a;
  const save = async (patch: Record<string, unknown>): Promise<void> => {
    await op('annotations.update', { annotation: a.id, ...patch });
    changed('annotations');
  };
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (!(e.target as HTMLElement).closest('[data-popup]')) onClose();
    };
    const t = setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);
  return (
    <div data-popup style={{ position: 'fixed', ...place(pop.x, pop.y + 10, 300, 230) }} className="ro-pop z-50 flex w-[300px] flex-col gap-2 rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)] p-2.5 shadow-[var(--ro-shadow)]">
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
          <button key={s} type="button" title={slot(s).meaning} aria-label={slot(s).meaning} onClick={() => void save({ color_slot: s })} className={cn('size-5 rounded-full', a.color_slot === s && 'ring-2 ring-[var(--ro-ink)] ring-offset-1 ring-offset-[var(--ro-card)]')} style={{ background: `var(--ro-hl-${hueOfSlot(s)})` }} />
        ))}
        <span className="flex-1" />
        <Badge tone="neutral">{a.meaning || slot(a.color_slot).meaning}</Badge>
      </div>
      {a.anchor && a.kind !== 'area' && <p className="serif max-h-24 overflow-y-auto text-[12px] leading-4 text-[var(--ro-ink-2)]">{clip(a.anchor.quote, 400)}</p>}
      <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} onBlur={() => comment !== a.comment && void save({ comment })} placeholder="Add a comment" className={textareaCls} aria-label="Comment" />
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" onClick={() => onPromote(a)} className="inline-flex h-6 items-center gap-1 rounded-[var(--ro-r-sm)] bg-[var(--ro-row)] px-2 text-[12px] font-semibold hover:bg-[var(--ro-row-hover)]">
          <Lightbulb size={12} /> Make evidence or a claim
        </button>
        {a.kind !== 'area' && (
          <button type="button" onClick={() => void save({ kind: a.kind === 'underline' ? 'highlight' : 'underline' })} className="inline-flex h-6 items-center gap-1 rounded-[var(--ro-r-sm)] px-2 text-[12px] font-semibold hover:bg-[var(--ro-row)]">
            {a.kind === 'underline' ? <Highlighter size={12} /> : <Underline size={12} />}
            {a.kind === 'underline' ? 'Highlight' : 'Underline'}
          </button>
        )}
        {a.anchor && (
          <IconButton
            icon={Copy}
            label="Copy with citation"
            size={24}
            onClick={() => void navigator.clipboard.writeText('“' + (a.anchor?.quote ?? '') + '” (' + label + ', p. ' + a.page + ')').then(() => toast.success('Copied'))}
          />
        )}
        <span className="flex-1" />
        <IconButton
          icon={Trash2}
          label="Remove"
          variant="danger"
          size={24}
          onClick={() =>
            void op('annotations.delete', { annotation: a.id }).then(() => {
              changed('annotations');
              onClose();
            })
          }
        />
      </div>
    </div>
  );
}

function EvidencePopover({ pop, nodes, onClose }: { pop: { ev: EvidenceMark; x: number; y: number }; nodes: GNode[]; onClose: () => void }): React.JSX.Element {
  const n = nodes.find((x) => x.id === pop.ev.node);
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (!(e.target as HTMLElement).closest('[data-popup]')) onClose();
    };
    const t = setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);
  if (n === undefined) return <></>;
  return (
    <div data-popup style={{ position: 'fixed', ...place(pop.x, pop.y + 10, 320, 170) }} className={cn('ro-pop z-50 flex w-[320px] flex-col gap-2 rounded-[var(--ro-r-md)] border bg-[var(--ro-card)] p-2.5 shadow-[var(--ro-shadow)]', n.status === 'agent_proposed' ? 'border-dashed border-[var(--ro-accent)]' : 'border-[var(--ro-line)]')}>
      <span className="flex items-center gap-1.5 text-[12px] font-bold" style={{ color: `var(--ro-kind-${n.kind}-text)` }}>
        {n.kind === 'evidence' ? <Quote size={12} /> : n.kind === 'claim' ? <Lightbulb size={12} /> : <CircleHelp size={12} />}
        {KIND_LABEL[n.kind]}
        {n.status === 'agent_proposed' && <Badge tone="agent">Proposed by your AI agent</Badge>}
      </span>
      <p className="text-[13px] font-semibold leading-[18px]">{n.title}</p>
      {n.why !== '' && <p className="flex gap-1 text-[12px] leading-4 text-[var(--ro-ink-2)]"><Sparkles size={11} className="mt-0.5 shrink-0" />{clip(n.why, 240)}</p>}
      <div className="flex items-center gap-1">
        {n.status === 'agent_proposed' && <DecideButtons onConfirm={() => decideNodes([n.id], 'researcher_confirmed').then(onClose)} onReject={() => decideNodes([n.id], 'researcher_rejected').then(onClose)} />}
        <span className="flex-1" />
        <button type="button" onClick={() => navigate('project', { id: n.project, view: 'map', node: n.id })} className="inline-flex h-6 items-center gap-1 rounded-[var(--ro-r-sm)] px-2 text-[12px] font-semibold hover:bg-[var(--ro-row)]">
          <Maximize2 size={12} /> Open in the map
        </button>
      </div>
    </div>
  );
}
