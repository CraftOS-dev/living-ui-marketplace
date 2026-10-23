/**
 * The team: who has an account, their role, status and when they were last
 * here. Invite someone (a code shown once, valid 7 days), change roles and
 * details, issue a new sign-in code, sign someone out everywhere, disable
 * or enable, remove an unused invite. Owners are changed only by an owner,
 * and one active owner always remains.
 */
import { useMemo, useState } from 'react';
import { Check, Copy, KeyRound, LogOut, PenLine, ShieldCheck, Trash2, UserCheck, UserPlus, UserX, Users } from 'lucide-react';
import { toast } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { ago, dayLabel, shortDay } from '../../lib/dates.ts';
import { useLive } from '../../lib/live.ts';
import { useMe } from '../../lib/me.ts';
import { navigate } from '../../lib/router.ts';
import type { InviteResult, Member, MemberList, MemberStatus, RoleList } from '../../lib/types/settings.ts';
import { localDay } from '../agent/words.ts';
import { Chips, Menu, SearchBox, useDebounced } from '../controls.tsx';
import type { Option } from '../pickers.tsx';
import { EmployeePicker } from '../pickers.tsx';
import { DataTable } from '../table.tsx';
import { Avatar, Card, Empty, Field, LoadError, Modal, Notice, PillButton, PillSelect, StatusPill, TextLink, softInput, useConfirm } from '../ui.tsx';
import type { Tone } from '../ui.tsx';

const STATUS: Record<MemberStatus, { label: string; tone: Tone }> = {
  active: { label: 'Active', tone: 'good' },
  invited: { label: 'Invited', tone: 'warn' },
  disabled: { label: 'Disabled', tone: 'neutral' },
};

type Filter = '' | MemberStatus;

