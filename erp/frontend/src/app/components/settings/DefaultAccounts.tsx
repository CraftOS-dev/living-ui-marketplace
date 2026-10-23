/**
 * Default accounts: where each kind of posting lands (receivables,
 * payables, stock, tax, payroll, ...), and the default warehouse, bank,
 * taxes and payment terms new documents start with. Each change saves on
 * its own.
 */
import { useMemo, useState } from 'react';
import { toast } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { useLive } from '../../lib/live.ts';
import type { CompanySettings, Tax, Terms } from '../../lib/types/settings.ts';
import type { Option } from '../pickers.tsx';
import { AccountPicker, BankPicker, TaxPicker, WarehousePicker, accountOption } from '../pickers.tsx';
import { Card, CardHeader, Field, PillSelect, Skeleton } from '../ui.tsx';

const GROUPS: { title: string; keys: [string, string, string[]][] }[] = [
  {
    title: 'Selling and buying',
    keys: [
      ['ar', 'Money customers owe', ['asset']],
      ['ap', 'Money owed to suppliers', ['liability']],
      ['sales', 'Sales of goods', ['income']],
      ['service_revenue', 'Sales of services', ['income']],
      ['tax_payable', 'Tax collected on sales', ['liability']],
      ['tax_receivable', 'Tax paid on purchases', ['asset']],
      ['general_expense', 'Purchases without an account', ['expense']],
    ],
  },
  {
    title: 'Stock and making',
    keys: [
      ['inventory', 'Stock on hand', ['asset']],
      ['grni', 'Goods received, not yet billed', ['liability']],
      ['cogs', 'Cost of goods sold', ['expense']],
      ['ppv', 'Purchase price differences', ['expense']],
      ['stock_adjustment', 'Stock adjustments', ['expense']],
      ['applied_overhead', 'Labor and overhead in builds', ['expense', 'income']],
    ],
  },
  {
    title: 'Payroll and claims',
    keys: [
      ['salaries', 'Salaries', ['expense']],
      ['employer_contributions', 'Employer contributions', ['expense']],
      ['salaries_payable', 'Salaries to pay', ['liability']],
      ['payroll_liabilities', 'Deductions to pay over', ['liability']],
      ['reimbursements', 'Expense claims to repay', ['liability']],
    ],
  },
  {
    title: 'Books and banking',
    keys: [
      ['bank_fees', 'Bank fees', ['expense']],
      ['fx', 'Exchange gains and losses', []],
      ['depreciation', 'Depreciation', ['expense']],
      ['accumulated_depreciation', 'Accumulated depreciation', ['asset']],
      ['opening_balance', 'Opening balance equity', ['equity']],
      ['retained_earnings', 'Retained earnings', ['equity']],
    ],
  },
];

interface Named {
  id: string;
  name: string;
  code?: string | undefined;
}

