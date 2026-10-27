/**
 * The app's hand-drawn illustrations, in the same flat style as the
 * landscapes and vignettes: layered fills, a shade, a highlight, no
 * outlines. Every color is a theme variable (--lo-art-*, lib/themeColors.ts),
 * so a theme pack recolors the drawings and an ink pack turns them gray.
 *
 * - AreaArt: the object that stands for each area of life
 * - HabitArt: a drawing per kind of habit (HABIT_ARTS)
 * - CategoryArt: money categories
 * - WeatherArt: weather codes (WMO, as Open-Meteo sends them)
 * - MoodArt: five mood stickers
 * - Avatar: a little villager face for a person, from a number (look)
 * - Mascot: your AI agent's sprite
 * - Jar: a savings jar that fills
 */
import type { ReactNode } from 'react';

export const v = (name: string): string => `var(--lo-art-${name})`;
export const C = {
  red: v('red'),
  redD: v('red-d'),
  redL: v('red-l'),
  pink: v('pink'),
  pinkD: v('pink-d'),
  clay: v('clay'),
  clayD: v('clay-d'),
  honey: v('honey'),
  honeyD: v('honey-d'),
  green: v('green'),
  greenD: v('green-d'),
  greenL: v('green-l'),
  teal: v('teal'),
  tealD: v('teal-d'),
  sky: v('sky'),
  skyD: v('sky-d'),
  water: v('water'),
  plum: v('plum'),
  plumD: v('plum-d'),
  lavender: v('lavender'),
  wood: v('wood'),
  woodD: v('wood-d'),
  woodL: v('wood-l'),
  cream: v('cream'),
  creamD: v('cream-d'),
  stone: v('stone'),
  stoneD: v('stone-d'),
  ink: v('ink'),
  white: v('white'),
  shadow: v('shadow'),
};

export function Svg({ size, children, label, className }: { size: number; children: ReactNode; label?: string | undefined; className?: string | undefined }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} {...(label !== undefined ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })} style={{ flexShrink: 0 }}>
      {children}
    </svg>
  );
}

export const shadow = (rx = 18, cy = 58): React.JSX.Element => <ellipse cx="32" cy={cy} rx={rx} ry="3" fill={C.shadow} />;
export const shine = (x: number, y: number, w: number, h: number, r = -20): React.JSX.Element => <ellipse cx={x} cy={y} rx={w} ry={h} transform={`rotate(${r} ${x} ${y})`} fill={C.white} opacity="0.55" />;

/* ------------------------------------------------------------ areas */

export type AreaKind = 'health' | 'money' | 'relationships' | 'work' | 'home' | 'growth' | 'fun' | 'mind';

export const AREA_KINDS: AreaKind[] = ['health', 'money', 'relationships', 'work', 'home', 'growth', 'fun', 'mind'];

export const AREA_NAMES: Record<AreaKind, string> = {
  health: 'Health',
  money: 'Money',
  relationships: 'Friends and family',
  work: 'Work',
  home: 'Home',
  growth: 'Growth',
  fun: 'Fun',
  mind: 'Mind',
};

export const AREA_BLURB: Record<AreaKind, string> = {
  health: 'Body, sleep, movement',
  money: 'Spending, saving, bills',
  relationships: 'The people close to you',
  work: 'Focus and wins',
  home: 'Chores and shopping',
  growth: 'Books and learning',
  fun: 'Trips and bucket list',
  mind: 'Calm and mood',
};

