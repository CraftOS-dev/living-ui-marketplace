/**
 * Founder updates of a company: one row per update with its StepTrack
 * (Received, Reading, Staged, Verified). Opening one shows every value
 * your AI agent staged beside its source snippet: verify one, fix one in
 * place, reject one; Verify all is the page's black button.
 */
import { useState } from 'react';
import { Check, FileText, Mail, Pencil, RotateCcw, Sparkle, X } from 'lucide-react';
import { AgentMark, AgentTag, Button, Citation, Empty, IconButton, Input, LoadError, More, Panel, Skeleton, StepTrack, Tag } from '../../components/ui.tsx';
import { Snip, periodLong, periodShort } from '../../components/portfolio/kit.tsx';
import { download, op } from '../../lib/api.ts';
import { allowed, useMe } from '../../lib/auth.ts';
import { fmtDay, dayOf } from '../../lib/format.ts';
import { act, patch, useOp } from '../../lib/live.ts';
import { setQuery } from '../../lib/router.ts';
import type { KpiValue, UpdateDetail, UpdateRow } from './types.ts';
import { AskAgent, AskStatus, askWith } from '../../components/agent.tsx';

export const UPDATE_READS = ['updates', 'kpi_values', 'agent_requests', 'files', 'file_texts', 'asks'];

