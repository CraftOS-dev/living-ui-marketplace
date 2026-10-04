/**
 * Trademark tools: the leak check (would a filing become public on
 * J-PlatPat before the announcement?) and the CSV import of trademarks and
 * designs (parsed in the browser, validated by a dry run on the server, then
 * imported by a manager).
 */
import { useMemo, useRef, useState } from 'react';
import { EyeOff, FileUp, Upload } from 'lucide-react';
import { Button, Switch, Textarea, toast } from '../../kit/index.ts';
import { op } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { parseCsv } from '../lib/csv.ts';
import { fmtDate, today } from '../lib/format.ts';
import { bi, t, tn } from '../lib/i18n.ts';
import { href } from '../lib/router.ts';
import { JurisdictionSelect } from './pickers.tsx';
import { Notice, Pill, Section, Tag } from './ui.tsx';
import { DateField } from './protectShared.tsx';
import type { LeakResult } from './protectMatterForms.tsx';

/* ------------------------------------------------------------------ */
/* Leak check                                                          */
/* ------------------------------------------------------------------ */

export function LeakCheckPanel(): React.JSX.Element {
  const [filing, setFiling] = useState(today());
  const [announce, setAnnounce] = useState('');
  const [office, setOffice] = useState('JP');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<LeakResult | null>(null);

  const check = async (): Promise<void> => {
    setBusy(true);
    try {
      setRes(await op<LeakResult>('matters/leak-check', { filing_date: filing, announcement_date: announce, jurisdiction: office }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title={t('Leak check')}>
      <div className="flex flex-col gap-4">
        <p className="text-[13px] leading-relaxed text-[var(--agent-app-muted)]">
          {t('Japanese filings appear on J-PlatPat about 2 to 3 weeks after filing, so a mark for an unannounced title or character can leak it. Check the dates before you file.')}
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <DateField label={t('Filing date')} value={filing} onChange={setFiling} />
          <DateField label={t('Announcement date')} value={announce} onChange={setAnnounce} />
          <JurisdictionSelect label={t('Office')} value={office} onChange={setOffice} officesOnly />
        </div>
        <div>
          <Button onClick={() => void check()} loading={busy}>
            <EyeOff size={14} aria-hidden /> {t('Check|leak')}
          </Button>
        </div>
        {res !== null && (
          <Notice tone={res.leaks ? 'bad' : 'good'}>
            <div className="font-medium">{res.leaks ? t('This filing may reveal the title before the announcement.') : t('No leak expected.')}</div>
            <div>{bi(res.text)}</div>
            <div className="mt-2 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
              <span>
                <span className="text-[var(--agent-app-muted)]">{t('Likely public from')}: </span>
                {fmtDate(res.visible_from)}
              </span>
              {res.safe_filing_until !== '' && (
                <span>
                  <span className="text-[var(--agent-app-muted)]">{t('File on or after')}: </span>
                  {fmtDate(res.safe_filing_until)}
                </span>
              )}
            </div>
            <div className="mt-1 text-xs text-[var(--agent-app-muted)]">{bi(res.note)}</div>
          </Notice>
        )}
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* CSV import                                                          */
/* ------------------------------------------------------------------ */

/** Server field and the header names it is recognised by (English and Japanese). */
const MATTER_FIELDS: Record<string, string[]> = {
  ref: ['ref', 'reference', '整理番号', '管理番号'],
  ip_type: ['ip type', 'type', 'right', 'kind', '種別', '権利'],
  jurisdiction: ['jurisdiction', 'office', 'country', '官庁', '国', '国名'],
  title: ['title', 'mark', 'name', 'design', '商標', '名称', '意匠'],
  application_no: ['application no', 'application number', 'app no', '出願番号'],
  filing_date: ['filing date', 'filed', '出願日'],
  publication_no: ['publication no', 'publication number', '公開番号', '公告番号'],
  publication_date: ['publication date', 'published', '公開日', '公告日'],
  registration_no: ['registration no', 'registration number', 'reg no', '登録番号'],
  registration_date: ['registration date', 'registered', '登録日'],
  status: ['status', 'ステータス', '状態'],
  classes: ['classes', 'class', 'nice classes', 'nice class', '区分', '類'],
  family: ['family', 'ファミリー'],
  franchise: ['franchise', 'フランチャイズ', '作品'],
  character: ['character', 'キャラクター'],
  talent: ['talent', 'タレント'],
  owner_of_record: ['owner of record', 'owner', 'holder', '権利者', '名義人'],
  counsel: ['counsel', 'agent', '代理人'],
  client_ref: ['client ref', 'client reference', 'docket', '顧客番号'],
  route: ['route', 'ルート'],
  notes: ['notes', 'note', 'remarks', 'メモ', '備考'],
};

function normHeader(s: string): string {
  return s.trim().toLowerCase().replace(/[\s_.\-/]+/g, ' ').replace(/[()]/g, '').trim();
}

/** Map CSV columns to server fields by header name. */
export function mapColumns(headers: string[], fields: Record<string, string[]>): { map: Record<string, number>; unknown: string[] } {
  const map: Record<string, number> = {};
  const unknown: string[] = [];
  headers.forEach((h, i) => {
    const n = normHeader(h);
    const hit = Object.entries(fields).find(([key, aliases]) => map[key] === undefined && (normHeader(key) === n || aliases.some((a) => normHeader(a) === n)));
    if (hit !== undefined) map[hit[0]] = i;
    else if (h.trim() !== '') unknown.push(h.trim());
  });
  return { map, unknown };
}

/** CSV text to row objects keyed by server field. */
export function csvRows(text: string, fields: Record<string, string[]>): { rows: Record<string, string>[]; mapped: string[]; headers: string[]; unknown: string[] } {
  const grid = parseCsv(text);
  const head = grid[0] ?? [];
  const { map, unknown } = mapColumns(head, fields);
  const headers = Object.values(map).map((i) => (head[i] ?? '').trim());
  const rows = grid.slice(1).map((r) => {
    const o: Record<string, string> = {};
    for (const [key, idx] of Object.entries(map)) {
      const v = (r[idx] ?? '').trim();
      if (v !== '') o[key] = v;
    }
    return o;
  });
  return { rows: rows.filter((o) => Object.keys(o).length > 0), mapped: Object.keys(map), headers, unknown };
}

/** Read a chosen text file. */
export function CsvSource({ text, onText, placeholder }: { text: string; onText: (s: string) => void; placeholder: string }): React.JSX.Element {
  const input = useRef<HTMLInputElement | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <Textarea rows={6} className="font-mono text-[12px]" value={text} placeholder={placeholder} aria-label={t('CSV text')} onChange={(e) => onText(e.target.value)} />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => input.current?.click()}>
          <FileUp size={13} aria-hidden /> {t('Choose a CSV file')}
        </Button>
        <span className="text-xs text-[var(--agent-app-muted)]">{t('Or paste the rows above, with a header row.')}</span>
        <input
          ref={input}
          type="file"
          accept=".csv,.tsv,.txt,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f !== undefined) void f.text().then(onText);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}

interface ImportResult {
  dry_run: boolean;
  created: number;
  updated: number;
  errors: number;
  deadlines: number;
  results: { line: number; action: 'create' | 'update' | 'error'; message: string; message_ja?: string; title: string; id?: string }[];
}

export function MatterCsvImport(): React.JSX.Element {
  const { can } = useApp();
  const [text, setText] = useState('');
  const [generate, setGenerate] = useState(true);
  const [busy, setBusy] = useState<'' | 'dry' | 'real'>('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const parsed = useMemo(() => csvRows(text, MATTER_FIELDS), [text]);

  const run = async (dry: boolean): Promise<void> => {
    if (parsed.rows.length === 0) return;
    setBusy(dry ? 'dry' : 'real');
    try {
      const r = await op<ImportResult>('import/matters', { rows: parsed.rows, dry_run: dry, generate });
      setResult(r);
      if (!dry) toast.success(t('Imported: {created} created, {updated} updated, {deadlines} deadlines.', { created: r.created, updated: r.updated, deadlines: r.deadlines }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  };

  const tone = (a: string): 'good' | 'info' | 'bad' => (a === 'create' ? 'good' : a === 'update' ? 'info' : 'bad');
  const actionText = (a: string): string => (a === 'create' ? t('New|import') : a === 'update' ? t('Update|import') : t('Error'));

  return (
    <Section title={t('Import from a CSV')}>
      <div className="flex flex-col gap-4">
        <p className="text-[13px] leading-relaxed text-[var(--agent-app-muted)]">
          {t('One row per filing. Columns: type (trademark or design), office (JP, US, CN, KR, TW, EM, WO), mark, application number, filing date, registration number, registration date, status, classes, family, franchise, character, talent, owner. Dates as YYYY-MM-DD. Existing filings (same reference, or same office and application number) are updated.')}
        </p>
        <CsvSource
          text={text}
          onText={(s) => {
            setText(s);
            setResult(null);
          }}
          placeholder={`${t('type,office,mark,application number,filing date,classes')}\ntrademark,JP,...`}
        />
        {text.trim() !== '' && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--agent-app-muted)]">
            <span>{tn(parsed.rows.length, '{n} row read', '{n} rows read')}</span>
            {parsed.headers.length > 0 && (
              <span className="flex flex-wrap gap-1">
                {parsed.headers.map((m) => (
                  <Tag key={m}>{m}</Tag>
                ))}
              </span>
            )}
            {parsed.unknown.length > 0 && <span>{t('Ignored columns: {list}', { list: parsed.unknown.join(', ') })}</span>}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={() => void run(true)} loading={busy === 'dry'} disabled={parsed.rows.length === 0 || !can.edit || busy !== ''}>
            {t('Check (dry run)')}
          </Button>
          {can.manage ? (
            <Button onClick={() => void run(false)} loading={busy === 'real'} disabled={result === null || !result.dry_run || parsed.rows.length === 0 || busy !== ''}>
              <Upload size={14} aria-hidden /> {t('Import {n} rows', { n: result !== null ? result.created + result.updated : parsed.rows.length })}
            </Button>
          ) : (
            <span className="text-xs text-[var(--agent-app-muted)]">{t('A manager or admin runs the import after the check.')}</span>
          )}
          <Switch checked={generate} onCheckedChange={setGenerate} label={t('Create deadlines from the dates')} />
        </div>
        {result !== null && (
          <div className="flex flex-col gap-2">
            <Notice tone={result.errors > 0 ? 'warn' : 'good'}>
              {result.dry_run
                ? t('Check only, nothing saved: {created} new, {updated} updates, {errors} with problems.', { created: result.created, updated: result.updated, errors: result.errors })
                : t('Imported: {created} created, {updated} updated, {deadlines} deadlines.', { created: result.created, updated: result.updated, deadlines: result.deadlines })}
            </Notice>
            <div className="max-h-80 overflow-auto border border-[var(--agent-app-border)]">
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr className="bg-[var(--agent-app-border)]/20 text-left text-[11px] uppercase tracking-wider text-[var(--agent-app-muted)]">
                    <th className="px-2 py-1.5">{t('Line')}</th>
                    <th className="px-2 py-1.5">{t('Mark')}</th>
                    <th className="px-2 py-1.5">{t('Result')}</th>
                    <th className="px-2 py-1.5">{t('Detail')}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.results.map((r) => (
                    <tr key={r.line} className="border-t border-[var(--agent-app-border)]/60">
                      <td className="px-2 py-1.5 tabular-nums">{r.line}</td>
                      <td className="max-w-[14rem] truncate px-2 py-1.5">
                        {r.id !== undefined ? (
                          <a href={href('matter', r.id)} className="hover:underline">
                            {r.title}
                          </a>
                        ) : (
                          r.title
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        <Pill tone={tone(r.action)}>{actionText(r.action)}</Pill>
                      </td>
                      <td className="min-w-[12rem] break-words px-2 py-1.5 text-[var(--agent-app-muted)]">{bi({ en: r.message, ja: r.message_ja ?? '' })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}
