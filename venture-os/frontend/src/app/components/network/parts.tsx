/**
 * Small network pieces built on the kernel's components: the strength bar,
 * band words and tones, timeline icons, the reads a network view listens to.
 */
import type { LucideIcon } from 'lucide-react';
import { ArrowRight, Briefcase, Building2, Circle, CircleDot, FileText, Mail, MessageSquare, Phone, UserPlus, Users, Waypoints } from 'lucide-react';
import { Meter } from '../charts.tsx';
import type { ChartTone } from '../charts.tsx';
import type { Band } from './types.ts';

/** Collections whose change a network view reloads on. */
export const NET_READS = ['interactions', 'strengths', 'intros', 'people', 'companies', 'employments', 'deals'];

/** The paths view: relationships and intros (an intro moves when its draft is sent). */
export const PATH_READS = ['strengths', 'intros', 'outbound', 'people', 'employments'];

/** Meetings and briefs (a brief moves when your AI agent takes or finishes its request). */
export const MEETING_READS = ['cal_events', 'briefs', 'agent_requests', 'strengths'];

export const BAND_LABEL: Record<Band, string> = { strong: 'Strong', good: 'Good', weak: 'Weak', none: 'None' };

/** Chart tones for the bands: ink, blue, teal, grey (meaning: how warm, nothing good or bad). */
export const BAND_TONE: Record<Band, ChartTone> = { strong: 'ink', good: 'a', weak: 'b', none: 'muted' };

export const BAND_TIP = 'Strength 0 to 100 from meetings, calls and emails, each halving every 60 days. Strong 60+, good 30 to 59, weak below 30.';

/** A strength bar with its mono score (36px rows). */
export function StrengthBar({ score, band, className }: { score: number; band: Band; className?: string | undefined }): React.JSX.Element {
  return <Meter value={score} max={100} tone={BAND_TONE[band]} format={(v) => String(Math.round(v))} label={undefined} className={className} />;
}

const ICONS: Record<string, LucideIcon> = { Mail, Users, Phone, MessageSquare, Waypoints, FileText, Building2, UserPlus, Briefcase, ArrowRight, CircleDot };

/** A lucide icon by the name a timeline item carries. */
export function iconOf(name: string | undefined): LucideIcon {
  return (name !== undefined ? ICONS[name] : undefined) ?? Circle;
}
