# SafeCircle 🛡️
### Intelligent Family Protection using Nokia Network as Code + Gemini AI

> **Open Gateway Hackathon 2026** — Talent Arena, Barcelona (March 2–3, 2026)
> Built with Nokia Network as Code CAMARA APIs + Google Gemini AI

---

## 🎯 Problem

Elderly relatives and teenagers are vulnerable to **SIM swap fraud**, unexpected displacement, and phone loss — but families only find out after the damage is done. Existing solutions rely on GPS apps that drain battery, require consent, and can be bypassed.

**SafeCircle detects risk at the network level** — before the user even knows something is wrong.

---

## 💡 Solution

SafeCircle monitors protected family members using **operator-level signals** (no app on their phone needed) and generates **natural-language alerts in Spanish** powered by Gemini AI.

```
Nokia NaC CAMARA APIs
  ├── SIM Swap detection        → Was the SIM replaced in the last 24h?
  ├── Device Location           → Where is the phone right now? (network-based)
  ├── Location Verification     → Is it inside the safe zone?
  ├── Device Reachability       → Is the phone online / silent?
  ├── Call Forwarding           → Are calls being redirected?
  └── SIM Tenure                → How old is this SIM?

Gemini AI → Generates contextual alert in plain Spanish for non-technical families
Kalman Filter → Smooths noisy network location (±1km Nokia accuracy → ±50m estimate)
Behavioral ML → Learns normal patterns, flags anomalies (night activity, unusual distance)
```

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND (Mobile)                        │
│   index.html  ·  Leaflet.js map  ·  SVG risk chart  ·  PWA     │
│   Real-time location polling (10s)  ·  Kalman-smoothed map      │
└────────────────────────┬────────────────────────────────────────┘
                         │ HTTP / CORS
┌────────────────────────▼────────────────────────────────────────┐
│                    BACKEND — FastAPI :8000                       │
│                                                                 │
│  POST /api/v1/protection/full-check                             │
│  GET  /api/v1/location/current/{phone}                          │
│  POST /api/v1/location/geofence/check                           │
│  GET  /api/v1/device/status/{phone}                             │
│  GET  /health                                                   │
│                                                                 │
│  ┌──────────────────┐  ┌───────────────────┐  ┌─────────────┐  │
│  │ Protection Svc   │  │  Location Svc     │  │ Device Svc  │  │
│  │ · Risk scoring   │  │  · Kalman filter  │  │ · SIM swap  │  │
│  │ · Behavioral ML  │  │  · Geofence check │  │ · Tenure    │  │
│  └────────┬─────────┘  └────────┬──────────┘  └──────┬──────┘  │
│           │                     │                     │         │
│  ┌────────▼─────────────────────▼─────────────────────▼──────┐  │
│  │              Nokia NaC Adapter  (real / mock)              │  │
│  └────────────────────────────────────────────────────────────┘  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                    Gemini AI Adapter                        │ │
│  └─────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────── ┘
                         │                        │
          ┌──────────────▼──────┐     ┌───────────▼────────────┐
          │ Nokia Network as    │     │  Google Gemini AI      │
          │ Code Platform       │     │  gemini-2.5-flash      │
          │ (CAMARA APIs)       │     │  Alert generation      │
          └─────────────────────┘     └────────────────────────┘
```

---

## 📱 Frontend Screens

### Home Screen
- Live clock + API connection status
- Family member cards with color-coded risk badges
- Auto-refresh every 60 seconds
- Emergency cards with pulsating red ring animation

### Detail Screen
| Section | Description |
|---------|-------------|
| **Risk Meter** | Animated SVG circular gauge, 0–100 score |
| **Network Signals** | 6-cell grid: SIM Swap, Recycled number, Call forwarding, Tenure, Verified, Zone |
| **📈 Risk Timeline** | SVG chart showing score evolution over last 20 checks |
| **🧠 Behavioral Analysis** | ML anomaly score + reasons in Spanish |
| **✨ Gemini Alert** | Natural-language explanation for non-technical families |
| **CTA Button** | Adaptive: grey (SAFE) / blue SMS / orange call / red EMERGENCY |
| **📍 Live Map** | Leaflet.js + Kalman-smoothed location + 40m safe zone |

---

## 🤖 ML Components

### 1. Kalman Filter (Location Smoothing)
Nokia NaC returns cell-tower-based location with ±1000m accuracy that jumps between readings. The Kalman filter fuses successive readings using:

```
Predict:  P(t) = P(t-1) + Q          (uncertainty grows over time)
Update:   K = P / (P + R)            (Kalman gain)
          x = x + K * (z - x)        (fuse prediction + measurement)
          P = (1 - K) * P            (reduce uncertainty)

