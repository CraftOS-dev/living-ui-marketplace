/**
 * Create or edit a property (franchise, brand, product line...): name,
 * kind, rights basis, parent, business unit, status, description, image
 * and tags. The image goes up as multipart; everything else as JSON.
 */
import { useMemo, useState } from 'react';
import { Button, Dialog, Input, Select, TagInput, Textarea, toast } from '../../kit/index.ts';
import { createRecord, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import type { PropertyRec } from '../lib/types.ts';
import {
  ImageField,
  PROPERTY_KIND_LABEL,
  PROPERTY_STATUS_LABEL,
  RIGHTS_BASIS_HELP,
  RIGHTS_BASIS_LABEL,
  descendantIds,
  options,
} from './catalogShared.tsx';
import { Field } from './ui.tsx';

export function PropertyForm({
  property,
  defaultParent = '',
  onClose,
  onSaved,
}: {
  property: PropertyRec | null;
  defaultParent?: string | undefined;
  onClose: () => void;
  onSaved?: ((p: PropertyRec) => void) | undefined;
}): React.JSX.Element {
  const { vocab, properties } = useApp();
  const editing = property !== null;
  const [name, setName] = useState(property?.name ?? '');
  const [kind, setKind] = useState<string>(property?.kind ?? '');
  const [basis, setBasis] = useState<string>(property?.rights_basis ?? '');
  const [parent, setParent] = useState(property?.parent ?? defaultParent);
  const [unit, setUnit] = useState(property?.business_unit ?? '');
  const [status, setStatus] = useState<string>(property?.status ?? 'active');
  const [description, setDescription] = useState(property?.description ?? '');
  const [tags, setTags] = useState<string[]>(property?.tags ?? []);
  const [file, setFile] = useState<File | null>(null);
  const [removed, setRemoved] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const parentOptions = useMemo(() => {
    const blocked = property !== null ? descendantIds(properties, property.id) : new Set<string>();
    if (property !== null) blocked.add(property.id);
    return properties.filter((p) => !blocked.has(p.id)).map((p) => ({ value: p.id, label: p.name }));
  }, [properties, property]);

  const unitSuggestions = useMemo(
    () => [...new Set(properties.map((p) => p.business_unit.trim()).filter((u) => u !== ''))].sort(),
    [properties],
  );

  const parentName = properties.find((p) => p.id === parent)?.name ?? '';

  const submit = async (): Promise<void> => {
    if (name.trim() === '') {
      setError(`Give the ${vocab.property.toLowerCase()} a name.`);
      return;
    }
    setError('');
    setBusy(true);
    const fields: Record<string, string> = {
      name: name.trim(),
      kind,
      rights_basis: basis,
      parent,
      business_unit: unit.trim(),
      status,
      description: description.trim(),
    };
    try {
      let saved: PropertyRec;
      if (file !== null || removed) {
        const fd = new FormData();
        for (const [k, v] of Object.entries(fields)) fd.append(k, v);
        fd.append('tags', JSON.stringify(tags));
        if (file !== null) fd.append('image', file);
        else fd.append('image', '');
        saved = editing ? await updateRecord<PropertyRec>('properties', property.id, fd) : await createRecord<PropertyRec>('properties', fd);
      } else {
        const body = { ...fields, tags };
        saved = editing ? await updateRecord<PropertyRec>('properties', property.id, body) : await createRecord<PropertyRec>('properties', body);
      }
      toast.success(editing ? 'Saved' : `${vocab.property} created`);
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
      title={editing ? `Edit ${vocab.property.toLowerCase()}` : `New ${vocab.property.toLowerCase()}`}
      description={vocab.propertyHint}
      className="w-[min(94vw,42rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={busy}>
            {editing ? 'Save' : `Create ${vocab.property.toLowerCase()}`}
          </Button>
        </>
      }
    >
      <div className="flex max-h-[64vh] flex-col gap-4 overflow-y-auto pr-1">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} error={error !== '' ? error : undefined} autoFocus />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Kind" value={kind} placeholder="Not set" options={options(PROPERTY_KIND_LABEL)} onChange={(e) => setKind(e.target.value)} />
          <Select label="Status" value={status} placeholder="Not set" options={options(PROPERTY_STATUS_LABEL)} onChange={(e) => setStatus(e.target.value)} />
        </div>
        <Field label="Rights basis" help={RIGHTS_BASIS_HELP}>
          <Select
            value={basis}
            placeholder={parent !== '' ? `Same as ${parentName || 'the parent'}` : 'Not set'}
            options={options(RIGHTS_BASIS_LABEL)}
            onChange={(e) => setBasis(e.target.value)}
            aria-label="Rights basis"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Part of" help={`Nest this under a larger ${vocab.property.toLowerCase()}, for example a spin-off under its franchise.`}>
            <Select value={parent} placeholder="Nothing (top level)" options={parentOptions} onChange={(e) => setParent(e.target.value)} aria-label="Part of" />
          </Field>
          <Field label="Business unit">
            <Input value={unit} onChange={(e) => setUnit(e.target.value)} list="ipm-business-units" placeholder="For example Consumer Products" aria-label="Business unit" />
            <datalist id="ipm-business-units">
              {unitSuggestions.map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
          </Field>
        </div>
        <Field label="Description">
          <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} aria-label="Description" />
        </Field>
        <ImageField
          record={property}
          current={property?.image ?? ''}
          file={file}
          removed={removed}
          onFile={setFile}
          onRemove={setRemoved}
        />
        <TagInput label="Tags" value={tags} onChange={setTags} placeholder="Type a tag and press Enter" />
      </div>
    </Dialog>
  );
}
