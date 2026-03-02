"""Protection endpoint: full safety check with AI alert."""

from fastapi import APIRouter, Depends
from app.api.models.device import FullCheckRequest, FullCheckResponse
from app.api.dependencies import get_protection_service
from app.services.protection_service import ProtectionService

router = APIRouter(prefix="/api/v1/protection", tags=["protection"])


@router.post("/full-check", response_model=FullCheckResponse)
def full_check(
    req: FullCheckRequest,
    svc: ProtectionService = Depends(get_protection_service),
):
    """
    Run a complete safety check for a protected person:
    all telco signals + risk score + Gemini natural-language alert.
    """
    result = svc.full_check(
        phone_number=req.phone_number,
        context=req.context.model_dump(),
    )
    return result
