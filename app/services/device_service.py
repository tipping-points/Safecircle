"""
Device service: connectivity status, SIM swap detection, and tenure.
"""

import logging
from datetime import datetime, timezone, timedelta
from app.adapters.nac_client import NaCClient

logger = logging.getLogger(__name__)


class DeviceService:
    def __init__(self, nac: NaCClient):
        self._nac = nac

    def get_device_status(self, phone_number: str) -> dict:
        """Return connectivity status and inactivity info for a device."""
        device = self._nac.get_device(phone_number)
        status = device.get_connectivity_status()

        minutes_inactive = status["minutes_inactive"]
        last_seen = datetime.now(timezone.utc) - timedelta(minutes=minutes_inactive)

        return {
            "phone_number": phone_number,
            "is_reachable": status["is_reachable"],
            "last_seen": last_seen.isoformat(),
            "minutes_inactive": minutes_inactive,
        }

    def get_full_device_signals(self, phone_number: str) -> dict:
        """
        Collect all device-level telco signals in one call.
        Used by the protection service for the full-check endpoint.
        """
        device = self._nac.get_device(phone_number)

        swap = device.verify_device_swap(max_age=24)
        tenure = device.get_sim_tenure()
        verification = device.verify_number()
        forwarding = device.check_call_forwarding()
        connectivity = device.get_connectivity_status()

        tenure_days = tenure["tenure_days"]
        minutes_inactive = connectivity["minutes_inactive"]

        return {
            "sim_swapped": swap["sim_swapped"],
            "number_recycled": tenure_days < 30 and not swap["sim_swapped"],
            "call_forwarding_active": forwarding["call_forwarding_active"],
            "tenure_days": tenure_days,
            "is_verified": verification["is_verified"],
            "is_reachable": connectivity["is_reachable"],
            "minutes_inactive": minutes_inactive,
            "device_inactive": minutes_inactive > 30,
        }
