import { sendPushNotification } from '@mmmike/web-push/send';

interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  OEBB_HAFAS_ENDPOINT: string;
  OEBB_HAFAS_AID: string;
  OEBB_HAFAS_VERSION: string;
  APP_TIMEZONE: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}

type Direction = 'OUTBOUND' | 'INBOUND';
type TripStatus = 'ON_TIME' | 'DELAYED' | 'CANCELLED' | 'NO_REALTIME';
interface Trip {
  tripId: string | null;
  line: string;
  direction: string;
  plannedDeparture: string;
  realtimeDeparture: string | null;
  delayMinutes: number | null;
  status: TripStatus;
  platform: string | null;
}

const TZ = 'Europe/Vienna';
const DEFAULT_WINDOWS = [
  { enabled: 1, days: [1,2,3,4,5,6,7], start_time: '06:00', end_time: '09:30', direction: 'OUTBOUND' as Direction },
  { enabled: 1, days: [1,2,3,4,5,6,7], start_time: '16:00', end_time: '18:30', direction: 'INBOUND' as Direction },
];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

function userEmail(request: Request) {
  const value = request.headers.get('Cf-Access-Authenticated-User-Email') || request.headers.get('cf-access-authenticated-user-email');
  return value?.trim().toLowerCase() || null;
}

function localParts(date = new Date()) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).formatToParts(date).map(p => [p.type, p.value]));
}

function todayKey() {
  const p = localParts();
  return `${p.year}-${p.month}-${p.day}`;
}

function parseHm(v: string) {
  const [h, m] = v.split(':').map(Number);
  return h * 60 + m;
}

function activeWindow(row: any) {
  const p = localParts();
  let days: number[] = [];
  try { days = JSON.parse(row.days || '[]'); } catch { /* ignore */ }
  const weekday: Record<string, number> = { Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6, Sun:7 };
  const current = Number(p.hour) * 60 + Number(p.minute);
  return Number(row.enabled) === 1 && days.includes(weekday[p.weekday]) && current >= parseHm(row.start_time) && current <= parseHm(row.end_time);
}

function hafasLocalToIso(date: string, time: string | undefined) {
  if (!time) return null;
  const y = +date.slice(0,4), mo = +date.slice(4,6) - 1, d = +date.slice(6,8);
  const h = +time.slice(0,2), m = +time.slice(2,4), s = +(time.slice(4,6) || '0');
  const base = Date.UTC(y, mo, d, h, m, s);
  const rendered = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false
  }).formatToParts(new Date(base)).map(x => [x.type, x.value]));
  const shown = Date.UTC(+rendered.year, +rendered.month - 1, +rendered.day, +rendered.hour, +rendered.minute, +rendered.second);
  return new Date(base + (base - shown)).toISOString();
}

async function hafas(env: Env, svcReqL: any[]) {
  const payload = {
    id: 'vab5-monitor-pwa', ver: env.OEBB_HAFAS_VERSION || '1.45', lang: 'de',
    auth: { type: 'AID', aid: env.OEBB_HAFAS_AID },
    client: { id: 'OEBB', type: 'IPH', name: 'vab5-monitor-pwa', l: 'de' },
    formatted: false, svcReqL
  };
  const r = await fetch(env.OEBB_HAFAS_ENDPOINT, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload)
  });
  if (!r.ok) throw new Error(`ÖBB HAFAS HTTP ${r.status}`);
  return r.json<any>();
}

const stationCache = new Map<string, any>();
async function resolveStation(env: Env, name: string) {
  const key = name.toLowerCase();
  const cached = stationCache.get(key);
  if (cached) return cached;
  const d = await hafas(env, [{ meth: 'LocMatch', req: { input: { field: 'S', loc: { name, type: 'ALL' }, maxLoc: 8 } } }]);
  const list = d?.svcResL?.[0]?.res?.match?.locL || [];
  const found = list.find((x: any) => String(x.name || '').toLowerCase() === key)
    || list.find((x: any) => String(x.name || '').toLowerCase().includes(key)) || list[0];
  if (!found) throw new Error(`Station nicht gefunden: ${name}`);
  stationCache.set(key, found);
  return found;
}

function mapTrip(j: any, product: any, date: string): Trip | null {
  const stop = j.stbStop || {};
  const planned = hafasLocalToIso(date, stop.dTimeS || stop.aTimeS);
  if (!planned) return null;
  const realtime = hafasLocalToIso(date, stop.dTimeR || stop.aTimeR);
  const delayMinutes = planned && realtime ? Math.round((Date.parse(realtime) - Date.parse(planned)) / 60000) : null;
  return {
    tripId: j.jnyId || j.id || null,
    line: String(product?.name || ''),
    direction: String(j.dirTxt || ''),
    plannedDeparture: planned,
    realtimeDeparture: realtime,
    delayMinutes,
    status: j.cancelled || stop.cancelled ? 'CANCELLED' : delayMinutes == null ? 'NO_REALTIME' : delayMinutes > 0 ? 'DELAYED' : 'ON_TIME',
    platform: stop.dPltfS?.txt || stop.aPltfS?.txt || null
  };
}

