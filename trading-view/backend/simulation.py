"""
Stock Data Engine

Fetches real stock data from Yahoo Finance for the Trading View Living UI.
Provides historical candle data, real-time price updates, and stock universe management.
"""

import logging
import random
from datetime import datetime, timedelta

import numpy as np

from sqlalchemy.orm import Session

from models import Stock, StockPrice, Candle, SimulationState, PriceAlert, MarketNews

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Stock Universe Seed Data
# ---------------------------------------------------------------------------

STOCK_UNIVERSE = {
    "AAPL": {"name": "Apple Inc.", "sector": "Technology", "exchange": "NASDAQ", "base_price": 175.0, "volatility": 0.02},
    "MSFT": {"name": "Microsoft Corporation", "sector": "Technology", "exchange": "NASDAQ", "base_price": 415.0, "volatility": 0.018},
    "GOOGL": {"name": "Alphabet Inc.", "sector": "Technology", "exchange": "NASDAQ", "base_price": 155.0, "volatility": 0.022},
    "AMZN": {"name": "Amazon.com Inc.", "sector": "Consumer Cyclical", "exchange": "NASDAQ", "base_price": 185.0, "volatility": 0.025},
    "NVDA": {"name": "NVIDIA Corporation", "sector": "Technology", "exchange": "NASDAQ", "base_price": 880.0, "volatility": 0.035},
    "META": {"name": "Meta Platforms Inc.", "sector": "Technology", "exchange": "NASDAQ", "base_price": 505.0, "volatility": 0.028},
    "TSLA": {"name": "Tesla Inc.", "sector": "Consumer Cyclical", "exchange": "NASDAQ", "base_price": 175.0, "volatility": 0.04},
    "BRK.B": {"name": "Berkshire Hathaway", "sector": "Financial", "exchange": "NYSE", "base_price": 410.0, "volatility": 0.012},
    "JPM": {"name": "JPMorgan Chase", "sector": "Financial", "exchange": "NYSE", "base_price": 195.0, "volatility": 0.018},
    "V": {"name": "Visa Inc.", "sector": "Financial", "exchange": "NYSE", "base_price": 280.0, "volatility": 0.015},
    "JNJ": {"name": "Johnson & Johnson", "sector": "Healthcare", "exchange": "NYSE", "base_price": 155.0, "volatility": 0.012},
    "UNH": {"name": "UnitedHealth Group", "sector": "Healthcare", "exchange": "NYSE", "base_price": 525.0, "volatility": 0.018},
    "WMT": {"name": "Walmart Inc.", "sector": "Consumer Defensive", "exchange": "NYSE", "base_price": 165.0, "volatility": 0.012},
    "PG": {"name": "Procter & Gamble", "sector": "Consumer Defensive", "exchange": "NYSE", "base_price": 160.0, "volatility": 0.01},
    "MA": {"name": "Mastercard Inc.", "sector": "Financial", "exchange": "NYSE", "base_price": 460.0, "volatility": 0.016},
    "HD": {"name": "Home Depot", "sector": "Consumer Cyclical", "exchange": "NYSE", "base_price": 370.0, "volatility": 0.018},
    "XOM": {"name": "Exxon Mobil", "sector": "Energy", "exchange": "NYSE", "base_price": 105.0, "volatility": 0.022},
    "CVX": {"name": "Chevron Corporation", "sector": "Energy", "exchange": "NYSE", "base_price": 155.0, "volatility": 0.02},
    "ABBV": {"name": "AbbVie Inc.", "sector": "Healthcare", "exchange": "NYSE", "base_price": 170.0, "volatility": 0.018},
    "KO": {"name": "Coca-Cola Company", "sector": "Consumer Defensive", "exchange": "NYSE", "base_price": 60.0, "volatility": 0.01},
    "PEP": {"name": "PepsiCo Inc.", "sector": "Consumer Defensive", "exchange": "NASDAQ", "base_price": 170.0, "volatility": 0.011},
    "AVGO": {"name": "Broadcom Inc.", "sector": "Technology", "exchange": "NASDAQ", "base_price": 1350.0, "volatility": 0.03},
    "COST": {"name": "Costco Wholesale", "sector": "Consumer Defensive", "exchange": "NASDAQ", "base_price": 730.0, "volatility": 0.015},
    "MRK": {"name": "Merck & Co.", "sector": "Healthcare", "exchange": "NYSE", "base_price": 125.0, "volatility": 0.016},
    "DIS": {"name": "Walt Disney", "sector": "Communication Services", "exchange": "NYSE", "base_price": 115.0, "volatility": 0.025},
    "NFLX": {"name": "Netflix Inc.", "sector": "Communication Services", "exchange": "NASDAQ", "base_price": 625.0, "volatility": 0.03},
    "AMD": {"name": "AMD Inc.", "sector": "Technology", "exchange": "NASDAQ", "base_price": 175.0, "volatility": 0.035},
    "SPY": {"name": "S&P 500 ETF", "sector": "Index", "exchange": "NYSE", "base_price": 510.0, "volatility": 0.012},
    "QQQ": {"name": "Nasdaq 100 ETF", "sector": "Index", "exchange": "NASDAQ", "base_price": 440.0, "volatility": 0.015},
    "DIA": {"name": "Dow Jones ETF", "sector": "Index", "exchange": "NYSE", "base_price": 390.0, "volatility": 0.011},
}



