import React from 'react'
import type { CurrencyTotal } from '../services/reports'
import { formatOthers } from '../services/reports'

interface Props {
  others: CurrencyTotal[]
  currencyCode: string
  style?: React.CSSProperties
}

/** Names the amounts a screen's totals leave out because they are in another
 *  currency (the app has no exchange rates). Renders nothing when there are none. */
export const OtherCurrenciesNote: React.FC<Props> = ({ others, currencyCode, style }) => {
  if (others.length === 0) return null
  return (
    <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', ...style }}>
      Totals add {currencyCode} amounts only. Not converted or added: {formatOthers(others)}
    </div>
  )
}
