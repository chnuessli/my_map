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
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }),
  "OSM Bright": tl(
    "https://api.maptiler.com/maps/bright-v2/256/{z}/{x}/{y}@2x.png?key=62fWxjuKZdoP6vlFjq0a",
    {
      attribution: '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> ' +
                   '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }
  ),
  "Swisstopo light": tl(
    "https://api.maptiler.com/maps/ch-swisstopo-lbm/256/{z}/{x}/{y}@2x.png?key=62fWxjuKZdoP6vlFjq0a",
    {
      attribution: '&copy; <a href="https://www.swisstopo.admin.ch/">swisstopo</a> ' +
                   '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a>',
    }
  ),
  "OpenTopoMap": tl("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
    maxZoom: 17,
    attribution: 'Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }),
};

// Base-Layer merken
const LS_KEY = "my-map-baselayer";
const savedBase = localStorage.getItem(LS_KEY);
const initialBaseName = savedBase && baseLayers[savedBase] ? savedBase : Object.keys(baseLayers)[0];
baseLayers[initialBaseName].addTo(map);
map.on("baselayerchange", (e) => {
  localStorage.setItem(LS_KEY, e.name);
  statusEl.textContent = "";
});

// Marker-Layer
const markers = L.markerClusterGroup ? L.markerClusterGroup() : L.layerGroup();
map.addLayer(markers);

// Layer-Control
const isMobile = matchMedia("(max-width: 768px)").matches;
L.control.layers(baseLayers, { Marker: markers }, { position: "topright", collapsed: false }).addTo(map);

// Maßstab
L.control.scale({ imperial: false }).addTo(map);

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
  // kleine Aufhübschung
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

function selectPlace(p) {
  const lat = parseFloat(p.lat);
  const lon = parseFloat(p.lon);
  markers.clearLayers();
  markers.addLayer(L.marker([lat, lon]).bindPopup(`<strong>${p.display_name}</strong>`));
  map.flyTo([lat, lon], 14, { duration: 0.8 });
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

// Form & Input
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const q = input.value.trim();
  const first = resultsList.querySelector("li");
  if (first) {
    first.click();
  } else {
    searchPlaces(q);
  }
});

input.addEventListener(
  "input",
  debounce(() => {
    const q = input.value.trim();
    if (q.length >= 3) searchPlaces(q);
    else clearResults();
  }, 350)
);

// Keyboard-Navigation
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
      map.flyTo([latitude, longitude], 15, { duration: 0.6 });
      setStatus("");
    },
    () => setStatus("Konnte Standort nicht bestimmen.")
  );
});

// Header-Toggle
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

// Auto-kondensieren bei Kartennutzung; expandieren beim Fokus auf Suche
map.on("movestart", () => setCondensed(true));
input.addEventListener("focus", () => setCondensed(false));
