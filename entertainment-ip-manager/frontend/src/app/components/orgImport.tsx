/**
 * Settings, Import: trademarks and designs from a spreadsheet (CSV pasted
 * or uploaded), checked first with a dry run that shows what each row
 * would do, then imported (managers); and watch hits (trademark watch
 * reports, marketplace listings) into the watch list. Nothing is written
 * by the dry run.
 */
import { useMemo, useRef, useState } from 'react';
import { Download, FileUp, ListChecks, Upload } from 'lucide-react';
import { Button, Textarea, toast } from '../../kit/index.ts';
import { errText, op } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { downloadText, parseCsv } from '../lib/csv.ts';
import { bi, t } from '../lib/i18n.ts';
import type { Bi } from '../lib/shapes.ts';
import { href } from '../lib/router.ts';
import type { Tone } from '../lib/labels.ts';
import { Checkbox, Notice, Pill, Section, Segmented, StatTile, TONE_TEXT } from './ui.tsx';
import { ReadOnlyNote } from './orgShared.tsx';

type Kind = 'matters' | 'watch';

const MATTER_COLUMNS = [
  'ip_type', 'jurisdiction', 'title', 'status', 'application_no', 'filing_date', 'publication_no', 'publication_date', 'registration_no', 'registration_date',
  'classes', 'family', 'franchise', 'character', 'talent', 'owner_of_record', 'counsel', 'client_ref', 'route', 'ref', 'notes',
];
const WATCH_COLUMNS = ['their_mark', 'their_owner', 'kind', 'url', 'jurisdiction', 'application_no', 'classes', 'goods', 'publication_date', 'opposition_deadline', 'our_mark', 'character', 'score', 'source'];
const REQUIRED: Record<Kind, string[]> = { matters: ['jurisdiction', 'title'], watch: ['their_mark'] };

interface MatterResult {
  line: number;
  action: 'create' | 'update' | 'error';
  message: string;
  message_ja?: string;
  title: string;
  id?: string;
}
interface MatterImport {
  dry_run: boolean;
  created: number;
  updated: number;
  errors: number;
  deadlines: number;
  results: MatterResult[];
}
interface WatchImport {
  created: number;
  errors: Bi[];
}

function normHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function toRows(text: string): { header: string[]; rows: Record<string, string>[] } {
  const grid = parseCsv(text);
  const first = grid[0];
  if (first === undefined) return { header: [], rows: [] };
  const header = first.map(normHeader);
  const rows = grid.slice(1).map((cells) => {
    const o: Record<string, string> = {};
    header.forEach((h, i) => {
      if (h !== '') o[h] = (cells[i] ?? '').trim();
    });
    return o;
  });
  return { header, rows };
}

const ACTION_TONE: Record<string, Tone> = { create: 'good', update: 'info', error: 'bad' };

function actionLabel(a: string): string {
  return { create: t('New'), update: t('Update'), error: t('Problem') }[a] ?? a;
}

