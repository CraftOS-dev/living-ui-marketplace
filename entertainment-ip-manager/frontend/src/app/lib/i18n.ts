/**
 * English and Japanese.
 *
 *   t('Save')                      UI text, keyed by the English string
 *   t('{n} days left', { n: 3 })   placeholders in braces
 *   t('Open|deadline status')      a context after "|" when one English word needs
 *                                  different Japanese in different places; English
 *                                  shows only the part before "|"
 *   tn(n, '{n} day', '{n} days')   English plural; Japanese uses the second key
 *   bi({ en, ja })                 text the server generated in both languages
 *   tf(rec, 'title')               rec.title_ja in Japanese when present, else rec.title
 *   enumLabel('agreements.status', 'active')   a select value's label
 *
 * Every literal passed to t()/tn() must have an entry in locales/ja; the
 * check script (frontend/scripts/i18n-check.mjs) fails the build otherwise.
 * The language is per person (users.ui_language), defaulting to the
 * organization's (settings.default_language). Changing it remounts the app.
 */
import { JA } from '../locales/ja/index.ts';
import { ENUM_LABEL } from './enums.ts';
import type { Bi, Lang } from './shapes.ts';

let LANG: Lang = 'ja';

export function setLang(lang: Lang): void {
  LANG = lang;
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
}

export function getLang(): Lang {
  return LANG;
}

export function isJa(): boolean {
  return LANG === 'ja';
}

function fill(s: string, vars?: Record<string, string | number>): string {
  if (vars === undefined) return s;
  return s.replace(/\{(\w+)\}/g, (_m, k: string) => (vars[k] === undefined ? '' : String(vars[k])));
}

function english(key: string): string {
  const i = key.indexOf('|');
  return i < 0 ? key : key.slice(0, i);
}

export function t(key: string, vars?: Record<string, string | number>): string {
  if (LANG === 'ja') {
    const ja = JA[key];
    if (ja !== undefined) return fill(ja, vars);
  }
  return fill(english(key), vars);
}

/** English singular/plural; Japanese has one form (the plural key's entry). */
export function tn(n: number, one: string, other: string, vars?: Record<string, string | number>): string {
  const v = { n, ...(vars ?? {}) };
  if (LANG === 'ja') return t(other, v);
  return fill(english(n === 1 ? one : other), v);
}

/** Server text in both languages. Accepts a plain string too (shown as is). */
export function bi(v: Bi | string | null | undefined): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  return LANG === 'ja' ? v.ja || v.en : v.en || v.ja;
}

/** A record field with a Japanese twin (title / title_ja, label / label_ja, name / name_ja). */
export function tf(rec: object | null | undefined, field: string): string {
  if (rec === null || rec === undefined) return '';
  const r = rec as Record<string, unknown>;
  const en = typeof r[field] === 'string' ? (r[field] as string) : '';
  if (LANG === 'ja') {
    const ja = r[`${field}_ja`];
    if (typeof ja === 'string' && ja !== '') return ja;
  }
  return en;
}

/** The label of a select value, e.g. enumLabel('products.stage', 'on_sale'). */
export function enumLabel(key: string, value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const en = ENUM_LABEL[key]?.[value];
  return en === undefined ? value : t(en);
}

/** [value, label] pairs for a select field, in schema order (for <select> options). */
export function enumOptions(key: string): [string, string][] {
  const m = ENUM_LABEL[key] ?? {};
  return Object.keys(m).map((v) => [v, t(m[v] ?? v)]);
}

/** Join a list the way each language does. */
export function joinList(items: string[]): string {
  if (LANG === 'ja') return items.join('、');
  if (items.length <= 2) return items.join(' and ');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] ?? ''}`;
}
