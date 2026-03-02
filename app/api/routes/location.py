"""Location endpoints: current position and geofence verification."""

from fastapi import APIRouter, Depends
from app.api.models.location import LocationResponse, GeofenceRequest, GeofenceResponse
from app.api.dependencies import get_location_service
from app.services.location_service import LocationService

router = APIRouter(prefix="/api/v1/location", tags=["location"])


@router.get("/current/{phone_number}", response_model=LocationResponse)
def get_current_location(
    phone_number: str,
    svc: LocationService = Depends(get_location_service),
):
    """Get the current network-based location of a device."""
    return svc.get_current_location(phone_number)


@router.post("/geofence/check", response_model=GeofenceResponse)
def check_geofence(
    req: GeofenceRequest,
    svc: LocationService = Depends(get_location_service),
):
    """Check whether a device is inside a defined safe zone."""
    return svc.check_geofence(
        phone_number=req.phone_number,
        latitude=req.latitude,
        longitude=req.longitude,
        radius_meters=req.radius_meters,
        zone_label=req.zone_label,
    )
