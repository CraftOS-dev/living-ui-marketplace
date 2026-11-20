/**
 * Settings, Committee: the vote scale per fund, who votes, the cooling-off,
 * the default rule, the meeting day, and the memo template's sections.
 * Firm values go to settings.update (modules.committee); a fund's scale to
 * its entity settings (entities.save); sections to memos.template-save.
 */
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, Lock, LockOpen, Plus, Trash2 } from 'lucide-react';
import { Button, ChipPicker, Hint, IconButton, Input, LoadError, More, Panel, Row, Segmented, Skeleton, SubHeader, Tip } from '../../components/ui.tsx';
import { RULES, SCALES } from '../../components/committee/types.ts';
import { op } from '../../lib/api.ts';
import { allowed, useMe } from '../../lib/auth.ts';
import { act, useOp } from '../../lib/live.ts';

interface CommitteeSettingsRow {
  scale: string;
  voter_roles: string[];
  cooling_hours: number;
  rule: string;
  meeting_weekday: number;
  meeting_time: string;
}

interface Role {
  id: string;
  code: string;
  name: string;
  votes: boolean;
}

interface FundRow {
  id: string;
  kind: string;
  name: string;
  settings?: Record<string, Record<string, unknown>> | undefined;
}

interface Template {
  id: string;
  name: string;
  is_default: boolean;
  sections: { key: string; label: string; people_only: boolean }[];
}

const LOCKED = ['thesis', 'recommendation'];
const DAYS = [
  { value: '1', label: 'Mon' },
  { value: '2', label: 'Tue' },
  { value: '3', label: 'Wed' },
  { value: '4', label: 'Thu' },
  { value: '5', label: 'Fri' },
];

/**
 * A settings row with a wide control (a scale, the voting roles): the label
 * beside the control on wide screens, on top of it on phones, where the
 * control takes the full width and wraps (no sideways scroll).
 */
function WideRow({ label, tip, children }: { label: ReactNode; tip?: string | undefined; children: ReactNode }): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-2 py-2.5 md:min-h-11 md:flex-row md:items-center md:justify-between md:gap-4 md:py-2">
      <div className="flex min-w-0 items-center gap-1.5 text-[13px] text-[var(--vo-ink)]">
        <span className="vo-wrap min-w-0">{label}</span>
        {tip !== undefined && <Hint text={tip} />}
      </div>
      <div className="flex min-w-0 max-w-full items-center gap-2 md:shrink-0 md:justify-end">{children}</div>
    </div>
  );
}

function TemplateEditor({ template, edit }: { template: Template; edit: boolean }): React.JSX.Element {
  const [rows, setRows] = useState(template.sections);
  const [busy, setBusy] = useState(false);
  useEffect(() => setRows(template.sections), [template]);
  const dirty = JSON.stringify(rows) !== JSON.stringify(template.sections);
  const move = (i: number, d: number): void => {
    const next = [...rows];
    const [x] = next.splice(i, 1);
    if (x !== undefined) next.splice(i + d, 0, x);
    setRows(next);
  };
  const save = async (): Promise<void> => {
    setBusy(true);
    await act([], () => op('memos.template-save', { template: template.id, sections: rows.filter((r) => r.label.trim() !== '').map((r) => ({ key: r.key !== '' ? r.key : undefined, label: r.label.trim(), people_only: r.people_only })) }), ['memo_templates']);
    setBusy(false);
  };
  return (
    <Panel
      label="Memo sections"
      aside={
        edit && dirty ? (
          <Button size="sm" variant="primary" busy={busy} onClick={() => void save()}>
            Save
          </Button>
        ) : undefined
      }
    >
      <ul className="flex min-w-0 flex-col">
        {rows.map((r, i) => (
          <li key={r.key !== '' ? r.key : `new${i}`} className="flex min-h-10 min-w-0 items-center gap-2 border-b border-[var(--vo-hair)] last:border-b-0">
            <span className="vo-mono w-5 shrink-0 text-[12px] text-[var(--vo-muted)]">{i + 1}</span>
            {edit ? <Input className="min-w-0 flex-1" value={r.label} aria-label="Section" onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} /> : <span className="min-w-0 flex-1 text-[13px]">{r.label}</span>}
            {LOCKED.includes(r.key) ? (
              <Tip text="Always written by people">
                <Lock size={13} className="mx-2 text-[var(--vo-muted)]" aria-label="People only" />
              </Tip>
            ) : (
              <IconButton icon={r.people_only ? Lock : LockOpen} label={r.people_only ? 'People only' : 'Your AI agent may draft'} active={r.people_only} size={28} disabled={!edit} onClick={() => setRows(rows.map((x, j) => (j === i ? { ...x, people_only: !x.people_only } : x)))} />
            )}
            {edit && (
              <>
                <IconButton icon={ArrowUp} label="Up" size={28} disabled={i === 0} onClick={() => move(i, -1)} />
                <IconButton icon={ArrowDown} label="Down" size={28} disabled={i === rows.length - 1} onClick={() => move(i, 1)} />
                <IconButton icon={Trash2} label="Remove" size={28} disabled={LOCKED.includes(r.key)} onClick={() => setRows(rows.filter((_, j) => j !== i))} />
              </>
            )}
          </li>
        ))}
      </ul>
      {edit && (
        <Button size="sm" variant="ghost" icon={Plus} className="mt-2" onClick={() => setRows([...rows, { key: '', label: '', people_only: false }])}>
          Section
        </Button>
      )}
    </Panel>
  );
}

