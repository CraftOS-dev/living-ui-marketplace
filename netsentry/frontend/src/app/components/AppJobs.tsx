/**
 * An app's settings, removing it, and installing any app from a Compose file (v4 plan §7.2–§7.4).
 *
 *   Settings  a form for its Compose file: ports, settings (environment — secret values stay hidden
 *             unless you type a new one), restart rule; "Edit the Compose file" for anything else,
 *             with the change shown line by line and any new risk accepted one by one.
 *   Remove    keep its data (Undo starts it again) or remove everything (its folder to NetSentry's
 *             bin for 7 days); back it up first when NetSentry backs it up.
 *   Any app   paste a Compose file → NetSentry lists what it sees and every risk → you accept each.
 */
import { useMemo, useState } from 'react';
import { Button, Dialog, Input, Pill, Select, Spinner, Textarea, toast } from '../../kit/index.ts';
import { useMe } from '../lib/me.tsx';
import { runOp } from '../lib/ops.ts';
import { readServer, useServerRead } from '../lib/serverRead.ts';
import type { AppRecord } from '../lib/types.ts';
import { useAfterChange, useChange, Working, type Preview } from './Controls.tsx';
import { DiffView } from './FilesPanel.tsx';

const HIDDEN = '••• hidden •••';

interface Port {
  target: number;
  published: number | string;
  protocol: string;
  host_ip: string;
}
interface Risk {
  id: string;
  words: string;
  level: 'high' | 'medium' | 'low';
}
interface Settings {
  container: string;
  image: string;
  compose: boolean;
  project?: string;
  folder?: string;
  file?: string;
  file_sha256?: string;
  file_text?: string | null;
  restart: string;
  ports: Port[];
  environment: Record<string, string>;
  volumes: Array<{ type: string; source: string; target: string; read_only: boolean }>;
  risks?: Risk[];
  why_not?: string;
}

function RiskList({ risks, accepted, onToggle }: { risks: Risk[]; accepted: Set<string>; onToggle: (id: string) => void }): React.JSX.Element | null {
  if (!risks.length) return null;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-[var(--agent-app-border)] p-3">
      <p className="text-[13px] font-medium">NetSentry found {risks.length === 1 ? 'something' : `${risks.length} things`} this lets the app do beyond its own folder. Tick each one you accept:</p>
      {risks.map((r) => (
        <label key={r.id} className="flex items-start gap-2 text-[13px]">
          <input type="checkbox" className="mt-1" checked={accepted.has(r.id)} onChange={() => onToggle(r.id)} />
          <span>
            <Pill tone={r.level === 'high' ? 'bad' : r.level === 'medium' ? 'warn' : 'neutral'}>{r.level === 'high' ? 'serious' : r.level === 'medium' ? 'worth knowing' : 'minor'}</Pill> {r.words}
          </span>
        </label>
      ))}
    </div>
  );
}

function useAccepted(): [Set<string>, (id: string) => void, () => void] {
  const [s, set] = useState<Set<string>>(new Set());
  return [s, (id) => set((x) => {
    const n = new Set(x);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  }), () => set(new Set())];
}

