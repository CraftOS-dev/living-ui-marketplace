/**
 * Talk to your AI agent: tell it what to do (a chat task), see every task it
 * was handed and how each ended, and the activity trail of the store.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, Clock3, ExternalLink, Sparkles, User } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { op } from '../lib/api.ts';
import { changed, useLive } from '../lib/live.ts';
import { ago, TASK_LABEL } from '../lib/format.ts';
import { targetHref, useRoute } from '../lib/router.ts';
import type { Activity, Chat, Task } from '../lib/types.ts';
import { currentAgentTab, useOpenSignal } from './Shell.tsx';
import { Button, Drawer, Empty, IconBadge, TaskBadge, Tabs } from './ui.tsx';

type Tab = 'chat' | 'tasks' | 'activity';

function ChatView(): React.JSX.Element {
  const route = useRoute();
  const chats = useLive<{ chats: Chat[] }>('agent-chats', (signal) => op('chats.list', { limit: 40 }, { signal, quiet: true }), ['chats', 'tasks']);
  const tasks = useLive<{ tasks: Task[] }>('agent-chat-tasks', (signal) => op('tasks.recent', { limit: 60 }, { signal, quiet: true }), ['tasks', 'chats']);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const list = chats.data?.chats ?? [];
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [list.length]);
  const send = async (): Promise<void> => {
    const t = text.trim();
    if (t === '' || busy) return;
    setBusy(true);
    try {
      await op('chats.send', { text: t, context: route.page + (route.sub ? ':' + route.sub : '') + (route.id ? ':' + route.id : '') });
      setText('');
      changed('chats', 'tasks');
    } catch {
      /* the notice says why */
    } finally {
      setBusy(false);
    }
  };
  const taskOf = (id: string): Task | undefined => tasks.data?.tasks.find((t) => t.id === id);
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-4">
        {list.length === 0 && !chats.loading && (
          <Empty icon={Sparkles} title="Tell your AI agent what to do">
            Sync a shop, write listings, answer buyers, or ask how sales went.
          </Empty>
        )}
        {list.map((c) => {
          const task = taskOf(c.task);
          return (
            <div key={c.id} className="space-y-2">
              <div className="flex justify-end">
                <div className="max-w-[85%] rounded-[18px] rounded-br-[6px] bg-[var(--so-primary)] px-3.5 py-2.5 text-[14px] leading-[21px] text-[var(--so-on-primary)]">
                  <p className="whitespace-pre-wrap">{c.text}</p>
                  <p className="mt-1 text-right text-[11px] opacity-60">{ago(c.created)}</p>
                </div>
              </div>
              {c.reply !== '' ? (
                <div className="flex items-start gap-2">
                  <IconBadge icon={Sparkles} tone="accent" size={28} />
                  <div className="max-w-[85%] rounded-[18px] rounded-tl-[6px] bg-[var(--so-card)] px-3.5 py-2.5 text-[14px] leading-[21px]">
                    <p className="whitespace-pre-wrap">{c.reply}</p>
                    <p className="mt-1 text-[11px] text-[var(--so-muted)]">{ago(c.updated)}</p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 pl-1">
                  <TaskBadge task={task ? { id: task.id, kind: task.kind, state: task.state, label: task.label } : { id: '', kind: 'chat', state: 'asked', label: '' }} />
                </div>
              )}
            </div>
          );
        })}
        <div ref={end} />
      </div>
      <div className="flex items-end gap-2 rounded-[20px] bg-[var(--so-card)] p-2 shadow-[inset_0_0_0_1px_var(--so-border)] focus-within:shadow-[inset_0_0_0_2px_var(--so-ink)]">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={2}
          placeholder="Tell your AI agent..."
          aria-label="Message to your AI agent"
          className="max-h-40 min-h-[44px] flex-1 resize-none bg-transparent px-2 py-1.5 text-[14px] leading-[21px] text-[var(--so-ink)] outline-none"
        />
        <button type="button" aria-label="Send" disabled={text.trim() === '' || busy} onClick={() => void send()} className="so-press flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--so-primary)] text-[var(--so-on-primary)] hover:bg-[var(--so-primary-hover)] disabled:opacity-40">
          <ArrowUp size={18} strokeWidth={2.4} />
        </button>
      </div>
    </div>
  );
}

