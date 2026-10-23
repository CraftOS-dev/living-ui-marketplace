/**
 * One paper in detail: cover and the next action (open, add a PDF, get the
 * open-access copy, ask your AI agent for the full text), identification,
 * integrity notices, abstract, metadata edited in place, identifiers, tags,
 * collections, projects, notes and highlights, files, and its citation.
 */
import { useRef, useState } from 'react';
import { BookOpenText, Check, CircleAlert, Copy, Download, ExternalLink, FileUp, Fingerprint, FolderKanban, FolderPlus, Highlighter, Lightbulb, MoreHorizontal, NotebookPen, Pencil, Plus, Quote, RefreshCw, RotateCcw, Sparkles, Star, Tag, Trash2, X } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { op, opForm } from '../../lib/api.ts';
import { useApp } from '../../lib/context.tsx';
import { changed, useLive } from '../../lib/live.ts';
import { TYPE_LABEL, bytes, plural, shortDate } from '../../lib/format.ts';
import { navigate } from '../../lib/router.ts';
import type { Person, WorkDetail } from '../../lib/types.ts';
import { RequestStatus, askAgent } from '../agent.tsx';
import { AgentMark, Cover, PaperState, TextState, hueOfSlot, openPaper } from '../paper.tsx';
import { Badge, Button, IconButton, LoadError, Popover, PropSection, Select, Skeleton, Spinner, TextLink, inputCls, menuItem, textareaCls, useConfirm } from '../ui.tsx';

export function PaperPane({ id, onClose }: { id: string; onClose?: () => void }): React.JSX.Element {
  const w = useLive((signal) => op<{ work: WorkDetail }>('works.get', { work: id }, { quiet: true, signal }).then((r) => r.work), ['works', 'files', 'work_tags', 'collection_items', 'project_works', 'annotations', 'notes', 'nodes', 'field_marks'], [id], 200);
  if (w.error !== null) return <div className="p-3"><LoadError message={w.error} onRetry={w.reload} /></div>;
  if (w.data === null)
    return (
      <div className="flex flex-col gap-2 p-3">
        <Skeleton className="h-32 w-24" />
        <Skeleton className="w-3/4" />
        <Skeleton className="w-1/2" />
      </div>
    );
  return <Pane work={w.data} onClose={onClose} />;
}

