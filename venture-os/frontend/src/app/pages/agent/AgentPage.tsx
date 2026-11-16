/**
 * Your AI agent's page: tell it something; everything it was asked, one
 * request per task, grouped by where it is (not picked up or could not,
 * working, sent, done), each followed live from the platform's request
 * rows; the questions people asked and their answers; and its runs (its
 * writes grouped), each undoable as one unit (activity.undo).
 */
import { useState } from 'react';
import { Inbox, MessageSquareText, RotateCcw, Sparkle, Undo2 } from 'lucide-react';
import type { AgentRequestRecord } from '../../../kit/index.ts';
import { recordOf, useRequests } from '../../components/agent.tsx';
import { QuestionItem, RequestItem, TellField, openAgent, requestState, useTriggerLabels } from '../../components/shell/AgentPanel.tsx';
import { Button, Empty, LoadError, Panel, PageBody, PageHeader, Skeleton, Tabs, Tag } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { ago, num } from '../../lib/format.ts';
import { act, reshape, useOp } from '../../lib/live.ts';
import type { AgentQuestion } from '../../lib/types.ts';

/** activity.list --view runs: one row per run of your AI agent. */
interface Run {
  run: string;
  started: string;
  last: string;
  entries: number;
  undone: number;
  changes: number;
  summaries: string[];
}

type Group = 'retry' | 'working' | 'sent' | 'done';

/** The groups of the Asked tab, in reading order: what needs you first. */
const GROUPS: { key: Group; label: string; tip: string }[] = [
  { key: 'retry', label: 'Not picked up or could not', tip: 'Retry asks your AI agent once more.' },
  { key: 'working', label: 'Working', tip: 'Your AI agent is on these now.' },
  { key: 'sent', label: 'Sent', tip: 'Asked once; your AI agent picks each up while it is running.' },
  { key: 'done', label: 'Done', tip: 'Finished.' },
];

function groupOf(r: AgentRequestRecord): Group {
  const s = requestState(r);
  if (r.status === 'claimed') return 'working';
  if (r.status === 'done') return 'done';
  if (r.status === 'rejected' || s.tone === 'warn') return 'retry';
  return 'sent';
}

/** Retry a request: the same trigger for the same record (refused in words while the record still waits). */
function retry(r: AgentRequestRecord): void {
  const again = r.status === 'pending' ? '' : r.id;
  void act([], () => op('agent.ask', { trigger: r.trigger, record: recordOf(r), ...(again !== '' ? { again } : {}) }), ['agent_requests', '*']);
}

function Grouped({ rows, labels }: { rows: AgentRequestRecord[]; labels: Record<string, string> }): React.JSX.Element {
  return (
    <div className="flex flex-col">
      {GROUPS.map((g) => {
        const list = rows.filter((r) => groupOf(r) === g.key);
        if (list.length === 0) return null;
        return (
          <section key={g.key} className="border-b border-[var(--vo-line)] px-5 pt-3 last:border-b-0" aria-label={g.label}>
            <div className="vo-label" title={g.tip}>
              {g.label} <span className="vo-num text-[var(--vo-muted)]">{num(list.length)}</span>
            </div>
            <ul>
              {list.map((r) => (
                <RequestItem
                  key={r.id}
                  r={r}
                  labels={labels}
                  action={
                    g.key === 'retry' ? (
                      <Button size="sm" icon={RotateCcw} onClick={() => retry(r)}>
                        Retry
                      </Button>
                    ) : undefined
                  }
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

export function AgentPage(): React.JSX.Element {
  const [tab, setTab] = useState<'asked' | 'questions' | 'runs'>('asked');
  const labels = useTriggerLabels();
  const asked = useRequests({ limit: 80, skip: tab !== 'asked', name: 'agent.all' });
  const questions = useOp<{ asks: AgentQuestion[] }>('chat.list', { limit: 60 }, ['agent_asks', 'agent_requests'], { name: 'agent.questions', skip: tab !== 'questions' });
  const runs = useOp<{ runs: Run[] }>('activity.list', { view: 'runs', actor: 'agent' }, ['activity'], { name: 'agent.runs', skip: tab !== 'runs' });
  const loading = (
    <div className="p-5">
      <Skeleton className="h-24 w-full" />
    </div>
  );
  const rows = (asked.data ?? []).filter((r) => r.trigger !== 'question_asked');
  return (
    <>
      <PageHeader title="Your AI agent" />
      <PageBody className="max-w-[880px]">
        <TellField onSent={(ask) => openAgent(ask)} />
        <Tabs
          label="Your AI agent"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'asked', label: 'Asked', count: rows.filter((r) => groupOf(r) === 'working' || groupOf(r) === 'sent').length },
            { value: 'questions', label: 'Questions' },
            { value: 'runs', label: 'Runs' },
          ]}
        />
        <Panel flush>
          {tab === 'asked' ? (
            asked.data === null ? (
              asked.error !== null ? (
                <LoadError message={asked.error} onRetry={asked.reload} />
              ) : (
                loading
              )
            ) : rows.length === 0 ? (
              <Empty icon={Inbox} title="What you ask your AI agent shows here" />
            ) : (
              <Grouped rows={rows} labels={labels} />
            )
          ) : tab === 'questions' ? (
            questions.data === null ? (
              questions.error !== null ? (
                <LoadError message={questions.error} onRetry={questions.reload} />
              ) : (
                loading
              )
            ) : questions.data.asks.length === 0 ? (
              <Empty icon={MessageSquareText} title="No questions yet" />
            ) : (
              <ul className="px-5">
                {questions.data.asks.map((q) => (
                  <QuestionItem key={q.id} q={q} />
                ))}
              </ul>
            )
          ) : runs.data === null ? (
            runs.error !== null ? (
              <LoadError message={runs.error} onRetry={runs.reload} />
            ) : (
              loading
            )
          ) : runs.data.runs.length === 0 ? (
            <Empty icon={Sparkle} title="No runs yet" />
          ) : (
            <ul className="px-5">
              {runs.data.runs.map((r) => (
                <li key={r.run} className="flex min-h-12 items-center gap-3 border-b border-[var(--vo-hair)] py-2 last:border-b-0">
                  <span className="vo-wrap min-w-0 flex-1 text-[13px]">{r.summaries[0] ?? r.run}</span>
                  <span className="vo-mono vo-num shrink-0 text-[12px] text-[var(--vo-muted)]" title="Changes">
                    {num(r.changes)} {r.changes === 1 ? 'change' : 'changes'}
                  </span>
                  <span className="vo-mono w-20 shrink-0 text-right text-[12px] text-[var(--vo-muted)]">{ago(r.last)}</span>
                  {r.undone >= r.entries ? (
                    <Tag tone="faint">Undone</Tag>
                  ) : (
                    <Button size="sm" icon={Undo2} onClick={() => void act([reshape('agent.runs', (d) => ({ runs: (d as { runs: Run[] }).runs.map((x) => (x.run === r.run ? { ...x, undone: x.entries } : x)) }))], () => op('activity.undo', { run: r.run }), ['activity', '*'])}>
                      Undo
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </PageBody>
    </>
  );
}
