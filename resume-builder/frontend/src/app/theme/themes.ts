// User-facing theme IDs — each auto-resolves to a dark or light variant
// based on the CraftBot app's current mode. 'custom' is always applied as-is.
export type ThemeId = 'craftbot' | 'normal' | 'ocean' | 'forest' | 'pastel' | 'custom';

// Internal keys used in THEMES — includes both dark and light variants
type InternalId =
  | 'craftbot'
  | 'craftbot-light'
  | 'dark'
  | 'light'
  | 'ocean'
  | 'ocean-light'
  | 'forest'
  | 'forest-light'
  | 'pastel'
  | 'pastel-dark';

export interface ThemeVars {
  '--bg-primary': string;
  '--bg-secondary': string;
  '--bg-tertiary': string;
  '--text-primary': string;
  '--text-secondary': string;
  '--text-muted': string;
  '--border-primary': string;
  '--border-secondary': string;
  '--color-primary': string;
  '--color-primary-hover': string;
  '--color-primary-light': string;
  '--color-primary-subtle': string;
  '--shadow-sm': string;
  '--shadow-md': string;
  '--shadow-lg': string;
  '--overlay-color': string;
}

export interface ThemeMeta {
  label: string;
  swatches: [string, string, string, string]; // bg, surface, text, accent (dark variant)
}

export interface CustomColors {
  bg: string;
  surface: string;
  text: string;
  accent: string;
}

// ── Hex color utilities ──────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

function blendHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

function adjustBrightness(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r + amount, g + amount, b + amount);
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return r + g + b;
}

// ── Custom theme derivation ──────────────────────────────────────────────────

export function buildCustomThemeVars(c: CustomColors): ThemeVars {
  const isDark = luminance(c.bg) < 200;
  const bgTertiary = blendHex(c.bg, c.surface, 0.5);
  const textSecondary = blendHex(c.bg, c.text, 0.55);
  const textMuted = blendHex(c.bg, c.text, 0.32);
  const borderPrimary = blendHex(c.bg, c.surface, 0.35);
  const borderSecondary = blendHex(c.bg, c.surface, 0.2);
  const accentHover = isDark ? adjustBrightness(c.accent, -25) : adjustBrightness(c.accent, 25);
  const [ar, ag, ab] = hexToRgb(c.accent);
  const shadowStr = isDark ? '0.4' : '0.08';
  const shadowMd = isDark ? '0.5' : '0.10';
  const shadowLg = isDark ? '0.6' : '0.14';
  return {
    '--bg-primary': c.bg,
    '--bg-secondary': c.surface,
    '--bg-tertiary': bgTertiary,
    '--text-primary': c.text,
    '--text-secondary': textSecondary,
    '--text-muted': textMuted,
    '--border-primary': borderPrimary,
    '--border-secondary': borderSecondary,
    '--color-primary': c.accent,
    '--color-primary-hover': accentHover,
    '--color-primary-light': `rgba(${ar},${ag},${ab},0.15)`,
    '--color-primary-subtle': `rgba(${ar},${ag},${ab},0.08)`,
    '--shadow-sm': `0 1px 2px rgba(0,0,0,${shadowStr})`,
    '--shadow-md': `0 4px 6px rgba(0,0,0,${shadowMd})`,
    '--shadow-lg': `0 10px 15px rgba(0,0,0,${shadowLg})`,
    '--overlay-color': isDark ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.4)',
  };
}

// ── Internal preset themes ───────────────────────────────────────────────────

