/**
 * The employee handbook: pages by category on the left (HR drags them into
 * order and adds one with the inline "+"), the published text on the right
 * with "I have read this" where a page asks for it. HR edits a draft beside
 * its preview and publishes it as the next version; who has read it shows
 * under the page.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, CheckCheck, GripVertical, MoreHorizontal, Pencil, Plus, Send, Trash2, X } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { Button, Dialog, Empty, Field, Input, LoadError, Menu, MenuItem, Notice, PageBody, PageHeader, Panel, StatusDot, Tag, Textarea, confirmAsk, toast } from '../../components/ui.tsx';
import { HANDBOOK_READS, LabeledToggle, SkeletonRows } from '../../components/lifecycle/bits.tsx';
import { Markdown } from '../../components/lifecycle/Markdown.tsx';
import type { HandbookPage } from '../../components/lifecycle/types.ts';
import { errMessage, op } from '../../lib/api.ts';
import { can, useMe } from '../../lib/auth.tsx';
import type { PageProps } from '../../lib/contract.ts';
import { fmtStampDay } from '../../lib/format.ts';
import { t, tn } from '../../lib/i18n.ts';
import { changed, useOp } from '../../lib/live.ts';
import { navigate, setQuery } from '../../lib/router.ts';

interface PageList {
  pages: HandbookPage[];
  categories: string[];
  editor: boolean;
  to_ack: number;
}

function PageNav({ pages, selected, editor }: { pages: HandbookPage[]; selected: string; editor: boolean }): React.JSX.Element {
  const [order, setOrder] = useState(pages);
  const [drag, setDrag] = useState<number | null>(null);
  useEffect(() => setOrder(pages), [pages]);
  const groups = useMemo(() => {
    const out: { cat: string; items: { p: HandbookPage; i: number }[] }[] = [];
    order.forEach((p, i) => {
      const cat = p.category || t('lifecycle.general');
      let g = out.find((x) => x.cat === cat);
      if (g === undefined) {
        g = { cat, items: [] };
        out.push(g);
      }
      g.items.push({ p, i });
    });
    return out;
  }, [order]);
  const commit = async (): Promise<void> => {
    try {
      await op('handbook.reorder', { pages: order.map((p) => p.id) });
      changed('handbook');
    } catch {
      /* toast shown */
    }
  };
  const add = async (): Promise<void> => {
    try {
      const r = await op<{ page: HandbookPage }>('handbook.save', { title: t('lifecycle.new_page') });
      changed('handbook');
      navigate(`/lifecycle/handbook/${r.page.id}`, { edit: 1 });
    } catch {
      /* toast shown */
    }
  };
  return (
    <nav className="hr-panel hr-in flex min-w-0 flex-col self-start py-1" aria-label={t('lifecycle.handbook')}>
      {editor && (
        <div className="flex h-9 items-center gap-2 px-3">
          <span className="hr-label flex-1">{t('lifecycle.pages')}</span>
          <Button size="sm" variant="ghost" icon={Plus} onClick={() => void add()}>
            {t('lifecycle.add_page')}
          </Button>
        </div>
      )}
      {groups.map((g) => (
        <div key={g.cat} className="py-1">
          <div className="hr-label px-3 py-1">{g.cat}</div>
          {g.items.map(({ p, i }) => (
            <div
              key={p.id}
              draggable={editor}
              onDragStart={() => setDrag(i)}
              onDragOver={(e) => {
                if (drag === null || drag === i) return;
                e.preventDefault();
                setOrder((o) => {
                  const n = o.slice();
                  const [it] = n.splice(drag, 1);
                  if (it !== undefined) n.splice(i, 0, it);
                  return n;
                });
                setDrag(i);
              }}
              onDragEnd={() => {
                setDrag(null);
                void commit();
              }}
              className={cn('group relative flex items-center', drag === i && 'bg-[var(--hr-hover)]')}
            >
              {editor && <GripVertical size={12} aria-hidden className="absolute left-0.5 cursor-grab text-[var(--hr-faint)] opacity-0 group-hover:opacity-100" />}
              <a href={`#/lifecycle/handbook/${p.id}`} className={cn('hr-focus relative flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 hover:bg-[var(--hr-hover)] pointer-coarse:min-h-10', p.id === selected && 'bg-[var(--hr-active)] before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:bg-[var(--hr-ink)]')}>
                <span className="hr-wrap min-w-0 flex-1 text-[13px]">{p.title}</span>
                {p.to_ack && <StatusDot tone="warn" label={t('lifecycle.to_read')} />}
                {editor && !p.published && <Tag tone="faint">{t('lifecycle.draft')}</Tag>}
                {editor && p.published && p.changed === true && <Tag tone="warn">{t('lifecycle.changed')}</Tag>}
              </a>
            </div>
          ))}
        </div>
      ))}
    </nav>
  );
}

