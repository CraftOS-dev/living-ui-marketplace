/**
 * Settings: you (your name, colour and account), what is allowed to
 * interrupt you and where your inbox opens, the workspace (its name, how new
 * people join, how many cards each agent works at once: admins change
 * these), the brake that pauses every agent, and how agents connect.
 */
import { useEffect } from 'react';
import { Bell, Inbox, LogOut, Newspaper, ShieldCheck } from 'lucide-react';
import { cn, toast, useAuth } from '../../kit/index.ts';
import { Button, EditableText, Field, Kbd, MenuButton, PersonAvatar, PoolAvatar, Row, Section, Segmented, Spinner, Toggle, errMessage } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { href } from '../lib/router.ts';
import type { Attention, Tone } from '../lib/types.ts';

const ATTENTION: { key: 'questions' | 'attention' | 'reviews'; label: string; hint: string }[] = [
  { key: 'questions', label: 'An agent asks you something', hint: 'Questions, plans to approve, acceptance criteria to add, on cards you asked for.' },
  { key: 'attention', label: 'A card of yours needs attention', hint: 'Handed back, failed too often, or its agent stopped responding.' },
  { key: 'reviews', label: 'Work you asked for is ready', hint: 'An agent submitted a card you asked for.' },
];

const TONES: Tone[] = ['orange', 'blue', 'green', 'purple', 'teal', 'pink', 'yellow', 'red', 'gray'];

const KEYS: [string, string][] = [
  ['C', 'New card'],
  ['/', 'Search the board'],
  ['Esc', 'Close the card'],
  ['Ctrl Z', 'Undo your last change'],
  ['J  K', 'Next and previous review'],
  ['A', 'Approve the review'],
  ['R', 'Request changes'],
];

