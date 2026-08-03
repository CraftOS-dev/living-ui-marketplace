import { useMemo, useState } from 'react'
import { type Category, type UnitMeta, UNITS_BY_CATEGORY, convert, defaultUnitsFor } from '../lib/unitConversion'

export interface UseUnitConverterResult {
  category: Category
  setCategory: (category: Category) => void
  fromUnit: string
  setFromUnit: (unit: string) => void
  toUnit: string
  setToUnit: (unit: string) => void
  fromValue: string
  setFromValue: (value: string) => void
  units: Record<string, UnitMeta>
  result: number | null
  swap: () => void
}

export function formatConvertedValue(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (Number.isInteger(n)) return String(n)
  return String(Number(n.toPrecision(10)))
}

/**
 * Shared category/unit/value conversion state, used by both the compact and
 * full Unit Converter views so their logic never diverges.
 */
export function useUnitConverter(initialCategory: Category = 'length'): UseUnitConverterResult {
  const [category, setCategoryState] = useState<Category>(initialCategory)
  const [fromUnit, setFromUnit] = useState(() => defaultUnitsFor(initialCategory).from)
  const [toUnit, setToUnit] = useState(() => defaultUnitsFor(initialCategory).to)
  const [fromValue, setFromValue] = useState('1')

  const units = UNITS_BY_CATEGORY[category]

  const result = useMemo(() => {
    const n = parseFloat(fromValue)
    if (Number.isNaN(n)) return null
    try {
      return convert(category, fromUnit, toUnit, n)
    } catch {
      return null
    }
  }, [category, fromUnit, toUnit, fromValue])

  function setCategory(next: Category) {
    setCategoryState(next)
    const defaults = defaultUnitsFor(next)
    setFromUnit(defaults.from)
    setToUnit(defaults.to)
  }

  function swap() {
    setFromUnit(toUnit)
    setToUnit(fromUnit)
    if (result !== null) setFromValue(formatConvertedValue(result))
  }

  return { category, setCategory, fromUnit, setFromUnit, toUnit, setToUnit, fromValue, setFromValue, units, result, swap }
}
