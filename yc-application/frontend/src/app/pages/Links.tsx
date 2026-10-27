/**
 * Step 1, Links and files: two equal ways in (paste a link, or upload a
 * pitch deck, business plan or other document), then the list of what your
 * AI agent reads. Only once something is added does the application card
 * appear, with the one button for your AI agent to fill it.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight, FileText, Github, Globe, Link2, Linkedin, Plus, Presentation, Sparkles, Upload, X } from 'lucide-react';
import { cn, useAgentRequest } from '../../kit/index.ts';
import { op, opForm } from '../lib/api.ts';
import { changed } from '../lib/live.ts';
import { hostOf } from '../lib/format.ts';
import { vanish } from '../lib/motion.tsx';
import { href } from '../lib/router.ts';
import { notify } from '../lib/toast.tsx';
import type { Pipeline, Source } from '../lib/types.ts';
import { Card, CircleButton, IconBadge, PageHeader, PillButton, PillLink, Segments, StatusPill, Tip, confirmAsk, pillInput } from '../components/ui.tsx';

/** The icon for what a source is, as your AI agent recorded it after reading it. */
const KIND_ICON: Record<string, LucideIcon> = { linkedin: Linkedin, github: Github, website: Globe, deck: Presentation, doc: FileText, file: FileText };

/** What a file is, as your AI agent recorded it after reading it. */
const FILE_KIND: Record<string, string> = { deck: 'Pitch deck', doc: 'Document', metrics: 'Metrics', file: 'File' };

const ACCEPT = '.pdf,.ppt,.pptx,.key,.doc,.docx,.odt,.odp,.rtf,.txt,.md,.pages,.xls,.xlsx,.csv,.numbers';
const MAX_BYTES = 50 * 1024 * 1024;

function labelOf(s: Source): string {
  if (s.title !== '') return s.title;
  if (s.url !== '') return hostOf(s.url) + new URL(s.url, 'https://x').pathname.replace(/\/$/, '');
  return 'File';
}

const STATE: Record<Source['state'], { text: string; tone: 'neutral' | 'warn' | 'good' | 'bad' }> = {
  new: { text: 'Not read yet', tone: 'neutral' },
  reading: { text: 'Reading', tone: 'warn' },
  read: { text: 'Read', tone: 'good' },
  failed: { text: 'Could not read', tone: 'bad' },
};

/** What your AI agent wrote after filling: three lines, the rest on "Show all". */
function AgentNote({ text }: { text: string }): React.JSX.Element {
  const [all, setAll] = useState(false);
  const [long, setLong] = useState(false);
  const box = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (el !== null && !all) setLong(el.scrollHeight > el.clientHeight + 1);
  }, [text, all]);
  return (
    <div className="mt-5 rounded-[18px] bg-[var(--yc-row)] px-4 py-3">
      <p className="text-[12px] font-bold text-[var(--yc-muted)]">From your AI agent</p>
      <p ref={box} className={cn('mt-1 whitespace-pre-line text-[13px] leading-5 text-[var(--yc-ink-2)]', !all && 'line-clamp-3')}>
        {text}
      </p>
      {(long || all) && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-1 text-[13px] font-semibold underline underline-offset-4 hover:decoration-2">
          {all ? 'Show less' : 'Show all'}
        </button>
      )}
    </div>
  );
}