export function areaBody(kind: AreaKind): React.JSX.Element {
  switch (kind) {
    case 'health':
      return (
        <>
          {shadow(16)}
          <path d="M32 21c-6-5-21-4-21 13 0 13 9 22 15 22 3 0 4-1.5 6-1.5s3 1.5 6 1.5c6 0 15-9 15-22 0-17-15-18-21-13z" fill={C.red} />
          <path d="M45 22c4 3 7 7 7 12 0 11-7 19-13 21 5-4 9-11 9-19 0-6-1-10-3-14z" fill={C.redD} />
          {shine(20, 31, 3, 6.5, -25)}
          <path d="M32 21c0-5 1-9 4-12" stroke={C.wood} strokeWidth="3" strokeLinecap="round" fill="none" />
          <path d="M35 15c3-6 11-7 14-4-3 5-9 7-14 4z" fill={C.green} />
          <path d="M36 14.5c4-1 8-2 12-3.5" stroke={C.greenD} strokeWidth="1.3" strokeLinecap="round" fill="none" />
        </>
      );
    case 'money':
      return (
        <>
          {shadow(18)}
          <path d="M18 22h28v4c3 2 5 5 5 9v15c0 4-3 7-7 7H20c-4 0-7-3-7-7V35c0-4 2-7 5-9z" fill={C.water} />
          <ellipse cx="25" cy="52" rx="8" ry="3.2" fill={C.honeyD} />
          <ellipse cx="25" cy="50.5" rx="8" ry="3.2" fill={C.honey} />
          <ellipse cx="39" cy="52" rx="8" ry="3.2" fill={C.honeyD} />
          <ellipse cx="39" cy="50.5" rx="8" ry="3.2" fill={C.honey} />
          <ellipse cx="39" cy="47.5" rx="8" ry="3.2" fill={C.honeyD} />
          <ellipse cx="39" cy="46" rx="8" ry="3.2" fill={C.honey} />
          <ellipse cx="30" cy="43.5" rx="7" ry="3" fill={C.honeyD} />
          <ellipse cx="30" cy="42" rx="7" ry="3" fill={C.honey} />
          <rect x="17" y="32" width="3.4" height="17" rx="1.7" fill={C.white} opacity="0.6" />
          <rect x="16" y="15" width="32" height="8" rx="3" fill={C.wood} />
          <rect x="16" y="15" width="32" height="3" rx="1.5" fill={C.woodL} />
          <rect x="27" y="18" width="10" height="2" rx="1" fill={C.woodD} />
          <circle cx="32" cy="8.5" r="5" fill={C.honey} />
          <circle cx="32" cy="8.5" r="2.6" fill={C.honeyD} opacity="0.5" />
        </>
      );
    case 'relationships':
      return (
        <>
          {shadow(23, 57)}
          <path d="M17 26c-2-3 2-5 0-8M23 26c-2-3 2-5 0-8M41 26c-2-3 2-5 0-8M47 26c-2-3 2-5 0-8" stroke={C.stone} strokeWidth="2" strokeLinecap="round" fill="none" />
          <path d="M10 36c-6 0-6 10 0 10" stroke={C.pinkD} strokeWidth="3.5" fill="none" />
          <path d="M10 30h20v18c0 4-3 7-7 7h-6c-4 0-7-3-7-7z" fill={C.pink} />
          <path d="M25 30h5v18c0 4-3 7-7 7h-2c3-2 4-4 4-8z" fill={C.pinkD} opacity="0.55" />
          <ellipse cx="20" cy="30" rx="10" ry="2.4" fill={C.pinkD} />
          <path d="M54 36c6 0 6 10 0 10" stroke={C.skyD} strokeWidth="3.5" fill="none" />
          <path d="M34 30h20v18c0 4-3 7-7 7h-6c-4 0-7-3-7-7z" fill={C.sky} />
          <path d="M49 30h5v18c0 4-3 7-7 7h-2c3-2 4-4 4-8z" fill={C.skyD} opacity="0.55" />
          <ellipse cx="44" cy="30" rx="10" ry="2.4" fill={C.skyD} />
          <path d="M32 13c-2-4-8-3-8 1 0 4 8 8 8 8s8-4 8-8c0-4-6-5-8-1z" fill={C.red} />
          {shine(28, 14, 1.4, 2.2, -30)}
        </>
      );
    case 'work':
      return (
        <>
          {shadow(22)}
          <path d="M24 22v-5a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v5" stroke={C.woodD} strokeWidth="3.5" fill="none" />
          <rect x="9" y="21" width="46" height="33" rx="6" fill={C.woodL} />
          <path d="M9 27a6 6 0 0 1 6-6h34a6 6 0 0 1 6 6v8H9z" fill={C.wood} />
          <rect x="13" y="24" width="10" height="2.4" rx="1.2" fill={C.white} opacity="0.35" />
          <rect x="28" y="31" width="8" height="8" rx="2" fill={C.honey} />
          <rect x="30.5" y="33.5" width="3" height="3" rx="0.8" fill={C.honeyD} />
          <path d="M14 47h36" stroke={C.woodD} strokeWidth="1.4" strokeDasharray="3 3" />
        </>
      );
    case 'home':
      return (
        <>
          {shadow(24)}
          <rect x="41" y="15" width="6" height="12" fill={C.stoneD} />
          <circle cx="46" cy="10" r="3" fill={C.stone} opacity="0.85" />
          <circle cx="50.5" cy="5.5" r="2.2" fill={C.stone} opacity="0.6" />
          <rect x="14" y="30" width="36" height="25" rx="2" fill={C.cream} />
          <rect x="40" y="30" width="10" height="25" fill={C.creamD} />
          <path d="M9 33L32 13l23 20z" fill={C.red} />
          <path d="M32 13l23 20h-9L30 15z" fill={C.redD} opacity="0.55" />
          <rect x="8" y="31" width="48" height="4" rx="2" fill={C.redD} />
          <path d="M28 55V45a4 4 0 0 1 8 0v10z" fill={C.wood} />
          <circle cx="34" cy="50" r="0.9" fill={C.honey} />
          <rect x="18" y="39" width="7" height="7" rx="1" fill={C.honey} />
          <path d="M21.5 39v7M18 42.5h7" stroke={C.woodD} strokeWidth="1.1" />
          <rect x="40" y="39" width="7" height="7" rx="1" fill={C.honey} />
          <path d="M43.5 39v7M40 42.5h7" stroke={C.woodD} strokeWidth="1.1" />
          <circle cx="11" cy="54" r="5" fill={C.green} />
          <circle cx="54" cy="54.5" r="4" fill={C.greenD} />
        </>
      );
    case 'growth':
      return (
        <>
          {shadow(22)}
          <rect x="10" y="44" width="44" height="11" rx="2" fill={C.sky} />
          <rect x="47" y="45.5" width="6" height="8" rx="1" fill={C.cream} />
          <rect x="14" y="48" width="14" height="2.4" rx="1.2" fill={C.white} opacity="0.5" />
          <rect x="13" y="34" width="38" height="10" rx="2" fill={C.red} />
          <rect x="44" y="35.5" width="6" height="7" rx="1" fill={C.cream} />
          <rect x="18" y="37.5" width="11" height="3" rx="1" fill={C.honey} />
          <rect x="16" y="26" width="32" height="8" rx="2" fill={C.green} transform="rotate(-5 32 30)" />
          <path d="M33 27V13" stroke={C.greenD} strokeWidth="2.6" strokeLinecap="round" />
          <path d="M33 19c-8 0-12-5-12-11 8 0 12 5 12 11z" fill={C.greenL} />
          <path d="M33 16c1-7 6-11 13-10-1 7-6 10-13 10z" fill={C.green} />
        </>
      );
    case 'fun':
      return (
        <>
          <circle cx="12" cy="12" r="4" fill={C.white} opacity="0.7" />
          <circle cx="17" cy="11" r="5" fill={C.white} opacity="0.7" />
          <path d="M36 5L18 22h18z" fill={C.honey} />
          <path d="M36 5l18 17H36z" fill={C.red} />
          <path d="M18 22l18 20V22z" fill={C.sky} />
          <path d="M54 22L36 42V22z" fill={C.green} />
          <path d="M36 5v37M18 22h36" stroke={C.woodD} strokeWidth="1.6" />
          <path d="M36 42c-4 6 2 9-2 14s-7 4-11 6" stroke={C.stoneD} strokeWidth="1.6" fill="none" strokeLinecap="round" />
          <path d="M31 46l4 2.5-4 2.5zM40 46l-5 2.5 5 2.5z" fill={C.pink} />
          <path d="M24 55l4 1.5-3 3.5zM31 58l-3-1.5 1 4z" fill={C.honey} />
        </>
      );
    case 'mind':
      return (
        <>
          <ellipse cx="32" cy="50" rx="27" ry="8" fill={C.water} />
          <path d="M12 53c4 1.5 8 1.5 12 0M40 54c4 1.5 8 1.5 12 0" stroke={C.sky} strokeWidth="1.6" fill="none" strokeLinecap="round" />
          <ellipse cx="11" cy="47" rx="6" ry="2.6" fill={C.greenD} />
          <ellipse cx="53" cy="48" rx="5" ry="2.2" fill={C.green} />
          <path d="M32 47c-9 0-18-4-21-12 8-2 16 2 21 12z" fill={C.lavender} />
          <path d="M32 47c9 0 18-4 21-12-8-2-16 2-21 12z" fill={C.lavender} />
          <path d="M32 47c-7-3-12-10-10-19 7 3 11 10 10 19z" fill={C.pink} />
          <path d="M32 47c7-3 12-10 10-19-7 3-11 10-10 19z" fill={C.pink} />
          <path d="M32 47c-5-5-6-14 0-22 6 8 5 17 0 22z" fill={C.pinkD} />
          {shine(30, 33, 1.2, 3.5, 0)}
        </>
      );
  }
}

