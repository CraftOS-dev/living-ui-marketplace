/**
 * Home is the library: every image as a card (its result, name, size and
 * where the original lives), with search, a filter, a sort and two card
 * sizes in the top bar. The first tile adds images (dropping or pasting
 * anywhere works too); images your AI agent proposed edits for are marked.
 */
import { useEffect, useMemo, useState } from 'react';
import { Grid2x2, Grid3x3, ImagePlus, Search, Sparkles } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { useImporter } from '../components/Importer.tsx';
import { Thumb } from '../components/Thumb.tsx';
import { Button, Segmented, Select, Spinner, inputCls } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { bytes, dims as fmtDims, plural } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { navigate } from '../lib/router.ts';
import type { ImageRec } from '../lib/types.ts';

type Show = 'all' | 'edited' | 'original' | 'proposals';
type Sort = 'edited' | 'recent' | 'name' | 'size';
type CardSize = 'large' | 'small';

const SIZE_KEY = 'iu.library.cards';

function readSize(): CardSize {
  try {
    return localStorage.getItem(SIZE_KEY) === 'small' ? 'small' : 'large';
  } catch {
    return 'large';
  }
}

const GRID: Record<CardSize, string> = {
  large: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4',
  small: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-7',
};

function Card({ i, proposed }: { i: ImageRec; proposed: boolean }): React.JSX.Element {
  // Where the original lives: where it was imported from, or the app's own copy for uploads.
  const path = i.source_path !== '' ? i.source_path : i.original_path;
  return (
    <button type="button" onClick={() => navigate('image', { id: i.id })} title={i.name} className="iu-rise group flex min-w-0 flex-col overflow-hidden rounded-[var(--iu-r-md)] border border-[var(--iu-line)] bg-[var(--iu-card)] text-left transition-colors hover:border-[var(--iu-muted)]">
      <span className="relative block">
        <Thumb image={i} className="aspect-[4/3] border-b border-[var(--iu-hair)]" />
        <span className="pointer-events-none absolute left-2 top-2 flex gap-1">
          {i.edits_count > 0 && <span className="rounded-[var(--iu-r-sm)] bg-black/60 px-1.5 py-0.5 text-[12px] font-semibold text-white">{plural(i.edits_count, 'edit')}</span>}
          {i.frames > 1 && <span className="rounded-[var(--iu-r-sm)] bg-black/60 px-1.5 py-0.5 text-[12px] font-semibold text-white">Animated</span>}
        </span>
        {proposed && (
          <span className="iu-on-ink absolute right-2 top-2 inline-flex items-center gap-1 rounded-[var(--iu-r-sm)] bg-[var(--iu-ink)] px-1.5 py-0.5 text-[12px] font-semibold text-[var(--iu-shell)]">
            <Sparkles size={11} aria-hidden className="text-[var(--iu-accent)]" /> Proposal
          </span>
        )}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5 px-2.5 py-2">
        <span className="truncate text-[13px] font-semibold">{i.name}</span>
        <span className="num truncate text-[12px] text-[var(--iu-ink-2)]">
          {i.format} · {fmtDims(i.out_width, i.out_height)} · {bytes(i.bytes)}
        </span>
        {path !== '' && (
          // Long paths keep their end (the file name) in view.
          <span className="mono block truncate text-left text-[var(--iu-muted)] [direction:rtl]" title={path}>
            <bdi>{path}</bdi>
          </span>
        )}
      </span>
    </button>
  );
}

export function HomePage(): React.JSX.Element {
  const imp = useImporter();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [show, setShow] = useState<Show>('all');
  const [sort, setSort] = useState<Sort>('edited');
  const [size, setSizeState] = useState<CardSize>(readSize);
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);
  const setSize = (s: CardSize): void => {
    setSizeState(s);
    try {
      localStorage.setItem(SIZE_KEY, s);
    } catch {
      /* a convenience */
    }
  };
  const list = useLive(() => api.images({ q: query, show, sort, limit: 2000 }), ['images'], [query, show, sort], 400);
  const proposals = useLive(() => api.proposals({ status: 'pending', limit: 500 }), ['proposals'], [], 300);
  const proposed = useMemo(() => new Set((proposals.data?.proposals ?? []).map((p) => p.image?.id ?? '')), [proposals.data]);
  const images = list.data?.images ?? [];
  const filtered = query !== '' || show !== 'all';

  return (
    <section className="iu-rise flex min-h-[calc(100dvh-112px)] min-w-0 flex-col overflow-hidden rounded-[var(--iu-r-md)] border border-[var(--iu-line)] bg-[var(--iu-card)] md:min-h-[calc(100dvh-52px)]">
      <header className="flex flex-wrap items-center gap-2 border-b border-[var(--iu-hair)] px-3 py-2">
        <h1 className="mr-1 text-[14px] font-bold leading-5">Library</h1>
        <label className="relative min-w-[180px] flex-1 sm:max-w-[280px]">
          <Search size={14} aria-hidden className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--iu-muted)]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search names, alt text, keywords" aria-label="Search" className={cn(inputCls, 'pl-7')} />
        </label>
        <Segmented<Show>
          label="Show"
          value={show}
          onChange={setShow}
          options={[
            { value: 'all', label: 'All' },
            { value: 'edited', label: 'Edited' },
            { value: 'original', label: 'Untouched' },
            { value: 'proposals', label: 'Proposals' },
          ]}
        />
        <Select
          ariaLabel="Sort"
          value={sort}
          onChange={(v) => setSort(v as Sort)}
          className="w-40"
          options={[
            { value: 'edited', label: 'Recently edited' },
            { value: 'recent', label: 'Recently added' },
            { value: 'name', label: 'Name' },
            { value: 'size', label: 'Largest files' },
          ]}
        />
        <span className="flex-1" />
        <Segmented<CardSize>
          label="Card size"
          value={size}
          onChange={setSize}
          options={[
            { value: 'large', label: 'Large', icon: Grid2x2 },
            { value: 'small', label: 'Small', icon: Grid3x3 },
          ]}
        />
        <Button variant="accent" icon={ImagePlus} onClick={() => imp.open()}>
          Add images
        </Button>
      </header>
      <div className="min-h-0 flex-1 p-3">
        {list.data === null ? (
          <div className="flex h-48 items-center justify-center text-[var(--iu-muted)]">
            <Spinner size={16} />
          </div>
        ) : (
          <div className={cn('grid gap-3', GRID[size])}>
            <button
              type="button"
              onClick={() => imp.open()}
              className="flex h-full min-h-48 flex-col items-center justify-center gap-1.5 rounded-[var(--iu-r-md)] border-2 border-dashed border-[var(--iu-line)] px-3 text-center text-[var(--iu-ink-2)] transition-colors hover:border-[var(--iu-muted)] hover:text-[var(--iu-ink)]"
            >
              <ImagePlus size={22} aria-hidden className="text-[var(--iu-accent-text)]" />
              <span className="text-[13px] font-bold">Add images</span>
              <span className="text-[12px] leading-4 text-[var(--iu-muted)]">or drop or paste them anywhere</span>
            </button>
            {images.map((i) => (
              <Card key={i.id} i={i} proposed={proposed.has(i.id)} />
            ))}
            {filtered && images.length === 0 && <p className="col-span-full py-6 text-center text-[12px] text-[var(--iu-muted)]">Nothing matches. Try another search or filter.</p>}
          </div>
        )}
      </div>
    </section>
  );
}
