/**
 * The frame: the grove (a deep sidebar with a carved plaque, the places as
 * drawings, the areas of life under My life, and today's weather at the
 * foot), the page on paper, and on phones a bottom bar.
 *
 * Sidebar trees: My life and Projects expand to their children (the
 * chevron); "+" on Projects starts a new one. Children sit flush with their
 * parent.
 */
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight, Menu, Plus, Search, Settings, X } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { useStatus } from '../lib/context.tsx';
import { temp } from '../lib/format.ts';
import { href, navigate, SECTION } from '../lib/router.ts';
import type { Page } from '../lib/router.ts';
import { useWeather } from '../lib/world.ts';
import { AREA_NAMES, AreaArt, WeatherArt, weatherWord } from './art.tsx';
import { NavArt } from './art2.tsx';
import type { NavKind } from './art2.tsx';
import { useCapture, usePalette } from './overlays.tsx';
import { Count } from './ui.tsx';

function load(key: string, dflt: boolean): boolean {
  try {
    const v = localStorage.getItem('lo_nav_' + key);
    return v === null ? dflt : v === '1';
  } catch {
    return dflt;
  }
}

function store(key: string, v: boolean): void {
  try {
    localStorage.setItem('lo_nav_' + key, v ? '1' : '0');
  } catch {
    /* the open state is a convenience */
  }
}

function NavRow({ page, label, art, active, count, quiet, tree, open, onToggle, onAdd, addLabel, onNavigate }: { page: Page; label: string; art: NavKind; active: boolean; count?: number | undefined; quiet?: number | undefined; tree?: boolean | undefined; open?: boolean | undefined; onToggle?: (() => void) | undefined; onAdd?: (() => void) | undefined; addLabel?: string | undefined; onNavigate?: (() => void) | undefined }): React.JSX.Element {
  return (
    <div className={cn('group flex h-10 items-center rounded-[var(--lo-r)] transition-colors', active ? 'bg-[var(--lo-grove-pill)] text-[var(--lo-on-grove-pill)] shadow-[var(--lo-shadow-sm)]' : 'hover:bg-[var(--lo-grove-2)]')}>
      <a href={href(page)} onClick={onNavigate} aria-current={active ? 'page' : undefined} className="flex h-full min-w-0 flex-1 items-center gap-2.5 pl-2">
        <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-[var(--lo-r-sm)]', active ? 'bg-[var(--lo-sunk)]' : 'bg-[var(--lo-grove-2)]')}>
          <NavArt kind={art} size={24} />
        </span>
        <span className="truncate text-[14px] font-bold">{label}</span>
      </a>
      {onAdd !== undefined && (
        <button type="button" aria-label={addLabel} title={addLabel} onClick={onAdd} className={cn('hit flex size-7 shrink-0 items-center justify-center rounded-[var(--lo-r-sm)] opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100', active ? 'hover:bg-[var(--lo-sunk)]' : 'hover:bg-[var(--lo-grove-3)]')}>
          <Plus size={15} strokeWidth={2.6} />
        </button>
      )}
      {tree === true && (
        <button type="button" aria-label={open ? 'Collapse' : 'Expand'} aria-expanded={open} onClick={onToggle} className={cn('mr-1 flex size-7 shrink-0 items-center justify-center rounded-[var(--lo-r-sm)]', active ? 'hover:bg-[var(--lo-sunk)]' : 'hover:bg-[var(--lo-grove-3)]')}>
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
      )}
      {/* Counts sit in the same column as the chevrons, centred in a slot of the same size. */}
      {tree !== true && ((count !== undefined && count > 0) || (quiet !== undefined && quiet > 0)) && (
        <span className="mr-1 flex size-7 shrink-0 items-center justify-center">
          {count !== undefined && count > 0 ? <Count n={count} /> : <span className={cn('num text-[12px] font-bold', active ? 'opacity-70' : 'text-[var(--lo-on-grove-muted)]')}>{quiet}</span>}
        </span>
      )}
    </div>
  );
}

function Child({ to, active, children, onNavigate }: { to: string; active: boolean; children: ReactNode; onNavigate?: (() => void) | undefined }): React.JSX.Element {
  return (
    <a href={to} onClick={onNavigate} aria-current={active ? 'page' : undefined} className={cn('flex h-9 min-w-0 items-center gap-2.5 rounded-[var(--lo-r)] pl-2 pr-3 text-[13px] font-semibold transition-colors', active ? 'bg-[var(--lo-grove-3)]' : 'text-[var(--lo-on-grove-muted)] hover:bg-[var(--lo-grove-2)] hover:text-[var(--lo-on-grove)]')}>
      {children}
    </a>
  );
}

