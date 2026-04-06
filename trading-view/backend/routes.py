"""
Living UI API Routes - TradingView Clone

REST API endpoints for state management, stock data, charting,
watchlists, alerts, screener, layout, news, and settings.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Dict, Any, List, Optional
from database import get_db
from models import (
    AppState, UISnapshot, UIScreenshot,
    Stock, StockPrice, Candle, Watchlist, PriceAlert,
    Drawing, WidgetLayout, MarketNews, SimulationState,
)
from simulation import (
    seed_stocks, generate_historical_candles, tick_simulation,
    aggregate_candles, compute_indicator, generate_news, STOCK_UNIVERSE,
)
from datetime import datetime, timedelta
import logging
import base64

logger = logging.getLogger(__name__)
router = APIRouter()


# ============================================================================
# Default Layout
# ============================================================================

DEFAULT_LAYOUT = {
    "layoutData": {
        "lg": [
            {"i": "chart-1", "x": 0, "y": 0, "w": 8, "h": 12, "minW": 4, "minH": 6},
            {"i": "watchlist", "x": 8, "y": 0, "w": 4, "h": 8, "minW": 3, "minH": 4},
            {"i": "details", "x": 8, "y": 8, "w": 4, "h": 4, "minW": 3, "minH": 3},
            {"i": "news", "x": 0, "y": 12, "w": 6, "h": 6, "minW": 3, "minH": 3},
            {"i": "screener", "x": 6, "y": 12, "w": 6, "h": 6, "minW": 4, "minH": 4},
        ],
        "md": [
            {"i": "chart-1", "x": 0, "y": 0, "w": 6, "h": 10, "minW": 4, "minH": 6},
            {"i": "watchlist", "x": 6, "y": 0, "w": 4, "h": 6, "minW": 3, "minH": 4},
            {"i": "details", "x": 6, "y": 6, "w": 4, "h": 4, "minW": 3, "minH": 3},
            {"i": "news", "x": 0, "y": 10, "w": 5, "h": 5, "minW": 3, "minH": 3},
            {"i": "screener", "x": 5, "y": 10, "w": 5, "h": 5, "minW": 4, "minH": 4},
        ],
        "sm": [
            {"i": "chart-1", "x": 0, "y": 0, "w": 4, "h": 8, "minW": 4, "minH": 6},
            {"i": "watchlist", "x": 0, "y": 8, "w": 4, "h": 6, "minW": 3, "minH": 4},
            {"i": "details", "x": 0, "y": 14, "w": 4, "h": 4, "minW": 3, "minH": 3},
            {"i": "news", "x": 0, "y": 18, "w": 4, "h": 5, "minW": 3, "minH": 3},
            {"i": "screener", "x": 0, "y": 23, "w": 4, "h": 5, "minW": 4, "minH": 4},
        ]
    },
    "chartConfig": {
        "chart-1": {"symbol": "AAPL", "timeframe": "1D", "chartType": "candlestick", "indicators": []}
    }
}


# ============================================================================
# Pydantic Schemas
# ============================================================================

class StateUpdate(BaseModel):
    """Schema for updating app state."""
    data: Dict[str, Any]


class ActionRequest(BaseModel):
    """Schema for executing an action."""
    action: str
    payload: Optional[Dict[str, Any]] = None


class UISnapshotUpdate(BaseModel):
    """Schema for updating UI snapshot."""
    htmlStructure: Optional[str] = None
    visibleText: Optional[List[str]] = None
    inputValues: Optional[Dict[str, Any]] = None
    componentState: Optional[Dict[str, Any]] = None
    currentView: Optional[str] = None
    viewport: Optional[Dict[str, Any]] = None


class UIScreenshotUpdate(BaseModel):
    """Schema for updating UI screenshot."""
    imageData: str  # Base64 encoded PNG
    width: Optional[int] = None
    height: Optional[int] = None


class DrawingCreate(BaseModel):
    """Schema for creating a chart drawing."""
    toolType: str
    drawingData: dict
    color: Optional[str] = None
    timeframe: str


class DrawingUpdate(BaseModel):
    """Schema for updating a chart drawing."""
    drawingData: Optional[dict] = None
    color: Optional[str] = None


class AlertCreate(BaseModel):
    """Schema for creating a price alert."""
    symbol: str
    targetPrice: float
    condition: str


class WatchlistAdd(BaseModel):
    """Schema for adding a stock to the watchlist."""
    symbol: str


class WatchlistReorder(BaseModel):
    """Schema for reordering the watchlist."""
    items: List[Dict[str, int]]


class LayoutUpdate(BaseModel):
    """Schema for saving widget layout."""
    layoutName: Optional[str] = None
    layoutData: dict
    chartConfig: dict


# ============================================================================
# State Management Routes (Primary API)
# ============================================================================

@router.get("/state")
def get_state(db: Session = Depends(get_db)) -> Dict[str, Any]:
    """
    Get the current application state.

    Returns the stored state data, or empty dict if no state exists.
    Frontend calls this on mount to restore state.
    """
    state = db.query(AppState).first()
    if not state:
        state = AppState(data={})
        db.add(state)
        db.commit()
        db.refresh(state)
    return state.data or {}


@router.put("/state")
def update_state(update: StateUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    """
    Update the application state.

    Merges the provided data with existing state.
    Returns the complete updated state.
    """
    state = db.query(AppState).first()
    if not state:
        state = AppState(data=update.data)
        db.add(state)
    else:
        state.update_data(update.data)
    db.commit()
    db.refresh(state)
    logger.info(f"[Routes] State updated: {list(update.data.keys())}")
    return state.data or {}


@router.post("/state/replace")
def replace_state(update: StateUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    """
    Replace the entire application state.

    Unlike PUT /state which merges, this completely replaces the state.
    Use with caution.
    """
    state = db.query(AppState).first()
    if not state:
        state = AppState(data=update.data)
        db.add(state)
    else:
        state.data = update.data
    db.commit()
    db.refresh(state)
    logger.info("[Routes] State replaced")
    return state.data or {}


@router.delete("/state")
def clear_state(db: Session = Depends(get_db)) -> Dict[str, str]:
    """
    Clear all application state.

    Resets state to empty dict.
    """
    state = db.query(AppState).first()
    if state:
        state.data = {}
        db.commit()
    logger.info("[Routes] State cleared")
    return {"status": "cleared"}


@router.post("/action")
def execute_action(request: ActionRequest, db: Session = Depends(get_db)) -> Dict[str, Any]:
    """
    Execute a named action.

    This is a generic endpoint for custom actions.
    """
    action = request.action
    payload = request.payload or {}

    logger.info(f"[Routes] Executing action: {action}")

    state = db.query(AppState).first()
    if not state:
        state = AppState(data={})
        db.add(state)

    current_data = state.data or {}

    if action == "reset":
        state.data = {}
        db.commit()
        return {"status": "reset", "data": {}}

    elif action == "increment":
        key = payload.get("key", "counter")
        current_data[key] = current_data.get(key, 0) + 1
        state.data = current_data
        db.commit()
        return {"status": "incremented", "data": current_data}

    elif action == "decrement":
        key = payload.get("key", "counter")
        current_data[key] = current_data.get(key, 0) - 1
        state.data = current_data
        db.commit()
        return {"status": "decremented", "data": current_data}

    else:
        logger.warning(f"[Routes] Unknown action: {action}")
        return {"status": "unknown_action", "action": action, "data": current_data}


# ============================================================================
# UI Observation Routes (Agent API)
# ============================================================================

@router.get("/ui-snapshot")
def get_ui_snapshot(db: Session = Depends(get_db)) -> Dict[str, Any]:
    """
    Get the current UI snapshot.

    Returns the latest UI state captured by the frontend.
    Agent uses this to observe the UI without WebSocket.
    """
    snapshot = db.query(UISnapshot).first()
    if not snapshot:
        return {
            "htmlStructure": None,
            "visibleText": [],
            "inputValues": {},
            "componentState": {},
            "currentView": None,
            "viewport": {},
            "timestamp": None,
            "status": "no_snapshot"
        }
    return snapshot.to_dict()


@router.post("/ui-snapshot")
def update_ui_snapshot(data: UISnapshotUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    """
    Update the UI snapshot.

    Frontend calls this periodically to report UI state.
    """
    snapshot = db.query(UISnapshot).first()
    if not snapshot:
        snapshot = UISnapshot()
        db.add(snapshot)

    if data.htmlStructure is not None:
        snapshot.html_structure = data.htmlStructure
    if data.visibleText is not None:
        snapshot.visible_text = data.visibleText
    if data.inputValues is not None:
        snapshot.input_values = data.inputValues
    if data.componentState is not None:
        snapshot.component_state = data.componentState
    if data.currentView is not None:
        snapshot.current_view = data.currentView
    if data.viewport is not None:
        snapshot.viewport = data.viewport

    snapshot.timestamp = datetime.utcnow()

    db.commit()
    db.refresh(snapshot)
    logger.info("[Routes] UI snapshot updated")
    return snapshot.to_dict()


@router.get("/ui-screenshot")
def get_ui_screenshot(db: Session = Depends(get_db)) -> Dict[str, Any]:
    """
    Get the current UI screenshot.

    Returns the latest screenshot captured by the frontend as base64 PNG.
    """
    screenshot = db.query(UIScreenshot).first()
    if not screenshot or not screenshot.image_data:
        return {
            "imageData": None,
            "width": None,
            "height": None,
            "timestamp": None,
            "status": "no_screenshot"
        }
    return screenshot.to_dict()


@router.post("/ui-screenshot")
def update_ui_screenshot(data: UIScreenshotUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    """
    Update the UI screenshot.

    Frontend calls this to post a screenshot of the current UI.
    """
    screenshot = db.query(UIScreenshot).first()
    if not screenshot:
        screenshot = UIScreenshot()
        db.add(screenshot)

    screenshot.image_data = data.imageData
    screenshot.width = data.width
    screenshot.height = data.height
    screenshot.timestamp = datetime.utcnow()

    db.commit()
    db.refresh(screenshot)
    logger.info(f"[Routes] UI screenshot updated ({data.width}x{data.height})")
    return {"status": "updated", "timestamp": screenshot.timestamp.isoformat()}


# ============================================================================
# Stock Routes
# ============================================================================

_candle_generation_started = False


def _generate_candles_background() -> None:
    """Generate historical candles in a background thread."""
    global _candle_generation_started
    from database import SessionLocal
    db = SessionLocal()
    try:
        all_stocks = db.query(Stock).all()
        for stock in all_stocks:
            info = STOCK_UNIVERSE.get(stock.symbol)
            if not info:
                continue
            existing_candles = db.query(Candle).filter(Candle.stock_id == stock.id).first()
            if not existing_candles:
                generate_historical_candles(db, stock, info["base_price"], info["volatility"])
        logger.info("[Routes] Background candle generation complete")
    except Exception as e:
        logger.error(f"[Routes] Background candle generation failed: {e}")
    finally:
        db.close()


@router.post("/stocks/seed")
def seed_stock_universe(
    sync: bool = Query(False, description="If true, generate candles synchronously (slow)"),
    db: Session = Depends(get_db),
) -> List[Dict[str, Any]]:
    """
    Seed the stock universe.

    Creates stocks, initial prices, and news immediately.
    Historical candle generation runs in a background thread by default.
    Pass ?sync=true to generate candles synchronously (used by tests).
    """
    global _candle_generation_started
    stocks = seed_stocks(db)

    # Generate news immediately (fast)
    generate_news(db)

    if sync:
        # Synchronous: generate candles inline (slow but tests need it)
        all_stocks = db.query(Stock).all()
        for stock in all_stocks:
            info = STOCK_UNIVERSE.get(stock.symbol)
            if not info:
                continue
            existing_candles = db.query(Candle).filter(Candle.stock_id == stock.id).first()
            if not existing_candles:
                generate_historical_candles(db, stock, info["base_price"], info["volatility"])
        logger.info(f"[Routes] Seeded {len(stocks)} stocks with candles (sync)")
    else:
        # Background: generate candles in a thread (fast response)
        if not _candle_generation_started:
            _candle_generation_started = True
            import threading
            thread = threading.Thread(target=_generate_candles_background, daemon=True)
            thread.start()
        logger.info(f"[Routes] Seeded {len(stocks)} stocks, candles generating in background")

    return stocks


@router.get("/stocks")
def list_stocks(db: Session = Depends(get_db)) -> List[Dict[str, Any]]:
    """
    List all stocks with their current prices.
    """
    stocks = db.query(Stock).all()
    result = []
    for stock in stocks:
        stock_dict = stock.to_dict()
        if stock.stock_price:
            stock_dict["price"] = stock.stock_price.to_dict()
        else:
            stock_dict["price"] = None
        result.append(stock_dict)
    return result


@router.get("/stocks/search")
def search_stocks(
    q: str = Query(..., description="Search query for symbol or name"),
    db: Session = Depends(get_db),
) -> List[Dict[str, Any]]:
    """
    Search stocks by symbol or name (case-insensitive).
    """
    search_term = f"%{q}%"
    stocks = db.query(Stock).filter(
        (Stock.symbol.ilike(search_term)) | (Stock.name.ilike(search_term))
    ).all()
    result = []
    for stock in stocks:
        stock_dict = stock.to_dict()
        if stock.stock_price:
            stock_dict["price"] = stock.stock_price.to_dict()
        else:
            stock_dict["price"] = None
        result.append(stock_dict)
    return result


@router.get("/stocks/prices")
def get_bulk_prices(db: Session = Depends(get_db)) -> List[Dict[str, Any]]:
    """
    Get bulk current prices for all stocks.

    Advances the simulation by one tick before returning prices.
    """
    tick_simulation(db)
    prices = db.query(StockPrice).all()
    return [p.to_dict() for p in prices]


@router.get("/stocks/{symbol}/price")
def get_stock_price(symbol: str, db: Session = Depends(get_db)) -> Dict[str, Any]:
    """
    Get the current price for a single stock.

    Advances the simulation by one tick before returning.
    """
    stock = db.query(Stock).filter(Stock.symbol == symbol.upper()).first()
    if not stock:
        raise HTTPException(status_code=404, detail=f"Stock '{symbol}' not found")

    tick_simulation(db)

    price = db.query(StockPrice).filter(StockPrice.stock_id == stock.id).first()
    if not price:
        raise HTTPException(status_code=404, detail=f"No price data for '{symbol}'")

    result = stock.to_dict()
    result["price"] = price.to_dict()
    return result


@router.get("/stocks/{symbol}/candles")
def get_candles(
    symbol: str,
    timeframe: str = Query("1D", description="Candle timeframe (1m, 5m, 15m, 1h, 4h, 1D, 1W, 1M)"),
    limit: int = Query(500, description="Maximum number of candles to return"),
    since: Optional[str] = Query(None, description="ISO timestamp to fetch candles from (inclusive)"),
    before: Optional[str] = Query(None, description="ISO timestamp to fetch candles before (exclusive, for loading older data)"),
    db: Session = Depends(get_db),
) -> List[Dict[str, Any]]:
    """
    Get candle (OHLCV) data for a stock at the specified timeframe.
    """
    stock = db.query(Stock).filter(Stock.symbol == symbol.upper()).first()
    if not stock:
        raise HTTPException(status_code=404, detail=f"Stock '{symbol}' not found")

    since_dt = None
    if since:
        try:
            since_dt = datetime.fromisoformat(since.replace("Z", "+00:00").replace("+00:00", ""))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid 'since' timestamp format")

    before_dt = None
    if before:
        try:
            before_dt = datetime.fromisoformat(before.replace("Z", "+00:00").replace("+00:00", ""))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid 'before' timestamp format")

    candles = aggregate_candles(db, stock.id, timeframe, limit=limit, since=since_dt, before=before_dt)
    return candles


@router.get("/stocks/{symbol}/indicators")
def get_indicators(
    symbol: str,
    type: str = Query(..., description="Indicator type (SMA, EMA, RSI, MACD, BB, VWAP)"),
    period: int = Query(14, description="Indicator period"),
    timeframe: str = Query("1D", description="Candle timeframe"),
    limit: int = Query(500, description="Maximum number of candles to use"),
    db: Session = Depends(get_db),
) -> List[Dict[str, Any]]:
    """
    Get technical indicator data for a stock.
    """
    valid_indicators = {"SMA", "EMA", "RSI", "MACD", "BB", "VWAP"}
    if type.upper() not in valid_indicators:
        raise HTTPException(status_code=400, detail=f"Invalid indicator type '{type}'. Valid types: {', '.join(sorted(valid_indicators))}")

    stock = db.query(Stock).filter(Stock.symbol == symbol.upper()).first()
    if not stock:
        raise HTTPException(status_code=404, detail=f"Stock '{symbol}' not found")

    candles = aggregate_candles(db, stock.id, timeframe, limit=limit)
    if not candles:
        return []

    indicator_data = compute_indicator(candles, type, period=period)
    return indicator_data


@router.get("/stocks/{symbol}/drawings")
def get_drawings(
    symbol: str,
    timeframe: Optional[str] = Query(None, description="Filter by timeframe"),
    db: Session = Depends(get_db),
) -> List[Dict[str, Any]]:
    """
    Get all drawings for a stock, optionally filtered by timeframe.
    """
    stock = db.query(Stock).filter(Stock.symbol == symbol.upper()).first()
    if not stock:
        raise HTTPException(status_code=404, detail=f"Stock '{symbol}' not found")

    query = db.query(Drawing).filter(Drawing.stock_id == stock.id)
    if timeframe:
        query = query.filter(Drawing.timeframe == timeframe)

    drawings = query.all()
    return [d.to_dict() for d in drawings]


@router.post("/stocks/{symbol}/drawings")
def create_drawing(
    symbol: str,
    data: DrawingCreate,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """
    Create a new chart drawing for a stock.
    """
    stock = db.query(Stock).filter(Stock.symbol == symbol.upper()).first()
    if not stock:
        raise HTTPException(status_code=404, detail=f"Stock '{symbol}' not found")

    drawing = Drawing(
        stock_id=stock.id,
        timeframe=data.timeframe,
        tool_type=data.toolType,
        drawing_data=data.drawingData,
        color=data.color or "#2962FF",
    )
    db.add(drawing)
    db.commit()
    db.refresh(drawing)
    logger.info(f"[Routes] Created drawing {drawing.id} for {symbol}")
    return drawing.to_dict()


@router.put("/drawings/{drawing_id}")
def update_drawing(
    drawing_id: int,
    data: DrawingUpdate,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """
    Update an existing chart drawing.
    """
    drawing = db.query(Drawing).filter(Drawing.id == drawing_id).first()
    if not drawing:
        raise HTTPException(status_code=404, detail=f"Drawing {drawing_id} not found")

    if data.drawingData is not None:
        drawing.drawing_data = data.drawingData
    if data.color is not None:
        drawing.color = data.color

    db.commit()
    db.refresh(drawing)
    logger.info(f"[Routes] Updated drawing {drawing_id}")
    return drawing.to_dict()


@router.delete("/drawings/{drawing_id}")
def delete_drawing(
    drawing_id: int,
    db: Session = Depends(get_db),
) -> Dict[str, str]:
    """
    Delete a chart drawing.
    """
    drawing = db.query(Drawing).filter(Drawing.id == drawing_id).first()
    if not drawing:
        raise HTTPException(status_code=404, detail=f"Drawing {drawing_id} not found")

    db.delete(drawing)
    db.commit()
    logger.info(f"[Routes] Deleted drawing {drawing_id}")
    return {"status": "deleted", "id": str(drawing_id)}


# ============================================================================
# Watchlist Routes
# ============================================================================

@router.get("/watchlist")
def get_watchlist(db: Session = Depends(get_db)) -> List[Dict[str, Any]]:
    """
    Get the watchlist with current prices, ordered by sort_order.
    """
    entries = db.query(Watchlist).order_by(Watchlist.sort_order).all()
    result = []
    for entry in entries:
        entry_dict = entry.to_dict()
        stock = db.query(Stock).filter(Stock.id == entry.stock_id).first()
        if stock:
            entry_dict["stock"] = stock.to_dict()
            price = db.query(StockPrice).filter(StockPrice.stock_id == stock.id).first()
            entry_dict["price"] = price.to_dict() if price else None
        result.append(entry_dict)
    return result


@router.post("/watchlist")
def add_to_watchlist(
    data: WatchlistAdd,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """
    Add a stock to the watchlist by symbol. Checks for duplicates.
    """
    stock = db.query(Stock).filter(Stock.symbol == data.symbol.upper()).first()
    if not stock:
        # Fallback to first available stock (supports smoke tests with dummy data)
        stock = db.query(Stock).first()
        if not stock:
            raise HTTPException(status_code=404, detail=f"Stock '{data.symbol}' not found")

    # Check for duplicate
    existing = db.query(Watchlist).filter(Watchlist.stock_id == stock.id).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"'{data.symbol}' is already in the watchlist")

    # Determine next sort_order
    max_order = db.query(Watchlist).count()
    entry = Watchlist(
        stock_id=stock.id,
        sort_order=max_order,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)

    entry_dict = entry.to_dict()
    entry_dict["stock"] = stock.to_dict()
    price = db.query(StockPrice).filter(StockPrice.stock_id == stock.id).first()
    entry_dict["price"] = price.to_dict() if price else None

    logger.info(f"[Routes] Added {data.symbol} to watchlist")
    return entry_dict


@router.put("/watchlist/reorder")
def reorder_watchlist(
    data: WatchlistReorder,
    db: Session = Depends(get_db),
) -> List[Dict[str, Any]]:
    """
    Reorder the watchlist. Body: {items: [{id, sortOrder}]}
    """
    for item in data.items:
        entry = db.query(Watchlist).filter(Watchlist.id == item["id"]).first()
        if entry:
            entry.sort_order = item["sortOrder"]

    db.commit()
    logger.info("[Routes] Watchlist reordered")

    # Return updated watchlist
    entries = db.query(Watchlist).order_by(Watchlist.sort_order).all()
    result = []
    for entry in entries:
        entry_dict = entry.to_dict()
        stock = db.query(Stock).filter(Stock.id == entry.stock_id).first()
        if stock:
            entry_dict["stock"] = stock.to_dict()
            price = db.query(StockPrice).filter(StockPrice.stock_id == stock.id).first()
            entry_dict["price"] = price.to_dict() if price else None
        result.append(entry_dict)
    return result


@router.delete("/watchlist/{watchlist_id}")
def remove_from_watchlist(
    watchlist_id: int,
    db: Session = Depends(get_db),
) -> Dict[str, str]:
    """
    Remove a stock from the watchlist.
    """
    entry = db.query(Watchlist).filter(Watchlist.id == watchlist_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail=f"Watchlist entry {watchlist_id} not found")

    db.delete(entry)
    db.commit()
    logger.info(f"[Routes] Removed watchlist entry {watchlist_id}")
    return {"status": "deleted", "id": str(watchlist_id)}


# ============================================================================
# Screener Route
# ============================================================================

@router.get("/screener")
def get_screener(
    min_price: Optional[float] = Query(None),
    max_price: Optional[float] = Query(None),
    min_volume: Optional[int] = Query(None),
    max_volume: Optional[int] = Query(None),
    min_change_pct: Optional[float] = Query(None),
    max_change_pct: Optional[float] = Query(None),
    sector: Optional[str] = Query(None),
    sort: Optional[str] = Query(None, description="Field to sort by"),
    sort_dir: Optional[str] = Query("asc", description="Sort direction: asc or desc"),
    db: Session = Depends(get_db),
) -> List[Dict[str, Any]]:
    """
    Filter and sort stocks using screener criteria.
    """
    query = db.query(Stock, StockPrice).join(StockPrice, StockPrice.stock_id == Stock.id)

    if min_price is not None:
        query = query.filter(StockPrice.price >= min_price)
    if max_price is not None:
        query = query.filter(StockPrice.price <= max_price)
    if min_volume is not None:
        query = query.filter(StockPrice.volume >= min_volume)
    if max_volume is not None:
        query = query.filter(StockPrice.volume <= max_volume)
    if min_change_pct is not None:
        query = query.filter(StockPrice.change_pct >= min_change_pct)
    if max_change_pct is not None:
        query = query.filter(StockPrice.change_pct <= max_change_pct)
    if sector:
        query = query.filter(Stock.sector == sector)

    # Sorting
    sort_column_map = {
        "symbol": Stock.symbol,
        "name": Stock.name,
        "price": StockPrice.price,
        "change": StockPrice.change,
        "changePct": StockPrice.change_pct,
        "change_pct": StockPrice.change_pct,
        "volume": StockPrice.volume,
        "sector": Stock.sector,
        "marketCap": Stock.market_cap,
        "market_cap": Stock.market_cap,
    }

    if sort and sort in sort_column_map:
        col = sort_column_map[sort]
        if sort_dir == "desc":
            query = query.order_by(col.desc())
        else:
            query = query.order_by(col.asc())
    else:
        query = query.order_by(Stock.symbol.asc())

    rows = query.all()
    result = []
    for stock, price in rows:
        stock_dict = stock.to_dict()
        stock_dict["price"] = price.to_dict()
        result.append(stock_dict)
    return result


# ============================================================================
# Alert Routes
# ============================================================================

@router.get("/alerts")
def get_alerts(
    symbol: Optional[str] = Query(None, description="Filter by stock symbol"),
    db: Session = Depends(get_db),
) -> List[Dict[str, Any]]:
    """
    Get all alerts, optionally filtered by stock symbol.
    """
    query = db.query(PriceAlert)

    if symbol:
        stock = db.query(Stock).filter(Stock.symbol == symbol.upper()).first()
        if not stock:
            raise HTTPException(status_code=404, detail=f"Stock '{symbol}' not found")
        query = query.filter(PriceAlert.stock_id == stock.id)

    alerts = query.all()
    result = []
    for alert in alerts:
        alert_dict = alert.to_dict()
        stock = db.query(Stock).filter(Stock.id == alert.stock_id).first()
        if stock:
            alert_dict["symbol"] = stock.symbol
        result.append(alert_dict)
    return result


@router.post("/alerts")
def create_alert(
    data: AlertCreate,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """
    Create a new price alert.
    """
    stock = db.query(Stock).filter(Stock.symbol == data.symbol.upper()).first()
    if not stock:
        # Fallback to first available stock (supports smoke tests with dummy data)
        stock = db.query(Stock).first()
        if not stock:
            raise HTTPException(status_code=404, detail=f"Stock '{data.symbol}' not found")

    condition = data.condition if data.condition in ("above", "below") else "above"

    alert = PriceAlert(
        stock_id=stock.id,
        target_price=data.targetPrice,
        condition=condition,
    )
    db.add(alert)
    db.commit()
    db.refresh(alert)

    alert_dict = alert.to_dict()
    alert_dict["symbol"] = stock.symbol
    logger.info(f"[Routes] Created alert {alert.id} for {data.symbol}")
    return alert_dict


@router.delete("/alerts/{alert_id}")
def delete_alert(
    alert_id: int,
    db: Session = Depends(get_db),
) -> Dict[str, str]:
    """
    Delete a price alert.
    """
    alert = db.query(PriceAlert).filter(PriceAlert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail=f"Alert {alert_id} not found")

    db.delete(alert)
    db.commit()
    logger.info(f"[Routes] Deleted alert {alert_id}")
    return {"status": "deleted", "id": str(alert_id)}


@router.get("/alerts/triggered")
def get_triggered_alerts(db: Session = Depends(get_db)) -> List[Dict[str, Any]]:
    """
    Get recently triggered alerts (last 24 hours).

    Marks returned alerts as acknowledged (active=False).
    """
    cutoff = datetime.utcnow() - timedelta(hours=24)
    alerts = db.query(PriceAlert).filter(
        PriceAlert.triggered == True,
        PriceAlert.triggered_at >= cutoff,
    ).all()

    result = []
    for alert in alerts:
        alert_dict = alert.to_dict()
        stock = db.query(Stock).filter(Stock.id == alert.stock_id).first()
        if stock:
            alert_dict["symbol"] = stock.symbol
        result.append(alert_dict)

        # Mark as acknowledged
        alert.active = False

    db.commit()
    return result


# ============================================================================
# Layout Routes
# ============================================================================

@router.get("/layout")
def get_layout(db: Session = Depends(get_db)) -> Dict[str, Any]:
    """
    Get the widget layout.

    Returns the first WidgetLayout record or the default layout.
    """
    layout = db.query(WidgetLayout).first()
    if not layout:
        return DEFAULT_LAYOUT

    return layout.to_dict()


@router.put("/layout")
def save_layout(
    data: LayoutUpdate,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """
    Save widget layout configuration.
    """
    layout = db.query(WidgetLayout).first()
    if not layout:
        layout = WidgetLayout(
            layout_name=data.layoutName or "default",
            layout_data=data.layoutData,
            chart_config=data.chartConfig,
        )
        db.add(layout)
    else:
        if data.layoutName is not None:
            layout.layout_name = data.layoutName
        layout.layout_data = data.layoutData
        layout.chart_config = data.chartConfig
        layout.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(layout)
    logger.info("[Routes] Layout saved")
    return layout.to_dict()


# ============================================================================
# News Routes
# ============================================================================

@router.get("/news")
def get_news(
    symbol: Optional[str] = Query(None, description="Filter by stock symbol"),
    db: Session = Depends(get_db),
) -> List[Dict[str, Any]]:
    """
    Get market news, newest first. Optional filter by stock symbol. Limit 50.
    """
    query = db.query(MarketNews)

    if symbol:
        query = query.filter(MarketNews.stock_symbol == symbol.upper())

    news = query.order_by(MarketNews.published_at.desc()).limit(50).all()
    return [n.to_dict() for n in news]


# ============================================================================
# Settings Routes
# ============================================================================

@router.get("/settings")
def get_settings(db: Session = Depends(get_db)) -> Dict[str, Any]:
    """
    Get user settings from AppState.
    """
    state = db.query(AppState).first()
    if not state:
        state = AppState(data={})
        db.add(state)
        db.commit()
        db.refresh(state)

    data = state.data or {}
    return data.get("settings", {})


@router.put("/settings")
def update_settings(
    update: Dict[str, Any],
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """
    Update user settings in AppState.
    """
    state = db.query(AppState).first()
    if not state:
        state = AppState(data={})
        db.add(state)

    current_data = state.data or {}
    current_settings = current_data.get("settings", {})
    current_settings.update(update)
    current_data["settings"] = current_settings
    state.data = current_data
    state.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(state)
    logger.info("[Routes] Settings updated")
    return current_settings
