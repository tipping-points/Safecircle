/* ═══════════════════════════════════════════════════════════════════
   SafeCircle — script.js
   Nokia Network as Code + Gemini AI — Open Gateway Hackathon 2026
   ═══════════════════════════════════════════════════════════════════ */

const API_BASE = 'http://localhost:8000';

const PERSONS = [
  {
    name: 'Manuel', role: 'Hijo', age: 16, phone: '+34629123456', avatar: '👦',
  },
  {
    name: 'Rosa', role: 'Abuela', age: 78, phone: '+99999990400', avatar: '👵',
  },
  {
    name: 'Aitor', role: 'Abuelo', age: 75, phone: '+34640197102', avatar: '👴',
    // Centro = ubicación real Nokia NaC. Radio 350m para demo limpia.
    homeLat: 41.3885, homeLon: 2.1781, homeRadius: 350,
  },
];

const RISK_CONFIG = {
  SAFE:       { color: '#34a853', label: 'Seguro ✓',        badgeText: 'SAFE',       cssClass: 'risk--safe' },
  SUSPICIOUS: { color: '#f9ab00', label: 'Sospechoso ⚠️',   badgeText: 'ATENCIÓN',   cssClass: 'risk--suspicious' },
  HIGH_RISK:  { color: '#ea4335', label: 'Alto Riesgo 🔴',  badgeText: 'ALTO RIESGO',cssClass: 'risk--high-risk' },
  EMERGENCY:  { color: '#d93025', label: '¡EMERGENCIA! 🚨', badgeText: 'EMERGENCIA', cssClass: 'risk--emergency' },
};

const ARC_LEN = 141.37; // π × 45 (radio del semicírculo SVG)

// Estado global
const state = {
  persons: {},          // { [phone]: fullCheckResult }
  riskHistory: {},      // { [phone]: [{score, ts}] }
  currentIdx: null,     // índice en PERSONS
  locationInterval: null,
  map: null,
  mapMarker: null,
  safeCircle: null,
  accCircle: null,
  trailPoints: [],
  trailLine: null,
  refreshInterval: null,
  lastCheckTime: {},    // { [phone]: Date }
};

// ─────────────────────────────────────────────────────────────────
//  DOM refs
// ─────────────────────────────────────────────────────────────────
const screens = {
  home:   document.querySelector('[data-screen="home"]'),
  detail: document.querySelector('[data-screen="detail"]'),
};

const $ = (id) => document.getElementById(id);

// ─────────────────────────────────────────────────────────────────
//  Navegación entre pantallas
// ─────────────────────────────────────────────────────────────────
function setScreen(name) {
  Object.entries(screens).forEach(([key, node]) => {
    const active = key === name;
    node.classList.toggle('is-active', active);
    node.setAttribute('aria-hidden', String(!active));
  });
}

function navigate(idx) {
  state.currentIdx = idx;
  const person = PERSONS[idx];

  $('detail-name').textContent = `${person.avatar} ${person.name}`;
  setScreen('detail');

  // Inicializar mapa tras transición (necesita contenedor visible)
  setTimeout(() => {
    initOrUpdateMap(person);
    startLocationTracking(person);
  }, 280);

  // Si tenemos datos en caché, renderizar inmediatamente
  const cached = state.persons[person.phone];
  if (cached) {
    renderDetail(cached, person);
  } else {
    resetDetailUI();
    runFullCheck(person);
  }

  $('check-btn').onclick = () => runFullCheck(person);

  // Mostrar botón demo + agente solo para Aitor
  const demoBtn  = $('demo-walk-btn');
  const agentBtn = $('agent-launch-btn');
  if (demoBtn)  { demoBtn.style.display  = person.phone === AITOR_PHONE ? 'block' : 'none'; demoBtn.onclick  = () => runDemoWalk(); }
  if (agentBtn) { agentBtn.style.display = person.phone === AITOR_PHONE ? 'block' : 'none'; agentBtn.onclick = () => openAgentScreen(person); }
  const compProfile = COMPANION_PROFILES[person.phone] ?? { type: 'adult' };
  const companionBtn = $('companion-launch-btn');
  if (companionBtn) {
    companionBtn.textContent = compProfile.type === 'teenager'
      ? `💬 Companion de ${person.name}`
      : '🤝 Companion IA & Detector Estafas';
    companionBtn.onclick = () => openCompanionScreen(person);
  }
}

$('back-button').addEventListener('click', () => {
  stopLocationTracking();
  setScreen('home');
});

