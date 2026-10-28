/// <reference path="../pb_data/types.d.ts" />
/**
 * Technical indicators. The same code runs in the server (alerts, screener,
 * the AI agent's chart readings) and in the chart: frontend/src/app/lib/ta.js
 * is this file with `export` in place of `module.exports`, so a value the
 * agent quotes is the value the person sees. Keep the two identical.
 *
 * Bars are {t, o, h, l, c, v} oldest first. Every output is an array as long
 * as the bars, null where the indicator has not warmed up yet. An output
 * with `offset` is drawn that many bars later (Ichimoku cloud) or earlier.
 */

const SOURCES = ['close', 'open', 'high', 'low', 'hl2', 'hlc3', 'ohlc4'];

/** The indicator catalogue: parameters, outputs and how each is drawn. */
const CATALOGUE = [
  { id: 'sma', name: 'Moving Average', short: 'MA', group: 'Trend', overlay: true, params: [p('length', 'Length', 20, 1, 500), src()], outputs: [o('ma', 'MA', 'line')] },
  { id: 'ema', name: 'Exponential Moving Average', short: 'EMA', group: 'Trend', overlay: true, params: [p('length', 'Length', 20, 1, 500), src()], outputs: [o('ema', 'EMA', 'line')] },
  { id: 'wma', name: 'Weighted Moving Average', short: 'WMA', group: 'Trend', overlay: true, params: [p('length', 'Length', 20, 1, 500), src()], outputs: [o('wma', 'WMA', 'line')] },
  { id: 'hma', name: 'Hull Moving Average', short: 'HMA', group: 'Trend', overlay: true, params: [p('length', 'Length', 21, 2, 500), src()], outputs: [o('hma', 'HMA', 'line')] },
  { id: 'vwma', name: 'Volume Weighted Moving Average', short: 'VWMA', group: 'Trend', overlay: true, params: [p('length', 'Length', 20, 1, 500)], outputs: [o('vwma', 'VWMA', 'line')] },
  {
    id: 'vwap',
    name: 'VWAP',
    short: 'VWAP',
    group: 'Volume',
    overlay: true,
    params: [{ key: 'anchor', label: 'Anchor', default: 'session', options: ['session', 'week', 'month'] }],
    outputs: [o('vwap', 'VWAP', 'line')],
  },
  {
    id: 'bb',
    name: 'Bollinger Bands',
    short: 'BB',
    group: 'Volatility',
    overlay: true,
    params: [p('length', 'Length', 20, 2, 500), p('mult', 'StdDev', 2, 0.1, 10, 0.1), src()],
    outputs: [o('basis', 'Basis', 'line'), o('upper', 'Upper', 'line'), o('lower', 'Lower', 'line')],
    fill: ['upper', 'lower'],
  },
  {
    id: 'kc',
    name: 'Keltner Channels',
    short: 'KC',
    group: 'Volatility',
    overlay: true,
    params: [p('length', 'Length', 20, 2, 500), p('mult', 'Multiplier', 2, 0.1, 10, 0.1), p('atr', 'ATR length', 10, 1, 500)],
    outputs: [o('basis', 'Basis', 'line'), o('upper', 'Upper', 'line'), o('lower', 'Lower', 'line')],
    fill: ['upper', 'lower'],
  },
  {
    id: 'donchian',
    name: 'Donchian Channels',
    short: 'DC',
    group: 'Volatility',
    overlay: true,
    params: [p('length', 'Length', 20, 2, 500)],
    outputs: [o('basis', 'Basis', 'line'), o('upper', 'Upper', 'line'), o('lower', 'Lower', 'line')],
    fill: ['upper', 'lower'],
  },
  {
    id: 'envelope',
    name: 'Envelope',
    short: 'ENV',
    group: 'Trend',
    overlay: true,
    params: [p('length', 'Length', 20, 1, 500), p('percent', 'Percent', 2.5, 0.1, 50, 0.1)],
    outputs: [o('basis', 'Basis', 'line'), o('upper', 'Upper', 'line'), o('lower', 'Lower', 'line')],
  },
  {
    id: 'ichimoku',
    name: 'Ichimoku Cloud',
    short: 'Ichimoku',
    group: 'Trend',
    overlay: true,
    params: [p('conversion', 'Conversion', 9, 1, 200), p('base', 'Base', 26, 1, 200), p('span', 'Leading span B', 52, 1, 400), p('displacement', 'Displacement', 26, 1, 200)],
    outputs: [o('conversion', 'Conversion', 'line'), o('base', 'Base', 'line'), o('span_a', 'Leading A', 'line'), o('span_b', 'Leading B', 'line'), o('lagging', 'Lagging', 'line')],
    fill: ['span_a', 'span_b'],
  },
  {
    id: 'psar',
    name: 'Parabolic SAR',
    short: 'SAR',
    group: 'Trend',
    overlay: true,
    params: [p('start', 'Start', 0.02, 0.001, 1, 0.001), p('inc', 'Increment', 0.02, 0.001, 1, 0.001), p('max', 'Maximum', 0.2, 0.01, 1, 0.01)],
    outputs: [o('sar', 'SAR', 'dots')],
  },
  {
    id: 'supertrend',
    name: 'Supertrend',
    short: 'ST',
    group: 'Trend',
    overlay: true,
    params: [p('length', 'ATR length', 10, 1, 200), p('mult', 'Factor', 3, 0.1, 20, 0.1)],
    outputs: [o('up', 'Up trend', 'line'), o('down', 'Down trend', 'line'), o('direction', 'Direction', 'hidden')],
  },
  { id: 'volume', name: 'Volume', short: 'Vol', group: 'Volume', overlay: true, params: [p('ma', 'MA length', 20, 1, 500)], outputs: [o('volume', 'Volume', 'histogram'), o('ma', 'Volume MA', 'line')] },
  { id: 'rsi', name: 'Relative Strength Index', short: 'RSI', group: 'Momentum', overlay: false, params: [p('length', 'Length', 14, 1, 500), src()], outputs: [o('rsi', 'RSI', 'line')], bands: [70, 30], range: [0, 100] },
  {
    id: 'macd',
    name: 'MACD',
    short: 'MACD',
    group: 'Momentum',
    overlay: false,
    params: [p('fast', 'Fast', 12, 1, 500), p('slow', 'Slow', 26, 1, 500), p('signal', 'Signal', 9, 1, 500), src()],
    outputs: [o('hist', 'Histogram', 'histogram'), o('macd', 'MACD', 'line'), o('signal', 'Signal', 'line')],
    bands: [0],
  },
  {
    id: 'stoch',
    name: 'Stochastic',
    short: 'Stoch',
    group: 'Momentum',
    overlay: false,
    params: [p('k', '%K length', 14, 1, 500), p('smooth', '%K smoothing', 3, 1, 50), p('d', '%D smoothing', 3, 1, 50)],
    outputs: [o('k', '%K', 'line'), o('d', '%D', 'line')],
    bands: [80, 20],
    range: [0, 100],
  },
  {
    id: 'stochrsi',
    name: 'Stochastic RSI',
    short: 'StochRSI',
    group: 'Momentum',
    overlay: false,
    params: [p('rsi', 'RSI length', 14, 1, 500), p('length', 'Stochastic length', 14, 1, 500), p('k', '%K', 3, 1, 50), p('d', '%D', 3, 1, 50)],
    outputs: [o('k', '%K', 'line'), o('d', '%D', 'line')],
    bands: [80, 20],
    range: [0, 100],
  },
  { id: 'cci', name: 'Commodity Channel Index', short: 'CCI', group: 'Momentum', overlay: false, params: [p('length', 'Length', 20, 1, 500)], outputs: [o('cci', 'CCI', 'line')], bands: [100, -100] },
  { id: 'willr', name: 'Williams %R', short: '%R', group: 'Momentum', overlay: false, params: [p('length', 'Length', 14, 1, 500)], outputs: [o('r', '%R', 'line')], bands: [-20, -80], range: [-100, 0] },
  { id: 'roc', name: 'Rate of Change', short: 'ROC', group: 'Momentum', overlay: false, params: [p('length', 'Length', 9, 1, 500), src()], outputs: [o('roc', 'ROC', 'line')], bands: [0] },
  { id: 'mom', name: 'Momentum', short: 'Mom', group: 'Momentum', overlay: false, params: [p('length', 'Length', 10, 1, 500), src()], outputs: [o('mom', 'Momentum', 'line')], bands: [0] },
  {
    id: 'adx',
    name: 'Average Directional Index',
    short: 'ADX',
    group: 'Trend',
    overlay: false,
    params: [p('length', 'DI length', 14, 1, 200), p('smooth', 'ADX smoothing', 14, 1, 200)],
    outputs: [o('adx', 'ADX', 'line'), o('plus', '+DI', 'line'), o('minus', '-DI', 'line')],
    bands: [25],
  },
  {
    id: 'aroon',
    name: 'Aroon',
    short: 'Aroon',
    group: 'Trend',
    overlay: false,
    params: [p('length', 'Length', 14, 1, 500)],
    outputs: [o('up', 'Aroon up', 'line'), o('down', 'Aroon down', 'line')],
    range: [0, 100],
  },
  { id: 'atr', name: 'Average True Range', short: 'ATR', group: 'Volatility', overlay: false, params: [p('length', 'Length', 14, 1, 500)], outputs: [o('atr', 'ATR', 'line')] },
  { id: 'bbw', name: 'Bollinger Bandwidth', short: 'BBW', group: 'Volatility', overlay: false, params: [p('length', 'Length', 20, 2, 500), p('mult', 'StdDev', 2, 0.1, 10, 0.1)], outputs: [o('bbw', 'Bandwidth %', 'line')] },
  { id: 'hv', name: 'Historical Volatility', short: 'HV', group: 'Volatility', overlay: false, params: [p('length', 'Length', 20, 2, 500)], outputs: [o('hv', 'HV % (annual)', 'line')] },
  { id: 'obv', name: 'On Balance Volume', short: 'OBV', group: 'Volume', overlay: false, params: [], outputs: [o('obv', 'OBV', 'line')] },
  { id: 'mfi', name: 'Money Flow Index', short: 'MFI', group: 'Volume', overlay: false, params: [p('length', 'Length', 14, 1, 500)], outputs: [o('mfi', 'MFI', 'line')], bands: [80, 20], range: [0, 100] },
  { id: 'cmf', name: 'Chaikin Money Flow', short: 'CMF', group: 'Volume', overlay: false, params: [p('length', 'Length', 20, 1, 500)], outputs: [o('cmf', 'CMF', 'line')], bands: [0] },
  { id: 'rvol', name: 'Relative Volume', short: 'RVOL', group: 'Volume', overlay: false, params: [p('length', 'Length', 20, 1, 500)], outputs: [o('rvol', 'RVOL', 'histogram')], bands: [1] },
];

