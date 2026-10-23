/**
 * An experiment's runs and results, as sections of its page.
 *
 *   Runs     the sheet: one row per trial, sample, participant or simulation;
 *            click a cell to type (Enter goes down, Tab across, Esc cancels);
 *            Plan runs (every combination of levels times replicates), paste
 *            or upload CSV, export
 *   Results  per measure, n, mean, SD, min and max by group with a chart of
 *            every value; group by any conditions (the others pool as
 *            replicates); compare to a reference group (difference and
 *            percent change); counts for categories and yes/no
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ClipboardPaste, Download, FileSpreadsheet, Plus, Shuffle, Target, Trash2 } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { download, op } from '../../lib/api.ts';
import { changed, useLive } from '../../lib/live.ts';
import { num, plural } from '../../lib/format.ts';
import type { ExpResults, ExpRun, ExpVariable, Experiment, RunStatus, RunValue } from '../../lib/types.ts';
import { Button, Empty, IconButton, LoadError, Modal, Segmented, Select, Skeleton, inputCls, textareaCls, useConfirm } from '../ui.tsx';
import { fmt, RUN_STATUS, shownValue } from './shared.tsx';

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const ro = new ResizeObserver((en) => setW(Math.floor(en[0]?.contentRect.width ?? 0)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/* ------------------------------------------------------------------ runs */

type Cell = { run: string; col: string };