// ─────────────────────────────────────────────────────────────────
//  API calls
// ─────────────────────────────────────────────────────────────────
async function fullCheck(phone) {
  const person = PERSONS.find(p => p.phone === phone);
  const now = new Date();
  const dow = now.getDay();
  const body = {
    phone_number: phone,
    context: {
      expected_zone: 'home',
      hour: now.getHours(),
      day_type: (dow === 0 || dow === 6) ? 'weekend' : 'weekday',
    },
  };
  if (person?.homeLat != null) {
    body.context.expected_lat     = person.homeLat;
    body.context.expected_lon     = person.homeLon;
    body.context.radius_meters    = person.homeRadius ?? 500;
  }
  const res = await fetch(`${API_BASE}/api/v1/protection/full-check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function getLocation(phone) {
  const res = await fetch(`${API_BASE}/api/v1/location/current/${encodeURIComponent(phone)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ─────────────────────────────────────────────────────────────────
//  Full-check flow
// ─────────────────────────────────────────────────────────────────
async function runFullCheck(person) {
  $('check-btn').disabled = true;
  $('check-btn').textContent = 'Consultando red… ⏳';

  try {
    const data = await fullCheck(person.phone);
    state.persons[person.phone] = data;
    state.lastCheckTime[person.phone] = new Date();

    // Guardar en historial (max 20 puntos)
    if (!state.riskHistory[person.phone]) state.riskHistory[person.phone] = [];
    state.riskHistory[person.phone].push({ score: data.risk_score, ts: new Date() });
    if (state.riskHistory[person.phone].length > 20) state.riskHistory[person.phone].shift();

    // Solo renderizar si seguimos en la pantalla de este person
    if (state.currentIdx !== null && PERSONS[state.currentIdx].phone === person.phone) {
      renderDetail(data, person);
    }

    // Actualizar tarjeta en home
    updateCardUI(person.phone, data);
  } catch (err) {
    console.error('fullCheck error:', err);
    $('ai-alert-text').textContent = '⚠️ Error conectando con el backend. ¿Está iniciado?';
  } finally {
    $('check-btn').disabled = false;
    $('check-btn').textContent = 'Nuevo chequeo 🔄';
  }
}

// ─────────────────────────────────────────────────────────────────
//  Render detalle completo
// ─────────────────────────────────────────────────────────────────
function renderDetail(data, person) {
  const cfg = RISK_CONFIG[data.risk_level] ?? RISK_CONFIG.SAFE;

  // Badge en topbar
  const badge = $('detail-badge');
  badge.textContent = cfg.badgeText;
  badge.className = `risk-badge ${cfg.cssClass}`;

  // Risk meter
  renderRiskMeter(data.risk_score, data.risk_level);

  // Info
  const lastCheck = state.lastCheckTime[person.phone];
  $('risk-level-text').textContent = cfg.label;
  $('risk-sub').textContent = lastCheck
    ? `Último check: ${formatTime(lastCheck)}`
    : 'Datos actualizados';

  // Señales de red
  renderSignals(data.signals);

  // AI Alert
  const aiEl = $('ai-alert');
  $('ai-alert-text').textContent = data.ai_alert || '—';
  aiEl.classList.toggle('is-emergency', data.risk_level === 'EMERGENCY');

  // CTA button
  renderCTA(data.recommendation, person.phone);

  // Historial
  renderRiskChart(person.phone);

  // Análisis de comportamiento
  if (data.behavioral) {
    const b = data.behavioral;
    let bText = `Score de anomalía: ${b.anomaly_score}/30`;
    if (b.anomaly_reasons && b.anomaly_reasons.length > 0) {
      bText += '\n• ' + b.anomaly_reasons.join('\n• ');
    }
    if (b.distance_km != null) {
      bText += `\n📍 ${b.distance_km.toFixed(1)} km del punto habitual`;
    }
    $('behavioral-text').textContent = bText;
  }

  // Detalles técnicos
  const s = data.signals;
  $('tech-content').textContent = [
    `phone:          ${data.phone_number}`,
    `risk_score:     ${data.risk_score}/100`,
    `risk_level:     ${data.risk_level}`,
    `recommendation: ${data.recommendation}`,
    `─────────────────────────`,
    `sim_swapped:           ${s.sim_swapped}`,
    `number_recycled:       ${s.number_recycled}`,
    `call_forwarding:       ${s.call_forwarding_active}`,
    `tenure_days:           ${s.tenure_days}`,
    `is_verified:           ${s.is_verified}`,
    `outside_safe_zone:     ${s.outside_safe_zone}`,
    `device_inactive:       ${s.device_inactive}`,
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────
//  Risk meter SVG (semicírculo)
// ─────────────────────────────────────────────────────────────────
function renderRiskMeter(score, level) {
  const cfg = RISK_CONFIG[level] ?? RISK_CONFIG.SAFE;
  const filled = (score / 100) * ARC_LEN;
  const arc = $('risk-arc');
  arc.setAttribute('stroke-dasharray', `${filled} ${ARC_LEN}`);
  arc.setAttribute('stroke', cfg.color);
  $('risk-score').textContent = score;
  $('risk-score').style.color = cfg.color;
}

// ─────────────────────────────────────────────────────────────────
//  Señales de red
// ─────────────────────────────────────────────────────────────────
function renderSignals(signals) {
  function setSignal(id, isAlert, icon, alertIcon) {
    const el = $(id);
    el.className = `signal-cell ${isAlert ? 'alert' : 'ok'}`;
    el.querySelector('.signal-icon').textContent = isAlert ? alertIcon : icon;
  }

  setSignal('sig-sim', signals.sim_swapped,            '✅', '🔴');
  setSignal('sig-num', signals.number_recycled,         '✅', '⚠️');
  setSignal('sig-fwd', signals.call_forwarding_active,  '✅', '📵');
  setSignal('sig-ten', signals.tenure_days < 30,        '✅', '🆕');
  setSignal('sig-ver', !signals.is_verified,            '✅', '❓');
  setSignal('sig-zon', signals.outside_safe_zone,       '🏠', '🚨');

  // Actualizar labels con info extra
  $('sig-ten').querySelector('.signal-label').textContent =
    `SIM ${signals.tenure_days}d`;
}

// ─────────────────────────────────────────────────────────────────
//  CTA button adaptativo
// ─────────────────────────────────────────────────────────────────
function renderCTA(recommendation, phone) {
  const btn = $('cta-btn');
  btn.className = 'cta-btn';
  btn.onclick = null;

  switch (recommendation) {
    case 'SAFE':
      btn.classList.add('cta-safe');
      btn.textContent = 'Todo en orden ✓';
      break;
    case 'MONITOR':
      btn.classList.add('cta-monitor');
      btn.textContent = 'Enviar mensaje 💬';
      btn.onclick = () => alert('Abre tu app de mensajes para contactar.');
      break;
    case 'CALL_NOW':
      btn.classList.add('cta-call');
      btn.textContent = 'Llamar ahora 📞';
      btn.onclick = () => { window.location.href = `tel:${phone}`; };
      break;
    case 'EMERGENCY':
      btn.classList.add('cta-emergency');
      btn.textContent = '🚨 EMERGENCIA — Llamar ahora';
      btn.onclick = () => { window.location.href = `tel:${phone}`; };
      break;
    default:
      btn.classList.add('cta-safe');
      btn.textContent = 'Todo en orden ✓';
  }
}

// ─────────────────────────────────────────────────────────────────
//  Historial de riesgo (SVG chart)
// ─────────────────────────────────────────────────────────────────
function renderRiskChart(phone) {
  const history = state.riskHistory[phone];
  const wrap = $('risk-chart-wrap');
  const section = $('chart-section');

  if (!history || history.length < 2) {
    section.style.display = 'none';
    return;
  }
  section.style.display = 'block';

  const W = 280, H = 80, PAD = { t: 6, r: 8, b: 20, l: 28 };
  const iW = W - PAD.l - PAD.r;
  const iH = H - PAD.t - PAD.b;

  // Bandas de color (fondo)
  const bands = [
    { from: 85, to: 100, color: 'rgba(217,48,37,0.15)' },
    { from: 60, to: 84,  color: 'rgba(234,67,53,0.1)' },
    { from: 30, to: 59,  color: 'rgba(249,171,0,0.1)' },
    { from: 0,  to: 29,  color: 'rgba(52,168,83,0.1)' },
  ];

  const toX = (i) => PAD.l + (i / (history.length - 1)) * iW;
  const toY = (s) => PAD.t + iH - (s / 100) * iH;

  const bandsSVG = bands.map(b => {
    const y1 = toY(b.to);
    const y2 = toY(b.from);
    return `<rect x="${PAD.l}" y="${y1}" width="${iW}" height="${y2 - y1}" fill="${b.color}"/>`;
  }).join('');

  // Polilínea
  const pts = history.map((h, i) => `${toX(i)},${toY(h.score)}`).join(' ');
  const lineSVG = `<polyline points="${pts}" fill="none" stroke="rgba(117,100,248,0.7)" stroke-width="2" stroke-linejoin="round"/>`;

  // Puntos
  const dotsSVG = history.map((h, i) => {
    const cfg = h.score >= 85 ? RISK_CONFIG.EMERGENCY
              : h.score >= 60 ? RISK_CONFIG.HIGH_RISK
              : h.score >= 30 ? RISK_CONFIG.SUSPICIOUS
              : RISK_CONFIG.SAFE;
    return `<circle cx="${toX(i)}" cy="${toY(h.score)}" r="3.5" fill="${cfg.color}">
      <title>${h.score} — ${formatTime(h.ts)}</title>
    </circle>`;
  }).join('');

  // Etiquetas Y: 0, 50, 100
  const yLabels = [0, 50, 100].map(v => {
    const y = toY(v);
    return `<text x="${PAD.l - 4}" y="${y + 4}" text-anchor="end" font-size="9" fill="#aaa">${v}</text>
            <line x1="${PAD.l}" y1="${y}" x2="${PAD.l + iW}" y2="${y}" stroke="#ddd" stroke-width="0.5"/>`;
  }).join('');

  // Etiquetas X (primera y última)
  const xLabelFirst = `<text x="${PAD.l}" y="${H - 4}" text-anchor="middle" font-size="8" fill="#aaa">${formatTime(history[0].ts)}</text>`;
  const xLabelLast  = `<text x="${PAD.l + iW}" y="${H - 4}" text-anchor="middle" font-size="8" fill="#aaa">${formatTime(history[history.length-1].ts)}</text>`;

  wrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px;display:block">
    <rect x="${PAD.l}" y="${PAD.t}" width="${iW}" height="${iH}" rx="4" fill="rgba(255,255,255,0.6)"/>
    ${bandsSVG}
    ${yLabels}
    ${lineSVG}
    ${dotsSVG}
    ${xLabelFirst}
    ${xLabelLast}
  </svg>`;
}

// ─────────────────────────────────────────────────────────────────
//  Mapa Leaflet
// ─────────────────────────────────────────────────────────────────
function initOrUpdateMap(person) {
  const mapEl = $('leaflet-map');

  if (!state.map) {
    state.map = L.map('leaflet-map', {
      zoomControl: true,
      attributionControl: false,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
    }).addTo(state.map);
  } else {
    state.map.invalidateSize();
  }

  // Resetear trail al cambiar de persona
  state.trailPoints = [];
  if (state.trailLine) { state.map.removeLayer(state.trailLine); state.trailLine = null; }
}

function updateMap(locData, person) {
  if (!state.map) return;

  const lat = locData.latitude;
  const lon = locData.longitude;
  const acc = locData.accuracy_meters ?? 1000;
  const isOutside = state.persons[person.phone]?.signals?.outside_safe_zone ?? false;

  // Centrar mapa
  state.map.setView([lat, lon], 15);

  // Marcador principal
  const markerColor = isOutside ? '#ea4335' : '#34a853';
  const markerIcon = L.divIcon({
    className: '',
    html: `<div style="
      width:28px;height:28px;border-radius:50%;
      background:${markerColor};
      border:3px solid #fff;
      box-shadow:0 3px 10px rgba(0,0,0,0.3);
      display:flex;align-items:center;justify-content:center;
      font-size:14px;line-height:1
    ">${person.avatar}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });

  if (state.mapMarker) {
    state.mapMarker.setLatLng([lat, lon]).setIcon(markerIcon);
  } else {
    state.mapMarker = L.marker([lat, lon], { icon: markerIcon }).addTo(state.map);
  }

  // Círculo de precisión (Nokia accuracy)
  if (state.accCircle) state.map.removeLayer(state.accCircle);
  state.accCircle = L.circle([lat, lon], {
    radius: acc,
    color: '#f9ab00',
    weight: 1.5,
    fillOpacity: 0.05,
    dashArray: '4 4',
  }).addTo(state.map);

  // Zona segura del hogar
  if (person.homeLat != null) {
    if (state.safeCircle) state.map.removeLayer(state.safeCircle);
    state.safeCircle = L.circle([person.homeLat, person.homeLon], {
      radius: person.homeRadius ?? 500,
      color: isOutside ? '#ea4335' : '#34a853',
      weight: 2,
      fillOpacity: 0.07,
    }).addTo(state.map).bindTooltip('Zona segura', { permanent: false });
  }

  // Trail de posiciones
  state.trailPoints.push([lat, lon]);
  if (state.trailPoints.length > 50) state.trailPoints.shift();
  if (state.trailLine) state.map.removeLayer(state.trailLine);
  if (state.trailPoints.length > 1) {
    state.trailLine = L.polyline(state.trailPoints, {
      color: 'rgba(117,100,248,0.5)',
      weight: 2,
      dashArray: '4 4',
    }).addTo(state.map);
  }

  // Kalman info
  const conf  = locData.kalman_confidence ?? 0;
  const reads = locData.kalman_readings   ?? 0;
  $('risk-kalman').textContent =
    `📍 ±${acc}m · Kalman ${reads} lecturas · ${(conf * 100).toFixed(0)}% conf.`;

  // LIVE badge
  $('live-badge').style.display = 'block';
}

// ─────────────────────────────────────────────────────────────────
//  Location polling (cada 10s)
// ─────────────────────────────────────────────────────────────────
function startLocationTracking(person) {
  stopLocationTracking();

  async function poll() {
    try {
      const loc = await getLocation(person.phone);
      if (state.currentIdx !== null && PERSONS[state.currentIdx].phone === person.phone) {
        updateMap(loc, person);
      }
    } catch (e) {
      console.warn('Location poll error:', e);
    }
  }

  poll(); // primera llamada inmediata
  state.locationInterval = setInterval(poll, 10000);
}

function stopLocationTracking() {
  if (state.locationInterval) {
    clearInterval(state.locationInterval);
    state.locationInterval = null;
  }
  $('live-badge').style.display = 'none';
  if (state.mapMarker) { state.map?.removeLayer(state.mapMarker); state.mapMarker = null; }
  if (state.safeCircle) { state.map?.removeLayer(state.safeCircle); state.safeCircle = null; }
  if (state.accCircle) { state.map?.removeLayer(state.accCircle); state.accCircle = null; }
  if (state.trailLine) { state.map?.removeLayer(state.trailLine); state.trailLine = null; }
  state.trailPoints = [];
}

// ─────────────────────────────────────────────────────────────────
//  Home screen — tarjetas de personas
// ─────────────────────────────────────────────────────────────────
const grid = $('person-grid');
const tpl  = document.getElementById('person-card-template');

const cardEls = {}; // { phone: articleEl }

function initPersonGrid() {
  PERSONS.forEach((person, idx) => {
    const frag = tpl.content.cloneNode(true);
    const card = frag.querySelector('.person-card');

    frag.querySelector('.person-emoji').textContent    = person.avatar;
    frag.querySelector('.device-card__name').textContent = person.name;
    frag.querySelector('.device-card__activity').textContent = `${person.role} · ${person.age} años`;
    frag.querySelector('.meta--score').textContent     = 'Cargando…';

    const badge = frag.querySelector('.card-risk-badge');
    badge.textContent  = '…';
    badge.className    = 'card-risk-badge';

    card.style.animation = `fade-up 340ms ease ${idx * 90}ms both`;

    const openFn = () => navigate(idx);
    frag.querySelector('.device-card__open').addEventListener('click', openFn);
    frag.querySelector('.device-card__arrow').addEventListener('click', openFn);

    grid.appendChild(frag);
    cardEls[person.phone] = grid.lastElementChild;
  });
}

function updateCardUI(phone, data) {
  const card = cardEls[phone];
  if (!card) return;

  const cfg = RISK_CONFIG[data.risk_level] ?? RISK_CONFIG.SAFE;
  const badge = card.querySelector('.card-risk-badge');
  badge.textContent = cfg.badgeText;
  badge.className   = `card-risk-badge ${cfg.cssClass}`;

  card.querySelector('.meta--score').textContent = `Score: ${data.risk_score}`;

  const ts = state.lastCheckTime[phone];
  card.querySelector('.device-card__activity').textContent =
    `${PERSONS.find(p => p.phone === phone)?.role} · ${ts ? formatTime(ts) : ''}`;

  card.classList.toggle('is-emergency', data.risk_level === 'EMERGENCY');
}

// ─────────────────────────────────────────────────────────────────
//  Refresh all (home + auto-refresh)
// ─────────────────────────────────────────────────────────────────
async function refreshAll() {
  const btn = $('refresh-all-btn');
  const icon = $('refresh-icon');
  btn.disabled = true;
  icon.style.display = 'inline-block';
  icon.style.animation = 'spin 1s linear infinite';

  await Promise.allSettled(
    PERSONS.map(async (person) => {
      try {
        const data = await fullCheck(person.phone);
        state.persons[person.phone] = data;
        state.lastCheckTime[person.phone] = new Date();
        if (!state.riskHistory[person.phone]) state.riskHistory[person.phone] = [];
        state.riskHistory[person.phone].push({ score: data.risk_score, ts: new Date() });
        if (state.riskHistory[person.phone].length > 20) state.riskHistory[person.phone].shift();
        updateCardUI(person.phone, data);
      } catch (e) {
        console.error(`refreshAll error for ${person.phone}:`, e);
      }
    })
  );

  btn.disabled = false;
  icon.style.animation = '';
}

$('refresh-all-btn').addEventListener('click', refreshAll);

// ─────────────────────────────────────────────────────────────────
//  Reset UI al abrir detalle sin datos
// ─────────────────────────────────────────────────────────────────
function resetDetailUI() {
  $('risk-score').textContent  = '…';
  $('risk-score').style.color  = '#aaa';
  $('risk-arc').setAttribute('stroke-dasharray', '0 142');
  $('risk-level-text').textContent = 'Consultando red…';
  $('risk-sub').textContent = 'Obteniendo señales Nokia…';
  $('risk-kalman').textContent = '📍 —';
  $('detail-badge').textContent = '…';
  $('detail-badge').className = 'risk-badge';
  $('ai-alert-text').textContent = 'Generando análisis Gemini…';
  $('behavioral-text').textContent = '—';
  $('tech-content').textContent = '—';
  $('chart-section').style.display = 'none';
  ['sig-sim','sig-num','sig-fwd','sig-ten','sig-ver','sig-zon'].forEach(id => {
    const el = $(id);
    el.className = 'signal-cell';
    el.querySelector('.signal-icon').textContent = '⏳';
  });
  $('sig-ten').querySelector('.signal-label').textContent = 'Antigüedad';
}

// ─────────────────────────────────────────────────────────────────
//  Reloj en tiempo real
// ─────────────────────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  $('hero-clock').textContent =
    now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
setInterval(updateClock, 1000);
updateClock();

// ─────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────
function formatTime(date) {
  if (!date) return '—';
  return new Date(date).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ─────────────────────────────────────────────────────────────────
//  Animación spin para icono refresh
// ─────────────────────────────────────────────────────────────────
const style = document.createElement('style');
style.textContent = `
  @keyframes spin { to { transform: rotate(360deg); } }
`;
document.head.appendChild(style);

// ─────────────────────────────────────────────────────────────────
//  COMPANION SCREEN — Context-aware AI companion + Scam Detector
// ─────────────────────────────────────────────────────────────────

screens.companion = document.querySelector('[data-screen="companion"]');

const COMPANION_PROFILES = {
  '+34640197102': { type: 'elder',    routinePlace: 'casa',    label: 'Abuelo'    },
  '+34629123456': { type: 'teenager', routinePlace: 'colegio', label: 'Hijo'      },
  '+99999990400': { type: 'elder',    routinePlace: 'casa',    label: 'Abuela'    },
};

function openCompanionScreen(person) {
  stopLocationTracking();
  setScreen('companion');

  const profile = COMPANION_PROFILES[person.phone] ?? { type: 'adult', routinePlace: 'casa', label: person.role };
  const isTeenager = profile.type === 'teenager';

  // Apply teen-mode styling
  screens.companion.classList.toggle('teen-mode', isTeenager);

  // Header
  if (isTeenager) {
    $('companion-title').textContent = `💬 ${person.name}`;
    $('companion-sub').textContent   = 'Tu espacio · PrivacyFirst 🔒';
  } else {
    $('companion-title').textContent = `🤝 ${person.name} — Companion IA`;
    $('companion-sub').textContent   = 'Asistente familiar · Nokia NaC · Gemini AI';
  }
  $('companion-avatar').textContent  = person.avatar;

  // Reset UI
  $('companion-status-badge').textContent   = 'Analizando…';
  $('companion-status-badge').className     = 'companion-status-badge';
  $('companion-location-hint').textContent  = 'Consultando Nokia NaC…';
  $('companion-chat-bubble').innerHTML      = '<div class="companion-chat__spinner"></div>';
  $('csig-zone-label').textContent          = '—';
  $('csig-reach-label').textContent         = '—';
  $('csig-time-label').textContent          = new Date().toLocaleTimeString('es-ES', {hour:'2-digit',minute:'2-digit'});
  $('scam-result').style.display            = 'none';
  $('scam-textarea').value                  = '';

  // Set scam detector profile
  $('scam-analyze-btn').dataset.profileType = profile.type;
  $('scam-analyze-btn').dataset.personName  = person.name;

  // Load companion data
  loadCompanionData(person, profile);

  // Back button
  $('companion-back-btn').onclick = () => {
    setScreen('detail');
    startLocationTracking(person);
  };

  // Refresh button
  $('companion-refresh-btn').onclick = () => loadCompanionData(person, profile);
}

async function loadCompanionData(person, profile) {
  const btn = $('companion-refresh-btn');
  btn.disabled = true;
  $('companion-chat-bubble').innerHTML = '<div class="companion-chat__spinner"></div>';

  try {
    const res  = await fetch(`${API_BASE}/api/v1/companion/analyze`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone_number:  person.phone,
        person_name:   person.name,
        profile_type:  profile.type,
        expected_lat:  person.homeLat  ?? 41.3885,
        expected_lon:  person.homeLon  ?? 2.1781,
        radius_meters: person.homeRadius ?? 350,
        routine_place: profile.routinePlace,
      }),
    });
    const data = await res.json();
    renderCompanionResult(data, profile, person);
  } catch (err) {
    $('companion-chat-bubble').innerHTML = `<p class="companion-error">Error: ${err.message}</p>`;
  } finally {
    btn.disabled = false;
  }
}

function renderCompanionResult(data, profile, person) {
  // Status badge
  const statusCfg = {
    OK:       { label: 'Todo bien ✓',   css: 'status--ok'       },
    AWAY:     { label: 'Fuera de zona', css: 'status--away'     },
    ALERT:    { label: '⚠️ Alerta',     css: 'status--alert'    },
    INACTIVE: { label: 'Sin conexión',  css: 'status--inactive' },
  };
  const cfg = statusCfg[data.status] ?? statusCfg.OK;
  const badge = $('companion-status-badge');
  badge.textContent = cfg.label;
  badge.className   = `companion-status-badge ${cfg.css}`;

  $('companion-location-hint').textContent = data.location_hint;

  // Nokia NaC signals row — friendly labels for teenager
  if (profile.type === 'teenager') {
    $('csig-zone-label').textContent  = data.status === 'OK'
      ? '✓ Todo bien'
      : (data.is_reachable ? `A ${data.distance_meters}m` : '—');
    $('csig-reach-label').textContent = data.is_reachable ? '🟢 Online' : '🔴 Offline';
  } else {
    $('csig-zone-label').textContent  = data.is_reachable
      ? (data.status === 'OK' ? `En zona (${profile.routinePlace})` : `${data.distance_meters}m fuera`)
      : '—';
    $('csig-reach-label').textContent = data.is_reachable ? 'Activo en red' : 'Sin cobertura';
  }

  // Chat bubble
  const bubble = $('companion-chat-bubble');
  bubble.innerHTML = '';
  const msgEl = document.createElement('p');
  msgEl.className = 'companion-msg';
  msgEl.textContent = data.message;
  bubble.appendChild(msgEl);

  // If family should be alerted
  if (data.family_alert && profile.type === 'teenager') {
    const note = document.createElement('p');
    note.className = 'companion-privacy-note';
    note.textContent = '🔒 Solo tú ves este mensaje. Tus padres reciben únicamente una alerta genérica.';
    bubble.appendChild(note);
  }
}

// ── SMS Simulation ─────────────────────────────────────────────

const SCAM_SMS_SAMPLES = [
  {
    sender: 'BBVA',
    text: 'BBVA: Hemos detectado un acceso sospechoso a su cuenta. Su tarjeta ha sido BLOQUEADA. Verifique su identidad en las próximas 24h o perderá acceso permanente: https://bbva-seguridad.verificar-online.com',
  },
  {
    sender: 'CORREOS',
    text: 'Su paquete no pudo ser entregado por falta de pago de aduanas (1,89€). Realice el pago en: https://correos-entrega.pagos-aduanas.net antes de mañana o será devuelto.',
  },
  {
    sender: '+34 611 234 567',
    text: '¡Enhorabuena! Has sido seleccionado como ganador de nuestro sorteo AMAZON. Premio: iPhone 15 Pro. Para reclamarlo introduce tus datos bancarios en: amazon-ganadores.premio-es.com',
  },
  {
    sender: 'HACIENDA',
    text: 'AGENCIA TRIBUTARIA: Tiene una devolución pendiente de 847,20€. Para recibirla introduzca su número de cuenta en: agencia-tributaria.devolucion-2025.es — Plazo: 48h.',
  },
];

let _scamSampleIdx = 0;

$('scam-sim-btn').addEventListener('click', () => {
  const sample = SCAM_SMS_SAMPLES[_scamSampleIdx % SCAM_SMS_SAMPLES.length];
  _scamSampleIdx++;

  // Mostrar tarjeta de mensaje entrante sospechoso
  $('scam-incoming-from').textContent = `SMS · ${sample.sender}`;
  $('scam-incoming').style.display = 'block';
  $('scam-incoming').scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  // Rellenar textarea (oculto bajo details) para el análisis
  $('scam-textarea').value = sample.text;
  $('scam-result').style.display = 'none';

  // Analizar automáticamente tras un breve instante (realismo)
  setTimeout(() => $('scam-analyze-btn').click(), 900);
});

// ── Scam Detector ─────────────────────────────────────────────

$('scam-analyze-btn').addEventListener('click', async () => {
  const text = $('scam-textarea').value.trim();
  if (!text) return;

  const btn         = $('scam-analyze-btn');
  const profileType = btn.dataset.profileType || 'adult';
  const personName  = btn.dataset.personName  || 'usuario';

  btn.disabled    = true;
  btn.textContent = '⏳ Analizando…';
  $('scam-result').style.display = 'none';

  try {
    const res  = await fetch(`${API_BASE}/api/v1/companion/scam-detect`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, person_name: personName, profile_type: profileType }),
    });
    const data = await res.json();
    renderScamResult(data);
  } catch (err) {
    $('scam-result').style.display = 'block';
    $('scam-verdict').textContent  = '⚠️ Error al analizar';
    $('scam-explanation').textContent = err.message;
  } finally {
    btn.disabled    = false;
    btn.textContent = '🔍 Analizar con Gemini';
  }
});

