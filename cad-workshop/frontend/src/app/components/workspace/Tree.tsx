/**
 * The left panel: parameters (named numbers: type a value or an
 * expression, use the arrow keys, or drag the name sideways to scrub), the
 * feature tree in build order, the rollback bar, and the bodies with their
 * eye toggles. A click on a feature lights up its geometry, a double click
 * edits it, a right click opens its menu, and rows drag to a new place in
 * the order.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight, CircleDashed, CircleX, Eye, EyeOff, Pencil, Plus, Sparkles, TriangleAlert, Undo2, Variable } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { api } from '../../lib/api.ts';
import { evaluate, isPlain } from '../../lib/expr.ts';
import { num, volume } from '../../lib/format.ts';
import type { Unit } from '../../lib/format.ts';
import { iconByName } from '../../lib/icons.ts';
import { featureTitle } from '../../lib/keys.ts';
import type { Feature, Parameter, PartDetail } from '../../lib/types.ts';
import { DeleteButton } from '../DeleteButton.tsx';
import { Button, IconButton, Popover, Spinner, errMessage, inputCls, menuItem } from '../ui.tsx';

const UNIT: Record<Parameter['kind'], string> = { length: 'mm', angle: '°', count: '', ratio: '×' };

function Section({ title, icon, count, open, onToggle, action, children }: { title: string; icon?: ReactNode; count?: number; open: boolean; onToggle: () => void; action?: ReactNode; children: ReactNode }): React.JSX.Element {
  return (
    <section className="flex flex-col border-b border-[var(--cw-hair)] pb-1.5 last:border-b-0">
      <div className="flex h-8 items-center gap-1 px-1.5">
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded-[var(--cw-r-sm)] px-1 text-left hover:bg-[var(--cw-row)]">
          {open ? <ChevronDown size={12} aria-hidden className="text-[var(--cw-muted)]" /> : <ChevronRight size={12} aria-hidden className="text-[var(--cw-muted)]" />}
          {icon}
          <span className="text-[12px] font-bold text-[var(--cw-ink-2)]">{title}</span>
          {count !== undefined && <span className="num rounded-[3px] bg-[var(--cw-row)] px-1 text-[12px] leading-4 text-[var(--cw-muted)]">{count}</span>}
        </button>
        {action}
      </div>
      {open && children}
    </section>
  );
}

/* ------------------------------------------------------------ parameters */

