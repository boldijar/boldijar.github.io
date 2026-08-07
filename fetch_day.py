#!/usr/bin/env python3
"""Descarcă toate datele Open-Meteo pentru o zi aleasă (Plaja Modern)."""

from __future__ import annotations

import json
import secrets
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

import requests

from bot import (
    LAT,
    LON,
    RO_DAYS,
    RO_MONTHS,
    TIMEZONE,
    calculate_black_sea_score,
    fetch_json,
    num,
)

MARINE_URL = "https://marine-api.open-meteo.com/v1/marine"
WEATHER_URL = "https://api.open-meteo.com/v1/forecast"

MARINE_HOURLY = [
    "wave_height",
    "wave_direction",
    "wave_period",
    "swell_wave_height",
    "swell_wave_direction",
    "swell_wave_period",
    "swell_wave_peak_period",
    "wind_wave_height",
    "wind_wave_direction",
    "sea_surface_temperature",
]

MARINE_DAILY = [
    "wave_height_max",
    "wave_direction_dominant",
    "wave_period_max",
    "swell_wave_height_max",
    "swell_wave_direction_dominant",
    "swell_wave_period_max",
    "wind_wave_height_max",
]

MARINE_CURRENT = MARINE_HOURLY

WEATHER_HOURLY = [
    "wind_speed_10m",
    "wind_direction_10m",
    "wind_gusts_10m",
    "is_day",
    "temperature_2m",
    "weather_code",
]

WEATHER_DAILY = [
    "wind_speed_10m_max",
    "wind_direction_10m_dominant",
    "sunrise",
    "sunset",
    "temperature_2m_max",
    "temperature_2m_min",
    "weather_code",
]

WEATHER_CURRENT = [
    "wind_speed_10m",
    "wind_direction_10m",
    "wind_gusts_10m",
    "temperature_2m",
    "weather_code",
]


def today_local() -> date:
    return datetime.now(ZoneInfo(TIMEZONE)).date()


def format_ro_date(d: date) -> str:
    js_day = (d.weekday() + 1) % 7
    return f"{RO_DAYS[js_day]}, {d.day} {RO_MONTHS[d.month]}"


def next_days(count: int = 8) -> list[date]:
    start = today_local()
    return [start + timedelta(days=i) for i in range(count)]


def hourly_val(hourly: dict[str, Any], key: str, index: int) -> Any:
    values = hourly.get(key)
    if not isinstance(values, list) or index >= len(values):
        return None
    return values[index]


def daily_val(daily: dict[str, Any], key: str, index: int) -> Any:
    values = daily.get(key)
    if not isinstance(values, list) or index >= len(values):
        return None
    return values[index]


def pick_day() -> date:
    days = next_days(8)
    print("\nPentru ce zi vrei datele?\n")
    for i, d in enumerate(days, start=1):
        tag = " (azi)" if i == 1 else ""
        print(f"  {i}. {d.isoformat()} — {format_ro_date(d)}{tag}")
    print()

    while True:
        raw = input("Alege 1–8: ").strip()
        if raw.isdigit() and 1 <= int(raw) <= 8:
            return days[int(raw) - 1]
        print("Introdu un număr între 1 și 8.")


def api_params(day: date, *, hourly: list[str], daily: list[str], current: list[str]) -> dict[str, str]:
    iso = day.isoformat()
    return {
        "latitude": str(LAT),
        "longitude": str(LON),
        "timezone": TIMEZONE,
        "start_date": iso,
        "end_date": iso,
        "hourly": ",".join(hourly),
        "daily": ",".join(daily),
        "current": ",".join(current),
    }


def fetch_day_raw(day: date) -> tuple[dict[str, Any], dict[str, Any]]:
    marine = fetch_json(
        f"{MARINE_URL}?{urlencode({**api_params(day, hourly=MARINE_HOURLY, daily=MARINE_DAILY, current=MARINE_CURRENT), 'cell_selection': 'sea'})}"
    )
    weather = fetch_json(
        f"{WEATHER_URL}?{urlencode(api_params(day, hourly=WEATHER_HOURLY, daily=WEATHER_DAILY, current=WEATHER_CURRENT))}"
    )
    return marine, weather


def weather_index_by_time(weather_hourly: dict[str, Any]) -> dict[str, int]:
    times = weather_hourly.get("time") or []
    return {str(t): i for i, t in enumerate(times)}


