export type Category = 'length' | 'weight' | 'temperature' | 'volume'

export interface UnitMeta {
  label: string
  /** Multiplier to the category's base unit. Unused for temperature (special-cased). */
  toBase: number
}

export const CATEGORY_LABELS: Record<Category, string> = {
  length: 'Length',
  weight: 'Weight',
  temperature: 'Temperature',
  volume: 'Volume',
}

// Base unit: meters
export const LENGTH_UNITS: Record<string, UnitMeta> = {
  mm: { label: 'Millimeters (mm)', toBase: 0.001 },
  cm: { label: 'Centimeters (cm)', toBase: 0.01 },
  m: { label: 'Meters (m)', toBase: 1 },
  km: { label: 'Kilometers (km)', toBase: 1000 },
  in: { label: 'Inches (in)', toBase: 0.0254 },
  ft: { label: 'Feet (ft)', toBase: 0.3048 },
  yd: { label: 'Yards (yd)', toBase: 0.9144 },
  mi: { label: 'Miles (mi)', toBase: 1609.344 },
}

// Base unit: grams
export const WEIGHT_UNITS: Record<string, UnitMeta> = {
  mg: { label: 'Milligrams (mg)', toBase: 0.001 },
  g: { label: 'Grams (g)', toBase: 1 },
  kg: { label: 'Kilograms (kg)', toBase: 1000 },
  oz: { label: 'Ounces (oz)', toBase: 28.349523125 },
  lb: { label: 'Pounds (lb)', toBase: 453.59237 },
}

// Base unit: liters
export const VOLUME_UNITS: Record<string, UnitMeta> = {
  mL: { label: 'Milliliters (mL)', toBase: 0.001 },
  L: { label: 'Liters (L)', toBase: 1 },
  gal: { label: 'Gallons, US (gal)', toBase: 3.785411784 },
  qt: { label: 'Quarts, US (qt)', toBase: 0.946352946 },
  cup: { label: 'Cups, US (cup)', toBase: 0.2365882365 },
  floz: { label: 'Fluid ounces, US (fl oz)', toBase: 0.0295735295625 },
}

export const TEMPERATURE_UNITS: Record<string, UnitMeta> = {
  C: { label: 'Celsius (°C)', toBase: 1 },
  F: { label: 'Fahrenheit (°F)', toBase: 1 },
  K: { label: 'Kelvin (K)', toBase: 1 },
}

export const UNITS_BY_CATEGORY: Record<Category, Record<string, UnitMeta>> = {
  length: LENGTH_UNITS,
  weight: WEIGHT_UNITS,
  volume: VOLUME_UNITS,
  temperature: TEMPERATURE_UNITS,
}

function celsiusToUnit(celsius: number, unit: string): number {
  if (unit === 'C') return celsius
  if (unit === 'F') return celsius * (9 / 5) + 32
  if (unit === 'K') return celsius + 273.15
  throw new Error(`Unknown temperature unit "${unit}"`)
}

function unitToCelsius(value: number, unit: string): number {
  if (unit === 'C') return value
  if (unit === 'F') return (value - 32) * (5 / 9)
  if (unit === 'K') return value - 273.15
  throw new Error(`Unknown temperature unit "${unit}"`)
}

export function convert(category: Category, fromUnit: string, toUnit: string, value: number): number {
  if (category === 'temperature') {
    return celsiusToUnit(unitToCelsius(value, fromUnit), toUnit)
  }
  const units = UNITS_BY_CATEGORY[category]
  const from = units[fromUnit]
  const to = units[toUnit]
  if (!from || !to) throw new Error(`Unknown unit for category "${category}"`)
  return (value * from.toBase) / to.toBase
}

export function defaultUnitsFor(category: Category): { from: string; to: string } {
  const keys = Object.keys(UNITS_BY_CATEGORY[category])
  return { from: keys[0], to: keys[1] ?? keys[0] }
}