function ParamRow({ part, p, env }: { part: string; p: Parameter; env: Record<string, number> }): React.JSX.Element {
  const [text, setText] = useState(p.expr);
  const [editing, setEditing] = useState(false);
  const [live, setLive] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrub = useRef<{ x: number; v: number } | null>(null);
  useEffect(() => {
    if (!editing && live === null) setText(p.expr);
  }, [p.expr, editing, live]);
  const send = (value: string, silent = false): void => {
    if (value.trim() === '' || value.trim() === p.expr) return;
    api.setParam(part, { name: p.name, value: value.trim() }, { silent }).catch((err: unknown) => {
      if (!silent) toast.error(errMessage(err));
      setText(p.expr);
    });
  };
  const sendSoon = (v: number): void => {
    const s = String(Math.round(v * 1000) / 1000);
    setText(s);
    setLive(v);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => send(s, true), 140);
  };
  const plain = isPlain(p.expr);
  const ranged = typeof p.bounds?.min === 'number' && typeof p.bounds.max === 'number' && p.bounds.max > p.bounds.min;
  const step = p.kind === 'count' ? 1 : p.kind === 'angle' ? 1 : Math.max(0.1, Math.abs(p.value) >= 100 ? 1 : 0.5);
  const clamp = (v: number): number => {
    let x = p.kind === 'count' ? Math.round(v) : v;
    if (p.bounds?.min !== undefined) x = Math.max(p.bounds.min, x);
    if (p.bounds?.max !== undefined) x = Math.min(p.bounds.max, x);
    return x;
  };
  let preview: string | null = null;
  if (editing && text.trim() !== '' && !isPlain(text)) {
    try {
      preview = '= ' + num(evaluate(text, env), 4);
    } catch (err) {
      preview = (err as Error).message;
    }
  }
  return (
    <div className="group flex flex-col rounded-[var(--cw-r-sm)] px-1.5 hover:bg-[var(--cw-row)]">
      <div className="flex h-7 items-center gap-1.5">
        <span
          className={cn('min-w-0 flex-1 truncate font-semibold', plain && 'cursor-ew-resize touch-none select-none')}
          title={(p.comment !== '' ? p.comment + '\n' : '') + (plain ? 'Drag sideways to change' : p.name)}
          onPointerDown={(e) => {
            if (!plain) return;
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            scrub.current = { x: e.clientX, v: p.value };
          }}
          onPointerMove={(e) => {
            const s = scrub.current;
            if (s === null) return;
            const px = e.clientX - s.x;
            if (Math.abs(px) < 2) return;
            sendSoon(clamp(s.v + Math.round(px / (p.kind === 'count' ? 8 : 2)) * step * (e.shiftKey ? 10 : e.altKey ? 0.1 : 1)));
          }}
          onPointerUp={() => {
            scrub.current = null;
            setLive(null);
          }}
        >
          {p.name}
        </span>
        {p.author === 'agent' && <Sparkles size={12} aria-label="Made by your AI agent" className="shrink-0 text-[var(--cw-accent-text)]" />}
        <input
          aria-label={'Value of ' + p.name}
          value={text}
          onFocus={(e) => {
            setEditing(true);
            e.target.select();
          }}
          onBlur={() => {
            setEditing(false);
            send(text);
          }}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') {
              setText(p.expr);
              setEditing(false);
              (e.target as HTMLInputElement).blur();
            }
            if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && isPlain(text)) {
              e.preventDefault();
              sendSoon(clamp(Number(text) + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : e.altKey ? 0.1 : 1)));
            }
          }}
          className={cn('num editable h-6 w-[76px] rounded-[var(--cw-r-sm)] border bg-[var(--cw-card)] px-1.5 text-right outline-none transition-colors focus:border-[var(--cw-ink)]', p.error !== '' ? 'border-[var(--cw-red)]' : 'border-[var(--cw-line)] hover:border-[var(--cw-muted)]')}
          spellCheck={false}
        />
        <span className="w-4 shrink-0 text-[12px] text-[var(--cw-muted)]">{UNIT[p.kind]}</span>
        <span className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          <DeleteButton collection="parameters" id={p.id} name={p.name} size={20} />
        </span>
      </div>
      {(preview !== null || (!plain && !editing)) && <span className="num -mt-1 pb-0.5 pr-11 text-right text-[12px] leading-4 text-[var(--cw-muted)]">{preview ?? '= ' + num(p.value, 4)}</span>}
      {p.error !== '' && <span className="pb-0.5 text-[12px] leading-4 text-[var(--cw-red-text)]">{p.error}</span>}
      {ranged && plain && (
        <input
          type="range"
          className="cw-range -mt-0.5 w-full"
          aria-label={'Slide ' + p.name}
          min={p.bounds?.min}
          max={p.bounds?.max}
          step={p.kind === 'count' ? 1 : ((p.bounds?.max ?? 1) - (p.bounds?.min ?? 0)) / 200}
          value={live ?? p.value}
          onChange={(e) => sendSoon(Number(e.target.value))}
          onPointerUp={() => setLive(null)}
        />
      )}
    </div>
  );
}

function NewParam({ part, onDone }: { part: string; onDone: () => void }): React.JSX.Element {
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [kind, setKind] = useState<Parameter['kind']>('length');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.setParam(part, { name: name.trim(), value: value.trim(), kind, min: min.trim() === '' ? undefined : Number(min), max: max.trim() === '' ? undefined : Number(max) });
      onDone();
    } catch {
      /* the toast says why */
    } finally {
      setBusy(false);
    }
  };
  const field = cn(inputCls, 'h-6 px-1.5 text-[12px]');
  return (
    <div className="my-1 flex flex-col gap-1 rounded-[var(--cw-r)] border border-[var(--cw-line)] bg-[var(--cw-shell)] p-1.5">
      <div className="flex gap-1">
        <input autoFocus aria-label="Parameter name" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} className={cn(field, 'flex-1')} spellCheck={false} />
        <input aria-label="Parameter value" placeholder="Value" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} className={cn(field, 'num w-20 flex-none')} spellCheck={false} />
      </div>
      <div className="flex items-center gap-1">
        <select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value as Parameter['kind'])} className={cn(field, 'flex-1 appearance-none pr-1.5')}>
          <option value="length">Length (mm)</option>
          <option value="angle">Angle (°)</option>
          <option value="count">Count</option>
          <option value="ratio">Ratio</option>
        </select>
        <input aria-label="Minimum" title="Minimum (with a maximum, gives a slider)" placeholder="min" value={min} onChange={(e) => setMin(e.target.value)} className={cn(field, 'num w-11 flex-none')} />
        <input aria-label="Maximum" title="Maximum" placeholder="max" value={max} onChange={(e) => setMax(e.target.value)} className={cn(field, 'num w-11 flex-none')} />
      </div>
      <div className="flex items-center justify-end gap-1">
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" disabled={busy || name.trim() === '' || value.trim() === ''} onClick={() => void save()}>
          Add
        </Button>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- features */

