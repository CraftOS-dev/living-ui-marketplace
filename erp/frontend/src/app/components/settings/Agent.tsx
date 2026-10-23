/**
 * Your AI agent's autonomy: which kinds of postings it may make on its own
 * (each off by default), under what amount, and the routine work it may
 * start. Money never moves on its own: payments, payroll, claims and
 * transfers always wait for a person.
 */
import { useEffect, useState } from 'react';
import { Banknote, Check, ShieldCheck, Sparkles } from 'lucide-react';
import { toast } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { money } from '../../lib/format.ts';
import type { CompanySettings } from '../../lib/types/settings.ts';
import { MoneyInput } from '../pickers.tsx';
import { Card, CardHeader, Field, PillButton, ToggleRow } from '../ui.tsx';
import { moneyText } from './shared.tsx';

const KIND_WORDS: Record<string, { title: string; text: string }> = {
  invoice: { title: 'Invoices', text: 'Post invoices it drafted from orders and deliveries' },
  credit_note: { title: 'Credit notes', text: 'Post credit notes for returns it recorded' },
  bill: { title: 'Supplier bills', text: 'Post bills it read from the Inbox' },
  supplier_credit: { title: 'Supplier credits', text: 'Post credits it read from suppliers' },
  delivery: { title: 'Deliveries', text: 'Post deliveries, which takes the stock out' },
  goods_receipt: { title: 'Goods receipts', text: 'Post goods received, which brings the stock in' },
  journal: { title: 'Journal entries', text: 'Post manual entries such as accruals and corrections' },
  stock_change: { title: 'Stock changes', text: 'Post stock adjustments and counts' },
  build: { title: 'Builds', text: 'Complete builds in manufacturing' },
};

export function AgentSection({ s, onSaved }: { s: CompanySettings; onSaved: (s: CompanySettings) => void }): React.JSX.Element {
  const a = s.agent ?? { auto: {}, limit: 0, chase_overdue: false, auto_reorder: false, kinds: [] };
  const cur = s.base_currency;
  const [busy, setBusy] = useState<string | null>(null);
  const [limit, setLimit] = useState(moneyText(a.limit, cur, true));
  useEffect(() => setLimit(moneyText(a.limit, cur, true)), [a.limit, cur]);
  const limitDirty = limit !== moneyText(a.limit, cur, true);
  const anyAuto = a.kinds.some((k) => a.auto[k] === true);

  const save = async (key: string, params: Record<string, string | boolean | Record<string, boolean>>, done: string): Promise<void> => {
    setBusy(key);
    try {
      const next = await op<CompanySettings>('settings.agent', params);
      onSaved(next);
      toast.success(done);
    } catch {
      /* shown */
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <Card tone="dark" delay={1}>
        <div className="flex items-start gap-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--erp-dark-2)] text-[var(--erp-accent)]">
            <Banknote size={20} aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-[15px] font-bold">Money never moves on its own</p>
            <p className="mt-1 text-[13px] leading-5 text-[var(--erp-on-dark-muted)]">
              Payments, payroll, expense claims and bank transfers always wait for a person with the rights to do them. Your AI agent reads everything and drafts anything, but it never manages members, roles or lock dates.
            </p>
          </div>
        </div>
      </Card>

      <Card delay={2}>
        <CardHeader icon={ShieldCheck} title="May post on its own" subtitle={anyAuto ? 'These post without asking; everything else waits in Proposals.' : 'Nothing posts without asking: everything waits in Proposals.'} />
        <div className="grid grid-cols-1 gap-2 @min-[640px]:grid-cols-2">
          {a.kinds.map((k) => {
            const w = KIND_WORDS[k] ?? { title: k.replace(/_/g, ' '), text: '' };
            return (
              <ToggleRow
                key={k}
                title={w.title}
                text={w.text}
                checked={a.auto[k] === true}
                disabled={busy !== null}
                onChange={(v) => void save(k, { auto: { [k]: v } }, `${w.title} ${v ? 'post on their own now' : 'wait for approval now'}`)}
              />
            );
          })}
        </div>
        <div className="mt-5 grid grid-cols-1 items-end gap-3 @min-[640px]:grid-cols-[minmax(0,320px)_auto]">
          <Field label="Only up to this amount each" hint={a.limit > 0 ? `Larger ones wait for approval. Now ${money(a.limit, cur)}.` : 'Empty: no ceiling for the kinds switched on'}>
            <MoneyInput value={limit} onChange={setLimit} currency={cur} ariaLabel="Amount ceiling" placeholder="No ceiling" />
          </Field>
          {limitDirty && (
            <PillButton icon={Check} dot loading={busy === 'limit'} onClick={() => void save('limit', { limit: limit === '' ? '0' : limit }, 'Ceiling saved')}>
              Save ceiling
            </PillButton>
          )}
        </div>
      </Card>

      <Card delay={3}>
        <CardHeader icon={Sparkles} title="Routine work it may start" subtitle="It prepares drafts; a person still sends and posts them." />
        <div className="grid grid-cols-1 gap-2 @min-[640px]:grid-cols-2">
          <ToggleRow
            title="Chase overdue invoices"
            text="Draft reminders for customers who are late"
            checked={a.chase_overdue}
            disabled={busy !== null}
            onChange={(v) => void save('chase', { chase_overdue: v }, v ? 'It drafts reminders for overdue invoices now' : 'Reminders are off')}
          />
          <ToggleRow
            title="Reorder low stock"
            text="Draft purchase orders when items run low; it never sends them"
            checked={a.auto_reorder}
            disabled={busy !== null}
            onChange={(v) => void save('reorder', { auto_reorder: v }, v ? 'It drafts purchase orders for low stock now' : 'Reorder drafts are off')}
          />
        </div>
      </Card>
    </div>
  );
}
