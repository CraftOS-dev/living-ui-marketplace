/**
 * Ask the AI agent from the app (trigger plane), shown honestly: sent, working,
 * done with its answer, or refused. A request nobody picks up says so
 * instead of spinning forever (the agent works while it is running).
 */
import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { cn, fireAgentTrigger, toast, useAgentRequest } from '../../kit/index.ts';
import { PillButton, StatusPill } from './ui.tsx';

export function AskAgent({
  trigger,
  label,
  params = {},
  variant = 'dark',
  align = 'end',
  disabled = false,
  onAsked,
  className,
}: {
  trigger: string;
  label: string;
  params?: Record<string, string | number | boolean>;
  variant?: 'dark' | 'light' | 'accent';
  align?: 'start' | 'end';
  disabled?: boolean;
  onAsked?: () => void;
  className?: string;
}): React.JSX.Element {
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
    const r = await fireAgentTrigger(trigger, params);
    setBusy(false);
    if (r.ok && r.requestId !== undefined) {
      setRequestId(r.requestId);
      onAsked?.();
    } else toast.error(r.message ?? 'Your AI agent could not be asked right now');
  };

  const status = request?.status;
  const side = align === 'end' ? 'items-end text-right' : 'items-start text-left';
  if (status === 'pending' || status === 'claimed') {
    return (
      <span className={cn('inline-flex flex-col gap-1', side, className)}>
        <StatusPill tone="info" pulse>
          {status === 'pending' ? 'Sent to your AI agent' : 'Your AI agent is on it'}
        </StatusPill>
        {slow && status === 'pending' && <span className="max-w-xs text-[12px] text-[var(--iv-ink-2)]">It picks this up while your AI agent is running.</span>}
      </span>
    );
  }
  return (
    <span className={cn('inline-flex flex-col gap-1', side, className)}>
      <PillButton variant={variant} icon={Sparkles} dot={variant === 'dark'} loading={busy} disabled={disabled} onClick={() => void ask()}>
        {label}
      </PillButton>
      {status === 'done' && request !== null && request.result !== '' && <span className="max-w-xs text-[12px] text-[var(--iv-ink-2)]">{request.result}</span>}
      {status === 'rejected' && request !== null && <span className="max-w-xs text-[12px] font-semibold text-[var(--iv-red-text)]">{request.error || 'Your AI agent could not do it.'}</span>}
    </span>
  );
}
