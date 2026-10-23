/**
 * The right panel's views: the part (size, mass, build, errors), the
 * selection (what it is, what to do with it, exact measurements), the
 * checks (spec numbers re-run on every build) and the history (batches of
 * changes, revert, compare). Property sections split by hairlines.
 */
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { CircleCheck, CircleHelp, CircleX, Copy, Diff, Plus, RotateCcw, Sparkles, Wrench } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { api } from '../../lib/api.ts';
import { ago, area, length, mass, ms, num, plural, size, volume } from '../../lib/format.ts';
import type { Unit } from '../../lib/format.ts';
import { friendly } from '../../lib/errors.ts';
import { featureTitle, keyLabel } from '../../lib/keys.ts';
import { useLive } from '../../lib/live.ts';
import { rgbCss, useViewportPalette } from '../../lib/themeColors.ts';
import type { Batch, Check, FeatureKind, MeasureResult, PartDetail, Topology } from '../../lib/types.ts';
import { DeleteButton } from '../DeleteButton.tsx';
import { ColorSwatches } from '../NewPart.tsx';
import { Badge, Button, IconButton, PropSection, Select, Spinner, Stat, errMessage, inputCls, textareaCls, useConfirm } from '../ui.tsx';

/* ----------------------------------------------------------------- part */

export function PartPanel({ d, unit, onShowKeys, onAskFix, onEditFeature }: { d: PartDetail; unit: Unit; onShowKeys: (keys: string[]) => void; onAskFix: () => void; onEditFeature?: (name: string) => void }): React.JSX.Element {
  const s = d.build?.summary ?? null;
  const b = d.build;
  const err = b?.error ?? null;
  const failedKind = err?.feature !== undefined ? (d.features.find((f) => f.name === err.feature)?.kind ?? null) : null;
  const fr = err !== null ? friendly(err, failedKind) : null;
  const save = (p: Parameters<typeof api.updatePart>[1]): void => {
    api.updatePart(d.part.id, p).catch((e: unknown) => toast.error(errMessage(e)));
  };
  return (
    <div className="flex flex-col">
      {err !== null && fr !== null && (
        <section className="m-3 mb-1 flex flex-col gap-1 rounded-[var(--cw-r)] border border-[var(--cw-red)]/40 bg-[var(--cw-red)]/8 p-2.5">
          <p className="flex items-center gap-1.5 text-[12px] font-bold text-[var(--cw-red-text)]">
            <CircleX size={14} aria-hidden /> {err.feature !== undefined ? featureTitle(err.feature) + ': ' + fr.title.toLowerCase() : fr.title}
          </p>
          <p className="text-[12px] leading-4">{err.message}</p>
          {fr.tip !== null && <p className="text-[12px] leading-4 text-[var(--cw-ink-2)]">{fr.tip}</p>}
          <div className="flex flex-wrap gap-1.5 pt-1">
            {err.feature !== undefined && onEditFeature !== undefined && (
              <Button size="sm" onClick={() => onEditFeature(err.feature ?? '')}>
                Edit {featureTitle(err.feature)}
              </Button>
            )}
            {err.candidates !== undefined && err.candidates.length > 0 && (
              <Button size="sm" onClick={() => onShowKeys(err.candidates ?? [])}>
                Show candidates
              </Button>
            )}
            <Button size="sm" icon={Wrench} onClick={onAskFix}>
              Ask to fix
            </Button>
          </div>
        </section>
      )}
      <PropSection title="Size">
        {s !== null && s.bbox !== null ? (
          <>
            <p className="num pb-1 text-[13px] font-bold">{size(s.bbox.size, unit)}</p>
            <Stat label="Volume" value={volume(s.volume_mm3, unit)} />
            <Stat label="Surface" value={area(s.area_mm2, unit)} />
            <Stat label={'Mass' + (d.part.material !== '' ? ' (' + d.part.material + ')' : '')} value={s.mass_g !== undefined ? mass(s.mass_g) : 'no material'} />
            <Stat label="Bodies" value={s.bodies.length + (s.solids > s.bodies.length ? ' (' + s.solids + ' pieces)' : '')} />
            <Stat label="Faces, edges" value={s.faces + ', ' + s.edges} />
            <Stat label="Valid solid" value={s.valid ? 'Yes' : 'No'} />
          </>
        ) : (
          <p className="text-[12px] text-[var(--cw-muted)]">No solid yet.</p>
        )}
      </PropSection>
      <PropSection title="Part">
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[12px] text-[var(--cw-muted)]">Description</span>
            <textarea
              defaultValue={d.part.description}
              key={d.part.id + d.part.description}
              onBlur={(e) => e.target.value !== d.part.description && save({ description: e.target.value })}
              rows={2}
              className={cn(textareaCls, 'editable text-[12px]')}
            />
          </label>
          <MaterialSelect d={d} onChange={(m) => save({ material: m })} />
          <div className="flex flex-col gap-1">
            <span className="text-[12px] text-[var(--cw-muted)]">Color</span>
            <ColorSwatches value={d.part.color} onChange={(c) => save({ color: c })} />
          </div>
        </div>
      </PropSection>
      {b !== null && (
        <PropSection title="Last build" className="border-b-0">
          <Stat label="Took" value={ms(b.ms)} />
          <Stat label="Reused features" value={b.cached_features} />
          <Stat label="Triangles drawn" value={num(b.triangles, 0)} />
          <Stat label="Built" value={ago(b.finished || b.created)} />
          <Stat label="By" value={b.requested_by === 'agent' ? 'your AI agent' : b.requested_by === 'system' ? 'the app' : 'you'} />
        </PropSection>
      )}
    </div>
  );
}