function p(key, label, dflt, min, max, step) {
  return { key: key, label: label, default: dflt, min: min, max: max, step: step || 1 };
}

function src() {
  return { key: 'source', label: 'Source', default: 'close', options: SOURCES };
}

function o(key, label, kind) {
  return { key: key, label: label, kind: kind };
}

function find(id) {
  for (const d of CATALOGUE) if (d.id === id) return d;
  return null;
}

/**
 * Parameters with defaults filled in and values clamped to their range.
 * Unknown keys are dropped. Throws on an unknown indicator id.
 */
function params(id, given) {
  const def = find(id);
  if (!def) throw new Error('Unknown indicator "' + id + '"; one of: ' + CATALOGUE.map((d) => d.id).join(', '));
  const out = {};
  const g = given || {};
  for (const q of def.params) {
    let v = g[q.key];
    if (q.options) {
      out[q.key] = q.options.indexOf(v) >= 0 ? v : q.default;
      continue;
    }
    v = typeof v === 'string' ? Number(v) : v;
    if (typeof v !== 'number' || !isFinite(v)) v = q.default;
    v = Math.max(q.min, Math.min(q.max, v));
    if ((q.step || 1) >= 1) v = Math.round(v);
    out[q.key] = v;
  }
  return out;
}

/** "RSI 14", "BB 20 2" */
function label(id, prm) {
  const def = find(id);
  if (!def) return id;
  const vals = def.params.filter((q) => !q.options || prm[q.key] !== q.default).map((q) => String(prm[q.key]));
  return def.short + (vals.length > 0 ? ' ' + vals.join(' ') : '');
}

