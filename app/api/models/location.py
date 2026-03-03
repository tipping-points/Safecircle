"""Pydantic models for location endpoints."""

from pydantic import BaseModel, Field


class LocationResponse(BaseModel):
    phone_number: str
    latitude: float
    longitude: float
    accuracy_meters: int
    timestamp: str
    source: str
    kalman_confidence: float = 0.0
    kalman_readings: int = 0


class GeofenceRequest(BaseModel):
    phone_number: str = Field(..., example="+34629123456")
    latitude: float = Field(..., example=41.3851)
    longitude: float = Field(..., example=2.1734)
    radius_meters: float = Field(200.0, example=200)
    zone_label: str = Field("Casa", example="Casa")


class GeofenceResponse(BaseModel):
    phone_number: str
    is_within_zone: bool
    distance_meters: float
    zone_label: str
