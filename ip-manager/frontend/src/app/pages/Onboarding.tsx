/**
 * First-run setup for the administrator: organization, vocabulary pack,
 * home currency and the offices the organization files in.
 */
import { useState } from 'react';
import { Clapperboard, Cpu, Gem, Globe2, ShoppingBag } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button, Input, Select, cn, toast } from '../../kit/index.ts';
import { op } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { CURRENCIES, VOCAB, VOCAB_PACK_LABEL } from '../lib/labels.ts';
import type { VocabPack } from '../lib/types.ts';
import { JurisdictionChips } from '../components/pickers.tsx';
import { Field } from '../components/ui.tsx';

const PACKS: { key: VocabPack; icon: LucideIcon; blurb: string }[] = [
  { key: 'general', icon: Globe2, blurb: 'Patents, trademarks, designs, copyrights and licences for any organization.' },
  { key: 'entertainment', icon: Clapperboard, blurb: 'Franchises and titles, chain of title, clearances, media rights windows and merchandise licensing.' },
  { key: 'technology', icon: Cpu, blurb: 'Product lines, patent families, invention disclosures and technology licences by field of use.' },
  { key: 'consumer', icon: ShoppingBag, blurb: 'Brands, trademark coverage by class and country, packaging designs and co-branding deals.' },
];

const OFFICES = ['US', 'EP', 'EM', 'JP', 'WO', 'GB', 'CN', 'KR', 'CA', 'AU', 'IN', 'BR'];

export function Onboarding(): React.JSX.Element {
  const { me, refreshMeta } = useApp();
  const [name, setName] = useState('');
  const [pack, setPack] = useState<VocabPack>('general');
  const [currency, setCurrency] = useState('USD');
  const [jur, setJur] = useState<string[]>(['US', 'EP', 'EM', 'JP', 'WO']);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    if (name.trim() === '') {
      toast.error('Enter the organization name.');
      return;
    }
    setBusy(true);
    try {
      await op('onboarding', { org_name: name.trim(), vocab_pack: pack, home_currency: currency, jurisdictions: jur });
      toast.success('IP Manager is ready');
      refreshMeta();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen justify-center px-4 py-12">
      <div className="w-full max-w-2xl">
        <div className="mb-8 flex items-center gap-3">
          <span className="flex size-10 items-center justify-center bg-[var(--agent-app-accent)] text-white">
            <Gem size={20} aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Set up IP Manager</h1>
            <p className="text-sm text-[var(--agent-app-muted)]">
              {me?.name ? `${me.name}, you` : 'You'} created the first account, so you are the administrator. This takes a minute and can be changed later in Settings.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-7 border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] p-6">
          <Input label="Organization name" value={name} autoFocus placeholder="For example: Lantern Bay Studios" onChange={(e) => setName(e.target.value)} />

          <Field label="What kind of organization is this?" help="This only changes the words the app uses (for example Franchise and Title instead of Property and Work) and which rights dimensions are switched on.">
            <div className="grid gap-2 sm:grid-cols-2">
              {PACKS.map((p) => {
                const Icon = p.icon;
                const on = pack === p.key;
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => setPack(p.key)}
                    className={cn(
                      'flex items-start gap-3 border px-3 py-3 text-left transition-colors',
                      on ? 'border-[var(--agent-app-accent)] bg-[var(--agent-app-accent)]/5' : 'border-[var(--agent-app-border)] hover:bg-[var(--agent-app-border)]/20',
                    )}
                  >
                    <Icon size={18} className={on ? 'mt-0.5 text-[var(--agent-app-accent)]' : 'mt-0.5 text-[var(--agent-app-muted)]'} aria-hidden />
                    <span>
                      <span className="block text-[13px] font-semibold">{VOCAB_PACK_LABEL[p.key]}</span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-[var(--agent-app-muted)]">{p.blurb}</span>
                      <span className="mt-1 block text-[11px] text-[var(--agent-app-muted)]">
                        Uses “{VOCAB[p.key].properties}” and “{VOCAB[p.key].works}”
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Home currency"
              value={currency}
              options={CURRENCIES.map((c) => ({ value: c, label: c }))}
              onChange={(e) => setCurrency(e.target.value)}
            />
            <p className="self-end text-xs leading-relaxed text-[var(--agent-app-muted)]">
              Renewal costs and forecasts are shown in this currency, converted with daily European Central Bank rates. Any other currency can be entered by hand.
            </p>
          </div>

          <Field label="Where do you file?" help="These offices appear first in lists. Deadline rules cover the US, Europe (EPO and EUIPO), Japan, PCT and Madrid out of the box; add rules for other offices in Settings.">
            <JurisdictionChips value={jur} onChange={setJur} options={OFFICES} />
          </Field>

          <div className="border-t border-[var(--agent-app-border)] pt-5 text-xs leading-relaxed text-[var(--agent-app-muted)]">
            People who sign up after you join as Contributors (they can read the portfolio, upload documents and propose changes). Change their roles in Settings, People and access. Connect USPTO, EPO, EUIPO and JPO data in Settings, Office connections, when you have the credentials; everything also works by hand.
          </div>

          <div className="flex justify-end">
            <Button onClick={() => void submit()} loading={busy} disabled={name.trim() === ''}>
              Finish setup
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