export function AreaArt({ kind, size = 48, label, className }: { kind: AreaKind; size?: number | undefined; label?: string | undefined; className?: string | undefined }): React.JSX.Element {
  return (
    <Svg size={size} label={label} className={className}>
      {areaBody(kind)}
    </Svg>
  );
}

/* ------------------------------------------------------------ habits */

export const HABIT_ARTS: { key: string; label: string }[] = [
  { key: 'water', label: 'Water' },
  { key: 'run', label: 'Run' },
  { key: 'walk', label: 'Walk' },
  { key: 'workout', label: 'Workout' },
  { key: 'yoga', label: 'Yoga' },
  { key: 'read', label: 'Read' },
  { key: 'meditate', label: 'Meditate' },
  { key: 'sleep', label: 'Sleep' },
  { key: 'veggies', label: 'Vegetables' },
  { key: 'fruit', label: 'Fruit' },
  { key: 'journal', label: 'Journal' },
  { key: 'gratitude', label: 'Gratitude' },
  { key: 'nophone', label: 'Less phone' },
  { key: 'teeth', label: 'Teeth' },
  { key: 'vitamins', label: 'Vitamins' },
  { key: 'tidy', label: 'Tidy up' },
  { key: 'plants', label: 'Plants' },
  { key: 'music', label: 'Music' },
  { key: 'language', label: 'Language' },
  { key: 'save', label: 'Save money' },
  { key: 'outside', label: 'Sunlight' },
  { key: 'coffee', label: 'Coffee' },
  { key: 'study', label: 'Study' },
  { key: 'sprout', label: 'Something new' },
];

