/**
 * Checklist templates: the list by kind (onboarding, offboarding, custom)
 * with an inline "+" per kind, and the editor of one template: a plain list
 * of tasks to drag into order, each with who does it, when (days before or
 * after the first or last day) and what kind it is, plus an inline "+".
 * Changes save on their own a moment after typing stops.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, GripVertical, ListChecks, MoreHorizontal, Plus, Star, Trash2, Wand2, X } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { Button, Empty, IconButton, Input, Textarea, LoadError, Menu, MenuItem, MenuSep, Notice, PageBody, PageHeader, Picker, Segmented, Tag, confirmAsk, toast } from '../../components/ui.tsx';
import { kindName, LabeledToggle, LANE_ICON, laneName, SkeletonRows, useEntityItems, useMemberItems } from '../../components/lifecycle/bits.tsx';
import type { ChecklistKind, ChecklistTemplate, Lane, TaskKind, TemplateTask } from '../../components/lifecycle/types.ts';
import { errMessage, op } from '../../lib/api.ts';
import { can, useMe } from '../../lib/auth.tsx';
import type { PageProps } from '../../lib/contract.ts';
import { t, tn } from '../../lib/i18n.ts';
import { changed, useOp } from '../../lib/live.ts';
import { setQuery } from '../../lib/router.ts';

const KINDS: ChecklistKind[] = ['onboarding', 'offboarding', 'custom'];
const LANES: Lane[] = ['hr', 'manager', 'it', 'employee', 'agent'];

function whenText(n: number): string {
  if (n === 0) return t('lifecycle.on_the_day');
  return n < 0 ? tn('lifecycle.days_before', -n) : tn('lifecycle.days_after', n);
}

function anchorName(kind: ChecklistKind): string {
  return t(kind === 'offboarding' ? 'lifecycle.anchor.last' : kind === 'onboarding' ? 'lifecycle.anchor.first' : 'lifecycle.anchor.start');
}

let seq = 0;
function rowKey(): string {
  seq++;
  return 'k' + Date.now().toString(36) + seq;
}

interface Row extends TemplateTask {
  rid: string;
}

function TemplateEditor({ tpl, canEdit, onGone }: { tpl: ChecklistTemplate; canEdit: boolean; onGone: () => void }): React.JSX.Element {
  const me = useMe();
  const entities = useEntityItems();
  const members = useMemberItems(can(me, 'admin', 'view'));
  const [name, setName] = useState(tpl.name);
  const [rows, setRows] = useState<Row[]>(() => tpl.tasks.map((x) => ({ ...x, rid: rowKey() })));
  const [state, setState] = useState<'saved' | 'dirty' | 'saving' | 'error'>('saved');
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState('');
  const [dragging, setDragging] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ name, rows });
  latest.current = { name, rows };

  const save = useCallback(async (): Promise<void> => {
    const cur = latest.current;
    setState('saving');
    try {
      await op('checklist-templates.save', { template: tpl.id, name: cur.name.trim() === '' ? tpl.name : cur.name, tasks: cur.rows.filter((r) => r.title.trim() !== '').map(({ rid: _rid, assignee_label: _al, needs_document: _nd, ...r }) => r) }, { quiet: true });
      setState('saved');
      setErr(null);
      changed('checklist_templates');
    } catch (e) {
      setState('error');
      setErr(errMessage(e));
    }
  }, [tpl.id, tpl.name]);

  const touch = useCallback(() => {
    setState('dirty');
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), 700);
  }, [save]);
  useEffect(
    () => () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        void save();
      }
    },
    [save],
  );

  const setRow = (i: number, patch: Partial<Row>): void => {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    touch();
  };
  const move = (from: number, to: number): void => {
    if (to < 0 || to >= rows.length || from === to) return;
    setRows((rs) => {
      const next = rs.slice();
      const [it] = next.splice(from, 1);
      if (it !== undefined) next.splice(to, 0, it);
      return next;
    });
    touch();
  };
  const addRow = (): void => {
    const title = adding.trim();
    if (title === '') return;
    const last = rows[rows.length - 1];
    setRows((rs) => [...rs, { rid: rowKey(), key: '', title, description: '', assignee: last?.assignee ?? 'hr', due_offset_days: last?.due_offset_days ?? 0, kind: 'task', document_category: '' }]);
    setAdding('');
    touch();
  };
  const setDefault = async (v: boolean): Promise<void> => {
    try {
      await op('checklist-templates.save', { template: tpl.id, is_default: v });
      changed('checklist_templates', 'entities');
      toast.success(v ? t('lifecycle.now_default') : t('ui.saved'));
    } catch {
      /* toast shown */
    }
  };
  const setEntity = async (v: string): Promise<void> => {
    try {
      await op('checklist-templates.save', { template: tpl.id, entity: v });
      changed('checklist_templates');
    } catch {
      /* toast shown */
    }
  };
  const copy = async (): Promise<void> => {
    try {
      const r = await op<{ template: ChecklistTemplate }>('checklist-templates.copy', { template: tpl.id });
      changed('checklist_templates');
      setQuery({ t: r.template.id });
    } catch {
      /* toast shown */
    }
  };
  const archive = async (): Promise<void> => {
    try {
      await op('checklist-templates.save', { template: tpl.id, archived: !tpl.archived, is_default: tpl.archived ? undefined : false });
      changed('checklist_templates');
    } catch {
      /* toast shown */
    }
  };
  const remove = async (): Promise<void> => {
    if (!(await confirmAsk(t('lifecycle.delete_template_text', { name: tpl.name }), t('lifecycle.delete_template')))) return;
    try {
      await op('checklist-templates.delete', { template: tpl.id });
      changed('checklist_templates');
      onGone();
    } catch {
      /* toast shown */
    }
  };
  const assigneeItems = [...LANES.map((l) => ({ value: l, label: laneName(l), icon: LANE_ICON[l] })), ...members.map((m) => ({ value: 'member:' + m.value, label: m.label, sub: m.sub, person: true }))];

  return (
    <section className="hr-panel hr-in flex min-w-0 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-[var(--hr-line)] px-3.5 py-2.5">
        <Input value={name} disabled={!canEdit} onChange={(e) => (setName(e.target.value), touch())} aria-label={t('lifecycle.f.template_name')} className="min-w-[200px] flex-1 !text-[14px] font-semibold" />
        <span className={cn('hr-label w-16 text-right', state === 'error' && '!text-[var(--hr-bad)]')} aria-live="polite">
          {state === 'saving' ? t('lifecycle.saving') : state === 'dirty' ? t('lifecycle.editing') : state === 'error' ? t('lifecycle.not_saved') : t('ui.saved')}
        </span>
        {canEdit && (
          <Menu icon={MoreHorizontal} label={t('lifecycle.template_menu')}>
            {(close) => (
              <>
                <MenuItem icon={Copy} onClick={() => (close(), void copy())}>
                  {t('lifecycle.duplicate')}
                </MenuItem>
                <MenuItem icon={X} onClick={() => (close(), void archive())}>
                  {tpl.archived ? t('lifecycle.restore') : t('lifecycle.archive')}
                </MenuItem>
                {tpl.used === 0 && (
                  <>
                    <MenuSep />
                    <MenuItem icon={Trash2} danger onClick={() => (close(), void remove())}>
                      {t('ui.remove')}
                    </MenuItem>
                  </>
                )}
              </>
            )}
          </Menu>
        )}
      </header>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-[var(--hr-hair)] px-3.5 py-2.5">
        <span className="inline-flex items-center gap-2 text-[13px]">
          <span className="hr-label">{t('lifecycle.f.kind')}</span>
          {kindName(tpl.kind)}
        </span>
        <span className="inline-flex min-w-[220px] items-center gap-2">
          <span className="hr-label">{t('lifecycle.f.entity')}</span>
          <Picker value={tpl.entity} onChange={(v) => void setEntity(v)} items={[{ value: '', label: t('lifecycle.all_entities') }, ...entities]} label={t('lifecycle.f.entity')} disabled={!canEdit} className="min-w-[180px]" />
        </span>
        {tpl.kind !== 'custom' && <LabeledToggle checked={tpl.is_default} onChange={(v) => void setDefault(v)} label={t(tpl.kind === 'offboarding' ? 'lifecycle.use_by_default_off' : 'lifecycle.use_by_default')} disabled={!canEdit || tpl.archived} />}
        <span className="flex-1" />
        <span className="hr-label">{t('lifecycle.used_n', { n: tpl.used })}</span>
      </div>
      {tpl.archived && <Notice className="m-3">{t('lifecycle.archived_note')}</Notice>}
      {err !== null && (
        <Notice tone="bad" className="m-3">
          {err}
        </Notice>
      )}
      <div className="hidden grid-cols-[24px_minmax(0,1fr)_170px_200px_150px_28px] gap-x-2 px-3.5 pt-2.5 md:grid">
        <span />
        <span className="hr-label">{t('lifecycle.f.task_title')}</span>
        <span className="hr-label">{t('lifecycle.f.who')}</span>
        <span className="hr-label truncate">{t('lifecycle.days_from', { anchor: anchorName(tpl.kind) })}</span>
        <span className="hr-label">{t('lifecycle.f.task_kind')}</span>
        <span />
      </div>
      <ol className="flex flex-col px-2 pb-2 pt-1">
        {rows.map((r, i) => (
          <li
            key={r.rid}
            draggable={canEdit}
            onDragStart={(e) => {
              setDragging(i);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(e) => {
              if (dragging === null) return;
              e.preventDefault();
              if (dragging !== i) {
                move(dragging, i);
                setDragging(i);
              }
            }}
            onDragEnd={() => setDragging(null)}
            className={cn('grid grid-cols-[24px_minmax(0,1fr)] items-start gap-x-2 gap-y-1.5 rounded-[var(--hr-radius-sm)] px-1.5 py-1.5 md:grid-cols-[24px_minmax(0,1fr)_170px_200px_150px_28px] md:items-center', dragging === i && 'bg-[var(--hr-hover)]')}
          >
            <button
              type="button"
              disabled={!canEdit}
              aria-label={t('lifecycle.drag_task', { title: r.title })}
              title={t('lifecycle.drag')}
              onKeyDown={(e) => {
                if (e.key === 'ArrowUp') (e.preventDefault(), move(i, i - 1));
                if (e.key === 'ArrowDown') (e.preventDefault(), move(i, i + 1));
              }}
              className="hr-focus flex h-8 w-6 cursor-grab items-center justify-center rounded-[3px] text-[var(--hr-faint)] hover:bg-[var(--hr-hover)] hover:text-[var(--hr-ink-2)] active:cursor-grabbing"
            >
              <GripVertical size={14} aria-hidden />
            </button>
            <Textarea value={r.title} disabled={!canEdit} onChange={(e) => setRow(i, { title: e.target.value.split(String.fromCharCode(10)).join(' ') })} aria-label={t('lifecycle.f.task_title')} minRows={1} maxRows={3} className="!py-1.5" />
            <span className="col-start-2 md:col-start-auto">
              <Picker value={r.assignee} onChange={(v) => setRow(i, { assignee: v })} items={assigneeItems} label={t('lifecycle.f.who')} disabled={!canEdit} />
            </span>
            <span className="col-start-2 flex items-center gap-1.5 md:col-start-auto">
              <Input
                type="number"
                value={String(r.due_offset_days)}
                disabled={!canEdit}
                onChange={(e) => setRow(i, { due_offset_days: Math.max(-365, Math.min(365, Math.round(Number(e.target.value) || 0))) })}
                aria-label={t('lifecycle.f.offset')}
                className="hr-mono w-[68px] text-right"
              />
              <span className="min-w-0 truncate text-[12px] text-[var(--hr-muted)]" title={whenText(r.due_offset_days) + ' ' + anchorName(tpl.kind)}>
                {whenText(r.due_offset_days)}
              </span>
            </span>
            <span className="col-start-2 md:col-start-auto">
              <Segmented
                value={r.kind}
                onChange={(v: TaskKind) => setRow(i, { kind: v })}
                label={t('lifecycle.f.task_kind')}
                size="sm"
                options={[
                  { value: 'task', label: t('lifecycle.tk.task_short') },
                  { value: 'document', label: t('lifecycle.tk.document_short') },
                  { value: 'signature', label: t('lifecycle.tk.signature_short') },
                ]}
              />
            </span>
            {canEdit && <IconButton icon={X} label={t('lifecycle.remove_task', { title: r.title })} size={28} className="col-start-2 justify-self-start md:col-start-auto" onClick={() => (setRows((rs) => rs.filter((_, j) => j !== i)), touch())} />}
          </li>
        ))}
        {canEdit && (
          <li className="grid grid-cols-[24px_minmax(0,1fr)] items-center gap-2 px-1.5 py-1.5">
            <span className="flex h-8 w-6 items-center justify-center text-[var(--hr-faint)]">
              <Plus size={14} aria-hidden />
            </span>
            <Input value={adding} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addRow()} onBlur={addRow} placeholder={t('lifecycle.add_a_task')} aria-label={t('lifecycle.add_a_task')} />
          </li>
        )}
      </ol>
    </section>
  );
}

