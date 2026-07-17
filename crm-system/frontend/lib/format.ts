/** Formatting helpers: currency, dates, relative time, initials. */

import type * as React from 'react'

export function formatCurrency(value: number | null | undefined, currency = 'USD'): string {
  const amount = value ?? 0
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: amount >= 1000 ? 0 : 2,
    }).format(amount)
  } catch {
    return `$${amount.toLocaleString()}`
  }
}

export function formatCompactCurrency(value: number | null | undefined, currency = 'USD'): string {
  const amount = value ?? 0
  if (Math.abs(amount) >= 1_000_000) return `${symbol(currency)}${(amount / 1_000_000).toFixed(1)}M`
  if (Math.abs(amount) >= 1_000) return `${symbol(currency)}${(amount / 1_000).toFixed(0)}k`
  return formatCurrency(amount, currency)
}

function symbol(currency: string): string {
  const map: Record<string, string> = { USD: '$', EUR: '€', GBP: '£' }
  return map[currency] ?? '$'
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)
  if (Number.isNaN(date.getTime())) return iso
  const now = new Date()
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  })
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)
  if (Number.isNaN(date.getTime())) return iso
  const seconds = Math.round((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.round(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.round(months / 12)}y ago`
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function dueLabel(dueDate: string): { label: string; tone: 'overdue' | 'today' | 'future' } {
  if (!dueDate) return { label: 'No date', tone: 'future' }
  const today = todayIso()
  if (dueDate < today) return { label: formatDateShort(dueDate), tone: 'overdue' }
  if (dueDate === today) return { label: 'Today', tone: 'today' }
  return { label: formatDateShort(dueDate), tone: 'future' }
}

export function initials(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Soft pastel pill styling generated from a base hex color (U-13). */
export function pillStyle(hex: string): React.CSSProperties {
  const color = hex || '#8b8b94'
  return {
    backgroundColor: `${color}26`, // ~15% alpha
    color: mixWithForeground(color),
    border: `1px solid ${color}40`,
  }
}

/** Strong text of the same hue: keep the hue, push lightness toward readable. */
function mixWithForeground(hex: string): string {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light'
  const { r, g, b } = hexToRgb(hex)
  const factor = isLight ? 0.55 : 0.75
  const base = isLight ? 0 : 255
  const mix = (channel: number) => Math.round(channel * factor + base * (1 - factor) * 0.55)
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const cleaned = hex.replace('#', '')
  const full = cleaned.length === 3 ? cleaned.split('').map((c) => c + c).join('') : cleaned
  const num = parseInt(full || '8b8b94', 16)
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 }
}

export function faviconUrl(domain: string, size = 32): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${size}`
}

export function downloadTextFile(fileName: string, content: string, mime = 'text/csv') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}
