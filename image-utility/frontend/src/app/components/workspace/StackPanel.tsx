/**
 * The left panel: the image's edit stack, top to bottom in the order they
 * apply, starting from the original. Click an edit to open it in its tool,
 * drag to reorder, the eye turns it off, the bin removes it (all undoable).
 * The AI agent's edits carry its mark; its pending proposals sit on top with
 * Preview, Accept and Reject. Below, the library as a filmstrip.
 */
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Check, ChevronDown, ChevronRight, Copy, Ellipsis, Eye, EyeOff, GripVertical, ImageIcon, Plus, RotateCcw, Save, Sparkles, Trash2, Wand, X } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { api } from '../../lib/api.ts';
import { useApp } from '../../lib/context.tsx';
import { bytes, dims as fmtDims, plural } from '../../lib/format.ts';
import { KIND_ICON } from '../../lib/icons.ts';
import { useLive } from '../../lib/live.ts';
import { navigate } from '../../lib/router.ts';
import type { Edit, EditKind, ImageDetail, Proposal } from '../../lib/types.ts';
import { useImporter } from '../Importer.tsx';
import { Thumb } from '../Thumb.tsx';
import { Button, IconButton, Modal, Popover, errMessage, inputCls, menuItem, useConfirm } from '../ui.tsx';

function EditRow({
  e,
  index,
  active,
  onOpen,
  onDragStart,
  onDrop,
  dragOver,
  setDragOver,
}: {
  e: Edit;
  index: number;
  active: boolean;
  onOpen: () => void;
  onDragStart: () => void;
  onDrop: (to: number) => void;
  dragOver: number | null;
  setDragOver: (i: number | null) => void;
}): React.JSX.Element {
  const Icon = KIND_ICON[e.kind];
  const [busy, setBusy] = useState(false);
  const run = (p: Promise<unknown>): void => {
    setBusy(true);
    p.catch((err: unknown) => toast.error(errMessage(err))).finally(() => setBusy(false));
  };
  return (
    <div
      draggable
      onDragStart={(ev) => {
        ev.dataTransfer.effectAllowed = 'move';
        ev.dataTransfer.setData('text/plain', e.id);
        onDragStart();
      }}
      onDragOver={(ev) => {
        ev.preventDefault();
        setDragOver(index);
      }}
      onDragLeave={() => setDragOver(null)}
      onDrop={(ev) => {
        ev.preventDefault();
        setDragOver(null);
        onDrop(index);
      }}
      className={cn('group relative flex flex-col rounded-[var(--iu-r-sm)] px-1 transition-colors', active ? 'bg-[var(--iu-row-hover)]' : 'hover:bg-[var(--iu-row)]', busy && 'opacity-60')}
    >
      {dragOver === index && <span aria-hidden className="absolute inset-x-1 -top-px h-0.5 rounded-full bg-[var(--iu-ink)]" />}
      <div className="flex h-8 items-center gap-1">
        <GripVertical size={12} aria-hidden className="shrink-0 cursor-grab text-[var(--iu-muted)] opacity-0 group-hover:opacity-100" />
        <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-1.5 text-left" title={'Edit (' + e.label + ')'}>
          <Icon size={14} aria-hidden className={cn('shrink-0', active ? 'text-[var(--iu-accent-text)]' : e.enabled ? 'text-[var(--iu-ink-2)]' : 'text-[var(--iu-muted)]')} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className={cn('truncate text-[13px] leading-4', e.enabled ? 'font-medium' : 'text-[var(--iu-muted)] line-through')}>{e.label}</span>
            <span className="truncate text-[12px] leading-4 text-[var(--iu-muted)]">{e.summary}</span>
          </span>
        </button>
        {e.author === 'agent' && <Sparkles size={12} aria-label="Made by your AI agent" className="shrink-0 text-[var(--iu-accent-text)]" />}
        <span className="flex shrink-0 items-center opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          <IconButton icon={e.enabled ? Eye : EyeOff} size={22} label={e.enabled ? 'Turn off' : 'Turn on'} onClick={() => run(api.updateEdit(e.id, { enabled: !e.enabled }))} />
          <IconButton icon={Trash2} size={22} variant="danger" label="Remove" onClick={() => run(api.removeEdits([e.id]))} />
        </span>
        {!e.enabled && <EyeOff size={12} aria-label="Turned off" className="shrink-0 text-[var(--iu-muted)] group-hover:hidden" />}
      </div>
    </div>
  );
}

