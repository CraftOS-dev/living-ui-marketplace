"""
Streak, completion, heatmap, and dashboard computations for habits.

All time-based computations use the local server date (date.today()).
For a single-user Living UI this is sufficient.
"""

from datetime import date, timedelta
from typing import Iterable, List, Dict, Any, Optional

from sqlalchemy.orm import Session

from models import Habit, HabitEntry


HEATMAP_DAYS = 365


def _completed_dates(habit: Habit, entries: Iterable[HabitEntry]) -> set:
    """Return the set of dates on which this habit was completed."""
    return {e.date for e in entries if habit.is_completed(e.value or 0)}


def current_streak(habit: Habit, entries: Iterable[HabitEntry], today: Optional[date] = None) -> int:
    """
    Current streak = number of consecutive completed days ending today
    (or yesterday, if today has no entry yet — so a habit done daily for 5
    days isn't broken just because the user hasn't tapped today).
    """
    if today is None:
        today = date.today()
    completed = _completed_dates(habit, entries)
    if not completed:
        return 0

    # Anchor: today if completed today, else yesterday if completed yesterday.
    if today in completed:
        anchor = today
    elif (today - timedelta(days=1)) in completed:
        anchor = today - timedelta(days=1)
    else:
        return 0

    streak = 0
    cursor = anchor
    while cursor in completed:
        streak += 1
        cursor -= timedelta(days=1)
    return streak


def best_streak(habit: Habit, entries: Iterable[HabitEntry]) -> int:
    """Longest run of consecutive completed days."""
    completed = sorted(_completed_dates(habit, entries))
    if not completed:
        return 0
    best = 1
    run = 1
    for prev, cur in zip(completed, completed[1:]):
        if (cur - prev).days == 1:
            run += 1
            best = max(best, run)
        else:
            run = 1
    return best


def completion_rate(
    habit: Habit,
    entries: Iterable[HabitEntry],
    window: int = 30,
    today: Optional[date] = None,
) -> float:
    """Completed days / window, over the trailing `window` days ending today."""
    if window <= 0:
        return 0.0
    if today is None:
        today = date.today()
    start = today - timedelta(days=window - 1)
    completed = _completed_dates(habit, entries)
    n_completed = sum(1 for d in completed if start <= d <= today)
    return round(n_completed / window, 4)


def trend(
    habit: Habit,
    entries: Iterable[HabitEntry],
    window: int = 30,
    today: Optional[date] = None,
) -> List[Dict[str, Any]]:
    """List of {date, value, completed, intensity} for trailing `window` days."""
    if today is None:
        today = date.today()
    by_date: Dict[date, HabitEntry] = {e.date: e for e in entries}
    out: List[Dict[str, Any]] = []
    for n in range(window - 1, -1, -1):
        d = today - timedelta(days=n)
        e = by_date.get(d)
        value = (e.value or 0) if e else 0
        out.append({
            "date": d.isoformat(),
            "value": value,
            "completed": habit.is_completed(value),
            "intensity": habit.intensity(value),
        })
    return out


def heatmap(
    habit: Habit,
    entries: Iterable[HabitEntry],
    days: int = HEATMAP_DAYS,
    today: Optional[date] = None,
) -> List[Dict[str, Any]]:
    """Cells for a `days`-long heatmap ending today, ascending."""
    if today is None:
        today = date.today()
    by_date: Dict[date, HabitEntry] = {e.date: e for e in entries}
    cells: List[Dict[str, Any]] = []
    for n in range(days - 1, -1, -1):
        d = today - timedelta(days=n)
        e = by_date.get(d)
        value = (e.value or 0) if e else 0
        cells.append({
            "date": d.isoformat(),
            "value": value,
            "completed": habit.is_completed(value),
            "intensity": habit.intensity(value),
            "note": e.note if e else None,
        })
    return cells


def stats(
    habit: Habit,
    entries: Iterable[HabitEntry],
    window: int = 30,
    today: Optional[date] = None,
) -> Dict[str, Any]:
    """Bundle of per-habit stats."""
    entries = list(entries)
    return {
        "currentStreak": current_streak(habit, entries, today=today),
        "bestStreak": best_streak(habit, entries),
        "completionRate": completion_rate(habit, entries, window=window, today=today),
        "trend": trend(habit, entries, window=window, today=today),
        "totalCompletions": sum(
            1 for e in entries if habit.is_completed(e.value or 0)
        ),
    }


# ============================================================================
# Dashboard
# ============================================================================

def dashboard_summary(db: Session, today: Optional[date] = None) -> Dict[str, Any]:
    """Summary across all non-archived habits for today + last 7 days."""
    if today is None:
        today = date.today()

    habits = db.query(Habit).filter(Habit.archived.is_(False)).all()
    if not habits:
        return {
            "todayCompleted": 0,
            "todayTotal": 0,
            "weeklyRate": 0,
            "activeStreaks": 0,
        }

    week_start = today - timedelta(days=6)
    today_completed = 0
    week_completed = 0
    active_streaks = 0
    week_slots = 7 * len(habits)

    for h in habits:
        entries = list(h.entries)
        # Today
        today_entry = next((e for e in entries if e.date == today), None)
        if today_entry and h.is_completed(today_entry.value or 0):
            today_completed += 1
        # Weekly
        for n in range(7):
            d = today - timedelta(days=n)
            e = next((x for x in entries if x.date == d), None)
            if e and h.is_completed(e.value or 0):
                week_completed += 1
        # Active streak ≥ 7
        if current_streak(h, entries, today=today) >= 7:
            active_streaks += 1

    return {
        "todayCompleted": today_completed,
        "todayTotal": len(habits),
        "weeklyRate": round(week_completed / week_slots, 4) if week_slots else 0,
        "activeStreaks": active_streaks,
    }
