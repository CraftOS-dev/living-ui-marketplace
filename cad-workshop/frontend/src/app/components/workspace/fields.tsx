/**
 * Form fields for feature params, one per schema field type, in a compact
 * label-left grid. Numbers take a plain number or an expression of the
 * part's parameters (arrow keys step them); pick fields fill from clicks in
 * the view: the active one has an accent outline, and clicking another one
 * makes it the one clicks fill. Help text lives in the label's tooltip.
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeftRight, Crosshair, Minus, Plus, X } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { asText, evaluate, fromText, isPlain } from '../../lib/expr.ts';
import { featureTitle, keyLabel, shortLabel } from '../../lib/keys.ts';
import type { Asset, Feature, FeatureKind, FieldDef, Json, Params, Topology } from '../../lib/types.ts';
import { IconButton, Segmented, Select, Toggle, inputCls } from '../ui.tsx';
import { refKeys, usedProfiles } from './tools.ts';
import type { RefKind } from './tools.ts';

export interface FormContext {
  kind: FeatureKind;
  /** Features before the one being edited (what it may use). */
  before: Feature[];
  env: Record<string, number>;
  paramNames: string[];
  bodies: string[];
  assets: Asset[];
  topo: Topology | null;
  /** The pick field clicks in the view fill (a param path), if any. */
  activePick: string | null;
  onActivatePick: (path: string) => void;
  onUploadAsset?: (file: File) => Promise<string>;
}

const UNITS: Record<string, string> = { length: 'mm', angle: '°', count: '', ratio: '×', number: '' };

/** A select shows as a segmented control when its few options are short. */
function segmentedSelect(def: FieldDef): boolean {
  const opts = def.options ?? [];
  return opts.length <= 4 && opts.every((o) => o.label.length <= 12);
}

/** Whether a field fits the label-left row. */
export function inlineField(def: FieldDef): boolean {
  switch (def.type) {
    case 'object':
    case 'sketch_items':
    case 'points2':
    case 'points3':
    case 'axis':
    case 'plane':
    case 'source':
      return false;
    default:
      return true;
  }
}

export function FieldLabel({ def, children, inline = false }: { def: FieldDef; children: ReactNode; inline?: boolean }): React.JSX.Element {
  if (def.type === 'object') return <>{children}</>;
  const label = (
    <span className={cn('truncate text-[12px] text-[var(--cw-ink-2)]', inline && 'pt-1.5', def.help !== undefined && 'cursor-help underline decoration-dotted decoration-[var(--cw-line)] underline-offset-2')} title={def.help ?? def.label ?? def.key}>
      {def.label ?? def.key}
    </span>
  );
  if (inline)
    return (
      <div className="grid grid-cols-[84px_minmax(0,1fr)] items-start gap-x-2">
        {label}
        <div className="min-w-0">{children}</div>
      </div>
    );
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {label}
      {children}
    </div>
  );
}

/* --------------------------------------------------------------- numbers */

