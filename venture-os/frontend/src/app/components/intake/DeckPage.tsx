/**
 * The deck at the quote: a Citation on a fact opens this sheet on the page
 * it came from, with the quoted words marked (the anchor's rectangles from
 * anchors.resolve). PDFs draw with pdf.js (lib/pdf.ts); other formats offer
 * the file itself.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ChevronLeft, ChevronRight, Download, FileText } from 'lucide-react';
import { getPbClient } from '../../../kit/index.ts';
import { Button, Empty, IconButton, LoadError, Sheet, SheetHeader, Skeleton } from '../ui.tsx';
import { download, op } from '../../lib/api.ts';
import { drawPage, openDocument } from '../../lib/pdf.ts';
import type { PDFDocumentProxy } from '../../lib/pdf.ts';

export interface DeckTarget {
  file: string;
  name: string;
  page: number;
  anchor?: string | undefined;
}

let target: DeckTarget | null = null;
const subs = new Set<() => void>();
function setTarget(t: DeckTarget | null): void {
  target = t;
  for (const fn of subs) fn();
}

/** Open the deck sheet at a page (and the anchor's quote). */
export function openDeck(t: DeckTarget): void {
  setTarget(t);
}

function useTarget(): DeckTarget | null {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
    () => target,
  );
}

/** Render once on any page that has citations (the Inbox, the Focus card). */
export function DeckSheet(): React.JSX.Element | null {
  const t = useTarget();
  if (t === null) return null;
  return (
    <Sheet open onClose={() => setTarget(null)} width={760} label={t.name}>
      <SheetHeader title={t.name} onClose={() => setTarget(null)} actions={<IconButton icon={Download} label="Download" onClick={() => void download('files.download', { file: t.file, download: true }, 'save', t.name)} />} />
      <DeckBody key={t.file + ':' + String(t.page) + ':' + (t.anchor ?? '')} t={t} />
    </Sheet>
  );
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function DeckBody({ t }: { t: DeckTarget }): React.JSX.Element {
  const pdf = /\.pdf$/i.test(t.name);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(Math.max(1, t.page));
  const [rects, setRects] = useState<{ page: number; list: Rect[] }>({ page: 0, list: [] });
  const [scale, setScale] = useState(1);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!pdf) return;
    const pb = getPbClient().pb;
    const url = pb.buildURL('/api/ops/files/download') + '?file=' + encodeURIComponent(t.file);
    const headers: Record<string, string> = pb.authStore.token !== '' ? { Authorization: pb.authStore.token } : {};
    openDocument(t.file, url, headers)
      .then(setDoc)
      .catch(() => setError('The deck could not be opened.'));
  }, [t.file, pdf]);

  useEffect(() => {
    if (t.anchor === undefined || t.anchor === '') return;
    op<{ anchors: { ok: boolean; page: number; rects: number[][] }[] }>('anchors.resolve', { anchor: t.anchor }, { quiet: true })
      .then((r) => {
        const a = r.anchors[0];
        if (a !== undefined && a.ok) setRects({ page: a.page, list: (a.rects ?? []).map((x) => ({ x: x[0] ?? 0, y: x[1] ?? 0, w: x[2] ?? 0, h: x[3] ?? 0 })) });
      })
      .catch(() => undefined);
  }, [t.anchor]);

  useEffect(() => {
    if (doc === null || canvas.current === null) return;
    let cancel: (() => void) | null = null;
    let live = true;
    doc
      .getPage(Math.min(page, doc.numPages))
      .then((pg) => {
        if (!live || canvas.current === null) return;
        const base = pg.getViewport({ scale: 1 });
        const width = Math.max(240, (box.current?.clientWidth ?? 700) - 34);
        const s = width / base.width;
        setScale(s);
        setSize({ w: base.width * s, h: base.height * s });
        cancel = drawPage(pg, canvas.current, s);
      })
      .catch(() => setError('This page could not be drawn.'));
    return () => {
      live = false;
      cancel?.();
    };
  }, [doc, page]);

  if (!pdf)
    return (
      <div className="p-6">
        <Empty icon={FileText} title="Open the file" action={<Button icon={Download} onClick={() => void download('files.download', { file: t.file }, 'open', t.name)}>Open</Button>} />
      </div>
    );
  if (error !== null) return <LoadError message={error} />;
  const n = doc?.numPages ?? 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-[var(--vo-hair)] px-3">
        <IconButton icon={ChevronLeft} label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} />
        <span className="vo-mono vo-num min-w-16 text-center text-[12px] text-[var(--vo-ink-2)]">
          {page} / {n > 0 ? n : '...'}
        </span>
        <IconButton icon={ChevronRight} label="Next page" disabled={n > 0 && page >= n} onClick={() => setPage((p) => p + 1)} />
      </div>
      <div ref={box} className="min-h-0 flex-1 overflow-auto bg-[var(--vo-sunk)] p-4">
        {doc === null && <Skeleton className="aspect-[4/3] w-full" />}
        <div className="relative mx-auto" style={size !== null ? { width: size.w, height: size.h } : undefined}>
          <canvas ref={canvas} className="block h-full w-full rounded-[4px] shadow-[var(--vo-shadow)]" style={size !== null ? { width: size.w, height: size.h } : undefined} />
          {rects.page === page &&
            rects.list.map((r, i) => (
              <span key={i} aria-hidden className="pointer-events-none absolute rounded-[2px] bg-[var(--vo-warn)] opacity-30" style={{ left: r.x * scale - 2, top: r.y * scale - 2, width: r.w * scale + 4, height: r.h * scale + 4 }} />
            ))}
        </div>
      </div>
    </div>
  );
}