def build_hours(
    day: date,
    marine: dict[str, Any],
    weather: dict[str, Any],
) -> list[dict[str, Any]]:
    marine_hourly = marine.get("hourly") or {}
    weather_hourly = weather.get("hourly") or {}
    marine_times = marine_hourly.get("time") or []
    weather_by_time = weather_index_by_time(weather_hourly)
    prefix = day.isoformat()
    hours: list[dict[str, Any]] = []

    for i, time_str in enumerate(marine_times):
        if not str(time_str).startswith(prefix):
            continue

        wi = weather_by_time.get(str(time_str))
        wave_height = num(hourly_val(marine_hourly, "wave_height", i))
        swell_height = num(hourly_val(marine_hourly, "swell_wave_height", i))
        wind_speed = num(hourly_val(weather_hourly, "wind_speed_10m", wi)) if wi is not None else None
        wind_direction = (
            num(hourly_val(weather_hourly, "wind_direction_10m", wi)) if wi is not None else None
        )
        wind_gusts = num(hourly_val(weather_hourly, "wind_gusts_10m", wi)) if wi is not None else None

        score = None
        if None not in (wave_height, swell_height, wind_speed, wind_direction):
            score = calculate_black_sea_score(
                {
                    "waveHeight": wave_height,
                    "wavePeriod": hourly_val(marine_hourly, "wave_period", i),
                    "swellHeight": swell_height,
                    "swellDirection": hourly_val(marine_hourly, "swell_wave_direction", i),
                    "swellPeriod": hourly_val(marine_hourly, "swell_wave_period", i),
                },
                {
                    "speed": wind_speed,
                    "direction": wind_direction,
                    "gusts": wind_gusts if wind_gusts is not None else wind_speed,
                },
            )

        hours.append(
            {
                "time": time_str,
                "score": score,
                "marine": {
                    "waveHeight": wave_height,
                    "waveDirection": hourly_val(marine_hourly, "wave_direction", i),
                    "wavePeriod": num(hourly_val(marine_hourly, "wave_period", i)),
                    "swellHeight": swell_height,
                    "swellDirection": hourly_val(marine_hourly, "swell_wave_direction", i),
                    "swellPeriod": num(hourly_val(marine_hourly, "swell_wave_period", i)),
                    "swellPeakPeriod": num(hourly_val(marine_hourly, "swell_wave_peak_period", i)),
                    "windWaveHeight": hourly_val(marine_hourly, "wind_wave_height", i),
                    "windWaveDirection": hourly_val(marine_hourly, "wind_wave_direction", i),
                    "seaSurfaceTemperature": hourly_val(marine_hourly, "sea_surface_temperature", i),
                },
                "weather": {
                    "windSpeed": wind_speed,
                    "windDirection": wind_direction,
                    "windGusts": wind_gusts,
                    "temperature": num(hourly_val(weather_hourly, "temperature_2m", wi))
                    if wi is not None
                    else None,
                    "weatherCode": num(hourly_val(weather_hourly, "weather_code", wi))
                    if wi is not None
                    else None,
                    "isDay": hourly_val(weather_hourly, "is_day", wi) == 1 if wi is not None else None,
                },
            }
        )

    return hours


def build_daily_slice(day: date, marine: dict[str, Any], weather: dict[str, Any]) -> dict[str, Any] | None:
    marine_daily = marine.get("daily") or {}
    weather_daily = weather.get("daily") or {}
    times = marine_daily.get("time") or []
    iso = day.isoformat()

    try:
        i = times.index(iso)
    except ValueError:
        return None

    wave_height_max = num(daily_val(marine_daily, "wave_height_max", i))
    swell_height_max = num(daily_val(marine_daily, "swell_wave_height_max", i))
    wind_speed_max = num(daily_val(weather_daily, "wind_speed_10m_max", i))
    wind_direction_dominant = num(daily_val(weather_daily, "wind_direction_10m_dominant", i))

    score = None
    if None not in (wave_height_max, swell_height_max, wind_speed_max, wind_direction_dominant):
        score = calculate_black_sea_score(
            {
                "waveHeight": wave_height_max,
                "wavePeriod": daily_val(marine_daily, "wave_period_max", i),
                "swellHeight": swell_height_max,
                "swellDirection": daily_val(marine_daily, "swell_wave_direction_dominant", i),
                "swellPeriod": daily_val(marine_daily, "swell_wave_period_max", i),
            },
            {
                "speed": wind_speed_max,
                "direction": wind_direction_dominant,
                "gusts": wind_speed_max,
            },
        )

    return {
        "time": iso,
        "label": format_ro_date(day),
        "score": score,
        "marine": {key: daily_val(marine_daily, key, i) for key in MARINE_DAILY},
        "weather": {key: daily_val(weather_daily, key, i) for key in WEATHER_DAILY},
    }


def build_payload(day: date, marine: dict[str, Any], weather: dict[str, Any]) -> dict[str, Any]:
    hours = build_hours(day, marine, weather)
    sea_temps = [num(h["marine"].get("seaSurfaceTemperature")) for h in hours]
    sea_temps = [t for t in sea_temps if t is not None]

    return {
        "meta": {
            "date": day.isoformat(),
            "label": format_ro_date(day),
            "location": {
                "name": "Plaja Modern",
                "latitude": LAT,
                "longitude": LON,
                "timezone": TIMEZONE,
            },
            "fetchedAt": datetime.now(ZoneInfo(TIMEZONE)).isoformat(),
            "sources": [MARINE_URL, WEATHER_URL],
            "hourCount": len(hours),
            "seaSurfaceTempDay": round(sum(sea_temps) / len(sea_temps), 1) if sea_temps else None,
        },
        "marine": marine,
        "weather": weather,
        "processed": {
            "hours": hours,
            "daily": build_daily_slice(day, marine, weather),
        },
    }


def save_payload(day: date, payload: dict[str, Any], directory: Path | None = None) -> Path:
    out_dir = directory or Path.cwd()
    out_dir.mkdir(parents=True, exist_ok=True)
    suffix = secrets.token_hex(3)
    path = out_dir / f"{day.isoformat()}_{suffix}.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def main() -> int:
    day = pick_day()
    print(f"\nDescarc date pentru {day.isoformat()} ({format_ro_date(day)})…")

    try:
        marine, weather = fetch_day_raw(day)
    except (requests.RequestException, RuntimeError) as exc:
        print(f"Eroare la fetch: {exc}", file=sys.stderr)
        return 1

    payload = build_payload(day, marine, weather)
    path = save_payload(day, payload)
    print(f"Salvat: {path} ({payload['meta']['hourCount']} ore)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
