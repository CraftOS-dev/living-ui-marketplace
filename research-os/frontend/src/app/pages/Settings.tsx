/**
 * Settings: what each highlight color means, the default citation style,
 * the email sent to the registries, how far your AI agent may go on its own
 * each day, the PDF text engine, and export of everything.
 */
import { useEffect, useState } from 'react';
import DemoReset from '../components/DemoReset.tsx';
import type { LucideIcon } from 'lucide-react';
import { Cpu, Download, FileDown, Highlighter, Mail, NotebookPen, Quote, Settings as SettingsIcon, Sparkles, Upload } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { download, op } from '../lib/api.ts';
import { notesZip, type NotesExport } from '../lib/notesZip.ts';
import { useApp } from '../lib/context.tsx';
import { changed } from '../lib/live.ts';
import { HUES } from '../lib/themeColors.ts';
import type { Slot } from '../lib/types.ts';
import { useAddPapers } from '../components/AddPapers.tsx';
import { Badge, Button, PageHeader, Segmented, Spinner, Toggle, inputCls } from '../components/ui.tsx';

const STYLES = [
  { value: 'apa', label: 'APA 7' },
  { value: 'chicago', label: 'Chicago' },
  { value: 'harvard', label: 'Harvard' },
  { value: 'mla', label: 'MLA' },
  { value: 'ieee', label: 'IEEE' },
  { value: 'vancouver', label: 'Vancouver' },
  { value: 'nature', label: 'Nature' },
];

