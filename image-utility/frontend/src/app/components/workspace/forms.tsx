/**
 * The fields of each tool's dialog. Each form edits the edit's params (the
 * same JSON the AI agent passes); the workspace previews every change.
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeftRight, FlipHorizontal2, FlipVertical2, RotateCcw, RotateCw, ScanSearch, Sparkles } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { api, fileUrl } from '../../lib/api.ts';
import { useApp } from '../../lib/context.tsx';
import { cropBase, dims as dimsOf, largestOfRatio, ratioOf } from '../../lib/geom.ts';
import { dims as fmtDims } from '../../lib/format.ts';
import { useLive } from '../../lib/live.ts';
import type { Dims, Edit, ImageDetail, Json, Params, Region } from '../../lib/types.ts';
import { AddonRow } from '../EngineSetup.tsx';
import { Button, IconButton, Segmented, Select, Spinner, Toggle, errMessage } from '../ui.tsx';
import { Chips, ColorField, Group, Line, NumberField, SliderRow } from './controls.tsx';
import { RATIOS } from './tools.ts';

/* ---------------------------------------------------------------- helpers */

function n(p: Params, k: string, d: number): number {
  const v = p[k];
  return typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d;
}
function s(p: Params, k: string, d: string): string {
  const v = p[k];
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : d;
}
function b(p: Params, k: string): boolean {
  return p[k] === true;
}
/** params with k set (undefined removes it). */
function put(p: Params, k: string, v: Json | undefined): Params {
  const next: Params = { ...p };
  if (v === undefined || v === null) delete next[k];
  else next[k] = v;
  return next;
}

export interface FormProps {
  params: Params;
  set: (p: Params) => void;
  /** The size the edit's input has. */
  dims: Dims;
  image: ImageDetail;
  edit: Edit | null;
}

/* ------------------------------------------------------------------- crop */

/** The box a ratio gives in a frame: the largest that fits, centred. */
export function ratioRect(ratio: number | null, [W, H]: Dims): Region {
  if (ratio === null) return { x: 0, y: 0, w: W, h: H };
  const [w, h] = largestOfRatio(W, H, ratio);
  return { x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), w, h };
}

