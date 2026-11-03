/**
 * The library as a ladder: a shelf per level, from first songs up. Each tile
 * shows the tune as a contour over your comfortable range (amber where it
 * goes past it in the key you sing it), whether it fits and in which key,
 * its sections' stages and how far along it is. Songs the coach added carry
 * its mark until opened.
 */
import { useMemo, useState } from 'react';
import { AudioLines, Clock, Library, Plus, Search, Sparkle } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { Contour, Ring } from '../components/charts.tsx';
import { AddSong } from '../components/library/AddSong.tsx';
import { SongPanel } from '../components/library/SongPanel.tsx';
import { Button, Empty, Input, PageHeader, Segmented, Spinner } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { clock, levelName, pad2, shift as fmtShift } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { navigate, useRoute } from '../lib/router.ts';
import type { Song } from '../lib/types.ts';
import { SectionBars } from './Today.tsx';

type Filter = 'all' | 'learning' | 'new' | 'mastered' | 'fits' | 'vocalise';

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
      if (filter === 'vocalise') return s.kind === 'vocalise';
      if (filter === 'fits') return s.kind === 'song' && s.fit?.fits === true;
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
  const v = songs.data?.voice;
  const comf: [number, number] | null = v !== undefined && v.tested ? [v.comf_low, v.comf_high] : null;

  return (
    <div className="sc-scroll h-full overflow-y-auto">
      <PageHeader title="Library" meta={list !== null ? `${list.length} songs` : undefined}>
        <div className="relative w-full max-w-[240px] sm:w-[240px]">
          <Search size={14} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--sc-muted)]" />
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
            ...(comf !== null ? [{ value: 'fits' as const, label: 'Fits my voice' }] : []),
            { value: 'vocalise', label: 'Vocalises' },
          ]}
        />
      </div>
      {list === null ? (
        <div className="flex h-[50vh] items-center justify-center text-[var(--sc-muted)]">
          <Spinner size={18} />
        </div>
      ) : shelves.length === 0 ? (
        <Empty icon={Library} title={list.length === 0 ? 'The library is empty' : 'Nothing matches'} action={<Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>Add song</Button>} className="py-20" />
      ) : (
        <div className="flex flex-col gap-7 px-5 pb-10 pt-5 md:px-7">
          {shelves.map(([level, items], si) => (
            <section key={level} className="sc-in" style={{ animationDelay: `${si * 50}ms` }}>
              <div className="mb-2.5 flex items-baseline gap-3 border-b border-[var(--sc-line)] pb-2">
                <span className="sc-mono text-[20px] font-light leading-none tracking-tight">{pad2(level)}</span>
                <span className="sc-label">Level · {levelName(level)}</span>
                <span className="sc-label ml-auto">{items.length}</span>
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3">
                {items.map((s, i) => (
                  <Tile key={s.id} song={s} index={i} comf={comf} onOpen={() => navigate('library', { song: s.id })} />
                ))}
                {si === shelves.length - 1 && (
                  <button type="button" onClick={() => setAdding(true)} className="sc-focus flex min-h-[188px] flex-col items-center justify-center gap-2 rounded-[var(--sc-radius)] border border-dashed border-[var(--sc-line-2)] text-[var(--sc-muted)] transition-colors hover:border-[var(--sc-ink-2)] hover:bg-[var(--sc-panel)] hover:text-[var(--sc-ink)]">
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

function Tile({ song, index, comf, onOpen }: { song: Song; index: number; comf: [number, number] | null; onOpen: () => void }): React.JSX.Element {
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
      className="sc-focus sc-in group flex flex-col overflow-hidden rounded-[var(--sc-radius)] border border-[var(--sc-line)] bg-[var(--sc-panel)] text-left transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-[var(--sc-line-2)] hover:shadow-[var(--sc-shadow-lg)]"
      style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}
    >
      <div className="relative border-b border-[var(--sc-hair)] bg-[var(--sc-raised)] px-2 pb-1 pt-7">
        <Contour preview={song.preview} height={70} sweep={hover} band={comf} shift={song.key_shift} />
        <div className="absolute left-2 top-2 flex items-center gap-1">
          {fresh && (
            <span className="sc-pop inline-flex h-5 items-center gap-1 rounded-full bg-[var(--sc-coach)] px-1.5 text-[10.5px] font-semibold text-[var(--sc-coach-ink)]">
              <Sparkle size={11} aria-hidden /> New
            </span>
          )}
          {added && <span className="sc-pop inline-flex h-5 items-center rounded-full bg-[var(--sc-ink)] px-2 text-[10.5px] font-semibold text-[var(--sc-page)]">New</span>}
          {song.kind === 'vocalise' && <span className="sc-label rounded-[3px] bg-[var(--sc-page)] px-1.5 py-0.5">Vocalise</span>}
          {song.backing != null && (
            <span className="sc-label inline-flex items-center gap-1 rounded-[3px] bg-[var(--sc-page)] px-1.5 py-0.5" title="Made from a recording, which plays as its backing track">
              <AudioLines size={10} aria-hidden /> Recording
            </span>
          )}
          {due && <span className="sc-label rounded-[3px] bg-[var(--sc-ink)] px-1.5 py-0.5 text-[var(--sc-page)]">Review</span>}
        </div>
        {comf !== null && song.fit !== null && song.fit !== undefined && <FitBadge song={song} />}
      </div>
      <div className="flex flex-1 flex-col gap-2 px-3 pb-3 pt-2.5">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="line-clamp-2 text-[13.5px] font-semibold leading-[17px]">{song.title}</div>
            <div className="mt-0.5 truncate text-[12px] text-[var(--sc-muted)]">{song.composer}</div>
          </div>
          <Ring value={song.progress.pct} size={28} stroke={2.5}>
            <span className={cn('sc-mono text-[8.5px]', song.progress.pct > 0 ? 'text-[var(--sc-ink)]' : 'text-[var(--sc-faint)]')}>{Math.round(song.progress.pct * 100)}</span>
          </Ring>
        </div>
        <SectionBars song={song} height={4} />
        <div className="sc-label flex items-center gap-1.5 truncate">
          <span>{song.key.replace(' major', '').replace(' minor', 'm')}</span>
          <span className="text-[var(--sc-faint)]">·</span>
          <span>{song.meter}</span>
          <span className="text-[var(--sc-faint)]">·</span>
          <span>{song.span} st</span>
          <span className="ml-auto flex shrink-0 items-center gap-1 pl-1 text-[var(--sc-ink-2)]" title="Length at full tempo">
            <Clock size={10} strokeWidth={2.2} aria-hidden />
            {clock(song.seconds)}
          </span>
        </div>
      </div>
    </button>
  );
}

/** Whether the song fits the voice, and in which key. */
function FitBadge({ song }: { song: Song }): React.JSX.Element | null {
  const f = song.fit;
  if (f === null || f === undefined) return null;
  const moved = song.key_shift !== 0;
  const text = !f.fits ? 'Wide' : song.key_shift === f.best_shift ? (moved ? `Fits ${fmtShift(song.key_shift)}` : 'Fits') : `Fits at ${fmtShift(f.best_shift)}`;
  return (
    <span
      className={cn('sc-label absolute right-2 top-2 rounded-[3px] px-1.5 py-0.5', f.fits ? 'bg-[var(--sc-page)] text-[var(--sc-ink-2)]' : 'bg-[var(--sc-warn-soft)] text-[var(--sc-warn)]')}
      title={f.fits ? 'Within your comfortable range' : 'Wider than your comfortable range in any key'}
    >
      {text}
    </span>
  );
}
