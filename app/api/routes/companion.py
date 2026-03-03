"""
SafeCircle Companion AI — context-aware messages + scam detection.

Two capabilities:
  /analyze    — Nokia NaC signals → Gemini generates a companion message adapted to the
                person's profile (elderly / teenager). Uses CAMARA APIs for context.
  /scam-detect— Paste any suspicious text → Gemini classifies it as scam or safe.
"""

import logging
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.adapters.nac_client import NaCClient
from app.adapters.ai_client import get_ai_client
from app.api.dependencies import get_nac_client
from app.services.location_service import LocationService
from app.services.device_service import DeviceService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/companion", tags=["companion"])


# ── Request / Response models ────────────────────────────────────────────────

class CompanionRequest(BaseModel):
    phone_number:   str
    person_name:    str
    profile_type:   str            # "elder" | "teenager"
    expected_lat:   float = 41.3885
    expected_lon:   float = 2.1781
    radius_meters:  float = 350.0
    routine_place:  str   = "casa"  # where they should be right now


class CompanionResponse(BaseModel):
    status:         str   # OK | AWAY | INACTIVE | ALERT
    message:        str   # companion message for the person
    family_alert:   bool  # should family be notified?
    location_hint:  str   # human-readable location hint
    is_reachable:   bool
    distance_meters: int


class ScamRequest(BaseModel):
    text:         str
    person_name:  str  = "usuario"
    profile_type: str  = "adult"   # "elder" | "teenager" | "adult"


class ScamResponse(BaseModel):
    is_scam:      bool
    confidence:   int          # 0-100
    scam_type:    str          # phishing | smishing | fraude_bancario | bulo | ninguno | ...
    explanation:  str
    signals:      list[str]    # red flags found


# ── Companion analyze endpoint ───────────────────────────────────────────────

@router.post("/analyze", response_model=CompanionResponse)
def companion_analyze(
    req: CompanionRequest,
    nac: NaCClient = Depends(get_nac_client),
):
    dev_svc = DeviceService(nac)
    loc_svc = LocationService(nac)
    ai      = get_ai_client()

    # ── Gather Nokia NaC signals ─────────────────────────────────────────────
    signals  = dev_svc.get_full_device_signals(req.phone_number)
    geo      = loc_svc.check_geofence(
        req.phone_number, req.expected_lat, req.expected_lon, req.radius_meters
    )
    is_reachable   = not signals["device_inactive"]
    is_within_zone = geo["is_within_zone"]
    distance_m     = int(geo["distance_meters"])

    if is_within_zone:
        status = "OK"
        location_hint = f"En {req.routine_place} ✓"
    elif distance_m < 1000:
        status = "AWAY"
        location_hint = f"A {distance_m}m de {req.routine_place}"
    else:
        status = "ALERT"
        location_hint = f"Lejos — {distance_m}m de {req.routine_place}"

    if not is_reachable:
        status = "INACTIVE"
        location_hint = "Teléfono inactivo / sin cobertura"

    # ── Gemini: generate companion message ───────────────────────────────────
    import datetime
    hour = datetime.datetime.now().hour

    if req.profile_type == "teenager":
        tone_instructions = (
            "Eres un amigo/a IA comprensivo y no invasivo. "
            "Hablas con un/a adolescente de forma coloquial, con algún emoji. "
            "NUNCA menciones a los padres ni que estás controlando su localización. "
            "Si está fuera de su rutina, pregunta si está bien sin juzgar. "
            "Máximo 2-3 frases."
        )
    else:  # elder
        tone_instructions = (
            "Eres un asistente familiar cálido y amable. "
            "Hablas con una persona mayor de forma clara y tranquilizadora. "
            "Si está fuera de casa, recuérdale volver con suavidad. "
            "Usa lenguaje simple, sin tecnicismos. Máximo 2-3 frases."
        )

    prompt = f"""{tone_instructions}

Nombre: {req.name if hasattr(req, 'name') else req.person_name}
Hora actual: {hour}:00h
Estado: {status}
Situación: {location_hint}
Dispositivo activo: {is_reachable}

Genera el mensaje. Responde SOLO con:
MENSAJE: [tu mensaje aquí]
ALERTA_FAMILIA: [SÍ|NO]"""

    message       = ""
    family_alert  = status in ("ALERT", "INACTIVE")

    if ai._client:
        try:
            resp = ai._client.models.generate_content(
                model="gemini-2.5-flash", contents=prompt
            )
            raw = resp.text.strip()
            try:
                raw = raw.encode("latin-1").decode("utf-8")
            except Exception:
                pass
            for line in raw.splitlines():
                if line.startswith("MENSAJE:"):
                    message = line.replace("MENSAJE:", "").strip()
                elif line.startswith("ALERTA_FAMILIA:"):
                    family_alert = "SÍ" in line.upper()
        except Exception as e:
            logger.error(f"Gemini companion error: {e}")

    if not message:
        message = _fallback_message(req.profile_type, status, req.person_name, hour, location_hint)

    return CompanionResponse(
        status=status,
        message=message,
        family_alert=family_alert,
        location_hint=location_hint,
        is_reachable=is_reachable,
        distance_meters=distance_m,
    )