export function habitBody(art: string): React.JSX.Element {
  switch (art) {
    case 'water':
      return (
        <>
          {shadow(14)}
          <path d="M17 11h30l-4 43a4 4 0 0 1-4 3.6H25a4 4 0 0 1-4-3.6z" fill={C.water} />
          <path d="M19.4 27h25.2l-2.6 27a4 4 0 0 1-4 3.6H26a4 4 0 0 1-4-3.6z" fill={C.sky} />
          <ellipse cx="32" cy="27" rx="12.6" ry="2" fill={C.skyD} opacity="0.5" />
          <rect x="22" y="14" width="3" height="36" rx="1.5" fill={C.white} opacity="0.55" />
          <circle cx="36" cy="40" r="1.6" fill={C.white} opacity="0.7" />
          <circle cx="31" cy="47" r="1.2" fill={C.white} opacity="0.7" />
        </>
      );
    case 'run':
      return (
        <>
          {shadow(24)}
          <path d="M7 45h45c4 0 7 2 7 6v2H7z" fill={C.cream} />
          <path d="M7 50h52v3H7z" fill={C.creamD} />
          <path d="M9 45c0-9 3-16 7-20l10 6c7 4 15 6 24 7 6 1 9 3 9 7z" fill={C.red} />
          <path d="M16 25l4-6 5 3-2 8z" fill={C.redD} />
          <path d="M26 33l4-4M31 35l4-4M36 37l4-4" stroke={C.white} strokeWidth="2" strokeLinecap="round" />
          <path d="M12 42c10 0 24-1 46 1" stroke={C.white} strokeWidth="2.2" strokeLinecap="round" opacity="0.8" fill="none" />
        </>
      );
    case 'walk':
      return (
        <>
          <ellipse cx="22" cy="40" rx="7" ry="11" fill={C.woodL} transform="rotate(-12 22 40)" />
          <circle cx="15" cy="25" r="2.2" fill={C.woodL} />
          <circle cx="19" cy="23" r="2.4" fill={C.woodL} />
          <circle cx="24" cy="23" r="2.6" fill={C.woodL} />
          <ellipse cx="44" cy="30" rx="7" ry="11" fill={C.wood} transform="rotate(12 44 30)" />
          <circle cx="40" cy="15" r="2.6" fill={C.wood} />
          <circle cx="45" cy="14" r="2.4" fill={C.wood} />
          <circle cx="50" cy="16" r="2.2" fill={C.wood} />
        </>
      );
    case 'workout':
      return (
        <>
          {shadow(24)}
          <rect x="16" y="29" width="32" height="6" rx="3" fill={C.stoneD} />
          <rect x="9" y="20" width="9" height="24" rx="3" fill={C.plum} />
          <rect x="46" y="20" width="9" height="24" rx="3" fill={C.plum} />
          <rect x="4" y="25" width="6" height="14" rx="2" fill={C.plumD} />
          <rect x="54" y="25" width="6" height="14" rx="2" fill={C.plumD} />
          <rect x="11" y="23" width="2.4" height="12" rx="1.2" fill={C.white} opacity="0.45" />
          <rect x="48" y="23" width="2.4" height="12" rx="1.2" fill={C.white} opacity="0.45" />
        </>
      );
    case 'yoga':
      return (
        <>
          {shadow(24)}
          <rect x="10" y="30" width="40" height="18" rx="9" fill={C.teal} />
          <circle cx="50" cy="39" r="9" fill={C.tealD} />
          <circle cx="50" cy="39" r="5.5" fill={C.teal} />
          <circle cx="50" cy="39" r="2.2" fill={C.tealD} />
          <rect x="14" y="33" width="26" height="2.6" rx="1.3" fill={C.white} opacity="0.4" />
          <rect x="24" y="28" width="4" height="22" rx="1.5" fill={C.honey} />
        </>
      );
    case 'read':
      return (
        <>
          {shadow(24)}
          <path d="M32 18c-8-5-17-6-26-4v38c9-2 18-1 26 4z" fill={C.sky} />
          <path d="M32 18c8-5 17-6 26-4v38c-9-2-18-1-26 4z" fill={C.sky} />
          <path d="M32 20c-7-4-15-5-23-3v34c8-1 16 0 23 3z" fill={C.cream} />
          <path d="M32 20c7-4 15-5 23-3v34c-8-1-16 0-23 3z" fill={C.cream} />
          <path d="M13 25h14M13 31h14M13 37h12M37 25h14M37 31h14M37 37h10" stroke={C.creamD} strokeWidth="2" strokeLinecap="round" />
          <path d="M44 15v14l3-2 3 2V15" fill={C.red} />
        </>
      );
    case 'meditate':
      return areaBody('mind');
    case 'sleep':
      return (
        <>
          <path d="M38 8a24 24 0 1 0 18 38A19 19 0 0 1 38 8z" fill={C.honey} />
          <path d="M14 38a24 24 0 0 0 42 8 19 19 0 0 1-30-4z" fill={C.honeyD} opacity="0.45" />
          <circle cx="24" cy="30" r="2.4" fill={C.honeyD} opacity="0.6" />
          <circle cx="30" cy="42" r="1.8" fill={C.honeyD} opacity="0.6" />
          <path d="M50 12l1.4 3.2 3.2 1.4-3.2 1.4L50 21.2l-1.4-3.2-3.2-1.4 3.2-1.4z" fill={C.sky} />
          <path d="M57 25l1 2 2 1-2 1-1 2-1-2-2-1 2-1z" fill={C.sky} />
        </>
      );
    case 'veggies':
      return (
        <>
          {shadow(14)}
          <path d="M26 21h12l-4 34c-.4 2-3.6 2-4 0z" fill={C.clay} />
          <path d="M34 21h4l-4 34c-.2 1-1 1.5-2 1.6z" fill={C.clayD} opacity="0.6" />
          <path d="M28 30h4M29 38h4M30 46h3" stroke={C.clayD} strokeWidth="1.6" strokeLinecap="round" />
          <path d="M32 21c-4-6-10-8-14-6 2 5 8 7 14 6zM32 21c0-7 3-12 7-14 1 6-2 11-7 14zM32 21c4-5 10-6 14-4-3 4-9 6-14 4z" fill={C.green} />
        </>
      );
    case 'fruit':
      return areaBody('health');
    case 'journal':
      return (
        <>
          {shadow(20)}
          <rect x="13" y="10" width="34" height="44" rx="4" fill={C.plum} />
          <rect x="13" y="10" width="7" height="44" rx="3" fill={C.plumD} />
          <rect x="25" y="18" width="16" height="8" rx="2" fill={C.cream} />
          <path d="M44 50L55 17l5 2-11 33-4 3z" fill={C.honey} />
          <path d="M55 17l1.6-4.4 5 1.8-1.6 4.4z" fill={C.pink} />
          <path d="M44 50l1 5 4-3z" fill={C.woodD} />
        </>
      );
    case 'gratitude':
      return (
        <>
          <path d="M32 54S10 41 10 25c0-8 6-13 12-13 5 0 8 3 10 6 2-3 5-6 10-6 6 0 12 5 12 13 0 16-22 29-22 29z" fill={C.red} />
          <path d="M47 15c4 2 7 6 7 10 0 14-17 26-21 28 5-5 17-15 17-27 0-5-1-8-3-11z" fill={C.redD} opacity="0.6" />
          {shine(21, 22, 3, 5, -30)}
          <path d="M54 6l1.2 3 3 1.2-3 1.2L54 14.4l-1.2-3-3-1.2 3-1.2z" fill={C.honey} />
          <path d="M10 46l1 2.4 2.4 1-2.4 1L10 52.8l-1-2.4-2.4-1 2.4-1z" fill={C.honey} />
        </>
      );
    case 'nophone':
      return (
        <>
          {shadow(14)}
          <rect x="20" y="8" width="24" height="46" rx="5" fill={C.stoneD} />
          <rect x="23" y="13" width="18" height="34" rx="2" fill={C.sky} />
          <circle cx="32" cy="50.5" r="1.8" fill={C.stone} />
          <circle cx="32" cy="31" r="17" fill="none" stroke={C.red} strokeWidth="4" />
          <path d="M20 43L44 19" stroke={C.red} strokeWidth="4" strokeLinecap="round" />
        </>
      );
    case 'teeth':
      return (
        <>
          {shadow(14)}
          <path d="M20 12c-6 0-9 5-9 11 0 7 4 10 5 17 1 6 1 14 6 14 4 0 4-8 6-12 1-2 2-3 4-3s3 1 4 3c2 4 2 12 6 12 5 0 5-8 6-14 1-7 5-10 5-17 0-6-3-11-9-11-5 0-7 3-12 3s-7-3-12-3z" fill={C.cream} />
          <path d="M44 12c6 0 9 5 9 11 0 7-4 10-5 17-1 6-1 14-6 14 3-4 2-12 4-18 2-7 4-11 4-15 0-5-2-8-6-9z" fill={C.creamD} />
          {shine(20, 20, 2.4, 4.5, -20)}
        </>
      );
    case 'vitamins':
      return (
        <>
          {shadow(16)}
          <g transform="rotate(-40 32 32)">
            <rect x="12" y="23" width="40" height="18" rx="9" fill={C.cream} />
            <path d="M32 23h11a9 9 0 0 1 0 18H32z" fill={C.red} />
            <rect x="16" y="26" width="12" height="3" rx="1.5" fill={C.white} opacity="0.6" />
          </g>
          <circle cx="50" cy="48" r="5" fill={C.honey} />
          <circle cx="14" cy="16" r="3.6" fill={C.greenL} />
        </>
      );
    case 'tidy':
      return (
        <>
          {shadow(16)}
          <rect x="30" y="4" width="4" height="34" rx="2" fill={C.wood} />
          <path d="M22 38h20l6 18H16z" fill={C.honey} />
          <rect x="22" y="36" width="20" height="5" rx="2" fill={C.clay} />
          <path d="M24 44l-3 11M30 44l-1 11M35 44l1 11M40 44l3 11" stroke={C.honeyD} strokeWidth="1.4" strokeLinecap="round" />
          <circle cx="50" cy="20" r="2" fill={C.sky} />
          <circle cx="54" cy="26" r="1.4" fill={C.sky} />
        </>
      );
    case 'plants':
      return (
        <>
          {shadow(20)}
          <path d="M14 30h28v18c0 4-3 7-7 7H21c-4 0-7-3-7-7z" fill={C.sky} />
          <path d="M42 34l12-10 3 3-13 13z" fill={C.skyD} />
          <path d="M14 34c-6 0-7 10 0 10" stroke={C.skyD} strokeWidth="3.5" fill="none" />
          <rect x="16" y="33" width="3" height="16" rx="1.5" fill={C.white} opacity="0.45" />
          <path d="M57 30c0 3-2 5-2 5s-2-2-2-5c0-2 2-4 2-4s2 2 2 4zM53 40c0 2-1.5 3.6-1.5 3.6S50 42 50 40c0-1.6 1.5-3 1.5-3s1.5 1.4 1.5 3z" fill={C.water} />
          <path d="M28 30V20" stroke={C.greenD} strokeWidth="2.4" strokeLinecap="round" />
          <path d="M28 23c-6 0-9-4-9-8 6 0 9 4 9 8zM28 21c1-5 4-8 9-7-1 5-4 7-9 7z" fill={C.green} />
        </>
      );
    case 'music':
      return (
        <>
          <path d="M22 44V14l28-6v30" stroke={C.plumD} strokeWidth="4" fill="none" strokeLinejoin="round" />
          <path d="M22 18l28-6" stroke={C.plumD} strokeWidth="6" />
          <ellipse cx="16" cy="45" rx="8" ry="6" fill={C.plum} transform="rotate(-20 16 45)" />
          <ellipse cx="44" cy="39" rx="8" ry="6" fill={C.plum} transform="rotate(-20 44 39)" />
          {shine(13, 43, 2, 1.2, -20)}
          {shine(41, 37, 2, 1.2, -20)}
        </>
      );
    case 'language':
      return (
        <>
          <path d="M8 12h30a4 4 0 0 1 4 4v16a4 4 0 0 1-4 4H22l-8 7v-7H8a4 4 0 0 1-4-4V16a4 4 0 0 1 4-4z" fill={C.sky} />
          <path d="M28 26h28a4 4 0 0 1 4 4v15a4 4 0 0 1-4 4h-4v7l-8-7H28a4 4 0 0 1-4-4V30a4 4 0 0 1 4-4z" fill={C.honey} />
          <circle cx="34" cy="38" r="2.2" fill={C.honeyD} />
          <circle cx="42" cy="38" r="2.2" fill={C.honeyD} />
          <circle cx="50" cy="38" r="2.2" fill={C.honeyD} />
          <path d="M11 21h16M11 27h10" stroke={C.white} strokeWidth="2.4" strokeLinecap="round" opacity="0.8" />
        </>
      );
    case 'save':
      return (
        <>
          {shadow(18)}
          <ellipse cx="32" cy="38" rx="20" ry="15" fill={C.pink} />
          <circle cx="47" cy="34" r="6" fill={C.pinkD} />
          <circle cx="45.5" cy="33" r="1.2" fill={C.ink} />
          <circle cx="48.5" cy="33" r="1.2" fill={C.ink} />
          <circle cx="26" cy="31" r="1.4" fill={C.ink} />
          <path d="M18 25l-2-6 7 3z" fill={C.pinkD} />
          <rect x="18" y="49" width="5" height="7" rx="2" fill={C.pinkD} />
          <rect x="38" y="49" width="5" height="7" rx="2" fill={C.pinkD} />
          <rect x="27" y="22" width="10" height="2.4" rx="1.2" fill={C.ink} opacity="0.7" />
          <circle cx="32" cy="12" r="6" fill={C.honey} />
          <circle cx="32" cy="12" r="3" fill={C.honeyD} opacity="0.5" />
        </>
      );
    case 'outside':
      return (
        <>
          <circle cx="32" cy="32" r="13" fill={C.honey} />
          <circle cx="36" cy="36" r="9" fill={C.honeyD} opacity="0.35" />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
            <rect key={a} x="30" y="4" width="4" height="9" rx="2" fill={C.honey} transform={`rotate(${a} 32 32)`} />
          ))}
          {shine(27, 27, 2.6, 4, -35)}
        </>
      );
    case 'coffee':
      return (
        <>
          <ellipse cx="30" cy="54" rx="22" ry="5" fill={C.creamD} />
          <path d="M44 32c8 0 8 12 0 12" stroke={C.cream} strokeWidth="4" fill="none" />
          <path d="M12 26h34v14c0 8-6 14-14 14h-6c-8 0-14-6-14-14z" fill={C.cream} />
          <ellipse cx="29" cy="26" rx="17" ry="4" fill={C.wood} />
          <path d="M22 20c-2-3 2-5 0-8M30 20c-2-3 2-5 0-8M38 20c-2-3 2-5 0-8" stroke={C.stone} strokeWidth="2" strokeLinecap="round" fill="none" />
          <rect x="16" y="31" width="3" height="12" rx="1.5" fill={C.white} opacity="0.7" />
        </>
      );
    case 'study':
      return (
        <>
          {shadow(18)}
          <g transform="rotate(35 32 32)">
            <rect x="26" y="8" width="12" height="38" rx="2" fill={C.honey} />
            <rect x="30" y="8" width="4" height="38" fill={C.honeyD} opacity="0.5" />
            <rect x="26" y="4" width="12" height="7" rx="2" fill={C.pink} />
            <rect x="26" y="10" width="12" height="3" fill={C.stone} />
            <path d="M26 46h12l-6 12z" fill={C.cream} />
            <path d="M30 54h4l-2 4z" fill={C.ink} />
          </g>
        </>
      );
    default:
      return (
        <>
          {shadow(16)}
          <path d="M18 38h28l-4 18H22z" fill={C.clay} />
          <rect x="15" y="33" width="34" height="8" rx="3" fill={C.clayD} />
          <path d="M32 33V18" stroke={C.greenD} strokeWidth="2.6" strokeLinecap="round" />
          <path d="M32 24c-9 0-14-6-14-13 9 0 14 6 14 13z" fill={C.green} />
          <path d="M32 21c1-8 7-13 15-12-1 8-7 12-15 12z" fill={C.greenL} />
        </>
      );
  }
}

