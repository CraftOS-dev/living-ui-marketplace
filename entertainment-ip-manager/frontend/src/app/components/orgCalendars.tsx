/**
 * Settings, Calendars: the days each office is closed (and make-up working
 * days in China, Korea and Taiwan), used for business-day periods and to
 * move statutory deadlines to the next open day. Managers add and remove
 * days and refresh the computed or official lists; anyone can use the
 * business-day calculator.
 */
import { useState } from 'react';
import { CalendarOff, Calculator, Plus, RefreshCw } from 'lucide-react';
import { Button, Dialog, Input, Select, toast } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { createRecord, errText, op, q } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { d10, fmtDate, today, toPb, weekdayName } from '../lib/format.ts';
import { bi, enumLabel, t } from '../lib/i18n.ts';
import { OFFICES, jurisdictionName } from '../lib/labels.ts';
import type { OfficeCalendarRec } from '../lib/records.ts';
import type { Bi } from '../lib/shapes.ts';
import { Checkbox, EmptyHint, ErrorBox, Loading, Notice, Pill, Section, Tag } from './ui.tsx';
import { DialogBody, ReadOnlyNote, num } from './orgShared.tsx';
import { DeleteButton } from './deleteRecord.tsx';

const COMPUTED = ['US', 'EM', 'JP', 'WO'];
const OFFICIAL_ONLY = ['CN', 'KR', 'TW'];

export function CalendarsTab(): React.JSX.Element {
  const { can, settings } = useApp();
  const thisYear = Number(today().slice(0, 4));
  const [office, setOffice] = useState((settings?.work_calendar || 'JP').toUpperCase());
  const [year, setYear] = useState(thisYear);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  const days = useCollection<OfficeCalendarRec>('office_calendars', {
    filter: `office = ${q(office)} && date >= "${year}-01-01 00:00:00.000Z" && date <= "${year}-12-31 23:59:59.999Z"`,
    sort: 'date',
  });
  const years = Array.from({ length: 6 }, (_, i) => thisYear - 1 + i);
  const computed = COMPUTED.includes(office);
  const closures = days.records.filter((r) => !r.working_day);
  const makeUps = days.records.filter((r) => r.working_day);

  const refresh = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await op<Record<string, unknown>>('calendars/refresh', { office, year });
      const jp = r['JP_official'];
      if (office === 'JP' && typeof jp === 'object' && jp !== null && 'error' in jp) {
        toast.info(t('Computed days for {office} {year} were regenerated, but the Cabinet Office list could not be fetched: {error}', { office, year, error: String((jp as { error: unknown }).error) }));
      } else if (office === 'JP' && typeof jp === 'object' && jp !== null) {
        const x = jp as { added?: number; removed?: number };
        toast.success(t('Japanese holidays refreshed from the Cabinet Office list: {added} added, {removed} removed.', { added: x.added ?? 0, removed: x.removed ?? 0 }));
      } else {
        toast.success(t('Closure days for {office} {year} regenerated', { office, year }));
      }
      days.refresh();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  };

  const dayRow = (r: OfficeCalendarRec): React.JSX.Element => (
    <div key={r.id} className="group flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--agent-app-border)]/70 px-4 py-1.5 last:border-0">
      <div className="w-32 shrink-0 tabular-nums text-[13px]">{fmtDate(r.date)}</div>
      <div className="hidden w-20 shrink-0 text-xs text-[var(--agent-app-muted)] sm:block">{weekdayName(r.date)}</div>
      <div className="min-w-0 flex-1 basis-32 truncate text-[13px]">{r.name}</div>
      {r.working_day && <Pill tone="info">{t('Working day')}</Pill>}
      <Tag>{enumLabel('office_calendars.source', r.source) || t('Unknown')}</Tag>
      <DeleteButton collection="office_calendars" id={r.id} iconOnly label={t('Remove {name}|day', { name: r.name })} className="opacity-60 group-hover:opacity-100" />
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {!can.manage && <ReadOnlyNote>{t('Only administrators and managers can change closure days.')}</ReadOnlyNote>}
      <Notice tone="info" icon={CalendarOff}>
        {t('Weekends are always closed and are not listed. Japan follows the Cabinet Office holiday list plus the year-end closure (29 December to 3 January). US, EUIPO and WIPO days are computed from their usual pattern. China, Korea and Taiwan use the official lists only, including make-up working days on weekends: check and complete them each year when the governments publish the next year\'s notice.')}
      </Notice>

      <Section
        title={t('Closure days')}
        meta={days.loading ? undefined : t('{n} in {year}', { n: closures.length, year })}
        flush
        actions={
          can.manage ? (
            <>
              {computed && (
                <Button size="sm" variant="ghost" loading={busy} onClick={() => void refresh()}>
                  <RefreshCw size={13} aria-hidden /> <span className="hidden sm:inline">{office === 'JP' ? t('Refresh from official source') : t('Regenerate computed days')}</span>
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
                <Plus size={13} aria-hidden /> {t('Add a day')}
              </Button>
            </>
          ) : undefined
        }
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--agent-app-border)] px-3 py-2">
          <div className="w-full sm:w-56">
            <Select aria-label={t('Office')} className="h-8" value={office} options={OFFICES.map((o) => ({ value: o, label: `${o} · ${jurisdictionName(o)}` }))} onChange={(e) => setOffice(e.target.value)} />
          </div>
          <div className="w-28">
            <Select aria-label={t('Year')} className="h-8" value={String(year)} options={years.map((y) => ({ value: String(y), label: String(y) }))} onChange={(e) => setYear(Number(e.target.value))} />
          </div>
          {OFFICIAL_ONLY.includes(office) && <span className="text-xs text-[var(--agent-app-muted)]">{t('Official list only: check it against this year\'s government notice.')}</span>}
        </div>
        {days.loading ? (
          <Loading />
        ) : days.error !== null ? (
          <div className="p-4">
            <ErrorBox message={days.error} onRetry={days.refresh} />
          </div>
        ) : days.records.length === 0 ? (
          <EmptyHint
            compact
            icon={CalendarOff}
            title={t('No closure days for {office} in {year}', { office, year })}
            message={computed ? t('Computed days are created the first time a deadline falls in that year. Create them now to review them.') : t('Add the days this office is closed, and any weekend working days, from its published notice.')}
            action={
              can.manage ? (
                computed ? (
                  <Button size="sm" loading={busy} onClick={() => void refresh()}>
                    {t('Create computed days')}
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => setAdding(true)}>
                    {t('Add a day')}
                  </Button>
                )
              ) : undefined
            }
          />
        ) : (
          <div>
            {closures.map(dayRow)}
            {makeUps.length > 0 && (
              <>
                <div className="border-b border-[var(--agent-app-border)]/70 bg-[var(--agent-app-border)]/25 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">
                  {t('Make-up working days')}
                </div>
                {makeUps.map(dayRow)}
              </>
            )}
          </div>
        )}
      </Section>

      <BusinessDayCalculator defaultOffice={office} />

      {adding && (
        <AddDayDialog
          office={office}
          defaultDate={year === thisYear ? today() : `${year}-01-01`}
          onClose={() => setAdding(false)}
          onAdded={(o, y) => {
            setAdding(false);
            setOffice(o);
            setYear(y);
          }}
        />
      )}
    </div>
  );
}

