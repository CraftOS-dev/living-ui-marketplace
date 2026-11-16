/**
 * The deal page's Memo tab: the memo as one document. Typing in a section
 * saves by itself; your AI agent's drafts sit beside the text as tracked
 * changes (Sparkle) with Keep and Discard; citations are chips; Draft
 * sections asks your AI agent; Submit freezes the version with its hash.
 */
import { useEffect, useRef, useState } from 'react';
import { Check, Download, FileText, Lock, Pencil, Plus, Sparkle, Trash2, X } from 'lucide-react';
import { AgentTag, Button, ChipPicker, Dialog, Empty, IconButton, Input, LoadError, Skeleton, Tag, Textarea, Tip } from '../../components/ui.tsx';
import { CitedText, JobTrack, READS } from '../../components/committee/parts.tsx';
import type { Block, Memo, MemoSection, Scenarios } from '../../components/committee/types.ts';
import { download, op } from '../../lib/api.ts';
import { allowed, useMe } from '../../lib/auth.ts';
import { money, multiple, pct } from '../../lib/format.ts';
import { act, useOp } from '../../lib/live.ts';
import type { RecordLike } from '../../lib/contract.ts';
import { cn } from '../../../kit/index.ts';

const STATUS: Record<Memo['status'], { label: string; tone: 'neutral' | 'a' | 'good' }> = { draft: { label: 'Draft', tone: 'neutral' }, submitted: { label: 'Submitted', tone: 'a' }, final: { label: 'Final', tone: 'good' } };

/** One section's text: read as a document, typed in place, saved a moment after typing stops. */
function SectionText({ memo, section, editable }: { memo: Memo; section: MemoSection; editable: boolean }): React.JSX.Element {
  const block = section.block;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(block?.content ?? '');
  const pasted = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);
  useEffect(() => {
    if (!editing && !dirty.current) setText(block?.content ?? '');
  }, [block?.content, editing]);
  const save = (value: string): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const p = pasted.current;
      pasted.current = 0;
      dirty.current = false;
      void op('memos.block-save', { memo: memo.id, section: section.key, text: value, pasted: p });
    }, 700);
  };
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  if (editing && editable)
    return (
      <Textarea
        value={text}
        autoFocus
        minRows={3}
        maxRows={30}
        aria-label={section.label}
        data-unsaved={dirty.current ? 'true' : undefined}
        className="text-[14px] leading-6"
        onPaste={(e) => {
          pasted.current += e.clipboardData.getData('text').length;
        }}
        onChange={(e) => {
          dirty.current = true;
          setText(e.target.value);
          save(e.target.value);
        }}
        onBlur={() => setEditing(false)}
      />
    );
  if (text.trim() === '')
    return editable ? (
      <button type="button" aria-label={`Write ${section.label}`} title="Write" onClick={() => setEditing(true)} className="vo-focus flex min-h-9 w-full items-center rounded-[var(--vo-radius-sm)] border border-dashed border-[var(--vo-line)] px-3 text-[var(--vo-muted)] transition-colors duration-150 hover:bg-[var(--vo-hover)] hover:text-[var(--vo-ink)]">
        <Pencil size={13} aria-hidden />
      </button>
    ) : (
      <span className="text-[13px] text-[var(--vo-muted)]">Empty</span>
    );
  return (
    <div
      role={editable ? 'button' : undefined}
      tabIndex={editable ? 0 : undefined}
      onClick={(e) => {
        if (!editable || (e.target as HTMLElement).closest('a, button') !== null) return;
        setEditing(true);
      }}
      onKeyDown={(e) => {
        if (editable && e.key === 'Enter') setEditing(true);
      }}
      className={cn('-mx-2 rounded-[var(--vo-radius-sm)] px-2 py-1', editable && 'vo-focus cursor-pointer transition-colors duration-150 hover:bg-[var(--vo-hover)]')}
    >
      <CitedText text={text} citations={block?.citations ?? []} />
    </div>
  );
}

/** Your AI agent's draft of a section, as a tracked change: Keep or Discard. */
function Proposed({ memo, block, canDecide }: { memo: Memo; block: Block; canDecide: boolean }): React.JSX.Element {
  const [busy, setBusy] = useState('');
  const run = async (name: 'memos.keep' | 'memos.discard'): Promise<void> => {
    setBusy(name);
    await act([], () => op(name, { memo: memo.id, blocks: [block.id] }), READS);
    setBusy('');
  };
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-[var(--vo-radius-sm)] border-l-2 border-[var(--vo-agent)] bg-[var(--vo-agent-soft)] px-4 py-3">
      <div className="flex items-center gap-2">
        <AgentTag />
        {block.uncited > 0 && (
          <Tip text="Figures without a source">
            <Tag tone="warn">{block.uncited} uncited</Tag>
          </Tip>
        )}
        <span className="flex-1" />
        {canDecide && (
          <>
            <Button size="sm" variant="ghost" icon={X} busy={busy === 'memos.discard'} onClick={() => void run('memos.discard')}>
              Discard
            </Button>
            <Button size="sm" icon={Check} busy={busy === 'memos.keep'} onClick={() => void run('memos.keep')}>
              Keep
            </Button>
          </>
        )}
      </div>
      <CitedText text={block.content} citations={block.citations} className="underline decoration-[var(--vo-line-2)] decoration-dotted underline-offset-4" />
    </div>
  );
}