export function HabitArt({ art, size = 40, label, className }: { art: string; size?: number | undefined; label?: string | undefined; className?: string | undefined }): React.JSX.Element {
  return (
    <Svg size={size} label={label} className={className}>
      {habitBody(art)}
    </Svg>
  );
}

/* --------------------------------------------------- money categories */

export type MoneyCategory = 'food' | 'groceries' | 'transport' | 'home' | 'bills' | 'fun' | 'health' | 'shopping' | 'gifts' | 'other' | 'salary' | 'extra';

export const SPEND_CATEGORIES: { key: MoneyCategory; label: string }[] = [
  { key: 'food', label: 'Eating out' },
  { key: 'groceries', label: 'Groceries' },
  { key: 'transport', label: 'Transport' },
  { key: 'home', label: 'Home' },
  { key: 'bills', label: 'Bills' },
  { key: 'fun', label: 'Fun' },
  { key: 'health', label: 'Health' },
  { key: 'shopping', label: 'Shopping' },
  { key: 'gifts', label: 'Gifts' },
  { key: 'other', label: 'Other' },
];

export const INCOME_CATEGORIES: { key: MoneyCategory; label: string }[] = [
  { key: 'salary', label: 'Salary' },
  { key: 'extra', label: 'Extra income' },
];

export function categoryBody(cat: MoneyCategory): React.JSX.Element {
  switch (cat) {
    case 'food':
      return (
        <>
          <path d="M14 10l14 20M24 8l8 22" stroke={C.wood} strokeWidth="2.6" strokeLinecap="round" />
          <path d="M8 32h48c0 13-10 22-24 22S8 45 8 32z" fill={C.clay} />
          <path d="M44 32h12c0 11-7 19-17 21 5-5 6-13 5-21z" fill={C.clayD} opacity="0.55" />
          <ellipse cx="32" cy="32" rx="24" ry="4.5" fill={C.cream} />
          <path d="M16 31c3-2 6 1 9-1s6 1 9-1 6 1 9-1 5 1 7 0" stroke={C.honey} strokeWidth="2" fill="none" strokeLinecap="round" />
          <circle cx="42" cy="30" r="3" fill={C.green} />
          <rect x="18" y="38" width="10" height="2.4" rx="1.2" fill={C.white} opacity="0.4" />
        </>
      );
    case 'groceries':
      return (
        <>
          <ellipse cx="22" cy="22" rx="6" ry="12" fill={C.honey} transform="rotate(-20 22 22)" />
          <circle cx="40" cy="22" r="7" fill={C.red} />
          <path d="M40 15c1-3 3-4 5-4" stroke={C.greenD} strokeWidth="2" strokeLinecap="round" fill="none" />
          <path d="M8 28h48l-5 24a4 4 0 0 1-4 3H17a4 4 0 0 1-4-3z" fill={C.wood} />
          <path d="M10 34h44M12 42h40" stroke={C.woodD} strokeWidth="1.6" />
          <path d="M24 28l-4 27M40 28l4 27M32 28v27" stroke={C.woodD} strokeWidth="1.6" />
        </>
      );
    case 'transport':
      return (
        <>
          <rect x="9" y="12" width="46" height="36" rx="7" fill={C.honey} />
          <rect x="9" y="38" width="46" height="10" rx="3" fill={C.honeyD} />
          <rect x="14" y="18" width="16" height="13" rx="2" fill={C.sky} />
          <rect x="34" y="18" width="16" height="13" rx="2" fill={C.sky} />
          <rect x="16" y="20" width="3" height="9" rx="1.5" fill={C.white} opacity="0.6" />
          <circle cx="18" cy="49" r="5.5" fill={C.ink} />
          <circle cx="46" cy="49" r="5.5" fill={C.ink} />
          <circle cx="18" cy="49" r="2" fill={C.stone} />
          <circle cx="46" cy="49" r="2" fill={C.stone} />
          <rect x="12" y="40" width="6" height="3.4" rx="1.7" fill={C.cream} />
          <rect x="46" y="40" width="6" height="3.4" rx="1.7" fill={C.cream} />
        </>
      );
    case 'home':
      return areaBody('home');
    case 'bills':
      return (
        <>
          <rect x="8" y="16" width="48" height="34" rx="4" fill={C.cream} />
          <path d="M8 18l24 18 24-18" stroke={C.creamD} strokeWidth="3" fill="none" strokeLinejoin="round" />
          <circle cx="32" cy="36" r="6" fill={C.red} />
          <circle cx="32" cy="36" r="2.6" fill={C.redD} />
        </>
      );
    case 'fun':
      return (
        <>
          <g transform="rotate(-12 32 32)">
            <path d="M8 20h48v8a4 4 0 0 0 0 8v8H8v-8a4 4 0 0 0 0-8z" fill={C.plum} />
            <path d="M42 20v24" stroke={C.lavender} strokeWidth="2" strokeDasharray="3 3" />
            <path d="M24 26l2 4 4.4.6-3.2 3 .8 4.4-4-2.2-4 2.2.8-4.4-3.2-3 4.4-.6z" fill={C.honey} />
          </g>
        </>
      );
    case 'health':
      return habitBody('vitamins');
    case 'shopping':
      return (
        <>
          <path d="M24 22v-4a8 8 0 0 1 16 0v4" stroke={C.pinkD} strokeWidth="3.4" fill="none" />
          <path d="M12 22h40l-3 30a4 4 0 0 1-4 3.6H19a4 4 0 0 1-4-3.6z" fill={C.pink} />
          <path d="M42 22h10l-3 30a4 4 0 0 1-4 3.6h-2c3-2 3-6 3-10z" fill={C.pinkD} opacity="0.5" />
          <rect x="17" y="26" width="3" height="20" rx="1.5" fill={C.white} opacity="0.5" />
        </>
      );
    case 'gifts':
      return (
        <>
          <rect x="10" y="26" width="44" height="28" rx="3" fill={C.red} />
          <rect x="8" y="20" width="48" height="9" rx="3" fill={C.redD} />
          <rect x="28" y="20" width="8" height="34" fill={C.honey} />
          <path d="M32 20c-6-8-15-8-15-3 0 4 8 4 15 3zM32 20c6-8 15-8 15-3 0 4-8 4-15 3z" fill={C.honey} />
        </>
      );
    case 'salary':
    case 'extra':
      return (
        <>
          <ellipse cx="32" cy="52" rx="16" ry="5" fill={C.honeyD} />
          <ellipse cx="32" cy="49" rx="16" ry="5" fill={C.honey} />
          <ellipse cx="32" cy="45" rx="16" ry="5" fill={C.honeyD} />
          <ellipse cx="32" cy="42" rx="16" ry="5" fill={C.honey} />
          <ellipse cx="32" cy="38" rx="16" ry="5" fill={C.honeyD} />
          <ellipse cx="32" cy="35" rx="16" ry="5" fill={C.honey} />
          <path d="M32 8v16M24 15l8-8 8 8" stroke={C.green} strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </>
      );
    default:
      return (
        <>
          <circle cx="32" cy="34" r="20" fill={C.honeyD} />
          <circle cx="32" cy="32" r="20" fill={C.honey} />
          <circle cx="32" cy="32" r="13" fill={C.honeyD} opacity="0.45" />
          {shine(24, 24, 3, 5, -35)}
        </>
      );
  }
}

