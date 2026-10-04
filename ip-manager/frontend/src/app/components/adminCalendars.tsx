/**
 * Settings, Office closure days: the days each office is closed, used to
 * move statutory deadlines to the next open day. Computed for US, EP, EM,
 * JP and WO; any office can have days added by hand. Managers edit.
 */
import { useMemo, useState } from 'react';
import { CalendarOff, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Button, Dialog, Input, Select, toast, useConfirm } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { createRecord, deleteRecord, errText, op, q } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { d10, fmtDate, today, toPb, weekdayName } from '../lib/format.ts';
import { jurisdictionName } from '../lib/labels.ts';
import type { OfficeCalendarRec } from '../lib/types.ts';
import { JurisdictionSelect } from './pickers.tsx';
import { EmptyHint, ErrorBox, JurChip, Loading, Notice, Section, Tag } from './ui.tsx';
import { ReadOnlyNote } from './adminShared.tsx';

const COMPUTED = ['US', 'EP', 'EM', 'JP', 'WO'];
const SOURCE_LABEL: Record<string, string> = { computed: 'Computed', official: 'Official', manual: 'Added by hand', '': 'Unknown' };

export function CalendarsTab(): React.JSX.Element {
  const { can, settings } = useApp();
  const thisYear = Number(today().slice(0, 4));
  const [office, setOffice] = useState('US');
  const [year, setYear] = useState(thisYear);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmEl, confirm] = useConfirm();

  const manual = useCollection<OfficeCalendarRec>('office_calendars', { filter: 'source = "manual"', sort: 'office' });
  const days = useCollection<OfficeCalendarRec>('office_calendars', {
    filter: `office = ${q(office)} && date >= "${year}-01-01 00:00:00.000Z" && date <= "${year}-12-31 23:59:59.999Z"`,
    sort: 'date',
  });

  const offices = useMemo(() => {
    const set = new Set<string>(COMPUTED);
    for (const r of manual.records) set.add(r.office.toUpperCase());
    return [...set];
  }, [manual.records]);
  const years = Array.from({ length: 8 }, (_, i) => thisYear - 2 + i);
  const computedOffice = COMPUTED.includes(office);

  const regenerate = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await op<Record<string, unknown>>('calendars/refresh', { office, year });
      const jp = r['JP_official'];
      if (typeof jp === 'object' && jp !== null && 'error' in jp) {
        toast.info(`Computed days for ${office} ${year} regenerated. The Cabinet Office list could not be fetched: ${String((jp as { error: unknown }).error)}`);
      } else {
        toast.success(`Closure days for ${office} ${year} regenerated`);
      }
      days.refresh();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: OfficeCalendarRec): Promise<void> => {
    const warn = r.source === 'manual' ? '' : ' Regenerating computed days brings it back.';
    if (!(await confirm(`Remove ${fmtDate(r.date)} (${r.name}) as a closure day at ${r.office}? Deadlines computed from now on may fall on this day.${warn}`, 'Remove closure day?'))) return;
    try {
      await deleteRecord('office_calendars', r.id);
      toast.success('Closure day removed');
    } catch {
      /* the client already showed the server's message */
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {confirmEl}
      {!can.manage && <ReadOnlyNote>Only admins and IP managers can change closure days.</ReadOnlyNote>}
      <Notice tone="info" icon={CalendarOff}>
        US federal holidays are exact. Japan is refreshed monthly from the Cabinet Office list. EPO, EUIPO and WIPO days are computed from their usual pattern; check them against each office's annual notice. Weekends are always closed and are not listed.
      </Notice>

      <Section
        title="Closure days"
        meta={days.loading ? undefined : `${days.records.length} in ${year}`}
        flush
        actions={
          can.manage ? (
            <>
              {computedOffice && (
                <Button size="sm" variant="ghost" loading={busy} onClick={() => void regenerate()}>
                  <RefreshCw size={13} aria-hidden /> <span className="hidden sm:inline">Regenerate computed days</span>
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
                <Plus size={13} aria-hidden /> Add a day
              </Button>
            </>
          ) : undefined
        }
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--agent-app-border)] px-3 py-2">
          <div className="w-56">
            <Select aria-label="Office" className="h-8" value={office} options={offices.map((o) => ({ value: o, label: `${o} · ${jurisdictionName(o)}` }))} onChange={(e) => setOffice(e.target.value)} />
          </div>
          <div className="w-28">
            <Select aria-label="Year" className="h-8" value={String(year)} options={years.map((y) => ({ value: String(y), label: String(y) }))} onChange={(e) => setYear(Number(e.target.value))} />
          </div>
          {!computedOffice && <span className="text-xs text-[var(--agent-app-muted)]">No computed calendar for this office; only days added by hand apply.</span>}
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
            title={`No closure days for ${office} in ${year}`}
            message={computedOffice ? 'Computed days are created the first time a deadline falls in that year. Create them now to review them.' : 'Add the days this office is closed, from its published notice.'}
            action={
              can.manage ? (
                computedOffice ? (
                  <Button size="sm" loading={busy} onClick={() => void regenerate()}>
                    Create computed days
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => setAdding(true)}>
                    Add a day
                  </Button>
                )
              ) : undefined
            }
          />
        ) : (
          <div>
            {days.records.map((r) => (
              <div key={r.id} className="group flex min-h-10 items-center gap-3 border-b border-[var(--agent-app-border)]/70 px-4 py-1.5 last:border-0">
                <div className="w-28 shrink-0 tabular-nums text-[13px]">{fmtDate(r.date)}</div>
                <div className="hidden w-24 shrink-0 text-xs text-[var(--agent-app-muted)] sm:block">{weekdayName(r.date)}</div>
                <div className="min-w-0 flex-1 truncate text-[13px]">{r.name}</div>
                <Tag>{SOURCE_LABEL[r.source] ?? r.source}</Tag>
                {can.manage && (
                  <Button size="sm" variant="ghost" className="h-7 px-2 opacity-60 group-hover:opacity-100" aria-label={`Remove ${r.name}`} onClick={() => void remove(r)}>
                    <Trash2 size={13} aria-hidden />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      {adding && (
        <AddDayDialog
          office={office}
          preferred={settings?.jurisdictions ?? undefined}
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
  preferred,
  defaultDate,
  onClose,
  onAdded,
}: {
  office: string;
  preferred: string[] | undefined;
  defaultDate: string;
  onClose: () => void;
  onAdded: (office: string, year: number) => void;
}): React.JSX.Element {
  const [o, setO] = useState(office);
  const [date, setDate] = useState(defaultDate);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = o !== '' && d10(date) !== '' && name.trim() !== '';
  const add = async (): Promise<void> => {
    if (!ok) return;
    setBusy(true);
    try {
      await createRecord('office_calendars', { office: o.toUpperCase(), date: toPb(date), name: name.trim(), source: 'manual' });
      toast.success(`${fmtDate(date)} added as a closure day at ${o.toUpperCase()}`);
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
      title="Add a closure day"
      description="Deadlines computed from now on move past this day. Existing deadlines are not changed."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} disabled={!ok} onClick={() => void add()}>
            Add
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <JurisdictionSelect label="Office" value={o} preferred={preferred} onChange={setO} />
        <Input label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        {d10(date) !== '' && <p className="-mt-1 text-xs text-[var(--agent-app-muted)]">{weekdayName(date)}</p>}
        <Input label="Name" placeholder="For example: Office closed (system maintenance)" value={name} onChange={(e) => setName(e.target.value)} />
        {o !== '' && (
          <div className="flex items-center gap-2 text-xs text-[var(--agent-app-muted)]">
            <JurChip code={o} /> {jurisdictionName(o)}
          </div>
        )}
      </div>
    </Dialog>
  );
}