# ---------------------------------------------------------------------------
# seed_stocks
# ---------------------------------------------------------------------------

def seed_stocks(db: Session) -> list:
    """Populate the database with stocks from STOCK_UNIVERSE.

    Creates Stock rows, initial StockPrice snapshots, and a
    SimulationState record.  Returns a list of created stock dicts.
    """
    created = []
    now = datetime.utcnow()

    for symbol, info in STOCK_UNIVERSE.items():
        # Skip if already seeded
        existing = db.query(Stock).filter(Stock.symbol == symbol).first()
        if existing:
            created.append(existing.to_dict())
            continue

        stock = Stock(
            symbol=symbol,
            name=info["name"],
            sector=info["sector"],
            exchange=info["exchange"],
            created_at=now,
        )
        db.add(stock)
        db.flush()  # get stock.id

        price = info["base_price"]
        stock_price = StockPrice(
            stock_id=stock.id,
            price=price,
            open_price=price,
            high=price,
            low=price,
            prev_close=price,
            volume=0,
            change=0.0,
            change_pct=0.0,
            updated_at=now,
        )
        db.add(stock_price)
        created.append(stock.to_dict())

    # Ensure a SimulationState row exists
    sim = db.query(SimulationState).first()
    if not sim:
        sim = SimulationState(id=1, last_tick_time=now, is_running=True, tick_count=0)
        db.add(sim)

    db.commit()
    return created


# ---------------------------------------------------------------------------
# generate_historical_candles (Real data from Yahoo Finance)
# ---------------------------------------------------------------------------

def generate_historical_candles(
    db: Session,
    stock: Stock,
    base_price: float,
    volatility: float,
) -> None:
    """Fetch real historical OHLCV candles from Yahoo Finance.

    Fetches:
      - 1 year daily ("1D") candles
      - 30 days hourly ("1h") candles
      - 7 days 5-minute ("1m") candles
    """
    import yfinance as yf
    _fetch_real_candles(db, stock, yf)


