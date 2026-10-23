/**
 * Home: what is going on. The greeting with the two ways to start a part, a
 * strip of counts (parts, building, not building, with your AI agent), the
 * recent parts, the engine, requests to the AI agent and the latest
 * changes. A first-time panel explains the idea when there are no parts yet.
 */
import { useState } from 'react';
import { ArrowUpRight, Boxes, FileDown, Inbox, Plus, Ruler, ShieldCheck, Sparkles } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { AskAgentDialog, BriefRow } from '../components/AskAgent.tsx';
import { EngineSetupNote, setupActive, setupBadge } from '../components/EngineSetup.tsx';
import { useNewPart } from '../components/NewPart.tsx';
import { PartsTable } from '../components/PartsTable.tsx';
import { Badge, Button, Empty, PageHeader, Panel, TextLink, errMessage } from '../components/ui.tsx';
import { BatchCard } from '../components/workspace/Panels.tsx';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { greeting, ms, plural } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { navigate } from '../lib/router.ts';

function Kpi({ label, value, tone = 'neutral', pulse = false, onClick }: { label: string; value: number; tone?: 'neutral' | 'info' | 'bad'; pulse?: boolean; onClick?: (() => void) | undefined }): React.JSX.Element {
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-[12px] text-[var(--cw-muted)]">
        {tone !== 'neutral' && value > 0 && <span aria-hidden className={cn('size-1.5 rounded-full', tone === 'bad' ? 'bg-[var(--cw-red)]' : 'bg-[var(--cw-accent)]', pulse && 'cw-pulse')} />}
        {label}
      </span>
      <span className={cn('num text-[15px] font-bold leading-[22px]', tone === 'bad' && value > 0 && 'text-[var(--cw-red-text)]')}>{value}</span>
    </>
  );
  const cls = 'cw-rise flex flex-col items-start rounded-[var(--cw-r-md)] border border-[var(--cw-line)] bg-[var(--cw-card)] px-3 py-2 text-left';
  return onClick !== undefined ? (
    <button type="button" onClick={onClick} className={cn(cls, 'transition-colors hover:border-[var(--cw-muted)]')}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function EnginePanel(): React.JSX.Element {
  const { status } = useApp();
  const [test, setTest] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const e = status?.engine;
  const run = async (): Promise<void> => {
    setBusy(true);
    try {
      setTest(await api.runJob('engine_test'));
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const setup = e !== undefined && !e.installed ? setupBadge(e.setup) : null;
  const state = e === undefined ? 'Checking' : setup !== null ? setup.label : e.busy ? 'Working' : e.running ? 'Ready' : 'Starts on the next build';
  return (
    <Panel tone="dark" title="Geometry engine" subtitle="OpenCascade on this computer: every number is exact, nothing leaves the machine.">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={setup?.bad === true ? 'bad' : 'dark'} pulse={e?.busy === true || (e !== undefined && !e.installed && setupActive(e.setup))}>
          {state}
        </Badge>
        {status?.running !== null && status?.running !== undefined && <span className="text-[12px] text-[var(--cw-on-dark-muted)]">building for {status.running.seconds} s</span>}
        {status !== null && status.queued_builds > 0 && <span className="text-[12px] text-[var(--cw-on-dark-muted)]">{plural(status.queued_builds, 'build')} waiting</span>}
      </div>
      {e !== undefined && !e.installed && <EngineSetupNote setup={e.setup} />}
      {test !== null && (
        <p className="num mt-2 text-[12px] leading-4 text-[var(--cw-on-dark)]">
          {test['ok'] === true ? 'Works: ' : 'Problem: '}
          {test['ok'] === true ? 'started and answered in ' + ms(Number(test['start_and_ping_ms'])) + ', a sample enclosure built in ' + ms(Number(test['sample_build_ms'])) + '.' : String((test['error'] as { message?: string } | undefined)?.message ?? '')}
        </p>
      )}
      {e?.installed === true && (
        <div className="mt-2.5">
          <Button variant="accent" size="sm" loading={busy} onClick={() => void run()}>
            Test the engine
          </Button>
        </div>
      )}
    </Panel>
  );
}

function Welcome({ onAsk }: { onAsk: () => void }): React.JSX.Element {
  const np = useNewPart();
  const points = [
    { icon: Ruler, title: 'Exact, editable parts', text: 'A tree of features driven by named numbers. Change one number and the part rebuilds.' },
    { icon: Sparkles, title: 'Your AI agent builds with you', text: 'It uses the same tools you do: every feature it adds is marked, and any batch undoes in one step.' },
    { icon: ShieldCheck, title: 'Checked, not guessed', text: 'Checks like "fits an 80 mm case" re-run on every build, measured by the kernel.' },
    { icon: FileDown, title: 'Ready to make', text: 'Export STEP for CAD and machining, 3MF or STL for 3D printing.' },
  ];
  return (
    <Panel tone="sand" title="Design real parts, with your AI agent" subtitle="Brackets, enclosures, mounts, fixtures: parts you can print or machine.">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
        {points.map((p) => {
          const Icon = p.icon;
          return (
            <div key={p.title} className="flex items-start gap-2 rounded-[var(--cw-r)] bg-[var(--cw-card)] p-2.5">
              <span className="cw-on-ink flex size-7 shrink-0 items-center justify-center rounded-[var(--cw-r)] bg-[var(--cw-ink)] text-[var(--cw-accent)]">
                <Icon size={14} aria-hidden />
              </span>
              <span>
                <span className="block text-[13px] font-bold leading-5">{p.title}</span>
                <span className="block text-[12px] leading-4 text-[var(--cw-ink-2)]">{p.text}</span>
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Button variant="primary" icon={Plus} onClick={(e) => np.open(e.currentTarget)}>
          Start a part
        </Button>
        <Button icon={Sparkles} onClick={onAsk}>
          Describe one to your AI agent
        </Button>
      </div>
    </Panel>
  );
}

export function HomePage(): React.JSX.Element {
  const { unit, status } = useApp();
  const np = useNewPart();
  const [asking, setAsking] = useState(false);
  const parts = useLive(() => api.parts({ limit: 10 }), ['parts', 'builds'], []);
  const reqs = useLive(() => api.requests({ limit: 5 }), ['briefs'], []);
  const hist = useLive(() => api.changes({ limit: 6 }), ['changes'], []);
  const list = parts.data?.parts ?? [];
  const total = parts.data?.total ?? 0;
  const failing = status?.parts_by_status.failed ?? 0;
  const building = (status?.parts_by_status.building ?? 0) + (status?.parts_by_status.queued ?? 0);
  const open = status?.open_requests ?? 0;
  const dateLine = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title={greeting()}
        subtitle={dateLine}
        actions={
          <>
            <Button icon={Sparkles} onClick={() => setAsking(true)}>
              Ask your AI agent to design a part
            </Button>
            <Button variant="primary" icon={Plus} onClick={(e) => np.open(e.currentTarget)}>
              New part
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Kpi label="Parts" value={total} onClick={() => navigate('parts')} />
        <Kpi label="Building" value={building} tone="info" pulse />
        <Kpi label="Not building" value={failing} tone="bad" onClick={failing > 0 ? () => navigate('parts', { status: 'failed' }) : undefined} />
        <Kpi label="With your AI agent" value={open} tone="info" pulse onClick={() => navigate('requests')} />
      </div>

      {total === 0 && !parts.loading && <Welcome onAsk={() => setAsking(true)} />}

      <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel
          title="Recent parts"
          subtitle={total > 0 ? plural(total, 'part') : undefined}
          padded={false}
          actions={
            total > 0 ? (
              <TextLink onClick={() => navigate('parts')}>
                All parts <ArrowUpRight size={13} aria-hidden />
              </TextLink>
            ) : undefined
          }
        >
          {list.length > 0 ? (
            <PartsTable parts={list} unit={unit} compact />
          ) : (
            <Empty
              icon={Boxes}
              title="No parts yet"
              action={
                <Button variant="primary" icon={Plus} onClick={(e) => np.open(e.currentTarget)}>
                  New part
                </Button>
              }
            >
              Start from a block, a mounting plate, an open box, or nothing.
            </Empty>
          )}
        </Panel>
        <div className="flex flex-col gap-3">
          <EnginePanel />
          <Panel
            title="Requests to your AI agent"
            padded={false}
            actions={
              <TextLink onClick={() => navigate('requests')}>
                All <ArrowUpRight size={13} aria-hidden />
              </TextLink>
            }
          >
            {(reqs.data?.briefs ?? []).length > 0 ? (
              <div className="flex flex-col">
                {(reqs.data?.briefs ?? []).map((b) => (
                  <BriefRow key={b.id} b={b} showPart />
                ))}
              </div>
            ) : (
              <Empty icon={Inbox} title="Nothing asked yet" compact>
                Ask from a part to design, fix or review it.
              </Empty>
            )}
          </Panel>
        </div>
      </div>

      {(hist.data?.batches ?? []).length > 0 && (
        <Panel
          title="Latest changes"
          padded={false}
          actions={
            <TextLink onClick={() => navigate('activity')}>
              Activity <ArrowUpRight size={13} aria-hidden />
            </TextLink>
          }
        >
          <div className="grid grid-cols-1 lg:grid-cols-2 lg:[&>*:nth-child(odd)]:border-r lg:[&>*:nth-child(odd)]:border-[var(--cw-hair)]">
            {(hist.data?.batches ?? []).map((b) => (
              <BatchCard key={b.batch} b={b} showPart />
            ))}
          </div>
        </Panel>
      )}

      <AskAgentDialog open={asking} onClose={() => setAsking(false)} part={null} selection={[]} failed={false} />
    </div>
  );
}
