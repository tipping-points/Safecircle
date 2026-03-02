"""Pydantic models for device and protection endpoints."""

from typing import Optional
from pydantic import BaseModel, Field


class DeviceStatus(BaseModel):
    phone_number: str
    is_reachable: bool
    last_seen: str
    minutes_inactive: int


class SignalsDetail(BaseModel):
    sim_swapped: bool
    number_recycled: bool
    call_forwarding_active: bool
    tenure_days: int
    is_verified: bool
    outside_safe_zone: bool
    device_inactive: bool


class BehavioralDetail(BaseModel):
    anomaly_score:   int
    anomaly_reasons: list[str]
    nearest_anchor:  str
    distance_km:     float


class ProtectionContext(BaseModel):
    expected_zone: str = Field("home", example="home")
    hour: int = Field(12, example=22)
    day_type: str = Field("weekday", example="weekday")
    expected_lat: Optional[float] = Field(None, example=41.3851)
    expected_lon: Optional[float] = Field(None, example=2.1734)
    radius_meters: float = Field(500.0, example=500)


class FullCheckRequest(BaseModel):
    phone_number: str = Field(..., example="+34629123456")
    context: ProtectionContext = Field(default_factory=ProtectionContext)


class FullCheckResponse(BaseModel):
    phone_number: str
    risk_score:   int
    risk_level:   str
    signals:      SignalsDetail
    behavioral:   Optional[BehavioralDetail] = None
    ai_alert:     str
    recommendation: str
