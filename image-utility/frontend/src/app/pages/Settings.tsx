/**
 * Settings: the image engine and its optional background-removal models,
 * export defaults, what your AI agent may do (propose or edit, plan or run
 * batches, house rules, the folder it may write to), presets and logos,
 * and the keyboard shortcuts.
 */
import { useEffect, useRef, useState } from 'react';
import { ImageUp, Trash2 } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { AddonRow, EngineSetupNote, setupBadge } from '../components/EngineSetup.tsx';
import { Badge, Button, IconButton, Kbd, PageHeader, Panel, Segmented, Select, Toggle, errMessage, inputCls, textareaCls, useConfirm } from '../components/ui.tsx';
import { NumberField } from '../components/workspace/controls.tsx';
import { api, fileUrl } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { bytes, formatLabel } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import type { Defaults, Format, Policy, Preset, QualityName } from '../lib/types.ts';

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1.5 border-b border-[var(--iu-hair)] py-2.5 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <p className="text-[13px] font-semibold">{label}</p>
        {hint !== undefined && <p className="text-[12px] leading-4 text-[var(--iu-muted)]">{hint}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

function EngineSection(): React.JSX.Element {
  const { status } = useApp();
  const e = status?.engine;
  const setup = status?.setup;
  const badge = e !== undefined && setup !== undefined && !e.installed ? setupBadge(setup) : null;
  return (
    <div className="flex flex-col gap-3">
      <Panel tone="dark" title="Image engine" subtitle="Python 3.11 with Pillow 13, NumPy, MozJPEG and oxipng, downloaded once and checked; it runs on this computer only.">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={badge?.bad === true ? 'bad' : 'dark'}>{e === undefined ? 'Checking' : badge !== null ? badge.label : e.running ? 'Running' : 'Installed'}</Badge>
          {e?.load_ms !== null && e?.load_ms !== undefined && <span className="num text-[12px] text-[var(--iu-on-dark-muted)]">starts in {Math.round(e.load_ms)} ms</span>}
        </div>
        {setup !== undefined && e !== undefined && !e.installed && <EngineSetupNote setup={setup} />}
        {e !== undefined && (
          <p className="mono mt-2 break-all text-[12px] leading-4 text-[var(--iu-on-dark-muted)]" title="Engine folder">
            {e.folder}
          </p>
        )}
      </Panel>
      {setup !== undefined && (
        <Panel title="Background removal" subtitle="Optional models for Remove background; downloaded only when you ask.">
          <div className="divide-y divide-[var(--iu-hair)]">
            <AddonRow group="bg" setup={setup} title="Fast model (u2netp)" detail="About a second per image; products, portraits, plain backgrounds. Needs onnxruntime (included)." />
            <AddonRow group="bg_detailed" setup={setup} title="Detailed model (isnet-general-use)" detail="Finer edges for hair and fur; slower. Install the fast model first." />
          </div>
        </Panel>
      )}
    </div>
  );
}

function DefaultsSection(): React.JSX.Element {
  const { settings } = useApp();
  const d = settings?.defaults;
  const save = (p: Partial<Defaults>): void => {
    api.updateSettings({ defaults: p }).catch((err: unknown) => toast.error(errMessage(err)));
  };
  if (d === undefined) return <Panel title="Export defaults">Loading</Panel>;
  return (
    <Panel title="Export defaults" subtitle="Where every new export starts; the Export tab and batches can change them.">
      <Row label="Format">
        <Select ariaLabel="Format" value={d.format} onChange={(v) => save({ format: v as Format })} className="w-32" options={(['webp', 'avif', 'jpeg', 'png'] as Format[]).map((f) => ({ value: f, label: formatLabel(f) }))} />
      </Row>
      <Row label="Quality" hint="Best keeps fine detail; Small is for thumbnails and email.">
        <Segmented<QualityName>
          label="Quality"
          value={typeof d.quality === 'string' ? d.quality : 'balanced'}
          onChange={(v) => save({ quality: v })}
          options={[
            { value: 'best', label: 'Best' },
            { value: 'balanced', label: 'Balanced' },
            { value: 'small', label: 'Small' },
          ]}
        />
      </Row>
      <Row label="Metadata" hint="Basic keeps camera, date, author, copyright and alt text.">
        <Segmented
          label="Metadata"
          value={d.metadata}
          onChange={(v) => save({ metadata: v })}
          options={[
            { value: 'basic', label: 'Basic' },
            { value: 'keep', label: 'Everything' },
            { value: 'none', label: 'None' },
          ]}
        />
      </Row>
      <Row label="Remove the location" hint="GPS coordinates in photos say where they were taken.">
        <Toggle label="Remove the location" checked={d.strip_gps} onChange={(v) => save({ strip_gps: v })} />
      </Row>
      <Row label="Background for JPEG" hint="JPEG has no transparency; transparent pixels get this colour.">
        <input type="color" aria-label="Matte colour" value={d.matte} onChange={(e) => save({ matte: e.target.value })} className="h-7 w-12 cursor-pointer rounded-[var(--iu-r)] border border-[var(--iu-line)] bg-transparent" />
      </Row>
      <Row label="PNG optimization" hint="Smallest takes several seconds per image.">
        <Segmented
          label="PNG optimization"
          value={d.effort}
          onChange={(v) => save({ effort: v })}
          options={[
            { value: 'fast', label: 'Fast' },
            { value: 'normal', label: 'Normal' },
            { value: 'max', label: 'Smallest' },
          ]}
        />
      </Row>
    </Panel>
  );
}

function AgentSection(): React.JSX.Element {
  const { settings } = useApp();
  const pol = settings?.policy;
  const [rules, setRules] = useState(pol?.house_rules ?? '');
  const [folder, setFolder] = useState(settings?.export_folder ?? '');
  useEffect(() => setRules(pol?.house_rules ?? ''), [pol?.house_rules]);
  useEffect(() => setFolder(settings?.export_folder ?? ''), [settings?.export_folder]);
  const save = (p: { policy?: Partial<Policy>; export_folder?: string }): void => {
    api
      .updateSettings(p)
      .then(() => toast.success('Saved'))
      .catch((err: unknown) => toast.error(errMessage(err)));
  };
  if (pol === undefined) return <Panel title="Your AI agent">Loading</Panel>;
  return (
    <Panel title="Your AI agent" subtitle="It works through the same operations you use; this is what it may do on its own.">
      <Row label="Its edits" hint={pol.agent_edits === 'propose' ? 'Proposals you preview, accept or reject; it cannot change your edits.' : 'Applied directly and marked as its own; you can undo them.'}>
        <Segmented
          label="Its edits"
          value={pol.agent_edits}
          onChange={(v) => save({ policy: { agent_edits: v } })}
          options={[
            { value: 'propose', label: 'Propose' },
            { value: 'apply', label: 'Edit directly' },
          ]}
        />
      </Row>
      <Row label="Its batches" hint={pol.agent_batches === 'propose' ? 'It plans batches; you run them.' : 'It may run the batches it plans.'}>
        <Segmented
          label="Its batches"
          value={pol.agent_batches}
          onChange={(v) => save({ policy: { agent_batches: v } })}
          options={[
            { value: 'propose', label: 'Plan only' },
            { value: 'run', label: 'Plan and run' },
          ]}
        />
      </Row>
      <div className="flex flex-col gap-1.5 border-b border-[var(--iu-hair)] py-2.5">
        <p className="text-[13px] font-semibold">House rules</p>
        <p className="text-[12px] leading-4 text-[var(--iu-muted)]">It reads these before every job, e.g. "watermark everything for clients with the studio logo, bottom right" or "never upscale".</p>
        <textarea rows={3} value={rules} onChange={(e) => setRules(e.target.value)} onBlur={() => rules !== pol.house_rules && save({ policy: { house_rules: rules } })} className={textareaCls} />
      </div>
      <div className="flex flex-col gap-1.5 py-2.5">
        <p className="text-[13px] font-semibold">Folder it may write to</p>
        <p className="text-[12px] leading-4 text-[var(--iu-muted)]">Exports always stay in the app; your AI agent copies files only into this folder (and its subfolders). Empty: nowhere.</p>
        <div className="flex gap-1.5">
          <input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="C:\Users\you\Pictures\From the agent" aria-label="Export folder" className={cn(inputCls, 'mono')} />
          <Button disabled={folder === (settings?.export_folder ?? '')} onClick={() => save({ export_folder: folder.trim() })}>
            Save
          </Button>
        </div>
      </div>
    </Panel>
  );
}

function PresetsSection(): React.JSX.Element {
  const { presets } = useApp();
  const [confirmEl, confirm] = useConfirm();
  const [name, setName] = useState('');
  const [w, setW] = useState<number | null>(1080);
  const [h, setH] = useState<number | null>(1080);
  const remove = async (p: Preset): Promise<void> => {
    if (!(await confirm('Batches and images that used it keep their settings.', 'Delete "' + p.name + '"?'))) return;
    api.deletePreset(p.id).catch((err: unknown) => toast.error(errMessage(err)));
  };
  const addSize = async (): Promise<void> => {
    if (name.trim() === '' || w === null || h === null) return;
    try {
      await api.savePreset({ kind: 'size', name: name.trim(), description: w + ' x ' + h, data: { width: w, height: h } });
      setName('');
    } catch (err) {
      toast.error(errMessage(err));
    }
  };
  const groups: { kind: Preset['kind']; title: string; hint: string }[] = [
    { kind: 'recipe', title: 'Recipes', hint: 'Edits to apply to any image (save one from an image: Edits menu).' },
    { kind: 'export', title: 'Export presets', hint: 'Formats, quality, sizes and metadata (save one from the Export tab).' },
    { kind: 'size', title: 'Sizes', hint: 'Social and web sizes; applied as a fill that keeps the subject in frame.' },
  ];
  return (
    <Panel title="Presets" padded={false}>
      {groups.map((g) => (
        <section key={g.kind} className="border-b border-[var(--iu-hair)] px-3 py-2.5 last:border-b-0">
          <p className="text-[13px] font-semibold">{g.title}</p>
          <p className="mb-1.5 text-[12px] leading-4 text-[var(--iu-muted)]">{g.hint}</p>
          <ul className="flex flex-col">
            {presets
              .filter((p) => p.kind === g.kind)
              .map((p) => (
                <li key={p.id} className="group flex h-7 items-center gap-2 text-[12px]">
                  <span className="min-w-0 truncate font-semibold">{p.name}</span>
                  <span className="min-w-0 flex-1 truncate text-[var(--iu-muted)]">{p.description}</span>
                  {p.builtin ? <span className="text-[var(--iu-muted)]">Built in</span> : <IconButton icon={Trash2} size={22} variant="danger" label={'Delete ' + p.name} onClick={() => void remove(p)} />}
                </li>
              ))}
          </ul>
          {g.kind === 'size' && (
            <div className="mt-2 flex flex-wrap items-end gap-1.5">
              <label className="flex min-w-[140px] flex-1 flex-col gap-0.5">
                <span className="text-[12px] text-[var(--iu-ink-2)]">New size</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Shop product" className={inputCls} />
              </label>
              <NumberField label="Width" unit="px" value={w} min={1} max={30000} onChange={setW} className="w-24" />
              <NumberField label="Height" unit="px" value={h} min={1} max={30000} onChange={setH} className="w-24" />
              <Button disabled={name.trim() === ''} onClick={() => void addSize()}>
                Add
              </Button>
            </div>
          )}
        </section>
      ))}
      {confirmEl}
    </Panel>
  );
}

function LogosSection(): React.JSX.Element {
  const list = useLive(() => api.assets(), ['assets'], []);
  const file = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const upload = async (f: File): Promise<void> => {
    setBusy(true);
    try {
      await api.addAsset(f);
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const assets = list.data?.assets ?? [];
  return (
    <Panel
      title="Logos"
      subtitle="For watermarks. A PNG with transparency works best."
      actions={
        <Button size="sm" icon={ImageUp} loading={busy} onClick={() => file.current?.click()}>
          Add a logo
        </Button>
      }
    >
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
      {assets.length === 0 ? (
        <p className="text-[12px] text-[var(--iu-muted)]">No logos yet.</p>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {assets.map((a) => (
            <div key={a.id} className="group relative flex flex-col gap-1">
              <span className="iu-checker iu-checker-sm flex aspect-square items-center justify-center overflow-hidden rounded-[var(--iu-r)] border border-[var(--iu-line)]">
                <img src={fileUrl(a.url)} alt={a.name} className="max-h-full max-w-full object-contain p-2" draggable={false} />
              </span>
              <span className="truncate text-[12px] font-semibold">{a.name}</span>
              <span className="num -mt-1 text-[12px] text-[var(--iu-muted)]">
                {a.width} × {a.height} · {bytes(a.bytes)}
              </span>
              <span className="absolute right-1 top-1 opacity-0 group-hover:opacity-100">
                <IconButton icon={Trash2} size={22} variant="secondary" label={'Delete ' + a.name} onClick={() => api.deleteAsset(a.id).catch((err: unknown) => toast.error(errMessage(err)))} />
              </span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

const SHORTCUTS: [string, string][] = [
  ['C', 'Crop and straighten'],
  ['R', 'Resize'],
  ['B', 'Canvas and frame'],
  ['A', 'Adjust'],
  ['Shift A', 'Auto light and colour'],
  ['F', 'Filter'],
  ['K', 'Remove background'],
  ['[  ]', 'Rotate left, right'],
  ['H', 'Flip'],
  ['V', 'Select and move layers'],
  ['T', 'Text layer'],
  ['L', 'Arrow'],
  ['Shift L', 'Line'],
  ['U  E', 'Box, ellipse'],
  ['M', 'Highlighter'],
  ['N', 'Numbered step'],
  ['P', 'Pen'],
  ['X', 'Redaction'],
  ['G', 'Logo or watermark'],
  ['Arrows', 'Nudge the layer (Shift for 10 px)'],
  ['Enter', 'Type in the text layer'],
  ['Ctrl D', 'Duplicate the layer'],
  ['Ctrl ]  [', 'Bring forward, send backward'],
  ['Ctrl Shift ]  [', 'Bring to front, send to back'],
  ['Delete', 'Delete the layer'],
  ['Esc', 'Let go of the layer, or close the tool'],
  ['0', 'Fit'],
  ['1', '100 %'],
  ['+  −', 'Zoom'],
  ['Space', 'Hold to pan'],
  ['\\', 'Hold to see the original'],
  ['Ctrl Z', 'Undo'],
  ['Ctrl Y', 'Redo'],
  ['Ctrl E', 'Export'],
  ['Ctrl V', 'Paste an image to import it'],
];

export function SettingsPage(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <PageHeader title="Settings" subtitle="The engine, export defaults, your AI agent, presets and logos." />
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-3">
          <EngineSection />
          <DefaultsSection />
          <LogosSection />
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <AgentSection />
          <PresetsSection />
          <Panel title="Keyboard shortcuts" subtitle="In an image's workspace.">
            <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
              {SHORTCUTS.map(([k, v]) => (
                <div key={k + v} className="flex h-7 items-center justify-between gap-2 text-[12px]">
                  <span className="text-[var(--iu-ink-2)]">{v}</span>
                  <Kbd>{k}</Kbd>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

