/**
 * Settings, Members: who signs in, their role and funds; invite with a code
 * shown once; roles as a level grid (none, view, edit, full per module).
 * Changes to members and roles ask the approval PIN.
 */
import { useState } from 'react';
import { Ban, CircleCheck, KeyRound, LogOut, Pencil, RotateCcw, Trash2, UserPlus, Users } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { Avatar, Button, ChipPicker, DataTable, Dialog, Empty, Field, Input, LoadError, Menu, MenuItem, MenuSep, Panel, Segmented, Skeleton, StatusDot, SubHeader, confirmAsk } from '../../components/ui.tsx';
import type { Tone } from '../../components/ui.tsx';
import { copyText, op } from '../../lib/api.ts';
import { allowed, useMe } from '../../lib/auth.ts';
import { ago } from '../../lib/format.ts';
import { act, drop, patch, useOp } from '../../lib/live.ts';
import type { Level } from '../../lib/types.ts';
import { OnceCode } from '../auth/index.tsx';

export interface Member {
  id: string;
  name: string;
  email: string;
  title: string;
  status: 'invited' | 'active' | 'disabled';
  role: { id: string; code: string; name: string } | null;
  funds: string[];
  has_pin: boolean;
  last_seen: string;
  invite_expires: string;
}

export interface Role {
  id: string;
  code: string;
  name: string;
  levels: Record<string, Level>;
  system: boolean;
  members: number;
}

interface RoleList {
  roles: Role[];
  modules: { key: string; label: string }[];
}

const STATUS: Record<Member['status'], { tone: Tone; label: string }> = {
  active: { tone: 'good', label: 'Active' },
  invited: { tone: 'warn', label: 'Invited' },
  disabled: { tone: 'faint', label: 'Disabled' },
};

const RANK: Record<Level, number> = { none: 0, view: 1, edit: 2, full: 3 };

/** A level as three small bars (none, view, edit, full); the word is the tooltip. */
function LevelBars({ level }: { level: Level }): React.JSX.Element {
  const n = RANK[level] ?? 0;
  return (
    <span role="img" aria-label={level} title={level.charAt(0).toUpperCase() + level.slice(1)} className="inline-flex items-end gap-[2px]">
      {[1, 2, 3].map((i) => (
        <span key={i} className={cn('w-[4px] rounded-[1px]', i <= n ? 'bg-[var(--vo-ink)]' : 'bg-[var(--vo-line)]')} style={{ height: 4 + i * 3 }} />
      ))}
    </span>
  );
}

function inviteLink(email: string, code: string): string {
  return `${window.location.origin}${window.location.pathname}#/invite?email=${encodeURIComponent(email)}&code=${encodeURIComponent(code)}`;
}

function CodeShown({ email, code }: { email: string; code: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <OnceCode code={code} />
      <Button size="sm" className="self-start" onClick={() => void copyText(inviteLink(email, code)).then(setCopied)}>
        {copied ? 'Link copied' : 'Copy link'}
      </Button>
    </div>
  );
}

function InviteDialog({ roles, onClose }: { roles: Role[]; onClose: () => void }): React.JSX.Element {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('analyst');
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && name.trim() !== '' && role !== '';
  const send = async (): Promise<void> => {
    setBusy(true);
    const out = await act([], () => op<{ code: string }>('members.invite', { email: email.trim(), name: name.trim(), role }, { pin: { title: 'Invite' } }), ['members']);
    setBusy(false);
    if (out !== null) setCode(out.code);
  };
  return (
    <Dialog open onClose={onClose} title={code !== null ? name : 'Invite'} width={460} footer={code !== null ? <Button variant="primary" onClick={onClose}>Done</Button> : <><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} disabled={!ok} onClick={() => void send()}>Invite</Button></>}>
      {code !== null ? (
        <CodeShown email={email.trim()} code={code} />
      ) : (
        <div className="flex flex-col gap-4">
          <Field label="Email">
            <Input type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" />
          </Field>
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" />
          </Field>
          <Field label="Role">
            <ChipPicker label="Role" value={role} onChange={setRole} options={roles.filter((r) => r.code !== 'owner').map((r) => ({ value: r.code, label: r.name }))} />
          </Field>
        </div>
      )}
    </Dialog>
  );
}

