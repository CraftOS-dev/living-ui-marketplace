/**
 * Ask the AI agent from the app (trigger plane), shown honestly: sent, working,
 * done with its answer, or refused. A request nobody picks up says so
 * instead of spinning forever (the agent works while it is running).
 */
import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { fireAgentTrigger, toast, useAgentRequest } from '../../kit/index.ts';
import { PillButton, StatusPill } from './ui.tsx';

export function AskAgent({ trigger, label }: { trigger: string; label: string }): React.JSX.Element {
  const [requestId, setRequestId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { request } = useAgentRequest(requestId);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    setSlow(false);
    if (request === null || request.status !== 'pending') return;
    const t = setTimeout(() => setSlow(true), 20000);
    return () => clearTimeout(t);
  }, [request]);

  const ask = async (): Promise<void> => {
    setBusy(true);
    const r = await fireAgentTrigger(trigger, {});
    setBusy(false);
    if (r.ok && r.requestId !== undefined) setRequestId(r.requestId);
    else toast.error(r.message ?? 'Your AI agent could not be asked right now');
  };

  const status = request?.status;
  if (status === 'pending' || status === 'claimed') {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <StatusPill tone="info" pulse>
          {status === 'pending' ? 'Sent to your AI agent' : 'Your AI agent is on it'}
        </StatusPill>
        {slow && status === 'pending' && <span className="text-[12px] text-[var(--et-ink-2)]">It picks this up while your AI agent is running.</span>}
      </span>
    );
  }
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <PillButton variant="dark" icon={Sparkles} dot loading={busy} onClick={() => void ask()}>
        {label}
      </PillButton>
      {status === 'done' && request !== null && request.result !== '' && <span className="max-w-xs text-right text-[12px] text-[var(--et-ink-2)]">{request.result}</span>}
      {status === 'rejected' && request !== null && <span className="text-[12px] font-semibold text-[var(--et-red-text)]">{request.error || 'Your AI agent could not do it.'}</span>}
    </span>
  );
}
