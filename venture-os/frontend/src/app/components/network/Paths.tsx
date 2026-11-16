/**
 * Who knows a person or a company: the ranked paths as a PathGraph (member,
 * connector, target, strength on each edge), the paths as rows with the
 * weakest edge and last contact, and the intros already asked with their
 * StepTrack (Asked, Drafted, Sent, Made). The page owns the one black
 * button (Ask for intro); usePaths gives it the selected path and ask().
 */
import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Waypoints } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { Button, Empty, LoadError, Skeleton, StepTrack, Tip } from '../ui.tsx';
import { PathGraph } from '../charts.tsx';
import type { IntroPath } from '../charts.tsx';
import { op } from '../../lib/api.ts';
import { ago } from '../../lib/format.ts';
import { act, useOp } from '../../lib/live.ts';
import type { Live } from '../../lib/live.ts';
import { useMe } from '../../lib/auth.ts';
import { BAND_TIP, PATH_READS } from './parts.tsx';
import type { IntroView, PathView, PathsAnswer } from './types.ts';

export interface Target {
  person?: string | undefined;
  company?: string | undefined;
}

export interface PathsState {
  live: Live<PathsAnswer>;
  selected: number;
  setSelected: (i: number) => void;
  path: PathView | null;
  /** The one black button's word: "Ask for intro", or "Reach out" when you know them yourself. */
  askLabel: string;
  canAsk: boolean;
  asking: boolean;
  ask: () => Promise<void>;
}

/** The paths of a target and the ask on the selected one. */
export function usePaths(target: Target | null): PathsState {
  const me = useMe();
  const params = target === null ? {} : target.person !== undefined ? { person: target.person } : { company: target.company };
  const live = useOp<PathsAnswer>('network.paths', params, PATH_READS, { skip: target === null, keep: true });
  const [selected, setSelected] = useState(0);
  const [asking, setAsking] = useState(false);
  const key = JSON.stringify(params);
  useEffect(() => setSelected(0), [key]);
  const paths = live.data?.paths ?? [];
  const path = target === null ? null : (paths[selected] ?? paths[0] ?? null);
  const mine = path !== null && path.kind === 'direct' && path.member === me.member.id;
  const open = (live.data?.intros ?? []).some((i) => path !== null && i.target.id === path.target && (i.status === 'requested' || i.status === 'drafted') && i.requested_by?.id === me.member.id);
  const ask = async (): Promise<void> => {
    if (path === null || live.data === null) return;
    setAsking(true);
    await act([], () => op<IntroView>('intros.request', { target: path.target, via: path.member, connector: path.connector ?? '', company: live.data?.target.kind === 'company' ? live.data.target.id : '' }), PATH_READS);
    setAsking(false);
    live.reload();
  };
  return { live, selected, setSelected, path, askLabel: mine ? 'Reach out' : 'Ask for intro', canAsk: path !== null && !open && !asking, asking, ask };
}

function graphOf(paths: PathView[]): IntroPath[] {
  return paths.slice(0, 5).map((p) => ({
    nodes: p.nodes.map((n, i) => ({ id: (n.kind === 'member' ? 'm:' : 'p:') + n.id, label: n.name, kind: n.kind === 'member' ? 'member' : i === p.nodes.length - 1 ? 'target' : 'connector' })),
    strengths: p.edges.map((e) => e.score / 100),
  }));
}

const OUTCOMES: { value: 'made' | 'declined' | 'no_answer'; label: string }[] = [
  { value: 'made', label: 'Made' },
  { value: 'declined', label: 'Declined' },
  { value: 'no_answer', label: 'No reply' },
];

