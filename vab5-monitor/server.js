import express from 'express';
import webpush from 'web-push';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const load = () => { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return { settings: null, state: {}, pushes: [] }; } };
const save = (x) => fs.writeFileSync(STATE_FILE, JSON.stringify(x, null, 2));
let store = load();

const defaults = {
  minDelayMinutes: 2,
  notifyOnlyOnChange: true,
  pollingSeconds: 300,
  windows: [
    { id: 'morning', enabled: true, days: [1,2,3,4,5,6,7], start: '06:00', end: '09:30', direction: 'OUTBOUND' },
    { id: 'evening', enabled: true, days: [1,2,3,4,5,6,7], start: '16:00', end: '18:30', direction: 'INBOUND' }
  ]
};
const settings = () => store.settings || defaults;

const cfg = {
  endpoint: process.env.OEBB_HAFAS_ENDPOINT || 'https://fahrplan.oebb.at/bin/mgate.exe',
  aid: process.env.OEBB_HAFAS_AID || 'OWDL4fE4ixNiPBBm',
  version: process.env.OEBB_HAFAS_VERSION || '1.45',
  port: Number(process.env.PORT || 8787),
  tz: 'Europe/Vienna',
};
const monitorKey = process.env.MONITOR_KEY || '';
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT) {
  webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
}

function localParts(date = new Date()) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: cfg.tz, weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(date);
  return Object.fromEntries(p.map(x => [x.type, x.value]));
}
function localYmd(date = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: cfg.tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const o = Object.fromEntries(p.map(x => [x.type, x.value]));
  return `${o.year}${o.month}${o.day}`;
}
function ymdToIso(date, hhmmss) {
  const [y,mo,d] = [date.slice(0,4), date.slice(4,6), date.slice(6,8)];
  const [h,mi,s='00'] = [hhmmss.slice(0,2), hhmmss.slice(2,4), hhmmss.slice(4,6)];
  const probe = new Date(`${y}-${mo}-${d}T12:00:00Z`);
  const tzString = new Intl.DateTimeFormat('en-US', { timeZone: cfg.tz, timeZoneName: 'shortOffset' }).formatToParts(probe).find(x => x.type === 'timeZoneName')?.value || 'GMT+1';
  const m = tzString.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  const offset = m ? `${m[1]}${String(m[2]).padStart(2,'0')}:${m[3] || '00'}` : '+01:00';
  return `${y}-${mo}-${d}T${h}:${mi}:${s}${offset}`;
}
function hhmmNow() { const o = localParts(); return `${o.hour}${o.minute}${o.second}`; }
function toMin(s) { const [h,m] = s.split(':').map(Number); return h * 60 + m; }
function activeWindow(dir) {
  const o = localParts();
  const map = { Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6, Sun:7 };
  const current = map[o.weekday]; const min = Number(o.hour) * 60 + Number(o.minute);
  return settings().windows.find(w => w.enabled && w.direction === dir && w.days.includes(current) && min >= toMin(w.start) && min <= toMin(w.end));
}

async function hafas(svcReqL) {
  const body = { id:'1', ver:cfg.version, lang:'de', auth:{type:'AID',aid:cfg.aid}, client:{id:'OEBB',type:'IPH',name:'oebbPROD-ADHOC',l:'de'}, formatted:false, svcReqL };
  const r = await fetch(cfg.endpoint, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body) });
  if (!r.ok) throw new Error(`ÖBB HTTP ${r.status}`);
  const data = await r.json();
  const svc = data?.svcResL?.[0];
  if (svc?.err && svc.err !== 'OK') throw new Error(svc.errTxt || svc.err);
  return data;
}

const stationCache = new Map();
async function station(name) {
  const key = name.toLowerCase();
  if (stationCache.has(key)) return stationCache.get(key);
  const d = await hafas([{ meth:'LocMatch', req:{ input:{ field:'S', loc:{ name, type:'ALL' }, maxLoc:8 } } }]);
  const list = d?.svcResL?.[0]?.res?.match?.locL || [];
  const p = list.find(x => String(x.name || '').toLowerCase() === key) || list.find(x => String(x.name || '').toLowerCase().includes(key)) || list[0];
  if (!p) throw new Error(`Station nicht gefunden: ${name}`);
  const s = { lid:p.lid, name:p.name, extId:p.extId }; stationCache.set(key, s); return s;
}

