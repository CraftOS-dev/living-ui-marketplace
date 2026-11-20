/**
 * A filing worksheet on A4 (#/print/payroll/filing/<id>), and a run's cash
 * or cheque list (#/print/payroll/cash/<run>?method=cash) with a signature
 * column for the people who receive their pay.
 */
import type { ReactNode } from 'react';
import type { PageProps } from '../../../lib/contract.ts';
import { fmtDay } from '../../../lib/format.ts';
import { Money } from '../../../components/ui.tsx';
import { t } from '../../../lib/i18n.ts';
import { useOp } from '../../../lib/live.ts';
import { PrintHead, PrintTable } from '../index.tsx';
import type { CashList, FilingDetail } from '../../payroll/out/types.ts';

type Head = { label: string; right?: boolean }[];

export function FilingPrint({ params }: PageProps): React.JSX.Element {
  const live = useOp<{ filing: FilingDetail }>('filings.get', { filing: params['id'] ?? '' }, ['filings'], { name: 'print.filing' });
  const f = live.data?.filing ?? null;
  if (f === null) return <p className="text-[12px] text-[#555]">{live.error ?? t('ui.loading')}</p>;
  const ws = f.worksheet;
  const money = (v: number): React.JSX.Element => <Money minor={v} currency={ws.currency} format={{ display: 'code' }} always />;
  const codes = ws.codes.map((c) => c.code);
  return (
    <>
      <PrintHead entity={f.entity_name} title={f.name} meta={`${f.period} · ${t('po.print.due', { day: f.due_day !== '' ? fmtDay(f.due_day, { year: 'always', entity: f.entity }) : t('po.due.none') })}`} />
      <p className="mb-3 text-[12px] text-[#555]">
        {f.form}
        {f.payee !== '' ? ' · ' + f.payee : ''}
        {f.reference !== '' ? ' · ' + t('po.print.reference', { reference: f.reference }) : ''}
      </p>
      <PrintTable head={[{ label: t('po.print.item') }, { label: t('po.print.code') }, { label: t('po.print.amount'), right: true }]} rows={ws.codes.map((c) => [c.name, c.code, money(c.amount)])} foot={[t('po.total'), '', money(ws.total_minor)]} />
      {ws.people.length > 0 && (
        <>
          <h2 className="hr-mono mb-1 mt-6 text-[10.5px] uppercase tracking-[0.08em] text-[#555]">{t('po.print.people')}</h2>
          <PrintTable head={([{ label: t('po.print.employee') }] as Head).concat(codes.map((c) => ({ label: c, right: true }))).concat([{ label: t('po.total'), right: true }])} rows={ws.people.map((p): ReactNode[] => [`${p.employee_number} ${p.name}`, ...codes.map((c) => money(p.by_code[c] ?? 0)), money(p.total_minor)])} />
        </>
      )}
      <p className="mt-6 text-[12px] text-[#777]">{t('po.print.runs', { runs: ws.runs.map((r) => r.number).join(', ') })}</p>
    </>
  );
}

export function CashPrint({ params, query }: PageProps): React.JSX.Element {
  const method = query.get('method') === 'cheque' ? 'cheque' : 'cash';
  const live = useOp<CashList>('payout.list', { payrun: params['run'] ?? '', method }, ['payout_lists'], { name: 'print.cash' });
  const d = live.data;
  if (d === null) return <p className="text-[12px] text-[#555]">{live.error ?? t('ui.loading')}</p>;
  const money = (v: number): React.JSX.Element => <Money minor={v} currency={d.currency} format={{ display: 'code' }} always />;
  return (
    <>
      <PrintHead entity={d.run.entity_name} title={t('po.cash.' + method + '_list')} meta={`${d.run.number} · ${fmtDay(d.run.pay_date, { year: 'always', entity: d.run.entity })}`} />
      <PrintTable
        head={([{ label: t('po.print.employee') }] as Head).concat(method === 'cheque' ? [{ label: t('po.cash.cheque_number') }] : []).concat([{ label: t('po.print.amount'), right: true }, { label: t('po.print.signature') }])}
        rows={d.rows.map((r): ReactNode[] => [`${r.employee_number} ${r.name}`, ...(method === 'cheque' ? [r.cheque_number] : []), money(r.amount_minor), ''])}
        foot={[t('po.total'), ...(method === 'cheque' ? [''] : []), money(d.total_minor), '']}
      />
      {d.denominations.length > 0 && (
        <p className="hr-mono mt-4 text-[12px]">
          {t('po.cash.draw')}: {d.denominations.map((x) => x.count + ' × ' + money(x.value_minor)).join(', ')}
        </p>
      )}
    </>
  );
}
