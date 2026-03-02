"""
Location service: current position + geofence verification.
"""

import logging
from datetime import datetime, timezone
from app.adapters.nac_client import NaCClient

logger = logging.getLogger(__name__)


class LocationService:
    def __init__(self, nac: NaCClient):
        self._nac = nac

    def get_current_location(self, phone_number: str) -> dict:
        """Return the current network-based location for a device."""
        device = self._nac.get_device(phone_number)
        loc = device.get_location()
        return {
            "phone_number": phone_number,
            "latitude": loc["latitude"],
            "longitude": loc["longitude"],
            "accuracy_meters": loc["accuracy_meters"],
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "source": loc["source"],
        }

    def check_geofence(
        self,
        phone_number: str,
        latitude: float,
        longitude: float,
        radius_meters: float,
        zone_label: str = "Zona segura",
    ) -> dict:
        """Verify whether a device is within a defined safe zone."""
        device = self._nac.get_device(phone_number)
        result = device.verify_location(latitude, longitude, radius_meters)
        return {
            "phone_number": phone_number,
            "is_within_zone": result["is_within_zone"],
            "distance_meters": result["distance_meters"],
            "zone_label": zone_label,
        }
