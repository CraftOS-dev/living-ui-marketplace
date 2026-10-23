import { useState } from 'react';
import { AlertTriangle, FlaskConical, RotateCcw } from 'lucide-react';
import { toast } from '../../kit/index.ts';
import { errMessage, op } from '../lib/api.ts';
import { changed } from '../lib/live.ts';
import { Button, Modal, inputCls } from './ui.tsx';

type Preview = { counts: Record<string, number>; fingerprint: string; phrase: string; preserves: string[]; projects: { name: string; question: string; scope: string }[]; note: string };
type Result = { projects: { id: string; name: string }[] };
export default function DemoReset(): React.JSX.Element {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [phrase, setPhrase] = useState('');
  const [acknowledge, setAcknowledge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const open = async (): Promise<void> => {
    setBusy(true); setError(''); setPhrase(''); setAcknowledge(false);
    try { setPreview(await op<Preview>('demo.preview')); } catch (err) { setError(errMessage(err)); } finally { setBusy(false); }
  };
  const reset = async (): Promise<void> => {
    if (preview === null || phrase !== preview.phrase || !acknowledge) return;
    setBusy(true); setError('');
    try {
      const next = await op<Result>('demo.reset', { phrase, acknowledge, fingerprint: preview.fingerprint, confirm: true });
      setResult(next); setPreview(null); setPhrase(''); setAcknowledge(false);
      // Clear this app's persisted paper tabs and selections after old IDs are removed.
      try { for (const key of Object.keys(localStorage)) if (['ro_reader_tabs', 'ro_home_project', 'ro_last_project'].includes(key) || key.startsWith('ro_repo_open_')) localStorage.removeItem(key); } catch { /* Storage can be disabled; the server reset still succeeded. */ }
      changed('projects', 'works', 'notes', 'nodes', 'relations', 'tasks', 'experiments', 'manuscripts', 'files', 'activity');
      toast.success('Loaded four synthetic demo projects');
    } catch (err) { setError(errMessage(err)); } finally { setBusy(false); }
  };
  return <section className="border-t border-[var(--ro-line)] py-5">
    <div className="flex items-start gap-2"><FlaskConical size={15} className="mt-0.5 shrink-0 text-[var(--ro-muted)]" /><div><h2 className="text-[13px] font-bold">Presentation demo</h2><p className="mt-1 text-[12px] text-[var(--ro-muted)]">Replace research data with four connected, clearly labeled synthetic projects. Keeps your settings and connected accounts.</p></div></div>
    <div className="mt-3 flex flex-wrap items-center gap-3"><Button icon={RotateCcw} variant="danger" loading={busy} onClick={() => void open()}>Preview reset and load demo</Button><span className="text-[12px] text-[var(--ro-red-text)]">Permanent deletion. No optional backup.</span></div>
    {error !== '' && preview === null && <p role="alert" className="mt-2 text-[12px] text-[var(--ro-red-text)]">{error}</p>}
    {result !== null && <div className="mt-3 rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)] p-3"><p role="status" className="text-[13px] font-semibold">Four demo projects are ready</p><div className="mt-2 flex flex-wrap gap-2">{result.projects.map((p) => <a key={p.id} href={'#/project?id=' + p.id} className="cursor-pointer text-[12px] text-[var(--ro-accent-text)] underline underline-offset-2">{p.name}</a>)}</div></div>}
    <Modal open={preview !== null} onClose={() => { if (!busy) { setPreview(null); setError(''); } }} title="Reset and load demo" icon={AlertTriangle} wide footer={<><Button disabled={busy} onClick={() => { setPreview(null); setError(''); }}>Cancel</Button><Button variant="danger" loading={busy} disabled={preview === null || phrase !== preview.phrase || !acknowledge} onClick={() => void reset()}>Permanently reset and load demo</Button></>}>
      {preview !== null && <div className="flex flex-col gap-4">
        <p className="text-[13px] leading-5 text-[var(--ro-red-text)]">All existing research records and uploaded attachments will be deleted. This cannot be undone here. No optional backup will be made.</p>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[['Projects','projects'],['Papers','works'],['PDFs','files'],['Notes','notes'],['Tasks','tasks'],['Experiments','experiments'],['Manuscripts','manuscripts'],['Repository files / folders','repo_items']].map(([label,key]) => <div key={key} className="rounded-[var(--ro-r)] border border-[var(--ro-line)] p-2"><dt className="text-[12px] text-[var(--ro-muted)]">{label}</dt><dd className="num text-[15px] font-bold">{preview.counts[key ?? ''] ?? 0}</dd></div>)}</dl>
        <details className="text-[12px]"><summary className="cursor-pointer font-semibold">All affected record counts</summary><div className="mt-2 grid grid-cols-2 gap-1">{Object.entries(preview.counts).map(([name,count]) => <div key={name}>{name}: {count}</div>)}</div></details>
        <div><h3 className="text-[13px] font-bold">The four replacement projects</h3><ul className="mt-2 flex flex-col gap-2">{preview.projects.map((p) => <li key={p.name} className="border-l-2 border-[var(--ro-line)] pl-2"><p className="text-[13px] font-semibold">{p.name}</p><p className="text-[12px] text-[var(--ro-muted)]">{p.question}</p></li>)}</ul></div>
        <p className="text-[12px] text-[var(--ro-muted)]">Preserved: {preview.preserves.join(', ')}. Mock publications remain non-citable. Claims and drafts remain proposed. Platform deployment backups are separate from this action.</p>
        <label className="flex flex-col gap-1 text-[12px] font-semibold">Type {preview.phrase}<input autoComplete="off" spellCheck={false} value={phrase} onChange={(e) => setPhrase(e.target.value)} aria-label="Reset confirmation phrase" className={inputCls} disabled={busy} /></label>
        <label className="flex cursor-pointer items-start gap-2 text-[12px]"><input type="checkbox" checked={acknowledge} onChange={(e) => setAcknowledge(e.target.checked)} disabled={busy} />I understand that my research data and files will be permanently deleted without an optional backup.</label>
        {error !== '' && <div role="alert" className="text-[12px] text-[var(--ro-red-text)]">{error}<div className="mt-2"><Button disabled={busy} onClick={() => void open()}>Refresh preview</Button></div></div>}
      </div>}
    </Modal>
  </section>;
}
