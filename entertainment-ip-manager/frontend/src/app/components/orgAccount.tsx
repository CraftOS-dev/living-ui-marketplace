/**
 * Settings, My account (everyone, including outside accounts): name, job
 * title, language (saving switches the app), the daily digest, the private
 * calendar feed (internal accounts) and signing out.
 */
import { useEffect, useState } from 'react';
import { CalendarDays, Copy, LogOut, RotateCcw, Save } from 'lucide-react';
import { Button, Input, Switch, getPbClient, toast, useAuth } from '../../kit/index.ts';
import { errText, op, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { t } from '../lib/i18n.ts';
import { roleHelp } from '../lib/labels.ts';
import type { Lang, Role } from '../lib/shapes.ts';
import { Field, IdentityChip, Loading, Pill, Section, Segmented } from './ui.tsx';
import { roleLabel, useAsk } from './orgShared.tsx';

type FeedScope = 'mine' | 'all';

export function AccountTab(): React.JSX.Element {
  const { me, role, lang, changeLang, can } = useApp();
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
      toast.error(t('Enter your name.'));
      return;
    }
    setBusy(true);
    try {
      await updateRecord('users', me.id, { name: name.trim(), job_title: job.trim() });
      toast.success(t('Profile saved'));
    } catch {
      /* the client already showed the server's message */
    } finally {
      setBusy(false);
    }
  };

  const setOptOut = async (optOut: boolean): Promise<void> => {
    try {
      await updateRecord('users', me.id, { digest_opt_out: optOut });
      toast.success(optOut ? t('You will no longer get the daily digest') : t('You will get the daily digest'));
    } catch {
      /* the client already showed the server's message */
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Section
        title={t('Profile')}
        actions={
          <Button size="sm" loading={busy} disabled={!dirty} onClick={() => void save()}>
            <Save size={13} aria-hidden /> {t('Save')}
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <IdentityChip name={me.name || me.email} />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{me.name || me.email}</div>
              <div className="truncate text-xs text-[var(--agent-app-muted)]">{email ?? me.email}</div>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label={t('Name|person')} value={name} onChange={(e) => setName(e.target.value)} />
            <Input label={t('Job title')} placeholder={t('For example: Licensing manager')} value={job} onChange={(e) => setJob(e.target.value)} />
          </div>
          {role !== '' && (
            <div className="flex flex-wrap items-center gap-2 border-t border-[var(--agent-app-border)] pt-3 text-[13px]">
              <span className="text-[var(--agent-app-muted)]">{t('Your role')}</span>
              <Pill tone="accent">{roleLabel(role)}</Pill>
              <span className="min-w-0 text-[var(--agent-app-muted)]">{roleHelp(role as Role)}</span>
            </div>
          )}
        </div>
      </Section>

      <Section title={t('Language')}>
        <Field label={t('The app speaks')} help={t('Saved to your account, so it follows you to every device. Dates, numbers and the daily digest follow it too.')}>
          <div>
            <Segmented<Lang>
              ariaLabel={t('Language')}
              value={lang}
              onChange={(v) => {
                if (v !== lang) changeLang(v);
              }}
              options={[
                { value: 'ja', label: '日本語' },
                { value: 'en', label: 'English' },
              ]}
            />
          </div>
        </Field>
      </Section>

      {!can.external && <CalendarFeed />}

      <Section title={t('Daily digest')}>
        {role === 'viewer' ? (
          <p className="text-[13px] text-[var(--agent-app-muted)]">{t('Viewers do not get the daily digest.')}</p>
        ) : (
          <div className="flex flex-col gap-2">
            <Switch checked={!me.digest_opt_out} onCheckedChange={(v) => void setOptOut(!v)} label={me.digest_opt_out ? t('You do not get the daily digest') : t('Send me the daily digest')} />
            <p className="text-xs leading-relaxed text-[var(--agent-app-muted)]">
              {can.external ? t('A short daily summary of what waits for you in the portal.') : t('A daily summary of overdue items, deadlines coming up and what waits for your review.')}
            </p>
          </div>
        )}
      </Section>

      <Section title={t('Sign out')}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 break-words text-[13px] text-[var(--agent-app-muted)]">{t('Signed in as {email}. Sign out on shared computers.', { email: email ?? me.email })}</p>
          <Button variant="outline" onClick={logout}>
            <LogOut size={14} aria-hidden /> {t('Sign out')}
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
  const [askEl, ask] = useAsk();

  const call = async (kind: 'get' | 'scope' | 'rotate', scope: FeedScope | null, rotate: boolean): Promise<void> => {
    setBusy(kind);
    try {
      const r = await op<{ path: string; scope: FeedScope }>('calendar/feed', { ...(scope !== null ? { scope } : {}), rotate });
      const base = getPbClient().pb.baseURL.replace(/\/$/, '');
      const origin = base.startsWith('http') ? base : `${window.location.origin}${base}`;
      setFeed({ url: `${origin}${r.path}`, scope: r.scope });
      if (kind === 'rotate') toast.success(t('New link created. The old link no longer works.'));
      if (kind === 'scope') toast.success(r.scope === 'all' ? t('The feed now shows every open deadline') : t('The feed now shows your deadlines'));
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
      toast.success(t('Calendar link copied'));
    } catch {
      toast.error(t('Your browser blocked copying. Select the link and copy it by hand.'));
    }
  };

  const rotate = async (): Promise<void> => {
    if (feed === null) return;
    const ok = await ask(t('Create a new link? The current link stops working, so every calendar that subscribes to it must be updated.'), t('Replace the calendar link?'), { confirmLabel: t('Replace link') });
    if (ok) await call('rotate', feed.scope, true);
  };

  return (
    <Section title={t('Calendar feed')}>
      {askEl}
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-2 text-[13px] leading-relaxed">
          <CalendarDays size={15} className="mt-0.5 shrink-0 text-[var(--agent-app-muted)]" aria-hidden />
          <p className="min-w-0">{t('Subscribe to your deadlines in Google Calendar, Outlook or Apple Calendar. The link is private: anyone who has it can see the deadlines in it, so treat it like a password and replace it if it leaks.')}</p>
        </div>
        {feed === null ? (
          <div>
            <Button variant="outline" size="sm" loading={busy === 'get'} onClick={() => void call('get', null, false)}>
              <CalendarDays size={13} aria-hidden /> {t('Show my calendar link')}
            </Button>
          </div>
        ) : (
          <>
            <div className="flex min-w-0 items-center gap-2">
              <code className="min-w-0 flex-1 truncate border border-[var(--agent-app-border)] bg-[var(--agent-app-surface-2)] px-2 py-1.5 font-mono text-[12px]" title={feed.url}>
                {feed.url}
              </code>
              <Button size="sm" variant="outline" onClick={() => void copy()}>
                <Copy size={13} aria-hidden /> {t('Copy')}
              </Button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              {can.edit ? (
                <Segmented<FeedScope>
                  size="sm"
                  ariaLabel={t('Deadlines in the feed')}
                  value={feed.scope}
                  onChange={(v) => void call('scope', v, false)}
                  options={[
                    { value: 'mine', label: t('Assigned to me') },
                    { value: 'all', label: t('All open deadlines') },
                  ]}
                />
              ) : (
                <span className="text-xs text-[var(--agent-app-muted)]">{t('Shows the deadlines assigned to you.')}</span>
              )}
              <Button size="sm" variant="ghost" loading={busy === 'rotate'} disabled={busy !== null} onClick={() => void rotate()}>
                <RotateCcw size={13} aria-hidden /> {t('Replace link')}
              </Button>
            </div>
          </>
        )}
      </div>
    </Section>
  );
}
