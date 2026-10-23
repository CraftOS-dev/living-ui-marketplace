/**
 * Requests to your AI agent: receipts to send, drawer sessions to review,
 * restock lists to draft and questions about the business, with what the
 * agent answered. New questions and restock lists start here; receipts and
 * reviews start from a sale and from the drawer.
 */
import { useState } from 'react';
import { ClipboardList, Inbox, MessageSquareText, Receipt, Send, Sparkles, Wallet } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api } from '../lib/api.ts';
import { when } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { href } from '../lib/router.ts';
import { useSession } from '../lib/session.tsx';
import type { AgentRequest, RequestKind, RequestStatus } from '../lib/types.ts';
import { DeleteButton } from '../components/DeleteButton.tsx';
import { Badge, Button, Empty, PageHeader, Panel, Segmented, textareaCls } from '../components/ui.tsx';
import type { Tone } from '../components/ui.tsx';

const KIND: Record<RequestKind, { label: string; icon: LucideIcon }> = {
  receipt: { label: 'Send a receipt', icon: Receipt },
  shift_review: { label: 'Review the drawer', icon: Wallet },
  restock: { label: 'Restock list', icon: ClipboardList },
  question: { label: 'Question', icon: MessageSquareText },
};

const STATUS: Record<RequestStatus, { label: string; tone: Tone; pulse?: boolean }> = {
  sent: { label: 'Waiting for your AI agent', tone: 'warn', pulse: true },
  working: { label: 'Working on it', tone: 'info', pulse: true },
  done: { label: 'Done', tone: 'good' },
  failed: { label: 'Could not do it', tone: 'bad' },
};

function RequestCard({ r }: { r: AgentRequest }): React.JSX.Element {
  const k = KIND[r.kind];
  const st = STATUS[r.status];
  const Icon = k.icon;
  return (
    <li className="px-3 py-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[var(--ps-r)] bg-[var(--ps-row)] text-[var(--ps-ink-2)]">
          <Icon size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-semibold">{r.title}</span>
            <Badge tone={st.tone} pulse={st.pulse === true}>
              {st.label}
            </Badge>
          </div>
          <p className="text-[12px] text-[var(--ps-muted)]">
            {k.label} &middot; {when(r.created)}
            {r.staff !== '' ? ' · asked by ' + r.staff : ''}
            {r.order !== '' && (
              <>
                {' · '}
                <a href={href('order', { id: r.order })} className="font-semibold hover:underline">
                  the sale
                </a>
              </>
            )}
            {r.shift !== '' && (
              <>
                {' · '}
                <a href={href('drawer', { id: r.shift })} className="font-semibold hover:underline">
                  the session
                </a>
              </>
            )}
          </p>
          {r.body !== '' && <p className="mt-1.5 whitespace-pre-wrap text-[13px]">{r.body}</p>}
          {r.result !== '' && (
            <div className={cn('mt-2 rounded-[var(--ps-r-md)] px-3 py-2', r.status === 'failed' ? 'bg-[var(--ps-red)]/10' : 'bg-[var(--ps-sand)] ps-on-sand')}>
              <p className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-[var(--ps-muted)]">
                <Sparkles size={12} />
                Your AI agent {r.status === 'failed' ? 'could not do it' : 'answered'} {when(r.updated)}
              </p>
              <p className={cn('whitespace-pre-wrap text-[13px]', r.kind === 'restock' && 'mono overflow-x-auto')}>{r.result}</p>
            </div>
          )}
        </div>
        <DeleteButton collection="requests" id={r.id} name={'the request "' + r.title + '"'} />
      </div>
    </li>
  );
}

export function RequestsPage(): React.JSX.Element {
  const { can } = useSession();
  const [status, setStatus] = useState<'' | RequestStatus>('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<'question' | 'restock' | null>(null);
  const list = useLive(() => api.requests({ status: status || undefined, limit: 100 }), ['requests'], [status]);
  const rows = list.data?.requests ?? [];

  const ask = async (kind: 'question' | 'restock'): Promise<void> => {
    setBusy(kind);
    try {
      const r = await api.ask(kind, kind === 'question' ? { body: text.trim() } : {});
      toast.success(r.asked ? 'Sent to your AI agent' : r.message);
      if (kind === 'question') setText('');
    } catch {
      // Shown by the transport.
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Requests to your AI agent"
        subtitle="Receipts, drawer reviews, restock lists and questions, with the answers"
        actions={
          can('manage_stock') ? (
            <Button icon={ClipboardList} loading={busy === 'restock'} onClick={() => void ask('restock')}>
              Draft a restock list
            </Button>
          ) : undefined
        }
      />
      {can('view_reports') && (
        <Panel className="mb-4" title="Ask about the business" subtitle="Your AI agent answers from the store's own sales, stock and customers">
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim().length >= 4) void ask('question');
            }}
          >
            <textarea className={textareaCls + ' flex-1'} rows={2} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder="How did this month compare with last month, and what sold best?" />
            <Button type="submit" variant="primary" icon={Send} loading={busy === 'question'} disabled={text.trim().length < 4} className="sm:self-end">
              Ask
            </Button>
          </form>
        </Panel>
      )}
      <div className="mb-3">
        <Segmented
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: '', label: 'All' },
            { value: 'sent', label: 'Waiting' },
            { value: 'working', label: 'Working' },
            { value: 'done', label: 'Done' },
            { value: 'failed', label: 'Could not do it' },
          ]}
        />
      </div>
      <Panel padded={false}>
        {list.loading && rows.length === 0 ? (
          <div className="py-10" />
        ) : rows.length === 0 ? (
          <Empty icon={Inbox} title="No requests" compact />
        ) : (
          <ul className="divide-y divide-[var(--ps-hair)]">
            {rows.map((r) => (
              <RequestCard key={r.id} r={r} />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
