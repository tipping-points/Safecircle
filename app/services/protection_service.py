"""
Protection service: risk scoring + behavioral analysis + Gemini alert.
"""

import logging
from app.adapters.nac_client import NaCClient
from app.adapters.ai_client import AIClient
from app.services.device_service import DeviceService
from app.services.location_service import LocationService
from app.services import behavioral_profile as bp

logger = logging.getLogger(__name__)

SIGNAL_WEIGHTS = {
    "sim_swapped":            25,
    "number_recycled":        15,
    "call_forwarding_active": 10,
    "tenure_days_new":        15,
    "outside_safe_zone":      20,
    "device_inactive":        15,
}

RISK_THRESHOLDS = {
    "SAFE":       (0,  29),
    "SUSPICIOUS": (30, 59),
    "HIGH_RISK":  (60, 84),
    "EMERGENCY":  (85, 100),
}


def _calculate_risk(signals: dict, behavioral_score: int = 0) -> tuple[int, str]:
    score = 0
    if signals.get("sim_swapped"):
        score += SIGNAL_WEIGHTS["sim_swapped"]
    if signals.get("number_recycled"):
        score += SIGNAL_WEIGHTS["number_recycled"]
    if signals.get("call_forwarding_active"):
        score += SIGNAL_WEIGHTS["call_forwarding_active"]
    if signals.get("tenure_days", 365) < 30:
        score += SIGNAL_WEIGHTS["tenure_days_new"]
    if signals.get("outside_safe_zone"):
        score += SIGNAL_WEIGHTS["outside_safe_zone"]
    if signals.get("device_inactive"):
        score += SIGNAL_WEIGHTS["device_inactive"]

    # Add behavioral anomaly score (max +30 points)
    score += behavioral_score
    score = min(score, 100)

    level = "SAFE"
    for label, (lo, hi) in RISK_THRESHOLDS.items():
        if lo <= score <= hi:
            level = label
            break

    return score, level


class ProtectionService:
    def __init__(self, nac: NaCClient, ai: AIClient):
        self._device_svc   = DeviceService(nac)
        self._location_svc = LocationService(nac)
        self._ai = ai

    def full_check(self, phone_number: str, context: dict) -> dict:
        # 1. Device signals
        device_signals = self._device_svc.get_full_device_signals(phone_number)

        # 2. Location + geofence (Kalman-smoothed)
        outside_safe_zone = False
        location_data: dict | None = None

        if context.get("expected_lat") is not None and context.get("expected_lon") is not None:
            geo = self._location_svc.check_geofence(
                phone_number=phone_number,
                latitude=context["expected_lat"],
                longitude=context["expected_lon"],
                radius_meters=context.get("radius_meters", 500),
            )
            outside_safe_zone = not geo["is_within_zone"]
            # Fetch smoothed location for behavioral analysis
            location_data = self._location_svc.get_current_location(phone_number)
        else:
            outside_safe_zone = device_signals["sim_swapped"]
            try:
                location_data = self._location_svc.get_current_location(phone_number)
            except Exception:
                pass

        # 3. Behavioral anomaly analysis
        lat = location_data["latitude"]  if location_data else None
        lon = location_data["longitude"] if location_data else None
        behavioral = bp.analyze(
            phone_number=phone_number,
            lat=lat,
            lon=lon,
            hour=context.get("hour", 12),
            minutes_inactive=device_signals.get("minutes_inactive", 0),
            tenure_days=device_signals.get("tenure_days", 365),
        )

        # 4. Compose signals dict
        signals = {
            "sim_swapped":            device_signals["sim_swapped"],
            "number_recycled":        device_signals["number_recycled"],
            "call_forwarding_active": device_signals["call_forwarding_active"],
            "tenure_days":            device_signals["tenure_days"],
            "is_verified":            device_signals["is_verified"],
            "outside_safe_zone":      outside_safe_zone,
            "device_inactive":        device_signals["device_inactive"],
        }

        # 5. Score (telco + behavioral)
        risk_score, risk_level = _calculate_risk(signals, behavioral["anomaly_score"])

        # 6. Build enriched context for Gemini (include behavioral reasons)
        ai_context = dict(context)
        if behavioral["anomaly_reasons"]:
            ai_context["behavioral_anomalies"] = "; ".join(behavioral["anomaly_reasons"])
        if lat:
            ai_context["distance_from_home_km"] = behavioral["distance_km"]

        # 7. Gemini alert
        ai_alert, recommendation = self._ai.generate_alert(
            phone_number=phone_number,
            signals=signals,
            risk_score=risk_score,
            risk_level=risk_level,
            context=ai_context,
        )

        return {
            "phone_number":  phone_number,
            "risk_score":    risk_score,
            "risk_level":    risk_level,
            "signals":       signals,
            "behavioral":    {
                "anomaly_score":   behavioral["anomaly_score"],
                "anomaly_reasons": behavioral["anomaly_reasons"],
                "nearest_anchor":  behavioral["nearest_anchor"],
                "distance_km":     behavioral["distance_km"],
            },
            "ai_alert":      ai_alert,
            "recommendation":recommendation,
        }