def _fetch_real_candles(db: Session, stock: Stock, yf: any) -> None:
    """Fetch real candles from Yahoo Finance and store them."""
    ticker = yf.Ticker(stock.symbol)

    # Yahoo Finance interval/period mappings
    fetch_specs = [
        ("1D", "1y", "1d"),    # 1 year of daily candles
        ("1h", "30d", "1h"),   # 30 days of hourly candles
        ("1m", "7d", "5m"),    # 7 days of 5-min candles (stored as "1m" timeframe)
    ]

    for timeframe, period, interval in fetch_specs:
        try:
            hist = ticker.history(period=period, interval=interval)
            if hist.empty:
                logger.warning(f"[Simulation] No {interval} data for {stock.symbol}")
                continue

            candles_to_add = []
            for ts, row in hist.iterrows():
                # Convert timezone-aware timestamp to naive UTC
                if hasattr(ts, 'tz_localize'):
                    naive_ts = ts.tz_localize(None) if ts.tzinfo is None else ts.tz_convert('UTC').tz_localize(None)
                else:
                    naive_ts = ts

                candle = Candle(
                    stock_id=stock.id,
                    timeframe=timeframe,
                    timestamp=naive_ts.to_pydatetime() if hasattr(naive_ts, 'to_pydatetime') else naive_ts,
                    open_price=round(float(row['Open']), 2),
                    high=round(float(row['High']), 2),
                    low=round(float(row['Low']), 2),
                    close_price=round(float(row['Close']), 2),
                    volume=int(row['Volume']),
                )
                candles_to_add.append(candle)

            if candles_to_add:
                db.bulk_save_objects(candles_to_add)
                logger.info(f"[Simulation] Fetched {len(candles_to_add)} {timeframe} candles for {stock.symbol}")

        except Exception as e:
            logger.warning(f"[Simulation] Failed to fetch {interval} data for {stock.symbol}: {e}")
            db.rollback()

    # Commit any successfully fetched candles
    try:
        db.commit()
    except Exception:
        db.rollback()

    # Update StockPrice with the latest real close price
    try:
        daily = ticker.history(period="1d", interval="1d")
        if not daily.empty:
            last_row = daily.iloc[-1]
            price_record = db.query(StockPrice).filter(StockPrice.stock_id == stock.id).first()
            if price_record:
                price_record.price = round(float(last_row['Close']), 2)
                price_record.open_price = round(float(last_row['Open']), 2)
                price_record.high = round(float(last_row['High']), 2)
                price_record.low = round(float(last_row['Low']), 2)
                price_record.volume = int(last_row['Volume'])
                if len(daily) > 1:
                    prev_close = float(daily.iloc[-2]['Close'])
                else:
                    prev_close = float(last_row['Open'])
                price_record.prev_close = round(prev_close, 2)
                price_record.change = round(price_record.price - prev_close, 2)
                price_record.change_pct = round((price_record.change / prev_close) * 100, 2) if prev_close != 0 else 0.0
                price_record.updated_at = datetime.utcnow()
    except Exception as e:
        logger.warning(f"[Simulation] Failed to update price for {stock.symbol}: {e}")

    db.commit()




# ---------------------------------------------------------------------------
# tick_simulation
# ---------------------------------------------------------------------------

def tick_simulation(db: Session) -> dict:
    """Fetch real-time prices from Yahoo Finance for all stocks.

    Throttles to avoid excessive API calls — only fetches if at least
    30 seconds have elapsed since the last fetch.
    Also checks and triggers price alerts.

    Returns ``{symbol: {price, change, changePct}}`` for every stock.
    """
    import yfinance as yf

    now = datetime.utcnow()

    sim = db.query(SimulationState).first()
    if not sim:
        sim = SimulationState(id=1, last_tick_time=now, is_running=True, tick_count=0)
        db.add(sim)
        db.flush()

    last_tick = sim.last_tick_time or (now - timedelta(minutes=5))
    elapsed = (now - last_tick).total_seconds()

    # Throttle: only fetch from Yahoo every 30 seconds minimum
    result: dict[str, dict] = {}
    stocks = db.query(Stock).all()

    if elapsed >= 30:
        try:
            # Batch fetch all symbols at once for efficiency
            symbols = [s.symbol for s in stocks]
            tickers = yf.Tickers(" ".join(symbols))

            for stock in stocks:
                try:
                    ticker = tickers.tickers.get(stock.symbol.replace(".", "-"))
                    if not ticker:
                        continue
                    info = ticker.fast_info
                    current_price = round(float(info.last_price), 2)
                    prev_close = round(float(info.previous_close), 2) if hasattr(info, 'previous_close') and info.previous_close else current_price
                    day_open = round(float(info.open), 2) if hasattr(info, 'open') and info.open else current_price
                    day_high = round(float(info.day_high), 2) if hasattr(info, 'day_high') and info.day_high else current_price
                    day_low = round(float(info.day_low), 2) if hasattr(info, 'day_low') and info.day_low else current_price

                    change = round(current_price - prev_close, 2)
                    change_pct = round((change / prev_close) * 100, 2) if prev_close != 0 else 0.0

                    sp = db.query(StockPrice).filter(StockPrice.stock_id == stock.id).first()
                    if sp:
                        sp.price = current_price
                        sp.open_price = day_open
                        sp.high = day_high
                        sp.low = day_low
                        sp.prev_close = prev_close
                        sp.change = change
                        sp.change_pct = change_pct
                        sp.updated_at = now

                    result[stock.symbol] = {
                        "price": current_price,
                        "change": change,
                        "changePct": change_pct,
                    }
                except Exception as e:
                    logger.debug(f"[tick] Failed to get price for {stock.symbol}: {e}")

        except Exception as e:
            logger.warning(f"[tick] Batch price fetch failed: {e}")

        # Update simulation state
        sim.last_tick_time = now
        sim.tick_count = (sim.tick_count or 0) + 1
    else:
        # Return cached prices from database
        for stock in stocks:
            sp = db.query(StockPrice).filter(StockPrice.stock_id == stock.id).first()
            if sp:
                result[stock.symbol] = {
                    "price": sp.price,
                    "change": sp.change,
                    "changePct": sp.change_pct,
                }

    # ---- check alerts ----
    active_alerts = db.query(PriceAlert).filter(
        PriceAlert.active == True,
        PriceAlert.triggered == False,
    ).all()

    for alert in active_alerts:
        stock = db.query(Stock).filter(Stock.id == alert.stock_id).first()
        if not stock or stock.symbol not in result:
            continue
        current_price = result[stock.symbol]["price"]
        triggered = False
        if alert.condition == "above" and current_price >= alert.target_price:
            triggered = True
        elif alert.condition == "below" and current_price <= alert.target_price:
            triggered = True
        if triggered:
            alert.triggered = True
            alert.triggered_at = now

    db.commit()
    return result


