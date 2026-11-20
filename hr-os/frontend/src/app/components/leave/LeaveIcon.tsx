/**
 * Leave type marks: the curated line icons a leave type can wear (stored by
 * name, validated by the server) and its meaning colour from the theme.
 */
import type { LucideIcon } from 'lucide-react';
import { Award, Baby, Briefcase, CalendarClock, CalendarOff, Clock, Flower, GraduationCap, HandCoins, Heart, HeartHandshake, Hospital, House, Landmark, Palmtree, Plane, Scale, Shield, Star, Stethoscope, Sun, Thermometer, Umbrella, Users } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import type { Tone } from '../ui.tsx';
import type { LeaveColor } from '../../pages/leave/types.ts';

export const LEAVE_ICONS: Record<string, LucideIcon> = {
  sun: Sun,
  palmtree: Palmtree,
  plane: Plane,
  thermometer: Thermometer,
  stethoscope: Stethoscope,
  hospital: Hospital,
  baby: Baby,
  heart: Heart,
  'heart-handshake': HeartHandshake,
  users: Users,
  house: House,
  'graduation-cap': GraduationCap,
  briefcase: Briefcase,
  clock: Clock,
  'calendar-off': CalendarOff,
  'calendar-clock': CalendarClock,
  'hand-coins': HandCoins,
  award: Award,
  scale: Scale,
  umbrella: Umbrella,
  flower: Flower,
  landmark: Landmark,
  shield: Shield,
  star: Star,
};

export function leaveIcon(name: string): LucideIcon {
  return LEAVE_ICONS[name] ?? CalendarOff;
}

/** The theme token of a leave colour (ink is the quiet grey of unpaid and other leave). */
export function colorVar(c: LeaveColor | string): string {
  return c === 'rh' || c === 'lh' || c === 'good' || c === 'warn' || c === 'bad' ? `var(--hr-${c})` : 'var(--hr-ink-2)';
}

export function softVar(c: LeaveColor | string): string {
  return c === 'rh' || c === 'lh' || c === 'good' || c === 'warn' || c === 'bad' ? `var(--hr-${c}-soft)` : 'var(--hr-active)';
}

export function toneOf(c: LeaveColor | string): Tone {
  return c === 'rh' || c === 'lh' || c === 'good' || c === 'warn' || c === 'bad' ? c : 'neutral';
}

/** A leave type's icon, in ink on a hairline square (colour belongs to the wallchart bars and their legend). */
export function TypeMark({ icon, size = 28, className }: { icon: string; color?: LeaveColor | string | undefined; size?: number; className?: string | undefined }): React.JSX.Element {
  const Icon = leaveIcon(icon);
  return (
    <span aria-hidden className={cn('inline-flex shrink-0 items-center justify-center rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)] text-[var(--hr-ink-2)]', className)} style={{ width: size, height: size }}>
      <Icon size={Math.round(size * 0.52)} strokeWidth={1.8} />
    </span>
  );
}

/** The icon and name of a type on one line; `keyed` colours the icon like the type's wallchart bars (the legend). */
export function TypeLabel({ name, icon, color, keyed, className }: { name: string; icon: string; color?: LeaveColor | string | undefined; keyed?: boolean | undefined; className?: string | undefined }): React.JSX.Element {
  const Icon = leaveIcon(icon);
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      <Icon size={13} strokeWidth={1.9} aria-hidden style={{ color: keyed === true ? colorVar(color ?? 'ink') : 'var(--hr-ink-2)' }} className="shrink-0" />
      <span className="hr-wrap min-w-0">{name}</span>
    </span>
  );
}
