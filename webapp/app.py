import time
from collections import defaultdict
from pathlib import Path
from threading import Lock

import httpx
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from starlette.middleware.base import BaseHTTPMiddleware

from providers import lookup_flight, provider_status
from push import VAPID_PUBLIC_KEY, configured as push_configured, is_gone, send as send_push
from push_store import all_subscriptions, remove, upsert

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
ADSBLOL_BASE = "https://api.adsb.lol"
MAX_RADIUS_NM = 80
RATE_WINDOW_SECONDS = 60
RATE_LIMIT = 30

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(self), microphone=(), camera=(), notifications=(self)"
        response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
        response.headers["Cross-Origin-Resource-Policy"] = "same-origin"
        response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self' https://unpkg.com https://cdn.sheetjs.com; style-src 'self' https://unpkg.com; img-src 'self' data: https://*.tile.openstreetmap.org; connect-src 'self' https://api.adsb.lol https://cdn.sheetjs.com; font-src 'self' https://unpkg.com; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
        return response

app = FastAPI(title="FlightTrackr", docs_url=None, redoc_url=None)
app.add_middleware(GZipMiddleware, minimum_size=1200)
app.add_middleware(SecurityHeadersMiddleware)
_rate_lock = Lock()
_rate: dict[str, list[float]] = defaultdict(list)

def _rate_check(request: Request) -> None:
    now = time.monotonic(); key = request.client.host if request.client else "unknown"
    with _rate_lock:
        bucket = [t for t in _rate[key] if now - t < RATE_WINDOW_SECONDS]
        if len(bucket) >= RATE_LIMIT: raise HTTPException(status_code=429, detail="Rate limit exceeded. Try again shortly.")
        bucket.append(now); _rate[key] = bucket

@app.get("/healthz")
async def healthz(): return {"status":"ok","service":"flighttrackr","push":push_configured()}

@app.get("/api/push/public-key")
async def push_public_key(request: Request):
    _rate_check(request)
    if not push_configured(): raise HTTPException(status_code=503, detail="Web Push is not configured.")
    return {"publicKey": VAPID_PUBLIC_KEY}

@app.post("/api/push/subscribe")
async def push_subscribe(request: Request):
    _rate_check(request)
    if not push_configured(): raise HTTPException(status_code=503, detail="Web Push is not configured.")
    try: upsert(await request.json())
    except ValueError as exc: raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status":"subscribed"}

@app.post("/api/push/unsubscribe")
async def push_unsubscribe(request: Request):
    _rate_check(request); body = await request.json(); endpoint = body.get("endpoint") if isinstance(body, dict) else None
    if not isinstance(endpoint, str): raise HTTPException(status_code=400, detail="Invalid endpoint")
    remove(endpoint); return {"status":"unsubscribed"}

@app.post("/api/push/test")
async def push_test(request: Request):
    _rate_check(request)
    if not push_configured(): raise HTTPException(status_code=503, detail="Web Push is not configured.")
    body = await request.json()
    if not isinstance(body, dict): raise HTTPException(status_code=400, detail="Invalid payload")
    payload = {"title": str(body.get("title") or "FlightTrackr"), "body": str(body.get("body") or "Push notifications are active."), "url": "/"}
    sent = 0
    for subscription in all_subscriptions():
        try: send_push(subscription, payload); sent += 1
        except Exception as exc:
            if is_gone(exc): remove(subscription.get("endpoint", ""))
    return {"status":"sent","count":sent}

@app.get("/api/providers")
async def providers(request: Request): _rate_check(request); return provider_status()

@app.get("/api/flight-status")
async def flight_status(request: Request, flight_number: str = Query(..., min_length=2, max_length=12), date: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$")):
    _rate_check(request); clean = "".join(flight_number.upper().split())
    if not clean.isalnum(): raise HTTPException(status_code=400, detail="Invalid flight number.")
    result = await lookup_flight(clean, date)
    if not result: raise HTTPException(status_code=404, detail="No configured provider returned flight status data.")
    return result.as_dict()

@app.get("/api/nearby")
async def nearby(request: Request, lat: float=Query(...,ge=-90,le=90), lon: float=Query(...,ge=-180,le=180), radius: float=Query(25,gt=0,le=MAX_RADIUS_NM)):
    _rate_check(request)
    try:
        async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as client:
            r=await client.get(f"{ADSBLOL_BASE}/v2/point/{lat}/{lon}/{radius}",headers={"Accept":"application/json"}); r.raise_for_status(); data=r.json()
    except (httpx.HTTPError,ValueError) as exc: raise HTTPException(status_code=502,detail="Live aircraft provider unavailable.") from exc
    aircraft=[]
    for item in data.get("ac",[]):
        if item.get("lat") is None or item.get("lon") is None: continue
        aircraft.append({"hex":item.get("hex"),"callsign":(item.get("flight") or "").strip() or None,"registration":item.get("r"),"type":item.get("t"),"description":item.get("desc"),"lat":item.get("lat"),"lon":item.get("lon"),"altitude":item.get("alt_baro") if item.get("alt_baro") is not None else item.get("alt_geom"),"speed":item.get("gs"),"track":item.get("track"),"vertical_rate":item.get("baro_rate") if item.get("baro_rate") is not None else item.get("geom_rate"),"squawk":item.get("squawk"),"seen":item.get("seen")})
    return {"provider":"adsb.lol","retrieved_at":int(time.time()),"aircraft":aircraft}

@app.get("/api/aircraft/{hex_code}")
async def aircraft(hex_code: str, request: Request):
    _rate_check(request); clean=hex_code.strip().upper()
    if len(clean)!=6 or any(c not in "0123456789ABCDEF" for c in clean): raise HTTPException(status_code=400,detail="Invalid ICAO hex code.")
    try:
        async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as client:
            r=await client.get(f"{ADSBLOL_BASE}/v2/hex/{clean}",headers={"Accept":"application/json"}); r.raise_for_status(); data=r.json()
    except (httpx.HTTPError,ValueError) as exc: raise HTTPException(status_code=502,detail="Live aircraft provider unavailable.") from exc
    return {"provider":"adsb.lol","aircraft":data.get("ac",[])}

@app.get("/")
async def index(): return FileResponse(STATIC_DIR / "index.html")

@app.get("/{path:path}")
async def static_files(path: str):
    requested=(STATIC_DIR/path).resolve()
    if STATIC_DIR not in requested.parents or not requested.is_file(): raise HTTPException(status_code=404,detail="Not found")
    return FileResponse(requested)
