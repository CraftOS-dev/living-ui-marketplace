/**
 * Flow insights, the Kanban measures that matter, split between the agent
 * (accent) and you (ink), with the agent's report card (runs, approval and
 * first-pass rates, what went wrong): work in progress and how long each piece has sat
 * (aging WIP, against the 50th and 85th percentile of past cycle times),
 * cycle time per finished card with its percentiles, weekly throughput, and
 * cumulative flow. Percentiles, not averages: cycle times are skewed.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { AgentAvatar, Empty, MenuButton, Segmented, Select, Spinner } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { num, pct } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import type { Flow } from '../lib/types.ts';

const AGENT = 'var(--kb-accent)';
const YOU = 'var(--kb-ink-2)';

function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export function InsightsPage(): React.JSX.Element {
  const app = useApp();
  const [board, setBoard] = useState<string>(app.lastBoard || '');
  const [days, setDays] = useState('30');
  useEffect(() => {
    if (board !== '' || app.boards.length === 0) return;
    if (app.lastBoard !== '' && app.boards.some((b) => b.id === app.lastBoard)) setBoard(app.lastBoard);
    else setBoard([...app.boards].sort((a, z) => (z.stats?.cards ?? 0) - (a.stats?.cards ?? 0))[0]!.id);
  }, [app.boards, app.lastBoard, board]);
  useEffect(() => {
    void api.reportUi({ view: 'insights', board }).catch(() => undefined);
  }, [board]);
  const live = useLive(() => api.flow(board === 'all' || board === '' ? undefined : board, Number(days)), ['cards', 'runs'], [board, days], 800);
  const f = live.data;
  return (
    <div className="flex h-full min-w-0 flex-col">
      <header className="flex min-h-[52px] shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--kb-hair)] px-3 py-2 md:px-6">
        <MenuButton />
        <h1 className="text-[15px] font-semibold">Insights</h1>
        <span className="flex-1" />
        <div className="flex w-full items-center gap-2 sm:w-auto">
        <Select aria-label="Board" value={board} onChange={(e) => setBoard(e.target.value)} className="min-w-0 flex-1 sm:w-[200px] sm:flex-none">
          {app.boards.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
          <option value="all">All boards</option>
        </Select>
        <Segmented size="sm" label="Window" value={days} onChange={setDays} options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }]} />
        </div>
      </header>
      <div className="kb-scroll min-h-0 flex-1 overflow-y-auto">
        {f === null ? (
          <div className="flex h-60 items-center justify-center text-[var(--kb-muted)]">
            <Spinner size={18} />
          </div>
        ) : (
          <div className="mx-auto flex max-w-[1180px] flex-col gap-4 px-3 py-4 md:px-6 md:py-5">
            <div className="flex items-center gap-4 text-[12px] text-[var(--kb-muted)]">
              <Legend color={AGENT} label="Agent" />
              <Legend color={YOU} label="You" />
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Kpi label="In progress now" value={String(f.kpis.wip)} hint={`${f.kpis.in_review} waiting for your review`} />
              <Kpi label={`Finished in ${f.days} days`} value={String(f.kpis.throughput)} hint={f.kpis.throughput > 0 ? `${pct(f.kpis.by_agent / f.kpis.throughput)} by the agent` : 'nothing finished yet'} />
              <Kpi label="Cycle time, median" value={f.kpis.cycle_p50 === null ? '–' : `${num(f.kpis.cycle_p50)} d`} hint={f.kpis.cycle_p85 === null ? 'start to done' : `85% within ${num(f.kpis.cycle_p85)} d`} />
              <Kpi label="Review wait, median" value={f.kpis.review_wait_hours === null ? '–' : `${num(f.kpis.review_wait_hours)} h`} hint={`first-pass approval ${pct(f.kpis.first_pass_rate)}`} />
            </div>
            <AgentCard f={f} />
            <div className="grid gap-3 lg:grid-cols-2">
              <Panel title="Aging work in progress" hint="Each dot is a card in progress, by how long it has been going. Above the 85th percentile line it is taking longer than most cards did.">
                <Aging f={f} />
              </Panel>
              <Panel title="Cycle time" hint="Days from start to done for each card finished in the window.">
                <Cycle f={f} />
              </Panel>
              <Panel title="Throughput" hint="Cards finished per week.">
                <Throughput f={f} />
              </Panel>
              <Panel title="Cumulative flow" hint="Cards in each stage at the end of every day. A widening band is a queue building up.">
                {f.cfd.length === 0 ? <p className="py-10 text-center text-[12.5px] text-[var(--kb-muted)]">Pick one board to see its flow.</p> : <Cfd f={f} />}
              </Panel>
            </div>
            {f.kpis.throughput === 0 && f.kpis.wip === 0 && (
              <Empty icon={TrendingUp} title="Not much to measure yet">
                The charts fill in as cards move from start to done.
              </Empty>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** The agent's report card over the window: how much it did, how often its work passed, and what went wrong. */
