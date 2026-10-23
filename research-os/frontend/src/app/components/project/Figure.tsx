/**
 * A figure in a manuscript: a picture or PDF from the project's repository,
 * drawn at its width (drag either edge; LaTeX gets the same share of the
 * text width). Without one it offers the repository and an upload. Uploads
 * go to the repository's figures folder, so the file keeps its versions and
 * is the very file the PDF is built with.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, FileText, FolderOpen, ImageOff, Search, Upload } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { op, opForm, opUrl } from '../../lib/api.ts';
import { changed, useLive } from '../../lib/live.ts';
import type { RepoItem, RepoList } from '../../lib/types.ts';
import { Button, Empty, IconButton, Modal, Spinner, inputCls } from '../ui.tsx';
import { drawPage, openDocument } from '../reader/pdf.ts';
import { size } from '../repo/shared.tsx';

export interface FigureFile {
  id: string;
  name: string;
  path: string;
  ext: string;
  version: number;
  bytes: number;
  /** PNG, JPG or PDF: what LaTeX can place. */
  supported: boolean;
  empty: boolean;
}

const PICTURE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif']);
const TAKES = new Set(['png', 'jpg', 'jpeg', 'pdf']);
const extOf = (name: string): string => (name.lastIndexOf('.') < 0 ? '' : name.slice(name.lastIndexOf('.') + 1).toLowerCase());
export const FIGURE_ACCEPT = 'image/png,image/jpeg,application/pdf';

/** Put a file in the repository's figures folder; returns its item. */
export async function uploadFigure(project: string, file: File): Promise<RepoItem | null> {
  try {
    const r = await opForm<{ uploaded: { item: RepoItem }[] }>('repo.upload', { project, folder: '', path: 'figures' }, { files: [file] });
    changed('repo_items', 'repo_versions');
    return r.uploaded[0]?.item ?? null;
  } catch {
    return null;
  }
}

function pickFile(onFile: (f: File) => void): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = FIGURE_ACCEPT;
  input.onchange = () => {
    const f = input.files?.[0];
    if (f !== undefined) onFile(f);
  };
  input.click();
}