export function TeamSection(): React.JSX.Element {
  const me = useMe();
  const [filter, setFilter] = useState<Filter>('');
  const [text, setText] = useState('');
  const q = useDebounced(text.trim(), 250);
  const list = useLive(() => op<MemberList>('members.list', { q, status: filter === '' ? undefined : filter, limit: 500 }, { quiet: true }), ['members', 'roles'], [q, filter]);
  const roles = useLive(() => op<RoleList>('roles.list', {}, { quiet: true }), ['roles'], []);
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const [code, setCode] = useState<{ name: string; email: string; code: string; expires: string; reset: boolean } | null>(null);
  const [confirmEl, confirm] = useConfirm();

  const counts = list.data?.counts ?? {};
  const all = (counts.active ?? 0) + (counts.invited ?? 0) + (counts.disabled ?? 0);
  const roleOptions = (roles.data?.roles ?? []).filter((r) => r.key !== 'owner' || me.owner).map((r) => ({ value: r.id, label: r.name }));

  const protectedRow = (m: Member): boolean => m.role?.key === 'owner' && !me.owner;

  const run = async (name: 'members.disable' | 'members.enable' | 'members.signout', m: Member, done: string): Promise<void> => {
    try {
      await op(name, { member: m.id });
      toast.success(done);
      list.reload();
    } catch {
      /* shown */
    }
  };
  const reset = async (m: Member): Promise<void> => {
    const ok = await confirm(
      m.status === 'active' ? `${m.name} is signed out everywhere and gets a new code to set a password. Their current password keeps working until they use it.` : `${m.name} gets a new invite code, valid 7 days. The old one stops working.`,
      'Give a new sign-in code?',
      'New code',
      false,
    );
    if (!ok) return;
    try {
      const r = await op<InviteResult>('members.reset', { member: m.id });
      setCode({ name: m.name, email: m.email, code: r.code, expires: r.expires, reset: true });
      list.reload();
    } catch {
      /* shown */
    }
  };
  const remove = async (m: Member): Promise<void> => {
    if (!(await confirm(`The invite for ${m.name} is removed. They never signed in, so nothing else changes.`, 'Remove this invite?', 'Remove'))) return;
    try {
      await op('members.delete', { member: m.id });
      toast.success('Invite removed');
      list.reload();
    } catch {
      /* shown */
    }
  };
  const disable = async (m: Member): Promise<void> => {
    if (!(await confirm(`${m.name} is signed out everywhere and cannot sign in until enabled again. Their history keeps their name.`, `Disable ${m.name}?`, 'Disable'))) return;
    await run('members.disable', m, `${m.name} is disabled`);
  };

  const menuFor = (m: Member): React.JSX.Element | null => {
    if (protectedRow(m)) return null;
    const self = m.id === me.member.id;
    return (
      <Menu
        variant="row"
        size={36}
        label={`Actions for ${m.name}`}
        items={[
          { label: 'Edit details and role', icon: PenLine, onClick: () => setEditing(m) },
          { label: m.status === 'invited' ? 'New invite code' : 'New sign-in code', icon: KeyRound, onClick: () => void reset(m), hidden: m.status === 'disabled' },
          { label: 'Sign out everywhere', icon: LogOut, onClick: () => void run('members.signout', m, `${m.name} is signed out everywhere`), hidden: m.status !== 'active' || self },
          { label: 'Enable', icon: UserCheck, onClick: () => void run('members.enable', m, `${m.name} is enabled`), hidden: m.status !== 'disabled' },
          { label: 'Disable', icon: UserX, onClick: () => void disable(m), hidden: m.status === 'disabled' || self, danger: true },
          { label: 'Remove invite', icon: Trash2, onClick: () => void remove(m), hidden: m.status !== 'invited' || m.last_seen !== '', danger: true },
        ]}
      />
    );
  };

  const seen = (m: Member): string => {
    if (m.status === 'invited') {
      if (m.invite_expires === '') return 'Invite sent';
      return Date.parse(m.invite_expires) < Date.now() ? 'Code expired' : `Code until ${shortDay(localDay(m.invite_expires))}`;
    }
    return m.last_seen !== '' ? ago(m.last_seen) : 'Never';
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Chips<Filter>
          ariaLabel="Status"
          value={filter}
          onChange={setFilter}
          className="min-w-0"
          options={[
            { value: '', label: 'Everyone', count: all },
            { value: 'active', label: 'Active', count: counts.active ?? 0 },
            { value: 'invited', label: 'Invited', count: counts.invited ?? 0 },
            { value: 'disabled', label: 'Disabled', count: counts.disabled ?? 0 },
          ]}
        />
        <SearchBox value={text} onChange={setText} placeholder="Search people" ariaLabel="Search the team" className="min-w-[12rem] flex-1" />
        <PillButton icon={UserPlus} dot onClick={() => setInviting(true)}>
          Invite
        </PillButton>
      </div>

      <Card delay={1}>
        {list.data === null && list.error !== null ? (
          <LoadError message={list.error} onRetry={list.reload} />
        ) : (
          <DataTable
            ariaLabel="Team"
            loading={list.data === null}
            rows={list.data?.members ?? []}
            rowKey={(m) => m.id}
            onOpen={(m) => (protectedRow(m) ? undefined : setEditing(m))}
            rowTone={(m) => (m.status === 'disabled' ? 'muted' : undefined)}
            empty={<Empty icon={Users} title={q !== '' ? 'No one matches' : 'No one here'} />}
            columns={[
              {
                key: 'name',
                label: 'Member',
                width: 'minmax(0, 2fr)',
                sort: (m) => m.name.toLowerCase(),
                render: (m) => (
                  <span className="flex min-w-0 items-center gap-3">
                    <Avatar name={m.name} size={36} tone={m.id === me.member.id ? 'ink' : 'row'} />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">
                        {m.name}
                        {m.id === me.member.id && <span className="font-medium text-[var(--erp-muted)]"> (you)</span>}
                      </span>
                      <span className="block truncate text-[12px] text-[var(--erp-muted)]">{m.email}</span>
                    </span>
                  </span>
                ),
              },
              {
                key: 'role',
                label: 'Role',
                width: 'minmax(0, 1fr)',
                sort: (m) => m.role?.name ?? '',
                render: (m) => (
                  <span className="flex min-w-0 items-center gap-1.5 truncate text-[13px] font-semibold">
                    {m.role?.key === 'owner' && <ShieldCheck size={14} aria-hidden className="shrink-0" />}
                    {m.role?.name ?? 'No role'}
                  </span>
                ),
              },
              {
                key: 'employee',
                label: 'Employee',
                width: 'minmax(0, 1fr)',
                hide: 'xl',
                render: (m) =>
                  m.employee !== null ? (
                    <TextLink tone="muted" onClick={() => navigate('employee', { id: m.employee?.id ?? '' })}>
                      {m.employee.number}
                    </TextLink>
                  ) : (
                    <span className="text-[13px] text-[var(--erp-muted)]">Not linked</span>
                  ),
              },
              {
                key: 'status',
                label: 'Status',
                width: '120px',
                render: (m) => (
                  <span className="flex flex-wrap gap-1">
                    <StatusPill tone={STATUS[m.status].tone} size="sm">
                      {STATUS[m.status].label}
                    </StatusPill>
                    {m.locked && (
                      <StatusPill tone="bad" size="sm">
                        Locked
                      </StatusPill>
                    )}
                  </span>
                ),
              },
              { key: 'seen', label: 'Last seen', width: 'minmax(0, 1.1fr)', hide: 'lg', sort: (m) => m.last_seen, render: (m) => <span className="truncate text-[13px] text-[var(--erp-ink-2)]">{seen(m)}</span> },
              { key: 'menu', label: '', width: '44px', align: 'right', render: (m) => menuFor(m) ?? <span title="Only an owner changes an owner" className="flex size-9 items-center justify-center text-[var(--erp-muted)]"><ShieldCheck size={15} aria-label="Only an owner changes an owner" /></span> },
            ]}
            mobile={(m) => ({
              lead: <Avatar name={m.name} size={36} tone="card" />,
              title: m.name,
              sub: `${m.role?.name ?? 'No role'} · ${seen(m)}`,
              rightSub: STATUS[m.status].label + (m.locked ? ', locked' : ''),
            })}
          />
        )}
      </Card>

      <p className="flex items-center gap-2 px-1 text-[12px] text-[var(--erp-muted)]">
        <ShieldCheck size={14} aria-hidden /> Only an owner changes an owner, and one active owner always remains. Ten wrong passwords lock an account for 15 minutes.
      </p>

      {inviting && (
        <InviteModal
          roles={roleOptions}
          onClose={() => setInviting(false)}
          onInvited={(r, name, email) => {
            setInviting(false);
            setCode({ name, email, code: r.code, expires: r.expires, reset: false });
            list.reload();
          }}
        />
      )}
      {editing !== null && <EditModal m={editing} roles={roleOptions} onClose={() => setEditing(null)} onSaved={() => list.reload()} />}
      {code !== null && <CodeModal {...code} onClose={() => setCode(null)} />}
      {confirmEl}
    </div>
  );
}

