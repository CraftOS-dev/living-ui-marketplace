/**
 * Settings: how numbers show, how the view moves, the materials (for mass),
 * how long your AI agent's edits wait for their build, and the engine.
 */
import { useEffect, useState } from 'react';
import { Check, Minus, Plus, Save } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { EngineSetupNote, setupActive, setupBadge } from '../components/EngineSetup.tsx';
import { Badge, Button, IconButton, PageHeader, Panel, Segmented, Select, Toggle, errMessage, inputCls } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { ago, ms } from '../lib/format.ts';
import type { Settings } from '../lib/types.ts';

const NAV: { value: Settings['navigation']; label: string; text: string }[] = [
  { value: 'right_rotates', label: 'Right drag turns', text: 'Like Onshape: right drag turns around the point under the pointer, middle drag pans, left drag selects with a box, right click opens the menu.' },
  { value: 'middle_rotates', label: 'Middle drag turns', text: 'Like SOLIDWORKS and Blender: middle drag turns, right drag pans, left drag selects with a box, right click opens the menu.' },
  { value: 'left_rotates', label: 'Left drag turns', text: 'Left drag turns, right or middle drag pans, Shift and left drag selects with a box.' },
];

/** A labelled row of a settings panel: label and help on the left, the control on the right. */
function Row({ label, help, children }: { label: string; help?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-b border-[var(--cw-hair)] py-2 first:pt-0 last:border-b-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <p className={cn('text-[13px] font-semibold', help !== undefined && 'w-fit cursor-help underline decoration-dotted decoration-[var(--cw-line)] underline-offset-2')} title={help}>
          {label}
        </p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Materials({ s }: { s: Settings }): React.JSX.Element {
  const [rows, setRows] = useState(s.materials.map((m) => ({ name: m.name, density: String(m.density) })));
  const [def, setDef] = useState(s.default_material);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setRows(s.materials.map((m) => ({ name: m.name, density: String(m.density) })));
    setDef(s.default_material);
  }, [s.materials, s.default_material]);
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.updateSettings({ materials: rows.filter((r) => r.name.trim() !== '').map((r) => ({ name: r.name.trim(), density: Number(r.density) })) });
      await api.updateSettings({ default_material: def });
      toast.success('Saved the materials');
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel
      title="Materials"
      subtitle="Densities in g/cm³"
      actions={
        <Button size="sm" variant="primary" icon={Save} loading={busy} onClick={() => void save()}>
          Save
        </Button>
      }
    >
      <div className="overflow-hidden rounded-[var(--cw-r)] border border-[var(--cw-line)]">
        <div className="grid grid-cols-[minmax(0,1fr)_96px_32px] items-center gap-1.5 border-b border-[var(--cw-line)] bg-[var(--cw-row)] px-2 py-1 text-[12px] font-semibold text-[var(--cw-muted)]">
          <span>Name</span>
          <span className="text-right">Density</span>
          <span />
        </div>
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_96px_32px] items-center gap-1.5 border-b border-[var(--cw-hair)] px-2 py-1 last:border-b-0">
            <input aria-label="Material name" value={r.name} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className={cn(inputCls, 'h-6')} maxLength={60} />
            <input aria-label={'Density of ' + r.name} value={r.density} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, density: e.target.value } : x)))} className={cn(inputCls, 'num h-6 text-right')} />
            <IconButton icon={Minus} size={24} variant="danger" label={'Remove ' + r.name} onClick={() => setRows(rows.filter((_, j) => j !== i))} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-2">
        <Button size="sm" icon={Plus} onClick={() => setRows([...rows, { name: '', density: '1' }])}>
          Add a material
        </Button>
        <Select label="Material for new parts" value={def} onChange={setDef} options={[{ value: '', label: 'None' }, ...rows.filter((r) => r.name.trim() !== '').map((r) => ({ value: r.name.trim(), label: r.name.trim() }))]} className="w-52" />
      </div>
    </Panel>
  );
}

