/**
 * Settings, Diligence: the checklists (dd_templates). Pick one; its areas
 * and questions are editable rows (text, an answer type as an icon, a unit
 * for numbers). Save sends the whole checklist (dd.template-save). People
 * without settings edit or diligence full see it read-only.
 */
import { useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Archive, Calendar, Hash, ListChecks, Plus, ToggleLeft, Trash2, Type } from 'lucide-react';
import { op } from '../../lib/api.ts';
import { allowed, useMe } from '../../lib/auth.ts';
import { act, useOp } from '../../lib/live.ts';
import { Button, Empty, IconButton, Input, LoadError, Menu, MenuItem, Segmented, Skeleton, SubHeader, confirmAsk } from '../ui.tsx';
import type { QType, Template } from './types.ts';

const QUIET = 'border-transparent bg-transparent shadow-none hover:border-[var(--vo-line)] focus:border-[var(--vo-line-2)] focus:bg-[var(--vo-raised)]';

type TQ = { key: string; area: string; text: string; type: QType; unit: string };
type TA = { key: string; label: string };

const TYPES: { value: QType; label: string; icon: LucideIcon }[] = [
  { value: 'text', label: 'Text', icon: Type },
  { value: 'number', label: 'Number', icon: Hash },
  { value: 'yes_no', label: 'Yes or no', icon: ToggleLeft },
  { value: 'date', label: 'Date', icon: Calendar },
];

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