function ProposalCard({ p, edits, previewing, onPreview }: { p: Proposal; edits: Edit[]; previewing: boolean; onPreview: (on: boolean) => void }): React.JSX.Element {
  const [busy, setBusy] = useState<'accept' | 'reject' | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const decide = async (accept: boolean): Promise<void> => {
    setBusy(accept ? 'accept' : 'reject');
    try {
      if (accept) await api.accept(p.id);
      else await api.reject(p.id, reason.trim() || undefined);
      onPreview(false);
      toast.success(accept ? 'Accepted: the edits are yours now' : 'Rejected');
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(null);
      setRejecting(false);
    }
  };
  return (
    <section className="iu-rise mx-2 mb-2 flex flex-col gap-1.5 rounded-[var(--iu-r)] border border-[var(--iu-accent)]/50 bg-[var(--iu-accent)]/6 p-2">
      <p className="flex items-center gap-1.5 text-[12px] font-bold text-[var(--iu-accent-text)]">
        <Sparkles size={13} aria-hidden /> Your AI agent proposes
      </p>
      <p className="text-[13px] font-semibold leading-4">{p.title || plural(edits.length, 'edit')}</p>
      {p.reason !== '' && <p className="text-[12px] leading-4 text-[var(--iu-ink-2)]">{p.reason}</p>}
      <ul className="flex flex-col gap-0.5">
        {edits.map((e) => {
          const Icon = KIND_ICON[e.kind];
          return (
            <li key={e.id} className="flex items-center gap-1.5 rounded-[var(--iu-r-sm)] border border-dashed border-[var(--iu-line)] bg-[var(--iu-card)] px-1.5 py-1 text-[12px]">
              <Icon size={13} aria-hidden className="shrink-0 text-[var(--iu-ink-2)]" />
              <span className="font-semibold">{e.label}</span>
              <span className="min-w-0 truncate text-[var(--iu-muted)]">{e.summary}</span>
            </li>
          );
        })}
      </ul>
      {p.summary.error !== undefined && <p className="text-[12px] text-[var(--iu-red-text)]">{p.summary.error}</p>}
      <Button size="sm" variant={previewing ? 'primary' : 'secondary'} icon={Eye} onClick={() => onPreview(!previewing)} className="w-full">
        {previewing ? 'Showing it on the image' : 'Preview on the image'}
      </Button>
      {rejecting ? (
        <div className="flex flex-col gap-1.5 rounded-[var(--iu-r-sm)] border border-[var(--iu-line)] bg-[var(--iu-card)] p-1.5">
          <p className="text-[12px] font-semibold">Why not? Your AI agent reads it (optional).</p>
          <textarea autoFocus rows={2} value={reason} onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="Too strong, wrong person, keep the sky" className={cn(inputCls, 'h-auto py-1')} />
          <div className="grid grid-cols-2 gap-1">
            <Button size="sm" variant="ghost" onClick={() => setRejecting(false)} className="w-full">
              Back
            </Button>
            <Button size="sm" variant="danger" icon={X} loading={busy === 'reject'} onClick={() => void decide(false)} className="w-full">
              Reject
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-1">
          <Button size="sm" icon={X} disabled={busy !== null} onClick={() => setRejecting(true)} className="w-full">
            Reject
          </Button>
          <Button size="sm" variant="primary" icon={Check} loading={busy === 'accept'} onClick={() => void decide(true)} className="w-full">
            Accept
          </Button>
        </div>
      )}
    </section>
  );
}

