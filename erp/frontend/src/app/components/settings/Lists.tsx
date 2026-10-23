/**
 * Taxes, payment terms and currencies: short lists of data the documents
 * use, each with add, change and archive. Who may change them follows the
 * server: taxes need full Accounting, terms Accounting edit (or full
 * Sales), rates Accounting edit; administrators always may.
 */
import { useState } from 'react';
import { Archive, ArchiveRestore, Check, Coins, PenLine, Percent, Plus, RefreshCw, Timer } from 'lucide-react';
import { toast } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { dayLabel } from '../../lib/dates.ts';
import { CURRENCIES, currencyName } from '../../lib/format.ts';
import { useLive } from '../../lib/live.ts';
import { can, useMe } from '../../lib/me.ts';
import type { Currency, Tax, Terms } from '../../lib/types/settings.ts';
import { Menu, Segmented } from '../controls.tsx';
import type { Option } from '../pickers.tsx';
import { AccountPicker, DateField, NumberInput, accountOption } from '../pickers.tsx';
import { DataTable } from '../table.tsx';
import { Card, CardHeader, Empty, Field, LoadError, Modal, Notice, PillButton, PillSelect, ToggleRow, softInput } from '../ui.tsx';

/* ================================================================= taxes */

const SCOPE: Record<Tax['scope'], string> = { sales: 'Sales', purchase: 'Purchases', both: 'Sales and purchases' };

