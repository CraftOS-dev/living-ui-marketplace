/**
 * Add deal: one drop (SPEC 2, U6). The sidebar's black button, the Inbox's
 * primary and Ctrl K open one dialog: a big drop zone and one field "Paste a
 * link or email"; More holds the company, who sent it, the scout and the
 * thesis. A dropped deck closes the dialog at once and the new item shows at
 * the top of the Inbox with its StepTrack (optimistic, then the real row).
 *
 * The dialog lives in a small React root of its own, so it opens over any
 * page without leaving it.
 */
import { useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { FileUp } from 'lucide-react';
import { Button, Dialog, Field, FileDrop, Input, More, Picker, Textarea } from '../ui.tsx';
import { ImportDialog } from '../ImportDialog.tsx';
import { op, opForm } from '../../lib/api.ts';
import { currentMe } from '../../lib/auth.ts';
import { act, reshape, tempId, useOp } from '../../lib/live.ts';
import { navigate } from '../../lib/router.ts';
import { toast } from '../../lib/toast.ts';
import { DECK_ACCEPT, INTAKE_READS, isDeck } from './types.ts';
import type { ListOut, Row, Scout } from './types.ts';

type Which = 'add' | 'import' | null;
let which: Which = null;
const subs = new Set<() => void>();
function set(v: Which): void {
  which = v;
  for (const fn of subs) fn();
}
function useWhich(): Which {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
    () => which,
  );
}

let mounted = false;
function mount(): void {
  if (mounted) return;
  mounted = true;
  const el = document.createElement('div');
  el.setAttribute('data-vo-intake-host', '');
  document.body.appendChild(el);
  createRoot(el).render(<Host />);
}

/** Open the Add deal dialog over the current page. */
export function openAddDeal(): void {
  mount();
  set('add');
}

/** Open the deal list import (CSV or XLSX, target intake). */
export function openImport(): void {
  mount();
  set('import');
}

function Host(): React.JSX.Element | null {
  const w = useWhich();
  return (
    <>
      {w === 'add' && <AddDealDialog onClose={() => set(null)} />}
      <ImportDialog open={w === 'import'} onClose={() => set(null)} target="intake" />
    </>
  );
}

const STEP_LABELS = ['Received', 'Reading', 'Facts', 'Ready'];

/** The row a dropped deck shows as until the server answers. */
function draftRow(name: string): Row {
  return {
    id: tempId(),
    number: '',
    name: name.replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' '),
    one_liner: '',
    channel: 'upload',
    status: 'new',
    step: 'received',
    steps: { labels: STEP_LABELS, at: 0 },
    triage_state: 'none',
    waiting_agent: false,
    source: { kind: 'upload', label: 'Upload', id: '' },
    company: null,
    fit: [],
    figures: [],
    due: { day: '', state: 'none', left: null },
    received_at: new Date().toISOString(),
    files: 1,
    hold_until: '',
    revisit_day: '',
    deal: null,
    pass: null,
  };
}

/**
 * Add deck files as one new deal: the row shows at once at the top of New,
 * the Inbox opens on it when the server answers. Answers the item's number
 * ('' when it failed).
 */
export async function addDeck(files: File[], extra: Record<string, unknown> = {}): Promise<string> {
  const decks = files.filter(isDeck);
  if (decks.length === 0) {
    toast.error('Drop a PDF, PowerPoint, Keynote or an image of the deck.');
    return '';
  }
  const row = draftRow(decks[0]?.name ?? 'Deck');
  navigate('/inbox');
  const out = await act(
    [reshape('inbox', (d) => {
      const v = d as ListOut;
      if (v === null || v.segment !== 'new') return d;
      return { ...v, items: [row, ...v.items] };
    })],
    () => opForm<{ id: string; number: string }>('intake.add', extra, { file: decks }),
    INTAKE_READS,
  );
  if (out === null) return '';
  navigate('/inbox', { item: out.number });
  return out.number;
}

function AddDealDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const me = currentMe();
  const scoutRole = me?.role?.own_items === true;
  const [text, setText] = useState('');
  const [company, setCompany] = useState('');
  const [from, setFrom] = useState('');
  const [scout, setScout] = useState('');
  const [thesis, setThesis] = useState('');
  const [busy, setBusy] = useState(false);
  const extra = (): Record<string, unknown> => {
    const p: Record<string, unknown> = {};
    if (company.trim() !== '') p['company'] = company.trim();
    if (from.trim() !== '') p['source_person'] = from.trim();
    if (scout !== '') p['scout'] = scout;
    if (thesis !== '') p['thesis'] = thesis;
    return p;
  };
  const drop = (files: File[]): void => {
    const p = extra();
    if (text.trim() !== '') p[/^\S+$/.test(text.trim()) ? 'url' : 'text'] = text.trim();
    onClose();
    void addDeck(files, p);
  };
  const ready = text.trim() !== '' || company.trim() !== '';
  const submit = async (): Promise<void> => {
    if (!ready) return;
    const p = extra();
    const t = text.trim();
    if (t !== '') p[/^\S+$/.test(t) && /[.]/.test(t) ? 'url' : 'text'] = t;
    setBusy(true);
    const out = await act([], () => op<{ id: string; number: string }>('intake.add', p), INTAKE_READS);
    setBusy(false);
    if (out === null) return;
    onClose();
    navigate('/inbox', { item: out.number });
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Add deal"
      width={520}
      footer={
        <Button variant="primary" busy={busy} disabled={!ready} onClick={() => void submit()}>
          Add
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <FileDrop onFiles={drop} accept={DECK_ACCEPT} label="Choose deck" multiple className="min-h-[168px]">
          <FileUp size={22} strokeWidth={1.6} aria-hidden className="text-[var(--vo-muted)]" />
        </FileDrop>
        <Textarea
          value={text}
          minRows={1}
          maxRows={8}
          placeholder="Paste a link or email"
          aria-label="Paste a link or email"
          autoFocus
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && /^\S*$/.test(text.trim())) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <More>
          <MoreFields scoutRole={scoutRole} company={company} setCompany={setCompany} from={from} setFrom={setFrom} scout={scout} setScout={setScout} thesis={thesis} setThesis={setThesis} />
        </More>
      </div>
    </Dialog>
  );
}

function MoreFields(p: { scoutRole: boolean; company: string; setCompany: (v: string) => void; from: string; setFrom: (v: string) => void; scout: string; setScout: (v: string) => void; thesis: string; setThesis: (v: string) => void }): React.JSX.Element {
  const scouts = useOp<{ scouts: Scout[] }>('scouts.list', { status: 'active' }, ['scouts'], { skip: p.scoutRole });
  const theses = useOp<{ theses: { id: string; name: string }[] }>('theses.list', {}, ['theses'], { skip: p.scoutRole });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Company">
        <Input value={p.company} onChange={(e) => p.setCompany(e.target.value)} placeholder="acme.com" aria-label="Company" />
      </Field>
      <Field label="From">
        <Input value={p.from} onChange={(e) => p.setFrom(e.target.value)} placeholder="name@company.com" aria-label="Who sent it" type="email" />
      </Field>
      {!p.scoutRole && (
        <>
          <Field label="Scout">
            <Picker value={p.scout} onChange={(v) => p.setScout(v)} items={(scouts.data?.scouts ?? []).map((s) => ({ value: s.id, label: s.name, sub: s.email }))} label="Scout" clearable />
          </Field>
          <Field label="Thesis">
            <Picker value={p.thesis} onChange={(v) => p.setThesis(v)} items={(theses.data?.theses ?? []).map((t) => ({ value: t.id, label: t.name }))} label="Thesis" clearable />
          </Field>
        </>
      )}
    </div>
  );
}