export function RunsSection({ e, runs, onRuns, reload }: { e: Experiment; runs: ExpRun[] | null; onRuns: (fn: (rs: ExpRun[]) => ExpRun[]) => void; reload: () => void }): React.JSX.Element {
  const [filter, setFilter] = useState<'all' | RunStatus>('all');
  const [cell, setCell] = useState<Cell | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [confirmNode, confirm] = useConfirm();
  const vars = e.variables.filter((v) => v.role !== 'constant');
  const conds = vars.filter((v) => v.role === 'condition');
  const measures = vars.filter((v) => v.role === 'measure');
  const cols = [...vars.map((v) => v.id), 'note'];
  const shown = (runs ?? []).filter((r) => filter === 'all' || r.status === filter);
  const count = (s: RunStatus): number => (runs ?? []).filter((r) => r.status === s).length;
  const noLevels = conds.every((c) => (c.levels ?? []).length === 0);

  const commit = (r: ExpRun, col: string, raw: string): void => {
    const v = vars.find((x) => x.id === col);
    const params = col === 'note' ? (raw === r.note ? null : { run: r.id, note: raw }) : v === undefined || raw.trim() === shownValue(v, r.values[col]) ? null : { run: r.id, values: { [v.id]: raw.trim() } };
    if (params === null) return;
    if (col === 'note') onRuns((rs) => rs.map((x) => (x.id === r.id ? { ...x, note: raw } : x)));
    void op<{ run: ExpRun }>('exp.update-run', params)
      .then((res) => {
        onRuns((rs) => rs.map((x) => (x.id === res.run.id ? res.run : x)));
        changed('exp_runs', 'experiments');
      })
      .catch(reload);
  };
  const move = (from: Cell, dRow: number, dCol: number): void => {
    const i = shown.findIndex((r) => r.id === from.run);
    let j = cols.indexOf(from.col) + dCol;
    let ni = i + dRow;
    if (j >= cols.length) {
      j = 0;
      ni = i + 1;
    } else if (j < 0) {
      j = cols.length - 1;
      ni = i - 1;
    }
    const target = shown[ni];
    const col = cols[j];
    setCell(target !== undefined && col !== undefined ? { run: target.id, col } : null);
  };
  const setStatus = (r: ExpRun, st: RunStatus): void => {
    onRuns((rs) => rs.map((x) => (x.id === r.id ? { ...x, status: st } : x)));
    void op('exp.update-run', { run: r.id, status: st })
      .then(() => changed('exp_runs', 'experiments'))
      .catch(reload);
  };
  const addRun = async (): Promise<void> => {
    try {
      const res = await op<{ runs: ExpRun[] }>('exp.add-runs', { experiment: e.id, runs: [{ values: {} }] });
      const r = res.runs[0];
      if (r !== undefined) {
        onRuns((rs) => [...rs, r]);
        setFilter('all');
        const first = cols[0];
        if (first !== undefined) setCell({ run: r.id, col: first });
      }
      changed('exp_runs', 'experiments', 'exp_log');
    } catch {
      /* toasted */
    }
  };
  const removeRun = async (r: ExpRun): Promise<void> => {
    if (!(await confirm(`Remove run ${r.code}? Activity can bring it back.`, 'Remove run', 'Remove'))) return;
    onRuns((rs) => rs.filter((x) => x.id !== r.id));
    try {
      await op('exp.delete-runs', { runs: r.id });
      changed('exp_runs', 'experiments');
    } catch {
      reload();
    }
  };
  const exportCsv = async (): Promise<void> => {
    const res = await op<{ filename: string; content: string }>('exp.export', { experiment: e.id });
    download(res.filename, res.content, 'text/csv;charset=utf-8');
  };

  if (vars.length === 0)
    return (
      <p className="rounded-[var(--ro-r)] border border-dashed border-[var(--ro-line)] px-4 py-5 text-center text-[12px] text-[var(--ro-muted)]">
        Add what you vary and what you measure under Design; each becomes a column here.
      </p>
    );
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {(runs?.length ?? 0) > 0 && (
          <Segmented
            label="Show"
            size="sm"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'All ' + (runs?.length ?? 0) },
              { value: 'planned', label: 'Planned ' + count('planned') },
              { value: 'done', label: 'Done ' + count('done') },
              { value: 'failed', label: 'Failed ' + count('failed') },
              { value: 'excluded', label: 'Excluded ' + count('excluded') },
            ]}
          />
        )}
        <span className="flex-1" />
        <Button size="sm" icon={Shuffle} onClick={() => setPlanOpen(true)} disabled={noLevels} title={noLevels ? 'Give the varied conditions their levels under Design first' : 'One run for every combination of levels'}>
          Plan runs
        </Button>
        <Button size="sm" icon={ClipboardPaste} onClick={() => setPasteOpen(true)}>
          Paste CSV
        </Button>
        <IconButton icon={Download} label="Export runs (CSV)" size={28} variant="secondary" disabled={(runs?.length ?? 0) === 0} onClick={() => void exportCsv()} />
        <Button size="sm" variant="primary" icon={Plus} onClick={() => void addRun()}>
          Add run
        </Button>
      </div>
      {runs === null ? (
        <div className="flex flex-col gap-1">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-8" />
          ))}
        </div>
      ) : runs.length === 0 ? (
        <div className="rounded-[var(--ro-r)] border border-dashed border-[var(--ro-line)] py-6">
          <Empty compact icon={FileSpreadsheet} title="No runs yet">
            A run is one trial, sample, participant or simulation. Plan them from the levels, add them one by one, or paste a spreadsheet.
          </Empty>
        </div>
      ) : (
        <div data-scroll className="max-h-[520px] overflow-auto rounded-[var(--ro-r)] border border-[var(--ro-line)]">
          <table className="w-max min-w-full border-separate border-spacing-0 text-[13px]">
            <thead className="sticky top-0 z-10 bg-[var(--ro-card)]">
              <tr className="text-left text-[12px] text-[var(--ro-muted)]">
                <th className="h-6 border-b border-[var(--ro-hair)] px-3" />
                {conds.length > 0 && (
                  <th colSpan={conds.length} className="h-6 border-b border-l border-[var(--ro-hair)] bg-[var(--ro-row)] px-2 font-bold uppercase tracking-[0.12em]">
                    Varied
                  </th>
                )}
                {measures.length > 0 && (
                  <th colSpan={measures.length} className="h-6 border-b border-l border-[var(--ro-hair)] px-2 font-bold uppercase tracking-[0.12em]">
                    Measured
                  </th>
                )}
                <th colSpan={3} className="h-6 border-b border-l border-[var(--ro-hair)]" />
              </tr>
              <tr className="text-left text-[12px]">
                <th className="h-8 w-14 border-b border-[var(--ro-line)] px-3 font-semibold text-[var(--ro-muted)]">Run</th>
                {vars.map((v, i) => (
                  <th key={v.id} className={cn('h-8 min-w-28 border-b border-[var(--ro-line)] px-2 font-semibold', v.role === 'condition' && 'bg-[var(--ro-row)]', (i === 0 || (v.role === 'measure' && vars[i - 1]?.role === 'condition')) && 'border-l border-l-[var(--ro-hair)]')}>
                    {v.name}
                    {v.unit !== '' && <span className="font-normal text-[var(--ro-muted)]"> ({v.unit})</span>}
                  </th>
                ))}
                <th className="h-8 w-28 border-b border-l border-[var(--ro-line)] border-l-[var(--ro-hair)] px-2 font-semibold text-[var(--ro-muted)]">Status</th>
                <th className="h-8 min-w-48 border-b border-[var(--ro-line)] px-2 font-semibold text-[var(--ro-muted)]">Note</th>
                <th className="h-8 w-10 border-b border-[var(--ro-line)]" />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} id={'run-' + r.id} className={cn('group', r.status === 'excluded' && 'text-[var(--ro-muted)]')}>
                  <td className="num h-8 border-b border-[var(--ro-hair)] px-3 text-[12px] font-semibold text-[var(--ro-muted)]">{r.code}</td>
                  {vars.map((v, i) => (
                    <SheetCell
                      key={v.id}
                      v={v}
                      value={r.values[v.id]}
                      editing={cell?.run === r.id && cell.col === v.id}
                      onEdit={() => setCell({ run: r.id, col: v.id })}
                      onDone={(raw, go) => {
                        if (raw !== null) commit(r, v.id, raw);
                        if (go === null) setCell(null);
                        else move({ run: r.id, col: v.id }, go[0], go[1]);
                      }}
                      className={cn(v.role === 'condition' && 'bg-[var(--ro-row)]', (i === 0 || (v.role === 'measure' && vars[i - 1]?.role === 'condition')) && 'border-l border-l-[var(--ro-hair)]')}
                    />
                  ))}
                  <td className="h-8 border-b border-l border-[var(--ro-hair)] px-1">
                    <span className="flex items-center gap-1.5 px-1">
                      <span className="size-2 shrink-0 rounded-full" style={{ background: RUN_STATUS[r.status].dot }} />
                      <select value={r.status} onChange={(ev) => setStatus(r, ev.target.value as RunStatus)} aria-label={'Status of ' + r.code} className="h-7 min-w-0 flex-1 cursor-pointer bg-transparent pr-1 text-[12px] font-semibold outline-none">
                        {(Object.keys(RUN_STATUS) as RunStatus[]).map((s) => (
                          <option key={s} value={s}>
                            {RUN_STATUS[s].label}
                          </option>
                        ))}
                      </select>
                    </span>
                  </td>
                  <SheetCell
                    v={null}
                    value={r.note}
                    editing={cell?.run === r.id && cell.col === 'note'}
                    onEdit={() => setCell({ run: r.id, col: 'note' })}
                    onDone={(raw, go) => {
                      if (raw !== null) commit(r, 'note', raw);
                      if (go === null) setCell(null);
                      else move({ run: r.id, col: 'note' }, go[0], go[1]);
                    }}
                    className="text-[12px] text-[var(--ro-ink-2)]"
                  />
                  <td className="h-8 border-b border-[var(--ro-hair)] px-1">
                    <span className="opacity-0 group-hover:opacity-100">
                      <IconButton icon={Trash2} label={'Remove ' + r.code} size={24} variant="danger" onClick={() => void removeRun(r)} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" onClick={() => void addRun()} className="flex h-9 w-full items-center gap-1.5 px-3 text-left text-[13px] text-[var(--ro-muted)] hover:bg-[var(--ro-row)] hover:text-[var(--ro-ink)]">
            <Plus size={14} /> Add a run
          </button>
        </div>
      )}
      <PlanRuns e={e} open={planOpen} onClose={() => setPlanOpen(false)} existing={runs?.length ?? 0} />
      <PasteRuns e={e} open={pasteOpen} onClose={() => setPasteOpen(false)} />
      {confirmNode}
    </div>
  );
}

