/* global L */
const statusEl = document.getElementById("status");
const form = document.getElementById("search-form");
const input = document.getElementById("search-input");
const locateBtn = document.getElementById("locate-btn");

// Map anlegen (ohne Basiskarte – die fügen wir gleich über baseLayers hinzu)
const map = L.map("map", { zoomControl: true, center: [47.3769, 8.5417], zoom: 12 });

// Helper zum Erstellen von Tile-Layern
function tl(url, opts = {}) {
  return L.tileLayer(url, {
    maxZoom: 19,
    crossOrigin: true,
    ...opts,
  }).on("tileerror", () => {
    // dezente Statusmeldung, falls ein Tile-Server hakt
    statusEl.textContent = "Hinweis: Kachelserver aktuell nicht erreichbar.";
  });
}

/**
 * >>> HIER DEINE 3 LAYER DEFINIEREN <<<
 * Tausche die URLs/Namen einfach gegen die aus deinem ursprünglichen Code.
 * Die drei Beispiele unten sind nur Platzhalter.
 */
const baseLayers = {
  "OSM Standard": tl("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }),
  "OSM Bright": tl(
    "https://api.maptiler.com/maps/bright-v2/256/{z}/{x}/{y}@2x.png?key=62fWxjuKZdoP6vlFjq0a",
    {
      maxZoom: 20,
      attribution:
        "Tiles &copy; Esri — Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community",
    }
  ),
    "Swisstopo light": tl(
    "https://api.maptiler.com/maps/ch-swisstopo-lbm/256/{z}/{x}/{y}@2x.png?key=62fWxjuKZdoP6vlFjq0a",
    {
      maxZoom: 20,
      attribution:
        "Tiles &copy; Esri — Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community",
    }
  ),
  "OpenTopoMap": tl("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
    maxZoom: 17,
    attribution:
      'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> | Tiles: &copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
  }),
};

// Zuletzt verwendete Basiskarte merken
const LS_KEY = "my-map-baselayer";
const savedBase = localStorage.getItem(LS_KEY);
const initialBaseName = savedBase && baseLayers[savedBase] ? savedBase : Object.keys(baseLayers)[0];
baseLayers[initialBaseName].addTo(map);

// Wechsel speichern
map.on("baselayerchange", (e) => {
  localStorage.setItem(LS_KEY, e.name);
  statusEl.textContent = ""; // evtl. alte Tile-Fehlermeldung zurücksetzen
});

// Overlays (Marker/Cluster etc.)
const markers = L.markerClusterGroup ? L.markerClusterGroup() : L.layerGroup();
map.addLayer(markers);

// Layer-Control hinzufügen
L.control.layers(baseLayers, { Marker: markers }, { position: "topright", collapsed: false }).addTo(map);

// ------- Der Rest deines Codes (Suche/Geolokalisierung) bleibt gleich -------

// Helper
const setStatus = (msg) => (statusEl.textContent = msg || "");

// Debounce
let debounceTimer;
const debounce = (fn, ms = 350) => (...args) => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => fn(...args), ms);
};

// Suche (Nominatim)
async function searchPlaces(query) {
  if (!query) return;
  setStatus("Suche läuft …");
  try {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("limit", "5");

    const res = await fetch(url.toString(), { headers: { "Accept-Language": "de" } });
    if (!res.ok) throw new Error("Nominatim nicht erreichbar");
    const data = await res.json();

    markers.clearLayers();
    if (!data.length) return setStatus("Nichts gefunden.");

    data.forEach((p) => {
      const lat = parseFloat(p.lat);
      const lon = parseFloat(p.lon);
      markers.addLayer(L.marker([lat, lon]).bindPopup(`<strong>${p.display_name}</strong>`));
    });

    const first = data[0];
    map.flyTo([parseFloat(first.lat), parseFloat(first.lon)], 14, { duration: 0.8 });
    setStatus(`${data.length} Treffer.`);
  } catch (e) {
    setStatus("Fehler bei der Suche.");
    console.error(e);
  }
}

// Form
document.getElementById("search-form").addEventListener("submit", (e) => {
  e.preventDefault();
  searchPlaces(input.value.trim());
});
input.addEventListener(
  "input",
  debounce(() => {
    const q = input.value.trim();
    if (q.length >= 3) searchPlaces(q);
  }, 500)
);

// Geolocation
document.getElementById("locate-btn").addEventListener("click", () => {
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
