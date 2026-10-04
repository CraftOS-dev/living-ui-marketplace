/**
 * Settings, Organization: name, vocabulary, currency, jurisdictions,
 * deadline defaults, review policy, sign-up role, digest, office sync and
 * reference prefixes. Admins edit; everyone else reads.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Save } from 'lucide-react';
import { Button, Input, Select, Switch, toast } from '../../kit/index.ts';
import { updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { CURRENCIES, JURISDICTIONS, ROLE_HELP, ROLE_LABEL, VOCAB, VOCAB_PACK_LABEL } from '../lib/labels.ts';
import type { SettingsRec, VocabPack } from '../lib/types.ts';
import { JurisdictionChips } from './pickers.tsx';
import { Field, Loading, Section, Segmented } from './ui.tsx';
import { NumberChips, ReadOnlyNote, SettingGroup, num } from './adminShared.tsx';

interface OrgDraft {
  org_name: string;
  vocab_pack: VocabPack;
  home_currency: string;
  jurisdictions: string[];
  target_buffer_days: number;
  reminder_days: number[];
  second_reviewer: boolean;
  renewal_default: SettingsRec['renewal_default'];
  default_signup_role: SettingsRec['default_signup_role'];
  digest_enabled: boolean;
  digest_hour: number;
  digest_channel: SettingsRec['digest_channel'];
  slack_channel: string;
  sync_enabled: boolean;
  sync_hour: number;
  ref_prefix_patent: string;
  ref_prefix_trademark: string;
  ref_prefix_design: string;
  ref_prefix_copyright: string;
  ref_prefix_agreement: string;
  ref_prefix_invention: string;
}

function draftOf(s: SettingsRec): OrgDraft {
  return {
    org_name: s.org_name,
    vocab_pack: s.vocab_pack || 'general',
    home_currency: (s.home_currency || 'USD').toUpperCase(),
    jurisdictions: s.jurisdictions ?? [],
    target_buffer_days: s.target_buffer_days,
    reminder_days: (s.reminder_days ?? []).slice().sort((a, b) => b - a),
    second_reviewer: s.second_reviewer,
    renewal_default: s.renewal_default || 'decide',
    default_signup_role: s.default_signup_role || 'contributor',
    digest_enabled: s.digest_enabled,
    digest_hour: s.digest_hour,
    digest_channel: s.digest_channel || 'in_app',
    slack_channel: s.slack_channel,
    sync_enabled: s.sync_enabled,
    sync_hour: s.sync_hour,
    ref_prefix_patent: s.ref_prefix_patent,
    ref_prefix_trademark: s.ref_prefix_trademark,
    ref_prefix_design: s.ref_prefix_design,
    ref_prefix_copyright: s.ref_prefix_copyright,
    ref_prefix_agreement: s.ref_prefix_agreement,
    ref_prefix_invention: s.ref_prefix_invention,
  };
}

const RENEWAL_HELP: Record<SettingsRec['renewal_default'], string> = {
  renew: 'New renewals start as Renew. They go ahead unless someone changes the decision.',
  lapse: 'New renewals start as Let lapse. Someone has to choose Renew to keep the right.',
  decide: 'New renewals wait in the decision queue until someone decides.',
};

const CHANNEL_LABEL: Record<SettingsRec['digest_channel'], string> = { in_app: 'In IP Manager', email: 'Email', slack: 'Slack' };

const HOURS = Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: `${String(h).padStart(2, '0')}:00` }));

const PREFIXES: { key: keyof OrgDraft & `ref_prefix_${string}`; label: string; fallback: string; example: (p: string) => string }[] = [
  { key: 'ref_prefix_patent', label: 'Patents and utility models', fallback: 'P', example: (p) => `${p}-0001-US` },
  { key: 'ref_prefix_trademark', label: 'Trademarks', fallback: 'TM', example: (p) => `${p}-0001-EM` },
  { key: 'ref_prefix_design', label: 'Designs', fallback: 'D', example: (p) => `${p}-0001-JP` },
  { key: 'ref_prefix_copyright', label: 'Copyrights', fallback: 'CR', example: (p) => `${p}-0001-US` },
  { key: 'ref_prefix_agreement', label: 'Agreements', fallback: 'AG', example: (p) => `${p}-0001` },
  { key: 'ref_prefix_invention', label: 'Inventions', fallback: 'INV', example: (p) => `${p}-0001` },
];

const ALL_JURISDICTIONS = Object.keys(JURISDICTIONS);

export function OrganizationTab(): React.JSX.Element {
  const { settings, can } = useApp();
  const [d, setD] = useState<OrgDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const ro = !can.admin;

  // Follow live changes to settings unless the admin is editing.
  const baseRef = useRef('');
  useEffect(() => {
    if (settings === null) return;
    const next = draftOf(settings);
    const prevKey = baseRef.current;
    baseRef.current = JSON.stringify(next);
    setD((cur) => (cur === null || JSON.stringify(cur) === prevKey ? next : cur));
  }, [settings]);

  const dirty = useMemo(() => settings !== null && d !== null && JSON.stringify(draftOf(settings)) !== JSON.stringify(d), [settings, d]);

  if (settings === null || d === null) return <Loading />;

  const set = <K extends keyof OrgDraft>(k: K, v: OrgDraft[K]): void => setD((x) => (x === null ? x : { ...x, [k]: v }));
  const vocab = VOCAB[d.vocab_pack];

  const save = async (): Promise<void> => {
    if (d.org_name.trim() === '') {
      toast.error('Enter the organization name.');
      return;
    }
    if (d.digest_channel === 'slack' && d.digest_enabled && d.slack_channel.trim() === '') {
      toast.error('Enter the Slack channel for the digest.');
      return;
    }
    setBusy(true);
    try {
      await updateRecord('settings', settings.id, {
        ...d,
        org_name: d.org_name.trim(),
        slack_channel: d.slack_channel.trim(),
        target_buffer_days: Math.max(0, Math.round(d.target_buffer_days)),
        ...Object.fromEntries(PREFIXES.map((p) => [p.key, d[p.key].trim().toUpperCase()])),
      });
      toast.success('Organization settings saved');
    } catch {
      /* the client already showed the server's message */
    } finally {
      setBusy(false);
    }
  };

  const orderedJur = [...d.jurisdictions.filter((c) => ALL_JURISDICTIONS.includes(c)), ...ALL_JURISDICTIONS.filter((c) => !d.jurisdictions.includes(c))];

  return (
    <div className="flex flex-col gap-4">
      {ro && <ReadOnlyNote>Only admins can change organization settings. You can see how IP Manager is set up.</ReadOnlyNote>}
      <Section
        title="Organization"
        actions={
          !ro ? (
            <Button size="sm" loading={busy} disabled={!dirty} onClick={() => void save()}>
              <Save size={13} aria-hidden /> Save changes
            </Button>
          ) : undefined
        }
      >
        <fieldset disabled={ro} className="min-w-0">
          <SettingGroup title="Identity" description="The name appears in the sidebar, digests and exports.">
            <Input label="Organization name" value={d.org_name} onChange={(e) => set('org_name', e.target.value)} />
            <div className="flex flex-col gap-1.5">
              <Select
                label="Vocabulary"
                value={d.vocab_pack}
                options={(Object.keys(VOCAB_PACK_LABEL) as VocabPack[]).map((k) => ({ value: k, label: VOCAB_PACK_LABEL[k] }))}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === 'general' || v === 'entertainment' || v === 'technology' || v === 'consumer') set('vocab_pack', v);
                }}
              />
              <p className="text-xs leading-relaxed text-[var(--agent-app-muted)]">
                The app says <strong className="font-semibold text-[var(--agent-app-text)]">{vocab.property}</strong> and{' '}
                <strong className="font-semibold text-[var(--agent-app-text)]">{vocab.properties}</strong> for groups of IP, and{' '}
                <strong className="font-semibold text-[var(--agent-app-text)]">{vocab.work}</strong> and{' '}
                <strong className="font-semibold text-[var(--agent-app-text)]">{vocab.works}</strong> for creative works. Only labels change, never data.
              </p>
            </div>
          </SettingGroup>

          <SettingGroup title="Money and places" description="Renewal costs and forecasts show in the home currency. Preferred offices appear first in every list.">
            <Select
              label="Home currency"
              value={d.home_currency}
              options={CURRENCIES.map((c) => ({ value: c, label: c }))}
              onChange={(e) => set('home_currency', e.target.value)}
            />
            <Field label="Where you file" help={`${d.jurisdictions.length} selected. Selected offices are listed first.`}>
              <div className="max-h-56 overflow-y-auto border border-[var(--agent-app-border)] p-2">
                <JurisdictionChips value={d.jurisdictions} onChange={(v) => (ro ? undefined : set('jurisdictions', v))} options={orderedJur} />
              </div>
            </Field>
          </SettingGroup>

          <SettingGroup title="Deadlines" description="How IP Manager sets targets and reminders for every computed deadline.">
            <Field label="Target buffer (days)" help="Target dates are set this many days before statutory due dates.">
              <Input
                aria-label="Target buffer in days"
                type="number"
                min={0}
                max={365}
                className="max-w-[8rem]"
                value={String(d.target_buffer_days)}
                onChange={(e) => set('target_buffer_days', num(e.target.value))}
              />
            </Field>
            <Field label="Reminders (days before the due date)" help="Assignees get a reminder at each of these points. Statutory deadlines that are overdue, or due within a week with nobody assigned, are escalated to managers.">
              <NumberChips value={d.reminder_days} onChange={(v) => set('reminder_days', v)} disabled={ro} suffix="d" />
            </Field>
          </SettingGroup>

          <SettingGroup title="Review and renewals">
            <Field label="Second reviewer" help="When on, statutory deadlines proposed by CraftBot need approval from two different people.">
              <Switch checked={d.second_reviewer} disabled={ro} onCheckedChange={(v) => set('second_reviewer', v)} label={d.second_reviewer ? 'On' : 'Off'} />
            </Field>
            <Field label="Renewal default" help={RENEWAL_HELP[d.renewal_default]}>
              <div>
                <Segmented<SettingsRec['renewal_default']>
                  ariaLabel="Renewal default"
                  value={d.renewal_default}
                  onChange={(v) => (ro ? undefined : set('renewal_default', v))}
                  options={[
                    { value: 'decide', label: 'Ask each time' },
                    { value: 'renew', label: 'Renew' },
                    { value: 'lapse', label: 'Let lapse' },
                  ]}
                />
              </div>
            </Field>
          </SettingGroup>

          <SettingGroup title="New sign-ups" description="The first account is the admin. Everyone who signs up later gets this role; change it per person in People and access.">
            <Field label="Default role" help={ROLE_HELP[d.default_signup_role]}>
              <Select
                aria-label="Default role for new sign-ups"
                value={d.default_signup_role}
                options={(['manager', 'counsel', 'contributor', 'viewer'] as const).map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === 'manager' || v === 'counsel' || v === 'contributor' || v === 'viewer') set('default_signup_role', v);
                }}
              />
            </Field>
          </SettingGroup>

          <SettingGroup title="Daily digest" description="A summary of overdue items, upcoming deadlines and open reviews, sent once a day to everyone except viewers.">
            <Switch checked={d.digest_enabled} disabled={ro} onCheckedChange={(v) => set('digest_enabled', v)} label={d.digest_enabled ? 'Send the daily digest' : 'Daily digest is off'} />
            {d.digest_enabled && (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Select label="Send at" value={String(d.digest_hour)} options={HOURS} onChange={(e) => set('digest_hour', Number(e.target.value))} />
                  <Field label="Channel" help="Email and Slack go through CraftBot's connected Gmail or Slack.">
                    <div>
                      <Segmented<SettingsRec['digest_channel']>
                        ariaLabel="Digest channel"
                        value={d.digest_channel}
                        onChange={(v) => (ro ? undefined : set('digest_channel', v))}
                        options={(['in_app', 'email', 'slack'] as const).map((c) => ({ value: c, label: CHANNEL_LABEL[c] }))}
                      />
                    </div>
                  </Field>
                </div>
                {d.digest_channel === 'slack' && (
                  <Field label="Slack channel" help="The team digest is posted here once a day.">
                    <Input aria-label="Slack channel" placeholder="#ip-deadlines" value={d.slack_channel} onChange={(e) => set('slack_channel', e.target.value)} />
                  </Field>
                )}
              </>
            )}
          </SettingGroup>

          <SettingGroup title="Office sync" description="Checks every connected office once a day for status changes and new events. Changes arrive in the Inbox for review; nothing is written directly.">
            <Switch checked={d.sync_enabled} disabled={ro} onCheckedChange={(v) => set('sync_enabled', v)} label={d.sync_enabled ? 'Sync every day' : 'Daily sync is off'} />
            {d.sync_enabled && (
              <div className="max-w-xs">
                <Select label="Run at" value={String(d.sync_hour)} options={HOURS} onChange={(e) => set('sync_hour', Number(e.target.value))} />
              </div>
            )}
          </SettingGroup>

          <SettingGroup title="Reference prefixes" description="New records are numbered PREFIX-NNNN, with the office code added for matters. Existing references never change.">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {PREFIXES.map((p) => {
                const val = d[p.key].trim().toUpperCase();
                return (
                  <Field key={p.key} label={p.label} help={`For example ${p.example(val !== '' ? val : p.fallback)}`}>
                    <Input
                      aria-label={`${p.label} prefix`}
                      className="font-mono uppercase"
                      maxLength={12}
                      placeholder={p.fallback}
                      value={d[p.key]}
                      onChange={(e) => set(p.key, e.target.value.replace(/[^A-Za-z0-9]/g, ''))}
                    />
                  </Field>
                );
              })}
            </div>
          </SettingGroup>
        </fieldset>
      </Section>
      {!ro && dirty && (
        <div className="sticky bottom-4 z-20 flex items-center justify-between gap-3 border border-[var(--agent-app-accent)]/40 bg-[var(--agent-app-surface)] px-4 py-2.5 shadow-lg">
          <span className="text-[13px]">You have unsaved changes.</span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setD(draftOf(settings))}>
              Discard
            </Button>
            <Button size="sm" loading={busy} onClick={() => void save()}>
              Save changes
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
