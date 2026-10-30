/**
 * The Image tab: the result's size and histogram, the original file's facts
 * (format, colour profile, transparency, frames), what the camera wrote, the
 * location and what happens to it on export, and the image's own details
 * (name, title, alt text, keywords, notes), which exports carry.
 */
import { useEffect, useState } from 'react';
import { MapPin, Pin, PinOff, Sparkles } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { api } from '../../lib/api.ts';
import { useApp } from '../../lib/context.tsx';
import { bytes, dims as fmtDims, megapixels, num } from '../../lib/format.ts';
import { useLive } from '../../lib/live.ts';
import type { Histogram, ImageDetail } from '../../lib/types.ts';
import { Button, PropSection, Spinner, Stat, errMessage, inputCls, textareaCls } from '../ui.tsx';

function area(values: number[], w: number, h: number): string {
  const n = values.length;
  const pts = values.map((v, i) => `${((i + 0.5) / n) * w},${h - Math.min(1, v) * h}`);
  return `M0,${h} L${pts.join(' L')} L${w},${h} Z`;
}

export function HistogramChart({ hist, className }: { hist: Histogram; className?: string }): React.JSX.Element {
  const W = 256;
  const H = 72;
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-[72px] w-full rounded-[var(--iu-r-sm)] bg-[var(--iu-row)]" role="img" aria-label="Histogram">
        <path d={area(hist.r, W, H)} fill="rgba(229,57,53,0.42)" />
        <path d={area(hist.g, W, H)} fill="rgba(67,160,71,0.42)" />
        <path d={area(hist.b, W, H)} fill="rgba(30,136,229,0.42)" />
        <path d={area(hist.luma, W, H)} fill="none" stroke="var(--iu-ink)" strokeWidth={1.2} vectorEffect="non-scaling-stroke" opacity={0.8} />
      </svg>
      <div className="num flex justify-between text-[12px] text-[var(--iu-muted)]">
        <span className={cn(hist.clipped.shadows > 1 && 'font-semibold text-[var(--iu-amber-text)]')}>Shadows clipped {num(hist.clipped.shadows, 1)} %</span>
        <span className={cn(hist.clipped.highlights > 1 && 'font-semibold text-[var(--iu-amber-text)]')}>Highlights {num(hist.clipped.highlights, 1)} %</span>
      </div>
    </div>
  );
}

function Editable({ label, value, onSave, multiline = false, placeholder, hint }: { label: string; value: string; onSave: (v: string) => void; multiline?: boolean; placeholder?: string; hint?: React.ReactNode }): React.JSX.Element {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const save = (): void => {
    if (text.trim() !== value.trim()) onSave(text.trim());
  };
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-center justify-between text-[12px] text-[var(--iu-ink-2)]">
        {label}
        {hint}
      </span>
      {multiline ? (
        <textarea rows={3} value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onBlur={save} onKeyDown={(e) => e.stopPropagation()} className={textareaCls} />
      ) : (
        <input value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onBlur={save} onKeyDown={(e) => (e.key === 'Enter' ? (e.target as HTMLInputElement).blur() : e.stopPropagation())} className={inputCls} />
      )}
    </label>
  );
}

