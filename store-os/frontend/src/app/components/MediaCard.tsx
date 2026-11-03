/**
 * The Media card: a product's pictures, the first one large as the cover.
 * Pictures come from the picker or a drop (several at once); each can be
 * opened large, made the cover or removed. A new product keeps its files
 * here (with previews) until it is saved; a saved product uploads them at
 * once, showing each file with a spinner until the server has it.
 */
import { useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { ChevronLeft, ChevronRight, ImagePlus, Plus, Star, Trash2, Upload } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { op } from '../lib/api.ts';
import { changed } from '../lib/live.ts';
import { notify } from '../lib/toast.tsx';
import type { ProductDetail } from '../lib/types.ts';
import { IMAGE_TYPES, addImages, fileUrl } from './ProductDialogs.tsx';
import { Button, Card, CardHeader, Dialog, IconBadge, IconButton, Pill, confirmAsk } from './ui.tsx';

export const MAX_PICTURES = 12;
const MAX_BYTES = 10 * 1024 * 1024;

/** A picture chosen on this computer, with a preview link (revoke it when done). */
export interface LocalPicture {
  id: string;
  file: File;
  url: string;
}

let seq = 0;

export function localPictures(files: File[]): LocalPicture[] {
  return files.map((file) => ({ id: 'local-' + String(++seq), file, url: URL.createObjectURL(file) }));
}

/** The files that can be added next to `have` pictures; says why the others cannot. */
export function acceptPictures(files: File[], have: number): File[] {
  const ok: File[] = [];
  for (const f of files) {
    if (!IMAGE_TYPES.includes(f.type)) notify.error(f.name + ' is not a JPG, PNG or WebP picture');
    else if (f.size > MAX_BYTES) notify.error(f.name + ' is over 10 MB');
    else ok.push(f);
  }
  const room = Math.max(0, MAX_PICTURES - have);
  if (ok.length > room) notify.error(room === 0 ? 'A product holds 12 pictures at most' : 'Only ' + String(room) + ' more fit: a product holds 12 pictures at most');
  return ok.slice(0, room);
}

interface MediaTile {
  key: string;
  /** Shown in the grid. */
  src: string;
  /** Shown large. */
  full: string;
  busy: boolean;
}

function hasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes('Files');
}

/* ------------------------------------------------------------------- view */

function MediaView({ tiles, onFiles, onCover, onRemove }: { tiles: MediaTile[]; onFiles: (files: File[]) => void; onCover: (key: string) => void; onRemove: (key: string) => void }): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [viewing, setViewing] = useState('');
  const room = MAX_PICTURES - tiles.length;
  const browse = (): void => input.current?.click();
  const take = (list: File[]): void => {
    const files = acceptPictures(list, tiles.length);
    if (files.length > 0) onFiles(files);
  };
  const drag = {
    onDragOver: (e: DragEvent<HTMLDivElement>) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = room > 0 ? 'copy' : 'none';
      if (!over) setOver(true);
    },
    onDragLeave: (e: DragEvent<HTMLDivElement>) => {
      if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) setOver(false);
    },
    onDrop: (e: DragEvent<HTMLDivElement>) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setOver(false);
      take(Array.from(e.dataTransfer.files));
    },
  };
  const viewIndex = tiles.findIndex((t) => t.key === viewing);

  return (
    <Card className="@container">
      <CardHeader title="Media" subtitle={tiles.length > 0 ? String(tiles.length) + ' of 12, the first is the cover' : 'Pictures sell: shops need at least one'} />
      <input
        ref={input}
        type="file"
        accept={IMAGE_TYPES.join(',')}
        multiple
        className="hidden"
        tabIndex={-1}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          take(files);
        }}
      />
      {tiles.length === 0 ? (
        <div
          {...drag}
          onClick={browse}
          className={cn(
            'flex min-h-[220px] cursor-pointer flex-col items-center justify-center gap-4 rounded-[16px] border-[1.5px] border-dashed px-6 py-8 text-center transition-colors',
            over ? 'border-solid border-[var(--so-ink)] bg-[var(--so-row-hover)]' : 'border-[var(--so-faint)] hover:bg-[var(--so-row-hover)]',
          )}
        >
          <IconBadge icon={ImagePlus} size={48} />
          <div className="flex flex-col items-center gap-2">
            <Button
              icon={Upload}
              onClick={(e) => {
                e.stopPropagation();
                browse();
              }}
            >
              Add pictures
            </Button>
            <span className="text-[13px] font-medium text-[var(--so-ink-2)]">or drop them here</span>
          </div>
          <p className="max-w-[440px] text-[12px] leading-[18px] text-[var(--so-muted)]">JPG, PNG or WebP, up to 10 MB each, 12 at most. The first is the cover.</p>
        </div>
      ) : (
        <div {...drag} className={cn('rounded-[16px] transition-shadow', over && 'ring-2 ring-[var(--so-ink)] ring-offset-4 ring-offset-[var(--so-card)]')}>
          <div className="grid grid-cols-3 gap-3 @md:grid-cols-4 @xl:grid-cols-5">
            {tiles.map((t, i) => (
              <PictureTile key={t.key} tile={t} index={i} onOpen={() => setViewing(t.key)} onCover={() => onCover(t.key)} onRemove={() => onRemove(t.key)} />
            ))}
            {room > 0 && (
              <button
                type="button"
                onClick={browse}
                aria-label="Add pictures"
                className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-[14px] border-[1.5px] border-dashed border-[var(--so-faint)] text-[var(--so-muted)] hover:bg-[var(--so-row-hover)] hover:text-[var(--so-ink)]"
              >
                <Plus size={20} aria-hidden />
                <span className="text-[12px] font-semibold">Add</span>
              </button>
            )}
          </div>
        </div>
      )}
      <Viewer
        tiles={tiles}
        index={viewIndex}
        onIndex={(i) => setViewing(tiles[i]?.key ?? '')}
        onClose={() => setViewing('')}
        onCover={(key) => {
          onCover(key);
          setViewing('');
        }}
        onRemove={(key) => {
          onRemove(key);
          setViewing('');
        }}
      />
    </Card>
  );
}