function Pane({ work, onClose }: { work: WorkDetail; onClose?: (() => void) | undefined }): React.JSX.Element {
  const [confirmEl, confirm] = useConfirm();
  const [more, setMore] = useState(false);
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [request, setRequest] = useState('');
  const run = async (key: string, fn: () => Promise<unknown>): Promise<void> => {
    setBusy(key);
    try {
      await fn();
    } catch {
      /* toasted */
    } finally {
      setBusy(null);
    }
  };
  const uploadPdf = (f: File): void => {
    void run('pdf', async () => {
      await opForm('files.upload', { work: work.id }, { file: f });
      changed('files', 'works');
      toast.success('PDF added');
    });
  };
  const oaAvailable = work.oa_pdf_url !== '' || work.arxiv_id !== '';
  const trash = async (): Promise<void> => {
    if (!(await confirm('It can be restored from the trash.', 'Move "' + work.title.slice(0, 60) + '" to the trash?', 'Move to trash'))) return;
    await op('works.trash', { works: [work.id] });
    changed('works');
    onClose?.();
  };
  return (
    <div className="flex flex-col @container">
      {confirmEl}
      <div className="flex gap-3 border-b border-[var(--ro-hair)] p-3">
        <button type="button" onClick={() => openPaper(work)} title={work.file ? 'Open' : 'No PDF yet'} className="shrink-0">
          <Cover work={{ ...work, file: work.file ? { id: work.file.id, pages: work.file.pages, text_state: work.file.text_state, has_thumb: work.file.has_thumb, pos_page: work.file.pos_page, max_page: work.file.max_page } : null }} width={84} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-1">
            <h2 className="serif min-w-0 flex-1 text-[15px] font-semibold leading-5">{work.title}</h2>
            {onClose !== undefined && <IconButton icon={X} label="Close" size={24} onClick={onClose} />}
          </div>
          <p className="mt-1 text-[12px] leading-4 text-[var(--ro-ink-2)]">{work.authors.length > 0 ? authorsLine(work.authors) : 'No authors listed'}</p>
          <p className="mt-0.5 text-[12px] text-[var(--ro-muted)]">{[work.container, work.year > 0 ? work.year : '', TYPE_LABEL[work.type]].filter(Boolean).join(' · ')}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <PaperState work={work} />
            {work.file !== null && <TextState state={work.file.text_state} />}
            {work.added_by === 'agent' && <Badge tone="agent">Added by your AI agent</Badge>}
            {work.cited_by > 0 && <Badge tone="neutral">{plural(work.cited_by, 'citation')}</Badge>}
            {work.oa_status !== '' && work.oa_status !== 'closed' && <Badge tone="good">Open access</Badge>}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--ro-hair)] px-3 py-2">
        {work.file !== null ? (
          <Button variant="primary" size="sm" icon={BookOpenText} onClick={() => openPaper(work)}>
            {work.file.max_page > 1 ? `Continue at page ${work.file.max_page}` : 'Read'}
          </Button>
        ) : (
          <>
            {oaAvailable && (
              <Button variant="primary" size="sm" icon={Download} loading={busy === 'oa' || work.oa_fetch === 'due'} onClick={() => void run('oa', async () => { await op('files.fetch-oa', { work: work.id }); changed('files', 'works'); toast.success('Open-access PDF added'); })}>
                Get open-access PDF
              </Button>
            )}
            <Button size="sm" icon={FileUp} loading={busy === 'pdf'} onClick={() => fileInput.current?.click()}>
              Add PDF
            </Button>
            <Button size="sm" icon={Sparkles} onClick={() => void askAgent('access_requested', { work: work.id }, 'Your AI agent is asked to find the full text').then(setRequest)}>
              Find full text
            </Button>
          </>
        )}
        <input ref={fileInput} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPdf(f); }} />
        <span className="flex-1" />
        <IconButton icon={Star} label={work.starred ? 'Unstar' : 'Star'} active={work.starred} className={work.starred ? 'text-[var(--ro-amber-text)]' : undefined} onClick={() => void op('works.set-state', { works: [work.id], starred: !work.starred }).then(() => changed('works'))} />
        <IconButton ref={moreRef} icon={MoreHorizontal} label="More" onClick={() => setMore((m) => !m)} />
        <Popover open={more} onClose={() => setMore(false)} anchor={moreRef} align="right" className="w-56">
          {work.read_state !== 'read' ? (
            <button type="button" className={menuItem} onClick={() => { setMore(false); void op('works.set-state', { works: [work.id], read_state: 'read' }).then(() => changed('works')); }}>
              <Check size={14} /> Mark as read
            </button>
          ) : (
            <button type="button" className={menuItem} onClick={() => { setMore(false); void op('works.set-state', { works: [work.id], read_state: 'unread' }).then(() => changed('works')); }}>
              <RotateCcw size={14} /> Mark as unread
            </button>
          )}
          {(work.resolution === 'resolved' || work.resolution === 'not_found' || work.resolution === 'unreachable') && (
            <button type="button" className={menuItem} onClick={() => { setMore(false); void op('works.refresh', { work: work.id }).then(() => { changed('works'); toast.success('Asked the registry again'); }); }}>
              <RefreshCw size={14} /> Refresh from the registry
            </button>
          )}
          <button type="button" className={menuItem} onClick={() => { setMore(false); void op<{ content: string }>('export.works', { works: [work.id], format: 'bibtex' }).then((r) => navigator.clipboard.writeText(r.content)).then(() => toast.success('BibTeX copied')); }}>
            <Copy size={14} /> Copy BibTeX
          </button>
          <button type="button" className={menuItem} onClick={() => { setMore(false); navigate('paper', { id: work.id }); }}>
            <ExternalLink size={14} /> Open its page
          </button>
          <div className="my-1 h-px bg-[var(--ro-hair)]" />
          <button type="button" className={cn(menuItem, 'text-[var(--ro-red-text)] [&>svg]:text-[var(--ro-red-text)]')} onClick={() => { setMore(false); void trash(); }}>
            <Trash2 size={14} /> Move to trash
          </button>
        </Popover>
      </div>
      {request !== '' && <div className="border-b border-[var(--ro-hair)] px-3 py-1.5"><RequestStatus id={request} /></div>}
      {(work.resolution === 'pending' || work.resolution === 'not_found' || work.identify === 'failed' || work.identity === 'agent_proposed') && <IdentifyBox work={work} />}
      {(work.integrity === 'retracted' || work.integrity === 'concern' || work.integrity === 'corrected') && <IntegrityBox work={work} />}
      {work.abstract !== '' && <Abstract text={work.abstract} />}
      <Details work={work} />
      <Places work={work} />
      <Reading work={work} />
      <Files work={work} onReplace={() => fileInput.current?.click()} />
      <CiteBox work={work} />
    </div>
  );
}

