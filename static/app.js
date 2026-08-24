let position = null;
let timer = null;

const $ = (id) => document.getElementById(id);

function setStatus(text) {
  $("status").textContent = text;
}

function formatNumber(value, suffix = "") {
  return value == null ? "–" : `${new Intl.NumberFormat("de-DE").format(value)}${suffix}`;
}

function renderFlights(flights) {
  $("radarCount").textContent = flights.length;
  const list = $("flightList");
  if (!flights.length) {
    list.innerHTML = '<article class="empty">Aktuell wurde innerhalb deines Radius kein Flugzeug gemeldet.</article>';
    return;
  }

  list.innerHTML = flights.map((flight) => `
    <article class="flight-card">
      <div class="flight-top"><strong>${flight.callsign || "Unbekannt"}</strong><span>${flight.distance_km.toFixed(2)} km · ${flight.bearing_cardinal}</span></div>
      <div class="metrics">
        <div><small>Höhe</small><b>${formatNumber(flight.altitude_ft, " ft")}</b></div>
        <div><small>Speed</small><b>${formatNumber(flight.velocity_kmh, " km/h")}</b></div>
        <div><small>Kurs</small><b>${formatNumber(flight.heading_deg, "°")}</b></div>
      </div>
      <footer>ICAO24: ${flight.icao24 || "–"} · Squawk: ${flight.squawk || "–"}</footer>
    </article>
  `).join("");
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
  } catch (error) {
    setStatus(`Fehler: ${error.message}`);
  }
}

function startTimer() {
  if (timer) clearInterval(timer);
  timer = setInterval(refresh, Number($("interval").value) * 1000);
}

function enableLocation() {
  if (!navigator.geolocation) {
    setStatus("Dein Browser unterstützt keine Standortfreigabe.");
    return;
  }
  setStatus("Standort wird bestimmt …");
  navigator.geolocation.getCurrentPosition((result) => {
    position = result;
    $("locationCard").hidden = false;
    $("coordinates").textContent = `${result.coords.latitude.toFixed(5)}, ${result.coords.longitude.toFixed(5)}`;
    $("locationButton").textContent = "Standort aktiv";
    refresh();
    startTimer();
  }, (error) => setStatus(`Standortfehler: ${error.message}`), {
    enableHighAccuracy: true,
    maximumAge: 5000,
    timeout: 10000,
  });
}

$("locationButton").addEventListener("click", enableLocation);
$("radius").addEventListener("change", refresh);
$("interval").addEventListener("change", startTimer);

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/static/sw.js");
