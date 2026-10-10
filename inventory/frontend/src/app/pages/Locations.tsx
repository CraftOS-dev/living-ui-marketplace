/**
 * Locations: the places stock is kept, as a tree (a shelf in a room in a
 * site). Each row expands to the places inside it and has a "+" to add one.
 * Choosing a place shows what is stored there (and inside it), with its
 * label, a count, and edit or delete.
 */
import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, ClipboardCheck, MapPinned, Minus, MoveRight, Pencil, Plus, QrCode as QrIcon, Trash2, Warehouse } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { Code128 } from '../components/Barcode.tsx';
import { Menu } from '../components/controls.tsx';
import { LocationSelect } from '../components/pickers.tsx';
import { useStockChange } from '../components/StockChange.tsx';
import { Card, CardHeader, CircleButton, Empty, Field, Modal, PageHeader, PillButton, TextLink, errMessage, softInput, useConfirm } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { money, plural, qty } from '../lib/format.ts';
import { ItemThumb, KINDS, KIND_LABELS, KIND_SHORT, PLACE_HOLDS, aKind, defaultChildKind, holdsText, kindIcon, placeFits } from '../lib/icons.tsx';
import { useLive } from '../lib/live.ts';
import { navigate, replaceQuery } from '../lib/router.ts';
import type { LocationKind, LocationNode } from '../lib/types.ts';

interface Draft {
  id: string | null;
  name: string;
  parent: string;
  kind: LocationKind;
  code: string;
  notes: string;
}

