/* global L */
const statusEl = document.getElementById("status");
const form = document.getElementById("search-form");
const input = document.getElementById("search-input");
const resultsList = document.getElementById("search-results");
const locateBtn = document.getElementById("locate-btn");

// Karte anlegen
const map = L.map("map", { zoomControl: true, center: [47.3769, 8.5417], zoom: 12 });

// Helper für Tile-Layer (@2x → Retina)
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

// Basiskarten
const baseLayers = {
  "OSM Standard": tl("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }),
  "OSM Bright": tl(
    "https://api.maptiler.com/maps/bright-v2/256/{z}/{x}/{y}@2x.png?key=62fWxjuKZdoP6vlFjq0a",
    {
      attribution:
        '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> ' +
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }
  ),
  "Swisstopo light": tl(
    "https://api.maptiler.com/maps/ch-swisstopo-lbm/256/{z}/{x}/{y}@2x.png?key=62fWxjuKZdoP6vlFjq0a",
    {
      attribution:
        '&copy; <a href="https://www.swisstopo.admin.ch/">swisstopo</a> ' +
        '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a>',
    }
  ),
  "OpenTopoMap": tl("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
    maxZoom: 17,
    attribution:
      'Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }),
};

// Zuletzt verwendete Basiskarte merken
const LS_KEY = "my-map-baselayer";
const savedBase = localStorage.getItem(LS_KEY);
const initialBaseName =
  savedBase && baseLayers[savedBase] ? savedBase : Object.keys(baseLayers)[0];
baseLayers[initialBaseName].addTo(map);
map.on("baselayerchange", (e) => {
  localStorage.setItem(LS_KEY, e.name);
  statusEl.textContent = "";
});

// Marker-Layer
const markers = L.markerClusterGroup ? L.markerClusterGroup() : L.layerGroup();
map.addLayer(markers);

// Layer-Control (ohne Hamburger → immer offen)
L.control.layers(baseLayers, { Marker: markers }, { position: "topright", collapsed: false }).addTo(map);

// Maßstab
L.control.scale({ imperial: false }).addTo(map);

// ---- UI-Events dürfen nicht auf die Karte „durchschlagen“ ----
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

// Status-Helfer
const setStatus = (msg) => (statusEl.textContent = msg || "");

// Debounce
let debounceTimer;
const debounce = (fn, ms = 350) => (...args) => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => fn(...args), ms);
};

// --- Autocomplete mit Icon/Typ ---
const ICONS = {
  amenity: "🏪",
  place: "📍",
  highway: "🛣️",
  railway: "🚆",
  aeroway: "✈️",
  tourism: "🗺️",
  natural: "🏞️",
  shop: "🛍️",
  building: "🏢",
  leisure: "🎯",
  landuse: "🧭",
  waterway: "🌊",
  boundary: "🧭",
  office: "🏛️",
};

function humanTypeLabel(cls, typ) {
  const pretty = String(typ || "").replace(/_/g, " ");
  return [cls, pretty].filter(Boolean).join(" · ");
}
function humanType(p) {
  // Such-Resultate liefern meist 'class', Reverse liefert 'category'
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

// Unterdrückung von Reverse-Geocoding direkt nach flyTo()
let suppressNextReverse = false;

// Ort auswählen: Marker setzen & zoomen (Popup mit schönem Layout)
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
  }, { fromCache: false });

  markers.addLayer(L.marker([lat, lon]).bindPopup(popupHTML, { autoPan: false }));

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

// Formular & Input
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const first = resultsList.querySelector("li");
  if (first) first.click();
  else searchPlaces(input.value.trim());
});

input.addEventListener(
  "input",
  debounce(() => {
    const q = input.value.trim();
    if (q.length >= 3) searchPlaces(q);
    else clearResults();
  }, 350)
);

// Tastaturnavigation im Dropdown
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

// Klick außerhalb schließt die Liste
document.addEventListener("click", (e) => {
  if (!e.target.closest(".search")) clearResults();
});

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

// --- Header: kompakt/expandierbar ---
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

