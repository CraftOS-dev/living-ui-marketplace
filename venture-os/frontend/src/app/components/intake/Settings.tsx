/**
 * Settings, Intake: the reply SLA (business days), the Gmail deals label and
 * its sweep (Check now shows the result in place), the pass reasons in use,
 * the pass email template, and the scouts. Saved through settings.update
 * (the owner) and scouts.save (partners).
 */
import { useEffect, useState } from 'react';
import { Mail, Plus, UserPlus } from 'lucide-react';
import { Avatar, Button, Checkbox, Empty, Field, Input, LoadError, More, Panel, Row, Skeleton, StatusDot, SubHeader, Textarea, Toggle } from '../ui.tsx';
import { op } from '../../lib/api.ts';
import { allowed, useMe } from '../../lib/auth.ts';
import { ago, num } from '../../lib/format.ts';
import { act, useOp } from '../../lib/live.ts';
import type { IntakeSettingsOut, Scout } from './types.ts';

interface Draft {
  sla: string;
  label: string;
  sweep: boolean;
  reasons: string[];
  template: string;
}

function draftOf(s: IntakeSettingsOut): Draft {
  return { sla: String(s.reply_sla_days), label: s.deals_label, sweep: s.sweep, reasons: s.pass_reasons.filter((r) => r.on).map((r) => r.value), template: s.pass_template };
}

