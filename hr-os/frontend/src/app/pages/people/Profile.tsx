/**
 * The employee profile: a header with the status and the key facts, then
 * tabs: Overview, Job and pay (effective-dated, Update vs Edit, scheduled
 * changes), Personal, Bank and IDs (masked; reveal with the PIN; changes go
 * to approval), Documents, Skills, and every module's own tab (time, leave,
 * pay, performance...) from its index.tsx `profileTabs`.
 */
import { useMemo, useRef, useState } from 'react';
import { Archive, Briefcase, CalendarX, Camera, Ellipsis, MoreHorizontal, Printer, Trash2, UserCheck, Wallet } from 'lucide-react';
import { Button, Empty, FactStrip, LoadError, Loading, Menu, MenuItem, MenuSep, PageBody, PageHeader, StatusDot, Tabs, confirmAsk } from '../../components/ui.tsx';
import type { TabDef } from '../../components/ui.tsx';
import { op, opForm } from '../../lib/api.ts';
import { allowed, can, useMe } from '../../lib/auth.tsx';
import type { PageProps } from '../../lib/contract.ts';
import { fmtDay, tenure } from '../../lib/format.ts';
import { t } from '../../lib/i18n.ts';
import { changed, useOp } from '../../lib/live.ts';
import { navigate, setQuery } from '../../lib/router.ts';
import { toast } from '../../lib/toast.ts';
import { profileTabs } from '../../routes.tsx';
import { STATUS_TONE, statusLabel } from './Directory.tsx';
import { BankTab, DocumentsTab, JobPayTab, OverviewTab, PersonalTab, SkillsTab } from './ProfileTabs.tsx';
import { EndDialog, JobDialog, PayDialog } from './RecordDialogs.tsx';
import { forgetPhoto, usePhoto } from './photo.tsx';
import { HiredNext } from './Start.tsx';
import type { Profile } from './types.ts';
import { Avatar, Segmented } from '../../components/ui.tsx';

/** The photo: click to choose a new one (people.photo-set), when the viewer may change it. */
function PhotoButton({ employee, has, name, editable }: { employee: string; has: boolean; name: string; editable: boolean }): React.JSX.Element {
  const url = usePhoto(employee, has);
  const input = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  if (!editable) return <Avatar name={name} photo={url} size={52} />;
  return (
    <>
      <button type="button" onClick={() => input.current?.click()} aria-label={t('profile.photo_change')} title={t('profile.photo_change')} disabled={busy} className="hr-focus group relative shrink-0 rounded-full transition-shadow hover:ring-2 hover:ring-[var(--hr-line-2)]">
        <Avatar name={name} photo={url} size={52} />
        <span aria-hidden className="absolute inset-0 flex items-center justify-center rounded-full bg-[var(--hr-overlay)] text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <Camera size={16} />
        </span>
      </button>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(ev) => {
          const f = ev.target.files?.[0];
          ev.target.value = '';
          if (f === undefined) return;
          setBusy(true);
          void opForm('people.photo-set', { employee }, { photo: f })
            .then(() => {
              forgetPhoto(employee);
              changed('employees');
              toast.success(t('profile.photo_saved'));
            })
            .catch(() => undefined)
            .finally(() => setBusy(false));
        }}
      />
    </>
  );
}

/** The profile's tabs: the first seven in a row, the rest (and only those) behind "More" at its end. */
const TAB_ROW = 7;
function ProfileTabRow({ tabs, tab }: { tabs: TabDef<string>[]; tab: string }): React.JSX.Element {
  const go = (v: string): void => setQuery({ tab: v === 'overview' ? undefined : v });
  if (tabs.length <= TAB_ROW) return <Tabs value={tab} onChange={go} tabs={tabs} label={t('profile.tabs')} className="mb-4" />;
  const at = tabs.findIndex((x) => x.value === tab);
  // The open tab always shows in the row (it takes the last place when it lives under More).
  const row = at >= TAB_ROW - 1 ? [...tabs.slice(0, TAB_ROW - 1), tabs[at] as TabDef<string>] : tabs.slice(0, TAB_ROW);
  const more = tabs.filter((x) => !row.includes(x));
  return (
    <div className="mb-4 flex items-end gap-1 border-b border-[var(--hr-line)]">
      <Tabs value={tab} onChange={go} tabs={row} label={t('profile.tabs')} className="-mb-px min-w-0 flex-1" />
      <div className="pb-1">
        <Menu icon={MoreHorizontal} label={t('profile.more_tabs')} align="end">
          {(close) => (
            <>
              {more.map((x) => (
                <MenuItem key={x.value} onClick={() => (close(), go(x.value))} hint={x.count !== undefined && x.count > 0 ? String(x.count) : undefined}>
                  {x.label}
                </MenuItem>
              ))}
            </>
          )}
        </Menu>
      </div>
    </div>
  );
}

export const PROFILE_READS = ['employees', 'employments', 'job_records', 'pay_records', 'tax_profiles', 'bank_accounts', 'identity_docs', 'documents', 'employee_skills', 'approvals'];

