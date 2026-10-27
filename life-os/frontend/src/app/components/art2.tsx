/**
 * More drawings in the same flat style (art.tsx): the navigation, the
 * board's lists, workouts, rooms and small things (a cake, an umbrella, a
 * ticket, a timer). Colors are theme variables only.
 */
import { C, Svg, areaBody, categoryBody, habitBody, shadow, shine } from './art.tsx';

/* ------------------------------------------------------------ navigation */

export type NavKind = 'home' | 'board' | 'habits' | 'life' | 'projects' | 'journal' | 'agent';

function navBody(kind: NavKind): React.JSX.Element {
  switch (kind) {
    case 'home':
      return areaBody('home');
    case 'board':
      return (
        <>
          <rect x="6" y="10" width="52" height="42" rx="5" fill={C.wood} />
          <rect x="10" y="14" width="44" height="34" rx="3" fill={C.woodL} />
          <rect x="14" y="18" width="15" height="13" rx="1.5" fill={C.honey} transform="rotate(-6 21 24)" />
          <rect x="34" y="17" width="15" height="12" rx="1.5" fill={C.sky} transform="rotate(5 41 23)" />
          <rect x="22" y="33" width="16" height="12" rx="1.5" fill={C.pink} transform="rotate(-3 30 39)" />
          <circle cx="21" cy="19" r="2" fill={C.red} />
          <circle cx="41" cy="18" r="2" fill={C.green} />
          <circle cx="30" cy="34" r="2" fill={C.skyD} />
          <rect x="16" y="52" width="4" height="7" rx="1.5" fill={C.woodD} />
          <rect x="44" y="52" width="4" height="7" rx="1.5" fill={C.woodD} />
        </>
      );
    case 'habits':
      return habitBody('sprout');
    case 'life':
      return (
        <>
          <ellipse cx="32" cy="44" rx="28" ry="13" fill={C.water} />
          <path d="M8 42c2-10 12-15 24-15s22 5 24 15c-6 6-15 8-24 8S14 48 8 42z" fill={C.honey} />
          <path d="M11 40c3-8 11-12 21-12s18 4 21 12c-6 4-14 6-21 6s-15-2-21-6z" fill={C.green} />
          <circle cx="22" cy="34" r="6" fill={C.greenD} />
          <rect x="21" y="34" width="2" height="7" fill={C.woodD} />
          <path d="M35 39l8-10 8 10z" fill={C.red} />
          <rect x="37" y="39" width="12" height="4" fill={C.cream} />
          <path d="M28 18c0-6 8-6 8 0 0 5-4 8-4 8s-4-3-4-8z" fill={C.red} />
          <circle cx="32" cy="18" r="1.6" fill={C.white} />
        </>
      );
    case 'projects':
      return (
        <>
          {shadow(24)}
          <ellipse cx="14" cy="52" rx="7" ry="3" fill={C.stoneD} />
          <ellipse cx="14" cy="51" rx="7" ry="3" fill={C.stone} />
          <ellipse cx="29" cy="44" rx="6" ry="2.6" fill={C.stoneD} />
          <ellipse cx="29" cy="43" rx="6" ry="2.6" fill={C.stone} />
          <ellipse cx="42" cy="36" rx="5" ry="2.2" fill={C.stoneD} />
          <ellipse cx="42" cy="35" rx="5" ry="2.2" fill={C.stone} />
          <rect x="47" y="8" width="2.6" height="27" rx="1.3" fill={C.woodD} />
          <path d="M49.6 9h11l-4 5 4 5h-11z" fill={C.red} />
        </>
      );
    case 'journal':
      return habitBody('journal');
    case 'agent':
      return (
        <>
          <ellipse cx="32" cy="58" rx="15" ry="3" fill={C.shadow} />
          <path d="M32 18c-2-7-9-11-15-9 1 7 8 11 15 9z" fill={C.greenL} />
          <path d="M32 18c2-8 9-12 16-10-1 8-8 12-16 10z" fill={C.green} />
          <path d="M32 18v6" stroke={C.greenD} strokeWidth="2.4" strokeLinecap="round" />
          <ellipse cx="32" cy="40" rx="20" ry="17" fill={C.green} />
          <path d="M48 31c3 4 4 9 3 13-2 7-9 12-19 13 9-3 15-9 16-17 0-3 0-6 0-9z" fill={C.greenD} opacity="0.55" />
          <ellipse cx="25" cy="40" rx="2.4" ry="3.2" fill={C.ink} />
          <ellipse cx="39" cy="40" rx="2.4" ry="3.2" fill={C.ink} />
          <path d="M29 46c2 2 4 2 6 0" stroke={C.ink} strokeWidth="1.8" strokeLinecap="round" fill="none" />
        </>
      );
  }
}