function same(a: Draft, b: Draft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function IntakeSettings(): React.JSX.Element {
  const me = useMe();
  const live = useOp<IntakeSettingsOut>('intake.settings', {}, ['settings', 'intake_items'], { name: 'intake.settings' });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState('');
  const [check, setCheck] = useState<{ ok: boolean; added: number; error?: string | undefined } | null>(null);
  useEffect(() => {
    if (live.data !== null && draft === null) setDraft(draftOf(live.data));
  }, [live.data, draft]);
  const owner = allowed(me, 'admin');
  if (live.data === null || draft === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Skeleton className="h-48 w-full" />;
  const s = live.data;
  const base = draftOf(s);
  const sla = Number(draft.sla);
  const valid = Number.isInteger(sla) && sla >= 0 && sla <= 60 && draft.label.trim() !== '' && draft.reasons.length > 0;
  const save = async (): Promise<void> => {
    setBusy('save');
    const order = s.pass_reasons.map((r) => r.value).filter((v) => draft.reasons.includes(v));
    const out = await act([], () => op('settings.update', { modules: { intake: { reply_sla_days: sla, sweep: draft.sweep, pass_reasons: order, pass_template: draft.template === s.pass_template ? undefined : draft.template } }, mail: { deals_label: draft.label.trim() } }), ['settings']);
    setBusy('');
    if (out !== null) setDraft(null);
  };
  const sweep = async (): Promise<void> => {
    setBusy('sweep');
    const out = await act([], () => op<{ ok: boolean; added: number; error?: string }>('intake.sweep', {}), ['intake_items', 'settings']);
    setBusy('');
    if (out !== null) setCheck({ ok: out.ok, added: out.added, error: out.error });
  };
  const last = check ?? s.last_sweep;
  return (
    <>
      <SubHeader title="Intake">
        {owner && (
          <Button variant="primary" busy={busy === 'save'} disabled={!valid || same(draft, base)} onClick={() => void save()}>
            Save
          </Button>
        )}
      </SubHeader>
      <Panel>
        <div className="flex max-w-[620px] flex-col divide-y divide-[var(--vo-hair)]">
          <Row label="Reply within" tip="Business days from arrival to the first reply. Past it, a deal goes to the top of Next.">
            <Input className="vo-mono vo-num w-16 text-right" inputMode="numeric" value={draft.sla} disabled={!owner} onChange={(e) => setDraft({ ...draft, sla: e.target.value.replace(/[^0-9]/g, '') })} aria-label="Reply within, business days" />
            <span className="text-[13px] text-[var(--vo-muted)]">days</span>
          </Row>
          <Row label="Deals label" tip="Emails with this Gmail label become deals in the Inbox.">
            <Input className="w-56" value={draft.label} disabled={!owner} onChange={(e) => setDraft({ ...draft, label: e.target.value })} aria-label="Deals label" />
          </Row>
          <Row label="Check email" tip="Reads the deals label every 5 minutes.">
            {last !== null && last !== undefined && (
              <span className="hidden sm:inline-flex">
                {!s.bridge ? (
                  <StatusDot tone="faint" label="Connect Gmail in CraftBot" />
                ) : last.ok ? (
                  <StatusDot tone="good" label={'at' in last && typeof last.at === 'string' ? ago(last.at) + (last.added > 0 ? ', ' + num(last.added) + ' new' : '') : num(last.added) + ' new'} />
                ) : (
                  <StatusDot tone="bad" label={last.error ?? 'Not checked'} />
                )}
              </span>
            )}
            {allowed(me, 'intake:edit') && (
              <Button size="sm" icon={Mail} busy={busy === 'sweep'} onClick={() => void sweep()}>
                Check now
              </Button>
            )}
            <Toggle checked={draft.sweep} disabled={!owner} onChange={(v) => setDraft({ ...draft, sweep: v })} label="Check email every 5 minutes" />
          </Row>
        </div>
      </Panel>
      <Panel label="Pass reasons">
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {s.pass_reasons.map((r) => (
            <Checkbox key={r.value} label={r.label} checked={draft.reasons.includes(r.value)} disabled={!owner} onChange={(v) => setDraft({ ...draft, reasons: v ? [...draft.reasons, r.value] : draft.reasons.filter((x) => x !== r.value) })} />
          ))}
        </div>
        <More label="Template" className="mt-4">
          <Field label="Pass email" tip="Used when a person writes the pass email. Fills {first_name}, {company}, {reason}, {criterion}, {milestone}, {sender} and {firm}.">
            <Textarea value={draft.template} minRows={8} maxRows={18} disabled={!owner} onChange={(e) => setDraft({ ...draft, template: e.target.value })} aria-label="Pass email template" />
          </Field>
        </More>
      </Panel>
      <Scouts />
    </>
  );
}

function Scouts(): React.JSX.Element {
  const me = useMe();
  const edit = allowed(me, 'intake:edit') && me.role?.own_items !== true;
  const live = useOp<{ scouts: Scout[] }>('scouts.list', {}, ['scouts', 'intake_items'], { name: 'scouts.list' });
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState('');
  const add = async (): Promise<void> => {
    setBusy('add');
    const out = await act([], () => op('scouts.save', { name: name.trim(), email: email.trim() }), ['scouts']);
    setBusy('');
    if (out !== null) {
      setName('');
      setEmail('');
    }
  };
  const toggle = async (sc: Scout, on: boolean): Promise<void> => {
    await act([], () => op('scouts.save', { scout: sc.id, status: on ? 'active' : 'paused' }), ['scouts']);
  };
  const list = live.data?.scouts ?? [];
  return (
    <Panel label="Scouts" flush>
      {live.data === null ? (
        live.error !== null ? (
          <LoadError message={live.error} onRetry={live.reload} />
        ) : (
          <Skeleton className="m-5 h-16" />
        )
      ) : list.length === 0 && !edit ? (
        <Empty icon={UserPlus} title="No scouts yet" />
      ) : (
        <ul className="flex flex-col">
          {list.map((sc) => (
            <li key={sc.id} className="flex min-h-11 min-w-0 items-center gap-3 border-b border-[var(--vo-hair)] px-5 py-1.5">
              <Avatar name={sc.name} size={24} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{sc.name}</span>
              </span>
              <span className="vo-mono hidden min-w-0 truncate text-[12px] text-[var(--vo-muted)] sm:block">{sc.email}</span>
              <span className="vo-mono vo-num w-20 text-right text-[12px] text-[var(--vo-ink-2)]" title="Deals sent, advanced">
                {num(sc.items)} / {num(sc.advanced)}
              </span>
              <Toggle checked={sc.status === 'active'} disabled={!edit} onChange={(v) => void toggle(sc, v)} label={'Active: ' + sc.name} />
            </li>
          ))}
        </ul>
      )}
      {edit && (
        <div className="flex flex-wrap items-center gap-2 px-5 py-3">
          <Input className="w-44" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Scout name" />
          <Input className="w-56" placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Scout email" />
          <Button icon={Plus} busy={busy === 'add'} disabled={name.trim() === ''} onClick={() => void add()}>
            Add
          </Button>
        </div>
      )}
    </Panel>
  );
}
