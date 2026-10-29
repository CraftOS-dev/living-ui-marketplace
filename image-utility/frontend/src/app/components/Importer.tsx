/**
 * Bringing images in, from anywhere in the app: the rail's Import button
 * (a dialog with a drop zone and a path field for files and folders on this
 * computer), dropping files on any page, and pasting an image (Ctrl+V).
 * One image opens in the workspace; several go to the library.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { FolderInput, ImagePlus, Upload } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api } from '../lib/api.ts';
import { plural } from '../lib/format.ts';
import { navigate } from '../lib/router.ts';
import type { ImageRec } from '../lib/types.ts';
import { Button, Field, Modal, Spinner, errMessage, inputCls } from './ui.tsx';

const ACCEPT = '.png,.jpg,.jpeg,.jfif,.webp,.avif,.gif,.bmp,.tif,.tiff,.ico,.apng,.jp2,.tga,.ppm,.pgm,.pbm,.pcx,.psd,.dds,.icns,.qoi';

interface Importer {
  open: () => void;
  importFiles: (files: File[]) => Promise<ImageRec[]>;
  busy: boolean;
}

const Ctx = createContext<Importer | null>(null);

export function useImporter(): Importer {
  const v = useContext(Ctx);
  if (v === null) throw new Error('useImporter outside ImporterProvider');
  return v;
}

function isImage(f: File): boolean {
  return f.type.startsWith('image/') || /\.(png|jpe?g|jfif|webp|avif|gif|bmp|tiff?|ico|apng|jp2|tga|ppm|pgm|pbm|pcx|psd|dds|icns|qoi)$/i.test(f.name);
}

function done(images: ImageRec[], failed: { name?: string; path?: string; error: string }[]): void {
  if (failed.length > 0) toast.error(failed.length === 1 ? (failed[0]?.name ?? failed[0]?.path ?? 'A file') + ': ' + (failed[0]?.error ?? '') : plural(failed.length, 'file') + ' could not be read');
  if (images.length === 0) return;
  toast.success('Imported ' + plural(images.length, 'image'));
  if (images.length === 1 && images[0] !== undefined) navigate('image', { id: images[0].id });
  else navigate('home');
}

export function ImporterProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  const importFiles = useCallback(async (files: File[]): Promise<ImageRec[]> => {
    const list = files.filter(isImage);
    if (list.length === 0) {
      toast.error('Those are not image files this app reads (PNG, JPEG, WebP, AVIF, GIF, TIFF, BMP, ICO and more)');
      return [];
    }
    setBusy(true);
    try {
      const r = await api.importFiles(list);
      done(r.images, r.failed);
      setDialog(false);
      return r.images;
    } catch (err) {
      toast.error(errMessage(err));
      return [];
    } finally {
      setBusy(false);
    }
  }, []);

  // Drop anywhere; paste an image from the clipboard.
  useEffect(() => {
    const hasFiles = (e: DragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const enter = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current += 1;
      setDragging(true);
    };
    const over = (e: DragEvent): void => {
      if (hasFiles(e)) e.preventDefault();
    };
    const leave = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };
    const drop = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length > 0) void importFiles(files);
    };
    const paste = (e: ClipboardEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t !== null && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const files = Array.from(e.clipboardData?.files ?? []).filter(isImage);
      if (files.length === 0) return;
      e.preventDefault();
      const named = files.map((f, i) => (f.name === 'image.png' || f.name === '' ? new File([f], 'Pasted ' + new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '.') + (i > 0 ? ' ' + (i + 1) : '') + '.png', { type: f.type }) : f));
      void importFiles(named);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    window.addEventListener('paste', paste);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
      window.removeEventListener('paste', paste);
    };
  }, [importFiles]);

  const value = useMemo<Importer>(() => ({ open: () => setDialog(true), importFiles, busy }), [importFiles, busy]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <ImportDialog open={dialog} onClose={() => setDialog(false)} busy={busy} onFiles={(f) => void importFiles(f)} />
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center bg-[var(--iu-shell)]/70 p-6 backdrop-blur-[2px]">
          <div className="iu-pop flex flex-col items-center gap-2 rounded-[var(--iu-r-lg)] border-2 border-dashed border-[var(--iu-ink)] bg-[var(--iu-card)] px-10 py-8 text-center shadow-[var(--iu-shadow)]">
            <Upload size={22} aria-hidden className="text-[var(--iu-accent-text)]" />
            <p className="text-[14px] font-bold">Drop to import</p>
            <p className="text-[12px] text-[var(--iu-muted)]">Originals are kept; every edit is undoable.</p>
          </div>
        </div>
      )}
      {busy && !dialog && (
        <div className="fixed bottom-16 right-4 z-[65] flex items-center gap-2 rounded-[var(--iu-r-md)] bg-[var(--iu-ink)] px-3 py-2 text-[13px] font-semibold text-[var(--iu-shell)] shadow-[var(--iu-shadow)] md:bottom-4">
          <Spinner size={13} /> Importing
        </div>
      )}
    </Ctx.Provider>
  );
}

function ImportDialog({ open, onClose, busy, onFiles }: { open: boolean; onClose: () => void; busy: boolean; onFiles: (f: File[]) => void }): React.JSX.Element {
  const input = useRef<HTMLInputElement | null>(null);
  const [path, setPath] = useState('');
  const [working, setWorking] = useState(false);
  const [over, setOver] = useState(false);

  const fromPath = async (): Promise<void> => {
    const p = path.trim().replace(/^"|"$/g, '');
    if (p === '') return;
    setWorking(true);
    try {
      const isFile = /\.[a-z0-9]{2,5}$/i.test(p);
      const r = await api.importPaths(isFile ? { path: p } : { folder: p });
      done(r.images, r.failed);
      setPath('');
      onClose();
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setWorking(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Import images" wide>
      <div className="flex flex-col gap-4">
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOver(false);
            onFiles(Array.from(e.dataTransfer.files));
          }}
          className={cn(
            'flex flex-col items-center gap-2 rounded-[var(--iu-r-md)] border-2 border-dashed px-6 py-9 text-center transition-colors',
            over ? 'border-[var(--iu-ink)] bg-[var(--iu-row)]' : 'border-[var(--iu-line)] bg-[var(--iu-card)] hover:border-[var(--iu-muted)]',
          )}
        >
          {busy ? <Spinner size={20} /> : <ImagePlus size={22} aria-hidden className="text-[var(--iu-accent-text)]" />}
          <span className="text-[13px] font-bold">{busy ? 'Importing' : 'Drop images here, or choose files'}</span>
          <span className="text-[12px] text-[var(--iu-muted)]">PNG, JPEG, WebP, AVIF, GIF (animated too), TIFF, BMP, ICO, PSD and more. You can also paste an image anywhere with Ctrl+V.</span>
        </button>
        <input
          ref={input}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (files.length > 0) onFiles(files);
          }}
        />
        <Field label="Or a file or folder on this computer" hint="An absolute path. A folder brings in every image in it (not its subfolders); nothing is uploaded.">
          <div className="flex gap-1.5">
            <input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void fromPath()}
              placeholder="C:\Users\you\Pictures\Shoot"
              aria-label="Path"
              className={cn(inputCls, 'mono')}
              spellCheck={false}
            />
            <Button icon={FolderInput} loading={working} disabled={path.trim() === ''} onClick={() => void fromPath()}>
              Import
            </Button>
          </div>
        </Field>
      </div>
    </Modal>
  );
}
