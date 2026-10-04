/**
 * Castings: who voices or performs a character, from when to when. Seen
 * from a character (its performers) or from a talent (the characters they
 * play). Ending a casting sets its end date; a recast ends one casting and
 * adds the next in one step. Performers appear by stage name only.
 */
import { useState } from 'react';
import { Pencil, Repeat, Square, UserRound } from 'lucide-react';
import { Button, Dialog, Input, Select, Textarea, toast } from '../../kit/index.ts';
import { createRecord, op, q, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { useCollection } from '../lib/live.ts';
import { addDays, d10, fmtDate, toPb, today } from '../lib/format.ts';
import { enumLabel, enumOptions, t } from '../lib/i18n.ts';
import { href } from '../lib/router.ts';
import type { CastingRec } from '../lib/records.ts';
import { DeleteButton } from './deleteRecord.tsx';
import { CatalogSelect } from './pickers.tsx';
import { DateField, isCurrentCasting, spanText } from './ipShared.tsx';
import { EmptyHint, ErrorBox, GroupHeader, ListRow, Loading, Section, Tag } from './ui.tsx';

type Mode = { character: string } | { talent: string };

export function CastingsSection({ mode }: { mode: Mode }): React.JSX.Element {
  const { can, nameOf, on } = useApp();
  const byCharacter = 'character' in mode;
  const filter = byCharacter ? `character = ${q(mode.character)}` : `talent = ${q(mode.talent)}`;
  const list = useCollection<CastingRec>('castings', { filter, sort: '-start_date,-created' });
  const [dlg, setDlg] = useState<{ kind: 'edit'; casting: CastingRec | null } | { kind: 'end'; casting: CastingRec } | { kind: 'recast'; casting: CastingRec } | null>(null);

  const current = list.records.filter((c) => isCurrentCasting(c));
  const past = list.records.filter((c) => !isCurrentCasting(c));

  const row = (c: CastingRec): React.JSX.Element => {
    const otherName = byCharacter ? nameOf('talent', c.talent) : nameOf('character', c.character);
    const link = byCharacter ? (on('talents') ? href('talent', c.talent) : '') : href('character', c.character);
    const started = d10(c.start_date);
    const when = isCurrentCasting(c) ? (started !== '' ? t('Since {date}', { date: fmtDate(started) }) : t('Current|casting')) : spanText(c.start_date, c.end_date);
    return (
      <ListRow
        key={c.id}
        leading={<Tag>{enumLabel('castings.role', c.role)}</Tag>}
        primary={
          link !== '' ? (
            <a href={link} className="hover:underline">
              {otherName || t('Unknown')}
            </a>
          ) : (
            otherName || t('Unknown')
          )
        }
        secondary={[c.credit_name !== '' ? t('Credited as {name}', { name: c.credit_name }) : '', when].filter((x) => x !== '').join(' · ')}
        trailing={
          can.edit ? (
            <span className="flex items-center gap-1">
              {isCurrentCasting(c) && byCharacter && (
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setDlg({ kind: 'recast', casting: c })} title={t('End this casting and add the next performer')}>
                  <Repeat size={13} aria-hidden /> <span className="hidden sm:inline">{t('Recast|casting')}</span>
                </Button>
              )}
              {isCurrentCasting(c) && (
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setDlg({ kind: 'end', casting: c })}>
                  <Square size={12} aria-hidden /> <span className="hidden sm:inline">{t('End|casting')}</span>
                </Button>
              )}
              <Button size="icon" variant="ghost" className="size-7" aria-label={t('Edit')} onClick={() => setDlg({ kind: 'edit', casting: c })}>
                <Pencil size={13} aria-hidden />
              </Button>
              <DeleteButton collection="castings" id={c.id} iconOnly />
            </span>
          ) : undefined
        }
      />
    );
  };

  const add = can.edit ? (
    <Button size="sm" variant="outline" onClick={() => setDlg({ kind: 'edit', casting: null })}>
      {byCharacter ? t('Add performer|casting') : t('Add character')}
    </Button>
  ) : undefined;

  return (
    <Section title={byCharacter ? t('Castings') : t('Characters')} meta={list.records.length > 0 ? String(list.records.length) : undefined} actions={add} flush>
      {list.loading && list.records.length === 0 ? (
        <Loading />
      ) : list.error !== null && list.records.length === 0 ? (
        <div className="p-4">
          <ErrorBox message={list.error} onRetry={list.refresh} />
        </div>
      ) : list.records.length === 0 ? (
        <EmptyHint
          compact
          icon={UserRound}
          title={byCharacter ? t('No performers yet|casting') : t('No characters yet')}
          message={byCharacter ? t('Record who voices or performs this character and since when. A recast ends one casting and adds the next.') : t('Record the characters this talent voices or performs.')}
          action={add}
        />
      ) : (
        <>
          {current.length > 0 && <GroupHeader label={t('Current|casting')} count={current.length} />}
          {current.map(row)}
          {past.length > 0 && <GroupHeader label={t('Past and future')} count={past.length} />}
          {past.map(row)}
        </>
      )}
      {dlg !== null && dlg.kind === 'edit' && <CastingDialog casting={dlg.casting} mode={mode} onClose={() => setDlg(null)} />}
      {dlg !== null && dlg.kind === 'end' && <EndCastingDialog casting={dlg.casting} onClose={() => setDlg(null)} />}
      {dlg !== null && dlg.kind === 'recast' && <RecastDialog casting={dlg.casting} onClose={() => setDlg(null)} />}
    </Section>
  );
}

function roleOptions(): { value: string; label: string }[] {
  return enumOptions('castings.role').map(([value, label]) => ({ value, label }));
}

