/**
 * In-house diagrams for lessons and the reference: small technical drawings
 * of the voice, the breath, pitch and notation, drawn by hand as inline SVG.
 *
 * Every colour comes from the theme's variables, so each figure reads on the
 * light and the dark theme: ink for lines and words, grey steps for the
 * scaffolding, voice blue for the one thing each figure is about, and red
 * only for a warning. Labels are small monospaced capitals.
 */
import type { CSSProperties, ReactNode } from 'react';
import type { FigureKey } from './schema.ts';

/* ---------------------------------------------------------------- paint */

type Col = 'ink' | 'ink2' | 'muted' | 'line' | 'hair' | 'sunk' | 'panel' | 'voice' | 'voiceSoft' | 'bad';

const COL: Record<Col, string> = {
  ink: 'var(--sc-ink)',
  ink2: 'var(--sc-ink-2)',
  muted: 'var(--sc-muted)',
  line: 'var(--sc-line)',
  hair: 'var(--sc-hair)',
  sunk: 'var(--sc-sunk)',
  panel: 'var(--sc-panel)',
  voice: 'var(--sc-voice)',
  voiceSoft: 'var(--sc-voice-soft)',
  bad: 'var(--sc-bad)',
};

const FONT = {
  mono: 'var(--sc-mono, ui-monospace, monospace)',
  sans: 'var(--sc-font, system-ui, sans-serif)',
  serif: 'Georgia, "Times New Roman", serif',
} as const;

interface Ink {
  c?: Col | 'none';
  w?: number;
  dash?: string;
  fill?: Col;
  op?: number;
}

/** A stroke (and optional fill) as an inline style. */
function ink({ c = 'ink', w = 1.25, dash, fill, op }: Ink = {}): CSSProperties {
  const s: CSSProperties = {
    stroke: c === 'none' ? 'none' : COL[c],
    strokeWidth: w,
    fill: fill === undefined ? 'none' : COL[fill],
  };
  if (dash !== undefined) s.strokeDasharray = dash;
  if (op !== undefined) s.fillOpacity = op;
  return s;
}

/** A fill with no stroke. */
function paint(c: Col, op?: number): CSSProperties {
  const s: CSSProperties = { fill: COL[c], stroke: 'none' };
  if (op !== undefined) s.fillOpacity = op;
  return s;
}

/* ------------------------------------------------------------- geometry */

type Pt = readonly [number, number];

const f1 = (n: number): string => String(Math.round(n * 10) / 10);

