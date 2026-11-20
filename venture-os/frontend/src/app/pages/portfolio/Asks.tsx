/**
 * Founder asks as tracked work: a board of Open, In progress and Done.
 * Drag a card to sort it in its column or move it to another (a shadow
 * shows where it lands; asks.reorder keeps the order for everyone); your AI
 * agent's asks arrive as proposals in Next and land here once accepted.
 * Add ask: a title and a kind chip.
 */
import { useState } from 'react';
import { HandHelping, Plus } from 'lucide-react';
import { AgentTag, Avatar, Board, Button, ChipPicker, Dialog, Empty, Field, Input, LoadError, Skeleton, Tag, Toggle } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { allowed, useMe } from '../../lib/auth.ts';
import { fmtDay, today } from '../../lib/format.ts';
import { act, insert, patch, reshape, tempId, useOp } from '../../lib/live.ts';
import type { Ask } from './types.ts';

const READS = ['asks'];
const KINDS = [
  { value: 'intro', label: 'Intro' },
  { value: 'hire', label: 'Hire' },
  { value: 'customer', label: 'Customer' },
  { value: 'fundraising', label: 'Fundraising' },
  { value: 'advice', label: 'Advice' },
  { value: 'other', label: 'Other' },
] as const;
type AskKind = (typeof KINDS)[number]['value'];

function AddAsk({ company, open, onClose }: { company: string; open: boolean; onClose: () => void }): React.JSX.Element | null {
  const me = useMe();
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<AskKind>('intro');
  const [mine, setMine] = useState(true);
  if (!open) return null;
  const save = (): void => {
    const t = title.trim();
    if (t === '') return;
    const temp: Partial<Ask> & { id: string } = { id: tempId(), title: t, kind, status: 'open', owner: mine ? { id: me.member.id, name: me.member.name } : null, actor: 'person', company: null, detail: '', outcome: '', due_day: '', quote: '', update: '' };
    onClose();
    setTitle('');
    void act([insert('asks', temp)], () => op('asks.save', { company, kind, title: t, owner: mine ? 'me' : '' }), READS);
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add ask"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={title.trim() === ''} onClick={save}>
            Add
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Ask">
          <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} aria-label="Ask" placeholder="Intro to retail data leaders" />
        </Field>
        <Field label="Kind">
          <ChipPicker label="Kind" options={[...KINDS]} value={kind} onChange={setKind} />
        </Field>
        <Toggle checked={mine} onChange={setMine} label="Mine" />
      </div>
    </Dialog>
  );
}

export function Asks({ company }: { company: string }): React.JSX.Element {
  const me = useMe();
  const edit = allowed(me, 'portfolio:edit');
  const [adding, setAdding] = useState(false);
  const live = useOp<{ asks: Ask[] }>('asks.list', { company, status: 'all' }, READS, { name: 'asks.board' });
  if (live.error !== null && live.data === null) return <LoadError message={live.error} onRetry={live.reload} />;
  if (live.data === null) return <Skeleton className="h-48 w-full" />;
  const asks = live.data.asks;
  const col = (s: Ask['status']): Ask[] => asks.filter((a) => a.status === s);
  // A drop: the ask at index `at` of column `to` (counted without it), in front of the ask now there.
  const move = (id: string, to: string, at: number): Promise<unknown> | undefined => {
    if (!edit) return undefined;
    const before = col(to as Ask['status']).filter((a) => a.id !== id)[at]?.id ?? '';
    const place = (data: unknown): unknown => {
      const d = data as { asks?: Ask[] } | null;
      if (d === null || !Array.isArray(d.asks)) return data;
      const card = d.asks.find((a) => a.id === id);
      if (card === undefined) return data;
      const rest = d.asks.filter((a) => a.id !== id);
      const moved: Ask = { ...card, status: to as Ask['status'] };
      let i = before !== '' ? rest.findIndex((a) => a.id === before) : -1;
      if (i < 0) {
        const last = rest.map((a) => a.status).lastIndexOf(to as Ask['status']);
        i = last < 0 ? rest.length : last + 1;
      }
      rest.splice(i, 0, moved);
      return { ...d, asks: rest };
    };
    return act([reshape('asks.board', place), patch(id, { status: to })], () => op('asks.reorder', { ask: id, status: to, before: before !== '' ? before : undefined }), READS);
  };
  return (
    <div className="flex flex-col gap-4">
      {asks.length === 0 ? (
        <Empty
          icon={HandHelping}
          title="Founder asks appear here"
          action={
            edit ? (
              <Button icon={Plus} onClick={() => setAdding(true)}>
                Add ask
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {edit && (
            <div className="flex justify-end">
              <Button icon={Plus} onClick={() => setAdding(true)}>
                Add ask
              </Button>
            </div>
          )}
          <Board
            label="Asks"
            columns={[
              { key: 'open', label: 'Open', items: col('open') },
              { key: 'in_progress', label: 'In progress', items: col('in_progress') },
              { key: 'done', label: 'Done', items: col('done') },
            ]}
            itemKey={(a) => a.id}
            cardLabel={(a) => a.title}
            onMove={edit ? move : undefined}
            renderCard={(a) => (
              <div className="flex min-w-0 flex-col gap-2">
                <span className="vo-wrap text-[13px] font-medium">{a.title}</span>
                <span className="flex min-w-0 items-center gap-1.5">
                  <Tag>{KINDS.find((k) => k.value === a.kind)?.label ?? a.kind}</Tag>
                  {a.actor === 'agent' && <AgentTag />}
                  {a.status !== 'done' && a.due_day !== '' && (
                    <span className={'truncate text-[12px] ' + (a.due_day < today() ? 'text-[var(--vo-bad)]' : 'text-[var(--vo-muted)]')} title={a.due_day < today() ? 'Past its due day' : 'Due day'}>
                      Due {fmtDay(a.due_day, { year: 'auto' })}
                    </span>
                  )}
                  <span className="flex-1" />
                  {a.owner !== null && (
                    <span title={'Owner: ' + a.owner.name}>
                      <Avatar name={a.owner.name} size={20} />
                    </span>
                  )}
                </span>
                {a.status === 'done' && a.outcome !== '' && <span className="vo-wrap text-[12px] text-[var(--vo-muted)]">{a.outcome}</span>}
              </div>
            )}
          />
        </>
      )}
      <AddAsk company={company} open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}
