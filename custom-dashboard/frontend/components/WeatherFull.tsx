import { useState, useEffect, useRef } from 'react'
import type { AppController } from '../AppController'
import type { WeatherData } from '../types'
import { Card, Input, Button, Alert } from './ui'
import { Cloud, MapPin, Thermometer } from 'lucide-react'
import { getWeatherIcon, getWeatherDesc } from './WeatherWidget'
import { toast } from 'react-toastify'

interface WeatherFullProps {
  controller: AppController
}

function ForecastCard({ date, code, high, low }: { date: string; code: number; high: number; low: number }) {
  const d = new Date(date + 'T12:00:00')
  const label = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
  return (
    <Card padding="sm" style={{ textAlign: 'center', flex: '1 1 100px' }}>
      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginBottom: 'var(--space-1)' }}>{label}</div>
      <div style={{ fontSize: 28, marginBottom: 'var(--space-1)' }}>{getWeatherIcon(code)}</div>
      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>{getWeatherDesc(code)}</div>
      <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)' as any, marginTop: 'var(--space-1)' }}>
        <span style={{ color: 'var(--color-error)' }}>{Math.round(high)}°</span>
        {' / '}
        <span style={{ color: 'var(--color-info)' }}>{Math.round(low)}°</span>
      </div>
    </Card>
  )
}

export function WeatherFull({ controller }: WeatherFullProps) {
  const [weather, setWeather] = useState<WeatherData | null>(null)
  const [loading, setLoading] = useState(true)
  const [city, setCity] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    controller.getWeather().then(w => {
      setWeather(w)
      if (w.cityName) setCity(w.cityName)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [controller])

  const saveCity = async () => {
    if (!city.trim()) return
    setSaving(true)
    setError(null)
    try {
      const w = await controller.setWeatherCity(city.trim())
      setWeather(w)
      toast.success(`Weather updated for ${w.cityName}`)
    } catch (e: any) {
      const msg = e.message?.includes('404') ? `City "${city}" not found` : 'Failed to fetch weather'
      setError(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', paddingTop: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-6)' }}>
        <Cloud size={20} style={{ color: 'var(--color-primary)' }} />
        <h2 style={{ fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-semibold)' as any }}>Weather</h2>
      </div>

      {/* City setting */}
      <Card padding="md" style={{ marginBottom: 'var(--space-4)' }}>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <Input
              ref={inputRef}
              label="City"
              placeholder="e.g. London, New York, Tokyo"
              value={city}
              onChange={e => setCity(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveCity()}
            />
          </div>
          <Button variant="primary" size="md" loading={saving} onClick={saveCity}>
            Update
          </Button>
        </div>
        {error && <div style={{ marginTop: 'var(--space-2)' }}><Alert variant="error">{error}</Alert></div>}
      </Card>

      {loading ? (
        <div style={{ color: 'var(--text-muted)', textAlign: 'center' }}>Loading…</div>
      ) : !weather?.cityName ? (
        <div style={{ textAlign: 'center', color: 'var(--text-secondary)', paddingTop: 'var(--space-8)' }}>
          <Thermometer size={48} style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-4)' }} />
          <p>Enter a city above to see weather</p>
        </div>
      ) : (
        <>
          {/* Current conditions */}
          <Card padding="lg" style={{ marginBottom: 'var(--space-4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
              <MapPin size={14} style={{ color: 'var(--text-muted)' }} />
              <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>{weather.cityName}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-6)' }}>
              <span style={{ fontSize: 64 }}>{getWeatherIcon(weather.weatherCode)}</span>
              <div>
                <div style={{
                  fontSize: 'clamp(40px, 8vw, 64px)',
                  fontWeight: 'var(--font-weight-bold)' as any,
                  color: 'var(--text-primary)',
                  lineHeight: 1,
                }}>
                  {weather.currentTemp !== null ? `${Math.round(weather.currentTemp)}°C` : '—'}
                </div>
                <div style={{ fontSize: 'var(--font-size-base)', color: 'var(--text-secondary)', marginTop: 'var(--space-1)' }}>
                  {getWeatherDesc(weather.weatherCode)}
                </div>
                {weather.apparentTemp !== null && (
                  <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>
                    Feels like {Math.round(weather.apparentTemp)}°C
                  </div>
                )}
                {weather.tempHigh !== null && (
                  <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>
                    H: {Math.round(weather.tempHigh)}° · L: {Math.round(weather.tempLow ?? 0)}°
                  </div>
                )}
              </div>
            </div>
          </Card>

          {/* Forecast */}
          {weather.forecast.length > 0 && (
            <>
              <h3 style={{ fontSize: 'var(--font-size-base)', fontWeight: 'var(--font-weight-semibold)' as any, marginBottom: 'var(--space-3)' }}>
                3-Day Forecast
              </h3>
              <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                {weather.forecast.map(f => (
                  <ForecastCard key={f.date} date={f.date} code={f.code} high={f.high} low={f.low} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
