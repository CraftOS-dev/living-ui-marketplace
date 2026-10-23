/**
 * A journal entry by hand, as a full screen: the day and what it is for,
 * then a grid of lines (account, debit or credit, memo; party, department
 * and project one tap away). The difference pill stays red until debits
 * equal credits. Posting shows the entry exactly as it will be booked.
 */
import { useEffect, useMemo, useState } from 'react';
import { Check, Plus, Scale, Trash2 } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { today } from '../../lib/dates.ts';
import { decimalsOf, money, normalizeNumber } from '../../lib/format.ts';
import { baseCurrency, useMe } from '../../lib/me.ts';
import { navigate } from '../../lib/router.ts';
import type { Journal } from '../../lib/types/books.ts';
import { ConfirmPosting } from '../Books.tsx';
import { ScreenBar } from '../FullScreen.tsx';
import { toMinor } from '../money/RecordPayment.tsx';
import { AccountPicker, DateField, MoneyInput, PartyPicker, Picker, ProjectPicker } from '../pickers.tsx';
import type { Option } from '../pickers.tsx';
import { Card, CircleButton, Field, PillButton, Toggle, cellInput, softInput } from '../ui.tsx';

interface Line {
  key: number;
  account: Option | null;
  debit: string;
  credit: string;
  memo: string;
  party: Option | null;
  department: Option | null;
  project: Option | null;
}

let seq = 0;
function blank(): Line {
  seq += 1;
  return { key: seq, account: null, debit: '', credit: '', memo: '', party: null, department: null, project: null };
}