/* ------------------------------------------------------------- primitives */

function fill(n) {
  const a = new Array(n);
  for (let i = 0; i < n; i++) a[i] = null;
  return a;
}

function source(bars, s) {
  const n = bars.length;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    out[i] =
      s === 'open' ? b.o : s === 'high' ? b.h : s === 'low' ? b.l : s === 'hl2' ? (b.h + b.l) / 2 : s === 'hlc3' ? (b.h + b.l + b.c) / 3 : s === 'ohlc4' ? (b.o + b.h + b.l + b.c) / 4 : b.c;
  }
  return out;
}

function sma(x, len) {
  const n = x.length;
  const out = fill(n);
  let sum = 0;
  let count = 0;
  let start = 0;
  for (let i = 0; i < n; i++) {
    const v = x[i];
    if (v === null) {
      sum = 0;
      count = 0;
      start = i + 1;
      continue;
    }
    sum += v;
    count++;
    if (count > len) sum -= x[i - len];
    if (i - start + 1 >= len) out[i] = sum / len;
  }
  return out;
}

/** EMA seeded with the SMA of the first `len` values (TradingView style). */
function emaK(x, len, k) {
  const n = x.length;
  const out = fill(n);
  let prev = null;
  let seed = 0;
  let seen = 0;
  for (let i = 0; i < n; i++) {
    const v = x[i];
    if (v === null) continue;
    if (prev === null) {
      seed += v;
      seen++;
      if (seen === len) {
        prev = seed / len;
        out[i] = prev;
      }
      continue;
    }
    prev = v * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function ema(x, len) {
  return emaK(x, len, 2 / (len + 1));
}

/** Wilder's smoothing (RMA), used by RSI, ATR and ADX. */
function rma(x, len) {
  return emaK(x, len, 1 / len);
}

function wma(x, len) {
  const n = x.length;
  const out = fill(n);
  const denom = (len * (len + 1)) / 2;
  for (let i = len - 1; i < n; i++) {
    let s = 0;
    let ok = true;
    for (let j = 0; j < len; j++) {
      const v = x[i - j];
      if (v === null) {
        ok = false;
        break;
      }
      s += v * (len - j);
    }
    if (ok) out[i] = s / denom;
  }
  return out;
}

function stdev(x, len) {
  const n = x.length;
  const out = fill(n);
  const mean = sma(x, len);
  for (let i = 0; i < n; i++) {
    if (mean[i] === null) continue;
    let s = 0;
    for (let j = 0; j < len; j++) {
      const d = x[i - j] - mean[i];
      s += d * d;
    }
    out[i] = Math.sqrt(s / len);
  }
  return out;
}

function highest(x, len) {
  const n = x.length;
  const out = fill(n);
  for (let i = len - 1; i < n; i++) {
    let m = -Infinity;
    for (let j = 0; j < len; j++) if (x[i - j] > m) m = x[i - j];
    out[i] = m;
  }
  return out;
}

function lowest(x, len) {
  const n = x.length;
  const out = fill(n);
  for (let i = len - 1; i < n; i++) {
    let m = Infinity;
    for (let j = 0; j < len; j++) if (x[i - j] < m) m = x[i - j];
    out[i] = m;
  }
  return out;
}

function trueRange(bars) {
  const n = bars.length;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    if (i === 0) out[i] = b.h - b.l;
    else {
      const pc = bars[i - 1].c;
      out[i] = Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc));
    }
  }
  return out;
}

