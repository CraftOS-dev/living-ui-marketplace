/**
 * Customers: Attio-style rows (identity chip, medium name, muted meta,
 * tinted stage pill, relative follow-up, hover-only actions) plus a
 * pipeline board with per-column count and value rollups. Stage tone is
 * derived STRUCTURALLY from pipeline position, never from the label text.
 */
import { useState } from 'react';
import { KanbanSquare, List, Plus, Users } from 'lucide-react';
import {
  Button,
  Dialog,
  EntityForm,
  SearchInput,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  getPbClient,
  useCollection,
  useConfirm,
  cn,
} from '../../kit/index.ts';
import type { EntityField } from '../../kit/index.ts';
import { callOp } from '../lib/ops.ts';
import type { Company, Customer, Vocab } from '../lib/types.ts';
import {
  DeleteButton,
  EditButton,
  ExportMenu,
  GhostBoard,
  GhostState,
  IdentityChip,
  ListRow,
  PageHeader,
  Pill,
  RelDate,
  fmtMoney,
  type Tone,
} from '../components/ui.tsx';
import { downloadCsv, escapeHtml, printDocument, reportMasthead, stampedName } from '../lib/export.ts';

function customerFields(vocab: Vocab): EntityField[] {
  return [
    { name: 'name', type: 'text', required: true },
    {
      name: 'pipeline_stage',
      label: 'Stage',
      type: 'select',
      options: vocab.pipeline.map((s) => ({ value: s, label: s })),
    },
    { name: 'email', type: 'text' },
    { name: 'phone', type: 'text' },
    { name: 'follow_up', label: 'Follow up on', type: 'date' },
    { name: 'value', label: 'Value (what they are worth to you)', type: 'number' },
    { name: 'is_org', label: 'This is a business, not a person', type: 'boolean' },
    { name: 'note', type: 'textarea' },
  ];
}

/** Position-based tone: first = new (info), last = out (neutral),
 *  second-to-last = the good place, everything between = in motion. */
function stageTone(stage: string, pipeline: string[]): Tone {
  const idx = pipeline.indexOf(stage);
  if (idx < 0) return 'neutral';
  if (idx === pipeline.length - 1) return 'neutral';
  if (idx === pipeline.length - 2) return 'good';
  if (idx === 0) return 'info';
  return 'warn';
}

const BOARD_DOT: Record<Tone, string> = {
  info: 'bg-sky-500',
  warn: 'bg-amber-500',
  good: 'bg-emerald-500',
  neutral: 'bg-[var(--lui-muted)]/60',
  bad: 'bg-red-500',
  accent: 'bg-[var(--lui-accent)]',
};