export function authorsLine(a: Person[]): string {
  const names = a.map((x) => (x.family ? (x.given ? x.given + ' ' : '') + x.family : (x.literal ?? '')));
  return names.length > 12 ? names.slice(0, 10).join(', ') + ' and ' + (names.length - 10) + ' more' : names.join(', ');
}

function IdentifyBox({ work }: { work: WorkDetail }): React.JSX.Element {
  const [id, setId] = useState('');
  const [busy, setBusy] = useState(false);
  const [req, setReq] = useState('');
  if (work.identity === 'agent_proposed' && work.resolution === 'resolved') {
    return (
      <div className="flex items-start gap-2 border-b border-[var(--ro-hair)] bg-[var(--ro-accent-soft)] px-3 py-2.5">
        <Sparkles size={14} className="mt-0.5 shrink-0 text-[var(--ro-accent-text)]" />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold">Your AI agent identified this PDF as this paper.</p>
          <p className="text-[12px] text-[var(--ro-ink-2)]">Check the title and authors against the first page.</p>
        </div>
        <Button size="sm" icon={Check} onClick={() => void op('works.confirm-identity', { works: [work.id] }).then(() => changed('works'))}>
          Confirm
        </Button>
      </div>
    );
  }
  const go = async (): Promise<void> => {
    if (id.trim() === '') return;
    setBusy(true);
    try {
      await op('works.identify', { work: work.id, identifier: id.trim() });
      changed('works', 'files');
      setId('');
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2 border-b border-[var(--ro-hair)] bg-[var(--ro-row)] px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[12px] font-semibold">
        <Fingerprint size={14} />
        {work.identify === 'working' ? 'Your AI agent is identifying this PDF' : work.identify === 'failed' ? 'Your AI agent could not identify this PDF' : work.resolution === 'not_found' ? 'No registry has this identifier' : 'Which paper is this?'}
      </p>
      {work.identify_note !== '' && <p className="text-[12px] leading-4 text-[var(--ro-ink-2)]">{work.identify_note}</p>}
      <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <input value={id} onChange={(e) => setId(e.target.value)} placeholder="DOI, arXiv ID or ISBN" className={cn(inputCls, 'mono')} aria-label="Identifier" />
        <Button type="submit" size="md" loading={busy}>
          Identify
        </Button>
      </form>
      <div className="flex flex-wrap items-center gap-2">
        {work.identify !== 'working' && <TextLink tone="accent" onClick={() => void askAgent('papers_waiting', {}, 'Your AI agent is asked to identify waiting PDFs').then(setReq)}><Sparkles size={12} /> Ask your AI agent</TextLink>}
        <RequestStatus id={req} />
      </div>
    </div>
  );
}

function IntegrityBox({ work }: { work: WorkDetail }): React.JSX.Element {
  const notices = work.integrity_detail?.notices ?? [];
  const tone = work.integrity === 'retracted' ? 'bg-[var(--ro-red)]/10 text-[var(--ro-red-text)]' : 'bg-[var(--ro-amber)]/15 text-[var(--ro-amber-text)]';
  return (
    <div className={cn('flex items-start gap-2 border-b border-[var(--ro-hair)] px-3 py-2.5', tone)}>
      <CircleAlert size={14} className="mt-0.5 shrink-0" />
      <div className="min-w-0 text-[12px] leading-4">
        <p className="font-bold">{work.integrity === 'retracted' ? 'This paper was retracted' : work.integrity === 'concern' ? 'An expression of concern was published' : 'A correction was published'}</p>
        {notices.map((n, i) => (
          <p key={i}>
            {n.type.replace(/_/g, ' ')}
            {n.date !== '' ? ' · ' + n.date : ''}
            {n.doi !== '' && (
              <>
                {' · '}
                <a href={'https://doi.org/' + n.doi} target="_blank" rel="noreferrer" className="underline">
                  {n.doi}
                </a>
              </>
            )}
            {n.source !== '' ? ' · ' + n.source.replace(/-/g, ' ') : ''}
          </p>
        ))}
      </div>
    </div>
  );
}

function Abstract({ text }: { text: string }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <PropSection title="Abstract" actions={text.length > 400 ? <TextLink onClick={() => setOpen((o) => !o)}>{open ? 'Less' : 'More'}</TextLink> : undefined}>
      <p className={cn('whitespace-pre-line text-[13px] leading-[19px] text-[var(--ro-ink-2)]', !open && 'line-clamp-6')}>{text}</p>
    </PropSection>
  );
}