function PictureTile({ tile, index, onOpen, onCover, onRemove }: { tile: MediaTile; index: number; onOpen: () => void; onCover: () => void; onRemove: () => void }): React.JSX.Element {
  const cover = index === 0;
  return (
    <div className={cn('group relative aspect-square overflow-hidden rounded-[14px] bg-[var(--so-tile)]', cover && 'col-span-2 row-span-2')}>
      <button type="button" onClick={onOpen} aria-label={cover ? 'Open the cover picture' : 'Open picture ' + String(index + 1)} className="block size-full rounded-[14px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--so-ink)]">
        <img src={tile.src} alt="" loading="lazy" draggable={false} className="size-full object-cover" />
      </button>
      {cover && (
        <Pill tone="ink" className="pointer-events-none absolute left-2 top-2">
          Cover
        </Pill>
      )}
      {tile.busy ? (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span role="status" aria-label="Uploading" className="flex size-9 items-center justify-center rounded-full bg-[var(--so-card)] shadow-[0_8px_24px_-8px_var(--so-shadow)]">
            <span aria-hidden className="so-spin size-4 rounded-full border-2 border-[var(--so-ink)] border-t-transparent" />
          </span>
        </span>
      ) : (
        <div className="so-hover-show absolute bottom-2 right-2 flex gap-1.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          {!cover && <IconButton icon={Star} label="Make cover" variant="card" size={32} onClick={onCover} />}
          <IconButton icon={Trash2} label="Remove" variant="card" size={32} onClick={onRemove} />
        </div>
      )}
    </div>
  );
}

