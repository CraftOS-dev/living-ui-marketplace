/**
 * Column model for the data table: system columns per object + custom
 * attributes appended. Column keys match backend row keys (camelCase system
 * fields) or attribute slugs.
 */

import type { Attribute, RecordRow, RecordType } from '@/types'

export type ColumnKind =
  | 'name' | 'text' | 'number' | 'currency' | 'date' | 'datetime' | 'select'
  | 'multiselect' | 'status' | 'checkbox' | 'url' | 'email' | 'phone'
  | 'rating' | 'company' | 'tags' | 'deal-status' | 'stage'

export interface ColumnDef {
  key: string
  label: string
  kind: ColumnKind
  editable: boolean
  width: number
  /** backend field name for system-field updates (snake_case) */
  updateField?: string
  /** custom attribute backing this column */
  attribute?: Attribute
  options?: { id: string; label: string; color: string }[]
}

const PERSON_COLUMNS: ColumnDef[] = [
  { key: 'name', label: 'Name', kind: 'name', editable: false, width: 220 },
  { key: 'jobTitle', label: 'Job title', kind: 'text', editable: true, width: 160, updateField: 'job_title' },
  { key: 'company', label: 'Company', kind: 'company', editable: true, width: 180, updateField: 'company_id' },
  { key: 'emails', label: 'Email', kind: 'email', editable: true, width: 200, updateField: 'emails' },
  { key: 'phones', label: 'Phone', kind: 'phone', editable: true, width: 140, updateField: 'phones' },
  { key: 'location', label: 'Location', kind: 'text', editable: true, width: 150, updateField: 'location' },
  { key: 'linkedin', label: 'LinkedIn', kind: 'url', editable: true, width: 160, updateField: 'linkedin' },
  { key: 'tags', label: 'Tags', kind: 'tags', editable: false, width: 160 },
  { key: 'lastInteractionAt', label: 'Last contacted', kind: 'datetime', editable: false, width: 130 },
  { key: 'createdAt', label: 'Created', kind: 'datetime', editable: false, width: 110 },
]

const COMPANY_COLUMNS: ColumnDef[] = [
  { key: 'name', label: 'Name', kind: 'name', editable: false, width: 220 },
  { key: 'domain', label: 'Domain', kind: 'url', editable: true, width: 160, updateField: 'domain' },
  { key: 'industry', label: 'Industry', kind: 'text', editable: true, width: 150, updateField: 'industry' },
  { key: 'size', label: 'Size', kind: 'text', editable: true, width: 100, updateField: 'size' },
  { key: 'location', label: 'Location', kind: 'text', editable: true, width: 150, updateField: 'location' },
  { key: 'annualRevenue', label: 'Annual revenue', kind: 'currency', editable: true, width: 140, updateField: 'annual_revenue' },
  { key: 'tags', label: 'Tags', kind: 'tags', editable: false, width: 160 },
  { key: 'lastInteractionAt', label: 'Last contacted', kind: 'datetime', editable: false, width: 130 },
  { key: 'createdAt', label: 'Created', kind: 'datetime', editable: false, width: 110 },
]

const DEAL_COLUMNS: ColumnDef[] = [
  { key: 'name', label: 'Name', kind: 'name', editable: false, width: 240 },
  { key: 'value', label: 'Value', kind: 'currency', editable: true, width: 120, updateField: 'value' },
  { key: 'status', label: 'Status', kind: 'deal-status', editable: true, width: 100, updateField: 'status' },
  { key: 'stage', label: 'Stage', kind: 'stage', editable: false, width: 130 },
  { key: 'company', label: 'Company', kind: 'company', editable: true, width: 180, updateField: 'company_id' },
  { key: 'owner', label: 'Owner', kind: 'text', editable: true, width: 130, updateField: 'owner' },
  { key: 'expectedCloseDate', label: 'Expected close', kind: 'date', editable: true, width: 130, updateField: 'expected_close_date' },
  { key: 'tags', label: 'Tags', kind: 'tags', editable: false, width: 160 },
  { key: 'createdAt', label: 'Created', kind: 'datetime', editable: false, width: 110 },
]

const SYSTEM_COLUMNS: Record<RecordType, ColumnDef[]> = {
  person: PERSON_COLUMNS,
  company: COMPANY_COLUMNS,
  deal: DEAL_COLUMNS,
}

const ATTRIBUTE_KIND: Record<string, ColumnKind> = {
  text: 'text', number: 'number', currency: 'currency', date: 'date',
  datetime: 'datetime', select: 'select', multiselect: 'multiselect',
  status: 'select', checkbox: 'checkbox', url: 'url', email: 'email',
  phone: 'phone', rating: 'rating', 'record-reference': 'text', 'ai-generated': 'text',
}

export function buildColumns(recordType: RecordType, attributes: Attribute[], includeStage: boolean): ColumnDef[] {
  const system = SYSTEM_COLUMNS[recordType].filter((column) => includeStage || column.kind !== 'stage')
  const custom: ColumnDef[] = attributes.map((attribute) => ({
    key: attribute.slug,
    label: attribute.name,
    kind: ATTRIBUTE_KIND[attribute.type] || 'text',
    editable: attribute.type !== 'ai-generated',
    width: attribute.type === 'checkbox' || attribute.type === 'rating' ? 110 : 150,
    attribute,
    options: attribute.options,
  }))
  return [...system, ...custom]
}

export function cellValue(row: RecordRow, column: ColumnDef): unknown {
  if (column.attribute) return row.attributes?.[column.key]
  return (row as unknown as Record<string, unknown>)[column.key]
}

/** Default visible columns when a view doesn't specify any. */
export function defaultVisibleColumns(recordType: RecordType): string[] {
  return SYSTEM_COLUMNS[recordType].slice(0, 7).map((column) => column.key)
}

/** Fields usable in the filter builder (system + custom). */
export function filterableColumns(columns: ColumnDef[]): ColumnDef[] {
  return columns.filter((column) => !['tags', 'name'].includes(column.kind))
}
