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

function humanType(p) {
  const cls = p.class || "";
  const typ = p.type || "";
  const pretty = typ.replace(/_/g, " ");
  return `${cls}${pretty ? " · " + pretty : ""}`;
}

function clearResults() {
  resultsList.innerHTML = "";
  input.setAttribute("aria-expanded", "false");
}

function renderResultItem(p, idx) {
  const li = document.createElement("li");
  li.id = `search-opt-${idx}`;
  li.setAttribute("role", "option");

  const iconChar = ICONS[p.class] || "📌";
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

// Ort auswählen: Marker setzen & zoomen
function selectPlace(p) {
  const lat = parseFloat(p.lat);
  const lon = parseFloat(p.lon);
  markers.clearLayers();
  markers.addLayer(L.marker([lat, lon]).bindPopup(`<strong>${p.display_name}</strong>`));

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
   Reverse-Geocoding (schnell + Cache)
   ========================= */

// Alte Click-Handler (falls vorhanden) entfernen, dann genau einen setzen
map.off("click");

let reverseAbort = null;

/** Mini-Cache für Reverse-Geocoding (≈50 m Raster)
 *  - key: gerundete Koordinaten
 *  - value: { data, t }
 *  - TTL: 24h
 *  - LRU-Limit: 200 Einträge
 */
const REV_TTL_MS = 24 * 60 * 60 * 1000;
const REV_GRID = 0.0005; // ≈ 55 m bei mittleren Breiten
const REV_LRU_MAX = 200;
const revCache = new Map();

function cacheKey(lat, lon) {
  const r = REV_GRID;
  const klat = Math.round(lat / r) * r;
  const klon = Math.round(lon / r) * r;
  // fix auf 6 Nachkommastellen
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
  // LRU trim
  if (revCache.size > REV_LRU_MAX) {
    const firstKey = revCache.keys().next().value;
    revCache.delete(firstKey);
  }
}

// Hübsches Address-Label, falls display_name fehlt
function formatAddress(address = {}) {
  const parts = [
    address.road || address.pedestrian || address.cycleway || address.footway,
    address.house_number,
    address.postcode,
    address.city || address.town || address.village || address.hamlet,
    address.state,
    address.country,
  ].filter(Boolean);
  return parts.join(", ");
}

// Schnellere Fallback-Reihenfolge (weniger Stufen)
async function reverseLookup(lat, lon, signal) {
  // Start „mittelfein“ statt extrem fein → weniger Requests
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

  // 1) Cache-Hit? → sofort Popup ohne Netz
  const cached = cacheGet(lat, lng);
  if (cached) {
    const address =
      cached.display_name ||
      (cached.address ? formatAddress(cached.address) : "Adresse gefunden");

    L.popup({ autoPan: false })
      .setLatLng([lat, lng])
      .setContent(`<strong>${address}</strong><div style="opacity:.7;font-size:.85em;margin-top:4px">aus Cache</div>`)
      .openOn(map);
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
      cacheSet(lat, lng, { address: null, display_name: null }); // auch „leer“ cachen
      L.popup({ autoPan: false })
        .setLatLng([lat, lng])
        .setContent(`<strong>Kein Adress-Treffer</strong><br>${lat.toFixed(5)}, ${lng.toFixed(5)}`)
        .openOn(map);
      return;
    }

    cacheSet(lat, lng, data);

    const address =
      data.display_name ||
      (data.address ? formatAddress(data.address) : "Adresse gefunden");

    L.popup({ autoPan: false })
      .setLatLng([lat, lng])
      .setContent(`<strong>${address}</strong>`)
      .openOn(map);

    setStatus("");
  } catch (err) {
    if (err.name === "AbortError") return;
    console.error(err);
    setStatus(err.message.includes("429") ? "Zu viele Anfragen – kurz warten." : "Adresse konnte nicht ermittelt werden.");
  }
});