function renderScamResult(data) {
  const resultEl = $('scam-result');
  resultEl.style.display = 'block';
  resultEl.className     = `scam-result ${data.is_scam ? 'scam-result--danger' : 'scam-result--safe'}`;

  const verdict = $('scam-verdict');
  if (data.is_scam) {
    verdict.innerHTML = `🚨 ESTAFA DETECTADA <span class="scam-conf">${data.confidence}% confianza</span>`;
  } else {
    verdict.innerHTML = `✅ MENSAJE SEGURO <span class="scam-conf">${data.confidence}% confianza</span>`;
  }

  $('scam-type').textContent        = data.scam_type;
  $('scam-explanation').textContent = data.explanation;

  const sigEl = $('scam-signals');
  sigEl.innerHTML = '';
  (data.signals || []).forEach(s => {
    const chip = document.createElement('span');
    chip.className   = 'scam-signal-chip';
    chip.textContent = `⚠ ${s}`;
    sigEl.appendChild(chip);
  });

  resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─────────────────────────────────────────────────────────────────
//  AGENT SCREEN — Gemini + Nokia NaC MCP tools (streaming)
// ─────────────────────────────────────────────────────────────────

screens.agent = document.querySelector('[data-screen="agent"]');

const TOOL_META = {
  check_sim_swap:        { icon: '🔐', label: 'SIM Swap API',          api: 'CAMARA SIM Swap' },
  get_location:          { icon: '📡', label: 'Device Location API',   api: 'CAMARA Location' },
  check_geofence:        { icon: '🏠', label: 'Location Verification', api: 'CAMARA Geofencing' },
  check_call_forwarding: { icon: '📞', label: 'Call Forwarding API',   api: 'CAMARA Call Fwd' },
  check_reachability:    { icon: '📶', label: 'Device Reachability',   api: 'CAMARA Reachability' },
};

function openAgentScreen(person) {
  stopLocationTracking();
  setScreen('agent');
  $('agent-question-text').textContent =
    `¿Está ${person.name} en peligro ahora mismo?`;
  $('agent-feed').innerHTML    = '';
  $('agent-final').style.display = 'none';
  $('agent-retry-btn').style.display = 'none';
  startAgentStream(person);
}

$('agent-back-btn').addEventListener('click', () => {
  if (state.agentES) { state.agentES.close(); state.agentES = null; }
  setScreen('detail');
  const person = PERSONS[state.currentIdx];
  if (person) startLocationTracking(person);
});

$('agent-retry-btn').addEventListener('click', () => {
  const person = PERSONS[state.currentIdx];
  if (person) openAgentScreen(person);
});

state.agentES = null;

function startAgentStream(person) {
  const feed = $('agent-feed');
  feed.innerHTML = '';
  $('agent-final').style.display    = 'none';
  $('agent-retry-btn').style.display = 'none';

  const body = JSON.stringify({
    phone_number:  person.phone,
    person_name:   person.name,
    question:      `¿Está ${person.name} en peligro ahora mismo?`,
    expected_lat:  person.homeLat  ?? 41.3885,
    expected_lon:  person.homeLon  ?? 2.1781,
    radius_meters: person.homeRadius ?? 350,
  });

  // SSE via fetch + ReadableStream (más compatible que EventSource para POST)
  fetch(`${API_BASE}/api/v1/agent/stream`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  }).then(res => {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    function read() {
      reader.read().then(({ done, value }) => {
        if (done) {
          $('agent-retry-btn').style.display = 'block';
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();           // keep incomplete line
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const raw = line.slice(5).trim();
          if (raw === '[DONE]') {
            $('agent-retry-btn').style.display = 'block';
            return;
          }
          try { handleAgentEvent(JSON.parse(raw)); } catch (_) {}
        }
        read();
      });
    }
    read();
  }).catch(err => {
    appendFeedItem('error', `Error: ${err.message}`);
    $('agent-retry-btn').style.display = 'block';
  });
}