export function ProfilePage({ params, query }: PageProps): React.JSX.Element {
  const me = useMe();
  const ref = params['id'] ?? '';
  const live = useOp<Profile>('people.get', { employee: ref }, PROFILE_READS, { name: 'people.profile' });
  const p = live.data;
  const [dialog, setDialog] = useState<'job' | 'pay' | 'end' | null>(null);
  const chosen = query.get('employment') ?? '';
  const employment = useMemo(() => {
    if (p === null) return null;
    return p.employments.find((e) => e.id === chosen) ?? p.employments.find((e) => e.id === p.primary_employment) ?? p.employments[0] ?? null;
  }, [p, chosen]);
  const self = p !== null && me.employee?.id === p.employee.id;
  const moduleTabs = useMemo(() => profileTabs().filter((tab) => allowed(me, tab.perm) || (tab.selfAndTeam !== false && p !== null && (self || p.access === 'team'))), [me, p, self]);

  if (p === null) return live.error !== null ? <><PageHeader title={t('people.title')} back="#/people" /><LoadError message={live.error} onRetry={live.reload} /></> : <Loading className="min-h-[60vh]" />;

  const e = p.employee;
  const job = employment?.job ?? null;
  const full = p.access !== 'team';
  const tabs: TabDef<string>[] = [
    { value: 'overview', label: t('profile.tab.overview') },
    { value: 'job', label: t('profile.tab.job') },
    ...(full ? [{ value: 'personal', label: t('profile.tab.personal') }, { value: 'bank', label: t('profile.tab.bank') }, { value: 'documents', label: t('profile.tab.documents'), count: (p.documents ?? []).filter((d) => d.needs_ack && d.acked_at === '').length }, { value: 'skills', label: t('profile.tab.skills') }] : []),
    ...moduleTabs.map((m) => ({ value: 'm.' + m.key, label: m.label })),
  ];
  const tab = tabs.some((x) => x.value === query.get('tab')) ? (query.get('tab') ?? 'overview') : 'overview';
  const mod = moduleTabs.find((m) => 'm.' + m.key === tab);

  const archive = async (): Promise<void> => {
    const ok = await confirmAsk(t('profile.archive_text', { name: e.name }), t('profile.archive'), t('profile.archive'), 'primary');
    if (!ok) return;
    try {
      await op('people.archive', { employee: e.id, archived: !e.archived });
      changed(...PROFILE_READS);
      toast.success(e.archived ? t('profile.restored') : t('profile.archived'));
    } catch {
      /* toast shown */
    }
  };
  const remove = async (): Promise<void> => {
    const ok = await confirmAsk(t('profile.delete_text', { name: e.name }), t('profile.delete'), t('profile.delete'));
    if (!ok) return;
    try {
      await op('people.delete', { employee: e.id }, { pin: { title: t('profile.delete'), text: t('profile.delete_pin', { name: e.name }) } });
      changed(...PROFILE_READS);
      toast.success(t('profile.deleted', { name: e.name }));
      navigate('/people');
    } catch {
      /* toast shown */
    }
  };

  const meta = [e.number, employment?.entity_name, employment?.country].filter((x) => x !== undefined && x !== '').join(' · ');
  return (
    <>
      <PageHeader title={self ? t('profile.you', { name: e.name }) : e.name} meta={meta} back={can(me, 'people', 'view') || me.manages > 0 ? '#/people' : undefined}>
        {employment !== null && p.can.job && (
          <Button icon={Briefcase} onClick={() => setDialog('job')}>
            {t('record.update_job')}
          </Button>
        )}
        {employment !== null && p.can.pay && !employment.pay_hidden && (
          <Button icon={Wallet} onClick={() => setDialog('pay')}>
            {t('record.update_pay')}
          </Button>
        )}
        {(p.can.edit || p.can.hire) && (
          <Menu icon={Ellipsis} label={t('ui.more')}>
            {(close) => (
              <>
                {employment !== null && p.can.job && (
                  <MenuItem icon={Briefcase} onClick={() => (close(), setDialog('job'))}>
                    {t('record.update_job')}
                  </MenuItem>
                )}
                {employment !== null && p.can.pay && (
                  <MenuItem icon={Wallet} onClick={() => (close(), setDialog('pay'))}>
                    {t('record.update_pay')}
                  </MenuItem>
                )}
                <MenuItem icon={Printer} onClick={() => (close(), navigate(`/print/people/${e.number}`))}>
                  {t('profile.print')}
                </MenuItem>
                {p.can.hire && (
                  <MenuItem icon={UserCheck} onClick={() => (close(), navigate('/people/new', { employee: e.id }))}>
                    {t('profile.new_employment')}
                  </MenuItem>
                )}
                {employment !== null && p.can.edit && employment.end_day === '' && (
                  <MenuItem icon={CalendarX} onClick={() => (close(), setDialog('end'))}>
                    {t('profile.end')}
                  </MenuItem>
                )}
                {e.photo && (p.can.edit || p.can.edit_self) && (
                  <MenuItem icon={Camera} onClick={() => (close(), void op('people.photo-set', { employee: e.id, clear: true }).then(() => (forgetPhoto(e.id), changed('employees'))).catch(() => undefined))}>
                    {t('profile.photo_remove')}
                  </MenuItem>
                )}
                <MenuSep />
                {p.can.edit && (
                  <MenuItem icon={Archive} onClick={() => (close(), void archive())}>
                    {e.archived ? t('profile.restore') : t('profile.archive')}
                  </MenuItem>
                )}
                {p.can.hire && (
                  <MenuItem icon={Trash2} danger onClick={() => (close(), void remove())}>
                    {t('profile.delete')}
                  </MenuItem>
                )}
              </>
            )}
          </Menu>
        )}
      </PageHeader>
      <PageBody>
        <section className="hr-panel hr-in mb-3 flex flex-col gap-4 p-4 md:flex-row md:items-start">
          <div className="flex min-w-0 items-center gap-3 md:w-[300px] md:shrink-0">
            <PhotoButton employee={e.id} has={e.photo} name={e.name} editable={p.can.edit || p.can.edit_self} />
            <div className="min-w-0">
              <div className="hr-wrap text-[15px] font-semibold leading-5">{e.name}</div>
              {e.legal_name !== e.name && <div className="hr-wrap text-[12px] text-[var(--hr-muted)]">{e.legal_name}</div>}
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <StatusDot tone={STATUS_TONE[e.status] ?? 'neutral'} label={statusLabel(e.status)} />
                {e.archived && <span className="hr-label">{t('profile.archived_tag')}</span>}
              </div>
            </div>
          </div>
          <FactStrip
            className="min-w-0 flex-1"
            items={[
              ...(job !== null && job.title !== '' ? [{ label: t('people.col.title'), value: job.title }] : []),
              ...(job !== null && job.department_name !== '' ? [{ label: t('people.col.department'), value: job.department_name }] : []),
              ...(p.manager !== null ? [{ label: t('people.col.manager'), value: <a className="hr-link hr-focus hit rounded-[3px]" href={`#/people/${p.manager.number}`}>{p.manager.name}</a> }] : []),
              ...(job !== null && job.location_name !== '' ? [{ label: t('people.col.location'), value: job.location_name }] : []),
              { label: t('people.col.start'), value: employment !== null ? fmtDay(employment.start_day, { year: 'always', entity: employment.entity }) : '', mono: true },
              { label: t('profile.tenure'), value: employment !== null ? tenure(employment.start_day, employment.end_day !== '' && employment.end_day < p.as_of ? employment.end_day : p.as_of) : '', mono: true },
            ]}
          />
        </section>
        {query.get('hired') === '1' && p.can.hire && (
          <HiredNext employee={e.id} name={e.name} email={e.work_email !== '' ? e.work_email : (e.personal_email ?? '')} hasPay={employment?.pay !== null && employment?.pay !== undefined} onPay={() => setDialog('pay')} />
        )}
        {p.employments.length > 1 && employment !== null && (
          <div className="mb-3">
            <Segmented value={employment.id} onChange={(v) => setQuery({ employment: v })} label={t('profile.employments')} size="sm" options={p.employments.map((m) => ({ value: m.id, label: `${m.entity_name} · ${m.number}` }))} />
          </div>
        )}
        <ProfileTabRow tabs={tabs} tab={tab} />
        {employment === null && tab !== 'personal' ? (
          <Empty icon={Briefcase} title={t('profile.no_employment')} />
        ) : tab === 'overview' && employment !== null ? (
          <OverviewTab p={p} employment={employment} onJob={() => setDialog('job')} />
        ) : tab === 'job' && employment !== null ? (
          <JobPayTab p={p} employment={employment} />
        ) : tab === 'personal' ? (
          <PersonalTab p={p} country={employment?.country ?? ''} />
        ) : tab === 'bank' ? (
          <BankTab p={p} country={employment?.country ?? ''} currency={employment?.currency ?? ''} />
        ) : tab === 'documents' ? (
          <DocumentsTab p={p} self={self} />
        ) : tab === 'skills' ? (
          <SkillsTab p={p} />
        ) : mod !== undefined && employment !== null ? (
          <mod.component employee={e.id} employment={employment.id} entity={employment.entity} currency={employment.currency} self={self} />
        ) : null}
      </PageBody>
      {employment !== null && <JobDialog open={dialog === 'job'} onClose={() => setDialog(null)} employment={employment} record={null} mode="update" />}
      {employment !== null && <PayDialog open={dialog === 'pay'} onClose={() => setDialog(null)} employment={employment} record={null} mode="update" />}
      {employment !== null && <EndDialog open={dialog === 'end'} onClose={() => setDialog(null)} employment={employment} name={e.name} />}
    </>
  );
}