export function TaxesSection(): React.JSX.Element {
  const me = useMe();
  const edit = me.admin || can(me, 'accounting', 'full');
  const [archived, setArchived] = useState(false);
  const data = useLive(() => op<{ taxes: Tax[] }>('taxes.list', { archived }, { quiet: true }), ['taxes', 'accounts'], [archived]);
  const [editing, setEditing] = useState<Tax | 'new' | null>(null);

  const setArchive = async (t: Tax, value: boolean): Promise<void> => {
    try {
      await op('taxes.update', { tax: t.code, archived: value });
      toast.success(value ? `${t.name} archived` : `${t.name} restored`);
      data.reload();
    } catch {
      /* shown */
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {!edit && <Notice>Taxes are changed by someone with full Accounting rights or an administrator.</Notice>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented<'active' | 'all'> ariaLabel="Show" onShell value={archived ? 'all' : 'active'} onChange={(v) => setArchived(v === 'all')} options={[{ value: 'active', label: 'In use' }, { value: 'all', label: 'With archived' }]} />
        {edit && (
          <PillButton icon={Plus} dot onClick={() => setEditing('new')}>
            Add tax
          </PillButton>
        )}
      </div>
      <Card delay={1}>
        {data.data === null && data.error !== null ? (
          <LoadError message={data.error} onRetry={data.reload} />
        ) : (
          <DataTable
            ariaLabel="Taxes"
            loading={data.data === null}
            rows={data.data?.taxes ?? []}
            rowKey={(t) => t.id}
            onOpen={edit ? (t) => setEditing(t) : undefined}
            rowTone={(t) => (t.archived ? 'muted' : undefined)}
            empty={<Empty icon={Percent} title="No taxes yet" compact />}
            columns={[
              {
                key: 'name',
                label: 'Tax',
                width: 'minmax(0, 1.4fr)',
                render: (t) => (
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{t.name}</span>
                    <span className="block truncate text-[12px] text-[var(--erp-muted)]">
                      {t.code}
                      {t.archived ? ' · Archived' : ''}
                    </span>
                  </span>
                ),
              },
              { key: 'rate', label: 'Rate', align: 'right', width: '72px', render: (t) => `${t.rate}%` },
              { key: 'scope', label: 'Charged on', width: '170px', hide: 'md', render: (t) => <span className="truncate text-[13px]">{SCOPE[t.scope]}</span> },
              { key: 'rec', label: 'Claimed back', width: '110px', hide: 'lg', render: (t) => <span className="text-[13px]">{t.scope === 'sales' ? '' : t.recoverable ? 'Yes' : 'No'}</span> },
              {
                key: 'acc',
                label: 'Accounts',
                width: 'minmax(0, 1.8fr)',
                hide: 'xl',
                render: (t) => (
                  <span className="min-w-0 text-[12px] text-[var(--erp-ink-2)]">
                    {t.sales_account !== null && <span className="block truncate">Collected: {t.sales_account.code} {t.sales_account.name}</span>}
                    {t.purchase_account !== null && <span className="block truncate">Paid: {t.purchase_account.code} {t.purchase_account.name}</span>}
                  </span>
                ),
              },
              {
                key: 'menu',
                label: '',
                width: '44px',
                align: 'right',
                render: (t) =>
                  edit ? (
                    <Menu
                      variant="row"
                      size={34}
                      label={`Actions for ${t.name}`}
                      items={[
                        { label: 'Change', icon: PenLine, onClick: () => setEditing(t) },
                        { label: t.archived ? 'Restore' : 'Archive', icon: t.archived ? ArchiveRestore : Archive, onClick: () => void setArchive(t, !t.archived) },
                      ]}
                    />
                  ) : null,
              },
            ]}
            mobile={(t) => ({ title: t.name, sub: `${t.code} · ${SCOPE[t.scope]}${t.archived ? ' · Archived' : ''}`, right: `${t.rate}%` })}
          />
        )}
      </Card>
      {editing !== null && <TaxModal tax={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => data.reload()} />}
    </div>
  );
}

function TaxModal({ tax, onClose, onSaved }: { tax: Tax | null; onClose: () => void; onSaved: () => void }): React.JSX.Element {
  const [name, setName] = useState(tax?.name ?? '');
  const [code, setCode] = useState(tax?.code ?? '');
  const [rate, setRate] = useState(tax?.rate ?? '');
  const [scope, setScope] = useState<Tax['scope']>(tax?.scope ?? 'both');
  const [recoverable, setRecoverable] = useState(tax?.recoverable ?? true);
  const [sales, setSales] = useState<Option | null>(tax?.sales_account ? accountOption(tax.sales_account) : null);
  const [purchase, setPurchase] = useState<Option | null>(tax?.purchase_account ? accountOption(tax.purchase_account) : null);
  const [description, setDescription] = useState(tax?.description ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const p = {
      name: name.trim(),
      code: code.trim(),
      rate: rate === '' ? '0' : rate,
      scope,
      recoverable,
      sales_account: sales?.data !== undefined ? (sales.data as { code: string }).code : tax?.sales_account?.code,
      purchase_account: purchase?.data !== undefined ? (purchase.data as { code: string }).code : tax?.purchase_account?.code,
      description: description.trim(),
    };
    try {
      if (tax === null) await op('taxes.add', p, { quiet: true });
      else await op('taxes.update', { tax: tax.code, ...p }, { quiet: true });
      toast.success(tax === null ? `${p.name} added` : `${p.name} saved`);
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={tax === null ? 'Add a tax' : `Change ${tax.name}`}
      size="lg"
      footer={
        <>
          <PillButton variant="soft" onClick={onClose}>
            Cancel
          </PillButton>
          <PillButton icon={Check} dot loading={busy} disabled={name.trim() === '' || code.trim() === ''} onClick={() => void save()}>
            {tax === null ? 'Add tax' : 'Save'}
          </PillButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error !== null && <Notice tone="bad">{error}</Notice>}
        {tax !== null && <Notice tone="neutral">A rate already used on posted documents does not change: archive this tax and add a new one.</Notice>}
        <div className="grid grid-cols-1 gap-4 @min-[640px]:grid-cols-[minmax(0,1fr)_140px_120px]">
          <Field label="Name">
            <input className={softInput} value={name} onChange={(e) => setName(e.target.value)} placeholder="VAT 20%" maxLength={80} autoFocus />
          </Field>
          <Field label="Code">
            <input className={softInput} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="VAT20" maxLength={20} />
          </Field>
          <Field label="Rate">
            <NumberInput value={rate} onChange={setRate} ariaLabel="Rate" decimals={4} suffix="%" />
          </Field>
        </div>
        <Field label="Charged on">
          <Segmented<Tax['scope']> ariaLabel="Charged on" value={scope} onChange={setScope} options={[{ value: 'sales', label: 'Sales' }, { value: 'purchase', label: 'Purchases' }, { value: 'both', label: 'Both' }]} className="w-full @min-[640px]:w-auto" />
        </Field>
        {scope !== 'sales' && <ToggleRow title="Claimed back" text="Tax paid on purchases is recovered from the tax office" checked={recoverable} onChange={setRecoverable} />}
        <div className="grid grid-cols-1 gap-4 @min-[640px]:grid-cols-2">
          {scope !== 'purchase' && (
            <Field label="Tax collected goes to">
              <AccountPicker value={sales} onChange={setSales} types={['liability']} placeholder="Tax payable" />
            </Field>
          )}
          {scope !== 'sales' && (
            <Field label="Tax paid goes to">
              <AccountPicker value={purchase} onChange={setPurchase} types={['asset', 'expense']} placeholder="Tax receivable" />
            </Field>
          )}
        </div>
        <Field label="Description" optional>
          <input className={softInput} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} />
        </Field>
      </div>
    </Modal>
  );
}

/* ========================================================= payment terms */

function termsText(t: Terms): string {
  if (t.end_of_month) return 'Due at the end of the next month';
  if (t.days === 0) return 'Due on receipt';
  return `Due ${t.days} days after the document date`;
}

export function TermsSection(): React.JSX.Element {
  const me = useMe();
  const edit = me.admin || can(me, 'accounting', 'edit') || can(me, 'sales', 'full');
  const data = useLive(() => op<{ terms: Terms[] }>('terms.list', {}, { quiet: true }), ['payment_terms'], []);
  const [editing, setEditing] = useState<Terms | 'new' | null>(null);
  const archive = async (t: Terms): Promise<void> => {
    try {
      await op('terms.update', { terms: t.name, archived: true });
      toast.success(`${t.name} archived`);
      data.reload();
    } catch {
      /* shown */
    }
  };
  return (
    <div className="flex flex-col gap-5">
      {!edit && <Notice>Payment terms are changed by Accounting, full Sales rights or an administrator.</Notice>}
      {edit && (
        <div className="flex justify-end">
          <PillButton icon={Plus} dot onClick={() => setEditing('new')}>
            Add terms
          </PillButton>
        </div>
      )}
      <Card delay={1}>
        {data.data === null && data.error !== null ? (
          <LoadError message={data.error} onRetry={data.reload} />
        ) : (
          <DataTable
            ariaLabel="Payment terms"
            loading={data.data === null}
            rows={data.data?.terms ?? []}
            rowKey={(t) => t.id}
            onOpen={edit ? (t) => setEditing(t) : undefined}
            empty={<Empty icon={Timer} title="No payment terms yet" compact />}
            columns={[
              { key: 'name', label: 'Name', width: 'minmax(0, 1fr)', render: (t) => <span className="truncate font-semibold">{t.name}</span> },
              { key: 'when', label: 'Falls due', width: 'minmax(0, 1.6fr)', render: (t) => <span className="truncate text-[13px] text-[var(--erp-ink-2)]">{termsText(t)}</span> },
              {
                key: 'menu',
                label: '',
                width: '44px',
                align: 'right',
                render: (t) =>
                  edit ? (
                    <Menu
                      variant="row"
                      size={34}
                      label={`Actions for ${t.name}`}
                      items={[
                        { label: 'Change', icon: PenLine, onClick: () => setEditing(t) },
                        { label: 'Archive', icon: Archive, onClick: () => void archive(t) },
                      ]}
                    />
                  ) : null,
              },
            ]}
            mobile={(t) => ({ title: t.name, sub: termsText(t) })}
          />
        )}
      </Card>
      {editing !== null && <TermsModal terms={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => data.reload()} />}
    </div>
  );
}

function TermsModal({ terms, onClose, onSaved }: { terms: Terms | null; onClose: () => void; onSaved: () => void }): React.JSX.Element {
  const [name, setName] = useState(terms?.name ?? '');
  const [days, setDays] = useState(String(terms?.days ?? 30));
  const [eom, setEom] = useState(terms?.end_of_month ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const p = { name: name.trim(), days: Number(days || '0'), end_of_month: eom };
    try {
      if (terms === null) await op('terms.add', p, { quiet: true });
      else await op('terms.update', { terms: terms.name, ...p }, { quiet: true });
      toast.success(`${p.name} saved`);
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={terms === null ? 'Add payment terms' : `Change ${terms.name}`}
      footer={
        <>
          <PillButton variant="soft" onClick={onClose}>
            Cancel
          </PillButton>
          <PillButton icon={Check} dot loading={busy} disabled={name.trim() === ''} onClick={() => void save()}>
            Save
          </PillButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error !== null && <Notice tone="bad">{error}</Notice>}
        <Field label="Name">
          <input className={softInput} value={name} onChange={(e) => setName(e.target.value)} placeholder="Net 45" maxLength={60} autoFocus />
        </Field>
        <ToggleRow title="End of the next month" text="Due on the last day of the month after the document" checked={eom} onChange={setEom} />
        {!eom && (
          <Field label="Days until due" hint="0 means due on receipt">
            <NumberInput value={days} onChange={setDays} ariaLabel="Days until due" decimals={0} suffix="days" />
          </Field>
        )}
      </div>
    </Modal>
  );
}

/* ============================================================ currencies */

export function CurrenciesSection(): React.JSX.Element {
  const me = useMe();
  const edit = me.admin || can(me, 'accounting', 'edit');
  const data = useLive(() => op<{ base: string; currencies: Currency[] }>('currencies.list', {}, { quiet: true }), ['currencies'], []);
  const [editing, setEditing] = useState<Currency | 'new' | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const base = data.data?.base ?? me.company.currency;
  const list = (data.data?.currencies ?? []).filter((c) => !c.base);

  const refresh = async (): Promise<void> => {
    setRefreshing(true);
    try {
      const r = await op<{ updated: number; missing: string[]; source: string }>('currencies.refresh', {});
      toast.success(`${r.updated === 1 ? '1 rate' : `${r.updated} rates`} updated from ${r.source}${r.missing.length > 0 ? `; no rate for ${r.missing.join(', ')}` : ''}`);
      data.reload();
    } catch {
      /* shown */
    } finally {
      setRefreshing(false);
    }
  };
  const archive = async (c: Currency, value: boolean): Promise<void> => {
    try {
      await op('currencies.set', { code: c.code, archived: value });
      data.reload();
    } catch {
      /* shown */
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {!edit && <Notice>Exchange rates are changed by Accounting or an administrator.</Notice>}
      <Card tone="sand" delay={1}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="erp-on-ink flex size-11 items-center justify-center rounded-full bg-[var(--erp-ink)] text-[var(--erp-accent)]">
              <Coins size={20} aria-hidden />
            </span>
            <div>
              <p className="text-[12px] font-semibold text-[var(--erp-muted)]">Base currency</p>
              <p className="text-[15px] font-bold">
                {base} <span className="font-semibold text-[var(--erp-ink-2)]">{currencyName(base)}</span>
              </p>
            </div>
          </div>
          {edit && list.length > 0 && (
            <PillButton variant="light" icon={RefreshCw} loading={refreshing} onClick={() => void refresh()}>
              Get today's rates
            </PillButton>
          )}
        </div>
        <p className="mt-3 text-[13px] leading-5 text-[var(--erp-ink-2)]">The books are kept in {base}. Documents in other currencies are converted at the rate of their date.</p>
      </Card>
      <Card delay={2}>
        <CardHeader
          title="Other currencies"
          action={
            edit ? (
              <PillButton size="sm" icon={Plus} onClick={() => setEditing('new')}>
                Add currency
              </PillButton>
            ) : undefined
          }
        />
        {data.data === null && data.error !== null ? (
          <LoadError message={data.error} onRetry={data.reload} />
        ) : (
          <DataTable
            ariaLabel="Currencies"
            loading={data.data === null}
            rows={list}
            rowKey={(c) => c.id}
            onOpen={edit ? (c) => setEditing(c) : undefined}
            rowTone={(c) => (c.archived ? 'muted' : undefined)}
            empty={<Empty icon={Coins} title={`Only ${base} so far`} compact>Add a currency to quote, bill or pay in it.</Empty>}
            columns={[
              {
                key: 'code',
                label: 'Currency',
                width: 'minmax(0, 1.4fr)',
                render: (c) => (
                  <span className="min-w-0">
                    <span className="block font-semibold">{c.code}</span>
                    <span className="block truncate text-[12px] text-[var(--erp-muted)]">
                      {c.name !== '' ? c.name : currencyName(c.code)}
                      {c.archived ? ' · Archived' : ''}
                    </span>
                  </span>
                ),
              },
              { key: 'rate', label: 'Rate', width: 'minmax(0, 1.4fr)', render: (c) => <span className="num text-[14px]">1 {c.code} = {c.rate} {base}</span> },
              { key: 'date', label: 'As of', width: 'minmax(0, 1fr)', hide: 'md', render: (c) => <span className="text-[13px] text-[var(--erp-ink-2)]">{c.rate_date !== '' ? dayLabel(c.rate_date) : 'Not set'}</span> },
              {
                key: 'menu',
                label: '',
                width: '44px',
                align: 'right',
                render: (c) =>
                  edit ? (
                    <Menu
                      variant="row"
                      size={34}
                      label={`Actions for ${c.code}`}
                      items={[
                        { label: 'Change the rate', icon: PenLine, onClick: () => setEditing(c) },
                        { label: c.archived ? 'Restore' : 'Archive', icon: c.archived ? ArchiveRestore : Archive, onClick: () => void archive(c, !c.archived) },
                      ]}
                    />
                  ) : null,
              },
            ]}
            mobile={(c) => ({ title: `${c.code} ${c.name !== '' ? c.name : currencyName(c.code)}`, sub: c.rate_date !== '' ? `As of ${dayLabel(c.rate_date)}` : 'Rate not set', right: c.rate, rightSub: base })}
          />
        )}
      </Card>
      {editing !== null && (
        <CurrencyModal
          currency={editing === 'new' ? null : editing}
          base={base}
          taken={(data.data?.currencies ?? []).map((c) => c.code)}
          onClose={() => setEditing(null)}
          onSaved={() => data.reload()}
        />
      )}
    </div>
  );
}

function CurrencyModal({ currency, base, taken, onClose, onSaved }: { currency: Currency | null; base: string; taken: string[]; onClose: () => void; onSaved: () => void }): React.JSX.Element {
  const free = CURRENCIES.filter((c) => !taken.includes(c));
  const [code, setCode] = useState(currency?.code ?? free[0] ?? '');
  const [rate, setRate] = useState(currency?.rate ?? '');
  const [date, setDate] = useState(currency?.rate_date ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await op('currencies.set', { code, rate: rate === '' ? undefined : rate, rate_date: date === '' ? undefined : date, ...(currency === null ? { archived: false } : {}) }, { quiet: true });
      toast.success(`${code} saved`);
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={currency === null ? 'Add a currency' : `${currency.code} rate`}
      footer={
        <>
          <PillButton variant="soft" onClick={onClose}>
            Cancel
          </PillButton>
          <PillButton icon={Check} dot loading={busy} disabled={code === '' || rate === ''} onClick={() => void save()}>
            Save
          </PillButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error !== null && <Notice tone="bad">{error}</Notice>}
        {currency === null && <PillSelect label="Currency" soft value={code} onChange={setCode} options={free.map((c) => ({ value: c, label: `${c} ${currencyName(c)}` }))} />}
        <Field label={`1 ${code} is worth`} hint={`How many ${base} one ${code} buys`}>
          <NumberInput value={rate} onChange={setRate} ariaLabel="Rate" decimals={8} suffix={base} />
        </Field>
        <Field label="Rate as of" optional hint="Today when empty">
          <DateField value={date} onChange={setDate} ariaLabel="Rate as of" optional />
        </Field>
      </div>
    </Modal>
  );
}