export function TemplatesPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const canEdit = can(me, 'people', 'edit');
  const live = useOp<{ templates: ChecklistTemplate[] }>('checklist-templates.list', { archived: true }, ['checklist_templates'], { name: 'lifecycle.templates' });
  const entities = useEntityItems();
  const [seeding, setSeeding] = useState(false);
  const list = useMemo(() => live.data?.templates ?? [], [live.data]);
  const selected = query.get('t') ?? KINDS.map((k) => list.find((x) => x.kind === k && !x.archived)).find((x) => x !== undefined)?.id ?? '';
  const tpl = list.find((x) => x.id === selected) ?? null;
  const add = async (kind: ChecklistKind): Promise<void> => {
    try {
      const r = await op<{ template: ChecklistTemplate }>('checklist-templates.save', { kind, name: t(`lifecycle.new_template.${kind}`), tasks: [] });
      changed('checklist_templates');
      setQuery({ t: r.template.id });
    } catch {
      /* toast shown */
    }
  };
  const seedAll = async (): Promise<void> => {
    setSeeding(true);
    try {
      for (const e of entities) await op('checklist-templates.seed', { entity: e.value });
      changed('checklist_templates', 'letter_templates');
      toast.success(t('lifecycle.defaults_added'));
    } catch {
      /* toast shown */
    } finally {
      setSeeding(false);
    }
  };
  return (
    <>
      <PageHeader title={t('lifecycle.templates')} meta={t('lifecycle.templates_meta', { n: list.filter((x) => !x.archived).length })} back="#/lifecycle" />
      <PageBody>
        {live.data === null ? (
          live.error !== null ? (
            <LoadError message={live.error} onRetry={live.reload} />
          ) : (
            <SkeletonRows />
          )
        ) : list.length === 0 ? (
          <div className="hr-panel">
            <Empty icon={ListChecks} title={t('lifecycle.no_templates')} action={canEdit ? <Button variant="primary" icon={Wand2} busy={seeding} onClick={() => void seedAll()}>{t('lifecycle.add_country_defaults')}</Button> : undefined} />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[280px_minmax(0,1fr)]">
            <nav className="hr-panel hr-in flex min-w-0 flex-col self-start py-1" aria-label={t('lifecycle.templates')}>
              {KINDS.map((k) => {
                const items = list.filter((x) => x.kind === k);
                return (
                  <div key={k} className="py-1">
                    <div className="flex h-8 items-center gap-2 px-3">
                      <span className="hr-label flex-1">{kindName(k)}</span>
                      {canEdit && <IconButton icon={Plus} label={t('lifecycle.add_template', { kind: kindName(k) })} size={24} onClick={() => void add(k)} />}
                    </div>
                    {items.map((x) => (
                      <button
                        key={x.id}
                        type="button"
                        onClick={() => setQuery({ t: x.id })}
                        className={cn('hr-focus relative flex w-full min-w-0 cursor-pointer items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--hr-hover)]', x.id === selected && 'bg-[var(--hr-active)] before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:bg-[var(--hr-ink)]', x.archived && 'opacity-60')}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="hr-wrap block text-[13px] font-medium">{x.name}</span>
                          <span className="block truncate text-[12px] text-[var(--hr-muted)]">{[x.entity_name || t('lifecycle.all_entities'), t('lifecycle.n_tasks', { n: x.task_count })].join(' · ')}</span>
                        </span>
                        {x.is_default && <Star size={13} aria-label={t('lifecycle.default')} className="shrink-0 fill-[var(--hr-ink)] text-[var(--hr-ink)]" />}
                        {x.archived && <Tag tone="faint">{t('lifecycle.archived')}</Tag>}
                      </button>
                    ))}
                  </div>
                );
              })}
            </nav>
            {tpl !== null ? <TemplateEditor key={tpl.id} tpl={tpl} canEdit={canEdit} onGone={() => setQuery({ t: undefined })} /> : <div className="hr-panel"><Empty icon={ListChecks} title={t('lifecycle.pick_template_left')} /></div>}
          </div>
        )}
      </PageBody>
    </>
  );
}