export function NumInput({ value, onChange, env, unit, label, placeholder, prefix, step = 1 }: { value: Json | undefined; onChange: (v: Json | undefined) => void; env: Record<string, number>; unit: string; label: string; placeholder?: string; prefix?: string; step?: number }): React.JSX.Element {
  const [text, setText] = useState(asText(value));
  const [focused, setFocused] = useState(false);
  const shown = focused ? text : asText(value);
  let resolved: string | null = null;
  let bad = false;
  if (shown.trim() !== '' && !isPlain(shown)) {
    try {
      resolved = '= ' + Math.round(evaluate(shown, env) * 10000) / 10000;
    } catch (err) {
      resolved = (err as Error).message;
      bad = true;
    }
  }
  const nudge = (dir: number, mult: number): void => {
    const cur = isPlain(shown) ? Number(shown) : shown.trim() === '' ? 0 : null;
    if (cur === null) return;
    const next = Math.round((cur + dir * step * mult) * 10000) / 10000;
    setText(String(next));
    onChange(next);
  };
  return (
    <div className="flex min-w-0 flex-col">
      <div className="relative">
        {prefix !== undefined && <span className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-[12px] font-semibold uppercase text-[var(--cw-muted)]">{prefix}</span>}
        <input
          aria-label={label}
          value={shown}
          placeholder={placeholder}
          onFocus={(e) => {
            setText(asText(value));
            setFocused(true);
            e.target.select();
          }}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              nudge(e.key === 'ArrowUp' ? 1 : -1, e.shiftKey ? 10 : e.altKey ? 0.1 : 1);
            }
          }}
          onChange={(e) => {
            setText(e.target.value);
            const v = fromText(e.target.value);
            onChange(v === null ? undefined : (v as Json));
          }}
          className={cn(inputCls, 'num', unit !== '' && 'pr-7', prefix !== undefined && 'pl-4', bad && 'border-[var(--cw-red)]')}
          spellCheck={false}
        />
        {unit !== '' && <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[12px] text-[var(--cw-muted)]">{unit}</span>}
      </div>
      {resolved !== null && <span className={cn('num text-[12px] leading-4', bad ? 'text-[var(--cw-red-text)]' : 'text-[var(--cw-muted)]')}>{resolved}</span>}
    </div>
  );
}

function VecInput({ value, onChange, env, n, label }: { value: Json | undefined; onChange: (v: Json | undefined) => void; env: Record<string, number>; n: 2 | 3; label: string }): React.JSX.Element {
  const arr = Array.isArray(value) ? value : [];
  const axes = n === 2 ? ['x', 'y'] : ['x', 'y', 'z'];
  return (
    <div className={cn('grid gap-1', n === 2 ? 'grid-cols-2' : 'grid-cols-3')}>
      {axes.map((a, i) => (
        <NumInput
          key={a}
          label={label + ' ' + a}
          prefix={a}
          value={arr[i] ?? undefined}
          env={env}
          unit=""
          placeholder="0"
          onChange={(v) => onChange(axes.map((_, j) => (j === i ? (v ?? 0) : (arr[j] ?? 0))))}
        />
      ))}
    </div>
  );
}

function PointsInput({ value, onChange, env, n, label }: { value: Json | undefined; onChange: (v: Json | undefined) => void; env: Record<string, number>; n: 2 | 3; label: string }): React.JSX.Element {
  const rows = Array.isArray(value) ? value : [];
  return (
    <div className="flex flex-col gap-1">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <VecInput label={label + ' ' + (i + 1)} n={n} env={env} value={r} onChange={(v) => onChange(rows.map((x, j) => (j === i ? (v ?? []) : x)))} />
          </div>
          <IconButton icon={Minus} size={24} label={'Remove ' + (i + 1)} onClick={() => onChange(rows.length > 1 ? rows.filter((_, j) => j !== i) : undefined)} />
        </div>
      ))}
      <button type="button" onClick={() => onChange([...rows, n === 2 ? [0, 0] : [0, 0, 0]])} className="inline-flex h-6 w-fit items-center gap-1 rounded-[var(--cw-r-sm)] px-1 text-[12px] font-semibold text-[var(--cw-ink-2)] hover:bg-[var(--cw-row)] hover:text-[var(--cw-ink)]">
        <Plus size={12} aria-hidden /> Add
      </button>
    </div>
  );
}

/* ----------------------------------------------------------- pick fields */

