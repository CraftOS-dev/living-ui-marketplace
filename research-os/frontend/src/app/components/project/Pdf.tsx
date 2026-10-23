/**
 * The PDF beside the manuscript. Build typesets it with LaTeX on this
 * computer, in the background: the first build fetches the engine and its
 * packages (a few minutes, once), later ones take seconds. What LaTeX
 * complained about is listed with the block it came from, and the last PDF
 * stays in view while a new one is built. LaTeX settings hold the venue,
 * the authors, the folder with a venue's style files, and your own preamble.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, CircleAlert, Download, FileArchive, FileText, MoreHorizontal, PenLine, Play, Plus, RotateCcw, ScrollText, Settings2, Trash2, X } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { download, op, opUrl } from '../../lib/api.ts';
import { changed, useLive } from '../../lib/live.ts';
import { ago, plural } from '../../lib/format.ts';
import type { RepoList } from '../../lib/types.ts';
import { Button, Field, IconButton, Modal, Popover, Select, Spinner, inputCls, menuItem, textareaCls } from '../ui.tsx';
import { drawPage, openDocument, type PDFDocumentProxy } from '../reader/pdf.ts';
import type { BuildIssue } from './Editor.tsx';

export interface Build {
  id: string;
  manuscript: string;
  status: 'running' | 'done' | 'failed';
  phase: string;
  pages: number;
  seconds: number;
  errors: BuildIssue[];
  stamp: string;
  has_pdf: boolean;
  actor: string;
  created: string;
  finished_at: string;
  log?: string;
}

export interface BuildState {
  build: Build | null;
  /** The latest build with a PDF: shown while a new one runs, or after one failed. */
  pdf_build: Build | null;
  /** The manuscript has not changed since the build (unknown while it runs). */
  current?: boolean;
}

export interface Author {
  name: string;
  affiliation: string;
  email: string;
}

export const VENUES = [
  { value: 'generic', label: 'Any venue' },
  { value: 'elsevier', label: 'Elsevier' },
  { value: 'nature', label: 'Nature Portfolio' },
  { value: 'science', label: 'Science' },
  { value: 'acl', label: 'ACL' },
  { value: 'iclr', label: 'ICLR' },
  { value: 'neurips', label: 'NeurIPS' },
  { value: 'ieee', label: 'IEEE' },
];
/** Venues that publish their own style files rather than ship them with LaTeX. */
const OWN_STYLE = new Set(['acl', 'iclr', 'neurips']);

const PHASE: Record<string, string> = {
  starting: 'Starting',
  engine: 'Getting the LaTeX engine (once per computer)',
  packages: 'Getting LaTeX packages for the first build. This takes a few minutes, once.',
  compiling: 'Typesetting',
};

/** The manuscript's latest build, kept fresh while it runs. */
export function useBuild(ms: string, active: boolean): { state: BuildState | null; start: () => Promise<void>; starting: boolean } {
  const live = useLive((signal) => (active ? op<BuildState>('ms.build-status', { manuscript: ms }, { quiet: true, signal }) : Promise.resolve(null)), ['ms_builds', 'ms_blocks', 'manuscripts', 'repo_items', 'repo_versions', 'works'], [ms, active], 700);
  const [polled, setPolled] = useState<BuildState | null>(null);
  const [starting, setStarting] = useState(false);
  useEffect(() => setPolled(null), [live.data]);
  const state = polled ?? live.data;
  const running = state?.build?.status === 'running' ? state.build.id : '';
  useEffect(() => {
    if (running === '' || !active) return;
    let on = true;
    const t = setInterval(() => {
      void op<BuildState>('ms.build-status', { build: running }, { quiet: true })
        .then((r) => {
          if (!on) return;
          setPolled(r);
          if (r.build?.status !== 'running') changed('ms_builds');
        })
        .catch(() => undefined);
    }, 1500);
    return () => {
      on = false;
      clearInterval(t);
    };
  }, [running, active]);
  const start = useCallback(async (): Promise<void> => {
    setStarting(true);
    try {
      const r = await op<{ build: Build }>('ms.build', { manuscript: ms });
      setPolled({ build: r.build, pdf_build: state?.pdf_build ?? null });
    } catch {
      /* toasted */
    } finally {
      setStarting(false);
    }
  }, [ms, state?.pdf_build]);
  return { state, start, starting };
}

