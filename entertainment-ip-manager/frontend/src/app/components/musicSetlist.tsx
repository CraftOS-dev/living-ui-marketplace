/**
 * Singing-stream setlist check (歌枠): for each song, the backing used, the
 * platform, archive and monetization, and whether it is arranged. The server
 * (music/setlist-check) answers per song: fine, live only (archive must be
 * private or cut) or blocked, with the reasons. Platform blanket licences
 * cover the composition only; the master or karaoke track needs its own
 * permission.
 */
import { useEffect, useMemo, useState } from 'react';
import { ListMusic, Plus, Trash2 } from 'lucide-react';
import { Button, Input, Select } from '../../kit/index.ts';
import { opToast } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { bi, t, tn } from '../lib/i18n.ts';
import { LEVEL_TONE } from '../lib/labels.ts';
import type { Tone } from '../lib/labels.ts';
import { href } from '../lib/router.ts';
import type { SongRec } from '../lib/records.ts';
import type { Bi } from '../lib/shapes.ts';
import { CatalogSelect, RecordPicker } from './pickers.tsx';
import { Checkbox, Dot, EmptyHint, Field, Notice, Pill, Section, TONE_TEXT } from './ui.tsx';
import { PLATFORMS, platformLabel } from './musicShared.tsx';

type Backing = 'own' | 'commissioned' | 'licensed_karaoke' | 'commercial_master' | 'a_cappella';
const BACKINGS: Backing[] = ['own', 'commissioned', 'licensed_karaoke', 'commercial_master', 'a_cappella'];

function backingLabel(b: Backing): string {
  switch (b) {
    case 'own':
      return t('Our own backing track');
    case 'commissioned':
      return t('Commissioned backing track');
    case 'licensed_karaoke':
      return t('Licensed karaoke track');
    case 'commercial_master':
      return t('Commercial recording (master)');
    case 'a_cappella':
      return t('A cappella');
  }
}

interface Item {
  key: string;
  song: string;
  title: string;
  backing: Backing;
  platform: string;
  archive: boolean;
  monetized: boolean;
  arranged: boolean;
  foreign: boolean;
  company_channel: boolean;
  talent: string;
}

interface Defaults {
  platform: string;
  archive: boolean;
  monetized: boolean;
  company_channel: boolean;
  talent: string;
}

type Verdict = 'ok' | 'live_only' | 'blocked';

interface ResultItem {
  song: string;
  title: string;
  verdict: Verdict;
  reasons: { level: 'ok' | 'info' | 'warn' | 'block'; text: Bi }[];
}

interface CheckResponse {
  items: ResultItem[];
  blanket_platforms: string[];
}

const VERDICT_TONE: Record<Verdict, Tone> = { ok: 'good', live_only: 'warn', blocked: 'bad' };

function verdictText(v: Verdict): string {
  return v === 'ok' ? t('OK') : v === 'live_only' ? t('Live only') : t('Blocked|setlist');
}

const STORE = 'eipm.music.setlist';

function loadDraft(): { items: Item[]; defaults: Defaults } | null {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw === null) return null;
    const v = JSON.parse(raw) as { items?: Item[]; defaults?: Defaults };
    if (!Array.isArray(v.items) || v.defaults === undefined) return null;
    return { items: v.items, defaults: v.defaults };
  } catch {
    return null;
  }
}

function saveDraft(items: Item[], defaults: Defaults): void {
  try {
    localStorage.setItem(STORE, JSON.stringify({ items, defaults }));
  } catch {
    /* storage unavailable: the setlist simply is not remembered */
  }
}

let seq = 0;
function newKey(): string {
  seq += 1;
  return `${Date.now().toString(36)}-${seq}`;
}

