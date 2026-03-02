from app.api.routes.health import router as health_router
from app.api.routes.location import router as location_router
from app.api.routes.device import router as device_router
from app.api.routes.protection import router as protection_router

__all__ = ["health_router", "location_router", "device_router", "protection_router"]
