/* Live radar enrichment UI. Loaded after app-v3.js and intentionally independent. */
(() => {
  const esc=v=>String(v??"Nicht verfügbar").replace(/[&<>\"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));
  const value=(v,fallback="Nicht verfügbar")=>v===null||v===undefined||v===""?fallback:v;
  function popup(ac){
    const airline=value(ac.airline||ac.operator);
    const route=ac.route||(ac.origin&&ac.destination?`${ac.origin} → ${ac.destination}`:null);
    return `<strong>${esc(ac.callsign||ac.hex||"Unbekannt")}</strong><br>`+
      `<b>Airline:</b> ${esc(airline)}<br>`+
      `<b>Route:</b> ${esc(route)}<br>`+
      `<b>Kennzeichen:</b> ${esc(ac.registration)}<br>`+
      `<b>Flugzeug:</b> ${esc(ac.description||ac.type)}<br>`+
      `<b>Höhe:</b> ${esc(ac.altitude)}<br>`+
      `<b>Speed:</b> ${ac.speed!=null?esc(Math.round(ac.speed))+" kt":"Nicht verfügbar"}`;
  }
  async function enrichAndRender(){
    if(!window.userLocation || !window.L || !window.layers?.mapMini) return;
    try{
      const radius=Number(window.settings?.liveRadius||25);
      const qs=new URLSearchParams({lat:window.userLocation.lat,lon:window.userLocation.lon,radius:String(Math.min(250,Math.max(1,radius)))});
      const response=await fetch(`/api/nearby?${qs}`,{headers:{Accept:"application/json"},cache:"no-store"});
      if(!response.ok) return;
      const data=await response.json();
      window.layers.mapMini.clearLayers();
      for(const ac of data.aircraft||[]){
        L.circleMarker([ac.lat,ac.lon],{radius:6,weight:1.5,fillOpacity:.9}).bindPopup(popup(ac),{maxWidth:320}).addTo(window.layers.mapMini);
      }
      const count=document.getElementById("aircraftCount"); if(count) count.textContent=(data.aircraft||[]).length;
      const status=document.getElementById("status"); if(status) status.textContent=`Live · ${(data.aircraft||[]).length} Flugzeuge · ${new Date(data.retrieved_at*1000).toLocaleTimeString("de-AT")}`;
    }catch(_e){}
  }
  window.setInterval(enrichAndRender,15000);
  window.addEventListener("flighttrackr:refresh",enrichAndRender);
  window.flightTrackrEnrichLive=enrichAndRender;
})();
