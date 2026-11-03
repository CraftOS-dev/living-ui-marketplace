/**
 * The library as a ladder: a shelf per level, from first steps up. Each
 * tile shows the song's notes as a small roll, its sections' stages and how
 * far along it is. Songs the coach added carry its dot until opened.
 */
import { useMemo, useState } from 'react';
import { Sparkle, Clock, Library, Plus, Search } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { MiniRoll, Ring } from '../components/charts.tsx';
import { AddSong } from '../components/library/AddSong.tsx';
import { SongPanel } from '../components/library/SongPanel.tsx';
import { Button, Empty, Input, PageHeader, Segmented, Spinner } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { clock, levelName, pad2 } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { navigate, useRoute } from '../lib/router.ts';
import type { Song } from '../lib/types.ts';
import { SectionBars } from './Today.tsx';

type Filter = 'all' | 'learning' | 'new' | 'mastered' | 'exercise';

export function LibraryPage(): React.JSX.Element {
  const { query } = useRoute();
  const songs = useLive(() => api.songs(), ['songs', 'progress'], [], 200, 1200);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [adding, setAdding] = useState(false);
  const open = query.get('song') ?? '';
  const list = songs.data?.songs ?? null;

  const shelves = useMemo(() => {
    if (list === null) return [];
    const needle = q.trim().toLowerCase();
    const pick = list.filter((s) => {
      if (needle !== '' && !`${s.title} ${s.composer} ${s.tags.join(' ')}`.toLowerCase().includes(needle)) return false;
      if (filter === 'exercise') return s.kind === 'exercise';
      if (filter === 'learning' || filter === 'new' || filter === 'mastered') return s.status === filter;
      return true;
    });
    const by = new Map<number, Song[]>();
    for (const s of pick) {
      const l = by.get(s.level) ?? [];
      l.push(s);
      by.set(s.level, l);
    }
    return [...by.entries()].sort((a, b) => a[0] - b[0]);
  }, [list, q, filter]);

  return (
    <div className="pc-scroll h-full overflow-y-auto">
      <PageHeader title="Library" meta={list !== null ? `${list.length} songs` : undefined}>
        <div className="relative w-full max-w-[240px] sm:w-[240px]">
          <Search size={14} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--pc-muted)]" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search songs" className="pl-8" />
        </div>
        <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>
          Add song
        </Button>
      </PageHeader>
      <div className="px-5 pt-3 md:px-7">
        <Segmented
          value={filter}
          onChange={setFilter}
          label="Show"
          options={[
            { value: 'all', label: 'All' },
            { value: 'learning', label: 'In progress' },
            { value: 'new', label: 'New' },
            { value: 'mastered', label: 'Mastered' },
            { value: 'exercise', label: 'Exercises' },
          ]}
        />
      </div>
      {list === null ? (
        <div className="flex h-[50vh] items-center justify-center text-[var(--pc-muted)]">
          <Spinner size={18} />
        </div>
      ) : shelves.length === 0 ? (
        <Empty icon={Library} title={list.length === 0 ? 'The library is empty' : 'Nothing matches'} action={<Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>Add song</Button>} className="py-20" />
      ) : (
        <div className="flex flex-col gap-7 px-5 pb-10 pt-5 md:px-7">
          {shelves.map(([level, items], si) => (
            <section key={level} className="pc-in" style={{ animationDelay: `${si * 50}ms` }}>
              <div className="mb-2.5 flex items-baseline gap-3 border-b border-[var(--pc-line)] pb-2">
                <span className="pc-mono text-[20px] font-light leading-none tracking-tight">{pad2(level)}</span>
                <span className="pc-label">Level · {levelName(level)}</span>
                <span className="pc-label ml-auto">{items.length}</span>
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3">
                {items.map((s, i) => (
                  <Tile key={s.id} song={s} index={i} onOpen={() => navigate('library', { song: s.id })} />
                ))}
                {si === shelves.length - 1 && (
                  <button type="button" onClick={() => setAdding(true)} className="pc-focus flex min-h-[188px] flex-col items-center justify-center gap-2 rounded-[var(--pc-radius)] border border-dashed border-[var(--pc-line-2)] text-[var(--pc-muted)] transition-colors hover:border-[var(--pc-ink-2)] hover:bg-[var(--pc-panel)] hover:text-[var(--pc-ink)]">
                    <Plus size={18} aria-hidden />
                    <span className="text-[12.5px] font-medium">Add song</span>
                  </button>
                )}
              </div>
            </section>
          ))}
        </div>
      )}
      {open !== '' && <SongPanel id={open} onClose={() => navigate('library')} />}
      <AddSong open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

function Tile({ song, index, onOpen }: { song: Song; index: number; onOpen: () => void }): React.JSX.Element {
  const [hover, setHover] = useState(false);
  const fresh = song.source === 'agent' && !song.seen;
  // Added to the library by an update, not opened yet.
  const added = song.source === 'starter' && !song.seen;
  const due = song.progress.due > 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="pc-focus pc-in group flex flex-col overflow-hidden rounded-[var(--pc-radius)] border border-[var(--pc-line)] bg-[var(--pc-panel)] text-left transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-[var(--pc-line-2)] hover:shadow-[var(--pc-shadow-lg)]"
      style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}
    >
      <div className="relative border-b border-[var(--pc-hair)] bg-[var(--pc-raised)] px-2 pt-2">
        <MiniRoll preview={song.preview} height={84} sweep={hover} />
        <div className="absolute left-2 top-2 flex items-center gap-1">
          {fresh && (
            <span className="pc-pop inline-flex h-5 items-center gap-1 rounded-full bg-[var(--pc-coach)] px-1.5 text-[10.5px] font-semibold text-[var(--pc-coach-ink)]">
              <Sparkle size={11} aria-hidden /> New
            </span>
          )}
          {added && <span className="pc-pop inline-flex h-5 items-center rounded-full bg-[var(--pc-ink)] px-2 text-[10.5px] font-semibold text-[var(--pc-page)]">New</span>}
          {song.kind === 'exercise' && <span className="pc-label rounded-[3px] bg-[var(--pc-page)] px-1.5 py-0.5">Exercise</span>}
          {due && <span className="pc-label rounded-[3px] bg-[var(--pc-ink)] px-1.5 py-0.5 text-[var(--pc-page)]">Review</span>}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2 px-3 pb-3 pt-2.5">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="line-clamp-2 text-[13.5px] font-semibold leading-[17px]">{song.title}</div>
            <div className="mt-0.5 truncate text-[12px] text-[var(--pc-muted)]">{song.composer}</div>
          </div>
          <Ring value={song.progress.pct} size={28} stroke={2.5}>
            <span className={cn('pc-mono text-[8.5px]', song.progress.pct > 0 ? 'text-[var(--pc-ink)]' : 'text-[var(--pc-faint)]')}>{Math.round(song.progress.pct * 100)}</span>
          </Ring>
        </div>
        <SectionBars song={song} height={4} />
        <div className="pc-label flex items-center gap-1.5 truncate">
          <span>{song.key.replace(' major', '').replace(' minor', 'm')}</span>
          <span className="text-[var(--pc-faint)]">·</span>
          <span>{song.meter}</span>
          <span className="text-[var(--pc-faint)]">·</span>
          <span>{song.bars} bars</span>
          <span className="ml-auto flex shrink-0 items-center gap-1 pl-1 text-[var(--pc-ink-2)]" title="Length at full tempo">
            <Clock size={10} strokeWidth={2.2} aria-hidden />
            {clock(song.seconds)}
          </span>
        </div>
      </div>
    </button>
  );
}