Q = 1.6e-8 deg²/step  (walking speed process noise)
R = (accuracy_meters / 111000)²      (Nokia measurement variance)
```

Result: after 8+ readings, estimated accuracy improves from **±1000m → ±50–150m**.

### 2. Behavioral Anomaly Detection
Per-person profiles define "normal" behavior. Deviations add up to +30 points to the risk score:

| Anomaly | Points | Example |
|---------|--------|---------|
| Active at night | +10 | Elderly person at 23:00h |
| Far from home (3×) | +15 | >15km from usual location |
| Moderately far | +7 | 2–15km from usual location |
| Excessive inactivity | +10 | Silent 2× normal max |
| Night + displacement | +5 | Combined penalty |

### 3. Risk Scoring Engine
```
Signal               Weight    Trigger
─────────────────────────────────────────
SIM Swap             25 pts    SIM replaced in last 24h
Number Recycled      15 pts    No history on this number
Call Forwarding      10 pts    Unconditional redirect active
New SIM (<30 days)   15 pts    Tenure < 30 days
Outside Safe Zone    20 pts    Distance > configured radius
Device Inactive      15 pts    No connectivity detected
Behavioral Anomaly   0–30 pts  ML pattern deviation
─────────────────────────────────────────
SAFE:       0–29   GREEN
SUSPICIOUS: 30–59  YELLOW
HIGH_RISK:  60–84  ORANGE/RED
EMERGENCY:  85–100 RED PULSATING
```

---

## 📡 Nokia NaC CAMARA APIs Used

| CAMARA API | Nokia SDK Method | SafeCircle Use |
|-----------|-----------------|----------------|
| Device Location | `device.location(max_age=600)` | Real-time position |
| Location Verification | `device.verify_location(lat, lon, radius)` | Geofence check |
| Device Reachability | `device.get_reachability()` | Is phone online? |
| SIM Swap | `device.verify_sim_swap(max_age=1440)` | Fraud detection |
| SIM Swap Date | `device.get_sim_swap_date()` | Tenure estimation |
| Number Verification | `device.verify_number()` | Identity check |
| Call Forwarding | `device.verify_unconditional_forwarding()` | Redirect detection |

---

## 🚀 Quick Start

### Prerequisites
- Python 3.11+
- Nokia NaC API Key (from [networkascode.nokia.io](https://networkascode.nokia.io))
- Google Gemini API Key

### Backend
```bash
cd safecircle/
pip install -r requirements.txt

# Configure credentials
cp .env.example .env
# Edit .env: set NAC_TOKEN and GEMINI_API_KEY

# Start API
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
# → http://localhost:8000/docs
```

### Frontend
```bash
# Option 1: Open directly in browser
# Double-click: safecircle/frontend/index.html

# Option 2: Local server
python -m http.server 3000 --directory frontend
# → http://localhost:3000
```

---

## 📁 Project Structure

```
safecircle/
├── app/
│   ├── main.py                      # FastAPI app + CORS + startup
│   ├── config.py                    # Settings (env vars)
│   ├── api/
│   │   ├── routes/
│   │   │   ├── health.py            # GET /health
│   │   │   ├── location.py          # Location + geofence endpoints
│   │   │   ├── device.py            # Device status endpoint
│   │   │   └── protection.py        # Full-check endpoint (main)
│   │   ├── models/
│   │   │   ├── location.py          # Pydantic: LocationResponse, GeofenceRequest
│   │   │   └── device.py            # Pydantic: FullCheckRequest/Response + Behavioral
│   │   └── dependencies.py          # DI: get_nac_client, get_ai_service
│   ├── adapters/
│   │   ├── nac_client.py            # Nokia NaC wrapper: real SDK + mock fallback
│   │   └── ai_client.py             # Gemini wrapper: Spanish family alerts
│   └── services/
│       ├── kalman.py                # 2D Kalman filter for location smoothing ← ML
│       ├── behavioral_profile.py    # Behavioral anomaly detection ← ML
│       ├── location_service.py      # Location logic + Kalman integration
│       ├── device_service.py        # SIM swap + reachability logic
│       └── protection_service.py    # Risk scoring + orchestration
├── frontend/
│   └── index.html                   # Single-file mobile PWA
├── requirements.txt
├── .env.example
└── docker-compose.yml
```

---

## 🌐 Environment Variables

```env
# Nokia Network as Code
NAC_TOKEN=your_rapidapi_key_here
USE_MOCK=false                    # true = use simulator numbers

# Gemini AI
GEMINI_API_KEY=your_gemini_key_here

# Server
API_HOST=0.0.0.0
API_PORT=8000
```

---

## 🎬 Demo Scenario

**Family García — 3 protected members**

| Person | Phone | Role | Demo Scenario |
|--------|-------|------|---------------|
| Manuel 👦 | +34629123456 | Son, 16 | SAFE — normal teenager behavior |
| Rosa 👵 | +99999990400 | Grandmother, 78 | **EMERGENCY** — SIM swap + call forwarding (Nokia simulator) |
| Aitor 👴 | +34640197102 | Grandfather, 75 | Real Orange SIM — live network data |

**Live demo flow:**
1. Home loads → 3 cards with real Nokia NaC data
2. Tap Rosa → EMERGENCY badge pulsating, Gemini alert in Spanish, red pulsating CTA
3. Tap Aitor → Kalman-smoothed map of Barcelona, behavioral analysis, risk timeline chart
4. Colleague walks away with Aitor's phone → Nuevo chequeo → outside_safe_zone → risk rises → alert fires

---

## 🏆 Hackathon Context

- **Event**: Open Gateway Hackathon 2026 — Talent Arena, Fira Barcelona
- **Challenge**: Nokia Network as Code + CAMARA APIs
- **APIs used**: Device Location, Location Verification, SIM Swap, Device Reachability, Number Verification, Call Forwarding
- **Real SIM**: Orange/MasOrange SIM (+34640197102) tested on live 5G network
- **AI**: Google Gemini 2.5 Flash — natural language alerts in Spanish

---

## 👥 Team

Built with ❤️ during 24h hackathon sprint using:
- Nokia Network as Code Platform
- Google Gemini AI
- FastAPI + Python
- Leaflet.js
- Zero external ML libraries (Kalman filter implemented from scratch)

---

*SafeCircle — Because your family's safety shouldn't depend on them having the right app installed.*