export function AppSettings({ app }: { app: AppRecord }): React.JSX.Element {
  const { can } = useMe();
  const admin = can('admin');
  const r = useServerRead<Settings>('app.settings', { app_id: app.id }, admin);
  const flow = useChange();
  useAfterChange(flow.status, r.reload);
  const [ports, setPorts] = useState<Record<number, string>>({});
  const [env, setEnv] = useState<Record<string, string | null>>({});
  const [newVar, setNewVar] = useState({ name: '', value: '' });
  const [restart, setRestart] = useState('');
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [checked, setChecked] = useState<{ risks: Risk[] } | null>(null);
  const [checking, setChecking] = useState(false);
  const [accepted, toggle, resetAccepted] = useAccepted();
  const s = r.data;

  if (!admin) return <p className="text-[14px] text-[var(--agent-app-muted)]">Only an admin can see and change an app's settings.</p>;
  if (r.error) return <p className="text-[13px] text-red-700 dark:text-red-400">{r.error}</p>;
  if (!s)
    return (
      <p className="flex items-center gap-2 text-[13px] text-[var(--agent-app-muted)]">
        <Spinner /> Reading its settings on the server…
      </p>
    );

  const editable = s.compose && !s.why_not;
  s.ports = s.ports ?? [];
  s.environment = s.environment ?? {};
  s.volumes = s.volumes ?? [];
  const changes: Record<string, unknown> = {};
  const changedPorts = s.ports.some((p, i) => ports[i] !== undefined && ports[i] !== String(p.published));
  if (changedPorts) changes['ports'] = s.ports.map((p, i) => ({ target: p.target, published: ports[i] ?? String(p.published), protocol: p.protocol, host_ip: p.host_ip }));
  const envChanges = Object.fromEntries(Object.entries(env).filter(([k, v]) => v !== (s.environment[k] ?? undefined)));
  if (Object.keys(envChanges).length) changes['environment'] = envChanges;
  if (restart && restart !== s.restart) changes['restart'] = restart;
  const dirty = Object.keys(changes).length > 0;
  const portOk = Object.values(ports).every((v) => /^\d{1,5}$/.test(v) && Number(v) > 0 && Number(v) < 65536);

  const save = (): void =>
    void flow.ask(
      () => runOp<Preview>('apps.settings-save', { app_id: app.id, changes: JSON.stringify(changes), file: s.file!, file_sha256: s.file_sha256!, accepted_risks: JSON.stringify([...accepted]) }),
      'Save',
    ).then(() => (setPorts({}), setEnv({}), setRestart('')));

  const checkEdit = async (): Promise<void> => {
    setChecking(true);
    try {
      const folder = s.folder ?? '';
      const parts = folder.split(/[\\/]/).filter(Boolean);
      const res = await readServer<{ risks: Risk[] }>('compose.check', { content: text, name: parts[parts.length - 1] ?? 'app', root: folder.slice(0, folder.length - (parts[parts.length - 1] ?? '').length).replace(/[\\/]$/, '') || '/' });
      const before = new Set((s.risks ?? []).map((x) => x.id));
      setChecked({ risks: res.risks.filter((x) => !before.has(x.id)) });
      resetAccepted();
    } catch (e) {
      setChecked(null);
      toast.error(e instanceof Error ? e.message : 'Docker could not read it.');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {s.why_not && <p className="rounded-lg bg-[var(--agent-app-surface-2)] p-3 text-[13px]">{s.why_not}</p>}
      {r.loading && (
        <p className="flex items-center gap-2 text-[13px] text-[var(--agent-app-muted)]">
          <Spinner /> Reading its settings again…
        </p>
      )}
      <section className="flex flex-col gap-2">
        <h2 className="px-1 text-[13px] font-semibold">Ports</h2>
        <div className="rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] p-4">
          {s.ports.length === 0 && <p className="text-[14px] text-[var(--agent-app-muted)]">It publishes no ports.</p>}
          {s.ports.map((p, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2 py-1">
              <div className="w-32">
                <Input label={i === 0 ? 'On the server' : undefined} aria-label={`Server port for ${p.target}`} value={ports[i] ?? String(p.published)} disabled={!editable} onChange={(e) => setPorts({ ...ports, [i]: e.target.value.replace(/\D/g, '') })} inputMode="numeric" />
              </div>
              <span className="pb-2 text-[13px] text-[var(--agent-app-muted)]">
                → the app's {p.target}/{p.protocol} · {p.host_ip && !['0.0.0.0', '::'].includes(p.host_ip) ? `only on ${p.host_ip}` : 'on every address of the server'}
              </span>
            </div>
          ))}
        </div>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="px-1 text-[13px] font-semibold">Settings it starts with</h2>
        <div className="flex flex-col gap-2 rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] p-4">
          {Object.entries(s.environment).length === 0 && <p className="text-[14px] text-[var(--agent-app-muted)]">None.</p>}
          {Object.entries(s.environment).map(([k, v]) => (
            <div key={k} className="flex flex-wrap items-center gap-2">
              <span className="w-48 truncate font-mono text-[13px]" title={k}>
                {k}
              </span>
              <div className="min-w-0 flex-1">
                <Input
                  aria-label={k}
                  value={env[k] === undefined ? (v === HIDDEN ? '' : v) : env[k] ?? ''}
                  placeholder={v === HIDDEN ? 'hidden — type a new value to change it' : ''}
                  disabled={!editable || env[k] === null}
                  onChange={(e) => setEnv({ ...env, [k]: e.target.value === '' && v === HIDDEN ? HIDDEN : e.target.value })}
                />
              </div>
              {editable && (
                <Button size="sm" variant="ghost" onClick={() => setEnv({ ...env, [k]: env[k] === null ? v : null })}>
                  {env[k] === null ? 'Keep' : 'Remove'}
                </Button>
              )}
            </div>
          ))}
          {editable && (
            <div className="flex flex-wrap items-end gap-2 border-t border-[var(--agent-app-border)] pt-2">
              <div className="w-48">
                <Input label="New setting" value={newVar.name} onChange={(e) => setNewVar({ ...newVar, name: e.target.value.replace(/[^A-Za-z0-9_.-]/g, '') })} placeholder="NAME" />
              </div>
              <div className="min-w-0 flex-1">
                <Input label="Value" value={newVar.value} onChange={(e) => setNewVar({ ...newVar, value: e.target.value })} />
              </div>
              <Button size="sm" variant="secondary" disabled={!newVar.name} onClick={() => (setEnv({ ...env, [newVar.name]: newVar.value }), setNewVar({ name: '', value: '' }))}>
                Add
              </Button>
            </div>
          )}
          {Object.entries(env).filter(([k]) => !(k in s.environment)).map(([k, v]) => (
            <p key={k} className="font-mono text-[13px]">
              + {k}={v}
            </p>
          ))}
        </div>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="px-1 text-[13px] font-semibold">When it stops</h2>
        <div className="rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] p-4">
          <Select
            label="Start it again"
            value={restart || s.restart}
            disabled={!editable}
            onChange={(e) => setRestart(e.target.value)}
            options={[
              { value: 'unless-stopped', label: 'Always, unless someone stopped it (recommended)' },
              { value: 'always', label: 'Always' },
              { value: 'on-failure', label: 'Only when it crashed' },
              { value: 'no', label: 'Never' },
            ]}
          />
        </div>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="px-1 text-[13px] font-semibold">Folders it uses</h2>
        <div className="rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] p-4 text-[13px]">
          {s.volumes.length === 0 && <p className="text-[var(--agent-app-muted)]">None.</p>}
          {s.volumes.map((v) => (
            <p key={v.target} className="break-all">
              <span className="font-mono">{v.target}</span> ←{' '}
              {v.type === 'volume' ? (/^[0-9a-f]{64}$/.test(v.source) ? 'an unnamed Docker volume' : <>Docker volume <span className="font-mono">{v.source}</span></>) : <span className="font-mono">{v.source}</span>}
              {v.read_only ? ' (read-only)' : ''}
            </p>
          ))}
          {editable && s.file_text && <p className="mt-2 text-[12px] text-[var(--agent-app-muted)]">To change folders, edit the Compose file (below).</p>}
        </div>
      </section>
      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          {flow.status && <Working status={flow.status} />}
          <Button disabled={!dirty || !portOk || flow.working} onClick={save}>
            Save…
          </Button>
          {s.file_text && (
            <Button variant="ghost" onClick={() => (setEditing(true), setText(s.file_text ?? ''), setChecked(null))}>
              Edit the Compose file
            </Button>
          )}
          <span className="text-[12px] text-[var(--agent-app-muted)]">If it's running, it restarts with the new settings — and if it doesn't come back healthy, the old ones go back by themselves. A stopped app stays stopped.</span>
        </div>
      )}
      <Dialog
        open={editing}
        onOpenChange={setEditing}
        title={s.file ?? 'Compose file'}
        description="Your own edit: Docker checks it, NetSentry lists anything new it allows, then it's brought up with the health check and put back if it fails."
        className="max-w-4xl"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            {!checked ? (
              <Button loading={checking} disabled={text === s.file_text} onClick={() => void checkEdit()}>
                Check it
              </Button>
            ) : (
              <Button
                disabled={checked.risks.some((x) => !accepted.has(x.id))}
                onClick={() => {
                  setEditing(false);
                  void flow.ask(() => runOp<Preview>('apps.compose-save', { app_id: app.id, content: text, file: s.file!, file_sha256: s.file_sha256!, accepted_risks: JSON.stringify([...accepted]) }), 'Save');
                }}
              >
                Save…
              </Button>
            )}
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <Textarea aria-label="Compose file" rows={16} className="font-mono text-[12px]" value={text} spellCheck={false} onChange={(e) => (setText(e.target.value), setChecked(null))} />
          {text !== s.file_text && <DiffView before={s.file_text ?? ''} after={text} />}
          {checked && (checked.risks.length ? <RiskList risks={checked.risks} accepted={accepted} onToggle={toggle} /> : <p className="text-[13px]">Docker reads it, and it lets the app do nothing new beyond its own folder and the folders this server allows.</p>)}
        </div>
      </Dialog>
      {flow.element}
    </div>
  );
}

