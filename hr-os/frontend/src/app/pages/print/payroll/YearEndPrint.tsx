/**
 * Year-end documents on A4: one person (or everyone, one page each) from
 * locked runs (#/print/payroll/year-end/<doc>?entity=&year=&employment=),
 * and an issued document as its employee sees it
 * (#/print/payroll/year-end/doc/<id>). The entity's name as plain text.
 */
import type { ReactNode } from 'react';
import type { PageProps } from '../../../lib/contract.ts';
import { fmtDay, fmtStampDay } from '../../../lib/format.ts';
import { Money } from '../../../components/ui.tsx';
import { t } from '../../../lib/i18n.ts';
import { useOp } from '../../../lib/live.ts';
import { PrintHead, PrintTable } from '../index.tsx';
import type { DocBox, DocPerson, Employer, YearDoc } from '../../payroll/out/types.ts';

function addressText(a: Record<string, string> | undefined): string {
  if (!a) return '';
  return [a['line1'], a['line2'], a['city'], a['region'], a['postcode'], a['country']].filter((x) => x !== undefined && x !== '').join(', ');
}

function taxIds(e: Employer): string {
  return Object.entries(e.tax_ids ?? {})
    .map(([k, v]) => k + ' ' + v)
    .join(' · ');
}

interface Sheet {
  doc: YearDoc['doc'];
  range: YearDoc['range'];
  employer: Employer;
  currency: string;
  person: DocPerson;
  boxes: Record<string, number>;
  quarters?: Record<string, Record<string, number>> | null;
  state?: Record<string, number> | null;
  yea_done?: boolean;
}

function DocSheet({ s, entity, issued }: { s: Sheet; entity: string; issued?: { at: string; hash: string } | undefined }): React.JSX.Element {
  const money = (v: number | undefined): React.JSX.Element => <Money minor={v ?? 0} currency={s.currency} format={{ display: 'code' }} always />;
  const boxRows: ReactNode[][] = s.doc.boxes.map((b: DocBox) => [<span key="k" className="hr-mono">{b.key}</span>, b.label, money(s.boxes[b.key])]);
  return (
    <section className="break-inside-avoid [&+section]:mt-10 [&+section]:break-before-page">
      <PrintHead entity={s.employer.legal_name || s.employer.name} address={[addressText(s.employer.address), taxIds(s.employer)].filter((x) => x !== '').join('\n')} title={s.doc.name} meta={`${s.range.label} · ${fmtDay(s.range.start, { year: 'always', entity })} · ${fmtDay(s.range.end, { year: 'always', entity })}`} />
      <div className="mb-4 grid grid-cols-2 gap-4 text-[12px]">
        <div>
          <div className="hr-mono text-[10.5px] uppercase tracking-[0.08em] text-[#555]">{t('po.print.employee')}</div>
          <div className="text-[14px] font-semibold">{s.person.legal_name || s.person.name}</div>
          {s.person.kana !== '' && <div className="text-[#555]">{s.person.kana}</div>}
          <div className="text-[#555]">{addressText(s.person.address)}</div>
        </div>
        <div className="text-right">
          <div className="hr-mono text-[10.5px] uppercase tracking-[0.08em] text-[#555]">{t('po.print.numbers')}</div>
          <div className="hr-mono">{s.person.number}</div>
          {s.person.id && (
            <div className="hr-mono">
              {s.person.id.type.toUpperCase()} {s.person.id.masked}
            </div>
          )}
          {s.person.end_day !== '' && <div>{t('po.print.left_on', { day: fmtDay(s.person.end_day, { year: 'always', entity }) })}</div>}
          {Object.entries(s.person.profile ?? {}).map(([k, v]) => (
            <div key={k} className="hr-mono">
              {k}: {String(v)}
            </div>
          ))}
        </div>
      </div>
      <PrintTable head={[{ label: t('po.print.box') }, { label: t('po.print.item') }, { label: t('po.print.amount'), right: true }]} rows={boxRows} />
      {s.quarters && Object.keys(s.quarters).length > 0 && (
        <>
          <h2 className="hr-mono mb-1 mt-5 text-[10.5px] uppercase tracking-[0.08em] text-[#555]">{t('po.print.quarters')}</h2>
          <PrintTable head={([{ label: t('po.print.quarter') }] as { label: string; right?: boolean }[]).concat(s.doc.boxes.map((b) => ({ label: b.label, right: true })))} rows={Object.keys(s.quarters).sort().map((q) => [('Q' + q) as ReactNode].concat(s.doc.boxes.map((b) => money(s.quarters?.[q]?.[b.key]))))} />
        </>
      )}
      {s.state && Object.keys(s.state).length > 0 && (
        <>
          <h2 className="hr-mono mb-1 mt-5 text-[10.5px] uppercase tracking-[0.08em] text-[#555]">{t('po.print.state_lines')}</h2>
          <PrintTable head={[{ label: t('po.print.item') }, { label: t('po.print.amount'), right: true }]} rows={Object.entries(s.state).map(([k, v]) => [<span key="c" className="hr-mono">{k}</span>, money(v)])} />
        </>
      )}
      {s.doc.yea && <p className="mt-3 text-[12px] text-[#555]">{s.yea_done === true ? t('po.print.yea_done') : t('po.print.yea_not_done')}</p>}
      {s.doc.note !== '' && <p className="mt-3 text-[12px] text-[#555]">{s.doc.note}</p>}
      <p className="mt-6 text-[12px] text-[#777]">{issued !== undefined ? t('po.print.issued', { when: fmtStampDay(issued.at, { year: 'always', entity }), hash: issued.hash.slice(0, 16) }) : t('po.print.from_locked')}</p>
    </section>
  );
}

