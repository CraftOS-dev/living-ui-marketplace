/** Currency, and what an AI agent can do with this app. */
import { useEffect, useState } from 'react';
import { FileUp, MessageSquare, Repeat, ScanLine, Shapes, Sparkles } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { toast } from '../../kit/index.ts';
import { Card, CardHeader, PageHeader, PillButton, PillSelect, useConfirm } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { CURRENCIES, currencyName, decimalsOf } from '../lib/money.ts';

const ASK: { icon: LucideIcon; say: string; does: string }[] = [
  { icon: MessageSquare, say: 'I spent 12.50 on lunch', does: 'Records the expense' },
  { icon: ScanLine, say: 'A photo or PDF of a receipt', does: 'Reads the total, date and shop, keeps the file' },
  { icon: FileUp, say: 'A CSV from your bank or card', does: 'Imports it, skipping money in and anything already here' },
  { icon: Sparkles, say: 'How much did I spend on food this month?', does: 'Answers from your data' },
  { icon: Shapes, say: 'Sort my uncategorized expenses', does: 'Puts them in your categories' },
  { icon: Repeat, say: 'Add Netflix, 15.49 every month', does: 'Sets up a recurring expense' },
];

export function SettingsPage(): React.JSX.Element {
  const { settings } = useApp();
  const [code, setCode] = useState(settings?.currency ?? 'USD');
  const [busy, setBusy] = useState(false);
  const [confirmEl, confirm] = useConfirm();
  useEffect(() => {
    if (settings !== null) setCode(settings.currency);
  }, [settings]);
  const current = settings?.currency ?? 'USD';
  const options = (CURRENCIES.includes(current) ? CURRENCIES : [current, ...CURRENCIES]).map((c) => ({ value: c, label: `${c} · ${currencyName(c)}` }));

  const save = async (): Promise<void> => {
    if (code === current) return;
    const decimalsChange = decimalsOf(code) !== decimalsOf(current);
    const ok = await confirm(
      `Your amounts keep their numbers and show in ${code} from now on; nothing is converted.${decimalsChange ? ` ${code} uses ${decimalsOf(code)} decimals, so amounts are rounded to fit.` : ''}`,
      `Switch to ${code}?`,
      'Switch',
    );
    if (!ok) return;
    setBusy(true);
    try {
      await api.updateSettings({ currency: code });
      toast.success(`Currency is now ${code}`);
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader title="Settings" />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <Card className="lg:col-span-5" delay={1}>
          <CardHeader title="Currency" subtitle="The currency every amount is kept in" />
          <div className="flex flex-col gap-3">
            <PillSelect soft ariaLabel="Currency" value={code} onChange={setCode} options={options} />
            <PillButton variant="dark" disabled={code === current} loading={busy} onClick={() => void save()}>
              Use {code}
            </PillButton>
            <p className="px-1 text-[12px] text-[var(--et-muted)]">Spent abroad? When adding an expense, turn on "Paid in another currency". It is converted at that day's rate.</p>
          </div>
        </Card>
        <Card tone="dark" className="lg:col-span-7" delay={2}>
          <CardHeader title="Let your AI agent do it" dark subtitle="Say it in chat or send it a file. It works in this app for you." />
          <ul className="flex flex-col gap-2">
            {ASK.map((a) => {
              const Icon = a.icon;
              return (
                <li key={a.say} className="flex items-center gap-3 rounded-[18px] bg-[var(--et-dark-2)] px-3 py-2.5">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--et-accent)] text-[var(--et-on-accent)]">
                    <Icon size={16} aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[14px] font-bold">{a.say}</span>
                    <span className="block text-[12px] text-[var(--et-on-dark-muted)]">{a.does}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
      {confirmEl}
    </div>
  );
}
