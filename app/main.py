"""
SafeCircle API — FastAPI application entry point.
Family protection powered by Nokia Network as Code + Gemini AI.
"""

import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.api.routes import health_router, location_router, device_router, protection_router

logging.basicConfig(
    level=settings.LOG_LEVEL,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.VERSION,
    description=(
        "SafeCircle — Family protection API using Nokia Network as Code CAMARA APIs "
        "and Gemini AI for intelligent, contextualized alerts."
    ),
    contact={"name": "SafeCircle Team", "email": "team@safecircle.dev"},
    license_info={"name": "MIT"},
)

# CORS
origins = [o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(health_router)
app.include_router(location_router)
app.include_router(device_router)
app.include_router(protection_router)


@app.on_event("startup")
async def startup_event():
    logger.info(f"Starting {settings.APP_NAME} v{settings.VERSION}")
    logger.info(f"Environment: {settings.ENVIRONMENT}")
    logger.info(f"Nokia NaC mode: {'MOCK' if settings.USE_MOCK else 'REAL'}")
    logger.info(f"Gemini AI: {'configured' if settings.GEMINI_API_KEY else 'not configured (mock alerts)'}")


@app.on_event("shutdown")
async def shutdown_event():
    logger.info("SafeCircle API shutting down")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=settings.API_HOST,
        port=settings.API_PORT,
        reload=settings.API_RELOAD,
    )
