/**
 * Credits on a song or recording (involvements): writers with their shares
 * per right category on a song, performers (singers, players, producers) on
 * a recording. Shares are edited in a small table and saved together.
 */
import { useMemo, useState } from 'react';
import { Mic2, PenLine, Pencil, Plus } from 'lucide-react';
import { Button, Dialog, Input, Select, Textarea, toast } from '../../kit/index.ts';
import { createRecord, updateRecord } from '../lib/api.ts';
import { DeleteButton } from './deleteRecord.tsx';
import { useApp } from '../lib/context.tsx';
import { useCollection } from '../lib/live.ts';
import { bi, enumLabel, t } from '../lib/i18n.ts';
import { fmtPct } from '../lib/format.ts';
import { href } from '../lib/router.ts';
import type { InvolvementRec } from '../lib/records.ts';
import type { Bi } from '../lib/shapes.ts';
import { PartyPicker } from './pickers.tsx';
import { EmptyHint, Field, ListRow, Loading, Notice, Pill, Section } from './ui.tsx';
import {
  CheckRow,
  Dash,
  PERFORMER_ROLES,
  PctTotal,
  WRITER_CATEGORIES,
  WRITER_ROLES,
  num,
  partyOf,
  roleOptions,
  total,
  writerCategoryLabel,
  writerShares,
} from './musicShared.tsx';
import type { WriterCategory } from './musicShared.tsx';

export interface CompletenessItem {
  key: string;
  ok: boolean;
  text: Bi;
}

export interface CompletenessResult {
  score: number;
  items: CompletenessItem[];
}

type ShareText = Partial<Record<WriterCategory, string>>;

function sharesText(i: InvolvementRec): ShareText {
  const s = writerShares(i);
  const out: ShareText = {};
  for (const c of WRITER_CATEGORIES) {
    const v = s[c];
    if (v !== undefined) out[c] = String(v);
  }
  return out;
}

