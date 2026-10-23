/**
 * The filter builder: typed conditions on papers (works.list --filter).
 * Every field has its own operators and value control; conditions combine
 * with all or any.
 */
import { Plus, Trash2 } from 'lucide-react';
import { useApp } from '../../lib/context.tsx';
import { TYPE_LABEL } from '../../lib/format.ts';
import { Button, IconButton, Segmented, Select, inputCls } from '../ui.tsx';

export interface Cond {
  field: string;
  op: string;
  value: string | number | boolean;
}

type Kind = 'text' | 'number' | 'enum' | 'exists' | 'flag' | 'date';

const FIELDS: { key: string; label: string; kind: Kind; values?: { value: string; label: string }[] }[] = [
  { key: 'title', label: 'Title', kind: 'text' },
  { key: 'author', label: 'Author', kind: 'text' },
  { key: 'abstract', label: 'Abstract', kind: 'text' },
  { key: 'venue', label: 'Journal or venue', kind: 'text' },
  { key: 'publisher', label: 'Publisher', kind: 'text' },
  { key: 'year', label: 'Year', kind: 'number' },
  { key: 'cited_by', label: 'Times cited', kind: 'number' },
  { key: 'type', label: 'Kind of work', kind: 'enum', values: Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label })) },
  { key: 'read_state', label: 'Read state', kind: 'enum', values: [{ value: 'unread', label: 'Unread' }, { value: 'reading', label: 'Reading' }, { value: 'read', label: 'Read' }] },
  { key: 'integrity', label: 'Integrity', kind: 'enum', values: [{ value: 'clear', label: 'Clear' }, { value: 'retracted', label: 'Retracted' }, { value: 'corrected', label: 'Corrected' }, { value: 'concern', label: 'Concern' }, { value: 'unchecked', label: 'Not checked' }] },
  { key: 'resolution', label: 'Identifier', kind: 'enum', values: [{ value: 'resolved', label: 'Resolved' }, { value: 'manual', label: 'Entered by hand' }, { value: 'pending', label: 'To identify' }, { value: 'not_found', label: 'Not found' }, { value: 'unreachable', label: 'Registry offline' }] },
  { key: 'added_by', label: 'Added by', kind: 'enum', values: [{ value: 'person', label: 'You' }, { value: 'agent', label: 'Your AI agent' }, { value: 'system', label: 'The app' }] },
  { key: 'tag', label: 'Tag', kind: 'exists' },
  { key: 'collection', label: 'Collection', kind: 'exists' },
  { key: 'project', label: 'Project', kind: 'exists' },
  { key: 'highlight_color', label: 'Highlight color', kind: 'exists' },
  { key: 'has_pdf', label: 'Has a PDF', kind: 'flag' },
  { key: 'has_highlights', label: 'Has highlights', kind: 'flag' },
  { key: 'has_notes', label: 'Has notes', kind: 'flag' },
  { key: 'has_proposed', label: 'Has proposed evidence', kind: 'flag' },
  { key: 'starred', label: 'Starred', kind: 'flag' },
  { key: 'added_after', label: 'Added on or after', kind: 'date' },
  { key: 'added_before', label: 'Added before', kind: 'date' },
];

const OPS: Record<Kind, { value: string; label: string }[]> = {
  text: [
    { value: 'contains', label: 'contains' },
    { value: 'not_contains', label: 'does not contain' },
  ],
  number: [
    { value: 'gte', label: 'at least' },
    { value: 'lte', label: 'at most' },
    { value: 'is', label: 'is' },
  ],
  enum: [
    { value: 'is', label: 'is' },
    { value: 'is_not', label: 'is not' },
  ],
  exists: [
    { value: 'is', label: 'is' },
    { value: 'is_not', label: 'is not' },
  ],
  flag: [{ value: 'is', label: 'is' }],
  date: [{ value: 'is', label: '' }],
};

function fieldOf(key: string): (typeof FIELDS)[number] {
  return FIELDS.find((f) => f.key === key) ?? (FIELDS[0] as (typeof FIELDS)[number]);
}

