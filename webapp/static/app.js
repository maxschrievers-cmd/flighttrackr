const STORAGE_KEY = "flighttrackr.flights.v1";
const SETTINGS_KEY = "flighttrackr.settings.v1";
let flights = loadJson(STORAGE_KEY, []);
let settings = loadJson(SETTINGS_KEY, {});
let userLocation = settings.location || null;
let map;
let userMarker;
let aircraftLayer;

const $ = (id) => document.getElementById(id);

function loadJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(flights)); localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>\"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c])); }
function formatDate(value) { return new Intl.DateTimeFormat("de-AT", { day:"2-digit", month:"short", year:"numeric" }).format(new Date(value + "T12:00:00")); }

function initMap() {
  map = L.map("map", { zoomControl: true, attributionControl: true }).setView([48.2082, 16.3738], 6);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
  aircraftLayer = L.layerGroup().addTo(map);
}

function setLocation(lat, lon) {
  userLocation = {lat, lon};
  settings.location = userLocation;
  save();
  if (userMarker) userMarker.remove();
  userMarker = L.circleMarker([lat, lon], {radius: 8, weight: 2, fillOpacity: .85}).addTo(map).bindPopup("Dein Standort");
  map.setView([lat, lon], 8);
  $("status").textContent = `Standort gesetzt · ${lat.toFixed(3)}, ${lon.toFixed(3)}`;
}

function locate() {
  if (!navigator.geolocation) return $("status").textContent = "Geolocation wird von diesem Browser nicht unterstützt.";
  $("status").textContent = "Standort wird nur für die Live-Abfrage verwendet …";
  navigator.geolocation.getCurrentPosition(
    p => { setLocation(p.coords.latitude, p.coords.longitude); refreshAircraft(); },
    () => $("status").textContent = "Standortzugriff abgelehnt. Du kannst einen Standort über die Browserfreigabe aktivieren.",
    {enableHighAccuracy:false, timeout:8000, maximumAge:300000}
  );
}

async function refreshAircraft() {
  if (!userLocation) return $("status").textContent = "Bitte zuerst deinen Standort freigeben.";
  $("status").textContent = "Live-Flugzeuge werden geladen …";
  try {
    const q = new URLSearchParams({lat:userLocation.lat, lon:userLocation.lon, radius:25});
    const r = await fetch(`/api/nearby?${q}`, {headers:{Accept:"application/json"}});
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    aircraftLayer.clearLayers();
    for (const ac of data.aircraft) {
      const marker = L.circleMarker([ac.lat, ac.lon], {radius: 5, weight: 1.5, fillOpacity: .8});
      marker.bindPopup(`<strong>${escapeHtml(ac.callsign || "Unbekannt")}</strong><br>${escapeHtml(ac.registration || ac.hex || "")}<br>${escapeHtml(ac.type || "Aircraft")}<br>ALT ${ac.altitude ?? "–"} · GS ${ac.speed ? Math.round(ac.speed) + " kt" : "–"}`);
      marker.addTo(aircraftLayer);
    }
    $("aircraftCount").textContent = data.aircraft.length;
    $("status").textContent = `Live · ${data.aircraft.length} Flugzeuge · ${new Date(data.retrieved_at*1000).toLocaleTimeString("de-AT")}`;
  } catch (err) {
    $("status").textContent = "Live-Daten aktuell nicht verfügbar.";
  }
}

