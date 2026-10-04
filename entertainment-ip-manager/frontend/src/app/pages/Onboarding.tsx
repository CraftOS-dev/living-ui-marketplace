/**
 * First-run setup for the administrator (the first account): organization
 * name, what the company does (business profiles switch modules on), home
 * currency, the organization's default language and the trademark offices
 * of interest. Submitting runs the onboarding op; settings.onboarding_done
 * flips and the app opens by itself (settings are live).
 */
import { useState } from 'react';
import { Check, Clapperboard, Mic2, Sparkles } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button, Input, Select, cn, toast } from '../../kit/index.ts';
import { op, errText } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { t } from '../lib/i18n.ts';
import { CURRENCIES, OFFICES, moduleLabel, profileLabel } from '../lib/labels.ts';
import type { Lang, Profile } from '../lib/shapes.ts';
import { LanguageSwitch } from '../components/shell.tsx';
import { JurisdictionChips } from '../components/pickers.tsx';
import { Field, Segmented } from '../components/ui.tsx';
import { PROFILE_MODULES } from '../components/orgShared.tsx';

const PROFILE_ICON: Record<Profile, LucideIcon> = { anime: Clapperboard, talent: Mic2, character: Sparkles };

function profileBlurb(p: Profile): string {
  return {
    anime: t('Titles, production committees and their windows, music, licensed products and royalties.'),
    talent: t('Talents and their channels, third-party game and music permissions, fan guidelines, merchandise.'),
    character: t('Character brands and virtual idols, fan guidelines, licensed products, approvals and royalties.'),
  }[p];
}

export function Onboarding(): React.JSX.Element {
  const { me } = useApp();
  const [name, setName] = useState('');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [currency, setCurrency] = useState('JPY');
  const [language, setLanguage] = useState<Lang>('ja');
  const [offices, setOffices] = useState<string[]>([...OFFICES]);
  const [busy, setBusy] = useState(false);

  const toggle = (p: Profile): void => setProfiles((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  const ready = name.trim() !== '' && profiles.length > 0;

  const submit = async (): Promise<void> => {
    if (name.trim() === '') {
      toast.error(t('Enter the organization name.'));
      return;
    }
    if (profiles.length === 0) {
      toast.error(t('Choose at least one kind of business.'));
      return;
    }
    setBusy(true);
    try {
      await op('onboarding', { org_name: name.trim(), profiles, home_currency: currency, default_language: language, jurisdictions: offices });
      toast.success(t('Your organization is set up.'));
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen justify-center px-4 py-8 sm:py-12">
      <div className="w-full min-w-0 max-w-2xl">
        <div className="mb-6 flex justify-end">
          <LanguageSwitch />
        </div>
        <div className="mb-6 flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center bg-[var(--agent-app-accent)] text-[var(--agent-app-accent-contrast)]">
            <Sparkles size={20} aria-hidden />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">{t('Set up Entertainment IP Manager')}</h1>
            <p className="mt-1 text-sm leading-relaxed text-[var(--agent-app-muted)]">
              {me?.name
                ? t('{name}, you created the first account, so you are the administrator. This takes a minute and everything can be changed later in Settings.', { name: me.name })
                : t('You created the first account, so you are the administrator. This takes a minute and everything can be changed later in Settings.')}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-7 border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] p-4 sm:p-6">
          <Input label={t('Organization name')} value={name} autoFocus placeholder={t('For example: Sakura Pictures Co., Ltd.')} onChange={(e) => setName(e.target.value)} />

          <Field label={t('What does your company do?')} help={t('Choose every kind that applies. Each one switches on the pages it needs; you can switch pages on or off later in Settings, Modules.')}>
            <div className="grid gap-2 sm:grid-cols-3">
              {(['anime', 'talent', 'character'] as Profile[]).map((p) => {
                const Icon = PROFILE_ICON[p];
                const on = profiles.includes(p);
                return (
                  <button
                    key={p}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => toggle(p)}
                    className={cn(
                      'flex min-w-0 flex-col gap-2 border px-3 py-3 text-left transition-colors',
                      on ? 'border-[var(--agent-app-accent)] bg-[var(--agent-app-accent)]/5' : 'border-[var(--agent-app-border)] hover:bg-[var(--agent-app-border)]/20',
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <Icon size={18} className={on ? 'text-[var(--agent-app-accent)]' : 'text-[var(--agent-app-muted)]'} aria-hidden />
                      <span
                        aria-hidden
                        className={cn(
                          'flex size-4 items-center justify-center border',
                          on ? 'border-[var(--agent-app-accent)] bg-[var(--agent-app-accent)] text-[var(--agent-app-accent-contrast)]' : 'border-[var(--agent-app-border)]',
                        )}
                      >
                        {on && <Check size={11} />}
                      </span>
                    </span>
                    <span className="text-[13px] font-semibold">{profileLabel(p)}</span>
                    <span className="text-xs leading-relaxed text-[var(--agent-app-muted)]">{profileBlurb(p)}</span>
                    <span className="flex flex-wrap gap-1">
                      {PROFILE_MODULES[p].map((m) => (
                        <span key={m} className="border border-[var(--agent-app-border)] px-1.5 text-[10.5px] leading-4 text-[var(--agent-app-text)]/75">
                          {moduleLabel(m)}
                        </span>
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('Home currency')} help={t('Royalties, fees and forecasts are shown in this currency. Any other currency can still be entered.')}>
              <Select aria-label={t('Home currency')} value={currency} options={CURRENCIES.map((c) => ({ value: c, label: c }))} onChange={(e) => setCurrency(e.target.value)} />
            </Field>
            <Field label={t('Default language')} help={t('New accounts start in this language. Each person can change their own language later.')}>
              <div>
                <Segmented<Lang>
                  ariaLabel={t('Default language')}
                  value={language}
                  onChange={setLanguage}
                  options={[
                    { value: 'ja', label: '日本語' },
                    { value: 'en', label: 'English' },
                  ]}
                />
              </div>
            </Field>
          </div>

          <Field label={t('Trademark offices of interest')} help={t('These offices come first in lists and in the trademark coverage view. Deadline rules for all seven ship with the app.')}>
            <JurisdictionChips value={offices} onChange={setOffices} options={OFFICES} />
          </Field>

          <div className="border-t border-[var(--agent-app-border)] pt-5 text-xs leading-relaxed text-[var(--agent-app-muted)]">
            {t('People who sign up after you join as Contributors. Change their roles, or invite licensees, committee members and outside reviewers, in Settings, People and roles. Office data connections (JPO, USPTO, EUIPO) are optional; everything also works by hand.')}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3">
            {!ready && <span className="text-xs text-[var(--agent-app-muted)]">{t('Enter a name and choose at least one kind of business.')}</span>}
            <Button onClick={() => void submit()} loading={busy} disabled={!ready}>
              {t('Finish setup')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