/** One cell of the sheet: shows the value; while edited, a fresh editor starts from the value it has now. */
function SheetCell({ v, value, editing, onEdit, onDone, className }: { v: ExpVariable | null; value: RunValue | string | undefined; editing: boolean; onEdit: () => void; onDone: (raw: string | null, go: [number, number] | null) => void; className?: string }): React.JSX.Element {
  const text = v === null ? String(value ?? '') : shownValue(v, value as RunValue | undefined);
  return (
    <td className={cn('h-8 border-b border-[var(--ro-hair)] p-0', className)}>
      {editing ? (
        <CellEditor v={v} initial={text} onDone={onDone} />
      ) : (
        <button type="button" onClick={onEdit} className={cn('num flex h-8 w-full items-center px-2 text-left hover:bg-[var(--ro-row-hover)]', v?.type === 'number' && 'justify-end')}>
          {text !== '' ? <span className="truncate">{text}</span> : <span className="text-[var(--ro-line)]">·</span>}
        </button>
      )}
    </td>
  );
}

/** The input (or menu, for categories and yes/no) of a cell being edited: Enter goes down, Tab across, Esc cancels. */
function CellEditor({ v, initial, onDone }: { v: ExpVariable | null; initial: string; onDone: (raw: string | null, go: [number, number] | null) => void }): React.JSX.Element {
  const [draft, setDraft] = useState(initial);
  const done = useRef(false);
  const finish = (raw: string | null, go: [number, number] | null): void => {
    if (done.current) return;
    done.current = true;
    onDone(raw, go);
  };
  const keys = (ev: React.KeyboardEvent): void => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      finish(draft, [ev.shiftKey ? -1 : 1, 0]);
    } else if (ev.key === 'Tab') {
      ev.preventDefault();
      finish(draft, [0, ev.shiftKey ? -1 : 1]);
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      finish(null, null);
    }
  };
  const choices = v !== null && (v.type === 'yesno' ? ['Yes', 'No'] : v.type === 'category' ? (v.role === 'condition' ? v.levels ?? [] : v.options ?? []) : null);
  return choices ? (
    <select
      autoFocus
      value={draft}
      onChange={(ev) => {
        setDraft(ev.target.value);
        finish(ev.target.value, [1, 0]);
      }}
      onKeyDown={keys}
      onBlur={() => finish(draft, null)}
      aria-label={v?.name}
      className="h-8 w-full cursor-pointer bg-[var(--ro-card)] px-2 text-[13px] outline outline-2 -outline-offset-2 outline-[var(--ro-ink)]"
    >
      <option value="">(none)</option>
      {choices.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  ) : (
    <input
      autoFocus
      value={draft}
      inputMode={v?.type === 'number' ? 'decimal' : undefined}
      onChange={(ev) => setDraft(ev.target.value)}
      onKeyDown={keys}
      onBlur={() => finish(draft, null)}
      aria-label={v?.name ?? 'Note'}
      className={cn('num h-8 w-full bg-[var(--ro-card)] px-2 text-[13px] outline outline-2 -outline-offset-2 outline-[var(--ro-ink)]', v?.type === 'number' && 'text-right')}
    />
  );
}