function AgentCard({ f }: { f: Flow }): React.JSX.Element {
  const a = f.agent;
  const cells: { label: string; value: string; hint: string; tone?: 'red' | 'amber' }[] = [
    { label: 'Runs', value: String(a.runs), hint: `${a.submitted} submitted` },
    { label: 'Approved', value: pct(a.approval_rate), hint: `${a.approved} of ${a.approved + a.changes + a.rejected} decided` },
    { label: 'First pass', value: pct(a.first_pass_rate), hint: 'approved on the first try' },
    { label: 'Questions', value: String(a.asked), hint: `${a.returned} handed back to you` },
    { label: 'Failed or timed out', value: String(a.failed + a.expired), hint: `${a.failed} failed · ${a.expired} lease ran out`, ...(a.failed + a.expired > 0 ? { tone: 'amber' as const } : {}) },
    { label: 'Run time, median', value: a.median_minutes === null ? '–' : a.median_minutes < 90 ? `${num(a.median_minutes)} min` : `${num(a.median_minutes / 60)} h`, hint: 'claim to finish' },
  ];
  return (
    <section className="flex flex-col gap-3 rounded-[var(--kb-radius-lg)] border border-[var(--kb-hair)] bg-[var(--kb-card)] px-4 pb-3.5 pt-3.5">
      <div className="flex items-center gap-2.5">
        <AgentAvatar size={26} />
        <div>
          <h2 className="text-[13px] font-semibold">Agent</h2>
          <p className="text-[12px] leading-4 text-[var(--kb-muted)]">Its runs in the last {f.days} days{f.board !== null ? ` on ${f.board.name}` : ''}, and how its work fared in your review.</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--kb-radius)] bg-[var(--kb-hair)] ring-1 ring-[var(--kb-hair)] sm:grid-cols-3 xl:grid-cols-6">
        {cells.map((c) => (
          <div key={c.label} className="flex flex-col gap-0.5 bg-[var(--kb-main)] px-3 py-2.5">
            <span className="text-[11.5px] text-[var(--kb-muted)]">{c.label}</span>
            <span className={cn('kb-num text-[18px] font-semibold tracking-[-0.01em]', c.tone === 'amber' && 'text-[var(--kb-amber)]')}>{c.value}</span>
            <span className="truncate text-[11.5px] text-[var(--kb-muted)]">{c.hint}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Legend({ color, label }: { color: string; label: string }): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="size-2.5 rounded-full" style={{ background: color }} /> {label}
    </span>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint: string }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1 rounded-[var(--kb-radius-lg)] border border-[var(--kb-hair)] bg-[var(--kb-card)] px-4 py-3">
      <span className="text-[12px] text-[var(--kb-muted)]">{label}</span>
      <span className="kb-num text-[22px] font-semibold tracking-[-0.01em]">{value}</span>
      <span className="truncate text-[12px] text-[var(--kb-muted)]">{hint}</span>
    </div>
  );
}

function Panel({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="flex flex-col gap-2 rounded-[var(--kb-radius-lg)] border border-[var(--kb-hair)] bg-[var(--kb-card)] px-4 pb-3 pt-3.5">
      <div>
        <h2 className="text-[13px] font-semibold">{title}</h2>
        <p className="mt-0.5 text-[12px] leading-4 text-[var(--kb-muted)]">{hint}</p>
      </div>
      {children}
    </section>
  );
}

const H = 210;
const PAD = { l: 34, r: 12, t: 10, b: 26 };

function ticks(max: number): number[] {
  if (max <= 0) return [0];
  const step = max <= 5 ? 1 : max <= 12 ? 2 : max <= 30 ? 5 : max <= 60 ? 10 : Math.ceil(max / 6 / 10) * 10;
  const out: number[] = [];
  for (let v = 0; v <= max + 0.001; v += step) out.push(v);
  return out;
}

function Axes({ w, max, unit }: { w: number; max: number; unit: string }): React.JSX.Element {
  const ys = ticks(max);
  const y = (v: number): number => PAD.t + (H - PAD.t - PAD.b) * (1 - v / Math.max(max, 1));
  return (
    <g>
      {ys.map((v) => (
        <g key={v}>
          <line x1={PAD.l} x2={w - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--kb-hair)" />
          <text x={PAD.l - 6} y={y(v) + 3.5} textAnchor="end" fontSize="10.5" fill="var(--kb-muted)" className="kb-num">
            {v}
            {v === ys[ys.length - 1] ? unit : ''}
          </text>
        </g>
      ))}
    </g>
  );
}

