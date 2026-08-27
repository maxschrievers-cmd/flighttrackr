import { sendNotification } from '@mmmike/web-push/server';

type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  OEBB_HAFAS_ENDPOINT: string;
  OEBB_HAFAS_AID: string;
  OEBB_HAFAS_VERSION: string;
  APP_TIMEZONE: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
};

type Direction = 'OUTBOUND' | 'INBOUND';
type User = { id: string; email: string };
type Trip = {
  tripId: string | null;
  line: string;
  direction: string;
  plannedDeparture: string | null;
  realtimeDeparture: string | null;
  delayMinutes: number | null;
  status: 'ON_TIME' | 'DELAYED' | 'CANCELLED' | 'NO_REALTIME';
  platform: string | null;
};

type AccessEnv = Env;

const DEFAULT_WINDOWS = [
  { enabled: 1, days: [1, 2, 3, 4, 5, 6, 7], start_time: '06:00', end_time: '09:30', direction: 'OUTBOUND' as Direction },
  { enabled: 1, days: [1, 2, 3, 4, 5, 6, 7], start_time: '16:00', end_time: '18:30', direction: 'INBOUND' as Direction },
];

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

function corsHeaders() {
  return { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,PUT,POST,OPTIONS', 'access-control-allow-headers': 'content-type' };
}

function withCors(response: Response) {
  const h = new Headers(response.headers);
  Object.entries(corsHeaders()).forEach(([k, v]) => h.set(k, v));
  return new Response(response.body, { status: response.status, headers: h });
}

function userFromAccess(request: Request): User | null {
  const email = request.headers.get('cf-access-authenticated-user-email')?.trim().toLowerCase();
  if (!email || !email.includes('@')) return null;
  return { id: encodeURIComponent(email), email };
}

async function ensureUser(env: Env, user: User) {
  await env.DB.prepare('INSERT INTO users(id,email) VALUES(?,?) ON CONFLICT(email) DO UPDATE SET updated_at=datetime(\'now\')').bind(user.id, user.email).run();
  const existing = await env.DB.prepare('SELECT user_id FROM settings WHERE user_id=?').bind(user.id).first();
  if (!existing) {
    await env.DB.prepare('INSERT INTO settings(user_id) VALUES(?)').bind(user.id).run();
    for (const w of DEFAULT_WINDOWS) {
      await env.DB.prepare('INSERT OR IGNORE INTO monitor_windows(user_id,enabled,days,start_time,end_time,direction) VALUES(?,?,?,?,?,?)')
        .bind(user.id, w.enabled, JSON.stringify(w.days), w.start_time, w.end_time, w.direction).run();
    }
  }
}

function localParts(timeZone: string, date = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(date);
  return Object.fromEntries(p.map(x => [x.type, x.value]));
}

function hhmmNow(timeZone: string) {
  const p = localParts(timeZone);
  return `${p.hour}:${p.minute}`;
}

function minutes(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function activeWindow(row: any, timeZone: string, now = new Date()) {
  const p = localParts(timeZone, now);
  const dayMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const day = dayMap[p.weekday];
  let days: number[] = [];
  try { days = JSON.parse(row.days || '[]'); } catch { days = []; }
  const current = Number(p.hour) * 60 + Number(p.minute);
  return Number(row.enabled) === 1 && days.includes(day) && current >= minutes(row.start_time) && current <= minutes(row.end_time);
}

function parseHafasLocal(date: string, time: string | undefined, timeZone: string) {
  if (!time) return null;
  const y = Number(date.slice(0, 4));
  const mo = Number(date.slice(4, 6));
  const d = Number(date.slice(6, 8));
  const hh = Number(time.slice(0, 2));
  const mm = Number(time.slice(2, 4));
  const ss = Number(time.slice(4, 6) || '0');
  const probe = new Date(Date.UTC(y, mo - 1, d, hh, mm, ss));
  const rendered = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(probe);
  const r = Object.fromEntries(rendered.map(x => [x.type, x.value]));
  const asUtc = Date.UTC(Number(r.year), Number(r.month) - 1, Number(r.day), Number(r.hour), Number(r.minute), Number(r.second));
  const desired = Date.UTC(y, mo - 1, d, hh, mm, ss);
  return new Date(probe.getTime() + (desired - asUtc)).toISOString();
}

async function hafas(env: Env, svcReqL: any[]) {
  const body = {
    id: 'vab5-monitor', ver: env.OEBB_HAFAS_VERSION || '1.45', lang: 'de',
    auth: { type: 'AID', aid: env.OEBB_HAFAS_AID },
    client: { id: 'OEBB', type: 'IPH', name: 'vab5-monitor-pwa', l: 'de' }, formatted: false, svcReqL,
  };
  const response = await fetch(env.OEBB_HAFAS_ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`ÖBB HAFAS HTTP ${response.status}`);
  return response.json<any>();
}

const stationCache = new Map<string, any>();
async function station(env: Env, name: string) {
  const key = name.toLowerCase();
  if (stationCache.has(key)) return stationCache.get(key);
  const d = await hafas(env, [{ meth: 'LocMatch', req: { input: { field: 'S', loc: { name, type: 'ALL' }, maxLoc: 8 } } }]);
  const list = d?.svcResL?.[0]?.res?.match?.locL || [];
  const exact = list.find((x: any) => String(x.name || '').toLowerCase() === key);
  const p = exact || list.find((x: any) => String(x.name || '').toLowerCase().includes(key)) || list[0];
  if (!p) throw new Error(`Station nicht gefunden: ${name}`);
  stationCache.set(key, p);
  return p;
}

function parseTrip(j: any, prod: any, date: string, timeZone: string): Trip {
  const stop = j.stbStop || {};
  const planned = parseHafasLocal(date, stop.dTimeS || stop.aTimeS, timeZone);
  const realtime = parseHafasLocal(date, stop.dTimeR || stop.aTimeR, timeZone);
  let delayMinutes: number | null = null;
  if (planned && realtime) delayMinutes = Math.round((Date.parse(realtime) - Date.parse(planned)) / 60000);
  return {
    tripId: j.jnyId || j.id || null,
    line: prod?.name || '', direction: j.dirTxt || '', plannedDeparture: planned, realtimeDeparture: realtime,
    delayMinutes, status: j.cancelled || stop.cancelled ? 'CANCELLED' : delayMinutes == null ? 'NO_REALTIME' : delayMinutes > 0 ? 'DELAYED' : 'ON_TIME',
    platform: stop.dPltfS?.txt || stop.aPltfS?.txt || null,
  };
}

async function departures(env: Env, direction: Direction): Promise<Trip[]> {
  const name = direction === 'OUTBOUND' ? 'Wien Praterstern' : 'Flughafen Wien';
  const st = await station(env, name);
  const parts = localParts(env.APP_TIMEZONE || 'Europe/Vienna');
  const date = `${parts.year}${parts.month}${parts.day}`;
  const time = `${parts.hour}${parts.minute}${parts.second}`;
  const d = await hafas(env, [{ meth: 'StationBoard', req: { stbLoc: { lid: st.lid, type: 'S' }, date, time, type: 'DEP', maxJny: 40 } }]);
  const res = d?.svcResL?.[0]?.res || {};
  const products = res.common?.prodL || [];
  const list = res.jnyL || [];
  return list.map((j: any) => parseTrip(j, products[j.prodX], res.date || date, env.APP_TIMEZONE || 'Europe/Vienna'))
    .filter((t: Trip) => /VAB\s*5|VAB5/i.test(t.line) && (direction === 'OUTBOUND' ? /FLUGHAFEN|AIRPORT|VIE/i.test(t.direction) : /PRATERSTERN/i.test(t.direction)))
    .filter((t: Trip) => t.plannedDeparture)
    .sort((a: Trip, b: Trip) => Date.parse(a.plannedDeparture!) - Date.parse(b.plannedDeparture!));
}

async function current(env: Env, direction: Direction) {
  const list = await departures(env, direction);
  const now = Date.now();
  return { direction, source: 'ÖBB HAFAS', fetchedAt: new Date().toISOString(), departures: list.filter(t => Date.parse(t.plannedDeparture!) > now - 120000).slice(0, 5) };
}

function statusText(t: Trip, direction: Direction) {
  const route = direction === 'OUTBOUND' ? 'Praterstern → Flughafen' : 'Flughafen → Praterstern';
  if (t.status === 'CANCELLED') return `VAB 5\n${route}\nAUSFALL`;
  if (t.status === 'NO_REALTIME') return `VAB 5\n${route}\nKeine Echtzeitdaten · Soll ${new Date(t.plannedDeparture!).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Vienna' })}`;
  const delay = t.delayMinutes ?? 0;
  return `VAB 5 ${delay <= 0 ? 'pünktlich' : `+${delay} min`}\n${route}\n${new Date(t.realtimeDeparture || t.plannedDeparture!).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Vienna' })}`;
}

async function sendPush(env: Env, userId: string, trip: Trip, direction: Direction) {
  if (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY) return;
  const rows = await env.DB.prepare('SELECT endpoint,subscription_json FROM push_subscriptions WHERE user_id=?').bind(userId).all<any>();
  const payload = JSON.stringify({ title: 'VAB 5 Monitor', body: statusText(trip, direction), data: { route: direction } });
  for (const row of rows.results) {
    try {
      await sendNotification(JSON.parse(row.subscription_json), payload, { vapidDetails: { subject: env.VAPID_SUBJECT || 'mailto:vab5-monitor@example.com', publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY } });
    } catch (error: any) {
      if ([404, 410].includes(error?.statusCode) || [404, 410].includes(error?.status)) {
        await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').bind(row.endpoint).run();
      }
    }
  }
}

async function monitorUser(env: Env, user: User) {
  await ensureUser(env, user);
  const settings = await env.DB.prepare('SELECT * FROM settings WHERE user_id=?').bind(user.id).first<any>();
  const windows = await env.DB.prepare('SELECT * FROM monitor_windows WHERE user_id=?').bind(user.id).all<any>();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: env.APP_TIMEZONE || 'Europe/Vienna' }).format(new Date());
  const result: any[] = [];
  for (const direction of ['OUTBOUND', 'INBOUND'] as Direction[]) {
    const window = windows.results.find((w: any) => w.direction === direction && activeWindow(w, env.APP_TIMEZONE || 'Europe/Vienna'));
    if (!window) continue;
    const currentStatus = (await current(env, direction)).departures[0];
    if (!currentStatus) continue;
    const previous = await env.DB.prepare('SELECT * FROM trip_state WHERE user_id=? AND direction=?').bind(user.id, direction).first<any>();
    const changed = !previous || previous.trip_id !== currentStatus.tripId || previous.status !== currentStatus.status || previous.delay_minutes !== currentStatus.delayMinutes;
    const delayHit = currentStatus.delayMinutes != null && currentStatus.delayMinutes >= Number(settings?.min_delay_minutes ?? 2);
    const firstOfDay = !previous || previous.service_day !== today;
    const shouldNotify = firstOfDay || changed || delayHit;
    if (shouldNotify) {
      await sendPush(env, user.id, currentStatus, direction);
      await env.DB.prepare('INSERT INTO notification_log(user_id,direction,trip_id,status,delay_minutes,message) VALUES(?,?,?,?,?,?)')
        .bind(user.id, direction, currentStatus.tripId, currentStatus.status, currentStatus.delayMinutes, statusText(currentStatus, direction)).run();
    }
    await env.DB.prepare(`INSERT INTO trip_state(user_id,direction,trip_id,status,delay_minutes,service_day,scheduled_departure,updated_at)
      VALUES(?,?,?,?,?,?,?,datetime('now'))
      ON CONFLICT(user_id,direction) DO UPDATE SET trip_id=excluded.trip_id,status=excluded.status,delay_minutes=excluded.delay_minutes,service_day=excluded.service_day,scheduled_departure=excluded.scheduled_departure,updated_at=datetime('now')`)
      .bind(user.id, direction, currentStatus.tripId, currentStatus.status, currentStatus.delayMinutes, today, currentStatus.plannedDeparture).run();
    result.push(currentStatus);
  }
  return result;
}

