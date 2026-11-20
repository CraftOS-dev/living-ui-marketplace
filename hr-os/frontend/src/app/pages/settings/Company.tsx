/** Company, your AI agent (autonomy, Automatic work, what wakes it), and notifications. */
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, Circle, Trash2, Upload } from 'lucide-react';
import { cn, getPbClient } from '../../../kit/index.ts';
import { Button, Hint, Input, Loading, Panel, Row, Segmented, Select, Toggle, confirmAsk, toast } from '../../components/ui.tsx';
import type { HomeCounts } from '../../components/shell/counts.ts';
import { op, opForm } from '../../lib/api.ts';
import { can, refreshMe, useMe } from '../../lib/auth.tsx';
import { t } from '../../lib/i18n.ts';
import { act, changed, reshape, useOp } from '../../lib/live.ts';

export interface CompanySettings {
  company_name: string;
  reporting_currency: string;
  date_style: 'entity' | 'iso' | 'dmy' | 'mdy' | 'ymd' | '';
  autonomy: Record<string, 'ask' | 'auto'>;
  /** Automatic work: the sources that may ask your AI agent without a click (all off by default). */
  automatic: Record<string, boolean>;
  agent_sees_pay: boolean;
  managers_see_pay: boolean;
  email_notifications: boolean;
  payslip_publish_hour: number;
  setup_done: boolean;
}

export function useSettings(): { s: CompanySettings | null; save: (patch: Partial<CompanySettings>) => void } {
  const live = useOp<CompanySettings>('settings.get', {}, ['settings'], { name: 'settings.get' });
  const save = (patch: Partial<CompanySettings>): void => {
    void act([reshape('settings.get', (d) => ({ ...(d as CompanySettings), ...patch }))], () => (patch.autonomy !== undefined ? op('settings.autonomy', { autonomy: patch.autonomy }) : patch.automatic !== undefined ? op('settings.automatic', { automatic: patch.automatic }) : op('settings.update', patch as Record<string, unknown>)), ['settings']).then(() => void refreshMe());
  };
  return { s: live.data, save };
}

/** A text setting saved when the field is left. */
function TextSetting({ value, onSave, label, className, mono, maxLength }: { value: string; onSave: (v: string) => void; label: string; className?: string | undefined; mono?: boolean | undefined; maxLength?: number | undefined }): React.JSX.Element {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return <Input value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v.trim() !== value && v.trim() !== '' && onSave(v.trim())} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} aria-label={label} className={cn(className, mono === true && 'hr-mono uppercase')} maxLength={maxLength} />;
}

const LOGO_ACCEPT = '.png,.jpg,.jpeg,.svg,.webp,image/png,image/jpeg,image/svg+xml,image/webp';
const LOGO_MAX = 1048576;

/**
 * One logo slot: a preview on the surface it will sit on (white, or dark for
 * the dark-mode logo), upload or replace, and remove. The preview is an <img>
 * of the stored file (never inline SVG).
 */
function LogoSlot({ dark, file, other, edit, name }: { dark: boolean; file: string; other: string; edit: boolean; name: string }): React.JSX.Element {
  const input = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const after = async (): Promise<void> => {
    changed('settings');
    await refreshMe();
  };
  const upload = async (f: File): Promise<void> => {
    if (!/\.(png|jpe?g|svg|webp)$/i.test(f.name)) return void toast.error(t('settings.logo_type'));
    if (f.size > LOGO_MAX) return void toast.error(t('settings.logo_size'));
    setBusy(true);
    try {
      await opForm('settings.logo-set', { dark: dark ? true : undefined }, { logo: f });
      await after();
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  const remove = async (): Promise<void> => {
    if (!(await confirmAsk(t('settings.logo_remove_text'), t('settings.logo_remove')))) return;
    setBusy(true);
    try {
      await op('settings.logo-remove', { dark: dark ? true : undefined });
      await after();
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  const src = (): string => {
    const q = new URLSearchParams({ v: file });
    if (dark) q.set('dark', 'true');
    return getPbClient().pb.buildURL('/api/ops/settings/logo') + '?' + q.toString();
  };
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className="text-[12px] font-medium text-[var(--hr-ink-2)]">{dark ? t('settings.logo_dark') : t('settings.logo_light')}</span>
      {/* The surface the logo will sit on: white paper and the light theme, or the dark theme. */}
      <div className={cn('flex h-20 items-center justify-center rounded-[var(--hr-radius-sm)] border px-4', dark ? 'border-[#2c363c] bg-[#151b1f]' : 'border-[var(--hr-line)] bg-white')}>
        {file !== '' ? <img src={src()} alt={name} className="max-h-12 max-w-full object-contain" /> : <span className={cn('text-[12px]', dark ? 'text-[#aab4ba]' : 'text-[#5f6a70]')}>{dark && other !== '' ? t('settings.logo_dark_none') : t('settings.logo_none')}</span>}
      </div>
      {edit && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" icon={Upload} busy={busy} onClick={() => input.current?.click()}>
            {file !== '' ? t('settings.logo_replace') : t('settings.logo_upload')}
          </Button>
          {file !== '' && (
            <Button size="sm" variant="ghost" icon={Trash2} disabled={busy} onClick={() => void remove()}>
              {t('ui.remove')}
            </Button>
          )}
          <input
            ref={input}
            type="file"
            accept={LOGO_ACCEPT}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f !== undefined) void upload(f);
            }}
          />
        </div>
      )}
    </div>
  );
}