function zip(a, b, f) {
  const n = a.length;
  const out = fill(n);
  for (let i = 0; i < n; i++) if (a[i] !== null && b[i] !== null) out[i] = f(a[i], b[i]);
  return out;
}

function rsiOf(x, len) {
  const n = x.length;
  const up = fill(n);
  const dn = fill(n);
  for (let i = 1; i < n; i++) {
    if (x[i] === null || x[i - 1] === null) continue;
    const d = x[i] - x[i - 1];
    up[i] = Math.max(d, 0);
    dn[i] = Math.max(-d, 0);
  }
  const au = rma(up, len);
  const ad = rma(dn, len);
  return zip(au, ad, (u, d) => (d === 0 ? (u === 0 ? 50 : 100) : 100 - 100 / (1 + u / d)));
}

function stochOf(x, hi, lo, len) {
  const n = x.length;
  const out = fill(n);
  for (let i = len - 1; i < n; i++) {
    let h = -Infinity;
    let l = Infinity;
    let ok = true;
    for (let j = 0; j < len; j++) {
      if (hi[i - j] === null || lo[i - j] === null) {
        ok = false;
        break;
      }
      if (hi[i - j] > h) h = hi[i - j];
      if (lo[i - j] < l) l = lo[i - j];
    }
    if (!ok || x[i] === null) continue;
    out[i] = h === l ? 50 : ((x[i] - l) / (h - l)) * 100;
  }
  return out;
}