function LocationForm({ draft, onClose }: { draft: Draft; onClose: (savedId: string | null) => void }): React.JSX.Element {
  const [d, setD] = useState(draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editing = d.id !== null;
  const { locations, locationById } = useApp();
  // Places nest by size: the kinds offered fit the place it sits inside (and,
  // when editing, still hold what is inside it); the places offered to sit
  // inside can hold its kind.
  const parent = d.parent !== '' ? (locationById.get(d.parent) ?? null) : null;
  const inside = useMemo(() => {
    const out = new Set<string>();
    if (d.id === null) return out;
    let frontier = [d.id];
    while (frontier.length > 0) {
      const next = locations.filter((l) => l.parent !== null && frontier.includes(l.parent)).map((l) => l.id);
      next.forEach((id) => out.add(id));
      frontier = next;
    }
    return out;
  }, [locations, d.id]);
  const childKinds = useMemo(() => (d.id === null ? [] : locations.filter((l) => l.parent === d.id).map((l) => l.kind)), [locations, d.id]);
  const kindFits = (k: LocationKind): boolean => (parent === null || placeFits(k, parent.kind)) && childKinds.every((c) => placeFits(c, k));
  const parentIds = useMemo(
    () => locations.filter((l) => l.id !== d.id && !inside.has(l.id) && placeFits(d.kind, l.kind)).map((l) => l.id),
    [locations, d.id, d.kind, inside],
  );
  const save = async (): Promise<void> => {
    if (d.name.trim() === '') {
      setError('Give the place a name');
      return;
    }
    setBusy(true);
    try {
      const body = { name: d.name.trim(), parent: d.parent, kind: d.kind, code: d.code.trim(), notes: d.notes.trim() };
      const r = editing && d.id !== null ? await api.updateLocation(d.id, body) : await api.addLocation(body);
      toast.success(editing ? 'Saved' : `Added ${r.name}`);
      onClose(r.id);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={() => onClose(null)}
      title={editing ? 'Edit place' : 'New place'}
      description={editing ? undefined : 'Wherever stock is kept: a room, a shelf, a cabinet, a bin, a van...'}
      footer={
        <>
          <PillButton variant="light" onClick={() => onClose(null)}>
            Cancel
          </PillButton>
          <PillButton variant="dark" loading={busy} onClick={() => void save()}>
            {editing ? 'Save' : 'Add place'}
          </PillButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name" error={error}>
          <input
            autoFocus
            value={d.name}
            onChange={(e) => {
              setD({ ...d, name: e.target.value });
              setError(null);
            }}
            onKeyDown={(e) => e.key === 'Enter' && void save()}
            maxLength={60}
            placeholder="For example: Shelf A"
            aria-label="Name"
            className={softInput}
          />
        </Field>
        <Field
          label="What kind of place"
          hint={parent !== null ? `${parent.name}: ${KIND_LABELS[parent.kind].toLowerCase()}. ${holdsText(parent.kind)}` : 'Bigger places hold smaller ones: a van can hold a cabinet, never the other way round.'}
        >
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
            {KINDS.map((k) => {
              const Icon = kindIcon(k);
              const on = d.kind === k;
              const ok = kindFits(k);
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={on}
                  disabled={!ok && !on}
                  title={ok ? KIND_LABELS[k] : parent !== null && !placeFits(k, parent.kind) ? `${KIND_LABELS[k]} cannot go inside ${parent.name}` : `${KIND_LABELS[k]} cannot hold what is inside this place`}
                  onClick={() => setD({ ...d, kind: k })}
                  className={cn(
                    'flex flex-col items-center gap-1 rounded-[16px] px-1 py-2.5 text-[12px] font-semibold transition-colors',
                    on
                      ? 'iv-on-ink bg-[var(--iv-ink)] text-[var(--iv-shell)]'
                      : ok
                        ? 'bg-[var(--iv-row)] hover:bg-[var(--iv-row-hover)]'
                        : 'border border-dashed border-[var(--iv-line)] bg-transparent text-[var(--iv-muted)]',
                  )}
                >
                  <Icon size={17} aria-hidden />
                  <span className="w-full truncate text-center">{KIND_SHORT[k]}</span>
                </button>
              );
            })}
          </div>
        </Field>
        <Field label="Inside" hint="Only places that can hold this kind are listed.">
          <LocationSelect
            value={d.parent}
            onChange={(id) => setD({ ...d, parent: id })}
            only={parentIds}
            soft
            allowNone
            noneLabel="Nothing (top level)"
            ariaLabel="Inside which place"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Code" hint="Scannable. Empty: numbered for you.">
            <input value={d.code} onChange={(e) => setD({ ...d, code: e.target.value.replace(/\s/g, '') })} maxLength={32} placeholder="LOC-004" aria-label="Code" className={cn(softInput, 'num')} />
          </Field>
          <Field label="Notes">
            <input value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} maxLength={500} placeholder="Optional" aria-label="Notes" className={softInput} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function TreeRow({
  node,
  selected,
  open,
  onToggle,
  onAdd,
}: {
  node: LocationNode;
  selected: string;
  open: Set<string>;
  onToggle: (id: string) => void;
  onAdd: (parent: LocationNode) => void;
}): React.JSX.Element {
  const Icon = kindIcon(node.kind);
  const isOpen = open.has(node.id);
  const on = node.id === selected;
  return (
    <li>
      <div className={cn('group flex items-center gap-1 rounded-[16px] pr-1 transition-colors', on ? 'iv-on-ink bg-[var(--iv-ink)] text-[var(--iv-shell)]' : 'hover:bg-[var(--iv-row)]')}>
        <button
          type="button"
          onClick={() => onToggle(node.id)}
          aria-label={isOpen ? `Collapse ${node.name}` : `Expand ${node.name}`}
          aria-expanded={isOpen}
          disabled={node.children.length === 0}
          className="flex size-8 shrink-0 items-center justify-center rounded-full disabled:opacity-0"
        >
          <ChevronRight size={15} className={cn('transition-transform', isOpen && 'rotate-90')} />
        </button>
        <button type="button" onClick={() => navigate('locations', { id: node.id })} className="flex min-w-0 flex-1 items-center gap-2.5 py-2 text-left">
          <Icon size={16} className={cn('shrink-0', on ? '' : 'text-[var(--iv-ink-2)]')} aria-hidden />
          <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{node.name}</span>
          <span className={cn('num shrink-0 text-[12px]', on ? 'opacity-80' : 'text-[var(--iv-muted)]')}>{node.total.items > 0 ? plural(node.total.items, 'item') : ''}</span>
        </button>
        {PLACE_HOLDS[node.kind].length > 0 ? (
          <button
            type="button"
            onClick={() => onAdd(node)}
            aria-label={`Add a place inside ${node.name}`}
            title="Add a place inside"
            className={cn('flex size-8 shrink-0 items-center justify-center rounded-full opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100', on ? 'hover:bg-[var(--iv-shell)]/15' : 'hover:bg-[var(--iv-row-hover)]')}
          >
            <Plus size={15} />
          </button>
        ) : (
          <span aria-hidden className="size-8 shrink-0" />
        )}
      </div>
      {isOpen && node.children.length > 0 && (
        <ul className="flex flex-col gap-0.5 pl-3">
          {node.children.map((c) => (
            <TreeRow key={c.id} node={c} selected={selected} open={open} onToggle={onToggle} onAdd={onAdd} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function LocationsPage({ selected }: { selected: string }): React.JSX.Element {
  const { tree, locations, locationById, currency } = useApp();
  const change = useStockChange();
  const [form, setForm] = useState<Draft | null>(null);
  const [confirmEl, confirm] = useConfirm();
  const current = selected !== '' ? selected : (tree[0]?.id ?? '');
  const [open, setOpen] = useState<Set<string>>(() => new Set(tree.map((n) => n.id)));
  const detail = useLive(() => (current !== '' ? api.location(current) : Promise.resolve(null)), ['locations', 'stock', 'items'], [current]);
  const loc = detail.data;

  // Keep the chosen place's ancestors open so it is visible in the tree.
  const byId = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations]);
  useEffect(() => {
    if (current === '') return;
    setOpen((o) => {
      const n = new Set(o);
      let p = byId.get(current)?.parent ?? null;
      while (p !== null && p !== undefined) {
        n.add(p);
        p = byId.get(p)?.parent ?? null;
      }
      return n;
    });
    if (selected === '' && current !== '') replaceQuery('locations', { id: current });
  }, [current, byId, selected]);

  const toggle = (id: string): void =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const newPlace = (parent: string): void =>
    setForm({ id: null, name: '', parent, kind: defaultChildKind(parent === '' ? null : (locationById.get(parent)?.kind ?? null)) ?? 'other', code: '', notes: '' });

  const remove = async (): Promise<void> => {
    if (loc === null) return;
    try {
      const p = await api.deleteLocation(loc.id, true);
      if (p.blocked !== null) {
        toast.error(`${loc.name}: ${p.blocked}`);
        return;
      }
      const parts = [
        p.moves_up.length > 0 ? `${p.moves_up.join(', ')} move${p.moves_up.length === 1 ? 's' : ''} up to ${p.moves_up_to}.` : null,
        p.history_entries_removed > 0 ? `Its ${plural(p.history_entries_removed, 'history entry', 'history entries')} are removed.` : null,
      ].filter((x) => x !== null);
      const ok = await confirm(`"${loc.name}" is deleted. ${parts.join(' ')}`, 'Delete this place?');
      if (!ok) return;
      await api.deleteLocation(loc.id);
      toast.success('Deleted');
      navigate('locations');
    } catch {
      /* toasted */
    }
  };

  const startCount = async (): Promise<void> => {
    if (loc === null) return;
    try {
      const c = await api.startCount({ location: loc.id, include_sub: true });
      navigate('count', { id: c.id });
    } catch {
      /* toasted */
    }
  };

  return (
    <div>
      <PageHeader
        title="Locations"
        subtitle={`${plural(locations.length, 'place')} where stock is kept`}
        actions={
          <PillButton variant="dark" icon={Plus} dot onClick={() => newPlace('')}>
            New place
          </PillButton>
        }
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:items-start">
        <Card className="lg:sticky lg:top-8 lg:col-span-4" delay={1}>
          <CardHeader title="All places" subtitle="Expand a place to see what is inside it" />
          {tree.length === 0 ? (
            <Empty icon={Warehouse} title="No places yet" action={<PillButton variant="dark" icon={Plus} dot onClick={() => newPlace('')}>Add a place</PillButton>} />
          ) : (
            <ul className="-mx-2 flex flex-col gap-0.5">
              {tree.map((n) => (
                <TreeRow key={n.id} node={n} selected={current} open={open} onToggle={toggle} onAdd={(p) => newPlace(p.id)} />
              ))}
            </ul>
          )}
        </Card>

        <div className="flex flex-col gap-5 lg:col-span-8">
          {loc !== null && (
            <>
              <Card tone="dark" delay={2}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-4">
                    <span className="flex size-14 shrink-0 items-center justify-center rounded-[18px] bg-[var(--iv-dark-2)]">
                      {(() => {
                        const Icon = kindIcon(loc.kind);
                        return <Icon size={24} aria-hidden />;
                      })()}
                    </span>
                    <div className="min-w-0">
                      <h2 className="truncate text-[26px] font-bold leading-[34px] tracking-[-0.01em]">{loc.name}</h2>
                      <p className="truncate text-[13px] text-[var(--iv-on-dark-muted)]">
                        {KIND_LABELS[loc.kind]} · <span className="num">{loc.code}</span>
                        {loc.parent !== null ? ` · in ${loc.parent.path}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <PillButton variant="accent" icon={ClipboardCheck} onClick={() => void startCount()}>
                      Count here
                    </PillButton>
                    <Menu
                      items={[
                        { label: 'Edit', icon: Pencil, onClick: () => setForm({ id: loc.id, name: loc.name, parent: loc.parent?.id ?? '', kind: loc.kind, code: loc.code, notes: loc.notes }) },
                        { label: 'Add a place inside', icon: Plus, hidden: PLACE_HOLDS[loc.kind].length === 0, onClick: () => newPlace(loc.id) },
                        { label: 'Print its label', icon: QrIcon, onClick: () => navigate('labels', { locations: loc.id }) },
                        { label: 'Delete', icon: Trash2, danger: true, onClick: () => void remove() },
                      ]}
                    />
                  </div>
                </div>
                <div className="mt-5 grid grid-cols-3 gap-2">
                  <div className="rounded-[18px] bg-[var(--iv-dark-2)] p-3">
                    <span className="block text-[12px] text-[var(--iv-on-dark-muted)]">Items</span>
                    <span className="num block text-[15px] font-bold">{qty(loc.item_count)}</span>
                  </div>
                  <div className="rounded-[18px] bg-[var(--iv-dark-2)] p-3">
                    <span className="block text-[12px] text-[var(--iv-on-dark-muted)]">Units</span>
                    <span className="num block text-[15px] font-bold">{qty(loc.units)}</span>
                  </div>
                  <div className="rounded-[18px] bg-[var(--iv-dark-2)] p-3">
                    <span className="block text-[12px] text-[var(--iv-on-dark-muted)]">Value</span>
                    <span className="num block truncate text-[15px] font-bold">{money(loc.value, currency)}</span>
                  </div>
                </div>
                {loc.children.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {loc.children.map((c) => {
                      const Icon = kindIcon(c.kind);
                      return (
                        <button key={c.id} type="button" onClick={() => navigate('locations', { id: c.id })} className="inline-flex h-9 items-center gap-2 rounded-full bg-[var(--iv-dark-2)] px-3.5 text-[13px] font-semibold hover:opacity-90">
                          <Icon size={14} aria-hidden /> {c.name}
                        </button>
                      );
                    })}
                  </div>
                )}
                {loc.notes !== '' && <p className="mt-4 text-[13px] text-[var(--iv-on-dark-muted)]">{loc.notes}</p>}
                {(() => {
                  // A place saved before the nesting rules may sit somewhere it does not fit.
                  const parentKind = loc.parent !== null ? locationById.get(loc.parent.id)?.kind : undefined;
                  if (parentKind === undefined || placeFits(loc.kind, parentKind)) return null;
                  return (
                    <div className="mt-4 flex flex-wrap items-center gap-3 rounded-[16px] bg-[var(--iv-dark-2)] px-3.5 py-2.5">
                      <span className="min-w-0 flex-1 text-[13px]">
                        {loc.name} is {aKind(loc.kind)}, and {aKind(parentKind)} cannot hold it. Move it to a place that can.
                      </span>
                      <PillButton
                        variant="light"
                        icon={Pencil}
                        onClick={() => setForm({ id: loc.id, name: loc.name, parent: '', kind: loc.kind, code: loc.code, notes: loc.notes })}
                        className="h-9 px-4 text-[13px]"
                      >
                        Move it
                      </PillButton>
                    </div>
                  );
                })()}
              </Card>

              <Card delay={3}>
                <CardHeader title="Stored here" subtitle={loc.children.length > 0 ? 'Including the places inside it' : undefined} />
                {loc.stock.length === 0 ? (
                  <Empty icon={MapPinned} title="Nothing here yet">
                    Stock recorded in this place, or in the places inside it, shows here.
                  </Empty>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {loc.stock.map((s) => (
                      <li key={`${s.item.id}:${s.location.id}`} className="flex items-center gap-3 rounded-[18px] bg-[var(--iv-row)] px-3 py-2.5">
                        <button type="button" onClick={() => navigate('item', { id: s.item.id })} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                          <ItemThumb photo={s.item.photo} icon={s.item.icon} size={40} tone="card" rounded="rounded-[12px]" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px] font-bold">{s.item.name}</span>
                            <span className="block truncate text-[12px] text-[var(--iv-muted)]">
                              {s.item.sku}
                              {s.location.id !== loc.id ? ` · ${s.location.name}` : ''}
                            </span>
                          </span>
                        </button>
                        <span className="num w-20 text-right">
                          <span className="block text-[15px] font-bold">{qty(s.qty)}</span>
                          <span className="block text-[12px] text-[var(--iv-muted)]">{s.item.unit}</span>
                        </span>
                        <span className="flex gap-1">
                          <CircleButton icon={Minus} label={`Take out ${s.item.name}`} variant="light" size={34} onClick={(e) => change.open(e.currentTarget, { item: s.item, mode: 'out', location: s.location.id })} />
                          <CircleButton icon={MoveRight} label={`Move ${s.item.name}`} variant="light" size={34} onClick={(e) => change.open(e.currentTarget, { item: s.item, mode: 'move', location: s.location.id })} />
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                  <TextLink tone="muted" onClick={() => navigate('activity', { location: loc.id })}>
                    History of this place
                  </TextLink>
                  <PillButton variant="soft" icon={Plus} onClick={(e) => change.open(e.currentTarget, { mode: 'in', location: loc.id })}>
                    Add stock here
                  </PillButton>
                </div>
              </Card>

              <Card delay={4} className="flex flex-wrap items-center gap-5">
                <div className="w-full max-w-56 shrink-0 rounded-[18px] bg-[var(--iv-paper)] p-4 text-[var(--iv-paper-ink)] ring-1 ring-[var(--iv-line)]">
                  <p className="truncate text-[13px] font-bold">{loc.name}</p>
                  <Code128 value={loc.code} height={40} className="mt-2 h-11 w-full" />
                  <p className="num mt-1 text-center text-[12px] font-semibold tracking-wider">{loc.code}</p>
                </div>
                <div className="min-w-0 flex-1 basis-56">
                  <p className="text-[15px] font-bold">Its label</p>
                  <p className="mt-1 text-[13px] text-[var(--iv-ink-2)]">Stick it on the shelf or bin. Scanning it on the Scan page sets where stock goes; scanning it anywhere else opens this place.</p>
                  <PillButton variant="soft" icon={QrIcon} onClick={() => navigate('labels', { locations: loc.id })} className="mt-3">
                    Print labels
                  </PillButton>
                </div>
              </Card>
            </>
          )}
          {loc === null && tree.length > 0 && <span className="h-72 animate-pulse rounded-[24px] bg-[var(--iv-dark)]" />}
        </div>
      </div>
      {form !== null && (
        <LocationForm
          draft={form}
          onClose={(saved) => {
            setForm(null);
            if (saved !== null) navigate('locations', { id: saved });
          }}
        />
      )}
      {confirmEl}
    </div>
  );
}