export function SetlistCheck(): React.JSX.Element {
  const { on } = useApp();
  const draft = useMemo(loadDraft, []);
  const [defaults, setDefaults] = useState<Defaults>(draft?.defaults ?? { platform: 'YOUTUBE', archive: true, monetized: true, company_channel: true, talent: '' });
  const [items, setItems] = useState<Item[]>(draft?.items ?? []);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ sig: string; data: CheckResponse } | null>(null);
  const sig = JSON.stringify(items);

  useEffect(() => saveDraft(items, defaults), [items, defaults]);

  const add = (song: string, title: string): void => {
    setItems((list) => [
      ...list,
      { key: newKey(), song, title, backing: 'own', platform: defaults.platform, archive: defaults.archive, monetized: defaults.monetized, arranged: false, foreign: false, company_channel: defaults.company_channel, talent: defaults.talent },
    ]);
  };
  const set = (key: string, patch: Partial<Item>): void => setItems((list) => list.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const applyAll = (): void =>
    setItems((list) => list.map((x) => ({ ...x, platform: defaults.platform, archive: defaults.archive, monetized: defaults.monetized, company_channel: defaults.company_channel, talent: defaults.talent })));

  const run = async (): Promise<void> => {
    setBusy(true);
    const body = items.map((x) => {
      const o: Record<string, unknown> = {
        backing: x.backing,
        platform: x.platform,
        archive: x.archive,
        monetized: x.monetized,
        arranged: x.arranged,
        foreign: x.foreign,
        company_channel: x.company_channel,
      };
      if (x.song !== '') o['song'] = x.song;
      else o['title'] = x.title;
      if (x.talent !== '') o['talent'] = x.talent;
      return o;
    });
    const r = await opToast<CheckResponse>('music/setlist-check', { items: body });
    setBusy(false);
    if (r !== null) setResult({ sig, data: r });
  };

  const current = result !== null && result.sig === sig ? result.data : null;
  const counts = current === null ? null : { ok: current.items.filter((x) => x.verdict === 'ok').length, live: current.items.filter((x) => x.verdict === 'live_only').length, blocked: current.items.filter((x) => x.verdict === 'blocked').length };
  const platformOptions = PLATFORMS.map((p) => ({ value: p, label: platformLabel(p) }));

  return (
    <div className="flex flex-col gap-4">
      <Notice tone="info">
        {t(
          'Platform blanket licences (JASRAC, NexTone) cover the composition only, for user uploads and streams. Singing over a commercial recording or a karaoke track needs the master owner\'s permission as well, and that permission is often for live streams only.',
        )}
      </Notice>

      <Section title={t('Stream settings')}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t('Platform')}>
            <Select value={defaults.platform} options={platformOptions} onChange={(e) => setDefaults((d) => ({ ...d, platform: e.target.value }))} />
          </Field>
          {on('talents') && (
            <Field label={t('Talent')}>
              <CatalogSelect kind="talent" value={defaults.talent} onChange={(v) => setDefaults((d) => ({ ...d, talent: v }))} />
            </Field>
          )}
          <div className="flex flex-col gap-2 sm:col-span-2 lg:col-span-2">
            <Checkbox checked={defaults.archive} onChange={(v) => setDefaults((d) => ({ ...d, archive: v }))} label={t('Keep the archive public')} />
            <Checkbox checked={defaults.monetized} onChange={(v) => setDefaults((d) => ({ ...d, monetized: v }))} label={t('Monetized (ads, Super Chat, memberships)')} />
            <Checkbox checked={defaults.company_channel} onChange={(v) => setDefaults((d) => ({ ...d, company_channel: v }))} label={t('Company channel')} />
          </div>
        </div>
        {items.length > 0 && (
          <div className="mt-3">
            <Button size="sm" variant="outline" onClick={applyAll}>
              {t('Apply to every song')}
            </Button>
          </div>
        )}
      </Section>

      <Section
        title={t('Setlist')}
        meta={items.length ? String(items.length) : undefined}
        actions={
          items.length > 0 ? (
            <Button size="sm" variant="ghost" onClick={() => setItems([])}>
              {t('Clear setlist')}
            </Button>
          ) : undefined
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <RecordPicker<SongRec>
            collection="songs"
            label={t('Add a song from the catalogue')}
            value=""
            allowClear={false}
            onChange={(id, r) => {
              if (id !== '') add(id, r?.title ?? '');
            }}
            labelOf={(s) => s.title}
            searchFields={['title', 'iswc', 'names']}
          />
          <div className="flex items-end gap-2">
            <Input
              label={t('Or type a title')}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && typed.trim() !== '') {
                  add('', typed.trim());
                  setTyped('');
                }
              }}
              placeholder={t('A song not in the catalogue')}
            />
            <Button
              variant="outline"
              disabled={typed.trim() === ''}
              onClick={() => {
                add('', typed.trim());
                setTyped('');
              }}
            >
              <Plus size={13} aria-hidden /> {t('Add')}
            </Button>
          </div>
        </div>

        {items.length === 0 ? (
          <EmptyHint icon={ListMusic} title={t('No songs in the setlist')} message={t('Add the songs planned for the stream, then check them before going live.')} compact />
        ) : (
          <ol className="mt-4 flex flex-col gap-3">
            {items.map((x, i) => {
              const res = current?.items[i];
              return (
                <li key={x.key} className="border border-[var(--agent-app-border)]">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--agent-app-border)]/70 px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="text-xs tabular-nums text-[var(--agent-app-muted)]">{i + 1}</span>
                      {x.song !== '' ? (
                        <a className="min-w-0 break-words text-sm font-medium hover:underline" href={href('song', x.song)}>
                          {x.title || t('Open song')}
                        </a>
                      ) : (
                        <span className="min-w-0 break-words text-sm font-medium">{x.title}</span>
                      )}
                      {x.song === '' && <span className="text-xs text-[var(--agent-app-muted)]">{t('(not in the catalogue)')}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      {res !== undefined && <Pill tone={VERDICT_TONE[res.verdict]}>{verdictText(res.verdict)}</Pill>}
                      <Button size="icon" variant="ghost" className="size-8" aria-label={t('Remove')} onClick={() => setItems((list) => list.filter((y) => y.key !== x.key))}>
                        <Trash2 size={13} aria-hidden />
                      </Button>
                    </div>
                  </div>
                  <div className="grid gap-3 px-3 py-2 sm:grid-cols-2 lg:grid-cols-3">
                    <Field label={t('Backing')}>
                      <Select value={x.backing} options={BACKINGS.map((b) => ({ value: b, label: backingLabel(b) }))} onChange={(e) => set(x.key, { backing: e.target.value as Backing })} />
                    </Field>
                    <Field label={t('Platform')}>
                      <Select value={x.platform} options={platformOptions} onChange={(e) => set(x.key, { platform: e.target.value })} />
                    </Field>
                    {on('talents') && (
                      <Field label={t('Talent')}>
                        <CatalogSelect kind="talent" value={x.talent} onChange={(v) => set(x.key, { talent: v })} />
                      </Field>
                    )}
                    <div className="flex flex-wrap gap-x-4 gap-y-1.5 sm:col-span-2 lg:col-span-3">
                      <Checkbox checked={x.archive} onChange={(v) => set(x.key, { archive: v })} label={t('Archive public')} />
                      <Checkbox checked={x.monetized} onChange={(v) => set(x.key, { monetized: v })} label={t('Monetized')} />
                      <Checkbox checked={x.arranged} onChange={(v) => set(x.key, { arranged: v })} label={t('Arranged or lyrics changed')} />
                      <Checkbox checked={x.foreign} onChange={(v) => set(x.key, { foreign: v })} label={t('Foreign work')} />
                      <Checkbox checked={x.company_channel} onChange={(v) => set(x.key, { company_channel: v })} label={t('Company channel')} />
                    </div>
                  </div>
                  {res !== undefined && res.reasons.length > 0 && (
                    <ul className="flex flex-col gap-1 border-t border-[var(--agent-app-border)]/70 px-3 py-2">
                      {res.reasons.map((r, j) => {
                        const tone = LEVEL_TONE[r.level] ?? 'neutral';
                        return (
                          <li key={j} className="flex items-start gap-2 text-[13px] leading-relaxed">
                            <Dot tone={tone} className="mt-[7px]" />
                            <span className={tone === 'bad' ? TONE_TEXT.bad : undefined}>{bi(r.text)}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
        )}

        {items.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button onClick={() => void run()} loading={busy}>
              {t('Check the setlist')}
            </Button>
            {counts !== null && (
              <span className="flex flex-wrap gap-2">
                <Pill tone="good">{tn(counts.ok, '{n} song OK', '{n} songs OK')}</Pill>
                {counts.live > 0 && <Pill tone="warn">{tn(counts.live, '{n} song live only', '{n} songs live only')}</Pill>}
                {counts.blocked > 0 && <Pill tone="bad">{tn(counts.blocked, '{n} song blocked', '{n} songs blocked')}</Pill>}
              </span>
            )}
            {result !== null && current === null && <span className="text-xs text-[var(--agent-app-muted)]">{t('The setlist changed. Check it again.')}</span>}
          </div>
        )}
      </Section>

      {current !== null && (
        <Section title={t('Platforms with a blanket licence')}>
          <div className="flex flex-wrap gap-1.5">
            {current.blanket_platforms.map((p) => (
              <Pill key={p} tone="good">
                {platformLabel(p)}
              </Pill>
            ))}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-[var(--agent-app-muted)]">
            {t('These platforms hold a JASRAC and NexTone licence for the composition. X has none: songs on X need their own licence. The licence never covers the master or a karaoke track.')}
          </p>
          {on('permissions') && (
            <p className="mt-2 text-xs">
              <a className="text-[var(--agent-app-accent)] hover:underline" href={href('permissions')}>
                {t('Master and karaoke permissions are kept in Third-party permissions')}
              </a>
            </p>
          )}
        </Section>
      )}
    </div>
  );
}
