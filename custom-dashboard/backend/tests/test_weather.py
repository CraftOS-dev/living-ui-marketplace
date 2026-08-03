"""Tests for weather endpoints."""
from unittest.mock import patch, MagicMock


def _mock_geo_response(city="London", lat=51.5, lon=-0.12):
    mock = MagicMock()
    mock.status_code = 200
    mock.json.return_value = {"results": [{"name": city, "latitude": lat, "longitude": lon}]}
    mock.raise_for_status = MagicMock()
    return mock


def _mock_weather_response():
    mock = MagicMock()
    mock.status_code = 200
    mock.json.return_value = {
        "current": {"temperature_2m": 18.5, "weathercode": 2, "apparent_temperature": 17.0},
        "daily": {
            "time": ["2026-06-24", "2026-06-25", "2026-06-26", "2026-06-27"],
            "weathercode": [2, 3, 61, 0],
            "temperature_2m_max": [22.0, 20.5, 18.0, 24.0],
            "temperature_2m_min": [14.0, 13.0, 12.5, 15.0],
        },
    }
    mock.raise_for_status = MagicMock()
    return mock


def test_get_weather_no_city(client):
    """GET /weather with no city set should return no_city status."""
    response = client.get("/api/weather")
    assert response.status_code == 200
    data = response.json()
    assert data.get("status") == "no_city" or data.get("cityName") is None


def test_set_weather_city(client):
    """PUT /weather/city should geocode and fetch weather."""
    with patch("httpx.get") as mock_get:
        mock_get.side_effect = [_mock_geo_response(), _mock_weather_response()]
        response = client.put("/api/weather/city", json={"city": "London"})
    assert response.status_code == 200
    data = response.json()
    assert data["cityName"] == "London"
    assert data["currentTemp"] == 18.5
    assert data["weatherCode"] == 2
    assert len(data["forecast"]) == 3


def test_set_weather_city_not_found(client):
    """PUT /weather/city with unknown city should 404."""
    with patch("httpx.get") as mock_get:
        no_result = MagicMock()
        no_result.status_code = 200
        no_result.json.return_value = {"results": []}
        no_result.raise_for_status = MagicMock()
        mock_get.return_value = no_result
        response = client.put("/api/weather/city", json={"city": "xyznonexistentcity"})
    assert response.status_code == 404


def test_get_weather_after_city_set(client):
    """GET /weather after city set should return cached data."""
    with patch("httpx.get") as mock_get:
        mock_get.side_effect = [_mock_geo_response(), _mock_weather_response()]
        client.put("/api/weather/city", json={"city": "London"})

    response = client.get("/api/weather")
    assert response.status_code == 200
    data = response.json()
    assert data["cityName"] == "London"
    assert data["currentTemp"] is not None
