import { useState, useEffect } from 'react'
import type { AppController } from '../AppController'
import type { WidgetConfig, DashboardView, WeatherData } from '../types'
import { Thermometer, MapPin } from 'lucide-react'

interface WeatherWidgetProps {
  controller: AppController
  config: WidgetConfig
  navigate: (view: DashboardView) => void
}

export function getWeatherIcon(code: number | null): string {
  if (code === null) return '🌡️'
  if (code === 0) return '☀️'
  if (code <= 3) return '⛅'
  if (code <= 48) return '🌫️'
  if (code <= 55) return '🌦️'
  if (code <= 67) return '🌧️'
  if (code <= 77) return '❄️'
  if (code <= 82) return '🌦️'
  return '⛈️'
}

export function getWeatherDesc(code: number | null): string {
  if (code === null) return 'Unknown'
  if (code === 0) return 'Clear sky'
  if (code <= 3) return code === 1 ? 'Mainly clear' : code === 2 ? 'Partly cloudy' : 'Overcast'
  if (code <= 48) return 'Foggy'
  if (code <= 55) return 'Drizzle'
  if (code <= 67) return 'Rainy'
  if (code <= 77) return 'Snowy'
  if (code <= 82) return 'Showers'
  return 'Thunderstorm'
}

export function WeatherWidget({ controller, navigate }: WeatherWidgetProps) {
  const [weather, setWeather] = useState<WeatherData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    controller.getWeather().then(setWeather).catch(() => {}).finally(() => setLoading(false))
  }, [controller])

  if (loading) return <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>Loading…</div>

  if (!weather?.cityName) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 'var(--space-2)' }}>
        <Thermometer size={32} style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }} />
        <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--space-3)' }}>
          Set your city to see weather
        </div>
        <button
          onClick={() => navigate('weather')}
          style={{
            fontSize: 'var(--font-size-xs)',
            padding: '4px 12px',
            backgroundColor: 'var(--color-primary)',
            color: 'white',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            cursor: 'pointer',
          }}
        >
          Set city
        </button>
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', marginBottom: 'var(--space-2)' }}>
        <MapPin size={12} style={{ color: 'var(--text-muted)' }} />
        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>{weather.cityName}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <span style={{ fontSize: 40 }}>{getWeatherIcon(weather.weatherCode)}</span>
        <div>
          <div style={{
            fontSize: 'clamp(24px, 4vw, 32px)',
            fontWeight: 'var(--font-weight-bold)' as any,
            color: 'var(--text-primary)',
            lineHeight: 1,
          }}>
            {weather.currentTemp !== null ? `${Math.round(weather.currentTemp)}°C` : '—'}
          </div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginTop: 2 }}>
            {getWeatherDesc(weather.weatherCode)}
          </div>
        </div>
      </div>
      {weather.tempHigh !== null && (
        <div style={{ marginTop: 'var(--space-2)', fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
          H: {Math.round(weather.tempHigh)}° · L: {Math.round(weather.tempLow ?? 0)}°
        </div>
      )}
    </div>
  )
}