function InviteModal({ roles, onClose, onInvited }: { roles: { value: string; label: string }[]; onClose: () => void; onInvited: (r: InviteResult, name: string, email: string) => void }): React.JSX.Element {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [title, setTitle] = useState('');
  const defaultRole = roles.find((r) => r.label === 'Employee')?.value ?? roles[0]?.value ?? '';
  const [role, setRole] = useState(defaultRole);
  const [employee, setEmployee] = useState<Option | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const r = await op<InviteResult>('members.invite', { name: name.trim(), email: email.trim(), role: role !== '' ? role : defaultRole, title: title.trim() === '' ? undefined : title.trim(), employee: employee?.id }, { quiet: true });
      onInvited(r, name.trim(), email.trim());
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
      title="Invite someone"
      description="They get a code to set their own password. It is valid for 7 days."
      footer={
        <>
          <PillButton variant="soft" onClick={onClose}>
            Cancel
          </PillButton>
          <PillButton icon={UserPlus} dot loading={busy} disabled={name.trim() === '' || email.trim() === ''} onClick={() => void send()}>
            Invite
          </PillButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error !== null && <Notice tone="bad">{error}</Notice>}
        <Field label="Name">
          <input className={softInput} value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={120} />
        </Field>
        <Field label="Email">
          <input className={softInput} type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={160} />
        </Field>
        <PillSelect label="Role" soft value={role} onChange={setRole} options={roles} />
        <Field label="Job title" optional>
          <input className={softInput} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
        </Field>
        <Field label="Their employee record" optional hint="Links their leave, claims, time and payslips">
          <EmployeePicker value={employee} onChange={setEmployee} clearable placeholder="Choose an employee" />
        </Field>
      </div>
    </Modal>
  );
}