/** Paste a link, or upload a file (click or drop): two panels side by side, equally plain to see. */
function AddSources(): React.JSX.Element {
  const [url, setUrl] = useState('');
  const [uploading, setUploading] = useState(0);
  const [over, setOver] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const add = async (): Promise<void> => {
    const u = url.trim();
    if (u === '') return;
    setUrl('');
    try {
      await op('sources.add', { url: u });
      changed('sources');
    } catch {
      setUrl(u);
    }
  };
  const upload = async (files: FileList | null): Promise<void> => {
    if (files === null || files.length === 0) return;
    const list = Array.from(files);
    setUploading((n) => n + list.length);
    for (const f of list) {
      try {
        if (f.size > MAX_BYTES) notify.error(f.name + ' is over 50 MB');
        else await opForm('sources.upload', {}, { file: f });
      } catch {
        /* the notice says why */
      } finally {
        setUploading((n) => n - 1);
      }
    }
    changed('sources');
  };

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="grid content-start gap-3 rounded-[20px] bg-[var(--yc-row)] p-4 md:p-5">
        <div className="flex items-center gap-3">
          <IconBadge icon={Link2} tone="light" />
          <div className="min-w-0">
            <p className="text-[15px] font-bold">Add a link</p>
            <p className="text-[12px] text-[var(--yc-muted)]">Your website and each founder&apos;s LinkedIn and GitHub show YC what you build and who you are</p>
          </div>
        </div>
        <div className="flex gap-2">
          <input
            className={pillInput}
            value={url}
            placeholder="Website, LinkedIn or GitHub link"
            aria-label="Paste a link"
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void add();
            }}
          />
          <PillButton variant="dark" icon={Plus} onClick={() => void add()} disabled={url.trim() === ''}>
            Add
          </PillButton>
        </div>
      </div>

      <div
        className={cn('grid content-start gap-3 rounded-[20px] bg-[var(--yc-row)] p-4 transition-shadow md:p-5', over && 'shadow-[inset_0_0_0_2px_var(--yc-ink)]')}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void upload(e.dataTransfer.files);
        }}
      >
        <div className="flex items-center gap-3">
          <IconBadge icon={Presentation} tone="light" />
          <div className="min-w-0">
            <p className="text-[15px] font-bold">Upload a file</p>
            <p className="text-[12px] text-[var(--yc-muted)]">Your pitch deck or business plan gives your numbers, market and plan. PDF, PowerPoint or Word, up to 50 MB</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <PillButton variant="dark" icon={Upload} loading={uploading > 0} onClick={() => file.current?.click()}>
            {uploading > 0 ? 'Uploading' : 'Choose a file'}
          </PillButton>
          <span className="text-[13px] text-[var(--yc-muted)]">or drop it here</span>
        </div>
        <input
          ref={file}
          type="file"
          multiple
          hidden
          accept={ACCEPT}
          onChange={(e) => {
            void upload(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}

export function LinksPage({ p }: { p: Pipeline }): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const { request } = useAgentRequest(p.settings.gather_request !== '' ? p.settings.gather_request : null);
  const locked = p.settings.status !== 'preparing';
  const g = p.settings.gather_state;
  const working = (g === 'requested' || g === 'working') && (request === null || request.status === 'pending' || request.status === 'claimed');
  const total = p.sections.reduce((n, s) => n + s.total, 0);
  const answered = p.sections.reduce((n, s) => n + s.answered, 0);
  const pct = total === 0 ? 0 : Math.round((answered / total) * 100);
  const empty = p.sources.length === 0;

  const remove = async (s: Source, row: Element | null): Promise<void> => {
    if (!(await confirmAsk(s.file !== '' ? 'Remove this file?' : 'Remove this link?', labelOf(s), 'Remove'))) return;
    const undo = await vanish(row);
    try {
      await op('sources.remove', { source: s.id });
      changed('sources');
    } catch {
      undo();
    }
  };
  const gather = async (): Promise<void> => {
    setBusy(true);
    try {
      await op('gather.start');
      changed('settings');
    } catch {
      /* the notice says why */
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Links and files"
        subtitle="Your AI agent reads these to write your YC answers for you, so you type as little as possible"
        actions={
          g === 'done' ? (
            <PillLink variant="dark" dot icon={ArrowRight} href={href('team')}>
              Next: team
            </PillLink>
          ) : undefined
        }
      />

      {empty ? (
        <Card>
          {locked ? <p className="text-[13px] text-[var(--yc-muted)]">The application is sent, so nothing new can be added.</p> : <AddSources />}
        </Card>
      ) : (
        <div className="grid gap-4">
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div className="min-w-0">
                <p className="text-[15px] font-bold">Your application</p>
                <p className="mt-0.5 text-[13px] text-[var(--yc-muted)]">
                  {working ? 'Your AI agent is writing every answer it can from these' : g === 'done' ? 'Added more links or files? Fill it again so your AI agent uses them' : 'Press Fill my application and your AI agent writes every answer it can from these'}
                </p>
                <p className="mt-4 flex items-baseline gap-2">
                  <span className="num text-[26px] font-extrabold leading-[34px]">{pct}%</span>
                  <span className="num text-[13px] text-[var(--yc-muted)]">
                    {answered} of {total} answers
                  </span>
                </p>
                <Segments value={answered} max={Math.max(1, total)} count={24} className="mt-2" />
              </div>
              {!locked &&
                (working ? (
                  <StatusPill tone="info" pulse>
                    {request?.status === 'claimed' || g === 'working' ? 'Your AI agent is reading your links and files' : 'Waiting for your AI agent'}
                  </StatusPill>
                ) : (
                  <PillButton variant="dark" dot icon={Sparkles} loading={busy} onClick={() => void gather()}>
                    {g === 'done' ? 'Fill it again' : 'Fill my application'}
                  </PillButton>
                ))}
            </div>
            {p.settings.gather_summary !== '' && !working && <AgentNote text={p.settings.gather_summary} />}
          </Card>

          <Card>
            {!locked && <AddSources />}
            <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-2">
              {p.sources.map((s) => {
                const st = STATE[s.state];
                const isFile = s.file !== '';
                return (
                  <div key={s.id} data-row className="flex items-center gap-3 rounded-[18px] bg-[var(--yc-row)] px-3 py-2.5">
                    <IconBadge icon={KIND_ICON[s.kind] ?? (isFile ? FileText : Link2)} />
                    <Tip text={s.summary !== '' ? s.summary : s.error} className="min-w-0 flex-1">
                      <span className="min-w-0 flex-1" tabIndex={0}>
                        <span className="block truncate text-[14px] font-bold">{labelOf(s)}</span>
                        <span className="block truncate text-[12px] text-[var(--yc-muted)]">{isFile ? (FILE_KIND[s.kind] ?? 'File') : hostOf(s.url)}</span>
                      </span>
                    </Tip>
                    <StatusPill tone={st.tone}>{st.text}</StatusPill>
                    {!locked && <CircleButton icon={X} label="Remove" variant="light" size={32} onClick={(e) => void remove(s, e.currentTarget.closest('[data-row]'))} />}
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
