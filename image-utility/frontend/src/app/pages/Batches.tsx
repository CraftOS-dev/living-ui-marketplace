/**
 * Batches: one recipe and one set of outputs over many images, named by a
 * pattern. A batch is planned first (New batch), previewed (every file name
 * and size, a few real encodes, the estimated total), then run in the
 * background with progress per image; finished files are kept in Exports
 * and zipped. Batches your AI agent plans wait here for you to run them,
 * unless you let it run them (Settings).
 */
import { useEffect, useState } from 'react';
import { ArrowDownToLine, CircleAlert, Eye, Layers, Play, Plus, RotateCcw, Sparkles, Square, Trash2, X } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { Thumb } from '../components/Thumb.tsx';
import { Badge, Button, Empty, Field, Modal, PageHeader, Panel, Segmented, Select, Spinner, Toggle, errMessage, inputCls, useConfirm } from '../components/ui.tsx';
import type { Tone } from '../components/ui.tsx';
import { api, fileUrl } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { ago, bytes, dims as fmtDims, formatLabel, plural, saving } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { navigate } from '../lib/router.ts';
import type { BatchPreview, BatchRec, Format, Output, QualityName } from '../lib/types.ts';

const STATUS: Record<BatchRec['status'], { label: string; tone: Tone; pulse?: boolean }> = {
  draft: { label: 'Planned', tone: 'neutral' },
  proposed: { label: 'Proposed', tone: 'info' },
  queued: { label: 'Queued', tone: 'info', pulse: true },
  running: { label: 'Running', tone: 'info', pulse: true },
  done: { label: 'Done', tone: 'good' },
  failed: { label: 'Failed', tone: 'bad' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

const TOKENS: { token: string; label: string }[] = [
  { token: '{name}', label: 'name' },
  { token: '{n}', label: 'number' },
  { token: '{n:3}', label: '001' },
  { token: '{date}', label: 'today' },
  { token: '{taken}', label: 'date taken' },
  { token: '{width}', label: 'width' },
  { token: '{height}', label: 'height' },
  { token: '{format}', label: 'format' },
  { token: '{batch}', label: 'batch name' },
];

function outputsLabel(b: BatchRec): string {
  const outs = b.outputs.outputs ?? [];
  return outs.map((o) => formatLabel(o.format) + (o.longest !== undefined ? ' ' + o.longest + 'px' : '') + (o.mode === 'size' ? ' ≤' + String(o.target_kb) + 'KB' : '')).join(' + ');
}

function PreviewView({ p }: { p: BatchPreview }): React.JSX.Element {
  const est = p.estimate;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi label="Images" value={String(p.rows.length)} />
        <Kpi label="Files" value={String(p.rows.reduce((n, r) => n + r.outputs.length, 0))} />
        <Kpi label="Originals" value={est !== null ? bytes(est.bytes_in) : '–'} />
        <Kpi label="Estimated output" value={est !== null ? bytes(est.bytes_out) + ' (' + saving(est.bytes_in > 0 ? (1 - est.bytes_out / est.bytes_in) * 100 : null) + ')' : '–'} />
      </div>
      {(p.duplicates.length > 0 || p.existing.length > 0) && (
        <div className="flex flex-col gap-1 rounded-[var(--iu-r)] bg-[var(--iu-amber)]/15 px-3 py-2 text-[12px] leading-4">
          {p.duplicates.length > 0 && (
            <p className="flex gap-1.5">
              <CircleAlert size={13} aria-hidden className="mt-px shrink-0 text-[var(--iu-amber-text)]" />
              {plural(p.duplicates.length, 'name')} would repeat ({p.duplicates.slice(0, 3).join(', ')}{p.duplicates.length > 3 ? '…' : ''}); add {'{n}'} to the pattern.
            </p>
          )}
          {p.existing.length > 0 && (
            <p className="flex gap-1.5">
              <CircleAlert size={13} aria-hidden className="mt-px shrink-0 text-[var(--iu-amber-text)]" />
              {plural(p.existing.length, 'file')} already in the folder ({p.existing.slice(0, 3).join(', ')}); the collision setting decides.
            </p>
          )}
        </div>
      )}
      {p.samples.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-[12px] font-bold text-[var(--iu-ink-2)]">Test encodes</p>
          {p.samples.map((s) => (
            <div key={s.image.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-[var(--iu-r-sm)] bg-[var(--iu-row)] px-2 py-1 text-[12px]">
              <span className="font-semibold">{s.image.name}</span>
              {s.error !== undefined ? (
                <span className="text-[var(--iu-red-text)]">{s.error}</span>
              ) : (
                (s.outputs ?? []).map((o) => (
                  <span key={o.name} className="num text-[var(--iu-ink-2)]">
                    {o.name} · {fmtDims(o.width, o.height)} · {bytes(o.bytes)} {o.saved_pct !== null ? '(' + saving(o.saved_pct) + ')' : ''}
                  </span>
                ))
              )}
            </div>
          ))}
        </div>
      )}
      <div className="max-h-[38vh] overflow-auto rounded-[var(--iu-r)] border border-[var(--iu-line)]">
        <table className="iu-table">
          <thead>
            <tr>
              <th>Image</th>
              <th>Files</th>
            </tr>
          </thead>
          <tbody>
            {p.rows.map((r) => (
              <tr key={r.image.id}>
                <td className="max-w-[180px] truncate">{r.image.name}</td>
                <td>
                  <span className="flex flex-wrap gap-x-3 gap-y-0.5">
                    {r.outputs.map((o) => (
                      <span key={o.name} className={cn('num text-[12px]', o.duplicate && 'font-semibold text-[var(--iu-amber-text)]')}>
                        {o.name} <span className="text-[var(--iu-muted)]">{fmtDims(o.width, o.height)}</span>
                      </span>
                    ))}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex flex-col rounded-[var(--iu-r-md)] border border-[var(--iu-line)] bg-[var(--iu-card)] px-3 py-2">
      <span className="text-[12px] text-[var(--iu-muted)]">{label}</span>
      <span className="num text-[15px] font-bold leading-[22px]">{value}</span>
    </div>
  );
}

function NewBatch({ initial, open, onClose }: { initial: string[]; open: boolean; onClose: () => void }): React.JSX.Element {
  const { presets, settings } = useApp();
  const lib = useLive(() => api.images({ limit: 1000 }), ['images'], [], 800);
  const [images, setImages] = useState<string[]>(initial);
  const [picking, setPicking] = useState(initial.length === 0);
  const [name, setName] = useState('');
  const [useEdits, setUseEdits] = useState(true);
  const [recipe, setRecipe] = useState('');
  const [exportPreset, setExportPreset] = useState('');
  const [format, setFormat] = useState<Format>(settings?.defaults.format ?? 'webp');
  const [quality, setQuality] = useState<QualityName>(typeof settings?.defaults.quality === 'string' ? settings.defaults.quality : 'balanced');
  const [longest, setLongest] = useState('');
  const [metadata, setMetadata] = useState<'keep' | 'basic' | 'none'>(settings?.defaults.metadata ?? 'basic');
  const [rename, setRename] = useState('{name}');
  const [folderOn, setFolderOn] = useState(false);
  const [folder, setFolder] = useState(settings?.export_folder ?? '');
  const [collision, setCollision] = useState<'rename' | 'skip' | 'overwrite'>('rename');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<BatchPreview | null>(null);
  useEffect(() => {
    setImages(initial);
    setPicking(initial.length === 0);
  }, [initial]);
  const recipes = presets.filter((p) => p.kind === 'recipe' || p.kind === 'size');
  const exportPresets = presets.filter((p) => p.kind === 'export');

  const plan = async (): Promise<void> => {
    setBusy(true);
    try {
      const outputs: Output[] | undefined = exportPreset === '' ? [{ format, ...(format === 'webp' || format === 'avif' || format === 'jpeg' ? { quality } : {}), ...(longest !== '' && Number(longest) > 0 ? { longest: Math.round(Number(longest)) } : {}) }] : undefined;
      const r = await api.createBatch({
        images,
        name: name.trim() !== '' ? name.trim() : undefined,
        recipe_preset: recipe !== '' ? recipe : undefined,
        use_edits: useEdits,
        rename,
        folder: folderOn && folder.trim() !== '' ? folder.trim() : undefined,
        collision,
        outputs,
        preset: exportPreset !== '' ? exportPreset : undefined,
        metadata,
      });
      setPreview(await api.previewBatch(r.batch.id, 3));
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const run = async (): Promise<void> => {
    if (preview === null) return;
    setBusy(true);
    try {
      await api.runBatch(preview.batch.id);
      toast.success('Running "' + preview.batch.name + '"');
      setPreview(null);
      onClose();
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const all = lib.data?.images ?? [];
  const chosen = all.filter((i) => images.includes(i.id));
  return (
    <Modal
      open={open}
      onClose={() => {
        setPreview(null);
        onClose();
      }}
      xl
      title={preview === null ? 'New batch' : 'Check the batch: ' + preview.batch.name}
      description={preview === null ? 'The same edits and outputs over many images. Nothing runs until you have seen the plan.' : 'Every file it will make, with test encodes of a few images. Run it, or keep it planned.'}
      footer={
        preview === null ? (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" icon={Eye} loading={busy} disabled={images.length === 0 || (!rename.includes('{name}') && !rename.includes('{n'))} onClick={() => void plan()}>
              Plan and preview
            </Button>
          </>
        ) : (
          <>
            <Button
              onClick={() => {
                setPreview(null);
                onClose();
              }}
            >
              Keep it planned
            </Button>
            <Button variant="accent" icon={Play} loading={busy} onClick={() => void run()}>
              Run {plural(preview.rows.length, 'image')}
            </Button>
          </>
        )
      }
    >
      {preview !== null ? (
        <PreviewView p={preview} />
      ) : (
        <div className="flex flex-col gap-4">
          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h3 className="text-[13px] font-bold">{plural(images.length, 'image')}</h3>
              <Button size="sm" variant="ghost" onClick={() => setPicking((p) => !p)}>
                {picking ? 'Done choosing' : 'Choose images'}
              </Button>
            </div>
            {picking ? (
              <div className="grid max-h-[36vh] grid-cols-4 gap-1.5 overflow-y-auto sm:grid-cols-6">
                {all.map((i) => {
                  const on = images.includes(i.id);
                  return (
                    <button key={i.id} type="button" aria-pressed={on} onClick={() => setImages((x) => (on ? x.filter((y) => y !== i.id) : [...x, i.id]))} className={cn('relative overflow-hidden rounded-[var(--iu-r-sm)] border-2', on ? 'border-[var(--iu-ink)]' : 'border-transparent opacity-70 hover:opacity-100')}>
                      <Thumb image={i} fit="cover" className="aspect-square" />
                      <span className="block truncate px-1 text-left text-[12px]">{i.name}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-wrap gap-1">
                {chosen.slice(0, 14).map((i) => (
                  <Thumb key={i.id} image={i} fit="cover" className="size-10 rounded-[var(--iu-r-sm)]" />
                ))}
                {chosen.length > 14 && <span className="num flex size-10 items-center justify-center rounded-[var(--iu-r-sm)] bg-[var(--iu-row)] text-[12px] font-semibold">+{chosen.length - 14}</span>}
              </div>
            )}
          </section>
          <section className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <h3 className="text-[13px] font-bold">Edits</h3>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] text-[var(--iu-ink-2)]">Start from each image's own edits</span>
                <Toggle label="Start from each image's own edits" checked={useEdits} onChange={setUseEdits} />
              </div>
              <Select
                label="Then apply"
                value={recipe}
                onChange={setRecipe}
                options={[{ value: '', label: 'Nothing more' }, ...recipes.map((p) => ({ value: p.id, label: (p.kind === 'size' ? 'Size: ' : 'Recipe: ') + p.name }))]}
              />
              {recipe !== '' && <p className="text-[12px] leading-4 text-[var(--iu-muted)]">{recipes.find((p) => p.id === recipe)?.description}</p>}
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="text-[13px] font-bold">Files</h3>
              <Select label="Export preset" value={exportPreset} onChange={setExportPreset} options={[{ value: '', label: 'Choose below' }, ...exportPresets.map((p) => ({ value: p.id, label: p.name }))]} />
              {exportPreset === '' && (
                <>
                  <div className="flex gap-1.5">
                    <Select
                      ariaLabel="Format"
                      value={format}
                      onChange={(v) => setFormat(v as Format)}
                      className="w-24"
                      options={(['webp', 'avif', 'jpeg', 'png', 'gif', 'tiff'] as Format[]).map((f) => ({ value: f, label: formatLabel(f) }))}
                    />
                    <input value={longest} onChange={(e) => setLongest(e.target.value.replace(/[^0-9]/g, ''))} placeholder="Longest edge (px)" aria-label="Longest edge" className={cn(inputCls, 'num')} />
                  </div>
                  {(format === 'webp' || format === 'avif' || format === 'jpeg') && (
                    <Segmented<QualityName>
                      label="Quality"
                      size="sm"
                      value={quality}
                      onChange={setQuality}
                      options={[
                        { value: 'best', label: 'Best' },
                        { value: 'balanced', label: 'Balanced' },
                        { value: 'small', label: 'Small' },
                      ]}
                    />
                  )}
                </>
              )}
              <Segmented
                label="Metadata"
                size="sm"
                value={metadata}
                onChange={setMetadata}
                options={[
                  { value: 'basic', label: 'Basic metadata' },
                  { value: 'keep', label: 'Everything' },
                  { value: 'none', label: 'None' },
                ]}
              />
            </div>
          </section>
          <section className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <h3 className="text-[13px] font-bold">Names</h3>
              <Field label="Batch name">
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder={'Batch of ' + plural(images.length, 'image')} className={inputCls} />
              </Field>
              <Field label="File names" hint={!rename.includes('{name}') && !rename.includes('{n') ? 'Add {name} or a number {n} so files get different names.' : undefined}>
                <input value={rename} onChange={(e) => setRename(e.target.value)} className={cn(inputCls, 'mono')} spellCheck={false} />
              </Field>
              <div className="flex flex-wrap gap-1">
                {TOKENS.map((t) => (
                  <button key={t.token} type="button" title={'Insert ' + t.token} onClick={() => setRename((r) => r + (r.endsWith('-') || r === '' ? '' : '-') + t.token)} className="mono h-6 rounded-[var(--iu-r-sm)] border border-[var(--iu-line)] bg-[var(--iu-card)] px-1.5 text-[12px] text-[var(--iu-ink-2)] hover:border-[var(--iu-muted)]">
                    {t.token}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="text-[13px] font-bold">Where</h3>
              <p className="text-[12px] leading-4 text-[var(--iu-muted)]">Files are always kept in Exports, and zipped when the batch is done.</p>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] text-[var(--iu-ink-2)]">Also copy to a folder</span>
                <Toggle label="Also copy to a folder" checked={folderOn} onChange={setFolderOn} />
              </div>
              {folderOn && (
                <>
                  <input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="C:\Users\you\Pictures\Out" aria-label="Folder" className={cn(inputCls, 'mono')} />
                  <Select
                    label="When a file of that name exists"
                    value={collision}
                    onChange={(v) => setCollision(v as typeof collision)}
                    options={[
                      { value: 'rename', label: 'Keep both (add a number)' },
                      { value: 'skip', label: 'Skip it' },
                      { value: 'overwrite', label: 'Replace it' },
                    ]}
                  />
                </>
              )}
            </div>
          </section>
        </div>
      )}
    </Modal>
  );
}

function BatchCard({ b, onPreview }: { b: BatchRec; onPreview: (b: BatchRec) => void }): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [confirmEl, confirm] = useConfirm();
  const st = STATUS[b.status];
  const done = b.done_count + b.failed_count;
  const pct = b.total > 0 ? Math.round((done / b.total) * 100) : 0;
  const act = async (p: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    try {
      await p();
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (): Promise<void> => {
    if (!(await confirm('The batch and the files it kept in Exports are deleted; copies already in a folder stay.', 'Delete "' + b.name + '"?'))) return;
    await act(() => api.deleteBatch(b.id));
  };
  return (
    <Panel
      title={
        <span className="flex items-center gap-1.5">
          {b.requested_by === 'agent' && <Sparkles size={13} aria-label="Planned by your AI agent" className="text-[var(--iu-accent-text)]" />}
          {b.name}
        </span>
      }
      subtitle={plural(b.total, 'image') + ' · ' + outputsLabel(b) + ' · ' + b.rename + ' · ' + ago(b.created)}
      actions={
        <Badge tone={st.tone} pulse={st.pulse === true}>
          {st.label}
        </Badge>
      }
    >
      <div className="flex flex-col gap-2">
        {b.status === 'proposed' && <p className="text-[12px] leading-4 text-[var(--iu-ink-2)]">Your AI agent planned this batch; it runs when you say so.</p>}
        {(b.status === 'running' || b.status === 'queued' || done > 0) && (
          <div className="flex flex-col gap-1">
            <div className="h-1.5 overflow-hidden rounded-[var(--iu-r-sm)] bg-[var(--iu-row)]" role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
              <div className={cn('h-full transition-[width] duration-500', b.failed_count > 0 ? 'bg-[var(--iu-amber)]' : 'bg-[var(--iu-accent)]')} style={{ width: pct + '%' }} />
            </div>
            <p className="num flex flex-wrap gap-x-3 text-[12px] text-[var(--iu-muted)]">
              <span>
                {b.done_count} of {b.total} done
              </span>
              {b.failed_count > 0 && <span className="font-semibold text-[var(--iu-red-text)]">{b.failed_count} failed</span>}
              {b.bytes_in > 0 && (
                <span>
                  {bytes(b.bytes_in)} → {bytes(b.bytes_out)} ({saving((1 - b.bytes_out / b.bytes_in) * 100)})
                </span>
              )}
              {b.finished !== '' && <span>finished {ago(b.finished)}</span>}
            </p>
          </div>
        )}
        {b.error !== '' && <p className="text-[12px] text-[var(--iu-red-text)]">{b.error}</p>}
        {b.folder !== '' && <p className="mono truncate text-[12px] text-[var(--iu-muted)]">{b.folder}</p>}
        <div className="flex flex-wrap items-center gap-1.5">
          {(b.status === 'draft' || b.status === 'proposed') && (
            <>
              <Button size="sm" icon={Eye} onClick={() => onPreview(b)}>
                Preview
              </Button>
              <Button size="sm" variant="accent" icon={Play} loading={busy} onClick={() => void act(() => api.runBatch(b.id))}>
                Run
              </Button>
              {b.status === 'proposed' && (
                <Button size="sm" variant="ghost" icon={X} disabled={busy} onClick={() => void act(() => api.cancelBatch(b.id))}>
                  Reject
                </Button>
              )}
            </>
          )}
          {(b.status === 'running' || b.status === 'queued') && (
            <Button size="sm" icon={Square} loading={busy} onClick={() => void act(() => api.cancelBatch(b.id))}>
              Stop
            </Button>
          )}
          {b.zip_url !== '' && (
            <a href={fileUrl(b.zip_url, true)} download className="inline-flex h-6 items-center gap-1 rounded-[var(--iu-r)] border border-[var(--iu-line)] bg-[var(--iu-card)] px-2 text-[12px] font-semibold shadow-[var(--iu-shadow-sm)] hover:bg-[var(--iu-row)]">
              <ArrowDownToLine size={13} aria-hidden /> Download all (zip)
            </a>
          )}
          {b.done_count > 0 && (
            <Button size="sm" variant="ghost" onClick={() => navigate('exports', { batch: b.id })}>
              Show the files
            </Button>
          )}
          {(b.failed_count > 0 || b.status === 'cancelled') && b.status !== 'running' && (
            <Button size="sm" variant="ghost" icon={RotateCcw} disabled={busy} onClick={() => void act(() => api.retryBatch(b.id))}>
              {b.status === 'cancelled' ? 'Resume' : 'Retry the failed'}
            </Button>
          )}
          <span className="flex-1" />
          {b.status !== 'running' && <Button size="sm" variant="danger" icon={Trash2} aria-label="Delete batch" disabled={busy} onClick={() => void remove()} />}
        </div>
      </div>
      {confirmEl}
    </Panel>
  );
}

const NONE: string[] = [];

export function BatchesPage(): React.JSX.Element {
  const list = useLive(() => api.batches({ limit: 200 }), ['batches'], [], 300);
  const [creating, setCreating] = useState(false);
  const [preview, setPreview] = useState<BatchPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const showPreview = async (b: BatchRec): Promise<void> => {
    setPreviewing(true);
    try {
      setPreview(await api.previewBatch(b.id, 3));
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setPreviewing(false);
    }
  };
  const batches = list.data?.batches ?? [];
  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title="Batches"
        subtitle="The same edits and outputs over many images, previewed before they run."
        actions={
          <Button variant="accent" icon={Plus} onClick={() => setCreating(true)}>
            New batch
          </Button>
        }
      />
      {list.data === null ? (
        <div className="flex h-40 items-center justify-center text-[var(--iu-muted)]">
          <Spinner size={16} />
        </div>
      ) : batches.length === 0 ? (
        <Empty icon={Layers} title="No batches yet" action={<Button onClick={() => setCreating(true)}>Plan a batch</Button>}>
          Plan one to resize a folder for the web, convert a shoot to WebP or watermark every picture for a client.
        </Empty>
      ) : (
        <div className="grid gap-2.5 lg:grid-cols-2">
          {batches.map((b) => (
            <BatchCard key={b.id} b={b} onPreview={(x) => void showPreview(x)} />
          ))}
        </div>
      )}
      {previewing && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/20">
          <Spinner size={20} className="text-[var(--iu-card)]" />
        </div>
      )}
      <NewBatch initial={NONE} open={creating} onClose={() => setCreating(false)} />
      <Modal
        open={preview !== null}
        onClose={() => setPreview(null)}
        xl
        title={preview !== null ? 'Plan: ' + preview.batch.name : 'Plan'}
        description="Every file the batch will make, with test encodes of a few images."
        footer={
          preview !== null && (preview.batch.status === 'draft' || preview.batch.status === 'proposed') ? (
            <>
              <Button onClick={() => setPreview(null)}>Close</Button>
              <Button
                variant="accent"
                icon={Play}
                onClick={() => {
                  const id = preview.batch.id;
                  setPreview(null);
                  api.runBatch(id).catch((err: unknown) => toast.error(errMessage(err)));
                }}
              >
                Run
              </Button>
            </>
          ) : undefined
        }
      >
        {preview !== null && <PreviewView p={preview} />}
      </Modal>
    </div>
  );
}