export function NavArt({ kind, size = 22, className }: { kind: NavKind; size?: number | undefined; className?: string | undefined }): React.JSX.Element {
  return (
    <Svg size={size} className={className}>
      {navBody(kind)}
    </Svg>
  );
}

/* ------------------------------------------------------- the board lists */

export type ColumnKind = 'inbox' | 'today' | 'coming' | 'later' | 'done';

function columnBody(kind: ColumnKind): React.JSX.Element {
  switch (kind) {
    case 'inbox':
      return (
        <>
          <rect x="29" y="34" width="5" height="24" rx="1.5" fill={C.woodD} />
          <path d="M12 22a10 10 0 0 1 10-10h20a10 10 0 0 1 10 10v16H12z" fill={C.sky} />
          <path d="M12 22a10 10 0 0 1 20 0v16H12z" fill={C.skyD} />
          <rect x="16" y="26" width="12" height="3" rx="1.5" fill={C.ink} opacity="0.5" />
          <rect x="46" y="16" width="2.6" height="14" rx="1" fill={C.woodD} />
          <path d="M48.6 16h8v6h-8z" fill={C.red} />
          <rect x="34" y="16" width="14" height="10" rx="1" fill={C.cream} transform="rotate(-8 41 21)" />
        </>
      );
    case 'today':
      return habitBody('outside');
    case 'coming':
      return (
        <>
          {shadow(20)}
          <rect x="10" y="12" width="44" height="42" rx="5" fill={C.cream} />
          <path d="M10 17a5 5 0 0 1 5-5h34a5 5 0 0 1 5 5v7H10z" fill={C.red} />
          <rect x="18" y="7" width="4" height="10" rx="2" fill={C.stoneD} />
          <rect x="42" y="7" width="4" height="10" rx="2" fill={C.stoneD} />
          {[0, 1, 2, 3].map((c) => [0, 1, 2].map((r) => <rect key={`${c}${r}`} x={15 + c * 9.5} y={29 + r * 8} width="6" height="5" rx="1" fill={c === 1 && r === 1 ? C.honey : C.creamD} />))}
        </>
      );
    case 'later':
      return (
        <>
          {shadow(14)}
          <rect x="16" y="6" width="32" height="5" rx="2.5" fill={C.wood} />
          <rect x="16" y="53" width="32" height="5" rx="2.5" fill={C.wood} />
          <path d="M20 11h24c0 10-8 14-8 21s8 11 8 21H20c0-10 8-14 8-21s-8-11-8-21z" fill={C.water} />
          <path d="M24 17h16c-2 5-6 8-8 11-2-3-6-6-8-11z" fill={C.honey} />
          <path d="M23 53c2-5 6-8 9-8s7 3 9 8z" fill={C.honey} />
          <rect x="31" y="31" width="2" height="12" rx="1" fill={C.honey} />
        </>
      );
    case 'done':
      return (
        <>
          {shadow(20)}
          <path d="M12 28h40l-4 24a4 4 0 0 1-4 3.4H20a4 4 0 0 1-4-3.4z" fill={C.wood} />
          <path d="M14 36h36M15 44h34" stroke={C.woodD} strokeWidth="1.6" />
          <path d="M8 28h48" stroke={C.woodL} strokeWidth="5" strokeLinecap="round" />
          <circle cx="32" cy="16" r="11" fill={C.green} />
          <path d="M26.5 16.5l4 4 7.5-8" stroke={C.white} strokeWidth="3.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </>
      );
  }
}

export function ColumnArt({ kind, size = 28, className }: { kind: ColumnKind; size?: number | undefined; className?: string | undefined }): React.JSX.Element {
  return (
    <Svg size={size} className={className}>
      {columnBody(kind)}
    </Svg>
  );
}

/* -------------------------------------------------------------- workouts */

