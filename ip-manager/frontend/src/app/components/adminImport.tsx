/**
 * Settings, Import: bring an existing docket in from a CSV file. Paste or
 * choose a file, map its columns, dry run (people who can edit), then
 * import (admins and IP managers). Existing matters are matched by
 * reference or by office and application number and updated.
 */
import { useMemo, useRef, useState } from 'react';
import { CheckCircle2, Download, FileUp, FlaskConical, Upload, XCircle } from 'lucide-react';
import { Button, Select, Switch, Textarea, cn, toast } from '../../kit/index.ts';
import { errText, op } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { href } from '../lib/router.ts';
import { downloadText, parseCsv } from '../lib/csv.ts';
import { IP_TYPE_LABEL, JURISDICTION_OPTIONS } from '../lib/labels.ts';
import type { IpType } from '../lib/types.ts';
import { EmptyHint, Notice, Pill, Section, StatTile } from './ui.tsx';

/* ------------------------------------------------------------------ */
/* Canonical fields and header aliases                                 */
/* ------------------------------------------------------------------ */

const FIELDS = [
  'ref',
  'ip_type',
  'title',
  'jurisdiction',
  'route',
  'status',
  'application_no',
  'filing_date',
  'publication_no',
  'publication_date',
  'registration_no',
  'registration_date',
  'family',
  'property',
  'classes',
  'owner_of_record',
  'counsel',
  'client_ref',
  'entity_size',
  'notes',
] as const;
type FieldKey = (typeof FIELDS)[number];

const REQUIRED: FieldKey[] = ['ip_type', 'title', 'jurisdiction'];

const FIELD_LABEL: Record<FieldKey, string> = {
  ref: 'Our reference',
  ip_type: 'IP type',
  title: 'Title or mark',
  jurisdiction: 'Jurisdiction (office code)',
  route: 'Route',
  status: 'Status',
  application_no: 'Application number',
  filing_date: 'Filing date',
  publication_no: 'Publication number',
  publication_date: 'Publication date',
  registration_no: 'Registration or patent number',
  registration_date: 'Registration or grant date',
  family: 'Family',
  property: 'Property',
  classes: 'Nice classes',
  owner_of_record: 'Owner of record',
  counsel: 'Counsel',
  client_ref: 'Client reference',
  entity_size: 'Entity size',
  notes: 'Notes',
};

const FIELD_HELP: Partial<Record<FieldKey, string>> = {
  ref: 'Matches an existing matter to update it. Leave empty to number new ones automatically.',
  ip_type: 'patent, utility_model, design, trademark, copyright or domain',
  jurisdiction: 'Two letters: US, EP, EM, JP, WO, GB...',
  route: 'national, regional, provisional, pct, ep, unitary, madrid, hague, designation, validation',
  status: 'to_file, filed, published, examination, office_action, allowed, granted, registered, lapsed, abandoned...',
  filing_date: 'YYYY-MM-DD',
  publication_date: 'YYYY-MM-DD',
  registration_date: 'YYYY-MM-DD',
  family: 'Rows with the same family name are grouped into one family.',
  property: 'Created if it does not exist yet.',
  classes: 'Trademarks only, for example 9, 25, 41',
  entity_size: 'large, small, micro or na',
};