function MaterialSelect({ d, onChange }: { d: PartDetail; onChange: (m: string) => void }): React.JSX.Element {
  const live = useLive(() => api.settings(), ['settings'], []);
  const mats = live.data?.materials ?? [];
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] text-[var(--cw-muted)]">Material</span>
      <Select ariaLabel="Material" value={d.part.material} onChange={onChange} options={[{ value: '', label: 'None (no mass)' }, ...mats.map((m) => ({ value: m.name, label: m.name + ' (' + m.density + ' g/cm³)' }))]} />
    </label>
  );
}

/* ------------------------------------------------------------ selection */

const QUICK: { kind: FeatureKind; label: string; when: 'edges' | 'face' | 'faces' }[] = [
  { kind: 'fillet', label: 'Fillet', when: 'edges' },
  { kind: 'chamfer', label: 'Chamfer', when: 'edges' },
  { kind: 'push_pull', label: 'Push/pull', when: 'face' },
  { kind: 'sketch', label: 'Sketch', when: 'face' },
  { kind: 'hole', label: 'Hole', when: 'face' },
  { kind: 'shell', label: 'Shell', when: 'faces' },
];

export function SelectionPanel({
  d,
  topo,
  selection,
  unit,
  onClear,
  onQuick,
  onMeasure,
}: {
  d: PartDetail;
  topo: Topology | null;
  selection: string[];
  unit: Unit;
  onClear: () => void;
  onQuick: (kind: FeatureKind) => void;
  onMeasure: (m: MeasureResult | null) => void;
}): React.JSX.Element {
  const [m, setM] = useState<MeasureResult | null>(null);
  const [busy, setBusy] = useState(false);
  const faces = topo === null ? [] : selection.map((k) => topo.faces.find((f) => f.key === k)).filter((x) => x !== undefined);
  const edges = topo === null ? [] : selection.map((k) => topo.edges.find((e) => e.key === k)).filter((x) => x !== undefined);
  const key = selection.join(',');
  useEffect(() => {
    if (selection.length === 0 || selection.length > 2) {
      setM(null);
      onMeasure(null);
      return;
    }
    let alive = true;
    setBusy(true);
    api
      .measure(d.part.id, selection[0] as string, selection[1])
      .then((r) => {
        if (!alive) return;
        setM(r);
        onMeasure(r);
      })
      .catch(() => {
        if (alive) setM(null);
      })
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, d.build?.id]);

  const planarFaces = faces.filter((f) => f.type === 'plane');
  const quick = QUICK.filter((q) => (q.when === 'edges' ? edges.length > 0 && faces.length === 0 : q.when === 'face' ? planarFaces.length === 1 && selection.length === 1 : faces.length > 0 && edges.length === 0));
  return (
    <div className="flex flex-col">
      <PropSection
        title={selection.length === 1 ? '1 selected' : selection.length + ' selected'}
        actions={
          <Button size="sm" variant="ghost" onClick={onClear}>
            Clear
          </Button>
        }
      >
        <ul className="flex flex-col">
          {selection.slice(0, 12).map((k) => (
            <li key={k} className="group flex h-6 items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-[12px] font-medium" title={keyLabel(k)}>
                {keyLabel(k)}
              </p>
              <span className="opacity-0 transition-opacity group-hover:opacity-100">
                <IconButton
                  icon={Copy}
                  size={20}
                  label="Copy its name for your AI agent"
                  onClick={() => {
                    void navigator.clipboard.writeText(k).then(() => toast.success('Copied'));
                  }}
                />
              </span>
            </li>
          ))}
          {selection.length > 12 && <li className="pt-1 text-[12px] text-[var(--cw-muted)]">and {selection.length - 12} more</li>}
        </ul>
        {quick.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {quick.map((q) => (
              <Button key={q.kind} size="sm" onClick={() => onQuick(q.kind)}>
                {q.label}
              </Button>
            ))}
          </div>
        )}
      </PropSection>
      {(m !== null || busy) && (
        <PropSection title="Measure" className="border-b-0" actions={busy ? <Spinner size={12} className="text-[var(--cw-muted)]" /> : m !== null ? <KeepCheck part={d.part.id} m={m} selection={selection} /> : undefined}>
          {m !== null && <MeasureView m={m} unit={unit} />}
        </PropSection>
      )}
    </div>
  );
}