export function CategoryArt({ category, size = 32, className }: { category: MoneyCategory | string; size?: number | undefined; className?: string | undefined }): React.JSX.Element {
  return (
    <Svg size={size} className={className}>
      {categoryBody(category as MoneyCategory)}
    </Svg>
  );
}

/* ------------------------------------------------------------ weather */

const cloud = (fill: string, shade: string, dx = 0, dy = 0): React.JSX.Element => (
  <g transform={`translate(${dx} ${dy})`}>
    <path d="M18 48h28a11 11 0 0 0 1-22 14 14 0 0 0-27-3 12 12 0 0 0-2 25z" fill={fill} />
    <path d="M18 48h28a11 11 0 0 0 9-5c-6 3-16 3-26 2-6 0-10-2-13-5 1 5 1 8 2 8z" fill={shade} opacity="0.6" />
  </g>
);

/** What a WMO weather code looks like and is called. */
export function weatherWord(code: number): string {
  if (code === 0) return 'Clear';
  if (code <= 2) return 'Partly cloudy';
  if (code === 3) return 'Cloudy';
  if (code === 45 || code === 48) return 'Fog';
  if (code >= 51 && code <= 57) return 'Drizzle';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'Rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'Snow';
  if (code >= 95) return 'Thunderstorm';
  return 'Cloudy';
}

