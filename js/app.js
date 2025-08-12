/* global L */
const statusEl = document.getElementById("status");
const form = document.getElementById("search-form");
const input = document.getElementById("search-input");
const resultsList = document.getElementById("search-results");
const locateBtn = document.getElementById("locate-btn");

// Map
const map = L.map("map", { zoomControl: true, center: [47.3769, 8.5417], zoom: 12 });

// Tile-layer helper
function tl(url, opts = {}) {
  const retina = url.includes("@2x");
  return L.tileLayer(url, {
    maxZoom: 20,
    crossOrigin: true,
    ...(retina ? { tileSize: 512, zoomOffset: -1 } : {}),
    ...opts,
  }).on("tileerror", () => {
    statusEl.textContent = "Hinweis: Kachelserver aktuell nicht erreichbar.";
  });
}

// Base layers
const baseLayers = {
  "OSM Standard": tl("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }),
  "OSM Bright": tl(
    "https://api.maptiler.com/maps/bright-v2/256/{z}/{x}/{y}@2x.png?key=62fWxjuKZdoP6vlFjq0a",
    { attribution: '&copy; MapTiler &copy; OpenStreetMap contributors' }
  ),
  "Swisstopo light": tl(
    "https://api.maptiler.com/maps/ch-swisstopo-lbm/256/{z}/{x}/{y}@2x.png?key=62fWxjuKZdoP6vlFjq0a",
    { attribution: '&copy; swisstopo &copy; MapTiler' }
  ),
  "OpenTopoMap": tl("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
    maxZoom: 17,
    attribution: 'Map data &copy; OpenStreetMap | Style &copy; OpenTopoMap (CC-BY-SA)',
  }),
};

// Persist active base layer
const LS_KEY = "my-map-baselayer";
const savedBase = localStorage.getItem(LS_KEY);
const initialBaseName = savedBase && baseLayers[savedBase] ? savedBase : Object.keys(baseLayers)[0];
baseLayers[initialBaseName].addTo(map);
map.on("baselayerchange", (e) => { localStorage.setItem(LS_KEY, e.name); statusEl.textContent = ""; });

// Marker-Overlay
const markers = L.markerClusterGroup ? L.markerClusterGroup() : L.layerGroup();
map.addLayer(markers);

// --- Wetter-Radar (RainViewer) ---------------------------------------------
// Quelle & Pattern: Frames von https://api.rainviewer.com/public/weather-maps.json,
// Tiles: https://tilecache.rainviewer.com{frame.path}/256/{z}/{x}/{y}/2/1_1.png
let radarLayer = null;
let radarFramePath = null;
let radarTimer = null;

async function fetchLatestRadarPath() {
  const res = await fetch("https://api.rainviewer.com/public/weather-maps.json");
  if (!res.ok) throw new Error("RainViewer nicht erreichbar");
  const data = await res.json();
  // Nimm den neuesten Nowcast-Frame
  const path = data?.radar?.nowcast?.[0]?.path || null;
  return path; // z.B. "/v2/radar/nowcast_XXXXXXXX"
}

async function ensureRadarLayer() {
  try {
    // wenn wir bereits einen aktuellen Frame haben, nichts tun
    if (!radarFramePath) radarFramePath = await fetchLatestRadarPath();

    if (!radarLayer && radarFramePath) {
      radarLayer = L.tileLayer(
        `https://tilecache.rainviewer.com${radarFramePath}/256/{z}/{x}/{y}/2/1_1.png`,
        {
          opacity: 0.6,
          zIndex: 5,
          maxZoom: 18,
          attribution: 'Radar © <a href="https://www.rainviewer.com/">RainViewer</a>',
        }
      );
      // Wenn Nutzer es in der Layers-Control aktiviert, fügen wir es hinzu (siehe unten)
    }
  } catch (e) {
    console.warn("Radar konnte nicht geladen werden:", e);
  }
}

// Radar regelmäßig aktualisieren (alle 5 Minuten)
async function refreshRadar() {
  try {
    const newPath = await fetchLatestRadarPath();
    if (newPath && newPath !== radarFramePath) {
      radarFramePath = newPath;
      if (radarLayer && map.hasLayer(radarLayer)) {
        radarLayer.setUrl(`https://tilecache.rainviewer.com${radarFramePath}/256/{z}/{x}/{y}/2/1_1.png`);
      }
    }
  } catch (e) {
    // leise ignorieren
  }
}
ensureRadarLayer();
radarTimer = setInterval(refreshRadar, 5 * 60 * 1000);
// ---------------------------------------------------------------------------

