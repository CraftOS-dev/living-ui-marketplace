/**
 * Enforcement case pieces: the action ladder (which steps happened, with
 * the clocks that follow them), the notice drafts (never sent from the
 * app), and evidence with capture times in UTC and JST, a SHA-256 hash
 * computed in the browser and a preservation date.
 */
import { useMemo, useRef, useState } from 'react';
import { Bot, CalendarPlus, Camera, Check, Eye, FileText, Hash, Paperclip, Save, ShieldCheck } from 'lucide-react';
import { Button, Dialog, Input, Select, Textarea, cn, toast } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { fileUrl, op, opForm, q } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { fmtDate } from '../lib/format.ts';
import { bi, enumLabel, enumOptions, t } from '../lib/i18n.ts';
import type { EventRec, EvidenceRec } from '../lib/records.ts';
import type { Bi } from '../lib/shapes.ts';
import { AgentStatus, handToCraftBot } from './craftbot.tsx';
import { DeleteButton } from './deleteRecord.tsx';
import { useEventLabel } from './events.tsx';
import { EmptyHint, ErrorBox, Field, Loading, Notice, Section, TONE_BG, TONE_TEXT, Tag } from './ui.tsx';
import type { CaseX } from './protectCaseForms.tsx';
import { CopyButton, utcJst, validityTone, opts } from './protectShared.tsx';

/* ------------------------------------------------------------------ */
/* Action ladder                                                       */
/* ------------------------------------------------------------------ */

export const LADDER = ['NOTICE_SENT', 'PLATFORM_REQUEST_SENT', 'TAKEDOWN_CONFIRMED', 'COUNTER_NOTICE_RECEIVED', 'DISCLOSURE_REQUESTED', 'COMPLAINT_FILED', 'SUIT_FILED', 'SETTLED'] as const;