function PLine({ w, v, max, label }: { w: number; v: number | null; max: number; label: string }): React.JSX.Element | null {
  if (v === null || max <= 0) return null;
  const y = PAD.t + (H - PAD.t - PAD.b) * (1 - v / max);
  return (
    <g>
      <line x1={PAD.l} x2={w - PAD.r} y1={y} y2={y} stroke="var(--kb-muted)" strokeDasharray="4 3" />
      <text x={w - PAD.r} y={y - 4} textAnchor="end" fontSize="10.5" fill="var(--kb-muted)">
        {label} {num(v)} d
      </text>
    </g>
  );
}

function Aging({ f }: { f: Flow }): React.JSX.Element {
  const [ref, w] = useWidth();
  const cols = f.columns.filter((c) => c.category === 'doing' || c.category === 'review');
  const app = useApp();
  const max = Math.max(1, ...f.aging.map((a) => a.age), f.percentiles.p85 ?? 0) * 1.12;
  const groups = f.board === null ? [...new Set(f.aging.map((a) => a.column_name))].map((n) => ({ id: n, name: n })) : cols.map((c) => ({ id: c.id, name: c.name }));
  const band = (w - PAD.l - PAD.r) / Math.max(groups.length, 1);
  return (
    <div ref={ref} className="w-full">
      {w > 0 && (
        <svg width={w} height={H} role="img" aria-label="Aging work in progress">
          <Axes w={w} max={max} unit=" d" />
          {groups.map((g, i) => (
            <text key={g.id} x={PAD.l + band * (i + 0.5)} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--kb-ink-2)">
              {g.name.length > 16 ? g.name.slice(0, 15) + '…' : g.name}
            </text>
          ))}
          <PLine w={w} v={f.percentiles.p50} max={max} label="50%" />
          <PLine w={w} v={f.percentiles.p85} max={max} label="85%" />
          {f.aging.map((a, k) => {
            const gi = groups.findIndex((g) => g.id === (f.board === null ? a.column_name : a.column));
            if (gi < 0) return null;
            const jitter = ((k * 37) % 21) - 10;
            const x = PAD.l + band * (gi + 0.5) + jitter * Math.min(1, band / 60);
            const y = PAD.t + (H - PAD.t - PAD.b) * (1 - a.age / max);
            const late = f.percentiles.p85 !== null && a.age > f.percentiles.p85;
            return (
              <circle key={a.id} cx={x} cy={y} r={5} fill={a.kind === 'agent' ? AGENT : YOU} stroke={late ? 'var(--kb-red)' : 'var(--kb-card)'} strokeWidth={late ? 2 : 1.5} className="cursor-pointer" onClick={() => app.setOpenCard(a.id)}>
                <title>{`${a.key} ${a.title}: ${num(a.age)} days in progress`}</title>
              </circle>
            );
          })}
        </svg>
      )}
    </div>
  );
}

function Cycle({ f }: { f: Flow }): React.JSX.Element {
  const [ref, w] = useWidth();
  const max = Math.max(1, ...f.cycle.map((c) => c.days), f.percentiles.p95 ?? 0) * 1.1;
  const t1 = Date.now();
  const t0 = t1 - f.days * 86400000;
  const x = (iso: string): number => PAD.l + (w - PAD.l - PAD.r) * ((Date.parse(iso.replace(' ', 'T')) - t0) / (t1 - t0));
  return (
    <div ref={ref} className="w-full">
      {w > 0 && (
        <svg width={w} height={H} role="img" aria-label="Cycle time">
          <Axes w={w} max={max} unit=" d" />
          <text x={PAD.l} y={H - 8} fontSize="10.5" fill="var(--kb-muted)">
            {f.days} days ago
          </text>
          <text x={w - PAD.r} y={H - 8} textAnchor="end" fontSize="10.5" fill="var(--kb-muted)">
            today
          </text>
          <PLine w={w} v={f.percentiles.p50} max={max} label="50%" />
          <PLine w={w} v={f.percentiles.p85} max={max} label="85%" />
          <PLine w={w} v={f.percentiles.p95} max={max} label="95%" />
          {f.cycle.map((c, i) => (
            <circle key={i} cx={x(c.done_at)} cy={PAD.t + (H - PAD.t - PAD.b) * (1 - c.days / max)} r={4.5} fill={c.kind === 'agent' ? AGENT : YOU} fillOpacity={0.85} stroke="var(--kb-card)" strokeWidth={1}>
              <title>{`${c.key} ${c.title}: ${num(c.days)} days`}</title>
            </circle>
          ))}
          {f.cycle.length === 0 && (
            <text x={w / 2} y={H / 2} textAnchor="middle" fontSize="12" fill="var(--kb-muted)">
              No card finished in this window
            </text>
          )}
        </svg>
      )}
    </div>
  );
}

