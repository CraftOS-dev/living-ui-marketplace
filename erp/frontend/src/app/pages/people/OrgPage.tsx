/**
 * The org chart: who reports to whom, drawn as a tree of person cards
 * joined by lines (top down on wide screens, an indented tree on phones so
 * nothing needs zooming). Branches fold and unfold; search finds a person,
 * opens the branches above them and scrolls to them; a card opens the person.
 */
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Network, Users } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { SearchBox, useDebounced } from '../../components/controls.tsx';
import { PersonAvatar } from '../../components/people/common.tsx';
import { Card, Empty, LoadError, PageHeader, PillButton, Skeleton } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { plural } from '../../lib/format.ts';
import { useLive } from '../../lib/live.ts';
import { navigate } from '../../lib/router.ts';
import type { OrgNode, OrgTree } from '../../lib/types/people.ts';
import type { PageProps } from '../../routes.tsx';

function useWide(): boolean {
  const [wide, setWide] = useState(() => window.innerWidth >= 768);
  useEffect(() => {
    const on = (): void => setWide(window.innerWidth >= 768);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return wide;
}

/** Every node with its depth and the ids above it. */
function flatten(roots: OrgNode[]): { node: OrgNode; depth: number; path: string[] }[] {
  const out: { node: OrgNode; depth: number; path: string[] }[] = [];
  const walk = (n: OrgNode, depth: number, path: string[]): void => {
    out.push({ node: n, depth, path });
    for (const c of n.children) walk(c, depth + 1, [...path, n.id]);
  };
  for (const r of roots) walk(r, 0, []);
  return out;
}

interface View {
  isOpen: (id: string) => boolean;
  toggle: (id: string) => void;
  hit: Set<string>;
}

function ToggleChip({ n, open, onClick, dark = false }: { n: OrgNode; open: boolean; onClick: () => void; dark?: boolean | undefined }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-label={`${open ? 'Fold' : 'Show'} ${plural(n.children.length, 'report')} of ${n.name}`}
      className={cn(
        'num inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[12px] font-bold shadow-[0_6px_14px_-10px_rgba(29,28,26,0.6)] transition-transform active:scale-95',
        open ? 'bg-[var(--erp-card)] text-[var(--erp-ink)] ring-1 ring-[var(--erp-line)]' : dark ? 'bg-[var(--erp-accent)] text-[var(--erp-on-accent)]' : 'erp-on-ink bg-[var(--erp-ink)] text-[var(--erp-shell)]',
      )}
    >
      {n.children.length}
      <ChevronDown size={12} strokeWidth={2.6} aria-hidden className={cn('transition-transform', open && 'rotate-180')} />
    </button>
  );
}

function NodeCard({ n, root, view }: { n: OrgNode; root: boolean; view: View }): React.JSX.Element {
  const hit = view.hit.has(n.id);
  return (
    <div id={`org-${n.id}`} className="relative">
      <button
        type="button"
        onClick={() => navigate('employee', { id: n.id })}
        className={cn(
          'flex w-[184px] flex-col items-center gap-2 rounded-[22px] px-3 pb-5 pt-4 text-center transition-transform active:scale-[0.98]',
          root ? 'erp-on-dark bg-[var(--erp-dark)] text-[var(--erp-on-dark)]' : 'bg-[var(--erp-card)] hover:shadow-[0_14px_30px_-22px_rgba(29,28,26,0.6)]',
          hit && 'ring-2 ring-[var(--erp-accent)]',
        )}
      >
        <PersonAvatar name={n.name} photo={n.photo} size={48} />
        <span className="w-full min-w-0">
          <span className="block truncate text-[14px] font-bold">{n.name}</span>
          <span className={cn('block truncate text-[12px]', root ? 'text-[var(--erp-on-dark-muted)]' : 'text-[var(--erp-muted)]')}>{n.job_title !== '' ? n.job_title : 'No job title'}</span>
        </span>
        {n.department !== null && (
          <span className={cn('max-w-full truncate rounded-full px-2.5 py-0.5 text-[12px] font-semibold', root ? 'bg-[var(--erp-dark-2)] text-[var(--erp-on-dark)]' : 'bg-[var(--erp-row)] text-[var(--erp-ink-2)]')}>
            {n.department.name}
          </span>
        )}
      </button>
      {n.children.length > 0 && (
        <span className="absolute -bottom-3.5 left-1/2 z-10 -translate-x-1/2">
          <ToggleChip n={n} open={view.isOpen(n.id)} onClick={() => view.toggle(n.id)} dark={root} />
        </span>
      )}
    </div>
  );
}

/** Top-down tree: a horizontal line over each row of siblings, vertical stubs to each card. */
function Branch({ n, depth, first, last, view }: { n: OrgNode; depth: number; first: boolean; last: boolean; view: View }): React.JSX.Element {
  const open = view.isOpen(n.id) && n.children.length > 0;
  return (
    <li className={cn('relative flex flex-col items-center px-1.5', depth > 0 && 'pt-6')}>
      {depth > 0 && (
        <>
          <span aria-hidden className="absolute left-1/2 top-0 h-6 w-0.5 -translate-x-1/2 bg-[var(--erp-track)]" />
          {!first && <span aria-hidden className="absolute left-0 top-0 h-0.5 w-1/2 bg-[var(--erp-track)]" />}
          {!last && <span aria-hidden className="absolute right-0 top-0 h-0.5 w-1/2 bg-[var(--erp-track)]" />}
        </>
      )}
      <NodeCard n={n} root={depth === 0 && n.children.length > 0} view={view} />
      {open && (
        <>
          <span aria-hidden className="h-7 w-0.5 bg-[var(--erp-track)]" />
          <ul className="flex items-start justify-center">
            {n.children.map((c, i) => (
              <Branch key={c.id} n={c} depth={depth + 1} first={i === 0} last={i === n.children.length - 1} view={view} />
            ))}
          </ul>
        </>
      )}
    </li>
  );
}

/** Phone tree: indented rows with a rail down the left of each branch. */
function Row({ n, depth, view }: { n: OrgNode; depth: number; view: View }): React.JSX.Element {
  const open = view.isOpen(n.id) && n.children.length > 0;
  const hit = view.hit.has(n.id);
  return (
    <li id={`org-${n.id}`}>
      <div className={cn('flex items-center gap-2 rounded-[18px] p-2 pr-2.5', depth === 0 ? 'erp-on-dark bg-[var(--erp-dark)] text-[var(--erp-on-dark)]' : 'bg-[var(--erp-card)]', hit && 'ring-2 ring-[var(--erp-accent)]')}>
        <button type="button" onClick={() => navigate('employee', { id: n.id })} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <PersonAvatar name={n.name} photo={n.photo} size={40} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-bold">{n.name}</span>
            <span className={cn('block truncate text-[12px]', depth === 0 ? 'text-[var(--erp-on-dark-muted)]' : 'text-[var(--erp-muted)]')}>
              {[n.job_title, n.department?.name ?? ''].filter((x) => x !== '').join(' · ')}
            </span>
          </span>
        </button>
        {n.children.length > 0 && (
          <button
            type="button"
            onClick={() => view.toggle(n.id)}
            aria-expanded={open}
            aria-label={`${open ? 'Fold' : 'Show'} the reports of ${n.name}`}
            className={cn('num flex h-9 shrink-0 items-center gap-1 rounded-full px-3 text-[12px] font-bold', depth === 0 ? 'bg-[var(--erp-dark-2)]' : 'bg-[var(--erp-row)]')}
          >
            {n.children.length}
            <ChevronRight size={14} aria-hidden className={cn('transition-transform', open && 'rotate-90')} />
          </button>
        )}
      </div>
      {open && (
        <ul className="ml-5 mt-2 flex flex-col gap-2 border-l-2 border-[var(--erp-track)] pl-3">
          {n.children.map((c) => (
            <Row key={c.id} n={c} depth={depth + 1} view={view} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function OrgPage({ query }: PageProps): React.JSX.Element {
  void query;
  const live = useLive(() => op<OrgTree>('employees.org', {}, { quiet: true }), ['employees', 'departments'], []);
  const wide = useWide();
  const [folded, setFolded] = useState<Set<string> | null>(null);
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim().toLowerCase(), 200);
  const tree = live.data;
  const flat = useMemo(() => (tree !== null ? flatten(tree.roots) : []), [tree]);

  // Big organisations start folded below the second level.
  useEffect(() => {
    if (tree === null || folded !== null) return;
    setFolded(new Set(tree.count > 40 ? flat.filter((x) => x.depth >= 1 && x.node.children.length > 0).map((x) => x.node.id) : []));
  }, [tree, flat, folded]);

  const matches = useMemo(() => (dq === '' ? [] : flat.filter((x) => `${x.node.name} ${x.node.job_title} ${x.node.department?.name ?? ''}`.toLowerCase().includes(dq))), [flat, dq]);
  const forcedOpen = useMemo(() => new Set(matches.flatMap((m) => m.path)), [matches]);
  const hit = useMemo(() => new Set(matches.map((m) => m.node.id)), [matches]);

  useEffect(() => {
    const first = matches[0];
    if (first === undefined) return;
    const t = setTimeout(() => document.getElementById(`org-${first.node.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' }), 80);
    return () => clearTimeout(t);
  }, [matches]);

  const view: View = {
    isOpen: (id) => forcedOpen.has(id) || !(folded ?? new Set<string>()).has(id),
    toggle: (id) => {
      if (forcedOpen.has(id)) setQ('');
      setFolded((f) => {
        const next = new Set(f ?? []);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    hit,
  };
  const managers = flat.filter((x) => x.node.children.length > 0).map((x) => x.node.id);
  const allOpen = folded !== null && folded.size === 0;

  return (
    <div>
      <PageHeader
        title="Org chart"
        subtitle={tree !== null ? `${plural(tree.count, 'person', 'people')}, ${plural(tree.depth, 'level')}` : undefined}
        actions={
          <>
            {managers.length > 0 && (
              <PillButton variant="light" icon={allOpen ? ChevronsDownUp : ChevronsUpDown} onClick={() => setFolded(allOpen ? new Set(managers) : new Set())}>
                {allOpen ? 'Fold all' : 'Show everyone'}
              </PillButton>
            )}
            <PillButton variant="light" icon={Users} onClick={() => navigate('employees')}>
              Directory
            </PillButton>
          </>
        }
      />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <SearchBox value={q} onChange={setQ} placeholder="Find a person, job or department" ariaLabel="Find a person" className="w-full @min-[480px]:max-w-md" />
        {dq !== '' && <p className="px-2 text-[12px] font-semibold text-[var(--erp-muted)]">{matches.length === 0 ? 'Nobody matches' : plural(matches.length, 'match', 'matches')}</p>}
      </div>

      {live.error !== null && tree === null ? (
        <LoadError message={live.error} onRetry={live.reload} />
      ) : tree === null ? (
        <div className="flex flex-col items-center gap-6">
          <Skeleton className="h-36 w-52" rounded="rounded-[22px]" />
          <div className="flex gap-4">
            <Skeleton className="h-36 w-52" rounded="rounded-[22px]" />
            <Skeleton className="hidden h-36 w-52 @min-[640px]:block" rounded="rounded-[22px]" />
          </div>
        </div>
      ) : tree.count === 0 ? (
        <Card>
          <Empty icon={Network} title="No one on the chart yet">
            People appear here once they are added, under the manager they report to.
          </Empty>
        </Card>
      ) : wide ? (
        <div className="erp-rise -mx-2 relative overflow-x-auto px-2 pb-8">
          <ul className="mx-auto flex w-max items-start justify-center gap-6">
            {tree.roots.map((r) => (
              <Branch key={r.id} n={r} depth={0} first last view={view} />
            ))}
          </ul>
        </div>
      ) : (
        <ul className="erp-rise flex flex-col gap-2">
          {tree.roots.map((r) => (
            <Row key={r.id} n={r} depth={0} view={view} />
          ))}
        </ul>
      )}
    </div>
  );
}
