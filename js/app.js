/* global L */
const statusEl = document.getElementById("status");
const form = document.getElementById("search-form");
const input = document.getElementById("search-input");
const locateBtn = document.getElementById("locate-btn");
const map = L.map("map", { zoomControl: true }).setView([47.3769, 8.5417], 12);

// Tile layer (OSM)
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

// Marker layer
const markers = L.markerClusterGroup ? L.markerClusterGroup() : L.layerGroup();
map.addLayer(markers);

// Helper
const setStatus = (msg) => (statusEl.textContent = msg || "");

// Debounce
let debounceTimer;
const debounce = (fn, ms = 350) => (...args) => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => fn(...args), ms);
};

// Search (Nominatim)
async function searchPlaces(query) {
  if (!query) return;
  setStatus("Suche läuft …");
  try {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("limit", "5");

    const res = await fetch(url.toString(), {
      headers: { "Accept-Language": "de" },
    });
    if (!res.ok) throw new Error("Nominatim nicht erreichbar");
    const data = await res.json();

    markers.clearLayers();
    if (!data.length) {
      setStatus("Nichts gefunden.");
      return;
    }

    data.forEach((p) => {
      const lat = parseFloat(p.lat);
      const lon = parseFloat(p.lon);
      const m = L.marker([lat, lon]).bindPopup(
        `<strong>${p.display_name}</strong>`
      );
      markers.addLayer(m);
    });

    const first = data[0];
    map.flyTo([parseFloat(first.lat), parseFloat(first.lon)], 14, {
      duration: 0.8,
    });
    setStatus(`${data.length} Treffer.`);
  } catch (e) {
    setStatus("Fehler bei der Suche.");
    console.error(e);
  }
}

// Handle form submit
form.addEventListener("submit", (e) => {
  e.preventDefault();
  searchPlaces(input.value.trim());
});

// Optional: live search with debounce on input
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