# ---------------------------------------------------------------------------
# aggregate_candles
# ---------------------------------------------------------------------------

def aggregate_candles(
    db: Session,
    stock_id: int,
    timeframe: str,
    limit: int = 500,
    since: datetime = None,
    before: datetime = None,
) -> list:
    """Fetch (or aggregate) candles for a stock at the requested timeframe.

    Native timeframes (1m, 1h, 1D) are read directly.
    Derived timeframes (5m, 15m, 4h, 1W, 1M) are aggregated from
    their base resolution on the fly.

    Args:
        before: If set, only return candles BEFORE this timestamp (for loading older data).
    """

    # Map derived timeframes to (base_tf, bucket_seconds_or_rule)
    DERIVED_MAP = {
        "5m":  ("1m", 5 * 60),
        "15m": ("1m", 15 * 60),
        "4h":  ("1h", 4 * 3600),
        "1W":  ("1D", 7 * 86400),
        "1M":  ("1D", 30 * 86400),  # approximate month
    }

    if timeframe in ("1m", "1h", "1D"):
        # Direct fetch
        query = db.query(Candle).filter(
            Candle.stock_id == stock_id,
            Candle.timeframe == timeframe,
        )
        if since:
            query = query.filter(Candle.timestamp >= since)
        if before:
            query = query.filter(Candle.timestamp < before)

        # Take the last `limit` candles by sorting desc then reversing
        candles = query.order_by(Candle.timestamp.desc()).limit(limit).all()
        candles.reverse()

        return [c.to_dict() for c in candles]

    # Derived timeframe: aggregate from base
    if timeframe not in DERIVED_MAP:
        return []

    base_tf, bucket_secs = DERIVED_MAP[timeframe]

    query = db.query(Candle).filter(
        Candle.stock_id == stock_id,
        Candle.timeframe == base_tf,
    )
    if since:
        query = query.filter(Candle.timestamp >= since)
    base_candles = query.order_by(Candle.timestamp.asc()).all()

    if not base_candles:
        return []

    # Group into time buckets
    epoch = datetime(2000, 1, 1)
    buckets: dict[int, list] = {}
    for c in base_candles:
        ts_seconds = int((c.timestamp - epoch).total_seconds())
        bucket_key = (ts_seconds // bucket_secs) * bucket_secs
        buckets.setdefault(bucket_key, []).append(c)

    aggregated = []
    for bucket_key in sorted(buckets.keys()):
        group = buckets[bucket_key]
        bucket_ts = epoch + timedelta(seconds=bucket_key)
        aggregated.append({
            "stockId": stock_id,
            "timeframe": timeframe,
            "timestamp": bucket_ts.isoformat(),
            "openPrice": group[0].open_price,
            "high": max(c.high for c in group),
            "low": min(c.low for c in group),
            "closePrice": group[-1].close_price,
            "volume": sum(c.volume for c in group),
        })

    # Apply limit (take last N)
    if limit and len(aggregated) > limit:
        aggregated = aggregated[-limit:]

    return aggregated


# ---------------------------------------------------------------------------
# compute_indicator
# ---------------------------------------------------------------------------

def compute_indicator(
    candles: list,
    indicator_type: str,
    period: int = 14,
) -> list:
    """Compute a technical indicator from candle dicts.

    Each candle dict is expected to have at least ``closePrice`` (or
    ``close``) and ``timestamp``.  Optionally ``high``, ``low``,
    ``volume`` for indicators that need them.

    Supported indicators: SMA, EMA, RSI, MACD, BB, VWAP.
    """
    if not candles:
        return []

    def _close(c):
        return c.get("closePrice") or c.get("close", 0)

    def _high(c):
        return c.get("high", _close(c))

    def _low(c):
        return c.get("low", _close(c))

    def _volume(c):
        return c.get("volume", 0)

    def _ts(c):
        return c.get("timestamp", "")

    closes = np.array([_close(c) for c in candles], dtype=float)

    # --- SMA ---
    if indicator_type == "SMA":
        result = []
        for i in range(len(closes)):
            if i < period - 1:
                continue
            val = float(np.mean(closes[i - period + 1 : i + 1]))
            result.append({"timestamp": _ts(candles[i]), "value": round(val, 4)})
        return result

    # --- EMA ---
    if indicator_type == "EMA":
        multiplier = 2.0 / (period + 1)
        ema_values = np.empty(len(closes))
        ema_values[0] = closes[0]
        for i in range(1, len(closes)):
            ema_values[i] = (closes[i] - ema_values[i - 1]) * multiplier + ema_values[i - 1]
        result = []
        for i in range(period - 1, len(closes)):
            result.append({"timestamp": _ts(candles[i]), "value": round(float(ema_values[i]), 4)})
        return result

    # --- RSI ---
    if indicator_type == "RSI":
        deltas = np.diff(closes)
        gains = np.where(deltas > 0, deltas, 0.0)
        losses = np.where(deltas < 0, -deltas, 0.0)

        result = []
        if len(gains) < period:
            return result

        avg_gain = float(np.mean(gains[:period]))
        avg_loss = float(np.mean(losses[:period]))

        for i in range(period, len(closes)):
            if i > period:
                avg_gain = (avg_gain * (period - 1) + gains[i - 1]) / period
                avg_loss = (avg_loss * (period - 1) + losses[i - 1]) / period
            if avg_loss == 0:
                rsi = 100.0
            else:
                rs = avg_gain / avg_loss
                rsi = 100.0 - 100.0 / (1.0 + rs)
            result.append({"timestamp": _ts(candles[i]), "value": round(rsi, 4)})
        return result

    # --- MACD ---
    if indicator_type == "MACD":
        fast_period = 12
        slow_period = 26
        signal_period = 9

        def _ema_array(data, p):
            m = 2.0 / (p + 1)
            out = np.empty_like(data)
            out[0] = data[0]
            for i in range(1, len(data)):
                out[i] = (data[i] - out[i - 1]) * m + out[i - 1]
            return out

        if len(closes) < slow_period + signal_period:
            return []

        ema_fast = _ema_array(closes, fast_period)
        ema_slow = _ema_array(closes, slow_period)
        macd_line = ema_fast - ema_slow
        signal_line = _ema_array(macd_line[slow_period - 1:], signal_period)

        result = []
        start = slow_period - 1 + signal_period - 1
        for i in range(start, len(closes)):
            mi = i - (slow_period - 1)
            si = mi - (signal_period - 1)
            macd_val = float(macd_line[i])
            signal_val = float(signal_line[si]) if si >= 0 and si < len(signal_line) else 0.0
            hist = macd_val - signal_val
            result.append({
                "timestamp": _ts(candles[i]),
                "macd": round(macd_val, 4),
                "signal": round(signal_val, 4),
                "histogram": round(hist, 4),
            })
        return result

    # --- BB (Bollinger Bands) ---
    if indicator_type == "BB":
        result = []
        for i in range(period - 1, len(closes)):
            window = closes[i - period + 1 : i + 1]
            middle = float(np.mean(window))
            std = float(np.std(window, ddof=0))
            upper = middle + 2.0 * std
            lower = middle - 2.0 * std
            result.append({
                "timestamp": _ts(candles[i]),
                "upper": round(upper, 4),
                "middle": round(middle, 4),
                "lower": round(lower, 4),
            })
        return result

    # --- VWAP ---
    if indicator_type == "VWAP":
        typical_prices = np.array([
            (_high(c) + _low(c) + _close(c)) / 3.0 for c in candles
        ], dtype=float)
        volumes = np.array([_volume(c) for c in candles], dtype=float)

        cum_tp_vol = np.cumsum(typical_prices * volumes)
        cum_vol = np.cumsum(volumes)

        result = []
        for i in range(len(candles)):
            if cum_vol[i] == 0:
                continue
            vwap = float(cum_tp_vol[i] / cum_vol[i])
            result.append({"timestamp": _ts(candles[i]), "value": round(vwap, 4)})
        return result

    return []


# ---------------------------------------------------------------------------
# generate_news
# ---------------------------------------------------------------------------

# Templates for news generation
_GENERAL_HEADLINES = [
    "Fed Signals Potential Rate Pause Amid Mixed Economic Data",
    "US Treasury Yields Rise on Strong Jobs Report",
    "Global Markets Rally on Trade Deal Optimism",
    "Inflation Data Comes in Below Expectations",
    "Wall Street Closes Higher in Broad-Based Rally",
    "Oil Prices Surge After OPEC Announces Production Cuts",
    "Consumer Confidence Index Hits Six-Month High",
    "Retail Sales Exceed Forecasts in Latest Report",
    "Housing Starts Decline for Third Consecutive Month",
    "Tech Sector Leads Market Gains as AI Momentum Continues",
]

_STOCK_HEADLINE_TEMPLATES = [
    "{symbol} Reports Record Q4 Revenue, Beating Estimates",
    "{symbol} Announces $10B Stock Buyback Program",
    "{symbol} Shares Surge on Strong Earnings Guidance",
    "{symbol} Expands Partnership with Major Cloud Provider",
    "{symbol} Faces Regulatory Scrutiny Over Market Practices",
    "{symbol} Upgrades Full-Year Outlook After Solid Quarter",
    "{symbol} Names New CEO Amid Strategic Pivot",
    "{symbol} Launches New Product Line to Boost Growth",
    "{symbol} Beats EPS Estimates by 15%, Revenue Misses",
    "{symbol} Analysts Raise Price Target After Investor Day",
]

_SOURCES = [
    "Reuters", "Bloomberg", "CNBC", "MarketWatch", "The Wall Street Journal",
    "Barron's", "Financial Times", "Yahoo Finance", "Seeking Alpha", "Investor's Business Daily",
]

_SUMMARIES_GENERAL = [
    "Markets reacted positively to the latest economic indicators, with major indices posting gains across the board.",
    "Investors are weighing the implications of the latest Federal Reserve commentary on monetary policy direction.",
    "Trading volumes surged as market participants repositioned ahead of key economic data releases.",
    "Analysts note that current market conditions favor a cautious but optimistic outlook for the near term.",
]

_SUMMARIES_STOCK = [
    "The company's latest quarterly results exceeded Wall Street expectations, driven by strong demand in its core business segments.",
    "Shares moved sharply after the company provided updated guidance that surprised many analysts on the Street.",
    "Institutional investors have been increasing their positions in the stock according to recent filings.",
    "The announcement comes as the company seeks to diversify its revenue streams and expand into new markets.",
]


def generate_news(db: Session) -> None:
    """Generate ~20 simulated market news items.

    Creates a mix of general market headlines and stock-specific news
    with realistic timestamps spread over the last 24 hours.
    """
    now = datetime.utcnow()
    news_items = []

    # General market news (~10)
    for headline in random.sample(_GENERAL_HEADLINES, min(10, len(_GENERAL_HEADLINES))):
        published = now - timedelta(
            hours=random.uniform(0, 24),
            minutes=random.randint(0, 59),
        )
        news_items.append(MarketNews(
            stock_symbol=None,
            headline=headline,
            summary=random.choice(_SUMMARIES_GENERAL),
            source=random.choice(_SOURCES),
            url=None,
            published_at=published,
        ))

    # Stock-specific news (~10)
    selected_symbols = random.sample(list(STOCK_UNIVERSE.keys()), min(10, len(STOCK_UNIVERSE)))
    for symbol in selected_symbols:
        template = random.choice(_STOCK_HEADLINE_TEMPLATES)
        headline = template.format(symbol=symbol)
        published = now - timedelta(
            hours=random.uniform(0, 24),
            minutes=random.randint(0, 59),
        )
        news_items.append(MarketNews(
            stock_symbol=symbol,
            headline=headline,
            summary=random.choice(_SUMMARIES_STOCK),
            source=random.choice(_SOURCES),
            url=None,
            published_at=published,
        ))

    db.bulk_save_objects(news_items)
    db.commit()