function fresh(key: string): Cond {
  const f = fieldOf(key);
  if (f.kind === 'flag') return { field: key, op: 'is', value: true };
  if (f.kind === 'number') return { field: key, op: 'gte', value: key === 'year' ? new Date().getFullYear() - 5 : 10 };
  if (f.kind === 'date') return { field: key, op: 'is', value: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10) };
  if (f.kind === 'enum') return { field: key, op: 'is', value: f.values?.[0]?.value ?? '' };
  return { field: key, op: OPS[f.kind][0]?.value ?? 'is', value: '' };
}

export function FilterBuilder({ conds, match, onChange }: { conds: Cond[]; match: 'all' | 'any'; onChange: (conds: Cond[], match: 'all' | 'any') => void }): React.JSX.Element {
  const { tags, collections, projects, settings } = useApp();
  const set = (i: number, c: Cond): void => onChange(conds.map((x, j) => (j === i ? c : x)), match);
  const valuesFor = (key: string): { value: string; label: string }[] => {
    if (key === 'tag') return tags.map((t) => ({ value: t.id, label: t.name }));
    if (key === 'collection') return collections.map((c) => ({ value: c.id, label: c.name }));
    if (key === 'project') return projects.map((p) => ({ value: p.id, label: p.name }));
    if (key === 'highlight_color') return (settings?.highlight_slots ?? []).map((s) => ({ value: String(s.slot), label: s.meaning !== '' ? s.meaning : s.hue }));
    return fieldOf(key).values ?? [];
  };
  return (
    <div className="flex w-[min(92vw,520px)] flex-col gap-2 p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-bold">Papers where</span>
        {conds.length > 1 && <Segmented size="sm" label="Match" value={match} onChange={(m) => onChange(conds, m)} options={[{ value: 'all', label: 'all match' }, { value: 'any', label: 'any matches' }]} />}
      </div>
      {conds.length === 0 && <p className="text-[12px] text-[var(--ro-muted)]">No conditions yet.</p>}
      {conds.map((c, i) => {
        const f = fieldOf(c.field);
        const vals = valuesFor(c.field);
        return (
          <div key={i} className="flex items-center gap-1.5">
            <Select ariaLabel="Field" className="w-40" value={c.field} onChange={(k) => set(i, fresh(k))} options={FIELDS.map((x) => ({ value: x.key, label: x.label }))} />
            {f.kind !== 'date' && f.kind !== 'flag' && <Select ariaLabel="Operator" className="w-32" value={c.op} onChange={(o) => set(i, { ...c, op: o })} options={OPS[f.kind]} />}
            {f.kind === 'text' && <input value={String(c.value)} onChange={(e) => set(i, { ...c, value: e.target.value })} className={inputCls} aria-label="Value" placeholder="words" />}
            {f.kind === 'number' && <input type="number" value={Number(c.value)} onChange={(e) => set(i, { ...c, value: Number(e.target.value) })} className={inputCls} aria-label="Value" />}
            {f.kind === 'date' && <input type="date" value={String(c.value)} onChange={(e) => set(i, { ...c, value: e.target.value })} className={inputCls} aria-label="Date" />}
            {f.kind === 'flag' && <Select ariaLabel="Value" className="flex-1" value={c.value === true ? 'true' : 'false'} onChange={(v) => set(i, { ...c, value: v === 'true' })} options={[{ value: 'true', label: 'yes' }, { value: 'false', label: 'no' }]} />}
            {(f.kind === 'enum' || f.kind === 'exists') && <Select ariaLabel="Value" className="flex-1" value={String(c.value)} onChange={(v) => set(i, { ...c, value: v })} options={vals.length > 0 ? vals : [{ value: '', label: 'None yet' }]} />}
            <IconButton icon={Trash2} label="Remove condition" variant="danger" onClick={() => onChange(conds.filter((_, j) => j !== i), match)} />
          </div>
        );
      })}
      <div className="flex items-center justify-between gap-2 pt-1">
        <Button size="sm" icon={Plus} onClick={() => onChange([...conds, fresh('year')], match)}>
          Add condition
        </Button>
        {conds.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => onChange([], 'all')}>
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}

/** Conditions that can be sent (text conditions need words). */
export function usable(conds: Cond[]): Cond[] {
  return conds.filter((c) => !(fieldOf(c.field).kind === 'text' && String(c.value).trim() === '') && !(fieldOf(c.field).kind === 'exists' && String(c.value) === ''));
}
