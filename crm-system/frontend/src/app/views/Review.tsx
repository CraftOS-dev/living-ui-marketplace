/**
 * Review: what the AI agent proposed and you decide.
 *
 * Waiting: proposals grouped by record, each with the current and proposed
 * values, the evidence and the reason; J/K move, Y accepts, N rejects.
 * Emails: what is queued for the AI agent to send, and what failed (open it
 * in your mail app instead). History: decided proposals with the acceptance
 * rate per kind of change, next to the switch that makes a kind automatic
 * once you trust it.
 */
import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Check, CheckCheck, ClipboardCheck, Mail, Minus, Pencil, RotateCcw, Send, ShieldCheck, Sparkles, X } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api, errMessage } from '../lib/api.ts';
import { PROPOSAL_KIND_LABEL, ago } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { go, setQuery } from '../lib/router.ts';
import { useApp, useReportScreen } from '../lib/store.tsx';
import type { Proposal } from '../lib/types.ts';
import { useDialogs } from '../components/dialogs.tsx';
import { Tabs } from '../components/controls.tsx';
import { ProposalCard } from '../components/Proposal.tsx';
import { Btn, Chip, Empty, Spinner, Toggle, useConfirm } from '../components/ui.tsx';

function Waiting(): React.JSX.Element {
  const live = useLive(() => api.proposals({ status: 'pending' }), ['proposals', 'people', 'companies', 'deals', 'emails'], [], 200);
  const [active, setActive] = useState('');
  const [confirmEl, confirm] = useConfirm();
  const list = useMemo(() => live.data?.proposals ?? [], [live.data]);
  useReportScreen('review', active ? { type: 'proposal', id: active } : null);
  const groups = useMemo(() => {
    const m = new Map<string, Proposal[]>();
    for (const p of list) {
      const k = p.object + ':' + p.target;
      const l = m.get(k) ?? [];
      l.push(p);
      m.set(k, l);
    }
    return [...m.values()];
  }, [list]);
  const flat = groups.flat();
  useEffect(() => {
    if (flat.length > 0 && !flat.some((p) => p.id === active)) setActive(flat[0]!.id);
  }, [flat, active]);
  useEffect(() => {
    const on = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
      if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector('[role="dialog"]') !== null) return;
      const i = flat.findIndex((p) => p.id === active);
      if (e.key === 'j' || e.key === 'k') {
        e.preventDefault();
        const n = flat[Math.max(0, Math.min(flat.length - 1, e.key === 'j' ? i + 1 : i - 1))];
        if (n) {
          setActive(n.id);
          document.querySelector(`[data-proposal="${n.id}"]`)?.scrollIntoView({ block: 'nearest' });
        }
      } else if ((e.key === 'y' || e.key === 'n') && flat[i]) {
        e.preventDefault();
        const p = flat[i]!;
        api
          .decide([p.id], e.key === 'y' ? 'accept' : 'reject')
          .then(() => toast.success((e.key === 'y' ? 'Accepted: ' : 'Rejected: ') + p.title))
          .catch((err: unknown) => toast.error(errMessage(err)));
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });
  if (live.data === null)
    return (
      <div className="flex h-40 items-center justify-center">
        <Spinner />
      </div>
    );
  if (list.length === 0)
    return (
      <Empty icon={ShieldCheck} title="Nothing waiting for you">
        When your AI agent wants to change something you entered, move or close a deal, merge, delete or send an email, it asks here first, with its evidence.
      </Empty>
    );
  const sure = list.filter((p) => p.confidence === 'high' && p.kind !== 'email' && p.kind !== 'delete' && p.kind !== 'merge');
  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-5 px-4 py-4">
      {confirmEl}
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <span className="text-[var(--cr-ink-2)]">
          <b className="num">{list.length}</b> waiting across <b className="num">{groups.length}</b> record{groups.length === 1 ? '' : 's'}
        </span>
        <span className="flex-1" />
        {sure.length > 0 && (
          <Btn
            size="sm"
            icon={CheckCheck}
            onClick={() =>
              void confirm(sure.length + ' high-confidence changes (field updates, stage moves, values) are applied. Emails, merges and deletes stay for you to look at.', 'Accept the sure ones?', 'Accept ' + sure.length).then((ok) => {
                if (ok)
                  api
                    .decide(
                      sure.map((p) => p.id),
                      'accept',
                    )
                    .then((r) => toast.success('Accepted ' + r.decided.length + (r.failed.length ? ', ' + r.failed.length + ' could not apply' : '')))
                    .catch((err: unknown) => toast.error(errMessage(err)));
              })
            }
          >
            Accept the {sure.length} sure ones
          </Btn>
        )}
      </div>
      {groups.map((g) => {
        const first = g[0]!;
        const o = first.object === 'emails' ? '' : first.object;
        return (
          <section key={first.object + first.target} className="cr-rise">
            <h3 className="mb-1.5 flex items-center gap-2 text-[12.5px] font-bold">
              {first.object === 'emails' ? <Mail size={13} className="text-[var(--cr-ink-2)]" /> : <Sparkles size={13} className="text-[var(--cr-accent-text)]" />}
              {o ? (
                <button type="button" onClick={() => go(o as 'people', { id: first.target })} className="inline-flex items-center gap-1 hover:underline">
                  {first.target_name || 'A record'} <ArrowUpRight size={12} />
                </button>
              ) : (
                'Emails to send'
              )}
              <span className="num font-normal text-[var(--cr-muted)]">{g.length}</span>
            </h3>
            <div className="flex flex-col gap-2">
              {g.map((p) => (
                <div key={p.id} onClick={() => setActive(p.id)}>
                  <ProposalCard p={p} showTarget={false} selected={p.id === active} />
                </div>
              ))}
            </div>
          </section>
        );
      })}
      <p className="pb-2 text-center text-[11.5px] text-[var(--cr-muted)]">
        <b>J K</b> move · <b>Y</b> accept · <b>N</b> reject · accepted changes can be undone in Activity
      </p>
    </div>
  );
}