/** One picture large, with the next and previous ones a key away. */
function Viewer({ tiles, index, onIndex, onClose, onCover, onRemove }: { tiles: MediaTile[]; index: number; onIndex: (i: number) => void; onClose: () => void; onCover: (key: string) => void; onRemove: (key: string) => void }): React.JSX.Element | null {
  const t = index >= 0 ? tiles[index] : undefined;
  const n = tiles.length;
  useEffect(() => {
    if (t === undefined) return;
    const k = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowRight' && index < n - 1) onIndex(index + 1);
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [t, index, n, onIndex]);
  if (t === undefined) return null;
  return (
    <Dialog
      open
      onClose={onClose}
      width={760}
      title={index === 0 ? 'Cover picture' : 'Picture ' + String(index + 1)}
      subtitle={String(index + 1) + ' of ' + String(n)}
      footer={
        <>
          {!t.busy && (
            <Button variant="tile" icon={Trash2} onClick={() => onRemove(t.key)} className="mr-auto">
              Remove
            </Button>
          )}
          {index > 0 && !t.busy && (
            <Button variant="secondary" icon={Star} onClick={() => onCover(t.key)}>
              Make cover
            </Button>
          )}
          <Button onClick={onClose}>Done</Button>
        </>
      }
    >
      <div className="relative flex min-h-[240px] items-center justify-center overflow-hidden rounded-[14px] bg-[var(--so-tile)]">
        <img src={t.full} alt="" className="max-h-[60vh] w-auto max-w-full object-contain" />
        {index > 0 && <IconButton icon={ChevronLeft} label="Previous picture" variant="card" size={36} onClick={() => onIndex(index - 1)} className="absolute left-3 top-1/2 -translate-y-1/2" />}
        {index < n - 1 && <IconButton icon={ChevronRight} label="Next picture" variant="card" size={36} onClick={() => onIndex(index + 1)} className="absolute right-3 top-1/2 -translate-y-1/2" />}
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------- a new product */

/** Pictures of a product that is not saved yet: kept here, uploaded after it is created. */
export function DraftMedia({ pictures, onChange }: { pictures: LocalPicture[]; onChange: (p: LocalPicture[]) => void }): React.JSX.Element {
  const tiles: MediaTile[] = pictures.map((p) => ({ key: p.id, src: p.url, full: p.url, busy: false }));
  return (
    <MediaView
      tiles={tiles}
      onFiles={(files) => onChange([...pictures, ...localPictures(files)])}
      onCover={(key) => {
        const p = pictures.find((x) => x.id === key);
        if (p !== undefined) onChange([p, ...pictures.filter((x) => x.id !== key)]);
      }}
      onRemove={(key) => {
        const p = pictures.find((x) => x.id === key);
        if (p !== undefined) URL.revokeObjectURL(p.url);
        onChange(pictures.filter((x) => x.id !== key));
      }}
    />
  );
}

/* ----------------------------------------------------- a saved product */

interface Upload extends LocalPicture {
  /** The pictures the product had when this upload started. */
  before: string[];
  done: boolean;
}

/** Pictures of a saved product: added files upload at once. */
export function ProductMedia({ product }: { product: ProductDetail }): React.JSX.Element {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const live = useRef<Upload[]>([]);
  useEffect(() => {
    live.current = uploads;
  }, [uploads]);
  useEffect(
    () => () => {
      for (const u of live.current) URL.revokeObjectURL(u.url);
    },
    [],
  );
  // A finished upload leaves once the product shows a picture it did not have before.
  const names = product.images.map((im) => im.name);
  const namesKey = names.join('|');
  useEffect(() => {
    const now = namesKey.split('|');
    setUploads((list) => {
      const keep = list.filter((u) => !(u.done && now.some((n) => n !== '' && !u.before.includes(n))));
      if (keep.length === list.length) return list;
      for (const u of list) if (!keep.includes(u)) URL.revokeObjectURL(u.url);
      return keep;
    });
  }, [namesKey]);

  const upload = async (files: File[]): Promise<void> => {
    const batch: Upload[] = localPictures(files).map((p) => ({ ...p, before: names, done: false }));
    const ids = batch.map((b) => b.id);
    setUploads((u) => [...u, ...batch]);
    try {
      await addImages(product.id, files);
      setUploads((u) => u.map((x) => (ids.includes(x.id) ? { ...x, done: true } : x)));
      changed('products', 'listings');
      notify.info(files.length === 1 ? 'Picture added' : String(files.length) + ' pictures added');
      // Safety: never leave a spinner behind if the reload is slow to arrive.
      setTimeout(() => {
        setUploads((u) => {
          const gone = u.filter((x) => ids.includes(x.id));
          for (const g of gone) URL.revokeObjectURL(g.url);
          return gone.length === 0 ? u : u.filter((x) => !ids.includes(x.id));
        });
      }, 6000);
    } catch {
      setUploads((u) => {
        for (const x of u) if (ids.includes(x.id)) URL.revokeObjectURL(x.url);
        return u.filter((x) => !ids.includes(x.id));
      });
    }
  };
  const cover = async (name: string): Promise<void> => {
    try {
      await op('products.cover', { product: product.id, name });
      changed('products', 'listings');
      notify.info('Cover changed');
    } catch {
      /* op showed why */
    }
  };
  const remove = async (name: string): Promise<void> => {
    const ok = await confirmAsk('Remove this picture?', undefined, 'Remove picture', { danger: true });
    if (!ok) return;
    try {
      await op('products.remove-image', { product: product.id, name });
      changed('products', 'listings');
      notify.info('Picture removed');
    } catch {
      /* op showed why */
    }
  };

  const tiles: MediaTile[] = [
    ...product.images.map((im, i) => ({ key: im.name, src: fileUrl(i === 0 ? im.url + '?thumb=800x0' : im.thumb), full: fileUrl(im.url), busy: false })),
    ...uploads.map((u) => ({ key: u.id, src: u.url, full: u.url, busy: true })),
  ];
  return <MediaView tiles={tiles} onFiles={(f) => void upload(f)} onCover={(key) => void cover(key)} onRemove={(key) => void remove(key)} />;
}
