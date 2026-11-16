/**
 * Me: the employee self-service hub (the phone bottom bar's "Me") and its
 * pages. The hub opens on who I am here and the facts every module keeps on
 * me, then one row per place I look after myself: profile, documents, pay,
 * requests, tasks, goals, handbook, directory and your AI agent.
 */
import { useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight, BookOpen, CalendarDays, CircleUser, Clock, FileText, KeyRound, Landmark, ListTodo, Receipt, Search, Send, Sparkle, Target, Users, Wallet } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { Avatar, Button, Dialog, Empty, FactValue, Field, Input, LoadError, Loading, Money, Notice, PageBody, PageHeader, Panel, SearchInput, Skeleton, StatusDot, Tabs } from '../../components/ui.tsx';
import type { DirectoryRow } from '../../components/home/types.ts';
import { op } from '../../lib/api.ts';
import { useMe } from '../../lib/auth.tsx';
import type { PageProps } from '../../lib/contract.ts';
import { fmtDay, fmtStampDay, tenure } from '../../lib/format.ts';
import { t, tn } from '../../lib/i18n.ts';
import { changed, useOp } from '../../lib/live.ts';
import { navigate, setQuery } from '../../lib/router.ts';
import { toast } from '../../lib/toast.ts';
import { BankTab, DocumentsTab, PersonalTab } from '../people/ProfileTabs.tsx';
import { PROFILE_READS } from '../people/Profile.tsx';
import { usePhoto } from '../people/photo.tsx';
import type { Profile } from '../people/types.ts';
import { useMeHome } from './Home.tsx';
import { NotLinked } from '../people/Start.tsx';
import { AskPanel, NewRequestMenu, RequestItem } from './parts.tsx';
import type { RequestRow } from './parts.tsx';

/* ------------------------------------------------------------------ hub */

function MyPhoto({ employee, has, name }: { employee: string; has: boolean; name: string }): React.JSX.Element {
  const url = usePhoto(employee, has);
  return <Avatar name={name} photo={url} size={56} />;
}

interface Place {
  key: string;
  icon: LucideIcon;
  label: string;
  sub: string;
  to: string;
  count?: number | undefined;
}

