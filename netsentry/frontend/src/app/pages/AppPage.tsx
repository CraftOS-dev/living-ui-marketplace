/**
 * An app's page (#/app/<id>[/<tab>]) — v4 §5.2: a header that says whether it's running, with
 * Open / Restart / Stop, and five tabs — Overview (how it runs, its problems, what was changed),
 * Logs, Updates, Backups, Access & safety (who can reach it vs who should, its sign-in and safety
 * checks, accounts inside it, every check, technical details). Older addresses
 * (#/app/<id>/reach, /checks, /changes …) land on the tab that now holds them.
 */
import { useEffect, useMemo, useState } from 'react';
import { AppSettings, RemoveApp } from '../components/AppJobs.tsx';
import { Button, EmptyState, Input, Pill, Select, Spinner, toast } from '../../kit/index.ts';
import { useCollection, useRecord } from '../store/collections.ts';
import { AppAccess } from '../components/AppAccess.tsx';
import { AppIcon, ReachChooser } from '../components/Apps.tsx';
import { Breadcrumbs, DrillList, DrillRow } from '../components/Breadcrumbs.tsx';
import { GlobeIcon } from '../components/icons.tsx';
import { RemoteGuide } from '../components/RemoteGuide.tsx';
import { ProblemList } from '../components/ProblemCard.tsx';
import { AppNumbers } from '../components/Health.tsx';
import { ChangeHistory, LogsView, RunControls, useWatch } from '../components/Controls.tsx';
import { AppUpdates } from '../components/Updates.tsx';
import { OwnBackups } from '../components/OwnBackups.tsx';
import { PageTabs } from '../components/PageTabs.tsx';
import { TONE_COLOR } from '../components/visual.tsx';
import { appName, loadCatalogue, openUrl, stateTone, stateWord } from '../lib/apps.ts';
import { relTime } from '../lib/format.ts';
import { useMe } from '../lib/me.tsx';
import { go, href, to } from '../lib/nav.ts';
import { runOp } from '../lib/ops.ts';
import type { AppRecord, Asset, BackupPlanRecord, CatalogueApp, EvaluationRecord, Finding, IntentRecord, Observation, Reach } from '../lib/types.ts';
import { DetailScope } from '../lib/view.tsx';
import { useLive } from '../lib/liveStatus.tsx';

export const APP_PARTS = ['logs', 'settings', 'updates', 'backups', 'access', 'remote', 'reach', 'security', 'uptime', 'checks', 'technical', 'changes'] as const;
export type AppPart = (typeof APP_PARTS)[number];

type Tab = 'overview' | 'logs' | 'settings' | 'updates' | 'backups' | 'access';
/** Addresses from before v4 → the tab that holds that part now. */
const TAB_OF: Record<AppPart, Tab> = {
  logs: 'logs', settings: 'settings', updates: 'updates', backups: 'backups', access: 'access', remote: 'access',
  reach: 'access', security: 'access', checks: 'access', technical: 'access', uptime: 'overview', changes: 'overview',
};

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-1 text-[13px] font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function StateChip({ state }: { state: EvaluationRecord['state'] | 'none' }): React.JSX.Element {
  const tone = stateTone(state);
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-[12px]" style={{ color: tone === 'neutral' ? 'var(--agent-app-muted)' : TONE_COLOR[tone] }}>
      <span className="h-2 w-2 rounded-full" style={{ background: tone === 'neutral' ? 'var(--agent-app-border)' : TONE_COLOR[tone] }} />
      {stateWord(state)}
    </span>
  );
}

