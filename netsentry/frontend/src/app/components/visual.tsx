/**
 * Visual building blocks for the Simple view: status ring, icons that say
 * what a thing is, and tiles. Show state with shape and colour, not paragraphs.
 */
import type { Asset, Finding, Severity } from '../lib/types.ts';
import {
  CalendarIcon,
  CloudIcon,
  CodeIcon,
  DatabaseIcon,
  GlobeIcon,
  LaptopIcon,
  LockIcon,
  MailIcon,
  ServerIcon,
  ShieldIcon,
  UserIcon,
  WifiIcon,
} from './icons.tsx';

export type Tone = 'good' | 'warn' | 'bad' | 'neutral';

export const TONE_COLOR: Record<Tone, string> = {
  good: 'rgb(22 163 74)',
  warn: 'rgb(217 119 6)',
  bad: 'rgb(220 38 38)',
  neutral: 'var(--agent-app-muted)',
};

export function severityTone(s: Severity): Tone {
  return s === 'critical' || s === 'high' ? 'bad' : s === 'medium' ? 'warn' : 'neutral';
}

/** A big ring: how safe things are at a glance (0–100). */
export function StatusRing({ value, tone, size = 88 }: { value: number | null; tone: Tone; size?: number }): React.JSX.Element {
  const r = size / 2 - 7;
  const c = 2 * Math.PI * r;
  const v = value === null ? 0 : Math.max(0, Math.min(100, value)) / 100;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={value === null ? 'Calculating' : `Security score ${value} out of 100`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--agent-app-border)" strokeWidth={8} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={TONE_COLOR[tone]}
        strokeWidth={8}
        strokeLinecap="round"
        strokeDasharray={`${c * v} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dasharray 400ms ease' }}
      />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontSize={size / 4.2} fontWeight={600} fill="currentColor">
        {value === null ? '…' : value}
      </text>
    </svg>
  );
}

export function ItemIcon({ asset, platform, size = 26 }: { asset: Pick<Asset, "kind">; platform?: string | undefined; size?: number }): React.JSX.Element {
  if (asset.kind === 'host') return /linux/i.test(platform ?? '') ? <ServerIcon size={size} /> : <LaptopIcon size={size} />;
  if (asset.kind === 'ip') return <WifiIcon size={size} />;
  return <GlobeIcon size={size} />;
}

const DB_PORTS = new Set([1433, 3306, 5432, 6379, 9200, 11211, 27017]);

/** An icon that says what a problem is about. */
export function IssueIcon({ finding, size = 24 }: { finding: Pick<Finding, 'rule_id' | 'category' | 'evidence'>; size?: number }): React.JSX.Element {
  const ev = (finding.evidence ?? {}) as Record<string, unknown>;
  const id = finding.rule_id;
  if ((id === 'HOST-001' || id === 'EXP-001') && DB_PORTS.has(Number(ev['port']))) return <DatabaseIcon size={size} />;
  if (id === 'DEV-001' || id === 'CLD-005' || id === 'TLS-001' || id === 'CT-001' || id === 'WEB-004') return <LockIcon size={size} />;
  if (id === 'HOST-003' || id === 'HOST-005' || id === 'HOST-006' || id === 'HOST-016') return <UserIcon size={size} />;
  if (id === 'REG-001') return <CalendarIcon size={size} />;
  switch (finding.category) {
    case 'email':
      return <MailIcon size={size} />;
    case 'network':
    case 'exposure':
      return <WifiIcon size={size} />;
    case 'cloud':
      return <CloudIcon size={size} />;
    case 'code':
      return <CodeIcon size={size} />;
    case 'web':
    case 'dns':
    case 'certificates':
    case 'registration':
      return <GlobeIcon size={size} />;
    case 'host':
      return <ServerIcon size={size} />;
    default:
      return <ShieldIcon size={size} />;
  }
}

/** A square tile: icon, name, and a coloured dot with a two-word state. */
export function Tile({
  icon,
  name,
  tone,
  state,
  onClick,
}: {
  icon: React.ReactNode;
  name: string;
  tone: Tone;
  state: string;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[112px] flex-col items-center justify-center gap-1.5 rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] p-3 text-center transition-colors hover:border-[var(--agent-app-accent)]"
    >
      <span className="text-[var(--agent-app-text)]">{icon}</span>
      <span className="max-w-full truncate text-[14px] font-medium">{name}</span>
      <span className="flex items-center gap-1.5 text-[12px] text-[var(--agent-app-muted)]">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: TONE_COLOR[tone] }} />
        {state}
      </span>
    </button>
  );
}

/** A small pill with an urgency tone. */
export function UrgencyChip({ label, tone }: { label: string; tone: Tone }): React.JSX.Element {
  const bg = tone === 'bad' ? 'rgba(220,38,38,.12)' : tone === 'warn' ? 'rgba(217,119,6,.14)' : tone === 'good' ? 'rgba(22,163,74,.12)' : 'var(--agent-app-surface-2)';
  return (
    <span className="rounded-full px-2.5 py-0.5 text-[12px] font-medium" style={{ background: bg, color: TONE_COLOR[tone] }}>
      {label}
    </span>
  );
}