interface ScRow {
  label: string;
  probability: string;
  multiple: string;
}

function toRows(s: Scenarios | undefined): ScRow[] {
  return (s?.rows ?? []).map((r) => ({ label: r.label, probability: String(r.probability_ppm / 10000), multiple: r.multiple_e8 !== null ? String(r.multiple_e8 / 1e8) : '' }));
}

/** Outcome scenarios: probability and multiple per row; the expected multiple from the engine. */
function ScenariosEditor({ memo, section, editable }: { memo: Memo; section: MemoSection; editable: boolean }): React.JSX.Element {
  const sc = section.block?.scenarios ?? section.scenarios;
  const [rows, setRows] = useState<ScRow[]>(() => (toRows(sc).length > 0 ? toRows(sc) : editable ? [{ label: 'Bear', probability: '', multiple: '' }, { label: 'Base', probability: '', multiple: '' }, { label: 'Bull', probability: '', multiple: '' }] : []));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const push = (next: ScRow[]): void => {
    setRows(next);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const clean = next.filter((r) => r.label.trim() !== '' && r.probability.trim() !== '').map((r) => ({ label: r.label.trim(), probability: r.probability.trim(), multiple: r.multiple.trim() }));
      void op('memos.block-save', { memo: memo.id, section: section.key, scenarios: clean });
    }, 700);
  };
  const sum = sc?.sum_ppm ?? 0;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-col">
        {rows.map((r, i) => (
          <div key={i} className="flex min-h-10 min-w-0 items-center gap-2 border-b border-[var(--vo-hair)] py-1">
            {editable ? <Input className="min-w-0 flex-1" value={r.label} onChange={(e) => push(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} aria-label="Scenario" /> : <span className="min-w-0 flex-1 text-[13px]">{r.label}</span>}
            {editable ? (
              <Input className="vo-mono w-20 text-right" inputMode="decimal" value={r.probability} onChange={(e) => push(rows.map((x, j) => (j === i ? { ...x, probability: e.target.value } : x)))} aria-label="Probability" placeholder="%" />
            ) : (
              <span className="vo-mono vo-num w-20 text-right text-[13px]">{r.probability}%</span>
            )}
            {editable ? (
              <Input className="vo-mono w-20 text-right" inputMode="decimal" value={r.multiple} onChange={(e) => push(rows.map((x, j) => (j === i ? { ...x, multiple: e.target.value } : x)))} aria-label="Multiple" placeholder="x" />
            ) : (
              <span className="vo-mono vo-num w-20 text-right text-[13px]">{r.multiple !== '' ? `${r.multiple}x` : ''}</span>
            )}
            {editable && <IconButton icon={Trash2} label="Remove" size={28} onClick={() => push(rows.filter((_, j) => j !== i))} />}
          </div>
        ))}
      </div>
      <div className="flex min-w-0 flex-wrap items-end gap-x-10 gap-y-3">
        {editable && (
          <Button size="sm" variant="ghost" icon={Plus} onClick={() => push([...rows, { label: '', probability: '', multiple: '' }])}>
            Scenario
          </Button>
        )}
        <span className="flex-1" />
        <div className="flex flex-col items-end">
          <span className="text-[12px] text-[var(--vo-muted)]">Sum</span>
          <span className={cn('vo-mono vo-num text-[15px]', sum !== 1000000 && rows.length > 0 ? 'text-[var(--vo-warn)]' : '')}>{pct(sum, 0)}</span>
        </div>
        <div className="flex flex-col items-end">
          <Tip text="Probability times multiple, summed">
            <span className="text-[12px] text-[var(--vo-muted)]">Expected</span>
          </Tip>
          <span className="vo-mono vo-num text-[26px] font-light leading-8">{sc?.expected_multiple_e8 !== null && sc?.expected_multiple_e8 !== undefined ? multiple(sc.expected_multiple_e8) : <span className="font-sans text-[15px] text-[var(--vo-muted)]">Unknown</span>}</span>
        </div>
      </div>
    </div>
  );
}

