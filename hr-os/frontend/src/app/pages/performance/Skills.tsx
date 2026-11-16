/**
 * Skills: the team skills matrix on the measuring-grid canvas (people by
 * library skills; each cell the level as five small marks, a check when a
 * manager verified it, and the level the job title expects, with gaps in
 * amber). Click a cell to set your level, or as a manager to verify it. The
 * library tab lists the skills, adds several at once, and sets the level
 * each job title expects.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { BadgeCheck, Download, Grid3x3, Library, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button, Checkbox, DataTable, Dialog, Empty, Field, IconButton, Input, LinkButton, LoadError, Loading, PageBody, PageHeader, Picker, Popover, Segmented, Tabs, Tag, Textarea, toast } from '../../components/ui.tsx';
import type { Column } from '../../components/ui.tsx';
import type { Matrix, MatrixCell, SkillLib } from '../../components/performance/types.ts';
import { READS } from '../../components/performance/types.ts';
import { op, saveText } from '../../lib/api.ts';
import { can, isManager, useMe } from '../../lib/auth.tsx';
import type { PageProps } from '../../lib/contract.ts';
import { t, tn } from '../../lib/i18n.ts';
import { changed, useOp } from '../../lib/live.ts';
import { setQuery } from '../../lib/router.ts';
import { cn } from '../../../kit/index.ts';

type Scope = 'team' | 'department' | 'all' | 'me';

export function SkillsPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const hr = can(me, 'performance', 'view');
  const edit = can(me, 'performance', 'edit');
  const tab = query.get('tab') === 'library' ? 'library' : 'matrix';
  const scopes: { value: Scope; label: string }[] = [];
  if (isManager(me)) scopes.push({ value: 'team', label: t('perf.skills.team') });
  if (me.employee !== null) scopes.push({ value: 'department', label: t('perf.skills.department') });
  if (hr) scopes.push({ value: 'all', label: t('perf.skills.everyone') });
  if (me.employee !== null) scopes.push({ value: 'me', label: t('perf.skills.me') });
  const scope = ((query.get('scope') as Scope | null) ?? (hr ? 'all' : scopes[0]?.value) ?? 'me') as Scope;
  const category = query.get('category') ?? '';
  const matrix = useOp<Matrix>('skills.matrix', { scope, category: category === '' ? undefined : category, all_skills: scope === 'me' ? true : undefined, limit: 300 }, [...READS.skills, 'job_records'], { name: 'perf.skills.matrix', skip: tab !== 'matrix' });
  const lib = useOp<{ skills: SkillLib[]; categories: { name: string; count: number }[]; unlisted: { name: string; people: number }[]; can_edit: boolean }>('skills.list', {}, READS.skills, { name: 'perf.skills.lib' });
  const [addOpen, setAddOpen] = useState(false);
  const [mineOpen, setMineOpen] = useState(false);
  const cats = lib.data?.categories ?? [];

  const exportCsv = async (): Promise<void> => {
    try {
      const r = await op<{ csv: string; filename: string }>('skills.export', { scope, category: category === '' ? undefined : category });
      saveText(r.csv, r.filename);
    } catch {
      /* toast shown */
    }
  };
  return (
    <>
      <PageHeader title={t('perf.skills.title')} meta={matrix.data !== null ? [tn('perf.skills.people_n', matrix.data.total), tn('perf.skills.skills_n', matrix.data.library_size)].join(' · ') : ''}>
        {edit && (
          <Button icon={Plus} onClick={() => setAddOpen(true)}>
            {t('perf.skills.add_library')}
          </Button>
        )}
        {me.employee !== null && (
          <Button variant="primary" icon={Plus} onClick={() => setMineOpen(true)}>
            {t('perf.skills.add_mine')}
          </Button>
        )}
      </PageHeader>
      <PageBody>
        <Tabs
          value={tab}
          onChange={(v) => setQuery({ tab: v === 'matrix' ? undefined : v })}
          label={t('perf.skills.title')}
          className="mb-3"
          tabs={[
            { value: 'matrix', label: t('perf.skills.matrix'), icon: Grid3x3 },
            { value: 'library', label: t('perf.skills.library'), icon: Library, count: lib.data?.unlisted.length ?? 0 },
          ]}
        />
        {tab === 'matrix' ? (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {scopes.length > 1 && <Segmented value={scope} onChange={(v) => setQuery({ scope: v })} options={scopes} label={t('perf.skills.whose')} size="sm" />}
              {cats.length > 1 && <Picker value={category} onChange={(v) => setQuery({ category: v === '' ? undefined : v })} items={cats.map((c) => ({ value: c.name, label: c.name, sub: String(c.count) }))} label={t('perf.skills.category')} placeholder={t('perf.skills.any_category')} clearable className="w-[180px]" />}
              <span className="flex-1" />
              <Legend />
              <Button size="sm" variant="ghost" icon={Download} onClick={() => void exportCsv()}>
                {t('ui.export')}
              </Button>
            </div>
            {matrix.data === null ? (
              matrix.error !== null ? (
                <LoadError message={matrix.error} onRetry={matrix.reload} />
              ) : (
                <Loading />
              )
            ) : matrix.data.library_size === 0 ? (
              <Empty icon={Library} title={t('perf.skills.no_library')} action={edit ? <Button icon={Plus} onClick={() => setAddOpen(true)}>{t('perf.skills.add_library')}</Button> : undefined}>
                {edit ? t('perf.skills.no_library_hr') : t('perf.skills.no_library_text')}
              </Empty>
            ) : matrix.data.skills.length === 0 ? (
              <Empty icon={Grid3x3} title={t('perf.skills.no_cells')} action={me.employee !== null ? <Button icon={Plus} onClick={() => setMineOpen(true)}>{t('perf.skills.add_mine')}</Button> : undefined}>
                {t('perf.skills.no_cells_text')}
              </Empty>
            ) : (
              <MatrixGrid m={matrix.data} />
            )}
          </>
        ) : (
          <LibraryTab data={lib.data} error={lib.error} reload={lib.reload} canEdit={edit} onAdd={() => setAddOpen(true)} />
        )}
      </PageBody>
      <AddLibraryDialog open={addOpen} onClose={() => setAddOpen(false)} categories={cats.map((c) => c.name)} />
      <MySkillDialog open={mineOpen} onClose={() => setMineOpen(false)} library={lib.data?.skills ?? []} employee={me.employee?.id ?? ''} />
    </>
  );
}