// Controls (mit Radar-Overlay)
const overlays = { Marker: markers };
// Radar erst eintragen, wenn initial geladen/gebaut
ensureRadarLayer().then(() => {
  if (radarLayer) overlays["Niederschlag (Radar)"] = radarLayer;
  layersCtrl.remove(); // neu aufbauen, damit Reihenfolge stimmt
  layersCtrl = L.control.layers(baseLayers, overlays, { position: "topright", collapsed: false }).addTo(map);
});

// Layers-Control initial
let layersCtrl = L.control.layers(baseLayers, overlays, { position: "topright", collapsed: false }).addTo(map);

// Maßstab
L.control.scale({ imperial: false }).addTo(map);

// UI-Events nicht auf Karte durchreichen
(function preventUiPropagation() {
  const uiSelectors = [".site-header", ".search", "#search-results", ".leaflet-control-container"];
  uiSelectors.forEach((sel) => {
    const el = document.querySelector(sel);
    if (el && L && L.DomEvent) {
      L.DomEvent.disableClickPropagation(el);
      L.DomEvent.disableScrollPropagation(el);
    }
  });
})();

const setStatus = (msg) => (statusEl.textContent = msg || "");

// Debounce util
let debounceTimer;
const debounce = (fn, ms = 350) => (...args) => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => fn(...args), ms);
};

// Icons für Such-/Popup-Typen
const ICONS = {
  amenity: "🏪", place: "📍", highway: "🛣️", railway: "🚆", aeroway: "✈️",
  tourism: "🗺️", natural: "🏞️", shop: "🛍️", building: "🏢", leisure: "🎯",
  landuse: "🧭", waterway: "🌊", boundary: "🧭", office: "🏛️",
};
const getClass = (obj={}) => obj.class || obj.category || "";
const popupIconFor = (obj={}) => (ICONS[getClass(obj)] || "📌");

function humanTypeLabel(cls, typ) {
  const pretty = String(typ || "").replace(/_/g, " ");
  return [cls, pretty].filter(Boolean).join(" · ");
}
function humanType(p) {
  const cls = p.class || p.category || "";
  return humanTypeLabel(cls, p.type || "");
}

function clearResults() {
  resultsList.innerHTML = "";
  input.setAttribute("aria-expanded", "false");
}

function renderResultItem(p, idx) {
  const li = document.createElement("li");
  li.id = `search-opt-${idx}`;
  li.setAttribute("role", "option");

  const cls = p.class || p.category || "";
  const iconChar = ICONS[cls] || "📌";

  const icn = document.createElement("span");
  icn.className = "srch-icn";
  icn.textContent = iconChar;

  const main = document.createElement("span");
  main.className = "srch-main";
  main.textContent = p.display_name;

  const badge = document.createElement("span");
  badge.className = "srch-type";
  badge.textContent = humanType(p);

  li.append(icn, main, badge);
  li.addEventListener("click", () => selectPlace(p));
  return li;
}
function showResults(items) {
  resultsList.innerHTML = "";
  items.forEach((p, idx) => resultsList.appendChild(renderResultItem(p, idx)));
  input.setAttribute("aria-expanded", "true");
}

// suppress reverse after programmatic flyTo
let suppressNextReverse = false;

// Select from autocomplete → marker + fly
function selectPlace(p) {
  const lat = parseFloat(p.lat);
  const lon = parseFloat(p.lon);
  markers.clearLayers();

  const popupHTML = buildPopupHTML({
    class: p.class || p.category,
    type: p.type,
    address: p.address || {},
    display_name: p.display_name || "",
    name: p.name || ""
  }, { fromCache: false, weather: undefined });

  const m = L.marker([lat, lon]).bindPopup(popupHTML, { autoPan: false }).addTo(markers);
  m.openPopup();

  // Wetter zweistufig laden
  enhancePopupWithWeather([lat, lon], m);

  suppressNextReverse = true;
  map.flyTo([lat, lon], 14, { duration: 0.8 });
  setTimeout(() => (suppressNextReverse = false), 300);

  setStatus("");
  clearResults();
}

// Suche (Nominatim)
async function searchPlaces(query) {
  if (!query) return clearResults();
  setStatus("Suche läuft …");
  try {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("limit", "8");

    const res = await fetch(url.toString(), { headers: { "Accept-Language": "de" } });
    if (!res.ok) throw new Error("Nominatim nicht erreichbar");
    const data = await res.json();

    if (!data.length) {
      clearResults();
      return setStatus("Nichts gefunden.");
    }

    showResults(data);
    setStatus(`${data.length} Treffer.`);
  } catch (e) {
    setStatus("Fehler bei der Suche.");
    clearResults();
    console.error(e);
  }
}

