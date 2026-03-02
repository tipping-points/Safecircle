"""Health check endpoint."""

from fastapi import APIRouter
from app.config import settings
from app.adapters.nac_client import get_nac_client

router = APIRouter(tags=["health"])


@router.get("/health")
def health_check():
    """Service health + Nokia NaC connection status."""
    nac = get_nac_client()
    return {
        "status": "ok",
        "version": settings.VERSION,
        "environment": settings.ENVIRONMENT,
        "nac_mode": nac.mode,
        "ai_configured": bool(settings.GEMINI_API_KEY),
    }