try {
  const saved = localStorage.getItem(HDR_KEY);
  if (saved === "1") setCondensed(true);
} catch {}

if (headerToggle) {
  headerToggle.addEventListener("click", () => {
    setCondensed(!BODY.classList.contains("is-condensed"));
  });
  headerToggle.textContent = BODY.classList.contains("is-condensed") ? "▲" : "▼";
}

/* =========================
   Reverse-Geocoding (schnell + Cache + schönes Popup)
   ========================= */

// Alte Click-Handler (falls vorhanden) entfernen, dann genau einen setzen
map.off("click");

let reverseAbort = null;

/** Mini-Cache für Reverse-Geocoding (≈50 m Raster) */
const REV_TTL_MS = 24 * 60 * 60 * 1000;
const REV_GRID = 0.0005; // ≈ 55 m
const REV_LRU_MAX = 200;
const revCache = new Map();

function cacheKey(lat, lon) {
  const r = REV_GRID;
  const klat = Math.round(lat / r) * r;
  const klon = Math.round(lon / r) * r;
  return `${klat.toFixed(6)},${klon.toFixed(6)}`;
}
function cacheGet(lat, lon) {
  const k = cacheKey(lat, lon);
  const v = revCache.get(k);
  if (!v) return null;
  if (Date.now() - v.t > REV_TTL_MS) {
    revCache.delete(k);
    return null;
  }
  // LRU bump
  revCache.delete(k);
  revCache.set(k, v);
  return v.data;
}
function cacheSet(lat, lon, data) {
  const k = cacheKey(lat, lon);
  if (revCache.has(k)) revCache.delete(k);
  revCache.set(k, { data, t: Date.now() });
  if (revCache.size > REV_LRU_MAX) {
    const firstKey = revCache.keys().next().value;
    revCache.delete(firstKey);
  }
}

