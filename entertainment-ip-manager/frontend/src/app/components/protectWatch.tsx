/**
 * Watch results: trademark watch hits and marketplace listings to review
 * (dismiss, keep monitoring, escalate to a case, record the action taken),
 * the CraftBot marketplace scan (it proposes hits in the Inbox, it never
 * reports anything), and the CSV import of watch reports.
 */
import { useMemo, useState } from 'react';
import { Bot, Eye, Radar, Search, ShieldAlert, Upload, X } from 'lucide-react';
import { Button, Dialog, Input, Select, Textarea, cn, toast } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { op, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { d10, daysUntil, fmtDate, relLabel, toPb, today } from '../lib/format.ts';
import { bi, enumLabel, enumOptions, t, tn } from '../lib/i18n.ts';
import type { Bi } from '../lib/shapes.ts';
import { href, navigate, useHashParam } from '../lib/router.ts';
import type { WatchHitRec } from '../lib/records.ts';
import { AgentStatus, handToCraftBot } from './craftbot.tsx';
import { DeleteButton } from './deleteRecord.tsx';
import { CatalogSelect } from './pickers.tsx';
import { EmptyHint, EnumPill, ErrorBox, Field, JurChip, Loading, Notice, Section, Segmented, TONE_BAR, TONE_TEXT, Tag } from './ui.tsx';
import { CaseDialog } from './protectCaseForms.tsx';
import type { CaseDefaults, CaseX } from './protectCaseForms.tsx';
import { opts } from './protectShared.tsx';
import { CsvSource, csvRows } from './protectTools.tsx';

const OPEN = new Set(['new', 'reviewing', 'monitor']);

function scoreTone(score: number): 'bad' | 'warn' | 'neutral' {
  return score >= 70 ? 'bad' : score >= 40 ? 'warn' : 'neutral';
}

function ScoreMeter({ score }: { score: number }): React.JSX.Element {
  const s = Math.max(0, Math.min(100, Math.round(score)));
  const tone = scoreTone(s);
  return (
    <span className="inline-flex items-center gap-1.5" title={t('Similarity or risk score {n} of 100', { n: s })}>
      <span className="h-1.5 w-12 bg-[var(--agent-app-border)]/60">
        <span className={cn('block h-full', TONE_BAR[tone === 'neutral' ? 'info' : tone])} style={{ width: `${s}%` }} />
      </span>
      <span className={cn('text-xs tabular-nums', tone !== 'neutral' && TONE_TEXT[tone])}>{s}</span>
    </span>
  );
}

/** What a hit escalates into. */
function caseDefaultsFor(h: WatchHitRec): CaseDefaults {
  const type = h.kind === 'marketplace' ? 'counterfeit' : h.kind === 'trademark' ? 'trademark_conflict' : h.kind === 'impersonation' ? 'impersonation' : 'other';
  const forum = h.kind === 'marketplace' ? 'marketplace' : h.kind === 'trademark' ? 'opposition' : h.kind === 'impersonation' ? 'platform_report' : 'other';
  return {
    title: h.their_mark,
    case_type: type,
    forum,
    platform: h.kind === 'marketplace' || h.kind === 'impersonation' ? h.source : '',
    their_party: h.their_owner,
    urls: h.url !== '' ? [h.url] : [],
    characters: h.character !== '' ? [h.character] : [],
    talents: h.talent !== '' ? [h.talent] : [],
    matters: h.matter !== '' ? [h.matter] : [],
  };
}

export function WatchPanel(): React.JSX.Element {
  const { can, me, nameOf } = useApp();
  const hits = useCollection<WatchHitRec>('watch_hits', { sort: '-created', expand: 'case_ref,family' });
  const [status, setStatus] = useHashParam('w_status', 'open');
  const [kind, setKind] = useHashParam('w_kind', '');
  const [text, setText] = useState('');
  const [escalating, setEscalating] = useState<WatchHitRec | null>(null);
  const [acting, setActing] = useState<WatchHitRec | null>(null);
  const [panel, setPanel] = useState<'' | 'scan' | 'import'>('');

  const rows = useMemo(() => {
    const needle = text.trim().toLowerCase();
    return hits.records.filter((h) => {
      if (status === 'open' ? !OPEN.has(h.status) : status !== '' && h.status !== status) return false;
      if (kind !== '' && h.kind !== kind) return false;
      if (needle === '') return true;
      return [h.their_mark, h.their_owner, h.url, h.application_no, h.goods].some((x) => x.toLowerCase().includes(needle));
    });
  }, [hits.records, status, kind, text]);

  const setHit = async (h: WatchHitRec, next: WatchHitRec['status'], extra: Record<string, unknown> = {}): Promise<void> => {
    try {
      await updateRecord<WatchHitRec>('watch_hits', h.id, { status: next, reviewer: me?.id ?? '', decided_at: toPb(today()), ...extra });
      toast.success(t('Updated'));
    } catch {
      /* the client showed the error */
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-[var(--agent-app-muted)]" aria-hidden />
          <Input aria-label={t('Search')} className="pl-8" placeholder={t('Mark, seller or URL')} value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <div className="w-full sm:w-44">
          <Select aria-label={t('Status')} value={status} placeholder={t('Any status')} options={[{ value: 'open', label: t('To review') }, ...opts(enumOptions('watch_hits.status'))]} onChange={(e) => setStatus(e.target.value)} />
        </div>
        <div className="w-full sm:w-44">
          <Select aria-label={t('Kind')} value={kind} placeholder={t('Any kind')} options={opts(enumOptions('watch_hits.kind'))} onChange={(e) => setKind(e.target.value)} />
        </div>
        {can.edit && (
          <div className="flex flex-wrap gap-2 sm:ml-auto">
            <Button variant={panel === 'scan' ? 'primary' : 'outline'} size="sm" onClick={() => setPanel(panel === 'scan' ? '' : 'scan')}>
              <Radar size={13} aria-hidden /> {t('Scan marketplaces with CraftBot')}
            </Button>
            <Button variant={panel === 'import' ? 'primary' : 'outline'} size="sm" onClick={() => setPanel(panel === 'import' ? '' : 'import')}>
              <Upload size={13} aria-hidden /> {t('Import watch results')}
            </Button>
          </div>
        )}
      </div>

      {panel === 'scan' && <ScanForm onClose={() => setPanel('')} />}
      {panel === 'import' && <WatchImport onClose={() => setPanel('')} />}

      <Section title={t('Watch results')} meta={rows.length !== hits.records.length ? t('{shown} of {all}', { shown: rows.length, all: hits.records.length }) : String(hits.records.length)} flush>
        {hits.loading && hits.records.length === 0 ? (
          <Loading />
        ) : hits.error !== null ? (
          <div className="p-4">
            <ErrorBox message={hits.error} onRetry={hits.refresh} />
          </div>
        ) : hits.records.length === 0 ? (
          <EmptyHint
            compact
            icon={Eye}
            title={t('No watch results yet')}
            message={t('Import a trademark watch report or marketplace monitoring results, or ask CraftBot to scan marketplaces. Accepted CraftBot findings land here.')}
          />
        ) : rows.length === 0 ? (
          <EmptyHint compact icon={Search} title={t('Nothing matches these filters')} />
        ) : (
          rows.map((h) => {
            const caseRec = h.expand?.['case_ref'] as CaseX | undefined;
            const opp = d10(h.opposition_deadline);
            const oppDays = opp !== '' ? daysUntil(opp) : 0;
            const subject = nameOf('character', h.character) || nameOf('talent', h.talent);
            return (
              <div key={h.id} className="flex flex-col gap-2 border-b border-[var(--agent-app-border)]/70 px-4 py-3 last:border-0 lg:flex-row lg:items-center lg:gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Tag>{enumLabel('watch_hits.kind', h.kind) || t('Watch')}</Tag>
                    {h.jurisdiction !== '' && <JurChip code={h.jurisdiction} />}
                    <span className="min-w-0 break-words text-sm font-medium">{h.their_mark}</span>
                    {h.classes !== '' && <span className="font-mono text-xs text-[var(--agent-app-muted)]">{t('Classes {list}', { list: h.classes })}</span>}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-[var(--agent-app-muted)]">
                    {h.their_owner !== '' && <span className="break-words">{h.their_owner}</span>}
                    {h.application_no !== '' && <span className="font-mono">{h.application_no}</span>}
                    {subject !== '' && <span>{t('Against {name}', { name: subject })}</span>}
                    {h.source !== '' && <span>{t('Source: {source}', { source: h.source })}</span>}
                    {opp !== '' && OPEN.has(h.status) && (
                      <span className={cn(oppDays < 0 ? TONE_TEXT.bad : oppDays <= 30 ? TONE_TEXT.warn : '')}>
                        {t('Opposition by {date}', { date: fmtDate(opp) })} ({relLabel(opp)})
                      </span>
                    )}
                  </div>
                  {h.url !== '' && (
                    <a href={h.url} target="_blank" rel="noreferrer noopener" className="mt-0.5 block break-all font-mono text-[11.5px] text-[var(--agent-app-accent)] hover:underline">
                      {h.url}
                    </a>
                  )}
                  {h.action !== '' && <div className="mt-0.5 break-words text-xs">{t('Action: {text}', { text: h.action })}</div>}
                  {caseRec !== undefined && (
                    <a href={href('case', caseRec.id)} className="mt-0.5 inline-block font-mono text-xs text-[var(--agent-app-accent)] hover:underline">
                      {caseRec.ref}
                    </a>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {h.score > 0 && <ScoreMeter score={h.score} />}
                  <EnumPill field="watch_hits.status" value={h.status} />
                  {can.edit && OPEN.has(h.status) && (
                    <>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => void setHit(h, 'dismissed')}>
                        <X size={12} aria-hidden /> {t('Dismiss')}
                      </Button>
                      {h.status !== 'monitor' && (
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => void setHit(h, 'monitor')}>
                          <Eye size={12} aria-hidden /> {t('Monitor')}
                        </Button>
                      )}
                      <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setEscalating(h)}>
                        <ShieldAlert size={12} aria-hidden /> {t('Escalate')}
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setActing(h)}>
                        {t('Action taken')}
                      </Button>
                    </>
                  )}
                  <DeleteButton collection="watch_hits" id={h.id} iconOnly label={t('Delete this watch hit')} />
                </div>
              </div>
            );
          })
        )}
      </Section>

      {escalating !== null && (
        <CaseDialog
          defaults={caseDefaultsFor(escalating)}
          onClose={() => setEscalating(null)}
          onCreated={(c) => {
            const h = escalating;
            void setHit(h, 'escalated', { case_ref: c.id }).then(() => navigate('case', c.id));
          }}
        />
      )}
      {acting !== null && <ActionDialog hit={acting} onClose={() => setActing(null)} onSave={(text2) => setHit(acting, 'actioned', { action: text2 })} />}
    </div>
  );
}

