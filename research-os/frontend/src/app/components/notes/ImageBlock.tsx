/**
 * A picture in a note: drag either edge to resize it (the shape is kept),
 * put it left, centred or right, give it a caption, and click it to see it
 * full size (Esc closes). While it uploads, its local preview shows.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlignCenter, AlignLeft, AlignRight, Download, ImageOff, Maximize2, X } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { opUrl } from '../../lib/api.ts';
import type { NoteBlock, NoteImage } from '../../lib/types.ts';
import { Button, IconButton, Spinner } from '../ui.tsx';

type Align = 'left' | 'center' | 'right';

export function ImageBlock({ b, onChange, onRemove }: { b: NoteBlock; onChange: (patch: Partial<NoteBlock>) => void; onRemove: () => void }): React.JSX.Element {
  const box = useRef<HTMLDivElement | null>(null);
  const live = useRef<number | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [view, setView] = useState(false);
  const [caption, setCaption] = useState(b.caption ?? '');
  useEffect(() => setCaption(b.caption ?? ''), [b.caption]);
  const ref = b.ref as NoteImage | null | undefined;
  const align: Align = b.align === 'left' || b.align === 'right' ? b.align : 'center';
  const width = drag ?? b.width ?? 100;
  const src = b.pending ?? (b.file !== undefined && b.file !== '' ? opUrl('notes.image', { file: b.file }) : '');
  const name = ref?.name ?? 'Picture';

  const resize = (side: 'left' | 'right') => (e: React.PointerEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    const col = box.current?.getBoundingClientRect().width ?? 1;
    const x0 = e.clientX;
    const w0 = width;
    // A centred picture grows on both sides, so the pointer moves half as far.
    const factor = (align === 'center' ? 2 : 1) * (side === 'right' ? 1 : -1);
    const move = (ev: PointerEvent): void => {
      const w = Math.round(Math.min(100, Math.max(15, w0 + (((ev.clientX - x0) * factor) / col) * 100)));
      live.current = w;
      setDrag(w);
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const w = live.current;
      live.current = null;
      setDrag(null);
      if (w !== null && w !== (b.width ?? 100)) onChange({ width: w });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  if (b.pending === undefined && (ref === null || src === '')) {
    return (
      <div className="group/img my-1 flex items-center gap-2 rounded-[var(--ro-r)] border border-dashed border-[var(--ro-line)] px-3 py-3 text-[12px] text-[var(--ro-muted)]">
        <ImageOff size={14} />
        <span className="flex-1">This picture is no longer here.</span>
        <IconButton icon={X} label="Remove" size={22} onClick={onRemove} />
      </div>
    );
  }

  const handle = (side: 'left' | 'right'): React.JSX.Element => (
    <span
      role="separator"
      aria-label={'Resize from the ' + side}
      aria-valuenow={width}
      onPointerDown={resize(side)}
      className={cn('absolute inset-y-0 flex w-4 cursor-ew-resize touch-none items-center justify-center opacity-0 transition-opacity group-hover/img:opacity-100 [@media(hover:none)]:opacity-100', side === 'left' ? 'left-0' : 'right-0', drag !== null && 'opacity-100')}
    >
      <span className="h-12 max-h-[60%] w-1.5 rounded-full bg-black/55 ring-1 ring-white/80" />
    </span>
  );

  return (
    <figure ref={box} className="group/img my-1.5 flex flex-col" style={{ alignItems: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center' }}>
      <div className="relative" style={{ width: width + '%' }}>
        <img src={src} alt={caption !== '' ? caption : name} draggable={false} onClick={() => b.pending === undefined && setView(true)} className={cn('block w-full rounded-[var(--ro-r)] border border-[var(--ro-line)] bg-[var(--ro-row)]', b.pending === undefined ? 'cursor-zoom-in' : 'opacity-60')} />
        {b.pending !== undefined && (
          <span className="absolute inset-0 flex items-center justify-center">
            <Spinner />
          </span>
        )}
        {b.pending === undefined && (
          <>
            {handle('left')}
            {handle('right')}
            <span className="absolute right-2 top-2 flex items-center gap-0.5 rounded-[var(--ro-r)] border border-[var(--ro-line)] bg-[var(--ro-card)] p-0.5 opacity-0 shadow-[var(--ro-shadow-sm)] transition-opacity group-hover/img:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
              <IconButton icon={AlignLeft} label="Left" size={24} active={align === 'left'} onClick={() => onChange({ align: 'left' })} />
              <IconButton icon={AlignCenter} label="Centre" size={24} active={align === 'center'} onClick={() => onChange({ align: 'center' })} />
              <IconButton icon={AlignRight} label="Right" size={24} active={align === 'right'} onClick={() => onChange({ align: 'right' })} />
              <span className="mx-0.5 h-4 w-px bg-[var(--ro-line)]" />
              <IconButton icon={Maximize2} label="View full size" size={24} onClick={() => setView(true)} />
              <IconButton icon={Download} label="Download" size={24} onClick={() => save(b)} />
              <IconButton icon={X} label="Remove the picture" size={24} variant="danger" onClick={onRemove} />
            </span>
            {drag !== null && <span className="num absolute bottom-2 left-1/2 -translate-x-1/2 rounded-[var(--ro-r-sm)] bg-[rgba(0,0,0,0.7)] px-1.5 py-0.5 text-[12px] font-semibold text-white">{drag}%</span>}
          </>
        )}
      </div>
      <input
        value={caption}
        onChange={(e) => {
          setCaption(e.target.value);
          onChange({ caption: e.target.value });
        }}
        placeholder="Add a caption"
        aria-label="Caption"
        style={{ width: width + '%', textAlign: align }}
        className={cn('mt-1 bg-transparent text-[12px] leading-5 text-[var(--ro-ink-2)] outline-none placeholder:text-[var(--ro-muted)]', caption === '' && 'opacity-0 focus:opacity-100 group-hover/img:opacity-100 [@media(hover:none)]:opacity-100')}
      />
      {view && <Viewer src={src} name={name} caption={caption} onDownload={() => save(b)} onClose={() => setView(false)} />}
    </figure>
  );
}

function save(b: NoteBlock): void {
  if (b.file === undefined || b.file === '') return;
  const a = document.createElement('a');
  a.href = opUrl('notes.image', { file: b.file, download: true });
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** The picture full size over the page: Esc or a click outside it closes. */
function Viewer({ src, name, caption, onDownload, onClose }: { src: string; name: string; caption: string; onDownload: () => void; onClose: () => void }): React.JSX.Element {
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onClose]);
  return createPortal(
    <div role="dialog" aria-label={name} className="fixed inset-0 z-[80] flex flex-col items-center justify-center gap-3 bg-[rgba(0,0,0,0.85)] p-6" onClick={onClose}>
      <div className="absolute right-4 top-4 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        <Button icon={Download} onClick={onDownload}>
          Download
        </Button>
        <IconButton icon={X} label="Close (Esc)" variant="secondary" onClick={onClose} />
      </div>
      <img src={src} alt={caption !== '' ? caption : name} onClick={(e) => e.stopPropagation()} className="max-h-[84vh] max-w-[94vw] rounded-[var(--ro-r)] bg-white object-contain" />
      {caption !== '' && (
        <p className="max-w-[80ch] text-center text-[13px] text-white" onClick={(e) => e.stopPropagation()}>
          {caption}
        </p>
      )}
    </div>,
    document.body,
  );
}