export function InfoPanel({ d, onAskDescribe }: { d: ImageDetail; onAskDescribe: () => void }): React.JSX.Element {
  const { settings } = useApp();
  const info = useLive(() => api.info(d.id), [], [d.id, d.preview_url]);
  const save = (p: Parameters<typeof api.updateImage>[1]): void => {
    api.updateImage(d.id, p).catch((err: unknown) => toast.error(errMessage(err)));
  };
  const exif = info.data?.exif ?? d.exif ?? {};
  const keys = Object.keys(exif);
  const alt = d.alt_text;
  const stripGps = settings?.defaults.strip_gps !== false;
  return (
    <div className="flex flex-col">
      <PropSection title="Result">
        <Stat label="Size" value={fmtDims(d.out_width, d.out_height)} />
        <Stat label="Megapixels" value={megapixels(d.out_width, d.out_height)} />
        <Stat label="Edits" value={d.edits_count} />
        {d.exports_count > 0 && <Stat label="Exported" value={d.exports_count + (d.exports_count === 1 ? ' file' : ' files')} />}
      </PropSection>
      <PropSection title="Histogram">
        {info.data?.histogram !== null && info.data?.histogram !== undefined ? (
          <HistogramChart hist={info.data.histogram} />
        ) : (
          <div className="flex h-[72px] items-center justify-center rounded-[var(--iu-r-sm)] bg-[var(--iu-row)] text-[var(--iu-muted)]">{info.loading ? <Spinner size={13} /> : <span className="text-[12px]">Shows once the image engine is ready</span>}</div>
        )}
      </PropSection>
      <PropSection title="Original file">
        <Stat label="Format" value={d.format + (d.frames > 1 ? ' · ' + d.frames + ' frames' : '')} />
        <Stat label="Size" value={fmtDims(d.width, d.height)} />
        <Stat label="File size" value={bytes(d.bytes)} />
        <Stat label="Colour" value={d.mode + (d.alpha ? ' · transparency' : '')} />
        <Stat label="Profile" value={d.icc !== '' ? d.icc : 'None (sRGB assumed)'} />
        {d.wide_gamut && <p className="mt-1 text-[12px] leading-4 text-[var(--iu-ink-2)]">Wide-gamut colour: converted to sRGB for editing and export, so it looks the same everywhere.</p>}
        {d.frames > 1 && <Stat label="Duration" value={num(d.duration_ms / 1000, 1) + ' s'} />}
        {d.dpi !== null && d.dpi !== undefined && <Stat label="Resolution" value={d.dpi[0] + ' dpi'} />}
        {d.source_path !== undefined && d.source_path !== '' && (
          <p className="mono mt-1 line-clamp-2 break-all text-[12px] leading-4 text-[var(--iu-muted)]" title={'Imported from ' + d.source_path}>
            {d.source_path}
          </p>
        )}
      </PropSection>
      {keys.length > 0 && (
        <PropSection title="Camera">
          {keys.map((k) => (
            <Stat key={k} label={k} value={String(exif[k])} />
          ))}
        </PropSection>
      )}
      {d.gps !== null && (
        <PropSection title="Location">
          <p className="num flex items-center gap-1.5 text-[12px]">
            <MapPin size={13} aria-hidden className="text-[var(--iu-ink-2)]" />
            {num(d.gps.lat, 5)}, {num(d.gps.lon, 5)}
          </p>
          <p className={cn('mt-1 text-[12px] leading-4', stripGps ? 'text-[var(--iu-muted)]' : 'font-semibold text-[var(--iu-amber-text)]')}>{stripGps ? 'Removed from exports (Settings, export defaults).' : 'Exports keep the location: anyone with the file can see where it was taken.'}</p>
        </PropSection>
      )}
      <PropSection
        title="Details"
        actions={
          <button type="button" onClick={() => save({ pinned: !d.pinned })} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--iu-ink-2)] hover:text-[var(--iu-ink)]">
            {d.pinned ? <PinOff size={12} aria-hidden /> : <Pin size={12} aria-hidden />}
            {d.pinned ? 'Unpin' : 'Pin'}
          </button>
        }
      >
        <div className="flex flex-col gap-2">
          <Editable label="Name" value={d.name} onSave={(v) => v !== '' && save({ name: v })} hint={<span className="text-[var(--iu-muted)]">export file names</span>} />
          <Editable label="Title" value={d.title} onSave={(v) => save({ title: v })} />
          <Editable
            label="Alt text"
            value={alt}
            multiline
            placeholder="What the image shows, for people who cannot see it"
            onSave={(v) => save({ alt_text: v })}
            hint={<span className={cn('num', alt.length > 125 ? 'font-semibold text-[var(--iu-amber-text)]' : 'text-[var(--iu-muted)]')}>{alt.length}/125</span>}
          />
          <Button size="sm" variant="ghost" icon={Sparkles} onClick={onAskDescribe} className="self-start">
            Ask your AI agent to describe it
          </Button>
          <Editable
            label="Keywords"
            value={d.keywords.join(', ')}
            placeholder="beach, sunset, family"
            onSave={(v) =>
              save({
                keywords: v
                  .split(',')
                  .map((x) => x.trim())
                  .filter((x) => x !== ''),
              })
            }
          />
          <Editable label="Notes" value={d.notes} multiline onSave={(v) => save({ notes: v })} />
          <p className="text-[12px] leading-4 text-[var(--iu-muted)]">Exports with basic or full metadata carry the alt text as the file's description.</p>
        </div>
      </PropSection>
    </div>
  );
}