const EDIT_FIELDS: { key: keyof WorkDetail; label: string; wide?: boolean }[] = [
  { key: 'title', label: 'Title', wide: true },
  { key: 'container', label: 'Journal, proceedings or book', wide: true },
  { key: 'year', label: 'Year' },
  { key: 'volume', label: 'Volume' },
  { key: 'issue', label: 'Issue' },
  { key: 'pages', label: 'Pages' },
  { key: 'publisher', label: 'Publisher' },
  { key: 'place', label: 'Place' },
  { key: 'edition', label: 'Edition' },
  { key: 'url', label: 'URL', wide: true },
  { key: 'citekey', label: 'Citation key' },
];

function Details({ work }: { work: WorkDetail }): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const marked = new Set(work.marks.map((m) => m.field));
  const start = (): void => {
    const d: Record<string, string> = {};
    for (const f of EDIT_FIELDS) d[f.key] = String(work[f.key] ?? '');
    d.authors = work.authors.map((a) => (a.family ? a.family + (a.given ? ', ' + a.given : '') : (a.literal ?? ''))).join('; ');
    d.type = work.type;
    d.abstract = work.abstract;
    setDraft(d);
    setEditing(true);
  };
  const save = async (): Promise<void> => {
    setBusy(true);
    const authors = (draft.authors ?? '')
      .split(';')
      .map((x) => x.trim())
      .filter((x) => x !== '')
      .map((x) => (x.indexOf(',') > 0 ? { family: x.split(',')[0]?.trim() ?? '', given: x.split(',').slice(1).join(',').trim() } : { literal: x }));
    const p: Record<string, unknown> = { work: work.id, authors: JSON.stringify(authors), type: draft.type, abstract: draft.abstract };
    for (const f of EDIT_FIELDS) {
      const v = draft[f.key] ?? '';
      if (v !== String(work[f.key] ?? '')) p[f.key] = f.key === 'year' ? Number(v) || 0 : v;
    }
    try {
      await op('works.update', p);
      changed('works');
      setEditing(false);
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  const ids = work.identifiers;
  return (
    <PropSection title="Details" actions={editing ? undefined : <TextLink onClick={start}><Pencil size={11} /> Edit</TextLink>}>
      {editing ? (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-semibold text-[var(--ro-ink-2)]">Authors</span>
            <input value={draft.authors ?? ''} onChange={(e) => setDraft({ ...draft, authors: e.target.value })} className={inputCls} placeholder="Family, Given; Family, Given" />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <Select label="Kind of work" value={draft.type ?? 'other'} onChange={(v) => setDraft({ ...draft, type: v })} options={Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))} />
            {EDIT_FIELDS.map((f) => (
              <label key={f.key} className={cn('flex min-w-0 flex-col gap-1', f.wide && 'col-span-2')}>
                <span className="text-[12px] font-semibold text-[var(--ro-ink-2)]">{f.label}</span>
                <input value={draft[f.key] ?? ''} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} className={inputCls} />
              </label>
            ))}
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-semibold text-[var(--ro-ink-2)]">Abstract</span>
            <textarea rows={4} value={draft.abstract ?? ''} onChange={(e) => setDraft({ ...draft, abstract: e.target.value })} className={textareaCls} />
          </label>
          <div className="flex justify-end gap-2">
            <Button size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" loading={busy} onClick={() => void save()}>
              Save
            </Button>
          </div>
        </div>
      ) : (
        <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-2 gap-y-1 text-[12px]">
          {[
            ['Volume', work.volume],
            ['Issue', work.issue],
            ['Pages', work.pages],
            ['Publisher', work.publisher],
            ['Published', work.issued],
            ['Citation key', work.citekey],
          ]
            .filter((r) => r[1] !== '')
            .map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-[var(--ro-muted)]">{k}</dt>
                <dd className="flex min-w-0 items-center gap-1 truncate font-medium">
                  {v}
                  {marked.has(String(k).toLowerCase()) && <AgentMark title="Filled by your AI agent; check it" />}
                </dd>
              </div>
            ))}
          {ids.doi !== '' && (
            <div className="contents">
              <dt className="text-[var(--ro-muted)]">DOI</dt>
              <dd className="truncate">
                <a href={'https://doi.org/' + ids.doi} target="_blank" rel="noreferrer" className="mono text-[var(--ro-accent-text)] hover:underline">{ids.doi}</a>
              </dd>
            </div>
          )}
          {ids.arxiv_id !== '' && (
            <div className="contents">
              <dt className="text-[var(--ro-muted)]">arXiv</dt>
              <dd className="truncate">
                <a href={'https://arxiv.org/abs/' + ids.arxiv_id} target="_blank" rel="noreferrer" className="mono text-[var(--ro-accent-text)] hover:underline">{ids.arxiv_id}</a>
              </dd>
            </div>
          )}
          {ids.pmid !== '' && (
            <div className="contents">
              <dt className="text-[var(--ro-muted)]">PubMed</dt>
              <dd className="truncate">
                <a href={'https://pubmed.ncbi.nlm.nih.gov/' + ids.pmid + '/'} target="_blank" rel="noreferrer" className="mono text-[var(--ro-accent-text)] hover:underline">{ids.pmid}</a>
              </dd>
            </div>
          )}
          {ids.isbn !== '' && (
            <div className="contents">
              <dt className="text-[var(--ro-muted)]">ISBN</dt>
              <dd className="mono truncate">{ids.isbn}</dd>
            </div>
          )}
          <div className="contents">
            <dt className="text-[var(--ro-muted)]">Added</dt>
            <dd className="truncate">
              {shortDate(work.created)} by {work.added_by === 'agent' ? 'your AI agent' : work.added_by === 'system' ? 'the app' : 'you'}
            </dd>
          </div>
          {work.edited.length > 0 && <p className="col-span-2 text-[12px] text-[var(--ro-muted)]">Fields you edited stay as you set them.</p>}
        </dl>
      )}
    </PropSection>
  );
}

