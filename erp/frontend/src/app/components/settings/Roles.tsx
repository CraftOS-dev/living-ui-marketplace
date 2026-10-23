/**
 * Roles: a level per module (none, view, edit, full), the administration
 * right and an approval limit. The Owner role never changes; only an owner
 * changes the Administrator role. Custom roles can be added and deleted
 * once nobody has them. All roles side by side are one step away.
 */
import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Plus, ShieldCheck, Trash2, Users } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { money } from '../../lib/format.ts';
import { useLive } from '../../lib/live.ts';
import { useMe } from '../../lib/me.ts';
import { refreshMe } from '../../lib/session.ts';
import type { Role, RoleList } from '../../lib/types/settings.ts';
import type { Level, Module } from '../../lib/types.ts';
import { Menu, Segmented } from '../controls.tsx';
import { MoneyInput } from '../pickers.tsx';
import { Card, CardHeader, Field, LoadError, Modal, Notice, PageSkeleton, PillButton, PillSelect, ToggleRow, softArea, softInput, useConfirm } from '../ui.tsx';
import { LEVEL_WORDS, MODULE_INFO, SaveBar, moneyText } from './shared.tsx';

interface Draft {
  name: string;
  description: string;
  admin: boolean;
  limit: string;
  levels: Record<Module, Level>;
}

function draftOf(r: Role, cur: string): Draft {
  return { name: r.name, description: r.description, admin: r.admin, limit: moneyText(r.approval_limit, cur, true), levels: { ...r.levels } };
}

export function RolesSection({ query }: { query: URLSearchParams }): React.JSX.Element {
  const me = useMe();
  const cur = me.company.currency;
  const data = useLive(() => op<RoleList>('roles.list', {}, { quiet: true }), ['roles', 'members'], []);
  const [picked, setPicked] = useState<string>(query.get('role') ?? '');
  const [adding, setAdding] = useState(false);
  const [compare, setCompare] = useState(false);
  const roles = data.data?.roles ?? [];
  const role = roles.find((r) => r.id === picked) ?? roles[0];

  if (data.data === null && data.error !== null) return <LoadError message={data.error} onRetry={data.reload} />;
  if (data.data === null || role === undefined) return <PageSkeleton rows={4} />;
  const modules = data.data.modules;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-5 @min-[1100px]:grid-cols-12">
        <div className="flex items-end gap-2 @min-[1100px]:hidden">
          <PillSelect label="Role" value={role.id} onChange={setPicked} options={roles.map((r) => ({ value: r.id, label: `${r.name} (${r.members === 1 ? '1 person' : `${r.members} people`})` }))} className="min-w-0 flex-1" />
          <PillButton variant="light" icon={Plus} onClick={() => setAdding(true)}>
            Add
          </PillButton>
        </div>
        <Card className="hidden self-start @min-[1100px]:col-span-4 @min-[1100px]:block" delay={1} padded={false}>
          <div className="flex items-center justify-between gap-2 px-5 pb-2 pt-5">
            <h2 className="text-[15px] font-bold">Roles</h2>
            <PillButton size="sm" variant="soft" icon={Plus} onClick={() => setAdding(true)}>
              Add role
            </PillButton>
          </div>
          <ul className="flex flex-col gap-1 p-2 pt-0">
            {roles.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setPicked(r.id)}
                  aria-current={r.id === role.id}
                  className={cn('flex w-full items-center gap-3 rounded-[16px] px-3 py-2.5 text-left transition-colors', r.id === role.id ? 'bg-[var(--erp-row-hover)]' : 'hover:bg-[var(--erp-row)]')}
                >
                  <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-full', r.admin ? 'erp-on-ink bg-[var(--erp-ink)] text-[var(--erp-accent)]' : 'bg-[var(--erp-row)] text-[var(--erp-ink-2)]')}>
                    {r.admin ? <ShieldCheck size={16} aria-hidden /> : <Users size={16} aria-hidden />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold">{r.name}</span>
                    <span className="block truncate text-[12px] text-[var(--erp-muted)]">
                      {r.members === 1 ? '1 person' : `${r.members} people`}
                      {r.system ? ' · Built in' : ' · Custom'}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
        <div className="min-w-0 @min-[1100px]:col-span-8">
          <RoleEditor key={role.id} role={role} modules={modules} cur={cur} isOwner={me.owner} onSaved={() => data.reload()} onDeleted={() => setPicked('')} />
        </div>
      </div>

      <Card delay={3}>
        <CardHeader
          title="All roles side by side"
          subtitle="What each role reaches in each module"
          action={
            <PillButton size="sm" variant="soft" onClick={() => setCompare((c) => !c)}>
              {compare ? 'Hide' : 'Show'}
            </PillButton>
          }
        />
        {compare && <Compare roles={roles} modules={modules} cur={cur} onPick={setPicked} />}
      </Card>

      {adding && (
        <AddRoleModal
          roles={roles}
          onClose={() => setAdding(false)}
          onAdded={(r) => {
            setAdding(false);
            data.reload();
            setPicked(r.id);
          }}
        />
      )}
    </div>
  );
}

