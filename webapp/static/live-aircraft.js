(() => {
  const esc = v => String(v ?? "Nicht verfügbar").replace(/[&<>\"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));
  const loc = () => { try { return JSON.parse(localStorage.getItem("flighttrackr.settings.v2") || "{}").location || null; } catch { return null; } };
  const radiusNm = () => Number(localStorage.getItem("flighttrackr.liveRadiusNm") || 54);
  let panel;
  function ensurePanel(){
    if(panel)return panel;
    const map=document.getElementById("mapMini"); if(!map)return null;
    panel=document.createElement("section"); panel.id="liveAircraftPanel"; panel.className="live-aircraft-panel";
    map.insertAdjacentElement("afterend",panel); return panel;
  }
  function route(a){return a.route || (a.origin&&a.destination?`${a.origin} → ${a.destination}`:"Route nicht verfügbar");}
  function airline(a){return a.airline || a.operator || "Airline nicht verfügbar";}
  function render(list){
    const p=ensurePanel(); if(!p)return;
    p.innerHTML=`<div class="live-panel-head"><strong>Live-Flugzeuge</strong><span>${list.length}</span></div>`+
      (list.length?list.slice(0,50).map(a=>`<article class="live-aircraft-row"><div class="live-row-title"><strong>${esc(a.callsign||a.hex||"Unbekannt")}</strong><span>${esc(airline(a))}</span></div><div class="live-row-route"><strong>${esc(route(a))}</strong><span>${esc(a.registration||"Kennzeichen nicht verfügbar")} · ${esc(a.description||a.type||"Aircraft")}</span></div><div class="live-row-meta">${a.altitude!=null?esc(a.altitude)+" ft":"–"} · ${a.speed!=null?esc(Math.round(a.speed))+" kt":"–"} · ${esc(a.metadata_source||"ADS-B")}</div></article>`).join(""):'<div class="live-empty">Keine Flugzeuge im Radius.</div>`;
  }
  async function refresh(){
    const l=loc(); if(!l)return;
    try{
      const q=new URLSearchParams({lat:l.lat,lon:l.lon,radius:String(Math.max(1,Math.min(250,Math.round(radiusNm()))))});
      const r=await fetch(`/api/nearby?${q}`,{cache:"no-store",headers:{Accept:"application/json"}}); if(!r.ok)throw new Error(r.status);
      const d=await r.json(); render(d.aircraft||[]);
      const c=document.getElementById("aircraftCount");if(c)c.textContent=(d.aircraft||[]).length;
      const s=document.getElementById("status");if(s)s.textContent=`Live · ${(d.aircraft||[]).length} Flugzeuge`;
    }catch(e){console.debug("FlightTrackr live refresh",e);}
  }
  window.addEventListener("load",()=>{refresh();setInterval(refresh,15000);});
})();
