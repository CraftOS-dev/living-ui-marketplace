/**
 * Settings, Sourcing: the User-Agent SEC EDGAR sees (the firm and a contact
 * email, as SEC's fair-access rules ask) and how many items each keyless
 * source gives a radar per pull. Saved in settings.modules.markets.
 */
import { useEffect, useState } from 'react';
import { Button, ChipPicker, Field, Input, LoadError, More, Panel, Skeleton, SubHeader } from '../ui.tsx';
import { op } from '../../lib/api.ts';
import { allowed, useMe } from '../../lib/auth.ts';
import { act, useOp } from '../../lib/live.ts';
import type { Options } from './types.ts';

interface Markets {
  user_agent: string;
  edgar_limit: number;
  hn_limit: number;
  github_limit: number;
}

const EDGAR = ['10', '25', '50', '100'] as const;
const SMALL = ['10', '30', '50'] as const;

export function SourcingSettings(): React.JSX.Element {
  const me = useMe();
  const live = useOp<{ modules?: Record<string, Partial<Markets>> }>('settings.get', {}, ['settings'], { name: 'settings.get' });
  const opts = useOp<Options>('radars.options', {}, ['settings'], { name: 'radars.options' });
  const [draft, setDraft] = useState<Markets | null>(null);
  const [busy, setBusy] = useState(false);
  const saved: Markets | null = live.data === null ? null : { user_agent: '', edgar_limit: 25, hn_limit: 30, github_limit: 30, ...(live.data.modules?.['markets'] ?? {}) };
  useEffect(() => {
    if (saved !== null && draft === null) setDraft(saved);
  }, [saved, draft]);
  const edit = allowed(me, 'settings:full');
  if (saved === null || draft === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Skeleton className="h-40 w-full" />;
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const save = async (): Promise<void> => {
    setBusy(true);
    await act([], () => op('settings.update', { modules: { markets: { ...draft, user_agent: draft.user_agent.trim() } } }), ['settings']);
    setBusy(false);
  };
  const pick = (k: 'edgar_limit' | 'hn_limit' | 'github_limit', v: string): void => setDraft({ ...draft, [k]: Number(v) });
  return (
    <>
      <SubHeader title="Sourcing">
        {edit && (
          <Button variant="primary" busy={busy} disabled={!dirty} onClick={() => void save()}>
            Save
          </Button>
        )}
      </SubHeader>
      <Panel>
        <div className="grid max-w-[560px] gap-4">
          <Field label="EDGAR User-Agent" tip="SEC asks every request to name the firm and a contact email. Empty: the firm name and the owner's email.">
            <Input value={draft.user_agent} disabled={!edit} maxLength={200} placeholder={opts.data?.user_agent ?? ''} onChange={(e) => setDraft({ ...draft, user_agent: e.target.value })} aria-label="EDGAR User-Agent" />
          </Field>
          <Field label="Form D per pull" tip="Filings read each time a radar pulls (every 15 minutes and at its run), at most 8 requests a second.">
            <ChipPicker label="Form D per pull" value={String(draft.edgar_limit) as (typeof EDGAR)[number]} options={EDGAR.map((v) => ({ value: v, label: v }))} onChange={(v) => edit && pick('edgar_limit', v)} />
          </Field>
          <More>
            <Field label="Show HN per pull">
              <ChipPicker label="Show HN per pull" value={String(draft.hn_limit) as (typeof SMALL)[number]} options={SMALL.map((v) => ({ value: v, label: v }))} onChange={(v) => edit && pick('hn_limit', v)} />
            </Field>
            <Field label="GitHub per run">
              <ChipPicker label="GitHub per run" value={String(draft.github_limit) as (typeof SMALL)[number]} options={SMALL.map((v) => ({ value: v, label: v }))} onChange={(v) => edit && pick('github_limit', v)} />
            </Field>
          </More>
        </div>
      </Panel>
    </>
  );
}