export function WeatherArt({ code, night = false, size = 40, className }: { code: number; night?: boolean | undefined; size?: number | undefined; className?: string | undefined }): React.JSX.Element {
  const word = weatherWord(code);
  const sun = night ? (
    <path d="M30 6a18 18 0 1 0 22 26A14 14 0 0 1 30 6z" fill={C.honey} />
  ) : (
    <>
      <circle cx="28" cy="24" r="12" fill={C.honey} />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
        <rect key={a} x="26.5" y="2" width="3" height="7" rx="1.5" fill={C.honeyD} transform={`rotate(${a} 28 24)`} />
      ))}
    </>
  );
  let art: React.JSX.Element;
  if (word === 'Clear') art = <g transform="translate(4 8)">{sun}</g>;
  else if (word === 'Partly cloudy')
    art = (
      <>
        <g transform="translate(-4 -2)">{sun}</g>
        {cloud(C.cream, C.creamD, 4, 6)}
      </>
    );
  else if (word === 'Cloudy') art = cloud(C.cream, C.stone, 0, 2);
  else if (word === 'Fog')
    art = (
      <>
        {cloud(C.stone, C.stoneD, 0, -6)}
        <path d="M10 48h40M16 55h36" stroke={C.stone} strokeWidth="3.4" strokeLinecap="round" />
      </>
    );
  else if (word === 'Snow')
    art = (
      <>
        {cloud(C.cream, C.stone, 0, -6)}
        <circle cx="22" cy="52" r="2.6" fill={C.white} stroke={C.stone} strokeWidth="1" />
        <circle cx="34" cy="56" r="2.6" fill={C.white} stroke={C.stone} strokeWidth="1" />
        <circle cx="45" cy="51" r="2.6" fill={C.white} stroke={C.stone} strokeWidth="1" />
      </>
    );
  else if (word === 'Thunderstorm')
    art = (
      <>
        {cloud(C.stoneD, C.ink, 0, -6)}
        <path d="M33 42l-6 10h6l-3 9 10-13h-6l4-6z" fill={C.honey} />
      </>
    );
  else
    art = (
      <>
        {cloud(C.stone, C.stoneD, 0, -6)}
        <path d="M22 48l-3 7M32 48l-3 7M42 48l-3 7" stroke={C.sky} strokeWidth="3.2" strokeLinecap="round" />
      </>
    );
  return (
    <Svg size={size} label={word} className={className}>
      {art}
    </Svg>
  );
}

/* --------------------------------------------------------------- mood */

export const MOOD_WORDS = ['Rough', 'Low', 'Okay', 'Good', 'Great'];

export function MoodArt({ mood, size = 40, className }: { mood: number; size?: number | undefined; className?: string | undefined }): React.JSX.Element {
  const face = [C.stone, C.lavender, C.sky, C.greenL, C.honey][Math.max(0, Math.min(4, mood - 1))] as string;
  const mouth = ['M24 45c4-5 12-5 16 0', 'M25 44c4-2 10-2 14 0', 'M25 42h14', 'M24 40c4 4 12 4 16 0', 'M22 39c4 8 16 8 20 0z'][Math.max(0, Math.min(4, mood - 1))] as string;
  return (
    <Svg size={size} label={MOOD_WORDS[mood - 1] ?? 'Mood'} className={className}>
      <circle cx="32" cy="33" r="25" fill={face} />
      <path d="M50 18a25 25 0 0 1-30 37 25 25 0 0 0 30-37z" fill={C.ink} opacity="0.08" />
      {shine(22, 20, 4, 6, -35)}
      <ellipse cx="24" cy="30" rx="2.6" ry="3.4" fill={C.ink} />
      <ellipse cx="40" cy="30" rx="2.6" ry="3.4" fill={C.ink} />
      {mood >= 4 && (
        <>
          <ellipse cx="18" cy="38" rx="4" ry="2.4" fill={C.pink} opacity="0.8" />
          <ellipse cx="46" cy="38" rx="4" ry="2.4" fill={C.pink} opacity="0.8" />
        </>
      )}
      <path d={mouth} stroke={C.ink} strokeWidth="2.6" strokeLinecap="round" fill={mood === 5 ? C.redD : 'none'} />
      {mood === 1 && <path d="M43 35c0 3-1.6 5-1.6 5s-1.6-2-1.6-5c0-1.6 1.6-3 1.6-3s1.6 1.4 1.6 3z" fill={C.sky} />}
    </Svg>
  );
}

/* ------------------------------------------------------------ people */

const SKIN = ['skin-1', 'skin-2', 'skin-3', 'skin-4', 'skin-5'];
const HAIR = ['hair-1', 'hair-2', 'hair-3', 'hair-4', 'hair-5', 'hair-6'];
const SHIRT = [C.sky, C.green, C.honey, C.pink, C.plum, C.teal];
const BACKS = [C.water, C.cream, C.lavender, C.greenL, C.pink, C.honey];

