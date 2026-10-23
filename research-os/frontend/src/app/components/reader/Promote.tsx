/**
 * Turn a passage into a question, claim or evidence (Backslash, or the
 * popup's buttons). The dialog suggests existing nodes as you type so you
 * link instead of duplicating, and links the new node in the same step.
 */
import { useEffect, useMemo, useState } from 'react';
import { CircleHelp, Lightbulb, Link2, Quote } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { useApp } from '../../lib/context.tsx';
import { changed } from '../../lib/live.ts';
import { KIND_LABEL, clip } from '../../lib/format.ts';
import type { GNode, NodeKind, RelKind } from '../../lib/types.ts';
import { Button, Field, Modal, Segmented, Select, textareaCls } from '../ui.tsx';

export interface PromoteTarget {
  file: string;
  work: string;
  page: number;
  start?: number;
  end?: number;
  anchor?: string;
  quote: string;
  kind: NodeKind;
}

const LAST_PROJECT = 'ro_last_project';

export function PromoteDialog({ target, projectsOfWork, onClose }: { target: PromoteTarget; projectsOfWork: string[]; onClose: () => void }): React.JSX.Element {
  const { projects } = useApp();
  const active = projects.filter((p) => p.state === 'active');
  const remembered = (() => {
    try {
      return localStorage.getItem(LAST_PROJECT) ?? '';
    } catch {
      return '';
    }
  })();
  const firstProject = projectsOfWork.find((id) => active.some((p) => p.id === id)) ?? (active.some((p) => p.id === remembered) ? remembered : (active[0]?.id ?? ''));
  const [project, setProject] = useState(firstProject);
  const [kind, setKind] = useState<NodeKind>(target.kind);
  const [title, setTitle] = useState(() => clip(target.quote, 280));
  const [linkTo, setLinkTo] = useState('');
  const [linkKind, setLinkKind] = useState<RelKind>('supports');
  const [nodes, setNodes] = useState<GNode[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (project === '') return;
    void op<{ nodes: GNode[] }>('nodes.list', { project, passages: false, limit: 1000 }, { quiet: true }).then((r) => setNodes(r.nodes.filter((n) => n.status !== 'researcher_rejected')));
  }, [project]);
  useEffect(() => {
    setLinkTo('');
    setLinkKind(kind === 'evidence' ? 'supports' : 'informs');
  }, [kind]);
  const similar = useMemo(() => {
    const words = title.toLowerCase().split(/\s+/).filter((w) => w.length > 3).slice(0, 8);
    if (words.length === 0) return [];
    return nodes
      .filter((n) => n.kind === kind)
      .map((n) => ({ n, score: words.filter((w) => n.title.toLowerCase().includes(w)).length }))
      .filter((x) => x.score >= Math.min(2, words.length))
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .map((x) => x.n);
  }, [nodes, title, kind]);
  const targets = nodes.filter((n) => (kind === 'question' ? false : linkKind === 'informs' ? n.kind === 'question' : n.kind === 'claim'));
  const save = async (): Promise<void> => {
    if (project === '' || title.trim() === '') return;
    setBusy(true);
    try {
      if (!projectsOfWork.includes(project)) await op('projects.add-works', { project, works: [target.work] }, { quiet: true }).catch(() => undefined);
      const passage = target.anchor !== undefined ? undefined : target.start !== undefined && target.end !== undefined ? { file: target.file, page: target.page, start: target.start, end: target.end } : undefined;
      await op('nodes.create', {
        project,
        kind,
        title: title.trim(),
        claim_basis: kind === 'claim' ? 'literature_finding' : undefined,
        passage: passage !== undefined ? JSON.stringify(passage) : undefined,
        anchors: target.anchor !== undefined ? JSON.stringify([target.anchor]) : undefined,
        link_to: linkTo !== '' ? linkTo : undefined,
        link_kind: linkTo !== '' ? linkKind : undefined,
      });
      try {
        localStorage.setItem(LAST_PROJECT, project);
      } catch {
        /* a convenience */
      }
      changed('nodes', 'relations', 'node_anchors', 'anchors');
      toast.success(KIND_LABEL[kind] + ' added');
      onClose();
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  const addPassageTo = async (n: GNode): Promise<void> => {
    setBusy(true);
    try {
      const passage = target.start !== undefined && target.end !== undefined ? { file: target.file, page: target.page, start: target.start, end: target.end } : undefined;
      await op('nodes.add-passage', { node: n.id, passage: passage ? JSON.stringify(passage) : undefined, anchors: target.anchor ? JSON.stringify([target.anchor]) : undefined });
      changed('nodes', 'node_anchors', 'anchors');
      toast.success('Passage added to "' + clip(n.title, 50) + '"');
      onClose();
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Add to a project"
      icon={Lightbulb}
      wide
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={project === '' || title.trim() === ''} onClick={() => void save()}>
            Add {KIND_LABEL[kind]?.toLowerCase()}
          </Button>
        </>
      }
    >
      {active.length === 0 ? (
        <p className="text-[13px] text-[var(--ro-muted)]">Start a project first: claims and evidence live in a project.</p>
      ) : (
        <div
          className="flex flex-col gap-3"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && (e.target as HTMLElement).tagName === 'TEXTAREA') {
              e.preventDefault();
              void save();
            }
          }}
        >
          <blockquote className="serif rounded-[var(--ro-r)] border-l-2 border-[var(--ro-accent)] bg-[var(--ro-row)] px-3 py-2 text-[13px] leading-[19px] text-[var(--ro-ink-2)]">
            <Quote size={12} className="mb-1 text-[var(--ro-muted)]" />
            {clip(target.quote, 600)}
            <span className="mt-1 block font-sans text-[12px] text-[var(--ro-muted)]">Page {target.page}</span>
          </blockquote>
          <div className="flex flex-wrap items-end gap-2">
            <Segmented
              label="Kind"
              value={kind}
              onChange={setKind}
              options={[
                { value: 'evidence', label: 'Evidence', icon: Quote },
                { value: 'claim', label: 'Claim', icon: Lightbulb },
                { value: 'question', label: 'Question', icon: CircleHelp },
              ]}
            />
            <Select ariaLabel="Project" className="min-w-48 flex-1" value={project} onChange={setProject} options={active.map((p) => ({ value: p.id, label: p.name }))} />
          </div>
          <Field label={kind === 'evidence' ? 'What this passage shows' : kind === 'claim' ? 'The claim, in one sentence' : 'The question'}>
            <textarea autoFocus rows={3} value={title} onChange={(e) => setTitle(e.target.value)} className={textareaCls} />
          </Field>
          {similar.length > 0 && (
            <div className="rounded-[var(--ro-r)] border border-[var(--ro-line)] bg-[var(--ro-card)]">
              <p className="border-b border-[var(--ro-hair)] px-2.5 py-1.5 text-[12px] font-semibold text-[var(--ro-ink-2)]">Already in the project</p>
              {similar.map((n) => (
                <div key={n.id} className="flex items-center gap-2 border-b border-[var(--ro-hair)] px-2.5 py-1.5 last:border-0">
                  <span className="min-w-0 flex-1 text-[12px] leading-4">{n.title}</span>
                  <Button size="sm" icon={Link2} onClick={() => void addPassageTo(n)}>
                    Use this passage
                  </Button>
                </div>
              ))}
            </div>
          )}
          {kind !== 'question' && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] font-semibold text-[var(--ro-ink-2)]">Link it</span>
              {kind === 'evidence' ? (
                <Segmented size="sm" label="Link" value={linkKind} onChange={setLinkKind} options={[{ value: 'supports', label: 'supports' }, { value: 'opposes', label: 'opposes' }, { value: 'informs', label: 'informs a question' }]} />
              ) : (
                <Segmented size="sm" label="Link" value={linkKind} onChange={setLinkKind} options={[{ value: 'informs', label: 'informs' }, { value: 'supports', label: 'supports' }, { value: 'opposes', label: 'opposes' }]} />
              )}
              <Select ariaLabel="Link to" className={cn('min-w-48 flex-1')} value={linkTo} onChange={setLinkTo} options={[{ value: '', label: targets.length === 0 ? 'Nothing to link to yet' : 'Not linked' }, ...targets.map((n) => ({ value: n.id, label: clip(n.title, 90) }))]} />
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