function SaveRecipe({ image, open, onClose }: { image: string; open: boolean; onClose: () => void }): React.JSX.Element {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await api.savePreset({ name: name.trim(), from_image: image, kind: 'recipe' });
      toast.success('Saved "' + r.preset.name + '"' + (r.skipped.length > 0 ? ' (left out: ' + r.skipped.join(', ') + ')' : ''));
      setName('');
      onClose();
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Save the edits as a recipe"
      description="A recipe applies the same edits to any image, here or in a batch. Marks, redactions and crop boxes belong to this image and are left out; crops keep their ratio."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={name.trim() === ''} onClick={() => void save()}>
            Save recipe
          </Button>
        </>
      }
    >
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() !== '' && void save()} placeholder="Product shots" aria-label="Name" className={inputCls} />
    </Modal>
  );
}

function CopyEdits({ d, open, onClose }: { d: ImageDetail; open: boolean; onClose: () => void }): React.JSX.Element {
  const list = useLive(() => api.images({ limit: 300 }), ['images'], [], 600);
  const [picked, setPicked] = useState<string[]>([]);
  const kinds = Array.from(new Set(d.stack.filter((e) => e.state === 'active' && e.enabled).map((e) => e.kind)));
  const [only, setOnly] = useState<EditKind[]>([]);
  const [busy, setBusy] = useState(false);
  const copy = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await api.copyEdits(d.id, picked, only.length > 0 ? only : undefined);
      const skipped = r.results.reduce((n, x) => n + x.skipped.length, 0);
      toast.success('Copied to ' + plural(r.results.length, 'image') + (skipped > 0 ? '; ' + plural(skipped, 'edit') + ' did not fit and were skipped' : ''));
      setPicked([]);
      onClose();
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const others = (list.data?.images ?? []).filter((i) => i.id !== d.id);
  return (
    <Modal
      open={open}
      onClose={onClose}
      xl
      title="Copy these edits to other images"
      description="Positions and sizes scale to each image. The copies are new edits on each image (undoable there)."
      footer={
        <>
          <span className="mr-auto self-center text-[12px] text-[var(--iu-muted)]">{plural(picked.length, 'image')} picked</span>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={Copy} loading={busy} disabled={picked.length === 0} onClick={() => void copy()}>
            Copy edits
          </Button>
        </>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-1">
        <span className="mr-1 text-[12px] font-semibold text-[var(--iu-ink-2)]">Copy</span>
        {kinds.map((k) => {
          const on = only.length === 0 || only.includes(k);
          const Icon = KIND_ICON[k];
          return (
            <button
              key={k}
              type="button"
              aria-pressed={on}
              onClick={() => setOnly((o) => (o.length === 0 ? kinds.filter((x) => x !== k) : o.includes(k) ? o.filter((x) => x !== k) : [...o, k]))}
              className={cn('inline-flex h-6 items-center gap-1 rounded-[var(--iu-r-sm)] border px-1.5 text-[12px] font-semibold', on ? 'iu-on-ink border-[var(--iu-ink)] bg-[var(--iu-ink)] text-[var(--iu-shell)]' : 'border-[var(--iu-line)] text-[var(--iu-muted)]')}
            >
              <Icon size={12} aria-hidden /> {d.stack.find((e) => e.kind === k)?.label ?? k}
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {others.map((i) => {
          const on = picked.includes(i.id);
          return (
            <button key={i.id} type="button" aria-pressed={on} onClick={() => setPicked((p) => (on ? p.filter((x) => x !== i.id) : [...p, i.id]))} className={cn('flex flex-col gap-1 rounded-[var(--iu-r)] border-2 p-1 text-left', on ? 'border-[var(--iu-ink)]' : 'border-transparent hover:border-[var(--iu-line)]')}>
              <Thumb image={i} className="aspect-[4/3] rounded-[var(--iu-r-sm)]" />
              <span className="truncate text-[12px] font-semibold">{i.name}</span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

export function StackPanel({
  d,
  activeEdit,
  previewProposal,
  onEdit,
  onPreviewProposal,
  layers,
  layerCount,
}: {
  d: ImageDetail;
  activeEdit: string | null;
  previewProposal: string | null;
  onEdit: (e: Edit) => void;
  onPreviewProposal: (id: string | null) => void;
  /** The Layers list (LayersList), shown above the photo and its edits. */
  layers: ReactNode;
  layerCount: number;
}): React.JSX.Element {
  const { presets } = useApp();
  const imp = useImporter();
  const [menu, setMenu] = useState(false);
  const menuBtn = useRef<HTMLButtonElement | null>(null);
  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [libOpen, setLibOpen] = useState(true);
  const [confirmEl, confirm] = useConfirm();
  const library = useLive(() => api.images({ limit: 60 }), ['images'], [], 800);
  const all = d.stack.filter((e) => e.state === 'active');
  // The photo's own edits; layers are listed above them.
  const active = all.filter((e) => e.kind !== 'layer');
  const recipes = presets.filter((p) => p.kind === 'recipe');

  const apply = (preset: string): void => {
    setMenu(false);
    api.applyEdits(d.id, { preset }).catch((err: unknown) => toast.error(errMessage(err)));
  };
  const reset = async (): Promise<void> => {
    setMenu(false);
    if (!(await confirm('Every edit is removed in one step; Undo brings them back.', 'Back to the original?', 'Remove edits'))) return;
    api.reset(d.id).catch((err: unknown) => toast.error(errMessage(err)));
  };
  const drop = (to: number): void => {
    const id = dragging;
    setDragging(null);
    if (id === null) return;
    const from = active.findIndex((e) => e.id === id);
    if (from < 0 || from === to) return;
    // Positions count every edit in the stack (layers too).
    const fromAll = all.findIndex((e) => e.id === id);
    const target = active[to];
    const toAll = target !== undefined ? all.indexOf(target) : all.length;
    api.moveEdit(id, toAll > fromAll ? toAll - 1 : toAll).catch((err: unknown) => toast.error(errMessage(err)));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-[var(--iu-hair)] pl-3 pr-1.5">
        <h2 className="text-[12px] font-bold text-[var(--iu-ink-2)]">Layers</h2>
        {layerCount > 0 && <span className="num rounded-[3px] bg-[var(--iu-row)] px-1 text-[12px] leading-4 text-[var(--iu-muted)]">{layerCount}</span>}
        <span className="flex-1" />
        <div className="relative">
          <button ref={menuBtn} type="button" aria-label="Edits menu" title="Recipes and more" onClick={() => setMenu((m) => !m)} className="flex size-7 items-center justify-center rounded-[var(--iu-r)] text-[var(--iu-ink-2)] hover:bg-[var(--iu-row)]">
            <Ellipsis size={15} aria-hidden />
          </button>
          <Popover open={menu} onClose={() => setMenu(false)} keep={menuBtn} className="left-[calc(100%+8px)] top-0 z-50 w-60">
            {recipes.length > 0 && <p className="px-2 pb-0.5 pt-1 text-[12px] font-semibold text-[var(--iu-muted)]">Apply a recipe</p>}
            {recipes.map((r) => (
              <button key={r.id} type="button" className={menuItem} onClick={() => apply(r.id)} title={r.description}>
                <Wand size={14} aria-hidden /> <span className="min-w-0 truncate">{r.name}</span>
              </button>
            ))}
            <div className="my-1 border-t border-[var(--iu-hair)]" />
            <button
              type="button"
              className={menuItem}
              disabled={all.length === 0}
              onClick={() => {
                setMenu(false);
                setSaving(true);
              }}
            >
              <Save size={14} aria-hidden /> Save the edits as a recipe
            </button>
            <button
              type="button"
              className={menuItem}
              disabled={all.length === 0}
              onClick={() => {
                setMenu(false);
                setCopying(true);
              }}
            >
              <Copy size={14} aria-hidden /> Copy the edits to other images
            </button>
            <button type="button" className={menuItem} disabled={all.length === 0} onClick={() => void reset()}>
              <RotateCcw size={14} aria-hidden /> Back to the original
            </button>
          </Popover>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
        {d.proposals
          .filter((p) => p.kind === 'edits')
          .map((p) => (
            <ProposalCard key={p.id} p={p} edits={d.stack.filter((e) => e.proposal === p.id)} previewing={previewProposal === p.id} onPreview={(on) => onPreviewProposal(on ? p.id : null)} />
          ))}
        {layers}
        <div className="mt-1.5 flex h-8 items-center gap-1.5 border-t border-[var(--iu-hair)] px-2 pt-1 text-[12px]">
          <ImageIcon size={14} aria-hidden className="shrink-0 text-[var(--iu-ink-2)]" />
          <span className="font-semibold">Photo</span>
          <span className="num min-w-0 truncate text-[var(--iu-muted)]">
            {d.format} · {fmtDims(d.width, d.height)} · {bytes(d.bytes)}
          </span>
        </div>
        <div className="flex flex-col gap-px px-1" onDragEnd={() => setDragOver(null)}>
          {active.map((e, i) => (
            <EditRow key={e.id} e={e} index={i} active={activeEdit === e.id} onOpen={() => onEdit(e)} onDragStart={() => setDragging(e.id)} onDrop={drop} dragOver={dragging !== null && dragging !== e.id ? dragOver : null} setDragOver={setDragOver} />
          ))}
          {dragging !== null && (
            <div
              onDragOver={(ev) => {
                ev.preventDefault();
                setDragOver(active.length);
              }}
              onDrop={(ev) => {
                ev.preventDefault();
                setDragOver(null);
                drop(active.length);
              }}
              className={cn('h-6 rounded-[var(--iu-r-sm)] border border-dashed', dragOver === active.length ? 'border-[var(--iu-ink)]' : 'border-transparent')}
            />
          )}
        </div>
        {active.length === 0 && <p className="px-3 py-1 text-[12px] leading-4 text-[var(--iu-muted)]">No photo edits. Crop, resize, adjust and cut out from the toolbar; the original is never touched.</p>}
        {active.length > 0 && (
          <p className="num flex items-center gap-1.5 px-3 pt-2 text-[12px] text-[var(--iu-muted)]">
            Result <span className="font-semibold text-[var(--iu-ink-2)]">{fmtDims(d.out_width, d.out_height)}</span>
          </p>
        )}
      </div>

      <section className={cn('flex shrink-0 flex-col border-t border-[var(--iu-line)]', libOpen && 'max-h-[42%] min-h-[150px]')}>
        <div className="flex h-8 shrink-0 items-center gap-1 pl-1.5 pr-1.5">
          <button type="button" onClick={() => setLibOpen((o) => !o)} aria-expanded={libOpen} className="flex h-6 min-w-0 flex-1 items-center gap-1 rounded-[var(--iu-r-sm)] px-1 text-left hover:bg-[var(--iu-row)]">
            {libOpen ? <ChevronDown size={12} aria-hidden className="text-[var(--iu-muted)]" /> : <ChevronRight size={12} aria-hidden className="text-[var(--iu-muted)]" />}
            <span className="text-[12px] font-bold text-[var(--iu-ink-2)]">Library</span>
            {library.data !== null && <span className="num rounded-[3px] bg-[var(--iu-row)] px-1 text-[12px] leading-4 text-[var(--iu-muted)]">{library.data.total}</span>}
          </button>
          <IconButton icon={Plus} size={22} label="Import images" onClick={() => imp.open()} />
        </div>
        {libOpen && (
          <div className="grid min-h-0 grid-cols-3 gap-1 overflow-y-auto px-1.5 pb-1.5">
            {(library.data?.images ?? []).map((i) => (
              <button key={i.id} type="button" title={i.name + ' · ' + fmtDims(i.out_width, i.out_height)} onClick={() => i.id !== d.id && navigate('image', { id: i.id })} className={cn('relative overflow-hidden rounded-[var(--iu-r-sm)] border-2', i.id === d.id ? 'border-[var(--iu-ink)]' : 'border-transparent hover:border-[var(--iu-line)]')}>
                <Thumb image={i} fit="cover" className="aspect-square" />
                {i.edits_count > 0 && <span aria-hidden className="absolute bottom-0.5 right-0.5 size-1.5 rounded-full bg-[var(--iu-accent)] ring-1 ring-[var(--iu-card)]" />}
              </button>
            ))}
          </div>
        )}
      </section>

      <SaveRecipe image={d.id} open={saving} onClose={() => setSaving(false)} />
      {copying && <CopyEdits d={d} open={copying} onClose={() => setCopying(false)} />}
      {confirmEl}
    </div>
  );
}
