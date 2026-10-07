/** Categories as cards; each opens an editor with a name, a line icon and its removal. */
import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { Card, Field, Modal, PageHeader, PillButton, PillSelect, softInput, useConfirm } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { CategoryBadge, ICONS, ICON_NAMES } from '../lib/icons.tsx';
import { money } from '../lib/money.ts';
import type { Category } from '../lib/types.ts';

function IconPicker({ value, onChange }: { value: string; onChange: (v: string) => void }): React.JSX.Element {
  return (
    <div className="grid grid-cols-8 gap-1.5">
      {ICON_NAMES.map((name) => {
        const Icon = ICONS[name];
        if (Icon === undefined) return null;
        const on = name === value;
        return (
          <button
            key={name}
            type="button"
            aria-label={name.replace(/-/g, ' ')}
            aria-pressed={on}
            onClick={() => onChange(name)}
            className={cn('flex aspect-square items-center justify-center rounded-full transition-colors', on ? 'bg-[var(--et-solid)] text-[var(--et-on-solid)]' : 'bg-[var(--et-row)] text-[var(--et-ink)] hover:bg-[var(--et-row-hover)]')}
          >
            <Icon size={17} strokeWidth={1.9} />
          </button>
        );
      })}
    </div>
  );
}

function Editor({ category, creating, onClose }: { category: Category | null; creating: boolean; onClose: () => void }): React.JSX.Element {
  const { categories } = useApp();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('tag');
  const [moveTo, setMoveTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmEl, confirm] = useConfirm();
  const open = creating || category !== null;
  useEffect(() => {
    if (!open) return;
    setName(category?.name ?? '');
    setIcon(category?.icon ?? 'tag');
    setMoveTo('');
  }, [open, category]);

  const save = async (): Promise<void> => {
    if (name.trim() === '') return;
    setBusy(true);
    try {
      if (category === null) await api.addCategory({ name: name.trim(), icon });
      else await api.updateCategory(category.id, { name: name.trim(), icon });
      toast.success('Saved');
      onClose();
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  const remove = async (): Promise<void> => {
    if (category === null) return;
    const target = categories.find((c) => c.id === moveTo)?.name ?? 'Uncategorized';
    if (!(await confirm(category.count > 0 ? `Its ${category.count} ${category.count === 1 ? 'expense moves' : 'expenses move'} to ${target}.` : 'No expenses use it.', `Delete ${category.name}?`))) return;
    try {
      await api.deleteCategory(category.id, moveTo);
      toast.success(`${category.name} deleted`);
      onClose();
    } catch {
      /* toasted */
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={category === null ? 'New category' : 'Edit category'}
      footer={
        <>
          {category !== null && (
            <PillButton variant="danger" icon={Trash2} onClick={() => void remove()} className="mr-auto">
              Delete
            </PillButton>
          )}
          <PillButton variant="light" onClick={onClose}>
            Cancel
          </PillButton>
          <PillButton variant="dark" loading={busy} disabled={name.trim() === ''} onClick={() => void save()}>
            Save
          </PillButton>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex items-end gap-3">
          <CategoryBadge icon={icon} size={44} tone="dark" />
          <div className="flex-1">
            <Field label="Name">
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Coffee" className={softInput} autoFocus onKeyDown={(e) => e.key === 'Enter' && void save()} />
            </Field>
          </div>
        </div>
        <Field label="Icon">
          <IconPicker value={icon} onChange={setIcon} />
        </Field>
        {category !== null && category.count > 0 && (
          <PillSelect
            label="If deleted, move its expenses to"
            soft
            value={moveTo}
            onChange={setMoveTo}
            options={[{ value: '', label: 'Uncategorized' }, ...categories.filter((c) => c.id !== category.id).map((c) => ({ value: c.id, label: c.name }))]}
          />
        )}
      </div>
      {confirmEl}
    </Modal>
  );
}

export function CategoriesPage(): React.JSX.Element {
  const { categories, currency } = useApp();
  const [editing, setEditing] = useState<Category | null>(null);
  const [creating, setCreating] = useState(false);
  return (
    <div>
      <PageHeader
        title="Categories"
        subtitle="Open a category to rename it, change its icon or remove it."
        actions={
          <PillButton variant="dark" icon={Plus} dot onClick={() => setCreating(true)}>
            New category
          </PillButton>
        }
      />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
        {categories.map((c, i) => (
          <button key={c.id} type="button" onClick={() => setEditing(c)} className={cn('et-rise text-left', `et-d${Math.min(5, (i % 5) + 1)}`)}>
            <span className="flex h-full flex-col gap-4 rounded-[24px] bg-[var(--et-card)] p-5 transition-transform hover:-translate-y-0.5">
              <CategoryBadge icon={c.icon} size={44} tone="white" />
              <span>
                <span className="block truncate text-[15px] font-bold">{c.name}</span>
                <span className="mt-0.5 block text-[12px] text-[var(--et-muted)]">
                  {c.count} {c.count === 1 ? 'expense' : 'expenses'}
                  {c.month_total_minor > 0 ? ` · ${money(c.month_total_minor, currency, true)} this month` : ''}
                </span>
              </span>
            </span>
          </button>
        ))}
      </div>
      <Editor
        category={editing}
        creating={creating}
        onClose={() => {
          setEditing(null);
          setCreating(false);
        }}
      />
    </div>
  );
}