function parseJourney(j, prod, date) {
  const s = j.stbStop || {};
  const planned = s.dTimeS || s.aTimeS || null;
  const realtime = s.dTimeR || s.aTimeR || null;
  if (!planned) return null;
  const plannedIso = ymdToIso(date, planned);
  const realtimeIso = realtime ? ymdToIso(date, realtime) : null;
  const delay = realtimeIso ? Math.round((new Date(realtimeIso) - new Date(plannedIso)) / 60000) : null;
  return { tripId:j.jnyId || j.id || null, line:prod?.name || '', direction:j.dirTxt || '', plannedDeparture:plannedIso, realtimeDeparture:realtimeIso, delayMinutes:delay, status:j.cancelled || s.cancelled ? 'CANCELLED' : delay == null ? 'NO_REALTIME' : delay > 0 ? 'DELAYED' : 'ON_TIME', platform:s.dPltfS?.txt || s.aPltfS?.txt || null };
}
async function board(direction) {
  const st = await station(direction === 'OUTBOUND' ? 'Wien Praterstern' : 'Flughafen Wien');
  const d = await hafas([{ meth:'StationBoard', req:{ stbLoc:{lid:st.lid,type:'S'}, date:localYmd(), time:hhmmNow(), type:'DEP', maxJny:30 } }]);
  const r = d?.svcResL?.[0]?.res || {}, products = r.common?.prodL || [], date = r.date || localYmd();
  return (r.jnyL || []).map(j => parseJourney(j, products[j.prodX], date)).filter(Boolean).filter(x => {
    const l = x.line.toUpperCase(); const q = x.direction.toUpperCase();
    return /VAB\s*5|VAB5/.test(l) && (direction === 'OUTBOUND' ? /FLUGHAFEN|AIRPORT|VIE/.test(q) : /PRATERSTERN/.test(q));
  }).sort((a,b) => new Date(a.plannedDeparture) - new Date(b.plannedDeparture));
}
async function current(direction) { const list = await board(direction); const now = Date.now(); return { departures:list.filter(x => new Date(x.plannedDeparture).getTime() > now - 120000).slice(0,5), fetchedAt:new Date().toISOString(), source:'ÖBB HAFAS' }; }
function pushMessage(s, dir) {
  const route = dir === 'OUTBOUND' ? 'Praterstern → Flughafen' : 'Flughafen → Praterstern';
  const time = new Date(s.realtimeDeparture || s.plannedDeparture).toLocaleTimeString('de-AT', { hour:'2-digit', minute:'2-digit' });
  if (s.status === 'CANCELLED') return `VAB 5\n${route}\n${time}\nAUSFALL`;
  if (s.status === 'NO_REALTIME') return `VAB 5\n${route}\n${time}\nKeine Echtzeitdaten · Sollfahrt`;
  if ((s.delayMinutes ?? 0) <= 0) return `VAB 5\n${route}\n${time}\nPünktlich`;
  return `VAB 5\n${route}\n${time}\n+${s.delayMinutes} min`;
}
async function notify(s, dir) {
  if (!process.env.VAPID_PUBLIC_KEY) return;
  const payload = JSON.stringify({ title:'VAB 5 Monitor', body:pushMessage(s,dir), data:{direction:dir, tripId:s.tripId} });
  const alive = [];
  for (const sub of store.pushes) {
    try { await webpush.sendNotification(sub, payload); alive.push(sub); }
    catch (e) { if (![404,410].includes(e.statusCode)) alive.push(sub); }
  }
  store.pushes = alive; save(store);
}
async function run(force = false) {
  const out = [];
  for (const dir of ['OUTBOUND','INBOUND']) {
    if (!force && !activeWindow(dir)) continue;
    try {
      const data = await current(dir), s = data.departures?.[0];
      if (!s) { out.push({direction:dir,status:'NO_DEPARTURE'}); continue; }
      const today = localYmd(), prev = store.state[dir]; const delay = s.delayMinutes; const threshold = Number(settings().minDelayMinutes || 0);
      const changed = !prev || prev.tripId !== s.tripId || prev.status !== s.status || (delay != null && delay >= threshold && prev.delay !== delay);
      const daily = !prev || prev.day !== today;
      if (daily || (!settings().notifyOnlyOnChange ? true : changed)) {
        await notify(s, dir); store.state[dir] = { day:today, tripId:s.tripId, status:s.status, delay }; save(store);
      }
      out.push(s);
    } catch (e) { out.push({direction:dir,error:e.message}); }
  }
  return out;
}
app.get('/api/health', (req,res) => res.json({ok:true,time:new Date().toISOString()}));
app.get('/api/settings', (req,res) => res.json(settings()));
app.put('/api/settings', (req,res) => { if (!Array.isArray(req.body?.windows)) return res.status(400).json({error:'windows erforderlich'}); store.settings = {...settings(),...req.body}; save(store); res.json(settings()); });
app.get('/api/status', async (req,res) => { try { res.json(await current(req.query.direction === 'INBOUND' ? 'INBOUND' : 'OUTBOUND')); } catch (e) { res.status(502).json({error:e.message}); } });
app.get('/api/push/config', (req,res) => res.json({ enabled:Boolean(process.env.VAPID_PUBLIC_KEY), publicKey:process.env.VAPID_PUBLIC_KEY || null }));
app.post('/api/push/subscribe', (req,res) => { const s=req.body; if(!s?.endpoint || !s?.keys) return res.status(400).json({error:'invalid subscription'}); store.pushes=[...store.pushes.filter(x=>x.endpoint!==s.endpoint),s]; save(store); res.json({ok:true}); });
app.post('/api/monitor/run', async (req,res) => { if(monitorKey && req.get('x-monitor-key')!==monitorKey) return res.status(401).json({error:'unauthorized'}); try { res.json(await run(true)); } catch(e) { res.status(502).json({error:e.message}); } });
setInterval(() => run(false).catch(() => {}), 60000);
app.get('*', (req,res) => res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(cfg.port, () => console.log(`VAB5 Monitor listening on ${cfg.port}`));