export function FigureMedia({ project, fileId, file, width, choose, onChosen, onFile, onWidth }: { project: string; fileId: string; file: FigureFile | null | undefined; width: number; choose: boolean; onChosen: () => void; onFile: (id: string) => void; onWidth: (w: number) => void }): React.JSX.Element {
  const box = useRef<HTMLDivElement | null>(null);
  const live = useRef<number | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const w = drag ?? width;
  // A figure just made from the / menu opens the repository at once.
  useEffect(() => {
    if (!choose) return;
    setChoosing(true);
    onChosen();
  }, [choose, onChosen]);

  const upload = async (f: File): Promise<void> => {
    if (!TAKES.has(extOf(f.name))) {
      toast.error('A figure is a PNG, JPG or PDF file.');
      return;
    }
    setBusy(true);
    const item = await uploadFigure(project, f);
    setBusy(false);
    if (item !== null) onFile(item.id);
  };
  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: (e: React.DragEvent) => {
      const f = e.dataTransfer.files[0];
      setOver(false);
      if (f === undefined) return;
      e.preventDefault();
      void upload(f);
    },
  };

  const resize = (side: 'left' | 'right') => (e: React.PointerEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    const col = box.current?.getBoundingClientRect().width ?? 1;
    const x0 = e.clientX;
    const w0 = width;
    // A figure is centred, so it grows on both sides: the pointer moves half as far.
    const factor = 2 * (side === 'right' ? 1 : -1);
    const move = (ev: PointerEvent): void => {
      const next = Math.round(Math.min(100, Math.max(10, w0 + (((ev.clientX - x0) * factor) / col) * 100)));
      live.current = next;
      setDrag(next);
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const next = live.current;
      live.current = null;
      setDrag(null);
      if (next !== null && next !== width) onWidth(next);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const chooser = <RepoPicker open={choosing} project={project} current={fileId} onClose={() => setChoosing(false)} onChoose={(id) => (setChoosing(false), onFile(id))} onUpload={(f) => (setChoosing(false), void upload(f))} />;

  if (fileId !== '' && file === undefined) {
    return (
      <div className="my-1 flex h-24 items-center justify-center rounded-[var(--ro-r)] border border-[var(--ro-line)]">
        <Spinner />
      </div>
    );
  }
  if (fileId === '' || file === null || file === undefined) {
    return (
      <div {...dropProps} className={cn('my-1 flex flex-col items-center gap-2 rounded-[var(--ro-r)] border border-dashed px-4 py-6 text-center', over ? 'border-[var(--ro-ink)] bg-[var(--ro-row)]' : 'border-[var(--ro-line)]')}>
        <ImageOff size={18} className="text-[var(--ro-muted)]" />
        <span className="text-[13px] font-semibold">{fileId === '' ? 'Choose the picture for this figure' : 'This picture is no longer in the repository'}</span>
        <span className="text-[12px] text-[var(--ro-muted)]">A PNG, JPG or PDF file. Drop one here, or</span>
        <span className="flex flex-wrap justify-center gap-1.5">
          <Button size="sm" icon={FolderOpen} onClick={() => setChoosing(true)}>
            Choose from the repository
          </Button>
          <Button size="sm" icon={Upload} loading={busy} onClick={() => pickFile((f) => void upload(f))}>
            Upload
          </Button>
        </span>
        {chooser}
      </div>
    );
  }

  const handle = (side: 'left' | 'right'): React.JSX.Element => (
    <span
      role="separator"
      aria-label={'Resize from the ' + side}
      aria-valuenow={w}
      onPointerDown={resize(side)}
      className={cn('absolute inset-y-0 flex w-4 cursor-ew-resize touch-none items-center justify-center opacity-0 transition-opacity group-hover/fig:opacity-100 [@media(hover:none)]:opacity-100', side === 'left' ? 'left-0' : 'right-0', drag !== null && 'opacity-100')}
    >
      <span className="h-12 max-h-[60%] w-1.5 rounded-full bg-black/55 ring-1 ring-white/80" />
    </span>
  );
  const url = opUrl('repo.file', { item: file.id, version: file.version });
  return (
    <div ref={box} {...dropProps} className="group/fig my-1 flex flex-col items-center">
      <div className={cn('relative', over && 'outline outline-2 outline-[var(--ro-ink)]')} style={{ width: w + '%' }}>
        {file.ext === 'pdf' ? <PdfFirstPage id={file.id + ':' + file.version} url={url} /> : PICTURE.has(file.ext) ? <img src={url} alt={file.name} draggable={false} className="block w-full rounded-[var(--ro-r)] border border-[var(--ro-line)] bg-white" /> : <span className="flex h-24 items-center justify-center rounded-[var(--ro-r)] border border-[var(--ro-line)] text-[12px] text-[var(--ro-muted)]">{file.name}</span>}
        {busy && (
          <span className="absolute inset-0 flex items-center justify-center bg-[var(--ro-card)]/60">
            <Spinner />
          </span>
        )}
        {handle('left')}
        {handle('right')}
        <span className="absolute right-2 top-2 flex items-center gap-0.5 rounded-[var(--ro-r)] border border-[var(--ro-line)] bg-[var(--ro-card)] p-0.5 opacity-0 shadow-[var(--ro-shadow-sm)] transition-opacity group-hover/fig:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
          <IconButton icon={FolderOpen} label="Choose another picture" size={24} onClick={() => setChoosing(true)} />
          <IconButton icon={Upload} label="Upload a picture" size={24} onClick={() => pickFile((f) => void upload(f))} />
        </span>
        {drag !== null && <span className="num absolute bottom-2 left-1/2 -translate-x-1/2 rounded-[var(--ro-r-sm)] bg-[rgba(0,0,0,0.7)] px-1.5 py-0.5 text-[12px] font-semibold text-white">{drag}% of the text width</span>}
      </div>
      {(!file.supported || file.empty) && (
        <p className="mt-1 flex items-center gap-1.5 text-[12px] text-[var(--ro-amber-text)]">
          <AlertTriangle size={12} /> {file.empty ? 'This file is empty.' : 'The PDF cannot take a .' + file.ext + ' picture: save it as PNG, JPG or PDF.'}
        </p>
      )}
      {chooser}
    </div>
  );
}

/** The first page of a PDF figure, as wide as its box. */
function PdfFirstPage({ id, url }: { id: string; url: string }): React.JSX.Element {
  const holder = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [ratio, setRatio] = useState(0.75);
  const [width, setWidth] = useState(0);
  const [error, setError] = useState(false);
  useEffect(() => {
    const el = holder.current;
    if (el === null) return;
    const ro = new ResizeObserver((en) => setWidth(Math.floor(en[0]?.contentRect.width ?? 0)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (width === 0) return;
    let on = true;
    let cancel = (): void => undefined;
    openDocument('figure:' + id, url)
      .then((doc) => doc.getPage(1))
      .then((pg) => {
        const c = canvas.current;
        if (!on || c === null) return;
        const vp = pg.getViewport({ scale: 1 });
        setRatio(vp.height / vp.width);
        cancel = drawPage(pg, c, width / vp.width);
      })
      .catch(() => on && setError(true));
    return () => {
      on = false;
      cancel();
    };
  }, [id, url, width]);
  return (
    <div ref={holder} style={{ height: width > 0 ? Math.round(width * ratio) : 120 }} className="w-full overflow-hidden rounded-[var(--ro-r)] border border-[var(--ro-line)] bg-white">
      {error ? <span className="flex h-full items-center justify-center text-[12px] text-[var(--ro-muted)]">Could not draw this PDF</span> : <canvas ref={canvas} className="block h-full w-full" />}
    </div>
  );
}

/** Pictures and PDFs of the project's repository to choose from, or one to upload. */
export function RepoPicker({ open, project, current, onClose, onChoose, onUpload }: { open: boolean; project: string; current: string; onClose: () => void; onChoose: (id: string) => void; onUpload: (f: File) => void }): React.JSX.Element {
  const list = useLive((signal) => (open ? op<RepoList>('repo.list', { project }, { quiet: true, signal }) : Promise.resolve(null)), ['repo_items'], [project, open], 200);
  const [q, setQ] = useState('');
  useEffect(() => {
    if (open) setQ('');
  }, [open]);
  const files = useMemo(() => {
    const all = (list.data?.items ?? []).filter((i) => i.kind === 'file' && (PICTURE.has(extOf(i.name)) || extOf(i.name) === 'pdf'));
    const s = q.trim().toLowerCase();
    return (s === '' ? all : all.filter((i) => i.path.toLowerCase().includes(s))).sort((a, b) => Number(TAKES.has(extOf(b.name))) - Number(TAKES.has(extOf(a.name))) || a.path.localeCompare(b.path));
  }, [list.data, q]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Choose a picture"
      description="Pictures and PDFs in this project's repository"
      icon={FolderOpen}
      wide
      footer={
        <>
          <Button icon={Upload} onClick={() => pickFile(onUpload)}>
            Upload from this computer
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </>
      }
    >
      <label className="relative mb-2 block">
        <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--ro-muted)]" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find by name or folder" aria-label="Find a picture" className={cn(inputCls, 'pl-7')} />
      </label>
      {list.data === null ? (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      ) : files.length === 0 ? (
        <Empty compact icon={ImageOff} title={q.trim() === '' ? 'No pictures in the repository yet' : 'No picture matches'}>
          Upload one: it goes to the figures folder.
        </Empty>
      ) : (
        <ul className="flex flex-col">
          {files.map((i) => {
            const ext = extOf(i.name);
            const takes = TAKES.has(ext);
            return (
              <li key={i.id}>
                <button type="button" disabled={!takes} onClick={() => onChoose(i.id)} className={cn('flex w-full items-center gap-2.5 rounded-[var(--ro-r)] px-2 py-1.5 text-left hover:bg-[var(--ro-row)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent', i.id === current && 'bg-[var(--ro-row-hover)]')}>
                  <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-[var(--ro-r-sm)] border border-[var(--ro-line)] bg-white">
                    {ext === 'pdf' ? <FileText size={15} className="text-[var(--ro-muted)]" /> : <img src={opUrl('repo.file', { item: i.id, version: i.version })} alt="" loading="lazy" className="size-full object-cover" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">{i.name}</span>
                    <span className="block truncate text-[12px] text-[var(--ro-muted)]">
                      {i.path} · {size(i.bytes)}
                      {!takes && ' · save as PNG, JPG or PDF to use it'}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