// Form & input
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const first = resultsList.querySelector("li");
  if (first) first.click();
  else searchPlaces(input.value.trim());
});
input.addEventListener("input", debounce(() => {
  const q = input.value.trim();
  if (q.length >= 3) searchPlaces(q);
  else clearResults();
}, 350));
input.addEventListener("keydown", (e) => {
  const items = Array.from(resultsList.querySelectorAll("li"));
  if (!items.length) return;

  const currentIndex = items.findIndex((li) => li.getAttribute("aria-selected") === "true");
  if (e.key === "ArrowDown") {
    e.preventDefault();
    const next = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
    items.forEach((li) => li.setAttribute("aria-selected", "false"));
    items[next].setAttribute("aria-selected", "true");
    items[next].scrollIntoView({ block: "nearest" });
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    const prev = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
    items.forEach((li) => li.setAttribute("aria-selected", "false"));
    items[prev].setAttribute("aria-selected", "true");
    items[prev].scrollIntoView({ block: "nearest" });
  } else if (e.key === "Enter") {
    e.preventDefault();
    const active = items.find((li) => li.getAttribute("aria-selected") === "true") || items[0];
    if (active) active.click();
  } else if (e.key === "Escape") {
    clearResults();
  }
});
document.addEventListener("click", (e) => { if (!e.target.closest(".search")) clearResults(); });

// Geolocation
locateBtn.addEventListener("click", () => {
  clearResults();
  if (!navigator.geolocation) return setStatus("Geolokalisierung nicht verfügbar.");
  setStatus("Bestimme Standort …");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      const here = L.marker([latitude, longitude]).bindPopup("Du bist hier");
      markers.addLayer(here);

      suppressNextReverse = true;
      map.flyTo([latitude, longitude], 15, { duration: 0.6 });
      setTimeout(() => (suppressNextReverse = false), 300);

      setStatus("");
    },
    () => setStatus("Konnte Standort nicht bestimmen.")
  );
});

// Header toggle
const headerToggle = document.getElementById("header-toggle");
const BODY = document.body;
const HDR_KEY = "my-map-header-condensed";
function setCondensed(on) {
  BODY.classList.toggle("is-condensed", on);
  if (headerToggle) {
    headerToggle.setAttribute("aria-expanded", String(!on));
    headerToggle.textContent = on ? "▲" : "▼";
  }
  try { localStorage.setItem(HDR_KEY, on ? "1" : "0"); } catch {}
}
try { const saved = localStorage.getItem(HDR_KEY); if (saved === "1") setCondensed(true); } catch {}
if (headerToggle) {
  headerToggle.addEventListener("click", () => setCondensed(!BODY.classList.contains("is-condensed")));
  headerToggle.textContent = BODY.classList.contains("is-condensed") ? "▲" : "▼";
}

/* =========================
   Reverse-Geocoding + FAST Weather (Open-Meteo)
   ========================= */

map.off("click"); // ensure single handler
let reverseAbort = null;

/** Reverse cache (~50 m grid) */
const REV_TTL_MS = 24 * 60 * 60 * 1000;
const REV_GRID = 0.0005; // ~55 m
const REV_LRU_MAX = 200;
const revCache = new Map();
const cacheKey = (lat, lon) => `${(Math.round(lat/REV_GRID)*REV_GRID).toFixed(6)},${(Math.round(lon/REV_GRID)*REV_GRID).toFixed(6)}`;
function cacheGet(lat, lon) {
  const k = cacheKey(lat, lon); const v = revCache.get(k);
  if (!v) return null; if (Date.now()-v.t>REV_TTL_MS) { revCache.delete(k); return null; }
  revCache.delete(k); revCache.set(k, v); return v.data;
}
function cacheSet(lat, lon, data) {
  const k = cacheKey(lat, lon);
  if (revCache.has(k)) revCache.delete(k);
  revCache.set(k, { data, t: Date.now() });
  if (revCache.size > REV_LRU_MAX) revCache.delete(revCache.keys().next().value);
}

// HTML escape
const escapeHTML = (s="") => String(s)
  .replace(/&/g,"&amp;").replace(/</g,"&lt;")
  .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");