/** The weather at the foot of the grove. */
function WeatherFoot({ onNavigate }: { onNavigate?: (() => void) | undefined }): React.JSX.Element | null {
  const { weather } = useWeather();
  if (weather === null) return null;
  const d0 = weather.days[0];
  return (
    <a href={href('home')} onClick={onNavigate} className="flex items-center gap-3 rounded-[var(--lo-r-lg)] bg-[var(--lo-grove-2)] px-3 py-2.5 transition-colors hover:bg-[var(--lo-grove-3)]" title={`${weatherWord(weather.current.code)} in ${weather.place.city}`}>
      <WeatherArt code={weather.current.code} night={!weather.current.day} size={40} />
      <span className="min-w-0">
        <span className="num block text-[15px] font-extrabold leading-5">
          {temp(weather.current.temp)} <span className="text-[13px] font-bold text-[var(--lo-on-grove-muted)]">{weatherWord(weather.current.code)}</span>
        </span>
        <span className="block truncate text-[12px] font-semibold text-[var(--lo-on-grove-muted)]">
          {weather.place.city}
          {d0 !== undefined ? ` · ${temp(d0.max)} / ${temp(d0.min)}` : ''}
        </span>
      </span>
    </a>
  );
}

function Sidebar({ page, query, onNavigate }: { page: Page; query: URLSearchParams; onNavigate?: (() => void) | undefined }): React.JSX.Element {
  const status = useStatus().data;
  const palette = usePalette();
  const capture = useCapture();
  const section = SECTION[page];
  const kind = query.get('kind') ?? '';
  const id = query.get('id') ?? '';
  const [openLife, setOpenLife] = useState(() => load('life', true));
  const [openProjects, setOpenProjects] = useState(() => load('projects', false));
  const c = status?.counts;
  const name = status?.owner_name ?? '';
  return (
    <nav aria-label="Life OS" className="lo-on-grove flex h-full flex-col overflow-hidden bg-[var(--lo-grove)]">
      <div className="shrink-0 px-4 pb-3 pt-4">
        <a href={href('home')} onClick={onNavigate} className="block rounded-[var(--lo-r-lg)] border-2 border-[var(--lo-plaque-edge)] bg-[var(--lo-plaque)] px-4 py-2.5 text-center text-[var(--lo-on-plaque)] shadow-[inset_0_-3px_0_rgb(0_0_0/0.12),var(--lo-shadow)]">
          <span className="block text-[12px] font-bold opacity-85">{name !== '' ? 'Welcome back' : 'Welcome to'}</span>
          <span className="serif block truncate text-[26px] font-semibold leading-8">{name !== '' ? name : 'Life OS'}</span>
          {name !== '' && <span className="block text-[12px] font-bold opacity-85">Life OS</span>}
        </a>
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={() => capture()} title="Add a task (Q)" className="flex h-9 flex-1 items-center gap-2 rounded-[var(--lo-r)] bg-[var(--lo-grove-pill)] px-3 text-[13px] font-extrabold text-[var(--lo-on-grove-pill)] shadow-[var(--lo-shadow-sm)] transition-[filter] hover:brightness-[0.97]">
            <Plus size={16} strokeWidth={3} /> Add a task
          </button>
          <button type="button" onClick={palette} title="Find (Ctrl K)" aria-label="Find" className="flex size-9 items-center justify-center rounded-[var(--lo-r)] bg-[var(--lo-grove-2)] transition-colors hover:bg-[var(--lo-grove-3)]">
            <Search size={15} />
          </button>
          <a href={href('settings')} onClick={onNavigate} title="Settings" aria-label="Settings" aria-current={section === 'settings' ? 'page' : undefined} className={cn('flex size-9 items-center justify-center rounded-[var(--lo-r)] transition-colors', section === 'settings' ? 'bg-[var(--lo-grove-pill)] text-[var(--lo-on-grove-pill)]' : 'bg-[var(--lo-grove-2)] hover:bg-[var(--lo-grove-3)]')}>
            <Settings size={15} />
          </a>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 [scrollbar-color:var(--lo-grove-3)_transparent]">
        <div className="flex flex-col gap-0.5">
          <NavRow page="home" label="Home" art="home" active={section === 'home'} onNavigate={onNavigate} />
          <NavRow page="board" label="Board" art="board" active={section === 'board'} quiet={c?.today_open} onNavigate={onNavigate} />
          <NavRow page="habits" label="Habits" art="habits" active={section === 'habits'} quiet={c !== undefined ? Math.max(0, c.habits_due - c.habits_done) : undefined} onNavigate={onNavigate} />
          <NavRow
            page="life"
            label="My life"
            art="life"
            active={page === 'life'}
            tree
            open={openLife}
            onToggle={() => {
              setOpenLife(!openLife);
              store('life', !openLife);
            }}
            onNavigate={onNavigate}
          />
          {openLife &&
            (status?.areas ?? []).map((k) => (
              <Child key={k} to={href('area', { kind: k })} active={page === 'area' && kind === k} onNavigate={onNavigate}>
                <AreaArt kind={k} size={24} />
                <span className="truncate">{AREA_NAMES[k]}</span>
              </Child>
            ))}
          <NavRow
            page="projects"
            label="Projects"
            art="projects"
            active={page === 'projects'}
            tree
            open={openProjects}
            onToggle={() => {
              setOpenProjects(!openProjects);
              store('projects', !openProjects);
            }}
            onAdd={() => {
              onNavigate?.();
              navigate('projects', { new: '1' });
            }}
            addLabel="New project"
            onNavigate={onNavigate}
          />
          {openProjects &&
            (status?.projects ?? []).map((p) => (
              <Child key={p.id} to={href('project', { id: p.id })} active={page === 'project' && id === p.id} onNavigate={onNavigate}>
                {p.area !== '' ? <AreaArt kind={p.area as never} size={20} /> : <NavArt kind="projects" size={20} />}
                <span className="truncate">{p.title}</span>
              </Child>
            ))}
          <NavRow page="journal" label="Journal" art="journal" active={section === 'journal'} onNavigate={onNavigate} />
        </div>
        <div className="my-2.5 h-px bg-[var(--lo-grove-2)]" />
        <NavRow page="agent" label="Your AI agent" art="agent" active={section === 'agent'} count={c !== undefined ? c.proposals + c.suggestions + c.answers : undefined} onNavigate={onNavigate} />
      </div>
      {/* The phone menu leaves the weather to Home and gives the places the room. */}
      {onNavigate === undefined && (
        <div className="shrink-0 px-3 pb-3">
          <WeatherFoot />
        </div>
      )}
    </nav>
  );
}