function RoleDialog({ member, roles, onClose }: { member: Member; roles: Role[]; onClose: () => void }): React.JSX.Element {
  const [role, setRole] = useState(member.role?.code ?? '');
  const [busy, setBusy] = useState(false);
  const save = async (): Promise<void> => {
    setBusy(true);
    const r = roles.find((x) => x.code === role);
    const out = await act([patch(member.id, { role: r === undefined ? null : { id: r.id, code: r.code, name: r.name } })], () => op('members.update', { member: member.id, role }, { pin: { title: 'Change role' } }), ['members']);
    setBusy(false);
    if (out !== null) onClose();
  };
  return (
    <Dialog open onClose={onClose} title={member.name} width={460} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} disabled={role === member.role?.code} onClick={() => void save()}>Save</Button></>}>
      <ChipPicker label="Role" value={role} onChange={setRole} options={roles.map((r) => ({ value: r.code, label: r.name }))} />
    </Dialog>
  );
}

function LevelsDialog({ role, modules, onClose }: { role: Role; modules: RoleList['modules']; onClose: () => void }): React.JSX.Element {
  const [levels, setLevels] = useState<Record<string, Level>>({ ...role.levels });
  const [busy, setBusy] = useState(false);
  const save = async (): Promise<void> => {
    setBusy(true);
    const out = await act([patch(role.id, { levels })], () => op('roles.update', { role: role.id, levels }, { pin: { title: 'Change role' } }), ['roles']);
    setBusy(false);
    if (out !== null) onClose();
  };
  return (
    <Dialog open onClose={onClose} title={role.name} width={520} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={() => void save()}>Save</Button></>}>
      <div className="flex flex-col">
        {modules.map((m) => (
          <div key={m.key} className="flex min-h-10 items-center gap-3 border-b border-[var(--vo-hair)] last:border-b-0">
            <span className="min-w-0 flex-1 text-[13px]">{m.label}</span>
            <Segmented size="sm" label={m.label} value={levels[m.key] ?? 'none'} onChange={(v) => setLevels({ ...levels, [m.key]: v })} options={(['none', 'view', 'edit', 'full'] as const).map((l) => ({ value: l, label: l.charAt(0).toUpperCase() + l.slice(1) }))} />
          </div>
        ))}
      </div>
    </Dialog>
  );
}

function RowMenu({ m, edit, onRole }: { m: Member; edit: boolean; onRole: () => void }): React.JSX.Element | null {
  const me = useMe();
  if (!edit && m.id !== me.member.id) return null;
  const mine = m.id === me.member.id;
  const newCode = async (): Promise<void> => {
    const r = await act([], () => op<{ code: string }>('members.reset', { member: m.id }), ['members']);
    if (r !== null) void copyText(inviteLink(m.email, r.code));
  };
  const remove = async (): Promise<void> => {
    if (await confirmAsk(`Remove ${m.name}?`, 'Remove')) await act([drop(m.id)], () => op('members.delete', { member: m.id }), ['members']);
  };
  const entries: { key: string; icon: typeof Pencil; label: string; run: () => unknown; danger?: boolean; sep?: boolean }[] = [];
  if (edit) entries.push({ key: 'role', icon: Pencil, label: 'Change role', run: onRole });
  if (edit && m.status !== 'active') entries.push({ key: 'code', icon: RotateCcw, label: 'New invite code', run: newCode });
  if (edit && !mine && m.has_pin) entries.push({ key: 'pin', icon: KeyRound, label: 'Clear PIN', run: () => act([patch(m.id, { has_pin: false })], () => op('pin.reset', { member: m.id }), ['members']) });
  entries.push({ key: 'out', icon: LogOut, label: 'Sign out everywhere', run: () => act([], () => op('members.signout', { member: m.id }), ['members']) });
  if (edit && !mine) {
    entries.push(m.status === 'disabled' ? { key: 'on', icon: CircleCheck, label: 'Enable', run: () => act([patch(m.id, { status: 'active' })], () => op('members.enable', { member: m.id }), ['members']), sep: true } : { key: 'off', icon: Ban, label: 'Disable', run: () => act([patch(m.id, { status: 'disabled' })], () => op('members.disable', { member: m.id }), ['members']), sep: true });
    entries.push({ key: 'rm', icon: Trash2, label: 'Remove', run: remove, danger: true });
  }
  return (
    <span onClick={(e) => e.stopPropagation()}>
      <Menu label="More" onRow>
        {(close) =>
          entries.map((x) => (
            <span key={x.key}>
              {x.sep === true && <MenuSep />}
              <MenuItem
                icon={x.icon}
                danger={x.danger}
                onClick={() => {
                  close();
                  void x.run();
                }}
              >
                {x.label}
              </MenuItem>
            </span>
          ))
        }
      </Menu>
    </span>
  );
}

