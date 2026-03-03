"""
Behavioral profile & anomaly detection service.

Learns (via simulated historical data) what is "normal" for each protected
person and scores deviations. The anomaly score is added on top of the
telco-signal risk score in protection_service.py.

Anomaly dimensions:
  1. Location: distance from typical home/routine locations
  2. Time: active at unusual hours (e.g. elderly person at 3am)
  3. Inactivity: device silent much longer than usual
  4. Zone pattern: out of all known locations simultaneously

For the hackathon we use curated profiles + simple statistical thresholds.
In production this would be trained on 30+ days of per-person history.
"""

import math
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


@dataclass
class BehaviorProfile:
    """Normal behavior baseline for a protected person."""
    name:            str
    # Typical anchor locations (home, work, usual spots)
    anchor_locations: list[dict] = field(default_factory=list)
    # Hours during which the person is normally active (inclusive)
    active_hours:    tuple[int, int] = (7, 22)
    # Max distance from any anchor considered "normal" (km)
    normal_radius_km: float = 2.0
    # Max minutes of inactivity before it's unusual
    normal_inactive_min: int = 60
    # Days since SIM was last changed — warn if lower
    min_tenure_days: int = 30


# ── Curated profiles ───────────────────────────────────────────────────────────
# Aitor: real hackathon SIM — anchor is current Nokia location (Fira BCN area)
# Manuel: teenager — wider range, active later
# Rosa: elderly — stays close to home, sleeps early
# Nokia simulators: minimal profile

PROFILES: dict[str, BehaviorProfile] = {
    "+34640197102": BehaviorProfile(
        name="Aitor",
        anchor_locations=[
            {"label": "Fira Montjuïc (Nokia NaC)", "lat": 41.3885, "lon": 2.1781},
        ],
        active_hours=(7, 22),
        normal_radius_km=0.6,
        normal_inactive_min=90,
        min_tenure_days=14,
    ),
    "+34629123456": BehaviorProfile(
        name="Manuel",
        anchor_locations=[
            {"label": "Casa", "lat": 41.3862, "lon": 2.1735},
            {"label": "Instituto", "lat": 41.3900, "lon": 2.1650},
        ],
        active_hours=(7, 23),    # teenager stays up later
        normal_radius_km=3.0,
        normal_inactive_min=45,
        min_tenure_days=30,
    ),
    "+34900123456": BehaviorProfile(
        name="Rosa",
        anchor_locations=[
            {"label": "Casa", "lat": 41.3851, "lon": 2.1734},
        ],
        active_hours=(8, 20),    # elderly — sleeps earlier
        normal_radius_km=1.0,    # rarely moves far
        normal_inactive_min=30,
        min_tenure_days=365,
    ),
}

# Nokia simulator numbers: use generic permissive profile
_DEFAULT_PROFILE = BehaviorProfile(
    name="Dispositivo",
    anchor_locations=[],
    active_hours=(0, 24),
    normal_radius_km=50.0,
    normal_inactive_min=120,
    min_tenure_days=1,
)


def _km_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Fast Euclidean distance approximation in km (accurate for <100 km)."""
    dlat = (lat1 - lat2) * 111.0
    dlon = (lon1 - lon2) * 111.0 * math.cos(math.radians((lat1 + lat2) / 2))
    return math.sqrt(dlat**2 + dlon**2)


def _distance_to_nearest_anchor(
    profile: BehaviorProfile, lat: float, lon: float
) -> tuple[float, str]:
    """Return (distance_km, anchor_label) for the nearest known location."""
    if not profile.anchor_locations:
        return 0.0, "desconocido"
    best_dist = float("inf")
    best_label = ""
    for anchor in profile.anchor_locations:
        d = _km_distance(lat, lon, anchor["lat"], anchor["lon"])
        if d < best_dist:
            best_dist = d
            best_label = anchor["label"]
    return best_dist, best_label


def analyze(
    phone_number: str,
    lat: float | None,
    lon: float | None,
    hour: int,
    minutes_inactive: int,
    tenure_days: int,
) -> dict:
    """
    Compute a behavioral anomaly score and human-readable reasons.

    Returns:
        {
          "anomaly_score":   int (0–30, added to telco risk score),
          "anomaly_reasons": list[str],  # human-readable, in Spanish
          "nearest_anchor":  str,
          "distance_km":     float,
          "profile_name":    str,
        }
    """
    profile = PROFILES.get(phone_number, _DEFAULT_PROFILE)
    reasons: list[str] = []
    score = 0

    # ── 1. Time anomaly ───────────────────────────────────────────────────────
    active_start, active_end = profile.active_hours
    is_night = not (active_start <= hour < active_end)
    if is_night:
        score += 10
        reasons.append(f"Activo a las {hour}:00h (fuera de horario habitual {active_start}–{active_end}h)")

    # ── 2. Location anomaly ───────────────────────────────────────────────────
    nearest_label = "N/A"
    distance_km = 0.0
    if lat is not None and lon is not None and profile.anchor_locations:
        distance_km, nearest_label = _distance_to_nearest_anchor(profile, lat, lon)
        if distance_km > profile.normal_radius_km * 3:
            score += 15
            reasons.append(
                f"A {distance_km:.1f}km de {nearest_label} "
                f"(radio habitual: {profile.normal_radius_km}km)"
            )
        elif distance_km > profile.normal_radius_km:
            score += 7
            reasons.append(f"Algo alejado de {nearest_label} ({distance_km:.1f}km)")

    # ── 3. Inactivity anomaly ─────────────────────────────────────────────────
    if minutes_inactive > profile.normal_inactive_min * 2:
        score += 10
        reasons.append(
            f"Sin actividad {minutes_inactive} min "
            f"(máx habitual: {profile.normal_inactive_min} min)"
        )
    elif minutes_inactive > profile.normal_inactive_min:
        score += 5
        reasons.append(f"Inactivo más de lo habitual ({minutes_inactive} min)")

    # ── 4. Combined night + far from home (high-risk combo) ──────────────────
    if is_night and distance_km > profile.normal_radius_km:
        score += 5   # extra penalty for night + displacement combo
        reasons.append("Combinación inusual: noche y fuera de zona")

    score = min(score, 30)

    logger.info(
        f"Behavioral analysis for {phone_number}: score={score}, "
        f"reasons={reasons}, dist={distance_km:.2f}km, hour={hour}"
    )

    return {
        "anomaly_score":   score,
        "anomaly_reasons": reasons,
        "nearest_anchor":  nearest_label,
        "distance_km":     round(distance_km, 2),
        "profile_name":    profile.name,
        "is_night_anomaly": is_night,
        "normal_radius_km": profile.normal_radius_km,
    }
