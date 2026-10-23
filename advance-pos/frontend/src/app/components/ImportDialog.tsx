/**
 * Importing a CSV (products or customers): choose a file or paste the
 * text, check it (nothing is saved; the counts of what would change come
 * back, or the first row with a problem), then import. All or nothing: a
 * file with an error changes nothing.
 */
import { useEffect, useRef, useState } from 'react';
import { FileUp, Upload } from 'lucide-react';
import { toast } from '../../kit/index.ts';
import { errMessage } from '../lib/api.ts';
import type { ImportResult } from '../lib/types.ts';
import { Button, Modal, textareaCls } from './ui.tsx';

const LABELS: Record<string, string> = {
  products_created: 'New products',
  products_updated: 'Products changed',
  variants_created: 'New variants',
  variants_updated: 'Variants changed',
  stock_counted: 'Stock levels set',
  categories_created: 'New categories',
  created: 'New customers',
  updated: 'Customers changed',
};

export function ImportDialog({
  open,
  onClose,
  title,
  columns,
  required,
  run,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  columns: string[];
  required: string[];
  run: (csv: string, dryRun: boolean) => Promise<ImportResult>;
}): React.JSX.Element {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [check, setCheck] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'check' | 'import' | null>(null);
  const input = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setText('');
      setFileName('');
      setCheck(null);
      setError(null);
    }
  }, [open]);

  const read = (f: File): void => {
    if (f.size > 20 * 1024 * 1024) {
      setError('The file is larger than 20 MB');
      return;
    }
    void f.text().then((t) => {
      setText(t);
      setFileName(f.name);
      setCheck(null);
      setError(null);
    });
  };

  const go = async (dry: boolean): Promise<void> => {
    setBusy(dry ? 'check' : 'import');
    setError(null);
    try {
      const r = await run(text, dry);
      if (dry) setCheck(r);
      else {
        toast.success('Imported ' + r.rows + ' rows');
        onClose();
      }
    } catch (err) {
      setCheck(null);
      setError(errMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const counts = check === null ? [] : Object.entries(check).filter(([k, v]) => typeof v === 'number' && k !== 'rows' && LABELS[k] !== undefined);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      wide
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button loading={busy === 'check'} disabled={text.trim() === '' || busy !== null} onClick={() => void go(true)}>
            Check the file
          </Button>
          <Button variant="primary" icon={Upload} loading={busy === 'import'} disabled={check === null || busy !== null} onClick={() => void go(false)}>
            Import
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f !== undefined) read(f);
          }}
          className="flex items-center gap-3 rounded-[var(--ps-r-md)] border border-dashed border-[var(--ps-line)] bg-[var(--ps-row)] px-3 py-3"
        >
          <FileUp size={18} className="shrink-0 text-[var(--ps-ink-2)]" />
          <span className="min-w-0 flex-1 truncate text-[13px]">{fileName !== '' ? fileName : 'Drop a CSV file here'}</span>
          <Button size="sm" onClick={() => input.current?.click()}>
            Choose a file
          </Button>
          <input
            ref={input}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f !== undefined) read(f);
              e.target.value = '';
            }}
          />
        </div>
        <textarea
          className={textareaCls + ' mono h-36'}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setFileName('');
            setCheck(null);
          }}
          placeholder={columns.join(',')}
          aria-label="CSV text"
          spellCheck={false}
        />
        <p className="text-[12px] leading-4 text-[var(--ps-muted)]">
          Columns: {columns.map((c, i) => (
            <span key={c}>
              <code className={required.includes(c) ? 'font-bold text-[var(--ps-ink)]' : undefined}>{c}</code>
              {i < columns.length - 1 ? ', ' : ''}
            </span>
          ))}
          . Bold ones are required; rows that match an existing record by name or code update it.
        </p>
        {error !== null && <p className="rounded-[var(--ps-r)] bg-[var(--ps-red)]/10 px-3 py-2 text-[13px] font-medium text-[var(--ps-red-text)]">{error}</p>}
        {check !== null && (
          <div className="rounded-[var(--ps-r)] bg-[var(--ps-green)]/12 px-3 py-2 text-[13px]">
            <p className="font-semibold text-[var(--ps-green-text)]">The file is fine: {check.rows} rows</p>
            <ul className="mt-1 grid grid-cols-2 gap-x-4 text-[12px] text-[var(--ps-ink-2)]">
              {counts.map(([k, v]) => (
                <li key={k} className="flex justify-between">
                  <span>{LABELS[k]}</span>
                  <span className="num font-semibold">{String(v)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
