/**
 * Adding a song, three ways: ask the coach (it writes the music at your
 * level), write it in ABC notation, or import a file (ABC or MusicXML),
 * which opens in the notation tab to check before adding.
 */
import { useEffect, useRef, useState } from 'react';
import { Sparkle, FileUp, PenLine, Send } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { api } from '../../lib/api.ts';
import { useApp } from '../../lib/context.tsx';
import { LEVEL_NAMES } from '../../lib/format.ts';
import { navigate } from '../../lib/router.ts';
import { importFile } from '../../music/musicxml.ts';
import { Button, Dialog, Field, Input, Segmented, Select, Textarea, errMessage } from '../ui.tsx';
import { NotationEditor, useCheck } from './NotationEditor.tsx';

type Tab = 'ask' | 'write' | 'import';

export function LevelSelect({ value, onChange }: { value: number; onChange: (v: number) => void }): React.JSX.Element {
  return (
    <Select value={String(value)} onChange={(e) => onChange(Number(e.target.value))}>
      {LEVEL_NAMES.slice(1).map((n, i) => (
        <option key={n} value={i + 1}>
          {i + 1} · {n}
        </option>
      ))}
    </Select>
  );
}

export function AddSong({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element | null {
  const app = useApp();
  const [tab, setTab] = useState<Tab>('ask');
  const [ask, setAsk] = useState('');
  const [level, setLevel] = useState(app.settings?.level ?? 1);
  const [abc, setAbc] = useState('');
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<'piece' | 'exercise'>('piece');
  const [levelTouched, setLevelTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [source, setSource] = useState<'you' | 'import'>('you');
  const file = useRef<HTMLInputElement | null>(null);
  const { result, busy: checking } = useCheck(tab === 'write' ? abc : '');

  useEffect(() => {
    if (open) {
      setTab('ask');
      setAsk('');
      setAbc('');
      setTitle('');
      setKind('piece');
      setLevel(app.settings?.level ?? 1);
      setLevelTouched(false);
      setSource('you');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // The level the notation suggests, until the person picks one.
  useEffect(() => {
    if (!levelTouched && result?.ok === true && result.summary !== undefined) setLevel(result.summary.level);
  }, [result, levelTouched]);

  const sendAsk = (): void => {
    if (ask.trim() === '') return;
    setBusy(true);
    api
      .send({ text: ask.trim(), kind: 'request', context: { view: 'library', request: 'song', level } })
      .then((r) => {
        onClose();
        if (r.asked) toast.success('Your coach is on it');
        else toast.info(`Saved. ${r.reason}`);
        navigate('coach');
      })
      .catch((err: unknown) => toast.error(errMessage(err)))
      .finally(() => setBusy(false));
  };

  const add = (): void => {
    setBusy(true);
    api
      .addSong({ abc, title: title.trim() === '' ? undefined : title.trim(), level, kind, source })
      .then((r) => {
        onClose();
        toast.success(`Added ${r.song.title}`);
        navigate('library', { song: r.song.id });
      })
      .catch((err: unknown) => toast.error(errMessage(err)))
      .finally(() => setBusy(false));
  };

  const load = (f: File | undefined): void => {
    if (f === undefined) return;
    importFile(f)
      .then((r) => {
        setAbc(r.abc);
        setTitle(r.title);
        setSource('import');
        setTab('write');
        for (const w of r.warnings) toast.info(w);
      })
      .catch((err: unknown) => toast.error(errMessage(err)));
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add a song"
      width={tab === 'write' ? 720 : 560}
      footer={
        tab === 'ask' ? (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="coach" icon={Send} busy={busy} disabled={ask.trim() === ''} onClick={sendAsk}>
              Ask the coach
            </Button>
          </>
        ) : tab === 'write' ? (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" busy={busy} disabled={result?.ok !== true || checking} onClick={add}>
              Add to library
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>Cancel</Button>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <Segmented
          value={tab}
          onChange={setTab}
          label="How"
          options={[
            { value: 'ask', label: 'Ask the coach', icon: Sparkle },
            { value: 'write', label: 'Write notation', icon: PenLine },
            { value: 'import', label: 'Import a file', icon: FileUp },
          ]}
        />
        {tab === 'ask' && (
          <div className="flex flex-col gap-3">
            <Field label="Song or exercise">
              <Textarea
                autoFocus
                value={ask}
                onChange={(e) => setAsk(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendAsk();
                }}
                minRows={3}
                placeholder="Gymnopédie No. 1, simplified for both hands"
              />
            </Field>
            <Field label="Level" className="max-w-[260px]">
              <LevelSelect value={level} onChange={setLevel} />
            </Field>
          </div>
        )}
        {tab === 'write' && (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_200px_150px]">
              <Field label="Title">
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={result?.summary?.title || 'From T: in the notation'} />
              </Field>
              <Field label="Level">
                <LevelSelect
                  value={level}
                  onChange={(v) => {
                    setLevel(v);
                    setLevelTouched(true);
                  }}
                />
              </Field>
              <Field label="Kind">
                <Select value={kind} onChange={(e) => setKind(e.target.value as 'piece' | 'exercise')}>
                  <option value="piece">Piece</option>
                  <option value="exercise">Exercise</option>
                </Select>
              </Field>
            </div>
            <NotationEditor value={abc} onChange={setAbc} result={result} busy={checking} rows={14} />
          </div>
        )}
        {tab === 'import' && (
          <button
            type="button"
            onClick={() => file.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              load(e.dataTransfer.files[0]);
            }}
            className={cn('pc-focus flex h-44 flex-col items-center justify-center gap-2 rounded-[var(--pc-radius)] border border-dashed transition-colors', drag ? 'border-[var(--pc-ink)] bg-[var(--pc-hover)]' : 'border-[var(--pc-line-2)] hover:bg-[var(--pc-hover)]')}
          >
            <FileUp size={22} strokeWidth={1.6} aria-hidden className="text-[var(--pc-muted)]" />
            <span className="text-[13px] font-medium">Drop a file or click to choose</span>
            <span className="pc-label">.abc · .musicxml · .xml · .mxl</span>
            <input ref={file} type="file" accept=".abc,.txt,.musicxml,.xml,.mxl" className="hidden" onChange={(e) => (load(e.target.files?.[0]), (e.target.value = ''))} />
          </button>
        )}
      </div>
    </Dialog>
  );
}