export function ImportTab(): React.JSX.Element {
  const { can } = useApp();
  const [kind, setKind] = useState<Kind>('matters');
  const [text, setText] = useState('');
  const [generate, setGenerate] = useState(true);
  const [busy, setBusy] = useState<'check' | 'import' | null>(null);
  const [checked, setChecked] = useState<MatterImport | null>(null);
  const [done, setDone] = useState<MatterImport | null>(null);
  const [watchDone, setWatchDone] = useState<WatchImport | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => toRows(text), [text]);
  const columns = kind === 'matters' ? MATTER_COLUMNS : WATCH_COLUMNS;
  const known = parsed.header.filter((h) => columns.includes(h));
  const unknown = parsed.header.filter((h) => h !== '' && !columns.includes(h));
  const missing = REQUIRED[kind].filter((c) => !parsed.header.includes(c));
  const ready = parsed.rows.length > 0 && missing.length === 0;

  const reset = (): void => {
    setChecked(null);
    setDone(null);
    setWatchDone(null);
  };

  const loadFile = (file: File | undefined): void => {
    if (file === undefined) return;
    const reader = new FileReader();
    reader.onload = () => {
      setText(String(reader.result ?? ''));
      reset();
    };
    reader.readAsText(file);
  };

  const template = (): void => {
    downloadText(kind === 'matters' ? 'trademarks-import-template.csv' : 'watch-hits-import-template.csv', `${columns.join(',')}\r\n`);
  };

  const check = async (): Promise<void> => {
    setBusy('check');
    try {
      setChecked(await op<MatterImport>('import/matters', { rows: parsed.rows, dry_run: true }));
      setDone(null);
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(null);
    }
  };

  const runImport = async (): Promise<void> => {
    setBusy('import');
    try {
      if (kind === 'matters') {
        const r = await op<MatterImport>('import/matters', { rows: parsed.rows, dry_run: false, generate });
        setDone(r);
        setChecked(null);
        toast.success(t('Import finished: {created} new, {updated} updated, {errors} problems.', { created: r.created, updated: r.updated, errors: r.errors }));
      } else {
        const r = await op<WatchImport>('import/watch', { rows: parsed.rows });
        setWatchDone(r);
        toast.success(t('{n} watch hits imported.', { n: r.created }));
      }
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(null);
    }
  };

  const result = done ?? checked;

  return (
    <div className="flex flex-col gap-4">
      {!can.manage && kind === 'matters' && <ReadOnlyNote>{t('You can check a file. Only administrators and managers can import trademarks.')}</ReadOnlyNote>}
      <div>
        <Segmented<Kind>
          ariaLabel={t('What to import')}
          value={kind}
          onChange={(v) => {
            setKind(v);
            reset();
          }}
          options={[
            { value: 'matters', label: t('Trademarks and designs') },
            { value: 'watch', label: t('Watch hits') },
          ]}
        />
      </div>

      <Section
        title={kind === 'matters' ? t('Import trademarks and designs') : t('Import watch hits')}
        actions={
          <Button size="sm" variant="ghost" onClick={template}>
            <Download size={13} aria-hidden /> <span className="hidden sm:inline">{t('Template')}</span>
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-[13px] leading-relaxed text-[var(--agent-app-muted)]">
            {kind === 'matters'
              ? t('One row per trademark or design. The first row holds the column names. Rows that match an existing record (by reference, or office and application number) update it; the others create new records. Filing, publication and registration dates create their deadlines.')
              : t('One row per watch hit: a similar mark from a watch report, or a marketplace listing. New hits arrive in the watch list for review.')}
          </p>
          <div className="break-words text-xs leading-relaxed text-[var(--agent-app-muted)]">
            <span className="font-medium text-[var(--agent-app-text)]">{t('Columns')}: </span>
            <span className="font-mono">{columns.join(', ')}</span>
            <span>{' '}({t('required: {list}', { list: REQUIRED[kind].join(', ') })})</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
              <FileUp size={13} aria-hidden /> {t('Choose a CSV file')}
            </Button>
            <span className="text-xs text-[var(--agent-app-muted)]">{t('or paste the rows below')}</span>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.tsv,.txt,text/csv"
              className="hidden"
              onChange={(e) => {
                loadFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
          <Textarea
            aria-label={t('CSV rows')}
            rows={8}
            className="font-mono text-xs"
            placeholder={kind === 'matters' ? 'ip_type,jurisdiction,title,application_no,filing_date,status,classes\ntrademark,JP,...' : 'their_mark,their_owner,jurisdiction,application_no,publication_date\n...'}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              reset();
            }}
          />
          {text.trim() !== '' && (
            <div className="flex flex-col gap-1 text-xs">
              <span className="tabular-nums">{t('{n} rows read; {k} known columns.', { n: parsed.rows.length, k: known.length })}</span>
              {unknown.length > 0 && <span className={`break-words ${TONE_TEXT.warn}`}>{t('Ignored columns: {list}', { list: unknown.join(', ') })}</span>}
              {missing.length > 0 && <span className={TONE_TEXT.bad}>{t('Missing required columns: {list}', { list: missing.join(', ') })}</span>}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            {kind === 'matters' ? (
              <>
                <Button variant="outline" loading={busy === 'check'} disabled={!ready || busy !== null} onClick={() => void check()}>
                  <ListChecks size={14} aria-hidden /> {t('Check (dry run)')}
                </Button>
                {can.manage && (
                  <>
                    <Checkbox checked={generate} onChange={setGenerate} label={t('Create deadlines from the dates')} />
                    <Button loading={busy === 'import'} disabled={!ready || busy !== null || checked === null} title={checked === null ? t('Check the file first') : undefined} onClick={() => void runImport()}>
                      <Upload size={14} aria-hidden /> {t('Import {n} rows', { n: parsed.rows.length })}
                    </Button>
                  </>
                )}
              </>
            ) : (
              can.edit && (
                <Button loading={busy === 'import'} disabled={!ready || busy !== null} onClick={() => void runImport()}>
                  <Upload size={14} aria-hidden /> {t('Import {n} rows', { n: parsed.rows.length })}
                </Button>
              )
            )}
          </div>
        </div>
      </Section>

      {kind === 'matters' && result !== null && (
        <Section title={result.dry_run ? t('Check result (nothing saved)') : t('Import result')} flush>
          <div className="grid grid-cols-2 gap-3 border-b border-[var(--agent-app-border)] p-3 sm:grid-cols-4">
            <StatTile label={t('New')} value={result.created} tone="good" />
            <StatTile label={t('Updated')} value={result.updated} tone="info" />
            <StatTile label={t('Problems')} value={result.errors} tone={result.errors > 0 ? 'bad' : undefined} />
            {!result.dry_run && <StatTile label={t('Deadlines created')} value={result.deadlines} />}
          </div>
          {result.dry_run && result.errors > 0 && (
            <div className="border-b border-[var(--agent-app-border)] p-3">
              <Notice tone="warn">{t('Rows with problems are skipped. Fix them in the file and check again, or import the rest.')}</Notice>
            </div>
          )}
          <div className="max-h-[28rem] overflow-y-auto">
            {result.results.map((r) => (
              <div key={r.line} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--agent-app-border)]/70 px-4 py-1.5 text-[13px] last:border-0">
                <span className="w-12 shrink-0 tabular-nums text-xs text-[var(--agent-app-muted)]">{t('Row {n}', { n: r.line + 1 })}</span>
                <Pill tone={ACTION_TONE[r.action] ?? 'neutral'}>{actionLabel(r.action)}</Pill>
                <span className="min-w-0 flex-1 basis-40 truncate font-medium">
                  {r.id !== undefined ? (
                    <a className="text-[var(--agent-app-accent)] hover:underline" href={href('matter', r.id)}>
                      {r.title}
                    </a>
                  ) : (
                    r.title
                  )}
                </span>
                <span className="min-w-0 basis-full break-words text-xs text-[var(--agent-app-muted)] sm:basis-auto">{bi({ en: r.message, ja: r.message_ja ?? '' })}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {kind === 'watch' && watchDone !== null && (
        <Section title={t('Import result')}>
          <div className="flex flex-col gap-2">
            <p className="text-[13px]">{t('{n} watch hits imported.', { n: watchDone.created })}</p>
            {watchDone.errors.length > 0 && (
              <ul className={`flex flex-col gap-0.5 text-xs ${TONE_TEXT.bad}`}>
                {watchDone.errors.map((e) => (
                  <li key={e.en} className="break-words">
                    {bi(e)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Section>
      )}
    </div>
  );
}
