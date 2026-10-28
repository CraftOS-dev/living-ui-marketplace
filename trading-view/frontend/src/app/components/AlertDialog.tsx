/**
 * Create or edit an alert: what to watch (price, today's change or an
 * indicator), how it compares (crosses, above, below) with what (a value,
 * another indicator, a drawn line), on which bars, how often, until when,
 * and whether the AI agent explains it when it fires.
 */
import { useEffect, useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { toast } from '../../kit/index.ts';
import { api, errMessage } from '../lib/api.ts';
import type { AlertInput } from '../lib/api.ts';
import { short } from '../lib/format.ts';
import { useQuote } from '../lib/live.ts';
import * as ta from '../lib/ta.js';
import { INTERVALS } from '../lib/types.ts';
import type { Alert, Interval, Side } from '../lib/types.ts';
import { Btn, Field, input, Modal, Seg, Select, Toggle } from './ui.tsx';

export interface AlertPreset {
  symbol: string;
  interval?: Interval;
  price?: number;
  drawing?: string;
  alert?: Alert;
}

type LeftKind = 'price' | 'change' | 'indicator';
type RightKind = 'value' | 'indicator' | 'drawing';

interface IndSide {
  id: string;
  params: Record<string, number | string>;
  output: string;
}

const OPS: { value: AlertInput['op'] & string; label: string }[] = [
  { value: 'crosses', label: 'Crosses' },
  { value: 'crosses_up', label: 'Crosses up' },
  { value: 'crosses_down', label: 'Crosses down' },
  { value: 'above', label: 'Is above' },
  { value: 'below', label: 'Is below' },
];

const IND_OPTIONS = ta.CATALOGUE.filter((d) => d.id !== 'volume').map((d) => ({ value: d.id, label: d.name, group: d.group }));

function IndicatorFields({ v, onChange }: { v: IndSide; onChange: (v: IndSide) => void }): React.JSX.Element {
  const def = ta.find(v.id);
  const prm = ta.params(v.id, v.params);
  return (
    <div className="flex flex-col gap-2">
      <Select label="Indicator" value={v.id} onChange={(id) => onChange({ id, params: {}, output: ta.find(id)?.outputs[0]?.key ?? '' })} options={IND_OPTIONS} />
      <div className="flex flex-wrap gap-2">
        {def?.params
          .filter((p) => p.options === undefined)
          .map((p) => (
            <label key={p.key} className="flex items-center gap-1 text-[11.5px] text-[var(--tv-ink-2)]">
              {p.label}
              <input type="number" className={input + ' num w-16'} value={String(v.params[p.key] ?? prm[p.key])} min={p.min} max={p.max} step={p.step} onChange={(e) => onChange({ ...v, params: { ...v.params, [p.key]: Number(e.target.value) } })} />
            </label>
          ))}
        {def !== null && def.outputs.filter((o) => o.kind !== 'hidden').length > 1 && (
          <Select
            small
            label="Output"
            value={v.output}
            onChange={(output) => onChange({ ...v, output })}
            options={def.outputs.filter((o) => o.kind !== 'hidden').map((o) => ({ value: o.key, label: o.label }))}
          />
        )}
      </div>
    </div>
  );
}

function sideFrom(s: Side | undefined): IndSide {
  if (s !== undefined && s.type === 'indicator') return { id: s.id, params: s.params, output: s.output };
  return { id: 'rsi', params: {}, output: 'rsi' };
}

export function AlertDialog({ preset, onClose, pickSymbol }: { preset: AlertPreset | null; onClose: () => void; pickSymbol: (cb: (s: string) => void) => void }): React.JSX.Element | null {
  const editing = preset?.alert ?? null;
  const cond = editing?.condition ?? null;
  const [symbol, setSymbol] = useState(preset?.symbol ?? 'AAPL');
  const [interval, setInterval] = useState<Interval>(editing?.interval ?? preset?.interval ?? '1D');
  const [left, setLeft] = useState<LeftKind>(cond?.left.type === 'change' ? 'change' : cond?.left.type === 'indicator' ? 'indicator' : 'price');
  const [leftInd, setLeftInd] = useState<IndSide>(sideFrom(cond?.left));
  const [op, setOp] = useState<string>(cond?.op ?? 'crosses');
  const [right, setRight] = useState<RightKind>(cond?.right.type === 'indicator' ? 'indicator' : cond?.right.type === 'drawing' || preset?.drawing !== undefined ? 'drawing' : 'value');
  const [rightInd, setRightInd] = useState<IndSide>(cond?.right.type === 'indicator' ? sideFrom(cond.right) : { id: 'sma', params: { length: 50 }, output: 'ma' });
  const [value, setValue] = useState<string>(cond?.right.type === 'value' ? String(cond.right.value) : preset?.price !== undefined ? String(Number(preset.price.toPrecision(8))) : '');
  const drawing = cond?.right.type === 'drawing' ? cond.right.id : (preset?.drawing ?? '');
  const [frequency, setFrequency] = useState<'once' | 'once_per_bar' | 'every'>(editing?.frequency ?? 'once');
  const [expires, setExpires] = useState(editing?.expires ? editing.expires.slice(0, 10) : '');
  const [message, setMessage] = useState(editing?.message ?? '');
  const [notify, setNotify] = useState(editing?.notify_agent ?? false);
  const [busy, setBusy] = useState(false);
  const quote = useQuote(symbol);

  useEffect(() => {
    if (value === '' && quote?.price !== null && quote?.price !== undefined && left === 'price' && right === 'value' && editing === null) setValue(String(quote.price));
  }, [quote?.price, value, left, right, editing]);

  const summary = useMemo(() => {
    const l = left === 'price' ? short(symbol) : left === 'change' ? "Today's change of " + short(symbol) : ta.label(leftInd.id, ta.params(leftInd.id, leftInd.params)) + ' of ' + short(symbol);
    const o = OPS.find((x) => x.value === op)?.label.toLowerCase() ?? op;
    const r = right === 'value' ? (value === '' ? '?' : value + (left === 'change' ? '%' : '')) : right === 'drawing' ? 'the drawn line' : ta.label(rightInd.id, ta.params(rightInd.id, rightInd.params));
    return l + ' ' + o + ' ' + r;
  }, [left, leftInd, op, right, rightInd, value, symbol]);

  if (preset === null) return null;

  const save = async (): Promise<void> => {
    const p: AlertInput = { symbol, interval, op, frequency, message, notify_agent: notify };
    if (left === 'change') p.watch = 'change';
    if (left === 'indicator') {
      p.indicator = leftInd.id;
      p.params = leftInd.params;
      p.output = leftInd.output;
    }
    if (right === 'value') {
      const v = Number(value);
      if (value.trim() === '' || !isFinite(v)) {
        toast.error('Give a number to compare with');
        return;
      }
      p.value = v;
    } else if (right === 'indicator') {
      p.against = rightInd.id;
      p.against_params = rightInd.params;
      p.against_output = rightInd.output;
    } else p.drawing = drawing;
    if (expires !== '') p.expires = expires;
    else if (editing !== null && editing.expires !== '') p.expires = '';
    setBusy(true);
    try {
      if (editing !== null) {
        const { symbol: _s, ...rest } = p;
        await api.updateAlert(editing.id, rest);
        toast.success('Alert updated');
      } else {
        const r = await api.createAlert(p);
        toast.success(r.fired_now ? 'Alert created; its condition already holds, so it fired' : 'Alert created: ' + r.alert.text);
      }
      onClose();
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      width="md"
      onClose={onClose}
      title={editing !== null ? 'Edit alert' : 'New alert'}
      description="Checked by the app every minute, also with the window closed."
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" loading={busy} onClick={() => void save()}>
            {editing !== null ? 'Save' : 'Create alert'}
          </Btn>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-[1fr_auto] items-end gap-2">
          <Field label="Symbol">
            <button type="button" disabled={editing !== null} onClick={() => pickSymbol(setSymbol)} className={input + ' text-left font-bold disabled:opacity-70'}>
              {short(symbol)}
            </button>
          </Field>
          <Field label="Bars">
            <Select label="Interval of the bars the condition reads" value={interval} onChange={(v) => setInterval(v as Interval)} options={INTERVALS.map((i) => ({ value: i, label: i }))} />
          </Field>
        </div>
        <Field label="Watch">
          <Seg<LeftKind>
            value={left}
            onChange={setLeft}
            options={[
              { value: 'price', label: 'Price' },
              { value: 'change', label: "Today's change %" },
              { value: 'indicator', label: 'Indicator' },
            ]}
          />
        </Field>
        {left === 'indicator' && <IndicatorFields v={leftInd} onChange={setLeftInd} />}
        <Field label="Condition">
          <Select label="Condition" value={op} onChange={setOp} options={OPS} />
        </Field>
        <Field label="Compared with">
          <Seg<RightKind>
            value={right}
            onChange={setRight}
            options={[
              { value: 'value', label: 'Value' },
              ...(left === 'change' ? [] : [{ value: 'indicator' as RightKind, label: 'Indicator' }]),
              ...(drawing !== '' && left !== 'change' ? [{ value: 'drawing' as RightKind, label: 'Drawn line' }] : []),
            ]}
          />
        </Field>
        {right === 'value' && <input className={input + ' num'} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder={left === 'change' ? 'Percent, e.g. 3 or -3' : 'Price'} aria-label="Value" />}
        {right === 'indicator' && <IndicatorFields v={rightInd} onChange={setRightInd} />}
        <p className="rounded-[5px] bg-[var(--tv-row)] px-2.5 py-1.5 text-[12px] font-semibold">{summary}</p>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Fires">
            <Select
              label="Fires"
              value={frequency}
              onChange={(v) => setFrequency(v as typeof frequency)}
              options={[
                { value: 'once', label: 'Once' },
                { value: 'once_per_bar', label: 'Once per bar' },
                { value: 'every', label: 'Every time' },
              ]}
            />
          </Field>
          <Field label="Expires">
            <input type="date" className={input} value={expires} onChange={(e) => setExpires(e.target.value)} aria-label="Expires" />
          </Field>
        </div>
        <Field label="Message">
          <input className={input} value={message} maxLength={500} onChange={(e) => setMessage(e.target.value)} placeholder="Shown when it fires (optional)" />
        </Field>
        <label className="flex items-start justify-between gap-3 rounded-[5px] border border-[var(--tv-hair)] px-2.5 py-2">
          <span className="flex items-start gap-2">
            <Sparkles size={14} className="mt-0.5 text-[var(--tv-accent-text)]" />
            <span>
              <span className="block text-[12.5px] font-semibold">Send to my AI agent</span>
              <span className="block text-[11.5px] leading-4 text-[var(--tv-muted)]">When it fires, your AI agent looks at the chart and explains what happened and what to watch.</span>
            </span>
          </span>
          <Toggle label="Send to my AI agent" checked={notify} onChange={setNotify} />
        </label>
      </div>
    </Modal>
  );
}
