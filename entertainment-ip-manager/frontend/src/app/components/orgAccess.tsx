/**
 * Settings, People and roles (admin): everyone who can sign in, their role
 * and job title, inviting a person (an account with a temporary password),
 * and what each role may do. Nobody changes their own role. External
 * accounts (licensees, committee members, outside reviewers) see nothing
 * until an admin links them to their company in People and companies.
 */
import { useMemo, useState } from 'react';
import { Link2, Pencil, UserPlus } from 'lucide-react';
import { Button, Dialog, Input, Select, toast } from '../../kit/index.ts';
import { createRecord, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { useCollection } from '../lib/live.ts';
import { t } from '../lib/i18n.ts';
import { roleHelp } from '../lib/labels.ts';
import { href } from '../lib/router.ts';
import type { PartyRec, UserRec } from '../lib/records.ts';
import type { Role } from '../lib/shapes.ts';
import { EXTERNAL_ROLES } from '../lib/shapes.ts';
import { Field, IdentityChip, Notice, Pill, Section, Tag, TONE_TEXT } from './ui.tsx';
import { DeleteButton } from './deleteRecord.tsx';
import { DialogBody, EXTERNAL_ROLE_LIST, INTERNAL_ROLES, ReadOnlyNote, roleLabel } from './orgShared.tsx';

const ALL_ROLES: Role[] = [...INTERNAL_ROLES, ...EXTERNAL_ROLE_LIST];

function isRole(v: string): v is Role {
  return (ALL_ROLES as string[]).includes(v);
}

function roleOptions(): { value: string; label: string }[] {
  return [
    ...INTERNAL_ROLES.map((r) => ({ value: r, label: roleLabel(r) })),
    ...EXTERNAL_ROLE_LIST.map((r) => ({ value: r, label: t('{role} (external)', { role: roleLabel(r) }) })),
  ];
}

export function AccessTab(): React.JSX.Element {
  const { users, me, can } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<UserRec | null>(null);
  const linked = useCollection<PartyRec>('parties', can.admin ? { filter: 'portal_users:length > 0', sort: 'name' } : { filter: 'id = "__none__"' });

  const companiesOf = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const p of linked.records) for (const u of p.portal_users) m.set(u, [...(m.get(u) ?? []), p.name]);
    return m;
  }, [linked.records]);

  const internal = users.filter((u) => !EXTERNAL_ROLES.includes(u.role as Role));
  const external = users.filter((u) => EXTERNAL_ROLES.includes(u.role as Role));

  const change = async (u: UserRec, role: Role): Promise<void> => {
    if (role === u.role) return;
    setBusy(u.id);
    try {
      await updateRecord('users', u.id, { role });
      toast.success(t('{name} is now {role}', { name: u.name || u.email, role: roleLabel(role) }));
    } catch {
      /* the client already showed the server's message */
    } finally {
      setBusy(null);
    }
  };

  const row = (u: UserRec): React.JSX.Element => {
    const mine = u.id === me?.id;
    const companies = companiesOf.get(u.id) ?? [];
    const isExternal = EXTERNAL_ROLES.includes(u.role as Role);
    return (
      <div key={u.id} className="flex flex-wrap items-center gap-3 border-b border-[var(--agent-app-border)]/70 px-4 py-2.5 last:border-0">
        <IdentityChip name={u.name || u.email} />
        <div className="min-w-0 flex-1 basis-48">
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <span className="min-w-0 truncate">{u.name || u.email}</span>
            {mine && <Pill tone="accent">{t('You')}</Pill>}
          </div>
          <div className="truncate text-xs text-[var(--agent-app-muted)]">
            {u.email}
            {u.job_title !== '' ? ` · ${u.job_title}` : ''}
          </div>
          {isExternal && (
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {companies.length > 0 ? (
                companies.map((c) => <Tag key={c}>{c}</Tag>)
              ) : (
                <a href={href('people')} className={`inline-flex items-center gap-1 text-xs hover:underline ${TONE_TEXT.warn}`}>
                  <Link2 size={11} aria-hidden /> {t('Not linked to a company yet: this account sees nothing')}
                </a>
              )}
            </div>
          )}
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <div className="min-w-0 flex-1 sm:w-48 sm:flex-none">
            <Select
              aria-label={t('Role for {name}', { name: u.name || u.email })}
              title={mine ? t('Nobody can change their own role. Ask another administrator.') : undefined}
              value={u.role}
              disabled={!can.admin || mine || busy === u.id}
              options={roleOptions()}
              onChange={(e) => {
                const v = e.target.value;
                if (isRole(v)) void change(u, v);
              }}
            />
          </div>
          {can.admin && (
            <Button size="sm" variant="ghost" className="h-8 px-2" aria-label={t('Edit {name}', { name: u.name || u.email })} onClick={() => setEditing(u)}>
              <Pencil size={13} aria-hidden />
            </Button>
          )}
          {!mine && (
            <DeleteButton
              collection="users"
              id={u.id}
              iconOnly
              className="size-8"
              label={t('Remove {name}', { name: u.name || u.email })}
              note={t('The account can no longer sign in. Records this person created or is assigned to stay.')}
            />
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {!can.admin && <ReadOnlyNote>{t('Only administrators can change roles or invite people.')}</ReadOnlyNote>}

      <Section
        title={t('Our team')}
        meta={String(internal.length)}
        flush
        actions={
          can.admin ? (
            <Button size="sm" onClick={() => setInviting(true)}>
              <UserPlus size={13} aria-hidden /> {t('Invite a person')}
            </Button>
          ) : undefined
        }
      >
        <div>{internal.map(row)}</div>
      </Section>

      <Section title={t('Outside accounts')} meta={String(external.length)} flush>
        <div className="border-b border-[var(--agent-app-border)] p-3">
          <Notice tone="info" icon={Link2}>
            {t('Licensees, committee members and outside reviewers only see their portal. They see records only after an administrator links their account to their company in People and companies (Portal access).')}
          </Notice>
        </div>
        {external.length === 0 ? (
          <p className="px-4 py-6 text-center text-[13px] text-[var(--agent-app-muted)]">{t('No outside accounts yet. Invite a licensee, committee member or reviewer with the button above.')}</p>
        ) : (
          <div>{external.map(row)}</div>
        )}
      </Section>

      <Section title={t('What each role can do')}>
        <dl className="flex flex-col gap-3">
          {ALL_ROLES.map((r) => (
            <div key={r} className="grid gap-1 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-3">
              <dt className="text-[13px] font-medium">{roleLabel(r)}</dt>
              <dd className="text-[13px] leading-relaxed text-[var(--agent-app-muted)]">{roleHelp(r)}</dd>
            </div>
          ))}
        </dl>
      </Section>

      {inviting && <InviteDialog onClose={() => setInviting(false)} />}
      {editing !== null && <EditUserDialog user={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function InviteDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { settings } = useApp();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('contributor');
  const [lang, setLang] = useState<'ja' | 'en'>(settings?.default_language === 'en' ? 'en' : 'ja');
  const [busy, setBusy] = useState(false);
  const external = EXTERNAL_ROLES.includes(role);
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const ok = name.trim() !== '' && emailOk && password.length >= 8;

  const submit = async (): Promise<void> => {
    if (!ok) return;
    setBusy(true);
    try {
      await createRecord('users', { email: email.trim(), password, passwordConfirm: password, name: name.trim(), role, ui_language: lang });
      toast.success(t('{name} can now sign in. Send them the email address and temporary password.', { name: name.trim() }));
      onClose();
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
      title={t('Invite a person')}
      description={t('Creates an account with a temporary password. Share it with the person directly; they can change their name and language in My account.')}
      className="w-[min(94vw,36rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button loading={busy} disabled={!ok} onClick={() => void submit()}>
            {t('Create account')}
          </Button>
        </>
      }
    >
      <DialogBody>
        <Input label={t('Name|person')} value={name} onChange={(e) => setName(e.target.value)} />
        <Input label={t('Email|field')} type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field label={t('Temporary password')} help={t('At least 8 characters.')}>
          <Input aria-label={t('Temporary password')} type="text" autoComplete="new-password" spellCheck={false} className="font-mono" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label={t('Role')} help={roleHelp(role)}>
          <Select
            aria-label={t('Role')}
            value={role}
            options={roleOptions()}
            onChange={(e) => {
              const v = e.target.value;
              if (isRole(v)) setRole(v);
            }}
          />
        </Field>
        <Select
          label={t('Language')}
          value={lang}
          options={[
            { value: 'ja', label: '日本語' },
            { value: 'en', label: 'English' },
          ]}
          onChange={(e) => setLang(e.target.value === 'en' ? 'en' : 'ja')}
        />
        {external && (
          <Notice tone="warn" icon={Link2}>
            {t('External accounts must be linked to their company in People and companies (open the company, then Portal access). Until then the account sees nothing.')}
          </Notice>
        )}
      </DialogBody>
    </Dialog>
  );
}

function EditUserDialog({ user, onClose }: { user: UserRec; onClose: () => void }): React.JSX.Element {
  const [name, setName] = useState(user.name);
  const [job, setJob] = useState(user.job_title);
  const [busy, setBusy] = useState(false);
  const save = async (): Promise<void> => {
    if (name.trim() === '') {
      toast.error(t('Enter a name.'));
      return;
    }
    setBusy(true);
    try {
      await updateRecord('users', user.id, { name: name.trim(), job_title: job.trim() });
      toast.success(t('Saved'));
      onClose();
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
      title={user.name || user.email}
      className="w-[min(94vw,32rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button loading={busy} onClick={() => void save()}>
            {t('Save')}
          </Button>
        </>
      }
    >
      <DialogBody>
        <Input label={t('Name|person')} value={name} onChange={(e) => setName(e.target.value)} />
        <Input label={t('Job title')} value={job} placeholder={t('For example: Licensing manager')} onChange={(e) => setJob(e.target.value)} />
      </DialogBody>
    </Dialog>
  );
}
