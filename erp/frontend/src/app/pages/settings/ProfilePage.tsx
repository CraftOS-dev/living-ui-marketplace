/**
 * Your profile: your name and title, your password, what your role lets you
 * do in each module, your employee record, and signing out (here, or on
 * every other device).
 */
import { useEffect, useState } from 'react';
import { ArrowUpRight, Check, IdCard, KeyRound, LogOut, MonitorSmartphone, ShieldCheck } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { MODULE_INFO } from '../../components/settings/shared.tsx';
import { Avatar, Card, CardHeader, Field, Notice, PageHeader, PillButton, softInput, useConfirm } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { money } from '../../lib/format.ts';
import { useMe } from '../../lib/me.ts';
import { navigate } from '../../lib/router.ts';
import { refreshMe, signOut, signedIn } from '../../lib/session.ts';
import type { PageProps } from '../../routes.tsx';
import type { Me } from '../../lib/types.ts';
import { MODULES } from '../../lib/types.ts';

export function ProfilePage({ query }: PageProps): React.JSX.Element {
  void query;
  const me = useMe();
  const [confirmEl, confirm] = useConfirm();
  const [leaving, setLeaving] = useState(false);

  const everywhere = async (): Promise<void> => {
    if (!(await confirm('Every other browser and phone where you are signed in is signed out. You stay signed in here.', 'Sign out everywhere else?', 'Sign out the others', false))) return;
    try {
      const r = await op<{ token: string }>('members.signout', {});
      if (r.token !== '') signedIn(r.token, me);
      toast.success('Signed out everywhere else');
    } catch {
      /* shown */
    }
  };

  return (
    <div>
      <PageHeader
        title="Your profile"
        subtitle={me.member.email}
        actions={
          <PillButton
            variant="light"
            icon={LogOut}
            loading={leaving}
            onClick={() => {
              setLeaving(true);
              void signOut();
            }}
          >
            Sign out
          </PillButton>
        }
      />
      <div className="grid grid-cols-1 gap-5 @min-[900px]:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-5 @min-[900px]:col-span-7">
          <AboutCard me={me} />
          <PasswordCard me={me} />
          <Card delay={3}>
            <CardHeader icon={MonitorSmartphone} title="Your devices" subtitle="Lost a phone, or signed in on a shared computer?" />
            <PillButton variant="soft" icon={LogOut} onClick={() => void everywhere()}>
              Sign out everywhere else
            </PillButton>
          </Card>
        </div>
        <div className="flex min-w-0 flex-col gap-5 @min-[900px]:col-span-5">
          <RightsCard me={me} />
          <Card delay={3}>
            <CardHeader icon={IdCard} title="Your employee record" />
            {me.employee !== null ? (
              <button type="button" onClick={() => navigate('employee', { id: me.employee?.id ?? '' })} className="flex w-full items-center gap-3 rounded-[18px] bg-[var(--erp-row)] px-4 py-3 text-left transition-colors hover:bg-[var(--erp-row-hover)]">
                <Avatar name={me.employee.name} size={40} tone="card" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-bold">{me.employee.name}</span>
                  <span className="block truncate text-[12px] text-[var(--erp-muted)]">{[me.employee.number, me.employee.job_title].filter((x) => x !== '').join(' · ')}</span>
                </span>
                <ArrowUpRight size={16} aria-hidden className="shrink-0" />
              </button>
            ) : (
              <p className="text-[13px] leading-5 text-[var(--erp-muted)]">Your account is not linked to an employee record, so leave, claims and payslips are not shown for you. An administrator links it in Settings, Team.</p>
            )}
          </Card>
        </div>
      </div>
      {confirmEl}
    </div>
  );
}

function AboutCard({ me }: { me: Me }): React.JSX.Element {
  const [name, setName] = useState(me.member.name);
  const [title, setTitle] = useState(me.member.title);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setName(me.member.name);
    setTitle(me.member.title);
  }, [me.member.name, me.member.title]);
  const dirty = name.trim() !== me.member.name || title.trim() !== me.member.title;
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await op('auth.update-profile', { name: name.trim(), title: title.trim() });
      await refreshMe();
      toast.success('Profile saved');
    } catch {
      /* shown */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card delay={1}>
      <div className="mb-5 flex items-center gap-4">
        <Avatar name={me.member.name} size={56} tone="ink" />
        <div className="min-w-0">
          <p className="truncate text-[15px] font-bold">{me.member.name}</p>
          <p className="truncate text-[13px] text-[var(--erp-muted)]">{[me.member.title, me.role.name].filter((x) => x !== '').join(' · ')}</p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 @min-[640px]:grid-cols-2">
        <Field label="Your name">
          <input className={softInput} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </Field>
        <Field label="Job title" optional>
          <input className={softInput} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
        </Field>
      </div>
      <div className="mt-4 flex justify-end">
        <PillButton icon={Check} dot loading={busy} disabled={!dirty || name.trim() === ''} onClick={() => void save()}>
          Save
        </PillButton>
      </div>
    </Card>
  );
}