export function TemplatesSettings(): React.JSX.Element {
  const me = useMe();
  const edit = allowed(me, 'settings:edit|diligence:full');
  const live = useOp<{ templates: Template[] }>('dd.templates', { full: true }, ['dd_templates'], { name: 'dd.templates.full' });
  const list = live.data?.templates ?? [];
  const [pick, setPick] = useState('');
  const cur = list.find((t) => t.key === pick) ?? list[0];
  const [areas, setAreas] = useState<TA[]>([]);
  const [qs, setQs] = useState<TQ[]>([]);
  const [name, setName] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    if (cur === undefined || dirty) return;
    setAreas(cur.areas);
    setQs((cur.questions ?? []).map((q) => ({ ...q, unit: q.unit ?? '' })));
    setName(cur.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur?.key, cur?.count, cur?.name, live.data]);

  const touch = (): void => setDirty(true);
  const save = async (): Promise<void> => {
    if (cur === undefined) return;
    setBusy('save');
    const out = await act([], () => op('dd.template-save', { template: cur.key, name: name.trim() || cur.name, areas, questions: qs.filter((q) => q.text.trim() !== '').map((q) => ({ key: q.key, area: q.area, text: q.text.trim(), type: q.type, unit: q.type === 'number' ? q.unit : '' })) }), ['dd_templates']);
    setBusy('');
    if (out !== null) setDirty(false);
  };
  const create = async (): Promise<void> => {
    setBusy('new');
    const out = await act([], () => op<{ template: Template }>('dd.template-save', { name: 'New checklist', areas: [{ key: 'team', label: 'Team' }], questions: [] }), ['dd_templates']);
    setBusy('');
    if (out !== null) {
      setDirty(false);
      setPick(out.template.key);
    }
  };
  const archive = async (): Promise<void> => {
    if (cur === undefined || !(await confirmAsk(`Archive ${cur.name}?`, 'Archive'))) return;
    await act([], () => op('dd.template-save', { template: cur.key, archived: true }), ['dd_templates']);
    setPick('');
  };

  return (
    <>
      <SubHeader title="Diligence">
        {edit && (
          <Button icon={Plus} busy={busy === 'new'} onClick={() => void create()}>
            New checklist
          </Button>
        )}
        {edit && dirty && (
          <Button variant="primary" busy={busy === 'save'} onClick={() => void save()}>
            Save
          </Button>
        )}
      </SubHeader>
      {live.data === null ? (
        live.error !== null ? (
          <LoadError message={live.error} onRetry={live.reload} />
        ) : (
          <Skeleton className="h-40 w-full" />
        )
      ) : cur === undefined ? (
        <div className="vo-panel">
          <Empty icon={ListChecks} title="No checklists" />
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Segmented label="Checklist" value={cur.key} onChange={(k) => (setDirty(false), setPick(k))} options={list.map((t) => ({ value: t.key, label: t.name, count: t.count }))} />
            <span className="flex-1" />
            {edit && (
              <Menu label="More">
                {(close) => (
                  <MenuItem icon={Archive} onClick={() => (close(), void archive())}>
                    Archive
                  </MenuItem>
                )}
              </Menu>
            )}
          </div>
          {edit && <Input aria-label="Checklist name" value={name} onChange={(e) => (setName(e.target.value), touch())} className={`max-w-[320px] text-[14px] font-medium ${QUIET}`} />}
          {areas.map((a, ai) => (
            <section key={a.key} className="vo-panel vo-in min-w-0" aria-label={a.label}>
              <header className="flex h-11 items-center gap-2 border-b border-[var(--vo-hair)] px-4">
                {edit ? (
                  <Input aria-label="Area" value={a.label} onChange={(e) => (setAreas(areas.map((x, i) => (i === ai ? { ...x, label: e.target.value } : x))), touch())} className={`h-7 max-w-[220px] text-[12px] font-semibold ${QUIET}`} />
                ) : (
                  <span className="vo-label flex-1">{a.label}</span>
                )}
                <span className="flex-1" />
                <span className="vo-mono vo-num text-[12px] text-[var(--vo-muted)]">{qs.filter((q) => q.area === a.key).length}</span>
                {edit && qs.every((q) => q.area !== a.key) && <IconButton icon={Trash2} label="Remove area" size={28} tone="danger" onClick={() => (setAreas(areas.filter((_, i) => i !== ai)), touch())} />}
              </header>
              <ul className="min-w-0 py-1">
                {qs.map((q, qi) =>
                  q.area !== a.key ? null : (
                    <li key={q.key + qi} className="group flex min-h-9 min-w-0 items-center gap-2 px-4 py-1 transition-colors duration-150 hover:bg-[var(--vo-hover)]">
                      <TypePick value={q.type} edit={edit} onChange={(t) => (setQs(qs.map((x, i) => (i === qi ? { ...x, type: t, unit: t === 'number' ? x.unit : '' } : x))), touch())} />
                      {edit ? (
                        <Input aria-label="Question" value={q.text} onChange={(e) => (setQs(qs.map((x, i) => (i === qi ? { ...x, text: e.target.value } : x))), touch())} className={`h-7 min-w-0 flex-1 ${QUIET}`} />
                      ) : (
                        <span className="vo-wrap min-w-0 flex-1 text-[13px]">{q.text}</span>
                      )}
                      {q.type === 'number' &&
                        (edit ? (
                          <Input aria-label="Unit" value={q.unit} placeholder="Unit" onChange={(e) => (setQs(qs.map((x, i) => (i === qi ? { ...x, unit: e.target.value } : x))), touch())} className={`vo-mono h-7 w-24 shrink-0 ${QUIET}`} />
                        ) : (
                          <span className="vo-mono shrink-0 text-[12px] text-[var(--vo-muted)]">{q.unit}</span>
                        ))}
                      {edit && (
                        <span className="opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
                          <IconButton icon={Trash2} label="Remove" size={28} onRow tone="danger" onClick={() => (setQs(qs.filter((_, i) => i !== qi)), touch())} />
                        </span>
                      )}
                    </li>
                  ),
                )}
              </ul>
              {edit && (
                <div className="px-3 pb-2">
                  <IconButton icon={Plus} label="Add question" size={28} onClick={() => (setQs([...qs, { key: '', area: a.key, text: '', type: 'text', unit: '' }]), touch())} />
                </div>
              )}
            </section>
          ))}
          {edit && (
            <div>
              <Button
                size="sm"
                variant="ghost"
                icon={Plus}
                onClick={() => {
                  let k = 'area';
                  let n = areas.length + 1;
                  while (areas.some((x) => x.key === k + '_' + n)) n++;
                  k = slug('area ' + n);
                  setAreas([...areas, { key: k, label: 'Area ' + n }]);
                  touch();
                }}
              >
                Area
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

/** The answer type as an icon; a menu changes it. */
function TypePick({ value, edit, onChange }: { value: QType; edit: boolean; onChange: (t: QType) => void }): React.JSX.Element {
  const t = TYPES.find((x) => x.value === value) ?? TYPES[0];
  const Icon = t?.icon ?? Type;
  if (!edit)
    return (
      <span title={t?.label} className="flex size-7 shrink-0 items-center justify-center text-[var(--vo-muted)]">
        <Icon size={14} strokeWidth={1.8} aria-label={t?.label} />
      </span>
    );
  return (
    <Menu label={t?.label ?? 'Type'} icon={Icon} width={180} onRow>
      {(close) =>
        TYPES.map((x) => (
          <MenuItem key={x.value} icon={x.icon} selected={x.value === value} onClick={() => (close(), onChange(x.value))}>
            {x.label}
          </MenuItem>
        ))
      }
    </Menu>
  );
}
