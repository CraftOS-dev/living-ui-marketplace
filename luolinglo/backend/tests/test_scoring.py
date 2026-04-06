"""Tests for scoring, XP, and streak system."""
from datetime import date


def _setup(client):
    client.post("/api/profile", json={
        "nativeLanguage": "English",
        "targetLanguage": "Japanese",
    })


def test_xp_from_adding_word(client):
    _setup(client)
    client.post("/api/vocabulary", json={"word": "猫", "translation": "cat"})

    profile = client.get("/api/profile").json()
    assert profile["totalXp"] >= 2  # 2 XP per word


def test_xp_from_quiz(client):
    _setup(client)
    client.post("/api/quiz/submit", json={
        "quizType": "multiple_choice",
        "totalQuestions": 5,
        "correctAnswers": 5,
    })

    profile = client.get("/api/profile").json()
    assert profile["totalXp"] >= 70  # 5*10 + 20 bonus


def test_level_up(client):
    _setup(client)
    # Submit enough quizzes to level up (need 150 XP for level 2)
    for _ in range(3):
        client.post("/api/quiz/submit", json={
            "quizType": "multiple_choice",
            "totalQuestions": 5,
            "correctAnswers": 5,
        })

    profile = client.get("/api/profile").json()
    assert profile["level"] >= 2


def test_streak_starts_at_1(client):
    _setup(client)
    client.post("/api/profile/record-practice")
    profile = client.get("/api/profile").json()
    assert profile["currentStreak"] == 1


def test_daily_goal_update(client):
    _setup(client)
    response = client.put("/api/daily-goal", json={"dailyXpGoal": 100})
    assert response.status_code == 200
    assert response.json()["dailyXpGoal"] == 100


def test_buy_streak_freeze(client):
    _setup(client)
    # Need 100 XP to buy
    for _ in range(2):
        client.post("/api/quiz/submit", json={
            "quizType": "multiple_choice",
            "totalQuestions": 5,
            "correctAnswers": 5,
        })

    response = client.post("/api/streak-freeze/buy")
    assert response.status_code == 200
    profile = response.json()
    assert profile["streakFreezeInventory"] == 1


def test_buy_streak_freeze_not_enough_xp(client):
    _setup(client)
    response = client.post("/api/streak-freeze/buy")
    assert response.status_code == 400


def test_dashboard(client):
    _setup(client)
    response = client.get("/api/progress/dashboard")
    assert response.status_code == 200
    data = response.json()
    assert data["hasProfile"] is True
    assert data["levelTitle"] == "Novice"
    assert data["dueCards"] == 0


def test_achievements(client):
    _setup(client)
    response = client.get("/api/progress/achievements")
    assert response.status_code == 200
    data = response.json()
    assert data["totalCount"] > 0
    assert data["earnedCount"] == 0