function Reader({ page, onEdit }: { page: HandbookPage; onEdit?: (() => void) | undefined }): React.JSX.Element {
  const me = useMe();
  const ack = async (): Promise<void> => {
    try {
      await op('handbook.acknowledge', { page: page.id });
      changed(...HANDBOOK_READS);
      toast.success(t('lifecycle.thanks_ack'));
    } catch {
      /* toast shown */
    }
  };
  return (
    <article className="hr-panel hr-in min-w-0 px-5 py-5 md:px-8">
      <div className="mb-4 flex flex-wrap items-start gap-3 border-b border-[var(--hr-hair)] pb-3">
        <div className="min-w-0 flex-1">
          <h2 className="hr-wrap text-[15px] font-semibold leading-6">{page.title}</h2>
          <div className="hr-label mt-1">{[page.category, page.published ? t('lifecycle.version_on', { v: page.version, day: fmtStampDay(page.published_at, { entity: page.entity }) }) : t('lifecycle.not_published'), page.entity_name].filter((x) => x !== '').join(' · ')}</div>
        </div>
        {onEdit !== undefined && (
          <Button icon={Pencil} onClick={onEdit}>
            {t('ui.edit')}
          </Button>
        )}
      </div>
      {page.published ? <Markdown text={page.body ?? ''} /> : <span className="text-[13px] text-[var(--hr-muted)]">{t('lifecycle.not_published_text')}</span>}
      {page.needs_ack && page.published && me.employee !== null && (
        <div className="mt-6 flex items-center gap-3 border-t border-[var(--hr-hair)] pt-4">
          {page.acked_at !== '' ? (
            <StatusDot tone="good" label={t('lifecycle.acked_on', { day: fmtStampDay(page.acked_at, { entity: page.entity }) })} />
          ) : (
            <Button variant="primary" icon={CheckCheck} onClick={() => void ack()}>
              {t('lifecycle.have_read')}
            </Button>
          )}
        </div>
      )}
    </article>
  );
}

function PublishDialog({ open, onClose, page }: { open: boolean; onClose: () => void; page: HandbookPage }): React.JSX.Element {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const publish = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await op<{ notified: number }>('handbook.publish', { page: page.id, note: note === '' ? undefined : note });
      changed(...HANDBOOK_READS);
      toast.success(r.notified > 0 ? tn('lifecycle.published_told', r.notified) : t('lifecycle.published'));
      onClose();
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('lifecycle.publish_version', { v: page.version + 1 })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('ui.cancel')}
          </Button>
          <Button variant="primary" icon={Send} busy={busy} onClick={() => void publish()}>
            {t('lifecycle.publish')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('lifecycle.f.what_changed')} optional>
          <Input value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
        </Field>
        {page.needs_ack && <Notice>{t('lifecycle.publish_ack_note')}</Notice>}
      </div>
    </Dialog>
  );
}

