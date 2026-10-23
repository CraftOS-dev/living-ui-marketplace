/**
 * Working with your AI agent from any screen: asking a question, asking for
 * a piece of work (a trigger), following a request honestly (sent, on it,
 * done, or no agent connected yet), and confirming what it proposed.
 */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Check, MessageSquareText, Sparkles, X } from 'lucide-react';
import { cn, toast, useAgentRequest } from '../../kit/index.ts';
import { op } from '../lib/api.ts';
import { changed } from '../lib/live.ts';
import type { Collection } from '../lib/live.ts';
import { ago } from '../lib/format.ts';
import { Button, IconButton, Modal, Spinner, textareaCls } from './ui.tsx';

/* ------------------------------------------------------------ requests */

export type RequestKind =
  | 'papers_waiting'
  | 'ocr_requested'
  | 'claims_requested'
  | 'access_requested'
  | 'search_requested'
  | 'feed_review'
  | 'draft_requested'
  | 'support_check_requested'
  | 'responses_requested'
  | 'screening_requested'
  | 'references_requested'
  | 'experiment_requested';

/** Ask your AI agent for one piece of work. Returns the request id ('' when it could not be asked). */
export async function askAgent(kind: RequestKind, params: Record<string, unknown> = {}, label?: string): Promise<string> {
  try {
    const r = await op<{ request: string }>('agent.request', { kind, ...params });
    toast.success(label ?? 'Sent to your AI agent');
    changed('agent_requests', 'activity');
    return r.request;
  } catch {
    return '';
  }
}

/** One line that follows a request: sent, on it, done, or waiting for an agent to connect. */
export function RequestStatus({ id, className }: { id: string; className?: string }): React.JSX.Element | null {
  const { request } = useAgentRequest(id === '' ? null : id);
  const [old, setOld] = useState(false);
  useEffect(() => {
    if (request === null || request.status !== 'pending') return;
    const t = setTimeout(() => setOld(true), 25000);
    return () => clearTimeout(t);
  }, [request]);
  if (id === '' || request === null) return null;
  const base = cn('inline-flex items-center gap-1.5 text-[12px]', className);
  if (request.status === 'pending')
    return (
      <span className={cn(base, 'text-[var(--ro-muted)]')}>
        <Sparkles size={12} className="text-[var(--ro-accent-text)]" />
        {old ? 'Waiting for your AI agent to connect' : 'Sent to your AI agent'}
      </span>
    );
  if (request.status === 'claimed')
    return (
      <span className={cn(base, 'text-[var(--ro-ink-2)]')}>
        <Spinner size={11} className="text-[var(--ro-accent-text)]" />
        Your AI agent is on it
      </span>
    );
  if (request.status === 'done')
    return (
      <span className={cn(base, 'text-[var(--ro-green-text)]')} title={request.result}>
        <Check size={12} />
        Done {ago(request.updated)}
      </span>
    );
  return (
    <span className={cn(base, 'text-[var(--ro-red-text)]')} title={request.error}>
      <X size={12} />
      Not done{request.error !== '' ? ': ' + request.error.slice(0, 80) : ''}
    </span>
  );
}

/* --------------------------------------------------------------- asking */

export interface AskOptions {
  scope?: 'work' | 'collection' | 'project' | 'library';
  work?: string;
  project?: string;
  collection?: string;
  label?: string;
}

const AskCtx = createContext<{ open: (o: AskOptions) => void }>({ open: () => undefined });

export function useAsk(): { open: (o: AskOptions) => void } {
  return useContext(AskCtx);
}

export function AskProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [opts, setOpts] = useState<AskOptions | null>(null);
  const open = useCallback((o: AskOptions) => setOpts(o), []);
  return (
    <AskCtx.Provider value={{ open }}>
      {children}
      {opts !== null && <AskDialog opts={opts} onClose={() => setOpts(null)} />}
    </AskCtx.Provider>
  );
}

function AskDialog({ opts, onClose }: { opts: AskOptions; onClose: () => void }): React.JSX.Element {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const send = async (): Promise<void> => {
    if (q.trim() === '') return;
    setBusy(true);
    try {
      const r = await op<{ ask: { request: string } }>('asks.create', { question: q, scope: opts.scope ?? 'library', work: opts.work, project: opts.project, collection: opts.collection });
      setSent(r.ask.request);
      changed('asks');
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Ask your AI agent"
      description={opts.label}
      icon={MessageSquareText}
      footer={
        sent === null ? (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" icon={Sparkles} loading={busy} disabled={q.trim() === ''} onClick={() => void send()}>
              Ask
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        )
      }
    >
      {sent === null ? (
        <textarea
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void send();
          }}
          rows={4}
          placeholder="What do these papers say about sample sizes?"
          className={textareaCls}
          aria-label="Your question"
        />
      ) : (
        <div className="flex flex-col gap-2 py-2">
          <p className="text-[13px] font-semibold">Your question was sent.</p>
          <p className="text-[12px] text-[var(--ro-muted)]">The answer arrives with quotes you can open, under Your AI agent, Questions{opts.scope === 'work' ? ' and in the reader' : ''}.</p>
          <RequestStatus id={sent} />
        </div>
      )}
    </Modal>
  );
}

/* ----------------------------------------------------------- deciding */

/** Confirm and Reject for something your AI agent proposed (small, on the item itself). */
export function DecideButtons({ onConfirm, onReject, size = 'sm', compact = false }: { onConfirm: () => Promise<void>; onReject: () => Promise<void>; size?: 'sm' | 'md'; compact?: boolean }): React.JSX.Element {
  const [busy, setBusy] = useState<'c' | 'r' | null>(null);
  const run = async (which: 'c' | 'r'): Promise<void> => {
    setBusy(which);
    try {
      await (which === 'c' ? onConfirm() : onReject());
    } catch {
      /* toasted */
    } finally {
      setBusy(null);
    }
  };
  if (compact) {
    return (
      <span className="inline-flex items-center gap-0.5">
        <IconButton icon={Check} label="Confirm (C)" size={24} onClick={(e) => { e.stopPropagation(); void run('c'); }} className="text-[var(--ro-green-text)]" />
        <IconButton icon={X} label="Reject (R)" size={24} variant="danger" onClick={(e) => { e.stopPropagation(); void run('r'); }} />
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <Button size={size} icon={Check} loading={busy === 'c'} onClick={(e) => { e.stopPropagation(); void run('c'); }}>
        Confirm
      </Button>
      <Button size={size} variant="ghost" icon={X} loading={busy === 'r'} onClick={(e) => { e.stopPropagation(); void run('r'); }}>
        Reject
      </Button>
    </span>
  );
}

/** Decide nodes (claims, evidence, questions) and refresh what reads them. */
export async function decideNodes(ids: string[], status: 'researcher_confirmed' | 'researcher_rejected' | 'superseded'): Promise<void> {
  await op('nodes.decide', { nodes: ids, status });
  changed('nodes', 'relations');
}

export async function decideRelations(ids: string[], status: 'researcher_confirmed' | 'researcher_rejected'): Promise<void> {
  await op('relations.decide', { relations: ids, status });
  changed('relations');
}

export const AGENT_READS: Collection[] = ['nodes', 'relations', 'proposals', 'notes', 'works', 'asks', 'agent_requests'];