export const WORKOUT_KINDS: { key: 'walk' | 'run' | 'gym' | 'yoga' | 'bike' | 'swim' | 'sport' | 'dance'; label: string }[] = [
  { key: 'walk', label: 'Walk' },
  { key: 'run', label: 'Run' },
  { key: 'gym', label: 'Gym' },
  { key: 'yoga', label: 'Yoga' },
  { key: 'bike', label: 'Bike' },
  { key: 'swim', label: 'Swim' },
  { key: 'sport', label: 'Sport' },
  { key: 'dance', label: 'Dance' },
];

function workoutBody(kind: string): React.JSX.Element {
  switch (kind) {
    case 'walk':
      return habitBody('walk');
    case 'run':
      return habitBody('run');
    case 'gym':
      return habitBody('workout');
    case 'yoga':
      return habitBody('yoga');
    case 'bike':
      return (
        <>
          {shadow(26)}
          <circle cx="16" cy="42" r="11" fill="none" stroke={C.ink} strokeWidth="3.4" />
          <circle cx="48" cy="42" r="11" fill="none" stroke={C.ink} strokeWidth="3.4" />
          <path d="M16 42l10-16h16l6 16M26 26l8 16h-18M34 42l8-16" stroke={C.red} strokeWidth="3.4" fill="none" strokeLinejoin="round" strokeLinecap="round" />
          <path d="M22 22h8" stroke={C.ink} strokeWidth="3.4" strokeLinecap="round" />
          <path d="M42 26l-2-6h6" stroke={C.ink} strokeWidth="3" fill="none" strokeLinecap="round" />
        </>
      );
    case 'swim':
      return (
        <>
          <path d="M4 40c5 0 5-4 10-4s5 4 10 4 5-4 10-4 5 4 10 4 5-4 10-4 5 4 6 4v18H4z" fill={C.sky} />
          <path d="M4 48c5 0 5-4 10-4s5 4 10 4 5-4 10-4 5 4 10 4 5-4 10-4 5 4 6 4" stroke={C.water} strokeWidth="2.4" fill="none" />
          <circle cx="40" cy="26" r="9" fill={C.red} />
          <path d="M31 26a9 9 0 0 1 18 0z" fill={C.redD} />
          <rect x="31" y="27" width="18" height="4" rx="2" fill={C.ink} opacity="0.75" />
          <path d="M10 34c4-6 10-9 16-8" stroke={C.cream} strokeWidth="4" strokeLinecap="round" fill="none" />
        </>
      );
    case 'sport':
      return (
        <>
          {shadow(18)}
          <circle cx="32" cy="32" r="22" fill={C.honey} />
          <path d="M32 10v44M10 32h44" stroke={C.honeyD} strokeWidth="2.4" />
          <path d="M17 16c6 6 6 26 0 32M47 16c-6 6-6 26 0 32" stroke={C.honeyD} strokeWidth="2.4" fill="none" />
          {shine(24, 22, 3, 5, -35)}
        </>
      );
    case 'dance':
      return habitBody('music');
    default:
      return habitBody('sprout');
  }
}

export function WorkoutArt({ kind, size = 32, className }: { kind: string; size?: number | undefined; className?: string | undefined }): React.JSX.Element {
  return (
    <Svg size={size} className={className}>
      {workoutBody(kind)}
    </Svg>
  );
}

/* ----------------------------------------------------------------- rooms */

export const ROOMS: { key: 'kitchen' | 'bathroom' | 'living' | 'bedroom' | 'laundry' | 'outside' | 'other'; label: string }[] = [
  { key: 'kitchen', label: 'Kitchen' },
  { key: 'bathroom', label: 'Bathroom' },
  { key: 'living', label: 'Living room' },
  { key: 'bedroom', label: 'Bedroom' },
  { key: 'laundry', label: 'Laundry' },
  { key: 'outside', label: 'Outside' },
  { key: 'other', label: 'Other' },
];

