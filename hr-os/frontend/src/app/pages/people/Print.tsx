/** A person's record on one A4 page (#/print/people/E0001): job, contact, emergency contacts. */
import type { PageProps } from '../../lib/contract.ts';
import { fmtDay, tenure } from '../../lib/format.ts';
import { t } from '../../lib/i18n.ts';
import { useOp } from '../../lib/live.ts';
import { PrintHead, PrintTable } from '../print/index.tsx';
import type { Profile } from './types.ts';

export function PersonPrint({ params }: PageProps): React.JSX.Element {
  const live = useOp<Profile>('people.get', { employee: params['id'] ?? '' }, ['employees', 'employments', 'job_records'], { name: 'print.person' });
  const p = live.data;
  if (p === null) return <p className="text-[12px] text-[#555]">{live.error ?? t('ui.loading')}</p>;
  const m = p.employments.find((x) => x.id === p.primary_employment) ?? p.employments[0];
  const j = m?.job ?? null;
  const e = p.employee;
  const a = e.address ?? {};
  const row = (label: string, value: string): React.ReactNode[] => [label, value === '' ? '' : value];
  return (
    <>
      <PrintHead entity={m?.entity_name ?? ''} title={t('print.person')} meta={`${e.number} · ${fmtDay(p.as_of, { year: 'always' })}`} />
      <h1 className="mb-1 text-[15px] font-semibold">{e.name}</h1>
      {e.legal_name !== e.name && <p className="mb-4 text-[12px] text-[#555]">{e.legal_name}</p>}
      <h2 className="hr-mono mb-1 mt-5 text-[10.5px] uppercase tracking-[0.08em] text-[#555]">{t('profile.job')}</h2>
      <PrintTable
        head={[{ label: t('print.field') }, { label: t('print.value') }]}
        rows={[
          row(t('people.col.title'), j?.title ?? ''),
          row(t('people.col.department'), j?.department_name ?? ''),
          row(t('people.col.manager'), j?.manager_name ?? ''),
          row(t('people.col.location'), j?.location_name ?? ''),
          row(t('record.employment_type'), j?.employment_type_name ?? ''),
          row(t('people.col.start'), m !== undefined ? fmtDay(m.start_day, { year: 'always' }) : ''),
          row(t('profile.tenure'), m !== undefined ? tenure(m.start_day, p.as_of) : ''),
        ]}
      />
      <h2 className="hr-mono mb-1 mt-5 text-[10.5px] uppercase tracking-[0.08em] text-[#555]">{t('profile.contact')}</h2>
      <PrintTable
        head={[{ label: t('print.field') }, { label: t('print.value') }]}
        rows={[
          row(t('profile.work_email'), e.work_email),
          row(t('profile.phone'), e.phone),
          row(t('profile.address'), [a['line1'], a['line2'], a['city'], a['region'], a['postcode'], a['country']].filter((x) => x !== undefined && x !== '').join(', ')),
        ]}
      />
      {(e.emergency ?? []).length > 0 && (
        <>
          <h2 className="hr-mono mb-1 mt-5 text-[10.5px] uppercase tracking-[0.08em] text-[#555]">{t('profile.emergency')}</h2>
          <PrintTable head={[{ label: t('profile.ec.name') }, { label: t('profile.ec.relation') }, { label: t('profile.phone') }]} rows={(e.emergency ?? []).map((c) => [c.name, c.relation, c.phone])} />
        </>
      )}
    </>
  );
}