export function YearEndPrint({ params, query }: PageProps): React.JSX.Element {
  const doc = params['doc'] ?? '';
  const employment = query.get('employment') ?? '';
  const live = useOp<YearDoc>('yearend.document', { entity: query.get('entity') ?? '', doc, year: query.get('year') ?? undefined, employment: employment === '' ? undefined : employment }, ['payslips', 'payruns'], { name: 'print.yearend' });
  const d = live.data;
  if (d === null) return <p className="text-[12px] text-[#555]">{live.error ?? t('ui.loading')}</p>;
  if (d.doc.per === 'entity')
    return (
      <>
        <PrintHead entity={d.employer.legal_name} address={taxIds(d.employer)} title={d.doc.name} meta={d.range.label} />
        <PrintTable head={[{ label: t('po.print.box') }, { label: t('po.print.item') }, { label: t('po.print.amount'), right: true }]} rows={d.doc.boxes.map((b) => [b.key, b.label, <Money key={b.key} minor={d.totals[b.key] ?? 0} currency={d.currency} format={{ display: 'code' }} always />])} />
      </>
    );
  if (d.rows.length === 0) return <p className="text-[12px] text-[#555]">{t('po.yearend.nobody')}</p>;
  return (
    <>
      {d.rows.map((r) => (
        <DocSheet key={r.employment} entity={query.get('entity') ?? ''} s={{ doc: d.doc, range: d.range, employer: d.employer, currency: d.currency, person: r.person, boxes: r.boxes, quarters: r.quarters ?? null, state: r.state ?? null, yea_done: r.yea_done === true }} />
      ))}
    </>
  );
}

export function IssuedDocPrint({ params }: PageProps): React.JSX.Element {
  const live = useOp<{ document: { id: string; entity: string; issued_at: string; hash: string; data: Sheet } }>('yearend.view', { id: params['id'] ?? '' }, ['yearend_docs'], { name: 'print.yearend.issued' });
  const d = live.data?.document ?? null;
  if (d === null) return <p className="text-[12px] text-[#555]">{live.error ?? t('ui.loading')}</p>;
  return <DocSheet s={d.data} entity={d.entity} issued={{ at: d.issued_at, hash: d.hash }} />;
}