async function departures(env: Env, direction: Direction) {
  const station = await resolveStation(env, direction === 'OUTBOUND' ? 'Wien Praterstern' : 'Flughafen Wien');
  const p = localParts();
  const date = `${p.year}${p.month}${p.day}`;
  const time = `${p.hour}${p.minute}${p.second}`;
  const d = await hafas(env, [{ meth: 'StationBoard', req: {
    stbLoc: { lid: station.lid, type: 'S' }, date, time, type: 'DEP', maxJny: 40
  } }]);
  const res = d?.svcResL?.[0]?.res || {};
  const products = res.common?.prodL || [];
  const mapped = (res.jnyL || []).map((j: any) => mapTrip(j, products[j.prodX], res.date || date)).filter(Boolean) as Trip[];
  return mapped
    .filter(t => /VAB\s*5|VAB5/i.test(t.line))
    .filter(t => direction === 'OUTBOUND' ? /FLUGHAFEN|AIRPORT|VIE/i.test(t.direction) : /PRATERSTERN/i.test(t.direction))
    .filter(t => Date.parse(t.plannedDeparture) > Date.now() - 120000)
    .sort((a,b) => Date.parse(a.plannedDeparture) - Date.parse(b.plannedDeparture))
    .slice(0, 5);
}

function routeText(direction: Direction) {
  return direction === 'OUTBOUND' ? 'Praterstern → Flughafen' : 'Flughafen → Praterstern';
}

function notificationText(trip: Trip, direction: Direction) {
  if (trip.status === 'CANCELLED') return `VAB 5\n${routeText(direction)}\nAUSFALL`;
  if (trip.status === 'NO_REALTIME') return `VAB 5\n${routeText(direction)}\nKeine Echtzeitdaten · Soll ${new Date(trip.plannedDeparture).toLocaleTimeString('de-AT',{hour:'2-digit',minute:'2-digit',timeZone:TZ})}`;
  const delay = trip.delayMinutes ?? 0;
  return `VAB 5 ${delay > 0 ? `+${delay} min` : 'pünktlich'}\n${routeText(direction)}\n${new Date(trip.realtimeDeparture || trip.plannedDeparture).toLocaleTimeString('de-AT',{hour:'2-digit',minute:'2-digit',timeZone:TZ})}`;
}

async function ensureUser(env: Env, email: string) {
  const id = encodeURIComponent(email);
  await env.DB.prepare("INSERT INTO users(id,email,updated_at) VALUES(?,?,datetime('now')) ON CONFLICT(email) DO UPDATE SET updated_at=datetime('now')").bind(id,email).run();
  const existing = await env.DB.prepare('SELECT user_id FROM settings WHERE user_id=?').bind(id).first();
  if (!existing) {
    await env.DB.prepare('INSERT INTO settings(user_id) VALUES(?)').bind(id).run();
    for (const w of DEFAULT_WINDOWS) await env.DB.prepare('INSERT INTO monitor_windows(user_id,enabled,days,start_time,end_time,direction) VALUES(?,?,?,?,?,?)').bind(id,w.enabled,JSON.stringify(w.days),w.start_time,w.end_time,w.direction).run();
  }
  return id;
}

async function sendPush(env: Env, userId: string, trip: Trip, direction: Direction) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return;
  const rows = await env.DB.prepare('SELECT endpoint,subscription_json FROM push_subscriptions WHERE user_id=?').bind(userId).all<any>();
  for (const row of rows.results) {
    try {
      const delivered = await sendPushNotification(JSON.parse(row.subscription_json), {
        title: 'VAB 5 Monitor', body: notificationText(trip,direction), url: '/', tag: `vab5-${direction}`
      }, {
        subject: env.VAPID_SUBJECT || 'mailto:vab5-monitor@example.com',
        publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY
      }, { ttl: 300 });
      if (!delivered) await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').bind(row.endpoint).run();
    } catch (e: any) {
      if ([404,410].includes(e?.statusCode)) await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').bind(row.endpoint).run();
    }
  }
}