function Editor({ page, onDone }: { page: HandbookPage; onDone: () => void }): React.JSX.Element {
  const [title, setTitle] = useState(page.draft_title ?? page.title);
  const [category, setCategory] = useState(page.category);
  const [body, setBody] = useState(page.draft_body ?? '');
  const [state, setState] = useState<'saved' | 'dirty' | 'saving'>('saved');
  const [publishing, setPublishing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ title, category, body });
  latest.current = { title, category, body };
  const save = async (): Promise<void> => {
    const cur = latest.current;
    setState('saving');
    try {
      await op('handbook.save', { page: page.id, title: cur.title.trim() === '' ? page.title : cur.title, category: cur.category, body: cur.body }, { quiet: true });
      setState('saved');
      changed('handbook');
    } catch (e) {
      setState('dirty');
      toast.error(errMessage(e));
    }
  };
  const touch = (): void => {
    setState('dirty');
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), 700);
  };
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  const setAck = async (v: boolean): Promise<void> => {
    try {
      await op('handbook.save', { page: page.id, needs_ack: v });
      changed('handbook');
    } catch {
      /* toast shown */
    }
  };
  const remove = async (): Promise<void> => {
    if (!(await confirmAsk(t('lifecycle.delete_page_text', { title: page.title }), t('lifecycle.delete_page')))) return;
    try {
      await op(page.published ? 'handbook.unpublish' : 'handbook.delete', { page: page.id });
      changed('handbook');
      navigate('/lifecycle/handbook');
    } catch {
      /* toast shown */
    }
  };
  const acks = useOp<{ people: { employee: string; number: string; name: string; acked_at: string }[]; acked: number; total: number; needs_ack: boolean; version: number }>('handbook.acks', { page: page.id }, HANDBOOK_READS, { name: 'lifecycle.hb.acks', skip: !page.published });
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input value={title} onChange={(e) => (setTitle(e.target.value), touch())} aria-label={t('lifecycle.f.title')} className="min-w-[220px] flex-1 !text-[14px] font-semibold" />
        <Input value={category} onChange={(e) => (setCategory(e.target.value), touch())} aria-label={t('lifecycle.f.category')} placeholder={t('lifecycle.f.category')} className="w-[160px]" />
        <span className="hr-label w-16 text-right" aria-live="polite">
          {state === 'saving' ? t('lifecycle.saving') : state === 'dirty' ? t('lifecycle.editing') : t('ui.saved')}
        </span>
        <Button variant="ghost" onClick={onDone}>
          {t('lifecycle.done_editing')}
        </Button>
        <Button variant="primary" icon={Send} disabled={body.trim() === '' || (page.published && page.changed !== true && state === 'saved')} onClick={() => (state !== 'saved' ? void save().then(() => setPublishing(true)) : setPublishing(true))}>
          {t('lifecycle.publish')}
        </Button>
        <Menu icon={MoreHorizontal} label={t('lifecycle.page_menu')}>
          {(close) => (
            <MenuItem icon={page.published ? X : Trash2} danger onClick={() => (close(), void remove())}>
              {page.published ? t('lifecycle.take_out') : t('ui.remove')}
            </MenuItem>
          )}
        </Menu>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <LabeledToggle checked={page.needs_ack} onChange={(v) => void setAck(v)} label={t('lifecycle.people_acknowledge')} />
        <span className="hr-label">{page.published ? t('lifecycle.live_version', { v: page.version }) : t('lifecycle.not_published')}</span>
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Panel index="01" label={t('lifecycle.draft')}>
          <Textarea value={body} onChange={(e) => (setBody(e.target.value), touch())} minRows={18} maxRows={60} className="hr-mono !text-[13px]" aria-label={t('lifecycle.text')} />
        </Panel>
        <Panel index="02" label={t('lifecycle.preview')} className="xl:sticky xl:top-3 xl:self-start">
          {body.trim() === '' ? <span className="text-[13px] text-[var(--hr-muted)]">{t('lifecycle.empty_page')}</span> : <Markdown text={body} />}
        </Panel>
      </div>
      {page.published && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Panel index="03" label={t('lifecycle.versions')} flush>
            <ul className="px-3.5 pb-1">
              {(page.versions ?? []).map((v) => (
                <li key={v.id} className={cn('grid items-center gap-3 border-b border-[var(--hr-hair)] py-2 text-[13px] last:border-b-0', page.needs_ack ? 'grid-cols-[32px_minmax(0,1fr)_96px_80px]' : 'grid-cols-[32px_minmax(0,1fr)_96px]')}>
                  <span className="hr-mono">v{v.version}</span>
                  <span className="min-w-0 truncate">{[v.note, v.published_by_name].filter((x) => x !== '').join(' · ')}</span>
                  <span className="hr-label">{fmtStampDay(v.created, { entity: page.entity })}</span>
                  {page.needs_ack && <span className="hr-num whitespace-nowrap text-right text-[12px] text-[var(--hr-muted)]">{tn('lifecycle.n_read', v.acks)}</span>}
                </li>
              ))}
            </ul>
          </Panel>
          {page.needs_ack && acks.data !== null && (
            <Panel index="04" label={t('lifecycle.who_read', { v: acks.data.version })} aside={<span className="hr-mono text-[12px]">{acks.data.acked}/{acks.data.total}</span>} flush>
              <ul className="max-h-[320px] overflow-auto px-3.5 pb-1">
                {acks.data.people.map((x) => (
                  <li key={x.employee} className="flex items-center gap-3 border-b border-[var(--hr-hair)] py-1.5 text-[13px] last:border-b-0">
                    <span className="min-w-0 flex-1 truncate">{x.name}</span>
                    {x.acked_at !== '' ? <StatusDot tone="good" label={fmtStampDay(x.acked_at, { entity: page.entity })} /> : <StatusDot tone="faint" label={t('lifecycle.not_yet')} />}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      )}
      {publishing && <PublishDialog open onClose={() => setPublishing(false)} page={page} />}
    </div>
  );
}

export function HandbookPage({ params, query }: PageProps): React.JSX.Element {
  const me = useMe();
  const editorRole = can(me, 'people', 'edit');
  const list = useOp<PageList>('handbook.list', {}, HANDBOOK_READS, { name: 'lifecycle.handbook' });
  const pages = list.data?.pages ?? [];
  const id = params['id'] ?? pages.find((p) => p.to_ack)?.id ?? pages[0]?.id ?? '';
  const one = useOp<{ page: HandbookPage }>('handbook.get', { page: id }, HANDBOOK_READS, { name: 'lifecycle.hb.page', skip: id === '' });
  const editing = query.get('edit') === '1' && editorRole;
  const page = one.data?.page ?? null;
  const add = async (): Promise<void> => {
    try {
      const r = await op<{ page: HandbookPage }>('handbook.save', { title: t('lifecycle.new_page') });
      changed('handbook');
      navigate(`/lifecycle/handbook/${r.page.id}`, { edit: 1 });
    } catch {
      /* toast shown */
    }
  };
  const meta = list.data !== null ? [tn('lifecycle.meta_pages', pages.length), list.data.to_ack > 0 ? tn('lifecycle.meta_to_read', list.data.to_ack) : ''].filter((x) => x !== '').join(' · ') : '';
  return (
    <>
      <PageHeader title={t('lifecycle.handbook')} meta={meta} back={editorRole ? '#/lifecycle' : undefined} />
      <PageBody>
        {list.data === null ? (
          list.error !== null ? (
            <LoadError message={list.error} onRetry={list.reload} />
          ) : (
            <SkeletonRows />
          )
        ) : pages.length === 0 ? (
          <div className="hr-panel">
            <Empty icon={BookOpen} title={editorRole ? t('lifecycle.no_pages') : t('lifecycle.no_pages_self')} action={editorRole ? <Button variant="primary" icon={Plus} onClick={() => void add()}>{t('lifecycle.write_first_page')}</Button> : undefined} />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
            <PageNav pages={pages} selected={id} editor={list.data.editor} />
            {page === null ? (
              one.error !== null ? (
                <LoadError message={one.error} onRetry={one.reload} />
              ) : (
                <SkeletonRows />
              )
            ) : editing && page.editor === true ? (
              <Editor key={page.id} page={page} onDone={() => setQuery({ edit: undefined })} />
            ) : (
              <Reader page={page} onEdit={page.editor === true ? () => setQuery({ edit: 1 }) : undefined} />
            )}
          </div>
        )}
      </PageBody>
    </>
  );
}