const _toolCards = {};   // id → DOM element

function handleAgentEvent(ev) {
  switch (ev.type) {
    case 'thinking':
      appendThinking(ev.text);
      break;

    case 'tool_call': {
      const meta = TOOL_META[ev.tool] ?? { icon: '🔧', label: ev.tool, api: ev.tool };
      const card = createToolCard(ev.id, meta, ev.args);
      _toolCards[ev.id] = card;
      $('agent-feed').appendChild(card);
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      break;
    }

    case 'tool_result': {
      const card = _toolCards[ev.id];
      if (card) updateToolCard(card, ev.ok, ev.data, ev.tool);
      break;
    }

    case 'final':
      showFinalAnswer(ev.text);
      break;

    case 'error':
      appendFeedItem('error', ev.text);
      break;
  }
}

function appendThinking(text) {
  const el = document.createElement('div');
  el.className = 'agent-thinking';
  el.innerHTML = `<span class="agent-thinking__dot"></span><span>${text}</span>`;
  $('agent-feed').appendChild(el);
  // Remove after tool_call arrives
  setTimeout(() => el.remove(), 3000);
}

function createToolCard(id, meta, args) {
  const card = document.createElement('div');
  card.className = 'agent-tool-card agent-tool-card--loading';
  card.dataset.id = id;

  const argsStr = Object.entries(args)
    .filter(([k]) => k !== 'phone_number')
    .map(([k, v]) => `${k}: ${typeof v === 'number' ? v.toFixed(4) : v}`)
    .join(' · ') || args.phone_number;

  card.innerHTML = `
    <div class="atc__header">
      <span class="atc__icon">${meta.icon}</span>
      <div class="atc__info">
        <span class="atc__label">${meta.label}</span>
        <span class="atc__api">${meta.api}</span>
      </div>
      <span class="atc__spinner"></span>
    </div>
    <div class="atc__args">${argsStr}</div>
    <div class="atc__result" style="display:none"></div>
  `;
  return card;
}

