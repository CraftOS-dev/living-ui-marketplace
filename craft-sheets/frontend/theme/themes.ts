export type ThemeId =
  | 'craftbot'
  | 'craftbot-light'
  | 'light'
  | 'dark'
  | 'ocean'
  | 'forest'
  | 'pastel'

export interface ThemeVars {
  '--bg-primary': string
  '--bg-secondary': string
  '--bg-tertiary': string
  '--text-primary': string
  '--text-secondary': string
  '--text-muted': string
  '--border-primary': string
  '--border-secondary': string
  '--color-primary': string
  '--color-primary-hover': string
  '--color-primary-light': string
  '--color-primary-subtle': string
  '--shadow-sm': string
  '--shadow-md': string
  '--shadow-lg': string
  '--overlay-color': string
}

export interface ThemeMeta {
  label: string
  swatches: [string, string, string, string] // bg, surface, text, accent
}

export const THEMES: Record<ThemeId, ThemeVars> = {
  craftbot: {
    '--bg-primary': '#141517',
    '--bg-secondary': '#1E1F22',
    '--bg-tertiary': '#252628',
    '--text-primary': '#F4F4F5',
    '--text-secondary': '#9FA0A6',
    '--text-muted': '#6B6C72',
    '--border-primary': '#34353A',
    '--border-secondary': '#252628',
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
    '--bg-primary': '#F7F7F8',
    '--bg-secondary': '#FFFFFF',
    '--bg-tertiary': '#EBEBED',
    '--text-primary': '#141517',
    '--text-secondary': '#5A5B60',
    '--text-muted': '#8E8F94',
    '--border-primary': '#D8D8DB',
    '--border-secondary': '#EBEBED',
    '--color-primary': '#FF4F18',
    '--color-primary-hover': '#E64515',
    '--color-primary-light': 'rgba(255,79,24,0.12)',
    '--color-primary-subtle': 'rgba(255,79,24,0.06)',
    '--shadow-sm': '0 1px 2px rgba(0,0,0,0.06)',
    '--shadow-md': '0 4px 6px rgba(0,0,0,0.08)',
    '--shadow-lg': '0 10px 15px rgba(0,0,0,0.12)',
    '--overlay-color': 'rgba(0,0,0,0.4)',
  },
  light: {
    '--bg-primary': '#FFFFFF',
    '--bg-secondary': '#F5F5F5',
    '--bg-tertiary': '#EBEBEB',
    '--text-primary': '#111111',
    '--text-secondary': '#555555',
    '--text-muted': '#888888',
    '--border-primary': '#D0D0D0',
    '--border-secondary': '#E8E8E8',
    '--color-primary': '#2563EB',
    '--color-primary-hover': '#1D4ED8',
    '--color-primary-light': 'rgba(37,99,235,0.12)',
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
}

export const THEME_META: Record<ThemeId, ThemeMeta> = {
  craftbot:       { label: 'CraftBot',       swatches: ['#141517', '#1E1F22', '#F4F4F5', '#FF4F18'] },
  'craftbot-light': { label: 'CraftBot Light', swatches: ['#F7F7F8', '#FFFFFF', '#141517', '#FF4F18'] },
  light:          { label: 'Light',          swatches: ['#FFFFFF', '#F5F5F5', '#111111', '#2563EB'] },
  dark:           { label: 'Dark',           swatches: ['#0A0A0A', '#181818', '#FFFFFF', '#3B82F6'] },
  ocean:          { label: 'Ocean',          swatches: ['#0F172A', '#1E293B', '#F8FAFC', '#38BDF8'] },
  forest:         { label: 'Forest',         swatches: ['#0F1A14', '#1B2A21', '#F3F6F4', '#22C55E'] },
  pastel:         { label: 'Pastel',         swatches: ['#FAF7FF', '#FFFFFF', '#40384D', '#C084FC'] },
}

export const THEME_ORDER: ThemeId[] = [
  'craftbot',
  'craftbot-light',
  'light',
  'dark',
  'ocean',
  'forest',
  'pastel',
]

export const DEFAULT_THEME_ID: ThemeId = 'craftbot'

const STORAGE_KEY = 'living-ui-theme'

export function loadStoredTheme(): ThemeId {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored && stored in THEMES) return stored as ThemeId
  } catch {}
  return DEFAULT_THEME_ID
}

export function saveTheme(id: ThemeId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {}
}

export function applyThemeToDocument(id: ThemeId): void {
  const vars = THEMES[id]
  const styleId = 'theme-widget-vars'
  let el = document.getElementById(styleId) as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = styleId
    document.head.appendChild(el)
  }
  const declarations = (Object.keys(vars) as (keyof ThemeVars)[])
    .map((k) => `${k}:${vars[k]}`)
    .join(';')
  el.textContent = `:root{${declarations}}`
}