export function MembersSettings(): React.JSX.Element {
  const me = useMe();
  const edit = allowed(me, 'admin');
  const [view, setView] = useState<'members' | 'roles'>('members');
  const [inviting, setInviting] = useState(false);
  const [roleOf, setRoleOf] = useState<Member | null>(null);
  const [levelsOf, setLevelsOf] = useState<Role | null>(null);
  const members = useOp<{ members: Member[] }>('members.list', {}, ['members'], { name: 'settings.members' });
  const roles = useOp<RoleList>('roles.list', {}, ['roles', 'members'], { name: 'settings.roles' });
  const rl = roles.data?.roles ?? [];
  const mods = roles.data?.modules ?? [];
  return (
    <>
      <SubHeader title="Members">
        <Segmented label="View" value={view} onChange={setView} options={[{ value: 'members', label: 'Members' }, { value: 'roles', label: 'Roles' }]} />
        {edit && (
          <Button variant="primary" icon={UserPlus} onClick={() => setInviting(true)} disabled={roles.data === null}>
            Invite
          </Button>
        )}
      </SubHeader>
      <Panel flush>
        {view === 'members' ? (
          members.data === null ? (
            members.error !== null ? (
              <LoadError message={members.error} onRetry={members.reload} />
            ) : (
              <div className="p-5">
                <Skeleton className="h-24 w-full" />
              </div>
            )
          ) : (
            <DataTable
              label="Members"
              rows={members.data.members}
              rowKey={(m) => m.id}
              stickyTop={0}
              empty={<Empty icon={Users} title="Just you" />}
              columns={[
                {
                  key: 'name',
                  label: 'Name',
                  width: 'minmax(200px,2fr)',
                  phone: 'title',
                  fixed: true,
                  sort: (m) => m.name,
                  render: (m) => (
                    <span className="flex min-w-0 items-center gap-2" title={m.email}>
                      <Avatar name={m.name} size={22} />
                      <span className="truncate font-medium">{m.name}</span>
                    </span>
                  ),
                },
                { key: 'role', label: 'Role', width: 'minmax(110px,1fr)', sort: (m) => m.role?.name ?? '', render: (m) => m.role?.name ?? '' },
                { key: 'status', label: 'Status', width: '100px', render: (m) => <StatusDot tone={STATUS[m.status]?.tone ?? 'faint'} label={STATUS[m.status]?.label ?? m.status} /> },
                { key: 'pin', label: 'PIN', width: '60px', align: 'center', render: (m) => <StatusDot tone={m.has_pin ? 'good' : 'faint'} title={m.has_pin ? 'PIN set' : 'No PIN'} /> },
                { key: 'seen', label: 'Seen', width: '110px', mono: true, phone: 'end', render: (m) => ago(m.last_seen) },
                { key: 'more', label: '', width: '40px', fixed: true, phone: 'hide', render: (m) => <RowMenu m={m} edit={edit} onRole={() => setRoleOf(m)} /> },
              ]}
            />
          )
        ) : roles.data === null ? (
          <div className="p-5">
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <div className="vo-scroll overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-[13px]">
              <thead>
                <tr className="h-8 border-b border-[var(--vo-line)]">
                  <th className="px-4 text-left text-[12px] font-medium text-[var(--vo-muted)]">Role</th>
                  {mods.map((m) => (
                    <th key={m.key} className="px-1 text-center text-[12px] font-medium text-[var(--vo-muted)]">
                      {m.label}
                    </th>
                  ))}
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {rl.map((r) => (
                  <tr key={r.id} onClick={edit && r.code !== 'owner' ? () => setLevelsOf(r) : undefined} className={cn('h-9 border-b border-[var(--vo-hair)] transition-colors duration-150 last:border-b-0', edit && r.code !== 'owner' && 'cursor-pointer hover:bg-[var(--vo-hover)]')}>
                    <td className="px-4">
                      <span className="font-medium">{r.name}</span>
                      <span className="vo-mono ml-2 text-[12px] text-[var(--vo-muted)]">{r.members}</span>
                    </td>
                    {mods.map((m) => (
                      <td key={m.key} className="px-1 text-center">
                        <LevelBars level={r.code === 'owner' ? 'full' : (r.levels[m.key] ?? 'none')} />
                      </td>
                    ))}
                    <td className="pr-3 text-right">{edit && r.code !== 'owner' && <Pencil size={13} aria-hidden className="inline text-[var(--vo-muted)]" />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {inviting && <InviteDialog roles={rl} onClose={() => setInviting(false)} />}
      {roleOf !== null && <RoleDialog member={roleOf} roles={rl} onClose={() => setRoleOf(null)} />}
      {levelsOf !== null && <LevelsDialog role={levelsOf} modules={mods} onClose={() => setLevelsOf(null)} />}
    </>
  );
}