function Places({ work }: { work: WorkDetail }): React.JSX.Element {
  const { tags, collections, projects } = useApp();
  const [tagOpen, setTagOpen] = useState(false);
  const [colOpen, setColOpen] = useState(false);
  const [projOpen, setProjOpen] = useState(false);
  const [tagText, setTagText] = useState('');
  const tagRef = useRef<HTMLButtonElement | null>(null);
  const colRef = useRef<HTMLButtonElement | null>(null);
  const projRef = useRef<HTMLButtonElement | null>(null);
  const applyTag = async (body: Record<string, unknown>): Promise<void> => {
    await op('tags.apply', { works: [work.id], ...body });
    changed('work_tags', 'tags');
  };
  const chip = 'inline-flex h-6 max-w-full items-center gap-1 rounded-[var(--ro-r-sm)] bg-[var(--ro-row)] px-1.5 text-[12px] font-semibold text-[var(--ro-ink-2)]';
  return (
    <PropSection title="Where it is">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1">
          <Tag size={13} className="text-[var(--ro-muted)]" />
          {work.tags.map((t) => (
            <span key={t.id} className={chip}>
              {t.color_slot > 0 && <span className="size-1.5 rounded-full" style={{ background: `var(--ro-hl-${hueOfSlot(t.color_slot)})` }} />}
              <span className="truncate">{t.name}</span>
              <button type="button" aria-label={'Remove ' + t.name} onClick={() => void applyTag({ tag: t.id, remove: true })} className="text-[var(--ro-muted)] hover:text-[var(--ro-ink)]">
                <X size={11} />
              </button>
            </span>
          ))}
          <button ref={tagRef} type="button" onClick={() => setTagOpen(true)} className={cn(chip, 'bg-transparent hover:bg-[var(--ro-row)]')}>
            <Plus size={11} /> Tag
          </button>
          <Popover open={tagOpen} onClose={() => setTagOpen(false)} anchor={tagRef} className="w-56">
            <form onSubmit={(e) => { e.preventDefault(); if (tagText.trim() !== '') void applyTag({ name: tagText.trim() }).then(() => { setTagText(''); setTagOpen(false); }); }}>
              <input autoFocus value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder="New or existing tag" className={cn(inputCls, 'mb-1')} />
            </form>
            <div className="max-h-48 overflow-y-auto">
              {tags.filter((t) => t.name.toLowerCase().includes(tagText.toLowerCase()) && !work.tags.some((x) => x.id === t.id)).map((t) => (
                <button key={t.id} type="button" className={menuItem} onClick={() => { void applyTag({ tag: t.id }); setTagOpen(false); }}>
                  <span className="size-2 rounded-full" style={{ background: t.color_slot > 0 ? `var(--ro-hl-${hueOfSlot(t.color_slot)})` : 'var(--ro-track)' }} />
                  {t.name}
                </button>
              ))}
            </div>
          </Popover>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <FolderPlus size={13} className="text-[var(--ro-muted)]" />
          {work.collections.map((c) => (
            <span key={c.id} className={chip}>
              <button type="button" onClick={() => navigate('library', { collection: c.id })} className="truncate hover:underline">{c.name}</button>
              <button type="button" aria-label={'Take it out of ' + c.name} onClick={() => void op('collections.remove', { collection: c.id, works: [work.id] }).then(() => changed('collection_items', 'collections'))} className="text-[var(--ro-muted)] hover:text-[var(--ro-ink)]">
                <X size={11} />
              </button>
            </span>
          ))}
          <button ref={colRef} type="button" onClick={() => setColOpen(true)} className={cn(chip, 'bg-transparent hover:bg-[var(--ro-row)]')}>
            <Plus size={11} /> Collection
          </button>
          <Popover open={colOpen} onClose={() => setColOpen(false)} anchor={colRef} className="max-h-64 w-56 overflow-y-auto">
            {collections.length === 0 && <p className="px-2 py-1 text-[12px] text-[var(--ro-muted)]">No collections yet</p>}
            {collections.filter((c) => !work.collections.some((x) => x.id === c.id)).map((c) => (
              <button key={c.id} type="button" className={menuItem} onClick={() => { setColOpen(false); void op('collections.add', { collection: c.id, works: [work.id] }).then(() => changed('collection_items', 'collections')); }}>
                {c.name}
              </button>
            ))}
          </Popover>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <FolderKanban size={13} className="text-[var(--ro-muted)]" />
          {work.projects.map((p) => (
            <span key={p.id} className={chip}>
              <span className="size-1.5 rounded-full" style={{ background: `var(--ro-pc-${p.color})` }} />
              <button type="button" onClick={() => navigate('project', { id: p.id, view: 'reading' })} className="truncate hover:underline">{p.name}</button>
            </span>
          ))}
          <button ref={projRef} type="button" onClick={() => setProjOpen(true)} className={cn(chip, 'bg-transparent hover:bg-[var(--ro-row)]')}>
            <Plus size={11} /> Project
          </button>
          <Popover open={projOpen} onClose={() => setProjOpen(false)} anchor={projRef} className="max-h-64 w-60 overflow-y-auto">
            {projects.filter((p) => p.state === 'active' && !work.projects.some((x) => x.id === p.id)).map((p) => (
              <button key={p.id} type="button" className={menuItem} onClick={() => { setProjOpen(false); void op('projects.add-works', { project: p.id, works: [work.id] }).then(() => changed('project_works', 'projects')); }}>
                <span className="size-2 rounded-full" style={{ background: `var(--ro-pc-${p.color})` }} />
                {p.name}
              </button>
            ))}
            {projects.filter((p) => p.state === 'active').length === 0 && <p className="px-2 py-1 text-[12px] text-[var(--ro-muted)]">No projects yet</p>}
          </Popover>
        </div>
      </div>
    </PropSection>
  );
}

