(() => {
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? "").replace(/[&<>\"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));
  const text = (value, fallback="Nicht verfügbar") => value ? String(value) : fallback;
  const route = ac => ac.route || ((ac.origin && ac.destination) ? `${ac.origin} → ${ac.destination}` : "Route nicht verfügbar");
  const airline = ac => ac.airline || ac.operator || "Airline nicht verfügbar";
  let timer = null;

  function locationFromStorage() {
    try { return JSON.parse(localStorage.getItem("flighttrackr.settings.v2") || "{}").location || null; } catch { return null; }
  }

  async function refreshLiveAircraft() {
    const location = locationFromStorage();
    if (!location) return;
    try {
      const radiusNm = Number(localStorage.getItem("flighttrackr.liveRadiusNm") || 54);
      const params = new URLSearchParams({lat: location.lat, lon: location.lon, radius: String(Math.max(1, Math.min(250, Math.round(radiusNm))))});
      const response = await fetch(`/api/nearby?${params}`, {headers:{Accept:"application/json"},cache:"no-store"});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const aircraft = data.aircraft || [];

      if (window.layers?.mapMini && window.L) {
        window.layers.mapMini.clearLayers();
        for (const ac of aircraft) {
          if (ac.lat == null || ac.lon == null) continue;
          const marker = L.circleMarker([ac.lat, ac.lon], {radius:6, weight:2, fillOpacity:.9});
          marker.bindPopup(`<div style="min-width:220px"><strong style="font-size:16px">${esc(ac.callsign || ac.hex || "Unbekannt")}</strong><hr style="margin:6px 0"><div><strong>Airline:</strong> ${esc(airline(ac))}</div><div><strong>Route:</strong> ${esc(route(ac))}</div><div><strong>Kennzeichen:</strong> ${esc(text(ac.registration, ac.hex || "Nicht verfügbar"))}</div><div><strong>Flugzeug:</strong> ${esc(text(ac.description || ac.type))}</div><div><strong>Höhe:</strong> ${esc(ac.altitude ?? "–")} ft</div><div><strong>Geschwindigkeit:</strong> ${esc(ac.speed != null ? Math.round(ac.speed) + " kt" : "–")}</div><div><strong>Kurs:</strong> ${esc(ac.track != null ? Math.round(ac.track) + "°" : "–")}</div><div><strong>Datenquelle:</strong> ${esc(ac.metadata_source || data.provider || "ADS-B/OpenSky")}</div></div>`);
          marker.addTo(window.layers.mapMini);
        }
      }

      $("aircraftCount") && ($("aircraftCount").textContent = aircraft.length);
      $("status") && ($("status").textContent = `Live · ${aircraft.length} Flugzeuge · ${aircraft.filter(a => a.route || a.origin || a.destination).length} mit Route`);
    } catch (error) {
      console.error("FlightTrackr live radar", error);
    }
  }

  window.addEventListener("load", () => { refreshLiveAircraft(); timer = setInterval(refreshLiveAircraft, 15000); });
})();
