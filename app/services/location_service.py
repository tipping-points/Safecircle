"""
Location service: current position + geofence verification.
Nokia locations are smoothed with a per-device Kalman filter to eliminate
cell-tower jumping noise before being returned to the API or frontend.
"""

import logging
from datetime import datetime, timezone
from app.adapters.nac_client import NaCClient
from app.services.kalman import smooth_location

logger = logging.getLogger(__name__)


class LocationService:
    def __init__(self, nac: NaCClient):
        self._nac = nac

    def get_current_location(self, phone_number: str) -> dict:
        """Return the Kalman-smoothed network-based location for a device."""
        device = self._nac.get_device(phone_number)
        raw = device.get_location()

        # Apply Kalman filter to reduce cell-tower jumping
        smoothed = smooth_location(
            phone_number=phone_number,
            lat=raw["latitude"],
            lon=raw["longitude"],
            accuracy_meters=raw.get("accuracy_meters", 1000),
        )

        return {
            "phone_number":       phone_number,
            "latitude":           smoothed["latitude"],
            "longitude":          smoothed["longitude"],
            "raw_latitude":       smoothed["raw_latitude"],
            "raw_longitude":      smoothed["raw_longitude"],
            "accuracy_meters":    smoothed["accuracy_meters"],
            "raw_accuracy_meters":smoothed["raw_accuracy_meters"],
            "kalman_confidence":  smoothed["kalman_confidence"],
            "kalman_readings":    smoothed["kalman_readings"],
            "timestamp":          datetime.now(timezone.utc).isoformat(),
            "source":             raw["source"],
        }

    def check_geofence(
        self,
        phone_number: str,
        latitude: float,
        longitude: float,
        radius_meters: float,
        zone_label: str = "Zona segura",
    ) -> dict:
        """Verify whether a device is within a defined safe zone.
        Uses Kalman-smoothed position for the check."""
        loc = self.get_current_location(phone_number)
        dlat = (loc["latitude"] - latitude) * 111_000
        dlon = (loc["longitude"] - longitude) * 111_000 * 0.7
        distance = (dlat**2 + dlon**2) ** 0.5
        return {
            "phone_number":   phone_number,
            "is_within_zone": distance <= radius_meters,
            "distance_meters": round(distance, 1),
            "zone_label":     zone_label,
        }
