/**
 * Settings, People and access: who can sign in and what each role may do.
 * Admins change roles (never leaving the organization without an admin);
 * everyone else reads.
 */
import { useState } from 'react';
import { Select, Tooltip, toast, useConfirm } from '../../kit/index.ts';
import { updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { ROLE_HELP, ROLE_LABEL } from '../lib/labels.ts';
import type { Role, UserRec } from '../lib/types.ts';
import { IdentityChip, Pill, Section } from './ui.tsx';
import { ReadOnlyNote } from './adminShared.tsx';

const ROLES: Role[] = ['admin', 'manager', 'counsel', 'contributor', 'inventor', 'viewer'];

function isRole(v: string): v is Role {
  return (ROLES as string[]).includes(v);
}

export function AccessTab(): React.JSX.Element {
  const { users, me, can } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmEl, confirm] = useConfirm();
  const admins = users.filter((u) => u.role === 'admin');

  const change = async (u: UserRec, role: Role): Promise<void> => {
    if (role === u.role) return;
    if (u.id === me?.id && u.role === 'admin') {
      const ok = await confirm(`You will become ${ROLE_LABEL[role]} and lose admin access, including this page's controls. Another admin can give it back.`, 'Change your own role?');
      if (!ok) return;
    }
    setBusy(u.id);
    try {
      await updateRecord('users', u.id, { role });
      toast.success(`${u.name || u.email} is now ${ROLE_LABEL[role]}`);
    } catch {
      /* the client already showed the server's message */
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {confirmEl}
      {!can.admin && <ReadOnlyNote>Only admins can change roles. Ask an admin if you need more access.</ReadOnlyNote>}

      <Section title="People who can sign in" meta={String(users.length)} flush>
        <div>
          {users.map((u) => {
            const lastAdmin = u.role === 'admin' && admins.length === 1;
            const select = (
              <Select
                aria-label={`Role for ${u.name || u.email}`}
                value={u.role}
                disabled={!can.admin || lastAdmin || busy === u.id}
                options={ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
                onChange={(e) => {
                  const v = e.target.value;
                  if (isRole(v)) void change(u, v);
                }}
              />
            );
            return (
              <div key={u.id} className="flex flex-wrap items-center gap-3 border-b border-[var(--agent-app-border)]/70 px-4 py-2.5 last:border-0">
                <IdentityChip name={u.name || u.email} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <span className="truncate">{u.name || u.email}</span>
                    {u.id === me?.id && <Pill tone="accent">You</Pill>}
                  </div>
                  <div className="truncate text-xs text-[var(--agent-app-muted)]">
                    {u.email}
                    {u.job_title !== '' ? ` · ${u.job_title}` : ''}
                  </div>
                </div>
                <div className="w-full sm:w-44">
                  {can.admin && lastAdmin ? (
                    <Tooltip content="The only admin. Make someone else an admin first.">
                      <div className="w-full sm:w-44">{select}</div>
                    </Tooltip>
                  ) : (
                    select
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="What each role can do">
        <dl className="flex flex-col gap-3">
          {ROLES.map((r) => (
            <div key={r} className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3">
              <dt className="text-[13px] font-medium">{ROLE_LABEL[r]}</dt>
              <dd className="text-[13px] leading-relaxed text-[var(--agent-app-muted)]">{ROLE_HELP[r]}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </div>
  );
}
