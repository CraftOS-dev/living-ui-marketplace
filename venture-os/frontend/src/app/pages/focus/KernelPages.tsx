/**
 * The kernel's Next item pages, loaded on demand: #/next/proposal/:id (every
 * change of a proposal, accept all or some) and #/next/draft/:id (a draft in
 * full; correct it, approve and send, or cancel).
 */
import { useEffect, useState } from 'react';
import { Check, Send, X } from 'lucide-react';
import { Meter } from '../../components/charts.tsx';
import { NEXT_READS } from '../../components/next.tsx';
import { AgentTag, Button, Checkbox, Empty, Field, Input, LoadError, Notice, PageBody, PageHeader, Panel, Skeleton, Tag, Textarea } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import type { PageProps } from '../../lib/contract.ts';
import { humanize } from '../../lib/format.ts';
import { act, useOp } from '../../lib/live.ts';
import { navigate } from '../../lib/router.ts';
import { Lines, Quote } from './kernelCards.tsx';
import type { OutboundView, ProposalView } from './kernelCards.tsx';

/* -------------------------------------------------------------- pages */

/** #/next/proposal/:id: every change of a proposal, accept all or some. */
export function ProposalPage({ params }: PageProps): React.JSX.Element {
  const id = params['id'] ?? '';
  const live = useOp<{ proposal: ProposalView }>('proposals.get', { proposal: id }, ['proposals'], { name: 'next.proposal' });
  const [chosen, setChosen] = useState<number[] | null>(null);
  const [busy, setBusy] = useState('');
  const p = live.data?.proposal ?? null;
  const pending = p?.items.filter((i) => i.state === 'pending') ?? [];
  const sel = chosen ?? pending.map((i) => i.index);
  const decide = async (accept: boolean): Promise<void> => {
    setBusy(accept ? 'accept' : 'dismiss');
    const out = await act([], () => (accept ? op('proposals.accept', { proposal: id, items: sel.length === pending.length ? undefined : sel }) : op('proposals.dismiss', { proposal: id })), NEXT_READS);
    setBusy('');
    if (out !== null) navigate('/focus');
  };
  return (
    <>
      <PageHeader title={p?.title ?? 'Proposal'} back="#/focus">
        {p !== null && p.status === 'pending' && (
          <>
            <Button icon={X} busy={busy === 'dismiss'} onClick={() => void decide(false)}>
              Dismiss
            </Button>
            <Button variant="primary" icon={Check} busy={busy === 'accept'} disabled={sel.length === 0} onClick={() => void decide(true)}>
              Accept
            </Button>
          </>
        )}
      </PageHeader>
      <PageBody className="max-w-[880px]">
        {p === null ? (
          live.error !== null ? (
            <LoadError message={live.error} onRetry={live.reload} />
          ) : (
            <Skeleton className="h-40 w-full" />
          )
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <Tag>{p.kind_label}</Tag>
              {p.status !== 'pending' && <Tag tone="faint">{humanize(p.status)}</Tag>}
              {p.confidence !== null && <Meter value={p.confidence} max={1} label="Confidence" className="w-56" />}
            </div>
            {p.why !== '' && (
              <p className="vo-wrap flex items-start gap-2 text-[13px] leading-5">
                <AgentTag className="mt-0.5" />
                <span className="min-w-0">{p.why}</span>
              </p>
            )}
            <Quote e={p.evidence} />
            {p.items.map((it) => (
              <Panel
                key={it.index}
                label={p.items.length > 1 && it.label !== p.title ? it.label : undefined}
                aside={
                  it.state === 'pending' && pending.length > 1 ? (
                    <Checkbox checked={sel.includes(it.index)} onChange={(v) => setChosen(v ? [...sel, it.index] : sel.filter((x) => x !== it.index))} label="Apply" hideLabel />
                  ) : it.state !== 'pending' ? (
                    <Tag tone={it.state === 'applied' ? 'good' : 'faint'}>{humanize(it.state)}</Tag>
                  ) : undefined
                }
              >
                <div className="flex flex-col gap-2">
                  <Lines fields={it.fields} />
                  {it.error !== '' && <Notice tone="bad">{it.error}</Notice>}
                </div>
              </Panel>
            ))}
          </>
        )}
      </PageBody>
    </>
  );
}

/** #/next/draft/:id: a draft in full; correct it, then approve and send. */
export function DraftPage({ params }: PageProps): React.JSX.Element {
  const id = params['id'] ?? '';
  const live = useOp<{ message: OutboundView }>('outbound.get', { outbound: id }, ['outbound'], { name: 'next.draft' });
  const m = live.data?.message ?? null;
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState('');
  useEffect(() => {
    if (m !== null) {
      setSubject(m.subject);
      setBody(m.body);
    }
  }, [m]);
  const dirty = m !== null && (subject !== m.subject || body !== m.body);
  const save = async (): Promise<boolean> => {
    if (!dirty) return true;
    const out = await act([], () => op('outbound.update', { outbound: id, subject, body }), ['outbound']);
    return out !== null;
  };
  const send = async (): Promise<void> => {
    setBusy('send');
    if (await save()) {
      const out = await act([], () => op('outbound.approve', { outbound: id }), NEXT_READS);
      if (out !== null) navigate('/focus');
    }
    setBusy('');
  };
  const cancel = async (): Promise<void> => {
    setBusy('cancel');
    const out = await act([], () => op('outbound.cancel', { outbound: id }), NEXT_READS);
    setBusy('');
    if (out !== null) navigate('/focus');
  };
  const open = m !== null && (m.status === 'draft' || m.status === 'failed');
  return (
    <>
      <PageHeader title={m?.subject ?? 'Draft'} back="#/focus">
        {open && (
          <>
            <Button busy={busy === 'cancel'} onClick={() => void cancel()}>
              Cancel
            </Button>
            <Button variant="primary" icon={Send} busy={busy === 'send'} onClick={() => void send()}>
              Approve and send
            </Button>
          </>
        )}
      </PageHeader>
      <PageBody className="max-w-[760px]">
        {m === null ? (
          live.error !== null ? (
            <LoadError message={live.error} onRetry={live.reload} />
          ) : (
            <Skeleton className="h-60 w-full" />
          )
        ) : !open ? (
          <Empty icon={Send} title={humanize(m.status)} action={<Button onClick={() => navigate('/focus')}>Next</Button>} />
        ) : (
          <Panel>
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-1.5">
                {m.to.map((t) => (
                  <Tag key={t}>{t}</Tag>
                ))}
              </div>
              {m.error !== undefined && m.error !== '' && <Notice tone="bad">{m.error}</Notice>}
              <Field label="Subject">
                <Input value={subject} onChange={(e) => setSubject(e.target.value)} onBlur={() => void save()} aria-label="Subject" />
              </Field>
              <Field label="Message">
                <Textarea value={body} minRows={10} maxRows={30} onChange={(e) => setBody(e.target.value)} onBlur={() => void save()} aria-label="Message" />
              </Field>
            </div>
          </Panel>
        )}
      </PageBody>
    </>
  );
}