function PasswordCard({ me }: { me: Me }): React.JSX.Element {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const short = next !== '' && next.length < 8;
  const differ = again !== '' && again !== next;
  const ready = current !== '' && next.length >= 8 && next === again;
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const r = await op<{ token: string }>('auth.change-password', { current, password: next }, { quiet: true });
      signedIn(r.token, me);
      setCurrent('');
      setNext('');
      setAgain('');
      toast.success('Password changed. Other devices are signed out.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card delay={2}>
      <CardHeader icon={KeyRound} title="Password" subtitle="Changing it signs you out on every other device" />
      <div className="flex flex-col gap-4">
        {error !== null && <Notice tone="bad">{error}</Notice>}
        <Field label="Current password">
          <input className={softInput} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <div className="grid grid-cols-1 gap-4 @min-[640px]:grid-cols-2">
          <Field label="New password" error={short ? 'At least 8 characters' : null} hint="8 or more characters">
            <input className={softInput} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <Field label="New password again" error={differ ? 'The two do not match' : null}>
            <input className={softInput} type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
          </Field>
        </div>
        <div className="flex justify-end">
          <PillButton icon={Check} dot loading={busy} disabled={!ready} onClick={() => void save()}>
            Change password
          </PillButton>
        </div>
      </div>
    </Card>
  );
}

function RightsCard({ me }: { me: Me }): React.JSX.Element {
  const mods = MODULES.filter((m) => me.modules[m] !== false);
  return (
    <Card tone="dark" delay={2}>
      <div className="flex items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-full bg-[var(--erp-dark-2)] text-[var(--erp-accent)]">
          <ShieldCheck size={20} aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-[12px] font-semibold text-[var(--erp-on-dark-muted)]">Your role</p>
          <p className="truncate text-[15px] font-bold">{me.role.name}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2 text-[12px]">
        {me.owner && <span className="rounded-full bg-[var(--erp-accent)] px-3 py-1 font-semibold text-[var(--erp-on-accent)]">Owner</span>}
        {me.admin && <span className="rounded-full bg-[var(--erp-dark-2)] px-3 py-1 font-semibold">Administrator</span>}
        <span className="rounded-full bg-[var(--erp-dark-2)] px-3 py-1 font-semibold">{me.approval_limit > 0 ? `Approves up to ${money(me.approval_limit, me.company.currency)}` : 'No approval limit'}</span>
      </div>
      <ul className="mt-5 flex flex-col gap-1.5">
        {mods.map((m) => {
          const Icon = MODULE_INFO[m].icon;
          const lv = me.levels[m] ?? 'none';
          return (
            <li key={m} className={cn('flex items-center gap-3 rounded-[16px] bg-[var(--erp-dark-2)] px-3 py-2', lv === 'none' && 'text-[var(--erp-on-dark-muted)]')}>
              <Icon size={16} aria-hidden className="shrink-0" />
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{MODULE_INFO[m].label}</span>
              <DarkLevel level={lv} />
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-[12px] leading-5 text-[var(--erp-on-dark-muted)]">View sees it, Edit drafts and changes, Full also posts, approves and pays. Your own leave, claims, time and payslips are always yours.</p>
    </Card>
  );
}

function DarkLevel({ level }: { level: Me['levels'][keyof Me['levels']] }): React.JSX.Element {
  if (level === 'full') return <span className="rounded-full bg-[var(--erp-on-dark)] px-2.5 py-0.5 text-[12px] font-bold text-[var(--erp-dark)]">Full</span>;
  if (level === 'none') return <span className="px-2.5 py-0.5 text-[12px] font-semibold">None</span>;
  return <span className="rounded-full bg-[var(--erp-dark)] px-2.5 py-0.5 text-[12px] font-semibold">{level === 'edit' ? 'Edit' : 'View'}</span>;
}

