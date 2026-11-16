/**
 * Members and roles. Members: who can sign in, with their role, the person
 * they are, the entities they see and their PIN; invite with a code (the
 * link is copied for you). Roles: the level grid, one column per role, a
 * click on a cell picks none, view, edit or full. Changes to people's access
 * need the approval PIN.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Ban, Copy, KeyRound, Link2, Mail, MoreHorizontal, Plus, RotateCcw, ShieldCheck, Trash2, UserCheck, Users } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { Button, DataTable, Dialog, Empty, Field, Input, Loading, Menu, MenuItem, MenuSep, Notice, Panel, Picker, Popover, SearchInput, Segmented, StatusDot, Tag, Toggle, confirmAsk } from '../../components/ui.tsx';
import type { Column } from '../../components/ui.tsx';
import { askPin, copyText, errMessage, op } from '../../lib/api.ts';
import { can, refreshMe, useMe } from '../../lib/auth.tsx';
import { ago } from '../../lib/format.ts';
import { t, tn } from '../../lib/i18n.ts';
import { changed, useOp } from '../../lib/live.ts';
import { setQuery, useRoute } from '../../lib/router.ts';
import { toast } from '../../lib/toast.ts';
import type { Level, Module } from '../../lib/types.ts';
import { MODULES } from '../../lib/types.ts';
import { usePeopleItems } from '../people/RecordDialogs.tsx';

interface Member {
  id: string;
  name: string;
  email: string;
  title: string;
  status: 'invited' | 'active' | 'disabled';
  role: { id: string; code: string; name: string } | null;
  employee: { id: string; number: string; name: string } | null;
  entities: string[];
  has_pin: boolean;
  last_seen: string;
  invite_expires: string;
  locked: boolean;
  created: string;
}

interface Role {
  id: string;
  code: string;
  name: string;
  levels: Record<Module, Level>;
  team_scope: boolean;
  description: string;
  system: boolean;
  members: number;
}

const READS = ['members', 'roles'];

function inviteLink(email: string, code: string): string {
  const base = window.location.href.split('#')[0] ?? '';
  return `${base}#/invite?email=${encodeURIComponent(email)}&code=${encodeURIComponent(code)}`;
}

function CodeShown({ email, code, onClose }: { email: string; code: string; onClose: () => void }): React.JSX.Element {
  const link = inviteLink(email, code);
  return (
    <Dialog open onClose={onClose} title={t('members.code_title')} meta={email} width={480} footer={<Button variant="primary" onClick={onClose}>{t('ui.done')}</Button>}>
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-[var(--hr-ink-2)]">{t('members.code_text')}</p>
        <div className="flex items-center gap-2 rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)] bg-[var(--hr-sunk)] p-3">
          <code className="hr-mono min-w-0 flex-1 select-all text-[15px] tracking-[0.08em]">{code}</code>
          <Button size="sm" icon={Copy} onClick={() => void copyText(code).then((ok) => ok && toast.success(t('ui.copied')))}>
            {t('ui.copy')}
          </Button>
        </div>
        <Button icon={Link2} onClick={() => void copyText(link).then((ok) => ok && toast.success(t('members.link_copied')))}>
          {t('members.copy_link')}
        </Button>
      </div>
    </Dialog>
  );
}

function InviteDialog({ open, onClose, roles, prefill }: { open: boolean; onClose: () => void; roles: Role[]; prefill?: { name: string; email: string; employee: string } | null | undefined }): React.JSX.Element | null {
  const me = useMe();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('employee');
  const [employee, setEmployee] = useState('');
  const [entities, setEntities] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const people = usePeopleItems('');
  useEffect(() => {
    if (open) {
      setEmail(prefill?.email ?? '');
      setName(prefill?.name ?? '');
      setRole('employee');
      setEmployee(prefill?.employee ?? '');
      setEntities([]);
      setError(null);
      setCode(null);
    }
  }, [open]);
  if (!open) return null;
  if (code !== null) return <CodeShown email={email.trim()} code={code} onClose={onClose} />;
  const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && name.trim() !== '';
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const r = await op<{ code: string }>('members.invite', { email: email.trim(), name: name.trim(), role, employee: employee === '' ? undefined : employee, entities: entities.length > 0 ? entities : undefined }, { quiet: true, pin: { title: t('members.invite') } });
      changed(...READS);
      setCode(r.code);
    } catch (e) {
      if ((e as { code?: string }).code !== 'aborted') setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('members.invite')}
      width={520}
      footer={
        <>
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          <Button variant="primary" icon={Mail} busy={busy} disabled={!ok} onClick={() => void save()}>
            {t('members.invite')}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t('setup.email')}>
          <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoFocus aria-label={t('setup.email')} />
        </Field>
        <Field label={t('members.name')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} aria-label={t('members.name')} />
        </Field>
        <Field label={t('members.role')}>
          <Picker value={role} onChange={setRole} items={roles.filter((r) => r.code !== 'owner' || me.owner).map((r) => ({ value: r.code, label: r.name, sub: r.description }))} label={t('members.role')} />
        </Field>
        <Field label={t('members.person')} optional help={t('members.person_help')}>
          <Picker
            value={employee}
            onChange={(v, it) => {
              setEmployee(v);
              if (it !== null && name.trim() === '') setName(it.label);
            }}
            items={people}
            label={t('members.person')}
            clearable
          />
        </Field>
        {me.entities.length > 1 && (
          <Field label={t('members.entities')} className="sm:col-span-2" help={t('members.entities_help')}>
            <div className="flex flex-wrap gap-1.5">
              {me.entities.map((e) => {
                const on = entities.includes(e.id);
                return (
                  <button key={e.id} type="button" aria-pressed={on} onClick={() => setEntities((x) => (on ? x.filter((y) => y !== e.id) : [...x, e.id]))} className={cn('hr-focus hr-tap h-7 rounded-[var(--hr-radius-sm)] border px-2.5 text-[13px] transition-colors', on ? 'border-[var(--hr-ink)] bg-[var(--hr-ink)] text-[var(--hr-on-ink)]' : 'border-[var(--hr-line)] bg-[var(--hr-raised)] hover:bg-[var(--hr-hover)]')}>
                    {e.name}
                  </button>
                );
              })}
              {entities.length === 0 && <span className="self-center text-[12px] text-[var(--hr-muted)]">{t('members.all_entities')}</span>}
            </div>
          </Field>
        )}
      </div>
      {error !== null && (
        <Notice tone="bad" className="mt-3">
          {error}
        </Notice>
      )}
    </Dialog>
  );
}

function MemberActions({ m, roles, onCode }: { m: Member; roles: Role[]; onCode: (email: string, code: string) => void }): React.JSX.Element {
  const me = useMe();
  const run = async (name: 'members.disable' | 'members.enable' | 'members.delete' | 'pin.reset', title: string, ask?: string): Promise<void> => {
    if (ask !== undefined && !(await confirmAsk(ask, title, title))) return;
    try {
      await op(name, { member: m.id }, { pin: { title } });
      changed(...READS);
      toast.success(t('ui.done'));
    } catch {
      /* toast shown */
    }
  };
  const setRole = async (code: string): Promise<void> => {
    try {
      await op('members.update', { member: m.id, role: code }, { pin: { title: t('members.change_role') } });
      changed(...READS);
      if (m.id === me.member.id) void refreshMe();
    } catch {
      /* toast shown */
    }
  };
  const reset = async (): Promise<void> => {
    try {
      const r = await op<{ code: string }>('members.reset', { member: m.id }, { pin: { title: t('members.new_code') } });
      changed(...READS);
      onCode(m.email, r.code);
    } catch {
      /* toast shown */
    }
  };
  return (
    <Menu icon={MoreHorizontal} label={t('ui.more')}>
      {(close) => (
        <>
          <div className="hr-label px-2 pb-1 pt-2">{t('members.role')}</div>
          {roles
            .filter((r) => r.code !== 'owner' || me.owner)
            .map((r) => (
              <MenuItem key={r.id} selected={m.role?.id === r.id} onClick={() => (close(), void setRole(r.code))}>
                {r.name}
              </MenuItem>
            ))}
          <MenuSep />
          {m.status !== 'disabled' && (
            <MenuItem icon={RotateCcw} onClick={() => (close(), void reset())}>
              {m.status === 'invited' ? t('members.new_code') : t('members.reset_password')}
            </MenuItem>
          )}
          {m.has_pin && m.id !== me.member.id && (
            <MenuItem icon={KeyRound} onClick={() => (close(), void run('pin.reset', t('members.clear_pin'), t('members.clear_pin_text', { name: m.name })))}>
              {t('members.clear_pin')}
            </MenuItem>
          )}
          {m.id !== me.member.id &&
            (m.status === 'disabled' ? (
              <MenuItem icon={UserCheck} onClick={() => (close(), void run('members.enable', t('members.enable')))}>
                {t('members.enable')}
              </MenuItem>
            ) : (
              <MenuItem icon={Ban} danger onClick={() => (close(), void run('members.disable', t('members.disable'), t('members.disable_text', { name: m.name })))}>
                {t('members.disable')}
              </MenuItem>
            ))}
          {m.id !== me.member.id && (
            <MenuItem icon={Trash2} danger onClick={() => (close(), void run('members.delete', t('members.delete'), t('members.delete_text', { name: m.name })))}>
              {t('members.delete')}
            </MenuItem>
          )}
        </>
      )}
    </Menu>
  );
}

