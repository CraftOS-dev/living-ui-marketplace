"""
SM-2 Spaced Repetition Algorithm

Implementation of the SuperMemo SM-2 algorithm for flashcard scheduling.
"""

from datetime import date, timedelta
from models import FlashcardProgress


def sm2_update(progress: FlashcardProgress, quality: int) -> FlashcardProgress:
    """Update flashcard progress using SM-2 algorithm.

    Args:
        progress: The FlashcardProgress record to update.
        quality: Rating 0-5 (0=complete blackout, 5=perfect response).
            - 0-2: Incorrect (reset repetitions)
            - 3: Correct with difficulty
            - 4: Correct with hesitation
            - 5: Perfect recall

    Returns:
        The updated FlashcardProgress record.
    """
    quality = max(0, min(5, quality))
    progress.total_reviews += 1

    if quality >= 3:
        progress.correct_count += 1
        if progress.repetitions == 0:
            progress.interval = 1
        elif progress.repetitions == 1:
            progress.interval = 6
        else:
            progress.interval = round(progress.interval * progress.easiness_factor)
        progress.repetitions += 1
    else:
        progress.repetitions = 0
        progress.interval = 1

    progress.easiness_factor = max(
        1.3,
        progress.easiness_factor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
    )

    today = date.today()
    progress.next_review_date = (today + timedelta(days=progress.interval)).isoformat()
    progress.last_review_date = today.isoformat()

    return progress