function AddDayDialog({
  office,
  defaultDate,
  onClose,
  onAdded,
}: {
  office: string;
  defaultDate: string;
  onClose: () => void;
  onAdded: (office: string, year: number) => void;
}): React.JSX.Element {
  const [o, setO] = useState(office);
  const [date, setDate] = useState(defaultDate);
  const [name, setName] = useState('');
  const [working, setWorking] = useState(false);
  const [busy, setBusy] = useState(false);
  const ok = o !== '' && d10(date) !== '' && name.trim() !== '';
  const add = async (): Promise<void> => {
    if (!ok) return;
    setBusy(true);
    try {
      await createRecord('office_calendars', { office: o.toUpperCase(), date: toPb(date), name: name.trim(), source: 'manual', working_day: working });
      toast.success(working ? t('{date} added as a working day at {office}', { date: fmtDate(date), office: o }) : t('{date} added as a closure day at {office}', { date: fmtDate(date), office: o }));
      onAdded(o.toUpperCase(), Number(date.slice(0, 4)));
    } catch {
      /* the client already showed the server's message */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      title={t('Add a day')}
      description={t('Deadlines computed from now on use this day. Existing deadlines are not changed.')}
      className="w-[min(94vw,32rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button loading={busy} disabled={!ok} onClick={() => void add()}>
            {t('Add')}
          </Button>
        </>
      }
    >
      <DialogBody>
        <Select label={t('Office')} value={o} options={OFFICES.map((x) => ({ value: x, label: `${x} · ${jurisdictionName(x)}` }))} onChange={(e) => setO(e.target.value)} />
        <Input label={t('Date')} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        {d10(date) !== '' && <p className="-mt-2 text-xs text-[var(--agent-app-muted)]">{weekdayName(date)}</p>}
        <Input label={t('Name')} placeholder={t('For example: Spring Festival')} value={name} onChange={(e) => setName(e.target.value)} />
        <Checkbox checked={working} onChange={setWorking} label={t('This is a working day (a make-up day on a weekend)')} />
      </DialogBody>
    </Dialog>
  );
}

function BusinessDayCalculator({ defaultOffice }: { defaultOffice: string }): React.JSX.Element {
  const [office, setOffice] = useState(defaultOffice);
  const [from, setFrom] = useState(today());
  const [days, setDays] = useState('10');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ date: string; steps: Bi[] } | null>(null);

  const run = async (): Promise<void> => {
    setBusy(true);
    try {
      setRes(await op<{ date: string; steps: Bi[] }>('calendars/business-days', { office, from, days: Math.round(num(days)) }));
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title={t('Business-day calculator')}>
      <div className="flex flex-col gap-3">
        <p className="text-[13px] leading-relaxed text-[var(--agent-app-muted)]">{t('Count working days at an office, skipping weekends and closure days. Use a negative number to count back.')}</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select label={t('Office')} value={office} options={OFFICES.map((o) => ({ value: o, label: `${o} · ${jurisdictionName(o)}` }))} onChange={(e) => setOffice(e.target.value)} />
          <Input label={t('From')} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input label={t('Working days')} type="number" value={days} onChange={(e) => setDays(e.target.value)} />
          <div className="flex items-end">
            <Button variant="outline" loading={busy} disabled={d10(from) === '' || days.trim() === ''} onClick={() => void run()}>
              <Calculator size={13} aria-hidden /> {t('Calculate')}
            </Button>
          </div>
        </div>
        {res !== null && (
          <div className="border border-[var(--agent-app-border)] px-3 py-2.5">
            <div className="text-sm font-semibold tabular-nums">
              {fmtDate(res.date)} <span className="font-normal text-[var(--agent-app-muted)]">({weekdayName(res.date)})</span>
            </div>
            <ul className="mt-1 flex flex-col gap-0.5">
              {res.steps.map((s, i) => (
                <li key={i} className="text-xs leading-relaxed text-[var(--agent-app-muted)]">
                  {bi(s)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Section>
  );
}