export function DefaultAccountsSection({ s, onSaved }: { s: CompanySettings; onSaved: (s: CompanySettings) => void }): React.JSX.Element {
  const accounts = s.default_accounts ?? {};
  const d = s.defaults ?? { warehouse: '', bank: '', sale_tax: '', purchase_tax: '', terms: '' };
  const lists = useLive(
    () =>
      Promise.all([
        op<{ warehouses: Named[] }>('warehouses.list', {}, { quiet: true }).catch(() => ({ warehouses: [] as Named[] })),
        op<{ banks: Named[] }>('banks.list', {}, { quiet: true }).catch(() => ({ banks: [] as Named[] })),
        op<{ taxes: Tax[] }>('taxes.list', { archived: true }, { quiet: true }).catch(() => ({ taxes: [] as Tax[] })),
        op<{ terms: Terms[] }>('terms.list', {}, { quiet: true }).catch(() => ({ terms: [] as Terms[] })),
      ]),
    ['warehouses', 'banks', 'taxes', 'payment_terms'],
    [],
  );
  const [busy, setBusy] = useState<string | null>(null);

  const save = async (key: string, params: Record<string, string | Record<string, string>>, what: string): Promise<void> => {
    setBusy(key);
    try {
      const next = await op<CompanySettings>('settings.defaults', params);
      onSaved(next);
      toast.success(`${what} saved`);
    } catch {
      /* shown */
    } finally {
      setBusy(null);
    }
  };

  const [wh, banks, taxes, terms] = lists.data ?? [null, null, null, null];
  const named = (rows: Named[] | undefined, id: string): Option | null => {
    const r = rows?.find((x) => x.id === id);
    return r === undefined ? null : { id: r.id, label: r.name, value: r.id };
  };
  const taxOpt = (id: string): Option | null => {
    const t = taxes?.taxes.find((x) => x.id === id);
    return t === undefined ? null : { id: t.id, label: t.name, sub: t.code, value: t.code };
  };
  const termOptions = useMemo(() => [{ value: '', label: 'None' }, ...(terms?.terms ?? []).map((t) => ({ value: t.id, label: t.name }))], [terms]);

  return (
    <div className="flex flex-col gap-5">
      <Card delay={1}>
        <CardHeader title="New documents start with" subtitle="Anyone can change these on a document" />
        {lists.data === null ? (
          <div className="grid grid-cols-1 gap-4 @min-[640px]:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[74px]" />
            ))}
          </div>
        ) : (
        <div className="grid grid-cols-1 gap-4 @min-[640px]:grid-cols-2">
          <Field label="Warehouse">
            <WarehousePicker value={named(wh?.warehouses, d.warehouse)} onChange={(o) => void save('warehouse', { warehouse: o?.id ?? '' }, 'Default warehouse')} disabled={busy !== null} />
          </Field>
          <Field label="Bank account" hint="Where payments go when none is chosen">
            <BankPicker value={named(banks?.banks, d.bank)} onChange={(o) => void save('bank', { bank: o?.id ?? '' }, 'Default bank account')} disabled={busy !== null} clearable />
          </Field>
          <Field label="Sales tax">
            <TaxPicker scope="sales" value={taxOpt(d.sale_tax)} onChange={(o) => void save('sale_tax', { sale_tax: o?.value === 'none' ? '' : (o?.value ?? '') }, 'Default sales tax')} disabled={busy !== null} />
          </Field>
          <Field label="Purchase tax">
            <TaxPicker scope="purchase" value={taxOpt(d.purchase_tax)} onChange={(o) => void save('purchase_tax', { purchase_tax: o?.value === 'none' ? '' : (o?.value ?? '') }, 'Default purchase tax')} disabled={busy !== null} />
          </Field>
          <PillSelect label="Payment terms" soft value={d.terms} onChange={(v) => void save('terms', { terms: v }, 'Default payment terms')} options={termOptions} disabled={busy !== null} />
        </div>
        )}
      </Card>

      {GROUPS.map((g, i) => (
        <Card key={g.title} delay={Math.min(5, i + 2)}>
          <CardHeader title={g.title} />
          <div className="flex flex-col">
            {g.keys.map(([key, label, types]) => {
              const acc = accounts[key] ?? null;
              return (
                <div key={key} className="grid grid-cols-1 items-center gap-2 border-b border-[var(--erp-line)] py-3 last:border-b-0 @min-[640px]:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] @min-[640px]:gap-4">
                  <span className="text-[14px] font-semibold">{label}</span>
                  <AccountPicker
                    value={acc !== null ? accountOption(acc) : null}
                    onChange={(o) => {
                      if (o === null) return;
                      const code = (o.data as { code?: string } | undefined)?.code ?? o.id;
                      void save(key, { accounts: { [key]: code } }, label);
                    }}
                    types={types}
                    disabled={busy !== null}
                  />
                </div>
              );
            })}
          </div>
        </Card>
      ))}
    </div>
  );
}