/** One intro with its StepTrack, and the outcome chips once the ask went out. */
export function IntroRow({ intro }: { intro: IntroView }): React.JSX.Element {
  const me = useMe();
  const [busy, setBusy] = useState('');
  const record = async (outcome: string): Promise<void> => {
    setBusy(outcome);
    await act([], () => op('intros.outcome', { intro: intro.id, outcome }), PATH_READS);
    setBusy('');
  };
  const via = intro.connector !== null ? intro.connector.name : (intro.via?.name ?? '');
  const asker = intro.requested_by !== null && intro.requested_by.id !== me.member.id ? intro.requested_by.name : '';
  return (
    <div className="flex min-w-0 flex-col gap-2 py-3">
      <div className="flex min-w-0 items-center gap-2 text-[13px]">
        <span className="vo-wrap min-w-0 flex-1 font-medium">{intro.target.name}</span>
        <span className="truncate text-[12px] text-[var(--vo-muted)]">{[via, asker].filter((x) => x !== '').join(', ')}</span>
      </div>
      <StepTrack labels={intro.steps.labels} at={intro.steps.at} />
      {intro.status === 'sent' && (
        <div className="flex flex-wrap gap-1.5">
          {OUTCOMES.map((o) => (
            <Button key={o.value} size="sm" busy={busy === o.value} onClick={() => void record(o.value)}>
              {o.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The graph, the path rows and the intros of one target. */
export function PathsView({ state, compact }: { state: PathsState; compact?: boolean | undefined }): React.JSX.Element {
  const { live, selected, setSelected } = state;
  const paths = live.data?.paths ?? [];
  const graph = useMemo(() => graphOf(paths), [paths]);
  if (live.error !== null && live.data === null) return <LoadError message={live.error} onRetry={live.reload} />;
  if (live.data === null) return <Skeleton className="h-40 w-full" />;
  const intros = live.data.intros.filter((i) => i.status !== 'cancelled').slice(0, 4);
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {paths.length === 0 ? (
        <Empty icon={Waypoints} title="No warm path yet" />
      ) : (
        <>
          <PathGraph paths={graph} selected={Math.min(selected, graph.length - 1)} onSelect={setSelected} height={compact === true ? 160 : undefined} />
          <div role="radiogroup" aria-label="Paths" className="flex min-w-0 flex-col">
            {paths.slice(0, 5).map((p, i) => {
              const on = i === Math.min(selected, paths.length - 1);
              return (
                <button key={p.nodes.map((n) => n.id).join('>')} type="button" role="radio" aria-checked={on} onClick={() => setSelected(i)} className={cn('vo-focus vo-tap flex h-9 min-w-0 items-center gap-2 rounded-[var(--vo-radius-sm)] px-2 text-left text-[13px] transition-colors duration-150', on ? 'bg-[var(--vo-active)] text-[var(--vo-ink)] hover:bg-[var(--vo-active-hover)]' : 'text-[var(--vo-ink-2)] hover:bg-[var(--vo-hover)] hover:text-[var(--vo-ink)]')}>
                  <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', on ? 'bg-[var(--vo-ink)]' : 'bg-[var(--vo-line-2)]')} />
                  <span className="flex min-w-0 flex-1 items-center gap-1 truncate">
                    {p.nodes.map((n, k) => (
                      <span key={n.id + k} className="inline-flex min-w-0 items-center gap-1">
                        {k > 0 && <ChevronRight size={12} aria-hidden className="shrink-0 text-[var(--vo-muted)]" />}
                        <span className={cn('truncate', k === 0 && 'font-medium')}>{n.name}</span>
                      </span>
                    ))}
                  </span>
                  <Tip text={BAND_TIP}>
                    <span className="vo-mono vo-num w-8 shrink-0 text-right text-[12px] text-[var(--vo-ink)]">{p.weakest}</span>
                  </Tip>
                  <span className="vo-mono vo-num w-20 shrink-0 text-right text-[12px] text-[var(--vo-muted)] max-sm:hidden">{ago(p.last_at)}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
      {intros.length > 0 && <div className="flex min-w-0 flex-col divide-y divide-[var(--vo-hair)] border-t border-[var(--vo-hair)]">{intros.map((i) => <IntroRow key={i.id} intro={i} />)}</div>}
    </div>
  );
}