export function MeHubPage(_props: PageProps): React.JSX.Element {
  const me = useMe();
  const live = useMeHome(true);
  const d = live.data;
  const hub = d?.hub ?? null;
  const main = d?.employments.find((x) => x.primary) ?? d?.employments[0] ?? null;
  const facts = useMemo(() => (d?.facts ?? []).flatMap((m) => m.facts.map((f, i) => ({ id: m.module + '.' + (f.key ?? i), ...f }))).slice(0, 8), [d]);
  if (me.employee === null)
    return (
      <>
        <PageHeader title={t('me.title')} />
        <PageBody>
          <NotLinked />
        </PageBody>
      </>
    );
  const places: Place[] = [
    { key: 'profile', icon: CircleUser, label: t('me.place.profile'), sub: t('me.place.profile_sub'), to: '#/me/profile' },
    { key: 'documents', icon: FileText, label: t('me.place.documents'), sub: d !== null && d.documents.length > 0 ? tn('me.place.to_ack', d.documents.length) : t('me.place.documents_sub'), to: '#/me/documents', count: d?.documents.length },
    { key: 'pay', icon: Wallet, label: t('me.place.pay'), sub: hub !== null && hub.last_payslip !== null ? t('me.place.pay_last', { day: fmtDay(hub.last_payslip.pay_date) }) : t('me.place.pay_sub'), to: '#/payroll' },
    { key: 'requests', icon: Send, label: t('me.place.requests'), sub: d !== null && d.requests_pending > 0 ? tn('me.place.waiting', d.requests_pending) : t('me.place.requests_sub'), to: '#/me/requests', count: d?.requests_pending },
    { key: 'tasks', icon: ListTodo, label: t('me.place.tasks'), sub: hub !== null && hub.tasks_open > 0 ? tn('me.place.open', hub.tasks_open) : t('me.place.tasks_sub'), to: '#/lifecycle/tasks', count: hub?.tasks_open },
    { key: 'growth', icon: Target, label: t('me.place.growth'), sub: t('me.place.growth_sub'), to: '#/performance' },
    { key: 'handbook', icon: BookOpen, label: t('me.place.handbook'), sub: hub !== null && hub.to_read > 0 ? tn('me.place.to_read', hub.to_read) : t('me.place.handbook_sub'), to: '#/lifecycle/handbook', count: hub?.to_read },
    { key: 'directory', icon: Users, label: t('me.place.directory'), sub: t('me.place.directory_sub'), to: '#/me/directory' },
    { key: 'ask', icon: Sparkle, label: t('me.place.ask'), sub: d !== null && d.answers.length > 0 ? tn('me.place.answers', d.answers.filter((a) => a.answer !== '').length) : t('me.place.ask_sub'), to: '#/me/ask' },
    { key: 'time', icon: Clock, label: t('me.place.time'), sub: hub !== null && !hub.kiosk_pin ? t('me.place.time_pin') : t('me.place.time_sub'), to: '#/time/clock' },
    { key: 'leave', icon: CalendarDays, label: t('me.place.leave'), sub: t('me.place.leave_sub'), to: '#/leave' },
    { key: 'expenses', icon: Receipt, label: t('me.place.expenses'), sub: t('me.place.expenses_sub'), to: '#/expenses/mine' },
  ];
  return (
    <>
      <PageHeader title={t('me.title')} meta={(me.employee.number + ' · ' + (main?.entity_name ?? '')).toUpperCase()} />
      <PageBody className="max-w-[1100px]">
        {live.error !== null && d === null ? (
          <LoadError message={live.error} onRetry={live.reload} />
        ) : (
          <div className="flex flex-col gap-3">
            <section className="hr-panel hr-in flex min-w-0 flex-wrap items-center gap-4 p-4" data-ready={d !== null ? '' : undefined}>
              {d === null ? (
                <Skeleton className="h-14 w-full" />
              ) : (
                <>
                  <MyPhoto employee={d.employee?.id ?? ''} has={d.employee?.photo === true} name={d.employee?.name ?? ''} />
                  <div className="min-w-0 flex-1">
                    <div className="hr-label">01 · {t('me.you')}</div>
                    <div className="hr-wrap text-[15px] font-semibold">{d.employee?.name}</div>
                    <div className="hr-wrap text-[13px] text-[var(--hr-ink-2)]">{[main?.title, main?.department_name, main?.location_name].filter((x) => x !== undefined && x !== '').join(' · ')}</div>
                    <div className="hr-mono mt-1 text-[12px] text-[var(--hr-muted)]">
                      {main !== null ? t('me.since', { day: fmtDay(main.start_day), tenure: tenure(main.start_day) }) : ''}
                      {main?.manager !== null && main?.manager !== undefined ? ' · ' + t('me.manager', { name: main.manager.name }) : ''}
                    </div>
                  </div>
                  <Button className="hit" icon={CircleUser} onClick={() => navigate('/me/profile')}>
                    {t('me.edit_profile')}
                  </Button>
                </>
              )}
            </section>
            {facts.length > 0 && (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {facts.map((f, i) => {
                  const body = (
                    <>
                      <div className="hr-label truncate">
                        <span className="mr-2 !text-[var(--hr-faint)]">02.{i + 1}</span>
                        {f.label}
                      </div>
                      <div className="hr-mono hr-num mt-1.5 truncate text-[15px] leading-tight">
                        <FactValue fact={f} entity={main?.entity} />
                      </div>
                    </>
                  );
                  return f.link !== undefined && f.link !== '' ? (
                    <a key={f.id} href={f.link} className="hr-panel hr-in hr-focus min-w-0 px-3.5 py-3 transition-colors hover:bg-[var(--hr-hover)]">
                      {body}
                    </a>
                  ) : (
                    <div key={f.id} className="hr-panel hr-in min-w-0 px-3.5 py-3">
                      {body}
                    </div>
                  );
                })}
              </div>
            )}
            <Panel index="03" label={t('me.places')} flush>
              <ul className="grid grid-cols-1 border-t border-[var(--hr-hair)] md:grid-cols-2">
                {places.map((p) => {
                  const Icon = p.icon;
                  return (
                    <li key={p.key} className="border-b border-[var(--hr-hair)] md:odd:border-r">
                      <a href={p.to} className="hr-focus group flex min-w-0 items-center gap-3 px-3.5 py-3 transition-colors hover:bg-[var(--hr-hover)]">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-[var(--hr-line-2)] text-[var(--hr-ink-2)]">
                          <Icon size={15} strokeWidth={1.8} aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium">{p.label}</span>
                          <span className={cn('block truncate text-[12px]', p.count !== undefined && p.count > 0 ? 'text-[var(--hr-ink-2)]' : 'text-[var(--hr-muted)]')}>{p.sub}</span>
                        </span>
                        <ArrowRight size={14} aria-hidden className="shrink-0 text-[var(--hr-faint)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--hr-ink)]" />
                      </a>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          </div>
        )}
      </PageBody>
    </>
  );
}

/* ------------------------------------------------------------- profile */

function useMyProfile(): { p: Profile | null; error: string | null; reload: () => void } {
  const me = useMe();
  const live = useOp<Profile>('people.get', { employee: me.employee?.number ?? '' }, PROFILE_READS, { name: 'me.profile', skip: me.employee === null });
  return { p: live.data, error: live.error, reload: live.reload };
}

interface TaxForm {
  employment: string;
  country: string;
  fields: { key: string; label: string; type: string; options?: { value: string; label: string }[] | undefined; help?: string | undefined; required?: boolean | undefined; pack: string }[];
  values: Record<string, unknown>;
  missing: string[];
  requests: { id: string; status: string; created: string; effective_from: string }[];
  can: { edit: boolean; submit: boolean };
}

function shownValue(f: TaxForm['fields'][number], v: unknown): string {
  if (v === undefined || v === null || v === '') return t('ui.none');
  if (typeof v === 'boolean') return v ? t('ui.yes') : t('ui.no');
  const o = (f.options ?? []).find((x) => x.value === String(v));
  return o !== undefined ? o.label : String(v);
}

/** My tax details as the payroll module keeps them; changes go through the payroll module's own form (and its approval). */
function TaxPanel({ employment }: { employment: string }): React.JSX.Element {
  const live = useOp<TaxForm>('taxprofile.get', { employment }, ['tax_profiles', 'tax_declarations'], { name: 'me.tax' });
  const d = live.data;
  const pending = (d?.requests ?? []).filter((r) => r.status === 'submitted').length;
  return (
    <Panel index="03" label={t('me.tax.title')} aside={d !== null && d.can.submit ? <Button className="hit" size="sm" icon={Landmark} onClick={() => navigate('/payroll/tax/' + employment)}>{t('me.tax.update')}</Button> : undefined}>
      {d === null ? (
        live.error !== null ? <p className="text-[12px] text-[var(--hr-muted)]">{live.error}</p> : <Skeleton className="h-16 w-full" />
      ) : d.fields.length === 0 ? (
        <p className="text-[12px] text-[var(--hr-muted)]">{t('me.tax.none')}</p>
      ) : (
        <div className="flex flex-col gap-3 pt-1">
          {d.missing.length > 0 && <Notice tone="warn">{tn('me.tax.missing', d.missing.length)}</Notice>}
          {pending > 0 && <Notice>{tn('me.tax.pending', pending)}</Notice>}
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            {d.fields.slice(0, 12).map((f) => (
              <div key={f.pack + '.' + f.key} className="min-w-0">
                <dt className="hr-label truncate">{f.label}</dt>
                <dd className="hr-wrap mt-0.5 text-[13px]">{shownValue(f, d.values[f.key])}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </Panel>
  );
}

/** The personal PIN for the shared kiosk tablet (the time module's own PIN, not the approval PIN). */
function KioskPinPanel(): React.JSX.Element {
  const live = useOp<{ set: boolean; set_at: string; locked: boolean }>('kiosk.pin-status', {}, ['kiosk_pins'], { name: 'me.hub.pin' });
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const valid = /^\d{4,6}$/.test(pin) && pin === again;
  const save = (): void => {
    if (!valid) return;
    setBusy(true);
    op('kiosk.pin-set', { pin })
      .then(() => {
        changed('kiosk_pins');
        toast.success(t('me.pin.saved'));
        setOpen(false);
        setPin('');
        setAgain('');
      })
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };
  const d = live.data;
  return (
    <Panel index="04" label={t('me.pin.title')} aside={<Button className="hit" size="sm" icon={KeyRound} onClick={() => setOpen(true)}>{d?.set === true ? t('me.pin.change') : t('me.pin.set')}</Button>}>
      {d === null ? <Skeleton className="h-8 w-full" /> : <StatusDot tone={d.locked ? 'bad' : d.set ? 'good' : 'faint'} label={d.locked ? t('me.pin.locked') : d.set ? t('me.pin.is_set', { day: fmtStampDay(d.set_at) }) : t('me.pin.not_set')} />}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('me.pin.title')}
        width={380}
        footer={
          <>
            <Button className="hit" variant="ghost" onClick={() => setOpen(false)}>
              {t('ui.cancel')}
            </Button>
            <Button className="hit" variant="primary" busy={busy} disabled={!valid} onClick={save}>
              {t('me.pin.save')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label={t('me.pin.new')} hint={t('me.pin.hint')}>
            <Input type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} aria-label={t('me.pin.new')} autoFocus />
          </Field>
          <Field label={t('me.pin.again')} error={again !== '' && again !== pin ? t('me.pin.mismatch') : null}>
            <Input type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={again} onChange={(e) => setAgain(e.target.value.replace(/\D/g, ''))} aria-label={t('me.pin.again')} onKeyDown={(e) => e.key === 'Enter' && save()} />
          </Field>
        </div>
      </Dialog>
    </Panel>
  );
}

export function MeProfilePage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const { p, error, reload } = useMyProfile();
  const tab = query.get('tab') === 'bank' ? 'bank' : query.get('tab') === 'tax' ? 'tax' : 'personal';
  const emp = p?.employments.find((e) => e.id === p.primary_employment) ?? p?.employments[0] ?? null;
  const country = emp?.country ?? '';
  return (
    <>
      <PageHeader title={t('me.profile.title')} back="#/me" meta={me.employee?.number ?? ''} />
      <PageBody>
        {me.employee === null ? (
          <NotLinked />
        ) : p === null ? (
          error !== null ? <LoadError message={error} onRetry={reload} /> : <Loading />
        ) : (
          <>
            <Tabs
              value={tab}
              onChange={(v) => setQuery({ tab: v === 'personal' ? undefined : v })}
              label={t('me.profile.title')}
              className="mb-4"
              tabs={[
                { value: 'personal', label: t('me.profile.personal') },
                { value: 'bank', label: t('me.profile.bank') },
                { value: 'tax', label: t('me.profile.tax') },
              ]}
            />
            {tab === 'personal' && <PersonalTab p={p} country={country} />}
            {tab === 'bank' && <BankTab p={p} country={country} currency={emp?.currency ?? ''} />}
            {tab === 'tax' && (
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {emp !== null && <TaxPanel employment={emp.id} />}
                <KioskPinPanel />
              </div>
            )}
          </>
        )}
      </PageBody>
    </>
  );
}

/* ----------------------------------------------------------- documents */

export function MeDocumentsPage(_props: PageProps): React.JSX.Element {
  const me = useMe();
  const { p, error, reload } = useMyProfile();
  return (
    <>
      <PageHeader title={t('me.documents.title')} back="#/me" />
      <PageBody>{me.employee === null ? <NotLinked /> : p === null ? error !== null ? <LoadError message={error} onRetry={reload} /> : <Loading /> : <DocumentsTab p={p} self />}</PageBody>
    </>
  );
}

/* ------------------------------------------------------------ requests */

export function MeRequestsPage({ query }: PageProps): React.JSX.Element {
  const status = (['pending', 'decided', 'any'] as const).find((s) => s === query.get('status')) ?? 'any';
  const [limit, setLimit] = useState(50);
  const live = useOp<{ approvals: RequestRow[]; total: number }>('approvals.list', { view: 'requested', status, limit }, ['approvals'], { name: 'me.requests.all', keep: true });
  const d = live.data;
  return (
    <>
      <PageHeader title={t('me.requests')} back="#/me">
        <NewRequestMenu />
      </PageHeader>
      <PageBody className="max-w-[900px]">
        <Tabs
          value={status}
          onChange={(v) => setQuery({ status: v === 'any' ? undefined : v })}
          label={t('me.requests')}
          className="mb-3"
          tabs={[
            { value: 'any', label: t('me.req.all') },
            { value: 'pending', label: t('me.req.status.pending') },
            { value: 'decided', label: t('me.req.decided') },
          ]}
        />
        {d === null ? (
          live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />
        ) : d.approvals.length === 0 ? (
          <Empty icon={Send} title={t('me.req.none')}>
            {t('me.req.none_text')}
          </Empty>
        ) : (
          <div className="hr-panel hr-in">
            <ul>
              {d.approvals.map((r) => (
                <RequestItem key={r.id} r={r} />
              ))}
            </ul>
            {d.total > d.approvals.length && <ScrollMore onMore={() => setLimit(limit + 50)} />}
          </div>
        )}
      </PageBody>
    </>
  );
}

/** Loads the next page when it scrolls into view (no "Show more" button). */
function ScrollMore({ onMore }: { onMore: () => void }): React.JSX.Element {
  return (
    <div
      ref={(el) => {
        if (el === null) return;
        const io = new IntersectionObserver((e) => {
          if (e.some((x) => x.isIntersecting)) {
            io.disconnect();
            onMore();
          }
        });
        io.observe(el);
      }}
      className="flex h-10 items-center justify-center"
    >
      <Loading />
    </div>
  );
}

/* ----------------------------------------------------------- directory */

export function MeDirectoryPage({ query }: PageProps): React.JSX.Element {
  const [q, setQ] = useState(query.get('q') ?? '');
  const [limit, setLimit] = useState(60);
  const live = useOp<{ total: number; people: DirectoryRow[]; departments: { id: string; name: string; people: number }[] }>('home.directory', { q: q.trim() === '' ? undefined : q.trim(), department: query.get('department') ?? undefined, limit }, ['employees', 'employments', 'job_records'], { name: 'me.directory', keep: true });
  const d = live.data;
  const dep = query.get('department') ?? '';
  return (
    <>
      <PageHeader title={t('me.directory.title')} back="#/me" meta={d !== null ? tn('home.people_n', d.total).toUpperCase() : ''} />
      <PageBody className="max-w-[1100px]">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <SearchInput value={q} onChange={setQ} placeholder={t('me.directory.search')} label={t('me.directory.search')} className="w-full sm:w-[320px]" />
          <div className="flex min-w-0 flex-wrap gap-1.5">
            {(d?.departments ?? []).map((x) => (
              <button key={x.id} type="button" onClick={() => setQuery({ department: dep === x.id ? undefined : x.id })} className={cn('hr-focus hit h-8 rounded-[var(--hr-radius-sm)] border px-2 text-[12px] transition-colors', dep === x.id ? 'border-[var(--hr-ink)] bg-[var(--hr-ink)] text-[var(--hr-on-ink)]' : 'border-[var(--hr-line)] text-[var(--hr-ink-2)] hover:bg-[var(--hr-hover)]')}>
                {x.name} <span className="hr-mono ml-1 opacity-70">{x.people}</span>
              </button>
            ))}
          </div>
        </div>
        {d === null ? (
          live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />
        ) : d.people.length === 0 ? (
          <Empty icon={Search} title={t('me.directory.none')} />
        ) : (
          <div className="hr-panel hr-in">
            <ul className="grid grid-cols-1 md:grid-cols-2">
              {d.people.map((x) => (
                <li key={x.employee} className="flex min-w-0 items-center gap-3 border-b border-[var(--hr-hair)] px-3.5 py-2.5 md:odd:border-r">
                  <Avatar name={x.name} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="hr-wrap text-[13px] font-medium">{x.name}</div>
                    <div className="hr-wrap text-[12px] text-[var(--hr-muted)]">{[x.title, x.department_name, x.location_name].filter((v) => v !== '').join(' · ')}</div>
                    {x.work_email !== '' && (
                      <a href={'mailto:' + x.work_email} className="hr-link hr-mono hr-wrap block text-[12px] text-[var(--hr-ink-2)]">
                        {x.work_email}
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {d.total > d.people.length && <ScrollMore onMore={() => setLimit(limit + 60)} />}
          </div>
        )}
      </PageBody>
    </>
  );
}

/* ----------------------------------------------------------------- ask */

export function MeAskPage(_props: PageProps): React.JSX.Element {
  const live = useMeHome();
  return (
    <>
      <PageHeader title={t('me.ask.title')} back="#/me" />
      <PageBody className="max-w-[820px]">
        <AskPanel index="01" answers={live.data?.answers ?? null} all />
      </PageBody>
    </>
  );
}