/** Fetch what a LaTeX or Markdown export names beside its text files (figures, style files) and zip them all. */
export async function exportZip(ms: string, format: 'latex' | 'markdown'): Promise<Blob> {
  const r = await op<{ files: { path: string; content: string }[]; assets?: { path: string; item: string; version: number }[] }>('ms.export', { manuscript: ms, format });
  const { zip } = await import('../../lib/zip.ts');
  const entries: { name: string; data: string | Uint8Array }[] = r.files.map((f) => ({ name: f.path, data: f.content }));
  for (const a of r.assets ?? []) {
    const res = await fetch(opUrl('repo.file', { item: a.item, version: a.version }), { credentials: 'include' });
    if (res.ok) entries.push({ name: a.path, data: new Uint8Array(await res.arrayBuffer()) });
  }
  return zip(entries);
}

export const fileBase = (title: string): string => (title || 'manuscript').replace(/[^\w\- ]+/g, '').trim() || 'manuscript';

export function PdfPane({ ms, title, state, start, starting, where, onClose, onSettings, onGoTo, className }: { ms: string; title: string; state: BuildState | null; start: () => Promise<void>; starting: boolean; where: (block: string) => string; onClose: () => void; onSettings: () => void; onGoTo: (block: string) => void; className?: string }): React.JSX.Element {
  const build = state?.build ?? null;
  const shown = state?.pdf_build ?? null;
  const running = build?.status === 'running';
  const [warnings, setWarnings] = useState(false);
  const [log, setLog] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const moreBtn = useRef<HTMLButtonElement | null>(null);
  const errors = (build?.errors ?? []).filter((e) => e.level === 'error');
  const warns = (build?.errors ?? []).filter((e) => e.level === 'warning');
  const stale = build !== null && !running && state?.current === false;
  const openLog = async (): Promise<void> => {
    if (build === null) return;
    setMore(false);
    const r = await op<BuildState>('ms.build-status', { build: build.id, log: true }).catch(() => null);
    setLog(r?.build?.log ?? '');
  };
  const source = async (): Promise<void> => {
    setMore(false);
    try {
      download(fileBase(title) + '-latex.zip', await exportZip(ms, 'latex'), 'application/zip');
    } catch {
      /* toasted */
    }
  };
  const placeOf = (e: BuildIssue): string => (e.block !== undefined ? where(e.block) : e.where === 'preamble' ? 'Your preamble' : e.where === 'front' ? 'Title and authors' : e.file !== undefined ? e.file + (e.line !== undefined ? ', line ' + e.line : '') : '');
  return (
    <section aria-label="PDF" className={cn('flex min-h-0 flex-col border-l border-[var(--ro-line)] bg-[var(--ro-card)]', className)}>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-[var(--ro-line)] px-3 py-2">
        <span className="text-[13px] font-bold">PDF</span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--ro-muted)]" aria-live="polite">
          {running ? (
            <span className="inline-flex items-center gap-1.5">
              <Spinner size={11} /> {PHASE[build.phase] ?? 'Typesetting'}
            </span>
          ) : build === null ? (
            'Not built yet'
          ) : build.status === 'failed' ? (
            <span className="text-[var(--ro-red-text)]">The build failed</span>
          ) : (
            <>
              {ago(build.finished_at || build.created)} · {plural(build.pages, 'page')}
              {build.seconds > 0 && ' · ' + build.seconds.toFixed(1) + ' s'}
              {stale && <span className="font-semibold text-[var(--ro-amber-text)]"> · changed since</span>}
            </>
          )}
        </span>
        <Button size="sm" variant={build === null || stale || build.status === 'failed' ? 'primary' : 'secondary'} icon={Play} loading={starting} disabled={running} onClick={() => void start()} title="Build the PDF (Ctrl+S)">
          {build === null ? 'Build' : 'Build again'}
        </Button>
        {shown !== null && (
          <a href={opUrl('ms.pdf', { build: shown.id, download: true })} rel="noopener" aria-label="Download the PDF" title="Download the PDF" className="inline-flex size-7 items-center justify-center rounded-[var(--ro-r)] text-[var(--ro-ink-2)] hover:bg-[var(--ro-row)] hover:text-[var(--ro-ink)]">
            <Download size={14} />
          </a>
        )}
        <IconButton icon={Settings2} label="LaTeX settings" onClick={onSettings} />
        <IconButton ref={moreBtn} icon={MoreHorizontal} label="More" onClick={() => setMore((o) => !o)} />
        <IconButton icon={X} label="Close the PDF" onClick={onClose} />
        <Popover open={more} anchor={moreBtn} onClose={() => setMore(false)} align="right" className="w-60">
          <button type="button" className={menuItem} disabled={build === null || running} onClick={() => void openLog()}>
            <ScrollText size={14} /> The engine's log
          </button>
          <button type="button" className={menuItem} onClick={() => void source()}>
            <FileArchive size={14} /> Download the LaTeX source (.zip)
          </button>
        </Popover>
      </div>
      {!running && build !== null && (errors.length > 0 || warns.length > 0) && (
        <div className="max-h-[38%] shrink-0 overflow-y-auto border-b border-[var(--ro-line)] px-3 py-2">
          <p className="mb-1 flex items-center gap-1.5 text-[12px] font-bold">
            {errors.length > 0 ? <CircleAlert size={13} className="text-[var(--ro-red)]" /> : <AlertTriangle size={13} className="text-[var(--ro-amber)]" />}
            <span className="flex-1">
              {errors.length > 0 ? plural(errors.length, 'error') : 'No errors'}
              {build.status === 'done' && errors.length > 0 && <span className="font-normal text-[var(--ro-muted)]"> (the PDF was made around them)</span>}
            </span>
            {warns.length > 0 && (
              <button type="button" onClick={() => setWarnings((w) => !w)} className="font-semibold text-[var(--ro-ink-2)] underline-offset-2 hover:underline">
                {warnings ? 'Hide' : 'Show'} {plural(warns.length, 'warning')}
              </button>
            )}
          </p>
          <ul className="flex flex-col gap-1">
            {[...errors, ...(warnings ? warns : [])].map((e, i) => (
              <li key={i} className="flex items-start gap-2 text-[12px] leading-4">
                {e.level === 'error' ? <CircleAlert size={12} className="mt-0.5 shrink-0 text-[var(--ro-red)]" /> : <AlertTriangle size={12} className="mt-0.5 shrink-0 text-[var(--ro-amber)]" />}
                <span className="min-w-0 flex-1">
                  <span className="break-words">{e.message}</span>
                  {placeOf(e) !== '' && <span className="block text-[var(--ro-muted)]">{placeOf(e)}</span>}
                </span>
                {e.block !== undefined ? (
                  <button type="button" onClick={() => onGoTo(e.block as string)} className="shrink-0 font-semibold underline-offset-2 hover:underline">
                    Go to
                  </button>
                ) : e.where !== undefined ? (
                  <button type="button" onClick={onSettings} className="shrink-0 font-semibold underline-offset-2 hover:underline">
                    Open
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div data-scroll className="min-h-0 flex-1 overflow-y-auto bg-[var(--ro-stage)] p-3">
        {shown !== null ? (
          <PdfDoc key={shown.id} id={shown.id} />
        ) : running ? (
          <p className="py-10 text-center text-[13px] text-[var(--ro-muted)]">The PDF shows here when it is ready.</p>
        ) : (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <FileText size={20} className="text-[var(--ro-muted)]" />
            <span className="text-[13px] font-semibold">{build?.status === 'failed' ? 'No PDF came out' : 'See the manuscript as a PDF'}</span>
            <span className="max-w-[34ch] text-[12px] leading-4 text-[var(--ro-muted)]">LaTeX typesets it on this computer in the venue's layout, with your figures, tables, equations and references.</span>
          </div>
        )}
      </div>
      <Modal open={log !== null} onClose={() => setLog(null)} title="The engine's log" icon={ScrollText} xl>
        <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-4">{log === '' ? 'No log.' : log}</pre>
      </Modal>
    </section>
  );
}

/** Every page of a build's PDF, as wide as the pane; pages draw as they come into view. */
function PdfDoc({ id }: { id: string }): React.JSX.Element {
  const box = useRef<HTMLDivElement | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState(false);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    let on = true;
    openDocument('ms:' + id, opUrl('ms.pdf', { build: id }))
      .then((d) => on && setDoc(d))
      .catch(() => on && setError(true));
    return () => {
      on = false;
    };
  }, [id]);
  useEffect(() => {
    const el = box.current;
    if (el === null) return;
    const ro = new ResizeObserver((en) => setWidth(Math.min(1100, Math.floor(en[0]?.contentRect.width ?? 0))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={box} className="flex w-full flex-col items-center gap-3">
      {error ? <p className="text-[13px] text-[var(--ro-red-text)]">Could not open this PDF. Download it to read it.</p> : doc === null || width === 0 ? <Spinner /> : Array.from({ length: doc.numPages }, (_, i) => <PdfPage key={i} doc={doc} n={i + 1} width={width} />)}
    </div>
  );
}

function PdfPage({ doc, n, width }: { doc: PDFDocumentProxy; n: number; width: number }): React.JSX.Element {
  const holder = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [seen, setSeen] = useState(n <= 2);
  const [ratio, setRatio] = useState(1.294);
  useEffect(() => {
    const el = holder.current;
    if (el === null || seen) return;
    const io = new IntersectionObserver((en) => en.some((x) => x.isIntersecting) && setSeen(true), { rootMargin: '800px' });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  useEffect(() => {
    if (!seen) return;
    let on = true;
    let cancel = (): void => undefined;
    void doc.getPage(n).then((pg) => {
      const c = canvas.current;
      if (!on || c === null) return;
      const vp = pg.getViewport({ scale: 1 });
      setRatio(vp.height / vp.width);
      cancel = drawPage(pg, c, width / vp.width);
    });
    return () => {
      on = false;
      cancel();
    };
  }, [seen, width, doc, n]);
  return (
    <div ref={holder} aria-label={'Page ' + n} style={{ width, height: Math.round(width * ratio) }} className="shrink-0 overflow-hidden bg-white shadow-[var(--ro-shadow-sm)]">
      <canvas ref={canvas} className="block h-full w-full" />
    </div>
  );
}

/* ------------------------------------------------------------- settings */

interface LatexInfo {
  preamble_default: string;
  own_preamble: boolean;
  style: { folder: { id: string; path: string } | null; missing: boolean; cls: string; sty: string[]; bst: string; files: string[] };
}

/**
 * LaTeX settings: each change is saved as you make it (the venue and style
 * folder at once, authors and the preamble a moment after you stop typing).
 */
export function LatexSettings({ open, onClose, ms, project, template, authors, preamble }: { open: boolean; onClose: () => void; ms: string; project: string; template: string; authors: Author[]; preamble: string }): React.JSX.Element {
  const info = useLive((signal) => (open ? op<LatexInfo>('ms.latex', { manuscript: ms }, { quiet: true, signal }) : Promise.resolve(null)), ['manuscripts', 'repo_items'], [ms, open], 200);
  const folders = useLive((signal) => (open ? op<RepoList>('repo.list', { project }, { quiet: true, signal }).then((r) => r.items.filter((i) => i.kind === 'folder')) : Promise.resolve(null)), ['repo_items'], [project, open], 200);
  const [list, setList] = useState<Author[]>(authors);
  const [text, setText] = useState(preamble);
  const [own, setOwn] = useState(preamble.trim() !== '');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Record<string, unknown>>({});
  useEffect(() => {
    if (!open) return;
    setList(authors.length > 0 ? authors : []);
    setText(preamble);
    setOwn(preamble.trim() !== '');
    // Only when it opens: what you type here is not replaced from the server meanwhile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const flush = useCallback(async (): Promise<void> => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const patch = pending.current;
    pending.current = {};
    if (Object.keys(patch).length === 0) return;
    try {
      await op('ms.update', { manuscript: ms, ...patch });
      changed('manuscripts');
    } catch {
      /* toasted */
    }
  }, [ms]);
  const later = (patch: Record<string, unknown>): void => {
    Object.assign(pending.current, patch);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 800);
  };
  const now = (patch: Record<string, unknown>): void => {
    Object.assign(pending.current, patch);
    void flush();
  };
  const close = (): void => {
    void flush();
    onClose();
  };
  const setAuthors = (next: Author[]): void => {
    setList(next);
    later({ authors: next.filter((a) => a.name.trim() !== '') });
  };
  const venueStyle = OWN_STYLE.has(template);
  const style = info.data?.style;
  const folderOptions = useMemo(() => [{ value: '', label: 'None' }, ...(folders.data ?? []).map((f) => ({ value: f.id, label: f.path }))], [folders.data]);
  return (
    <Modal open={open} onClose={close} title="LaTeX settings" description="How the PDF is typeset" icon={Settings2} wide footer={<Button variant="primary" onClick={close}>Done</Button>}>
      <div className="flex flex-col gap-4">
        <Field label="Venue" hint="Sets the document class, how the title and authors are set, and the references style.">
          <Select ariaLabel="Venue" value={template} onChange={(v) => now({ template: v })} options={VENUES} />
        </Field>
        <Field label="Authors">
          <ul className="flex flex-col gap-1.5">
            {list.map((a, i) => (
              <li key={i} className="flex items-center gap-1">
                <input value={a.name} onChange={(e) => setAuthors(list.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Name" aria-label={'Author ' + (i + 1) + ' name'} className={cn(inputCls, 'flex-[1.1]')} />
                <input value={a.affiliation} onChange={(e) => setAuthors(list.map((x, j) => (j === i ? { ...x, affiliation: e.target.value } : x)))} placeholder="Affiliation" aria-label={'Author ' + (i + 1) + ' affiliation'} className={cn(inputCls, 'flex-[1.4]')} />
                <input value={a.email} onChange={(e) => setAuthors(list.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))} placeholder="Email" aria-label={'Author ' + (i + 1) + ' email'} className={cn(inputCls, 'flex-1')} />
                <IconButton icon={ArrowUp} label="Move up" size={24} disabled={i === 0} onClick={() => setAuthors(list.map((x, j) => (j === i - 1 ? (list[i] as Author) : j === i ? (list[i - 1] as Author) : x)))} />
                <IconButton icon={ArrowDown} label="Move down" size={24} disabled={i === list.length - 1} onClick={() => setAuthors(list.map((x, j) => (j === i + 1 ? (list[i] as Author) : j === i ? (list[i + 1] as Author) : x)))} />
                <IconButton icon={Trash2} label="Remove the author" size={24} variant="danger" onClick={() => setAuthors(list.filter((_, j) => j !== i))} />
              </li>
            ))}
          </ul>
          <Button size="sm" variant="ghost" icon={Plus} className="self-start" onClick={() => setList([...list, { name: '', affiliation: '', email: '' }])}>
            Add an author
          </Button>
        </Field>
        <Field
          label="Style folder"
          hint={
            style?.missing === true
              ? 'The folder chosen was deleted.'
              : style?.folder
                ? 'Uses ' + [style.cls !== '' ? style.cls + '.cls' : '', ...style.sty.map((s) => s + '.sty'), style.bst !== '' ? style.bst + '.bst' : ''].filter((x) => x !== '').join(', ') + (style.cls === '' && style.sty.length === 0 && style.bst === '' ? 'no .cls, .sty or .bst files at its top' : '') + '.'
                : venueStyle
                  ? (VENUES.find((v) => v.value === template)?.label ?? 'This venue') + ' publishes its style files on its website. Put them in a folder of the repository and choose it here.'
                  : "A repository folder with a venue's own .cls, .sty or .bst files, when LaTeX does not have them."
          }
        >
          <Select ariaLabel="Style folder" value={style?.missing === true ? '' : (style?.folder?.id ?? '')} onChange={(v) => now({ style_folder: v })} options={folderOptions} />
        </Field>
        <Field label="Preamble" hint={own ? 'Everything from \\documentclass to the title. Packages and commands you add here work in maths and LaTeX blocks too.' : "The venue's preamble. Write your own to add packages or commands."}>
          {info.data === null ? (
            <Spinner />
          ) : (
            <>
              <textarea
                value={own ? text : info.data.preamble_default}
                readOnly={!own}
                rows={12}
                spellCheck={false}
                aria-label="Preamble"
                onChange={(e) => {
                  setText(e.target.value);
                  later({ preamble: e.target.value });
                }}
                className={cn(textareaCls, 'font-mono text-[12px] leading-4', !own && 'bg-[var(--ro-row)] text-[var(--ro-ink-2)]')}
              />
              <span className="flex gap-1.5">
                {own ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={RotateCcw}
                    onClick={() => {
                      setOwn(false);
                      setText('');
                      now({ preamble: '' });
                    }}
                  >
                    Use the venue's again
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    icon={PenLine}
                    onClick={() => {
                      const start = info.data?.preamble_default ?? '';
                      setOwn(true);
                      setText(start);
                      later({ preamble: start });
                    }}
                  >
                    Write your own
                  </Button>
                )}
              </span>
            </>
          )}
        </Field>
      </div>
    </Modal>
  );
}

/** Ctrl+S (Cmd+S) builds, as in LaTeX editors. */
export function useBuildKey(onBuild: () => void): void {
  const fn = useRef(onBuild);
  fn.current = onBuild;
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        fn.current();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
}

export function toastBuilding(): void {
  toast.success('Building the PDF: download it from the PDF pane when it is ready');
}
