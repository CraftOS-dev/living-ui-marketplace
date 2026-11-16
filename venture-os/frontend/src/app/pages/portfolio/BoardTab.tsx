/**
 * Board meetings of a company: day, title and the brief's StepTrack
 * (Queued, Writing, Ready). Your AI agent writes the brief 48 hours before
 * (or now, on request). Opening a meeting shows its brief and the note.
 */
import { useEffect, useState } from 'react';
import { CalendarPlus, Presentation, Sparkle } from 'lucide-react';
import { AgentTag, Button, DayPicker, Dialog, Empty, Field, Input, LoadError, Panel, Skeleton, StepTrack, Textarea } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { allowed, useMe } from '../../lib/auth.ts';
import { addDays, fmtDay, today } from '../../lib/format.ts';
import { act, useOp } from '../../lib/live.ts';
import type { BoardMeeting } from './types.ts';
import { AskAgent, AskStatus, askWith } from '../../components/agent.tsx';

const READS = ['board_meetings', 'agent_requests'];

function AddMeeting({ company, open, onClose }: { company: string; open: boolean; onClose: () => void }): React.JSX.Element | null {
  const [day, setDay] = useState(addDays(today(), 7));
  const [time, setTime] = useState('15:00');
  const [title, setTitle] = useState('');
  if (!open) return null;
  const save = (): void => {
    onClose();
    void act([], () => op('board.save', { company, day, time, title: title.trim() || 'Board meeting' }), READS);
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add meeting"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save}>
            Add
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Day">
          <DayPicker value={day} onChange={setDay} label="Day" />
        </Field>
        <Field label="Time">
          <Input className="vo-mono w-28" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time" placeholder="15:00" />
        </Field>
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" placeholder="Board meeting" />
        </Field>
      </div>
    </Dialog>
  );
}

function MeetingView({ m, edit }: { m: BoardMeeting; edit: boolean }): React.JSX.Element {
  const [note, setNote] = useState(m.note);
  useEffect(() => setNote(m.note), [m.id, m.note]);
  return (
    <div className="flex flex-col gap-6">
      {m.brief !== null ? (
        <div className="grid min-w-0 gap-6 md:grid-cols-2">
          {m.brief.sections.map((s) => (
            <Panel key={s.title} label={s.title} aside={m.brief?.by === 'agent' ? <AgentTag /> : undefined}>
              <ul className="flex list-disc flex-col gap-1.5 pl-4 text-[13px] leading-5">
                {s.points.map((p, i) => (
                  <li key={i} className="vo-wrap">
                    {p.text}
                  </li>
                ))}
              </ul>
            </Panel>
          ))}
        </div>
      ) : m.day < today() ? null : (
        <Panel>
          <div className="flex flex-wrap items-center gap-4 py-1">
            <StepTrack labels={m.brief_step.labels} at={m.brief_step.at} className="w-full max-w-[320px]" />
            <span className="flex-1" />
            {edit ? <AskAgent label="Brief now" size="md" state={m.agent?.board_brief} onAsk={askWith('board_brief', m.id)} reads={READS} /> : <AskStatus state={m.agent?.board_brief} />}
          </div>
        </Panel>
      )}
      <Panel label="Note">
        <div className="flex flex-col gap-2">
          <Textarea value={note} minRows={4} disabled={!edit} onChange={(e) => setNote(e.target.value)} aria-label="Board note" />
          {edit && note !== m.note && (
            <div className="flex justify-end">
              <Button size="sm" onClick={() => void act([], () => op('board.save', { meeting: m.id, note }), READS)}>
                Save
              </Button>
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}

export function BoardTab({ company }: { company: string }): React.JSX.Element {
  const me = useMe();
  const edit = allowed(me, 'portfolio:edit');
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState('');
  const live = useOp<{ meetings: BoardMeeting[] }>('board.list', { company }, READS, { name: 'board.list' });
  if (live.error !== null && live.data === null) return <LoadError message={live.error} onRetry={live.reload} />;
  if (live.data === null) return <Skeleton className="h-40 w-full" />;
  const list = live.data.meetings;
  const add = edit ? (
    <Button icon={CalendarPlus} onClick={() => setAdding(true)}>
      Add meeting
    </Button>
  ) : undefined;
  if (list.length === 0)
    return (
      <>
        <Empty icon={Presentation} title="No board meetings" action={add} />
        <AddMeeting company={company} open={adding} onClose={() => setAdding(false)} />
      </>
    );
  const current = list.find((m) => m.id === open) ?? list.find((m) => m.day >= today()) ?? list[0];
  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      <div className="flex flex-col gap-3">
        <Panel flush>
          <ul aria-label="Board meetings">
            {list.map((m) => (
              <li key={m.id} className="border-b border-[var(--vo-hair)] last:border-b-0">
                <button type="button" aria-current={current?.id === m.id ? 'true' : undefined} onClick={() => setOpen(m.id)} className={'vo-focus vo-tap flex min-h-[44px] w-full cursor-pointer items-center gap-3 px-4 py-2 text-left transition-colors duration-150 hover:bg-[var(--vo-hover)]' + (current?.id === m.id ? ' bg-[var(--vo-sunk)]' : '')}>
                  <span className="vo-mono vo-num w-20 shrink-0 text-[12px] text-[var(--vo-ink-2)]">{fmtDay(m.day)}</span>
                  <span className="min-w-0 flex-1 truncate">{m.title}</span>
                  {(m.brief !== null || m.day >= today()) && <StepTrack labels={m.brief_step.labels} at={m.brief_state === 'ready' ? 3 : m.brief_step.at} compact className="w-16" />}
                </button>
              </li>
            ))}
          </ul>
        </Panel>
        {add !== undefined && <div className="flex justify-end">{add}</div>}
      </div>
      {current !== undefined && <MeetingView m={current} edit={edit} />}
      <AddMeeting company={company} open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}