/** Exchange-local day, week or month number of a bar, for anchored VWAP. */
function period(t, anchor, offset) {
  const local = t + (offset || 0);
  const day = Math.floor(local / 86400);
  if (anchor === 'week') return Math.floor((day + 3) / 7);
  if (anchor === 'month') {
    const d = new Date(local * 1000);
    return d.getUTCFullYear() * 12 + d.getUTCMonth();
  }
  return day;
}

/* -------------------------------------------------------------- indicators */

/**
 * Compute one indicator. `opts.offset` is the exchange's UTC offset in
 * seconds (session VWAP). Returns { id, params, label, outputs: {key: []} }.
 */
function compute(id, bars, given, opts) {
  const prm = params(id, given);
  const n = bars.length;
  const c = bars.map((b) => b.c);
  const h = bars.map((b) => b.h);
  const l = bars.map((b) => b.l);
  const v = bars.map((b) => b.v || 0);
  const s = prm.source ? source(bars, prm.source) : c;
  let out = {};
  switch (id) {
    case 'sma':
      out = { ma: sma(s, prm.length) };
      break;
    case 'ema':
      out = { ema: ema(s, prm.length) };
      break;
    case 'wma':
      out = { wma: wma(s, prm.length) };
      break;
    case 'hma': {
      const half = wma(s, Math.max(1, Math.floor(prm.length / 2)));
      const full = wma(s, prm.length);
      const diff = zip(half, full, (a, b) => 2 * a - b);
      out = { hma: wma(diff, Math.max(1, Math.round(Math.sqrt(prm.length)))) };
      break;
    }
    case 'vwma': {
      const pv = sma(
        c.map((x, i) => x * v[i]),
        prm.length,
      );
      const vv = sma(v, prm.length);
      out = { vwma: zip(pv, vv, (a, b) => (b === 0 ? null : a / b)) };
      break;
    }
    case 'vwap': {
      const r = fill(n);
      let key = null;
      let pv = 0;
      let vol = 0;
      for (let i = 0; i < n; i++) {
        const k = period(bars[i].t, prm.anchor, opts && opts.offset);
        if (k !== key) {
          key = k;
          pv = 0;
          vol = 0;
        }
        const tp = (h[i] + l[i] + c[i]) / 3;
        pv += tp * v[i];
        vol += v[i];
        r[i] = vol > 0 ? pv / vol : tp;
      }
      out = { vwap: r };
      break;
    }
    case 'bb': {
      const basis = sma(s, prm.length);
      const dev = stdev(s, prm.length);
      out = { basis: basis, upper: zip(basis, dev, (a, d) => a + prm.mult * d), lower: zip(basis, dev, (a, d) => a - prm.mult * d) };
      break;
    }
    case 'kc': {
      const basis = ema(c, prm.length);
      const atr = rma(trueRange(bars), prm.atr);
      out = { basis: basis, upper: zip(basis, atr, (a, d) => a + prm.mult * d), lower: zip(basis, atr, (a, d) => a - prm.mult * d) };
      break;
    }
    case 'donchian': {
      const up = highest(h, prm.length);
      const dn = lowest(l, prm.length);
      out = { basis: zip(up, dn, (a, b) => (a + b) / 2), upper: up, lower: dn };
      break;
    }
    case 'envelope': {
      const basis = sma(c, prm.length);
      out = { basis: basis, upper: basis.map((x) => (x === null ? null : x * (1 + prm.percent / 100))), lower: basis.map((x) => (x === null ? null : x * (1 - prm.percent / 100))) };
      break;
    }
    case 'ichimoku': {
      const mid = (len) => zip(highest(h, len), lowest(l, len), (a, b) => (a + b) / 2);
      const conv = mid(prm.conversion);
      const base = mid(prm.base);
      out = { conversion: conv, base: base, span_a: zip(conv, base, (a, b) => (a + b) / 2), span_b: mid(prm.span), lagging: c.slice() };
      break;
    }
    case 'psar': {
      const r = fill(n);
      if (n > 1) {
        let up = c[1] >= c[0];
        let af = prm.start;
        let ep = up ? h[0] : l[0];
        let sar = up ? l[0] : h[0];
        for (let i = 1; i < n; i++) {
          sar = sar + af * (ep - sar);
          if (up) {
            sar = Math.min(sar, l[i - 1], i > 1 ? l[i - 2] : l[i - 1]);
            if (l[i] < sar) {
              up = false;
              sar = ep;
              ep = l[i];
              af = prm.start;
            } else if (h[i] > ep) {
              ep = h[i];
              af = Math.min(prm.max, af + prm.inc);
            }
          } else {
            sar = Math.max(sar, h[i - 1], i > 1 ? h[i - 2] : h[i - 1]);
            if (h[i] > sar) {
              up = true;
              sar = ep;
              ep = h[i];
              af = prm.start;
            } else if (l[i] < ep) {
              ep = l[i];
              af = Math.min(prm.max, af + prm.inc);
            }
          }
          r[i] = sar;
        }
      }
      out = { sar: r };
      break;
    }
    case 'supertrend': {
      const atr = rma(trueRange(bars), prm.length);
      const up = fill(n);
      const down = fill(n);
      const dir = fill(n);
      let fu = null;
      let fl = null;
      let d = 1;
      for (let i = 0; i < n; i++) {
        if (atr[i] === null) continue;
        const mid = (h[i] + l[i]) / 2;
        const bu = mid + prm.mult * atr[i];
        const bl = mid - prm.mult * atr[i];
        const pc = i > 0 ? c[i - 1] : c[i];
        const nu = fu === null || bu < fu || pc > fu ? bu : fu;
        const nl = fl === null || bl > fl || pc < fl ? bl : fl;
        if (fu !== null) {
          if (d === 1 && c[i] < nl) d = -1;
          else if (d === -1 && c[i] > nu) d = 1;
        }
        fu = nu;
        fl = nl;
        dir[i] = d;
        if (d === 1) up[i] = fl;
        else down[i] = fu;
      }
      out = { up: up, down: down, direction: dir };
      break;
    }
    case 'volume':
      out = { volume: v.slice(), ma: sma(v, prm.ma) };
      break;
    case 'rsi':
      out = { rsi: rsiOf(s, prm.length) };
      break;
    case 'macd': {
      const m = zip(ema(s, prm.fast), ema(s, prm.slow), (a, b) => a - b);
      const sig = ema(m, prm.signal);
      out = { hist: zip(m, sig, (a, b) => a - b), macd: m, signal: sig };
      break;
    }
    case 'stoch': {
      const k = sma(stochOf(c, h, l, prm.k), prm.smooth);
      out = { k: k, d: sma(k, prm.d) };
      break;
    }
    case 'stochrsi': {
      const r = rsiOf(c, prm.rsi);
      const k = sma(stochOf(r, r, r, prm.length), prm.k);
      out = { k: k, d: sma(k, prm.d) };
      break;
    }
    case 'cci': {
      const tp = bars.map((b) => (b.h + b.l + b.c) / 3);
      const m = sma(tp, prm.length);
      const r = fill(n);
      for (let i = 0; i < n; i++) {
        if (m[i] === null) continue;
        let dev = 0;
        for (let j = 0; j < prm.length; j++) dev += Math.abs(tp[i - j] - m[i]);
        dev /= prm.length;
        r[i] = dev === 0 ? 0 : (tp[i] - m[i]) / (0.015 * dev);
      }
      out = { cci: r };
      break;
    }
    case 'willr': {
      const st = stochOf(c, h, l, prm.length);
      out = { r: st.map((x) => (x === null ? null : x - 100)) };
      break;
    }
    case 'roc': {
      const r = fill(n);
      for (let i = prm.length; i < n; i++) if (s[i - prm.length]) r[i] = ((s[i] - s[i - prm.length]) / s[i - prm.length]) * 100;
      out = { roc: r };
      break;
    }
    case 'mom': {
      const r = fill(n);
      for (let i = prm.length; i < n; i++) r[i] = s[i] - s[i - prm.length];
      out = { mom: r };
      break;
    }
    case 'adx': {
      const pdm = fill(n);
      const mdm = fill(n);
      for (let i = 1; i < n; i++) {
        const upMove = h[i] - h[i - 1];
        const downMove = l[i - 1] - l[i];
        pdm[i] = upMove > downMove && upMove > 0 ? upMove : 0;
        mdm[i] = downMove > upMove && downMove > 0 ? downMove : 0;
      }
      const tr = trueRange(bars);
      tr[0] = null;
      const atr = rma(tr, prm.length);
      const plus = zip(rma(pdm, prm.length), atr, (a, b) => (b === 0 ? 0 : (100 * a) / b));
      const minus = zip(rma(mdm, prm.length), atr, (a, b) => (b === 0 ? 0 : (100 * a) / b));
      const dx = zip(plus, minus, (a, b) => (a + b === 0 ? 0 : (100 * Math.abs(a - b)) / (a + b)));
      out = { adx: rma(dx, prm.smooth), plus: plus, minus: minus };
      break;
    }
    case 'aroon': {
      const up = fill(n);
      const dn = fill(n);
      const len = prm.length;
      for (let i = len; i < n; i++) {
        let hi = i;
        let lo = i;
        for (let j = i - len; j <= i; j++) {
          if (h[j] >= h[hi]) hi = j;
          if (l[j] <= l[lo]) lo = j;
        }
        up[i] = (100 * (len - (i - hi))) / len;
        dn[i] = (100 * (len - (i - lo))) / len;
      }
      out = { up: up, down: dn };
      break;
    }
    case 'atr':
      out = { atr: rma(trueRange(bars), prm.length) };
      break;
    case 'bbw': {
      const basis = sma(c, prm.length);
      const dev = stdev(c, prm.length);
      out = { bbw: zip(basis, dev, (a, d) => (a === 0 ? null : ((2 * prm.mult * d) / a) * 100)) };
      break;
    }
    case 'hv': {
      const ret = fill(n);
      for (let i = 1; i < n; i++) if (c[i - 1] > 0 && c[i] > 0) ret[i] = Math.log(c[i] / c[i - 1]);
      const sd = stdev(ret, prm.length);
      const per = (opts && opts.periodsPerYear) || 252;
      out = { hv: sd.map((x) => (x === null ? null : x * Math.sqrt(per) * 100)) };
      break;
    }
    case 'obv': {
      const r = fill(n);
      let acc = 0;
      for (let i = 0; i < n; i++) {
        if (i > 0) acc += c[i] > c[i - 1] ? v[i] : c[i] < c[i - 1] ? -v[i] : 0;
        r[i] = acc;
      }
      out = { obv: r };
      break;
    }
    case 'mfi': {
      const tp = bars.map((b) => (b.h + b.l + b.c) / 3);
      const r = fill(n);
      for (let i = prm.length; i < n; i++) {
        let pos = 0;
        let neg = 0;
        for (let j = i - prm.length + 1; j <= i; j++) {
          const flow = tp[j] * v[j];
          if (tp[j] > tp[j - 1]) pos += flow;
          else if (tp[j] < tp[j - 1]) neg += flow;
        }
        r[i] = neg === 0 ? 100 : 100 - 100 / (1 + pos / neg);
      }
      out = { mfi: r };
      break;
    }
    case 'cmf': {
      const mfv = bars.map((b) => (b.h === b.l ? 0 : ((b.c - b.l - (b.h - b.c)) / (b.h - b.l)) * (b.v || 0)));
      const a = sma(mfv, prm.length);
      const b = sma(v, prm.length);
      out = { cmf: zip(a, b, (x, y) => (y === 0 ? 0 : x / y)) };
      break;
    }
    case 'rvol': {
      const avg = sma(v, prm.length);
      const r = fill(n);
      for (let i = 1; i < n; i++) if (avg[i - 1]) r[i] = v[i] / avg[i - 1];
      out = { rvol: r };
      break;
    }
    default:
      throw new Error('Unknown indicator "' + id + '"');
  }
  const offsets = id === 'ichimoku' ? { span_a: prm.displacement - 1, span_b: prm.displacement - 1, lagging: -(prm.displacement - 1) } : {};
  return { id: id, params: prm, label: label(id, prm), outputs: out, offsets: offsets };
}