function RoleEditor({ role, modules, cur, isOwner, onSaved, onDeleted }: { role: Role; modules: { key: Module; label: string }[]; cur: string; isOwner: boolean; onSaved: () => void; onDeleted: () => void }): React.JSX.Element {
  const [draft, setDraft] = useState<Draft>(() => draftOf(role, cur));
  const [saving, setSaving] = useState(false);
  const [confirmEl, confirm] = useConfirm();
  const base = useMemo(() => draftOf(role, cur), [role, cur]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  const locked = role.key === 'owner';
  const ownerOnly = role.key === 'admin' && !isOwner;
  const ro = locked || ownerOnly;

  useEffect(() => {
    if (!dirty) setDraft(base);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      const p: Record<string, string | boolean | Record<string, unknown>> = { role: role.id };
      if (draft.name.trim() !== base.name) p['name'] = draft.name.trim();
      if (draft.description !== base.description) p['description'] = draft.description;
      if (draft.admin !== base.admin) p['admin'] = draft.admin;
      if (draft.limit !== base.limit) p['approval_limit'] = draft.limit === '' ? '0' : draft.limit;
      if (JSON.stringify(draft.levels) !== JSON.stringify(base.levels)) p['levels'] = draft.levels;
      await op('roles.update', p);
      toast.success(`${draft.name.trim()} saved`);
      onSaved();
      void refreshMe();
    } catch {
      /* shown */
    } finally {
      setSaving(false);
    }
  };
  const remove = async (): Promise<void> => {
    if (!(await confirm(`The role ${role.name} is deleted. Nobody has it now.`, 'Delete this role?'))) return;
    try {
      await op('roles.delete', { role: role.id });
      toast.success('Role deleted');
      onDeleted();
      onSaved();
    } catch {
      /* shown */
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <Card delay={2}>
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {role.system || ro ? (
              <>
                <h2 className="text-[15px] font-bold">{role.name}</h2>
                <p className="mt-0.5 text-[13px] text-[var(--erp-muted)]">{role.description}</p>
              </>
            ) : (
              <div className="grid grid-cols-1 gap-3">
                <Field label="Name">
                  <input className={softInput} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={60} />
                </Field>
                <Field label="What it is for" optional>
                  <textarea className={cn(softArea, 'min-h-[60px]')} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} maxLength={300} />
                </Field>
              </div>
            )}
          </div>
          {!role.system && (
            <Menu
              variant="row"
              size={36}
              items={[{ label: 'Delete role', icon: Trash2, danger: true, onClick: () => void remove(), hint: role.members > 0 ? `${role.members} use it` : undefined }]}
            />
          )}
        </div>
        {locked && <Notice tone="neutral" icon={ShieldCheck}>One active owner always remains.</Notice>}
        {ownerOnly && <Notice tone="neutral" icon={ShieldCheck}>Only an owner changes the Administrator role.</Notice>}

        <div className="mt-4 flex flex-col">
          {modules.map((m) => {
            const info = MODULE_INFO[m.key];
            const Icon = info.icon;
            const lv = draft.levels[m.key];
            return (
              <div key={m.key} className="flex flex-col gap-2 border-b border-[var(--erp-line)] py-3 last:border-b-0 @min-[640px]:flex-row @min-[640px]:items-center @min-[640px]:gap-4">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--erp-row)]">
                    <Icon size={16} aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[14px] font-semibold">{m.label}</span>
                    <span className="block text-[12px] text-[var(--erp-muted)]">{LEVEL_WORDS[lv].text}</span>
                  </span>
                </div>
                {ro ? (
                  <span className="self-start @min-[640px]:self-auto">
                    <LevelPill level={lv} />
                  </span>
                ) : (
                  <Segmented<Level>
                    ariaLabel={`${m.label} access`}
                    value={lv}
                    onChange={(v) => setDraft({ ...draft, levels: { ...draft.levels, [m.key]: v } })}
                    options={(['none', 'view', 'edit', 'full'] as Level[]).map((l) => ({ value: l, label: LEVEL_WORDS[l].label }))}
                    className="w-full @min-[640px]:w-[320px]"
                  />
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <Card delay={3}>
        <CardHeader title="Administration and approvals" />
        <div className="grid grid-cols-1 gap-4 @min-[640px]:grid-cols-2">
          <ToggleRow title="Administrator" text="Members, roles and company settings" checked={draft.admin} disabled={ro} onChange={(v) => setDraft({ ...draft, admin: v })} />
          <Field label="Approves up to" hint={draft.limit === '' || draft.limit === '0' ? 'Empty: approves any amount' : 'Larger amounts need someone with a higher limit'}>
            <MoneyInput value={draft.limit} onChange={(v) => setDraft({ ...draft, limit: v })} currency={cur} ariaLabel="Approval limit" placeholder="No limit" disabled={ro} />
          </Field>
        </div>
      </Card>

      {confirmEl}
      <SaveBar dirty={dirty && !ro} saving={saving} onSave={() => void save()} onDiscard={() => setDraft(base)} note={`Unsaved changes to ${role.name}`} />
    </div>
  );
}

export function LevelPill({ level, small = false }: { level: Level; small?: boolean | undefined }): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold',
        small ? 'h-6 min-w-12 px-2 text-[12px]' : 'h-8 min-w-16 px-3 text-[13px]',
        level === 'none' && 'text-[var(--erp-muted)]',
        level === 'view' && 'bg-[var(--erp-row)] text-[var(--erp-ink-2)]',
        level === 'edit' && 'bg-[var(--erp-row-hover)] font-bold text-[var(--erp-ink)]',
        level === 'full' && 'erp-on-ink bg-[var(--erp-ink)] text-[var(--erp-shell)]',
      )}
    >
      {LEVEL_WORDS[level].label}
    </span>
  );
}

function Compare({ roles, modules, cur, onPick }: { roles: Role[]; modules: { key: Module; label: string }[]; cur: string; onPick: (id: string) => void }): React.JSX.Element {
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[900px] text-[13px]">
        <thead>
          <tr className="text-left text-[12px] font-semibold text-[var(--erp-muted)]">
            <th className="px-2 pb-2 font-semibold">Role</th>
            {modules.map((m) => (
              <th key={m.key} className="px-1 pb-2 text-center font-semibold">
                {m.label}
              </th>
            ))}
            <th className="px-2 pb-2 text-right font-semibold">Approves up to</th>
          </tr>
        </thead>
        <tbody>
          {roles.map((r) => (
            <tr key={r.id} className="border-t border-[var(--erp-line)]">
              <td className="px-2 py-2">
                <button type="button" onClick={() => onPick(r.id)} className="font-semibold hover:underline">
                  {r.name}
                </button>
                {r.admin && <span className="ml-1.5 text-[12px] text-[var(--erp-muted)]">Admin</span>}
              </td>
              {modules.map((m) => (
                <td key={m.key} className="px-1 py-2 text-center">
                  <LevelPill level={r.levels[m.key]} small />
                </td>
              ))}
              <td className="num px-2 py-2 text-right">{r.approval_limit > 0 ? money(r.approval_limit, cur) : 'No limit'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AddRoleModal({ roles, onClose, onAdded }: { roles: Role[]; onClose: () => void; onAdded: (r: Role) => void }): React.JSX.Element {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [from, setFrom] = useState(roles.find((r) => r.key === 'viewer')?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const src = roles.find((r) => r.id === from);
    try {
      const r = await op<Role>('roles.add', { name: name.trim(), description: description.trim(), ...(src !== undefined ? { levels: src.levels } : {}) }, { quiet: true });
      toast.success(`${r.name} added`);
      onAdded(r);
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
      title="Add a role"
      footer={
        <>
          <PillButton variant="soft" onClick={onClose}>
            Cancel
          </PillButton>
          <PillButton icon={Check} dot loading={busy} disabled={name.trim() === ''} onClick={() => void add()}>
            Add role
          </PillButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error !== null && <Notice tone="bad">{error}</Notice>}
        <Field label="Name">
          <input className={softInput} value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={60} placeholder="Supervisor" />
        </Field>
        <Field label="What it is for" optional>
          <input className={softInput} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />
        </Field>
        <PillSelect label="Start from" soft value={from} onChange={setFrom} options={[{ value: '', label: 'Nothing (no access)' }, ...roles.filter((r) => r.key !== 'owner').map((r) => ({ value: r.id, label: r.name }))]} />
        <p className="flex items-center gap-2 px-1 text-[12px] text-[var(--erp-muted)]">
          <Copy size={13} aria-hidden /> Its levels are copied; change them after.
        </p>
      </div>
    </Modal>
  );
}