export function CompanySection(): React.JSX.Element {
  const me = useMe();
  const { s, save } = useSettings();
  const home = useOp<HomeCounts>('app.home', {}, ['settings', 'entities', 'departments', 'employees', 'members'], { name: 'shell.home' });
  const edit = can(me, 'admin', 'full');
  if (s === null) return <Loading />;
  const setup = home.data?.setup;
  return (
    <div className="flex flex-col gap-3">
      <Panel index="01" label={t('settings.company')} bodyClass="flex flex-col divide-y divide-[var(--hr-hair)]">
        <Row label={t('settings.company_name')}>
          <TextSetting value={s.company_name} onSave={(v) => save({ company_name: v })} label={t('settings.company_name')} className="w-[240px]" />
        </Row>
        <Row label={t('settings.reporting_currency')} hint={t('settings.reporting_currency_hint')}>
          <TextSetting value={s.reporting_currency} onSave={(v) => save({ reporting_currency: v.toUpperCase() })} label={t('settings.reporting_currency')} className="w-[90px]" mono maxLength={3} />
        </Row>
        <Row label={t('settings.date_style')}>
          <Segmented value={s.date_style === '' ? 'entity' : s.date_style} onChange={(v) => edit && save({ date_style: v })} label={t('settings.date_style')} size="sm" options={(['entity', 'iso', 'dmy', 'mdy'] as const).map((k) => ({ value: k, label: t(`settings.date.${k}`) }))} />
        </Row>
        <Row label={t('settings.managers_see_pay')} hint={t('settings.managers_see_pay_hint')}>
          <Toggle checked={s.managers_see_pay} onChange={(v) => save({ managers_see_pay: v })} label={t('settings.managers_see_pay')} disabled={!edit} />
        </Row>
        <Row label={t('settings.publish_hour')} hint={t('settings.publish_hour_hint')}>
          <Select value={String(s.payslip_publish_hour)} onChange={(e) => save({ payslip_publish_hour: Number(e.target.value) })} aria-label={t('settings.publish_hour')} className="w-[110px]" disabled={!edit}>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, '0')}:00
              </option>
            ))}
          </Select>
        </Row>
      </Panel>
      <Panel index="02" label={t('settings.logo')}>
        <p className="mb-3 text-[12px] text-[var(--hr-muted)]">{t('settings.logo_hint')}</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <LogoSlot dark={false} file={me.company.logo} other={me.company.logo_dark} edit={edit} name={me.company.name} />
          <LogoSlot dark file={me.company.logo_dark} other={me.company.logo} edit={edit} name={me.company.name} />
        </div>
      </Panel>
      {setup !== undefined && (
        <Panel index="03" label={t('settings.setup')} aside={<span className="hr-label">{setup.done}/{setup.total}</span>}>
          <div className="mb-3 h-[3px] w-full overflow-hidden rounded-full bg-[var(--hr-line)]">
            <div className="h-full rounded-full bg-[var(--hr-ink)] transition-[width] duration-500" style={{ width: `${(setup.done / Math.max(1, setup.total)) * 100}%` }} />
          </div>
          <ul className="flex flex-col">
            {setup.steps.map((st) => (
              <li key={st.key}>
                <a href={st.link} className="hr-focus group flex items-center gap-3 rounded-[var(--hr-radius-sm)] border-b border-[var(--hr-hair)] px-1.5 py-2.5 transition-colors last:border-b-0 hover:bg-[var(--hr-hover)]">
                  <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-full border', st.done ? 'border-[var(--hr-ink)] bg-[var(--hr-ink)] text-[var(--hr-on-ink)]' : 'border-[var(--hr-line-2)] text-[var(--hr-faint)]')}>{st.done ? <Check size={12} strokeWidth={2.6} aria-hidden /> : <Circle size={6} aria-hidden fill="currentColor" />}</span>
                  <span className={cn('flex-1 text-[13px]', st.done && 'text-[var(--hr-muted)] line-through decoration-[var(--hr-line-2)]')}>{t(`setup.todo.${st.key}`)}</span>
                  <ArrowRight size={14} aria-hidden className="text-[var(--hr-faint)] group-hover:text-[var(--hr-ink)]" />
                </a>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

const KINDS = ['people', 'time', 'leave', 'expenses', 'payroll', 'hiring', 'performance', 'packs'];

interface Triggers {
  triggers: { name: string; label: string; description: string; fires: string; cooldown_seconds: number; param: string }[];
  automatic: { key: string; label: string; tip: string; trigger: string; on: boolean }[];
}

export function AgentSection(): React.JSX.Element {
  const me = useMe();
  const { s, save } = useSettings();
  const wakes = useOp<Triggers>('agent.triggers', {}, ['settings'], { name: 'agent.triggers' });
  if (s === null) return <Loading />;
  const edit = can(me, 'admin', 'full');
  return (
    <div className="flex flex-col gap-3">
      <Panel index="01" label={t('agent.autonomy')} bodyClass="flex flex-col divide-y divide-[var(--hr-hair)]">
        {KINDS.map((k) => (
          <Row key={k} label={t(`kind.p.${k}`)} hint={t(`agent.kind_hint.${k}`)}>
            <Segmented
              value={s.autonomy[k] ?? 'ask'}
              onChange={(v) => edit && save({ autonomy: { ...s.autonomy, [k]: v } })}
              label={t(`kind.p.${k}`)}
              size="sm"
              options={[
                { value: 'ask', label: t('agent.ask_me') },
                { value: 'auto', label: t('agent.auto') },
              ]}
            />
          </Row>
        ))}
      </Panel>
      <div className="flex flex-col gap-3">
        <Panel index="02" label={t('agent.sight')} bodyClass="flex flex-col divide-y divide-[var(--hr-hair)]">
          <Row label={t('agent.sees_pay')} hint={t('agent.sees_pay_hint')}>
            <Toggle checked={s.agent_sees_pay} onChange={(v) => save({ agent_sees_pay: v })} label={t('agent.sees_pay')} disabled={!edit} />
          </Row>
        </Panel>
        <Panel index="03" label={t('agent.never')}>
          <ul className="flex flex-col gap-1.5 pt-1">
            {['approve', 'lock', 'export', 'reveal', 'bank', 'packs', 'members', 'delete'].map((k) => (
              <li key={k} className="flex items-center gap-2 text-[13px] text-[var(--hr-ink-2)]">
                <span aria-hidden className="size-1.5 rounded-full bg-[var(--hr-line-2)]" />
                {t(`agent.never.${k}`)}
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      <Panel index="04" label={t('agent.automatic')} bodyClass="flex flex-col divide-y divide-[var(--hr-hair)]">
        {(wakes.data?.automatic ?? []).map((a) => (
          <Row
            key={a.key}
            label={
              <span className="inline-flex items-center gap-1.5">
                {a.label}
                <Hint text={a.tip} />
              </span>
            }
          >
            <Toggle checked={s.automatic[a.key] === true} onChange={(v) => save({ automatic: { ...s.automatic, [a.key]: v } })} label={a.label} disabled={!edit} />
          </Row>
        ))}
      </Panel>
      <Panel index="05" label={t('agent.wakes')} bodyClass="flex flex-col divide-y divide-[var(--hr-hair)]">
        {(wakes.data?.triggers ?? []).map((w) => (
          <Row key={w.name} label={w.label} hint={w.fires}>
            <span className="hr-mono text-[12px] text-[var(--hr-muted)]">{w.name}</span>
          </Row>
        ))}
      </Panel>
    </div>
  );
}

export function NotificationsSection(): React.JSX.Element {
  const me = useMe();
  const admin = can(me, 'admin', 'view');
  const { s, save } = useSettingsIf(admin);
  const pref = me.member.prefs['email_me'] !== false;
  return (
    <div className="flex flex-col gap-3">
      <Panel index="01" label={t('notify.you')} bodyClass="flex flex-col divide-y divide-[var(--hr-hair)]">
        <Row label={t('notify.email_me')} hint={s !== null && !s.email_notifications ? t('notify.company_off') : t('notify.email_me_hint')}>
          <Toggle checked={pref} onChange={(v) => void op('auth.update-profile', { prefs: { email_me: v } }).then(() => refreshMe())} label={t('notify.email_me')} />
        </Row>
      </Panel>
      {admin && s !== null && (
        <Panel index="02" label={t('notify.company')} bodyClass="flex flex-col divide-y divide-[var(--hr-hair)]">
          <Row label={t('notify.company_email')} hint={t('notify.company_email_hint')}>
            <Toggle checked={s.email_notifications} onChange={(v) => save({ email_notifications: v })} label={t('notify.company_email')} disabled={!can(me, 'admin', 'full')} />
          </Row>
        </Panel>
      )}
    </div>
  );
}

function useSettingsIf(on: boolean): { s: CompanySettings | null; save: (patch: Partial<CompanySettings>) => void } {
  const live = useOp<CompanySettings>('settings.get', {}, ['settings'], { name: 'settings.get', skip: !on });
  const save = (patch: Partial<CompanySettings>): void => {
    void act([reshape('settings.get', (d) => ({ ...(d as CompanySettings), ...patch }))], () => op('settings.update', patch as Record<string, unknown>), ['settings']);
  };
  return { s: live.data, save };
}