function DraftDialog({ memo, open, onClose }: { memo: Memo; open: boolean; onClose: () => void }): React.JSX.Element {
  const options = memo.sections.filter((s) => !s.people_only && !s.removed);
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setChosen(options.filter((s) => s.block === null || s.block.content.trim() === '').map((s) => s.key));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = async (): Promise<void> => {
    setBusy(true);
    const out = await act([], () => op('memos.draft-sections', { memo: memo.id, sections: chosen }), READS);
    setBusy(false);
    if (out !== null) onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Draft sections"
      width={520}
      footer={
        <Button variant="primary" icon={Sparkle} busy={busy} disabled={chosen.length === 0} onClick={() => void go()}>
          Draft {chosen.length}
        </Button>
      }
    >
      <ChipPicker multiple label="Sections" options={options.map((s) => ({ value: s.key, label: s.label }))} value={chosen} onChange={setChosen} />
    </Dialog>
  );
}

/** The memo of one deal (the Memo tab). */
export function MemoTab({ deal }: { deal: RecordLike }): React.JSX.Element {
  const me = useMe();
  const dealRef = String((deal['number'] as string | undefined) ?? deal.id);
  const live = useOp<{ memo: Memo | null }>('memos.get', { deal: dealRef }, READS, { name: 'committee.memo' });
  const [drafting, setDrafting] = useState(false);
  const [busy, setBusy] = useState('');
  const canEdit = allowed(me, 'committee:edit|pipeline:edit');
  const run = async (key: string, fn: () => Promise<unknown>): Promise<void> => {
    setBusy(key);
    await act([], fn, READS);
    setBusy('');
  };
  if (live.loading) return <Skeleton className="h-64" />;
  if (live.data === null) return <LoadError message={live.error ?? 'Could not load the memo.'} onRetry={live.reload} />;
  if (live.data.memo === null) {
    return (
        <Empty
          icon={FileText}
          title="No memo yet"
          action={
            canEdit ? (
              <Button icon={Plus} busy={busy === 'open'} onClick={() => void run('open', () => op('memos.open', { deal: dealRef }))}>
                Open memo
              </Button>
            ) : undefined
          }
        />
      );
  }
  const memo = live.data.memo;
  const editable = canEdit && !memo.frozen;
  const job = memo.ask;
  const working = job !== null && job.open;
  const d = memo.disclosure;
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="vo-mono text-[13px]">
          {memo.number} v{memo.version}
        </span>
        <Tag tone={STATUS[memo.status].tone}>{STATUS[memo.status].label}</Tag>
        {memo.hash !== '' && (
          <Tip text={`Hash ${memo.hash}`}>
            <span className="vo-mono text-[12px] text-[var(--vo-muted)]">{memo.hash.slice(0, 8)}</span>
          </Tip>
        )}
        {d.chars > 0 && (
          <Tip text={d.text}>
            <span className="inline-flex items-center gap-1 text-[12px] text-[var(--vo-ink-2)]">
              <Sparkle size={12} aria-hidden />
              <span className="vo-mono vo-num">{d.agent}%</span>
            </span>
          </Tip>
        )}
        <span className="flex-1" />
        {editable && !working && (
          <Button size="sm" icon={Sparkle} onClick={() => setDrafting(true)}>
            Draft sections
          </Button>
        )}
        <IconButton icon={Download} label="Export Word" onClick={() => void download('memos.export', { memo: memo.id }, 'save', `memo-${memo.number}.docx`)} />
        {canEdit && memo.status === 'draft' && (
          <Button size="sm" busy={busy === 'submit'} disabled={memo.pending > 0} title={memo.pending > 0 ? 'Keep or discard the drafts first' : undefined} onClick={() => void run('submit', () => op('memos.submit', { memo: memo.id }))}>
            Submit
          </Button>
        )}
        {canEdit && memo.status !== 'draft' && (
          <Button size="sm" busy={busy === 'open'} onClick={() => void run('open', () => op('memos.open', { deal: dealRef }))}>
            New version
          </Button>
        )}
      </div>
      {working && job !== null && <JobTrack job={job} />}
      <article className="flex min-w-0 max-w-[780px] flex-col gap-7">
        {memo.sections.filter((s) => editable || s.proposed !== null || (s.block !== null && (s.block.content.trim() !== '' || (s.block.scenarios?.rows.length ?? 0) > 0))).map((s) => (
          <section key={s.key} className="flex min-w-0 flex-col gap-2">
            <h3 className="flex items-center gap-2 text-[15px] font-semibold leading-5">
              {s.label}
              {s.people_only && (
                <Tip text="Written by people only">
                  <Lock size={12} className="text-[var(--vo-muted)]" aria-label="People only" />
                </Tip>
              )}
              {s.block !== null && s.block.origin !== 'person' && <AgentTag />}
            </h3>
            {s.key === 'scenarios' ? <ScenariosEditor memo={memo} section={s} editable={editable} /> : s.proposed !== null && (s.block === null || s.block.content.trim() === '') ? null : <SectionText memo={memo} section={s} editable={editable} />}
            {s.proposed !== null && <Proposed memo={memo} block={s.proposed} canDecide={editable} />}
          </section>
        ))}
      </article>
      <DraftDialog memo={memo} open={drafting} onClose={() => setDrafting(false)} />
    </div>
  );
}