/** A small villager face. `look` picks skin, hair style, hair color and shirt. */
export function Avatar({ look, size = 40, label, className, ring }: { look: number; size?: number | undefined; label?: string | undefined; className?: string | undefined; ring?: string | undefined }): React.JSX.Element {
  const n = Math.abs(Math.floor(look));
  const skin = v(SKIN[n % 5] as string);
  const style = Math.floor(n / 5) % 6;
  const hair = v(HAIR[Math.floor(n / 30) % 6] as string);
  const shirt = SHIRT[Math.floor(n / 180) % 6] as string;
  const back = BACKS[(n * 7) % 6] as string;
  return (
    <Svg size={size} label={label} className={className}>
      <circle cx="32" cy="32" r="31" fill={back} opacity="0.55" />
      {ring !== undefined && <circle cx="32" cy="32" r="30" fill="none" stroke={ring} strokeWidth="3" />}
      <clipPath id={`av${n}`}>
        <circle cx="32" cy="32" r="31" />
      </clipPath>
      <g clipPath={`url(#av${n})`}>
        <path d="M10 64c0-12 10-18 22-18s22 6 22 18z" fill={shirt} />
        {style === 1 && <path d="M15 30c-3 12 0 22 4 26h26c4-4 7-14 4-26z" fill={hair} />}
        <circle cx="16" cy="34" r="3.6" fill={skin} />
        <circle cx="48" cy="34" r="3.6" fill={skin} />
        <circle cx="32" cy="32" r="16" fill={skin} />
        {style === 0 && <path d="M16 32c0-11 7-17 16-17s16 6 16 17c-3-6-9-9-16-9s-13 3-16 9z" fill={hair} />}
        {style === 1 && <path d="M16 32c0-11 7-17 16-17s16 6 16 17c-2-4-6-8-11-9-2 3-8 6-21 9z" fill={hair} />}
        {style === 2 && (
          <>
            <circle cx="32" cy="12" r="6" fill={hair} />
            <path d="M16 31c0-10 7-16 16-16s16 6 16 16c-4-5-10-8-16-8s-12 3-16 8z" fill={hair} />
          </>
        )}
        {style === 3 && (
          <>
            {[18, 24, 30, 36, 42, 46].map((x, i) => (
              <circle key={x} cx={x} cy={i % 2 === 0 ? 20 : 17} r="6" fill={hair} />
            ))}
            <circle cx="16" cy="27" r="4.6" fill={hair} />
            <circle cx="48" cy="27" r="4.6" fill={hair} />
          </>
        )}
        {style === 4 && <path d="M15 36c0-14 7-21 17-21s17 7 17 21c-1-5-2-8-3-10H18c-1 2-2 5-3 10z" fill={hair} />}
        {style === 5 && (
          <>
            <path d="M16 31c0-10 7-16 16-16s16 6 16 16c-5-4-10-7-16-7s-11 3-16 7z" fill={hair} />
            <path d="M47 24c6 2 8 10 5 18-2-6-4-10-7-13z" fill={hair} />
          </>
        )}
        <ellipse cx="26" cy="34" rx="2" ry="2.6" fill={C.ink} />
        <ellipse cx="38" cy="34" rx="2" ry="2.6" fill={C.ink} />
        <ellipse cx="22" cy="39.5" rx="3" ry="1.8" fill={C.pink} opacity="0.7" />
        <ellipse cx="42" cy="39.5" rx="3" ry="1.8" fill={C.pink} opacity="0.7" />
        <path d="M28.5 40.5c2 2 5 2 7 0" stroke={C.ink} strokeWidth="1.8" strokeLinecap="round" fill="none" />
      </g>
    </Svg>
  );
}

/** A fresh look for a new person. */
export function newLook(): number {
  return Math.floor(Math.random() * 1080);
}

/* ------------------------------------------------------------ mascot */

/** Your AI agent's sprite: a round seedling with two leaves. */
export function Mascot({ size = 56, className }: { size?: number | undefined; className?: string | undefined }): React.JSX.Element {
  return (
    <Svg size={size} className={className}>
      <ellipse cx="32" cy="58" rx="15" ry="3" fill={C.shadow} />
      <path d="M32 18c-2-7-9-11-15-9 1 7 8 11 15 9z" fill={C.greenL} />
      <path d="M32 18c2-8 9-12 16-10-1 8-8 12-16 10z" fill={C.green} />
      <path d="M32 18v6" stroke={C.greenD} strokeWidth="2.4" strokeLinecap="round" />
      <ellipse cx="32" cy="40" rx="20" ry="17" fill={C.green} />
      <path d="M48 31c3 4 4 9 3 13-2 7-9 12-19 13 9-3 15-9 16-17 0-3 0-6 0-9z" fill={C.greenD} opacity="0.55" />
      {shine(22, 32, 4, 6, -40)}
      <ellipse cx="25" cy="40" rx="2.4" ry="3.2" fill={C.ink} />
      <ellipse cx="39" cy="40" rx="2.4" ry="3.2" fill={C.ink} />
      <circle cx="25.8" cy="38.8" r="0.8" fill={C.white} />
      <circle cx="39.8" cy="38.8" r="0.8" fill={C.white} />
      <ellipse cx="20" cy="46" rx="3.4" ry="2" fill={C.pink} opacity="0.8" />
      <ellipse cx="44" cy="46" rx="3.4" ry="2" fill={C.pink} opacity="0.8" />
      <path d="M29 46c2 2 4 2 6 0" stroke={C.ink} strokeWidth="1.8" strokeLinecap="round" fill="none" />
    </Svg>
  );
}

/* --------------------------------------------------------------- jar */

/** A savings jar filled to `fill` (0 to 1). */
export function Jar({ fill, size = 72, label, className }: { fill: number; size?: number | undefined; label?: string | undefined; className?: string | undefined }): React.JSX.Element {
  const f = Math.max(0, Math.min(1, fill));
  const top = 56 - f * 30;
  return (
    <Svg size={size} label={label} className={className}>
      <ellipse cx="32" cy="59" rx="17" ry="3" fill={C.shadow} />
      <clipPath id={`jar${Math.round(f * 1000)}`}>
        <path d="M18 22h28v4c3 2 5 5 5 9v15c0 4-3 7-7 7H20c-4 0-7-3-7-7V35c0-4 2-7 5-9z" />
      </clipPath>
      <path d="M18 22h28v4c3 2 5 5 5 9v15c0 4-3 7-7 7H20c-4 0-7-3-7-7V35c0-4 2-7 5-9z" fill={C.water} />
      <g clipPath={`url(#jar${Math.round(f * 1000)})`}>
        <rect x="10" y={top} width="44" height="40" fill={C.honey} />
        <path d={`M10 ${top}c6 -2 10 2 16 0s10 -2 16 0 8 2 12 0v3H10z`} fill={C.honeyD} opacity="0.5" />
        {f > 0.15 && <circle cx="24" cy={Math.min(52, top + 8)} r="2.4" fill={C.honeyD} opacity="0.6" />}
        {f > 0.35 && <circle cx="38" cy={Math.min(50, top + 12)} r="2.4" fill={C.honeyD} opacity="0.6" />}
      </g>
      <rect x="17" y="31" width="3.4" height="18" rx="1.7" fill={C.white} opacity="0.6" />
      <rect x="16" y="15" width="32" height="8" rx="3" fill={C.wood} />
      <rect x="16" y="15" width="32" height="3" rx="1.5" fill={C.woodL} />
    </Svg>
  );
}