async function allUsersMonitor(env: Env) {
  const users = await env.DB.prepare('SELECT id,email FROM users').all<User>();
  for (const u of users.results) await monitorUser(env, u);
}

async function api(request: Request, env: Env) {
  if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }));
  const url = new URL(request.url);
  const user = userFromAccess(request);
  if (url.pathname.startsWith('/api/') && !user) return json({ error: 'Cloudflare Access authentication required' }, 401);
  if (user) await ensureUser(env, user);

  if (url.pathname === '/api/me') return json({ email: user?.email ?? null });
  if (url.pathname === '/api/settings' && request.method === 'GET') {
    const settings = await env.DB.prepare('SELECT * FROM settings WHERE user_id=?').bind(user!.id).first<any>();
    const windows = await env.DB.prepare('SELECT id,enabled,days,start_time,end_time,direction FROM monitor_windows WHERE user_id=? ORDER BY id').bind(user!.id).all<any>();
    return withCors(json({ ...settings, windows: windows.results.map((w: any) => ({ ...w, days: JSON.parse(w.days) })) }));
  }
  if (url.pathname === '/api/settings' && request.method === 'PUT') {
    const body = await request.json<any>();
    await env.DB.prepare('UPDATE settings SET min_delay_minutes=?,notify_only_on_change=?,polling_minutes=?,updated_at=datetime(\'now\') WHERE user_id=?')
      .bind(Number(body.min_delay_minutes ?? 2), body.notify_only_on_change === false ? 0 : 1, Number(body.polling_minutes ?? 5), user!.id).run();
    await env.DB.prepare('DELETE FROM monitor_windows WHERE user_id=?').bind(user!.id).run();
    for (const w of body.windows || []) {
      await env.DB.prepare('INSERT INTO monitor_windows(user_id,enabled,days,start_time,end_time,direction) VALUES(?,?,?,?,?,?)')
        .bind(user!.id, w.enabled ? 1 : 0, JSON.stringify(w.days || []), w.start_time, w.end_time, w.direction).run();
    }
    return withCors(json({ ok: true }));
  }
  if (url.pathname === '/api/status' && request.method === 'GET') {
    const direction = url.searchParams.get('direction') === 'INBOUND' ? 'INBOUND' : 'OUTBOUND';
    return withCors(json(await current(env, direction)));
  }
  if (url.pathname === '/api/push/config') {
    return withCors(json({ enabled: Boolean(env.VAPID_PUBLIC_KEY), publicKey: env.VAPID_PUBLIC_KEY || null }));
  }
  if (url.pathname === '/api/push/subscribe' && request.method === 'POST') {
    const sub = await request.json<any>();
    if (!sub?.endpoint || !sub?.keys) return withCors(json({ error: 'invalid subscription' }, 400));
    await env.DB.prepare(`INSERT INTO push_subscriptions(endpoint,user_id,subscription_json,updated_at) VALUES(?,?,?,datetime('now'))
      ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,subscription_json=excluded.subscription_json,updated_at=datetime('now')`)
      .bind(sub.endpoint, user!.id, JSON.stringify(sub)).run();
    return withCors(json({ ok: true }));
  }
  if (url.pathname === '/api/monitor/run' && request.method === 'POST') {
    return withCors(json(await monitorUser(env, user!)));
  }
  if (url.pathname === '/api/health') return json({ ok: true, time: new Date().toISOString() });
  return null;
}

export default {
  async fetch(request: Request, env: AccessEnv, ctx: ExecutionContext) {
    const apiResponse = await api(request, env);
    if (apiResponse) return apiResponse;
    return env.ASSETS.fetch(request);
  },
  async scheduled(_controller: ScheduledController, env: AccessEnv, ctx: ExecutionContext) {
    ctx.waitUntil(allUsersMonitor(env));
  },
};