function StatusIcon({ f, building }: { f: Feature; building: boolean }): React.JSX.Element | null {
  if (f.status === 'error') return <CircleX size={13} aria-label="Fails" className="shrink-0 text-[var(--cw-red-text)]" />;
  if (f.status === 'warning') return <TriangleAlert size={13} aria-label="Built with a warning" className="shrink-0 text-[var(--cw-amber-text)]" />;
  if (f.status === 'not_built' && !f.suppressed) return <CircleDashed size={13} aria-label="Not built" className="shrink-0 text-[var(--cw-muted)]" />;
  if (f.status === 'pending' && building) return <Spinner size={11} className="text-[var(--cw-muted)]" />;
  return null;
}

function RenameInline({ part, f, onDone }: { part: string; f: Feature; onDone: () => void }): React.JSX.Element {
  const [name, setName] = useState(featureTitle(f.name) === f.name ? f.name : '');
  const save = (): void => {
    const n = name.trim();
    onDone();
    if (n === '' || n === f.name) return;
    api.updateFeature(part, f.name, { name: n }).catch((err: unknown) => toast.error(errMessage(err)));
  };
  return (
    <input
      autoFocus
      aria-label={'New name for ' + featureTitle(f.name)}
      value={name}
      placeholder={featureTitle(f.name)}
      onChange={(e) => setName(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter') save();
        if (e.key === 'Escape') onDone();
      }}
      className="h-6 min-w-0 flex-1 rounded-[var(--cw-r-sm)] border border-[var(--cw-ink)] bg-[var(--cw-card)] px-1.5 outline-none"
      spellCheck={false}
    />
  );
}