def _fallback_message(profile: str, status: str, name: str, hour: int, hint: str) -> str:
    if profile == "teenager":
        msgs = {
            "OK":       f"Todo bien por aquí, {name} 😊",
            "AWAY":     f"Oye {name}, {hint.lower()}. ¿Todo ok? 👀",
            "ALERT":    f"Eh {name}, llevas un rato fuera de tu zona habitual. ¿Necesitas algo? Sin presión 😊",
            "INACTIVE": f"Oye {name}, tu teléfono lleva un rato sin conexión. ¿Estás bien?",
        }
    else:
        msgs = {
            "OK":       f"Hola {name}, todo está bien por aquí 😊",
            "AWAY":     f"Hola {name}, {hint.lower()}. ¿Has ido a comprar algo? Recuerda volver a casa cuando puedas.",
            "ALERT":    f"Hola {name}, llevas un tiempo alejado de casa. ¿Estás bien? ¿Necesitas ayuda?",
            "INACTIVE": f"Hola {name}, tu teléfono no tiene conexión. Cuando puedas, avísanos de que estás bien.",
        }
    return msgs.get(status, f"Hola {name}, ¿cómo estás?")


# ── Scam detection endpoint ──────────────────────────────────────────────────

_SCAM_PROMPT = """Eres un experto en ciberseguridad y detección de estafas digitales en España.
Analiza el siguiente mensaje y determina si es una estafa, fraude o bulo.

Mensaje a analizar:
\"\"\"
{text}
\"\"\"

Contexto: el receptor es {context}.

Responde SOLO en este formato exacto (sin markdown, sin texto extra):
ESTAFA: [SÍ|NO]
CONFIANZA: [número del 0 al 100]
TIPO: [phishing|smishing|vishing|fraude_bancario|bulo|fraude_romance|falsa_oferta|ninguno|otro]
EXPLICACION: [2-3 frases explicando el análisis]
SEÑALES: [señal1, señal2, señal3 — o "ninguna"]"""

_SCAM_TYPES_ES = {
    "phishing":        "Phishing (suplantación web)",
    "smishing":        "Smishing (SMS fraudulento)",
    "vishing":         "Vishing (llamada fraudulenta)",
    "fraude_bancario": "Fraude bancario",
    "bulo":            "Bulo / Desinformación",
    "fraude_romance":  "Fraude romántico",
    "falsa_oferta":    "Falsa oferta / Premio",
    "otro":            "Estafa (tipo desconocido)",
    "ninguno":         "Sin estafa detectada",
}


@router.post("/scam-detect", response_model=ScamResponse)
def scam_detect(req: ScamRequest):
    ai = get_ai_client()

    context_map = {
        "elder":    "una persona mayor que puede ser más vulnerable a este tipo de engaños",
        "teenager": "un/a adolescente joven",
        "adult":    "un adulto",
    }
    context_str = context_map.get(req.profile_type, "un adulto")

    prompt = _SCAM_PROMPT.format(text=req.text[:1500], context=context_str)

    is_scam     = False
    confidence  = 50
    scam_type   = "ninguno"
    explanation = ""
    signals     = []

    if ai._client:
        try:
            resp = ai._client.models.generate_content(
                model="gemini-2.5-flash", contents=prompt
            )
            raw = resp.text.strip()
            try:
                raw = raw.encode("latin-1").decode("utf-8")
            except Exception:
                pass
            try:
                raw = raw.encode("latin-1").decode("utf-8")
            except Exception:
                pass
            for line in raw.splitlines():
                if line.startswith("ESTAFA:"):
                    is_scam = "SÍ" in line.upper()
                elif line.startswith("CONFIANZA:"):
                    try:
                        confidence = int("".join(c for c in line.split(":", 1)[1] if c.isdigit()))
                    except Exception:
                        pass
                elif line.startswith("TIPO:"):
                    scam_type = line.split(":", 1)[1].strip().lower()
                elif line.startswith("EXPLICACION:"):
                    explanation = line.split(":", 1)[1].strip()
                elif line.startswith("SEÑALES:"):
                    raw_signals = line.split(":", 1)[1].strip()
                    signals = [s.strip() for s in raw_signals.split(",") if s.strip() and s.strip().lower() != "ninguna"]
        except Exception as e:
            logger.error(f"Gemini scam detect error: {e}")
            explanation = "No se pudo analizar el mensaje en este momento."
    else:
        # Mock fallback — simple heuristic
        text_lower = req.text.lower()
        scam_keywords = ["premio", "ganado", "banco", "urgente", "contraseña", "pin", "click", "enlace", "verificar", "cuenta bloqueada"]
        hits = [k for k in scam_keywords if k in text_lower]
        if hits:
            is_scam    = True
            confidence = min(50 + len(hits) * 10, 95)
            scam_type  = "phishing"
            explanation = f"El mensaje contiene términos habituales en estafas: {', '.join(hits)}."
            signals    = hits[:4]
        else:
            is_scam    = False
            confidence = 80
            explanation = "No se detectaron señales claras de estafa en este mensaje."

    scam_type_label = _SCAM_TYPES_ES.get(scam_type, scam_type)
    return ScamResponse(
        is_scam=is_scam,
        confidence=confidence,
        scam_type=scam_type_label,
        explanation=explanation,
        signals=signals,
    )