function renderFlights() {
  const root = $("flights");
  if (!flights.length) { root.className = "flights empty"; root.textContent = "Noch keine Flüge eingetragen."; return; }
  root.className = "flights";
  const sorted = [...flights].sort((a,b) => b.date.localeCompare(a.date));
  root.innerHTML = sorted.map(f => `
    <div class="flight">
      <div class="flight-date">${escapeHtml(formatDate(f.date))}</div>
      <div class="flight-main"><strong>${escapeHtml(f.flightNumber)}</strong> · ${escapeHtml(f.from)} → ${escapeHtml(f.to)}<div>${escapeHtml(f.airline || "")} ${f.aircraft ? "· " + escapeHtml(f.aircraft) : ""} ${f.cabin ? "· " + escapeHtml(f.cabin) : ""}${f.note ? " · " + escapeHtml(f.note) : ""}</div></div>
      <div class="flight-actions"><button class="button" data-delete="${escapeHtml(f.id)}">Löschen</button></div>
    </div>`).join("");
  root.querySelectorAll("[data-delete]").forEach(btn => btn.addEventListener("click", () => { flights = flights.filter(f => f.id !== btn.dataset.delete); save(); renderAll(); }));
}

function renderStats() {
  const total = flights.length;
  const distance = flights.reduce((sum,f) => sum + (Number(f.distanceKm) || 0), 0);
  const airports = new Set(flights.flatMap(f => [f.from, f.to].filter(Boolean))).size;
  $("stats").innerHTML = [`<div class="stat"><strong>${total}</strong><span>Flüge</span></div>`,`<div class="stat"><strong>${airports}</strong><span>Flughäfen</span></div>`,`<div class="stat"><strong>${Math.round(distance).toLocaleString("de-AT")}</strong><span>km</span></div>`].join("");
  const airlines = new Map();
  for (const f of flights) airlines.set(f.airline || "Unbekannt", (airlines.get(f.airline || "Unbekannt") || 0) + 1);
  const topAirline = [...airlines.entries()].sort((a,b) => b[1]-a[1])[0];
  $("profile").innerHTML = [
    `<div class="profile-item"><strong>${topAirline ? escapeHtml(topAirline[0]) : "–"}</strong><span>häufigste Airline</span></div>`,
    `<div class="profile-item"><strong>${flights.filter(f => f.cabin === "Business" || f.cabin === "First").length}</strong><span>Premium-Flüge</span></div>`,
    `<div class="profile-item"><strong>${new Set(flights.map(f => f.aircraft).filter(Boolean)).size}</strong><span>Flugzeugtypen</span></div>`,
    `<div class="profile-item"><strong>${flights.filter(f => f.date.startsWith(String(new Date().getFullYear()))).length}</strong><span>Flüge ${new Date().getFullYear()}</span></div>`
  ].join("");
}

function renderAll(){ renderFlights(); renderStats(); }

function openDialog(){
  const d = $("flightDialog");
  $("flightForm").date.value = new Date().toISOString().slice(0,10);
  d.showModal();
}

$("locateBtn").addEventListener("click", locate);
$("refreshBtn").addEventListener("click", refreshAircraft);
$("addFlightBtn").addEventListener("click", openDialog);
$("flightForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const fd = new FormData(e.currentTarget);
  const from = String(fd.get("from")).trim().toUpperCase();
  const to = String(fd.get("to")).trim().toUpperCase();
  flights.push({id: crypto.randomUUID(), date:fd.get("date"), flightNumber:String(fd.get("flightNumber")).trim().toUpperCase(), airline:String(fd.get("airline")).trim(), from, to, aircraft:String(fd.get("aircraft")).trim(), cabin:fd.get("cabin"), note:String(fd.get("note")).trim()});
  save(); renderAll(); $("flightDialog").close(); e.currentTarget.reset();
});
$("exportBtn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify({version:1, exportedAt:new Date().toISOString(), flights}, null, 2)], {type:"application/json"});
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "flighttrackr-export.json"; a.click(); URL.revokeObjectURL(a.href);
});
$("importInput").addEventListener("change", async (e) => {
  const file = e.target.files?.[0]; if (!file) return;
  try { const parsed = JSON.parse(await file.text()); if (!Array.isArray(parsed.flights)) throw new Error(); flights = parsed.flights.filter(x => x && x.id && x.date && x.flightNumber); save(); renderAll(); } catch { alert("Import konnte nicht gelesen werden."); }
  e.target.value = "";
});

initMap(); renderAll();
if (userLocation) setLocation(userLocation.lat, userLocation.lon);