/** Header button: remove the app (keep its data, or everything). */
export function RemoveApp({ app, hasBackup }: { app: AppRecord; hasBackup: boolean }): React.JSX.Element | null {
  const { can } = useMe();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'keep' | 'everything'>('keep');
  const [backup, setBackup] = useState(hasBackup);
  const flow = useChange();
  if (!can('analyst') || !app.container) return null;
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => (setOpen(true), setBackup(hasBackup))}>
        Remove…
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={`Remove ${app.label || app.display_name}`}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setOpen(false);
                void flow.ask(() => runOp<Preview>('apps.remove', { app_id: app.id, mode, backup_first: backup }), 'Remove it', true);
              }}
            >
              Next…
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3 text-[14px]">
          <label className="flex items-start gap-2">
            <input type="radio" className="mt-1" checked={mode === 'keep'} onChange={() => setMode('keep')} />
            <span>
              <strong>Keep its data.</strong> It stops and is removed; its folder and data stay, and Undo starts it again.
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" className="mt-1" checked={mode === 'everything'} onChange={() => setMode('everything')} />
            <span>
              <strong>Remove everything.</strong> Its folder goes to NetSentry's bin for 7 days; its Docker volumes are deleted for good.
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={backup} disabled={!hasBackup} onChange={(e) => setBackup(e.target.checked)} />
            <span>{hasBackup ? 'Back it up first (if that fails, nothing is removed)' : "Back it up first — NetSentry doesn't back it up yet (set that up on its Backups tab)"}</span>
          </label>
        </div>
      </Dialog>
      {flow.status && <Working status={flow.status} />}
      {flow.element}
    </>
  );
}