/** A field filled by clicking in the view. */
function PickBox({ path, ctx, count, noun, children, onClear }: { path: string; ctx: FormContext; count: number; noun: string; children?: ReactNode; onClear?: (() => void) | undefined }): React.JSX.Element {
  const active = ctx.activePick === path;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={active}
      onClick={() => ctx.onActivatePick(path)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          ctx.onActivatePick(path);
        }
      }}
      className={cn(
        'flex min-h-7 min-w-0 cursor-pointer flex-wrap items-center gap-1 rounded-[var(--cw-r)] border px-1.5 py-0.5 text-[12px] outline-none',
        active ? 'border-[var(--cw-accent-text)] bg-[var(--cw-accent)]/10 shadow-[0_0_0_1px_var(--cw-accent-text)]' : 'border-[var(--cw-line)] bg-[var(--cw-card)] hover:border-[var(--cw-muted)]',
      )}
    >
      <Crosshair size={13} aria-hidden className={active ? 'text-[var(--cw-accent-text)]' : 'text-[var(--cw-muted)]'} />
      {count === 0 ? <span className={active ? 'font-semibold text-[var(--cw-ink)]' : 'text-[var(--cw-muted)]'}>{'Select ' + noun}</span> : (children ?? <span className="font-semibold">{count + ' ' + noun}</span>)}
      {count > 0 && onClear !== undefined && (
        <button
          type="button"
          aria-label="Clear"
          title="Clear"
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
          className="ml-auto flex size-5 items-center justify-center rounded-[var(--cw-r-sm)] text-[var(--cw-muted)] hover:bg-[var(--cw-row)] hover:text-[var(--cw-ink)]"
        >
          <X size={12} aria-hidden />
        </button>
      )}
    </div>
  );
}

/** Faces or edges picked in the view. A reference written as a rule shows read-only. */
export function RefInput({ value, onChange, kind, single, ctx, path }: { value: Json | undefined; onChange: (v: Json | undefined) => void; kind: RefKind; single: boolean; ctx: FormContext; path: string }): React.JSX.Element {
  const keys = refKeys(value, kind);
  const noun = kind === 'faces' ? (single ? 'a face' : 'faces') : 'edges';
  if (keys === null && value !== undefined && value !== null) {
    const expect = typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, Json>)['expect'] : undefined;
    return (
      <div className="flex min-h-7 items-center gap-1.5 rounded-[var(--cw-r)] border border-[var(--cw-line)] bg-[var(--cw-row)] px-1.5 text-[12px]" title={JSON.stringify(value)}>
        <span className="font-semibold">By rule</span>
        {typeof expect === 'number' && <span className="text-[var(--cw-muted)]">{expect + (kind === 'faces' ? ' faces' : ' edges')}</span>}
        <button type="button" onClick={() => onChange(undefined)} className="ml-auto text-[12px] font-semibold text-[var(--cw-ink-2)] hover:text-[var(--cw-ink)]">
          Pick instead
        </button>
      </div>
    );
  }
  const list = keys ?? [];
  const label = (k: string): string => (k.includes('|') ? shortLabel(k.split('|')[0] ?? k) + ' / ' + shortLabel(k.split('|')[1] ?? '') : shortLabel(k));
  return (
    <PickBox path={path} ctx={ctx} count={list.length} noun={single ? noun : list.length === 1 ? noun.replace(/s$/, '') : noun} onClear={() => onChange(undefined)}>
      {single || list.length === 1 ? (
        <span className="min-w-0 truncate font-semibold" title={list.map(keyLabel).join('\n')}>
          {label(list[0] ?? '')}
        </span>
      ) : (
        <span className="font-semibold" title={list.map(keyLabel).join('\n')}>
          {list.length + ' ' + noun}
        </span>
      )}
    </PickBox>
  );
}

/** Profiles of a sketch, picked by clicking regions in the view. */
function ProfilesInput({ value, ctx, sketch, path, onChange }: { value: Json | undefined; ctx: FormContext; sketch: Json | undefined; path: string; onChange: (v: Json | undefined) => void }): React.JSX.Element {
  const s = typeof sketch === 'string' ? ctx.topo?.sketches.find((x) => x.name === sketch) : undefined;
  const used = usedProfiles(s, value);
  return (
    <PickBox path={path} ctx={ctx} count={used.length} noun={used.length === 1 ? 'profile' : 'profiles'} onClear={Array.isArray(value) ? () => onChange(undefined) : undefined}>
      <span className="font-semibold">{used.length + (used.length === 1 ? ' profile' : ' profiles')}</span>
      {typeof sketch === 'string' && <span className="truncate text-[var(--cw-muted)]">in {featureTitle(sketch)}</span>}
    </PickBox>
  );
}

