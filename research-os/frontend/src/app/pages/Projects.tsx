/**
 * Projects: a research question with its to-do, reading list, claims map,
 * boards, writing and reviews. Papers stay in the one shared library.
 */
import { useEffect, useState } from 'react';
import { Archive, FolderKanban, FolderPlus, Lock, Pin } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { op } from '../lib/api.ts';
import { changed, useLive } from '../lib/live.ts';
import { plural } from '../lib/format.ts';
import { navigate, replaceQuery, useRoute } from '../lib/router.ts';
import { PROJECT_COLORS } from '../lib/themeColors.ts';
import type { ProjectColor } from '../lib/themeColors.ts';
import type { Project } from '../lib/types.ts';
import { ProjectTile } from '../components/project/ProjectTile.tsx';
import { Button, Empty, Field, LoadError, Modal, PageHeader, Segmented, Skeleton, Toggle, inputCls, textareaCls } from '../components/ui.tsx';

export default function ProjectsPage(): React.JSX.Element {
  const { query } = useRoute();
  const [state, setState] = useState<'active' | 'archived'>('active');
  const list = useLive((signal) => op<{ projects: Project[] }>('projects.list', { state }, { quiet: true, signal }).then((r) => r.projects), ['projects', 'project_works', 'nodes', 'relations', 'annotations', 'tasks'], [state], 300);
  const creating = query.get('new') === '1';
  const rows = list.data ?? [];
  const pinned = rows.filter((p) => p.pinned);
  const rest = rows.filter((p) => !p.pinned);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        icon={FolderKanban}
        title="Projects"
        subtitle={list.data !== null ? plural(rows.length, state === 'active' ? 'active project' : 'archived project') : undefined}
        actions={
          <>
            <Segmented
              label="Show"
              size="sm"
              value={state}
              onChange={setState}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'archived', label: 'Archived', icon: Archive },
              ]}
            />
            <Button variant="primary" icon={FolderPlus} onClick={() => replaceQuery({ new: '1' })}>
              New project
            </Button>
          </>
        }
      />
      {list.error !== null && <LoadError message={list.error} onRetry={list.reload} />}
      {list.data === null && list.error === null && (
        <div className="grid grid-cols-1 gap-3 @min-[640px]:grid-cols-2 @min-[1100px]:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[330px]" />
          ))}
        </div>
      )}
      {list.data !== null && rows.length === 0 && (
        <Empty icon={FolderKanban} title={state === 'active' ? 'No projects yet' : 'Nothing archived'} action={state === 'active' ? <Button variant="primary" icon={FolderPlus} onClick={() => replaceQuery({ new: '1' })}>New project</Button> : undefined}>
          {state === 'active' ? 'A project holds one research question with its papers, claims, to-do and writing.' : undefined}
        </Empty>
      )}
      {pinned.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="flex items-center gap-1.5 text-[12px] font-bold text-[var(--ro-muted)]">
            <Pin size={12} /> Pinned
          </h2>
          <Grid rows={pinned} start={1} />
        </section>
      )}
      {rest.length > 0 && <Grid rows={rest} start={pinned.length + 1} />}
      <NewProject open={creating} onClose={() => replaceQuery({ new: undefined })} />
    </div>
  );
}

function Grid({ rows, start }: { rows: Project[]; start: number }): React.JSX.Element {
  return (
    <ul className="grid grid-cols-1 gap-3 @min-[640px]:grid-cols-2 @min-[1100px]:grid-cols-3 @min-[1300px]:grid-cols-4">
      {rows.map((p, i) => (
        <li key={p.id} className="flex">
          <ProjectTile p={p} n={start + i} />
        </li>
      ))}
    </ul>
  );
}

export function ColorPicker({ value, onChange }: { value: string; onChange: (c: ProjectColor) => void }): React.JSX.Element {
  return (
    <div role="radiogroup" aria-label="Color" className="flex flex-wrap gap-1.5">
      {PROJECT_COLORS.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={c} title={c} onClick={() => onChange(c)} className={cn('size-6 rounded-full transition-transform hover:scale-110', value === c && 'ring-2 ring-[var(--ro-ink)] ring-offset-2 ring-offset-[var(--ro-shell)]')} style={{ background: `var(--ro-pc-${c})` }} />
      ))}
    </div>
  );
}

function NewProject({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element {
  const [name, setName] = useState('');
  const [question, setQuestion] = useState('');
  const [color, setColor] = useState<ProjectColor>('blue');
  const [secret, setSecret] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setName('');
      setQuestion('');
      setSecret(false);
      setColor(PROJECT_COLORS[2 + Math.floor(Math.random() * 6)] ?? 'blue');
    }
  }, [open]);
  const save = async (): Promise<void> => {
    if (name.trim() === '') return;
    setBusy(true);
    try {
      const r = await op<{ project: Project }>('projects.create', { name: name.trim(), question: question.trim(), color, confidentiality: secret ? 'confidential' : 'normal' });
      changed('projects');
      toast.success('Project started');
      navigate('project', { id: r.project.id });
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New project"
      icon={FolderPlus}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={name.trim() === ''} onClick={() => void save()}>
            Start project
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Name">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Sleep and memory consolidation" />
        </Field>
        <Field label="Research question">
          <textarea rows={2} value={question} onChange={(e) => setQuestion(e.target.value)} className={textareaCls} placeholder="Does slow-wave sleep improve recall in adults?" />
        </Field>
        <Field label="Color">
          <ColorPicker value={color} onChange={setColor} />
        </Field>
        <div className="flex items-center gap-2 rounded-[var(--ro-r)] border border-[var(--ro-line)] bg-[var(--ro-card)] px-3 py-2">
          <Lock size={14} className="shrink-0 text-[var(--ro-muted)]" />
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold">Confidential</span>
            <span className="block text-[12px] text-[var(--ro-muted)]">Your AI agent cannot open this project or its papers</span>
          </span>
          <Toggle checked={secret} onChange={setSecret} label="Confidential" />
        </div>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