function updateToolCard(card, ok, data, toolName) {
  card.classList.remove('agent-tool-card--loading');
  card.classList.add(ok ? 'agent-tool-card--ok' : 'agent-tool-card--warn');
  card.querySelector('.atc__spinner').remove();

  const icon = card.querySelector('.atc__icon');
  icon.textContent = ok ? '✅' : '⚠️';

  const resultEl = card.querySelector('.atc__result');
  resultEl.style.display = 'block';
  resultEl.innerHTML = formatToolResult(toolName, data, ok);
}

function formatToolResult(tool, data, ok) {
  if (!ok) return `<span class="atc__err">Error: ${data.error}</span>`;

  const parts = [];
  if (tool === 'check_sim_swap') {
    parts.push(data.sim_swapped
      ? `<b class="atc__bad">⚠ SIM cambiada</b>`
      : `<b class="atc__good">SIM estable</b>`);
    parts.push(`antigüedad: ${data.tenure_days}d`);
    if (data.number_recycled) parts.push(`<b class="atc__bad">número reciclado</b>`);
  } else if (tool === 'get_location') {
    parts.push(`${data.latitude}, ${data.longitude}`);
    parts.push(`±${data.accuracy_meters}m`);
    parts.push(`Kalman: ${data.kalman_readings} lecturas`);
  } else if (tool === 'check_geofence') {
    parts.push(data.is_within_zone
      ? `<b class="atc__good">✓ Dentro de zona</b>`
      : `<b class="atc__bad">✗ FUERA — ${data.distance_meters}m</b>`);
  } else if (tool === 'check_call_forwarding') {
    parts.push(data.call_forwarding_active
      ? `<b class="atc__bad">⚠ Desvío activo</b>`
      : `<b class="atc__good">Sin desvío</b>`);
    parts.push(data.is_verified ? 'número verificado' : 'número NO verificado');
  } else if (tool === 'check_reachability') {
    parts.push(data.is_reachable
      ? `<b class="atc__good">Activo en red</b>`
      : `<b class="atc__bad">Inactivo</b>`);
  } else {
    parts.push(JSON.stringify(data).slice(0, 80));
  }
  return parts.join(' · ');
}

