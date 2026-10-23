/**
 * The team: who works here, their role and PIN; the time clock (hours per
 * person, corrections with who made them); and what each role may do,
 * including the discount limit and what your AI agent may do. Only an
 * owner changes permissions or owners.
 */
import { useEffect, useMemo, useState } from 'react';
import { Check, Clock, Pencil, Plus, ShieldCheck, UserPlus, Users } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api } from '../lib/api.ts';
import { useStore } from '../lib/context.tsx';
import { duration, toDate, when } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { replaceQuery } from '../lib/router.ts';
import { useSession } from '../lib/session.tsx';
import type { PermKey, Permissions, Role, Staff, TimeEntry } from '../lib/types.ts';
import { Avatar, DateRange, SlotPicker, presetRange } from '../components/common.tsx';
import type { Range } from '../components/common.tsx';
import { DeleteButton } from '../components/DeleteButton.tsx';
import { Badge, Button, Empty, Field, IconButton, Modal, PageHeader, Panel, Select, Tabs, Toggle, inputCls } from '../components/ui.tsx';

const ROLES: Record<Role, string> = { owner: 'Owner', manager: 'Manager', cashier: 'Cashier', agent: 'Your AI agent' };

function StaffForm({ member, open, onClose }: { member: Staff | null; open: boolean; onClose: () => void }): React.JSX.Element {
  const { staff: me } = useSession();
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('cashier');
  const [pin, setPin] = useState('');
  const [color, setColor] = useState('neutral');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName(member?.name ?? '');
    setRole(member?.role ?? 'cashier');
    setPin('');
    setColor(member?.color ?? 'blue');
    setEmail(member?.email ?? '');
    setPhone(member?.phone ?? '');
    setActive(member?.active ?? true);
  }, [open, member]);
  const pinOk = pin === '' ? member !== null : /^\d{4,8}$/.test(pin);
  const ok = name.trim() !== '' && pinOk;
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.saveStaff({ id: member?.id, name: name.trim(), role, pin: pin !== '' ? pin : undefined, color, email: email.trim(), phone: phone.trim(), active });
      toast.success('Saved ' + name.trim());
      onClose();
    } catch {
      // Shown by the transport.
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={member === null ? 'New team member' : 'Edit ' + member.name}
      wide
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={Check} loading={busy} disabled={!ok} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) void save();
        }}
      >
        <Field label="Name">
          <input autoFocus className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </Field>
        <Field label="Role">
          <Select
            ariaLabel="Role"
            value={role}
            onChange={(r) => setRole(r as Role)}
            options={[
              { value: 'cashier', label: 'Cashier' },
              { value: 'manager', label: 'Manager' },
              ...(me?.role === 'owner' || member?.role === 'owner' ? [{ value: 'owner', label: 'Owner' }] : []),
            ]}
          />
        </Field>
        <Field label={member === null ? 'PIN' : 'New PIN'} hint={member === null ? '4 to 8 digits, different from everyone else' : 'Empty keeps the current PIN'} error={pin !== '' && !/^\d{4,8}$/.test(pin) ? '4 to 8 digits' : null}>
          <input className={inputCls + ' num tracking-[0.3em]'} type="password" inputMode="numeric" autoComplete="new-password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} />
        </Field>
        <Field group label="Color">
          <SlotPicker value={color} onChange={setColor} />
        </Field>
        <Field label="Email">
          <input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} inputMode="email" />
        </Field>
        <Field label="Phone">
          <input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={60} inputMode="tel" />
        </Field>
        {member !== null && (
          <label className="flex items-center justify-between gap-3 rounded-[var(--ps-r)] bg-[var(--ps-row)] px-3 py-2 sm:col-span-2">
            <span>
              <span className="block text-[13px] font-semibold">Can sign in</span>
              <span className="block text-[12px] text-[var(--ps-muted)]">Off for someone who left; their sales keep their name.</span>
            </span>
            <Toggle checked={active} onChange={setActive} label="Can sign in" />
          </label>
        )}
      </form>
    </Modal>
  );
}

