/**
 * Pieces shared by the Settings sections: the bar that saves a section's
 * changes, the sentence shown to someone without the rights, module words
 * and icons, and money typed as text.
 */
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { BarChart3, BookOpen, Boxes, Factory, FolderKanban, Landmark, Lock, ShoppingCart, Tag, Users, Wallet } from 'lucide-react';
import { decimalsOf, minorToText, normalizeNumber } from '../../lib/format.ts';
import type { Level, Module } from '../../lib/types.ts';
import { Card, Empty, PillButton } from '../ui.tsx';

/** A section's unsaved changes: Discard and Save, kept in view while scrolling. */
export function SaveBar({ dirty, saving, onSave, onDiscard, label = 'Save changes', note }: { dirty: boolean; saving: boolean; onSave: () => void; onDiscard: () => void; label?: string | undefined; note?: ReactNode | undefined }): React.JSX.Element | null {
  if (!dirty) return null;
  return (
    <div className="erp-pop erp-on-ink sticky bottom-24 z-30 mt-5 flex flex-wrap items-center gap-3 rounded-[22px] bg-[var(--erp-ink)] px-4 py-3 text-[var(--erp-shell)] shadow-[var(--erp-pop-shadow)] md:bottom-6">
      <span className="min-w-0 flex-1 text-[14px] font-semibold">{note ?? 'You have unsaved changes'}</span>
      <button type="button" onClick={onDiscard} className="rounded-full px-3 py-2 text-[13px] font-semibold hover:bg-[var(--erp-shell)]/10">
        Discard
      </button>
      <PillButton variant="accent" size="sm" loading={saving} onClick={onSave}>
        {label}
      </PillButton>
    </div>
  );
}

/** Shown in place of a section the person has no rights to. */
export function NoRights({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <Card>
      <Empty icon={Lock} title="Not for your role">
        {children}
      </Empty>
    </Card>
  );
}

export const MODULE_INFO: Record<Module, { label: string; icon: LucideIcon; text: string }> = {
  sales: { label: 'Sales', icon: Tag, text: 'Customers, quotes, orders, deliveries, invoices and credit notes.' },
  purchasing: { label: 'Purchasing', icon: ShoppingCart, text: 'Suppliers, purchase orders, goods receipts and bills.' },
  inventory: { label: 'Inventory', icon: Boxes, text: 'Items, warehouses, stock levels, counts and reorder suggestions.' },
  manufacturing: { label: 'Manufacturing', icon: Factory, text: 'Bills of materials and builds that turn parts into products.' },
  accounting: { label: 'Accounting', icon: BookOpen, text: 'Chart of accounts, journal entries, month close, assets and budgets.' },
  banking: { label: 'Banking', icon: Landmark, text: 'Bank and cash accounts, statements, matching and transfers.' },
  people: { label: 'People', icon: Users, text: 'Employees, departments, the org chart, leave and expense claims.' },
  payroll: { label: 'Payroll', icon: Wallet, text: 'Pay components, pay runs and payslips.' },
  projects: { label: 'Projects', icon: FolderKanban, text: 'Projects, tasks, timesheets and billing by time or milestone.' },
  reports: { label: 'Reports', icon: BarChart3, text: 'Profit and loss, balance sheet, cash flow, aging and more.' },
};

export const LEVEL_WORDS: Record<Level, { label: string; text: string }> = {
  none: { label: 'None', text: 'Hidden' },
  view: { label: 'View', text: 'Sees it' },
  edit: { label: 'Edit', text: 'Drafts and changes' },
  full: { label: 'Full', text: 'Posts, approves and pays' },
};

/** Minor units -> the text a money field holds ('' for zero when `blankZero`). */
export function moneyText(minor: number, currency: string, blankZero = false): string {
  if (blankZero && minor === 0) return '';
  return minorToText(minor, currency);
}

/** Typed money text -> minor units (null when it is not an amount). */
export function textToMinor(text: string, currency: string): number | null {
  if (text.trim() === '') return 0;
  const n = normalizeNumber(text, decimalsOf(currency));
  if (n === null) return null;
  return Math.round(Number(n) * 10 ** decimalsOf(currency));
}

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
