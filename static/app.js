let position = null;
let timer = null;
let map = null;
let userMarker = null;
let radiusCircle = null;
const aircraftMarkers = new Map();

const $ = (id) => document.getElementById(id);
const formatNumber = (value, suffix = "") => value == null ? "–" : `${new Intl.NumberFormat("de-DE").format(value)}${suffix}`;
const setStatus = (text) => $("status").textContent = text;

function initMap(lat, lon) {
  if (!map) {
    map = L.map("map", { zoomControl: false, attributionControl: true }).setView([lat, lon], 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap contributors"
    }).addTo(map);
  }
  updateMapCenter();
}

function updateMapCenter() {
  if (!map || !position) return;
  const lat = position.coords.latitude;
  const lon = position.coords.longitude;
  const radiusMeters = Number($("radius").value) * 1000;
  if (!userMarker) userMarker = L.circleMarker([lat, lon], { radius: 8, weight: 3, fillOpacity: 1 }).addTo(map).bindPopup("Dein Live-Standort");
  else userMarker.setLatLng([lat, lon]);
  if (!radiusCircle) radiusCircle = L.circle([lat, lon], { radius: radiusMeters, weight: 2, fillOpacity: 0.04 }).addTo(map);
  else radiusCircle.setLatLng([lat, lon]).setRadius(radiusMeters);
  map.fitBounds(radiusCircle.getBounds(), { padding: [24, 24], maxZoom: 14 });
}

function aircraftIcon(flight) {
  const rotation = Number(flight.heading_deg || 0);
  return L.divIcon({
    className: "aircraft-icon-wrap",
    html: `<div class="aircraft-icon" style="transform:rotate(${rotation}deg)">✈</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17]
  });
}

function updateAircraftOnMap(flights) {
  if (!map) return;
  const active = new Set();
  for (const flight of flights) {
    const key = flight.icao24 || flight.callsign;
    if (!key) continue;
    active.add(key);
    const latLng = [flight.latitude, flight.longitude];
    const popup = `<strong>${flight.callsign || "Unbekannt"}</strong><br>${flight.distance_km.toFixed(2)} km · ${flight.altitude_ft ?? "–"} ft<br>${flight.velocity_kmh ?? "–"} km/h`;
    if (aircraftMarkers.has(key)) {
      const marker = aircraftMarkers.get(key);
      marker.setLatLng(latLng).setIcon(aircraftIcon(flight)).setPopupContent(popup);
    } else {
      aircraftMarkers.set(key, L.marker(latLng, { icon: aircraftIcon(flight), keyboard: false }).addTo(map).bindPopup(popup));
    }
  }
  for (const [key, marker] of aircraftMarkers) {
    if (!active.has(key)) { map.removeLayer(marker); aircraftMarkers.delete(key); }
  }
}

function renderFlights(flights) {
  $("radarCount").textContent = flights.length;
  updateAircraftOnMap(flights);
  const list = $("flightList");
  if (!flights.length) {
    list.innerHTML = '<article class="empty">Aktuell wurde innerhalb deines Radius kein Flugzeug gemeldet.</article>';
    return;
  }
  list.innerHTML = flights.map((flight) => `
    <article class="flight-card">
      <div class="flight-top"><strong>${flight.callsign || "Unbekannt"}</strong><span>${flight.distance_km.toFixed(2)} km · ${flight.bearing_cardinal}</span></div>
      <div class="metrics"><div><small>Höhe</small><b>${formatNumber(flight.altitude_ft, " ft")}</b></div><div><small>Speed</small><b>${formatNumber(flight.velocity_kmh, " km/h")}</b></div><div><small>Kurs</small><b>${formatNumber(flight.heading_deg, "°")}</b></div></div>
      <footer>ICAO24: ${flight.icao24 || "–"} · Squawk: ${flight.squawk || "–"}</footer>
    </article>`).join("");
}

async function refresh() {
  if (!position) return;
  const radius = $("radius").value;
  setStatus("Live-Daten werden geladen …");
  try {
    const url = `/api/flights?lat=${encodeURIComponent(position.coords.latitude)}&lon=${encodeURIComponent(position.coords.longitude)}&radius_km=${encodeURIComponent(radius)}`;
    const response = await fetch(url);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Abfrage fehlgeschlagen");
    renderFlights(payload.aircraft);
    $("updatedAt").textContent = new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setStatus(`Live · ${payload.count} Flugzeuge innerhalb von ${payload.radius_km} km`);
  } catch (error) { setStatus(`Fehler: ${error.message}`); }
}

function startTimer() { if (timer) clearInterval(timer); timer = setInterval(refresh, Number($("interval").value) * 1000); }
function enableLocation() {
  if (!navigator.geolocation) { setStatus("Dein Browser unterstützt keine Standortfreigabe."); return; }
  setStatus("Standort wird bestimmt …");
  navigator.geolocation.getCurrentPosition((result) => {
    position = result;
    $("locationCard").hidden = false;
    $("coordinates").textContent = `${result.coords.latitude.toFixed(5)}, ${result.coords.longitude.toFixed(5)}`;
    $("locationButton").textContent = "Standort aktiv";
    initMap(result.coords.latitude, result.coords.longitude);
    refresh(); startTimer();
  }, (error) => setStatus(`Standortfehler: ${error.message}`), { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 });
}

$("locationButton").addEventListener("click", enableLocation);
$("radius").addEventListener("change", () => { updateMapCenter(); refresh(); });
$("interval").addEventListener("change", startTimer);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/static/sw.js");