export function JournalEditor({ onClose }: { onClose: () => void }): React.JSX.Element {
  const me = useMe();
  const cur = baseCurrency(me);
  const [date, setDate] = useState(today());
  const [memo, setMemo] = useState('');
  const [lines, setLines] = useState<Line[]>(() => [blank(), blank()]);
  const [dims, setDims] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const searchDepts = useMemo(
    () => async (q: string) => {
      const r = await op<{ departments: { id: string; name: string }[] }>('departments.list', {}, { quiet: true });
      return r.departments.filter((d) => q === '' || d.name.toLowerCase().includes(q.toLowerCase())).map((d) => ({ id: d.id, label: d.name, value: d.id }));
    },
    [],
  );

  const set = (key: number, patch: Partial<Line>): void => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const debits = lines.reduce((s, l) => s + (l.debit !== '' ? (toMinor(l.debit, cur) ?? 0) : 0), 0);
  const credits = lines.reduce((s, l) => s + (l.credit !== '' ? (toMinor(l.credit, cur) ?? 0) : 0), 0);
  const diff = debits - credits;
  const used = lines.filter((l) => l.account !== null || l.debit !== '' || l.credit !== '');
  const complete = used.length >= 2 && used.every((l) => l.account !== null && (l.debit !== '') !== (l.credit !== ''));
  const balanced = diff === 0 && debits > 0;

  // Keep one empty line at the bottom to type into.
  useEffect(() => {
    const lastLine = lines[lines.length - 1];
    if (lastLine !== undefined && (lastLine.account !== null || lastLine.debit !== '' || lastLine.credit !== '')) setLines((ls) => [...ls, blank()]);
  }, [lines]);

  const balanceOn = (key: number): void => {
    const others = lines.filter((l) => l.key !== key);
    const d = others.reduce((s, l) => s + (l.debit !== '' ? (toMinor(l.debit, cur) ?? 0) : 0), 0);
    const c = others.reduce((s, l) => s + (l.credit !== '' ? (toMinor(l.credit, cur) ?? 0) : 0), 0);
    const gap = d - c;
    if (gap === 0) return;
    const text = (Math.abs(gap) / 10 ** decimalsOf(cur)).toFixed(decimalsOf(cur));
    set(key, gap > 0 ? { credit: text, debit: '' } : { debit: text, credit: '' });
  };

  const payload = used
    .filter((l) => l.account !== null)
    .map((l) => ({
      account: l.account?.value ?? l.account?.id ?? '',
      debit: l.debit !== '' ? (normalizeNumber(l.debit, decimalsOf(cur)) ?? '') : undefined,
      credit: l.credit !== '' ? (normalizeNumber(l.credit, decimalsOf(cur)) ?? '') : undefined,
      memo: l.memo.trim() !== '' ? l.memo.trim() : undefined,
      party: l.party?.id,
      department: l.department?.id,
      project: l.project?.id,
    }));

  const cols = dims ? '@min-[640px]:grid-cols-[minmax(0,2fr)_130px_130px_minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_40px]' : '@min-[640px]:grid-cols-[minmax(0,2.2fr)_150px_150px_minmax(0,2fr)_40px]';

  return (
    <div className="pb-12">
      <ScreenBar title="New journal entry" sub="Move amounts between accounts by hand: debits must equal credits" onClose={onClose} />
      <div className="mx-auto w-full max-w-[1180px] px-4 @min-[640px]:px-8">
        <Card padded className="erp-d1">
          <div className="grid grid-cols-1 gap-4 @min-[480px]:grid-cols-[220px_minmax(0,1fr)]">
            <Field label="Date in the books">
              <DateField value={date} onChange={(d) => setDate(d === '' ? today() : d)} ariaLabel="Date" />
            </Field>
            <Field label="What it is for">
              <input value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={500} placeholder="October rent accrual, owner loan, correction..." aria-label="Memo" className={softInput} />
            </Field>
          </div>
        </Card>

        <Card className="erp-d2 mt-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-[15px] font-bold">Lines</h2>
            <label className="flex items-center gap-2 text-[13px] font-semibold text-[var(--erp-ink-2)]">
              Party, department and project
              <Toggle checked={dims} onChange={setDims} label="Show party, department and project" />
            </label>
          </div>
          <div className="relative overflow-x-auto">
            <div className={cn('flex flex-col gap-2', dims && '@min-[640px]:min-w-[1060px]')}>
              <div className={cn('hidden gap-2 px-1 text-[12px] font-semibold text-[var(--erp-muted)] @min-[640px]:grid', cols)}>
                <span>Account</span>
                <span className="text-right">Debit</span>
                <span className="text-right">Credit</span>
                <span>Memo</span>
                {dims && (
                  <>
                    <span>Party</span>
                    <span>Department</span>
                    <span>Project</span>
                  </>
                )}
                <span />
              </div>
              {lines.map((l, i) => {
                const last = i === lines.length - 1;
                const bothEmpty = l.debit === '' && l.credit === '';
                return (
                  <div key={l.key} className={cn('grid grid-cols-2 gap-2 rounded-[18px] bg-[var(--erp-row)] p-2 @min-[640px]:items-center @min-[640px]:rounded-[14px] @min-[640px]:bg-transparent @min-[640px]:p-0', cols)}>
                    <div className="col-span-2 @min-[640px]:col-span-1">
                      <AccountPicker value={l.account} onChange={(o) => set(l.key, { account: o })} postable size="cell" placeholder={last ? 'Add a line' : 'Choose an account'} />
                    </div>
                    <MoneyInput value={l.debit} onChange={(v) => set(l.key, { debit: v, credit: v !== '' ? '' : l.credit })} currency={cur} ariaLabel={`Debit line ${i + 1}`} size="cell" placeholder={bothEmpty && !last ? 'Debit' : ''} />
                    <MoneyInput value={l.credit} onChange={(v) => set(l.key, { credit: v, debit: v !== '' ? '' : l.debit })} currency={cur} ariaLabel={`Credit line ${i + 1}`} size="cell" placeholder={bothEmpty && !last ? 'Credit' : ''} />
                    <input value={l.memo} onChange={(e) => set(l.key, { memo: e.target.value })} maxLength={300} placeholder="Memo" aria-label={`Memo line ${i + 1}`} className={cn(cellInput, 'col-span-2 @min-[640px]:col-span-1')} />
                    {dims && (
                      <>
                        <div className="col-span-2 @min-[640px]:col-span-1">
                          <PartyPicker value={l.party} onChange={(o) => set(l.key, { party: o })} clearable placeholder="Party" />
                        </div>
                        <Picker value={l.department} onChange={(o) => set(l.key, { department: o })} search={searchDepts} placeholder="Department" ariaLabel="Department" size="cell" clearable />
                        <ProjectPicker value={l.project} onChange={(o) => set(l.key, { project: o })} size="cell" placeholder="Project" />
                      </>
                    )}
                    <div className="col-span-2 flex justify-end gap-1 @min-[640px]:col-span-1">
                      {!last && diff !== 0 && (l.debit === '' || l.credit === '') && (
                        <CircleButton icon={Scale} label="Put the difference here" variant="ghost" size={36} onClick={() => balanceOn(l.key)} />
                      )}
                      {!last && <CircleButton icon={Trash2} label="Remove line" variant="ghost" size={36} onClick={() => setLines((ls) => (ls.length > 2 ? ls.filter((x) => x.key !== l.key) : ls))} />}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-4 border-t border-[var(--erp-line)] pt-4 @min-[640px]:flex-row @min-[640px]:items-center @min-[640px]:justify-between">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <span className="text-[13px] text-[var(--erp-ink-2)]">
                Debits <b className="num ml-1 text-[15px] text-[var(--erp-ink)]">{money(debits, cur)}</b>
              </span>
              <span className="text-[13px] text-[var(--erp-ink-2)]">
                Credits <b className="num ml-1 text-[15px] text-[var(--erp-ink)]">{money(credits, cur)}</b>
              </span>
              <span
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-bold',
                  balanced ? 'bg-[var(--erp-green)]/15 text-[var(--erp-green-text)]' : 'bg-[var(--erp-red)]/15 text-[var(--erp-red-text)]',
                )}
                aria-live="polite"
              >
                {balanced ? <Check size={14} strokeWidth={3} aria-hidden /> : <Scale size={14} aria-hidden />}
                {balanced ? 'Balanced' : debits === 0 && credits === 0 ? 'Enter amounts' : `Off by ${money(Math.abs(diff), cur)}`}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <PillButton variant="soft" icon={Plus} onClick={() => setLines((ls) => [...ls, blank()])}>
                Add line
              </PillButton>
              <PillButton icon={Check} dot disabled={!complete || !balanced} onClick={() => setConfirming(true)}>
                Review and post
              </PillButton>
            </div>
          </div>
        </Card>
      </div>
      <ConfirmPosting
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Post the journal entry"
        verb="Post entry"
        previewOp="journals.preview"
        runOp="journals.post"
        params={{ date, memo: memo.trim() === '' ? undefined : memo.trim(), lines: payload }}
        onDone={(r) => {
          const j = r as Journal;
          toast.success(`${j.number} posted`);
          navigate('journal', { id: j.id });
        }}
      />
    </div>
  );
}
