"""
Gemini AI adapter.
Generates natural-language family alerts from telco signals.
"""

import logging
from app.config import settings

logger = logging.getLogger(__name__)

_PROMPT_TEMPLATE = """
Eres el asistente de seguridad familiar de SafeCircle. Tu tarea es generar una alerta breve
y clara en español para un familiar no técnico (puede ser padre/madre, hijo adulto, cuidador).

Datos de la persona protegida:
- Teléfono: {phone_number}
- Hora actual: {hour}:00h, tipo de día: {day_type}
- Zona esperada: {expected_zone}

Señales de red detectadas:
- SIM cambiada recientemente: {sim_swapped}
- Número sin historial (posible reciclado): {number_recycled}
- Desvío de llamadas activo: {call_forwarding_active}
- Antigüedad de la SIM: {tenure_days} días
- Número verificado: {is_verified}
- Fuera de zona segura: {outside_safe_zone}
- Dispositivo inactivo: {device_inactive}
- Puntuación de riesgo: {risk_score}/100 ({risk_level})

Genera:
1. Una alerta de máximo 3 frases, en español coloquial, explicando la situación y el riesgo
2. Una recomendación de acción: SAFE, MONITOR, CALL_NOW o EMERGENCY

Formato de respuesta (solo esto, sin markdown):
ALERTA: [tu alerta aquí]
RECOMENDACION: [SAFE|MONITOR|CALL_NOW|EMERGENCY]
""".strip()

_MOCK_RESPONSES = {
    "SAFE": (
        "Todo está en orden. El dispositivo se encuentra en la zona habitual y todas las señales "
        "de red son normales. No se requiere ninguna acción.",
        "SAFE",
    ),
    "MONITOR": (
        "La persona protegida se encuentra fuera de su zona habitual pero dentro de un rango "
        "razonable. Las señales de red son normales. Recomendamos verificar por mensaje.",
        "MONITOR",
    ),
    "HIGH_RISK": (
        "Atención: se han detectado señales inusuales. El dispositivo lleva tiempo inactivo "
        "y está fuera de la zona segura. Se recomienda intentar contactar ahora.",
        "CALL_NOW",
    ),
    "EMERGENCY": (
        "ALERTA URGENTE: Se ha detectado un cambio de SIM reciente junto con el dispositivo "
        "fuera de zona y sin actividad. Podría indicar un incidente. Contacte inmediatamente "
        "o avise a servicios de emergencia.",
        "EMERGENCY",
    ),
}


def _pick_mock_response(risk_level: str) -> tuple[str, str]:
    if risk_level == "SAFE":
        return _MOCK_RESPONSES["SAFE"]
    if risk_level == "SUSPICIOUS":
        return _MOCK_RESPONSES["MONITOR"]
    if risk_level == "HIGH_RISK":
        return _MOCK_RESPONSES["HIGH_RISK"]
    return _MOCK_RESPONSES["EMERGENCY"]


class AIClient:
    """
    Gemini-powered alert generator.
    Falls back to curated mock responses when no API key is configured.
    """

    def __init__(self):
        self._client = None
        if settings.GEMINI_API_KEY:
            try:
                from google import genai
                self._client = genai.Client(api_key=settings.GEMINI_API_KEY)
                logger.info("Gemini AI initialized (google-genai SDK)")
            except Exception as e:
                logger.warning(f"Failed to init Gemini, using mock responses: {e}")
        else:
            logger.info("GEMINI_API_KEY not set — using mock AI responses")

    def generate_alert(
        self,
        phone_number: str,
        signals: dict,
        risk_score: int,
        risk_level: str,
        context: dict,
    ) -> tuple[str, str]:
        """
        Generate a natural-language alert and recommendation.

        Returns:
            (alert_text, recommendation)
            recommendation is one of: SAFE, MONITOR, CALL_NOW, EMERGENCY
        """
        if self._client is None:
            return _pick_mock_response(risk_level)

        prompt = _PROMPT_TEMPLATE.format(
            phone_number=phone_number,
            hour=context.get("hour", "?"),
            day_type=context.get("day_type", "weekday"),
            expected_zone=context.get("expected_zone", "home"),
            sim_swapped=signals.get("sim_swapped", False),
            number_recycled=signals.get("number_recycled", False),
            call_forwarding_active=signals.get("call_forwarding_active", False),
            tenure_days=signals.get("tenure_days", 0),
            is_verified=signals.get("is_verified", True),
            outside_safe_zone=signals.get("outside_safe_zone", False),
            device_inactive=signals.get("device_inactive", False),
            risk_score=risk_score,
            risk_level=risk_level,
        )

        try:
            response = self._client.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt,
            )
            raw = response.text.strip()
            # Fix double UTF-8 encoding that can occur with some Gemini SDK versions
            try:
                text = raw.encode("latin-1").decode("utf-8")
            except (UnicodeDecodeError, UnicodeEncodeError):
                text = raw
            alert = ""
            recommendation = "MONITOR"
            for line in text.splitlines():
                if line.startswith("ALERTA:"):
                    alert = line.replace("ALERTA:", "").strip()
                elif line.startswith("RECOMENDACION:"):
                    rec = line.replace("RECOMENDACION:", "").strip().upper()
                    if rec in {"SAFE", "MONITOR", "CALL_NOW", "EMERGENCY"}:
                        recommendation = rec
            return alert or text, recommendation
        except Exception as e:
            logger.error(f"Gemini generation failed: {e}")
            return _pick_mock_response(risk_level)


# Singleton instance
_ai_client: AIClient | None = None


def get_ai_client() -> AIClient:
    """Return the singleton AIClient instance."""
    global _ai_client
    if _ai_client is None:
        _ai_client = AIClient()
    return _ai_client