export function SettingsPage(): React.JSX.Element {
  const { settings: s, status } = useApp();
  const [test, setTest] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (s === null) return <div />;
  const set = (p: Parameters<typeof api.updateSettings>[0]): void => {
    api.updateSettings(p).catch((err: unknown) => toast.error(errMessage(err)));
  };
  const job = async (j: 'engine_test' | 'prune'): Promise<void> => {
    setBusy(j);
    try {
      const r = await api.runJob(j);
      if (j === 'engine_test') setTest(r);
      else toast.success('Removed ' + String((r['result'] as { removed?: number } | undefined)?.removed ?? 0) + ' old builds');
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(null);
    }
  };
  const e = status?.engine;
  const darkStat = (label: string, value: string): React.JSX.Element => (
    <div className="flex min-h-6 items-center justify-between gap-3 text-[12px]">
      <span className="text-[var(--cw-on-dark-muted)]">{label}</span>
      <span className="num font-semibold">{value}</span>
    </div>
  );
  return (
    <div>
      <PageHeader title="Settings" />
      <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-2">
        <div className="flex flex-col gap-3">
          <Panel title="Display">
            <Row label="Show sizes in" help="The model is always in millimetres and degrees; this only changes how sizes are shown.">
              <Segmented<Settings['display_unit']>
                label="Show sizes in"
                value={s.display_unit}
                onChange={(v) => set({ display_unit: v })}
                options={[
                  { value: 'mm', label: 'Millimetres' },
                  { value: 'in', label: 'Inches' },
                ]}
              />
            </Row>
            <Row label="Projection">
              <Segmented<Settings['projection']>
                label="Projection"
                value={s.projection}
                onChange={(v) => set({ projection: v })}
                options={[
                  { value: 'perspective', label: 'Perspective' },
                  { value: 'orthographic', label: 'Orthographic' },
                ]}
              />
            </Row>
            <Row label="Ground grid">
              <Toggle label="Show the ground grid" checked={s.show_grid} onChange={(v) => set({ show_grid: v })} />
            </Row>
          </Panel>
          <Panel title="Mouse" padded={false}>
            <div role="radiogroup" aria-label="Mouse navigation">
              {NAV.map((n) => {
                const on = s.navigation === n.value;
                return (
                  <button
                    key={n.value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => set({ navigation: n.value })}
                    className={cn('flex w-full items-start gap-2 border-b border-[var(--cw-hair)] px-3 py-2 text-left last:border-b-0', on ? 'bg-[var(--cw-row)] shadow-[inset_2px_0_0_var(--cw-accent)]' : 'hover:bg-[var(--cw-row)]')}
                  >
                    <span className={cn('mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border', on ? 'cw-on-ink border-transparent bg-[var(--cw-ink)] text-[var(--cw-accent)]' : 'border-[var(--cw-line)]')}>{on && <Check size={10} strokeWidth={3} aria-hidden />}</span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-semibold">{n.label}</span>
                      <span className="block text-[12px] leading-4 text-[var(--cw-muted)]">{n.text}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </Panel>
          <Panel title="Your AI agent">
            <div className="flex items-center gap-3">
              <input type="range" className="cw-range min-w-0 flex-1" min={0} max={25} step={1} value={s.agent_wait_s} aria-label="Seconds to wait" onChange={(ev) => set({ agent_wait_s: Number(ev.target.value) })} />
              <span className="num w-14 shrink-0 text-right text-[13px] font-semibold">{s.agent_wait_s} s</span>
            </div>
            <p className="mt-1 text-[12px] leading-4 text-[var(--cw-muted)]">Longer waits suit big parts. With 0, edits answer at once and the agent checks the build later.</p>
          </Panel>
        </div>
        <div className="flex flex-col gap-3">
          <Materials s={s} />
          <Panel
            tone="dark"
            title="Geometry engine"
            subtitle="OpenCascade, on this computer"
            actions={
              <>
                <Button size="sm" variant="accent" loading={busy === 'engine_test'} disabled={e?.installed !== true} onClick={() => void job('engine_test')}>
                  Test
                </Button>
                <Button size="sm" loading={busy === 'prune'} onClick={() => void job('prune')}>
                  Clean old builds
                </Button>
              </>
            }
          >
            {e !== undefined && (
              <div className="flex flex-col">
                <div className="mb-1.5">
                  <Badge tone={!e.installed && setupBadge(e.setup).bad ? 'bad' : 'dark'} pulse={e.busy || (!e.installed && setupActive(e.setup))}>
                    {!e.installed ? setupBadge(e.setup).label : e.busy ? 'Working' : e.running ? 'Running' : 'Stopped (starts on demand)'}
                  </Badge>
                </div>
                {!e.installed && (
                  <div className="mb-2">
                    <EngineSetupNote setup={e.setup} />
                  </div>
                )}
                <p className="mono break-all text-[var(--cw-on-dark-muted)]">{e.folder}</p>
                <p className="mono break-all text-[var(--cw-on-dark-muted)]">Log: {e.log}</p>
                {e.load_ms !== null && darkStat('Last start took', ms(e.load_ms))}
                {s.last_prune_at !== '' && darkStat('Old builds last cleaned', ago(s.last_prune_at))}
              </div>
            )}
            {test !== null && (
              <div className="mt-2 rounded-[var(--cw-r)] bg-[var(--cw-dark-2)] px-2.5 py-1.5">
                {test['ok'] === true ? (
                  <>
                    {darkStat('Start and answer', ms(Number(test['start_and_ping_ms'])))}
                    {darkStat('Sample enclosure', ms(Number(test['sample_build_ms'])))}
                    {darkStat('Engine', String((test['engine'] as { kernel?: string } | undefined)?.kernel ?? ''))}
                  </>
                ) : (
                  <p className="text-[12px]">{String((test['error'] as { message?: string } | undefined)?.message ?? 'The test failed')}</p>
                )}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