function roomBody(room: string): React.JSX.Element {
  switch (room) {
    case 'kitchen':
      return (
        <>
          {shadow(22)}
          <path d="M22 18c-2-3 2-5 0-8M32 18c-2-3 2-5 0-8M42 18c-2-3 2-5 0-8" stroke={C.stone} strokeWidth="2" strokeLinecap="round" fill="none" />
          <rect x="6" y="28" width="8" height="4" rx="2" fill={C.ink} />
          <rect x="50" y="28" width="8" height="4" rx="2" fill={C.ink} />
          <path d="M12 26h40v20c0 6-5 10-11 10H23c-6 0-11-4-11-10z" fill={C.red} />
          <path d="M44 26h8v20c0 6-5 10-11 10h-2c4-3 5-7 5-12z" fill={C.redD} opacity="0.6" />
          <rect x="10" y="22" width="44" height="6" rx="3" fill={C.redD} />
          <rect x="16" y="32" width="3" height="14" rx="1.5" fill={C.white} opacity="0.45" />
        </>
      );
    case 'bathroom':
      return (
        <>
          {shadow(26)}
          <path d="M14 30V16a6 6 0 0 1 12 0" stroke={C.stoneD} strokeWidth="3" fill="none" strokeLinecap="round" />
          <circle cx="40" cy="24" r="4" fill={C.white} opacity="0.85" />
          <circle cx="46" cy="18" r="3" fill={C.white} opacity="0.85" />
          <circle cx="34" cy="18" r="2.4" fill={C.white} opacity="0.85" />
          <path d="M6 32h52v4c0 10-8 16-18 16H24C14 52 6 46 6 36z" fill={C.cream} />
          <path d="M44 32h14v4c0 10-8 16-18 16h-2c6-3 8-9 8-16z" fill={C.creamD} />
          <rect x="4" y="29" width="56" height="5" rx="2.5" fill={C.sky} />
          <rect x="14" y="51" width="4" height="7" rx="2" fill={C.stoneD} />
          <rect x="46" y="51" width="4" height="7" rx="2" fill={C.stoneD} />
        </>
      );
    case 'living':
      return (
        <>
          {shadow(27)}
          <rect x="12" y="18" width="40" height="20" rx="6" fill={C.teal} />
          <rect x="6" y="28" width="12" height="20" rx="5" fill={C.tealD} />
          <rect x="46" y="28" width="12" height="20" rx="5" fill={C.tealD} />
          <rect x="16" y="34" width="32" height="12" rx="4" fill={C.teal} />
          <path d="M32 34v12" stroke={C.tealD} strokeWidth="1.6" />
          <rect x="10" y="48" width="4" height="7" rx="1.5" fill={C.woodD} />
          <rect x="50" y="48" width="4" height="7" rx="1.5" fill={C.woodD} />
          <rect x="20" y="22" width="10" height="9" rx="3" fill={C.honey} transform="rotate(-8 25 26)" />
        </>
      );
    case 'bedroom':
      return (
        <>
          {shadow(27)}
          <rect x="6" y="16" width="6" height="40" rx="2" fill={C.wood} />
          <rect x="52" y="28" width="6" height="28" rx="2" fill={C.wood} />
          <rect x="10" y="34" width="46" height="14" rx="3" fill={C.cream} />
          <path d="M26 30h30v12H26z" fill={C.plum} />
          <path d="M26 30h30v4H26z" fill={C.plumD} />
          <rect x="13" y="26" width="13" height="9" rx="4" fill={C.white} opacity="0.95" />
          <rect x="10" y="46" width="46" height="5" rx="2" fill={C.woodD} />
        </>
      );
    case 'laundry':
      return (
        <>
          {shadow(20)}
          <rect x="12" y="8" width="40" height="48" rx="5" fill={C.cream} />
          <rect x="12" y="8" width="40" height="10" rx="5" fill={C.creamD} />
          <circle cx="20" cy="13" r="2" fill={C.red} />
          <rect x="34" y="11.5" width="12" height="3" rx="1.5" fill={C.stoneD} />
          <circle cx="32" cy="37" r="13" fill={C.stoneD} />
          <circle cx="32" cy="37" r="10" fill={C.sky} />
          <path d="M22 39c4 3 8-3 12 0s6 1 8-1" stroke={C.water} strokeWidth="2.4" fill="none" />
          {shine(27, 32, 2, 3.4, -30)}
        </>
      );
    case 'outside':
      return habitBody('plants');
    default:
      return habitBody('tidy');
  }
}

export function RoomArt({ room, size = 32, className }: { room: string; size?: number | undefined; className?: string | undefined }): React.JSX.Element {
  return (
    <Svg size={size} className={className}>
      {roomBody(room)}
    </Svg>
  );
}

/* ---------------------------------------------------------- small things */

export type ThingKind = 'cake' | 'umbrella' | 'ticket' | 'timer' | 'envelope' | 'balloon' | 'pin' | 'star' | 'trophy' | 'suitcase' | 'flag' | 'bubble' | 'bowl' | 'basket' | 'scale';

