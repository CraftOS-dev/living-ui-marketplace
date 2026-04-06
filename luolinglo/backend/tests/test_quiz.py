"""Tests for quiz endpoints."""


def _setup(client):
    client.post("/api/profile", json={
        "nativeLanguage": "English",
        "targetLanguage": "Japanese",
    })


def test_submit_quiz(client):
    _setup(client)
    response = client.post("/api/quiz/submit", json={
        "quizType": "multiple_choice",
        "category": "Animals",
        "totalQuestions": 5,
        "correctAnswers": 4,
        "timeTakenSeconds": 120,
    })
    assert response.status_code == 200
    data = response.json()
    assert data["xpEarned"] > 0
    assert data["attempt"]["quizType"] == "multiple_choice"
    assert data["attempt"]["correctAnswers"] == 4


def test_submit_perfect_quiz(client):
    _setup(client)
    response = client.post("/api/quiz/submit", json={
        "quizType": "fill_blank",
        "totalQuestions": 5,
        "correctAnswers": 5,
    })
    data = response.json()
    # Perfect score = 5*10 + 20 bonus = 70 base XP
    assert data["xpEarned"] >= 70


def test_quiz_history(client):
    _setup(client)
    client.post("/api/quiz/submit", json={
        "quizType": "multiple_choice",
        "totalQuestions": 5,
        "correctAnswers": 3,
    })
    client.post("/api/quiz/submit", json={
        "quizType": "fill_blank",
        "totalQuestions": 10,
        "correctAnswers": 8,
    })

    response = client.get("/api/quiz/history")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 2