function PlanRuns({ e, open, onClose, existing }: { e: Experiment; open: boolean; onClose: () => void; existing: number }): React.JSX.Element {
  const [reps, setReps] = useState('3');
  const [busy, setBusy] = useState(false);
  const conds = e.variables.filter((v) => v.role === 'condition' && (v.levels ?? []).length > 0);
  const combos = conds.reduce((n, v) => n * (v.levels ?? []).length, 1);
  const r = Math.max(1, Math.min(1000, Number(reps) || 1));
  const go = async (): Promise<void> => {
    setBusy(true);
    try {
      await op('exp.plan-runs', { experiment: e.id, replicates: r });
      changed('exp_runs', 'experiments', 'exp_log');
      onClose();
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Plan runs"
      icon={Shuffle}
      description="One planned run for every combination of the varied conditions' levels, repeated for each replicate."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={combos * r > 5000} onClick={() => void go()}>
            Plan {num(combos * r)} runs
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <ul className="flex flex-col gap-1 rounded-[var(--ro-r)] bg-[var(--ro-row)] p-2.5">
          {conds.map((c) => (
            <li key={c.id} className="flex flex-wrap items-baseline gap-2 text-[13px]">
              <span className="font-semibold">{c.name}</span>
              <span className="num text-[12px] text-[var(--ro-muted)]">{(c.levels ?? []).join(', ')}</span>
              <span className="num ml-auto text-[12px] font-semibold">{(c.levels ?? []).length}</span>
            </li>
          ))}
        </ul>
        <label className="flex items-center gap-2 text-[13px]">
          <span className="flex-1 font-semibold">Replicates of each combination</span>
          <input value={reps} onChange={(ev) => setReps(ev.target.value.replace(/\D/g, ''))} inputMode="numeric" aria-label="Replicates" className={cn(inputCls, 'num h-8 w-20 text-right')} />
        </label>
        <p className="num text-[13px]">
          {conds.map((c) => (c.levels ?? []).length).join(' × ')} {r > 1 ? '× ' + r + ' replicates' : ''} = <span className="font-bold">{num(combos * r)} runs</span>
          {existing > 0 && <span className="text-[var(--ro-muted)]">, added to the {num(existing)} already here</span>}
        </p>
        {combos * r > 5000 && <p className="text-[12px] text-[var(--ro-red-text)]">At most 5000 runs at once.</p>}
      </div>
    </Modal>
  );
}

function PasteRuns({ e, open, onClose }: { e: Experiment; open: boolean; onClose: () => void }): React.JSX.Element {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (open) setText('');
  }, [open]);
  const header = e.variables
    .filter((v) => v.role !== 'constant')
    .map((v) => v.name)
    .concat(['Note'])
    .join(',');
  const go = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await op<{ added: number }>('exp.add-runs', { experiment: e.id, csv: text });
      toast.success('Added ' + plural(r.added, 'run'));
      changed('exp_runs', 'experiments', 'exp_log');
      onClose();
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Paste runs"
      icon={ClipboardPaste}
      wide
      description="Paste from a spreadsheet or a CSV file: a first row naming the columns, then one row per run. A run with a measured value counts as done."
      footer={
        <>
          <Button icon={FileSpreadsheet} onClick={() => fileRef.current?.click()}>
            Choose a CSV file
          </Button>
          <span className="flex-1" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={text.trim() === ''} onClick={() => void go()}>
            Add the runs
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <p className="text-[12px] text-[var(--ro-muted)]">
          Columns it knows: <span className="num text-[var(--ro-ink-2)]">{header}</span> (Status is optional; units in brackets are fine).
        </p>
        <textarea autoFocus rows={10} value={text} onChange={(ev) => setText(ev.target.value)} placeholder={header + '\n...'} aria-label="Runs as CSV" className={cn(textareaCls, 'num text-[12px]')} />
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/plain"
          className="hidden"
          onChange={(ev) => {
            const f = ev.target.files?.[0];
            if (f !== undefined) void f.text().then(setText);
            ev.target.value = '';
          }}
        />
      </div>
    </Modal>
  );
}