async function monitorUser(env: Env, userId: string) {
  const settings = await env.DB.prepare('SELECT * FROM settings WHERE user_id=?').bind(userId).first<any>();
  const windows = await env.DB.prepare('SELECT * FROM monitor_windows WHERE user_id=?').bind(userId).all<any>();
  const day = todayKey();
  const result: any[] = [];
  for (const direction of ['OUTBOUND','INBOUND'] as Direction[]) {
    const active = windows.results.some((w:any) => w.direction === direction && activeWindow(w));
    if (!active) continue;
    const trip = (await departures(env,direction))[0];
    if (!trip) continue;
    const prev = await env.DB.prepare('SELECT * FROM trip_state WHERE user_id=? AND direction=?').bind(userId,direction).first<any>();
    const firstOfDay = !prev || prev.service_day !== day;
    const changed = !prev || prev.trip_id !== trip.tripId || prev.status !== trip.status || prev.delay_minutes !== trip.delayMinutes;
    if (firstOfDay || changed) {
      await sendPush(env,userId,trip,direction);
      await env.DB.prepare('INSERT INTO notification_log(user_id,direction,trip_id,status,delay_minutes,message) VALUES(?,?,?,?,?,?)').bind(userId,direction,trip.tripId,trip.status,trip.delayMinutes,notificationText(trip,direction)).run();
    }
    await env.DB.prepare(`INSERT INTO trip_state(user_id,direction,trip_id,status,delay_minutes,service_day,scheduled_departure,updated_at)
      VALUES(?,?,?,?,?,?,?,datetime('now'))
      ON CONFLICT(user_id,direction) DO UPDATE SET trip_id=excluded.trip_id,status=excluded.status,delay_minutes=excluded.delay_minutes,service_day=excluded.service_day,scheduled_departure=excluded.scheduled_departure,updated_at=datetime('now')`)
      .bind(userId,direction,trip.tripId,trip.status,trip.delayMinutes,day,trip.plannedDeparture).run();
    result.push(trip);
  }
  return result;
}

async function api(request: Request, env: Env) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null,{status:204,headers:{'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,PUT,OPTIONS','access-control-allow-headers':'content-type'}});
  const email = userEmail(request);
  if (url.pathname.startsWith('/api/') && !email) return json({error:'Cloudflare Access authentication required'},401);
  const userId = email ? await ensureUser(env,email) : null;
  if (url.pathname === '/api/health') return json({ok:true,service:'vab5-monitor-pwa',time:new Date().toISOString()});
  if (url.pathname === '/api/me') return json({email});
  if (url.pathname === '/api/status') {
    const direction = url.searchParams.get('direction') === 'INBOUND' ? 'INBOUND' : 'OUTBOUND';
    return json({direction,source:'ÖBB HAFAS',fetchedAt:new Date().toISOString(),departures:await departures(env,direction)});
  }
  if (url.pathname === '/api/settings' && request.method === 'GET') {
    const settings = await env.DB.prepare('SELECT min_delay_minutes,notify_only_on_change,polling_minutes,timezone FROM settings WHERE user_id=?').bind(userId).first<any>();
    const windows = await env.DB.prepare('SELECT id,enabled,days,start_time,end_time,direction FROM monitor_windows WHERE user_id=? ORDER BY id').bind(userId).all<any>();
    return json({...settings,windows:windows.results.map((w:any)=>({...w,days:JSON.parse(w.days)}))});
  }
  if (url.pathname === '/api/settings' && request.method === 'PUT') {
    const body = await request.json<any>();
    await env.DB.prepare("UPDATE settings SET min_delay_minutes=?,notify_only_on_change=?,polling_minutes=?,updated_at=datetime('now') WHERE user_id=?")
      .bind(Math.max(0,Number(body.min_delay_minutes ?? 2)),body.notify_only_on_change===false?0:1,5,userId).run();
    await env.DB.prepare('DELETE FROM monitor_windows WHERE user_id=?').bind(userId).run();
    for (const w of body.windows || []) await env.DB.prepare('INSERT INTO monitor_windows(user_id,enabled,days,start_time,end_time,direction) VALUES(?,?,?,?,?,?)').bind(userId,w.enabled?1:0,JSON.stringify(w.days||[]),w.start_time,w.end_time,w.direction).run();
    return json({ok:true});
  }
  if (url.pathname === '/api/push/config') return json({enabled:Boolean(env.VAPID_PUBLIC_KEY),publicKey:env.VAPID_PUBLIC_KEY||null});
  if (url.pathname === '/api/push/subscribe' && request.method === 'POST') {
    const sub = await request.json<any>();
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return json({error:'invalid subscription'},400);
    await env.DB.prepare(`INSERT INTO push_subscriptions(endpoint,user_id,subscription_json,updated_at) VALUES(?,?,?,datetime('now'))
      ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,subscription_json=excluded.subscription_json,updated_at=datetime('now')`).bind(sub.endpoint,userId,JSON.stringify(sub)).run();
    return json({ok:true});
  }
  if (url.pathname === '/api/monitor/run' && request.method === 'POST') return json(await monitorUser(env,userId!));
  return null;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const response = await api(request,env);
    if (response) return response;
    return env.ASSETS.fetch(request);
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil((async()=>{
      const users = await env.DB.prepare('SELECT id FROM users').all<{id:string}>();
      for (const user of users.results) await monitorUser(env,user.id);
    })());
  }
};
