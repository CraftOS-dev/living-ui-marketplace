/**
 * Export: STEP for other CAD tools (re-read to check it), 3MF or STL for
 * slicers, GLB for viewers. The file is kept with the part; the app hands
 * over its download and its path.
 */
import { useState } from 'react';
import { Check, Copy, Download, FileDown } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { api, fileUrl } from '../../lib/api.ts';
import { bytes } from '../../lib/format.ts';
import type { ExportFile } from '../../lib/types.ts';
import { Badge, Button, Modal, Segmented, errMessage } from '../ui.tsx';

type Format = 'step' | '3mf' | 'stl' | 'glb';

const FORMATS: { value: Format; label: string; text: string }[] = [
  { value: 'step', label: 'STEP', text: 'Exact solids for other CAD tools and machining. Bodies keep their names.' },
  { value: '3mf', label: '3MF', text: 'For 3D printing slicers (Bambu, Prusa, Orca, Cura). One object per body, in mm.' },
  { value: 'stl', label: 'STL', text: 'A triangle mesh every slicer reads.' },
  { value: 'glb', label: 'GLB', text: 'A 3D model for viewers, the web and AR (glTF, in metres).' },
];

const QUALITY: { label: string; tol: number }[] = [
  { label: 'Draft', tol: 0.1 },
  { label: 'Normal', tol: 0.02 },
  { label: 'Fine', tol: 0.005 },
];

export function ExportDialog({ open, onClose, part }: { open: boolean; onClose: () => void; part: { id: string; name: string } }): React.JSX.Element {
  const [format, setFormat] = useState<Format>('3mf');
  const [tol, setTol] = useState(0.02);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ file: ExportFile; warning?: string | undefined } | null>(null);

  const run = async (): Promise<void> => {
    setBusy(true);
    setDone(null);
    try {
      const r = await api.exportPart(part.id, format, format === 'step' ? undefined : tol);
      setDone({ file: r.export, warning: r.warning });
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const close = (): void => {
    setDone(null);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={'Export ' + part.name}
      wide
      footer={
        done === null ? (
          <>
            <Button onClick={close}>Cancel</Button>
            <Button variant="primary" icon={FileDown} loading={busy} onClick={() => void run()}>
              Export {FORMATS.find((f) => f.value === format)?.label}
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={close}>
            Done
          </Button>
        )
      }
    >
      {done === null ? (
        <div className="flex flex-col gap-3">
          <div role="radiogroup" aria-label="Format" className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {FORMATS.map((f) => {
              const on = f.value === format;
              return (
                <button
                  key={f.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setFormat(f.value)}
                  className={cn('flex flex-col gap-0.5 rounded-[var(--cw-r)] border p-2 text-left transition-colors', on ? 'border-[var(--cw-ink)] bg-[var(--cw-row)] shadow-[inset_0_0_0_1px_var(--cw-ink)]' : 'border-[var(--cw-line)] bg-[var(--cw-card)] hover:bg-[var(--cw-row)]')}
                >
                  <span className="flex items-center justify-between gap-2 text-[13px] font-bold">
                    {f.label}
                    {on && <Check size={14} aria-hidden className="text-[var(--cw-accent-text)]" />}
                  </span>
                  <span className="text-[12px] leading-4 text-[var(--cw-muted)]">{f.text}</span>
                </button>
              );
            })}
          </div>
          {format !== 'step' && (
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-semibold text-[var(--cw-ink-2)]" title="How closely the triangles follow curved faces">
                Quality
              </span>
              <Segmented
                label="Mesh quality"
                value={String(tol)}
                onChange={(v) => setTol(Number(v))}
                options={QUALITY.map((q) => ({ value: String(q.tol), label: q.label }))}
              />
              <span className="num text-[12px] text-[var(--cw-muted)]">{tol} mm</span>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1.5 rounded-[var(--cw-r)] border border-[var(--cw-line)] bg-[var(--cw-card)] p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[13px] font-bold">{done.file.name}</span>
              {done.file.format === 'step' && <Badge tone={done.file.verified ? 'good' : 'warn'}>{done.file.verified ? 'Checked: same volume' : 'Not verified'}</Badge>}
            </div>
            <p className="num text-[12px] text-[var(--cw-muted)]">
              {bytes(done.file.bytes)}
              {done.file.triangles !== null ? ', ' + done.file.triangles.toLocaleString('en-US') + ' triangles' : ''}
            </p>
            <p className="mono break-all rounded-[var(--cw-r-sm)] bg-[var(--cw-row)] px-1.5 py-1 text-[var(--cw-ink-2)]">{done.file.path}</p>
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              <a href={fileUrl(done.file.url, true)} download={done.file.name} className="cw-on-ink inline-flex h-7 items-center gap-1.5 rounded-[var(--cw-r)] bg-[var(--cw-ink)] px-2.5 text-[13px] font-semibold text-[var(--cw-shell)] hover:bg-[var(--cw-ink)]/90">
                <Download size={14} aria-hidden className="text-[var(--cw-accent)]" /> Download
              </a>
              <Button icon={Copy} onClick={() => void navigator.clipboard.writeText(done.file.path).then(() => toast.success('Copied the path'))}>
                Copy path
              </Button>
            </div>
          </div>
          {done.warning !== undefined && <p className="rounded-[var(--cw-r)] border-l-2 border-[var(--cw-amber)] bg-[var(--cw-amber)]/15 px-2.5 py-1.5 text-[12px]">{done.warning}</p>}
          {done.file.format === 'step' && !done.file.verified && <p className="text-[12px] text-[var(--cw-ink-2)]">Reading the file back gave a different volume than the part. Open it in your other CAD tool to check it before you rely on it.</p>}
        </div>
      )}
    </Modal>
  );
}
