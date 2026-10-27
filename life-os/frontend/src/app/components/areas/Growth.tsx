/**
 * Growth: what you are reading now (where you are in it), a wooden shelf
 * of the books you want and the ones you finished, and the things you are
 * learning with a tap for each practice.
 */
import { useState } from 'react';
import { Star, Trash2 } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { minutes } from '../../lib/format.ts';
import { act, changed, drop, insert, localDay, patch, tempId, useLive } from '../../lib/live.ts';
import { enter, rowOf, vanish } from '../../lib/motion.ts';
import type { Book, Learning, Shelf } from '../../lib/types.ts';
import { HabitArt } from '../art.tsx';
import { SPINES } from '../art2.tsx';
import { AddLine, Chip, InlineText, Meter } from '../bits.tsx';
import { Panel } from '../panel.tsx';
import { snack } from '../snack.tsx';
import { Button, Modal, Skeleton } from '../ui.tsx';

function booksChanged(): void {
  changed('books', 'goals');
}

function Spine({ book, onOpen }: { book: Book; onOpen: () => void }): React.JSX.Element {
  const s = SPINES[book.look % SPINES.length]!;
  const h = 96 + Math.min(44, Math.round((book.pages || 250) / 18));
  return (
    <button type="button" onClick={onOpen} title={book.author !== '' ? `${book.title}, ${book.author}` : book.title} className="group relative flex shrink-0 items-center justify-center overflow-hidden rounded-t-[4px] transition-transform hover:-translate-y-2" style={{ width: 34 + (book.title.length % 3) * 4, height: h, background: s.body }}>
      <span className="absolute inset-x-0 top-3 h-1.5" style={{ background: s.band }} />
      <span className="absolute inset-x-0 bottom-4 h-1" style={{ background: s.band }} />
      <span className="max-h-[70%] overflow-hidden text-ellipsis whitespace-nowrap rounded-[3px] bg-[var(--lo-art-cream)] px-px py-1 text-[12px] font-extrabold text-[var(--lo-art-ink)] [writing-mode:vertical-rl]">{book.title}</span>
      {book.status === 'done' && book.rating > 0 && <span className="absolute bottom-0.5 text-[var(--lo-art-honey)]"><Star size={9} fill="currentColor" /></span>}
    </button>
  );
}

function ShelfRow({ books, onOpen, empty }: { books: Book[]; onOpen: (b: Book) => void; empty: string }): React.JSX.Element {
  return (
    <div>
      <div className="flex min-h-[148px] items-end gap-1 overflow-x-auto px-3">
        {books.map((b) => (
          <Spine key={b.id} book={b} onOpen={() => onOpen(b)} />
        ))}
        {books.length === 0 && <p className="pb-4 text-[13px] font-semibold text-[var(--lo-muted)]">{empty}</p>}
      </div>
      <div className="h-3.5 rounded-[3px] bg-[var(--lo-art-wood)] shadow-[0_4px_0_var(--lo-art-wood-d)]" />
    </div>
  );
}