export function CustomersPage({ company, vocab }: { company: Company; vocab: Vocab }): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [confirmEl, confirm] = useConfirm();
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const { records: all } = useCollection<Customer>('customers', { sort: '-created' });

  const fields = customerFields(vocab);
  const firstStage = vocab.pipeline[0] ?? 'Lead';

  const q = query.toLowerCase();
  const filtered =
    q === ''
      ? all
      : all.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            c.email.toLowerCase().includes(q) ||
            c.note.toLowerCase().includes(q),
        );

  const stageOf = (c: Customer): string => (c.pipeline_stage !== '' ? c.pipeline_stage : firstStage);

  /* ---------- Exports ---------- */
  const exportContactsCsv = (): void => {
    const rows = all.map((c) => [
      c.name,
      c.is_org ? 'Business' : 'Person',
      stageOf(c),
      c.email,
      c.phone,
      c.value || '',
      c.follow_up !== '' ? c.follow_up.slice(0, 10) : '',
      c.note,
    ]);
    downloadCsv(
      stampedName(`${company.name}-${vocab.customer_many}`, 'csv'),
      ['Name', 'Type', 'Stage', 'Email', 'Phone', 'Value', 'Follow up', 'Note'],
      rows,
    );
  };

  const exportPipelineSummary = (): void => {
    const stageRows = vocab.pipeline
      .map((stage) => {
        const inStage = all.filter((c) => stageOf(c) === stage);
        const value = inStage.reduce((s, c) => s + (c.value || 0), 0);
        return `<tr><td>${escapeHtml(stage)}</td><td class="num">${inStage.length}</td><td class="num">${fmtMoney(value)}</td></tr>`;
      })
      .join('');
    const totalValue = all.reduce((s, c) => s + (c.value || 0), 0);
    const many = vocab.customer_many;
    const body =
      reportMasthead(company.name, `${many} — Pipeline Summary`) +
      `<div class="kpis">
        <div class="kpi"><div class="label">Total ${escapeHtml(many.toLowerCase())}</div><div class="value">${all.length}</div></div>
        <div class="kpi"><div class="label">Total pipeline value</div><div class="value">${fmtMoney(totalValue)}</div></div>
      </div>` +
      `<h2>By stage</h2><table><thead><tr><th>Stage</th><th class="num">Count</th><th class="num">Value</th></tr></thead><tbody>${stageRows}<tr class="total"><td>All</td><td class="num">${all.length}</td><td class="num">${fmtMoney(totalValue)}</td></tr></tbody></table>` +
      `<p class="foot">Generated by Company OS.</p>`;
    printDocument(`${company.name} — ${many} Pipeline Summary`, body);
  };

  const openEdit = (c: Customer | null): void => {
    setEditing(c);
    setFormOpen(true);
  };

  const remove = async (c: Customer): Promise<void> => {
    if (!(await confirm(`Delete ${vocab.customer_one.toLowerCase()} "${c.name}"?`))) return;
    await getPbClient()
      .call((pb) => pb.collection('customers').delete(c.id))
      .catch(() => undefined);
  };

  /** Drag a card to another pipeline column: persist the new stage. */
  const moveToStage = async (id: string, stage: string): Promise<void> => {
    const cust = all.find((c) => c.id === id);
    if (cust === undefined || stageOf(cust) === stage) return;
    await getPbClient()
      .call((pb) => pb.collection('customers').update(id, { pipeline_stage: stage }))
      .catch(() => undefined);
  };

  const endDrag = (): void => {
    setDragId(null);
    setDragOverStage(null);
  };

  const onSaved = async (): Promise<void> => {
    setFormOpen(false);
    await callOp('/api/ops/journey-autocheck').catch(() => undefined);
    await callOp('/api/ops/stage-recompute').catch(() => undefined);
  };

  const addButton = (
    <Button size="sm" onClick={() => openEdit(null)}>
      <Plus size={14} aria-hidden />
      Add {vocab.customer_one.toLowerCase()}
    </Button>
  );

  return (
    <div>
      <PageHeader
        icon={Users}
        title={vocab.customer_many}
        meta={String(all.length)}
        actions={
          <>
            <ExportMenu
              disabled={all.length === 0}
              items={[
                { label: 'Contacts (CSV)', icon: <List size={14} aria-hidden />, onSelect: exportContactsCsv },
                { label: 'Pipeline summary (PDF)', icon: <KanbanSquare size={14} aria-hidden />, onSelect: exportPipelineSummary },
              ]}
            />
            {addButton}
          </>
        }
      />

      {all.length === 0 ? (
        <GhostState
          icon={Users}
          title={`No ${vocab.customer_many.toLowerCase()} yet`}
          message={`This is your pipeline. Add your first ${vocab.customer_one.toLowerCase()} and it lands here — the matching Journey step completes on its own the moment you do.`}
          action={addButton}
        >
          <GhostBoard columns={vocab.pipeline} />
        </GhostState>
      ) : (
        <Tabs defaultValue="list">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <TabsList>
              <TabsTrigger value="list" className="inline-flex items-center gap-1.5">
                <List size={14} aria-hidden />
                List
              </TabsTrigger>
              <TabsTrigger value="board" className="inline-flex items-center gap-1.5">
                <KanbanSquare size={14} aria-hidden />
                Pipeline
              </TabsTrigger>
            </TabsList>
            <SearchInput onSearch={setQuery} placeholder={`Search ${vocab.customer_many.toLowerCase()}…`} />
          </div>

          <TabsContent value="list">
            <div className="border border-[var(--lui-border)] bg-[var(--lui-surface)]">
              {filtered.length === 0 ? (
                <p className="px-4 py-10 text-center text-[13px] text-[var(--lui-muted)]">
                  No {vocab.customer_many.toLowerCase()} match your search.
                </p>
              ) : (
                filtered.map((c) => (
                  <ListRow
                    key={c.id}
                    leading={<IdentityChip name={c.name} square={c.is_org} />}
                    primary={c.name}
                    secondary={c.note !== '' ? c.note : c.email}
                    trailing={
                      <>
                        {c.value > 0 && (
                          <span className="hidden text-xs tabular-nums text-[var(--lui-muted)] sm:inline">
                            {fmtMoney(c.value)}
                          </span>
                        )}
                        <RelDate iso={c.follow_up} className="hidden w-16 text-right sm:inline-block" />
                        <Pill tone={stageTone(stageOf(c), vocab.pipeline)}>{stageOf(c)}</Pill>
                      </>
                    }
                    hoverActions={
                      <>
                        <EditButton onClick={() => openEdit(c)} />
                        <DeleteButton onClick={() => void remove(c)} />
                      </>
                    }
                    onClick={() => openEdit(c)}
                  />
                ))
              )}
            </div>
          </TabsContent>

          <TabsContent value="board">
            <div className="grid gap-3 overflow-x-auto md:grid-cols-3 lg:grid-cols-5">
              {vocab.pipeline.map((stage) => {
                const inStage = filtered.filter((c) => stageOf(c) === stage);
                const total = inStage.reduce((sum, c) => sum + c.value, 0);
                const tone = stageTone(stage, vocab.pipeline);
                const isDropTarget = dragId !== null && dragOverStage === stage;
                return (
                  <div
                    key={stage}
                    onDragOver={(e) => {
                      if (dragId === null) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      if (dragOverStage !== stage) setDragOverStage(stage);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const id = e.dataTransfer.getData('text/plain') || dragId;
                      if (id) void moveToStage(id, stage);
                      endDrag();
                    }}
                    className={cn(
                      'border bg-[var(--lui-surface)] transition-colors',
                      isDropTarget ? 'border-[var(--lui-accent)] bg-[var(--lui-accent)]/[0.04]' : 'border-[var(--lui-border)]',
                    )}
                  >
                    <div className="flex items-center justify-between border-b border-[var(--lui-border)] px-3 py-2">
                      <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider">
                        <span aria-hidden className={cn('inline-block size-1.5 rounded-full', BOARD_DOT[tone])} />
                        {stage}
                        <span className="font-normal tabular-nums text-[var(--lui-muted)]">{inStage.length}</span>
                      </span>
                      {total > 0 && (
                        <span className="text-[10px] tabular-nums text-[var(--lui-muted)]">{fmtMoney(total)}</span>
                      )}
                    </div>
                    <div className="flex min-h-20 flex-col gap-1.5 p-2">
                      {inStage.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          draggable
                          onDragStart={(e) => {
                            setDragId(c.id);
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('text/plain', c.id);
                          }}
                          onDragEnd={endDrag}
                          className={cn(
                            'flex w-full cursor-grab flex-col gap-1 border border-[var(--lui-border)] bg-[var(--lui-bg)]/50 px-3 py-2 text-left transition-colors hover:border-[var(--lui-muted)]/50 active:cursor-grabbing',
                            dragId === c.id && 'opacity-40',
                          )}
                          onClick={() => openEdit(c)}
                        >
                          <span className="flex w-full items-center gap-2">
                            <IdentityChip name={c.name} size="sm" square={c.is_org} />
                            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{c.name}</span>
                          </span>
                          <span className="flex w-full items-center justify-between text-[11px] text-[var(--lui-muted)]">
                            <span className="tabular-nums">{c.value > 0 ? fmtMoney(c.value) : ''}</span>
                            <RelDate iso={c.follow_up} />
                          </span>
                        </button>
                      ))}
                      {isDropTarget && inStage.length === 0 && (
                        <div className="flex min-h-14 items-center justify-center border border-dashed border-[var(--lui-accent)]/60 text-[11px] text-[var(--lui-accent)]">
                          Drop here
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </TabsContent>
        </Tabs>
      )}

      {confirmEl}

      <Dialog
        open={formOpen}
        onOpenChange={setFormOpen}
        title={
          editing !== null
            ? `Edit ${vocab.customer_one.toLowerCase()}`
            : `Add ${vocab.customer_one.toLowerCase()}`
        }
      >
        <EntityForm
          collection="customers"
          fields={fields}
          {...(editing !== null ? { initial: editing } : { defaults: { pipeline_stage: firstStage } })}
          onSaved={() => void onSaved()}
          onCancel={() => setFormOpen(false)}
        />
      </Dialog>
    </div>
  );
}
