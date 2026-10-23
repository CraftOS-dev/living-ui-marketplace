/**
 * Add papers: one dialog, four ways in.
 *
 *   Identifiers  paste DOIs, arXiv IDs, PubMed IDs, ISBNs (one or many)
 *   PDFs         drop or choose files; each is read, then identified
 *   Find         search Crossref, arXiv, OpenAlex and PubMed by title
 *   Import       a BibTeX, RIS or CSL-JSON file from another tool
 *
 * Whatever is added can also go into a collection and a project.
 */
import { createContext, useCallback, useContext, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Check, CircleAlert, FileText, FileUp, Fingerprint, Import, Library, Search, Undo2 } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { op, opForm } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { changed } from '../lib/live.ts';
import { byline, num, plural } from '../lib/format.ts';
import type { Candidate, SearchRun, WorkRow } from '../lib/types.ts';
import { Badge, Button, Empty, Modal, Segmented, Select, Spinner, inputCls, textareaCls } from './ui.tsx';

type Tab = 'ids' | 'pdf' | 'find' | 'import';

export interface AddOptions {
  project?: string | undefined;
  collection?: string | undefined;
  tab?: Tab;
  ids?: string;
}

const Ctx = createContext<{ open: (o: AddOptions) => void }>({ open: () => undefined });

export function useAddPapers(): { open: (o: AddOptions) => void } {
  return useContext(Ctx);
}

export function AddPapersProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [opts, setOpts] = useState<AddOptions | null>(null);
  const open = useCallback((o: AddOptions) => setOpts(o), []);
  return (
    <Ctx.Provider value={{ open }}>
      {children}
      {opts !== null && <AddDialog opts={opts} onClose={() => setOpts(null)} />}
    </Ctx.Provider>
  );
}

interface Done {
  key: string;
  title: string;
  detail: string;
  state: 'added' | 'existing' | 'bad' | 'reading';
  id?: string;
}