export function MembersSection(): React.JSX.Element {
  const me = useMe();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'invited' | 'disabled'>('all');
  const live = useOp<{ members: Member[]; total: number }>('members.list', { q: q.trim() === '' ? undefined : q.trim(), status: status === 'all' ? undefined : status, limit: 500 }, READS, { name: 'settings.members', keep: true });
  const roles = useOp<{ roles: Role[] }>('roles.list', {}, READS, { name: 'settings.roles' });
  // A link may open the invite filled in (the profile's next steps after a hire): ?invite=1&name=&email=&employee=
  const { query } = useRoute();
  const prefill = query.get('invite') === '1' ? { name: query.get('name') ?? '', email: query.get('email') ?? '', employee: query.get('employee') ?? '' } : null;
  const [inviting, setInviting] = useState(prefill !== null);
  const [shown, setShown] = useState<{ email: string; code: string } | null>(null);
  const edit = can(me, 'admin', 'edit');
  const roleList = roles.data?.roles ?? [];
  const columns: Column<Member>[] = useMemo(
    () => [
      {
        key: 'name',
        label: t('members.name'),
        width: 'minmax(220px,2fr)',
        sort: (m) => m.name,
        phone: 'title',
        render: (m) => (
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-[13px] font-medium">
              {m.name} {m.id === me.member.id && <span className="text-[var(--hr-muted)]">{t('members.you')}</span>}
            </span>
            <span className="truncate text-[12px] text-[var(--hr-muted)]">{m.email}</span>
          </span>
        ),
      },
      { key: 'role', label: t('members.role'), width: 'minmax(130px,1fr)', sort: (m) => m.role?.name ?? '', render: (m) => m.role?.name ?? '' },
      { key: 'person', label: t('members.col_person'), width: 'minmax(130px,1fr)', hideBelow: 'lg', render: (m) => (m.employee !== null ? <a className="hr-link hr-focus hit rounded-[3px]" href={`#/people/${m.employee.number}`} onClick={(e) => e.stopPropagation()}>{m.employee.name}</a> : '') },
      { key: 'pin', label: t('members.pin'), width: '80px', hideBelow: 'lg', render: (m) => (m.has_pin ? <StatusDot tone="good" label={t('ui.yes')} /> : <StatusDot tone="faint" label={t('ui.no')} />) },
      { key: 'seen', label: t('members.last_seen'), width: '120px', hideBelow: 'xl', sort: (m) => m.last_seen, render: (m) => (m.last_seen !== '' ? ago(m.last_seen) : '') },
      { key: 'status', label: t('people.col.status'), width: '110px', phone: 'end', sort: (m) => m.status, render: (m) => <StatusDot tone={m.status === 'active' ? 'good' : m.status === 'invited' ? 'warn' : 'faint'} label={t(`members.status.${m.status}`)} /> },
      ...(edit ? [{ key: 'actions', label: '', width: '44px', align: 'right' as const, phone: 'hide' as const, render: (m: Member) => <span onClick={(e) => e.stopPropagation()}><MemberActions m={m} roles={roleList} onCode={(email, code) => setShown({ email, code })} /></span> }] : []),
    ],
    [me.member.id, edit, roleList],
  );
  return (
    <Panel
      label={t('settings.members')}
      aside={
        edit ? (
          <Button size="sm" variant="primary" icon={Plus} onClick={() => setInviting(true)}>
            {t('members.invite')}
          </Button>
        ) : undefined
      }
      flush
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--hr-line)] px-3.5 py-2">
        <SearchInput value={q} onChange={setQ} className="w-full sm:w-[240px]" placeholder={t('members.search')} />
        <Segmented value={status} onChange={setStatus} label={t('people.col.status')} size="sm" options={(['all', 'active', 'invited', 'disabled'] as const).map((s) => ({ value: s, label: t(`members.f.${s}`) }))} />
      </div>
      {live.data === null ? (
        <Loading />
      ) : (
        <DataTable label={t('settings.members')} columns={columns} rows={live.data.members} rowKey={(m) => m.id} empty={<Empty icon={Users} title={t('members.none')} action={edit ? <Button variant="primary" icon={Plus} onClick={() => setInviting(true)}>{t('members.invite')}</Button> : undefined} />} />
      )}
      <InviteDialog
        open={inviting}
        prefill={prefill}
        onClose={() => {
          setInviting(false);
          if (prefill !== null) setQuery({ invite: undefined, name: undefined, email: undefined, employee: undefined });
        }}
        roles={roleList}
      />
      {shown !== null && <CodeShown email={shown.email} code={shown.code} onClose={() => setShown(null)} />}
    </Panel>
  );
}