/** Normalized header (lowercase, spaces and dashes to underscores) to field. */
const ALIASES: Record<string, FieldKey> = {
  reference: 'ref',
  our_ref: 'ref',
  our_reference: 'ref',
  docket_no: 'ref',
  docket_number: 'ref',
  matter_ref: 'ref',
  type: 'ip_type',
  ip_right: 'ip_type',
  right_type: 'ip_type',
  kind_of_right: 'ip_type',
  name: 'title',
  mark: 'title',
  trademark: 'title',
  invention_title: 'title',
  country: 'jurisdiction',
  office: 'jurisdiction',
  country_code: 'jurisdiction',
  filing_route: 'route',
  current_status: 'status',
  application_number: 'application_no',
  app_no: 'application_no',
  app_number: 'application_no',
  appl_no: 'application_no',
  serial_number: 'application_no',
  serial_no: 'application_no',
  filed: 'filing_date',
  application_date: 'filing_date',
  app_date: 'filing_date',
  publication_number: 'publication_no',
  pub_no: 'publication_no',
  pub_number: 'publication_no',
  pub_date: 'publication_date',
  published: 'publication_date',
  registration_number: 'registration_no',
  reg_no: 'registration_no',
  reg_number: 'registration_no',
  patent_number: 'registration_no',
  patent_no: 'registration_no',
  reg_date: 'registration_date',
  registered: 'registration_date',
  grant_date: 'registration_date',
  issue_date: 'registration_date',
  family_name: 'family',
  franchise: 'property',
  brand: 'property',
  product_line: 'property',
  class: 'classes',
  nice_classes: 'classes',
  nice_class: 'classes',
  owner: 'owner_of_record',
  applicant: 'owner_of_record',
  proprietor: 'owner_of_record',
  holder: 'owner_of_record',
  attorney: 'counsel',
  agent: 'counsel',
  law_firm: 'counsel',
  client_reference: 'client_ref',
  entity: 'entity_size',
  comments: 'notes',
  remarks: 'notes',
};