function Emails(): React.JSX.Element {
  const live = useLive(() => Promise.all([api.emails({ status: 'queued' }), api.emails({ status: 'sending' }), api.emails({ status: 'failed' }), api.emails({ status: 'sent' })]), ['emails'], [], 200);
  const dlg = useDialogs();
  if (live.data === null)
    return (
      <div className="flex h-40 items-center justify-center">
        <Spinner />
      </div>
    );
  const [queued, sending, failed, sent] = live.data;
  const waiting = [...(queued?.emails ?? []), ...(sending?.emails ?? [])];
  const rows = [...(failed?.emails ?? []), ...waiting, ...(sent?.emails ?? []).slice(0, 20)];
  if (rows.length === 0)
    return (
      <Empty icon={Send} title="No emails yet">
        Emails you send from a person or deal go to your AI agent, which sends them from your email account and logs them on the record.
      </Empty>
    );
  return (
    <ul className="mx-auto w-full max-w-[880px] divide-y divide-[var(--cr-hair)] px-4 py-3">
      {rows.map((m) => (
        <li key={m.id} className="flex items-start gap-3 py-2.5">
          <span className={cn('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-[6px]', m.status === 'failed' ? 'bg-[var(--cr-neg-soft)] text-[var(--cr-neg-text)]' : m.status === 'sent' ? 'bg-[var(--cr-pos-soft)] text-[var(--cr-pos-text)]' : 'bg-[var(--cr-accent-soft)] text-[var(--cr-accent-text)]')}>
            {m.status === 'sent' ? <Check size={14} /> : m.status === 'failed' ? <X size={14} /> : <Send size={13} />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
              <span className="font-semibold">{m.subject || '(no subject)'}</span>
              <span className="text-[var(--cr-muted)]">to {m.to}</span>
              <Chip tone={m.status === 'sent' ? 'pos' : m.status === 'failed' ? 'neg' : 'accent'}>{m.status === 'queued' ? 'waiting for your AI agent' : m.status}</Chip>
            </p>
            {m.status === 'failed' && <p className="mt-0.5 text-[12px] text-[var(--cr-neg-text)]">{m.error}</p>}
            <p className="mt-0.5 line-clamp-2 text-[12px] text-[var(--cr-ink-2)]">{m.body}</p>
          </div>
          <span className="shrink-0 text-[11.5px] text-[var(--cr-muted)]">{ago(m.sent_at || m.queued_at || m.created)}</span>
          {m.status === 'failed' && (
            <div className="flex shrink-0 gap-1.5">
              <Btn size="xs" icon={Pencil} onClick={() => dlg.openEmail(m.person ? { person: m.person, deal: m.deal } : {}, m)}>
                Edit
              </Btn>
              <Btn size="xs" icon={RotateCcw} onClick={() => void api.sendEmail(m.id).then(() => toast.success('Sent to your AI agent again')).catch((err: unknown) => toast.error(errMessage(err)))}>
                Retry
              </Btn>
              <a href={'mailto:' + encodeURIComponent(m.to) + '?subject=' + encodeURIComponent(m.subject) + '&body=' + encodeURIComponent(m.body)} className="inline-flex h-6 items-center rounded-[5px] border border-[var(--cr-line)] px-2 text-[11.5px] font-semibold hover:bg-[var(--cr-row)]">
                Mail app
              </a>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function History(): React.JSX.Element {
  const app = useApp();
  const live = useLive(() => Promise.all([api.proposals({}), api.proposalStats()]), ['proposals', 'settings'], [], 300);
  if (live.data === null)
    return (
      <div className="flex h-40 items-center justify-center">
        <Spinner />
      </div>
    );
  const [list, stats] = live.data;
  const decided = list.proposals.filter((p) => p.status !== 'pending').slice(0, 100);
  const pol = app.settings?.policy;
  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-5 px-4 py-4">
      <section>
        <h3 className="mb-1 text-[13px] font-bold">How often you accept what it proposes</h3>
        <p className="mb-2 text-[12px] text-[var(--cr-muted)]">Over the last 90 days. When you rarely change or reject a kind of proposal, let your AI agent do it directly: it is still logged and can be undone.</p>
        <div className="overflow-hidden rounded-[7px] border border-[var(--cr-line)]">
          <table className="cr-table">
            <thead>
              <tr>
                <th>Kind of change</th>
                <th className="r">Accepted</th>
                <th className="r">Edited</th>
                <th className="r">Rejected</th>
                <th className="w-[180px]">Rate</th>
                <th className="w-[120px]">Automatic</th>
              </tr>
            </thead>
            <tbody>
              {stats.kinds.map((k) => (
                <tr key={k.kind}>
                  <td className="font-semibold">{k.label}</td>
                  <td className="r num">{k.accepted}</td>
                  <td className="r num">{k.edited}</td>
                  <td className="r num">{k.rejected}</td>
                  <td>
                    {k.rate === null ? (
                      <span className="text-[12px] text-[var(--cr-muted)]">no decisions yet</span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <span className="h-1.5 w-20 overflow-hidden rounded-full bg-[var(--cr-row-hover)]">
                          <span className="cr-grow-x block h-full rounded-full" style={{ width: k.rate + '%', background: k.rate >= 85 ? 'var(--cr-pos)' : k.rate >= 60 ? 'var(--cr-warn)' : 'var(--cr-neg)' }} />
                        </span>
                        <span className="num text-[12px] font-semibold">{k.rate}%</span>
                      </span>
                    )}
                  </td>
                  <td>
                    <span className="flex items-center gap-2 text-[12px]">
                      <Toggle checked={pol?.autonomy[k.kind] === 'auto'} label={'Let the AI agent do it: ' + k.label} onChange={(v) => void api.updatePolicy({ [k.kind]: v ? 'auto' : 'propose' }).then(() => toast.success(v ? k.label + ': automatic' : k.label + ': proposed first')).catch((err: unknown) => toast.error(errMessage(err)))} />
                      {pol?.autonomy[k.kind] === 'auto' ? 'Automatic' : 'Ask me'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section>
        <h3 className="mb-2 text-[13px] font-bold">Decided</h3>
        {decided.length === 0 ? (
          <p className="text-[12.5px] text-[var(--cr-muted)]">Nothing decided yet.</p>
        ) : (
          <ul className="divide-y divide-[var(--cr-hair)] rounded-[7px] border border-[var(--cr-line)]">
            {decided.map((p) => (
              <li key={p.id} className="flex items-center gap-2.5 px-3 py-2 text-[12.5px]">
                <span className={cn('flex size-5 shrink-0 items-center justify-center rounded-full', p.status === 'rejected' ? 'bg-[var(--cr-row-hover)] text-[var(--cr-muted)]' : 'bg-[var(--cr-pos-soft)] text-[var(--cr-pos-text)]')} title={p.status}>
                  {p.status === 'rejected' ? <Minus size={11} /> : p.status === 'edited' ? <Pencil size={10} /> : <Check size={11} />}
                </span>
                <span className="min-w-0 flex-1 truncate">{p.title}</span>
                <Chip>{PROPOSAL_KIND_LABEL[p.kind] ?? p.kind}</Chip>
                <span className="w-20 shrink-0 text-right text-[11.5px] text-[var(--cr-muted)]">{ago(p.decided_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function ReviewView({ q }: { q: Record<string, string> }): React.JSX.Element {
  const app = useApp();
  const tab = q['tab'] === 'emails' || q['tab'] === 'history' ? q['tab'] : 'waiting';
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-stretch gap-4 border-b border-[var(--cr-line)] px-4">
        <Tabs
          value={tab}
          onChange={(v) => setQuery({ tab: v === 'waiting' ? undefined : v }, false)}
          tabs={[
            { value: 'waiting', label: 'Waiting for you', count: app.summary?.proposals },
            { value: 'emails', label: 'Emails', count: (app.summary?.emails_failed ?? 0) + (app.summary?.emails_queued ?? 0) },
            { value: 'history', label: 'History and trust' },
          ]}
        />
        <span className="flex-1" />
        <span className="hidden items-center gap-1.5 text-[12px] text-[var(--cr-muted)] md:flex">
          <ClipboardCheck size={13} /> Your AI agent proposes; you decide
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{tab === 'waiting' ? <Waiting /> : tab === 'emails' ? <Emails /> : <History />}</div>
    </div>
  );
}
