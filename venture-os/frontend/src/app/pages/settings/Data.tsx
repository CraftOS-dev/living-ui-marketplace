/**
 * Settings, Data: Import (CSV or XLSX through imports.*), Export all (a ZIP
 * of every record, with the PIN), the recent imports and the audit log.
 */
import { useState } from 'react';
import { Download, FileSpreadsheet, History, Upload } from 'lucide-react';
import { ImportDialog } from '../../components/ImportDialog.tsx';
import { Button, DataTable, Empty, LoadError, Panel, Segmented, Skeleton, SubHeader } from '../../components/ui.tsx';
import { download } from '../../lib/api.ts';
import { allowed, useMe } from '../../lib/auth.ts';
import { ago, humanize, num } from '../../lib/format.ts';
import { useOp } from '../../lib/live.ts';

interface ImportRow {
  id: string;
  target: string;
  file_name: string;
  status: string;
  rows: number;
  created_n: number;
  updated_n: number;
  skipped_n: number;
  created: string;
}

interface AuditRow {
  id: string;
  actor: string;
  op: string;
  summary: string;
  created: string;
}

export function DataSettings(): React.JSX.Element {
  const me = useMe();
  const admin = allowed(me, 'admin');
  const [view, setView] = useState<'imports' | 'audit'>('imports');
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const imports = useOp<{ imports: ImportRow[] }>('imports.list', {}, ['imports'], { name: 'settings.imports' });
  const audit = useOp<{ entries: AuditRow[] }>('audit.list', {}, ['audit'], { name: 'settings.audit', skip: view !== 'audit' || !admin });
  const exportAll = (): void => {
    setExporting(true);
    void download('exports.all', {}, 'save', 'venture-os-export.zip')
      .catch(() => undefined)
      .finally(() => setExporting(false));
  };
  return (
    <>
      <SubHeader title="Data">
        {admin && (
          <Button icon={Download} busy={exporting} onClick={exportAll}>
            Export all
          </Button>
        )}
        <Button variant="primary" icon={Upload} onClick={() => setImporting(true)}>
          Import
        </Button>
      </SubHeader>
      {admin && <Segmented label="View" value={view} onChange={setView} options={[{ value: 'imports', label: 'Imports' }, { value: 'audit', label: 'Audit' }]} />}
      <Panel flush>
        {view === 'imports' ? (
          imports.data === null ? (
            imports.error !== null ? (
              <LoadError message={imports.error} onRetry={imports.reload} />
            ) : (
              <div className="p-5">
                <Skeleton className="h-20 w-full" />
              </div>
            )
          ) : (
            <DataTable
              label="Imports"
              rows={imports.data.imports}
              rowKey={(r) => r.id}
              stickyTop={0}
              empty={<Empty icon={FileSpreadsheet} title="No imports yet" action={<Button onClick={() => setImporting(true)}>Import</Button>} />}
              columns={[
                { key: 'file', label: 'File', width: 'minmax(180px,2fr)', phone: 'title', render: (r) => <span className="font-medium">{r.file_name !== '' ? r.file_name : humanize(r.target)}</span> },
                { key: 'target', label: 'Into', width: '120px', render: (r) => humanize(r.target) },
                { key: 'rows', label: 'Rows', width: '80px', mono: true, render: (r) => num(r.rows) },
                { key: 'created_n', label: 'New', width: '80px', mono: true, render: (r) => num(r.created_n) },
                { key: 'updated_n', label: 'Updated', width: '80px', mono: true, render: (r) => num(r.updated_n) },
                { key: 'when', label: 'When', width: '110px', mono: true, phone: 'end', render: (r) => ago(r.created) },
              ]}
            />
          )
        ) : audit.data === null ? (
          audit.error !== null ? (
            <LoadError message={audit.error} onRetry={audit.reload} />
          ) : (
            <div className="p-5">
              <Skeleton className="h-20 w-full" />
            </div>
          )
        ) : (
          <DataTable
            label="Audit"
            rows={audit.data.entries}
            rowKey={(r) => r.id}
            stickyTop={0}
            empty={<Empty icon={History} title="Nothing yet" />}
            columns={[
              { key: 'summary', label: 'What', width: 'minmax(220px,3fr)', phone: 'title', render: (r) => <span className="vo-wrap">{r.summary}</span> },
              { key: 'actor', label: 'By', width: '110px', render: (r) => (r.actor === 'agent' ? 'Your AI agent' : humanize(r.actor)) },
              { key: 'op', label: 'Operation', width: '160px', mono: true, render: (r) => r.op },
              { key: 'when', label: 'When', width: '110px', mono: true, phone: 'end', render: (r) => ago(r.created) },
            ]}
          />
        )}
      </Panel>
      <ImportDialog open={importing} onClose={() => setImporting(false)} />
    </>
  );
}