function Reading({ work }: { work: WorkDetail }): React.JSX.Element {
  const openNote = async (): Promise<void> => {
    const r = await op<{ note: { id: string } }>('notes.for-work', { work: work.id });
    navigate('notes', { note: r.note.id });
  };
  return (
    <PropSection title="Your reading">
      <div className="grid grid-cols-3 gap-1.5">
        <button type="button" onClick={() => openPaper(work)} disabled={work.file === null} className="flex flex-col items-start gap-0.5 rounded-[var(--ro-r)] border border-[var(--ro-line)] px-2 py-1.5 text-left hover:bg-[var(--ro-row)] disabled:opacity-50">
          <Highlighter size={13} className="text-[var(--ro-ink-2)]" />
          <span className="num text-[15px] font-bold">{work.counts.annotations}</span>
          <span className="text-[12px] text-[var(--ro-muted)]">highlights</span>
        </button>
        <button type="button" onClick={() => void openNote()} className="flex flex-col items-start gap-0.5 rounded-[var(--ro-r)] border border-[var(--ro-line)] px-2 py-1.5 text-left hover:bg-[var(--ro-row)]">
          <NotebookPen size={13} className="text-[var(--ro-ink-2)]" />
          <span className="num text-[15px] font-bold">{work.counts.notes}</span>
          <span className="text-[12px] text-[var(--ro-muted)]">{work.counts.notes === 0 ? 'Start a note' : 'notes'}</span>
        </button>
        <div className="flex flex-col items-start gap-0.5 rounded-[var(--ro-r)] border border-[var(--ro-line)] px-2 py-1.5">
          <Lightbulb size={13} className="text-[var(--ro-ink-2)]" />
          <span className="num text-[15px] font-bold">{work.counts.nodes}</span>
          <span className="text-[12px] text-[var(--ro-muted)]">claims, evidence</span>
        </div>
      </div>
    </PropSection>
  );
}