function AddDialog({ opts, onClose }: { opts: AddOptions; onClose: () => void }): React.JSX.Element {
  const { collections, projects } = useApp();
  const [tab, setTab] = useState<Tab>(opts.tab ?? 'ids');
  const [collection, setCollection] = useState(opts.collection ?? '');
  const [project, setProject] = useState(opts.project ?? '');
  const [done, setDone] = useState<Done[]>([]);
  const where = { collection: collection !== '' ? collection : undefined, project: project !== '' ? project : undefined };
  const push = (rows: Done[]): void => setDone((d) => [...rows, ...d].slice(0, 200));
  return (
    <Modal
      open
      onClose={onClose}
      title="Add papers"
      icon={Library}
      wide
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          <span className="text-[12px] font-semibold text-[var(--ro-ink-2)]">Also put them in</span>
          <Select ariaLabel="Collection" className="w-40" value={collection} onChange={setCollection} options={[{ value: '', label: 'No collection' }, ...collections.map((c) => ({ value: c.id, label: c.name }))]} />
          <Select ariaLabel="Project" className="w-44" value={project} onChange={setProject} options={[{ value: '', label: 'No project' }, ...projects.filter((p) => p.state === 'active').map((p) => ({ value: p.id, label: p.name }))]} />
          <span className="flex-1" />
          <Button onClick={onClose}>Done</Button>
        </div>
      }
    >
      <Segmented
        label="How to add"
        value={tab}
        onChange={setTab}
        className="mb-3"
        options={[
          { value: 'ids', label: 'Identifiers', icon: Fingerprint },
          { value: 'pdf', label: 'PDFs', icon: FileUp },
          { value: 'find', label: 'Find by title', icon: Search },
          { value: 'import', label: 'Import a file', icon: Import },
        ]}
      />
      {tab === 'ids' && <IdsTab initial={opts.ids ?? ''} where={where} onDone={push} />}
      {tab === 'pdf' && <PdfTab where={where} onDone={push} />}
      {tab === 'find' && <FindTab where={where} onDone={push} />}
      {tab === 'import' && <ImportTab where={where} />}
      {done.length > 0 && tab !== 'import' && (
        <ul className="mt-3 max-h-56 overflow-y-auto rounded-[var(--ro-r)] border border-[var(--ro-line)] bg-[var(--ro-card)]">
          {done.map((d) => (
            <li key={d.key} className="flex items-center gap-2 border-b border-[var(--ro-hair)] px-2.5 py-1.5 last:border-0">
              {d.state === 'added' && <Check size={14} className="shrink-0 text-[var(--ro-green-text)]" />}
              {d.state === 'reading' && <Spinner size={12} className="text-[var(--ro-muted)]" />}
              {d.state === 'existing' && <Library size={14} className="shrink-0 text-[var(--ro-muted)]" />}
              {d.state === 'bad' && <CircleAlert size={14} className="shrink-0 text-[var(--ro-red-text)]" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold">{d.title}</span>
                <span className="block truncate text-[12px] text-[var(--ro-muted)]">{d.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

type Where = { collection?: string | undefined; project?: string | undefined };

function IdsTab({ initial, where, onDone }: { initial: string; where: Where; onDone: (d: Done[]) => void }): React.JSX.Element {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const go = async (): Promise<void> => {
    if (text.trim() === '') return;
    setBusy(true);
    try {
      const r = await op<{ added: WorkRow[]; existing: { id: string; title: string; identifier: string }[]; not_identifiers: string[] }>('works.add', { ids: text, ...where }, { quiet: true });
      onDone([
        ...r.added.map((w) => ({ key: 'a' + w.id, id: w.id, title: w.resolution === 'resolved' ? w.title : w.title, detail: w.resolution === 'resolved' ? byline(w) : w.resolution === 'resolving' ? 'Filling in from the registry' : w.resolution === 'not_found' ? 'No record found for this identifier' : 'The registry did not answer; tried again later', state: (w.resolution === 'resolved' ? 'added' : w.resolution === 'resolving' ? 'reading' : 'bad') as Done['state'] })),
        ...r.existing.map((e) => ({ key: 'e' + e.id, id: e.id, title: e.title, detail: 'Already in your library', state: 'existing' as const })),
        ...r.not_identifiers.map((b) => ({ key: 'b' + b, title: b, detail: 'Not a DOI, arXiv ID, PubMed ID, ISBN or OpenAlex ID', state: 'bad' as const })),
      ]);
      setText('');
      changed('works');
    } catch (err) {
      const e = err as { message?: string; data?: { bad?: string[] } };
      onDone([{ key: 'x' + Date.now(), title: e.message ?? 'Not added', detail: (e.data?.bad ?? []).join(', '), state: 'bad' }]);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void go();
        }}
        rows={4}
        placeholder={'10.1038/nature14539\n1706.03762\npmid:26017442'}
        className={cn(textareaCls, 'mono')}
        aria-label="Identifiers"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] text-[var(--ro-muted)]">DOI, arXiv, PubMed, PMC, ISBN or OpenAlex, one or many</span>
        <Button variant="primary" icon={Fingerprint} loading={busy} disabled={text.trim() === ''} onClick={() => void go()}>
          Add
        </Button>
      </div>
    </div>
  );
}

function PdfTab({ where, onDone }: { where: Where; onDone: (d: Done[]) => void }): React.JSX.Element {
  const input = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const send = async (files: File[]): Promise<void> => {
    const pdfs = files.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    if (pdfs.length === 0) return;
    setBusy(true);
    try {
      for (let i = 0; i < pdfs.length; i += 10) {
        const r = await opForm<{ added: { work: WorkRow; file: { id: string; name: string } }[] }>('files.upload', { ...where }, { file: pdfs.slice(i, i + 10) });
        onDone(r.added.map((a) => ({ key: 'f' + a.file.id, id: a.work.id, title: a.file.name, detail: 'Reading its text, then your AI agent identifies it', state: 'reading' as const })));
      }
      changed('works', 'files');
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      data-own-drop="true"
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        void send(Array.from(e.dataTransfer.files));
      }}
      className={cn('flex flex-col items-center gap-2 rounded-[var(--ro-r-md)] border-2 border-dashed px-4 py-8 text-center transition-colors', over ? 'border-[var(--ro-accent)] bg-[var(--ro-accent-soft)]' : 'border-[var(--ro-line)] bg-[var(--ro-card)]')}
    >
      <FileUp size={24} className="text-[var(--ro-ink-2)]" />
      <span className="text-[13px] font-bold">Drop PDFs here</span>
      <Button icon={FileText} loading={busy} onClick={() => input.current?.click()}>
        Choose PDFs
      </Button>
      <input ref={input} type="file" accept="application/pdf,.pdf" multiple className="hidden" onChange={(e) => void send(Array.from(e.target.files ?? []))} />
    </div>
  );
}

function FindTab({ where, onDone }: { where: Where; onDone: (d: Done[]) => void }): React.JSX.Element {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<Candidate[] | null>(null);
  const [run, setRun] = useState<SearchRun | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const go = async (): Promise<void> => {
    if (q.trim() === '') return;
    setBusy(true);
    try {
      const r = await op<{ search: { id: string }; run: SearchRun }>('search.run', { query: q, sources: 'crossref,arxiv,openalex', rows: 8 });
      setRun(r.run);
      const c = await op<{ candidates: Candidate[] }>('candidates.list', { search: r.search.id, sort: 'rank', limit: 30 });
      setRows(c.candidates);
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  const add = async (c: Candidate): Promise<void> => {
    setAdding(c.id);
    try {
      await op('candidates.add', { candidates: [c.id], ...where });
      onDone([{ key: 'c' + c.id, title: c.title, detail: byline({ authors_short: c.authors_short, container: c.venue, year: c.year }), state: 'added' }]);
      setRows((rs) => (rs ?? []).map((x) => (x.id === c.id ? { ...x, triage: 'added', work: 'added' } : x)));
      changed('works');
    } catch {
      /* toasted */
    } finally {
      setAdding(null);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void go();
        }}
      >
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Title, authors or topic" className={inputCls} aria-label="Find papers" />
        <Button type="submit" variant="primary" icon={Search} loading={busy}>
          Find
        </Button>
      </form>
      {run !== null && (
        <p className="text-[12px] text-[var(--ro-muted)]">
          {run.queries.map((x) => `${x.source} ${x.error !== '' ? '(no answer)' : num(x.count)}`).join(' · ')}
        </p>
      )}
      {rows !== null && rows.length === 0 && <Empty compact icon={Search} title="Nothing found" />}
      {rows !== null && rows.length > 0 && (
        <ul className="max-h-80 overflow-y-auto rounded-[var(--ro-r)] border border-[var(--ro-line)] bg-[var(--ro-card)]">
          {rows.map((c) => (
            <li key={c.id} className="flex items-start gap-2 border-b border-[var(--ro-hair)] px-2.5 py-2 last:border-0">
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold leading-[18px]">{c.title}</span>
                <span className="block truncate text-[12px] text-[var(--ro-muted)]">{byline({ authors_short: c.authors_short, container: c.venue, year: c.year })}</span>
                <span className="mt-0.5 flex flex-wrap gap-1">
                  <Badge tone="neutral">{c.source}</Badge>
                  {c.cited_by > 0 && <Badge tone="neutral">{plural(c.cited_by, 'citation')}</Badge>}
                  {c.oa_url !== '' && <Badge tone="good">Open access</Badge>}
                </span>
              </span>
              {c.work !== '' ? (
                <Badge tone="neutral">In your library</Badge>
              ) : (
                <Button size="sm" loading={adding === c.id} onClick={() => void add(c)}>
                  Add
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface Preview {
  import: string;
  kind: string;
  filename: string;
  counts: { total: number; new_identified: number; new_manual: number; existing: number; problems: number; parse_errors: number };
  rows: { index: number; title: string; authors: string; year: number; outcome: 'existing' | 'new_identified' | 'new_manual'; problem: string }[];
}

function ImportTab({ where }: { where: Where }): React.JSX.Element {
  const input = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [pv, setPv] = useState<Preview | null>(null);
  const [result, setResult] = useState<{ import: string; created: number; existing: number } | null>(null);
  const read = async (f: File): Promise<void> => {
    setBusy(true);
    setResult(null);
    try {
      setPv(await opForm<Preview>('import.preview', { ...where }, { file: f }));
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  const run = async (): Promise<void> => {
    if (pv === null) return;
    setBusy(true);
    try {
      const r = await op<{ import: string; created: number; existing: number }>('import.run', { import: pv.import, ...where });
      setResult(r);
      setPv(null);
      changed('works');
      toast.success('Imported ' + plural(r.created, 'paper'));
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  const undo = async (): Promise<void> => {
    if (result === null) return;
    await op('import.undo', { import: result.import });
    setResult(null);
    changed('works');
    toast.success('Import undone');
  };
  if (result !== null) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <Check size={22} className="text-[var(--ro-green-text)]" />
        <p className="text-[13px] font-bold">Imported {plural(result.created, 'paper')}</p>
        {result.existing > 0 && <p className="text-[12px] text-[var(--ro-muted)]">{plural(result.existing, 'entry', 'entries')} were already in your library</p>}
        <Button icon={Undo2} onClick={() => void undo()}>
          Undo the import
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {pv === null ? (
        <div data-own-drop="true" onDragOver={(e) => e.preventDefault()} onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const f = e.dataTransfer.files[0];
          if (f) void read(f);
        }} className="flex flex-col items-center gap-2 rounded-[var(--ro-r-md)] border-2 border-dashed border-[var(--ro-line)] bg-[var(--ro-card)] px-4 py-8 text-center">
          <Import size={24} className="text-[var(--ro-ink-2)]" />
          <span className="text-[13px] font-bold">BibTeX, RIS or CSL-JSON</span>
          <span className="text-[12px] text-[var(--ro-muted)]">From Zotero, Mendeley, EndNote, JabRef or Paperpile</span>
          <Button icon={FileText} loading={busy} onClick={() => input.current?.click()}>
            Choose a file
          </Button>
          <input ref={input} type="file" accept=".bib,.ris,.json,.txt,.nbib" className="hidden" onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void read(f);
          }} />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Tile n={pv.counts.new_identified} label="New, with identifiers" sub="Filled in from registries" />
            <Tile n={pv.counts.new_manual} label="New, entered as written" sub="No identifier" />
            <Tile n={pv.counts.existing} label="Already in your library" sub="Skipped" />
          </div>
          <div className="max-h-52 overflow-y-auto rounded-[var(--ro-r)] border border-[var(--ro-line)] bg-[var(--ro-card)]">
            <table className="ro-table">
              <tbody>
                {pv.rows.slice(0, 200).map((r) => (
                  <tr key={r.index}>
                    <td className="max-w-0 w-full">
                      <span className="block truncate font-semibold">{r.title}</span>
                      <span className="block truncate text-[12px] text-[var(--ro-muted)]">{[r.authors, r.year > 0 ? r.year : ''].filter(Boolean).join(' · ')}</span>
                    </td>
                    <td className="whitespace-nowrap">{r.outcome === 'existing' ? <Badge tone="neutral">In library</Badge> : r.outcome === 'new_identified' ? <Badge tone="good">Identified</Badge> : <Badge tone="warn">As written</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setPv(null)}>Choose another file</Button>
            <Button variant="primary" icon={Import} loading={busy} onClick={() => void run()} disabled={pv.counts.new_identified + pv.counts.new_manual === 0}>
              Import {num(pv.counts.new_identified + pv.counts.new_manual)}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function Tile({ n, label, sub }: { n: number; label: string; sub: string }): React.JSX.Element {
  return (
    <div className="rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)] px-3 py-2">
      <div className="num text-[26px] font-bold leading-8">{num(n)}</div>
      <div className="text-[12px] font-semibold">{label}</div>
      <div className="text-[12px] text-[var(--ro-muted)]">{sub}</div>
    </div>
  );
}
