/**
 * Settings, Pipelines: each pipeline's stages with their stall days (drag
 * a row to reorder, rename in place; every change saves at once through
 * pipelines.save), the other pipelines (SPV, Fund raise, Program) added on
 * first use, and the note templates (sections and the stages they open for).
 */
import { useEffect, useRef, useState } from 'react';
import { Archive, GripVertical, NotebookPen, Plus, Trash2 } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { Button, ChipPicker, Field, IconButton, Input, LoadError, Menu, MenuItem, Panel, Row, Segmented, Sheet, SheetHeader, Skeleton, SubHeader, Tag, Tip, Toggle } from '../ui.tsx';
import { op } from '../../lib/api.ts';
import { act, useOp } from '../../lib/live.ts';
import type { Pipeline, Stage, Template } from './types.ts';

const KINDS: { key: Pipeline['kind']; name: string }[] = [
  { key: 'spv', name: 'SPV' },
  { key: 'lp_raise', name: 'Fund raise' },
  { key: 'program', name: 'Program' },
];
const READS = ['pipelines', 'deals'];

function StagesEditor({ pipeline }: { pipeline: Pipeline }): React.JSX.Element {
  const [rows, setRows] = useState<Stage[]>(pipeline.stages);
  const [dragging, setDragging] = useState(-1);
  // A reload never overwrites a row being edited.
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setRows(pipeline.stages);
  }, [pipeline.stages]);
  const save = async (next: Stage[]): Promise<void> => {
    editing.current = false;
    setRows(next);
    const out = await act([], () => op('pipelines.save', { pipeline: pipeline.key, stages: next.map((s) => ({ key: s.key === '' ? undefined : s.key, label: s.label.trim(), stall_days: s.stall_days })) }), READS);
    if (out === null) setRows(pipeline.stages);
  };
  const edit = (i: number, patch: Partial<Stage>): void => {
    editing.current = true;
    setRows((r) => r.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  };
  const commit = (): void => {
    if (JSON.stringify(rows) !== JSON.stringify(pipeline.stages) && rows.every((s) => s.label.trim() !== '')) void save(rows);
    else editing.current = false;
  };
  return (
    <Panel flush>
      <div className="grid h-8 grid-cols-[28px_minmax(0,1fr)_96px_36px] items-center gap-2 border-b border-[var(--vo-hair)] px-3 text-[12px] text-[var(--vo-muted)]">
        <span />
        <span>Stage</span>
        <Tip text="A deal stalls after this many days in the stage (0 never stalls)">
          <span>Stall days</span>
        </Tip>
        <span />
      </div>
      <ol>
        {rows.map((s, i) => (
          <li
            key={s.key || 'new' + i}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move';
              setDragging(i);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              if (dragging < 0 || dragging === i) return;
              setRows((r) => {
                const n = [...r];
                const [m] = n.splice(dragging, 1);
                if (m !== undefined) n.splice(i, 0, m);
                return n;
              });
              setDragging(i);
            }}
            onDragEnd={() => {
              setDragging(-1);
              commit();
            }}
            className={cn('grid h-10 grid-cols-[28px_minmax(0,1fr)_96px_36px] items-center gap-2 border-b border-[var(--vo-hair)] px-3 last:border-b-0', dragging === i && 'bg-[var(--vo-hover)]')}
          >
            <GripVertical size={15} aria-label="Drag to reorder" className="cursor-grab text-[var(--vo-muted)]" />
            <Input aria-label="Stage name" value={s.label} onChange={(e) => edit(i, { label: e.target.value })} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} className="h-8 border-transparent bg-transparent px-1.5 shadow-none hover:border-[var(--vo-line)]" />
            <Input aria-label="Stall days" inputMode="numeric" value={String(s.stall_days)} onChange={(e) => edit(i, { stall_days: Math.max(0, Math.min(365, Number(e.target.value.replace(/\D/g, '')) || 0)) })} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} className="vo-mono h-8 border-transparent bg-transparent px-1.5 text-right shadow-none hover:border-[var(--vo-line)]" />
            <IconButton icon={Trash2} label="Remove stage" size={28} disabled={rows.length <= 2} onClick={() => void save(rows.filter((_, j) => j !== i))} />
          </li>
        ))}
      </ol>
      <div className="flex h-10 items-center px-2">
        <Button size="sm" variant="ghost" icon={Plus} disabled={rows.length >= 12} onClick={() => void save([...rows, { key: '', label: 'New stage', stall_days: 7 }])}>
          Stage
        </Button>
      </div>
    </Panel>
  );
}