function thingBody(kind: ThingKind): React.JSX.Element {
  switch (kind) {
    case 'cake':
      return (
        <>
          {shadow(22)}
          <rect x="31" y="9" width="2.6" height="10" rx="1.3" fill={C.sky} />
          <path d="M32.3 2c2 3 2 5 0 6-2-1-2-3 0-6z" fill={C.honey} />
          <rect x="12" y="30" width="40" height="24" rx="4" fill={C.pink} />
          <rect x="16" y="19" width="32" height="13" rx="4" fill={C.cream} />
          <path d="M16 28c3 3 5-2 8 1s5-2 8 1 5-2 8 1 5-2 8 1" stroke={C.pinkD} strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d="M12 42c4 3 6-2 10 1s6-2 10 1 6-2 10 1 6-2 10 1" stroke={C.cream} strokeWidth="3" fill="none" strokeLinecap="round" />
          <circle cx="22" cy="24" r="1.6" fill={C.red} />
          <circle cx="42" cy="24" r="1.6" fill={C.red} />
        </>
      );
    case 'umbrella':
      return (
        <>
          <path d="M32 8C18 8 7 18 6 30c3-3 6-3 9 0 3-3 7-3 10 0 2-3 5-3 7 0 2-3 5-3 7 0 3-3 7-3 10 0 3-3 6-3 9 0C57 18 46 8 32 8z" fill={C.red} />
          <path d="M32 8c6 4 9 13 7 22-2-3-5-3-7 0 2-9 2-17 0-22z" fill={C.redD} opacity="0.55" />
          <path d="M32 30v20a5 5 0 0 1-10 0" stroke={C.woodD} strokeWidth="3.2" fill="none" strokeLinecap="round" />
          <path d="M14 44l-2 5M48 40l-2 5M54 50l-2 5" stroke={C.sky} strokeWidth="3" strokeLinecap="round" />
        </>
      );
    case 'ticket':
      return (
        <g transform="rotate(-10 32 32)">
          <path d="M6 18h52v9a5 5 0 0 0 0 10v9H6v-9a5 5 0 0 0 0-10z" fill={C.teal} />
          <path d="M44 18v28" stroke={C.cream} strokeWidth="2" strokeDasharray="3 3" />
          <path d="M14 26h22M14 32h16M14 38h20" stroke={C.cream} strokeWidth="2.6" strokeLinecap="round" />
          <path d="M51 28l3 4-3 4-3-4z" fill={C.honey} />
        </g>
      );
    case 'timer':
      return (
        <>
          {shadow(18)}
          <rect x="28" y="4" width="8" height="6" rx="2" fill={C.stoneD} />
          <circle cx="32" cy="35" r="22" fill={C.red} />
          <circle cx="32" cy="35" r="16" fill={C.cream} />
          <path d="M32 35V23M32 35l8 5" stroke={C.ink} strokeWidth="3" strokeLinecap="round" />
          <circle cx="32" cy="35" r="2.4" fill={C.ink} />
          <path d="M46 16l4-4" stroke={C.stoneD} strokeWidth="3.4" strokeLinecap="round" />
          {shine(20, 24, 3, 5, -35)}
        </>
      );
    case 'envelope':
      return categoryBody('bills');
    case 'balloon':
      return (
        <>
          <ellipse cx="26" cy="22" rx="13" ry="15" fill={C.red} />
          <ellipse cx="40" cy="26" rx="12" ry="14" fill={C.sky} />
          {shine(21, 16, 2.4, 4, -30)}
          {shine(36, 20, 2.2, 3.6, -30)}
          <path d="M26 37c0 6 4 10 6 20M40 40c0 6-4 9-8 17" stroke={C.stoneD} strokeWidth="1.6" fill="none" />
          <path d="M24 37h4l-2 3zM38 40h4l-2 3z" fill={C.ink} opacity="0.4" />
        </>
      );
    case 'pin':
      return (
        <>
          {shadow(10)}
          <path d="M32 58S14 38 14 25a18 18 0 0 1 36 0c0 13-18 33-18 33z" fill={C.red} />
          <path d="M44 14c4 3 6 7 6 11 0 11-13 27-17 31 4-6 13-20 13-30 0-5-1-9-2-12z" fill={C.redD} opacity="0.55" />
          <circle cx="32" cy="25" r="7" fill={C.cream} />
        </>
      );
    case 'star':
      return (
        <>
          <path d="M32 6l7.6 16.4 17.8 2-13.2 12.2 3.6 17.6L32 45.4l-15.8 8.8 3.6-17.6L6.6 24.4l17.8-2z" fill={C.honey} />
          <path d="M32 6l7.6 16.4 17.8 2-13.2 12.2 3.6 17.6L32 45.4z" fill={C.honeyD} opacity="0.5" />
          {shine(26, 24, 2, 3.4, -30)}
        </>
      );
    case 'trophy':
      return (
        <>
          {shadow(16)}
          <path d="M18 14h-8c0 10 4 16 10 16M46 14h8c0 10-4 16-10 16" stroke={C.honeyD} strokeWidth="3.4" fill="none" />
          <path d="M18 8h28v12c0 9-6 16-14 16s-14-7-14-16z" fill={C.honey} />
          <path d="M38 8h8v12c0 9-6 16-14 16 4-3 6-10 6-16z" fill={C.honeyD} opacity="0.55" />
          <rect x="29" y="36" width="6" height="10" fill={C.honeyD} />
          <rect x="20" y="46" width="24" height="9" rx="2" fill={C.wood} />
          <rect x="26" y="49" width="12" height="3" rx="1" fill={C.honey} />
        </>
      );
    case 'suitcase':
      return (
        <>
          {shadow(22)}
          <path d="M24 16v-4a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v4" stroke={C.woodD} strokeWidth="3.4" fill="none" />
          <rect x="10" y="16" width="44" height="38" rx="6" fill={C.clay} />
          <rect x="20" y="16" width="4" height="38" fill={C.clayD} />
          <rect x="40" y="16" width="4" height="38" fill={C.clayD} />
          <circle cx="16" cy="26" r="3" fill={C.honey} />
          <rect x="30" y="34" width="6" height="8" rx="2" fill={C.sky} transform="rotate(12 33 38)" />
        </>
      );
    case 'flag':
      return (
        <>
          {shadow(14)}
          <path d="M16 56c4-6 28-6 32 0z" fill={C.green} />
          <rect x="22" y="6" width="3" height="50" rx="1.5" fill={C.woodD} />
          <path d="M25 8h26l-6 9 6 9H25z" fill={C.red} />
          <path d="M25 8h26l-6 9H25z" fill={C.redL} opacity="0.35" />
        </>
      );
    case 'scale':
      return (
        <>
          {shadow(22)}
          <rect x="9" y="14" width="46" height="42" rx="10" fill={C.teal} />
          <rect x="9" y="44" width="46" height="12" rx="6" fill={C.tealD} />
          <rect x="17" y="20" width="30" height="16" rx="5" fill={C.cream} />
          <path d="M24 32a8 8 0 0 1 16 0" stroke={C.creamD} strokeWidth="2.4" fill="none" />
          <path d="M32 32l4-6" stroke={C.red} strokeWidth="2.4" strokeLinecap="round" />
          <circle cx="32" cy="32" r="1.8" fill={C.ink} />
          <rect x="13" y="17" width="3" height="20" rx="1.5" fill={C.white} opacity="0.4" />
        </>
      );
    case 'bubble':
      return habitBody('language');
    case 'bowl':
      return categoryBody('food');
    case 'basket':
      return categoryBody('groceries');
  }
}

export function ThingArt({ kind, size = 32, className, label }: { kind: ThingKind; size?: number | undefined; className?: string | undefined; label?: string | undefined }): React.JSX.Element {
  return (
    <Svg size={size} className={className} label={label}>
      {thingBody(kind)}
    </Svg>
  );
}

/** A book's spine colors by its look (0 to 7). */
export const SPINES: { body: string; band: string }[] = [
  { body: C.red, band: C.honey },
  { body: C.sky, band: C.cream },
  { body: C.green, band: C.honey },
  { body: C.plum, band: C.lavender },
  { body: C.honey, band: C.redD },
  { body: C.teal, band: C.cream },
  { body: C.clay, band: C.cream },
  { body: C.pinkD, band: C.cream },
];

/** A savings jar's lid color by its look. */
export const JAR_LIDS = [C.wood, C.red, C.sky, C.green, C.plum, C.honeyD, C.teal, C.pinkD];