// Address helpers
function formatAddressLine(addr={}) {
  const road = addr.road || addr.pedestrian || addr.cycleway || addr.footway || addr.path || "";
  const num  = addr.house_number || "";
  return [road, num].filter(Boolean).join(" ").trim();
}
function formatLocality(addr={}) {
  const hood = addr.neighbourhood || addr.suburb || addr.city_district || "";
  const place = addr.city || addr.town || addr.village || addr.hamlet || addr.municipality || "";
  const line1 = [addr.postcode, place].filter(Boolean).join(" ");
  return [hood, line1, addr.country].filter(Boolean).join(", ");
}
function splitDisplayName(display="") {
  const parts = String(display).split(",").map(s=>s.trim()).filter(Boolean);
  return { title: parts[0] || "", subtitle: parts.slice(1).join(", ") || "" };
}

function buildWeatherRow({ temperature=null, apparent=null, wind=null, nextHourProb=null } = {}) {
  const t  = temperature !== null ? `${temperature.toFixed(1)} °C` : "–";
  const tf = apparent    !== null ? `${apparent.toFixed(1)} °C`    : "–";
  const w  = wind        !== null ? `${wind.toFixed(1)} m/s`       : "–";
  const p  = nextHourProb !== null ? `${nextHourProb}%`            : "–";
  return `
    <div class="popup-weather" aria-label="Wetter">
      <span class="w-pill"><span class="wx-temp">🌡 ${t}</span></span>
      <span class="w-pill"><span class="wx-feels">🤔 gefühlt ${tf}</span></span>
      <span class="w-pill"><span class="wx-wind">💨 ${w}</span></span>
      <span class="w-pill"><span class="wx-prob">🌧 ${p} in 1 h</span></span>
    </div>`;
}

// Build popup with a weather placeholder row (for fast perceived load)
function buildPopupHTML(data, meta = { fromCache: false, weather: undefined }) {
  const ICONS = {
    amenity: "🏪", place: "📍", highway: "🛣️", railway: "🚆", aeroway: "✈️",
    tourism: "🗺️", natural: "🏞️", shop: "🛍️", building: "🏢", leisure: "🎯",
    landuse: "🧭", waterway: "🌊", boundary: "🧭", office: "🏛️",
  };
  const cls = (data.class || data.category || "");
  const icon = ICONS[cls] || "📌";

  const addr = data.address || {};
  const display = data.display_name || "";
  const titleAddr = formatAddressLine(addr);
  const name = data.name && String(data.name).trim();
  let title = name || titleAddr;
  let subtitle = formatLocality(addr);
  if (!title || !subtitle) {
    const { title: t2, subtitle: s2 } = splitDisplayName(display);
    if (!title) title = t2;
    if (!subtitle) subtitle = s2;
  }
  if (!title && display) title = display;
  if (!subtitle && display) subtitle = display;

  const badge = humanTypeLabel(cls, data.type || "");
  const note = `Quelle: Nominatim${meta.fromCache ? " · aus Cache" : ""}`;

  const wxRow = meta.weather === undefined
    ? `<div class="popup-weather"><span class="w-pill">⏳ Wetter wird geladen …</span></div>`
    : buildWeatherRow(meta.weather);

  return `
    <div class="popup">
      <div class="popup-header">
        <div class="popup-icn">${icon}</div>
        <div class="popup-title">${escapeHTML(title || "Adresse")}</div>
      </div>
      <div class="popup-sub">${escapeHTML(subtitle || "")}</div>
      ${badge ? `<div class="popup-note">${escapeHTML(badge)} · ${note}</div>` : `<div class="popup-note">${note}</div>`}
      ${wxRow}
    </div>
  `;
}

/* ---------- FAST WEATHER: zweistufig ---------- */

// 1) CURRENT
async function fetchWeatherCurrent(lat, lon, signal) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("current", "temperature_2m,apparent_temperature,wind_speed_10m");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("timeformat", "unixtime");
  url.searchParams.set("forecast_days", "1");
  const res = await fetch(url.toString(), { signal });
  if (!res.ok) throw new Error("Open-Meteo (current) nicht erreichbar");
  const data = await res.json();
  const cur = data.current || {};
  return {
    temperature: Number.isFinite(cur.temperature_2m) ? cur.temperature_2m : null,
    apparent: Number.isFinite(cur.apparent_temperature) ? cur.apparent_temperature : null,
    wind: Number.isFinite(cur.wind_speed_10m) ? cur.wind_speed_10m : null,
    nextHourProb: null,
  };
}

