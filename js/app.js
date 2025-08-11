/* global L */
const statusEl = document.getElementById("status");
const form = document.getElementById("search-form");
const input = document.getElementById("search-input");
const locateBtn = document.getElementById("locate-btn");

// Karte anlegen (ohne Basiskarte – die kommt über baseLayers)
const map = L.map("map", { zoomControl: true, center: [47.3769, 8.5417], zoom: 12 });

// Helper zum Erstellen von Tile-Layern (mit Retina-Defaults für @2x)
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

// Basiskarten definieren
const baseLayers = {
  "OSM Standard": tl("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }),

  "OSM Bright": tl(
    "https://api.maptiler.com/maps/bright-v2/256/{z}/{x}/{y}@2x.png?key=62fWxjuKZdoP6vlFjq0a",
    {
      attribution:
        '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> ' +
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }
  ),

  "Swisstopo light": tl(
    "https://api.maptiler.com/maps/ch-swisstopo-lbm/256/{z}/{x}/{y}@2x.png?key=62fWxjuKZdoP6vlFjq0a",
    {
      attribution:
        '&copy; <a href="https://www.swisstopo.admin.ch/">swisstopo</a> ' +
        '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> ' +
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }
  ),

  "OpenTopoMap": tl("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
    maxZoom: 17,
    attribution:
      'Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, ' +
      'SRTM | Map style &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
  }),
};

// Zuletzt verwendete Basiskarte merken
const LS_KEY = "my-map-baselayer";
const savedBase = localStorage.getItem(LS_KEY);
const initialBaseName =
  savedBase && baseLayers[savedBase] ? savedBase : Object.keys(baseLayers)[0];
baseLayers[initialBaseName].addTo(map);

// Wechsel speichern
map.on("baselayerchange", (e) => {
  localStorage.setItem(LS_KEY, e.name);
  statusEl.textContent = ""; // alte Tile-Fehlermeldung zurücksetzen
});

// Marker-Layer
const markers = L.markerClusterGroup ? L.markerClusterGroup() : L.layerGroup();
map.addLayer(markers);

// Layer-Control hinzufügen (mobil eingeklappt)
const isMobile = matchMedia("(max-width: 768px)").matches;
L.control.layers(baseLayers, { Marker: markers }, { position: "topright", collapsed: isMobile }).addTo(map);

// Maßstab hinzufügen
L.control.scale({ imperial: false }).addTo(map);

// Status-Helfer
const setStatus = (msg) => (statusEl.textContent = msg || "");

// Debounce-Funktion
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

// Formular-Events
form.addEventListener("submit", (e) => {
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
locateBtn.addEventListener("click", () => {
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
