/**
 * Work handed to CraftBot through the app's triggers: a status line that
 * follows the request live, and the "Ask CraftBot" box. With no agent
 * connected a request stays pending; we say so plainly. Every trigger only
 * proposes (Inbox) or writes drafts; people decide.
 */
import { useEffect, useState } from 'react';
import { Bot, CheckCircle2, Loader2, Sparkles, XCircle } from 'lucide-react';
import { Button, Dialog, Textarea, cn, fireAgentTrigger, toast, useAgentRequest } from '../../kit/index.ts';
import { getLang, t } from '../lib/i18n.ts';
import { Prose } from './ui.tsx';

/** Fire one of the app's triggers (see triggers.json); adds the reader's language. */
export async function handToCraftBot(trigger: string, params: Record<string, unknown>): Promise<string | null> {
  const r = await fireAgentTrigger(trigger, { lang: getLang(), ...params });
  if (!r.ok || r.requestId === undefined) {
    toast.error(r.message ?? t('CraftBot could not take this request.'));
    return null;
  }
  return r.requestId;
}

export function AgentStatus({
  requestId,
  workingText,
  doneText,
  onDone,
  compact = false,
}: {
  requestId: string | null;
  workingText?: string | undefined;
  doneText?: string | undefined;
  onDone?: (() => void) | undefined;
  compact?: boolean | undefined;
}): React.JSX.Element | null {
  const { request } = useAgentRequest(requestId);
  const [waitedLong, setWaitedLong] = useState(false);
  useEffect(() => {
    setWaitedLong(false);
    if (requestId === null) return;
    const timer = setTimeout(() => setWaitedLong(true), 20000);
    return () => clearTimeout(timer);
  }, [requestId]);
  useEffect(() => {
    if (request?.status === 'done') onDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.status]);
  if (requestId === null) return null;
  const status = request?.status ?? 'pending';
  const base = cn('flex items-start gap-2 text-[13px]', compact ? '' : 'border border-[var(--agent-app-border)] px-3 py-2');
  if (status === 'done') {
    return (
      <div className={base}>
        <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden />
        <div className="min-w-0">
          <div className="font-medium">{doneText ?? t('CraftBot finished.')}</div>
          {request?.result && !compact && <Prose className="mt-1 text-[var(--agent-app-text)]/85">{request.result}</Prose>}
        </div>
      </div>
    );
  }
  if (status === 'rejected') {
    return (
      <div className={base}>
        <XCircle size={15} className="mt-0.5 shrink-0 text-red-600" aria-hidden />
        <div>{request?.error ? t('CraftBot could not do this: {error}', { error: request.error }) : t('CraftBot could not do this.')}</div>
      </div>
    );
  }
  return (
    <div className={base}>
      <Loader2 size={15} className="mt-0.5 shrink-0 animate-spin text-[var(--agent-app-accent)]" aria-hidden />
      <div>
        {status === 'claimed'
          ? (workingText ?? t('CraftBot is working on it...'))
          : waitedLong
            ? t('Waiting for CraftBot. If nothing happens, check that CraftBot is running and connected to this app.')
            : t('Sent to CraftBot...')}
      </div>
    </div>
  );
}

export function AskCraftBot({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element {
  const [question, setQuestion] = useState('');
  const [requestId, setRequestId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const examples = [
    t('Which licences end in the next 6 months?'),
    t('Is the merchandise window for our series free in Taiwan next year?'),
    t('Which characters have no trademark in China for class 28?'),
    t('Which songs are released but not registered with JASRAC or NexTone?'),
  ];
  const ask = async (): Promise<void> => {
    if (question.trim().length < 3) return;
    setBusy(true);
    const id = await handToCraftBot('portfolio_question_asked', { question: question.trim() });
    setBusy(false);
    if (id !== null) setRequestId(id);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          onClose();
          setRequestId(null);
        }
      }}
      title={t('Ask CraftBot')}
      description={t('CraftBot reads your records and answers. It does not change anything.')}
      className="w-[min(94vw,38rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Close')}
          </Button>
          <Button onClick={() => void ask()} loading={busy} disabled={question.trim().length < 3}>
            <Sparkles size={14} aria-hidden /> {t('Ask')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Textarea
          rows={3}
          autoFocus
          value={question}
          placeholder={t('Ask in plain words')}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void ask();
          }}
        />
        {requestId === null && (
          <div className="flex flex-wrap gap-1.5">
            {examples.map((x) => (
              <button key={x} type="button" className="border border-[var(--agent-app-border)] px-2 py-1 text-left text-xs text-[var(--agent-app-muted)] hover:bg-[var(--agent-app-border)]/30" onClick={() => setQuestion(x)}>
                {x}
              </button>
            ))}
          </div>
        )}
        <AgentStatus requestId={requestId} workingText={t('CraftBot is reading your records...')} doneText={t('Answer')} />
      </div>
    </Dialog>
  );
}

export function CraftBotBadge(): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--agent-app-accent)]">
      <Bot size={12} aria-hidden /> CraftBot
    </span>
  );
}
