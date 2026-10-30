/**
 * The selected layer's properties, floating over the top left of the image
 * like a tool: what it says or shows, its colours and strokes, opacity,
 * rotation, what it is pinned to, its place in the stack, lock, duplicate
 * and delete. Sizes are in result pixels. Every change is saved as made;
 * undo and redo sit in the bar.
 */
import { useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpToLine, ChevronDown, ChevronUp, Copy, ImageUp, Lock, Redo2, Trash2, Undo2, Unlock, X } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { api, fileUrl } from '../../lib/api.ts';
import { layerTitle, place, repin, unplace } from '../../lib/layers.ts';
import type { Frame } from '../../lib/layers.ts';
import { useLive } from '../../lib/live.ts';
import type { Json, LayerType, Params } from '../../lib/types.ts';
import { Segmented, Select, Spinner, Toggle, errMessage, textareaCls } from '../ui.tsx';
import { ColorField, Group, Line, NumberField, SliderRow } from './controls.tsx';
import { LAYER_ICON } from './LayersList.tsx';
import type { LayerView } from './LayersOverlay.tsx';
import { FONT_LABEL, MARK_COLORS } from './tools.ts';

function num(p: Params, k: string, d: number): number {
  const v = p[k];
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
}

function put(p: Params, k: string, v: Json | undefined): Params {
  const next: Params = { ...p };
  if (v === undefined || v === null) delete next[k];
  else next[k] = v;
  return next;
}

function BarButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }): React.JSX.Element {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className="flex size-6 items-center justify-center rounded-[var(--iu-r-sm)] text-[var(--iu-ink-2)] hover:bg-[var(--iu-row)] hover:text-[var(--iu-ink)] disabled:opacity-35 disabled:hover:bg-transparent">
      {children}
    </button>
  );
}

export function LogoPicker({ value, onPick }: { value: string; onPick: (id: string, w: number, h: number) => void }): React.JSX.Element {
  const assets = useLive(() => api.assets(), ['assets'], []);
  const file = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const upload = async (f: File): Promise<void> => {
    setBusy(true);
    try {
      const r = await api.addAsset(f);
      onPick(r.asset.id, r.asset.width, r.asset.height);
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid grid-cols-4 gap-1">
      {(assets.data?.assets ?? []).map((a) => (
        <button key={a.id} type="button" title={a.name} onClick={() => onPick(a.id, a.width, a.height)} className={cn('iu-checker iu-checker-sm flex aspect-square items-center justify-center overflow-hidden rounded-[var(--iu-r-sm)] border-2', value === a.id ? 'border-[var(--iu-ink)]' : 'border-transparent')}>
          <img src={fileUrl(a.url)} alt={a.name} className="max-h-full max-w-full object-contain p-1" draggable={false} />
        </button>
      ))}
      <button type="button" onClick={() => file.current?.click()} title="Add a logo" className="flex aspect-square items-center justify-center rounded-[var(--iu-r-sm)] border-2 border-dashed border-[var(--iu-line)] text-[var(--iu-ink-2)] hover:border-[var(--iu-muted)]">
        {busy ? <Spinner size={12} /> : <ImageUp size={15} aria-hidden />}
      </button>
      <input
        ref={file}
        type="file"
        accept=".png,.webp,.jpg,.jpeg,.gif,.avif"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f !== undefined) void upload(f);
        }}
      />
    </div>
  );
}

