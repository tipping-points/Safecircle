"""Device status endpoint."""

from fastapi import APIRouter, Depends
from app.api.models.device import DeviceStatus
from app.api.dependencies import get_device_service
from app.services.device_service import DeviceService

router = APIRouter(prefix="/api/v1/device", tags=["device"])


@router.get("/status/{phone_number}", response_model=DeviceStatus)
def get_device_status(
    phone_number: str,
    svc: DeviceService = Depends(get_device_service),
):
    """Get connectivity status and inactivity info for a device."""
    return svc.get_device_status(phone_number)