function TemplateSheet({ tpl, stages, onClose }: { tpl: Template | null; stages: Stage[]; onClose: () => void }): React.JSX.Element {
  const [name, setName] = useState(tpl?.name ?? '');
  const [sections, setSections] = useState<{ key: string; label: string }[]>(tpl?.sections ?? [{ key: '', label: 'Notes' }]);
  const [on, setOn] = useState<string[]>(tpl?.stages ?? []);
  const [archived, setArchived] = useState(tpl?.archived ?? false);
  const [busy, setBusy] = useState(false);
  const save = async (): Promise<void> => {
    setBusy(true);
    const out = await act([], () => op('notes.template-save', { template: tpl?.key, name: name.trim(), sections: sections.filter((s) => s.label.trim() !== '').map((s) => (s.key !== '' ? { key: s.key, label: s.label.trim() } : s.label.trim())), stages: on, archived: tpl === null ? undefined : archived }), ['note_templates']);
    setBusy(false);
    if (out !== null) onClose();
  };
  return (
    <Sheet open onClose={onClose} label="Note template" width={480}>
      <SheetHeader
        title={tpl?.name ?? 'New template'}
        onClose={onClose}
        actions={
          <Button variant="primary" busy={busy} disabled={name.trim() === '' || sections.every((s) => s.label.trim() === '')} onClick={() => void save()}>
            Save
          </Button>
        }
      />
      <div className="vo-scroll flex flex-1 flex-col gap-5 overflow-y-auto p-5">
        <Field label="Name">
          <Input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} autoFocus={tpl === null} />
        </Field>
        <Field label="Sections">
          <ol className="flex flex-col gap-1.5">
            {sections.map((s, i) => (
              <li key={i} className="flex items-center gap-2">
                <Input aria-label="Section" value={s.label} onChange={(e) => setSections((x) => x.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)))} />
                <IconButton icon={Trash2} label="Remove section" size={28} disabled={sections.length <= 1} onClick={() => setSections((x) => x.filter((_, j) => j !== i))} />
              </li>
            ))}
          </ol>
          <Button size="sm" variant="ghost" icon={Plus} className="mt-1.5 self-start" disabled={sections.length >= 12} onClick={() => setSections((x) => [...x, { key: '', label: '' }])}>
            Section
          </Button>
        </Field>
        <Field label="Opens at" tip="A new note on a deal at these stages starts in this template">
          <ChipPicker multiple label="Opens at" options={stages.map((s) => ({ value: s.key, label: s.label }))} value={on} onChange={setOn} />
        </Field>
        {tpl !== null && (
          <Row label="Archived">
            <Toggle label="Archived" checked={archived} onChange={setArchived} />
          </Row>
        )}
      </div>
    </Sheet>
  );
}

function Templates({ stages }: { stages: Stage[] }): React.JSX.Element {
  const live = useOp<{ templates: Template[] }>('notes.templates', {}, ['note_templates'], { name: 'notes.templates' });
  const [open, setOpen] = useState<Template | null | 'new'>(null);
  return (
    <>
      <SubHeader title="Note templates">
        <Button icon={Plus} onClick={() => setOpen('new')}>
          Template
        </Button>
      </SubHeader>
      {live.data === null ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <Panel flush>
          <ul>
            {live.data.templates.map((t) => (
              <li key={t.id} className="border-b border-[var(--vo-hair)] last:border-b-0">
                <button type="button" onClick={() => setOpen(t)} className="vo-focus vo-tap flex h-10 w-full min-w-0 items-center gap-3 px-4 text-left transition-colors duration-150 hover:bg-[var(--vo-hover)]">
                  <NotebookPen size={14} aria-hidden className="shrink-0 text-[var(--vo-muted)]" />
                  <span className="w-36 shrink-0 truncate text-[13px] font-medium">{t.name}</span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--vo-muted)]">{t.sections.map((s) => s.label).join(', ')}</span>
                  {t.archived && (
                    <Tag tone="faint" icon={Archive}>
                      Archived
                    </Tag>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {open !== null && <TemplateSheet tpl={open === 'new' ? null : open} stages={stages} onClose={() => setOpen(null)} />}
    </>
  );
}

export function PipelinesSettings(): React.JSX.Element {
  const live = useOp<{ pipelines: Pipeline[] }>('pipelines.list', {}, READS, { name: 'pipelines.list' });
  const [key, setKey] = useState('deal_flow');
  const list = live.data?.pipelines ?? [];
  const cur = list.find((p) => p.key === key) ?? list[0] ?? null;
  const missing = KINDS.filter((k) => !list.some((p) => p.key === k.key));
  const flow = list.find((p) => p.key === 'deal_flow') ?? null;
  const add = async (k: Pipeline['kind']): Promise<void> => {
    const out = await act([], () => op('pipelines.save', { pipeline: k }), READS);
    if (out !== null) setKey(k);
  };
  return (
    <>
      <SubHeader title="Pipelines">
        {missing.length > 0 && (
          <Menu label="Add pipeline" trigger="button" width={200}>
            {(close) =>
              missing.map((k) => (
                <MenuItem
                  key={k.key}
                  onClick={() => {
                    close();
                    void add(k.key);
                  }}
                >
                  {k.name}
                </MenuItem>
              ))
            }
          </Menu>
        )}
      </SubHeader>
      {live.error !== null && live.data === null ? (
        <LoadError message={live.error} onRetry={live.reload} />
      ) : cur === null ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          {list.length > 1 && <Segmented label="Pipeline" value={cur.key} onChange={setKey} options={list.map((p) => ({ value: p.key, label: p.name, count: p.open }))} />}
          <StagesEditor key={cur.key} pipeline={cur} />
        </>
      )}
      <Templates stages={flow?.stages ?? []} />
    </>
  );
}