function TasksView(): React.JSX.Element {
  const tasks = useLive<{ tasks: Task[] }>('agent-tasks', (signal) => op('tasks.recent', { limit: 60 }, { signal, quiet: true }), ['tasks']);
  const list = tasks.data?.tasks ?? [];
  const cancel = async (id: string): Promise<void> => {
    try {
      await op('tasks.cancel', { task: id });
      changed('tasks');
    } catch {
      /* noticed */
    }
  };
  if (list.length === 0 && !tasks.loading) return <Empty icon={Clock3} title="No tasks yet">Work you hand to your AI agent shows here with how it went.</Empty>;
  return (
    <ul className="space-y-2">
      {list.map((t) => {
        const open = t.state === 'queued' || t.state === 'asked' || t.state === 'working';
        const to = targetHref(t.target);
        return (
          <li key={t.id} className="rounded-[16px] bg-[var(--so-card)] p-3.5">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-semibold text-[var(--so-muted)]">{TASK_LABEL[t.kind] ?? t.kind}</p>
                <p className="mt-0.5 text-[14px] font-medium leading-5">{t.label}</p>
                {t.note !== '' && <p className="mt-1 text-[13px] leading-5 text-[var(--so-ink-2)]">{t.note}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <TaskBadge task={t} />
                  <span className="text-[12px] text-[var(--so-muted)]">{ago(t.done_at || t.created)}</span>
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                {to !== '' && (
                  <a href={to} className="inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-[12px] font-semibold text-[var(--so-ink-2)] hover:bg-[var(--so-tile)]">
                    Open <ExternalLink size={12} />
                  </a>
                )}
                {open && (
                  <Button size="sm" variant="tile" onClick={() => void cancel(t.id)}>
                    Cancel
                  </Button>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function ActivityView(): React.JSX.Element {
  const act = useLive<{ activity: Activity[] }>('agent-activity', (signal) => op('activity.list', { limit: 80 }, { signal, quiet: true }), ['activity']);
  const list = act.data?.activity ?? [];
  if (list.length === 0 && !act.loading) return <Empty icon={Clock3} title="Nothing yet">Changes to the store show here.</Empty>;
  return (
    <ol className="relative space-y-1 pl-1">
      {list.map((a) => {
        const to = targetHref(a.target);
        const Icon = a.actor === 'agent' ? Sparkles : a.actor === 'system' ? Clock3 : User;
        const body = (
          <span className="flex items-start gap-3 rounded-[14px] px-2 py-2">
            <IconBadge icon={Icon} tone={a.actor === 'agent' ? 'accent' : 'card'} size={28} />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] leading-5">{a.text}</span>
              <span className="block text-[12px] text-[var(--so-muted)]">
                {a.actor === 'agent' ? 'Your AI agent' : a.actor === 'system' ? 'Store OS' : 'You'}, {ago(a.created)}
              </span>
            </span>
          </span>
        );
        return (
          <li key={a.id}>
            {to !== '' ? (
              <a href={to} className="block rounded-[14px] hover:bg-[var(--so-tile-hover)]">
                {body}
              </a>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function AgentPanel(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('chat');
  useOpenSignal(
    'agent',
    useCallback(() => {
      setTab(currentAgentTab());
      setOpen(true);
    }, []),
  );
  return (
    <Drawer
      open={open}
      onClose={() => setOpen(false)}
      width={480}
      title={
        <span className="flex items-center gap-2">
          <IconBadge icon={Sparkles} tone="ink" size={28} />
          Your AI agent
        </span>
      }
    >
      <div className="flex h-full flex-col gap-4">
        <Tabs
          size="sm"
          className="self-start"
          value={tab}
          onChange={setTab}
          items={[
            { key: 'chat', label: 'Chat' },
            { key: 'tasks', label: 'Tasks' },
            { key: 'activity', label: 'Activity' },
          ]}
        />
        <div className={cn('min-h-0 flex-1', tab === 'chat' ? 'flex flex-col' : '')}>
          {tab === 'chat' && <ChatView />}
          {tab === 'tasks' && <TasksView />}
          {tab === 'activity' && <ActivityView />}
        </div>
      </div>
    </Drawer>
  );
}