export function UpdatesList({ company }: { company: string }): React.JSX.Element {
  const live = useOp<{ updates: UpdateRow[] }>('updates.list', { company }, UPDATE_READS, { name: 'updates.list', keep: true });
  if (live.error !== null && live.data === null) return <LoadError message={live.error} onRetry={live.reload} />;
  if (live.data === null) return <Skeleton className="h-40 w-full" />;
  const rows = live.data.updates;
  if (rows.length === 0) return <Empty icon={Mail} title="No updates yet" />;
  return (
    <Panel flush>
      <ul aria-label="Updates" className="flex flex-col">
        {rows.map((u) => (
          <li key={u.id} className="border-b border-[var(--vo-hair)] last:border-b-0">
            <button type="button" onClick={() => setQuery({ update: u.id })} className="vo-focus vo-tap grid min-h-[44px] w-full cursor-pointer grid-cols-[88px_minmax(0,1fr)] items-center gap-3 px-4 py-2 text-left transition-colors duration-150 hover:bg-[var(--vo-hover)] md:grid-cols-[88px_minmax(0,1fr)_84px_220px]">
              <span className="vo-mono vo-num text-[12px] text-[var(--vo-muted)]">{fmtDay(dayOf(u.received_at))}</span>
              <span className="flex min-w-0 items-center gap-2">
                {u.files > 0 && <FileText size={13} aria-label="With files" className="shrink-0 text-[var(--vo-muted)]" />}
                <span className="truncate">{u.subject || 'Update'}</span>
              </span>
              <span className="vo-mono vo-num hidden text-[12px] text-[var(--vo-ink-2)] md:block">{u.period_end !== '' ? periodLong(u.period_end) : ''}</span>
              <span className="col-span-2 md:col-span-1">{u.status === 'dismissed' ? <Tag tone="faint">Dismissed</Tag> : u.step !== null ? <StepTrack labels={u.step.labels} at={u.step.at === 3 ? 4 : u.step.at} compact /> : null}</span>
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** One value beside its source, with verify, fix and reject. */
function ValueRow({ v, edit }: { v: KpiValue; edit: boolean }): React.JSX.Element {
  const [fixing, setFixing] = useState(false);
  const [text, setText] = useState('');
  const staged = v.status === 'staged';
  const verify = (value?: string): void => {
    void act([patch(v.id, { status: 'verified' })], () => op('kpis.verify', value !== undefined ? { id: v.id, value } : { id: v.id }), UPDATE_READS).then((r) => {
      if (r !== null) setFixing(false);
    });
  };
  const reject = (): void => void act([patch(v.id, { status: 'rejected' })], () => op('kpis.reject', { id: v.id }), UPDATE_READS);
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 border-b border-[var(--vo-hair)] px-4 py-3 last:border-b-0 md:grid-cols-[150px_120px_minmax(0,1fr)_auto] md:items-center">
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium">{v.label}</span>
        <span className="vo-mono vo-num text-[12px] text-[var(--vo-muted)]">{v.months === 3 ? periodShort(v.period_end, 3) : periodLong(v.period_end)}</span>
      </span>
      {fixing ? (
        <span className="flex items-center gap-1.5 md:order-none">
          <Input autoFocus className="vo-mono h-8 w-28" aria-label={'Correct ' + v.label} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && text.trim() !== '' && verify(text.trim())} />
        </span>
      ) : (
        <span className={v.status === 'rejected' ? 'vo-mono vo-num text-right text-[15px] text-[var(--vo-muted)] line-through md:text-left' : staged ? 'vo-mono vo-num text-right text-[15px] underline decoration-dashed decoration-[var(--vo-line-2)] underline-offset-4 md:text-left' : 'vo-mono vo-num text-right text-[15px] md:text-left'}>{v.value_text}</span>
      )}
      <span className="col-span-2 flex min-w-0 flex-col gap-1 md:col-span-1">
        {v.snippet ? <Snip before={v.snippet.before} quote={v.snippet.quote} after={v.snippet.after} /> : v.quote !== '' ? <Snip before="" quote={v.quote} after="" /> : null}
        {(v.flags.length > 0 || v.forecast) && (
          <span className="flex flex-wrap gap-1.5">
            {v.forecast && <Tag>Forecast</Tag>}
            {v.flags.map((f) => (
              <Tag key={f.code} tone="warn" title={f.note}>
                {f.label}
              </Tag>
            ))}
          </span>
        )}
      </span>
      <span className="col-span-2 flex items-center justify-end gap-1 md:col-span-1">
        {v.snippet?.page !== undefined && v.snippet.file !== undefined && <Citation label={'p.' + v.snippet.page} quote={v.snippet.quote} />}
        {v.actor === 'agent' && <AgentTag />}
        {edit && staged && !fixing && (
          <>
            <IconButton icon={Pencil} label="Fix" onClick={() => (setText(''), setFixing(true))} />
            <IconButton icon={X} label="Reject" onClick={reject} />
            <IconButton icon={Check} label="Verify" onClick={() => verify()} />
          </>
        )}
        {fixing && (
          <>
            <Button size="sm" variant="ghost" onClick={() => setFixing(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={text.trim() === ''} onClick={() => verify(text.trim())}>
              Verify
            </Button>
          </>
        )}
        {v.status === 'verified' && <Tag tone="good">Verified</Tag>}
      </span>
    </li>
  );
}


export function UpdateView({ update }: { update: string }): React.JSX.Element {
  const me = useMe();
  const edit = allowed(me, 'portfolio:edit');
  const live = useOp<{ update: UpdateDetail }>('updates.get', { update }, UPDATE_READS, { name: 'updates.get' });
  if (live.error !== null && live.data === null) return <LoadError message={live.error} onRetry={live.reload} />;
  if (live.data === null) return <Skeleton className="h-64 w-full" />;
  const u = live.data.update;
  const values = u.values.filter((v) => v.status !== 'superseded').sort((a, b) => Number(a.forecast) - Number(b.forecast));
  const waiting = values.length === 0 && u.status === 'received' && u.company !== null;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-1 items-baseline gap-3">
          <span className="vo-mono vo-num shrink-0 text-[12px] text-[var(--vo-muted)]">{fmtDay(dayOf(u.received_at))}</span>
          <span className="vo-wrap min-w-0 text-[15px] font-semibold">{u.subject || 'Update'}</span>
        </div>
        {u.step !== null && <StepTrack labels={u.step.labels} at={u.step.at === 3 ? 4 : u.step.at} className="w-full max-w-[380px]" />}
      </div>
      {waiting ? (
        <Panel>
          <div className="flex flex-wrap items-center gap-3 py-2">
            {u.agent?.update_extract === undefined && <span className="min-w-0 flex-1 text-[13px] text-[var(--vo-ink-2)]">Not read yet. Your AI agent stages its numbers for you to verify when you ask.</span>}
            {edit ? <AskAgent label="Ask your AI agent" state={u.agent?.update_extract} onAsk={askWith('update_extract', u.id)} reads={UPDATE_READS} /> : <AskStatus state={u.agent?.update_extract} />}
          </div>
        </Panel>
      ) : values.length > 0 ? (
        <Panel flush>
          <ul aria-label="Values">
            {values.map((v) => (
              <ValueRow key={v.id} v={v} edit={edit} />
            ))}
          </ul>
        </Panel>
      ) : null}
      {(u.file_list.length > 0 || u.body.trim() !== '') && (
        <More label="Source">
          <div className="flex flex-col gap-3">
            {u.file_list.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {u.file_list.map((f) => (
                  <Button key={f.id} size="sm" icon={FileText} onClick={() => void download('files.download', { file: f.id }, 'open', f.name)}>
                    {f.name}
                  </Button>
                ))}
              </div>
            )}
            {u.body.trim() !== '' && <div className="vo-wrap vo-scroll max-h-[320px] overflow-y-auto whitespace-pre-wrap rounded-[var(--vo-radius-sm)] border border-[var(--vo-hair)] bg-[var(--vo-raised)] px-4 py-3 text-[13px] leading-5">{u.body}</div>}
          </div>
        </More>
      )}
    </div>
  );
}