// Utility: sicheres HTML
function escapeHTML(s = "") {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// Adressbausteine
function formatAddressLine(addr = {}) {
  // Straße + Hausnummer
  const road = addr.road || addr.pedestrian || addr.cycleway || addr.footway || addr.path || "";
  const num  = addr.house_number || "";
  return [road, num].filter(Boolean).join(" ").trim();
}
function formatLocality(addr = {}) {
  // Feinere Ortsangaben zuerst
  const hood = addr.neighbourhood || addr.suburb || addr.city_district || "";
  const place =
    addr.city || addr.town || addr.village || addr.hamlet || addr.municipality || "";
  const line1 = [addr.postcode, place].filter(Boolean).join(" ");
  return [hood, line1, addr.country].filter(Boolean).join(", ");
}

// display_name in Titel/Untertitel splitten
function splitDisplayName(display = "") {
  const parts = String(display).split(",").map(s => s.trim()).filter(Boolean);
  if (!parts.length) return { title: "", subtitle: "" };
  return { title: parts[0], subtitle: parts.slice(1).join(", ") };
}

// Schnellere Fallback-Reihenfolge (weniger Stufen)
async function reverseLookup(lat, lon, signal) {
  const zooms = [16, 14, 12, 18, 10];
  for (const z of zooms) {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("lat", lat);
    url.searchParams.set("lon", lon);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("zoom", String(z));

    const res = await fetch(url.toString(), {
      headers: { "Accept-Language": "de" },
      signal,
    });

    if (!res.ok) {
      if (res.status === 429) throw new Error("Rate limit (429)");
      continue;
    }
    const data = await res.json();
    if (!data || data.error) continue;

    const hasDisplay = !!data.display_name;
    const hasAddress = data.address && Object.keys(data.address).length > 0;
    if (hasDisplay || hasAddress) return data;
  }
  return null;
}

// Leaflet-Status: animiert oder dragging?
function mapIsBusy() {
  const anim = map._animating === true;
  const dragging = !!(map.dragging && map.dragging._draggable && map.dragging._draggable._moving);
  return anim || dragging;
}

// Icon & Klasse bestimmen
function getClass(obj = {}) {
  return obj.class || obj.category || "";
}
function popupIconFor(obj = {}) {
  const cls = getClass(obj);
  return ICONS[cls] || "📌";
}

// Popup-Inhalt generieren — jetzt mit Hausnummer & POI-Badge
function buildPopupHTML(data, meta = { fromCache: false }) {
  const icon = popupIconFor(data);
  const addr = data.address || {};
  const display = data.display_name || "";
  const cls = getClass(data);
  const typ = data.type || "";

  // POI-Name? → als Titel
  const addrLine = formatAddressLine(addr); // Straße + Nr
  const name = data.name && String(data.name).trim();
  let title = name || addrLine;

  // Untertitel: Locality-Linie (PLZ Ort, Land), falls vorhanden
  let subtitle = formatLocality(addr);

  // Wenn uns etwas fehlt, aus display_name splitten
  if (!title || !subtitle) {
    const { title: t2, subtitle: s2 } = splitDisplayName(display);
    if (!title) title = t2;
    if (!subtitle) subtitle = s2;
  }
  // Harte Fallbacks
  if (!title && display) title = display;
  if (!subtitle && display) subtitle = display;

  // Badge (Kategorie/Typ) – z. B. "amenity · restaurant"
  const badge = humanTypeLabel(cls, typ);

  return `
    <div class="popup">
      <div class="popup-header">
        <div class="popup-icn">${icon}</div>
        <div class="popup-title">${escapeHTML(title || "Adresse")}</div>
      </div>
      <div class="popup-sub">${escapeHTML(subtitle || "")}</div>
      ${badge ? `<div class="popup-note">${escapeHTML(badge)} · Quelle: Nominatim${meta.fromCache ? " · aus Cache" : ""}</div>` : `<div class="popup-note">Quelle: Nominatim${meta.fromCache ? " · aus Cache" : ""}</div>`}
    </div>
  `;
}

map.on("click", async (e) => {
  const oe = e.originalEvent;

  // Nicht während Animation/Drag oder direkt nach programmatischem flyTo
  if (mapIsBusy() || suppressNextReverse) return;

  // UI-Klicks ignorieren
  if (oe && oe.target && (
      oe.target.closest(".leaflet-control") ||
      oe.target.closest(".search") ||
      oe.target.closest("#search-results") ||
      oe.target.closest(".site-header")
    )) return;

  // Nur linke Maustaste (Touch ok)
  if (oe && typeof oe.button === "number" && oe.button !== 0) return;

  const { lat, lng } = e.latlng;

  // 1) Cache-Hit?
  const cached = cacheGet(lat, lng);
  if (cached) {
    const html = buildPopupHTML(cached, { fromCache: true });
    L.popup({ autoPan: false }).setLatLng([lat, lng]).setContent(html).openOn(map);
    setStatus("");
    return;
  }

  // 2) Netzabfrage (laufende abbrechen)
  try { reverseAbort?.abort(); } catch {}
  reverseAbort = new AbortController();

  setStatus("Lade Adresse …");

  try {
    const data = await reverseLookup(lat, lng, reverseAbort.signal);

    if (!data) {
      setStatus("Hier wurde keine Adresse gefunden.");
      const html = `
        <div class="popup">
          <div class="popup-header">
            <div class="popup-icn">📌</div>
            <div class="popup-title">Kein Adress-Treffer</div>
          </div>
          <div class="popup-sub">${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
          <div class="popup-note">Quelle: Nominatim</div>
        </div>`;
      L.popup({ autoPan: false }).setLatLng([lat, lng]).setContent(html).openOn(map);
      return;
    }

    cacheSet(lat, lng, data);
    const html = buildPopupHTML(data, { fromCache: false });
    L.popup({ autoPan: false }).setLatLng([lat, lng]).setContent(html).openOn(map);
    setStatus("");
  } catch (err) {
    if (err.name === "AbortError") return;
    console.error(err);
    setStatus(err.message.includes("429") ? "Zu viele Anfragen – kurz warten." : "Adresse konnte nicht ermittelt werden.");
  }
});
