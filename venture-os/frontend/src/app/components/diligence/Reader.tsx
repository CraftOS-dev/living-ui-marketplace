/**
 * The reader (Research OS pattern): a right Sheet showing the cited page
 * with the quote highlighted, and, when the passage backs an answer still
 * waiting, Confirm and Reject beside the value, so a partner confirms while
 * reading the exact words.
 *
 * PDFs are drawn by pdf.js (lib/pdf.ts) with the anchor's stored rectangles
 * over the page; other files (slides, documents, scans read by your AI
 * agent) show the page's stored text with the passage marked. The text and
 * rectangles come from the app's own text layer (pages.get), the same text
 * the anchor was made on.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { getPbClient } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { act, patch } from '../../lib/live.ts';
import { drawPage, openDocument } from '../../lib/pdf.ts';
import { AgentTag, Button, GradeDot, IconButton, LoadError, Sheet, SheetHeader, Skeleton } from '../ui.tsx';
import type { ReadTarget } from './types.ts';
import { DD_READS } from './types.ts';

type Item = [string, number, number, number, number, number, number];

interface PageData {
  page: number;
  width: number;
  height: number;
  origin: string;
  text: string;
  items: Item[];
}

interface AnchorView {
  id: string;
  page: number;
  start: number;
  end: number;
  rects: number[][];
}

interface FileView {
  id: string;
  name: string;
  ext: string;
  pages: number;
}

const WIDTH = 760;

function fileUrl(id: string): { url: string; headers: Record<string, string> } {
  const pb = getPbClient().pb;
  const url = pb.buildURL('/api/ops/files/download') + '?file=' + encodeURIComponent(id);
  return { url, headers: pb.authStore.token !== '' ? { Authorization: pb.authStore.token } : {} };
}

/** The reader sheet. `target` null keeps it closed. */
export function ReaderSheet({ target, onClose }: { target: ReadTarget | null; onClose: () => void }): React.JSX.Element | null {
  if (target === null) return null;
  return (
    <Sheet open onClose={onClose} width={WIDTH} label="Source">
      <ReaderBody key={target.cite.anchor + target.cite.page} target={target} onClose={onClose} />
    </Sheet>
  );
}

function ReaderBody({ target, onClose }: { target: ReadTarget; onClose: () => void }): React.JSX.Element {
  const cite = target.cite;
  const [pageNo, setPageNo] = useState(Math.max(1, cite.page));
  const [file, setFile] = useState<FileView | null>(null);
  const [data, setData] = useState<{ page: PageData; anchors: AnchorView[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [decided, setDecided] = useState('');

  useEffect(() => {
    let gone = false;
    op<{ file: FileView }>('files.get', { file: cite.file }, { quiet: true })
      .then((r) => !gone && setFile(r.file))
      .catch((e: unknown) => !gone && setError((e as Error).message));
    return () => {
      gone = true;
    };
  }, [cite.file]);

  useEffect(() => {
    let gone = false;
    setData(null);
    op<{ pages: PageData[]; anchors: AnchorView[] }>('pages.get', { file: cite.file, from: pageNo, to: pageNo }, { quiet: true })
      .then((r) => {
        if (gone) return;
        const pg = r.pages[0];
        if (pg === undefined) setError('This page has no text yet.');
        else setData({ page: pg, anchors: r.anchors });
      })
      .catch((e: unknown) => !gone && setError((e as Error).message));
    return () => {
      gone = true;
    };
  }, [cite.file, pageNo]);

  const mark = data?.anchors.find((a) => a.id === cite.anchor && a.page === pageNo) ?? null;
  const ans = target.answer;
  const waiting = ans !== undefined && ans.status === 'agent_proposed' && decided === '';

  const decide = async (confirm: boolean): Promise<void> => {
    if (ans === undefined) return;
    setBusy(confirm ? 'confirm' : 'reject');
    const out = await act([patch(ans.id, { status: confirm ? 'confirmed' : 'rejected' })], () => op(confirm ? 'dd.confirm' : 'dd.reject', { answer: ans.id }), DD_READS);
    setBusy('');
    if (out !== null) {
      setDecided(confirm ? 'confirmed' : 'rejected');
      onClose();
    }
  };

  const total = file?.pages ?? 0;
  return (
    <>
      <SheetHeader
        title={<span className="vo-wrap">{file?.name ?? cite.file_name}</span>}
        onClose={onClose}
        actions={
          <div className="flex items-center gap-1">
            <IconButton icon={ChevronLeft} label="Previous page" disabled={pageNo <= 1} onClick={() => setPageNo((n) => Math.max(1, n - 1))} />
            <span className="vo-mono vo-num min-w-[52px] text-center text-[12px] text-[var(--vo-ink-2)]">{total > 0 ? `${pageNo} / ${total}` : `p.${pageNo}`}</span>
            <IconButton icon={ChevronRight} label="Next page" disabled={total > 0 && pageNo >= total} onClick={() => setPageNo((n) => n + 1)} />
          </div>
        }
      />
      {ans !== undefined && (
        <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--vo-line)] bg-[var(--vo-raised)] px-4 py-2">
          {target.question !== undefined && <span className="vo-wrap min-w-0 flex-1 text-[13px] text-[var(--vo-ink-2)]">{target.question}</span>}
          <span className="flex items-center gap-2">
            <span className="vo-mono vo-num text-[14px] font-medium">{ans.value}</span>
            <GradeDot grade={ans.grade} />
            {ans.status === 'agent_proposed' && <AgentTag />}
          </span>
          {waiting && (
            <span className="flex items-center gap-1.5">
              <Button size="sm" variant="ghost" icon={X} busy={busy === 'reject'} disabled={busy !== ''} onClick={() => void decide(false)}>
                Reject
              </Button>
              <Button size="sm" icon={Check} busy={busy === 'confirm'} disabled={busy !== ''} onClick={() => void decide(true)}>
                Confirm
              </Button>
            </span>
          )}
        </div>
      )}
      <div className="vo-scroll min-h-0 flex-1 overflow-auto bg-[var(--vo-sunk)] p-4">
        {error !== null ? (
          <LoadError message={error} />
        ) : data === null || file === null ? (
          <Skeleton className="h-[600px] w-full" />
        ) : file.ext === 'pdf' ? (
          <PdfPage fileId={file.id} page={data.page} rects={mark?.rects ?? []} />
        ) : (
          <TextPage page={data.page} start={mark?.start ?? -1} end={mark?.end ?? -1} />
        )}
      </div>
    </>
  );
}