/* ------------------------------------------------------------------ roles */

const LEVELS: Level[] = ['none', 'view', 'edit', 'full'];

function LevelCell({ value, onPick, disabled }: { value: Level; onPick: (l: Level) => void; disabled: boolean }): React.JSX.Element {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const n = LEVELS.indexOf(value);
  return (
    <>
      <button ref={ref} type="button" disabled={disabled} onClick={() => setOpen(true)} aria-label={t(`roles.level.${value}`)} className="hr-focus hr-tap flex h-8 w-full items-center gap-2 rounded-[var(--hr-radius-sm)] px-2 text-left transition-colors hover:bg-[var(--hr-hover)] disabled:cursor-default disabled:hover:bg-transparent">
        <span className="inline-flex items-center gap-[3px]">
          {[1, 2, 3].map((i) => (
            <span key={i} className={cn('size-1.5 rounded-full', i <= n ? 'bg-[var(--hr-ink)]' : 'bg-[var(--hr-line-2)]')} />
          ))}
        </span>
        <span className={cn('text-[12px]', n === 0 ? 'text-[var(--hr-muted)]' : 'text-[var(--hr-ink)]')}>{t(`roles.level.${value}`)}</span>
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} width={150} label={t('roles.level')}>
        {LEVELS.map((l) => (
          <MenuItem key={l} selected={l === value} onClick={() => (onPick(l), setOpen(false))}>
            {t(`roles.level.${l}`)}
          </MenuItem>
        ))}
      </Popover>
    </>
  );
}