/* ----------------------------------------------------- choices and lists */

function ChipSet({ options, value, onChange, empty, title }: { options: string[]; value: string[]; onChange: (v: string[]) => void; empty: string; title?: (o: string) => string }): React.JSX.Element {
  if (options.length === 0) return <p className="pt-1 text-[12px] text-[var(--cw-muted)]">{empty}</p>;
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button
            key={o}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}
            className={cn('h-6 rounded-[var(--cw-r-sm)] border px-1.5 text-[12px] transition-colors', on ? 'cw-on-ink border-transparent bg-[var(--cw-ink)] text-[var(--cw-shell)]' : 'border-[var(--cw-line)] bg-[var(--cw-card)] text-[var(--cw-ink)] hover:bg-[var(--cw-row)]')}
          >
            {title !== undefined ? title(o) : o}
          </button>
        );
      })}
    </div>
  );
}

function sketchItems(ctx: FormContext, sketch: Json | undefined): { id: string; type: string }[] {
  if (typeof sketch !== 'string') return [];
  const f = ctx.before.find((x) => x.name === sketch && x.kind === 'sketch');
  const items = f?.params['items'];
  if (!Array.isArray(items)) return [];
  return items.filter((i): i is { [k: string]: Json } => i !== null && typeof i === 'object' && !Array.isArray(i)).map((i) => ({ id: String(i['id'] ?? ''), type: String(i['type'] ?? '') }));
}

function AxisInput({ value, onChange, ctx, sketch, directionOnly, label, path }: { value: Json | undefined; onChange: (v: Json | undefined) => void; ctx: FormContext; sketch: Json | undefined; directionOnly: boolean; label: string; path: string }): React.JSX.Element {
  const isObj = value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value);
  const mode = typeof value === 'string' ? 'world' : isObj && 'segment' in (value as object) ? 'segment' : isObj && 'edge' in (value as object) ? 'edge' : Array.isArray(value) || (isObj && 'direction' in (value as object)) ? 'vector' : 'world';
  const worlds = ['X', 'Y', 'Z'];
  const lines = sketchItems(ctx, sketch).filter((i) => i.type === 'line');
  const modes = [{ value: 'world', label: 'Axis' }, ...(!directionOnly && lines.length ? [{ value: 'segment', label: 'Line' }] : []), { value: 'edge', label: 'Edge' }, { value: 'vector', label: 'Vector' }];
  const raw = typeof value === 'string' ? value : 'Z';
  const negative = directionOnly && raw.startsWith('-');
  const worldAxis = raw.replace(/^[+-]/, '');
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1">
        <Segmented
          size="sm"
          label={label + ' from'}
          value={mode}
          options={modes}
          onChange={(m) => {
            if (m === 'world') onChange(directionOnly ? '+Z' : 'Z');
            else if (m === 'segment') onChange({ segment: lines[0]?.id ?? '' });
            else if (m === 'edge') {
              onChange({ edge: { edges: { keys: [] }, expect: 1 } });
              ctx.onActivatePick(path + '.edge');
            } else onChange(directionOnly ? [0, 0, 1] : { origin: [0, 0, 0], direction: [0, 0, 1] });
          }}
        />
        {mode === 'world' && <Segmented size="sm" label={label} value={worldAxis} options={worlds.map((w) => ({ value: w, label: w }))} onChange={(w) => onChange(directionOnly ? (negative ? '-' : '+') + w : w)} />}
        {mode === 'world' && directionOnly && (
          <button
            type="button"
            aria-label="Flip the direction"
            aria-pressed={negative}
            title={negative ? 'Pointing along -' + worldAxis + ' (click to flip)' : 'Pointing along +' + worldAxis + ' (click to flip)'}
            onClick={() => onChange((negative ? '+' : '-') + worldAxis)}
            className={cn('flex size-6 items-center justify-center rounded-[var(--cw-r-sm)] border', negative ? 'cw-on-ink border-transparent bg-[var(--cw-ink)] text-[var(--cw-shell)]' : 'border-[var(--cw-line)] text-[var(--cw-ink-2)] hover:bg-[var(--cw-row)]')}
          >
            <ArrowLeftRight size={13} aria-hidden />
          </button>
        )}
      </div>
      {mode === 'segment' && <Select ariaLabel={label + ' line'} value={isObj ? String((value as Record<string, Json>)['segment'] ?? '') : ''} onChange={(s) => onChange({ segment: s })} options={lines.map((s) => ({ value: s.id, label: s.id }))} />}
      {mode === 'edge' && <RefInput path={path + '.edge'} kind="edges" single={false} ctx={ctx} value={isObj ? ((value as Record<string, Json>)['edge'] ?? undefined) : undefined} onChange={(v) => onChange(v === undefined ? { edge: { edges: { keys: [] }, expect: 1 } } : { edge: v })} />}
      {mode === 'vector' && directionOnly && <VecInput label={label} n={3} env={ctx.env} value={value} onChange={onChange} />}
      {mode === 'vector' && !directionOnly && isObj && (
        <>
          <VecInput label={label + ' through'} n={3} env={ctx.env} value={(value as Record<string, Json>)['origin']} onChange={(o) => onChange({ ...(value as Record<string, Json>), origin: o ?? [0, 0, 0] })} />
          <VecInput label={label + ' direction'} n={3} env={ctx.env} value={(value as Record<string, Json>)['direction']} onChange={(d) => onChange({ ...(value as Record<string, Json>), direction: d ?? [0, 0, 1] })} />
        </>
      )}
    </div>
  );
}