/** The check a measurement becomes when kept: its kind and value. */
function checkFrom(m: MeasureResult): { kind: string; value: number; name: string; two: boolean } | null {
  if (m.b !== undefined && m.center_distance_mm !== undefined) return { kind: 'center_distance', value: m.center_distance_mm, name: 'Center distance', two: true };
  if (m.b !== undefined && m.distance !== undefined) return { kind: 'distance', value: m.distance.min_mm, name: 'Gap', two: true };
  if (m.b === undefined && m.a.radius !== undefined) return { kind: 'radius', value: m.a.radius, name: 'Radius', two: false };
  return null;
}

function KeepCheck({ part, m, selection }: { part: string; m: MeasureResult; selection: string[] }): React.JSX.Element | null {
  const [busy, setBusy] = useState(false);
  const c = checkFrom(m);
  if (c === null) return null;
  const keep = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.saveCheck(part, { name: c.name + ' ' + num(c.value, 2), kind: c.kind, op: 'eq', target: Math.round(c.value * 1000) / 1000, tolerance: 0.01, refs: c.two ? { a: selection[0] as string, b: selection[1] as string } : { a: selection[0] as string } });
      toast.success('Kept as a check');
    } catch {
      /* the toast says why */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button size="sm" variant="ghost" icon={CircleCheck} loading={busy} onClick={() => void keep()}>
      Keep as check
    </Button>
  );
}

function MeasureView({ m, unit }: { m: MeasureResult; unit: Unit }): React.JSX.Element {
  const pal = useViewportPalette();
  const one = (e: MeasureResult['a'], label: string): ReactNode => (
    <div className="flex flex-col">
      {label !== '' && <p className="pt-1.5 text-[12px] font-bold text-[var(--cw-ink-2)]">{label}</p>}
      {e.type !== undefined && <Stat label="Type" value={e.type} />}
      {e.area !== undefined && <Stat label="Area" value={area(e.area, unit)} />}
      {e.length !== undefined && <Stat label="Length" value={length(e.length, unit)} />}
      {e.radius !== undefined && <Stat label="Diameter" value={length(e.radius * 2, unit)} />}
      {e.volume_mm3 !== undefined && <Stat label="Volume" value={volume(e.volume_mm3, unit)} />}
    </div>
  );
  return (
    <div className="flex flex-col">
      {m.distance !== undefined && (
        <div className="mb-1 rounded-[var(--cw-r)] bg-[var(--cw-row)] px-2 py-1.5">
          <p className="num text-[15px] font-bold leading-[22px]">{length(m.axis_distance_mm ?? m.parallel_gap_mm ?? m.distance.min_mm, unit)}</p>
          <p className="text-[12px] leading-4 text-[var(--cw-muted)]">{m.axis_distance_mm !== undefined ? 'between the axes' : m.parallel_gap_mm !== undefined ? 'between the parallel faces' : 'closest distance'}</p>
          <p className="num mt-1 flex flex-wrap gap-3 text-[12px] text-[var(--cw-ink-2)]">
            {(
              [
                ['x', m.distance.dx, rgbCss(pal.axisX)],
                ['y', m.distance.dy, rgbCss(pal.axisY)],
                ['z', m.distance.dz, rgbCss(pal.axisZ)],
              ] as [string, number, string][]
            ).map(([a, v, c]) => (
              <span key={a} className="inline-flex items-center gap-1">
                <span aria-hidden className="inline-block size-1.5 rounded-full" style={{ background: c }} />
                {a} {num(v, 3)}
              </span>
            ))}
          </p>
        </div>
      )}
      {m.distance !== undefined && m.axis_distance_mm !== undefined && <Stat label="Closest gap" value={length(m.distance.min_mm, unit)} />}
      {m.angle_deg !== undefined && <Stat label="Angle" value={num(m.angle_deg, 3) + '°'} />}
      {m.center_distance_mm !== undefined && <Stat label="Center to center" value={length(m.center_distance_mm, unit)} />}
      {one(m.a, m.b !== undefined ? 'First' : '')}
      {m.b !== undefined && one(m.b, 'Second')}
    </div>
  );
}