function StaffList(): React.JSX.Element {
  const list = useLive(() => api.staff(), ['staff', 'timeclock'], []);
  const [edit, setEdit] = useState<Staff | 'new' | null>(null);
  const rows = list.data?.staff ?? [];
  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button variant="primary" icon={UserPlus} onClick={() => setEdit('new')}>
          New team member
        </Button>
      </div>
      <Panel padded={false}>
        {rows.length === 0 ? (
          <Empty icon={Users} title="No team yet" compact />
        ) : (
          <ul className="divide-y divide-[var(--ps-hair)]">
            {rows.map((m) => (
              <li key={m.id} className={cn('flex items-center gap-3 px-3 py-2.5', !m.active && 'bg-[var(--ps-row)]')}>
                <Avatar name={m.name} color={m.color} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-semibold">{m.name}</span>
                    <Badge tone={m.role === 'owner' ? 'info' : 'neutral'}>{ROLES[m.role]}</Badge>
                    {!m.active && <Badge tone="bad">Cannot sign in</Badge>}
                    {m.clocked_in !== null && <Badge tone="good">Clocked in {when(m.clocked_in)}</Badge>}
                  </span>
                  <span className="block truncate text-[12px] text-[var(--ps-muted)]">{[m.email ?? '', m.phone ?? '', m.last_signed_in !== undefined && m.last_signed_in !== '' ? 'signed in ' + when(m.last_signed_in) : 'never signed in'].filter((x) => x !== '').join(' · ')}</span>
                </span>
                <IconButton icon={Pencil} label={'Edit ' + m.name} onClick={() => setEdit(m)} />
                <DeleteButton collection="staff" id={m.id} name={m.name} />
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <StaffForm member={edit === 'new' ? null : edit} open={edit !== null} onClose={() => setEdit(null)} />
    </>
  );
}

/** A date-time for a datetime-local field (local time). */
function localInput(s: string): string {
  const d = toDate(s);
  if (d === null) return '';
  const p = (n: number): string => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function EntryForm({ entry, staff, open, onClose }: { entry: TimeEntry | null; staff: Staff[]; open: boolean; onClose: () => void }): React.JSX.Element {
  const [who, setWho] = useState('');
  const [inAt, setIn] = useState('');
  const [outAt, setOut] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setWho(entry?.staff.id ?? staff[0]?.id ?? '');
    setIn(entry !== null ? localInput(entry.clock_in) : '');
    setOut(entry !== null ? localInput(entry.clock_out) : '');
    setNote(entry?.note ?? '');
  }, [open, entry, staff]);
  const a = inAt === '' ? null : new Date(inAt);
  const b = outAt === '' ? null : new Date(outAt);
  const ok = who !== '' && a !== null && (b === null || b > a);
  const save = async (): Promise<void> => {
    if (a === null) return;
    setBusy(true);
    try {
      await api.saveTime({ id: entry?.id, staff: entry === null ? who : undefined, clock_in: a.toISOString(), clock_out: b === null ? '' : b.toISOString(), note: note.trim() });
      toast.success('Time entry saved');
      onClose();
    } catch {
      // Shown by the transport.
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={entry === null ? 'Add a time entry' : 'Correct ' + entry.staff.name + "'s entry"}
      description="The correction is recorded with your name."
      footer={
        <>
          {entry !== null && <DeleteButton collection="timeclock" id={entry.id} name="this time entry" variant="button" onDeleted={onClose} className="mr-auto" />}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={Check} loading={busy} disabled={!ok} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {entry === null && (
          <div className="sm:col-span-2">
            <Field label="Who">
              <Select ariaLabel="Who" value={who} onChange={setWho} options={staff.map((s) => ({ value: s.id, label: s.name }))} />
            </Field>
          </div>
        )}
        <Field label="Clocked in">
          <input type="datetime-local" className={inputCls} value={inAt} onChange={(e) => setIn(e.target.value)} />
        </Field>
        <Field label="Clocked out" hint="Empty while still working" error={b !== null && a !== null && b <= a ? 'After clocking in' : null}>
          <input type="datetime-local" className={inputCls} value={outAt} onChange={(e) => setOut(e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Note">
            <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} maxLength={400} placeholder="Forgot to clock out" />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function TimeClock(): React.JSX.Element {
  const [range, setRange] = useState<Range>(presetRange('7d'));
  const [who, setWho] = useState('');
  const [edit, setEdit] = useState<TimeEntry | 'new' | null>(null);
  const team = useLive(() => api.staff(), ['staff'], []);
  const list = useLive(() => api.timeclock({ staff: who || undefined, from: range.from, to: range.to }), ['timeclock'], [range.from, range.to, who]);
  const entries = list.data?.entries ?? [];
  const totals = list.data?.totals ?? [];
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <DateRange value={range} onChange={setRange} />
        <Select ariaLabel="Who" value={who} onChange={setWho} className="w-44" options={[{ value: '', label: 'Everyone' }, ...(team.data?.staff ?? []).map((s) => ({ value: s.id, label: s.name }))]} />
        <span className="flex-1" />
        <Button icon={Plus} onClick={() => setEdit('new')}>
          Add an entry
        </Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <Panel padded={false}>
          {entries.length === 0 ? (
            <Empty icon={Clock} title="No time entries in these days" compact>
              People clock in and out from the lock screen with their PIN.
            </Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="ps-table">
                <thead>
                  <tr>
                    <th>Who</th>
                    <th>In</th>
                    <th>Out</th>
                    <th className="text-right">Hours</th>
                    <th className="hidden md:table-cell">Note</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id}>
                      <td className="font-semibold">{e.staff.name}</td>
                      <td className="whitespace-nowrap text-[var(--ps-ink-2)]">{when(e.clock_in)}</td>
                      <td className="whitespace-nowrap text-[var(--ps-ink-2)]">{e.open ? <Badge tone="good">Working</Badge> : when(e.clock_out)}</td>
                      <td className="num text-right">{duration(e.minutes)}</td>
                      <td className="hidden max-w-[220px] truncate text-[var(--ps-ink-2)] md:table-cell">
                        {e.note}
                        {e.edited_by !== null && <span className="text-[var(--ps-muted)]"> (corrected by {e.edited_by})</span>}
                      </td>
                      <td>
                        <IconButton icon={Pencil} label="Correct this entry" onClick={() => setEdit(e)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <Panel title="Hours">
          {totals.length === 0 ? (
            <p className="text-center text-[12px] text-[var(--ps-muted)]">None</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {totals.map((t) => (
                <li key={t.staff.id} className="flex items-baseline justify-between gap-2 text-[13px]">
                  <span className="truncate font-semibold">{t.staff.name}</span>
                  <span className="num shrink-0">
                    {duration(t.minutes)} <span className="text-[12px] text-[var(--ps-muted)]">({t.entries})</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      <EntryForm entry={edit === 'new' ? null : edit} staff={(team.data?.staff ?? []).filter((s) => s.active)} open={edit !== null} onClose={() => setEdit(null)} />
    </>
  );
}

function PermissionsMatrix(): React.JSX.Element {
  const { settings } = useStore();
  const { staff } = useSession();
  const owner = staff?.role === 'owner';
  const cat = settings?.permissions ?? null;
  const [draft, setDraft] = useState<Record<string, Permissions> | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (cat !== null) setDraft(JSON.parse(JSON.stringify(cat.matrix)) as Record<string, Permissions>);
  }, [cat]);
  const roles: Role[] = ['owner', 'manager', 'cashier', 'agent'];
  const dirty = useMemo(() => cat !== null && draft !== null && JSON.stringify(cat.matrix) !== JSON.stringify(draft), [cat, draft]);
  if (cat === null || draft === null) return <div className="py-10" />;
  const set = (role: Role, key: PermKey | 'max_discount', value: boolean | number): void => {
    setDraft({ ...draft, [role]: { ...draft[role], [key]: value } as Permissions });
  };
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      const out: Record<string, Partial<Permissions>> = {};
      for (const r of ['manager', 'cashier', 'agent'] as Role[]) out[r] = draft[r] ?? {};
      await api.savePermissions(out);
      toast.success('Permissions saved');
    } catch {
      // Shown by the transport.
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[12px] text-[var(--ps-muted)]">{owner ? 'Someone without a permission can still do it once with the PIN of someone who has it.' : 'Only an owner can change permissions.'}</p>
        {owner && (
          <span className="flex gap-2">
            <Button disabled={!dirty} onClick={() => setDraft(JSON.parse(JSON.stringify(cat.matrix)) as Record<string, Permissions>)}>
              Undo changes
            </Button>
            <Button variant="primary" icon={ShieldCheck} loading={busy} disabled={!dirty} onClick={() => void save()}>
              Save
            </Button>
          </span>
        )}
      </div>
      <Panel padded={false}>
        <div className="overflow-x-auto">
          <table className="ps-table">
            <thead>
              <tr>
                <th>What</th>
                {roles.map((r) => (
                  <th key={r} className="text-center">
                    {ROLES[r]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cat.permissions.map((p) => (
                <tr key={p.key}>
                  <td>{p.label}</td>
                  {roles.map((r) => (
                    <td key={r} className="text-center">
                      <span className="inline-flex">
                        <Toggle checked={draft[r]?.[p.key] === true} disabled={!owner || r === 'owner'} onChange={(v) => set(r, p.key, v)} label={ROLES[r] + ': ' + p.label} />
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <td className="font-semibold">Largest discount without approval</td>
                {roles.map((r) => (
                  <td key={r} className="text-center">
                    {r === 'owner' ? (
                      <span className="num text-[13px]">100%</span>
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <input className={inputCls + ' num w-16 text-right'} inputMode="numeric" disabled={!owner} value={String(draft[r]?.max_discount ?? 0)} onChange={(e) => set(r, 'max_discount', Math.min(100, Number(e.target.value.replace(/\D/g, '') || '0')))} aria-label={ROLES[r] + ' largest discount'} />%
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

export function TeamPage({ query }: { query: URLSearchParams }): React.JSX.Element {
  const [tab, setTab] = useState<'staff' | 'time' | 'permissions'>((query.get('tab') as 'staff' | 'time' | 'permissions' | null) ?? 'staff');
  return (
    <div>
      <PageHeader title="Team" subtitle="People, hours and what each role may do" />
      <Tabs
        label="Team"
        value={tab}
        onChange={(t) => {
          setTab(t);
          replaceQuery('team', { tab: t === 'staff' ? '' : t });
        }}
        className="mb-3 px-0"
        options={[
          { value: 'staff', label: 'People' },
          { value: 'time', label: 'Time clock' },
          { value: 'permissions', label: 'Permissions' },
        ]}
      />
      {tab === 'staff' ? <StaffList /> : tab === 'time' ? <TimeClock /> : <PermissionsMatrix />}
    </div>
  );
}