const THEMES: Record<InternalId, ThemeVars> = {
  craftbot: {
    '--bg-primary': '#191919',
    '--bg-secondary': '#202020',
    '--bg-tertiary': '#2A2A2A',
    '--text-primary': '#E6E6E4',
    '--text-secondary': '#9A9A97',
    '--text-muted': '#6A6A67',
    '--border-primary': '#363636',
    '--border-secondary': '#2A2A2A',
    '--color-primary': '#FF4F18',
    '--color-primary-hover': '#E64515',
    '--color-primary-light': 'rgba(255,79,24,0.15)',
    '--color-primary-subtle': 'rgba(255,79,24,0.08)',
    '--shadow-sm': '0 1px 2px rgba(0,0,0,0.4)',
    '--shadow-md': '0 4px 6px rgba(0,0,0,0.5)',
    '--shadow-lg': '0 10px 15px rgba(0,0,0,0.6)',
    '--overlay-color': 'rgba(0,0,0,0.6)',
  },
  'craftbot-light': {
    '--bg-primary': '#FFFFFF',
    '--bg-secondary': '#FFFFFF',
    '--bg-tertiary': '#F8FAFC',
    '--text-primary': '#141517',
    '--text-secondary': '#5A5B60',
    '--text-muted': '#8E8F94',
    '--border-primary': '#E2E8F0',
    '--border-secondary': '#F1F5F9',
    '--color-primary': '#FF4F18',
    '--color-primary-hover': '#E64515',
    '--color-primary-light': '#FFFFFF',
    '--color-primary-subtle': 'rgba(255,79,24,0.08)',
    '--shadow-sm': '0 1px 2px rgba(0,0,0,0.06)',
    '--shadow-md': '0 4px 6px rgba(0,0,0,0.08)',
    '--shadow-lg': '0 10px 15px rgba(0,0,0,0.12)',
    '--overlay-color': 'rgba(0,0,0,0.4)',
  },
  light: {
    '--bg-primary': '#FFFFFF',
    '--bg-secondary': '#FFFFFF',
    '--bg-tertiary': '#F8FAFC',
    '--text-primary': '#111111',
    '--text-secondary': '#555555',
    '--text-muted': '#888888',
    '--border-primary': '#E2E8F0',
    '--border-secondary': '#F1F5F9',
    '--color-primary': '#2563EB',
    '--color-primary-hover': '#1D4ED8',
    '--color-primary-light': '#FFFFFF',
    '--color-primary-subtle': 'rgba(37,99,235,0.06)',
    '--shadow-sm': '0 1px 2px rgba(0,0,0,0.05)',
    '--shadow-md': '0 4px 6px rgba(0,0,0,0.07)',
    '--shadow-lg': '0 10px 15px rgba(0,0,0,0.10)',
    '--overlay-color': 'rgba(0,0,0,0.4)',
  },
  dark: {
    '--bg-primary': '#0A0A0A',
    '--bg-secondary': '#181818',
    '--bg-tertiary': '#222222',
    '--text-primary': '#FFFFFF',
    '--text-secondary': '#A0A0A0',
    '--text-muted': '#6B6B6B',
    '--border-primary': '#333333',
    '--border-secondary': '#222222',
    '--color-primary': '#3B82F6',
    '--color-primary-hover': '#2563EB',
    '--color-primary-light': 'rgba(59,130,246,0.15)',
    '--color-primary-subtle': 'rgba(59,130,246,0.08)',
    '--shadow-sm': '0 1px 2px rgba(0,0,0,0.4)',
    '--shadow-md': '0 4px 6px rgba(0,0,0,0.5)',
    '--shadow-lg': '0 10px 15px rgba(0,0,0,0.7)',
    '--overlay-color': 'rgba(0,0,0,0.7)',
  },
  ocean: {
    '--bg-primary': '#0F172A',
    '--bg-secondary': '#1E293B',
    '--bg-tertiary': '#273549',
    '--text-primary': '#F8FAFC',
    '--text-secondary': '#94A3B8',
    '--text-muted': '#64748B',
    '--border-primary': '#334155',
    '--border-secondary': '#273549',
    '--color-primary': '#38BDF8',
    '--color-primary-hover': '#0EA5E9',
    '--color-primary-light': 'rgba(56,189,248,0.15)',
    '--color-primary-subtle': 'rgba(56,189,248,0.08)',
    '--shadow-sm': '0 1px 2px rgba(0,0,0,0.4)',
    '--shadow-md': '0 4px 6px rgba(0,0,0,0.5)',
    '--shadow-lg': '0 10px 15px rgba(0,0,0,0.6)',
    '--overlay-color': 'rgba(0,0,0,0.6)',
  },
  'ocean-light': {
    '--bg-primary': '#F0F9FF',
    '--bg-secondary': '#E0F2FE',
    '--bg-tertiary': '#BAE6FD',
    '--text-primary': '#0C4A6E',
    '--text-secondary': '#075985',
    '--text-muted': '#0284C7',
    '--border-primary': '#BAE6FD',
    '--border-secondary': '#E0F2FE',
    '--color-primary': '#0284C7',
    '--color-primary-hover': '#0369A1',
    '--color-primary-light': 'rgba(2,132,199,0.12)',
    '--color-primary-subtle': 'rgba(2,132,199,0.06)',
    '--shadow-sm': '0 1px 2px rgba(0,0,0,0.05)',
    '--shadow-md': '0 4px 6px rgba(0,0,0,0.08)',
    '--shadow-lg': '0 10px 15px rgba(0,0,0,0.12)',
    '--overlay-color': 'rgba(0,0,0,0.4)',
  },
  forest: {
    '--bg-primary': '#0F1A14',
    '--bg-secondary': '#1B2A21',
    '--bg-tertiary': '#233829',
    '--text-primary': '#F3F6F4',
    '--text-secondary': '#8FAF98',
    '--text-muted': '#5E7A66',
    '--border-primary': '#2E4A36',
    '--border-secondary': '#233829',
    '--color-primary': '#22C55E',
    '--color-primary-hover': '#16A34A',
    '--color-primary-light': 'rgba(34,197,94,0.15)',
    '--color-primary-subtle': 'rgba(34,197,94,0.08)',
    '--shadow-sm': '0 1px 2px rgba(0,0,0,0.4)',
    '--shadow-md': '0 4px 6px rgba(0,0,0,0.5)',
    '--shadow-lg': '0 10px 15px rgba(0,0,0,0.6)',
    '--overlay-color': 'rgba(0,0,0,0.6)',
  },
  'forest-light': {
    '--bg-primary': '#F0FDF4',
    '--bg-secondary': '#DCFCE7',
    '--bg-tertiary': '#BBF7D0',
    '--text-primary': '#14532D',
    '--text-secondary': '#166534',
    '--text-muted': '#16A34A',
    '--border-primary': '#BBF7D0',
    '--border-secondary': '#DCFCE7',
    '--color-primary': '#16A34A',
    '--color-primary-hover': '#15803D',
    '--color-primary-light': 'rgba(22,163,74,0.12)',
    '--color-primary-subtle': 'rgba(22,163,74,0.06)',
    '--shadow-sm': '0 1px 2px rgba(0,0,0,0.05)',
    '--shadow-md': '0 4px 6px rgba(0,0,0,0.08)',
    '--shadow-lg': '0 10px 15px rgba(0,0,0,0.12)',
    '--overlay-color': 'rgba(0,0,0,0.4)',
  },
  pastel: {
    '--bg-primary': '#FAF7FF',
    '--bg-secondary': '#FFFFFF',
    '--bg-tertiary': '#F0EAFA',
    '--text-primary': '#40384D',
    '--text-secondary': '#7B6F8C',
    '--text-muted': '#9E93AE',
    '--border-primary': '#D9D0E8',
    '--border-secondary': '#EDE8F6',
    '--color-primary': '#C084FC',
    '--color-primary-hover': '#A855F7',
    '--color-primary-light': 'rgba(192,132,252,0.15)',
    '--color-primary-subtle': 'rgba(192,132,252,0.08)',
    '--shadow-sm': '0 1px 2px rgba(0,0,0,0.05)',
    '--shadow-md': '0 4px 6px rgba(0,0,0,0.08)',
    '--shadow-lg': '0 10px 15px rgba(0,0,0,0.12)',
    '--overlay-color': 'rgba(0,0,0,0.4)',
  },
  'pastel-dark': {
    '--bg-primary': '#1A1023',
    '--bg-secondary': '#231530',
    '--bg-tertiary': '#2E1B40',
    '--text-primary': '#F3E8FF',
    '--text-secondary': '#D8B4FE',
    '--text-muted': '#A855F7',
    '--border-primary': '#4C1D95',
    '--border-secondary': '#3B0764',
    '--color-primary': '#C084FC',
    '--color-primary-hover': '#A855F7',
    '--color-primary-light': 'rgba(192,132,252,0.15)',
    '--color-primary-subtle': 'rgba(192,132,252,0.08)',
    '--shadow-sm': '0 1px 2px rgba(0,0,0,0.4)',
    '--shadow-md': '0 4px 6px rgba(0,0,0,0.5)',
    '--shadow-lg': '0 10px 15px rgba(0,0,0,0.6)',
    '--overlay-color': 'rgba(0,0,0,0.6)',
  },
};