/* --------------------------------------------------------------- checks */

const CHECK_KINDS: { value: string; label: string; refs: 0 | 1 | 2; box?: boolean; noTarget?: boolean }[] = [
  { value: 'fits_within', label: 'Fits within a box', refs: 0, box: true },
  { value: 'bbox_x', label: 'Size along X', refs: 0 },
  { value: 'bbox_y', label: 'Size along Y', refs: 0 },
  { value: 'bbox_z', label: 'Size along Z (height)', refs: 0 },
  { value: 'center_distance', label: 'Distance between hole axes or centers', refs: 2 },
  { value: 'distance', label: 'Closest gap between two things', refs: 2 },
  { value: 'radius', label: 'Radius of a face or edge', refs: 1 },
  { value: 'volume', label: 'Volume (mm³)', refs: 0 },
  { value: 'mass', label: 'Mass (g)', refs: 0 },
  { value: 'solid_count', label: 'Number of pieces', refs: 0 },
  { value: 'valid', label: 'A valid solid', refs: 0, noTarget: true },
];

const OPS = [
  { value: 'le', label: 'at most' },
  { value: 'ge', label: 'at least' },
  { value: 'eq', label: 'equal to' },
  { value: 'between', label: 'between' },
];

function CheckRow({ c, unit }: { c: Check; unit: Unit }): React.JSX.Element {
  const icon =
    c.result === 'pass' ? (
      <CircleCheck size={14} className="text-[var(--cw-green-text)]" aria-label="Passes" />
    ) : c.result === 'fail' ? (
      <CircleX size={14} className="text-[var(--cw-red-text)]" aria-label="Fails" />
    ) : c.result === 'cannot_run' ? (
      <CircleHelp size={14} className="text-[var(--cw-amber-text)]" aria-label="Could not run" />
    ) : (
      <Spinner size={12} className="text-[var(--cw-muted)]" />
    );
  const opLabel = OPS.find((o) => o.value === c.op)?.label ?? c.op;
  const target = c.kind === 'fits_within' ? (c.box !== null ? size(c.box, unit) : '') : c.kind === 'valid' ? '' : opLabel + ' ' + num(c.target, 3) + (c.op === 'between' ? ' and ' + num(c.target_max, 3) : '') + (c.tolerance > 0 ? ' ± ' + num(c.tolerance, 3) : '');
  return (
    <div className={cn('flex items-start gap-2 border-b border-[var(--cw-hair)] py-1.5 last:border-b-0', (c.result === 'fail' || c.result === 'cannot_run') && 'bg-[var(--cw-red)]/6')}>
      <span className="mt-px shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-[12px] font-semibold leading-4">
          {c.name}
          {c.author === 'agent' && <Sparkles size={11} aria-label="Made by your AI agent" className="text-[var(--cw-accent-text)]" />}
        </p>
        <p className="num text-[12px] leading-4 text-[var(--cw-ink-2)]">
          {target}
          {c.value !== null && typeof c.value === 'number' ? ' (now ' + num(c.value, 3) + ')' : ''}
        </p>
        {c.detail !== '' && (
          <p className="text-[12px] leading-4 text-[var(--cw-muted)]">
            {c.result === 'cannot_run' ? 'Could not run: ' : ''}
            {c.detail}
          </p>
        )}
      </div>
      <DeleteButton collection="checks" id={c.id} name={c.name} size={20} />
    </div>
  );
}