export function LayerDialog({
  layer,
  fr,
  busy,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onChange,
  onVisible,
  onLock,
  onArrange,
  onDuplicate,
  onRemove,
  onClose,
}: {
  layer: LayerView;
  fr: Frame;
  busy: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onChange: (p: Params, now?: boolean) => void;
  onVisible: (on: boolean) => void;
  onLock: (on: boolean) => void;
  onArrange: (to: 'front' | 'back' | 'forward' | 'backward') => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const p = layer.params;
  const type = String(p['type'] ?? 'rect') as LayerType;
  const Icon = LAYER_ICON[type];
  const g = place(p, fr);
  const unit = g.unit;
  const set = (next: Params, now = false): void => onChange(next, now);
  const setG = (patch: Parameters<typeof unplace>[1]): void => set(unplace(p, { cx: g.cx, cy: g.cy, angle: g.angle, w: g.w, h: g.h, size: g.size, ...patch }, fr));
  const strokePx = Math.round(num(p, 'width', 6) * unit * 10) / 10;
  const setStroke = (px: number): void => set(put(p, 'width', Math.round((px / unit) * 10000) / 10000));
  const tiles = type === 'text' || type === 'logo';
  const turns = type !== 'step' && type !== 'arrow' && type !== 'line';

  return (
    <section aria-label={'Layer: ' + layerTitle(p)} className="iu-pop pointer-events-auto flex max-h-full w-[min(300px,calc(100vw-24px))] flex-col overflow-hidden rounded-[var(--iu-r-md)] border border-[var(--iu-line)] bg-[var(--iu-card)] shadow-[var(--iu-shadow)]">
      <header className="flex h-8 shrink-0 items-center gap-1 border-b border-[var(--iu-hair)] pl-2 pr-1">
        <Icon size={14} aria-hidden className="text-[var(--iu-ink-2)]" />
        <h2 className="min-w-0 flex-1 truncate pl-0.5 text-[13px] font-bold">{layerTitle(p)}</h2>
        {busy && <Spinner size={12} className="mr-0.5 text-[var(--iu-muted)]" />}
        <BarButton label="Undo (Ctrl+Z)" disabled={!canUndo} onClick={onUndo}>
          <Undo2 size={14} aria-hidden />
        </BarButton>
        <BarButton label="Redo (Ctrl+Y)" disabled={!canRedo} onClick={onRedo}>
          <Redo2 size={14} aria-hidden />
        </BarButton>
        <span aria-hidden className="mx-0.5 h-4 w-px bg-[var(--iu-line)]" />
        <BarButton label="Done (Esc)" onClick={onClose}>
          <X size={14} aria-hidden />
        </BarButton>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2.5">
        <div className="flex flex-col gap-2.5">
          {type === 'text' && (
            <Group title="Text">
              <textarea aria-label="Text" rows={2} value={String(p['text'] ?? '')} onChange={(e) => set(put(p, 'text', e.target.value === '' ? ' ' : e.target.value))} onKeyDown={(e) => e.stopPropagation()} className={textareaCls} />
              <div className="grid grid-cols-[1fr_88px] gap-1.5">
                <Select ariaLabel="Font" value={String(p['font'] ?? 'sans-bold')} onChange={(f) => set(put(p, 'font', f))} options={Object.entries(FONT_LABEL).map(([value, label]) => ({ value, label }))} />
                <NumberField label="" unit="px" value={Math.round(g.size)} min={4} max={4000} onChange={(v) => v !== null && setG({ size: v })} />
              </div>
              <Segmented
                label="Align"
                size="sm"
                value={String(p['align'] ?? 'left')}
                onChange={(a) => set(put(p, 'align', a === 'left' ? undefined : a))}
                options={[
                  { value: 'left', label: 'Left' },
                  { value: 'center', label: 'Centre' },
                  { value: 'right', label: 'Right' },
                ]}
              />
              <ColorField value={String(p['color'] ?? '#ff4f18')} onChange={(c) => set(put(p, 'color', c ?? '#ff4f18'))} swatches={MARK_COLORS} />
              <Line label="Label box behind">
                <Toggle label="Label box behind" checked={p['bg'] !== undefined} onChange={(v) => set(put(p, 'bg', v ? '#111111' : undefined))} />
              </Line>
              {p['bg'] !== undefined && <ColorField value={String(p['bg'])} onChange={(c) => set(put(p, 'bg', c ?? '#111111'))} swatches={['#111111', '#ffffff', '#ff4f18', '#1e88e5', '#ffd60a']} />}
              <Line label="Outline">
                <Toggle label="Outline" checked={p['outline'] !== undefined} onChange={(v) => set(put(p, 'outline', v ? '#000000' : undefined))} />
              </Line>
            </Group>
          )}
          {(type === 'rect' || type === 'ellipse') && (
            <Group title="Shape">
              <ColorField label="Stroke" value={String(p['color'] ?? '#ff4f18')} onChange={(c) => set(put(p, 'color', c ?? '#ff4f18'))} swatches={MARK_COLORS} />
              <SliderRow label="Stroke width" value={strokePx} min={0} max={Math.max(40, Math.round(strokePx * 2))} unit="px" dflt={strokePx} onChange={setStroke} />
              <Line label="Fill">
                <Toggle label="Fill" checked={p['fill'] !== undefined} onChange={(v) => set(v ? { ...p, fill: String(p['color'] ?? '#ff4f18'), fill_opacity: 0.25 } : put(put(p, 'fill', undefined), 'fill_opacity', undefined))} />
              </Line>
              {p['fill'] !== undefined && (
                <>
                  <ColorField value={String(p['fill'])} onChange={(c) => set(put(p, 'fill', c ?? '#ff4f18'))} swatches={MARK_COLORS} />
                  <SliderRow label="Fill strength" value={Math.round(num(p, 'fill_opacity', 0.25) * 100)} min={0} max={100} unit="%" dflt={25} onChange={(v) => set(put(p, 'fill_opacity', Math.round(v) / 100))} />
                </>
              )}
              {type === 'rect' && <SliderRow label="Corner radius" value={Math.round(num(p, 'radius', 0) * unit)} min={0} max={Math.max(20, Math.round(Math.min(g.w, g.h) / 2))} unit="px" onChange={(v) => set(put(p, 'radius', v > 0 ? Math.round((v / unit) * 10000) / 10000 : undefined))} />}
            </Group>
          )}
          {(type === 'arrow' || type === 'line' || type === 'pen') && (
            <Group title={type === 'pen' ? 'Stroke' : type === 'arrow' ? 'Arrow' : 'Line'}>
              <ColorField value={String(p['color'] ?? '#ff4f18')} onChange={(c) => set(put(p, 'color', c ?? '#ff4f18'))} swatches={MARK_COLORS} />
              <SliderRow label="Width" value={strokePx} min={1} max={Math.max(40, Math.round(strokePx * 2))} unit="px" dflt={strokePx} onChange={setStroke} />
              {type === 'arrow' && (
                <Line label="Heads on both ends">
                  <Toggle label="Heads on both ends" checked={p['both'] === true} onChange={(v) => set(put(p, 'both', v ? true : undefined))} />
                </Line>
              )}
            </Group>
          )}
          {type === 'highlight' && (
            <Group title="Highlight">
              <ColorField value={String(p['color'] ?? '#ffd60a')} onChange={(c) => set(put(p, 'color', c ?? '#ffd60a'))} swatches={['#ffd60a', '#2fb36d', '#1e88e5', '#ff4f18', '#e5243b']} />
            </Group>
          )}
          {type === 'step' && (
            <Group title="Step">
              <div className="grid grid-cols-2 gap-1.5">
                <NumberField label="Number" value={Number(p['n'] ?? 1)} min={0} max={999} onChange={(v) => set(put(p, 'n', String(v ?? 1)))} />
                <NumberField label="Size" unit="px" value={Math.round(g.size)} min={8} max={2000} onChange={(v) => v !== null && setG({ size: v })} />
              </div>
              <ColorField value={String(p['color'] ?? '#ff4f18')} onChange={(c) => set(put(p, 'color', c ?? '#ff4f18'))} swatches={MARK_COLORS} />
            </Group>
          )}
          {type === 'redact' && (
            <Group title="Redaction">
              <Segmented
                label="How"
                value={String(p['mode'] ?? 'solid')}
                onChange={(m) => set(m === 'solid' ? { ...p, mode: m, color: String(p['color'] ?? '#000000') } : put({ ...p, mode: m }, 'color', undefined))}
                options={[
                  { value: 'solid', label: 'Solid' },
                  { value: 'pixelate', label: 'Pixelate' },
                  { value: 'blur', label: 'Blur' },
                ]}
              />
              {String(p['mode'] ?? 'solid') === 'solid' && <ColorField value={String(p['color'] ?? '#000000')} onChange={(c) => set(put(p, 'color', c ?? '#000000'))} swatches={['#000000', '#ffffff', '#1e293b', '#e5243b']} />}
              <p className="text-[12px] leading-4 text-[var(--iu-muted)]">{String(p['mode'] ?? 'solid') === 'solid' ? 'Solid replaces the pixels for good: the safe choice for secrets.' : 'Short text can sometimes be guessed back from pixelation or blur. Use Solid for secrets.'}</p>
            </Group>
          )}
          {type === 'logo' && (
            <Group title="Logo">
              <LogoPicker
                value={String(p['asset'] ?? '')}
                onPick={(id, w, h) => {
                  // Keep the box's width; its height follows the new logo's shape.
                  const next = put(p, 'asset', id);
                  set(unplace(next, { cx: g.cx, cy: g.cy, angle: g.angle, w: g.w, h: w > 0 && h > 0 ? (g.w * h) / w : g.h }, fr), true);
                }}
              />
            </Group>
          )}
          {tiles && (
            <Group title="Repeat">
              <Line label="Tile across the image">
                <Toggle label="Tile across the image" checked={p['tile'] === true} onChange={(v) => set(v ? { ...p, tile: true, gap: num(p, 'gap', 60) } : put(put(p, 'tile', undefined), 'gap', undefined), true)} />
              </Line>
              {p['tile'] === true && <SliderRow label="Gap" value={num(p, 'gap', 60)} min={0} max={400} unit="%" dflt={60} onChange={(v) => set(put(p, 'gap', Math.round(v)))} />}
            </Group>
          )}
          <Group title="Layer">
            <SliderRow label="Opacity" value={Math.round(num(p, 'opacity', 1) * 100)} min={5} max={100} unit="%" dflt={100} onChange={(v) => set(put(p, 'opacity', v >= 100 ? undefined : Math.round(v) / 100))} />
            {turns && <SliderRow label="Rotation" value={Math.round(g.angle)} min={-180} max={180} unit="°" onChange={(a) => setG({ angle: a })} />}
            <Line label="Pinned to">
              <Segmented
                label="Pinned to"
                size="sm"
                value={p['anchor'] === 'frame' ? 'frame' : 'photo'}
                onChange={(a) => set(repin(p, a, fr), true)}
                options={[
                  { value: 'photo', label: 'Photo' },
                  { value: 'frame', label: 'Frame' },
                ]}
              />
            </Line>
            <p className="-mt-0.5 text-[12px] leading-4 text-[var(--iu-muted)]">{p['anchor'] === 'frame' ? 'Stays in its place in the frame after crops and resizes (watermarks, captions).' : 'Moves with the photo through crops and turns (arrows, redactions).'}</p>
            <div className="flex items-center gap-0.5">
              <span className="mr-auto text-[12px] text-[var(--iu-ink-2)]">Order</span>
              <BarButton label="Bring to front" onClick={() => onArrange('front')}>
                <ArrowUpToLine size={14} aria-hidden />
              </BarButton>
              <BarButton label="Bring forward (Ctrl+])" onClick={() => onArrange('forward')}>
                <ChevronUp size={14} aria-hidden />
              </BarButton>
              <BarButton label="Send backward (Ctrl+[)" onClick={() => onArrange('backward')}>
                <ChevronDown size={14} aria-hidden />
              </BarButton>
              <BarButton label="Send to back" onClick={() => onArrange('back')}>
                <ArrowDownToLine size={14} aria-hidden />
              </BarButton>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => onLock(!layer.locked)} className="inline-flex h-6 items-center gap-1 rounded-[var(--iu-r-sm)] border border-[var(--iu-line)] px-1.5 text-[12px] font-semibold text-[var(--iu-ink-2)] hover:bg-[var(--iu-row)]">
                {layer.locked ? <Lock size={12} aria-hidden /> : <Unlock size={12} aria-hidden />} {layer.locked ? 'Locked' : 'Lock'}
              </button>
              <button type="button" onClick={() => onVisible(!layer.visible)} className="inline-flex h-6 items-center rounded-[var(--iu-r-sm)] border border-[var(--iu-line)] px-1.5 text-[12px] font-semibold text-[var(--iu-ink-2)] hover:bg-[var(--iu-row)]">
                {layer.visible ? 'Hide' : 'Show'}
              </button>
              <span className="flex-1" />
              <BarButton label="Duplicate (Ctrl+D)" onClick={onDuplicate}>
                <Copy size={14} aria-hidden />
              </BarButton>
              <BarButton label="Delete (Delete)" onClick={onRemove}>
                <Trash2 size={14} aria-hidden className="text-[var(--iu-red-text)]" />
              </BarButton>
            </div>
          </Group>
        </div>
      </div>
    </section>
  );
}
