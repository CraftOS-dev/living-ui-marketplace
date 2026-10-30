/**
 * The Export tab: one or more outputs (format, quality or a size target, an
 * optional size), metadata and location, and real file sizes before saving:
 * each change re-encodes in the background (nothing is kept) and shows the
 * size, the saving against the original and the quality a size target
 * chose. Compare shows the same spot before and after at 100 %. Export keeps
 * the files (Exports) and can copy them to a folder.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, Columns2, FileDown, FolderOpen, Plus, Save, Trash2 } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { api, fileUrl } from '../../lib/api.ts';
import type { ExportSpec } from '../../lib/api.ts';
import { useApp } from '../../lib/context.tsx';
import { ago, bytes, dims as fmtDims, formatLabel, saving } from '../../lib/format.ts';
import type { CompareResult, Estimate, Format, ImageDetail, Output, QualityName } from '../../lib/types.ts';
import { Button, Field, IconButton, Modal, PropSection, Segmented, Select, Spinner, Toggle, errMessage, inputCls } from '../ui.tsx';
import { NumberField, SliderRow } from './controls.tsx';

const FORMATS: { value: Format; label: string }[] = [
  { value: 'webp', label: 'WebP' },
  { value: 'avif', label: 'AVIF' },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'png', label: 'PNG' },
  { value: 'gif', label: 'GIF' },
  { value: 'ico', label: 'ICO' },
  { value: 'tiff', label: 'TIFF' },
];

const LOSSY: Format[] = ['webp', 'avif', 'jpeg'];
const NOTE: Record<Format, string> = {
  webp: 'Small and sharp; every current browser.',
  avif: 'The smallest at the same look; slower to encode.',
  jpeg: 'Works everywhere; no transparency (it gets the matte colour).',
  png: 'Lossless; best for screenshots and graphics. Optimized.',
  gif: 'For simple animations; 256 colours.',
  ico: 'Windows and favicon icon, several sizes in one file.',
  tiff: 'Lossless, for print and archives.',
};

type Mode = QualityName | 'custom' | 'size' | 'lossless';

function modeOf(o: Output): Mode {
  if (o.mode === 'size') return 'size';
  if (o.mode === 'lossless') return 'lossless';
  if (typeof o.quality === 'number') return 'custom';
  return o.quality ?? 'balanced';
}

interface Draft {
  preset: string;
  outputs: Output[];
  metadata: 'keep' | 'basic' | 'none';
  strip_gps: boolean;
  matte: string;
}

function OutputEditor({ o, i, total, set, remove, onCompare, d }: { o: Output; i: number; total: number; set: (o: Output) => void; remove: () => void; onCompare: () => void; d: ImageDetail }): React.JSX.Element {
  const mode = modeOf(o);
  const lossy = LOSSY.includes(o.format);
  const setMode = (m: Mode): void => {
    const base: Output = { format: o.format };
    if (o.longest !== undefined) base.longest = o.longest;
    if (o.scale !== undefined) base.scale = o.scale;
    if (o.suffix !== undefined) base.suffix = o.suffix;
    if (m === 'size') set({ ...base, mode: 'size', target_kb: o.target_kb ?? Math.max(20, Math.round(d.bytes / 1024 / 4)) });
    else if (m === 'lossless') set({ ...base, mode: 'lossless' });
    else if (m === 'custom') set({ ...base, quality: 80 });
    else set({ ...base, quality: m });
  };
  return (
    <div className="flex flex-col gap-2 rounded-[var(--iu-r)] border border-[var(--iu-line)] bg-[var(--iu-card)] p-2">
      <div className="flex items-center gap-1">
        <Select
          ariaLabel="Format"
          value={o.format}
          onChange={(f) => {
            const fmt = f as Format;
            const next: Output = { format: fmt };
            if (o.longest !== undefined) next.longest = o.longest;
            if (LOSSY.includes(fmt) && LOSSY.includes(o.format)) {
              if (o.quality !== undefined) next.quality = o.quality;
              if (o.mode !== undefined && o.mode !== 'lossless') next.mode = o.mode;
              if (o.target_kb !== undefined) next.target_kb = o.target_kb;
            }
            if (fmt === 'ico') next.ico_sizes = [16, 32, 48];
            set(next);
          }}
          options={FORMATS}
          className="w-[92px]"
        />
        <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--iu-muted)]">{NOTE[o.format]}</span>
        <IconButton icon={Columns2} size={24} label="Compare before and after at 100 %" onClick={onCompare} disabled={o.format === 'ico'} />
        {total > 1 && <IconButton icon={Trash2} size={24} variant="danger" label="Remove this output" onClick={remove} />}
      </div>
      {lossy && (
        <Segmented<Mode>
          label="Quality"
          size="sm"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'best', label: 'Best' },
            { value: 'balanced', label: 'Balanced' },
            { value: 'small', label: 'Small' },
            { value: 'custom', label: 'Custom' },
            { value: 'size', label: 'Max KB' },
            ...(o.format !== 'jpeg' ? [{ value: 'lossless' as Mode, label: 'Lossless' }] : []),
          ]}
        />
      )}
      {mode === 'custom' && lossy && <SliderRow label="Quality" value={typeof o.quality === 'number' ? o.quality : 80} min={1} max={100} dflt={80} onChange={(v) => set({ ...o, quality: Math.round(v) })} />}
      {mode === 'size' && <NumberField label="Largest file" unit="KB" value={o.target_kb ?? 500} min={1} max={200000} onChange={(v) => set({ ...o, target_kb: v ?? 500 })} />}
      {o.format === 'png' && (
        <Segmented
          label="Effort"
          size="sm"
          value={o.effort ?? 'normal'}
          onChange={(v) => set({ ...o, effort: v })}
          options={[
            { value: 'fast', label: 'Fast' },
            { value: 'normal', label: 'Normal' },
            { value: 'max', label: 'Smallest (slow)' },
          ]}
        />
      )}
      {o.format === 'ico' && (
        <div className="flex flex-wrap gap-1">
          {[16, 24, 32, 48, 64, 128, 256].map((z) => {
            const on = (o.ico_sizes ?? [16, 32, 48]).includes(z);
            return (
              <button
                key={z}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  const cur = o.ico_sizes ?? [16, 32, 48];
                  const next = on ? cur.filter((x) => x !== z) : [...cur, z].sort((a, b) => a - b);
                  if (next.length > 0) set({ ...o, ico_sizes: next });
                }}
                className={cn('num h-6 rounded-[var(--iu-r-sm)] border px-1.5 text-[12px] font-semibold', on ? 'iu-on-ink border-[var(--iu-ink)] bg-[var(--iu-ink)] text-[var(--iu-shell)]' : 'border-[var(--iu-line)] text-[var(--iu-ink-2)]')}
              >
                {z}
              </button>
            );
          })}
        </div>
      )}
      {o.format !== 'ico' && (
        <div className="grid grid-cols-2 gap-1.5">
          <NumberField label="Longest edge" unit="px" placeholder={String(Math.max(d.out_width, d.out_height))} value={o.longest ?? null} min={1} max={30000} onChange={(v) => set(v === null ? (({ longest: _l, ...rest }) => rest)(o) : { ...o, longest: v })} />
          <label className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[12px] text-[var(--iu-ink-2)]">File name suffix</span>
            <input value={o.suffix ?? ''} placeholder={i > 0 ? '-' + (i + 1) : ''} onChange={(e) => set(e.target.value === '' ? (({ suffix: _s, ...rest }) => rest)(o) : { ...o, suffix: e.target.value })} onKeyDown={(e) => e.stopPropagation()} className={inputCls} />
          </label>
        </div>
      )}
    </div>
  );
}

function CompareDialog({ image, spec, label, onClose }: { image: string; spec: ExportSpec | null; label: string; onClose: () => void }): React.JSX.Element {
  const [res, setRes] = useState<CompareResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [split, setSplit] = useState(50);
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (spec === null) return;
    setRes(null);
    setErr(null);
    api
      .compare(image, spec)
      .then(setRes)
      .catch((e: unknown) => setErr(errMessage(e)));
  }, [image, spec]);
  const move = (clientX: number): void => {
    const el = box.current;
    if (el === null) return;
    const r = el.getBoundingClientRect();
    setSplit(Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100)));
  };
  return (
    <Modal open={spec !== null} onClose={onClose} xl title={'Before and after: ' + label} description="The most detailed part of the image at 100 %. Drag across to compare; artefacts show first in fine texture and sharp edges.">
      {err !== null ? (
        <p className="text-[13px] text-[var(--iu-red-text)]">{err}</p>
      ) : res === null ? (
        <div className="flex h-64 items-center justify-center text-[var(--iu-muted)]">
          <Spinner size={18} />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div
            ref={box}
            className="iu-checker relative mx-auto w-full max-w-full cursor-ew-resize select-none overflow-hidden rounded-[var(--iu-r)]"
            style={{ aspectRatio: res.box.w + ' / ' + res.box.h, maxWidth: res.box.w }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              move(e.clientX);
            }}
            onPointerMove={(e) => e.buttons === 1 && move(e.clientX)}
          >
            <img src={fileUrl(res.after)} alt="After" className="absolute inset-0 size-full" draggable={false} />
            <div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}>
              <img src={fileUrl(res.before)} alt="Before" className="absolute inset-0 size-full" draggable={false} />
            </div>
            <div className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)]" style={{ left: split + '%' }} />
            <span className="absolute left-2 top-2 rounded-[var(--iu-r-sm)] bg-black/65 px-1.5 py-0.5 text-[12px] font-semibold text-white">Before</span>
            <span className="absolute right-2 top-2 rounded-[var(--iu-r-sm)] bg-black/65 px-1.5 py-0.5 text-[12px] font-semibold text-white">After</span>
          </div>
          <p className="num text-center text-[12px] text-[var(--iu-ink-2)]">
            {label} · whole file {bytes(res.bytes)} · {fmtDims(res.width, res.height)}
            {res.quality !== null ? ' · quality ' + res.quality : ''}
          </p>
        </div>
      )}
    </Modal>
  );
}

function SizeBars({ est, source }: { est: Estimate; source: number }): React.JSX.Element {
  const max = Math.max(source, ...est.outputs.map((o) => o.bytes), 1);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 text-[12px]">
        <span className="w-14 shrink-0 text-[var(--iu-muted)]">Original</span>
        <span className="h-2 rounded-full bg-[var(--iu-line)]" style={{ width: Math.max(2, (source / max) * 100) + '%' }} />
        <span className="num ml-auto shrink-0 text-[var(--iu-muted)]">{bytes(source)}</span>
      </div>
      {est.outputs.map((o, i) => (
        <div key={i} className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2 text-[12px]">
            <span className="w-14 shrink-0 truncate font-semibold">{formatLabel(o.format)}</span>
            <span className={cn('h-2 rounded-full', o.met_target === false ? 'bg-[var(--iu-amber)]' : 'bg-[var(--iu-accent)]')} style={{ width: Math.max(2, (o.bytes / max) * 100) + '%' }} />
            <span className="num ml-auto shrink-0 font-semibold">{bytes(o.bytes)}</span>
          </div>
          <p className="num pl-16 text-[12px] leading-4 text-[var(--iu-muted)]">
            {fmtDims(o.width, o.height)}
            {o.frames > 1 ? ' · ' + o.frames + ' frames' : ''}
            {o.quality !== null ? ' · q ' + o.quality : ''}
            {o.saved_pct !== null ? ' · ' + saving(o.saved_pct) : ''}
            {o.shrunk ? ' · made smaller to fit' : ''}
            {o.met_target === false ? ' · over the target' : ''}
          </p>
        </div>
      ))}
    </div>
  );
}

export function ExportPanel({ d }: { d: ImageDetail }): React.JSX.Element {
  const { settings, presets } = useApp();
  const defaults = settings?.defaults;
  const exportPresets = presets.filter((p) => p.kind === 'export');
  const [draft, setDraft] = useState<Draft>(() => ({
    preset: '',
    outputs: [{ format: defaults?.format ?? 'webp', quality: defaults?.quality ?? 'balanced' }],
    metadata: defaults?.metadata ?? 'basic',
    strip_gps: defaults?.strip_gps !== false,
    matte: defaults?.matte ?? '#ffffff',
  }));
  const [est, setEst] = useState<Estimate | null>(null);
  const [estBusy, setEstBusy] = useState(false);
  const [estErr, setEstErr] = useState<string | null>(null);
  const [name, setName] = useState(d.name);
  const [folderOn, setFolderOn] = useState(false);
  const [folder, setFolder] = useState(settings?.export_folder ?? '');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ name: string; url: string; bytes: number; path: string }[] | null>(null);
  const [compare, setCompare] = useState<{ spec: ExportSpec; label: string } | null>(null);
  const [savingPreset, setSavingPreset] = useState(false);
  const [presetName, setPresetName] = useState('');
  useEffect(() => setName(d.name), [d.name]);

  const spec = useMemo<ExportSpec>(() => ({ outputs: draft.outputs, metadata: draft.metadata, strip_gps: draft.strip_gps, matte: draft.matte }), [draft]);
  const key = JSON.stringify(spec) + '|' + d.preview_url;

  // Real sizes, re-encoded a moment after the last change.
  useEffect(() => {
    if (d.status !== 'ready') return;
    const t = setTimeout(() => {
      setEstBusy(true);
      api
        .estimate(d.id, spec)
        .then((r) => {
          setEst(r);
          setEstErr(null);
        })
        .catch((e: unknown) => setEstErr(errMessage(e)))
        .finally(() => setEstBusy(false));
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, d.id, d.status]);

  const setOutput = (i: number, o: Output): void => setDraft((x) => ({ ...x, preset: '', outputs: x.outputs.map((y, j) => (j === i ? o : y)) }));
  const pickPreset = (id: string): void => {
    const p = exportPresets.find((x) => x.id === id);
    if (p === undefined) {
      setDraft((x) => ({ ...x, preset: '' }));
      return;
    }
    setDraft({
      preset: id,
      outputs: p.data.outputs ?? [{ format: 'webp' }],
      metadata: (p.data.metadata as Draft['metadata'] | undefined) ?? draft.metadata,
      strip_gps: p.data.strip_gps ?? draft.strip_gps,
      matte: draft.matte,
    });
  };

  const run = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await api.exportImage(d.id, { ...spec, name: name.trim() !== '' ? name.trim() : undefined, folder: folderOn && folder.trim() !== '' ? folder.trim() : undefined });
      setDone(r.exports.map((x) => ({ name: x.name, url: x.url, bytes: x.bytes, path: x.folder_path !== '' ? x.folder_path : x.path })));
      toast.success('Exported ' + r.exports.map((x) => x.name).join(', '));
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const savePreset = async (): Promise<void> => {
    try {
      await api.savePreset({ kind: 'export', name: presetName.trim(), data: { outputs: draft.outputs, metadata: draft.metadata, strip_gps: draft.strip_gps } });
      toast.success('Saved "' + presetName.trim() + '"');
      setSavingPreset(false);
      setPresetName('');
    } catch (err) {
      toast.error(errMessage(err));
    }
  };

  const hasAlpha = d.alpha || d.stack.some((e) => e.state === 'active' && e.enabled && (e.kind === 'remove_bg' || (e.kind === 'canvas' && (e.params['fill'] === 'transparent' || e.params['radius'] !== undefined))));
  return (
    <div className="flex flex-col">
      <PropSection title="Preset" actions={<IconButton icon={Save} size={22} label="Save these settings as a preset" onClick={() => setSavingPreset(true)} />}>
        <Select ariaLabel="Preset" value={draft.preset} onChange={pickPreset} options={[{ value: '', label: 'Custom' }, ...exportPresets.map((p) => ({ value: p.id, label: p.name }))]} />
        {draft.preset !== '' && <p className="mt-1 text-[12px] leading-4 text-[var(--iu-muted)]">{exportPresets.find((p) => p.id === draft.preset)?.description}</p>}
      </PropSection>
      <PropSection
        title={draft.outputs.length === 1 ? 'Output' : draft.outputs.length + ' outputs'}
        actions={
          draft.outputs.length < 12 ? (
            <button type="button" onClick={() => setDraft((x) => ({ ...x, preset: '', outputs: [...x.outputs, { format: x.outputs.some((o) => o.format === 'avif') ? 'jpeg' : 'avif', quality: 'balanced' }] }))} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--iu-ink-2)] hover:text-[var(--iu-ink)]">
              <Plus size={12} aria-hidden /> Add a format
            </button>
          ) : undefined
        }
      >
        <div className="flex flex-col gap-1.5">
          {draft.outputs.map((o, i) => (
            <OutputEditor
              key={i}
              o={o}
              i={i}
              d={d}
              total={draft.outputs.length}
              set={(x) => setOutput(i, x)}
              remove={() => setDraft((x) => ({ ...x, preset: '', outputs: x.outputs.filter((_, j) => j !== i) }))}
              onCompare={() => setCompare({ spec: { ...spec, outputs: [o] }, label: formatLabel(o.format) + (typeof o.quality === 'string' ? ' ' + o.quality : typeof o.quality === 'number' ? ' q' + o.quality : o.mode === 'size' ? ' under ' + String(o.target_kb) + ' KB' : '') })}
            />
          ))}
        </div>
      </PropSection>
      <PropSection title="Size" actions={estBusy ? <Spinner size={11} className="text-[var(--iu-muted)]" /> : undefined}>
        {estErr !== null ? <p className="text-[12px] leading-4 text-[var(--iu-red-text)]">{estErr}</p> : est !== null ? <SizeBars est={est} source={d.bytes} /> : <p className="text-[12px] text-[var(--iu-muted)]">{d.status === 'ready' ? 'Encoding a test copy' : 'Shows once the image engine is ready'}</p>}
      </PropSection>
      <PropSection title="Metadata">
        <Segmented
          label="Metadata"
          size="sm"
          value={draft.metadata}
          onChange={(v) => setDraft((x) => ({ ...x, metadata: v }))}
          options={[
            { value: 'basic', label: 'Basic' },
            { value: 'keep', label: 'Everything' },
            { value: 'none', label: 'None' },
          ]}
        />
        <p className="mt-1 text-[12px] leading-4 text-[var(--iu-muted)]">{draft.metadata === 'basic' ? 'Camera, date, author, copyright and the alt text; the rest is removed.' : draft.metadata === 'keep' ? 'Everything the camera wrote stays.' : 'No metadata at all (smallest, most private).'}</p>
        {draft.metadata !== 'none' && (
          <div className="mt-1.5 flex items-center justify-between">
            <span className="text-[12px] text-[var(--iu-ink-2)]">Remove the location (GPS)</span>
            <Toggle label="Remove the location" checked={draft.strip_gps} onChange={(v) => setDraft((x) => ({ ...x, strip_gps: v }))} />
          </div>
        )}
        {hasAlpha && draft.outputs.some((o) => o.format === 'jpeg') && (
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <span className="text-[12px] text-[var(--iu-ink-2)]">JPEG background for transparency</span>
            <input type="color" aria-label="Matte colour" value={draft.matte} onChange={(e) => setDraft((x) => ({ ...x, matte: e.target.value }))} className="h-6 w-10 cursor-pointer rounded-[var(--iu-r-sm)] border border-[var(--iu-line)] bg-transparent" />
          </div>
        )}
      </PropSection>
      <PropSection title="Save">
        <div className="flex flex-col gap-2">
          <Field label="File name">
            <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} className={inputCls} />
          </Field>
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-[var(--iu-ink-2)]">Also copy to a folder</span>
            <Toggle label="Also copy to a folder" checked={folderOn} onChange={setFolderOn} />
          </div>
          {folderOn && <input value={folder} onChange={(e) => setFolder(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="C:\Users\you\Pictures\Exports" aria-label="Folder" className={cn(inputCls, 'mono')} />}
          <Button variant="accent" icon={FileDown} loading={busy} disabled={d.status !== 'ready'} onClick={() => void run()}>
            Export {draft.outputs.length > 1 ? draft.outputs.length + ' files' : formatLabel(draft.outputs[0]?.format ?? 'webp')}
          </Button>
          {done !== null && (
            <ul className="flex flex-col gap-1 rounded-[var(--iu-r)] bg-[var(--iu-row)] p-1.5">
              {done.map((f) => (
                <li key={f.url} className="flex items-center gap-1.5 text-[12px]">
                  <span className="min-w-0 flex-1 truncate font-semibold" title={f.path}>
                    {f.name}
                  </span>
                  <span className="num text-[var(--iu-muted)]">{bytes(f.bytes)}</span>
                  <a href={fileUrl(f.url, true)} download={f.name} aria-label={'Download ' + f.name} title="Download" className="flex size-6 items-center justify-center rounded-[var(--iu-r-sm)] text-[var(--iu-ink-2)] hover:bg-[var(--iu-row-hover)]">
                    <ArrowDownToLine size={13} aria-hidden />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PropSection>
      {d.exports.length > 0 && (
        <PropSection title="Exported before">
          <ul className="flex flex-col">
            {d.exports.slice(0, 8).map((x) => (
              <li key={x.id} className="flex h-7 items-center gap-1.5 text-[12px]">
                <span className="min-w-0 flex-1 truncate" title={x.folder_path !== '' ? x.folder_path : x.path}>
                  {x.name}
                </span>
                <span className="num shrink-0 text-[var(--iu-muted)]">{bytes(x.bytes)}</span>
                <span className="shrink-0 text-[var(--iu-muted)]">{ago(x.created)}</span>
                {x.folder_path !== '' && <FolderOpen size={12} aria-label="Copied to a folder" className="shrink-0 text-[var(--iu-muted)]" />}
                <a href={fileUrl(x.url, true)} download={x.name} aria-label={'Download ' + x.name} className="flex size-6 shrink-0 items-center justify-center rounded-[var(--iu-r-sm)] text-[var(--iu-ink-2)] hover:bg-[var(--iu-row)]">
                  <ArrowDownToLine size={13} aria-hidden />
                </a>
              </li>
            ))}
          </ul>
        </PropSection>
      )}
      {compare !== null && <CompareDialog image={d.id} spec={compare.spec} label={compare.label} onClose={() => setCompare(null)} />}
      <Modal
        open={savingPreset}
        onClose={() => setSavingPreset(false)}
        title="Save as an export preset"
        description="Formats, quality, sizes and metadata; for one image here or a whole batch."
        footer={
          <>
            <Button onClick={() => setSavingPreset(false)}>Cancel</Button>
            <Button variant="primary" disabled={presetName.trim() === ''} onClick={() => void savePreset()}>
              Save preset
            </Button>
          </>
        }
      >
        <input autoFocus value={presetName} onChange={(e) => setPresetName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && presetName.trim() !== '' && void savePreset()} placeholder="Blog images" aria-label="Preset name" className={inputCls} />
      </Modal>
    </div>
  );
}