function Card({ icon: Icon, title, sub, children }: { icon: LucideIcon; title: string; sub?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="grid grid-cols-1 gap-3 border-b border-[var(--ro-line)] py-5 last:border-0 @min-[900px]:grid-cols-[260px_minmax(0,1fr)]">
      <div className="flex items-start gap-2">
        <Icon size={15} className="mt-0.5 shrink-0 text-[var(--ro-muted)]" />
        <div>
          <h2 className="text-[13px] font-bold">{title}</h2>
          {sub !== undefined && <p className="mt-0.5 text-[12px] leading-4 text-[var(--ro-muted)]">{sub}</p>}
        </div>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export default function SettingsPage(): React.JSX.Element {
  const { settings } = useApp();
  const add = useAddPapers();
  const [slots, setSlots] = useState<Slot[]>([]);
  const [email, setEmail] = useState('');
  const [caps, setCaps] = useState({ node_cap: '300' });
  const [engine, setEngine] = useState<{ ok: boolean; node: string; pdfjs: string; error: string; waiting: number } | null>(null);
  const [testing, setTesting] = useState(false);
  useEffect(() => {
    if (settings === null) return;
    setSlots(settings.highlight_slots);
    setEmail(settings.contact_email);
    setCaps({ node_cap: String(settings.agent_policy.node_cap) });
  }, [settings]);
  if (settings === null)
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner size={20} />
      </div>
    );
  const save = async (patch: Record<string, unknown>, note = 'Saved'): Promise<void> => {
    try {
      await op('settings.update', patch);
      changed('settings');
      toast.success(note);
    } catch {
      /* toasted */
    }
  };
  const saveSlots = (next: Slot[]): void => {
    setSlots(next);
    void save({ highlight_slots: next.map((s) => ({ slot: s.slot, meaning: s.meaning, hue: s.hue })) });
  };
  const test = async (): Promise<void> => {
    setTesting(true);
    try {
      setEngine(await op('files.engine-test', {}));
    } catch {
      /* toasted */
    } finally {
      setTesting(false);
    }
  };
  const exportLib = async (format: 'bibtex' | 'ris' | 'csljson'): Promise<void> => {
    const r = await op<{ filename: string; content: string; mime: string; count: number }>('export.works', { format });
    download(r.filename, r.content, r.mime + ';charset=utf-8');
    toast.success(r.count + ' papers exported');
  };
  const exportNotes = async (): Promise<void> => {
    const r = await op<NotesExport>('export.notes', {});
    download('research-notes.zip', await notesZip(r), 'application/zip');
  };
  const p = settings.agent_policy;
  return (
    <div className="mx-auto flex w-full max-w-[980px] flex-col">
      <PageHeader icon={SettingsIcon} title="Settings" />
      <Card icon={Highlighter} title="Highlight colors" sub="What each color means. Keys 1 to 8 apply them in the reader; your AI agent reads the meanings too.">
        <ul className="flex flex-col gap-1.5">
          {slots.map((s, i) => (
            <li key={s.slot} className="flex flex-wrap items-center gap-2">
              <span className="num w-4 text-[12px] font-bold text-[var(--ro-muted)]">{s.slot}</span>
              <span className="flex gap-1" role="radiogroup" aria-label={'Color ' + s.slot}>
                {HUES.map((h) => (
                  <button key={h} type="button" role="radio" aria-checked={s.hue === h} aria-label={h} title={h} onClick={() => saveSlots(slots.map((x, j) => (j === i ? { ...x, hue: h } : x)))} className={cn('size-5 rounded-full transition-transform hover:scale-110', s.hue === h && 'ring-2 ring-[var(--ro-ink)] ring-offset-2 ring-offset-[var(--ro-shell)]')} style={{ background: `var(--ro-hl-${h})` }} />
                ))}
              </span>
              <input
                value={s.meaning}
                onChange={(e) => setSlots(slots.map((x, j) => (j === i ? { ...x, meaning: e.target.value } : x)))}
                onBlur={(e) => e.target.value !== settings.highlight_slots[i]?.meaning && saveSlots(slots)}
                aria-label={'Meaning of color ' + s.slot}
                className={cn(inputCls, 'h-7 max-w-[260px] flex-1')}
              />
              <span className="serif rounded-[2px] px-1 text-[13px]" style={{ background: `var(--ro-hl-${s.hue}-fill)` }}>
                sample passage
              </span>
            </li>
          ))}
        </ul>
      </Card>
      <Card icon={Quote} title="Citation style" sub="The default for new manuscripts and copied citations.">
        <Segmented label="Citation style" size="sm" value={settings.citation_style} onChange={(v) => void save({ citation_style: v })} options={STYLES} />
      </Card>
      <Card icon={Mail} title="Contact email for registries" sub="Crossref and OpenAlex answer faster when a request carries a contact address. It is sent only to them.">
        <div className="flex max-w-[420px] gap-2">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@university.edu" aria-label="Contact email" className={inputCls} />
          <Button onClick={() => void save({ contact_email: email.trim() })} disabled={email.trim() === settings.contact_email}>
            Save
          </Button>
        </div>
      </Card>
      <Card icon={Sparkles} title="Your AI agent" sub="What it does on its own and how much it may propose each day. Everything it judges still waits for you.">
        <div className="flex flex-col divide-y divide-[var(--ro-hair)] rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)]">
          {[
            { k: 'auto_identify', label: 'Identify new PDFs', sub: 'Find the DOI or arXiv ID of PDFs added without metadata', v: p.auto_identify },
            { k: 'auto_ocr', label: 'Read scanned pages', sub: 'Make the text of scanned PDFs selectable and quotable', v: p.auto_ocr },
            { k: 'auto_oa', label: 'Download open-access PDFs', sub: 'Fetch the free full text when a paper is added', v: p.auto_oa },
          ].map((x) => (
            <div key={x.k} className="flex items-center gap-3 px-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold">{x.label}</span>
                <span className="block text-[12px] text-[var(--ro-muted)]">{x.sub}</span>
              </span>
              <Toggle checked={x.v} onChange={(v) => void save({ [x.k]: v })} label={x.label} />
            </div>
          ))}
          {[
            { k: 'node_cap' as const, label: 'Claims, evidence and links a day' },
          ].map((x) => (
            <div key={x.k} className="flex items-center gap-3 px-3 py-2.5">
              <span className="min-w-0 flex-1 text-[13px] font-semibold">{x.label}</span>
              <input value={caps[x.k]} onChange={(e) => setCaps((c) => ({ ...c, [x.k]: e.target.value.replace(/\D/g, '') }))} onBlur={() => Number(caps[x.k]) !== p[x.k] && void save({ [x.k]: Number(caps[x.k]) || 0 })} inputMode="numeric" aria-label={x.label} className={cn(inputCls, 'num h-7 w-24 text-right')} />
            </div>
          ))}
        </div>
      </Card>
      <Card icon={Cpu} title="PDF text engine" sub="The app reads each PDF's text itself so every quote matches its page.">
        <div className="flex flex-wrap items-center gap-2">
          <Button icon={Cpu} loading={testing} onClick={() => void test()}>
            Check the engine
          </Button>
          {engine !== null &&
            (engine.ok ? (
              <Badge tone="good">
                Node {engine.node}, pdf.js {engine.pdfjs}
              </Badge>
            ) : (
              <Badge tone="bad">{engine.error}</Badge>
            ))}
          {engine !== null && engine.waiting > 0 && <span className="text-[12px] text-[var(--ro-muted)]">{engine.waiting} PDFs being read</span>}
        </div>
      </Card>
      <Card icon={FileDown} title="Export and import" sub="Your library is yours: take it to Zotero, EndNote or LaTeX at any time.">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Button icon={Download} onClick={() => void exportLib('bibtex')}>
              BibTeX
            </Button>
            <Button icon={Download} onClick={() => void exportLib('ris')}>
              RIS
            </Button>
            <Button icon={Download} onClick={() => void exportLib('csljson')}>
              CSL JSON
            </Button>
            <Button icon={NotebookPen} onClick={() => void exportNotes()}>
              Notes and boards (Markdown)
            </Button>
          </div>
          <div>
            <Button icon={Upload} onClick={() => add.open({ tab: 'import' })}>
              Import BibTeX, RIS or CSL JSON
            </Button>
          </div>
        </div>
      </Card>
      <DemoReset />
    </div>
  );
}