/** A polyline (or a closed polygon) as path data. */
function poly(points: readonly Pt[], close = false): string {
  return points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${f1(x)} ${f1(y)}`).join(' ') + (close ? ' Z' : '');
}

/** Samples y = fn(x) from x0 to x1. */
function sample(x0: number, x1: number, step: number, fn: (x: number) => number): Pt[] {
  const out: Pt[] = [];
  const n = Math.max(1, Math.round((x1 - x0) / step));
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    out.push([x, fn(x)]);
  }
  return out;
}

/** A resonance-shaped bump: 1 at the centre, falling away either side. */
const peak = (x: number, centre: number, width: number): number => 1 / (1 + ((x - centre) / width) ** 2);

const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));
const smooth = (t: number): number => {
  const u = clamp01(t);
  return u * u * (3 - 2 * u);
};

/** Repeatable noise in -1..1. */
function noise(i: number): number {
  const s = Math.sin(i * 12.9898 + 4.1414) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

/** 45° hatching clipped to a rectangle. */
function hatch(x: number, y: number, w: number, h: number, gap: number): string {
  const parts: string[] = [];
  for (let k = x + y + gap; k < x + w + y + h; k += gap) {
    const ax = Math.max(x, k - (y + h));
    const bx = Math.min(x + w, k - y);
    if (bx - ax > 0.5) parts.push(`M${f1(ax)} ${f1(k - ax)} L${f1(bx)} ${f1(k - bx)}`);
  }
  return parts.join(' ');
}

/* --------------------------------------------------------------- pieces */

interface Box {
  className?: string | undefined;
}

function Frame({ w, h, label, className, children }: { w: number; h: number; label: string; className?: string | undefined; children: ReactNode }): React.JSX.Element {
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width="100%"
      role="img"
      aria-label={label}
      className={['block h-auto max-h-[240px] w-full select-none', className ?? ''].join(' ').trim()}
      style={{ fontFamily: FONT.mono, overflow: 'visible' }}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

interface TxProps {
  x: number;
  y: number;
  children: ReactNode;
  c?: Col;
  size?: number;
  anchor?: 'start' | 'middle' | 'end';
  /** Small capitals: a little letter spacing (write the words in capitals). */
  caps?: boolean;
  bold?: boolean;
  font?: keyof typeof FONT;
  italic?: boolean;
  rot?: number;
}

function Tx({ x, y, children, c = 'muted', size = 10, anchor = 'start', caps = false, bold = false, font = 'mono', italic = false, rot }: TxProps): React.JSX.Element {
  const style: CSSProperties = { fill: COL[c], stroke: 'none', fontFamily: FONT[font], fontSize: size, fontWeight: bold ? 600 : 400 };
  if (caps) style.letterSpacing = '0.06em';
  if (italic) style.fontStyle = 'italic';
  return (
    <text x={x} y={y} textAnchor={anchor} transform={rot === undefined ? undefined : `rotate(${rot} ${x} ${y})`} style={style}>
      {children}
    </text>
  );
}

function Ln({ x1, y1, x2, y2, ...o }: { x1: number; y1: number; x2: number; y2: number } & Ink): React.JSX.Element {
  return <line x1={x1} y1={y1} x2={x2} y2={y2} style={ink(o)} />;
}

function Pa({ d, ...o }: { d: string } & Ink): React.JSX.Element {
  return <path d={d} style={ink(o)} />;
}

function Dot({ x, y, r = 3, c = 'ink' }: { x: number; y: number; r?: number; c?: Col }): React.JSX.Element {
  return <circle cx={x} cy={y} r={r} style={paint(c)} />;
}

/** A line with an open arrowhead (or two). */
function Arrow({ x1, y1, x2, y2, c = 'ink2', w = 1.25, head = 5, both = false }: { x1: number; y1: number; x2: number; y2: number; c?: Col; w?: number; head?: number; both?: boolean }): React.JSX.Element {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const tip = (x: number, y: number, t: number): string =>
    `M${f1(x - head * Math.cos(t - 0.5))} ${f1(y - head * Math.sin(t - 0.5))} L${f1(x)} ${f1(y)} L${f1(x - head * Math.cos(t + 0.5))} ${f1(y - head * Math.sin(t + 0.5))}`;
  return (
    <g style={ink({ c, w })}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} />
      <path d={tip(x2, y2, a) + (both ? ' ' + tip(x1, y1, a + Math.PI) : '')} />
    </g>
  );
}

/** A leader from a label to the thing it names, with a small dot on the thing. */
function Leader({ from, to, c = 'line' }: { from: Pt; to: Pt; c?: Col }): React.JSX.Element {
  return (
    <g>
      <line x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} style={ink({ c, w: 0.9 })} />
      <circle cx={to[0]} cy={to[1]} r={1.6} style={paint(c === 'line' ? 'ink2' : c)} />
    </g>
  );
}

/** A thick rounded bar drawn as an outline (fingers, thumbs). */
function Capsule({ x1, y1, x2, y2, w }: { x1: number; y1: number; x2: number; y2: number; w: number }): React.JSX.Element {
  return (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} style={{ stroke: COL.ink, strokeWidth: w + 2.5, strokeLinecap: 'round' }} />
      <line x1={x1} y1={y1} x2={x2} y2={y2} style={{ stroke: COL.panel, strokeWidth: w, strokeLinecap: 'round' }} />
    </g>
  );
}

/* -------------------------------------------------------------- figures */

/** The source (folds' buzz), the filter (the tract's resonances) and the sound. */
function SourceFilter({ className }: Box): React.JSX.Element {
  const panels = [16, 200, 384] as const;
  const top = 34;
  const base = 176;
  const hx = (n: number): number => 14 + n * 12.6;
  const src = (n: number): number => 1 / n ** 0.75;
  const env = (x: number): number => 0.1 + 0.95 * peak(x, 38, 9) + 0.72 * peak(x, 78, 11) + 0.5 * peak(x, 116, 12);
  const envMax = Math.max(...sample(0, 160, 1, env).map(([, y]) => y));
  const harmonics = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const outMax = Math.max(...harmonics.map((n) => src(n) * env(hx(n))));
  const [p1, p2, p3] = panels;
  // The buzz: a train of glottal pulses, slow opening and quick closing.
  const pulse = (x: number): number => {
    const t = ((x - 12) / 26) % 1;
    const open = t < 0.62 ? Math.sin((t / 0.62) * (Math.PI / 2)) : Math.cos(((t - 0.62) / 0.38) * (Math.PI / 2));
    return 78 - 26 * Math.max(0, open) ** 1.6;
  };
  // A vowel-like tract: wide at the lips, a tongue constriction in the middle.
  const radius = (u: number): number => 7 + 3 * Math.sin(Math.PI * u) - 4 * Math.exp(-(((u - 0.62) / 0.12) ** 2)) + 5 * u ** 3;
  const tubeTop = sample(0, 1, 0.02, (u) => 64 - radius(u)).map(([u, y]) => [p2 + 14 + u * 132, y] as const);
  const tubeBottom = sample(0, 1, 0.02, (u) => 64 + radius(u)).map(([u, y]) => [p2 + 14 + u * 132, y] as const);
  const filterCurve = sample(6, 154, 1, (x) => base - (78 * env(x)) / envMax).map(([x, y]) => [p2 + x, y] as const);
  const outCurve = sample(hx(1), 150, 1, (x) => {
    const n = (x - 14) / 12.6;
    return base - (82 * env(x)) / n ** 0.75 / outMax;
  }).map(([x, y]) => [p3 + x, y] as const);
  const titles: [number, string, string][] = [
    [p1, 'SOURCE', 'the folds'],
    [p2, 'FILTER', 'the vocal tract'],
    [p3, 'SOUND', 'what we hear'],
  ];
  const captions = ['a buzz rich in harmonics', 'resonances (formants)', 'harmonics shaped by them'];
  return (
    <Frame w={560} h={226} label={DESCRIPTIONS['source-filter']} className={className}>
      {titles.map(([x, t, s], i) => (
        <g key={t}>
          <Tx x={x + 2} y={22} c={i === 1 ? 'voice' : 'ink'} size={10.5} caps bold>
            {t}
          </Tx>
          <Tx x={x + 158} y={22} anchor="end" size={9.5}>
            {s}
          </Tx>
          <rect x={x} y={top} width={160} height={164} rx={6} style={ink({ c: 'hair', w: 1 })} />
          <Ln x1={x + 8} y1={base} x2={x + 152} y2={base} c="line" w={1} />
          <Tx x={x + 80} y={216} anchor="middle" size={9.5}>
            {captions[i]}
          </Tx>
        </g>
      ))}
      {/* source: the buzz and its spectrum */}
      <Pa d={poly(sample(12, 142, 0.5, pulse).map(([x, y]) => [p1 + x, y] as const))} c="ink2" w={1.25} />
      <Ln x1={p1 + 10} y1={78} x2={p1 + 146} y2={78} c="hair" w={1} />
      <Tx x={p1 + 12} y={94} size={9}>
        BUZZ · AIR PUFFS
      </Tx>
      {harmonics.map((n) => (
        <Ln key={n} x1={p1 + hx(n)} y1={base} x2={p1 + hx(n)} y2={base - 70 * src(n)} c={n === 1 ? 'voice' : 'ink'} w={1.75} />
      ))}
      <Tx x={p1 + hx(1)} y={190} anchor="middle" size={9} c="voice">
        f₀
      </Tx>
      <Tx x={p1 + 150} y={190} anchor="end" size={9}>
        FREQ →
      </Tx>
      {/* filter: the tract and its resonances */}
      <path d={`${poly(tubeTop)} ${poly([...tubeBottom].reverse()).replace(/^M/, 'L')} Z`} style={ink({ c: 'ink2', w: 1.25, fill: 'sunk' })} />
      <Ln x1={p2 + 14} y1={58} x2={p2 + 14} y2={70} c="voice" w={2} />
      <Tx x={p2 + 10} y={47} size={9}>
        FOLDS
      </Tx>
      <Tx x={p2 + 150} y={47} anchor="end" size={9}>
        LIPS
      </Tx>
      <path d={`${poly(filterCurve)} L${f1(p2 + 154)} ${base} L${f1(p2 + 6)} ${base} Z`} style={paint('voiceSoft')} />
      <Pa d={poly(filterCurve)} c="voice" w={1.5} />
      {(
        [
          [38, 'F1'],
          [78, 'F2'],
          [116, 'F3'],
        ] as const
      ).map(([x, l]) => (
        <Tx key={l} x={p2 + x} y={base - (78 * env(x)) / envMax - 6} anchor="middle" size={9} c="voice">
          {l}
        </Tx>
      ))}
      <Tx x={p2 + 150} y={190} anchor="end" size={9}>
        FREQ →
      </Tx>
      {/* sound: harmonics shaped by the filter */}
      <Pa d={poly(outCurve)} c="voice" w={1} dash="3 3" />
      {harmonics.map((n) => (
        <Ln key={n} x1={p3 + hx(n)} y1={base} x2={p3 + hx(n)} y2={base - (82 * src(n) * env(hx(n))) / outMax} c="ink" w={1.75} />
      ))}
      <Tx x={p3 + 150} y={190} anchor="end" size={9}>
        FREQ →
      </Tx>
      <Arrow x1={180} y1={116} x2={196} y2={116} c="ink2" />
      <Arrow x1={364} y1={116} x2={380} y2={116} c="ink2" />
    </Frame>
  );
}

/** The folds from above: apart for breathing, together for singing. */
function Folds({ className }: Box): React.JSX.Element {
  const views = [
    { x0: 20, open: true, title: 'OPEN · BREATHING' },
    { x0: 260, open: false, title: 'CLOSED · SINGING' },
  ];
  return (
    <Frame w={500} h={234} label={DESCRIPTIONS.folds} className={className}>
      {views.map(({ x0, open, title }) => {
        const cx = x0 + 110;
        const side = (s: 1 | -1): string =>
          open
            ? `M${cx + s * 3} 44 C${cx + s * 18} 80 ${cx + s * 40} 130 ${cx + s * 50} 166 C${cx + s * 48} 176 ${cx + s * 38} 180 ${cx + s * 30} 174 C${cx + s * 26} 140 ${cx + s * 14} 90 ${cx + s * 2} 50 Z`
            : `M${cx + s * 2} 44 C${cx + s * 16} 84 ${cx + s * 30} 132 ${cx + s * 34} 168 C${cx + s * 30} 178 ${cx + s * 12} 180 ${cx + s * 1} 172 L${cx + s * 1} 48 Z`;
        return (
          <g key={title}>
            <ellipse cx={cx} cy={112} rx={72} ry={80} style={ink({ c: 'line', w: 1.25, fill: 'sunk' })} />
            {open && <path d={`M${cx - 2} 50 C${cx - 14} 90 ${cx - 26} 140 ${cx - 30} 174 C${cx - 20} 186 ${cx + 20} 186 ${cx + 30} 174 C${cx + 26} 140 ${cx + 14} 90 ${cx + 2} 50 Z`} style={paint('ink', 0.13)} />}
            <path d={side(-1)} style={ink({ c: 'ink2', w: 1.25, fill: 'panel' })} />
            <path d={side(1)} style={ink({ c: 'ink2', w: 1.25, fill: 'panel' })} />
            <ellipse cx={cx - (open ? 34 : 14)} cy={183} rx={open ? 11 : 10} ry={8} style={ink({ c: 'ink2', w: 1.1, fill: 'panel' })} />
            <ellipse cx={cx + (open ? 34 : 14)} cy={183} rx={open ? 11 : 10} ry={8} style={ink({ c: 'ink2', w: 1.1, fill: 'panel' })} />
            {!open && <Pa d={poly(sample(50, 170, 1, (y) => cx + 1.4 * Math.sin(y / 3.2)).map(([y, x]) => [x, y] as const))} c="voice" w={1.75} />}
            <Tx x={cx} y={24} anchor="middle" size={9}>
              FRONT
            </Tx>
            <Tx x={cx} y={206} anchor="middle" size={9}>
              BACK
            </Tx>
            <Tx x={cx} y={226} anchor="middle" size={10.5} c={open ? 'ink' : 'voice'} caps bold>
              {title}
            </Tx>
            <Tx x={x0 - 2} y={108} size={9.5}>
              FOLD
            </Tx>
            <Leader from={[x0 + 26, 105]} to={[cx - (open ? 30 : 18), 116]} />
            {open ? (
              <>
                <Tx x={cx + 78} y={131} size={9.5}>
                  GLOTTIS
                </Tx>
                <Leader from={[cx + 76, 128]} to={[cx + 4, 128]} />
                <Tx x={cx + 78} y={175} size={9.5}>
                  ARYTENOID
                </Tx>
                <Leader from={[cx + 76, 172]} to={[cx + 42, 180]} />
              </>
            ) : (
              <>
                <Tx x={cx + 60} y={113} size={9.5} c="voice">
                  VIBRATE
                </Tx>
                <Leader from={[cx + 58, 110]} to={[cx + 2, 110]} c="voice" />
              </>
            )}
          </g>
        );
      })}
    </Frame>
  );
}

/** A side view of the larynx in the neck. */
function Larynx({ className }: Box): React.JSX.Element {
  const rings = [160, 172, 184, 196, 208, 220];
  const labels: [string, number, Pt, Col][] = [
    ['PHARYNX', 14, [224, 20], 'muted'],
    ['EPIGLOTTIS', 36, [195, 33], 'muted'],
    ['HYOID BONE', 60, [205, 58], 'muted'],
    ['THYROID CARTILAGE', 86, [206, 92], 'muted'],
    ['VOCAL FOLDS', 110, [188, 105], 'voice'],
    ['CRICOID', 138, [205, 138], 'muted'],
    ['ESOPHAGUS', 176, [230, 180], 'muted'],
    ['TRACHEA', 212, [200, 210], 'muted'],
  ];
  return (
    <Frame w={460} h={240} label={DESCRIPTIONS.larynx} className={className}>
      {/* neck front, tongue root, back wall of the throat */}
      <Pa d="M86 4 C104 40 116 62 120 92 L123 236" c="line" w={1} />
      <Pa d="M118 8 C146 14 162 34 168 64" c="line" w={1} />
      <Ln x1={232} y1={2} x2={232} y2={132} c="line" w={1} />
      {/* esophagus behind the windpipe */}
      <Pa d="M208 132 L208 236 M230 132 L230 236" c="line" w={1} dash="3 3" />
      {/* epiglottis */}
      <path d="M160 104 C162 80 172 50 192 30 C196 27 199 31 196 35 C182 54 174 80 168 106 Z" style={ink({ c: 'ink', w: 1.25, fill: 'panel' })} />
      {/* hyoid */}
      <rect x={150} y={54} width={56} height={7} rx={3.5} style={ink({ c: 'ink2', w: 1.25, fill: 'panel' })} />
      {/* thyroid cartilage with its horn, and the Adam's apple at the front */}
      <path d="M150 70 L142 84 L150 130 L204 122 L208 76 Z" style={ink({ c: 'ink2', w: 1.25 })} />
      <Ln x1={208} y1={76} x2={211} y2={64} c="ink2" />
      {/* cricoid: a signet ring, tall at the back */}
      <path d="M150 136 L150 148 L204 152 L206 126 C196 128 176 134 150 136 Z" style={ink({ c: 'ink2', w: 1.25 })} />
      {/* vocal folds from front to the arytenoid at the back */}
      <Ln x1={151} y1={110} x2={192} y2={104} c="voice" w={3} />
      <path d="M192 98 L202 106 L191 110 Z" style={ink({ c: 'ink2', w: 1.1, fill: 'panel' })} />
      {/* trachea with rings */}
      <Pa d="M152 152 L152 236 M200 154 L200 236" c="ink2" />
      {rings.map((y) => (
        <Pa key={y} d={`M152 ${y} Q176 ${y + 5} 200 ${y}`} c="line" w={1} />
      ))}
      {labels.map(([t, y, to, c]) => (
        <g key={t}>
          <Leader from={[296, y - 3]} to={to} c={c === 'voice' ? 'voice' : 'line'} />
          <Tx x={300} y={y} size={9.5} c={c}>
            {t}
          </Tx>
        </g>
      ))}
      <Leader from={[96, 81]} to={[142, 84]} />
      <Tx x={92} y={84} anchor="end" size={9.5}>
        ADAM'S APPLE
      </Tx>
      <Tx x={16} y={232} size={9}>
        ← FRONT
      </Tx>
    </Frame>
  );
}

/** Lung volume through one sung phrase: inhale, suspend, sing, recover. */
function BreathCycle({ className }: Box): React.JSX.Element {
  const easeOut = (t: number): number => 1 - (1 - clamp01(t)) ** 2;
  const y = (x: number): number => {
    if (x < 60) return 150;
    if (x < 130) return 150 - 94 * easeOut((x - 60) / 70);
    if (x < 176) return 56;
    if (x < 420) return 56 + 104 * ((x - 176) / 244) ** 1.2;
    return 160 - 10 * easeOut((x - 420) / 84);
  };
  const all = sample(44, 504, 1, y);
  const sing = sample(176, 420, 1, y);
  const phases: [string, number, number][] = [
    ['INHALE', 60, 130],
    ['SUSPEND', 130, 176],
    ['SING', 176, 420],
    ['RECOVER', 420, 504],
  ];
  return (
    <Frame w={520} h={206} label={DESCRIPTIONS['breath-cycle']} className={className}>
      {phases.map(([t, a, b]) => (
        <g key={t}>
          <Ln x1={a} y1={34} x2={a} y2={178} c="hair" w={1} />
          <Tx x={(a + b) / 2} y={26} anchor="middle" size={9.5} c={t === 'SING' ? 'voice' : 'ink2'} caps bold={t === 'SING'}>
            {t}
          </Tx>
        </g>
      ))}
      <Tx x={298} y={40} anchor="middle" size={9}>
        controlled exhale
      </Tx>
      <path d={`${poly(sing)} L420 178 L176 178 Z`} style={paint('voiceSoft')} />
      <Ln x1={44} y1={150} x2={504} y2={150} c="line" w={1} dash="3 3" />
      <Tx x={153} y={146} anchor="middle" size={9}>
        REST
      </Tx>
      <Pa d={poly(all)} c="ink" w={1.5} />
      <Pa d={poly(sing)} c="voice" w={2} />
      <Ln x1={44} y1={44} x2={44} y2={178} c="line" w={1} />
      <Ln x1={44} y1={178} x2={504} y2={178} c="line" w={1} />
      <Tx x={40} y={60} anchor="end" size={9}>
        FULL
      </Tx>
      <Tx x={20} y={118} anchor="middle" size={9} rot={-90}>
        LUNG VOLUME
      </Tx>
      <Tx x={504} y={194} anchor="end" size={9}>
        TIME →
      </Tx>
    </Frame>
  );
}

/** A side profile with the plumb line through ear, shoulder, hip and ankle. */
function Posture({ className }: Box): React.JSX.Element {
  const marks: [string, number][] = [
    ['EAR', 38],
    ['SHOULDER', 70],
    ['HIP', 144],
    ['ANKLE', 214],
  ];
  const notes: [string, number, Pt][] = [
    ['HEAD BALANCED, CHIN LEVEL', 30, [192, 32]],
    ['RIBS OPEN, SHOULDERS EASY', 82, [190, 84]],
    ['KNEES SOFT, NOT LOCKED', 186, [181, 186]],
    ['WEIGHT OVER BOTH FEET', 220, [190, 222]],
  ];
  return (
    <Frame w={380} h={236} label={DESCRIPTIONS.posture} className={className}>
      <Ln x1={110} y1={228} x2={250} y2={228} c="line" w={1} />
      {/* head, neck */}
      <circle cx={176} cy={36} r={15} style={ink({ c: 'ink', w: 1.25, fill: 'panel' })} />
      <Pa d="M190.5 32 L195 39 L190 40.5" c="ink" w={1.1} />
      <Pa d="M165 49 L164 63 M177 50 L178 63" c="ink" />
      {/* torso */}
      <path d="M162 64 C186 62 192 74 190 96 C189 114 182 124 183 142 L156 144 C152 120 150 92 156 74 C157 68 159 65 162 64 Z" style={ink({ c: 'ink', w: 1.25, fill: 'panel' })} />
      {/* arm */}
      <Pa d="M170 72 C172 88 170 100 170 108 C171 118 174 128 177 136" c="ink" w={1.5} />
      <circle cx={178} cy={140} r={3.2} style={ink({ c: 'ink', w: 1.25, fill: 'panel' })} />
      {/* legs with soft knees, and the foot */}
      <Pa d="M182 143 C184 160 181 176 178 186 C176 196 175 208 173 219" c="ink" />
      <Pa d="M157 144 C159 162 165 176 167 186 C167 198 164 210 164 219" c="ink" />
      <path d="M162 219 L163 227 L195 227 C195 222 186 219 173 218 Z" style={ink({ c: 'ink', w: 1.25, fill: 'panel' })} />
      {/* the line */}
      <Ln x1={168} y1={12} x2={168} y2={232} c="voice" w={1.25} dash="4 4" />
      {marks.map(([t, y]) => (
        <g key={t}>
          <Dot x={168} y={y} r={3.2} c="voice" />
          <Ln x1={124} y1={y} x2={162} y2={y} c="line" w={0.9} />
          <Tx x={120} y={y + 3.5} anchor="end" size={9.5} c="ink2">
            {t}
          </Tx>
        </g>
      ))}
      {notes.map(([t, y, to]) => (
        <g key={t}>
          <Leader from={[210, y - 3]} to={to} />
          <Tx x={214} y={y} size={9}>
            {t}
          </Tx>
        </g>
      ))}
    </Frame>
  );
}

/** Head and neck in section: pharynx, mouth and nose. */
function Resonators({ className }: Box): React.JSX.Element {
  const head =
    'M128 238 C126 214 118 196 108 178 C92 150 88 104 104 72 C122 36 170 18 214 22 C248 26 270 46 272 80 C272 88 270 92 272 96 L294 128 C296 132 290 136 282 135 L279 140 C284 144 284 150 280 152 L276 154 C282 156 282 164 276 166 C278 176 276 188 266 192 C248 196 232 196 222 200 C216 210 214 224 214 238';
  const right: [string, number, Pt][] = [
    ['SINUSES', 58, [258, 56]],
    ['NASAL CAVITY', 104, [258, 110]],
    ['MOUTH', 140, [256, 140]],
  ];
  const left: [string, number, Pt, Col][] = [
    ['PHARYNX', 172, [190, 172], 'voice'],
    ['LARYNX', 216, [187, 214], 'muted'],
  ];
  return (
    <Frame w={480} h={242} label={DESCRIPTIONS.resonators} className={className}>
      <Pa d={head} c="ink2" w={1.25} />
      {/* sinuses: frontal and sphenoid */}
      <Pa d="M238 52 C244 44 258 46 262 56 C262 64 250 68 242 64 C238 62 236 58 238 52 Z" c="muted" w={1} dash="2.5 2.5" />
      <Pa d="M196 92 C198 84 212 82 216 90 C218 98 206 102 200 100 C196 98 195 95 196 92 Z" c="muted" w={1} dash="2.5 2.5" />
      {/* nasal cavity */}
      <path d="M206 104 C216 92 248 88 276 104 L284 126 C270 124 230 122 208 124 C202 118 202 110 206 104 Z" style={ink({ c: 'ink2', w: 1.1, fill: 'sunk' })} />
      {/* pharynx */}
      <path d="M200 106 C190 108 184 116 184 128 L184 214 L200 214 C200 196 202 176 205 160 C201 154 197 148 196 140 C195 128 198 116 204 108 Z" style={ink({ c: 'voice', w: 1.25, fill: 'voiceSoft' })} />
      {/* mouth */}
      <path d="M210 130 L274 132 C278 140 278 146 276 152 C262 152 250 147 238 147 C224 147 214 152 205 159 C200 150 202 138 210 130 Z" style={ink({ c: 'voice', w: 1.25, fill: 'voiceSoft' })} />
      {/* hard and soft palate */}
      <Pa d="M276 129 L210 127 C200 129 194 136 196 146" c="ink" w={1.5} />
      {/* larynx and windpipe */}
      <Ln x1={185} y1={214} x2={199} y2={214} c="ink" w={2.5} />
      <Pa d="M186 216 L186 238 M199 216 L199 238" c="line" w={1} />
      {right.map(([t, y, to]) => (
        <g key={t}>
          <Leader from={[312, y - 3]} to={to} c={t === 'MOUTH' ? 'voice' : 'line'} />
          <Tx x={316} y={y} size={9.5} c={t === 'MOUTH' ? 'voice' : 'muted'}>
            {t}
          </Tx>
        </g>
      ))}
      {left.map(([t, y, to, c]) => (
        <g key={t}>
          <Leader from={[80, y - 3]} to={to} c={c === 'voice' ? 'voice' : 'line'} />
          <Tx x={76} y={y} anchor="end" size={9.5} c={c}>
            {t}
          </Tx>
        </g>
      ))}
      <Tx x={76} y={229} anchor="end" size={8.5}>
        THE SOURCE
      </Tx>
      {['Pharynx and mouth are the', 'main resonators; the nose', 'joins in for m, n and ng.'].map((l, i) => (
        <Tx key={l} x={316} y={170 + i * 13} size={9} c="ink2">
          {l}
        </Tx>
      ))}
      {['Sinus buzz is sympathetic', 'vibration, not resonance.'].map((l, i) => (
        <Tx key={l} x={316} y={218 + i * 13} size={9}>
          {l}
        </Tx>
      ))}
    </Frame>
  );
}

/** The harmonic series: f0 and its whole-number multiples. */
function Harmonics({ className }: Box): React.JSX.Element {
  const base = 160;
  const x = (n: number): number => 56 + (n - 1) * 46;
  const h = (n: number): number => 110 / n ** 0.7;
  const ns = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  return (
    <Frame w={500} h={200} label={DESCRIPTIONS.harmonics} className={className}>
      <Ln x1={36} y1={base} x2={488} y2={base} c="line" w={1} />
      {ns.map((n) => (
        <g key={n}>
          <Ln x1={x(n)} y1={base} x2={x(n)} y2={base - h(n)} c={n === 1 ? 'voice' : 'ink'} w={2} />
          <Dot x={x(n)} y={base - h(n)} r={2.6} c={n === 1 ? 'voice' : 'ink'} />
          <Tx x={x(n)} y={176} anchor="middle" size={10} c={n === 1 ? 'voice' : 'ink2'} bold={n === 1}>
            {n === 1 ? 'f₀' : `${n}f₀`}
          </Tx>
          <Tx x={x(n)} y={190} anchor="middle" size={8.5}>
            {String(220 * n)}
          </Tx>
        </g>
      ))}
      <Tx x={24} y={190} anchor="end" size={8.5}>
        Hz
      </Tx>
      <Tx x={64} y={56} size={9} c="voice">
        THE PITCH YOU HEAR
      </Tx>
      <Arrow x1={x(3) + 2} y1={98} x2={x(4) - 2} y2={98} c="ink2" w={1} head={4} both />
      <Tx x={(x(3) + x(4)) / 2} y={92} anchor="middle" size={9}>
        f₀ apart
      </Tx>
      <Tx x={488} y={154} anchor="end" size={9}>
        FREQUENCY →
      </Tx>
      <Tx x={36} y={30} size={9}>
        LEVEL
      </Tx>
      <Tx x={488} y={30} anchor="end" size={9}>
        f₀ = 220 Hz (A3)
      </Tx>
    </Frame>
  );
}

/** A vowel's spectrum envelope with F1, F2 and the singer's formant. */
function Formants({ className }: Box): React.JSX.Element {
  const x0 = 52;
  const per = 88;
  const base = 172;
  const X = (k: number): number => x0 + k * per;
  const e = (k: number): number =>
    0.06 + 1.0 * peak(k, 0.6, 0.16) + 0.78 * peak(k, 1.15, 0.2) + 0.42 * peak(k, 2.85, 0.13) + 0.5 * peak(k, 3.1, 0.15) + 0.4 * peak(k, 3.38, 0.13) + 0.1 * peak(k, 4.4, 0.3);
  const max = Math.max(...sample(0, 5, 0.01, e).map(([, y]) => y));
  const Y = (k: number): number => base - (124 * e(k)) / max;
  const curve = sample(0, 5, 0.01, (k) => Y(k)).map(([k, y]) => [X(k), y] as const);
  const band = sample(2.8, 3.4, 0.01, (k) => Y(k)).map(([k, y]) => [X(k), y] as const);
  return (
    <Frame w={520} h={210} label={DESCRIPTIONS.formants} className={className}>
      <rect x={X(2.8)} y={40} width={X(3.4) - X(2.8)} height={base - 40} style={paint('voiceSoft')} />
      <Ln x1={X(2.8)} y1={40} x2={X(2.8)} y2={base} c="voice" w={1} dash="3 3" />
      <Ln x1={X(3.4)} y1={40} x2={X(3.4)} y2={base} c="voice" w={1} dash="3 3" />
      <Tx x={X(3.1)} y={30} anchor="middle" size={9.5} c="voice" caps bold>
        SINGER'S FORMANT
      </Tx>
      <Tx x={X(3.4) + 6} y={62} size={9} c="voice">
        2.8–3.4 kHz
      </Tx>
      <Pa d={poly(curve)} c="ink" w={1.5} />
      <Pa d={poly(band)} c="voice" w={2.25} />
      <Tx x={X(0.6)} y={Y(0.6) - 7} anchor="middle" size={10} c="ink" bold>
        F1
      </Tx>
      <Tx x={X(1.15)} y={Y(1.15) - 7} anchor="middle" size={10} c="ink" bold>
        F2
      </Tx>
      <Tx x={X(1.45)} y={88} size={9}>
        F1 + F2 = THE VOWEL
      </Tx>
      <Ln x1={x0} y1={base} x2={X(5)} y2={base} c="line" w={1} />
      {[0, 1, 2, 3, 4, 5].map((k) => (
        <g key={k}>
          <Ln x1={X(k)} y1={base} x2={X(k)} y2={base + 4} c="ink2" w={1} />
          <Tx x={X(k)} y={base + 15} anchor="middle" size={9.5} c="ink2">
            {String(k)}
          </Tx>
        </g>
      ))}
      <Tx x={X(5)} y={204} anchor="end" size={9}>
        FREQUENCY · kHz
      </Tx>
      <Tx x={20} y={106} anchor="middle" size={9} rot={-90}>
        LEVEL
      </Tx>
    </Frame>
  );
}

const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'] as const;

/** Registers across C2–C6 with the usual M1→M2 switch. */
function Registers({ className }: Box): React.JSX.Element {
  const X = (s: number): number => 100 + s * 9; // semitones above C2
  const lanes: { t: string; y: number }[] = [
    { t: 'M1 · CHEST', y: 44 },
    { t: 'MIX', y: 68 },
    { t: 'M2 · HEAD', y: 92 },
  ];
  const semis = Array.from({ length: 49 }, (_, i) => i);
  return (
    <Frame w={544} h={176} label={DESCRIPTIONS.registers} className={className}>
      {[0, 12, 24, 36, 48].map((s) => (
        <Ln key={s} x1={X(s)} y1={36} x2={X(s)} y2={118} c="hair" w={1} />
      ))}
      {lanes.map(({ t, y }) => (
        <Tx key={t} x={16} y={y + 10.5} size={9.5} c={t === 'MIX' ? 'voice' : 'ink2'} caps>
          {t}
        </Tx>
      ))}
      {/* M1: solid to the switch, a dashed reach above it (belt, chest-mix) */}
      <rect x={X(0)} y={44} width={X(30) - X(0)} height={14} rx={7} style={ink({ c: 'ink2', w: 1.1, fill: 'sunk' })} />
      <rect x={X(28)} y={44} width={X(36) - X(28)} height={14} rx={7} style={ink({ c: 'line', w: 1, dash: '3 3' })} />
      <Tx x={X(33.5)} y={54.5} anchor="middle" size={8.5}>
        BELT
      </Tx>
      <rect x={X(26)} y={68} width={X(34) - X(26)} height={14} rx={7} style={ink({ c: 'voice', w: 1.25, fill: 'voiceSoft' })} />
      <rect x={X(19)} y={92} width={X(48) - X(19)} height={14} rx={7} style={ink({ c: 'ink2', w: 1.1, fill: 'sunk' })} />
      <Ln x1={X(29.5)} y1={36} x2={X(29.5)} y2={118} c="voice" w={1.25} dash="4 3" />
      <Tx x={X(29.5)} y={26} anchor="middle" size={9.5} c="voice">
        M1 → M2 ≈ F4–F♯4 · 350–370 Hz
      </Tx>
      <Ln x1={X(0)} y1={124} x2={X(48)} y2={124} c="line" w={1} />
      {semis.map((s) => (
        <Ln key={s} x1={X(s)} y1={124} x2={X(s)} y2={s % 12 === 0 ? 131 : 127} c={s % 12 === 0 ? 'ink2' : 'line'} w={1} />
      ))}
      {[0, 12, 24, 36, 48].map((s) => (
        <Tx key={s} x={X(s)} y={143} anchor="middle" size={10} c="ink2">
          {`C${2 + s / 12}`}
        </Tx>
      ))}
      <Tx x={X(24)} y={155} anchor="middle" size={8.5}>
        MIDDLE C
      </Tx>
      <Tx x={X(48)} y={170} anchor="end" size={8.5}>
        A TYPICAL PICTURE · EVERY VOICE DIFFERS
      </Tx>
    </Frame>
  );
}

/** Primo and secondo passaggio by voice type (after Richard Miller). */
function Passaggio({ className }: Box): React.JSX.Element {
  const X = (m: number): number => 160 + (m - 53) * 12.6; // F3 … A5
  const name = (m: number): string => `${NAMES[m % 12] ?? ''}${Math.floor(m / 12) - 1}`;
  // [voice, primo (MIDI), secondo (MIDI), primo name, secondo name]
  const rows: [string, number, number, string, string][] = [
    ['SOPRANO', 63, 78, 'E♭4', 'F♯5'],
    ['MEZZO', 64, 76, 'E4', 'E5'],
    ['CONTRALTO', 67, 74, 'G4', 'D5'],
    ['TENOR (LYRIC)', 62, 67, 'D4', 'G4'],
    ['BARITONE (LYRIC)', 59, 64, 'B3', 'E4'],
    ['BASS (LYRIC)', 56, 61, 'A♭3', 'D♭4'],
  ];
  const semis = Array.from({ length: 29 }, (_, i) => 53 + i);
  return (
    <Frame w={540} h={232} label={DESCRIPTIONS.passaggio} className={className}>
      {/* legend */}
      <circle cx={164} cy={15} r={3.5} style={ink({ c: 'ink', w: 1.25, fill: 'panel' })} />
      <Tx x={172} y={18.5} size={9}>
        PRIMO
      </Tx>
      <Dot x={226} y={15} r={3.5} c="voice" />
      <Tx x={234} y={18.5} size={9}>
        SECONDO
      </Tx>
      <rect x={296} y={11} width={22} height={8} rx={4} style={paint('voiceSoft')} />
      <Tx x={324} y={18.5} size={9}>
        ZONA DI PASSAGGIO
      </Tx>
      {[60, 72].map((m) => (
        <Ln key={m} x1={X(m)} y1={30} x2={X(m)} y2={190} c="hair" w={1} />
      ))}
      <Ln x1={16} y1={111} x2={X(81)} y2={111} c="hair" w={1} dash="2 3" />
      {rows.map(([t, a, b, na, nb], i) => {
        const y = 46 + i * 26;
        return (
          <g key={t}>
            <Tx x={16} y={y + 3.5} size={9.5} c="ink2" caps>
              {t}
            </Tx>
            <rect x={X(a)} y={y - 4.5} width={X(b) - X(a)} height={9} rx={4.5} style={paint('voiceSoft')} />
            <circle cx={X(a)} cy={y} r={3.8} style={ink({ c: 'ink', w: 1.25, fill: 'panel' })} />
            <Dot x={X(b)} y={y} r={3.8} c="voice" />
            <Tx x={X(a) - 8} y={y + 3.5} anchor="end" size={9.5} c="ink2">
              {na}
            </Tx>
            <Tx x={X(b) + 8} y={y + 3.5} size={9.5} c="voice">
              {nb}
            </Tx>
          </g>
        );
      })}
      <Ln x1={X(53)} y1={196} x2={X(81)} y2={196} c="line" w={1} />
      {semis.map((m) => (
        <Ln key={m} x1={X(m)} y1={196} x2={X(m)} y2={m % 12 === 0 ? 203 : 199} c={m % 12 === 0 ? 'ink2' : 'line'} w={1} />
      ))}
      {[60, 72].map((m) => (
        <Tx key={m} x={X(m)} y={214} anchor="middle" size={10} c="ink2">
          {name(m)}
        </Tx>
      ))}
      <Tx x={X(81)} y={228} anchor="end" size={8.5}>
        AFTER RICHARD MILLER
      </Tx>
    </Frame>
  );
}

/** The IPA vowel trapezoid with the five pure vowels. */
function VowelChart({ className }: Box): React.JSX.Element {
  const top = 44;
  const bottom = 204;
  const xl = (y: number): number => 96 + (y - top) * 0.675;
  const xr = 380;
  const closeMid = 97;
  const openMid = 151;
  const vowels: { s: string; word: string; x: number; y: number; pure: boolean; side: 'l' | 'r' }[] = [
    { s: 'i', word: 'vino', x: xl(top), y: top, pure: true, side: 'l' },
    { s: 'e', word: 'che', x: xl(closeMid), y: closeMid, pure: true, side: 'l' },
    { s: 'ɛ', word: 'bello', x: xl(openMid), y: openMid, pure: false, side: 'l' },
    { s: 'a', word: 'casa', x: xl(bottom), y: bottom, pure: true, side: 'l' },
    { s: 'ɔ', word: 'notte', x: xr, y: openMid, pure: false, side: 'r' },
    { s: 'o', word: 'dove', x: xr, y: closeMid, pure: true, side: 'r' },
    { s: 'u', word: 'luna', x: xr, y: top, pure: true, side: 'r' },
  ];
  const heights: [string, number][] = [
    ['CLOSE', top],
    ['CLOSE-MID', closeMid],
    ['OPEN-MID', openMid],
    ['OPEN', bottom],
  ];
  return (
    <Frame w={460} h={238} label={DESCRIPTIONS['vowel-chart']} className={className}>
      <path d={poly([[xl(top), top], [xr, top], [xr, bottom], [xl(bottom), bottom]], true)} style={ink({ c: 'ink2', w: 1.25, fill: 'sunk' })} />
      <Ln x1={xl(closeMid)} y1={closeMid} x2={xr} y2={closeMid} c="line" w={1} />
      <Ln x1={xl(openMid)} y1={openMid} x2={xr} y2={openMid} c="line" w={1} />
      <Ln x1={(xl(top) + xr) / 2} y1={top} x2={(xl(bottom) + xr) / 2} y2={bottom} c="line" w={1} dash="3 3" />
      <Tx x={xl(top)} y={26} anchor="middle" size={9}>
        FRONT
      </Tx>
      <Tx x={(xl(top) + xr) / 2} y={26} anchor="middle" size={9}>
        CENTRAL
      </Tx>
      <Tx x={xr} y={26} anchor="middle" size={9}>
        BACK
      </Tx>
      {heights.map(([t, y]) => (
        <Tx key={t} x={14} y={y + 3.5} size={9}>
          {t}
        </Tx>
      ))}
      {vowels.map((v) => {
        const tx = v.side === 'l' ? v.x - 10 : v.x + 10;
        const anchor = v.side === 'l' ? 'end' : 'start';
        return (
          <g key={v.s}>
            {v.pure ? <Dot x={v.x} y={v.y} r={4} c="voice" /> : <circle cx={v.x} cy={v.y} r={3.6} style={ink({ c: 'ink2', w: 1.25, fill: 'panel' })} />}
            <Tx x={tx} y={v.y + 4} anchor={anchor} size={16} font="sans" c={v.pure ? 'voice' : 'ink2'} bold={v.pure}>
              {`[${v.s}]`}
            </Tx>
            <Tx x={tx} y={v.y + 16} anchor={anchor} size={8.5} italic>
              {v.word}
            </Tx>
          </g>
        );
      })}
      <Dot x={xr - 118} y={226} r={3.5} c="voice" />
      <Tx x={xr - 110} y={229.5} size={9} c="ink2">
        THE FIVE PURE VOWELS
      </Tx>
    </Frame>
  );
}

/** The seven Curwen hand signs, each held a little higher. */
function HandSigns({ className }: Box): React.JSX.Element {
  const wrist = <Pa d="M0 26 L11 26 M0 38 L11 38" c="ink" />;
  const fist = (w = 26): React.JSX.Element => (
    <>
      <rect x={9} y={18} width={w} height={24} rx={8} style={ink({ c: 'ink', w: 1.25, fill: 'panel' })} />
      <Pa d={`M${9 + w - 12} 24.5 L${9 + w - 1} 24.5 M${9 + w - 12} 30.5 L${9 + w} 30.5 M${9 + w - 12} 36.5 L${9 + w - 1} 36.5`} c="ink2" w={1} />
    </>
  );
  // A flat hand seen edge-on, palm down, with the thumb tucked under.
  const flat = (
    <>
      <Pa d="M12 36.5 C15 42 23 42.5 27 37" c="ink" w={1.25} />
      <path d="M9 27.5 L38 27.5 C44 27.5 46.5 29.5 46.5 32 C46.5 34.5 44 36.5 38 36.5 L9 36.5 Z" style={ink({ c: 'ink', w: 1.25, fill: 'panel' })} />
      <Pa d="M25 32 L44 32" c="ink2" w={0.9} />
    </>
  );
  const glyphs: { s: string; hint: string; g: React.JSX.Element }[] = [
    {
      s: 'do',
      hint: 'fist',
      g: (
        <>
          {wrist}
          {fist()}
          <Pa d="M13 22 C20 19 28 19 33 23" c="ink2" w={1} />
        </>
      ),
    },
    {
      s: 're',
      hint: 'slope up',
      g: (
        <>
          {wrist}
          <g transform="rotate(-35 11 32)">{flat}</g>
        </>
      ),
    },
    {
      s: 'mi',
      hint: 'flat',
      g: (
        <>
          {wrist}
          {flat}
        </>
      ),
    },
    {
      s: 'fa',
      hint: 'thumb down',
      g: (
        <>
          {wrist}
          {fist()}
          <Capsule x1={27} y1={42} x2={29} y2={50} w={4.5} />
        </>
      ),
    },
    {
      s: 'so',
      hint: 'palm in',
      g: (
        <>
          {wrist}
          <rect x={9} y={17} width={18} height={25} rx={5} style={ink({ c: 'ink', w: 1.25, fill: 'panel' })} />
          <Capsule x1={14} y1={17} x2={20} y2={7} w={4.5} />
          {[21, 26.5, 32, 37.5].map((fy, k) => (
            <Capsule key={fy} x1={24} y1={fy} x2={k === 0 ? 41 : k === 3 ? 39 : 43} y2={fy} w={4} />
          ))}
        </>
      ),
    },
    {
      s: 'la',
      hint: 'droop',
      g: (
        <>
          {wrist}
          <path d="M10 26 C22 22 34 24 38 34 L40 46 C38 49 34 49 32 46 L29 37 C25 34 16 37 10 38 Z" style={ink({ c: 'ink', w: 1.25, fill: 'panel' })} />
          <Pa d="M33.5 32 L36.5 45 M30.5 30 L33 41" c="ink2" w={0.9} />
        </>
      ),
    },
    {
      s: 'ti',
      hint: 'point up',
      g: (
        <>
          {wrist}
          <Capsule x1={27} y1={22} x2={40} y2={5} w={4.5} />
          {fist(23)}
        </>
      ),
    },
  ];
  return (
    <Frame w={560} h={178} label={DESCRIPTIONS['hand-signs']} className={className}>
      <Tx x={16} y={18} size={9}>
        HELD HIGHER AS THE PITCH RISES
      </Tx>
      {glyphs.map(({ s, hint, g }, i) => {
        const cx = 44 + i * 78.5;
        const gy = 90 - i * 10.5;
        return (
          <g key={s}>
            <Ln x1={cx} y1={gy + 54} x2={cx} y2={146} c="hair" w={1} dash="2 3" />
            <g transform={`translate(${cx - 27.6} ${gy}) scale(1.15)`}>{g}</g>
            <Tx x={cx} y={160} anchor="middle" size={12} c={i === 0 ? 'voice' : 'ink'} bold font="sans">
              {s}
            </Tx>
            <Tx x={cx} y={173} anchor="middle" size={8.5}>
              {hint}
            </Tx>
          </g>
        );
      })}
    </Frame>
  );
}

/** One semitone is 100 cents; the bands the dial uses around a target. */
function Cents({ className }: Box): React.JSX.Element {
  const x0 = 70;
  const per = 4;
  const ticks = Array.from({ length: 21 }, (_, i) => i * 5);
  const X = (c: number): number => x0 + c * per; // 0 … 100
  const T = (c: number): number => x0 + (c + 50) * per; // -50 … +50
  return (
    <Frame w={540} h={186} label={DESCRIPTIONS.cents} className={className}>
      <Tx x={x0} y={14} size={9}>
        ONE SEMITONE = 100 CENTS
      </Tx>
      <Ln x1={X(0)} y1={42} x2={X(100)} y2={42} c="ink2" w={1.25} />
      {ticks.map((c) => (
        <Ln key={c} x1={X(c)} y1={42} x2={X(c)} y2={42 - (c % 50 === 0 ? 10 : c % 10 === 0 ? 6 : 3)} c={c % 50 === 0 ? 'ink2' : 'line'} w={1} />
      ))}
      {[0, 50, 100].map((c) => (
        <Tx key={c} x={X(c)} y={28} anchor="middle" size={9}>
          {c === 100 ? '100 ¢' : String(c)}
        </Tx>
      ))}
      <Tx x={X(0)} y={58} anchor="middle" size={12} c="ink" bold font="sans">
        C
      </Tx>
      <Tx x={X(100)} y={58} anchor="middle" size={12} c="ink" bold font="sans">
        C♯
      </Tx>
      {/* around a target */}
      <Tx x={T(0)} y={86} anchor="middle" size={9.5} c="voice" caps bold>
        TARGET
      </Tx>
      <rect x={T(-50)} y={96} width={T(-25) - T(-50)} height={22} style={ink({ c: 'line', w: 1, fill: 'sunk' })} />
      <rect x={T(25)} y={96} width={T(50) - T(25)} height={22} style={ink({ c: 'line', w: 1, fill: 'sunk' })} />
      <rect x={T(-25)} y={96} width={T(25) - T(-25)} height={22} style={ink({ c: 'voice', w: 1.25, fill: 'voiceSoft' })} />
      <Ln x1={T(0)} y1={90} x2={T(0)} y2={128} c="voice" w={1.75} />
      <Ln x1={T(-50)} y1={128} x2={T(50)} y2={128} c="ink2" w={1.25} />
      {ticks.map((c) => (
        <Ln key={c} x1={T(c - 50)} y1={128} x2={T(c - 50)} y2={128 + (c % 25 === 0 ? 6 : 3)} c={c % 25 === 0 ? 'ink2' : 'line'} w={1} />
      ))}
      {[-50, -25, 0, 25, 50].map((c) => (
        <Tx key={c} x={T(c)} y={146} anchor="middle" size={9} c={Math.abs(c) === 25 || c === 0 ? 'voice' : 'muted'}>
          {c > 0 ? `+${c}` : c < 0 ? `−${-c}` : '0'}
        </Tx>
      ))}
      <Tx x={T(-37.5)} y={110.5} anchor="middle" size={9}>
        CLOSE
      </Tx>
      <Tx x={T(37.5)} y={110.5} anchor="middle" size={9}>
        CLOSE
      </Tx>
      <Tx x={T(-12.5)} y={110.5} anchor="middle" size={9} c="voice" bold>
        ON
      </Tx>
      <Tx x={T(12.5)} y={110.5} anchor="middle" size={9} c="voice" bold>
        ON
      </Tx>
      <Tx x={T(-50)} y={170} size={9.5} c="ink2">
        ← FLAT ♭
      </Tx>
      <Tx x={T(50)} y={170} anchor="end" size={9.5} c="ink2">
        SHARP ♯ →
      </Tx>
      <Tx x={T(0)} y={170} anchor="middle" size={9}>
        CENTS FROM THE TARGET
      </Tx>
    </Frame>
  );
}

/** Vibrato: a regular wave around the mean pitch, with its rate and extent. */
function Vibrato({ className }: Box): React.JSX.Element {
  const x0 = 60;
  const len = 400; // one second
  const mid = 104;
  const amp = 40; // ±50 cents
  const yAt = (x: number): number => {
    const t = (x - x0) / len;
    const a = Math.min(1, 0.35 + t * 4);
    return mid - a * amp * Math.sin(2 * Math.PI * 6 * t);
  };
  const xPeak = (k: number): number => x0 + ((0.25 + k) / 6) * len;
  return (
    <Frame w={560} h={196} label={DESCRIPTIONS.vibrato} className={className}>
      <Tx x={x0} y={18} size={9}>
        RATE 5.5–8 Hz · HERE 6 CYCLES PER SECOND
      </Tx>
      <Ln x1={x0} y1={mid - amp} x2={x0 + len} y2={mid - amp} c="hair" w={1} />
      <Ln x1={x0} y1={mid + amp} x2={x0 + len} y2={mid + amp} c="hair" w={1} />
      <Tx x={52} y={mid - amp + 3.5} anchor="end" size={9}>
        +50 ¢
      </Tx>
      <Tx x={52} y={mid + amp + 3.5} anchor="end" size={9}>
        −50 ¢
      </Tx>
      <Tx x={52} y={mid + 3.5} anchor="end" size={9} c="ink2">
        MEAN
      </Tx>
      <Ln x1={x0} y1={mid} x2={x0 + len} y2={mid} c="ink2" w={1.25} dash="5 4" />
      <Pa d={poly(sample(x0, x0 + len, 0.5, yAt))} c="voice" w={1.75} />
      {/* rate: one cycle, peak to peak */}
      <Ln x1={xPeak(2)} y1={42} x2={xPeak(2)} y2={61} c="line" w={1} />
      <Ln x1={xPeak(3)} y1={42} x2={xPeak(3)} y2={61} c="line" w={1} />
      <Arrow x1={xPeak(2) + 1} y1={48} x2={xPeak(3) - 1} y2={48} c="ink2" w={1} head={4} both />
      <Tx x={(xPeak(2) + xPeak(3)) / 2} y={38} anchor="middle" size={9} c="ink2">
        1 CYCLE
      </Tx>
      {/* extent */}
      <Ln x1={x0 + len + 4} y1={mid - amp} x2={x0 + len + 22} y2={mid - amp} c="line" w={1} />
      <Ln x1={x0 + len + 4} y1={mid + amp} x2={x0 + len + 22} y2={mid + amp} c="line" w={1} />
      <Arrow x1={x0 + len + 16} y1={mid - amp + 1} x2={x0 + len + 16} y2={mid + amp - 1} c="ink2" w={1} head={4} both />
      <Tx x={x0 + len + 26} y={mid - 8} size={9} c="ink2">
        EXTENT
      </Tx>
      <Tx x={x0 + len + 26} y={mid + 5} size={9} c="ink2">
        ±50 ¢
      </Tx>
      <Tx x={x0 + len + 26} y={mid + 18} size={8.5}>
        typ. ±30–100
      </Tx>
      <Ln x1={x0} y1={166} x2={x0 + len} y2={166} c="line" w={1} />
      {[0, 0.5, 1].map((t) => (
        <g key={t}>
          <Ln x1={x0 + t * len} y1={166} x2={x0 + t * len} y2={171} c="ink2" w={1} />
          <Tx x={x0 + t * len} y={184} anchor="middle" size={9}>
            {t === 0 ? '0' : `${t} s`}
          </Tx>
        </g>
      ))}
      <Tx x={16} y={mid} anchor="middle" size={9} rot={-90}>
        PITCH
      </Tx>
    </Frame>
  );
}

/** Three ways to start a note. */
function Onsets({ className }: Box): React.JSX.Element {
  const panels = [
    { x0: 16, t: 'BREATHY', cap: 'air before the tone', c: 'ink2' as Col },
    { x0: 192, t: 'HARD', cap: 'a sudden start, a click', c: 'ink2' as Col },
    { x0: 368, t: 'BALANCED', cap: 'clean and immediate', c: 'voice' as Col },
  ];
  const cy = 98;
  const A = 46;
  const envOf = (kind: number, u: number): number => {
    if (kind === 0) return 0.78 * smooth((u - 0.18) / 0.5);
    if (kind === 1) return u < 0.12 ? 0 : 0.72 + 0.55 * Math.exp(-(u - 0.12) / 0.035);
    return 0.78 * smooth((u - 0.12) / 0.06);
  };
  const wave = (kind: number, x0: number): Pt[] =>
    sample(x0 + 6, x0 + 150, 0.5, (x) => {
      const u = (x - x0 - 6) / 144;
      const tone = envOf(kind, u) * A * Math.sin((2 * Math.PI * (x - x0 - 6 - (kind === 0 ? 0 : 0.12 * 144))) / 11);
      const air = kind === 0 ? (u < 0.5 ? 0.16 : 0.07) * A * noise(Math.round(x * 2)) : 0;
      return cy - tone - air;
    });
  return (
    <Frame w={540} h={196} label={DESCRIPTIONS.onsets} className={className}>
      {panels.map(({ x0, t, cap, c }, kind) => (
        <g key={t}>
          <Tx x={x0 + 2} y={20} size={10.5} c={kind === 2 ? 'voice' : 'ink'} caps bold>
            {t}
          </Tx>
          <rect x={x0} y={30} width={156} height={136} rx={6} style={ink({ c: 'hair', w: 1 })} />
          <Ln x1={x0 + 6} y1={cy} x2={x0 + 150} y2={cy} c="hair" w={1} />
          <Pa d={poly(sample(x0 + 6, x0 + 150, 1, (x) => cy - envOf(kind, (x - x0 - 6) / 144) * A))} c="line" w={1} dash="2 3" />
          <Pa d={poly(wave(kind, x0))} c={c} w={1.1} />
          <Tx x={x0 + 78} y={184} anchor="middle" size={9.5}>
            {cap}
          </Tx>
        </g>
      ))}
      <Tx x={16 + 10} y={156} size={8.5}>
        hhh…
      </Tx>
      <Arrow x1={192 + 44} y1={42} x2={192 + 30} y2={46} c="bad" w={1.25} head={4} />
      <Tx x={192 + 48} y={44} size={9} c="bad">
        CLICK
      </Tx>
      <Tx x={368 + 150} y={156} anchor="end" size={8.5}>
        TIME →
      </Tx>
    </Frame>
  );
}

/** Messa di voce: one note swelling pp → ff → pp while the pitch stays put. */
function Messa({ className }: Box): React.JSX.Element {
  const x0 = 70;
  const per = 42; // px per second
  const mid = 112;
  const half = (x: number): number => 3 + 44 * Math.sin((Math.PI * (x - x0)) / (10 * per)) ** 1.6;
  const upper = sample(x0, x0 + 10 * per, 1, (x) => mid - half(x));
  const lower = sample(x0, x0 + 10 * per, 1, (x) => mid + half(x));
  const seconds = Array.from({ length: 11 }, (_, i) => i);
  return (
    <Frame w={540} h={214} label={DESCRIPTIONS.messa} className={className}>
      <Ln x1={x0} y1={40} x2={x0 + 10 * per} y2={40} c="voice" w={2} />
      <Tx x={x0 - 8} y={43.5} anchor="end" size={9.5} c="voice" caps>
        PITCH
      </Tx>
      <Tx x={x0 + 10 * per} y={30} anchor="end" size={9}>
        same note, same vowel
      </Tx>
      <path d={`${poly(upper)} ${poly([...lower].reverse()).replace(/^M/, 'L')} Z`} style={ink({ c: 'ink2', w: 1.25, fill: 'sunk' })} />
      <Ln x1={x0} y1={mid} x2={x0 + 10 * per} y2={mid} c="hair" w={1} />
      <Tx x={x0 - 8} y={mid + 3.5} anchor="end" size={9.5} c="ink2" caps>
        LOUDNESS
      </Tx>
      {(
        [
          ['pp', 0.3],
          ['ff', 5],
          ['pp', 9.7],
        ] as const
      ).map(([m, s], i) => (
        <Tx key={i} x={x0 + s * per} y={180} anchor="middle" size={17} c="ink" bold italic font="serif">
          {m}
        </Tx>
      ))}
      <Tx x={x0 + 2.5 * per} y={178} anchor="middle" size={11} italic font="serif">
        cresc.
      </Tx>
      <Tx x={x0 + 7.5 * per} y={178} anchor="middle" size={11} italic font="serif">
        dim.
      </Tx>
      <Ln x1={x0} y1={192} x2={x0 + 10 * per} y2={192} c="line" w={1} />
      {seconds.map((s) => (
        <Ln key={s} x1={x0 + s * per} y1={192} x2={x0 + s * per} y2={s % 5 === 0 ? 198 : 195} c={s % 5 === 0 ? 'ink2' : 'line'} w={1} />
      ))}
      {[0, 5, 10].map((s) => (
        <Tx key={s} x={x0 + s * per} y={210} anchor="middle" size={9}>
          {s === 10 ? '10 s' : String(s)}
        </Tx>
      ))}
    </Frame>
  );
}

/** A stylised treble clef on a staff whose lines are 8 apart, top line at 0. */
const TREBLE =
  'M11.5 27 C8 28.5 5.5 25.5 7.5 22.5 C9.5 19.5 15 20 15.5 24.5 C16 30 9 33 4.5 30.5 C-0.5 27.5 0 20 5 15 C9 11 14 5 13.5 -2 C13 -8 9.5 -9 8 -4 C6.5 1 8 18 11 40 C11.5 45 6.5 46.5 5 43';
const BASS = 'M3 8.5 C3 2 13 0 17 5 C21 11 15 22 2 28';

/** Treble, octave treble and bass clefs, each with middle C. */
function Clefs({ className }: Box): React.JSX.Element {
  const staves = [
    { x0: 24, t: 'TREBLE', sub: 'soprano · alto', clef: 'treble', cY: 100, cap: ['middle C sits on a', 'ledger line below'] },
    { x0: 200, t: 'TREBLE 8', sub: 'tenor', clef: 'treble8', cY: 72, cap: ['written in the third space,', 'sung an octave lower'] },
    { x0: 376, t: 'BASS', sub: 'baritone · bass', clef: 'bass', cY: 52, cap: ['middle C sits on a', 'ledger line above'] },
  ] as const;
  const y0 = 60;
  return (
    <Frame w={540} h={170} label={DESCRIPTIONS.clefs} className={className}>
      {staves.map(({ x0, t, sub, clef, cY, cap }) => (
        <g key={t}>
          <Tx x={x0} y={22} size={10.5} c="ink" caps bold>
            {t}
          </Tx>
          <Tx x={x0} y={36} size={9}>
            {sub}
          </Tx>
          {[0, 8, 16, 24, 32].map((d) => (
            <Ln key={d} x1={x0} y1={y0 + d} x2={x0 + 140} y2={y0 + d} c="ink2" w={1} />
          ))}
          <g transform={`translate(${x0 + 8} ${y0})`}>
            {clef === 'bass' ? (
              <>
                <Pa d={BASS} c="ink" w={2} />
                <circle cx={4.2} cy={8} r={2.8} style={paint('ink')} />
                <circle cx={23} cy={4} r={1.6} style={paint('ink')} />
                <circle cx={23} cy={12} r={1.6} style={paint('ink')} />
              </>
            ) : (
              <>
                <Pa d={TREBLE} c="ink" w={1.6} />
                <circle cx={6.6} cy={42.6} r={2.3} style={paint('ink')} />
                {clef === 'treble8' && (
                  <Tx x={9.5} y={58} anchor="middle" size={9} c="ink" bold>
                    8
                  </Tx>
                )}
              </>
            )}
          </g>
          {(cY < y0 || cY > y0 + 32) && <Ln x1={x0 + 76} y1={cY} x2={x0 + 98} y2={cY} c="ink" w={1.25} />}
          <ellipse cx={x0 + 87} cy={cY} rx={6.2} ry={4.2} transform={`rotate(-20 ${x0 + 87} ${cY})`} style={ink({ c: 'voice', w: 2 })} />
          <Tx x={x0 + 104} y={cY + 3.5} size={10} c="voice" bold>
            C4
          </Tx>
          {cap.map((l, i) => (
            <Tx key={l} x={x0} y={144 + i * 13} size={9}>
              {l}
            </Tx>
          ))}
        </g>
      ))}
    </Frame>
  );
}

/** The dynamics ladder, and the two hairpins. */
function Dynamics({ className }: Box): React.JSX.Element {
  const marks: [string, string][] = [
    ['pp', 'pianissimo'],
    ['p', 'piano'],
    ['mp', 'mezzo piano'],
    ['mf', 'mezzo forte'],
    ['f', 'forte'],
    ['ff', 'fortissimo'],
  ];
  const X = (i: number): number => 70 + i * 80;
  const wedge = (x: number): number => ((x - 40) / 460) * 18;
  return (
    <Frame w={540} h={208} label={DESCRIPTIONS.dynamics} className={className}>
      {marks.map(([m, it], i) => (
        <g key={m}>
          <Tx x={X(i)} y={42} anchor="middle" size={19} c="ink" bold italic font="serif">
            {m}
          </Tx>
          <Tx x={X(i)} y={60} anchor="middle" size={8.5}>
            {it}
          </Tx>
          <Ln x1={X(i)} y1={67} x2={X(i)} y2={96 - wedge(X(i)) - 3} c="line" w={1} />
        </g>
      ))}
      <path d={`M40 96 L500 ${96 - 18} L500 ${96 + 18} Z`} style={ink({ c: 'voice', w: 1.25, fill: 'voiceSoft' })} />
      <Tx x={40} y={128} size={9}>
        SOFT
      </Tx>
      <Tx x={500} y={128} anchor="end" size={9}>
        LOUD
      </Tx>
      <Pa d="M230 144 L70 154 L230 164" c="ink" w={1.5} />
      <Pa d="M310 144 L470 154 L310 164" c="ink" w={1.5} />
      <Tx x={150} y={186} anchor="middle" size={13} c="ink" italic font="serif">
        cresc.
      </Tx>
      <Tx x={390} y={186} anchor="middle" size={13} c="ink" italic font="serif">
        dim.
      </Tx>
      <Tx x={150} y={201} anchor="middle" size={9}>
        GRADUALLY LOUDER
      </Tx>
      <Tx x={390} y={201} anchor="middle" size={9}>
        GRADUALLY SOFTER
      </Tx>
    </Frame>
  );
}

/** Semi-occluded tract: the narrower the exit, the more the air pushes back. */
function Sovt({ className }: Box): React.JSX.Element {
  const cols = [
    { t: 'STRAW', cap: 'most back-pressure', n: 3 },
    { t: 'LIP TRILL', cap: 'high', n: 2 },
    { t: 'HUM', cap: 'some', n: 1 },
    { t: 'OPEN VOWEL', cap: 'least', n: 0 },
  ];
  const cy = 86;
  const r = 12;
  return (
    <Frame w={560} h={214} label={DESCRIPTIONS.sovt} className={className}>
      {cols.map(({ t, cap, n }, i) => {
        const cx = 85 + i * 130;
        const gx = cx - 56;
        const mx = cx + 18;
        let walls: string;
        let extra: React.JSX.Element | null = null;
        if (i === 0) {
          walls = `M${gx} ${cy - r} L${mx} ${cy - r} C${mx + 6} ${cy - r} ${mx + 6} ${cy - 2.5} ${mx + 10} ${cy - 2.5} L${mx + 44} ${cy - 2.5} M${gx} ${cy + r} L${mx} ${cy + r} C${mx + 6} ${cy + r} ${mx + 6} ${cy + 2.5} ${mx + 10} ${cy + 2.5} L${mx + 44} ${cy + 2.5}`;
          extra = <Ln x1={mx + 44} y1={cy - 2.5} x2={mx + 44} y2={cy + 2.5} c="ink2" w={1} />;
        } else if (i === 1) {
          walls = `M${gx} ${cy - r} L${mx} ${cy - r} C${mx + 6} ${cy - r} ${mx + 6} ${cy - 3} ${mx + 10} ${cy - 3} M${gx} ${cy + r} L${mx} ${cy + r} C${mx + 6} ${cy + r} ${mx + 6} ${cy + 3} ${mx + 10} ${cy + 3}`;
          extra = <Pa d={`M${mx + 10} ${cy - 3} l3 -3 l3 3 l3 -3 l3 3 M${mx + 10} ${cy + 3} l3 3 l3 -3 l3 3 l3 -3`} c="ink" w={1.1} />;
        } else if (i === 2) {
          walls = `M${gx} ${cy - r} L${mx - 16} ${cy - r} L${mx - 16} ${cy - r - 18} M${mx - 6} ${cy - r - 18} L${mx - 6} ${cy - r} L${mx} ${cy - r} C${mx + 6} ${cy - r} ${mx + 8} ${cy - 4} ${mx + 8} ${cy} C${mx + 8} ${cy + 4} ${mx + 6} ${cy + r} ${mx} ${cy + r} L${gx} ${cy + r}`;
          extra = <Arrow x1={mx - 11} y1={cy - r - 14} x2={mx - 11} y2={cy - r - 27} c="ink2" w={1} head={3.5} />;
        } else {
          walls = `M${gx} ${cy - r} L${mx} ${cy - r} C${mx + 8} ${cy - r} ${mx + 12} ${cy - r - 10} ${mx + 18} ${cy - r - 12} M${gx} ${cy + r} L${mx} ${cy + r} C${mx + 8} ${cy + r} ${mx + 12} ${cy + r + 10} ${mx + 18} ${cy + r + 12}`;
        }
        return (
          <g key={t}>
            <Tx x={cx} y={20} anchor="middle" size={9}>
              {String(i + 1)}
            </Tx>
            <Tx x={cx} y={34} anchor="middle" size={10.5} c="ink" caps bold>
              {t}
            </Tx>
            <Pa d={walls} c="ink" w={1.5} />
            {extra}
            {/* the folds at the bottom of the tube */}
            <Pa d={`M${gx} ${cy - r} L${gx} ${cy - 1.5} M${gx} ${cy + 1.5} L${gx} ${cy + r}`} c="ink" w={2} />
            {Array.from({ length: n }, (_, k) => (
              <Arrow key={k} x1={mx - 6 - k * 24} y1={cy} x2={mx - 24 - k * 24} y2={cy} c="voice" w={1.75} head={5} />
            ))}
            {n === 0 && (
              <Tx x={cx - 18} y={cy + 3.5} anchor="middle" size={8.5}>
                free flow
              </Tx>
            )}
            <Tx x={cx} y={128} anchor="middle" size={9}>
              {cap}
            </Tx>
          </g>
        );
      })}
      <path d="M20 154 L540 160 L20 166 Z" style={ink({ c: 'voice', w: 1, fill: 'voiceSoft' })} />
      <Tx x={20} y={184} size={9} c="ink2">
        MORE RESISTANCE
      </Tx>
      <Tx x={540} y={184} anchor="end" size={9} c="ink2">
        LESS
      </Tx>
      <Arrow x1={44} y1={202} x2={22} y2={202} c="voice" w={1.75} head={5} />
      <Tx x={52} y={205.5} size={9}>
        BACK-PRESSURE, TOWARD THE FOLDS
      </Tx>
    </Frame>
  );
}

/** A week of voiced minutes against a daily cap, with a rest day. */
function Load({ className }: Box): React.JSX.Element {
  const days: [string, number | null][] = [
    ['MON', 25],
    ['TUE', 30],
    ['WED', 20],
    ['THU', 52],
    ['FRI', null],
    ['SAT', 35],
    ['SUN', 15],
  ];
  const x0 = 60;
  const colW = 440 / 7;
  const base = 176;
  const k = 136 / 60;
  const Y = (m: number): number => base - m * k;
  const cap = 45;
  const cx = (i: number): number => x0 + (i + 0.5) * colW;
  const bw = 30;
  return (
    <Frame w={540} h={206} label={DESCRIPTIONS.load} className={className}>
      {[0, 20, 40, 60].map((m) => (
        <g key={m}>
          <Ln x1={x0} y1={Y(m)} x2={x0 + 440} y2={Y(m)} c={m === 0 ? 'line' : 'hair'} w={1} />
          <Tx x={x0 - 8} y={Y(m) + 3.5} anchor="end" size={9}>
            {String(m)}
          </Tx>
        </g>
      ))}
      {days.map(([d, m], i) => {
        const x = cx(i) - bw / 2;
        return (
          <g key={d}>
            {m === null ? (
              <>
                <rect x={x} y={Y(cap)} width={bw} height={base - Y(cap)} style={ink({ c: 'line', w: 1, dash: '3 3' })} />
                <Pa d={hatch(x, Y(cap), bw, base - Y(cap), 6)} c="line" w={1} />
                <Tx x={cx(i)} y={Y(cap) - 6} anchor="middle" size={9} c="ink2" caps>
                  REST
                </Tx>
              </>
            ) : (
              <>
                <rect x={x} y={Y(Math.min(m, cap))} width={bw} height={base - Y(Math.min(m, cap))} style={ink({ c: 'voice', w: 1.25, fill: 'voiceSoft' })} />
                {m > cap && <rect x={x} y={Y(m)} width={bw} height={Y(cap) - Y(m)} style={ink({ c: 'bad', w: 1.25, fill: 'bad', op: 0.16 })} />}
                <Tx x={cx(i)} y={Y(m) - 5} anchor="middle" size={9} c={m > cap ? 'bad' : 'ink2'}>
                  {String(m)}
                </Tx>
              </>
            )}
            <Tx x={cx(i)} y={192} anchor="middle" size={9} c="ink2">
              {d}
            </Tx>
          </g>
        );
      })}
      <Ln x1={x0} y1={Y(cap)} x2={x0 + 440} y2={Y(cap)} c="ink" w={1.25} dash="5 4" />
      <Tx x={x0 + 440} y={Y(cap) - 5} anchor="end" size={9} c="ink" caps>
        DAILY CAP
      </Tx>
      <Tx x={cx(3) - bw / 2 - 6} y={Y(48.5) + 3} anchor="end" size={8.5} c="bad">
        OVER
      </Tx>
      <Pa d={`M${cx(3)} ${Y(52) - 16} C${cx(3) + 20} 28 ${cx(5) - 30} 28 ${cx(5)} ${Y(35) - 21}`} c="ink2" w={1} dash="3 3" />
      <Arrow x1={cx(5) - 3} y1={Y(35) - 27} x2={cx(5)} y2={Y(35) - 20} c="ink2" w={1} head={4} />
      <Tx x={(cx(3) + cx(5)) / 2} y={22} anchor="middle" size={9} c="ink2">
        fatigue can show 24–72 h later
      </Tx>
      <Tx x={16} y={(base + Y(60)) / 2} anchor="middle" size={9} rot={-90}>
        VOICED MINUTES
      </Tx>
    </Frame>
  );
}

/* ---------------------------------------------------------------- index */

export const FIGURE_TITLES: Record<FigureKey, string> = {
  'source-filter': 'Source and filter',
  folds: 'The vocal folds from above',
  larynx: 'The larynx, side view',
  'breath-cycle': 'The breath cycle',
  posture: 'Singing posture',
  resonators: 'The resonators',
  harmonics: 'The harmonic series',
  formants: 'Formants and the singer’s formant',
  registers: 'Registers across the range',
  passaggio: 'Passaggi by voice type',
  'vowel-chart': 'The vowel chart',
  'hand-signs': 'Curwen hand signs',
  cents: 'Cents around a target',
  vibrato: 'Vibrato rate and extent',
  onsets: 'Three onsets',
  messa: 'Messa di voce',
  clefs: 'Clefs and middle C',
  dynamics: 'Dynamics',
  sovt: 'Semi-occluded vocal tract',
  load: 'A week of voice load',
};

/** What each picture shows, for screen readers. */
const DESCRIPTIONS: Record<FigureKey, string> = {
  'source-filter': 'Source and filter: the vocal folds make a buzz rich in harmonics, the vocal tract adds resonance peaks F1, F2 and F3, and the sound we hear is the harmonics shaped by those peaks.',
  folds: 'The vocal folds seen from above: apart in a V for breathing, with the glottis open between them, and together along the midline for singing, where they vibrate.',
  larynx: 'Side view of the larynx in the neck: the epiglottis, hyoid bone, thyroid cartilage with the Adam’s apple, the vocal folds inside it, the cricoid ring below and the trachea, with the esophagus behind.',
  'breath-cycle': 'Lung volume over one phrase: a quick inhale, a short suspension, a long controlled exhale while singing, then recovery back to rest.',
  posture: 'Side profile of a singer with a vertical line through ear, shoulder, hip and ankle; the head balanced, ribs open, knees soft and weight over both feet.',
  resonators: 'Section of the head and neck: the pharynx and the mouth shaded as the main resonators, the nasal cavity above the palate, and dashed sinuses; sinus sensations are sympathetic vibration, not resonance.',
  harmonics: 'The harmonic series: lines at f0, 2f0, 3f0 up to 9f0, evenly spaced and getting shorter; with f0 at 220 Hz they fall at 220, 440, 660 Hz and so on.',
  formants: 'A spectrum envelope from 0 to 5 kHz with peaks F1 near 0.6 kHz and F2 near 1.15 kHz, which make the vowel, and the singer’s formant cluster shaded between 2.8 and 3.4 kHz.',
  registers: 'A pitch range from C2 to C6 with lanes for M1 chest voice, mix and M2 head voice; the usual M1 to M2 switch is marked near F4 to F sharp 4, about 350 to 370 Hz.',
  passaggio: 'Primo and secondo passaggio by voice type after Richard Miller: soprano E flat 4 and F sharp 5, mezzo E4 and E5, contralto G4 and D5, lyric tenor D4 and G4, lyric baritone B3 and E4, lyric bass A flat 3 and D flat 4.',
  'vowel-chart': 'The IPA vowel chart from front to back and close to open, with i, e, epsilon, a, open o, o and u placed; the five pure vowels i, e, a, o, u are highlighted.',
  'hand-signs': 'The seven Curwen hand signs, each held higher: do a fist, re a flat hand sloping up, mi a flat hand, fa a fist with the thumb down, so the palm facing in, la a drooping hand, ti a finger pointing up.',
  cents: 'One semitone from C to C sharp is 100 cents. Around a target note, within plus or minus 25 cents counts as on and within 50 cents as close; flat is to the left and sharp to the right.',
  vibrato: 'A vibrato wave around a dashed mean pitch line: six cycles in one second, with the rate (5.5 to 8 Hz is typical) and the extent of plus or minus 50 cents dimensioned.',
  onsets: 'Three onsets as waveforms: breathy, where air noise comes before a slowly growing tone; hard, a sudden start with a click; balanced, a clean, immediate, smooth start.',
  messa: 'Messa di voce: over about ten seconds the loudness swells from pianissimo to fortissimo and back while the pitch line stays flat.',
  clefs: 'Three staves with middle C: in treble clef on a ledger line below the staff, in the octave treble clef used by tenors in the third space, and in bass clef on a ledger line above.',
  dynamics: 'The dynamics ladder pianissimo, piano, mezzo piano, mezzo forte, forte, fortissimo along a widening wedge, with a crescendo and a diminuendo hairpin.',
  sovt: 'The vocal tract as a tube with different exits ranked by back-pressure: a straw the most, then a lip trill, a hum and an open vowel the least.',
  load: 'A week of voiced minutes as bars against a dashed daily cap of 45 minutes, with Thursday over the cap, Friday a hatched rest day, and a note that fatigue can show 24 to 72 hours later.',
};

const FIGURES: Record<FigureKey, (p: Box) => React.JSX.Element> = {
  'source-filter': SourceFilter,
  folds: Folds,
  larynx: Larynx,
  'breath-cycle': BreathCycle,
  posture: Posture,
  resonators: Resonators,
  harmonics: Harmonics,
  formants: Formants,
  registers: Registers,
  passaggio: Passaggio,
  'vowel-chart': VowelChart,
  'hand-signs': HandSigns,
  cents: Cents,
  vibrato: Vibrato,
  onsets: Onsets,
  messa: Messa,
  clefs: Clefs,
  dynamics: Dynamics,
  sovt: Sovt,
  load: Load,
};

/** One of the in-house diagrams. */
export function Figure({ fig, className }: { fig: FigureKey; className?: string | undefined }): React.JSX.Element {
  const Draw = FIGURES[fig];
  return <Draw className={className} />;
}
