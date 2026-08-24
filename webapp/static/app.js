const STORAGE_KEY = "flighttrackr.flights.v2";
const SETTINGS_KEY = "flighttrackr.settings.v2";
let flights = loadJson(STORAGE_KEY, []);
let settings = loadJson(SETTINGS_KEY, {});
let userLocation = settings.location || null;
let maps = {};
let layers = {};
let showRoutes = true;
const $ = id => document.getElementById(id);
const norm = v => String(v ?? "").trim();
function loadJson(k,f){try{return JSON.parse(localStorage.getItem(k)) ?? f}catch{return f}}
function save(){localStorage.setItem(STORAGE_KEY,JSON.stringify(flights));localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings))}
function esc(v){return String(v??"").replace(/[&<>\"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]))}
function uid(){return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`}
function dateText(v){if(!v)return "–";const d=new Date(v.length===10?v+"T12:00:00":v);return Number.isNaN(d.getTime())?v:new Intl.DateTimeFormat("de-AT",{day:"2-digit",month:"short",year:"numeric"}).format(d)}
function km(v){return Number(v||0).toLocaleString("de-AT")}
function distanceKm(a,b){const R=6371;const p=x=>x*Math.PI/180;const dLat=p(b.lat-a.lat),dLon=p(b.lon-a.lon);const h=Math.sin(dLat/2)**2+Math.cos(p(a.lat))*Math.cos(p(b.lat))*Math.sin(dLon/2)**2;return Math.round(R*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h)))}
function airportCoord(code){return settings.airports?.[code?.toUpperCase()]||null}
function uniqueCount(key){return new Set(flights.map(f=>norm(f[key]).toUpperCase()).filter(Boolean)).size}

function initMap(id, center=[48.2082,16.3738], zoom=5){
  const m=L.map(id,{zoomControl:true}).setView(center,zoom);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:18,attribution:"© OpenStreetMap contributors"}).addTo(m);
  maps[id]=m; layers[id]=L.layerGroup().addTo(m); return m;
}
function drawRoutes(id){
  const layer=layers[id]; if(!layer)return; layer.clearLayers();
  const points=[]; const seen=[];
  for(const f of flights){const a=airportCoord(f.from),b=airportCoord(f.to); if(!a||!b)continue; const line=L.polyline([[a.lat,a.lon],[b.lat,b.lon]],{weight:showRoutes?2:0.8,opacity:showRoutes?.6:.08});line.bindPopup(`<strong>${esc(f.flightNumber)}</strong><br>${esc(f.from)} → ${esc(f.to)}<br>${esc(dateText(f.date))}`);line.addTo(layer);points.push([a.lat,a.lon],[b.lat,b.lon]);seen.push(f.from,f.to)}
  for(const code of new Set(seen)){const c=airportCoord(code); if(c)L.circleMarker([c.lat,c.lon],{radius:4,weight:1,fillOpacity:.9}).bindTooltip(code).addTo(layer)}
  if(points.length)maps[id].fitBounds(points,{padding:[20,20],maxZoom:8});
}
function redrawMaps(){drawRoutes("mapMain");drawRoutes("mapMini")}

function setLocation(lat,lon){userLocation={lat,lon};settings.location=userLocation;save();for(const id of Object.keys(maps)){maps[id].setView([lat,lon],8)}; $("status").textContent=`Standort gesetzt · ${lat.toFixed(3)}, ${lon.toFixed(3)}`; }
function locate(){if(!navigator.geolocation)return $("status").textContent="Geolocation wird nicht unterstützt.";$("status").textContent="Standort wird nur für die Live-Anzeige genutzt …";navigator.geolocation.getCurrentPosition(p=>{setLocation(p.coords.latitude,p.coords.longitude);refreshAircraft()},()=>$("status").textContent="Standortzugriff abgelehnt.",{enableHighAccuracy:false,timeout:8000,maximumAge:300000})}
async function refreshAircraft(){if(!userLocation)return $("status").textContent="Bitte zuerst deinen Standort freigeben.";$("status").textContent="Live-Flüge werden geladen …";try{const q=new URLSearchParams({lat:userLocation.lat,lon:userLocation.lon,radius:25});const r=await fetch(`/api/nearby?${q}`,{headers:{Accept:"application/json"}});if(!r.ok)throw 0;const d=await r.json();layers.mapMini.clearLayers();for(const ac of d.aircraft){const m=L.circleMarker([ac.lat,ac.lon],{radius:5,weight:1.5,fillOpacity:.85});m.bindPopup(`<strong>${esc(ac.callsign||"Unknown")}</strong><br>${esc(ac.registration||ac.hex||"")}<br>${esc(ac.description||ac.type||"Aircraft")}<br>ALT ${ac.altitude??"–"} · GS ${ac.speed?Math.round(ac.speed)+" kt":"–"}`);m.addTo(layers.mapMini)}$("aircraftCount").textContent=d.aircraft.length;$("status").textContent=`Live · ${d.aircraft.length} Flugzeuge · ${new Date(d.retrieved_at*1000).toLocaleTimeString("de-AT")}`}catch{$("status").textContent="Live-Daten aktuell nicht verfügbar."}}

function stats(){const total=flights.length;const dist=flights.reduce((s,f)=>s+Number(f.distanceKm||0),0);const airports=uniqueCount("from")+uniqueCount("to");const years=new Set(flights.map(f=>String(f.date||"").slice(0,4)).filter(Boolean)).size;$("statsTop").innerHTML=[stat(total,"Flüge"),stat(airports,"Airport-Einträge"),stat(km(dist),"km erfasst"),stat(years,"Jahre")].join("");
  const counts=(key)=>Object.entries(flights.reduce((m,f)=>{const k=norm(f[key])||"Unbekannt";m[k]=(m[k]||0)+1;return m},{})).sort((a,b)=>b[1]-a[1]);
  renderBars("yearStats",countsFromYear());renderBars("airlineStats",counts("airline"));renderBars("airportStats",countsAirports());renderBars("aircraftStats",counts("aircraft"));
  const top=counts("airline")[0]?.[0]||"–";$("profile").innerHTML=[profileItem(top,"häufigste Airline"),profileItem(new Set(flights.flatMap(f=>[f.from,f.to].filter(Boolean))).size,"verschiedene Flughäfen"),profileItem(new Set(flights.map(f=>f.aircraft).filter(Boolean)).size,"Aircraft Types"),profileItem(flights.filter(f=>f.cabin==="Business"||f.cabin==="First").length,"Premium-Flüge")].join("");
  const routes=countsRoutes();$("routeList").innerHTML=routes.slice(0,5).map(x=>`<div><strong>${esc(x[0])}</strong><span>${x[1]}×</span></div>`).join("")||'<div class="muted">Noch keine Routen.</div>'; yearOptions();
}
function stat(v,l){return `<div class="stat"><strong>${esc(v)}</strong><span>${esc(l)}</span></div>`}function profileItem(v,l){return `<div class="profile-item"><strong>${esc(v)}</strong><span>${esc(l)}</span></div>`}
function countsFromYear(){return Object.entries(flights.reduce((m,f)=>{const y=String(f.date||"").slice(0,4)||"Unbekannt";m[y]=(m[y]||0)+1;return m},{})).sort((a,b)=>b[0].localeCompare(a[0]))}
function countsAirports(){const m={};flights.forEach(f=>{[f.from,f.to].forEach(x=>{const k=norm(x).toUpperCase();if(k)m[k]=(m[k]||0)+1})});return Object.entries(m).sort((a,b)=>b[1]-a[1])}
function countsRoutes(){const m={};flights.forEach(f=>{const k=`${norm(f.from).toUpperCase()} → ${norm(f.to).toUpperCase()}`;if(k!==" → ")m[k]=(m[k]||0)+1});return Object.entries(m).sort((a,b)=>b[1]-a[1])}
function renderBars(id,items){const max=Math.max(1,...items.map(x=>x[1]));$(id).innerHTML=items.slice(0,12).map(([k,v])=>`<div class="bar-row"><div class="bar-label"><span>${esc(k)}</span><strong>${v}</strong></div><div class="bar"><i style="width:${Math.round(v/max*100)}%"></i></div></div>`).join("")||'<div class="muted">Keine Daten.</div>'}
function yearOptions(){const sel=$("yearFilter"),cur=sel.value;const ys=[...new Set(flights.map(f=>String(f.date||"").slice(0,4)).filter(Boolean))].sort().reverse();sel.innerHTML='<option value="all">Alle Jahre</option>'+ys.map(y=>`<option>${y}</option>`).join("");if(ys.includes(cur))sel.value=cur}

function filteredFlights(){const q=norm($("searchInput").value).toLowerCase(),y=$("yearFilter").value;return [...flights].filter(f=>{const hay=[f.flightNumber,f.airline,f.from,f.to,f.aircraft,f.note,f.bookingRef].join(" ").toLowerCase();return(!q||hay.includes(q))&&(y==="all"||String(f.date||"").startsWith(y))}).sort((a,b)=>String(b.date).localeCompare(String(a.date)))}
function flightRow(f){return `<div class="flight"><div class="flight-date">${esc(dateText(f.date))}</div><div class="flight-main"><strong>${esc(f.flightNumber)}</strong><span class="route">${esc(f.from)} → ${esc(f.to)}</span><div>${esc(f.airline||"")} ${f.aircraft?`· ${esc(f.aircraft)}`:""} ${f.cabin?`· ${esc(f.cabin)}`:""}</div><div class="muted">${f.distanceKm?km(f.distanceKm)+" km · ":""}${f.durationMin?Math.floor(f.durationMin/60)+"h "+(f.durationMin%60)+"m · ":""}${f.seat?"Seat "+esc(f.seat):""}</div></div><div class="flight-actions"><button class="button" data-edit="${esc(f.id)}">Bearbeiten</button><button class="button danger" data-delete="${esc(f.id)}">Löschen</button></div></div>`}
function renderFlights(){const list=filteredFlights(),root=$("flights");root.className="flights";root.innerHTML=list.length?list.map(flightRow).join(""):'<div class="empty">Keine passenden Flüge.</div>';root.querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>openDialog(b.dataset.edit));root.querySelectorAll("[data-delete]").forEach(b=>b.onclick=()=>{if(confirm("Flug wirklich löschen?")){flights=flights.filter(x=>x.id!==b.dataset.delete);save();renderAll()}});const recent=flights.slice().sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,8);$("recentFlights").innerHTML=recent.length?recent.map(flightRow).join(""):'<div class="empty">Keine Flüge eingetragen.</div>';$("recentFlights").querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>openDialog(b.dataset.edit))}

function renderAll(){stats();renderFlights();redrawMaps()}
function showTab(id){document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x.id===id));document.querySelectorAll(".navbtn").forEach(x=>x.classList.toggle("active",x.dataset.tab===id));setTimeout(()=>Object.values(maps).forEach(m=>m.invalidateSize()),50);if(id==="mapTab")redrawMaps()}

document.addEventListener("click",e=>{const b=e.target.closest("[data-tabgo]");if(b)showTab(b.dataset.tabgo)});
document.querySelectorAll(".navbtn").forEach(b=>b.onclick=()=>showTab(b.dataset.tab));
$("locateBtn").onclick=locate;$("refreshBtn").onclick=refreshAircraft;$("addFlightBtn").onclick=()=>openDialog();$("addFlightBtn2").onclick=()=>openDialog();$("searchInput").oninput=renderFlights;$("yearFilter").onchange=renderFlights;$("routeModeBtn").onclick=()=>{showRoutes=!showRoutes;$("routeModeBtn").textContent=showRoutes?"Routen ausblenden":"Routen einblenden";redrawMaps()};

function openDialog(id){const f=id?flights.find(x=>x.id===id):null;const form=$("flightForm");$("dialogTitle").textContent=f?"Flug bearbeiten":"Flug hinzufügen";$("dialogEyebrow").textContent=f?"EDIT":"NEUER EINTRAG";form.reset();for(const el of form.elements){if(el.name&&f&&Object.hasOwn(f,el.name))el.value=f[el.name]??""}if(!f){form.date.value=new Date().toISOString().slice(0,10);form.cabin.value="Economy";form.reason.value="Leisure"}$("duplicateWarning").hidden=true;$("flightDialog").showModal()}
$("flightForm").addEventListener("input",()=>{const f=new FormData($("flightForm")),flight=norm(f.get("flightNumber")).toUpperCase(),date=norm(f.get("date"));const dupe=flights.find(x=>x.flightNumber?.toUpperCase()===flight&&x.date===date&&x.id!==f.get("id"));$("duplicateWarning").hidden=!dupe;if(dupe)$("duplicateWarning").textContent=`Möglicher Doppel-Eintrag: ${dupe.flightNumber} am ${dateText(dupe.date)}.`});
$("flightForm").addEventListener("submit",e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.currentTarget).entries());f.id=f.id||uid();f.flightNumber=norm(f.flightNumber).toUpperCase();f.from=norm(f.from).toUpperCase();f.to=norm(f.to).toUpperCase();f.distanceKm=Number(f.distanceKm||0)||0;f.durationMin=Number(f.durationMin||0)||0;const idx=flights.findIndex(x=>x.id===f.id);if(idx>=0)flights[idx]=f;else flights.push(f);save();renderAll();$("flightDialog").close()});

async function importFile(file){if(!file)return;$("importResult").hidden=false;$("importResult").textContent="Datei wird lokal im Browser verarbeitet …";try{let rows=[];if(file.name.toLowerCase().endsWith(".json")){const p=JSON.parse(await file.text());rows=Array.isArray(p)?p:(p.flights||[])}else{const data=await file.arrayBuffer();const wb=XLSX.read(data,{type:"array",cellDates:true});for(const name of wb.SheetNames){const ws=wb.Sheets[name];rows.push(...XLSX.utils.sheet_to_json(ws,{defval:""}))}}
 const mapped=rows.map(mapImportRow).filter(x=>x.date&&x.flightNumber&&x.from&&x.to);const existing=new Set(flights.map(f=>`${f.date}|${f.flightNumber}|${f.from}|${f.to}`));let added=0,dupes=0;for(const f of mapped){const key=`${f.date}|${f.flightNumber}|${f.from}|${f.to}`;if(existing.has(key)){dupes++;continue}flights.push({...f,id:uid()});existing.add(key);added++}save();renderAll();$("importResult").textContent=`Import fertig: ${added} Flüge hinzugefügt, ${dupes} Dubletten übersprungen, ${rows.length-mapped.length} Zeilen nicht erkannt.`}catch(err){$("importResult").textContent="Import fehlgeschlagen: Format oder Spalten konnten nicht erkannt werden."}}
function col(row,names){for(const n of names){const k=Object.keys(row).find(x=>x.toLowerCase().replace(/[ _-]/g,"")===n.toLowerCase().replace(/[ _-]/g,""));if(k&&row[k]!=="")return row[k]}return ""}
function mapImportRow(r){const d=col(r,["date","datum","flightdate","departuredate"]);let date=d instanceof Date?d.toISOString().slice(0,10):norm(d);if(/^\d{1,2}[./]\d{1,2}[./]\d{2,4}$/.test(date)){const [day,mo,yr]=date.split(/[./]/);date=`${yr.length===2?"20"+yr:yr}-${mo.padStart(2,"0")}-${day.padStart(2,"0")}`}const fn=norm(col(r,["flightnumber","flight","flightno","flugnummer","ident"])).toUpperCase();const from=norm(col(r,["from","origin","departureairport","departure","abflug","start"])).toUpperCase();const to=norm(col(r,["to","destination","arrivalairport","arrival","ankunft","ziel"])).toUpperCase();return{id:uid(),date,flightNumber:fn,airline:norm(col(r,["airline","carrier","airlinecode","gesellschaft"])),aircraft:norm(col(r,["aircraft","aircrafttype","type","flugzeug"])),from,to,departure:norm(col(r,["departuretime","scheduleddeparture","abflugzeit"])),arrival:norm(col(r,["arrivaltime","scheduledarrival","ankunftszeit"])),distanceKm:Number(col(r,["distancekm","distance","distanzkm","miles","nm"])||0)||0,durationMin:Number(col(r,["durationmin","duration","flighttime","flugzeit"])||0)||0,cabin:norm(col(r,["cabin","class","klasse"]))||"Economy",reason:norm(col(r,["reason","travelreason","reisegrund"]))||"Leisure",seat:norm(col(r,["seat","seatnumber","sitzplatz"])),bookingRef:norm(col(r,["bookingref","booking","pnr","reference"])),note:norm(col(r,["note","notes","comment","notiz"]))}}
$("excelInput").onchange=e=>importFile(e.target.files?.[0]);
$("exportJsonBtn").onclick=()=>download("flighttrackr-backup.json",JSON.stringify({version:2,flights},null,2),"application/json");
$("exportXlsxBtn").onclick=()=>{const wb=XLSX.utils.book_new();const rows=flights.map(({id,...f})=>f);const ws=XLSX.utils.json_to_sheet(rows);XLSX.utils.book_append_sheet(wb,ws,"Flights");XLSX.writeFile(wb,"flighttrackr-flights.xlsx")};
function download(name,text,type){const a=document.createElement("a"),u=URL.createObjectURL(new Blob([text],{type}));a.href=u;a.download=name;a.click();URL.revokeObjectURL(u)}
$("clearDataBtn").onclick=()=>{if(confirm("Alle Flüge und lokalen FlightTrackr-Daten löschen?")){localStorage.removeItem(STORAGE_KEY);localStorage.removeItem(SETTINGS_KEY);location.reload()}};$("clearLocationBtn").onclick=()=>{delete settings.location;userLocation=null;save();$("status").textContent="Standort gelöscht"};

initMap("mapMini",[48.2082,16.3738],5);initMap("mapMain",[48.2082,16.3738],4);renderAll();if(userLocation){setLocation(userLocation.lat,userLocation.lon)}
