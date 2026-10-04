/**
 * Create or edit a work (film, series, episode, game, book, track,
 * character, logo...): what it is, where it sits in the tree, dates that
 * drive copyright deadlines and term, identifiers and authorship.
 */
import { useMemo, useState } from 'react';
import { Button, Dialog, Input, Select, Switch, TagInput, Textarea, toast } from '../../kit/index.ts';
import { createRecord, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { d10, toPb } from '../lib/format.ts';
import { WORK_TYPE_LABEL } from '../lib/labels.ts';
import type { WorkRec, WorkType } from '../lib/types.ts';
import { JurisdictionSelect, RecordPicker } from './pickers.tsx';
import {
  AUTHOR_KIND_LABEL,
  DateField,
  ImageField,
  RIGHTS_BASIS_HELP,
  RIGHTS_BASIS_LABEL,
  WORK_STATUS_LABEL,
  options,
} from './catalogShared.tsx';
import type { RightsBasis } from './catalogShared.tsx';
import { Field } from './ui.tsx';

const PUBLICATION_HELP =
  'Publishing in the US starts a 3-month window to register for full remedies (17 U.S.C. 412); IP Manager adds that reminder automatically.';

export interface WorkDefaults {
  property?: string | undefined;
  parent?: string | undefined;
  work_type?: WorkType | undefined;
}

function SubHeading({ children }: { children: string }): React.JSX.Element {
  return <h3 className="border-b border-[var(--agent-app-border)] pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">{children}</h3>;
}

export function WorkForm({
  work,
  defaults,
  exclude = [],
  onClose,
  onSaved,
}: {
  work: WorkRec | null;
  defaults?: WorkDefaults | undefined;
  /** Work ids that cannot be the parent (the work itself and everything under it). */
  exclude?: string[] | undefined;
  onClose: () => void;
  onSaved?: ((w: WorkRec) => void) | undefined;
}): React.JSX.Element {
  const { vocab, properties, settings } = useApp();
  const editing = work !== null;
  const [title, setTitle] = useState(work?.title ?? '');
  const [type, setType] = useState<string>(work?.work_type ?? defaults?.work_type ?? '');
  const [property, setProperty] = useState(work?.property ?? defaults?.property ?? '');
  const [parent, setParent] = useState(work?.parent ?? defaults?.parent ?? '');
  const [basis, setBasis] = useState<string>(work?.rights_basis ?? '');
  const [status, setStatus] = useState<string>(work?.status ?? 'development');
  const [created, setCreated] = useState(d10(work?.creation_date));
  const [published, setPublished] = useState(d10(work?.publication_date));
  const [country, setCountry] = useState(work?.publication_country ?? '');
  const [language, setLanguage] = useState(work?.language ?? '');
  const [eidr, setEidr] = useState(work?.eidr ?? '');
  const [isrc, setIsrc] = useState(work?.isrc ?? '');
  const [iswc, setIswc] = useState(work?.iswc ?? '');
  const [isbn, setIsbn] = useState(work?.isbn ?? '');
  const [otherIds, setOtherIds] = useState(work?.other_ids ?? '');
  const [authors, setAuthors] = useState(work?.authors ?? '');
  const [authorKind, setAuthorKind] = useState<string>(work?.author_kind ?? '');
  const [forHire, setForHire] = useState(work?.made_for_hire ?? false);
  const [deathYear, setDeathYear] = useState(work !== null && work.author_death_year > 0 ? String(work.author_death_year) : '');
  const [description, setDescription] = useState(work?.description ?? '');
  const [notes, setNotes] = useState(work?.notes ?? '');
  const [tags, setTags] = useState<string[]>(work?.tags ?? []);
  const [file, setFile] = useState<File | null>(null);
  const [removed, setRemoved] = useState(false);
  const [errors, setErrors] = useState<{ title?: string; type?: string; year?: string }>({});
  const [busy, setBusy] = useState(false);

  const prop = properties.find((p) => p.id === property);
  // Mirrors the rights engine: parent works first, then the property.
  const inheritLabel =
    parent !== ''
      ? `Inherit from the parent ${vocab.work.toLowerCase()}`
      : prop !== undefined
        ? `Same as ${prop.name}${prop.rights_basis !== '' ? ` (${RIGHTS_BASIS_LABEL[prop.rights_basis as RightsBasis]})` : ''}`
        : 'Not set';

  const parentFilter = useMemo(() => {
    const ids = [...new Set([...(work !== null ? [work.id] : []), ...exclude])];
    return ids.map((i) => `id != "${i}"`).join(' && ');
  }, [work, exclude]);

  const typeOptions = useMemo(() => options(WORK_TYPE_LABEL), []);

  const submit = async (): Promise<void> => {
    const errs: { title?: string; type?: string; year?: string } = {};
    if (title.trim() === '') errs.title = 'Enter the title.';
    if (type === '') errs.type = 'Choose what kind of work this is.';
    const year = deathYear.trim() === '' ? 0 : Number(deathYear);
    if (!Number.isInteger(year) || year < 0 || year > 2200) errs.year = 'Enter a four-digit year.';
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setBusy(true);
    const fields: Record<string, string> = {
      title: title.trim(),
      work_type: type,
      property,
      parent,
      rights_basis: basis,
      status,
      creation_date: toPb(created),
      publication_date: toPb(published),
      publication_country: country,
      language: language.trim(),
      eidr: eidr.trim(),
      isrc: isrc.trim(),
      iswc: iswc.trim(),
      isbn: isbn.trim(),
      other_ids: otherIds.trim(),
      authors: authors.trim(),
      author_kind: authorKind,
      description: description.trim(),
      notes: notes.trim(),
    };
    try {
      let saved: WorkRec;
      if (file !== null || removed) {
        const fd = new FormData();
        for (const [k, v] of Object.entries(fields)) fd.append(k, v);
        fd.append('made_for_hire', forHire ? 'true' : 'false');
        fd.append('author_death_year', String(year));
        fd.append('tags', JSON.stringify(tags));
        if (file !== null) fd.append('image', file);
        else fd.append('image', '');
        saved = editing ? await updateRecord<WorkRec>('works', work.id, fd) : await createRecord<WorkRec>('works', fd);
      } else {
        const body = { ...fields, made_for_hire: forHire, author_death_year: year, tags };
        saved = editing ? await updateRecord<WorkRec>('works', work.id, body) : await createRecord<WorkRec>('works', body);
      }
      toast.success(editing ? 'Saved' : `${vocab.work} created`);
      onSaved?.(saved);
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
      title={editing ? `Edit ${vocab.work.toLowerCase()}` : `New ${vocab.work.toLowerCase()}`}
      description={vocab.workHint}
      className="w-[min(94vw,46rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={busy}>
            {editing ? 'Save' : `Create ${vocab.work.toLowerCase()}`}
          </Button>
        </>
      }
    >
      <div className="flex max-h-[64vh] flex-col gap-4 overflow-y-auto pr-1">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} error={errors.title} autoFocus />
          <Select label="Type" value={type} placeholder="Choose" options={typeOptions} onChange={(e) => setType(e.target.value)} error={errors.type} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label={vocab.property}
            value={property}
            placeholder="None"
            options={properties.map((p) => ({ value: p.id, label: p.name }))}
            onChange={(e) => setProperty(e.target.value)}
          />
          <RecordPicker<WorkRec>
            collection="works"
            label={`Part of (parent ${vocab.work.toLowerCase()})`}
            value={parent}
            onChange={(id, rec) => {
              setParent(id);
              if (rec !== null && property === '' && rec.property !== '') setProperty(rec.property);
            }}
            labelOf={(w) => `${w.title} (${WORK_TYPE_LABEL[w.work_type] ?? w.work_type})`}
            searchFields={['title']}
            filter={parentFilter !== '' ? parentFilter : undefined}
            placeholder={`Search ${vocab.works.toLowerCase()}`}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Rights basis" help={RIGHTS_BASIS_HELP}>
            <Select value={basis} placeholder={inheritLabel} options={options(RIGHTS_BASIS_LABEL)} onChange={(e) => setBasis(e.target.value)} aria-label="Rights basis" />
          </Field>
          <Select label="Status" value={status} placeholder="Not set" options={options(WORK_STATUS_LABEL)} onChange={(e) => setStatus(e.target.value)} />
        </div>

        <SubHeading>Dates and publication</SubHeading>
        <div className="grid gap-4 sm:grid-cols-2">
          <DateField label="Created (completed)" value={created} onChange={setCreated} help="When the work was fixed in final form. Used for the term of works made for hire." />
          <DateField label="First published" value={published} onChange={setPublished} help={PUBLICATION_HELP} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <JurisdictionSelect label="Country of first publication" value={country} onChange={setCountry} preferred={settings?.jurisdictions ?? undefined} placeholder="Not published or unknown" />
          <Input label="Language" value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="For example English" />
        </div>

        <SubHeading>Identifiers</SubHeading>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="EIDR (film and TV)" value={eidr} onChange={(e) => setEidr(e.target.value)} className="font-mono" placeholder="10.5240/XXXX-XXXX-XXXX-XXXX-XXXX-C" />
          <Input label="ISRC (recordings)" value={isrc} onChange={(e) => setIsrc(e.target.value)} className="font-mono" placeholder="USXXX2600001" />
          <Input label="ISWC (compositions)" value={iswc} onChange={(e) => setIswc(e.target.value)} className="font-mono" placeholder="T-000000000-0" />
          <Input label="ISBN (books)" value={isbn} onChange={(e) => setIsbn(e.target.value)} className="font-mono" placeholder="978-0-00-000000-0" />
        </div>
        <Input label="Other identifiers" value={otherIds} onChange={(e) => setOtherIds(e.target.value)} placeholder="For example internal production number, UPC, store ID" />

        <SubHeading>Authorship</SubHeading>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Authors" value={authors} onChange={(e) => setAuthors(e.target.value)} placeholder="Names, separated by commas" />
          <Select label="Author type" value={authorKind} placeholder="Not set" options={options(AUTHOR_KIND_LABEL)} onChange={(e) => setAuthorKind(e.target.value)} />
        </div>
        <div className="grid items-start gap-4 sm:grid-cols-2">
          <Field label="Work made for hire" help="Made by employees in their job, or specially commissioned under a signed work-for-hire agreement. The organization is then the author.">
            <Switch checked={forHire} onCheckedChange={setForHire} label={forHire ? 'Yes' : 'No'} />
          </Field>
          <Input
            label="Author death year"
            type="number"
            inputMode="numeric"
            min={0}
            value={deathYear}
            onChange={(e) => setDeathYear(e.target.value)}
            error={errors.year}
            placeholder="Leave empty while alive or unknown"
          />
        </div>
        <p className="-mt-2 text-xs text-[var(--agent-app-muted)]">
          The death year sets the copyright term for works by individuals. For joint works, enter the year the last surviving author died.
        </p>

        <SubHeading>Description</SubHeading>
        <Field label="Description">
          <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} aria-label="Description" />
        </Field>
        <ImageField record={work} current={work?.image ?? ''} file={file} removed={removed} onFile={setFile} onRemove={setRemoved} />
        <TagInput label="Tags" value={tags} onChange={setTags} placeholder="Type a tag and press Enter" />
        <Field label="Notes">
          <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="Notes" />
        </Field>
      </div>
    </Dialog>
  );
}
