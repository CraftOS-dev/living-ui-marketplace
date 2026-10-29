/**
 * One of the AI agent's proposals: what would change (current and proposed
 * value), the evidence quote, the source, the reason and how sure it is,
 * with Accept, Edit and Reject. Accepting applies the change as yours (and
 * can be undone like any change).
 */
import { useState } from 'react';
import { ArrowRight, Check, Mail, Pencil, Quote, X } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api, errMessage } from '../lib/api.ts';
import { PROPOSAL_KIND_LABEL, ago } from '../lib/format.ts';
import { go } from '../lib/router.ts';
import type { Proposal } from '../lib/types.ts';
import { AiChip, Confidence } from './controls.tsx';
import { Btn, area, input } from './ui.tsx';

export function ProposalCard({ p, showTarget = true, selected = false, onDecided }: { p: Proposal; showTarget?: boolean | undefined; selected?: boolean | undefined; onDecided?: (() => void) | undefined }): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<'' | 'accept' | 'reject'>('');
  const values = (p.payload['values'] as Record<string, unknown> | undefined) ?? {};
  const [edits, setEdits] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    if (p.payload.op === 'records.update') for (const k of Object.keys(values)) out[k] = Array.isArray(values[k]) ? (values[k] as string[]).join(', ') : String(values[k] ?? '');
    if (p.payload.op === 'emails.send' && p.email) {
      out['subject'] = p.email.subject;
      out['body'] = p.email.body;
      out['to'] = p.email.to;
    }
    return out;
  });
  const decide = async (decision: 'accept' | 'reject'): Promise<void> => {
    setBusy(decision);
    try {
      let e: Record<string, unknown> | undefined;
      if (decision === 'accept' && editing) {
        e = {};
        for (const k of Object.keys(edits)) {
          const orig = Array.isArray(values[k]) ? (values[k] as string[]).join(', ') : String(values[k] ?? '');
          if (p.payload.op === 'records.update' && edits[k] !== orig) e[k] = Array.isArray(values[k]) ? (edits[k] ?? '').split(',').map((x) => x.trim()).filter((x) => x !== '') : edits[k];
          if (p.payload.op === 'emails.send') e[k] = edits[k];
        }
      }
      await api.decide([p.id], decision, e);
      toast.success(decision === 'accept' ? (p.kind === 'email' ? 'Accepted: your AI agent sends it' : 'Applied') : 'Rejected');
      onDecided?.();
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy('');
    }
  };
  const target = (): void => {
    const o = p.object === 'emails' ? '' : p.object;
    if (o === 'people' || o === 'companies' || o === 'deals') go(o, { id: p.target });
  };
  return (
    <article className={cn('border bg-[var(--cr-card)] transition-colors', selected ? 'border-[var(--cr-accent)] shadow-[0_0_0_1px_var(--cr-accent)]' : 'border-[var(--cr-line)]')} data-proposal={p.id}>
      <header className="flex items-start gap-2 px-3 pb-1 pt-2.5">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
            <AiChip>{PROPOSAL_KIND_LABEL[p.kind] ?? p.kind_label}</AiChip>
            <span className="font-semibold">{p.title}</span>
          </p>
          <p className="mt-0.5 flex items-center gap-2 text-[11.5px] text-[var(--cr-muted)]">
            {showTarget && p.target_name && p.object !== 'emails' && (
              <button type="button" onClick={target} className="inline-flex items-center gap-0.5 font-semibold text-[var(--cr-ink-2)] hover:underline">
                {p.target_name} <ArrowRight size={11} />
              </button>
            )}
            <span>{ago(p.created)}</span>
            {p.confidence !== '' && (
              <span className="inline-flex items-center gap-1">
                <Confidence value={p.confidence} /> {p.confidence}
              </span>
            )}
          </p>
        </div>
      </header>
      <div className="px-3 pb-2.5">
        {p.changes.length > 0 && !editing && (
          <ul className="mt-1 flex flex-col gap-1">
            {p.changes.map((c) => (
              <li key={c.field} className="grid grid-cols-[96px_minmax(0,1fr)] items-baseline gap-2 text-[12.5px]">
                <span className="text-[12px] text-[var(--cr-muted)]">{c.label}</span>
                <span className="flex min-w-0 flex-wrap items-baseline gap-1.5">
                  {c.from !== '' && <span className="truncate text-[var(--cr-muted)] line-through">{c.from}</span>}
                  {c.from !== '' && <ArrowRight size={11} className="shrink-0 text-[var(--cr-muted)]" />}
                  <span className="truncate font-semibold">{c.to || 'empty'}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {editing && p.payload.op === 'records.update' && (
          <div className="mt-1 flex flex-col gap-1.5">
            {Object.keys(edits).map((k) => (
              <label key={k} className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-2 text-[12.5px]">
                <span className="text-[12px] text-[var(--cr-muted)]">{p.changes.find((c) => c.field === k)?.label ?? k}</span>
                <input value={edits[k] ?? ''} onChange={(e) => setEdits({ ...edits, [k]: e.target.value })} className={input} />
              </label>
            ))}
          </div>
        )}
        {p.kind === 'email' && p.email && (
          <div className="mt-1 border border-[var(--cr-hair)] bg-[var(--cr-row)] px-2.5 py-2 text-[12.5px]">
            {editing ? (
              <div className="flex flex-col gap-1.5">
                <input value={edits['to'] ?? ''} onChange={(e) => setEdits({ ...edits, to: e.target.value })} className={input} aria-label="To" />
                <input value={edits['subject'] ?? ''} onChange={(e) => setEdits({ ...edits, subject: e.target.value })} className={input} aria-label="Subject" />
                <textarea value={edits['body'] ?? ''} onChange={(e) => setEdits({ ...edits, body: e.target.value })} rows={6} className={area} aria-label="Body" />
              </div>
            ) : (
              <>
                <p className="flex items-center gap-1.5 text-[12px] text-[var(--cr-ink-2)]">
                  <Mail size={12} /> To {p.email.to}
                </p>
                <p className="mt-1 font-semibold">{p.email.subject}</p>
                <p className="cr-prose mt-1 line-clamp-6 text-[var(--cr-ink-2)]">{p.email.body}</p>
              </>
            )}
          </div>
        )}
        {p.evidence !== '' && (
          <blockquote className="mt-2 flex gap-1.5 border-l-2 border-[var(--cr-accent)] pl-2 text-[12.5px] italic leading-[18px] text-[var(--cr-ink-2)]">
            <Quote size={11} className="mt-[3px] shrink-0 not-italic text-[var(--cr-accent-text)]" />
            <span>{p.evidence}</span>
          </blockquote>
        )}
        {(p.reason !== '' || p.source !== '') && (
          <p className="mt-1.5 text-[12px] leading-[17px] text-[var(--cr-ink-2)]">
            {p.reason}
            {p.source !== '' && (
              <span className="text-[var(--cr-muted)]">
                {p.reason !== '' && ' · '}
                {/^https?:\/\//.test(p.source) ? (
                  <a href={p.source} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
                    {p.source.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)}
                  </a>
                ) : (
                  p.source
                )}
              </span>
            )}
          </p>
        )}
        <div className="mt-2.5 flex items-center gap-1.5">
          <Btn size="xs" variant="primary" icon={Check} loading={busy === 'accept'} onClick={() => void decide('accept')}>
            {editing ? 'Accept edited' : 'Accept'}
          </Btn>
          {(p.payload.op === 'records.update' || p.kind === 'email') && (
            <Btn size="xs" icon={Pencil} onClick={() => setEditing(!editing)}>
              {editing ? 'Cancel edit' : 'Edit'}
            </Btn>
          )}
          <Btn size="xs" variant="ghost" icon={X} loading={busy === 'reject'} onClick={() => void decide('reject')}>
            Reject
          </Btn>
        </div>
      </div>
    </article>
  );
}