function EditModal({ m, roles, onClose, onSaved }: { m: Member; roles: { value: string; label: string }[]; onClose: () => void; onSaved: () => void }): React.JSX.Element {
  const [name, setName] = useState(m.name);
  const [email, setEmail] = useState(m.email);
  const [title, setTitle] = useState(m.title);
  const [role, setRole] = useState(m.role?.id ?? '');
  const [employee, setEmployee] = useState<Option | null>(m.employee !== null ? { id: m.employee.id, label: m.employee.name, sub: m.employee.number, value: m.employee.id } : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const roleOptions = useMemo(() => (roles.some((r) => r.value === role) || m.role === null ? roles : [...roles, { value: m.role.id, label: m.role.name }]), [roles, role, m.role]);
  const save = async (): Promise<void> => {
    const changes: Record<string, string> = {};
    if (name.trim() !== m.name) changes['name'] = name.trim();
    if (email.trim().toLowerCase() !== m.email) changes['email'] = email.trim();
    if (title.trim() !== m.title) changes['title'] = title.trim();
    if (role !== (m.role?.id ?? '')) changes['role'] = role;
    if ((employee?.id ?? '') !== (m.employee?.id ?? '')) changes['employee'] = employee?.id ?? '';
    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await op('members.update', { member: m.id, ...changes }, { quiet: true });
      toast.success('Saved');
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
      title={m.name}
      description={m.email}
      footer={
        <>
          <PillButton variant="soft" onClick={onClose}>
            Cancel
          </PillButton>
          <PillButton icon={Check} dot loading={busy} onClick={() => void save()}>
            Save
          </PillButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error !== null && <Notice tone="bad">{error}</Notice>}
        <Field label="Name">
          <input className={softInput} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </Field>
        <Field label="Email" hint="They sign in with this">
          <input className={softInput} type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={160} />
        </Field>
        <PillSelect label="Role" soft value={role} onChange={setRole} options={roleOptions} />
        <Field label="Job title" optional>
          <input className={softInput} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
        </Field>
        <Field label="Their employee record" optional>
          <EmployeePicker value={employee} onChange={setEmployee} clearable placeholder="Not linked" />
        </Field>
      </div>
    </Modal>
  );
}

function CodeModal({ name, email, code, expires, reset, onClose }: { name: string; email: string; code: string; expires: string; reset: boolean; onClose: () => void }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy. Select the code and copy it.');
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={reset ? `New code for ${name}` : `${name} is invited`}
      footer={
        <PillButton icon={Check} onClick={onClose}>
          Done
        </PillButton>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="erp-on-dark rounded-[22px] bg-[var(--erp-dark)] px-5 py-6 text-center text-[var(--erp-on-dark)]">
          <p className="text-[12px] font-semibold text-[var(--erp-on-dark-muted)]">Sign-in code for {email}</p>
          <p className="num mt-2 select-all text-[26px] font-extrabold tracking-[0.12em]">{code}</p>
          <button type="button" onClick={() => void copy()} className="mx-auto mt-4 inline-flex h-9 items-center gap-2 rounded-full bg-[var(--erp-dark-2)] px-4 text-[13px] font-semibold">
            {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
            {copied ? 'Copied' : 'Copy code'}
          </button>
        </div>
        <Notice tone="warn">This code is shown once. Copy it now and send it to {name.split(' ')[0]} in your own words.</Notice>
        <p className="text-[13px] leading-5 text-[var(--erp-ink-2)]">
          It is valid until {expires !== '' ? dayLabel(localDay(expires)) : 'in 7 days'}. On the sign-in screen they choose "I have an invite code", enter their email and this code, and set a password.
        </p>
      </div>
    </Modal>
  );
}