// 2) PRECIP PROB
async function fetchPrecipProbNextHour(lat, lon, signal) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("hourly", "precipitation_probability");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("timeformat", "unixtime");
  url.searchParams.set("forecast_days", "1");
  const res = await fetch(url.toString(), { signal });
  if (!res.ok) throw new Error("Open-Meteo (hourly) nicht erreichbar");
  const data = await res.json();
  const times = data.hourly?.time || [];
  const probs = data.hourly?.precipitation_probability || [];
  const now = Math.floor(Date.now() / 1000);
  let idx = -1;
  for (let i = 0; i < times.length; i++) { if (times[i] >= now) { idx = i; break; } }
  const prob = (idx !== -1 && probs[idx] != null) ? probs[idx] : null;
  return prob;
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

function getPopupElement(p) {
  const popup = p.getPopup ? p.getPopup() : p;
  if (!popup) return null;
  return popup.getElement ? popup.getElement() : null;
}

async function enhancePopupWithWeather([lat, lon], boundTo) {
  const popup = boundTo.getPopup ? boundTo.getPopup() : boundTo;
  if (!popup) return;

  try {
    const current = await withTimeout(fetchWeatherCurrent(lat, lon), 1200);
    const html = popup.getContent();
    const newHtml = html.replace(
      /<div class="popup-weather[\s\S]*?<\/div>/,
      buildWeatherRow(current)
    );
    popup.setContent(newHtml);

    fetchPrecipProbNextHour(lat, lon).then((prob) => {
      const el = getPopupElement(popup);
      if (!el) return;
      const probSpan = el.querySelector(".wx-prob");
      if (probSpan) probSpan.textContent = `🌧 ${prob !== null ? prob + "%" : "–"} in 1 h`;
    }).catch(() => {});
  } catch {
    fetchPrecipProbNextHour(lat, lon).then((prob) => {
      const el = getPopupElement(popup);
      if (!el) return;
      const probSpan = el.querySelector(".wx-prob");
      if (probSpan) probSpan.textContent = `🌧 ${prob !== null ? prob + "%" : "–"} in 1 h`;
    }).catch(() => {});
  }
}

// Reverse lookup (fallback zooms)
async function reverseLookup(lat, lon, signal) {
  const zooms = [16, 14, 12, 18, 10];
  for (const z of zooms) {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("lat", lat);
    url.searchParams.set("lon", lon);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("zoom", String(z));

    const res = await fetch(url.toString(), { headers: { "Accept-Language": "de" }, signal });
    if (!res.ok) { if (res.status === 429) throw new Error("Rate limit (429)"); continue; }
    const data = await res.json();
    if (!data || data.error) continue;
    const hasDisplay = !!data.display_name;
    const hasAddress = data.address && Object.keys(data.address).length > 0;
    if (hasDisplay || hasAddress) return data;
  }
  return null;
}

const mapIsBusy = () =>
  map._animating === true ||
  !!(map.dragging && map.dragging._draggable && map.dragging._draggable._moving);

map.on("click", async (e) => {
  const oe = e.originalEvent;
  if (mapIsBusy() || suppressNextReverse) return;
  if (oe && oe.target && (oe.target.closest(".leaflet-control") || oe.target.closest(".search") || oe.target.closest("#search-results") || oe.target.closest(".site-header"))) return;
  if (oe && typeof oe.button === "number" && oe.button !== 0) return;

  const { lat, lng } = e.latlng;

  const cached = cacheGet(lat, lng);
  let data = cached;
  let fromCache = !!cached;

  setStatus("Lade Adresse …");
  if (!data) {
    try { reverseAbort?.abort(); } catch {}
    reverseAbort = new AbortController();
    data = await reverseLookup(lat, lng, reverseAbort.signal);
    if (data) { cacheSet(lat, lng, data); fromCache = false; }
  }

  if (!data) {
    setStatus("Hier wurde keine Adresse gefunden.");
    const html = `
      <div class="popup">
        <div class="popup-header"><div class="popup-icn">📌</div><div class="popup-title">Kein Adress-Treffer</div></div>
        <div class="popup-sub">${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
        <div class="popup-note">Quelle: Nominatim</div>
        <div class="popup-weather"><span class="w-pill">⏳ Wetter wird geladen …</span></div>
      </div>`;
    const p = L.popup({ autoPan: false }).setLatLng([lat, lng]).setContent(html).openOn(map);
    enhancePopupWithWeather([lat, lng], p);
    return;
  }

  const popupHTML = buildPopupHTML(data, { fromCache, weather: undefined });
  const popup = L.popup({ autoPan: false }).setLatLng([lat, lng]).setContent(popupHTML).openOn(map);
  setStatus("");

  enhancePopupWithWeather([lat, lng], popup);
});
    