function CastingDialog({ casting, mode, onClose }: { casting: CastingRec | null; mode: Mode; onClose: () => void }): React.JSX.Element {
  const [character, setCharacter] = useState(casting?.character ?? ('character' in mode ? mode.character : ''));
  const [talent, setTalent] = useState(casting?.talent ?? ('talent' in mode ? mode.talent : ''));
  const [role, setRole] = useState<string>(casting?.role ?? 'voice');
  const [start, setStart] = useState(d10(casting?.start_date));
  const [end, setEnd] = useState(d10(casting?.end_date));
  const [credit, setCredit] = useState(casting?.credit_name ?? '');
  const [notes, setNotes] = useState(casting?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (): Promise<void> => {
    if (character === '' || talent === '') {
      setError(t('Choose the character and the talent.'));
      return;
    }
    if (start !== '' && end !== '' && end < start) {
      setError(t('The end date is before the start date.'));
      return;
    }
    setBusy(true);
    const data = { character, talent, role, start_date: toPb(start), end_date: toPb(end), credit_name: credit.trim(), notes: notes.trim() };
    try {
      if (casting === null) await createRecord('castings', data);
      else await updateRecord('castings', casting.id, data);
      toast.success(casting === null ? t('Casting added') : t('Saved'));
      onClose();
    } catch {
      /* the client already showed the error */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={casting === null ? t('Add casting') : t('Edit casting')}
      description={t('Performers are recorded by stage name. Legal identities stay in the talent identity record.')}
      className="w-[min(94vw,36rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void submit()} loading={busy}>
            {casting === null ? t('Add casting') : t('Save changes')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          {!('character' in mode) || casting !== null ? <CatalogSelect kind="character" label={t('Character')} value={character} onChange={setCharacter} placeholder={t('Choose')} /> : null}
          {!('talent' in mode) || casting !== null ? <CatalogSelect kind="talent" label={t('Talent')} value={talent} onChange={setTalent} placeholder={t('Choose')} /> : null}
          <Select label={t('Role|casting')} value={role} options={roleOptions()} onChange={(e) => setRole(e.target.value)} />
          <Input label={t('Credit name')} value={credit} onChange={(e) => setCredit(e.target.value)} placeholder={t('As shown in credits')} />
          <DateField label={t('From')} value={start} onChange={setStart} />
          <DateField label={t('To')} value={end} onChange={setEnd} help={t('Leave empty while the casting runs.')} />
        </div>
        <Textarea label={t('Notes')} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        {error !== '' && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </Dialog>
  );
}

function EndCastingDialog({ casting, onClose }: { casting: CastingRec; onClose: () => void }): React.JSX.Element {
  const { nameOf } = useApp();
  const [end, setEnd] = useState(today());
  const [busy, setBusy] = useState(false);
  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      await updateRecord('castings', casting.id, { end_date: toPb(end) });
      toast.success(t('Casting ended'));
      onClose();
    } catch {
      /* the client already showed the error */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('End casting')}
      description={t('{talent} as {character}: the casting stays in the history with this last day.', { talent: nameOf('talent', casting.talent), character: nameOf('character', casting.character) })}
      className="w-[min(94vw,28rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={end === ''}>
            {t('End casting')}
          </Button>
        </>
      }
    >
      <DateField label={t('Last day')} value={end} onChange={setEnd} />
    </Dialog>
  );
}

function RecastDialog({ casting, onClose }: { casting: CastingRec; onClose: () => void }): React.JSX.Element {
  const { nameOf } = useApp();
  const [end, setEnd] = useState(today());
  const [talent, setTalent] = useState('');
  const [role, setRole] = useState<string>(casting.role || 'voice');
  const [start, setStart] = useState(addDays(today(), 1));
  const [credit, setCredit] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (): Promise<void> => {
    if (talent === '') {
      setError(t('Choose the new performer.'));
      return;
    }
    if (end === '' || start === '') {
      setError(t('Enter both dates.'));
      return;
    }
    setBusy(true);
    try {
      await updateRecord('castings', casting.id, { end_date: toPb(end) });
      await createRecord('castings', { character: casting.character, talent, role, start_date: toPb(start), credit_name: credit.trim() });
      // The recast also goes into the character's history.
      await op('events/record', { subject_type: 'character', subject_id: casting.character, code: 'RECAST', date: start, select: [] });
      toast.success(t('Recast recorded'));
      onClose();
    } catch {
      /* the client already showed the error */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('Recast {character}', { character: nameOf('character', casting.character) })}
      description={t('Ends the current casting of {talent} and adds the next performer.', { talent: nameOf('talent', casting.talent) })}
      className="w-[min(94vw,36rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void submit()} loading={busy}>
            {t('Record recast')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <DateField label={t('Last day of {talent}', { talent: nameOf('talent', casting.talent) })} value={end} onChange={(v) => {
          setEnd(v);
          if (v !== '') setStart(addDays(v, 1));
        }} />
        <div className="grid gap-3 sm:grid-cols-2">
          <CatalogSelect kind="talent" label={t('New performer')} value={talent} onChange={setTalent} placeholder={t('Choose')} filter={(id) => id !== casting.talent} />
          <Select label={t('Role|casting')} value={role} options={roleOptions()} onChange={(e) => setRole(e.target.value)} />
          <DateField label={t('First day')} value={start} onChange={setStart} />
          <Input label={t('Credit name')} value={credit} onChange={(e) => setCredit(e.target.value)} placeholder={t('As shown in credits')} />
        </div>
        {error !== '' && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </Dialog>
  );
}