function ActionDialog({ hit, onClose, onSave }: { hit: WatchHitRec; onClose: () => void; onSave: (text: string) => Promise<void> }): React.JSX.Element {
  const [text, setText] = useState(hit.action);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('Action taken')}
      description={hit.their_mark}
      className="w-[min(94vw,32rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button
            loading={busy}
            disabled={text.trim() === ''}
            onClick={() => {
              setBusy(true);
              void onSave(text.trim()).finally(() => {
                setBusy(false);
                onClose();
              });
            }}
          >
            {t('Save')}
          </Button>
        </>
      }
    >
      <Textarea label={t('What was done')} rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('For example: letter of objection sent to the applicant; seller removed the listing')} />
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* CraftBot marketplace scan                                           */
/* ------------------------------------------------------------------ */

function marketplaceChoices(): { value: string; label: string }[] {
  return [
    { value: 'Mercari', label: enumLabel('platform_enrollments.platform', 'mercari') },
    { value: 'Rakuten', label: enumLabel('platform_enrollments.platform', 'rakuten') },
    { value: 'Yahoo! Auctions', label: enumLabel('platform_enrollments.platform', 'yahoo_auctions') },
    { value: 'Amazon JP', label: t('Amazon Japan') },
    { value: 'AliExpress', label: t('AliExpress') },
    { value: 'Taobao', label: t('Taobao') },
    { value: 'eBay', label: t('eBay') },
    { value: 'Shopee', label: t('Shopee') },
  ];
}

