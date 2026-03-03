"""
SafeCircle Agent endpoint — Gemini AI + Nokia NaC MCP tools via SSE streaming.

Streams a step-by-step agentic analysis:
  1. Gemini decides which Nokia NaC tools to call
  2. Each tool call is executed against the real CAMARA API
  3. Results are fed back to Gemini
  4. Final risk synthesis in Spanish is returned

Frontend receives a Server-Sent Events stream and renders each step live.
"""

import json
import logging
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.adapters.nac_client import NaCClient
from app.adapters.ai_client import get_ai_client
from app.api.dependencies import get_nac_client
from app.services.location_service import LocationService
from app.services.device_service import DeviceService
from app.mcp.server import TOOLS

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/agent", tags=["agent"])


class AgentRequest(BaseModel):
    phone_number: str
    question:     str   = "¿Está esta persona en peligro?"
    person_name:  str   = "la persona protegida"
    expected_lat: float = 41.3885
    expected_lon: float = 2.1781
    radius_meters: float = 350.0


# ── Tool executor ─────────────────────────────────────────────────────────────

class ToolExecutor:
    """Runs MCP tools against real Nokia NaC APIs. Caches per-request."""

    def __init__(self, nac: NaCClient, req: AgentRequest):
        self._nac      = nac
        self._req      = req
        self._dev_svc  = DeviceService(nac)
        self._loc_svc  = LocationService(nac)
        self._signals  = None   # cached device signals
        self._location = None   # cached location

    def _signals_cache(self):
        if self._signals is None:
            self._signals = self._dev_svc.get_full_device_signals(self._req.phone_number)
        return self._signals

    def _location_cache(self):
        if self._location is None:
            self._location = self._loc_svc.get_current_location(self._req.phone_number)
        return self._location

    def run(self, name: str, args: dict) -> dict:
        phone = args.get("phone_number", self._req.phone_number)
        try:
            if name == "check_sim_swap":
                s = self._signals_cache()
                return {
                    "sim_swapped":      s["sim_swapped"],
                    "tenure_days":      s["tenure_days"],
                    "number_recycled":  s["number_recycled"],
                }

            elif name == "get_location":
                loc = self._location_cache()
                return {
                    "latitude":        round(loc["latitude"], 5),
                    "longitude":       round(loc["longitude"], 5),
                    "accuracy_meters": loc["accuracy_meters"],
                    "kalman_readings": loc.get("kalman_readings", 0),
                }

            elif name == "check_geofence":
                lat    = args.get("expected_lat",   self._req.expected_lat)
                lon    = args.get("expected_lon",   self._req.expected_lon)
                radius = args.get("radius_meters",  self._req.radius_meters)
                geo = self._loc_svc.check_geofence(phone, lat, lon, radius, "Zona segura")
                return {
                    "is_within_zone":  geo["is_within_zone"],
                    "distance_meters": round(geo["distance_meters"]),
                    "zone_label":      geo["zone_label"],
                }

            elif name == "check_call_forwarding":
                s = self._signals_cache()
                return {
                    "call_forwarding_active": s["call_forwarding_active"],
                    "is_verified":            s["is_verified"],
                }

            elif name == "check_reachability":
                s = self._signals_cache()
                return {
                    "is_reachable":    not s["device_inactive"],
                    "device_inactive": s["device_inactive"],
                }

        except Exception as e:
            logger.error(f"Tool {name} error: {e}")
            return {"error": str(e)}

        return {"error": f"unknown tool: {name}"}


# ── SSE helpers ──────────────────────────────────────────────────────────────