function normalize(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[.#]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function autoMap(headers: string[]): Record<FieldKey, string> {
  const out = {} as Record<FieldKey, string>;
  for (const f of FIELDS) out[f] = '';
  headers.forEach((h, i) => {
    const n = normalize(h);
    const field = (FIELDS as readonly string[]).includes(n) ? (n as FieldKey) : ALIASES[n];
    if (field !== undefined && out[field] === '') out[field] = String(i);
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* Results                                                             */
/* ------------------------------------------------------------------ */

interface ImportResultRow {
  line: number;
  action: 'create' | 'update' | 'error';
  message: string;
  title: string;
  id?: string;
}

interface ImportResponse {
  dry_run: boolean;
  created: number;
  updated: number;
  errors: number;
  deadlines: number;
  results: ImportResultRow[];
}

const ACTION_PILL: Record<ImportResultRow['action'], { tone: 'good' | 'info' | 'bad'; label: string }> = {
  create: { tone: 'good', label: 'Create' },
  update: { tone: 'info', label: 'Update' },
  error: { tone: 'bad', label: 'Error' },
};

/* ------------------------------------------------------------------ */
/* Tab                                                                 */
/* ------------------------------------------------------------------ */

export function ImportTab(): React.JSX.Element {
  const { can } = useApp();
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [mapping, setMapping] = useState<Record<FieldKey, string> | null>(null);
  const [fixedType, setFixedType] = useState('');
  const [fixedJur, setFixedJur] = useState('');
  const [generate, setGenerate] = useState(true);
  const [busy, setBusy] = useState<'dry' | 'import' | null>(null);
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [dryKey, setDryKey] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  const table = useMemo(() => (text.trim() === '' ? [] : parseCsv(text)), [text]);
  const headers = table[0] ?? [];
  const data = table.slice(1);

  const load = (t: string, name: string): void => {
    const parsed = t.trim() === '' ? [] : parseCsv(t);
    const nextHeaders = parsed[0];
    // Keep a manual mapping while the headers stay the same.
    if (nextHeaders === undefined) setMapping(null);
    else if (JSON.stringify(nextHeaders) !== JSON.stringify(headers) || mapping === null) setMapping(autoMap(nextHeaders));
    setText(t);
    setFileName(name);
    setResult(null);
    setDryKey('');
  };

  const onFile = (f: File | undefined): void => {
    if (f === undefined) return;
    const reader = new FileReader();
    reader.onload = () => load(typeof reader.result === 'string' ? reader.result : '', f.name);
    reader.onerror = () => toast.error('Could not read that file.');
    reader.readAsText(f);
  };

  const map = mapping ?? (headers.length > 0 ? autoMap(headers) : null);
  const missing = REQUIRED.filter((f) => {
    if (map === null || map[f] !== '') return false;
    if (f === 'ip_type' && fixedType !== '') return false;
    if (f === 'jurisdiction' && fixedJur !== '') return false;
    return true;
  });

  const rows = useMemo(() => {
    if (map === null) return [];
    return data.map((cells) => {
      const o: Record<string, string> = {};
      for (const f of FIELDS) {
        const idx = map[f];
        o[f] = idx === '' ? '' : (cells[Number(idx)] ?? '').trim();
      }
      if (map.ip_type === '' && fixedType !== '') o['ip_type'] = fixedType;
      if (map.jurisdiction === '' && fixedJur !== '') o['jurisdiction'] = fixedJur;
      return o;
    });
  }, [data, map, fixedType, fixedJur]);

  const runKey = JSON.stringify({ map, fixedType, fixedJur, n: rows.length, text: text.length });

  const run = async (dry: boolean): Promise<void> => {
    if (rows.length === 0) {
      toast.error('There are no rows under the headers.');
      return;
    }
    if (rows.length > 5000) {
      toast.error('Import at most 5,000 rows at a time. Split the file.');
      return;
    }
    setBusy(dry ? 'dry' : 'import');
    try {
      const r = await op<ImportResponse>('import/matters', { rows, dry_run: dry, generate });
      setResult(r);
      if (dry) {
        setDryKey(runKey);
        toast.success(`Dry run: ${r.created} to create, ${r.updated} to update, ${r.errors} with errors`);
      } else {
        toast.success(`Imported: ${r.created} created, ${r.updated} updated${generate ? `, ${r.deadlines} deadlines` : ''}${r.errors > 0 ? `, ${r.errors} rows skipped` : ''}`);
      }
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(null);
    }
  };

  const template = (): void => {
    downloadText('ip-manager-import-template.csv', `${FIELDS.join(',')}\r\n`);
  };

  const dryDone = dryKey !== '' && dryKey === runKey;

  return (
    <div className="flex flex-col gap-4">
      <Notice tone="info" icon={Upload}>
        Import patents, trademarks, designs, copyrights and domain names from a spreadsheet saved as CSV. Rows are matched to existing matters by our reference, or by office and application number, and updated; everything else is created. Nothing changes until you import, and a dry run shows exactly what would happen.
      </Notice>

      <Section
        title="1. Your file"
        actions={
          <Button size="sm" variant="ghost" onClick={template}>
            <Download size={13} aria-hidden /> Download template
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                onFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
              <FileUp size={13} aria-hidden /> Choose a .csv file
            </Button>
            <span className="text-xs text-[var(--agent-app-muted)]">{fileName !== '' ? fileName : 'or paste the rows below, headers first'}</span>
          </div>
          <Textarea
            aria-label="CSV text"
            rows={6}
            className="font-mono text-[12px]"
            placeholder={'ip_type,title,jurisdiction,application_no,filing_date\ntrademark,LANTERN BAY,EM,018912345,2024-03-01'}
            value={text}
            onChange={(e) => load(e.target.value, '')}
          />
          {table.length > 0 && (
            <p className="text-xs tabular-nums text-[var(--agent-app-muted)]">
              {headers.length} columns, {data.length} {data.length === 1 ? 'row' : 'rows'} under the headers.
            </p>
          )}
        </div>
      </Section>

      {map !== null && headers.length > 0 && (
        <Section title="2. Match the columns" meta={missing.length > 0 ? `Missing: ${missing.map((f) => FIELD_LABEL[f]).join(', ')}` : 'All required fields matched'}>
          <div className="flex flex-col gap-4">
            <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
              {FIELDS.map((f) => {
                const req = REQUIRED.includes(f);
                const bad = missing.includes(f);
                return (
                  <div key={f} className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)] items-start gap-2">
                    <div className="pt-2">
                      <div className={cn('text-[13px] font-medium', bad && 'text-red-700 dark:text-red-400')}>
                        {FIELD_LABEL[f]}
                        {req && <span className="ml-0.5 text-red-600">*</span>}
                      </div>
                      <div className="font-mono text-[10.5px] text-[var(--agent-app-muted)]">{f}</div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <Select
                        aria-label={`Column for ${FIELD_LABEL[f]}`}
                        value={map[f]}
                        placeholder="Not in the file"
                        options={headers.map((h, i) => ({ value: String(i), label: h.trim() !== '' ? h : `Column ${i + 1}` }))}
                        onChange={(e) => setMapping({ ...map, [f]: e.target.value })}
                      />
                      {f === 'ip_type' && map.ip_type === '' && (
                        <Select
                          aria-label="IP type for every row"
                          value={fixedType}
                          placeholder="Or the same for every row"
                          options={(Object.keys(IP_TYPE_LABEL) as IpType[]).map((t) => ({ value: t, label: `${IP_TYPE_LABEL[t]} (${t})` }))}
                          onChange={(e) => setFixedType(e.target.value)}
                        />
                      )}
                      {f === 'jurisdiction' && map.jurisdiction === '' && (
                        <Select aria-label="Jurisdiction for every row" value={fixedJur} placeholder="Or the same for every row" options={JURISDICTION_OPTIONS} onChange={(e) => setFixedJur(e.target.value)} />
                      )}
                      {FIELD_HELP[f] !== undefined && <p className="text-[11px] leading-relaxed text-[var(--agent-app-muted)]">{FIELD_HELP[f]}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="border-t border-[var(--agent-app-border)] pt-3 text-xs leading-relaxed text-[var(--agent-app-muted)]">
              IP type values are the keys: <code className="font-mono">patent</code>, <code className="font-mono">utility_model</code>, <code className="font-mono">design</code>,{' '}
              <code className="font-mono">trademark</code>, <code className="font-mono">copyright</code> and <code className="font-mono">domain</code> (a domain name). Capitals and spaces are fine, so "Utility model" works.
            </div>
            {rows.length > 0 && missing.length === 0 && <Preview rows={rows.slice(0, 5)} />}
          </div>
        </Section>
      )}

      {map !== null && headers.length > 0 && (
        <Section title="3. Check and import">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Switch checked={generate} onCheckedChange={setGenerate} label="Create deadlines from dates" />
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" loading={busy === 'dry'} disabled={busy !== null || missing.length > 0 || rows.length === 0} onClick={() => void run(true)}>
                  <FlaskConical size={14} aria-hidden /> Dry run
                </Button>
                {can.manage && (
                  <Button loading={busy === 'import'} disabled={busy !== null || missing.length > 0 || rows.length === 0 || !dryDone} title={!dryDone ? 'Run a dry run first' : undefined} onClick={() => void run(false)}>
                    <Upload size={14} aria-hidden /> Import {rows.length} {rows.length === 1 ? 'row' : 'rows'}
                  </Button>
                )}
              </div>
            </div>
            <p className="text-xs leading-relaxed text-[var(--agent-app-muted)]">
              {generate
                ? 'For new matters, the filing, publication and registration dates are recorded as events, and the deadline rules create what follows from them (renewals, annuities, declarations). Deadlines already past are skipped.'
                : 'Matters are created without deadlines. Record events on each matter later to create them.'}{' '}
              {can.manage ? 'Rows with errors are skipped.' : 'Only admins and IP managers can run the final import; you can check the file with a dry run.'}
            </p>
            {result !== null && <Results result={result} />}
          </div>
        </Section>
      )}

      {table.length === 0 && (
        <div className="border border-[var(--agent-app-border)]">
          <EmptyHint compact icon={FileUp} title="Start with a CSV file" message="Export your docket from a spreadsheet or your old system as CSV, then choose it above or paste it. The template lists every column IP Manager understands." />
        </div>
      )}
    </div>
  );
}

function Preview({ rows }: { rows: Record<string, string>[] }): React.JSX.Element {
  const cols: FieldKey[] = ['ip_type', 'title', 'jurisdiction', 'application_no', 'filing_date', 'status'];
  return (
    <div>
      <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">First rows as IP Manager reads them</h4>
      <div className="overflow-x-auto border border-[var(--agent-app-border)]">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-[var(--agent-app-border)] bg-[var(--agent-app-border)]/20">
              {cols.map((c) => (
                <th key={c} className="whitespace-nowrap px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">
                  {FIELD_LABEL[c]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-[var(--agent-app-border)]/60 last:border-0">
                {cols.map((c) => (
                  <td key={c} className={cn('whitespace-nowrap px-3 py-1.5', (c === 'application_no' || c === 'jurisdiction') && 'font-mono')}>
                    {r[c] !== '' ? r[c] : <span className="text-[var(--agent-app-muted)]">-</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Results({ result }: { result: ImportResponse }): React.JSX.Element {
  const [only, setOnly] = useState<'all' | 'error'>(result.errors > 0 ? 'error' : 'all');
  const list = only === 'error' ? result.results.filter((r) => r.action === 'error') : result.results;
  return (
    <div className="flex flex-col gap-3 border-t border-[var(--agent-app-border)] pt-4">
      <div className="flex items-center gap-2 text-[13px] font-medium">
        {result.errors === 0 ? <CheckCircle2 size={15} className="text-emerald-600" aria-hidden /> : <XCircle size={15} className="text-red-600" aria-hidden />}
        {result.dry_run ? 'Dry run: nothing was changed' : 'Import finished'}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label={result.dry_run ? 'Would create' : 'Created'} value={result.created} tone="good" />
        <StatTile label={result.dry_run ? 'Would update' : 'Updated'} value={result.updated} tone="info" />
        <StatTile label="Errors" value={result.errors} tone={result.errors > 0 ? 'bad' : undefined} />
        <StatTile label="Deadlines created" value={result.dry_run ? '-' : result.deadlines} sub={result.dry_run ? 'Counted on import' : undefined} />
      </div>
      {result.errors > 0 && (
        <div className="flex gap-2">
          <Button size="sm" variant={only === 'error' ? 'secondary' : 'ghost'} onClick={() => setOnly('error')}>
            Errors only
          </Button>
          <Button size="sm" variant={only === 'all' ? 'secondary' : 'ghost'} onClick={() => setOnly('all')}>
            All rows
          </Button>
        </div>
      )}
      <div className="max-h-[50vh] overflow-auto border border-[var(--agent-app-border)]">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 bg-[var(--agent-app-surface)]">
            <tr className="border-b border-[var(--agent-app-border)]">
              <th className="w-16 bg-[var(--agent-app-border)]/20 px-3 py-1.5 text-right text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">Row</th>
              <th className="w-24 bg-[var(--agent-app-border)]/20 px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">Action</th>
              <th className="bg-[var(--agent-app-border)]/20 px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">Title</th>
              <th className="bg-[var(--agent-app-border)]/20 px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">Message</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.line} className="border-b border-[var(--agent-app-border)]/60 last:border-0">
                <td className="px-3 py-1.5 text-right tabular-nums text-[var(--agent-app-muted)]">{r.line}</td>
                <td className="px-3 py-1.5">
                  <Pill tone={ACTION_PILL[r.action].tone}>{ACTION_PILL[r.action].label}</Pill>
                </td>
                <td className="px-3 py-1.5">
                  {r.id !== undefined && r.id !== '' ? (
                    <a className="hover:text-[var(--agent-app-accent)] hover:underline" href={href('matter', r.id)}>
                      {r.title}
                    </a>
                  ) : (
                    r.title
                  )}
                </td>
                <td className={cn('px-3 py-1.5', r.action === 'error' && 'text-red-700 dark:text-red-400')}>{r.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-[var(--agent-app-muted)]">Row 1 is the first row under the headers.</p>
    </div>
  );
}