/* ---------------------------------------------------------- price structure */

/**
 * Swing highs and lows: a bar whose high (low) is the highest (lowest) of
 * `span` bars on each side.
 */
function swings(bars, span) {
  const k = span || 5;
  const out = [];
  for (let i = k; i < bars.length - k; i++) {
    let hi = true;
    let lo = true;
    for (let j = 1; j <= k; j++) {
      if (bars[i - j].h > bars[i].h || bars[i + j].h > bars[i].h) hi = false;
      if (bars[i - j].l < bars[i].l || bars[i + j].l < bars[i].l) lo = false;
    }
    if (hi) out.push({ i: i, t: bars[i].t, price: bars[i].h, kind: 'high' });
    if (lo) out.push({ i: i, t: bars[i].t, price: bars[i].l, kind: 'low' });
  }
  return out;
}

/**
 * Support and resistance: swing points clustered within `tol` (a fraction of
 * price, default half an ATR), ranked by touches and recency. Levels below
 * the last close are support, above it resistance.
 */
function levels(bars, maxLevels) {
  const n = bars.length;
  if (n < 20) return [];
  const last = bars[n - 1].c;
  const atr = rma(trueRange(bars), 14)[n - 1] || last * 0.01;
  const tol = atr * 0.5;
  const pts = swings(bars, n > 300 ? 5 : 3);
  const clusters = [];
  for (const s of pts) {
    let hit = null;
    for (const c of clusters) {
      if (Math.abs(c.price - s.price) <= tol) {
        hit = c;
        break;
      }
    }
    if (hit) {
      hit.price = (hit.price * hit.touches + s.price) / (hit.touches + 1);
      hit.touches++;
      hit.last = Math.max(hit.last, s.t);
      hit.lastIndex = Math.max(hit.lastIndex, s.i);
    } else clusters.push({ price: s.price, touches: 1, last: s.t, lastIndex: s.i, first: s.t });
  }
  for (const c of clusters) c.score = c.touches * 2 + (c.lastIndex / n) * 3 - Math.abs(c.price - last) / (atr * 10);
  clusters.sort((a, b) => b.score - a.score);
  const pick = clusters.slice(0, maxLevels || 8);
  return pick
    .map((c) => ({
      price: c.price,
      kind: c.price < last ? 'support' : 'resistance',
      touches: c.touches,
      last_touch: c.last,
      distance_pct: ((c.price - last) / last) * 100,
    }))
    .sort((a, b) => b.price - a.price);
}

/** Last non-null value of a series. */
function lastOf(x) {
  for (let i = x.length - 1; i >= 0; i--) if (x[i] !== null && x[i] !== undefined) return x[i];
  return null;
}

module.exports = {
  CATALOGUE: CATALOGUE,
  SOURCES: SOURCES,
  find: find,
  params: params,
  label: label,
  compute: compute,
  sma: sma,
  ema: ema,
  rma: rma,
  stdev: stdev,
  trueRange: trueRange,
  rsiOf: rsiOf,
  swings: swings,
  levels: levels,
  lastOf: lastOf,
};