def _sse(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


# ── Agentic streaming loop ────────────────────────────────────────────────────

def _agent_generator(req: AgentRequest, nac: NaCClient):
    """
    Generator that yields SSE events for the agentic analysis loop.

    Event types:
      thinking   — Gemini deciding next step
      tool_call  — Nokia NaC CAMARA API being called
      tool_result— API response received
      final      — Gemini synthesis
      error      — Something went wrong
    """
    ai = get_ai_client()
    executor = ToolExecutor(nac, req)

    yield _sse({"type": "thinking", "text": "Iniciando análisis con Nokia Network as Code + Gemini AI…"})

    # ── Build Gemini tools from MCP definitions ──────────────────────────────
    if ai._client is None:
        # No Gemini — run all tools manually and show a mock synthesis
        yield from _fallback_agent(req, executor)
        return

    try:
        from google.genai import types as gtypes

        # Convert MCP tool definitions to Gemini FunctionDeclarations
        fn_decls = []
        for t in TOOLS:
            props = {}
            for pname, pdef in t["parameters"].get("properties", {}).items():
                ptype = pdef.get("type", "string").upper()
                gtype = getattr(gtypes.Type, ptype, gtypes.Type.STRING)
                props[pname] = gtypes.Schema(
                    type=gtype,
                    description=pdef.get("description", ""),
                )
            fn_decls.append(gtypes.FunctionDeclaration(
                name=t["name"],
                description=t["description"],
                parameters=gtypes.Schema(
                    type=gtypes.Type.OBJECT,
                    properties=props,
                    required=t["parameters"].get("required", []),
                ),
            ))

        gemini_tools  = gtypes.Tool(function_declarations=fn_decls)
        agent_config  = gtypes.GenerateContentConfig(
            system_instruction=(
                f"Eres SafeCircle, un agente experto en seguridad familiar. "
                f"Analiza el teléfono {req.phone_number} ({req.person_name}) usando TODAS las herramientas. "
                f"Zona segura: lat={req.expected_lat}, lon={req.expected_lon}, radio={req.radius_meters}m. "
                f"Llama primero check_sim_swap, luego get_location, check_geofence, "
                f"check_call_forwarding y check_reachability. "
                f"Finalmente sintetiza el riesgo en 3-4 frases en español claro para una familia no técnica."
            ),
            tools=[gemini_tools],
        )

        contents = [
            gtypes.Content(role="user", parts=[
                gtypes.Part(text=f"{req.question} Teléfono: {req.phone_number}")
            ])
        ]

        # ── Agentic loop (max 8 rounds) ──────────────────────────────────────
        tool_counter = 0
        for _round in range(8):
            yield _sse({"type": "thinking", "text": "Gemini consultando siguiente señal…"})

            response = ai._client.models.generate_content(
                model="gemini-2.5-flash",
                contents=contents,
                config=agent_config,
            )

            candidate = response.candidates[0]
            parts     = candidate.content.parts

            fn_calls  = [p for p in parts if p.function_call is not None]
            text_parts = [p for p in parts if getattr(p, "text", None)]

            if fn_calls:
                # Append model message to history
                contents.append(candidate.content)
                fn_responses = []

                for p in fn_calls:
                    fc = p.function_call
                    tool_counter += 1
                    tid = f"t{tool_counter}"

                    yield _sse({
                        "type": "tool_call",
                        "id":   tid,
                        "tool": fc.name,
                        "args": dict(fc.args),
                    })

                    result = executor.run(fc.name, dict(fc.args))

                    yield _sse({
                        "type": "tool_result",
                        "id":   tid,
                        "tool": fc.name,
                        "ok":   "error" not in result,
                        "data": result,
                    })

                    fn_responses.append(
                        gtypes.Part(function_response=gtypes.FunctionResponse(
                            name=fc.name, response=result
                        ))
                    )

                contents.append(
                    gtypes.Content(role="user", parts=fn_responses)
                )

            elif text_parts:
                final_text = " ".join(p.text for p in text_parts).strip()
                yield _sse({"type": "final", "text": final_text})
                yield "data: [DONE]\n\n"
                return

            else:
                break

        yield _sse({"type": "error", "text": "El agente no pudo completar el análisis."})
        yield "data: [DONE]\n\n"

    except Exception as e:
        logger.error(f"Agent loop error: {e}", exc_info=True)
        yield _sse({"type": "error", "text": f"Error en el agente: {e}"})
        yield "data: [DONE]\n\n"


def _fallback_agent(req: AgentRequest, executor: ToolExecutor):
    """Run all tools sequentially without Gemini function calling (no API key)."""
    tool_counter = 0
    all_results  = {}

    ordered_tools = [
        ("check_sim_swap",       {"phone_number": req.phone_number}),
        ("get_location",         {"phone_number": req.phone_number}),
        ("check_geofence",       {"phone_number": req.phone_number,
                                  "expected_lat": req.expected_lat,
                                  "expected_lon": req.expected_lon,
                                  "radius_meters": req.radius_meters}),
        ("check_call_forwarding",{"phone_number": req.phone_number}),
        ("check_reachability",   {"phone_number": req.phone_number}),
    ]

    for tool_name, args in ordered_tools:
        tool_counter += 1
        tid = f"t{tool_counter}"
        yield _sse({"type": "tool_call", "id": tid, "tool": tool_name, "args": args})
        result = executor.run(tool_name, args)
        all_results[tool_name] = result
        yield _sse({"type": "tool_result", "id": tid, "tool": tool_name,
                    "ok": "error" not in result, "data": result})

    # Simple synthesis without Gemini
    risks = []
    if all_results.get("check_sim_swap", {}).get("sim_swapped"):
        risks.append("cambio de SIM reciente detectado")
    if not all_results.get("check_geofence", {}).get("is_within_zone", True):
        dist = all_results["check_geofence"].get("distance_meters", 0)
        risks.append(f"fuera de zona segura ({dist}m)")
    if all_results.get("check_call_forwarding", {}).get("call_forwarding_active"):
        risks.append("desvío de llamadas activo")
    if all_results.get("check_reachability", {}).get("device_inactive"):
        risks.append("dispositivo inactivo")

    if risks:
        text = f"⚠️ Se han detectado señales de riesgo: {', '.join(risks)}. Revisa la situación."
    else:
        text = "✅ Todas las señales Nokia NaC son normales. La persona protegida está segura."

    yield _sse({"type": "final", "text": text})
    yield "data: [DONE]\n\n"


# ── Endpoint ─────────────────────────────────────────────────────────────────

@router.post("/stream")
def agent_stream(
    req: AgentRequest,
    nac: NaCClient = Depends(get_nac_client),
):
    """
    Stream a Gemini-powered agentic analysis using Nokia NaC MCP tools.
    Returns Server-Sent Events (text/event-stream).
    """
    return StreamingResponse(
        _agent_generator(req, nac),
        media_type="text/event-stream",
        headers={
            "Cache-Control":  "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