export function Tree({
  detail,
  unit,
  active,
  current,
  hidden,
  onToggleBody,
  onSelect,
  onEdit,
  onHoverFeature,
  building,
}: {
  detail: PartDetail;
  unit: Unit;
  /** The feature being edited. */
  active: string | null;
  /** Features owning what is selected in the view (and the clicked row). */
  current: string[];
  hidden: string[];
  onToggleBody: (name: string) => void;
  onSelect: (f: Feature | null) => void;
  onEdit: (f: Feature) => void;
  onHoverFeature: (name: string | null) => void;
  building: boolean;
}): React.JSX.Element {
  const part = detail.part.id;
  const [openParams, setOpenParams] = useState(true);
  const [openFeatures, setOpenFeatures] = useState(true);
  const [openBodies, setOpenBodies] = useState(true);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [barDrag, setBarDrag] = useState<number | null>(null);
  const [moving, setMoving] = useState<{ name: string; to: number } | null>(null);
  const rows = useRef<(HTMLDivElement | null)[]>([]);
  const env: Record<string, number> = {};
  for (const p of detail.parameters) env[p.name] = p.value;
  const feats = detail.features;
  const rbIndex = detail.rollback_after === '' ? feats.length : detail.rollback_after === 'start' ? 0 : feats.findIndex((f) => f.name === detail.rollback_after) + 1;
  const bodies = detail.build?.summary?.bodies ?? [];

  const dropAt = (clientY: number): number => {
    let idx = 0;
    rows.current.forEach((el, i) => {
      if (el === null) return;
      const r = el.getBoundingClientRect();
      if (clientY > r.top + r.height / 2) idx = i + 1;
    });
    return idx;
  };
  const act = (fn: () => Promise<unknown>): void => {
    setMenu(null);
    fn().catch((err: unknown) => toast.error(errMessage(err)));
  };
  const roll = (idx: number): void => {
    const to = idx >= feats.length ? 'end' : idx === 0 ? 'start' : (feats[idx - 1] as Feature).name;
    act(() => api.rollTo(part, to));
  };
  const moveTo = (name: string, idx: number): void => {
    const from = feats.findIndex((f) => f.name === name);
    if (from < 0 || idx === from || idx === from + 1) return;
    const others = feats.filter((f) => f.name !== name);
    const at = idx > from ? idx - 1 : idx;
    const after = at === 0 ? 'start' : (others[at - 1] as Feature).name;
    act(() => api.moveFeature(part, name, after));
  };

  const bar = (
    <div
      key="rollback"
      role="slider"
      aria-label="Rollback bar: drag to build only the features above it"
      title="Drag to roll back"
      aria-valuemin={0}
      aria-valuemax={feats.length}
      aria-valuenow={rbIndex}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp' && rbIndex > 0) roll(rbIndex - 1);
        if (e.key === 'ArrowDown' && rbIndex < feats.length) roll(rbIndex + 1);
      }}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        setBarDrag(rbIndex);
      }}
      onPointerMove={(e) => {
        if (barDrag !== null) setBarDrag(dropAt(e.clientY));
      }}
      onPointerUp={() => {
        if (barDrag !== null && barDrag !== rbIndex) roll(barDrag);
        setBarDrag(null);
      }}
      className="group mx-1.5 flex h-4 cursor-grab touch-none items-center px-1 outline-none active:cursor-grabbing"
    >
      <span className="h-[3px] flex-1 rounded-full bg-[var(--cw-accent)] group-hover:h-1 group-focus-visible:h-1" />
    </div>
  );

  const barAt = barDrag ?? rbIndex;
  const list: ReactNode[] = [];
  feats.forEach((f, i) => {
    if (barAt === i) list.push(bar);
    if (moving !== null && moving.to === i) list.push(<div key="drop" className="mx-2 h-0.5 rounded-full bg-[var(--cw-ink)]" />);
    const Icon = iconByName(f.icon);
    const rolled = i >= rbIndex;
    const isActive = active === f.name;
    const isCurrent = current.includes(f.name);
    list.push(
      <div
        key={f.id}
        ref={(el) => {
          rows.current[i] = el;
        }}
        draggable={renaming !== f.name}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', f.name);
          setMoving({ name: f.name, to: i });
        }}
        onDragOver={(e) => {
          if (moving === null) return;
          e.preventDefault();
          const to = dropAt(e.clientY);
          if (to !== moving.to) setMoving({ ...moving, to });
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (moving !== null) moveTo(moving.name, moving.to);
          setMoving(null);
        }}
        onDragEnd={() => setMoving(null)}
        onMouseEnter={() => onHoverFeature(f.name)}
        onMouseLeave={() => onHoverFeature(null)}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu(f.name);
        }}
        className={cn(
          'group relative mx-1.5 flex flex-col rounded-[var(--cw-r-sm)]',
          isActive ? 'bg-[var(--cw-row-hover)] shadow-[inset_2px_0_0_var(--cw-accent)]' : isCurrent ? 'bg-[var(--cw-row-hover)]' : f.status === 'error' ? 'bg-[var(--cw-red)]/10' : 'hover:bg-[var(--cw-row)]',
          moving?.name === f.name && 'opacity-50',
        )}
      >
        <div className="flex h-7 items-center gap-1.5 pl-2 pr-1">
          <Icon size={14} aria-hidden className={cn('shrink-0', isActive ? 'text-[var(--cw-accent-text)]' : rolled || f.suppressed ? 'text-[var(--cw-muted)]' : 'text-[var(--cw-ink-2)]')} />
          {renaming === f.name ? (
            <RenameInline part={part} f={f} onDone={() => setRenaming(null)} />
          ) : (
            <button
              type="button"
              title={f.name + (f.label !== '' ? ' · ' + f.label : '')}
              onClick={() => onSelect(f)}
              onDoubleClick={() => onEdit(f)}
              onKeyDown={(e) => {
                if (e.key === 'F2') setRenaming(f.name);
                if (e.key === 'Enter') onEdit(f);
              }}
              className="flex min-w-0 flex-1 items-baseline gap-1.5 text-left"
            >
              <span className={cn('truncate', f.suppressed ? 'text-[var(--cw-muted)] line-through' : rolled ? 'text-[var(--cw-muted)]' : 'font-medium')}>{featureTitle(f.name)}</span>
            </button>
          )}
          {f.author === 'agent' && <Sparkles size={12} aria-label="Made by your AI agent" className="shrink-0 text-[var(--cw-accent-text)]" />}
          <StatusIcon f={f} building={building} />
          <button
            type="button"
            aria-label={f.suppressed ? 'Turn on' : 'Turn off (suppress)'}
            title={f.suppressed ? 'Turn on' : 'Turn off'}
            onClick={() => act(() => api.updateFeature(part, f.name, { suppressed: !f.suppressed }))}
            className={cn('flex size-5 shrink-0 items-center justify-center rounded-[var(--cw-r-sm)] text-[var(--cw-muted)] hover:bg-[var(--cw-row-hover)] hover:text-[var(--cw-ink)]', !f.suppressed && 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100')}
          >
            {f.suppressed ? <EyeOff size={13} aria-hidden /> : <Eye size={13} aria-hidden />}
          </button>
        </div>
        {f.status === 'error' && f.error !== null && !isActive && <p className="line-clamp-2 pb-1.5 pl-[30px] pr-2 text-[12px] leading-4 text-[var(--cw-ink)]">{f.error.message}</p>}
        <Popover open={menu === f.name} onClose={() => setMenu(null)} align="right" className="w-48">
          <button type="button" className={menuItem} onClick={() => (setMenu(null), onEdit(f))}>
            <Pencil size={14} aria-hidden /> Edit
          </button>
          <button type="button" className={menuItem} onClick={() => (setMenu(null), setRenaming(f.name))}>
            <Variable size={14} aria-hidden /> Rename
          </button>
          <button type="button" className={menuItem} onClick={() => act(() => api.updateFeature(part, f.name, { suppressed: !f.suppressed }))}>
            {f.suppressed ? <Eye size={14} aria-hidden /> : <EyeOff size={14} aria-hidden />} {f.suppressed ? 'Turn on' : 'Turn off'}
          </button>
          <button type="button" className={menuItem} onClick={() => roll(i + 1)}>
            <Undo2 size={14} aria-hidden /> Roll back to here
          </button>
          <div className="my-1 border-t border-[var(--cw-hair)]" />
          <DeleteButton variant="menu" collection="features" id={f.id} name={featureTitle(f.name)} label="Delete" />
        </Popover>
      </div>,
    );
  });
  if (moving !== null && moving.to >= feats.length) list.push(<div key="drop" className="mx-2 h-0.5 rounded-full bg-[var(--cw-ink)]" />);
  if (barAt >= feats.length && feats.length > 0) list.push(bar);

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-2"
      onClick={(e) => {
        if (e.target === e.currentTarget) onSelect(null);
      }}
    >
      <Section
        title="Parameters"
        icon={<Variable size={13} aria-hidden className="text-[var(--cw-ink-2)]" />}
        count={detail.parameters.length}
        open={openParams}
        onToggle={() => setOpenParams((o) => !o)}
        action={<IconButton icon={Plus} size={22} label="Add a parameter" onClick={() => (setOpenParams(true), setAdding(true))} />}
      >
        <div className="flex flex-col px-1.5">
          {detail.parameters.map((p) => (
            <ParamRow key={p.id} part={part} p={p} env={env} />
          ))}
          {adding && <NewParam part={part} onDone={() => setAdding(false)} />}
        </div>
      </Section>
      <Section title="Features" count={feats.length} open={openFeatures} onToggle={() => setOpenFeatures((o) => !o)}>
        <div className="flex flex-col">
          {list}
          {rbIndex < feats.length && (
            <button type="button" onClick={() => roll(feats.length)} className="mx-3 mt-1 w-fit text-[12px] font-semibold text-[var(--cw-accent-text)] hover:underline">
              Roll to the end
            </button>
          )}
        </div>
      </Section>
      <Section title="Bodies" count={bodies.length} open={openBodies} onToggle={() => setOpenBodies((o) => !o)}>
        <div className="flex flex-col px-1.5">
          {bodies.map((b) => {
            const off = hidden.includes(b.name);
            return (
              <div key={b.name} className="group flex h-7 items-center gap-1.5 rounded-[var(--cw-r-sm)] px-1.5 hover:bg-[var(--cw-row)]">
                <button type="button" aria-label={(off ? 'Show ' : 'Hide ') + featureTitle(b.name)} title={off ? 'Show' : 'Hide'} onClick={() => onToggleBody(b.name)} className="flex size-5 shrink-0 items-center justify-center rounded-[var(--cw-r-sm)] text-[var(--cw-muted)] hover:text-[var(--cw-ink)]">
                  {off ? <EyeOff size={13} aria-hidden /> : <Eye size={13} aria-hidden />}
                </button>
                <span className={cn('min-w-0 flex-1 truncate', off ? 'text-[var(--cw-muted)]' : 'font-medium')} title={b.name}>
                  {featureTitle(b.name)}
                </span>
                <span className="num shrink-0 text-[12px] text-[var(--cw-muted)]">
                  {volume(b.volume_mm3, unit)}
                  {b.solids > 1 ? ' · ' + b.solids + ' pieces' : ''}
                </span>
              </div>
            );
          })}
        </div>
      </Section>
    </div>
  );
}