export function SettingsPage(): React.JSX.Element {
  const app = useApp();
  const { logout } = useAuth();
  const s = app.settings;
  const me = app.me;
  useEffect(() => {
    void api.reportUi({ view: 'settings' }).catch(() => undefined);
  }, []);
  const saveWorkspace = (p: Parameters<typeof api.saveSettings>[0]): void => {
    api
      .saveSettings(p)
      .then(() => app.reload())
      .catch((err: unknown) => toast.error(errMessage(err)));
  };
  const saveMe = (p: Parameters<typeof api.saveMe>[0]): void => {
    api
      .saveMe(p)
      .then(() => app.reload())
      .catch((err: unknown) => toast.error(errMessage(err)));
  };
  return (
    <div className="flex h-full min-w-0 flex-col">
      <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-[var(--kb-hair)] px-3 md:gap-3 md:px-6">
        <MenuButton />
        <h1 className="text-[15px] font-semibold">Settings</h1>
      </header>
      <div className="kb-scroll min-h-0 flex-1 overflow-y-auto">
        {s === null || me === null ? (
          <div className="flex h-40 items-center justify-center text-[var(--kb-muted)]">
            <Spinner size={18} />
          </div>
        ) : (
          <div className="mx-auto flex max-w-[720px] flex-col gap-8 px-4 py-5 md:px-6 md:py-6">
            <Section title="You">
              <div className="flex items-center gap-3">
                <PersonAvatar person={me} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-semibold">{me.name}</div>
                  <div className="truncate text-[12.5px] text-[var(--kb-muted)]">
                    {me.email} · {me.role === 'admin' ? 'Admin' : 'Member'}
                  </div>
                </div>
                <Button variant="ghost" icon={LogOut} onClick={() => logout()}>
                  Sign out
                </Button>
              </div>
              <Field label="Your name" hint="What the team and the agents see on your cards, comments and decisions.">
                <EditableText label="Your name" value={me.name} onSave={(v) => v.trim() !== '' && saveMe({ name: v.trim() })} placeholder="Your name" />
              </Field>
              <div className="flex flex-col gap-1.5">
                <span className="text-[12px] font-medium text-[var(--kb-ink-2)]">Your colour</span>
                <div role="radiogroup" aria-label="Your colour" className="flex flex-wrap gap-2">
                  {TONES.map((t) => (
                    <button key={t} type="button" role="radio" aria-checked={me.tone === t} aria-label={t} title={t} onClick={() => saveMe({ tone: t })} className={cn('kb-focus rounded-full p-0.5 ring-2 transition-shadow', me.tone === t ? 'ring-[var(--kb-ink)]' : 'ring-transparent hover:ring-[var(--kb-line)]')}>
                      <PersonAvatar person={{ name: me.name, tone: t }} size={26} />
                    </button>
                  ))}
                </div>
              </div>
            </Section>

            <Section title="What interrupts you">
              <p className="text-[12.5px] leading-5 text-[var(--kb-muted)]">Interrupt shows a notice right away. Inbox keeps it waiting in the inbox. Everything else the team and its agents do is in the inbox&apos;s &quot;Since you were away&quot;.</p>
              {ATTENTION.map((a) => (
                <Row key={a.key} label={a.label} hint={a.hint}>
                  <Segmented
                    size="sm"
                    label={a.label}
                    value={me.prefs.attention[a.key] === 'interrupt' ? 'interrupt' : 'inbox'}
                    onChange={(v) => saveMe({ prefs: { attention: { [a.key]: v as Attention } } })}
                    options={[
                      {
                        value: 'interrupt',
                        label: (
                          <span className="inline-flex items-center gap-1">
                            <Bell size={12} aria-hidden /> Interrupt
                          </span>
                        ),
                      },
                      {
                        value: 'inbox',
                        label: (
                          <span className="inline-flex items-center gap-1">
                            <Inbox size={12} aria-hidden /> Inbox
                          </span>
                        ),
                      },
                    ]}
                  />
                </Row>
              ))}
              <Row label="Your inbox opens on" hint="Mine: cards you asked for or hold, and ones nobody owns. Everyone: the whole team's.">
                <Segmented size="sm" label="Your inbox opens on" value={me.prefs.inbox} onChange={(v) => saveMe({ prefs: { inbox: v } })} options={[{ value: 'mine', label: 'Mine' }, { value: 'all', label: 'Everyone' }]} />
              </Row>
            </Section>

            <Section
              title="Workspace"
              aside={
                !app.admin ? (
                  <span className="inline-flex items-center gap-1 text-[12px] text-[var(--kb-muted)]">
                    <ShieldCheck size={13} aria-hidden /> Admins change these
                  </span>
                ) : undefined
              }
            >
              <Field label="Workspace name" hint="Shown in the sidebar and to everyone who signs in.">
                {app.admin ? <EditableText label="Workspace name" value={s.name} onSave={(v) => v.trim() !== '' && saveWorkspace({ name: v.trim() })} /> : <div className="kb-field flex h-8 items-center px-2.5 text-[13px] text-[var(--kb-ink-2)]">{s.name}</div>}
              </Field>
              <Row label="New people" hint={s.joining === 'open' ? 'Anyone who creates an account, here or through a link you share, is in at once.' : 'People who sign up through a link you share wait until an admin lets them in; admins are told at once. Accounts made on this computer are always in.'}>
                <Segmented
                  size="sm"
                  label="New people"
                  value={s.joining}
                  onChange={(v) => (app.admin ? saveWorkspace({ joining: v }) : toast.info('Only an admin can change how people join.'))}
                  options={[
                    { value: 'open', label: 'Join at once' },
                    { value: 'approval', label: 'Admin approves' },
                  ]}
                />
              </Row>
              <Row label="Cards each agent works at once" hint="The default limit per agent, across all its sessions; an admin can set a different limit for one agent on the Team page.">
                <Segmented
                  size="sm"
                  label="Cards each agent works at once"
                  value={String(s.max_working)}
                  onChange={(v) => (app.admin ? saveWorkspace({ max_working: Number(v) }) : toast.info('Only an admin can change the limit.'))}
                  options={['1', '2', '3', '5'].map((n) => ({ value: n, label: n }))}
                />
              </Row>
            </Section>

            <Section title="Agents">
              <Row
                label={
                  <span className="inline-flex items-center gap-2">
                    <PoolAvatar size={20} /> Let agents work
                  </span>
                }
                hint="Off pauses every agent at once: none takes, changes or finishes anything until someone turns it back on. Anyone on the team may pull this brake. Cards they were working on go back to the queue when their leases run out."
              >
                <Toggle label="Let agents work" checked={!app.paused} onChange={(on) => app.setPaused(!on)} />
              </Row>
              <p className="text-[12.5px] leading-5 text-[var(--kb-muted)]">
                Pause one agent, see what it is working on and its report card on the{' '}
                <a href={href('team')} className="font-medium text-[var(--kb-ink)] underline underline-offset-2">
                  Team page
                </a>
                .
              </p>
            </Section>

            <Section title="How agents work with these boards">
              <div className="flex flex-col gap-3 text-[13px] leading-5 text-[var(--kb-ink-2)]">
                <p>
                  <span className="font-semibold text-[var(--kb-ink)]">Joining.</span> An agent connects through the agent-app CLI under its own name (the <code className="rounded bg-[var(--kb-card)] px-1 text-[12px]">A2APP_AGENT</code> setting). A new name joins the team as a new agent the first time it calls; CraftBot is there from the start.
                </p>
                <p>
                  <span className="font-semibold text-[var(--kb-ink)]">Waking up.</span> When a card is queued for CraftBot or for any agent, the board fires the <code className="rounded bg-[var(--kb-card)] px-1 text-[12px]">work_waiting</code> trigger. Approve the trigger once in CraftBot; after that it wakes on its own. Other agents ask for work with <code className="rounded bg-[var(--kb-card)] px-1 text-[12px]">work.next</code>.
                </p>
                <p>
                  <span className="font-semibold text-[var(--kb-ink)]">Working a card.</span> Each agent reads <code className="rounded bg-[var(--kb-card)] px-1 text-[12px]">app.guide</code>, takes one card at a time (its own, or any agent&apos;s from the pool), keeps its lease with heartbeats, and finishes each card with submit, ask, return or fail. A card one agent holds is never handed to another.
                </p>
                <p className="inline-flex items-start gap-1.5">
                  <Newspaper size={14} aria-hidden className="mt-0.5 shrink-0" /> The rules agents are held to (never Done, never deciding a review, WIP limits, frozen boards, pauses) are enforced by the board itself, not by asking nicely.
                </p>
              </div>
            </Section>

            <Section title="Keyboard">
              <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                {KEYS.map(([k, v]) => (
                  <div key={k} className="flex items-center gap-2 text-[13px]">
                    <span className="inline-flex gap-1">
                      {k
                        .split(' ')
                        .filter(Boolean)
                        .map((x) => (
                          <Kbd key={x}>{x}</Kbd>
                        ))}
                    </span>
                    <span className="text-[var(--kb-ink-2)]">{v}</span>
                  </div>
                ))}
              </div>
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}
