"""
Protection service: risk scoring + Gemini alert orchestration.
"""

import logging
from app.adapters.nac_client import NaCClient
from app.adapters.ai_client import AIClient
from app.services.device_service import DeviceService
from app.services.location_service import LocationService

logger = logging.getLogger(__name__)

SIGNAL_WEIGHTS = {
    "sim_swapped":            25,  # SIM change = high risk
    "number_recycled":        15,  # No history = suspicious
    "call_forwarding_active": 10,  # Active forwarding = unreachable
    "tenure_days_new":        15,  # <30 days = new profile
    "outside_safe_zone":      20,  # Out of zone = main alert
    "device_inactive":        15,  # No activity = concern
}

RISK_THRESHOLDS = {
    "SAFE":       (0, 29),
    "SUSPICIOUS": (30, 59),
    "HIGH_RISK":  (60, 84),
    "EMERGENCY":  (85, 100),
}


def _calculate_risk(signals: dict) -> tuple[int, str]:
    """Calculate a 0-100 risk score and its level label."""
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

    score = min(score, 100)

    level = "SAFE"
    for label, (lo, hi) in RISK_THRESHOLDS.items():
        if lo <= score <= hi:
            level = label
            break

    return score, level


class ProtectionService:
    def __init__(self, nac: NaCClient, ai: AIClient):
        self._device_svc = DeviceService(nac)
        self._location_svc = LocationService(nac)
        self._ai = ai

    def full_check(self, phone_number: str, context: dict) -> dict:
        """
        Run a complete safety check:
          1. Gather all telco signals (device + location)
          2. Calculate risk score
          3. Generate Gemini alert
        """
        # 1. Device signals
        device_signals = self._device_svc.get_full_device_signals(phone_number)

        # 2. Location: check against expected zone if provided
        outside_safe_zone = False
        if context.get("expected_lat") is not None and context.get("expected_lon") is not None:
            geo = self._location_svc.check_geofence(
                phone_number=phone_number,
                latitude=context["expected_lat"],
                longitude=context["expected_lon"],
                radius_meters=context.get("radius_meters", 500),
            )
            outside_safe_zone = not geo["is_within_zone"]
        elif context.get("expected_zone"):
            # Without explicit coords, use a heuristic: foreign numbers are always "outside"
            outside_safe_zone = not device_signals["is_reachable"] or device_signals["sim_swapped"]

        # 3. Compose signals dict for scoring + AI
        signals = {
            "sim_swapped": device_signals["sim_swapped"],
            "number_recycled": device_signals["number_recycled"],
            "call_forwarding_active": device_signals["call_forwarding_active"],
            "tenure_days": device_signals["tenure_days"],
            "is_verified": device_signals["is_verified"],
            "outside_safe_zone": outside_safe_zone,
            "device_inactive": device_signals["device_inactive"],
        }

        # 4. Score
        risk_score, risk_level = _calculate_risk(signals)

        # 5. AI alert
        ai_alert, recommendation = self._ai.generate_alert(
            phone_number=phone_number,
            signals=signals,
            risk_score=risk_score,
            risk_level=risk_level,
            context=context,
        )

        return {
            "phone_number": phone_number,
            "risk_score": risk_score,
            "risk_level": risk_level,
            "signals": signals,
            "ai_alert": ai_alert,
            "recommendation": recommendation,
        }
