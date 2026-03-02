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
    homeLat: 41.4004, homeLon: 2.1939, homeRadius: 5000,
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
  const conf = locData.kalman_confidence;
  const reads = locData.kalman_readings;
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
//  INICIALIZACIÓN
// ─────────────────────────────────────────────────────────────────
initPersonGrid();
refreshAll(); // carga inicial de todos

// Auto-refresh cada 60 segundos
state.refreshInterval = setInterval(refreshAll, 60000);