/* --------------------------------------------------------------- results */

const SERIES = ['var(--ro-pc-blue)', 'var(--ro-pc-green)', 'var(--ro-pc-amber)', 'var(--ro-pc-red)', 'var(--ro-pc-violet)', 'var(--ro-pc-teal)', 'var(--ro-pc-ink)'];

export function ResultsSection({ e }: { e: Experiment }): React.JSX.Element {
  // Which conditions make the groups (null: all of them); the others pool as replicates.
  const [by, setBy] = useState<string[] | null>(null);
  const [ref, setRef] = useState('');
  const res = useLive((signal) => op<ExpResults>('exp.results', by === null ? { experiment: e.id } : { experiment: e.id, by: by.join(',') }, { quiet: true, signal }), ['exp_runs', 'experiments'], [e.id, by === null ? '*' : by.join(',')], 150);
  const conds = res.data?.conditions ?? [];
  const grouped = by ?? conds.map((c) => c.id);
  const toggle = (id: string): void => {
    setRef('');
    setBy(grouped.indexOf(id) >= 0 ? grouped.filter((x) => x !== id) : conds.map((c) => c.id).filter((x) => x === id || grouped.indexOf(x) >= 0));
  };
  const keys = [...new Set((res.data?.measures ?? []).flatMap((m) => m.groups.filter((g) => g.n > 0).map((g) => g.key)))];
  if (res.error !== null) return <LoadError message={res.error} onRetry={res.reload} />;
  if (res.data === null) return <Skeleton className="h-48" />;
  if (res.data.measures.length === 0)
    return (
      <p className="rounded-[var(--ro-r)] border border-dashed border-[var(--ro-line)] px-4 py-5 text-center text-[12px] text-[var(--ro-muted)]">
        Add what you measure under Design; its results show here once runs are done.
      </p>
    );
  if (e.counts.done === 0)
    return (
      <div className="rounded-[var(--ro-r)] border border-dashed border-[var(--ro-line)] py-6">
        <Empty compact icon={Target} title="No runs done yet">
          Record measured values under Runs; each measure is summed up here by group.
        </Empty>
      </div>
    );
  return (
    <div className="flex flex-col gap-4">
      {(conds.length > 1 || keys.length > 1) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {conds.length > 1 && (
            <>
              <span className="text-[12px] font-semibold text-[var(--ro-ink-2)]">Group by</span>
              {conds.map((c) => (
                <button key={c.id} type="button" aria-pressed={grouped.indexOf(c.id) >= 0} onClick={() => toggle(c.id)} className={cn('inline-flex h-6 items-center rounded-[var(--ro-r-sm)] border px-2 text-[12px] font-semibold', grouped.indexOf(c.id) >= 0 ? 'border-[var(--ro-ink)] bg-[var(--ro-row-hover)] text-[var(--ro-ink)]' : 'border-[var(--ro-line)] text-[var(--ro-muted)] hover:text-[var(--ro-ink)]')}>
                  {c.name}
                </button>
              ))}
              <span className="mr-3 text-[12px] text-[var(--ro-muted)]">{grouped.length < conds.length ? 'the others pool as replicates' : ''}</span>
            </>
          )}
          {keys.length > 1 && (
            <>
              <span className="text-[12px] font-semibold text-[var(--ro-ink-2)]">Compare to</span>
              <Select ariaLabel="Compare to" className="w-48" value={ref} onChange={setRef} options={[{ value: '', label: 'No reference' }, ...keys.map((k) => ({ value: k, label: k || 'All runs' }))]} />
            </>
          )}
        </div>
      )}
      {res.data.measures.map((m) => (
        <MeasureBlock key={m.variable} m={m} grouped={grouped.length} refKey={ref} />
      ))}
    </div>
  );
}

