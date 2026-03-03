"""
SafeCircle MCP Server — Nokia Network as Code tools.

Exposes CAMARA APIs as MCP-compatible tool definitions so any AI agent
(Gemini, Claude, etc.) can reason about family safety using real network signals.

Each tool maps 1-to-1 to a Nokia NaC CAMARA API:
  check_sim_swap       → SIM Swap API
  get_location         → Device Location API
  check_geofence       → Location Verification API
  check_call_forwarding→ Call Forwarding API
  check_reachability   → Device Reachability API
"""

# ── MCP Tool Definitions (CAMARA API surface) ───────────────────────────────

TOOLS = [
    {
        "name": "check_sim_swap",
        "description": (
            "Verifica si la SIM del dispositivo fue cambiada recientemente "
            "usando la CAMARA SIM Swap API de Nokia Network as Code. "
            "Detecta posibles fraudes de SIM swap."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "phone_number": {
                    "type": "string",
                    "description": "Número de teléfono en formato E.164 (ej. +34640197102)",
                },
                "max_age_hours": {
                    "type": "integer",
                    "description": "Ventana de tiempo en horas a comprobar (por defecto 24h)",
                    "default": 24,
                },
            },
            "required": ["phone_number"],
        },
    },
    {
        "name": "get_location",
        "description": (
            "Obtiene la ubicación actual del dispositivo mediante la red móvil "
            "(Nokia NaC Device Location API). No requiere GPS ni app instalada. "
            "Devuelve coordenadas suavizadas con filtro de Kalman."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "phone_number": {
                    "type": "string",
                    "description": "Número de teléfono en formato E.164",
                },
            },
            "required": ["phone_number"],
        },
    },
    {
        "name": "check_geofence",
        "description": (
            "Verifica si el dispositivo está dentro de una zona segura predefinida "
            "usando la CAMARA Location Verification API. "
            "Devuelve si está dentro y la distancia al centro de la zona."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "phone_number": {"type": "string"},
                "expected_lat":  {"type": "number", "description": "Latitud del centro de la zona"},
                "expected_lon":  {"type": "number", "description": "Longitud del centro de la zona"},
                "radius_meters": {"type": "number", "description": "Radio de la zona en metros"},
            },
            "required": ["phone_number", "expected_lat", "expected_lon"],
        },
    },
    {
        "name": "check_call_forwarding",
        "description": (
            "Detecta si hay desvío incondicional de llamadas activo "
            "usando la CAMARA Call Forwarding API. "
            "Un desvío activo puede indicar fraude telefónico."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "phone_number": {"type": "string"},
            },
            "required": ["phone_number"],
        },
    },
    {
        "name": "check_reachability",
        "description": (
            "Comprueba si el dispositivo está activo y conectado a la red móvil "
            "usando la CAMARA Device Reachability API. "
            "Detecta si el teléfono está apagado o sin cobertura."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "phone_number": {"type": "string"},
            },
            "required": ["phone_number"],
        },
    },
]

# Mapa rápido para lookup por nombre
TOOLS_BY_NAME = {t["name"]: t for t in TOOLS}