function AddRole({ open, onClose, roles }: { open: boolean; onClose: () => void; roles: Role[] }): React.JSX.Element | null {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [from, setFrom] = useState('employee');
  const [team, setTeam] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setName('');
      setCode('');
      setFrom('employee');
      setTeam(false);
      setError(null);
    }
  }, [open]);
  if (!open) return null;
  const autoCode = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'r_$1').slice(0, 40);
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const base = roles.find((r) => r.code === from);
    try {
      await op('roles.add', { name: name.trim(), code: code !== '' ? code : autoCode, levels: base?.levels ?? {}, team_scope: team }, { quiet: true, pin: { title: t('roles.add') } });
      changed('roles');
      onClose();
    } catch (e) {
      if ((e as { code?: string }).code !== 'aborted') setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('roles.add')}
      width={460}
      footer={
        <>
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          <Button variant="primary" busy={busy} disabled={name.trim() === '' || (code === '' && autoCode.length < 2)} onClick={() => void save()}>
            {t('ui.add')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('roles.name')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder={t('roles.name_ph')} aria-label={t('roles.name')} />
        </Field>
        <Field label={t('org.f.code')} optional>
          <Input value={code} onChange={(e) => setCode(e.target.value.toLowerCase())} placeholder={autoCode} className="hr-mono" aria-label={t('org.f.code')} />
        </Field>
        <Field label={t('roles.start_from')}>
          <Picker value={from} onChange={setFrom} items={roles.map((r) => ({ value: r.code, label: r.name }))} label={t('roles.start_from')} />
        </Field>
        <div className="flex items-center justify-between rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)] px-3 py-2">
          <span className="text-[13px]">{t('roles.team_scope')}</span>
          <Toggle checked={team} onChange={setTeam} label={t('roles.team_scope')} />
        </div>
        {error !== null && <Notice tone="bad">{error}</Notice>}
      </div>
    </Dialog>
  );
}

