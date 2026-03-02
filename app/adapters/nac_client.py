"""
Nokia Network as Code adapter.
Wraps the real SDK with a full mock fallback for development/testing.

Mock rules:
  - +34900/901/902 numbers  → sim_swapped=True, tenure_days=5
  - Foreign numbers (+1, +44, etc.) → outside_zone=True, tenure_days=10
  - Normal +34[6-7]XXXXXXXX  → all safe, tenure=365 days
"""

import random
import logging
from datetime import datetime, timezone
from app.config import settings

logger = logging.getLogger(__name__)

# Barcelona and Madrid reference coordinates for mock
_MOCK_LOCATIONS = [
    {"lat": 41.3851, "lon": 2.1734, "city": "Barcelona"},
    {"lat": 40.4168, "lon": -3.7038, "city": "Madrid"},
    {"lat": 41.6488, "lon": -0.8891, "city": "Zaragoza"},
]


def _is_suspicious_number(phone: str) -> bool:
    """Detect +34900/901/902 numbers."""
    return phone.startswith("+34900") or phone.startswith("+34901") or phone.startswith("+34902")


def _is_foreign_number(phone: str) -> bool:
    """Detect non-Spanish numbers."""
    return not phone.startswith("+34")


class MockNaCDevice:
    """Mock device that simulates Nokia NaC SDK responses."""

    def __init__(self, phone_number: str):
        self.phone_number = phone_number
        self._suspicious = _is_suspicious_number(phone_number)
        self._foreign = _is_foreign_number(phone_number)
        # Deterministic seed for stable responses per number
        self._seed = sum(ord(c) for c in phone_number)

    def get_location(self) -> dict:
        rng = random.Random(self._seed)
        base = rng.choice(_MOCK_LOCATIONS)
        # Add small jitter (up to ~500m)
        lat_jitter = rng.uniform(-0.003, 0.003)
        lon_jitter = rng.uniform(-0.003, 0.003)
        if self._foreign:
            # Foreign device reported far away
            return {
                "latitude": 48.8566,
                "longitude": 2.3522,
                "accuracy_meters": 200,
                "source": "network",
            }
        return {
            "latitude": round(base["lat"] + lat_jitter, 6),
            "longitude": round(base["lon"] + lon_jitter, 6),
            "accuracy_meters": 50 if not self._suspicious else 150,
            "source": "network",
        }

    def verify_location(self, latitude: float, longitude: float, radius_meters: float) -> dict:
        loc = self.get_location()
        # Simple Euclidean approximation (fine for small distances)
        dlat = (loc["latitude"] - latitude) * 111_000
        dlon = (loc["longitude"] - longitude) * 111_000 * 0.7  # approx cos(41°)
        distance = (dlat**2 + dlon**2) ** 0.5
        return {
            "is_within_zone": distance <= radius_meters,
            "distance_meters": round(distance, 1),
        }

    def get_connectivity_status(self) -> dict:
        if self._suspicious:
            return {"is_reachable": False, "minutes_inactive": 45}
        if self._foreign:
            return {"is_reachable": True, "minutes_inactive": 5}
        rng = random.Random(self._seed + 1)
        inactive = rng.randint(0, 10)
        return {"is_reachable": True, "minutes_inactive": inactive}

    def verify_device_swap(self, max_age: int = 24) -> dict:
        return {"sim_swapped": self._suspicious}

    def get_sim_tenure(self) -> dict:
        if self._suspicious:
            return {"tenure_days": 5}
        if self._foreign:
            return {"tenure_days": 10}
        return {"tenure_days": 365}

    def verify_number(self) -> dict:
        return {"is_verified": not self._suspicious}

    def check_call_forwarding(self) -> dict:
        return {"call_forwarding_active": self._suspicious}


class RealNaCDevice:
    """Wraps the real Nokia NaC SDK device object."""

    def __init__(self, sdk_device):
        self._device = sdk_device

    def get_location(self) -> dict:
        loc = self._device.location(max_age=600)
        return {
            "latitude": loc.latitude,
            "longitude": loc.longitude,
            "accuracy_meters": int(getattr(loc, "radius", 100)),
            "source": "network",
        }

    def verify_location(self, latitude: float, longitude: float, radius_meters: float) -> dict:
        # Compute distance from last known location
        loc = self._device.location(max_age=600)
        dlat = (loc.latitude - latitude) * 111_000
        dlon = (loc.longitude - longitude) * 111_000 * 0.7
        dist = (dlat**2 + dlon**2) ** 0.5
        return {"is_within_zone": dist <= radius_meters, "distance_meters": round(dist, 1)}

    def get_connectivity_status(self) -> dict:
        try:
            reach = self._device.get_reachability()
            return {"is_reachable": bool(reach.reachable), "minutes_inactive": 0}
        except Exception:
            return {"is_reachable": True, "minutes_inactive": 0}

    def verify_device_swap(self, max_age: int = 24) -> dict:
        try:
            swapped = self._device.verify_sim_swap(max_age=max_age * 60)
            return {"sim_swapped": bool(swapped)}
        except Exception:
            return {"sim_swapped": False}

    def get_sim_tenure(self) -> dict:
        try:
            date = self._device.get_sim_swap_date()
            if date:
                from datetime import datetime, timezone
                days = (datetime.now(timezone.utc) - date).days
                return {"tenure_days": max(0, days)}
        except Exception:
            pass
        return {"tenure_days": 365}

    def verify_number(self) -> dict:
        try:
            result = self._device.verify_number()
            return {"is_verified": bool(getattr(result, "verified", True))}
        except Exception:
            return {"is_verified": True}

    def check_call_forwarding(self) -> dict:
        try:
            active = self._device.verify_unconditional_forwarding()
            return {"call_forwarding_active": bool(active)}
        except Exception:
            return {"call_forwarding_active": False}


class NaCClient:
    """
    Nokia Network as Code client.
    Automatically uses mock or real SDK based on settings.USE_MOCK.
    """

    def __init__(self):
        self.use_mock = settings.USE_MOCK
        self._sdk_client = None

        if not self.use_mock:
            try:
                import network_as_code as nac
                self._sdk_client = nac.NetworkAsCodeClient(token=settings.NAC_TOKEN)
                logger.info("Nokia NaC SDK initialized (real mode)")
            except Exception as e:
                logger.warning(f"Failed to init Nokia NaC SDK, falling back to mock: {e}")
                self.use_mock = True

        if self.use_mock:
            logger.info("Nokia NaC running in MOCK mode")

    def get_device(self, phone_number: str):
        """Return a device object (mock or real) for the given phone number.
        Falls back to mock automatically if Nokia rejects the number."""
        if self.use_mock:
            return MockNaCDevice(phone_number)
        try:
            sdk_device = self._sdk_client.devices.get(phone_number=phone_number)
            # Probe with a cheap call to detect invalid numbers early
            sdk_device.location(max_age=600)
            return RealNaCDevice(sdk_device)
        except Exception as e:
            logger.warning(f"Nokia NaC rejected {phone_number}, using mock: {e}")
            return MockNaCDevice(phone_number)

    @property
    def mode(self) -> str:
        return "mock" if self.use_mock else "real"


# Singleton instance
_nac_client: NaCClient | None = None


def get_nac_client() -> NaCClient:
    """Return the singleton NaCClient instance."""
    global _nac_client
    if _nac_client is None:
        _nac_client = NaCClient()
    return _nac_client