function showFinalAnswer(text) {
  const finalEl = $('agent-final');
  $('agent-final-text').textContent = text;
  finalEl.style.display = 'block';
  finalEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function appendFeedItem(type, text) {
  const el = document.createElement('div');
  el.className = `agent-feed-msg agent-feed-msg--${type}`;
  el.textContent = text;
  $('agent-feed').appendChild(el);
}

// ─────────────────────────────────────────────────────────────────
//  DEMO WALK — simula que Aitor sale de la zona segura
// ─────────────────────────────────────────────────────────────────
const AITOR_PHONE = '+34640197102';

// Ruta: desde el centro Nokia NaC hacia el exterior (pasos de ~120m NE)
const DEMO_WALK_PATH = [
  { lat: 41.3885, lon: 2.1781, acc: 150 },  // paso 0 — dentro, centro
  { lat: 41.3893, lon: 2.1791, acc: 130 },  // paso 1 — dentro ~120m
  { lat: 41.3900, lon: 2.1801, acc: 115 },  // paso 2 — dentro ~240m
  { lat: 41.3908, lon: 2.1812, acc: 100 },  // paso 3 — límite ~360m ⚠️
  { lat: 41.3917, lon: 2.1824, acc: 90  },  // paso 4 — FUERA ~490m 🚨
  { lat: 41.3927, lon: 2.1838, acc: 80  },  // paso 5 — FUERA ~640m 🚨
];

state.demoActive    = false;
state.demoStepIdx   = 0;
state.demoInterval  = null;

async function runDemoWalk() {
  const person = PERSONS.find(p => p.phone === AITOR_PHONE);
  if (!person || state.demoActive) return;

  state.demoActive  = true;
  state.demoStepIdx = 0;

  const btn = $('demo-walk-btn');
  btn.disabled = true;
  btn.textContent = '🚶 Simulando salida…';

  // Detener polling real de localización durante el demo
  stopLocationTracking();
  if (state.map) state.trailPoints = [];

  function step() {
    const pt = DEMO_WALK_PATH[state.demoStepIdx];
    const isOutside = state.demoStepIdx >= 3;

    // Mover marker en el mapa
    const fakeLoc = {
      latitude:          pt.lat,
      longitude:         pt.lon,
      accuracy_meters:   pt.acc,
      kalman_confidence: 0.9,
      kalman_readings:   state.demoStepIdx + 4,
    };
    updateMap(fakeLoc, person);

    // Colorear zona segura según si está dentro/fuera
    if (state.safeCircle) {
      state.safeCircle.setStyle({
        color:       isOutside ? '#ea4335' : '#34a853',
        fillOpacity: isOutside ? 0.12       : 0.07,
      });
    }

    // Badge de situación
    $('detail-badge').textContent = isOutside ? '¡FUERA DE ZONA!' : 'En zona';
    $('detail-badge').className   = `risk-badge ${isOutside ? 'risk--high-risk' : 'risk--safe'}`;

    state.demoStepIdx++;

    if (state.demoStepIdx < DEMO_WALK_PATH.length) {
      state.demoInterval = setTimeout(step, 1600);
    } else {
      // Último paso: full-check con la posición forzada
      btn.textContent = '⏳ Consultando Nokia NaC…';
      triggerDemoAlert(person, pt);
    }
  }

  step();
}

async function triggerDemoAlert(person, exitPt) {
  const now = new Date();
  const body = {
    phone_number: person.phone,
    context: {
      expected_zone: 'Fira Montjuïc',
      expected_lat:   person.homeLat,
      expected_lon:   person.homeLon,
      radius_meters:  person.homeRadius,
      force_lat:      exitPt.lat,
      force_lon:      exitPt.lon,
      hour:           now.getHours(),
      day_type:       'weekday',
    },
  };
  try {
    const res  = await fetch(`${API_BASE}/api/v1/protection/full-check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    state.persons[person.phone] = data;
    state.lastCheckTime[person.phone] = new Date();
    if (!state.riskHistory[person.phone]) state.riskHistory[person.phone] = [];
    state.riskHistory[person.phone].push({ score: data.risk_score, ts: new Date() });
    if (state.riskHistory[person.phone].length > 20) state.riskHistory[person.phone].shift();
    renderDetail(data, person);
    updateCardUI(person.phone, data);
  } catch (err) {
    console.error('demo alert error:', err);
  } finally {
    state.demoActive = false;
    const btn = $('demo-walk-btn');
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🚶 Demo: Salir de zona';
    }
    // Reanudar tracking real
    startLocationTracking(person);
  }
}

// ─────────────────────────────────────────────────────────────────
//  INICIALIZACIÓN
// ─────────────────────────────────────────────────────────────────
initPersonGrid();
refreshAll(); // carga inicial de todos

// Auto-refresh cada 60 segundos
state.refreshInterval = setInterval(refreshAll, 60000);
