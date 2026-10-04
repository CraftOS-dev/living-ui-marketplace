/**
 * Characters: every character the organization owns or licenses, found by
 * any spelling (Japanese, kana, romaji, English, Chinese, Korean), with kind,
 * franchise, status and who plays them now.
 */
import { useMemo, useState } from 'react';
import { Plus, Search, UserRound } from 'lucide-react';
import { Button, Card, Input, Select } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { useApp } from '../lib/context.tsx';
import { enumLabel, enumOptions, joinList, t } from '../lib/i18n.ts';
import { href, navigate, useHashParam } from '../lib/router.ts';
import type { CastingRec, CharacterRec } from '../lib/records.ts';
import { CharacterForm } from '../components/ipCharacterForm.tsx';
import { Thumb, altName, isCurrentCasting, matchesTerm, namesText } from '../components/ipShared.tsx';
import { EmptyHint, EnumPill, ErrorBox, Loading, PageHeader, Tag, Toolbar } from '../components/ui.tsx';

export function CharactersPage(): React.JSX.Element {
  const { can, on, franchises, nameOf } = useApp();
  const list = useCollection<CharacterRec>('characters', { sort: 'name' });
  const castings = useCollection<CastingRec>('castings', { sort: '-start_date' });
  const [term, setTerm] = useHashParam('q', '');
  const [kind, setKind] = useHashParam('kind', '');
  const [status, setStatus] = useHashParam('status', '');
  const [franchise, setFranchise] = useHashParam('franchise', '');
  const [creating, setCreating] = useState(false);

  const performers = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of castings.records) {
      if (!isCurrentCasting(c)) continue;
      const name = nameOf('talent', c.talent);
      if (name === '') continue;
      const arr = m.get(c.character) ?? [];
      if (!arr.includes(name)) arr.push(name);
      m.set(c.character, arr);
    }
    return m;
  }, [castings.records, nameOf]);

  const useFranchise = on('franchises');
  const filtering = term.trim() !== '' || kind !== '' || status !== '' || (useFranchise && franchise !== '');
  const rows = list.records.filter(
    (c) =>
      (kind === '' || c.kind === kind) &&
      (status === '' || c.status === status) &&
      (!useFranchise || franchise === '' || c.franchise === franchise) &&
      matchesTerm(term, c.name, namesText(c.names), (c.tags ?? []).join(' '), (performers.get(c.id) ?? []).join(' ')),
  );

  const usedFranchises = useMemo(() => {
    const ids = new Set(list.records.map((c) => c.franchise).filter((x) => x !== ''));
    return franchises.filter((f) => ids.has(f.id)).map((f) => ({ value: f.id, label: f.name }));
  }, [list.records, franchises]);

  const clear = (): void => {
    setTerm('');
    setKind('');
    setStatus('');
    setFranchise('');
  };

  const create = can.edit ? (
    <Button onClick={() => setCreating(true)}>
      <Plus size={15} aria-hidden /> {t('New character')}
    </Button>
  ) : undefined;

  return (
    <div>
      <PageHeader
        title={t('Characters')}
        meta={list.records.length > 0 ? String(list.records.length) : undefined}
        subtitle={t('Each character is a stack of separately owned layers. Open one to see who made each layer, how we hold it, and what is wrong.')}
        actions={create}
      />

      {list.loading && list.records.length === 0 ? (
        <Loading />
      ) : list.error !== null && list.records.length === 0 ? (
        <ErrorBox message={list.error} onRetry={list.refresh} />
      ) : list.records.length === 0 ? (
        <Card>
          <EmptyHint
            icon={UserRound}
            title={t('No characters yet')}
            message={t('Add a character to record its rights stack, performers, trademarks and the products that use it.')}
            action={create}
          />
        </Card>
      ) : (
        <>
          <Toolbar>
            <div className="relative w-full sm:w-64">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 z-10 -translate-y-1/2 text-[var(--agent-app-muted)]" aria-hidden />
              <Input aria-label={t('Search characters')} placeholder={t('Search names in any script')} value={term} onChange={(e) => setTerm(e.target.value)} className="pl-8" />
            </div>
            <div className="w-[calc(50%-0.25rem)] sm:w-44">
              <Select aria-label={t('Kind')} value={kind} placeholder={t('All kinds')} options={enumOptions('characters.kind').map(([value, label]) => ({ value, label }))} onChange={(e) => setKind(e.target.value)} />
            </div>
            <div className="w-[calc(50%-0.25rem)] sm:w-40">
              <Select aria-label={t('Status')} value={status} placeholder={t('All statuses')} options={enumOptions('characters.status').map(([value, label]) => ({ value, label }))} onChange={(e) => setStatus(e.target.value)} />
            </div>
            {useFranchise && usedFranchises.length > 0 && (
              <div className="w-full sm:w-48">
                <Select aria-label={t('Franchise')} value={franchise} placeholder={t('All franchises')} options={usedFranchises} onChange={(e) => setFranchise(e.target.value)} />
              </div>
            )}
            {filtering && (
              <Button size="sm" variant="ghost" onClick={clear}>
                {t('Clear filters')}
              </Button>
            )}
          </Toolbar>

          {rows.length === 0 ? (
            <Card>
              <EmptyHint
                compact
                icon={Search}
                title={t('Nothing matches these filters')}
                message={t('Try another search term, or clear the filters.')}
                action={
                  <Button size="sm" variant="outline" onClick={clear}>
                    {t('Clear filters')}
                  </Button>
                }
              />
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {rows.map((c) => {
                const alt = altName(c.names, c.name);
                const who = performers.get(c.id) ?? [];
                return (
                  <a
                    key={c.id}
                    href={href('character', c.id)}
                    className="flex min-w-0 gap-3 border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] p-3 transition-colors hover:border-[var(--agent-app-accent)]/50"
                  >
                    <Thumb record={c} image={c.image} name={c.name} size="lg" />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold">{c.name}</div>
                          {alt !== '' && <div className="truncate text-xs text-[var(--agent-app-muted)]">{alt}</div>}
                        </div>
                        <EnumPill field="characters.status" value={c.status} className="shrink-0" />
                      </div>
                      <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-[var(--agent-app-muted)]">
                        {c.kind !== '' && <Tag>{enumLabel('characters.kind', c.kind)}</Tag>}
                        {useFranchise && c.franchise !== '' && <span className="min-w-0 truncate">{nameOf('franchise', c.franchise)}</span>}
                      </div>
                      {who.length > 0 && <div className="mt-1 truncate text-xs">{t('Played by {names}', { names: joinList(who) })}</div>}
                    </div>
                  </a>
                );
              })}
            </div>
          )}
        </>
      )}

      {creating && (
        <CharacterForm
          character={null}
          defaults={{ franchise: useFranchise ? franchise : '', kind: kind as CharacterRec['kind'] }}
          onClose={() => setCreating(false)}
          onSaved={(c) => navigate('character', c.id)}
        />
      )}
    </div>
  );
}
