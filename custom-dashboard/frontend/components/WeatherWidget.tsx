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

function dayAbbr(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString([], { weekday: 'short' })
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
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
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

  const forecastDays = weather.forecast.slice(0, 2)
  const todayName = new Date().toLocaleDateString([], { weekday: 'long' })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', marginBottom: 'var(--space-2)' }}>
        <MapPin size={12} style={{ color: 'var(--text-muted)' }} />
        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>{weather.cityName}</span>
      </div>

      {/* Today label */}
      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', fontWeight: 'var(--font-weight-medium)' as any, marginBottom: 4 }}>
        Today · {todayName}
      </div>

      {/* Current conditions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
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
            {weather.tempHigh !== null ? ` · H:${Math.round(weather.tempHigh)}° L:${Math.round(weather.tempLow ?? 0)}°` : ''}
          </div>
        </div>
      </div>

      {/* 2-day forecast */}
      {forecastDays.length > 0 && (
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
          {forecastDays.map(day => (
            <div key={day.date} style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2,
              padding: 'var(--space-2)',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--bg-tertiary)',
            }}>
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', fontWeight: 'var(--font-weight-medium)' as any }}>
                {dayAbbr(day.date)}
              </span>
              <span style={{ fontSize: 20 }}>{getWeatherIcon(day.code)}</span>
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
                {Math.round(day.high)}° / {Math.round(day.low)}°
              </span>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={() => navigate('weather')}
        style={{
          marginTop: 'auto',
          fontSize: 'var(--font-size-xs)',
          color: 'var(--color-primary)',
          background: 'none', border: 'none', cursor: 'pointer',
          textAlign: 'left', padding: 0,
        }}
      >
        View details →
      </button>
    </div>
  )
}
