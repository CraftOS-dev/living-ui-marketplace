/**
 * Add an app (#/install) — v3 plan §12. Pick an app from NetSentry's list,
 * say who should reach it; NetSentry shows exactly what it
 * will create, an admin confirms, the server's monitor installs it (secure
 * by default) and checks it came up. Then: its first-time setup link.
 */
import { useEffect, useMemo, useState } from 'react';
import { Button, EmptyState, Input, Pill, Select, Spinner } from '../../kit/index.ts';
import { useCollection } from '../store/collections.ts';
import { useOp } from '../store/resources.ts';
import { Breadcrumbs } from '../components/Breadcrumbs.tsx';
import { useChange, Working, type Preview } from '../components/Controls.tsx';
import { CustomInstall } from '../components/AppJobs.tsx';
import { useMe } from '../lib/me.tsx';
import { runOp } from '../lib/ops.ts';
import type { Asset, Sensor } from '../lib/types.ts';

interface Template {
  id: string;
  name: string;
  category: string;
  port: number;
  needs: string[];
  host_network: boolean;
}

const CATEGORY: Record<string, string> = {
  media: 'Movies, TV and music',
  downloads: 'Downloads',
  photos: 'Photos',
  passwords: 'Passwords',
  files: 'Files',
  home: 'Smart home',
  monitoring: 'Keeping an eye on things',
  business: 'Business',
  code: 'Code',
  docs: 'Documentation',
  chat: 'Team chat',
};

export function InstallApp(): React.JSX.Element {
  const { can } = useMe();
  const [pick, setPick] = useState<Template | null>(null);
  const tpl = useOp<{ templates: Template[] }>('installs.templates', {}, { freshMs: 300000 });
  const templates = tpl.data ? tpl.data.templates : tpl.error ? [] : null;
  const groups = useMemo(() => {
    const g: Record<string, Template[]> = {};
    for (const t of templates ?? []) (g[t.category] = g[t.category] ?? []).push(t);
    return g;
  }, [templates]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <Breadcrumbs trail={[{ label: 'Home', to: 'home' }, { label: 'Add an app' }]} />
        <h1 className="text-[20px] font-semibold">Add an app</h1>
        <p className="mt-1 text-[14px] text-[var(--agent-app-muted)]">
          Set up safely from the start: its own folder, an ordinary user (not the administrator), reachable only where you say, logs that can't fill the disk, passwords made on the server.
        </p>
      </div>
      {!can('admin') && <p className="text-[14px]">Only an admin can add apps.</p>}
      {templates === null ? (
        <Spinner />
      ) : pick ? (
        <InstallForm t={pick} onBack={() => setPick(null)} />
      ) : (
        [
          <section key="custom">
            <h2 className="mb-2 px-1 text-[13px] font-semibold">Any other app — paste its Compose file</h2>
            <CustomInstall />
          </section>,
        ].concat(Object.entries(groups).map(([cat, list]) => (
          <section key={cat}>
            <h2 className="mb-2 px-1 text-[13px] font-semibold">{CATEGORY[cat] ?? cat}</h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {list.map((t) => (
                <button
                  key={t.id}
                  disabled={!can('admin')}
                  onClick={() => setPick(t)}
                  className="flex items-center justify-between rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] px-4 py-3 text-left hover:bg-[var(--agent-app-surface-2)] disabled:opacity-60"
                >
                  <span className="text-[15px] font-medium">{t.name}</span>
                  {t.needs.includes('data_root') && <span className="text-[12px] text-[var(--agent-app-muted)]">needs your media folder</span>}
                </button>
              ))}
            </div>
          </section>
        )))
      )}
    </div>
  );
}

function InstallForm({ t, onBack }: { t: Template; onBack: () => void }): React.JSX.Element {
  const assets = useCollection<Asset>('assets', { filter: 'kind = "host" && status = "active"' });
  const sensors = useCollection<Sensor>('sensors', { filter: 'status != "revoked"' });
  const manageable = assets.records.filter((a) => sensors.records.some((s) => s.asset === a.id && ((s.capabilities as Record<string, { available?: boolean }> | null)?.['executor']?.available ?? false)));
  const [asset, setAsset] = useState('');
  const [name, setName] = useState(t.id);
  const [reach, setReach] = useState('local_network');
  const [data, setData] = useState('/srv/data');
  const [root, setRoot] = useState('/srv/apps');
  const flow = useChange();
  const [setup, setSetup] = useState<string | null>(null);
  const machine = asset || manageable[0]?.id || '';

  if (assets.loading || sensors.loading) return <Spinner />;
  if (!manageable.length) {
    return (
      <EmptyState
        title="Changes are switched off on this server"
        message="Installing an app is a change: allow changes on the server first (Settings → Monitor)."
        action={
          <Button variant="secondary" onClick={onBack}>
            Back
          </Button>
        }
      />
    );
  }
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Etc/UTC';
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[16px] font-semibold">{t.name}</h2>
        <Button size="sm" variant="ghost" onClick={onBack}>
          Choose another
        </Button>
      </div>
      <Input label="Name (its folder)" value={name} onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '-'))} />
      {t.host_network ? (
        <p className="text-[13px] text-[var(--agent-app-muted)]">{t.name} shares the server's network so devices on it can find it — everyone on your local network can reach it.</p>
      ) : (
        <Select
          label="Who should reach it"
          value={reach}
          onChange={(e) => setReach(e.target.value)}
          options={[
            { value: 'local_network', label: 'Everyone on my local network' },
            { value: 'this_machine', label: 'Only this server' },
          ]}
        />
      )}
      {t.needs.includes('data_root') && <Input label="Your media folder on the server" value={data} onChange={(e) => setData(e.target.value)} placeholder="/srv/data" />}
      <Input label="Where apps live on the server" value={root} onChange={(e) => setRoot(e.target.value)} />
      <p className="text-[12px] text-[var(--agent-app-muted)]">To use it from away later, see the app → Use it from away, safely (never by opening your router).</p>
      <div className="flex items-center gap-2">
        {flow.status ? (
          <Working status={flow.status} />
        ) : (
          <Button
            disabled={flow.working || !name}
            onClick={() =>
              void flow.ask(async () => {
                const r = await runOp<Preview & { setup_url: string }>('installs.request', { asset_id: machine, template: t.id, name, reach, data_root: t.needs.includes('data_root') ? data : undefined, root, tz });
                setSetup(r.setup_url);
                return r;
              }, 'Install now')
            }
          >
            Install {t.name}
          </Button>
        )}
      </div>
      {setup && !flow.status && (
        <p className="text-[13px]">
          <Pill tone="info">next</Pill> Once it runs, finish its first-time setup:{' '}
          <a href={setup} target="_blank" rel="noopener noreferrer" className="text-[var(--agent-app-accent)] hover:underline">
            {setup}
          </a>
        </p>
      )}
      {flow.element}
    </div>
  );
}