function Throughput({ f }: { f: Flow }): React.JSX.Element {
  const [ref, w] = useWidth();
  const max = Math.max(1, ...f.throughput.map((t) => t.agent + t.you)) * 1.15;
  const band = (w - PAD.l - PAD.r) / Math.max(f.throughput.length, 1);
  const bw = Math.min(28, band * 0.6);
  const y = (v: number): number => PAD.t + (H - PAD.t - PAD.b) * (1 - v / max);
  return (
    <div ref={ref} className="w-full">
      {w > 0 && (
        <svg width={w} height={H} role="img" aria-label="Throughput per week">
          <Axes w={w} max={max} unit="" />
          {f.throughput.map((t, i) => {
            const cx = PAD.l + band * (i + 0.5);
            const total = t.agent + t.you;
            return (
              <g key={t.week_end}>
                {t.you > 0 && <rect x={cx - bw / 2} y={y(t.you)} width={bw} height={y(0) - y(t.you)} rx={3} fill={YOU} />}
                {t.agent > 0 && <rect x={cx - bw / 2} y={y(total)} width={bw} height={y(t.you) - y(total)} rx={3} fill={AGENT} />}
                {total > 0 && (
                  <text x={cx} y={y(total) - 4} textAnchor="middle" fontSize="10.5" fill="var(--kb-ink-2)" className="kb-num">
                    {total}
                  </text>
                )}
                {(i === f.throughput.length - 1 || i % Math.ceil(f.throughput.length / 6) === 0) && (
                  <text x={cx} y={H - 8} textAnchor="middle" fontSize="10.5" fill="var(--kb-muted)">
                    {new Date(t.week_end).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                  </text>
                )}
                <title>{`Week to ${t.week_end}: ${t.agent} by the agent, ${t.you} by you`}</title>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

const CFD_CATS: { key: 'done' | 'review' | 'doing' | 'todo' | 'backlog'; label: string; color: string }[] = [
  { key: 'done', label: 'Done', color: 'color-mix(in srgb, var(--kb-green), transparent 45%)' },
  { key: 'review', label: 'Review', color: 'color-mix(in srgb, var(--kb-blue), transparent 40%)' },
  { key: 'doing', label: 'In progress', color: 'color-mix(in srgb, var(--kb-accent), transparent 35%)' },
  { key: 'todo', label: 'To do', color: 'color-mix(in srgb, var(--kb-ink-2), transparent 70%)' },
  { key: 'backlog', label: 'Backlog', color: 'color-mix(in srgb, var(--kb-ink-2), transparent 85%)' },
];

function Cfd({ f }: { f: Flow }): React.JSX.Element {
  const [ref, w] = useWidth();
  const rows = f.cfd;
  const max = Math.max(1, ...rows.map((r) => r.backlog + r.todo + r.doing + r.review + r.done)) * 1.08;
  const x = (i: number): number => PAD.l + (w - PAD.l - PAD.r) * (rows.length <= 1 ? 0 : i / (rows.length - 1));
  const y = (v: number): number => PAD.t + (H - PAD.t - PAD.b) * (1 - v / max);
  const order = ['done', 'review', 'doing', 'todo', 'backlog'] as const;
  const stack = rows.map((r) => {
    let acc = 0;
    const out: Record<string, [number, number]> = {};
    for (const k of order) {
      out[k] = [acc, acc + r[k]];
      acc += r[k];
    }
    return out;
  });
  return (
    <div ref={ref} className="w-full">
      {w > 0 && (
        <svg width={w} height={H} role="img" aria-label="Cumulative flow">
          <Axes w={w} max={max} unit="" />
          {CFD_CATS.map((c) => {
            const top = stack.map((s, i) => `${x(i)},${y(s[c.key]![1])}`).join(' ');
            const bottom = stack
              .map((s, i) => `${x(i)},${y(s[c.key]![0])}`)
              .reverse()
              .join(' ');
            return <polygon key={c.key} points={`${top} ${bottom}`} fill={c.color} />;
          })}
          <text x={PAD.l} y={H - 8} fontSize="10.5" fill="var(--kb-muted)">
            {rows[0]?.day}
          </text>
          <text x={w - PAD.r} y={H - 8} textAnchor="end" fontSize="10.5" fill="var(--kb-muted)">
            {rows[rows.length - 1]?.day}
          </text>
        </svg>
      )}
      {w > 0 && rows.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-[var(--kb-ink-2)]" style={{ paddingLeft: PAD.l }}>
          {CFD_CATS.slice()
            .reverse()
            .map((c) => (
              <span key={c.key} className="inline-flex items-center gap-1.5">
                <span aria-hidden className="size-[9px] rounded-[2px]" style={{ background: c.color }} />
                {c.label}
              </span>
            ))}
        </div>
      )}
    </div>
  );
}

void cn;
