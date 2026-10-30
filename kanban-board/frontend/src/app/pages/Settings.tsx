/**
 * Settings: your name, the agent (its on switch and how many cards it works
 * at once), what is allowed to interrupt you, and how the agent connects to
 * the board.
 */
import { useEffect } from 'react';
import { Bell, Inbox, Newspaper } from 'lucide-react';
import { toast } from '../../kit/index.ts';
import { AgentAvatar, EditableText, Field, Kbd, MenuButton, Row, Section, Segmented, Spinner, Toggle, errMessage } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';

const ATTENTION: { key: string; label: string; hint: string }[] = [
  { key: 'questions', label: 'The agent asks you something', hint: 'Questions, plans to approve, acceptance criteria to add.' },
  { key: 'attention', label: 'A card needs your attention', hint: 'Handed back, failed too often, or stopped responding.' },
  { key: 'reviews', label: 'Work is ready for review', hint: 'The agent submitted a card.' },
];

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
  const s = app.settings;
  useEffect(() => {
    void api.reportUi({ view: 'settings' }).catch(() => undefined);
  }, []);
  const save = (p: Parameters<typeof api.saveSettings>[0]): void => {
    api.saveSettings(p).catch((err: unknown) => toast.error(errMessage(err)));
  };
  return (
    <div className="flex h-full min-w-0 flex-col">
      <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-[var(--kb-hair)] px-3 md:gap-3 md:px-6">
        <MenuButton />
        <h1 className="text-[15px] font-semibold">Settings</h1>
      </header>
      <div className="kb-scroll min-h-0 flex-1 overflow-y-auto">
        {s === null ? (
          <div className="flex h-40 items-center justify-center text-[var(--kb-muted)]">
            <Spinner size={18} />
          </div>
        ) : (
          <div className="mx-auto flex max-w-[720px] flex-col gap-8 px-4 py-5 md:px-6 md:py-6">
            <Section title="You">
              <Field label="Your name" hint="What the agent calls you, and the initials on your cards.">
                <EditableText label="Your name" value={s.name} onSave={(v) => save({ name: v })} placeholder="Your name" />
              </Field>
            </Section>
            <Section title="Agent">
              <Row
                label={
                  <span className="inline-flex items-center gap-2">
                    <AgentAvatar size={20} paused={app.paused} /> Let the agent work
                  </span>
                }
                hint="Off pauses it: the agent takes, changes and finishes nothing until you turn it back on. Cards it was working on go back to the queue when their leases run out."
              >
                <Toggle label="Let the agent work" checked={!app.paused} onChange={(on) => app.setPaused(!on)} />
              </Row>
              <Row label="Cards at once" hint="How many cards the agent works on at the same time, across all its sessions. Each trigger can start a session; this keeps them from piling up.">
                <Segmented
                  size="sm"
                  label="Cards at once"
                  value={String(s.max_working)}
                  onChange={(v) => save({ max_working: Number(v) })}
                  options={['1', '2', '3', '5'].map((n) => ({ value: n, label: n }))}
                />
              </Row>
            </Section>
            <Section title="What interrupts you">
              <p className="text-[12.5px] leading-5 text-[var(--kb-muted)]">Interrupt shows a notice right away. Inbox keeps it waiting in the inbox. Everything else the agent does is in the inbox's "Since you were away".</p>
              {ATTENTION.map((a) => (
                <Row key={a.key} label={a.label} hint={a.hint}>
                  <Segmented
                    size="sm"
                    label={a.label}
                    value={(s.attention[a.key] ?? 'inbox') === 'interrupt' ? 'interrupt' : 'inbox'}
                    onChange={(v) => save({ attention: { [a.key]: v } })}
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
            </Section>
            <Section title="How the agent works with this board">
              <div className="flex flex-col gap-3 text-[13px] leading-5 text-[var(--kb-ink-2)]">
                <p>
                  <span className="font-semibold text-[var(--kb-ink)]">Waking up.</span> When a card is queued for the agent, the board fires the <code className="rounded bg-[var(--kb-card)] px-1 text-[12px]">work_waiting</code> trigger. Approve the trigger once in CraftBot; after that the agent wakes on its own, works the waiting cards and reports back.
                </p>
                <p>
                  <span className="font-semibold text-[var(--kb-ink)]">Working a card.</span> Through the agent-app CLI it reads <code className="rounded bg-[var(--kb-card)] px-1 text-[12px]">app.guide</code>, takes one card at a time with <code className="rounded bg-[var(--kb-card)] px-1 text-[12px]">work.next</code>, keeps its lease with heartbeats, and finishes each card with submit, ask, return or fail.
                </p>
                <p className="inline-flex items-center gap-1.5">
                  <Newspaper size={14} aria-hidden /> The rules the agent is held to (never Done, never deciding a review, WIP limits, frozen boards) are enforced by the board itself, not by asking nicely.
                </p>
              </div>
            </Section>
            <Section title="Keyboard">
              <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                {KEYS.map(([k, v]) => (
                  <div key={k} className="flex items-center gap-2 text-[13px]">
                    <span className="inline-flex gap-1">
                      {k.split(' ').filter(Boolean).map((x) => (
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