export function ActionLadder({ c, onRecord }: { c: CaseX; onRecord: (code: string) => void }): React.JSX.Element {
  const { can } = useApp();
  const eventLabel = useEventLabel();
  const events = useCollection<EventRec>('events', { filter: `case_ref = ${q(c.id)}`, sort: 'date,created' });
  const done = useMemo(() => {
    const m = new Map<string, EventRec>();
    for (const e of events.records) if (!m.has(e.code)) m.set(e.code, e);
    return m;
  }, [events.records]);
  const nextCode = LADDER.find((code) => !done.has(code)) ?? 'SETTLED';
  const has = (code: string): boolean => done.has(code);

  const clocks: string[] = [];
  if (has('PLATFORM_REQUEST_SENT') && !has('TAKEDOWN_CONFIRMED') && (c.forum === 'jp_platform' || c.forum === 'platform_report')) {
    clocks.push(t('Large Japanese platforms must decide on a removal request within 7 days (Information Distribution Platform Act). Follow up if there is no answer.'));
  }
  if (has('COUNTER_NOTICE_RECEIVED') && (c.forum === 'dmca' || c.forum === 'marketplace')) {
    clocks.push(t('After a DMCA counter-notice the platform restores the material 10 to 14 business days later unless you file suit and tell the platform.'));
  }
  if (c.forum === 'customs') {
    clocks.push(t('Customs: answer a verification notice within the period it states. The deadlines come from the recorded events.'));
  }
  if (has('DISCLOSURE_REQUESTED')) {
    clocks.push(t('Providers keep access logs only for a few months. Ask for preservation early; the evidence list shows the dates.'));
  }

  return (
    <Section
      title={t('Action ladder')}
      actions={
        can.edit ? (
          <Button size="sm" onClick={() => onRecord(nextCode)}>
            <CalendarPlus size={13} aria-hidden /> {t('Record next step')}
          </Button>
        ) : undefined
      }
    >
      {events.error !== null ? (
        <ErrorBox message={events.error} onRetry={events.refresh} />
      ) : (
        <div className="flex flex-col gap-3">
          <ol className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 xl:grid-cols-8">
            {LADDER.map((code, i) => {
              const ev = done.get(code);
              const isNext = ev === undefined && code === nextCode;
              return (
                <li
                  key={code}
                  className={cn(
                    'flex min-w-0 flex-col gap-0.5 border px-2 py-1.5',
                    ev !== undefined ? cn(TONE_BG.good, 'border-[var(--agent-app-border)]') : isNext ? 'border-[var(--agent-app-accent)]' : 'border-[var(--agent-app-border)]',
                  )}
                >
                  <span className="flex items-center gap-1.5 text-[11px] text-[var(--agent-app-muted)]">
                    {ev !== undefined ? <Check size={11} className={TONE_TEXT.good} aria-hidden /> : <span className="font-mono tabular-nums">{i + 1}</span>}
                    {ev !== undefined ? fmtDate(ev.date) : isNext ? t('Next|step') : t('Not yet')}
                  </span>
                  <span className={cn('break-words text-[12px] leading-snug', ev !== undefined ? 'font-medium' : 'text-[var(--agent-app-text)]/80')}>{eventLabel(code)}</span>
                </li>
              );
            })}
          </ol>
          {clocks.map((x) => (
            <Notice key={x} tone="warn">
              {x}
            </Notice>
          ))}
        </div>
      )}
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Notice drafts                                                       */
/* ------------------------------------------------------------------ */

interface DraftResult {
  forum: string;
  lang: string;
  text: string;
  missing: Bi[];
  sent: boolean;
}

export function NoticePanel({ c }: { c: CaseX }): React.JSX.Element {
  const { can } = useApp();
  const [forum, setForum] = useState<string>(c.forum || 'cease_desist');
  const [lang, setLang] = useState('');
  const [busy, setBusy] = useState<'' | 'preview' | 'save' | 'craftbot'>('');
  const [preview, setPreview] = useState<DraftResult | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);

  const run = async (save: boolean): Promise<void> => {
    setBusy(save ? 'save' : 'preview');
    try {
      const body: Record<string, unknown> = { case_id: c.id, forum, preview: !save };
      if (lang !== '') body['lang'] = lang;
      const r = await op<DraftResult>('cases/draft-notice', body);
      setPreview(r);
      if (save) toast.success(t('Saved as the case draft'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  };

  const askCraftBot = async (): Promise<void> => {
    setBusy('craftbot');
    const params: Record<string, unknown> = { case_id: c.id };
    if (['dmca', 'jp_platform', 'marketplace', 'cease_desist', 'sender_disclosure', 'other'].includes(forum)) params['forum'] = forum;
    if (lang !== '') params['lang'] = lang;
    const id = await handToCraftBot('takedown_drafts_requested', params);
    setBusy('');
    if (id !== null) setRequestId(id);
  };

  return (
    <div className="flex flex-col gap-4">
      <Notice icon={ShieldCheck}>{t('Notices are never sent from this app. Copy the draft, send it through the platform\'s form or by mail yourself, then record the step on the action ladder.')}</Notice>
      <Section title={t('Draft a notice')}>
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label={t('Forum')} value={forum} options={opts(enumOptions('enforcement_cases.forum'))} onChange={(e) => setForum(e.target.value)} />
            <Select
              label={t('Language')}
              value={lang}
              placeholder={t('Usual for the forum')}
              options={[
                { value: 'ja', label: t('Japanese') },
                { value: 'en', label: t('English') },
              ]}
              onChange={(e) => setLang(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void run(false)} loading={busy === 'preview'} disabled={busy !== '' || !can.rights}>
              <Eye size={14} aria-hidden /> {t('Preview')}
            </Button>
            {can.rights && (
              <Button onClick={() => void run(true)} loading={busy === 'save'} disabled={busy !== ''}>
                <Save size={14} aria-hidden /> {t('Save as the case draft')}
              </Button>
            )}
            {can.rights && (
              <Button variant="outline" onClick={() => void askCraftBot()} loading={busy === 'craftbot'} disabled={busy !== '' || requestId !== null}>
                <Bot size={14} aria-hidden /> {t('Ask CraftBot to draft notices for the platform')}
              </Button>
            )}
          </div>
          {!can.rights && <p className="text-xs text-[var(--agent-app-muted)]">{t('People on the rights team draft notices.')}</p>}
          {requestId !== null && (
            <div className="flex flex-col gap-1">
              <AgentStatus requestId={requestId} workingText={t('CraftBot is drafting the notices...')} doneText={t('CraftBot saved its draft on the case. Check it below before you send it.')} />
              <p className="text-xs text-[var(--agent-app-muted)]">{t('CraftBot drafts it, you send it.')}</p>
            </div>
          )}
          {preview !== null && (
            <div className="flex flex-col gap-2">
              {preview.missing.length > 0 && (
                <Notice tone="warn">
                  <div className="font-medium">{t('Before you send it')}</div>
                  <ul className="mt-1 list-disc pl-4">
                    {preview.missing.map((m, i) => (
                      <li key={i}>{bi(m)}</li>
                    ))}
                  </ul>
                </Notice>
              )}
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-medium">
                  {t('Preview')} <span className="font-normal text-[var(--agent-app-muted)]">({enumLabel('enforcement_cases.forum', preview.forum)}, {preview.lang === 'ja' ? t('Japanese') : t('English')})</span>
                </span>
                <CopyButton text={preview.text} />
              </div>
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words border border-[var(--agent-app-border)] bg-[var(--agent-app-bg)] p-3 font-mono text-[12px] leading-relaxed">{preview.text}</pre>
            </div>
          )}
        </div>
      </Section>
      <Section title={t('Saved draft')} actions={c.draft_notice !== '' ? <CopyButton text={c.draft_notice} /> : undefined}>
        {c.draft_notice !== '' ? (
          <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words border border-[var(--agent-app-border)] bg-[var(--agent-app-bg)] p-3 font-mono text-[12px] leading-relaxed">{c.draft_notice}</pre>
        ) : (
          <p className="text-[13px] text-[var(--agent-app-muted)]">{t('No draft saved yet. Preview one above and save it, or ask CraftBot to draft it for the platform.')}</p>
        )}
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Evidence                                                            */
/* ------------------------------------------------------------------ */

export function EvidencePanel({ c }: { c: CaseX }): React.JSX.Element {
  const { can, userName } = useApp();
  const evidence = useCollection<EvidenceRec>('evidence', { filter: `case_ref = ${q(c.id)}`, sort: '-captured_at,-created' });
  const [adding, setAdding] = useState(false);

  return (
    <Section
      title={t('Evidence')}
      meta={evidence.records.length > 0 ? String(evidence.records.length) : undefined}
      flush
      actions={
        can.contribute ? (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Camera size={13} aria-hidden /> {t('Add evidence')}
          </Button>
        ) : undefined
      }
    >
      {evidence.loading && evidence.records.length === 0 ? (
        <Loading />
      ) : evidence.error !== null ? (
        <div className="p-4">
          <ErrorBox message={evidence.error} onRetry={evidence.refresh} />
        </div>
      ) : evidence.records.length === 0 ? (
        <EmptyHint
          compact
          icon={Camera}
          title={t('No evidence yet')}
          message={t('Capture each listing or post with its URL and time, keep the file and its hash, and note who handled it. Platforms and courts ask for this.')}
          action={
            can.contribute ? (
              <Button size="sm" onClick={() => setAdding(true)}>
                {t('Add evidence')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        evidence.records.map((ev) => {
          const when = utcJst(ev.captured_at);
          const keep = validityTone(ev.preserve_until);
          return (
            <div key={ev.id} className="flex flex-col gap-2 border-b border-[var(--agent-app-border)]/70 px-4 py-3 last:border-0">
              <div className="flex flex-wrap items-center gap-2">
                <Tag>{enumLabel('evidence.kind', ev.kind) || t('Evidence')}</Tag>
                {ev.url !== '' && (
                  <a href={ev.url} target="_blank" rel="noreferrer noopener" className="min-w-0 break-all font-mono text-[12px] text-[var(--agent-app-accent)] hover:underline">
                    {ev.url}
                  </a>
                )}
                <DeleteButton
                  collection="evidence"
                  id={ev.id}
                  iconOnly
                  className="ml-auto"
                  label={t('Delete this evidence')}
                  note={t('Evidence keeps its value only with an unbroken record. Delete only an entry added by mistake.')}
                />
              </div>
              <div className="grid gap-x-6 gap-y-1.5 text-[12.5px] sm:grid-cols-2 lg:grid-cols-4">
                <div className="min-w-0">
                  <div className="text-[11px] text-[var(--agent-app-muted)]">{t('Captured at')}</div>
                  {when !== null ? (
                    <div className="tabular-nums">
                      <div>{when.utc} UTC</div>
                      <div className="text-[var(--agent-app-muted)]">{when.jst} JST</div>
                    </div>
                  ) : (
                    <div className="text-[var(--agent-app-muted)]">{ev.captured_at || '-'}</div>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] text-[var(--agent-app-muted)]">SHA-256</div>
                  {ev.sha256 !== '' ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-[12px]" title={ev.sha256}>
                        {ev.sha256.slice(0, 12)}...{ev.sha256.slice(-6)}
                      </span>
                      <CopyButton text={ev.sha256} className="h-6" />
                    </div>
                  ) : (
                    <div className="text-[var(--agent-app-muted)]">{t('No hash')}</div>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] text-[var(--agent-app-muted)]">{t('Captured by')}</div>
                  <div className="truncate">{userName(ev.captured_by) || '-'}</div>
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] text-[var(--agent-app-muted)]">{t('Preserve until')}</div>
                  <div className={cn('tabular-nums', keep !== 'neutral' && TONE_TEXT[keep])}>{fmtDate(ev.preserve_until) || '-'}</div>
                </div>
              </div>
              {(ev.chain_note !== '' || ev.notes !== '') && (
                <div className="text-[12.5px]">
                  {ev.chain_note !== '' && (
                    <div className="break-words">
                      <span className="text-[var(--agent-app-muted)]">{t('Chain of custody')}: </span>
                      {ev.chain_note}
                    </div>
                  )}
                  {ev.notes !== '' && <div className="break-words text-[var(--agent-app-muted)]">{ev.notes}</div>}
                </div>
              )}
              {ev.file.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {ev.file.map((f) => (
                    <a key={f} href={fileUrl(ev, f)} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 text-xs text-[var(--agent-app-accent)] hover:underline">
                      <FileText size={12} aria-hidden /> <span className="truncate">{f}</span>
                    </a>
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}
      {adding && <AddEvidenceDialog c={c} onClose={() => setAdding(false)} />}
    </Section>
  );
}

function nowLocal(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

async function sha256Hex(file: File): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function AddEvidenceDialog({ c, onClose }: { c: CaseX; onClose: () => void }): React.JSX.Element {
  const [kind, setKind] = useState('screenshot');
  const [url, setUrl] = useState((c.urls ?? []).length === 1 ? String((c.urls ?? [])[0]) : '');
  const [file, setFile] = useState<File | null>(null);
  const [sha, setSha] = useState('');
  const [hashing, setHashing] = useState(false);
  const [hashError, setHashError] = useState('');
  const [captured, setCaptured] = useState(nowLocal());
  const [years, setYears] = useState('5');
  const [chain, setChain] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);

  const capturedIso = useMemo(() => {
    const ms = new Date(captured).getTime();
    return Number.isNaN(ms) ? '' : new Date(ms).toISOString();
  }, [captured]);
  const when = utcJst(capturedIso);

  const pick = async (f: File | null | undefined): Promise<void> => {
    setFile(f ?? null);
    setSha('');
    setHashError('');
    if (f === null || f === undefined) return;
    if (typeof crypto === 'undefined' || crypto.subtle === undefined) {
      setHashError(t('This browser cannot compute the hash here (it needs a secure connection). The file is still saved.'));
      return;
    }
    setHashing(true);
    try {
      setSha(await sha256Hex(f));
    } catch {
      setHashError(t('The hash could not be computed. The file is still saved.'));
    } finally {
      setHashing(false);
    }
  };

  const valid = (file !== null || url.trim() !== '') && !hashing;

  const submit = async (): Promise<void> => {
    if (!valid) return;
    setBusy(true);
    try {
      const r = await opForm<{ id: string; preserve_until: string; sha256: string }>(
        'cases/evidence',
        { case_id: c.id, kind, url: url.trim(), captured_at: capturedIso, sha256: sha, chain_note: chain.trim(), notes: notes.trim(), preserve_years: Number(years) || 5 },
        file !== null ? { file: [file] } : undefined,
      );
      toast.success(t('Evidence saved. Keep it until {date}.', { date: fmtDate(r.preserve_until) }));
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('Add evidence')}
      description={t('The file is hashed in your browser (SHA-256) so you can show later that it has not changed.')}
      className="w-[min(94vw,40rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={!valid}>
            {t('Save evidence')}
          </Button>
        </>
      }
    >
      <div className="flex max-h-[65vh] flex-col gap-3 overflow-y-auto pr-1">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label={t('Kind')} value={kind} options={opts(enumOptions('evidence.kind'))} onChange={(e) => setKind(e.target.value)} />
          <Field label={t('Captured at (your time)')} help={when !== null ? `${when.utc} UTC · ${when.jst} JST` : undefined}>
            <input type="datetime-local" className="h-9 w-full min-w-0 border border-[var(--agent-app-border)] bg-[var(--agent-app-surface-2)] px-2 text-sm" value={captured} onChange={(e) => setCaptured(e.target.value)} />
          </Field>
        </div>
        <Input label={t('URL captured')} value={url} className="font-mono text-[12px]" placeholder="https://" onChange={(e) => setUrl(e.target.value)} />
        <Field label={t('File')} help={t('Screenshot, page archive (PDF or MHTML), video, or receipt of a test purchase.')}>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => input.current?.click()}>
              <Paperclip size={13} aria-hidden /> {file !== null ? t('Choose another file') : t('Choose a file')}
            </Button>
            {file !== null && <span className="min-w-0 break-all text-xs">{file.name}</span>}
            <input ref={input} type="file" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
          </div>
        </Field>
        {(hashing || sha !== '' || hashError !== '') && (
          <div className="flex items-start gap-2 border border-[var(--agent-app-border)] px-3 py-2 text-[12px]">
            <Hash size={13} className="mt-0.5 shrink-0 text-[var(--agent-app-muted)]" aria-hidden />
            <span className="min-w-0 break-all font-mono">{hashing ? t('Computing the hash...') : sha !== '' ? sha : <span className="font-sans text-[var(--agent-app-muted)]">{hashError}</span>}</span>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={t('Keep for (years)')} type="number" min={1} max={20} value={years} onChange={(e) => setYears(e.target.value)} />
          <div className="flex items-end pb-1 text-xs text-[var(--agent-app-muted)]">{t('Providers often keep logs only 3 to 6 months: request preservation early.')}</div>
        </div>
        <Textarea label={t('Chain of custody')} rows={2} value={chain} onChange={(e) => setChain(e.target.value)} placeholder={t('Who captured it, how, and where the original is kept')} />
        <Textarea label={t('Notes')} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        {file === null && url.trim() === '' && <p className="text-xs text-[var(--agent-app-muted)]">{t('Add a file or the URL captured.')}</p>}
      </div>
    </Dialog>
  );
}
