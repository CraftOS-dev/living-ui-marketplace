/**
 * Settings, My account (everyone): profile, role, daily digest, the
 * personal calendar feed and signing out.
 */
import { useEffect, useState } from 'react';
import { CalendarDays, Copy, LogOut, RotateCcw, Save } from 'lucide-react';
import { Button, Input, Switch, getPbClient, toast, useAuth, useConfirm } from '../../kit/index.ts';
import { errText, op, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { ROLE_HELP, ROLE_LABEL } from '../lib/labels.ts';
import { Field, IdentityChip, Loading, Pill, Section, Segmented } from './ui.tsx';
import { DigestPreview } from './adminShared.tsx';

type FeedScope = 'mine' | 'all';

export function AccountTab(): React.JSX.Element {
  const { me, role } = useApp();
  const { logout, email } = useAuth();
  const [name, setName] = useState(me?.name ?? '');
  const [job, setJob] = useState(me?.job_title ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(me?.name ?? '');
    setJob(me?.job_title ?? '');
  }, [me?.name, me?.job_title]);

  if (me === null) return <Loading />;

  const dirty = name.trim() !== me.name || job.trim() !== me.job_title;

  const save = async (): Promise<void> => {
    if (name.trim() === '') {
      toast.error('Enter your name.');
      return;
    }
    setBusy(true);
    try {
      await updateRecord('users', me.id, { name: name.trim(), job_title: job.trim() });
      toast.success('Profile saved');
    } catch {
      /* the client already showed the server's message */
    } finally {
      setBusy(false);
    }
  };

  const setOptOut = async (optOut: boolean): Promise<void> => {
    try {
      await updateRecord('users', me.id, { digest_opt_out: optOut });
      toast.success(optOut ? 'You will no longer get the daily digest' : 'You will get the daily digest');
    } catch {
      /* the client already showed the server's message */
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Section
        title="Profile"
        actions={
          <Button size="sm" loading={busy} disabled={!dirty} onClick={() => void save()}>
            <Save size={13} aria-hidden /> Save
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <IdentityChip name={me.name || me.email} />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{me.name || me.email}</div>
              <div className="truncate text-xs text-[var(--agent-app-muted)]">{email ?? me.email}</div>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <Input label="Job title" placeholder="For example: Senior paralegal" value={job} onChange={(e) => setJob(e.target.value)} />
          </div>
          {role !== '' && (
            <div className="flex flex-wrap items-center gap-2 border-t border-[var(--agent-app-border)] pt-3 text-[13px]">
              <span className="text-[var(--agent-app-muted)]">Your role</span>
              <Pill tone="accent">{ROLE_LABEL[role]}</Pill>
              <span className="text-[var(--agent-app-muted)]">{ROLE_HELP[role]}</span>
            </div>
          )}
        </div>
      </Section>

      <CalendarFeed />

      <Section title="Daily digest">
        <div className="flex flex-col gap-4">
          {role === 'viewer' ? (
            <p className="text-[13px] text-[var(--agent-app-muted)]">Viewers do not get the daily digest. You can still preview what it would contain.</p>
          ) : (
            <Switch checked={!me.digest_opt_out} onCheckedChange={(v) => void setOptOut(!v)} label={me.digest_opt_out ? 'You do not get the daily digest' : 'Send me the daily digest'} />
          )}
          <div className="border-t border-[var(--agent-app-border)] pt-3">
            <DigestPreview compact />
          </div>
        </div>
      </Section>

      <Section title="Sign out">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-[var(--agent-app-muted)]">Signed in as {email ?? me.email}. Sign out on shared computers.</p>
          <Button variant="outline" onClick={logout}>
            <LogOut size={14} aria-hidden /> Sign out
          </Button>
        </div>
      </Section>
    </div>
  );
}

function CalendarFeed(): React.JSX.Element {
  const { can } = useApp();
  const [feed, setFeed] = useState<{ url: string; scope: FeedScope } | null>(null);
  const [busy, setBusy] = useState<'get' | 'scope' | 'rotate' | null>(null);
  const [confirmEl, confirm] = useConfirm();

  const call = async (kind: 'get' | 'scope' | 'rotate', scope: FeedScope | null, rotate: boolean): Promise<void> => {
    setBusy(kind);
    try {
      // No scope reads the current feed without changing it.
      const r = await op<{ path: string; scope: FeedScope }>('calendar/feed', { ...(scope !== null ? { scope } : {}), rotate });
      const base = getPbClient().pb.baseURL.replace(/\/$/, '');
      const origin = base.startsWith('http') ? base : `${window.location.origin}${base}`;
      setFeed({ url: `${origin}${r.path}`, scope: r.scope });
      if (kind === 'rotate') toast.success('New link created. The old link no longer works.');
      if (kind === 'scope') toast.success(r.scope === 'all' ? 'The feed now shows every open deadline' : 'The feed now shows your deadlines');
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(null);
    }
  };

  const copy = async (): Promise<void> => {
    if (feed === null) return;
    try {
      await navigator.clipboard.writeText(feed.url);
      toast.success('Calendar link copied');
    } catch {
      toast.error('Your browser blocked copying. Select the link and copy it by hand.');
    }
  };

  const rotate = async (): Promise<void> => {
    if (feed === null) return;
    const ok = await confirm('Create a new link? The current link stops working, so every calendar that subscribes to it must be updated.', 'Replace the calendar link?');
    if (ok) await call('rotate', feed.scope, true);
  };

  return (
    <Section title="Calendar feed">
      {confirmEl}
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-2 text-[13px] leading-relaxed">
          <CalendarDays size={15} className="mt-0.5 shrink-0 text-[var(--agent-app-muted)]" aria-hidden />
          <p>
            Subscribe to your deadlines in Google Calendar, Outlook or Apple Calendar. The link is private: anyone who has it can see the deadlines in it, so treat it like a password and replace it if it leaks.
          </p>
        </div>
        {feed === null ? (
          <div>
            <Button variant="outline" size="sm" loading={busy === 'get'} onClick={() => void call('get', null, false)}>
              <CalendarDays size={13} aria-hidden /> Show my calendar link
            </Button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate border border-[var(--agent-app-border)] bg-[var(--agent-app-surface-2)] px-2 py-1.5 font-mono text-[12px]" title={feed.url}>
                {feed.url}
              </code>
              <Button size="sm" variant="outline" onClick={() => void copy()}>
                <Copy size={13} aria-hidden /> Copy
              </Button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              {can.edit ? (
                <Field label="Shows">
                  <div>
                    <Segmented<FeedScope>
                      size="sm"
                      ariaLabel="Deadlines in the feed"
                      value={feed.scope}
                      onChange={(v) => void call('scope', v, false)}
                      options={[
                        { value: 'mine', label: 'Assigned to me' },
                        { value: 'all', label: 'All open deadlines' },
                      ]}
                    />
                  </div>
                </Field>
              ) : (
                <span className="text-xs text-[var(--agent-app-muted)]">Shows the deadlines assigned to you.</span>
              )}
              <Button size="sm" variant="ghost" loading={busy === 'rotate'} disabled={busy !== null} onClick={() => void rotate()}>
                <RotateCcw size={13} aria-hidden /> Replace link
              </Button>
            </div>
          </>
        )}
      </div>
    </Section>
  );
}
