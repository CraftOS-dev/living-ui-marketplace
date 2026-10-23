/**
 * Ask your AI agent for a piece of work from a screen (send this invoice,
 * chase overdue invoices, draft reorders, reconcile a bank, review the
 * month). The request goes through agent.request, which checks the
 * person's rights, and its progress shows honestly: sent, working, done
 * with the agent's answer, or not done and why. A request nobody picks up
 * says so instead of spinning forever (the agent works while it is running).
 */
import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { cn, getPbClient, toast } from '../../kit/index.ts';
import { op } from '../lib/api.ts';
import type { Params } from '../lib/api.ts';
import { useOnChange } from '../lib/live.ts';
import { PillButton, StatusPill } from './ui.tsx';
import type { PillVariant } from './ui.tsx';

export type AgentRequestKind = 'reorder_review' | 'collections_requested' | 'doc_send_requested' | 'close_review_requested' | 'bank_lines_waiting';

interface RequestState {
  id: string;
  status: 'pending' | 'claimed' | 'done' | 'rejected';
  result: string;
  error: string;
}

/**
 * Follow one request in the platform's request queue (the page only reads
 * it; the live hub reloads it whenever the queue changes).
 */
export function useAgentRequest(id: string | null): RequestState | null {
  const [state, setState] = useState<RequestState | null>(null);
  const load = (): void => {
    if (id === null) return;
    getPbClient()
      .call((pb) => pb.collection('agent_requests').getOne<RequestState>(id, { requestKey: null }), { silent: true })
      .then((r) => setState({ id: r.id, status: r.status, result: r.result ?? '', error: r.error ?? '' }))
      .catch(() => undefined);
  };
  useEffect(() => {
    setState(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useOnChange(['agent_requests'], load);
  return state;
}

export function AskAgent({
  kind,
  params = {},
  label,
  variant = 'dark',
  align = 'end',
  disabled = false,
  onAsked,
  className,
  size = 'md',
}: {
  kind: AgentRequestKind;
  params?: Params | undefined;
  label: string;
  variant?: PillVariant | undefined;
  align?: 'start' | 'end' | undefined;
  disabled?: boolean | undefined;
  onAsked?: (() => void) | undefined;
  className?: string | undefined;
  size?: 'md' | 'sm' | undefined;
}): React.JSX.Element {
  const [requestId, setRequestId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const request = useAgentRequest(requestId);

  useEffect(() => {
    setSlow(false);
    if (request === null || request.status !== 'pending') return;
    const t = setTimeout(() => setSlow(true), 20000);
    return () => clearTimeout(t);
  }, [request]);

  const ask = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await op<{ request: string }>('agent.request', { kind, ...params });
      setRequestId(r.request);
      onAsked?.();
      toast.success('Sent to your AI agent');
    } catch {
      /* the message was shown */
    } finally {
      setBusy(false);
    }
  };

  const side = align === 'end' ? 'items-end text-right' : 'items-start text-left';
  const status = request?.status;
  if (requestId !== null && (status === undefined || status === 'pending' || status === 'claimed')) {
    return (
      <span className={cn('inline-flex flex-col gap-1', side, className)}>
        <StatusPill tone="info" pulse>
          {status === 'claimed' ? 'Your AI agent is on it' : 'Sent to your AI agent'}
        </StatusPill>
        {slow && <span className="max-w-xs text-[12px] text-[var(--erp-ink-2)]">It picks this up while your AI agent is running.</span>}
      </span>
    );
  }
  return (
    <span className={cn('inline-flex flex-col gap-1', side, className)}>
      <PillButton variant={variant} icon={Sparkles} dot={variant === 'dark'} size={size} loading={busy} disabled={disabled} onClick={() => void ask()}>
        {label}
      </PillButton>
      {status === 'done' && request !== null && request.result !== '' && <span className="max-w-sm text-[12px] leading-5 text-[var(--erp-ink-2)]">{request.result}</span>}
      {status === 'rejected' && request !== null && <span className="max-w-sm text-[12px] font-semibold text-[var(--erp-red-text)]">{request.error !== '' ? request.error : 'Your AI agent could not do it.'}</span>}
    </span>
  );
}