function ScanForm({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { on } = useApp();
  const [kind, setKind] = useState<'character' | 'franchise'>('character');
  const [id, setId] = useState('');
  const [chosen, setChosen] = useState<string[]>(['Mercari', 'Rakuten', 'Yahoo! Auctions', 'Amazon JP', 'AliExpress']);
  const [busy, setBusy] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const choices = marketplaceChoices();

  const fire = async (): Promise<void> => {
    if (id === '') return;
    setBusy(true);
    const params: Record<string, unknown> = { marketplaces: chosen.join(', ') };
    if (kind === 'character') params['character_id'] = id;
    else params['franchise_id'] = id;
    const rid = await handToCraftBot('marketplace_scan_requested', params);
    setBusy(false);
    if (rid !== null) setRequestId(rid);
  };

  if (!on('franchises')) {
    return <Notice>{t('Marketplace scans look for goods of a character or franchise. Switch on the franchises module in Settings to use them.')}</Notice>;
  }

  return (
    <Section
      title={t('Scan marketplaces with CraftBot')}
      actions={
        <Button size="sm" variant="ghost" className="h-7 px-2" aria-label={t('Close')} onClick={onClose}>
          <X size={14} />
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-[var(--agent-app-muted)]">{t('CraftBot searches the marketplaces for likely counterfeit or unlicensed goods and proposes what it finds in the Inbox. It never reports listings or contacts sellers.')}</p>
        <div className="flex flex-wrap items-end gap-3">
          <Segmented<'character' | 'franchise'>
            size="sm"
            value={kind}
            onChange={(v) => {
              setKind(v);
              setId('');
            }}
            options={[
              { value: 'character', label: t('Character') },
              { value: 'franchise', label: t('Franchise') },
            ]}
          />
          <div className="w-full sm:w-72">
            <CatalogSelect kind={kind} value={id} onChange={setId} placeholder={t('Choose')} />
          </div>
        </div>
        <Field label={t('Marketplaces')}>
          <div className="flex flex-wrap gap-1.5">
            {choices.map((c) => {
              const onNow = chosen.includes(c.value);
              return (
                <button
                  key={c.value}
                  type="button"
                  aria-pressed={onNow}
                  onClick={() => setChosen(onNow ? chosen.filter((x) => x !== c.value) : [...chosen, c.value])}
                  className={cn(
                    'border px-2 py-1 text-xs',
                    onNow ? 'border-[var(--agent-app-accent)] bg-[var(--agent-app-accent)]/10 text-[var(--agent-app-accent)]' : 'border-[var(--agent-app-border)] text-[var(--agent-app-text)]/80 hover:bg-[var(--agent-app-border)]/30',
                  )}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void fire()} loading={busy} disabled={id === '' || chosen.length === 0 || requestId !== null}>
            <Bot size={14} aria-hidden /> {t('Start the scan')}
          </Button>
          {requestId !== null && (
            <a href={href('inbox')} className="text-xs font-medium text-[var(--agent-app-accent)] hover:underline">
              {t('Open the Inbox')}
            </a>
          )}
        </div>
        <AgentStatus requestId={requestId} workingText={t('CraftBot is searching the marketplaces...')} doneText={t('CraftBot filed what it found in the Inbox for review.')} />
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Import watch results                                                */
/* ------------------------------------------------------------------ */

const WATCH_FIELDS: Record<string, string[]> = {
  their_mark: ['their mark', 'mark', 'title', 'listing', 'listing title', '商標', '出品名', '件名'],
  their_owner: ['their owner', 'owner', 'seller', 'applicant', '出願人', '出品者', '権利者'],
  url: ['url', 'link', 'URL'],
  jurisdiction: ['office', 'country', 'jurisdiction', '官庁', '国'],
  application_no: ['application no', 'application number', '出願番号'],
  classes: ['classes', 'class', '区分'],
  goods: ['goods', 'goods and services', 'specification', '指定商品', '商品'],
  publication_date: ['publication date', 'published', '公開日', '公告日'],
  opposition_deadline: ['opposition deadline', 'opposition', '異議期限', '異議申立期限'],
  score: ['score', 'similarity', '類似度'],
  kind: ['kind', 'type', '種類'],
  source: ['source', 'provider', 'marketplace', 'platform', '出典'],
  our_mark: ['our mark', 'our family', '当社商標'],
  character: ['character', 'キャラクター'],
};

function WatchImport({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Bi[]>([]);
  const parsed = useMemo(() => csvRows(text, WATCH_FIELDS), [text]);

  const run = async (): Promise<void> => {
    if (parsed.rows.length === 0) return;
    setBusy(true);
    try {
      const r = await op<{ created: number; errors: Bi[] }>('import/watch', { rows: parsed.rows });
      toast.success(tn(r.created, '{n} watch result imported', '{n} watch results imported'));
      setErrors(r.errors);
      if (r.errors.length === 0) onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title={t('Import watch results')}
      actions={
        <Button size="sm" variant="ghost" className="h-7 px-2" aria-label={t('Close')} onClick={onClose}>
          <X size={14} />
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-[var(--agent-app-muted)]">
          {t('A trademark watch report or marketplace monitoring export, one hit per row. Columns: their mark (or listing title), owner or seller, URL, office, application number, classes, goods, publication date, opposition deadline, score, our mark, character.')}
        </p>
        <CsvSource text={text} onText={setText} placeholder={`${t('their mark,owner,url,office,classes,opposition deadline')}\n...`} />
        {text.trim() !== '' && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--agent-app-muted)]">
            <span>{tn(parsed.rows.length, '{n} row read', '{n} rows read')}</span>
            {parsed.headers.map((m) => (
              <Tag key={m}>{m}</Tag>
            ))}
            {parsed.unknown.length > 0 && <span>{t('Ignored columns: {list}', { list: parsed.unknown.join(', ') })}</span>}
          </div>
        )}
        <div>
          <Button onClick={() => void run()} loading={busy} disabled={parsed.rows.length === 0 || !parsed.mapped.includes('their_mark')}>
            <Upload size={14} aria-hidden /> {t('Import {n} rows', { n: parsed.rows.length })}
          </Button>
        </div>
        {text.trim() !== '' && !parsed.mapped.includes('their_mark') && <Notice tone="warn">{t('No column for their mark or the listing title was found. Name it "their mark" or "title".')}</Notice>}
        {errors.length > 0 && (
          <Notice tone="warn">
            <ul className="list-disc pl-4">
              {errors.map((e) => (
                <li key={e.en}>{bi(e)}</li>
              ))}
            </ul>
          </Notice>
        )}
      </div>
    </Section>
  );
}