function PlaneInput({ value, onChange, ctx, label, path }: { value: Json | undefined; onChange: (v: Json | undefined) => void; ctx: FormContext; label: string; path: string }): React.JSX.Element {
  const onFace = value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value);
  return (
    <div className="flex flex-col gap-1">
      <Segmented
        size="sm"
        label={label}
        value={onFace ? 'face' : typeof value === 'string' ? value : 'YZ'}
        options={[
          { value: 'XY', label: 'XY' },
          { value: 'XZ', label: 'XZ' },
          { value: 'YZ', label: 'YZ' },
          { value: 'face', label: 'Face' },
        ]}
        onChange={(v) => {
          if (v === 'face') {
            onChange({ face: { faces: { keys: [] }, expect: 1 } });
            ctx.onActivatePick(path + '.face');
          } else onChange(v);
        }}
      />
      {onFace && <RefInput path={path + '.face'} kind="faces" single ctx={ctx} value={(value as Record<string, Json>)['face'] ?? undefined} onChange={(v) => onChange(v === undefined ? { face: { faces: { keys: [] }, expect: 1 } } : { face: v })} />}
    </div>
  );
}

function SourceInput({ value, onChange, ctx, label }: { value: Json | undefined; onChange: (v: Json | undefined) => void; ctx: FormContext; label: string }): React.JSX.Element {
  const obj = value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, Json>) : {};
  const mode = 'bodies' in obj ? 'bodies' : 'features';
  const list = (Array.isArray(obj[mode]) ? (obj[mode] as Json[]) : []).filter((x): x is string => typeof x === 'string');
  const repeatable = ctx.before.filter((f) => ['extrude', 'revolve', 'primitive', 'hole', 'pattern_linear', 'pattern_circular', 'mirror', 'import_step', 'push_pull'].includes(f.kind) && !f.suppressed).map((f) => f.name);
  return (
    <div className="flex flex-col gap-1">
      <Segmented
        size="sm"
        label={label}
        value={mode}
        options={[
          { value: 'features', label: 'Features' },
          { value: 'bodies', label: 'Bodies' },
        ]}
        onChange={(m) => onChange({ [m]: [] })}
      />
      {mode === 'features' ? (
        <ChipSet options={repeatable} value={list} onChange={(v) => onChange({ features: v })} empty="Nothing to repeat yet." title={featureTitle} />
      ) : (
        <ChipSet options={ctx.bodies} value={list} onChange={(v) => onChange({ bodies: v })} empty="No bodies yet." title={featureTitle} />
      )}
    </div>
  );
}