function CheckRow({ e }: { e: EvaluationRecord }): React.JSX.Element {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px]">{e.plain_title}</span>
        {e.state === 'unknown' && e.reason && <span className="block text-[12px] text-[var(--agent-app-muted)]">Why: {e.reason}</span>}
        {e.state === 'fail' && e.factors && e.factors.length > 0 && <span className="block text-[12px] text-[var(--agent-app-muted)]">{e.factors.join(' · ')}</span>}
      </span>
      <StateChip state={e.state} />
    </>
  );
  const cls = 'flex min-h-[52px] items-center gap-3 border-b border-[var(--agent-app-border)] px-4 py-2.5 last:border-b-0';
  return e.finding && e.state === 'fail' ? (
    <a href={href(to.issue(e.finding))} className={cls + ' hover:bg-[var(--agent-app-surface-2)]'}>
      {body}
    </a>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function Card({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="overflow-hidden rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)]">{children}</div>;
}

/** One step of a path, in plain words. */
function hopWords(h: { component: string; decision: string; detail: string; router?: string }): string {
  switch (h.component) {
    case 'router forward':
      return `through your router${h.router ? ` (${h.router})` : ''}: ${h.detail}`;
    case 'host firewall':
      return h.decision === 'not_checked' ? 'server firewall: not checked yet' : `server firewall: ${h.detail}`;
    case 'listening address':
      return `listening: ${h.detail}`;
    case 'security group':
    case 'cloud firewall':
      return `cloud firewall: ${h.detail}`;
    case 'network acl':
      return h.decision === 'not_checked' ? 'network ACL: not readable' : `network ACL: ${h.detail}`;
    case 'route':
      return h.decision === 'not_checked' ? 'route to the internet: not readable' : `route to the internet: ${h.detail}`;
    case 'public address':
      return `public address: ${h.detail}`;
    default:
      return h.detail; // Tailscale, Cloudflare Tunnel, VPN: their detail says it
  }
}

/** Who can reach it, as paths in plain words (from the reachability evidence). */
function ReachPaths({ e }: { e: EvaluationRecord | undefined }): React.JSX.Element | null {
  const paths = (e?.evidence?.['paths'] as Array<{ vantage: string; endpoint: string; hops: Array<{ component: string; decision: string; detail: string; router?: string }> }> | undefined) ?? [];
  if (!paths.length) return null;
  const cloud = paths.some((p) => p.hops.some((h) => h.component === 'security group' || h.component === 'cloud firewall'));
  const words: Record<string, string> = {
    this_machine: 'This server',
    local_network: cloud ? 'Your VPC' : 'Your local network',
    private_remote: 'Your devices away',
    internet: 'The whole internet',
  };
  return (
    <Card>
      {paths.map((p, i) => (
        <div key={i} className="border-b border-[var(--agent-app-border)] px-4 py-3 last:border-b-0">
          <p className="text-[14px] font-medium" style={p.vantage === 'internet' ? { color: TONE_COLOR.bad } : undefined}>
            {words[p.vantage] ?? p.vantage}
          </p>
          <ol className="mt-1 flex flex-col gap-0.5 text-[12px] text-[var(--agent-app-muted)]">
            {p.hops.map((h, k) => (
              <li key={k}>{hopWords(h)}</li>
            ))}
          </ol>
        </div>
      ))}
    </Card>
  );
}

function BackupPlans({ app, asset, plans, canEdit }: { app: AppRecord; asset: Asset | null; plans: BackupPlanRecord[]; canEdit: boolean }): React.JSX.Element {
  const [name, setName] = useState(`${appName(app)} backup`);
  const [hours, setHours] = useState('24');
  const [dest, setDest] = useState('');
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const create = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await runOp<{ heartbeat_path: string; message: string }>('backups.create-plan', { asset_id: app.asset, name, schedule_hours: Number(hours), destination: dest, app_ids: app.id });
      setLink(window.location.origin + r.heartbeat_path);
      toast.success(r.message);
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      {plans.length > 0 && (
        <Card>
          {plans.map((p) => (
            <div key={p.id} className="flex items-center gap-3 border-b border-[var(--agent-app-border)] px-4 py-2.5 last:border-b-0">
              <span className="min-w-0 flex-1">
                <span className="block text-[14px]">{p.name}</span>
                <span className="block text-[12px] text-[var(--agent-app-muted)]">
                  {p.method === 'declared' ? 'You told us — NetSentry can’t see it run' : p.last_success ? `Last finished ${relTime(p.last_success)}` : 'Waiting for its first run'}
                  {p.destination ? ` · to ${p.destination}` : ''} · every {p.schedule_hours === 24 ? 'day' : `${p.schedule_hours} hours`}
                </span>
              </span>
            </div>
          ))}
        </Card>
      )}
      {link ? (
        <Card>
          <div className="flex flex-col gap-2 p-4 text-[14px]">
            <p className="font-medium">Your backup's private link (shown once)</p>
            <code className="break-all rounded bg-[var(--agent-app-surface-2)] px-2 py-1.5 text-[12px]">{link}</code>
            <p className="text-[13px] text-[var(--agent-app-muted)]">Make your backup job open it when it finishes. For example, at the end of the script:</p>
            <code className="break-all rounded bg-[var(--agent-app-surface-2)] px-2 py-1.5 text-[12px]">{`curl -fsS "${link}"`}</code>
            <p className="text-[13px] text-[var(--agent-app-muted)]">No backup job yet? A nightly one with restic (free), to a USB drive — run <code>crontab -e</code> and add:</p>
            <code className="whitespace-pre-wrap break-all rounded bg-[var(--agent-app-surface-2)] px-2 py-1.5 text-[12px]">{`0 3 * * * restic -r /mnt/usb/backups backup /path/to/${appName(app).toLowerCase().split(' ')[0]}/config && curl -fsS "${link}" || curl -fsS "${link}?status=fail&note=backup+failed"`}</code>
            <p className="text-[12px] text-[var(--agent-app-muted)]">
              First time: <code>restic init -r /mnt/usb/backups</code> (keep the password it asks for somewhere safe). Replace the path with the folder that holds {appName(app)}'s data.
            </p>
            {/^(127\.|localhost|\[::1\])/.test(window.location.host) && (
              <p className="text-[12px] text-[var(--agent-app-muted)]">
                This link works on this computer. If the backup runs on another computer, use this server's network address instead of {window.location.hostname}.
              </p>
            )}
            <p className="text-[12px] text-[var(--agent-app-muted)]">
              Windows: <code>{`Invoke-WebRequest -UseBasicParsing "${link}"`}</code>. On failure, add <code>?status=fail&amp;note=why</code>.
            </p>
            <div>
              <Button size="sm" variant="secondary" onClick={() => void navigator.clipboard.writeText(link).then(() => toast.success('Copied'))}>
                Copy link
              </Button>
            </div>
          </div>
        </Card>
      ) : plans.length > 0 && !adding ? (
        canEdit && (
          <div>
            <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
              Add another backup
            </Button>
          </div>
        )
      ) : (
        canEdit && (
          <Card>
            <div className="flex flex-col gap-3 p-4">
              <p className="text-[14px] font-medium">Or: tell NetSentry about a backup tool you already use</p>
              <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
              <Select
                label="How often it runs"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                options={[
                  { value: '24', label: 'Every day' },
                  { value: '168', label: 'Every week' },
                  { value: '6', label: 'Every 6 hours' },
                  { value: '1', label: 'Every hour' },
                ]}
              />
              <Input label="Where it goes (optional)" placeholder="USB drive, another computer, Backblaze…" value={dest} onChange={(e) => setDest(e.target.value)} />
              {asset && <p className="text-[12px] text-[var(--agent-app-muted)]">NetSentry gives you a private link; your backup job opens it when it finishes, so NetSentry knows every backup that worked.</p>}
              <div>
                <Button loading={busy} disabled={!name.trim()} onClick={() => void create()}>
                  Create backup link
                </Button>
              </div>
            </div>
          </Card>
        )
      )}
    </div>
  );
}

export function AppPage({ appId, part, embedded = false }: { appId: string; part: AppPart | null; embedded?: boolean }): React.JSX.Element {
  const { can } = useMe();
  const live = useLive();
  const { record: app, loading } = useRecord<AppRecord>('apps', appId);
  const { record: asset } = useRecord<Asset>('assets', app?.asset ? app.asset : null);
  const evals = useCollection<EvaluationRecord>('evaluations', { filter: `app = "${appId}"` });
  const intents = useCollection<IntentRecord>('intents', { filter: `app = "${appId}"` });
  const plans = useCollection<BackupPlanRecord>('backup_plans', { filter: app?.asset ? `asset = "${app.asset}"` : 'id = ""' });
  const findingIds = evals.records.filter((e) => e.state === 'fail' && e.finding).map((e) => e.finding);
  const linked = useCollection<Finding>('findings', { filter: findingIds.length ? findingIds.map((id) => `id = "${id}"`).join(' || ') : 'id = ""' });
  // A server check about this app's container (Docker publishing its port, …) names the app in its
  // evidence: the same problems Home counts on the app's tile.
  const onServer = useCollection<Finding>('findings', { filter: app?.asset ? `asset = "${app.asset}" && status = "open"` : 'id = ""' });
  const findings = useMemo(() => {
    const byId = new Map(linked.records.map((f) => [f.id, f]));
    for (const f of onServer.records) if ((f.evidence as { app_id?: string } | null)?.app_id === appId && !byId.has(f.id)) byId.set(f.id, f);
    return { records: [...byId.values()], loading: linked.loading || onServer.loading };
  }, [linked.records, linked.loading, onServer.records, onServer.loading, appId]);
  const [cat, setCat] = useState<CatalogueApp[]>([]);
  useEffect(() => void loadCatalogue().then(setCat), []);
  const entry = useMemo(() => cat.find((c) => c.id === app?.app_type), [cat, app?.app_type]);
  const health = useCollection<Observation>('observations', { filter: app?.container ? `asset = "${app.asset}" && kind = "container.health" && subject = ${JSON.stringify(app.container)} && present = true` : 'id = ""' });
  const containerObs = useCollection<Observation>('observations', { filter: app?.container ? `asset = "${app.asset}" && kind = "container" && subject = ${JSON.stringify(app.container)} && present = true` : 'id = ""' });
  useWatch(app?.asset);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner />
      </div>
    );
  }
  if (!app) return <EmptyState title="App not found" message="It may have been removed." action={<Button variant="secondary" onClick={() => go('home')}>Home</Button>} />;

  const name = appName(app);
  const machine = asset ? asset.label || asset.identifier : '';
  const intent = intents.records[0];
  const reach: Reach = intent?.reach ?? entry?.default_intent ?? 'local_network';
  const source = intent?.source ?? 'default';
  const open = findings.records.filter((f) => f.status === 'open');
  // Running or not: the container report Home and the Apps list read too (health reports are only for some apps).
  const report = (containerObs.records[0]?.data ?? health.records[0]?.data) as { state?: string; running?: boolean } | undefined;
  const now = live.app(app.container);
  const state = now ? now.state : report ? report.state ?? (report.running === false ? 'exited' : 'running') : undefined;
  const running = state === undefined ? null : state === 'running' || state === 'restarting';
  const planFor = plans.records.filter((p) => !p.apps?.length || p.apps.indexOf(app.id) >= 0);
  const reachEval = evals.records.find((e) => e.control === 'REACH-BEYOND-INTENT');
  const cloudApp = ((reachEval?.evidence?.['paths'] as Array<{ hops: Array<{ component: string }> }> | undefined) ?? []).some((p) => p.hops.some((h) => h.component === 'security group' || h.component === 'cloud firewall'));
  const opens = openUrl((app.endpoints ?? []).find((e) => e.proto !== 'udp') ?? null);
  const tab: Tab = part ? TAB_OF[part] : 'overview';
  const gone = app.status === 'gone';
  const tabs: Array<[string, string]> = [['overview', 'Overview'], ...(app.container && !gone ? [['logs', 'Logs'] as [string, string], ['settings', 'Settings'] as [string, string]] : []), ['updates', 'Updates'], ['backups', 'Backups'], ['access', 'Access & safety']];
  const checksOf = (outcome: string): EvaluationRecord[] => evals.records.filter((e) => e.outcome === outcome && e.state !== 'not_applicable');

  let body: React.JSX.Element;
  if (part === 'remote') {
    const primary = (app.endpoints ?? []).find((e) => e.bind !== '127.0.0.1');
    body = <RemoteGuide appName={name} machine={machine} port={primary ? primary.port : (app.endpoints ?? [])[0]?.port ?? null} windows={false} />;
  } else if (tab === 'logs' && app.container) {
    body = <LogsView target={{ app_id: app.id }} assetId={app.asset} />;
  } else if (tab === 'settings' && app.container) {
    body = <AppSettings app={app} />;
  } else if (tab === 'updates') {
    body = (
      <div className="flex flex-col gap-4">
        {app.container && <AppUpdates app={app} />}
        {checksOf('updates').length > 0 && <Card>{checksOf('updates').map((e) => <CheckRow key={e.id} e={e} />)}</Card>}
      </div>
    );
  } else if (tab === 'backups') {
    body = (
      <div className="flex flex-col gap-4">
        {checksOf('backups').length > 0 && <Card>{checksOf('backups').map((e) => <CheckRow key={e.id} e={e} />)}</Card>}
        <OwnBackups app={app} plans={planFor} />
        <BackupPlans app={app} asset={asset} plans={planFor.filter((p) => p.method !== 'netsentry')} canEdit={can('analyst')} />
        {entry && (
          <p className="text-[13px] text-[var(--agent-app-muted)]">
            What matters: {entry.important.join('; ')}.{entry.skip.length ? ` Usually not needed: ${entry.skip.join('; ')}.` : ''}
          </p>
        )}
      </div>
    );
  } else if (tab === 'access') {
    const order = { fail: 0, unknown: 1, pass: 2, accepted: 3, not_applicable: 4 };
    const safety = [...checksOf('reach'), ...checksOf('security')];
    body = (
      <div className="flex flex-col gap-5">
        <Section title="Who can reach it">
          <ReachPaths e={reachEval} />
          <Card>
            <div className="p-4">
              <ReachChooser app={app} current={reach} source={source} canEdit={can('analyst')} cloud={cloudApp} />
            </div>
          </Card>
          <DrillList>
            <DrillRow
              to={to.app(app.id, 'remote')}
              icon={<GlobeIcon size={18} />}
              label="Use it from away, safely"
              hint={cloudApp ? 'Tailscale, Cloudflare Tunnel or a VPN — instead of opening it to the internet' : 'Tailscale, Cloudflare Tunnel or a VPN — instead of opening your router'}
            />
          </DrillList>
        </Section>
        {safety.length > 0 && (
          <Section title="Sign-in and safety">
            <Card>{safety.map((e) => <CheckRow key={e.id} e={e} />)}</Card>
          </Section>
        )}
        {entry?.accounts && (
          <Section title="Who has an account">
            <AppAccess app={app} entry={entry} />
          </Section>
        )}
        <Section title="Everything we check">
          <Card>
            {[...evals.records]
              .filter((e) => e.state !== 'not_applicable')
              .sort((a, b) => order[a.state] - order[b.state])
              .map((e) => (
                <CheckRow key={e.id} e={e} />
              ))}
          </Card>
        </Section>
        <Section title="Technical details">
          <DetailScope on>
            <Card>
              <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 p-4 text-[13px]">
                <dt className="text-[var(--agent-app-muted)]">App</dt>
                <dd>
                  {entry?.name ?? app.app_type}
                  {app.version ? ` ${app.version}` : ''}
                </dd>
                <dt className="text-[var(--agent-app-muted)]">Runs as</dt>
                <dd className="break-all">{app.container ? `container ${app.container}${app.compose_project ? ` (Compose project ${app.compose_project}, service ${app.compose_service})` : ''}` : 'a program on the server'}</dd>
                <dt className="text-[var(--agent-app-muted)]">Listens on</dt>
                <dd className="font-mono">{(app.endpoints ?? []).map((e) => `${e.bind}:${e.port}/${e.proto}`).join(', ') || '—'}</dd>
                <dt className="text-[var(--agent-app-muted)]">Recognised by</dt>
                <dd>{(app.recognised_by ?? []).map((r) => `${r.signal}: ${r.value}`).join(' · ')}</dd>
                <dt className="text-[var(--agent-app-muted)]">First seen</dt>
                <dd>{relTime(app.first_seen)}</dd>
                {entry && (
                  <>
                    <dt className="text-[var(--agent-app-muted)]">Sources</dt>
                    <dd className="flex flex-col">
                      {Object.entries(entry.sources).map(([k, u]) => (
                        <a key={k} href={u} target="_blank" rel="noopener noreferrer" className="break-all text-[var(--agent-app-accent)] hover:underline">
                          {u}
                        </a>
                      ))}
                    </dd>
                  </>
                )}
              </dl>
            </Card>
          </DetailScope>
        </Section>
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col gap-5">
        {app.container && <AppNumbers assetId={app.asset} container={app.container} />}
        {open.length > 0 ? (
          <ProblemList problems={open} title="To fix" />
        ) : (
          <p className="rounded-xl bg-[var(--agent-app-surface-2)] px-4 py-3 text-[14px]" style={{ color: TONE_COLOR.good }}>
            Nothing to fix in {name}.
          </p>
        )}
        <Section title="Changes made">
          <ChangeHistory appId={app.id} />
        </Section>
      </div>
    );
  }

  const trail = part === 'remote' ? [{ label: 'Apps', to: 'apps' }, { label: name, to: to.app(app.id, 'access') }, { label: 'Use it from away' }] : [{ label: 'Apps', to: 'apps' }, { label: name }];
  return (
    <div className={embedded ? 'flex flex-col gap-4' : 'mx-auto flex max-w-3xl flex-col gap-4'}>
      {(!embedded || part === 'remote') && <Breadcrumbs trail={trail} />}
      <div className="flex flex-wrap items-center gap-3.5">
        <span className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-xl bg-[var(--agent-app-surface-2)] text-[var(--agent-app-muted)]">
          <AppIcon category={entry?.category ?? ''} size={24} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-[19px] font-semibold leading-tight">
            {name}
            {app.importance === 'critical' && <Pill tone="warn">Important</Pill>}
          </h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[12.5px] text-[var(--agent-app-muted)]">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-[7px] w-[7px] rounded-full" style={{ background: running === null ? 'var(--agent-app-border)' : running ? TONE_COLOR.good : TONE_COLOR.bad }} aria-hidden />
              {gone ? 'Not on the server any more' : running === null ? 'State not reported yet' : running ? 'Running' : 'Stopped'}
            </span>
            {now && now.running && now.mem !== null && (
              <span className="tabular-nums">
                · {now.mem >= 1e9 ? `${(now.mem / 1e9).toFixed(1)} GB` : `${Math.round(now.mem / 1e6)} MB`}
                {now.cpu !== null ? ` · ${Math.round(now.cpu)}% CPU` : ''}
              </span>
            )}
            <span>· {entry?.what ?? app.app_type}</span>
            {app.version && <span>· version {app.version}</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {opens && running !== false && !gone && (
            <a href={opens} target="_blank" rel="noopener noreferrer" className="inline-flex items-center rounded-md bg-[var(--agent-app-accent)] px-3 py-1.5 text-[13px] font-medium text-[var(--agent-app-accent-contrast)] hover:opacity-90">
              Open
            </a>
          )}
          {app.container && !gone && <RunControls target={{ app_id: app.id }} running={running} />}
          {!gone && <RemoveApp app={app} hasBackup={planFor.some((p) => p.method === 'netsentry')} />}
        </div>
      </div>
      {gone && <p className="rounded-lg bg-[var(--agent-app-surface-2)] px-3 py-2 text-[13px]">Gone from the server since {relTime(app.last_seen)} — if it was removed through NetSentry, Undo is under Changes made below.</p>}
      <div>
        <PageTabs base={to.app(app.id)} tabs={tabs} current={tab} />
        {body}
      </div>
    </div>
  );
}