/** Add an app → paste a Compose file (§7.4, V4-D5). */
export function CustomInstall(): React.JSX.Element {
  const { can } = useMe();
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<{ services: Array<{ name: string; image: string; ports: string[]; builds: boolean }>; risks: Risk[] } | null>(null);
  const [error, setError] = useState('');
  const [accepted, toggle, reset] = useAccepted();
  const flow = useChange();
  const [installed, setInstalled] = useState('');
  useAfterChange(flow.status, () => {
    setInstalled(name || project);
    setResult(null);
    setContent('');
    setName('');
  });
  const project = useMemo(() => name.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^-+/, '').slice(0, 40), [name]);
  if (!can('admin')) return <p className="text-[14px]">Only an admin can add apps.</p>;
  const check = async (): Promise<void> => {
    setChecking(true);
    setError('');
    try {
      setResult(await readServer('compose.check', { content, name: project }));
      reset();
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : 'Docker could not read it.');
    } finally {
      setChecking(false);
    }
  };
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] p-4">
      <p className="text-[14px]">
        Any app with a Compose file (from its website or GitHub). NetSentry asks Docker to read it, shows what it will run and everything it lets the app do beyond its own folder — you accept each one before it's installed.
      </p>
      <Input label="Name (its folder)" value={name} onChange={(e) => (setName(e.target.value), setResult(null))} placeholder="e.g. paperless" />
      <Textarea label="Compose file" rows={12} className="font-mono text-[12px]" value={content} spellCheck={false} onChange={(e) => (setContent(e.target.value), setResult(null))} placeholder={'services:\n  app:\n    image: …'} />
      {error && <p className="text-[13px] text-red-700 dark:text-red-400">{error}</p>}
      {installed && !flow.status && (
        <p className="rounded-lg bg-[var(--agent-app-surface-2)] p-3 text-[13px]">
          {installed}: finished — see whether it runs under <a href="#/apps" className="underline">Apps</a> (and what happened under Server → Changes made).
        </p>
      )}
      {result && (
        <div className="flex flex-col gap-2 text-[13px]">
          <p className="font-medium">It runs:</p>
          {result.services.map((s) => (
            <p key={s.name}>
              <span className="font-mono">{s.name}</span> — {s.builds ? 'built from source on the server' : s.image}
              {s.ports.length ? ` · ${s.ports.join(', ')}` : ''}
            </p>
          ))}
          {result.risks.length ? <RiskList risks={result.risks} accepted={accepted} onToggle={toggle} /> : <p>It asks for nothing beyond its own folder and the folders this server allows.</p>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {flow.status && <Working status={flow.status} />}
        {!result ? (
          <Button loading={checking} disabled={!project || !content.trim()} onClick={() => void check()}>
            Check it
          </Button>
        ) : (
          <Button
            disabled={result.risks.some((r) => !accepted.has(r.id)) || flow.working || !!flow.status}
            onClick={() => void flow.ask(() => runOp<Preview>('installs.request-custom', { name: project, label: name, content, accepted_risks: JSON.stringify([...accepted]) }), 'Install it')}
          >
            Install…
          </Button>
        )}
        <span className="text-[12px] text-[var(--agent-app-muted)]">Its folder: /srv/apps/{project || '…'}</span>
      </div>
      {flow.element}
    </div>
  );
}
