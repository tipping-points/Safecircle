"""
FastAPI dependency injection functions.
"""

from app.adapters.nac_client import NaCClient, get_nac_client
from app.adapters.ai_client import AIClient, get_ai_client
from app.services.location_service import LocationService
from app.services.device_service import DeviceService
from app.services.protection_service import ProtectionService


def get_location_service() -> LocationService:
    return LocationService(nac=get_nac_client())


def get_device_service() -> DeviceService:
    return DeviceService(nac=get_nac_client())


def get_protection_service() -> ProtectionService:
    return ProtectionService(nac=get_nac_client(), ai=get_ai_client())


__all__ = [
    "get_nac_client",
    "get_ai_client",
    "get_location_service",
    "get_device_service",
    "get_protection_service",
]
