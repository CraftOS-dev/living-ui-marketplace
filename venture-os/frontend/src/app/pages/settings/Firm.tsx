/**
 * Settings, Firm: name, base currency and zone; the date style behind More.
 * Fix 5: Logo, the firm's own logo (owner or admin): drop an image on the
 * preview or choose one, Remove. The preview is the sidebar's head as it
 * will look; once set, the sidebar shows the logo in place of the app's
 * name (settings.logo-set, settings.logo-remove, both audited).
 */
import { useEffect, useMemo, useState } from 'react';
import { ImageUp, X } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { Button, Field, Input, LoadError, More, Panel, Picker, Segmented, Skeleton, SubHeader } from '../../components/ui.tsx';
import { op, opForm } from '../../lib/api.ts';
import { allowed, refreshMe, useMe } from '../../lib/auth.ts';
import { LOGO_ACCEPT, logoProblem, primeImage, useImage } from '../../lib/images.ts';
import { act, useOp } from '../../lib/live.ts';
import { toast } from '../../lib/toast.ts';

/** settings.get (the parts this section edits). */
interface FirmRow {
  firm_name: string;
  logo_url?: string | undefined;
  base_currency: string;
  zone: string;
  date_style: string;
  zones: string[];
}

export function FirmSettings(): React.JSX.Element {
  const me = useMe();
  const live = useOp<FirmRow>('settings.get', {}, ['settings'], { name: 'settings.get' });
  const [draft, setDraft] = useState<FirmRow | null>(null);
  const [busy, setBusy] = useState(false);
  const zoneItems = useMemo(() => (live.data?.zones ?? []).map((z) => ({ value: z, label: z.replace(/_/g, ' ') })), [live.data]);
  useEffect(() => {
    if (live.data !== null && draft === null) setDraft(live.data);
  }, [live.data, draft]);
  const edit = allowed(me, 'admin');
  if (live.data === null || draft === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Skeleton className="h-40 w-full" />;
  const s = live.data;
  const dirty = draft.firm_name !== s.firm_name || draft.base_currency !== s.base_currency || draft.zone !== s.zone || draft.date_style !== s.date_style;
  const save = async (): Promise<void> => {
    setBusy(true);
    const out = await act([], () => op('settings.update', { firm_name: draft.firm_name.trim(), base_currency: draft.base_currency.trim().toUpperCase(), zone: draft.zone, date_style: draft.date_style }), ['settings']);
    setBusy(false);
    if (out !== null) void refreshMe();
  };
  return (
    <>
      <SubHeader title="Firm">
        {edit && (
          <Button variant="primary" busy={busy} disabled={!dirty || draft.firm_name.trim() === '' || !/^[A-Za-z]{3}$/.test(draft.base_currency)} onClick={() => void save()}>
            Save
          </Button>
        )}
      </SubHeader>
      <Panel>
        <div className="grid max-w-[520px] gap-4">
          <Field label="Name">
            <Input value={draft.firm_name} disabled={!edit} onChange={(e) => setDraft({ ...draft, firm_name: e.target.value })} aria-label="Firm name" />
          </Field>
          <Field label="Currency" tip="The firm's base currency. Funds keep their own.">
            <Input className="vo-mono w-24 uppercase" maxLength={3} value={draft.base_currency} disabled={!edit} onChange={(e) => setDraft({ ...draft, base_currency: e.target.value.toUpperCase() })} aria-label="Base currency" />
          </Field>
          <Field label="Time zone" tip="Every day in the app is a day in this zone.">
            <Picker value={draft.zone} onChange={(v) => setDraft({ ...draft, zone: v })} items={zoneItems} label="Time zone" disabled={!edit} />
          </Field>
          <More>
            <Field label="Dates">
              <Segmented
                label="Date style"
                value={draft.date_style as 'dmy' | 'mdy' | 'ymd' | 'iso'}
                onChange={(v) => edit && setDraft({ ...draft, date_style: v })}
                options={[
                  { value: 'dmy', label: '16 Nov' },
                  { value: 'mdy', label: 'Nov 16' },
                  { value: 'ymd', label: '2026/11/16' },
                  { value: 'iso', label: '2026-11-16' },
                ]}
              />
            </Field>
          </More>
        </div>
      </Panel>
      <FirmLogo url={s.logo_url ?? ''} name={s.firm_name} edit={edit} />
    </>
  );
}

/** Logo: the sidebar's head as it will look, with the firm's logo; drop or choose an image, Remove. */
function FirmLogo({ url, name, edit }: { url: string; name: string; edit: boolean }): React.JSX.Element {
  const [shown, setShown] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [input, setInput] = useState<HTMLInputElement | null>(null);
  const current = shown ?? url;
  const src = useImage(current);
  const has = current !== '' && src !== null;

  const put = async (file: File): Promise<void> => {
    const problem = logoProblem(file);
    if (problem !== null) {
      toast.error(problem);
      return;
    }
    const local = URL.createObjectURL(file);
    setShown(local);
    setBusy(true);
    const out = await act([], () => opForm<{ logo_url: string }>('settings.logo-set', {}, { file }), ['settings']);
    setBusy(false);
    if (out === null) {
      setShown(null);
      return;
    }
    primeImage(out.logo_url, local);
    await refreshMe();
    setShown(null);
  };
  const remove = async (): Promise<void> => {
    setShown('');
    setBusy(true);
    const out = await act([], () => op('settings.logo-remove', {}), ['settings']);
    setBusy(false);
    if (out !== null) await refreshMe();
    setShown(null);
  };

  return (
    <Panel label="Logo" tip="Your firm's logo shows at the top of the sidebar in place of Venture OS. A PNG, JPG, WebP or SVG image, 2 MB at most; a wide logo on a transparent background looks best." divided>
      <div className="flex min-w-0 flex-wrap items-center gap-4">
        <div
          data-vo-drop=""
          role={edit ? 'button' : undefined}
          tabIndex={edit ? 0 : undefined}
          aria-label={edit ? 'Choose a logo image, or drop one here' : 'Logo preview'}
          title={edit ? 'Choose an image, or drop one here' : undefined}
          onClick={edit ? () => input?.click() : undefined}
          onKeyDown={edit ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), input?.click()) : undefined}
          onDragOver={
            edit
              ? (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setOver(true);
                }
              : undefined
          }
          onDragLeave={() => setOver(false)}
          onDrop={
            edit
              ? (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setOver(false);
                  const f = e.dataTransfer.files[0];
                  if (f !== undefined) void put(f);
                }
              : undefined
          }
          className={cn('vo-focus flex h-14 w-[232px] max-w-full shrink-0 items-center gap-2 rounded-[var(--vo-radius)] border px-3.5 transition-colors duration-150', edit && 'cursor-pointer', over ? 'border-dashed border-[var(--vo-ink-2)] bg-[var(--vo-hover)]' : edit ? 'border-dashed border-[var(--vo-line-2)] bg-[var(--vo-side)] hover:bg-[var(--vo-hover)]' : 'border-[var(--vo-line)] bg-[var(--vo-side)]')}
        >
          {has ? (
            <span className="flex min-h-7 min-w-0 flex-1 items-center" title={name}>
              {src !== undefined && (
                <span className="vo-logo-plate inline-flex max-w-full items-center">
                  <img src={src} alt={name} draggable={false} className={cn('block h-auto max-h-7 w-auto max-w-[160px] object-contain', busy && 'vo-pulse')} />
                </span>
              )}
            </span>
          ) : (
            <span className="flex min-w-0 flex-1 items-center gap-2 text-[13px] text-[var(--vo-muted)]">
              <ImageUp size={16} strokeWidth={1.8} aria-hidden className="shrink-0" />
              <span className="truncate">{edit ? 'Drop your logo here' : 'No logo yet'}</span>
            </span>
          )}
        </div>
        {edit && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button icon={ImageUp} busy={busy && shown !== ''} onClick={() => input?.click()}>
              {has ? 'Replace image' : 'Choose image'}
            </Button>
            {has && (
              <Button variant="ghost" icon={X} disabled={busy} onClick={() => void remove()}>
                Remove
              </Button>
            )}
          </div>
        )}
        <input
          ref={setInput}
          type="file"
          accept={LOGO_ACCEPT}
          className="hidden"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f !== undefined) void put(f);
          }}
        />
      </div>
    </Panel>
  );
}