export function RolesSection(): React.JSX.Element {
  const me = useMe();
  const live = useOp<{ roles: Role[]; modules: { key: Module; label: string }[]; levels: Level[] }>('roles.list', {}, READS, { name: 'settings.roles.grid' });
  const [draft, setDraft] = useState<Record<string, Partial<Record<Module, Level>>>>({});
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const edit = can(me, 'admin', 'full');
  if (live.data === null) return <Loading />;
  const { roles, modules } = live.data;
  const dirty = Object.keys(draft).filter((id) => Object.keys(draft[id] ?? {}).length > 0);
  const level = (r: Role, m: Module): Level => draft[r.id]?.[m] ?? r.levels[m] ?? 'none';
  const save = async (): Promise<void> => {
    const pin = await askPin({ title: t('roles.save'), text: t('roles.save_text', { n: dirty.length }) });
    if (pin === null) return;
    setBusy(true);
    try {
      for (const id of dirty) {
        const r = roles.find((x) => x.id === id);
        if (r === undefined) continue;
        await op('roles.update', { role: r.id, levels: { ...r.levels, ...draft[id] }, pin });
      }
      setDraft({});
      changed('roles');
      void refreshMe();
      toast.success(t('ui.saved'));
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  const removeRole = async (r: Role): Promise<void> => {
    if (!(await confirmAsk(t('roles.delete_text', { name: r.name }), t('roles.delete'), t('ui.remove')))) return;
    try {
      await op('roles.delete', { role: r.id }, { pin: { title: t('roles.delete') } });
      changed('roles');
    } catch {
      /* toast shown */
    }
  };
  return (
    <Panel
      label={t('settings.roles')}
      aside={
        <span className="flex items-center gap-2">
          {dirty.length > 0 && (
            <>
              <Button size="sm" variant="ghost" onClick={() => setDraft({})}>
                {t('ui.cancel')}
              </Button>
              <Button size="sm" variant="primary" icon={ShieldCheck} busy={busy} onClick={() => void save()}>
                {tn('roles.save_n', dirty.length)}
              </Button>
            </>
          )}
          {edit && dirty.length === 0 && (
            <Button size="sm" icon={Plus} onClick={() => setAdding(true)}>
              {t('roles.add')}
            </Button>
          )}
        </span>
      }
      flush
    >
      <div className="hr-scroll overflow-x-auto px-1.5 pb-1.5">
        <table className="w-full min-w-[720px] border-collapse">
          <thead>
            <tr>
              <th className="hr-label sticky left-0 z-[1] w-[140px] bg-[var(--hr-panel)] px-2 py-2 text-left">{t('roles.module')}</th>
              {roles.map((r) => (
                <th key={r.id} className="px-1 py-2 text-left align-bottom">
                  <span className="flex items-center gap-1">
                    <span className="truncate text-[13px] font-semibold">{r.name}</span>
                    {!r.system && edit && (
                      <button type="button" onClick={() => void removeRole(r)} aria-label={t('roles.delete')} title={t('roles.delete')} className="hr-focus hit rounded-[3px] text-[var(--hr-muted)] hover:text-[var(--hr-bad)]">
                        <Trash2 size={12} aria-hidden />
                      </button>
                    )}
                  </span>
                  <span className="hr-label block">{tn('people.n_people', r.members)}</span>
                  {r.team_scope && <Tag className="mt-1">{t('roles.team')}</Tag>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {modules
              .filter((m) => MODULES.includes(m.key))
              .map((m) => (
                <tr key={m.key} className="border-t border-[var(--hr-hair)]">
                  <td className="sticky left-0 z-[1] bg-[var(--hr-panel)] px-2 py-1 text-[13px]">{t(`roles.mod.${m.key}`)}</td>
                  {roles.map((r) => (
                    <td key={r.id} className={cn('px-1 py-0.5', draft[r.id]?.[m.key] !== undefined && 'bg-[var(--hr-rh-soft)]')}>
                      <LevelCell value={level(r, m.key)} disabled={!edit || r.code === 'owner'} onPick={(l) => setDraft((d) => ({ ...d, [r.id]: { ...(d[r.id] ?? {}), [m.key]: l } }))} />
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <AddRole open={adding} onClose={() => setAdding(false)} roles={roles} />
    </Panel>
  );
}