function MeasureBlock({ m, grouped, refKey }: { m: ExpResults['measures'][number]; grouped: number; refKey: string }): React.JSX.Element {
  const groups = m.groups.filter((g) => g.n > 0);
  const numeric = m.type === 'number';
  const values = numeric ? [] : [...new Set(groups.flatMap((g) => Object.keys(g.counts ?? {})))];
  const ref = refKey !== '' ? groups.find((g) => g.key === refKey) : undefined;
  const refMean = ref?.mean ?? null;
  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-baseline gap-2">
        <h3 className="text-[13px] font-bold">{m.name}</h3>
        {m.unit !== '' && <span className="text-[12px] text-[var(--ro-muted)]">{m.unit}</span>}
        <span className="flex-1" />
        <span className="num text-[12px] text-[var(--ro-muted)]">
          {plural(groups.reduce((n, g) => n + g.n, 0), 'value')}
          {grouped > 0 ? ' in ' + plural(groups.length, 'group') : ''}
        </span>
      </header>
      {groups.length === 0 ? (
        <p className="text-[12px] text-[var(--ro-muted)]">No values recorded for {m.name} yet.</p>
      ) : numeric ? (
        <>
          <DotChart groups={groups} unit={m.unit} refKey={ref !== undefined ? ref.key : null} />
          <div className="overflow-x-auto">
            <table className="num w-full text-[12px]">
              <thead>
                <tr className="text-left text-[var(--ro-muted)]">
                  <th className="py-1 pr-3 font-semibold">{grouped > 0 ? 'Group' : ''}</th>
                  {['n', 'Mean', 'SD', 'Min', 'Max'].map((h) => (
                    <th key={h} className="py-1 pl-3 text-right font-semibold">
                      {h}
                    </th>
                  ))}
                  {refMean !== null && <th className="py-1 pl-3 text-right font-semibold">vs {ref?.key || 'all'}</th>}
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => {
                  const d = refMean !== null && g.mean !== null && g.mean !== undefined && g.key !== ref?.key ? g.mean - refMean : null;
                  const pct = d !== null && refMean !== 0 ? (100 * d) / Math.abs(refMean ?? 1) : null;
                  return (
                    <tr key={g.key} className={cn('border-t border-[var(--ro-hair)]', g.key === ref?.key && 'bg-[var(--ro-row)]')}>
                      <td className="py-1 pr-3 font-semibold">
                        {g.key || 'All runs'}
                        {g.key === ref?.key && <span className="ml-1.5 font-normal text-[var(--ro-muted)]">reference</span>}
                      </td>
                      <td className="py-1 pl-3 text-right">{g.n}</td>
                      <td className="py-1 pl-3 text-right font-bold">{fmt(g.mean)}</td>
                      <td className="py-1 pl-3 text-right">{g.sd === null || g.sd === undefined ? '' : fmt(g.sd)}</td>
                      <td className="py-1 pl-3 text-right">{fmt(g.min)}</td>
                      <td className="py-1 pl-3 text-right">{fmt(g.max)}</td>
                      {refMean !== null && (
                        <td className="py-1 pl-3 text-right font-semibold">
                          {d === null ? '' : (d > 0 ? '+' : '') + fmt(d)}
                          {pct !== null && <span className="ml-1 font-normal text-[var(--ro-muted)]">({(pct > 0 ? '+' : '') + fmt(Math.round(pct * 10) / 10)}%)</span>}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-2">
          <span className="flex flex-wrap gap-3 text-[12px]">
            {values.map((v, i) => (
              <span key={v} className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-[2px]" style={{ background: SERIES[i % SERIES.length] }} /> {v}
              </span>
            ))}
          </span>
          {groups.map((g) => (
            <div key={g.key} className="grid grid-cols-[minmax(0,160px)_minmax(0,1fr)_auto] items-center gap-3 text-[12px]">
              <span className="truncate font-semibold">{g.key || 'All runs'}</span>
              <span className="flex h-3 overflow-hidden rounded-[2px] bg-[var(--ro-row-hover)]">
                {values.map((v, i) => (
                  <span key={v} title={v + ': ' + (g.counts?.[v] ?? 0)} style={{ width: `${(100 * (g.counts?.[v] ?? 0)) / Math.max(1, g.n)}%`, background: SERIES[i % SERIES.length] }} />
                ))}
              </span>
              <span className="num text-[var(--ro-muted)]">{values.map((v) => (g.counts?.[v] ?? 0) + ' ' + v).join(', ')}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** Ticks for a range: 4 to 6 round numbers. */
function ticks(lo: number, hi: number): number[] {
  const range = hi - lo || Math.abs(hi) || 1;
  const mag = Math.pow(10, Math.floor(Math.log10(range / 5)));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => range / s <= 6) ?? mag * 10;
  const out: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi + step * 1e-9; t += step) out.push(Number(t.toPrecision(12)));
  return out;
}

/** Every value of each group as a dot, the mean as a bar, and the SD as whiskers; the reference group shaded. */
function DotChart({ groups, unit, refKey }: { groups: ExpResults['measures'][number]['groups']; unit: string; refKey: string | null }): React.JSX.Element {
  const [ref, w] = useWidth<HTMLDivElement>();
  const H = 220;
  const M = { l: 48, r: 12, t: 10, b: 34 };
  const all = groups.flatMap((g) => [...(g.values ?? []), ...(g.mean !== null && g.mean !== undefined && g.sd ? [g.mean - g.sd, g.mean + g.sd] : [])]);
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  if (lo >= 0 && hi > 0 && lo <= hi * 0.2) lo = 0;
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const pad = (hi - lo) * 0.06;
  hi += pad;
  if (lo !== 0) lo -= pad;
  const ts = ticks(lo, hi);
  const iw = Math.max(10, w - M.l - M.r);
  const ih = H - M.t - M.b;
  const y = (v: number): number => M.t + ih - ((v - lo) / (hi - lo)) * ih;
  const band = iw / groups.length;
  return (
    <div ref={ref} className="w-full">
      {w > 0 && (
        <svg width={w} height={H} role="img" aria-label={'Values by group' + (unit ? ' in ' + unit : '')} className="block">
          {groups.map((g, gi) =>
            g.key === refKey ? <rect key={'ref' + gi} x={M.l + band * gi} y={M.t} width={band} height={ih} fill="var(--ro-row)" /> : null,
          )}
          {ts.map((t) => (
            <g key={t}>
              <line x1={M.l} x2={M.l + iw} y1={y(t)} y2={y(t)} stroke="var(--ro-hair)" strokeWidth={1} />
              <text x={M.l - 6} y={y(t) + 4} textAnchor="end" fontSize={12} fill="var(--ro-muted)" className="num">
                {fmt(t)}
              </text>
            </g>
          ))}
          {groups.map((g, gi) => {
            const cx = M.l + band * gi + band / 2;
            const half = Math.min(28, band * 0.3);
            const vals = g.values ?? [];
            const label = g.key || 'All runs';
            const maxChars = Math.max(4, Math.floor(band / 7));
            return (
              <g key={g.key}>
                {g.mean !== null && g.mean !== undefined && g.sd !== null && g.sd !== undefined && g.sd > 0 && (
                  <g stroke="var(--ro-ink-2)" strokeWidth={1.5}>
                    <line x1={cx} x2={cx} y1={y(g.mean - g.sd)} y2={y(g.mean + g.sd)} />
                    <line x1={cx - half / 2} x2={cx + half / 2} y1={y(g.mean - g.sd)} y2={y(g.mean - g.sd)} />
                    <line x1={cx - half / 2} x2={cx + half / 2} y1={y(g.mean + g.sd)} y2={y(g.mean + g.sd)} />
                  </g>
                )}
                {vals.map((v, i) => {
                  // A steady spread so dots with the same value stay apart.
                  const jitter = vals.length === 1 ? 0 : ((i * 0.618) % 1) * half * 1.4 - half * 0.7;
                  return (
                    <circle key={i} cx={cx + jitter} cy={y(v)} r={3.5} fill="var(--ro-pc-blue)" stroke="var(--ro-card)" strokeWidth={1}>
                      <title>{fmt(v) + (unit ? ' ' + unit : '')}</title>
                    </circle>
                  );
                })}
                {g.mean !== null && g.mean !== undefined && (
                  <line x1={cx - half} x2={cx + half} y1={y(g.mean)} y2={y(g.mean)} stroke="var(--ro-accent)" strokeWidth={3} strokeLinecap="round">
                    <title>{'Mean ' + fmt(g.mean) + (unit ? ' ' + unit : '') + ', n = ' + g.n}</title>
                  </line>
                )}
                <text x={cx} y={H - 12} textAnchor="middle" fontSize={12} fill="var(--ro-ink-2)">
                  <title>{label}</title>
                  {label.length > maxChars ? label.slice(0, maxChars - 1) + '…' : label}
                </text>
              </g>
            );
          })}
          <line x1={M.l} x2={M.l + iw} y1={M.t + ih} y2={M.t + ih} stroke="var(--ro-line)" strokeWidth={1} />
        </svg>
      )}
      <p className="mt-1 flex flex-wrap items-center gap-3 text-[12px] text-[var(--ro-muted)]">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: 'var(--ro-pc-blue)' }} /> Each value
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-[3px] w-3 rounded-full bg-[var(--ro-accent)]" /> Mean
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-px bg-[var(--ro-ink-2)]" /> Mean ± SD
        </span>
      </p>
    </div>
  );
}