function BookSheet({ book, onClose }: { book: Book; onClose: () => void }): React.JSX.Element {
  const [b, setB] = useState(book);
  const save = async (patch: Record<string, unknown>): Promise<void> => {
    const r = await op<{ book: Book }>('books.update', { book: b.id, ...patch });
    setB(r.book);
    booksChanged();
    if (patch.status === 'done' || (r.book.status === 'done' && book.status !== 'done')) snack(`Finished "${b.title}"`);
  };
  const remove = async (): Promise<void> => {
    await op('books.delete', { book: b.id });
    booksChanged();
    snack(`Took "${b.title}" off the shelf`);
    onClose();
  };
  const s = SPINES[b.look % SPINES.length]!;
  return (
    <Modal
      open
      onClose={onClose}
      title={b.title}
      width={480}
      footer={
        <>
          <Button variant="danger" size="sm" icon={Trash2} onClick={() => void remove()}>
            Remove
          </Button>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className="flex gap-4 pb-2">
        <span className="h-32 w-24 shrink-0 rounded-[6px] shadow-[var(--lo-shadow)]" style={{ background: s.body }}>
          <span className="mt-4 block h-2" style={{ background: s.band }} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <InlineText value={b.title} onSave={(v) => save({ title: v })} placeholder="Title" className="serif text-[15px] font-semibold" maxLength={200} />
          <InlineText value={b.author} onSave={(v) => save({ author: v })} placeholder="Author" className="text-[14px] text-[var(--lo-ink-2)]" maxLength={120} />
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ['want', 'Want to read'],
                ['reading', 'Reading'],
                ['done', 'Finished'],
              ] as [Book['status'], string][]
            ).map(([k, l]) => (
              <Chip key={k} active={b.status === k} onClick={() => void save({ status: k })}>
                {l}
              </Chip>
            ))}
          </div>
          <label className="flex items-center gap-2 text-[13px] font-semibold text-[var(--lo-ink-2)]">
            Pages
            <input defaultValue={b.pages > 0 ? String(b.pages) : ''} onBlur={(e) => e.target.value !== '' && void save({ pages: Number(e.target.value) })} inputMode="numeric" placeholder="320" className="num h-8 w-20 rounded-[var(--lo-r-sm)] border border-[var(--lo-line)] bg-[var(--lo-card)] px-2 text-[13px] font-bold outline-none focus:border-[var(--lo-accent)]" />
          </label>
          {b.status === 'done' && (
            <div className="flex items-center gap-0.5" role="radiogroup" aria-label="How was it">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" role="radio" aria-checked={b.rating === n} aria-label={`${n} of 5`} onClick={() => void save({ rating: b.rating === n ? 0 : n })} className="flex size-8 items-center justify-center rounded-[var(--lo-r-sm)] text-[var(--lo-art-honey-d)] hover:bg-[var(--lo-sunk)]">
                  <Star size={18} fill={n <= b.rating ? 'currentColor' : 'none'} />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function Reading({ book, onOpen }: { book: Book; onOpen: () => void }): React.JSX.Element {
  const [page, setPage] = useState('');
  const s = SPINES[book.look % SPINES.length]!;
  const save = async (patch: Record<string, unknown>): Promise<void> => {
    const r = await op<{ book: Book }>('books.update', { book: book.id, ...patch });
    booksChanged();
    setPage('');
    if (r.book.status === 'done') snack(`Finished "${book.title}". On the shelf it goes`);
  };
  return (
    <div className="flex gap-4 rounded-[var(--lo-r-lg)] border border-[var(--lo-hair)] p-3">
      <button type="button" onClick={onOpen} aria-label={`Open ${book.title}`} className="h-28 w-20 shrink-0 rounded-[6px] shadow-[var(--lo-shadow)] transition-transform hover:-rotate-2" style={{ background: s.body }}>
        <span className="mt-3 block h-2" style={{ background: s.band }} />
        <span className="mx-1.5 mt-2 block rounded-[3px] bg-[var(--lo-art-cream)] px-1 py-0.5 text-left text-[12px] font-extrabold leading-4 text-[var(--lo-art-ink)]">{book.title}</span>
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div>
          <p className="serif truncate text-[15px] font-semibold">{book.title}</p>
          {book.author !== '' && <p className="truncate text-[13px] text-[var(--lo-ink-2)]">{book.author}</p>}
        </div>
        {book.pages > 0 ? (
          <>
            <Meter value={book.progress} color="var(--lo-k-growth)" height={8} label="How far in" />
            <p className="text-[12px] font-semibold text-[var(--lo-muted)]">
              Page {book.page} of {book.pages}
            </p>
          </>
        ) : (
          <p className="text-[12px] text-[var(--lo-muted)]">Add the number of pages to see how far in you are.</p>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <input value={page} onChange={(e) => setPage(e.target.value.replace(/[^0-9]/g, ''))} onKeyDown={(e) => e.key === 'Enter' && page !== '' && void save({ page: Number(page) })} inputMode="numeric" placeholder="I am on page" aria-label="Page" className="num h-8 w-28 rounded-[var(--lo-r-sm)] border border-[var(--lo-line)] bg-[var(--lo-card)] px-2 text-[13px] font-bold outline-none focus:border-[var(--lo-accent)]" />
          <Button size="sm" variant="moss" onClick={() => void save({ status: 'done' })}>
            Finished it
          </Button>
        </div>
      </div>
    </div>
  );
}

const LEARN_ART: Record<Learning['kind'], string> = { language: 'language', skill: 'study', course: 'read' };

function LearningRow({ item }: { item: Learning }): React.JSX.Element {
  const practice = async (m: number): Promise<void> => {
    snack(`${minutes(m)} of ${item.name}`);
    await act([patch<Learning>(item.id, { minutes: item.minutes + m, last_practiced: localDay() })], () => op('learning.practice', { item: item.id, minutes: m }), ['learning', 'goals']);
  };
  return (
    <li data-row className={cn('flex flex-wrap items-center gap-3 rounded-[var(--lo-r-lg)] border border-[var(--lo-hair)] px-3 py-2.5', enter(item.id))}>
      <HabitArt art={LEARN_ART[item.kind]} size={40} />
      <div className="min-w-[140px] flex-1">
        <p className="text-[14px] font-bold">{item.name}</p>
        <p className="text-[12px] font-semibold text-[var(--lo-muted)]">
          {item.minutes > 0 ? `${minutes(item.minutes)} in all` : 'Not started'}
          {item.days_since !== null ? ` · last ${item.days_since === 0 ? 'today' : item.days_since === 1 ? 'yesterday' : item.days_since + ' days ago'}` : ''}
        </p>
        <label className="mt-1 flex items-center gap-2">
          <input type="range" min={0} max={100} step={5} defaultValue={item.progress} onPointerUp={(e) => void op('learning.update', { item: item.id, progress: Number((e.target as HTMLInputElement).value) }).then(() => changed('learning'))} onKeyUp={(e) => void op('learning.update', { item: item.id, progress: Number((e.target as HTMLInputElement).value) }).then(() => changed('learning'))} aria-label="How far along" className="h-6 w-40 accent-[var(--lo-k-growth)]" />
          <span className="num text-[12px] font-bold text-[var(--lo-ink-2)]">{item.progress}%</span>
        </label>
      </div>
      <div className="flex gap-1">
        {[15, 30, 60].map((m) => (
          <button key={m} type="button" onClick={() => void practice(m)} className="h-8 rounded-[var(--lo-r-sm)] bg-[var(--lo-k-growth-soft)] px-2.5 text-[12px] font-extrabold text-[var(--lo-k-growth-text)] hover:brightness-[0.97]">
            +{m < 60 ? `${m} min` : '1 h'}
          </button>
        ))}
      </div>
    </li>
  );
}

export default function GrowthTool(): React.JSX.Element {
  const shelf = useLive<Shelf>((signal) => op('books.shelf', {}, { quiet: true, signal }), ['books'], []);
  const learning = useLive<{ learning: Learning[] }>((signal) => op('learning.list', {}, { quiet: true, signal }), ['learning'], []);
  const [open, setOpen] = useState<Book | null>(null);
  const [status, setStatus] = useState<'want' | 'reading'>('reading');
  const [kind, setKind] = useState<Learning['kind']>('skill');
  const s = shelf.data;
  if (s === null) return <Skeleton className="h-48 w-full" />;
  return (
    <>
        <Panel title="Reading now" art={<HabitArt art="read" size={26} />} note={`${s.read_this_year} finished this year`}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {s.reading.map((b) => (
              <Reading key={b.id} book={b} onOpen={() => setOpen(b)} />
            ))}
            {s.reading.length === 0 && <p className="text-[13px] text-[var(--lo-muted)]">Nothing on the go. Pick one from the shelf, or add it below.</p>}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="flex gap-1">
              <Chip active={status === 'reading'} onClick={() => setStatus('reading')} className="h-7 text-[12px]">
                Reading
              </Chip>
              <Chip active={status === 'want'} onClick={() => setStatus('want')} className="h-7 text-[12px]">
                Want to read
              </Chip>
            </div>
            <AddLine
              className="min-w-[220px] flex-1"
              placeholder="Add a book by its title"
              onAdd={async (title) => {
                const r = await act([], () => op('books.add', { title, status, look: Math.floor(Math.random() * 8) }), ['books', 'goals']);
                if (r === undefined) return false;
                snack(status === 'reading' ? `Reading "${title}"` : `"${title}" is on the shelf`);
                return true;
              }}
            />
          </div>
        </Panel>
        <Panel title="The shelf" art={<HabitArt art="study" size={24} />} note={`${s.want.length} to read, ${s.done.length} finished`}>
          <div className="flex flex-col gap-5 rounded-[var(--lo-r-lg)] bg-[var(--lo-sunk)] px-2 pb-4 pt-3">
            <div>
              <p className="px-3 pb-1 text-[12px] font-bold text-[var(--lo-muted)]">Want to read</p>
              <ShelfRow books={s.want} onOpen={setOpen} empty="Books you want to read wait here." />
            </div>
            <div>
              <p className="px-3 pb-1 text-[12px] font-bold text-[var(--lo-muted)]">Finished</p>
              <ShelfRow books={s.done} onOpen={setOpen} empty="Finished books stand here." />
            </div>
          </div>
        </Panel>

      <Panel title="Learning" art={<HabitArt art="language" size={24} />}>
        <ul className="flex flex-col gap-2">
          {(learning.data?.learning ?? [])
            .filter((l) => !l.archived)
            .map((l) => (
              <LearningRow key={l.id} item={l} />
            ))}
        </ul>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="flex gap-1">
            {(
              [
                ['skill', 'A skill'],
                ['language', 'A language'],
                ['course', 'A course'],
              ] as [Learning['kind'], string][]
            ).map(([k, l]) => (
              <Chip key={k} active={kind === k} onClick={() => setKind(k)} className={cn('h-7 text-[12px]')}>
                {l}
              </Chip>
            ))}
          </div>
          <AddLine
            className="min-w-[220px] flex-1"
            placeholder="Guitar, Spanish, a coding course"
            onAdd={async (name) => {
              const draft = { id: tempId(), name, kind, minutes: 0, progress: 0, last_practiced: '', actor: 'person' } as unknown as Learning;
              const r = await act([insert((k) => k === 'learning', draft)], () => op('learning.add', { name, kind }), ['learning', 'goals']);
              if (r === undefined) return false;
              snack(`Learning ${name}`);
              return true;
            }}
          />
        </div>
      </Panel>
      {open !== null && <BookSheet book={open} onClose={() => setOpen(null)} />}
    </>
  );
}
