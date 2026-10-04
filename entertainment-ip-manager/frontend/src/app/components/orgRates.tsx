/**
 * Settings, Exchange rates: currency rates as units per 1 EUR (the ECB's
 * reference convention). ECB rates refresh automatically; managers refresh
 * them now and enter manual rates for currencies the ECB does not publish
 * (TWD, VND). The ECB refresh never overwrites a manual row.
 */
import { useMemo, useState } from 'react';
import { AlertTriangle, Pencil, Plus, RefreshCw, TrendingUp } from 'lucide-react';
import { Button, Dialog, Input, Select, toast } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { createRecord, errText, op, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { ago, d10, fmtDate, toPb, today } from '../lib/format.ts';
import { enumLabel, t } from '../lib/i18n.ts';
import { CURRENCIES } from '../lib/labels.ts';
import type { FxRateRec } from '../lib/records.ts';
import { EmptyHint, ErrorBox, Loading, Notice, Pill, Section } from './ui.tsx';
import { DialogBody, ReadOnlyNote, num } from './orgShared.tsx';
import { DeleteButton } from './deleteRecord.tsx';

function fmtRate(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '-';
  return n.toLocaleString(undefined, { maximumSignificantDigits: 6 });
}

export function RatesTab(): React.JSX.Element {
  const { can, settings, homeCurrency } = useApp();
  const rates = useCollection<FxRateRec>('fx_rates', { sort: 'code' });
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<FxRateRec | 'new' | null>(null);
  const [newCode, setNewCode] = useState('');

  const byCode = useMemo(() => new Map(rates.records.map((r) => [r.code.toUpperCase(), r])), [rates.records]);
  const home = byCode.get(homeCurrency);
  const missing = CURRENCIES.filter((c) => !byCode.has(c) || (byCode.get(c)?.per_eur ?? 0) <= 0);
  const twdMissing = missing.includes('TWD');

  const refresh = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await op<{ updated: number; as_of: string }>('fx/refresh', {});
      toast.success(t('{n} ECB rates updated (as of {date}). Manual rates were left as they are.', { n: r.updated, date: fmtDate(r.as_of) }));
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {!can.manage && <ReadOnlyNote>{t('Only administrators and managers can change exchange rates.')}</ReadOnlyNote>}
      <Notice tone="info" icon={TrendingUp}>
        {t('Rates are stored as units of a currency per 1 EUR, the European Central Bank convention. For example JPY 162.5 means 1 EUR = 162.5 yen. Amounts convert through EUR: any two currencies with a rate can be converted. ECB rates refresh automatically every day; currencies the ECB does not publish need a manual rate, which the refresh never overwrites.')}
      </Notice>
      {twdMissing && (
        <Notice tone="warn" icon={AlertTriangle}>
          <div className="flex flex-col gap-2">
            <span>{t('There is no TWD rate. The ECB does not publish the Taiwan dollar, so Taiwan fees and royalties in TWD cannot be converted to the home currency until someone enters a manual rate.')}</span>
            {can.manage && (
              <div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setNewCode('TWD');
                    setEditing('new');
                  }}
                >
                  <Plus size={13} aria-hidden /> {t('Enter a TWD rate')}
                </Button>
              </div>
            )}
          </div>
        </Notice>
      )}
      {missing.filter((c) => c !== 'TWD').length > 0 && (
        <p className="text-xs leading-relaxed text-[var(--agent-app-muted)]">{t('No rate yet for: {list}.', { list: missing.filter((c) => c !== 'TWD').join(', ') })}</p>
      )}

      <Section
        title={t('Exchange rates')}
        meta={settings?.fx_updated ? t('ECB refresh {when}', { when: ago(settings.fx_updated) }) : undefined}
        flush
        actions={
          can.manage ? (
            <>
              <Button size="sm" variant="ghost" loading={busy} onClick={() => void refresh()}>
                <RefreshCw size={13} aria-hidden /> <span className="hidden sm:inline">{t('Refresh ECB rates')}</span>
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setNewCode('');
                  setEditing('new');
                }}
              >
                <Plus size={13} aria-hidden /> {t('Add a rate')}
              </Button>
            </>
          ) : undefined
        }
      >
        {rates.loading ? (
          <Loading />
        ) : rates.error !== null ? (
          <div className="p-4">
            <ErrorBox message={rates.error} onRetry={rates.refresh} />
          </div>
        ) : rates.records.length === 0 ? (
          <EmptyHint compact icon={TrendingUp} title={t('No rates yet')} message={t('Refresh the ECB rates or add a manual rate.')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-[var(--agent-app-border)] text-left text-[11px] uppercase tracking-wider text-[var(--agent-app-muted)]">
                  <th className="px-4 py-2 font-semibold">{t('Currency')}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t('Units per 1 EUR')}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t('1 unit in {home}', { home: homeCurrency })}</th>
                  <th className="px-3 py-2 font-semibold">{t('Source|rate')}</th>
                  <th className="px-3 py-2 font-semibold">{t('As of')}</th>
                  {can.manage && <th className="px-3 py-2" />}
                </tr>
              </thead>
              <tbody>
                {rates.records.map((r) => {
                  const inHome = home !== undefined && home.per_eur > 0 && r.per_eur > 0 ? home.per_eur / r.per_eur : NaN;
                  return (
                    <tr key={r.id} className="border-b border-[var(--agent-app-border)]/70 last:border-0">
                      <td className="px-4 py-1.5 font-mono font-semibold">{r.code}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{fmtRate(r.per_eur)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{fmtRate(inHome)}</td>
                      <td className="px-3 py-1.5">
                        <Pill tone={r.source === 'manual' ? 'accent' : 'neutral'}>{enumLabel('fx_rates.source', r.source) || t('Unknown')}</Pill>
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{fmtDate(r.as_of)}</td>
                      {can.manage && (
                        <td className="whitespace-nowrap px-3 py-1.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button size="sm" variant="ghost" className="h-7 px-2" aria-label={t('Edit {code}', { code: r.code })} onClick={() => setEditing(r)}>
                              <Pencil size={13} aria-hidden />
                            </Button>
                            {r.code !== 'EUR' && <DeleteButton collection="fx_rates" id={r.id} iconOnly label={t('Delete {code}', { code: r.code })} />}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      {editing !== null && <RateDialog rate={editing === 'new' ? null : editing} code={newCode} existing={byCode} onClose={() => setEditing(null)} />}
    </div>
  );
}

function RateDialog({ rate, code, existing, onClose }: { rate: FxRateRec | null; code: string; existing: Map<string, FxRateRec>; onClose: () => void }): React.JSX.Element {
  const [c, setC] = useState((rate?.code ?? code).toUpperCase());
  const [perEur, setPerEur] = useState(rate !== null ? String(rate.per_eur) : '');
  const [asOf, setAsOf] = useState(d10(rate?.as_of) || today());
  const [busy, setBusy] = useState(false);
  const clash = rate === null ? existing.get(c) : undefined;
  const ok = /^[A-Z]{3}$/.test(c) && num(perEur) > 0 && d10(asOf) !== '';

  const save = async (): Promise<void> => {
    if (!ok) return;
    setBusy(true);
    const body = { code: c, per_eur: num(perEur), as_of: toPb(asOf), source: 'manual' };
    try {
      const target = rate ?? clash ?? null;
      if (target !== null) await updateRecord('fx_rates', target.id, body);
      else await createRecord('fx_rates', body);
      toast.success(t('{code} rate saved as a manual rate', { code: c }));
      onClose();
    } catch {
      /* the client already showed the server's message */
    } finally {
      setBusy(false);
    }
  };

  const suggestions = CURRENCIES.filter((x) => !existing.has(x));

  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      title={rate === null ? t('Add a manual rate') : t('Edit the {code} rate', { code: rate.code })}
      description={t('Enter how many units of the currency one euro buys, from a source you trust (for example the central bank of that currency).')}
      className="w-[min(94vw,32rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button loading={busy} disabled={!ok} onClick={() => void save()}>
            {t('Save')}
          </Button>
        </>
      }
    >
      <DialogBody>
        {rate === null ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label={t('Currency code')} className="font-mono uppercase" maxLength={3} placeholder="TWD" value={c} onChange={(e) => setC(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} />
            {suggestions.length > 0 && (
              <Select label={t('Or choose')} value="" placeholder={t('Choose')} options={suggestions.map((x) => ({ value: x, label: x }))} onChange={(e) => setC(e.target.value)} />
            )}
          </div>
        ) : (
          <p className="font-mono text-sm font-semibold">{rate.code}</p>
        )}
        <Input label={t('Units per 1 EUR')} type="number" min={0} step="any" value={perEur} placeholder={t('For example 35.2 for TWD')} onChange={(e) => setPerEur(e.target.value)} />
        {/^[A-Z]{3}$/.test(c) && num(perEur) > 0 && <p className="-mt-2 text-xs text-[var(--agent-app-muted)] tabular-nums">{t('1 EUR = {rate} {code}', { rate: fmtRate(num(perEur)), code: c })}</p>}
        <Input label={t('As of')} type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        {rate !== null && rate.source === 'ecb' && <Notice tone="warn">{t('Saving makes this a manual rate: the daily ECB refresh will no longer update it.')}</Notice>}
        {clash !== undefined && <Notice tone="warn">{t('{code} already has a rate; saving replaces it with this manual rate.', { code: c })}</Notice>}
      </DialogBody>
    </Dialog>
  );
}
