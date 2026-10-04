/**
 * Settings, Organization: name, language, currency, work calendar, offices
 * of interest, deadline defaults, digest, review policy, sign-up role,
 * licensing defaults (approval SLA, leak lag, stage templates) and
 * reference prefixes. Admins edit (settings are admin-only on the server);
 * other internal roles read.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from 'lucide-react';
import { Button, Input, Select, Switch, toast } from '../../kit/index.ts';
import { updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { enumLabel, enumOptions, t } from '../lib/i18n.ts';
import { CURRENCIES, OFFICES, jurisdictionName, roleHelp } from '../lib/labels.ts';
import type { SettingsRec } from '../lib/records.ts';
import type { Lang, Role, StageTemplate } from '../lib/shapes.ts';
import { JurisdictionChips } from './pickers.tsx';
import { Checkbox, Field, Loading, Section, Segmented } from './ui.tsx';
import { NumberChips, ReadOnlyNote, SettingGroup, hourOptions, num } from './orgShared.tsx';

type Channel = 'in_app' | 'email' | 'slack';
type RenewalDefault = 'renew' | 'lapse' | 'decide';
type SignupRole = 'manager' | 'rights' | 'licensing' | 'talent_manager' | 'contributor' | 'viewer';
type ReviewerKind = 'internal' | 'committee' | 'original' | 'talent' | 'reviewer';

const REVIEWER_KINDS: ReviewerKind[] = ['internal', 'committee', 'original', 'talent', 'reviewer'];
const SIGNUP_ROLES: SignupRole[] = ['manager', 'rights', 'licensing', 'talent_manager', 'contributor', 'viewer'];

interface StageRow {
  key: string;
  label: string;
  label_ja: string;
  sla_days: number;
  reviewers: ReviewerKind[];
}

interface OrgDraft {
  org_name: string;
  default_language: Lang;
  home_currency: string;
  work_calendar: string;
  jurisdictions: string[];
  target_buffer_days: number;
  reminder_days: number[];
  digest_enabled: boolean;
  digest_hour: number;
  digest_channel: Channel;
  slack_channel: string;
  second_reviewer: boolean;
  renewal_default: RenewalDefault;
  default_signup_role: SignupRole;
  leak_lag_days: number;
  approval_sla_days: number;
  approval_stages: StageRow[];
  ref_prefix_trademark: string;
  ref_prefix_design: string;
  ref_prefix_agreement: string;
  ref_prefix_product: string;
  ref_prefix_case: string;
  ref_prefix_permit: string;
}

type PrefixKey = 'ref_prefix_trademark' | 'ref_prefix_design' | 'ref_prefix_agreement' | 'ref_prefix_product' | 'ref_prefix_case' | 'ref_prefix_permit';

function stageRows(list: StageTemplate[] | null): StageRow[] {
  return (list ?? []).map((s) => ({
    key: s.key,
    label: s.label,
    label_ja: s.label_ja ?? '',
    sla_days: s.sla_days ?? 0,
    reviewers: (s.reviewers ?? []).filter((r): r is ReviewerKind => REVIEWER_KINDS.includes(r)),
  }));
}

function draftOf(s: SettingsRec): OrgDraft {
  return {
    org_name: s.org_name,
    default_language: s.default_language === 'en' ? 'en' : 'ja',
    home_currency: (s.home_currency || 'JPY').toUpperCase(),
    work_calendar: (s.work_calendar || 'JP').toUpperCase(),
    jurisdictions: s.jurisdictions ?? [],
    target_buffer_days: s.target_buffer_days,
    reminder_days: (s.reminder_days ?? []).slice().sort((a, b) => b - a),
    digest_enabled: s.digest_enabled,
    digest_hour: s.digest_hour,
    digest_channel: s.digest_channel || 'in_app',
    slack_channel: s.slack_channel,
    second_reviewer: s.second_reviewer,
    renewal_default: s.renewal_default || 'decide',
    default_signup_role: s.default_signup_role || 'contributor',
    leak_lag_days: s.leak_lag_days,
    approval_sla_days: s.approval_sla_days,
    approval_stages: stageRows(s.approval_stages),
    ref_prefix_trademark: s.ref_prefix_trademark,
    ref_prefix_design: s.ref_prefix_design,
    ref_prefix_agreement: s.ref_prefix_agreement,
    ref_prefix_product: s.ref_prefix_product,
    ref_prefix_case: s.ref_prefix_case,
    ref_prefix_permit: s.ref_prefix_permit,
  };
}

function reviewerKindLabel(k: ReviewerKind): string {
  return {
    internal: t('Our team'),
    committee: t('Committee'),
    original: t('Original author'),
    talent: t('Talent'),
    reviewer: t('Outside reviewer'),
  }[k];
}

function renewalHelp(v: RenewalDefault): string {
  return {
    renew: t('New renewals start as Renew. They go ahead unless someone changes the decision.'),
    lapse: t('New renewals start as Let lapse. Someone has to choose Renew to keep the right.'),
    decide: t('New renewals wait in the decision queue until someone decides.'),
  }[v];
}

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

  const prefixes: { key: PrefixKey; label: string; fallback: string; example: (p: string) => string }[] = [
    { key: 'ref_prefix_trademark', label: t('Trademarks'), fallback: 'TM', example: (p) => `${p}-0001-JP` },
    { key: 'ref_prefix_design', label: t('Designs'), fallback: 'D', example: (p) => `${p}-0001-JP` },
    { key: 'ref_prefix_agreement', label: t('Agreements'), fallback: 'AG', example: (p) => `${p}-0001` },
    { key: 'ref_prefix_product', label: t('Products'), fallback: 'PR', example: (p) => `${p}-0001` },
    { key: 'ref_prefix_case', label: t('Enforcement cases'), fallback: 'EC', example: (p) => `${p}-0001` },
    { key: 'ref_prefix_permit', label: t('Fan permits'), fallback: 'FP', example: (p) => `${p}-0001` },
  ];

  const save = async (): Promise<void> => {
    if (d.org_name.trim() === '') {
      toast.error(t('Enter the organization name.'));
      return;
    }
    if (d.digest_channel === 'slack' && d.digest_enabled && d.slack_channel.trim() === '') {
      toast.error(t('Enter the Slack channel for the digest.'));
      return;
    }
    const keys = d.approval_stages.map((s) => s.key);
    if (keys.some((k) => k === '') || new Set(keys).size !== keys.length) {
      toast.error(t('Each approval stage needs its own stage type.'));
      return;
    }
    if (d.approval_stages.some((s) => s.label.trim() === '')) {
      toast.error(t('Give every approval stage a name.'));
      return;
    }
    setBusy(true);
    try {
      const stages: StageTemplate[] = d.approval_stages.map((s) => ({
        key: s.key,
        label: s.label.trim(),
        label_ja: s.label_ja.trim(),
        sla_days: Math.max(0, Math.round(s.sla_days)),
        reviewers: s.reviewers,
      }));
      await updateRecord('settings', settings.id, {
        org_name: d.org_name.trim(),
        default_language: d.default_language,
        home_currency: d.home_currency,
        work_calendar: d.work_calendar,
        jurisdictions: d.jurisdictions,
        target_buffer_days: Math.max(0, Math.round(d.target_buffer_days)),
        reminder_days: d.reminder_days,
        digest_enabled: d.digest_enabled,
        digest_hour: d.digest_hour,
        digest_channel: d.digest_channel,
        slack_channel: d.slack_channel.trim(),
        second_reviewer: d.second_reviewer,
        renewal_default: d.renewal_default,
        default_signup_role: d.default_signup_role,
        leak_lag_days: Math.max(0, Math.round(d.leak_lag_days)),
        approval_sla_days: Math.max(0, Math.round(d.approval_sla_days)),
        approval_stages: stages,
        ...Object.fromEntries(prefixes.map((p) => [p.key, d[p.key].trim().toUpperCase()])),
      });
      toast.success(t('Organization settings saved'));
    } catch {
      /* the client already showed the server's message */
    } finally {
      setBusy(false);
    }
  };

  const orderedOffices = [...d.jurisdictions.filter((c) => (OFFICES as readonly string[]).includes(c)), ...OFFICES.filter((c) => !d.jurisdictions.includes(c))];

  return (
    <div className="flex flex-col gap-4">
      {ro && <ReadOnlyNote>{t('Only administrators can change organization settings. You can see how the app is set up.')}</ReadOnlyNote>}
      <Section
        title={t('Organization|settings tab')}
        actions={
          !ro ? (
            <Button size="sm" loading={busy} disabled={!dirty} onClick={() => void save()}>
              <Save size={13} aria-hidden /> {t('Save changes')}
            </Button>
          ) : undefined
        }
      >
        <fieldset disabled={ro} className="min-w-0">
          <SettingGroup title={t('Identity and language')} description={t('The name appears in the sidebar, digests and exports. New accounts start in the default language; each person can switch their own.')}>
            <Input label={t('Organization name')} value={d.org_name} onChange={(e) => set('org_name', e.target.value)} />
            <Field label={t('Default language')}>
              <div>
                <Segmented<Lang>
                  ariaLabel={t('Default language')}
                  value={d.default_language}
                  onChange={(v) => (ro ? undefined : set('default_language', v))}
                  options={[
                    { value: 'ja', label: '日本語' },
                    { value: 'en', label: 'English' },
                  ]}
                />
              </div>
            </Field>
          </SettingGroup>

          <SettingGroup title={t('Money and offices')} description={t('Royalties, fees and forecasts are shown in the home currency. Offices of interest come first in every list.')}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Select label={t('Home currency')} value={d.home_currency} options={CURRENCIES.map((c) => ({ value: c, label: c }))} onChange={(e) => set('home_currency', e.target.value)} />
              <Field label={t('Work calendar')} help={t('Business-day deadlines inside the company (approval SLAs, internal targets) skip this office\'s closure days.')}>
                <Select aria-label={t('Work calendar')} value={d.work_calendar} options={OFFICES.map((o) => ({ value: o, label: `${o} · ${jurisdictionName(o)}` }))} onChange={(e) => set('work_calendar', e.target.value)} />
              </Field>
            </div>
            <Field label={t('Trademark offices of interest')} help={t('{n} selected.', { n: d.jurisdictions.length })}>
              <JurisdictionChips value={d.jurisdictions} onChange={(v) => (ro ? undefined : set('jurisdictions', v))} options={orderedOffices} />
            </Field>
          </SettingGroup>

          <SettingGroup title={t('Deadlines')} description={t('How targets and reminders are set for every computed deadline.')}>
            <Field label={t('Target buffer (days)')} help={t('Target dates are set this many days before statutory due dates.')}>
              <Input aria-label={t('Target buffer (days)')} type="number" min={0} max={365} className="max-w-[8rem]" value={String(d.target_buffer_days)} onChange={(e) => set('target_buffer_days', num(e.target.value))} />
            </Field>
            <Field label={t('Reminders (days before the due date)')} help={t('Assignees get a reminder at each of these points.')}>
              <NumberChips value={d.reminder_days} onChange={(v) => set('reminder_days', v)} disabled={ro} suffix={t('d|days short')} />
            </Field>
          </SettingGroup>

          <SettingGroup title={t('Daily digest')} description={t('A summary of overdue items, upcoming deadlines and open reviews, sent once a day. Each person can opt out in My account.')}>
            <Switch checked={d.digest_enabled} disabled={ro} onCheckedChange={(v) => set('digest_enabled', v)} label={d.digest_enabled ? t('Send the daily digest') : t('The daily digest is off')} />
            {d.digest_enabled && (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Select label={t('Send at')} value={String(d.digest_hour)} options={hourOptions()} onChange={(e) => set('digest_hour', Number(e.target.value))} />
                  <Field label={t('Channel')} help={t('Email and Slack go through CraftBot\'s connected Gmail or Slack.')}>
                    <div>
                      <Segmented<Channel>
                        ariaLabel={t('Channel')}
                        value={d.digest_channel}
                        onChange={(v) => (ro ? undefined : set('digest_channel', v))}
                        options={(['in_app', 'email', 'slack'] as const).map((c) => ({ value: c, label: enumLabel('settings.digest_channel', c) }))}
                      />
                    </div>
                  </Field>
                </div>
                {d.digest_channel === 'slack' && (
                  <Input label={t('Slack channel')} placeholder="#ip-deadlines" value={d.slack_channel} onChange={(e) => set('slack_channel', e.target.value)} />
                )}
              </>
            )}
          </SettingGroup>

          <SettingGroup title={t('Review and renewals')}>
            <Field label={t('Second reviewer')} help={t('When on, statutory deadlines proposed by CraftBot or office data need approval from two different people.')}>
              <Switch checked={d.second_reviewer} disabled={ro} onCheckedChange={(v) => set('second_reviewer', v)} label={d.second_reviewer ? t('On') : t('Off')} />
            </Field>
            <Field label={t('Renewal default')} help={renewalHelp(d.renewal_default)}>
              <div>
                <Segmented<RenewalDefault>
                  ariaLabel={t('Renewal default')}
                  value={d.renewal_default}
                  onChange={(v) => (ro ? undefined : set('renewal_default', v))}
                  options={[
                    { value: 'decide', label: t('Ask each time') },
                    { value: 'renew', label: t('Renew') },
                    { value: 'lapse', label: t('Let lapse') },
                  ]}
                />
              </div>
            </Field>
          </SettingGroup>

          <SettingGroup title={t('New sign-ups')} description={t('The first account is the administrator. People who sign up later get this role; change it per person in People and roles.')}>
            <Field label={t('Default role')} help={roleHelp(d.default_signup_role as Role)}>
              <Select
                aria-label={t('Default role')}
                value={d.default_signup_role}
                options={SIGNUP_ROLES.map((r) => ({ value: r, label: enumLabel('settings.default_signup_role', r) }))}
                onChange={(e) => {
                  const v = SIGNUP_ROLES.find((r) => r === e.target.value);
                  if (v !== undefined) set('default_signup_role', v);
                }}
              />
            </Field>
          </SettingGroup>

          <SettingGroup title={t('Licensing and protection')} description={t('Defaults used when an agreement does not set its own.')}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('Approval reply time (business days)')} help={t('How long reviewers have to answer a submitted approval stage.')}>
                <Input aria-label={t('Approval reply time (business days)')} type="number" min={0} max={120} className="max-w-[8rem]" value={String(d.approval_sla_days)} onChange={(e) => set('approval_sla_days', num(e.target.value))} />
              </Field>
              <Field label={t('Leak check lag (days)')} help={t('How many days after filing a trademark usually becomes public (J-PlatPat shows Japanese filings after about 2 to 3 weeks). The leak check warns when a filing would be visible before the announcement.')}>
                <Input aria-label={t('Leak check lag (days)')} type="number" min={0} max={365} className="max-w-[8rem]" value={String(d.leak_lag_days)} onChange={(e) => set('leak_lag_days', num(e.target.value))} />
              </Field>
            </div>
          </SettingGroup>

          <SettingGroup
            title={t('Approval stages (監修)')}
            description={t('The stages a licensed product goes through, in order, when an agreement does not list its own. Each stage names who reviews it and how long they have.')}
          >
            <StageEditor rows={d.approval_stages} onChange={(v) => set('approval_stages', v)} disabled={ro} />
          </SettingGroup>

          <SettingGroup title={t('Reference prefixes')} description={t('New records are numbered PREFIX-NNNN, with the office code added for trademarks and designs. Existing references never change.')}>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {prefixes.map((p) => {
                const val = d[p.key].trim().toUpperCase();
                return (
                  <Field key={p.key} label={p.label} help={t('For example {ref}', { ref: p.example(val !== '' ? val : p.fallback) })}>
                    <Input
                      aria-label={p.label}
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
        <div className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 border border-[var(--agent-app-accent)]/40 bg-[var(--agent-app-surface)] px-4 py-2.5 shadow-lg">
          <span className="text-[13px]">{t('You have unsaved changes.')}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setD(draftOf(settings))}>
              {t('Discard')}
            </Button>
            <Button size="sm" loading={busy} onClick={() => void save()}>
              {t('Save changes')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Ordered list of approval stage templates. */
function StageEditor({ rows, onChange, disabled }: { rows: StageRow[]; onChange: (v: StageRow[]) => void; disabled: boolean }): React.JSX.Element {
  const stageOptions = enumOptions('approvals.stage').map(([value, label]) => ({ value, label }));
  const patch = (i: number, p: Partial<StageRow>): void => onChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const move = (i: number, dir: -1 | 1): void => {
    const j = i + dir;
    if (j < 0 || j >= rows.length) return;
    const next = rows.slice();
    const a = next[i];
    const b = next[j];
    if (a === undefined || b === undefined) return;
    next[i] = b;
    next[j] = a;
    onChange(next);
  };
  const add = (): void => {
    const used = new Set(rows.map((r) => r.key));
    const free = stageOptions.find((o) => !used.has(o.value));
    if (free === undefined) {
      toast.error(t('Every stage type is already in the list.'));
      return;
    }
    onChange([...rows, { key: free.value, label: enumLabel('approvals.stage', free.value), label_ja: '', sla_days: 5, reviewers: ['internal'] }]);
  };

  return (
    <div className="flex flex-col gap-2">
      {rows.length === 0 && <p className="text-[13px] text-[var(--agent-app-muted)]">{t('No stages yet. Add the first stage a product goes through.')}</p>}
      {rows.map((r, i) => (
        <div key={`${r.key}-${i}`} className="flex min-w-0 flex-col gap-3 border border-[var(--agent-app-border)] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold tabular-nums text-[var(--agent-app-muted)]">{t('Stage {n}', { n: i + 1 })}</span>
            {!disabled && (
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" className="h-7 px-2" aria-label={t('Move up')} disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp size={13} aria-hidden />
                </Button>
                <Button size="sm" variant="ghost" className="h-7 px-2" aria-label={t('Move down')} disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDown size={13} aria-hidden />
                </Button>
                <Button size="sm" variant="ghost" className="h-7 px-2" aria-label={t('Remove')} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                  <Trash2 size={13} aria-hidden />
                </Button>
              </div>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Select label={t('Stage type')} value={r.key} options={stageOptions} onChange={(e) => patch(i, { key: e.target.value })} />
            <Input label={t('Name (English)')} value={r.label} onChange={(e) => patch(i, { label: e.target.value })} />
            <Input label={t('Name (Japanese)')} value={r.label_ja} onChange={(e) => patch(i, { label_ja: e.target.value })} />
            <Input label={t('Reply time (business days)')} type="number" min={0} max={120} value={String(r.sla_days)} onChange={(e) => patch(i, { sla_days: num(e.target.value) })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">{t('Who reviews')}</span>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {REVIEWER_KINDS.map((k) => (
                <Checkbox
                  key={k}
                  label={reviewerKindLabel(k)}
                  checked={r.reviewers.includes(k)}
                  disabled={disabled}
                  onChange={(v) => patch(i, { reviewers: v ? [...r.reviewers, k] : r.reviewers.filter((x) => x !== k) })}
                />
              ))}
            </div>
          </div>
        </div>
      ))}
      {!disabled && (
        <div>
          <Button size="sm" variant="outline" onClick={add}>
            <Plus size={13} aria-hidden /> {t('Add a stage')}
          </Button>
        </div>
      )}
      <p className="text-xs leading-relaxed text-[var(--agent-app-muted)]">
        {t('Our team: your licensing staff. Committee: the production committee members. Original author: the publisher or author of the original work. Talent: the talent or their manager. Outside reviewer: a reviewer account you invite.')}
      </p>
    </div>
  );
}