// Resolves user-facing ThemeId + mode → internal theme vars
const VARIANT: Record<Exclude<ThemeId, 'custom'>, { dark: InternalId; light: InternalId }> = {
  craftbot: { dark: 'craftbot',      light: 'craftbot-light' },
  normal:   { dark: 'dark',          light: 'light'          },
  ocean:    { dark: 'ocean',         light: 'ocean-light'    },
  forest:   { dark: 'forest',        light: 'forest-light'   },
  pastel:   { dark: 'pastel-dark',   light: 'pastel'         },
};

export const DEFAULT_CUSTOM_COLORS: CustomColors = {
  bg: '#191919',
  surface: '#202020',
  text: '#E6E6E4',
  accent: '#FF4F18',
};

export function applyThemeToDocument(
  id: ThemeId,
  mode: 'dark' | 'light' = 'dark',
  customColors?: CustomColors,
): void {
  const vars: ThemeVars =
    id === 'custom'
      ? buildCustomThemeVars(customColors ?? DEFAULT_CUSTOM_COLORS)
      : THEMES[VARIANT[id][mode]];

  const isDarkMode = mode === 'dark';
  const dropdownBg = isDarkMode ? '#000000' : vars['--bg-secondary'];
  const dropdownText = isDarkMode ? '#FFFFFF' : vars['--text-primary'];

  const styleId = 'craftbot-theme-vars';
  let el = document.getElementById(styleId) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = styleId;
  }
  
  const declarations = (Object.keys(vars) as (keyof ThemeVars)[])
    .map(k => `${k}:${vars[k]}`)
    .join(';');

  // Also bind to Resume Builder tokens with !important to guarantee precedence
  const resumeBuilderOverrides = `
    --bg-app: ${vars['--bg-primary']} !important;
    --bg-panel: ${vars['--bg-secondary']} !important;
    --bg-card: ${vars['--bg-tertiary']} !important;
    --bg-hover: ${vars['--color-primary-light']} !important;
    --border-color: ${vars['--border-primary']} !important;
    --text-primary: ${vars['--text-primary']} !important;
    --text-secondary: ${vars['--text-secondary']} !important;
    --text-muted: ${vars['--text-muted']} !important;
    --accent-primary: ${vars['--color-primary']} !important;
    --accent-hover: ${vars['--color-primary-hover']} !important;
    --select-dropdown-bg: ${dropdownBg} !important;
  `;

  el.textContent = `
    html, body, :root { ${declarations} ${resumeBuilderOverrides} }
    select, .select-input { background-color: ${dropdownBg} !important; color: ${dropdownText} !important; border-color: ${vars['--border-primary']} !important; }
    optgroup, select optgroup, .select-input optgroup { background-color: ${dropdownBg} !important; color: ${vars['--color-primary']} !important; font-weight: 700 !important; font-style: normal !important; }
    option, select option, .select-input option { background-color: ${dropdownBg} !important; color: ${dropdownText} !important; }
    .form-control, input, textarea, select { background-color: ${vars['--bg-tertiary']} !important; color: ${vars['--text-primary']} !important; }
    .form-control:focus, input:focus, textarea:focus, select:focus { background-color: ${vars['--bg-tertiary']} !important; color: ${vars['--text-primary']} !important; border-color: ${vars['--color-primary']} !important; box-shadow: 0 0 0 2px ${vars['--color-primary-light']} !important; outline: none !important; }
    input:-webkit-autofill, input:-webkit-autofill:hover, input:-webkit-autofill:focus, textarea:-webkit-autofill, select:-webkit-autofill { -webkit-text-fill-color: ${vars['--text-primary']} !important; -webkit-box-shadow: 0 0 0px 1000px ${vars['--bg-tertiary']} inset !important; }
    * { scrollbar-width: thin !important; scrollbar-color: ${vars['--border-primary']} ${vars['--bg-secondary']} !important; }
    ::-webkit-scrollbar { width: 6px !important; height: 6px !important; }
    ::-webkit-scrollbar-track { background: ${vars['--bg-secondary']} !important; border-radius: 4px !important; }
    ::-webkit-scrollbar-thumb { background: ${vars['--border-primary']} !important; border-radius: 6px !important; }
    ::-webkit-scrollbar-thumb:hover { background: ${vars['--color-primary']} !important; }
  `;
  document.head.appendChild(el);
}
