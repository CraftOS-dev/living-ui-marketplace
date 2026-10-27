/**
 * Projects: things with several steps (a move, a renovation, a launch),
 * each drawn as a journey of stepping stones to a flag, with its next step
 * in words. Start one with a name and the part of life it belongs to.
 */
import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { op } from '../lib/api.ts';
import { useStatus } from '../lib/context.tsx';
import { relDay } from '../lib/format.ts';
import { changed, READS, useLive } from '../lib/live.ts';
import { href, navigate, replaceQuery } from '../lib/router.ts';
import type { Project } from '../lib/types.ts';
import { AREA_NAMES, AreaArt } from '../components/art.tsx';
import type { AreaKind } from '../components/art.tsx';
import { NavArt } from '../components/art2.tsx';
import { AreaChoice, Chip, kindColor } from '../components/bits.tsx';
import { Stones } from '../components/journey.tsx';
import { PageBanner, PageBody } from '../components/page.tsx';
import { snack } from '../components/snack.tsx';
import { Button, LoadError, Modal, Skeleton } from '../components/ui.tsx';

function NewProject({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [title, setTitle] = useState('');
  const [area, setArea] = useState<AreaKind | ''>('');
  const [steps, setSteps] = useState('');
  const [busy, setBusy] = useState(false);
  const make = async (): Promise<void> => {
    if (title.trim() === '') return;
    setBusy(true);
    try {
      const r = await op<{ project: Project }>('projects.create', { title: title.trim(), ...(area !== '' ? { area } : {}), look: Math.floor(Math.random() * 8) });
      const lines = steps
        .split('\n')
        .map((x) => x.trim())
        .filter((x) => x !== '');
      for (const l of lines) await op('tasks.create', { title: l, project: r.project.id });
      changed('projects', 'tasks');
      snack(`Started "${r.project.title}"`);
      onClose();
      navigate('project', { id: r.project.id });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="A new project"
      width={560}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={title.trim() === ''} onClick={() => void make()}>
            Start it
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Move house, plan the wedding, launch the shop" aria-label="Project" maxLength={200} className="h-11 w-full rounded-[var(--lo-r)] border border-[var(--lo-line)] bg-[var(--lo-card)] px-3 text-[15px] font-semibold outline-none focus:border-[var(--lo-accent)]" />
        <div>
          <p className="pb-1.5 text-[12px] font-bold text-[var(--lo-muted)]">Part of life</p>
          <AreaChoice value={area} onChange={setArea} size="sm" />
        </div>
        <div>
          <p className="pb-1 text-[12px] font-bold text-[var(--lo-muted)]">First steps, one per line</p>
          <textarea value={steps} onChange={(e) => setSteps(e.target.value)} rows={4} placeholder={'Get three quotes\nPick a date\nBook it'} aria-label="First steps" className="lo-autosize min-h-24 w-full resize-none rounded-[var(--lo-r)] border border-[var(--lo-line)] bg-[var(--lo-card)] px-3 py-2 text-[14px] leading-6 outline-none focus:border-[var(--lo-accent)]" />
        </div>
      </div>
    </Modal>
  );
}

function Journey({ p }: { p: Project }): React.JSX.Element {
  const today = useStatus().data?.today ?? '';
  const total = (p.counts?.todo ?? 0) + (p.counts?.doing ?? 0) + (p.counts?.done ?? 0);
  return (
    <a href={href('project', { id: p.id })} className="group flex flex-col gap-3 rounded-[var(--lo-r-xl)] border border-[var(--lo-hair)] bg-[var(--lo-card)] p-5 shadow-[var(--lo-shadow-sm)] transition-shadow hover:shadow-[var(--lo-shadow)]">
      <div className="flex items-start gap-3">
        {p.area !== '' ? <AreaArt kind={p.area} size={44} /> : <NavArt kind="projects" size={44} />}
        <div className="min-w-0 flex-1">
          <p className="serif truncate text-[15px] font-semibold">{p.title}</p>
          <p className="truncate text-[12px] font-bold" style={{ color: kindColor(p.area, 'text') }}>
            {p.area !== '' ? AREA_NAMES[p.area] : 'Project'}
            {p.goal !== null ? ` · for "${p.goal.title}"` : ''}
          </p>
        </div>
        <span className="num text-[13px] font-extrabold text-[var(--lo-ink-2)]">{Math.round((p.progress ?? 0) * 100)}%</span>
      </div>
      <Stones steps={p.steps ?? []} kind={p.area} />
      <div className="flex items-center gap-2 text-[13px]">
        <span className="min-w-0 flex-1 truncate font-semibold text-[var(--lo-ink-2)]">{p.state === 'done' ? 'Done' : p.next !== null && p.next !== undefined ? `Next: ${p.next.title}` : total === 0 ? 'Add the first step' : 'Every step done'}</span>
        <span className="shrink-0 text-[12px] font-bold text-[var(--lo-muted)]">
          {p.counts?.done ?? 0} of {total}
          {p.deadline !== '' ? ` · ${relDay(p.deadline, today)}` : ''}
        </span>
        <ArrowRight size={14} className="shrink-0 text-[var(--lo-muted)] transition-transform group-hover:translate-x-0.5" />
      </div>
    </a>
  );
}

export default function ProjectsPage({ query }: { query: URLSearchParams }): React.JSX.Element {
  const state = (query.get('state') ?? 'active') as Project['state'];
  const creating = query.get('new') === '1';
  const live = useLive<{ projects: Project[] }>((signal) => op('projects.list', { state }, { quiet: true, signal }), READS.board, [state]);
  const list = live.data?.projects ?? [];
  return (
    <div>
      <PageBanner seed="projects" title="Projects" subtitle="Bigger things, one step at a time" actions={<Button variant="primary" onClick={() => replaceQuery({ new: '1' })}>New project</Button>} />
      <PageBody>
        <div className="mb-5 flex gap-1.5">
          {(
            [
              ['active', 'On the go'],
              ['someday', 'Someday'],
              ['done', 'Done'],
            ] as [Project['state'], string][]
          ).map(([k, l]) => (
            <Chip key={k} active={state === k} onClick={() => replaceQuery({ state: k === 'active' ? undefined : k })}>
              {l}
            </Chip>
          ))}
        </div>
        {live.data === null ? (
          live.error !== null ? (
            <LoadError message={live.error} onRetry={live.reload} />
          ) : (
            <Skeleton className="h-40 w-full" />
          )
        ) : list.length === 0 ? (
          <button type="button" onClick={() => replaceQuery({ new: '1' })} className="flex w-full max-w-xl items-center gap-4 rounded-[var(--lo-r-xl)] border border-dashed border-[var(--lo-line)] p-5 text-left hover:border-solid hover:border-[var(--lo-moss)]">
            <NavArt kind="projects" size={64} />
            <span>
              <span className="block text-[15px] font-bold">{state === 'active' ? 'Nothing on the go' : state === 'someday' ? 'No someday projects' : 'None finished yet'}</span>
              <span className="block text-[13px] text-[var(--lo-muted)]">Moving house, a trip, a kitchen. Name it and list the first steps.</span>
            </span>
          </button>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {list.map((p) => (
              <Journey key={p.id} p={p} />
            ))}
          </div>
        )}
      </PageBody>
      {creating && <NewProject onClose={() => replaceQuery({ new: undefined })} />}
    </div>
  );
}
