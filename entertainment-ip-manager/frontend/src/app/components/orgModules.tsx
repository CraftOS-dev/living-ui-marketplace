/**
 * Settings, Modules (admin): the business profiles and the per-module
 * switches, saved through settings/modules. Switching a module off hides
 * its pages and links; its records stay and come back when it is switched
 * on again.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Info, Save } from 'lucide-react';
import { Button, Switch, cn, toast } from '../../kit/index.ts';
import { errText, op } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { t } from '../lib/i18n.ts';
import { moduleLabel, profileLabel } from '../lib/labels.ts';
import { MODULE_KEYS } from '../lib/shapes.ts';
import type { ModuleKey, Profile } from '../lib/shapes.ts';
import { Checkbox, Loading, Notice, Section } from './ui.tsx';
import { PROFILE_MODULES } from './orgShared.tsx';

const PROFILES: Profile[] = ['anime', 'talent', 'character'];

interface Draft {
  profiles: Profile[];
  modules: Record<ModuleKey, boolean>;
}

function moduleHelp(m: ModuleKey): string {
  return {
    titles: t('Series, films, episodes and original works with their copyright terms.'),
    committees: t('Production committees, members, windows, distributions and consent requests.'),
    franchises: t('Franchise pages that group titles, characters and products.'),
    talents: t('Talents (VTubers, voice actors, singers), channels, lifecycle and playbooks.'),
    permissions: t('Game and music streaming permissions the company holds from others.'),
    guidelines: t('Fan, clip and cover guidelines, and fan permits and clip channels.'),
    music: t('Songs, recordings, releases, society registrations and Content ID.'),
    products: t('Licensed products and their stages.'),
    royalties: t('Royalty statements, payments and seals (証紙).'),
    approvals: t('Product approvals (監修) with reviewers, rounds and reply deadlines.'),
  }[m];
}

export function ModulesTab(): React.JSX.Element {
  const { settings } = useApp();
  const [d, setD] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const fromSettings = useMemo((): Draft | null => {
    if (settings === null) return null;
    const raw = settings.modules ?? {};
    const modules = {} as Record<ModuleKey, boolean>;
    for (const k of MODULE_KEYS) modules[k] = raw[k] === true;
    return { profiles: (settings.profiles ?? []).filter((p): p is Profile => PROFILES.includes(p)), modules };
  }, [settings]);

  const baseRef = useRef('');
  useEffect(() => {
    if (fromSettings === null) return;
    const prevKey = baseRef.current;
    baseRef.current = JSON.stringify(fromSettings);
    setD((cur) => (cur === null || JSON.stringify(cur) === prevKey ? fromSettings : cur));
  }, [fromSettings]);

  if (d === null || fromSettings === null) return <Loading />;
  const dirty = JSON.stringify(d) !== JSON.stringify(fromSettings);

  const toggleProfile = (p: Profile, on: boolean): void => {
    const profiles = on ? [...d.profiles, p] : d.profiles.filter((x) => x !== p);
    const modules = { ...d.modules };
    if (on) for (const m of PROFILE_MODULES[p]) modules[m] = true;
    else {
      const keep = new Set(profiles.flatMap((x) => PROFILE_MODULES[x]));
      for (const m of PROFILE_MODULES[p]) if (!keep.has(m)) modules[m] = false;
    }
    setD({ profiles, modules });
  };

  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await op('settings/modules', { modules: d.modules, profiles: d.profiles });
      toast.success(t('Modules saved'));
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  };

  const always = [t('Today'), t('Inbox'), t('Deadlines'), t('Characters'), t('Agreements'), t('Can we?'), t('Trademarks and designs'), t('Enforcement'), t('People and companies'), t('Reports'), t('Settings')];

  return (
    <div className="flex flex-col gap-4">
      <Notice tone="info" icon={Info}>
        {t('Switching a module off only hides its pages and links. Nothing is deleted: the records stay and appear again when the module is switched back on.')}
      </Notice>

      <Section
        title={t('What the company does')}
        actions={
          <Button size="sm" loading={busy} disabled={!dirty} onClick={() => void save()}>
            <Save size={13} aria-hidden /> {t('Save changes')}
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-[13px] leading-relaxed text-[var(--agent-app-muted)]">{t('Checking a kind of business switches on the modules it needs. Unchecking it switches off the modules no other checked kind needs.')}</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {PROFILES.map((p) => {
              const on = d.profiles.includes(p);
              return (
                <div key={p} className={cn('flex min-w-0 flex-col gap-2 border px-3 py-3', on ? 'border-[var(--agent-app-accent)] bg-[var(--agent-app-accent)]/5' : 'border-[var(--agent-app-border)]')}>
                  <Checkbox checked={on} onChange={(v) => toggleProfile(p, v)} label={<span className="font-semibold">{profileLabel(p)}</span>} />
                  <div className="flex flex-wrap gap-1">
                    {PROFILE_MODULES[p].map((m) => (
                      <span key={m} className="border border-[var(--agent-app-border)] px-1.5 text-[10.5px] leading-4 text-[var(--agent-app-text)]/75">
                        {moduleLabel(m)}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Section>

      <Section title={t('Modules')} meta={t('{n} on', { n: MODULE_KEYS.filter((k) => d.modules[k]).length })} flush>
        <div>
          {MODULE_KEYS.map((m) => (
            <div key={m} className="flex flex-wrap items-center gap-3 border-b border-[var(--agent-app-border)]/70 px-4 py-2.5 last:border-0">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium">{moduleLabel(m)}</div>
                <div className="text-xs leading-relaxed text-[var(--agent-app-muted)]">{moduleHelp(m)}</div>
              </div>
              <Switch checked={d.modules[m]} onCheckedChange={(v) => setD({ ...d, modules: { ...d.modules, [m]: v } })} label={d.modules[m] ? t('On') : t('Off')} />
            </div>
          ))}
        </div>
      </Section>

      <Section title={t('Always on')}>
        <p className="mb-2 text-[13px] leading-relaxed text-[var(--agent-app-muted)]">{t('These pages are part of every setup and cannot be switched off.')}</p>
        <div className="flex flex-wrap gap-1.5">
          {always.map((a) => (
            <span key={a} className="border border-[var(--agent-app-border)] px-2 py-0.5 text-xs">
              {a}
            </span>
          ))}
        </div>
      </Section>
    </div>
  );
}
