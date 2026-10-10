/** Currency, stock rules, categories, and what an AI agent can do with this app. */
import { useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { FileSpreadsheet, MessageSquare, Plus, Receipt, ScanBarcode, ShoppingCart, Sparkles, Trash2 } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { Card, CardHeader, PageHeader, PillButton, PillSelect, Popover, Toggle, softInput, useConfirm } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { CURRENCIES, currencyName, plural } from '../lib/format.ts';
import { ICON_NAMES, iconOf } from '../lib/icons.tsx';
import type { Category } from '../lib/types.ts';

const ASK: { icon: LucideIcon; say: string; does: string }[] = [
  { icon: MessageSquare, say: 'We got 40 rolls of packing tape in today', does: 'Receives it against the open order, or as new stock' },
  { icon: Receipt, say: 'A photo or PDF of a packing slip', does: 'Reads every line and records what arrived' },
  { icon: ShoppingCart, say: 'What is running low? Draft the orders', does: 'Checks the numbers and prepares one draft per supplier' },
  { icon: FileSpreadsheet, say: 'A spreadsheet of your items', does: 'Maps the columns and imports it' },
  { icon: ScanBarcode, say: 'Move the gloves from the van to shelf B', does: 'Records the move' },
  { icon: Sparkles, say: 'How much stock do we have in the stockroom?', does: 'Answers from your data' },
];

function IconPicker({ value, onPick, label }: { value: string; onPick: (icon: string) => void; label: string }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement | null>(null);
  const Icon = iconOf(value);
  return (
    <div className="relative">
      <button
        ref={btn}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        title="Change the icon"
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--iv-solid)] text-[var(--iv-on-solid)] transition-transform active:scale-95"
      >
        <Icon size={17} aria-hidden />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} keep={btn} className="w-[min(320px,calc(100vw-48px))] p-3">
        <div className="grid max-h-64 grid-cols-7 gap-1 overflow-y-auto">
          {ICON_NAMES.map((n) => {
            const I = iconOf(n);
            return (
              <button
                key={n}
                type="button"
                aria-label={n.replace(/-/g, ' ')}
                aria-pressed={n === value}
                onClick={() => {
                  onPick(n);
                  setOpen(false);
                }}
                className={cn('flex aspect-square items-center justify-center rounded-full', n === value ? 'iv-on-ink bg-[var(--iv-ink)] text-[var(--iv-shell)]' : 'hover:bg-[var(--iv-row)]')}
              >
                <I size={16} />
              </button>
            );
          })}
        </div>
      </Popover>
    </div>
  );
}

function CategoryRow({ c }: { c: Category }): React.JSX.Element {
  const [name, setName] = useState(c.name);
  const [confirmEl, confirm] = useConfirm();
  useEffect(() => setName(c.name), [c.name]);
  const save = (patch: { name?: string; icon?: string }): void => {
    api
      .updateCategory(c.id, patch)
      .then(() => toast.success('Saved'))
      .catch(() => setName(c.name));
  };
  const remove = async (): Promise<void> => {
    const ok = await confirm(c.items > 0 ? `Its ${plural(c.items, 'item')} keep their stock and become uncategorized.` : 'No items use it.', `Delete "${c.name}"?`);
    if (!ok) return;
    try {
      await api.deleteCategory(c.id);
      toast.success('Deleted');
    } catch {
      /* toasted */
    }
  };
  return (
    <li className="flex items-center gap-3 rounded-[18px] bg-[var(--iv-row)] p-2 pr-3">
      <IconPicker value={c.icon} onPick={(icon) => save({ icon })} label={`Icon of ${c.name}`} />
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() !== '' && name.trim() !== c.name && save({ name: name.trim() })}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        maxLength={40}
        aria-label={`Name of ${c.name}`}
        className="editable min-w-0 flex-1 rounded-full bg-transparent px-2 py-1.5 text-[14px] font-semibold outline-none ring-[var(--iv-ink)] hover:bg-[var(--iv-card)] focus-visible:bg-[var(--iv-card)] focus-visible:ring-2"
      />
      <span className="num text-[12px] text-[var(--iv-muted)]">{plural(c.items, 'item')}</span>
      <button type="button" onClick={() => void remove()} aria-label={`Delete ${c.name}`} className="flex size-8 items-center justify-center rounded-full text-[var(--iv-ink-2)] hover:bg-[var(--iv-row-hover)]">
        <Trash2 size={14} />
      </button>
      {confirmEl}
    </li>
  );
}

