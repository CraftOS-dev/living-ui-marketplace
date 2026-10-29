/**
 * Exports: every file the app made (from an image or a batch), with its
 * size, the saving against the original, where it was copied and who made
 * it. Download or delete; filter by format, image or batch.
 */
import { useState } from 'react';
import { ArrowDownToLine, FileDown, FolderOpen, Sparkles, Trash2, X } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { Badge, Button, Empty, IconButton, PageHeader, Segmented, Spinner, errMessage, useConfirm } from '../components/ui.tsx';
import { api, fileUrl } from '../lib/api.ts';
import { ago, bytes, dims as fmtDims, formatLabel, plural, saving } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { navigate, replaceQuery } from '../lib/router.ts';

export function ExportsPage({ query }: { query: URLSearchParams }): React.JSX.Element {
  const [format, setFormat] = useState(query.get('format') ?? '');
  const [batch, setBatch] = useState(query.get('batch') ?? '');
  const list = useLive(() => api.exports({ format, batch, limit: 500 }), ['exports'], [format, batch], 300);
  const [confirmEl, confirm] = useConfirm();
  const rows = list.data?.exports ?? [];
  const remove = async (id: string, name: string): Promise<void> => {
    if (!(await confirm('The kept file is deleted. A copy already written to a folder stays.', 'Delete "' + name + '"?'))) return;
    api.deleteExports([id]).catch((err: unknown) => toast.error(errMessage(err)));
  };
  const savedTotal = rows.reduce((n, r) => n + Math.max(0, r.source_bytes - r.bytes), 0);
  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title="Exports"
        subtitle={list.data !== null ? plural(list.data.total, 'file') + ' · ' + bytes(list.data.total_bytes) + (savedTotal > 0 ? ' · ' + bytes(savedTotal) + ' smaller than the originals' : '') : 'Files the app made'}
        actions={
          <Segmented
            label="Format"
            value={format}
            onChange={(v) => {
              setFormat(v);
              replaceQuery('exports', { format: v, batch });
            }}
            options={[
              { value: '', label: 'All' },
              { value: 'webp', label: 'WebP' },
              { value: 'avif', label: 'AVIF' },
              { value: 'jpeg', label: 'JPEG' },
              { value: 'png', label: 'PNG' },
              { value: 'gif', label: 'GIF' },
              { value: 'ico', label: 'ICO' },
            ]}
          />
        }
      />
      {batch !== '' && (
        <div className="flex items-center gap-2 text-[12px]">
          <Badge tone="info">From one batch</Badge>
          <button
            type="button"
            onClick={() => {
              setBatch('');
              replaceQuery('exports', { format });
            }}
            className="inline-flex items-center gap-1 font-semibold text-[var(--iu-ink-2)] hover:underline"
          >
            <X size={12} aria-hidden /> Show all exports
          </button>
        </div>
      )}
      {list.data === null ? (
        <div className="flex h-40 items-center justify-center text-[var(--iu-muted)]">
          <Spinner size={16} />
        </div>
      ) : rows.length === 0 ? (
        <Empty icon={FileDown} title="No exports yet" action={<Button onClick={() => navigate('home')}>Open the library</Button>}>
          Open an image and use the Export tab: real file sizes before you save, several formats at once.
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-[var(--iu-r-md)] border border-[var(--iu-line)] bg-[var(--iu-card)]">
          <table className="iu-table min-w-[820px]">
            <thead>
              <tr>
                <th>File</th>
                <th>Format</th>
                <th className="text-right">Size</th>
                <th className="text-right">File size</th>
                <th className="text-right">Saving</th>
                <th>Made</th>
                <th className="w-20" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const pct = r.source_bytes > 0 ? (1 - r.bytes / r.source_bytes) * 100 : null;
                return (
                  <tr key={r.id}>
                    <td>
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="max-w-[280px] truncate font-semibold" title={r.path}>
                          {r.name}
                        </span>
                        {r.folder_path !== '' && <FolderOpen size={12} aria-label={'Copied to ' + r.folder_path} className="shrink-0 text-[var(--iu-muted)]" />}
                        {r.requested_by === 'agent' && <Sparkles size={11} aria-label="Made by your AI agent" className="shrink-0 text-[var(--iu-accent-text)]" />}
                      </span>
                      {r.image !== '' && (
                        <button type="button" onClick={() => navigate('image', { id: r.image })} className="text-[12px] text-[var(--iu-muted)] hover:text-[var(--iu-ink)] hover:underline">
                          Open the image
                        </button>
                      )}
                    </td>
                    <td>{formatLabel(r.format)}</td>
                    <td className="num text-right">{fmtDims(r.width, r.height)}</td>
                    <td className="num text-right font-semibold">{bytes(r.bytes)}</td>
                    <td className={cn('num text-right', pct !== null && pct > 0 ? 'text-[var(--iu-green-text)]' : 'text-[var(--iu-muted)]')}>{saving(pct)}</td>
                    <td className="whitespace-nowrap text-[var(--iu-muted)]">{ago(r.created)}</td>
                    <td>
                      <span className="flex justify-end gap-0.5">
                        <a href={fileUrl(r.url, true)} download={r.name} aria-label={'Download ' + r.name} title="Download" className="flex size-7 items-center justify-center rounded-[var(--iu-r)] text-[var(--iu-ink-2)] hover:bg-[var(--iu-row)]">
                          <ArrowDownToLine size={14} aria-hidden />
                        </a>
                        <IconButton icon={Trash2} variant="danger" label="Delete" onClick={() => void remove(r.id, r.name)} />
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {confirmEl}
    </div>
  );
}