function Legend(): React.JSX.Element {
  return (
    <span className="hr-label hidden items-center gap-3 md:flex">
      <span className="flex items-center gap-1">
        <Marks level={3} /> {t('perf.skills.level')}
      </span>
      <span className="flex items-center gap-1">
        <BadgeCheck size={12} aria-hidden /> {t('perf.skills.verified')}
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block size-2 rounded-[1px] border border-[var(--hr-warn)]" /> {t('perf.skills.expected')}
      </span>
    </span>
  );
}

function Marks({ level, expected }: { level: number; expected?: number | undefined }): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-[2px]" aria-hidden>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={cn('size-2 rounded-[1px]', i <= level ? 'bg-[var(--hr-ink-2)]' : 'bg-[var(--hr-line)]', expected !== undefined && i === expected && i > level && 'bg-transparent ring-1 ring-inset ring-[var(--hr-warn)]', expected !== undefined && i === expected && i <= level && 'ring-1 ring-offset-1 ring-[var(--hr-ink-2)] ring-offset-[var(--hr-raised)]')} />
      ))}
    </span>
  );
}

function MatrixGrid({ m }: { m: Matrix }): React.JSX.Element {
  const [open, setOpen] = useState<{ person: string; skill: string } | null>(null);
  const cols = `var(--perf-first) repeat(${m.skills.length}, minmax(84px,1fr))`;
  return (
    <div className="hr-panel hr-grid hr-in hr-scroll overflow-x-auto p-2">
      <div role="grid" aria-label={t('perf.skills.matrix')} className="min-w-max [--perf-first:132px] sm:[--perf-first:minmax(180px,220px)]" style={{ display: 'grid', gridTemplateColumns: cols }}>
        <div role="columnheader" className="sticky left-0 z-[2] flex h-10 items-end bg-[var(--hr-sunk)] px-2 pb-1.5">
          <span className="hr-label">{t('perf.skills.person')}</span>
        </div>
        {m.skills.map((s) => (
          <div key={s.id} role="columnheader" title={[s.name, s.description].filter((x) => x !== '').join(': ')} className="flex h-10 flex-col justify-end px-1.5 pb-1.5">
            <span className="truncate text-[12px] font-medium">{s.name}</span>
            <span className="hr-label hr-num truncate">
              {s.holders > 0 ? `${s.holders} · ${s.avg_level}` : t('perf.skills.nobody')}
            </span>
          </div>
        ))}
        {m.people.map((p) => (
          <div key={p.employee.id} role="row" className="contents">
            <div role="rowheader" className="sticky left-0 z-[1] flex min-h-10 items-center gap-2 border-t border-[var(--hr-hair)] bg-[var(--hr-sunk)] px-2">
              <a href={`#/people/${p.employee.number}`} className="hr-focus hit min-w-0 flex-1 rounded-[3px]">
                <span className="hr-link block truncate text-[12px] font-medium">{p.employee.name}</span>
                <span className="block truncate text-[12px] text-[var(--hr-muted)]">{p.employee.title}</span>
              </a>
              {p.gaps > 0 && <Tag tone="warn" title={t('perf.skills.gaps', { n: p.gaps })}>{p.gaps}</Tag>}
            </div>
            {m.skills.map((s) => (
              <CellButton key={s.id} cell={p.cells[s.id]} skill={s} row={p} open={open?.person === p.employee.id && open.skill === s.id} onOpen={() => setOpen({ person: p.employee.id, skill: s.id })} onClose={() => setOpen(null)} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function CellButton({ cell, skill, row, open, onOpen, onClose }: { cell: MatrixCell | undefined; skill: Matrix['skills'][number]; row: Matrix['people'][number]; open: boolean; onOpen: () => void; onClose: () => void }): React.JSX.Element {
  const ref = useRef<HTMLButtonElement | null>(null);
  const level = cell?.level ?? 0;
  const gap = cell?.expected !== undefined && level < cell.expected;
  const editable = row.can_edit || row.can_verify;
  const set = async (params: Record<string, unknown>): Promise<void> => {
    try {
      await op('employee-skills.set', { employee: row.employee.id, skill: skill.name, ...params });
      changed(...READS.skills);
    } catch {
      /* toast shown */
    }
  };
  const remove = async (): Promise<void> => {
    if (cell === undefined || cell.entry === '') return;
    try {
      await op('employee-skills.remove', { skill: cell.entry });
      changed(...READS.skills);
      onClose();
    } catch {
      /* toast shown */
    }
  };
  return (
    <>
      <button
        ref={ref}
        type="button"
        role="gridcell"
        disabled={!editable}
        onClick={onOpen}
        aria-label={`${row.employee.name}, ${skill.name}: ${level > 0 ? t('perf.skills.level_n', { n: level }) : t('perf.skills.not_set')}${cell?.verified === true ? `, ${t('perf.skills.verified')}` : ''}`}
        className={cn('hr-focus flex min-h-10 items-center justify-center gap-1.5 border-t border-[var(--hr-hair)] px-1.5 transition-colors disabled:cursor-default', editable && 'hover:bg-[var(--hr-hover)]', gap && 'bg-[var(--hr-warn-soft)]')}
      >
        {level > 0 || cell?.expected !== undefined ? <Marks level={level} expected={cell?.expected} /> : <span className="text-[12px] text-[var(--hr-faint)]">{editable ? '+' : ''}</span>}
        {cell?.verified === true && <BadgeCheck size={12} aria-hidden className="text-[var(--hr-ink-2)]" />}
      </button>
      <Popover anchor={ref} open={open} onClose={onClose} width={250} label={skill.name} className="p-2.5">
        <div className="flex flex-col gap-2">
          <div className="text-[12px] font-medium">
            {skill.name} · {row.employee.name}
          </div>
          {row.can_edit && (
            <div role="radiogroup" aria-label={t('perf.skills.level')} className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" role="radio" aria-checked={level === n} title={skill.levels[n - 1] ?? ''} onClick={() => void set({ level: n })} className={cn('hr-focus hit hr-mono flex h-8 flex-1 items-center justify-center rounded-[var(--hr-radius-sm)] border text-[12px] transition-colors', level === n ? 'border-[var(--hr-ink)] bg-[var(--hr-ink)] text-[var(--hr-on-ink)]' : 'border-[var(--hr-line)] bg-[var(--hr-raised)] hover:bg-[var(--hr-hover)]')}>
                  {n}
                </button>
              ))}
            </div>
          )}
          {level > 0 && skill.levels[level - 1] !== undefined && skill.levels[level - 1] !== '' && <div className="text-[12px] text-[var(--hr-muted)]">{skill.levels[level - 1]}</div>}
          {cell?.expected !== undefined && <div className="text-[12px] text-[var(--hr-warn)]">{t('perf.skills.expects', { n: cell.expected })}</div>}
          {row.can_verify && level > 0 && <Checkbox checked={cell?.verified === true} onChange={(v) => void set({ verified: v })} label={t('perf.skills.verify')} />}
          {row.can_edit && level > 0 && (
            <LinkButton tone="danger" onClick={() => void remove()} className="h-6 self-start">
              {t('perf.skills.remove')}
            </LinkButton>
          )}
        </div>
      </Popover>
    </>
  );
}

function LibraryTab({ data, error, reload, canEdit, onAdd }: { data: { skills: SkillLib[]; unlisted: { name: string; people: number }[] } | null; error: string | null; reload: () => void; canEdit: boolean; onAdd: () => void }): React.JSX.Element {
  const [edit, setEdit] = useState<SkillLib | null>(null);
  const cols: Column<SkillLib>[] = useMemo(
    () => [
      { key: 'name', label: t('perf.skills.skill'), width: 'minmax(180px,2fr)', phone: 'title', sort: (s) => s.name, render: (s) => <span className="min-w-0"><span className="block truncate font-medium">{s.name}</span>{s.description !== '' && <span className="block truncate text-[12px] text-[var(--hr-muted)]">{s.description}</span>}</span> },
      { key: 'category', label: t('perf.skills.category'), width: 'minmax(120px,1fr)', sort: (s) => s.category, render: (s) => s.category },
      { key: 'people', label: t('perf.skills.holders'), width: '90px', mono: true, align: 'right', sort: (s) => s.people ?? 0, render: (s) => s.people ?? 0 },
      { key: 'avg', label: t('perf.skills.avg'), width: '80px', mono: true, align: 'right', hideBelow: 'lg', phone: 'hide', sort: (s) => s.avg_level ?? 0, render: (s) => ((s.avg_level ?? 0) > 0 ? s.avg_level : '') },
      { key: 'expected', label: t('perf.skills.expected_by'), width: 'minmax(140px,1.4fr)', hideBelow: 'xl', phone: 'hide', render: (s) => <span className="truncate text-[12px] text-[var(--hr-muted)]">{s.expected.map((x) => `${x.job_title_name} ${x.level}`).join(', ')}</span> },
      { key: 'edit', label: '', width: '48px', phone: 'end', render: (s) => (canEdit ? <IconButton icon={Pencil} label={t('ui.edit')} size={26} onClick={() => setEdit(s)} /> : null) },
    ],
    [canEdit],
  );
  if (data === null) return error !== null ? <LoadError message={error} onRetry={reload} /> : <Loading />;
  const add = async (name: string): Promise<void> => {
    try {
      await op('skills.add', { name });
      changed(...READS.skills);
      toast.success(t('perf.skills.added_one', { name }));
    } catch {
      /* toast shown */
    }
  };
  return (
    <div className="flex flex-col gap-3">
      {canEdit && data.unlisted.length > 0 && (
        <div className="hr-panel hr-in p-3.5">
          <div className="hr-label mb-2">{t('perf.skills.unlisted')}</div>
          <div className="flex flex-wrap gap-1.5">
            {data.unlisted.map((u) => (
              <button key={u.name} type="button" onClick={() => void add(u.name)} className="hr-focus hit inline-flex h-7 items-center gap-1.5 rounded-[var(--hr-radius-sm)] border border-dashed border-[var(--hr-line-2)] px-2 text-[12px] hover:bg-[var(--hr-hover)]">
                <Plus size={12} aria-hidden /> {u.name} <span className="hr-mono text-[12px] text-[var(--hr-muted)]">{u.people}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="hr-panel hr-in min-w-0">
        <DataTable label={t('perf.skills.library')} columns={cols} rows={data.skills} rowKey={(s) => s.id} empty={<Empty icon={Library} title={t('perf.skills.no_library')} action={canEdit ? <Button icon={Plus} onClick={onAdd}>{t('perf.skills.add_library')}</Button> : undefined} />} />
      </div>
      <EditSkillDialog skill={edit} onClose={() => setEdit(null)} />
    </div>
  );
}

function AddLibraryDialog({ open, onClose, categories }: { open: boolean; onClose: () => void; categories: string[] }): React.JSX.Element | null {
  const [names, setNames] = useState('');
  const [category, setCategory] = useState('');
  const [busy, setBusy] = useState(false);
  if (!open) return null;
  const list = names
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter((x) => x !== '');
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await op<{ skills: unknown[] }>('skills.add', { names: list, category });
      changed(...READS.skills);
      toast.success(tn('perf.skills.added', r.skills.length));
      setNames('');
      onClose();
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title={t('perf.skills.add_library')} footer={<><Button onClick={onClose}>{t('ui.cancel')}</Button><Button variant="primary" busy={busy} disabled={list.length === 0} onClick={() => void save()}>{tn('perf.skills.add_n', list.length)}</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label={t('perf.skills.names')} hint={t('perf.skills.names_hint')}>
          <Textarea value={names} autoFocus onChange={(e) => setNames(e.target.value)} minRows={3} placeholder="TypeScript, SQL, Negotiation" />
        </Field>
        <Field label={t('perf.skills.category')} optional>
          <Input value={category} onChange={(e) => setCategory(e.target.value)} list="perf-skill-cats" maxLength={80} />
          <datalist id="perf-skill-cats">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
      </div>
    </Dialog>
  );
}

function EditSkillDialog({ skill, onClose }: { skill: SkillLib | null; onClose: () => void }): React.JSX.Element | null {
  const titles = useOp<{ titles: { id: string; name: string }[] }>('titles.list', {}, ['job_titles'], { skip: skill === null });
  const [state, setState] = useState<{ id: string; name: string; category: string; description: string; levels: string[]; expected: { job_title: string; level: number }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (skill !== null) setState({ id: skill.id, name: skill.name, category: skill.category, description: skill.description, levels: [0, 1, 2, 3, 4].map((i) => skill.levels[i] ?? ''), expected: skill.expected.map((x) => ({ job_title: x.job_title, level: x.level })) });
  }, [skill]);
  if (skill === null || state === null || state.id !== skill.id) return null;
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await op('skills.update', { skill: skill.id, ...(state.name !== skill.name ? { name: state.name } : {}), category: state.category, description: state.description, levels: state.levels, expected: state.expected });
      changed(...READS.skills);
      toast.success(t('perf.skills.saved'));
      onClose();
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  const archive = async (): Promise<void> => {
    try {
      await op('skills.update', { skill: skill.id, archived: true });
      changed(...READS.skills);
      onClose();
    } catch {
      /* toast shown */
    }
  };
  const titleItems = (titles.data?.titles ?? []).filter((x) => !state.expected.some((e) => e.job_title === x.id)).map((x) => ({ value: x.id, label: x.name }));
  return (
    <Dialog open onClose={onClose} width={560} title={t('perf.skills.edit', { name: skill.name })} footer={<><LinkButton className="h-6" tone="danger" onClick={() => void archive()}>{t('perf.skills.archive')}</LinkButton><span className="flex-1" /><Button onClick={onClose}>{t('ui.cancel')}</Button><Button variant="primary" busy={busy} onClick={() => void save()}>{t('ui.save')}</Button></>}>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('perf.skills.skill')} hint={(skill.people ?? 0) > 0 ? t('perf.skills.name_fixed') : undefined}>
            <Input value={state.name} disabled={(skill.people ?? 0) > 0} onChange={(e) => setState({ ...state, name: e.target.value })} />
          </Field>
          <Field label={t('perf.skills.category')} optional>
            <Input value={state.category} onChange={(e) => setState({ ...state, category: e.target.value })} />
          </Field>
        </div>
        <Field label={t('perf.skills.description')} optional>
          <Input value={state.description} onChange={(e) => setState({ ...state, description: e.target.value })} />
        </Field>
        <Field label={t('perf.skills.levels')} optional help={t('perf.skills.levels_help')}>
          <div className="flex flex-col gap-1.5">
            {state.levels.map((l, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="hr-mono w-4 text-[12px] text-[var(--hr-muted)]">{i + 1}</span>
                <Input value={l} onChange={(e) => setState({ ...state, levels: state.levels.map((x, j) => (j === i ? e.target.value : x)) })} />
              </div>
            ))}
          </div>
        </Field>
        <Field label={t('perf.skills.expected_by')} optional>
          <div className="flex flex-col gap-1.5">
            {state.expected.map((e, i) => (
              <div key={e.job_title} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[13px]">{titles.data?.titles.find((x) => x.id === e.job_title)?.name ?? e.job_title}</span>
                <Segmented value={String(e.level)} onChange={(v) => setState({ ...state, expected: state.expected.map((x, j) => (j === i ? { ...x, level: Number(v) } : x)) })} label={t('perf.skills.level')} size="sm" options={['1', '2', '3', '4', '5'].map((n) => ({ value: n, label: n }))} />
                <IconButton icon={Trash2} label={t('ui.remove')} size={26} onClick={() => setState({ ...state, expected: state.expected.filter((_, j) => j !== i) })} />
              </div>
            ))}
            {titleItems.length > 0 && <Picker value="" onChange={(v) => v !== '' && setState({ ...state, expected: [...state.expected, { job_title: v, level: 3 }] })} items={titleItems} label={t('perf.skills.add_title')} placeholder={t('perf.skills.add_title')} />}
          </div>
        </Field>
      </div>
    </Dialog>
  );
}

function MySkillDialog({ open, onClose, library, employee }: { open: boolean; onClose: () => void; library: SkillLib[]; employee: string }): React.JSX.Element | null {
  const [skill, setSkill] = useState('');
  const [level, setLevel] = useState('3');
  const [busy, setBusy] = useState(false);
  if (!open) return null;
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await op('employee-skills.set', { employee, skill, level: Number(level) });
      changed(...READS.skills);
      toast.success(t('perf.skills.mine_added', { name: skill }));
      setSkill('');
      onClose();
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  const lib = library.filter((s) => !s.archived);
  const chosen = lib.find((s) => s.name === skill);
  return (
    <Dialog open={open} onClose={onClose} title={t('perf.skills.add_mine')} footer={<><Button onClick={onClose}>{t('ui.cancel')}</Button><Button variant="primary" busy={busy} disabled={skill.trim() === ''} onClick={() => void save()}>{t('ui.add')}</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label={t('perf.skills.skill')}>
          {lib.length > 0 ? <Picker value={skill} onChange={(v) => setSkill(v)} items={lib.map((s) => ({ value: s.name, label: s.name, sub: s.category }))} label={t('perf.skills.skill')} /> : <Input value={skill} onChange={(e) => setSkill(e.target.value)} />}
        </Field>
        <Field label={t('perf.skills.level')} hint={chosen?.levels[Number(level) - 1] ?? undefined}>
          <Segmented value={level} onChange={setLevel} label={t('perf.skills.level')} options={['1', '2', '3', '4', '5'].map((n) => ({ value: n, label: n }))} />
        </Field>
      </div>
    </Dialog>
  );
}