export function SettingsPage(): React.JSX.Element {
  const { settings, categories } = useApp();
  const [code, setCode] = useState(settings?.currency ?? 'USD');
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [newIcon, setNewIcon] = useState('package');
  const [confirmEl, confirm] = useConfirm();
  useEffect(() => {
    if (settings !== null) setCode(settings.currency);
  }, [settings]);
  const current = settings?.currency ?? 'USD';
  const options = (CURRENCIES.includes(current) ? CURRENCIES : [current, ...CURRENCIES]).map((c) => ({ value: c, label: `${c} · ${currencyName(c)}` }));

  const saveCurrency = async (): Promise<void> => {
    if (code === current) return;
    const ok = await confirm(`Costs and values keep their numbers and show in ${code} from now on; nothing is converted.`, `Switch to ${code}?`, 'Switch');
    if (!ok) return;
    setBusy(true);
    try {
      await api.updateSettings({ currency: code });
      toast.success(`Costs are now in ${code}`);
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  const setFlag = async (p: { allow_negative?: boolean; auto_restock?: boolean }, msg: string): Promise<void> => {
    try {
      await api.updateSettings(p);
      toast.success(msg);
    } catch {
      /* toasted */
    }
  };
  const addCategory = async (): Promise<void> => {
    const n = newName.trim();
    if (n === '') return;
    try {
      await api.addCategory(n, newIcon);
      toast.success(`Added ${n}`);
      setNewName('');
      setNewIcon('package');
    } catch {
      /* toasted */
    }
  };

  return (
    <div>
      <PageHeader title="Settings" />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:items-start">
        <div className="flex flex-col gap-5 lg:col-span-5">
          <Card delay={1}>
            <CardHeader title="Currency" subtitle="Costs and stock values are in this currency" />
            <div className="flex flex-col gap-3">
              <PillSelect soft ariaLabel="Currency" value={code} onChange={setCode} options={options} />
              <PillButton variant="dark" disabled={code === current} loading={busy} onClick={() => void saveCurrency()}>
                Use {code}
              </PillButton>
            </div>
          </Card>
          <Card delay={2}>
            <CardHeader title="Stock rules" />
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3 rounded-[20px] bg-[var(--iv-row)] px-4 py-3">
                <span>
                  <span className="block text-[13px] font-semibold">Allow stock below zero</span>
                  <span className="block text-[12px] text-[var(--iv-muted)]">Off: taking out more than a place holds is refused, which catches mistakes.</span>
                </span>
                <Toggle
                  checked={settings?.allow_negative === true}
                  onChange={(v) => void setFlag({ allow_negative: v }, v ? 'Stock can now go below zero' : 'Stock can no longer go below zero')}
                  label="Allow stock below zero"
                />
              </div>
              <div className="flex items-center justify-between gap-3 rounded-[20px] bg-[var(--iv-row)] px-4 py-3">
                <span>
                  <span className="block text-[13px] font-semibold">Your AI agent drafts reorders</span>
                  <span className="block text-[12px] text-[var(--iv-muted)]">When something runs low, it prepares a draft purchase order. It never sends one.</span>
                </span>
                <Toggle
                  checked={settings?.auto_restock === true}
                  onChange={(v) => void setFlag({ auto_restock: v }, v ? 'Your AI agent drafts orders when something runs low' : 'Automatic drafts are off')}
                  label="Your AI agent drafts reorders"
                />
              </div>
            </div>
          </Card>
          <Card tone="dark" delay={3}>
            <CardHeader title="Let your AI agent do it" dark subtitle="Say it in chat or send it a file. It works in this app for you." />
            <ul className="flex flex-col gap-2">
              {ASK.map((a) => {
                const Icon = a.icon;
                return (
                  <li key={a.say} className="flex items-center gap-3 rounded-[18px] bg-[var(--iv-dark-2)] px-3 py-2.5">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--iv-accent)] text-[var(--iv-on-accent)]">
                      <Icon size={16} aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[14px] font-bold">{a.say}</span>
                      <span className="block text-[12px] text-[var(--iv-on-dark-muted)]">{a.does}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
        <Card className="lg:col-span-7" delay={2}>
          <CardHeader title="Categories" subtitle="Group items; each wears an icon. Click an icon to change it, a name to rename it." />
          <ul className="flex flex-col gap-2">
            {categories.map((c) => (
              <CategoryRow key={c.id} c={c} />
            ))}
          </ul>
          <div className="mt-4 flex items-center gap-3 rounded-[18px] bg-[var(--iv-sand)] p-2 pr-2">
            <IconPicker value={newIcon} onPick={setNewIcon} label="Icon of the new category" />
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void addCategory()}
              maxLength={40}
              placeholder="New category"
              aria-label="New category name"
              className={cn(softInput, 'iv-on-card h-10 bg-[var(--iv-card)]')}
            />
            <PillButton variant="dark" icon={Plus} disabled={newName.trim() === ''} onClick={() => void addCategory()} className="h-10">
              Add
            </PillButton>
          </div>
        </Card>
      </div>
      {confirmEl}
    </div>
  );
}