/** A PDF page drawn to fit the sheet, the passage's rectangles over it. */
function PdfPage({ fileId, page, rects }: { fileId: string; page: PageData; rects: number[][] }): React.JSX.Element {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const box = useRef<HTMLDivElement | null>(null);
  const [drawn, setDrawn] = useState(false);
  const [failed, setFailed] = useState(false);
  const [avail, setAvail] = useState(WIDTH - 32);
  useEffect(() => {
    const el = box.current?.parentElement;
    if (!el) return;
    const fit = (): void => setAvail(Math.max(240, el.clientWidth - 32));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = page.width > 0 ? avail / page.width : 1;
  useEffect(() => {
    let cancel: (() => void) | null = null;
    let gone = false;
    setDrawn(false);
    const src = fileUrl(fileId);
    openDocument(fileId, src.url, src.headers)
      .then((doc) => doc.getPage(page.page))
      .then((pg) => {
        if (gone || canvas.current === null) return;
        cancel = drawPage(pg, canvas.current, scale, () => {
          setDrawn(true);
          box.current?.querySelector('[data-mark]')?.scrollIntoView({ block: 'center' });
        });
      })
      .catch(() => !gone && setFailed(true));
    return () => {
      gone = true;
      cancel?.();
    };
  }, [fileId, page.page, scale]);
  if (failed) return <TextPage page={page} start={-1} end={-1} />;
  return (
    <div ref={box} className="relative mx-auto bg-white shadow-[var(--vo-shadow)]" style={{ width: page.width * scale, height: page.height * scale }}>
      <canvas ref={canvas} aria-label={`Page ${page.page}`} style={{ width: page.width * scale, height: page.height * scale }} />
      {!drawn && <Skeleton className="absolute inset-4 h-auto" />}
      {rects.map((r, i) => (
        <span
          key={i}
          data-mark
          aria-hidden
          className="pointer-events-none absolute rounded-[2px]"
          style={{ left: (r[0] ?? 0) * scale - 2, top: (r[1] ?? 0) * scale - 2, width: (r[2] ?? 0) * scale + 4, height: (r[3] ?? 0) * scale + 4, background: 'color-mix(in srgb, var(--vo-a) 22%, transparent)', boxShadow: 'inset 0 -2px 0 var(--vo-a)' }}
        />
      ))}
    </div>
  );
}

/** A page's stored text with the passage marked (slides, documents, pages your AI agent read). */
function TextPage({ page, start, end }: { page: PageData; start: number; end: number }): React.JSX.Element {
  const ref = useRef<HTMLElement | null>(null);
  const parts = useMemo(() => {
    const t = page.text;
    if (start < 0 || end <= start) return { before: t, mark: '', after: '' };
    return { before: t.slice(0, start), mark: t.slice(start, end), after: t.slice(end) };
  }, [page.text, start, end]);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'center' });
  }, [parts.mark]);
  return (
    <div className="vo-wrap mx-auto max-w-[680px] whitespace-pre-wrap rounded-[var(--vo-radius-sm)] border border-[var(--vo-line)] bg-[var(--vo-raised)] px-5 py-4 text-[13px] leading-6">
      {parts.before}
      {parts.mark !== '' && (
        <mark ref={ref} className="rounded-[2px] text-[var(--vo-ink)]" style={{ background: 'color-mix(in srgb, var(--vo-a) 22%, transparent)', boxShadow: 'inset 0 -2px 0 var(--vo-a)' }}>
          {parts.mark}
        </mark>
      )}
      {parts.after}
    </div>
  );
}