/* ------------------------------------------------------- the dispatcher */

export function isVisible(def: FieldDef, values: Params): boolean {
  if (def.when === undefined) return true;
  for (const [k, allowed] of Object.entries(def.when)) {
    const v = values[k] === undefined ? null : values[k];
    if (!allowed.includes(v as string | boolean | null)) return false;
  }
  return true;
}

/** Values with each select's default filled in, for `when` conditions. */
export function withDefaults(defs: FieldDef[], values: Params): Params {
  const out: Params = { ...values };
  for (const d of defs) if ((d.type === 'select' || d.type === 'bool') && out[d.key] === undefined && d.default !== undefined) out[d.key] = d.default;
  return out;
}

export function FieldInput({ def, value, onChange, ctx, siblings, path }: { def: FieldDef; value: Json | undefined; onChange: (v: Json | undefined) => void; ctx: FormContext; siblings: Params; path: string }): React.JSX.Element {
  const label = def.label ?? def.key;
  switch (def.type) {
    case 'length':
    case 'angle':
    case 'count':
    case 'ratio':
    case 'number':
      return <NumInput label={label} value={value ?? (def.default as Json | undefined)} onChange={onChange} env={ctx.env} unit={UNITS[def.type] ?? ''} step={def.type === 'angle' ? 5 : 1} />;
    case 'select': {
      const opts = def.options ?? [];
      const cur = typeof value === 'string' ? value : typeof def.default === 'string' ? def.default : '';
      if (segmentedSelect(def)) return <Segmented size="sm" label={label} value={cur} options={opts} onChange={(v) => onChange(v)} />;
      return <Select ariaLabel={label} value={cur} onChange={(v) => onChange(v === '' ? undefined : v)} options={def.required === true || def.default !== undefined ? opts : [{ value: '', label: 'None' }, ...opts]} />;
    }
    case 'bool':
      return (
        <div className="flex h-7 items-center">
          <Toggle label={label} checked={value === true || (value === undefined && def.default === true)} onChange={(v) => onChange(v)} />
        </div>
      );
    case 'text':
    case 'ident':
    case 'body':
      if (def.type === 'body' && ctx.bodies.length > 0)
        return <Select ariaLabel={label} value={typeof value === 'string' ? value : ''} onChange={(v) => onChange(v === '' ? undefined : v)} options={[{ value: '', label: def.required === true ? 'Choose a body' : 'Automatic' }, ...ctx.bodies.map((b) => ({ value: b, label: featureTitle(b) }))]} />;
      return <input aria-label={label} value={typeof value === 'string' ? value : ''} placeholder="Automatic" onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)} className={inputCls} spellCheck={false} />;
    case 'sketch': {
      const sketches = ctx.before.filter((f) => f.kind === 'sketch').map((f) => f.name);
      return <Select ariaLabel={label} value={typeof value === 'string' ? value : ''} onChange={(v) => onChange(v === '' ? undefined : v)} options={[{ value: '', label: sketches.length ? 'Choose a sketch' : 'No sketch yet' }, ...sketches.map((s) => ({ value: s, label: featureTitle(s) }))]} />;
    }
    case 'items':
      return <ProfilesInput value={value} ctx={ctx} sketch={siblings['sketch']} path={path} onChange={onChange} />;
    case 'face':
      return <RefInput path={path} kind="faces" single ctx={ctx} value={value} onChange={onChange} />;
    case 'faces':
      return <RefInput path={path} kind="faces" single={false} ctx={ctx} value={value} onChange={onChange} />;
    case 'edges':
      return <RefInput path={path} kind="edges" single={false} ctx={ctx} value={value} onChange={onChange} />;
    case 'bodies': {
      const cur = Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
      return <ChipSet options={ctx.bodies} value={cur} onChange={(v) => onChange(v.length ? v : undefined)} empty="No bodies yet." title={featureTitle} />;
    }
    case 'vec2':
      return <VecInput label={label} n={2} env={ctx.env} value={value ?? (def.default as Json | undefined)} onChange={onChange} />;
    case 'vec3':
      return <VecInput label={label} n={3} env={ctx.env} value={value ?? (def.default as Json | undefined)} onChange={onChange} />;
    case 'points2':
      return <PointsInput label={label} n={2} env={ctx.env} value={value} onChange={onChange} />;
    case 'points3':
      return <PointsInput label={label} n={3} env={ctx.env} value={value} onChange={onChange} />;
    case 'axis':
      return <AxisInput path={path} label={label} value={value} onChange={onChange} ctx={ctx} sketch={siblings['sketch']} directionOnly={false} />;
    case 'direction':
      return <AxisInput path={path} label={label} value={value ?? (def.default as Json | undefined)} onChange={onChange} ctx={ctx} sketch={undefined} directionOnly />;
    case 'plane':
      return <PlaneInput path={path} label={label} value={value} onChange={onChange} ctx={ctx} />;
    case 'source':
      return <SourceInput label={label} value={value} onChange={onChange} ctx={ctx} />;
    case 'asset':
      return <AssetInput label={label} value={value} onChange={onChange} ctx={ctx} />;
    case 'object': {
      const obj = value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value) ? (value as Params) : {};
      const shown = withDefaults(def.fields ?? [], obj);
      return (
        <div className="flex flex-col gap-1.5">
          {(def.fields ?? [])
            .filter((f) => isVisible(f, shown))
            .map((f) => (
              <FieldLabel key={f.key} def={f} inline={inlineField(f)}>
                <FieldInput
                  def={f}
                  ctx={ctx}
                  siblings={shown}
                  path={path + '.' + f.key}
                  value={obj[f.key]}
                  onChange={(v) => {
                    const next: Params = { ...obj };
                    if (v === undefined) delete next[f.key];
                    else next[f.key] = v;
                    onChange(Object.keys(next).length ? next : undefined);
                  }}
                />
              </FieldLabel>
            ))}
        </div>
      );
    }
    default:
      return <p className="pt-1 text-[12px] text-[var(--cw-muted)]">Set by your AI agent.</p>;
  }
}

function AssetInput({ value, onChange, ctx, label }: { value: Json | undefined; onChange: (v: Json | undefined) => void; ctx: FormContext; label: string }): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex items-center gap-1">
      <Select
        className="flex-1"
        ariaLabel={label}
        value={typeof value === 'string' ? value : ''}
        onChange={(v) => onChange(v === '' ? undefined : v)}
        options={[{ value: '', label: ctx.assets.length ? 'Choose a file' : 'No STEP file yet' }, ...ctx.assets.map((a) => ({ value: a.id, label: a.name }))]}
      />
      {ctx.onUploadAsset !== undefined && (
        <label title="Add a STEP file" className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-[var(--cw-r)] border border-[var(--cw-line)] bg-[var(--cw-card)] text-[var(--cw-ink-2)] hover:bg-[var(--cw-row)]">
          {busy ? <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Plus size={14} aria-hidden />}
          <input
            type="file"
            accept=".step,.stp"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f === undefined || ctx.onUploadAsset === undefined) return;
              setBusy(true);
              ctx
                .onUploadAsset(f)
                .then((id) => onChange(id))
                .catch(() => undefined)
                .finally(() => setBusy(false));
            }}
          />
        </label>
      )}
    </div>
  );
}