const PHONE: { page: Page; label: string; art: NavKind }[] = [
  { page: 'home', label: 'Home', art: 'home' },
  { page: 'board', label: 'Board', art: 'board' },
  { page: 'habits', label: 'Habits', art: 'habits' },
  { page: 'life', label: 'My life', art: 'life' },
];

export function Frame({ page, query, children }: { page: Page; query: URLSearchParams; children: ReactNode }): React.JSX.Element {
  const [drawer, setDrawer] = useState(false);
  const section = SECTION[page];
  useEffect(() => setDrawer(false), [page, query]);
  return (
    <div className="flex h-dvh w-full overflow-hidden bg-[var(--lo-paper)] text-[var(--lo-ink)]">
      <aside className="hidden h-full w-[256px] shrink-0 md:block">
        <Sidebar page={page} query={query} />
      </aside>
      <main id="lo-main" data-scroll className="lo-paper relative min-w-0 flex-1 overflow-y-auto overflow-x-hidden pb-20 md:pb-0">
        {children}
      </main>
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-stretch justify-around border-t border-[var(--lo-grove-2)] bg-[var(--lo-grove)] text-[var(--lo-on-grove)] md:hidden">
        {PHONE.map((p) => (
          <a key={p.page} href={href(p.page)} aria-current={section === p.page ? 'page' : undefined} className={cn('flex flex-1 flex-col items-center justify-center gap-0.5 text-[12px] font-bold', section === p.page ? 'text-[var(--lo-on-grove)]' : 'text-[var(--lo-on-grove-muted)]')}>
            <span className={cn('flex h-8 w-12 items-center justify-center rounded-[var(--lo-r)]', section === p.page && 'bg-[var(--lo-grove-3)]')}>
              <NavArt kind={p.art} size={24} />
            </span>
            {p.label}
          </a>
        ))}
        <button type="button" onClick={() => setDrawer(true)} className="flex flex-1 flex-col items-center justify-center gap-0.5 text-[12px] font-bold text-[var(--lo-on-grove-muted)]">
          <span className="flex h-8 w-12 items-center justify-center rounded-[var(--lo-r)]">
            <Menu size={18} />
          </span>
          More
        </button>
      </nav>
      {drawer && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button type="button" aria-label="Close" className="lo-dim-in absolute inset-0 bg-[rgb(30_22_12/0.4)]" onClick={() => setDrawer(false)} />
          <div className="lo-menu-in absolute inset-y-0 left-0 w-[280px] max-w-[86vw] shadow-[var(--lo-shadow-lg)]">
            <button type="button" aria-label="Close menu" onClick={() => setDrawer(false)} className="lo-on-grove absolute right-2 top-2 z-10 flex size-8 items-center justify-center rounded-[var(--lo-r-sm)] hover:bg-[var(--lo-grove-2)]">
              <X size={16} />
            </button>
            <Sidebar page={page} query={query} onNavigate={() => setDrawer(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
