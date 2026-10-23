/**
 * Exports: every file made from a part, newest first, as a dense table with
 * its format, part, size, who made it, whether the part has changed since,
 * and its download and path.
 */
import { useState } from 'react';
import { Copy, Download, FileDown, Sparkles } from 'lucide-react';
import { toast } from '../../kit/index.ts';
import { DeleteButton } from '../components/DeleteButton.tsx';
import { Badge, Empty, IconButton, PageHeader, Panel, Segmented, Spinner } from '../components/ui.tsx';
import { api, fileUrl } from '../lib/api.ts';
import { ago, bytes } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { navigate } from '../lib/router.ts';

type Fmt = 'all' | 'step' | '3mf' | 'stl' | 'glb';

export function ExportsPage(): React.JSX.Element {
  const [fmt, setFmt] = useState<Fmt>('all');
  const list = useLive(() => api.exports({ format: fmt === 'all' ? undefined : fmt, limit: 200 }), ['exports', 'parts'], [fmt]);
  const rows = list.data?.exports ?? [];
  return (
    <div>
      <PageHeader title="Exports" subtitle="Files made from your parts. They stay here until you delete them." />
      <div className="mb-3">
        <Segmented<Fmt>
          label="Format"
          value={fmt}
          onChange={setFmt}
          options={[
            { value: 'all', label: 'All' },
            { value: 'step', label: 'STEP' },
            { value: '3mf', label: '3MF' },
            { value: 'stl', label: 'STL' },
            { value: 'glb', label: 'GLB' },
          ]}
        />
      </div>
      {list.loading && list.data === null ? (
        <div className="flex justify-center py-16">
          <Spinner size={20} />
        </div>
      ) : rows.length === 0 ? (
        <Panel padded={false}>
          <Empty icon={FileDown} title="No exports yet">
            Open a part and press Export: STEP for CAD and machining, 3MF or STL for 3D printing.
          </Empty>
        </Panel>
      ) : (
        <Panel padded={false}>
          <div className="overflow-x-auto">
            <table className="cw-table">
              <thead>
                <tr>
                  <th className="w-16">Format</th>
                  <th>File</th>
                  <th className="hidden md:table-cell">Part</th>
                  <th className="hidden text-right sm:table-cell">Size</th>
                  <th className="hidden lg:table-cell">State</th>
                  <th className="hidden text-right sm:table-cell">Made</th>
                  <th className="w-24">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((x) => (
                  <tr key={x.id}>
                    <td>
                      <span className="cw-on-ink inline-flex h-5 items-center rounded-[var(--cw-r-sm)] bg-[var(--cw-ink)] px-1.5 text-[12px] font-bold uppercase text-[var(--cw-shell)]">{x.format}</span>
                    </td>
                    <td className="w-full min-w-[160px] max-w-0">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-[13px] font-semibold">{x.name}</span>
                        {x.requested_by === 'agent' && <Sparkles size={12} aria-label="Made by your AI agent" className="shrink-0 text-[var(--cw-accent-text)]" />}
                      </span>
                      <span className="mono block truncate text-[var(--cw-muted)]" title={x.path}>
                        {x.path}
                      </span>
                    </td>
                    <td className="hidden max-w-[200px] md:table-cell">
                      {x.part !== null ? (
                        <button type="button" onClick={() => navigate('part', { id: x.part?.id ?? '' })} className="truncate text-[12px] font-semibold text-[var(--cw-ink-2)] underline-offset-4 hover:underline">
                          {x.part.name}
                        </button>
                      ) : (
                        <span className="text-[12px] text-[var(--cw-muted)]">Part deleted</span>
                      )}
                    </td>
                    <td className="num hidden whitespace-nowrap text-right text-[12px] sm:table-cell">{bytes(x.bytes)}</td>
                    <td className="hidden lg:table-cell">
                      <span className="flex flex-wrap gap-1">
                        {x.format === 'step' && x.verified && <Badge tone="good">Checked</Badge>}
                        {x.outdated && <Badge tone="warn">Part changed since</Badge>}
                      </span>
                    </td>
                    <td className="num hidden whitespace-nowrap text-right text-[12px] text-[var(--cw-muted)] sm:table-cell">{ago(x.created)}</td>
                    <td>
                      <span className="flex items-center justify-end gap-0.5">
                        <a href={fileUrl(x.url, true)} download={x.name} aria-label={'Download ' + x.name} title="Download" className="flex size-7 items-center justify-center rounded-[var(--cw-r)] text-[var(--cw-ink-2)] hover:bg-[var(--cw-row-hover)] hover:text-[var(--cw-ink)]">
                          <Download size={14} aria-hidden />
                        </a>
                        <IconButton icon={Copy} label={'Copy the path of ' + x.name} onClick={() => void navigator.clipboard.writeText(x.path).then(() => toast.success('Copied the path'))} />
                        <DeleteButton collection="exports" id={x.id} name={x.name} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}