export function ChecksPanel({ d, unit, selection }: { d: PartDetail; unit: Unit; selection: string[] }): React.JSX.Element {
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState('fits_within');
  const [name, setName] = useState('');
  const [op, setOp] = useState('le');
  const [target, setTarget] = useState('');
  const [targetMax, setTargetMax] = useState('');
  const [tol, setTol] = useState('');
  const [box, setBox] = useState(['', '', '']);
  const [busy, setBusy] = useState(false);
  const def = CHECK_KINDS.find((k) => k.value === kind) ?? (CHECK_KINDS[0] as (typeof CHECK_KINDS)[number]);
  const refsOk = def.refs === 0 || selection.length === def.refs;
  const passing = d.checks.filter((c) => c.result === 'pass').length;

  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      const refs = def.refs === 0 ? undefined : def.refs === 1 ? { a: selection[0] as string } : { a: selection[0] as string, b: selection[1] as string };
      await api.saveCheck(d.part.id, {
        name: name.trim() || def.label,
        kind,
        op: def.box === true || def.noTarget === true ? undefined : op,
        target: def.box === true || def.noTarget === true ? undefined : Number(target),
        target_max: op === 'between' ? Number(targetMax) : undefined,
        tolerance: tol.trim() === '' ? undefined : Number(tol),
        refs,
        box: def.box === true ? box.map(Number) : undefined,
      });
      setAdding(false);
      setName('');
      setTarget('');
      setTargetMax('');
      setTol('');
    } catch {
      /* the toast says why */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col">
      <PropSection
        title={d.checks.length ? passing + ' of ' + d.checks.length + ' pass' : 'Checks'}
        actions={
          !adding && (
            <Button size="sm" variant="primary" icon={Plus} onClick={() => setAdding(true)}>
              Add
            </Button>
          )
        }
      >
        {d.checks.length === 0 && !adding && <p className="text-[12px] leading-4 text-[var(--cw-muted)]">None yet. Measure two things and keep it, or add one.</p>}
        <div className="flex flex-col">
          {d.checks.map((c) => (
            <CheckRow key={c.id} c={c} unit={unit} />
          ))}
        </div>
      </PropSection>
      {adding && (
        <PropSection title="New check" className="border-b-0">
          <div className="flex flex-col gap-1.5">
            <Select ariaLabel="Check kind" value={kind} onChange={setKind} options={CHECK_KINDS.map((k) => ({ value: k.value, label: k.label }))} />
            <input aria-label="Check name" placeholder={def.label} value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
            {def.box === true && (
              <div className="grid grid-cols-3 gap-1.5">
                {['x', 'y', 'z'].map((a, i) => (
                  <input key={a} aria-label={'Box ' + a} placeholder={a.toUpperCase() + ' mm'} value={box[i]} onChange={(e) => setBox(box.map((v, j) => (j === i ? e.target.value : v)))} className={cn(inputCls, 'num')} />
                ))}
              </div>
            )}
            {def.box !== true && def.noTarget !== true && (
              <div className="flex items-center gap-1.5">
                <Select ariaLabel="Comparison" value={op} onChange={setOp} options={OPS} className="w-28 flex-none" />
                <input aria-label="Target" placeholder="value" value={target} onChange={(e) => setTarget(e.target.value)} className={cn(inputCls, 'num')} />
                {op === 'between' && <input aria-label="Upper value" placeholder="and" value={targetMax} onChange={(e) => setTargetMax(e.target.value)} className={cn(inputCls, 'num')} />}
                {op === 'eq' && <input aria-label="Tolerance" placeholder={'±'} value={tol} onChange={(e) => setTol(e.target.value)} className={cn(inputCls, 'num w-16 flex-none')} />}
              </div>
            )}
            {def.refs > 0 && (
              <p className={cn('text-[12px] leading-4', refsOk ? 'text-[var(--cw-ink-2)]' : 'text-[var(--cw-amber-text)]')}>
                {refsOk ? 'Measures ' + selection.map(keyLabel).join(' and ') + '.' : 'Select ' + (def.refs === 1 ? 'one face or edge' : 'two faces or edges') + ' in the view first.'}
              </p>
            )}
            <div className="flex justify-end gap-1.5 pt-0.5">
              <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" loading={busy} disabled={!refsOk} onClick={() => void save()}>
                Save check
              </Button>
            </div>
          </div>
        </PropSection>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- history */

const ACTIONS: Record<string, string> = {
  add_feature: 'Added',
  update_feature: 'Changed',
  move_feature: 'Moved',
  delete_feature: 'Deleted',
  set_parameter: 'Set',
  delete_parameter: 'Removed parameter',
  roll_to: 'Rolled to',
};

export function actorLabel(a: string): string {
  return a === 'agent' ? 'Your AI agent' : a === 'system' ? 'The app' : 'You';
}

/** One batch of changes as a dense row: who, when, what, and revert or compare. */
export function BatchCard({ b, onCompare, showPart = false, actions }: { b: Batch; onCompare?: (batch: string) => void; showPart?: boolean; actions?: ReactNode }): React.JSX.Element {
  const [confirmEl, confirm] = useConfirm();
  const [busy, setBusy] = useState(false);
  const revert = async (): Promise<void> => {
    setBusy(true);
    try {
      const pv = await api.revert(b.batch, true);
      let force = false;
      if (pv.needs_force === true) {
        const ok = await confirm('Later changes touched the same features: ' + (pv.conflicts ?? []).map((c) => c.targets.join(', ')).join('; ') + '. Revert anyway?', 'Revert over later changes?', 'Revert anyway');
        if (!ok) return;
        force = true;
      }
      const r = await api.revert(b.batch, false, force);
      if (r.status === 'reverted' || r.status === 'failed') toast.error('Reverted, but the part does not build');
      else toast.success('Reverted ' + plural(b.count, 'change'));
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-1 border-b border-[var(--cw-hair)] px-3 py-2 last:border-b-0">
      {confirmEl}
      <div className="flex items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 text-[12px]">
          {b.actor === 'agent' && <Sparkles size={12} aria-hidden className="shrink-0 text-[var(--cw-accent-text)]" />}
          <span className="shrink-0 font-bold">{actorLabel(b.actor)}</span>
          {showPart && <span className="truncate font-semibold text-[var(--cw-ink-2)]">{b.part.name}</span>}
          <span className="num shrink-0 text-[var(--cw-muted)]">
            {ago(b.created)} · {plural(b.count, 'change')}
          </span>
        </p>
        {b.reverted_by !== '' ? <Badge tone="neutral">Reverted</Badge> : b.kind === 'undo' ? <Badge tone="neutral">Undo</Badge> : b.kind === 'redo' ? <Badge tone="neutral">Redo</Badge> : null}
      </div>
      {b.note !== '' && <p className="text-[12px] font-medium leading-4 text-[var(--cw-ink)]">{b.note}</p>}
      <ul className="flex flex-wrap gap-x-3 gap-y-0.5">
        {b.changes.slice(0, 8).map((c) => (
          <li key={c.id} className="max-w-full truncate text-[12px] leading-4 text-[var(--cw-ink-2)]">
            {ACTIONS[c.action] ?? c.action} <span className="font-semibold text-[var(--cw-ink)]">{c.action.endsWith('parameter') ? c.target : featureTitle(c.target)}</span>
            {c.action === 'set_parameter' && c.after !== null && typeof c.after === 'object' && !Array.isArray(c.after) ? ' = ' + String((c.after as Record<string, unknown>)['expr'] ?? '') : ''}
          </li>
        ))}
        {b.changes.length > 8 && <li className="text-[12px] leading-4 text-[var(--cw-muted)]">and {b.changes.length - 8} more</li>}
      </ul>
      <div className="mt-0.5 flex flex-wrap items-center gap-1">
        {b.reverted_by === '' && (
          <Button size="sm" icon={RotateCcw} loading={busy} onClick={() => void revert()}>
            Revert
          </Button>
        )}
        {onCompare !== undefined && (
          <Button size="sm" icon={Diff} onClick={() => onCompare(b.batch)}>
            Show what changed
          </Button>
        )}
        {actions !== undefined && <div className="ml-auto flex items-center gap-1">{actions}</div>}
      </div>
    </div>
  );
}

export function HistoryPanel({ partId, onCompare }: { partId: string; onCompare: (batch: string) => void }): React.JSX.Element {
  const hist = useLive(() => api.changes({ part: partId, limit: 40 }), ['changes'], [partId]);
  const batches = hist.data?.batches ?? [];
  return (
    <div className="flex flex-col">
      {hist.loading && hist.data === null && (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      )}
      {batches.length === 0 && !hist.loading && <p className="px-3 py-3 text-[12px] leading-4 text-[var(--cw-muted)]">No changes yet</p>}
      {batches.map((b) => (
        <BatchCard key={b.batch} b={b} onCompare={onCompare} />
      ))}
    </div>
  );
}