function sharesJson(v: ShareText): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of WRITER_CATEGORIES) {
    const x = v[c];
    if (x !== undefined && x.trim() !== '') out[c] = num(x);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Add or edit one credit                                              */
/* ------------------------------------------------------------------ */

export function CreditDialog({
  inv,
  song = '',
  recording = '',
  writer,
  onClose,
}: {
  inv: InvolvementRec | null;
  song?: string | undefined;
  recording?: string | undefined;
  /** Writers carry shares per category; performers carry the featured flag. */
  writer: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const roles: readonly string[] = writer ? WRITER_ROLES : PERFORMER_ROLES;
  const [party, setParty] = useState(inv?.party ?? '');
  const [role, setRole] = useState<string>(inv?.role || (writer ? 'composer' : 'singer'));
  const [credit, setCredit] = useState(inv?.credit_name ?? '');
  const [shares, setShares] = useState<ShareText>(() => (inv !== null ? sharesText(inv) : {}));
  const [featured, setFeatured] = useState(inv?.featured ?? false);
  const [note, setNote] = useState(inv?.note ?? '');
  const [busy, setBusy] = useState(false);
  const roleList = roles.includes(role) ? roles : [...roles, role];

  const save = async (): Promise<void> => {
    if (party === '') return;
    setBusy(true);
    const data: Record<string, unknown> = { party, role, credit_name: credit.trim(), note: note.trim() };
    if (writer) data['shares'] = sharesJson(shares);
    else data['featured'] = featured;
    try {
      if (inv === null) {
        if (song !== '') data['song'] = song;
        if (recording !== '') data['recording'] = recording;
        await createRecord('involvements', data);
        toast.success(t('Credit added'));
      } else {
        await updateRecord('involvements', inv.id, data);
        toast.success(t('Saved'));
      }
      onClose();
    } catch {
      /* the client shows the server's message */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={inv === null ? (writer ? t('Add writer') : t('Add performer')) : writer ? t('Edit writer') : t('Edit performer')}
      description={
        writer
          ? t('A composer, lyricist, arranger or music publisher, with their share of each right category in percent.')
          : t('A singer, player or producer on this recording. Performers hold neighbouring rights in their performance.')
      }
      className="max-h-[92vh] w-[min(94vw,36rem)] overflow-y-auto"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={party === ''}>
            {t('Save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <PartyPicker label={t('Person or company')} value={party} onChange={(id) => setParty(id)} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('Role|credit')}>
            <Select value={role} options={roleOptions(roleList)} onChange={(e) => setRole(e.target.value)} />
          </Field>
          <Field label={t('Credit name')} help={t('The name printed in the credits, if different (a pen name or stage name).')}>
            <Input value={credit} onChange={(e) => setCredit(e.target.value)} />
          </Field>
        </div>
        {writer ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {WRITER_CATEGORIES.map((c) => (
              <Field key={c} label={writerCategoryLabel(c)}>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={shares[c] ?? ''}
                  placeholder="%"
                  onChange={(e) => setShares((s) => ({ ...s, [c]: e.target.value }))}
                />
              </Field>
            ))}
          </div>
        ) : (
          <CheckRow checked={featured} onChange={setFeatured} label={t('Featured performer')} help={t('Named on the release (feat.). Featured singers are left out of instrumental versions.')} />
        )}
        <Field label={t('Note')}>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Writers of a song                                                   */
/* ------------------------------------------------------------------ */

export function WritersPanel({ songId, completeness }: { songId: string; completeness: CompletenessResult | null }): React.JSX.Element {
  const { can } = useApp();
  const list = useCollection<InvolvementRec>('involvements', { filter: `song = "${songId}"`, sort: 'created', expand: 'party' });
  const [edits, setEdits] = useState<Record<string, ShareText>>({});
  const [dialog, setDialog] = useState<{ inv: InvolvementRec | null } | null>(null);
  const [saving, setSaving] = useState(false);

  const current = (i: InvolvementRec): ShareText => edits[i.id] ?? sharesText(i);
  const dirty = Object.keys(edits).length > 0;
  const totals = useMemo(() => {
    const out: Partial<Record<WriterCategory, number | null>> = {};
    for (const c of WRITER_CATEGORIES) {
      const vals = list.records.map((i) => (edits[i.id] ?? sharesText(i))[c]).filter((v): v is string => v !== undefined && v.trim() !== '');
      out[c] = vals.length === 0 ? null : total(vals.map(num));
    }
    return out;
  }, [list.records, edits]);
  const sharesItem = completeness?.items.find((x) => x.key === 'shares');

  const saveShares = async (): Promise<void> => {
    setSaving(true);
    let ok = 0;
    for (const [id, v] of Object.entries(edits)) {
      try {
        await updateRecord('involvements', id, { shares: sharesJson(v) });
        ok += 1;
      } catch {
        /* the client shows the server's message */
      }
    }
    setSaving(false);
    setEdits({});
    if (ok > 0) toast.success(t('Shares saved'));
  };

  return (
    <div className="flex flex-col gap-4">
      {sharesItem !== undefined && !sharesItem.ok && <Notice tone="warn">{bi(sharesItem.text)}</Notice>}
      <Section
        title={t('Writers')}
        meta={list.records.length ? String(list.records.length) : undefined}
        flush
        actions={
          can.edit ? (
            <>
              {dirty && (
                <>
                  <Button size="sm" variant="ghost" onClick={() => setEdits({})}>
                    {t('Discard changes')}
                  </Button>
                  <Button size="sm" onClick={() => void saveShares()} loading={saving}>
                    {t('Save shares')}
                  </Button>
                </>
              )}
              <Button size="sm" variant="outline" onClick={() => setDialog({ inv: null })}>
                <Plus size={13} aria-hidden /> {t('Add writer')}
              </Button>
            </>
          ) : undefined
        }
      >
        {list.loading ? (
          <Loading />
        ) : list.records.length === 0 ? (
          <EmptyHint
            icon={PenLine}
            title={t('No writers yet')}
            message={t('Add the composer, lyricist, arranger and music publisher with their shares. Society registrations are filed from these.')}
            action={
              can.edit ? (
                <Button size="sm" onClick={() => setDialog({ inv: null })}>
                  <Plus size={13} aria-hidden /> {t('Add writer')}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-[var(--agent-app-border)] bg-[var(--agent-app-border)]/20 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">
                  <th className="px-3 py-2">{t('Writer')}</th>
                  <th className="px-3 py-2">{t('Role|credit')}</th>
                  {WRITER_CATEGORIES.map((c) => (
                    <th key={c} className="w-24 px-2 py-2 text-right">
                      {writerCategoryLabel(c)}
                    </th>
                  ))}
                  <th className="w-20 px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {list.records.map((i) => {
                  const v = current(i);
                  const p = partyOf(i);
                  return (
                    <tr key={i.id} className="border-b border-[var(--agent-app-border)]/60 last:border-0">
                      <td className="px-3 py-2 align-middle">
                        <a className="font-medium hover:underline" href={href('people', i.party)}>
                          {p?.name ?? t('Unnamed|party')}
                        </a>
                        {i.credit_name !== '' && i.credit_name !== p?.name && <div className="text-xs text-[var(--agent-app-muted)]">{t('Credited as {name}', { name: i.credit_name })}</div>}
                        {p !== undefined && (p.society !== '' || p.ipi !== '') && (
                          <div className="text-xs text-[var(--agent-app-muted)]">{[p.society, p.ipi !== '' ? t('IPI {ipi}', { ipi: p.ipi }) : ''].filter((x) => x !== '').join(' · ')}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 align-middle">{enumLabel('involvements.role', i.role)}</td>
                      {WRITER_CATEGORIES.map((c) => (
                        <td key={c} className="px-2 py-1.5 text-right align-middle tabular-nums">
                          {can.edit ? (
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step="0.01"
                              aria-label={`${writerCategoryLabel(c)}: ${p?.name ?? ''}`}
                              className="h-8 w-20 border border-[var(--agent-app-border)] bg-[var(--agent-app-surface-2)] px-2 text-right text-[13px] tabular-nums"
                              value={v[c] ?? ''}
                              onChange={(e) => setEdits((m) => ({ ...m, [i.id]: { ...current(i), [c]: e.target.value } }))}
                            />
                          ) : v[c] !== undefined ? (
                            fmtPct(num(v[c]))
                          ) : (
                            <Dash />
                          )}
                        </td>
                      ))}
                      <td className="px-2 py-1.5 text-right align-middle">
                        {can.edit && (
                          <span className="inline-flex gap-0.5">
                            <Button size="icon" variant="ghost" className="size-8" aria-label={t('Edit')} onClick={() => setDialog({ inv: i })}>
                              <Pencil size={13} aria-hidden />
                            </Button>
                            <DeleteButton collection="involvements" id={i.id} iconOnly className="size-8" label={t('Remove writer')} />
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-[var(--agent-app-border)] bg-[var(--agent-app-border)]/10">
                  <td className="px-3 py-2 text-xs font-semibold" colSpan={2}>
                    {t('Total')}
                  </td>
                  {WRITER_CATEGORIES.map((c) => {
                    const v = totals[c];
                    return (
                      <td key={c} className="px-2 py-2 text-right">
                        {v === null || v === undefined ? <Dash /> : <PctTotal value={v} />}
                      </td>
                    );
                  })}
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Section>
      <p className="text-xs leading-relaxed text-[var(--agent-app-muted)]">
        {t('Each right category must add to 100%. With JASRAC the music publisher takes at most 6/12 (50%) of performance income.')}
      </p>
      {dialog !== null && <CreditDialog inv={dialog.inv} song={songId} writer onClose={() => setDialog(null)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Performers on a recording                                           */
/* ------------------------------------------------------------------ */

export function PerformersPanel({ recordingId }: { recordingId: string }): React.JSX.Element {
  const { can } = useApp();
  const list = useCollection<InvolvementRec>('involvements', { filter: `recording = "${recordingId}"`, sort: 'created', expand: 'party' });
  const [dialog, setDialog] = useState<{ inv: InvolvementRec | null } | null>(null);

  return (
    <Section
      title={t('Performers and credits')}
      meta={list.records.length ? String(list.records.length) : undefined}
      flush
      actions={
        can.edit ? (
          <Button size="sm" variant="outline" onClick={() => setDialog({ inv: null })}>
            <Plus size={13} aria-hidden /> {t('Add performer')}
          </Button>
        ) : undefined
      }
    >
      {list.loading ? (
        <Loading />
      ) : list.records.length === 0 ? (
        <EmptyHint
          icon={Mic2}
          title={t('No performers yet')}
          message={t('Add the singers, players and producers. Performers and the record producer hold neighbouring rights for 70 years (Copyright Act art. 101).')}
          action={
            can.edit ? (
              <Button size="sm" onClick={() => setDialog({ inv: null })}>
                <Plus size={13} aria-hidden /> {t('Add performer')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        list.records.map((i) => {
          const p = partyOf(i);
          return (
            <ListRow
              key={i.id}
              primary={
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <a className="truncate hover:underline" href={href('people', i.party)}>
                    {p?.name ?? t('Unnamed|party')}
                  </a>
                  {i.featured && <Pill tone="accent">{t('Featured|credit')}</Pill>}
                </span>
              }
              secondary={[enumLabel('involvements.role', i.role), i.credit_name !== '' && i.credit_name !== p?.name ? t('Credited as {name}', { name: i.credit_name }) : '', i.note]
                .filter((x) => x !== '')
                .join(' · ')}
              hoverActions={
                can.edit ? (
                  <>
                    <Button size="icon" variant="ghost" className="size-8" aria-label={t('Edit')} onClick={() => setDialog({ inv: i })}>
                      <Pencil size={13} aria-hidden />
                    </Button>
                    <DeleteButton collection="involvements" id={i.id} iconOnly className="size-8" label={t('Remove performer')} />
                  </>
                ) : undefined
              }
            />
          );
        })
      )}
      {dialog !== null && <CreditDialog inv={dialog.inv} recording={recordingId} writer={false} onClose={() => setDialog(null)} />}
    </Section>
  );
}