export function CropForm({ params, set, dims, image, edit }: FormProps): React.JSX.Element {
  // The frame the box sits in: the input after this crop's turns, flips and straightening.
  const base = cropBase(params, dims[0], dims[1]);
  const ratio = s(params, 'ratio', 'free');
  const r = ratioOf(ratio, base[0], base[1]);
  const rect = (params['rect'] as unknown as Region | undefined) ?? ratioRect(r, base);
  const [finding, setFinding] = useState(false);
  const turns = n(params, 'turns', 0);
  const angle = n(params, 'angle', 0);
  const rotating = turns !== 0 || angle !== 0 || b(params, 'flip_h') || b(params, 'flip_v');
  // A new frame (turn, flip, straighten) puts the box back to the ratio in it.
  const reframe = (p: Params): Params => {
    const nb = cropBase(p, dims[0], dims[1]);
    return put(p, 'rect', ratioRect(ratioOf(s(p, 'ratio', 'free'), nb[0], nb[1]), nb) as unknown as Json);
  };
  const setRatio = (v: string): void => {
    const rr = ratioOf(v, base[0], base[1]);
    set(put(put(params, 'ratio', v === 'free' ? undefined : v), 'rect', ratioRect(rr, base) as unknown as Json));
  };
  const swap = (): void => {
    if (!ratio.includes(':')) return;
    const [a, c] = ratio.split(':');
    setRatio(c + ':' + a);
  };
  const smart = async (): Promise<void> => {
    if (r === null) return;
    setFinding(true);
    try {
      const res = await api.analyze(image.id, ['smart'], { ratio: ratio === 'original' ? String(base[0] / base[1]) : ratio, upto: edit?.id });
      if (res.smart !== undefined) set(put(params, 'rect', res.smart as unknown as Json));
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setFinding(false);
    }
  };
  const setBox = (w: number | null, h: number | null): void => {
    let nw = Math.max(1, Math.min(base[0], Math.round(w ?? rect.w)));
    let nh = Math.max(1, Math.min(base[1], Math.round(h ?? rect.h)));
    if (r !== null) {
      if (w !== null) nh = Math.min(base[1], Math.round(nw / r));
      else nw = Math.min(base[0], Math.round(nh * r));
    }
    set(put(params, 'rect', { x: Math.min(rect.x, base[0] - nw), y: Math.min(rect.y, base[1] - nh), w: nw, h: nh }));
  };
  return (
    <div className="flex flex-col gap-2.5">
      <Group title="Aspect ratio" actions={ratio.includes(':') && ratio !== '1:1' ? <IconButton icon={ArrowLeftRight} size={20} label="Swap width and height" onClick={swap} /> : undefined}>
        <Chips label="Aspect ratio" value={ratio} options={RATIOS} onChange={setRatio} />
        {r !== null && !rotating && (
          <Button size="sm" variant="ghost" icon={ScanSearch} loading={finding} onClick={() => void smart()} className="self-start">
            Find the subject
          </Button>
        )}
      </Group>
      <Group title="Box">
        <div className="grid grid-cols-2 gap-1.5">
          <NumberField label="Width" unit="px" value={rect.w} min={1} max={base[0]} onChange={(v) => setBox(v, null)} />
          <NumberField label="Height" unit="px" value={rect.h} min={1} max={base[1]} onChange={(v) => setBox(null, v)} />
        </div>
        <p className="num text-[12px] text-[var(--iu-muted)]">
          In {fmtDims(base[0], base[1])} · at {rect.x}, {rect.y}
        </p>
      </Group>
      <Group title="Straighten and rotate">
        <SliderRow label="Straighten" value={angle} min={-45} max={45} step={0.1} digits={1} unit="°" onChange={(v) => set(reframe(put(params, 'angle', Math.abs(v) < 0.05 ? undefined : Math.round(v * 10) / 10)))} />
        <div className="flex items-center gap-1">
          <IconButton icon={RotateCcw} label="Rotate left" variant="secondary" onClick={() => set(reframe(put(params, 'turns', (turns + 3) % 4 || undefined)))} />
          <IconButton icon={RotateCw} label="Rotate right" variant="secondary" onClick={() => set(reframe(put(params, 'turns', (turns + 1) % 4 || undefined)))} />
          <IconButton icon={FlipHorizontal2} label="Flip horizontally" variant="secondary" active={b(params, 'flip_h')} onClick={() => set(reframe(put(params, 'flip_h', b(params, 'flip_h') ? undefined : true)))} />
          <IconButton icon={FlipVertical2} label="Flip vertically" variant="secondary" active={b(params, 'flip_v')} onClick={() => set(reframe(put(params, 'flip_v', b(params, 'flip_v') ? undefined : true)))} />
          <span className="flex-1" />
          <Button size="sm" variant="ghost" onClick={() => set({})}>
            Reset
          </Button>
        </div>
      </Group>
    </div>
  );
}

/* ----------------------------------------------------------------- resize */

const RESAMPLE_LABEL: Record<string, string> = { lanczos: 'Lanczos (sharp, the default)', sharp: 'Sharper (MKS 2021)', bicubic: 'Bicubic', bilinear: 'Bilinear (soft)', nearest: 'Nearest (pixel art)' };

