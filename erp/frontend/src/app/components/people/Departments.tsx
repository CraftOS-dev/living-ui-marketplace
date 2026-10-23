/**
 * Departments: add one, rename it, put it inside another, name its head,
 * and delete one nobody is in. Opened from the directory.
 */
import { useState } from 'react';
import { AlertTriangle, Building, Check, Pencil, Plus, Trash2 } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { useLive } from '../../lib/live.ts';
import { plural } from '../../lib/format.ts';
import type { Department, DepartmentList } from '../../lib/types/people.ts';
import { EmployeePicker } from '../pickers.tsx';
import type { Option } from '../pickers.tsx';
import { CircleButton, Empty, Field, Modal, Notice, PillButton, PillSelect, Skeleton, softInput, useConfirm } from '../ui.tsx';
import { PersonAvatar } from './common.tsx';

function parentOptions(all: Department[], self: string | null): { value: string; label: string }[] {
  return [{ value: '', label: 'Top level' }, ...all.filter((d) => d.id !== self).map((d) => ({ value: d.id, label: d.name }))];
}

function DeptRow({ d, all, onChanged }: { d: Department; all: Department[]; onChanged: () => void }): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(d.name);
  const [code, setCode] = useState(d.code);
  const [parent, setParent] = useState(d.parent?.id ?? '');
  const [head, setHead] = useState<Option | null>(d.manager !== null ? { id: d.manager.id, label: d.manager.name, value: d.manager.id } : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmEl, confirm] = useConfirm();

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await op('departments.update', { department: d.id, name: name.trim(), code: code.trim(), parent, manager: head?.id ?? '' }, { quiet: true });
      setEditing(false);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (): Promise<void> => {
    if (!(await confirm(`${d.name} is deleted. Its sub-departments move up a level.`, 'Delete this department?'))) return;
    try {
      await op('departments.delete', { department: d.id });
      toast.success('Deleted');
      onChanged();
    } catch {
      /* shown */
    }
  };

  if (editing) {
    return (
      <li className="flex flex-col gap-3 rounded-[20px] bg-[var(--erp-card)] p-4">
        <div className="grid grid-cols-1 gap-3 @min-[480px]:grid-cols-[1fr_120px]">
          <Field label="Name">
            <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" autoFocus className={softInput} />
          </Field>
          <Field label="Code" optional>
            <input value={code} onChange={(e) => setCode(e.target.value)} aria-label="Code" className={cn(softInput, 'num uppercase')} />
          </Field>
          <PillSelect soft label="Inside" value={parent} onChange={setParent} options={parentOptions(all, d.id)} />
          <Field label="Head" optional>
            <EmployeePicker value={head} onChange={setHead} placeholder="Nobody" clearable />
          </Field>
        </div>
        {error !== null && (
          <Notice tone="bad" icon={AlertTriangle}>
            {error}
          </Notice>
        )}
        <div className="flex justify-end gap-2">
          <PillButton size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </PillButton>
          <PillButton size="sm" icon={Check} loading={busy} onClick={() => void save()}>
            Save
          </PillButton>
        </div>
      </li>
    );
  }
  return (
    <li className="flex items-center gap-3 rounded-[20px] bg-[var(--erp-card)] px-3 py-2.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--erp-row)]">
        <Building size={15} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-bold">
          {d.name}
          {d.code !== '' && <span className="num ml-2 text-[12px] font-semibold text-[var(--erp-muted)]">{d.code}</span>}
        </span>
        <span className="block truncate text-[12px] text-[var(--erp-muted)]">
          {plural(d.employees, 'person', 'people')}
          {d.parent !== null ? ` · in ${d.parent.name}` : ''}
        </span>
      </span>
      {d.manager !== null && (
        <span className="hidden items-center gap-2 @min-[480px]:flex" title={`Head: ${d.manager.name}`}>
          <PersonAvatar name={d.manager.name} photo={d.manager.photo} size={28} />
          <span className="max-w-[120px] truncate text-[12px] font-semibold text-[var(--erp-ink-2)]">{d.manager.name}</span>
        </span>
      )}
      <CircleButton icon={Pencil} label={`Edit ${d.name}`} variant="row" size={34} onClick={() => setEditing(true)} />
      {d.employees === 0 && <CircleButton icon={Trash2} label={`Delete ${d.name}`} variant="row" size={34} onClick={() => void remove()} />}
      {confirmEl}
    </li>
  );
}

export function DepartmentsModal({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element {
  const live = useLive(() => op<DepartmentList>('departments.list', {}, { quiet: true }), ['departments', 'employees'], []);
  const [name, setName] = useState('');
  const [parent, setParent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const all = live.data?.departments ?? [];
  const canEdit = live.data?.can.edit === true;

  const add = async (): Promise<void> => {
    if (name.trim() === '') return;
    setBusy(true);
    setError(null);
    try {
      await op('departments.add', { name: name.trim(), parent: parent === '' ? undefined : parent }, { quiet: true });
      setName('');
      setParent('');
      live.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Departments" description={live.data !== null ? `${plural(all.length, 'department')}${live.data.without_department > 0 ? `, ${plural(live.data.without_department, 'person', 'people')} without one` : ''}` : undefined} size="lg">
      <div className="flex flex-col gap-4">
        {canEdit && (
          <div className="flex flex-col gap-2 rounded-[20px] bg-[var(--erp-row)] p-3">
            <div className="flex flex-col gap-2 @min-[480px]:flex-row">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void add();
                }}
                placeholder="New department name"
                aria-label="New department name"
                className={cn(softInput, 'flex-1 bg-[var(--erp-card)]')}
              />
              {all.length > 0 && <PillSelect value={parent} onChange={setParent} options={parentOptions(all, null)} ariaLabel="Inside" className="@min-[480px]:w-48" />}
              <PillButton icon={Plus} loading={busy} disabled={name.trim() === ''} onClick={() => void add()}>
                Add
              </PillButton>
            </div>
            {error !== null && <p className="px-2 text-[12px] font-medium text-[var(--erp-red-text)]">{error}</p>}
          </div>
        )}
        {live.data === null ? (
          live.error !== null ? (
            <Notice tone="bad" icon={AlertTriangle} action={<PillButton variant="soft" size="sm" onClick={live.reload}>Try again</PillButton>}>
              {live.error}
            </Notice>
          ) : (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
            </div>
          )
        ) : all.length === 0 ? (
          <Empty icon={Building} title="No departments yet" compact />
        ) : (
          <ul className="flex flex-col gap-2">{all.map((d) => (canEdit ? <DeptRow key={d.id} d={d} all={all} onChanged={live.reload} /> : <ReadOnlyDept key={d.id} d={d} />))}</ul>
        )}
      </div>
    </Modal>
  );
}

function ReadOnlyDept({ d }: { d: Department }): React.JSX.Element {
  return (
    <li className="flex items-center gap-3 rounded-[20px] bg-[var(--erp-card)] px-3 py-2.5">
      <Building size={15} aria-hidden className="shrink-0" />
      <span className="min-w-0 flex-1 truncate text-[14px] font-bold">{d.name}</span>
      <span className="text-[12px] text-[var(--erp-muted)]">{plural(d.employees, 'person', 'people')}</span>
    </li>
  );
}