function Files({ work, onReplace }: { work: WorkDetail; onReplace: () => void }): React.JSX.Element | null {
  const [confirmEl, confirm] = useConfirm();
  if (work.files.length === 0) return null;
  const remove = async (fileId: string, name: string): Promise<void> => {
    const pv = await op<{ takes: { annotations: number; passages: number } }>('files.delete', { file: fileId, preview: true });
    if (!(await confirm('Its ' + plural(pv.takes.annotations, 'highlight') + ' and ' + plural(pv.takes.passages, 'passage') + ' go with it.', 'Remove ' + name + '?', 'Remove'))) return;
    await op('files.delete', { file: fileId });
    changed('files', 'works', 'annotations');
  };
  return (
    <PropSection title="Files" actions={<TextLink onClick={onReplace}><FileUp size={11} /> New version</TextLink>}>
      {confirmEl}
      <ul className="flex flex-col gap-1">
        {work.files.map((f) => (
          <li key={f.id} className="flex items-center gap-2 text-[12px]">
            <span className={cn('min-w-0 flex-1 truncate', !f.current && 'text-[var(--ro-muted)]')}>
              {f.name}
              <span className="text-[var(--ro-muted)]"> · {f.pages > 0 ? plural(f.pages, 'page') + ' · ' : ''}{bytes(f.bytes)}{f.current ? '' : ' · older version'}</span>
            </span>
            <TextState state={f.text_state} />
            {f.text_state === 'failed' && <IconButton icon={RefreshCw} label="Read again" size={22} onClick={() => void op('files.retry-text', { file: f.id }).then(() => changed('files'))} />}
            {f.text_state === 'extracting' && <Spinner size={11} />}
            <IconButton icon={Trash2} label="Remove this PDF" variant="danger" size={22} onClick={() => void remove(f.id, f.name)} />
          </li>
        ))}
      </ul>
      {work.files.some((f) => f.text_error !== '') && <p className="mt-1 text-[12px] text-[var(--ro-red-text)]">{work.files.find((f) => f.text_error !== '')?.text_error}</p>}
    </PropSection>
  );
}

