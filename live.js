(() => {
  let liveLayer = null, liveTimer = null, liveActive = false;
  const VIE = { lamin: 47.7, lomin: 14.4, lamax: 48.6, lomax: 17.6 };
  const A = (s) => document.querySelector(s);
  const escLive = (v) => String(v ?? '').replace(/[&<>\"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

  async function updateLiveRadar() {
    if (!window.map || !liveActive) return;
    try {
      const r = await fetch(`/api/opensky?lamin=${VIE.lamin}&lomin=${VIE.lomin}&lamax=${VIE.lamax}&lomax=${VIE.lomax}`, { cache: 'no-store' });
      if (!r.ok) throw new Error('Live-Daten nicht verfügbar');
      const payload = await r.json();
      if (!liveLayer) liveLayer = L.layerGroup().addTo(window.map);
      liveLayer.clearLayers();
      let count = 0;
      for (const s of payload.states || []) {
        if (!Number.isFinite(s.latitude) || !Number.isFinite(s.longitude)) continue;
        count++;
        const marker = L.circleMarker([s.latitude, s.longitude], { radius: 5, color: '#d4a52c', weight: 1, fillColor: '#071f41', fillOpacity: .95 });
        const alt = Number.isFinite(s.geoAltitude) ? `${Math.round(s.geoAltitude / 0.3048).toLocaleString('de-AT')} ft` : '—';
        const speed = Number.isFinite(s.velocity) ? `${Math.round(s.velocity * 1.94384)} kt` : '—';
        marker.bindPopup(`<strong>${escLive(s.callsign || s.icao24 || 'Aircraft')}</strong><br>${escLive(s.country || '—')}<br>Alt: ${alt}<br>Speed: ${speed}`);
        liveLayer.addLayer(marker);
      }
      const status = A('#liveRadarStatus');
      if (status) status.textContent = `LIVE · ${count} Flugzeuge`;
    } catch (e) {
      const status = A('#liveRadarStatus');
      if (status) status.textContent = 'LIVE · nicht verfügbar';
    }
  }

  function toggleLiveRadar() {
    liveActive = !liveActive;
    const btn = A('[data-action="toggle-live-radar"]');
    if (btn) btn.classList.toggle('active', liveActive);
    if (liveActive) {
      updateLiveRadar();
      clearInterval(liveTimer);
      liveTimer = setInterval(updateLiveRadar, 30000);
    } else {
      clearInterval(liveTimer);
      if (liveLayer) liveLayer.clearLayers();
      const status = A('#liveRadarStatus');
      if (status) status.textContent = 'LIVE · pausiert';
    }
  }

  function enableNotifications() {
    if (!('Notification' in window)) return alert('Browser-Benachrichtigungen werden nicht unterstützt.');
    Notification.requestPermission().then(p => alert(p === 'granted' ? 'Benachrichtigungen aktiviert.' : 'Benachrichtigungen nicht aktiviert.'));
  }

  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-action]');
    if (!a) return;
    if (a.dataset.action === 'toggle-live-radar') toggleLiveRadar();
    if (a.dataset.action === 'enable-notifications') enableNotifications();
  });

  window.FlightTrackrLive = { toggle: toggleLiveRadar, refresh: updateLiveRadar };
})();
