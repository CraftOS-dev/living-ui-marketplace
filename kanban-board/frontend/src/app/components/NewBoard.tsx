/** A new board from a template: each template shows its columns and where the agent works. */
import { useEffect, useState } from 'react';
import { Bot } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api } from '../lib/api.ts';
import { navigate } from '../lib/router.ts';
import type { Template } from '../lib/types.ts';
import { CategoryIcon } from './marks.tsx';
import { Button, Dialog, Field, Input, errMessage } from './ui.tsx';

export function NewBoard({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element | null {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [tpl, setTpl] = useState('simple');
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName('');
    setKey('');
    setTpl('simple');
    api
      .templates()
      .then((r) => setTemplates(r.templates))
      .catch((err: unknown) => toast.error(errMessage(err)));
  }, [open]);
  const create = async (): Promise<void> => {
    if (name.trim() === '') return;
    setBusy(true);
    try {
      const r = await api.createBoard({ name: name.trim(), key: key.trim() || undefined, template: tpl });
      onClose();
      navigate('board', { id: r.board.id });
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New board"
      width={620}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} disabled={name.trim() === ''} onClick={() => void create()}>
            Create board
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-[1fr_120px] gap-3">
          <Field label="Name">
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Launch plan" onKeyDown={(e) => e.key === 'Enter' && void create()} />
          </Field>
          <Field label="Key" hint="Card ids: KEY-12">
            <Input value={key} onChange={(e) => setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))} placeholder="Auto" />
          </Field>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-[12px] font-medium text-[var(--kb-ink-2)]">Start from</span>
          <div className="grid gap-2 sm:grid-cols-2">
            {templates.map((t) => (
              <button key={t.id} type="button" onClick={() => setTpl(t.id)} aria-pressed={tpl === t.id} className={cn('kb-focus flex flex-col gap-2 rounded-[var(--kb-radius)] border p-3 text-left transition-colors', tpl === t.id ? 'border-[var(--kb-accent)] bg-[var(--kb-accent-soft)]' : 'border-[var(--kb-line)] hover:bg-[var(--kb-main-hover)]')}>
                <span className="text-[13px] font-semibold">{t.label}</span>
                <span className="text-[12px] leading-4 text-[var(--kb-muted)]">{t.description}</span>
                <span className="flex flex-wrap gap-1">
                  {t.columns.map((c) => (
                    <span key={c.name} title={c.agent ? 'The agent works this column' : undefined} className="inline-flex h-5 items-center gap-1 rounded-full bg-[var(--kb-main)] px-1.5 text-[11px] text-[var(--kb-ink-2)] ring-1 ring-inset ring-[var(--kb-hair)]">
                      <CategoryIcon category={c.category} size={10} />
                      {c.name}
                      {c.agent && <Bot size={10} aria-hidden />}
                    </span>
                  ))}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