export function CommitteeSettings(): React.JSX.Element {
  const me = useMe();
  const settings = useOp<{ modules: { committee?: CommitteeSettingsRow } }>('settings.get', {}, ['settings'], { name: 'settings.get' });
  const roles = useOp<{ roles: Role[] }>('roles.list', {}, ['roles'], { name: 'roles.list' });
  const funds = useOp<{ entities: FundRow[] }>('entities.list', {}, ['entities'], { name: 'committee.funds' });
  const templates = useOp<{ templates: Template[] }>('memos.templates', {}, ['memo_templates'], { name: 'memos.templates' });
  const [hours, setHours] = useState('');
  const edit = allowed(me, 'admin');
  const s = settings.data?.modules.committee;
  useEffect(() => {
    if (s !== undefined) setHours(String(s.cooling_hours));
  }, [s?.cooling_hours]); // eslint-disable-line react-hooks/exhaustive-deps
  if (settings.error !== null && settings.data === null) return <LoadError message={settings.error} onRetry={settings.reload} />;
  if (s === undefined) return <Skeleton className="h-48 w-full" />;
  const put = (change: Partial<CommitteeSettingsRow>): void => void act([], () => op('settings.update', { modules: { committee: change } }), ['settings']);
  const roleList = (roles.data?.roles ?? []).filter((r) => r.code !== 'scout');
  const voters = s.voter_roles.length > 0 ? s.voter_roles : roleList.filter((r) => r.votes).map((r) => r.code);
  const fundRows = (funds.data?.entities ?? []).filter((e) => e.kind === 'fund' || e.kind === 'spv');
  const def = templates.data?.templates.find((t) => t.is_default) ?? templates.data?.templates[0];
  return (
    <>
      <SubHeader title="Committee" />
      <Panel>
        <div className="flex min-w-0 flex-col divide-y divide-[var(--vo-hair)]">
          <WideRow label="Vote scale" tip="Sapphire and Connect: 1 to 5 without 3, so nobody sits on the fence.">
            <Segmented size="sm" label="Vote scale" value={s.scale} onChange={(v) => edit && put({ scale: v })} options={SCALES} />
          </WideRow>
          {fundRows.map((f) => {
            const own = (f.settings?.['committee']?.['scale'] as string | undefined) ?? '';
            return (
              <WideRow key={f.id} label={f.name}>
                <Segmented
                  size="sm"
                  label={`${f.name} scale`}
                  value={own !== '' ? own : 'firm'}
                  onChange={(v) => edit && void act([], () => op('entities.save', { entity: f.id, settings: { committee: { scale: v === 'firm' ? '' : v } } }), ['entities'])}
                  options={[{ value: 'firm', label: 'Firm' }, ...SCALES.map((x) => ({ value: x.value, label: x.label.replace('1 to 10, no 5 or 6', '1 to 10') }))]}
                />
              </WideRow>
            );
          })}
          <WideRow label="Who votes">
            <ChipPicker multiple label="Who votes" options={roleList.map((r) => ({ value: r.code, label: r.name }))} value={voters} onChange={(v) => edit && v.length > 0 && put({ voter_roles: v })} className="md:justify-end" />
          </WideRow>
          <Row label="Rule" tip="Consensus: every vote for. Champion: the champion decides. Majority: more than half. A veto blocks each.">
            <Segmented size="sm" label="Rule" value={s.rule as (typeof RULES)[number]['value']} onChange={(v) => edit && put({ rule: v })} options={RULES} />
          </Row>
          <Row label="Cooling-off hours" tip="Hours after the pre-reads go out before the votes are revealed.">
            <Input className="vo-mono w-16 text-right" inputMode="numeric" value={hours} disabled={!edit} aria-label="Cooling-off hours" onChange={(e) => setHours(e.target.value.replace(/\D/g, ''))} onBlur={() => hours !== '' && Number(hours) !== s.cooling_hours && put({ cooling_hours: Number(hours) })} />
          </Row>
          <More label="Meeting day">
            <Row label="Weekday">
              <Segmented size="sm" label="Weekday" value={String(s.meeting_weekday)} onChange={(v) => edit && put({ meeting_weekday: Number(v) })} options={DAYS} />
            </Row>
            <Row label="Time">
              <Input className="vo-mono w-20" defaultValue={s.meeting_time} disabled={!edit} aria-label="Meeting time" onBlur={(e) => /^\d{2}:\d{2}$/.test(e.target.value) && e.target.value !== s.meeting_time && put({ meeting_time: e.target.value })} />
            </Row>
          </More>
        </div>
      </Panel>
      {def !== undefined && <TemplateEditor template={def} edit={allowed(me, 'committee:full|settings:full')} />}
    </>
  );
}