export function ResizeForm({ params, set, dims }: FormProps): React.JSX.Element {
  const { presets } = useApp();
  const mode = s(params, 'mode', 'longest');
  const [lock, setLock] = useState(!(params['width'] !== undefined && params['height'] !== undefined && mode === 'pixels'));
  const out = dimsOf('resize', params, dims[0], dims[1]);
  const sizes = presets.filter((p) => p.kind === 'size');
  const setMode = (m: string): void => {
    const [w, h] = dims;
    if (m === 'longest') set({ mode: m, longest: n(params, 'longest', Math.min(2048, Math.max(w, h))) });
    else if (m === 'pixels') set({ mode: m, width: out[0] });
    else if (m === 'percent') set({ mode: m, percent: 50 });
    else set({ mode: m, width: out[0], height: out[1], ...(m === 'cover' ? { smart: true } : {}) });
  };
  return (
    <div className="flex flex-col gap-2.5">
      <Segmented
        label="How"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'longest', label: 'Longest' },
          { value: 'pixels', label: 'Size' },
          { value: 'percent', label: '%' },
          { value: 'fit', label: 'Fit' },
          { value: 'cover', label: 'Fill' },
        ]}
      />
      {mode === 'longest' && <NumberField label="Longest edge" unit="px" value={n(params, 'longest', 2048)} min={1} max={30000} onChange={(v) => set(put(params, 'longest', v ?? undefined))} />}
      {mode === 'percent' && <SliderRow label="Scale" value={n(params, 'percent', 50)} min={1} max={400} unit="%" dflt={100} onChange={(v) => set(put(params, 'percent', Math.round(v)))} />}
      {mode === 'pixels' && (
        <div className="flex flex-col gap-1">
          <div className="grid grid-cols-2 gap-1.5">
            <NumberField label="Width" unit="px" value={lock && params['height'] !== undefined && params['width'] === undefined ? out[0] : params['width'] !== undefined ? n(params, 'width', 0) : out[0]} min={1} max={30000} onChange={(v) => set(lock ? { mode, width: v ?? out[0] } : put(params, 'width', v ?? undefined))} />
            <NumberField label="Height" unit="px" value={params['height'] !== undefined ? n(params, 'height', 0) : out[1]} min={1} max={30000} onChange={(v) => set(lock ? { mode, height: v ?? out[1] } : put(put(params, 'width', params['width'] ?? out[0]), 'height', v ?? undefined))} />
          </div>
          <Line label="Keep proportions">
            <Toggle label="Keep proportions" checked={lock} onChange={setLock} />
          </Line>
        </div>
      )}
      {(mode === 'fit' || mode === 'cover') && (
        <div className="flex flex-col gap-1">
          <div className="grid grid-cols-2 gap-1.5">
            <NumberField label="Width" unit="px" value={n(params, 'width', out[0])} min={1} max={30000} onChange={(v) => set(put(params, 'width', v ?? undefined))} />
            <NumberField label="Height" unit="px" value={n(params, 'height', out[1])} min={1} max={30000} onChange={(v) => set(put(params, 'height', v ?? undefined))} />
          </div>
          {mode === 'cover' && (
            <Line label="Keep the subject in frame">
              <Toggle label="Keep the subject in frame" checked={params['smart'] !== false} onChange={(v) => set(put(params, 'smart', v ? true : false))} />
            </Line>
          )}
          {sizes.length > 0 && (
            <Select
              ariaLabel="Size preset"
              value=""
              onChange={(id) => {
                const pr = sizes.find((x) => x.id === id);
                if (pr?.data.width !== undefined && pr.data.height !== undefined) set({ mode: 'cover', width: pr.data.width, height: pr.data.height, smart: true });
              }}
              options={[{ value: '', label: 'Social and web sizes…' }, ...sizes.map((x) => ({ value: x.id, label: x.name + ' · ' + x.description }))]}
            />
          )}
        </div>
      )}
      <p className="num rounded-[var(--iu-r)] bg-[var(--iu-row)] px-2 py-1.5 text-[12px]">
        <span className="font-bold">{fmtDims(out[0], out[1])}</span>
        <span className="text-[var(--iu-muted)]"> from {fmtDims(dims[0], dims[1])}</span>
        {out[0] * out[1] > dims[0] * dims[1] && params['enlarge'] !== true && mode !== 'pixels' && mode !== 'percent' && mode !== 'cover' && <span className="text-[var(--iu-muted)]"> · never enlarged</span>}
      </p>
      <Group title="Quality">
        {(mode === 'longest' || mode === 'fit') && (
          <Line label="Allow enlarging">
            <Toggle label="Allow enlarging" checked={b(params, 'enlarge')} onChange={(v) => set(put(params, 'enlarge', v ? true : undefined))} />
          </Line>
        )}
        <Select ariaLabel="Resampling" value={s(params, 'resample', 'lanczos')} onChange={(v) => set(put(params, 'resample', v === 'lanczos' ? undefined : v))} options={Object.entries(RESAMPLE_LABEL).map(([value, label]) => ({ value, label }))} />
        <Line label="Light sharpen after shrinking">
          <Toggle label="Light sharpen after shrinking" checked={params['sharpen'] !== false} onChange={(v) => set(put(params, 'sharpen', v ? undefined : false))} />
        </Line>
      </Group>
    </div>
  );
}

/* ----------------------------------------------------------------- canvas */

type FillKind = 'color' | 'gradient' | 'blur' | 'transparent';

function fillKind(f: Json | undefined): FillKind {
  if (f === 'transparent') return 'transparent';
  if (f === 'blur') return 'blur';
  if (f !== null && typeof f === 'object' && !Array.isArray(f)) return 'gradient';
  return 'color';
}