const STYLES = [
  { value: 'apa', label: 'APA 7' },
  { value: 'chicago', label: 'Chicago author-date' },
  { value: 'harvard', label: 'Harvard' },
  { value: 'ieee', label: 'IEEE' },
  { value: 'vancouver', label: 'Vancouver' },
  { value: 'mla', label: 'MLA 9' },
  { value: 'nature', label: 'Nature' },
];

function CiteBox({ work }: { work: WorkDetail }): React.JSX.Element {
  const { settings } = useApp();
  const [style, setStyle] = useState(settings?.citation_style ?? 'apa');
  const r = useLive((signal) => (work.citable ? op<{ in_text: { text: string }; entries: { html: string; text: string }[] }>('cite.format', { works: [work.id], style }, { quiet: true, signal }) : Promise.resolve(null)), ['works'], [work.id, style, work.citable, work.updated]);
  return (
    <PropSection title="Cite" actions={work.citable ? <Select ariaLabel="Citation style" className="w-40" value={style} onChange={setStyle} options={STYLES} /> : undefined}>
      {!work.citable ? (
        <p className="text-[12px] text-[var(--ro-muted)]">It can be cited once its identifier resolves, or after you enter its details by hand.</p>
      ) : r.data === null || r.data === undefined ? (
        <Skeleton className="w-full" />
      ) : (
        <div className="flex flex-col gap-1.5">
          <p className="text-[13px] leading-[19px]" dangerouslySetInnerHTML={{ __html: r.data.entries[0]?.html ?? '' }} />
          <div className="flex gap-1.5">
            <Button size="sm" icon={Quote} onClick={() => void navigator.clipboard.writeText(r.data?.in_text.text ?? '').then(() => toast.success('Citation copied'))}>
              {r.data.in_text.text}
            </Button>
            <Button size="sm" icon={Copy} onClick={() => void navigator.clipboard.writeText(r.data?.entries[0]?.text ?? '').then(() => toast.success('Reference copied'))}>
              Copy reference
            </Button>
          </div>
        </div>
      )}
    </PropSection>
  );
}