const CANVAS_RATIOS = [
  { value: 'none', label: 'None' },
  { value: '1:1', label: '1:1' },
  { value: '4:5', label: '4:5' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
  { value: '3:2', label: '3:2' },
];

export function CanvasForm({ params, set, dims }: FormProps): React.JSX.Element {
  const short = Math.min(dims[0], dims[1]);
  const pad = params['padding'];
  const sides = pad !== null && typeof pad === 'object' && !Array.isArray(pad);
  const fk = fillKind(params['fill']);
  const grad = fk === 'gradient' ? (params['fill'] as { from?: string; to?: string; angle?: number }) : { from: '#ff4f18', to: '#7b2ff7', angle: 135 };
  const out = dimsOf('canvas', params, dims[0], dims[1]);
  return (
    <div className="flex flex-col gap-2.5">
      <Group
        title="Padding"
        actions={
          <span className="flex items-center gap-1.5 text-[12px] text-[var(--iu-ink-2)]">
            Each side <Toggle label="Each side" checked={sides} onChange={(v) => set(put(params, 'padding', v ? { t: n(params, 'padding', 40), r: n(params, 'padding', 40), b: n(params, 'padding', 40), l: n(params, 'padding', 40) } : 40))} />
          </span>
        }
      >
        {sides ? (
          <div className="grid grid-cols-4 gap-1">
            {(['t', 'r', 'b', 'l'] as const).map((k) => (
              <NumberField key={k} label={{ t: 'Top', r: 'Right', b: 'Bottom', l: 'Left' }[k]} value={Number((pad as Record<string, Json>)[k] ?? 0)} min={0} max={5000} onChange={(v) => set(put(params, 'padding', { ...(pad as Record<string, Json>), [k]: v ?? 0 }))} />
            ))}
          </div>
        ) : (
          <SliderRow label="All sides" value={n(params, 'padding', 0)} min={0} max={Math.max(200, Math.round(short * 0.5))} unit="px" onChange={(v) => set(put(params, 'padding', Math.round(v)))} />
        )}
      </Group>
      <Group title="Pad out to a ratio">
        <Chips label="Ratio" value={s(params, 'ratio', 'none')} options={CANVAS_RATIOS} onChange={(v) => set(put(params, 'ratio', v === 'none' ? undefined : v))} />
      </Group>
      <Group title="Background">
        <Segmented
          label="Background"
          value={fk}
          onChange={(v) => set(put(params, 'fill', v === 'color' ? '#ffffff' : v === 'gradient' ? grad : v))}
          options={[
            { value: 'color', label: 'Colour' },
            { value: 'gradient', label: 'Gradient' },
            { value: 'blur', label: 'Blur' },
            { value: 'transparent', label: 'None' },
          ]}
        />
        {fk === 'color' && <ColorField value={s(params, 'fill', '#ffffff')} onChange={(c) => set(put(params, 'fill', c ?? '#ffffff'))} swatches={['#ffffff', '#f2efe9', '#111111', '#1e293b', '#ff4f18', '#7b2ff7', '#1e88e5', '#2fb36d']} />}
        {fk === 'gradient' && (
          <div className="flex flex-col gap-1.5">
            <ColorField label="From" value={grad.from ?? '#ff4f18'} onChange={(c) => set(put(params, 'fill', { ...grad, from: c ?? '#ff4f18' } as unknown as Json))} swatches={['#ff4f18', '#ffd60a', '#2fb36d', '#1e88e5']} />
            <ColorField label="To" value={grad.to ?? '#7b2ff7'} onChange={(c) => set(put(params, 'fill', { ...grad, to: c ?? '#7b2ff7' } as unknown as Json))} swatches={['#7b2ff7', '#e5243b', '#0ea5e9', '#111111']} />
            <SliderRow label="Angle" value={grad.angle ?? 135} min={0} max={360} unit="°" dflt={135} onChange={(v) => set(put(params, 'fill', { ...grad, angle: Math.round(v) } as unknown as Json))} />
          </div>
        )}
        {fk === 'blur' && <p className="text-[12px] leading-4 text-[var(--iu-muted)]">A blurred, enlarged copy of the image fills the space: the usual way to fit a photo into a story or a square without bars.</p>}
      </Group>
      <Group title="Corners and shadow">
        <SliderRow label="Corner radius" value={n(params, 'radius', 0)} min={0} max={Math.max(40, Math.round(short / 4))} unit="px" onChange={(v) => set(put(params, 'radius', Math.round(v) || undefined))} />
        <Line label="Drop shadow">
          <Toggle label="Drop shadow" checked={b(params, 'shadow')} onChange={(v) => set(put(put(params, 'shadow', v ? true : undefined), 'shadow_opacity', undefined))} />
        </Line>
        {b(params, 'shadow') && <SliderRow label="Shadow strength" value={Math.round(n(params, 'shadow_opacity', 0.35) * 100)} min={5} max={100} unit="%" dflt={35} onChange={(v) => set(put(params, 'shadow_opacity', Math.round(v) / 100))} />}
      </Group>
      <p className="num text-[12px] text-[var(--iu-muted)]">Result {fmtDims(out[0], out[1])}</p>
    </div>
  );
}

/* ----------------------------------------------------------------- adjust */

const ADJUST_GROUPS: { title: string; keys: string[] }[] = [
  { title: 'Light', keys: ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'] },
  { title: 'Colour', keys: ['temperature', 'tint', 'vibrance', 'saturation'] },
  { title: 'Detail and effects', keys: ['clarity', 'sharpen', 'vignette'] },
];

export function AdjustForm({ params, set, image, edit }: FormProps): React.JSX.Element {
  const { schema } = useApp();
  const [busy, setBusy] = useState(false);
  const defs = new Map((schema?.adjust ?? []).map((a) => [a.key, a]));
  const any = Object.keys(params).length > 0;
  const auto = async (): Promise<void> => {
    setBusy(true);
    try {
      const a = await api.analyze(image.id, ['auto'], { upto: edit?.id });
      const vals = a.auto ?? {};
      // Auto is kept as a flag (it adapts to the image); the values show what it does.
      set({ ...params, auto: true });
      const parts = Object.entries(vals)
        .filter(([k]) => k !== 'levels')
        .map(([k, v]) => (defs.get(k)?.label ?? k) + ' ' + String(v));
      if (parts.length > 0) toast.info('Auto: ' + parts.join(', '));
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-1.5">
        <Button size="sm" variant={b(params, 'auto') ? 'primary' : 'secondary'} icon={Sparkles} loading={busy} onClick={() => (b(params, 'auto') ? set(put(params, 'auto', undefined)) : void auto())}>
          {b(params, 'auto') ? 'Auto is on' : 'Auto'}
        </Button>
        <span className="text-[12px] leading-4 text-[var(--iu-muted)]">Levels, midtones and white balance from this image.</span>
        <span className="flex-1" />
        {any && (
          <Button size="sm" variant="ghost" onClick={() => set({})}>
            Reset
          </Button>
        )}
      </div>
      {ADJUST_GROUPS.map((g) => (
        <Group key={g.title} title={g.title}>
          {g.keys.map((k) => {
            const d = defs.get(k);
            if (d === undefined) return null;
            return (
              <SliderRow
                key={k}
                label={d.label}
                value={n(params, k, 0)}
                min={d.min}
                max={d.max}
                step={d.step}
                digits={k === 'exposure' ? 2 : 0}
                unit={k === 'exposure' ? 'EV' : ''}
                onChange={(v) => set(put(params, k, Math.abs(v) < (k === 'exposure' ? 0.005 : 0.5) ? undefined : k === 'exposure' ? Math.round(v * 100) / 100 : Math.round(v)))}
              />
            );
          })}
        </Group>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------- filter */

export function FilterForm({ params, set, image, edit }: FormProps): React.JSX.Element {
  const looks = useLive(() => api.filterPreviews(image.id, edit?.id), [], [image.id, edit?.id, image.updated]);
  const name = s(params, 'name', '');
  return (
    <div className="flex flex-col gap-2.5">
      {looks.data === null ? (
        <div className="flex h-24 items-center justify-center text-[var(--iu-muted)]">
          <Spinner size={14} />
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          {looks.data.filters
            .filter((f) => f.name !== 'original')
            .map((f) => (
              <button key={f.name} type="button" onClick={() => set(put(params, 'name', f.name))} className={cn('group flex flex-col gap-0.5 rounded-[var(--iu-r)] p-0.5 text-left', f.name === name ? 'bg-[var(--iu-ink)] text-[var(--iu-shell)]' : 'hover:bg-[var(--iu-row)]')}>
                <span className="iu-checker iu-checker-sm block aspect-square overflow-hidden rounded-[var(--iu-r-sm)]">
                  <img src={fileUrl(f.url)} alt="" className="size-full object-cover" draggable={false} />
                </span>
                <span className="truncate px-0.5 text-[12px] font-semibold">{f.label}</span>
              </button>
            ))}
        </div>
      )}
      <SliderRow label="Strength" value={n(params, 'strength', 100)} min={0} max={100} unit="%" dflt={100} onChange={(v) => set(put(params, 'strength', Math.round(v)))} />
    </div>
  );
}

/* ------------------------------------------------------------- remove bg */

export function RemoveBgForm({ params, set, edit }: FormProps): React.JSX.Element {
  const { status } = useApp();
  const setup = status?.setup ?? null;
  const fastReady = setup?.groups.bg.installed === true;
  const detailedReady = setup?.groups.bg_detailed.installed === true;
  const model = s(params, 'model', 'fast');
  const bg = s(params, 'background', 'transparent');
  return (
    <div className="flex flex-col gap-2.5">
      {setup !== null && !fastReady && (
        <div className="rounded-[var(--iu-r)] border border-[var(--iu-line)] px-2">
          <AddonRow group="bg" setup={setup} title="Background removal" detail="Runs on this computer; nothing is uploaded. A one-off download." />
        </div>
      )}
      <Group title="Model">
        <Segmented
          label="Model"
          value={model}
          onChange={(v) => set(put(params, 'model', v))}
          options={[
            { value: 'fast', label: 'Fast' },
            { value: 'detailed', label: 'Detailed' },
          ]}
        />
        <p className="text-[12px] leading-4 text-[var(--iu-muted)]">{model === 'fast' ? 'Under a second; good for products and portraits on plain backgrounds.' : 'Slower, finer edges (hair, fur, see-through objects).'}</p>
        {model === 'detailed' && setup !== null && !detailedReady && (
          <div className="rounded-[var(--iu-r)] border border-[var(--iu-line)] px-2">
            <AddonRow group="bg_detailed" setup={setup} title="Detailed model" detail="isnet-general-use, 179 MB; the fast model stays." />
          </div>
        )}
      </Group>
      <Group title="Background">
        <Segmented
          label="Background"
          value={bg === 'transparent' ? 'transparent' : 'color'}
          onChange={(v) => set(put(params, 'background', v === 'transparent' ? 'transparent' : '#ffffff'))}
          options={[
            { value: 'transparent', label: 'Transparent' },
            { value: 'color', label: 'Colour' },
          ]}
        />
        {bg !== 'transparent' && <ColorField value={bg} onChange={(c) => set(put(params, 'background', c ?? '#ffffff'))} swatches={['#ffffff', '#f2efe9', '#111111', '#e8f0fe', '#ff4f18']} />}
        {bg === 'transparent' && <p className="text-[12px] leading-4 text-[var(--iu-muted)]">Export as PNG, WebP or AVIF to keep the transparency.</p>}
      </Group>
      <Group title="Edge">
        <Segmented
          label="Edge"
          value={s(params, 'edge', 'soft')}
          onChange={(v) => set(put(params, 'edge', v))}
          options={[
            { value: 'soft', label: 'Soft' },
            { value: 'hard', label: 'Hard' },
          ]}
        />
        <SliderRow label="Grow or shrink the edge" value={n(params, 'refine', 0)} min={-20} max={20} unit="px" onChange={(v) => set(put(params, 'refine', Math.round(v) || undefined))} />
      </Group>
      {edit?.mask_info !== null && edit?.mask_info !== undefined && (
        <p className="num text-[12px] text-[var(--iu-muted)]">
          Keeps {edit.mask_info.kept_pct} % of the image · mask made in {Math.round(edit.mask_info.ms)} ms
        </p>
      )}
    </div>
  );
}

/** True when the remove-background tool can run (its model is installed). */
export function removeBgReady(params: Params, status: ReturnType<typeof useApp>['status']): boolean {
  const g = status?.setup.groups;
  if (g === undefined) return false;
  return s(params, 'model', 'fast') === 'detailed' ? g.bg_detailed.installed : g.bg.installed;
}

export function FormFor(props: FormProps & { kind: string }): ReactNode {
  switch (props.kind) {
    case 'crop':
      return <CropForm {...props} />;
    case 'resize':
      return <ResizeForm {...props} />;
    case 'canvas':
      return <CanvasForm {...props} />;
    case 'adjust':
      return <AdjustForm {...props} />;
    case 'filter':
      return <FilterForm {...props} />;
    default:
      return <RemoveBgForm {...props} />;
  }
}
